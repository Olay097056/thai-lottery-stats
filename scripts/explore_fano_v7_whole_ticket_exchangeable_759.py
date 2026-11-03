"""Stage 67: exchangeable whole-ticket recurrence with a Fano codebook."""
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
NUMBER_SPACE = 1_000_000
TICKET_COUNT = 5
DIRICHLET_ALPHA = 1.0


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


def _fano_codebooks(position_counts):
    prior_count = sum(position_counts[0])
    digit_probabilities = [
        [(position_counts[position][digit] + DIRICHLET_ALPHA)
         / (prior_count + 10.0 * DIRICHLET_ALPHA)
         for digit in range(10)]
        for position in range(6)
    ]
    top_two = [sorted(range(10), key=lambda digit: (
        -digit_probabilities[position][digit], digit))[:2]
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
            words.append((point, number))
        if len({number for _, number in words}) != 7:
            raise RuntimeError("Fano point codebook must contain seven unique tickets")
        codebooks.append((puncture, words))
    return digit_probabilities, codebooks


def _select_slate(codebooks, ticket_counts, prior_count):
    denominator = prior_count + DIRICHLET_ALPHA * NUMBER_SPACE
    scored_codebooks = []
    for puncture, words in codebooks:
        ranked = sorted(
            ((point, number, ticket_counts.get(number, 0) + DIRICHLET_ALPHA)
             for point, number in words),
            key=lambda row: (-row[2], row[0]),
        )
        selected = ranked[:TICKET_COUNT]
        score_sum = sum(score for _, _, score in selected)
        scored_codebooks.append((score_sum, puncture, selected, ranked))

    # Choose only among codebooks using their prior-only posterior ticket mass.
    score_sum, puncture, selected, ranked = min(
        scored_codebooks,
        key=lambda item: (-item[0], item[1], tuple(row[0] for row in item[2])),
    )
    candidates = [number for _, number, _ in selected]
    if len(candidates) != TICKET_COUNT or len(set(candidates)) != TICKET_COUNT:
        raise RuntimeError("The selected slate must have five unique six-digit tickets")
    return {
        "candidates": candidates,
        "punctured_line": puncture + 1,
        "selected_points": [point + 1 for point, _, _ in selected],
        "candidate_prior_counts": [ticket_counts.get(number, 0) for number in candidates],
        "five_ticket_predictive_mass": score_sum / denominator,
        "seven_point_scores": [
            {"point": point + 1, "number": number,
             "prior_exact_count": ticket_counts.get(number, 0),
             "posterior_predictive": score / denominator}
            for point, number, score in ranked
        ],
    }


def run():
    started = time.perf_counter()
    dated, fingerprint = _load_draws()
    ticket_counts = {}
    position_counts = [[0] * 10 for _ in range(6)]
    forecasts = []
    hits = 0
    hit_dates = []
    log_loss_sum = 0.0
    mass_sum = 0.0

    for target_index, (target_date, actual) in enumerate(dated):
        digit_probabilities, codebooks = _fano_codebooks(position_counts)
        slate = _select_slate(codebooks, ticket_counts, target_index)
        predictive_probability = (
            ticket_counts.get(actual, 0) + DIRICHLET_ALPHA
        ) / (target_index + DIRICHLET_ALPHA * NUMBER_SPACE)
        log_loss_sum -= math.log(predictive_probability)
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
            "punctured_line": slate["punctured_line"],
            "selected_points": slate["selected_points"],
            "prior_exact_counts": slate["candidate_prior_counts"],
            "actual_prior_exact_count": ticket_counts.get(actual, 0),
            "five_ticket_predictive_mass": slate["five_ticket_predictive_mass"],
            "seven_point_scores": slate["seven_point_scores"],
        })

        # Update the exact-ticket and positional counts after this target scores.
        ticket_counts[actual] = ticket_counts.get(actual, 0) + 1
        for position, char in enumerate(actual):
            position_counts[position][ord(char) - 48] += 1

        if (target_index + 1) % 100 == 0:
            print(f"walk-forward: {target_index + 1}/{DRAW_COUNT}, hits={hits}",
                  flush=True)

    recomputed_hits = sum(
        row["actual"] in row["candidates"] for row in forecasts
    )
    expected_dates = [day.isoformat() for day, _ in dated]
    if len(forecasts) != DRAW_COUNT:
        raise RuntimeError("Forecast count must be exactly 759")
    if [row["target_date"] for row in forecasts] != expected_dates:
        raise RuntimeError("Walk-forward forecast dates are out of order")
    if [row["prior_valid_draws"] for row in forecasts] != list(range(DRAW_COUNT)):
        raise RuntimeError("Prior draw counts must run from 0 through 758")
    if any(len(row["candidates"]) != TICKET_COUNT
           or len(set(row["candidates"])) != TICKET_COUNT
           or any(len(number) != 6 or not number.isascii() or not number.isdigit()
                  for number in row["candidates"])
           for row in forecasts):
        raise RuntimeError("Every draw needs five unique six-digit candidates")
    if recomputed_hits != hits:
        raise RuntimeError("Reported hits do not match the candidate lists")

    run_date = datetime.now(astra.THAILAND_TZ).date().isoformat()
    report = {
        "run_date": run_date,
        "draw_count": DRAW_COUNT,
        "date_range": [dated[0][0].isoformat(), dated[-1][0].isoformat()],
        "actuals_sha256": fingerprint,
        "target": "at least 10 exact six-digit first-prize hits over 759 targets, with five distinct candidates per target",
        "walk_forward": "exact-ticket and positional counts are computed from draws strictly before the target; the actual updates both counts only after scoring",
        "model_family": "symmetric exchangeable whole-ticket Dirichlet posterior predictive ranking restricted to punctured Fano point codebooks",
        "dirichlet_per_ticket_alpha": DIRICHLET_ALPHA,
        "number_space": NUMBER_SPACE,
        "uniform_expected_hits": DRAW_COUNT * TICKET_COUNT / NUMBER_SPACE,
        "v7": {
            "hits": hits,
            "hit_rate_percent": round(100.0 * hits / DRAW_COUNT, 8),
            "hit_dates": hit_dates,
            "mean_whole_ticket_log_loss": round(log_loss_sum / DRAW_COUNT, 8),
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
              f"results-{run_date}-stage-67-whole-ticket-exchangeable.json")
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({
        "hits": hits,
        "hit_dates": hit_dates,
        "minimum_hits": 10,
        "met": hits >= 10,
        "mean_whole_ticket_log_loss": report["v7"]["mean_whole_ticket_log_loss"],
        "uniform_log_loss": report["v7"]["uniform_log_loss"],
        "data_fingerprint": fingerprint,
        "result_file": str(output),
        "elapsed_seconds": report["elapsed_seconds"],
    }, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    run()
