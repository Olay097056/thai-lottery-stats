"""Reinforcement Learn LLM (RLL) — a six-arm bandit whose policy is one live LLM call per draw.

Protocol rll-v1 (ticket 03). The reward is the number of matching digit positions of the closest of the
five candidates (ticket 05), never the payout; the payout hit is recorded separately and never optimised.

Design rules that the tests enforce:
  * a stored record is never recomputed — there is no re-roll path;
  * a failed attempt (other than "no credential") is stored as `unavailable`, so a draw cannot be retried
    into a nicer answer later;
  * the model call is injected, so tests never touch the network;
  * the prompt is built from the cache only, and its hash is re-derivable from the stored history hash.
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
from datetime import datetime
from pathlib import Path

import httpx

import astra

PROTOCOL = 'rll-v1'
MODEL = os.environ.get('RLL_MODEL', 'deepseek/deepseek-v4.1-flash')
BASE_URL = os.environ.get('RLL_BASE_URL', 'https://api.commandcode.ai/provider/v1')
MIN_VALID_DRAWS = 20
CANDIDATES = 5
N0 = 48.0                 # pseudo-draws of prior per arm (ticket 05)
CHANCE_MEAN = 1.495846    # exact chance mean of max matched positions over 5 candidates
CHANCE_SD = 0.717875
MAX_TOKENS = 4000  # reasoning tokens count here; 2000 truncated on the first attempt
TEMPERATURE = 0
TIMEOUT = httpx.Timeout(40.0, connect=5.0)
ROOT = Path(__file__).parent
DB = Path(os.environ.get('RLL_DB') or (ROOT / 'astra_runtime' / 'rll.sqlite3'))

ARMS = {
    'digit-hot': 'Choose digits that appeared most often in each position across the listed draws.',
    'digit-gap': 'Choose digits that have gone longest without appearing in each position.',
    'pair-markov': 'Use adjacent-position transitions: after the previous draw digit, take the most common follower.',
    'pool-weighted': 'Weight digits by prize 1-5 pool frequency: prize2 x1.0, prize3 x0.4, prize4 x0.2, prize5 x0.1.',
    'calendar': 'Use only draws that share the target weekday, month or day-of-month.',
    'control-uniform': 'Ignore the history entirely and output five arbitrary distinct six-digit numbers.',
}
ARM_ORDER = tuple(ARMS)

_lock = threading.Lock()


class NoCredential(RuntimeError):
    """The provider key is missing; this is a configuration state, not an attempt."""


class PermanentProviderError(RuntimeError):
    def __init__(self, status):
        super().__init__(f'provider rejected the request: HTTP {status}')
        self.status = status


class RetryableProviderError(RuntimeError):
    def __init__(self, status, detail=''):
        super().__init__(f'provider error: HTTP {status} {detail}'.strip())
        self.status = status


class ParseError(RuntimeError):
    """The response was not five distinct, unused, six-digit strings."""


@contextmanager
def connection():
    DB.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(DB, timeout=15)
    try:
        with db:
            db.execute('CREATE TABLE IF NOT EXISTS rll_forecasts (target_date TEXT, protocol TEXT, payload TEXT,'
                       ' PRIMARY KEY (target_date, protocol))')
            db.execute('CREATE TABLE IF NOT EXISTS rll_rewards (target_date TEXT, protocol TEXT, r INTEGER,'
                       ' payout INTEGER, matched TEXT, resolved_at TEXT, PRIMARY KEY (target_date, protocol))')
            db.execute('CREATE TABLE IF NOT EXISTS rll_arms (protocol TEXT, arm_id TEXT, n INTEGER, sum_r REAL,'
                       ' PRIMARY KEY (protocol, arm_id))')
            yield db
    finally:
        db.close()


# ─── history and slices ───────────────────────────────────────────────────────

def _valid_draws(window):
    """[(draw_date, prize1)] newest first, first-prize rows only."""
    draws = []
    for draw_date, row in window:
        values = astra._category_values(row, 'prize1', 6)
        if values is None:
            continue
        draws.append((draw_date, values[0]))
    return draws


def _pool_numbers(row):
    """Prize 1-5 numbers with their money weight, or None when the pool is incomplete."""
    prize1 = astra._category_values(row, 'prize1', 6)
    if prize1 is None:
        return None
    weighted = [(prize1[0], 1.0)]
    for key, weight in (('prize2', 1.0), ('prize3', 0.4), ('prize4', 0.2)):
        values = astra._category_values(row, key, 6)
        if values is None:
            return None
        weighted.extend((number, weight) for number in values)
    prize5 = row.get('prize5')
    if not isinstance(prize5, str):
        return None
    fifths = prize5.split()
    if len(fifths) != 100 or not all(re.fullmatch(r'[0-9]{6}', v) for v in fifths):
        return None
    weighted.extend((number, 0.1) for number in fifths)
    return weighted


def _position_weights(numbers):
    """Per-position digit weights from [(number, weight)]."""
    weights = [[0.0] * 10 for _ in range(6)]
    for number, weight in numbers:
        for position, char in enumerate(number):
            weights[position][int(char)] += weight
    return weights


def _top_digits(weights, count=4):
    ranked = sorted(range(10), key=lambda d: (-weights[d], d))
    return ' '.join(f'{d}:{weights[d]:.1f}' for d in ranked[:count])


def _arm_slice(arm, draws, target):
    """The data lines an arm sees, oldest first, plus a one-line statistic where the arm needs one."""
    if arm == 'control-uniform':
        return [], ['(no history by design)']

    if arm == 'digit-hot':
        rows = draws[:60]
        weights = _position_weights([(value, 1.0) for _, value in rows])
        stats = [f'position {i} frequencies: {_top_digits(weights[i])}' for i in range(6)]
        return rows, stats

    if arm == 'digit-gap':
        rows = draws[:60]
        stats = []
        for position in range(6):
            gaps = []
            for digit in range(10):
                gap = next((age for age, (_, value) in enumerate(rows) if value[position] == str(digit)), len(rows))
                gaps.append((gap, digit))
            gaps.sort(reverse=True)
            stats.append(f'position {position} longest gaps: ' + ' '.join(f'{d}:{g}' for g, d in gaps[:4]))
        return rows, stats

    if arm == 'pair-markov':
        rows = draws[:60]
        previous = rows[0][1] if rows else '000000'
        stats = [f'previous draw: {previous}']
        for position in range(1, 6):
            followers = {}
            for _, value in rows:
                if value[position - 1] == previous[position - 1]:
                    followers[value[position]] = followers.get(value[position], 0) + 1
            ranked = sorted(followers.items(), key=lambda item: (-item[1], item[0]))[:3]
            stats.append(f'position {position} after {previous[position - 1]}: ' +
                         (' '.join(f'{d}:{c}' for d, c in ranked) or 'no sample'))
        return rows, stats

    if arm == 'pool-weighted':
        rows = [row for row in draws[:8]]
        return rows, ['pool-weighted digit table is in the history rows below']

    if arm == 'calendar':
        target_date = target
        same = [(d, v) for d, v in draws
                if (d.weekday() == target_date.weekday() or d.month == target_date.month
                    or d.day == target_date.day)]
        rows = same[:40] or draws[:20]
        return rows, [f'target weekday={target_date.weekday()} month={target_date.month} day={target_date.day}']

    raise ValueError(f'unknown arm: {arm}')


def _build_prompt(arm, draws, context, outcomes, retry_note=None):
    """Deterministic prompt; returns (text, slice_sha256, banned_numbers)."""
    target_date, window = context
    if arm == 'pool-weighted':
        weighted_rows = []
        banned = []
        for draw_date, row in window:
            pool = _pool_numbers(row)
            if pool is None:
                continue
            weights = _position_weights(pool)
            weighted_rows.append((draw_date, ' | '.join(_top_digits(weights[i]) for i in range(6))))
            banned.extend(number for number, _ in pool)
            if len(weighted_rows) == 8:
                break
        slice_lines = [f'{d} {line}' for d, line in reversed(weighted_rows)]
    else:
        rows, stats = _arm_slice(arm, draws, target_date)
        slice_lines = [f'{d.isoformat()} {value}' for d, value in reversed(rows)] + list(stats)
        banned = [value for _, value in rows]

    history_sha = hashlib.sha256('\n'.join(slice_lines).encode()).hexdigest()
    outcome_lines = [f'{d} r={r} matched={m}' for d, r, m in outcomes[-8:]]
    parts = [
        f'protocol={PROTOCOL} target={target_date.isoformat()} arm={arm}',
        f'arm policy: {ARMS[arm]}',
        'history (oldest first):',
        *slice_lines,
        'your recent outcomes with this arm:',
        *(outcome_lines or ['(none yet)']),
        'do not reuse any number from the input list: ' + ', '.join(sorted(set(banned))[:400]),
    ]
    if retry_note:
        parts.append(retry_note)
    parts += [
        'reply with exactly this JSON and nothing else:',
        '{"numbers":["000000","000000","000000","000000","000000"]}',
        'five distinct six-digit strings that look like real lottery draws:',
        'no counting runs, no repeated-digit numbers, and every pair must differ in at least three positions.',
    ]
    return '\n'.join(parts), history_sha, set(banned)


# ─── model call and parsing ───────────────────────────────────────────────────

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


def _call_model(prompt):
    """Default provider call; tests replace this."""
    key = _env_key()
    if not key:
        raise NoCredential('COMMANDCODE_API_KEY is not set')
    body = {
        'model': MODEL,
        'messages': [
            {'role': 'system', 'content': 'You output JSON only.'},
            {'role': 'user', 'content': prompt},
        ],
        'temperature': TEMPERATURE,
        'max_tokens': MAX_TOKENS,
    }
    started = datetime.now()
    try:
        response = httpx.post(f'{BASE_URL}/chat/completions',
                              headers={'Authorization': f'Bearer {key}', 'Content-Type': 'application/json'},
                              json=body, timeout=TIMEOUT)
    except httpx.HTTPError as exc:
        raise RetryableProviderError('timeout', _redact(str(exc), key)) from None
    latency_ms = int((datetime.now() - started).total_seconds() * 1000)
    if response.status_code in (401, 403):
        raise PermanentProviderError(response.status_code)
    if response.status_code == 400:
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


def _parse_numbers(content, banned):
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
    numbers = payload.get('numbers') if isinstance(payload, dict) else payload
    if not isinstance(numbers, list) or len(numbers) != CANDIDATES:
        raise ParseError('expected exactly five numbers')
    cleaned = [str(value) for value in numbers]
    if any(not re.fullmatch(r'[0-9]{6}', value) for value in cleaned):
        raise ParseError('non six-digit value')
    if len(set(cleaned)) != CANDIDATES:
        raise ParseError('duplicate candidates')
    reused = [value for value in cleaned if value in banned]
    if reused:
        raise ParseError(f'reused input numbers: {reused}')
    return cleaned


# ─── bandit state ─────────────────────────────────────────────────────────────

def _arm_rows(db):
    rows = {arm: {'n': 0, 'sum_r': 0.0} for arm in ARM_ORDER}
    for arm_id, n, sum_r in db.execute('SELECT arm_id, n, sum_r FROM rll_arms WHERE protocol=?', (PROTOCOL,)):
        if arm_id in rows:
            rows[arm_id] = {'n': int(n), 'sum_r': float(sum_r)}
    return rows


def _choose_arm(target_date, rows):
    """Thompson sampling with the null sigma and an n0 prior; deterministic per target date."""
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


def _recent_outcomes(db):
    rows = []
    for payload_json, r, matched in db.execute(
            'SELECT f.payload, re.r, re.matched FROM rll_rewards re JOIN rll_forecasts f'
            ' ON f.target_date = re.target_date AND f.protocol = re.protocol'
            ' WHERE re.protocol=? ORDER BY re.target_date DESC LIMIT 8', (PROTOCOL,)):
        payload = json.loads(payload_json)
        rows.append((datetime.fromisoformat(payload['target_date']), int(r), matched))
    rows.sort(key=lambda item: item[0])
    return rows


# ─── public API ──────────────────────────────────────────────────────────────

def _target_key(target_date):
    return target_date.isoformat() if hasattr(target_date, 'isoformat') else str(target_date)


def _load_record(db, target_date):
    row = db.execute('SELECT payload FROM rll_forecasts WHERE target_date=? AND protocol=?',
                     (_target_key(target_date), PROTOCOL)).fetchone()
    return json.loads(row[0]) if row else None


def _store_record(db, target_date, payload):
    db.execute('INSERT OR IGNORE INTO rll_forecasts VALUES (?,?,?)',
               (_target_key(target_date), PROTOCOL, json.dumps(payload, ensure_ascii=False)))


def formula_forecast(target_date, *, call_model=None):
    """Read or compute the five RLL candidates for one target draw."""
    call_model = call_model or _call_model
    now = datetime.now(astra.THAILAND_TZ)
    target = astra.validate_astra_target_date(target_date, generated_at=now)
    history = astra.load_existing_astra_history()
    window = astra._history_window(history, target, now.date(), max_draws=None)
    draws = _valid_draws(window)
    if len(draws) < MIN_VALID_DRAWS:
        raise ValueError('at least 20 valid prior draws required')
    history_sha = hashlib.sha256(json.dumps([[d.isoformat(), v] for d, v in draws],
                                            separators=(',', ':')).encode()).hexdigest()

    with _lock, connection() as db:
        stored = _load_record(db, target)
        if stored is not None:
            stored['cached'] = True
            return stored

        rows = _arm_rows(db)
        arm, samples = _choose_arm(target, rows)
        # pool-weighted needs the whole window (it reads prize2..5 from the same rows)
        prompt, slice_sha, banned = _build_prompt(arm, draws, (target, window), _recent_outcomes(db))
        attempts, numbers, last_error, raw_response = [], None, None, ''

        for attempt in (1, 2):
            if attempt == 1:
                text = prompt
            else:
                text = prompt + (
                    "\nretry: the previous answer did not satisfy the contract — return five distinct"
                    " six-digit strings that do not repeat any listed number."
                )
            try:
                result = call_model(text)
                numbers = _parse_numbers(result['content'], banned)
                raw_response = result.get('raw') or ''
                attempts.append({'http': 200, 'latency_ms': result.get('latency_ms'),
                                 'usage': result.get('usage'), 'parse_error': None,
                                 'prompt_sha256': hashlib.sha256(text.encode()).hexdigest()})
                break
            except NoCredential:
                return {'ok': True, 'protocol': PROTOCOL, 'target_date': target.isoformat(),
                        'status': 'unavailable', 'reason': 'no_credential', 'numbers': [],
                        'arm': arm, 'cached': False}
            except PermanentProviderError as exc:
                attempts.append({'http': exc.status, 'parse_error': None,
                                 'prompt_sha256': hashlib.sha256(text.encode()).hexdigest()})
                last_error = 'auth' if exc.status in (401, 403) else 'rejected'
                break
            except (RetryableProviderError, ParseError) as exc:
                attempts.append({'http': getattr(exc, 'status', None), 'parse_error': str(exc),
                                 'prompt_sha256': hashlib.sha256(text.encode()).hexdigest()})
                last_error = 'provider_error' if isinstance(exc, RetryableProviderError) else 'unparseable'
                numbers = None

        if numbers is None:
            payload = {'ok': True, 'protocol': PROTOCOL, 'target_date': target.isoformat(),
                       'status': 'unavailable', 'reason': last_error or 'provider_error', 'numbers': [],
                       'arm': arm, 'attempts': attempts, 'computed_at': now.isoformat(),
                       'model': MODEL, 'base_url': BASE_URL, 'prompt': prompt,
                       'prompt_sha256': hashlib.sha256(prompt.encode()).hexdigest(),
                       'slice_sha256': slice_sha, 'history_sha256': history_sha,
                       'history_rows': len(window), 'cached': False}
            _store_record(db, target, payload)
            return payload

        payload = {
            'ok': True, 'protocol': PROTOCOL, 'target_date': target.isoformat(), 'status': 'ok',
            'numbers': numbers, 'arm': arm, 'arm_samples': samples,
            'arm_state_before': {a: rows[a] for a in ARM_ORDER},
            'model': MODEL, 'base_url': BASE_URL, 'temperature': TEMPERATURE, 'max_tokens': MAX_TOKENS,
            'seed_used': False, 'prompt': prompt, 'prompt_sha256': hashlib.sha256(prompt.encode()).hexdigest(),
            'slice_sha256': slice_sha, 'history_sha256': history_sha, 'history_rows': len(window),
            'attempts': attempts, 'computed_at': now.isoformat(),
            'response_raw': (raw_response or '')[:20000],
            'response_sha256': hashlib.sha256((raw_response or '').encode()).hexdigest(),
            'code_sha256': hashlib.sha256((ROOT / 'rll.py').read_bytes() + (ROOT / 'astra.py').read_bytes()).hexdigest(),
            'source': 'server_live_llm', 'cached': False,
        }
        _store_record(db, target, payload)
        return payload


def resolve(target_date, prize1):
    """Score a stored forecast against the actual first prize; append-only, idempotent."""
    if not re.fullmatch(r'[0-9]{6}', str(prize1)):
        raise ValueError('six-digit prize1 required')
    day = str(target_date)
    with _lock, connection() as db:
        row = _load_record(db, day)
        if row is None or row.get('status') != 'ok':
            raise ValueError('no stored forecast for that target')
        existing = db.execute('SELECT r, payout, matched FROM rll_rewards WHERE target_date=? AND protocol=?',
                              (day, PROTOCOL)).fetchone()
        if existing:
            return {'ok': True, 'target_date': day, 'r': existing[0], 'payout': bool(existing[1]),
                    'matched': existing[2], 'created': False}
        scores = [sum(1 for a, b in zip(number, prize1) if a == b) for number in row['numbers']]
        best = max(scores)
        index = scores.index(best)
        payout = int(row['numbers'][index] == prize1)
        matched = row['numbers'][index]
        now = datetime.now(astra.THAILAND_TZ).isoformat()
        db.execute('INSERT OR IGNORE INTO rll_rewards VALUES (?,?,?,?,?,?)',
                   (day, PROTOCOL, best, payout, matched, now))
        state = db.execute('SELECT n, sum_r FROM rll_arms WHERE protocol=? AND arm_id=?',
                           (PROTOCOL, row['arm'])).fetchone()
        n, sum_r = (state[0], state[1]) if state else (0, 0.0)
        db.execute('INSERT INTO rll_arms (protocol, arm_id, n, sum_r) VALUES (?,?,?,?)'
                   ' ON CONFLICT(protocol, arm_id) DO UPDATE SET n=excluded.n, sum_r=excluded.sum_r',
                   (PROTOCOL, row['arm'], n + 1, sum_r + best))
        return {'ok': True, 'target_date': day, 'r': best, 'payout': bool(payout), 'matched': matched,
                'created': True}


def state():
    """Per-arm posterior, the chance reference, and the resolved history."""
    with connection() as db:
        rows = _arm_rows(db)
        rewards = db.execute('SELECT COUNT(*), COALESCE(SUM(r),0), COALESCE(SUM(payout),0)'
                             ' FROM rll_rewards WHERE protocol=?', (PROTOCOL,)).fetchone()
        arms = []
        for arm in ARM_ORDER:
            n, sum_r = rows[arm]['n'], rows[arm]['sum_r']
            arms.append({'arm': arm, 'n': n, 'sum_r': round(sum_r, 6),
                         'mean': round((N0 * CHANCE_MEAN + sum_r) / (N0 + n), 6),
                         'posterior_sd': round(CHANCE_SD / math.sqrt(N0 + n), 6)})
        return {'ok': True, 'protocol': PROTOCOL, 'model': MODEL, 'n0': N0,
                'chance': {'mean': CHANCE_MEAN, 'sd': CHANCE_SD, 'band': [1, 3]},
                'arms': arms, 'resolved': int(rewards[0] or 0),
                'mean_r': round((rewards[1] or 0) / rewards[0], 6) if rewards[0] else None,
                'payouts': int(rewards[2] or 0),
                'evidence': 'experimental; no demonstrated edge'}
