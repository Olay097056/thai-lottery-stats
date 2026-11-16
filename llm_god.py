"""LLM GOD — five tickets from a four-stage LLM pipeline, scored on the prize 1-5 pool.

Protocol `llm-god-v1`. Companion to `rll.py`, deliberately separate: its own database, its own protocol,
its own arms. RLL answers "how many positions match prize 1"; LLM GOD answers "which five tickets would you
buy for the prize 1-5 board".

What the numbers say, and why they live in the module rather than only in the docs:

  * The scored field is `pool6` — the 168 numbers a ticket can match across prizes 1-5 (1 + 2 near + 5 + 10
    + 50 + 100). Over the 462 draws that carry a complete pool, five tickets expect **0.388 hits**: one hit
    per ~1,191 draws, about fifty years at 24 draws a year. Nothing here can be proven in a lifetime, so the
    card must never imply otherwise.
  * The bandit's reward is the prize-1 proxy (mean 1.495846, sd 0.717875) because it is the statistic this
    formula actually optimises. The pool-168 statistic (mean 3.7103, sd 0.5487, measured over 3,000
    fixed-pool replicates) is stored beside it in `r_pool` as a readout only, never as the arm's score.
  * Every six-digit ticket has the same probability in every tier, so no arrangement of five tickets beats
    another in expectation. The pipeline searches for structure; the honest claim is "five tickets you can
    buy", never "better odds".

Design rules, mirroring RLL's and enforced by tests:
  * a stored record is never recomputed — there is no re-roll path;
  * a failed pipeline is stored with its stage log, so a partial run is inspectable instead of invisible;
  * the model call is injectable, so tests never touch the network;
  * the five tickets are distinct six-digit strings or the answer is rejected.
"""
from __future__ import annotations

import hashlib
import json
import math
import os
import random
import re
import sqlite3
import threading
from contextlib import contextmanager
from datetime import date, datetime
from pathlib import Path

import httpx

import astra

PROTOCOL = 'llm-god-v1'
MODEL = os.environ.get('LLM_GOD_MODEL', 'deepseek/deepseek-v4.1-flash')
BASE_URL = os.environ.get('LLM_GOD_BASE_URL', 'https://api.commandcode.ai/provider/v1')
MIN_VALID_DRAWS = 20
DRAW_CUTOFF_HOUR = 16          # nextDrawInfo() on the page rolls its target over at 16:00 Thai time
CANDIDATES = 5
N0 = 48.0                      # pseudo-draws of prior per arm

CHANCE_MEAN = 1.495846         # exact chance mean of max matched positions over 5 tickets vs one prize1
CHANCE_SD = 0.717875
POOL_CHANCE_MEAN = 3.7103      # simulated, 3,000 fixed-pool replicates of the same statistic vs 168 numbers
POOL_CHANCE_SD = 0.5487

POOL_SIZE = 168                # 1 prize1 + 2 near-first + 5 prize2 + 10 prize3 + 50 prize4 + 100 prize5
EXPECTED_HITS = 0.388          # five tickets against the 462 draws that carry a complete pool

TEMPERATURE = 0
TIMEOUT = httpx.Timeout(300.0, connect=10.0)
STAGE_TOKEN_BUDGET = {'analyse': 8000, 'propose': 8000, 'critique': 6000, 'select': 3000}
STAGE_ORDER = ('analyse', 'propose', 'critique', 'select')
RECENT_DRAWS_IN_PROPOSE = 40

ROOT = Path(__file__).parent
DB = Path(os.environ.get('LLM_GOD_DB') or (ROOT / 'astra_runtime' / 'llm_god.sqlite3'))

# ── the eight arms: four analysis emphases × two candidate-set sizes ──────────
ANALYSIS_ARM_SPEC = {
    'position-frequency':
        'the frequency of each digit in each of the six positions, weighed against a uniform null',
    'gap-structure':
        'the number of draws since each digit last appeared in each position, and whether that gap carries '
        'any information at all (it should not — this arm exists so it can be falsified)',
    'inter-digit':
        'dependence between positions: whether any ordered pair of positions co-occurs beyond what '
        'independence predicts, at this sample size',
    'pool-cross-tier':
        'how a number\'s digit shape relates to the prize tier it landed in, and whether the tiers differ '
        'in digit composition',
}
SIZES = (20, 30)
ARM_ORDER = tuple(f'{analysis}@{size}' for analysis in ANALYSIS_ARM_SPEC for size in SIZES)
ARMS = {arm: {'analysis': arm.rsplit('@', 1)[0], 'size': int(arm.rsplit('@', 1)[1])} for arm in ARM_ORDER}

_lock = threading.Lock()
_job_lock = threading.Lock()
_jobs: dict[str, str] = {}     # '#running' guard plus a human-readable status


class NoCredential(RuntimeError):
    """The provider key is missing; a configuration state, not an attempt."""


class PermanentProviderError(RuntimeError):
    def __init__(self, status):
        super().__init__(f'provider rejected the request: HTTP {status}')
        self.status = status


