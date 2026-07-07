# PRD: จักรพรรดิ/จักรพรรดิทองคำ (Group I) — Candidate Diversity Fix

## Problem Statement

As the person using the Backtest page and "ทำนาย" tab, I noticed that จักรพรรดิ (I1) and จักรพรรดิทองคำ (I2) always output a set of ~10 six-digit candidates that look nearly identical to each other — differing by only 1-2 digit positions — while the actual รางวัลที่ 1-5 numbers that come out are spread across the full digit range. This doesn't match what I'd expect from 10 independent guesses at a random draw, and it's a red flag that something about how candidates are picked is structurally narrow rather than a genuine attempt to cover the space of likely outcomes.

Root cause (confirmed against `static/formula-engine.js:1149-1218` during grilling): `_imperialCandidates` builds its candidate pool from only the **top-2 highest-frequency digit per position** (out of 10 possible digits 0-9), then both `_imperialFormula` and `_imperialGoldFormula` rank the resulting combinations by summed score and slice the top N. Because the top-ranked combinations differ from the single highest-scoring one ("argmax") by swapping only one or two positions to the second-best digit, the final candidate set clusters tightly around that one point instead of spanning the space. Separately, since a fair lottery's per-position digit distribution across the ~168-number prize 1-5 pool should be close to uniform (~16.8 occurrences per digit if genuinely random), the "top-2" digits in any single previous draw are largely sampling noise, not a persistent bias — so locking candidates to just those 2 digits per position discards the other 8 digits that are statistically about as likely to appear next draw.

This PRD only addresses the **clustering artifact** in candidate selection. It does not attempt to discover genuine predictive signal in single-draw digit-position frequency, and it does not change how I1/I2 are labeled or gated (see Out of Scope).

## Solution

Widen the raw candidate pool from top-2 to top-3 highest-frequency digit per position (raising the pre-dedupe ceiling from 64 to 729 combinations), and replace the current "sort by score, slice top N" final selection with a shared greedy diverse-selection function that still favors higher-scoring candidates but enforces a minimum pairwise digit-distance between every candidate in the final set — so the ~10 candidates surfaced actually spread across the digit space instead of clustering near a single point. Both จักรพรรดิ (scored by `freqScore`) and จักรพรรดิทองคำ (scored by `blended`) call the same shared selector after computing their own per-candidate scores.

## User Stories

