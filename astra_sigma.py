"""Astra-Σ Mythic Blend v0.1 — isolated experimental ranker.

Pure scoring only: callers provide validated history. The future-target loader
and API adapter live separately. This heuristic has no demonstrated accuracy
advantage; its composite score is a ranking score, not a probability.
"""
from __future__ import annotations

from collections import Counter
from datetime import date, datetime
from math import log
import re

import numpy as np

import astra

VERSION = "astra-sigma-v0.1"
WEIGHTS = {
    "A": 0.50,
    "H": 0.10,
    "D": 0.10,
    "N": 0.12,
    "L": 0.08,
    "B": 0.10,
}
SETTINGS = {
    "max_draws": 200,
    "min_valid_draws": 20,
    "signal_window_valid_draws": 24,
    "overdue_cap_valid_draws": 24,
    "hot_definition": "position_digit_fraction; equal weight per draw then slot",
    "overdue_definition": "valid category draws since same-position appearance; capped at 24",
    "numerology": "digit-sum modulo 9; circular distance on residues 0..8",
    "lucky_digits": "fraction of digits equal to 8 or 9",
    "balance": "mean of odd-even, low-high (0-4/5-9), and distinct-digit balance",
    "tie_break": "descending unrounded score, then ascending digit string",
}
_CATEGORIES = astra._CATEGORIES
_CATEGORY_BY_KEY = {entry[0]: entry for entry in _CATEGORIES}
_DATE = re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2}")


def _target_date(value: str) -> date:
    if not isinstance(value, str) or not _DATE.fullmatch(value):
        raise astra.AstraInputError("วันที่เป้าหมายต้องอยู่ในรูป YYYY-MM-DD")
    try:
        parsed = date.fromisoformat(value)
    except ValueError:
        raise astra.AstraInputError("วันที่เป้าหมายไม่ถูกต้อง") from None
    if parsed.isoformat() != value:
        raise astra.AstraInputError("วันที่เป้าหมายต้องเป็นวันที่มาตรฐาน")
    return parsed


def _base_score(model: dict, number: str) -> float:
    """Score one fixed-width string with the frozen astra-v1 log model."""
    q, conditional = model["q"], model["t"]
    first = ord(number[0]) - 48
    score = log(q[0][first])
    for position in range(1, len(number)):
        previous = ord(number[position - 1]) - 48
        digit = ord(number[position]) - 48
        increment = 0.5 * log(q[position][digit]) + 0.5 * log(conditional[position - 1][previous][digit])
        score += increment
    return score


def _signal_tables(draws: list[tuple[int, tuple[str, ...]]], digits: int):
    """Build hot frequencies and capped same-position gaps from newest draws."""
    recent = sorted(draws, key=lambda item: item[0])[:SETTINGS["signal_window_valid_draws"]]
    if not recent:
        return ([[0.0] * 10 for _ in range(digits)],
                [[1.0] * 10 for _ in range(digits)])

    counts = [[0.0] * 10 for _ in range(digits)]
    for _, values in recent:
        per_slot = 1.0 / len(values)
        for number in values:
            for position, char in enumerate(number):
                counts[position][ord(char) - 48] += per_slot
    hot = [[value / len(recent) for value in position] for position in counts]

    gaps = [[SETTINGS["overdue_cap_valid_draws"]] * 10 for _ in range(digits)]
    unseen = [set(range(10)) for _ in range(digits)]
    for age, (_, values) in enumerate(recent):
        for number in values:
            for position, char in enumerate(number):
                digit = ord(char) - 48
                if digit in unseen[position]:
                    gaps[position][digit] = age
                    unseen[position].remove(digit)
    overdue = [
        [min(gap, SETTINGS["overdue_cap_valid_draws"])
         / SETTINGS["overdue_cap_valid_draws"] for gap in position]
        for position in gaps
    ]
    return hot, overdue


