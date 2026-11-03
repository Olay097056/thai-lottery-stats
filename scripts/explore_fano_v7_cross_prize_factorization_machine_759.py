"""Stage 55: pairwise Factorization Machine over prior cross-prize panels.

Stage 53's dense linear model and Stage 54's sparse linear optimizer both
failed to benefit from the high-dimensional auxiliary-prize panel. This
prequential Factorization Machine tests a distinct hypothesis: useful signals
may arise only from interactions between award-panel features. It predicts
each first-prize digit position separately and decodes five Fano codewords.
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
sys.path.insert(0, str(ROOT / "scripts"))

import astra
import fano
import numpy as np
import explore_fano_v7_draw_state_transition_759 as state_source

DRAW_COUNT = 759
EXPECTED_FINGERPRINT = "c7d1cd0199ee945a9102dab341c7353cf0c76272b05d69bee3b6119d0bed6145"
TICKET_COUNT = 5
LAGS = 2
FACTOR_RANK = 8
LEARNING_RATE = 0.005
L2_DECAY = 0.05
INITIALIZATION_SEED = 20261015
INITIALIZATION_SCALE = 0.04


def _softmax(logits):
    values = np.exp(logits - np.max(logits))
    return values / np.sum(values)


def _features(states, target_index):
    dimension = len(states[0]) if states else 488
    result = np.zeros(1 + LAGS * dimension, dtype=np.float64)
    result[0] = 1.0
    for lag in range(1, LAGS + 1):
        source_index = target_index - lag
        if source_index >= 0:
            start = 1 + (lag - 1) * dimension
            result[start:start + dimension] = states[source_index]
    return result


def _position_logits(feature, linear_weights, factors):
    logits = feature @ linear_weights
    x = feature[1:]
    latent_sum = np.einsum("d,dck->ck", x, factors[1:], optimize=True)
    squared_terms = np.einsum("d,dck->ck", x * x, factors[1:] * factors[1:], optimize=True)
    logits = logits + 0.5 * np.sum(latent_sum * latent_sum - squared_terms, axis=1)
    return logits


def _fano_candidates(probabilities):
    rankings = [sorted(range(10), key=lambda digit: (-probabilities[pos][digit], digit))[:2]
                for pos in range(6)]
    best = None
    for puncture in range(7):
        lines = [line for line in range(7) if line != puncture]
        words = []
        for point in range(7):
            digits = [rankings[pos][int(point in fano.FANO_LINES[line])]
                      for pos, line in enumerate(lines)]
            number = "".join(str(digit) for digit in digits)
            score = sum(math.log(float(probabilities[pos, digit]))
                        for pos, digit in enumerate(digits))
            words.append((number, score))
        if len({number for number, _ in words}) != 7:
            raise RuntimeError("Fano codewords must be distinct")
        selected = sorted(words, key=lambda row: (-row[1], row[0]))[:TICKET_COUNT]
        maximum = max(score for _, score in selected)
        portfolio_score = maximum + math.log(sum(math.exp(value - maximum)
                                                   for _, value in selected))
        key = (portfolio_score, -puncture)
        if best is None or key > best[0]:
            best = (key, selected, puncture)
    _, selected, puncture = best
    candidates = [number for number, _ in selected]
    if len(candidates) != TICKET_COUNT or len(set(candidates)) != TICKET_COUNT:
        raise RuntimeError("Fano Factorization Machine decoder needs five unique candidates")
    return candidates, puncture + 1


def run():
    started = time.perf_counter()
    rows = state_source._load_rows()
    if len(rows) != DRAW_COUNT:
        raise RuntimeError(f"Expected {DRAW_COUNT} draws, got {len(rows)}")
    dated = [(row["date"], row["prize1"]) for row in rows]
    material = "\n".join(f"{day.isoformat()}|{number}" for day, number in dated).encode("ascii")
    fingerprint = hashlib.sha256(material).hexdigest()
    if fingerprint != EXPECTED_FINGERPRINT:
        raise RuntimeError(f"Dataset fingerprint changed: {fingerprint}")
    states = [state_source._draw_state(row) for row in rows]
    if not states or any(len(state) != len(states[0]) for state in states):
        raise RuntimeError("Cross-prize panel dimensions differ")

    feature_count = 1 + LAGS * len(states[0])
    rng = np.random.default_rng(INITIALIZATION_SEED)
    linear_weights = np.zeros((6, feature_count, 10), dtype=np.float64)
    factors = rng.normal(0.0, INITIALIZATION_SCALE,
                         size=(6, feature_count, 10, FACTOR_RANK))
    factors[:, 0, :, :] = 0.0  # Intercept participates only in the linear term.
    hits = 0
    hit_dates = []
    forecasts = []
    loss_sum = 0.0

    for target_index, (target_date, actual) in enumerate(dated):
        feature = _features(states, target_index)
        logits_by_position = np.stack([
            _position_logits(feature, linear_weights[pos], factors[pos])
            for pos in range(6)
        ])
        probabilities = np.stack([_softmax(logits) for logits in logits_by_position])
        candidates, puncture = _fano_candidates(probabilities)
        hit = actual in candidates
        hits += int(hit)
        if hit:
            hit_dates.append(target_date.isoformat())
        actual_digits = np.asarray([ord(char) - 48 for char in actual], dtype=np.int64)
        loss_sum += -sum(math.log(float(probabilities[pos, digit]))
                         for pos, digit in enumerate(actual_digits))
        forecasts.append({
            "target_date": target_date.isoformat(),
            "prior_valid_draws": target_index,
            "actual": actual,
            "candidates": candidates,
            "hit": hit,
            "punctured_line": puncture,
            "factor_rank": FACTOR_RANK,
            "prior_cross_prize_draw_lags": min(target_index, LAGS),
        })

        # Online gradient updates happen after the current target is scored.
        feature_for_interactions = feature.copy()
        feature_for_interactions[0] = 0.0
        factors[:, 1:, :, :] *= (1.0 - LEARNING_RATE * L2_DECAY)
        linear_weights[:, 1:, :] *= (1.0 - LEARNING_RATE * L2_DECAY)
        for pos, digit in enumerate(actual_digits):
            gradient_logits = probabilities[pos].copy()
            gradient_logits[digit] -= 1.0
            linear_weights[pos] -= LEARNING_RATE * np.outer(feature, gradient_logits)
            latent_sum = np.einsum("d,dck->ck", feature_for_interactions[1:],
                                   factors[pos, 1:], optimize=True)
            for class_index in range(10):
                grad_factor = (feature_for_interactions[1:, None]
                               * (latent_sum[class_index][None, :]
                                  - feature_for_interactions[1:, None]
                                  * factors[pos, 1:, class_index, :]))
                factors[pos, 1:, class_index, :] -= (
                    LEARNING_RATE * gradient_logits[class_index] * grad_factor)
        if (target_index + 1) % 100 == 0:
            print(f"walk-forward: {target_index + 1}/{DRAW_COUNT}, hits={hits}", flush=True)

    recomputed_hits = sum(row["actual"] in row["candidates"] for row in forecasts)
    if len(forecasts) != DRAW_COUNT or [r["prior_valid_draws"] for r in forecasts] != list(range(DRAW_COUNT)):
        raise RuntimeError("Forecast chronology audit failed")
    if recomputed_hits != hits or any(len(row["candidates"]) != TICKET_COUNT
                                      or len(set(row["candidates"])) != TICKET_COUNT
                                      for row in forecasts):
        raise RuntimeError("Candidate or hit-count audit failed")

    run_date = datetime.now(astra.THAILAND_TZ).date().isoformat()
    report = {
        "run_date": run_date,
        "draw_count": DRAW_COUNT,
        "date_range": [dated[0][0].isoformat(), dated[-1][0].isoformat()],
        "actuals_sha256": fingerprint,
        "target": "at least 10 exact six-digit first-prize hits over 759 targets with exactly five distinct candidates per target",
        "walk_forward": "Factorization Machine weights are updated after scoring each target; only prior two draw panels enter the current features",
        "model_family": "prequential pairwise Factorization Machine over cross-prize panel inputs with Fano codebook decoder",
        "groups": list(state_source.GROUPS),
        "cross_prize_feature_dimension": len(states[0]),
        "lag_count": LAGS,
        "factor_rank": FACTOR_RANK,
        "learning_rate": LEARNING_RATE,
        "l2_decay": L2_DECAY,
        "initialization_seed": INITIALIZATION_SEED,
        "uniform_expected_hits": DRAW_COUNT * TICKET_COUNT / 1_000_000,
        "v7": {"hits": hits, "hit_rate_percent": round(100 * hits / DRAW_COUNT, 8),
               "hit_dates": hit_dates,
               "mean_log_loss": round(loss_sum / DRAW_COUNT, 8),
               "uniform_log_loss": math.log(1_000_000),
               "forecasts": forecasts},
        "threshold": {"minimum_hits": 10, "met": hits >= 10},
        "validation": {"forecast_count": len(forecasts), "prior_counts_0_to_758": True,
                       "five_distinct_candidates_each": True, "recomputed_hits": recomputed_hits},
        "interpretation": "historical exploratory evaluation; the model family was chosen after earlier results and is not independent validation",
        "elapsed_seconds": round(time.perf_counter() - started, 3),
    }
    output = ROOT / ".scratch" / "fano-v7-walk-forward" / f"results-{run_date}-stage-55-cross-prize-factorization-machine.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"hits": hits, "hit_rate_percent": report["v7"]["hit_rate_percent"],
                      "hit_dates": hit_dates, "mean_log_loss": report["v7"]["mean_log_loss"],
                      "uniform_log_loss": report["v7"]["uniform_log_loss"],
                      "minimum_hits": 10, "met": hits >= 10,
                      "data_fingerprint": fingerprint, "result_file": str(output),
                      "elapsed_seconds": report["elapsed_seconds"]},
                     ensure_ascii=False), flush=True)


if __name__ == "__main__":
    run()
