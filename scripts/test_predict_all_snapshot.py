"""Synthetic tests for immutable, prospective `/api/predict/all` snapshots."""
from datetime import datetime, timedelta, timezone
from pathlib import Path
import json
import os
import sys
import tempfile
import unittest
from unittest.mock import patch

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import analyzer
import capture_predict_all_snapshot as snapshotter
from capture_predict_all_snapshot import (
    DuplicateTargetSnapshotError,
    append_snapshot,
    build_snapshot,
    load_existing_local_cache,
)


TZ = timezone(timedelta(hours=7))
TARGET_DATE = "2026-10-16"
CAPTURED_AT = datetime(2026, 10, 15, 10, 0, tzinfo=TZ)
COMMIT = "a" * 40


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
            "top2": prize1[-2:],
            "bottom2": f"{(i * 13 + 9) % 100:02d}",
            "front3_1": f"{(i * 37 + 11) % 1000:03d}",
            "front3_2": f"{(i * 31 + 1) % 1000:03d}",
            "back3_1": f"{(i * 23 + 7) % 1000:03d}",
            "back3_2": f"{(i * 19 + 3) % 1000:03d}",
        })
    return pd.DataFrame(rows)


def scratch_tempdir():
    base = Path(os.environ.get("LOCALAPPDATA") or Path.home()) / "hermes" / "cache" / "scratch"
    base.mkdir(parents=True, exist_ok=True)
    return tempfile.TemporaryDirectory(dir=base)


