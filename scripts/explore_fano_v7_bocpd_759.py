"""Prequential Bayesian changepoint Fano v7 experiment for digit regimes."""
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
import numpy as np

DRAW_COUNT = 759
MIN_TARGET_HITS = math.ceil(DRAW_COUNT * 0.40)
MODELS = tuple(
    {"name": f"bocpd-hazard-{hazard:g}-alpha-{alpha:g}",
     "hazard": hazard, "alpha": alpha}
    for hazard in (0.004, 0.01, 0.02, 0.04)
    for alpha in (0.1, 1.0, 10.0)
)


def _load_draws():
    history = astra.load_existing_astra_history()
    dated = []
    for row in history:
        values = astra._category_values(row, "prize1", 6)
        if values is not None:
            dated.append((astra._history_date(row["date"]), values[0]))
    dated.sort()
    if len(dated) != DRAW_COUNT:
        raise RuntimeError(f"Expected {DRAW_COUNT} valid first-prize draws, found {len(dated)}")
    if len({day for day, _ in dated}) != DRAW_COUNT:
        raise RuntimeError("Valid first-prize history contains duplicate dates")
    if any(len(number) != 6 or not number.isascii() or not number.isdigit()
           for _, number in dated):
        raise RuntimeError("A first-prize result is not a six-character ASCII number")
    if any(dated[index - 1][0] >= dated[index][0] for index in range(1, DRAW_COUNT)):
        raise RuntimeError("First-prize history is not strictly chronological")
    return dated


def _predict_state(state, alpha):
    if state is None:
        return np.full(10, 0.1, dtype=np.float64)
    run_probabilities, counts = state
    if len(run_probabilities) == 0:
        return np.full(10, 0.1, dtype=np.float64)
    run_lengths = np.arange(1, len(run_probabilities) + 1, dtype=np.float64)
    predictive = (counts + alpha) / (run_lengths[:, None] + 10.0 * alpha)
    return run_probabilities @ predictive


def _update_state(state, digit, hazard, alpha):
    if state is None:
        counts = np.zeros((1, 10), dtype=np.float64)
        counts[0, digit] = 1.0
        return np.array([1.0], dtype=np.float64), counts

    old_probabilities, old_counts = state
    run_lengths = np.arange(1, len(old_probabilities) + 1, dtype=np.float64)
    likelihood = (old_counts[:, digit] + alpha) / (run_lengths + 10.0 * alpha)
    new_probabilities = np.empty(len(old_probabilities) + 1, dtype=np.float64)
    # Reset state has prior predictive probability 1/10; growth states retain
    # their run-specific categorical posterior predictive likelihood.
    new_probabilities[0] = hazard / 10.0
    new_probabilities[1:] = old_probabilities * (1.0 - hazard) * likelihood
    new_probabilities /= new_probabilities.sum()

    new_counts = np.zeros((len(old_probabilities) + 1, 10), dtype=np.float64)
    new_counts[0, digit] = 1.0
    new_counts[1:] = old_counts
    new_counts[1:, digit] += 1.0
    return new_probabilities, new_counts


def _best_fano_codebook(probabilities):
    rankings = [sorted(range(10), key=lambda digit: (-probabilities[pos][digit], digit))[:2]
                for pos in range(6)]
    best = None
    for puncture in range(7):
        lines = [line for line in range(7) if line != puncture]
        words = []
        for point in range(7):
            number = "".join(str(rankings[pos][int(point in fano.FANO_LINES[line])])
                             for pos, line in enumerate(lines))
            mass = math.prod(probabilities[pos][ord(char) - 48]
                             for pos, char in enumerate(number))
            words.append((point, number, mass))
        for omit_left in range(7):
            for omit_right in range(omit_left + 1, 7):
                chosen = [row for row in words if row[0] not in (omit_left, omit_right)]
                score = sum(row[2] for row in chosen)
                key = (score, -puncture, -omit_left, -omit_right)
                if best is None or key > best[0]:
                    best = (key, chosen, puncture, (omit_left, omit_right))
    _, chosen, puncture, omitted = best
    numbers = [row[1] for row in chosen]
    if len(numbers) != 5 or len(set(numbers)) != 5:
        raise RuntimeError("Fano changepoint codebook must contain five distinct candidates")
    return {"numbers": numbers, "mass": sum(row[2] for row in chosen),
            "punctured_line": puncture + 1,
            "omitted_points": [point + 1 for point in omitted]}


def _normalize(log_weights):
    maximum = max(log_weights)
    weights = [math.exp(value - maximum) for value in log_weights]
    total = sum(weights)
    return [weight / total for weight in weights]


def _log_loss(probabilities, actual):
    return -sum(math.log(probabilities[pos][ord(char) - 48])
                for pos, char in enumerate(actual))


