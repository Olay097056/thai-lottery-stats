"""Synthetic-only tests for Astra-Σ; never read real lottery outcomes."""
from __future__ import annotations

from collections import Counter
from datetime import date, datetime, timedelta, timezone
from itertools import product
import math
import sys
import unittest

ROOT = __import__("pathlib").Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
try:
    import astra
    import astra_sigma as sigma
except ModuleNotFoundError as exc:
    if exc.name not in {"astra", "astra_sigma"}:
        raise
    astra = sigma = None

GENERATED = datetime(2026, 10, 8, 12, tzinfo=timezone(timedelta(hours=7)))
TARGET = "2026-10-16"


class ModulePresenceTests(unittest.TestCase):
    def test_sigma_module_exists(self):
        self.assertIsNotNone(sigma, "Astra-Σ should be a separate experimental implementation")


@unittest.skipIf(sigma is None, "Astra-Σ implementation not present yet")
class SigmaContractTests(unittest.TestCase):
    def test_formula_version_weights_and_all_categories_are_frozen(self):
        self.assertEqual(sigma.VERSION, "astra-sigma-v0.1")
        self.assertEqual(sum(sigma.WEIGHTS.values()), 1.0)
        self.assertEqual(sigma.WEIGHTS, {
            "A": 0.50, "H": 0.10, "D": 0.10,
            "N": 0.12, "L": 0.08, "B": 0.10,
        })
        report = sigma.build_astra_sigma_report([], TARGET, generated_at=GENERATED)
        self.assertEqual(list(report["categories"]), [
            "prize1", "front3", "back3", "bottom2", "prize2", "prize3", "prize4",
        ])
        self.assertEqual(report["version"], "astra-sigma-v0.1")
        self.assertEqual(report["trust"], "ทดลอง")
        self.assertTrue(all(not item["numbers"] for item in report["categories"].values()))

    def test_invalid_target_is_rejected_before_scoring(self):
        for target in ("2026-10-08", "2026-10-07", "20261016", "2026-02-30"):
            with self.subTest(target=target), self.assertRaises(astra.AstraInputError):
                sigma.build_astra_sigma_report([], target, generated_at=GENERATED)

    def test_minimum_valid_draws_and_leading_zero_strings(self):
        draws = [(age, (f"{age % 100:02d}",)) for age in range(19)]
        rows, status = sigma.rank_category("bottom2", draws, TARGET, count=100)
        self.assertEqual(status, "insufficient_data")
        self.assertEqual(rows, [])
        draws.append((19, ("07",)))
        rows, status = sigma.rank_category("bottom2", draws, TARGET, count=100)
        self.assertEqual(status, "ok")
        self.assertEqual(len(rows), 100)
        self.assertIn("07", {row["number"] for row in rows})
        self.assertTrue(all(len(row["number"]) == 2 for row in rows))

    def test_hot_and_overdue_components_use_latest_24_valid_draws(self):
        draws = [(age, ("12",)) for age in range(24)]
        rows, status = sigma.rank_category("bottom2", draws, TARGET, count=100)
        self.assertEqual(status, "ok")
        by_number = {row["number"]: row["components"] for row in rows}
        self.assertEqual(by_number["12"]["H"], 1.0)
        self.assertEqual(by_number["12"]["D"], 0.0)
        self.assertEqual(by_number["34"]["H"], 0.0)
        self.assertEqual(by_number["34"]["D"], 1.0)

    def test_components_stay_bounded_and_target_date_changes_numerology_only(self):
        draws = [(age, (f"{age % 100:02d}",)) for age in range(24)]
        first, _ = sigma.rank_category("bottom2", draws, TARGET, count=100)
        other, _ = sigma.rank_category("bottom2", draws, "2026-10-17", count=100)
        by_number = {row["number"]: row for row in first}
        other_by_number = {row["number"]: row for row in other}
        self.assertEqual(set(by_number), set(other_by_number))
        for number, row in by_number.items():
            self.assertEqual(set(row["components"]), {"A", "H", "D", "N", "L", "B"})
            self.assertTrue(all(0.0 <= value <= 1.0 for value in row["components"].values()))
            self.assertTrue(0.0 <= row["score"] <= 1.0)
            for component in ("A", "H", "D", "L", "B"):
                self.assertEqual(row["components"][component], other_by_number[number]["components"][component])
        self.assertTrue(any(by_number[n]["components"]["N"] != other_by_number[n]["components"]["N"] for n in by_number))

    def test_base_percentile_matches_exhaustive_full_bottom2_domain_oracle(self):
        draws = [(age, (f"{(age * 17 + 7) % 100:02d}",)) for age in range(31)]
        rows, status = sigma.rank_category("bottom2", draws, TARGET, count=100)
        self.assertEqual(status, "ok")
        model = astra._build_model(draws, 2)
        base_scores = []
        for tens, ones in product("0123456789", repeat=2):
            number = tens + ones
            score = math.log(model["q"][0][int(tens)])
            score += 0.5 * math.log(model["q"][1][int(ones)]) + 0.5 * math.log(model["t"][0][int(tens)][int(ones)])
            base_scores.append((number, score))
        ordered = sorted(score for _, score in base_scores)
        for row in rows:
            expected = sum(score <= row["base_score"] for _, score in base_scores) / 100
            self.assertEqual(row["components"]["A"], expected)
        self.assertEqual({row["number"] for row in rows}, {number for number, _ in base_scores})

    def test_ranking_is_exact_raw_score_then_lexical_tie_break_and_deterministic(self):
        draws = [(age, ("12",)) for age in range(24)]
        first, _ = sigma.rank_category("bottom2", draws, TARGET, count=100)
        second, _ = sigma.rank_category("bottom2", draws, TARGET, count=100)
        self.assertEqual(first, second)
        self.assertEqual(first, sorted(first, key=lambda row: (-row["score"], row["number"])))
        self.assertTrue(all(math.isfinite(row["score"]) for row in first))


if __name__ == "__main__":
    unittest.main(verbosity=2)
