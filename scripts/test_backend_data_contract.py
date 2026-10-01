import os
import sys
import tempfile
import unittest
from unittest.mock import patch
from pathlib import Path
from datetime import datetime

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import scraper
import pandas as pd
import main
import enrich_from_sanook
import watchlist


def scratch_tempdir():
    base = Path(os.environ.get("LOCALAPPDATA") or Path.home() / ".cache")
    scratch = base / "hermes" / "cache" / "scratch"
    scratch.mkdir(parents=True, exist_ok=True)
    return tempfile.TemporaryDirectory(dir=scratch)


class ScraperNumberNormalizationTests(unittest.TestCase):
    def test_fractional_value_is_not_truncated_into_a_valid_lottery_number(self):
        self.assertEqual(scraper._fix_num("3.0", 3), "003")
        self.assertEqual(scraper._fix_num("1.5", 3), "1.5")


class ApiSummaryDateTests(unittest.TestCase):
    def test_latest_date_is_iso_day_without_midnight_time(self):
        df = pd.DataFrame([{
            "date": pd.Timestamp("2026-09-01"),
            "prize1": "123456",
            "top3": "456",
            "top2": "56",
            "front3_1": "111",
            "front3_2": "222",
            "back3_1": "333",
            "back3_2": "444",
            "bottom2": "55",
        }])
        with patch.object(main, "get_df", return_value=df), \
             patch.object(main, "hot_cold_numbers", return_value=pd.DataFrame()), \
             patch.object(main, "get_cache_info", return_value={}):
            response = main.api_summary()
        self.assertEqual(response["latest"]["date"], "2026-09-01")


class IncrementalUpdateTests(unittest.TestCase):
    def test_partial_rescrape_preserves_older_cached_draws_in_the_same_year(self):
        def draw(date, prize1):
            return {
                "date": date,
                "year": date.year,
                "month": date.month,
                "day": date.day,
                "weekday": "อังคาร",
                "prize1": prize1,
                "top3": prize1[-3:],
                "top2": prize1[-2:],
                "front3_1": "111",
                "front3_2": "222",
                "back3_1": "333",
                "back3_2": "444",
                "bottom2": "55",
            }

        class FixedDateTime(datetime):
            @classmethod
            def now(cls, tz=None):
                return cls(2026, 10, 1)

        original_draws = [
            draw(datetime(2026, 1, 16), "123456"),
            draw(datetime(2026, 6, 16), "654321"),
        ]
        partial_rescrape = [draw(datetime(2026, 6, 16), "999999")]

        with scratch_tempdir() as temp_dir:
            cache_file = Path(temp_dir) / "lottery_cache.csv"
            pd.DataFrame(original_draws).to_csv(cache_file, index=False)
            with patch.object(scraper, "CACHE_FILE", cache_file), \
                 patch.object(scraper, "datetime", FixedDateTime), \
                 patch.object(scraper, "scrape_year", return_value=partial_rescrape), \
                 patch.object(scraper.time, "sleep", return_value=None), \
                 patch("sanook_scraper.scrape_draw", return_value=None):
                merged = scraper.incremental_update()

        dates = sorted(pd.to_datetime(merged["date"]).dt.strftime("%Y-%m-%d"))
        self.assertEqual(dates, ["2026-01-16", "2026-06-16"])
        june_prize = merged.loc[merged["date"] == pd.Timestamp("2026-06-16"), "prize1"].iloc[0]
        self.assertEqual(june_prize, "999999")

    def test_partial_scrape_preserves_existing_enrichment_for_returned_date(self):
        old_draw = {
            "date": datetime(2026, 6, 16),
            "year": 2026,
            "month": 6,
            "day": 16,
            "weekday": "อังคาร",
            "prize1": "654321",
            "top3": "321",
            "top2": "21",
            "front3_1": "111",
            "front3_2": "222",
            "back3_1": "333",
            "back3_2": "444",
            "bottom2": "55",
            "prize2_1": "112233",
        }
        new_draw = {key: value for key, value in old_draw.items() if key != "prize2_1"}
        new_draw.update(prize1="999999", top3="999", top2="99")

        class FixedDateTime(datetime):
            @classmethod
            def now(cls, tz=None):
                return cls(2026, 10, 1)

        with scratch_tempdir() as temp_dir:
            cache_file = Path(temp_dir) / "lottery_cache.csv"
            pd.DataFrame([old_draw]).to_csv(cache_file, index=False)
            with patch.object(scraper, "CACHE_FILE", cache_file), \
                 patch.object(scraper, "datetime", FixedDateTime), \
                 patch.object(scraper, "scrape_year", return_value=[new_draw]), \
                 patch.object(scraper.time, "sleep", return_value=None), \
                 patch("sanook_scraper.scrape_draw", return_value=None):
                merged = scraper.incremental_update()

        row = merged.loc[merged["date"] == pd.Timestamp("2026-06-16")].iloc[0]
        self.assertEqual(row["prize1"], "999999")
        self.assertEqual(row["prize2_1"], "112233")


