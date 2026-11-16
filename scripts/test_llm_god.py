"""LLM GOD: the pool is 168 numbers, the pipeline is four stages, and a stored record never moves.

The formula's whole honest content is a number: five tickets expect 0.388 hits across the 462 draws that
carry a complete prize 1-5 pool. These tests pin the pieces that number is computed from — the pool size,
the parser's contract, the stage log — and the rules that keep a stored forecast auditable.
"""
import json
import sys
import tempfile
import time
import unittest
from datetime import date, datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import astra  # noqa: E402
import llm_god  # noqa: E402

FIVE = ['111111', '222222', '333333', '444444', '555555']


def fake_model(prompt, *, stage='select', max_tokens=None):
    """One reply per stage; never touches the network."""
    if stage == 'analyse':
        payload = {'observation': 'o', 'measurement': 'm',
                   'chance_verdict': 'chance-level at best', 'strategy': 's'}
    elif stage == 'propose':
        payload = {'candidates': [f'{100000 + i:06d}' for i in range(30)]}
    elif stage == 'critique':
        payload = {'scored': [{'number': '100000', 'score': 5, 'why': 'w'}],
                   'rejected': ['100029'], 'note': 'n'}
    else:
        payload = {'numbers': FIVE, 'rationale': 'r'}
    return {'content': json.dumps(payload), 'usage': {'total_tokens': 100},
            'latency_ms': 5, 'raw': '{}', 'model': 'fake'}


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self._db = llm_god.DB
        llm_god.DB = Path(self.tmp.name) / 'llm_god.sqlite3'

    def tearDown(self):
        # A queued job holds its database open. Wait for every one of them before the temp dir is removed,
        # or Windows refuses the unlink — and a thread left running would outlive the test that owns it.
        for _ in range(400):
            if not any(key.endswith('#running') for key in list(llm_god._jobs)):
                break
            time.sleep(0.05)
        llm_god.DB = self._db
        llm_god._jobs.clear()
        self.tmp.cleanup()


class PoolTest(Base):
    """The 168 constant the backtest baseline uses has to be the pool the module builds."""

    def test_pool_is_exactly_168_distinct_numbers(self):
        history = astra.load_existing_astra_history()
        row = next(r for r in history if llm_god._pool_numbers(r))
        pool = llm_god._pool_numbers(row)
        self.assertEqual(len(pool), 168)
        self.assertEqual(len(set(pool)), 168)
        self.assertEqual(llm_god.POOL_SIZE, 168)

    def test_incomplete_pool_is_none_not_shorter(self):
        history = astra.load_existing_astra_history()
        row = next(r for r in history if llm_god._pool_numbers(r))
        broken = dict(row)
        broken['prize5'] = ' '.join(['111111'] * 99)
        self.assertIsNone(llm_god._pool_numbers(broken))
        broken = dict(row)
        broken.pop('near1_2')
        self.assertIsNone(llm_god._pool_numbers(broken))

    def test_expected_hits_is_measured_not_typed(self):
        """This is the defect the arena found: 0.388 over 462 draws was a literal no code reproduced."""
        self.assertFalse(hasattr(llm_god, 'EXPECTED_HITS'),
                         'the expected-hits figure must not exist as a module constant')
        history = astra.load_existing_astra_history()
        window = astra._history_window(history, date(2100, 1, 1), date.today(), max_draws=None)
        draws, mean_size, expected = llm_god._corpus_stats(llm_god._pool_draws(window))
        self.assertGreater(draws, 400)
        self.assertAlmostEqual(mean_size, 167.98, places=2)
        self.assertAlmostEqual(expected, 5 * mean_size / 1e6 * draws, places=6)
        # Whole-cache basis: 452 complete-pool draws x 5 tickets x 167.98/1e6. A per-draw payload carries the
        # count strictly before its own target (451 for a future draw), so the card reads it from the response.
        self.assertAlmostEqual(expected, 0.3796, places=3)


