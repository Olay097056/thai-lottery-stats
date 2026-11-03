"""Prequential Fano v7 experiment with a small online nonlinear MLP."""
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
sys.path.insert(0, str(ROOT / "scripts"))

import astra
import fano
import numpy as np
import explore_fano_v7_online_softmax_759 as online

DRAW_COUNT = 759
MIN_TARGET_HITS = math.ceil(DRAW_COUNT * 0.40)
MODELS = tuple(
    {"name": f"online-mlp-lag-{lag}-hidden-{hidden}-lr-{learning_rate:g}-l2-{l2:g}",
     "lag": lag, "hidden": hidden, "learning_rate": learning_rate, "l2": l2}
    for lag in (1, 2)
    for hidden in (8, 16)
    for learning_rate in (0.01, 0.05)
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


def _softmax(logits):
    logits = logits - np.max(logits)
    values = np.exp(logits)
    return values / np.sum(values)


def _new_parameters(model, seed):
    input_size = 1 + model["lag"] * 60
    hidden = model["hidden"]
    rng = np.random.default_rng(seed)
    first = rng.normal(0.0, 0.04 / math.sqrt(input_size), (6, input_size, hidden))
    first_bias = np.zeros((6, hidden), dtype=np.float64)
    second = rng.normal(0.0, 0.04 / math.sqrt(hidden), (6, hidden, 10))
    second_bias = np.zeros((6, 10), dtype=np.float64)
    return first, first_bias, second, second_bias


def _forward(parameters, features):
    first, first_bias, second, second_bias = parameters
    hidden = np.tanh(np.einsum("f,pfh->ph", features, first) + first_bias)
    probabilities = np.stack([
        _softmax(hidden[position] @ second[position] + second_bias[position])
        for position in range(6)
    ])
    return hidden, probabilities


def _update(parameters, features, hidden, probabilities, actual_digits, model):
    first, first_bias, second, second_bias = parameters
    rate = model["learning_rate"]
    l2 = model["l2"]
    first *= 1.0 - rate * l2
    second *= 1.0 - rate * l2
    for position, digit in enumerate(actual_digits):
        output_gradient = -probabilities[position].copy()
        output_gradient[digit] += 1.0
        hidden_gradient = second[position] @ output_gradient
        preactivation_gradient = hidden_gradient * (1.0 - hidden[position] ** 2)
        second[position] += rate * np.outer(hidden[position], output_gradient)
        second_bias[position] += rate * output_gradient
        first[position] += rate * np.outer(features, preactivation_gradient)
        first_bias[position] += rate * preactivation_gradient


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
        chosen = sorted(words, key=lambda row: (-row[2], row[0]))[:5]
        score = sum(row[2] for row in chosen)
        key = (score, -puncture, tuple(-row[0] for row in chosen))
        if best is None or key > best[0]:
            best = (key, chosen, puncture)
    _, chosen, puncture = best
    numbers = [row[1] for row in chosen]
    if len(numbers) != 5 or len(set(numbers)) != 5:
        raise RuntimeError("Fano MLP codebook must contain five distinct candidates")
    return {"numbers": numbers, "mass": sum(row[2] for row in chosen),
            "punctured_line": puncture + 1,
            "selected_points": [row[0] + 1 for row in chosen]}


def _normalize(log_weights):
    maximum = max(log_weights)
    values = [math.exp(value - maximum) for value in log_weights]
    total = sum(values)
    return [value / total for value in values]


def _log_loss(probabilities, actual):
    return -sum(math.log(probabilities[pos][ord(char) - 48])
                for pos, char in enumerate(actual))


def run():
    started = time.perf_counter()
    dated = _load_draws()
    material = "\n".join(f"{day.isoformat()}|{number}" for day, number in dated).encode("ascii")
    fingerprint = hashlib.sha256(material).hexdigest()
    parameters = [_new_parameters(model, 20261015 + index) for index, model in enumerate(MODELS)]
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
        feature_vectors = [online._feature_vector(prior, model["lag"]) for model in MODELS]
        forward_rows = [_forward(parameters[index], feature_vectors[index])
                        for index in range(len(MODELS))]
        hidden_states = [row[0] for row in forward_rows]
        expert_predictions = [row[1] for row in forward_rows]
        weights = _normalize(log_weights)
        mixture = [[sum(weights[index] * expert_predictions[index][pos][digit]
                        for index in range(len(MODELS))) for digit in range(10)]
                   for pos in range(6)]
        selected = _best_fano_codebook(mixture)
        hit = actual in selected["numbers"]
        hits += int(hit)
        if hit:
            hit_dates.append(target_date.isoformat())
        mixture_loss = _log_loss(mixture, actual)
        loss_sum += mixture_loss
        mass_sum += selected["mass"]
        expert_losses = []
        for index, prediction in enumerate(expert_predictions):
            model_loss = _log_loss(prediction, actual)
            model_hit = actual in _best_fano_codebook(prediction)["numbers"]
            expert_losses.append(model_loss)
            model_losses[index] += model_loss
            model_hits[index] += int(model_hit)
        forecasts.append({
            "target_date": target_date.isoformat(), "prior_valid_draws": target_index,
            "actual": actual, "candidates": selected["numbers"], "hit": hit,
            "five_candidate_probability_mass": selected["mass"],
            "log_loss": mixture_loss,
            "top_expert_weights_before_target": sorted(
                ((MODELS[index]["name"], weights[index]) for index in range(len(MODELS))),
                key=lambda row: -row[1])[:5],
            "punctured_line": selected["punctured_line"],
            "selected_points": selected["selected_points"],
        })
        # Update model and mixture only after evaluating this target.
        log_weights = [log_weights[index] - expert_losses[index]
                       for index in range(len(MODELS))]
        actual_digits = [ord(char) - 48 for char in actual]
        for index, model in enumerate(MODELS):
            _update(parameters[index], feature_vectors[index], hidden_states[index],
                    expert_predictions[index], actual_digits, model)
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
        "target": "exact six-digit first-prize hit; exactly five distinct candidates per draw",
        "walk_forward": "MLP parameters and mixture weights update only after each target is scored; input features are prior one/two complete draws",
        "model_family": "prequential online nonlinear multilayer perceptrons per digit position with Fano incidence codebook output",
        "models": [dict(model) for model in MODELS],
        "uniform_expected_hits": DRAW_COUNT * 5 / 1_000_000,
        "v7": {"hits": hits, "hit_rate_percent": round(100 * hits / DRAW_COUNT, 8),
               "hit_dates": hit_dates,
               "mean_log_loss": round(loss_sum / DRAW_COUNT, 8),
               "mean_five_candidate_probability_mass": round(mass_sum / DRAW_COUNT, 12),
               "forecasts": forecasts},
        "fixed_model_comparisons": fixed_results,
        "threshold_met": hits >= MIN_TARGET_HITS,
        "interpretation": "historical exploration only; nonlinear family was proposed after earlier exploratory runs and is not an untouched holdout",
        "elapsed_seconds": round(time.perf_counter() - started, 3),
    }
    folder = ROOT / ".scratch" / "fano-v7-walk-forward"
    folder.mkdir(parents=True, exist_ok=True)
    output = folder / f"results-{report['run_date']}-stage-20-online-mlp.json"
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
