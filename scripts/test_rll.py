"""rll-v1 protocol tests: parse, immutability, failure semantics, reward, bandit state.

No network: the model call is injected. Run with:
    "$LOCALAPPDATA/lottery_stats_runtime/.venv/Scripts/python.exe" scripts/test_rll.py
"""
import json
import sys
import tempfile
import unittest
from datetime import datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import astra  # noqa: E402
import rll  # noqa: E402


def _next_draw(after):
    """The first scheduled draw date strictly after `after`.

    Hard-coding this date rotted the whole file: once the calendar reached it, astra's
    "target must be in the future" rule failed seven tests for a reason that had nothing to do
    with the protocol. A relative target cannot go stale.
    """
    day = after + timedelta(days=1)
    while day.day not in (1, 16):
        day += timedelta(days=1)
    return day


TARGET = _next_draw(datetime.now(astra.THAILAND_TZ).date()).isoformat()
FIVE = '{"numbers":["900001","900002","900003","900004","900005"]}'


def ok_response(content=FIVE):
    return {'content': content, 'usage': {'prompt_tokens': 120}, 'latency_ms': 7, 'raw': '{}'}


class RLLProtocolTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self._db = rll.DB
        rll.DB = Path(self.tmp.name) / 'rll.sqlite3'
        self.calls = []

    def tearDown(self):
        rll.DB = self._db
        self.tmp.cleanup()

    def fake(self, content=FIVE):
        def call(prompt):
            self.calls.append(prompt)
            return ok_response(content)
        return call

    # ── parsing ──────────────────────────────────────────────────────────────
    def test_parse_accepts_object_array_and_fences(self):
        for content in (FIVE, '["900001","900002","900003","900004","900005"]',
                        '```json\n' + FIVE + '\n```'):
            self.assertEqual(rll._parse_numbers(content, set()), json.loads(FIVE)['numbers'])

    def test_parse_rejects_wrong_shapes(self):
        cases = {
            'four numbers': '{"numbers":["900001","900002","900003","900004"]}',
            'duplicate': '{"numbers":["900001","900001","900003","900004","900005"]}',
            'short value': '{"numbers":["9001","900002","900003","900004","900005"]}',
            'prose only': 'I cannot help with that.',
            'truncated json': '{"numbers":["900001"',
        }
        for label, content in cases.items():
            with self.assertRaises(rll.ParseError, msg=label):
                rll._parse_numbers(content, set())

    def test_parse_rejects_reused_input_number(self):
        with self.assertRaises(rll.ParseError) as caught:
            rll._parse_numbers(FIVE, {'900002'})
        self.assertIn('reused', str(caught.exception))

    # ── the call protocol ────────────────────────────────────────────────────
    def test_forecast_then_cached_never_recalls(self):
        payload = rll.formula_forecast(TARGET, call_model=self.fake())
        self.assertEqual(payload['status'], 'ok')
        self.assertEqual(len(payload['numbers']), 5)
        self.assertEqual(payload['protocol'], 'rll-v1')
        self.assertEqual(payload['seed_used'], False)
        self.assertIn('do not reuse any number', payload['prompt'])
        self.assertIn('arm=', payload['prompt'])
        self.assertEqual(len(self.calls), 1)

        again = rll.formula_forecast(TARGET, call_model=self.fake())
        self.assertTrue(again['cached'])
        self.assertEqual(again['numbers'], payload['numbers'])
        self.assertEqual(len(self.calls), 1, 'a stored record must never call the model again')

    def test_unparseable_twice_is_stored_as_unavailable(self):
        payload = rll.formula_forecast(TARGET, call_model=self.fake('no numbers here'))
        self.assertEqual(payload['status'], 'unavailable')
        self.assertEqual(payload['reason'], 'unparseable')
        self.assertEqual(len(payload['attempts']), 2)
        self.assertEqual(len(self.calls), 2)
        self.assertIn('do not repeat any listed number', self.calls[1])

        again = rll.formula_forecast(TARGET, call_model=self.fake())
        self.assertTrue(again['cached'])
        self.assertEqual(again['status'], 'unavailable')
        self.assertEqual(len(self.calls), 2, 'an unavailable record must not be retried later')

    def test_missing_credential_is_not_stored(self):
        def no_key(prompt):
            self.calls.append(prompt)
            raise rll.NoCredential('missing')

        payload = rll.formula_forecast(TARGET, call_model=no_key)
        self.assertEqual(payload['status'], 'unavailable')
        self.assertEqual(payload['reason'], 'no_credential')
        rll.formula_forecast(TARGET, call_model=no_key)
        self.assertEqual(len(self.calls), 2, 'no_credential is a config state, so a later attempt may run')

    def test_permanent_error_is_not_retried(self):
        def rejected(prompt):
            self.calls.append(prompt)
            raise rll.PermanentProviderError(401)

        payload = rll.formula_forecast(TARGET, call_model=rejected)
        self.assertEqual(payload['reason'], 'auth')
        self.assertEqual(len(self.calls), 1)
        self.assertEqual(len(payload['attempts']), 1)

    # ── reward and bandit state ──────────────────────────────────────────────
    def test_resolve_scores_the_closest_candidate_and_updates_the_arm_once(self):
        payload = rll.formula_forecast(TARGET, call_model=self.fake())
        first = payload['numbers'][0]
        result = rll.resolve(TARGET, first)
        self.assertEqual(result['r'], 6)
        self.assertTrue(result['payout'])
        self.assertEqual(result['matched'], first)
        self.assertTrue(result['created'])

        again = rll.resolve(TARGET, '000000')
        self.assertFalse(again['created'])
        self.assertEqual(again['r'], 6, 'a resolved reward is history, not a cache')

        state = rll.state()
        arm = next(a for a in state['arms'] if a['arm'] == payload['arm'])
        self.assertEqual(arm['n'], 1)
        self.assertEqual(arm['sum_r'], 6)
        self.assertEqual(state['resolved'], 1)
        self.assertEqual(state['payouts'], 1)
        self.assertEqual(state['chance']['mean'], rll.CHANCE_MEAN)

    def test_partial_match_reward_is_the_max_over_candidates(self):
        def call(prompt):
            self.calls.append(prompt)
            return ok_response('{"numbers":["123456","000000","999999","111111","222222"]}')
        rll.formula_forecast(TARGET, call_model=call)
        result = rll.resolve(TARGET, '123999')
        self.assertEqual(result['r'], 3)
        self.assertFalse(result['payout'])

    def test_prompt_is_deterministic(self):
        now = datetime.now(astra.THAILAND_TZ)
        payload = rll.formula_forecast(TARGET, call_model=self.fake(), now=now)
        window = astra._history_window(astra.load_existing_astra_history(),
                                       astra.validate_astra_target_date(TARGET, generated_at=now),
                                       now.date(), max_draws=None)
        draws = rll._valid_draws(window)
        one = rll._build_prompt(payload['arm'], draws, (astra.validate_astra_target_date(TARGET, generated_at=now), window), [])
        two = rll._build_prompt(payload['arm'], draws, (astra.validate_astra_target_date(TARGET, generated_at=now), window), [])
        self.assertEqual(one[0], two[0])
        self.assertEqual(one[1], two[1])

    # ── the read path vs the calendar (the 2026-11-16 outage) ────────────────
    def test_a_stored_record_stays_readable_after_its_draw(self):
        """A forecast is evidence for the draw it describes, so it must outlive that draw.

        The original code validated the date before reading the store, so every stored record
        became unreachable the day it was needed — the page asked for the current draw and got a
        422 that blamed missing history.
        """
        payload = rll.formula_forecast(TARGET, call_model=self.fake())
        self.assertEqual(payload['status'], 'ok')
        drawn = datetime.fromisoformat(TARGET).replace(tzinfo=astra.THAILAND_TZ) + timedelta(days=3)
        again = rll.formula_forecast(TARGET, call_model=self.fake(), now=drawn)
        self.assertTrue(again['cached'])
        self.assertEqual(again['numbers'], payload['numbers'])
        self.assertEqual(len(self.calls), 1, 'reading a stored record must never call the model')

    def test_a_closed_draw_without_a_record_is_refused_as_closed(self):
        drawn = datetime.fromisoformat(TARGET).replace(tzinfo=astra.THAILAND_TZ) + timedelta(days=3)
        with self.assertRaises(rll.ClosedTarget):
            rll.formula_forecast(TARGET, call_model=self.fake(), now=drawn)
        self.assertEqual(self.calls, [], 'a closed draw must be refused before any provider call')

    def test_a_past_non_draw_date_is_closed_too(self):
        now = datetime.now(astra.THAILAND_TZ)
        past = (now.date() - timedelta(days=1)).isoformat()
        with self.assertRaises(rll.ClosedTarget):
            rll.formula_forecast(past, call_model=self.fake(), now=now)
        self.assertEqual(self.calls, [])

    def test_draw_day_is_open_only_before_the_cutoff(self):
        day = datetime(2026, 12, 16, tzinfo=astra.THAILAND_TZ)
        morning = day.replace(hour=9)
        evening = day.replace(hour=16, minute=1)
        # morning: the draw has not happened, so the page's own target must be accepted
        payload = rll.formula_forecast('2026-12-16', call_model=self.fake(), now=morning)
        self.assertEqual(payload['status'], 'ok')
        self.assertEqual(payload['target_date'], '2026-12-16')
        # after the cutoff the same date is closed, and it says so instead of blaming history
        rll.DB = Path(self.tmp.name) / 'fresh.sqlite3'
        with self.assertRaises(rll.ClosedTarget):
            rll.formula_forecast('2026-12-16', call_model=self.fake(), now=evening)

    def test_a_non_draw_day_today_is_not_open(self):
        now = datetime(2026, 11, 10, 9, tzinfo=astra.THAILAND_TZ)   # the 10th is not a draw day
        with self.assertRaises(rll.ClosedTarget):
            rll.formula_forecast('2026-11-10', call_model=self.fake(), now=now)

    def test_a_malformed_target_keeps_the_format_error(self):
        with self.assertRaises(astra.AstraInputError) as caught:
            rll.formula_forecast('16/11/2026', call_model=self.fake())
        self.assertIn('YYYY-MM-DD', str(caught.exception))

    def test_state_starts_at_the_prior(self):
        state = rll.state()
        self.assertEqual(len(state['arms']), 6)
        for arm in state['arms']:
            self.assertEqual(arm['n'], 0)
            self.assertAlmostEqual(arm['mean'], rll.CHANCE_MEAN, places=6)


if __name__ == '__main__':
    unittest.main(verbosity=2)
