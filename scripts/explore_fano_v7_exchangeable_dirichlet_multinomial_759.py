"""Stage 82: exchangeable draw-level Dirichlet-multinomial model.

Retrospective exploratory test of shared latent digit propensity across the
six output places. Every estimate uses only draws before the target.
"""
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
PAIRS_PER_DRAW = DIGIT_COUNT * (DIGIT_COUNT - 1) // 2
NUMBER_SPACE = 1_000_000


def _load_draws():
    dated = []
    for row in astra.load_existing_astra_history():
        values = astra._category_values(row, "prize1", DIGIT_COUNT)
        if values is not None:
            dated.append((astra._history_date(row["date"]), values[0]))
    dated.sort()
    if len(dated) != DRAW_COUNT or len({day for day, _ in dated}) != DRAW_COUNT:
        raise RuntimeError("Expected exactly 759 unique first-prize draws")
    if any(dated[index - 1][0] >= dated[index][0]
           for index in range(1, DRAW_COUNT)):
        raise RuntimeError("First-prize draws are not strictly chronological")
    if any(len(number) != DIGIT_COUNT or not number.isascii() or not number.isdigit()
           for _, number in dated):
        raise RuntimeError("Every first-prize result must remain six ASCII digits")
    material = "\n".join(f"{day.isoformat()}|{number}" for day, number in dated)
    fingerprint = hashlib.sha256(material.encode("ascii")).hexdigest()
    if fingerprint != EXPECTED_FINGERPRINT:
        raise RuntimeError(f"Fixed 759-draw fingerprint changed: {fingerprint}")
    return dated, fingerprint


def _composition(number):
    counts = [0] * DIGIT_CARDINALITY
    for char in number:
        counts[ord(char) - 48] += 1
    return counts


def _pooled_mean(digit_counts):
    total = sum(digit_counts)
    probabilities = [(count + 1.0) / (total + DIGIT_CARDINALITY)
                     for count in digit_counts]
    if not math.isclose(sum(probabilities), 1.0, rel_tol=0.0, abs_tol=1e-12):
        raise RuntimeError("Pooled digit probabilities must sum to one")
    return probabilities


def _concentration(pooled_mean, same_digit_pairs, prior_draws):
    """Estimate Dirichlet concentration from the prior-only collision moment."""
    if prior_draws == 0:
        return math.inf, 0.0, sum(value * value for value in pooled_mean)
    observed_collision = same_digit_pairs / (PAIRS_PER_DRAW * prior_draws)
    iid_collision = sum(value * value for value in pooled_mean)
    residual = (observed_collision - iid_collision) / (1.0 - iid_collision)
    # Under the Dirichlet-multinomial, residual collision probability equals
    # rho=1/(kappa+1); negative sampling estimates map to the iid boundary.
    rho = min(max(residual, 0.0), 1.0 - 1e-12)
    concentration = math.inf if rho == 0.0 else (1.0 / rho) - 1.0
    return concentration, observed_collision, iid_collision


def _log_ticket_probability(number, pooled_mean, concentration):
    counts = _composition(number)
    if math.isinf(concentration):
        return sum(count * math.log(pooled_mean[digit])
                   for digit, count in enumerate(counts))

    numerator = 0.0
    for digit, count in enumerate(counts):
        alpha = concentration * pooled_mean[digit]
        numerator += sum(math.log(alpha + offset) for offset in range(count))
    denominator = sum(math.log(concentration + offset)
                      for offset in range(DIGIT_COUNT))
    return numerator - denominator


def _fano_codebooks(pooled_mean):
    ranked_digits = sorted(range(DIGIT_CARDINALITY),
                           key=lambda digit: (-pooled_mean[digit], digit))
    top_two = ranked_digits[:2]
    codebooks = []
    for puncture in range(7):
        retained_lines = [line for line in range(7) if line != puncture]
        words = []
        for point in range(7):
            number = "".join(
                str(top_two[int(point in fano.FANO_LINES[line])])
                for line in retained_lines
            )
            words.append((point, number))
        if len({number for _, number in words}) != 7:
            raise RuntimeError("Each punctured Fano codebook must have seven unique tickets")
        codebooks.append((puncture, words))
    return codebooks


