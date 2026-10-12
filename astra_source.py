"""Bounded source adapters for new draws. No files, inference or result repair.

Calendar contract verified from the GLO public website frontend, which posts to
/api/lottery/getLotteryMasterDataList and reads response.data date/month/year.
Sanook is the existing result provider; it is not labelled an official GLO feed.
"""
from datetime import date
import html
import json
import re
import time

import requests
import astra
from bs4 import BeautifulSoup

_MONTHS = ('มกราคม กุมภาพันธ์ มีนาคม เมษายน พฤษภาคม มิถุนายน กรกฎาคม สิงหาคม กันยายน '
           'ตุลาคม พฤศจิกายน ธันวาคม').split()
_WEEKDAYS = 'จันทร์ อังคาร พุธ พฤหัสบดี ศุกร์ เสาร์ อาทิตย์'.split()

CALENDAR_URL = "https://www.glo.or.th/api/lottery/getLotteryMasterDataList"
RESULT_BASE = "https://news.sanook.com/lotto/check/"


def _fetch(method, url):
    """Fixed-origin, credential-free, bounded single attempt; worker owns retries."""
    deadline = time.monotonic() + 25
    try:
        with requests.Session() as session:
            session.trust_env = False  # Never inherit netrc credentials or ambient auth.
            with session.request(method, url, timeout=(5, 15), stream=True,
                                 allow_redirects=False,
                                 headers={'User-Agent': 'LotteryStats-Astra/1.0'}) as response:
                if response.status_code != 200:
                    raise SourceError('source_unavailable')
                chunks, size = [], 0
                for chunk in response.iter_content(chunk_size=65536):
                    size += len(chunk)
                    if size > 2_000_000 or time.monotonic() > deadline:
                        raise SourceError('source_unavailable')
                    chunks.append(chunk)
                return b''.join(chunks).decode('utf-8')
    except (requests.RequestException, UnicodeError):
        raise SourceError('source_unavailable') from None


class OnlineSource:
    def calendar(self):
        try:
            return parse_calendar(json.loads(_fetch('POST', CALENDAR_URL)))
        except (ValueError, TypeError):
            raise SourceError('calendar_invalid') from None

    def draw(self, day):
        return parse_draw(_fetch('GET', result_url(day)), day)


class SourceError(RuntimeError):
    def __init__(self, code):
        self.code = code
        super().__init__(code)


def parse_calendar(payload):
    try:
        if (not isinstance(payload, dict) or payload.get("status") is not True
                or payload.get("statusCode") != 200):
            raise ValueError
        rows = payload["response"]["data"]
        if not isinstance(rows, list) or not 1 <= len(rows) <= 2000:
            raise ValueError
        dates = []
        for row in rows:
            parts = [row.get(key) for key in ("year", "month", "date")]
            if not all(isinstance(v, str) and re.fullmatch(r"[0-9]{%d}" % width, v)
                       for v, width in zip(parts, (4, 2, 2))):
                raise ValueError
            dates.append(date.fromisoformat("-".join(parts)))
        if len(dates) != len(set(dates)):
            raise ValueError
        return tuple(sorted(dates))
    except (KeyError, TypeError, ValueError, AttributeError):
        raise SourceError("calendar_invalid") from None


def result_url(day):
    return f"{RESULT_BASE}{day.day:02d}{day.month:02d}{day.year + 543}/"


def validate_draw(row, expected_date):
    """One invariant for both the source boundary and the cache write boundary."""
    if (not isinstance(row, dict) or row.get('date') != expected_date.isoformat()
            or any(astra._category_values(row, key, width) is None
                   for key, _, width, _ in astra._CATEGORIES)):
        raise SourceError('results_pending')
    for key, count in (('near1', 2), ('prize5', 100)):
        values = ([row.get(f'near1_{i}', '') for i in (1, 2)] if key == 'near1'
                  else row.get('prize5', '').split())
        if any(values) and (len(values) != count or len(set(values)) != count
                           or any(not isinstance(v, str) or not re.fullmatch(r'[0-9]{6}', v)
                                  for v in values)):
            raise SourceError('results_pending')
    return dict(row)


