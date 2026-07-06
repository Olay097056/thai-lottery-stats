"""
Scraper ดึงผลสลากฯ จาก news.sanook.com/lotto/check/DDMMYYYY/
ดึงรางวัลที่ 1-3 + ข้างเคียง + เลขหน้า/ท้าย 3 ตัว + เลขท้าย 2 ตัว
"""
import re
import time
import json
import requests
from datetime import datetime, date
from pathlib import Path

HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
_RETRY_DELAYS = (0, 2, 5)

# คอลัมน์ใหม่ที่เพิ่มเข้า schema
NEW_COLS = (
    ["near1_1", "near1_2"] +
    [f"prize2_{i}" for i in range(1, 6)] +
    [f"prize3_{i}" for i in range(1, 11)]
)
NEW_COL_WIDTHS = {c: 6 for c in NEW_COLS}  # ทุกรางวัลใหม่เป็น 6 หลัก


def _be_url(dt: date) -> str:
    """แปลง date → URL Sanook เช่น 2026-06-16 → check/16062569/"""
    be_year = dt.year + 543
    return f"https://news.sanook.com/lotto/check/{dt.day:02d}{dt.month:02d}{be_year}/"


def _fetch_article_body(dt: date) -> str | None:
    url = _be_url(dt)
    for delay in _RETRY_DELAYS:
        if delay:
            time.sleep(delay)
        try:
            r = requests.get(url, headers=HEADERS, timeout=15)
            if r.status_code in (404, 503, 502, 500):
                return None  # ไม่มีข้อมูล ไม่ retry
            r.raise_for_status()
            r.encoding = "utf-8"
            # หา JSON-LD NewsArticle
            for m in re.finditer(r'<script[^>]+type="application/ld\+json"[^>]*>(.*?)</script>', r.text, re.S):
                try:
                    obj = json.loads(m.group(1))
                    if obj.get("@type") == "NewsArticle" and obj.get("articleBody"):
                        return obj["articleBody"]
                except Exception:
                    continue
            return None
        except Exception as e:
            print(f"  sanook fetch error {url}: {e}")
    return None


def _nums(text: str) -> list[str]:
    """ดึง 6-digit numbers จาก text"""
    # แทน &nbsp; และ whitespace แล้ว split
    cleaned = re.sub(r"&nbsp;|\xa0", " ", text)
    return [t.strip() for t in re.split(r"[\s,]+", cleaned) if re.match(r"^\d{5,6}$", t.strip())]


def _nums2(text: str) -> list[str]:
    """ดึง 2-digit numbers"""
    cleaned = re.sub(r"&nbsp;|\xa0", " ", text)
    return [t.strip() for t in re.split(r"[\s,]+", cleaned) if re.match(r"^\d{2}$", t.strip())]


def _nums3(text: str) -> list[str]:
    """ดึง 3-digit numbers"""
    cleaned = re.sub(r"&nbsp;|\xa0", " ", text)
    return [t.strip() for t in re.split(r"[\s,]+", cleaned) if re.match(r"^\d{3}$", t.strip())]


