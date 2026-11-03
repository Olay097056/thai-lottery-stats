"""Walk-forward Fano v7 experiment with higher-order digit-sequence Markov models."""
from __future__ import annotations

from collections import defaultdict
from datetime import datetime
import hashlib
import itertools
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
MODELS = tuple(
    {"name": f"digit-markov-order-{order}-hl-{half_life or 'all'}-alpha-{alpha:g}",
     "order": order, "half_life": half_life, "alpha": alpha}
    for order in (2, 3, 4)
    for half_life in (None, 120)
    for alpha in (5.0, 20.0)
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


def _age_weight(age, half_life):
    return 1.0 if half_life is None else 2.0 ** (-age / half_life)


def _fit(prior, model):
    order = model["order"]
    alpha = model["alpha"]
    total_weight = 0.0
    marginal_counts = [[0.0] * 10 for _ in range(6)]
    digit_rows = []
    for index, (_, number) in enumerate(prior):
        digits = tuple(ord(char) - 48 for char in number)
        weight = _age_weight(len(prior) - index - 1, model["half_life"])
        total_weight += weight
        digit_rows.append((digits, weight))
        for position, digit in enumerate(digits):
            marginal_counts[position][digit] += weight
    base = [
        [(marginal_counts[pos][digit] + 1.0) / (total_weight + 10.0)
         for digit in range(10)]
        for pos in range(6)
    ]
    conditional_tables = []
    for position in range(1, 6):
        context_length = min(order, position)
        counts = defaultdict(lambda: [0.0] * 10)
        totals = defaultdict(float)
        for digits, weight in digit_rows:
            context = digits[position - context_length:position]
            counts[context][digits[position]] += weight
            totals[context] += weight
        table = {}
        for context, row in counts.items():
            denominator = totals[context] + alpha
            table[context] = [
                (row[digit] + alpha * base[position][digit]) / denominator
                for digit in range(10)
            ]
        conditional_tables.append(table)
    return {"order": order, "base": base, "conditional_tables": conditional_tables}


def _transition(model, position, context):
    context_length = min(model["order"], position)
    key = context[-context_length:]
    return model["conditional_tables"][position - 1].get(key, model["base"][position])


def _marginals(model):
    result = [model["base"][0][:]]
    states = {(digit,): probability for digit, probability in enumerate(result[0])
              if probability > 0.0}
    for position in range(1, 6):
        next_states = defaultdict(float)
        output = [0.0] * 10
        for context_state, context_mass in states.items():
            transition = _transition(model, position, context_state)
            for digit, probability in enumerate(transition):
                mass = context_mass * probability
                next_context = (context_state + (digit,))[-model["order"]:]
                next_states[next_context] += mass
                output[digit] += mass
        result.append(output)
        states = next_states
    return result


def _joint_probability(model, number):
    digits = tuple(ord(char) - 48 for char in number)
    probability = model["base"][0][digits[0]]
    for position in range(1, 6):
        context = digits[:position]
        probability *= _transition(model, position, context)[digits[position]]
    return probability


def _joint_loss(model, actual):
    return -math.log(max(_joint_probability(model, actual), 1e-300))


def _mixture_codebook(models, weights):
    model_marginals = [_marginals(model) for model in models]
    marginals = [
        [sum(weights[index] * model_marginals[index][pos][digit]
             for index in range(len(models))) for digit in range(10)]
        for pos in range(6)
    ]
    rankings = [sorted(range(10), key=lambda digit: (-marginals[pos][digit], digit))[:2]
                for pos in range(6)]
    best = None
    for puncture in range(7):
        lines = [line for line in range(7) if line != puncture]
        words = []
        for point in range(7):
            number = "".join(str(rankings[pos][int(point in fano.FANO_LINES[line])])
                             for pos, line in enumerate(lines))
            mass = sum(weights[index] * _joint_probability(model, number)
                       for index, model in enumerate(models))
            words.append((point, number, mass))
        for omitted in itertools.combinations(range(7), 2):
            chosen = [row for row in words if row[0] not in omitted]
            score = sum(row[2] for row in chosen)
            key = (score, -puncture, tuple(-point for point in omitted))
            if best is None or key > best[0]:
                best = (key, chosen, puncture, omitted)
    _, chosen, puncture, omitted = best
    numbers = [row[1] for row in chosen]
    if len(numbers) != 5 or len(set(numbers)) != 5:
        raise RuntimeError("Fano variable-order codebook must contain five distinct candidates")
    return {"numbers": numbers, "mass": sum(row[2] for row in chosen),
            "punctured_line": puncture + 1,
            "omitted_points": [point + 1 for point in omitted]}


def _normalize(log_weights):
    maximum = max(log_weights)
    values = [math.exp(value - maximum) for value in log_weights]
    total = sum(values)
    return [value / total for value in values]


def run():
    started = time.perf_counter()
    dated = _load_draws()
    material = "\n".join(f"{day.isoformat()}|{number}" for day, number in dated).encode("ascii")
    fingerprint = hashlib.sha256(material).hexdigest()
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
        fitted = [_fit(prior, model) for model in MODELS]
        weights = _normalize(log_weights)
        selected = _mixture_codebook(fitted, weights)
        hit = actual in selected["numbers"]
        hits += int(hit)
        if hit:
            hit_dates.append(target_date.isoformat())
        mixture_probability = sum(weights[index] * _joint_probability(model, actual)
                                  for index, model in enumerate(fitted))
        mixture_loss = -math.log(max(mixture_probability, 1e-300))
        loss_sum += mixture_loss
        mass_sum += selected["mass"]
        model_rows = []
        for index, (model, specification) in enumerate(zip(fitted, MODELS)):
            model_loss = _joint_loss(model, actual)
            model_hit = actual in _mixture_codebook([model], [1.0])["numbers"]
            model_losses[index] += model_loss
            model_hits[index] += int(model_hit)
            model_rows.append({"name": specification["name"],
                               "joint_log_loss": model_loss, "hit": model_hit})
        forecasts.append({
            "target_date": target_date.isoformat(), "prior_valid_draws": len(prior),
            "actual": actual, "candidates": selected["numbers"], "hit": hit,
            "five_candidate_joint_probability_mass": selected["mass"],
            "joint_log_loss": mixture_loss,
            "model_weights_before_target": {
                model["name"]: weights[index] for index, model in enumerate(MODELS)
            },
            "punctured_line": selected["punctured_line"],
            "omitted_points": selected["omitted_points"],
        })
        log_weights = [log_weights[index] - model_rows[index]["joint_log_loss"]
                       for index in range(len(MODELS))]
        if (target_index + 1) % 100 == 0:
            print(f"walk-forward: {target_index + 1}/{DRAW_COUNT}, v7={hits} hits",
                  flush=True)

    fixed_results = [
        {"name": MODELS[index]["name"], "hits": model_hits[index],
         "hit_rate_percent": round(100 * model_hits[index] / DRAW_COUNT, 8),
         "mean_joint_log_loss": round(model_losses[index] / DRAW_COUNT, 8)}
        for index in range(len(MODELS))
    ]
    fixed_results.sort(key=lambda row: (-row["hits"], row["mean_joint_log_loss"], row["name"]))
    report = {
        "run_date": datetime.now(astra.THAILAND_TZ).date().isoformat(),
        "draw_count": DRAW_COUNT,
        "date_range": [dated[0][0].isoformat(), dated[-1][0].isoformat()],
        "actuals_sha256": fingerprint,
        "target": "exact six-digit first-prize hit; exactly five distinct candidates per draw",
        "walk_forward": "orders 2-4 use only digits to the left of each target digit within previously observed numbers; model weights update after each draw is scored",
        "model_family": "prequential Bayesian variable-order Markov models over six-digit strings; candidate probabilities assembled as Fano-plane incidence codewords",
        "models": [dict(model) for model in MODELS],
        "uniform_expected_hits": DRAW_COUNT * 5 / 1_000_000,
        "v7": {"hits": hits, "hit_rate_percent": round(100 * hits / DRAW_COUNT, 8),
               "hit_dates": hit_dates,
               "mean_joint_log_loss": round(loss_sum / DRAW_COUNT, 8),
               "mean_five_candidate_probability_mass": round(mass_sum / DRAW_COUNT, 12),
               "forecasts": forecasts},
        "fixed_model_comparisons": fixed_results,
        "threshold_met": hits >= MIN_TARGET_HITS,
        "interpretation": "historical exploration only; high-order family was proposed after earlier exploratory runs and is not an untouched holdout",
        "elapsed_seconds": round(time.perf_counter() - started, 3),
    }
    folder = ROOT / ".scratch" / "fano-v7-walk-forward"
    folder.mkdir(parents=True, exist_ok=True)
    output = folder / f"results-{report['run_date']}-stage-17-variable-order-digits.json"
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"hits": hits,
                      "hit_rate_percent": report["v7"]["hit_rate_percent"],
                      "threshold_met": report["threshold_met"],
                      "mean_joint_log_loss": report["v7"]["mean_joint_log_loss"],
                      "uniform_log_loss": math.log(1_000_000),
                      "best_fixed_model": fixed_results[0],
                      "data_fingerprint": fingerprint,
                      "result_file": str(output),
                      "elapsed_seconds": report["elapsed_seconds"]},
                     ensure_ascii=False), flush=True)


if __name__ == "__main__":
    run()
