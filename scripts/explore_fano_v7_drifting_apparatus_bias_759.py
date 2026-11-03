"""Stage 84: fixed-half-life drift in latent digit-apparatus profiles."""
from __future__ import annotations

from datetime import datetime
import json
import math
from pathlib import Path
import random
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "scripts"))

import astra
from explore_fano_v7_latent_apparatus_bias_759 import (
    DIGIT_CARDINALITY, DIGIT_COUNT, DRAW_COUNT, EXPECTED_FINGERPRINT,
    SYMMETRY_BREAK_SCALE, SYMMETRY_BREAK_SEED, TICKET_COUNT,
    _assignment_responsibilities, _device_probabilities, _fano_codebooks,
    _load_draws, _pooled_marginal, _select_slate, _ticket_probability,
)

HALF_LIFE_DRAWS = 360.0
RETENTION = 2.0 ** (-1.0 / HALF_LIFE_DRAWS)
UNIFORM_EXPECTED_HITS = DRAW_COUNT * TICKET_COUNT / 1_000_000


def run():
    started = time.perf_counter()
    dated, fingerprint = _load_draws()
    if fingerprint != EXPECTED_FINGERPRINT:
        raise RuntimeError("Fixed fingerprint differs from the preregistered dataset")
    rng = random.Random(SYMMETRY_BREAK_SEED)
    pseudocounts = [
        [1.0 + SYMMETRY_BREAK_SCALE * rng.random()
         for _ in range(DIGIT_CARDINALITY)]
        for _ in range(DIGIT_COUNT)
    ]
    forecasts = []
    hits = 0
    hit_dates = []
    loss_sum = 0.0
    mass_sum = 0.0

    for target_index, (target_date, actual) in enumerate(dated):
        device_probabilities = _device_probabilities(pseudocounts)
        marginal = _pooled_marginal(device_probabilities)
        slate = _select_slate(_fano_codebooks(marginal), device_probabilities)
        actual_probability = _ticket_probability(actual, device_probabilities)
        loss_sum -= math.log(actual_probability)
        mass_sum += slate["five_ticket_predictive_mass"]
        hit = actual in slate["candidates"]
        hits += int(hit)
        if hit:
            hit_dates.append(target_date.isoformat())

        forecasts.append({
            "target_date": target_date.isoformat(),
            "prior_valid_draws": target_index,
            "actual": actual,
            "candidates": slate["candidates"],
            "hit": hit,
            "prior_device_digit_probabilities": device_probabilities,
            "pooled_digit_marginal": marginal,
            "candidate_probabilities": slate["candidate_probabilities"],
            "five_ticket_predictive_mass": slate["five_ticket_predictive_mass"],
            "punctured_line": slate["punctured_line"],
            "selected_points": slate["selected_points"],
            "actual_predictive_probability": actual_probability,
        })

        # Discount only past evidence, retaining the symmetric unit base.
        responsibilities = _assignment_responsibilities(actual, device_probabilities)
        for machine in range(DIGIT_COUNT):
            for digit in range(DIGIT_CARDINALITY):
                pseudocounts[machine][digit] = (
                    1.0 + RETENTION * (pseudocounts[machine][digit] - 1.0)
                    + responsibilities[machine][digit]
                )
        if (target_index + 1) % 100 == 0:
            print(f"walk-forward: {target_index + 1}/{DRAW_COUNT}, hits={hits}",
                  flush=True)

    recomputed_hits = sum(row["actual"] in row["candidates"] for row in forecasts)
    if len(forecasts) != DRAW_COUNT:
        raise RuntimeError("Expected exactly 759 forecasts")
    if [row["target_date"] for row in forecasts] != [day.isoformat() for day, _ in dated]:
        raise RuntimeError("Forecast chronology differs from the fixed draw chronology")
    if [row["prior_valid_draws"] for row in forecasts] != list(range(DRAW_COUNT)):
        raise RuntimeError("Prior counts must be exactly 0 through 758")
    if any(len(row["candidates"]) != TICKET_COUNT
           or len(set(row["candidates"])) != TICKET_COUNT
           or any(len(number) != DIGIT_COUNT or not number.isascii() or not number.isdigit()
                  for number in row["candidates"])
           for row in forecasts):
        raise RuntimeError("Every draw must have five unique six-digit tickets")
    if recomputed_hits != hits:
        raise RuntimeError("Hit total does not match candidate lists")

    run_date = datetime.now(astra.THAILAND_TZ).date().isoformat()
    report = {
        "run_date": run_date,
        "draw_count": DRAW_COUNT,
        "date_range": [dated[0][0].isoformat(), dated[-1][0].isoformat()],
        "actuals_sha256": fingerprint,
        "target": "at least 10 exact first-prize hits in 759 targets with five distinct candidates per target",
        "walk_forward": "only earlier soft assignment evidence is exponentially discounted and used; current result updates after scoring",
        "model_family": "drifting hidden-apparatus categorical model with fixed exponential forgetting and Fano slate decoding",
        "apparatus_count": DIGIT_COUNT,
        "dirichlet_pseudocount_per_digit": 1.0,
        "half_life_draws": HALF_LIFE_DRAWS,
        "retention_per_draw": RETENTION,
        "symmetry_break": {"seed": SYMMETRY_BREAK_SEED,
                           "scale": SYMMETRY_BREAK_SCALE,
                           "purpose": "numerical initialization only"},
        "uniform_expected_hits": UNIFORM_EXPECTED_HITS,
        "v7": {
            "hits": hits,
            "hit_rate_percent": round(100.0 * hits / DRAW_COUNT, 8),
            "hit_dates": hit_dates,
            "mean_joint_log_loss": round(loss_sum / DRAW_COUNT, 8),
            "uniform_log_loss": math.log(1_000_000),
            "mean_five_ticket_predictive_mass": round(mass_sum / DRAW_COUNT, 12),
            "forecasts": forecasts,
        },
        "threshold": {"minimum_hits": 10, "met": hits >= 10},
        "validation": {"forecast_count": len(forecasts),
                       "prior_counts_0_to_758": True,
                       "five_distinct_candidates_each": True,
                       "recomputed_hits": recomputed_hits},
        "interpretation": "retrospective exploratory evaluation only; no evidence of independent or prospective predictive advantage",
        "elapsed_seconds": round(time.perf_counter() - started, 3),
    }
    output = (ROOT / ".scratch" / "fano-v7-walk-forward" /
              f"results-{run_date}-stage-84-drifting-apparatus-bias.json")
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"hits": hits, "hit_dates": hit_dates,
                      "minimum_hits": 10, "met": hits >= 10,
                      "mean_joint_log_loss": report["v7"]["mean_joint_log_loss"],
                      "uniform_log_loss": report["v7"]["uniform_log_loss"],
                      "data_fingerprint": fingerprint,
                      "result_file": str(output),
                      "elapsed_seconds": report["elapsed_seconds"]},
                     ensure_ascii=False), flush=True)


if __name__ == "__main__":
    run()
