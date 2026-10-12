"""Offline HTTP/parser tests; all dates and prize values below are synthetic."""
import importlib
import importlib.util
from datetime import date
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def calendar_payload(*dates):
    return {"status": True, "statusCode": 200, "response": {"data": [
        {"year": str(d.year), "month": f"{d.month:02d}", "date": f"{d.day:02d}"}
        for d in dates
    ]}}


class CalendarTests(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(importlib.util.find_spec("astra_source"), "missing astra source adapter")
        self.source = importlib.import_module("astra_source")

    def test_official_dates_are_sorted_without_guessing_normal_days(self):
        payload = calendar_payload(date(2027, 1, 17), date(2027, 1, 2), date(2026, 12, 30))
        self.assertEqual(self.source.parse_calendar(payload),
                         (date(2026, 12, 30), date(2027, 1, 2), date(2027, 1, 17)))
        self.assertEqual(payload["response"]["data"][0]["date"], "17")

    def test_malformed_alias_duplicate_and_failed_envelopes_fail_closed(self):
        good = calendar_payload(date(2026, 10, 16))
        import copy
        bad_values = [None, [], {}, {**good, "status": False}, {**good, "status": 1},
                      calendar_payload(), calendar_payload(date(2026, 10, 16), date(2026, 10, 16))]
        for key, value in [("year", 2026), ("date", "1"), ("month", "13"), ("date", "32"),
                           ("year", "２０２６"), ("date", "16 ")]:
            payload = copy.deepcopy(good)
            payload["response"]["data"][0][key] = value
            bad_values.append(payload)
        for value in bad_values:
            with self.subTest(value=value), self.assertRaises(self.source.SourceError):
                self.source.parse_calendar(value)


class DrawParserTests(unittest.TestCase):
    def setUp(self):
        import astra_source
        from scripts import astra_auto_fixtures as fixtures
        self.source, self.fixtures = astra_source, fixtures
        self.assertTrue(callable(getattr(astra_source, 'parse_draw', None)), 'missing strict draw parser')

    def test_complete_new_draw_preserves_zeroes_and_all_prize_fields(self):
        row = self.fixtures.draw()
        parsed = self.source.parse_draw(self.fixtures.page(row), date(2026, 10, 1))
        for key, value in row.items():
            self.assertEqual(parsed[key], value, key)

    def test_missing_extra_duplicate_unicode_and_truncated_slots_are_not_repaired(self):
        row = self.fixtures.draw()
        for key, value in [('prize1', '123'), ('bottom2', '０５'), ('prize2_5', row['prize2_1']),
                           ('prize4', row['prize4'] + ' 999999'), ('prize4', ' '.join(row['prize4'].split()[:-1])),
                           ('prize5', row['prize5'] + ' 999999'), ('front3_2', 'pending'),
                           ('back3_1', '3.0')]:
            bad = {**row, key: value}
            with self.subTest(key=key, value=value[:20]), self.assertRaises(self.source.SourceError):
                self.source.parse_draw(self.fixtures.page(bad), date(2026, 10, 1))

    def test_terminal_publisher_disclaimer_is_not_a_prize_or_a_truncation_escape(self):
        # Public publisher prose only; the prize values remain synthetic.
        footer = ('หากท่านใดตรวจผลสลากกินแบ่งรัฐบาล แล้วถูกรางวัลสลากกินแบ่งรัฐบาล '
                  'กรุณาตรวจเช็คตัวเลขสลากกินแบ่งที่กองสลากอีกครั้งนะคะ เพื่อความถูกต้อง')
        row = self.fixtures.draw()
        body = self.fixtures.body(row)
        for wrapped in [footer, footer.replace(' กรุณา', '\nกรุณา')]:
            parsed = self.source.parse_draw(self.fixtures.page(row, article_body=body+'\n'+wrapped),
                                            date(2026, 10, 1))
            self.assertEqual(parsed, row)
        for bad in [body+'\n999999\n'+footer, body+'\n'+footer+'\n999999',
                    body+'\n'+footer+' arbitrary', footer+'\n'+body,
                    self.fixtures.body({**row, 'prize5': ' '.join(row['prize5'].split()[:-1])})+'\n'+footer]:
            with self.subTest(body=bad[-40:]), self.assertRaises(self.source.SourceError):
                self.source.parse_draw(self.fixtures.page(row, article_body=bad), date(2026, 10, 1))

    def test_absent_optional_additional_prizes_do_not_block_complete_astra_categories(self):
        row = self.fixtures.draw()
        lines = self.fixtures.body(row).splitlines()
        pairs = [lines[i:i+2] for i in range(0, len(lines), 2)]
        body = '\n'.join(line for pair in pairs for line in pair
                         if 'ข้างเคียง' not in pair[0] and 'รางวัลที่ 5' not in pair[0])
        parsed = self.source.parse_draw(self.fixtures.page(row, article_body=body), date(2026, 10, 1))
        self.assertEqual(parsed['prize1'], '000123')
        self.assertEqual(parsed['prize4'], row['prize4'])
        self.assertEqual(parsed['near1_1'], '')
        self.assertEqual(parsed['near1_2'], '')
        self.assertEqual(parsed['prize5'], '')

    def test_wrong_page_identity_duplicate_articles_and_repeated_sections_fail_closed(self):
        row = self.fixtures.draw()
        pages = [self.fixtures.page(row, url='https://news.sanook.com/lotto/'),
                 self.fixtures.page(row).replace('1 ตุลาคม 2569', '16 กันยายน 2569'),
                 self.fixtures.page(row) * 2,
                 self.fixtures.page(row, article_body=self.fixtures.body(row)+'\nรางวัลที่ 1\n111111'),
                 '<html>not published</html>']
        for page in pages:
            with self.subTest(page=page[:50]), self.assertRaises(self.source.SourceError):
                self.source.parse_draw(page, date(2026, 10, 1))


class HttpTests(unittest.TestCase):
    def setUp(self):
        import astra_source
        from scripts import astra_auto_fixtures as fixtures
        self.source, self.fixtures = astra_source, fixtures
        self.assertTrue(callable(getattr(astra_source, 'OnlineSource', None)), 'missing bounded transport')

    def response(self, content, status=200):
        from unittest.mock import MagicMock
        response = MagicMock()
        response.status_code = status
        response.__enter__.return_value = response
        response.headers = {}
        response.iter_content.return_value = [content.encode('utf-8')]
        return response

    def test_real_transport_parses_calendar_and_correct_draw_without_redirects(self):
        from unittest.mock import patch
        import json
        payload = calendar_payload(date(2026, 10, 1), date(2026, 10, 16))
        with patch('requests.sessions.Session.request', side_effect=[
            self.response(json.dumps(payload)), self.response(self.fixtures.page(self.fixtures.draw()))
        ]) as transport:
            source = self.source.OnlineSource()
            self.assertEqual(source.calendar(), (date(2026, 10, 1), date(2026, 10, 16)))
            self.assertEqual(source.draw(date(2026, 10, 1))['prize1'], '000123')
        self.assertEqual(transport.call_count, 2)
        self.assertEqual(transport.call_args_list[0].args[:2], ('POST', self.source.CALENDAR_URL))
        self.assertEqual(transport.call_args_list[1].args[:2], ('GET', self.source.result_url(date(2026, 10, 1))))
        for call in transport.call_args_list:
            self.assertFalse(call.kwargs['allow_redirects'])
            self.assertEqual(call.kwargs['timeout'], (5, 15))
            self.assertTrue(call.kwargs['stream'])

    def test_errors_oversize_and_redirects_fail_without_retries_or_raw_details(self):
        from unittest.mock import patch
        import requests
        for response in [self.response('', 302), self.response('', 404), self.response('', 500),
                         self.response('x' * (2_000_001)), self.response('{invalid')]:
            with self.subTest(status=response.status_code), patch('requests.sessions.Session.request', return_value=response) as transport:
                with self.assertRaises(self.source.SourceError):
                    self.source.OnlineSource().calendar()
                self.assertEqual(transport.call_count, 1)
        with patch('requests.sessions.Session.request', side_effect=requests.Timeout('private-address')) as transport:
            with self.assertRaises(self.source.SourceError) as error:
                self.source.OnlineSource().calendar()
            self.assertNotIn('private-address', str(error.exception))
            self.assertEqual(transport.call_count, 1)


if __name__ == "__main__":
    unittest.main(verbosity=2)
