# ปรับธีมกราฟ Chart.js ให้เข้าระบบดีไซน์ macOS แท้

Type: task
Status: closed (2026-07-14)
Assignee: claude (claimed 2026-07-14)
Blocked by: 02 (closed)

## Question

กราฟ Chart.js ทั้งแอป (เส้น trend, แท่ง digit-freq, heatmap ฯลฯ) ยังใช้สีชุดเดิม — ปรับ grid/แกน/label/เส้น/จุด/tooltip ให้ตรง `design-system.md`:

- grid/แกน: `--border2` โทน, label สี `--text3` ฟอนต์ระบบ
- ชุดสี series: นำด้วย `--accent` น้ำเงิน, ทอง `--gold` เฉพาะ series ที่เป็น "เลข/รางวัล", state colors ตาม token
- tooltip: พื้น surface ทึบ radius 8 ตามสเปกคอมโพเนนต์
- ห้ามแตะ logic ข้อมูล — เฉพาะ options/สี (อาจอยู่ใน `app.js` ส่วน Chart.js wiring; แก้ได้เพราะเป็น presentation ไม่ใช่ behavior)

**AFK** — ค่าทุกตัว derive จากระบบที่ล็อกแล้ว ไม่มีการตัดสินใหม่ของเจ้าของ (ถ้าเจอทางแยกจริง ให้ยกกลับมาเป็นคำถาม)

## Resolution (2026-07-14)

กราฟทุกตัว route ผ่าน `chartOpts()` ตัวเดียวใน app.js → แก้ที่นั่นครอบ grid/ticks/tooltip ทั้งแอป; สี series เป็น inline ต่อ dataset (`?v=macos5`):

**chartOpts() ธีมใหม่** (อ่าน CSS var จริงตอน runtime): grid `rgba(255,255,255,.09)`, ticks/legend/title `--text3` ฟอนต์ระบบ, tooltip พื้น `--surface2` ทึบ + ขอบ + `cornerRadius:8` ตัวหนังสือ `--text` ฟอนต์ระบบ

**สี series ตามกติกา "ทอง=เลขเท่านั้น":**
- freq-chart (ความถี่ตัวเลข = กราฟเลข) → แท่งทองใหม่ `rgba(255,214,10,.7)` ✓
- bt-lift-chart palette → เขียว `#30d158` / น้ำเงิน `#0a84ff` / ทอง `#ffd60a` (leg รางวัล) / เทา
- เส้น hit-rate ที่เคยเป็นทอง (เลขแนะนำ, Mix) → **accent น้ำเงิน** (ไม่ใช่กราฟเลข ทองจึงไม่เหมาะ)
- เส้น hit-rate เขียว + `liftColor()` → align token: เขียว `#30d158`, mid-tier จากทองเก่า → ส้ม state `#ff9f0a`, แดง `#ff453a`

ไม่มี Chart.js heatmap (heatmap เป็น CSS grid) ไม่แตะ logic ข้อมูล

**ยืนยันบนแอปจริง:** freq-chart เรนเดอร์ (แท่งทองใหม่ grid/tick token), รัน backtest จริง → bt-lift-chart palette ใหม่ครบ 4 สี, chartOpts ให้ tooltip/grid/font ถูกทุกค่า, ไม่มี console error