class ParserTest(Base):
    def test_accepts_five_distinct_six_digit(self):
        self.assertEqual(llm_god._parse_five(FIVE), FIVE)

    def test_rejects_four(self):
        with self.assertRaises(llm_god.ParseError):
            llm_god._parse_five(FIVE[:4])

    def test_rejects_duplicates(self):
        with self.assertRaises(llm_god.ParseError):
            llm_god._parse_five(['111111'] * 5)

    def test_rejects_short_value(self):
        with self.assertRaises(llm_god.ParseError):
            llm_god._parse_five(FIVE[:4] + ['12345'])

    def test_rejects_non_numeric(self):
        with self.assertRaises(llm_god.ParseError):
            llm_god._parse_five(FIVE[:4] + ['abcdef'])

    def test_analyse_without_strategy_is_a_parse_error(self):
        with self.assertRaises(llm_god.ParseError):
            llm_god._parse_stage('analyse', '{"observation":"o"}')

    def test_propose_dedupes_but_needs_five(self):
        self.assertEqual(len(llm_god._parse_stage('propose', '{"candidates":["111111","111111","222222","333333","444444","555555"]}')), 5)
        with self.assertRaises(llm_god.ParseError):
            llm_god._parse_stage('propose', '{"candidates":["111111","222222"]}')

    def test_fenced_json_is_unwrapped(self):
        fenced = '```json\n' + json.dumps({'numbers': FIVE}) + '\n```'
        self.assertEqual(llm_god._parse_stage('select', fenced), FIVE)


class ArmTest(Base):
    def test_eight_arms_four_analyses_by_two_sizes(self):
        self.assertEqual(len(llm_god.ARM_ORDER), 8)
        self.assertEqual(len(llm_god.ANALYSIS_ARM_SPEC), 4)
        self.assertEqual(llm_god.SIZES, (20, 30))
        for arm in llm_god.ARM_ORDER:
            self.assertIn(llm_god.ARMS[arm]['analysis'], llm_god.ANALYSIS_ARM_SPEC)
            self.assertIn(llm_god.ARMS[arm]['size'], llm_god.SIZES)

    def test_every_arm_gets_a_distinct_factsheet(self):
        history = astra.load_existing_astra_history()
        window = astra._history_window(history, datetime.now(astra.THAILAND_TZ).date() + timedelta(days=30),
                                       datetime.now(astra.THAILAND_TZ).date())
        pools = llm_god._pool_draws(window)
        sheets = {a: tuple(llm_god._analysis_factsheet(a, pools)) for a in llm_god.ANALYSIS_ARM_SPEC}
        for analysis, facts in sheets.items():
            self.assertTrue(facts, f'{analysis} produced no facts')
        self.assertEqual(len(set(sheets.values())), 4, 'two analyses produced identical factsheets')

    def test_arm_choice_is_deterministic_per_target(self):
        history = astra.load_existing_astra_history()
        window = astra._history_window(history, datetime.now(astra.THAILAND_TZ).date() + timedelta(days=30),
                                       datetime.now(astra.THAILAND_TZ).date())
        pools = llm_god._pool_draws(window)
        target = datetime.now(astra.THAILAND_TZ).date() + timedelta(days=30)
        numbers, _, _ = llm_god.run_pipeline(target, llm_god.ARM_ORDER[0], pool_draws=pools,
                                             facts=llm_god._analysis_factsheet('position-frequency', pools),
                                             history_lines=llm_god._history_block(pools), call_model=fake_model)
        self.assertEqual(numbers, FIVE)
        with llm_god.connection() as db:
            rows = llm_god._arm_rows(db)
        first = llm_god._choose_arm(target, rows)
        second = llm_god._choose_arm(target, rows)
        self.assertEqual(first[0], second[0])


