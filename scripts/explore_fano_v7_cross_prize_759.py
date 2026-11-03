"""Prequential cross-prize digit-pool model with a 4-ary Fano codebook."""
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
SOURCES = ("prize1", "prize2", "prize3", "prize4", "prize5")
HALF_LIVES = (None, 120)
ALPHAS = (10.0, 100.0)
MODELS = tuple(
    {"name": f"{source}-digits-hl-{half_life or 'all'}-alpha-{alpha:g}",
     "source": source, "half_life": half_life, "alpha": alpha}
    for source in SOURCES for half_life in HALF_LIVES for alpha in ALPHAS
)
LINE_PAIRS = tuple(itertools.combinations(range(7), 2))
INITIAL_LINE_PAIRS = ((0, 1), (2, 3), (4, 5), (0, 6), (1, 4), (2, 5))


def _values(row, source):
    if source == "prize1":
        raw = [row.get("prize1")]
    elif source in ("prize2", "prize3"):
        prefix = source + "_"
        raw = [value for key, value in row.items() if key.startswith(prefix)]
    else:
        raw = str(row.get(source, "")).split()
    result = []
    for value in raw:
        if isinstance(value, str) and len(value) == 6 and value.isascii() and value.isdigit():
            result.append(value)
    return result


def _load_history():
    rows = []
    for row in astra.load_existing_astra_history():
        number = astra._category_values(row, "prize1", 6)
        if number is not None:
            rows.append({"date": astra._history_date(row["date"]),
                         "prize1": number[0],
                         "prize2": _values(row, "prize2"),
                         "prize3": _values(row, "prize3"),
                         "prize4": _values(row, "prize4"),
                         "prize5": _values(row, "prize5")})
    rows.sort(key=lambda row: row["date"])
    if len(rows) != DRAW_COUNT:
        raise RuntimeError(f"Expected {DRAW_COUNT} valid first-prize draws, found {len(rows)}")
    if len({row["date"] for row in rows}) != DRAW_COUNT:
        raise RuntimeError("Valid first-prize history contains duplicate dates")
    if any(rows[index - 1]["date"] >= rows[index]["date"] for index in range(1, DRAW_COUNT)):
        raise RuntimeError("First-prize history is not strictly chronological")
    return rows


def _expert_predictions(prior_rows):
    count = len(prior_rows)
    ages = (count - 1 - np.arange(count)).astype(np.float64)
    predictions = []
    for model in MODELS:
        half_life = model["half_life"]
        draw_weights = (np.ones(count, dtype=np.float64) if half_life is None
                        else np.exp2(-ages / half_life))
        totals = np.zeros((6, 10), dtype=np.float64)
        total_weight = 0.0
        for draw_index, row in enumerate(prior_rows):
            draw_weight = float(draw_weights[draw_index])
            values = row[model["source"]]
            total_weight += draw_weight * len(values)
            for number in values:
                for position, char in enumerate(number):
                    totals[position, ord(char) - 48] += draw_weight
        alpha = model["alpha"]
        predictions.append(((totals + alpha / 10.0) /
                            (total_weight + alpha)).tolist())
    return predictions


def _normalize(log_weights):
    maximum = max(log_weights)
    values = [math.exp(value - maximum) for value in log_weights]
    total = sum(values)
    return [value / total for value in values]


def _log_loss(probabilities, actual):
    return -sum(math.log(max(probabilities[position][ord(char) - 48], 1e-300))
                for position, char in enumerate(actual))


def _best_slate(probabilities, line_pairs):
    rankings = [sorted(range(10), key=lambda digit: (-probabilities[pos][digit], digit))[:4]
                for pos in range(6)]
    candidates = []
    for point in range(7):
        digits = []
        for position, (left, right) in enumerate(line_pairs):
            code = (int(point in fano.FANO_LINES[left]) * 2
                    + int(point in fano.FANO_LINES[right]))
            digits.append(rankings[position][code])
        number = "".join(str(digit) for digit in digits)
        mass = math.prod(probabilities[position][digit]
                         for position, digit in enumerate(digits))
        candidates.append((point, number, mass))
    if len({row[1] for row in candidates}) != 7:
        return None
    chosen = sorted(candidates, key=lambda row: (-row[2], row[0]))[:5]
    return {"numbers": [row[1] for row in chosen],
            "mass": sum(row[2] for row in chosen),
            "points": [row[0] + 1 for row in chosen]}


def _optimize_codebook(probabilities):
    line_pairs = list(INITIAL_LINE_PAIRS)
    selected = _best_slate(probabilities, line_pairs)
    if selected is None:
        raise RuntimeError("Initial cross-prize Fano projections must yield seven distinct words")
    for _ in range(8):
        changed = False
        for position in range(6):
            best_pair, best_slate = line_pairs[position], selected
            for pair in LINE_PAIRS:
                if pair == best_pair:
                    continue
                proposal = list(line_pairs)
                proposal[position] = pair
                slate = _best_slate(probabilities, proposal)
                if slate is not None and slate["mass"] > best_slate["mass"] + 1e-18:
                    best_pair, best_slate = pair, slate
            if best_pair != line_pairs[position]:
                line_pairs[position] = best_pair
                selected = best_slate
                changed = True
        if not changed:
            break
    selected["line_pairs"] = [[left + 1, right + 1] for left, right in line_pairs]
    return selected


def run():
    started = time.perf_counter()
    rows = _load_history()
    dated = [(row["date"], row["prize1"]) for row in rows]
    material = "\n".join(f"{day.isoformat()}|{number}" for day, number in dated).encode("ascii")
    fingerprint = hashlib.sha256(material).hexdigest()
    log_weights = [0.0] * len(MODELS)
    model_losses = [0.0] * len(MODELS)
    hits = 0
    hit_dates = []
    loss_sum = 0.0
    mass_sum = 0.0
    forecasts = []
    for target_index, row in enumerate(rows):
        expert_predictions = _expert_predictions(rows[:target_index])
        weights = _normalize(log_weights)
        mixture = [[sum(weights[index] * expert_predictions[index][position][digit]
                        for index in range(len(MODELS))) for digit in range(10)]
                   for position in range(6)]
        slate = _optimize_codebook(mixture)
        actual = row["prize1"]
        hit = actual in slate["numbers"]
        hits += int(hit)
        if hit:
            hit_dates.append(row["date"].isoformat())
        loss = _log_loss(mixture, actual)
        loss_sum += loss
        mass_sum += slate["mass"]
        losses = [_log_loss(prediction, actual) for prediction in expert_predictions]
        model_losses = [model_losses[index] + losses[index]
                        for index in range(len(MODELS))]
        forecasts.append({
            "target_date": row["date"].isoformat(),
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
        "walk_forward": "only earlier draws' prize1-5 number pools are used; prior outcomes score the forecast before online model-weight updates",
        "model_family": "20-expert prequential mixture of position-wise digit frequencies from each full-length prize1-5 pool, with a four-rank Fano incidence codebook",
        "expert_count": len(MODELS),
        "experts": [{"family": "cross-prize-digit-pool", **dict(model)} for model in MODELS],
        "source_coverage_draws": {source: sum(bool(row[source]) for row in rows)
                                  for source in SOURCES},
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
        "interpretation": "historical exploratory evaluation; cross-prize correlations were proposed after reviewing the same 759 target outcomes",
        "elapsed_seconds": round(time.perf_counter() - started, 3),
    }
    folder = ROOT / ".scratch" / "fano-v7-walk-forward"
    folder.mkdir(parents=True, exist_ok=True)
    output = folder / f"results-{report['run_date']}-stage-39-cross-prize.json"
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
