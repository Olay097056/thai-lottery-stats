"""Stage 70: pooled exact-ticket renewal hazards with Fano codebooks."""
from __future__ import annotations

from collections import Counter
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
NUMBER_SPACE = 1_000_000
TICKET_COUNT = 5
BASELINE_HAZARD = 1.0 / NUMBER_SPACE
PRIOR_STRENGTH = float(NUMBER_SPACE)
PRIOR_ALPHA = PRIOR_STRENGTH * BASELINE_HAZARD
PRIOR_BETA = PRIOR_STRENGTH * (1.0 - BASELINE_HAZARD)


def _load_draws():
    dated = []
    for row in astra.load_existing_astra_history():
        values = astra._category_values(row, "prize1", 6)
        if values is not None:
            dated.append((astra._history_date(row["date"]), values[0]))
    dated.sort()
    if len(dated) != DRAW_COUNT or len({day for day, _ in dated}) != DRAW_COUNT:
        raise RuntimeError("Expected exactly 759 unique first-prize draws")
    if any(dated[index - 1][0] >= dated[index][0]
           for index in range(1, DRAW_COUNT)):
        raise RuntimeError("First-prize draws are not strictly chronological")
    if any(len(number) != 6 or not number.isascii() or not number.isdigit()
           for _, number in dated):
        raise RuntimeError("Every first-prize result must remain six ASCII digits")
    material = "\n".join(f"{day.isoformat()}|{number}" for day, number in dated)
    fingerprint = hashlib.sha256(material.encode("ascii")).hexdigest()
    if fingerprint != EXPECTED_FINGERPRINT:
        raise RuntimeError(f"Fixed 759-draw fingerprint changed: {fingerprint}")
    return dated, fingerprint


def _pooled_hazards(prior_numbers, target_index):
    """Estimate ticket return hazards from completed and right-censored spells."""
    last_seen = {}
    gap_events = Counter()
    for index, number in enumerate(prior_numbers):
        previous = last_seen.get(number)
        if previous is not None:
            gap_events[index - previous] += 1
        last_seen[number] = index

    open_age_counts = Counter(
        target_index - 1 - index for index in last_seen.values()
    )
    maximum_age = max(1, target_index)
    open_age_suffix = [0] * (maximum_age + 1)
    running_open_count = 0
    for observed_age in range(maximum_age - 1, -1, -1):
        running_open_count += open_age_counts.get(observed_age, 0)
        open_age_suffix[observed_age] = running_open_count
    completed_at_risk = 0
    hazards = {}
    for age in range(maximum_age, 0, -1):
        completed_at_risk += gap_events.get(age, 0)
        # A censored spell observed through age-1 survived and is at risk now.
        # Shift the right-censored risk set by one draw for this prediction.
        open_at_risk = open_age_suffix[age - 1]
        risk = completed_at_risk + open_at_risk
        events = gap_events.get(age, 0)
        hazard = (events + PRIOR_ALPHA) / (risk + PRIOR_STRENGTH)
        if not 0.0 < hazard < 1.0:
            raise RuntimeError("Smoothed recurrence hazard is invalid")
        hazards[age] = hazard
    return last_seen, hazards, gap_events


def _fano_codebooks(position_counts, target_index):
    probabilities = [
        [(position_counts[position][digit] + 1.0) / (target_index + 10.0)
         for digit in range(10)]
        for position in range(6)
    ]
    top_two = [sorted(range(10), key=lambda digit: (
        -probabilities[position][digit], digit))[:2]
        for position in range(6)]
    codebooks = []
    for puncture in range(7):
        retained_lines = [line for line in range(7) if line != puncture]
        words = []
        for point in range(7):
            number = "".join(
                str(top_two[position][int(point in fano.FANO_LINES[line])])
                for position, line in enumerate(retained_lines)
            )
            words.append((point, number))
        if len({number for _, number in words}) != 7:
            raise RuntimeError("Each Fano codebook must have seven unique tickets")
        codebooks.append((puncture, words))
    return codebooks


def _select_slate(codebooks, last_seen, hazards):
    # Hazard weights are normalized over all one million categories. The
    # unseen categories receive the fixed uniform baseline weight.
    # The target index is attached by the caller as the maximum age in hazards.
    target_index = max(hazards) if hazards else 0
    seen_weights = {
        number: hazards[target_index - last_index]
        for number, last_index in last_seen.items()
    }
    unseen_count = NUMBER_SPACE - len(seen_weights)
    normalizer = sum(seen_weights.values()) + unseen_count * BASELINE_HAZARD
    if normalizer <= 0.0:
        raise RuntimeError("Recurrence weights failed to normalize")

    scored_codebooks = []
    for puncture, words in codebooks:
        ranked = []
        for point, number in words:
            if number in seen_weights:
                raw_weight = seen_weights[number]
                last_age = target_index - last_seen[number]
            else:
                raw_weight = BASELINE_HAZARD
                last_age = None
            probability = raw_weight / normalizer
            ranked.append((point, number, probability, last_age, raw_weight))
        selected = sorted(ranked, key=lambda row: (-row[2], row[0]))[:TICKET_COUNT]
        scored_codebooks.append((sum(row[2] for row in selected), puncture, selected))

    mass, puncture, selected = min(
        scored_codebooks,
        key=lambda item: (-item[0], item[1], tuple(row[0] for row in item[2])),
    )
    candidates = [row[1] for row in selected]
    if len(candidates) != TICKET_COUNT or len(set(candidates)) != TICKET_COUNT:
        raise RuntimeError("The selected slate must contain five unique tickets")
    return {
        "candidates": candidates,
        "punctured_line": puncture + 1,
        "selected_points": [row[0] + 1 for row in selected],
        "candidate_last_seen_ages": [row[3] for row in selected],
        "candidate_raw_hazard_weights": [row[4] for row in selected],
        "candidate_predictive_probabilities": [row[2] for row in selected],
        "five_ticket_predictive_mass": mass,
        "normalizer": sum(
            hazards[target_index - last_index]
            for number, last_index in last_seen.items()
        ) + (NUMBER_SPACE - len(last_seen)) * BASELINE_HAZARD,
    }


