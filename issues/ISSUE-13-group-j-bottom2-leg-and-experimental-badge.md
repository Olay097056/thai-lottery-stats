# ISSUE-13: Group J bottom2 leg + ทดลอง badge display

## Parent

PRD-group-j-tycoon-formula.md

## What to build

Add a new client-side formula group "J" (เจ้าสัว) with its first leg: `bottom2 = pad2(|BK2 − DSUM|)`, where `BK2` is the previous draw's `back3_2` parsed as an int and `DSUM` is the target draw's day + month + 2-digit พ.ศ. year — the exact same `DSUM` computation Group D's `_claudeFormulas` already builds. This is the search finalist from the (now-closed) Group J promotion-gate search: it failed the holdout gate (train +0.0072, validation +0.0167, holdout −0.0021), so per ADR-0003 it ships anyway, honestly labeled ทดลอง rather than deleted.

Implement it as a fixed D1-style arithmetic block (same shape as Group D's D1–D4 sub-formulas) — no search harness, no live re-derivation, just the one fixed formula. Field type for backtest/live is the existing `bottom2` type (no new baseline math needed). Push its result into the shared formula-results array under a new `_GRP['J'] = ['J · เจ้าสัว', <new distinct color>]` entry, matching the existing `_GRP` badge-map pattern. It should appear as its own row in the backtest table and as a candidate in the live "ทำนาย" tab, using the same previous-draw + next-draw-date data every other live formula already receives. Skip generating output only when `back3_2` or the target date is missing — no fallback substitution.

This issue also builds the ทดลอง (Experimental) badge display mechanism itself — defined in `CONTEXT.md`'s glossary and mandated by ADR-0003, but never implemented in the UI. Add a `trust: 'ทดลอง' | null` field to formula-result entries (set for this new J formula, left unset for every existing A–I formula), and render a small badge/pill next to the group label wherever formula-group results are shown: group dropdown, backtest table rows, live "ทำนาย" tab candidate cards. This badge is display-only — it must not exclude Group J or its output from any existing ranking, scoring, or participation logic anywhere. (Propagating the badge onto Picks/เลขแนะนำ chips is a separate issue — ISSUE-14 — since it needs this formula as a real ทดลอง consumer to exist first.)

## Acceptance criteria

- [ ] `bottom2 = pad2(|BK2 − DSUM|)` is implemented as a fixed arithmetic block reusing Group D's existing `DSUM` computation (not a second, duplicate computation)
- [ ] A fixed-fixture test confirms the formula's output matches a hand-computed expected value for a synthetic previous-draw row + target date
- [ ] The formula skips output (no fallback) on a fixture missing `back3_2`, verified by a fixture test
- [ ] A new `_GRP['J']` entry exists with a color distinct from all existing group colors
- [ ] The formula appears as its own row in the backtest table under the "J · เจ้าสัว" badge, hit-checked against `bottom2`
- [ ] The formula renders candidates in the live "ทำนาย" tab using the same previous-draw/next-draw-date data object as other live formulas — no separate data-fetch path
- [ ] A `trust` field exists on formula-result entries; it is set to ทดลอง for this new formula and left unset for every existing A–I formula, verified by a fixture test with a mixed-trust results array
- [ ] A visible ทดลอง badge renders next to this formula's entry in the group dropdown, its backtest table row, and its live-tab candidate card
- [ ] Regression check: adding the `trust` field does not change any existing Edge/ranking/score number for A–I formulas (before/after fixture comparison)
- [ ] Manual browser check: live "ทำนาย" tab shows the J1 candidate with a visible ทดลอง badge; backtest table shows a "J · เจ้าสัว" row with the expected small negative-to-flat Edge (consistent with the holdout result — expected, not a bug); no console errors

## Blocked by

None - can start immediately
