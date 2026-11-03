"""Stage 83: online latent digit-device bias with randomized output order.

The six apparatus profiles are hidden by the official shuffle. This
prequential approximation scores before updating device-to-digit assignments.
"""
from __future__ import annotations

from datetime import datetime
import hashlib
import itertools
import json
import math
from pathlib import Path
import random
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import astra
import fano

DRAW_COUNT = 759
EXPECTED_FINGERPRINT = "c7d1cd0199ee945a9102dab341c7353cf0c76272b05d69bee3b6119d0bed6145"
DIGIT_COUNT = 6
DIGIT_CARDINALITY = 10
TICKET_COUNT = 5
PERMUTATION_COUNT = math.factorial(DIGIT_COUNT)
SYMMETRY_BREAK_SEED = 83083
SYMMETRY_BREAK_SCALE = 1e-6
ASSIGNMENTS = tuple(itertools.permutations(range(DIGIT_COUNT)))


def _load_draws():
    dated = []
    for row in astra.load_existing_astra_history():
        values = astra._category_values(row, "prize1", DIGIT_COUNT)
        if values is not None:
            dated.append((astra._history_date(row["date"]), values[0]))
    dated.sort()
    if len(dated) != DRAW_COUNT or len({day for day, _ in dated}) != DRAW_COUNT:
        raise RuntimeError("Expected exactly 759 unique first-prize draws")
    if any(dated[index - 1][0] >= dated[index][0]
           for index in range(1, DRAW_COUNT)):
        raise RuntimeError("First-prize draws are not strictly chronological")
    if any(len(number) != DIGIT_COUNT or not number.isascii() or not number.isdigit()
           for _, number in dated):
        raise RuntimeError("Every first-prize result must remain six ASCII digits")
    material = "\n".join(f"{day.isoformat()}|{number}" for day, number in dated)
    fingerprint = hashlib.sha256(material.encode("ascii")).hexdigest()
    if fingerprint != EXPECTED_FINGERPRINT:
        raise RuntimeError(f"Fixed 759-draw fingerprint changed: {fingerprint}")
    return dated, fingerprint


def _device_probabilities(pseudocounts):
    probabilities = []
    for row in pseudocounts:
        total = sum(row)
        probabilities.append([value / total for value in row])
    if any(not math.isclose(sum(row), 1.0, rel_tol=0.0, abs_tol=1e-12)
           for row in probabilities):
        raise RuntimeError("Each latent device distribution must sum to one")
    return probabilities


def _pooled_marginal(device_probabilities):
    return [sum(device_probabilities[machine][digit]
                for machine in range(DIGIT_COUNT)) / DIGIT_COUNT
            for digit in range(DIGIT_CARDINALITY)]


def _ticket_probability(number, device_probabilities):
    digits = [ord(char) - 48 for char in number]
    # Subset dynamic program computes the 6x6 permanent without enumerating
    # assignments in the inner loop. Each device is randomly assigned one
    # of the six output positions after its ball is selected.
    dp = [0.0] * (1 << DIGIT_COUNT)
    dp[0] = 1.0
    for machine in range(DIGIT_COUNT):
        next_dp = [0.0] * (1 << DIGIT_COUNT)
        for mask, mass in enumerate(dp):
            if mass == 0.0 or mask.bit_count() != machine:
                continue
            for position, digit in enumerate(digits):
                bit = 1 << position
                if not mask & bit:
                    next_dp[mask | bit] += mass * device_probabilities[machine][digit]
        dp = next_dp
    probability = dp[-1] / PERMUTATION_COUNT
    if not 0.0 < probability <= 1.0:
        raise RuntimeError("Shuffled-apparatus probability must be in (0, 1]")
    return probability


