"""
ML-based prediction engine for Thai lottery.
Uses GradientBoosting trained on historical draw features.

Performance notes:
- Positions stored as numpy int32 arrays for vectorized feature extraction.
- Cumulative month/day counts precomputed once → O(1) per lookup instead of O(n).
- Model cached to disk; retrained only when row count changes.
"""
import numpy as np
import pandas as pd
import pickle
from pathlib import Path
from datetime import datetime

try:
    from sklearn.ensemble import GradientBoostingClassifier
    SKLEARN_OK = True
except ImportError:
    SKLEARN_OK = False

MODEL_DIR = Path(__file__).parent / ".ml_cache"
MODEL_DIR.mkdir(exist_ok=True)

_WEEKDAY_MAP = {
    "จันทร์": 0, "อังคาร": 1, "พุธ": 2,
    "พฤหัสบดี": 3, "ศุกร์": 4, "เสาร์": 5, "อาทิตย์": 6,
}
_DAY_MAP = {0: "จันทร์", 1: "อังคาร", 2: "พุธ", 3: "พฤหัสบดี",
            4: "ศุกร์", 5: "เสาร์", 6: "อาทิตย์"}

FEATURE_NAMES = [
    "month_norm", "is_16th", "weekday_norm",
    "overall_rate", "recent50_rate", "momentum",
    "overdue_norm", "same_month_rate", "same_day_rate",
    "lag1_match", "momentum_3m",
]
_FEATURE_VERSION = "v2"  # bump when FEATURE_NAMES changes to invalidate cached models


def _col_digits(col: str) -> int:
    if col in ("top2", "bottom2"):
        return 2
    if col == "prize1":
        return 6
    return 3


def _build_positions(series: pd.Series) -> dict[str, np.ndarray]:
    """O(n) — num → sorted numpy int32 array of draw indices."""
    pos: dict[str, list] = {}
    for i, v in enumerate(series):
        if pd.notna(v) and v and str(v) not in ("", "nan"):
            pos.setdefault(str(v), []).append(i)
    return {k: np.array(v, dtype=np.int32) for k, v in pos.items()}


def _precompute_context(month_arr: np.ndarray, day_arr: np.ndarray, n: int):
    """Build cumulative count tables for O(1) month/day total lookups.

    Returns:
        cummonth: shape (n+1, 13) — cummonth[i, m] = draws with month==m in first i rows
        cumday:   shape (n+1, 32) — same for day

    Vectorized via one-hot encoding + np.cumsum (no Python loop).
    """
    # month one-hot: clip to valid range then one-hot
    m_clip = np.clip(month_arr[:n].astype(np.int32), 0, 12)
    d_clip = np.clip(day_arr[:n].astype(np.int32), 0, 31)

    month_oh = np.zeros((n, 13), dtype=np.int32)
    month_oh[np.arange(n), m_clip] = 1
    month_oh[:, 0] = 0  # month 0 is invalid, ignore

    day_oh = np.zeros((n, 32), dtype=np.int32)
    day_oh[np.arange(n), d_clip] = 1
    day_oh[:, 0] = 0  # day 0 is invalid, ignore

    cummonth = np.zeros((n + 1, 13), dtype=np.int32)
    cumday   = np.zeros((n + 1, 32), dtype=np.int32)
    cummonth[1:] = np.cumsum(month_oh, axis=0)
    cumday[1:]   = np.cumsum(day_oh,   axis=0)
    return cummonth, cumday


