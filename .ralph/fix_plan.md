# Ralph Fix Plan — Thai Lottery Intelligence Dashboard

## 🔴 CRITICAL — Prediction Engine Bugs (สำคัญที่สุด)
- [x] BUG: predict_prize1_v4 ensemble CONFIGS weights — VERIFIED OK: pos_w=max(1-pair_w-trig_w,0.05) ensures all 3 configs sum to exactly 1.0
- [x] BUG: _beam_front3_v4 pos=0 scoring inconsistency — normalized per-position score by dividing by sum of weights active at each position (w0=pos_w, w1=pos_w+pair_w, w2=all three)
- [x] BUG: predict_prize1_v2 beam search — VERIFIED OK: _p1_pair_matrix initializes mat with alpha=0.3, divides by np.maximum(row_sums,1e-12); no ZeroDivisionError possible
- [x] BUG: predict_numbers (general) — VERIFIED OK: no hardcoded 0.95; uses 3-tier year-band recency (5yr×3/5-15yr×2/older×1); k_back is only in prize1_v3/v4
- [x] BUG: prediction_confidence() — score sometimes returns >1.0 due to unnormalized signal aggregation, clamp to [0,1]; also fixed field name mismatch (pct/label → score/level/reason) to match HTML frontend
- [x] BUG: ensemble_predict — VERIFIED OK: uses set(stat_norm)|set(ml_norm) which is already deduped by dict key uniqueness
- [x] BUG: overdue_with_prob — VERIFIED OK: already has min(...,99.9) at score calculation line
- [x] BUG: prize1_backtest — VERIFIED OK: df_sorted.reset_index(drop=True) is called on line 1352 before iloc[:idx]
- [x] BUG: ML predict_ml — VERIFIED OK: overdue is recomputed fresh in predict_ml using current len(df_sorted), not cached; training uses per-draw index i correctly
- [x] BUG: consecutive_pattern — frontend now shows Thai informative message when query_num not found instead of empty table

## High Priority
- [x] Add .gitignore entries for __pycache__, .ml_cache, lottery_cache.csv, watchlist.json, *.pkl
- [x] Fix heatmap page: hm-col select now uses TWO_DIGIT_OPTS (top2, bottom2 only) via new const in index.html
- [x] Fix predict page: reference draws filter — VERIFIED OK: code correctly splits YYYY-MM-DD and compares with DD/MM/YYYY history dates
- [x] Add loading spinner to all API calls in index.html — global #api-spinner with in-flight counter, shows on first api() call and hides when all complete
- [x] Fix network canvas sizing on page load — drawNetwork now defers via requestAnimationFrame if offsetWidth=0; network page added to onPageLoad for auto-load on navigation
- [x] Prediction UI: show which signals drove the top recommendation — VERIFIED OK: เหตุผล column already rendered per row via predict_with_reasons()
- [x] Prediction UI: add "ความเชื่อมั่นรวม" progress bar per candidate — counts 6 signals (day+month≥1, day≥5, month≥8, overdue≥20, total≥25, momentum>0) with color-coded bar
- [x] Prize1 predict: validate front3+back3 — VERIFIED OK: len(cand)!=6 guard at line 1291 plus try/except for non-numeric chars already in place

## Medium Priority
- [x] Add trend page: ค้นหาแนวโน้มรายปีของเลขที่สนใจ — nav item + page-trend HTML + loadTrend() with bar chart and year table, color-coded (green≥3, gold≥1, grey=0)
- [x] Add digit-freq page: วิเคราะห์หลักสำหรับทุกประเภท — added as second section on page-digit; df-col selector + loadDigitFreq() bar chart + table with deviation from 10% expected; auto-loads on digit page nav
- [ ] Watchlist: show history of last 10 draws per number
- [x] ML page: add col selector change → re-check status automatically (onchange="checkMLStatus()" on ml-col select)
- [x] Decade chart: fix era label for current year dynamically — loadDecade() now sets #dec-era3-r and #dec-era3-f th text to `2015–${ey}`

## Low Priority
- [ ] Add CLAUDE.md with project architecture overview
- [x] Add .gitignore for *.pyc and *.pkl files
- [ ] Sidebar: show current draw date from /api/summary

## Completed
- [x] Project enabled for Ralph
- [x] FastAPI backend (main.py port 8509) with 20+ endpoints
- [x] Full 14-page HTML dashboard matching all Streamlit tabs
- [x] Watchlist CRUD, ML prediction, network graph, backtest
