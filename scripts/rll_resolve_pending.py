#!/usr/bin/env python3
"""Close the RLL reward loop: score every stored forecast whose draw has a first prize.

`rll.resolve` is the only way a reward enters the bandit, and nothing in the app calls it — which is
why `rll_rewards` and `rll_arms` sat empty and every arm stayed at n = 0. This script is that caller.

It never guesses: a stored forecast whose draw has no result in the cache is reported as `pending`
and left alone, and re-running it is a no-op because `resolve` is append-only on
`(target_date, protocol)`.

    python scripts/rll_resolve_pending.py            # score what has landed
    python scripts/rll_resolve_pending.py --dry-run  # show what would be scored
    python scripts/rll_resolve_pending.py --json     # machine-readable

The app runs the same sweep after a cache write (see `_resolve_rll_after_cache_change` in main.py),
so a draw that lands while the server is up closes its own loop. This script is the manual path for
a stopped server or a catch-up run.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import rll  # noqa: E402


def main(argv=None):
    parser = argparse.ArgumentParser(description='Score stored RLL forecasts against landed draws.')
    parser.add_argument('--dry-run', action='store_true', help='report without writing rewards')
    parser.add_argument('--json', action='store_true', help='print the rows as JSON')
    args = parser.parse_args(argv)

    try:
        rows = rll.resolve_pending(dry_run=args.dry_run)
    except Exception as exc:                     # a broken cache is a real failure, report it loudly
        print(f'cannot read the draw cache: {exc}', file=sys.stderr)
        return 2

    if args.json:
        print(json.dumps({'dry_run': args.dry_run, 'database': str(rll.DB), 'rows': rows},
                         ensure_ascii=False, indent=1))
    else:
        print(f'database: {rll.DB}' + ('   (dry run — nothing written)' if args.dry_run else ''))
        if not rows:
            print('no stored forecasts yet — the RLL tab registers one on its first read of a draw')
        for row in rows:
            day = row['target_date']
            if row['status'] == 'pending':
                print(f'  {day}  pending   no result in the cache yet')
            elif row['status'] == 'skipped':
                print(f'  {day}  skipped   the stored record is {row["reason"]}')
            elif row['status'] == 'would_resolve':
                hit = 'PAYOUT' if row['payout'] else ''
                print(f'  {day}  would be  r={row["r"]} vs prize1 {row["prize1"]} {hit}'.rstrip())
            else:
                hit = 'PAYOUT' if row['payout'] else ''
                print(f'  {day}  {row["status"]:<9} r={row["r"]} best={row["matched"]} '
                      f'vs prize1 {row["prize1"]} {hit}'.rstrip())

    state = rll.state()
    arm_summary = ', '.join(f'{a["arm"]} n={a["n"]}' for a in state['arms'] if a['n'])
    print(f'\nresolved draws: {state["resolved"]} · payouts: {state["payouts"]} · '
          f'mean r: {state["mean_r"] if state["mean_r"] is not None else "—"}')
    print(f'arms with data: {arm_summary or "none yet"}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
