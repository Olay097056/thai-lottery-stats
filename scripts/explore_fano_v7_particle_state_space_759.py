"""Stage 56: particle-filter smooth drift in per-position digit probabilities."""
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
import numpy as np

DRAW_COUNT = 759
EXPECTED_FINGERPRINT = "c7d1cd0199ee945a9102dab341c7353cf0c76272b05d69bee3b6119d0bed6145"
TICKET_COUNT = 5
PARTICLE_COUNT = 512
PROCESS_SD = 0.01
RANDOM_SEED = 20261015


def _load_draws():
    dated = []
    for row in astra.load_existing_astra_history():
        values = astra._category_values(row, "prize1", 6)
        if values is not None:
            dated.append((astra._history_date(row["date"]), values[0]))
    dated.sort()
    if len(dated) != DRAW_COUNT or len({day for day, _ in dated}) != DRAW_COUNT:
        raise RuntimeError("Expected 759 unique first-prize draws")
    if any(dated[i - 1][0] >= dated[i][0] for i in range(1, DRAW_COUNT)):
        raise RuntimeError("Draw history is not strictly chronological")
    if any(len(number) != 6 or not number.isascii() or not number.isdigit()
           for _, number in dated):
        raise RuntimeError("First-prize values must remain six ASCII digits")
    material = "\n".join(f"{day.isoformat()}|{number}" for day, number in dated).encode("ascii")
    fingerprint = hashlib.sha256(material).hexdigest()
    if fingerprint != EXPECTED_FINGERPRINT:
        raise RuntimeError(f"Dataset fingerprint changed: {fingerprint}")
    return dated, fingerprint


def _particle_probabilities(logits):
    shifted = logits - np.max(logits, axis=-1, keepdims=True)
    values = np.exp(shifted)
    return values / values.sum(axis=-1, keepdims=True)


def _systematic_resample(weights, rng):
    count = len(weights)
    positions = (rng.random() + np.arange(count)) / count
    cumulative = np.cumsum(weights)
    cumulative[-1] = 1.0
    return np.searchsorted(cumulative, positions, side="right")


def _fano_candidates(probabilities):
    rankings = [sorted(range(10), key=lambda digit: (-probabilities[pos, digit], digit))[:2]
                for pos in range(6)]
    best = None
    for puncture in range(7):
        lines = [line for line in range(7) if line != puncture]
        words = []
        for point in range(7):
            digits = [rankings[pos][int(point in fano.FANO_LINES[line])]
                      for pos, line in enumerate(lines)]
            number = "".join(str(digit) for digit in digits)
            log_mass = sum(math.log(float(probabilities[pos, digit]))
                           for pos, digit in enumerate(digits))
            words.append((number, log_mass))
        if len({number for number, _ in words}) != 7:
            raise RuntimeError("Fano codewords must be distinct")
        selected = sorted(words, key=lambda item: (-item[1], item[0]))[:TICKET_COUNT]
        maximum = max(log_mass for _, log_mass in selected)
        score = maximum + math.log(sum(math.exp(log_mass - maximum)
                                       for _, log_mass in selected))
        key = (score, -puncture)
        if best is None or key > best[0]:
            best = (key, selected, puncture)
    _, selected, puncture = best
    candidates = [number for number, _ in selected]
    if len(candidates) != TICKET_COUNT or len(set(candidates)) != TICKET_COUNT:
        raise RuntimeError("Fano decoder must produce five unique candidates")
    return candidates, puncture + 1


def run():
    started = time.perf_counter()
    dated, fingerprint = _load_draws()
    rng = np.random.default_rng(RANDOM_SEED)
    particles = np.zeros((6, PARTICLE_COUNT, 10), dtype=np.float64)
    hits = 0
    hit_dates = []
    forecasts = []
    loss_sum = 0.0

    for target_index, (target_date, actual) in enumerate(dated):
        particle_probs = _particle_probabilities(particles)
        probabilities = particle_probs.mean(axis=1)
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
            "digit_probabilities": np.round(probabilities, 12).tolist(),
            "particle_count": PARTICLE_COUNT,
        })

        # Assimilate the observed digits only after this target is scored.
        for position, digit in enumerate(actual_digits):
            weights = particle_probs[position, :, digit]
            weights = weights / weights.sum()
            selected_indices = _systematic_resample(weights, rng)
            next_logits = particles[position, selected_indices].copy()
            next_logits += rng.normal(0.0, PROCESS_SD, size=next_logits.shape)
            next_logits -= next_logits.mean(axis=1, keepdims=True)
            particles[position] = next_logits

        if (target_index + 1) % 100 == 0:
            print(f"walk-forward: {target_index + 1}/{DRAW_COUNT}, hits={hits}", flush=True)

    recomputed_hits = sum(row["actual"] in row["candidates"] for row in forecasts)
    if len(forecasts) != DRAW_COUNT:
        raise RuntimeError("Forecast count audit failed")
    if [row["target_date"] for row in forecasts] != [day.isoformat() for day, _ in dated]:
        raise RuntimeError("Forecast chronology audit failed")
    if [row["prior_valid_draws"] for row in forecasts] != list(range(DRAW_COUNT)):
        raise RuntimeError("Prior-count audit failed")
    if recomputed_hits != hits:
        raise RuntimeError("Reported hit count differs from candidate lists")
    if any(len(row["candidates"]) != TICKET_COUNT
           or len(set(row["candidates"])) != TICKET_COUNT
           for row in forecasts):
        raise RuntimeError("Five-distinct-candidates audit failed")

    run_date = datetime.now(astra.THAILAND_TZ).date().isoformat()
    report = {
        "run_date": run_date,
        "draw_count": DRAW_COUNT,
        "date_range": [dated[0][0].isoformat(), dated[-1][0].isoformat()],
        "actuals_sha256": fingerprint,
        "target": "at least 10 exact six-digit first-prize hits across 759 targets, using five distinct candidates per draw",
        "walk_forward": "per-position particle beliefs predict before each draw; only after scoring are observed digits used to resample particles and advance latent logits",
        "model_family": "prequential logistic-normal random-walk state-space model with sequential Monte Carlo and punctured Fano decoding",
        "particle_count": PARTICLE_COUNT,
        "process_logit_sd_per_draw": PROCESS_SD,
        "systematic_resampling": True,
        "centered_logits": True,
        "random_seed": RANDOM_SEED,
        "uniform_expected_hits": DRAW_COUNT * TICKET_COUNT / 1_000_000,
        "v7": {"hits": hits, "hit_rate_percent": round(100 * hits / DRAW_COUNT, 8),
               "hit_dates": hit_dates,
               "mean_log_loss": round(loss_sum / DRAW_COUNT, 8),
               "uniform_log_loss": math.log(1_000_000),
               "forecasts": forecasts},
        "threshold": {"minimum_hits": 10, "met": hits >= 10},
        "validation": {"forecast_count": len(forecasts), "prior_counts_0_to_758": True,
                       "five_distinct_candidates_each": True,
                       "recomputed_hits": recomputed_hits},
        "interpretation": "historical exploratory evaluation only; no claim of independent predictive evidence",
        "elapsed_seconds": round(time.perf_counter() - started, 3),
    }
    output = ROOT / ".scratch" / "fano-v7-walk-forward" / f"results-{run_date}-stage-56-smooth-drift-particle-filter.json"
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
