# แผนพัฒนา — Thai Lottery Intelligence Dashboard

> อัปเดตล่าสุด: 2026-07-07 · Phase 1–3.7 เสร็จสมบูรณ์ · Phase 4 (FABLE) ถูกยกเลิก · Phase 5 (จักรพรรดิ/จักรพรรดิทองคำ) เสร็จสมบูรณ์ · frontend แยกไฟล์ + จัดระเบียบ path เสร็จ · หน้า "สรุปงวดนี้" (Decision Center) ปรับปรุงใหม่ (ตัดซ้ำซ้อน + track record + edge badge) เสร็จสมบูรณ์ — ดู [CHANGELOG.md](CHANGELOG.md) สำหรับประวัติละเอียด

## สถานะปัจจุบัน

| ส่วน | สถานะ |
|---|---|
| Database | prize1–3 ครบ 777 งวด (myhora) · prize4/5 + near1/2/3 ครบ 456 งวด (sanook, ~2549–ปัจจุบัน) |
| UI | macOS dark skin · 5 หน้า: Dashboard / ทำนาย-สูตร / ตารางความถี่ / ผลย้อนหลัง / Backtest |
| สูตร | A–H + สายมู (ใช้ผลงวดก่อน 1 งวด) + **I จักรพรรดิ/จักรพรรดิทองคำ** (ใช้ผลงวดก่อน 1 งวด เจาะจง pool รางวัล 1-5, ไม่มี promotion gate) |

## กติกาคงที่ (ห้ามละเมิด)

1. ห้ามเพิ่มอะไรใน backtest ที่บิดผล — hit logic ใหม่ต้องแยกคอลัมน์/board ไม่ปนกับ metric เดิม
2. ห้ามเพิ่มเลขวิ่งในสูตรใหม่
3. สูตรใหม่ต้องผ่าน backtest ก่อนขึ้นเป็น "แนะนำ" — ไม่ผ่านติดป้าย "ทดลอง" เสมอ
4. เลขหวยเป็น string เสมอ (คง leading zero) — ห้าม parse เป็น int

## Phase 4 — FABLE Formula Lab (ยกเลิกแล้ว, 2026-07-06)

FABLE (สูตรที่ใช้ rolling history หลายงวด + pool รางวัล 1–5) ไม่ผ่าน promotion gate หลังจากพยายามปรับหลายรอบ (grid search 20 configs, rolling W50/W100/W200, validation/live window) — ผลล่าสุด: tail2 edge +0.155, tail3 edge −0.025 บน rolling, ติดลบทั้งคู่บน validation/live ตัดสินใจ**ยกเลิกทั้งหมด**แทนที่จะพัฒนาต่อ (`fable_formula.py`, `/api/fable*` endpoints, FABLE Lab UI ถูกลบออกจากระบบทั้งหมด) แล้วเปลี่ยนไปใช้แนวทางใหม่ที่อ้างอิงงวดก่อนหน้าเดียว (ดู Phase 5)

กลไก backtest ที่ใช้ร่วมกัน (เทียบว่าเลขที่ทายตรงกับ pool รางวัล 1–5 ของงวดนั้นไหม) ยังเก็บไว้ — เปลี่ยนชื่อ field type จาก `fable6`/`fable_pool3` เป็น `pool6`/`pool_tail3` เพื่อไม่ให้ชื่อยึดติดกับ FABLE ที่ถูกลบไปแล้ว

## Phase 5 — จักรพรรดิ / จักรพรรดิทองคำ (เสร็จสมบูรณ์, 2026-07-07)

แทนที่แนวทาง FABLE ด้วยสูตรใหม่ที่อ้างอิง**เฉพาะงวดก่อนหน้า 1 งวด** (เหมือนกลุ่ม A-H) แต่ยังคงเป้าหมายเดิม (ทายเลข 6 หลักที่มีโอกาสตรงรางวัล 1-5) โดยนับความถี่ของแต่ละหลัก (position 1-6) จาก pool รางวัลรองของงวดก่อนหน้า (~168 เลข) — ดูรายละเอียดที่ `PRD-replace-fable-with-imperial-formulas.md`

**จักรพรรดิ (ISSUE-6) — เสร็จแล้ว:** `_buildPrize1to5Pool` (สร้าง pool จาก near1+prize2-5 ของงวดก่อนหน้า) + `_digitPosFreq` (นับความถี่เลขต่อหลัก, reusable) + `_imperialCandidates` (cartesian expansion+dedupe, reusable) + `_imperialFormula` (top-2 ต่อหลัก, จัดอันดับด้วย freqScore, คัด ~10 ชุด) ใน `formula-engine.js` แสดงทั้งในหน้า "ทำนาย" (กลุ่ม I dropdown) และตาราง backtest (badge "I · จักรพรรดิ", field `pool6`) เป็นสูตรปกติทันที ไม่มี promotion gate/ป้ายทดลอง

**จักรพรรดิทองคำ (ISSUE-7) — เสร็จแล้ว:** `_imperialGoldFormula` ใช้ `_digitPosFreq`/`_imperialCandidates` เดิม ผสม 80% freqScore + 20% ความใกล้เคียงเชิงระยะห่างของตัวเลข (ไม่ใช่ exact-match — พบว่า exact-match ทำให้ 20% ไม่มีผลจริงกับข้อมูลจริงเลย ดู CHANGELOG.md) กับเลขคณิตจากกลุ่ม D (`prize1 + วัน×เดือน×ปี ของงวดถัดไป`) ยืนยันแล้วว่า candidate set ต่างจากจักรพรรดิจริงทุกงวด แสดงเป็น "I2 จักรพรรดิทองคำ" ใต้ badge เดียวกัน
