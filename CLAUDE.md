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

## Pages (5, sidebar order)

Dashboard · ทำนาย-สูตร (3 tabs: ทำนาย / สูตรคำนวณ / สรุปงวดนี้) · ตารางความถี่ · ผลย้อนหลัง · Backtest

Watchlist and ML Prediction pages were removed from the UI (2026-07-02, desktop-first cleanup) — backend endpoints remain for reference but nothing in the frontend calls them.

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

FABLE (a rolling-history, prize-1–5-pool formula) was retired 2026-07-06 after failing its promotion gate — see DEVELOPMENT_PLAN.md and CHANGELOG.md for history. The `pool6`/`pool_tail3` backtest field types it introduced (hit = candidate matches anything in the previous draw's combined prize 1–5 pool) were kept, since they're reusable by any future formula group targeting prizes 1–5, not FABLE-specific.

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
