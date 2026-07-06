# PRD: Retire FABLE, add จักรพรรดิ / จักรพรรดิทองคำ formulas

## Problem Statement

As the person maintaining the prediction formulas, I've invested significant work in FABLE (a rolling-history, pool-based experimental formula covering prizes 1-5) through a full promotion-gate process, but its latest results still fail every gate criterion — rolling edge, validation, and live windows are all negative or below threshold. Rather than keep tuning a formula whose approach (rolling multi-draw pool) hasn't shown a real edge, I want to abandon it entirely and try a different approach: a formula that only looks at the single previous draw (like every other formula group in this dashboard) but still targets the same broad goal — a 6-digit guess with a chance of matching any of prizes 1-5, not just prize 1.

## Solution

Delete FABLE completely (backend module, API endpoints, dedicated Lab UI, snapshot/grid-search/holdout-report machinery) — it does not carry over as an archived or experimental formula. In its place, add two new formulas under a new group letter "I" (จักรพรรดิ, Imperial theme):

1. **จักรพรรดิ** — ranks each of the 6 digit positions by frequency across the ~168 numbers in the previous draw's combined prize 1-5 pool (near1, prize2-5), picks the top-2 digit per position, and combines them (capped at the project's usual ~10-result convention) into full 6-digit candidates.
2. **จักรพรรดิทองคำ** — the same digit-position frequency scoring, blended 80/20 with an arithmetic signal already used by Group D (`prize1 + day×month×year of the next draw date`, mod 1,000,000), so the two formulas produce genuinely different rankings rather than near-duplicates.