def _feature_vec(
    pos_arr: np.ndarray,
    n_hist: int,
    target_month: int,
    target_day: int,
    target_wd: int,
    prev_num: str,
    num: str,
    month_arr: np.ndarray,
    day_arr: np.ndarray,
    cummonth: np.ndarray,
    cumday: np.ndarray,
    date_arr: np.ndarray | None = None,
) -> list[float]:
    """Build one feature vector for (candidate, draw_context). 11 features."""
    hist = pos_arr[pos_arr < n_hist] if len(pos_arr) else np.array([], dtype=np.int32)
    count = len(hist)
    rate = count / n_hist if n_hist else 0.0

    if count:
        overdue = n_hist - 1 - int(hist[-1])
        recent_count = int(np.sum(hist >= max(0, n_hist - 50)))
        recent_rate = recent_count / min(50, n_hist) if n_hist else 0.0
        same_m_count = int(np.sum(month_arr[hist] == target_month))
        same_d_count = int(np.sum(day_arr[hist] == target_day))
    else:
        overdue = n_hist
        recent_rate = 0.0
        same_m_count = same_d_count = 0

    momentum = recent_rate - rate

    month_total = int(cummonth[n_hist, target_month]) if 0 < target_month <= 12 else 1
    day_total = int(cumday[n_hist, target_day]) if 0 < target_day <= 31 else 1
    same_m_rate = same_m_count / month_total if month_total else 0.0
    same_d_rate = same_d_count / day_total if day_total else 0.0

    # Feature 11: 3-month rate vs 12-month rate (momentum_3m)
    if count and date_arr is not None and n_hist > 0:
        last_date = date_arr[n_hist - 1]
        cut_3m  = last_date - np.timedelta64(92, "D")
        cut_12m = last_date - np.timedelta64(366, "D")
        dates_hist = date_arr[hist]
        n3m  = max(int(np.sum(date_arr[:n_hist] >= cut_3m)), 1)
        n12m = max(int(np.sum(date_arr[:n_hist] >= cut_12m)), 1)
        rate_3m  = int(np.sum(dates_hist >= cut_3m)) / n3m
        rate_12m = int(np.sum(dates_hist >= cut_12m)) / n12m
        momentum_3m = rate_3m - rate_12m
    else:
        momentum_3m = 0.0

    return [
        target_month / 12.0,
        1.0 if target_day == 16 else 0.0,
        target_wd / 6.0,
        rate,
        recent_rate,
        momentum,
        min(overdue / 300.0, 1.0),
        same_m_rate,
        same_d_rate,
        1.0 if num == prev_num else 0.0,
        momentum_3m,
    ]


def _model_path(col: str) -> Path:
    return MODEL_DIR / f"gbm_{col}.pkl"


def _hash_path(col: str) -> Path:
    return MODEL_DIR / f"hash_{col}.txt"


def _load_cached_model(col: str, cur_hash: str):
    hp, mp = _hash_path(col), _model_path(col)
    if not mp.exists() or not hp.exists():
        return None
    try:
        if hp.read_text().strip() != cur_hash:
            return None
        with open(mp, "rb") as f:
            return pickle.load(f)
    except Exception:
        return None


def _save_model(clf, col: str, cur_hash: str) -> None:
    try:
        with open(_model_path(col), "wb") as f:
            pickle.dump(clf, f)
        _hash_path(col).write_text(cur_hash)
    except OSError:
        pass


