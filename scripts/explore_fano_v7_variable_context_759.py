"""Prequential Fano decoder using Bayesian variable-order digit contexts."""
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
ORDERS = (0, 1, 2, 3, 4, 6, 8, 12, 24)
ALPHAS = (0.25, 1.0)
MODELS = tuple(
    {"name": f"variable-context-order-{order}-alpha-{alpha:g}",
     "order": order, "alpha": alpha}
    for order in ORDERS
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


def _context_counts(stream):
    counts = {order: {} for order in ORDERS}
    for index, char in enumerate(stream):
        if not char.isdigit():
            continue
        digit = ord(char) - 48
        for order in ORDERS:
            if index < order:
                continue
            context = stream[index - order:index] if order else ""
            row = counts[order].setdefault(context, [0] * 10)
            row[digit] += 1
    return counts


def _probabilities(model, stream, prefix, counts):
    order = model["order"]
    history = stream + prefix
    context = history[-order:] if order else ""
    observed = counts[order].get(context, [0] * 10)
    alpha = model["alpha"]
    denominator = sum(observed) + 10 * alpha
    return [(observed[digit] + alpha) / denominator for digit in range(10)]


def _normalize(log_values):
    maximum = max(log_values)
    values = [math.exp(value - maximum) for value in log_values]
    total = sum(values)
    return [value / total for value in values]


def _logsumexp(values):
    maximum = max(values)
    return maximum + math.log(sum(math.exp(value - maximum) for value in values))


def _codeword(stream, counts, models, initial_log_weights, retained_lines, point):
    prefix = ""
    log_prefix_weights = list(initial_log_weights)
    for position, line in enumerate(retained_lines):
        model_probs = [_probabilities(model, stream, prefix, counts) for model in models]
        posterior = _normalize(log_prefix_weights)
        mixture = [sum(posterior[index] * model_probs[index][digit]
                       for index in range(len(models))) for digit in range(10)]
        top_two = sorted(range(10), key=lambda digit: (-mixture[digit], digit))[:2]
        digit = top_two[int(point in fano.FANO_LINES[line])]
        prefix += str(digit)
        log_prefix_weights = [log_prefix_weights[index] +
                              math.log(model_probs[index][digit])
                              for index in range(len(models))]
    return prefix, math.exp(_logsumexp(log_prefix_weights))


def _best_codebook(stream, counts, models, log_weights):
    weights = _normalize(log_weights)
    initial_logs = [math.log(max(weight, 1e-300)) for weight in weights]
    best = None
    for puncture in range(7):
        lines = [line for line in range(7) if line != puncture]
        words = [_codeword(stream, counts, models, initial_logs, lines, point)
                 for point in range(7)]
        if len({number for number, _ in words}) != 7:
            raise RuntimeError("Variable-context Fano codewords must be unique")
        chosen = sorted(range(7), key=lambda point: (-words[point][1], point))[:5]
        score = sum(words[point][1] for point in chosen)
        key = (score, -puncture, tuple(-point for point in chosen))
        if best is None or key > best[0]:
            best = (key, words, puncture, chosen)
    _, words, puncture, chosen = best
    numbers = [words[point][0] for point in chosen]
    if len(numbers) != 5 or len(set(numbers)) != 5:
        raise RuntimeError("Variable-context Fano must select five distinct candidates")
    return {"numbers": numbers, "mass": sum(words[point][1] for point in chosen),
            "punctured_line": puncture + 1,
            "selected_points": [point + 1 for point in chosen]}


def run():
    started = time.perf_counter()
    dated = _load_draws()
    material = "\n".join(f"{day.isoformat()}|{number}" for day, number in dated).encode("ascii")
    fingerprint = hashlib.sha256(material).hexdigest()
    stream = ""
    log_weights = [0.0] * len(MODELS)
    hits = 0
    hit_dates = []
    loss_sum = 0.0
    mass_sum = 0.0
    model_loss_sums = [0.0] * len(MODELS)
    forecasts = []
    for target_index, (target_date, actual) in enumerate(dated):
        counts = _context_counts(stream)
        weights = _normalize(log_weights)
        selected = _best_codebook(stream, counts, MODELS, log_weights)
        actual_prefix = ""
        model_losses = [0.0] * len(MODELS)
        for char in actual:
            digit = ord(char) - 48
            for index, model in enumerate(MODELS):
                model_losses[index] -= math.log(
                    _probabilities(model, stream, actual_prefix, counts)[digit]
                )
            actual_prefix += char
        mixture_loss = -_logsumexp([
            math.log(max(weights[index], 1e-300)) - model_losses[index]
            for index in range(len(MODELS))
        ])
        loss_sum += mixture_loss
        mass_sum += selected["mass"]
        hit = actual in selected["numbers"]
        hits += int(hit)
        if hit:
            hit_dates.append(target_date.isoformat())
        model_loss_sums = [model_loss_sums[index] + model_losses[index]
                           for index in range(len(MODELS))]
        forecasts.append({
            "target_date": target_date.isoformat(),
            "prior_valid_draws": target_index,
            "actual": actual,
            "candidates": selected["numbers"],
            "hit": hit,
            "five_candidate_probability_mass": selected["mass"],
            "log_loss": mixture_loss,
            "top_expert_weights_before_target": sorted(
                ((model["name"], weights[index]) for index, model in enumerate(MODELS)),
                key=lambda row: -row[1])[:5],
            "family_weights_before_target": {"bayesian-variable-order-context": 1.0},
            "punctured_line": selected["punctured_line"],
            "selected_points": selected["selected_points"],
        })
        log_weights = [log_weights[index] - model_losses[index]
                       for index in range(len(MODELS))]
        stream += actual + "|"
        if (target_index + 1) % 100 == 0:
            print(f"walk-forward: {target_index + 1}/{DRAW_COUNT}, v7={hits} hits",
                  flush=True)

    fixed_results = [
        {"name": MODELS[index]["name"],
         "mean_log_loss": round(model_loss_sums[index] / DRAW_COUNT, 8)}
        for index in range(len(MODELS))
    ]
    report = {
        "run_date": datetime.now(astra.THAILAND_TZ).date().isoformat(),
        "draw_count": DRAW_COUNT,
        "date_range": [dated[0][0].isoformat(), dated[-1][0].isoformat()],
        "actuals_sha256": fingerprint,
        "target": "exact six-digit first-prize hit; exactly five distinct predictions per draw",
        "walk_forward": "the digit stream contains only earlier complete draws and a known draw separator; variable-order posterior and expert weights update after each target is scored",
        "model_family": "Bayesian mixture of smoothed variable-order contexts over the full prior digit stream with draw separators; prefix-conditioned Fano codebook selection",
        "expert_count": len(MODELS),
        "family_model_counts": {"bayesian-variable-order-context": len(MODELS)},
        "experts": [{"family": "bayesian-variable-order-context", **dict(model)}
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
        "interpretation": "historical exploratory evaluation; context-order family was developed after reviewing previous same-sample results",
        "elapsed_seconds": round(time.perf_counter() - started, 3),
    }
    folder = ROOT / ".scratch" / "fano-v7-walk-forward"
    folder.mkdir(parents=True, exist_ok=True)
    output = folder / f"results-{report['run_date']}-stage-33-variable-context.json"
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
