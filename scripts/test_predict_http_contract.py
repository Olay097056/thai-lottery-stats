"""Exercise Predict routes through FastAPI using synthetic history only."""
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

import pandas as pd
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import main


TARGET = "2026-11-01"
HISTORY = pd.DataFrame({
    "date": pd.to_datetime(["2026-10-01", "2026-10-16", "2026-11-02"]),
    "prize1": ["012345", "067890", "099999"],
})
CANDIDATES = {
    "front3_1": "007",
    "front3_2": "018",
    "back3_1": "023",
    "back3_2": "004",
    "bottom2": "05",
}


def prize1_fixture(_df, target, **_kwargs):
    assert target.strftime("%Y-%m-%d") == TARGET
    return pd.DataFrame([{"num": "000007", "score": 1.25}])


def category_fixture(_df, col, target, **_kwargs):
    assert target.strftime("%Y-%m-%d") == TARGET
    return pd.DataFrame([{"num": CANDIDATES[col], "score": 0.75}])


class PredictHTTPContractTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(main.app)
        self.patches = [
            patch.object(main, "get_df", return_value=HISTORY),
            patch.object(main, "predict_prize1_ultimate", side_effect=prize1_fixture),
            patch.object(main, "predict_with_reasons", side_effect=category_fixture),
        ]
        for item in self.patches:
            item.start()
            self.addCleanup(item.stop)

    def test_all_route_serializes_target_categories_zeroes_and_provenance(self):
        response = self.client.get(
            "/api/predict/all",
            params={"date": TARGET, "top_n": 5, "beam_width": 50,
                    "k_back": 10, "preset": "balanced"},
        )

        self.assertEqual(response.status_code, 200, response.text)
        report = response.json()
        self.assertEqual(report["date"], TARGET)
        self.assertEqual(report["report_status"], "ready")
        self.assertEqual(report["prize1_config"]["preset"], "balanced")
        self.assertEqual(
            set(report["categories"]),
            {"prize1", "front3_1", "front3_2", "back3_1", "back3_2", "bottom2"},
        )
        self.assertEqual(report["categories"]["prize1"]["numbers"][0]["num"], "000007")
        for key, number in CANDIDATES.items():
            self.assertEqual(report["categories"][key]["numbers"][0]["num"], number)

        provenance = report["report_provenance"]
        self.assertEqual(provenance["target_date"], TARGET)
        self.assertEqual(provenance["source"], "loaded_history")
        self.assertEqual(provenance["history_cutoff"], "2026-10-16")
        self.assertEqual(provenance["input_draws"], 2)
        self.assertEqual(len(provenance["data_version"]), 64)

    def test_prize1_route_serializes_target_and_zero_padded_candidate(self):
        response = self.client.get(
            "/api/predict/prize1",
            params={"date": TARGET, "top_n": 5, "beam_width": 50,
                    "k_back": 10, "preset": "balanced"},
        )

        self.assertEqual(response.status_code, 200, response.text)
        payload = response.json()
        self.assertEqual(payload["date"], TARGET)
        self.assertEqual(payload["predictions"][0]["num"], "000007")
        self.assertEqual(payload["algorithm"], "ultimate")
        self.assertEqual(payload["preset"], "balanced")
        self.assertEqual(payload["preset_label"], "Balanced coverage")

    def test_invalid_target_is_a_serialized_client_error_for_both_routes(self):
        for path in ("/api/predict/all", "/api/predict/prize1"):
            with self.subTest(path=path):
                response = self.client.get(path, params={"date": "2026-02-30"})
                self.assertEqual(response.status_code, 400, response.text)
                self.assertEqual(response.json(), {"detail": "date must use YYYY-MM-DD"})

    def test_all_route_serializes_partial_failure_without_private_error(self):
        def category_with_one_safe_failure(_df, col, target, **_kwargs):
            if col == "bottom2":
                raise RuntimeError("private synthetic failure")
            return category_fixture(_df, col, target, **_kwargs)

        with patch.object(main, "predict_with_reasons", side_effect=category_with_one_safe_failure):
            response = self.client.get(
                "/api/predict/all", params={"date": TARGET, "top_n": 5}
            )

        self.assertEqual(response.status_code, 200, response.text)
        report = response.json()
        self.assertEqual(report["report_status"], "partial")
        self.assertEqual(report["categories"]["bottom2"]["numbers"], [])
        self.assertEqual(report["categories"]["bottom2"]["error_code"], "calculation_failed")
        self.assertNotIn("private synthetic failure", response.text)


if __name__ == "__main__":
    unittest.main()
