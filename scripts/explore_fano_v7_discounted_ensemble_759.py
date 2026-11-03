"""Prequential Fano v7 ensemble with online tracking of expert drift."""
from __future__ import annotations

from datetime import datetime
import hashlib
import json
import math
from pathlib import Path
import time

import numpy as np

import explore_fano_v7_unified_ensemble_759 as unified

DRAW_COUNT = unified.DRAW_COUNT
MIN_TARGET_HITS = unified.MIN_TARGET_HITS
HALF_LIVES = (50, 100, 200, 400, None)


def _mix(expert_predictions, expert_weights):
    return [
        [sum(expert_weights[index] * expert_predictions[index][position][digit]
             for index in range(len(unified.EXPERTS)))
         for digit in range(10)]
        for position in range(6)
    ]


def _family_weights(horizon_weights, meta_weights):
    result = {}
    for horizon_index, expert_weights in enumerate(horizon_weights):
        for expert_index, (family, _) in enumerate(unified.EXPERTS):
            result[family] = result.get(family, 0.0) + (
                meta_weights[horizon_index] * expert_weights[expert_index]
            )
    return result


def _combined_expert_weights(horizon_weights, meta_weights):
    return [
        sum(meta_weights[horizon_index] * horizon_weights[horizon_index][expert_index]
            for horizon_index in range(len(HALF_LIVES)))
        for expert_index in range(len(unified.EXPERTS))
    ]