Both formulas are client-side JavaScript (matching every other formula group's architecture — no new Python backend, no new API endpoints), evaluated only against draws that have prize 1-5 pool data available (same ~456/777-draw limitation FABLE had), and shown as regular (non-experimental) formulas in the backtest table and prediction tab from day one — no promotion-gate gatekeeping for these two, per explicit product decision.

## User Stories

1. As the formula maintainer, I want all FABLE code, endpoints, and UI removed from the codebase, so that the project isn't carrying dead experimental code that never passed its own gate.
2. As the formula maintainer, I want FABLE's promotion-gate references removed from DEVELOPMENT_PLAN.md and CLAUDE.md, so that project docs don't point at a formula that no longer exists.
3. As a dashboard user, I want a new formula group "จักรพรรดิ" (I) that predicts 6-digit numbers based only on the previous draw's combined prize 1-5 pool, so that I get a prediction grounded in that draw's actual digit distribution rather than pure numerology.
4. As a dashboard user, I want a second formula "จักรพรรดิทองคำ" that blends the same digit-frequency signal with an arithmetic signal from the next draw's date, so that I have a second, genuinely different variant to compare in the backtest table.
5. As the formula maintainer, I want both formulas to reuse the digit-position-frequency logic (not duplicate it twice), with จักรพรรดิทองคำ layering the arithmetic blend on top, so that the two formulas share one source of truth for the frequency signal.
6. As the formula maintainer, I want each formula to generate its digit-position rankings from the top-2 highest-frequency digit per position, combined into roughly 10 six-digit candidates (consistent with the ~6-10 result size every other formula group already uses), so that backtest fairness (baseline denominator per candidate count) stays consistent with the rest of the system.
7. As the formula maintainer, I want a "hit" for either formula to count if any of its candidate 6-digit numbers matches any number in that draw's combined prize 1-5 pool (not just prize 1 exactly), so that this matches the original ask ("chance of hitting prize 1, 2, 3, 4, or 5").
8. As the formula maintainer, I want the existing pool-match backtest field type (previously named for FABLE's `fable6`/`fable_pool3`) renamed to a FABLE-neutral name (e.g. `pool6`/`pool_tail3`), so that this generic mechanism doesn't carry a misleading name once FABLE itself is gone.
9. As the formula maintainer, I want draws without prize 1-5 pool data (the ~321/777 draws before Sanook coverage began) to be skipped entirely for these two formulas — both in live prediction and in backtest — so that missing data doesn't get silently treated as a zero/empty pool and distort results.
10. As a dashboard user, I want จักรพรรดิ and จักรพรรดิทองคำ to appear as regular formulas (no "ทดลอง"/experimental badge, no promotion gate) in the group dropdown and backtest table immediately, so that I can use and compare them like any of groups A-H from day one.
11. As the formula maintainer, I want the "ทำนาย" (live prediction) tab to show both formulas' current candidates using the same previous-draw data all other live formulas use, so that there's no special-casing of these two formulas' data source.
12. As the formula maintainer, I want the backtest table to show จักรพรรดิ and จักรพรรดิทองคำ as separate named rows grouped under the "I · จักรพรรดิ" badge, so that their edge is directly comparable to A-H in the same table, same as every other group.

## Implementation Decisions

**FABLE removal:**
- Delete `fable_formula.py` entirely.
- Remove all `/api/fable*` endpoints from `main.py` (`/api/fable`, `/api/fable-backtest`, `/api/fable-grid-search`, `/api/fable-holdout-report`).
- Remove all FABLE-specific functions, UI rendering, and state from `static/formula-engine.js` (config controls, Lab status panel, rolling-edge panel, promotion-gate panel, grid-search/holdout-report tables, snapshot save/load/export, target-date prediction rendering) and the corresponding markup block in `static/index.html` (the "FABLE" tab button and its associated container divs).
- Remove FABLE references from `CLAUDE.md` (Formula Groups section, key-files table entry for `fable_formula.py`) and `DEVELOPMENT_PLAN.md` (Phase 4 section, promotion-gate rules, "สถานะปัจจุบัน" table row) — replace with a note that FABLE was retired in favor of Group I.
- The generic pool-vs-prize1-5-match backtest mechanism (previously field types `fable6`/`fable_pool3`, and the `fablePool`/`fablePoolT3` sets built once per backtest draw in `runFormulaBacktest`) is **not** deleted — it's renamed to `pool6`/`pool_tail3` (or equivalent neutral names) and kept, since Group I's formulas depend on it. Rename the field-type entries in `_formulaBtFieldMeta`, the corresponding branches in `_formulaHitForField`, and the `pools.fablePool`/`pools.fablePoolT3` variable names in the backtest loop to match.

**Group I formulas (จักรพรรดิ / จักรพรรดิทองคำ):**
- New client-side JS functions in `static/formula-engine.js`, following the existing pattern used by Group D (`_claudeFormulas`) and Group F/Codex (`_codexFormulas`/`_codexPool`) — no new backend module, no new API endpoint.
- Shared core: a digit-position frequency scorer that takes the previous draw's combined prize 1-5 pool (reusing the same pool-building logic already used for `pool6`/`pool_tail3` hit checks — `_draw_pool`-equivalent already exists in `fable_formula.py`'s Python form but must be re-derived as a JS function since this pool building currently only exists server-side for FABLE's own predict endpoint; the *backtest-side* pool set construction already exists client-side in `runFormulaBacktest`, so the new formulas' live-prediction path needs an equivalent JS pool builder over the previous draw's near1/prize2/prize3/prize4/prize5 fields), counts digit occurrences per position (1-6) across that pool, and ranks digits per position by frequency.
- จักรพรรดิ: takes the top-2 highest-frequency digit per position, combines across all 6 positions (bounded cartesian expansion), ranks combinations by summed position-frequency score, returns roughly 10 top candidates.
- จักรพรรดิทองคำ: same digit-position frequency scoring, but each candidate's score is blended 80% frequency-score / 20% closeness to the arithmetic value `(prize1 of previous draw + day×month×year of the next draw date) mod 1,000,000` (reusing Group D's existing arithmetic building block), then re-ranked and truncated to ~10 candidates the same way.
- Both formulas skip generating any output when the previous draw has no prize 1-5 pool data (empty near1/prize2-5 fields) — same skip behavior as the rest of the backtest's Sanook-data-dependent formulas.
- Both formulas' results are pushed into the same `results` array inside `_computeFormulasBatch` (or its equivalent) using names starting with a new prefix that maps to a new `_GRP['I'] = ['I · จักรพรรดิ', <color>]` entry — analogous to how `X` prefix currently maps to `F · Codex`.
- Both formulas also feed the live "ทำนาย" tab prediction rendering, using the same previous-draw data object already passed to every other live formula (no separate data-fetch path).
- No experimental badge, no promotion-gate check, no separate "Lab" UI — these render exactly like groups A-H in both the backtest table and the live prediction tab.

## Testing Decisions

- Regression-verify FABLE removal doesn't break anything else: confirm `main.py` still imports cleanly, confirm the app still starts, confirm no other formula group references any now-deleted FABLE function/endpoint.
- Regression test for the `fable6`→`pool6` (and `fable_pool3`→`pool_tail3`) rename: verify backtest hit-counting behavior for formulas using this field type is unchanged before/after the rename (a pure rename should produce identical backtest numbers) — follow the same before/after comparison approach already used in this session's FABLE-rolling-window and Group F coefficient tests (fixed-fixture golden-value checks, not live-cache-dependent assertions).
- New test for the shared digit-position frequency scorer: given a fixed synthetic previous-draw pool (not the live cache), assert the ranked-digit-per-position output matches a known expected result — following the same synthetic-fixture pattern used for the FABLE rolling-window golden-value test in this session.
- New test confirming จักรพรรดิ and จักรพรรดิทองคำ produce genuinely different candidate rankings for the same fixture (proving the 80/20 blend actually changes ranking, not just cosmetically) — same pattern as the Group F coefficient-preset distinctness test from this session.
- New test confirming both formulas produce no output (or are skipped) for a fixture previous-draw with empty prize 1-5 pool fields.
- Manual browser verification (per this project's established workflow): run the live "ทำนาย" tab and confirm both formulas render candidates; run the backtest table and confirm both appear as separate rows with the "I · จักรพรรดิ" badge and distinct edge numbers; confirm the FABLE tab/button no longer exists anywhere in the UI.
- Prior art: `scripts/test_fable_rolling_windows.py`, `scripts/test_codexpool_coeffs.js`, and `scripts/test_codexpool_presets.js` (all written earlier in this session) are the direct prior-art pattern for these new tests — same project convention (no pytest/test framework installed; standalone scripts under `scripts/` using fixed synthetic fixtures and plain assertions).

## Out of Scope

- Any change to groups A-H, or to the Group F coefficient presets (X10-X13) added earlier this session — untouched.
- Reviving or archiving FABLE in any form (no "keep the code but hide the UI" option) — full deletion per the explicit decision to discard it entirely.
- A promotion gate, experimental badge, or "Lab" UI for จักรพรรดิ/จักรพรรดิทองคำ — explicitly rejected; they ship as regular formulas immediately.
- Any new API endpoint or backend Python module for the new formulas — client-side only.
- Handling draws before Sanook coverage began (~321/777 draws) for these two formulas — they simply produce no output for those draws, same limitation FABLE had and did not solve.
- Any change to the `/api/ml-*` (ML predictor) or `/api/watchlist` endpoints, which are already unused in the current UI per CLAUDE.md.

## Further Notes

- This PRD was scoped as a single combined unit (not split into a "remove FABLE" PRD and a "add Group I" PRD) because the two are cause-and-effect of one product decision — discarding an approach that didn't pass its gate, in favor of a new approach — rather than two independent tracks.
- Recommended execution: Sonnet 5, high effort. Reasoning: the work itself follows an established in-repo pattern (client-side formula group, same shape as Group F's recent coefficient-preset work done in this same session), so it doesn't need a larger model — but it carries real regression risk (FABLE removal touching many call sites across 3 files, plus a field-type rename that must not silently change existing backtest numbers for anything reusing that pool-match logic), which argues for high rather than medium effort.
- Hard rules from DEVELOPMENT_PLAN.md continue to apply unchanged: no backtest-distorting logic, no "เลขวิ่ง" (running-number) additions, lottery numbers stay strings, CHANGELOG.md gets updated after this lands (per existing project convention, followed in this session's two prior commits).
