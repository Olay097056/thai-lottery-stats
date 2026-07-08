# PRD: Ship Group J (เจ้าสัว) — bottom2 leg (failed-gate finalist) + pool6 leg (Imperial-style port), both ทดลอง

## Problem Statement

As the formula maintainer, I ran a systematic search (not folk wisdom, not hand-tuned) over a declared arithmetic family — previous single draw + target date only — looking for a `bottom2` formula with a real, non-overfit edge, following the exact discipline ADR-0003 set up specifically to avoid repeating FABLE's overfitting failure. The search (`scripts/proto_group_j_bottom2_search.py`, documented in `scripts/NOTES-group-j-bottom2-search.md`) found a finalist by validation Edge, but it failed on the untouched holdout tail — a clean, decisive fail (train +0.0072, validation +0.0167, holdout −0.0021), not a borderline case. Per the design decided in ADR-0003 before this search ran, failing the gate does **not** mean discarding the work like FABLE was discarded — it means the formula ships anyway, honestly labeled ทดลอง (Experimental), alongside a second, permanently-ทดลอง `pool6` leg that reuses Group I's existing digit-frequency method under the Group J name. Right now, neither leg exists in the app, and the ทดลอง badge concept itself — defined in `CONTEXT.md`'s glossary and mandated by ADR-0003 to propagate onto any Pick or เลขแนะนำ a ทดลอง formula supports — has never been implemented in the UI; every formula in the dashboard today (A–I) renders as if fully trusted.

## Solution

Add a new formula group "J" (เจ้าสัว) with two legs, both shipped from day one under a ทดลอง badge:

1. **bottom2 leg** — the fixed-arithmetic finalist from the search: `bottom2 = pad2(|BK2 − DSUM|)`, where `BK2` is the previous draw's `back3_2` (parsed as int) and `DSUM` is the target draw's day + month + 2-digit พ.ศ. year — the same `DSUM` building block Group D's `_claudeFormulas` already computes. Implemented as fixed client-side arithmetic (no search harness ships), matching the D1-style block structure.
2. **pool6 leg** — reuses Group I's shared digit-position-frequency scorer (`_buildPrize1to5Pool` + `_digitPosFreq` + `_imperialRoundRobin`) to produce its own ~10-candidate set against the combined prize 1–5 pool, ported under the J/เจ้าสัว name. Per ADR-0003, this leg is permanently ทดลอง — at ~456 pool-covered draws, 10 candidates expect under 1 chance-hit across the whole history, so no gate could ever distinguish skill from luck here; the point of this leg is Group J having full field-type coverage (bottom2 + pool6, mirroring Group I's own two-leg shape), not a claim of edge.