def run():
    started = time.perf_counter()
    dated = unified._load_draws()
    material = "\n".join(f"{day.isoformat()}|{number}" for day, number in dated).encode("ascii")
    fingerprint = hashlib.sha256(material).hexdigest()
    log_weights = [[0.0] * len(unified.EXPERTS) for _ in HALF_LIVES]
    meta_log_weights = [0.0] * len(HALF_LIVES)
    online_parameters = [
        unified.np.zeros((6, 1 + model["lag"] * 60, 10), dtype=unified.np.float64)
        for model in unified.online.MODELS
    ]
    changepoint_states = [[None] * 6 for _ in unified.bocpd.MODELS]
    mlp_parameters = [
        unified.mlp._new_parameters(model, 20261015 + index)
        for index, model in enumerate(unified.mlp.MODELS)
    ]
    calendar_mlp_parameters = [
        unified.calendar_mlp._new_parameters(model, 20261115 + index)
        for index, model in enumerate(unified.calendar_mlp.MODELS)
    ]
    recurrent_parameters = [
        unified.recurrent._new_parameters(model, 20261215 + index)
        for index, model in enumerate(unified.recurrent.MODELS)
    ]
    calendar_recurrent_parameters = [
        unified.calendar_recurrent._new_parameters(model, 20261315 + index)
        for index, model in enumerate(unified.calendar_recurrent.MODELS)
    ]

    hits = 0
    hit_dates = []
    loss_sum = 0.0
    mass_sum = 0.0
    forecasts = []
    for target_index, (target_date, actual) in enumerate(dated):
        prior = dated[:target_index]
        expert_predictions, mlp_aux, calendar_mlp_aux, recurrent_aux, calendar_recurrent_aux = unified._expert_probabilities(
            prior, target_index, target_date, online_parameters, changepoint_states,
            mlp_parameters, calendar_mlp_parameters, recurrent_parameters,
            calendar_recurrent_parameters
        )
        horizon_weights = [unified._normalize(values) for values in log_weights]
        horizon_mixtures = [_mix(expert_predictions, values) for values in horizon_weights]
        meta_weights = unified._normalize(meta_log_weights)
        mixture = [
            [sum(meta_weights[horizon] * horizon_mixtures[horizon][position][digit]
                 for horizon in range(len(HALF_LIVES))) for digit in range(10)]
            for position in range(6)
        ]
        selection = unified._best_fano_codebook(mixture)
        hit = actual in selection["numbers"]
        hits += int(hit)
        if hit:
            hit_dates.append(target_date.isoformat())
        loss = unified._log_loss(mixture, actual)
        loss_sum += loss
        mass_sum += selection["mass"]
        horizon_losses = [unified._log_loss(probabilities, actual)
                          for probabilities in horizon_mixtures]
        meta_log_weights = [meta_log_weights[index] - horizon_losses[index]
                            for index in range(len(HALF_LIVES))]
        expert_losses = [unified._log_loss(probabilities, actual)
                         for probabilities in expert_predictions]
        combined_weights = _combined_expert_weights(horizon_weights, meta_weights)
        forecast_family_weights = _family_weights(horizon_weights, meta_weights)
        forecasts.append({
            "target_date": target_date.isoformat(),
            "prior_valid_draws": len(prior),
            "actual": actual,
            "candidates": selection["numbers"],
            "hit": hit,
            "five_candidate_probability_mass": selection["mass"],
            "log_loss": loss,
            "family_weights_before_target": forecast_family_weights,
            "top_expert_weights_before_target": sorted(
                ((unified.EXPERTS[index][0] + ":" + unified.EXPERTS[index][1]["name"],
                  combined_weights[index])
                 for index in range(len(unified.EXPERTS))), key=lambda row: -row[1]
            )[:10],
            "discount_half_life_weights_before_target": {
                str(horizon): meta_weights[index]
                for index, horizon in enumerate(HALF_LIVES)
            },
            "punctured_line": selection["punctured_line"],
            "omitted_points": selection["omitted_points"],
        })

        # Update expert and horizon weights only after scoring this target.
        for horizon_index, horizon in enumerate(HALF_LIVES):
            discount = 1.0 if horizon is None else 2.0 ** (-1.0 / horizon)
            log_weights[horizon_index] = [
                discount * log_weights[horizon_index][expert_index] - expert_losses[expert_index]
                for expert_index in range(len(unified.EXPERTS))
            ]

        actual_digits = [ord(char) - 48 for char in actual]
        for online_index, expert_index in enumerate(unified.ONLINE_EXPERT_INDICES):
            model = unified.online.MODELS[online_index]
            features = unified.online._feature_vector(prior, model["lag"])
            learning_rate = model["learning_rate"]
            for position, digit in enumerate(actual_digits):
                gradient = -expert_predictions[expert_index][position].copy()
                gradient[digit] += 1.0
                online_parameters[online_index][position] *= 1.0 - learning_rate * model["l2"]
                online_parameters[online_index][position] += (
                    learning_rate * np.outer(features, gradient)
                )
        for local_index, expert_index in enumerate(unified.BOCPD_EXPERT_INDICES):
            model = unified.bocpd.MODELS[local_index]
            for position, digit in enumerate(actual_digits):
                changepoint_states[local_index][position] = unified.bocpd._update_state(
                    changepoint_states[local_index][position], digit,
                    model["hazard"], model["alpha"]
                )
        for local_index, expert_index in enumerate(unified.MLP_EXPERT_INDICES):
            features, hidden, predictions = mlp_aux[local_index]
            unified.mlp._update(mlp_parameters[local_index], features, hidden, predictions,
                                actual_digits, unified.mlp.MODELS[local_index])
        for local_index, expert_index in enumerate(unified.CALENDAR_MLP_EXPERT_INDICES):
            features, hidden, predictions = calendar_mlp_aux[local_index]
            unified.calendar_mlp._update(
                calendar_mlp_parameters[local_index], features, hidden, predictions,
                actual_digits, unified.calendar_mlp.MODELS[local_index]
            )
        for local_index, expert_index in enumerate(unified.RECURRENT_EXPERT_INDICES):
            hidden, predictions, states = recurrent_aux[local_index]
            unified.recurrent._update(recurrent_parameters[local_index], hidden, predictions,
                                      states, actual_digits,
                                      unified.recurrent.MODELS[local_index])
        for local_index, expert_index in enumerate(unified.CALENDAR_RECURRENT_EXPERT_INDICES):
            hidden, output_features, predictions, states = calendar_recurrent_aux[local_index]
            unified.calendar_recurrent._update(
                calendar_recurrent_parameters[local_index], hidden, output_features,
                predictions, states, actual_digits,
                unified.calendar_recurrent.MODELS[local_index]
            )
        if (target_index + 1) % 50 == 0:
            print(f"walk-forward: {target_index + 1}/{DRAW_COUNT}, v7={hits} hits",
                  flush=True)

    report = {
        "run_date": datetime.now(unified.astra.THAILAND_TZ).date().isoformat(),
        "draw_count": DRAW_COUNT,
        "date_range": [dated[0][0].isoformat(), dated[-1][0].isoformat()],
        "actuals_sha256": fingerprint,
        "target": "exact six-digit first-prize hit; exactly five distinct predictions per draw",
        "walk_forward": f"{len(unified.EXPERTS)} prior-only experts; five online discounted-expert mixtures track half-lives 50, 100, 200, 400 and no decay; a prequential meta-mixture selects among them; all weights update after target scoring",
        "model_family": "prequential mixture-of-experts with online discounting to adapt expert weights to possible regime drift; punctured Fano codebook selection",
        "expert_count": len(unified.EXPERTS),
        "family_model_counts": {family: len(models) for family, models in unified.FAMILIES},
        "discount_half_lives": list(HALF_LIVES),
        "experts": [{"family": family, **dict(model)} for family, model in unified.EXPERTS],
        "uniform_expected_hits": DRAW_COUNT * 5 / 1_000_000,
        "v7": {"hits": hits, "hit_rate_percent": round(100 * hits / DRAW_COUNT, 8),
               "hit_dates": hit_dates,
               "mean_log_loss": round(loss_sum / DRAW_COUNT, 8),
               "mean_five_candidate_probability_mass": round(mass_sum / DRAW_COUNT, 12),
               "forecasts": forecasts},
        "meta_weight_after_last_target": {
            str(horizon): weight for horizon, weight in zip(
                HALF_LIVES, unified._normalize(meta_log_weights)
            )
        },
        "threshold": {"minimum_hits_for_40_percent": MIN_TARGET_HITS,
                      "met": hits >= MIN_TARGET_HITS},
        "interpretation": "historical research only; regime-tracking mixture was defined after earlier exploratory results and must not be treated as an untouched independent evaluation",
        "elapsed_seconds": round(time.perf_counter() - started, 3),
    }
    folder = Path(__file__).resolve().parents[1] / ".scratch" / "fano-v7-walk-forward"
    folder.mkdir(parents=True, exist_ok=True)
    output = folder / f"results-{report['run_date']}-stage-24-discounted-ensemble-current-library.json"
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"hits": hits,
                      "hit_rate_percent": report["v7"]["hit_rate_percent"],
                      "threshold_met": report["threshold"]["met"],
                      "uniform_expected_hits": report["uniform_expected_hits"],
                      "mean_log_loss": report["v7"]["mean_log_loss"],
                      "uniform_log_loss": math.log(1_000_000),
                      "expert_count": report["expert_count"],
                      "meta_weight_after_last_target": report["meta_weight_after_last_target"],
                      "data_fingerprint": fingerprint,
                      "result_file": str(output),
                      "elapsed_seconds": report["elapsed_seconds"]},
                     ensure_ascii=False), flush=True)


if __name__ == "__main__":
    run()
