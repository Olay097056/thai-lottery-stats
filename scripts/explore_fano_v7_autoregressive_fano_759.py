"""Prequential Fano codebook with joint autoregressive RNN digit forecasts."""
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
MODELS = tuple(dict(model, name="autoregressive-" + model["name"])
               for model in recurrent.MODELS)
PREFIX_SIZE = 60
BACKPROP_STEPS = recurrent.BACKPROP_STEPS


def _load_draws():
    return recurrent._load_draws()


def _new_parameters(model, seed):
    parameters = recurrent._new_parameters(model, seed)
    hidden = model["hidden"]
    rng = np.random.default_rng(seed + 130363)
    parameters["output"] = rng.normal(
        0.0, 0.04 / math.sqrt(hidden + PREFIX_SIZE),
        (6, hidden + PREFIX_SIZE, 10)
    )
    return parameters


def _context_forward(parameters, prior, window):
    records = prior if window is None else prior[-window:]
    hidden = np.zeros(parameters["hidden_bias"].shape, dtype=np.float64)
    states = []
    for _, number in records:
        features = recurrent._encode(number)
        previous = hidden
        hidden = np.tanh(features @ parameters["input"] +
                         previous @ parameters["recurrent"] + parameters["hidden_bias"])
        states.append((features, previous, hidden))
    return hidden, states[-BACKPROP_STEPS:]


def _prefix_features(hidden, prefix):
    encoded = np.zeros(PREFIX_SIZE, dtype=np.float64)
    for position, digit in enumerate(prefix):
        encoded[position * 10 + digit] = 1.0
    return np.concatenate((hidden, encoded))


def _conditional(parameters, hidden, position, prefix):
    features = _prefix_features(hidden, prefix)
    probabilities = recurrent._softmax(
        features @ parameters["output"][position] + parameters["output_bias"][position]
    )
    return features, probabilities


def _teacher_forced(parameters, hidden, actual_digits):
    prefix = []
    features = []
    probabilities = []
    for position, digit in enumerate(actual_digits):
        encoded, row = _conditional(parameters, hidden, position, prefix)
        features.append(encoded)
        probabilities.append(row)
        prefix.append(digit)
    return features, np.stack(probabilities)


def _update(parameters, states, decoder_features, probabilities, actual_digits, model):
    output_gradient = np.zeros_like(parameters["output"])
    output_bias_gradient = np.zeros_like(parameters["output_bias"])
    hidden_gradient = np.zeros_like(parameters["hidden_bias"])
    hidden_size = hidden_gradient.size
    for position, digit in enumerate(actual_digits):
        gradient = probabilities[position].copy()
        gradient[digit] -= 1.0
        output_gradient[position] = np.outer(decoder_features[position], gradient)
        output_bias_gradient[position] = gradient
        hidden_gradient += parameters["output"][position, :hidden_size, :] @ gradient

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


def _normalize(log_values):
    maximum = max(log_values)
    values = [math.exp(value - maximum) for value in log_values]
    total = sum(values)
    return [value / total for value in values]


def _logsumexp(values):
    maximum = max(values)
    return maximum + math.log(sum(math.exp(value - maximum) for value in values))


def _codeword(parameters, hidden, initial_log_weights, retained_lines, point):
    prefix = []
    log_prefix_weights = list(initial_log_weights)
    codeword = []
    for position, line in enumerate(retained_lines):
        rows = [_conditional(parameters[index], hidden[index], position, prefix)[1]
                for index in range(len(MODELS))]
        posterior = _normalize(log_prefix_weights)
        mixture = [sum(posterior[index] * rows[index][digit]
                       for index in range(len(MODELS))) for digit in range(10)]
        rankings = sorted(range(10), key=lambda digit: (-mixture[digit], digit))[:2]
        digit = rankings[int(point in fano.FANO_LINES[line])]
        codeword.append(digit)
        prefix.append(digit)
        log_prefix_weights = [log_prefix_weights[index] + math.log(rows[index][digit])
                              for index in range(len(MODELS))]
    number = "".join(str(digit) for digit in codeword)
    mass = math.exp(_logsumexp(log_prefix_weights))
    return number, mass


def _best_fano_codebook(parameters, hidden, log_weights):
    initial = _normalize(log_weights)
    initial_logs = [math.log(max(value, 1e-300)) for value in initial]
    best = None
    for puncture in range(7):
        retained_lines = [line for line in range(7) if line != puncture]
        words = [_codeword(parameters, hidden, initial_logs, retained_lines, point)
                 for point in range(7)]
        if len({number for number, _ in words}) != 7:
            raise RuntimeError("Autoregressive Fano codewords must be unique")
        chosen = sorted(range(7), key=lambda point: (-words[point][1], point))[:5]
        score = sum(words[point][1] for point in chosen)
        key = (score, -puncture, tuple(-point for point in chosen))
        if best is None or key > best[0]:
            best = (key, words, puncture, chosen)
    _, words, puncture, chosen = best
    numbers = [words[point][0] for point in chosen]
    if len(numbers) != 5 or len(set(numbers)) != 5:
        raise RuntimeError("Autoregressive Fano must produce five distinct tickets")
    return {"numbers": numbers, "mass": sum(words[point][1] for point in chosen),
            "punctured_line": puncture + 1,
            "selected_points": [point + 1 for point in chosen]}


