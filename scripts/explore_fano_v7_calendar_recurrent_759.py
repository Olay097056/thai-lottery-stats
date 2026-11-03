"""Prequential recurrent Fano v7 with target-date calendar features."""
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
import explore_fano_v7_recurrent_759 as recurrent

DRAW_COUNT = recurrent.DRAW_COUNT
MIN_TARGET_HITS = recurrent.MIN_TARGET_HITS
MODELS = tuple(dict(model, name="calendar-" + model["name"])
               for model in recurrent.MODELS)
CALENDAR_FEATURES = 4
BACKPROP_STEPS = recurrent.BACKPROP_STEPS


def _calendar_features(target_date):
    annual_phase = 2.0 * math.pi * (target_date.timetuple().tm_yday - 1) / 365.2425
    weekly_phase = 2.0 * math.pi * target_date.weekday() / 7.0
    return np.asarray((math.sin(annual_phase), math.cos(annual_phase),
                       math.sin(weekly_phase), math.cos(weekly_phase)), dtype=np.float64)


def _new_parameters(model, seed):
    base = recurrent._new_parameters(model, seed)
    hidden = model["hidden"]
    rng = np.random.default_rng(seed + 104729)
    base["output"] = rng.normal(0.0, 0.04 / math.sqrt(hidden + CALENDAR_FEATURES),
                                (6, hidden + CALENDAR_FEATURES, 10))
    return base


def _forward(parameters, prior, window, target_date):
    records = prior if window is None else prior[-window:]
    hidden = np.zeros(parameters["hidden_bias"].shape, dtype=np.float64)
    states = []
    for _, number in records:
        features = recurrent._encode(number)
        previous = hidden
        hidden = np.tanh(features @ parameters["input"] +
                         previous @ parameters["recurrent"] + parameters["hidden_bias"])
        states.append((features, previous, hidden))
    calendar = _calendar_features(target_date)
    output_features = np.concatenate((hidden, calendar))
    probabilities = np.stack([
        recurrent._softmax(output_features @ parameters["output"][position] +
                           parameters["output_bias"][position])
        for position in range(6)
    ])
    return hidden, output_features, probabilities, states[-BACKPROP_STEPS:]


