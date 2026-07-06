"""
FABLE — สูตรทายเลขท้าย 2/3 ตัว optimize ต่อ "โอกาสถูกรางวัลใดๆ (1/2/3/4/5)"

แนวคิด: ไม่ทายเลขตรง 6 หลัก แต่ทายเลขท้ายที่มีโอกาสโผล่ใน pool รางวัลรวม
(prize1 + near1×2 + prize2×5 + prize3×10 + prize4×50 + prize5×100 = ~168 เลขต่องวด)

สัญญาณ (คำนวณจาก DB จริงทั้งหมด):
1. cross_freq  — ความถี่เลขท้ายใน pool รางวัลรวม recency-weighted
2. digit_pos   — joint probability ต่อตำแหน่งหลัก จาก pool
3. momentum    — ความถี่ 6 งวดล่าสุด (~3 เดือน) เทียบ 24 งวด (~12 เดือน)
4. anti_lag    — ลดน้ำหนักเลขที่โผล่ใน pool งวดที่แล้ว (mean-reversion)
5. near_miss   — แรงส่งจากเลขใกล้ ±1 และเลขซ้ำใน pool รางวัลรอง
6. transition  — pattern ข้ามงวด เช่น head3→tail3 และ tail3→tail2
7. diversity   — กระจายเลขท้ายที่เลือกไม่ให้กระจุก pattern เดียวกัน

เลขทุกตัวเป็น string เสมอ (คงเลข 0 นำหน้า)
"""
import random
from collections import Counter

import pandas as pd

# น้ำหนักสัญญาณ — เริ่มจากค่าสมมาตรใกล้ engine หลัก ปรับได้หลัง backtest
W_CROSS = 0.45
W_DIGITPOS = 0.20
W_MOMENTUM = 0.20
LAG_PENALTY = 0.25   # หักสูงสุด 25% ถ้าเพิ่งโผล่งวดที่แล้ว
W_NEAR_MISS = 0.0    # default = 0 เพื่อเก็บ FABLE v2 เป็น baseline อ้างอิง
W_TRANSITION = 0.0
DIVERSITY_PENALTY = 0.0
W_DRAWDAY = 0.25     # สัญญาณวันงวด (งวดวันที่ 1 vs 16 + เดือนเดียวกัน) — ทำให้ผลต่างตามวันที่เลือก
DEFAULT_WINDOW = 100
ROLLING_WINDOWS = (50, 100, 200)


def _weights(weights: dict | None = None) -> dict:
    base = {
        "cross_freq": W_CROSS,
        "digit_position": W_DIGITPOS,
        "momentum": W_MOMENTUM,
        "anti_lag_penalty": LAG_PENALTY,
        "near_miss": W_NEAR_MISS,
        "slice_transition": W_TRANSITION,
        "diversity_penalty": DIVERSITY_PENALTY,
        "draw_day": W_DRAWDAY,
    }
    if weights:
        for k in base:
            if weights.get(k) is not None:
                base[k] = float(weights[k])
    base["anti_lag_penalty"] = max(0.0, min(0.95, base["anti_lag_penalty"]))
    base["diversity_penalty"] = max(0.0, min(0.95, base["diversity_penalty"]))
    base["near_miss"] = max(0.0, min(2.0, base["near_miss"]))
    base["slice_transition"] = max(0.0, min(2.0, base["slice_transition"]))
    base["draw_day"] = max(0.0, min(2.0, base["draw_day"]))
    return base

# pool เป้าหมาย = รางวัล 1-5 ทั้งหมด (~168 เลข 6 หลักต่องวด)
POOL_SINGLE_COLS = (
    ["prize1", "near1_1", "near1_2"] +
    [f"prize2_{i}" for i in range(1, 6)] +
    [f"prize3_{i}" for i in range(1, 11)]
)
POOL_MULTI_COLS = ["prize4", "prize5"]


def _draw_pool(row) -> list[str]:
    """เลข 6 หลักทั้งหมดของงวดหนึ่ง (รางวัล 1-5)"""
    nums: list[str] = []
    for c in POOL_SINGLE_COLS:
        v = str(row.get(c, "") or "").strip()
        if len(v) == 6 and v.isdigit():
            nums.append(v)
    for c in POOL_MULTI_COLS:
        v = str(row.get(c, "") or "").strip()
        for tok in v.split():
            if len(tok) == 6 and tok.isdigit():
                nums.append(tok)
    return nums


def _sanook_rows(df: pd.DataFrame) -> pd.DataFrame:
    """งวดที่มีข้อมูลรางวัลรอง (near1_1 ไม่ว่าง) เรียงเก่า→ใหม่"""
    if "near1_1" not in df.columns:
        return df.iloc[0:0]
    mask = df["near1_1"].notna() & (df["near1_1"].astype(str).str.strip() != "") \
        & (df["near1_1"].astype(str) != "nan")
    return df[mask].sort_values("date")


def _history_for_target(df: pd.DataFrame, target_date=None, window: int = DEFAULT_WINDOW) -> pd.DataFrame:
    rows = _sanook_rows(df)
    if target_date is not None and not rows.empty:
        target_ts = pd.to_datetime(target_date)
        rows = rows[rows["date"] < target_ts]
    return rows.tail(window)


def _recency_weight(i: int, n: int) -> float:
    return 0.3 + 0.7 * (i / max(n - 1, 1))


def _slice_of(num: str, width: int, head: bool = False) -> str:
    return num[:width] if head else num[-width:]


_ALL_SLICES_CACHE: dict[int, list[str]] = {}


def _all_slices(width: int) -> list[str]:
    cached = _ALL_SLICES_CACHE.get(width)
    if cached is None:
        cached = [str(i).zfill(width) for i in range(10 ** width)]
        _ALL_SLICES_CACHE[width] = cached
    return cached


def _normalize_counter(counter: Counter, keys: list[str]) -> dict[str, float]:
    max_v = max(counter.values()) if counter else 0.0
    if max_v <= 0:
        return {k: 0.0 for k in keys}
    return {k: counter.get(k, 0.0) / max_v for k in keys}


def _neighbor_slices(value: str) -> list[str]:
    width = len(value)
    n = int(value)
    out = []
    for delta in (-1, 1):
        x = n + delta
        if 0 <= x < 10 ** width:
            out.append(str(x).zfill(width))
    return out


_NEIGHBOR_CACHE: dict[int, dict[str, list[str]]] = {}


def _neighbor_map(width: int) -> dict[str, list[str]]:
    """ตาราง value -> เลขใกล้ ±1 ต่อ width — คำนวณครั้งเดียวต่อ width (2/3) แล้ว cache ไว้ใช้ซ้ำ
    (แทนการ int()/zfill() ใหม่ทุกครั้งใน hot loop ของ near-miss/backtest)"""
    cached = _NEIGHBOR_CACHE.get(width)
    if cached is None:
        cached = {v: _neighbor_slices(v) for v in _all_slices(width)}
        _NEIGHBOR_CACHE[width] = cached
    return cached