def train_model(df: pd.DataFrame, col: str, force: bool = False):
    """Train GBM, return fitted classifier (or None if unsupported/unavailable)."""
    if not SKLEARN_OK or _col_digits(col) >= 6:
        return None
    if df.empty:
        return None

    cur_hash = f"{len(df)}_{_FEATURE_VERSION}"
    if not force:
        cached = _load_cached_model(col, cur_hash)
        if cached is not None:
            return cached

    digits = _col_digits(col)
    df_sorted = df.sort_values("date").reset_index(drop=True)
    series = df_sorted[col].astype(str).replace({"nan": "", "": pd.NA})
    all_nums = [f"{i:0{digits}d}" for i in range(10 ** digits)]

    positions = _build_positions(series)
    month_arr = df_sorted["month"].values.astype(np.int32)
    day_arr = df_sorted["day"].values.astype(np.int32)
    date_arr = df_sorted["date"].values.astype("datetime64[ns]")
    wd_arr = np.array(
        [_WEEKDAY_MAP.get(str(w), 0) for w in df_sorted["weekday"]], dtype=np.int32
    )
    n_total = len(df_sorted)
    cummonth, cumday = _precompute_context(month_arr, day_arr, n_total)

    X: list[list[float]] = []
    y: list[int] = []
    step = max(1, (n_total - 30) // 150)  # sample ~150 draws to keep training fast

    for i in range(30, n_total, step):
        actual = series.iloc[i]
        if pd.isna(actual) or not actual:
            continue
        prev_num = str(series.iloc[i - 1]) if i > 0 and pd.notna(series.iloc[i - 1]) else ""
        t_month, t_day, t_wd = int(month_arr[i]), int(day_arr[i]), int(wd_arr[i])

        for num in all_nums:
            pos_arr = positions.get(num, np.array([], dtype=np.int32))
            X.append(_feature_vec(
                pos_arr, i, t_month, t_day, t_wd, prev_num, num,
                month_arr, day_arr, cummonth, cumday, date_arr,
            ))
            y.append(1 if str(actual) == num else 0)

    if not X:
        return None

    clf = GradientBoostingClassifier(
        n_estimators=200, max_depth=4, learning_rate=0.08,
        subsample=0.8, min_samples_leaf=3, random_state=42,
    )
    clf.fit(np.array(X, dtype=np.float32), np.array(y))
    _save_model(clf, col, cur_hash)
    return clf


def predict_ml(df: pd.DataFrame, col: str, target_date: datetime, top_n: int = 10) -> pd.DataFrame:
    """Score all candidates with trained ML model."""
    if not SKLEARN_OK or df.empty or _col_digits(col) >= 6:
        return pd.DataFrame()

    clf = _load_cached_model(col, f"{len(df)}_{_FEATURE_VERSION}")
    if clf is None:
        return pd.DataFrame()

    digits = _col_digits(col)
    all_nums = [f"{i:0{digits}d}" for i in range(10 ** digits)]
    df_sorted = df.sort_values("date").reset_index(drop=True)
    series = df_sorted[col].astype(str).replace({"nan": "", "": pd.NA})
    positions = _build_positions(series)
    month_arr = df_sorted["month"].values.astype(np.int32)
    day_arr = df_sorted["day"].values.astype(np.int32)
    date_arr = df_sorted["date"].values.astype("datetime64[ns]")
    n = len(df_sorted)
    cummonth, cumday = _precompute_context(month_arr, day_arr, n)

    prev_num = str(series.iloc[-1]) if pd.notna(series.iloc[-1]) else ""
    t_wd = _WEEKDAY_MAP.get(_DAY_MAP.get(target_date.weekday(), ""), 0)
    t_month, t_day = target_date.month, target_date.day

    X_pred = [
        _feature_vec(
            positions.get(num, np.array([], dtype=np.int32)),
            n, t_month, t_day, t_wd, prev_num, num,
            month_arr, day_arr, cummonth, cumday, date_arr,
        )
        for num in all_nums
    ]

    try:
        probs = clf.predict_proba(np.array(X_pred, dtype=np.float32))[:, 1]
    except Exception:
        return pd.DataFrame()

    result = pd.DataFrame({
        "เลข": all_nums,
        "ML Score": (probs * 1000).round(3),
        "ความน่าจะเป็น (%)": (probs * 100).round(3),
    })
    result = result.sort_values("ML Score", ascending=False).head(top_n)
    result.index = range(1, len(result) + 1)
    return result


def get_feature_importance(col: str) -> pd.DataFrame:
    """Return feature importance from cached model."""
    try:
        mp = _model_path(col)
        if not mp.exists():
            return pd.DataFrame()
        with open(mp, "rb") as f:
            clf = pickle.load(f)
        if not hasattr(clf, "feature_importances_"):
            return pd.DataFrame()
        return (
            pd.DataFrame({"Feature": FEATURE_NAMES, "Importance": clf.feature_importances_})
            .sort_values("Importance", ascending=False)
            .reset_index(drop=True)
        )
    except Exception:
        return pd.DataFrame()


def model_exists(col: str) -> bool:
    return _model_path(col).exists() and _hash_path(col).exists()
