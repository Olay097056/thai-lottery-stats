# UI Refresh — dark+gold ขัดใหม่ให้พรีเมียม  [wayfinder:map]

## Destination

ยกระดับหน้าตาแอปให้เป็น **"dark+gold แบบเดิมแต่ขัดใหม่ให้พรีเมียม"** โดยวาง **ระบบดีไซน์กลาง 1 ชุด** (design tokens + สเปกคอมโพเนนต์) แล้วพิสูจน์จนสวยจริงบน **3 หน้าเด่น**: Dashboard · ทำนาย/สูตร (ทุกแท็บย่อย) · ไม่รู้ซื้ออะไรดี (Mix) เน้นจอคอม, มือถือ "ไม่พังก็พอ", **ฟีเจอร์และพฤติกรรมเดิมห้ามเปลี่ยน** แผนถือว่าถึงปลายทางเมื่อระบบดีไซน์ถูกล็อกและหน้าเด่นทั้งสามถูกปรับตามระบบจริงบนแอป

## Notes

**Domain:** Thai lottery stats/prediction SPA (FastAPI + vanilla split-file frontend) ธีมมืด macOS + เลขรางวัลสีทอง UI เป็นภาษาไทย

**Override "Plan, don't do":** แผนนี้ **carry execution เข้ามาในแผน** — ตั๋วช่วงลงมือ (03–05) แก้โค้ดจริงจนเห็นผลบนแอป ไม่ใช่แค่ตัดสินใจ (ยืนยันโดยเจ้าของ, การตัดสินใจข้อ 6 = ผสม)

**Skills ที่แต่ละ session ควรใช้:** `/prototype` (ตั๋ว prototype), `/grilling` + `/domain-modeling` (ตั๋วล็อกระบบ), `frontend-design` (ทั้ง prototype และลงมือ) ยืนยันผลบนแอปจริงผ่าน browser preview

**ข้อกำหนดยืนของงานนี้:**
- แตะแค่ CSS + markup เล็กน้อยเพื่อความสวย — **ห้ามแก้ logic JS / พฤติกรรม / ฟีเจอร์**
- คงโครงไฟล์ split เดิม: `static/index.html` (markup), `static/app.css` (CSS ทั้งหมด), `static/app.js`, `static/formula-engine.js` ไม่มี build step
- **bump `?v=` cache-bust ทุกครั้งที่แก้ static** (index.html อ้าง app.css/app.js/formula-engine.js ด้วย `?v=` — ไม่ bump = browser เสิร์ฟไฟล์เก่าแม้ hard reload)
- desktop-first; มือถือแค่ไม่พัง ไม่ใช่เป้าความสวย
- palette คุมด้วย CSS variables ใน `:root` ของ app.css (`--bg`,`--surface`,`--gold`,`--accent` ฯลฯ)

## Decisions so far

- [ทดลองทิศทาง dark+gold 2-3 แบบ บนหน้าตัวอย่าง](issues/01-prototype-dark-gold-directions.md) — เจ้าของเลือก **D — macOS แท้**: การ์ด vibrancy โปร่งแสง + blur, ฟอนต์ระบบ (เลิก Syne), หัวเรื่องขาว, ทอง #ffd60a เฉพาะเลขรางวัล, ปุ่มหลัก system blue — ค่าเต็มอยู่ในตั๋ว/prototype
- [ล็อกระบบดีไซน์กลาง (design tokens + สเปกคอมโพเนนต์)](issues/02-lock-design-system.md) — สเปกล็อกที่ `design-system.md`; tokens ลง `:root` app.css แล้ว (`?v=macos1`): vibrancy เฉพาะจุดเด่น, ทอง #ffd60a เฉพาะเลข+แบรนด์, interactive เป็น system blue, IBM Plex Mono นำ, ไม่มี hover-lift
- [ปรับ Dashboard ตามระบบดีไซน์](issues/03-apply-dashboard.md) — Dashboard ตรงระบบแล้ว (`?v=macos2`): `.card-glass` utility ใหม่บน hero/KPI, การ์ดทึบ+`--shadow-card`, nav active tint น้ำเงิน, card-title ฟอนต์ระบบ, digit box ขอบขาวเลขทอง — กติกากลางเป็น shared หน้าอื่นได้ผลบางส่วนแล้ว
- [ปรับหน้าทำนาย/สูตร (ทุกแท็บย่อย) ตามระบบดีไซน์](issues/04-apply-predict-formula.md) — เก็บทองเก่า hardcode ในโซน predict/DC เป็นทองใหม่ทั้งหมด, ov-caution → ส้ม state, formula-chip.target → tint น้ำเงิน (`?v=macos3`); สีกราฟ JS ยกให้ตั๋ว #06
- [ปรับหน้าไม่รู้ซื้ออะไรดี (Mix) ตามระบบดีไซน์](issues/05-apply-mix.md) — hero เลขผสมเป็น glass + เงาทองใหม่ (`?v=macos4`); ที่เหลือได้จากคอมโพเนนต์กลางอยู่แล้ว ยืนยันบนแอปจริงครบ
- [ปรับธีมกราฟ Chart.js ให้เข้าระบบดีไซน์ macOS แท้](issues/06-chartjs-theme.md) — `chartOpts()` ตัวเดียวครอบ grid/ticks/tooltip ทั้งแอป (tooltip surface radius 8, ฟอนต์ระบบ); freq/lift เป็นทองใหม่ เส้น hit-rate ทองเก่า → accent น้ำเงิน, liftColor mid → ส้ม state (`?v=macos5`) — ยืนยันบนแอปจริง (freq+backtest chart)

## ✅ ถึงปลายทางแล้ว (2026-07-14)

ระบบดีไซน์ถูกล็อก + หน้าเด่นทั้งสามปรับตามระบบจริงบนแอปครบ (ธีมกราฟเป็นโบนัสที่ graduate จาก fog) ไม่มีตั๋วเปิดเหลือ prototype `static/prototype-ui-refresh.html` **ลบแล้ว** (2026-07-14) การทยอยปรับ 4 หน้าที่เหลือใน "Not yet specified" เป็น fog นอกปลายทางเดิม — ถ้าจะทำต้องเปิด effort ใหม่

## Not yet specified

_(ว่าง — fog ทั้งหมด graduate เป็นงานเสร็จแล้ว)_

## Rollout เพิ่มเติม (นอกปลายทางเดิม แต่เจ้าของสั่งทำต่อ 2026-07-14)

- **4 หน้าที่เหลือปรับตามระบบครบแล้ว** (`?v=macos6`): ตารางความถี่ · ผลย้อนหลัง · Backtest ได้ธีมจากคอมโพเนนต์กลางล้วน (ตาราง/การ์ด/ปุ่ม/กราฟ) ไม่มี hardcode เหลือ; จัดชุดซื้อ (bp-*) แก้ 4 จุด — mode toggle เป็น segmented control (surface3), ปุ่ม budget/risk ที่เลือกเป็น accent น้ำเงิน, rank1 row/ticket เป็นทองใหม่ ยืนยันบนแอปจริงทั้ง 4 หน้า ไม่มี console error สี semantic (กลุ่มสูตร/hot-cold/consensus/quality) คงไว้ตามสเปก

## Out of scope

- รื้อ usability / โครงสร้างข้อมูล (IA) — เจ้าของเลือก "ความสวย" ไม่ใช่ usability/IA
- redesign มือถือแบบ mobile-first
- ลบแท็บ "(OLD VER)" หรือแก้/ตัด/เพิ่มฟีเจอร์ใดๆ
- แตะ backend (`main.py`/`analyzer.py`/scraper ฯลฯ)
