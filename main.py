"""
FastAPI backend — Thai Lottery Intelligence Dashboard
Run: uvicorn main:app --port 8509 --reload
"""
from __future__ import annotations
from fastapi import FastAPI, Query, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from pathlib import Path
import re
import pandas as pd
import numpy as np
from datetime import datetime

from scraper import load_data, get_cache_info, incremental_update
from analyzer import (
    predict_numbers, hot_cold_numbers,
    prize1_backtest, prize1_digit_analysis,
    predict_prize1_ultimate,
    freq_table, heatmap_data, trend_data, never_appeared,
    digit_frequency, overdue_with_prob, next_thai_draw,
    predict_with_reasons, prediction_confidence, ensemble_predict,
    pair_analysis, consecutive_pattern, decade_comparison,
    number_network_data, ticket_analysis,
)
from watchlist import load_watchlist, add_to_watchlist, remove_from_watchlist, watchlist_status

app = FastAPI(title="Lottery Stats API", version="2.0")

app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"]
)

BASE_DIR = Path(__file__).parent
STATIC_DIR = BASE_DIR / "static"
STATIC_DIR.mkdir(exist_ok=True)
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

_df_cache: pd.DataFrame | None = None

LOTTERY_WIDTHS = {
    "prize1": 6,
    "top3": 3,
    "top2": 2,
    "front3_1": 3,
    "front3_2": 3,
    "back3_1": 3,
    "back3_2": 3,
    "bottom2": 2,
}

P1_PRESETS: dict[str, dict] = {
    "optimized": {
        "label": "Prize1 optimized",
        "params": {
            "_selection_mode": "diverse_pair",
            "_back_pool_factor": 4,
            "_front_w": 0.48,
            "_back3_pos_w": 0.28,
            "_back3_hot_w": 0.06,
            "_back3_direct_w": 0.35,
            "_junc_w": 0.06,
            "_lag_pen": 0.50,
        },
    },
    "balanced": {
        "label": "Balanced coverage",
        "params": {
            "_selection_mode": "diverse_front",
            "_back_pool_factor": 4,
            "_back3_direct_w": 0.25,
        },
    },
    "coverage": {
        "label": "Front/back coverage",
        "params": {
            "_selection_mode": "diverse_front",
            "_back_pool_factor": 5,
            "_front_w": 0.44,
            "_back3_pos_w": 0.24,
            "_back3_hot_w": 0.10,
            "_back3_direct_w": 0.40,
        },
    },
}


def _p1_preset_kwargs(preset: str | None) -> tuple[str, dict]:
    key = (preset or "optimized").strip().lower()
    if key not in P1_PRESETS:
        key = "optimized"
    return key, P1_PRESETS[key]["params"].copy()
LOTTERY_COLS = set(LOTTERY_WIDTHS)
ML_COLS = LOTTERY_COLS - {"prize1"}


def get_df() -> pd.DataFrame:
    global _df_cache
    if _df_cache is None:
        _df_cache = load_data()
    return _df_cache


def _safe_records(df: pd.DataFrame | None) -> list[dict]:
    if df is None or df.empty:
        return []
    out = []
    for rec in df.to_dict("records"):
        clean: dict = {}
        for k, v in rec.items():
            if isinstance(v, pd.Timestamp):
                clean[k] = v.strftime("%Y-%m-%d")
            elif isinstance(v, (np.floating, np.integer)):
                clean[k] = v.item()
            elif isinstance(v, float) and (np.isnan(v) or np.isinf(v)):
                clean[k] = None
            elif pd.isna(v) if not isinstance(v, (list, dict, str)) else False:
                clean[k] = None
            else:
                clean[k] = v
        out.append(clean)
    return out


def _safe_str(v) -> str:
    s = str(v) if v is not None and not (isinstance(v, float) and np.isnan(v)) else ""
    return "" if s in ("nan", "None", "NaT") else s


def _safe_val(v):
    if isinstance(v, (np.floating, np.integer)):
        return v.item()
    if isinstance(v, float) and (np.isnan(v) or np.isinf(v)):
        return None
    if isinstance(v, pd.Timestamp):
        return v.strftime("%Y-%m-%d")
    return v


