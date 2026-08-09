# ปรับ Dashboard ตามระบบดีไซน์

Type: task
Status: closed (2026-07-14)
Assignee: claude (claimed 2026-07-14)
Blocked by: 02 (closed)

## Question

ใช้ระบบดีไซน์ที่ล็อกจาก #02 กับหน้า **Dashboard** (`page-dashboard` ใน `static/index.html`; loader ใน `app.js`) ให้สวยจริงบนแอป

ครอบคลุม: `dash-hero` (เลขรางวัลที่ 1 ใหญ่), side KPI stack (งวดถัดไป/ข้อมูลล่าสุด/งวดทั้งหมด), การ์ด insight 3 ใบ (Top 10 ร้อน, 5 งวดล่าสุด, สูตรเด่นงวดนี้), Prize1 widget, ตาราง 15 งวดล่าสุด

**ข้อกำหนด:** เปลี่ยนแค่ look (CSS + markup เท่าที่จำเป็น) — ห้ามแก้ logic/พฤติกรรม, bump `?v=`, ยืนยันผลบนแอปจริงผ่าน browser preview (ไม่มี console error, ข้อมูลยังโหลดครบ)

**ผลลัพธ์:** Dashboard ตรงตามระบบดีไซน์ + ถ้าเจอคอมโพเนนต์ที่ขาด/ต้องเสริมในระบบ ให้ feedback กลับไป fog/#02

## Resolution (2026-07-14)

พบว่า app.css มี mac skin block เดิมท้ายไฟล์อยู่แล้ว — งานจริงคือจูนให้ตรง `design-system.md` ที่ล็อกใน #02:

- `.card` เปลี่ยนจาก gradient โปร่ง → **ทึบ `--surface` + `--shadow-card`**; เพิ่ม utility **`.card-glass`** (`--surface-glass` + `--glass-blur`) ใส่ให้ dash-hero-main + KPI 3 ใบ (markup) — vibrancy เฉพาะจุดเด่นตามข้อตกลง
- `.nav-item.active`: จากพื้นน้ำเงินทึบตัวขาว → **tint `rgba(10,132,255,.12)` ตัว/ไอคอน `--accent`** ตามสเปก
- `.card-title`: เลิก mono-uppercase → ฟอนต์ระบบ 600 `.78rem` `--text3`
- `.btn-primary`: flat `--accent` hover `brightness(1.12)`; `.btn` ใช้ `--radius-btn`; `.btn-secondary` ตามสเปก
- `.digit-box`: พื้น `rgba(255,255,255,.07)` ขอบขาว `.5px` radius `--radius-digit` เลขทอง `--gold` 600
- `.dash-status.warn` → `--orange`; `.dash-link` → `--accent`; row hover ตาราง → `.04`
- bump `?v=macos2`

ยืนยันบนแอปจริง: computed styles ตรงสเปกทุกจุด, เลขรางวัล/ตาราง 15 งวดโหลดครบ, ไม่มี console error หมายเหตุ: กติกากลาง (.card/.btn/.card-title ฯลฯ) เป็น shared — หน้าอื่นได้ผลบางส่วนอัตโนมัติ ตั๋ว 04/05 เหลือเก็บรายละเอียดเฉพาะหน้า
