"""Stage 78: empirical checkerboard dependence on adjacent digit pairs."""
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
EXPECTED_FINGERPRINT = "c7d1cd0199ee945a9102dab341c7353cf0c76272b05d69bee3b6119d0bed6145"
TICKET_COUNT = 5
PAIR_PRIOR_STRENGTH = 100.0
POSITION_PAIRS = ((0, 1), (2, 3), (4, 5))


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
    if any(len(number) != 6 or not number.isascii() or not number.isdigit()
           for _, number in dated):
        raise RuntimeError("Every first-prize result must remain six ASCII digits")
    material = "\n".join(f"{day.isoformat()}|{number}" for day, number in dated)
    fingerprint = hashlib.sha256(material.encode("ascii")).hexdigest()
    if fingerprint != EXPECTED_FINGERPRINT:
        raise RuntimeError(f"Fixed 759-draw fingerprint changed: {fingerprint}")
    return dated, fingerprint


def _pair_tables(position_counts, pair_counts, prior_count):
    marginals = [
        [(position_counts[position][digit] + 1.0) / (prior_count + 10.0)
         for digit in range(10)]
        for position in range(6)
    ]
    tables = {}
    for left, right in POSITION_PAIRS:
        denominator = prior_count + PAIR_PRIOR_STRENGTH
        table = [
            [(pair_counts[(left, right)][a][b]
              + PAIR_PRIOR_STRENGTH * marginals[left][a] * marginals[right][b])
             / denominator for b in range(10)]
            for a in range(10)
        ]
        if abs(sum(sum(row) for row in table) - 1.0) > 1e-10:
            raise RuntimeError("A checkerboard pair table does not normalize")
        tables[(left, right)] = table
    return marginals, tables


def _ticket_probability(number, tables):
    digits = [ord(char) - 48 for char in number]
    probability = 1.0
    for left, right in POSITION_PAIRS:
        probability *= tables[(left, right)][digits[left]][digits[right]]
    return probability


def _fano_slate(marginals, tables):
    top_two = [sorted(range(10), key=lambda digit: (
        -marginals[position][digit], digit))[:2]
        for position in range(6)]
    codebooks = []
    for puncture in range(7):
        retained_lines = [line for line in range(7) if line != puncture]
        words = []
        for point in range(7):
            number = "".join(
                str(top_two[position][int(point in fano.FANO_LINES[line])])
                for position, line in enumerate(retained_lines)
            )
            words.append((point, number, _ticket_probability(number, tables)))
        if len({row[1] for row in words}) != 7:
            raise RuntimeError("Each Fano codebook must have seven unique tickets")
        selected = sorted(words, key=lambda row: (-row[2], row[0]))[:TICKET_COUNT]
        codebooks.append((sum(row[2] for row in selected), puncture, selected))
    mass, puncture, selected = min(
        codebooks,
        key=lambda item: (-item[0], item[1], tuple(row[0] for row in item[2])),
    )
    candidates = [row[1] for row in selected]
    if len(candidates) != TICKET_COUNT or len(set(candidates)) != TICKET_COUNT:
        raise RuntimeError("The selected Fano slate must have five unique tickets")
    return {
        "candidates": candidates,
        "candidate_probabilities": [row[2] for row in selected],
        "five_ticket_probability_mass": mass,
        "punctured_line": puncture + 1,
        "selected_points": [row[0] + 1 for row in selected],
    }


def run():
    started = time.perf_counter()
    dated, fingerprint = _load_draws()
    position_counts = [[0] * 10 for _ in range(6)]
    pair_counts = {
        pair: [[0] * 10 for _ in range(10)] for pair in POSITION_PAIRS
    }
    forecasts = []
    hits = 0
    hit_dates = []
    log_loss_sum = 0.0
    mass_sum = 0.0

    for target_index, (target_date, actual) in enumerate(dated):
        marginals, tables = _pair_tables(position_counts, pair_counts, target_index)
        slate = _fano_slate(marginals, tables)
        actual_probability = _ticket_probability(actual, tables)
        if not 0.0 < actual_probability <= 1.0:
            raise RuntimeError("Checkerboard model produced an invalid ticket probability")
        log_loss_sum -= math.log(actual_probability)
        mass_sum += slate["five_ticket_probability_mass"]
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
            "actual_predictive_probability": actual_probability,
            "candidate_predictive_probabilities": slate["candidate_probabilities"],
            "five_ticket_predictive_mass": slate["five_ticket_probability_mass"],
            "digit_marginals": marginals,
            "adjacent_pair_tables": {
                f"{left + 1}-{right + 1}": tables[(left, right)]
                for left, right in POSITION_PAIRS
            },
            "punctured_line": slate["punctured_line"],
            "selected_points": slate["selected_points"],
        })

        # Update positional and pair counts only after current target scoring.
        digits = [ord(char) - 48 for char in actual]
        for position, digit in enumerate(digits):
            position_counts[position][digit] += 1
        for left, right in POSITION_PAIRS:
            pair_counts[(left, right)][digits[left]][digits[right]] += 1

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
           or any(len(number) != 6 or not number.isascii() or not number.isdigit()
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
        "walk_forward": "adjacent empirical pair tables use prior draws only; current marginal and pair counts update after candidate and probability scoring",
        "model_family": "independent empirical checkerboard pair distributions shrunk toward products of prior-only digit marginals, with Fano slate decoding",
        "pair_prior_strength": PAIR_PRIOR_STRENGTH,
        "position_pairs_one_based": [[left + 1, right + 1] for left, right in POSITION_PAIRS],
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
              f"results-{run_date}-stage-78-checkerboard-pairs.json")
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
