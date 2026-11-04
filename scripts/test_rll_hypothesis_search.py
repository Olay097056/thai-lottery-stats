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
    Corpus, candidates, evaluate, load_rows, permutation_test, search, signature, split_bounds,
    score_grid, WARMUP,
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
        self.assertEqual(signature(with_target), signature(self.corpus.features(index)))

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


class JointTermTest(unittest.TestCase):
    """v2 terms must actually couple positions — otherwise the wider family is a fiction."""

    @classmethod
    def setUpClass(cls):
        cls.corpus = Corpus(load_rows())
        cls.index = cls.corpus.usable[220]
        cls.feats = cls.corpus.features(cls.index)

    def test_joint_term_changes_the_candidate_set(self):
        plain = candidates(FLAT, self.feats)
        joint = {'name': 'j', 'k': 10, 'positions': [[], [], []],
                 'joints': [{'op': 'pair12', 'source': 'pool', 'window': 60, 'weight': 40.0}]}
        self.assertNotEqual(plain, candidates(joint, self.feats))

    def test_joint_term_is_position_coupled_not_additive(self):
        grid = score_grid({'name': 'j', 'k': 10, 'positions': [[], [], []],
                           'joints': [{'op': 'pair01', 'source': 'pool', 'window': 60, 'weight': 1.0}]},
                          self.feats)
        # a pure pair01 term cannot be written as f(a) + g(b): the 2x2 minors of the slice must be non-zero
        slice_ = grid[:, :, 0]
        minor = (slice_[0, 0] + slice_[1, 1]) - (slice_[1, 0] + slice_[0, 1])
        self.assertAlmostEqual(abs(minor) > 1e-9, True)

    def test_exclude_term_removes_the_last_draw(self):
        hyp = {'name': 'x', 'k': 10, 'positions': [[], [], []],
               'exclude': [{'draws': 1, 'weight': -99.0}]}
        picks = set(candidates(hyp, self.feats))
        self.assertFalse(picks & self.corpus.tails[self.index - 1])

    def test_sum_term_groups_candidates_by_digit_sum(self):
        hyp = {'name': 's', 'k': 10, 'positions': [[], [], []],
               'sums': [{'source': 'pool', 'window': 60, 'weight': 5.0}]}
        sums = [sum(int(ch) for ch in p) for p in candidates(hyp, self.feats)]
        self.assertLessEqual(max(sums) - min(sums), 4)

    def test_exclusion_masks_use_only_prior_draws(self):
        masks = [k for k in self.feats if k[0] == 'exclmask']
        self.assertEqual(sorted(m[2] for m in masks), [1, 2, 3, 5])
        recent = set()
        for j in range(self.index - 1, self.index):
            recent |= self.corpus.tails[j]
        mask = self.feats[('exclmask', 'pool', 1)]
        for tail in recent:
            self.assertEqual(mask[int(tail[0]), int(tail[1]), int(tail[2])], 1.0)
        self.assertEqual(mask.sum() > 0, True)


class V3TermTest(unittest.TestCase):
    """hs-v3 terms: coarse pair shapes, within-tail structure, lagged markov."""

    @classmethod
    def setUpClass(cls):
        cls.corpus = Corpus(load_rows())
        cls.index = cls.corpus.usable[240]
        cls.feats = cls.corpus.features(cls.index)
        cls.base = candidates(FLAT, cls.feats)

    def _picks(self, extra):
        return candidates({'name': 'probe', 'k': 10, 'positions': [[], [], []], **extra}, self.feats)

    def test_shape_terms_are_wired(self):
        for op in ('pairsum01', 'pairsum12', 'diff01', 'diff12', 'summod'):
            picks = self._picks({'shapes': [{'op': op, 'source': 'pool', 'window': 60, 'weight': 20.0}]})
            self.assertNotEqual(picks, self.base, op)

    def test_pairsum_and_diff_tables_have_the_right_support(self):
        self.assertEqual(len(self.feats[('pairsum01', 'pool', 60)]), 19)
        self.assertEqual(len(self.feats[('diff01', 'pool', 60)]), 10)
        self.assertEqual(len(self.feats[('summod', 'prize1', 120)]), 10)
        self.assertAlmostEqual(float(self.feats[('diff02', 'pool', 30)].sum()), 1.0, places=6)

    def test_struct_terms_are_wired_and_not_constant(self):
        for name in ('repeat', 'ascending', 'even'):
            grid = score_grid({'name': 's', 'k': 10, 'positions': [[], [], []],
                               'structs': [{'name': name, 'weight': 1.0}]}, self.feats)
            self.assertGreater(float(grid.max() - grid.min()), 0.0, name)
            self.assertNotEqual(self._picks({'structs': [{'name': name, 'weight': 2.0}]}), self.base, name)

    def test_lagged_markov_differs_from_lag_one(self):
        self.assertIn(('markov2', 'prize1', 60, 0), self.feats)
        self.assertIn(('markov3', 'prize1', 60, 2), self.feats)
        lag1 = self.feats[('markov', 'prize1', 60, 0)]
        lag3 = self.feats[('markov3', 'prize1', 60, 0)]
        self.assertGreater(float(abs(lag1 - lag3).max()), 0.0)

    def test_exclusion_mask_extends_to_five_draws(self):
        masks = sorted(k[2] for k in self.feats if k[0] == 'exclmask')
        self.assertEqual(masks, [1, 2, 3, 5])
        wide = self.feats[('exclmask', 'pool', 5)]
        narrow = self.feats[('exclmask', 'pool', 1)]
        self.assertGreaterEqual(float(wide.sum()), float(narrow.sum()))


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

    def test_validate_keeps_the_v3_operators(self):
        good, _ = validate([
            {'name': 'lag', 'positions': [[{'op': 'markov3', 'source': 'prize1', 'window': 60, 'weight': 1}],
                                          [], []],
             'shapes': [{'op': 'summod', 'source': 'pool', 'window': 30, 'weight': -1}],
             'structs': [{'name': 'even', 'weight': 0.5}]},
        ])
        self.assertEqual(good[0]['positions'][0][0]['op'], 'markov3')
        self.assertEqual(good[0]['shapes'][0]['op'], 'summod')
        self.assertEqual(good[0]['structs'][0]['name'], 'even')

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
