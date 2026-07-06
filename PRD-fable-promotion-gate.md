# PRD: FABLE Grid Search — Rolling Window Comparison for Promotion Gate

## Problem Statement

As the person maintaining the FABLE formula lab, I can currently compare 20 candidate configs against each other on a single train/holdout split (`/api/fable-grid-search`), but the promotion gate criteria (defined in DEVELOPMENT_PLAN.md) require a config to prove itself *repeatedly* across multiple rolling windows (W50/W100/W200), not just one holdout slice. Right now I have no way to see, in one place, whether any of the 20 candidate configs are consistently good across window sizes — I can only see this for the single default config via `/api/fable-backtest?gate=true`. This means I can't tell "did this config get lucky on one split" from "this config is actually stable," which is exactly the trap Phase 4's Definition of Done is trying to avoid ("รายงาน W50/W100/W200 + holdout แยกจาก train window", "ไม่ใช่ดีงวดเดียว").

## Solution

Extend the existing FABLE grid search so that, after ranking all candidate configs by holdout score, the top 5 are automatically re-evaluated across the same rolling windows (W50/W100/W200) already used by the single-config gate check. The comparison table in FABLE Lab UI shows, for each of those 5 configs, its train score, holdout score, overfit gap, and W50/W100/W200 edge for tail2 and tail3 — all in one screen, from one button press, with no persistence required (this is a point-in-time experiment run, not a saved history).

## User Stories

1. As the FABLE maintainer, I want to run grid search once and see the top 5 configs re-evaluated across W50/W100/W200, so that I can tell which configs are stable rather than lucky on one split.
2. As the FABLE maintainer, I want the top-N selection to be based on holdout score (not the `stable` flag), so that I still get a meaningful comparison even when no config currently passes the stability bar.
3. As the FABLE maintainer, I want the rolling-window re-evaluation to reuse the exact same window logic as `/api/fable-backtest?gate=true`, so that numbers are directly comparable to the values already reported for the default config in DEVELOPMENT_PLAN.md.
4. As the FABLE maintainer, I want the comparison table to show train, holdout, overfit_gap, and W50/W100/W200 edge (tail2 + tail3) per config in one table, so that I can judge consistency at a glance without cross-referencing multiple screens.
5. As the FABLE maintainer, I want this to run as a single on-demand computation (no saved snapshots, no persistence layer), so that the feature doesn't add file/database state to maintain.
6. As the FABLE maintainer, I want the experiment to be re-runnable with the same result given the same config and same cached data, so that I can trust the numbers when writing them into CHANGELOG.md.
7. As the FABLE maintainer, I want the existing 12-of-20 config limit (`max_configs`) and train/holdout evaluation to be untouched for configs outside the top 5, so that the initial screening pass stays as fast as it is today.
8. As the FABLE maintainer, I want no change to the promotion gate criteria itself (the thresholds in DEVELOPMENT_PLAN.md stay the same), so that this PRD is purely about visibility/comparison, not about relaxing the bar.

## Implementation Decisions

- Extend `fable_grid_search` (in `fable_formula.py`) so that after computing `train`/`holdout`/`overfit_gap`/`stable` for all evaluated configs (existing behavior, unchanged), it selects the **top 5 configs by holdout score** (not by the `stable` boolean — selection must work even when zero configs are currently stable).
- For each of those top 5 configs, run the same rolling-window evaluation already implemented for the single-config gate path (`/api/fable-backtest?gate=true`) at W50, W100, and W200, producing tail2/tail3 edge per window. Reuse that evaluation logic directly rather than reimplementing it — do not duplicate the rolling-window math in two places.
- The response shape of `/api/fable-grid-search` gains a `rolling` field on each of the top-5 result entries, containing `{w50: {tail2_edge, tail3_edge}, w100: {...}, w200: {...}}`. Configs outside the top 5 are unaffected (train/holdout only, as today).
- FABLE Lab UI's grid-search comparison table adds columns for W50/W100/W200 tail2/tail3 edge, populated only for the top-5 rows; other rows show train/holdout as before.
- No new persistence (no JSON snapshot files, no localStorage, no new DB/cache). Every run is computed fresh against current `lottery_cache.csv` data — this is a point-in-time comparison tool, not an experiment history log.
- No change to `_candidate_configs()` (still 20 static candidates) and no change to promotion gate thresholds in DEVELOPMENT_PLAN.md.
- After a real experiment run whose results the maintainer wants to keep, CHANGELOG.md is updated by hand as today — this PRD does not automate changelog writing.

## Testing Decisions

- Focus tests on the external behavior of `fable_grid_search`: given a df fixture with enough draws, assert that the returned top-5 entries have a `rolling` key with `w50`/`w100`/`w200` sub-objects containing `tail2_edge`/`tail3_edge` numeric fields, and that entries outside the top 5 do not have a `rolling` key (or have it empty/absent) — this locks in the "only top 5 get rolling eval" contract without testing internal ranking implementation details.
- Test that top-5 selection is driven by holdout score even when no config's `stable` flag is true (construct a fixture where all `stable` values are false) — this is the specific bug this PRD prevents (empty comparison table when nothing currently passes gate).
- Test that the rolling-window numbers computed inside grid search for a given config match the numbers `/api/fable-backtest?gate=true` produces for that same config on the same data — this is the "reuse, don't duplicate" contract; a passing test here catches drift between the two code paths.
- Prior art: existing tests/usage pattern in `scripts/sweep.py` and `fable_grid_search`'s existing train/holdout evaluation (`evaluate()` helper) — follow the same "assert on returned dict, not on internal loop structure" style already used there.
- No UI/browser tests required — table rendering is a thin presentation layer over the API response; the API-level contract test is the important one.

## Out of Scope

- Persistent experiment history / snapshot storage across sessions (explicitly rejected — see Solution).
- Changing the promotion gate thresholds themselves.
- Adding rolling-window evaluation to all 20 candidates (only top 5 by holdout score).
- Any change to `_candidate_configs()` contents (adding/removing/tuning candidate configs is a separate concern).
- Automating CHANGELOG.md updates.
- Any change to A-H formula groups or `analyzer.py` prize1 tuning (see companion PRD: `PRD-formula-group-f-tuning.md`).

## Further Notes

- This PRD directly closes the "Experiment history compare" item listed as "งานถัดไป" in DEVELOPMENT_PLAN.md Phase 4, reinterpreted per user decision as a point-in-time comparison rather than persistent history.
- Current state for context (may be stale by implementation time): FABLE does not pass the promotion gate — default config tail2 edge +0.155, tail3 edge −0.025 on rolling; validation/live windows are negative. This PRD does not change that outcome; it only makes it faster to discover whether any of the 20 alternative configs do better.
- Hard rules from DEVELOPMENT_PLAN.md apply unchanged: no backtest-distorting logic, no "running number" (เลขวิ่ง) additions, lottery numbers stay strings, no promoting FABLE to "recommended" before the gate passes.
