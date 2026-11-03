"""Prequential schedule-gap-conditioned positional model with Fano decoding."""
from __future__ import annotations

from datetime import datetime
import hashlib
import itertools
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

DRAW_COUNT = 759
MIN_TARGET_HITS = math.ceil(DRAW_COUNT * 0.40)
BANDWIDTHS = (0.5, 1.5, 3.0, 6.0)
HALF_LIVES = (None, 180)
ALPHAS = (30.0, 100.0)
MODELS = tuple(
    {"name": f"interval-bw-{bandwidth:g}-hl-{half_life or 'all'}-alpha-{alpha:g}",
     "bandwidth": bandwidth, "half_life": half_life, "alpha": alpha}
    for bandwidth in BANDWIDTHS for half_life in HALF_LIVES for alpha in ALPHAS
)
LINE_PAIRS = tuple(itertools.combinations(range(7), 2))
INITIAL_PAIRS = ((0, 1), (2, 3), (4, 5), (0, 6), (1, 4), (2, 5))


def _load_draws():
    dated = []
    for row in astra.load_existing_astra_history():
        values = astra._category_values(row, "prize1", 6)
        if values is not None:
            dated.append((astra._history_date(row["date"]), values[0]))
    dated.sort()
    if len(dated) != DRAW_COUNT or len({day for day, _ in dated}) != DRAW_COUNT:
        raise RuntimeError(f"Expected {DRAW_COUNT} unique valid first-prize draws")
    if any(dated[index - 1][0] >= dated[index][0] for index in range(1, DRAW_COUNT)):
        raise RuntimeError("First-prize history is not strictly chronological")
    if any(len(number) != 6 or not number.isascii() or not number.isdigit()
           for _, number in dated):
        raise RuntimeError("A first-prize result is not a six-character ASCII number")
    gaps = [None] + [(dated[index][0] - dated[index - 1][0]).days
                     for index in range(1, len(dated))]
    return dated, gaps


def _expert_predictions(prior, gaps, target_gap):
    count = len(prior)
    ages = (count - 1 - np.arange(count)).astype(np.float64)
    encoded = np.zeros((count, 6, 10), dtype=np.float64)
    for draw_index, (_, number) in enumerate(prior):
        for position, char in enumerate(number):
            encoded[draw_index, position, ord(char) - 48] = 1.0
    predictions = []
    for model in MODELS:
        half_life = model["half_life"]
        recency = (np.ones(count, dtype=np.float64) if half_life is None
                   else np.exp2(-ages / half_life))
        global_counts = np.einsum("n,npd->pd", recency, encoded, optimize=True)
        global_prior = ((global_counts + 1.0) /
                        (float(recency.sum()) + 10.0)) if count else np.full((6, 10), 0.1)
        if target_gap is None or count < 2:
            predictions.append(global_prior.tolist())
            continue
        indices = np.asarray([index for index in range(1, count)
                              if gaps[index] is not None], dtype=np.int64)
        if not len(indices):
            predictions.append(global_prior.tolist())
            continue
        transition_ages = count - 1 - indices
        if half_life is None:
            transition_recency = np.ones(len(indices), dtype=np.float64)
        else:
            transition_recency = np.exp2(-transition_ages / half_life)
        interval_distance = np.asarray([abs(gaps[index] - target_gap) for index in indices],
                                       dtype=np.float64)
        kernel = np.exp(-0.5 * (interval_distance / model["bandwidth"]) ** 2)
        local_weights = kernel * transition_recency
        local_counts = np.einsum("n,npd->pd", local_weights, encoded[indices], optimize=True)
        local_weight = float(local_weights.sum())
        alpha = model["alpha"]
        predictions.append(((local_counts + alpha * global_prior) /
                            (local_weight + alpha)).tolist())
    return predictions


def _normalize(log_weights):
    maximum = max(log_weights)
    values = [math.exp(value - maximum) for value in log_weights]
    total = sum(values)
    return [value / total for value in values]


def _log_loss(probabilities, actual):
    return -sum(math.log(max(probabilities[position][ord(char) - 48], 1e-300))
                for position, char in enumerate(actual))


def _best_slate(probabilities, pairs):
    rankings = [sorted(range(10), key=lambda digit: (-probabilities[pos][digit], digit))[:4]
                for pos in range(6)]
    words = []
    for point in range(7):
        digits = []
        for position, (left, right) in enumerate(pairs):
            code = int(point in fano.FANO_LINES[left]) * 2 + int(point in fano.FANO_LINES[right])
            digits.append(rankings[position][code])
        number = "".join(str(digit) for digit in digits)
        mass = math.prod(probabilities[position][digit]
                         for position, digit in enumerate(digits))
        words.append((point, number, mass))
    if len({row[1] for row in words}) != 7:
        return None
    chosen = sorted(words, key=lambda row: (-row[2], row[0]))[:5]
    return {"numbers": [row[1] for row in chosen], "mass": sum(row[2] for row in chosen),
            "points": [row[0] + 1 for row in chosen]}


