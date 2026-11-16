"""LLM GOD's reward loop closes on a cache write, on both paths, and a broken sweep cannot break them.

The RLL release shipped with `resolve` but no caller, so every arm sat at n = 0 and the bandit looked
quiet rather than broken. This covers the same hook for LLM GOD: it must run after the automation appends
a draw, it must also run after the manual refresh (a second, separate cache-write path), and it must never
raise into either.
"""
import inspect
import sys
import tempfile
import threading
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import astra  # noqa: E402
import llm_god  # noqa: E402
import main  # noqa: E402


class LlmGodLoopHookTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self._db = llm_god.DB
        llm_god.DB = Path(self.tmp.name) / 'llm_god.sqlite3'
        self._pending = llm_god.resolve_pending
        self.calls = []

        def fake_pending(history=None, *, dry_run=False):
            self.calls.append(dry_run)
            return [{'target_date': '2026-11-16', 'status': 'resolved', 'r': 3, 'r_pool': 4}]

        llm_god.resolve_pending = fake_pending

    def tearDown(self):
        llm_god.resolve_pending = self._pending
        llm_god.DB = self._db
        self.tmp.cleanup()

    def test_a_cache_change_runs_the_reward_sweep(self):
        main._invalidate_dataframe()
        self.assertEqual(self.calls, [False], 'the cache-write path must score landed draws')

    def test_a_failing_sweep_never_breaks_the_cache_update(self):
        def broken(history=None, *, dry_run=False):
            raise RuntimeError('llm_god db is unreadable')

        llm_god.resolve_pending = broken
        main._invalidate_dataframe()          # must not raise into the automation thread
        self.assertIsNone(main._df_cache, 'the dataframe cache must still be invalidated')

    def test_the_manual_refresh_path_closes_the_loop_too(self):
        """Two cache-write paths exist; a draw landing through the button must count as well."""
        source = inspect.getsource(main.api_refresh)
        self.assertIn('_resolve_llm_god_after_cache_change()', source)
        # and it must run after the writer lock is released, or a slow sweep blocks the refresh
        self.assertLess(source.index('rows = int(len(_df_cache))'),
                        source.index('_resolve_llm_god_after_cache_change()'))

    def test_the_sweep_runs_after_the_mutex_is_released(self):
        """A slow sweep must not hold _df_mutex, or every request queues behind it."""
        observed = []

        def slow(history=None, *, dry_run=False):
            got = main._df_mutex.acquire(blocking=False)
            observed.append(got)
            if got:
                main._df_mutex.release()
            return []

        llm_god.resolve_pending = slow
        main._invalidate_dataframe()
        self.assertEqual(observed, [True], 'the sweep must run outside the mutex')

    def test_isolation_from_rll(self):
        """RLL and LLM GOD keep separate databases, protocols, and modules."""
        import rll
        self.assertNotEqual(llm_god.PROTOCOL, rll.PROTOCOL)
        self.assertNotEqual(str(llm_god.DB), str(rll.DB))
        self.assertIsInstance(llm_god._lock, type(threading.Lock()))


class LlmGodResolveRealDataTest(unittest.TestCase):
    """The sweep must never invent a result: no prize in the cache means no reward."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self._db = llm_god.DB
        llm_god.DB = Path(self.tmp.name) / 'llm_god.sqlite3'
        self.history = astra.load_existing_astra_history()
        self.target = llm_god.formula_forecast(
            self._next_open_target(), call_model=_stub_model)['target_date']

    def tearDown(self):
        llm_god.DB = self._db
        self.tmp.cleanup()

    def _next_open_target(self):
        from datetime import datetime, timedelta
        today = datetime.now(astra.THAILAND_TZ).date()
        day = today + timedelta(days=1)
        while day.day not in (1, 16):
            day += timedelta(days=1)
        return day.isoformat()

    def test_a_forecast_with_no_landed_draw_stays_pending(self):
        rows = llm_god.resolve_pending(history=self.history)
        self.assertEqual([row['status'] for row in rows], ['pending'])
        self.assertEqual(llm_god.state()['resolved'], 0, 'no result in the cache means no reward')

    def test_a_landed_draw_closes_the_loop_end_to_end(self):
        pool_row = _pool_row()
        landed = list(self.history) + [{'date': self.target, 'prize1': '222222'}]
        rows = llm_god.resolve_pending(history=landed)
        self.assertEqual(rows[0]['status'], 'resolved')
        self.assertEqual(rows[0]['r'], 6)
        self.assertTrue(rows[0]['payout'])
        state = llm_god.state()
        self.assertEqual(state['resolved'], 1)
        self.assertEqual(state['payouts'], 1)
        self.assertTrue(pool_row)


def _pool_row():
    """A cache row with a complete prize 1-5 pool, used to prove r_pool computes."""
    return next((r for r in astra.load_existing_astra_history() if llm_god._pool_numbers(r)), None)


def _stub_model(prompt, *, stage='select', max_tokens=None):
    import json
    payload = {
        'analyse': {'observation': 'o', 'measurement': 'm',
                    'chance_verdict': 'chance-level', 'strategy': 's'},
        'propose': {'candidates': [f'{200000 + i:06d}' for i in range(30)]},
        'critique': {'scored': [{'number': '200000', 'score': 1, 'why': 'w'}],
                     'rejected': [], 'note': 'n'},
        'select': {'numbers': ['111111', '222222', '333333', '444444', '555555'],
                   'rationale': 'r'},
    }[stage]
    return {'content': json.dumps(payload), 'usage': {}, 'latency_ms': 1, 'raw': '{}',
            'model': 'stub'}


if __name__ == '__main__':
    unittest.main(verbosity=2)