class PipelineTest(Base):
    def target(self):
        return datetime.now(astra.THAILAND_TZ).date() + timedelta(days=30)

    def now(self):
        return datetime.now(astra.THAILAND_TZ)

    def test_four_stages_run_and_the_record_is_served_cached(self):
        target = self.target()
        payload = llm_god.formula_forecast(target.isoformat(), call_model=fake_model, now=self.now())
        self.assertEqual(payload['status'], 'ok')
        self.assertEqual(payload['numbers'], FIVE)
        self.assertEqual([s['stage'] for s in payload['stages']],
                         ['analyse', 'propose', 'critique', 'select'])
        self.assertEqual(payload['pool_size'], 168)
        self.assertGreater(payload['pool_draws'], 100)

        def boom(*a, **k):
            raise AssertionError('a stored record must never be recomputed')
        again = llm_god.formula_forecast(target.isoformat(), call_model=boom, now=self.now())
        self.assertTrue(again['cached'])
        self.assertEqual(again['numbers'], FIVE)

    def test_pipeline_that_dies_at_stage_three_stores_the_stages_it_reached(self):
        def dying(prompt, *, stage='select', max_tokens=None):
            if stage == 'critique':
                raise llm_god.ParseError('no JSON in response')
            return fake_model(prompt, stage=stage, max_tokens=max_tokens)

        target = self.target()
        payload = llm_god.formula_forecast(target.isoformat(), call_model=dying, now=self.now())
        self.assertEqual(payload['status'], 'unavailable')
        self.assertEqual(payload['reason'], 'critique')
        self.assertEqual(payload['numbers'], [])
        log = {row['stage']: row['status'] for row in llm_god.stages_for(target.isoformat())}
        self.assertEqual(log.get('analyse'), 'ok')
        self.assertEqual(log.get('propose'), 'ok')
        self.assertEqual(log.get('critique'), 'failed')

    def test_missing_credential_is_recorded_not_raised(self):
        def no_key(prompt, *, stage='select', max_tokens=None):
            raise llm_god.NoCredential('COMMANDCODE_API_KEY is not set')
        target = self.target()
        payload = llm_god.formula_forecast(target.isoformat(), call_model=no_key, now=self.now())
        self.assertEqual(payload['status'], 'unavailable')
        self.assertEqual(payload['reason'], 'analyse')
        log = llm_god.stages_for(target.isoformat())
        self.assertEqual(log[0]['error'], 'no_credential')

    def test_closed_target_refuses_a_new_registration(self):
        past = (datetime.now(astra.THAILAND_TZ).date() - timedelta(days=20)).isoformat()
        with self.assertRaises(llm_god.ClosedTarget):
            llm_god.formula_forecast(past, call_model=fake_model, now=self.now())

    def test_cutoff_is_1600_on_a_draw_day(self):
        draw_day = datetime(2026, 12, 1).date()
        early = datetime(2026, 12, 1, 9, 0, tzinfo=astra.THAILAND_TZ)
        late = datetime(2026, 12, 1, 17, 0, tzinfo=astra.THAILAND_TZ)
        self.assertTrue(llm_god._target_is_open(draw_day, early))
        self.assertFalse(llm_god._target_is_open(draw_day, late))

    def test_prompt_carries_the_whole_pool_history(self):
        seen = {}

        def capture(prompt, *, stage='select', max_tokens=None):
            seen.setdefault(stage, len(prompt))
            return fake_model(prompt, stage=stage, max_tokens=max_tokens)

        target = self.target()
        llm_god.formula_forecast(target.isoformat(), call_model=capture, now=self.now())
        # The analyse stage is the one that gets the book; the other stages are trimmed on purpose.
        self.assertGreater(seen['analyse'], 300_000)
        self.assertLess(seen['propose'], seen['analyse'] / 5)


