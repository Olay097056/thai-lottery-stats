"""รัน script นี้เพื่อ scrape ข้อมูลทั้งหมดและบันทึก cache"""
from scraper import load_data
import time

print("เริ่ม scrape ข้อมูลจาก myhora.com...")
print("ใช้เวลาประมาณ 3-5 นาที\n")

start = time.time()
df = load_data(force_refresh=True, start_year=1994)
elapsed = time.time() - start

if df is not None and not df.empty:
    print(f"\nเสร็จแล้ว! {len(df):,} งวด")
    print(f"ช่วง: {df['date'].min().strftime('%d/%m/%Y')} — {df['date'].max().strftime('%d/%m/%Y')}")
    print(f"ใช้เวลา: {elapsed:.1f} วินาที")
    print(f"\nตัวอย่างข้อมูล:")
    print(df.head(3).to_string())
else:
    print("ไม่มีข้อมูล!")
