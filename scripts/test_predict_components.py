"""Synthetic regressions for immutable predictor component snapshots."""
from datetime import datetime
from pathlib import Path
import sys
import unittest

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import analyzer


def synthetic_draws(count=24):
    dates = pd.date_range("2023-01-01", periods=count, freq="15D")
    rows = []
    for i, date in enumerate(dates):
        rows.append({
            "date": date,
            "year": date.year,
            "month": date.month,
            "day": date.day,
            "weekday": analyzer.DAY_MAP[date.weekday()],
            "bottom2": f"{(i * 13 + 9) % 100:02d}",
            "top3": f"{(i * 37 + 7) % 1000:03d}",
        })
    return pd.DataFrame(rows)


class PredictComponentSnapshotTests(unittest.TestCase):
    def test_component_scores_are_opt_in_and_reconstruct_the_composite(self):
        df = synthetic_draws()
        target = datetime(2026, 10, 16)
        default = analyzer.predict_numbers(df, "top3", target, top_n=None)
        detailed = analyzer.predict_numbers(
            df, "top3", target, top_n=None, include_components=True
        )

        self.assertEqual(default["เลข"].tolist(), detailed["เลข"].tolist())
        self.assertFalse(any(str(col).startswith("component_") for col in default.columns))
        weights = dict(analyzer.PREDICT_NUMBERS_DEFAULT_WEIGHTS)
        for name in weights:
            self.assertIn(f"component_{name}", detailed.columns)
        self.assertIn("lag_factor", detailed.columns)
        self.assertIn("007", detailed["เลข"].tolist())

        row = detailed.iloc[0]
        composite = sum(
            float(row[f"component_{name}"]) * weight
            for name, weight in weights.items()
        ) * float(row["lag_factor"])
        self.assertEqual(float(row["คะแนนรวม"]), round(composite * 1000, 2))


if __name__ == "__main__":
    unittest.main()
