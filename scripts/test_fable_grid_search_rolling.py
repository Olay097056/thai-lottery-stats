"""Regression check for FABLE grid-search top-5 rolling comparison (ISSUE-2).

Verifies:
1. The top-5 entries (by holdout score) carry a `rolling` key with w50/w100/w200
   sub-objects containing numeric tail2_edge/tail3_edge fields.
2. Entries outside the top 5 do not have rolling-window data computed.
3. Top-5 selection is driven by holdout score, not the `stable` flag (works even
   when every config's `stable` value is false).
4. Rolling numbers computed inside grid search match what fable_backtest(gate=True)
   produces for that same config on the same data (no drift between the two paths).
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from scraper import load_data
from fable_formula import fable_grid_search, fable_backtest, TOP_N_ROLLING_COMPARE

df = load_data()

r = fable_grid_search(df, n_draws=160, holdout_draws=50, max_configs=12)
assert "error" not in r, r
results = r["results"]
assert len(results) >= TOP_N_ROLLING_COMPARE, "need enough configs to test top-N selection"

with_rolling = [row for row in results if "rolling" in row]
without_rolling = [row for row in results if "rolling" not in row]

# 1. exactly top-N (by holdout score) have rolling data
by_holdout = sorted(results, key=lambda x: x["holdout"]["score"], reverse=True)
expected_top_names = {row["name"] for row in by_holdout[:TOP_N_ROLLING_COMPARE]}
actual_rolling_names = {row["name"] for row in with_rolling}
assert actual_rolling_names == expected_top_names, (actual_rolling_names, expected_top_names)
assert len(with_rolling) == TOP_N_ROLLING_COMPARE, len(with_rolling)

for row in with_rolling:
    for w in ("w50", "w100", "w200"):
        assert w in row["rolling"], f"{row['name']} missing {w}"
        assert isinstance(row["rolling"][w]["tail2_edge"], (int, float)) or row["rolling"][w]["tail2_edge"] is None
        assert isinstance(row["rolling"][w]["tail3_edge"], (int, float)) or row["rolling"][w]["tail3_edge"] is None

# 2. entries outside top-5 have no rolling data
for row in without_rolling:
    assert "rolling" not in row

# 3. selection driven by holdout score even if `stable` is false for everyone
# (already true in step 1: selection didn't reference `stable` at all — sanity-check directly)
all_unstable = all(not row["stable"] for row in results)
print(f"all configs stable=false in this run: {all_unstable} (selection uses holdout score regardless)")
assert len(with_rolling) == TOP_N_ROLLING_COMPARE  # still populated either way

# 4. rolling numbers match fable_backtest(gate=True) for the same config (no drift)
sample = with_rolling[0]
cfg = sample["config"]
gate_result = fable_backtest(df, n_draws=200, window=cfg["window"], weights=cfg["weights"], gate=True)
assert "error" not in gate_result, gate_result
for w_key, w_label in (("w50", "W50"), ("w100", "W100"), ("w200", "W200")):
    assert sample["rolling"][w_key]["tail2_edge"] == gate_result["rolling"][w_label]["tail2"]["edge"], \
        f"{w_key} tail2_edge drift: grid={sample['rolling'][w_key]['tail2_edge']} vs gate={gate_result['rolling'][w_label]['tail2']['edge']}"
    assert sample["rolling"][w_key]["tail3_edge"] == gate_result["rolling"][w_label]["tail3"]["edge"], \
        f"{w_key} tail3_edge drift: grid={sample['rolling'][w_key]['tail3_edge']} vs gate={gate_result['rolling'][w_label]['tail3']['edge']}"

print(f"configs_tested={r['configs_tested']}, top-{TOP_N_ROLLING_COMPARE} with rolling: {sorted(actual_rolling_names)}")
print("OK: top-5-by-holdout rolling comparison wired correctly, no drift vs fable_backtest(gate=True)")
