"""Prequential Fano v7 with circular-kernel smoothing over draw-index phase."""
from __future__ import annotations

from datetime import datetime
import hashlib
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
PERIODS = (5, 6, 8, 10, 12, 15, 16, 20, 24, 30, 32, 40, 48, 60, 80, 96, 120)
BANDWIDTHS = (0.08, 0.18, 0.35)
HALF_LIVES = (None, 240)
ALPHAS = (25.0, 75.0)
MODELS = tuple(
    {"name": f"periodic-kernel-p-{period}-bw-{bandwidth:g}-hl-{half_life or 'all'}-alpha-{alpha:g}",
     "period": period, "bandwidth": bandwidth,
     "half_life": half_life, "alpha": alpha}
    for period in PERIODS
    for bandwidth in BANDWIDTHS
    for half_life in HALF_LIVES
    for alpha in ALPHAS
)


def _load_draws():
    dated = []
    for row in astra.load_existing_astra_history():
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


def _encode_draws(dated):
    encoded = np.zeros((len(dated), 6, 10), dtype=np.float64)
    for draw_index, (_, number) in enumerate(dated):
        for position, char in enumerate(number):
            encoded[draw_index, position, ord(char) - 48] = 1.0
    return encoded


def _fit_all(prior_encoded, target_index):
    count = len(prior_encoded)
    positions = np.arange(count, dtype=np.int64)
    ages = (count - 1 - positions).astype(np.float64)
    recency = {
        half_life: (np.ones(count, dtype=np.float64) if half_life is None else
                    np.exp2(-ages / half_life))
        for half_life in HALF_LIVES
    }
    global_prior = {}
    for half_life in HALF_LIVES:
        global_weights = recency[half_life]
        totals = np.einsum("n,npd->pd", global_weights, prior_encoded, optimize=True)
        global_prior[half_life] = (totals + 1.0) / (float(global_weights.sum()) + 10.0)

    predictions = []
    for period in PERIODS:
        phase_offset = np.mod(target_index - positions, period)
        phase_distance = np.minimum(phase_offset, period - phase_offset) / period
        for bandwidth in BANDWIDTHS:
            kernel = np.exp(-0.5 * (phase_distance / bandwidth) ** 2)
            for half_life in HALF_LIVES:
                local_weights = kernel * recency[half_life]
                local_totals = np.einsum("n,npd->pd", local_weights, prior_encoded,
                                         optimize=True)
                local_weight = float(local_weights.sum())
                alpha_prior = global_prior[half_life]
                for alpha in ALPHAS:
                    probabilities = (local_totals + alpha * alpha_prior) / (local_weight + alpha)
                    predictions.append(probabilities.tolist())
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
        raise RuntimeError("Fano periodic-kernel codebook must contain five unique candidates")
    return {"numbers": numbers, "mass": sum(row[2] for row in chosen),
            "punctured_line": puncture + 1,
            "omitted_points": [point + 1 for point in omitted]}


def _normalize(log_weights):
    maximum = max(log_weights)
    values = [math.exp(value - maximum) for value in log_weights]
    total = sum(values)
    return [value / total for value in values]


def _log_loss(probabilities, actual):
    return -sum(math.log(probabilities[position][ord(char) - 48])
                for position, char in enumerate(actual))


