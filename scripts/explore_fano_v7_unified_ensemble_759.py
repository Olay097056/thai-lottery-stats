"""Strict prequential ensemble of all current Fano v7 hypothesis families."""
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
import explore_fano_v7_759 as base
import explore_fano_v7_joint_markov_759 as joint
import explore_fano_v7_structural_context_759 as structural
import explore_fano_v7_cyclic_delta_759 as cyclic
import explore_fano_v7_digit_multiset_759 as multiset
import explore_fano_v7_digit_hazard_759 as hazard
import explore_fano_v7_draw_cycle_759 as draw_cycle
import explore_fano_v7_annual_seasonality_759 as annual
import explore_fano_v7_online_softmax_759 as online
import explore_fano_v7_bocpd_759 as bocpd
import explore_fano_v7_online_mlp_759 as mlp
import explore_fano_v7_calendar_mlp_759 as calendar_mlp
import explore_fano_v7_recurrent_759 as recurrent
import explore_fano_v7_calendar_recurrent_759 as calendar_recurrent

DRAW_COUNT = 759
MIN_TARGET_HITS = math.ceil(DRAW_COUNT * 0.40)
FAMILIES = (
    ("context-calendar-position", base.MODELS),
    ("within-number-joint-markov", joint.MODELS),
    ("structural-context", structural.MODELS),
    ("cyclic-delta", cyclic.MODELS),
    ("digit-multiset", multiset.MODELS),
    ("digit-hazard", hazard.MODELS),
    ("draw-index-cycle", draw_cycle.MODELS),
    ("annual-seasonality", annual.MODELS),
    ("online-softmax", online.MODELS),
    ("bayesian-changepoint", bocpd.MODELS),
    ("online-mlp", mlp.MODELS),
    ("calendar-mlp", calendar_mlp.MODELS),
    ("online-recurrent-sequence", recurrent.MODELS),
    ("calendar-conditioned-recurrent", calendar_recurrent.MODELS),
)
EXPERTS = tuple((family, model) for family, models in FAMILIES for model in models)
ONLINE_EXPERT_INDICES = [index for index, (family, _) in enumerate(EXPERTS)
                         if family == "online-softmax"]
ONLINE_MODEL_INDEX = {model["name"]: index for index, model in enumerate(online.MODELS)}
BOCPD_EXPERT_INDICES = [index for index, (family, _) in enumerate(EXPERTS)
                        if family == "bayesian-changepoint"]
BOCPD_MODEL_INDEX = {model["name"]: index for index, model in enumerate(bocpd.MODELS)}
MLP_EXPERT_INDICES = [index for index, (family, _) in enumerate(EXPERTS)
                      if family == "online-mlp"]
MLP_MODEL_INDEX = {model["name"]: index for index, model in enumerate(mlp.MODELS)}
CALENDAR_MLP_EXPERT_INDICES = [index for index, (family, _) in enumerate(EXPERTS)
                               if family == "calendar-mlp"]
CALENDAR_MLP_MODEL_INDEX = {model["name"]: index
                            for index, model in enumerate(calendar_mlp.MODELS)}
RECURRENT_EXPERT_INDICES = [index for index, (family, _) in enumerate(EXPERTS)
                            if family == "online-recurrent-sequence"]
RECURRENT_MODEL_INDEX = {model["name"]: index
                         for index, model in enumerate(recurrent.MODELS)}
CALENDAR_RECURRENT_EXPERT_INDICES = [index for index, (family, _) in enumerate(EXPERTS)
                                    if family == "calendar-conditioned-recurrent"]
CALENDAR_RECURRENT_MODEL_INDEX = {model["name"]: index
                                  for index, model in enumerate(calendar_recurrent.MODELS)}


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