def parse_article_body(body: str) -> dict:
    """
    Parse articleBody text → dict ของผลหวย
    คืน dict ที่มี keys: prize1, top3, top2, front3_1/2, back3_1/2, bottom2,
                          near1_1/2, prize2_1..5, prize3_1..10
    """
    result: dict[str, str] = {}

    # ตัด &nbsp; ออก แล้วแบ่งตาม \n
    body = re.sub(r"&nbsp;|\xa0", " ", body)
    lines = [l.strip() for l in body.split("\n") if l.strip()]

    def _collect_nums(start_idx: int, digit_len: int) -> list[str]:
        nums: list[str] = []
        for li in lines[start_idx:]:
            if re.search(r"รางวัล|ผลสลาก", li):
                break
            found = [t for t in re.split(r"\s+", li) if re.match(rf"^\d{{{digit_len}}}$", t)]
            nums.extend(found)
            if nums:
                break  # หยุดหลังได้ตัวเลขแล้ว (บางรางวัลอยู่บรรทัดเดียว)
        return nums

    def _collect_nums_multiline(start_idx: int, digit_len: int, max_count: int) -> list[str]:
        nums: list[str] = []
        for li in lines[start_idx:]:
            if re.search(r"รางวัล|ผลสลาก", li) and not re.match(rf"^\d{{{digit_len}}}", li):
                break
            found = [t for t in re.split(r"\s+", li) if re.match(rf"^\d{{{digit_len}}}$", t)]
            nums.extend(found)
            if len(nums) >= max_count:
                break
        return nums[:max_count]

    for i, line in enumerate(lines):
        if "รางวัลที่ 1" in line and "ข้างเคียง" not in line:
            nums = _collect_nums(i + 1, 6)
            if nums:
                result["prize1"] = nums[0]

        elif "เลขหน้า 3 ตัว" in line:
            nums = _collect_nums(i + 1, 3)
            if len(nums) >= 1:
                result["front3_1"] = nums[0]
            if len(nums) >= 2:
                result["front3_2"] = nums[1]

        elif "เลขท้าย 3 ตัว" in line:
            nums = _collect_nums(i + 1, 3)
            if len(nums) >= 1:
                result["back3_1"] = nums[0]
            if len(nums) >= 2:
                result["back3_2"] = nums[1]

        elif "เลขท้าย 2 ตัว" in line:
            nums = _collect_nums(i + 1, 2)
            if nums:
                result["bottom2"] = nums[0]

        elif "ข้างเคียงรางวัลที่ 1" in line:
            nums = _collect_nums_multiline(i + 1, 6, 2)
            for j, n in enumerate(nums[:2]):
                result[f"near1_{j+1}"] = n

        elif "รางวัลที่ 2" in line or "ผลสลาก" in line and "รางวัลที่ 2" in line:
            nums = _collect_nums_multiline(i + 1, 6, 5)
            for j, n in enumerate(nums[:5]):
                result[f"prize2_{j+1}"] = n

        elif ("รางวัลที่ 3" in line) or ("ผลสลาก" in line and "รางวัลที่ 3" in line):
            nums = _collect_nums_multiline(i + 1, 6, 10)
            for j, n in enumerate(nums[:10]):
                result[f"prize3_{j+1}"] = n

        elif "รางวัลที่ 4" in line:
            # 50 ใบ — เก็บเป็น string เดียวคั่น space (ไม่แตก 50 คอลัมน์)
            nums = _collect_nums_multiline(i + 1, 6, 50)
            if nums:
                result["prize4"] = " ".join(nums[:50])

        elif "รางวัลที่ 5" in line:
            # 100 ใบ
            nums = _collect_nums_multiline(i + 1, 6, 100)
            if nums:
                result["prize5"] = " ".join(nums[:100])

    # คำนวณ top3/top2 จาก prize1
    if "prize1" in result and len(result["prize1"]) == 6:
        result.setdefault("top3", result["prize1"][-3:])
        result.setdefault("top2", result["prize1"][-2:])

    return result


def scrape_draw(dt: date) -> dict | None:
    """ดึงผลหวย 1 งวด คืน dict หรือ None ถ้าไม่พบ"""
    body = _fetch_article_body(dt)
    if not body:
        return None
    data = parse_article_body(body)
    if not data.get("prize1"):
        return None
    return {"date": dt.strftime("%Y-%m-%d"), **data}


def scrape_range(dates: list[date], delay: float = 0.5) -> list[dict]:
    """ดึงหลายงวด ส่ง list[date] คืน list[dict]"""
    results = []
    for i, dt in enumerate(dates):
        print(f"  [{i+1}/{len(dates)}] {dt}", end=" ")
        row = scrape_draw(dt)
        if row:
            print(f"✓ prize1={row.get('prize1')}")
            results.append(row)
        else:
            print("— ไม่พบ")
        if i < len(dates) - 1:
            time.sleep(delay)
    return results


if __name__ == "__main__":
    # ทดสอบงวดล่าสุด
    from datetime import date
    dt = date(2026, 7, 1)
    print(f"ทดสอบ {dt} ...")
    row = scrape_draw(dt)
    if row:
        for k, v in row.items():
            print(f"  {k}: {v}")
    else:
        print("ไม่พบข้อมูล")
