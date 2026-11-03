"""Stage 60: bootstrap multi-output random forest over prior draw transitions."""
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
import numpy as np

DRAW_COUNT = 759
EXPECTED_FINGERPRINT = "c7d1cd0199ee945a9102dab341c7353cf0c76272b05d69bee3b6119d0bed6145"
TICKET_COUNT = 5
TREE_COUNT = 16
MAX_DEPTH = 3
MAX_FEATURES_PER_SPLIT = 3
MIN_LEAF_SIZE = 12
LEAF_PRIOR_STRENGTH = 20.0
RANDOM_SEED = 20261015
THRESHOLDS = np.arange(9, dtype=np.int64)


def _load_draws():
    dated = []
    for row in astra.load_existing_astra_history():
        values = astra._category_values(row, "prize1", 6)
        if values is not None:
            dated.append((astra._history_date(row["date"]), values[0]))
    dated.sort()
    if len(dated) != DRAW_COUNT or len({day for day, _ in dated}) != DRAW_COUNT:
        raise RuntimeError("Expected 759 unique first-prize draws")
    if any(dated[i - 1][0] >= dated[i][0] for i in range(1, DRAW_COUNT)):
        raise RuntimeError("Draw history is not strictly chronological")
    if any(len(number) != 6 or not number.isascii() or not number.isdigit()
           for _, number in dated):
        raise RuntimeError("First-prize values must remain six ASCII digits")
    material = "\n".join(f"{day.isoformat()}|{number}" for day, number in dated).encode("ascii")
    fingerprint = hashlib.sha256(material).hexdigest()
    if fingerprint != EXPECTED_FINGERPRINT:
        raise RuntimeError(f"Dataset fingerprint changed: {fingerprint}")
    return dated, fingerprint


def _gini(counts):
    totals = counts.sum(axis=1)
    proportions = counts / np.maximum(totals[:, None], 1.0)
    return float(np.mean(1.0 - np.sum(proportions * proportions, axis=1)))


def _fit_tree(features, labels_one_hot, bootstrap, global_prior, rng):
    def build(sample_indices, depth):
        counts = labels_one_hot[sample_indices].sum(axis=0)
        node_size = len(sample_indices)
        leaf = (counts + LEAF_PRIOR_STRENGTH * global_prior) / (
            node_size + LEAF_PRIOR_STRENGTH)
        if depth >= MAX_DEPTH or node_size < 2 * MIN_LEAF_SIZE:
            return ("leaf", leaf)

        parent_impurity = _gini(counts)
        best = None
        sampled_features = rng.choice(6, size=MAX_FEATURES_PER_SPLIT, replace=False)
        for feature in sampled_features:
            order = np.argsort(features[sample_indices, feature], kind="stable")
            sorted_indices = sample_indices[order]
            sorted_values = features[sorted_indices, feature]
            prefix = np.cumsum(labels_one_hot[sorted_indices], axis=0)
            left_sizes = np.searchsorted(sorted_values, THRESHOLDS, side="right")
            valid_positions = np.flatnonzero(
                (left_sizes >= MIN_LEAF_SIZE)
                & (node_size - left_sizes >= MIN_LEAF_SIZE))
            if not len(valid_positions):
                continue
            valid_left_sizes = left_sizes[valid_positions]
            left_counts = prefix[valid_left_sizes - 1]
            right_counts = counts[None, :, :] - left_counts
            left_gini = np.mean(
                1.0 - np.sum(left_counts * left_counts, axis=2)
                / (valid_left_sizes[:, None] ** 2), axis=1)
            right_sizes = node_size - valid_left_sizes
            right_gini = np.mean(
                1.0 - np.sum(right_counts * right_counts, axis=2)
                / (right_sizes[:, None] ** 2), axis=1)
            impurity = ((valid_left_sizes * left_gini
                         + right_sizes * right_gini) / node_size)
            gains = parent_impurity - impurity
            for local_index, gain in enumerate(gains):
                threshold = int(THRESHOLDS[valid_positions[local_index]])
                key = (float(gain), -int(feature), -threshold)
                if best is None or key > best[0]:
                    best = (key, int(feature), threshold)

        if best is None or best[0][0] <= 1e-12:
            return ("leaf", leaf)
        _, feature, threshold = best
        left_mask = features[sample_indices, feature] <= threshold
        left = sample_indices[left_mask]
        right = sample_indices[~left_mask]
        return ("split", feature, threshold,
                build(left, depth + 1), build(right, depth + 1))

    return build(bootstrap, 0)