def _near_miss_feature(pools: list[list[str]], width: int, head: bool = False) -> dict[str, float]:
    """แรงส่งจากเลขใกล้ ±1 และเลขที่ซ้ำใน draw เดียวกัน ใช้เฉพาะ history."""
    keys = _all_slices(width)
    score: Counter = Counter()
    n_hist = len(pools)
    neighbors = _neighbor_map(width)
    for i, pool in enumerate(pools):
        w = _recency_weight(i, n_hist)
        slices = [_slice_of(num, width, head=head) for num in pool]
        cnt = Counter(slices)
        for t, c in cnt.items():
            if c > 1:
                score[t] += w * min(c - 1, 5) * 0.45
            for nb in neighbors[t]:
                score[nb] += w * min(c, 5)
    return _normalize_counter(score, keys)


def _draw_slot(ts) -> int:
    """งวดวันที่ 1 หรือ 16 (วันเลื่อน เช่น 2 พ.ค./30 ธ.ค. จัดเข้า slot ใกล้สุด)"""
    return 1 if pd.to_datetime(ts).day < 9 else 16


def _draw_day_feature(dates: list, pools: list[list[str]], width: int,
                      head: bool, target_ts) -> dict[str, float]:
    """ความถี่เลขใน pool ของงวดที่ 'ตรงเงื่อนไขวัน' กับงวดเป้าหมาย:
    slot เดียวกัน (1/16) น้ำหนัก 1.0, เดือนเดียวกัน +0.6, ทั้งคู่ +เพิ่มอีก
    ใช้เฉพาะ history — ไม่มองอนาคต"""
    keys = _all_slices(width)
    if target_ts is None or len(pools) == 0:
        return {k: 0.0 for k in keys}
    t = pd.to_datetime(target_ts)
    t_slot, t_month = _draw_slot(t), t.month
    sl = (lambda num: num[:width]) if head else (lambda num: num[-width:])
    score: Counter = Counter()
    n_hist = len(pools)
    for i, pool in enumerate(pools):
        d = pd.to_datetime(dates[i])
        w = 0.0
        if _draw_slot(d) == t_slot:
            w += 1.0
        if d.month == t_month:
            w += 0.6
        if w <= 0:
            continue
        w *= _recency_weight(i, n_hist)
        for num in pool:
            score[sl(num)] += w
    return _normalize_counter(score, keys)


def _transition_source(num: str, width: int, head: bool = False) -> str:
    # ใช้คู่ pattern ตาม roadmap: head3→tail3, tail3→tail2, และ tail3→head3
    if head:
        return num[-3:]
    if width == 3:
        return num[:3]
    return num[-3:]


def _transition_feature(pools: list[list[str]], width: int, head: bool = False,
                        source_sets: list[frozenset] | None = None) -> dict[str, float]:
    """เรียนรู้ draw ที่ source pattern คล้ายงวดล่าสุด แล้วดู target draw ถัดไป.
    `source_sets` (ถ้าส่งมา) คือ frozenset ของ transition-source ต่อ pool ที่คำนวณไว้ล่วงหน้า
    เรียงคู่กับ `pools` — ใช้เลี่ยงคำนวณ set ซ้ำเมื่อ backtest เลื่อน window ทับกันซ้ำๆ"""
    keys = _all_slices(width)
    if len(pools) < 3:
        return {k: 0.0 for k in keys}
    if source_sets is None:
        source_sets = [frozenset(_transition_source(num, width, head=head) for num in pool) for pool in pools]
    latest_source = source_sets[-1]
    if not latest_source:
        return {k: 0.0 for k in keys}

    score: Counter = Counter()
    n_pairs = len(pools) - 1
    for i in range(n_pairs):
        prev_source = source_sets[i]
        overlap = len(latest_source & prev_source)
        if overlap <= 0:
            continue
        sim = overlap / max(len(latest_source), 1)
        w = _recency_weight(i, n_pairs)
        targets = Counter(_slice_of(num, width, head=head) for num in pools[i + 1])
        for t, c in targets.items():
            score[t] += w * sim * min(c, 5)
    return _normalize_counter(score, keys)


def _tail_similarity(a: str, b: str) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    width = len(a)
    pos = sum(1 for x, y in zip(a, b) if x == y) / width
    prefix = 1.0 if width > 1 and a[:-1] == b[:-1] else 0.0
    suffix = 1.0 if width > 1 and a[1:] == b[1:] else 0.0
    digit_sum = 1.0 if sum(map(int, a)) % 10 == sum(map(int, b)) % 10 else 0.0
    return min(1.0, 0.45 * pos + 0.25 * prefix + 0.25 * suffix + 0.05 * digit_sum)


def _diverse_keys(keys: list[str], score_for, k: int, penalty: float) -> list[str]:
    if penalty <= 0 or k <= 1:
        return sorted(keys, key=score_for, reverse=True)[:k]
    shortlist = sorted(keys, key=score_for, reverse=True)[:max(k * 10, 60)]
    selected: list[str] = []
    remaining = shortlist[:]
    while remaining and len(selected) < k:
        best = max(
            remaining,
            key=lambda x: score_for(x) * (1 - penalty * max((_tail_similarity(x, y) for y in selected), default=0.0)),
        )
        selected.append(best)
        remaining.remove(best)
    return selected


def _rank_score_dict(scores: dict[str, dict], k: int, diversity_penalty: float = 0.0) -> list[tuple[str, dict]]:
    ranked_keys = _diverse_keys(list(scores.keys()), lambda key: scores[key]["score"], k, diversity_penalty)
    return [(key, scores[key]) for key in ranked_keys]


def _rank_records(records: list[dict], k: int, diversity_penalty: float = 0.0) -> list[dict]:
    if diversity_penalty <= 0 or k <= 1:
        return sorted(records, key=lambda x: x["score"], reverse=True)[:k]
    by_num = {r["number"]: r for r in records}
    ranked = _diverse_keys(list(by_num.keys()), lambda key: by_num[key]["score"], k, diversity_penalty)
    return [by_num[key] for key in ranked]


