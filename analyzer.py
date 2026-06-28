"""
วิเคราะห์สถิติหวยจาก DataFrame
"""
import pandas as pd
import numpy as np
from datetime import datetime, timedelta

# ── Constants ──────────────────────────────────────────────────────────────────
_OVERDUE_ALERT_MULTIPLIER = 2.5   # กี่เท่าของ expected gap ถึงแจ้งเตือน
_DIGITS = {"top2": 2, "bottom2": 2, "prize1": 6}  # default 3 for 3-digit types
_HOT_THRESHOLD = 1.2    # recent_rate > overall_rate * threshold → ร้อน
_COLD_THRESHOLD = 0.8   # recent_rate < overall_rate * threshold → เย็น


LOTTERY_TYPES = {
    "รางวัลที่ 1 (6 ตัว)": "prize1",
    "2 ตัวบน": "top2",
    "2 ตัวล่าง": "bottom2",
    "3 ตัวบน": "top3",
    "3 ตัวหน้า (ชุด 1)": "front3_1",
    "3 ตัวหน้า (ชุด 2)": "front3_2",
    "3 ตัวล่าง (ชุด 1)": "back3_1",
    "3 ตัวล่าง (ชุด 2)": "back3_2",
}

MONTH_TH = {
    1: "ม.ค.", 2: "ก.พ.", 3: "มี.ค.", 4: "เม.ย.",
    5: "พ.ค.", 6: "มิ.ย.", 7: "ก.ค.", 8: "ส.ค.",
    9: "ก.ย.", 10: "ต.ค.", 11: "พ.ย.", 12: "ธ.ค.",
}

WEEKDAYS = ["จันทร์", "อังคาร", "พุธ", "พฤหัสบดี", "ศุกร์", "เสาร์", "อาทิตย์"]

DAY_MAP = {0: "จันทร์", 1: "อังคาร", 2: "พุธ", 3: "พฤหัสบดี",
           4: "ศุกร์", 5: "เสาร์", 6: "อาทิตย์"}


def _col_digits(col: str) -> int:
    """Return digit width for a lottery column."""
    return _DIGITS.get(col, 3)


def _clean(s: pd.Series) -> pd.Series:
    """Normalise a lottery column to clean string values, dropping empties."""
    return s.astype(str).replace({"": pd.NA, "nan": pd.NA}).dropna()


def filter_df(df: pd.DataFrame, years=None, months=None, days_of_week=None, dates=None) -> pd.DataFrame:
    """กรองข้อมูลตาม filter ที่เลือก"""
    mask = pd.Series(True, index=df.index)
    if years:
        mask &= df["year"].between(years[0], years[1])
    if months:
        mask &= df["month"].isin(months)
    if days_of_week:
        mask &= df["weekday"].isin(days_of_week)
    if dates:
        mask &= df["day"].isin(dates)
    return df[mask].copy()


def freq_table(df: pd.DataFrame, col: str, top_n: int = None) -> pd.DataFrame:
    """ตารางความถี่ของเลขในคอลัมน์ที่กำหนด (O(n) via groupby)"""
    valid = df[[col, "date"]].copy()
    valid[col] = _clean(valid[col])
    valid = valid.dropna(subset=[col])
    if valid.empty:
        return pd.DataFrame(columns=["เลข", "จำนวนครั้ง", "ออกล่าสุด", "10 งวดล่าสุด"])

    grp = valid.groupby(col)["date"]
    counts = grp.count().rename("จำนวนครั้ง").reset_index().rename(columns={col: "เลข"})
    counts = counts.sort_values("จำนวนครั้ง", ascending=False).reset_index(drop=True)

    # O(n) groupby aggregations
    last_seen = grp.max().to_dict()
    # build last-10 dates per number: sort once, slice per group
    sorted_dates = valid.sort_values("date")
    last10_map = (
        sorted_dates.groupby(col)["date"]
        .apply(lambda s: ", ".join(s.dt.strftime("%d/%m/%y").tolist()[-10:]))
        .to_dict()
    )

    counts["ออกล่าสุด"] = counts["เลข"].map(last_seen)
    counts["10 งวดล่าสุด"] = counts["เลข"].map(last10_map)

    return counts.head(top_n) if top_n else counts


def hot_cold_numbers(df: pd.DataFrame, col: str, recent_months: int = 12) -> pd.DataFrame:
    """เปรียบเทียบ hot/cold: ความถี่ล่าสุด vs ทั้งหมด"""
    if df.empty:
        return pd.DataFrame()
    cutoff = df["date"].max() - pd.Timedelta(days=recent_months * 30)
    df_recent = df[df["date"] >= cutoff]

    all_freq = _clean(df[col]).value_counts()
    recent_freq = _clean(df_recent[col]).value_counts()

    result = pd.DataFrame({"เลข": all_freq.index, "ทั้งหมด": all_freq.values})
    result["ล่าสุด"] = result["เลข"].map(recent_freq).fillna(0).astype(int)
    n_all = max(len(df), 1)
    n_recent = max(len(df_recent), 1)
    result["เฉลี่ย/งวด (ทั้งหมด)"] = (result["ทั้งหมด"] / n_all).round(3)
    result["เฉลี่ย/งวด (ล่าสุด)"] = (result["ล่าสุด"] / n_recent).round(3)

    def _status(r):
        if r["เฉลี่ย/งวด (ล่าสุด)"] > r["เฉลี่ย/งวด (ทั้งหมด)"] * _HOT_THRESHOLD:
            return "🔥 ร้อน"
        if r["เฉลี่ย/งวด (ล่าสุด)"] < r["เฉลี่ย/งวด (ทั้งหมด)"] * _COLD_THRESHOLD:
            return "❄️ เย็น"
        return "➡️ ปกติ"

    result["สถานะ"] = result.apply(_status, axis=1)
    return result.sort_values("ทั้งหมด", ascending=False).reset_index(drop=True)


def heatmap_data(df: pd.DataFrame, col: str) -> pd.DataFrame:
    """สร้าง grid 10x10 สำหรับ heatmap เลข 00-99 (รองรับเฉพาะ 2-digit columns)"""
    if _col_digits(col) != 2:
        return pd.DataFrame()
    counts = df[col].dropna().replace("", pd.NA).dropna().value_counts()
    grid_rows = []
    for tens in range(10):
        row = {}
        for units in range(10):
            num = f"{tens}{units}"
            row[str(units)] = counts.get(num, 0)
        row["หลักสิบ"] = str(tens)
        grid_rows.append(row)
    result = pd.DataFrame(grid_rows).set_index("หลักสิบ")
    return result


def trend_data(df: pd.DataFrame, col: str, number: str) -> pd.DataFrame:
    """แนวโน้มการออกของเลขตามปี"""
    if df.empty:
        return pd.DataFrame(columns=["year", "ครั้ง"])
    sub = df[df[col] == number].copy()
    yearly = sub.groupby("year").size().reset_index(name="ครั้ง")
    all_years = pd.DataFrame({"year": range(int(df["year"].min()), int(df["year"].max()) + 1)})
    result = all_years.merge(yearly, on="year", how="left").fillna(0)
    result["ครั้ง"] = result["ครั้ง"].astype(int)
    return result


def never_appeared(df: pd.DataFrame, col: str) -> list[str]:
    """เลขที่ไม่เคยออกเลย (ไม่รองรับ prize1 — 10^6 ตัวเลข)"""
    if col == "prize1":
        return []
    appeared = set(_clean(df[col]).unique())
    digits = _col_digits(col)
    all_nums = set(f"{i:0{digits}d}" for i in range(10 ** digits))
    return sorted(all_nums - appeared)


def digit_frequency(df: pd.DataFrame, col: str) -> pd.DataFrame:
    """ความถี่แต่ละหลัก (สิบ หน่วย ร้อย)"""
    series = _clean(df[col])
    if series.empty:
        return pd.DataFrame(columns=["ตำแหน่ง", "เลข", "จำนวนครั้ง"])
    digits = len(series.iloc[0])
    position_names = ["หน่วย", "สิบ", "ร้อย", "พัน", "หมื่น", "แสน"]
    records = []
    for pos in range(digits):
        pos_name = position_names[pos] if pos < len(position_names) else f"หลักที่ {pos+1}"
        digit_counts = series.str[-(pos + 1)].value_counts().sort_index()
        for digit, count in digit_counts.items():
            records.append({"ตำแหน่ง": pos_name, "เลข": digit, "จำนวนครั้ง": count})
    return pd.DataFrame(records)


