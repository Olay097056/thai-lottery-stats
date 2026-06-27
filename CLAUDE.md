# CLAUDE.md — Thai Lottery Intelligence Dashboard

## Project Overview

A Thai lottery statistics and prediction dashboard.
- **Backend**: FastAPI (`main.py`, port 8509)
- **Frontend**: Single-page HTML (`static/index.html`, ~1200 lines)
- **Prediction engine**: `analyzer.py` (~1864 lines)
- **ML layer**: `ml_predictor.py` (GradientBoosting, ~309 lines)
- **Data**: `scraper.py` scrapes/caches draw history; cache in `lottery_cache.csv`

## Running the App

```bash
uvicorn main:app --port 8509 --reload
```

Open `http://localhost:8509` in a browser.

## Key Files

| File | Purpose |
|------|---------|
| `main.py` | FastAPI app, 30+ endpoints, data loading via `get_df()` |
| `analyzer.py` | All statistical/prediction functions |
| `ml_predictor.py` | GBM training/prediction, model cache in `.ml_cache/` |
| `scraper.py` | `load_data()`, `incremental_update()`, `get_cache_info()` |
| `watchlist.py` | JSON-backed watchlist CRUD |
| `static/index.html` | Full SPA — 15 pages, Chart.js charts, no build step |

## Lottery Types (`col` parameter)

| Value | Description |
|-------|-------------|
| `prize1` | รางวัลที่ 1 (6 digits) |
| `top3` | 3 ตัวบน |
| `top2` | 2 ตัวบน |
| `front3_1`, `front3_2` | 3 ตัวหน้า |
| `back3_1`, `back3_2` | 3 ตัวล่าง |
| `bottom2` | 2 ตัวล่าง |

## API Endpoints

All endpoints are under `/api/`. Notable ones:

| Endpoint | Description |
|----------|-------------|
| `GET /api/summary` | Latest draw, total counts, recent 15 draws |
| `GET /api/predict-with-reasons?col=&top_n=&date=` | Statistical predictions with Thai reason text |
| `GET /api/ensemble?col=&top_n=&date=` | Statistical + ML blended predictions |
| `GET /api/predict/prize1?algorithm=&...` | Prize1 6-digit prediction (v2/v3/v4/beam) |
| `GET /api/hot-cold?col=&months=` | Hot/cold number analysis |
| `GET /api/overdue?col=&top_n=` | Overdue numbers with geometric probability |
| `GET /api/trend?col=&number=` | Year-by-year frequency for a number |
| `GET /api/digit-freq?col=` | Per-position digit (0–9) frequency |
| `GET /api/pairs?col=` | Pair co-occurrence analysis |
| `GET /api/network?cola=&colb=` | Number co-occurrence network graph |
| `GET /api/decade?col=` | Decade comparison (3 eras) |
| `GET /api/heatmap?col=` | Day-of-month heatmap |
| `GET /api/history?n=` | Raw draw history (last N draws) |
| `GET /api/confidence?col=&date=` | Sample-size confidence estimate |
| `GET /api/ml-predict?col=&date=` | GBM predictions |
| `POST /api/ml-train?col=` | Train/retrain GBM model |
| `GET /api/watchlist?col=` | Watchlist status |
| `POST /api/watchlist` | Add number to watchlist |
| `DELETE /api/watchlist?col=&number=` | Remove from watchlist |
| `GET /api/ticket-analysis?col=&number=` | Full ticket stats |
| `GET /api/backtest?col=` | Prize1 backtest (last 20 draws) |

## Prediction Architecture

### Statistical (`predict_numbers` → `predict_with_reasons`)
Composite score from 9 signals with coordinate-descent optimized weights:
- `p1` (0.09) — same day+month joint frequency
- `p2` (0.18) — same day-of-month
- `p3` (0.09) — same month
- `p4` (0.08) — same weekday
- `p5` (0.20) — recency-weighted overall frequency (3-tier year bands)
- `yoy` (0.16) — year-over-year consistency
- `dp_norm` (0.10) — digit-position joint probability
- `geo` (0.06) — geometric overdue probability
- `mom_norm` (0.04) — 3-month vs 12-month momentum
- `lag_factor` — up to 35% penalty if number appeared last draw

### Prize1 Beam Search (`_beam_front3_v4`)
- Decomposes 6-digit prize1 into front3 × back3
- 3 CONFIGS with varying (pos_w, pair_w, trig_w) weights
- Per-position score normalization: pos=0 divides by w0, pos=1 by w0+w1, pos=2 by sum of all three — prevents position bias
- Results merged via harmonic mean ranking

### ML (`ml_predictor.py`)
- GradientBoostingClassifier, one model per lottery type
- Features: month, weekday, overdue_draws, momentum_3m, lag_1_appeared
- Models cached as `.pkl` in `.ml_cache/`; invalidated when data hash changes

### Ensemble (`ensemble_predict`)
- Blends statistical rank score (45%) with ML probability (55%)
- Deduplicates via set union before blending

## Frontend Architecture (`static/index.html`)

Single HTML file with inline CSS + JS, no build step required.

Key globals:
- `LOTTERY_TYPES` — mapping of Thai label → col value
- `ALL_OPTS / NO_P1_OPTS / TWO_DIGIT_OPTS` — pre-built `<option>` HTML for selects
- `api(path)` — global fetch wrapper with in-flight spinner (ref-counted)
- `mkChart(id, cfg)` — Chart.js wrapper with auto-destroy on re-render
- `currentPage` — tracks active page; `onPageLoad(p)` fires data loads on nav

Pages (15 total): dashboard, frequency, hotcold, heatmap, overdue, predict, history, pairs, decade, watchlist, ml, network, backtest, digit, trend

## Data Flow

```
scraper.py  →  lottery_cache.csv  →  get_df() (main.py)
                                        │
                    ┌───────────────────┤
                    ▼                   ▼
              analyzer.py         ml_predictor.py
                    │                   │
                    └──────┬────────────┘
                           ▼
                    FastAPI endpoints
                           │
                           ▼
                  static/index.html (SPA)
```

## Development Notes

- Data is loaded once per process via `get_df()` with a module-level cache; call `POST /api/refresh` or `POST /api/ml-train` to reload
- `watchlist.json` is the persistence file for the watchlist (auto-created)
- `.ml_cache/` stores trained GBM models; safe to delete to force retraining
- `lottery_cache.csv` is the raw data cache; safe to delete and re-scrape
