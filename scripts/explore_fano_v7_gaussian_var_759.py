"""Stage 71: continuous ridge VAR(1) with Gaussian digit likelihoods."""
from __future__ import annotations

from datetime import datetime
import hashlib
import json
import math
from pathlib import Path
import sys
import time

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import astra
import fano

DRAW_COUNT = 759
EXPECTED_FINGERPRINT = "c7d1cd0199ee945a9102dab341c7353cf0c76272b05d69bee3b6119d0bed6145"
TICKET_COUNT = 5
DIGIT_CENTER = 4.5
RIDGE_PENALTY = 32.0
VARIANCE_PRIOR_STRENGTH = 20.0
UNIFORM_DIGIT_VARIANCE = 8.25


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


def _gaussian_digit_probabilities(prior_numbers):
    if len(prior_numbers) < 2:
        return [[0.1] * 10 for _ in range(6)], None, None, None

    digit_matrix = np.asarray(
        [[ord(char) - 48 for char in number] for number in prior_numbers],
        dtype=np.float64,
    )
    centered = digit_matrix - DIGIT_CENTER
    source = centered[:-1]
    target = centered[1:]
    design = np.column_stack((np.ones(len(source), dtype=np.float64), source))
    gram = design.T @ design
    penalty = np.diag([0.0] + [RIDGE_PENALTY] * 6)
    system = gram + penalty
    coefficients = np.linalg.solve(system, design.T @ target)
    current = np.concatenate(([1.0], centered[-1]))
    mean = current @ coefficients + DIGIT_CENTER

    residuals = target - design @ coefficients
    variance = ((np.sum(residuals * residuals, axis=0)
                 + VARIANCE_PRIOR_STRENGTH * UNIFORM_DIGIT_VARIANCE)
                / (len(source) + VARIANCE_PRIOR_STRENGTH))
    leverage = float(current @ np.linalg.solve(system, current))
    predictive_variance = variance * (1.0 + max(0.0, leverage))

    probabilities = []
    for position in range(6):
        scores = [
            -0.5 * (digit - mean[position]) ** 2
            / max(float(predictive_variance[position]), 1e-12)
            for digit in range(10)
        ]
        maximum = max(scores)
        masses = [math.exp(score - maximum) for score in scores]
        total = sum(masses)
        probabilities.append([mass / total for mass in masses])
    return probabilities, mean.tolist(), predictive_variance.tolist(), len(source)


def _fano_slate(probabilities):
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
            mass = math.prod(
                probabilities[position][ord(char) - 48]
                for position, char in enumerate(number)
            )
            words.append((point, number, mass))
        if len({row[1] for row in words}) != 7:
            raise RuntimeError("Every punctured Fano codebook must have seven unique tickets")
        selected = sorted(words, key=lambda row: (-row[2], row[0]))[:TICKET_COUNT]
        codebooks.append((sum(row[2] for row in selected), puncture, selected))
    mass, puncture, selected = min(
        codebooks,
        key=lambda item: (-item[0], item[1], tuple(row[0] for row in item[2])),
    )
    candidates = [row[1] for row in selected]
    if len(candidates) != TICKET_COUNT or len(set(candidates)) != TICKET_COUNT:
        raise RuntimeError("The selected Fano slate must contain five unique tickets")
    return {
        "candidates": candidates,
        "five_ticket_probability_mass": mass,
        "punctured_line": puncture + 1,
        "selected_points": [row[0] + 1 for row in selected],
    }


def run():
    started = time.perf_counter()
    dated, fingerprint = _load_draws()
    prior_numbers = []
    forecasts = []
    hits = 0
    hit_dates = []
    log_loss_sum = 0.0
    mass_sum = 0.0

    for target_index, (target_date, actual) in enumerate(dated):
        probabilities, mean, variance, transition_count = (
            _gaussian_digit_probabilities(prior_numbers)
        )
        slate = _fano_slate(probabilities)
        loss = -sum(math.log(max(probabilities[position][ord(char) - 48], 1e-300))
                    for position, char in enumerate(actual))
        log_loss_sum += loss
        mass_sum += slate["five_ticket_probability_mass"]
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
            "prior_transition_count": transition_count,
            "predicted_digit_means": mean,
            "predictive_digit_variances": variance,
            "digit_probabilities": probabilities,
            "five_ticket_probability_mass": slate["five_ticket_probability_mass"],
            "punctured_line": slate["punctured_line"],
            "selected_points": slate["selected_points"],
        })

        # Append the current outcome only after its probabilities and slate exist.
        prior_numbers.append(actual)
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
        "walk_forward": "VAR coefficients and residual variances use only prior adjacent-draw pairs; the current actual is appended only after forecast scoring",
        "model_family": "ridge-regularized continuous six-output VAR(1) with Gaussian digit likelihoods and punctured Fano decoding",
        "ridge_penalty_on_lags": RIDGE_PENALTY,
        "variance_prior_strength": VARIANCE_PRIOR_STRENGTH,
        "uniform_digit_variance": UNIFORM_DIGIT_VARIANCE,
        "uniform_expected_hits": DRAW_COUNT * TICKET_COUNT / 1_000_000,
        "v7": {
            "hits": hits,
            "hit_rate_percent": round(100.0 * hits / DRAW_COUNT, 8),
            "hit_dates": hit_dates,
            "mean_digit_log_loss": round(log_loss_sum / DRAW_COUNT, 8),
            "uniform_log_loss": math.log(1_000_000),
            "mean_five_ticket_probability_mass": round(mass_sum / DRAW_COUNT, 12),
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
              f"results-{run_date}-stage-71-gaussian-var.json")
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({
        "hits": hits,
        "hit_dates": hit_dates,
        "minimum_hits": 10,
        "met": hits >= 10,
        "mean_digit_log_loss": report["v7"]["mean_digit_log_loss"],
        "uniform_log_loss": report["v7"]["uniform_log_loss"],
        "data_fingerprint": fingerprint,
        "result_file": str(output),
        "elapsed_seconds": report["elapsed_seconds"],
    }, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    run()
