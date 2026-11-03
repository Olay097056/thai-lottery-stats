"""Walk-forward Fano v7 experiment with alternative within-number orders."""
from __future__ import annotations

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
ORDERS = (
    ("straight", (0, 1, 2, 3, 4, 5)),
    ("reverse", (5, 4, 3, 2, 1, 0)),
    ("outside-in", (0, 5, 1, 4, 2, 3)),
    ("inside-out", (2, 3, 1, 4, 0, 5)),
    ("even-then-odd", (0, 2, 4, 1, 3, 5)),
    ("odd-then-even", (1, 3, 5, 0, 2, 4)),
    ("alternating-reverse", (5, 3, 1, 4, 2, 0)),
    ("rotated-two", (2, 3, 4, 5, 0, 1)),
)
MODELS = tuple(
    {"name": f"position-order-{name}-hl-{half_life or 'all'}-alpha-{alpha:g}",
     "order_name": name, "order": order, "half_life": half_life, "alpha": alpha}
    for name, order in ORDERS
    for half_life in (None, 120)
    for alpha in (10.0, 50.0)
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
    totals = [0.0] * 6
    marginal_counts = [[0.0] * 10 for _ in range(6)]
    for index, (_, number) in enumerate(prior):
        weight = _age_weight(len(prior) - index - 1, model["half_life"])
        for position, char in enumerate(number):
            marginal_counts[position][ord(char) - 48] += weight
            totals[position] += weight
    marginals = [
        [(marginal_counts[pos][digit] + 1.0) / (totals[pos] + 10.0)
         for digit in range(10)]
        for pos in range(6)
    ]
    start = marginals[order[0]]
    transitions = []
    for edge in range(1, 6):
        source_pos, target_pos = order[edge - 1], order[edge]
        counts = [[0.0] * 10 for _ in range(10)]
        row_totals = [0.0] * 10
        for index, (_, number) in enumerate(prior):
            weight = _age_weight(len(prior) - index - 1, model["half_life"])
            source_digit = ord(number[source_pos]) - 48
            target_digit = ord(number[target_pos]) - 48
            counts[source_digit][target_digit] += weight
            row_totals[source_digit] += weight
        alpha = model["alpha"]
        transition = [
            [(counts[left][right] + alpha * marginals[target_pos][right]) /
             (row_totals[left] + alpha) for right in range(10)]
            for left in range(10)
        ]
        transitions.append(transition)
    return {"start_position": order[0], "start": start,
            "transitions": transitions, "order": order}


def _model_marginals(chain):
    result = [[0.0] * 10 for _ in range(6)]
    position = chain["order"][0]
    result[position] = chain["start"]
    for edge, transition in enumerate(chain["transitions"], start=1):
        source_pos, target_pos = chain["order"][edge - 1], chain["order"][edge]
        source = result[source_pos]
        result[target_pos] = [
            sum(source[left] * transition[left][right] for left in range(10))
            for right in range(10)
        ]
    return result


def _joint_probability(chain, number):
    probability = chain["start"][ord(number[chain["order"][0]]) - 48]
    for edge, transition in enumerate(chain["transitions"], start=1):
        source_pos, target_pos = chain["order"][edge - 1], chain["order"][edge]
        source = ord(number[source_pos]) - 48
        target = ord(number[target_pos]) - 48
        probability *= transition[source][target]
    return probability


def _joint_loss(chain, actual):
    probability = _joint_probability(chain, actual)
    return -math.log(max(probability, 1e-300))


def _mixture_codebook(chains, weights):
    individual_marginals = [_model_marginals(chain) for chain in chains]
    marginals = [
        [sum(weights[index] * individual_marginals[index][pos][digit]
             for index in range(len(chains))) for digit in range(10)]
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
            mass = sum(weights[index] * _joint_probability(chain, number)
                       for index, chain in enumerate(chains))
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
        raise RuntimeError("Fano position-order codebook must contain five distinct candidates")
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
        chains = [_fit(prior, model) for model in MODELS]
        weights = _normalize(log_weights)
        selected = _mixture_codebook(chains, weights)
        hit = actual in selected["numbers"]
        hits += int(hit)
        if hit:
            hit_dates.append(target_date.isoformat())
        mixture_probability = sum(weights[index] * _joint_probability(chain, actual)
                                  for index, chain in enumerate(chains))
        loss = -math.log(max(mixture_probability, 1e-300))
        loss_sum += loss
        mass_sum += selected["mass"]
        model_rows = []
        for index, (model, chain) in enumerate(zip(MODELS, chains)):
            model_loss = _joint_loss(chain, actual)
            model_hit = actual in _mixture_codebook([chain], [1.0])["numbers"]
            model_losses[index] += model_loss
            model_hits[index] += int(model_hit)
            model_rows.append({"name": model["name"], "joint_log_loss": model_loss,
                               "hit": model_hit})
        forecasts.append({
            "target_date": target_date.isoformat(), "prior_valid_draws": len(prior),
            "actual": actual, "candidates": selected["numbers"], "hit": hit,
            "five_candidate_joint_probability_mass": selected["mass"],
            "joint_log_loss": loss,
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
        "target": "exact six-digit first-prize hit; five distinct predictions per draw",
        "walk_forward": "all position-pair transition counts and expert weights use prior valid draws only; target is scored before weight updates",
        "model_family": "prequential mixture of Bayesian within-number Markov chains over eight alternative position traversals, with joint Fano codeword scoring",
        "models": [dict(model) for model in MODELS],
        "uniform_expected_hits": DRAW_COUNT * 5 / 1_000_000,
        "v7": {"hits": hits, "hit_rate_percent": round(100 * hits / DRAW_COUNT, 8),
               "hit_dates": hit_dates,
               "mean_joint_log_loss": round(loss_sum / DRAW_COUNT, 8),
               "mean_five_candidate_probability_mass": round(mass_sum / DRAW_COUNT, 12),
               "forecasts": forecasts},
        "fixed_model_comparisons": fixed_results,
        "threshold_met": hits >= MIN_TARGET_HITS,
        "interpretation": "historical exploration only; traversal family was proposed after earlier exploratory runs and is not an untouched holdout",
        "elapsed_seconds": round(time.perf_counter() - started, 3),
    }
    folder = ROOT / ".scratch" / "fano-v7-walk-forward"
    folder.mkdir(parents=True, exist_ok=True)
    output = folder / f"results-{report['run_date']}-stage-15-position-order-markov.json"
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
