# ISSUE-7: Add จักรพรรดิทองคำ (80/20 arithmetic blend on top of จักรพรรดิ's scorer)

## Parent

PRD-replace-fable-with-imperial-formulas.md

## What to build

Add a second "I" group formula, "จักรพรรดิทองคำ," reusing ISSUE-6's shared digit-position frequency scorer directly (not a copy of it). Each candidate's score is blended 80% frequency-score / 20% closeness to an arithmetic value already used by Group D: `(prize1 of the previous draw + day×month×year of the next draw date) mod 1,000,000`. Re-rank the blended scores and truncate to ~10 candidates, same as จักรพรรดิ.

The 80/20 blend must run on every candidate's score, not just as a tie-breaker — the point is that จักรพรรดิทองคำ produces genuinely different rankings from จักรพรรดิ for the same previous draw, not a cosmetic variant. จักรพรรดิทองคำ ships as a regular formula immediately (no experimental badge, no promotion gate), appears in the live "ทำนาย" tab and as its own row in the backtest table under the same "I · จักรพรรดิ" badge, and inherits the same empty-pool skip behavior as จักรพรรดิ.

## Acceptance criteria

- [ ] จักรพรรดิทองคำ calls ISSUE-6's shared scorer directly — no duplicated digit-position-frequency logic
- [ ] Each candidate's final score = 80% frequency-score + 20% closeness to `(prize1 + day×month×year of next draw) mod 1,000,000`
- [ ] A fixed-fixture test confirms จักรพรรดิ and จักรพรรดิทองคำ produce genuinely different candidate rankings for the same synthetic previous-draw fixture (proving the blend changes ranking, not just cosmetically)
- [ ] จักรพรรดิทองคำ appears as its own row in the backtest table under "I · จักรพรรดิ", hit-checked against `pool6`
- [ ] จักรพรรดิทองคำ renders candidates in the live "ทำนาย" tab using the same previous-draw + next-draw-date data every other live formula already receives
- [ ] No experimental/"ทดลอง" badge and no promotion-gate check
- [ ] จักรพรรดิทองคำ produces no output (skipped) for a previous draw with empty prize 1-5 pool fields
- [ ] Manual browser check: both จักรพรรดิ and จักรพรรดิทองคำ show distinct candidates and distinct edge numbers in the backtest table

## Blocked by

- ISSUE-6 (reuses its shared digit-position scorer directly)
