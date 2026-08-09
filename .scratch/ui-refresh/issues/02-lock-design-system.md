# ล็อกระบบดีไซน์กลาง (design tokens + สเปกคอมโพเนนต์)

Type: grilling
Status: closed (2026-07-14)
Assignee: claude (claimed 2026-07-14)
Blocked by: 01 (closed)

## Question

แปลงทิศทางที่ชนะจาก #01 ให้เป็น **ระบบดีไซน์กลางที่ล็อกแล้ว** พร้อมให้หน้าเด่นทุกหน้าหยิบไปใช้เหมือนกันหมด

ต้องปักหมุด (ผ่าน `/grilling` + `/domain-modeling`):
- **สี:** โทนพื้น/surface/เส้นขอบ, สเกลทอง (`--gold` ฯลฯ), accent, สี state (success/warn/danger), สีเฉพาะกลุ่มสูตร/ป้าย
- **ระยะห่าง:** สเกล spacing (เช่น 4/8/12/16/24…)
- **Typography:** ฟอนต์ + สเกลขนาด/น้ำหนัก (page-title, card-title, body, เลขรางวัล, mono)
- **Elevation:** ระดับเงาการ์ด, มุมโค้ง (radius)
- **สเปกคอมโพเนนต์:** card, button (primary/secondary), table, badge/chip/trust-badge, เลขรางวัล, nav item, KPI tile — สถานะปกติ/hover/active

**ผลลัพธ์:** เอกสารสเปก (ลิงก์กับตั๋ว) + ชุด CSS variables/utility ใน `:root` ของ `app.css` ที่พร้อมเป็นฐานให้ตั๋วลงมือ 03–05 (การอัปเดตตัวแปรกลางจะช่วยหน้าอื่นบางส่วนโดยอัตโนมัติ) **ยังไม่ปรับหน้าเด่นเต็มๆ ในตั๋วนี้**

**HITL** — การตัดสินสเกล/สเปกเป็นของเจ้าของ

## Resolution (2026-07-14)

Grilling กับเจ้าของ 6 ข้อ ตัดสินครบ ระบบล็อกแล้ว:

1. **Vibrancy เฉพาะจุดเด่น** (hero/KPI/sidebar) — การ์ดเนื้อหาหนาแน่นใช้ surface ทึบ
2. **ทอง = เลขหวย + โลโก้/แบรนด์** — interactive ทั้งหมด (ปุ่มหลัก/ลิงก์/nav active) เป็น system blue; หัวข้อหน้าขาว
3. **ฟอนต์เลข: IBM Plex Mono นำ** (`'IBM Plex Mono','SF Mono',ui-monospace`) — คุมหน้าตาทุกเครื่อง
4. **Palette อนุมัติทั้งตาราง** — gold #ffd60a/#ffe14d/#8f7a10, text #f5f5f7/#aeaeb4/#8e8e93, border .14/.09, เพิ่ม --orange #ff9f0a; สีกลุ่มสูตร/consensus คงเดิม
5. **Geometry อนุมัติ** — spacing 4–32 (--sp-1..7), radius 12/10/8/6/999, เงา --shadow-card, ไม่มี hover-lift บนการ์ด
6. **สเปกคอมโพเนนต์อนุมัติ** — รวม nav active น้ำเงินตัด border-left ทอง, card-title เลิก mono-uppercase

**Assets:**
- สเปกเต็ม: `.scratch/ui-refresh/design-system.md` (แหล่งความจริงเดียวสำหรับตั๋ว 03–05)
- Tokens ลง `:root` ของ `static/app.css` แล้ว + bump `?v=macos1` — ยืนยันบนแอปจริง (gold/mono/spacing ใหม่ active, ไม่มี console error) สีทองใหม่/ขอบ/ตัวหนังสือกระจายทั้งแอปอัตโนมัติแล้ว; การปรับ component ต่อรายหน้าเป็นของตั๋ว 03–05