class RetryableProviderError(RuntimeError):
    def __init__(self, status, detail=''):
        super().__init__(f'provider error: HTTP {status} {detail}'.strip())
        self.status = status


class ParseError(RuntimeError):
    """The stage's response did not satisfy its contract."""


class ClosedTarget(ValueError):
    """The target draw has already happened, so no new forecast may be registered for it."""


@contextmanager
def connection(db_path=None):
    """Open the forecast database. `db_path` exists so a background job can pin the file it started on:
    the module global `DB` may be rebound (a test, a CLI) between the job's launch and its write, and a
    thread that reads the global at call time can land its record in whatever database is current — which
    is how a test fixture once wrote into production."""
    target = Path(db_path) if db_path else DB
    target.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(target, timeout=15)
    try:
        with db:
            db.execute('CREATE TABLE IF NOT EXISTS llm_god_forecasts (target_date TEXT, protocol TEXT,'
                       ' payload TEXT, PRIMARY KEY (target_date, protocol))')
            db.execute('CREATE TABLE IF NOT EXISTS llm_god_rewards (target_date TEXT, protocol TEXT,'
                       ' r INTEGER, r_pool INTEGER, payout INTEGER, matched TEXT, pool_matched TEXT,'
                       ' resolved_at TEXT, PRIMARY KEY (target_date, protocol))')
            db.execute('CREATE TABLE IF NOT EXISTS llm_god_arms (protocol TEXT, arm_id TEXT, n INTEGER,'
                       ' sum_r REAL, PRIMARY KEY (protocol, arm_id))')
            db.execute('CREATE TABLE IF NOT EXISTS llm_god_stages (target_date TEXT, protocol TEXT,'
                       ' stage TEXT, status TEXT, latency_ms INTEGER, usage TEXT, error TEXT,'
                       ' PRIMARY KEY (target_date, protocol, stage))')
            yield db
    finally:
        db.close()


# ─── target date ─────────────────────────────────────────────────────────────

def _canonical_target(target_date):
    if not isinstance(target_date, str) or not astra._DATE.fullmatch(target_date):
        raise astra.AstraInputError('วันที่เป้าหมายต้องอยู่ในรูป YYYY-MM-DD')
    try:
        return date.fromisoformat(target_date)
    except ValueError:
        raise astra.AstraInputError('วันที่เป้าหมายไม่ถูกต้อง') from None


def _target_is_open(target, now):
    """True while a new forecast may still be registered for this draw.

    Same rule as RLL: the page offers *today* until 16:00 on a draw day, so the cutoff — not the calendar
    day — is the boundary. Computing a record for a draw whose numbers are already public would produce a
    forecast that only looks prescient.
    """
    today = now.date()
    if target > today:
        return True
    if target < today:
        return False
    return target.day in (1, 16) and now.hour < DRAW_CUTOFF_HOUR


# ─── history ─────────────────────────────────────────────────────────────────

def _pool_numbers(row):
    """Every number a ticket can match across prizes 1-5, or None when the pool is incomplete.

    The 168 constant the backtest baseline uses counts the two near-first prizes, so they are included here.
    RLL's own `_pool_numbers` stops at prize5 (166) because its card scores against prize1 only; diverging
    here is deliberate, and the 168 total is asserted in the tests.
    """
    first = astra._category_values(row, 'prize1', 6)
    if first is None:
        return None
    numbers = [first[0]]
    for key in ('near1_1', 'near1_2'):
        value = row.get(key)
        if not (isinstance(value, str) and re.fullmatch(r'[0-9]{6}', value)):
            return None
        numbers.append(value)
    for key in ('prize2', 'prize3', 'prize4'):
        values = astra._category_values(row, key, 6)
        if values is None:
            return None
        numbers.extend(values)
    fifth = row.get('prize5')
    if not isinstance(fifth, str):
        return None
    fifths = fifth.split()
    if len(fifths) != 100 or not all(re.fullmatch(r'[0-9]{6}', v) for v in fifths):
        return None
    numbers.extend(fifths)
    return numbers


def _valid_draws(window):
    """[(draw_date, prize1)] newest first, rows with a usable first prize only."""
    draws = []
    for draw_date, row in window:
        values = astra._category_values(row, 'prize1', 6)
        if values is None:
            continue
        draws.append((draw_date, values[0]))
    return draws


def _pool_draws(window):
    """[(draw_date, [pool numbers])] newest first, rows with a complete pool only."""
    out = []
    for draw_date, row in window:
        pool = _pool_numbers(row)
        if pool is None:
            continue
        out.append((draw_date, pool))
    return out


def _history_block(pool_draws, limit=None):
    """One line per draw, oldest first. Sending the whole book is the point of the 'no token limit' brief."""
    rows = pool_draws[:limit] if limit else pool_draws
    return [f'{draw_date.isoformat()} ' + ' '.join(pool) for draw_date, pool in reversed(rows)]


