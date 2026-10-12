"""Synthetic-only persistence and concurrency tests."""
import importlib
import importlib.util
from datetime import date
from pathlib import Path
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from scripts.astra_auto_fixtures import draw, history, write_cache
SCRATCH = ROOT / '.scratch' / 'astra-automation-tests'
SCRATCH.mkdir(parents=True, exist_ok=True)


class CacheTests(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(importlib.util.find_spec('astra_storage'), 'missing safe persistence')
        self.storage = importlib.import_module('astra_storage')
        self.tmp = tempfile.TemporaryDirectory(dir=SCRATCH)
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.cache = self.root / 'cache.csv'
        write_cache(self.cache, history())

    def test_complete_new_row_appends_preserving_every_original_byte(self):
        original = self.cache.read_bytes()
        view = self.storage.read_cache(self.cache, date(2026, 10, 8))
        self.storage.append_draw(self.cache, view, draw(), date(2026, 10, 8))
        self.assertTrue(self.cache.read_bytes().startswith(original))
        updated = self.storage.read_cache(self.cache, date(2026, 10, 8))
        self.assertEqual(updated.rows[:-1], view.rows)
        self.assertEqual(updated.rows[-1]['prize1'], '000123')
        self.assertEqual(updated.latest, date(2026, 10, 1))
        self.assertEqual(updated.header, view.header)

    def test_rejects_duplicate_old_future_and_partial_new_draws_without_writes(self):
        original = self.cache.read_bytes()
        view = self.storage.read_cache(self.cache, date(2026, 10, 8))
        from astra_source import SourceError
        cases = [draw(date(2026, 9, 1)), draw(date(2026, 10, 16)),
                 {**draw(), 'prize2_5': 'pending'}, {**draw(), 'prize4': '000001 ' * 50}]
        for row in cases:
            with self.subTest(day=row['date']), self.assertRaises((self.storage.StorageError, SourceError)):
                self.storage.append_draw(self.cache, view, row, date(2026, 10, 8))
            self.assertEqual(self.cache.read_bytes(), original)

    def test_malformed_or_unterminated_cache_is_not_repaired(self):
        original = self.cache.read_bytes()
        for raw in [b'', b'date,date\n2026-10-01,2026-10-01\n', original[:-1],
                    original + original.splitlines(keepends=True)[-1],
                    original.replace(b'2026-08-09', b'2027-08-09'),
                    original.replace(b'2026-08-09', b'bad-date'), b'\xff\n']:
            self.cache.write_bytes(raw)
            with self.assertRaises(self.storage.StorageError):
                self.storage.read_cache(self.cache, date(2026, 10, 8))
            self.assertEqual(self.cache.read_bytes(), raw)
        self.cache.unlink()
        with self.assertRaises(self.storage.StorageError) as error:
            self.storage.read_cache(self.cache, date(2026, 10, 8))
        self.assertEqual(error.exception.code, 'cache_missing')
        self.assertFalse(self.cache.exists())

    def test_compare_before_replace_and_fsync_failure_leave_cache_unchanged(self):
        from unittest.mock import patch
        view = self.storage.read_cache(self.cache, date(2026, 10, 8))
        changed = view.raw + b'foreign writer\n'
        self.cache.write_bytes(changed)
        with self.assertRaises(self.storage.StorageError) as error:
            self.storage.append_draw(self.cache, view, draw(), date(2026, 10, 8))
        self.assertEqual(error.exception.code, 'cache_changed')
        self.assertEqual(self.cache.read_bytes(), changed)
        self.cache.write_bytes(view.raw)
        for method in ['astra_storage.os.fsync', 'astra_storage.os.replace']:
            with patch(method, side_effect=OSError('sensitive path')), self.assertRaises(self.storage.StorageError):
                self.storage.append_draw(self.cache, view, draw(), date(2026, 10, 8))
            self.assertEqual(self.cache.read_bytes(), view.raw)
            self.assertEqual(list(self.root.glob('*.tmp')), [])

    def test_writer_lock_excludes_a_second_process_and_releases(self):
        import subprocess
        self.assertTrue(callable(getattr(self.storage, 'writer_lock', None)), 'missing inter-process lock')
        lock = self.root / 'cache.lock'
        script = (f'import sys;sys.path.insert(0,{str(ROOT)!r});from astra_storage import writer_lock\n'
                  f'with writer_lock({str(lock)!r}) as acquired: print(acquired)')
        with self.storage.writer_lock(lock) as acquired:
            self.assertTrue(acquired)
            result = subprocess.run([sys.executable, '-c', script], capture_output=True, text=True, timeout=10)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(result.stdout.strip(), 'False')
        result = subprocess.run([sys.executable, '-c', script], capture_output=True, text=True, timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), 'True')


