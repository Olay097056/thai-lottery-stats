"""Prequential online-softmax Fano v7 experiment with cross-position context."""
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
    {"name": f"online-softmax-lag-{lag}-lr-{learning_rate:g}-l2-{l2:g}",
     "lag": lag, "learning_rate": learning_rate, "l2": l2}
    for lag in (1, 2)
    for learning_rate in (0.01, 0.05, 0.1)
    for l2 in (0.001, 0.01)
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


def _feature_vector(prior, lag):
    features = np.zeros(1 + lag * 60, dtype=np.float64)
    features[0] = 1.0
    for lag_index in range(lag):
        source_index = len(prior) - 1 - lag_index
        if source_index < 0:
            continue
        number = prior[source_index][1]
        for position, char in enumerate(number):
            offset = 1 + lag_index * 60 + position * 10 + (ord(char) - 48)
            features[offset] = 1.0
    return features


def _softmax(logits):
    logits = logits - np.max(logits)
    values = np.exp(logits)
    return values / np.sum(values)


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
        raise RuntimeError("Fano online-softmax codebook must contain five distinct candidates")
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
    parameters = [np.zeros((6, 1 + model["lag"] * 60, 10), dtype=np.float64)
                  for model in MODELS]
    log_weights = [0.0] * len(MODELS)
    hits = 0
    hit_dates = []
    loss_sum = 0.0
    mass_sum = 0.0
    model_hits = [0] * len(MODELS)
    model_losses = [0.0] * len(MODELS)
    forecasts = []

    for target_index, (target_date, actual) in enumerate(dated):
        prior = dated[:target_index]
        expert_predictions = []
        feature_vectors = []
        for index, model in enumerate(MODELS):
            features = _feature_vector(prior, model["lag"])
            feature_vectors.append(features)
            predictions = []
            for position in range(6):
                predictions.append(_softmax(features @ parameters[index][position]))
            expert_predictions.append(predictions)
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
        mixture_loss = _log_loss(mixture, actual)
        loss_sum += mixture_loss
        mass_sum += selected["mass"]

        expert_losses = []
        for index, (model, prediction) in enumerate(zip(MODELS, expert_predictions)):
            model_loss = _log_loss(prediction, actual)
            expert_losses.append(model_loss)
            model_losses[index] += model_loss
            model_hit = actual in _best_fano_codebook(prediction)["numbers"]
            model_hits[index] += int(model_hit)

        forecasts.append({
            "target_date": target_date.isoformat(), "prior_valid_draws": len(prior),
            "actual": actual, "candidates": selected["numbers"], "hit": hit,
            "five_candidate_probability_mass": selected["mass"],
            "log_loss": mixture_loss,
            "top_expert_weights_before_target": sorted(
                ((MODELS[index]["name"], weights[index]) for index in range(len(MODELS))),
                key=lambda row: -row[1])[:6],
            "punctured_line": selected["punctured_line"],
            "omitted_points": selected["omitted_points"],
        })

        # After scoring the target, update expert weights and each online model.
        log_weights = [log_weights[index] - expert_losses[index]
                       for index in range(len(MODELS))]
        actual_digits = [ord(char) - 48 for char in actual]
        for index, model in enumerate(MODELS):
            features = feature_vectors[index]
            learning_rate = model["learning_rate"]
            l2 = model["l2"]
            for position, digit in enumerate(actual_digits):
                probabilities = expert_predictions[index][position]
                gradient = -probabilities
                gradient[digit] += 1.0
                parameters[index][position] *= 1.0 - learning_rate * l2
                parameters[index][position] += learning_rate * np.outer(features, gradient)
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
        "walk_forward": "online softmax parameters and expert weights update only after each target is scored; inputs are prior one/two complete draws",
        "model_family": "prequential online multinomial softmax per digit position with cross-position one-hot lag features and Fano codebook output",
        "models": [dict(model) for model in MODELS],
        "uniform_expected_hits": DRAW_COUNT * 5 / 1_000_000,
        "v7": {"hits": hits, "hit_rate_percent": round(100 * hits / DRAW_COUNT, 8),
               "hit_dates": hit_dates,
               "mean_log_loss": round(loss_sum / DRAW_COUNT, 8),
               "mean_five_candidate_probability_mass": round(mass_sum / DRAW_COUNT, 12),
               "forecasts": forecasts},
        "fixed_model_comparisons": fixed_results,
        "threshold_met": hits >= MIN_TARGET_HITS,
        "interpretation": "historical exploration only; online predictions are prequential, but learning rates and feature family were proposed after inspecting previous exploratory runs",
        "elapsed_seconds": round(time.perf_counter() - started, 3),
    }
    folder = ROOT / ".scratch" / "fano-v7-walk-forward"
    folder.mkdir(parents=True, exist_ok=True)
    output = folder / f"results-{report['run_date']}-stage-12-online-softmax.json"
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
