"""HTTP and lifespan integration; temp fixtures only, production network forbidden."""
from contextlib import ExitStack
from datetime import date, datetime
from pathlib import Path
import sys
import tempfile
import threading
import unittest
from unittest.mock import Mock, patch

from fastapi.testclient import TestClient
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import astra
import main
from astra_automation import Automation
from scripts.astra_auto_fixtures import draw, history, write_cache

SCRATCH = ROOT / '.scratch' / 'astra-automation-tests'
SCRATCH.mkdir(parents=True, exist_ok=True)


class AutomationApiTests(unittest.TestCase):
    def setUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.root = Path(self.stack.enter_context(tempfile.TemporaryDirectory(dir=SCRATCH)))
        self.cache = self.root / 'cache.csv'
        write_cache(self.cache, history())
        self.source = Mock()
        self.source.calendar.return_value = (date(2026, 9, 1), date(2026, 10, 1), date(2026, 10, 16))
        self.source.draw.side_effect = lambda day: draw(day)
        self.infer = Mock(wraps=astra.build_astra_report)
        self.worker = Automation(self.cache, self.root / 'runtime' / 'automation.sqlite3',
                                 source=self.source, infer=self.infer,
                                 clock=lambda: datetime(2026, 10, 8, 12, tzinfo=astra.THAILAND_TZ))
        self.stack.enter_context(patch.object(main.app.state, 'astra_automation', self.worker, create=True))
        for name in ('load_data', 'incremental_update'):
            self.stack.enter_context(patch.object(main, name, side_effect=AssertionError('legacy data access forbidden')))
        self.stack.enter_context(patch('requests.sessions.Session.request', side_effect=AssertionError('network forbidden')))
        self.client = TestClient(main.app)  # No lifespan unless a test explicitly enters it.
        self.addCleanup(self.client.close)

    def test_status_get_is_read_only_and_snapshot_read_never_reinfers(self):
        response = self.client.get('/api/astra/automation?date=2026-10-16')
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()['snapshot_count'], 0)
        self.assertFalse(self.worker.store.path.exists())
        self.source.calendar.assert_not_called()
        self.infer.assert_not_called()
        self.worker.tick()
        before = self.worker.store.path.read_bytes()
        self.source.reset_mock()
        self.infer.reset_mock()
        response = self.client.get('/api/astra/automation?date=2026-10-16')
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()['snapshot']['target_date'], '2026-10-16')
        self.assertEqual(self.worker.store.path.read_bytes(), before)
        self.source.calendar.assert_not_called()
        self.infer.assert_not_called()
        self.assertNotIn(str(self.root), response.text)

    def test_invalid_target_is_rejected_before_storage_read(self):
        with patch.object(self.worker.store, 'read', side_effect=AssertionError('store opened')):
            for target in ('20261016', '2026-10-1', '2026-02-30', '', '2026-10-16\"'):
                self.assertEqual(self.client.get('/api/astra/automation', params={'date': target}).status_code, 400)

    def test_corrupt_store_is_safe_explicit_error_and_not_repaired(self):
        self.worker.store.path.parent.mkdir(parents=True)
        self.worker.store.path.write_bytes(b'private raw bytes')
        response = self.client.get('/api/astra/automation?date=2026-10-16')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['error'], 'storage_invalid')
        self.assertIsNone(response.json()['snapshot'])
        self.assertEqual(self.worker.store.path.read_bytes(), b'private raw bytes')
        self.assertNotIn('private raw', response.text)


    def test_lifespan_starts_check_without_http_request_and_joins_on_shutdown(self):
        finished = threading.Event()
        tick = self.worker.tick
        def observed():
            try:
                return tick()
            finally:
                finished.set()
        self.worker.tick = observed
        with patch.object(main, '_create_astra_automation', return_value=self.worker) as factory:
            with TestClient(main.app):
                self.assertTrue(factory.called, 'lifespan never constructed the worker')
                self.assertTrue(finished.wait(5))
                self.assertTrue(self.worker.running)
                self.assertEqual(self.worker.status()['snapshot_count'], 1)
            self.assertFalse(self.worker.running)

    def test_enabled_zero_kill_switch_blocks_startup_work(self):
        import os
        with patch.object(main, 'BASE_DIR', self.root), patch.dict(os.environ, {'ASTRA_AUTO_ENABLED': '0'}):
            worker = main._create_astra_automation()
            self.assertFalse(worker.enabled)
            with patch.object(main, '_create_astra_automation', return_value=worker), TestClient(main.app):
                self.assertFalse(worker.running)
                self.assertFalse(worker.store.path.exists())
            self.assertFalse(worker.store.path.exists())

    def test_manual_refresh_serializes_with_auto_writer_and_keeps_original_update_path(self):
        import pandas as pd
        from astra_storage import writer_lock
        with patch.object(main, 'BASE_DIR', self.root), patch.object(main, '_df_cache', None), \
             patch.object(main, 'incremental_update', return_value=pd.DataFrame([{'prize1': '000123'}])) as update:
            with writer_lock(self.worker.lock_path) as acquired:
                self.assertTrue(acquired)
                response = self.client.post('/api/refresh')
                self.assertEqual(response.status_code, 409)
                update.assert_not_called()
            response = self.client.post('/api/refresh')
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()['rows'], 1)
            update.assert_called_once()

    def test_dataframe_cache_reloads_after_another_process_changes_file(self):
        import pandas as pd
        first, second = pd.DataFrame([{'prize1': '000001'}]), pd.DataFrame([{'prize1': '000002'}])
        cache = self.root / 'lottery_cache.csv'
        write_cache(cache, history())
        with patch.object(main, 'BASE_DIR', self.root), patch.object(main, '_df_cache', None), \
             patch.object(main, '_df_signature', None, create=True), \
             patch.object(main, 'load_data', side_effect=[first, second]) as loader:
            self.assertIs(main.get_df(), first)
            self.assertIs(main.get_df(), first)
            cache.write_bytes(cache.read_bytes() + b'\n')  # Metadata-only trigger; loader is mocked.
            self.assertIs(main.get_df(), second)
            self.assertEqual(loader.call_count, 2)


if __name__ == '__main__':
    unittest.main(verbosity=2)