class PredictAllSnapshotTests(unittest.TestCase):
    def test_snapshot_freezes_full_rankings_components_and_strings(self):
        df = synthetic_draws()
        snapshot = build_snapshot(df, TARGET_DATE, COMMIT, captured_at=CAPTURED_AT)
        with patch.object(snapshotter.app, "get_df", return_value=df):
            endpoint = snapshotter.app.api_predict_all(
                top_n=10,
                beam_width=500,
                k_back=100,
                preset="optimized",
                date=TARGET_DATE,
            )

        self.assertEqual(snapshot["target_date"], TARGET_DATE)
        self.assertEqual(snapshot["code_commit"], COMMIT)
        self.assertEqual(snapshot["settings"]["top_n"], 10)
        self.assertEqual(snapshot["settings"]["preset"], "optimized")
        self.assertEqual(snapshot["settings"]["score_scale"], 1000)
        self.assertEqual(snapshot["settings"]["score_round_digits"], 2)
        self.assertEqual(
            snapshot["settings"]["score_formula"],
            "round(sum(component[i] * shared_weights[component_order[i]]) * "
            "lag_factor * score_scale, score_round_digits)",
        )
        self.assertLess(snapshot["training_cutoff_date"], TARGET_DATE)
        self.assertEqual(
            set(snapshot["fields"]),
            {"front3_1", "front3_2", "back3_1", "back3_2", "bottom2"},
        )

        for field in ("front3_1", "front3_2", "back3_1", "back3_2"):
            ranked = snapshot["fields"][field]["ranked"]
            self.assertEqual(len(ranked), 1000)
            self.assertIn("007", [candidate["number"] for candidate in ranked])
            self.assertEqual(len(snapshot["fields"][field]["top10"]), 10)
            self.assertTrue(all(isinstance(c["number"], str) for c in ranked))
            self.assertTrue(all(len(c["components"]) == 9 for c in ranked))
            self.assertTrue(all("lag_factor" in c for c in ranked))
            candidate = ranked[0]
            weighted_sum = sum(
                component * snapshot["settings"]["shared_weights"][name]
                for name, component in zip(
                    snapshot["settings"]["component_order"], candidate["components"]
                )
            )
            self.assertEqual(
                candidate["score"],
                round(
                    weighted_sum * candidate["lag_factor"] * snapshot["settings"]["score_scale"],
                    snapshot["settings"]["score_round_digits"],
                ),
            )
            endpoint_top10 = endpoint["categories"][field]["numbers"]
            self.assertEqual(
                [item["เลข"] for item in endpoint_top10],
                [item["number"] for item in snapshot["fields"][field]["top10"]],
            )
            self.assertEqual(
                [item["คะแนนรวม"] for item in endpoint_top10],
                [item["score"] for item in snapshot["fields"][field]["top10"]],
            )

        self.assertEqual(len(snapshot["fields"]["bottom2"]["ranked"]), 100)
        self.assertEqual(
            [item["เลข"] for item in endpoint["categories"]["bottom2"]["numbers"]],
            [item["number"] for item in snapshot["fields"]["bottom2"]["top10"]],
        )
        self.assertEqual(len(snapshot["prize1"]["top10"]), 10)
        self.assertTrue(all(len(x["number"]) == 6 for x in snapshot["prize1"]["top10"]))
        self.assertEqual(
            [item["เลข"] for item in endpoint["categories"]["prize1"]["numbers"]],
            [item["number"] for item in snapshot["prize1"]["top10"]],
        )
        self.assertEqual(
            [item["คะแนนรวม"] for item in endpoint["categories"]["prize1"]["numbers"]],
            [item["score"] for item in snapshot["prize1"]["top10"]],
        )
        self.assertNotIn("actual_results", snapshot)

    def test_snapshot_rejects_capture_on_target_day_or_later(self):
        same_day = datetime(2026, 10, 16, 8, 0, tzinfo=TZ)
        with self.assertRaisesRegex(ValueError, "before the target draw date"):
            build_snapshot(synthetic_draws(), TARGET_DATE, COMMIT, captured_at=same_day)

    def test_snapshot_rejects_training_history_that_reaches_target(self):
        df = synthetic_draws()
        extra = df.iloc[-1].copy()
        extra["date"] = pd.Timestamp(TARGET_DATE)
        df = pd.concat([df, extra.to_frame().T], ignore_index=True)

        with self.assertRaisesRegex(ValueError, "history must end before target"):
            build_snapshot(df, TARGET_DATE, COMMIT, captured_at=CAPTURED_AT)

    def test_snapshot_rejects_training_history_not_available_at_capture(self):
        df = synthetic_draws()
        extra = df.iloc[-1].copy()
        extra["date"] = pd.Timestamp(CAPTURED_AT.date())
        df = pd.concat([df, extra.to_frame().T], ignore_index=True)

        with self.assertRaisesRegex(ValueError, "history must end before capture"):
            build_snapshot(df, TARGET_DATE, COMMIT, captured_at=CAPTURED_AT)

    def test_jsonl_append_refuses_duplicate_target_without_overwriting(self):
        snapshot = build_snapshot(
            synthetic_draws(), TARGET_DATE, COMMIT, captured_at=CAPTURED_AT
        )
        with scratch_tempdir() as temp_dir:
            path = Path(temp_dir) / "predictions.jsonl"
            append_snapshot(snapshot, path)
            before = path.read_text(encoding="utf-8")

            with self.assertRaises(DuplicateTargetSnapshotError):
                append_snapshot(snapshot, path)

            self.assertEqual(path.read_text(encoding="utf-8"), before)
            self.assertFalse(Path(str(path) + ".lock").exists())

    def test_jsonl_append_rejects_noncanonical_alias_of_existing_target_date(self):
        existing = {"target_date": "2026-11-01"}
        date_alias = {"target_date": "2026-11-1"}
        with scratch_tempdir() as temp_dir:
            path = Path(temp_dir) / "predictions.jsonl"
            path.write_text(json.dumps(existing) + "\n", encoding="utf-8")
            before = path.read_bytes()

            with self.assertRaisesRegex(ValueError, "canonical YYYY-MM-DD"):
                append_snapshot(date_alias, path)

            self.assertEqual(path.read_bytes(), before)
            self.assertFalse(Path(str(path) + ".lock").exists())

    def test_jsonl_append_refuses_noncanonical_stored_target_date(self):
        existing = {"target_date": "2026-11-1"}
        canonical = {"target_date": "2026-11-01"}
        with scratch_tempdir() as temp_dir:
            path = Path(temp_dir) / "predictions.jsonl"
            path.write_text(json.dumps(existing) + "\n", encoding="utf-8")
            before = path.read_bytes()

            with self.assertRaisesRegex(ValueError, "noncanonical target date"):
                append_snapshot(canonical, path)

            self.assertEqual(path.read_bytes(), before)
            self.assertFalse(Path(str(path) + ".lock").exists())

    def test_jsonl_append_refuses_unterminated_final_record_without_mutating_it(self):
        existing = {"target_date": TARGET_DATE}
        next_target = {"target_date": "2026-11-01"}
        with scratch_tempdir() as temp_dir:
            path = Path(temp_dir) / "predictions.jsonl"
            path.write_text(json.dumps(existing), encoding="utf-8")
            before = path.read_bytes()

            with self.assertRaisesRegex(ValueError, "must end with a newline"):
                append_snapshot(next_target, path)

            self.assertEqual(path.read_bytes(), before)
            self.assertFalse(Path(str(path) + ".lock").exists())

    def test_jsonl_append_keeps_distinct_target_dates_as_separate_records(self):
        first = build_snapshot(
            synthetic_draws(), TARGET_DATE, COMMIT, captured_at=CAPTURED_AT
        )
        second = dict(first)
        second["target_date"] = "2026-11-01"
        with scratch_tempdir() as temp_dir:
            path = Path(temp_dir) / "predictions.jsonl"
            append_snapshot(first, path)
            append_snapshot(second, path)
            records = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()]

        self.assertEqual([r["target_date"] for r in records], [TARGET_DATE, "2026-11-01"])

    def test_missing_cache_fails_closed_without_calling_scraper(self):
        with scratch_tempdir() as temp_dir:
            missing_path = Path(temp_dir) / "missing-cache.csv"
            with patch.object(snapshotter.scraper, "CACHE_FILE", missing_path), \
                 patch.object(snapshotter.scraper, "load_data") as load_data, \
                 patch.object(snapshotter.scraper, "scrape_year") as scrape_year:
                with self.assertRaisesRegex(RuntimeError, "refusing to download or create"):
                    load_existing_local_cache()
            load_data.assert_not_called()
            scrape_year.assert_not_called()
            self.assertFalse(missing_path.exists())

    def test_synthetic_cache_loader_preserves_number_strings_without_scraping(self):
        df = synthetic_draws()
        with scratch_tempdir() as temp_dir:
            cache_path = Path(temp_dir) / "synthetic-cache.csv"
            df.to_csv(cache_path, index=False, encoding="utf-8")
            with patch.object(snapshotter.scraper, "CACHE_FILE", cache_path), \
                 patch.object(snapshotter.scraper, "scrape_year") as scrape_year:
                loaded = load_existing_local_cache()

            scrape_year.assert_not_called()
            self.assertTrue(all(isinstance(value, str) for value in loaded["top3"]))
            self.assertTrue(all(len(value) == 3 for value in loaded["top3"]))
            self.assertTrue(any(value.startswith("0") for value in loaded["top3"]))
            self.assertEqual(cache_path, Path(temp_dir) / "synthetic-cache.csv")


if __name__ == "__main__":
    unittest.main()
