# ISSUE-15: Group J pool6 leg (80/20 blend with |BK2 − DSUM|)

## Parent

PRD-group-j-tycoon-formula.md

## What to build

Add Group J's second leg, targeting the `pool6` field type. Reuse Group I's existing digit-position-frequency scorer directly — call `_buildPrize1to5Pool` and `_digitPosFreq` (do not duplicate them) — the same reuse convention จักรพรรดิทองคำ already follows for จักรพรรดิ's scorer.

To avoid producing candidates numerically identical to จักรพรรดิ/จักรพรรดิทองคำ for the same previous draw (which would silently break เลขแนะนำ's "distinct top-level groups" agreement rule), blend the frequency ranking 80/20 with Group J's own arithmetic atom from ISSUE-13 — closeness to `|BK2 − DSUM|` — using the same blend-then-rerank structure จักรพรรดิทองคำ already established for its own 80/20 blend, but keyed to this J-native atom instead of Group D's. Re-rank the blended scores and truncate to ~10 candidates via `_imperialRoundRobin`, same as both Group I formulas.

Per ADR-0003, this leg is permanently ทดลอง — at ~456 pool-covered draws, 10 candidates expect under 1 chance-hit across the entire history, so no gate could ever distinguish skill from luck here regardless of the formula's quality. Push its result into the shared results array under the same `_GRP['J']` entry ISSUE-13 introduced, reusing that issue's ทดลอง badge display (group dropdown, backtest row, live tab) — no new badge-display code needed here. Skip generating output when the previous draw has no prize 1-5 pool data, matching จักรพรรดิ/จักรพรรดิทองคำ's existing skip behavior.

## Acceptance criteria

- [ ] The pool6 leg calls `_buildPrize1to5Pool`/`_digitPosFreq` directly — no duplicated digit-position-frequency logic
- [ ] Each candidate's final score = 80% frequency-score + 20% closeness to `|BK2 − DSUM|` (the same atom ISSUE-13's bottom2 leg computes)
- [ ] A fixed-fixture test confirms this leg's candidates differ from both จักรพรรดิ's (I1) and จักรพรรดิทองคำ's (I2) candidates for the same synthetic previous-draw pool fixture — proving the blend produces a genuinely distinct signal, not a relabeled duplicate
- [ ] The leg produces no output (skipped) for a fixture previous draw with empty prize 1-5 pool fields
- [ ] The leg appears as its own row in the backtest table under the existing "J · เจ้าสัว" badge (from ISSUE-13), hit-checked against `pool6`, carrying the ทดลอง badge
- [ ] The leg renders candidates in the live "ทำนาย" tab using the same previous-draw data object every other live formula receives
- [ ] Manual browser check: live "ทำนาย" tab and backtest table both show distinct candidates and distinct edge numbers for this leg vs. จักรพรรดิ/จักรพรรดิทองคำ and vs. ISSUE-13's bottom2 leg; ทดลอง badge visible; no console errors

## Blocked by

- ISSUE-13 (reuses its `_GRP['J']` entry and ทดลอง badge display mechanism, and its `|BK2 − DSUM|` computation)