def _analysis_factsheet(analysis, pool_draws):
    """The per-arm statistic. An arm that only rewords the question changes nothing, so each gets a view."""
    recent = pool_draws[:60]
    facts = []
    if analysis == 'position-frequency':
        weights = [[0] * 10 for _ in range(6)]
        for _, pool in recent:
            for number in pool:
                for position, char in enumerate(number):
                    weights[position][int(char)] += 1
        for position in range(6):
            ranked = sorted(range(10), key=lambda d: (-weights[position][d], d))
            facts.append(f'position {position}: ' +
                         ' '.join(f'{d}:{weights[position][d]}' for d in ranked[:4]))
    elif analysis == 'gap-structure':
        for position in range(6):
            gaps = []
            for digit in range(10):
                gap = next((age for age, (_, pool) in enumerate(recent)
                            if any(n[position] == str(digit) for n in pool)), len(recent))
                gaps.append((gap, digit))
            gaps.sort(reverse=True)
            facts.append(f'position {position}: ' + ' '.join(f'{d}:{g}' for g, d in gaps[:4]))
    elif analysis == 'inter-digit':
        for position in range(5):
            table = {}
            for _, pool in recent:
                for number in pool:
                    key = number[position] + number[position + 1]
                    table[key] = table.get(key, 0) + 1
            ranked = sorted(table.items(), key=lambda item: (-item[1], item[0]))[:3]
            facts.append(f'positions {position}->{position + 1}: ' +
                         ' '.join(f'{pair}:{count}' for pair, count in ranked))
    elif analysis == 'pool-cross-tier':
        # Pool order is prize1(1) near(2) prize2(5) prize3(10) prize4(50) prize5(100).
        for name, offset, count in (('prize1', 0, 1), ('near1', 1, 2), ('prize2', 3, 5),
                                    ('prize3', 8, 10), ('prize4', 18, 50), ('prize5', 68, 100)):
            sums = [0] * 6
            seen = 0
            for _, pool in recent:
                for number in pool[offset:offset + count]:
                    for position, char in enumerate(number):
                        sums[position] += int(char)
                    seen += 1
            if seen:
                facts.append(f'{name} mean digit per position: ' +
                             ' '.join(f'{s / seen:.2f}' for s in sums))
    else:
        raise ValueError(f'unknown analysis: {analysis}')
    return facts


def _fingerprint(draws, pool_draws):
    payload = json.dumps({'draws': [[d.isoformat(), v] for d, v in draws],
                          'pools': [[d.isoformat(), len(p)] for d, p in pool_draws]},
                         separators=(',', ':'))
    return hashlib.sha256(payload.encode()).hexdigest()


# ─── the four stages ─────────────────────────────────────────────────────────

def _stage_prompt(stage, *, target, arm, facts=None, history_lines=None, analysis=None,
                  candidates=None, critique=None):
    spec = ANALYSIS_ARM_SPEC[ARMS[arm]['analysis']]
    size = ARMS[arm]['size']

    if stage == 'analyse':
        parts = [
            f'protocol={PROTOCOL} target={target.isoformat()} arm={arm}',
            f'This arm asks you to examine {spec}.',
            'You are given every draw that carries a complete prize 1-5 pool, oldest first. Each line is',
            'DATE followed by 168 six-digit numbers in tier order: prize1 (1), near-first (2), prize2 (5),',
            'prize3 (10), prize4 (50), prize5 (100).',
            'history (oldest first):',
            *(history_lines or []),
            'computed facts for this arm:',
            *(facts or []),
            'Analyse the history as this arm specifies. Say what you measured, what it shows, and —',
            'explicitly — whether the effect is distinguishable from chance at this sample size.',
            'Reply with exactly this JSON and nothing else:',
            '{"observation":"…","measurement":"…","chance_verdict":"…","strategy":"…"}',
        ]
    elif stage == 'propose':
        parts = [
            f'protocol={PROTOCOL} target={target.isoformat()} arm={arm}',
            'Your analysis:',
            json.dumps(analysis, ensure_ascii=False),
            'Recent draws (oldest first), same 168-number tier order:',
            *(history_lines or []),
            f'Propose exactly {size} candidate six-digit tickets that follow the strategy above.',
            'Every one must be a six-digit string and no two may be identical.',
            'Reply with exactly this JSON and nothing else:',
            '{"candidates":["000000","…"]}',
        ]
    elif stage == 'critique':
        parts = [
            f'protocol={PROTOCOL} target={target.isoformat()} arm={arm}',
            'Your analysis:',
            json.dumps(analysis, ensure_ascii=False),
            'Your candidates:',
            json.dumps(candidates, ensure_ascii=False),
            'Critique every candidate against the analysis. Be adversarial: a candidate you cannot justify',
            'from a measurement is a candidate to reject. Score each 0-10 and say what would falsify it.',
            'Reply with exactly this JSON and nothing else:',
            '{"scored":[{"number":"000000","score":0,"why":"…"}],"rejected":["000000"],"note":"…"}',
        ]
    elif stage == 'select':
        parts = [
            f'protocol={PROTOCOL} target={target.isoformat()} arm={arm}',
            'Your critique:',
            json.dumps(critique, ensure_ascii=False),
            'Your candidates:',
            json.dumps(candidates, ensure_ascii=False),
            f'Return exactly {CANDIDATES} distinct six-digit tickets chosen from the candidates above,',
            'ordered so the first is the one your critique supports most strongly. Never return a number',
            'from your own rejected list.',
            'Reply with exactly this JSON and nothing else:',
            '{"numbers":["000000","000000","000000","000000","000000"],"rationale":"…"}',
        ]
    else:
        raise ValueError(f'unknown stage: {stage}')
    return '\n'.join(parts)


