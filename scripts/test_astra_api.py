"""Synthetic-only HTTP/CLI contracts for astra; never reads real outcomes."""
from __future__ import annotations

from contextlib import ExitStack, redirect_stderr, redirect_stdout
import csv
from datetime import date, datetime, timedelta, timezone
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import main
from scripts import predict_astra

GENERATED = datetime(2026, 10, 8, 12, 0, tzinfo=timezone(timedelta(hours=7)))
TARGET = "2026-10-16"
COUNTS = {"prize1": 5, "front3": 2, "back3": 2, "bottom2": 1,
          "prize2": 5, "prize3": 5, "prize4": 5}


class FixedDateTime(datetime):
    @classmethod
    def now(cls, tz=None):
        return GENERATED.astimezone(tz) if tz else GENERATED.replace(tzinfo=None)


def synthetic_rows(count=24):
    """Artificial daily records, generated without any lottery result input."""
    records = []
    for i in range(count):
        row = {
            "date": (date(2026, 7, 1) + timedelta(days=i)).isoformat(),
            "prize1": f"{i + 1:06d}", "bottom2": f"{i % 100:02d}",
            "front3_1": f"{100 + i:03d}", "front3_2": f"{200 + i:03d}",
            "back3_1": f"{300 + i:03d}", "back3_2": f"{400 + i:03d}",
            "prize4": " ".join(f"{10000 + i * 50 + j:06d}" for j in range(50)),
        }
        row.update({f"prize2_{j}": f"{100 + i * 5 + j:06d}" for j in range(1, 6)})
        row.update({f"prize3_{j}": f"{1000 + i * 10 + j:06d}" for j in range(1, 11)})
        records.append(row)
    return records


def write_fixture(path, records):
    with path.open("w", encoding="utf-8", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=list(records[0]))
        writer.writeheader()
        writer.writerows(records)


class SyntheticCacheCase(unittest.TestCase):
    def setUp(self):
        import astra
        self.astra = astra
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        scratch = ROOT / ".scratch" / "astra-2026-10-08" / "test-fixtures"
        scratch.mkdir(parents=True, exist_ok=True)
        directory = self.stack.enter_context(tempfile.TemporaryDirectory(dir=scratch))
        self.cache = Path(directory) / "synthetic.csv"
        self.stack.enter_context(patch.dict('os.environ', {'ASTRA_AUTO_ENABLED': '0'}))
        self.stack.enter_context(patch.object(main, "datetime", FixedDateTime))
        for name in ("get_df", "load_data", "incremental_update"):
            self.stack.enter_context(patch.object(main, name, side_effect=AssertionError("forbidden default loader")))
        self.stack.enter_context(patch("requests.sessions.Session.request", side_effect=AssertionError("forbidden network")))
        self.client = self.stack.enter_context(TestClient(main.app))

    def use_fixture(self, records):
        write_fixture(self.cache, records)
        loader = self.astra.load_existing_astra_history
        return patch.object(self.astra, "load_existing_astra_history", side_effect=lambda: loader(self.cache))


