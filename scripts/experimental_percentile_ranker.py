"""Synthetic-only experimental scorer for frozen /api/predict/all components.

This module has no cache, scraper, or outcome-data dependency. It does not
replace the production ranker; it is one fixed candidate for future
prospective validation.
"""
from __future__ import annotations

from collections.abc import Mapping, Sequence
import math

CANDIDATE_ID = "equal-signal-percentile-v1"
COMPONENT_COUNT = 9
SCORE_FORMULA = "mean(per-signal descending midrank percentile) * lag_factor"
TIE_POLICY = "midrank per signal; final score ties broken by number ascending"


def rank_equal_signal_percentiles(
    candidates: Sequence[Mapping[str, object]],
) -> list[dict[str, object]]:
    """Rank a complete 2/3-digit candidate set using equal-weight signal percentiles.

    For each signal, the highest raw component gets percentile 1 and the
    lowest gets 0; tied values share the average rank percentile. The nine
    percentiles are averaged and multiplied by the frozen lag factor. Final
    score ties are deterministic: the digit string sorts ascending.
    """
    if not isinstance(candidates, Sequence) or isinstance(candidates, (str, bytes)):
        raise ValueError("candidates must be a sequence of candidate records")
    candidate_count = len(candidates)
    if candidate_count < 2:
        raise ValueError("at least two candidates are required")

    numbers: list[str] = []
    components: list[list[float]] = []
    lag_factors: list[float] = []
    token_width: int | None = None

    for index, candidate in enumerate(candidates):
        if not isinstance(candidate, Mapping):
            raise ValueError(f"candidate {index} must be a mapping")

        number = candidate.get("number")
        if (
            not isinstance(number, str)
            or len(number) not in (2, 3)
            or not number.isascii()
            or not number.isdigit()
        ):
            raise ValueError(f"candidate {index} number must be a 2/3-digit string")
        if token_width is None:
            token_width = len(number)
        elif len(number) != token_width:
            raise ValueError("candidate number strings must have one consistent width")
        numbers.append(number)

        raw_components = candidate.get("components")
        if (
            not isinstance(raw_components, Sequence)
            or isinstance(raw_components, (str, bytes))
            or len(raw_components) != COMPONENT_COUNT
        ):
            raise ValueError(f"candidate {index} must have exactly {COMPONENT_COUNT} components")
        normalized_components = []
        for value in raw_components:
            if isinstance(value, bool) or not isinstance(value, (int, float)):
                raise ValueError("component scores must be numeric")
            numeric = float(value)
            if not math.isfinite(numeric):
                raise ValueError("component scores must be finite")
            normalized_components.append(numeric)
        components.append(normalized_components)

        raw_lag_factor = candidate.get("lag_factor")
        if isinstance(raw_lag_factor, bool) or not isinstance(raw_lag_factor, (int, float)):
            raise ValueError("lag_factor must be numeric")
        lag_factor = float(raw_lag_factor)
        if not math.isfinite(lag_factor) or not 0.0 < lag_factor <= 1.0:
            raise ValueError("lag_factor must be finite and in (0, 1]")
        lag_factors.append(lag_factor)

    if len(set(numbers)) != candidate_count:
        raise ValueError("candidate number strings must be unique")
    expected_candidate_count = 10**token_width
    if candidate_count != expected_candidate_count:
        raise ValueError(
            f"candidates must cover the complete {token_width}-digit candidate domain"
        )

    percentiles = [[0.0] * COMPONENT_COUNT for _ in range(candidate_count)]
    for component_index in range(COMPONENT_COUNT):
        order = sorted(
            range(candidate_count),
            key=lambda item: (-components[item][component_index], numbers[item]),
        )
        start = 0
        while start < candidate_count:
            value = components[order[start]][component_index]
            end = start + 1
            while end < candidate_count and components[order[end]][component_index] == value:
                end += 1

            average_rank = ((start + 1) + end) / 2.0
            percentile = 1.0 - (average_rank - 1.0) / (candidate_count - 1)
            for position in order[start:end]:
                percentiles[position][component_index] = percentile
            start = end

    scores = [
        (sum(candidate_percentiles) / COMPONENT_COUNT) * lag_factors[index]
        for index, candidate_percentiles in enumerate(percentiles)
    ]
    final_order = sorted(range(candidate_count), key=lambda index: (-scores[index], numbers[index]))
    return [
        {
            "number": numbers[index],
            "rank": rank,
            "score": scores[index],
            "lag_factor": lag_factors[index],
        }
        for rank, index in enumerate(final_order, start=1)
    ]