def _parse_five(numbers):
    """Exactly five distinct six-digit strings, or a ParseError naming what was wrong."""
    if not isinstance(numbers, list) or len(numbers) != CANDIDATES:
        got = len(numbers) if isinstance(numbers, list) else 0
        raise ParseError(f'expected exactly {CANDIDATES} numbers, got {got}')
    cleaned = [str(value) for value in numbers]
    if any(not re.fullmatch(r'[0-9]{6}', value) for value in cleaned):
        raise ParseError('non six-digit value')
    if len(set(cleaned)) != CANDIDATES:
        raise ParseError('duplicate tickets')
    return cleaned


def _parse_stage(stage, content):
    text = (content or '').strip()
    text = re.sub(r'^```[a-zA-Z]*\s*', '', text)
    text = re.sub(r'\s*```$', '', text)
    start = min([i for i in (text.find('{'), text.find('[')) if i >= 0], default=-1)
    if start < 0:
        raise ParseError('no JSON in response')
    try:
        payload = json.loads(text[start:])
    except json.JSONDecodeError:
        raise ParseError('invalid JSON') from None

    if stage == 'analyse':
        if not isinstance(payload, dict) or not payload.get('strategy'):
            raise ParseError('analysis carried no strategy')
        return payload
    if stage == 'propose':
        candidates = payload.get('candidates') if isinstance(payload, dict) else payload
        if not isinstance(candidates, list) or len(candidates) < CANDIDATES:
            raise ParseError('fewer candidates than five')
        cleaned = [str(v) for v in candidates]
        if any(not re.fullmatch(r'[0-9]{6}', v) for v in cleaned):
            raise ParseError('non six-digit candidate')
        unique = list(dict.fromkeys(cleaned))
        if len(unique) < CANDIDATES:
            raise ParseError('fewer than five distinct candidates')
        return unique
    if stage == 'critique':
        if not isinstance(payload, dict) or not isinstance(payload.get('scored'), list):
            raise ParseError('critique carried no scores')
        return payload
    if stage == 'select':
        numbers = payload.get('numbers') if isinstance(payload, dict) else payload
        return _parse_five(numbers)
    raise ValueError(f'unknown stage: {stage}')


# ─── model call ──────────────────────────────────────────────────────────────

def _env_key():
    key = os.environ.get('COMMANDCODE_API_KEY')
    if key:
        return key.strip()
    env_file = ROOT / '.env'
    if env_file.exists():
        for line in env_file.read_text(encoding='utf-8', errors='replace').splitlines():
            line = line.strip()
            if not line or line.startswith('#') or '=' not in line:
                continue
            name, value = line.split('=', 1)
            if name.strip() == 'COMMANDCODE_API_KEY' and value.strip():
                return value.strip()
    return None


def _redact(text, key):
    return text.replace(key, '***') if key and key in text else text


def _call_model(prompt, *, stage='select', max_tokens=None):
    """Default provider call; tests replace this. One stage = one call."""
    key = _env_key()
    if not key:
        raise NoCredential('COMMANDCODE_API_KEY is not set')
    body = {
        'model': MODEL,
        'messages': [
            {'role': 'system', 'content': 'You output JSON only. You never narrate.'},
            {'role': 'user', 'content': prompt},
        ],
        'temperature': TEMPERATURE,
        'max_tokens': max_tokens or STAGE_TOKEN_BUDGET.get(stage, 4000),
    }
    started = datetime.now()
    try:
        response = httpx.post(f'{BASE_URL}/chat/completions',
                              headers={'Authorization': f'Bearer {key}',
                                       'Content-Type': 'application/json'},
                              json=body, timeout=TIMEOUT)
    except httpx.HTTPError as exc:
        raise RetryableProviderError('timeout', _redact(str(exc), key)) from None
    latency_ms = int((datetime.now() - started).total_seconds() * 1000)
    if response.status_code in (400, 401, 403, 404):
        raise PermanentProviderError(response.status_code)
    if response.status_code != 200:
        raise RetryableProviderError(response.status_code, _redact(response.text[:300], key))
    payload = response.json()
    choice = (payload.get('choices') or [{}])[0]
    content = (choice.get('message') or {}).get('content') or ''
    if choice.get('finish_reason') == 'length':
        raise ParseError('response truncated')
    return {'content': content, 'usage': payload.get('usage') or {}, 'raw': response.text,
            'latency_ms': latency_ms, 'model': payload.get('model')}


