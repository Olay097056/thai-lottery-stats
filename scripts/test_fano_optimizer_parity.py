"""Verify the Fano coordinate optimizer and annealer stay deterministic.

v1-v3 (and with them the beam search parity cases) were retired by ADR-0008;
this file keeps the checks that still have code to check.

Run with: python scripts/test_fano_optimizer_parity.py
"""
import hashlib
from pathlib import Path
import random
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import fano


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


def main():
    rng = random.Random(20261016)

    for index in range(1, 6):
        pair_counts = [
            [rng.randrange(60) for _ in range(100)] for _ in fano.POSITION_PAIRS
        ]
        initial = diverse_selected(rng, 5)
        seed = hashlib.sha256(f'fano-coordinate-parity:{index}'.encode()).digest()
        expected = fano._optimize_portfolio(
            initial, pair_counts, 809, seed, index, cache_coordinate_distances=False
        )
        actual = fano._optimize_portfolio(
            initial, pair_counts, 809, seed, index, cache_coordinate_distances=True
        )
        if actual != expected:
            raise AssertionError(f'coordinate optimizer changed in parity case {index}')

    for index in range(1, 4):
        pair_counts = [
            [rng.randrange(60) for _ in range(100)] for _ in fano.POSITION_PAIRS
        ]
        initial = ['{:06d}'.format(sum(row) % 1000000) for row in diverse_selected(rng, 5)]
        if not fano._portfolio_is_diverse([[int(char) for char in number] for number in initial]):
            continue
        seed = hashlib.sha256(f'fano-anneal-parity:{index}'.encode()).digest()
        first = fano._anneal_portfolio(initial, pair_counts, 809, seed, index)
        second = fano._anneal_portfolio(initial, pair_counts, 809, seed, index)
        if first != second:
            raise AssertionError(f'annealer is not deterministic in case {index}')

    print('PASS: 5 coordinate optimizer parity cases, 3 annealer determinism cases')


if __name__ == '__main__':
    main()
