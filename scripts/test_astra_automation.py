"""Synthetic-only automation integration: real engine, local temp CSV and SQLite."""
from datetime import date, datetime, timedelta
import importlib
import importlib.util
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import Mock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import astra
from scripts.astra_auto_fixtures import draw, history, write_cache

SCRATCH = ROOT / '.scratch' / 'astra-automation-tests'
SCRATCH.mkdir(parents=True, exist_ok=True)


class SyntheticSource:
    def __init__(self):
        self.calendar = Mock(return_value=(date(2026, 9, 1), date(2026, 9, 16),
                                          date(2026, 10, 1), date(2026, 10, 16)))
        self.draw = Mock(side_effect=lambda day: draw(day))


class WorkerTests(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(importlib.util.find_spec('astra_automation'), 'missing automatic workflow')
        self.auto = importlib.import_module('astra_automation')
        self.tmp = tempfile.TemporaryDirectory(dir=SCRATCH)
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.cache = self.root / 'cache.csv'
        write_cache(self.cache, history())
        self.now = datetime(2026, 10, 8, 12, tzinfo=astra.THAILAND_TZ)
        self.clock = lambda: self.now
        self.source = SyntheticSource()
        self.engine = Mock(wraps=astra.build_astra_report)
        self.changed = Mock()
        self.worker = self.make_worker()

    def make_worker(self, **kwargs):
        return self.auto.Automation(self.cache, self.root / 'runtime' / 'automation.sqlite3',
                                    source=self.source, clock=self.clock, infer=self.engine,
                                    on_cache_change=self.changed, **kwargs)

    def test_new_results_append_then_one_future_report_survives_repeated_checks_and_restart(self):
        original = self.cache.read_bytes()
        self.assertFalse(self.worker.store.path.exists())
        self.assertEqual(self.worker.status('2026-10-16')['snapshot_count'], 0)
        self.assertFalse(self.worker.store.path.exists())
        self.worker.tick()
        state = self.worker.status('2026-10-16')
        self.assertEqual(state['phase'], 'saved')
        self.assertEqual(state['latest_source_date'], '2026-10-01')
        self.assertEqual(state['target_date'], '2026-10-16')
        self.assertEqual(state['snapshot_count'], 1)
        self.assertEqual(state['snapshot']['report']['training_cutoff_date'], '2026-10-01')
        self.assertEqual(sum(len(c['numbers']) for c in state['snapshot']['report']['categories'].values()), 25)
        self.assertTrue(self.cache.read_bytes().startswith(original))
        self.assertEqual([c.args[0] for c in self.source.draw.call_args_list], [date(2026, 9, 16), date(2026, 10, 1)])
        self.assertEqual(self.changed.call_count, 2)
        self.worker.tick()
        restarted = self.make_worker()
        restarted.tick()
        self.assertEqual(self.source.calendar.call_count, 1)
        self.now += timedelta(minutes=15)
        restarted.tick()
        self.assertEqual(self.source.calendar.call_count, 2)
        self.assertEqual(self.source.draw.call_count, 2)
        self.assertEqual(self.engine.call_count, 1)
        self.assertEqual(restarted.status('2026-10-16')['snapshot'], state['snapshot'])


    def test_incomplete_draw_blocks_later_fetches_and_retries_without_partial_write(self):
        original = self.cache.read_bytes()
        self.source.draw.side_effect = lambda day: {**draw(day), 'prize2_5': 'pending'}
        self.worker.tick()
        self.assertEqual(self.worker.status()['phase'], 'waiting_results')
        self.assertEqual(self.cache.read_bytes(), original)
        self.assertEqual(self.source.draw.call_count, 1)
        self.engine.assert_not_called()
        self.source.draw.side_effect = lambda day: draw(day)
        self.now += timedelta(minutes=15)
        self.worker.tick()
        self.assertEqual(self.worker.status()['snapshot_count'], 1)

    def test_missing_cache_and_bad_storage_do_not_fetch_or_create_history(self):
        self.cache.unlink()
        self.worker.tick()
        self.assertEqual(self.worker.status()['error'], 'cache_missing')
        self.source.calendar.assert_not_called()
        self.assertFalse(self.cache.exists())
        self.worker.store.path.write_bytes(b'corrupt data')
        self.now += timedelta(minutes=15)
        self.worker.tick()
        self.assertEqual(self.worker.status()['error'], 'storage_invalid')
        self.source.calendar.assert_not_called()

    def test_calendar_missing_anchor_or_missing_next_never_guesses_a_target(self):
        self.source.calendar.return_value = (date(2026, 10, 1), date(2026, 10, 16))
        self.worker.tick()
        self.assertEqual(self.worker.status()['error'], 'calendar_invalid')
        self.source.draw.assert_not_called()
        self.engine.assert_not_called()
        self.source.calendar.return_value = (date(2026, 9, 1),)
        self.now += timedelta(minutes=15)
        self.worker.tick()
        self.assertEqual(self.worker.status()['phase'], 'waiting_calendar')
        self.engine.assert_not_called()

    def test_shifted_target_comes_from_calendar_not_nominal_sixteenth(self):
        self.now = datetime(2027, 1, 3, 12, tzinfo=astra.THAILAND_TZ)
        write_cache(self.cache, history() + [draw(date(2027, 1, 2))])
        self.source.calendar.return_value = (date(2027, 1, 2), date(2027, 1, 17))
        self.worker.tick()
        self.assertEqual(self.worker.status()['snapshot']['target_date'], '2027-01-17')
        self.assertEqual(self.engine.call_args.args[1], '2027-01-17')
        self.source.draw.assert_not_called()

    def test_clock_crossing_target_day_during_fetch_does_not_capture_past_target(self):
        def late_calendar():
            self.now = datetime(2026, 10, 16, 0, 1, tzinfo=astra.THAILAND_TZ)
            return (date(2026, 9, 1), date(2026, 10, 16), date(2026, 11, 1))
        self.source.calendar.side_effect = late_calendar
        self.worker.tick()
        self.assertEqual(self.worker.status()['phase'], 'waiting_calendar')
        self.engine.assert_not_called()

    def test_bounded_catchup_does_not_predict_until_all_overdue_draws_arrive(self):
        self.source.calendar.return_value = tuple([date(2026, 9, d) for d in range(1, 7)] + [date(2026, 10, 16)])
        self.worker.tick()
        self.assertEqual(self.source.draw.call_count, self.auto.MAX_CATCHUP)
        self.assertEqual(self.worker.status()['phase'], 'catching_up')
        self.engine.assert_not_called()
        self.now += timedelta(minutes=15)
        self.worker.tick()
        self.assertEqual(self.engine.call_count, 1)
        self.assertEqual(self.worker.status()['snapshot_count'], 1)

    def test_crash_after_cache_append_recovers_without_downloading_results_again(self):
        self.engine.side_effect = RuntimeError('private exception')
        self.worker.tick()
        self.assertEqual(self.worker.status()['error'], 'inference_failed')
        self.assertEqual(self.worker.status()['snapshot_count'], 0)
        self.assertEqual(self.source.draw.call_count, 2)
        self.engine.side_effect = None
        self.now += timedelta(minutes=15)
        self.make_worker().tick()
        self.assertEqual(self.source.draw.call_count, 2)
        self.assertEqual(self.engine.call_count, 2)
        self.assertEqual(self.worker.status()['snapshot_count'], 1)

    def test_crash_after_snapshot_commit_recovers_without_reinference(self):
        from astra_storage import StorageError
        save = self.worker.store.save
        def crash(snapshot):
            save(snapshot)
            raise StorageError('storage_unavailable')
        self.worker.store.save = crash
        self.worker.tick()
        self.assertEqual(self.engine.call_count, 1)
        self.now += timedelta(minutes=15)
        restarted = self.make_worker()
        restarted.tick()
        self.assertEqual(restarted.status()['snapshot_count'], 1)
        self.assertEqual(restarted.status()['phase'], 'waiting')
        self.assertEqual(self.engine.call_count, 1)

    def test_two_workers_share_deadline_and_writer_lock(self):
        from concurrent.futures import ThreadPoolExecutor
        other = self.make_worker()
        with ThreadPoolExecutor(2) as pool:
            list(pool.map(lambda worker: worker.tick(), [self.worker, other]))
        self.assertEqual(self.source.calendar.call_count, 1)
        self.assertEqual(self.engine.call_count, 1)
        self.assertEqual(self.worker.status()['snapshot_count'], 1)

    def test_worker_runs_without_ui_and_stops_cooperatively(self):
        import threading
        self.assertTrue(callable(getattr(self.worker, 'start', None)), 'missing worker lifecycle')
        finished = threading.Event()
        tick = self.worker.tick
        def observed_tick():
            try:
                return tick()
            finally:
                finished.set()
        self.worker.tick = observed_tick
        self.worker.start()
        try:
            self.assertTrue(finished.wait(5), 'startup check never ran')
            self.assertTrue(self.worker.running)
            self.assertEqual(self.worker.status()['snapshot_count'], 1)
        finally:
            self.assertTrue(self.worker.stop())
        self.assertFalse(self.worker.running)
        self.assertEqual(self.worker.status()['phase'], 'stopped')

    def test_disabled_worker_does_not_create_storage_or_fetch(self):
        worker = self.make_worker(enabled=False)
        self.assertTrue(callable(getattr(worker, 'start', None)), 'missing worker lifecycle')
        worker.start()
        worker.tick()
        self.assertFalse(worker.running)
        self.assertEqual(worker.status()['phase'], 'disabled')
        self.assertFalse(worker.store.path.exists())
        self.source.calendar.assert_not_called()


    def test_misdated_source_response_cannot_skip_an_intermediate_draw(self):
        original = self.cache.read_bytes()
        self.source.draw.side_effect = lambda day: draw(date(2026, 10, 1))
        self.worker.tick()
        self.assertEqual(self.cache.read_bytes(), original)
        self.assertEqual(self.worker.status()['phase'], 'waiting_results')
        self.engine.assert_not_called()

    def test_shutdown_during_source_fetch_does_not_append_or_infer(self):
        import threading
        entered, release = threading.Event(), threading.Event()
        def blocked(day):
            entered.set()
            if not release.wait(5):
                raise AssertionError('test never released source')
            return draw(day)
        self.source.draw.side_effect = blocked
        original = self.cache.read_bytes()
        self.worker.start()
        try:
            self.assertTrue(entered.wait(5))
            self.worker._stop.set()  # Same cancellation flag set by stop(), before unblocking I/O.
            release.set()
            self.assertTrue(self.worker.stop())
        finally:
            release.set()
            self.worker.stop()
        self.assertEqual(self.cache.read_bytes(), original)
        self.engine.assert_not_called()

    def test_engine_failure_never_escapes_as_raw_status_details(self):
        self.engine.side_effect = RuntimeError('private C:/file secret')
        self.worker.tick()
        state = self.worker.status()
        self.assertEqual(state['error'], 'inference_failed')
        self.assertNotIn('private', str(state))
        self.assertIsNone(state['snapshot'])


if __name__ == '__main__':
    unittest.main(verbosity=2)
