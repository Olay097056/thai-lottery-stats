import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from scraper import scrape_year

for be in [2568, 2560, 2537]:
    rows = scrape_year(be)
    print(f"ปี {be} (ค.ศ.{be-543}): {len(rows)} งวด")
    if rows:
        r = rows[0]
        print(f"  ตัวอย่าง: {r['date'].strftime('%d/%m/%Y')} prize1={r['prize1']} top2={r['top2']} bottom2={r['bottom2']}")
