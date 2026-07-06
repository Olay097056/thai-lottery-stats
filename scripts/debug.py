import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from scraper import load_data
from analyzer import overdue_numbers, predict_numbers, next_thai_draw
from datetime import datetime

df = load_data()
print(f"Loaded: {len(df)} rows")

# test overdue
od = overdue_numbers(df, "top2", top_n=5)
print("\nOverdue top2:")
print(od)

# test next draws
draws = next_thai_draw(datetime.now())
print("\nNext draws:")
for d in draws[:3]:
    print(f"  {d['day']}/{d['month']}/{d['year']} วัน{d['weekday']}")

# test predict
target = draws[0]["date"]
pred = predict_numbers(df, "top2", target, top_n=5)
print(f"\nPrediction for {target.strftime('%d/%m/%Y')}:")
print(pred)
