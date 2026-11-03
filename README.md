*English · [ภาษาไทย](README.th.md)*

# Thai Lottery Stats Dashboard

### ▶ [Run the backtest in your browser](https://olay097056.github.io/thai-lottery-stats/demo/)

Loads `static/formula-engine.js` — the real engine, not a rewrite — and scores
every formula against historical draw data. Switch the window between 50 and 400
draws and watch which formulas keep their edge. Most do not.

---

A statistics and decision-support dashboard for Thai government lottery draws — built to answer one question honestly: **do any of these "lucky number formulas" actually beat random chance?**

The short answer the app arrives at is *mostly no*, and that is the point. Rather than shipping a prediction tool that flatters the user, this project puts every formula through a backtest against historical draw data and reports its **Edge** — accuracy *minus the random baseline for that bet type*. Formulas that can't clear that bar keep a permanent **ทดลอง (Experimental)** badge instead of quietly disappearing.

## What it does

- **Scrapes and caches Thai lottery history** from two sources (myhora.com for the main prizes, news.sanook.com JSON-LD for prizes 2–5), giving a full prize table rather than just the headline number.
- **Statistical prediction engine** — a composite score over 9 signals (same day+month frequency, day-of-month, month, weekday, recency-weighted frequency, year-over-year consistency, digit-position joint probability, geometric overdue probability, momentum, minus a lag penalty).
- **Beam search for the 6-digit first prize** — decomposes the number into front-3 × back-3, scores each half under 3 weight configurations, and merges the rankings by harmonic mean.
- **11 formula groups (A–J, HM)** — a mix of traditional Thai folk formulas transcribed into code and formulas discovered by systematic search over a declared arithmetic family.
- **Backtest engine with baseline-adjusted scoring** — every formula is checked against the exact prize slot it claims to target (`bottom2`, `top3`, `back3`, `pool6`, `pool14_tail3`, …), because comparing a 2-digit guess to a 6-digit guess on raw hit rate is meaningless.
- **Buy Plan page** — turns picks into an actual spending plan with a real-money ledger and honest expected value. The headline EV is the pure mathematical one (−5% per baht on per-number bets, ≈ −40% per lottery ticket); a backtest-adjusted secondary figure renders a noise warning whenever it drifts non-negative.
- **Track record** — every session auto-snapshots its picks, so the dashboard's own historical hit rate is charted over time and cannot be quietly forgotten.
- **HyperUI light/dark theme** — the UI is governed by the HyperUI design system (light-first, flat): a single 🌙/☀️ toggle in the sidebar flips the whole app between HyperUI light (gold brand primary) and a HyperUI-gray dark. Preference persists in `localStorage['lottery_theme']` (shared with the demo).

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
| `data_status.py` | Read-only cache health and report provenance |
| `static/scripts.json` | Ordered frontend modules; classic scripts with no build step |
| `static/app.js` / `app.css` | SPA navigation and HyperUI light/dark theme; page scripts listed in `static/scripts.json` |
| `docs/adr/` | Architecture decision records |

## A disclaimer worth stating plainly

Lottery draws are random. Nothing in this repository predicts them, and the backtests are here precisely to demonstrate that. This is a data-analysis and statistical-rigor project that happens to use lottery data as its subject — treat any number it produces as entertainment, not advice.


## Reading and keeping reports

Every page shares a read-only data status panel showing the latest cached draw,
coverage by prize category, and the time the cache was checked. Expand the method
guide on Predict to choose statistical prediction, formulas, Astra, Sigma,
Decision Center, or Mix. Select the target draw before calculating.

New browser snapshots keep independent copies with generation time and available
method/settings/input provenance. Recalculating a draw preserves earlier saved
reports; the Decision Center keeps its first report for each target. Old snapshots
are readable and labelled when provenance is missing. Use **Export browser reports**
to keep a JSON backup before clearing browser storage. This exports browser records,
not Astra's backend SQLite reports. API failures display errors rather than treating
failed calculations as successful empty results.

Frontend infrastructure now lives in `static/shared/`: one API client, response
queries, separate source-data/UI state surfaces, charts and saved reports. Public
module contracts retain the no-build runtime. See
[`ADR-0006`](docs/adr/0006-frontend-state-and-public-contracts.md) for ownership rules.

### Prospective first-prize experiment

The prediction page now registers five distinct six-digit candidates per method before a future draw. Compare exact prize1 outcomes against a matched uniform baseline, plus normalized Astra v1 log loss. Astra/Sigma component ablations, formula/Mix lists and JSON export are explicit actions. Records live in ignored `astra_runtime/first_prize.sqlite3`; historical holdouts are not re-evaluated. Fano v4 adapts pair-covering to the six ordered Thai digit positions: historical weights cover all 15 position pairs, then deterministic variable-neighborhood search refines all five candidates together with single-digit, multi-digit and whole-number moves. Fano v1's incidence codebook, v2's greedy portfolio, and v3's coordinate-ascent portfolio remain separately visible for future comparisons. The paper's UK Lotto 6/59 construction is not used as a Thai-lottery guarantee. See [ADR 0007](docs/adr/0007-prospective-first-prize.md).

Backtest theme refinement: themed sort controls, gold navigation states, readable status tokens, collapsible diagnostics, board-local summaries and target jump links. Statistical calculations are unchanged.

Astra v1/Sigma prospective records are now visible in both formula Backtest and sidebar Backtest, separately from historical evaluations. Opening these views reads the registry only; registration stays an explicit action on the prediction page.

Frontend audit fixes: failed/partial Decision requests do not create snapshots; date provenance is normalized before comparison; hardcoded Dashboard lift removed. Theme-aware buttons/charts, readable mobile navigation, advanced settings and labeled disclosure controls are in place. Historical saved reports are preserved with legacy metadata caveats. See [verification](docs/design/frontend-audit-fixes-2026-10-14.md).
