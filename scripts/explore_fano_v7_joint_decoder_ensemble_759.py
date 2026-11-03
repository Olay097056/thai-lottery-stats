"""Fano codebook from a joint mixture of independent and autoregressive experts."""
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

import numpy as np

import fano
import explore_fano_v7_unified_ensemble_759 as unified
import explore_fano_v7_autoregressive_fano_759 as autoregressive

DRAW_COUNT = unified.DRAW_COUNT
MIN_TARGET_HITS = unified.MIN_TARGET_HITS
BASE_EXPERT_COUNT = len(unified.EXPERTS)
EXPERTS = tuple(unified.EXPERTS) + tuple(
    ("autoregressive-fano-rnn", model) for model in autoregressive.MODELS
)


def _normalize(log_weights):
    maximum = max(log_weights)
    values = [math.exp(value - maximum) for value in log_weights]
    total = sum(values)
    return [value / total for value in values]


def _logsumexp(values):
    maximum = max(values)
    return maximum + math.log(sum(math.exp(value - maximum) for value in values))


def _conditional_rows(base_predictions, autoregressive_parameters,
                      autoregressive_hidden, position, prefix):
    rows = [base_predictions[index][position] for index in range(BASE_EXPERT_COUNT)]
    rows.extend(
        autoregressive._conditional(autoregressive_parameters[index],
                                    autoregressive_hidden[index], position, prefix)[1]
        for index in range(len(autoregressive.MODELS))
    )
    return rows


def _codeword(base_predictions, autoregressive_parameters, autoregressive_hidden,
              initial_log_weights, retained_lines, point):
    prefix = []
    log_prefix_weights = list(initial_log_weights)
    digits = []
    for position, line in enumerate(retained_lines):
        rows = _conditional_rows(base_predictions, autoregressive_parameters,
                                 autoregressive_hidden, position, prefix)
        posterior = _normalize(log_prefix_weights)
        mixed = [sum(posterior[index] * rows[index][digit]
                     for index in range(len(EXPERTS))) for digit in range(10)]
        top_two = sorted(range(10), key=lambda digit: (-mixed[digit], digit))[:2]
        digit = top_two[int(point in fano.FANO_LINES[line])]
        digits.append(digit)
        prefix.append(digit)
        log_prefix_weights = [log_prefix_weights[index] + math.log(rows[index][digit])
                              for index in range(len(EXPERTS))]
    return "".join(str(digit) for digit in digits), math.exp(_logsumexp(log_prefix_weights))


def _best_codebook(base_predictions, autoregressive_parameters,
                   autoregressive_hidden, log_weights):
    normalized = _normalize(log_weights)
    initial_logs = [math.log(max(weight, 1e-300)) for weight in normalized]
    best = None
    for puncture in range(7):
        retained_lines = [line for line in range(7) if line != puncture]
        words = [_codeword(base_predictions, autoregressive_parameters,
                           autoregressive_hidden, initial_logs, retained_lines, point)
                 for point in range(7)]
        if len({number for number, _ in words}) != 7:
            raise RuntimeError("Joint Fano decoder must produce seven unique codewords")
        chosen = sorted(range(7), key=lambda point: (-words[point][1], point))[:5]
        score = sum(words[point][1] for point in chosen)
        key = (score, -puncture, tuple(-point for point in chosen))
        if best is None or key > best[0]:
            best = (key, words, puncture, chosen)
    _, words, puncture, chosen = best
    numbers = [words[point][0] for point in chosen]
    if len(numbers) != 5 or len(set(numbers)) != 5:
        raise RuntimeError("Joint Fano decoder must select five distinct tickets")
    return {"numbers": numbers, "mass": sum(words[point][1] for point in chosen),
            "punctured_line": puncture + 1,
            "selected_points": [point + 1 for point in chosen]}


def _init_base_parameters():
    return {
        "online": [np.zeros((6, 1 + model["lag"] * 60, 10), dtype=np.float64)
                   for model in unified.online.MODELS],
        "changepoint": [[None] * 6 for _ in unified.bocpd.MODELS],
        "mlp": [unified.mlp._new_parameters(model, 20261015 + index)
                for index, model in enumerate(unified.mlp.MODELS)],
        "calendar_mlp": [unified.calendar_mlp._new_parameters(model, 20261115 + index)
                         for index, model in enumerate(unified.calendar_mlp.MODELS)],
        "recurrent": [unified.recurrent._new_parameters(model, 20261215 + index)
                      for index, model in enumerate(unified.recurrent.MODELS)],
        "calendar_recurrent": [
            unified.calendar_recurrent._new_parameters(model, 20261315 + index)
            for index, model in enumerate(unified.calendar_recurrent.MODELS)
        ],
    }


