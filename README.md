*English · [ภาษาไทย](README.th.md)*

# Thai Lottery Stats Dashboard

A statistics and decision-support dashboard for Thai government lottery draws — built to answer one question honestly: **do any of these "lucky number formulas" actually beat random chance?**

The short answer the app arrives at is *mostly no*, and that is the point. Rather than shipping a prediction tool that flatters the user, this project puts every formula through a backtest against ~777 real historical draws and reports its **Edge** — accuracy *minus the random baseline for that bet type*. Formulas that can't clear that bar keep a permanent **ทดลอง (Experimental)** badge instead of quietly disappearing.

## What it does

- **Scrapes and caches 777 draws** of Thai lottery history from two sources (myhora.com for the main prizes, news.sanook.com JSON-LD for prizes 2–5), giving a full prize table rather than just the headline number.
- **Statistical prediction engine** — a composite score over 9 signals (same day+month frequency, day-of-month, month, weekday, recency-weighted frequency, year-over-year consistency, digit-position joint probability, geometric overdue probability, momentum, minus a lag penalty).
- **Beam search for the 6-digit first prize** — decomposes the number into front-3 × back-3, scores each half under 3 weight configurations, and merges the rankings by harmonic mean.
- **11 formula groups (A–J, HM)** — a mix of traditional Thai folk formulas transcribed into code and formulas discovered by systematic search over a declared arithmetic family.
- **Backtest engine with baseline-adjusted scoring** — every formula is checked against the exact prize slot it claims to target (`bottom2`, `top3`, `back3`, `pool6`, `pool14_tail3`, …), because comparing a 2-digit guess to a 6-digit guess on raw hit rate is meaningless.
- **Buy Plan page** — turns picks into an actual spending plan with a real-money ledger and honest expected value. The headline EV is the pure mathematical one (−5% per baht on per-number bets, ≈ −40% per lottery ticket); a backtest-adjusted secondary figure renders a noise warning whenever it drifts non-negative.
- **Track record** — every session auto-snapshots its picks, so the dashboard's own historical hit rate is charted over time and cannot be quietly forgotten.

## Why the honesty machinery exists

Backtesting a search space this large invites two classic failure modes, and the codebase is structured around preventing both:

- **Holdout discipline** — the newest tail of history is never touched during formula search. It is evaluated exactly once, to produce the deciding Edge for the Promotion Gate. Once spent, it can't serve as a holdout again.
- **Ungateable by construction** — some formulas target prize slots that are drawn as independent uniform numbers. No amount of history could distinguish skill from luck there, so those are marked permanently experimental rather than being tuned until they look good. One such formula (HM3) measured 9 hits against 9.1 expected — exactly the physics, documented as a success of the method rather than hidden as a failure of the formula.

A formula that failed its holdout gate (J1: +1.67% on validation, **−0.21%** on holdout) ships in the app under its experimental badge with those numbers on display. An earlier formula, FABLE, was retired outright after failing the same gate.

The architectural decisions behind these rules are written up as ADRs in [`docs/adr/`](docs/adr/).

## Tech stack

| Layer | Choice |
|---|---|
| Backend | Python 3.11, FastAPI, pandas |
| Frontend | Vanilla JS SPA (no build step), Chart.js |
| ML | scikit-learn (GBM) — endpoints retained for reference, not surfaced in the UI |
| Scraping | requests + BeautifulSoup, incremental cache in CSV |
| Tests | Node `vm`-extracted pure seams, fixture-driven (`scripts/test_buyplan_*.js`) |

The allocation and settlement logic is deliberately factored into two pure functions — `bpBuildPlan(input) → plan` and `bpResolvePlan(plan, drawResult) → resolution` — so the money math can be unit-tested with no DOM and no network.

## Running it

```bash
pip install -r requirements.txt
uvicorn main:app --port 8509 --reload
```

Then open <http://localhost:8509>. The draw cache (`lottery_cache.csv`) is safe to delete — it re-scrapes on next load.

## Project layout

| File | Purpose |
|---|---|
| `main.py` | FastAPI app and endpoints |
| `analyzer.py` | Statistical prediction (composite scoring, beam search, hot/cold, overdue) |
| `scraper.py` / `sanook_scraper.py` | Data acquisition for the two sources |
| `ml_predictor.py` | GBM training/prediction |
| `static/formula-engine.js` | All formula calculators plus the backtest engine |
| `static/app.js` / `app.css` | SPA logic and the macOS-dark design system |
| `docs/adr/` | Architecture decision records |

## A disclaimer worth stating plainly

Lottery draws are random. Nothing in this repository predicts them, and the backtests are here precisely to demonstrate that. This is a data-analysis and statistical-rigor project that happens to use lottery data as its subject — treat any number it produces as entertainment, not advice.