def _score_tails(history: pd.DataFrame, tail_len: int, head: bool = False,
                 pools: list | None = None, weights: dict | None = None,
                 target_ts=None, transition_sources: list | None = None) -> dict[str, dict]:
    """คะแนนต่อเลขท้าย (หรือเลขหน้า ถ้า head=True) tail_len หลัก จาก history (เรียงเก่า→ใหม่)"""
    n_hist = len(history)
    if n_hist == 0:
        return {}
    w_cfg = _weights(weights)

    if pools is None:
        pools = [_draw_pool(r) for _, r in history.iterrows()]
    _sl = (lambda num: num[:tail_len]) if head else (lambda num: num[-tail_len:])

    # 1) cross_freq: recency-weighted — งวดใหม่น้ำหนักมาก (linear ramp 0.3→1.0)
    cross: Counter = Counter()
    for i, pool in enumerate(pools):
        w = _recency_weight(i, n_hist)
        for num in pool:
            cross[_sl(num)] += w

    # 2) digit_pos: prob ต่อหลัก จาก pool ทั้งหมด แล้ว joint
    pos_cnt = [Counter() for _ in range(tail_len)]
    total_nums = 0
    for pool in pools:
        for num in pool:
            t = _sl(num)
            for p, d in enumerate(t):
                pos_cnt[p][d] += 1
            total_nums += 1
    def digit_pos_score(tail: str) -> float:
        s = 1.0
        for p, d in enumerate(tail):
            s *= pos_cnt[p][d] / max(total_nums, 1)
        return s

    # 3) momentum: 6 งวดล่าสุด vs 24 งวดล่าสุด
    mom_recent: Counter = Counter()
    mom_year: Counter = Counter()
    for pool in pools[-6:]:
        for num in pool:
            mom_recent[_sl(num)] += 1
    for pool in pools[-24:]:
        for num in pool:
            mom_year[_sl(num)] += 1

    # 4) anti_lag: เลขท้ายที่โผล่งวดล่าสุด
    last_tails = {_sl(num) for num in pools[-1]} if pools else set()

    max_cross = max(cross.values()) if cross else 1.0
    all_tails = _all_slices(tail_len)
    max_dp = max((digit_pos_score(t) for t in all_tails), default=1.0) or 1.0
    near = _near_miss_feature(pools, tail_len, head=head) if w_cfg["near_miss"] > 0 else {}
    transition = (_transition_feature(pools, tail_len, head=head, source_sets=transition_sources)
                  if w_cfg["slice_transition"] > 0 else {})
    dayaff = (_draw_day_feature(list(history["date"]), pools, tail_len, head, target_ts)
              if (w_cfg["draw_day"] > 0 and target_ts is not None) else {})

    out: dict[str, dict] = {}
    for t in all_tails:
        c = cross.get(t, 0) / max_cross
        dp = digit_pos_score(t) / max_dp
        r6 = mom_recent.get(t, 0)
        r24 = mom_year.get(t, 0)
        mom = (r6 / 6) / ((r24 / 24) + 1e-9) if r24 else (1.5 if r6 else 1.0)
        mom_n = min(mom / 3.0, 1.0)  # normalize cap ที่ 3x
        near_s = near.get(t, 0.0)
        trans_s = transition.get(t, 0.0)
        day_s = dayaff.get(t, 0.0)
        score = (
            w_cfg["cross_freq"] * c +
            w_cfg["digit_position"] * dp +
            w_cfg["momentum"] * mom_n +
            w_cfg["near_miss"] * near_s +
            w_cfg["slice_transition"] * trans_s +
            w_cfg["draw_day"] * day_s
        )
        lag = t in last_tails
        if lag:
            score *= (1 - w_cfg["anti_lag_penalty"])
        out[t] = {"score": score, "cross": c, "dp": dp, "mom": mom, "lag": lag,
                  "near": near_s, "transition": trans_s, "dayaff": day_s}
    return out


def _reason_th(t: str, s: dict, tail_len: int) -> str:
    parts = []
    if s["cross"] > 0.5:
        parts.append("โผล่บ่อยใน pool รางวัล 1-5")
    elif s["cross"] > 0.25:
        parts.append("ความถี่ปานกลางใน pool รางวัล")
    if s["mom"] > 1.5:
        parts.append("มาแรง 3 เดือนล่าสุด")
    if s["dp"] > 0.6:
        parts.append("โครงสร้างหลักเด่น")
    if s.get("near", 0) > 0.5:
        parts.append("มีแรงส่งจากเลขใกล้/เลขซ้ำ")
    if s.get("transition", 0) > 0.5:
        parts.append("เข้ากับ pattern ข้ามงวด")
    if s.get("dayaff", 0) > 0.5:
        parts.append("เด่นในงวดวัน/เดือนเดียวกัน")
    if s["lag"]:
        parts.append("(หักคะแนน — เพิ่งออกงวดก่อน)")
    return " · ".join(parts) if parts else "คะแนนรวมจากหลายสัญญาณ"


def _config(top2: int, top3: int, window: int, weights: dict | None = None) -> dict:
    w_cfg = _weights(weights)
    return {
        "pool": "prize1 + near1x2 + prize2x5 + prize3x10 + prize4x50 + prize5x100",
        "pool_label": "รางวัล 1-5 (~168 เลข/งวด)",
        "window": int(window),
        "n_six": 10,
        "top2": int(top2),
        "top3": int(top3),
        "weights": w_cfg,
        "signals": [
            "recency_weighted_frequency",
            "digit_position",
            "momentum_6_vs_24",
            "anti_lag",
            "near_miss_carry",
            "slice_transition",
            "pool_diversity",
        ],
    }


def _gen_six(hist: pd.DataFrame, n_six: int, pools: list | None = None,
             weights: dict | None = None,
             head_scores: dict[str, dict] | None = None,
             tail_scores: dict[str, dict] | None = None,
             target_ts=None) -> list[dict]:
    """สร้างเลข 6 หลัก: หน้า 3 (head) × ท้าย 3 (tail) จากคะแนน pool รางวัล 1-5"""
    if head_scores is None:
        head_scores = _score_tails(hist, 3, head=True, pools=pools, weights=weights, target_ts=target_ts)
    if tail_scores is None:
        tail_scores = _score_tails(hist, 3, head=False, pools=pools, weights=weights, target_ts=target_ts)
    w_cfg = _weights(weights)
    top_heads = _rank_score_dict(head_scores, 8, w_cfg["diversity_penalty"])
    top_tails = _rank_score_dict(tail_scores, 8, w_cfg["diversity_penalty"])
    combos = []
    for h, hs in top_heads:
        for t, ts in top_tails:
            combos.append({
                "number": h + t,
                "score": round(hs["score"] * ts["score"], 4),
                "reason": f"หน้า {h}: {_reason_th(h, hs, 3)} | ท้าย {t}: {_reason_th(t, ts, 3)}",
            })
    return _rank_records(combos, n_six, w_cfg["diversity_penalty"])


def fable_predict(df: pd.DataFrame, n_six: int = 10, top2: int = 10, top3: int = 15,
                  window: int = DEFAULT_WINDOW, weights: dict | None = None,
                  target_date=None) -> dict:
    """ทำนายเลข 6 หลัก + เลขท้าย 2/3 ตัวสำหรับงวดเป้าหมาย โดยใช้เฉพาะข้อมูลก่อนงวดนั้น"""
    hist = _history_for_target(df, target_date=target_date, window=window)
    if len(hist) < 20:
        return {"error": "ข้อมูลรางวัลรองไม่พอ (ต้องมีอย่างน้อย 20 งวด)"}

    pools = [_draw_pool(r) for _, r in hist.iterrows()]
    w_cfg = _weights(weights)
    target_ts = pd.to_datetime(target_date) if target_date is not None else None
    res = {"six": _gen_six(hist, n_six, pools=pools, weights=w_cfg, target_ts=target_ts)}
    for tail_len, k, key in ((2, top2, "tail2"), (3, top3, "tail3")):
        scores = _score_tails(hist, tail_len, pools=pools, weights=w_cfg, target_ts=target_ts)
        ranked = _rank_score_dict(scores, k, w_cfg["diversity_penalty"])
        res[key] = [
            {"number": t, "score": round(s["score"], 4), "reason": _reason_th(t, s, tail_len)}
            for t, s in ranked
        ]
    res["n_history"] = len(hist)
    if target_ts is not None:
        res["target_date"] = str(target_ts.date())
        res["target_slot"] = f"งวดวันที่ {_draw_slot(target_ts)} เดือน {target_ts.month}"
    last_ref = hist.iloc[-1]
    first_ref = hist.iloc[0]
    res["history_range"] = {
        "from": str(first_ref["date"].date()),
        "to": str(last_ref["date"].date()),
    }
    res["reference_draw"] = {
        "date": str(last_ref["date"].date()),
        "prize1": str(last_ref.get("prize1", "")),
    }
    res["config"] = _config(top2=top2, top3=top3, window=window, weights=w_cfg) | {"n_six": int(n_six)}
    return res


