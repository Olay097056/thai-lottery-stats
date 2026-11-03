"""Verify Thai-local draw-date defaults independent of the host machine timezone."""
import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import analyzer
import main
from thai_time import THAILAND_TZ, to_thailand_naive


class ThaiTimeContractTests(unittest.TestCase):
    def test_utc_instants_convert_to_thailand_wall_time(self):
        self.assertEqual(THAILAND_TZ.utcoffset(None).total_seconds(), 7 * 60 * 60)
        utc_midnight_crossing = datetime(2026, 10, 16, 17, 0, tzinfo=timezone.utc)
        self.assertEqual(to_thailand_naive(utc_midnight_crossing), datetime(2026, 10, 17, 0, 0))

    def test_conversion_rejects_naive_instants(self):
        with self.assertRaises(ValueError):
            to_thailand_naive(datetime(2026, 10, 16, 12, 0))

    def test_draw_cutoff_uses_thailand_time(self):
        before_cutoff = to_thailand_naive(datetime(2026, 10, 16, 8, 59, tzinfo=timezone.utc))
        at_cutoff = to_thailand_naive(datetime(2026, 10, 16, 9, 0, tzinfo=timezone.utc))
        self.assertEqual(before_cutoff, datetime(2026, 10, 16, 15, 59))
        self.assertEqual(analyzer.next_thai_draw(before_cutoff)[0]["date"].strftime("%Y-%m-%d"), "2026-10-16")
        self.assertEqual(analyzer.next_thai_draw(at_cutoff)[0]["date"].strftime("%Y-%m-%d"), "2026-11-01")

    def test_backend_defaults_and_next_draw_endpoint_use_thai_wall_clock(self):
        before_cutoff = datetime(2026, 10, 16, 15, 59)
        with patch.object(main, "thailand_now_naive", return_value=before_cutoff):
            self.assertEqual(main._target_date(None), before_cutoff)
            self.assertEqual(main.api_next_draws()["draws"][0]["date"], "2026-10-16")

        at_cutoff = datetime(2026, 10, 16, 16, 0)
        with patch.object(main, "thailand_now_naive", return_value=at_cutoff):
            self.assertEqual(main.api_next_draws()["draws"][0]["date"], "2026-11-01")

    def test_next_thai_draw_default_uses_shared_thai_clock(self):
        expected = datetime(2026, 10, 16, 15, 59)
        with patch.object(analyzer, "thailand_now_naive", return_value=expected):
            self.assertEqual(analyzer.next_thai_draw()[0]["date"].strftime("%Y-%m-%d"), "2026-10-16")


if __name__ == "__main__":
    unittest.main()