class ResolveTest(Base):
    def seed(self):
        target = (datetime.now(astra.THAILAND_TZ).date() + timedelta(days=30)).isoformat()
        llm_god.formula_forecast(target, call_model=fake_model, now=datetime.now(astra.THAILAND_TZ))
        return target

    def test_resolve_scores_both_rewards_and_is_idempotent(self):
        target = self.seed()
        history = astra.load_existing_astra_history()
        results = llm_god._results_by_date(history)
        day = next(d for d in results if results[d][1])
        prize1, pool = results[day]
        first = llm_god.resolve(target, prize1, pool)
        self.assertTrue(first['created'])
        self.assertIsInstance(first['r'], int)
        self.assertIsNotNone(first['r_pool'])
        second = llm_god.resolve(target, prize1, pool)
        self.assertFalse(second['created'])
        self.assertEqual(first['r'], second['r'])

    def test_resolve_pending_reports_pending_for_a_future_draw(self):
        target = self.seed()
        rows = llm_god.resolve_pending()
        self.assertEqual([r for r in rows if r['target_date'] == target][0]['status'], 'pending')

    def test_resolve_pending_dry_run_writes_nothing(self):
        self.seed()
        history = astra.load_existing_astra_history()
        llm_god.resolve_pending(history, dry_run=True)
        self.assertEqual(llm_god.state()['resolved'], 0)

    def test_resolve_without_a_pool_looks_it_up_from_the_cache(self):
        """An API caller posts only prize1; r_pool must still populate when the draw has a full pool."""
        history = astra.load_existing_astra_history()
        results = llm_god._results_by_date(history)
        day, (prize1, pool) = next((d, v) for d, v in results.items() if v[1])
        payload = {'ok': True, 'protocol': llm_god.PROTOCOL, 'target_date': day.isoformat(),
                   'status': 'ok', 'arm': llm_god.ARM_ORDER[0],
                   'numbers': [prize1, '000001', '000002', '000003', '000004']}
        with llm_god.connection() as db:
            llm_god._store_record(db, day, payload)
        out = llm_god.resolve(day.isoformat(), prize1)       # pool deliberately omitted
        self.assertEqual(out['r'], 6)
        self.assertEqual(out['r_pool'], 6, 'r_pool must be looked up, not left null')
        self.assertTrue(out['payout'])

    def test_a_queued_job_cannot_land_in_a_rebound_database(self):
        """A background job must write to the file it started on, never to whatever `DB` became.

        This is a real incident, not a hypothetical: a test that swapped `llm_god.DB` to a temp dir and
        then restored it left its thread running, and the thread wrote a stub record into the production
        `astra_runtime/llm_god.sqlite3` because `connection()` read the global at call time.
        """
        pinned = Path(self.tmp.name) / 'pinned.sqlite3'
        decoy = Path(self.tmp.name) / 'decoy.sqlite3'
        target = datetime.now(astra.THAILAND_TZ).date() + timedelta(days=30)
        llm_god.ensure_precomputed(target.isoformat(), call_model=fake_model,
                                   now=datetime.now(astra.THAILAND_TZ), db_path=pinned)
        llm_god.DB = decoy                       # simulate the module global moving under the thread
        for _ in range(200):
            if llm_god.job_status(target.isoformat()) in ('done',) or \
                    str(llm_god.job_status(target.isoformat())).startswith('failed'):
                break
            time.sleep(0.05)
        with llm_god.connection(pinned) as db:
            rows = db.execute('SELECT COUNT(*) FROM llm_god_forecasts').fetchone()[0]
        self.assertEqual(rows, 1, 'the record must be in the pinned database')
        self.assertFalse(decoy.exists(), 'a rebound DB must never receive the queued job\'s record')

    def test_state_quotes_the_honest_constants(self):
        state = llm_god.state()
        self.assertEqual(state['field'], 'pool6')
        self.assertEqual(state['board'], 'Pool 1-5')
        self.assertEqual(state['pool_size'], 168)
        self.assertGreater(state['corpus_draws'], 400)
        self.assertAlmostEqual(state['pool_mean_size'], 167.98, places=2)
        self.assertAlmostEqual(state['expected_hits'], 0.3796, places=3)
        self.assertEqual(len(state['arms']), 8)
        self.assertIn('no demonstrated edge', state['evidence'])


class PrecomputeTest(Base):
    def test_pending_read_starts_the_job_and_never_blocks(self):
        target = datetime.now(astra.THAILAND_TZ).date() + timedelta(days=30)
        first = llm_god.ensure_precomputed(target.isoformat(), call_model=fake_model,
                                           now=datetime.now(astra.THAILAND_TZ),
                                           db_path=llm_god.DB)
        self.assertIn(first['status'], ('pending', 'running'))
        # Let the thread finish before tearDown removes its database, so this test never leaks a job.
        llm_god.ensure_precomputed(target.isoformat(), call_model=fake_model,
                                   now=datetime.now(astra.THAILAND_TZ),
                                   db_path=llm_god.DB, wait=True)

    def test_waiting_variant_returns_the_record(self):
        target = datetime.now(astra.THAILAND_TZ).date() + timedelta(days=31)
        result = llm_god.ensure_precomputed(target.isoformat(), call_model=fake_model,
                                            now=datetime.now(astra.THAILAND_TZ), wait=True)
        self.assertEqual(result['status'], 'ok')
        self.assertEqual(result['numbers'], FIVE)


if __name__ == '__main__':
    unittest.main(verbosity=2)