def _empty_walk_stats() -> dict:
    return {
        "six": {"sum_hits": 0.0, "sum_rand": 0.0, "any": 0},
        "tail2": {"sum_hits": 0.0, "sum_rand": 0.0, "any": 0},
        "tail3": {"sum_hits": 0.0, "sum_rand": 0.0, "any": 0},
    }


def _walk_forward_eval(rows: pd.DataFrame, pools_by_i: list, dates_by_i: list,
                       trans_sources: dict, w_cfg: dict, window: int,
                       top2: int, top3: int, indices) -> tuple[dict, dict, int]:
    """ประเมิน FABLE ด้วย engine เดียวกับ fable_predict (full _score_tails/_gen_six)
    สำหรับ absolute row indices ที่กำหนด — ใช้ร่วมกันระหว่าง rolling backtest และ
    validation/live segment ของ promotion gate เพื่อไม่ให้มี scoring logic สองชุด"""
    stats = _empty_walk_stats()
    per_draw = {"six": [], "tail2": [], "tail3": []}
    tested = 0
    for i in indices:
        hist_len = i - max(0, i - window)
        if hist_len < 20:
            continue
        actual_pool = pools_by_i[i]
        if not actual_pool:
            continue
        tested += 1
        hist = rows.iloc[max(0, i - window):i]
        hist_pools = pools_by_i[max(0, i - window):i]
        draw_ts = dates_by_i[i]  # วันงวดที่ทดสอบ — ใช้เป็น target ของ draw_day signal
        score_cache: dict[tuple[int, bool], dict[str, dict]] = {}

        def scores_for(tail_len: int, head: bool = False, i=i, hist=hist, hist_pools=hist_pools,
                      draw_ts=draw_ts, score_cache=score_cache) -> dict[str, dict]:
            key = (tail_len, head)
            if key not in score_cache:
                src = trans_sources.get((tail_len, head))
                src_slice = src[max(0, i - window):i] if src is not None else None
                score_cache[key] = _score_tails(hist, tail_len, head=head, pools=hist_pools,
                                                weights=w_cfg, target_ts=draw_ts,
                                                transition_sources=src_slice)
            return score_cache[key]

        rng = random.Random(f"fable-{draw_ts}")
        # เลข 6 หลักตรงตัว vs pool รางวัล 1-5
        pool_set = set(actual_pool)
        tail3_scores = scores_for(3, False)
        preds6 = [x["number"] for x in _gen_six(
            hist,
            10,
            pools=hist_pools,
            weights=w_cfg,
            head_scores=scores_for(3, True),
            tail_scores=tail3_scores,
        )]
        n6 = sum(1 for p in preds6 if p in pool_set)
        stats["six"]["sum_hits"] += n6
        if n6:
            stats["six"]["any"] += 1
        rand6 = {str(x).zfill(6) for x in rng.sample(range(10 ** 6), 10)}
        r6 = len(rand6 & pool_set)
        stats["six"]["sum_rand"] += r6
        per_draw["six"].append((n6, r6))
        for tail_len, k, key in ((2, top2, "tail2"), (3, top3, "tail3")):
            actual_tails = {num[-tail_len:] for num in actual_pool}
            scores = tail3_scores if tail_len == 3 else scores_for(tail_len, False)
            preds = [t for t, _ in _rank_score_dict(scores, k, w_cfg["diversity_penalty"])]
            n_hit = sum(1 for p in preds if p in actual_tails)
            stats[key]["sum_hits"] += n_hit
            if n_hit:
                stats[key]["any"] += 1
            space = 10 ** tail_len
            rand_preds = {str(x).zfill(tail_len) for x in rng.sample(range(space), k)}
            r_hit = len(rand_preds & actual_tails)
            stats[key]["sum_rand"] += r_hit
            per_draw[key].append((n_hit, r_hit))
    return stats, per_draw, tested


def _summarize_walk_stats(stats: dict, tested: int) -> dict:
    out = {}
    for key in ("six", "tail2", "tail3"):
        s = stats[key]
        avg_p = s["sum_hits"] / max(tested, 1)
        avg_r = s["sum_rand"] / max(tested, 1)
        out[key] = {
            "avg_hits": round(avg_p, 3),
            "baseline_avg_hits": round(avg_r, 3),
            "edge": round(avg_p - avg_r, 3),
            "any_hit_pct": round(s["any"] / max(tested, 1) * 100, 1),
        }
    return out


def _rolling_report(per_draw: dict) -> dict:
    rolling = {}
    for w in ROLLING_WINDOWS:
        rolling[f"W{w}"] = {}
        for key in ("six", "tail2", "tail3"):
            rows_w = per_draw[key][-w:]
            n_w = len(rows_w)
            if not n_w:
                rolling[f"W{w}"][key] = {"n": 0, "avg_hits": None, "baseline_avg_hits": None, "edge": None}
                continue
            h = sum(x[0] for x in rows_w) / n_w
            r = sum(x[1] for x in rows_w) / n_w
            rolling[f"W{w}"][key] = {
                "n": n_w,
                "avg_hits": round(h, 3),
                "baseline_avg_hits": round(r, 3),
                "edge": round(h - r, 3),
            }
    return rolling


def _rolling_criteria(rolling: dict, tested: int) -> dict:
    w50 = rolling.get("W50", {})
    w100 = rolling.get("W100", {})
    w200 = rolling.get("W200", {})
    tail2_edges = [w50.get("tail2", {}).get("edge"), w100.get("tail2", {}).get("edge"), w200.get("tail2", {}).get("edge")]
    tail3_edges = [w50.get("tail3", {}).get("edge"), w100.get("tail3", {}).get("edge"), w200.get("tail3", {}).get("edge")]
    tail2_positive = all(e is not None and e > 0 for e in tail2_edges)
    tail3_not_negative = all(e is not None and e >= 0 for e in tail3_edges)
    tail2_w200 = w200.get("tail2", {}).get("edge")
    tail3_w200 = w200.get("tail3", {}).get("edge")
    return {
        "tail2_positive_all_windows": tail2_positive,
        "tail2_w200_at_least_2": tail2_w200 is not None and tail2_w200 >= 2.0,
        "tail3_not_negative_all_windows": tail3_not_negative,
        "tail3_w200_at_least_0_5": tail3_w200 is not None and tail3_w200 >= 0.5,
        "min_sample_200": tested >= 200,
    }


