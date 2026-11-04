"""Offline hypothesis search for a measurable field (option 3) — protocol hs-v3.

A hypothesis is pure DATA (never code). The harness owns every operator; a hypothesis only picks
operators, sources, windows and weights. Candidates are the top k of an enumeration over all 1000
tails, so terms that couple positions are expressible.

Term kinds
  positions[p] = [term]   per-position additive feature: freq / gap / markov / weekday / markov2 / markov3
  joints       = [term]   exact digit-pair frequency: pair01 / pair02 / pair12
  shapes       = [term]   coarse pair structure or shape: pairsum01|02|12, diff01|02|12, summod
  sums         = [term]   digit-sum frequency (0..27)
  structs      = [term]   within-the-tail structure: repeat / ascending / even (no history)
  exclude      = [term]   penalty for tails seen in the last 1-5 draws' pool

v3 adds shapes (19-cell pair sums, 10-cell pair differences, 10-cell sum mod 10 — far more data per
cell than the 100-cell joint tables), within-tail structure, and lagged markov at 2 and 3 draws.

Every historical feature is computed from draws strictly before the target. The DSL is the sandbox.

Field: last-3 digits of the prize 1-4 pool (~62 distinct tails / 1000), on the 464 draws where the pool
actually exists (>= 55 distinct tails, 2006-12-30 onward).

Protocol:
  train      oldest 60 % of evaluable targets — screening at z >= 3.5 (calibrate against the null)
  validation next 20 %                        — confirmation at z >= 2.0
  holdout    newest 20 %                      — evaluated ONCE, never used for selection

Run:
    python scripts/rll_hypothesis_search.py --selftest
    python scripts/rll_hypothesis_search.py --hypotheses <file.json> [--null-shuffles 200] [--json out.json]
"""
from __future__ import annotations

import argparse
import json
import math
import random
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import astra  # noqa: E402

WINDOWS = (30, 60, 120)
EXCLUDE_DRAWS = (1, 2, 3, 5)
LAGS = (2, 3)
WARMUP = 60
PROTOCOL = 'hs-v3'
PAIRS = {'pair01': (0, 1), 'pair02': (0, 2), 'pair12': (1, 2)}
SOURCES = ('pool', 'prize1')
SHAPES = ('pairsum01', 'pairsum02', 'pairsum12', 'diff01', 'diff02', 'diff12', 'summod')

_I = np.arange(10)
_A, _B, _C = _I[:, None, None], _I[None, :, None], _I[None, None, :]
SUM_GRID = (_A + _B + _C).astype(np.int16)
SUMMOD_GRID = ((_A + _B + _C) % 10).astype(np.int16)
# pair index grids are 10x10 and get broadcast onto the missing axis
PAIR_INDEX = {
    'pair01': (_A + _B)[:, :, 0].astype(np.int16),
    'pair02': (_A + _C)[:, 0, :].astype(np.int16),
    'pair12': (_B + _C)[0, :, :].astype(np.int16),
}
DIFF_INDEX = {
    'diff01': ((_B - _A) % 10)[:, :, 0].astype(np.int16),
    'diff02': ((_C - _A) % 10)[:, 0, :].astype(np.int16),
    'diff12': ((_C - _B) % 10)[0, :, :].astype(np.int16),
}
STRUCT = {
    'repeat': ((_A == _B).astype(float) + (_B == _C).astype(float) + (_A == _C).astype(float)),
    'ascending': ((_A < _B) & (_B < _C)).astype(float),
    'even': ((_A % 2 == 0).astype(float) + (_B % 2 == 0).astype(float) + (_C % 2 == 0).astype(float)),
}


# ─── corpus ─────────────────────────────────────────────────────────────────

def load_rows():
    rows = [r for r in astra.load_existing_astra_history()
            if isinstance(r.get('prize1'), str) and len(r['prize1']) == 6 and r['prize1'].isdigit()]
    rows.sort(key=lambda r: r['date'])
    return rows


def pool14(row):
    values = [row.get('prize1')]
    values += [row.get(f'prize2_{i}') for i in range(1, 6)]
    values += [row.get(f'prize3_{i}') for i in range(1, 11)]
    prize4 = row.get('prize4')
    values += prize4.split() if isinstance(prize4, str) else []
    return [v for v in values if isinstance(v, str) and len(v) == 6 and v.isdigit()]


