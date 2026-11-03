"""Stage 68: prior-only modulo-9 state transitions with a Fano decoder."""
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
RESIDUE_COUNT = 9
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


def _base_residue_probabilities(digit_probabilities):
    distribution = [1.0] + [0.0] * (RESIDUE_COUNT - 1)
    for position in range(6):
        updated = [0.0] * RESIDUE_COUNT
        for prior_residue, prior_mass in enumerate(distribution):
            for digit, digit_mass in enumerate(digit_probabilities[position]):
                updated[(prior_residue + digit) % RESIDUE_COUNT] += prior_mass * digit_mass
        distribution = updated
    if any(value <= 0.0 for value in distribution):
        raise RuntimeError("Every modulo-9 class must have positive baseline mass")
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


def _select_slate(codebooks, digit_probabilities, residue_probabilities,
                  baseline_residue_probabilities):
    scored_codebooks = []
    for puncture, words in codebooks:
        ranked = []
        for point, number in words:
            base_mass = math.prod(
                digit_probabilities[position][ord(char) - 48]
                for position, char in enumerate(number)
            )
            residue = sum(ord(char) - 48 for char in number) % RESIDUE_COUNT
            probability = (base_mass * residue_probabilities[residue]
                           / baseline_residue_probabilities[residue])
            ranked.append((point, number, probability, residue))
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
        "candidate_residues": [row[3] for row in selected],
        "candidate_probabilities": [row[2] for row in selected],
        "five_ticket_predictive_mass": mass,
    }


def run():
    started = time.perf_counter()
    dated, fingerprint = _load_draws()
    position_counts = [[0] * 10 for _ in range(6)]
    transition_counts = [[0] * RESIDUE_COUNT for _ in range(RESIDUE_COUNT)]
    prior_residues = []
    forecasts = []
    hits = 0
    hit_dates = []
    log_loss_sum = 0.0
    mass_sum = 0.0

    for target_index, (target_date, actual) in enumerate(dated):
        digit_probabilities = [
            [(position_counts[position][digit] + DIRICHLET_ALPHA)
             / (target_index + 10.0 * DIRICHLET_ALPHA)
             for digit in range(10)]
            for position in range(6)
        ]
        baseline_residues = _base_residue_probabilities(digit_probabilities)
        if prior_residues:
            source_residue = prior_residues[-1]
            row = transition_counts[source_residue]
            row_total = sum(row)
            predicted_residues = [
                (row[residue] + DIRICHLET_ALPHA)
                / (row_total + RESIDUE_COUNT * DIRICHLET_ALPHA)
                for residue in range(RESIDUE_COUNT)
            ]
        else:
            source_residue = None
            predicted_residues = [1.0 / RESIDUE_COUNT] * RESIDUE_COUNT

        codebooks = _fano_codebooks(digit_probabilities)
        slate = _select_slate(codebooks, digit_probabilities,
                              predicted_residues, baseline_residues)
        actual_residue = sum(ord(char) - 48 for char in actual) % RESIDUE_COUNT
        base_actual_mass = math.prod(
            digit_probabilities[position][ord(char) - 48]
            for position, char in enumerate(actual)
        )
        actual_probability = (base_actual_mass * predicted_residues[actual_residue]
                              / baseline_residues[actual_residue])
        if not 0.0 < actual_probability <= 1.0:
            raise RuntimeError("Residue-tilted probability is outside (0, 1]")
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
            "prior_source_residue": source_residue,
            "actual_residue": actual_residue,
            "predicted_residue_probabilities": predicted_residues,
            "baseline_residue_probabilities": baseline_residues,
            "candidate_residues": slate["candidate_residues"],
            "candidate_probabilities": slate["candidate_probabilities"],
            "five_ticket_predictive_mass": slate["five_ticket_predictive_mass"],
            "punctured_line": slate["punctured_line"],
            "selected_points": slate["selected_points"],
            "actual_predictive_probability": actual_probability,
        })

        # The target residue and digits update state only after scoring.
        if prior_residues:
            transition_counts[prior_residues[-1]][actual_residue] += 1
        prior_residues.append(actual_residue)
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
        "walk_forward": "digit marginals and modulo-9 transition counts use only data before the target; the current residue and digits update state only after scoring",
        "model_family": "first-order whole-ticket digital-root transition reweighting of independent digit marginals, decoded through punctured Fano codebooks",
        "residue_modulus": RESIDUE_COUNT,
        "transition_dirichlet_alpha": DIRICHLET_ALPHA,
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
              f"results-{run_date}-stage-68-mod9-state.json")
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
