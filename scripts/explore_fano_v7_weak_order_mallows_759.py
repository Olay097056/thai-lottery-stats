"""Stage 90: prior-only Mallows-style exponential tilt over weak orders."""
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
NUMBER_SPACE = DIGIT_CARDINALITY ** DIGIT_COUNT
TICKET_COUNT = 5
THETA_PRIOR_VARIANCE = 1.0
THETA_BRACKET = 20.0


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


def _all_patterns():
    for groups in range(1, DIGIT_COUNT + 1):
        for pattern in itertools.product(range(groups), repeat=DIGIT_COUNT):
            if len(set(pattern)) == groups:
                yield pattern


def _weak_order(number):
    digits = [ord(char) - 48 for char in number]
    ranks = {digit: rank for rank, digit in enumerate(sorted(set(digits)))}
    return tuple(ranks[digit] for digit in digits)


def _inversions(pattern):
    return sum(pattern[left] > pattern[right]
               for left in range(DIGIT_COUNT)
               for right in range(left + 1, DIGIT_COUNT))


def _pattern_base(pattern):
    groups = 1 + max(pattern)
    realizations = math.comb(DIGIT_CARDINALITY, groups)
    return realizations / NUMBER_SPACE, realizations


def _support():
    rows = []
    for pattern in _all_patterns():
        base, realizations = _pattern_base(pattern)
        rows.append((pattern, base, realizations, _inversions(pattern)))
    if len(rows) != 4683 or not math.isclose(
            sum(row[1] for row in rows), 1.0, rel_tol=0.0, abs_tol=1e-12):
        raise RuntimeError("Weak-order support and uniform base masses must normalize")
    return rows


def _normalizer(theta, support):
    weights = [base * math.exp(theta * score)
               for _, base, _, score in support]
    z = sum(weights)
    mean_score = sum(weight * row[3] for weight, row in zip(weights, support)) / z
    return z, mean_score


def _map_theta(inversion_sum, prior_draws, support):
    if prior_draws == 0:
        return 0.0
    low, high = -THETA_BRACKET, THETA_BRACKET
    for _ in range(72):
        theta = (low + high) / 2.0
        _, mean_score = _normalizer(theta, support)
        derivative = inversion_sum - prior_draws * mean_score - theta / THETA_PRIOR_VARIANCE
        if derivative > 0.0:
            low = theta
        else:
            high = theta
    return (low + high) / 2.0


def _pattern_probability(pattern, theta, support_lookup, z):
    base, realizations, score = support_lookup[pattern]
    pattern_mass = base * math.exp(theta * score) / z
    return pattern_mass / realizations, pattern_mass, realizations


def _fano_codebooks(position_counts, prior_draws):
    marginals = [
        [(position_counts[position][digit] + 1.0) / (prior_draws + 10.0)
         for digit in range(DIGIT_CARDINALITY)]
        for position in range(DIGIT_COUNT)
    ]
    top_two = [sorted(range(DIGIT_CARDINALITY), key=lambda digit: (
        -marginals[position][digit], digit))[:2]
        for position in range(DIGIT_COUNT)]
    codebooks = []
    for puncture in range(7):
        retained_lines = [line for line in range(7) if line != puncture]
        words = []
        for point in range(7):
            number = "".join(
                str(top_two[position][int(point in fano.FANO_LINES[line])])
                    for position, line in enumerate(retained_lines)
            )
            words.append((point, number))
        if len({number for _, number in words}) != 7:
            raise RuntimeError("Each punctured Fano codebook must have seven unique tickets")
        codebooks.append((puncture, words))
    return codebooks, marginals


