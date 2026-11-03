"""Strict walk-forward Bayesian shrinkage experiment with Fano codebooks.

Research-only: scores all 759 cached prize-1 outcomes without changing a
production formula. Every forecast is fit on strictly earlier outcomes.
"""
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
TARGET_HITS = 76
PAIR_STRENGTH = 20.0
TRIPLE_STRENGTH = 50.0
RECENCY_HALF_LIFE = 120
MODELS = (
    {"name": "independent-dirichlet", "order": 0, "half_life": None},
    {"name": "pair-chain-full-history", "order": 1, "half_life": None},
    {"name": "triple-chain-full-history", "order": 2, "half_life": None},
    {"name": "triple-chain-half-life-120", "order": 2, "half_life": RECENCY_HALF_LIFE},
)


def _load_draws():
    history = astra.load_existing_astra_history()
    dated = []
    for row in history:
        values = astra._category_values(row, "prize1", 6)
        if values is None:
            continue
        dated.append((astra._history_date(row["date"]), values[0]))
    dated.sort()
    if len(dated) != DRAW_COUNT:
        raise RuntimeError(f"Expected {DRAW_COUNT} valid first-prize draws, found {len(dated)}")
    if len({draw_date for draw_date, _ in dated}) != len(dated):
        raise RuntimeError("Valid first-prize history contains duplicate dates")
    if any(len(value) != 6 or not value.isascii() or not value.isdigit() for _, value in dated):
        raise RuntimeError("A first-prize result is not six ASCII digits")
    if any(dated[index - 1][0] >= dated[index][0] for index in range(1, len(dated))):
        raise RuntimeError("First-prize history is not strictly chronological")
    return dated


def _fit(prior, model):
    """Fit normalized Dirichlet-smoothed positional and Markov conditionals."""
    position_counts = [[0.0] * 10 for _ in range(6)]
    pair_counts = [[[0.0] * 10 for _ in range(10)] for _ in range(5)]
    triple_counts = [[[[0.0] * 10 for _ in range(10)] for _ in range(10)] for _ in range(4)]
    total_weight = 0.0
    for index, (_, value) in enumerate(prior):
        age = len(prior) - index - 1
        weight = 1.0 if model["half_life"] is None else 2.0 ** (-age / model["half_life"])
        digits = [ord(char) - 48 for char in value]
        total_weight += weight
        for position, digit in enumerate(digits):
            position_counts[position][digit] += weight
        for position in range(5):
            pair_counts[position][digits[position]][digits[position + 1]] += weight
        for position in range(4):
            triple_counts[position][digits[position]][digits[position + 1]][digits[position + 2]] += weight

    # Dirichlet(1) posterior predictive for each ordered position.
    marginal = [
        [(position_counts[position][digit] + 1.0) / (total_weight + 10.0) for digit in range(10)]
        for position in range(6)
    ]
    pair_conditional = [None] * 6
    for position in range(1, 6):
        table = [[0.0] * 10 for _ in range(10)]
        counts = pair_counts[position - 1]
        for previous in range(10):
            context_total = sum(counts[previous])
            denominator = context_total + PAIR_STRENGTH
            for digit in range(10):
                table[previous][digit] = (
                    counts[previous][digit] + PAIR_STRENGTH * marginal[position][digit]
                ) / denominator
        pair_conditional[position] = table

    triple_conditional = [None] * 6
    for position in range(2, 6):
        table = [[[0.0] * 10 for _ in range(10)] for _ in range(10)]
        counts = triple_counts[position - 2]
        for previous_two in range(10):
            for previous_one in range(10):
                context_total = sum(counts[previous_two][previous_one])
                denominator = context_total + TRIPLE_STRENGTH
                for digit in range(10):
                    backoff = pair_conditional[position][previous_one][digit]
                    table[previous_two][previous_one][digit] = (
                        counts[previous_two][previous_one][digit]
                        + TRIPLE_STRENGTH * backoff
                    ) / denominator
        triple_conditional[position] = table

    # Exact forward marginals for the normalized order-1 / order-2 chain.
    chain_marginal = [[0.0] * 10 for _ in range(6)]
    chain_marginal[0] = list(marginal[0])
    if model["order"] == 0:
        chain_marginal = marginal
    elif model["order"] == 1:
        for position in range(1, 6):
            for previous in range(10):
                for digit in range(10):
                    chain_marginal[position][digit] += (
                        chain_marginal[position - 1][previous]
                        * pair_conditional[position][previous][digit]
                    )
    else:
        state = [[
            marginal[0][first] * pair_conditional[1][first][second]
            for second in range(10)
        ] for first in range(10)]
        for first in range(10):
            for second in range(10):
                chain_marginal[1][second] += state[first][second]
        for position in range(2, 6):
            next_state = [[0.0] * 10 for _ in range(10)]
            for previous_two in range(10):
                for previous_one in range(10):
                    state_mass = state[previous_two][previous_one]
                    for digit in range(10):
                        mass = state_mass * triple_conditional[position][previous_two][previous_one][digit]
                        next_state[previous_one][digit] += mass
                        chain_marginal[position][digit] += mass
            state = next_state

    return {
        "model": model,
        "marginal": chain_marginal,
        "pair": pair_conditional,
        "triple": triple_conditional,
        "total_weight": total_weight,
    }