def _validate_col(col: str) -> str:
    if col not in LOTTERY_COLS:
        allowed = ", ".join(sorted(LOTTERY_COLS))
        raise HTTPException(status_code=400, detail=f"invalid col; allowed: {allowed}")
    return col


def _validate_ml_col(col: str) -> str:
    col = _validate_col(col)
    if col not in ML_COLS:
        allowed = ", ".join(sorted(ML_COLS))
        raise HTTPException(status_code=400, detail=f"ML is not available for {col}; allowed: {allowed}")
    return col


def _validate_number(col: str, number: str) -> str:
    number = str(number).strip()
    width = LOTTERY_WIDTHS[col]
    if not number.isdigit() or len(number) != width:
        raise HTTPException(status_code=400, detail=f"number for {col} must be exactly {width} digits")
    return number


def _target_date(date: str | None) -> datetime:
    if not date:
        return datetime.now()
    try:
        return datetime.strptime(date, "%Y-%m-%d")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="date must use YYYY-MM-DD") from exc


# ── Routes ──────────────────────────────────────────────────────────────────

@app.get("/")
def root():
    return FileResponse(str(STATIC_DIR / "index.html"))


@app.get("/api/summary")
def api_summary():
    df = get_df()
    if df.empty:
        return {"error": "ไม่มีข้อมูล"}

    df_s = df.sort_values("date").reset_index(drop=True)
    latest = df_s.iloc[-1]

    try:
        hot_df = hot_cold_numbers(df, "top3", recent_months=12)
        hot_list = _safe_records(hot_df.head(10) if hot_df is not None and not hot_df.empty else None)
    except Exception:
        hot_list = []
    try:
        cache_info = get_cache_info()
    except Exception:
        cache_info = {}

    recent = df_s.tail(15).copy()
    recent["date"] = recent["date"].dt.strftime("%d/%m/%Y")
    cols = ["date", "prize1", "top3", "top2", "front3_1", "front3_2", "back3_1", "back3_2", "bottom2"]
    recent = recent[[c for c in cols if c in recent.columns]]

    return {
        "total_draws": int(len(df)),
        "date_min": df_s["date"].min().strftime("%Y-%m-%d"),
        "date_max": df_s["date"].max().strftime("%Y-%m-%d"),
        "latest": {
            "date": _safe_str(latest.get("date")),
            "prize1": _safe_str(latest.get("prize1")),
            "top3": _safe_str(latest.get("top3")),
            "top2": _safe_str(latest.get("top2")),
            "front3_1": _safe_str(latest.get("front3_1")),
            "front3_2": _safe_str(latest.get("front3_2")),
            "back3_1": _safe_str(latest.get("back3_1")),
            "back3_2": _safe_str(latest.get("back3_2")),
            "bottom2": _safe_str(latest.get("bottom2")),
        },
        "hot_top3": hot_list,
        "recent_draws": _safe_records(recent),
        "cache_info": cache_info,
    }


@app.get("/api/predict/prize1")
def api_predict_prize1(
    top_n: int = Query(20, ge=5, le=50),
    beam_width: int = Query(500, ge=50, le=1000),
    k_back: int = Query(100, ge=10, le=200),
    preset: str = Query("optimized"),
    date: str | None = Query(None),
):
    df = get_df()
    target = _target_date(date)
    preset_key, preset_kwargs = _p1_preset_kwargs(preset)
    try:
        res = predict_prize1_ultimate(
            df, target, top_n=top_n, beam_width=beam_width, k_back=k_back,
            **preset_kwargs,
        )
        return {
            "predictions": _safe_records(res),
            "algorithm": "ultimate",
            "preset": preset_key,
            "preset_label": P1_PRESETS[preset_key]["label"],
        }
    except Exception as e:
        return {"error": str(e), "predictions": []}


