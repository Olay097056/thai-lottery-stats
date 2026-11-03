"""Stage 54: sparse FTRL-Proximal model over prior cross-prize panels.

Stage 53 used the same causal feature source but dense online SGD over 977
features per position and 759 targets, with worse-than-uniform log loss. This
distinct online optimization mechanism adds coordinate-wise L1 sparsity so
unhelpful prize-panel signals can be suppressed without future-data tuning.
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
FTRL_ALPHA = 0.1
FTRL_BETA = 1.0
FTRL_L1 = 0.1
FTRL_L2 = 0.01


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


def _weights(z, n):
    thresholds = np.full(z.shape[0], FTRL_L1, dtype=np.float64)
    thresholds[0] = 0.0  # Keep the intercept unthresholded.
    regularization = np.full(z.shape[0], FTRL_L2, dtype=np.float64)
    regularization[0] = 0.0
    denominator = ((FTRL_BETA + np.sqrt(n)) / FTRL_ALPHA
                   + regularization[:, None])
    signs = np.where(z >= 0.0, 1.0, -1.0)
    result = np.zeros_like(z)
    active = np.abs(z) > thresholds[:, None]
    result[active] = -((z - signs * thresholds[:, None])[active] / denominator[active])
    return result


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
        score = maximum + math.log(sum(math.exp(value - maximum) for _, value in selected))
        key = (score, -puncture)
        if best is None or key > best[0]:
            best = (key, selected, puncture)
    _, selected, puncture = best
    numbers = [number for number, _ in selected]
    if len(numbers) != TICKET_COUNT or len(set(numbers)) != TICKET_COUNT:
        raise RuntimeError("FTRL Fano decoder must return five unique tickets")
    return numbers, puncture + 1


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
        raise RuntimeError("Cross-prize panel feature dimensions differ")

    feature_count = 1 + LAGS * len(states[0])
    z_state = np.zeros((6, feature_count, 10), dtype=np.float64)
    squared_gradient_state = np.zeros_like(z_state)
    hits = 0
    hit_dates = []
    forecasts = []
    loss_sum = 0.0

    for target_index, (target_date, actual) in enumerate(dated):
        feature = _features(states, target_index)
        parameters = [_weights(z_state[position], squared_gradient_state[position])
                      for position in range(6)]
        probabilities = np.stack([_softmax(feature @ parameters[pos])
                                   for pos in range(6)])
        candidates, puncture = _fano_candidates(probabilities)
        hit = actual in candidates
        hits += int(hit)
        if hit:
            hit_dates.append(target_date.isoformat())
        actual_digits = np.asarray([ord(char) - 48 for char in actual], dtype=np.int64)
        loss = -sum(math.log(float(probabilities[pos, digit]))
                    for pos, digit in enumerate(actual_digits))
        loss_sum += loss
        forecasts.append({
            "target_date": target_date.isoformat(),
            "prior_valid_draws": target_index,
            "actual": actual,
            "candidates": candidates,
            "hit": hit,
            "punctured_line": puncture,
            "prior_cross_prize_draw_lags": min(target_index, LAGS),
            "log_loss": round(loss, 8),
            "active_ftrl_weights": int(np.count_nonzero(parameters)),
        })

        # Update FTRL state only after scoring this target.
        for pos, digit in enumerate(actual_digits):
            gradient_vector = probabilities[pos].copy()
            gradient_vector[digit] -= 1.0
            gradient = np.outer(feature, gradient_vector)
            old_n = squared_gradient_state[pos]
            new_n = old_n + gradient * gradient
            sigma = (np.sqrt(new_n) - np.sqrt(old_n)) / FTRL_ALPHA
            z_state[pos] += gradient - sigma * parameters[pos]
            squared_gradient_state[pos] = new_n
        if (target_index + 1) % 100 == 0:
            print(f"walk-forward: {target_index + 1}/{DRAW_COUNT}, hits={hits}", flush=True)

    recomputed_hits = sum(row["actual"] in row["candidates"] for row in forecasts)
    if len(forecasts) != DRAW_COUNT or [row["prior_valid_draws"] for row in forecasts] != list(range(DRAW_COUNT)):
        raise RuntimeError("Forecast chronology audit failed")
    if recomputed_hits != hits or any(len(row["candidates"]) != TICKET_COUNT
                                      or len(set(row["candidates"])) != TICKET_COUNT
                                      for row in forecasts):
        raise RuntimeError("Candidate slate or hit-count audit failed")

    run_date = datetime.now(astra.THAILAND_TZ).date().isoformat()
    report = {
        "run_date": run_date,
        "draw_count": DRAW_COUNT,
        "date_range": [dated[0][0].isoformat(), dated[-1][0].isoformat()],
        "actuals_sha256": fingerprint,
        "target": "at least 10 exact six-digit first-prize hits over 759 targets with exactly five distinct candidates per target",
        "walk_forward": "FTRL-Proximal weights are computed from prior examples; current target is scored before any gradient update",
        "model_family": "sparse cross-prize online multinomial FTRL-Proximal model with Fano codebook output",
        "groups": list(state_source.GROUPS),
        "cross_prize_feature_dimension": len(states[0]),
        "lag_count": LAGS,
        "ftrl": {"alpha": FTRL_ALPHA, "beta": FTRL_BETA, "l1": FTRL_L1, "l2": FTRL_L2},
        "uniform_expected_hits": DRAW_COUNT * TICKET_COUNT / 1_000_000,
        "v7": {"hits": hits, "hit_rate_percent": round(100 * hits / DRAW_COUNT, 8),
               "hit_dates": hit_dates,
               "mean_log_loss": round(loss_sum / DRAW_COUNT, 8),
               "uniform_log_loss": math.log(1_000_000),
               "forecasts": forecasts},
        "threshold": {"minimum_hits": 10, "met": hits >= 10},
        "validation": {"forecast_count": len(forecasts), "prior_counts_0_to_758": True,
                       "five_distinct_candidates_each": True, "recomputed_hits": recomputed_hits},
        "interpretation": "historical exploratory evaluation; this is a sparsity-mechanism follow-up on the prior cross-prize feature source and not independent validation",
        "elapsed_seconds": round(time.perf_counter() - started, 3),
    }
    output = ROOT / ".scratch" / "fano-v7-walk-forward" / f"results-{run_date}-stage-54-cross-prize-ftrl.json"
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
