# ISSUE-4: Add F coefficient presets and wire into backtest comparison table

## Parent

PRD-formula-group-f-tuning.md

## What to build

Using the parameterized `_codexPool`/`_codexFormulas` from ISSUE-3, define 5-6 named coefficient presets analogous to FABLE's `_candidate_configs()` pattern: `baseline` (today's values, unchanged), `recency_heavy` (boost f24/f80), `sameday_heavy` (boost sameDay/sameMonth), `overdue_heavy` (boost overdue), and `balanced` (flatten the spread between signals). Exact numeric values are an implementation detail decided during coding.

Each preset produces its own named formula entry (following the existing naming convention, e.g. `F-recency-heavy · ท้ายคม`) that flows into `_computeFormulasBatch` exactly like any other formula. These appear as additional rows in the existing sortable backtest comparison table, grouped under the `F` badge, so their Edge can be compared directly against A-H and against each other — no new UI panel, no adjustable input fields.

The "ทำนาย" (predict) tab and any other single-recommendation UI surface continue to use only the baseline preset — non-baseline presets exist purely for backtest comparison and do not feed into live predictions or Decision Center scoring.

## Acceptance criteria

- [ ] 5-6 named presets are defined with fixed coefficient values (baseline preserves current production behavior exactly)
- [ ] Each preset produces a distinct formula entry that appears as its own row in the backtest comparison table after running `runFormulaBacktest()`, with correct `field`/group (`F`) metadata
- [ ] A test confirms presets with different coefficients produce different ranked pools for a fixture where signal values diverge meaningfully (e.g. high-f24/low-overdue number ranks differently under `recency_heavy` vs `overdue_heavy`)
- [ ] The "ทำนาย" tab's Group F output is unchanged (still uses baseline coefficients only)
- [ ] No new input fields, no persistence of custom coefficients, no changes to Group D or any other formula group

## Blocked by

- ISSUE-3 (needs `_codexPool` parameterized before presets can be wired through)