# ─── bandit ──────────────────────────────────────────────────────────────────

def _arm_rows(db):
    rows = {arm: {'n': 0, 'sum_r': 0.0} for arm in ARM_ORDER}
    for arm_id, n, sum_r in db.execute('SELECT arm_id, n, sum_r FROM llm_god_arms WHERE protocol=?',
                                       (PROTOCOL,)):
        if arm_id in rows:
            rows[arm_id] = {'n': int(n), 'sum_r': float(sum_r)}
    return rows


def _choose_arm(target_date, rows):
    """Thompson sampling with the null sigma and an n0 prior; deterministic per (date, protocol)."""
    seed = int(hashlib.sha256(f'{target_date.isoformat()}|{PROTOCOL}'.encode()).hexdigest()[:16], 16)
    rng = random.Random(seed)
    samples = {}
    for arm in ARM_ORDER:
        state = rows[arm]
        mean = (N0 * CHANCE_MEAN + state['sum_r']) / (N0 + state['n'])
        sd = CHANCE_SD / math.sqrt(N0 + state['n'])
        samples[arm] = mean + sd * rng.gauss(0.0, 1.0)
    chosen = max(ARM_ORDER, key=lambda arm: samples[arm])
    return chosen, samples


# ─── storage ─────────────────────────────────────────────────────────────────

def _target_key(target_date):
    return target_date.isoformat() if hasattr(target_date, 'isoformat') else str(target_date)


def _load_record(db, target_date):
    row = db.execute('SELECT payload FROM llm_god_forecasts WHERE target_date=? AND protocol=?',
                     (_target_key(target_date), PROTOCOL)).fetchone()
    return json.loads(row[0]) if row else None


def _store_record(db, target_date, payload):
    db.execute('INSERT OR IGNORE INTO llm_god_forecasts VALUES (?,?,?)',
               (_target_key(target_date), PROTOCOL, json.dumps(payload, ensure_ascii=False)))


def _store_stage(db, target_date, record):
    db.execute('INSERT INTO llm_god_stages VALUES (?,?,?,?,?,?,?)'
               ' ON CONFLICT(target_date, protocol, stage) DO UPDATE SET'
               ' status=excluded.status, latency_ms=excluded.latency_ms,'
               ' usage=excluded.usage, error=excluded.error',
               (_target_key(target_date), PROTOCOL, record['stage'], record['status'],
                record.get('latency_ms'),
                json.dumps(record.get('usage'), ensure_ascii=False) if record.get('usage') else None,
                record.get('error')))


def _live_context(db, payload):
    """Current arm state and this draw's reward, derived at read time without rewriting the record."""
    payload['arm_state_now'] = {arm: dict(state) for arm, state in _arm_rows(db).items()}
    row = db.execute('SELECT r, r_pool, payout, matched, pool_matched, resolved_at FROM llm_god_rewards'
                     ' WHERE target_date=? AND protocol=?',
                     (payload.get('target_date'), PROTOCOL)).fetchone()
    payload['reward'] = (None if row is None else
                         {'r': int(row[0]), 'r_pool': None if row[1] is None else int(row[1]),
                          'payout': bool(row[2]), 'matched': row[3], 'pool_matched': row[4],
                          'resolved_at': row[5]})
    return payload


def stages_for(target_date):
    """The stage log for one draw — what actually ran, and where it stopped."""
    with connection() as db:
        return [{'stage': stage, 'status': status, 'latency_ms': latency_ms,
                 'usage': json.loads(usage) if usage else None, 'error': error}
                for stage, status, latency_ms, usage, error in db.execute(
                    'SELECT stage, status, latency_ms, usage, error FROM llm_god_stages'
                    ' WHERE target_date=? AND protocol=? ORDER BY rowid',
                    (_target_key(target_date), PROTOCOL))]


# ─── the pipeline ────────────────────────────────────────────────────────────

