# ISSUE-9: Rebranded สรุปงวดนี้ shell + เลขแนะนำ core section

## Parent

PRD-decision-center-rebrand-recommended-number.md

## What to build

Rebuild the "สรุปงวดนี้" sub-tab (now free of the old markup, per ISSUE-8) with a new layout and component set, built from the app's existing `:root` theme tokens (`--bg`, `--surface`, `--gold`, `--accent`, etc.) — no new palette. At the top of the new page, add the **เลขแนะนำ (Recommended Number)** section, the centerpiece of this rebrand.

เลขแนะนำ computation: a new pure function (independent of the existing `dcConsensusCandidates`, which must remain untouched since its same-length field-type merging is a different, already-shipped behavior) takes the raw per-formula-group results and returns, per field type, the ranked list of numbers where 2 or more *different top-level formula groups* (A–I, with F/Codex's `X`-prefixed sub-formulas counted as one group) independently produced the exact same number for the exact same field type. Sub-formulas within the same group agreeing (e.g. I1 + I2) does not count. Field types with only one historical producing group (`pool6`, `back3`, `prize1_last4_digits`, `bottom2_unit`) will therefore never produce a result — this is expected, not a bug, and needs no special-case exclusion code.

Within a field type, rank qualifying numbers by count of agreeing groups (descending), tie-broken by combined Edge of the agreeing groups (descending, reusing the existing Edge lookup already wired into the formula-match/backtest join). Render the top-ranked number per field type, with the rest of that field type's qualifying numbers available behind an expand affordance. A field type with zero qualifying numbers renders an honest empty state ("ยังไม่มีสูตรเห็นตรงกันในงวดนี้") — never backfilled with a lower-confidence substitute.

Two small features render from the same computed output in this section:
- **Explainer ("ทำไมถึงแนะนำ"):** shows which top-level groups agreed on each เลขแนะนำ (e.g. "A + D เห็นตรงกัน").
- **Coverage badge:** count of field types with a qualifying เลขแนะนำ this round, over the count of *structurally eligible* field types only (`bottom2`, `top3`, `front3`, `back3exact`, `prize1_last2` — 5, not all 9), so the denominator doesn't include field types that can mathematically never qualify.

## Acceptance criteria

- [ ] New layout/components for the สรุปงวดนี้ tab use only existing `:root` CSS variables — no new palette introduced
- [ ] A new pure function computes เลขแนะนำ, separate from and non-modifying of `dcConsensusCandidates`
- [ ] Convergence requires an exact field-type match (e.g. a `front3` guess and a `back3exact` guess of the same digits never count as agreeing)
- [ ] Convergence requires 2+ distinct top-level formula groups; two sub-formulas of the same group never count as agreeing
- [ ] `pool6`, `back3`, `prize1_last4_digits`, `bottom2_unit` fixtures never produce a เลขแนะนำ result regardless of input
- [ ] When multiple numbers qualify for one field type, the one with the most agreeing groups (tie-break: combined Edge) is shown first; others are reachable via an expand affordance
- [ ] A field type with no qualifying number shows a distinct empty-state message, not a substitute number
- [ ] Each rendered เลขแนะนำ shows which top-level groups agreed on it
- [ ] A coverage badge shows qualifying-field-type count over the 5 structurally-eligible field types (not 9)
- [ ] Fixture-based test script under `scripts/` (matching the project's existing fixture-script convention) covers: distinct-group agreement produces a result; same-group sub-formula agreement does not; same-digit-different-field-type does not; ranking order with multiple qualifiers; structural-exclusion fixtures for all four single-producer field types
- [ ] Manual browser check: rebranded สรุปงวดนี้ loads with the new layout, เลขแนะนำ section shows correct results/empty-states per field type, explainer and coverage badge render correctly, no console errors
- [ ] `dcConsensusCandidates` and the "หลักเด่น" strips it feeds are confirmed byte-for-byte unchanged

## Blocked by

- ISSUE-8 (takes over the สรุปงวดนี้ tab slot/id that ISSUE-8 frees up)
