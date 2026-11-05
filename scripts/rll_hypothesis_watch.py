"""Re-run the archived hypothesis sweep when new draws arrive, and record every run.

Why this exists: the sweep's conclusion ("nothing beats chance") is only as fresh as the data. The
honest way to revisit it is to re-run the *same frozen hypothesis set* on the *same protocol* whenever
the field grows — not to invent a fresh family and search until something looks good.

The watcher therefore:
  * refuses to re-run when the data has not changed (no new draw since the last record),
  * appends one line per run to a JSONL log, so "run it again until it passes" is visible,
  * derives the alert threshold from the sweep's own permutation null when one is computed,
  * exits 2 (a real alert) only if a hypothesis clears that threshold.

Run:
    python scripts/rll_hypothesis_watch.py                     # record a baseline / detect new data
    python scripts/rll_hypothesis_watch.py --force --null-shuffles 200
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / 'scripts'))

from rll_hypothesis_search import (  # noqa: E402
    Corpus, PROTOCOL, WARMUP, load_rows, permutation_test, search, split_bounds,
)

DEFAULT_HYPOTHESES = ROOT / 'docs' / 'research' / 'rll-hypotheses-2026-11.json'
DEFAULT_LOG = ROOT / '.scratch' / 'rll-hypothesis-watch' / 'log.jsonl'
DEFAULT_GATE = 4.0  # 95th percentile of the 587-hypothesis permutation null


def data_as_of(rows):
    return rows[-1]['date']


def load_log(path):
    if not path.exists():
        return []
    records = []
    for line in path.read_text(encoding='utf-8').splitlines():
        line = line.strip()
        if line:
            try:
                records.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    return records


def last_record_for(records, protocol):
    for record in reversed(records):
        if record.get('protocol') == protocol:
            return record
    return None


def run_sweep(rows, hypotheses, shuffles=0, seed=7):
    corpus = Corpus(rows)
    result = search(hypotheses, corpus)
    best = result['top'][0] if result['top'] else None
    record = {
        'protocol': PROTOCOL,
        'data_as_of': data_as_of(rows),
        'draws': len(rows),
        'usable_draws': result['usable_draws'],
        'hypotheses': result['screened'],
        'passed_screen': result['passed_screen'],
        'best': best,
        'gate': DEFAULT_GATE,
        'z_distribution': result['z_distribution'],
    }
    if shuffles:
        usable = corpus.usable[WARMUP:]
        (a, b), _, _ = split_bounds(len(usable))
        control = permutation_test(hypotheses, corpus, usable[a:b], shuffles, seed=seed)
        maxes = control.pop('maxes')
        observed = best['z'] if best else 0.0
        control['observed_max_z'] = observed
        control['p_value'] = round(
            (sum(1 for z in maxes if z >= observed) + 1) / (len(maxes) + 1), 3)
        record['permutation'] = control
        record['gate'] = control['max_z']['p95']  # the honest gate is this run's 95th percentile
    record['alert'] = bool(best and best['z'] >= record['gate'])
    return record


def summarise(record):
    best = record.get('best') or {}
    lines = [
        f"data as of {record['data_as_of']} · {record['usable_draws']} usable draws · "
        f"{record['hypotheses']} hypotheses",
        f"best z {best.get('z', 0):+.2f} ({best.get('name', '—')}) vs gate {record['gate']:.2f} "
        f"· passed screen {record['passed_screen']}",
    ]
    if record.get('permutation'):
        control = record['permutation']
        lines.append(f"null p50 {control['max_z']['p50']:+.2f} · p95 {control['max_z']['p95']:+.2f} "
                     f"· p = {control['p_value']}")
    lines.append('ALERT: something cleared the gate' if record['alert'] else 'no signal above the gate')
    return '\n'.join(lines)


def write_summary(record, path):
    """Keep the file the UI reads in step with the last real run.

    Static context (split windows, model, token spend) is preserved; every number that the strip
    renders comes from the run that just happened.
    """
    try:
        payload = json.loads(path.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        payload = {}
    payload.update({
        'protocol': record['protocol'],
        'hypotheses': record['hypotheses'],
        'usable_draws': record['usable_draws'],
        'draws': record['draws'],
        'data_as_of': record['data_as_of'],
        'best': {k: record['best'][k] for k in ('name', 'z', 'rate', 'baseline') if k in record['best']},
        'gate': round(record['gate'], 3),
        'passed_screen': record['passed_screen'],
        'alert': record['alert'],
        'generated_at': record['ran_at'],
    })
    if record.get('permutation'):
        payload['p_value'] = record['permutation']['p_value']
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--hypotheses', default=str(DEFAULT_HYPOTHESES))
    ap.add_argument('--log', default=str(DEFAULT_LOG))
    ap.add_argument('--null-shuffles', type=int, default=0)
    ap.add_argument('--force', action='store_true', help='re-run even when the data has not changed')
    ap.add_argument('--summary', default=str(ROOT / 'data' / 'rll_research_summary.json'),
                    help='file the UI reads; rewritten from this run (empty string to skip)')
    ap.add_argument('--quiet', action='store_true')
    args = ap.parse_args()

    rows = load_rows()
    payload = json.loads(Path(args.hypotheses).read_text(encoding='utf-8'))
    hypotheses = payload['hypotheses'] if isinstance(payload, dict) else payload
    log_path = Path(args.log)
    records = load_log(log_path)
    previous = last_record_for(records, PROTOCOL)

    if previous and previous.get('data_as_of') == data_as_of(rows) and not args.force:
        if not args.quiet:
            print(f'no new draw since {previous["data_as_of"]} — nothing to re-evaluate')
            print(f'last run: best z {(previous.get("best") or {}).get("z", 0):+.2f} '
                  f'vs gate {previous.get("gate")}')
        return 0

    record = run_sweep(rows, hypotheses, args.null_shuffles)
    record['ran_at'] = datetime.now().isoformat(timespec='seconds')
    if previous:
        record['previous'] = {'ran_at': previous.get('ran_at'), 'data_as_of': previous.get('data_as_of'),
                              'best_z': (previous.get('best') or {}).get('z')}
    log_path.parent.mkdir(parents=True, exist_ok=True)
    with log_path.open('a', encoding='utf-8') as handle:
        handle.write(json.dumps(record, ensure_ascii=False) + '\n')
    if args.summary:
        write_summary(record, Path(args.summary))
    if not args.quiet:
        print(summarise(record))
        if previous:
            delta = record['best']['z'] - (previous.get('best') or {}).get('z', 0)
            print(f"vs previous run ({previous.get('data_as_of')}): Δz {delta:+.2f}")
        print(f'logged to {log_path}')
    return 2 if record['alert'] else 0


if __name__ == '__main__':
    sys.exit(main())
