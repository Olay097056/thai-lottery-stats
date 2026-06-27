"""
Persistent watchlist — save/load favorite numbers to JSON.
"""
import json
from pathlib import Path
import pandas as pd
from datetime import datetime

WATCHLIST_FILE = Path(__file__).parent / "watchlist.json"


def load_watchlist() -> dict:
    """Returns {col: [numbers]}"""
    if not WATCHLIST_FILE.exists():
        return {}
    try:
        return json.loads(WATCHLIST_FILE.read_text(encoding="utf-8"))
    except Exception:
        return {}


def save_watchlist(wl: dict) -> bool:
    """Returns True on success, False on write failure."""
    try:
        tmp = WATCHLIST_FILE.with_suffix(".tmp")
        tmp.write_text(json.dumps(wl, ensure_ascii=False, indent=2), encoding="utf-8")
        tmp.replace(WATCHLIST_FILE)  # atomic rename
        return True
    except OSError:
        return False


def add_to_watchlist(col: str, number: str) -> dict:
    wl = load_watchlist()
    if col not in wl:
        wl[col] = []
    if number not in wl[col]:
        wl[col].append(number)
    save_watchlist(wl)
    return wl


def remove_from_watchlist(col: str, number: str) -> dict:
    wl = load_watchlist()
    if col in wl and number in wl[col]:
        wl[col].remove(number)
    save_watchlist(wl)
    return wl


def watchlist_status(df: pd.DataFrame, col: str, numbers: list[str]) -> pd.DataFrame:
    """Quick status table for watched numbers (O(n) build once, O(1) per number)"""
    records = []
    total = len(df)
    df_sorted = df.sort_values("date").reset_index(drop=True)
    _EMPTY = {"", "nan", "None", "NaN", "<NA>"}
    series = df_sorted[col].astype(str).replace({v: "" for v in _EMPTY})

    # Build O(n) lookup once
    last_pos_map: dict[str, int] = {}
    count_map: dict[str, int] = {}
    for i, v in enumerate(series):
        if v and v not in _EMPTY:
            last_pos_map[v] = i
            count_map[v] = count_map.get(v, 0) + 1

    for num in numbers:
        last_pos = last_pos_map.get(num, -1)
        count = count_map.get(num, 0)
        rate = count / total * 100 if total else 0.0
        overdue = total - last_pos - 1 if last_pos >= 0 else total
        last_date = df_sorted["date"].iloc[last_pos].strftime("%d/%m/%Y") if last_pos >= 0 else "ไม่เคยออก"

        alert = ""
        if overdue == 0:
            alert = "🎉 ออกงวดล่าสุด!"
        elif overdue >= 50:
            alert = f"⚠️ ค้าง {overdue} งวด"
        elif overdue >= 20:
            alert = f"⏰ ค้าง {overdue} งวด"

        records.append({
            "เลข": num,
            "ออกทั้งหมด": int(count),
            "อัตรา (%)": round(rate, 2),
            "ค้างกี่งวด": overdue,
            "ออกล่าสุด": last_date,
            "แจ้งเตือน": alert,
        })
    return pd.DataFrame(records)
