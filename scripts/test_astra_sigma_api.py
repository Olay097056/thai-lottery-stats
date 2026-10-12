"""Synthetic-only Astra-Σ API/CLI tests; never open the project result cache."""
from __future__ import annotations

import csv
from datetime import date, datetime, timedelta, timezone
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import main
import importlib
try:
    predict_astra_sigma = importlib.import_module("scripts.predict_astra_sigma")
except ModuleNotFoundError as exc:
    if exc.name != "scripts.predict_astra_sigma":
        raise
    predict_astra_sigma = None

GENERATED = datetime(2026, 10, 8, 12, tzinfo=timezone(timedelta(hours=7)))
TARGET = "2026-10-16"


class FixedDateTime(datetime):
    @classmethod
    def now(cls, tz=None):
        return GENERATED.astimezone(tz) if tz else GENERATED.replace(tzinfo=None)


def synthetic_rows(count=24):
    return [
        {
            "date": (date(2026, 7, 1) + timedelta(days=age)).isoformat(),
            "bottom2": f"{(age * 17 + 7) % 100:02d}",
        }
        for age in range(count)
    ]


def write_fixture(path, records):
    with path.open("w", encoding="utf-8", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=list(records[0]))
        writer.writeheader()
        writer.writerows(records)


class SigmaApiCliTests(unittest.TestCase):
    def setUp(self):
        scratch = ROOT / ".scratch" / "astra-2026-10-08" / "test-fixtures"
        scratch.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(dir=scratch)
        self.addCleanup(self.temp.cleanup)
        self.cache = Path(self.temp.name) / "synthetic.csv"
        self.env = patch.dict("os.environ", {"ASTRA_AUTO_ENABLED": "0"})
        self.env.start()
        self.addCleanup(self.env.stop)
        self.clock = patch.object(main, "datetime", FixedDateTime)
        self.clock.start()
        self.addCleanup(self.clock.stop)
        self.client_context = TestClient(main.app)
        self.client = self.client_context.__enter__()
        self.addCleanup(self.client_context.__exit__, None, None, None)
        self.loader = patch("astra.load_existing_astra_history", side_effect=lambda path=None: __import__("astra").load_existing_astra_history(path))

    def use_fixture(self):
        records = synthetic_rows()
        write_fixture(self.cache, records)
        import astra
        original_loader = astra.load_existing_astra_history
        return patch.object(
            astra, "load_existing_astra_history",
            side_effect=lambda path=None: original_loader(self.cache),
        )

    def test_sigma_api_route_is_present_and_uses_real_synthetic_engine(self):
        import astra
        with self.use_fixture():
            with patch("requests.sessions.Session.request", side_effect=AssertionError("network forbidden")):
                response = self.client.get("/api/predict/astra-sigma", params={"date": TARGET})
        self.assertEqual(response.status_code, 200, response.text)
        report = response.json()
        self.assertEqual(report["version"], "astra-sigma-v0.1")
        self.assertEqual(report["source"], "existing_local_cache")
        self.assertEqual(report["target_date"], TARGET)
        self.assertEqual(report["categories"]["bottom2"]["valid_draws"], 24)
        self.assertEqual(len(report["categories"]["bottom2"]["numbers"]), 1)
        self.assertFalse(report["categories"]["prize1"]["numbers"])
        self.assertEqual(report["categories"]["prize1"]["status"], "insufficient_data")
        self.assertEqual(report["categories"]["bottom2"]["numbers"][0]["number"].__len__(), 2)

    def test_invalid_target_is_rejected_before_opening_cache(self):
        import astra
        with patch.object(astra, "load_existing_astra_history", side_effect=AssertionError("cache opened")):
            response = self.client.get("/api/predict/astra-sigma", params={"date": "2026-10-08"})
        self.assertEqual(response.status_code, 400)

    def test_missing_cache_is_safe_and_not_created(self):
        import astra
        original_loader = astra.load_existing_astra_history
        with patch.object(astra, "load_existing_astra_history", side_effect=lambda path=None: original_loader(self.cache)):
            response = self.client.get("/api/predict/astra-sigma", params={"date": TARGET})
        self.assertEqual(response.status_code, 503)
        self.assertFalse(self.cache.exists())
        self.assertNotIn(str(self.cache), response.text)

    def test_cli_uses_only_given_synthetic_cache_and_matches_api_schema(self):
        self.assertIsNotNone(predict_astra_sigma)
        import astra
        with self.use_fixture():
            with patch.object(main, "datetime", FixedDateTime):
                api = self.client.get("/api/predict/astra-sigma", params={"date": TARGET}).json()
        before = self.cache.read_bytes()
        output, errors = io.StringIO(), io.StringIO()
        with patch.object(predict_astra_sigma, "datetime", FixedDateTime):
            with unittest.mock.patch("sys.stdout", output), unittest.mock.patch("sys.stderr", errors):
                exit_code = predict_astra_sigma.main(["--target-date", TARGET], cache_path=self.cache)
        cli = json.loads(output.getvalue())
        self.assertEqual(exit_code, 0, errors.getvalue())
        self.assertEqual(cli, api)
        self.assertEqual(self.cache.read_bytes(), before)


if __name__ == "__main__":
    unittest.main(verbosity=2)
