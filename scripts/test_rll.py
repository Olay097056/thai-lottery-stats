"""rll-v1 protocol tests: parse, immutability, failure semantics, reward, bandit state.

No network: the model call is injected. Run with:
    "$LOCALAPPDATA/lottery_stats_runtime/.venv/Scripts/python.exe" scripts/test_rll.py
"""
import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import rll  # noqa: E402

TARGET = '2026-11-16'
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
        payload = rll.formula_forecast(TARGET, call_model=self.fake())
        draws = rll._valid_draws(rll.astra._history_window(
            rll.astra.load_existing_astra_history(),
            rll.astra.validate_astra_target_date(TARGET),
            rll.datetime.now(rll.astra.THAILAND_TZ).date(), max_draws=None))
        window = rll.astra._history_window(rll.astra.load_existing_astra_history(),
                                           rll.astra.validate_astra_target_date(TARGET),
                                           rll.datetime.now(rll.astra.THAILAND_TZ).date(), max_draws=None)
        one = rll._build_prompt(payload['arm'], draws, (rll.astra.validate_astra_target_date(TARGET), window), [])
        two = rll._build_prompt(payload['arm'], draws, (rll.astra.validate_astra_target_date(TARGET), window), [])
        self.assertEqual(one[0], two[0])
        self.assertEqual(one[1], two[1])

    def test_state_starts_at_the_prior(self):
        state = rll.state()
        self.assertEqual(len(state['arms']), 6)
        for arm in state['arms']:
            self.assertEqual(arm['n'], 0)
            self.assertAlmostEqual(arm['mean'], rll.CHANCE_MEAN, places=6)


if __name__ == '__main__':
    unittest.main(verbosity=2)
