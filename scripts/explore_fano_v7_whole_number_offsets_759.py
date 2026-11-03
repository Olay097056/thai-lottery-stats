"""Stage 64: Fano-coded whole-number modular offset forecasts."""
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
import numpy as np

DRAW_COUNT = 759
EXPECTED_FINGERPRINT = "c7d1cd0199ee945a9102dab341c7353cf0c76272b05d69bee3b6119d0bed6145"
TICKET_COUNT = 5
NUMBER_SPACE = 1_000_000
LAPLACE_ALPHA = 1.0


def _load_draws():
    dated = []
    for row in astra.load_existing_astra_history():
        values = astra._category_values(row, "prize1", 6)
        if values is not None:
            dated.append((astra._history_date(row["date"]), values[0]))
    dated.sort()
    if len(dated) != DRAW_COUNT or len({day for day, _ in dated}) != DRAW_COUNT:
        raise RuntimeError("Expected 759 unique first-prize draws")
    if any(dated[i - 1][0] >= dated[i][0] for i in range(1, DRAW_COUNT)):
        raise RuntimeError("Draw history is not strictly chronological")
    if any(len(number) != 6 or not number.isascii() or not number.isdigit()
           for _, number in dated):
        raise RuntimeError("First-prize values must remain six ASCII digits")
    material = "\n".join(f"{day.isoformat()}|{number}" for day, number in dated).encode("ascii")
    fingerprint = hashlib.sha256(material).hexdigest()
    if fingerprint != EXPECTED_FINGERPRINT:
        raise RuntimeError(f"Dataset fingerprint changed: {fingerprint}")
    return dated, fingerprint


def _offset_probabilities(prior_numbers):
    offsets = [(int(prior_numbers[index + 1]) - int(prior_numbers[index])) % NUMBER_SPACE
               for index in range(len(prior_numbers) - 1)]
    counts = np.zeros((6, 10), dtype=np.float64)
    for offset in offsets:
        text = f"{offset:06d}"
        for position, char in enumerate(text):
            counts[position, ord(char) - 48] += 1.0
    probabilities = (counts + LAPLACE_ALPHA) / (
        len(offsets) + 10.0 * LAPLACE_ALPHA)
    return probabilities, len(offsets)


def _fano_offsets(probabilities):
    rankings = [sorted(range(10), key=lambda digit: (-probabilities[pos, digit], digit))[:2]
                for pos in range(6)]
    best = None
    for puncture in range(7):
        lines = [line for line in range(7) if line != puncture]
        words = []
        for point in range(7):
            digits = [rankings[pos][int(point in fano.FANO_LINES[line])]
                      for pos, line in enumerate(lines)]
            offset = "".join(str(digit) for digit in digits)
            log_mass = sum(math.log(float(probabilities[pos, digit]))
                           for pos, digit in enumerate(digits))
            words.append((offset, log_mass))
        if len({offset for offset, _ in words}) != 7:
            raise RuntimeError("Fano offset codewords must be distinct")
        selected = sorted(words, key=lambda item: (-item[1], item[0]))[:TICKET_COUNT]
        maximum = max(log_mass for _, log_mass in selected)
        score = maximum + math.log(sum(math.exp(log_mass - maximum)
                                       for _, log_mass in selected))
        key = (score, -puncture)
        if best is None or key > best[0]:
            best = (key, selected, puncture)
    _, selected, puncture = best
    offsets = [offset for offset, _ in selected]
    if len(offsets) != TICKET_COUNT or len(set(offsets)) != TICKET_COUNT:
        raise RuntimeError("Fano offset slate must contain five unique values")
    return offsets, puncture + 1


