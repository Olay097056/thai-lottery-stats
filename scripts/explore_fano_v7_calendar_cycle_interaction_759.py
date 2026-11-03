"""Prequential joint calendar-season and draw-index phase model for Fano v7."""
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
PERIODS = (3, 4, 5, 6, 8, 10, 12, 16)
ANNUAL_BANDWIDTHS = (20.0, 60.0)
CYCLE_BANDWIDTHS = (0.75, 1.5)
HALF_LIVES = (None, 240)
ALPHAS = (25.0, 75.0)
MODELS = tuple(
    {"name": f"joint-phase-p{period}-annual{annual:g}-cycle{cycle:g}-hl{half_life or 'all'}-a{alpha:g}",
     "period": period, "annual_bandwidth": annual, "cycle_bandwidth": cycle,
     "half_life": half_life, "alpha": alpha}
    for period in PERIODS for annual in ANNUAL_BANDWIDTHS
    for cycle in CYCLE_BANDWIDTHS for half_life in HALF_LIVES for alpha in ALPHAS
)
LINE_PAIRS = tuple(itertools.combinations(range(7), 2))
INITIAL_PAIRS = ((0, 1), (2, 3), (4, 5), (0, 6), (1, 4), (2, 5))
YEAR_DAYS = 365.2425


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


def _year_day(day):
    return (day.timetuple().tm_yday - 1) * YEAR_DAYS / (366 if _is_leap(day.year) else 365)


def _is_leap(year):
    return year % 4 == 0 and (year % 100 != 0 or year % 400 == 0)


def _expert_predictions(dated, target_index):
    count = target_index
    positions = np.arange(count, dtype=np.int64)
    ages = (count - 1 - positions).astype(np.float64)
    encoded = np.zeros((count, 6, 10), dtype=np.float64)
    for draw_index, (_, number) in enumerate(dated[:count]):
        for position, char in enumerate(number):
            encoded[draw_index, position, ord(char) - 48] = 1.0
    target_day = _year_day(dated[target_index][0])
    prior_days = np.asarray([_year_day(day) for day, _ in dated[:count]], dtype=np.float64)
    calendar_delta = np.abs(prior_days - target_day)
    calendar_delta = np.minimum(calendar_delta, YEAR_DAYS - calendar_delta)
    predictions = []
    for model in MODELS:
        half_life = model["half_life"]
        recency = (np.ones(count, dtype=np.float64) if half_life is None
                   else np.exp2(-ages / half_life))
        global_counts = np.einsum("n,npd->pd", recency, encoded, optimize=True)
        global_prior = ((global_counts + 1.0) /
                        (float(recency.sum()) + 10.0)) if count else np.full((6, 10), 0.1)
        if not count:
            predictions.append(global_prior.tolist())
            continue
        phase_delta = (target_index - positions) % model["period"]
        cycle_distance = np.minimum(phase_delta, model["period"] - phase_delta).astype(np.float64)
        calendar_kernel = np.exp(-0.5 * (calendar_delta / model["annual_bandwidth"]) ** 2)
        cycle_kernel = np.exp(-0.5 * (cycle_distance / model["cycle_bandwidth"]) ** 2)
        weights = recency * calendar_kernel * cycle_kernel
        local_counts = np.einsum("n,npd->pd", weights, encoded, optimize=True)
        alpha = model["alpha"]
        predictions.append(((local_counts + alpha * global_prior) /
                            (float(weights.sum()) + alpha)).tolist())
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
    selected = sorted(words, key=lambda row: (-row[2], row[0]))[:5]
    return {"numbers": [row[1] for row in selected],
            "mass": sum(row[2] for row in selected),
            "points": [row[0] + 1 for row in selected]}


def _optimize_codebook(probabilities):
    pairs = list(INITIAL_PAIRS)
    selected = _best_slate(probabilities, pairs)
    if selected is None:
        raise RuntimeError("Initial joint-phase Fano codebook must be unique")
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
        predictions = _expert_predictions(dated, target_index)
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
        "walk_forward": "joint annual-day and draw-index phase weights use only prior outcomes; expert weights update after scoring",
        "model_family": "128-expert mixture of Bayesian positional digit models conditioned jointly on circular annual phase and draw-index period with Fano codebook decoding",
        "expert_count": len(MODELS),
        "experts": [{"family": "calendar-cycle-interaction", **dict(model)} for model in MODELS],
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
        "interpretation": "historical exploratory evaluation; joint temporal phase models were proposed after earlier same-sample model reviews",
        "elapsed_seconds": round(time.perf_counter() - started, 3),
    }
    folder = ROOT / ".scratch" / "fano-v7-walk-forward"
    folder.mkdir(parents=True, exist_ok=True)
    output = folder / f"results-{report['run_date']}-stage-48-calendar-cycle-interaction.json"
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
