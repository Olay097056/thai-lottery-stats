# PRD: HM2 · Hermes ท้าย3 (ใต้ดิน) + HM3 · Hermes ท้าย3 ทางการ — เป้า pool 1-4 ท้าย 3 ตัว และ เลขท้าย 3 ตัวทางการ · 10 ชุด · ทดลองถาวร

สถานะ: ✅ = ล็อกผ่าน grilling แล้ว · 🔶 = rec รอเจ้าของอนุมัติ

## Problem Statement

HM · Hermes Pool 1-4 (เลขเต็ม 6 หลัก, PRD-hermes-pool-1-4.md) วัดผลจริงบน 457 งวด: **ถูก 2 ครั้ง** vs ค่า chance 0.30 → **6.6x เหนือความบังเอิญ** (Poisson P(X≥2 | λ=0.3) ≈ 0.037) — หลักฐาน (อ่อนแต่จริง) ว่า **กลไก value-weighted digit-frequency ของ Hermes จับสัญญาณจริง** ไม่ใช่แค่ลางสังหรณ์

**แต่** เป้าเต็ม 6 หลักโหดเกินกว่าจะเห็นผลบ่อย: ต่องวด 1 ชุดถูก = 66/1,000,000 (0.0066%) → 10 ชุด × 457 งวด = ~0.30 ครั้งตลอดประวัติ เป็นค่าที่สายตามนุษย์อ่านแล้ว "แม่งโคตรเอา" ทั้งที่จริงคือเหนือ chance (บทเรียนจากรอบ HM)

**ทางออก (เจ้าของอนุมัติ 2026-08-11): สูตรท้าย 3 ตัว 2 ตัวใหม่ในตระกูล Hermes:**

| สูตร | เป้า | เกม | คาดถูกทั้งประวัติ (457 งวด) |
|---|---|---|---|
| **HM2 · Hermes ท้าย3 ใต้ดิน** ✅ | ท้าย 3 ตัวของเลขใน pool รางวัล 1–4 (66 เลข → ~64/1000) | หวยใต้ดิน (ท้าย 3 ตัว) — **mark ชัดในชื่อ** | **~221 ครั้ง** (48.3%/งวด) |
| **HM3 · Hermes ท้าย3 ทางการ** ✅ | เลขท้าย 3 ตัวทางการ (back3_1/back3_2 — ออกรางวัลแยก 2 ตัว, 4,000฿) | สลากกินแบ่งรัฐบาล รางวัลเลขท้าย 3 ตัว | **~9 ครั้ง** (1.98%/งวด) |

**ฟิสิกส์ของทั้ง 2 เป้า (พูดตรงๆ ก่อนเขียนโค้ด):**
- HM2: pool 1–4 = 66 เลข → ท้าย 3 ตัวไม่ซ้ำที่คาดหวัง ≈ 1000×(1−0.999^66) ≈ **~64/1000** ต่องวด → ต่อ candidate p1 ≈ 0.0639 → 10 ชุด **baseP ≈ 48.3%/งวด** → คาด ~221 ครั้ง · SE ≈ 2.3% ที่ 457 งวด (2σ ≈ ±4.6pts) → **edge จะอยู่ใน noise — ไม่ควรคาดหวัง edge ชัด**; จุดขายคือความถี่ (ถูกบ่อยกว่า HM ~700 เท่า)
- HM3: เลขท้าย 3 ตัวทางการ = **การออกรางวัลแยกอิสระ uniform 000–999** (ไม่ใช่ท้ายของรางวัลที่ 1 — เช็คจากข้อมูล: `back3_1`/`back3_2` เป็นคอลัมน์แยก) → **ไม่มีสัญญาณใดเอาชนะ chance ได้โดยโครงสร้าง** — คาดถูก ~9 ครั้ง/457 งวด (2/1000 ต่อ candidate); "gate" ใดๆ = ละคร (ADR-0003 verdict แรงสุด) → สูตรนี้คือ **สลากบนสลาก**: เลขที่ Hermes เลือกให้ ยิงรางวัล 4,000฿ จริงได้ แต่โอกาส = chance ล้วน — ต้องรายงานแบบนี้ใน CHANGELOG เสมอ