def _predict_tree(tree, query):
    node = tree
    while node[0] != "leaf":
        _, feature, threshold, left, right = node
        node = left if query[feature] <= threshold else right
    return node[1]


def _predict_forest(all_digits, target_index, rng):
    prior_digits = all_digits[:target_index]
    global_counts = np.zeros((6, 10), dtype=np.float64)
    if len(prior_digits):
        for position in range(6):
            global_counts[position] = np.bincount(
                prior_digits[:, position], minlength=10)
    global_prior = (global_counts + 1.0) / (len(prior_digits) + 10.0)
    if target_index < 2:
        return global_prior

    features = all_digits[:target_index - 1]
    target_digits = all_digits[1:target_index]
    labels_one_hot = np.eye(10, dtype=np.float64)[target_digits]
    query = all_digits[target_index - 1]
    predictions = []
    for _ in range(TREE_COUNT):
        bootstrap = rng.integers(0, len(features), size=len(features))
        tree = _fit_tree(features, labels_one_hot, bootstrap, global_prior, rng)
        predictions.append(_predict_tree(tree, query))
    return np.mean(predictions, axis=0)


def _fano_candidates(probabilities):
    rankings = [sorted(range(10), key=lambda digit: (-probabilities[pos, digit], digit))[:2]
                for pos in range(6)]
    best = None
    for puncture in range(7):
        lines = [line for line in range(7) if line != puncture]
        words = []
        for point in range(7):
            digits = [rankings[pos][int(point in fano.FANO_LINES[line])]
                      for pos, line in enumerate(lines)]
            number = "".join(str(digit) for digit in digits)
            log_mass = sum(math.log(float(probabilities[pos, digit]))
                           for pos, digit in enumerate(digits))
            words.append((number, log_mass))
        if len({number for number, _ in words}) != 7:
            raise RuntimeError("Fano codewords must be distinct")
        selected = sorted(words, key=lambda item: (-item[1], item[0]))[:TICKET_COUNT]
        maximum = max(log_mass for _, log_mass in selected)
        score = maximum + math.log(sum(math.exp(log_mass - maximum)
                                       for _, log_mass in selected))
        key = (score, -puncture)
        if best is None or key > best[0]:
            best = (key, selected, puncture)
    _, selected, puncture = best
    candidates = [number for number, _ in selected]
    if len(candidates) != TICKET_COUNT or len(set(candidates)) != TICKET_COUNT:
        raise RuntimeError("Fano decoder must produce five unique candidates")
    return candidates, puncture + 1


