import requests
from bs4 import BeautifulSoup
import re

headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}
resp = requests.get("https://myhora.com/lottery/result-2569.aspx", headers=headers, timeout=15)
resp.encoding = "utf-8"
soup = BeautifulSoup(resp.text, "lxml")

# ดู lotto-left div
lotto_left = soup.find("div", class_="lotto-left")
if lotto_left:
    print(f"lotto-left found, children count: {len(list(lotto_left.children))}")
    # ดู direct children
    children = [c for c in lotto_left.children if hasattr(c, 'name') and c.name]
    print(f"Element children: {len(children)}")
    for c in children[:5]:
        print(f"  {c.name}, class={c.get('class')}, text_start={c.get_text(' ', strip=True)[:100]}")

# ลอง: ตาม hyperlink แต่ละ draw แล้วหา lot-id ถัดไปใน DOM order
print("\n=== Parse linearly ===")
DRAW_PATTERN = re.compile(r"/lottery/result-(\d+)-(\d+)-(\d+)\.aspx")
results = []
current_date_info = None

# เดิน tree แบบ linear
for tag in soup.find_all(True):
    # ดูว่าเป็น link ที่มี draw URL ไหม
    if tag.name == "a":
        href = tag.get("href", "")
        m = DRAW_PATTERN.search(href)
        if m and "งวด" in tag.get_text():
            dd, mm, yyyy = m.groups()
            current_date_info = (dd, mm, yyyy, tag.get_text(strip=True))

    # ดูว่าเป็น lot-id ไหม
    if tag.name == "div" and "lot-id" in tag.get("class", []):
        if current_date_info:
            dd, mm, yyyy, label = current_date_info
            text = tag.get_text(" ", strip=True)
            print(f"\nDraw: {label}")
            print(f"  DD={dd} MM={mm} YYYY={yyyy}")
            print(f"  Text: {text[:150]}")
            # extract numbers
            nums6 = re.findall(r"\b\d{6}\b", text)
            nums3 = re.findall(r"\b\d{3}\b", text)
            nums2 = re.findall(r"\b\d{2}\b", text)
            print(f"  prize1: {nums6[:1]}, front3: {nums3[:2]}, back3: {nums3[2:4]}, back2: {nums2[-1] if nums2 else ''}")
            current_date_info = None  # reset ให้หา date ถัดไป
