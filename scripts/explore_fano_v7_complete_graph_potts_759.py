"""Stage 99: exchangeable complete-graph Potts model over digit positions."""
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
EXPECTED_FINGERPRINT = "c7d1cd0199ee945a9102dab341c7353cf0c76272b05d69bee3b6119d0bed6145"
DIGIT_COUNT = 6
DIGIT_CARDINALITY = 10
TICKET_COUNT = 5
DIGIT_PRIOR_STRENGTH = 10.0
PAIR_PRIOR_STRENGTH = 100.0


def _load_draws():
    dated = []
    for row in astra.load_existing_astra_history():
        values = astra._category_values(row, "prize1", DIGIT_COUNT)
        if values is not None:
            dated.append((astra._history_date(row["date"]), values[0]))
    dated.sort()
    if len(dated) != DRAW_COUNT or len({day for day, _ in dated}) != DRAW_COUNT:
        raise RuntimeError("Expected exactly 759 unique first-prize draws")
    if any(dated[i - 1][0] >= dated[i][0] for i in range(1, DRAW_COUNT)):
        raise RuntimeError("First-prize draws are not strictly chronological")
    if any(len(number) != DIGIT_COUNT or not number.isascii() or not number.isdigit()
           for _, number in dated):
        raise RuntimeError("Every first-prize result must remain six ASCII digits")
    material = "\n".join(f"{day.isoformat()}|{number}" for day, number in dated)
    fingerprint = hashlib.sha256(material.encode("ascii")).hexdigest()
    if fingerprint != EXPECTED_FINGERPRINT:
        raise RuntimeError(f"Fixed 759-draw fingerprint changed: {fingerprint}")
    return dated, fingerprint


def _compositions(total, bins, prefix=()):
    if bins == 1:
        yield prefix + (total,)
        return
    for value in range(total + 1):
        yield from _compositions(total - value, bins - 1, prefix + (value,))


def _support():
    rows = []
    for counts in _compositions(DIGIT_COUNT, DIGIT_CARDINALITY):
        permutations = math.factorial(DIGIT_COUNT)
        for count in counts:
            permutations //= math.factorial(count)
        active = [(digit, count) for digit, count in enumerate(counts) if count]
        pair_exponents = []
        for active_index, (left, left_count) in enumerate(active):
            for right, right_count in active[active_index:]:
                exponent = (left_count * (left_count - 1) // 2
                            if left == right else left_count * right_count)
                if exponent:
                    pair_exponents.append((left, right, exponent))
        rows.append((counts, permutations, active, pair_exponents))
    if len(rows) != 5005:
        raise RuntimeError("Complete-graph partition support must contain 5,005 multisets")
    return rows


def _multiset(number):
    counts = [0] * DIGIT_CARDINALITY
    for char in number:
        counts[ord(char) - 48] += 1
    return tuple(counts)


def _model(digit_counts, pair_counts, support, prior_draws):
    digit_denominator = DIGIT_COUNT * prior_draws + DIGIT_PRIOR_STRENGTH
    marginal = [(count + DIGIT_PRIOR_STRENGTH / DIGIT_CARDINALITY) / digit_denominator
                for count in digit_counts]
    pair_total = sum(sum(row) for row in pair_counts)
    potential = [[0.0] * DIGIT_CARDINALITY for _ in range(DIGIT_CARDINALITY)]
    for left in range(DIGIT_CARDINALITY):
        for right in range(DIGIT_CARDINALITY):
            symmetric_observed = pair_counts[left][right]
            pair_probability = (
                symmetric_observed + PAIR_PRIOR_STRENGTH * marginal[left] * marginal[right]
            ) / (pair_total + PAIR_PRIOR_STRENGTH)
            potential[left][right] = pair_probability / (marginal[left] * marginal[right])

    multiset_ticket_weights = {}
    normalizer = 0.0
    for counts, permutations, active, pair_exponents in support:
        weight = 1.0
        for digit, count in active:
            weight *= marginal[digit] ** count
        for left, right, exponent in pair_exponents:
            weight *= potential[left][right] ** exponent
        multiset_ticket_weights[counts] = weight
        normalizer += permutations * weight
    if not math.isfinite(normalizer) or normalizer <= 0.0:
        raise RuntimeError("Complete-graph Potts partition function is invalid")

    position_marginal = [0.0] * DIGIT_CARDINALITY
    for counts, permutations, _, _ in support:
        multiset_probability = permutations * multiset_ticket_weights[counts] / normalizer
        for digit, count in enumerate(counts):
            position_marginal[digit] += multiset_probability * count / DIGIT_COUNT
    return marginal, potential, normalizer, multiset_ticket_weights, position_marginal


def _ticket_probability(number, potential, normalizer, weights):
    digits = [ord(char) - 48 for char in number]
    weight = weights[_multiset(number)]
    return weight / normalizer


