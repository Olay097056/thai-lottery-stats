"""Quick parameter sweep for predict_prize1_ultimate."""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from scraper import load_data
from analyzer import prize1_backtest

df = load_data()
print(f"Loaded {len(df)} draws")

BASE = dict(
    beam_width=500, k_back=50,
    _pair_w=0.40, _trig_w=0.20, _hot_w=0.20, _junc_w=0.08,
    _n_recent=25, _hot_blend=0.70,
    _jbg=0.75, _jtg=0.15, _jqg=0.10,
    _back3_hot_w=0.08, _back3_pos_w=0.60,
    _ds_sigma=3.0, _front_w=0.475, _lag_pen=0.55,
    _w_overall=0.35, _w_dm=0.35, _w_day=0.15, _w_yoy=0.15,
    _rec_days=730, _rec_mult=3.0,
)

def run(label, **overrides):
    p = {**BASE, **overrides}
    r = prize1_backtest(df, n_draws=80, top_n=20, **p)
    f = r.get('front3_lift', 0)
    b = r.get('back3_lift', 0)
    print(f"{label:<40} 80={f+b:.3f}(f={f:.3f} b={b:.3f})")
    return f+b

best = run("baseline", )

# --- sweep _pair_w / _trig_w ---
print("\n-- pair_w sweep --")
for pw in [0.30, 0.35, 0.40, 0.45, 0.50]:
    run(f"pair_w={pw}", _pair_w=pw)

print("\n-- trig_w sweep --")
for tw in [0.10, 0.15, 0.20, 0.25, 0.30]:
    run(f"trig_w={tw}", _trig_w=tw)

print("\n-- hot_w sweep --")
for hw in [0.05, 0.10, 0.15, 0.20, 0.25, 0.30]:
    run(f"hot_w={hw}", _hot_w=hw)

print("\n-- lag_pen sweep --")
for lp in [0.40, 0.45, 0.50, 0.55, 0.60, 0.65, 0.70]:
    run(f"lag_pen={lp}", _lag_pen=lp)

print("\n-- rec_mult sweep --")
for rm in [2.0, 2.5, 3.0, 3.5, 4.0, 5.0]:
    run(f"rec_mult={rm}", _rec_mult=rm)

print("\n-- back3_hot_w sweep --")
for bh in [0.00, 0.04, 0.06, 0.08, 0.10, 0.12, 0.15]:
    run(f"back3_hot_w={bh}", _back3_hot_w=bh)

print("\n-- junc_w sweep --")
for jw in [0.04, 0.06, 0.08, 0.10, 0.12, 0.15]:
    run(f"junc_w={jw}", _junc_w=jw)

print("\n-- k_back sweep --")
for kb in [30, 50, 75, 100, 150]:
    run(f"k_back={kb}", k_back=kb)

print("\n-- n_recent sweep --")
for nr in [15, 20, 25, 30, 35, 40]:
    run(f"n_recent={nr}", _n_recent=nr)
