"""Prospective first-prize registry. Never evaluates historical holdouts."""
import hashlib
import json
import re
import sqlite3
from contextlib import contextmanager
from math import exp, log
from datetime import datetime
from pathlib import Path

import astra

PROTOCOL = 'prize1-prospective-v1-k5'
ROOT = Path(__file__).parent
DB = ROOT / 'astra_runtime' / 'first_prize.sqlite3'


@contextmanager
def connection():
    DB.parent.mkdir(exist_ok=True)
    db = sqlite3.connect(DB, timeout=15)
    try:
        with db:
            db.execute('CREATE TABLE IF NOT EXISTS forecasts (target TEXT, method TEXT, payload TEXT, PRIMARY KEY(target, method))')
            yield db
    finally:
        db.close()


def register(target, method, numbers, settings, provenance, *, source='client_unverified'):
    now = datetime.now(astra.THAILAND_TZ)
    astra.validate_astra_target_date(target, generated_at=now)
    if not re.fullmatch(r'[A-Za-z0-9_.:-]{1,120}', method):
        raise ValueError('invalid method')
    if not isinstance(numbers, list) or any(not isinstance(n, str) or not re.fullmatch(r'[0-9]{6}', n) for n in numbers):
        raise ValueError('six-digit strings required')
    unique = list(dict.fromkeys(numbers))
    if len(unique) < 5:
        raise ValueError('at least five distinct candidates required')
    if source == 'client_unverified':
        settings = {key: value for key, value in settings.items() if key != 'probability_model'}
        provenance = dict(provenance, server_frontend_code_sha256=hashlib.sha256(b''.join(
            (ROOT/'static'/name).read_bytes() for name in ('formula-calculators.js','formula-evaluation.js','prediction-ui.js')
        )).hexdigest())
    payload = dict(protocol=PROTOCOL, target_date=target, method=method,
                   numbers=unique[:5], submitted_count=len(numbers), unique_count=len(unique),
                   duplicates_removed=len(numbers)-len(unique), registered_at=now.isoformat(),
                   settings=settings, provenance=provenance, source=source,
                   score_kind='normalized_joint_model' if source == 'server_existing_cache' and 'probability_model' in settings else 'ranking_only', probability=None)
    model = settings.get('probability_model') if source == 'server_existing_cache' else None
    if model:
        mass = 0.0
        for number in unique[:5]:
            digits = [int(d) for d in number]
            score = log(model['q'][0][digits[0]]) + sum(
                .5*log(model['q'][j][digits[j]])+.5*log(model['t'][j-1][digits[j-1]][digits[j]]) for j in range(1, 6))
            mass += exp(score-model['log_partition'])
        payload['probability'] = mass
    encoded = json.dumps(payload, sort_keys=True, ensure_ascii=False, allow_nan=False)
    if len(encoded.encode()) > 100000:
        raise ValueError('report too large')
    payload['sha256'] = hashlib.sha256(encoded.encode()).hexdigest()
    with connection() as db:
        cur = db.execute('INSERT OR IGNORE INTO forecasts VALUES (?,?,?)',
                         (target, method, json.dumps(payload, ensure_ascii=False)))
        created = cur.rowcount == 1
        saved = json.loads(db.execute('SELECT payload FROM forecasts WHERE target=? AND method=?', (target, method)).fetchone()[0])
    return dict(ok=True, created=created, record=saved)


def records():
    if not DB.exists():
        return []
    with connection() as db:
        return [json.loads(row[0]) for row in db.execute('SELECT payload FROM forecasts ORDER BY target DESC, method')]


def board():
    saved = records()
    # Read the existing cache only when resolving registered future forecasts.
    history = astra.load_existing_astra_history() if saved else []
    actuals = {}
    for row in history:
        try:
            day = astra._history_date(row.get('date')).isoformat()
        except astra.AstraInputError:
            continue
        number = row.get('prize1')
        if day and isinstance(number, str) and re.fullmatch(r'[0-9]{6}', number):
            actuals.setdefault(day, set()).add(number)
    today = datetime.now(astra.THAILAND_TZ).date().isoformat()
    summaries = {}
    for record in saved:
        values = actuals.get(record['target_date'], set())
        actual = next(iter(values)) if len(values) == 1 and record['target_date'] <= today else None
        record['status'] = 'resolved' if actual else 'pending'
        record['actual'] = actual
        record['hit'] = actual in record['numbers'] if actual else None
        record['matched_positions'] = max(sum(a == b for a, b in zip(n, actual)) for n in record['numbers']) if actual else None
        model = record['settings'].get('probability_model') if record['source'] == 'server_existing_cache' else None
        if actual and model:
            digits = [int(d) for d in actual]
            score = log(model['q'][0][digits[0]])
            for j in range(1, 6):
                score += .5*log(model['q'][j][digits[j]]) + .5*log(model['t'][j-1][digits[j-1]][digits[j]])
            record['log_loss'] = model['log_partition'] - score
            record['uniform_log_loss'] = log(1000000)
        code = record['provenance'].get('code_sha256') or record['provenance'].get('server_frontend_code_sha256') or 'unverified'
        summary_key = (record['method'], code)
        summary = summaries.setdefault(summary_key, dict(method=record['method'], label=record['settings'].get('name', record['method']), code_sha256=code, draws=0, hits=0, expected_hits=0, pending=0, log_loss_sum=0, probability_draws=0, model_expected_hits=0))
        if actual:
            summary['draws'] += 1
            summary['hits'] += int(record['hit'])
            summary['expected_hits'] += 5 / 1000000
            if 'log_loss' in record:
                summary['log_loss_sum'] += record['log_loss']
                summary['probability_draws'] += 1
                summary['model_expected_hits'] += record['probability']
        else:
            summary['pending'] += 1
    return dict(ok=True, protocol=PROTOCOL, candidate_count=5, records=saved,
                summaries=list(summaries.values()), baseline_probability=5/1000000,
                evidence='experimental; no demonstrated edge', scoring='exact six-digit prize1 only',
                probability_metrics='normalized Astra v1 and Luna v1 joint log loss only; heuristic scores unavailable; calibration requires accumulated future observations')


