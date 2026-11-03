"""Walk-forward Fano v7 experiment using per-digit renewal hazards."""
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
    {"name": f"digit-hazard-{bins}-hl-{half_life or 'all'}-alpha-{alpha:g}",
     "bins": bins, "half_life": half_life, "alpha": alpha}
    for bins in ("coarse", "fine")
    for half_life in (None, 120)
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


def _gap_bucket(gap, scheme):
    if scheme == "coarse":
        if gap <= 1:
            return gap
        if gap <= 3:
            return 2
        if gap <= 7:
            return 3
        return 4
    if scheme == "fine":
        return min(gap, 9)
    raise ValueError(f"unknown gap scheme: {scheme}")


def _age_weight(age, half_life):
    return 1.0 if half_life is None else 2.0 ** (-age / half_life)


def _fit_hazard(prior, model):
    """Estimate P(next digit | draws since that digit last appeared)."""
    if not prior:
        return [[0.1] * 10 for _ in range(6)]
    n = len(prior)
    baseline_counts = [[0.0] * 10 for _ in range(6)]
    baseline_weight = 0.0
    for index, (_, number) in enumerate(prior):
        weight = _age_weight(n - index - 1, model["half_life"])
        baseline_weight += weight
        for position, char in enumerate(number):
            baseline_counts[position][ord(char) - 48] += weight
    baseline = [
        [(baseline_counts[pos][digit] + 1.0) / (baseline_weight + 10.0)
         for digit in range(10)]
        for pos in range(6)
    ]

    exposures = [[[0.0] * 10 for _ in range(10)] for _ in range(6)]
    successes = [[[0.0] * 10 for _ in range(10)] for _ in range(6)]
    last_seen = [[-1] * 10 for _ in range(6)]
    for index in range(n - 1):
        source = prior[index][1]
        following = prior[index + 1][1]
        for position, char in enumerate(source):
            last_seen[position][ord(char) - 48] = index
        age = n - index - 2
        weight = _age_weight(age, model["half_life"])
        for position in range(6):
            for digit in range(10):
                previous = last_seen[position][digit]
                gap = index - previous if previous >= 0 else index + 1
                bucket = _gap_bucket(gap, model["bins"])
                exposures[position][digit][bucket] += weight
                if ord(following[position]) - 48 == digit:
                    successes[position][digit][bucket] += weight

    # Include the most recent observed result in each digit's current gap.
    for position, char in enumerate(prior[-1][1]):
        last_seen[position][ord(char) - 48] = n - 1
    alpha = model["alpha"]
    probabilities = []
    for position in range(6):
        hazards = []
        for digit in range(10):
            previous = last_seen[position][digit]
            gap = n - 1 - previous if previous >= 0 else n
            bucket = _gap_bucket(gap, model["bins"])
            exposure = exposures[position][digit][bucket]
            success = successes[position][digit][bucket]
            hazards.append((success + alpha * baseline[position][digit]) /
                           (exposure + alpha))
        total = sum(hazards)
        probabilities.append([value / total for value in hazards])
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
        raise RuntimeError("Fano hazard codebook must contain five distinct candidates")
    return {"numbers": numbers, "mass": sum(row[2] for row in chosen),
            "punctured_line": puncture + 1,
            "omitted_points": [point + 1 for point in omitted]}


def _normalize(log_weights):
    maximum = max(log_weights)
    weights = [math.exp(value - maximum) for value in log_weights]
    total = sum(weights)
    return [weight / total for weight in weights]


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
        fitted = [_fit_hazard(prior, model) for model in MODELS]
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
            print(f"walk-forward: {target_index + 1}/{DRAW_COUNT}, v7={hits} hits", flush=True)

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
        "walk_forward": "gap states and model weights use only valid outcomes strictly before each target; score before expert update",
        "model_family": "prequential Bayesian per-position renewal hazards conditioned on the prior waiting gap for each digit, encoded by a punctured Fano codebook",
        "models": [dict(model) for model in MODELS],
        "uniform_expected_hits": DRAW_COUNT * 5 / 1_000_000,
        "v7": {"hits": hits, "hit_rate_percent": round(100 * hits / DRAW_COUNT, 8),
               "hit_dates": hit_dates,
               "mean_log_loss": round(loss_sum / DRAW_COUNT, 8),
               "mean_five_candidate_probability_mass": round(mass_sum / DRAW_COUNT, 12),
               "forecasts": forecasts},
        "fixed_model_comparisons": fixed_results,
        "threshold_met": hits >= MIN_TARGET_HITS,
        "interpretation": "historical exploration only; model-family selection is retrospective and not independent validation",
        "elapsed_seconds": round(time.perf_counter() - started, 3),
    }
    folder = ROOT / ".scratch" / "fano-v7-walk-forward"
    folder.mkdir(parents=True, exist_ok=True)
    output = folder / f"results-{report['run_date']}-stage-8-digit-hazard.json"
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