def _assignment_responsibilities(number, device_probabilities):
    digits = [ord(char) - 48 for char in number]
    weighted_assignments = []
    normalizer = 0.0
    for assignment in ASSIGNMENTS:
        weight = math.prod(device_probabilities[machine][digits[position]]
                           for machine, position in enumerate(assignment))
        weighted_assignments.append((assignment, weight))
        normalizer += weight
    if normalizer <= 0.0:
        raise RuntimeError("Latent assignment posterior has zero mass")

    expected = [[0.0] * DIGIT_CARDINALITY for _ in range(DIGIT_COUNT)]
    for assignment, weight in weighted_assignments:
        responsibility = weight / normalizer
        for machine, position in enumerate(assignment):
            expected[machine][digits[position]] += responsibility
    if any(not math.isclose(sum(row), 1.0, rel_tol=0.0, abs_tol=1e-10)
           for row in expected):
        raise RuntimeError("Every apparatus must receive one expected ball per draw")
    return expected


def _fano_codebooks(marginal):
    top_two = sorted(range(DIGIT_CARDINALITY), key=lambda digit: (-marginal[digit], digit))[:2]
    codebooks = []
    for puncture in range(7):
        retained_lines = [line for line in range(7) if line != puncture]
        words = []
        for point in range(7):
            number = "".join(
                str(top_two[int(point in fano.FANO_LINES[line])])
                for line in retained_lines
            )
            words.append((point, number))
        if len({number for _, number in words}) != 7:
            raise RuntimeError("Each punctured Fano codebook must have seven unique tickets")
        codebooks.append((puncture, words))
    return codebooks


def _select_slate(codebooks, device_probabilities):
    scored_codebooks = []
    for puncture, words in codebooks:
        ranked = [(point, number, _ticket_probability(number, device_probabilities))
                  for point, number in words]
        selected = sorted(ranked, key=lambda row: (-row[2], row[0]))[:TICKET_COUNT]
        scored_codebooks.append((sum(row[2] for row in selected), puncture, selected))
    mass, puncture, selected = min(
        scored_codebooks,
        key=lambda item: (-item[0], item[1], tuple(row[0] for row in item[2])),
    )
    candidates = [row[1] for row in selected]
    if len(candidates) != TICKET_COUNT or len(set(candidates)) != TICKET_COUNT:
        raise RuntimeError("The selected slate must have five unique six-digit tickets")
    return {
        "candidates": candidates,
        "punctured_line": puncture + 1,
        "selected_points": [row[0] + 1 for row in selected],
        "candidate_probabilities": [row[2] for row in selected],
        "five_ticket_predictive_mass": mass,
    }