def experiment(target):
    import astra_sigma
    import fano
    now = datetime.now(astra.THAILAND_TZ)
    astra.validate_astra_target_date(target, generated_at=now)
    existing = {r['method']: r for r in records() if r['target_date'] == target}
    methods = ['astra-v1', astra_sigma.VERSION,
               fano.VERSION, fano.VERSION_V5] + ['sigma-without-'+key for key in ('H', 'D', 'N', 'L', 'B')]
    if all(m in existing for m in methods):
        return dict(ok=True, records=[existing[m] for m in methods])
    history = astra.load_existing_astra_history()
    window = astra._history_window(
        history, astra.validate_astra_target_date(target, generated_at=now), now.date(), max_draws=None
    )
    valid_with_dates = [
        (age, values, draw_date)
        for age, (draw_date, row) in enumerate(window)
        if (values := astra._category_values(row, 'prize1', 6)) is not None
    ]
    valid = [(age, values) for age, values, _ in valid_with_dates]
    if len(valid) < 20:
        raise ValueError('at least 20 valid prior draws required')
    history_sha256 = hashlib.sha256(json.dumps(window, default=str, sort_keys=True).encode()).hexdigest()
    provenance = dict(history_sha256=history_sha256,
                      code_sha256=hashlib.sha256((ROOT/'first_prize.py').read_bytes()+(ROOT/'astra.py').read_bytes()+(ROOT/'astra_sigma.py').read_bytes()).hexdigest(),
                      cutoff=window[0][0].isoformat(),
                      history_start=window[-1][0].isoformat(), history_rows=len(window),
                      valid_draws=len(valid))
    output = []
    for method in methods:
        if method in existing:
            output.append(existing[method])
            continue
        if method == 'astra-v1':
            model = astra._build_model(valid, 6)
            numbers = [n for n, _ in astra._top_k(model, 5)]
            # Normalize the exact joint ranking model over all one million
            # sequences via forward sums, without enumerating or seeing outcomes.
            forward = list(model['q'][0])
            for j in range(1, 6):
                forward = [sum(forward[a] * exp(.5*log(model['q'][j][b]) + .5*log(model['t'][j-1][a][b])) for a in range(10)) for b in range(10)]
            settings = dict(astra._SETTINGS)
            settings['max_draws'] = None
            settings['training_policy'] = 'all accessible prior cache draws'
            settings['valid_draws'] = len(valid)
            settings['training_start_date'] = valid_with_dates[-1][2].isoformat()
            settings['training_cutoff_date'] = valid_with_dates[0][2].isoformat()
            settings['probability_model'] = dict(q=model['q'], t=model['t'], log_partition=log(sum(forward)))
        elif method in (fano.VERSION, fano.VERSION_V5):
            builder = {
                fano.VERSION: fano.build,
                fano.VERSION_V5: fano.build_v5,
            }[method]
            numbers, settings = builder(valid, target, history_sha256)
            settings['training_start_date'] = valid_with_dates[-1][2].isoformat()
            settings['training_cutoff_date'] = valid_with_dates[0][2].isoformat()
            fano_provenance = dict(
                history_sha256=history_sha256,
                code_sha256=hashlib.sha256((ROOT/'first_prize.py').read_bytes()+(ROOT/'astra.py').read_bytes()+(ROOT/'fano.py').read_bytes()).hexdigest(),
                cutoff=window[0][0].isoformat(),
                history_start=window[-1][0].isoformat(),
                history_rows=len(window),
                valid_draws=len(valid),
            )
            output.append(register(target, method, numbers, settings, fano_provenance, source='server_existing_cache')['record'])
            continue
        else:
            omitted = method.rsplit('-', 1)[-1] if method.startswith('sigma-without-') else None
            ranked, _ = astra_sigma.rank_category('prize1', valid, target, count=5, omitted_component=omitted)
            numbers = [r['number'] for r in ranked]
            settings = dict(astra_sigma.SETTINGS, weights=astra_sigma.WEIGHTS, omitted_component=omitted,
                            max_draws=None, renormalize_remaining_weights=True,
                            training_policy='all accessible prior cache draws', valid_draws=len(valid),
                            training_start_date=valid_with_dates[-1][2].isoformat(),
                            training_cutoff_date=valid_with_dates[0][2].isoformat())
        output.append(register(target, method, numbers, settings, provenance, source='server_existing_cache')['record'])
    return dict(ok=True, records=output)
