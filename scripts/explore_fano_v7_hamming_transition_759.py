"""Stage 100: pooled Hamming-distance transition model with Fano decoding."""
from __future__ import annotations

from datetime import datetime
import hashlib
import json
import math
from pathlib import Path
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import astra
import fano

DRAW_COUNT = 759
EXPECTED_FINGERPRINT = "c7d1cd0199ee945a9102dab341c7353cf0c76272b05d69bee3b6119d0bed6145"
DIGIT_COUNT = 6
DIGIT_CARDINALITY = 10
NUMBER_SPACE = DIGIT_CARDINALITY ** DIGIT_COUNT
TICKET_COUNT = 5
DISTANCE_PRIOR_STRENGTH = 10.0
DISTANCE_REALIZATIONS = [
    math.comb(DIGIT_COUNT, distance) * (DIGIT_CARDINALITY - 1) ** distance
    for distance in range(DIGIT_COUNT + 1)
]
DISTANCE_BASE_MASS = [count / NUMBER_SPACE for count in DISTANCE_REALIZATIONS]


def _load_draws():
    dated = []
    for row in astra.load_existing_astra_history():
        values = astra._category_values(row, "prize1", DIGIT_COUNT)
        if values is not None:
            dated.append((astra._history_date(row["date"]), values[0]))
    dated.sort()
    if len(dated) != DRAW_COUNT or len({day for day, _ in dated}) != DRAW_COUNT:
        raise RuntimeError("Expected exactly 759 unique first-prize draws")
    if any(dated[i - 1][0] >= dated[i][0] for i in range(1, DRAW_COUNT)):
        raise RuntimeError("First-prize draws are not strictly chronological")
    if any(len(number) != DIGIT_COUNT or not number.isascii() or not number.isdigit()
           for _, number in dated):
        raise RuntimeError("Every first-prize result must remain six ASCII digits")
    material = "\n".join(f"{day.isoformat()}|{number}" for day, number in dated)
    fingerprint = hashlib.sha256(material.encode("ascii")).hexdigest()
    if fingerprint != EXPECTED_FINGERPRINT:
        raise RuntimeError(f"Fixed 759-draw fingerprint changed: {fingerprint}")
    if not math.isclose(sum(DISTANCE_BASE_MASS), 1.0, rel_tol=0.0, abs_tol=1e-12):
        raise RuntimeError("Uniform Hamming-distance base masses must normalize")
    return dated, fingerprint


def _hamming(left, right):
    return sum(a != b for a, b in zip(left, right))


def _distance_probabilities(observed_counts, prior_transitions):
    denominator = prior_transitions + DISTANCE_PRIOR_STRENGTH
    return [
        (observed_counts[distance] + DISTANCE_PRIOR_STRENGTH * DISTANCE_BASE_MASS[distance])
        / denominator
        for distance in range(DIGIT_COUNT + 1)
    ]


def _position_marginals(previous, distance_probabilities):
    if previous is None:
        return [[1.0 / DIGIT_CARDINALITY] * DIGIT_CARDINALITY
                for _ in range(DIGIT_COUNT)]
    stay_probability = sum(
        probability * (DIGIT_COUNT - distance) / DIGIT_COUNT
        for distance, probability in enumerate(distance_probabilities)
    )
    change_probability_per_digit = sum(
        probability * distance / (DIGIT_COUNT * (DIGIT_CARDINALITY - 1))
        for distance, probability in enumerate(distance_probabilities)
    )
    marginals = []
    for char in previous:
        previous_digit = ord(char) - 48
        marginals.append([
            stay_probability if digit == previous_digit else change_probability_per_digit
            for digit in range(DIGIT_CARDINALITY)
        ])
    return marginals


def _ticket_probability(number, previous, distance_probabilities):
    if previous is None:
        return 1.0 / NUMBER_SPACE
    distance = _hamming(number, previous)
    return distance_probabilities[distance] / DISTANCE_REALIZATIONS[distance]


def _fano_slates(position_marginals, previous, distance_probabilities):
    top_two = [sorted(range(DIGIT_CARDINALITY), key=lambda digit: (
        -position_marginals[position][digit], digit))[:2]
        for position in range(DIGIT_COUNT)]
    scored = []
    for puncture in range(7):
        retained_lines = [line for line in range(7) if line != puncture]
        words = []
        for point in range(7):
            number = "".join(
                str(top_two[position][int(point in fano.FANO_LINES[line])])
                for position, line in enumerate(retained_lines)
            )
            probability = _ticket_probability(number, previous, distance_probabilities)
            words.append((point, number, probability))
        if len({number for _, number, _ in words}) != 7:
            raise RuntimeError("Each punctured Fano codebook must have seven unique tickets")
        selected = sorted(words, key=lambda row: (-row[2], row[0]))[:TICKET_COUNT]
        scored.append((sum(row[2] for row in selected), puncture, selected))
    mass, puncture, selected = min(
        scored, key=lambda row: (-row[0], row[1], tuple(x[0] for x in row[2]))
    )
    candidates = [row[1] for row in selected]
    if len(candidates) != TICKET_COUNT or len(set(candidates)) != TICKET_COUNT:
        raise RuntimeError("The selected Fano slate must have five unique tickets")
    return {
        "candidates": candidates,
        "candidate_probabilities": [row[2] for row in selected],
        "five_ticket_predictive_mass": mass,
        "punctured_line": puncture + 1,
        "selected_points": [row[0] + 1 for row in selected],
    }