def _expert_loss(parameters, hidden, actual_digits):
    _, probabilities = _teacher_forced(parameters, hidden, actual_digits)
    loss = -sum(math.log(probabilities[position][digit])
                for position, digit in enumerate(actual_digits))
    return loss, probabilities


def run():
    started = time.perf_counter()
    dated = _load_draws()
    material = "\n".join(f"{day.isoformat()}|{number}" for day, number in dated).encode("ascii")
    fingerprint = hashlib.sha256(material).hexdigest()
    parameters = [_new_parameters(model, 20261415 + index) for index, model in enumerate(MODELS)]
    log_weights = [0.0] * len(MODELS)
    hits = 0
    hit_dates = []
    loss_sum = 0.0
    mass_sum = 0.0
    expert_loss_sums = [0.0] * len(MODELS)
    forecasts = []
    for target_index, (target_date, actual) in enumerate(dated):
        prior = dated[:target_index]
        contexts = [_context_forward(parameters[index], prior, model["window"])
                    for index, model in enumerate(MODELS)]
        hidden = [context[0] for context in contexts]
        histories = [context[1] for context in contexts]
        weights = _normalize(log_weights)
        selected = _best_fano_codebook(parameters, hidden, log_weights)
        actual_digits = [ord(char) - 48 for char in actual]
        expert_losses = []
        forced_features = []
        forced_probabilities = []
        for index in range(len(MODELS)):
            expert_loss, probabilities = _expert_loss(parameters[index], hidden[index], actual_digits)
            expert_losses.append(expert_loss)
            features, _ = _teacher_forced(parameters[index], hidden[index], actual_digits)
            forced_features.append(features)
            forced_probabilities.append(probabilities)
        mixture_log_probability = _logsumexp([
            math.log(max(weights[index], 1e-300)) - expert_losses[index]
            for index in range(len(MODELS))
        ])
        mixture_loss = -mixture_log_probability
        loss_sum += mixture_loss
        mass_sum += selected["mass"]
        hit = actual in selected["numbers"]
        hits += int(hit)
        if hit:
            hit_dates.append(target_date.isoformat())
        forecasts.append({
            "target_date": target_date.isoformat(),
            "prior_valid_draws": len(prior),
            "actual": actual,
            "candidates": selected["numbers"],
            "hit": hit,
            "five_candidate_probability_mass": selected["mass"],
            "log_loss": mixture_loss,
            "top_expert_weights_before_target": sorted(
                ((MODELS[index]["name"], weights[index]) for index in range(len(MODELS))),
                key=lambda row: -row[1])[:5],
            "family_weights_before_target": {"autoregressive-fano-rnn": 1.0},
            "punctured_line": selected["punctured_line"],
            "selected_points": selected["selected_points"],
        })
        expert_loss_sums = [expert_loss_sums[index] + expert_losses[index]
                            for index in range(len(MODELS))]
        log_weights = [log_weights[index] - expert_losses[index]
                       for index in range(len(MODELS))]
        for index, model in enumerate(MODELS):
            _update(parameters[index], histories[index], forced_features[index],
                    forced_probabilities[index], actual_digits, model)
        if (target_index + 1) % 50 == 0:
            print(f"walk-forward: {target_index + 1}/{DRAW_COUNT}, v7={hits} hits",
                  flush=True)

    fixed_results = [
        {"name": MODELS[index]["name"],
         "mean_log_loss": round(expert_loss_sums[index] / DRAW_COUNT, 8)}
        for index in range(len(MODELS))
    ]
    report = {
        "run_date": datetime.now(astra.THAILAND_TZ).date().isoformat(),
        "draw_count": DRAW_COUNT,
        "date_range": [dated[0][0].isoformat(), dated[-1][0].isoformat()],
        "actuals_sha256": fingerprint,
        "target": "exact six-digit first-prize hit; exactly five distinct predictions per draw",
        "walk_forward": "the temporal recurrent context and autoregressive position-prefix decoder use only prior draws; each six-digit target is scored as a joint sequence before parameters or expert weights update",
        "model_family": "autoregressive recurrent next-digit model with Bayesian model mixture; adaptive Fano point/line rank choices at each digit position",
        "expert_count": len(MODELS),
        "family_model_counts": {"autoregressive-fano-rnn": len(MODELS)},
        "experts": [{"family": "autoregressive-fano-rnn", **dict(model)}
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
        "interpretation": "historical research only; autoregressive Fano decoding is exploratory and requires prospective validation",
        "elapsed_seconds": round(time.perf_counter() - started, 3),
    }
    folder = ROOT / ".scratch" / "fano-v7-walk-forward"
    folder.mkdir(parents=True, exist_ok=True)
    output = folder / f"results-{report['run_date']}-stage-31-autoregressive-fano.json"
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
