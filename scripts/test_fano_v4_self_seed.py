"""End-to-end regression tests for Fano v4's self-seed (ADR-0008).

The failure this file exists for: deleting v1-v3 removed v4's incumbent, and
nothing in the suite noticed — the NameError only appeared at runtime, inside
build(). These tests call build() the way the formula tab and the backtest do.

Run with: python scripts/test_fano_v4_self_seed.py
"""
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import astra
import fano


def synthetic_draws(count=40):
    return [(age, (f'{(age * 7919) % 1000000:06d}',)) for age in range(count)]


class SelfSeedTests(unittest.TestCase):
    def test_retired_builders_and_versions_are_gone(self):
        for name in ('build_v1', 'build_v2', 'build_v3',
                     'VERSION_V1', 'VERSION_V2', 'VERSION_V3',
                     'NAME_V1', 'NAME_V2', 'NAME_V3'):
            self.assertFalse(hasattr(fano, name), f'{name} should be retired by ADR-0008')
        for version in ('fano-v1-hypothesis', 'fano-v2-weighted-pair-cover',
                        'fano-v3-joint-weighted-cover'):
            with self.assertRaises(ValueError):
                fano._builder_for_version(version)

    def test_build_runs_end_to_end(self):
        numbers, settings = fano.build(synthetic_draws(), '2026-11-16', 'a' * 64)
        self.assertEqual(len(numbers), 5)
        self.assertEqual(len(set(numbers)), 5)
        for number in numbers:
            self.assertRegex(number, r'^[0-9]{6}$')
        self.assertEqual(settings['optimizer_base_version'], 'self-seeded')
        self.assertGreater(settings['optimizer_seed_score'], 0)
        self.assertGreater(settings['optimizer_base_score'], settings['optimizer_seed_score'] - 1e-9)
        self.assertGreaterEqual(settings['weighted_pair_coverage_score'],
                                settings['optimizer_base_score'])
        self.assertGreaterEqual(settings['minimum_pairwise_hamming_distance'],
                                fano.MIN_HAMMING_DISTANCE)

    def test_build_is_deterministic(self):
        first = fano.build(synthetic_draws(), '2026-11-16', 'b' * 64)
        second = fano.build(synthetic_draws(), '2026-11-16', 'b' * 64)
        self.assertEqual(first, second)

    def test_seed_follows_the_history_fingerprint(self):
        one = fano.build(synthetic_draws(), '2026-11-16', 'c' * 64)[0]
        two = fano.build(synthetic_draws(), '2026-11-16', 'd' * 64)[0]
        self.assertNotEqual(one, two)

    def test_minimum_draw_guard_survives(self):
        with self.assertRaises(ValueError):
            fano.build(synthetic_draws(19), '2026-11-16', 'e' * 64)

    def test_real_cache_forecast_path(self):
        """The path the formula tab uses: cache -> history window -> build()."""
        if not (ROOT / 'lottery_cache.csv').exists():
            self.skipTest('lottery_cache.csv not present in this checkout')
        history = astra.load_existing_astra_history()
        dates = [row['date'] for row in history
                 if astra._category_values(row, 'prize1', 6) is not None]
        self.assertGreater(len(dates), fano.MIN_VALID_DRAWS)
        forecast = fano.formula_forecast(dates[-1])
        self.assertTrue(forecast['ok'])
        self.assertEqual(len(forecast['numbers']), 5)
        self.assertEqual(forecast['settings']['optimizer_base_version'], 'self-seeded')


if __name__ == '__main__':
    unittest.main()