def overdue_numbers(df: pd.DataFrame, col: str, top_n: int = 20) -> pd.DataFrame:
    """เลขที่ค้างนาน (ไม่ออกมากี่งวดแล้ว)"""
    series = _clean(df[col]).reindex(df.index)
    digits = _col_digits(col)

    # prize1 มี 10^6 ตัวเลข — ไม่คุ้มวนทั้งหมด ใช้เฉพาะเลขที่เคยออก
    if digits >= 6:
        all_nums = sorted(series.dropna().unique().tolist())
    else:
        all_nums = [f"{i:0{digits}d}" for i in range(10 ** digits)]

    total_draws = len(df)
    df_sorted = df.sort_values("date").reset_index(drop=True)

    # สร้าง lookup: num → (last_idx, count) ใน O(n)
    last_idx_map: dict = {}
    count_map: dict = {}
    for idx, val in enumerate(df_sorted[col].astype(str).replace("nan", "").values):
        if val and val != "nan":
            last_idx_map[val] = idx
            count_map[val] = count_map.get(val, 0) + 1

    records = []
    for num in all_nums:
        if num not in last_idx_map:
            draws_since = total_draws
            last_date = None
            times = 0
        else:
            draws_since = total_draws - last_idx_map[num] - 1
            last_date = df_sorted["date"].iloc[last_idx_map[num]]
            times = count_map[num]
        records.append({
            "เลข": num,
            "ค้างกี่งวด": draws_since,
            "ออกล่าสุด": last_date,
            "ออกทั้งหมด": times,
        })

    result = pd.DataFrame(records).sort_values("ค้างกี่งวด", ascending=False).reset_index(drop=True)
    return result.head(top_n)


def next_thai_draw(from_date: datetime = None) -> list[dict]:
    """หางวดหวยถัดไป 6 งวด (หวยออกวันที่ 1 และ 16 ทุกเดือน)"""
    if from_date is None:
        from_date = datetime.now()
    draws = []
    d = from_date
    while len(draws) < 6:
        d = d + timedelta(days=1)
        if d.day in (1, 16):
            draws.append({
                "date": d,
                "day": d.day,
                "month": d.month,
                "year": d.year,
                "weekday": DAY_MAP.get(d.weekday(), ""),
                "label": f"{d.day} {MONTH_TH.get(d.month, str(d.month))} {d.year + 543}",
            })
    return draws


def predict_numbers(df: pd.DataFrame, col: str, target_date: datetime, top_n: int | None = 10) -> pd.DataFrame:
    """
    Multi-signal statistical prediction (8 independent components):

    1. วัน+เดือนเดียวกัน — Laplace-smoothed conditional freq
    2. วันที่เดียวกัน  — Laplace-smoothed
    3. เดือนเดียวกัน  — Laplace-smoothed
    4. วันในสัปดาห์  — Laplace-smoothed
    5. Recency-weighted overall freq (5yr×3 / 5-15yr×2 / older×1)
    6. Digit-position joint prob (tens × units for 2/3-digit cols)
    7. Geometric overdue: 1-(1-p)^k (memoryless model)
    8. Short-term momentum: 3m rate vs 12m rate
    """
    if df.empty:
        return pd.DataFrame()

    digits = _col_digits(col)
    n_cand = 10 ** digits if digits < 6 else 0
    α = 1  # Laplace pseudo-count per candidate

    # ── Pre-extract numpy arrays for fast boolean indexing ──
    df_sorted = df.sort_values("date").reset_index(drop=True)
    vals_np = df_sorted[col].astype(str).values          # numpy str array, no Arrow
    day_np  = df_sorted["day"].values
    mon_np  = df_sorted["month"].values
    wd_np   = df_sorted["weekday"].values
    yr_np   = df_sorted["year"].values
    date_np = df_sorted["date"].values.astype("datetime64[ns]")
    total_draws = len(df_sorted)

    target_day     = target_date.day
    target_month   = target_date.month
    target_weekday = DAY_MAP.get(target_date.weekday(), "")

    mask_dm  = (day_np == target_day) & (mon_np == target_month)
    mask_day = day_np == target_day
    mask_mon = mon_np == target_month
    mask_wd  = wd_np == target_weekday
    valid    = ~np.isin(vals_np, ("", "nan", "None", "NaN", "<NA>"))

    # ── Signal 1-4: Laplace-smoothed conditional frequencies via numpy ──
    def lp_np(mask: np.ndarray) -> dict:
        sub = vals_np[mask & valid]
        n = len(sub)
        if n == 0:
            return {}
        uniq, cnt = np.unique(sub, return_counts=True)
        denom = n + α * n_cand if n_cand else n + α * len(uniq)
        return {k: (c + α) / denom for k, c in zip(uniq, cnt)}

    sc_dm  = lp_np(mask_dm)
    sc_day = lp_np(mask_day)
    sc_mon = lp_np(mask_mon)
    sc_wd  = lp_np(mask_wd)

    # ── Signal 5: Recency-weighted overall frequency (3-tier, numpy) ──
    _yr = target_date.year
    m5  = valid & (yr_np >= _yr - 5)
    m15 = valid & (yr_np >= _yr - 15) & (yr_np < _yr - 5)
    m_old = valid & (yr_np < _yr - 15)
    w_sub = np.concatenate([
        np.repeat(vals_np[m5], 3),
        np.repeat(vals_np[m15], 2),
        vals_np[m_old],
    ])
    n_w = len(w_sub)
    if n_w:
        uniq_w, cnt_w = np.unique(w_sub, return_counts=True)
        denom_w = n_w + α * n_cand if n_cand else n_w + α * len(uniq_w)
        sc_overall: dict = {k: (c + α) / denom_w for k, c in zip(uniq_w, cnt_w)}
        α0 = α / denom_w
    else:
        sc_overall = {}
        α0 = 0.0

    # ── Signal 8: Momentum (3m vs 12m rate, numpy) ──
    max_date_np = date_np.max()
    cut_3m  = max_date_np - np.timedelta64(92, "D")
    cut_12m = max_date_np - np.timedelta64(366, "D")
    sub_3m  = vals_np[valid & (date_np >= cut_3m)]
    sub_12m = vals_np[valid & (date_np >= cut_12m)]
    n_3m, n_12m = max(len(sub_3m), 1), max(len(sub_12m), 1)
    if len(sub_3m):
        u3, c3 = np.unique(sub_3m, return_counts=True)
        freq_3m  = dict(zip(u3, c3))
    else:
        freq_3m = {}
    if len(sub_12m):
        u12, c12 = np.unique(sub_12m, return_counts=True)
        freq_12m = dict(zip(u12, c12))
    else:
        freq_12m = {}

    # ── Signal 6: Digit-position joint probability (2/3-digit only) ──
    _dp: dict[int, dict] = {}
    if digits <= 3 and mask_dm.any():
        dm_vals = vals_np[mask_dm & valid]
        n_dm_dp = len(dm_vals)
        if n_dm_dp >= 5:
            for pos in range(digits):
                ds = np.array([v[pos] if pos < len(v) else "0" for v in dm_vals])
                uniq_d, cnt_d = np.unique(ds, return_counts=True)
                denom_dp = n_dm_dp + 0.5 * 10
                freq_s = {k: (c + 0.5) / denom_dp for k, c in zip(uniq_d, cnt_d)}
                for d in "0123456789":
                    freq_s.setdefault(d, 0.5 / denom_dp)
                _dp[pos] = freq_s

    # ── Signal 9: Year-over-year consistency (distinct years appeared on D/M) ──
    # How many of the last 10 years did this number appear on this exact date?
    dm_years  = yr_np[mask_dm & valid]
    dm_nums   = vals_np[mask_dm & valid]
    all_dm_years = np.unique(dm_years) if len(dm_years) else np.array([])
    n_dm_years = max(len(all_dm_years), 1)
    yoy_count: dict[str, set] = {}
    for y, v in zip(dm_years, dm_nums):
        yoy_count.setdefault(v, set()).add(y)
    yoy_score: dict[str, float] = {k: (len(v) + 0.5) / (n_dm_years + 1.0)
                                   for k, v in yoy_count.items()}
    yoy_floor = 0.5 / (n_dm_years + 1.0)

    # ── Signal 10: Lag anti-correlation (last 5 draws penalty) ──
    recent5 = [v for v in vals_np[valid][-5:] if v not in ("", "nan")]
    # last-draw strong penalty, earlier draws light penalty
    lag_penalty: dict[str, float] = {}
    for lag_i, v in enumerate(reversed(recent5)):
        lag_penalty[v] = max(lag_penalty.get(v, 0.0), 1.0 - lag_i * 0.15)

    # ── Overdue lookup O(n) ──
    last_pos_map: dict[str, int] = {}
    for idx, v in enumerate(vals_np):
        if v and v not in ("", "nan", "None", "NaN", "<NA>"):
            last_pos_map[v] = idx

    all_nums: list[str] = ([f"{i:0{digits}d}" for i in range(n_cand)] if n_cand
                           else list(sc_overall.keys()))

    _EPS = 1e-9
    rows = []
    for num in all_nums:
        p1 = sc_dm.get(num, α0)
        p2 = sc_day.get(num, α0)
        p3 = sc_mon.get(num, α0)
        p4 = sc_wd.get(num, α0)
        p5 = sc_overall.get(num, α0)

        lp_idx  = last_pos_map.get(num, -1)
        overdue = total_draws - lp_idx - 1 if lp_idx >= 0 else total_draws
        geo = float(min(1.0 - (1.0 - p5) ** max(overdue, 1), 1.0)) if p5 > 0 else 0.0

        r3  = freq_3m.get(num, 0) / n_3m
        r12 = freq_12m.get(num, 0) / n_12m
        mom_norm = max(min((r3 - r12) / max(r12, 0.001), 3.0), -1.0) / 4.0 + 0.25

        if _dp and num:
            dp_joint = 1.0
            for pos, freq_s in _dp.items():
                dp_joint *= freq_s.get(num[pos] if pos < len(num) else "0", 0.0)
            uniform = 0.1 ** digits
            dp_norm = min(dp_joint / uniform, 4.0) / 4.0 if uniform > 0 else 0.25
        else:
            dp_norm = 0.25

        yoy = yoy_score.get(num, yoy_floor)
        lag_factor = 1.0 - lag_penalty.get(num, 0.0) * 0.35  # max 35% penalty for last draw

        # Weights: coordinate-descent optimized on 200-draw val set (generalize on held-out test)
        composite = (
            p2       * 0.18 +   # same day-of-month (more data, more robust than joint p1)
            p5       * 0.20 +   # recency-weighted overall
            yoy      * 0.16 +   # year-over-year consistency (distinct years appeared on D/M)
            p1       * 0.09 +   # joint day+month (sparse — kept low weight)
            p3       * 0.09 +   # same month
            p4       * 0.08 +   # same weekday
            dp_norm  * 0.10 +   # digit-position joint prob
            geo      * 0.06 +   # geometric overdue
            mom_norm * 0.04     # 3m vs 12m momentum
        ) * lag_factor          # weights sum to 1.00

        rows.append({
            "เลข":                  num,
            "คะแนนรวม":             round(composite * 1000, 2),
            "วัน+เดือนเดียวกัน":    int(p1 * int(mask_dm.sum())),
            "วันที่เดียวกัน":       int(p2 * int(mask_day.sum())),
            "เดือนเดียวกัน":        int(p3 * int(mask_mon.sum())),
            f"วัน{target_weekday}": int(p4 * int(mask_wd.sum())),
            "รวมทั้งหมด":           int(p5 * total_draws),
            "ค้างกี่งวด":           overdue,
            "momentum":             round((r3 - r12) * 100, 2),
        })

    result = pd.DataFrame(rows).sort_values("คะแนนรวม", ascending=False).reset_index(drop=True)
    result.index = range(1, len(result) + 1)
    return result.head(top_n) if top_n else result