class SnapshotTests(unittest.TestCase):
    def setUp(self):
        import astra_storage
        self.storage = astra_storage
        self.assertTrue(callable(getattr(astra_storage, 'SnapshotStore', None)), 'missing snapshot store')
        self.tmp = tempfile.TemporaryDirectory(dir=SCRATCH)
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name) / 'runtime' / 'automation.sqlite3'
        self.store = astra_storage.SnapshotStore(self.path)

    def snapshot(self):
        import astra
        from datetime import datetime
        generated = datetime(2026, 10, 8, 12, tzinfo=astra.THAILAND_TZ)
        report = astra.build_astra_report(history(), '2026-10-16', generated_at=generated)
        report['source'] = 'existing_local_cache'
        return {'formula_version': 'astra-v1', 'source_draw_date': '2026-09-01',
                'target_date': '2026-10-16', 'captured_at': generated.isoformat(),
                'cache_sha256': 'a' * 64, 'engine_sha256': 'b' * 64,
                'source': 'sanook', 'calendar_source': 'glo', 'report': report}

    def test_read_is_noncreating_and_snapshot_is_immutable_across_restart(self):
        self.assertEqual(self.store.read(), {'state': {}, 'snapshot_count': 0, 'snapshot': None})
        self.assertFalse(self.path.parent.exists())
        first = self.snapshot()
        self.assertEqual(self.store.save(first), first)
        changed = {**first, 'cache_sha256': 'c' * 64}
        self.assertEqual(self.store.save(changed), first)
        fresh = self.storage.SnapshotStore(self.path)
        self.assertEqual(fresh.read('2026-10-16')['snapshot'], first)
        self.assertEqual(fresh.read()['snapshot_count'], 1)
        self.assertIsNone(fresh.read('2026-11-01')['snapshot'])
        import sqlite3
        from contextlib import closing
        with closing(sqlite3.connect(self.path)) as connection:
            for statement in ['DELETE FROM snapshots', "UPDATE snapshots SET payload='{}'"]:
                with self.assertRaises(sqlite3.IntegrityError):
                    connection.execute(statement)


    def test_state_roundtrip_and_malformed_payloads_fail_closed(self):
        state = {'phase': 'waiting', 'last_check_at': '2026-10-08T12:00:00+07:00',
                 'next_check_at': '2026-10-08T12:15:00+07:00', 'last_success_at': None,
                 'latest_source_date': '2026-09-01', 'target_date': '2026-10-16', 'error': None}
        self.store.write_state(state)
        self.assertEqual(self.store.read()['state'], state)
        for bad in [{**state, 'error': 'C:/private/path'}, {**state, 'phase': '<script>'},
                    {**state, 'last_check_at': 'not-a-time'}, {**state, 'target_date': '20261016'}]:
            with self.subTest(bad=bad), self.assertRaises(self.storage.StorageError):
                self.store.write_state(bad)
            self.assertEqual(self.store.read()['state'], state)
        import copy
        good = self.snapshot()
        cases = [{**good, 'source_draw_date': '2026-10-16'}, {**good, 'cache_sha256': 'x'},
                 {**good, 'formula_version': 'wrong'}, {**good, 'report': {}}]
        bad = copy.deepcopy(good)
        bad['report']['categories']['prize1']['numbers'][0]['number'] = 123
        cases.append(bad)
        for bad in cases:
            with self.assertRaises(self.storage.StorageError):
                self.store.save(bad)
        self.assertEqual(self.store.read()['snapshot_count'], 0)

    def test_snapshot_write_and_reload_share_strict_ui_schema_and_ranking_contract(self):
        import copy
        import json
        import sqlite3
        from contextlib import closing
        good = self.snapshot()
        cases = []
        for scope, key, value in [('snapshot', 'internal_path', 'private'),
                                  ('report', 'extra', 'private'),
                                  ('report', 'warnings', [' ']),
                                  ('report', 'schema_version', True)]:
            bad = copy.deepcopy(good)
            (bad if scope == 'snapshot' else bad['report'])[key] = value
            cases.append(bad)
        for field, value in [('requested_count', True), ('digits', '2')]:
            bad = copy.deepcopy(good)
            bad['report']['categories']['bottom2'][field] = value
            cases.append(bad)
        bad = copy.deepcopy(good)
        bad['report']['settings']['positional_prior'] = True
        cases.append(bad)
        for change in ('null_cutoff', 'order', 'tie_order', 'extra_category_key', 'extra_number_key'):
            bad = copy.deepcopy(good)
            category = bad['report']['categories']['prize1']
            if change == 'null_cutoff':
                category['training_cutoff_date'] = None
            elif change == 'order':
                category['numbers'][1]['log_score'] = category['numbers'][0]['log_score'] + 1
            elif change == 'tie_order':
                category['numbers'][0].update(number='999999', log_score=-1)
                category['numbers'][1].update(number='000000', log_score=-1)
            elif change == 'extra_category_key':
                category['extra'] = 'private'
            else:
                category['numbers'][0]['extra'] = 'private'
            cases.append(bad)
        for bad in cases:
            with self.subTest(boundary='save', case=cases.index(bad)), self.assertRaises(self.storage.StorageError):
                self.store.save(bad)
        self.assertFalse(self.path.exists())
        self.store.save(good)
        with closing(sqlite3.connect(self.path)) as connection, connection:
            connection.execute('DROP TRIGGER snapshots_no_update')
        for bad in cases:
            with closing(sqlite3.connect(self.path)) as connection, connection:
                connection.execute('UPDATE snapshots SET payload=?', (json.dumps(bad),))
            before = self.path.read_bytes()
            with self.subTest(boundary='read', case=cases.index(bad)), self.assertRaises(self.storage.StorageError):
                self.store.read(good['target_date'])
            self.assertEqual(self.path.read_bytes(), before)

    def test_noncanonical_timestamps_are_rejected_at_write_and_reload(self):
        import json
        import sqlite3
        from contextlib import closing
        self.store.write_state({'phase': 'waiting'})
        for value in ['20261008T120000+0700', '2026-10-08 12:00:00+07:00',
                      '2026-10-08T12:00+07:00', '2026-10-08T12:00:00+07:00:01',
                      '2026-10-08T12:00:00+07:60', '2026-10-08T12:00:00-00:99']:
            state = {'phase': 'waiting', 'last_check_at': value}
            with self.subTest(value=value), self.assertRaises(self.storage.StorageError):
                self.store.write_state(state)
            with closing(sqlite3.connect(self.path)) as connection, connection:
                connection.execute('UPDATE state SET payload=? WHERE id=1', (json.dumps(state),))
            before = self.path.read_bytes()
            with self.assertRaises(self.storage.StorageError):
                self.store.read()
            self.assertEqual(self.path.read_bytes(), before)

    def test_existing_snapshot_save_readback_must_match_exact_key(self):
        import json
        import sqlite3
        from contextlib import closing
        good = self.snapshot()
        self.store.save(good)
        bad = {**good, 'target_date': '2026-11-01', 'report': {**good['report'], 'target_date': '2026-11-01'}}
        with closing(sqlite3.connect(self.path)) as connection, connection:
            connection.execute('DROP TRIGGER snapshots_no_update')
            connection.execute('UPDATE snapshots SET payload=?', (json.dumps(bad),))
        with self.assertRaises(self.storage.StorageError):
            self.store.save(good)

    def test_saved_payload_must_match_its_database_lookup_key(self):
        import sqlite3
        from contextlib import closing
        self.store.save(self.snapshot())
        with closing(sqlite3.connect(self.path)) as connection, connection:
            connection.execute('DROP TRIGGER snapshots_no_update')  # Simulate a corrupt fixture only.
            connection.execute("UPDATE snapshots SET target_date='2026-11-01'")
        before = self.path.read_bytes()
        with self.assertRaises(self.storage.StorageError):
            self.store.read('2026-11-01')
        self.assertEqual(self.path.read_bytes(), before)

    def test_corrupt_storage_read_does_not_repair_or_expose_payload(self):
        self.path.parent.mkdir(parents=True)
        self.path.write_bytes(b'broken private database')
        before = self.path.read_bytes()
        with self.assertRaises(self.storage.StorageError) as error:
            self.store.read()
        self.assertEqual(error.exception.code, 'storage_invalid')
        self.assertEqual(self.path.read_bytes(), before)
        self.assertNotIn('private', str(error.exception))


if __name__ == '__main__':
    unittest.main(verbosity=2)