def parse_draw(document, expected_date):
    """Require page/date identity and complete sections, never truncate extras."""
    try:
        soup = BeautifulSoup(document, 'lxml')
        articles = []
        for node in soup.select('script[type="application/ld+json"]'):
            item = json.loads(node.get_text())
            if isinstance(item, dict) and item.get('@type') == 'NewsArticle':
                articles.append(item)
        if len(articles) != 1:
            raise ValueError
        article = articles[0]
        label = f'{expected_date.day} {_MONTHS[expected_date.month-1]} {expected_date.year+543}'
        if (article.get('mainEntityOfPage', {}).get('@id') != result_url(expected_date)
                or not re.search(r'(?<![0-9])'+re.escape(label)+r'(?![0-9])', article['headline'])
                or not isinstance(article.get('articleBody'), str)):
            raise ValueError
        sections, current = {}, None
        footer = ('หากท่านใดตรวจผลสลากกินแบ่งรัฐบาล แล้วถูกรางวัลสลากกินแบ่งรัฐบาล '
                  'กรุณาตรวจเช็คตัวเลขสลากกินแบ่งที่กองสลากอีกครั้งนะคะ เพื่อความถูกต้อง')
        lines = [line.strip() for line in html.unescape(article['articleBody']).splitlines() if line.strip()]
        for index, line in enumerate(lines):
            # The terminal disclaimer can wrap across lines. Accept only the
            # complete known remaining text, never arbitrary prose/extra slots.
            if line.startswith('หากท่านใดตรวจผลสลากกินแบ่งรัฐบาล'):
                if (current not in ('prize4', 'prize5')
                        or ' '.join(' '.join(lines[index:]).split()) != footer):
                    raise ValueError
                break
            key = None
            for text, field in [('ข้างเคียงรางวัลที่ 1', 'near1'), ('เลขหน้า 3 ตัว', 'front3'),
                                ('เลขท้าย 3 ตัว', 'back3'), ('เลขท้าย 2 ตัว', 'bottom2')]:
                if text in line:
                    key = field
                    break
            prize = re.search(r'รางวัลที่ ([1-5])(?![0-9])', line)
            if key is None and prize:
                key = 'prize' + prize[1]
            if key:
                if key in sections:
                    raise ValueError
                current = key
                sections[key] = []
            elif current:
                sections[current].extend(line.split())
        row = {'date': expected_date.isoformat(), 'year': str(expected_date.year),
               'month': str(expected_date.month), 'day': str(expected_date.day),
               'weekday': _WEEKDAYS[expected_date.weekday()]}
        for key, width, count in [('prize1', 6, 1), ('front3', 3, 2), ('back3', 3, 2),
                                  ('bottom2', 2, 1), ('near1', 6, 2), ('prize2', 6, 5),
                                  ('prize3', 6, 10), ('prize4', 6, 50), ('prize5', 6, 100)]:
            if key in ('near1', 'prize5') and key not in sections:
                row.update({'near1_1': '', 'near1_2': ''} if key == 'near1' else {'prize5': ''})
                continue
            values = sections.get(key, [])
            if len(values) != count or any(not re.fullmatch(r'[0-9]{%d}' % width, v) for v in values):
                raise SourceError('results_pending')
            if count == 1:
                row[key] = values[0]
            elif key in ('prize4', 'prize5'):
                row[key] = ' '.join(values)
            else:
                row.update({f'{key}_{i}': value for i, value in enumerate(values, 1)})
        row.update(top3=row['prize1'][-3:], top2=row['prize1'][-2:])
        return validate_draw(row, expected_date)
    except (ValueError, KeyError, TypeError, AttributeError):
        raise SourceError('source_invalid') from None