def _expert_probabilities(prior, target_index, target_date, online_parameters,
                          changepoint_states, mlp_parameters,
                          calendar_mlp_parameters, recurrent_parameters,
                          calendar_recurrent_parameters):
    outputs = []
    mlp_aux = [None] * len(mlp.MODELS)
    calendar_mlp_aux = [None] * len(calendar_mlp.MODELS)
    recurrent_aux = [None] * len(recurrent.MODELS)
    calendar_recurrent_aux = [None] * len(calendar_recurrent.MODELS)
    for family, model in EXPERTS:
        if family == "context-calendar-position":
            probabilities = base._fit_model(prior, target_date, model)
        elif family == "within-number-joint-markov":
            chain = joint._fit_chain(prior, model)
            probabilities = joint._marginals(chain)
        elif family == "structural-context":
            probabilities = structural._fit_structure(prior, model)
        elif family == "cyclic-delta":
            probabilities = cyclic._fit_delta(prior, model)
        elif family == "digit-multiset":
            probabilities = multiset._fit(prior, model)
        elif family == "digit-hazard":
            probabilities = hazard._fit_hazard(prior, model)
        elif family == "draw-index-cycle":
            probabilities = draw_cycle._fit(prior, target_index, model)
        elif family == "annual-seasonality":
            probabilities = annual._fit(prior, target_date, model)
        elif family == "online-softmax":
            features = online._feature_vector(prior, model["lag"])
            model_index = ONLINE_MODEL_INDEX[model["name"]]
            probabilities = [
                online._softmax(features @ online_parameters[model_index][position])
                for position in range(6)
            ]
        elif family == "bayesian-changepoint":
            model_index = BOCPD_MODEL_INDEX[model["name"]]
            probabilities = [
                bocpd._predict_state(changepoint_states[model_index][position], model["alpha"])
                for position in range(6)
            ]
        elif family == "online-mlp":
            model_index = MLP_MODEL_INDEX[model["name"]]
            features = online._feature_vector(prior, model["lag"])
            hidden, probabilities = mlp._forward(mlp_parameters[model_index], features)
            mlp_aux[model_index] = (features, hidden, probabilities)
        elif family == "calendar-mlp":
            model_index = CALENDAR_MLP_MODEL_INDEX[model["name"]]
            features = calendar_mlp._feature_vector(prior, model["lag"], target_date)
            hidden, probabilities = calendar_mlp._forward(
                calendar_mlp_parameters[model_index], features
            )
            calendar_mlp_aux[model_index] = (features, hidden, probabilities)
        elif family == "online-recurrent-sequence":
            model_index = RECURRENT_MODEL_INDEX[model["name"]]
            hidden, probabilities, states = recurrent._forward(
                recurrent_parameters[model_index], prior, model["window"]
            )
            recurrent_aux[model_index] = (hidden, probabilities, states)
        elif family == "calendar-conditioned-recurrent":
            model_index = CALENDAR_RECURRENT_MODEL_INDEX[model["name"]]
            hidden, output_features, probabilities, states = calendar_recurrent._forward(
                calendar_recurrent_parameters[model_index], prior, model["window"], target_date
            )
            calendar_recurrent_aux[model_index] = (
                hidden, output_features, probabilities, states
            )
        else:
            raise ValueError(f"unknown v7 expert family: {family}")
        outputs.append(probabilities)
    return outputs, mlp_aux, calendar_mlp_aux, recurrent_aux, calendar_recurrent_aux


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
        raise RuntimeError("Fano unified ensemble must contain five distinct candidates")
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
    log_weights = [0.0] * len(EXPERTS)
    online_parameters = [
        np.zeros((6, 1 + model["lag"] * 60, 10), dtype=np.float64)
        for model in online.MODELS
    ]
    changepoint_states = [[None] * 6 for _ in bocpd.MODELS]
    mlp_parameters = [
        mlp._new_parameters(model, 20261015 + index)
        for index, model in enumerate(mlp.MODELS)
    ]
    calendar_mlp_parameters = [
        calendar_mlp._new_parameters(model, 20261115 + index)
        for index, model in enumerate(calendar_mlp.MODELS)
    ]
    recurrent_parameters = [
        recurrent._new_parameters(model, 20261215 + index)
        for index, model in enumerate(recurrent.MODELS)
    ]
    calendar_recurrent_parameters = [
        calendar_recurrent._new_parameters(model, 20261315 + index)
        for index, model in enumerate(calendar_recurrent.MODELS)
    ]
    hits = 0
    hit_dates = []
    loss_sum = 0.0
    mass_sum = 0.0
    forecasts = []
    family_model_counts = {family: len(models) for family, models in FAMILIES}
    total_weight_history = []

    for target_index, (target_date, actual) in enumerate(dated):
        prior = dated[:target_index]
        expert_predictions, mlp_aux, calendar_mlp_aux, recurrent_aux, calendar_recurrent_aux = _expert_probabilities(
            prior, target_index, target_date, online_parameters, changepoint_states,
            mlp_parameters, calendar_mlp_parameters, recurrent_parameters,
            calendar_recurrent_parameters
        )
        weights = _normalize(log_weights)
        mixture = [
            [sum(weights[index] * expert_predictions[index][pos][digit]
                 for index in range(len(EXPERTS))) for digit in range(10)]
            for pos in range(6)
        ]
        selection = _best_fano_codebook(mixture)
        hit = actual in selection["numbers"]
        hits += int(hit)
        if hit:
            hit_dates.append(target_date.isoformat())
        loss = _log_loss(mixture, actual)
        loss_sum += loss
        mass_sum += selection["mass"]
        expert_losses = [_log_loss(probabilities, actual)
                         for probabilities in expert_predictions]
        family_weight = {}
        for index, (family, _) in enumerate(EXPERTS):
            family_weight[family] = family_weight.get(family, 0.0) + weights[index]
        forecasts.append({
            "target_date": target_date.isoformat(),
            "prior_valid_draws": len(prior),
            "actual": actual,
            "candidates": selection["numbers"],
            "hit": hit,
            "five_candidate_probability_mass": selection["mass"],
            "log_loss": loss,
            "top_expert_weights_before_target": sorted(
                ((EXPERTS[index][0] + ":" + EXPERTS[index][1]["name"], weights[index])
                 for index in range(len(EXPERTS))), key=lambda row: -row[1]
            )[:10],
            "family_weights_before_target": family_weight,
            "punctured_line": selection["punctured_line"],
            "omitted_points": selection["omitted_points"],
        })
        # Update expert weights only after scoring the current target.
        log_weights = [log_weights[index] - expert_losses[index]
                       for index in range(len(EXPERTS))]
        actual_digits = [ord(char) - 48 for char in actual]
        for online_index, expert_index in enumerate(ONLINE_EXPERT_INDICES):
            model = online.MODELS[online_index]
            features = online._feature_vector(prior, model["lag"])
            learning_rate = model["learning_rate"]
            for position, digit in enumerate(actual_digits):
                gradient = -expert_predictions[expert_index][position].copy()
                gradient[digit] += 1.0
                online_parameters[online_index][position] *= 1.0 - learning_rate * model["l2"]
                online_parameters[online_index][position] += (
                    learning_rate * np.outer(features, gradient)
                )
        for local_index, expert_index in enumerate(BOCPD_EXPERT_INDICES):
            model = bocpd.MODELS[local_index]
            for position, digit in enumerate(actual_digits):
                changepoint_states[local_index][position] = bocpd._update_state(
                    changepoint_states[local_index][position], digit,
                    model["hazard"], model["alpha"]
                )
        for local_index, expert_index in enumerate(MLP_EXPERT_INDICES):
            features, hidden, predictions = mlp_aux[local_index]
            mlp._update(mlp_parameters[local_index], features, hidden, predictions,
                        actual_digits, mlp.MODELS[local_index])
        for local_index, expert_index in enumerate(CALENDAR_MLP_EXPERT_INDICES):
            features, hidden, predictions = calendar_mlp_aux[local_index]
            calendar_mlp._update(
                calendar_mlp_parameters[local_index], features, hidden, predictions,
                actual_digits, calendar_mlp.MODELS[local_index]
            )
        for local_index, expert_index in enumerate(RECURRENT_EXPERT_INDICES):
            hidden, predictions, states = recurrent_aux[local_index]
            recurrent._update(recurrent_parameters[local_index], hidden, predictions, states,
                              actual_digits, recurrent.MODELS[local_index])
        for local_index, expert_index in enumerate(CALENDAR_RECURRENT_EXPERT_INDICES):
            hidden, output_features, predictions, states = calendar_recurrent_aux[local_index]
            calendar_recurrent._update(
                calendar_recurrent_parameters[local_index], hidden, output_features,
                predictions, states, actual_digits,
                calendar_recurrent.MODELS[local_index]
            )
        total_weight_history.append({
            family: sum(_normalize(log_weights)[idx] for idx, (name, _) in enumerate(EXPERTS)
                        if name == family)
            for family, _ in FAMILIES
        })
        if (target_index + 1) % 50 == 0:
            print(f"walk-forward: {target_index + 1}/{DRAW_COUNT}, v7={hits} hits",
                  flush=True)

    report = {
        "run_date": datetime.now(astra.THAILAND_TZ).date().isoformat(),
        "draw_count": DRAW_COUNT,
        "date_range": [dated[0][0].isoformat(), dated[-1][0].isoformat()],
        "actuals_sha256": fingerprint,
        "target": "exact six-digit first-prize hit; exactly five distinct predictions per draw",
        "walk_forward": "260 fixed prior-only experts; mixture weights derive only from earlier target outcomes, with each target forecast scored before expert updates",
        "model_family": "unified prequential mixture across contextual/calendar/position-Markov, joint-digit-Markov, structural-context, cyclic-delta, digit-multiset, renewal-hazard, draw-cycle, annual-seasonality, online-softmax, Bayesian changepoint, online-MLP, calendar-MLP, recurrent-sequence and calendar-conditioned recurrent families; punctured Fano codebook selection",
        "expert_count": len(EXPERTS),
        "family_model_counts": family_model_counts,
        "experts": [{"family": family, **dict(model)} for family, model in EXPERTS],
        "uniform_expected_hits": DRAW_COUNT * 5 / 1_000_000,
        "v7": {"hits": hits, "hit_rate_percent": round(100 * hits / DRAW_COUNT, 8),
               "hit_dates": hit_dates,
               "mean_log_loss": round(loss_sum / DRAW_COUNT, 8),
               "mean_five_candidate_probability_mass": round(mass_sum / DRAW_COUNT, 12),
               "forecasts": forecasts},
        "family_weight_after_last_target": total_weight_history[-1] if total_weight_history else {},
        "threshold": {"minimum_hits_for_40_percent": MIN_TARGET_HITS,
                      "met": hits >= MIN_TARGET_HITS},
        "interpretation": "historical research only; all predictions are prior-only, but the hypothesis library was assembled after earlier family results and must not be treated as an untouched independent evaluation",
        "elapsed_seconds": round(time.perf_counter() - started, 3),
    }
    folder = ROOT / ".scratch" / "fano-v7-walk-forward"
    folder.mkdir(parents=True, exist_ok=True)
    output = folder / f"results-{report['run_date']}-stage-30-unified-plus-calendar-recurrent.json"
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"hits": hits,
                      "hit_rate_percent": report["v7"]["hit_rate_percent"],
                      "threshold_met": report["threshold"]["met"],
                      "uniform_expected_hits": report["uniform_expected_hits"],
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
