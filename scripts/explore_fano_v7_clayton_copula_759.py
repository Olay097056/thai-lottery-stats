"""Stage 66: prior-only Clayton lower-tail copula for Fano codewords."""
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
CLAYTON_THETA = 1.0


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


def _clayton_log_density(uniforms):
    dimension = len(uniforms)
    log_constant = sum(math.log1p(index * CLAYTON_THETA)
                       for index in range(dimension))
    base = sum(value ** (-CLAYTON_THETA) for value in uniforms) - dimension + 1.0
    if base <= 0.0:
        raise RuntimeError("Clayton copula density has a non-positive base")
    log_base = math.log(base)
    return (log_constant
            - (CLAYTON_THETA + 1.0) * sum(math.log(value) for value in uniforms)
            - (dimension + 1.0 / CLAYTON_THETA) * log_base)


def _fano_slate(probabilities):
    top_digits = [sorted(range(10), key=lambda digit: (-probabilities[pos, digit], digit))[:2]
                  for pos in range(6)]
    uniforms = np.empty((6, 10), dtype=np.float64)
    for position in range(6):
        cumulative = 0.0
        for digit in range(10):
            uniforms[position, digit] = min(
                1.0 - 1e-9, max(1e-9, cumulative + 0.5 * probabilities[position, digit]))
            cumulative += probabilities[position, digit]

    choices = []
    for puncture in range(7):
        lines = [line for line in range(7) if line != puncture]
        tickets = []
        for point in range(7):
            digits = [top_digits[pos][int(point in fano.FANO_LINES[line])]
                      for pos, line in enumerate(lines)]
            number = "".join(str(digit) for digit in digits)
            marginals_log = sum(math.log(float(probabilities[pos, digit]))
                                for pos, digit in enumerate(digits))
            pit = [float(uniforms[pos, digit]) for pos, digit in enumerate(digits)]
            score = marginals_log + _clayton_log_density(pit)
            tickets.append((number, score))
        if len({number for number, _ in tickets}) != 7:
            raise RuntimeError("Fano point codewords were not distinct")
        selected = sorted(tickets, key=lambda item: (-item[1], item[0]))[:TICKET_COUNT]
        maximum = max(score for _, score in selected)
        log_mass = maximum + math.log(sum(math.exp(score - maximum)
                                          for _, score in selected))
        choices.append((log_mass, puncture, selected))
    _, puncture, selected = max(choices, key=lambda item: (item[0], -item[1]))
    candidates = [number for number, _ in selected]
    if len(candidates) != TICKET_COUNT or len(set(candidates)) != TICKET_COUNT:
        raise RuntimeError("Clayton Fano slate needs five unique candidates")
    return candidates, puncture + 1


def run():
    started = time.perf_counter()
    dated, fingerprint = _load_draws()
    counts = np.zeros((6, 10), dtype=np.float64)
    hits = 0
    hit_dates = []
    forecasts = []
    loss_sum = 0.0

    for target_index, (target_date, actual) in enumerate(dated):
        probabilities = (counts + 1.0) / (target_index + 10.0)
        candidates, puncture = _fano_slate(probabilities)
        actual_digits = [ord(char) - 48 for char in actual]
        hit = actual in candidates
        hits += int(hit)
        if hit:
            hit_dates.append(target_date.isoformat())
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
        })

        # Current digit counts update only after all five tickets are scored.
        for position, digit in enumerate(actual_digits):
            counts[position, digit] += 1.0
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
        "target": "at least 10 exact six-digit first-prize hits over 759 targets, with five distinct candidates per target",
        "walk_forward": "Dirichlet digit marginals and mid-PIT values use only prior draws; the current actual is added to counts after scoring",
        "model_family": "prequential asymmetric lower-tail Clayton copula dependence with punctured Fano decoding",
        "clayton_theta": CLAYTON_THETA,
        "uniform_expected_hits": DRAW_COUNT * TICKET_COUNT / 1_000_000,
        "v7": {"hits": hits, "hit_rate_percent": round(100 * hits / DRAW_COUNT, 8),
               "hit_dates": hit_dates,
               "mean_marginal_log_loss": round(loss_sum / DRAW_COUNT, 8),
               "uniform_log_loss": math.log(1_000_000),
               "forecasts": forecasts},
        "threshold": {"minimum_hits": 10, "met": hits >= 10},
        "validation": {"forecast_count": len(forecasts), "prior_counts_0_to_758": True,
                       "five_distinct_candidates_each": True,
                       "recomputed_hits": recomputed_hits},
        "interpretation": "historical exploratory evaluation only; no claim of independent predictive evidence",
        "elapsed_seconds": round(time.perf_counter() - started, 3),
    }
    output = ROOT / ".scratch" / "fano-v7-walk-forward" / f"results-{run_date}-stage-66-clayton-copula.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"hits": hits, "hit_rate_percent": report["v7"]["hit_rate_percent"],
                      "hit_dates": hit_dates,
                      "mean_marginal_log_loss": report["v7"]["mean_marginal_log_loss"],
                      "uniform_log_loss": report["v7"]["uniform_log_loss"],
                      "minimum_hits": 10, "met": hits >= 10,
                      "data_fingerprint": fingerprint, "result_file": str(output),
                      "elapsed_seconds": report["elapsed_seconds"]},
                     ensure_ascii=False), flush=True)


if __name__ == "__main__":
    run()
