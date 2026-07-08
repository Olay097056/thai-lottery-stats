# ISSUE-14: ทดลอง badge propagation onto Picks and เลขแนะนำ

## Parent

PRD-group-j-tycoon-formula.md

## What to build

Propagate the ทดลอง badge built in ISSUE-13 onto the two surfaces where formula evidence gets aggregated into a single user-facing chip: Picks (the สรุปงวดนี้ Hero/Confidence board) and เลขแนะนำ (Recommended Number).

Wherever a Pick's supporting-formula list is assembled (the `sources`/`topEdge` aggregation feeding `dcEdgeBadge`), if any contributing formula carries `trust: 'ทดลอง'`, the rendered Pick chip also shows the ทดลอง badge. Wherever เลขแนะนำ's agreeing-groups list is assembled (`dcRecommendedNumbers`/`dcRecoTopOverall`), if Group J (or any future ทดลอง-badged group) is among the agreeing groups for a candidate, that เลขแนะนำ chip also shows the badge. Propagation is "any," not "all" — a Pick or เลขแนะนำ candidate with mixed trusted/ทดลอง support still shows the badge, since the honesty goal is "some of this evidence is unproven," not "all of it is."

Per ADR-0003 decision #6 and the CONTEXT.md glossary entry, this remains strictly cosmetic: no new gating branch anywhere in Pick-scoring or เลขแนะนำ-ranking logic. A ทดลอง-supported Pick or เลขแนะนำ candidate must rank, score, and participate identically to how it would without this issue — only its rendered badge changes.

## Acceptance criteria

- [ ] A fixture Pick whose only supporting formula is ทดลอง (e.g. Group J's bottom2 leg from ISSUE-13) shows the badge on its chip
- [ ] A fixture Pick with only non-ทดลอง support does not show the badge
- [ ] A fixture Pick with mixed ทดลอง and non-ทดลอง support shows the badge (propagation is "any")
- [ ] The same three cases are verified for a เลขแนะนำ candidate (only-ทดลอง agreeing group, only-trusted agreeing groups, mixed)
- [ ] Regression check: Pick scores/ranks and เลขแนะนำ ranking order (group count → combined Edge → num asc) are byte-identical before and after this change for a fixture with no ทดลอง-badged formulas involved
- [ ] Test runs the real engine (matching the `scripts/test_reco_producer_groups.js` vm-based approach) rather than a hand-rolled mock of the aggregation logic
- [ ] Manual browser check: a Pick or เลขแนะนำ chip currently supported in part by Group J's bottom2 leg visibly carries the ทดลอง badge; no console errors

## Blocked by

- ISSUE-13 (needs a real ทดลอง-badged formula in the results array to propagate from, and the `trust` field it introduces)
