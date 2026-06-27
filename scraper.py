"""
Scraper สำหรับดึงข้อมูลหวยจาก myhora.com
"""
import requests
from bs4 import BeautifulSoup
import pandas as pd
import time
import re
from pathlib import Path
from datetime import datetime

_RETRY_DELAYS = (1, 3, 7)  # seconds between retries (3 attempts total)

CACHE_FILE = Path(__file__).parent / "lottery_cache.csv"
HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
DRAW_PATTERN = re.compile(r"/lottery/result-(\d+)-(\d+)-(\d+)\.aspx")

# คอลัมน์เลขหวย — ต้อง read กลับเป็น string เสมอ
LOTTERY_COLS = ["prize1", "top3", "top2", "front3_1", "front3_2", "back3_1", "back3_2", "bottom2"]
# ความยาวที่ถูกต้องของแต่ละคอลัมน์ (สำหรับ zfill)
LOTTERY_WIDTHS = {"prize1": 6, "top3": 3, "top2": 2, "front3_1": 3, "front3_2": 3,
                  "back3_1": 3, "back3_2": 3, "bottom2": 2}

THAI_MONTHS = {
    "มกราคม": 1, "กุมภาพันธ์": 2, "มีนาคม": 3, "เมษายน": 4,
    "พฤษภาคม": 5, "มิถุนายน": 6, "กรกฎาคม": 7, "สิงหาคม": 8,
    "กันยายน": 9, "ตุลาคม": 10, "พฤศจิกายน": 11, "ธันวาคม": 12,
}

DAY_MAP = {0: "จันทร์", 1: "อังคาร", 2: "พุธ", 3: "พฤหัสบดี",
           4: "ศุกร์", 5: "เสาร์", 6: "อาทิตย์"}


def _fix_num(v: object, width: int) -> str:
    """Normalise a lottery cell value: '3.0' → '003', '' → ''."""
    if pd.isna(v) or str(v).strip() in ("", "nan"):
        return ""
    try:
        return str(int(float(v))).zfill(width)
    except (ValueError, TypeError):
        return str(v).strip()


def scrape_year(year_be: int) -> list[dict]:
    """ดึงผลหวยทั้งปี (Buddhist Era year) โดย parse DOM linearly (with retry)"""
    url = f"https://myhora.com/lottery/result-{year_be}.aspx"
    last_err: Exception | None = None
    for delay in (0, *_RETRY_DELAYS):
        if delay:
            time.sleep(delay)
        try:
            resp = requests.get(url, headers=HEADERS, timeout=15)
            resp.raise_for_status()
            resp.encoding = "utf-8"
            last_err = None
            break
        except Exception as e:
            last_err = e
            print(f"  Retry {year_be} after {delay}s: {e}")
    if last_err:
        print(f"  Error fetching {year_be}: {last_err}")
        return []

    soup = BeautifulSoup(resp.text, "lxml")
    rows = []
    current_date = None

    # เดิน DOM แบบ linear: เมื่อเจอ link งวด → บันทึก date
    # เมื่อเจอ lot-id div ถัดมา → ดึงตัวเลข
    for tag in soup.find_all(True):
        # จับ draw link
        if tag.name == "a":
            href = tag.get("href", "")
            m = DRAW_PATTERN.search(href)
            if m and "งวด" in tag.get_text():
                dd, mm_str, yyyy_str = m.groups()
                try:
                    year_ad = int(yyyy_str) - 543
                    month = int(mm_str)
                    day = int(dd)
                    current_date = datetime(year_ad, month, day)
                except ValueError:
                    current_date = None

        # จับ lot-id div ที่ตามหลัง draw link
        if tag.name == "div" and "lot-id" in tag.get("class", []):
            if current_date is None:
                continue

            text = tag.get_text(" ", strip=True)
            nums6 = re.findall(r"\b\d{6}\b", text)
            # ใช้ \b เพื่อไม่ match ส่วนของ 6-digit
            nums3 = re.findall(r"(?<!\d)\d{3}(?!\d)", text)
            nums2_all = re.findall(r"(?<!\d)\d{2}(?!\d)", text)

            # ลำดับใน text: prize1, front3[0], front3[1], back3[0], back3[1], back2
            prize1 = nums6[0] if nums6 else ""
            # กรอง nums3 ที่ไม่ใช่ส่วนของ 6-digit
            clean3 = [n for n in nums3 if not any(n in p for p in nums6)]
            front3 = clean3[:2]
            back3 = clean3[2:4]
            # back2 = เลข 2 หลักสุดท้ายหลังจาก back3
            back2 = nums2_all[-1] if nums2_all else ""

            rows.append({
                "date": current_date,
                "year": current_date.year,
                "month": current_date.month,
                "day": current_date.day,
                "weekday": DAY_MAP.get(current_date.weekday(), ""),
                "prize1": prize1,
                "top3": prize1[-3:] if len(prize1) >= 3 else "",
                "top2": prize1[-2:] if len(prize1) >= 2 else "",
                "front3_1": front3[0] if len(front3) > 0 else "",
                "front3_2": front3[1] if len(front3) > 1 else "",
                "back3_1": back3[0] if len(back3) > 0 else "",
                "back3_2": back3[1] if len(back3) > 1 else "",
                "bottom2": back2,
            })
            current_date = None  # reset รอ draw ถัดไป

    return rows