def run():
    started = time.perf_counter()
    dated, fingerprint = _load_draws()
    prior_numbers = []
    position_counts = [[0] * 10 for _ in range(6)]
    forecasts = []
    hits = 0
    hit_dates = []
    log_loss_sum = 0.0
    mass_sum = 0.0

    for target_index, (target_date, actual) in enumerate(dated):
        last_seen, hazards, gap_events = _pooled_hazards(prior_numbers, target_index)
        codebooks = _fano_codebooks(position_counts, target_index)

        # Use only the age 1 baseline on the empty-prefix first draw.
        if target_index == 0:
            hazards = {1: BASELINE_HAZARD}
        slate = _select_slate(codebooks, last_seen, hazards)
        if last_seen:
            actual_age = target_index - last_seen[actual] if actual in last_seen else None
        else:
            actual_age = None
        if actual in last_seen:
            actual_weight = hazards[actual_age]
        else:
            actual_weight = BASELINE_HAZARD
        actual_probability = actual_weight / slate["normalizer"]
        if not 0.0 < actual_probability <= 1.0:
            raise RuntimeError("Normalized renewal probability is invalid")
        log_loss_sum -= math.log(actual_probability)
        mass_sum += slate["five_ticket_predictive_mass"]
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
            "actual_last_seen_age": actual_age,
            "actual_prior_gap_event_count_at_age": (
                gap_events.get(actual_age, 0) if actual_age is not None else 0
            ),
            "actual_predictive_probability": actual_probability,
            "candidate_last_seen_ages": slate["candidate_last_seen_ages"],
            "candidate_raw_hazard_weights": slate["candidate_raw_hazard_weights"],
            "candidate_predictive_probabilities": slate["candidate_predictive_probabilities"],
            "five_ticket_predictive_mass": slate["five_ticket_predictive_mass"],
            "punctured_line": slate["punctured_line"],
            "selected_points": slate["selected_points"],
            "risk_set_size": len(last_seen),
            "normalizer": slate["normalizer"],
        })

        prior_numbers.append(actual)
        for position, char in enumerate(actual):
            position_counts[position][ord(char) - 48] += 1

        if (target_index + 1) % 100 == 0:
            print(f"walk-forward: {target_index + 1}/{DRAW_COUNT}, hits={hits}",
                  flush=True)

    recomputed_hits = sum(
        row["actual"] in row["candidates"] for row in forecasts
    )
    expected_dates = [day.isoformat() for day, _ in dated]
    if len(forecasts) != DRAW_COUNT:
        raise RuntimeError("Forecast count must be exactly 759")
    if [row["target_date"] for row in forecasts] != expected_dates:
        raise RuntimeError("Walk-forward forecasts are not chronological")
    if [row["prior_valid_draws"] for row in forecasts] != list(range(DRAW_COUNT)):
        raise RuntimeError("Prior draw counts must run from 0 through 758")
    if any(len(row["candidates"]) != TICKET_COUNT
           or len(set(row["candidates"])) != TICKET_COUNT
           or any(len(number) != 6 or not number.isascii() or not number.isdigit()
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
        "walk_forward": "pooled completed exact-ticket gaps estimate age-specific hazards from prior history only; unseen numbers keep a fixed uniform baseline and all weights are normalized before Fano slate ranking",
        "model_family": "empirical-Bayes pooled age-specific renewal hazard over whole-ticket categories with punctured Fano codebooks",
        "uniform_ticket_baseline_hazard": BASELINE_HAZARD,
        "beta_prior_alpha": PRIOR_ALPHA,
        "beta_prior_beta": PRIOR_BETA,
        "beta_prior_strength": PRIOR_STRENGTH,
        "uniform_expected_hits": DRAW_COUNT * TICKET_COUNT / NUMBER_SPACE,
        "v7": {
            "hits": hits,
            "hit_rate_percent": round(100.0 * hits / DRAW_COUNT, 8),
            "hit_dates": hit_dates,
            "mean_joint_log_loss": round(log_loss_sum / DRAW_COUNT, 8),
            "uniform_log_loss": math.log(NUMBER_SPACE),
            "mean_five_ticket_predictive_mass": round(mass_sum / DRAW_COUNT, 12),
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
              f"results-{run_date}-stage-70-whole-ticket-renewal.json")
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
