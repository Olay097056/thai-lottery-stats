"""Strict walk-forward experiment for a contextual Bayesian Fano v7 family.

Each forecast uses up to five distinct six-digit Fano codewords and only valid
first-prize outcomes strictly before its target. Hyperparameter model weights
are updated online from earlier targets' predictive likelihoods.
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
MIN_TARGET_HITS = math.ceil(DRAW_COUNT * 0.40)
MAX_TARGET_HITS = math.floor(DRAW_COUNT * 0.50)
HALF_LIVES = (None, 120)
SIMILARITY_STRENGTHS = (0.0, 0.5, 1.0, 2.0)
SHRINKAGE_STRENGTHS = (10.0, 50.0)
CONTEXT_MODELS = tuple(
    {
        "name": f"context-beta-{beta:g}-hl-{half_life or 'all'}-alpha-{alpha:g}",
        "kind": "context",
        "beta": beta,
        "half_life": half_life,
        "alpha": alpha,
    }
    for beta in SIMILARITY_STRENGTHS
    for half_life in HALF_LIVES
    for alpha in SHRINKAGE_STRENGTHS
)
CALENDAR_FEATURES = ("draw-slot", "month", "weekday", "month-slot")
CALENDAR_MODELS = tuple(
    {
        "name": f"calendar-{feature}-hl-{half_life or 'all'}-alpha-{alpha:g}",
        "kind": "calendar",
        "feature": feature,
        "half_life": half_life,
        "alpha": alpha,
    }
    for feature in CALENDAR_FEATURES
    for half_life in HALF_LIVES
    for alpha in SHRINKAGE_STRENGTHS
)
TRANSITION_MODELS = tuple(
    {
        "name": f"position-markov-order-{order}-hl-{half_life or 'all'}-alpha-{alpha:g}",
        "kind": "position-markov",
        "order": order,
        "half_life": half_life,
        "alpha": alpha,
    }
    for order in (1, 2)
    for half_life in HALF_LIVES
    for alpha in SHRINKAGE_STRENGTHS
)
MODELS = CONTEXT_MODELS + CALENDAR_MODELS + TRANSITION_MODELS


def _load_draws():
    history = astra.load_existing_astra_history()
    dated = []
    for row in history:
        values = astra._category_values(row, "prize1", 6)
        if values is None:
            continue
        dated.append((astra._history_date(row["date"]), values[0]))
    dated.sort()
    if len(dated) != DRAW_COUNT:
        raise RuntimeError(f"Expected {DRAW_COUNT} valid first-prize draws, found {len(dated)}")
    if len({draw_date for draw_date, _ in dated}) != len(dated):
        raise RuntimeError("Valid first-prize history contains duplicate dates")
    if any(len(number) != 6 or not number.isascii() or not number.isdigit()
           for _, number in dated):
        raise RuntimeError("A first-prize result is not a six-character ASCII number")
    if any(dated[index - 1][0] >= dated[index][0] for index in range(1, len(dated))):
        raise RuntimeError("First-prize history is not strictly chronological")
    return dated


def _age_weight(age, half_life):
    return 1.0 if half_life is None else 2.0 ** (-age / half_life)


def _fit_contextual_model(prior, model):
    """Fit next-draw digit marginals from similar historical preceding draws."""
    position_counts = [[0.0] * 10 for _ in range(6)]
    total_weight = 0.0
    for index, (_, number) in enumerate(prior):
        age = len(prior) - index - 1
        weight = _age_weight(age, model["half_life"])
        total_weight += weight
        for position, char in enumerate(number):
            position_counts[position][ord(char) - 48] += weight
    global_prior = [
        [(position_counts[position][digit] + 1.0) / (total_weight + 10.0)
         for digit in range(10)]
        for position in range(6)
    ]

    local_counts = [[0.0] * 10 for _ in range(6)]
    local_weight = 0.0
    if len(prior) >= 2:
        context = prior[-1][1]
        for index in range(len(prior) - 1):
            source, following = prior[index][1], prior[index + 1][1]
            age = len(prior) - index - 2
            recency = _age_weight(age, model["half_life"])
            matches = sum(left == right for left, right in zip(source, context))
            similarity = math.exp(model["beta"] * matches)
            weight = recency * similarity
            local_weight += weight
            for position, char in enumerate(following):
                local_counts[position][ord(char) - 48] += weight

    alpha = model["alpha"]
    probabilities = []
    for position in range(6):
        denominator = local_weight + alpha
        probabilities.append([
            (local_counts[position][digit] + alpha * global_prior[position][digit]) / denominator
            for digit in range(10)
        ])
    return probabilities


def _calendar_key(draw_date, feature):
    if feature == "draw-slot":
        return "early" if draw_date.day <= 15 else "late"
    if feature == "month":
        return draw_date.month
    if feature == "weekday":
        return draw_date.weekday()
    if feature == "month-slot":
        return (draw_date.month, "early" if draw_date.day <= 15 else "late")
    raise ValueError(f"unknown calendar feature: {feature}")


def _fit_calendar_model(prior, target_date, model):
    """Fit a date-keyed digit distribution with a prior-only global backoff."""
    total_weight = 0.0
    global_counts = [[0.0] * 10 for _ in range(6)]
    conditional_counts = [[0.0] * 10 for _ in range(6)]
    conditional_weight = 0.0
    target_key = _calendar_key(target_date, model["feature"])
    for index, (draw_date, number) in enumerate(prior):
        age = len(prior) - index - 1
        weight = _age_weight(age, model["half_life"])
        total_weight += weight
        matches = _calendar_key(draw_date, model["feature"]) == target_key
        if matches:
            conditional_weight += weight
        for position, char in enumerate(number):
            digit = ord(char) - 48
            global_counts[position][digit] += weight
            if matches:
                conditional_counts[position][digit] += weight

    probabilities = []
    alpha = model["alpha"]
    for position in range(6):
        prior_distribution = [
            (global_counts[position][digit] + 1.0) / (total_weight + 10.0)
            for digit in range(10)
        ]
        denominator = conditional_weight + alpha
        probabilities.append([
            (conditional_counts[position][digit] + alpha * prior_distribution[digit]) / denominator
            for digit in range(10)
        ])
    return probabilities


def _fit_position_markov_model(prior, model):
    """Estimate each next digit from the one- or two-draw positional state."""
    if not prior:
        return [[0.1] * 10 for _ in range(6)]

    counts = [[0.0] * 10 for _ in range(6)]
    weights = [0.0] * 6
    global_counts = [[0.0] * 10 for _ in range(6)]
    global_weight = 0.0
    for index, (_, number) in enumerate(prior):
        age = len(prior) - index - 1
        weight = _age_weight(age, model["half_life"])
        global_weight += weight
        for position, char in enumerate(number):
            global_counts[position][ord(char) - 48] += weight
    global_prior = [
        [(global_counts[position][digit] + 1.0) / (global_weight + 10.0)
         for digit in range(10)]
        for position in range(6)
    ]

    order = model["order"]
    transitions = []
    for index in range(order, len(prior)):
        age = len(prior) - index - 1
        recency = _age_weight(age, model["half_life"])
        states_by_position = [
            tuple(ord(prior[source][1][position]) - 48
                  for source in range(index - order, index))
            for position in range(6)
        ]
        transitions.append((states_by_position, prior[index][1], recency))

    for position in range(6):
        current_state = tuple(ord(prior[source][1][position]) - 48
                              for source in range(len(prior) - order, len(prior)))
        for states_by_position, following, recency in transitions:
            if states_by_position[position] == current_state:
                weights[position] += recency
                counts[position][ord(following[position]) - 48] += recency

    alpha = model["alpha"]
    probabilities = []
    for position in range(6):
        denominator = weights[position] + alpha
        probabilities.append([
            (counts[position][digit] + alpha * global_prior[position][digit]) / denominator
            for digit in range(10)
        ])
    return probabilities


def _fit_model(prior, target_date, model):
    if model["kind"] == "context":
        return _fit_contextual_model(prior, model)
    if model["kind"] == "calendar":
        return _fit_calendar_model(prior, target_date, model)
    if model["kind"] == "position-markov":
        return _fit_position_markov_model(prior, model)
    raise ValueError(f"unknown model kind: {model['kind']}")


def _log_loss(probabilities, actual):
    return -sum(math.log(probabilities[position][ord(char) - 48])
                for position, char in enumerate(actual))


def _best_fano_codebook(probabilities):
    rankings = [
        sorted(range(10), key=lambda digit: (-probabilities[position][digit], digit))[:2]
        for position in range(6)
    ]
    best = None
    for puncture in range(7):
        retained_lines = [line for line in range(7) if line != puncture]
        codewords = []
        for point in range(7):
            digits = []
            for position, line in enumerate(retained_lines):
                bit = int(point in fano.FANO_LINES[line])
                digits.append(str(rankings[position][bit]))
            number = "".join(digits)
            mass = math.prod(
                probabilities[position][int(char)] for position, char in enumerate(number)
            )
            codewords.append((number, point, mass))
        for omitted_left in range(7):
            for omitted_right in range(omitted_left + 1, 7):
                chosen = [row for row in codewords
                          if row[1] not in (omitted_left, omitted_right)]
                chosen.sort(key=lambda row: (-row[2], row[1]))
                numbers = [row[0] for row in chosen]
                if len(numbers) != 5 or len(set(numbers)) != 5:
                    raise RuntimeError("Fano v7 codebook must contain five distinct candidates")
                mass = sum(row[2] for row in chosen)
                key = (mass, -puncture, tuple(numbers))
                if best is None or key > best[0]:
                    best = (key, {
                        "numbers": numbers,
                        "mass": mass,
                        "punctured_line": puncture + 1,
                        "omitted_points": [omitted_left + 1, omitted_right + 1],
                        "minimum_hamming_distance": min(
                            sum(a != b for a, b in zip(left, right))
                            for index, left in enumerate(numbers)
                            for right in numbers[index + 1:]
                        ),
                    })
    return best[1]


def _normalize(log_weights):
    maximum = max(log_weights)
    values = [math.exp(value - maximum) for value in log_weights]
    total = sum(values)
    return [value / total for value in values]


def run():
    started = time.perf_counter()
    dated = _load_draws()
    material = "\n".join(f"{day.isoformat()}|{number}" for day, number in dated).encode("ascii")
    actuals_sha256 = hashlib.sha256(material).hexdigest()
    log_weights = [0.0] * len(MODELS)
    model_hits = [0] * len(MODELS)
    model_losses = [0.0] * len(MODELS)
    model_hit_dates = [[] for _ in MODELS]
    forecasts = []
    v7_hits = 0
    v7_hit_dates = []
    v7_loss_sum = 0.0
    probability_mass_sum = 0.0

    for target_index, (target_date, actual) in enumerate(dated):
        prior = dated[:target_index]
        fitted = [_fit_model(prior, target_date, model) for model in MODELS]
        weights = _normalize(log_weights)
        mixture = [
            [sum(weights[index] * fitted[index][position][digit]
                 for index in range(len(MODELS))) for digit in range(10)]
            for position in range(6)
        ]
        candidates = _best_fano_codebook(mixture)
        actual_hit = actual in candidates["numbers"]
        v7_hits += int(actual_hit)
        if actual_hit:
            v7_hit_dates.append(target_date.isoformat())
        loss = _log_loss(mixture, actual)
        v7_loss_sum += loss
        probability_mass_sum += candidates["mass"]

        per_model = []
        for model_index, (model, probabilities) in enumerate(zip(MODELS, fitted)):
            model_loss = _log_loss(probabilities, actual)
            hit = actual in _best_fano_codebook(probabilities)["numbers"]
            model_hits[model_index] += int(hit)
            model_losses[model_index] += model_loss
            if hit:
                model_hit_dates[model_index].append(target_date.isoformat())
            per_model.append({"name": model["name"], "hit": hit, "log_loss": model_loss})

        forecasts.append({
            "target_date": target_date.isoformat(),
            "prior_valid_draws": len(prior),
            "actual": actual,
            "candidates": candidates["numbers"],
            "hit": actual_hit,
            "probability_mass": candidates["mass"],
            "log_loss": loss,
            "model_weights_before_target": {
                model["name"]: weights[index] for index, model in enumerate(MODELS)
            },
            "punctured_line": candidates["punctured_line"],
            "omitted_points": candidates["omitted_points"],
            "minimum_hamming_distance": candidates["minimum_hamming_distance"],
            "fixed_model_results": per_model,
        })

        # Update the prequential mixture only after scoring this target.
        log_weights = [log_weights[index] - per_model[index]["log_loss"]
                       for index in range(len(MODELS))]
        if (target_index + 1) % 100 == 0:
            print(f"walk-forward: {target_index + 1}/{DRAW_COUNT}, v7={v7_hits} hits", flush=True)

    fixed_results = [
        {
            "name": MODELS[index]["name"],
            "hits": model_hits[index],
            "hit_rate_percent": round(100 * model_hits[index] / DRAW_COUNT, 8),
            "mean_log_loss": round(model_losses[index] / DRAW_COUNT, 8),
            "hit_dates": model_hit_dates[index],
        }
        for index in range(len(MODELS))
    ]
    fixed_results.sort(key=lambda row: (-row["hits"], row["mean_log_loss"], row["name"]))
    report = {
        "run_date": datetime.now(astra.THAILAND_TZ).date().isoformat(),
        "draw_count": DRAW_COUNT,
        "date_range": [dated[0][0].isoformat(), dated[-1][0].isoformat()],
        "actuals_sha256": actuals_sha256,
        "target": "exact six-digit first-prize hit; five distinct predictions per draw",
        "walk_forward": "all estimates and online model weights use only valid outcomes strictly before each target; current target is scored before updating weights",
        "prior_valid_draw_policy": "research backtest includes sparse early targets; production formula may require a minimum history",
        "model_family": "prequential mixture of prior-only Bayesian next-draw digit models using Hamming similarity to the latest prior result or known target-date calendar strata, encoded as a punctured Fano codebook",
        "model_count": len(MODELS),
        "models": [dict(model) for model in MODELS],
        "threshold": {
            "minimum_hits_for_40_percent": MIN_TARGET_HITS,
            "maximum_hits_for_50_percent": MAX_TARGET_HITS,
            "met": MIN_TARGET_HITS <= v7_hits <= MAX_TARGET_HITS,
        },
        "uniform_expected_hits": DRAW_COUNT * 5 / 1_000_000,
        "v7": {
            "hits": v7_hits,
            "hit_rate_percent": round(100 * v7_hits / DRAW_COUNT, 8),
            "hit_dates": v7_hit_dates,
            "mean_log_loss": round(v7_loss_sum / DRAW_COUNT, 8),
            "mean_five_candidate_probability_mass": round(probability_mass_sum / DRAW_COUNT, 12),
            "forecasts": forecasts,
        },
        "fixed_model_comparisons": fixed_results,
        "interpretation": "historical exploration only; configuration and family were inspected on this sample; not independent validation or evidence of improved odds",
        "elapsed_seconds": round(time.perf_counter() - started, 3),
    }
    folder = ROOT / ".scratch" / "fano-v7-walk-forward"
    folder.mkdir(parents=True, exist_ok=True)
    output_path = folder / f"results-{report['run_date']}-stage-3-context-calendar-and-markov.json"
    output_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({
        "hits": v7_hits,
        "hit_rate_percent": report["v7"]["hit_rate_percent"],
        "threshold_met": report["threshold"]["met"],
        "uniform_expected_hits": report["uniform_expected_hits"],
        "best_fixed_model": fixed_results[0],
        "result_file": str(output_path),
    }, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    run()
