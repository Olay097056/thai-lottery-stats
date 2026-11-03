"""Adaptive Fano codebooks choosing seven rank symbols from all ten digits."""
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
HALF_LIVES = (None, 60, 180, 360)
ALPHAS = (20.0, 100.0)
MODELS = tuple(
    {"name": f"position-count-hl-{half_life or 'all'}-alpha-{alpha:g}",
     "half_life": half_life, "alpha": alpha}
    for half_life in HALF_LIVES for alpha in ALPHAS
)


def _pattern(point, triple):
    return sum(1 << bit for bit, line in enumerate(triple)
               if point in fano.FANO_LINES[line])


TRIPLES = tuple(triple for triple in itertools.combinations(range(7), 3)
                if len({_pattern(point, triple) for point in range(7)}) == 7)
SUBSETS = tuple(itertools.combinations(range(10), 7))
CONFIGS = tuple((triple, subset) for triple in TRIPLES for subset in SUBSETS)
MAPS = np.asarray([
    [subset[sorted({_pattern(p, triple) for p in range(7)}).index(_pattern(point, triple))]
     for point in range(7)]
    for triple, subset in CONFIGS
], dtype=np.int8)
CONFIG_INDEX = {(triple, subset): index for index, (triple, subset) in enumerate(CONFIGS)}
INITIAL = [CONFIG_INDEX[(TRIPLES[position % len(TRIPLES)], SUBSETS[0])]
           for position in range(6)]


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
    return dated


def _expert_predictions(prior):
    count = len(prior)
    ages = (count - 1 - np.arange(count)).astype(np.float64)
    encoded = np.zeros((count, 6, 10), dtype=np.float64)
    for draw_index, number in enumerate(prior):
        for position, char in enumerate(number):
            encoded[draw_index, position, ord(char) - 48] = 1.0
    predictions = []
    for model in MODELS:
        half_life = model["half_life"]
        weights = (np.ones(count, dtype=np.float64) if half_life is None
                   else np.exp2(-ages / half_life))
        totals = np.einsum("n,npd->pd", weights, encoded, optimize=True)
        predictions.append(((totals + model["alpha"] / 10.0) /
                            (float(weights.sum()) + model["alpha"])).tolist())
    return predictions


def _normalize(log_weights):
    maximum = max(log_weights)
    values = [math.exp(value - maximum) for value in log_weights]
    total = sum(values)
    return [value / total for value in values]


def _log_loss(probabilities, actual):
    return -sum(math.log(max(probabilities[position][ord(char) - 48], 1e-300))
                for position, char in enumerate(actual))


def _masses(rank_codes, ranked_probabilities):
    values = np.ones(7, dtype=np.float64)
    for position in range(6):
        values *= ranked_probabilities[position][rank_codes[position]]
    return values


def _optimize_codebook(probabilities):
    ranked_digits = [sorted(range(10), key=lambda digit: (-probabilities[pos][digit], digit))
                     for pos in range(6)]
    ranked_probabilities = [np.asarray([probabilities[pos][digit] for digit in ranked_digits[pos]])
                            for pos in range(6)]
    config_indices = list(INITIAL)
    rank_codes = [MAPS[index].copy() for index in config_indices]
    for _ in range(4):
        changed = False
        for position in range(6):
            base = np.ones(7, dtype=np.float64)
            for other in range(6):
                if other != position:
                    base *= ranked_probabilities[other][rank_codes[other]]
            masses = MAPS
            candidate_masses = ranked_probabilities[position][masses] * base[None, :]
            scores = np.partition(candidate_masses, -5, axis=1)[:, -5:].sum(axis=1)
            best_index = int(np.argmax(scores))
            if best_index != config_indices[position]:
                config_indices[position] = best_index
                rank_codes[position] = MAPS[best_index].copy()
                changed = True
        if not changed:
            break
    point_masses = _masses(rank_codes, ranked_probabilities)
    chosen_points = sorted(range(7), key=lambda point: (-point_masses[point], point))[:5]
    numbers = ["".join(str(ranked_digits[position][int(rank_codes[position][point])])
                       for position in range(6)) for point in chosen_points]
    if len(numbers) != 5 or len(set(numbers)) != 5:
        raise RuntimeError("Adaptive seven-of-ten Fano codebook must yield five unique numbers")
    configs = []
    for index in config_indices:
        triple, subset = CONFIGS[index]
        configs.append({"line_triple": [line + 1 for line in triple],
                        "selected_digit_ranks": list(subset)})
    return {"numbers": numbers,
            "mass": float(sum(point_masses[point] for point in chosen_points)),
            "points": [point + 1 for point in chosen_points],
            "configs": configs}


def run():
    if len(TRIPLES) != 28 or MAPS.shape != (3360, 7):
        raise RuntimeError(f"Unexpected Fano configuration library: triples={len(TRIPLES)}, maps={MAPS.shape}")
    started = time.perf_counter()
    dated = _load_draws()
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
        predictions = _expert_predictions([number for _, number in dated[:target_index]])
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
            "actual": actual,
            "candidates": slate["numbers"],
            "hit": hit,
            "five_candidate_probability_mass": slate["mass"],
            "log_loss": loss,
            "configurations": slate["configs"],
            "selected_points": slate["points"],
            "top_expert_weights_before_target": sorted(
                ((MODELS[index]["name"], weights[index]) for index in range(len(MODELS))),
                key=lambda row: -row[1])[:4],
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
        "walk_forward": "all ten prior-ranked digits can enter adaptive seven-symbol Fano codebooks; expert weights update after the target is scored",
        "model_family": "eight-expert positional frequency mixture and coordinate-ascent Fano projections over 28 line triples by 120 seven-of-ten digit subsets per position",
        "expert_count": len(MODELS),
        "fano_configuration_count_per_coordinate": len(CONFIGS),
        "experts": [{"family": "position-frequency", **dict(model)} for model in MODELS],
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
        "interpretation": "historical exploratory evaluation; the adaptive full-decimal Fano projection was designed after earlier same-sample results",
        "elapsed_seconds": round(time.perf_counter() - started, 3),
    }
    folder = ROOT / ".scratch" / "fano-v7-walk-forward"
    folder.mkdir(parents=True, exist_ok=True)
    output = folder / f"results-{report['run_date']}-stage-44-adaptive-seven-of-ten.json"
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"hits": hits,
                      "hit_rate_percent": report["v7"]["hit_rate_percent"],
                      "threshold_met": report["threshold"]["met"],
                      "mean_log_loss": report["v7"]["mean_log_loss"],
                      "uniform_log_loss": report["v7"]["uniform_log_loss"],
                      "mean_five_candidate_probability_mass": report["v7"]["mean_five_candidate_probability_mass"],
                      "best_fixed_model": min(fixed_results,
                                               key=lambda row: row["mean_log_loss"]),
                      "data_fingerprint": fingerprint,
                      "result_file": str(output),
                      "elapsed_seconds": report["elapsed_seconds"]},
                     ensure_ascii=False), flush=True)


if __name__ == "__main__":
    run()
