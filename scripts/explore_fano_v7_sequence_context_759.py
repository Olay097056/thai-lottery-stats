"""Prequential Fano v7 kernel model over multi-draw temporal motifs."""
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
WINDOWS = (1, 2, 3, 4)
SIGMAS = (0.10, 0.25, 0.50)
HALF_LIVES = (None, 120)
SHRINKAGES = (20.0, 80.0)
MODELS = tuple(
    {"name": f"sequence-kernel-window-{window}-sigma-{sigma:g}-hl-{half_life or 'all'}-alpha-{alpha:g}",
     "window": window, "sigma": sigma, "half_life": half_life, "alpha": alpha}
    for window in WINDOWS
    for sigma in SIGMAS
    for half_life in HALF_LIVES
    for alpha in SHRINKAGES
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


def _age_weight(age, half_life):
    return 1.0 if half_life is None else 2.0 ** (-age / half_life)


def _fit(prior, model):
    window = model["window"]
    dimension = window * 6
    totals = [[0.0] * 10 for _ in range(6)]
    total_weight = 0.0
    for index, (_, number) in enumerate(prior):
        weight = _age_weight(len(prior) - index - 1, model["half_life"])
        total_weight += weight
        for position, char in enumerate(number):
            totals[position][ord(char) - 48] += weight
    global_prior = [
        [(totals[position][digit] + 1.0) / (total_weight + 10.0)
         for digit in range(10)]
        for position in range(6)
    ]

    local_counts = [[0.0] * 10 for _ in range(6)]
    local_weight = 0.0
    if len(prior) > window:
        query = "".join(number for _, number in prior[-window:])
        for index in range(window, len(prior)):
            context = "".join(number for _, number in prior[index - window:index])
            mismatches = sum(left != right for left, right in zip(context, query))
            mismatch_rate = mismatches / dimension
            similarity = math.exp(-0.5 * (mismatch_rate / model["sigma"]) ** 2)
            recency = _age_weight(len(prior) - index - 1, model["half_life"])
            weight = similarity * recency
            local_weight += weight
            following = prior[index][1]
            for position, char in enumerate(following):
                local_counts[position][ord(char) - 48] += weight

    alpha = model["alpha"]
    return [
        [(local_counts[position][digit] + alpha * global_prior[position][digit]) /
         (local_weight + alpha) for digit in range(10)]
        for position in range(6)
    ]


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
        raise RuntimeError("Fano sequence-context codebook must contain five distinct candidates")
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
    model_losses = [0.0] * len(MODELS)
    forecasts = []
    for target_index, (target_date, actual) in enumerate(dated):
        prior = dated[:target_index]
        predictions = [_fit(prior, model) for model in MODELS]
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
        expert_losses = [_log_loss(probabilities, actual) for probabilities in predictions]
        model_losses = [model_losses[index] + expert_losses[index]
                        for index in range(len(MODELS))]
        family_weight = {"multi-draw-sequence-kernel": 1.0}
        forecasts.append({
            "target_date": target_date.isoformat(),
            "prior_valid_draws": len(prior),
            "actual": actual,
            "candidates": selection["numbers"],
            "hit": hit,
            "five_candidate_probability_mass": selection["mass"],
            "log_loss": loss,
            "top_expert_weights_before_target": sorted(
                ((MODELS[index]["name"], weights[index]) for index in range(len(MODELS))),
                key=lambda row: -row[1]
            )[:5],
            "family_weights_before_target": family_weight,
            "punctured_line": selection["punctured_line"],
            "selected_points": selection["selected_points"],
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
        "walk_forward": "a kernel model compares the last 1-4 observed winning-number sequence against earlier 1-4 draw motifs; predictions and ensemble weights update only after the target is scored",
        "model_family": "prequential multi-draw temporal-motif kernel with recency weighting and global Bayesian shrinkage; punctured Fano codebook selection",
        "expert_count": len(MODELS),
        "family_model_counts": {"multi-draw-sequence-kernel": len(MODELS)},
        "experts": [{"family": "multi-draw-sequence-kernel", **dict(model)}
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
        "interpretation": "historical research only; multi-draw motifs are a post-hoc hypothesis family and this remains an exploratory evaluation",
        "elapsed_seconds": round(time.perf_counter() - started, 3),
    }
    folder = ROOT / ".scratch" / "fano-v7-walk-forward"
    folder.mkdir(parents=True, exist_ok=True)
    output = folder / f"results-{report['run_date']}-stage-25-sequence-context.json"
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