Alongside the two formulas, this PRD also implements the ทดลอง badge mechanism itself (display-only, per `CONTEXT.md`'s definition): a visual marker on any formula-group entry wearing it, propagating onto any Pick or เลขแนะนำ chip whose supporting evidence includes a ทดลอง formula — this has been designed (ADR-0003, CONTEXT.md) but never built, and Group J is the first formula that needs it live.

Both legs participate fully in Picks and เลขแนะนำ immediately — ทดลอง is a trust label, not a participation gate (ADR-0003 decision #6).

## User Stories

1. As the formula maintainer, I want the bottom2 leg's formula (`pad2(|BK2 − DSUM|)`) implemented as fixed client-side arithmetic in `formula-engine.js`, so that the search harness's answer is captured permanently without carrying the throwaway Python search script forward.
2. As the formula maintainer, I want the bottom2 leg to reuse the same previous-draw/target-date context object (`P,T3,B2,BK1,BK2,D,M,Y2,DSUM`) that Group D's `_claudeFormulas` already builds, so that no duplicate context-building logic is introduced for a formula shaped exactly like Group D's.
3. As the formula maintainer, I want the pool6 leg to call Group I's existing `_buildPrize1to5Pool`/`_digitPosFreq`/`_imperialRoundRobin` functions directly (not duplicate them), so that the digit-frequency method has one source of truth across Groups I and J.
4. As a dashboard user, I want both Group J legs to appear as their own named rows in the backtest table under a "J · เจ้าสัว" badge (matching the existing `_GRP` badge-map pattern for A–I), so that their Edge is directly comparable to every other group.
5. As a dashboard user, I want both Group J legs visible on the live "ทำนาย" tab using the same previous-draw + next-draw-date data every other live formula already receives, so that there's no special-casing of Group J's data source.
6. As a dashboard user, I want both Group J legs to carry a visible ทดลอง badge wherever they appear (group dropdown, backtest table row, live prediction tab), so that I can tell at a glance these haven't passed — or in pool6's case, can never pass — the Promotion Gate.
7. As a dashboard user, I want the ทดลอง badge to propagate onto any Pick (สรุปงวดนี้ Hero/Confidence board) whose supporting formula evidence includes a ทดลอง formula, so that a high-confidence-looking Pick doesn't silently hide that part of its support is unproven.
8. As a dashboard user, I want the ทดลอง badge to propagate onto any เลขแนะนำ chip whose agreeing groups include Group J, so that cross-group convergence involving an unproven formula is labeled the same way Picks are.
9. As the formula maintainer, I want the pool6 leg's candidate output to be genuinely distinct from จักรพรรดิ's (I1) and จักรพรรดิทองคำ's (I2) output for the same previous draw — not a relabeled duplicate — so that a เลขแนะนำ "agreement" between Group I and Group J isn't actually the same underlying signal counted twice, which would silently defeat the whole point of เลขแนะนำ's "distinct top-level groups" requirement.
10. As the formula maintainer, I want the bottom2 leg's fixed formula to skip generating output only when its required previous-draw fields (`back3_2`) or target date are missing — no fallback substitution — so that a missing-data draw doesn't silently produce a misleading candidate.
11. As the formula maintainer, I want the pool6 leg to skip generating any output when the previous draw has no prize 1–5 pool data, matching the existing skip behavior จักรพรรดิ/จักรพรรดิทองคำ already use for the same 321/777-draw Sanook-coverage gap.
12. As the formula maintainer, I want draw-history documentation (`CLAUDE.md`, `DEVELOPMENT_PLAN.md`) updated to list Group J alongside A–I, including its ทดลอง status and the reason (failed gate for bottom2, ungateable by design for pool6), so that project docs don't go stale the way they did after FABLE's removal.
13. As the formula maintainer, I want `scripts/proto_group_j_bottom2_search.py` and `scripts/NOTES-group-j-bottom2-search.md` deleted once this PRD's numeric result (finalist formula + train/validation/holdout Edges) is captured here, so that the repo doesn't carry throwaway search code once its answer has been folded into a permanent artifact — consistent with `handoff-group-j-results.md`'s cleanup step.

## Implementation Decisions

**bottom2 leg:**
- New fixed-arithmetic block in `static/formula-engine.js`, following the existing D1–D4 block structure (`_claudeFormulas` pattern) rather than a new standalone function shape.
- Formula: `pad2(Math.abs(BK2 - DSUM))` where `BK2 = parseInt(back3_2 of previous draw)` and `DSUM = nextDay + nextMonth + nextYear2` — reuse the exact `DSUM` computation already present in `_claudeFormulas` (do not recompute it a second way).
- Field type for backtest/live: `bottom2` (existing field type, no new baseline math needed — `base:(k)=>({baseP:k, baseLabel:` ``${k}/100`` `})`).
- Result pushed into the shared formula-results array with a name prefixed for a new `_GRP['J'] = ['J · เจ้าสัว', <new color, distinct from existing group colors>]` entry, same pattern as `_GRP['I']`.
- No search harness, no live re-derivation logic ships — this is a single fixed formula, exactly like every other Group A–H sub-formula.

**pool6 leg:**
- New function in `formula-engine.js` that calls `_buildPrize1to5Pool` and `_digitPosFreq` directly (reuse, not duplicate — same convention `_imperialGoldFormula` already follows for reusing `_imperialFormula`'s scorer).
- **Differentiation from Group I (resolves user story 9, confirmed by owner):** rather than a bare re-port of จักรพรรดิ's unblended ranking (which would produce numerically identical candidates to I1 for the same previous draw — an accidental duplicate, not a new formula), blend the frequency ranking with the Group J bottom2 arithmetic signal (`|BK2 − DSUM|`, the same atom this PRD's bottom2 leg already computes) using the same 80/20 frequency/arithmetic blend structure จักรพรรดิทองคำ (I2) already established — but keyed to Group J's own arithmetic atom rather than reusing Group D's, so Group J's pool6 leg is recognizably "the J formula" and not a copy of I2 either. This goes beyond the literal handoff note (which only said "port... nothing new to derive"), but the owner confirmed the `|BK2 − DSUM|` blend directly — settled, not open.
- Field type: `pool6` (existing field type, existing baseline math — no changes).
- Result pushed into the shared results array under the same `_GRP['J']` entry as the bottom2 leg.
- Same previous-draw-only data dependency as every other live formula — no separate data-fetch path.

**ทดลอง badge (display-only, per `CONTEXT.md`):**
- A `trust: 'ทดลอง' | null` (or equivalent) field added to formula-result entries, set for both Group J legs (and left unset/null for every existing A–I formula — no retroactive change to their trust status).
- A small badge/pill rendered next to the group label wherever formula-group results are shown: group dropdown, backtest table rows, live "ทำนาย" tab candidate cards.
- Propagation onto Picks: wherever a Pick's supporting-formula list is assembled (the `sources`/`topEdge` aggregation already used by `dcEdgeBadge`), if any contributing formula carries `trust: 'ทดลอง'`, the Pick's rendered chip also shows the ทดลอง badge.
- Propagation onto เลขแนะนำ: wherever `dcRecommendedNumbers`/`dcRecoTopOverall` assemble the agreeing-groups list for a candidate number, if Group J is among the agreeing groups, the เลขแนะนำ chip also shows the ทดลอง badge.
- Per ADR-0003 decision #6 and the CONTEXT.md glossary entry: this badge is strictly cosmetic — it must not exclude Group J, or anything it supports, from any existing ranking, scoring, or participation logic. No new gating branch should be introduced anywhere in the Pick-scoring or เลขแนะนำ-ranking code paths.

**Documentation:**
- `CLAUDE.md` Formula Groups section: add a Group J entry alongside A–I, noting both legs' ทดลอง status and the one-line reason for each (bottom2: failed holdout gate; pool6: ungateable by design per ADR-0003).
- `DEVELOPMENT_PLAN.md`: record Group J's shipped status and link back to ADR-0003 and `scripts/NOTES-group-j-bottom2-search.md`'s numeric result (before that file is deleted per cleanup below).
- `CHANGELOG.md`: standard entry per existing project convention.

**Cleanup:**
- Delete `scripts/proto_group_j_bottom2_search.py` and `scripts/NOTES-group-j-bottom2-search.md` once this PRD (and the CHANGELOG/DEVELOPMENT_PLAN updates above) have captured the finalist formula and its train/validation/holdout Edge numbers — those documents become the permanent record, per the prototype skill's throwaway convention already applied to `handoff-group-j-results.md`'s own instructions.

## Testing Decisions

- Good tests here check external behavior (candidate output for a fixture input, badge presence in rendered output, backtest Edge numbers) — not internal call structure, following this project's established convention (no assertions on *how* a function reuses another, only on *what* it produces).
- New fixed-fixture test for the bottom2 leg: given a synthetic previous-draw row + target date, assert `pad2(|BK2 − DSUM|)` matches a hand-computed expected value. Follows the same synthetic-fixture pattern as `scripts/test_codexpool_coeffs.js`.
- New fixed-fixture test confirming the pool6 leg's candidates differ from both จักรพรรดิ's (I1) and จักรพรรดิทองคำ's (I2) candidates for the same synthetic previous-draw pool fixture — same pattern as the existing Imperial-diversity fixture test, and directly enforces user story 9's non-duplication requirement.
- New test confirming both legs skip output correctly: bottom2 leg on a fixture missing `back3_2`, pool6 leg on a fixture with an empty prize 1–5 pool — following the same skip-behavior test already written for จักรพรรดิ/จักรพรรดิทองคำ (ISSUE-6/7).
- New test confirming the ทดลอง badge renders for Group J entries and does not render for any A–I entry, using a fixture formula-results array with a mix of trusted and ทดลอง entries.
- New test confirming badge propagation: a fixture Pick/เลขแนะนำ candidate whose only supporting formula is a ทดลอง one shows the badge; a fixture candidate with only non-ทดลอง support does not; a fixture candidate with mixed support shows it (propagation is "any," not "all").
- Regression check: confirm the ทดลอง field addition to formula-result objects doesn't change any existing Edge/ranking/score number for A–I formulas — a pure additive field, following the same before/after comparison discipline used for the `fable6`→`pool6` rename regression test.
- Manual browser verification (per this project's established workflow): live "ทำนาย" tab shows both Group J candidates with a visible ทดลอง badge; backtest table shows two new "J · เจ้าสัว" rows with distinct Edge numbers (bottom2 leg should show a small negative-to-flat Edge, consistent with the holdout result — this is expected and correct, not a bug); a Pick or เลขแนะนำ chip supported partly by Group J visibly carries the badge.
- Prior art: `scripts/test_fable_rolling_windows.py`-style synthetic-fixture scripts, `scripts/test_reco_producer_groups.js` (runs the real engine in a vm — same approach should be used for the badge-propagation tests since they touch `dcRecommendedNumbers`/Pick-assembly code), `scripts/test_decision_track_record.js`.

## Out of Scope

- Re-running or widening the Group J bottom2 search family — the holdout is spent per ADR-0003; any future re-derivation needs a new, later holdout tail once more draws accumulate.
- A promotion path for the pool6 leg — it is permanently ทดลอง per ADR-0003, not pending a future gate.
- Retroactively adding a ทดลอง (or "แนะนำ/passed") badge to any existing A–I formula — none of them have been run through this gate process, and this PRD does not change their displayed trust status.
- Any change to the Promotion Gate mechanism itself, Groups A–I, or the existing เลขแนะนำ convergence-ranking rule (group count → combined Edge → num asc) — untouched, Group J simply becomes eligible to participate in that existing rule like any other group.
- Any new backend Python module or API endpoint — both legs are client-side JavaScript, matching every formula group since Group D.
- A "Lab" UI, dedicated experimental-formulas page, or any UI surface beyond the badge described above — ทดลอง is a label on existing surfaces, not a new page.

## Further Notes

- Recommended execution: Sonnet 5, medium effort. The formula work itself is a well-specified porting job (per `handoff-group-j-results.md`) — the numeric derivation is already done and closed. The one piece requiring care is the ทดลอง badge propagation, since it's a new mechanism (never built before) touching Pick-assembly and เลขแนะนำ-assembly code that must remain purely additive per ADR-0003's "badge never gates participation" rule.
- Hard rules from `DEVELOPMENT_PLAN.md` continue to apply unchanged: no backtest-distorting logic, no "เลขวิ่ง" (running-number) additions, lottery numbers stay strings, `CHANGELOG.md` updated after this lands.
- This PRD intentionally bundles the ทดลอง badge mechanism with Group J's two legs (rather than as a separate PRD) because Group J is the first formula that actually needs the badge live — building the mechanism in isolation with no real consumer would risk designing it wrong.
- The pool6-leg differentiation decision (blending with `|BK2 − DSUM|` instead of a bare port) extrapolates beyond what `handoff-group-j-results.md` explicitly specified, but the owner confirmed it directly — ready for `/to-issues` with no open decisions remaining.
