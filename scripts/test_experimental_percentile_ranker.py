"""Synthetic-only regressions for the experimental percentile candidate."""
from copy import deepcopy
import unittest

from experimental_percentile_ranker import (
    CANDIDATE_ID,
    COMPONENT_COUNT,
    rank_equal_signal_percentiles,
)


def candidate(number, first, second, lag_factor=1.0):
    return {
        "number": number,
        "components": [first, second, *([0.5] * (COMPONENT_COUNT - 2))],
        "lag_factor": lag_factor,
    }


def full_candidate_domain(width=2):
    return [
        {
            "number": f"{number:0{width}d}",
            "components": [0.5] * COMPONENT_COUNT,
            "lag_factor": 1.0,
        }
        for number in range(10**width)
    ]


class ExperimentalPercentileRankerTests(unittest.TestCase):
    def test_known_midrank_ensemble_orders_candidates_and_preserves_zeroes(self):
        rows = full_candidate_domain()
        by_number = {row["number"]: row for row in rows}
        by_number["07"]["components"][0] = 1.0
        by_number["20"]["components"][1] = 1.0

        ranked = rank_equal_signal_percentiles(rows)

        self.assertEqual(CANDIDATE_ID, "equal-signal-percentile-v1")
        self.assertEqual([row["number"] for row in ranked[:2]], ["07", "20"])
        scores = {row["number"]: row["score"] for row in ranked}
        self.assertAlmostEqual(scores["07"], (4.5 + 49 / 99) / 9)
        self.assertAlmostEqual(scores["20"], (4.5 + 49 / 99) / 9)
        self.assertAlmostEqual(scores["99"], (3.5 + 98 / 99) / 9)

    def test_positive_rescaling_of_one_signal_does_not_change_candidate_ranking(self):
        rows = full_candidate_domain()
        by_number = {row["number"]: row for row in rows}
        by_number["07"]["components"][0] = 1.0
        by_number["20"]["components"][1] = 1.0
        rescaled = deepcopy(rows)
        for row in rescaled:
            row["components"][0] *= 10000

        original_ranked = rank_equal_signal_percentiles(rows)
        rescaled_ranked = rank_equal_signal_percentiles(rescaled)

        self.assertEqual(
            [row["number"] for row in original_ranked],
            [row["number"] for row in rescaled_ranked],
        )
        for original, scaled in zip(original_ranked, rescaled_ranked):
            self.assertAlmostEqual(original["score"], scaled["score"])

    def test_component_ties_use_average_rank_and_final_ties_use_token_order(self):
        rows = full_candidate_domain()

        ranked = rank_equal_signal_percentiles(rows)

        self.assertEqual([row["number"] for row in ranked[:3]], ["00", "01", "02"])
        self.assertTrue(all(row["score"] == 0.5 for row in ranked))

    def test_fixed_lag_factor_is_applied_after_signal_percentile_average(self):
        rows = full_candidate_domain()
        rows[7]["lag_factor"] = 0.65

        ranked = rank_equal_signal_percentiles(rows)

        self.assertEqual(ranked[0]["number"], "00")
        self.assertEqual(ranked[-1]["number"], "07")
        self.assertAlmostEqual(ranked[-1]["score"], 0.325)

    def test_accepts_the_complete_three_digit_domain_without_losing_leading_zeroes(self):
        ranked = rank_equal_signal_percentiles(full_candidate_domain(width=3))

        self.assertEqual(len(ranked), 1000)
        self.assertEqual(ranked[7]["number"], "007")
        self.assertEqual(ranked[7]["rank"], 8)

    def test_rejects_a_partial_candidate_domain(self):
        partial = [candidate("07", 1.0, 0.5), candidate("20", 0.5, 1.0)]

        with self.assertRaisesRegex(ValueError, "complete 2-digit candidate domain"):
            rank_equal_signal_percentiles(partial)

    def test_rejects_duplicate_tokens_wrong_component_count_and_nonfinite_values(self):
        duplicate = [candidate("007", 1.0, 1.0), candidate("007", 0.0, 0.0)]
        with self.assertRaisesRegex(ValueError, "unique"):
            rank_equal_signal_percentiles(duplicate)

        wrong_width = [
            {"number": "007", "components": [0.1], "lag_factor": 1.0},
            {"number": "120", "components": [0.2], "lag_factor": 1.0},
        ]
        with self.assertRaisesRegex(ValueError, "component"):
            rank_equal_signal_percentiles(wrong_width)

        nonfinite = [candidate("007", float("nan"), 1.0), candidate("120", 0.0, 0.0)]
        with self.assertRaisesRegex(ValueError, "finite"):
            rank_equal_signal_percentiles(nonfinite)

    def test_rejects_bad_number_tokens_invalid_lag_and_single_candidate(self):
        bad_number = [candidate("7", 1.0, 1.0), candidate("120", 0.0, 0.0)]
        with self.assertRaisesRegex(ValueError, "2/3-digit string"):
            rank_equal_signal_percentiles(bad_number)

        bad_lag = [candidate("007", 1.0, 1.0, lag_factor=1.1), candidate("120", 0.0, 0.0)]
        with self.assertRaisesRegex(ValueError, "lag_factor"):
            rank_equal_signal_percentiles(bad_lag)

        with self.assertRaisesRegex(ValueError, "at least two"):
            rank_equal_signal_percentiles([candidate("007", 1.0, 1.0)])

    def test_does_not_mutate_the_frozen_component_rows(self):
        rows = full_candidate_domain()
        before = deepcopy(rows)

        rank_equal_signal_percentiles(rows)

        self.assertEqual(rows, before)


if __name__ == "__main__":
    unittest.main()