@app.get("/api/predict/all")
def api_predict_all(
    top_n: int = Query(10, ge=5, le=50),
    beam_width: int = Query(500, ge=50, le=1000),
    k_back: int = Query(100, ge=10, le=200),
    preset: str = Query("optimized"),
    date: str | None = Query(None),
):
    """ทำนายทุกประเภทรางวัล: รางวัลที่1, 3บน, 3หน้า, 3ท้าย, 2ท้าย"""
    df = get_df()
    target = _target_date(date)
    preset_key, preset_kwargs = _p1_preset_kwargs(preset)
    result: dict = {
        "date": target.strftime("%Y-%m-%d"),
        "categories": {},
        "prize1_config": {
            "preset": preset_key,
            "preset_label": P1_PRESETS[preset_key]["label"],
            "beam_width": beam_width,
            "k_back": k_back,
        },
    }
    # รางวัลที่ 1
    try:
        p1 = predict_prize1_ultimate(
            df, target, top_n=top_n, beam_width=beam_width, k_back=k_back,
            **preset_kwargs,
        )
        result["categories"]["prize1"] = {
            "label": "รางวัลที่ 1",
            "digits": 6,
            "numbers": _safe_records(p1),
            "preset": preset_key,
        }
    except Exception as e:
        result["categories"]["prize1"] = {"label": "รางวัลที่ 1", "digits": 6, "numbers": [], "error": str(e)}
    # 3 ตัวและ 2 ตัว
    for col, label, digits in [
        ("front3_1","หน้า 3 ตัว ชุด1", 3), ("front3_2","หน้า 3 ตัว ชุด2", 3),
        ("back3_1","ท้าย 3 ตัว ชุด1", 3), ("back3_2","ท้าย 3 ตัว ชุด2", 3),
        ("bottom2","ท้าย 2 ตัว", 2),
    ]:
        try:
            pred = predict_with_reasons(df, col, target, top_n=top_n)
            recs = _safe_records(pred) if pred is not None else []
            result["categories"][col] = {"label": label, "digits": digits, "numbers": recs}
        except Exception as e:
            result["categories"][col] = {"label": label, "digits": digits, "numbers": [], "error": str(e)}
    return result


@app.get("/api/lucky-news")
async def api_lucky_news(date: str | None = Query(None)):
    """ดึงเลขเด็ดจากข่าว/ความเชื่อ ณ งวดนั้นๆ"""
    import httpx, re
    target = _target_date(date)
    # Format Thai draw date for search
    month_th = ["ม.ค.","ก.พ.","มี.ค.","เม.ย.","พ.ค.","มิ.ย.","ก.ค.","ส.ค.","ก.ย.","ต.ค.","พ.ย.","ธ.ค."]
    m_str = month_th[target.month - 1]
    d_str = str(target.day)
    y_str = str(target.year + 543)  # Buddhist era
    query = f"เลขเด็ด {d_str} {m_str} {y_str}"
    # Extract 2-3 digit numbers from text
    numbers_3: list[str] = []
    numbers_2: list[str] = []
    sources: list[str] = []
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            # Search Google
            headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
            urls_to_try = [
                f"https://www.sanook.com/lotto/search/?q={query}",
                f"https://www.thairath.co.th/search/{query}",
            ]
            all_text = ""
            for url in urls_to_try[:1]:
                try:
                    r = await client.get(url, headers=headers, follow_redirects=True)
                    all_text += r.text[:5000]
                    sources.append(url)
                except Exception:
                    pass
            # Extract numbers: look for patterns like xx, xxx, xxxxxx near keywords
            found_3 = re.findall(r'\b(\d{3})\b', all_text)
            found_2 = re.findall(r'\b(\d{2})\b', all_text)
            # Count frequency
            from collections import Counter
            c3 = Counter(found_3).most_common(10)
            c2 = Counter(found_2).most_common(10)
            numbers_3 = [n for n, _ in c3]
            numbers_2 = [n for n, _ in c2]
    except Exception as e:
        sources.append(f"error: {str(e)}")
    return {
        "query": query,
        "sources": sources,
        "numbers_3": numbers_3[:10],
        "numbers_2": numbers_2[:10],
        "note": "ข้อมูลจากข่าว/ความเชื่อ ใช้ประกอบการตัดสินใจเท่านั้น"
    }


