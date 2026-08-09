# ทดลองทิศทาง dark+gold 2-3 แบบ บนหน้าตัวอย่าง

Type: prototype
Status: closed (2026-07-14)
Assignee: claude (claimed 2026-07-14)
Blocked by: —

## Question

"dark+gold ขัดใหม่ให้พรีเมียม" หน้าตาจริงเป็นแบบไหน? ตัดสินด้วยตา ไม่ใช่คำพูด

สร้าง prototype ทิ้ง (throwaway, ใช้ `/prototype` + `frontend-design`) **2-3 ทิศทาง** บน **สไลซ์ตัวแทน** ของ UI จริง — แนะนำ: Dashboard hero (เลขรางวัลที่ 1 ใหญ่) + KPI cards + การ์ด insight หนึ่งใบ + ตัวอย่างป้าย/ปุ่ม/เลขรางวัล (องค์ประกอบครบพอให้ตัดสินได้) ทั้งหมดต่อยอดจาก palette เดิม ไม่เปลี่ยนคาแรกเตอร์ ดำ+ทอง

ทิศทางที่ควรลองให้ต่างกันจริง เช่น:
- **ต่อยอด subtle** — ขัดระยะห่าง/เงา/ลำดับชั้น typography เฉยๆ คาแรกเตอร์เดิมเป๊ะ
- **ดันทองให้มีมิติ** — ทอง/แสง/gradient มากขึ้น พรีเมียมจัดแบบเสี่ยงโชค
- **fintech คม** — ลดทองลงนิด เพิ่มคอนทราสต์/ความคมของตัวเลข (ยังมืด+ทอง)

รวม **ทดสอบฟอนต์**: คงชุดเดิม (Syne display / IBM Plex Mono ตัวเลข / Noto Sans Thai) หรือมีทางเลือกที่ดีกว่า

**ผลลัพธ์:** ทิศทางที่เจ้าของเลือก 1 อัน (+ องค์ประกอบที่ชอบจากตัวที่ไม่ชนะ) ลิงก์ไฟล์ prototype ไว้กับตั๋วนี้ — ป้อนเข้าตั๋วล็อกระบบ (#02)

**HITL** — ต้องให้เจ้าของเลือกเอง ห้ามตัดสินแทน

## Assets

- Prototype (throwaway): `static/prototype-ui-refresh.html` — เปิดที่ `http://localhost:8510/static/prototype-ui-refresh.html` สลับด้วย `?variant=a|b|c` หรือแถบลอยล่างจอ / ปุ่มลูกศร
  - **A — ขัดเงา (subtle refine):** palette + ฟอนต์ชุดเดิมเป๊ะ (Syne / IBM Plex Mono / Noto Sans Thai) ขัดเงา: เงาหลายชั้น, ไฮไลต์ขอบบนการ์ด, digit box มี hairline ทอง, ระยะห่างหลวมขึ้น
  - **B — ทองมีมิติ (dimensional gold):** พื้นหลังอุ่นโทนทอง, digit box เรืองแสง gradient ทอง, หัวเรื่อง gradient metallic, ฟอนต์ display ทดลองสลับเป็น Fraunces (serif), ปุ่มหลัก pill ทอง, radial glow หลัง hero
  - **C — fintech คม (sharp):** พื้นน้ำเงินเข้มเกือบดำ, ทองเหลือเฉพาะเลขรางวัล, ฟอนต์เลขทดลองสลับเป็น Space Grotesk, radius แคบ 6-8px, ไม่มีเงา, label tracking กว้าง, accent ฟ้าคมขึ้น
  - **D — macOS แท้ (native mac):** เพิ่มตามคำขอเจ้าของ — วัสดุ vibrancy โปร่งแสง blur 28px, ฟอนต์ระบบ SF Pro/-apple-system, ทอง = system yellow (#ffd60a) เฉพาะเลข, ปุ่มหลักน้ำเงิน system blue, label ไม่ uppercase, เงาบางแบบ mac
- คำตัดสินเจ้าของ: **เลือก D — macOS แท้ (native mac)** ไม่ได้ขอหยิบองค์ประกอบจากตัวอื่น

## Resolution (2026-07-14)

เจ้าของดู 4 ทิศทางบน prototype แล้วเลือก **D — macOS แท้** (ทิศทางนี้เพิ่มระหว่าง session ตามคำขอเจ้าของ "ขอแบบ MAC OS" — ไม่ใช่ 3 ตัวตั้งต้นในตั๋ว):

- **วัสดุ:** การ์ด vibrancy โปร่งแสง `background:rgba(255,255,255,.055)` + `backdrop-filter:blur(28px) saturate(1.3)` บนพื้น gradient `#212124→#161618`; border ครึ่งพิกเซล `rgba(255,255,255,.09)`; เงาเบา ไม่มี glow
- **ฟอนต์:** ระบบ — `-apple-system/'SF Pro Display'/'Segoe UI Variable Display'/'Segoe UI'/'Noto Sans Thai'` สำหรับ display+label (label ไม่ uppercase, tracking ปกติ, น้ำหนัก 600); เลขใช้ `'SF Mono'/ui-monospace/'IBM Plex Mono'` → **เลิกใช้ Syne เป็น display**
- **สี:** หัวเรื่องขาว `#f5f5f7` (ไม่ทอง); ทอง = system yellow `#ffd60a` เฉพาะตัวเลขรางวัล/ป้ายเลข; ปุ่มหลัก system blue `#0a84ff` ตัวหนังสือขาว; text tiers `#f5f5f7/#aeaeb4/#8e8e93`
- **รูปทรง:** radius 12px การ์ด / 10px digit box / 8px ปุ่ม; padding 18px; gap 14px

ค่าทั้งหมดอยู่ในบล็อก `body[data-variant="d"]` ของไฟล์ prototype — ตั๋วล็อกระบบดีไซน์ (#02) ใช้เป็น input ตรงๆ ได้ prototype ยังไม่ลบ เก็บไว้จนตั๋ว #02 แปลงเป็น design tokens เสร็จ