def _select_slate(codebooks, pooled_mean, concentration):
    scored_codebooks = []
    for puncture, words in codebooks:
        ranked = [
            (point, number,
             math.exp(_log_ticket_probability(number, pooled_mean, concentration)))
            for point, number in words
        ]
        selected = sorted(ranked, key=lambda row: (-row[2], row[0]))[:TICKET_COUNT]
        scored_codebooks.append((sum(row[2] for row in selected), puncture, selected))

    mass, puncture, selected = min(
        scored_codebooks,
        key=lambda item: (-item[0], item[1], tuple(row[0] for row in item[2])),
    )
    candidates = [row[1] for row in selected]
    if len(candidates) != TICKET_COUNT or len(set(candidates)) != TICKET_COUNT:
        raise RuntimeError("The selected slate must have five unique six-digit tickets")
    return {
        "candidates": candidates,
        "punctured_line": puncture + 1,
        "selected_points": [row[0] + 1 for row in selected],
        "candidate_probabilities": [row[2] for row in selected],
        "five_ticket_predictive_mass": mass,
    }


def run():
    started = time.perf_counter()
    dated, fingerprint = _load_draws()
    digit_counts = [0] * DIGIT_CARDINALITY
    same_digit_pairs = 0
    prior_compositions = []
    forecasts = []
    hits = 0
    hit_dates = []
    log_loss_sum = 0.0
    mass_sum = 0.0

    for target_index, (target_date, actual) in enumerate(dated):
        pooled_mean = _pooled_mean(digit_counts)
        concentration, observed_collision, iid_collision = _concentration(
            pooled_mean, same_digit_pairs, target_index)
        codebooks = _fano_codebooks(pooled_mean)
        slate = _select_slate(codebooks, pooled_mean, concentration)

        actual_log_probability = _log_ticket_probability(
            actual, pooled_mean, concentration)
        log_loss_sum -= actual_log_probability
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
            "prior_digit_counts": digit_counts[:],
            "prior_same_digit_pairs": same_digit_pairs,
            "prior_observed_collision_probability": observed_collision,
            "prior_iid_collision_probability": iid_collision,
            "estimated_dirichlet_concentration": (
                None if math.isinf(concentration) else concentration),
            "pooled_digit_mean": pooled_mean,
            "candidate_probabilities": slate["candidate_probabilities"],
            "five_ticket_predictive_mass": slate["five_ticket_predictive_mass"],
            "punctured_line": slate["punctured_line"],
            "selected_points": slate["selected_points"],
            "actual_predictive_probability": math.exp(actual_log_probability),
        })

        # Update pooled frequencies and collision moment only after scoring.
        composition = _composition(actual)
        prior_compositions.append(composition)
        same_digit_pairs += sum(count * (count - 1) // 2 for count in composition)
        for digit, count in enumerate(composition):
            digit_counts[digit] += count

        if (target_index + 1) % 100 == 0:
            print(f"walk-forward: {target_index + 1}/{DRAW_COUNT}, hits={hits}",
                  flush=True)

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
        raise RuntimeError("Reported hits do not match the saved candidate lists")

    run_date = datetime.now(astra.THAILAND_TZ).date().isoformat()
    report = {
        "run_date": run_date,
        "draw_count": DRAW_COUNT,
        "date_range": [dated[0][0].isoformat(), dated[-1][0].isoformat()],
        "actuals_sha256": fingerprint,
        "target": "at least 10 exact six-digit first-prize hits over 759 targets, with five distinct candidates per target",
        "walk_forward": "the pooled digit mean and within-draw collision estimate use only earlier draws; the actual is added after scoring",
        "model_family": "exchangeable draw-level Dirichlet-multinomial model with collision-moment concentration and punctured-Fano decoding",
        "concentration_estimator": "rho=max(0,(observed_pair_collision-iid_pair_collision)/(1-iid_pair_collision)); kappa=1/rho-1, with rho=0 mapped to the iid limit",
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
              f"results-{run_date}-stage-82-exchangeable-dirichlet-multinomial.json")
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
