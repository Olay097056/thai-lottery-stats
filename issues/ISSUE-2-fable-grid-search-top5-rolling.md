# ISSUE-2: Top-5 holdout-ranked configs get rolling-window comparison in grid search

## Parent

PRD-fable-promotion-gate.md

## What to build

Extend `/api/fable-grid-search` so that after computing train/holdout/overfit_gap/stable for all evaluated configs (existing behavior, unchanged), it selects the **top 5 configs by holdout score** — not by the `stable` flag, since selection must still produce a comparison even when zero configs currently pass the stability bar — and re-evaluates those 5 using the rolling-window function from ISSUE-1 (W50/W100/W200 tail2/tail3 edge).

The response gains a `rolling` field on each of the top-5 entries only; configs outside the top 5 are unaffected (train/holdout only, as today). FABLE Lab UI's grid-search comparison table adds columns for W50/W100/W200 tail2/tail3 edge, populated only for the top-5 rows.

No persistence — this is a fresh, on-demand computation every time the grid search runs. No change to promotion gate thresholds or to `_candidate_configs()` contents.

## Acceptance criteria

- [ ] Given a data fixture with enough draws, the top 5 entries (by holdout score) in the grid-search response include a `rolling` key with `w50`/`w100`/`w200` sub-objects containing numeric `tail2_edge`/`tail3_edge`
- [ ] Entries outside the top 5 do not have rolling-window data computed
- [ ] Top-5 selection works correctly (produces a non-empty comparison) even when every config's `stable` flag is false
- [ ] Rolling-window numbers computed here match what `/api/fable-backtest?gate=true` produces for the same config on the same data (verifies reuse of ISSUE-1's function, catches drift)
- [ ] FABLE Lab UI table displays W50/W100/W200 tail2/tail3 edge columns for the top-5 rows
- [ ] No new persistence added (no snapshot files, no localStorage, no DB) — every run is computed fresh
- [ ] No change to `_candidate_configs()` or to promotion gate thresholds in DEVELOPMENT_PLAN.md

## Blocked by

- ISSUE-1 (needs the extracted reusable rolling-window evaluation function)