def _components(number: str, target: date, hot, overdue) -> dict[str, float]:
    digits = len(number)
    values = [ord(char) - 48 for char in number]
    hot_score = sum(hot[position][digit] for position, digit in enumerate(values)) / digits
    overdue_score = sum(overdue[position][digit] for position, digit in enumerate(values)) / digits

    number_root = sum(values) % 9
    date_root = sum(ord(char) - 48 for char in target.strftime("%Y%m%d")) % 9
    difference = abs(number_root - date_root)
    numerology = 1.0 - min(difference, 9 - difference) / 4.0

    lucky = sum(digit in (8, 9) for digit in values) / digits
    odd = sum(digit % 2 for digit in values)
    even = digits - odd
    low = sum(digit <= 4 for digit in values)
    high = digits - low
    balance = (
        (1.0 - abs(odd - even) / digits)
        + (1.0 - abs(low - high) / digits)
        + (len(set(values)) / digits)
    ) / 3.0
    return {"A": 0.0, "H": hot_score, "D": overdue_score,
            "N": numerology, "L": lucky, "B": balance}


def _composite(components: dict[str, float]) -> float:
    return sum(WEIGHTS[key] * components[key] for key in WEIGHTS)


def rank_category(
    category_key: str,
    draws: list[tuple[int, tuple[str, ...]]],
    target_date: str,
    *,
    count: int | None = None,
) -> tuple[list[dict], str]:
    """Rank a category's full fixed-width domain using only supplied valid draws.

    `draws` must contain `(age, validated_result_strings)` in the same age
    convention as astra-v1: zero is the newest row in the selected 200-draw
    date window. This function has no file or network access.
    """
    definition = _CATEGORY_BY_KEY.get(category_key)
    if definition is None:
        raise astra.AstraInputError("หมวดรางวัลไม่ถูกต้อง")
    _, _, digits, requested = definition
    if count is None:
        count = requested
    if type(count) is not int or count < 1 or count > 10 ** digits:
        raise astra.AstraInputError("จำนวนอันดับที่ขอไม่ถูกต้อง")
    target = _target_date(target_date)
    if len(draws) < SETTINGS["min_valid_draws"]:
        return [], "insufficient_data"

    model = astra._build_model(draws, digits)
    hot, overdue = _signal_tables(draws, digits)
    domain_size = 10 ** digits
    domain_values = np.arange(domain_size, dtype=np.int64)
    powers = np.asarray([10 ** (digits - position - 1) for position in range(digits)], dtype=np.int64)
    digit_columns = ((domain_values[:, None] // powers[None, :]) % 10).astype(np.int8)

    # Vectorize over the complete domain while keeping scalar math.log tables
    # and the same left-to-right binary64 additions as astra-v1.
    first_logs = np.asarray([log(value) for value in model["q"][0]], dtype=np.float64)
    base_scores = first_logs[digit_columns[:, 0]]
    for position in range(1, digits):
        increments = np.asarray([
            [0.5 * log(model["q"][position][digit])
             + 0.5 * log(model["t"][position - 1][previous][digit])
             for digit in range(10)] for previous in range(10)
        ], dtype=np.float64)
        base_scores = base_scores + increments[
            digit_columns[:, position - 1], digit_columns[:, position]
        ]

    unique_scores, score_counts = np.unique(base_scores, return_counts=True)
    cumulative_counts = np.cumsum(score_counts, dtype=np.int64)
    score_positions = np.searchsorted(unique_scores, base_scores, side="right") - 1
    components_by_name = {
        "A": cumulative_counts[score_positions].astype(np.float64) / domain_size,
    }

    hot_total = np.zeros(domain_size, dtype=np.float64)
    overdue_total = np.zeros(domain_size, dtype=np.float64)
    for position in range(digits):
        hot_total += np.asarray(hot[position], dtype=np.float64)[digit_columns[:, position]]
        overdue_total += np.asarray(overdue[position], dtype=np.float64)[digit_columns[:, position]]
    components_by_name["H"] = hot_total / digits
    components_by_name["D"] = overdue_total / digits

    number_roots = digit_columns.sum(axis=1, dtype=np.int16) % 9
    date_root = sum(ord(char) - 48 for char in target.strftime("%Y%m%d")) % 9
    root_difference = np.abs(number_roots - date_root)
    components_by_name["N"] = 1.0 - np.minimum(root_difference, 9 - root_difference) / 4.0
    components_by_name["L"] = np.count_nonzero(
        (digit_columns == 8) | (digit_columns == 9), axis=1
    ) / digits

    odd = np.count_nonzero(digit_columns % 2 == 1, axis=1)
    even = digits - odd
    low = np.count_nonzero(digit_columns <= 4, axis=1)
    high = digits - low
    unique_digits = np.zeros(domain_size, dtype=np.int16)
    for position in range(digits):
        is_new = np.ones(domain_size, dtype=bool)
        for earlier in range(position):
            is_new &= digit_columns[:, position] != digit_columns[:, earlier]
        unique_digits += is_new
    components_by_name["B"] = (
        (1.0 - np.abs(odd - even) / digits)
        + (1.0 - np.abs(low - high) / digits)
        + unique_digits / digits
    ) / 3.0

    if any(np.any(~np.isfinite(values)) or np.any(values < 0.0) or np.any(values > 1.0)
           for values in components_by_name.values()):
        raise astra.AstraInputError("องค์ประกอบคะแนน Astra-Σ อยู่นอกช่วงที่กำหนด")
    composite = np.zeros(domain_size, dtype=np.float64)
    for component, weight in WEIGHTS.items():
        composite += weight * components_by_name[component]

    # Include every score tied at the kth threshold, then sort by the exact raw
    # binary64 score and fixed-width lexical number order (numeric order here).
    threshold_index = domain_size - count
    threshold = np.partition(composite, threshold_index)[threshold_index]
    candidates = np.flatnonzero(composite >= threshold)
    order = np.lexsort((candidates, -composite[candidates]))[:count]
    ranked = []
    for rank, selected in enumerate(candidates[order], 1):
        value = int(selected)
        number = f"{value:0{digits}d}"
        component_values = {
            name: float(values[value]) for name, values in components_by_name.items()
        }
        ranked.append({
            "number": number,
            "rank": rank,
            "score": float(composite[value]),
            "base_score": float(base_scores[value]),
            "components": component_values,
        })
    return ranked, "ok"


def build_astra_sigma_report(
    history, target_date: str, *, generated_at: datetime | None = None
) -> dict:
    """Build a future-target report from caller-supplied history, without I/O."""
    generated = astra._generation_time(generated_at)
    target = astra.validate_astra_target_date(target_date, generated_at=generated)
    window = astra._history_window(history, target, generated.date())
    cutoff = window[0][0] if window else None
    warnings = []
    if cutoff is None:
        warnings.append("ไม่มีข้อมูลก่อนวันที่เป้าหมาย")
    elif (generated.date() - cutoff).days > 35:
        warnings.append("ข้อมูลล่าสุดเก่ากว่า 35 วัน โปรดตรวจสอบวันที่ข้อมูล")

    categories = {}
    for key, label, digits, requested in _CATEGORIES:
        valid = []
        last_valid = None
        for age, (draw_date, row) in enumerate(window):
            values = astra._category_values(row, key, digits)
            if values is not None:
                valid.append((age, values))
                if last_valid is None:
                    last_valid = draw_date.isoformat()
        ranked, status = rank_category(key, valid, target.isoformat(), count=requested)
        categories[key] = {
            "label": label,
            "digits": digits,
            "requested_count": requested,
            "status": status,
            "valid_draws": len(valid),
            "invalid_draws": len(window) - len(valid),
            "training_cutoff_date": last_valid,
            "numbers": ranked,
        }

    return {
        "schema_version": 1,
        "formula": "astra",
        "version": VERSION,
        "trust": "ทดลอง",
        "target_date": target.isoformat(),
        "generated_at": generated.isoformat(),
        "training_cutoff_date": cutoff.isoformat() if cutoff else None,
        "source": "supplied_history",
        "window_draws": len(window),
        "settings": {**SETTINGS, "weights": dict(WEIGHTS)},
        "warnings": warnings,
        "categories": categories,
    }