def _run_stage(stage, prompt, call_model, on_stage=None):
    """One stage, one retry. Returns (parsed value or None, record). Never raises.

    The record is emitted through `on_stage` before returning, so a pipeline that dies at stage 3 leaves
    stages 1 and 2 persisted — otherwise "failed" and "never ran" look identical from the database.
    """
    record: dict = {'stage': stage, 'status': 'ok', 'latency_ms': 0, 'usage': None, 'error': None,
                    'attempts': 0, 'prompt_sha256': hashlib.sha256(prompt.encode()).hexdigest()}
    for attempt_no in (1, 2):
        text = prompt if attempt_no == 1 else (
            prompt + '\nretry: the previous answer did not satisfy the contract. Return only the JSON'
                     ' object described above, with nothing before or after it.')
        try:
            result = call_model(text, stage=stage,
                                max_tokens=STAGE_TOKEN_BUDGET[stage] * (3 if attempt_no == 2 else 1))
            record['latency_ms'] = (record['latency_ms'] or 0) + (result.get('latency_ms') or 0)
            record['usage'] = result.get('usage')
            record['prompt_sha256'] = hashlib.sha256(text.encode()).hexdigest()
            record['attempts'] = attempt_no
            record['status'] = 'ok' if attempt_no == 1 else 'ok_on_retry'
            value = _parse_stage(stage, result['content'])
            if on_stage:
                on_stage(record)
            return value, record
        except (NoCredential, PermanentProviderError, RetryableProviderError, ParseError) as exc:
            record['attempts'] = attempt_no
            record['error'] = str(exc)
            if isinstance(exc, NoCredential):
                record['status'] = 'failed'
                record['error'] = 'no_credential'
                break
            if isinstance(exc, PermanentProviderError):
                record['status'] = 'failed'
                record['error'] = f'provider HTTP {exc.status}'
                break
            record['status'] = 'retried' if attempt_no == 1 else 'failed'
            if attempt_no == 2:
                break
    if on_stage:
        on_stage(record)
    return None, record


def run_pipeline(target, arm, *, pool_draws, facts, history_lines, call_model, on_stage=None):
    """Four stages, each one model call, oldest first. Returns (numbers, records, parts)."""
    records = []
    parts: dict = {'analysis': None, 'critique': None, 'candidates': None}

    analysis, rec = _run_stage('analyse', _stage_prompt(
        'analyse', target=target, arm=arm, facts=facts, history_lines=history_lines),
        call_model, on_stage)
    records.append(rec)
    parts['analysis'] = analysis
    if analysis is None:
        return None, records, parts

    recent_lines = _history_block(pool_draws, RECENT_DRAWS_IN_PROPOSE)
    candidates, rec = _run_stage('propose', _stage_prompt(
        'propose', target=target, arm=arm, history_lines=recent_lines, analysis=analysis),
        call_model, on_stage)
    records.append(rec)
    parts['candidates'] = candidates
    if candidates is None:
        return None, records, parts

    critique, rec = _run_stage('critique', _stage_prompt(
        'critique', target=target, arm=arm, analysis=analysis, candidates=candidates),
        call_model, on_stage)
    records.append(rec)
    parts['critique'] = critique
    if critique is None:
        return None, records, parts

    numbers, rec = _run_stage('select', _stage_prompt(
        'select', target=target, arm=arm, candidates=candidates, critique=critique),
        call_model, on_stage)
    records.append(rec)
    return numbers, records, parts


# ─── public API ──────────────────────────────────────────────────────────────

def formula_forecast(target_date, *, call_model=None, now=None, db_path=None):
    """Read or compute the five LLM GOD tickets for one target draw.

    A stored record is served BEFORE any date rule runs — a forecast is the evidence for the draw it
    describes, so it stays readable after that draw has been drawn. `_target_is_open` gates new
    registrations only. `db_path` pins the database file, which a background job must do.
    """
    call_model = call_model or _call_model
    now = now or datetime.now(astra.THAILAND_TZ)
    target = _canonical_target(target_date)

    with _lock, connection(db_path) as db:
        stored = _load_record(db, target)
        if stored is not None:
            stored['cached'] = True
            return _live_context(db, stored)

        if not _target_is_open(target, now):
            raise ClosedTarget('target draw already happened')

        history = astra.load_existing_astra_history()
        window = astra._history_window(history, target, now.date(), max_draws=None)
        draws = _valid_draws(window)
        pool_draws = _pool_draws(window)
        if len(draws) < MIN_VALID_DRAWS:
            raise ValueError(f'ต้องมีข้อมูลรางวัลที่ 1 อย่างน้อย {MIN_VALID_DRAWS} งวดก่อนหน้านี้')
        if len(pool_draws) < MIN_VALID_DRAWS:
            raise ValueError(f'ต้องมีงวดที่ข้อมูลรางวัล 1-5 ครบอย่างน้อย {MIN_VALID_DRAWS} งวด')

        history_sha = _fingerprint(draws, pool_draws)
        rows = _arm_rows(db)
        arm, samples = _choose_arm(target, rows)
        facts = _analysis_factsheet(ARMS[arm]['analysis'], pool_draws)
        history_lines = _history_block(pool_draws)

        numbers, records, parts = run_pipeline(
            target, arm, pool_draws=pool_draws, facts=facts, history_lines=history_lines,
            call_model=call_model, on_stage=lambda record: _store_stage(db, target, record))

        usage_total = sum((r.get('usage') or {}).get('total_tokens') or 0 for r in records)
        base = {
            'ok': True, 'protocol': PROTOCOL, 'target_date': target.isoformat(),
            'arm': arm, 'arm_samples': samples, 'arm_state_before': {a: rows[a] for a in ARM_ORDER},
            'model': MODEL, 'base_url': BASE_URL, 'temperature': TEMPERATURE,
            'token_budget': dict(STAGE_TOKEN_BUDGET), 'stages': records,
            'usage_total_tokens': usage_total,
            'history_sha256': history_sha, 'history_draws': len(draws),
            'pool_draws': len(pool_draws), 'pool_size': POOL_SIZE,
            'chance': {'mean': CHANCE_MEAN, 'sd': CHANCE_SD,
                       'pool_mean': POOL_CHANCE_MEAN, 'pool_sd': POOL_CHANCE_SD},
            'expected_hits': EXPECTED_HITS,
            'computed_at': now.isoformat(), 'cached': False,
        }

        if numbers is None:
            failed = next((r['stage'] for r in reversed(records) if r['status'] == 'failed'), None)
            payload = {**base, 'status': 'unavailable', 'reason': failed or 'pipeline_failed',
                       'numbers': [], 'analysis': parts.get('analysis'),
                       'candidate_count': len(parts.get('candidates') or [])}
            _store_record(db, target, payload)
            return payload

        payload = {**base, 'status': 'ok', 'numbers': numbers,
                   'analysis': parts.get('analysis'), 'critique': parts.get('critique'),
                   'candidate_count': len(parts.get('candidates') or []),
                   'candidates': parts.get('candidates'),
                   'source': 'server_live_llm'}
        _store_record(db, target, payload)
        return payload