def _prep_walk_forward_inputs(rows: pd.DataFrame, w_cfg: dict) -> tuple[list, list, dict]:
    pools_by_i = [_draw_pool(r) for _, r in rows.iterrows()]
    dates_by_i = list(rows["date"])
    trans_sources: dict[tuple[int, bool], list] = {}
    if w_cfg["slice_transition"] > 0:
        for tl, hd in ((3, True), (3, False), (2, False)):
            trans_sources[(tl, hd)] = [
                frozenset(_transition_source(num, tl, head=hd) for num in pool) for pool in pools_by_i
            ]
    return pools_by_i, dates_by_i, trans_sources


def fable_rolling_windows(df: pd.DataFrame, n_draws: int = 200, top2: int = 10,
                          top3: int = 15, window: int = DEFAULT_WINDOW,
                          weights: dict | None = None, _prepared: tuple | None = None) -> dict:
    """คำนวณ rolling W50/W100/W200 tail2/tail3 edge สำหรับ config หนึ่งชุด ด้วย
    engine เดียวกับ fable_backtest (_walk_forward_eval + _rolling_report) — แยกออกมา
    ให้เรียกใช้ได้ทั้งจาก fable_backtest (rolling window ปกติ) และ fable_grid_search
    (top-5 rolling comparison) โดยไม่มี scoring logic สองชุด

    `_prepared` (ใช้ภายในเท่านั้น): ถ้า caller (เช่น fable_backtest) เตรียม
    rows/w_cfg/pools_by_i/dates_by_i/trans_sources ไว้แล้ว ส่งเข้ามาเป็น
    (rows, w_cfg, pools_by_i, dates_by_i, trans_sources) เพื่อไม่ต้องเตรียมซ้ำ"""
    if _prepared is not None:
        rows, w_cfg, pools_by_i, dates_by_i, trans_sources = _prepared
    else:
        rows = _sanook_rows(df).reset_index(drop=True)
        if len(rows) < 40:
            return {"error": "ข้อมูลไม่พอสำหรับ backtest", "tested": 0, "rolling": {}}
        w_cfg = _weights(weights)
        pools_by_i, dates_by_i, trans_sources = _prep_walk_forward_inputs(rows, w_cfg)

    n_test = min(n_draws, len(rows) - 20)
    start = len(rows) - n_test

    stats, per_draw, tested = _walk_forward_eval(
        rows, pools_by_i, dates_by_i, trans_sources, w_cfg, window, top2, top3,
        range(start, len(rows)),
    )

    out = {"tested": tested, "config": _config(top2=top2, top3=top3, window=window, weights=w_cfg)}
    out.update(_summarize_walk_stats(stats, tested))
    out["rolling"] = _rolling_report(per_draw)
    return out


def fable_backtest(df: pd.DataFrame, n_draws: int = 200, top2: int = 10,
                   top3: int = 15, window: int = DEFAULT_WINDOW,
                   weights: dict | None = None, gate: bool = False,
                   validation_draws: int = 40, live_draws: int = 40) -> dict:
    """
    Backtest: ต่องวด ใช้ข้อมูลก่อนหน้าเท่านั้นทำนาย แล้วเช็กว่าเลขท้ายที่ทาย
    โผล่ใน pool รางวัล 1-5 ของงวดจริงไหม
    Baseline: สุ่มเลขจำนวนเท่ากัน (seed คงที่ต่องวด — ทำซ้ำได้)

    เมื่อ `gate=True` (Promotion Gate ที่ hardened แล้ว): นอกจาก rolling W50/W100/W200
    ของ n_draws ล่าสุด ยังรัน validation/live เพิ่มบนช่วงเก่ากว่า (ไม่ทับกับ rolling window)
    ด้วย engine เดียวกัน แล้วรวมเกณฑ์ทั้งหมดเป็น `criteria`/`passed` เดียว — กัน config ที่ผ่าน
    แค่เพราะช่วง 200 งวดล่าสุด "ดวงดี" ช่วงเดียว
    """
    rows = _sanook_rows(df).reset_index(drop=True)
    if len(rows) < 40:
        return {"error": "ข้อมูลไม่พอสำหรับ backtest"}
    n_test = min(n_draws, len(rows) - 20)
    start = len(rows) - n_test
    w_cfg = _weights(weights)
    pools_by_i, dates_by_i, trans_sources = _prep_walk_forward_inputs(rows, w_cfg)

    out = fable_rolling_windows(df, n_draws=n_draws, top2=top2, top3=top3, window=window,
                                weights=weights,
                                _prepared=(rows, w_cfg, pools_by_i, dates_by_i, trans_sources))
    if "error" in out:
        return out
    tested = out["tested"]
    criteria = _rolling_criteria(out["rolling"], tested)

    if gate:
        older_end = start
        older_total = max(20, validation_draws) + max(20, live_draws)
        older_start = max(0, older_end - older_total)
        validation_n = min(max(20, validation_draws), max(0, older_end - older_start))
        validation_indices = range(older_start, older_start + validation_n)
        live_indices = range(older_start + validation_n, older_end)

        val_stats, _, val_tested = _walk_forward_eval(
            rows, pools_by_i, dates_by_i, trans_sources, w_cfg, window, top2, top3, validation_indices,
        )
        live_stats, _, live_tested = _walk_forward_eval(
            rows, pools_by_i, dates_by_i, trans_sources, w_cfg, window, top2, top3, live_indices,
        )
        validation_summary = _summarize_walk_stats(val_stats, val_tested)
        live_summary = _summarize_walk_stats(live_stats, live_tested)
        val_t2 = validation_summary["tail2"]["edge"]
        val_t3 = validation_summary["tail3"]["edge"]
        live_t2 = live_summary["tail2"]["edge"]
        live_t3 = live_summary["tail3"]["edge"]
        gate_criteria = {
            "validation_tail2_positive": val_tested >= 20 and val_t2 is not None and val_t2 > 0,
            "validation_tail3_not_negative": val_tested >= 20 and val_t3 is not None and val_t3 >= 0,
            "live_tail2_positive": live_tested >= 20 and live_t2 is not None and live_t2 > 0,
            "live_tail3_not_negative": live_tested >= 20 and live_t3 is not None and live_t3 >= 0,
        }
        out["validation"] = validation_summary
        out["live"] = live_summary
        out["tested_validation"] = val_tested
        out["tested_live"] = live_tested
        out["ranges"] = {
            "rolling": {"from": str(rows.iloc[start]["date"].date()) if tested else None,
                       "to": str(rows.iloc[-1]["date"].date())},
            "validation": {"from": str(rows.iloc[validation_indices[0]]["date"].date()) if val_tested and len(validation_indices) else None,
                          "to": str(rows.iloc[validation_indices[-1]]["date"].date()) if len(validation_indices) else None},
            "live": {"from": str(rows.iloc[live_indices[0]]["date"].date()) if live_tested and len(live_indices) else None,
                    "to": str(rows.iloc[live_indices[-1]]["date"].date()) if len(live_indices) else None},
        }
        criteria = {**criteria, **gate_criteria}

    out["criteria"] = criteria
    # ผ่านเกณฑ์ "แนะนำ" เมื่อชนะ baseline ทั้ง rolling (W50/W100/W200) และ (ถ้า gate=True)
    # validation/live ที่เป็นช่วงเก่ากว่าแยกต่างหาก ตาม DEVELOPMENT_PLAN
    out["passed"] = all(criteria.values())
    return out


