"""Tests for the hypothesis watcher (no network; one small end-to-end run).

Run: python scripts/test_rll_hypothesis_watch.py
"""
from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / 'scripts'))

from rll_hypothesis_search import load_rows  # noqa: E402
from rll_hypothesis_watch import (  # noqa: E402
    data_as_of, last_record_for, load_log, run_sweep, summarise,
)

SAMPLE = [
    {'name': 'flat', 'k': 10, 'positions': [[{'op': 'freq', 'source': 'pool', 'window': 30, 'weight': 0.0}]] * 3},
    {'name': 'hot60', 'k': 10, 'positions': [[{'op': 'freq', 'source': 'pool', 'window': 60, 'weight': 1.0}],
                                             [{'op': 'freq', 'source': 'prize1', 'window': 30, 'weight': -1.0}],
                                             []]},
]


class RecordTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.rows = load_rows()

    def test_run_sweep_reports_the_best_and_a_gate(self):
        record = run_sweep(self.rows, SAMPLE)
        self.assertEqual(record['hypotheses'], 2)
        self.assertEqual(record['data_as_of'], data_as_of(self.rows))
        self.assertIn('z', record['best'])
        self.assertFalse(record['alert'], 'two chance-level hypotheses cannot clear the gate')
        self.assertEqual(record['gate'], 4.0)

    def test_permutation_run_moves_the_gate_to_its_own_95th_percentile(self):
        record = run_sweep(self.rows, SAMPLE, shuffles=5)
        control = record['permutation']
        self.assertEqual(record['gate'], control['max_z']['p95'])
        self.assertIn('p_value', control)
        self.assertGreaterEqual(control['p_value'], 0.0)

    def test_last_record_for_ignores_other_protocols(self):
        records = [{'protocol': 'hs-v3', 'data_as_of': '2026-01-01'},
                   {'protocol': 'hs-v2', 'data_as_of': '2026-06-01'},
                   {'protocol': 'hs-v3', 'data_as_of': '2026-11-01'}]
        self.assertEqual(last_record_for(records, 'hs-v3')['data_as_of'], '2026-11-01')
        self.assertIsNone(last_record_for(records, 'hs-v9'))

    def test_summarise_flags_an_alert(self):
        record = {'data_as_of': '2026-11-01', 'usable_draws': 464, 'hypotheses': 2, 'passed_screen': 1,
                  'best': {'z': 5.1, 'name': 'lucky'}, 'gate': 4.0, 'alert': True}
        self.assertIn('ALERT', summarise(record))
        record['alert'] = False
        self.assertIn('no signal', summarise(record))

    def test_write_summary_updates_numbers_and_keeps_static_context(self):
        import tempfile
        from rll_hypothesis_watch import write_summary
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'summary.json'
            path.write_text(json.dumps({'protocol': 'hs-v3', 'train': {'draws': 206}, 'tokens': 152182}),
                            encoding='utf-8')
            record = {'protocol': 'hs-v3', 'hypotheses': 600, 'usable_draws': 470, 'draws': 767,
                      'data_as_of': '2026-11-16', 'passed_screen': 1, 'alert': True,
                      'best': {'name': 'x', 'z': 4.2, 'rate': 0.6, 'baseline': 0.48},
                      'gate': 3.986, 'ran_at': '2026-11-16T10:00:00',
                      'permutation': {'p_value': 0.004}}
            write_summary(record, path)
            payload = json.loads(path.read_text(encoding='utf-8'))
            self.assertEqual(payload['hypotheses'], 600)
            self.assertEqual(payload['p_value'], 0.004)
            self.assertTrue(payload['alert'])
            self.assertAlmostEqual(payload['gate'], 3.986)
            self.assertEqual(payload['train'], {'draws': 206}, 'static context must survive')
            self.assertEqual(payload['tokens'], 152182)


class CliTest(unittest.TestCase):
    def test_second_run_refuses_when_the_data_has_not_changed(self):
        with tempfile.TemporaryDirectory() as tmp:
            hypotheses = Path(tmp) / 'hyps.json'
            hypotheses.write_text(json.dumps({'hypotheses': SAMPLE}), encoding='utf-8')
            log = Path(tmp) / 'log.jsonl'
            cmd = [sys.executable, str(ROOT / 'scripts' / 'rll_hypothesis_watch.py'),
                   '--hypotheses', str(hypotheses), '--log', str(log),
                   '--summary', str(Path(tmp) / 'summary.json')]
            first = subprocess.run(cmd, capture_output=True, text=True, cwd=str(ROOT))
            self.assertEqual(first.returncode, 0, first.stderr)
            self.assertIn('logged to', first.stdout)
            self.assertEqual(len(load_log(log)), 1)

            second = subprocess.run(cmd, capture_output=True, text=True, cwd=str(ROOT))
            self.assertEqual(second.returncode, 0)
            self.assertIn('no new draw since', second.stdout)
            self.assertEqual(len(load_log(log)), 1, 'a repeat run must not append a record')

            forced = subprocess.run(cmd + ['--force'], capture_output=True, text=True, cwd=str(ROOT))
            self.assertEqual(forced.returncode, 0)
            self.assertEqual(len(load_log(log)), 2)
            self.assertIn('previous', load_log(log)[-1])


if __name__ == '__main__':
    unittest.main(verbosity=2)