# ─────────────────────────────────────────────────────────────────────────────
# predict_prize1_ultimate — shared helper functions (positional, pair, trigram)
# ─────────────────────────────────────────────────────────────────────────────

def _p1_pos_digit_scores(df_sorted: pd.DataFrame, valid: pd.Series,
                          target_date: datetime, alpha: float = 0.5) -> np.ndarray:
    """
    Returns shape (6, 10) — marginal score for each digit at each position.
    Combines: recency-weighted overall, D/M-conditional, YoY consistency.
    Fully vectorized: builds (N,6) int8 digit matrix once, then uses
    np.add.at for all frequency counts without Python per-digit loops.
    """
    n = len(valid)
    if n == 0:
        return np.ones((6, 10)) / 10.0

    vyr  = df_sorted.loc[valid.index, "year"].values
    vday = df_sorted.loc[valid.index, "day"].values
    vmon = df_sorted.loc[valid.index, "month"].values
    vdate = df_sorted.loc[valid.index, "date"].values.astype("datetime64[ns]")
    varr = valid.values

    td, tm = target_date.day, target_date.month
    mask_dm  = (vday == td) & (vmon == tm)
    mask_day = vday == td
    max_date = vdate.max()
    mask_rec = vdate >= (max_date - np.timedelta64(730, "D"))
    n_dm_yrs = max(int(np.unique(vyr[mask_dm]).size), 1)

    # Build (N, 6) digit matrix
    dmat = np.array(
        [[int(v[i]) if i < len(v) else 0 for i in range(6)] for v in varr],
        dtype=np.int8,
    )  # (N, 6)

    # Precompute scalar denominators
    w_all  = float(np.sum(mask_rec)) * 3.0 + float(np.sum(~mask_rec))
    n_dm   = int(mask_dm.sum())
    n_day  = int(mask_day.sum())

    scores = np.zeros((6, 10))

    for pos in range(6):
        col_d = dmat[:, pos]  # (N,) int8

        # --- Overall recency-weighted (vectorized over digits 0-9) ---
        cnt_rec = np.bincount(col_d[mask_rec],  minlength=10).astype(float)
        cnt_old = np.bincount(col_d[~mask_rec], minlength=10).astype(float)
        w_vec   = cnt_rec * 3.0 + cnt_old                         # (10,)
        s_overall = (w_vec + alpha) / (w_all + alpha * 10)

        # --- D/M conditional ---
        cnt_dm = np.bincount(col_d[mask_dm],  minlength=10).astype(float) if n_dm else np.zeros(10)
        s_dm   = (cnt_dm + alpha * 0.5) / (n_dm + alpha * 5)

        # --- Day-of-month conditional ---
        cnt_day = np.bincount(col_d[mask_day], minlength=10).astype(float) if n_day else np.zeros(10)
        s_day   = (cnt_day + alpha * 0.5) / (n_day + alpha * 5)

        # --- YoY: distinct years per digit on D/M draws ---
        s_yoy = np.full(10, alpha * 0.5 / (n_dm_yrs + alpha * 5))
        if n_dm:
            dm_digits = col_d[mask_dm]   # (n_dm,)
            dm_years  = vyr[mask_dm]     # (n_dm,)
            for di in range(10):
                n_yoy = int(np.unique(dm_years[dm_digits == di]).size)
                s_yoy[di] = (n_yoy + alpha * 0.5) / (n_dm_yrs + alpha * 5)

        scores[pos] = s_overall * 0.35 + s_dm * 0.35 + s_day * 0.15 + s_yoy * 0.15

    row_sums = scores.sum(axis=1, keepdims=True)
    return scores / np.maximum(row_sums, 1e-12)


def _p1_pair_matrix(valid: pd.Series, alpha: float = 0.3) -> np.ndarray:
    """
    Returns shape (5, 10, 10) — pair[pos][d_i][d_{i+1}] transition probability.
    Fully vectorized: parse all 6 digits at once with numpy, then np.add.at.
    """
    mat = np.full((5, 10, 10), alpha)
    arr = valid.values
    # Filter to exactly-6-char strings
    lengths = np.array([len(v) for v in arr])
    arr = arr[lengths == 6]
    if len(arr) == 0:
        return mat / mat.sum(axis=2, keepdims=True)
    # Parse digit matrix: (N, 6) int array
    try:
        digits = np.array([[int(v[i]) for i in range(6)] for v in arr], dtype=np.int8)
    except ValueError:
        # Fallback: filter out non-numeric rows
        rows = []
        for v in arr:
            try:
                rows.append([int(v[i]) for i in range(6)])
            except ValueError:
                pass
        if not rows:
            return mat / mat.sum(axis=2, keepdims=True)
        digits = np.array(rows, dtype=np.int8)
    # Vectorized accumulation
    for pos in range(5):
        np.add.at(mat[pos], (digits[:, pos], digits[:, pos + 1]), 1.0)
    row_sums = mat.sum(axis=2, keepdims=True)
    return mat / np.maximum(row_sums, 1e-12)


