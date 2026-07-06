"""
Backfill Sanook data (near1, prize2, prize3) ลงใน lottery_cache.csv
รัน 1 ครั้ง: python enrich_from_sanook.py
ใช้เวลา ~7-10 นาที (776 งวด × 0.5s)
"""
import pandas as pd
from datetime import date
from pathlib import Path
from scraper import CACHE_FILE, ALL_LOTTERY_COLS, SANOOK_COLS, SANOOK_MULTI_COLS, LOTTERY_WIDTHS, _fix_num
from sanook_scraper import scrape_draw

ENRICH_COLS = SANOOK_COLS + SANOOK_MULTI_COLS


def run(resume: bool = True, delay: float = 0.5):
    df = pd.read_csv(
        CACHE_FILE, encoding="utf-8",
        dtype={col: str for col in ALL_LOTTERY_COLS}, parse_dates=["date"],
    )

    # เติมคอลัมน์ใหม่ถ้ายังไม่มี
    for col in ENRICH_COLS:
        if col not in df.columns:
            df[col] = ""

    # เลือกแถวที่ Sanook data ยังไม่ครบ (near1_1 หรือ prize4 ว่าง)
    if resume:
        empty = lambda c: df[c].isna() | (df[c] == "")
        mask = empty("near1_1") | empty("prize4")
        targets = df[mask]
    else:
        targets = df

    # รันจาก newest → oldest เพื่อให้ได้ข้อมูลที่ใช้งานได้ก่อน
    targets = targets.sort_values("date", ascending=False)

    total = len(targets)
    print(f"ต้อง enrich {total} งวด (resume={resume}, newest→oldest)")

    updated = 0
    consecutive_fails = 0
    for i, (idx, row) in enumerate(targets.iterrows()):
        dt = row["date"].date() if hasattr(row["date"], "date") else row["date"]
        print(f"  [{i+1}/{total}] {dt}", end=" ", flush=True)

        sanook = scrape_draw(dt)
        if sanook:
            for col in ENRICH_COLS:
                val = sanook.get(col, "")
                df.at[idx, col] = val
            print(f"✓ prize1={sanook.get('prize1','?')} near1={sanook.get('near1_1','?')}")
            updated += 1
            consecutive_fails = 0
        else:
            print("— ไม่พบ")
            consecutive_fails += 1
            # ถ้าไม่เจอ 30 งวดติด แสดงว่าถึงขีดจำกัดข้อมูลเก่าของ Sanook แล้ว
            if consecutive_fails >= 30:
                print(f"\n[หยุด] ไม่พบ 30 งวดติด — Sanook ไม่มีข้อมูลเก่ากว่านี้")
                break

        # บันทึกทุก 20 งวด
        if (i + 1) % 20 == 0:
            df.to_csv(CACHE_FILE, index=False, encoding="utf-8")
            print(f"  [checkpoint บันทึกแล้ว {updated}/{i+1}]")

        import time
        time.sleep(delay)

    df.to_csv(CACHE_FILE, index=False, encoding="utf-8")
    print(f"\nเสร็จ: enriched {updated}/{total} งวด → {CACHE_FILE}")


if __name__ == "__main__":
    import sys
    force = "--force" in sys.argv
    run(resume=not force)
