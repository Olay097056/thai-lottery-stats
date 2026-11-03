"""Offline hypothesis search for a measurable field (option 3).

A hypothesis is pure DATA (never code): per tail position, a weighted sum of features computed
strictly from draws before the target. The harness owns every operator, so a hypothesis cannot read
the future, import anything, or touch the network — the DSL is the sandbox.

Field: last-3 digits of the prize 1-4 pool of the target draw (~62 distinct tails / 1000), the only
field in this app where a real effect could be seen in years rather than millennia.

Protocol (mirrors ADR-0003's gate):
  train      oldest 60 % of evaluable targets — screening at z >= 3.5 (family-wise, ~200 hypotheses)
  validation next 20 %                        — confirmation at z >= 2.0
  holdout    newest 20 %                      — evaluated ONCE, never used for selection

Run:
    python scripts/rll_hypothesis_search.py --selftest
    python scripts/rll_hypothesis_search.py --hypotheses <file.json> [--json out.json]
"""
from __future__ import annotations

import argparse
import json
import math
import random
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import astra  # noqa: E402

WINDOWS = (30, 60, 120)
WARMUP = 60


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
            counts = [[0.0] * 10 for _ in range(3)]
            for tail in tails:
                for position in range(3):
                    counts[position][int(tail[position])] += 1.0
            self.pool_counts.append(counts)
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
            for position in range(3):
                # pool frequency over the window
                total = [0.0] * 10
                for j in range(start, index):
                    for d in range(10):
                        total[d] += self.pool_counts[j][position][d]
                s = sum(total) or 1.0
                feats[('freq', 'pool', window, position)] = [v / s for v in total]

                # pool gap: draws since a digit last appeared at this position
                gaps = [window] * 10
                for age, j in enumerate(range(index - 1, start - 1, -1)):
                    for d in range(10):
                        if gaps[d] == window and self.pool_counts[j][position][d] > 0:
                            gaps[d] = age
                top = max(gaps) or 1
                feats[('gap', 'pool', window, position)] = [g / top for g in gaps]

                # weekday: pool frequency restricted to the target's weekday
                total = [0.0] * 10
                for j in range(start, index):
                    if self.weekday[j] == target_weekday:
                        for d in range(10):
                            total[d] += self.pool_counts[j][position][d]
                s = sum(total) or 1.0
                feats[('weekday', 'pool', window, position)] = [v / s for v in total]

                # markov over prize-1 tails (defined for every draw)
                table = [[0.0] * 10 for _ in range(10)]
                for j in range(start + 1, index):
                    table[int(self.prize1_tail[j - 1][position])][int(self.prize1_tail[j][position])] += 1.0
                state = int(self.prize1_tail[index - 1][position]) if index else 0
                row = table[state]
                s = sum(row) or 1.0
                feats[('markov', 'pool', window, position)] = [v / s for v in row]

                # prize-1 tail features
                total = [0.0] * 10
                for j in range(start, index):
                    total[int(self.prize1_tail[j][position])] += 1.0
                s = sum(total) or 1.0
                feats[('freq', 'prize1', window, position)] = [v / s for v in total]

                gaps = [window] * 10
                for age, j in enumerate(range(index - 1, start - 1, -1)):
                    d = int(self.prize1_tail[j][position])
                    if gaps[d] == window:
                        gaps[d] = age
                top = max(gaps) or 1
                feats[('gap', 'prize1', window, position)] = [g / top for g in gaps]

                total = [0.0] * 10
                for j in range(start, index):
                    if self.weekday[j] == target_weekday:
                        total[int(self.prize1_tail[j][position])] += 1.0
                s = sum(total) or 1.0
                feats[('weekday', 'prize1', window, position)] = [v / s for v in total]
                feats[('markov', 'prize1', window, position)] = feats[('markov', 'pool', window, position)]
        return feats


# ─── hypotheses ─────────────────────────────────────────────────────────────

def candidates(hyp, feats):
    k = int(hyp.get('k', 10))
    orders = []
    for position in range(3):
        score = [0.0] * 10
        for term in hyp['positions'][position]:
            vec = feats.get((term['op'], term['source'], int(term['window']), position))
            if vec is None:
                continue
            w = float(term['weight'])
            for d in range(10):
                score[d] += w * vec[d]
        orders.append(sorted(range(10), key=lambda d: (-score[d], d)))
    out = []
    for r in range(k):
        out.append(''.join(str(orders[p][r % 10]) for p in range(3)))
    return list(dict.fromkeys(out))[:k]


def baseline_for(tails, k):
    return 1 - (1 - len(tails) / 1000) ** k


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

    If the observed best z is ordinary under this null, the search found nothing but noise — which is
    the only defensible way to read a 150-hypothesis sweep.
    """
    rng = random.Random(seed)
    originals = corpus.tails
    maxes = []
    try:
        for _ in range(shuffles):
            order = list(range(len(originals)))
            rng.shuffle(order)
            corpus.tails = [originals[i] for i in order]
            best = -9e9
            for hyp in hypotheses:
                stats = evaluate(hyp, corpus, train)
                best = max(best, z_score(stats['rate'], stats['baseline'], stats['n']))
            maxes.append(best)
    finally:
        corpus.tails = originals
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

    picks = candidates(flat, corpus.features(sample[0]))
    assert len(picks) == len(set(picks)) == 10, picks
    print('OK  10 distinct candidates per hypothesis')
    assert corpus.features(sample[0]) == corpus.features(sample[0])
    print('OK  features are deterministic per target')
    return ok


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--selftest', action='store_true')
    ap.add_argument('--hypotheses')
    ap.add_argument('--json')
    ap.add_argument('--null-shuffles', type=int, default=0,
                    help='run a permutation control with this many shuffles')
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
    print(f'hypotheses={len(hypotheses)}')
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
        result['permutation'] = control
        print('permutation:', json.dumps(control, ensure_ascii=False))
    print(json.dumps({k: v for k, v in result.items() if k != 'confirmed'}, ensure_ascii=False, indent=1)[:2500])
    for item in result['confirmed']:
        print(f"CONFIRMED {item['name']}: train z={item['train']['z']:+.2f} "
              f"val z={item['validation']['z']:+.2f} holdout z={item['holdout']['z']:+.2f} "
              f"survives={item['survives']}")
    if args.json:
        Path(args.json).write_text(json.dumps(result, ensure_ascii=False, indent=1), encoding='utf-8')
        print('wrote', args.json)


if __name__ == '__main__':
    main()
