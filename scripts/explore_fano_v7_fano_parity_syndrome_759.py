"""Stage 81: punctured-Fano GF(2) digit-parity syndrome model.

Historical walk-forward exploration only. The six decimal digit parities are
mapped through a fixed punctured Fano parity-check matrix; no targets are used
to choose the mechanism or its constants.
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

import astra
import fano

DRAW_COUNT = 759
EXPECTED_FINGERPRINT = "c7d1cd0199ee945a9102dab341c7353cf0c76272b05d69bee3b6119d0bed6145"
TICKET_COUNT = 5
DIRICHLET_STRENGTH = 8.0
# Six points of PG(2,2), with the seventh point punctured. The integer bits
# are fixed column vectors 001, 010, 011, 100, 101, 110.
FANO_COLUMNS = (1, 2, 3, 4, 5, 6)
SYNDROME_COUNT = 8


def _load_draws():
    dated = []
    for row in astra.load_existing_astra_history():
        values = astra._category_values(row, "prize1", 6)
        if values is not None:
            dated.append((astra._history_date(row["date"]), values[0]))
    dated.sort()
    if len(dated) != DRAW_COUNT or len({day for day, _ in dated}) != DRAW_COUNT:
        raise RuntimeError("Expected exactly 759 unique first-prize draws")
    if any(dated[i - 1][0] >= dated[i][0] for i in range(1, DRAW_COUNT)):
        raise RuntimeError("First-prize draws are not strictly chronological")
    if any(len(number) != 6 or not number.isascii() or not number.isdigit()
           for _, number in dated):
        raise RuntimeError("Every first-prize result must remain six ASCII digits")
    material = "\n".join(f"{day.isoformat()}|{number}" for day, number in dated)
    fingerprint = hashlib.sha256(material.encode("ascii")).hexdigest()
    if fingerprint != EXPECTED_FINGERPRINT:
        raise RuntimeError(f"Fixed 759-draw fingerprint changed: {fingerprint}")
    return dated, fingerprint


def _syndrome(number):
    state = 0
    for position, char in enumerate(number):
        if (ord(char) - 48) & 1:
            state ^= FANO_COLUMNS[position]
    return state


def _baseline_syndromes(digit_probabilities):
    distribution = [1.0] + [0.0] * (SYNDROME_COUNT - 1)
    for position, column in enumerate(FANO_COLUMNS):
        odd_probability = sum(digit_probabilities[position][digit]
                              for digit in (1, 3, 5, 7, 9))
        even_probability = 1.0 - odd_probability
        updated = [0.0] * SYNDROME_COUNT
        for state, mass in enumerate(distribution):
            updated[state] += mass * even_probability
            updated[state ^ column] += mass * odd_probability
        distribution = updated
    if any(probability <= 0.0 for probability in distribution):
        raise RuntimeError("Every Fano syndrome must have positive baseline mass")
    return distribution


def _fano_codebooks(digit_probabilities):
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
            if len(number) != 6:
                raise RuntimeError("Fano codewords must preserve six digits")
            words.append((point, number))
        if len({number for _, number in words}) != 7:
            raise RuntimeError("Each punctured Fano codebook must have seven unique tickets")
        codebooks.append((puncture, words))
    return codebooks


def _select_slate(codebooks, digit_probabilities, syndrome_probabilities,
                  baseline_syndromes):
    scored_codebooks = []
    for puncture, words in codebooks:
        ranked = []
        for point, number in words:
            base_mass = math.prod(
                digit_probabilities[position][ord(char) - 48]
                for position, char in enumerate(number)
            )
            syndrome = _syndrome(number)
            probability = (base_mass * syndrome_probabilities[syndrome]
                           / baseline_syndromes[syndrome])
            ranked.append((point, number, probability, syndrome))
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
        "candidate_syndromes": [row[3] for row in selected],
        "candidate_probabilities": [row[2] for row in selected],
        "five_ticket_predictive_mass": mass,
    }


def run():
    started = time.perf_counter()
    dated, fingerprint = _load_draws()
    digit_counts = [[0] * 10 for _ in range(6)]
    syndrome_counts = [0] * SYNDROME_COUNT
    forecasts = []
    hits = 0
    hit_dates = []
    log_loss_sum = 0.0
    mass_sum = 0.0

    for target_index, (target_date, actual) in enumerate(dated):
        digit_probabilities = [
            [(digit_counts[position][digit] + 1.0) / (target_index + 10.0)
             for digit in range(10)]
            for position in range(6)
        ]
        baseline = _baseline_syndromes(digit_probabilities)
        total_weight = target_index + DIRICHLET_STRENGTH
        predicted = [
            (syndrome_counts[state] + DIRICHLET_STRENGTH * baseline[state])
            / total_weight
            for state in range(SYNDROME_COUNT)
        ]
        codebooks = _fano_codebooks(digit_probabilities)
        slate = _select_slate(codebooks, digit_probabilities, predicted, baseline)

        actual_syndrome = _syndrome(actual)
        base_actual_mass = math.prod(
            digit_probabilities[position][ord(char) - 48]
            for position, char in enumerate(actual)
        )
        actual_probability = (base_actual_mass * predicted[actual_syndrome]
                              / baseline[actual_syndrome])
        if not 0.0 < actual_probability <= 1.0:
            raise RuntimeError("Syndrome-tilted probability is outside (0, 1]")
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
            "prior_syndrome_counts": syndrome_counts[:],
            "actual_syndrome": actual_syndrome,
            "predicted_syndrome_probabilities": predicted,
            "baseline_syndrome_probabilities": baseline,
            "candidate_syndromes": slate["candidate_syndromes"],
            "candidate_probabilities": slate["candidate_probabilities"],
            "five_ticket_predictive_mass": slate["five_ticket_predictive_mass"],
            "punctured_line": slate["punctured_line"],
            "selected_points": slate["selected_points"],
            "actual_predictive_probability": actual_probability,
        })

        # The outcome is added only after the candidate slate is scored.
        syndrome_counts[actual_syndrome] += 1
        for position, char in enumerate(actual):
            digit_counts[position][ord(char) - 48] += 1

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
           or any(len(number) != 6 or not number.isascii() or not number.isdigit()
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
        "walk_forward": "positional digit marginals and Fano parity-syndrome counts use only draws before the target; update follows scoring",
        "model_family": "punctured-Fano GF(2) digit-parity syndrome reweighting with a fixed Fano codebook decoder",
        "fano_parity_columns": list(FANO_COLUMNS),
        "syndrome_prior_strength": DIRICHLET_STRENGTH,
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
              f"results-{run_date}-stage-81-fano-parity-syndrome.json")
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
