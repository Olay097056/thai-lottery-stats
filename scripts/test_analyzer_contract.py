"""Deterministic analytics contract regressions using synthetic fixtures."""
from datetime import datetime
from pathlib import Path
import sys
import unittest

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import scraper
from analyzer import (
    DAY_MAP,
    alert_engine,
    consecutive_pattern,
    decade_comparison,
    digit_frequency,
    freq_table,
    heatmap_data,
    hot_cold_numbers,
    number_profile,
    number_network_data,
    overdue_numbers,
    overdue_with_prob,
    pair_analysis,
    prize1_backtest,
    prize1_digit_analysis,
    prediction_confidence,
    predict_numbers,
    predict_prize1_ultimate,
    predict_with_reasons,
    summary_stats,
    ticket_analysis,
    trend_data,
)


class AnalyzerContractTests(unittest.TestCase):
    def _repeated_number_draws(self) -> pd.DataFrame:
        years = list(range(2016, 2026))
        dates = pd.to_datetime([f"{year}-01-01" for year in years])
        repeated_years = {2016, 2021, 2025}
        values = [
            "07" if year in repeated_years else f"{year - 2016 + 10:02d}"
            for year in years
        ]
        return pd.DataFrame({
            "date": dates,
            "year": dates.year,
            "month": dates.month,
            "day": dates.day,
            "weekday": [DAY_MAP[date.weekday()] for date in dates],
            "top2": values,
        })

    def _malformed_top2_draws(self) -> pd.DataFrame:
        dates = pd.to_datetime(["2024-01-01", "2024-01-16", "2024-02-01"])
        return pd.DataFrame({
            "date": dates,
            "year": dates.year,
            "month": dates.month,
            "day": dates.day,
            "weekday": [DAY_MAP[date.weekday()] for date in dates],
            "top2": [scraper._fix_num("1.5", 2), "01", "01"],
        })

    def test_prediction_counts_and_reasons_report_observations(self):
        df = self._repeated_number_draws()
        target = datetime(2027, 1, 1)
        predictions = predict_numbers(df, "top2", target, top_n=None).set_index("เลข")
        row = predictions.loc["07"]

        self.assertEqual({
            "วัน+เดือนเดียวกัน": int(row["วัน+เดือนเดียวกัน"]),
            "วันที่เดียวกัน": int(row["วันที่เดียวกัน"]),
            "เดือนเดียวกัน": int(row["เดือนเดียวกัน"]),
            "วันศุกร์": int(row["วันศุกร์"]),
            "รวมทั้งหมด": int(row["รวมทั้งหมด"]),
        }, {
            "วัน+เดือนเดียวกัน": 3,
            "วันที่เดียวกัน": 3,
            "เดือนเดียวกัน": 3,
            "วันศุกร์": 2,
            "รวมทั้งหมด": 3,
        })

        reasons = predict_with_reasons(df, "top2", target, top_n=None).set_index("เลข")
        self.assertEqual(reasons.loc["07", "เหตุผล"], "ออกงวดนี้มาแล้ว 3 ครั้ง")

    def test_hot_cold_rates_use_only_known_field_draws(self):
        dates = pd.to_datetime([f"{year}-01-01" for year in range(2019, 2023)])
        df = pd.DataFrame({
            "date": dates,
            "top2": ["01", "02", "", ""],
        })
        rates = hot_cold_numbers(df, "top2", recent_months=100).set_index("เลข")

        self.assertEqual(float(rates.loc["01", "เฉลี่ย/งวด (ทั้งหมด)"]), 0.5)
        self.assertEqual(float(rates.loc["01", "เฉลี่ย/งวด (ล่าสุด)"]), 0.5)

    def test_overdue_draw_gap_keeps_legacy_row_denominator_for_blocked_probability_contract(self):
        dates = pd.to_datetime([f"{year}-01-01" for year in range(2019, 2023)])
        df = pd.DataFrame({
            "date": dates,
            "year": dates.year,
            "month": dates.month,
            "day": dates.day,
            "weekday": [DAY_MAP[date.weekday()] for date in dates],
            "top2": ["01", "02", "", ""],
        })

        overdue = overdue_numbers(df, "top2", top_n=100).set_index("เลข")
        predictions = predict_numbers(df, "top2", datetime(2023, 1, 1), top_n=None).set_index("เลข")
        profile = number_profile(df, "top2", "02")

        self.assertEqual(int(overdue.loc["02", "ค้างกี่งวด"]), 2)
        self.assertEqual(int(predictions.loc["02", "ค้างกี่งวด"]), 0)
        self.assertEqual(profile["overdue"], 0)

    def test_prediction_confidence_uses_known_field_sample_size(self):
        dates = pd.to_datetime([f"{year}-01-01" for year in range(2019, 2023)])
        df = pd.DataFrame({
            "date": dates,
            "year": dates.year,
            "month": dates.month,
            "day": dates.day,
            "weekday": [DAY_MAP[date.weekday()] for date in dates],
            "top2": ["01", "02", "", ""],
        })

        confidence = prediction_confidence(df, "top2", datetime(2023, 1, 1))

        self.assertEqual(confidence["n_same_day_month"], 2)
        self.assertEqual(confidence["n_same_day"], 2)
        self.assertEqual(confidence["n_same_month"], 2)

    def test_prediction_confidence_is_unavailable_without_valid_outcomes(self):
        dates = pd.to_datetime(["2024-01-01", "2024-01-16"])
        df = pd.DataFrame({
            "date": dates,
            "year": dates.year,
            "month": dates.month,
            "day": dates.day,
            "weekday": [DAY_MAP[date.weekday()] for date in dates],
            "top2": ["", "1.5"],
        })

        confidence = prediction_confidence(df, "top2", datetime(2025, 1, 1))

        self.assertEqual(confidence["n_same_day_month"], 0)
        self.assertEqual(confidence["n_same_day"], 0)
        self.assertEqual(confidence["n_same_month"], 0)
        self.assertEqual(confidence["label"], "—")
        self.assertIsNone(confidence["pct"])
        self.assertIsNone(confidence["score"])
        self.assertEqual(confidence["level"], "NO_DATA")

    def test_overdue_probability_uses_valid_sample_and_is_independent_of_gap(self):
        dates = pd.to_datetime([
            "2019-01-01", "2019-01-16", "2019-02-01", "2019-02-16", "2019-03-01"
        ])
        long_gap_df = pd.DataFrame({
            "date": dates,
            "top2": ["02", " 02 ", "01", "", "1.5"],
        })
        short_gap_df = pd.DataFrame({
            "date": dates,
            "top2": ["02", "01", "", "1.5", " 02 "],
        })

        long_gap = overdue_with_prob(long_gap_df, "top2", top_n=100).set_index("เลข")
        short_gap = overdue_with_prob(short_gap_df, "top2", top_n=100).set_index("เลข")

        self.assertEqual(int(long_gap.loc["02", "ออกทั้งหมด"]), 2)
        self.assertEqual(float(long_gap.loc["02", "โอกาสออก (%)"]), 66.67)
        self.assertEqual(float(short_gap.loc["02", "โอกาสออก (%)"]), 66.67)
        self.assertGreater(
            int(long_gap.loc["02", "ค้างกี่งวด"]),
            int(short_gap.loc["02", "ค้างกี่งวด"]),
        )
        self.assertIn("02", long_gap.index)

        no_sample_df = pd.DataFrame({
            "date": pd.to_datetime(["2024-01-01", "2024-01-16"]),
            "top2": ["", "1.5"],
        })
        no_sample = overdue_with_prob(no_sample_df, "top2")
        self.assertTrue(no_sample.empty)
        self.assertIn("โอกาสออก (%)", no_sample.columns)

    def test_overdue_numbers_returns_empty_for_unobserved_prize1(self):
        df = pd.DataFrame({
            "date": pd.to_datetime(["2022-01-01", "2022-01-16"]),
            "prize1": ["", ""],
        })

        result = overdue_numbers(df, "prize1", top_n=20)

        self.assertTrue(result.empty)
        self.assertEqual(list(result.columns), ["เลข", "ค้างกี่งวด", "ออกล่าสุด", "ออกทั้งหมด"])

    def test_overdue_numbers_returns_empty_when_field_has_no_valid_results(self):
        df = pd.DataFrame({
            "date": pd.to_datetime(["2024-01-01", "2024-01-16"]),
            "top2": ["", "1.5"],
        })

        result = overdue_numbers(df, "top2")

        self.assertTrue(result.empty)
        self.assertEqual(list(result.columns), ["เลข", "ค้างกี่งวด", "ออกล่าสุด", "ออกทั้งหมด"])

    def test_frequency_table_ignores_malformed_scraper_cells(self):
        result = freq_table(self._malformed_top2_draws(), "top2")

        self.assertEqual(result["เลข"].tolist(), ["01"])
        self.assertEqual(int(result.iloc[0]["จำนวนครั้ง"]), 2)

    def test_frequency_table_rejects_whitespace_wrapped_prize1(self):
        dates = pd.to_datetime(["2024-01-01", "2024-01-16"])
        df = pd.DataFrame({
            "date": dates,
            "prize1": [" 123456 ", "123456"],
        })

        result = freq_table(df, "prize1")

        self.assertEqual(result["เลข"].tolist(), ["123456"])
        self.assertEqual(int(result.iloc[0]["จำนวนครั้ง"]), 1)

    def test_heatmap_counts_trimmed_valid_results_and_ignores_malformed(self):
        df = pd.DataFrame({
            "top2": ["01", " 01 ", "1.5"],
        })

        heatmap = heatmap_data(df, "top2")

        self.assertEqual(int(heatmap.loc["0", "1"]), 2)

    def test_hot_cold_rates_use_only_valid_outcomes(self):
        rates = hot_cold_numbers(
            self._malformed_top2_draws(), "top2", recent_months=100
        ).set_index("เลข")

        self.assertEqual(float(rates.loc["01", "เฉลี่ย/งวด (ทั้งหมด)"].item()), 1.0)
        self.assertEqual(float(rates.loc["01", "เฉลี่ย/งวด (ล่าสุด)"].item()), 1.0)

    def test_hot_cold_does_not_call_empty_recent_sample_cold(self):
        df = pd.DataFrame({
            "date": pd.to_datetime(["2023-01-01", "2025-01-01"]),
            "top2": ["01", ""],
        })

        result = hot_cold_numbers(df, "top2", recent_months=6).set_index("เลข")

        self.assertTrue(pd.isna(result.loc["01", "เฉลี่ย/งวด (ล่าสุด)"]))
        self.assertEqual(result.loc["01", "สถานะ"], "—")

    def test_number_profile_uses_valid_outcome_sample(self):
        profile = number_profile(self._malformed_top2_draws(), "top2", "01")

        self.assertEqual(profile["total"], 2)
        self.assertEqual(profile["count"], 2)
        self.assertEqual(profile["rate"], 100.0)

    def test_number_profile_rate_is_undefined_without_observed_results(self):
        df = pd.DataFrame({
            "date": pd.to_datetime(["2024-01-01", "2024-01-16"]),
            "top2": ["", ""],
        })

        profile = number_profile(df, "top2", "01")

        self.assertIsNone(profile["count"])
        self.assertIsNone(profile["rate"])
        self.assertIsNone(profile["overdue"])

    def test_ticket_analysis_marks_empty_sample_as_unavailable(self):
        df = pd.DataFrame({
            "date": pd.to_datetime(["2024-01-01", "2024-01-16"]),
            "top2": ["", ""],
        })

        result = ticket_analysis(df, "top2", ["01"])

        self.assertEqual(result.loc[0, "ออกทั้งหมด"], "—")
        self.assertEqual(result.loc[0, "อัตรา (%)"], "—")
        self.assertEqual(result.loc[0, "ค้างกี่งวด"], "—")
        self.assertEqual(result.loc[0, "ออกล่าสุด"], "—")
        self.assertEqual(result.loc[0, "สถานะ"], "—")

    def test_prediction_confidence_excludes_malformed_outcome(self):
        confidence = prediction_confidence(
            self._malformed_top2_draws(), "top2", datetime(2024, 1, 1)
        )

        self.assertEqual(confidence["n_same_day_month"], 0)

    def test_overdue_excludes_malformed_hits_but_preserves_draw_row_gap(self):
        overdue = overdue_numbers(
            self._malformed_top2_draws(), "top2", top_n=100
        ).set_index("เลข")

        self.assertEqual(int(overdue.loc["02", "ค้างกี่งวด"]), 3)

    def test_trend_counts_trimmed_valid_results_and_ignores_malformed(self):
        df = pd.DataFrame({
            "year": [2024, 2024, 2025],
            "top2": ["01", " 01 ", "1.5"],
        })

        trend = trend_data(df, "top2", "01")

        self.assertEqual(trend.set_index("year")["ครั้ง"].to_dict(), {2024: 2, 2025: 0})

    def test_digit_frequency_uses_valid_width_only(self):
        digits = digit_frequency(self._malformed_top2_draws(), "top2")

        self.assertEqual(set(digits["ตำแหน่ง"]), {"หน่วย", "สิบ"})

    def test_summary_count_ignores_malformed_outcome(self):
        summary = summary_stats(self._malformed_top2_draws(), "top2")

        self.assertEqual(summary["total_numbers"], 2)

    def test_prediction_scores_ignore_malformed_scraper_cell(self):
        df = self._malformed_top2_draws()
        target = datetime(2024, 3, 1)
        with_malformed = predict_numbers(df, "top2", target, top_n=None).set_index("เลข")
        valid_only = predict_numbers(df.iloc[1:], "top2", target, top_n=None).set_index("เลข")

        self.assertEqual(
            with_malformed["คะแนนรวม"].to_dict(),
            valid_only["คะแนนรวม"].to_dict(),
        )

    def test_predict_numbers_does_not_trim_whitespace_wrapped_prize1(self):
        dates = pd.to_datetime(["2024-01-01", "2024-01-16"])
        df = pd.DataFrame({
            "date": dates,
            "year": dates.year,
            "month": dates.month,
            "day": dates.day,
            "weekday": [DAY_MAP[date.weekday()] for date in dates],
            "prize1": [" 123456 ", "123456"],
        })

        predictions = predict_numbers(df, "prize1", datetime(2025, 1, 1), top_n=None).set_index("เลข")

        self.assertEqual(int(predictions.loc["123456", "รวมทั้งหมด"]), 1)

    def test_predict_numbers_returns_empty_when_field_has_no_valid_results(self):
        dates = pd.to_datetime(["2024-01-01", "2024-01-16"])
        df = pd.DataFrame({
            "date": dates,
            "year": dates.year,
            "month": dates.month,
            "day": dates.day,
            "weekday": [DAY_MAP[date.weekday()] for date in dates],
            "top2": ["", "1.5"],
        })

        predictions = predict_numbers(df, "top2", datetime(2025, 1, 1), top_n=5)

        self.assertTrue(predictions.empty)

    def test_predict_numbers_trims_whitespace_around_valid_results(self):
        df = self._repeated_number_draws()
        df["top2"] = df["top2"].map(lambda value: f" {value} ")

        predictions = predict_numbers(
            df, "top2", datetime(2027, 1, 1), top_n=None
        ).set_index("เลข")

        self.assertEqual(int(predictions.loc["07", "รวมทั้งหมด"]), 3)

    def test_prize1_prediction_ignores_six_character_non_digit_values(self):
        date = pd.Timestamp("2022-01-01")
        df = pd.DataFrame({
            "date": [date],
            "year": [date.year],
            "month": [date.month],
            "day": [date.day],
            "weekday": [DAY_MAP[date.weekday()]],
            "prize1": [scraper._fix_num("12x456", 6)],
            "top3": ["456"],
        })

        result = predict_prize1_ultimate(df, datetime(2023, 1, 1), top_n=5, beam_width=10, k_back=5)

        self.assertTrue(result.empty)

    def test_prize1_prediction_rejects_whitespace_wrapped_six_digit_results(self):
        date = pd.Timestamp("2022-01-01")
        df = pd.DataFrame({
            "date": [date],
            "year": [date.year],
            "month": [date.month],
            "day": [date.day],
            "weekday": [DAY_MAP[date.weekday()]],
            "prize1": [" 123456 "],
            "top3": ["456"],
        })

        result = predict_prize1_ultimate(df, datetime(2023, 1, 1), top_n=5, beam_width=10, k_back=5)

        self.assertTrue(result.empty)

    def test_prize1_backtest_excludes_malformed_six_character_outcomes(self):
        dates = pd.date_range("2019-01-01", periods=81, freq="D")
        df = pd.DataFrame({
            "date": dates,
            "prize1": [""] * 80 + [scraper._fix_num("12x456", 6)],
        })

        result = prize1_backtest(df, n_draws=10, top_n=5, beam_width=10, k_back=5)

        self.assertEqual(result["n_tested"], 0)

    def test_prize1_backtest_excludes_whitespace_wrapped_six_digit_outcomes(self):
        dates = pd.date_range("2019-01-01", periods=81, freq="D")
        df = pd.DataFrame({
            "date": dates,
            "prize1": [""] * 80 + [" 123456 "],
        })

        result = prize1_backtest(df, n_draws=10, top_n=5, beam_width=10, k_back=5)

        self.assertEqual(result["n_tested"], 0)

    def test_prize1_digit_analysis_marks_missing_day_month_sample_unavailable(self):
        dates = pd.to_datetime(["2024-01-01", "2024-02-01"])
        df = pd.DataFrame({
            "date": dates,
            "year": dates.year,
            "month": dates.month,
            "day": dates.day,
            "weekday": [DAY_MAP[date.weekday()] for date in dates],
            "prize1": ["123456", "654321"],
        })

        result = prize1_digit_analysis(df, datetime(2025, 3, 16))

        self.assertEqual(len(result), 60)
        self.assertTrue((result["สถานะ"] == "—").all())

    def test_prize1_digit_analysis_rejects_whitespace_wrapped_results(self):
        date = pd.Timestamp("2024-01-01")
        df = pd.DataFrame({
            "date": [date],
            "year": [date.year],
            "month": [date.month],
            "day": [date.day],
            "weekday": [DAY_MAP[date.weekday()]],
            "prize1": [" 123456 "],
        })

        result = prize1_digit_analysis(df, datetime(2025, 1, 1))

        self.assertTrue(result.empty)

    def test_pair_and_network_analytics_exclude_malformed_values(self):
        dates = pd.to_datetime(["2024-01-01", "2024-01-16", "2024-02-01"])
        df = pd.DataFrame({
            "date": dates,
            "year": dates.year,
            "top2": ["01", "01", scraper._fix_num("2.5", 2)],
            "top3": ["100", scraper._fix_num("2.5", 3), "200"],
        })

        paired = pair_analysis(df, "top2", "top3", "01")
        _, edges = number_network_data(df, "top2", "top3", min_weight=1)

        self.assertEqual(paired["เลข"].tolist(), ["100"])
        self.assertEqual(
            set(map(tuple, edges[["a", "b"]].to_numpy().tolist())),
            {("01", "100")},
        )

    def test_consecutive_analysis_breaks_at_malformed_draws(self):
        dates = pd.to_datetime(["2024-01-01", "2024-01-16", "2024-02-01"])
        df = pd.DataFrame({
            "date": dates,
            "top2": ["02", scraper._fix_num("1.5", 2), "01"],
        })

        result = consecutive_pattern(df, "top2", query_num="02")

        self.assertTrue(result.empty)

    def test_decade_comparison_excludes_malformed_values(self):
        dates = pd.to_datetime(["2024-01-01", "2024-01-16", "2024-02-01"])
        df = pd.DataFrame({
            "date": dates,
            "year": dates.year,
            "top2": ["01", "02", scraper._fix_num("2.5", 2)],
        })

        result = decade_comparison(df, "top2", top_n=10)

        self.assertNotIn("2.5", result["เลข"].tolist())

    def test_decade_comparison_returns_schema_when_no_valid_results(self):
        df = pd.DataFrame({"year": [2019, 2020], "top2": ["1.5", ""]})

        result = decade_comparison(df, "top2", top_n=5)

        self.assertTrue(result.empty)
        self.assertEqual(list(result.columns), ["เลข", "1994–2004", "2005–2014", "2015–2020", "รวม"])

    def test_prediction_reason_badge_uses_valid_field_denominator(self):
        dates = pd.date_range("2024-01-01", periods=25, freq="D")
        values = [scraper._fix_num("1.5", 2), "01"] + ["02"] * 23
        df = pd.DataFrame({
            "date": dates,
            "year": dates.year,
            "month": dates.month,
            "day": dates.day,
            "weekday": [DAY_MAP[date.weekday()] for date in dates],
            "top2": values,
        })

        with_malformed = predict_with_reasons(df, "top2", datetime(2025, 1, 1), top_n=None).set_index("เลข")
        valid_only = predict_with_reasons(df.iloc[1:], "top2", datetime(2025, 1, 1), top_n=None).set_index("เลข")

        self.assertEqual(with_malformed.loc["01", "สถานะ"], valid_only.loc["01", "สถานะ"])

    def test_alert_engine_does_not_bridge_missing_draw_for_consecutive_alert(self):
        dates = pd.to_datetime(["2024-01-01", "2024-01-02", "2024-01-03"])
        df = pd.DataFrame({"date": dates, "top2": ["01", "1.5", "01"]})

        messages = [alert["ข้อความ"] for alert in alert_engine(df, "top2")]

        self.assertIn("ออกงวดล่าสุด (03/01/2024)", messages)
        self.assertNotIn("ออกติดต่อกัน 2 งวด!", messages)

    def test_alert_engine_uses_known_field_draws_for_overdue_threshold(self):
        valid_dates = pd.date_range("2024-01-01", periods=20, freq="D")
        valid_df = pd.DataFrame({
            "date": valid_dates,
            "top2": ["01"] * 3 + ["02"] * 17,
        })
        malformed_row = pd.DataFrame({
            "date": [pd.Timestamp("2023-12-31")],
            "top2": [scraper._fix_num("1.5", 2)],
        })
        with_malformed = pd.concat([malformed_row, valid_df], ignore_index=True)

        valid_alerts = alert_engine(valid_df, "top2")
        malformed_alerts = alert_engine(with_malformed, "top2")
        overdue_01 = lambda alerts: any(
            alert["เลข"] == "01" and alert["ข้อความ"].startswith("ค้างนาน")
            for alert in alerts
        )

        self.assertTrue(overdue_01(valid_alerts))
        self.assertEqual(overdue_01(malformed_alerts), overdue_01(valid_alerts))


if __name__ == "__main__":
    unittest.main()
