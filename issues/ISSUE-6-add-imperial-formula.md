# ISSUE-6: Add จักรพรรดิ (digit-position frequency scorer + formula)

## Parent

PRD-replace-fable-with-imperial-formulas.md

## What to build

Add a new client-side formula, "จักรพรรดิ," under a new formula group "I" (badge "I · จักรพรรดิ", analogous to how the existing "X" prefix maps to "F · Codex"). This formula uses only the previous draw's combined prize 1-5 pool (near1, prize2, prize3, prize4, prize5 — the same ~168-number pool the renamed `pool6`/`pool_tail3` field type from ISSUE-5 already matches against), not any rolling multi-draw history.

Build a shared digit-position frequency scorer: count digit occurrences per position (1 through 6) across the previous draw's pool, rank digits per position by frequency. จักรพรรดิ takes the top-2 highest-frequency digit per position, combines them across all 6 positions (bounded cartesian expansion), ranks the resulting candidates by summed position-frequency score, and returns roughly 10 top candidates — consistent with the ~6-10 result size every other formula group already uses (so the pool6 baseline denominator stays comparable).

Write this scorer as its own reusable function (not inlined into จักรพรรดิ's formula function) since ISSUE-7's จักรพรรดิทองคำ builds directly on top of it rather than duplicating it.

จักรพรรดิ ships as a regular formula immediately — no experimental badge, no promotion gate, no separate "Lab" UI. It appears in both the live "ทำนาย" prediction tab (using the same previous-draw data object every other live formula already receives) and the backtest table (as its own named row, hit-checked against `pool6`).

Skip generating output entirely when the previous draw has no prize 1-5 pool data (empty near1/prize2-5 fields) — same skip behavior the rest of the Sanook-dependent formulas already use.

## Acceptance criteria

- [ ] A reusable digit-position frequency scorer function exists, taking a previous-draw prize 1-5 pool and returning ranked digits per position
- [ ] A fixed-fixture test confirms the scorer's ranked output matches a known expected result for a synthetic (non-live-cache) previous-draw pool
- [ ] จักรพรรดิ generates ~10 six-digit candidates from the top-2-per-position combination, ranked by summed score
- [ ] จักรพรรดิ appears as its own row in the backtest table under the "I · จักรพรรดิ" badge, hit-checked against the `pool6` field type from ISSUE-5
- [ ] จักรพรรดิ renders candidates in the live "ทำนาย" tab using the same previous-draw data object as other live formulas — no separate data-fetch path
- [ ] No experimental/"ทดลอง" badge and no promotion-gate check anywhere for this formula
- [ ] จักรพรรดิ produces no output (skipped) for a previous draw with empty prize 1-5 pool fields, verified by a fixture test
- [ ] Manual browser check: candidates appear on both the predict tab and backtest table with a real (non-zero, non-error) edge number

## Blocked by

- ISSUE-5 (needs the renamed `pool6`/`pool_tail3` field type and FABLE fully removed first)
