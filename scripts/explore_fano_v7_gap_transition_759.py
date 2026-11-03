"""Stage 97: draw-gap-conditioned per-position transition model."""
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
TICKET_COUNT = 5
POOLED_PRIOR_STRENGTH = 10.0
GAP_PRIOR_STRENGTH = 20.0
GAP_CLASSES = ("short_le_15", "ordinary_16", "long_ge_17")


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


def _gap_class(days):
    if days <= 15:
        return GAP_CLASSES[0]
    if days == 16:
        return GAP_CLASSES[1]
    return GAP_CLASSES[2]


def _empty_transition_counts():
    return [[[0] * DIGIT_CARDINALITY for _ in range(DIGIT_CARDINALITY)]
            for _ in range(DIGIT_COUNT)]


def _position_probabilities(previous_number, gap_class, pooled_counts, gap_counts):
    if previous_number is None:
        return [[1.0 / DIGIT_CARDINALITY] * DIGIT_CARDINALITY
                for _ in range(DIGIT_COUNT)]
    probabilities = []
    for position, char in enumerate(previous_number):
        previous_digit = ord(char) - 48
        pooled = pooled_counts[position][previous_digit]
        pooled_total = sum(pooled)
        pooled_probs = [
            (pooled[digit] + POOLED_PRIOR_STRENGTH / DIGIT_CARDINALITY)
            / (pooled_total + POOLED_PRIOR_STRENGTH)
            for digit in range(DIGIT_CARDINALITY)
        ]
        contextual = gap_counts[gap_class][position][previous_digit]
        contextual_total = sum(contextual)
        probabilities.append([
            (contextual[digit] + GAP_PRIOR_STRENGTH * pooled_probs[digit])
            / (contextual_total + GAP_PRIOR_STRENGTH)
            for digit in range(DIGIT_CARDINALITY)
        ])
    return probabilities


def _fano_slates(position_probabilities):
    top_two = [sorted(range(DIGIT_CARDINALITY), key=lambda digit: (
        -position_probabilities[position][digit], digit))[:2]
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
            probability = math.prod(
                position_probabilities[position][int(number[position])]
                for position in range(DIGIT_COUNT)
            )
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
    pooled_counts = _empty_transition_counts()
    gap_counts = {gap_class: _empty_transition_counts() for gap_class in GAP_CLASSES}
    forecasts = []
    hits = 0
    hit_dates = []
    log_loss_sum = 0.0
    slate_mass_sum = 0.0

    for target_index, (target_date, actual) in enumerate(dated):
        if target_index == 0:
            previous_date = None
            previous_number = None
            gap_class = None
        else:
            previous_date, previous_number = dated[target_index - 1]
            gap_class = _gap_class((target_date - previous_date).days)
        probabilities = _position_probabilities(
            previous_number, gap_class, pooled_counts, gap_counts)
        slate = _fano_slates(probabilities)
        actual_probability = math.prod(
            probabilities[position][ord(char) - 48]
            for position, char in enumerate(actual)
        )
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
            "prior_previous_target_date": previous_date.isoformat() if previous_date else None,
            "prior_previous_ticket": previous_number,
            "target_gap_class": gap_class,
            "actual_predictive_probability": actual_probability,
            "prior_position_transition_probabilities": probabilities,
            "candidate_probabilities": slate["candidate_probabilities"],
            "five_ticket_predictive_mass": slate["five_ticket_predictive_mass"],
            "punctured_line": slate["punctured_line"],
            "selected_points": slate["selected_points"],
        })

        # Update transitions only after the current target is scored.
        if previous_number is not None:
            for position, (old_char, new_char) in enumerate(zip(previous_number, actual)):
                old_digit = ord(old_char) - 48
                new_digit = ord(new_char) - 48
                pooled_counts[position][old_digit][new_digit] += 1
                gap_counts[gap_class][position][old_digit][new_digit] += 1
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
        "walk_forward": "gap-conditioned position transitions use only prior draw transitions and known target interval; update occurs after scoring",
        "model_family": "hierarchically smoothed draw-gap-conditioned digit transition model with punctured-Fano decoding",
        "gap_classes": list(GAP_CLASSES),
        "pooled_transition_prior_strength": POOLED_PRIOR_STRENGTH,
        "gap_transition_prior_strength": GAP_PRIOR_STRENGTH,
        "uniform_expected_hits": DRAW_COUNT * TICKET_COUNT / (DIGIT_CARDINALITY ** DIGIT_COUNT),
        "v7": {
            "hits": hits,
            "hit_rate_percent": round(100.0 * hits / DRAW_COUNT, 8),
            "hit_dates": hit_dates,
            "mean_joint_log_loss": round(log_loss_sum / DRAW_COUNT, 8),
            "uniform_log_loss": math.log(DIGIT_CARDINALITY ** DIGIT_COUNT),
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
              f"results-{run_date}-stage-97-gap-transition.json")
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