def run():
    started = time.perf_counter()
    dated, fingerprint = _load_draws()
    distance_counts = [0] * (DIGIT_COUNT + 1)
    previous = None
    forecasts = []
    hits = 0
    hit_dates = []
    log_loss_sum = 0.0
    slate_mass_sum = 0.0

    for target_index, (target_date, actual) in enumerate(dated):
        transition_count = max(0, target_index - 1)
        distance_probabilities = _distance_probabilities(distance_counts, transition_count)
        marginals = _position_marginals(previous, distance_probabilities)
        slate = _fano_slates(marginals, previous, distance_probabilities)
        actual_distance = _hamming(actual, previous) if previous is not None else None
        actual_probability = _ticket_probability(actual, previous, distance_probabilities)
        log_loss_sum -= math.log(actual_probability)
        slate_mass_sum += slate["five_ticket_predictive_mass"]
        hit = actual in slate["candidates"]
        hits += int(hit)
        if hit:
            hit_dates.append(target_date.isoformat())
        forecasts.append({
            "target_date": target_date.isoformat(),
            "prior_valid_draws": target_index,
            "actual": actual,
            "candidates": slate["candidates"],
            "hit": hit,
            "prior_previous_ticket": previous,
            "prior_distance_counts": list(distance_counts),
            "actual_hamming_distance": actual_distance,
            "prior_distance_probabilities": distance_probabilities,
            "actual_predictive_probability": actual_probability,
            "prior_position_marginals": marginals,
            "candidate_probabilities": slate["candidate_probabilities"],
            "five_ticket_predictive_mass": slate["five_ticket_predictive_mass"],
            "punctured_line": slate["punctured_line"],
            "selected_points": slate["selected_points"],
        })

        # Add the observed transition distance only after scoring this target.
        if previous is not None:
            distance_counts[actual_distance] += 1
        previous = actual
        if (target_index + 1) % 100 == 0:
            print(f"walk-forward: {target_index + 1}/{DRAW_COUNT}, hits={hits}", flush=True)

    recomputed_hits = sum(row["actual"] in row["candidates"] for row in forecasts)
    expected_dates = [day.isoformat() for day, _ in dated]
    if len(forecasts) != DRAW_COUNT or [row["target_date"] for row in forecasts] != expected_dates:
        raise RuntimeError("Walk-forward must contain all targets in date order")
    if [row["prior_valid_draws"] for row in forecasts] != list(range(DRAW_COUNT)):
        raise RuntimeError("Prior counts must run from 0 through 758")
    if any(len(row["candidates"]) != TICKET_COUNT
           or len(set(row["candidates"])) != TICKET_COUNT
           or any(len(number) != DIGIT_COUNT or not number.isascii() or not number.isdigit()
                  for number in row["candidates"])
           for row in forecasts):
        raise RuntimeError("Every target must have five unique six-digit candidates")
    if recomputed_hits != hits:
        raise RuntimeError("Reported hits do not match the candidate lists")

    run_date = datetime.now(astra.THAILAND_TZ).date().isoformat()
    report = {
        "run_date": run_date,
        "draw_count": DRAW_COUNT,
        "date_range": [dated[0][0].isoformat(), dated[-1][0].isoformat()],
        "actuals_sha256": fingerprint,
        "target": "at least 10 exact six-digit first-prize hits over 759 targets, with five distinct candidates per target",
        "walk_forward": "pooled adjacent-draw Hamming-distance counts update only after scoring each target",
        "model_family": "Dirichlet-smoothed Hamming-distance transition model with punctured-Fano slate decoding",
        "distance_realizations": DISTANCE_REALIZATIONS,
        "distance_uniform_base_mass": DISTANCE_BASE_MASS,
        "distance_prior_strength": DISTANCE_PRIOR_STRENGTH,
        "uniform_expected_hits": DRAW_COUNT * TICKET_COUNT / NUMBER_SPACE,
        "v7": {
            "hits": hits,
            "hit_rate_percent": round(100.0 * hits / DRAW_COUNT, 8),
            "hit_dates": hit_dates,
            "mean_joint_log_loss": round(log_loss_sum / DRAW_COUNT, 8),
            "uniform_log_loss": math.log(NUMBER_SPACE),
            "mean_five_ticket_predictive_mass": round(slate_mass_sum / DRAW_COUNT, 12),
            "forecasts": forecasts,
        },
        "threshold": {"minimum_hits": 10, "met": hits >= 10},
        "validation": {
            "forecast_count": len(forecasts),
            "prior_counts_0_to_758": True,
            "five_distinct_candidates_each": True,
            "recomputed_hits": recomputed_hits,
        },
        "interpretation": "retrospective exploratory evaluation only; no evidence of independent or prospective predictive advantage",
        "elapsed_seconds": round(time.perf_counter() - started, 3),
    }
    output = (ROOT / ".scratch" / "fano-v7-walk-forward" /
              f"results-{run_date}-stage-100-hamming-transition.json")
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({
        "hits": hits,
        "hit_dates": hit_dates,
        "minimum_hits": 10,
        "met": hits >= 10,
        "mean_joint_log_loss": report["v7"]["mean_joint_log_loss"],
        "uniform_log_loss": report["v7"]["uniform_log_loss"],
        "data_fingerprint": fingerprint,
        "result_file": str(output),
        "elapsed_seconds": report["elapsed_seconds"],
    }, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    run()