def run():
    started = time.perf_counter()
    dated, fingerprint = _load_draws()
    all_digits = np.asarray([[ord(char) - 48 for char in number]
                             for _, number in dated], dtype=np.int64)
    rng = np.random.default_rng(RANDOM_SEED)
    hits = 0
    hit_dates = []
    forecasts = []
    loss_sum = 0.0

    for target_index, (target_date, actual) in enumerate(dated):
        probabilities = _predict_forest(all_digits, target_index, rng)
        candidates, puncture = _fano_candidates(probabilities)
        actual_digits = all_digits[target_index]
        hit = actual in candidates
        hits += int(hit)
        if hit:
            hit_dates.append(target_date.isoformat())
        loss_sum += -sum(math.log(float(probabilities[pos, digit]))
                         for pos, digit in enumerate(actual_digits))
        forecasts.append({
            "target_date": target_date.isoformat(),
            "prior_valid_draws": target_index,
            "actual": actual,
            "candidates": candidates,
            "hit": hit,
            "punctured_line": puncture,
            "digit_probabilities": np.round(probabilities, 12).tolist(),
        })
        if (target_index + 1) % 100 == 0:
            print(f"walk-forward: {target_index + 1}/{DRAW_COUNT}, hits={hits}", flush=True)

    recomputed_hits = sum(row["actual"] in row["candidates"] for row in forecasts)
    if len(forecasts) != DRAW_COUNT:
        raise RuntimeError("Forecast count audit failed")
    if [row["target_date"] for row in forecasts] != [day.isoformat() for day, _ in dated]:
        raise RuntimeError("Forecast chronology audit failed")
    if [row["prior_valid_draws"] for row in forecasts] != list(range(DRAW_COUNT)):
        raise RuntimeError("Prior-count audit failed")
    if recomputed_hits != hits:
        raise RuntimeError("Reported hit count differs from candidate lists")
    if any(len(row["candidates"]) != TICKET_COUNT
           or len(set(row["candidates"])) != TICKET_COUNT
           for row in forecasts):
        raise RuntimeError("Five-distinct-candidates audit failed")

    run_date = datetime.now(astra.THAILAND_TZ).date().isoformat()
    report = {
        "run_date": run_date,
        "draw_count": DRAW_COUNT,
        "date_range": [dated[0][0].isoformat(), dated[-1][0].isoformat()],
        "actuals_sha256": fingerprint,
        "target": "at least 10 exact six-digit first-prize hits across 759 targets, using five distinct candidates per draw",
        "walk_forward": "forest training transitions and prior-only leaf marginals use records before the target; each forecast is made before scoring its actual",
        "model_family": "prequential multi-output bootstrap random forest with shared Fano-decoded digit marginals",
        "tree_count": TREE_COUNT,
        "max_depth": MAX_DEPTH,
        "max_features_per_split": MAX_FEATURES_PER_SPLIT,
        "min_leaf_size": MIN_LEAF_SIZE,
        "leaf_prior_strength": LEAF_PRIOR_STRENGTH,
        "random_seed": RANDOM_SEED,
        "uniform_expected_hits": DRAW_COUNT * TICKET_COUNT / 1_000_000,
        "v7": {"hits": hits, "hit_rate_percent": round(100 * hits / DRAW_COUNT, 8),
               "hit_dates": hit_dates,
               "mean_log_loss": round(loss_sum / DRAW_COUNT, 8),
               "uniform_log_loss": math.log(1_000_000),
               "forecasts": forecasts},
        "threshold": {"minimum_hits": 10, "met": hits >= 10},
        "validation": {"forecast_count": len(forecasts), "prior_counts_0_to_758": True,
                       "five_distinct_candidates_each": True,
                       "recomputed_hits": recomputed_hits},
        "interpretation": "historical exploratory evaluation only; no claim of independent predictive evidence",
        "elapsed_seconds": round(time.perf_counter() - started, 3),
    }
    output = ROOT / ".scratch" / "fano-v7-walk-forward" / f"results-{run_date}-stage-60-multioutput-random-forest.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"hits": hits, "hit_rate_percent": report["v7"]["hit_rate_percent"],
                      "hit_dates": hit_dates, "mean_log_loss": report["v7"]["mean_log_loss"],
                      "uniform_log_loss": report["v7"]["uniform_log_loss"],
                      "minimum_hits": 10, "met": hits >= 10,
                      "data_fingerprint": fingerprint, "result_file": str(output),
                      "elapsed_seconds": report["elapsed_seconds"]},
                     ensure_ascii=False), flush=True)


if __name__ == "__main__":
    run()