def _optimize_codebook(probabilities):
    pairs = list(INITIAL_PAIRS)
    selected = _best_slate(probabilities, pairs)
    if selected is None:
        raise RuntimeError("Initial interval-conditioned Fano codebook must be unique")
    for _ in range(8):
        changed = False
        for position in range(6):
            best_pair, best_slate = pairs[position], selected
            for pair in LINE_PAIRS:
                if pair == best_pair:
                    continue
                proposal = list(pairs)
                proposal[position] = pair
                slate = _best_slate(probabilities, proposal)
                if slate is not None and slate["mass"] > best_slate["mass"] + 1e-18:
                    best_pair, best_slate = pair, slate
            if best_pair != pairs[position]:
                pairs[position] = best_pair
                selected = best_slate
                changed = True
        if not changed:
            break
    selected["line_pairs"] = [[left + 1, right + 1] for left, right in pairs]
    return selected


def run():
    started = time.perf_counter()
    dated, gaps = _load_draws()
    material = "\n".join(f"{day.isoformat()}|{number}" for day, number in dated).encode("ascii")
    fingerprint = hashlib.sha256(material).hexdigest()
    log_weights = [0.0] * len(MODELS)
    model_losses = [0.0] * len(MODELS)
    hits = 0
    hit_dates = []
    loss_sum = 0.0
    mass_sum = 0.0
    forecasts = []
    for target_index, (target_date, actual) in enumerate(dated):
        target_gap = gaps[target_index]
        predictions = _expert_predictions(dated[:target_index], gaps[:target_index], target_gap)
        weights = _normalize(log_weights)
        mixture = [[sum(weights[index] * predictions[index][position][digit]
                        for index in range(len(MODELS))) for digit in range(10)]
                   for position in range(6)]
        slate = _optimize_codebook(mixture)
        hit = actual in slate["numbers"]
        hits += int(hit)
        if hit:
            hit_dates.append(target_date.isoformat())
        loss = _log_loss(mixture, actual)
        loss_sum += loss
        mass_sum += slate["mass"]
        losses = [_log_loss(prediction, actual) for prediction in predictions]
        model_losses = [model_losses[index] + losses[index]
                        for index in range(len(MODELS))]
        forecasts.append({
            "target_date": target_date.isoformat(),
            "prior_valid_draws": target_index,
            "known_gap_days": target_gap,
            "actual": actual,
            "candidates": slate["numbers"],
            "hit": hit,
            "five_candidate_probability_mass": slate["mass"],
            "log_loss": loss,
            "line_pairs": slate["line_pairs"],
            "selected_points": slate["points"],
            "top_expert_weights_before_target": sorted(
                ((MODELS[index]["name"], weights[index]) for index in range(len(MODELS))),
                key=lambda row: -row[1])[:5],
        })
        log_weights = [log_weights[index] - losses[index]
                       for index in range(len(MODELS))]
        if (target_index + 1) % 100 == 0:
            print(f"walk-forward: {target_index + 1}/{DRAW_COUNT}, v7={hits} hits",
                  flush=True)

    fixed_results = [{"name": MODELS[index]["name"],
                      "mean_log_loss": round(model_losses[index] / DRAW_COUNT, 8)}
                     for index in range(len(MODELS))]
    report = {
        "run_date": datetime.now(astra.THAILAND_TZ).date().isoformat(),
        "draw_count": DRAW_COUNT,
        "date_range": [dated[0][0].isoformat(), dated[-1][0].isoformat()],
        "actuals_sha256": fingerprint,
        "target": "exact six-digit first-prize hit; exactly five distinct predictions per draw",
        "walk_forward": "target draw interval is known before prediction; interval-conditioned statistics use prior draw outcomes only",
        "model_family": "16-expert Bayesian positional digit model conditioned on inter-draw interval kernel, with four-rank Fano codebook",
        "expert_count": len(MODELS),
        "experts": [{"family": "draw-interval-kernel", **dict(model)} for model in MODELS],
        "interval_value_counts": {str(gap): sum(value == gap for value in gaps)
                                  for gap in sorted({value for value in gaps if value is not None})},
        "uniform_expected_hits": DRAW_COUNT * 5 / 1_000_000,
        "v7": {"hits": hits, "hit_rate_percent": round(100 * hits / DRAW_COUNT, 8),
               "hit_dates": hit_dates,
               "mean_log_loss": round(loss_sum / DRAW_COUNT, 8),
               "uniform_log_loss": math.log(1_000_000),
               "mean_five_candidate_probability_mass": round(mass_sum / DRAW_COUNT, 12),
               "forecasts": forecasts},
        "fixed_model_comparisons": fixed_results,
        "threshold": {"minimum_hits_for_40_percent": MIN_TARGET_HITS,
                      "met": hits >= MIN_TARGET_HITS},
        "interpretation": "historical exploratory evaluation; interval-family design was proposed after reviewing this same history",
        "elapsed_seconds": round(time.perf_counter() - started, 3),
    }
    folder = ROOT / ".scratch" / "fano-v7-walk-forward"
    folder.mkdir(parents=True, exist_ok=True)
    output = folder / f"results-{report['run_date']}-stage-46-draw-interval.json"
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"hits": hits,
                      "hit_rate_percent": report["v7"]["hit_rate_percent"],
                      "threshold_met": report["threshold"]["met"],
                      "mean_log_loss": report["v7"]["mean_log_loss"],
                      "uniform_log_loss": report["v7"]["uniform_log_loss"],
                      "best_fixed_model": min(fixed_results,
                                               key=lambda row: row["mean_log_loss"]),
                      "data_fingerprint": fingerprint,
                      "result_file": str(output),
                      "elapsed_seconds": report["elapsed_seconds"]},
                     ensure_ascii=False), flush=True)


if __name__ == "__main__":
    run()
