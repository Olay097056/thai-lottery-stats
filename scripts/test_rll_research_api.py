"""Tests for /api/rll/research — the frozen hypothesis-search summary (ADR-0010).

The endpoint must serve a committed file, never compute on request, and degrade to
{available: false} instead of raising when the file is missing.

Run: python scripts/test_rll_research_api.py
"""
from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import main  # noqa: E402

SUMMARY = ROOT / 'data' / 'rll_research_summary.json'


class ResearchEndpointTest(unittest.TestCase):
    def test_serves_the_committed_summary(self):
        payload = main.api_rll_research()
        self.assertTrue(payload['ok'])
        self.assertTrue(payload['available'])
        self.assertEqual(payload['protocol'], 'hs-v3')
        self.assertEqual(payload['hypotheses'], 587)
        self.assertEqual(payload['usable_draws'], 464)
        self.assertEqual(payload['p_value'], 0.567)

    def test_numbers_are_internally_consistent(self):
        payload = main.api_rll_research()
        self.assertFalse(payload['alert'], 'nothing cleared the gate, so no alert may be set')
        self.assertLess(payload['best']['z'], payload['gate'], 'the winner must sit below the gate')
        self.assertGreaterEqual(payload['p_value'], 0.0)
        self.assertLessEqual(payload['p_value'], 1.0)
        self.assertEqual(payload['passed_screen'], 0)
        self.assertLess(payload['train']['draws'] + payload['validation']['draws']
                        + payload['holdout']['draws'], payload['usable_draws'] + 1)

    def test_matches_the_file_on_disk(self):
        on_disk = json.loads(SUMMARY.read_text(encoding='utf-8'))
        payload = main.api_rll_research()
        for key in ('protocol', 'hypotheses', 'usable_draws', 'gate', 'p_value', 'alert'):
            self.assertEqual(payload[key], on_disk[key], key)

    def test_missing_file_degrades_to_unavailable(self):
        original = SUMMARY.read_bytes()
        try:
            SUMMARY.unlink()
            self.assertEqual(main.api_rll_research(), {'ok': True, 'available': False})
        finally:
            SUMMARY.write_bytes(original)
        self.assertTrue(main.api_rll_research()['available'])


if __name__ == '__main__':
    unittest.main(verbosity=2)