def run():
    started = time.perf_counter()
    dated, fingerprint = _load_draws()
    numbers = [number for _, number in dated]
    hits = 0
    hit_dates = []
    forecasts = []
    loss_sum = 0.0

    for target_index, (target_date, actual) in enumerate(dated):
        prior_numbers = numbers[:target_index]
        probabilities, prior_transition_count = _offset_probabilities(prior_numbers)
        offsets, puncture = _fano_offsets(probabilities)
        base_number = prior_numbers[-1] if prior_numbers else None
        base_value = int(base_number) if base_number is not None else 0
        candidates = [f"{(base_value + int(offset)) % NUMBER_SPACE:06d}"
                      for offset in offsets]
        if len(set(candidates)) != TICKET_COUNT:
            raise RuntimeError("Modular addition must preserve unique candidates")
        hit = actual in candidates
        hits += int(hit)
        if hit:
            hit_dates.append(target_date.isoformat())

        if base_number is None:
            actual_offset = int(actual)
        else:
            actual_offset = (int(actual) - base_value) % NUMBER_SPACE
        actual_offset_text = f"{actual_offset:06d}"
        loss_sum += -sum(math.log(float(probabilities[position, ord(char) - 48]))
                         for position, char in enumerate(actual_offset_text))
        forecasts.append({
            "target_date": target_date.isoformat(),
            "prior_valid_draws": target_index,
            "actual": actual,
            "base_number": base_number,
            "prior_transition_count": prior_transition_count,
            "predicted_offsets": offsets,
            "candidates": candidates,
            "hit": hit,
            "punctured_line": puncture,
            "offset_digit_probabilities": np.round(probabilities, 12).tolist(),
        })
        if (target_index + 1) % 100 == 0:
            print(f"walk-forward: {target_index + 1}/{DRAW_COUNT}, hits={hits}", flush=True)

    recomputed_hits = sum(row["actual"] in row["candidates"] for row in forecasts)
    if len(forecasts) != DRAW_COUNT:
        raise RuntimeError("Forecast count audit failed")
    if [row["target_date"] for row in forecasts] != [day.isoformat() for day, _ in dated]:
        raise RuntimeError("Forecast chronology audit failed")
    if [row["prior_valid_draws"] for row in forecasts] != list(range(DRAW_COUNT)):
        raise RuntimeError("Prior-count audit failed")
    if recomputed_hits != hits:
        raise RuntimeError("Reported hit count differs from candidate lists")
    if any(len(row["candidates"]) != TICKET_COUNT
           or len(set(row["candidates"])) != TICKET_COUNT
           or any(len(value) != 6 or not value.isascii() or not value.isdigit()
                  for value in row["candidates"])
           for row in forecasts):
        raise RuntimeError("Five-distinct-six-digit-candidates audit failed")

    run_date = datetime.now(astra.THAILAND_TZ).date().isoformat()
    report = {
        "run_date": run_date,
        "draw_count": DRAW_COUNT,
        "date_range": [dated[0][0].isoformat(), dated[-1][0].isoformat()],
        "actuals_sha256": fingerprint,
        "target": "at least 10 exact six-digit first-prize hits across 759 targets, using five distinct candidates per draw",
        "walk_forward": "fit modular offset-digit marginals from transitions ending strictly before the target; score five Fano offsets added to the last prior winner",
        "model_family": "prequential whole-ticket modulo-one-million offset model with punctured Fano decoder",
        "modulus": NUMBER_SPACE,
        "laplace_alpha": LAPLACE_ALPHA,
        "uniform_expected_hits": DRAW_COUNT * TICKET_COUNT / NUMBER_SPACE,
        "v7": {"hits": hits, "hit_rate_percent": round(100 * hits / DRAW_COUNT, 8),
               "hit_dates": hit_dates,
               "mean_log_loss": round(loss_sum / DRAW_COUNT, 8),
               "uniform_log_loss": math.log(NUMBER_SPACE),
               "forecasts": forecasts},
        "threshold": {"minimum_hits": 10, "met": hits >= 10},
        "validation": {"forecast_count": len(forecasts), "prior_counts_0_to_758": True,
                       "five_distinct_candidates_each": True,
                       "recomputed_hits": recomputed_hits},
        "interpretation": "historical exploratory evaluation only; no claim of independent predictive evidence",
        "elapsed_seconds": round(time.perf_counter() - started, 3),
    }
    output = ROOT / ".scratch" / "fano-v7-walk-forward" / f"results-{run_date}-stage-64-whole-number-offsets.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"hits": hits, "hit_rate_percent": report["v7"]["hit_rate_percent"],
                      "hit_dates": hit_dates, "mean_log_loss": report["v7"]["mean_log_loss"],
                      "uniform_log_loss": report["v7"]["uniform_log_loss"],
                      "minimum_hits": 10, "met": hits >= 10,
                      "data_fingerprint": fingerprint, "result_file": str(output),
                      "elapsed_seconds": report["elapsed_seconds"]},
                     ensure_ascii=False), flush=True)


if __name__ == "__main__":
    run()