def _fano_slates(position_marginal, potential, normalizer, weights):
    top_two = sorted(range(DIGIT_CARDINALITY), key=lambda digit: (
        -position_marginal[digit], digit))[:2]
    scored = []
    for puncture in range(7):
        retained_lines = [line for line in range(7) if line != puncture]
        words = []
        for point in range(7):
            number = "".join(
                str(top_two[int(point in fano.FANO_LINES[line])])
                for line in retained_lines
            )
            probability = _ticket_probability(number, potential, normalizer, weights)
            words.append((point, number, probability))
        if len({number for _, number, _ in words}) != 7:
            raise RuntimeError("Each punctured Fano codebook must have seven unique tickets")
        selected = sorted(words, key=lambda row: (-row[2], row[0]))[:TICKET_COUNT]
        scored.append((sum(row[2] for row in selected), puncture, selected))
    mass, puncture, selected = min(
        scored, key=lambda row: (-row[0], row[1], tuple(x[0] for x in row[2]))
    )
    candidates = [row[1] for row in selected]
    if len(candidates) != TICKET_COUNT or len(set(candidates)) != TICKET_COUNT:
        raise RuntimeError("The selected Fano slate must have five unique tickets")
    return {
        "candidates": candidates,
        "candidate_probabilities": [row[2] for row in selected],
        "five_ticket_predictive_mass": mass,
        "punctured_line": puncture + 1,
        "selected_points": [row[0] + 1 for row in selected],
    }


def run():
    started = time.perf_counter()
    support = _support()
    dated, fingerprint = _load_draws()
    digit_counts = [0] * DIGIT_CARDINALITY
    pair_counts = [[0.0] * DIGIT_CARDINALITY for _ in range(DIGIT_CARDINALITY)]
    forecasts = []
    hits = 0
    hit_dates = []
    log_loss_sum = 0.0
    slate_mass_sum = 0.0

    for target_index, (target_date, actual) in enumerate(dated):
        marginal, potential, normalizer, weights, position_marginal = _model(
            digit_counts, pair_counts, support, target_index)
        slate = _fano_slates(position_marginal, potential, normalizer, weights)
        actual_probability = _ticket_probability(actual, potential, normalizer, weights)
        log_loss_sum -= math.log(actual_probability)
        slate_mass_sum += slate["five_ticket_predictive_mass"]
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
            "prior_shared_digit_marginal": marginal,
            "prior_symmetric_pair_counts": pair_counts,
            "prior_complete_graph_potential": potential,
            "prior_partition_function": normalizer,
            "prior_exact_position_marginal": position_marginal,
            "actual_predictive_probability": actual_probability,
            "candidate_probabilities": slate["candidate_probabilities"],
            "five_ticket_predictive_mass": slate["five_ticket_predictive_mass"],
            "punctured_line": slate["punctured_line"],
            "selected_points": slate["selected_points"],
        })

        # Update sufficient statistics only after this target is scored.
        digits = [ord(char) - 48 for char in actual]
        for digit in digits:
            digit_counts[digit] += 1
        for i in range(DIGIT_COUNT):
            for j in range(i + 1, DIGIT_COUNT):
                left, right = digits[i], digits[j]
                if left == right:
                    pair_counts[left][right] += 1.0
                else:
                    pair_counts[left][right] += 0.5
                    pair_counts[right][left] += 0.5
        if (target_index + 1) % 100 == 0:
            print(f"walk-forward: {target_index + 1}/{DRAW_COUNT}, hits={hits}", flush=True)

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
        raise RuntimeError("Reported hits do not match the candidate lists")

    run_date = datetime.now(astra.THAILAND_TZ).date().isoformat()
    report = {
        "run_date": run_date,
        "draw_count": DRAW_COUNT,
        "date_range": [dated[0][0].isoformat(), dated[-1][0].isoformat()],
        "actuals_sha256": fingerprint,
        "target": "at least 10 exact six-digit first-prize hits over 759 targets, with five distinct candidates per target",
        "walk_forward": "exchangeable pair interaction statistics update only after scoring each target",
        "model_family": "exchangeable complete-graph Potts model with exact multiset partition function and punctured-Fano slate decoding",
        "multiset_partition_support": len(support),
        "digit_prior_strength": DIGIT_PRIOR_STRENGTH,
        "pair_independence_prior_strength": PAIR_PRIOR_STRENGTH,
        "uniform_expected_hits": DRAW_COUNT * TICKET_COUNT / (DIGIT_CARDINALITY ** DIGIT_COUNT),
        "v7": {
            "hits": hits,
            "hit_rate_percent": round(100.0 * hits / DRAW_COUNT, 8),
            "hit_dates": hit_dates,
            "mean_joint_log_loss": round(log_loss_sum / DRAW_COUNT, 8),
            "uniform_log_loss": math.log(DIGIT_CARDINALITY ** DIGIT_COUNT),
            "mean_five_ticket_predictive_mass": round(slate_mass_sum / DRAW_COUNT, 12),
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
              f"results-{run_date}-stage-99-complete-graph-potts.json")
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
