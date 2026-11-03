"""Walk-forward Fano v7 experiment using all-position pairwise interactions."""
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
POSITION_PAIRS = tuple(itertools.combinations(range(6), 2))
MODELS = tuple(
    {"name": f"pairwise-mrf-lambda-{strength:g}-alpha-{alpha:g}-hl-{half_life or 'all'}",
     "interaction_strength": strength, "alpha": alpha, "half_life": half_life}
    for strength in (0.1, 0.25, 0.5)
    for alpha in (2.0, 10.0)
    for half_life in (None, 120)
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


def _softmax(scores):
    maximum = max(scores)
    values = [math.exp(value - maximum) for value in scores]
    total = sum(values)
    return [value / total for value in values]


def _fit(prior, model):
    total_weight = 0.0
    marginal_counts = [[0.0] * 10 for _ in range(6)]
    for index, (_, number) in enumerate(prior):
        weight = _age_weight(len(prior) - index - 1, model["half_life"])
        total_weight += weight
        for position, char in enumerate(number):
            marginal_counts[position][ord(char) - 48] += weight
    base = [
        [(marginal_counts[pos][digit] + 1.0) / (total_weight + 10.0)
         for digit in range(10)]
        for pos in range(6)
    ]
    pair_tables = {}
    alpha = model["alpha"]
    for left, right in POSITION_PAIRS:
        counts = [[0.0] * 10 for _ in range(10)]
        for index, (_, number) in enumerate(prior):
            weight = _age_weight(len(prior) - index - 1, model["half_life"])
            a = ord(number[left]) - 48
            b = ord(number[right]) - 48
            counts[a][b] += weight
        denominator = total_weight + 100.0 * alpha
        joint = [[(counts[a][b] + alpha) / denominator for b in range(10)]
                 for a in range(10)]
        left_marginal = [sum(joint[a][b] for b in range(10)) for a in range(10)]
        right_marginal = [sum(joint[a][b] for a in range(10)) for b in range(10)]
        pmi = [[math.log(joint[a][b] / (left_marginal[a] * right_marginal[b]))
                for b in range(10)] for a in range(10)]
        pair_tables[(left, right)] = pmi

    probabilities = [row[:] for row in base]
    strength = model["interaction_strength"]
    for _ in range(5):
        updated = []
        for position in range(6):
            scores = []
            for digit in range(10):
                score = math.log(base[position][digit])
                for other in range(6):
                    if other == position:
                        continue
                    left, right = sorted((position, other))
                    table = pair_tables[(left, right)]
                    if position == left:
                        expected = sum(probabilities[other][value] * table[digit][value]
                                       for value in range(10))
                    else:
                        expected = sum(probabilities[other][value] * table[value][digit]
                                       for value in range(10))
                    score += strength * expected
                scores.append(score)
            updated.append(_softmax(scores))
        probabilities = updated
    return probabilities


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
        for omitted in itertools.combinations(range(7), 2):
            chosen = [row for row in words if row[0] not in omitted]
            score = sum(row[2] for row in chosen)
            key = (score, -puncture, tuple(-point for point in omitted))
            if best is None or key > best[0]:
                best = (key, chosen, puncture, omitted)
    _, chosen, puncture, omitted = best
    numbers = [row[1] for row in chosen]
    if len(numbers) != 5 or len(set(numbers)) != 5:
        raise RuntimeError("Fano pairwise-MRF codebook must contain five distinct candidates")
    return {"numbers": numbers, "mass": sum(row[2] for row in chosen),
            "punctured_line": puncture + 1,
            "omitted_points": [point + 1 for point in omitted]}


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
        mixture = [[sum(weights[index] * fitted[index][pos][digit]
                        for index in range(len(MODELS))) for digit in range(10)]
                   for pos in range(6)]
        selected = _best_fano_codebook(mixture)
        hit = actual in selected["numbers"]
        hits += int(hit)
        if hit:
            hit_dates.append(target_date.isoformat())
        loss = _log_loss(mixture, actual)
        loss_sum += loss
        mass_sum += selected["mass"]
        per_model = []
        for index, (model, probabilities) in enumerate(zip(MODELS, fitted)):
            model_loss = _log_loss(probabilities, actual)
            model_hit = actual in _best_fano_codebook(probabilities)["numbers"]
            model_losses[index] += model_loss
            model_hits[index] += int(model_hit)
            per_model.append({"name": model["name"], "log_loss": model_loss,
                              "hit": model_hit})
        forecasts.append({
            "target_date": target_date.isoformat(), "prior_valid_draws": len(prior),
            "actual": actual, "candidates": selected["numbers"], "hit": hit,
            "five_candidate_probability_mass": selected["mass"], "log_loss": loss,
            "model_weights_before_target": {
                model["name"]: weights[index] for index, model in enumerate(MODELS)
            },
            "punctured_line": selected["punctured_line"],
            "omitted_points": selected["omitted_points"],
        })
        log_weights = [log_weights[index] - per_model[index]["log_loss"]
                       for index in range(len(MODELS))]
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
        "walk_forward": "all 15 pairwise tables and online expert weights use only outcomes strictly before each target; score before weight updates",
        "model_family": "prequential mixture of Bayesian pairwise maximum-entropy mean-field marginals over all 15 digit-position pairs, with Fano codebook selection",
        "models": [dict(model) for model in MODELS],
        "uniform_expected_hits": DRAW_COUNT * 5 / 1_000_000,
        "v7": {"hits": hits, "hit_rate_percent": round(100 * hits / DRAW_COUNT, 8),
               "hit_dates": hit_dates,
               "mean_log_loss": round(loss_sum / DRAW_COUNT, 8),
               "mean_five_candidate_probability_mass": round(mass_sum / DRAW_COUNT, 12),
               "forecasts": forecasts},
        "fixed_model_comparisons": fixed_results,
        "threshold_met": hits >= MIN_TARGET_HITS,
        "interpretation": "historical exploration only; pairwise family was proposed after earlier exploratory runs and is not an untouched holdout",
        "elapsed_seconds": round(time.perf_counter() - started, 3),
    }
    folder = ROOT / ".scratch" / "fano-v7-walk-forward"
    folder.mkdir(parents=True, exist_ok=True)
    output = folder / f"results-{report['run_date']}-stage-16-pairwise-mrf.json"
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