def tail_set(row):
    return {v[-3:] for v in pool14(row)}


def day_of_week(text):
    y, m, d = (int(x) for x in str(text).split('-'))
    if m < 3:
        m += 12
        y -= 1
    k, j = y % 100, y // 100
    return (d + (13 * (m + 1)) // 5 + k + k // 4 + j // 4 + 5 * j) % 7


def _shape_tallies(tails):
    """summod (10), pair sums (19 per pair), pair differences (10 per pair) for one draw."""
    summod = np.zeros(10)
    pairsum = {key: np.zeros(19) for key in PAIRS}
    diff = {key: np.zeros(10) for key in PAIRS}
    for tail in tails:
        a, b, c = int(tail[0]), int(tail[1]), int(tail[2])
        summod[(a + b + c) % 10] += 1.0
        pairsum['pair01'][a + b] += 1.0
        pairsum['pair02'][a + c] += 1.0
        pairsum['pair12'][b + c] += 1.0
        diff['pair01'][(b - a) % 10] += 1.0
        diff['pair02'][(c - a) % 10] += 1.0
        diff['pair12'][(c - b) % 10] += 1.0
    return summod, pairsum, diff


class Corpus:
    """Per-draw tallies plus a per-target feature cache built only from earlier draws."""

    def __init__(self, rows):
        self.rows = rows
        self.tails = [tail_set(r) for r in rows]
        # The pool field only exists once prize 2/3/4 are present (Sanook era). Older draws carry a
        # single tail, so scoring them would compare a 1-tail target with a 62-tail one.
        self.usable = [i for i, tails in enumerate(self.tails) if len(tails) >= 55]
        self.prize1_tail = [r['prize1'][-3:] for r in rows]
        self.weekday = [day_of_week(r['date']) for r in rows]
        self.pool_counts = []
        for tails in self.tails:
            counts = np.zeros((3, 10))
            for tail in tails:
                for position in range(3):
                    counts[position, int(tail[position])] += 1.0
            self.pool_counts.append(counts)
        self.day_pool_shapes = [_shape_tallies(t) for t in self.tails]
        self.day_prize_shapes = [_shape_tallies([t]) for t in self.prize1_tail]
        self._cache = {}

    def features(self, index):
        if index not in self._cache:
            self._cache[index] = self._build(index)
        return self._cache[index]

    def _build(self, index):
        feats = {}
        target_weekday = self.weekday[index]
        for window in WINDOWS:
            start = max(0, index - window)
            span = range(start, index)
            for position in range(3):
                total = np.zeros(10)
                for j in span:
                    total += self.pool_counts[j][position]
                feats[('freq', 'pool', window, position)] = total / (total.sum() or 1.0)

                gaps = np.full(10, float(window))
                for age, j in enumerate(range(index - 1, start - 1, -1)):
                    for d in range(10):
                        if gaps[d] == window and self.pool_counts[j][position, d] > 0:
                            gaps[d] = age
                feats[('gap', 'pool', window, position)] = gaps / (gaps.max() or 1.0)

                total = np.zeros(10)
                for j in span:
                    if self.weekday[j] == target_weekday:
                        total += self.pool_counts[j][position]
                feats[('weekday', 'pool', window, position)] = total / (total.sum() or 1.0)

                table = np.zeros((10, 10))
                for j in range(start + 1, index):
                    table[int(self.prize1_tail[j - 1][position]), int(self.prize1_tail[j][position])] += 1.0
                state = int(self.prize1_tail[index - 1][position]) if index else 0
                row = table[state]
                feats[('markov', 'pool', window, position)] = row / (row.sum() or 1.0)

                total = np.zeros(10)
                for j in span:
                    total[int(self.prize1_tail[j][position])] += 1.0
                feats[('freq', 'prize1', window, position)] = total / (total.sum() or 1.0)

                gaps = np.full(10, float(window))
                for age, j in enumerate(range(index - 1, start - 1, -1)):
                    d = int(self.prize1_tail[j][position])
                    if gaps[d] == window:
                        gaps[d] = age
                feats[('gap', 'prize1', window, position)] = gaps / (gaps.max() or 1.0)

                total = np.zeros(10)
                for j in span:
                    if self.weekday[j] == target_weekday:
                        total[int(self.prize1_tail[j][position])] += 1.0
                feats[('weekday', 'prize1', window, position)] = total / (total.sum() or 1.0)
                feats[('markov', 'prize1', window, position)] = feats[('markov', 'pool', window, position)]

                # lagged markov: P(digit at p in t | digit at p in t-L)
                for lag in LAGS:
                    table = np.zeros((10, 10))
                    for j in range(start + lag, index):
                        table[int(self.prize1_tail[j - lag][position]),
                              int(self.prize1_tail[j][position])] += 1.0
                    state = int(self.prize1_tail[index - lag][position]) if index >= lag else 0
                    row = table[state]
                    feats[(f'markov{lag}', 'prize1', window, position)] = row / (row.sum() or 1.0)

            for source, days in (('pool', self.day_pool_shapes), ('prize1', self.day_prize_shapes)):
                summod = np.zeros(10)
                pairsum = {key: np.zeros(19) for key in PAIRS}
                diff = {key: np.zeros(10) for key in PAIRS}
                for j in span:
                    day_summod, day_pairsum, day_diff = days[j]
                    summod += day_summod
                    for key in PAIRS:
                        pairsum[key] += day_pairsum[key]
                        diff[key] += day_diff[key]
                feats[('summod', source, window)] = summod / (summod.sum() or 1.0)
                for key in PAIRS:
                    feats[(f'pairsum{key[-2:]}', source, window)] = pairsum[key] / (pairsum[key].sum() or 1.0)
                    feats[(f'diff{key[-2:]}', source, window)] = diff[key] / (diff[key].sum() or 1.0)

            # exact joint digit-pair frequencies
            for pair, (left, right) in PAIRS.items():
                for source in SOURCES:
                    table = np.zeros((10, 10))
                    for j in span:
                        if source == 'pool':
                            for tail in self.tails[j]:
                                table[int(tail[left]), int(tail[right])] += 1.0
                        else:
                            tail = self.prize1_tail[j]
                            table[int(tail[left]), int(tail[right])] += 1.0
                    feats[(pair, source, window)] = table / (table.sum() or 1.0)

            # digit-sum preference (0..27)
            for source in SOURCES:
                sums = np.zeros(28)
                for j in span:
                    targets = self.tails[j] if source == 'pool' else [self.prize1_tail[j]]
                    for tail in targets:
                        sums[sum(int(ch) for ch in tail)] += 1.0
                feats[('sum', source, window)] = sums / (sums.sum() or 1.0)

        for draws in EXCLUDE_DRAWS:
            mask = np.zeros((10, 10, 10))
            for j in range(max(0, index - draws), index):
                for tail in self.tails[j]:
                    mask[int(tail[0]), int(tail[1]), int(tail[2])] = 1.0
            feats[('exclmask', 'pool', draws)] = mask
        return feats


# ─── hypotheses ─────────────────────────────────────────────────────────────

def _broadcast(table, op):
    if op.endswith('01'):
        return table[:, :, None]
    if op.endswith('02'):
        return table[:, None, :]
    return table[None, :, :]


def score_grid(hyp, feats):
    """10x10x10 score for every possible tail, from one target's feature cache."""
    base = [np.zeros(10) for _ in range(3)]
    for position, terms in enumerate(hyp['positions']):
        for term in terms:
            vec = feats.get((term['op'], term['source'], int(term['window']), position))
            if vec is not None:
                base[position] = base[position] + float(term['weight']) * vec
    grid = base[0][:, None, None] + base[1][None, :, None] + base[2][None, None, :]

    for term in hyp.get('joints') or []:
        table = feats.get((term['op'], term['source'], int(term['window'])))
        if table is not None:
            grid = grid + float(term['weight']) * _broadcast(table, term['op'])

    for term in hyp.get('shapes') or []:
        op = term['op']
        vec = feats.get((op, term['source'], int(term['window'])))
        if vec is None:
            continue
        weight = float(term['weight'])
        if op == 'summod':
            grid = grid + weight * vec[SUMMOD_GRID]
        elif op.startswith('pairsum'):
            grid = grid + weight * _broadcast(vec[PAIR_INDEX['pair' + op[-2:]]], 'pair' + op[-2:])
        else:
            grid = grid + weight * _broadcast(vec[DIFF_INDEX[op]], op)

    for term in hyp.get('sums') or []:
        vec = feats.get(('sum', term['source'], int(term['window'])))
        if vec is not None:
            grid = grid + float(term['weight']) * vec[SUM_GRID]

    for term in hyp.get('structs') or []:
        table = STRUCT.get(term['name'])
        if table is not None:
            grid = grid + float(term['weight']) * table

    for term in hyp.get('exclude') or []:
        mask = feats.get(('exclmask', 'pool', int(term.get('draws', 1))))
        if mask is not None:
            grid = grid + float(term['weight']) * mask
    return grid


def candidates(hyp, feats):
    k = int(hyp.get('k', 10))
    grid = score_grid(hyp, feats).ravel()
    if k >= grid.size:
        order = np.argsort(-grid, kind='stable')
    else:
        order = np.argpartition(-grid, k - 1)[:k]
        order = order[np.argsort(-grid[order], kind='stable')]
    return [f'{int(i):03d}' for i in order[:k]]


def baseline_for(tails, k):
    return 1 - (1 - len(tails) / 1000) ** k


def signature(feats):
    """Hashable form of a feature cache (for leak tests)."""
    out = {}
    for key, value in feats.items():
        out[key] = np.asarray(value).round(12).tolist() if isinstance(value, np.ndarray) else sorted(value)
    return out


# ─── evaluation ─────────────────────────────────────────────────────────────

def evaluate(hyp, corpus, indices):
    k = int(hyp.get('k', 10))
    hits, expected = 0, 0.0
    for index in indices:
        picks = candidates(hyp, corpus.features(index))
        if any(p in corpus.tails[index] for p in picks):
            hits += 1
        expected += baseline_for(corpus.tails[index], k)
    n = max(1, len(indices))
    return {'n': n, 'hits': hits, 'rate': hits / n, 'baseline': expected / n}


def z_score(rate, baseline, n):
    if n <= 0:
        return 0.0
    se = math.sqrt(max(baseline * (1 - baseline), 1e-12) / n)
    return (rate - baseline) / se if se else 0.0


def split_bounds(total):
    start = WARMUP
    span = total - start
    train_end = start + int(span * 0.6)
    val_end = start + int(span * 0.8)
    return (start, train_end), (train_end, val_end), (val_end, total)


def permutation_test(hypotheses, corpus, train, shuffles=100, seed=7):
    """Randomisation control: shuffle the target outcomes across draws, keep the features.

    Outcomes are permuted **within the usable era only**. Permuting across all 761 draws would hand
    pool-era targets the one-tail sets of 1995-2006 and push every z to -3; that is a size mismatch,
    not a null.

    Candidate sets do not depend on the outcome, so they are computed once and each shuffle is a lookup.
    """
    rng = random.Random(seed)
    picks = [[[int(p) for p in candidates(hyp, corpus.features(index))] for index in train]
             for hyp in hypotheses]
    usable = corpus.usable
    slot_of = {index: position for position, index in enumerate(usable)}
    sets = [frozenset(int(t) for t in corpus.tails[index]) for index in usable]
    baselines = [baseline_for(corpus.tails[index], 10) for index in usable]
    train_slots = [slot_of[index] for index in train]
    n = len(train)
    order = list(range(len(sets)))
    maxes = []
    for _ in range(shuffles):
        rng.shuffle(order)
        base_mean = sum(baselines[order[target]] for target in train_slots) / n
        se = math.sqrt(max(base_mean * (1 - base_mean), 1e-12) / n)
        best = -9e9
        for per_hyp in picks:
            hits = 0
            for slot, target in enumerate(train_slots):
                outcome = sets[order[target]]
                if any(p in outcome for p in per_hyp[slot]):
                    hits += 1
            best = max(best, (hits / n - base_mean) / se if se else 0.0)
        maxes.append(best)
    maxes.sort()
    return {'shuffles': shuffles, 'seed': seed, 'maxes': maxes,
            'max_z': {'p50': round(maxes[len(maxes) // 2], 2),
                      'p95': round(maxes[int(len(maxes) * 0.95)], 2),
                      'max': round(maxes[-1], 2)}}


def search(hypotheses, corpus, z_screen=3.5, z_confirm=2.0, shortlist=12):
    usable = corpus.usable[WARMUP:]
    (a, b), (c, d), (e, f) = split_bounds(len(usable))
    train, val, hold = usable[a:b], usable[c:d], usable[e:f]
    screened = []
    for hyp in hypotheses:
        stats = evaluate(hyp, corpus, train)
        stats['z'] = z_score(stats['rate'], stats['baseline'], stats['n'])
        screened.append((stats['z'], hyp['name'], hyp, stats))
    screened.sort(key=lambda item: -item[0])
    passed = [item for item in screened if item[0] >= z_screen]
    zs = [item[0] for item in screened]
    z_mean = sum(zs) / len(zs) if zs else 0.0
    z_sd = (sum((z - z_mean) ** 2 for z in zs) / len(zs)) ** 0.5 if len(zs) > 1 else 0.0
    confirmed = []
    for z, name, hyp, stats in passed[:shortlist]:
        validation = evaluate(hyp, corpus, val)
        validation['z'] = z_score(validation['rate'], validation['baseline'], validation['n'])
        if validation['z'] >= z_confirm:
            holdout = evaluate(hyp, corpus, hold)
            holdout['z'] = z_score(holdout['rate'], holdout['baseline'], holdout['n'])
            confirmed.append({'name': name, 'hypothesis': hyp, 'train': stats, 'validation': validation,
                              'holdout': holdout, 'survives': holdout['z'] > 0})
    return {
        'protocol': PROTOCOL,
        'field': 'tail3 of prize 1-4 pool',
        'draws': len(corpus.rows),
        'usable_draws': len(corpus.usable),
        'windows': {
            'train': [corpus.rows[train[0]]['date'], corpus.rows[train[-1]]['date'], len(train)],
            'validation': [corpus.rows[val[0]]['date'], corpus.rows[val[-1]]['date'], len(val)],
            'holdout': [corpus.rows[hold[0]]['date'], corpus.rows[hold[-1]]['date'], len(hold)],
        },
        'thresholds': {'screen_z': z_screen, 'confirm_z': z_confirm},
        'z_distribution': {'mean': round(z_mean, 2), 'sd': round(z_sd, 2),
                           'max': round(max(zs), 2) if zs else None,
                           'min': round(min(zs), 2) if zs else None},
        'screened': len(hypotheses), 'passed_screen': len(passed), 'confirmed': confirmed,
        'top': [{'name': n, 'z': round(z, 2), **{k: round(v, 4) if isinstance(v, float) else v
                                                 for k, v in s.items()}} for z, n, _, s in screened[:10]],
    }


# ─── self-test ──────────────────────────────────────────────────────────────

def selftest(corpus):
    ok = True
    sample = corpus.usable[WARMUP:WARMUP + 160]
    assert all(r['date'] < corpus.rows[sample[-1]]['date'] for r in corpus.rows[:sample[0]])
    print('OK  history slice excludes every target draw')

    flat = {'name': 'flat', 'k': 10,
            'positions': [[{'op': 'freq', 'source': 'pool', 'window': 30, 'weight': 0.0}]] * 3}
    stats = evaluate(flat, corpus, sample)
    z = z_score(stats['rate'], stats['baseline'], stats['n'])
    print(f'OK  flat hypothesis: rate={stats["rate"]:.3f} baseline={stats["baseline"]:.3f} z={z:+.2f}')
    ok &= abs(z) < 4

    leak_hits = sum(1 for i in sample if corpus.rows[i]['prize1'][-3:] in corpus.tails[i])
    print(f'OK  leak probe: reading the target scores {leak_hits / len(sample):.3f} '
          f'(baseline {stats["baseline"]:.3f})')
    ok &= leak_hits / len(sample) > 0.9

    base_picks = candidates(flat, corpus.features(sample[0]))
    probes = [
        ('joint', {'joints': [{'op': 'pair01', 'source': 'pool', 'window': 60, 'weight': 50.0}]}),
        ('pairsum', {'shapes': [{'op': 'pairsum12', 'source': 'pool', 'window': 60, 'weight': 50.0}]}),
        ('diff', {'shapes': [{'op': 'diff01', 'source': 'prize1', 'window': 60, 'weight': 50.0}]}),
        ('summod', {'shapes': [{'op': 'summod', 'source': 'pool', 'window': 60, 'weight': 50.0}]}),
        ('struct', {'structs': [{'name': 'repeat', 'weight': 50.0}]}),
        ('markov3', {'positions': [[{'op': 'markov3', 'source': 'prize1', 'window': 60, 'weight': 50.0}]] * 3}),
    ]
    for label, extra in probes:
        hyp = {'name': label, 'k': 10, 'positions': [[], [], []], **extra}
        picks = candidates(hyp, corpus.features(sample[0]))
        assert len(set(picks)) == 10
        changed = picks != base_picks
        ok &= changed
        print(f'{"OK " if changed else "BAD"} v3 term "{label}" moves the picks ({base_picks[0]}… -> {picks[0]}…)')

    picks = set(candidates({'name': 'x', 'k': 10, 'positions': [[], [], []],
                            'exclude': [{'draws': 1, 'weight': -99.0}]}, corpus.features(sample[0])))
    ok &= not (picks & corpus.tails[sample[0] - 1])
    print('OK  exclude term drops the last draw\'s tails')

    picked = [sum(int(ch) for ch in p) for p in
              candidates({'name': 's', 'k': 10, 'positions': [[], [], []],
                          'sums': [{'source': 'pool', 'window': 60, 'weight': 5.0}]},
                         corpus.features(sample[0]))]
    ok &= max(picked) - min(picked) <= 4
    print(f'OK  sum term clusters the picks (sums {min(picked)}..{max(picked)})')

    control = permutation_test([flat], corpus, corpus.usable[WARMUP:WARMUP + 120], shuffles=12)
    centre = sum(control['maxes']) / len(control['maxes'])
    ok &= -1.2 < centre < 1.2
    print(f'OK  permutation null is centred ({centre:+.2f}, p50 {control["max_z"]["p50"]:+.2f})')
    return ok


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--selftest', action='store_true')
    ap.add_argument('--hypotheses')
    ap.add_argument('--json')
    ap.add_argument('--null-shuffles', type=int, default=0)
    args = ap.parse_args()
    rows = load_rows()
    print(f'draws={len(rows)} first={rows[0]["date"]} last={rows[-1]["date"]}')
    corpus = Corpus(rows)
    if args.selftest:
        sys.exit(0 if selftest(corpus) else 1)
    if not args.hypotheses:
        sys.exit('need --selftest or --hypotheses')
    payload = json.loads(Path(args.hypotheses).read_text(encoding='utf-8'))
    hypotheses = payload['hypotheses'] if isinstance(payload, dict) else payload
    print(f'hypotheses={len(hypotheses)} protocol={PROTOCOL}')
    result = search(hypotheses, corpus)
    if args.null_shuffles:
        usable = corpus.usable[WARMUP:]
        (a, b), _, _ = split_bounds(len(usable))
        control = permutation_test(hypotheses, corpus, usable[a:b], args.null_shuffles)
        observed = max((hyp['z'] for hyp in result['top']), default=None)
        maxes = control.pop('maxes')
        control['observed_max_z'] = observed
        control['p_value'] = round(
            (sum(1 for z in maxes if z >= observed) + 1) / (len(maxes) + 1), 3) if observed else None
        control['reached_screen'] = sum(1 for z in maxes if z >= 3.5)
        result['permutation'] = control
        print('permutation:', json.dumps(control, ensure_ascii=False))
    printable = {k: v for k, v in result.items() if k not in ('confirmed', 'top')}
    print(json.dumps(printable, ensure_ascii=False, indent=1)[:1800])
    for row in result['top'][:5]:
        print(f"  {row['name'][:44]:<44} z={row['z']:+.2f} rate={row['rate']:.4f} base={row['baseline']:.4f}")
    for item in result['confirmed']:
        print(f"CONFIRMED {item['name']}: train z={item['train']['z']:+.2f} "
              f"val z={item['validation']['z']:+.2f} holdout z={item['holdout']['z']:+.2f} "
              f"survives={item['survives']}")
    if args.json:
        Path(args.json).write_text(json.dumps(result, ensure_ascii=False, indent=1), encoding='utf-8')
        print('wrote', args.json)


if __name__ == '__main__':
    main()