def _p1_digitsum_dist(valid: pd.Series, target_date: datetime,
                       df_sorted: pd.DataFrame) -> tuple[np.ndarray, np.ndarray]:
    """
    Returns (mean_ds, std_ds) from digit-sum distribution of historical prize1.
    Used to soft-penalise candidates with unusual digit sums.
    D/M draws weighted 3x, overall 1x. Fully vectorized.
    """
    vday = df_sorted.loc[valid.index, "day"].values
    vmon = df_sorted.loc[valid.index, "month"].values
    mask_dm = (vday == target_date.day) & (vmon == target_date.month)

    arr = valid.values
    # Build (N, 6) digit matrix, filter to valid 6-char strings
    lengths = np.array([len(v) for v in arr])
    ok = lengths == 6
    if not ok.any():
        return np.array([27.0]), np.array([7.0])

    try:
        dmat = np.array([[int(v[i]) for i in range(6)] for v in arr[ok]], dtype=np.int8)
    except ValueError:
        rows = []
        for v in arr[ok]:
            try:
                rows.append([int(v[i]) for i in range(6)])
            except ValueError:
                pass
        if not rows:
            return np.array([27.0]), np.array([7.0])
        dmat = np.array(rows, dtype=np.int8)

    sums_arr = dmat.sum(axis=1).astype(np.float64)   # (M,)
    w_arr    = np.where(mask_dm[ok], 3.0, 1.0)        # (M,)

    mean_ds = np.average(sums_arr, weights=w_arr)
    var_ds  = np.average((sums_arr - mean_ds) ** 2, weights=w_arr)
    std_ds  = max(float(np.sqrt(var_ds)), 3.0)  # floor at 3 to avoid over-filtering
    return mean_ds, std_ds


def _p1_hot_digit_scores(valid: pd.Series, n_recent: int = 20, alpha: float = 0.5) -> np.ndarray:
    """
    Returns (3, 10) array — short-term hot digit frequency for front3 positions.
    Uses only the last n_recent prize1 draws to capture recent trends.
    """
    scores = np.full((3, 10), alpha)
    arr = valid.values
    lengths = np.array([len(v) for v in arr])
    arr = arr[lengths == 6]
    recent = arr[-n_recent:] if len(arr) >= n_recent else arr
    if len(recent) == 0:
        return scores / scores.sum(axis=1, keepdims=True)
    try:
        digits = np.array([[int(v[i]) for i in range(3)] for v in recent], dtype=np.int8)
    except ValueError:
        rows = []
        for v in recent:
            try:
                rows.append([int(v[i]) for i in range(3)])
            except ValueError:
                pass
        if not rows:
            return scores / scores.sum(axis=1, keepdims=True)
        digits = np.array(rows, dtype=np.int8)
    for pos in range(3):
        np.add.at(scores[pos], digits[:, pos], 1.0)
    return scores / scores.sum(axis=1, keepdims=True)


def _p1_overdue_digit_scores(valid: pd.Series) -> np.ndarray:
    """
    Returns (3, 10) — geometric overdue probability for each digit at front3 positions.
    For position p and digit d: P = 1 - (1 - base_freq)^n_since_last_appearance.
    Captures "due" digits that haven't appeared recently at a given position.
    """
    arr = valid.values
    lengths = np.array([len(v) for v in arr])
    arr = arr[lengths == 6]
    scores = np.ones((3, 10)) * 0.1  # default low overdue
    if len(arr) == 0:
        return scores / scores.sum(axis=1, keepdims=True)
    try:
        digits = np.array([[int(v[i]) for i in range(3)] for v in arr], dtype=np.int8)
    except ValueError:
        rows = []
        for v in arr:
            try:
                rows.append([int(v[i]) for i in range(3)])
            except ValueError:
                pass
        if not rows:
            return scores / scores.sum(axis=1, keepdims=True)
        digits = np.array(rows, dtype=np.int8)
    n_total = len(digits)
    for pos in range(3):
        col = digits[:, pos]
        for d in range(10):
            base_freq = float(np.mean(col == d)) or 0.1
            # find last occurrence index
            occ = np.where(col == d)[0]
            n_since = n_total - occ[-1] - 1 if len(occ) > 0 else n_total
            scores[pos, d] = 1.0 - (1.0 - base_freq) ** n_since
    return scores / np.maximum(scores.sum(axis=1, keepdims=True), 1e-12)


def _p1_quadgram_seam(valid: pd.Series, alpha: float = 1.0) -> np.ndarray:
    """
    Returns (10,10,10,10) — P(d3 | d0, d1, d2) across the front3/back3 seam.
    Uses Laplace smoothing alpha=1.0 (higher than trigram because 10^4 cells is sparse).
    """
    mat = np.full((10, 10, 10, 10), alpha)
    arr = valid.values
    lengths = np.array([len(v) for v in arr])
    arr = arr[lengths == 6]
    if len(arr) == 0:
        return mat / mat.sum(axis=3, keepdims=True)
    try:
        digits = np.array([[int(v[i]) for i in range(6)] for v in arr], dtype=np.int8)
    except ValueError:
        rows = []
        for v in arr:
            try:
                rows.append([int(v[i]) for i in range(6)])
            except ValueError:
                pass
        if not rows:
            return mat / mat.sum(axis=3, keepdims=True)
        digits = np.array(rows, dtype=np.int8)
    # d0,d1,d2 → d3: positions 0,1,2 → 3
    np.add.at(mat, (digits[:, 0], digits[:, 1], digits[:, 2], digits[:, 3]), 1.0)
    return mat / np.maximum(mat.sum(axis=3, keepdims=True), 1e-12)


def _p1_trigram_matrix(valid: pd.Series, alpha: float = 0.5) -> np.ndarray:
    """
    shape (4, 10, 10, 10) — P(d_{i+2} | d_i, d_{i+1}), start positions 0-3.
    Fully vectorized via np.add.at on pre-parsed (N,6) digit matrix.
    """
    mat = np.full((4, 10, 10, 10), alpha)
    arr = valid.values
    lengths = np.array([len(v) for v in arr])
    arr = arr[lengths == 6]
    if len(arr) == 0:
        return mat / mat.sum(axis=3, keepdims=True)
    try:
        digits = np.array([[int(v[i]) for i in range(6)] for v in arr], dtype=np.int8)
    except ValueError:
        rows = []
        for v in arr:
            try:
                rows.append([int(v[i]) for i in range(6)])
            except ValueError:
                pass
        if not rows:
            return mat / mat.sum(axis=3, keepdims=True)
        digits = np.array(rows, dtype=np.int8)
    for p in range(4):
        np.add.at(mat[p], (digits[:, p], digits[:, p + 1], digits[:, p + 2]), 1.0)
    row_sums = mat.sum(axis=3, keepdims=True)
    return mat / np.maximum(row_sums, 1e-12)


def _beam_front3_v4(
    pos_scores_3: np.ndarray,    # (3, 10)
    pair_2: np.ndarray,          # (2, 10, 10)
    trigram_pos0: np.ndarray,    # (10, 10, 10) — pos 0: P(d2|d0,d1)
    beam_width: int,
    pair_w: float,
    trig_w: float,
    hot_scores: np.ndarray | None = None,  # (3, 10) short-term hot digit
    hot_w: float = 0.0,
) -> list[tuple[list[int], float]]:
    """
    Beam search positions 0-2.
    pos=2: trigram P(d2|d0,d1) + bigram + positional + optional hot_scores.
    hot_scores: last-20-draws per-position digit frequency; hot_w controls weight.
    """
    pos_w = max(1.0 - pair_w - trig_w - hot_w, 0.05)
    log_pos  = np.log(np.maximum(pos_scores_3, 1e-12))    # (3,10)
    log_pair = np.log(np.maximum(pair_2, 1e-12))           # (2,10,10)
    log_trig = np.log(np.maximum(trigram_pos0, 1e-12))     # (10,10,10)
    log_hot  = (np.log(np.maximum(hot_scores, 1e-12))
                if hot_scores is not None and hot_w > 0
                else None)                                  # (3,10) or None

    beams: list[tuple[list[int], float]] = [([], 0.0)]

    # Normalize per-position so each position contributes equally regardless
    # of how many signal types are available at that position.
    w0 = pos_w + hot_w                          # pos=0: positional + hot
    w1 = pos_w + pair_w + hot_w                 # pos=1: positional + bigram + hot
    w2 = pos_w + pair_w + trig_w + hot_w        # pos=2: all signals

    for pos in range(3):
        nxt: list[tuple[list[int], float]] = []
        lp = log_pos[pos]
        lh = log_hot[pos] if log_hot is not None else None
        for prefix, ls in beams:
            if pos == 0:
                for d in range(10):
                    s = pos_w * lp[d]
                    if lh is not None:
                        s += hot_w * lh[d]
                    nxt.append((prefix + [d], ls + s / w0))
            elif pos == 1:
                prev = prefix[-1]
                for d in range(10):
                    s = pos_w * lp[d] + pair_w * log_pair[0, prev, d]
                    if lh is not None:
                        s += hot_w * lh[d]
                    nxt.append((prefix + [d], ls + s / w1))
            else:  # pos == 2: trigram P(d2 | d0, d1)
                d0, d1 = prefix[0], prefix[1]
                for d in range(10):
                    s = (pos_w  * lp[d] +
                         pair_w * log_pair[1, d1, d] +
                         trig_w * log_trig[d0, d1, d])
                    if lh is not None:
                        s += hot_w * lh[d]
                    nxt.append((prefix + [d], ls + s / w2))
        nxt.sort(key=lambda x: x[1], reverse=True)
        beams = nxt[:beam_width]

    return beams