def run():
    started = time.perf_counter()
    dated = _load_draws()
    encoded = _encode_draws(dated)
    material = "\n".join(f"{day.isoformat()}|{number}" for day, number in dated).encode("ascii")
    fingerprint = hashlib.sha256(material).hexdigest()
    log_weights = [0.0] * len(MODELS)
    hits = 0
    hit_dates = []
    loss_sum = 0.0
    mass_sum = 0.0
    model_losses = [0.0] * len(MODELS)
    forecasts = []
    for target_index, (target_date, actual) in enumerate(dated):
        predictions = _fit_all(encoded[:target_index], target_index)
        weights = _normalize(log_weights)
        mixture = [
            [sum(weights[index] * predictions[index][position][digit]
                 for index in range(len(MODELS))) for digit in range(10)]
            for position in range(6)
        ]
        selection = _best_fano_codebook(mixture)
        hit = actual in selection["numbers"]
        hits += int(hit)
        if hit:
            hit_dates.append(target_date.isoformat())
        loss = _log_loss(mixture, actual)
        loss_sum += loss
        mass_sum += selection["mass"]
        expert_losses = [_log_loss(prediction, actual) for prediction in predictions]
        model_losses = [model_losses[index] + expert_losses[index]
                        for index in range(len(MODELS))]
        forecasts.append({
            "target_date": target_date.isoformat(),
            "prior_valid_draws": target_index,
            "actual": actual,
            "candidates": selection["numbers"],
            "hit": hit,
            "five_candidate_probability_mass": selection["mass"],
            "log_loss": loss,
            "top_expert_weights_before_target": sorted(
                ((MODELS[index]["name"], weights[index]) for index in range(len(MODELS))),
                key=lambda row: -row[1])[:5],
            "family_weights_before_target": {"periodic-phase-kernel": 1.0},
            "punctured_line": selection["punctured_line"],
            "omitted_points": selection["omitted_points"],
        })
        log_weights = [log_weights[index] - expert_losses[index]
                       for index in range(len(MODELS))]
        if (target_index + 1) % 100 == 0:
            print(f"walk-forward: {target_index + 1}/{DRAW_COUNT}, v7={hits} hits",
                  flush=True)

    fixed_results = [
        {"name": MODELS[index]["name"],
         "mean_log_loss": round(model_losses[index] / DRAW_COUNT, 8)}
        for index in range(len(MODELS))
    ]
    report = {
        "run_date": datetime.now(astra.THAILAND_TZ).date().isoformat(),
        "draw_count": DRAW_COUNT,
        "date_range": [dated[0][0].isoformat(), dated[-1][0].isoformat()],
        "actuals_sha256": fingerprint,
        "target": "exact six-digit first-prize hit; exactly five distinct predictions per draw",
        "walk_forward": "draw-index phases are softly kernel-weighted using only prior draws; expert weights update after target scoring",
        "model_family": "Bayesian online mixture over circular Gaussian phase kernels spanning 5–120 draw periods; punctured Fano portfolio selection",
        "expert_count": len(MODELS),
        "family_model_counts": {"periodic-phase-kernel": len(MODELS)},
        "experts": [{"family": "periodic-phase-kernel", **dict(model)}
                    for model in MODELS],
        "uniform_expected_hits": DRAW_COUNT * 5 / 1_000_000,
        "v7": {"hits": hits, "hit_rate_percent": round(100 * hits / DRAW_COUNT, 8),
               "hit_dates": hit_dates,
               "mean_log_loss": round(loss_sum / DRAW_COUNT, 8),
               "mean_five_candidate_probability_mass": round(mass_sum / DRAW_COUNT, 12),
               "forecasts": forecasts},
        "fixed_model_comparisons": fixed_results,
        "threshold": {"minimum_hits_for_40_percent": MIN_TARGET_HITS,
                      "met": hits >= MIN_TARGET_HITS},
        "interpretation": "historical exploratory evaluation; smooth phase-kernel family extends prior hard-residue draw-cycle work but was designed after reviewing the same historical data",
        "elapsed_seconds": round(time.perf_counter() - started, 3),
    }
    folder = ROOT / ".scratch" / "fano-v7-walk-forward"
    folder.mkdir(parents=True, exist_ok=True)
    output = folder / f"results-{report['run_date']}-stage-36-periodic-kernel.json"
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"hits": hits,
                      "hit_rate_percent": report["v7"]["hit_rate_percent"],
                      "threshold_met": report["threshold"]["met"],
                      "mean_log_loss": report["v7"]["mean_log_loss"],
                      "uniform_log_loss": math.log(1_000_000),
                      "best_fixed_model": min(fixed_results, key=lambda row: row["mean_log_loss"]),
                      "data_fingerprint": fingerprint,
                      "result_file": str(output),
                      "elapsed_seconds": report["elapsed_seconds"]},
                     ensure_ascii=False), flush=True)


if __name__ == "__main__":
    run()
