# Ralph Fix Plan — Thai Lottery Intelligence Dashboard

## 🔴 CRITICAL — Prediction Engine Bugs (สำคัญที่สุด)
- [ ] BUG: predict_prize1_v4 ensemble CONFIGS weights do not sum to 1.0 — verify and fix normalization in analyzer.py
- [x] BUG: _beam_front3_v4 pos=0 scoring inconsistency — normalized per-position score by dividing by sum of weights active at each position (w0=pos_w, w1=pos_w+pair_w, w2=all three)
- [ ] BUG: predict_prize1_v2 beam search — bigram smoothing alpha not applied when history < 2 draws, causes ZeroDivisionError on cold start
- [ ] BUG: predict_numbers (general) — recency weight decay formula uses hardcoded 0.95 regardless of k_back param, ignoring user config
- [x] BUG: prediction_confidence() — score sometimes returns >1.0 due to unnormalized signal aggregation, clamp to [0,1]; also fixed field name mismatch (pct/label → score/level/reason) to match HTML frontend
- [ ] BUG: ensemble_predict — duplicate เลข entries possible when multiple configs agree, dedup before returning
- [ ] BUG: overdue_with_prob — โอกาสออก(%) can exceed 100% for numbers overdue >200 draws, cap at 99.9
- [ ] BUG: prize1_backtest — df_train slice uses iloc[:idx] without resetting index, causing KeyError on some datasets
- [ ] BUG: ML predict_ml — feature vector built with stale overdue count (computed at train time, not predict time)
- [ ] BUG: consecutive_pattern — when query_num not None but never appeared, returns empty instead of informative message

## High Priority
- [x] Add .gitignore entries for __pycache__, .ml_cache, lottery_cache.csv, watchlist.json, *.pkl
- [ ] Fix heatmap page: hm-col select should include 2-digit types only (top2, bottom2)
- [ ] Fix predict page: reference draws filter by day+month not working when date format is DD/MM/YYYY
- [ ] Add loading spinner to all API calls in index.html
- [ ] Fix network canvas sizing on page load (offsetWidth=0 before visible)
- [ ] Prediction UI: show which signals drove the top recommendation (top 3 reasons per number)
- [ ] Prediction UI: add "ความเชื่อมั่นรวม" progress bar per candidate based on how many signals agree
- [ ] Prize1 predict: validate that front3 + back3 combination actually equals full 6-digit number before showing

## Medium Priority
- [ ] Add trend page: ค้นหาแนวโน้มรายปีของเลขที่สนใจ (/api/trend endpoint already exists)
- [ ] Add digit-freq page: วิเคราะห์หลักสำหรับทุกประเภท (/api/digit-freq endpoint exists)
- [ ] Watchlist: show history of last 10 draws per number
- [ ] ML page: add col selector change → re-check status automatically
- [ ] Decade chart: fix era label for current year dynamically

## Low Priority
- [ ] Add CLAUDE.md with project architecture overview
- [x] Add .gitignore for *.pyc and *.pkl files
- [ ] Sidebar: show current draw date from /api/summary

## Completed
- [x] Project enabled for Ralph
- [x] FastAPI backend (main.py port 8509) with 20+ endpoints
- [x] Full 14-page HTML dashboard matching all Streamlit tabs
- [x] Watchlist CRUD, ML prediction, network graph, backtest
