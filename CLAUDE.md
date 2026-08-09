# CLAUDE.md — Thai Lottery Intelligence Dashboard

## Project Overview

A Thai lottery statistics and prediction dashboard, macOS-dark-themed, desktop-first.
- **Backend**: FastAPI (`main.py`, port 8509)
- **Frontend**: Single-page HTML (`static/index.html`) + `static/formula-engine.js`
- **Prediction engine**: `analyzer.py` (statistical)
- **ML layer**: `ml_predictor.py` — endpoints kept as reference, not shown in UI
- **Data**: `scraper.py` (myhora.com, prize1/top3/top2/front3/back3/bottom2) + `sanook_scraper.py` (near1/prize2/prize3/prize4/prize5), cached in `lottery_cache.csv`

See [DEVELOPMENT_PLAN.md](DEVELOPMENT_PLAN.md) for current phase status and [CHANGELOG.md](CHANGELOG.md) for implementation history.

## Running the App

```bash
pip install -r requirements.txt
uvicorn main:app --port 8509 --reload
```

Open `http://localhost:8509`. On Windows, prefer the venv at `%LOCALAPPDATA%\lottery_stats_runtime\.venv\Scripts\python.exe` (has pandas/fastapi/sklearn installed) — plain `uvicorn` on PATH may resolve to a Python without dependencies. `.claude/launch.json` is configured to use this venv with `--app-dir lottery_stats --reload`.

## Key Files

| File | Purpose |
|------|---------|
| `main.py` | FastAPI app, endpoints, data loading via `get_df()` |
| `analyzer.py` | Statistical prediction functions (predict_numbers, hot_cold, beam search, etc.) |
| `ml_predictor.py` | GBM training/prediction — endpoints kept, not exposed in current UI |
| `scraper.py` | `load_data()`, `incremental_update()`, `get_cache_info()`, myhora.com scraping |
| `sanook_scraper.py` | Scrapes near1/prize2/prize3/prize4/prize5 from news.sanook.com JSON-LD |
| `enrich_from_sanook.py` | One-off backfill script for historical Sanook data |
| `watchlist.py` | JSON-backed watchlist CRUD — endpoints kept, not exposed in current UI |
| `static/index.html` | SPA shell markup only — 5 pages; styles and script now split out (no build step) |
| `static/app.css` | All CSS — macOS dark palette, layout, component styles |
| `static/app.js` | Core JS — init, api(), showPage/switchPredTab, loadXxx page loaders, Chart.js wiring. Loaded after `formula-engine.js` (its `init()` call at the bottom relies on formula-engine being defined first) |
| `static/formula-engine.js` | Formula calculators (A–H groups), backtest engine |

Dev/debug/one-off scripts (not imported by production code) live in `scripts/`: `debug.py`, `sweep.py`, `_rebuild_analyzer.py`, `test_scrape.py`, `test_multi_year.py`, `scrape_all.py`. Run them from the project root, e.g. `python scripts/debug.py` — they add the project root to `sys.path` themselves.

## Pages (7, sidebar order)

Dashboard · ตารางความถี่ · ทำนาย-สูตร (tabs: ทำนาย / สูตรคำนวณ / สรุปงวดนี้ / OLD VER) · ไม่รู้ซื้ออะไรดี (Mix) · **จัดชุดซื้อ (Buy Plan)** · ผลย้อนหลัง · Backtest

Watchlist and ML Prediction pages were removed from the UI (2026-07-02, desktop-first cleanup) — backend endpoints remain for reference but nothing in the frontend calls them.

## จัดชุดซื้อ (Buy Plan) page — `page-buyplan`, `loadBuyPlan` in `app.js`

Turns Picks/เลขแนะนำ into an actual spending plan with honest EV and a real-money ledger (ISSUE-17→20, governing **ADR-0004** `docs/adr/0004-buy-plan-tab-dual-ev-and-honest-pnl.md`; glossary จัดชุดซื้อ/ชุดซื้อ/EV คู่/แก้เอง in CONTEXT.md). Client-side only — reuses the fetches the Decision Center already performs (formula batch, เลขแนะนำ, prize-1 predictions, prize history), no new backend endpoints. Two modes behind a toggle:

- **แทงรายเลข (per-number betting)** — budget + risk preset (เซฟ 80/20, กลาง 50/50, ใจถึง 20/80 split between 2-digit `bottom2`/`prize1_last2` and 3-digit `back3` money); allocates proportional to Pick score with a ×1.5 เลขแนะนำ boost, min/round/cap/drop/remainder so stakes sum exactly to budget.
- **ลอตเตอรี่ใบ (online tickets)** — budget → whole tickets at the configured price; ranked 6-digit list merged from I/J2 `pool6` + prize-1 beam predictions + **Mix (a labeled source, never a formula group)**, each with a เต็ม6 → ท้าย3 → ท้าย2 fallback ladder.

**Two pure seams** (unit-tested in `scripts/test_buyplan_*.js`, vm-extracted, fixture-driven — no DOM/network):
- `bpBuildPlan(input) → plan` — all allocation logic (both modes) behind one function.
- `bpResolvePlan(plan, actualDrawRow) → resolution` — per-row baht outcome (stake × the payout **frozen in the plan**), per-plan net; ticket rows resolve against the full government prize table (`bpResolveTicket`), flagging sanook-missing draws `unverifiable` rather than missed. `bpLedger` aggregates saved plans (mode-aware random-play expectation: −5%/baht vs −40%/ticket).

**EV คู่** — theoretical headline always leads (pure baselines: −5%/baht per-number at ×95/×950, ~−40%/ticket from the govt table); a backtest-adjusted secondary line renders a noise warning whenever it goes non-negative (ADR-0004).

**localStorage keys (own, isolated from all DC/Mix snapshot stores):** `lottery_buyplan_history` (saved plans — manual save only, immutable, delete-whole-plan), `lottery_buyplan_config` (payouts/min/round/ticket price, copied by value into each saved plan), `lottery_buyplan_prefs` (last-used mode/budget/risk). The Mix page links in via a "จัดชุดซื้อจากเลขชุดนี้ →" button (`bpFromMix`, opens ใบ mode).