def _select_slate(codebooks, theta, support_lookup, z):
    scored_codebooks = []
    for puncture, words in codebooks:
        ranked = []
        for point, number in words:
            pattern = _weak_order(number)
            probability, pattern_mass, realizations = _pattern_probability(
                pattern, theta, support_lookup, z)
            ranked.append((point, number, probability, pattern, pattern_mass, realizations))
        selected = sorted(ranked, key=lambda row: (-row[2], row[0]))[:TICKET_COUNT]
        scored_codebooks.append((sum(row[2] for row in selected), puncture, selected))
    mass, puncture, selected = min(
        scored_codebooks,
        key=lambda item: (-item[0], item[1], tuple(row[0] for row in item[2])),
    )
    candidates = [row[1] for row in selected]
    if len(candidates) != TICKET_COUNT or len(set(candidates)) != TICKET_COUNT:
        raise RuntimeError("The selected Fano slate must contain five unique tickets")
    return {"candidates": candidates,
            "punctured_line": puncture + 1,
            "selected_points": [row[0] + 1 for row in selected],
            "candidate_probabilities": [row[2] for row in selected],
            "candidate_patterns": [list(row[3]) for row in selected],
            "candidate_pattern_masses": [row[4] for row in selected],
            "candidate_pattern_realizations": [row[5] for row in selected],
            "five_ticket_predictive_mass": mass}


def run():
    started = time.perf_counter()
    support = _support()
    support_lookup = {pattern: (base, realizations, score)
                      for pattern, base, realizations, score in support}
    dated, fingerprint = _load_draws()
    position_counts = [[0] * DIGIT_CARDINALITY for _ in range(DIGIT_COUNT)]
    inversion_sum = 0
    forecasts = []
    hits = 0
    hit_dates = []
    log_loss_sum = 0.0
    mass_sum = 0.0

    for target_index, (target_date, actual) in enumerate(dated):
        theta = _map_theta(inversion_sum, target_index, support)
        z, expected_inversions = _normalizer(theta, support)
        codebooks, marginals = _fano_codebooks(position_counts, target_index)
        slate = _select_slate(codebooks, theta, support_lookup, z)
        actual_pattern = _weak_order(actual)
        actual_probability, pattern_mass, realizations = _pattern_probability(
            actual_pattern, theta, support_lookup, z)
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
            "prior_inversion_sum": inversion_sum,
            "prior_map_theta": theta,
            "prior_expected_inversions": expected_inversions,
            "actual_weak_order_pattern": list(actual_pattern),
            "actual_inversion_count": _inversions(actual_pattern),
            "actual_pattern_predictive_mass": pattern_mass,
            "actual_pattern_ticket_count": realizations,
            "actual_predictive_probability": actual_probability,
            "prior_position_marginals": marginals,
            "candidate_probabilities": slate["candidate_probabilities"],
            "candidate_patterns": slate["candidate_patterns"],
            "candidate_pattern_masses": slate["candidate_pattern_masses"],
            "candidate_pattern_realizations": slate["candidate_pattern_realizations"],
            "five_ticket_predictive_mass": slate["five_ticket_predictive_mass"],
            "punctured_line": slate["punctured_line"],
            "selected_points": slate["selected_points"],
        })

        # Target pattern and inversion count are added only after scoring.
        inversion_sum += _inversions(actual_pattern)
        for position, char in enumerate(actual):
            position_counts[position][ord(char) - 48] += 1
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
        raise RuntimeError("Reported hit count differs from candidate lists")

    run_date = datetime.now(astra.THAILAND_TZ).date().isoformat()
    report = {
        "run_date": run_date,
        "draw_count": DRAW_COUNT,
        "date_range": [dated[0][0].isoformat(), dated[-1][0].isoformat()],
        "actuals_sha256": fingerprint,
        "target": "at least 10 exact six-digit first-prize hits over 759 targets, with five distinct candidates per target",
        "walk_forward": "the inversion tilt parameter is fit only from earlier weak-order patterns; target information updates after scoring",
        "model_family": "MAP Mallows-style exponential tilt over weak-order inversion counts with punctured-Fano slate decoding",
        "weak_order_pattern_support": len(support),
        "theta_prior": {"family": "normal", "mean": 0.0, "variance": THETA_PRIOR_VARIANCE},
        "theta_numerical_bracket": [-THETA_BRACKET, THETA_BRACKET],
        "uniform_expected_hits": DRAW_COUNT * TICKET_COUNT / NUMBER_SPACE,
        "v7": {
            "hits": hits,
            "hit_rate_percent": round(100.0 * hits / DRAW_COUNT, 8),
            "hit_dates": hit_dates,
            "mean_joint_log_loss": round(log_loss_sum / DRAW_COUNT, 8),
            "uniform_log_loss": math.log(NUMBER_SPACE),
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
              f"results-{run_date}-stage-90-weak-order-mallows.json")
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
