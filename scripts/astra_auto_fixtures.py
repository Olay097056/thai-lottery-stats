"""Synthetic fixtures only. Never load cached or published lottery outcomes."""
import csv
from datetime import date, timedelta
import json


MONTHS = ('มกราคม กุมภาพันธ์ มีนาคม เมษายน พฤษภาคม มิถุนายน กรกฎาคม สิงหาคม กันยายน '
          'ตุลาคม พฤศจิกายน ธันวาคม').split()


def draw(day=date(2026, 10, 1), seed=0):
    first = f"{123 + seed:06d}"
    row = {"date": day.isoformat(), "year": str(day.year), "month": str(day.month),
           "day": str(day.day), "weekday": "พฤหัสบดี", "prize1": first,
           "top3": first[-3:], "top2": first[-2:],
           "front3_1": "001", "front3_2": "002", "back3_1": "003", "back3_2": "004",
           "bottom2": "05", "near1_1": "000122", "near1_2": "000124"}
    row.update({f"prize2_{i}": f"{200 + i + seed * 5:06d}" for i in range(1, 6)})
    row.update({f"prize3_{i}": f"{300 + i + seed * 10:06d}" for i in range(1, 11)})
    row["prize4"] = " ".join(f"{400 + i + seed * 50:06d}" for i in range(50))
    row["prize5"] = " ".join(f"{4000 + i + seed * 100:06d}" for i in range(100))
    return row


def history():
    return [draw(date(2026, 8, 9) + timedelta(days=i), i) for i in range(24)]


def body(row):
    blocks = [
        ("รางวัลที่ 1 รางวัลละ 6,000,000 บาท", [row['prize1']]),
        ("รางวัลเลขหน้า 3 ตัว 2 รางวัลๆละ 4,000 บาท", [row['front3_1'], row['front3_2']]),
        ("รางวัลเลขท้าย 3 ตัว 2 รางวัลๆละ 4,000 บาท", [row['back3_1'], row['back3_2']]),
        ("รางวัลเลขท้าย 2 ตัว รางวัลละ 2,000 บาท", [row['bottom2']]),
        ("รางวัลข้างเคียงรางวัลที่ 1", [row['near1_1'], row['near1_2']]),
        ("ผลสลากกินแบ่งรัฐบาล รางวัลที่ 2", [row[f'prize2_{i}'] for i in range(1, 6)]),
        ("ผลสลากกินแบ่งรัฐบาล รางวัลที่ 3", [row[f'prize3_{i}'] for i in range(1, 11)]),
        ("ผลสลากกินแบ่งรัฐบาล รางวัลที่ 4", row['prize4'].split()),
        ("ผลสลากกินแบ่งรัฐบาล รางวัลที่ 5", row['prize5'].split()),
    ]
    return '\n'.join(heading + '\n' + '&nbsp; '.join(numbers) for heading, numbers in blocks)


def page(row, *, article_body=None, url=None):
    d = date.fromisoformat(row['date'])
    url = url or f'https://news.sanook.com/lotto/check/{d.day:02d}{d.month:02d}{d.year+543}/'
    article = {'@type': 'NewsArticle', 'headline': f'ตรวจหวย {d.day} {MONTHS[d.month-1]} {d.year+543} ผลสลากกินแบ่งรัฐบาล',
               'mainEntityOfPage': {'@id': url}, 'articleBody': body(row) if article_body is None else article_body}
    return '<script type="application/ld+json">'+json.dumps(article, ensure_ascii=False)+'</script>'


def write_cache(path, rows):
    with path.open('w', encoding='utf-8', newline='') as stream:
        writer = csv.DictWriter(stream, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)
