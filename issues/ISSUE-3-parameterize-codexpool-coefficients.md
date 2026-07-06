# ISSUE-3: Parameterize `_codexPool` scoring coefficients (default-preserving refactor)

## Parent

PRD-formula-group-f-tuning.md

## What to build

Formula Group F's scoring function `_codexPool` (in `static/formula-engine.js`) currently hardcodes its seven scoring coefficients inline (`sameDay*14 + sameMonth*4 + count*1.4 + f80*4 + f24*5 + overdue*0.18`, plus a `*0.7` decay multiplier when a number matches the most recent draw). Refactor `_codexPool` — and its caller `_codexFormulas` — to accept a coefficients object as a parameter, defaulting to today's exact values, so that alternate coefficient sets can be passed through in a later issue without touching the scoring math itself.

This is a regression-safe refactor: output for the default/baseline coefficients must be identical to the current hardcoded behavior. No presets, no UI, no new formula entries in this issue — purely making the existing function tunable.

## Acceptance criteria

- [ ] `_codexPool` accepts a coefficients parameter covering all 7 signal weights (sameDay, sameMonth, count, f80, f24, overdue, lastNum-decay)
- [ ] `_codexFormulas` passes coefficients through to `_codexPool` for all four pools it computes (bottomSharp, front3, back3, prize1Last2)
- [ ] Calling `_codexPool`/`_codexFormulas` with no coefficients argument (or the default) produces byte-identical output to the current hardcoded implementation, verified against a fixed input fixture
- [ ] No change to any formula names, backtest table rows, or live "ทำนาย" tab output in this issue

## Blocked by

None - can start immediately
