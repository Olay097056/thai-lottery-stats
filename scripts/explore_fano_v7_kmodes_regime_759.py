"""Prequential Fano v7 with online forecasts from clustered latent regimes."""
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
CLUSTERS = (2, 3, 4, 6)
ITERATIONS = (3, 6)
SHRINKAGES = (5.0, 20.0)
MODELS = tuple(
    {"name": f"kmodes-regime-k-{clusters}-iter-{iterations}-alpha-{alpha:g}",
     "clusters": clusters, "iterations": iterations, "alpha": alpha}
    for clusters in CLUSTERS
    for iterations in ITERATIONS
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


def _distance(left, right):
    return sum(a != b for a, b in zip(left, right))


def _cluster(prior, requested_clusters, iterations):
    numbers = [number for _, number in prior]
    if not numbers:
        return []
    k = min(requested_clusters, len(numbers))
    centers = [numbers[0]]
    while len(centers) < k:
        chosen = max(
            range(len(numbers)),
            key=lambda index: (min(_distance(numbers[index], center) for center in centers),
                               -index),
        )
        centers.append(numbers[chosen])
    for _ in range(iterations):
        labels = [min(range(k), key=lambda state: (_distance(number, centers[state]), state))
                  for number in numbers]
        groups = [[index for index, label in enumerate(labels) if label == state]
                  for state in range(k)]
        updated = []
        for state, members in enumerate(groups):
            if not members:
                updated.append(centers[state])
                continue
            digits = []
            for position in range(6):
                counts = [0] * 10
                for index in members:
                    counts[ord(numbers[index][position]) - 48] += 1
                digits.append(str(max(range(10), key=lambda digit: (counts[digit], -digit))))
            updated.append("".join(digits))
        if updated == centers:
            break
        centers = updated
    labels = [min(range(k), key=lambda state: (_distance(number, centers[state]), state))
              for number in numbers]
    return labels


def _predict(prior, labels, requested_clusters, alpha):
    if not prior:
        return [[0.1] * 10 for _ in range(6)]
    k = min(requested_clusters, len(prior))
    global_counts = [[0.0] * 10 for _ in range(6)]
    state_counts = [0.0] * k
    emission_counts = [[[0.0] * 10 for _ in range(6)] for _ in range(k)]
    for (_, number), state in zip(prior, labels):
        state_counts[state] += 1.0
        for position, char in enumerate(number):
            digit = ord(char) - 48
            global_counts[position][digit] += 1.0
            emission_counts[state][position][digit] += 1.0
    global_prior = [[(global_counts[pos][digit] + 1.0) /
                     (len(prior) + 10.0) for digit in range(10)]
                    for pos in range(6)]
    cluster_prior = [(state_counts[state] + 1.0) / (len(prior) + k) for state in range(k)]

    transitions = [[0.0] * k for _ in range(k)]
    for current, following in zip(labels, labels[1:]):
        transitions[current][following] += 1.0
    current_state = labels[-1]
    transition_total = sum(transitions[current_state])
    next_state = [
        (transitions[current_state][state] + alpha * cluster_prior[state]) /
        (transition_total + alpha)
        for state in range(k)
    ]
    probabilities = []
    for position in range(6):
        row = []
        for digit in range(10):
            likelihood = 0.0
            for state in range(k):
                emission = (emission_counts[state][position][digit] +
                            alpha * global_prior[position][digit]) / (state_counts[state] + alpha)
                likelihood += next_state[state] * emission
            row.append(likelihood)
        probabilities.append(row)
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
        chosen = sorted(words, key=lambda row: (-row[2], row[0]))[:5]
        score = sum(row[2] for row in chosen)
        key = (score, -puncture, tuple(-row[0] for row in chosen))
        if best is None or key > best[0]:
            best = (key, chosen, puncture)
    _, chosen, puncture = best
    numbers = [row[1] for row in chosen]
    if len(numbers) != 5 or len(set(numbers)) != 5:
        raise RuntimeError("Fano regime codebook must contain five distinct candidates")
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
        label_cache = {
            (clusters, iterations): _cluster(prior, clusters, iterations)
            for clusters in CLUSTERS for iterations in ITERATIONS
        }
        predictions = [
            _predict(prior, label_cache[(model["clusters"], model["iterations"])],
                     model["clusters"], model["alpha"])
            for model in MODELS
        ]
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
                key=lambda row: -row[1])[:5],
            "family_weights_before_target": {"kmodes-latent-regime": 1.0},
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
        "walk_forward": "k-modes regimes are refit only on valid draws before each target; the regime-transition and digit-emission distributions predict the next draw, then model weights update after scoring",
        "model_family": "online k-modes latent-regime transition model with Bayesian emission shrinkage; punctured Fano codebook selection",
        "expert_count": len(MODELS),
        "family_model_counts": {"kmodes-latent-regime": len(MODELS)},
        "experts": [{"family": "kmodes-latent-regime", **dict(model)}
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
        "interpretation": "historical research only; the latent-regime hypothesis is exploratory and requires prospective validation",
        "elapsed_seconds": round(time.perf_counter() - started, 3),
    }
    folder = ROOT / ".scratch" / "fano-v7-walk-forward"
    folder.mkdir(parents=True, exist_ok=True)
    output = folder / f"results-{report['run_date']}-stage-26-kmodes-regime.json"
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