def predict_prize1_ultimate(
    df: pd.DataFrame,
    target_date: datetime,
    top_n: int = 20,
    beam_width: int = 300,
    k_back: int = 50,
) -> pd.DataFrame:
    """
    Ultimate Prize1 predictor — single optimized beam fusing all signals from v1-v4.

    Key design decisions vs v4:
    - Single beam (pos_w=0.35, pair_w=0.30, trig_w=0.35) instead of 3-config average
      → cleaner signal, wider beam compensates for reduced diversity
    - beam_width=300 (vs 200 in v4) for broader candidate coverage
    - Back3 weight 0.45 vs Front3 0.40 (back3 uses 10-signal predictor, higher quality)
    - Junction weight 0.15 (vs 0.10 in v4) — extended bigram+trigram cross-seam signal

    Signal pipeline:
      1. _p1_pos_digit_scores → (6,10) marginal per-position digit probability
         [recency-weighted overall × 0.35 + D/M conditional × 0.35 + day-of-month × 0.15 + YoY × 0.15]
      2. _p1_pair_matrix → (5,10,10) bigram transition probabilities (Laplace α=0.3)
      3. _p1_trigram_matrix → (4,10,10,10) trigram conditional probabilities (α=0.5)
      4. Back3 via predict_numbers("top3") — full 10-signal statistical predictor
      5. Beam search front3 (pos 0-2): pos×0.35 + pair×0.30 + trig×0.35 per step
      6. Cross-seam junction: 0.60×P(d3|d2) + 0.40×P(d3|d1,d2)
      7. Final score: 0.40×front_beam + 0.15×junction + 0.45×back3
      8. Digit-sum Gaussian penalty + lag penalty for last-2-draw numbers
    """
    import math

    if df.empty:
        return pd.DataFrame()

    df_sorted = df.sort_values("date").reset_index(drop=True)
    prize1_raw = df_sorted["prize1"].astype(str)
    valid = prize1_raw.where(
        (prize1_raw.str.len() == 6) &
        ~prize1_raw.isin(("", "nan", "None", "NaN", "<NA>"))
    ).dropna()

    if valid.empty:
        return pd.DataFrame()

    # ── Precompute all matrices (shared, computed once) ──
    pos_scores_6   = _p1_pos_digit_scores(df_sorted, valid, target_date)  # (6,10)
    pair_matrix_5  = _p1_pair_matrix(valid)                               # (5,10,10)
    trigram_4      = _p1_trigram_matrix(valid)                            # (4,10,10,10)
    quadgram_seam  = _p1_quadgram_seam(valid)                             # (10,10,10,10)
    hot_scores_3   = _p1_hot_digit_scores(valid, n_recent=20)             # (3,10) last-20 draws
    overdue_3      = _p1_overdue_digit_scores(valid)                      # (3,10) geometric overdue
    # Blend overdue into hot signal: 70% hot + 30% overdue → combined positional boost
    hot_combined_3 = 0.70 * hot_scores_3 + 0.30 * overdue_3
    hot_combined_3 = hot_combined_3 / np.maximum(hot_combined_3.sum(axis=1, keepdims=True), 1e-12)
    mean_ds, std_ds = _p1_digitsum_dist(valid, target_date, df_sorted)
    mean_ds, std_ds = float(mean_ds), float(std_ds)

    # ── Back3: full 10-signal top3 predictor + hot/overdue boost ──
    back_pred = predict_numbers(df, "top3", target_date, top_n=None)
    if back_pred is None or back_pred.empty:
        return pd.DataFrame()
    back_max = float(back_pred["คะแนนรวม"].max()) or 1.0
    _bk = back_pred["เลข"].astype(str).str.zfill(3)
    _bv = back_pred["คะแนนรวม"].astype(float) / back_max

    # Build hot/overdue signal for back3 from recent top3 prize1 digits (pos 3-5)
    hot_b3  = _p1_hot_digit_scores(valid, n_recent=20)[0]   # reuse pos0 won't work — need separate
    # Compute explicitly from prize1 back3 (pos 3,4,5)
    arr_b3 = valid.values
    arr_b3 = arr_b3[np.array([len(v) for v in arr_b3]) == 6]
    recent_b3 = arr_b3[-20:] if len(arr_b3) >= 20 else arr_b3
    hot_back3_counts: dict[str, float] = {}
    for v in recent_b3:
        s = v[3:]
        hot_back3_counts[s] = hot_back3_counts.get(s, 0) + 1
    hot_back3_max = max(hot_back3_counts.values(), default=1)

    # Blend: 85% statistical + 15% hot-back3 recency
    back_scores_norm: dict[str, float] = {}
    for num, stat_score in zip(_bk, _bv):
        hot_score = hot_back3_counts.get(num, 0) / hot_back3_max
        back_scores_norm[num] = 0.92 * stat_score + 0.08 * hot_score
    back_top = sorted(back_scores_norm, key=back_scores_norm.get, reverse=True)[:k_back]

    # ── Single optimized beam search (front3 positions 0-2) ──
    # Weights: pos=0.25, pair=0.28, trig=0.32, hot=0.15 (all sum to 1.0)
    beams = _beam_front3_v4(
        pos_scores_6[:3], pair_matrix_5[:2], trigram_4[0],
        beam_width=beam_width,
        pair_w=0.28, trig_w=0.32,
        hot_scores=hot_combined_3, hot_w=0.15,
    )

    if not beams:
        return pd.DataFrame()

    f_min = beams[-1][1]
    f_max = beams[0][1]
    f_rng = f_max - f_min if f_max > f_min else 1.0

    # ── Extended junction: bigram + trigram + quadgram across front3/back3 seam ──
    pair_junc = pair_matrix_5[2]   # (10,10)    — P(d3|d2)
    trig_junc = trigram_4[1]       # (10,10,10) — P(d3|d1,d2)
    # quadgram_seam                # (10,10,10,10) — P(d3|d0,d1,d2)

    # ── Lag penalty for last 2 draws ──
    last_draws = {
        v for v in (
            prize1_raw.iloc[-1] if len(df_sorted) >= 1 else "",
            prize1_raw.iloc[-2] if len(df_sorted) >= 2 else "",
        )
        if v and v not in ("", "nan")
    }

    # ── Cross-product front3 × back3 ──
    rows = []
    seen: set[str] = set()

    for front_digits, front_ls in beams:
        f_str = "".join(map(str, front_digits))
        front_norm = (front_ls - f_min) / f_rng
        try:
            d0_f = int(f_str[0])
            d1_f = int(f_str[1])
            d2_f = int(f_str[2])
        except (ValueError, IndexError):
            continue

        for b_str in back_top:
            cand = f_str + b_str
            if cand in seen or len(cand) != 6:
                continue
            seen.add(cand)
            try:
                d3_b = int(b_str[0])
            except (ValueError, IndexError):
                continue

            b_norm = back_scores_norm.get(b_str, 0.0)

            # Junction: 40% bigram + 35% trigram + 25% quadgram (uses full front3 context)
            junction = (0.40 * float(pair_junc[d2_f, d3_b]) +
                        0.35 * float(trig_junc[d1_f, d2_f, d3_b]) +
                        0.25 * float(quadgram_seam[d0_f, d1_f, d2_f, d3_b]))

            # Weighted score: back3 slightly dominant over front3
            raw = 0.40 * front_norm + 0.15 * junction + 0.45 * b_norm

            # Digit-sum Gaussian soft penalty (floor sigma at 2.5)
            ds = sum(int(c) for c in cand)
            z = abs(ds - mean_ds) / std_ds
            ds_f = math.exp(-0.5 * min(z / 2.5, 3.0) ** 2)

            lag = 0.55 if cand in last_draws else 1.0

            rows.append({
                "เลข":        cand,
                "หน้า 3":    f_str,
                "หลัง 3":    b_str,
                "Digit Sum":  ds,
                "Front Beam": round(front_norm, 4),
                "Back Top3":  round(b_norm, 4),
                "Junction":   round(junction, 4),
                "คะแนนรวม":   round(raw * ds_f * lag * 100.0, 2),
            })

    if not rows:
        return pd.DataFrame()

    res = pd.DataFrame(rows).sort_values("คะแนนรวม", ascending=False)
    res.index = range(1, len(res) + 1)
    return res.head(top_n)


