"""Synthetic contract for tunable 2/3-digit weights isolated from Prize 1."""
from datetime import datetime
from pathlib import Path
import sys
from unittest.mock import patch
import unittest

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import analyzer
import main


FROZEN_DEFAULT_WEIGHTS = {
    "same_day": 0.18,
    "recency_overall": 0.20,
    "year_over_year": 0.16,
    "day_month": 0.09,
    "month": 0.09,
    "weekday": 0.08,
    "digit_position": 0.10,
    "geometric_overdue": 0.06,
    "momentum": 0.04,
}
ALT_WEIGHTS = {
    "same_day": 0.40,
    "recency_overall": 0.10,
    "year_over_year": 0.10,
    "day_month": 0.10,
    "month": 0.05,
    "weekday": 0.05,
    "digit_position": 0.10,
    "geometric_overdue": 0.05,
    "momentum": 0.05,
}


def synthetic_draws(count=24):
    dates = pd.date_range("2023-01-01", periods=count, freq="15D")
    rows = []
    for i, date in enumerate(dates):
        prize1 = f"{(i * 42419 + 12345) % 1_000_000:06d}"
        rows.append({
            "date": date,
            "year": date.year,
            "month": date.month,
            "day": date.day,
            "weekday": analyzer.DAY_MAP[date.weekday()],
            "prize1": prize1,
            "top3": prize1[-3:],
            "top2": f"{(i * 17 + 5) % 100:02d}",
            "bottom2": f"{(i * 13 + 9) % 100:02d}",
            "front3_1": f"{(i * 37 + 11) % 1000:03d}",
            "front3_2": f"{(i * 31 + 1) % 1000:03d}",
            "back3_1": f"{(i * 23 + 7) % 1000:03d}",
            "back3_2": f"{(i * 19 + 3) % 1000:03d}",
        })
    return pd.DataFrame(rows)


class PredictWeightIsolationTests(unittest.TestCase):
    def test_default_ranker_output_matches_explicit_frozen_weights(self):
        df = synthetic_draws()
        target = datetime(2026, 10, 16)

        default = analyzer.predict_numbers(df, "bottom2", target, top_n=None)
        explicit = analyzer.predict_numbers(
            df, "bottom2", target, top_n=None, weights=FROZEN_DEFAULT_WEIGHTS
        )

        pd.testing.assert_frame_equal(default, explicit)

    def test_external_weight_vector_changes_shared_ranker_scores(self):
        df = synthetic_draws()
        target = datetime(2026, 10, 16)
        default = analyzer.predict_numbers(
            df, "bottom2", target, top_n=None, weights=FROZEN_DEFAULT_WEIGHTS
        )
        changed = analyzer.predict_numbers(
            df, "bottom2", target, top_n=None, weights=ALT_WEIGHTS
        )

        self.assertNotEqual(default["คะแนนรวม"].tolist(), changed["คะแนนรวม"].tolist())

    def test_ranker_rejects_weights_that_do_not_sum_to_one(self):
        df = synthetic_draws()
        invalid = dict(ALT_WEIGHTS)
        invalid["same_day"] -= 0.01

        with self.assertRaisesRegex(ValueError, "sum to 1"):
            analyzer.predict_numbers(
                df, "bottom2", datetime(2026, 10, 16), top_n=10, weights=invalid
            )

    def test_prize1_frozen_ranker_weights_are_immutable(self):
        with self.assertRaises(TypeError):
            analyzer.PRIZE1_BACK3_RANKER_WEIGHTS["same_day"] = 0.50

    def test_reasons_predictor_forwards_external_weight_vector(self):
        df = synthetic_draws()
        target = datetime(2026, 10, 16)
        empty = pd.DataFrame()
        with patch.object(analyzer, "predict_numbers", return_value=empty) as ranker:
            analyzer.predict_with_reasons(
                df, "bottom2", target, top_n=10, weights=ALT_WEIGHTS
            )

        ranker.assert_called_once_with(
            df, "bottom2", target, top_n=10, weights=ALT_WEIGHTS
        )

    def test_predict_all_passes_one_shared_weight_vector_to_only_external_fields(self):
        df = synthetic_draws()
        calls = []

        def fake_reasons(data, col, target, top_n=10, weights=None):
            calls.append((col, weights))
            return pd.DataFrame()

        with patch.object(main, "get_df", return_value=df), \
             patch.object(main, "predict_prize1_ultimate", return_value=pd.DataFrame()), \
             patch.object(main, "predict_with_reasons", side_effect=fake_reasons), \
             patch.object(main, "PREDICT_ALL_SHARED_WEIGHTS", ALT_WEIGHTS, create=True):
            payload = main.api_predict_all(
                top_n=10, beam_width=100, k_back=10, preset="optimized", date="2026-10-16"
            )

        self.assertEqual(
            [col for col, _ in calls],
            ["front3_1", "front3_2", "back3_1", "back3_2", "bottom2"],
        )
        self.assertTrue(all(weights == ALT_WEIGHTS for _, weights in calls))
        self.assertIn("prize1", payload["categories"])

    def test_predict_all_prize1_output_is_unchanged_when_external_weights_change(self):
        df = synthetic_draws()
        kwargs = {"top_n": 5, "beam_width": 20, "k_back": 5, "preset": "optimized", "date": "2026-10-16"}
        with patch.object(main, "get_df", return_value=df), \
             patch.object(main, "PREDICT_ALL_SHARED_WEIGHTS", FROZEN_DEFAULT_WEIGHTS, create=True):
            baseline = main.api_predict_all(**kwargs)["categories"]["prize1"]["numbers"]
        with patch.object(main, "get_df", return_value=df), \
             patch.object(main, "PREDICT_ALL_SHARED_WEIGHTS", ALT_WEIGHTS, create=True):
            changed_external = main.api_predict_all(**kwargs)["categories"]["prize1"]["numbers"]

        self.assertEqual(changed_external, baseline)

    def test_prize1_internal_top3_call_uses_frozen_weights_not_shared_weights(self):
        df = synthetic_draws()
        target = datetime(2026, 10, 16)
        original_ranker = analyzer.predict_numbers
        observed = []

        def recording_ranker(data, col, draw_date, top_n=10, weights=None):
            if col == "top3":
                observed.append(weights)
            if weights is None:
                return original_ranker(data, col, draw_date, top_n=top_n)
            return original_ranker(data, col, draw_date, top_n=top_n, weights=weights)

        with patch.object(analyzer, "predict_numbers", side_effect=recording_ranker), \
             patch.object(main, "PREDICT_ALL_SHARED_WEIGHTS", ALT_WEIGHTS, create=True):
            result = analyzer.predict_prize1_ultimate(
                df, target, top_n=5, beam_width=20, k_back=5
            )

        self.assertFalse(result.empty)
        self.assertEqual(observed, [FROZEN_DEFAULT_WEIGHTS])


if __name__ == "__main__":
    unittest.main()