**หมายเหตุ baseline board back3 เดิม (ไม่แก้ — กติกาคงที่ข้อ 1):** `FORMULA_BT_FIELD_META.back3` ให้ baseP = k/10 (k=10 → 1.0%) ซึ่ง**ต่ำกว่าความจริง** 2k/1000 = 2.0% (รางวัลมี 2 ตัว) — edge ของ HM3 ในตารางจะดูบวม ~1pt; รับรู้ไว้ในรายงาน อย่าไปแก้ของเดิม

## Solution

สูตรใหม่ 2 ตัว อยู่ใน `_computeFormulasBatch` (group key `'HM'` ทั้งคู่ — reuse badge/สี/กลไกเดิมทั้งหมด) มีส่วนร่วมใน Picks + กลไก เลขแนะนำ ระดับเดียวกับ HM/J2 (pool6-family: badge ทดลอง propagate, **ไม่**แสดงการ์ด เลขแนะนำ — `back3`/`pool14_tail3` ไม่มีใน `DC_RECO_FIELDS` อยู่แล้ว ตรวจแล้ว)

### HM2 · Hermes ท้าย3 ใต้ดิน (✅ D1: board `pool14_tail3` ใหม่)
1. **อินพุต = `_buildPrize1to4Pool(prevRow)` เดิม (65 เลข: prize2×5 + prize3×10 + prize4×50, น้ำหนัก 5:2:1)** — reuse เป๊ะ (source of truth เดียว)
2. **`_hermesTail3Formula(prevRow, topN=10)`** — value-weighted digit freq เฉพาะ**ตำแหน่งท้าย (3,4,5)** ของ pool อินพุต → จัดอันดับ 0–9 ต่อหลัก (tie-break digit น้อยก่อน) → `_imperialRoundRobin(rankedDigits, topN, 8)` ประกอบ 3 หลัก (K=8 หลักไม่ซ้ำต่อตำแหน่ง)
3. **Field ใหม่ `pool14_tail3`** ใน `FORMULA_BT_FIELD_META`: `{typeLabel:'ท้าย3 ใต้ดิน', board:'Pool 1-4', widths:[3], base:(k)=>({baseP:(1-Math.pow(1-0.06390,k))*100, baseLabel:`${k} vs ~64/1000`})}` — **แยกจาก `pool_tail3` เดิม (Pool 1-5, dormant)** → กติกาคงที่ข้อ 1 ผ่าน
4. **Hit check**: `if(fr.field==='pool14_tail3')return preds.some(n=>pools.pool14Tail3Set?.has(n));` — `pool14Tail3Set = new Set([...pool14Set].map(v=>v.slice(-3)))`
5. **ชื่อมีคำว่า "ใต้ดิน" ติดตัว** (✅ เจ้าของสั่ง mark ให้คนใช้รู้) — ปรากฏทุกจุด: การ์ด, แถว backtest, dropdown, Picks

### HM3 · Hermes ท้าย3 ทางการ (✅ เป้าอนุมัติ — 🔶 D8/D9 กลไกตาม rec)
1. **เป้า = เลขท้าย 3 ตัวทางการ**: field **`back3` เดิม** (board '3-digit exact' — C3 ยิง board นี้อยู่แล้ว) → **ไม่ต้องสร้าง field/board ใหม่** (กติกาคงที่ข้อ 1 ไม่ถูกรบกวน: ใช้ hit logic เดิมเป๊ะ)
2. **`_hermesOfficialTail3Formula(prevRow, topN=10)`** (🔶 D9 rec) — กลไก Hermes signature เดิม แต่**ส่องตำแหน่งหน้า (0,1,2)** ของ pool 1-4 (กระจกเงาของ HM2 ที่ส่องท้าย): weighted freq 5:2:1 → จัดอันดับ → `_imperialRoundRobin` ประกอบ 3 หลัก — เหตุผล: (a) ต่างจาก HM2 จริง (คนละตำแหน่ง → คนละ ranking → คนละ candidate — user story 6) (b) คงลายเซ็น "อินพุต 1 งวด + freq ล้วน ไม่เลขคณิต" ของตระกูล (c) อธิบายการ์ดได้: "หลักหน้าของรางวัลใหญ่ (2/3) คือน้ำหนักที่ Hermes ตาม — ฝั่งกระจกของ HM2" — **ย้ำอีกครั้ง: เป้าเป็น uniform draw → กลไกคือ branding/consistency ไม่ใช่ edge จริง** (PRD นี้พูดตรงๆ ไว้แล้ว)
3. **`baseline` = ของ board back3 เดิม (k/10)** — ไม่แก้ meta เดิม; รายงาน edge ตามจริงโดยรับรู้ bias ~1pt
4. **ชื่อ 'HM3 · Hermes ท้าย3 ทางการ'** — ต่างกับ HM2 ชัดเจนที่ชื่อ (ทางการ vs ใต้ดิน)