def _tail_feature_table(pools: list[list[str]], tail_len: int,
                        include_near: bool = False,
                        include_transition: bool = False,
                        dates: list | None = None,
                        target_ts=None) -> dict[str, dict]:
    n_hist = len(pools)
    if n_hist == 0:
        return {}
    sl = lambda num: num[-tail_len:]
    cross: Counter = Counter()
    pos_cnt = [Counter() for _ in range(tail_len)]
    total_nums = 0
    for i, pool in enumerate(pools):
        w = _recency_weight(i, n_hist)
        for num in pool:
            t = sl(num)
            cross[t] += w
            for p, d in enumerate(t):
                pos_cnt[p][d] += 1
            total_nums += 1

    def digit_pos_score(tail: str) -> float:
        s = 1.0
        for p, d in enumerate(tail):
            s *= pos_cnt[p][d] / max(total_nums, 1)
        return s

    max_cross = max(cross.values()) if cross else 1.0
    all_tails = _all_slices(tail_len)
    max_dp = max((digit_pos_score(t) for t in all_tails), default=1.0) or 1.0
    mom_recent: Counter = Counter()
    mom_year: Counter = Counter()
    for pool in pools[-6:]:
        for num in pool:
            mom_recent[sl(num)] += 1
    for pool in pools[-24:]:
        for num in pool:
            mom_year[sl(num)] += 1
    last_tails = {sl(num) for num in pools[-1]} if pools else set()
    near = _near_miss_feature(pools, tail_len) if include_near else {}
    transition = _transition_feature(pools, tail_len) if include_transition else {}
    dayaff = (_draw_day_feature(dates or [], pools, tail_len, False, target_ts)
              if (dates is not None and target_ts is not None) else {})

    features: dict[str, dict] = {}
    for t in all_tails:
        r6 = mom_recent.get(t, 0)
        r24 = mom_year.get(t, 0)
        mom = (r6 / 6) / ((r24 / 24) + 1e-9) if r24 else (1.5 if r6 else 1.0)
        features[t] = {
            "cross": cross.get(t, 0) / max_cross,
            "dp": digit_pos_score(t) / max_dp,
            "mom_n": min(mom / 3.0, 1.0),
            "lag": t in last_tails,
            "near": near.get(t, 0.0),
            "transition": transition.get(t, 0.0),
            "dayaff": dayaff.get(t, 0.0),
        }
    return features


def _rank_feature_table(features: dict[str, dict], weights: dict, k: int) -> list[str]:
    w_cfg = _weights(weights)

    def score(item):
        _, f = item
        s = (
            w_cfg["cross_freq"] * f["cross"] +
            w_cfg["digit_position"] * f["dp"] +
            w_cfg["momentum"] * f["mom_n"] +
            w_cfg["near_miss"] * f.get("near", 0.0) +
            w_cfg["slice_transition"] * f.get("transition", 0.0) +
            w_cfg["draw_day"] * f.get("dayaff", 0.0)
        )
        if f["lag"]:
            s *= (1 - w_cfg["anti_lag_penalty"])
        return s

    keys = _diverse_keys(list(features.keys()), lambda key: score((key, features[key])), k, w_cfg["diversity_penalty"])
    return keys


def _empty_eval_stats() -> dict:
    return {
        "tested": 0,
        "tail2_hits": 0.0,
        "tail2_rand": 0.0,
        "tail2_any": 0,
        "tail3_hits": 0.0,
        "tail3_rand": 0.0,
        "tail3_any": 0,
    }


def _summarize_eval_stats(stats: dict) -> dict:
    tested = max(int(stats["tested"]), 1)

    def metric(prefix: str) -> dict:
        avg = stats[f"{prefix}_hits"] / tested
        rand = stats[f"{prefix}_rand"] / tested
        return {
            "avg_hits": round(avg, 3),
            "baseline_avg_hits": round(rand, 3),
            "edge": round(avg - rand, 3),
            "any_hit_pct": round(stats[f"{prefix}_any"] / tested * 100, 1),
        }

    tail2 = metric("tail2")
    tail3 = metric("tail3")
    score = tail2["edge"] + (2 * tail3["edge"])
    return {"tested": stats["tested"], "tail2": tail2, "tail3": tail3, "score": round(score, 3)}


def _candidate_configs() -> list[dict]:
    return [
        {"name": "default_v2", "window": 100, "weights": _weights()},
        {"name": "drawday_off", "window": 100, "weights": _weights({"draw_day": 0.0})},
        {"name": "drawday_on_050", "window": 100, "weights": _weights({"draw_day": 0.50})},
        {"name": "diversity_100", "window": 100, "weights": _weights({"cross_freq": 0.45, "digit_position": 0.20, "momentum": 0.20, "anti_lag_penalty": 0.25, "diversity_penalty": 0.22})},
        {"name": "near_miss_80", "window": 80, "weights": _weights({"cross_freq": 0.42, "digit_position": 0.16, "momentum": 0.18, "anti_lag_penalty": 0.20, "near_miss": 0.18})},
        {"name": "short_window_60", "window": 60, "weights": _weights()},
        {"name": "recency_heavy_60", "window": 60, "weights": _weights({"cross_freq": 0.65, "digit_position": 0.15, "momentum": 0.15, "anti_lag_penalty": 0.20})},
        {"name": "signal_blend_80", "window": 80, "weights": _weights({"cross_freq": 0.42, "digit_position": 0.14, "momentum": 0.16, "anti_lag_penalty": 0.20, "near_miss": 0.14, "slice_transition": 0.14})},
        {"name": "long_window_150", "window": 150, "weights": _weights()},
        {"name": "transition_100", "window": 100, "weights": _weights({"cross_freq": 0.40, "digit_position": 0.16, "momentum": 0.18, "anti_lag_penalty": 0.20, "slice_transition": 0.18})},
        {"name": "signal_diverse_80", "window": 80, "weights": _weights({"cross_freq": 0.42, "digit_position": 0.14, "momentum": 0.16, "anti_lag_penalty": 0.18, "near_miss": 0.12, "slice_transition": 0.12, "diversity_penalty": 0.24})},
        {"name": "recency_heavy_100", "window": 100, "weights": _weights({"cross_freq": 0.65, "digit_position": 0.15, "momentum": 0.15, "anti_lag_penalty": 0.20})},
        {"name": "digit_shape_100", "window": 100, "weights": _weights({"cross_freq": 0.35, "digit_position": 0.40, "momentum": 0.15, "anti_lag_penalty": 0.20})},
        {"name": "momentum_60", "window": 60, "weights": _weights({"cross_freq": 0.35, "digit_position": 0.15, "momentum": 0.40, "anti_lag_penalty": 0.20})},
        {"name": "momentum_100", "window": 100, "weights": _weights({"cross_freq": 0.35, "digit_position": 0.15, "momentum": 0.40, "anti_lag_penalty": 0.20})},
        {"name": "low_lag_100", "window": 100, "weights": _weights({"cross_freq": 0.45, "digit_position": 0.20, "momentum": 0.20, "anti_lag_penalty": 0.05})},
        {"name": "high_lag_100", "window": 100, "weights": _weights({"cross_freq": 0.45, "digit_position": 0.20, "momentum": 0.20, "anti_lag_penalty": 0.45})},
        {"name": "balanced_80", "window": 80, "weights": _weights({"cross_freq": 0.50, "digit_position": 0.25, "momentum": 0.20, "anti_lag_penalty": 0.20})},
        {"name": "balanced_150", "window": 150, "weights": _weights({"cross_freq": 0.50, "digit_position": 0.25, "momentum": 0.20, "anti_lag_penalty": 0.20})},
    ]


