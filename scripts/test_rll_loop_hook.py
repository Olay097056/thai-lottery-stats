"""The reward loop closes on a cache write, and a broken sweep can never break the cache update.

`resolve` is the only way a reward reaches the bandit. Nothing called it, which is why every arm sat
at n = 0 — the loop shipped open. This covers the hook in main.py that runs the sweep after the
automation appends a draw.
"""
import sys
import tempfile
import threading
import unittest
from datetime import datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import astra  # noqa: E402
import main  # noqa: E402
import rll  # noqa: E402

FIVE = '{"numbers":["111111","222222","333333","444444","555555"]}'


def fake_model(prompt):
    return {'content': FIVE, 'usage': {}, 'latency_ms': 1, 'raw': '{}'}


def next_draw_after(day):
    day += timedelta(days=1)
    while day.day not in (1, 16):
        day += timedelta(days=1)
    return day


class RllLoopHookTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self._db = rll.DB
        rll.DB = Path(self.tmp.name) / 'rll.sqlite3'
        self._pending = rll.resolve_pending
        self.calls = []

        def fake_pending(history=None, *, dry_run=False):
            self.calls.append(dry_run)
            return [{'target_date': '2026-11-16', 'status': 'resolved', 'r': 3}]

        rll.resolve_pending = fake_pending

    def tearDown(self):
        rll.resolve_pending = self._pending
        rll.DB = self._db
        self.tmp.cleanup()

    def test_a_cache_change_runs_the_reward_sweep(self):
        main._invalidate_dataframe()
        self.assertEqual(self.calls, [False], 'the cache-write path must score landed draws')

    def test_a_failing_sweep_never_breaks_the_cache_update(self):
        def broken(history=None, *, dry_run=False):
            raise RuntimeError('rll db is unreadable')

        rll.resolve_pending = broken
        main._invalidate_dataframe()          # must not raise into the automation thread
        self.assertIsNone(main._df_cache, 'the dataframe cache must still be invalidated')

    def test_the_manual_refresh_path_closes_the_loop_too(self):
        """Two cache-write paths exist; a draw landing through the button must count as well."""
        import inspect
        source = inspect.getsource(main.api_refresh)
        self.assertIn('_resolve_rll_after_cache_change()', source)
        # and it must run after the writer lock is released, or a slow sweep blocks the refresh
        self.assertLess(source.index('rows = int(len(_df_cache))'),
                        source.index('_resolve_rll_after_cache_change()'))

    def test_the_sweep_runs_after_the_mutex_is_released(self):
        """A slow sweep must not hold _df_mutex, or every request queues behind it."""
        observed = []
        self.assertIsInstance(main._df_mutex, type(threading.RLock()))

        def slow(history=None, *, dry_run=False):
            # An RLock cannot be asked whether it is held, so probe by acquiring it.
            got = main._df_mutex.acquire(blocking=False)
            observed.append(got)
            if got:
                main._df_mutex.release()
            return []

        rll.resolve_pending = slow
        main._invalidate_dataframe()
        self.assertEqual(observed, [True], 'the sweep must run outside the mutex')


class RllResolvePendingRealDataTest(unittest.TestCase):
    """The sweep must never invent a result: no prize in the cache means no reward."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self._db = rll.DB
        rll.DB = Path(self.tmp.name) / 'rll.sqlite3'
        self.history = astra.load_existing_astra_history()
        self.target = next_draw_after(datetime.now(astra.THAILAND_TZ).date())

    def tearDown(self):
        rll.DB = self._db
        self.tmp.cleanup()

    def test_a_forecast_with_no_landed_draw_stays_pending(self):
        rll.formula_forecast(self.target.isoformat(), call_model=fake_model)
        rows = rll.resolve_pending(history=self.history)
        self.assertEqual([row['status'] for row in rows], ['pending'])
        self.assertEqual(rll.state()['resolved'], 0, 'no result in the cache means no reward')

    def test_a_landed_draw_closes_the_loop_end_to_end(self):
        rll.formula_forecast(self.target.isoformat(), call_model=fake_model)
        landed = list(self.history) + [{'date': self.target.isoformat(), 'prize1': '222222'}]
        rows = rll.resolve_pending(history=landed)
        self.assertEqual(rows[0]['status'], 'resolved')
        self.assertEqual(rows[0]['r'], 6)
        self.assertTrue(rows[0]['payout'])
        state = rll.state()
        self.assertEqual(state['resolved'], 1)
        self.assertEqual(state['payouts'], 1)

    def test_running_the_sweep_twice_counts_the_draw_once(self):
        rll.formula_forecast(self.target.isoformat(), call_model=fake_model)
        landed = list(self.history) + [{'date': self.target.isoformat(), 'prize1': '123999'}]
        rll.resolve_pending(history=landed)
        second = rll.resolve_pending(history=landed)
        self.assertEqual(second[0]['status'], 'already_resolved')
        self.assertEqual(rll.state()['resolved'], 1)


if __name__ == '__main__':
    unittest.main(verbosity=2)
