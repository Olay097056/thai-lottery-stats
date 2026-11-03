"""Walk-forward Fano v7 experiment with modular digit-increment models."""
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
    {"name": f"cyclic-delta-{kind}-hl-{half_life or 'all'}-alpha-{alpha:g}",
     "kind": kind, "half_life": half_life, "alpha": alpha}
    for kind in ("increment", "increment-momentum")
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


def _digits(number):
    return [ord(char) - 48 for char in number]


def _age_weight(age, half_life):
    return 1.0 if half_life is None else 2.0 ** (-age / half_life)


def _fit_delta(prior, model):
    """Predict each next digit by applying learned Z10 increments to last draw."""
    if len(prior) < 2:
        return [[0.1] * 10 for _ in range(6)]
    digits = [_digits(number) for _, number in prior]
    increments = [
        [(right - left) % 10 for left, right in zip(digits[index - 1], digits[index])]
        for index in range(1, len(digits))
    ]
    alpha = model["alpha"]
    probabilities = []
    for position in range(6):
        global_counts = [0.0] * 10
        total_weight = 0.0
        for index, row in enumerate(increments):
            weight = _age_weight(len(increments) - index - 1, model["half_life"])
            global_counts[row[position]] += weight
            total_weight += weight
        global_delta = [(global_counts[delta] + 1.0) / (total_weight + 10.0)
                        for delta in range(10)]

        if model["kind"] == "increment-momentum":
            if len(increments) >= 2:
                context_delta = increments[-1][position]
                counts = [0.0] * 10
                local_weight = 0.0
                for index in range(1, len(increments)):
                    if increments[index - 1][position] != context_delta:
                        continue
                    weight = _age_weight(len(increments) - index - 1, model["half_life"])
                    counts[increments[index][position]] += weight
                    local_weight += weight
                delta_probabilities = [
                    (counts[delta] + alpha * global_delta[delta]) / (local_weight + alpha)
                    for delta in range(10)
                ]
            else:
                delta_probabilities = global_delta
        elif model["kind"] == "increment":
            delta_probabilities = global_delta
        else:
            raise ValueError(f"unknown cyclic model kind: {model['kind']}")

        current = digits[-1][position]
        next_probabilities = [0.0] * 10
        for delta, probability in enumerate(delta_probabilities):
            next_probabilities[(current + delta) % 10] += probability
        probabilities.append(next_probabilities)
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
                selected = [row for row in words if row[0] not in (omit_left, omit_right)]
                score = sum(row[2] for row in selected)
                key = (score, -puncture, -omit_left, -omit_right)
                if best is None or key > best[0]:
                    best = (key, selected, puncture, (omit_left, omit_right))
    _, selected, puncture, omitted = best
    numbers = [row[1] for row in selected]
    if len(numbers) != 5 or len(set(numbers)) != 5:
        raise RuntimeError("Fano cyclic codebook must contain five distinct candidates")
    return {"numbers": numbers, "mass": sum(row[2] for row in selected),
            "punctured_line": puncture + 1,
            "omitted_points": [point + 1 for point in omitted]}


def _normalize(log_weights):
    maximum = max(log_weights)
    weights = [math.exp(value - maximum) for value in log_weights]
    total = sum(weights)
    return [value / total for value in weights]


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
        fitted = [_fit_delta(prior, model) for model in MODELS]
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
            "target_date": target_date.isoformat(),
            "prior_valid_draws": len(prior),
            "actual": actual,
            "candidates": selected["numbers"],
            "hit": hit,
            "five_candidate_probability_mass": selected["mass"],
            "log_loss": loss,
            "model_weights_before_target": {
                model["name"]: weights[index] for index, model in enumerate(MODELS)
            },
            "punctured_line": selected["punctured_line"],
            "omitted_points": selected["omitted_points"],
        })
        # Strict prequential update: current result affects only later draws.
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
        "walk_forward": "increment distributions, model weights, and candidates use only valid outcomes strictly before each target; target scored before weight updates",
        "model_family": "prequential mixture of prior-only per-position modular Z10 increment and increment-momentum models, encoded as a punctured Fano codebook",
        "models": [dict(model) for model in MODELS],
        "uniform_expected_hits": DRAW_COUNT * 5 / 1_000_000,
        "v7": {"hits": hits, "hit_rate_percent": round(100 * hits / DRAW_COUNT, 8),
               "hit_dates": hit_dates,
               "mean_log_loss": round(loss_sum / DRAW_COUNT, 8),
               "mean_five_candidate_probability_mass": round(mass_sum / DRAW_COUNT, 12),
               "forecasts": forecasts},
        "fixed_model_comparisons": fixed_results,
        "threshold_met": hits >= MIN_TARGET_HITS,
        "interpretation": "historical exploration only; family choice is retrospective and not independent validation",
        "elapsed_seconds": round(time.perf_counter() - started, 3),
    }
    folder = ROOT / ".scratch" / "fano-v7-walk-forward"
    folder.mkdir(parents=True, exist_ok=True)
    output = folder / f"results-{report['run_date']}-stage-6-cyclic-delta.json"
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
