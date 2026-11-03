"""Hierarchical shared-digit prior from prior prize1/front3/back3/bottom2 results."""
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
AUX_WEIGHTS = (0.1, 0.5, 1.0)
HALF_LIVES = (None, 120, 360)
ALPHAS = (20.0, 75.0)
MODELS = tuple(
    {"name": f"shared-pool-aw-{aux_weight:g}-hl-{half_life or 'all'}-alpha-{alpha:g}",
     "aux_weight": aux_weight, "half_life": half_life, "alpha": alpha}
    for aux_weight in AUX_WEIGHTS for half_life in HALF_LIVES for alpha in ALPHAS
)
LINE_PAIRS = tuple(itertools.combinations(range(7), 2))
INITIAL_PAIRS = ((0, 1), (2, 3), (4, 5), (0, 6), (1, 4), (2, 5))


def _valid(value, length):
    return (isinstance(value, str) and len(value) == length
            and value.isascii() and value.isdigit())


def _load_rows():
    rows = []
    for source in astra.load_existing_astra_history():
        first = astra._category_values(source, "prize1", 6)
        if first is None:
            continue
        front = [value for value in (source.get("front3_1"), source.get("front3_2"))
                 if _valid(value, 3)]
        back = [value for value in (source.get("back3_1"), source.get("back3_2"))
                if _valid(value, 3)]
        bottom = [source.get("bottom2")] if _valid(source.get("bottom2"), 2) else []
        rows.append({"date": astra._history_date(source["date"]),
                     "prize1": first[0], "front3": front, "back3": back,
                     "bottom2": bottom})
    rows.sort(key=lambda row: row["date"])
    if len(rows) != DRAW_COUNT or len({row["date"] for row in rows}) != DRAW_COUNT:
        raise RuntimeError(f"Expected {DRAW_COUNT} unique valid first-prize draws")
    if any(rows[index - 1]["date"] >= rows[index]["date"] for index in range(1, DRAW_COUNT)):
        raise RuntimeError("First-prize history is not strictly chronological")
    return rows


def _fit_predictions(prior_rows, model):
    count = len(prior_rows)
    ages = (count - 1 - np.arange(count)).astype(np.float64)
    recency = (np.ones(count, dtype=np.float64) if model["half_life"] is None
               else np.exp2(-ages / model["half_life"]))
    first_counts = np.zeros((6, 10), dtype=np.float64)
    first_totals = np.zeros(6, dtype=np.float64)
    auxiliary_counts = np.zeros((6, 10), dtype=np.float64)
    auxiliary_totals = np.zeros(6, dtype=np.float64)
    pooled_counts = np.zeros(10, dtype=np.float64)
    aux_weight = model["aux_weight"]
    for draw_index, row in enumerate(prior_rows):
        weight = float(recency[draw_index])
        for position, char in enumerate(row["prize1"]):
            digit = ord(char) - 48
            first_counts[position, digit] += weight
            first_totals[position] += weight
            pooled_counts[digit] += weight
        groups = ((row["front3"], 0), (row["back3"], 3), (row["bottom2"], 4))
        for values, offset in groups:
            for number in values:
                for local_position, char in enumerate(number):
                    position = offset + local_position
                    digit = ord(char) - 48
                    contribution = weight * aux_weight
                    auxiliary_counts[position, digit] += contribution
                    auxiliary_totals[position] += contribution
                    pooled_counts[digit] += contribution
    shared_prior = ((pooled_counts + 1.0) /
                    (float(pooled_counts.sum()) + 10.0)) if count else np.full(10, 0.1)
    alpha = model["alpha"]
    probabilities = (first_counts + auxiliary_counts + alpha * shared_prior[None, :]) / (
        first_totals[:, None] + auxiliary_totals[:, None] + alpha)
    return probabilities.tolist()


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
        raise RuntimeError("Initial shared-pool Fano codebook must be unique")
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
    rows = _load_rows()
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
        predictions = [_fit_predictions(rows[:target_index], model) for model in MODELS]
        weights = _normalize(log_weights)
        mixture = [[sum(weights[index] * predictions[index][position][digit]
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
        losses = [_log_loss(prediction, actual) for prediction in predictions]
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
        "walk_forward": "shared digit prior, auxiliary prize position counts, expert weights, and Fano slate are fitted only from prior draws",
        "model_family": "18-expert hierarchical position model with a shared latent digit prior pooled from prior prize1/front3/back3/bottom2 outputs and Fano codebook decoding",
        "expert_count": len(MODELS),
        "source_coverage_draws": {source: sum(bool(row[source]) for row in rows)
                                  for source in ("prize1", "front3", "back3", "bottom2")},
        "experts": [{"family": "shared-digit-pool", **dict(model)} for model in MODELS],
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
        "interpretation": "historical exploratory evaluation; shared-ball pooling is an experimental mechanism chosen after inspecting this historical sequence",
        "elapsed_seconds": round(time.perf_counter() - started, 3),
    }
    folder = ROOT / ".scratch" / "fano-v7-walk-forward"
    folder.mkdir(parents=True, exist_ok=True)
    output = folder / f"results-{report['run_date']}-stage-47-shared-digit-pool.json"
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