TOP_N_ROLLING_COMPARE = 5


def fable_grid_search(df: pd.DataFrame, n_draws: int = 160, holdout_draws: int = 50,
                      top2: int = 10, top3: int = 15, max_configs: int = 12,
                      rolling_n_draws: int = 200) -> dict:
    rows = _sanook_rows(df).reset_index(drop=True)
    if len(rows) < 80:
        return {"error": "ข้อมูลไม่พอสำหรับ grid search"}
    n_eval = min(n_draws, len(rows) - 20)
    holdout = min(max(20, holdout_draws), max(20, n_eval // 2))
    train = max(20, n_eval - holdout)
    start = len(rows) - n_eval
    train_indices = list(range(start, start + train))
    holdout_indices = list(range(start + train, start + train + holdout))
    pools_by_i = [_draw_pool(r) for _, r in rows.iterrows()]
    dates_by_i = list(rows["date"])
    configs = _candidate_configs()[:max(1, max_configs)]
    feature_cache: dict[tuple[int, int, int, bool, bool, bool], dict[str, dict]] = {}

    def features_for(i: int, window: int, tail_len: int, weights: dict) -> dict[str, dict]:
        w_cfg = _weights(weights)
        include_near = w_cfg["near_miss"] > 0
        include_transition = w_cfg["slice_transition"] > 0
        include_dayaff = w_cfg["draw_day"] > 0
        key = (i, window, tail_len, include_near, include_transition, include_dayaff)
        if key not in feature_cache:
            hist_pools = pools_by_i[max(0, i - window):i]
            hist_dates = dates_by_i[max(0, i - window):i] if include_dayaff else None
            feature_cache[key] = _tail_feature_table(
                hist_pools,
                tail_len,
                include_near=include_near,
                include_transition=include_transition,
                dates=hist_dates,
                target_ts=dates_by_i[i] if include_dayaff else None,
            )
        return feature_cache[key]

    baseline_cache: dict[int, dict] = {}

    def baseline_for(i: int) -> dict:
        if i not in baseline_cache:
            rng = random.Random(f"fable-{rows.iloc[i]['date']}")
            rng.sample(range(10 ** 6), 10)  # consume same draw as fable_backtest six baseline
            actual_pool = pools_by_i[i]
            baseline_cache[i] = {
                "tail2": {str(x).zfill(2) for x in rng.sample(range(100), top2)} &
                {num[-2:] for num in actual_pool},
                "tail3": {str(x).zfill(3) for x in rng.sample(range(1000), top3)} &
                {num[-3:] for num in actual_pool},
            }
        return baseline_cache[i]

    def evaluate(cfg: dict, indices: list[int]) -> dict:
        stats = _empty_eval_stats()
        window = int(cfg["window"])
        weights = cfg["weights"]
        for i in indices:
            hist_len = i - max(0, i - window)
            actual_pool = pools_by_i[i]
            if hist_len < 20 or not actual_pool:
                continue
            actual_t2 = {num[-2:] for num in actual_pool}
            actual_t3 = {num[-3:] for num in actual_pool}
            pred2 = _rank_feature_table(features_for(i, window, 2, weights), weights, top2)
            pred3 = _rank_feature_table(features_for(i, window, 3, weights), weights, top3)
            hit2 = sum(1 for p in pred2 if p in actual_t2)
            hit3 = sum(1 for p in pred3 if p in actual_t3)
            base = baseline_for(i)
            stats["tested"] += 1
            stats["tail2_hits"] += hit2
            stats["tail3_hits"] += hit3
            stats["tail2_rand"] += len(base["tail2"])
            stats["tail3_rand"] += len(base["tail3"])
            if hit2:
                stats["tail2_any"] += 1
            if hit3:
                stats["tail3_any"] += 1
        return _summarize_eval_stats(stats)

    results = []
    for cfg in configs:
        train_report = evaluate(cfg, train_indices)
        holdout_report = evaluate(cfg, holdout_indices)
        train_score = train_report["score"]
        holdout_score = holdout_report["score"]
        results.append({
            "name": cfg["name"],
            "config": _config(top2=top2, top3=top3, window=cfg["window"], weights=cfg["weights"]),
            "train": train_report,
            "holdout": holdout_report,
            "overfit_gap": round(train_score - holdout_score, 3),
            "stable": holdout_report["tail2"]["edge"] > 0 and holdout_report["tail3"]["edge"] >= 0,
        })

    # top-N by holdout score (not `stable`) get re-evaluated across rolling W50/W100/W200 —
    # selection must still produce a comparison even when zero configs are currently stable
    def _flatten_window(win: dict) -> dict:
        return {
            "n": win.get("tail2", {}).get("n"),
            "tail2_edge": win.get("tail2", {}).get("edge"),
            "tail3_edge": win.get("tail3", {}).get("edge"),
        }

    by_holdout = sorted(results, key=lambda x: x["holdout"]["score"], reverse=True)
    for row in by_holdout[:TOP_N_ROLLING_COMPARE]:
        cfg_lookup = next(c for c in configs if c["name"] == row["name"])
        rw = fable_rolling_windows(df, n_draws=rolling_n_draws, top2=top2, top3=top3,
                                   window=cfg_lookup["window"], weights=cfg_lookup["weights"])
        if "error" not in rw:
            row["rolling"] = {
                "w50": _flatten_window(rw["rolling"].get("W50", {})),
                "w100": _flatten_window(rw["rolling"].get("W100", {})),
                "w200": _flatten_window(rw["rolling"].get("W200", {})),
            }

    ranked = sorted(results, key=lambda x: (x["train"]["score"], x["holdout"]["score"]), reverse=True)
    for rank, row in enumerate(ranked, start=1):
        row["rank"] = rank
    best_train = ranked[0] if ranked else None
    best_holdout = max(results, key=lambda x: x["holdout"]["score"]) if results else None
    return {
        "n_draws": n_eval,
        "train_draws": train,
        "holdout_draws": holdout,
        "top2": top2,
        "top3": top3,
        "configs_tested": len(configs),
        "selection_rule": "rank by train score; inspect holdout to avoid overfit",
        "score_formula": "tail2_edge + 2*tail3_edge",
        "rolling_compare_rule": f"top {TOP_N_ROLLING_COMPARE} configs by holdout score get W50/W100/W200 rolling edge",
        "best_train": best_train,
        "best_holdout": best_holdout,
        "results": ranked,
    }


def fable_holdout_report(df: pd.DataFrame, n_draws: int = 120,
                         validation_draws: int = 30, live_draws: int = 30,
                         top2: int = 10, top3: int = 15,
                         max_configs: int = 6) -> dict:
    """
    Formal FABLE holdout report:
    - train = older part of the evaluation window
    - validation = config selection window
    - live = most recent untouched window

    ใช้เฉพาะข้อมูลก่อนงวดที่ประเมินเสมอ เหมาะกับการจับ overfit ก่อนโปรโมตสูตร
    """
    rows = _sanook_rows(df).reset_index(drop=True)
    if len(rows) < 90:
        return {"error": "ข้อมูลไม่พอสำหรับ holdout/live report"}

    n_eval = min(n_draws, len(rows) - 20)
    if n_eval < 70:
        return {"error": "evaluation window ต้องมีอย่างน้อย 70 งวด"}

    live = min(max(20, live_draws), max(20, n_eval - 50))
    validation = min(max(20, validation_draws), max(20, n_eval - live - 30))
    train = n_eval - validation - live
    if train < 30:
        train = 30
        remaining = max(n_eval - train, 40)
        validation = max(20, remaining // 2)
        live = max(20, remaining - validation)

    start = len(rows) - n_eval
    train_indices = list(range(start, start + train))
    validation_indices = list(range(start + train, start + train + validation))
    live_indices = list(range(start + train + validation, start + train + validation + live))
    pools_by_i = [_draw_pool(r) for _, r in rows.iterrows()]
    dates_by_i = list(rows["date"])
    configs = _candidate_configs()[:max(1, max_configs)]
    feature_cache: dict[tuple[int, int, int, bool, bool, bool], dict[str, dict]] = {}

    def features_for(i: int, window: int, tail_len: int, weights: dict) -> dict[str, dict]:
        w_cfg = _weights(weights)
        include_near = w_cfg["near_miss"] > 0
        include_transition = w_cfg["slice_transition"] > 0
        include_dayaff = w_cfg["draw_day"] > 0
        key = (i, window, tail_len, include_near, include_transition, include_dayaff)
        if key not in feature_cache:
            hist_pools = pools_by_i[max(0, i - window):i]
            hist_dates = dates_by_i[max(0, i - window):i] if include_dayaff else None
            feature_cache[key] = _tail_feature_table(
                hist_pools,
                tail_len,
                include_near=include_near,
                include_transition=include_transition,
                dates=hist_dates,
                target_ts=dates_by_i[i] if include_dayaff else None,
            )
        return feature_cache[key]

    baseline_cache: dict[int, dict] = {}

    def baseline_for(i: int) -> dict:
        if i not in baseline_cache:
            rng = random.Random(f"fable-{rows.iloc[i]['date']}")
            rng.sample(range(10 ** 6), 10)
            actual_pool = pools_by_i[i]
            baseline_cache[i] = {
                "tail2": {str(x).zfill(2) for x in rng.sample(range(100), top2)} &
                {num[-2:] for num in actual_pool},
                "tail3": {str(x).zfill(3) for x in rng.sample(range(1000), top3)} &
                {num[-3:] for num in actual_pool},
            }
        return baseline_cache[i]

    def date_range(indices: list[int]) -> dict:
        if not indices:
            return {"from": None, "to": None}
        return {
            "from": str(rows.iloc[indices[0]]["date"].date()),
            "to": str(rows.iloc[indices[-1]]["date"].date()),
        }

    def evaluate(cfg: dict, indices: list[int]) -> dict:
        stats = _empty_eval_stats()
        window = int(cfg["window"])
        weights = cfg["weights"]
        for i in indices:
            hist_len = i - max(0, i - window)
            actual_pool = pools_by_i[i]
            if hist_len < 20 or not actual_pool:
                continue
            actual_t2 = {num[-2:] for num in actual_pool}
            actual_t3 = {num[-3:] for num in actual_pool}
            pred2 = _rank_feature_table(features_for(i, window, 2, weights), weights, top2)
            pred3 = _rank_feature_table(features_for(i, window, 3, weights), weights, top3)
            base = baseline_for(i)
            hit2 = sum(1 for p in pred2 if p in actual_t2)
            hit3 = sum(1 for p in pred3 if p in actual_t3)
            stats["tested"] += 1
            stats["tail2_hits"] += hit2
            stats["tail3_hits"] += hit3
            stats["tail2_rand"] += len(base["tail2"])
            stats["tail3_rand"] += len(base["tail3"])
            if hit2:
                stats["tail2_any"] += 1
            if hit3:
                stats["tail3_any"] += 1
        return _summarize_eval_stats(stats)

    results = []
    for cfg in configs:
        train_report = evaluate(cfg, train_indices)
        validation_report = evaluate(cfg, validation_indices)
        live_report = evaluate(cfg, live_indices)
        validation_live = evaluate(cfg, validation_indices + live_indices)
        stable = (
            validation_report["tail2"]["edge"] > 0 and
            live_report["tail2"]["edge"] > 0 and
            validation_report["tail3"]["edge"] >= 0 and
            live_report["tail3"]["edge"] >= 0
        )
        results.append({
            "name": cfg["name"],
            "config": _config(top2=top2, top3=top3, window=cfg["window"], weights=cfg["weights"]),
            "train": train_report,
            "validation": validation_report,
            "live": live_report,
            "validation_live": validation_live,
            "train_validation_gap": round(train_report["score"] - validation_report["score"], 3),
            "validation_live_gap": round(validation_report["score"] - live_report["score"], 3),
            "train_live_gap": round(train_report["score"] - live_report["score"], 3),
            "stable": stable,
            "recommendable": stable and live_report["score"] > 0 and validation_live["score"] > 0,
        })

    ranked = sorted(results, key=lambda x: (x["validation"]["score"], x["live"]["score"]), reverse=True)
    for rank, row in enumerate(ranked, start=1):
        row["rank"] = rank
    best_validation = ranked[0] if ranked else None
    best_live = max(results, key=lambda x: x["live"]["score"]) if results else None
    best_stable = next((r for r in ranked if r["stable"]), None)
    return {
        "n_draws": n_eval,
        "train_draws": train,
        "validation_draws": validation,
        "live_draws": live,
        "ranges": {
            "train": date_range(train_indices),
            "validation": date_range(validation_indices),
            "live": date_range(live_indices),
        },
        "top2": top2,
        "top3": top3,
        "configs_tested": len(configs),
        "selection_rule": "rank by validation score; use live window only as untouched audit",
        "score_formula": "tail2_edge + 2*tail3_edge",
        "best_validation": best_validation,
        "best_live": best_live,
        "best_stable": best_stable,
        "passed_for_decision_center": bool(best_stable and best_stable.get("recommendable")),
        "results": ranked,
    }
