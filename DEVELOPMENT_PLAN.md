# แผนพัฒนา — Thai Lottery Intelligence Dashboard

> อัปเดตล่าสุด: 2026-07-06 · Phase 1–3.7 เสร็จสมบูรณ์ · Phase 4 (FABLE) กำลังทำ · frontend แยกไฟล์ + จัดระเบียบ path เสร็จ — ดู [CHANGELOG.md](CHANGELOG.md) สำหรับประวัติละเอียด

## สถานะปัจจุบัน

| ส่วน | สถานะ |
|---|---|
| Database | prize1–3 ครบ 777 งวด (myhora) · prize4/5 + near1/2/3 ครบ 456 งวด (sanook, ~2549–ปัจจุบัน) |
| UI | macOS dark skin · 5 หน้า: Dashboard / ทำนาย-สูตร / ตารางความถี่ / ผลย้อนหลัง / Backtest |
| สูตร | A–H + สายมู (ใช้ผลงวดก่อน 1 งวด) + **FABLE** (ใช้ pool รางวัล 1–5, สูตรทดลอง) |
| FABLE promotion gate | **ไม่ผ่าน** — ยังไม่ชนะ baseline สุ่มอย่างมีนัยทั้ง rolling/validation/live |

## กติกาคงที่ (ห้ามละเมิด)

1. ห้ามเพิ่มอะไรใน backtest ที่บิดผล — hit logic ใหม่ต้องแยกคอลัมน์/board ไม่ปนกับ metric เดิม
2. ห้ามเพิ่มเลขวิ่งในสูตรใหม่
3. สูตรใหม่ต้องผ่าน backtest ก่อนขึ้นเป็น "แนะนำ" — ไม่ผ่านติดป้าย "ทดลอง" เสมอ
4. เลขหวยเป็น string เสมอ (คง leading zero) — ห้าม parse เป็น int
5. ห้ามแสดง FABLE เป็นสูตรเด่นบน Dashboard/Decision Center จนกว่าจะผ่าน promotion gate

## Phase 4 — FABLE Formula Lab (กำลังทำ)

**North Star:** ทำให้ FABLE มี edge เชิงสถิติจริงในการทายเลขที่ตรงรางวัลใดก็ได้ใน 1–5 โดยไม่บิด backtest และไม่โปรโมตก่อนผ่านเกณฑ์

**มีแล้ว:** `/api/fable`, `/api/fable-backtest` (รองรับ `gate=true` สำหรับ validation/live), `/api/fable-grid-search`, `/api/fable-holdout-report` · FABLE Lab UI (config controls, rolling edge W50/100/200, grid search, holdout report, snapshot/export) · สัญญาณ: cross-frequency, digit-position, momentum, anti-lag, near-miss, slice-transition, diversity penalty, draw-day (วันที่งวดเป้าหมาย 1 vs 16 + เดือน)

**เกณฑ์ผ่าน promotion gate (ต้องผ่านทุกข้อ):**
- Rolling edge ท้าย 2 เป็นบวกทั้ง W50/W100/W200 และ W200 ≥ +2.0
- Rolling edge ท้าย 3 ไม่ติดลบต่อเนื่อง และ W200 ≥ +0.5
- Validation + live window (ช่วงเก่ากว่า ไม่ทับ rolling) ต้องผ่านเงื่อนไขเดียวกัน
- ทดสอบอย่างน้อย 200 งวด พร้อมแจ้ง sample size ใน UI

**ผลล่าสุด (default config, 200 งวด):** tail2 edge +0.155, tail3 edge −0.025 → **ไม่ผ่าน gate** ทั้ง rolling และ validation/live (validation tail2/tail3 −0.375/−0.5, live −0.35/−0.325) — สรุปว่า FABLE ยังเป็นสูตรทดลอง

**งานถัดไป:** Experiment history compare — เทียบ Snapshot หลายรอบเพื่อดูว่า config ไหนดีซ้ำ ไม่ใช่ดีงวดเดียว

**Definition of Done ของ Phase 4:**
- Experiment รันซ้ำได้ผลเดิมด้วย config เดิม
- ตารางเทียบ default กับ config ทดลองอย่างน้อย 5 ชุด
- รายงาน W50/W100/W200 + holdout แยกจาก train window
- ไม่มีการย้อนแก้ baseline เพื่อให้ผลดูดีขึ้น
- อัปเดต CHANGELOG.md ทุกครั้งหลังรัน experiment จริง