def prize1_backtest(
    df: pd.DataFrame,
    n_draws: int = 50,
    top_n: int = 20,
    beam_width: int = 500,
    k_back: int = 100,
) -> dict:
    """
    Out-of-sample backtest for predict_prize1_ultimate — decomposed metrics.

    Reports front3 hit rate, back3 hit rate, and combined hit rate separately.
    Decomposed metrics are more meaningful because:
      - combined prize1 hit needs both halves right simultaneously (1/1M space)
      - front3 or back3 alone have meaningful lift signal in ~100 draws
    """
    df_sorted = df.sort_values("date").reset_index(drop=True)
    prize1_raw = df_sorted["prize1"].astype(str)
    valid_mask = (prize1_raw.str.len() == 6) & ~prize1_raw.isin(("", "nan", "None", "NaN"))
    valid_idx = [i for i in df_sorted[valid_mask].index.tolist() if i >= 80]
    test_idx = valid_idx[-min(n_draws, len(valid_idx)):]

    n_tested = len(test_idx)
    hits_combined = 0
    hits_front3 = 0
    hits_back3 = 0
    errors = 0
    unique_front3_counts: list[int] = []
    unique_back3_counts: list[int] = []

    for idx in test_idx:
        actual = prize1_raw.iloc[idx]
        actual_front = actual[:3]
        actual_back = actual[3:]
        df_train = df_sorted.iloc[:idx]
        td = df_sorted["date"].iloc[idx]
        try:
            pred = predict_prize1_ultimate(
                df_train, td, top_n=top_n, beam_width=beam_width, k_back=k_back
            )
            if pred.empty:
                continue
            uniq_f = pred["หน้า 3"].nunique()
            uniq_b = pred["หลัง 3"].nunique()
            unique_front3_counts.append(uniq_f)
            unique_back3_counts.append(uniq_b)
            if actual in pred["เลข"].values:
                hits_combined += 1
            if actual_front in pred["หน้า 3"].values:
                hits_front3 += 1
            if actual_back in pred["หลัง 3"].values:
                hits_back3 += 1
        except Exception as exc:
            if errors == 0:
                print("[backtest] first error at draw " + str(idx) + ": " + str(exc))
            errors += 1

    n = n_tested or 1
    front3_rate = hits_front3 / n
    back3_rate = hits_back3 / n
    combined_rate = hits_combined / n

    # Random baselines use avg unique candidates (tracked per draw)
    avg_unique_front3 = sum(unique_front3_counts) / len(unique_front3_counts) if unique_front3_counts else top_n
    avg_unique_back3  = sum(unique_back3_counts)  / len(unique_back3_counts)  if unique_back3_counts  else top_n
    front3_random  = avg_unique_front3 / 1_000
    back3_random   = avg_unique_back3  / 1_000
    combined_random = top_n / 1_000_000

    return {
        "n_tested":            n_tested,
        "top_n":               top_n,
        "beam_width":          beam_width,
        "k_back":              k_back,
        # Combined 6-digit
        "hits":                hits_combined,
        "rate":                combined_rate,
        "random_rate":         combined_random,
        "lift":                combined_rate / combined_random if combined_random else 0.0,
        # Front3 (pos 0-2) — unique front3 values in top_n predictions
        "front3_hits":         hits_front3,
        "front3_rate":         front3_rate,
        "front3_random":       front3_random,
        "front3_lift":         front3_rate / front3_random if front3_random else 0.0,
        "avg_unique_front3":   round(avg_unique_front3, 1),
        # Back3 (pos 3-5) — unique back3 values in top_n predictions
        "back3_hits":          hits_back3,
        "back3_rate":          back3_rate,
        "back3_random":        back3_random,
        "back3_lift":          back3_rate / back3_random if back3_random else 0.0,
        "avg_unique_back3":    round(avg_unique_back3, 1),
        "algorithm":           "ultimate",
        "errors":              errors,
    }


def prize1_digit_analysis(df: pd.DataFrame, target_date: datetime) -> pd.DataFrame:
    """
    Per-position digit frequency table for prize1 (6 positions × 10 digits).

    Returns DataFrame with columns:
      ตำแหน่ง, เลข (0-9), ครั้งในประวัติ, ครั้งวัน/เดือนนี้, hot (bool)

    Useful for users who want to construct prize1 candidates manually.
    """
    if df.empty:
        return pd.DataFrame()

    prize1_raw = df.sort_values("date")["prize1"].astype(str)
    valid = prize1_raw.where(
        (prize1_raw.str.len() == 6) & ~prize1_raw.isin(("", "nan"))
    ).dropna()
    if valid.empty:
        return pd.DataFrame()

    df_s = df.sort_values("date")
    vday = df_s.loc[valid.index, "day"].values
    vmon = df_s.loc[valid.index, "month"].values
    vyr  = df_s.loc[valid.index, "year"].values
    vdate= df_s.loc[valid.index, "date"].values.astype("datetime64[ns]")
    mask_dm = (vday == target_date.day) & (vmon == target_date.month)

    α = 0.5
    n_dm  = int(mask_dm.sum())
    n_all = len(valid)
    max_date = vdate.max()
    cut_12m = max_date - np.timedelta64(366, "D")
    mask_rec = vdate >= cut_12m

    pos_names = ["แสน (ตัวที่ 1)", "หมื่น (ตัวที่ 2)", "พัน (ตัวที่ 3)",
                 "ร้อย (ตัวที่ 4)", "สิบ (ตัวที่ 5)", "หน่วย (ตัวที่ 6)"]

    # Build (N, 6) digit matrix once — avoids 6 separate per-position list comprehensions
    varr = valid.values
    try:
        dmat = np.array([[int(v[i]) for i in range(6)] for v in varr], dtype=np.int8)
    except ValueError:
        good = []
        for v in varr:
            try:
                good.append([int(v[i]) for i in range(6)])
            except ValueError:
                pass
        if not good:
            return pd.DataFrame()
        dmat = np.array(good, dtype=np.int8)
        # rebuild masks to match filtered rows (fallback path, rare)
        mask_dm  = mask_dm[:len(dmat)]
        mask_rec = mask_rec[:len(dmat)]

    expected_dm = n_dm / 10.0
    rows = []
    for pos in range(6):
        col_d    = dmat[:, pos]                          # (N,) int8
        cnt_all  = np.bincount(col_d, minlength=10)      # (10,) all draws
        cnt_dm   = np.bincount(col_d[mask_dm],  minlength=10) if n_dm  else np.zeros(10, int)
        cnt_rec  = np.bincount(col_d[mask_rec], minlength=10) if mask_rec.any() else np.zeros(10, int)

        for k in range(10):
            hot = cnt_dm[k] > expected_dm * 1.3
            rows.append({
                "ตำแหน่ง":               pos_names[pos],
                "pos":                    pos,
                "เลข":                    str(k),
                "ออกทั้งหมด":             int(cnt_all[k]),
                "% ทั้งหมด":              round(int(cnt_all[k]) / max(n_all, 1) * 100, 1),
                "ออกงวดนี้ (วัน/เดือน)":  int(cnt_dm[k]),
                "ออกล่าสุด 12 เดือน":     int(cnt_rec[k]),
                "สถานะ":                  "🔥 ร้อน" if hot else ("❄️ เย็น" if cnt_dm[k] == 0 else "➡️ ปกติ"),
            })

    return pd.DataFrame(rows)