class SanookBackfillTests(unittest.TestCase):
    def test_resume_retries_rows_with_any_missing_enrichment_field(self):
        row = {"date": "2026-06-16"}
        row.update({col: "123456" for col in enrich_from_sanook.ENRICH_COLS})
        row["near1_2"] = ""
        response = {col: "654321" for col in enrich_from_sanook.ENRICH_COLS}

        with scratch_tempdir() as temp_dir:
            cache_file = Path(temp_dir) / "lottery_cache.csv"
            pd.DataFrame([row]).to_csv(cache_file, index=False)
            with patch.object(enrich_from_sanook, "CACHE_FILE", cache_file), \
                 patch.object(enrich_from_sanook, "scrape_draw", return_value=response) as scrape, \
                 patch("time.sleep", return_value=None):
                enrich_from_sanook.run(resume=True, delay=0)

            updated = pd.read_csv(cache_file, dtype=str).iloc[0]
        scrape.assert_called_once()
        self.assertEqual(updated["near1_2"], "654321")

    def test_partial_response_does_not_clear_existing_enrichment(self):
        row = {"date": "2026-06-16"}
        row.update({col: "123456" for col in enrich_from_sanook.ENRICH_COLS})
        row["prize4"] = "123456 234567"
        row["prize5"] = "345678 456789"
        partial_response = {"near1_1": "654321"}

        with scratch_tempdir() as temp_dir:
            cache_file = Path(temp_dir) / "lottery_cache.csv"
            pd.DataFrame([row]).to_csv(cache_file, index=False)
            with patch.object(enrich_from_sanook, "CACHE_FILE", cache_file), \
                 patch.object(enrich_from_sanook, "scrape_draw", return_value=partial_response), \
                 patch("time.sleep", return_value=None):
                enrich_from_sanook.run(resume=False, delay=0)

            updated = pd.read_csv(cache_file, dtype=str).iloc[0]
        self.assertEqual(updated["near1_1"], "654321")
        self.assertEqual(updated["prize2_1"], "123456")
        self.assertEqual(updated["prize4"], "123456 234567")


class WatchlistPersistenceTests(unittest.TestCase):
    def test_add_api_does_not_claim_success_when_persistence_fails(self):
        with scratch_tempdir() as temp_dir:
            failing_path = Path(temp_dir) / "missing" / "watchlist.json"
            with patch.object(watchlist, "WATCHLIST_FILE", failing_path):
                with self.assertRaises(main.HTTPException) as error:
                    main.api_add_watchlist(main.WatchlistItem(col="top3", number="123"))
        self.assertEqual(error.exception.status_code, 500)

    def test_remove_api_does_not_claim_success_when_persistence_fails(self):
        with scratch_tempdir() as temp_dir:
            failing_path = Path(temp_dir) / "missing" / "watchlist.json"
            with patch.object(watchlist, "WATCHLIST_FILE", failing_path), \
                 patch.object(watchlist, "load_watchlist", return_value={"top3": ["123"]}):
                with self.assertRaises(main.HTTPException) as error:
                    main.api_remove_watchlist(col="top3", number="123")
        self.assertEqual(error.exception.status_code, 500)

    def test_corrupt_watchlist_is_reported_instead_of_becoming_empty(self):
        with scratch_tempdir() as temp_dir:
            corrupt_file = Path(temp_dir) / "watchlist.json"
            corrupt_file.write_text("{not json", encoding="utf-8")
            with patch.object(main, "get_df", return_value=pd.DataFrame()), \
                 patch.object(watchlist, "WATCHLIST_FILE", corrupt_file):
                with self.assertRaises(main.HTTPException) as error:
                    main.api_get_watchlist(col="top3")

            self.assertEqual(corrupt_file.read_text(encoding="utf-8"), "{not json")
        self.assertEqual(error.exception.status_code, 500)


if __name__ == "__main__":
    unittest.main(verbosity=2)