@app.get("/api/stats")
def api_stats(
    col: str = Query("top3"),
    top_n: int = Query(20, ge=5, le=100),
    date: str | None = Query(None),
):
    col = _validate_col(col)
    df = get_df()
    target = _target_date(date)
    try:
        res = predict_numbers(df, col, target, top_n=top_n)
        return {"data": _safe_records(res), "col": col}
    except Exception as e:
        return {"error": str(e), "data": []}


@app.get("/api/hot-cold")
def api_hot_cold(
    col: str = Query("top3"),
    months: int = Query(12, ge=1, le=36),
):
    col = _validate_col(col)
    df = get_df()
    try:
        res = hot_cold_numbers(df, col, recent_months=months)
        return {"data": _safe_records(res), "col": col}
    except Exception as e:
        return {"error": str(e), "data": []}


@app.get("/api/backtest")
def api_backtest(
    n_draws: int = Query(50, ge=10, le=200),
    top_n: int = Query(20, ge=5, le=50),
    beam_width: int = Query(500, ge=50, le=1000),
    k_back: int = Query(100, ge=10, le=200),
    preset: str = Query("optimized"),
):
    df = get_df()
    preset_key, preset_kwargs = _p1_preset_kwargs(preset)
    try:
        result = prize1_backtest(
            df, n_draws=n_draws, top_n=top_n,
            beam_width=beam_width, k_back=k_back,
            **preset_kwargs,
        )
        result["preset"] = preset_key
        result["preset_label"] = P1_PRESETS[preset_key]["label"]
        clean: dict = {}
        for k, v in result.items():
            if isinstance(v, (np.floating, np.integer)):
                clean[k] = v.item()
            elif isinstance(v, float) and (np.isnan(v) or np.isinf(v)):
                clean[k] = 0.0
            else:
                clean[k] = v
        return clean
    except Exception as e:
        return {"error": str(e)}


@app.get("/api/digit-analysis")
def api_digit_analysis(date: str | None = Query(None)):
    df = get_df()
    target = _target_date(date)
    try:
        res = prize1_digit_analysis(df, target)
        return {"data": _safe_records(res)}
    except Exception as e:
        return {"error": str(e), "data": []}


@app.get("/api/cache-info")
def api_cache_info():
    info = get_cache_info()
    clean: dict = {}
    for k, v in info.items():
        if hasattr(v, "strftime"):
            clean[k] = v.strftime("%Y-%m-%d %H:%M")
        elif isinstance(v, pd.Timestamp):
            clean[k] = v.strftime("%Y-%m-%d")
        else:
            clean[k] = v
    return clean


@app.post("/api/refresh")
def api_refresh():
    global _df_cache
    _df_cache = incremental_update()
    return {"status": "ok", "rows": int(len(_df_cache))}


# ── NEW ENDPOINTS ────────────────────────────────────────────────────────────

@app.get("/api/freq-table")
def api_freq_table(col: str = Query("top3"), top_n: int = Query(30, ge=5, le=200)):
    col = _validate_col(col)
    df = get_df()
    try:
        res = freq_table(df, col, top_n=top_n)
        never = never_appeared(df, col)
        return {"data": _safe_records(res), "never": never, "col": col}
    except Exception as e:
        return {"error": str(e), "data": [], "never": []}


@app.get("/api/heatmap")
def api_heatmap(col: str = Query("top3")):
    col = _validate_col(col)
    df = get_df()
    try:
        res = heatmap_data(df, col)
        return {"data": _safe_records(res), "col": col}
    except Exception as e:
        return {"error": str(e), "data": []}


@app.get("/api/trend")
def api_trend(col: str = Query("top3"), number: str = Query(...)):
    col = _validate_col(col)
    number = _validate_number(col, number)
    df = get_df()
    try:
        res = trend_data(df, col, number)
        return {"data": _safe_records(res), "col": col, "number": number}
    except Exception as e:
        return {"error": str(e), "data": []}


@app.get("/api/digit-freq")
def api_digit_freq(col: str = Query("top3")):
    col = _validate_col(col)
    df = get_df()
    try:
        res = digit_frequency(df, col)
        return {"data": _safe_records(res), "col": col}
    except Exception as e:
        return {"error": str(e), "data": []}


