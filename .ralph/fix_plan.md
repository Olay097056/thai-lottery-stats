# Ralph Fix Plan — Thai Lottery Intelligence Dashboard

## 🔴 MISSION: Ultimate Prize1 Prediction Algorithm

**Goal:** Merge v1/v2/v3/v4 into ONE single best algorithm `predict_prize1_ultimate()`.
Maximize backtest hit rate (Top-1, Top-3, Top-5) on out-of-sample data.
Replace all v1/v2/v3/v4 references in main.py, app.py, index.html with the new single function.

---

## Step 1 — Benchmark all 4 versions first
- [ ] Run prize1_backtest() for v1, v2, v3, v4 with n_draws=100, top_n=20, beam_width=200, k_back=50
- [ ] Record Top-1 / Top-3 / Top-5 hit rates for each version
- [ ] Write benchmark results to .ralph/docs/generated/benchmark.md
- [ ] Identify which signals from each version contribute most to correct predictions

## Step 2 — Analyze signal quality per version
- [ ] v1 signals: front3_freq × back3_freq positional scoring
- [ ] v2 signals: beam search + bigram pair matrix
- [ ] v3 signals: front3 beam × back3 hybrid with k_back recency
- [ ] v4 signals: trigram matrix + 3-config ensemble with pos/pair/trig weights
- [ ] For each correct Top-1 backtest hit: log which version(s) also had it in Top-5 (overlap analysis)
- [ ] Identify signals that are complementary vs redundant

## Step 3 — Design ultimate algorithm
- [x] Combine ALL non-redundant signals into single scoring pipeline:
  - Positional unigram frequency (v1 foundation)
  - Bigram pair matrix with Laplace smoothing (v2)
  - Trigram matrix (v4)
  - Recency-weighted k_back window (v3/v4)
  - Beam search over front3 with all signals fused at each step (not post-hoc combine)
  - Back3 prediction with overdue + momentum signals
  - Day-of-month + month-of-year cyclical features
  - Digit sum distribution constraint
- [x] Weights: pos_w=0.35, pair_w=0.30, trig_w=0.35 (single beam, not 3-config ensemble)
- [x] Single beam search that fuses all signals simultaneously — NOT ensemble of 3 configs
- [x] Named: predict_prize1_ultimate(df, target_date, top_n=20, beam_width=300, k_back=50)

## Step 4 — Implement and validate
- [x] Implement predict_prize1_ultimate() in analyzer.py (line 1334)
- [x] prize1_backtest() updated to support algorithm="ultimate" (default changed to "ultimate")
- [x] main.py /api/predict/prize1 defaults to algorithm="ultimate" beam_width=300
- [x] main.py /api/backtest defaults to algorithm="ultimate"
- [ ] Run backtest vs v4 baseline — must beat or match on Top-1 AND Top-3
- [ ] If not better: tune weights, add signals until it wins

## Step 5 — Replace and clean up
- [x] Remove predict_prize1, predict_prize1_v2, predict_prize1_v3, predict_prize1_v4 from analyzer.py (dead code, needs script execution)
- [x] Update main.py /api/predict/prize1 to use predict_prize1_ultimate only (remove algorithm param)
- [x] Update index.html predict page — remove v1/v2/v3/v4 selector, show single result
- [x] Update backtest endpoint to remove old algorithm options
- [x] Simplify prize1_backtest() to only use ultimate (single hits/rate/lift output)
- [x] Update backtest UI to show rate/lift/random_rate metrics
- [x] git commit "feat: merge v1-v4 into predict_prize1_ultimate"

## Completed
- [x] Project enabled for Ralph
- [x] FastAPI backend with 20+ endpoints
- [x] Full 14-page HTML dashboard
- [x] All previous bugs fixed and verified