**Explainability layer** (`PRD-buy-plan-explainability.md`): each plan row is now self-explaining — inline formula-group dots + a plain-Thai strength word (หนุนแรง/กลาง/เบา, derived from the number's best supporting backtest Edge) + a ⭐ on เลขแนะนำ rows, plus an expandable "ทำไมได้เลขนี้ / ทำไมเงินเท่านี้" detail row (reasons come from `dcBuildScoreRows`; the money trace — score → share → ×1.5 → rounding → baht — comes from `bpAllocateTier`). ลอตเตอรี่ใบ rows show an agreement count + the fallback ladder in the same expand. Display-only: no scoring/allocation/EV/ledger logic change.

## Lottery Columns (`col` parameter)

| Value | Description | Source |
|-------|-------------|--------|
| `prize1` | รางวัลที่ 1 (6 digits) | myhora |
| `top3` / `top2` | 3/2 ตัวบน (derived from prize1) | myhora |
| `front3_1`, `front3_2` | 3 ตัวหน้า | myhora |
| `back3_1`, `back3_2` | 3 ตัวล่าง | myhora |
| `bottom2` | 2 ตัวล่าง | myhora |
| `near1_1`, `near1_2` | ข้างเคียงรางวัลที่ 1 | sanook |
| `prize2_1..5` | รางวัลที่ 2 (5 ใบ) | sanook |
| `prize3_1..10` | รางวัลที่ 3 (10 ใบ) | sanook |
| `prize4`, `prize5` | รางวัลที่ 4 (50 ใบ) / 5 (100 ใบ) — **string เดียวคั่น space**, not split into columns | sanook |

Sanook columns only populated for ~456/777 draws (data available back to ~2549). All lottery number values are strings — never parse as int (loses leading zeros).

## Formula Groups (`static/formula-engine.js`)

A (กูชอบ) · B (ลอตโตพลัส) · C (พิชิตโชค) · D (Claude) · F (Codex, rolling stats) · G (แม่นขั้นเทพ) · H (มิสเตอร์ซี) · E (สายมู) — all use only the previous single draw as input.

**I (จักรพรรดิ)** — also uses only the previous single draw, but targets the combined prize 1–5 pool (near1 + prize2 + prize3 + prize4 + prize5, ~168 numbers) instead of prize1 alone: counts digit frequency per position across that pool, takes the top-2 digit per position, and combines them into ~10 six-digit candidates (`_buildPrize1to5Pool` + `_digitPosFreq` + `_imperialFormula` in `formula-engine.js`). Hit-checked against `pool6` in the backtest table. Ships as a regular (non-experimental) formula from day one — no promotion gate, unlike FABLE.

FABLE (a rolling-history, prize-1–5-pool formula) was retired 2026-07-06 after failing its promotion gate — see DEVELOPMENT_PLAN.md and CHANGELOG.md for history. The `pool6`/`pool_tail3` backtest field types it introduced (hit = candidate matches anything in the previous draw's combined prize 1–5 pool) were kept and are now used by Group I above.

**J (เจ้าสัว)** — 2026-07-08. Both legs ship under a **ทดลอง** (Experimental) badge — see `docs/adr/0003-group-j-promotion-gate-and-experimental-participation.md`. ทดลอง is display-only: it never gates participation in Picks or เลขแนะนำ, it just labels trust honestly, and it propagates onto any Pick/เลขแนะนำ chip a ทดลอง formula supports.
**Mix (ไม่รู้ซื้อเหี้ยไรดี)** — 2026-07-08. Derived meta-formula, **not** a formula group (see CONTEXT.md): builds ~10 six-digit candidates by per-position digit voting over all A–J group outputs (one group = one vote per position; positions 1–3 from `front3` outputs only with I/J2 fallback; positions 4–6 from all tail-mappable fields + I/J2). `_mixCompute`/`_computeMixRow` in `formula-engine.js` — deliberately OUTSIDE `_computeFormulasBatch` so it can never leak into Picks/เลขแนะนำ (it would double-count its parent formulas); only the formula backtest and the ไม่รู้ซื้ออะไรดี sidebar page (`loadMixPage` in `app.js`, track record in localStorage `lottery_mix_snapshots`) call it. Backtest row under `pool6`, no ทดลอง badge (its own page communicates the trust level instead).

**HM (Hermes Pool 1-4)** — 2026-08-08, `PRD-hermes-pool-1-4.md`. A named formula (like Mix, not a letter group — but DOES live inside `_computeFormulasBatch`): predicts 10 six-digit numbers against the target draw's prize 1–4 pool (66 numbers, strictly excluding ข้างเคียง/prize5). `_buildPrize1to4Pool` builds the previous draw's prize 2/3/4 pool (65 numbers) as `[{num, w}]`; `_hermesPool14Formula` counts per-position digit frequency **weighted by prize money 5:2:1** (prize2 ×1.0, prize3 ×0.4, prize4 ×0.2 — fixed design constants, no search per ADR-0003) and assembles 10 candidates via `_imperialRoundRobin` (K=8). **Permanently ทดลอง** per ADR-0003 (J2 precedent: ~457 pool-covered draws × 10 candidates × 66/1e6 ≈ 0.30 expected chance hits — no gate can distinguish skill from luck). Carries an explicit `group:'HM'` field because `dcRecommendedNumbers` resolves group keys as `fr.group || name[0]` — without it, "HM"[0]='H' would pollute `experimentalGroups` and falsely badge มิสเตอร์ซี-supported เลขแนะนำ (see CONTEXT.md). Field type `pool6_14` (board "Pool 1-4", baseline 66/1e6 per candidate) — new board per กติกาคงที่ #1, plus a dedicated "Board Pool 1-4" comparison table (`_renderPool14Comparison` in formula-engine.js, rendered by `_renderBtTable` in app.js) that re-scores I1/I2/J2/Mix/Hermes against the same 66-number hit-set. Shows on tab สูตรคำนวณ (own panel `formula-results-HM` + dropdown entry + explainable card `_hermesCards` with 4 Thai steps), ทำนาย batch cards, and backtest. Verified 2026-08-08: 2 real pool-1-4 hits in 457 draws (both prize 4 — 685863 @ 01/02/2024, 086093 @ 30/12/2021) vs 0.30 expected → edge +0.37%; n=2 is far too small to conclude anything, ทดลอง label stays.

- **J1 (bottom2 leg)** — `pad2(|BK2 − DSUM|)`, where `BK2` is the previous draw's `back3_2` and `DSUM` reuses Group D's `_dsumValue`. This is the finalist from a systematic arithmetic-family search (`_tycoonBottom2Formula` in `formula-engine.js`) — it **failed its holdout gate** (train Edge +0.72%, validation +1.67%, holdout −0.21%), so per ADR-0003 it ships anyway under ทดลอง rather than being deleted.
- **J2 (pool6 leg)** — `_tycoonPool6Formula`, reuses Group I's `_buildPrize1to5Pool`/`_digitPosFreq`/`_imperialRoundRobin` directly, blended 80% frequency / 20% closeness to J1's own `|BK2 − DSUM|` atom (not Group D's, so it doesn't collapse to Group I's exact candidates). **Permanently ทดลอง** per ADR-0003 — at ~456 pool-covered draws, 10 candidates expect under 1 chance-hit across the whole history, so no gate could ever distinguish skill from luck on this field type.

## API Endpoints

Notable ones under `/api/`:

| Endpoint | Description |
|----------|-------------|
| `GET /api/summary` | Latest draw, totals, recent 15 draws |
| `GET /api/predict-with-reasons?col=&top_n=&date=` | Statistical predictions with Thai reason text |
| `GET /api/predict/prize1?top_n=&beam_width=&k_back=&date=` | Prize1 6-digit prediction (beam search) |
| `GET /api/hot-cold`, `/api/overdue`, `/api/trend`, `/api/digit-freq`, `/api/pairs`, `/api/decade`, `/api/heatmap` | Statistical analysis endpoints |
| `GET /api/history?n=` | Raw draw history |
| `GET /api/prize-history?n=` | History including near1/prize2/prize3/prize4/prize5 |
| `GET /api/prize-freq?prize=` | Frequency table for prize2/3/4/5 |
| `GET /api/backtest?n_draws=&top_n=&beam_width=&k_back=` | Prize1 backtest |

## Prediction Architecture

### Statistical (`predict_numbers` → `predict_with_reasons`)
Composite score from 9 signals: same day+month freq, same day-of-month, same month, same weekday, recency-weighted overall frequency, year-over-year consistency, digit-position joint probability, geometric overdue probability, momentum, minus a lag penalty if the number appeared last draw.

### Prize1 Beam Search (`_beam_front3_v4`)
Decomposes 6-digit prize1 into front3 × back3, 3 weight configs, per-position score normalization, merged via harmonic mean ranking.

## Data Flow

```
scraper.py (myhora) ──┐
                       ├──► lottery_cache.csv ──► get_df() (main.py)
sanook_scraper.py ─────┘                              │
                                    ┌──────────────────┴──────────────────┐
                                    ▼                                     ▼
                              analyzer.py                    ml_predictor.py (unused in UI)
                                    │
                                    ▼
                            FastAPI endpoints ──► static/index.html (SPA)
```

## Development Notes

- Data loaded once per process via `get_df()` module-level cache; call `POST /api/refresh` to reload
- `lottery_cache.csv` is safe to delete and re-scrape
- `.ml_cache/` and `watchlist.json` still created but unused by current UI
- API endpoints validate `col` against known lottery columns; number inputs must match digit width for that column
- Styling: `:root` CSS variables in `static/app.css` define the macOS dark palette (`--bg`, `--surface`, `--gold` for prize numbers, `--accent` = system blue). Skin rules live in a dedicated block near the end of the file — keep new component styles consistent with that palette rather than the original gold-heavy theme.
- `static/app.js`, `static/formula-engine.js`, and `static/app.css` are all loaded with a `?v=...` cache-busting query string in `index.html` — bump it whenever you change any of the three, or the browser will keep serving the old cached file even after a plain reload (confirmed for JS via `typeof someNewFunction` staying `undefined` in-browser while `curl` shows the new file on disk; confirmed for CSS via `getComputedStyle` showing pre-edit values while `document.styleSheets` was missing the new rule entirely, even though a fresh in-page `fetch(url,{cache:'no-store'})` returned the correct content).