@app.get("/api/overdue")
def api_overdue(col: str = Query("top3"), top_n: int = Query(20, ge=5, le=50)):
    col = _validate_col(col)
    df = get_df()
    try:
        res = overdue_with_prob(df, col, top_n=top_n)
        return {"data": _safe_records(res), "col": col}
    except Exception as e:
        return {"error": str(e), "data": []}


@app.get("/api/history")
def api_history(col: str = Query("top3"), n: int = Query(50, ge=10, le=500)):
    col = _validate_col(col)
    df = get_df()
    try:
        df_s = df.sort_values("date", ascending=False).head(n).copy()
        df_s["date"] = df_s["date"].dt.strftime("%d/%m/%Y")
        cols = ["date", "prize1", "top3", "top2", "front3_1", "front3_2", "back3_1", "back3_2", "bottom2"]
        df_s = df_s[[c for c in cols if c in df_s.columns]]
        return {"data": _safe_records(df_s), "col": col}
    except Exception as e:
        return {"error": str(e), "data": []}


@app.get("/api/prize-freq")
def api_prize_freq(prize: str = Query("prize2"), top_n: int = Query(20, ge=5, le=50)):
    """ความถี่เลขในรางวัลที่ 2, 3 หรือ near1 (ข้างเคียงรางวัลที่ 1)"""
    from scraper import SANOOK_COLS, SANOOK_MULTI_COLS
    valid = ["near1", "prize2", "prize3", "prize4", "prize5"]
    if prize not in valid:
        raise HTTPException(400, detail=f"prize ต้องเป็น {valid}")
    df = get_df()
    nums: list[str] = []
    if prize in SANOOK_MULTI_COLS:
        # prize4/prize5 เก็บเป็น string เดียวคั่น space
        if prize in df.columns:
            series = df[prize].dropna().astype(str)
            for v in series:
                nums.extend(v.split())
            total = int((series.str.strip() != "").sum())
        else:
            total = 0
    else:
        # รวมทุก sub-column ของรางวัลนั้น
        cols = [c for c in SANOOK_COLS if c.startswith(prize + "_")]
        for col in cols:
            if col in df.columns:
                nums.extend(df[col].dropna().astype(str).tolist())
        total = int(df[cols[0]].notna().sum()) if cols else 0
    nums = [n for n in nums if re.match(r"^\d{6}$", n)]
    from collections import Counter
    cnt = Counter(nums)
    result = [
        {"number": k, "count": v, "pct": round(v / max(total, 1) * 100, 2)}
        for k, v in cnt.most_common(top_n)
    ]
    return {"prize": prize, "data": result, "total_draws": int(total)}


@app.get("/api/fable")
def api_fable(top2: int = Query(10, ge=5, le=20),
              top3: int = Query(15, ge=5, le=30),
              date: str | None = Query(None),
              window: int = Query(100, ge=30, le=200),
              cross_w: float = Query(0.45, ge=0, le=2),
              digit_w: float = Query(0.20, ge=0, le=2),
              momentum_w: float = Query(0.20, ge=0, le=2),
              lag_penalty: float = Query(0.25, ge=0, le=0.95),
              near_w: float = Query(0.0, ge=0, le=2),
              transition_w: float = Query(0.0, ge=0, le=2),
              diversity_penalty: float = Query(0.0, ge=0, le=0.95),
              drawday_w: float = Query(0.25, ge=0, le=2)):
    """สูตร FABLE — เลขท้าย 2/3 ตัวที่มีโอกาสโผล่ในรางวัล 1-5"""
    from fable_formula import fable_predict
    df = get_df()
    target = _target_date(date)
    weights = {
        "cross_freq": cross_w,
        "digit_position": digit_w,
        "momentum": momentum_w,
        "anti_lag_penalty": lag_penalty,
        "near_miss": near_w,
        "slice_transition": transition_w,
        "diversity_penalty": diversity_penalty,
        "draw_day": drawday_w,
    }
    try:
        return fable_predict(df, top2=top2, top3=top3, window=window, weights=weights, target_date=target)
    except Exception as e:
        return {"error": str(e)}