def alert_engine(df: pd.DataFrame, col: str) -> list[dict]:
    """
    ตรวจสถานการณ์น่าสนใจ:
    - เลขที่ค้างมากกว่า threshold
    - เลขที่ออกงวดล่าสุด
    - เลขที่ออกติดต่อกัน 2+ งวด
    - เลขที่ความถี่เดือนนี้สูงผิดปกติ
    """
    alerts = []
    df_sorted = df.sort_values("date").reset_index(drop=True)
    series = df_sorted[col].astype(str).replace("", pd.NA).replace("nan", pd.NA)
    total = len(df_sorted)
    if total == 0:
        return alerts

    digits = _col_digits(col)
    if digits >= 6:
        return alerts

    all_nums = [f"{i:0{digits}d}" for i in range(10**digits)]

    # precompute last positions
    last_pos: dict = {}
    count_map: dict = {}
    for i, v in enumerate(series):
        if pd.notna(v):
            last_pos[str(v)] = i
            count_map[str(v)] = count_map.get(str(v), 0) + 1

    # last 2 draws
    last1 = str(series.iloc[-1]) if pd.notna(series.iloc[-1]) else None
    last2 = str(series.iloc[-2]) if len(series) >= 2 and pd.notna(series.iloc[-2]) else None

    # Overall mean rate
    base_rate = 1.0 / max(len(all_nums), 1)

    for num in all_nums:
        lp = last_pos.get(num, -1)
        overdue = total - lp - 1 if lp >= 0 else total
        count = count_map.get(num, 0)
        rate = count / total

        # เลขที่ออกงวดล่าสุด
        if num == last1:
            alerts.append({"เลข": num, "ระดับ": "ℹ️", "ข้อความ": f"ออกงวดล่าสุด ({df_sorted['date'].iloc[-1].strftime('%d/%m/%Y')})"})

        # เลขที่ออกติดต่อ 2 งวด
        if num == last1 and num == last2:
            alerts.append({"เลข": num, "ระดับ": "🔥", "ข้อความ": "ออกติดต่อกัน 2 งวด!"})

        # เลขค้างนานมาก (> _OVERDUE_ALERT_MULTIPLIER × expected gap)
        expected_gap = 1 / rate if rate > 0 else total
        if overdue > expected_gap * _OVERDUE_ALERT_MULTIPLIER and count >= 3:
            alerts.append({"เลข": num, "ระดับ": "⚠️", "ข้อความ": f"ค้างนาน {overdue} งวด (คาดเฉลี่ย {expected_gap:.0f} งวด)"})

    # sort: hot first, then overdue
    level_order = {"🔥": 0, "⚠️": 1, "ℹ️": 2}
    alerts.sort(key=lambda a: level_order.get(a["ระดับ"], 9))
    return alerts[:20]


def number_network_data(df: pd.DataFrame, col1: str, col2: str, min_weight: int = 2) -> tuple:
    """
    Build network graph data: nodes + edges for plotly.
    Edge (a→b): a appeared in col1 and b appeared in col2 in same draw, min_weight times.
    Returns (nodes_df, edges_df).
    """
    merged = pd.DataFrame({"a": df[col1], "b": df[col2]}).dropna()
    merged["a"] = merged["a"].astype(str).replace("nan", "")
    merged["b"] = merged["b"].astype(str).replace("nan", "")
    merged = merged[(merged["a"] != "") & (merged["b"] != "")]

    if merged.empty:
        return pd.DataFrame(), pd.DataFrame()

    edges = merged.groupby(["a", "b"]).size().reset_index(name="weight")
    edges = edges[edges["weight"] >= min_weight]

    # node positions: use frequency as size
    freq1 = df[col1].value_counts()
    freq2 = df[col2].value_counts()

    nodes_a = pd.DataFrame({"node": freq1.index, "freq": freq1.values, "type": col1})
    nodes_b = pd.DataFrame({"node": freq2.index, "freq": freq2.values, "type": col2})
    nodes = pd.concat([nodes_a, nodes_b]).drop_duplicates("node").reset_index(drop=True)

    return nodes, edges


def pair_analysis(df: pd.DataFrame, col1: str, col2: str, query_num: str, top_n: int = 10) -> pd.DataFrame:
    """เมื่อ col1 ออกเลข query_num แล้ว col2 มักเป็นอะไร"""
    mask = df[col1].astype(str).replace("nan", "") == query_num
    sub = df[mask][col2].astype(str).replace("", pd.NA).replace("nan", pd.NA).dropna()
    if sub.empty:
        return pd.DataFrame(columns=["เลข", "จำนวนครั้ง", "เปอร์เซ็นต์"])
    counts = sub.value_counts().head(top_n).reset_index()
    counts.columns = ["เลข", "จำนวนครั้ง"]
    counts["เปอร์เซ็นต์"] = (counts["จำนวนครั้ง"] / len(sub) * 100).round(1)
    return counts


def consecutive_pattern(df: pd.DataFrame, col: str, query_num: str = None, top_n: int = 10) -> pd.DataFrame:
    """lag-1: งวดก่อนออก query_num → งวดถัดมามักออกอะไร
    ถ้าไม่ระบุ query_num: คืน top pairs ทั้งหมด
    """
    df_sorted = df.sort_values("date").reset_index(drop=True)
    series = df_sorted[col].astype(str).replace("", pd.NA).replace("nan", pd.NA)
    pairs = pd.DataFrame({"prev": series.shift(1), "curr": series}).dropna()

    if query_num:
        pairs = pairs[pairs["prev"] == query_num]
        if pairs.empty:
            return pd.DataFrame(columns=["เลขตามมา", "จำนวนครั้ง", "เปอร์เซ็นต์"])
        counts = pairs["curr"].value_counts().head(top_n).reset_index()
        counts.columns = ["เลขตามมา", "จำนวนครั้ง"]
        counts["เปอร์เซ็นต์"] = (counts["จำนวนครั้ง"] / len(pairs) * 100).round(1)
        return counts
    else:
        pairs["pair"] = pairs["prev"] + "→" + pairs["curr"]
        top = pairs["pair"].value_counts().head(top_n).reset_index()
        top.columns = ["คู่เลข (ก่อน→ตาม)", "จำนวนครั้ง"]
        top["เปอร์เซ็นต์"] = (top["จำนวนครั้ง"] / len(pairs) * 100).round(2)
        return top


def decade_comparison(df: pd.DataFrame, col: str, top_n: int = 15) -> pd.DataFrame:
    """เปรียบ top numbers ระหว่าง 3 ช่วงเวลา"""
    end_year = df["year"].max() if not df.empty else datetime.now().year
    bins = [(1994, 2004), (2005, 2014), (2015, end_year)]
    freq_by_era: dict = {}
    for start, end in bins:
        label = f"{start}–{end}"
        sub = df[(df["year"] >= start) & (df["year"] <= end)]
        counts = sub[col].astype(str).replace("", pd.NA).replace("nan", pd.NA).dropna().value_counts()
        freq_by_era[label] = counts

    # รวม top_n จากทุก era
    all_nums: set = set()
    for counts in freq_by_era.values():
        all_nums.update(counts.index[:top_n])

    rows = []
    for num in all_nums:
        row = {"เลข": num}
        for label, counts in freq_by_era.items():
            row[label] = int(counts.get(num, 0))
        rows.append(row)

    df_result = pd.DataFrame(rows)
    labels = [f"{s}–{e}" for s, e in bins]
    df_result["รวม"] = df_result[labels].sum(axis=1)
    return df_result.sort_values("รวม", ascending=False).reset_index(drop=True).head(top_n * 2)


def number_profile(df: pd.DataFrame, col: str, number: str) -> dict:
    """สรุปสถิติของเลขตัวเดียว — ใช้สำหรับ comparison mode"""
    series = df[col].astype(str).replace("", pd.NA).replace("nan", pd.NA).dropna()
    total = len(series)
    count = (series == number).sum()
    sub = df[df[col].astype(str).replace("nan", "") == number]

    month_freq = sub["month"].value_counts().to_dict() if not sub.empty else {}
    weekday_freq = sub["weekday"].value_counts().to_dict() if not sub.empty else {}

    # streak: กี่งวดแล้วที่ไม่ออก (vectorized)
    df_sorted = df.sort_values("date").reset_index(drop=True)
    matches = df_sorted[col].astype(str).replace("nan", "") == number
    last_idx = int(matches[matches].index[-1]) if matches.any() else -1
    overdue = len(df_sorted) - last_idx - 1 if last_idx >= 0 else len(df_sorted)
    last_date = df_sorted["date"].iloc[last_idx] if last_idx >= 0 else None

    return {
        "count": int(count),
        "total": total,
        "rate": round(count / total * 100, 2) if total else 0,
        "last_date": last_date,
        "overdue": overdue,
        "month_freq": month_freq,
        "weekday_freq": weekday_freq,
    }