def _log_probability(fit, number):
    digits = [ord(char) - 48 for char in number]
    model = fit["model"]
    total = math.log(fit["marginal"][0][digits[0]])
    if model["order"] == 0:
        for position in range(1, 6):
            total += math.log(fit["marginal"][position][digits[position]])
    elif model["order"] == 1:
        for position in range(1, 6):
            total += math.log(fit["pair"][position][digits[position - 1]][digits[position]])
    else:
        total += math.log(fit["pair"][1][digits[0]][digits[1]])
        for position in range(2, 6):
            total += math.log(
                fit["triple"][position][digits[position - 2]][digits[position - 1]][digits[position]]
            )
    return total


def _fano_candidates(marginal, log_probability):
    alphabets = [
        sorted(range(10), key=lambda digit: (-marginal[position][digit], digit))[:2]
        for position in range(6)
    ]
    best = None
    for puncture in range(7):
        retained_lines = [line for line in range(7) if line != puncture]
        codewords = []
        for point in range(7):
            bits = [int(point in fano.FANO_LINES[line]) for line in retained_lines]
            number = "".join(str(alphabets[position][bit]) for position, bit in enumerate(bits))
            codewords.append((number, point, log_probability(number)))
        if len({number for number, _, _ in codewords}) != 7:
            raise RuntimeError("Punctured Fano codebook produced duplicate numbers")
        chosen = sorted(codewords, key=lambda row: (-row[2], row[0], row[1]))[:5]
        numbers = [row[0] for row in chosen]
        if len(set(numbers)) != 5:
            raise RuntimeError("Fano forecast did not contain five distinct numbers")
        min_distance = min(
            sum(left != right for left, right in zip(a, b))
            for index, a in enumerate(numbers) for b in numbers[index + 1:]
        )
        if min_distance < 3:
            raise RuntimeError("Punctured Fano code lost its minimum distance")
        mass = sum(math.exp(row[2]) for row in chosen)
        candidate = {"numbers": numbers, "mass": mass, "puncture": puncture + 1,
                     "minimum_hamming_distance": min_distance}
        if best is None or (mass, tuple(numbers)) > (best["mass"], tuple(best["numbers"])):
            best = candidate
    return best


def _logsumexp(values):
    maximum = max(values)
    return maximum + math.log(sum(math.exp(value - maximum) for value in values))