@app.get("/api/fable-backtest")
def api_fable_backtest(n_draws: int = Query(200, ge=20, le=400),
                       top2: int = Query(10, ge=5, le=20),
                       top3: int = Query(15, ge=5, le=30),
                       window: int = Query(100, ge=30, le=200),
                       cross_w: float = Query(0.45, ge=0, le=2),
                       digit_w: float = Query(0.20, ge=0, le=2),
                       momentum_w: float = Query(0.20, ge=0, le=2),
                       lag_penalty: float = Query(0.25, ge=0, le=0.95),
                       near_w: float = Query(0.0, ge=0, le=2),
                       transition_w: float = Query(0.0, ge=0, le=2),
                       diversity_penalty: float = Query(0.0, ge=0, le=0.95),
                       drawday_w: float = Query(0.25, ge=0, le=2),
                       gate: bool = Query(False),
                       validation_draws: int = Query(40, ge=20, le=120),
                       live_draws: int = Query(40, ge=20, le=120)):
    """Backtest สูตร FABLE เทียบ baseline สุ่ม — `gate=true` รวม validation/live (ช่วงเก่ากว่า
    ไม่ทับ rolling window) เข้ากับ W50/W100/W200 เป็น promotion gate เดียว"""
    from fable_formula import fable_backtest
    df = get_df()
    weights = {
        "cross_freq": cross_w,
        "digit_position": digit_w,
        "momentum": momentum_w,
        "anti_lag_penalty": lag_penalty,
        "near_miss": near_w,
        "slice_transition": transition_w,
        "diversity_penalty": diversity_penalty,
        "draw_day": drawday_w,
    }
    try:
        return fable_backtest(df, n_draws=n_draws, top2=top2, top3=top3, window=window, weights=weights,
                              gate=gate, validation_draws=validation_draws, live_draws=live_draws)
    except Exception as e:
        return {"error": str(e)}


@app.get("/api/fable-grid-search")
def api_fable_grid_search(n_draws: int = Query(80, ge=80, le=260),
                          holdout_draws: int = Query(30, ge=20, le=120),
                          top2: int = Query(10, ge=5, le=20),
                          top3: int = Query(15, ge=5, le=30),
                          max_configs: int = Query(6, ge=3, le=20)):
    """FABLE config grid search with train/holdout report."""
    from fable_formula import fable_grid_search
    df = get_df()
    try:
        return fable_grid_search(
            df,
            n_draws=n_draws,
            holdout_draws=holdout_draws,
            top2=top2,
            top3=top3,
            max_configs=max_configs,
        )
    except Exception as e:
        return {"error": str(e)}


@app.get("/api/fable-holdout-report")
def api_fable_holdout_report(n_draws: int = Query(120, ge=70, le=260),
                             validation_draws: int = Query(30, ge=20, le=100),
                             live_draws: int = Query(30, ge=20, le=100),
                             top2: int = Query(10, ge=5, le=20),
                             top3: int = Query(15, ge=5, le=30),
                             max_configs: int = Query(6, ge=3, le=20)):
    """FABLE formal train/validation/live holdout report."""
    from fable_formula import fable_holdout_report
    df = get_df()
    try:
        return fable_holdout_report(
            df,
            n_draws=n_draws,
            validation_draws=validation_draws,
            live_draws=live_draws,
            top2=top2,
            top3=top3,
            max_configs=max_configs,
        )
    except Exception as e:
        return {"error": str(e)}


@app.get("/api/prize-history")
def api_prize_history(n: int = Query(20, ge=5, le=600)):
    """ผลย้อนหลังพร้อม prize2/3/near1"""
    from scraper import SANOOK_COLS, SANOOK_MULTI_COLS
    df = get_df()
    df_s = df.sort_values("date", ascending=False).head(n).copy()
    df_s["date"] = df_s["date"].dt.strftime("%d/%m/%Y")
    base_cols = ["date", "prize1", "top3", "top2",
                 "front3_1", "front3_2", "back3_1", "back3_2", "bottom2"]
    extra_cols = [c for c in SANOOK_COLS + SANOOK_MULTI_COLS if c in df_s.columns]
    cols = base_cols + extra_cols
    df_s = df_s[[c for c in cols if c in df_s.columns]]
    return {"data": _safe_records(df_s)}