class AstraApiTests(SyntheticCacheCase):
    def test_target_query_is_required_without_default_data_loading(self):
        with patch.object(self.astra, "load_existing_astra_history", side_effect=AssertionError("history opened")):
            response = self.client.get("/api/predict/astra")
        self.assertEqual(response.status_code, 422)

    def test_past_today_alias_and_invalid_dates_rejected_before_history_open(self):
        for target in ("2026-10-08", "2026-10-01", "2026-10-8", "20261016",
                       "2026-02-30", "2026-10-16T00:00:00", " 2026-10-16 ", ""):
            with self.subTest(target=target), patch.object(
                self.astra, "load_existing_astra_history", side_effect=AssertionError("history opened")
            ):
                response = self.client.get("/api/predict/astra", params={"date": target})
                self.assertEqual(response.status_code, 400)

    def test_real_http_engine_path_uses_readonly_cache_and_exact_counts(self):
        with self.use_fixture(synthetic_rows()):
            before = self.cache.read_bytes()
            response = self.client.get("/api/predict/astra", params={"date": TARGET})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(before, self.cache.read_bytes())
        report = response.json()
        self.assertEqual(report["formula"], "astra")
        self.assertEqual(report["version"], "astra-v1")
        self.assertEqual(report["source"], "existing_local_cache")
        self.assertEqual(report["generated_at"], GENERATED.isoformat())
        self.assertEqual(report["target_date"], TARGET)
        self.assertEqual(report["training_cutoff_date"], "2026-07-24")
        self.assertTrue(report["warnings"])
        self.assertEqual(list(report["categories"]), list(COUNTS))
        self.assertEqual({key: len(value["numbers"]) for key, value in report["categories"].items()}, COUNTS)
        for category in report["categories"].values():
            self.assertEqual(category["valid_draws"], 24)
            self.assertEqual(category["invalid_draws"], 0)
            self.assertEqual(category["status"], "ok")
            self.assertEqual(category["training_cutoff_date"], "2026-07-24")
            for item in category["numbers"]:
                self.assertIsInstance(item["number"], str)
                self.assertEqual(len(item["number"]), category["digits"])

    def test_missing_cache_returns_safe_503_and_does_not_create_it(self):
        loader = self.astra.load_existing_astra_history
        with patch.object(self.astra, "load_existing_astra_history", side_effect=lambda: loader(self.cache)):
            response = self.client.get("/api/predict/astra", params={"date": TARGET})
        self.assertEqual(response.status_code, 503)
        self.assertFalse(self.cache.exists())
        self.assertNotIn(str(self.cache), response.text)
        self.assertIn("no refresh", response.json()["detail"])

    def test_invalid_history_fails_closed_without_leaking_source_values(self):
        records = synthetic_rows()
        for bad_date in (records[0]["date"], "2026-10-09", "bad-private-value"):
            bad = [dict(record) for record in records]
            bad[-1]["date"] = bad_date
            with self.subTest(value=bad_date), self.use_fixture(bad):
                before = self.cache.read_bytes()
                response = self.client.get("/api/predict/astra", params={"date": TARGET})
                self.assertEqual(response.status_code, 400)
                self.assertEqual(before, self.cache.read_bytes())
                self.assertNotIn("bad-private-value", response.text)
                self.assertNotIn(str(self.cache), response.text)

    def test_incomplete_prize4_is_explicit_without_dropping_other_categories(self):
        records = synthetic_rows()
        for record in records:
            record["prize4"] = "000001 000001"
        with self.use_fixture(records):
            response = self.client.get("/api/predict/astra", params={"date": TARGET})
        self.assertEqual(response.status_code, 200)
        categories = response.json()["categories"]
        self.assertEqual(len(categories), 7)
        self.assertEqual(categories["prize4"]["status"], "insufficient_data")
        self.assertEqual(categories["prize4"]["numbers"], [])
        self.assertEqual(categories["prize4"]["invalid_draws"], 24)
        self.assertEqual(len(categories["prize1"]["numbers"]), 5)


class AstraCliTests(SyntheticCacheCase):
    def test_help_is_available_without_loading_history(self):
        completed = subprocess.run(
            [sys.executable, str(ROOT / "scripts" / "predict_astra.py"), "--help"],
            cwd=ROOT, capture_output=True, text=True, timeout=20,
        )
        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertIn("--target-date", completed.stdout)
        self.assertIn("read-only", completed.stdout)

    def test_cli_and_http_return_the_same_fixed_report(self):
        with self.use_fixture(synthetic_rows()):
            api_report = self.client.get("/api/predict/astra", params={"date": TARGET}).json()
        before = self.cache.read_bytes()
        output, errors = io.StringIO(), io.StringIO()
        with redirect_stdout(output), redirect_stderr(errors):
            result = predict_astra.main(["--target-date", TARGET], cache_path=self.cache, generated_at=GENERATED)
        self.assertEqual(result, 0, errors.getvalue())
        self.assertEqual(json.loads(output.getvalue()), api_report)
        self.assertEqual(before, self.cache.read_bytes())
        self.assertEqual(errors.getvalue(), "")

    def test_invalid_target_precedes_any_cli_loader_and_emits_no_prediction(self):
        output, errors = io.StringIO(), io.StringIO()
        with patch.object(self.astra, "load_existing_astra_history", side_effect=AssertionError("history opened")), \
             redirect_stdout(output), redirect_stderr(errors):
            result = predict_astra.main(["--target-date", "2026-10-08"], cache_path=self.cache, generated_at=GENERATED)
        self.assertEqual(result, 2)
        self.assertEqual(output.getvalue(), "")
        self.assertFalse(self.cache.exists())

    def test_cli_missing_cache_is_safe_and_creates_no_files(self):
        output, errors = io.StringIO(), io.StringIO()
        with redirect_stdout(output), redirect_stderr(errors):
            result = predict_astra.main(["--target-date", TARGET], cache_path=self.cache, generated_at=GENERATED)
        self.assertEqual(result, 3)
        self.assertEqual(output.getvalue(), "")
        self.assertIn("no refresh", errors.getvalue())
        self.assertNotIn(str(self.cache), errors.getvalue())
        self.assertEqual(list(self.cache.parent.iterdir()), [])


if __name__ == "__main__":
    unittest.main(verbosity=2)