def run():
    started = time.perf_counter()
    dated = _load_draws()
    actuals = [(draw_date.isoformat(), number) for draw_date, number in dated]
    actuals_sha256 = hashlib.sha256("\n".join(
        f"{draw_date}|{number}" for draw_date, number in actuals
    ).encode("ascii")).hexdigest()
    log_model_weights = [0.0] * len(MODELS)
    model_results = {
        model["name"]: {"hits": 0, "log_loss_sum": 0.0, "candidate_mass_sum": 0.0,
                        "forecasts": []}
        for model in MODELS
    }
    ensemble = {"hits": 0, "log_loss_sum": 0.0, "candidate_mass_sum": 0.0, "forecasts": []}
    rolling_ensemble = {"hits": 0, "log_loss_sum": 0.0, "candidate_mass_sum": 0.0, "forecasts": []}
    past_model_log_scores = []

    for target_index, (target_date, actual) in enumerate(dated):
        prior = dated[:target_index]
        fitted = [_fit(prior, model) for model in MODELS]
        log_scores = [_log_probability(item, actual) for item in fitted]
        normalized_weights_log = [
            value - _logsumexp(log_model_weights) for value in log_model_weights
        ]
        weights = [math.exp(value) for value in normalized_weights_log]
        recent_scores = past_model_log_scores[-RECENCY_HALF_LIFE:]
        rolling_log_weights = [
            sum(row[index] for row in recent_scores) for index in range(len(MODELS))
        ]
        rolling_weights_log = [
            value - _logsumexp(rolling_log_weights) for value in rolling_log_weights
        ]
        rolling_weights = [math.exp(value) for value in rolling_weights_log]

        for model, fitted_model in zip(MODELS, fitted):
            name = model["name"]
            result = _fano_candidates(
                fitted_model["marginal"],
                lambda number, fm=fitted_model: _log_probability(fm, number),
            )
            hit = actual in result["numbers"]
            log_loss = -_log_probability(fitted_model, actual)
            row = {
                "target_date": target_date.isoformat(), "prior_draws": len(prior),
                "actual": actual, "candidates": result["numbers"], "hit": hit,
                "predictive_log_loss": round(log_loss, 12),
                "five_candidate_probability_mass": round(result["mass"], 14),
                "punctured_line": result["puncture"],
                "minimum_hamming_distance": result["minimum_hamming_distance"],
            }
            model_results[name]["hits"] += int(hit)
            model_results[name]["log_loss_sum"] += log_loss
            model_results[name]["candidate_mass_sum"] += result["mass"]
            model_results[name]["forecasts"].append(row)

        ensemble_marginal = [
            [sum(weights[index] * fitted[index]["marginal"][position][digit]
                 for index in range(len(MODELS))) for digit in range(10)]
            for position in range(6)
        ]

        def ensemble_log_probability(number):
            return _logsumexp([
                normalized_weights_log[index] + _log_probability(fitted[index], number)
                for index in range(len(MODELS))
            ])

        result = _fano_candidates(ensemble_marginal, ensemble_log_probability)
        ensemble_logloss = -ensemble_log_probability(actual)
        hit = actual in result["numbers"]
        ensemble["hits"] += int(hit)
        ensemble["log_loss_sum"] += ensemble_logloss
        ensemble["candidate_mass_sum"] += result["mass"]
        ensemble["forecasts"].append({
            "target_date": target_date.isoformat(), "prior_draws": len(prior),
            "actual": actual, "candidates": result["numbers"], "hit": hit,
            "predictive_log_loss": round(ensemble_logloss, 12),
            "five_candidate_probability_mass": round(result["mass"], 14),
            "punctured_line": result["puncture"],
            "minimum_hamming_distance": result["minimum_hamming_distance"],
            "model_weights_before_target": {
                MODELS[index]["name"]: round(weights[index], 12) for index in range(len(MODELS))
            },
        })

        rolling_marginal = [
            [sum(rolling_weights[index] * fitted[index]["marginal"][position][digit]
                 for index in range(len(MODELS))) for digit in range(10)]
            for position in range(6)
        ]

        def rolling_log_probability(number):
            return _logsumexp([
                rolling_weights_log[index] + _log_probability(fitted[index], number)
                for index in range(len(MODELS))
            ])

        rolling_result = _fano_candidates(rolling_marginal, rolling_log_probability)
        rolling_logloss = -rolling_log_probability(actual)
        rolling_hit = actual in rolling_result["numbers"]
        rolling_ensemble["hits"] += int(rolling_hit)
        rolling_ensemble["log_loss_sum"] += rolling_logloss
        rolling_ensemble["candidate_mass_sum"] += rolling_result["mass"]
        rolling_ensemble["forecasts"].append({
            "target_date": target_date.isoformat(), "prior_draws": len(prior),
            "actual": actual, "candidates": rolling_result["numbers"], "hit": rolling_hit,
            "predictive_log_loss": round(rolling_logloss, 12),
            "five_candidate_probability_mass": round(rolling_result["mass"], 14),
            "punctured_line": rolling_result["puncture"],
            "minimum_hamming_distance": rolling_result["minimum_hamming_distance"],
            "model_weights_before_target": {
                MODELS[index]["name"]: round(rolling_weights[index], 12)
                for index in range(len(MODELS))
            },
            "weight_history_draws": len(recent_scores),
        })

        # Update expert weights only after the current target was forecast and scored.
        log_model_weights = [log_model_weights[i] + log_scores[i] for i in range(len(MODELS))]
        past_model_log_scores.append(log_scores)
        if (target_index + 1) % 100 == 0 or target_index + 1 == DRAW_COUNT:
            print(f"walk-forward {target_index + 1}/{DRAW_COUNT}; ensemble hits={ensemble['hits']}", flush=True)

    def summarize(result):
        draws = len(dated)
        return {
            "draws": draws,
            "hits": result["hits"],
            "hit_rate_pct": round(result["hits"] * 100 / draws, 8),
            "mean_joint_log_loss": round(result["log_loss_sum"] / draws, 8),
            "uniform_joint_log_loss": round(math.log(1_000_000), 8),
            "mean_five_candidate_probability_mass": round(result["candidate_mass_sum"] / draws, 12),
            "uniform_five_candidate_mass": 5 / 1_000_000,
            "threshold_met": result["hits"] >= TARGET_HITS,
        }

    model_summary = {name: summarize(result) for name, result in model_results.items()}
    ensemble_summary = summarize(ensemble)
    rolling_summary = summarize(rolling_ensemble)
    threshold_met_by = [
        name for name, summary in (
            ("expanding-prequential", ensemble_summary),
            ("rolling-120-prequential", rolling_summary),
        ) if summary["threshold_met"]
    ]
    rolling_log_weights = [
        sum(row[index] for row in past_model_log_scores[-RECENCY_HALF_LIFE:])
        for index in range(len(MODELS))
    ]
    report = {
        "run_date": datetime.now(astra.THAILAND_TZ).date().isoformat(),
        "draw_count": len(dated),
        "date_range": [dated[0][0].isoformat(), dated[-1][0].isoformat()],
        "actuals_sha256": actuals_sha256,
        "leading_zero_draws": sum(number.startswith("0") for _, number in dated),
        "source": "existing lottery_cache.csv only; no refresh",
        "target": "exact six-digit prize1; five distinct Fano-inspired candidates per target",
        "walk_forward": "each target fitted from valid prize1 draws strictly earlier than its date; all 759 outcomes included",
        "candidate_construction": "top-two posterior marginal digits at each position; score punctured Fano incidence codebooks by normalized joint probability; retain five highest-mass codewords",
        "models": [
            {**model, "position_prior": "Dirichlet(1)", "pair_backoff_strength": PAIR_STRENGTH,
             "triple_backoff_strength": TRIPLE_STRENGTH if model["order"] == 2 else None}
            for model in MODELS
        ],
        "ensemble": "equal initial weights; after each target update weights from each model's predictive probability of that observed outcome; use only updated weights at the next target",
        "recency": "age measured in prior valid draws; half-life applies to the training counts for the recency model",
        "threshold_hits_required": TARGET_HITS,
        "prequential_ensemble_summary": ensemble_summary,
        "rolling_prequential_ensemble": {
            "weight_lookback_draws": RECENCY_HALF_LIFE,
            **rolling_summary,
        },
        "threshold_met": bool(threshold_met_by),
        "threshold_met_by": threshold_met_by,
        "fixed_model_summaries": model_summary,
        "final_model_weights": {
            MODELS[index]["name"]: round(math.exp(value - _logsumexp(log_model_weights)), 12)
            for index, value in enumerate(log_model_weights)
        },
        "final_rolling_model_weights": {
            MODELS[index]["name"]: round(math.exp(value - _logsumexp(rolling_log_weights)), 12)
            for index, value in enumerate(rolling_log_weights)
        },
        "interpretation": "Exploratory historical backtest. The fixed-model comparison is retrospective; the online ensemble updates only after each target. Neither result is independent future validation, and no formula was promoted.",
        "elapsed_seconds": round(time.perf_counter() - started, 3),
        "forecasts": {
            "prequential_ensemble": ensemble["forecasts"],
            "rolling_prequential_ensemble": rolling_ensemble["forecasts"],
            "fixed_models": {name: result["forecasts"] for name, result in model_results.items()},
        },
    }
    output_dir = ROOT / ".scratch" / "fano-bayes-shrinkage-759"
    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / f"results-{report['run_date']}.json"
    output_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({
        "draw_count": report["draw_count"],
        "actuals_sha256": actuals_sha256,
        "ensemble": report["prequential_ensemble_summary"],
        "rolling_ensemble": report["rolling_prequential_ensemble"],
        "threshold_met": report["threshold_met"],
        "fixed_models": model_summary,
        "final_model_weights": report["final_model_weights"],
        "final_rolling_model_weights": report["final_rolling_model_weights"],
        "threshold_met": report["prequential_ensemble_summary"]["threshold_met"],
        "report": str(output_path),
        "elapsed_seconds": report["elapsed_seconds"],
    }, ensure_ascii=False, indent=2), flush=True)
    return report


if __name__ == "__main__":
    run()