@app.get("/api/predict-general")
def api_predict_general(
    col: str = Query("top3"),
    top_n: int = Query(20, ge=5, le=50),
    date: str | None = Query(None),
):
    col = _validate_col(col)
    df = get_df()
    target = _target_date(date)
    try:
        res = predict_numbers(df, col, target, top_n=top_n)
        return {"data": _safe_records(res), "col": col}
    except Exception as e:
        return {"error": str(e), "data": []}


@app.get("/api/predict-with-reasons")
def api_predict_with_reasons(
    col: str = Query("top3"),
    top_n: int = Query(20, ge=5, le=50),
    date: str | None = Query(None),
):
    col = _validate_col(col)
    df = get_df()
    target = _target_date(date)
    try:
        res = predict_with_reasons(df, col, target, top_n=top_n)
        return {"data": _safe_records(res), "col": col}
    except Exception as e:
        return {"error": str(e), "data": []}


@app.get("/api/confidence")
def api_confidence(col: str = Query("top3"), date: str | None = Query(None)):
    col = _validate_col(col)
    df = get_df()
    target = _target_date(date)
    try:
        res = prediction_confidence(df, col, target)
        return {k: _safe_val(v) for k, v in res.items()}
    except Exception as e:
        return {"error": str(e)}


@app.get("/api/ensemble")
def api_ensemble(
    col: str = Query("top3"),
    top_n: int = Query(20, ge=5, le=50),
    date: str | None = Query(None),
):
    col = _validate_col(col)
    df = get_df()
    target = _target_date(date)
    try:
        res = ensemble_predict(df, col, target, top_n=top_n)
        return {"data": _safe_records(res), "col": col}
    except Exception as e:
        return {"error": str(e), "data": []}


@app.get("/api/pairs")
def api_pairs(
    col_a: str = Query("top3"),
    col_b: str = Query("top2"),
    query: str | None = Query(None),
    top_n: int = Query(10, ge=3, le=30),
):
    col_a = _validate_col(col_a)
    col_b = _validate_col(col_b)
    if query:
        query = _validate_number(col_a, query)
    df = get_df()
    try:
        if query:
            res = pair_analysis(df, col_a, col_b, query, top_n=top_n)
            return {"data": _safe_records(res), "col_a": col_a, "col_b": col_b}
        else:
            # overview: top 5 of col_a → top 3 in col_b
            top5 = freq_table(df, col_a)["เลข"].head(5).tolist()
            rows = []
            for num in top5:
                p_df = pair_analysis(df, col_a, col_b, str(num), top_n=3)
                top3 = " / ".join(p_df["เลข"].tolist()) if not p_df.empty else "-"
                rows.append({col_a: num, f"top3_{col_b}": top3})
            return {"data": rows, "col_a": col_a, "col_b": col_b}
    except Exception as e:
        return {"error": str(e), "data": []}


@app.get("/api/consecutive")
def api_consecutive(
    col: str = Query("top3"),
    query: str | None = Query(None),
    top_n: int = Query(15, ge=5, le=30),
):
    col = _validate_col(col)
    if query:
        query = _validate_number(col, query)
    df = get_df()
    try:
        res = consecutive_pattern(df, col, query_num=query, top_n=top_n)
        return {"data": _safe_records(res), "col": col}
    except Exception as e:
        return {"error": str(e), "data": []}


@app.get("/api/decade")
def api_decade(col: str = Query("top3"), top_n: int = Query(15, ge=5, le=30)):
    col = _validate_col(col)
    df = get_df()
    try:
        res = decade_comparison(df, col, top_n=top_n)
        _end_year = int(df["year"].max()) if not df.empty else 2026
        return {"data": _safe_records(res), "col": col, "end_year": _end_year}
    except Exception as e:
        return {"error": str(e), "data": []}