def run():
    started = time.perf_counter()
    dated, fingerprint = _load_draws()
    rng = random.Random(SYMMETRY_BREAK_SEED)
    # Symmetric unit pseudocounts are perturbed only at numerical-noise scale
    # so online EM can leave its otherwise exact identical-device fixed point.
    pseudocounts = [
        [1.0 + SYMMETRY_BREAK_SCALE * rng.random()
         for _ in range(DIGIT_CARDINALITY)]
        for _ in range(DIGIT_COUNT)
    ]
    forecasts = []
    hits = 0
    hit_dates = []
    log_loss_sum = 0.0
    mass_sum = 0.0

    for target_index, (target_date, actual) in enumerate(dated):
        device_probabilities = _device_probabilities(pseudocounts)
        pooled_marginal = _pooled_marginal(device_probabilities)
        codebooks = _fano_codebooks(pooled_marginal)
        slate = _select_slate(codebooks, device_probabilities)
        actual_probability = _ticket_probability(actual, device_probabilities)
        log_loss_sum -= math.log(actual_probability)
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
            "pooled_digit_marginal": pooled_marginal,
            "candidate_probabilities": slate["candidate_probabilities"],
            "five_ticket_predictive_mass": slate["five_ticket_predictive_mass"],
            "punctured_line": slate["punctured_line"],
            "selected_points": slate["selected_points"],
            "actual_predictive_probability": actual_probability,
        })

        # Only after scoring, infer which apparatus could have supplied each
        # observed ball, then update the online expected sufficient statistics.
        responsibilities = _assignment_responsibilities(actual, device_probabilities)
        for machine in range(DIGIT_COUNT):
            for digit in range(DIGIT_CARDINALITY):
                pseudocounts[machine][digit] += responsibilities[machine][digit]

        if (target_index + 1) % 100 == 0:
            print(f"walk-forward: {target_index + 1}/{DRAW_COUNT}, hits={hits}",
                  flush=True)

    recomputed_hits = sum(row["actual"] in row["candidates"] for row in forecasts)
    expected_dates = [day.isoformat() for day, _ in dated]
    if len(forecasts) != DRAW_COUNT or [row["target_date"] for row in forecasts] != expected_dates:
        raise RuntimeError("Walk-forward must contain all targets in date order")
    if [row["prior_valid_draws"] for row in forecasts] != list(range(DRAW_COUNT)):
        raise RuntimeError("Prior counts must run from 0 through 758")
    if any(len(row["candidates"]) != TICKET_COUNT
           or len(set(row["candidates"])) != TICKET_COUNT
           or any(len(number) != DIGIT_COUNT or not number.isascii() or not number.isdigit()
                  for number in row["candidates"])
           for row in forecasts):
        raise RuntimeError("Every target must have five unique six-digit candidates")
    if recomputed_hits != hits:
        raise RuntimeError("Reported hits do not match the saved candidate lists")

    run_date = datetime.now(astra.THAILAND_TZ).date().isoformat()
    report = {
        "run_date": run_date,
        "draw_count": DRAW_COUNT,
        "date_range": [dated[0][0].isoformat(), dated[-1][0].isoformat()],
        "actuals_sha256": fingerprint,
        "target": "at least 10 exact six-digit first-prize hits over 759 targets, with five distinct candidates per target",
        "walk_forward": "six latent apparatus profiles update from soft assignments of earlier draws only; score the target before assignment and profile updates",
        "model_family": "online soft-assignment latent categorical apparatus model with random post-selection output permutation and punctured-Fano slate decoding",
        "apparatus_count": DIGIT_COUNT,
        "dirichlet_pseudocount_per_digit": 1.0,
        "symmetry_break": {"seed": SYMMETRY_BREAK_SEED,
                           "scale": SYMMETRY_BREAK_SCALE,
                           "purpose": "numerical initialization only"},
        "uniform_expected_hits": DRAW_COUNT * TICKET_COUNT / 1_000_000,
        "v7": {
            "hits": hits,
            "hit_rate_percent": round(100.0 * hits / DRAW_COUNT, 8),
            "hit_dates": hit_dates,
            "mean_joint_log_loss": round(log_loss_sum / DRAW_COUNT, 8),
            "uniform_log_loss": math.log(1_000_000),
            "mean_five_ticket_predictive_mass": round(mass_sum / DRAW_COUNT, 12),
            "forecasts": forecasts,
        },
        "threshold": {"minimum_hits": 10, "met": hits >= 10},
        "validation": {
            "forecast_count": len(forecasts),
            "prior_counts_0_to_758": True,
            "five_distinct_candidates_each": True,
            "recomputed_hits": recomputed_hits,
        },
        "interpretation": "retrospective exploratory evaluation only; no evidence of independent or prospective predictive advantage",
        "elapsed_seconds": round(time.perf_counter() - started, 3),
    }
    output = (ROOT / ".scratch" / "fano-v7-walk-forward" /
              f"results-{run_date}-stage-83-latent-apparatus-bias.json")
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({
        "hits": hits,
        "hit_dates": hit_dates,
        "minimum_hits": 10,
        "met": hits >= 10,
        "mean_joint_log_loss": report["v7"]["mean_joint_log_loss"],
        "uniform_log_loss": report["v7"]["uniform_log_loss"],
        "data_fingerprint": fingerprint,
        "result_file": str(output),
        "elapsed_seconds": report["elapsed_seconds"],
    }, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    run()