def _results_by_date(history):
    """{draw date: (prize1, pool or None)} for every cache row carrying a usable first prize."""
    results = {}
    for row in history:
        if not isinstance(row, dict):
            continue
        values = astra._category_values(row, 'prize1', 6)
        if values is None:
            continue
        try:
            day = astra._history_date(row.get('date'))
        except astra.AstraInputError:
            continue
        results[day] = (values[0], _pool_numbers(row))
    return results


def _score(numbers, prize1, pool):
    """(max matched positions vs prize1, the ticket that produced it, max matched vs the pool)."""
    if not numbers:
        return None, None, None
    scores = [sum(1 for a, b in zip(number, prize1) if a == b) for number in numbers]
    best = max(scores)
    matched = numbers[scores.index(best)]
    pool_best = max((sum(1 for a, b in zip(number, p) if a == b)
                     for number in numbers for p in (pool or [])), default=None)
    return best, matched, pool_best


def resolve(target_date, prize1, pool=None):
    """Score a stored forecast; append-only and idempotent on (target_date, protocol).

    `pool` may be omitted — it is then read from the cache for that draw, because a reward row with a null
    `r_pool` would silently disable the secondary readout for every API-driven resolve.
    """
    if not re.fullmatch(r'[0-9]{6}', str(prize1)):
        raise ValueError('six-digit prize1 required')
    day = str(target_date)
    if pool is None:
        try:
            found = _results_by_date(astra.load_existing_astra_history()).get(date.fromisoformat(day))
        except (ValueError, astra.AstraCacheError):
            found = None
        pool = found[1] if found else None
    with _lock, connection() as db:
        row = _load_record(db, day)
        if row is None or row.get('status') != 'ok':
            raise ValueError('no stored forecast for that target')
        existing = db.execute('SELECT r, r_pool, payout, matched, pool_matched FROM llm_god_rewards'
                              ' WHERE target_date=? AND protocol=?', (day, PROTOCOL)).fetchone()
        if existing:
            return {'ok': True, 'target_date': day, 'r': existing[0], 'r_pool': existing[1],
                    'payout': bool(existing[2]), 'matched': existing[3],
                    'pool_matched': existing[4], 'created': False}
        best, matched, pool_best = _score(row['numbers'], prize1, pool)
        payout = int(matched == prize1)
        now = datetime.now(astra.THAILAND_TZ).isoformat()
        db.execute('INSERT OR IGNORE INTO llm_god_rewards VALUES (?,?,?,?,?,?,?,?)',
                   (day, PROTOCOL, best, pool_best, payout, matched, None, now))
        state = db.execute('SELECT n, sum_r FROM llm_god_arms WHERE protocol=? AND arm_id=?',
                           (PROTOCOL, row['arm'])).fetchone()
        n, sum_r = (state[0], state[1]) if state else (0, 0.0)
        db.execute('INSERT INTO llm_god_arms (protocol, arm_id, n, sum_r) VALUES (?,?,?,?)'
                   ' ON CONFLICT(protocol, arm_id) DO UPDATE SET n=excluded.n, sum_r=excluded.sum_r',
                   (PROTOCOL, row['arm'], n + 1, sum_r + best))
        return {'ok': True, 'target_date': day, 'r': best, 'r_pool': pool_best,
                'payout': bool(payout), 'matched': matched, 'created': True}