@app.get("/api/network")
def api_network(
    col_a: str = Query("top3"),
    col_b: str = Query("top2"),
    min_weight: int = Query(4, ge=1, le=20),
):
    col_a = _validate_col(col_a)
    col_b = _validate_col(col_b)
    df = get_df()
    try:
        nodes, edges = number_network_data(df, col_a, col_b, min_weight=min_weight)
        return {"nodes": nodes, "edges": edges, "col_a": col_a, "col_b": col_b}
    except Exception as e:
        return {"error": str(e), "nodes": [], "edges": []}


@app.get("/api/next-draws")
def api_next_draws():
    draws = next_thai_draw(datetime.now())
    return {"draws": [{"label": f"{d['day']}/{d['month']}/{d['year']+543}", "date": d["date"].strftime("%Y-%m-%d")} for d in draws]}


# ── Watchlist ────────────────────────────────────────────────────────────────

@app.get("/api/watchlist")
def api_get_watchlist(col: str = Query("top3")):
    col = _validate_col(col)
    df = get_df()
    wl = load_watchlist()
    numbers = wl.get(col, [])
    valid_numbers: list[str] = []
    invalid_numbers: list[str] = []
    for number in numbers:
        try:
            valid_numbers.append(_validate_number(col, number))
        except HTTPException:
            invalid_numbers.append(str(number))
    if valid_numbers:
        status_df = watchlist_status(df, col, valid_numbers)
        return {
            "numbers": valid_numbers,
            "invalid_numbers": invalid_numbers,
            "status": _safe_records(status_df),
            "col": col,
        }
    return {"numbers": [], "invalid_numbers": invalid_numbers, "status": [], "col": col}


class WatchlistItem(BaseModel):
    col: str
    number: str


@app.post("/api/watchlist")
def api_add_watchlist(item: WatchlistItem):
    col = _validate_col(item.col)
    number = _validate_number(col, item.number)
    wl = add_to_watchlist(col, number)
    return {"ok": True, "watchlist": wl}


@app.delete("/api/watchlist")
def api_remove_watchlist(col: str = Query(...), number: str = Query(...)):
    col = _validate_col(col)
    number = str(number).strip()
    wl = remove_from_watchlist(col, number)
    return {"ok": True, "watchlist": wl}


# ── ML Prediction ────────────────────────────────────────────────────────────

@app.get("/api/ml-predict")
def api_ml_predict(
    col: str = Query("top3"),
    top_n: int = Query(20, ge=5, le=50),
    date: str | None = Query(None),
):
    col = _validate_ml_col(col)
    df = get_df()
    target = _target_date(date)
    try:
        from ml_predictor import predict_ml, model_exists, get_feature_importance
        if not model_exists(col):
            return {"error": "model_not_trained", "data": []}
        res = predict_ml(df, col, target, top_n=top_n)
        fi = get_feature_importance(col)
        return {"data": _safe_records(res), "feature_importance": _safe_records(fi), "col": col}
    except Exception as e:
        return {"error": str(e), "data": []}


@app.post("/api/ml-train")
def api_ml_train(col: str = Query("top3")):
    col = _validate_ml_col(col)
    df = get_df()
    try:
        from ml_predictor import train_model
        train_model(df, col, force=True)
        return {"ok": True, "col": col}
    except Exception as e:
        return {"error": str(e)}


@app.get("/api/ml-status")
def api_ml_status(col: str = Query("top3")):
    col = _validate_ml_col(col)
    try:
        from ml_predictor import model_exists
        return {"trained": model_exists(col), "col": col}
    except Exception as e:
        return {"trained": False, "col": col, "error": str(e)}


@app.get("/api/ticket-analysis")
def api_ticket_analysis(col: str = Query("top3"), numbers: str = Query(...)):
    col = _validate_col(col)
    df = get_df()
    num_list = [_validate_number(col, n) for n in numbers.split(",") if n.strip()]
    try:
        res = ticket_analysis(df, col, num_list)
        return {"data": _safe_records(res), "col": col}
    except Exception as e:
        return {"error": str(e), "data": []}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8509, reload=True)
