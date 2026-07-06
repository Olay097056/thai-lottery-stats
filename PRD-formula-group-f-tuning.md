# PRD: Formula Group F (Rolling Stats) — Coefficient Preset Sweep

## Problem Statement

As the person maintaining the prediction formulas, I want to improve the Edge (%แม่นจริง − baseline) of Formula Group F (Rolling Stats / Codex), one of the 8 formula groups shown on the backtest page. Group F's scoring function (`_codexPool` in `static/formula-engine.js`) uses seven hardcoded coefficients (recency, frequency, and overdue weights) that were never systematically tuned — they were picked once and never revisited. I have no way today to see whether a different weighting of those signals would produce a higher Edge, because the coefficients are buried as inline constants in client-side JS with no comparison mechanism, unlike the prize1 beam search (`analyzer.py`/`scripts/sweep.py`) which already has a Python sweep script for exactly this purpose.

## Solution

Add a small, fixed set of coefficient presets for Group F's scoring function (baseline plus 4-5 alternative weightings emphasizing different signals: recency, same-day, overdue, and a balanced blend). Each preset runs through the existing backtest engine (`runFormulaBacktest`) and appears as its own row in the existing backtest comparison table, alongside the current A-H formulas — so Edge for each F variant can be compared directly against both the current F baseline and against the other formula groups, using the same sortable table and fairness metric already in place. No new UI surface, no adjustable input fields — presets are fixed in code, matching the pattern already used for FABLE's `_candidate_configs()`.

## User Stories

1. As the formula maintainer, I want Group F's scoring coefficients to be exposed as named presets, so that I can compare alternative weightings without editing code each time.
2. As the formula maintainer, I want each preset to appear as a separate row in the existing backtest table (not a separate panel), so that I can sort/compare its Edge directly against A-H and against other F variants in one place.
3. As the formula maintainer, I want the preset set limited to 5-6 fixed configurations (baseline, recency-heavy, same-day-heavy, overdue-heavy, balanced), so that the comparison stays readable and doesn't require a tuning UI.
4. As the formula maintainer, I want no changes made to Group D or any other formula group, so that this work stays scoped to the one group (F) that actually has tunable weights — Group D and the other groups (A/B/C/G/H) are fixed arithmetic/traditional formulas that should not be altered to fake tunability.
5. As the formula maintainer, I want the preset variants to reuse the same `_codexPool` scoring shape (same 7 signal types: sameDay, sameMonth, count, f80, f24, overdue, lastNum-decay) with only the coefficients changed, so that this is a genuine coefficient sweep and not a redesign of the scoring logic.
6. As the formula maintainer, I want each preset's backtest results computed via the existing `runFormulaBacktest` fairness machinery (same baseline-per-field-type, same Edge formula, same CI calculation), so that Edge numbers are directly comparable to every other row already in the table.
7. As a dashboard user viewing the backtest page, I want the current production F formula (baseline preset) to remain the one actually used for live predictions in the "ทำนาย" tab, so that adding comparison presets doesn't change what number the app recommends until a preset is deliberately promoted.
8. As the formula maintainer, if a preset beats the current baseline's Edge, I want the process of promoting it to production to be a manual, deliberate code change, so that swapping the live formula isn't accidental or automatic based on one backtest run.

## Implementation Decisions

- Introduce a small set of named coefficient objects for `_codexPool`'s scoring formula (currently inline: `sameDay*14 + sameMonth*4 + count*1.4 + f80*4 + f24*5 + overdue*0.18`, with a `*0.7` decay multiplier when `num === lastNum`). Refactor `_codexPool` to accept a coefficients parameter (defaulting to today's values) rather than hardcoding them, so presets can pass different values through the same function — this must not change output for the existing default preset (regression-safe refactor).
- Define 5-6 presets analogous to FABLE's `_candidate_configs()` pattern: `baseline` (today's values, unchanged), `recency_heavy` (boost f24/f80), `sameday_heavy` (boost sameDay/sameMonth), `overdue_heavy` (boost overdue), `balanced` (flatten the spread between signals). Exact numeric values are an implementation detail decided during coding, not fixed by this PRD.
- Each preset is computed via `_codexFormulas(rows, targetIso, coeffs)` (extended to pass coefficients through to `_codexPool`), producing its own named formula entry (e.g. `F-recency-heavy · ท้ายคม`, following the existing naming convention like `D1 สายธาร · ท้าย2`) that flows into `_computeFormulasBatch` exactly like any other formula — no special-casing in the backtest loop itself.
- Backtest comparison table (`_btRowData` / the existing sortable table in `formula-engine.js`) requires no structural changes — new preset entries are just additional rows with the existing `field`/`baseline`/group badge metadata (grouped under `F` badge, distinguished by name).
- The "ทำนาย" (predict) tab and any other UI surface that shows a single recommended F prediction continues to use the baseline preset only — presets beyond baseline exist purely for backtest comparison, they do not feed into the live prediction display or Decision Center scoring until a human decides to promote one (mirrors the FABLE promotion-gate philosophy already established in DEVELOPMENT_PLAN.md, though F does not have a formal gate since it's not experimental in the same sense).
- No changes to Group D or any other group's formulas, no new input fields, no persistence of custom coefficients — everything is fixed in code per this PRD's scope decision.

## Testing Decisions

- Test that `_codexPool` with the default/baseline coefficients produces byte-identical output to the current hardcoded implementation, for a fixed input fixture — this is the regression guard for the "parameterize without changing default behavior" refactor.
- Test that each non-baseline preset produces a *different* ranked pool than baseline for a fixture where the underlying signal values differ meaningfully (e.g. a number with high `f24` but low `overdue` should rank differently under `recency_heavy` vs `overdue_heavy`) — this locks in that presets are actually wired through to scoring, not silently ignored.
- Test that new preset formula entries flow through `_computeFormulasBatch` and appear in `_btRowData` with correct `field`/`group` metadata after a `runFormulaBacktest()` run — external behavior (table output), not internal loop mechanics.
- Prior art: this mirrors the existing (implicit) contract that `_claudeFormulas`/`_codexFormulas` outputs feed into `_computeFormulasBatch` unchanged — follow whatever test harness/fixture pattern already exists for Group D/F formulas in this codebase; if none exists yet, this PRD's tests establish the first one for `formula-engine.js` formula functions.

## Out of Scope

- Group D or any other formula group (A/B/C/E/G/H) — confirmed non-tunable, fixed arithmetic/traditional formulas, no work planned here.
- A UI for arbitrary/user-adjustable coefficient input — presets are fixed in code only.
- Automatic promotion of a winning preset to become the new production baseline — that's a manual follow-up decision, not part of this PRD.
- Persistent storage of sweep results across sessions (each backtest run is computed fresh, consistent with how the table already works today).
- Any change to the FABLE track (see companion PRD: `PRD-fable-promotion-gate.md`) — the two tracks are independent.

## Further Notes

- This PRD assumes Group F's `_codexPool` coefficients are read from client-side JS at `static/formula-engine.js` (verified during grilling: lines ~1114-1150). If this file has since moved or been refactored, locate the equivalent scoring function before implementing.
- The project has no build step (per CLAUDE.md) — implementation must stay within plain JS loaded via `<script>` tags, no bundler/transpiler introduced for this work.
- Hard rules from DEVELOPMENT_PLAN.md apply unchanged: no backtest-distorting logic, no "running number" (เลขวิ่ง) additions, lottery numbers stay strings.
