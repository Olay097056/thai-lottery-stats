"""Walk-forward Fano v7 experiment using structural features of prior draws."""
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
FEATURE_GROUPS = (
    ("sum-band", ("sum-band",)),
    ("odd-count", ("odd-count",)),
    ("distinct-count", ("distinct-count",)),
    ("adjacent-repeat", ("adjacent-repeat",)),
    ("endpoints", ("first-half", "last-parity")),
    ("sum-parity", ("sum-band", "odd-count")),
    ("all-structure", ("sum-band", "odd-count", "distinct-count",
                        "adjacent-repeat", "first-half", "last-parity",
                        "step-count")),
)
MODELS = tuple(
    {"name": f"structure-{group}-beta-{beta:g}-hl-{half_life or 'all'}-alpha-{alpha:g}",
     "kind": "structure", "group": group, "features": features, "beta": beta,
     "half_life": half_life, "alpha": alpha}
    for group, features in FEATURE_GROUPS
    for beta in (0.5, 2.0)
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
    if len({draw_date for draw_date, _ in dated}) != DRAW_COUNT:
        raise RuntimeError("Valid first-prize history contains duplicate dates")
    if any(len(number) != 6 or not number.isascii() or not number.isdigit()
           for _, number in dated):
        raise RuntimeError("A first-prize result is not a six-character ASCII number")
    if any(dated[index - 1][0] >= dated[index][0] for index in range(1, DRAW_COUNT)):
        raise RuntimeError("First-prize history is not strictly chronological")
    return dated


def _features(number):
    digits = [ord(char) - 48 for char in number]
    return {
        "sum-band": sum(digits) // 5,
        "odd-count": sum(digit % 2 for digit in digits),
        "distinct-count": len(set(digits)),
        "adjacent-repeat": sum(digits[index] == digits[index - 1]
                                for index in range(1, 6)),
        "first-half": int(digits[0] >= 5),
        "last-parity": digits[-1] % 2,
        "step-count": sum(abs(digits[index] - digits[index - 1]) == 1
                          for index in range(1, 6)),
    }


def _age_weight(age, half_life):
    return 1.0 if half_life is None else 2.0 ** (-age / half_life)


def _fit_structure(prior, model):
    """Condition next-draw digit marginals on coarse prior-draw structure."""
    global_counts = [[0.0] * 10 for _ in range(6)]
    total_weight = 0.0
    for index, (_, number) in enumerate(prior):
        weight = _age_weight(len(prior) - index - 1, model["half_life"])
        total_weight += weight
        for position, char in enumerate(number):
            global_counts[position][ord(char) - 48] += weight
    global_prior = [
        [(global_counts[position][digit] + 1.0) / (total_weight + 10.0)
         for digit in range(10)]
        for position in range(6)
    ]

    local_counts = [[0.0] * 10 for _ in range(6)]
    local_weight = 0.0
    if len(prior) >= 2:
        context_all = _features(prior[-1][1])
        context = tuple(context_all[name] for name in model["features"])
        for index in range(len(prior) - 1):
            source, following = prior[index][1], prior[index + 1][1]
            source_all = _features(source)
            source_features = tuple(source_all[name] for name in model["features"])
            matches = sum(left == right for left, right in zip(source_features, context))
            similarity = math.exp(model["beta"] * matches / len(context))
            age = len(prior) - index - 2
            weight = _age_weight(age, model["half_life"]) * similarity
            local_weight += weight
            for position, char in enumerate(following):
                local_counts[position][ord(char) - 48] += weight

    alpha = model["alpha"]
    return [
        [(local_counts[position][digit] + alpha * global_prior[position][digit]) /
         (local_weight + alpha) for digit in range(10)]
        for position in range(6)
    ]


def _best_fano_codebook(probabilities):
    rankings = [sorted(range(10), key=lambda digit: (-probabilities[position][digit], digit))[:2]
                for position in range(6)]
    best = None
    for puncture in range(7):
        retained_lines = [line for line in range(7) if line != puncture]
        words = []
        for point in range(7):
            number = "".join(str(rankings[position][int(point in fano.FANO_LINES[line])])
                             for position, line in enumerate(retained_lines))
            mass = math.prod(probabilities[position][int(char)]
                             for position, char in enumerate(number))
            words.append((point, number, mass))
        for omitted_left in range(7):
            for omitted_right in range(omitted_left + 1, 7):
                selected = [row for row in words if row[0] not in (omitted_left, omitted_right)]
                score = sum(row[2] for row in selected)
                key = (score, -puncture, -omitted_left, -omitted_right)
                if best is None or key > best[0]:
                    best = (key, selected, puncture, (omitted_left, omitted_right))
    _, selected, puncture, omitted = best
    numbers = [row[1] for row in selected]
    if len(numbers) != 5 or len(set(numbers)) != 5:
        raise RuntimeError("Fano structural-context codebook must contain five distinct candidates")
    return {"numbers": numbers, "mass": sum(row[2] for row in selected),
            "punctured_line": puncture + 1,
            "omitted_points": [value + 1 for value in omitted]}


def _normalize(log_weights):
    maximum = max(log_weights)
    weights = [math.exp(value - maximum) for value in log_weights]
    total = sum(weights)
    return [weight / total for weight in weights]


def _log_loss(probabilities, actual):
    return -sum(math.log(probabilities[position][ord(char) - 48])
                for position, char in enumerate(actual))


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
        fitted = [_fit_structure(prior, model) for model in MODELS]
        weights = _normalize(log_weights)
        mixture = [
            [sum(weights[index] * fitted[index][position][digit]
                 for index in range(len(MODELS))) for digit in range(10)]
            for position in range(6)
        ]
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

        # Update expert weights only after the target is scored.
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
        "walk_forward": "structural context, posterior probabilities, and model weights use only valid outcomes strictly before each target; target scored before weight updates",
        "model_family": "prequential mixture of Bayesian next-draw digit models conditioned on coarse sum, parity, repeat, diversity, endpoint and step features of the prior result; punctured Fano codebook selection",
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
    output = folder / f"results-{report['run_date']}-stage-5-structural-context.json"
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