def _update_base(prior, target_date, actual, predictions, aux, parameters):
    mlp_aux, calendar_mlp_aux, recurrent_aux, calendar_recurrent_aux = aux
    actual_digits = [ord(char) - 48 for char in actual]
    for local_index, expert_index in enumerate(unified.ONLINE_EXPERT_INDICES):
        model = unified.online.MODELS[local_index]
        features = unified.online._feature_vector(prior, model["lag"])
        rate = model["learning_rate"]
        for position, digit in enumerate(actual_digits):
            gradient = -predictions[expert_index][position].copy()
            gradient[digit] += 1.0
            parameters["online"][local_index][position] *= 1.0 - rate * model["l2"]
            parameters["online"][local_index][position] += rate * np.outer(features, gradient)
    for local_index, _ in enumerate(unified.BOCPD_EXPERT_INDICES):
        model = unified.bocpd.MODELS[local_index]
        for position, digit in enumerate(actual_digits):
            parameters["changepoint"][local_index][position] = unified.bocpd._update_state(
                parameters["changepoint"][local_index][position], digit,
                model["hazard"], model["alpha"]
            )
    for local_index, expert_index in enumerate(unified.MLP_EXPERT_INDICES):
        features, hidden, probabilities = mlp_aux[local_index]
        unified.mlp._update(parameters["mlp"][local_index], features, hidden,
                            probabilities, actual_digits, unified.mlp.MODELS[local_index])
    for local_index, expert_index in enumerate(unified.CALENDAR_MLP_EXPERT_INDICES):
        features, hidden, probabilities = calendar_mlp_aux[local_index]
        unified.calendar_mlp._update(
            parameters["calendar_mlp"][local_index], features, hidden,
            probabilities, actual_digits, unified.calendar_mlp.MODELS[local_index]
        )
    for local_index, expert_index in enumerate(unified.RECURRENT_EXPERT_INDICES):
        hidden, probabilities, states = recurrent_aux[local_index]
        unified.recurrent._update(parameters["recurrent"][local_index], hidden,
                                  probabilities, states, actual_digits,
                                  unified.recurrent.MODELS[local_index])
    for local_index, expert_index in enumerate(unified.CALENDAR_RECURRENT_EXPERT_INDICES):
        hidden, output_features, probabilities, states = calendar_recurrent_aux[local_index]
        unified.calendar_recurrent._update(
            parameters["calendar_recurrent"][local_index], hidden, output_features,
            probabilities, states, actual_digits,
            unified.calendar_recurrent.MODELS[local_index]
        )


