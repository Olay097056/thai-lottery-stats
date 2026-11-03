# CLAUDE.md — Thai Lottery Intelligence Dashboard

## Project Overview

A Thai lottery statistics and prediction dashboard, HyperUI light-first with a dark theme and responsive desktop/mobile layouts.
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

Open `http://localhost:8509`. On Windows, prefer the venv at `%LOCALAPPDATA%\lottery_stats_runtime\.venv\Scripts\python.exe` (has pandas/fastapi/sklearn installed) — plain `uvicorn` on PATH may resolve to a Python without dependencies. `.claude/launch.json` selects this venv and runs `uvicorn main:app --port 8509 --reload` from the project root.

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
| `static/index.html` | SPA shell markup only — 7 pages; styles and script now split out (no build step) |
| `static/app.css` | HyperUI light/dark theme tokens, responsive layout, and component styles |
| `static/app.js` | Core navigation, API and shared date state. Page modules load in `static/scripts.json` order; `app-boot.js` calls `init()` after all scripts load. |
| `static/report-core.js` | Shared cache health, method selection, report provenance and browser report export |
| `data_status.py` | Read-only cache structure/category health and statistical report provenance; no refresh or scoring |
| `static/formula-engine.js` | Formula state, shared inputs and UI; A–J and HM calculations in `formula-calculators.js`, Mix/batch/evaluation in `formula-evaluation.js` |

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

**HM2 · Hermes ท้าย3 ใต้ดิน / HM3 · Hermes ท้าย3 ทางการ** — 2026-08-11, `PRD-hm2-hermes-tail3.md`. Two ท้าย3 (3-digit tail) siblings of HM sharing `group:'HM'` (same badge/color — no `_GRP`/`BP_GROUP_MAP` change). **HM2** targets the last-3-digits of the prize 1–4 pool (66 numbers → ~64 distinct tails/1000): `_hermesTail3Formula` counts weighted digit freq (5:2:1) over TAIL positions 3–5 of the previous draw's pool 1-4 and assembles 10 3-digit candidates via `_imperialRoundRobin` (K=8); field `pool14_tail3` (board "Pool 1-4", baseline 1−(1−0.0639)^k ≈ 48.3%/draw at k=10) — underground-style target, name carries "ใต้ดิน" per owner request. **HM3** targets the official เลขท้าย 3 ตัว (`back3_1`/`back3_2`, 4,000฿ each): `_hermesOfficialTail3Formula` mirrors HM2 over FRONT positions 0–2. The live formula batch retains legacy field `back3`, but Formula/Decision Backtest normalizes HM3 to exact-match `back3exact`; its chance baseline includes both official results (about 1.99% for 10 distinct picks). Mixed C3 results are split into exact-three and suffix-two rows; legacy `back3` has no comparable baseline and must not be used for Edge. The official tail-3 is an independent uniform draw, so HM3 is **ungateable by construction** (expected 9/457 hits; measured 9/457 = 0.99× chance — exactly as physics dictates). Both **permanently ทดลอง** (ADR-0003). Math note: HM2 candidates 0–7 equal HM's candidate tails (lap=0 round-robin + shared tail rankings — structural, documented in PRD); candidates 8–9 are new. Real results (457 draws): HM2 203 hits vs 220.9 expected (0.92×, edge −3.9pts ≈ −1.7σ — within noise), HM3 9 hits vs 9.1 expected (0.99×) — weakens the "HM signal is real" case (its 6.6× was likely luck).

**Luna v1 · สมมติฐาน** — experimental six-digit first-prize hypothesis (`PRD-luna-v1-hypothesis.md`). Server calculates five candidates from all accessible valid prior draws using an add-one-smoothed final-digit count and five uniformly sampled distinct prefixes. Excluded from combined Picks. The ordinary formula Backtest gets Luna forecasts from `/api/luna/backtest` and scores only exact prize1 matches against `5/1,000,000` per-draw baseline. This historical row is exploratory, not an independent holdout or a promotion signal; the hypothesis was informed by historical frequency exploration. Keep the 20-draw minimum and never tune weights against the retrospective results.