def run():
    started = time.perf_counter()
    dated = _load_draws()
    material = "\n".join(f"{day.isoformat()}|{number}" for day, number in dated).encode("ascii")
    fingerprint = hashlib.sha256(material).hexdigest()
    states = [[None] * 6 for _ in MODELS]
    log_weights = [0.0] * len(MODELS)
    hits = 0
    hit_dates = []
    loss_sum = 0.0
    mass_sum = 0.0
    model_hits = [0] * len(MODELS)
    model_losses = [0.0] * len(MODELS)
    forecasts = []

    for target_index, (target_date, actual) in enumerate(dated):
        expert_predictions = [
            [_predict_state(states[index][position], model["alpha"])
             for position in range(6)]
            for index, model in enumerate(MODELS)
        ]
        weights = _normalize(log_weights)
        mixture = [
            [sum(weights[index] * expert_predictions[index][pos][digit]
                 for index in range(len(MODELS))) for digit in range(10)]
            for pos in range(6)
        ]
        selected = _best_fano_codebook(mixture)
        hit = actual in selected["numbers"]
        hits += int(hit)
        if hit:
            hit_dates.append(target_date.isoformat())
        loss = _log_loss(mixture, actual)
        loss_sum += loss
        mass_sum += selected["mass"]
        expert_losses = []
        for index, (model, prediction) in enumerate(zip(MODELS, expert_predictions)):
            model_loss = _log_loss(prediction, actual)
            model_hit = actual in _best_fano_codebook(prediction)["numbers"]
            model_losses[index] += model_loss
            model_hits[index] += int(model_hit)
            expert_losses.append(model_loss)
        forecasts.append({
            "target_date": target_date.isoformat(), "prior_valid_draws": target_index,
            "actual": actual, "candidates": selected["numbers"], "hit": hit,
            "five_candidate_probability_mass": selected["mass"], "log_loss": loss,
            "model_weights_before_target": {
                model["name"]: weights[index] for index, model in enumerate(MODELS)
            },
            "top_expert_weights_before_target": sorted(
                ((model["name"], weights[index]) for index, model in enumerate(MODELS)),
                key=lambda row: -row[1])[:4],
            "punctured_line": selected["punctured_line"],
            "omitted_points": selected["omitted_points"],
        })

        # Score first; then update online weights and changepoint states.
        log_weights = [log_weights[index] - expert_losses[index]
                       for index in range(len(MODELS))]
        digits = [ord(char) - 48 for char in actual]
        for model_index, model in enumerate(MODELS):
            for position, digit in enumerate(digits):
                states[model_index][position] = _update_state(
                    states[model_index][position], digit, model["hazard"], model["alpha"]
                )
        if (target_index + 1) % 100 == 0:
            print(f"walk-forward: {target_index + 1}/{DRAW_COUNT}, v7={hits} hits",
                  flush=True)

    fixed_results = [
        {"name": MODELS[index]["name"], "hits": model_hits[index],
         "hit_rate_percent": round(100 * model_hits[index] / DRAW_COUNT, 8),
         "mean_log_loss": round(model_losses[index] / DRAW_COUNT, 8)}
        for index in range(len(MODELS))
    ]
    fixed_results.sort(key=lambda row: (-row["hits"], row["mean_log_loss"], row["name"]))
    report = {
        "run_date": datetime.now(astra.THAILAND_TZ).date().isoformat(),
        "draw_count": DRAW_COUNT,
        "date_range": [dated[0][0].isoformat(), dated[-1][0].isoformat()],
        "actuals_sha256": fingerprint,
        "target": "exact six-digit first-prize hit; five distinct predictions per draw",
        "walk_forward": "Bayesian online changepoint states and expert weights update only after each target is scored",
        "model_family": "per-position categorical Bayesian online changepoint detection with hazard-rate mixture and Fano codebook selection",
        "models": [dict(model) for model in MODELS],
        "uniform_expected_hits": DRAW_COUNT * 5 / 1_000_000,
        "v7": {"hits": hits, "hit_rate_percent": round(100 * hits / DRAW_COUNT, 8),
               "hit_dates": hit_dates,
               "mean_log_loss": round(loss_sum / DRAW_COUNT, 8),
               "mean_five_candidate_probability_mass": round(mass_sum / DRAW_COUNT, 12),
               "forecasts": forecasts},
        "fixed_model_comparisons": fixed_results,
        "threshold_met": hits >= MIN_TARGET_HITS,
        "interpretation": "historical exploration only; changepoint hazards were proposed after earlier exploratory runs and are not an untouched holdout",
        "elapsed_seconds": round(time.perf_counter() - started, 3),
    }
    folder = ROOT / ".scratch" / "fano-v7-walk-forward"
    folder.mkdir(parents=True, exist_ok=True)
    output = folder / f"results-{report['run_date']}-stage-13-bocpd.json"
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"hits": hits,
                      "hit_rate_percent": report["v7"]["hit_rate_percent"],
                      "threshold_met": report["threshold_met"],
                      "mean_log_loss": report["v7"]["mean_log_loss"],
                      "uniform_log_loss": math.log(1_000_000),
                      "best_fixed_model": fixed_results[0],
                      "data_fingerprint": fingerprint,
                      "result_file": str(output),
                      "elapsed_seconds": report["elapsed_seconds"]},
                     ensure_ascii=False), flush=True)


if __name__ == "__main__":
    run()