def predict_with_reasons(df: pd.DataFrame, col: str, target_date: datetime, top_n: int = 10) -> pd.DataFrame:
    """predict_numbers + คอลัมน์เหตุผลภาษาไทย"""
    pred = predict_numbers(df, col, target_date, top_n=top_n)
    total_draws = len(df)
    reasons = []
    badges = []
    for _, row in pred.iterrows():
        r: list[str] = []
        same_dm = row.get("วัน+เดือนเดียวกัน", 0)
        same_d  = row.get("วันที่เดียวกัน", 0)
        same_m  = row.get("เดือนเดียวกัน", 0)
        overdue = row.get("ค้างกี่งวด", 0)
        total   = row.get("รวมทั้งหมด", 0)

        if same_dm >= 3:
            r.append(f"ออกงวดนี้มาแล้ว {int(same_dm)} ครั้ง")
        elif same_dm >= 1:
            r.append(f"เคยออกงวดนี้ {int(same_dm)} ครั้ง")
        if same_d >= 5:
            r.append(f"ออกวันที่นี้บ่อย ({int(same_d)} ครั้ง)")
        if same_m >= 8:
            r.append(f"ออกเดือนนี้บ่อย ({int(same_m)} ครั้ง)")
        if overdue >= 40:
            r.append(f"ค้างนานมาก {int(overdue)} งวด")
        elif overdue >= 20:
            r.append(f"ค้าง {int(overdue)} งวด")
        if total >= 25:
            r.append(f"เลขยอดนิยม ({int(total)} ครั้ง)")

        rate = total / max(total_draws, 1)
        badge = "🔥" if rate > 0.04 else ("❄️" if rate < 0.01 else "")
        badges.append(badge)
        reasons.append(" · ".join(r) if r else "คะแนนรวมสูง")

    pred["สถานะ"] = badges
    pred["เหตุผล"] = reasons
    return pred


def prediction_confidence(df: pd.DataFrame, col: str, target_date: datetime) -> dict:
    """ประเมินความมั่นใจของการทำนายจาก sample size"""
    mask_dm = (df["day"] == target_date.day) & (df["month"] == target_date.month)
    mask_d = df["day"] == target_date.day
    mask_m = df["month"] == target_date.month
    n_dm = int(mask_dm.sum())
    n_d = int(mask_d.sum())
    n_m = int(mask_m.sum())

    if n_dm >= 20:
        label, color, pct, level = "สูง", "#54a24b", min(90, 50 + n_dm), "HIGH"
    elif n_dm >= 10:
        label, color, pct, level = "ปานกลาง", "#f5e642", min(70, 30 + n_dm * 2), "MEDIUM"
    else:
        label, color, pct, level = "ต่ำ", "#ff6b35", min(45, 10 + n_dm * 3), "LOW"

    score = min(pct / 100.0, 1.0)  # normalized [0,1]
    reason = (
        f"งวดวันที่+เดือนนี้ {n_dm} งวด, วันที่นี้ {n_d} งวด, เดือนนี้ {n_m} งวด"
    )

    return {
        "n_same_day_month": n_dm,
        "n_same_day": n_d,
        "n_same_month": n_m,
        "label": label,
        "color": color,
        "pct": pct,
        "score": score,
        "level": level,
        "reason": reason,
    }


def ensemble_predict(
    df: pd.DataFrame,
    col: str,
    target_date: datetime,
    ml_df: pd.DataFrame | None = None,
    top_n: int = 10,
    ml_weight: float = 0.55,
) -> pd.DataFrame:
    """รวม statistical + ML prediction เป็น ensemble ranking.

    ถ้า ml_df ว่าง: ใช้ statistical 100%.
    ถ้า ml_df มีข้อมูล: ml_weight*ML + (1-ml_weight)*stat
    """
    stat_full = predict_numbers(df, col, target_date, top_n=None)
    if stat_full.empty:
        return pd.DataFrame()

    s_max = stat_full["คะแนนรวม"].max()
    stat_norm = (stat_full.set_index("เลข")["คะแนนรวม"] / s_max if s_max > 0
                 else stat_full.set_index("เลข")["คะแนนรวม"]).to_dict()

    if ml_df is not None and not ml_df.empty and "ML Score" in ml_df.columns:
        ml_max = ml_df["ML Score"].max()
        ml_norm = (ml_df.set_index("เลข")["ML Score"] / ml_max if ml_max > 0
                   else ml_df.set_index("เลข")["ML Score"]).to_dict()

        all_nums = sorted(set(stat_norm) | set(ml_norm))
        rows = []
        for num in all_nums:
            s = stat_norm.get(num, 0.0)
            m = ml_norm.get(num, 0.0)
            combined = ml_weight * m + (1.0 - ml_weight) * s
            rows.append({
                "เลข": num,
                "คะแนนรวม": round(combined * 100, 2),
                "สถิติ (%)": round(s * 100, 1),
                "ML (%)": round(m * 100, 1),
                "แหล่ง": "🤝 ทั้งคู่" if (s > 0.3 and m > 0.3) else ("🤖 ML" if m > s else "📊 สถิติ"),
            })
        result = pd.DataFrame(rows).sort_values("คะแนนรวม", ascending=False).head(top_n)
    else:
        normed = (stat_full["คะแนนรวม"] / s_max * 100).round(2) if s_max else stat_full["คะแนนรวม"]
        result = stat_full[["เลข"]].copy()
        result["คะแนนรวม"] = normed.values
        result = result.head(top_n)
        result["สถิติ (%)"] = result["คะแนนรวม"]
        result["ML (%)"] = 0.0
        result["แหล่ง"] = "📊 สถิติ"

    result = result.reset_index(drop=True)
    result.index = range(1, len(result) + 1)
    return result


def overdue_with_prob(df: pd.DataFrame, col: str, top_n: int = 20) -> pd.DataFrame:
    """overdue_numbers + คอลัมน์ความน่าจะเป็น (geometric model)"""
    od = overdue_numbers(df, col, top_n=top_n)
    total = len(df)
    if total == 0:
        od["โอกาสออก (%)"] = 0.0
        return od

    prob_col = []
    for _, row in od.iterrows():
        times = row["ออกทั้งหมด"]
        base_p = times / total if times > 0 else 0.0
        overdue_draws = row["ค้างกี่งวด"]
        # geometric: probability overdue_draws หรือนานกว่า → ยิ่งค้างนาน ยิ่ง "ถึงเวลา"
        # แต่หวยเป็น memoryless จริงๆ เราแสดง expected wait vs actual wait
        expected_gap = (1 / base_p) if base_p > 0 else 9999
        score = min((overdue_draws / expected_gap) * base_p * 100, 99.9) if base_p > 0 else 0.0
        prob_col.append(round(score, 2))

    od["โอกาสออก (%)"] = prob_col
    return od


def ticket_analysis(df: pd.DataFrame, col: str, numbers: list[str]) -> pd.DataFrame:
    """วิเคราะห์กลุ่มเลขที่ผู้ใช้เลือก"""
    records = []
    total = len(df)
    for num in numbers:
        prof = number_profile(df, col, num)
        records.append({
            "เลข": num,
            "ออกทั้งหมด": prof["count"],
            "อัตรา (%)": prof["rate"],
            "ค้างกี่งวด": prof["overdue"],
            "ออกล่าสุด": prof["last_date"].strftime("%d/%m/%Y") if prof["last_date"] else "ไม่เคยออก",
            "สถานะ": "🔥 ร้อน" if prof["rate"] > 2.0 else ("❄️ เย็น" if prof["rate"] < 0.8 else "➡️ ปกติ"),
        })
    return pd.DataFrame(records)


def summary_stats(df: pd.DataFrame, col: str) -> dict:
    """สรุปสถิติรวม"""
    series = df[col].astype(str).replace("", pd.NA).replace("nan", pd.NA).dropna()
    counts = series.value_counts()
    return {
        "total_draws": len(df),
        "total_numbers": len(series),
        "unique_numbers": len(counts),
        "most_frequent": counts.index[0] if not counts.empty else "-",
        "most_frequent_count": int(counts.iloc[0]) if not counts.empty else 0,
        "least_frequent": counts.index[-1] if not counts.empty else "-",
        "least_frequent_count": int(counts.iloc[-1]) if not counts.empty else 0,
    }
