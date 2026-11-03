"""Prequential Fano v7 experiment with a joint adjacent-digit Markov model."""
from __future__ import annotations

from datetime import datetime
import hashlib
import itertools
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
MODELS = tuple(
    {"name": f"within-number-markov-hl-{half_life or 'all'}-alpha-{alpha:g}",
     "half_life": half_life, "alpha": alpha}
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


def _age_weight(age, half_life):
    return 1.0 if half_life is None else 2.0 ** (-age / half_life)


def _fit_chain(prior, model):
    """Fit P(d0) and adjacent-coordinate transitions from prior results only."""
    alpha = model["alpha"]
    half_life = model["half_life"]
    totals = [0.0] * 6
    digit_counts = [[0.0] * 10 for _ in range(6)]
    for index, (_, number) in enumerate(prior):
        weight = _age_weight(len(prior) - index - 1, half_life)
        for position, char in enumerate(number):
            digit_counts[position][ord(char) - 48] += weight
            totals[position] += weight

    marginal_priors = [
        [(digit_counts[pos][digit] + 1.0) / (totals[pos] + 10.0)
         for digit in range(10)]
        for pos in range(6)
    ]
    start = marginal_priors[0]
    transitions = []
    for position in range(1, 6):
        pair_counts = [[0.0] * 10 for _ in range(10)]
        row_totals = [0.0] * 10
        for index, (_, number) in enumerate(prior):
            weight = _age_weight(len(prior) - index - 1, half_life)
            left = ord(number[position - 1]) - 48
            right = ord(number[position]) - 48
            pair_counts[left][right] += weight
            row_totals[left] += weight
        transitions.append([
            [(pair_counts[left][right] + alpha * marginal_priors[position][right]) /
             (row_totals[left] + alpha) for right in range(10)]
            for left in range(10)
        ])
    return {"start": start, "transitions": transitions}


def _distribution_loss(chain, actual):
    value = math.log(chain["start"][ord(actual[0]) - 48])
    for position, transition in enumerate(chain["transitions"], start=1):
        left = ord(actual[position - 1]) - 48
        right = ord(actual[position]) - 48
        value += math.log(transition[left][right])
    return -value


def _mix_chains(chains, weights):
    start = [sum(weights[index] * chains[index]["start"][digit]
                 for index in range(len(chains))) for digit in range(10)]
    transitions = []
    for edge in range(5):
        transitions.append([
            [sum(weights[index] * chains[index]["transitions"][edge][left][right]
                 for index in range(len(chains))) for right in range(10)]
            for left in range(10)
        ])
    return {"start": start, "transitions": transitions}


def _marginals(chain):
    result = [chain["start"]]
    for transition in chain["transitions"]:
        previous = result[-1]
        result.append([
            sum(previous[left] * transition[left][right] for left in range(10))
            for right in range(10)
        ])
    return result


def _number_probability(chain, number):
    probability = chain["start"][ord(number[0]) - 48]
    for position, transition in enumerate(chain["transitions"], start=1):
        probability *= transition[ord(number[position - 1]) - 48][ord(number[position]) - 48]
    return probability


def _best_fano_codebook(chain):
    marginals = _marginals(chain)
    rankings = [sorted(range(10), key=lambda digit: (-marginals[pos][digit], digit))[:2]
                for pos in range(6)]
    best = None
    for puncture in range(7):
        retained_lines = [line for line in range(7) if line != puncture]
        words = []
        for point in range(7):
            number = "".join(
                str(rankings[position][int(point in fano.FANO_LINES[line])])
                for position, line in enumerate(retained_lines)
            )
            words.append((point, number, _number_probability(chain, number)))
        for omitted in itertools.combinations(range(7), 2):
            chosen = [row for row in words if row[0] not in omitted]
            score = sum(row[2] for row in chosen)
            candidate = (score, -puncture, tuple(-point for point in omitted), chosen, omitted)
            if best is None or candidate[:3] > best[:3]:
                best = candidate
    _, neg_puncture, _, selected, omitted = best
    numbers = [row[1] for row in selected]
    if len(numbers) != 5 or len(set(numbers)) != 5:
        raise RuntimeError("Fano joint-Markov codebook must contain five distinct candidates")
    return {
        "numbers": numbers,
        "probability_mass": sum(row[2] for row in selected),
        "punctured_line": -neg_puncture + 1,
        "omitted_points": [value + 1 for value in omitted],
    }


def _normalize(log_weights):
    maximum = max(log_weights)
    values = [math.exp(value - maximum) for value in log_weights]
    total = sum(values)
    return [value / total for value in values]


def run():
    started = time.perf_counter()
    dated = _load_draws()
    material = "\n".join(f"{day.isoformat()}|{number}" for day, number in dated).encode("ascii")
    fingerprint = hashlib.sha256(material).hexdigest()
    log_weights = [0.0] * len(MODELS)
    model_hits = [0] * len(MODELS)
    model_losses = [0.0] * len(MODELS)
    hits = 0
    hit_dates = []
    loss_sum = 0.0
    forecasts = []

    for target_index, (target_date, actual) in enumerate(dated):
        prior = dated[:target_index]
        chains = [_fit_chain(prior, model) for model in MODELS]
        weights = _normalize(log_weights)
        mixture = _mix_chains(chains, weights)
        selection = _best_fano_codebook(mixture)
        hit = actual in selection["numbers"]
        hits += int(hit)
        if hit:
            hit_dates.append(target_date.isoformat())
        mixture_loss = _distribution_loss(mixture, actual)
        loss_sum += mixture_loss

        per_model = []
        for index, (model, chain) in enumerate(zip(MODELS, chains)):
            model_loss = _distribution_loss(chain, actual)
            model_hit = actual in _best_fano_codebook(chain)["numbers"]
            model_hits[index] += int(model_hit)
            model_losses[index] += model_loss
            per_model.append({"name": model["name"], "hit": model_hit,
                              "joint_log_loss": model_loss})

        forecasts.append({
            "target_date": target_date.isoformat(),
            "prior_valid_draws": len(prior),
            "actual": actual,
            "candidates": selection["numbers"],
            "hit": hit,
            "five_candidate_probability_mass": selection["probability_mass"],
            "joint_log_loss": mixture_loss,
            "model_weights_before_target": {
                model["name"]: weights[index] for index, model in enumerate(MODELS)
            },
            "punctured_line": selection["punctured_line"],
            "omitted_points": selection["omitted_points"],
            "fixed_model_results": per_model,
        })

        # Update expert weights only after scoring this target.
        log_weights = [log_weights[index] - per_model[index]["joint_log_loss"]
                       for index in range(len(MODELS))]
        if (target_index + 1) % 100 == 0:
            print(f"walk-forward: {target_index + 1}/{DRAW_COUNT}, v7={hits} hits", flush=True)

    fixed_results = [
        {"name": MODELS[index]["name"], "hits": model_hits[index],
         "hit_rate_percent": round(100 * model_hits[index] / DRAW_COUNT, 8),
         "mean_joint_log_loss": round(model_losses[index] / DRAW_COUNT, 8)}
        for index in range(len(MODELS))
    ]
    fixed_results.sort(key=lambda row: (-row["hits"], row["mean_joint_log_loss"], row["name"]))
    report = {
        "run_date": datetime.now(astra.THAILAND_TZ).date().isoformat(),
        "draw_count": DRAW_COUNT,
        "date_range": [dated[0][0].isoformat(), dated[-1][0].isoformat()],
        "actuals_sha256": fingerprint,
        "target": "exact six-digit first-prize hit; five distinct predictions per draw",
        "walk_forward": "all model fitting and mixture weights use only valid outcomes strictly before each target; score target before updating model weights",
        "model_family": "prequential expert mixture of Bayesian within-number adjacent-digit Markov chains; Fano codewords selected by joint probability mass",
        "models": [dict(model) for model in MODELS],
        "uniform_expected_hits": DRAW_COUNT * 5 / 1_000_000,
        "v7": {
            "hits": hits,
            "hit_rate_percent": round(100 * hits / DRAW_COUNT, 8),
            "hit_dates": hit_dates,
            "mean_joint_log_loss": round(loss_sum / DRAW_COUNT, 8),
            "forecasts": forecasts,
        },
        "fixed_model_comparisons": fixed_results,
        "interpretation": "historical research only; not independent validation or evidence of improved odds",
        "elapsed_seconds": round(time.perf_counter() - started, 3),
    }
    folder = ROOT / ".scratch" / "fano-v7-walk-forward"
    folder.mkdir(parents=True, exist_ok=True)
    output = folder / f"results-{report['run_date']}-stage-4-joint-digit-markov.json"
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({
        "hits": hits,
        "hit_rate_percent": report["v7"]["hit_rate_percent"],
        "threshold_met": hits >= math.ceil(0.40 * DRAW_COUNT),
        "uniform_expected_hits": report["uniform_expected_hits"],
        "mean_joint_log_loss": report["v7"]["mean_joint_log_loss"],
        "best_fixed_model": fixed_results[0],
        "data_fingerprint": fingerprint,
        "result_file": str(output),
        "elapsed_seconds": report["elapsed_seconds"],
    }, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    run()
