"""Tests for the offline hypothesis search harness (no network, no app server).

Run: python scripts/test_rll_hypothesis_search.py
"""
from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / 'scripts'))

from rll_hypothesis_search import (  # noqa: E402
    Corpus, candidates, evaluate, load_rows, permutation_test, search, split_bounds, WARMUP,
)
from generate_rll_hypotheses import salvage_objects, validate  # noqa: E402

FLAT = {'name': 'flat', 'k': 10,
        'positions': [[{'op': 'freq', 'source': 'pool', 'window': 30, 'weight': 0.0}]] * 3}


class CorpusTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.rows = load_rows()
        cls.corpus = Corpus(cls.rows)

    def test_target_field_only_exists_in_the_pool_era(self):
        sizes = [len(t) for t in self.corpus.tails]
        self.assertGreaterEqual(min(len(self.corpus.tails[i]) for i in self.corpus.usable), 55)
        self.assertLess(max(sizes), 70)
        self.assertGreater(len(self.corpus.usable), 400)

    def test_features_never_change_when_the_target_row_is_in_the_corpus(self):
        index = self.corpus.usable[200]
        with_target = Corpus(self.rows[:index + 1]).features(index)
        self.assertEqual(with_target, self.corpus.features(index))

    def test_candidates_are_ten_distinct_three_digit_strings(self):
        picks = candidates(FLAT, self.corpus.features(self.corpus.usable[100]))
        self.assertEqual(len(set(picks)), 10)
        self.assertTrue(all(len(p) == 3 and p.isdigit() for p in picks))

    def test_flat_hypothesis_scores_at_chance(self):
        sample = self.corpus.usable[WARMUP:WARMUP + 160]
        stats = evaluate(FLAT, self.corpus, sample)
        self.assertEqual(stats['n'], 160)
        self.assertLess(abs(stats['rate'] - stats['baseline']), 0.08)


class SplitTest(unittest.TestCase):
    def test_splits_are_disjoint_and_ordered(self):
        (a, b), (c, d), (e, f) = split_bounds(404)
        self.assertLessEqual(a, b)
        self.assertLessEqual(b, c)
        self.assertLessEqual(d, e)
        self.assertEqual(f, 404)

    def test_search_reports_windows_in_date_order(self):
        rows = load_rows()
        result = search([FLAT], Corpus(rows))
        train, validation, holdout = (result['windows'][k] for k in ('train', 'validation', 'holdout'))
        self.assertLess(train[0], train[1])
        self.assertLess(train[1], validation[0])
        self.assertLess(validation[1], holdout[0])
        self.assertIn('z_distribution', result)
        self.assertEqual(result['confirmed'], [])


class PermutationTest(unittest.TestCase):
    def test_permutation_restores_the_original_tails(self):
        corpus = Corpus(load_rows())
        before = list(corpus.tails)
        usable = corpus.usable[WARMUP:]
        (a, b), _, _ = split_bounds(len(usable))
        control = permutation_test([FLAT], corpus, usable[a:b], shuffles=3)
        self.assertEqual(corpus.tails, before)
        self.assertEqual(control['shuffles'], 3)
        self.assertEqual(len(control['maxes']), 3)


class GeneratorTest(unittest.TestCase):
    def test_salvage_recovers_complete_objects_from_a_truncated_array(self):
        truncated = ('{"hypotheses":[{"name":"a","k":10,"positions":[[{"op":"freq","source":"pool",'
                     '"window":30,"weight":1}],[],[]]},{"name":"b","k":10,"positions":[[{"op":"gap"')
        items = salvage_objects(truncated)
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]['name'], 'a')

    def test_validate_drops_unknown_operators_and_zero_weights(self):
        good, dropped = validate([
            {'name': 'ok', 'positions': [[{'op': 'freq', 'source': 'pool', 'window': 60, 'weight': 1}],
                                         [{'op': 'nope', 'source': 'pool', 'window': 60, 'weight': 1}],
                                         [{'op': 'gap', 'source': 'prize1', 'window': 30, 'weight': -1}]]},
            {'name': 'zero', 'positions': [[{'op': 'freq', 'source': 'pool', 'window': 60, 'weight': 0}]] * 3},
        ])
        self.assertEqual(len(good), 1)
        self.assertEqual(good[0]['name'], 'ok')
        self.assertEqual(good[0]['positions'][1], [])
        self.assertEqual(dropped[0]['reason'], 'all weights zero')

    def test_generated_set_is_loadable_and_unique(self):
        path = ROOT / '.scratch' / 'rll-llm-formula' / 'hypotheses.json'
        if not path.exists():
            self.skipTest('no generated hypothesis set')
        payload = json.loads(path.read_text(encoding='utf-8'))
        hypotheses = payload['hypotheses']
        self.assertGreater(len(hypotheses), 50)
        keys = {json.dumps(h['positions'], sort_keys=True) for h in hypotheses}
        self.assertEqual(len(keys), len(hypotheses))


if __name__ == '__main__':
    unittest.main(verbosity=2)
