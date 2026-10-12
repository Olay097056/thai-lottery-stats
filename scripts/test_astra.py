"""Synthetic-only astra-v1 contract tests. Never read result datasets.

Run from the repository root with the project Python environment:
    env -u PYTHONPATH -u VIRTUAL_ENV \
      "$LOCALAPPDATA/lottery_stats_runtime/.venv/Scripts/python.exe" \
      scripts/test_astra.py

Verification: this suite must exit 0; all inference fixtures are constructed
in memory. Loader fixtures belong only under this repository's .scratch.
"""

from datetime import date, datetime, timedelta, timezone
from contextlib import ExitStack
from copy import deepcopy
from pathlib import Path
from itertools import product
from types import MappingProxyType
from unittest.mock import patch
import builtins
import csv
import io
import json
import math
import os
import random
import socket
import sys
import tempfile
import unittest
import urllib.request

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
try:
    import astra
except ModuleNotFoundError as exc:
    if exc.name != "astra":
        raise
    astra = None

NOW = datetime(2026, 10, 8, 12, 0, tzinfo=timezone(timedelta(hours=7)))
TARGET = "2026-10-16"


class TargetContractTests(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(astra, "astra engine must exist")

    def test_canonical_future_target_returns_date(self):
        self.assertEqual(
            astra.validate_astra_target_date(TARGET, generated_at=NOW),
            date(2026, 10, 16),
        )
        self.assertEqual(astra.THAILAND_TZ.utcoffset(None), timedelta(hours=7))
        self.assertTrue(issubclass(astra.AstraInputError, ValueError))
        self.assertTrue(issubclass(astra.AstraCacheError, RuntimeError))

    def test_target_rejects_past_today_aliases_and_invalid_values(self):
        for value in (
            "2026-10-08", "2026-10-07", "2026-02-30", "20261016",
            "2026-1-16", "2026-10-16T00:00:00", "2026-10-16 00:00:00",
            " 2026-10-16", "2026-10-16\n", "２０２６-１０-１６", "", None,
            date(2026, 10, 16), 20261016,
        ):
            with self.subTest(value=value):
                with self.assertRaises(astra.AstraInputError):
                    astra.validate_astra_target_date(value, generated_at=NOW)

    def test_generation_requires_aware_datetime(self):
        for value in (datetime(2026, 10, 8), "2026-10-08", date(2026, 10, 8)):
            with self.subTest(value=value):
                with self.assertRaises(astra.AstraInputError):
                    astra.validate_astra_target_date(TARGET, generated_at=value)

    def test_target_boundary_uses_thailand_not_utc_day(self):
        utc_late = datetime(2026, 10, 8, 18, 0, tzinfo=timezone.utc)
        with self.assertRaises(astra.AstraInputError):
            astra.validate_astra_target_date("2026-10-09", generated_at=utc_late)
        self.assertEqual(
            astra.validate_astra_target_date("2026-10-10", generated_at=utc_late),
            date(2026, 10, 10),
        )


CATEGORY_CONTRACT = (
    ("prize1", "รางวัลที่ 1", 6, 5),
    ("front3", "เลขหน้า 3 ตัว", 3, 2),
    ("back3", "เลขท้าย 3 ตัวทางการ", 3, 2),
    ("bottom2", "เลขท้าย 2 ตัว", 2, 1),
    ("prize2", "รางวัลที่ 2", 6, 5),
    ("prize3", "รางวัลที่ 3", 6, 5),
    ("prize4", "รางวัลที่ 4", 6, 5),
)
LOCKED_SETTINGS = {
    "max_draws": 200, "min_valid_draws": 20, "half_life_draws": 24,
    "weight_floor": 0.5, "positional_prior": 1, "pair_backoff_strength": 10,
    "positional_log_weight": 0.5, "conditional_log_weight": 0.5, "stale_days": 35,
}


class EmptyReportTests(unittest.TestCase):
    def test_empty_report_has_every_category_without_fabricated_numbers(self):
        self.assertTrue(callable(getattr(astra, "build_astra_report", None)))
        report = astra.build_astra_report([], TARGET, generated_at=NOW)
        self.assertEqual(set(report), {
            "schema_version", "formula", "version", "trust", "target_date",
            "generated_at", "training_cutoff_date", "source", "window_draws",
            "settings", "warnings", "categories",
        })
        self.assertEqual(report["schema_version"], 1)
        self.assertEqual(report["formula"], "astra")
        self.assertEqual(report["version"], "astra-v1")
        self.assertEqual(report["trust"], "ทดลอง")
        self.assertEqual(report["source"], "supplied_history")
        self.assertEqual(report["target_date"], TARGET)
        self.assertEqual(report["generated_at"], NOW.isoformat())
        self.assertIsNone(report["training_cutoff_date"])
        self.assertEqual(report["window_draws"], 0)
        self.assertEqual(report["settings"], LOCKED_SETTINGS)
        self.assertEqual(list(report["categories"]), [v[0] for v in CATEGORY_CONTRACT])
        for key, label, digits, count in CATEGORY_CONTRACT:
            with self.subTest(category=key):
                self.assertEqual(report["categories"][key], {
                    "label": label, "digits": digits, "requested_count": count,
                    "status": "insufficient_data", "valid_draws": 0,
                    "invalid_draws": 0, "training_cutoff_date": None, "numbers": [],
                })
        self.assertTrue(report["warnings"])
        self.assertTrue(all(isinstance(w, str) and w for w in report["warnings"]))
        report["settings"]["max_draws"] = 1
        report["categories"]["prize1"]["numbers"].append("mutation")
        fresh = astra.build_astra_report([], TARGET, generated_at=NOW)
        self.assertEqual(fresh["settings"], LOCKED_SETTINGS)
        self.assertEqual(fresh["categories"]["prize1"]["numbers"], [])

    def test_report_normalizes_generation_to_thailand(self):
        self.assertTrue(callable(getattr(astra, "build_astra_report", None)))
        utc = datetime(2026, 10, 8, 18, 0, tzinfo=timezone.utc)
        report = astra.build_astra_report([], TARGET, generated_at=utc)
        self.assertEqual(report["generated_at"], "2026-10-09T01:00:00+07:00")


class HistoryDateTests(unittest.TestCase):
    def test_history_dates_accept_only_calendar_date_or_iso_midnight(self):
        rows = [{"date": "2026-10-07T00:00:00"}, {"date": "2026-10-08 00:00:00"},
                {"date": "2026-10-06"}]
        before = [dict(row) for row in rows]
        report = astra.build_astra_report(rows, TARGET, generated_at=NOW)
        self.assertEqual(report["window_draws"], 3)
        self.assertEqual(report["training_cutoff_date"], "2026-10-08")
        self.assertEqual(rows, before, "must not sort or edit callers' records")
        for category in report["categories"].values():
            self.assertEqual(category["invalid_draws"], 3)

    def test_malformed_history_or_date_rejected_even_outside_window(self):
        invalid = (None, [], 1, "row", {}, {"date": None}, {"date": ""},
                   {"date": date(2026, 10, 8)}, {"date": "2026-02-30"},
                   {"date": "2026-9-01"}, {"date": "20260901"},
                   {"date": "2026-10-01T01:00:00"}, {"date": "2026-10-01Z"},
                   {"date": "2026-10-01T00:00:00+07:00"},
                   {"date": "２０２６-１０-０１"}, {"date": " 2026-10-01"},
                   {"date": "2026-10-01\n"}, {"date": "0000-01-01"})
        for row in invalid:
            with self.subTest(row=row):
                with self.assertRaises(astra.AstraInputError):
                    astra.build_astra_report([row], TARGET, generated_at=NOW)
        for history in (None, 12, "", "rows", {"date": "2026-10-01"}):
            with self.subTest(history=history):
                with self.assertRaises(astra.AstraInputError):
                    astra.build_astra_report(history, TARGET, generated_at=NOW)
        rows = [{"date": (NOW.date() - timedelta(days=i)).isoformat()}
                for i in range(205)]
        with self.assertRaises(astra.AstraInputError):
            astra.build_astra_report(rows + [{"date": "1900-02-30"}], TARGET,
                                     generated_at=NOW)

    def test_duplicate_dates_fail_closed_across_both_midnight_aliases(self):
        for first in ("2026-10-01", "2026-10-01 00:00:00", "2026-10-01T00:00:00"):
            for second in ("2026-10-01", "2026-10-01 00:00:00", "2026-10-01T00:00:00"):
                with self.subTest(first=first, second=second):
                    with self.assertRaises(astra.AstraInputError):
                        astra.build_astra_report([{"date": first}, {"date": second}],
                                                 TARGET, generated_at=NOW)

    def test_future_history_is_refused_including_target_and_post_target(self):
        for value in ("2026-10-09", TARGET, "2026-10-17", "2030-01-01"):
            with self.subTest(value=value):
                with self.assertRaises(astra.AstraInputError):
                    astra.build_astra_report([{"date": value}], TARGET, generated_at=NOW)

    def test_window_is_newest_200_sorted_without_mutation(self):
        rows = [{"date": (NOW.date() - timedelta(days=i)).isoformat()}
                for i in range(205)]
        rows = rows[100:] + rows[:100]
        before = [dict(row) for row in rows]
        report = astra.build_astra_report(rows, TARGET, generated_at=NOW)
        self.assertEqual(report["window_draws"], 200)
        self.assertEqual(report["training_cutoff_date"], NOW.date().isoformat())
        self.assertEqual(rows, before)
        for category in report["categories"].values():
            self.assertEqual(category["invalid_draws"], 200)
            self.assertEqual(category["valid_draws"], 0)

    def test_stale_warning_uses_generation_day_and_strict_35_day_threshold(self):
        for age in (35, 36):
            with self.subTest(age=age):
                cutoff = (NOW.date() - timedelta(days=age)).isoformat()
                report = astra.build_astra_report([{"date": cutoff}], TARGET,
                                                 generated_at=NOW)
                self.assertEqual(report["training_cutoff_date"], cutoff)
                self.assertEqual(any("35" in w for w in report["warnings"]), age > 35)


def synthetic_row(age=0):
    """A wholly invented complete draw; no cached results are consulted."""
    row = {
        "date": (NOW.date() - timedelta(days=age)).isoformat(),
        "prize1": "000001", "front3_1": "012", "front3_2": "345",
        "back3_1": "067", "back3_2": "890", "bottom2": "07",
        "prize4": " ".join(f"{n:06d}" for n in range(201, 251)),
    }
    row.update({f"prize2_{i}": f"{i:06d}" for i in range(1, 6)})
    row.update({f"prize3_{i}": f"{100+i:06d}" for i in range(1, 11)})
    return row


class CategoryValidationTests(unittest.TestCase):
    def test_all_categories_count_valid_draws_but_19_are_insufficient(self):
        rows = [synthetic_row(i) for i in range(19)]
        report = astra.build_astra_report(rows, TARGET, generated_at=NOW)
        for category in report["categories"].values():
            self.assertEqual(category["valid_draws"], 19)
            self.assertEqual(category["invalid_draws"], 0)
            self.assertEqual(category["training_cutoff_date"], NOW.date().isoformat())
            self.assertEqual(category["status"], "insufficient_data")
            self.assertEqual(category["numbers"], [])

    def test_ascii_digit_tokens_are_strict_and_category_invalids_independent(self):
        for field, category, width in (
            ("prize1", "prize1", 6), ("front3_1", "front3", 3),
            ("back3_2", "back3", 3), ("bottom2", "bottom2", 2),
            ("prize2_5", "prize2", 6), ("prize3_10", "prize3", 6),
        ):
            valid = "0" * width
            for value in (None, "", 0, 12.0, True, [], {}, "NaN", "nan", "1.0",
                          "0" * (width - 1), "0" * (width + 1), "０" * width,
                          "٠" * width, "๐" * width, " " + valid, valid + " ",
                          valid + "\n", "+" + valid[1:], valid[:-1] + "x"):
                with self.subTest(field=field, value=value):
                    latest = synthetic_row()
                    latest[field] = value
                    report = astra.build_astra_report([synthetic_row(1), latest], TARGET,
                                                     generated_at=NOW)
                    for key, result in report["categories"].items():
                        self.assertEqual(result["valid_draws"], 1 if key == category else 2)
                        self.assertEqual(result["invalid_draws"], 1 if key == category else 0)
                    self.assertEqual(report["categories"][category]["training_cutoff_date"],
                                     synthetic_row(1)["date"])

    def test_prize2_and_prize3_require_complete_unique_slot_lists(self):
        for category, count in (("prize2", 5), ("prize3", 10)):
            for slot in range(1, count + 1):
                for mode in ("missing", "duplicate"):
                    with self.subTest(category=category, slot=slot, mode=mode):
                        row = synthetic_row()
                        if mode == "missing":
                            del row[f"{category}_{slot}"]
                        else:
                            other = 1 if slot != 1 else 2
                            row[f"{category}_{slot}"] = row[f"{category}_{other}"]
                        report = astra.build_astra_report([synthetic_row(1), row], TARGET,
                                                         generated_at=NOW)
                        result = report["categories"][category]
                        self.assertEqual((result["valid_draws"], result["invalid_draws"]), (1, 1))
                        self.assertEqual(report["categories"]["prize1"]["valid_draws"], 2)

    def test_prize4_requires_exactly_50_unique_ascii_tokens(self):
        tokens = synthetic_row()["prize4"].split()
        invalid = (None, tokens, "", " ".join(tokens[:-1]),
                   " ".join(tokens + ["900001"]),
                   " ".join(tokens[:-1] + [tokens[0]]),
                   " ".join(tokens[:-1] + ["０００００１"]),
                   " ".join(tokens[:-1] + ["1.0000"]), ",".join(tokens))
        for value in invalid:
            with self.subTest(value=value):
                row = synthetic_row()
                row["prize4"] = value
                result = astra.build_astra_report([synthetic_row(1), row], TARGET,
                                                 generated_at=NOW)["categories"]
                self.assertEqual(result["prize4"]["valid_draws"], 1)
                self.assertEqual(result["prize4"]["invalid_draws"], 1)
                self.assertEqual(result["prize1"]["valid_draws"], 2)
        row = synthetic_row()
        row["prize4"] = " \t" + "\t \n".join(tokens) + "\n "
        result = astra.build_astra_report([row], TARGET, generated_at=NOW)
        self.assertEqual(result["categories"]["prize4"]["valid_draws"], 1)

    def test_official_three_digit_slots_may_repeat_without_becoming_prize1_tails(self):
        row = synthetic_row()
        row["front3_2"] = row["front3_1"]
        row["back3_2"] = row["back3_1"]
        del row["prize1"]
        result = astra.build_astra_report([row], TARGET, generated_at=NOW)["categories"]
        self.assertEqual(result["front3"]["valid_draws"], 1)
        self.assertEqual(result["back3"]["valid_draws"], 1)
        self.assertEqual(result["prize1"]["valid_draws"], 0)

    def test_last_valid_dates_are_per_category_not_raw_tail(self):
        rows = [synthetic_row(i) for i in range(4)]
        for row in rows[:3]:
            row["prize1"] = None
        for row in rows[:2]:
            row["front3_1"] = None
        for row in rows:
            row.pop("bottom2")
        result = astra.build_astra_report(list(reversed(rows)), TARGET, generated_at=NOW)
        self.assertEqual(result["training_cutoff_date"], rows[0]["date"])
        self.assertEqual(result["categories"]["prize1"]["training_cutoff_date"], rows[3]["date"])
        self.assertEqual(result["categories"]["front3"]["training_cutoff_date"], rows[2]["date"])
        self.assertIsNone(result["categories"]["bottom2"]["training_cutoff_date"])


def reference_model(draws, width):
    """Independent declarative implementation of the PRD counts and priors."""
    weighted = [(0.5 + 0.5 * 2 ** (-age / 24), numbers) for age, numbers in draws]
    total = sum(weight for weight, _ in weighted)
    counts = [[sum(weight / len(numbers) for weight, numbers in weighted
                   for number in numbers if number[j] == str(d))
               for d in range(10)] for j in range(width)]
    q = [[(count + 1) / (total + 10) for count in position] for position in counts]
    t = [[[ (sum(weight / len(numbers) for weight, numbers in weighted
                 for number in numbers if number[j - 1:j + 1] == f"{a}{b}")
             + 10 * q[j][b]) / (counts[j - 1][a] + 10)
            for b in range(10)] for a in range(10)] for j in range(1, width)]
    return {"q": q, "t": t, "total_weight": total}


class WeightedModelTests(unittest.TestCase):
    def setUp(self):
        self.assertTrue(callable(getattr(astra, "_build_model", None)),
                        "fixed weighted score model is required")

    def test_fixed_weight_prior_and_conditional_backoff_match_reference(self):
        draws = [(0, ("012",)), (24, ("345", "678")), (48, ("901",))]
        expected = reference_model(draws, 3)
        model = astra._build_model(draws, 3)
        self.assertEqual(model["total_weight"], expected["total_weight"])
        for j in range(3):
            self.assertAlmostEqual(sum(model["q"][j]), 1, places=14)
            for d in range(10):
                self.assertAlmostEqual(model["q"][j][d], expected["q"][j][d], places=14)
                self.assertGreater(model["q"][j][d], 0)
        for j in range(2):
            for a in range(10):
                self.assertAlmostEqual(sum(model["t"][j][a]), 1, places=14)
                for b in range(10):
                    self.assertAlmostEqual(model["t"][j][a][b], expected["t"][j][a][b], places=14)

    def test_sample_weight_invariant_to_result_slot_multiplicity(self):
        one = [(age, ("012345",)) for age in (0, 1, 24, 199)]
        baseline = astra._build_model(one, 6)
        for slots in (2, 5, 10, 50):
            with self.subTest(slots=slots):
                repeated = [(age, numbers * slots) for age, numbers in one]
                model = astra._build_model(repeated, 6)
                self.assertEqual(model["total_weight"], baseline["total_weight"])
                for j in range(6):
                    for d in range(10):
                        self.assertAlmostEqual(model["q"][j][d], baseline["q"][j][d], places=13)
                for j in range(5):
                    for a in range(10):
                        for b in range(10):
                            self.assertAlmostEqual(model["t"][j][a][b], baseline["t"][j][a][b], places=13)

    def test_no_observations_produce_positive_normalized_priors(self):
        model = astra._build_model([], 2)
        self.assertEqual(model["total_weight"], 0)
        self.assertEqual(model["q"], [[0.1] * 10 for _ in range(2)])
        self.assertEqual(model["t"], [[[0.1] * 10 for _ in range(10)]])


def reference_score(number, model):
    digits = [ord(d) - ord("0") for d in number]
    score = math.log(model["q"][0][digits[0]])
    for j in range(1, len(digits)):
        score += (0.5 * math.log(model["q"][j][digits[j]])
                  + 0.5 * math.log(model["t"][j - 1][digits[j - 1]][digits[j]]))
    return score


def exhaustive(model):
    candidates = ("".join(digits) for digits in product("0123456789", repeat=len(model["q"])))
    return sorted(((number, reference_score(number, model)) for number in candidates),
                  key=lambda pair: (-pair[1], pair[0]))


class ExactRankerTests(unittest.TestCase):
    def setUp(self):
        self.assertTrue(callable(getattr(astra, "_top_k", None)),
                        "exact k-best first-order ranker is required")

    def test_k_best_matches_exhaustive_full_two_and_three_digit_domains(self):
        for width in (2, 3):
            for seed in (17, 2026, 8813):
                rng = random.Random(seed)
                draws = [(age, tuple("".join(rng.choice("0123456789") for _ in range(width))
                                      for _ in range(1 + age % 5)))
                         for age in range(40)]
                model = astra._build_model(draws, width)
                all_numbers = exhaustive(model)
                self.assertEqual(len(all_numbers), 10 ** width)
                for count in (1, 2, 5, 17, 10 ** width):
                    with self.subTest(width=width, seed=seed, count=count):
                        actual = astra._top_k(model, count)
                        self.assertEqual(actual, all_numbers[:count])
                        self.assertTrue(all(math.isfinite(score) for _, score in actual))

    def test_public_report_preserves_ties_created_by_later_float_additions(self):
        # Realistic *synthetic* tier shape; no real outcome is used. These small
        # count changes make distinct prefix scores collapse at the last digit.
        replacements = {
            0: [("000000", "100005")],
            24: [("100000", "000005"), ("100001", "000006")],
            48: [("100000", "000005")],
            72: [("000000", "100005"), ("000001", "100006")],
        }
        rows = []
        for age in range(79):
            numbers = [f"{d}{j:05d}" for d in range(10) for j in range(5)]
            for old, new in replacements.get(age, []):
                numbers[numbers.index(old)] = new
            self.assertEqual(len(set(numbers)), 50)
            rows.append({"date": (NOW.date() - timedelta(days=age)).isoformat(),
                         "prize4": " ".join(numbers)})
        model = astra._build_model([(age, tuple(row["prize4"].split()))
                                    for age, row in enumerate(rows)], 6)
        # Enumerate the entire six-digit domain without retaining a million rows.
        from heapq import nsmallest
        expected = nsmallest(5, ((f"{i:06d}", reference_score(f"{i:06d}", model))
                                  for i in range(1_000_000)),
                             key=lambda item: (-item[1], item[0]))
        self.assertEqual([number for number, _ in expected],
                         ["000002", "000003", "000004", "100002", "100003"])
        self.assertEqual(len({score for _, score in expected}), 1)
        report = astra.build_astra_report(rows, TARGET, generated_at=NOW)
        category = report["categories"]["prize4"]
        self.assertEqual(category["valid_draws"], 79)
        self.assertEqual([(row["number"], row["log_score"]) for row in category["numbers"]], expected)

    def test_near_ulp_models_keep_exact_raw_score_order_against_exhaustive(self):
        for width in (3, 4):
            for seed in range(6):
                model = astra._build_model([], width)
                rng = random.Random(seed)
                for digit in range(10):
                    for _ in range(rng.randrange(12)):
                        model["q"][0][digit] = math.nextafter(model["q"][0][digit], math.inf)
                expected = exhaustive(model)
                for count in (1, 5, 17):
                    with self.subTest(width=width, seed=seed, count=count):
                        self.assertEqual(astra._top_k(model, count), expected[:count])

    def test_prefix_pruning_keeps_lexical_challenger_at_the_cutoff_score(self):
        score = -2.0
        better = math.nextafter(score, math.inf)
        # Keeping raw-score top-2 alone would drop 020. If the next addition
        # collapses all three scores, 010 and 020 (not 990) must survive.
        candidates = [("990", better), ("010", score), ("020", score)]
        retained = astra._retain_prefixes(candidates, 2, math.ulp(4.0))
        self.assertIn(("020", score), retained)
        self.assertEqual(astra._retain_prefixes(candidates, 2, 0.0),
                         [("990", better), ("010", score)])
        self.assertEqual(astra._retain_prefixes([("990", -1.0), ("010", -2.0)], 1, math.ulp(4.0)),
                         [("990", -1.0)])

    def test_exact_ties_are_string_ascending_and_preserve_leading_zeroes(self):
        for width in (2, 3, 6):
            model = astra._build_model([], width)
            actual = astra._top_k(model, 5)
            self.assertEqual([number for number, _ in actual],
                             [f"{i:0{width}d}" for i in range(5)])
            self.assertEqual(len({score for _, score in actual}), 1)
            self.assertEqual(actual, astra._top_k(model, 5))

    def test_ranking_uses_unrounded_raw_score_not_display_precision(self):
        model = astra._build_model([], 2)
        model["q"][0][1] += 1e-10
        model["q"][0][0] -= 1e-10
        expected = exhaustive(model)[:5]
        actual = astra._top_k(model, 5)
        self.assertEqual(actual, expected)
        self.assertEqual(actual[0][0], "10")
        self.assertNotEqual(actual[0][1], round(actual[0][1], 6))


class RankedReportTests(unittest.TestCase):
    def test_minimum_20_valid_draws_returns_exact_requested_wire_counts(self):
        rows = [synthetic_row(i) for i in range(20)]
        before = deepcopy(rows)
        report = astra.build_astra_report(rows, TARGET, generated_at=NOW)
        self.assertEqual(report["settings"], LOCKED_SETTINGS)
        self.assertEqual(list(report["categories"]), [c[0] for c in CATEGORY_CONTRACT])
        for key, label, width, count in CATEGORY_CONTRACT:
            category = report["categories"][key]
            self.assertEqual(category["status"], "ok")
            self.assertEqual(category["valid_draws"], 20)
            self.assertEqual(category["invalid_draws"], 0)
            self.assertEqual(category["digits"], width)
            self.assertEqual(category["requested_count"], count)
            self.assertEqual(category["label"], label)
            self.assertEqual(category["training_cutoff_date"], rows[0]["date"])
            picks = category["numbers"]
            self.assertEqual(len(picks), count)
            self.assertEqual(len({p["number"] for p in picks}), count)
            self.assertEqual([p["rank"] for p in picks], list(range(1, count + 1)))
            for pick in picks:
                self.assertEqual(set(pick), {"number", "rank", "log_score"})
                self.assertRegex(pick["number"], rf"^[0-9]{{{width}}}$")
                self.assertTrue(math.isfinite(pick["log_score"]))
            self.assertEqual(picks, sorted(picks, key=lambda p: (-p["log_score"], p["number"])))
        self.assertEqual(sum(len(c["numbers"]) for c in report["categories"].values()), 25)
        self.assertEqual(report["categories"]["prize1"]["numbers"][0]["number"], "000001")
        self.assertEqual(report["categories"]["bottom2"]["numbers"][0]["number"], "07")
        self.assertEqual(report["categories"]["front3"]["numbers"][0]["number"], "012")
        self.assertEqual(rows, before)
        self.assertEqual(json.loads(json.dumps(report, allow_nan=False)), report)
        readonly = tuple(MappingProxyType(row) for row in reversed(rows))
        self.assertEqual(astra.build_astra_report(readonly, TARGET, generated_at=NOW), report)

    def test_age_includes_category_invalid_rows_in_overall_window(self):
        rows = [synthetic_row(i) for i in range(40)]
        for i, row in enumerate(rows):
            row["bottom2"] = f"{(i * 37) % 100:02d}" if i % 2 else "bad"
        report = astra.build_astra_report(rows, TARGET, generated_at=NOW)
        category = report["categories"]["bottom2"]
        self.assertEqual(category["status"], "ok")
        self.assertEqual((category["valid_draws"], category["invalid_draws"]), (20, 20))
        draws = [(i, (row["bottom2"],)) for i, row in enumerate(rows) if i % 2]
        expected = exhaustive(reference_model(draws, 2))[0]
        self.assertEqual(category["numbers"][0]["number"], expected[0])
        self.assertAlmostEqual(category["numbers"][0]["log_score"], expected[1], places=14)
        compressed = exhaustive(reference_model([(i, nums) for i, (_, nums) in enumerate(draws)], 2))[0]
        self.assertNotEqual(expected[1], compressed[1], "fixture must detect category-local re-aging")
        self.assertEqual(category["training_cutoff_date"], rows[1]["date"])

    def test_newest_200_window_is_global_and_does_not_backfill_category_invalids(self):
        rows = [synthetic_row(i) for i in range(205)]
        for row in rows[:181]:
            row["prize1"] = None
        report = astra.build_astra_report(rows, TARGET, generated_at=NOW)
        self.assertEqual(report["window_draws"], 200)
        self.assertEqual(report["categories"]["prize1"]["valid_draws"], 19)
        self.assertEqual(report["categories"]["prize1"]["status"], "insufficient_data")
        self.assertEqual(report["categories"]["prize1"]["numbers"], [])
        self.assertEqual(len(report["categories"]["prize4"]["numbers"]), 5)
        for row in rows[200:]:
            row.update({key: "999999" for key in row if key != "date"})
        self.assertEqual(astra.build_astra_report(rows, TARGET, generated_at=NOW), report)

    def test_categories_use_own_sources_without_cross_category_diversity(self):
        rows = [synthetic_row(i) for i in range(20)]
        report = astra.build_astra_report(rows, TARGET, generated_at=NOW)
        self.assertEqual(len(report["categories"]["prize1"]["numbers"]), 5)
        source_fields = {
            "prize1": ["prize1"], "front3": ["front3_1", "front3_2"],
            "back3": ["back3_1", "back3_2"], "bottom2": ["bottom2"],
            "prize2": [f"prize2_{i}" for i in range(1, 6)],
            "prize3": [f"prize3_{i}" for i in range(1, 11)], "prize4": ["prize4"],
        }
        for changed, fields in source_fields.items():
            altered = deepcopy(rows)
            for row in altered:
                for field in fields:
                    row[field] = "malformed"
            result = astra.build_astra_report(altered, TARGET, generated_at=NOW)
            self.assertEqual(result["categories"][changed]["status"], "insufficient_data")
            for key in report["categories"]:
                if key != changed:
                    self.assertEqual(result["categories"][key], report["categories"][key])
        altered = deepcopy(rows)
        for row in altered:
            row["prize1"] = "999999"
            row["top3"] = "999"
            row["top2"] = "99"
            row["near1_1"] = "999999"
            row["prize5"] = "999999"
        result = astra.build_astra_report(altered, TARGET, generated_at=NOW)
        self.assertEqual(result["categories"]["prize1"]["numbers"][0]["number"], "999999")
        for key in report["categories"]:
            if key != "prize1":
                self.assertEqual(result["categories"][key], report["categories"][key])
        identical = deepcopy(rows)
        for row in identical:
            for i in range(1, 11):
                row[f"prize3_{i}"] = f"{i:06d}"
        result = astra.build_astra_report(identical, TARGET, generated_at=NOW)
        picks2 = {p["number"] for p in result["categories"]["prize2"]["numbers"]}
        picks3 = {p["number"] for p in result["categories"]["prize3"]["numbers"]}
        self.assertTrue(picks2 & picks3, "category overlap must not be artificially removed")

    def test_pure_inference_never_reads_files_or_connects_to_network(self):
        rows = [synthetic_row(i) for i in range(20)]
        real_import = builtins.__import__
        forbidden = {"scraper", "sanook_scraper", "analyzer", "main", "requests", "pandas"}

        def import_guard(name, *args, **kwargs):
            if name.split(".")[0] in forbidden:
                raise AssertionError(f"forbidden inference dependency: {name}")
            return real_import(name, *args, **kwargs)

        with ExitStack() as stack:
            for obj, attr in ((builtins, "open"), (io, "open"), (os, "open"),
                              (socket, "socket"), (socket, "create_connection"),
                              (socket, "getaddrinfo"), (urllib.request, "urlopen")):
                stack.enter_context(patch.object(obj, attr, side_effect=AssertionError("I/O denied")))
            stack.enter_context(patch.object(builtins, "__import__", side_effect=import_guard))
            report = astra.build_astra_report(rows, TARGET, generated_at=NOW)
            self.assertEqual(len(report["categories"]["prize1"]["numbers"]), 5)
            self.assertEqual(report, astra.build_astra_report(rows, TARGET, generated_at=NOW))


class ReadOnlyLoaderTests(unittest.TestCase):
    def setUp(self):
        self.assertTrue(callable(getattr(astra, "load_existing_astra_history", None)),
                        "dedicated read-only local CSV loader is required")
        self.temp = tempfile.TemporaryDirectory(prefix="astra-engine-test-", dir=ROOT / ".scratch")
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name)
        self.cache = self.directory / "synthetic.csv"

    def test_existing_csv_is_opened_read_only_and_preserves_all_string_values(self):
        rows = [synthetic_row(1), synthetic_row(2)]
        rows[0]["prize1"] = "000007"
        rows[1]["bottom2"] = "7.0"  # loader must not repair invalid stored tokens
        with self.cache.open("w", encoding="utf-8-sig", newline="") as stream:
            writer = csv.DictWriter(stream, fieldnames=list(rows[0]))
            writer.writeheader()
            writer.writerows(rows)
        before = self.cache.read_bytes()
        modified = self.cache.stat().st_mtime_ns
        real_open = Path.open
        accesses = []

        def read_only(path, mode="r", *args, **kwargs):
            self.assertEqual(path, self.cache)
            self.assertEqual(mode, "r")
            accesses.append((path, mode))
            return real_open(path, mode, *args, **kwargs)

        with patch.object(Path, "open", read_only), \
                patch.object(socket, "socket", side_effect=AssertionError("network denied")), \
                patch.object(urllib.request, "urlopen", side_effect=AssertionError("network denied")):
            loaded = astra.load_existing_astra_history(str(self.cache))
        self.assertEqual(loaded, rows)
        self.assertEqual(accesses, [(self.cache, "r")])
        self.assertEqual(self.cache.read_bytes(), before)
        self.assertEqual(self.cache.stat().st_mtime_ns, modified)
        self.assertEqual(list(self.directory.iterdir()), [self.cache])

    def test_default_path_is_repo_cache_but_test_never_opens_real_file(self):
        accesses = []

        def synthetic_only(path, mode="r", *args, **kwargs):
            accesses.append((path, mode))
            self.assertEqual(path, ROOT / "lottery_cache.csv")
            self.assertEqual(mode, "r")
            return io.StringIO("date,prize1\n2026-10-01,000007\n")

        with patch.object(Path, "open", synthetic_only):
            loaded = astra.load_existing_astra_history()
        self.assertEqual(loaded, [{"date": "2026-10-01", "prize1": "000007"}])
        self.assertEqual(len(accesses), 1)

    def test_missing_cache_fails_closed_without_creating_files_or_fallback(self):
        with patch.object(socket, "socket", side_effect=AssertionError("network denied")), \
                patch.object(urllib.request, "urlopen", side_effect=AssertionError("network denied")):
            with self.assertRaises(astra.AstraCacheError) as caught:
                astra.load_existing_astra_history(self.cache)
        self.assertNotIn(str(self.cache), str(caught.exception))
        self.assertFalse(self.cache.exists())
        self.assertEqual(list(self.directory.iterdir()), [])

    def test_unreadable_source_is_safe_declared_cache_error(self):
        with patch.object(Path, "open", side_effect=PermissionError("PRIVATE-SOURCE-PATH")):
            with self.assertRaises(astra.AstraCacheError) as caught:
                astra.load_existing_astra_history(self.cache)
        self.assertNotIn("PRIVATE-SOURCE-PATH", str(caught.exception))
        self.assertEqual(list(self.directory.iterdir()), [])
        with self.assertRaises(astra.AstraCacheError):
            astra.load_existing_astra_history(self.directory)
        with self.assertRaises(astra.AstraCacheError):
            astra.load_existing_astra_history("bad\x00path")

    def test_malformed_csv_is_rejected_without_changing_bytes(self):
        bad_csv = (
            b"", b"prize1\n000001\n", b"date,prize1,prize1\n2026-10-01,000001,000002\n",
            b"date,,prize1\n2026-10-01,,000001\n", b"date, prize1\n2026-10-01,000001\n",
            b"date,prize1\n2026-10-01,000001,extra\n", b"date,prize1\n2026-10-01\n",
            b'date,prize1\n2026-10-01,"000001', b'date,prize1\n2026-10-01,"000001"x\n',
            b"date,prize1\n\n", b"date,prize1\n2026-10-01,\xff\n",
            b"date,prize1\n2026-10-01,000\x001\n",
        )
        for content in bad_csv:
            with self.subTest(content=content):
                self.cache.write_bytes(content)
                with self.assertRaises(astra.AstraCacheError):
                    astra.load_existing_astra_history(self.cache)
                self.assertEqual(self.cache.read_bytes(), content)
                self.assertEqual(list(self.directory.iterdir()), [self.cache])

    def test_header_only_is_empty_history_and_invalid_results_are_not_repaired(self):
        self.cache.write_text("date,prize1\n", encoding="utf-8")
        self.assertEqual(astra.load_existing_astra_history(self.cache), [])
        content = "date,prize1\n2026-10-01,123.00\n"
        self.cache.write_text(content, encoding="utf-8")
        rows = astra.load_existing_astra_history(self.cache)
        self.assertEqual(rows[0]["prize1"], "123.00")
        report = astra.build_astra_report(rows, TARGET, generated_at=NOW)
        self.assertEqual(report["categories"]["prize1"]["invalid_draws"], 1)
        self.assertEqual(self.cache.read_text(encoding="utf-8"), content)


if __name__ == "__main__":
    unittest.main(verbosity=2)
