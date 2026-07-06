# ISSUE-5: Remove FABLE + rename pool-match field type

## Parent

PRD-replace-fable-with-imperial-formulas.md

## What to build

Delete FABLE entirely — it never passed its promotion gate and the product decision is to discard the rolling-history approach rather than keep tuning it. Remove `fable_formula.py`, all `/api/fable*` endpoints in `main.py` (`/api/fable`, `/api/fable-backtest`, `/api/fable-grid-search`, `/api/fable-holdout-report`), and all FABLE-specific code, UI panels, and state in `static/formula-engine.js` and `static/index.html` (config controls, Lab status/rolling-edge/promotion-gate panels, grid-search/holdout-report tables, snapshot save/load/export, the FABLE tab button and its containers). Remove FABLE references from `CLAUDE.md` and `DEVELOPMENT_PLAN.md` (Phase 4 section, promotion-gate rules, status table row), replacing with a short note that FABLE was retired.

The one piece that survives: the generic "does this candidate match anything in the combined prize 1-5 pool" backtest mechanism (currently field types `fable6`/`fable_pool3`, and the `fablePool`/`fablePoolT3` sets built per-draw inside the backtest loop). This is not FABLE-specific — it's a reusable pool-match check the next issue's จักรพรรดิ formula depends on. Rename it to `pool6`/`pool_tail3` (and the corresponding internal variable names) so it no longer carries a misleading FABLE-era name, but keep its behavior identical.

## Acceptance criteria

- [ ] `fable_formula.py` is deleted; no file in the repo imports it
- [ ] All `/api/fable*` endpoints are removed from `main.py`; `main.py` still imports and the app still starts cleanly
- [ ] No FABLE-specific function, UI panel, tab, or state remains in `static/formula-engine.js` or `static/index.html`
- [ ] CLAUDE.md and DEVELOPMENT_PLAN.md no longer describe FABLE as active; a short retirement note replaces the Phase 4 section
- [ ] The pool-match field type is renamed to `pool6`/`pool_tail3` end-to-end (field-type metadata, hit-check branches, pool-set variable names) with no remaining `fable6`/`fable_pool3`/`fablePool` naming
- [ ] Backtest hit-counting behavior for any formula using this field type is byte-identical before and after the rename, verified via a fixed-fixture regression test (not dependent on the live/growing lottery_cache.csv)
- [ ] Manual browser check: app loads, no console errors, no FABLE tab/button anywhere in the UI, existing A-H/F backtest table numbers unchanged

## Blocked by

None - can start immediately
