"""Stage 96: Markov transitions over absolute digit-parity signatures."""
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
DIGIT_COUNT = 6
DIGIT_CARDINALITY = 10
STATE_COUNT = 2 ** DIGIT_COUNT
REALIZATIONS_PER_STATE = 5 ** DIGIT_COUNT
TICKET_COUNT = 5
TRANSITION_PRIOR_STRENGTH = 1.0


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


def _parity_signature(number):
    return sum(((ord(char) - 48) % 2) << position
               for position, char in enumerate(number))


def _transition_distribution(previous_signature, transition_counts):
    if previous_signature is None:
        return [1.0 / STATE_COUNT] * STATE_COUNT
    observed = transition_counts.get(previous_signature, {})
    total = sum(observed.values())
    denominator = total + TRANSITION_PRIOR_STRENGTH
    return [
        (observed.get(signature, 0) + TRANSITION_PRIOR_STRENGTH / STATE_COUNT)
        / denominator
        for signature in range(STATE_COUNT)
    ]


def _position_marginals(signature_probabilities):
    marginals = []
    for position in range(DIGIT_COUNT):
        even_mass = sum(probability for signature, probability in enumerate(signature_probabilities)
                        if not ((signature >> position) & 1))
        odd_mass = 1.0 - even_mass
        row = [0.0] * DIGIT_CARDINALITY
        for digit in range(DIGIT_CARDINALITY):
            row[digit] = (odd_mass if digit % 2 else even_mass) / 5.0
        marginals.append(row)
    return marginals


def _ticket_probability(number, signature_probabilities):
    return signature_probabilities[_parity_signature(number)] / REALIZATIONS_PER_STATE


def _fano_slates(position_marginals, signature_probabilities):
    top_two = [sorted(range(DIGIT_CARDINALITY), key=lambda digit: (
        -position_marginals[position][digit], digit))[:2]
        for position in range(DIGIT_COUNT)]
    scored = []
    for puncture in range(7):
        retained_lines = [line for line in range(7) if line != puncture]
        words = []
        for point in range(7):
            number = "".join(
                str(top_two[position][int(point in fano.FANO_LINES[line])])
                for position, line in enumerate(retained_lines)
            )
            words.append((point, number,
                          _ticket_probability(number, signature_probabilities)))
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
    dated, fingerprint = _load_draws()
    transition_counts = {}
    previous_signature = None
    forecasts = []
    hits = 0
    hit_dates = []
    log_loss_sum = 0.0
    slate_mass_sum = 0.0

    for target_index, (target_date, actual) in enumerate(dated):
        signature_probabilities = _transition_distribution(
            previous_signature, transition_counts)
        marginals = _position_marginals(signature_probabilities)
        slate = _fano_slates(marginals, signature_probabilities)
        actual_signature = _parity_signature(actual)
        actual_probability = signature_probabilities[actual_signature] / REALIZATIONS_PER_STATE
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
            "prior_previous_parity_signature": previous_signature,
            "actual_parity_signature": actual_signature,
            "prior_transition_counts": {
                str(state): dict(counts) for state, counts in transition_counts.items()
            },
            "actual_predictive_probability": actual_probability,
            "prior_parity_signature_probabilities": signature_probabilities,
            "prior_position_marginals": marginals,
            "candidate_probabilities": slate["candidate_probabilities"],
            "five_ticket_predictive_mass": slate["five_ticket_predictive_mass"],
            "punctured_line": slate["punctured_line"],
            "selected_points": slate["selected_points"],
        })

        # Record the transition only after the target is forecast and scored.
        if previous_signature is not None:
            transition_counts.setdefault(previous_signature, {})[actual_signature] = (
                transition_counts.get(previous_signature, {}).get(actual_signature, 0) + 1)
        previous_signature = actual_signature
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
        "walk_forward": "absolute parity-signature transitions use only earlier draws; state updates after scoring",
        "model_family": "first-order Markov model over six-position absolute digit-parity signatures with punctured-Fano decoding",
        "state_count": STATE_COUNT,
        "tickets_per_state": REALIZATIONS_PER_STATE,
        "transition_prior_strength": TRANSITION_PRIOR_STRENGTH,
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
              f"results-{run_date}-stage-96-parity-transition.json")
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