1. As a dashboard user, I want จักรพรรดิ's and จักรพรรดิทองคำ's final candidate sets to visibly span different digits at each position (not near-duplicates of one dominant guess), so that the output looks like a genuine set of independent guesses rather than one guess repeated with minor edits.
2. As the formula maintainer, I want the diversity fix to apply regardless of whether it changes the backtest Edge number, so that removing this artifact isn't gated on proving it improves accuracy — clustering near an arbitrary argmax is a selection-method flaw independent of whether real predictive signal exists.
3. As the formula maintainer, I want the per-position digit cap widened from top-2 to top-3, so that the diverse-selection step has enough raw material to actually spread across — top-2 alone (12 distinct digits total across 6 positions) is too narrow a base regardless of how selection works on top of it.
4. As the formula maintainer, I want a single shared diverse-selection function used by both จักรพรรดิ and จักรพรรดิทองคำ (each passing its own score field), so that the two formulas don't duplicate this logic — matching the existing pattern of sharing `_imperialCandidates` between them.
5. As the formula maintainer, I want the top-scoring candidate always kept as the first pick (never dropped for diversity's sake), so that the formula's strongest single signal is never sacrificed to satisfy a spread constraint.
6. As the formula maintainer, I want the minimum-distance constraint to relax automatically (rather than return fewer than the requested candidate count) when the candidate pool can't satisfy it at the target strictness, so that จักรพรรดิ/จักรพรรดิทองคำ never silently return short of their expected ~10 candidates.
7. As the formula maintainer, I want this change scoped to candidate *selection* only — not to `_digitPosFreq`'s counting logic, not to the `pool6` backtest hit-check, and not to any other formula group — so that this stays a narrow, low-risk fix.
8. As the formula maintainer, I want the resulting Edge (re-run against the existing 455-draw backtest) reported honestly in the CHANGELOG regardless of whether it improves, stays flat, or worsens, so that this documents a real outcome rather than cherry-picked framing — consistent with how every other formula change in this project has been logged.

## Implementation Decisions

- **Widen per-position cap:** in `_imperialCandidates` (`static/formula-engine.js:1165`), change `ranked.map(posRanked=>posRanked.slice(0,2))` to `.slice(0,3)`. This raises the pre-dedupe cartesian ceiling from 64 to 729; `_digitPosFreq`'s counting/ranking logic is untouched.
- **New shared function `_imperialDiverseSelect(candidates, scoreKey, topN, minDist=2)`:**
  - Sort `candidates` by `candidate[scoreKey]` descending, tie-break by `digits` string ascending (matches the existing tie-break convention already used in `_imperialFormula`/`_imperialGoldFormula`).
  - Always admit the top-scoring candidate first.
  - Walk the remaining sorted candidates in order; admit a candidate only if its Hamming distance (count of differing digit positions, comparing `digits` strings) is `>= minDist` from **every** already-admitted candidate.
  - If the walk completes with fewer than `topN` admitted, retry the whole walk with `minDist - 1` (starting over from the top-scoring candidate, not resuming from the partial set), continuing down to `minDist = 0` (which degenerates to today's plain top-N behavior) so the function always returns exactly `topN` candidates whenever at least `topN` distinct candidates exist in the input.
  - Returns the same candidate objects unmodified (just filtered/ordered), so callers keep whatever other fields they attached (e.g. `blended`).
- **Wire into both formulas:** `_imperialFormula` computes `freqScore` as today, then calls `_imperialDiverseSelect(candidates, 'freqScore', topN, 2)` instead of `.sort(...).slice(0,topN)`. `_imperialGoldFormula` computes `blended` as today, then calls `_imperialDiverseSelect(candidates, 'blended', topN, 2)` in place of its own current sort/slice tail. `topN` itself stays at its existing default (10) and existing call sites — this PRD does not change how many candidates are ultimately shown, only how they're chosen.
- **No change** to `_digitPosFreq`, `_buildPrize1to5Pool`, the `pool6`/`pool_tail3` backtest field types, or `_formulaHitForField` — the diversity fix is entirely upstream of hit-checking.
- **No change** to how I1/I2 are labeled (still shipped as regular, non-experimental formulas per Phase 5 — this PRD does not resolve the DEVELOPMENT_PLAN.md hard-rule-3 gating question raised during grilling; that's explicitly deferred, see Out of Scope).

## Testing Decisions

- Extend `scripts/test_decision_track_record.js`'s sibling, `scripts/test_imperial_formula.js` (existing fixture-script pattern, no test framework), with new checks for `_imperialDiverseSelect`:
  - Given a synthetic candidate list with one clear top scorer and several near-duplicates (differing by 1 digit) plus a few genuinely distant candidates, verify the returned set's average pairwise Hamming distance is higher than plain top-N slicing on the same input, and that the top scorer is always included.
  - Verify the `minDist` relaxation fallback: construct a fixture where satisfying `minDist=2` for all `topN` slots is impossible, and confirm the function still returns exactly `topN` candidates (not fewer) by relaxing down.
  - Verify `_imperialFormula` and `_imperialGoldFormula` end-to-end still return `topN` candidates each on realistic pool fixtures, and that the top-2→top-3 per-position widening doesn't break the "จักรพรรดิ (top: ...) and จักรพรรดิทองคำ (top: ...) genuinely disagree" distinctness assertion already in the existing test file.
- Regression run of all existing fixture scripts (`test_imperial_formula.js`, `test_codexpool_coeffs.js`, `test_codexpool_presets.js`, `test_pool_field_rename.js`, `test_decision_track_record.js`) — none should need behavior changes from this PRD's edits, since it's scoped to Group I candidate generation only.
- Re-run the existing Backtest page (or `dcFormulaBacktestRows`-equivalent) against the current 455-draw real dataset after implementing, and record the resulting Edge for both I1 and I2 in `CHANGELOG.md` as-is — whether it improves, stays at the current −0.168%, or worsens. No re-running with cherry-picked parameters to chase a better number; report the first honest result.
- Manual verification (per this project's established workflow): open the "ทำนาย" tab's Group I cards and the Backtest table, confirm the ~10 candidates shown for จักรพรรดิ and จักรพรรดิทองคำ visibly cover more of the digit range per position than before (spot-check a few positions aren't all still 1-2 unique digits), no console errors.

## Out of Scope

- **Retroactive gating/experimental labeling for I1/I2** — raised during grilling (DEVELOPMENT_PLAN.md hard rule 3 requires new formulas to pass backtest before being labeled "แนะนำ", but Group I shipped without a gate per Phase 5). The user explicitly chose to leave this alone this round and focus on the formula itself; the rule conflict remains unresolved and could be its own future PRD.
- **Adding `pool_tail3` or any other secondary backtest metric for I1/I2** — considered and explicitly rejected during grilling as metric-shopping: it was only proposed because `pool6` showed a poor result, which is the tell that it wouldn't be a genuine diagnostic addition. I1/I2 continue to be measured only against `pool6`.
- **Increasing the final `topN` candidate count** (currently 10) — this PRD changes *which* candidates are chosen from the pool, not how many are surfaced.
- **Referencing more than the immediately previous draw** (rolling multi-draw history, wider windows, etc.) — stays consistent with the existing single-previous-draw convention shared by all of Groups A-I; not re-litigating FABLE's rolling-history approach, which already failed its promotion gate and was removed.
- **Any change to Groups A-H**, `_digitPosFreq`'s counting logic, `_buildPrize1to5Pool`, or the `pool6`/`pool_tail3` backtest field type definitions.
- **A validation/live-window split methodology** for accepting this change — discussed during grilling as a possible acceptance gate for a pure Edge-chasing change, but this PRD's fix is justified independent of Edge movement (see User Story 2), so no split-window validation is required before shipping it.

## Further Notes

- Statistical framing agreed during grilling: Thai government lottery draws are designed to be random, so genuine predictive edge from single-draw digit-position frequency should have a true ceiling near 0% regardless of tuning — this PRD is not expected to move Edge meaningfully, and that's an acceptable outcome. Its value is removing an unintended clustering artifact from the candidate-ranking method, independent of accuracy.
- This PRD was filed following this project's established convention of documenting formula changes as `PRD-*.md` before implementation (see `PRD-formula-group-f-tuning.md`, `PRD-replace-fable-with-imperial-formulas.md`) even though the change is scoped to a single session/file.
- Hard rules from `DEVELOPMENT_PLAN.md` continue to apply: no backtest-distorting logic, no "เลขวิ่ง" additions, lottery numbers stay strings, `CHANGELOG.md` gets updated after this lands per existing project convention.
- Recommended execution: Sonnet 5, medium-high effort. Reasoning: the change is narrow (one new shared function, one widened constant, two call-site swaps, all in `static/formula-engine.js`), but the greedy-relaxation algorithm and its fixture tests need care to get right, and a real backtest re-run against 455 draws is required to honestly report the resulting Edge.
