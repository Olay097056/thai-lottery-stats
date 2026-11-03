"""Walk-forward Fano v7 experiment with shallow trees over the prior draw."""
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
MODELS = tuple(
    {"name": f"prior-draw-tree-depth-{depth}-lookback-{lookback or 'all'}-leaf-{leaf}-alpha-{alpha:g}",
     "depth": depth, "lookback": lookback, "min_leaf": leaf, "alpha": alpha}
    for depth in (1, 2, 3)
    for lookback in (None, 240)
    for leaf in (10, 25)
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


def _digits(number):
    return [ord(char) - 48 for char in number]


def _gini(counts):
    total = sum(counts)
    if total == 0:
        return 0.0
    return 1.0 - sum((count / total) ** 2 for count in counts)


def _fit_tree(x, y, indices, depth, min_leaf, alpha, prior):
    counts = [0] * 10
    for index in indices:
        counts[y[index]] += 1
    probabilities = [(counts[digit] + alpha * prior[digit]) /
                     (len(indices) + alpha) for digit in range(10)]
    if depth <= 0 or len(indices) < 2 * min_leaf:
        return ("leaf", probabilities)

    parent_impurity = _gini(counts)
    best = None
    for feature in range(6):
        for threshold in range(9):
            left = [index for index in indices if x[index][feature] <= threshold]
            right = [index for index in indices if x[index][feature] > threshold]
            if len(left) < min_leaf or len(right) < min_leaf:
                continue
            left_counts = [0] * 10
            right_counts = [0] * 10
            for index in left:
                left_counts[y[index]] += 1
            for index in right:
                right_counts[y[index]] += 1
            impurity = ((len(left) * _gini(left_counts) +
                         len(right) * _gini(right_counts)) / len(indices))
            gain = parent_impurity - impurity
            key = (gain, -feature, -threshold)
            if best is None or key > best[0]:
                best = (key, feature, threshold, left, right)
    if best is None or best[0][0] <= 1e-12:
        return ("leaf", probabilities)
    _, feature, threshold, left, right = best
    return (feature, threshold,
            _fit_tree(x, y, left, depth - 1, min_leaf, alpha, prior),
            _fit_tree(x, y, right, depth - 1, min_leaf, alpha, prior))


def _predict_tree(tree, query):
    while tree[0] != "leaf":
        feature, threshold, left, right = tree
        tree = left if query[feature] <= threshold else right
    return tree[1]


def _fit(prior, model):
    if len(prior) < 2:
        return [[0.1] * 10 for _ in range(6)]
    x_all = [_digits(number) for _, number in prior[:-1]]
    y_all = [_digits(number) for _, number in prior[1:]]
    if model["lookback"] is not None:
        x_all = x_all[-model["lookback"]:]
        y_all = y_all[-model["lookback"]:]
    query = _digits(prior[-1][1])
    indices = list(range(len(x_all)))
    predictions = []
    for position in range(6):
        labels = [row[position] for row in y_all]
        counts = [labels.count(digit) for digit in range(10)]
        prior_distribution = [(counts[digit] + 1.0) / (len(labels) + 10.0)
                              for digit in range(10)]
        tree = _fit_tree(x_all, labels, indices, model["depth"],
                         model["min_leaf"], model["alpha"], prior_distribution)
        predictions.append(_predict_tree(tree, query))
    return predictions


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
        raise RuntimeError("Fano tree codebook must contain five distinct candidates")
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
            "selected_points": selected["selected_points"],
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
        "walk_forward": "tree training uses only prior consecutive draw transitions; expert weights update after each target is scored",
        "model_family": "prequential mixture of shallow decision trees over previous six-digit draw features with Bayesian leaf shrinkage and Fano codebook selection",
        "models": [dict(model) for model in MODELS],
        "uniform_expected_hits": DRAW_COUNT * 5 / 1_000_000,
        "v7": {"hits": hits, "hit_rate_percent": round(100 * hits / DRAW_COUNT, 8),
               "hit_dates": hit_dates,
               "mean_log_loss": round(loss_sum / DRAW_COUNT, 8),
               "mean_five_candidate_probability_mass": round(mass_sum / DRAW_COUNT, 12),
               "forecasts": forecasts},
        "fixed_model_comparisons": fixed_results,
        "threshold_met": hits >= MIN_TARGET_HITS,
        "interpretation": "historical exploration only; tree family and hyperparameters were proposed after earlier exploratory runs",
        "elapsed_seconds": round(time.perf_counter() - started, 3),
    }
    folder = ROOT / ".scratch" / "fano-v7-walk-forward"
    folder.mkdir(parents=True, exist_ok=True)
    output = folder / f"results-{report['run_date']}-stage-19-online-trees.json"
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