def _enforce_prize1_identity(df: pd.DataFrame) -> pd.DataFrame:
    """Re-derive top3/top2 from prize1 where the identity prize1[-3:] == top3 is violated.

    prize1 is the ground truth (scraped directly as nums6[0]).
    top3 and top2 are derived fields — if they diverge from prize1, re-derive in-memory.
    Does NOT write back to CSV; caller sees clean data without altering the audit trail.
    """
    valid = (
        df["prize1"].notna() &
        (df["prize1"].str.len() == 6) &
        ~df["prize1"].isin(("", "nan"))
    )
    broken_top3 = valid & (df["top3"] != df["prize1"].str[-3:])
    broken_top2 = valid & (df["top2"] != df["prize1"].str[-2:])

    n_fixed = int((broken_top3 | broken_top2).sum())
    if n_fixed:
        if broken_top3.any():
            df.loc[broken_top3, "top3"] = df.loc[broken_top3, "prize1"].str[-3:]
        if broken_top2.any():
            df.loc[broken_top2, "top2"] = df.loc[broken_top2, "prize1"].str[-2:]
        if n_fixed > 10:
            print(f"WARNING: fixed {n_fixed} rows where top3/top2 violated prize1 identity — "
                  f"consider re-scraping with force_refresh=True")
        else:
            print(f"  [identity fix] corrected {n_fixed} row(s) where top3/top2 ≠ prize1[-3:/-2:]")

    return df


def load_data(force_refresh=False, start_year=1994, progress_callback=None) -> pd.DataFrame:
    """โหลดข้อมูล — ใช้ cache ถ้ามี, scrape ถ้าไม่มี"""
    if not force_refresh and CACHE_FILE.exists():
        df = pd.read_csv(
            CACHE_FILE, encoding="utf-8",
            dtype={col: str for col in LOTTERY_COLS}, parse_dates=["date"],
        )
        df["date"] = pd.to_datetime(df["date"])
        for col, width in LOTTERY_WIDTHS.items():
            df[col] = df[col].apply(_fix_num, width=width)
        return _enforce_prize1_identity(df)

    current_year_ad = datetime.now().year
    current_year_be = current_year_ad + 543
    start_year_be = start_year + 543

    all_rows = []
    total = current_year_be - start_year_be + 1

    for i, year_be in enumerate(range(start_year_be, current_year_be + 1)):
        if progress_callback:
            progress_callback(i / total, f"ดึงข้อมูลปี พ.ศ. {year_be}...")
        rows = scrape_year(year_be)
        all_rows.extend(rows)
        print(f"  {year_be}: {len(rows)} งวด")
        time.sleep(0.4)

    if progress_callback:
        progress_callback(1.0, "เสร็จแล้ว!")

    if not all_rows:
        return pd.DataFrame()

    df = pd.DataFrame(all_rows)
    df["date"] = pd.to_datetime(df["date"])
    df = df.sort_values("date").reset_index(drop=True)
    df.to_csv(CACHE_FILE, index=False, encoding="utf-8")
    return _enforce_prize1_identity(df)


def incremental_update(progress_callback=None) -> pd.DataFrame:
    """Scrape เฉพาะปีปัจจุบัน (+ ปีก่อนถ้าจำเป็น) แล้ว merge กับ cache เดิม"""
    if not CACHE_FILE.exists():
        return load_data(force_refresh=True, progress_callback=progress_callback)

    df_old = pd.read_csv(
        CACHE_FILE, encoding="utf-8",
        dtype={col: str for col in LOTTERY_COLS}, parse_dates=["date"],
    )
    df_old["date"] = pd.to_datetime(df_old["date"])

    current_year_ad = datetime.now().year
    years_to_scrape = [current_year_ad]
    if df_old["date"].max().year < current_year_ad:
        years_to_scrape = [current_year_ad - 1, current_year_ad]

    new_rows = []
    for i, year_ad in enumerate(years_to_scrape):
        year_be = year_ad + 543
        if progress_callback:
            progress_callback(i / len(years_to_scrape), f"ดึงข้อมูลปี พ.ศ. {year_be}...")
        rows = scrape_year(year_be)
        new_rows.extend(rows)
        time.sleep(0.4)

    if progress_callback:
        progress_callback(1.0, "เสร็จแล้ว!")

    if not new_rows:
        return load_data()

    df_new = pd.DataFrame(new_rows)
    df_new["date"] = pd.to_datetime(df_new["date"])

    # ลบปีที่ scrape ใหม่ออกจาก cache เดิม แล้ว concat
    min_new_year = df_new["date"].dt.year.min()
    df_keep = df_old[df_old["date"].dt.year < min_new_year]

    df_merged = pd.concat([df_keep, df_new], ignore_index=True)
    df_merged = df_merged.sort_values("date").reset_index(drop=True)
    df_merged.to_csv(CACHE_FILE, index=False, encoding="utf-8")
    return load_data()


def get_cache_info() -> dict:
    if not CACHE_FILE.exists():
        return {"exists": False}
    df = pd.read_csv(CACHE_FILE, encoding="utf-8", parse_dates=["date"])
    max_date = pd.to_datetime(df["date"]).max()
    days_old = (datetime.now() - max_date).days
    return {
        "exists": True,
        "rows": len(df),
        "modified": datetime.fromtimestamp(CACHE_FILE.stat().st_mtime),
        "min_date": pd.to_datetime(df["date"]).min(),
        "max_date": max_date,
        "days_old": days_old,
        "needs_update": days_old >= 15,
    }
