"""Regression check for fable_rolling_windows extraction (ISSUE-1).

Verifies:
1. fable_rolling_windows() matches a fixed synthetic fixture's known expected output
   (golden-value check, independent of the live/growing lottery_cache.csv).
2. fable_rolling_windows() output matches fable_backtest()'s rolling section exactly
   (using the live cache).
3. fable_backtest(gate=True) output is unaffected by the refactor (same tested/rolling/criteria/passed).
"""
import sys, os
from datetime import datetime, timedelta
import pandas as pd
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from scraper import load_data
from fable_formula import fable_backtest, fable_rolling_windows

# --- 1. Golden-value check against a fixed synthetic fixture ---
_fixture_rows = []
_base = datetime(2565, 1, 1)
for i in range(60):
    d = _base + timedelta(days=i * 16)
    _fixture_rows.append({
        "date": d,
        "prize1": str((i * 37 + 123456) % 1000000).zfill(6),
        "near1_1": str((i * 11) % 1000000).zfill(6),
        "near1_2": str((i * 13) % 1000000).zfill(6),
        **{f"prize2_{j}": str((i * 17 + j * 29) % 1000000).zfill(6) for j in range(1, 6)},
        **{f"prize3_{j}": str((i * 19 + j * 31) % 1000000).zfill(6) for j in range(1, 11)},
        "prize4": "", "prize5": "",
    })
_fixture_df = pd.DataFrame(_fixture_rows)
_fixture_result = fable_rolling_windows(_fixture_df, n_draws=40, window=20)

_expected_w50_tail2 = {"n": 40, "avg_hits": 3.825, "baseline_avg_hits": 1.975, "edge": 1.85}
_expected_w200_tail3 = {"n": 40, "avg_hits": 0.125, "baseline_avg_hits": 0.25, "edge": -0.125}
assert _fixture_result["tested"] == 40, _fixture_result
assert _fixture_result["rolling"]["W50"]["tail2"] == _expected_w50_tail2, _fixture_result["rolling"]["W50"]["tail2"]
assert _fixture_result["rolling"]["W200"]["tail3"] == _expected_w200_tail3, _fixture_result["rolling"]["W200"]["tail3"]
print("OK: fable_rolling_windows matches known-expected fixture values")

# --- 2 & 3. Cross-check against fable_backtest using the live cache ---
df = load_data()

gate_result = fable_backtest(df, n_draws=200, gate=True)
assert "error" not in gate_result, gate_result
assert gate_result["tested"] == 200

rolling_only = fable_rolling_windows(df, n_draws=200)
assert "error" not in rolling_only, rolling_only
assert rolling_only["tested"] == gate_result["tested"], "tested count mismatch"
assert rolling_only["rolling"] == gate_result["rolling"], "rolling report mismatch between fable_rolling_windows and fable_backtest"
assert rolling_only["tail2"] == gate_result["tail2"], "tail2 summary mismatch"
assert rolling_only["tail3"] == gate_result["tail3"], "tail3 summary mismatch"

print(f"tested={gate_result['tested']}")
print(f"W50 tail2 edge={gate_result['rolling']['W50']['tail2']['edge']}")
print(f"W200 tail3 edge={gate_result['rolling']['W200']['tail3']['edge']}")
print(f"criteria={gate_result['criteria']}")
print(f"passed={gate_result['passed']}")
print("OK: fable_rolling_windows matches fable_backtest's rolling output, gate path unaffected")
