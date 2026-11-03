"""Read-only cache health and report provenance; no scoring or refresh."""
from __future__ import annotations

import csv
import hashlib
import io
import re
from collections import Counter
from datetime import date, datetime
from pathlib import Path
from zoneinfo import ZoneInfo

CATEGORIES = (
    ('prize1', 'รางวัลที่ 1', 6, 1), ('front3', 'เลขหน้า 3 ตัว', 3, 2),
    ('back3', 'เลขท้าย 3 ตัว', 3, 2), ('bottom2', 'เลขท้าย 2 ตัว', 2, 1),
    ('near1', 'ข้างเคียงรางวัลที่ 1', 6, 2), ('prize2', 'รางวัลที่ 2', 6, 5),
    ('prize3', 'รางวัลที่ 3', 6, 10), ('prize4', 'รางวัลที่ 4', 6, 50),
    ('prize5', 'รางวัลที่ 5', 6, 100),
)


def canonical_history_date(value):
    if not isinstance(value, str) or not re.fullmatch(r'[0-9]{4}-[0-9]{2}-[0-9]{2}(?:[ T]00:00:00)?', value):
        return None
    try:
        return date.fromisoformat(value[:10])
    except ValueError:
        return None


def valid_category(row, key, digits, slots):
    if slots == 1:
        values = [row.get(key, '')]
    elif key in ('prize4', 'prize5'):
        values = row.get(key, '').split()
    else:
        values = [row.get(f'{key}_{i}', '') for i in range(1, slots + 1)]
    return (len(values) == slots and
            all(re.fullmatch(rf'[0-9]{{{digits}}}', value) for value in values) and
            (key in ('front3', 'back3') or len(set(values)) == len(values)))


def cache_health(rows, *, checked_at, data_version=None):
    today = checked_at.astimezone(ZoneInfo('Asia/Bangkok')).date()
    dated = [(row, canonical_history_date(row.get('date'))) for row in rows]
    counts = Counter(day for _, day in dated if day is not None)
    eligible = [(row, day) for row, day in dated if day is not None and day <= today and counts[day] == 1]
    latest = max((day for _, day in eligible), default=None)
    categories = []
    for key, label, digits, slots in CATEGORIES:
        valid = [(row, day) for row, day in eligible if valid_category(row, key, digits, slots)]
        cutoff = max((day for _, day in valid), default=None)
        categories.append(dict(key=key, label=label, valid_draws=len(valid),
                               unavailable_draws=len(eligible)-len(valid),
                               latest_valid_date=cutoff.isoformat() if cutoff else None,
                               latest_draw_complete=bool(latest and any(day == latest for _, day in valid))))
    invalid_dates = len(rows)-len(eligible)
    stale = latest is not None and (today-latest).days > 35
    return dict(schema_version=1, source='existing_local_cache', checked_at=checked_at.isoformat(),
                data_version=data_version, total_rows=len(rows), valid_dated_draws=len(eligible),
                rejected_date_rows=invalid_dates, latest_draw_date=latest.isoformat() if latest else None,
                stale=stale, stale_after_days=35, categories=categories,
                state='empty' if latest is None else 'warning' if stale or invalid_dates or
                any(not category['latest_draw_complete'] for category in categories) else 'ready')


def read_cache_health(path: Path, checked_at=None):
    content = path.read_bytes()
    reader = csv.reader(io.StringIO(content.decode('utf-8-sig')), strict=True)
    header = next(reader, None)
    if not header or 'date' not in header or len(set(header)) != len(header) or any(not k or k != k.strip() for k in header):
        raise ValueError('Invalid cache header')
    rows = []
    for values in reader:
        if len(values) != len(header) or any('\x00' in value for value in values):
            raise ValueError('Invalid cache row')
        rows.append(dict(zip(header, values)))
    return cache_health(rows, checked_at=checked_at or datetime.now(ZoneInfo('Asia/Bangkok')),
                        data_version=hashlib.sha256(content).hexdigest())


def prediction_provenance(df, target):
    eligible = df[df['date'] < target].sort_values('date')
    return dict(schema_version=1, method='statistical', engine_version='statistical-v1',
                engine_sha256=hashlib.sha256(Path(__file__).with_name('analyzer.py').read_bytes()).hexdigest(),
                generated_at=datetime.now(ZoneInfo('Asia/Bangkok')).isoformat(),
                target_date=target.strftime('%Y-%m-%d'), source='loaded_history',
                history_cutoff=eligible['date'].max().strftime('%Y-%m-%d') if not eligible.empty else None,
                input_draws=len(eligible),
                data_version=hashlib.sha256(eligible.to_csv(index=False).encode('utf-8')).hexdigest(),
                data_version_scope='eligible_dataframe')
