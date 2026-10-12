"""Transactional append-only result cache and separate immutable auto snapshots."""
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import date, datetime
from hashlib import sha256
from pathlib import Path
import csv
import io
import json
import math
import os
import re
import sqlite3
import tempfile

import astra
from astra_source import validate_draw


class StorageError(RuntimeError):
    def __init__(self, code):
        self.code = code
        super().__init__(code)


@contextmanager
def writer_lock(path):
    """Nonblocking OS lock, released on normal exit or process death."""
    path = Path(path)
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        stream = path.open('a+b')
    except OSError:
        raise StorageError('storage_unavailable') from None
    acquired = False
    try:
        stream.seek(0)
        try:
            if os.name == 'nt':
                import msvcrt
                msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(stream.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            acquired = True
        except OSError as error:
            import errno
            if error.errno not in (errno.EACCES, errno.EAGAIN, errno.EDEADLK):
                raise StorageError('storage_unavailable') from None
        yield acquired
    finally:
        if acquired:
            stream.seek(0)
            if os.name == 'nt':
                msvcrt.locking(stream.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                fcntl.flock(stream.fileno(), fcntl.LOCK_UN)
        stream.close()


ERRORS = frozenset(('cache_missing', 'cache_invalid', 'cache_changed', 'storage_unavailable',
                    'storage_invalid', 'source_unavailable', 'source_invalid', 'results_pending',
                    'calendar_invalid', 'calendar_unavailable', 'inference_failed', 'internal_error'))
PHASES = frozenset(('idle', 'checking', 'waiting', 'saved', 'waiting_results', 'waiting_calendar',
                    'catching_up', 'error', 'disabled', 'stopped'))
STATE_DEFAULTS = {'phase': 'idle', 'last_check_at': None, 'next_check_at': None,
                  'last_success_at': None, 'latest_source_date': None, 'target_date': None, 'error': None}


def canonical_date(value):
    if not isinstance(value, str) or not re.fullmatch(r'[0-9]{4}-[0-9]{2}-[0-9]{2}', value):
        raise ValueError
    return date.fromisoformat(value)


def timestamp(value):
    if not isinstance(value, str) or not re.fullmatch(
            r'[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}'
            r'(?:\.[0-9]{1,6})?(?:Z|[+-][0-9]{2}:[0-9]{2})', value):
        raise ValueError
    # fromisoformat normalizes invalid offset minutes; the UI does not.
    if not value.endswith('Z') and (int(value[-5:-3]) > 23 or int(value[-2:]) > 59):
        raise ValueError
    parsed = datetime.fromisoformat(value)
    if parsed.utcoffset() is None:
        raise ValueError
    return parsed


def _validate_state(state):
    try:
        if (not isinstance(state, dict) or not set(state).issubset(STATE_DEFAULTS)
                or state.get('phase', 'idle') not in PHASES
                or state.get('error') not in ERRORS | {None}):
            raise ValueError
        for key in ('last_check_at', 'next_check_at', 'last_success_at'):
            if state.get(key) is not None:
                timestamp(state[key])
        for key in ('latest_source_date', 'target_date'):
            if state.get(key) is not None:
                canonical_date(state[key])
        return state
    except (ValueError, TypeError, KeyError):
        raise StorageError('storage_invalid') from None


def _validate_snapshot(snapshot):
    try:
        if (not isinstance(snapshot, dict) or set(snapshot) != {
                'formula_version', 'source_draw_date', 'target_date', 'captured_at',
                'cache_sha256', 'engine_sha256', 'source', 'calendar_source', 'report'}):
            raise ValueError
        source = canonical_date(snapshot['source_draw_date'])
        target = canonical_date(snapshot['target_date'])
        generated = timestamp(snapshot['captured_at']).astimezone(astra.THAILAND_TZ)
        report = snapshot['report']
        if not isinstance(report, dict) or set(report) != {
                'schema_version', 'formula', 'version', 'trust', 'target_date', 'generated_at',
                'training_cutoff_date', 'source', 'window_draws', 'settings', 'warnings', 'categories'}:
            raise ValueError
        if (snapshot['formula_version'] != 'astra-v1' or snapshot['source'] != 'sanook'
                or snapshot['calendar_source'] != 'glo' or not source <= generated.date() < target
                or any(not isinstance(snapshot[k], str) or not re.fullmatch(r'[0-9a-f]{64}', snapshot[k])
                       for k in ('cache_sha256', 'engine_sha256'))
                or report['version'] != 'astra-v1' or report['formula'] != 'astra'
                or type(report['schema_version']) is not int or report['schema_version'] != 1 or report['trust'] != 'ทดลอง'
                or report['target_date'] != snapshot['target_date']
                or report['generated_at'] != snapshot['captured_at']
                or report['training_cutoff_date'] != snapshot['source_draw_date']
                or report['source'] != 'existing_local_cache' or report['settings'] != dict(astra._SETTINGS)
                or any(type(v) not in (int, float) for v in report['settings'].values())
                or type(report['window_draws']) is not int or not 1 <= report['window_draws'] <= 200
                or not isinstance(report['warnings'], list)
                or any(not isinstance(w, str) or not w.strip() for w in report['warnings'])
                or set(report['categories']) != {c[0] for c in astra._CATEGORIES}):
            raise ValueError
        for key, label, width, count in astra._CATEGORIES:
            category = report['categories'][key]
            if not isinstance(category, dict) or set(category) != {
                    'label', 'digits', 'requested_count', 'status', 'valid_draws',
                    'invalid_draws', 'training_cutoff_date', 'numbers'}:
                raise ValueError
            numbers = category['numbers']
            if (category['label'] != label or category['digits'] != width or category['requested_count'] != count
                    or type(category['digits']) is not int or type(category['requested_count']) is not int
                    or category['status'] not in ('ok', 'insufficient_data') or not isinstance(numbers, list)
                    or len(numbers) != (count if category['status'] == 'ok' else 0)
                    or any(type(category[k]) is not int or not 0 <= category[k] <= report['window_draws']
                           for k in ('valid_draws', 'invalid_draws'))
                    or category['valid_draws'] + category['invalid_draws'] != report['window_draws']
                    or (category['status'] == 'ok') != (category['valid_draws'] >= 20)):
                raise ValueError
            cutoff = category['training_cutoff_date']
            if (category['valid_draws'] == 0 and cutoff is not None) or (category['valid_draws'] > 0 and (cutoff is None or canonical_date(cutoff) > source)):
                raise ValueError
            if len({entry['number'] for entry in numbers}) != len(numbers):
                raise ValueError
            for rank, entry in enumerate(numbers, 1):
                if (not isinstance(entry, dict) or set(entry) != {'number', 'rank', 'log_score'}
                        or not isinstance(entry['number'], str) or not re.fullmatch(r'[0-9]{%d}' % width, entry['number'])
                        or type(entry['rank']) is not int or entry['rank'] != rank
                        or type(entry['log_score']) not in (int, float) or not math.isfinite(entry['log_score'])):
                    raise ValueError
            if numbers != sorted(numbers, key=lambda entry: (-entry['log_score'], entry['number'])):
                raise ValueError
        return snapshot
    except (ValueError, TypeError, KeyError, AttributeError):
        raise StorageError('storage_invalid') from None


class SnapshotStore:
    """Constructor and read paths do not create storage or run any work."""
    def __init__(self, path):
        self.path = Path(path)

    @contextmanager
    def _connect(self, write=False):
        connection = None
        try:
            new = not self.path.exists()
            if write:
                self.path.parent.mkdir(parents=True, exist_ok=True)
            location = str(self.path) if write else self.path.resolve().as_uri() + '?mode=ro'
            connection = sqlite3.connect(location, uri=not write, timeout=2)
            if write and new:
                connection.executescript('''
                    CREATE TABLE state (id INTEGER PRIMARY KEY CHECK(id=1), payload TEXT NOT NULL);
                    CREATE TABLE snapshots (
                        formula_version TEXT NOT NULL, source_draw_date TEXT NOT NULL,
                        target_date TEXT NOT NULL, captured_at TEXT NOT NULL, payload TEXT NOT NULL,
                        PRIMARY KEY(formula_version, source_draw_date, target_date));
                    CREATE TRIGGER snapshots_no_update BEFORE UPDATE ON snapshots
                        BEGIN SELECT RAISE(ABORT, 'immutable snapshot'); END;
                    CREATE TRIGGER snapshots_no_delete BEFORE DELETE ON snapshots
                        BEGIN SELECT RAISE(ABORT, 'immutable snapshot'); END;
                ''')
            with connection:
                yield connection
        except (sqlite3.Error, OSError):
            raise StorageError('storage_unavailable' if write else 'storage_invalid') from None
        finally:
            if connection is not None:
                connection.close()

    def read(self, target=None):
        if not self.path.exists():
            return {'state': {}, 'snapshot_count': 0, 'snapshot': None}
        try:
            with self._connect() as connection:
                state = connection.execute('SELECT payload FROM state WHERE id=1').fetchone()
                count = connection.execute('SELECT COUNT(*) FROM snapshots').fetchone()[0]
                where, params = (' WHERE target_date=?', (target,)) if target is not None else ('', ())
                record = connection.execute('SELECT formula_version,source_draw_date,target_date,captured_at,payload '
                                            'FROM snapshots' + where +
                                            ' ORDER BY captured_at DESC, source_draw_date DESC LIMIT 1', params).fetchone()
            snapshot = _validate_snapshot(json.loads(record[4])) if record else None
            if record and tuple(snapshot[k] for k in ('formula_version', 'source_draw_date', 'target_date', 'captured_at')) != record[:4]:
                raise StorageError('storage_invalid')
            return {'state': _validate_state(json.loads(state[0])) if state else {}, 'snapshot_count': count,
                    'snapshot': snapshot}
        except (ValueError, TypeError):
            raise StorageError('storage_invalid') from None

    def write_state(self, state):
        payload = json.dumps(_validate_state(state), ensure_ascii=False, allow_nan=False)
        with self._connect(write=True) as connection:
            connection.execute('INSERT INTO state(id,payload) VALUES(1,?) '
                               'ON CONFLICT(id) DO UPDATE SET payload=excluded.payload', (payload,))

    def save(self, snapshot):
        payload = json.dumps(_validate_snapshot(snapshot), ensure_ascii=False, allow_nan=False)
        key = tuple(snapshot[field] for field in ('formula_version', 'source_draw_date', 'target_date'))
        with self._connect(write=True) as connection:
            connection.execute('INSERT OR IGNORE INTO snapshots VALUES(?,?,?,?,?)',
                               (*key, snapshot['captured_at'], payload))
        with self._connect() as connection:
            stored = connection.execute('SELECT payload FROM snapshots WHERE '
                                        'formula_version=? AND source_draw_date=? AND target_date=?', key).fetchone()
        if stored is None:
            raise StorageError('storage_invalid')
        result = _validate_snapshot(json.loads(stored[0]))
        if tuple(result[field] for field in ('formula_version', 'source_draw_date', 'target_date')) != key:
            raise StorageError('storage_invalid')
        return result


@dataclass(frozen=True)
class CacheView:
    raw: bytes
    header: tuple
    rows: list
    latest: date

    @property
    def digest(self):
        return sha256(self.raw).hexdigest()


def read_cache(path, today):
    try:
        raw = Path(path).read_bytes()
        if not raw or not raw.endswith(b'\n') or len(raw) > 20_000_000:
            raise ValueError
        parsed = list(csv.reader(io.StringIO(raw.decode('utf-8-sig'), newline=''), strict=True))
        header = parsed[0]
        required = {'date', 'prize1', 'bottom2', 'prize4'} | {
            f'{key}_{i}' for key, count in (('front3', 2), ('back3', 2), ('prize2', 5), ('prize3', 10))
            for i in range(1, count + 1)}
        if (not required.issubset(header) or len(header) != len(set(header))
                or any(not k or k != k.strip() or '\x00' in k for k in header)):
            raise ValueError
        rows, previous = [], None
        for values in parsed[1:]:
            if len(values) != len(header) or any('\x00' in value for value in values):
                raise ValueError
            row = dict(zip(header, values))
            day = astra._history_date(row['date'])
            if day > today or (previous is not None and day <= previous):
                raise ValueError
            rows.append(row)
            previous = day
        if previous is None:
            raise ValueError
        return CacheView(raw, tuple(header), rows, previous)
    except FileNotFoundError:
        raise StorageError('cache_missing') from None
    except (OSError, ValueError, UnicodeError, csv.Error, IndexError):
        raise StorageError('cache_invalid') from None


def append_draw(path, before, row, today):
    """Caller holds the shared writer lock. Existing bytes are never reserialized."""
    path = Path(path)
    try:
        day = date.fromisoformat(row['date'])
        validate_draw(row, day)
        if day <= before.latest or day > today:
            raise StorageError('cache_invalid')
        stream = io.StringIO(newline='')
        writer = csv.DictWriter(stream, fieldnames=before.header, extrasaction='ignore', lineterminator='\n')
        writer.writerow(row)
        after = before.raw + stream.getvalue().encode('utf-8')
        temporary = None
        try:
            with tempfile.NamedTemporaryFile(dir=path.parent, prefix='.astra-cache-', suffix='.tmp', delete=False) as target:
                temporary = Path(target.name)
                target.write(after)
                target.flush()
                os.fsync(target.fileno())
            if path.read_bytes() != before.raw:
                raise StorageError('cache_changed')
            os.replace(temporary, path)
            if path.read_bytes() != after:
                raise StorageError('cache_changed')
        finally:
            if temporary is not None:
                temporary.unlink(missing_ok=True)
    except (KeyError, ValueError, TypeError):
        raise StorageError('cache_invalid') from None
    except OSError:
        raise StorageError('storage_unavailable') from None
