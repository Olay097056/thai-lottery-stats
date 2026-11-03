"""Stage 74: Markov transitions over six-position weak-order patterns."""
from __future__ import annotations

from datetime import datetime
import hashlib
import itertools
import json
import math
from pathlib import Path
import sys
import time

from collections import defaultdict

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import astra
import fano

DRAW_COUNT = 759
EXPECTED_FINGERPRINT = "c7d1cd0199ee945a9102dab341c7353cf0c76272b05d69bee3b6119d0bed6145"
NUMBER_SPACE = 1_000_000
TICKET_COUNT = 5
DIGIT_COUNT = 6
DIGIT_ALPHABET_SIZE = 10


def _restricted_growth_strings(length, prefix=(0,), maximum=0):
    if len(prefix) == length:
        yield prefix
        return
    for label in range(maximum + 2):
        yield from _restricted_growth_strings(
            length, prefix + (label,), max(maximum, label)
        )


def _weak_order_pattern(number):
    values = [ord(char) - 48 for char in number]
    levels = {value: index for index, value in enumerate(sorted(set(values)))}
    return tuple(levels[value] for value in values)


def _all_order_patterns():
    patterns = []
    for equality in _restricted_growth_strings(DIGIT_COUNT):
        block_count = max(equality) + 1
        for ordered_labels in itertools.permutations(range(block_count)):
            patterns.append(tuple(ordered_labels[label] for label in equality))
    return tuple(patterns)


def _load_draws():
    dated = []
    for row in astra.load_existing_astra_history():
        values = astra._category_values(row, "prize1", 6)
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


def _fano_codebooks():
    codebooks = []
    for puncture in range(7):
        retained_lines = [line for line in range(7) if line != puncture]
        words = []
        for point in range(7):
            number = "".join(
                str(int(point in fano.FANO_LINES[line]))
                for line in retained_lines
            )
            words.append((point, number))
        if len({number for _, number in words}) != 7:
            raise RuntimeError("Each binary Fano codebook must have seven unique tickets")
        codebooks.append((puncture, words))
    return codebooks


def _select_slate(codebooks, pattern_probabilities, assignment_counts):
    scored_codebooks = []
    for puncture, words in codebooks:
        ranked = []
        for point, number in words:
            pattern = _weak_order_pattern(number)
            probability = pattern_probabilities[pattern] / assignment_counts[pattern]
            ranked.append((point, number, probability, pattern))
        selected = sorted(ranked, key=lambda row: (-row[2], row[0]))[:TICKET_COUNT]
        scored_codebooks.append((sum(row[2] for row in selected), puncture, selected))
    mass, puncture, selected = min(
        scored_codebooks,
        key=lambda item: (-item[0], item[1], tuple(row[0] for row in item[2])),
    )
    candidates = [row[1] for row in selected]
    if len(candidates) != TICKET_COUNT or len(set(candidates)) != TICKET_COUNT:
        raise RuntimeError("The selected Fano slate must contain five unique tickets")
    return {
        "candidates": candidates,
        "candidate_patterns": [list(row[3]) for row in selected],
        "candidate_predictive_probabilities": [row[2] for row in selected],
        "five_ticket_predictive_mass": mass,
        "punctured_line": puncture + 1,
        "selected_points": [row[0] + 1 for row in selected],
    }


def run():
    started = time.perf_counter()
    dated, fingerprint = _load_draws()
    patterns = _all_order_patterns()
    if len(patterns) != 4683 or len(set(patterns)) != len(patterns):
        raise RuntimeError("Expected 4,683 unique weak-order patterns")
    assignment_counts = {
        pattern: math.comb(DIGIT_ALPHABET_SIZE, max(pattern) + 1)
        for pattern in patterns
    }
    if sum(assignment_counts.values()) != NUMBER_SPACE:
        raise RuntimeError("Weak-order patterns must partition one million tickets")
    prior_pattern_mass = {
        pattern: assignment_counts[pattern] / NUMBER_SPACE for pattern in patterns
    }
    codebooks = _fano_codebooks()

    prior_patterns = []
    transitions = defaultdict(dict)
    forecasts = []
    hits = 0
    hit_dates = []
    log_loss_sum = 0.0
    mass_sum = 0.0

    for target_index, (target_date, actual) in enumerate(dated):
        source_pattern = prior_patterns[-1] if prior_patterns else None
        source_counts = transitions.get(source_pattern, {}) if source_pattern is not None else {}
        source_total = sum(source_counts.values())
        denominator = source_total + 1.0
        pattern_probabilities = {
            pattern: (source_counts.get(pattern, 0) + prior_pattern_mass[pattern]) / denominator
            for pattern in patterns
        }
        if abs(sum(pattern_probabilities.values()) - 1.0) > 1e-10:
            raise RuntimeError("Weak-order posterior predictive does not normalize")

        slate = _select_slate(codebooks, pattern_probabilities, assignment_counts)
        actual_pattern = _weak_order_pattern(actual)
        actual_probability = pattern_probabilities[actual_pattern] / assignment_counts[actual_pattern]
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
            "source_weak_order_pattern": list(source_pattern) if source_pattern is not None else None,
            "actual_weak_order_pattern": list(actual_pattern),
            "actual_pattern_transition_count": source_counts.get(actual_pattern, 0),
            "actual_predictive_probability": actual_probability,
            "candidate_weak_order_patterns": slate["candidate_patterns"],
            "candidate_predictive_probabilities": slate["candidate_predictive_probabilities"],
            "five_ticket_predictive_mass": slate["five_ticket_predictive_mass"],
            "punctured_line": slate["punctured_line"],
            "selected_points": slate["selected_points"],
        })

        if source_pattern is not None:
            row = transitions[source_pattern]
            row[actual_pattern] = row.get(actual_pattern, 0) + 1
        prior_patterns.append(actual_pattern)

        if (target_index + 1) % 100 == 0:
            print(f"walk-forward: {target_index + 1}/{DRAW_COUNT}, hits={hits}",
                  flush=True)

    recomputed_hits = sum(row["actual"] in row["candidates"] for row in forecasts)
    expected_dates = [day.isoformat() for day, _ in dated]
    if len(forecasts) != DRAW_COUNT:
        raise RuntimeError("Forecast count must be exactly 759")
    if [row["target_date"] for row in forecasts] != expected_dates:
        raise RuntimeError("Walk-forward forecasts are not chronological")
    if [row["prior_valid_draws"] for row in forecasts] != list(range(DRAW_COUNT)):
        raise RuntimeError("Prior draw counts must run from 0 through 758")
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
        "walk_forward": "weak-order pattern transitions use prior targets only; current pattern is added after scoring",
        "model_family": "first-order Markov prediction over six-position weak-order patterns with uniform digit-level assignments and binary Fano codebooks",
        "weak_order_pattern_count": len(patterns),
        "prior_mass": "number of increasing digit-level assignments / 1000000; total concentration 1",
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
              f"results-{run_date}-stage-74-weak-order-markov.json")
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