def _update(parameters, hidden, output_features, probabilities, states, actual_digits, model):
    output_gradient = np.zeros_like(parameters["output"])
    output_bias_gradient = np.zeros_like(parameters["output_bias"])
    hidden_gradient = np.zeros_like(hidden)
    for position, digit in enumerate(actual_digits):
        gradient = probabilities[position].copy()
        gradient[digit] -= 1.0
        output_gradient[position] = np.outer(output_features, gradient)
        output_bias_gradient[position] = gradient
        hidden_gradient += parameters["output"][position, :hidden.size, :] @ gradient

    input_gradient = np.zeros_like(parameters["input"])
    recurrent_gradient = np.zeros_like(parameters["recurrent"])
    hidden_bias_gradient = np.zeros_like(parameters["hidden_bias"])
    for features, previous, state in reversed(states):
        preactivation = hidden_gradient * (1.0 - state ** 2)
        input_gradient += np.outer(features, preactivation)
        recurrent_gradient += np.outer(previous, preactivation)
        hidden_bias_gradient += preactivation
        hidden_gradient = parameters["recurrent"] @ preactivation

    gradients = [input_gradient, recurrent_gradient, hidden_bias_gradient,
                 output_gradient, output_bias_gradient]
    norm = math.sqrt(sum(float(np.sum(gradient ** 2)) for gradient in gradients))
    scale = min(1.0, 1.0 / max(norm, 1e-12))
    rate = model["learning_rate"]
    for key, gradient in zip(("input", "recurrent", "hidden_bias", "output", "output_bias"), gradients):
        parameters[key] -= rate * scale * gradient
    for key in ("input", "recurrent", "output"):
        parameters[key] *= 1.0 - rate * 1e-4


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
        raise RuntimeError("Fano calendar recurrent codebook must contain five distinct candidates")
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
    dated = recurrent._load_draws()
    material = "\n".join(f"{day.isoformat()}|{number}" for day, number in dated).encode("ascii")
    fingerprint = hashlib.sha256(material).hexdigest()
    parameters = [_new_parameters(model, 20261315 + index) for index, model in enumerate(MODELS)]
    log_weights = [0.0] * len(MODELS)
    hits = 0
    hit_dates = []
    loss_sum = 0.0
    mass_sum = 0.0
    model_losses = [0.0] * len(MODELS)
    forecasts = []
    for target_index, (target_date, actual) in enumerate(dated):
        prior = dated[:target_index]
        forward = [_forward(parameters[index], prior, model["window"], target_date)
                   for index, model in enumerate(MODELS)]
        hidden_states = [row[0] for row in forward]
        output_features = [row[1] for row in forward]
        predictions = [row[2] for row in forward]
        histories = [row[3] for row in forward]
        weights = _normalize(log_weights)
        mixture = [
            [sum(weights[index] * predictions[index][position][digit]
                 for index in range(len(MODELS))) for digit in range(10)]
            for position in range(6)
        ]
        selection = _best_fano_codebook(mixture)
        hit = actual in selection["numbers"]
        hits += int(hit)
        if hit:
            hit_dates.append(target_date.isoformat())
        loss = _log_loss(mixture, actual)
        loss_sum += loss
        mass_sum += selection["mass"]
        expert_losses = [_log_loss(prediction, actual) for prediction in predictions]
        model_losses = [model_losses[index] + expert_losses[index]
                        for index in range(len(MODELS))]
        forecasts.append({
            "target_date": target_date.isoformat(),
            "prior_valid_draws": len(prior),
            "actual": actual,
            "candidates": selection["numbers"],
            "hit": hit,
            "five_candidate_probability_mass": selection["mass"],
            "log_loss": loss,
            "top_expert_weights_before_target": sorted(
                ((MODELS[index]["name"], weights[index]) for index in range(len(MODELS))),
                key=lambda row: -row[1])[:5],
            "family_weights_before_target": {"calendar-conditioned-recurrent": 1.0},
            "punctured_line": selection["punctured_line"],
            "selected_points": selection["selected_points"],
        })
        log_weights = [log_weights[index] - expert_losses[index]
                       for index in range(len(MODELS))]
        actual_digits = [ord(char) - 48 for char in actual]
        for index, model in enumerate(MODELS):
            _update(parameters[index], hidden_states[index], output_features[index],
                    predictions[index], histories[index], actual_digits, model)
        if (target_index + 1) % 100 == 0:
            print(f"walk-forward: {target_index + 1}/{DRAW_COUNT}, v7={hits} hits",
                  flush=True)

    fixed_results = [
        {"name": MODELS[index]["name"],
         "mean_log_loss": round(model_losses[index] / DRAW_COUNT, 8)}
        for index in range(len(MODELS))
    ]
    report = {
        "run_date": datetime.now(astra.THAILAND_TZ).date().isoformat(),
        "draw_count": DRAW_COUNT,
        "date_range": [dated[0][0].isoformat(), dated[-1][0].isoformat()],
        "actuals_sha256": fingerprint,
        "target": "exact six-digit first-prize hit; exactly five distinct predictions per draw",
        "walk_forward": "the recurrent state uses only prior winning draws and target calendar features known before the draw; each target is scored before gradient updates",
        "model_family": "online recurrent neural model over prior draw sequence conditioned on annual and weekly calendar features; punctured Fano codebook selection",
        "expert_count": len(MODELS),
        "family_model_counts": {"calendar-conditioned-recurrent": len(MODELS)},
        "experts": [{"family": "calendar-conditioned-recurrent", **dict(model)}
                    for model in MODELS],
        "uniform_expected_hits": DRAW_COUNT * 5 / 1_000_000,
        "v7": {"hits": hits, "hit_rate_percent": round(100 * hits / DRAW_COUNT, 8),
               "hit_dates": hit_dates,
               "mean_log_loss": round(loss_sum / DRAW_COUNT, 8),
               "mean_five_candidate_probability_mass": round(mass_sum / DRAW_COUNT, 12),
               "forecasts": forecasts},
        "fixed_model_comparisons": fixed_results,
        "threshold": {"minimum_hits_for_40_percent": MIN_TARGET_HITS,
                      "met": hits >= MIN_TARGET_HITS},
        "interpretation": "historical research only; calendar-conditioned recurrent model is exploratory and requires prospective validation",
        "elapsed_seconds": round(time.perf_counter() - started, 3),
    }
    folder = ROOT / ".scratch" / "fano-v7-walk-forward"
    folder.mkdir(parents=True, exist_ok=True)
    output = folder / f"results-{report['run_date']}-stage-29-calendar-recurrent.json"
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"hits": hits,
                      "hit_rate_percent": report["v7"]["hit_rate_percent"],
                      "threshold_met": report["threshold"]["met"],
                      "mean_log_loss": report["v7"]["mean_log_loss"],
                      "uniform_log_loss": math.log(1_000_000),
                      "best_fixed_model": min(fixed_results, key=lambda row: row["mean_log_loss"]),
                      "data_fingerprint": fingerprint,
                      "result_file": str(output),
                      "elapsed_seconds": report["elapsed_seconds"]},
                     ensure_ascii=False), flush=True)


if __name__ == "__main__":
    run()
