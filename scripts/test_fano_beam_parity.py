"""Verify the Fano greedy beam still matches its reference implementation.

Restored after ADR-0008: the beam is v4's seed now, so it needs the parity
coverage it had when it belonged to v2. The coordinate-optimizer half lives in
scripts/test_fano_optimizer_parity.py.

Run with: python scripts/test_fano_beam_parity.py
"""
import hashlib
from pathlib import Path
import random
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import fano


def reference_best_uncovered_candidate(pair_counts, covered, selected, seed, round_index):
    """Original beam logic retained as a small differential oracle."""
    beam = [(0.0, ())]
    for position in range(6):
        expanded = []
        for score, prefix in beam:
            for digit in range(10):
                gain = 0.0
                for left, previous_digit in enumerate(prefix):
                    pair_index = fano.PAIR_INDEX[(left, position)]
                    pattern_index = previous_digit * 10 + digit
                    if pattern_index not in covered[pair_index]:
                        gain += pair_counts[pair_index][pattern_index] + fano.PAIR_ALPHA
                candidate_prefix = prefix + (digit,)
                mismatches = [
                    sum(a != b for a, b in zip(candidate_prefix, candidate[:len(candidate_prefix)]))
                    for candidate in selected
                ]
                remaining = 5 - position
                if any(value + remaining < fano.MIN_HAMMING_DISTANCE for value in mismatches):
                    continue
                expanded.append((score + gain, candidate_prefix))
        if not expanded:
            return None, 0.0
        expanded.sort(key=lambda item: (-item[0], fano._tie_key(seed, round_index, item[1])))
        beam = expanded[:fano.BEAM_WIDTH]

    for score, digits in beam:
        if all(
            sum(a != b for a, b in zip(digits, prior)) >= fano.MIN_HAMMING_DISTANCE
            for prior in selected
        ):
            return ''.join(str(digit) for digit in digits), score
    return None, 0.0


def diverse_selected(rng, count):
    rows = []
    while len(rows) < count:
        candidate = tuple(rng.randrange(10) for _ in range(6))
        if all(
            sum(a != b for a, b in zip(candidate, existing)) >= fano.MIN_HAMMING_DISTANCE
            for existing in rows
        ):
            rows.append(candidate)
    return rows


def build_case(rng, index):
    pair_counts = [
        [rng.randrange(4) if index % 3 else 0 for _ in range(100)]
        for _ in fano.POSITION_PAIRS
    ]
    if index % 2:
        covered = [set(rng.sample(range(100), rng.randrange(101))) for _ in fano.POSITION_PAIRS]
    else:
        covered = [set() for _ in fano.POSITION_PAIRS]
    selected = diverse_selected(rng, index % 6)
    seed = hashlib.sha256(f'fano-beam-parity:{index}'.encode()).digest()
    return pair_counts, covered, selected, seed, index % 5


def main():
    rng = random.Random(20261016)
    cases = [
        (
            [[0] * 100 for _ in fano.POSITION_PAIRS],
            [set(range(100)) for _ in fano.POSITION_PAIRS],
            [], hashlib.sha256(b'all-ties').digest(), 0,
        ),
        *[build_case(rng, index) for index in range(1, 9)],
    ]
    for index, (pair_counts, covered, selected, seed, round_index) in enumerate(cases, start=1):
        expected = reference_best_uncovered_candidate(
            pair_counts, covered, selected, seed, round_index
        )
        actual = fano._best_uncovered_candidate(
            pair_counts, covered, selected, seed, round_index
        )
        if actual != expected:
            raise AssertionError(f'beam output changed in deterministic parity case {index}')
    print(f'PASS: {len(cases)} exact Fano beam parity cases')


if __name__ == '__main__':
    main()
