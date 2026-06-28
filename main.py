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
    number_network_data, ticket_analysis, overdue_numbers,
)
from watchlist import load_watchlist, add_to_watchlist, remove_from_watchlist, watchlist_status

app = FastAPI(title="Lottery Stats API", version="2.0")

app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"]
)

BASE_DIR = Path(__file__).parent
STATIC_DIR = BASE_DIR / "static"
STATIC_DIR.mkdir(exist_ok=True)

_df_cache: pd.DataFrame | None = None


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
    }


@app.get("/api/predict/prize1")
def api_predict_prize1(
    top_n: int = Query(20, ge=5, le=50),
    beam_width: int = Query(300, ge=50, le=500),
    k_back: int = Query(50, ge=10, le=100),
    date: str | None = Query(None),
):
    df = get_df()
    target = datetime.strptime(date, "%Y-%m-%d") if date else datetime.now()
    try:
        res = predict_prize1_ultimate(df, target, top_n=top_n, beam_width=beam_width, k_back=k_back)
        return {"predictions": _safe_records(res), "algorithm": "ultimate"}
    except Exception as e:
        return {"error": str(e), "predictions": []}


@app.get("/api/stats")
def api_stats(
    col: str = Query("top3"),
    top_n: int = Query(20, ge=5, le=100),
    date: str | None = Query(None),
):
    df = get_df()
    target = datetime.strptime(date, "%Y-%m-%d") if date else datetime.now()
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
):
    df = get_df()
    try:
        result = prize1_backtest(
            df, n_draws=n_draws, top_n=top_n,
            beam_width=beam_width, k_back=k_back,
        )
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
    target = datetime.strptime(date, "%Y-%m-%d") if date else datetime.now()
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
    df = get_df()
    try:
        res = freq_table(df, col, top_n=top_n)
        never = never_appeared(df, col)
        return {"data": _safe_records(res), "never": never, "col": col}
    except Exception as e:
        return {"error": str(e), "data": [], "never": []}


@app.get("/api/heatmap")
def api_heatmap(col: str = Query("top3")):
    df = get_df()
    try:
        res = heatmap_data(df, col)
        return {"data": _safe_records(res), "col": col}
    except Exception as e:
        return {"error": str(e), "data": []}


@app.get("/api/trend")
def api_trend(col: str = Query("top3"), number: str = Query(...)):
    df = get_df()
    try:
        res = trend_data(df, col, number)
        return {"data": _safe_records(res), "col": col, "number": number}
    except Exception as e:
        return {"error": str(e), "data": []}


@app.get("/api/digit-freq")
def api_digit_freq(col: str = Query("top3")):
    df = get_df()
    try:
        res = digit_frequency(df, col)
        return {"data": _safe_records(res), "col": col}
    except Exception as e:
        return {"error": str(e), "data": []}


@app.get("/api/overdue")
def api_overdue(col: str = Query("top3"), top_n: int = Query(20, ge=5, le=50)):
    df = get_df()
    try:
        res = overdue_with_prob(df, col, top_n=top_n)
        return {"data": _safe_records(res), "col": col}
    except Exception as e:
        return {"error": str(e), "data": []}


@app.get("/api/history")
def api_history(col: str = Query("top3"), n: int = Query(50, ge=10, le=500)):
    df = get_df()
    try:
        df_s = df.sort_values("date", ascending=False).head(n).copy()
        df_s["date"] = df_s["date"].dt.strftime("%d/%m/%Y")
        cols = ["date", "prize1", "top3", "top2", "front3_1", "front3_2", "back3_1", "back3_2", "bottom2"]
        df_s = df_s[[c for c in cols if c in df_s.columns]]
        return {"data": _safe_records(df_s), "col": col}
    except Exception as e:
        return {"error": str(e), "data": []}


@app.get("/api/predict-general")
def api_predict_general(
    col: str = Query("top3"),
    top_n: int = Query(20, ge=5, le=50),
    date: str | None = Query(None),
):
    df = get_df()
    target = datetime.strptime(date, "%Y-%m-%d") if date else datetime.now()
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
    df = get_df()
    target = datetime.strptime(date, "%Y-%m-%d") if date else datetime.now()
    try:
        res = predict_with_reasons(df, col, target, top_n=top_n)
        return {"data": _safe_records(res), "col": col}
    except Exception as e:
        return {"error": str(e), "data": []}


@app.get("/api/confidence")
def api_confidence(col: str = Query("top3"), date: str | None = Query(None)):
    df = get_df()
    target = datetime.strptime(date, "%Y-%m-%d") if date else datetime.now()
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
    df = get_df()
    target = datetime.strptime(date, "%Y-%m-%d") if date else datetime.now()
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
    df = get_df()
    try:
        res = consecutive_pattern(df, col, query_num=query, top_n=top_n)
        return {"data": _safe_records(res), "col": col}
    except Exception as e:
        return {"error": str(e), "data": []}


@app.get("/api/decade")
def api_decade(col: str = Query("top3"), top_n: int = Query(15, ge=5, le=30)):
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
    df = get_df()
    wl = load_watchlist()
    numbers = wl.get(col, [])
    if numbers:
        status_df = watchlist_status(df, col, numbers)
        return {"numbers": numbers, "status": _safe_records(status_df), "col": col}
    return {"numbers": [], "status": [], "col": col}


class WatchlistItem(BaseModel):
    col: str
    number: str


@app.post("/api/watchlist")
def api_add_watchlist(item: WatchlistItem):
    wl = add_to_watchlist(item.col, item.number)
    return {"ok": True, "watchlist": wl}


@app.delete("/api/watchlist")
def api_remove_watchlist(col: str = Query(...), number: str = Query(...)):
    wl = remove_from_watchlist(col, number)
    return {"ok": True, "watchlist": wl}


# ── ML Prediction ────────────────────────────────────────────────────────────

@app.get("/api/ml-predict")
def api_ml_predict(
    col: str = Query("top3"),
    top_n: int = Query(20, ge=5, le=50),
    date: str | None = Query(None),
):
    df = get_df()
    target = datetime.strptime(date, "%Y-%m-%d") if date else datetime.now()
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
    df = get_df()
    try:
        from ml_predictor import train_model
        train_model(df, col, force=True)
        return {"ok": True, "col": col}
    except Exception as e:
        return {"error": str(e)}


@app.get("/api/ml-status")
def api_ml_status(col: str = Query("top3")):
    try:
        from ml_predictor import model_exists
        return {"trained": model_exists(col), "col": col}
    except Exception as e:
        return {"trained": False, "col": col, "error": str(e)}


@app.get("/api/ticket-analysis")
def api_ticket_analysis(col: str = Query("top3"), numbers: str = Query(...)):
    df = get_df()
    num_list = [n.strip() for n in numbers.split(",") if n.strip()]
    try:
        res = ticket_analysis(df, col, num_list)
        return {"data": _safe_records(res), "col": col}
    except Exception as e:
        return {"error": str(e), "data": []}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8509, reload=True)