def resolve_pending(history=None, *, dry_run=False):
    """Score every stored forecast whose draw now has a first prize; append-only and idempotent.

    `resolve` is the only way a reward enters the loop, and RLL's first release proved what happens without
    a caller: rewards stayed at zero and the bandit looked quiet rather than broken. main.py runs this after
    both cache-write paths; scripts/llm_god_resolve_pending.py is the manual one.
    """
    history = astra.load_existing_astra_history() if history is None else history
    results = _results_by_date(history)

    stored = []
    with connection() as db:
        for day, payload in db.execute('SELECT target_date, payload FROM llm_god_forecasts'
                                       ' WHERE protocol=? ORDER BY target_date', (PROTOCOL,)):
            stored.append((day, json.loads(payload)))

    out = []
    for day, payload in stored:
        if payload.get('status') != 'ok':
            out.append({'target_date': day, 'status': 'skipped', 'reason': payload.get('status')})
            continue
        found = results.get(date.fromisoformat(day))
        if found is None:
            out.append({'target_date': day, 'status': 'pending'})
            continue
        prize1, pool = found
        if dry_run:
            best, matched, pool_best = _score(payload.get('numbers') or [], prize1, pool)
            out.append({'target_date': day, 'status': 'would_resolve', 'r': best,
                        'r_pool': pool_best, 'payout': matched == prize1, 'prize1': prize1})
            continue
        resolved = resolve(day, prize1, pool)
        out.append({'target_date': day,
                    'status': 'resolved' if resolved['created'] else 'already_resolved',
                    'r': resolved['r'], 'r_pool': resolved['r_pool'],
                    'payout': resolved['payout'], 'matched': resolved['matched'], 'prize1': prize1})
    return out


def state():
    """Per-arm posterior, the chance reference, and the resolved history."""
    with connection() as db:
        rows = _arm_rows(db)
        rewards = db.execute('SELECT COUNT(*), COALESCE(SUM(r),0), COALESCE(SUM(payout),0)'
                             ' FROM llm_god_rewards WHERE protocol=?', (PROTOCOL,)).fetchone()
        arms = []
        for arm in ARM_ORDER:
            n, sum_r = rows[arm]['n'], rows[arm]['sum_r']
            arms.append({'arm': arm, 'analysis': ARMS[arm]['analysis'], 'size': ARMS[arm]['size'],
                         'n': n, 'sum_r': round(sum_r, 6),
                         'mean': round((N0 * CHANCE_MEAN + sum_r) / (N0 + n), 6),
                         'posterior_sd': round(CHANCE_SD / math.sqrt(N0 + n), 6)})
        return {'ok': True, 'protocol': PROTOCOL, 'model': MODEL, 'n0': N0,
                'chance': {'mean': CHANCE_MEAN, 'sd': CHANCE_SD,
                           'pool_mean': POOL_CHANCE_MEAN, 'pool_sd': POOL_CHANCE_SD},
                'field': 'pool6', 'board': 'Pool 1-5', 'pool_size': POOL_SIZE,
                'expected_hits': EXPECTED_HITS,
                'arms': arms, 'resolved': int(rewards[0] or 0),
                'mean_r': round((rewards[1] or 0) / rewards[0], 6) if rewards[0] else None,
                'payouts': int(rewards[2] or 0),
                'evidence': 'experimental; no demonstrated edge'}


# ─── precompute ──────────────────────────────────────────────────────────────

def job_status(target_date):
    return _jobs.get(_target_key(target_date))


def ensure_precomputed(target_date, *, call_model=None, now=None, wait=False, db_path=None):
    """Start the pipeline in the background unless a record exists or a job is already running.

    The card must never block on four model calls, so the read path calls this and returns immediately with
    `pending`. `wait=True` is for tests and the CLI, never for a request handler.
    """
    target = _canonical_target(target_date)
    now = now or datetime.now(astra.THAILAND_TZ)
    key = _target_key(target)
    # Pin the file here, not inside the thread: the record must land in the database this call started on
    # even if the module global is rebound before the job finishes.
    db_path = Path(db_path) if db_path else DB

    with connection(db_path) as db:
        stored = _load_record(db, target)
        if stored is not None:
            stored['cached'] = True
            return _live_context(db, stored)

    if not _target_is_open(target, now):
        raise ClosedTarget('target draw already happened')

    def work():
        try:
            formula_forecast(key, call_model=call_model, now=now, db_path=db_path)
            _jobs[key] = 'done'
        except Exception as exc:                      # the job's failure is recorded, not raised
            _jobs[key] = f'failed: {exc}'
        finally:
            _jobs.pop(key + '#running', None)

    with _job_lock:
        if _jobs.get(key + '#running'):
            return {'ok': True, 'protocol': PROTOCOL, 'target_date': key, 'status': 'running',
                    'numbers': [], 'cached': False}
        _jobs[key + '#running'] = 'running'
        _jobs[key] = 'running'

    thread = threading.Thread(target=work, name=f'llm-god-{key}', daemon=True)
    thread.start()
    if wait:
        thread.join()
        with connection(db_path) as db:
            stored = _load_record(db, target)
            if stored is not None:
                stored['cached'] = True
                return _live_context(db, stored)
    return {'ok': True, 'protocol': PROTOCOL, 'target_date': key, 'status': 'pending',
            'numbers': [], 'cached': False}
