"""Stage 120: Exchangeable model over centered cyclic position autocorrelation."""
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
DIRICHLET_PRIOR_STRENGTH = 10.0


def _cyclic_autocorrelation_state(number):
    digits = [ord(char) - 48 for char in number]
    total = sum(digits)
    centered = [DIGIT_COUNT * digit - total for digit in digits]
    return sum(centered[index] * centered[(index + 1) % DIGIT_COUNT]
               for index in range(DIGIT_COUNT))


def _cyclic_autocorrelation_realizations():
    realizations = {}
    for value in range(NUMBER_SPACE):
        number = f"{value:0{DIGIT_COUNT}d}"
        state = _cyclic_autocorrelation_state(number)
        realizations[state] = realizations.get(state, 0) + 1
    if sum(realizations.values()) != NUMBER_SPACE:
        raise RuntimeError("Cyclic autocorrelation states must cover all tickets")
    states = sorted(realizations)
    counts = [realizations[state] for state in states]
    return states, counts, {state: index for index, state in enumerate(states)}


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
    return dated, fingerprint


def _state_distribution(state_counts, prior_draws, base_masses):
    state_count = len(base_masses)
    denominator = prior_draws + DIRICHLET_PRIOR_STRENGTH
    return [
        (state_counts[state] + DIRICHLET_PRIOR_STRENGTH * base_masses[state])
        / denominator
        for state in range(state_count)
    ]


def _position_marginals(position_counts, prior_draws):
    return [
        [(position_counts[position][digit] + 1.0) / (prior_draws + DIGIT_CARDINALITY)
         for digit in range(DIGIT_CARDINALITY)]
        for position in range(DIGIT_COUNT)
    ]


def _fano_slates(position_marginals, ticket_probabilities, state_index):
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
            state = _cyclic_autocorrelation_state(number)
            words.append((point, number, ticket_probabilities[state_index[state]]))
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
    state_values, state_realizations, state_index = _cyclic_autocorrelation_realizations()
    state_base_masses = [count / NUMBER_SPACE for count in state_realizations]
    dated, fingerprint = _load_draws()
    state_counts = [0] * len(state_values)
    position_counts = [[0] * DIGIT_CARDINALITY for _ in range(DIGIT_COUNT)]
    forecasts = []
    hits = 0
    hit_dates = []
    log_loss_sum = 0.0
    slate_mass_sum = 0.0

    for target_index, (target_date, actual) in enumerate(dated):
        state_probabilities = _state_distribution(
            state_counts, target_index, state_base_masses)
        ticket_probabilities = [
            state_probabilities[state] / state_realizations[state]
            for state in range(len(state_values))
        ]
        marginals = _position_marginals(position_counts, target_index)
        slate = _fano_slates(marginals, ticket_probabilities, state_index)
        actual_autocorrelation = _cyclic_autocorrelation_state(actual)
        actual_state = state_index[actual_autocorrelation]
        actual_probability = ticket_probabilities[actual_state]
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
            "actual_centered_cyclic_autocorrelation": actual_autocorrelation,
            "prior_cyclic_autocorrelation_state_count": state_counts[actual_state],
            "actual_cyclic_autocorrelation_predictive_probability": state_probabilities[actual_state],
            "actual_ticket_predictive_probability": actual_probability,
            "prior_cyclic_autocorrelation_probabilities": state_probabilities,
            "prior_position_marginals": marginals,
            "candidate_probabilities": slate["candidate_probabilities"],
            "five_ticket_predictive_mass": slate["five_ticket_predictive_mass"],
            "punctured_line": slate["punctured_line"],
            "selected_points": slate["selected_points"],
        })

        # Update autocorrelation-state counts only after scoring this target.
        state_counts[actual_state] += 1
        for position, char in enumerate(actual):
            position_counts[position][ord(char) - 48] += 1
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
        "walk_forward": "cyclic autocorrelation state counts update only after each target is scored",
        "model_family": "exchangeable centered cyclic position-autocorrelation model with punctured-Fano slate decoding",
        "cyclic_autocorrelation_state_values": state_values,
        "cyclic_autocorrelation_state_count": len(state_values),
        "uniform_cyclic_autocorrelation_ticket_counts": state_realizations,
        "dirichlet_prior_strength": DIRICHLET_PRIOR_STRENGTH,
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
              f"results-{run_date}-stage-120-cyclic-position-autocorrelation.json")
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