**ระนาบฟาโน v4 · Variable Neighborhood Cover** — isolated exact-six-digit first-prize formula (`PRD-fano-plane-hypothesis.md`). Server counts historical patterns for all 15 pairs of ordered digit positions and applies alpha=0.5 smoothing, then jointly searches five candidates with seeded simulated annealing over 1–3 digit and whole-number moves, followed by coordinate-ascent polish; keep pairwise Hamming distance ≥3. It uses every valid prior prize-1 draw strictly before the target, stays out of combined Picks, and appears in walk-forward Backtest and the future-only K=5 registry. Its incumbent is a self-seed built inside v4 — greedy weighted pair-cover with fingerprint tie-breaks, polished by coordinate ascent (ADR-0008); v1-v3, their builders and their version constants are deleted, and pre-ADR records keep `optimizer_base_version: fano-v3-joint-weighted-cover` for interpretation. The pair-cover lineage is Fano-inspired, but this is not a literal Fano-plane construction; the paper's UK 6/59 two-ball covering guarantee does not apply to Thai exact prize 1. Backtest baseline remains `5/1,000,000`; keep the 20-draw minimum and never tune on reserved holdouts.

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
| `GET /api/luna/formula?date=` / `GET /api/luna/backtest?targets=` | Read-only Luna forecast / batched historical forecasts using all valid prior draws |
| `GET /api/fano/formula?date=` / `GET /api/fano/backtest?targets=` | Read-only Fano hypothesis / batched historical forecasts using all valid prior draws |
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
- Styling: `static/app.css` uses HyperUI light-first tokens and a dark override. Gold is the single primary (`--gold`, `--accent`); use theme variables for UI colors. Keep formula-group colors semantic. See `docs/design/hyperui-v2-tokens.md`.
- All local frontend scripts and `app.css` use one shared `?v=...` cache-busting version in `index.html`. `static/scripts.json` records script order; update HTML and manifest together when adding a module. Bump every local asset URL whenever any frontend file changes, or the browser will keep serving the old cached file even after a plain reload (confirmed for JS via `typeof someNewFunction` staying `undefined` in-browser while `curl` shows the new file on disk; confirmed for CSS via `getComputedStyle` showing pre-edit values while `document.styleSheets` was missing the new rule entirely, even though a fresh in-page `fetch(url,{cache:'no-store'})` returned the correct content).


## Frontend modules and reports

Classic scripts share the existing global scope; there is no build step or runtime loader.
The browser loads the three formula modules, then `report-core.js`, navigation,
Astra, shell/init definitions, Decision Center, legacy Decision Center, dashboard,
Predict, Mix support, Buy Plan, Mix view, history/charts, and finally boot.
`app-boot.js` must remain last. Tests use `scripts/frontend_source.js` to read
these exact ordered sources. Run `node scripts/test_cache_bust_sync.js` after
changing module order or asset versions.

`GET /api/data-status` reads the existing CSV only and returns dates, category
coverage, rejected chronology rows, cache SHA-256 and a Bangkok check timestamp.
It does not call `get_df`, refresh or any predictor. The status is last-read,
not continuous monitoring. A 35-day stale marker is a data-age warning.

Predict reports capture the actual eligible dataframe fingerprint, input cutoff,
settings, generation time and analyzer source fingerprint. These fingerprints
have a different scope from the raw-cache fingerprint in data status.
Manual formula reports record their actual input fields; unavailable provenance
stays explicitly unavailable. Generic browser snapshots append independent
records rather than replace earlier reports. Decision Center preserves the first
saved report per target date for its existing prospective track record. Older
records remain readable with an explicit missing-provenance label. Storage quota
failures report failure; export browser reports before clearing browser storage.
Astra's immutable backend snapshots remain separate from browser exports.

Legacy whole-endpoint calculation failures return HTTP 500 with `error_code`,
`error`, `retryable`, `ok:false` and the existing empty fallback fields. Partial
Predict failures retain per-category errors and set `report_status:partial`.
The frontend normalizes HTTP, validation and network failures; an empty successful
list is still distinct from an error. Server details are logged, not sent to users.


## Frontend architecture ownership — ADR-0006

Use `static/shared/api-client.js` for all GET/POST transport. `LotteryQueries`
records immutable responses; `LotteryServerData` holds feature-owned source/derived
views. `LotteryUiState` owns feature controls and client drafts. Only a feature's
own controllers may write its store/view. Astra keeps its UI state inside its
closed module; use public selectors/actions instead of private variables.

Charts and browser reports live in `static/shared/`. Decision Center domain
helpers are exposed by `static/modules/decision-center/index.js`. Fixed public
facades and compatibility handler aliases preserve the classic-script runtime.
Do not add loose UI globals or raw fetch calls in a page. Run
`node scripts/test_frontend_architecture.js` when changing frontend boundaries.
See `docs/adr/0006-frontend-state-and-public-contracts.md` and `static/shared/README.md`.

## Prospective first-prize protocol — ADR 0007

`first_prize.py` / `static/first-prize-ui.js` implement explicit future-only registration, five distinct six-digit candidates, first record retained. Registry is separate from existing Astra/browser snapshots. Do not evaluate old holdouts or auto-register on navigation. All methods remain experimental; client records are unverified. See `docs/adr/0007-prospective-first-prize.md`.

## Frontend audit guards

Use LotteryReports.canonicalReportDate/latestEligibleDate before comparing mixed API dates. Current and legacy Decision controllers reject failed/partial required inputs before auto-save and use their feature-owned loadRequestId. Do not rewrite existing snapshots to repair old metadata. LotteryCharts.syncTheme updates canvas palettes on theme switches; mark themed datasets with themeColor/themeFill. Use native buttons/links for interactive elements, one page-level `h1` with nested section headings, theme-token focus indicators, and `min-width: 0` or a labeled scroll region for wide content. Verification: `docs/design/frontend-audit-fixes-2026-10-14.md` and `docs/design/frontend-ui-engineering-2026-10-14.md`.