def run():
    started = time.perf_counter()
    dated = unified._load_draws()
    material = "\n".join(f"{day.isoformat()}|{number}" for day, number in dated).encode("ascii")
    fingerprint = hashlib.sha256(material).hexdigest()
    parameters = _init_base_parameters()
    autoregressive_parameters = [
        autoregressive._new_parameters(model, 20261415 + index)
        for index, model in enumerate(autoregressive.MODELS)
    ]
    log_weights = [0.0] * len(EXPERTS)
    hits = 0
    hit_dates = []
    loss_sum = 0.0
    mass_sum = 0.0
    forecasts = []
    for target_index, (target_date, actual) in enumerate(dated):
        prior = dated[:target_index]
        result = unified._expert_probabilities(
            prior, target_index, target_date, parameters["online"],
            parameters["changepoint"], parameters["mlp"],
            parameters["calendar_mlp"], parameters["recurrent"],
            parameters["calendar_recurrent"]
        )
        base_predictions, mlp_aux, calendar_mlp_aux, recurrent_aux, calendar_recurrent_aux = result
        aux = (mlp_aux, calendar_mlp_aux, recurrent_aux, calendar_recurrent_aux)
        ar_contexts = [
            autoregressive._context_forward(autoregressive_parameters[index], prior,
                                            model["window"])
            for index, model in enumerate(autoregressive.MODELS)
        ]
        ar_hidden = [context[0] for context in ar_contexts]
        ar_states = [context[1] for context in ar_contexts]
        all_losses = [unified._log_loss(prediction, actual)
                      for prediction in base_predictions]
        actual_digits = [ord(char) - 48 for char in actual]
        actual_ar_features = []
        actual_ar_probabilities = []
        for index in range(len(autoregressive.MODELS)):
            features, probabilities = autoregressive._teacher_forced(
                autoregressive_parameters[index], ar_hidden[index], actual_digits
            )
            actual_ar_features.append(features)
            actual_ar_probabilities.append(probabilities)
            all_losses.append(-sum(math.log(probabilities[position][digit])
                                   for position, digit in enumerate(actual_digits)))

        weights = _normalize(log_weights)
        selected = _best_codebook(base_predictions, autoregressive_parameters,
                                  ar_hidden, log_weights)
        mixture_loss = -_logsumexp([
            math.log(max(weights[index], 1e-300)) - all_losses[index]
            for index in range(len(EXPERTS))
        ])
        loss_sum += mixture_loss
        mass_sum += selected["mass"]
        hit = actual in selected["numbers"]
        hits += int(hit)
        if hit:
            hit_dates.append(target_date.isoformat())
        family_weights = {}
        for index, (family, _) in enumerate(EXPERTS):
            family_weights[family] = family_weights.get(family, 0.0) + weights[index]
        forecasts.append({
            "target_date": target_date.isoformat(),
            "prior_valid_draws": len(prior),
            "actual": actual,
            "candidates": selected["numbers"],
            "hit": hit,
            "five_candidate_probability_mass": selected["mass"],
            "log_loss": mixture_loss,
            "family_weights_before_target": family_weights,
            "top_expert_weights_before_target": sorted(
                ((EXPERTS[index][0] + ":" + EXPERTS[index][1]["name"], weights[index])
                 for index in range(len(EXPERTS))), key=lambda row: -row[1]
            )[:10],
            "punctured_line": selected["punctured_line"],
            "selected_points": selected["selected_points"],
        })
        log_weights = [log_weights[index] - all_losses[index]
                       for index in range(len(EXPERTS))]
        _update_base(prior, target_date, actual, base_predictions, aux, parameters)
        for index, model in enumerate(autoregressive.MODELS):
            autoregressive._update(autoregressive_parameters[index], ar_states[index],
                                   actual_ar_features[index], actual_ar_probabilities[index],
                                   actual_digits, model)
        if (target_index + 1) % 50 == 0:
            print(f"walk-forward: {target_index + 1}/{DRAW_COUNT}, v7={hits} hits",
                  flush=True)

    report = {
        "run_date": datetime.now(unified.astra.THAILAND_TZ).date().isoformat(),
        "draw_count": DRAW_COUNT,
        "date_range": [dated[0][0].isoformat(), dated[-1][0].isoformat()],
        "actuals_sha256": fingerprint,
        "target": "exact six-digit first-prize hit; exactly five distinct predictions per draw",
        "walk_forward": "a joint prequential Bayesian mixture combines 260 prior-only experts with eight autoregressive digit-sequence experts; Fano codeword construction conditions later digit ranks on each candidate prefix; all parameters and weights update after target scoring",
        "model_family": "joint mixture of independent-digit and autoregressive sequence experts with prefix-conditioned Fano decoding",
        "expert_count": len(EXPERTS),
        "family_model_counts": {
            **{family: len(models) for family, models in unified.FAMILIES},
            "autoregressive-fano-rnn": len(autoregressive.MODELS),
        },
        "experts": ([{"family": family, **dict(model)} for family, model in unified.EXPERTS] +
                    [{"family": "autoregressive-fano-rnn", **dict(model)}
                     for model in autoregressive.MODELS]),
        "uniform_expected_hits": DRAW_COUNT * 5 / 1_000_000,
        "v7": {"hits": hits, "hit_rate_percent": round(100 * hits / DRAW_COUNT, 8),
               "hit_dates": hit_dates,
               "mean_log_loss": round(loss_sum / DRAW_COUNT, 8),
               "mean_five_candidate_probability_mass": round(mass_sum / DRAW_COUNT, 12),
               "forecasts": forecasts},
        "family_weight_after_last_target": forecasts[-1]["family_weights_before_target"] if forecasts else {},
        "threshold": {"minimum_hits_for_40_percent": MIN_TARGET_HITS,
                      "met": hits >= MIN_TARGET_HITS},
        "interpretation": "historical exploratory evaluation; these model families were developed after reviewing other same-sample results, so this does not establish independent generalization",
        "elapsed_seconds": round(time.perf_counter() - started, 3),
    }
    folder = Path(__file__).resolve().parents[1] / ".scratch" / "fano-v7-walk-forward"
    folder.mkdir(parents=True, exist_ok=True)
    output = folder / f"results-{report['run_date']}-stage-32-joint-decoder-ensemble.json"
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"hits": hits,
                      "hit_rate_percent": report["v7"]["hit_rate_percent"],
                      "threshold_met": report["threshold"]["met"],
                      "mean_log_loss": report["v7"]["mean_log_loss"],
                      "uniform_log_loss": math.log(1_000_000),
                      "expert_count": len(EXPERTS),
                      "family_weight_after_last_target": report["family_weight_after_last_target"],
                      "data_fingerprint": fingerprint,
                      "result_file": str(output),
                      "elapsed_seconds": report["elapsed_seconds"]},
                     ensure_ascii=False), flush=True)


if __name__ == "__main__":
    run()