### ร่วมกัน
- **Batch push** ทั้งคู่: `{name:'HM2 · Hermes ท้าย3 ใต้ดิน'|'HM3 · Hermes ท้าย3 ทางการ', group:'HM', preds:<formula>(prev,10), field:'pool14_tail3'|'back3', baseline:10, trust:'ทดลอง'}` — push เฉพาะ preds ไม่ว่าง (งวดก่อนมี pool 1–4 ครบ) เหมือน HM
- **UI**: การ์ดทำนาย tab (กลไกเดิม) + **การ์ดอธิบายวิธีคิด tab สูตรคำนวณ** (เข้า `hermesCards` — data-group=\"HM\" มาจาก `_formulaGroupKey` ที่ `startsWith('HM')→'HM'` อยู่แล้ว) + แถว backtest (HM2 board 'Pool 1-4' typeLabel 'ท้าย3 ใต้ดิน' / HM3 board '3-digit exact') + สรุป 'สูตร Hermes (pool 1-4)' รวม HM+HM2+HM3
- **`_formulaTargetLabel`**: เพิ่ม pattern เรียงลำดับ — `if(/ท้าย3.*ทางการ/.test(title))return 'Target: เลขท้าย 3 ตัวทางการ (2 รางวัล · 4,000฿)';` → `if(/ท้าย3/.test(title))return 'Target: ท้าย 3 ตัว pool 1-4 (ใต้ดิน · ~64/1000)';` → (เดิม `/Pool 1-4/` สำหรับ HM) — กัน label หลุด
- **Badge**: ใช้ `_GRP['HM']` เดิม — **ไม่เพิ่ม group ใหม่** → `test_bp_group_map_sync.js` เขียวโดยไม่แก้

## User Stories

1. ในฐานะเจ้าของ ฉันต้องการให้ HM2 ผลิตเลขท้าย 3 ตัว 10 ชุดต่องวด (weighted freq ตำแหน่งท้าย 5:2:1 จาก pool 1-4 งวดก่อน) — ถูกบ่อยกว่า HM เต็ม 6 หลัก ~700 เท่า (คาด ~221 ครั้ง)
2. ในฐานะเจ้าของ ฉันต้องการให้ HM2 **mark ชัดว่าเป็นเกมใต้ดิน** (ในชื่อสูตร + การ์ดอธิบาย) เพื่อไม่ให้คนใช้เข้าใจผิดว่าเป็นรางวัลทางการ
3. ในฐานะเจ้าของ ฉันต้องการให้ HM3 ผลิตเลขท้าย 3 ตัว 10 ชุดต่องวด (กลไก Hermes เดิม ส่องหลักหน้า) เพื่อยิง **รางวัลเลขท้าย 3 ตัวทางการ (4,000฿)** จริง — "สู้ไปเลย" บนสนามทางการ
4. ในฐานะเจ้าของ ฉันต้องการเห็นการ์ดทั้งคู่บนหน้า ทำนาย + tab สูตรคำนวณ (steps ไทย) + ป้าย ทดลอง + กลุ่มสี HM เดียวกัน
5. ในฐานะเจ้าของ ฉันต้องการแถว backtest: HM2 ใต้ board 'Pool 1-4' (field ใหม่ `pool14_tail3`, baseline ~64/1000), HM3 บน board '3-digit exact' เดิม (field `back3`) — ไม่แตะ metrics เดิม (กติกาคงที่ข้อ 1)
6. ในฐานะเจ้าของ ฉันต้องการให้ candidate HM2/HM3 ต่างจากกันและจาก HM/I1/I2/J2/Mix จริง (เทส fixture บังคับ) — HM3 ไม่ใช่แค่ HM2 copy
7. ในฐานะเจ้าของ ฉันต้องการให้ทั้งคู่มีส่วนร่วมใน Picks/เลขแนะนำ ระดับ J2 (badge ทดลอง propagate ผ่าน group 'HM'; ไม่แสดงการ์ด เลขแนะนำ — pool6-family exclusion เดิม) และ **ไม่**ปน 'H' ของมิสเตอร์ซี
8. ในฐานะเจ้าของ ฉันต้องการให้ตารางเปรียบเทียบ Board Pool 1-4 เดิม (hit-set 66 เลขเต็ม 6 หลัก) **ข้ามแถว preds 3 หลัก** (HM2/HM3 เทียบไม่เข้าเกณฑ์) เพื่อไม่ให้โชว์ 0/457 หลอกตา
9. ในฐานะเจ้าของ ฉันต้องการให้ PRD นี้ระบุค่าคงที่ (p1≈0.0639 / baseP≈48.3% / 2/1000) และนิยาม hit-set ไว้ล่วงหน้า (pre-commitment) + **บันทึกความจริงว่า HM3 เอาชนะ chance ไม่ได้โดยโครงสร้าง** เพื่อวัดย้อนหลังได้ตรงเงื่อนไข

## Implementation Decisions

**ล็อกแล้ว (✅):**
- D1: HM2 board = `pool14_tail3` (ท้าย 3 ของ pool 1–4, 66 เลข) — ผ่าน grilling 2026-08-11
- D2: อินพุตทั้งคู่ = `_buildPrize1to4Pool` เดิม (65 เลข, ไม่รวม prize1, น้ำหนัก 5:2:1)
- D4: ชื่อ = 'HM2 · Hermes ท้าย3 ใต้ดิน' / 'HM3 · Hermes ท้าย3 ทางการ', group:'HM' ทั้งคู่ (mark ใต้ดินติดชื่อตามเจ้าของสั่ง)
- D6: trust = ทดลอง ถาวร ทั้งคู่ (ADR-0003; HM3 = ungateable by construction)
- D7: สรุปหน้า สูตรคำนวณ label 'สูตร Hermes (pool 1-4)' รวม 3 การ์ด (counts.HM = hermesCards.length)

**🔶 rec รออนุมัติ (คำถามเดียวสุดท้าย):** — ✅ **อนุมัติครบ 2026-08-11 (เจ้าของ: "ลุย")**
- D3: HM2 ใช้เฉพาะตำแหน่งท้าย (3,4,5) — ✅ ใช่ (ตำแหน่งหน้าเป็น noise สำหรับเป้าท้าย)
- D5: topN = 10 ทั้งคู่ — ✅ ใช่ (เท่ากันทั้งตระกูล — เปรียบเทียบแฟร์)
- D8: HM3 ใช้ field `back3` เดิม (ไม่สร้าง field ใหม่) — ✅ ใช่ (กติกาคงที่ข้อ 1 + C3 อยู่ board นี้แล้ว)
- D9: HM3 กลไก = weighted freq ตำแหน่งหน้า (0,1,2) — ✅ ใช่ (กระจกเงา HM2, candidate ต่างจริง)
- D10: ใต้ดิน marker เพิ่มเติมนอกชื่อ: การ์ดอธิบาย note 'สำหรับหวยใต้ดิน (ท้าย 3 ตัว)' + CHANGELOG — ✅ ใช่

**หมายเหตุคณิตศาสตร์ (ค้นพบตอนเตรียมเทส — เอกสารต้องตรงความจริง):** candidate ชุด 0–7 ของ HM2 **ซ้อนกับ tail3 ของ candidate ชุด 0–7 ของ HM พอดี** — เพราะ `_imperialRoundRobin` ที่ lap=0 ใช้ rank เดียวกันทุกตำแหน่ง และ ranking ตำแหน่งท้าย (3,4,5) เป็นชุดเดียวกับที่ HM ใช้ → ผลลัพธ์ตามโครงสร้าง ไม่ใช่บั๊ก; ชุด 8–9 (lap=1) ต่างกัน (offset เยื้องไม่เท่ากัน) → HM2 มี candidate ใหม่จริง 2 ชุด + ตัวตนอิสระจาก front digits; จุดขายคือ board เป้าอ่อนลง (ถูกบ่อย) ไม่ใช่กลไกใหม่ — เทสจึง assert "overlap ≤ 8" ไม่ใช่ "ไม่ซ้อนเลย"

**รายละเอียดโค้ด (formula-engine.js):**
- `_hermesTail3Formula(prevRow, topN=10)`: pool = `_buildPrize1to4Pool(prevRow)`; `counts[3..5][digit] += w`; ranked → `_imperialRoundRobin(ranked.map(r=>r.map(e=>e.digit)), topN, 8)`
- `_hermesOfficialTail3Formula(prevRow, topN=10)`: เดียวกันแต่ `counts[0..2][digit] += w`
- `FORMULA_BT_FIELD_META.pool14_tail3` (ตาม D1): p1 คงที่ **0.06390** (1−0.999^66) ประกาศล่วงหน้า
- `_formulaHitForField`: branch `pool14_tail3` → `pools.pool14Tail3Set?.has(n)`; HM3 ใช้ branch `back3` เดิม (ไม่แตะ)
- backtest loop: `const pool14Tail3Set=new Set([...pool14Set].map(v=>v.slice(-3)));` + bucket `s.pool14t3={hits,total}` (วัดซ้ำทุก producer — แยกจาก s.pool14)
- **ตารางเปรียบเทียบ s.pool14 เดิม: guard `p.length===6`** ก่อน `pool14Set.has(p)` — preds 3 หลัก (HM2/HM3/C3 ฯลฯ) ถูกข้าม ไม่โชว์ 0/457 หลอกตา (User Story 8)
- `_formulaTargetLabel`: 3 pattern ใหม่เรียงก่อนหน้า (ทางการ → ท้าย3 → Pool 1-4 เดิม)
- `_renderFormulaSummary`: label 'สูตร Hermes (pool 1-4)' (D7)
- การ์ด tab สูตรคำนวณ: `_mkFormulaCard(...)` × 2 — HM2 note='สำหรับหวยใต้ดิน (ท้าย 3 ตัว)' (D10); render ต่อใน `hermesCards` section เดียวกับ HM

**ไม่ต้องแก้:** `_GRP`/`BP_GROUP_MAP` (D4), `dcRecommendedNumbers` group-key, `DC_RECO_FIELDS` (exclude โดย design — ตรวจแล้ว back3/pool14_tail3 ไม่มีในลิสต์), meta `back3` เดิม (กติกาคงที่ข้อ 1), backend, กลุ่ม A–I/Mix/Buy Plan

## Testing Decisions

ไฟล์ใหม่ `scripts/test_hermes_tail3.js` (vm-extract, fixture ล้วน — แบบ `test_hermes_pool14.js`):
- `_hermesTail3Formula`: 10 ชุด, ทุกชุด 3 หลัก, K=8 ต่อตำแหน่ง, ชุด 0 = อันดับ 1 ทั้ง 3 ตำแหน่ง; **เปลี่ยน digit ตำแหน่ง 0–2 ของ fixture → output ไม่เปลี่ยน** (พิสูจน์ว่าใช้เฉพาะท้าย)
- `_hermesOfficialTail3Formula`: 10 ชุด, K=8; **เปลี่ยน digit ตำแหน่ง 3–5 → output ไม่เปลี่ยน** (พิสูจน์ว่าใช้เฉพาะหน้า); weighted ranking ตรงมือคำนวณ
- Distinctness: HM3 (front) ต่างจาก HM2/HM/I1/I2/J2/Mix เต็มชุด (fixture เดียวกัน); **HM2 ซ้อนกับ tail3(HM) ได้ ≤ 8 ชุด (lap=0 — ตามหมายเหตุคณิตศาสตร์) แต่ ≠ HM3 และ ≠ I1/I2/J2/Mix**
- Skip: pool ว่าง → `[]` ทั้งคู่ (ไม่มี fallback)
- Backtest integration: แถว HM2 field `pool14_tail3` (typeLabel 'ท้าย3 ใต้ดิน', board 'Pool 1-4') + แถว HM3 field `back3`; group:'HM', trust ทดลอง; hit ตรง fixture (HM2 vs pool14Tail3Set, HM3 vs back3_1/back3_2)
- Target label: HM2 → 'Target: ท้าย 3 ตัว pool 1-4 (ใต้ดิน · ~64/1000)'; HM3 → 'Target: เลขท้าย 3 ตัวทางการ (2 รางวัล · 4,000฿)'; HM เดิม → label เดิมไม่เปลี่ยน
- Comparison-column guard: fixture preds 3 หลัก → ไม่ถูกนับใน s.pool14 (ไม่โชว์ 0/457)
- Regression: suite เดิมเขียวทั้งหมด — `test_hermes_pool14.js`, `test_bp_group_map_sync.js` (ไม่แตะ _GRP), `test_experimental_badge_propagation.js`, `test_reco_producer_groups.js`, `test_tycoon_formula.js` (C3/back3 เดิมไม่เปลี่ยน)
- Browser verify (workflow โปรเจกต์): การ์ด HM2 (note ใต้ดิน) + HM3 บน ทำนาย; dropdown กลุ่ม HM มี 3 สูตร; การ์ดอธิบายวิธีคิด tab สูตรคำนวณ (steps ครบ, data-group=\"HM\"); แถว backtest 2 แถวใหม่ + คอลัมน์เปรียบเทียบเดิมไม่โชว์ 0/457 หลอกตา; ไม่มี console error; cache-bust มีผล

## Out of Scope

- **ไม่แก้ `DC_RECO_FIELDS` / `DC_RECO_PRODUCER_GROUPS`** — pool6-family + back3 ไม่แสดงการ์ด เลขแนะนำ โดย design; HM2/HM3 เข้าร่วมแค่ computation/badge ระดับ J2
- **ไม่แตะ meta/hit logic ของ `back3` เดิม** (C3/D3/X3 ไม่กระทบ) — HM3 แค่ push แถวใหม่เข้าบอร์ดเดิม
- **ไม่แตะ `pool_tail3` เดิม** (board Pool 1-5, dormant) — ไม่ใช่เป้าของใบนี้
- **ไม่ search ค่าใดๆ** (p1, น้ำหนัก 5:2:1, K=8, topN=10, ตำแหน่งหน้า/ท้าย) — ประกาศล่วงหน้าทั้งหมด (ADR-0003); holdout หมดแล้ว (J1 ใช้)
- **ไม่มี promotion path** ทั้งคู่ — ทดลองถาวร; \"221 ครั้ง\" ของ HM2 = ความถี่ baseline ไม่ใช่หลักฐานฝีมือ; HM3 = ungateable by construction (uniform draw)
- ไม่รวม near1/prize5 ในเป้า; ไม่แตะ backend / กลุ่ม A–I / Mix / EV & Buy Plan

## Further Notes

- ตัวเลขจริง (วัดจาก `lottery_cache.csv` 779 งวด, 457 งวดมี pool ครบ): p1 = 1−0.999^66 ≈ **0.0639** · baseP(10) ≈ **48.3%** → HM2 คาด ~221 ครั้ง · HM3: 2/1000 ต่อ candidate → baseP(10) ≈ **1.98%** → คาด ~9 ครั้ง — ตรวจซ้ำตอน implement
- `pool14Tail3Set` ใช้ expectation ~64/1000 เป็น baseline คงที่ (convention เดียวกับ `pool_tail3` ~155/1000) — ไม่คำนวณขนาด set จริงต่องวด
- **ความจริงที่ต้องรายงาน (HM3):** เลขท้าย 3 ตัวทางการออกรางวัลแยกอิสระ — ถ้า HM3 ได้ edge บวกชัด (>2σ) นานๆ = เรื่องบังเอิญ/ต้องตรวจ methodology; ถ้า edge ราวๆ 0 = ตรงตามฟิสิกส์ — เขียนแบบนี้ใน CHANGELOG
- ธรรมเนียม: ผ่าน **grilling** ครบก่อน implement (เหลือ D3/D5/D8/D9/D10 — ถามครั้งเดียวรวม); cache-bust `?v=` ทั้ง 3 ไฟล์ static; CHANGELOG.md (ไทย, ลงวันที่) / DEVELOPMENT_PLAN.md / CLAUDE.md / CONTEXT.md ต้องอัปเดตพร้อมกัน
