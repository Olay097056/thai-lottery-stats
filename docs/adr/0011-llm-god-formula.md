# ADR-0011 — LLM GOD ships as a four-stage pipeline on the prize 1-5 pool, permanently ทดลอง

วันที่: 2026-11-16
สถานะ: Accepted
เกี่ยวข้อง: ADR-0009 (RLL live-LLM formula), ADR-0003 (ทดลอง badge)

## บริบท

เจ้าของขอสูตรใหม่ชื่อ **LLM GOD** — 5 ชุด, 5 ชุดนั้นมีโอกาสถูกรางวัลที่ 1,2,3,4,5, ใช้ศักยภาพ LLM สูงสุด
ไม่จำกัด token, อยู่ใน tab สูตรคำนวณเหมือนสูตรอื่น

ก่อนออกแบบ วัดกำลังของฟิลด์เป้าหมายก่อน (กฎของ repo นี้: *วัดกำลังก่อนออกแบบ*) ได้ข้อสรุปที่กำหนดทุกอย่าง:

- 452 งวดมีข้อมูลรางวัล 1-5 ครบ (`_pool_numbers`) จาก 761 งวดที่มีรางวัลที่ 1
- 5 บัตร vs pool 1-5 (168 เลข) → คาดหวังถูก **0.3796 ครั้ง** ทั้งประวัติ ≈ 1 ครั้งต่อ 50 ปี
- ต้องใช้ 37,371 งวด (≈1,557 ปี) เพื่อพิสูจน์ edge +50%

ทางเลือกที่พิจารณาและตัดออก: นับแยกตามชั้นรางวัล (E[คะแนน] เท่ากันเป๊ะทุกชุด 5 ใบ — เป็นการแสดงผล
ไม่ใช่การวัด) และ backtest ย้อนหลัง (ไม่ reproducible; 462 × 4 calls = ประดิษฐ์หลักฐาน)

## การตัดสินใจ

1. **ฟิลด์ที่ให้คะแนนคือ `pool6`** (168 เลข) ใช้ board `Pool 1-5` ที่มีอยู่ — เทียบ I1/I2/J2/Mix ได้ตรง
   ไม่สร้างฟิลด์หรือ baseline ใหม่
2. **4 ขั้นตอนต่อ draw** (`analyse` → `propose` → `critique` → `select`) บน `deepseek/deepseek-v4.1-flash`,
   `temperature 0`, ขั้น `analyse` ได้ประวัติทั้งเล่ม (~133k tokens จาก context 1M)
3. **8 arm** = 4 การวิเคราะห์ × 2 ขนาดชุดผู้สมัคร แต่ละ arm ได้ factsheet ที่คำนวณต่างกันจริง
4. **bandit ให้คะแนนด้วย prize-1 proxy** และเก็บ pool-168 ไว้เป็นตัวอ่านประกอบ (`r_pool`)
5. **คำนวณล่วงหน้า ไม่รอ** — `GET /api/llm-god/formula` ตอบ `pending`/`running` แล้ว job เขียน record
   เบื้องหลัง เพราะ pipeline ใช้ 36-104 วินาที
6. **HitL allowlist แบบเดียวกับ RLL** — `fr.group==='LLMGOD'` ผ่าน gate `edge>0` ได้ด้วย edge 0
7. **DB แยก** `astra_runtime/llm_god.sqlite3`, protocol `llm-god-v1`, ไม่แตะ `rll.sqlite3`
8. **ทดลองถาวร** — ไม่มีเกตเลื่อนขั้น เพราะไม่มีเกตใดผ่านได้

## ผลที่ตามมา

- **ห้ามพิมพ์ตัวเลข expected hits ด้วยมืออีก** — มี `_corpus_stats()` คำนวณจาก `pool_draws` ที่ pipeline
  โหลดจริง และเก็บ `corpus_draws` / `pool_mean_size` / `expected_hits` ลง payload · การ์ดอ่านจาก response
  ไม่ใช่จาก literal · ค่า 0.388/462 เดิมไม่มีโค้ดไหนสร้างได้ (loader ให้ 451 ก่อน target, 452 ทั้ง cache)
  และมันหลุดไปทั้งการ์ด PRD ADR และ commit message ก่อน arena จับได้

- การ์ดต้องพกตัวเลข expected_hits/corpus_draws ที่ **คำนวณจาก corpus จริง** (0.3796 ใน 452 งวด) และประโยค "ทุกใบมีโอกาสเท่ากันในทุกชั้นรางวัล" — ไม่ใช่เชิงอรรถ
- `pool6` baseline ใน `FORMULA_BT_FIELD_META` และ `dcFormulaBaseP` ใช้ต่อได้ทันที (168/10⁶) และต้องคง
  `null` สำหรับฟิลด์ที่ไม่รู้จักไว้ — การคืน `0` เคยทำให้ "ไม่มี baseline" อ่านเป็น "โอกาส 0%" แล้ว hit ใด ๆ
  กลายเป็น edge บวก
- แถว Backtest เป็น prospective shape ล้วน (`total:0`, `edge:null`) และ push ด้วย **group key** `'LLMGOD'`
  ไม่ใช่ label — RLL push ด้วย label ทำให้ `_GRP` lookup พลาดและแถวออกมาเป็นสี `var(--text3)`
- reward loop ต้องถูกเรียกจาก **ทั้งสอง** cache-write path (`_invalidate_dataframe()` และ `/api/refresh`)
  เพราะ hook ที่ต่อไว้ทางเดียวคือ hook ที่ตาย — RLL ใช้เวลาเป็นสัปดาห์กว่าจะรู้ว่า arms ค้างที่ n=0
- ถ้า provider เลิกให้บริการ `deepseek-v4.1-flash` หรือเปลี่ยนชื่อ endpoint จะต้อง bump protocol
  (`llm-god-v2`) และรีเซ็ต posterior เพราะ arm ที่ถูกเขียน prompt ใหม่คือ policy คนละตัวอย่างแท้จริง

## ทางเลือกที่ถูกปฏิเสธ

| ทางเลือก | เหตุผลที่ปฏิเสธ |
| :--- | :--- |
| ใช้ `prize1_exact` เป็นฟิลด์ | คาดหวัง 0.002 ครั้งในประวัติ — ต่ำกว่าอีก 200 เท่า |
| นับคะแนนแยกชั้นรางวัล | E[คะแนน] เท่ากันทุกชุด 5 ใบ (59.000000 / 0.000830 / 0.063130) |
| backtest ย้อนหลัง 452 งวด | ไม่ reproducible และ fabricate หลักฐาน |
| synchronous ต่อหน้าเว็บ | 36-104 วินาที ยาวเกินกว่าหน้าจะรอ |
| ใช้ DB เดียวกับ RLL | ปน protocol และ reward สองแบบที่ให้คะแนนคนละความหมาย |
| arm แบบ RLL (slices ของข้อมูล) | ประวัติทั้งเล่มอยู่ใน prompt เดียวแล้ว การ slice ข้อมูลจึงไม่ต่างกันจริง — ต้องต่างที่ **คำถาม** |
