# PRD: Hermes Pool 1-4 — สูตรทายเลขเต็ม 6 หลัก เป้า pool รางวัล 1–4 (66 เลข) · 10 ชุด · ทดลองถาวร

## Problem Statement

เจ้าของต้องการสูตรใหม่ที่ทาย**เลขเต็ม 6 หลักให้ตรงรางวัลที่ 1/2/3/4** ของงวดถัดไป จำนวน 10 ชุด ชื่อ "Hermes Pool 1-4" โดยมีเป้าหมาย **เหนือกว่าทุกสูตรที่มีอยู่** (I1 จักรพรรดิ, I2 จักรพรรดิทองคำ, J2 เจ้าสัว, Mix) บนเป้าหมายนี้

สูตร pool6 ที่มีอยู่ทั้งหมดทาย **pool 1–5 (168 เลข)** — prize5 (100 เลข) เป็นส่วนที่เจือจางสัญญาณที่สุด: hit ที่เกิดขึ้นส่วนใหญ่มาจากรางวัลที่ 5 (จ่าย 20,000฿) ซึ่งไม่ใช่เป้าหมายของเจ้าของ Hermes จำกัดเป้าเหลือ **รางวัลที่ 1 (1 เลข) + ที่ 2 (5 เลข) + ที่ 3 (10 เลข) + ที่ 4 (50 เลข) = 66 เลข** — "ล่าโจ๊กเกอร์คุณภาพ": ถูกครั้งหนึ่งได้ 40,000–6,000,000฿

**ฟิสิกส์ของเป้าหมาย (ต้องพูดตรงๆ ก่อนเขียนโค้ด):** ข้อมูลที่มี pool ครบ = **458 งวด** (sanook ~2549–ปัจจุบัน) · ความน่าจะเป็นที่เลข 1 ชุดตรง pool 1–4 = 66/1,000,000 → 10 ชุด × 458 งวด ≈ **0.30 ครั้งที่คาดว่าจะถูกโดยบังเอิญตลอดทั้งประวัติศาสตร์** — เบาบางกว่า J2 (pool 1–5, ~0.77) ซึ่ง ADR-0003 ตัดสินไว้แล้วว่า "ไม่มี gate ใดแยกฝีมือจากโชคได้ — gate ที่ผ่านจะเป็นแค่การแสดงละคร" → **Hermes ติดป้าย ทดลอง ถาวร ไม่มี promotion path** เช่นเดียวกับ J2 คำว่า "เหนือกว่าทุกสูตร" จึงหมายถึง: ชนะบน**ตารางเปรียบเทียบ board เดียวกัน** (วัดตรงๆ ว่าใครได้ hit มากกว่าบน pool 1–4) ไม่ใช่การพิสูจน์เชิงสถิติ — ถ้าทุกสูตรได้ 0 hit (โอกาสสูง) ผลคือ "เทียบไม่ได้" และต้องรายงานอย่างนั้นตามปรัชญาโปรเจกต์

## Solution

สูตรใหม่ 1 ตัว ชื่อ **HM · Hermes Pool 1-4** — อยู่ใน `_computeFormulasBatch` (group key `'HM'`) มีส่วนร่วมใน Picks และกลไก เลขแนะนำ (convergence computation + badge ทดลอง propagate) ในระดับเดียวกับ J2 — ต้อง refactor group-key extraction เล็กน้อย (ดู Implementation Decisions) แสดงผลบน: ทำนาย tab (การ์ด + dropdown กลุ่มสูตร), **tab สูตรคำนวณ (การ์ดอธิบายวิธีคิด — เจ้าของต้องการให้เห็นสูตรที่คิดค้นใหม่ชัดเจน)**, ตาราง backtest (แถวใหม่ + ตารางเปรียบเทียบ Board Pool 1-4)

1. **`_buildPrize1to4Pool(row)`** — pool อินพุตจาก**งวดก่อนหน้า**: `prize2_1..5` + `prize3_1..10` + `prize4` (50 เลข, string คั่น space) = **65 เลข** ไม่รวม prize1/near1/prize5 (ตาม convention ของ `_buildPrize1to5Pool` ที่ไม่ใช้ prize1 เป็นอินพุต) · field ว่าง = ข้าม ไม่ padStart กลบ
2. **`_hermesPool14Formula(prevRow, topN=10)`** — **value-weighted digit-position frequency** (ลายเซ็น Hermes):
   - นับความถี่รายหลัก (ตำแหน่ง 0–5) เหมือน `_digitPosFreq` แต่**ถ่วงน้ำหนักตามมูลค่ารางวัล**: ตัวเลขจาก prize2 ×**1.0**, prize3 ×**0.5**, prize4 ×**0.2** (ค่าคงที่ประกาศล่วงหน้า — design decision, ไม่ search เพราะ search บน field นี้ = theater ตาม ADR-0003)
   - เหตุผลของน้ำหนัก: prize4 มี 50 เลข คุมสัดส่วน 77% ของ pool ดิบ → ถ่วงแล้วเหลือ ~50% ของมวลสัญญาณ ทำให้เสียงจากรางวัลใหญ่ (2/3) ขึ้นมาเป็นตัวชี้ขาดจริง
   - จัดอันดับ 0–9 ต่อหลัก → ประกอบ **10 ชุด** ผ่าน `_imperialRoundRobin(K=8)` (reuse เดิม — การันตี K=8 หลักไม่ซ้ำต่อตำแหน่ง)
3. **Field type ใหม่ `pool6_14`** ใน `FORMULA_BT_FIELD_META`: board **"Pool 1-4"**, `baseP = 1-(1-66/1e6)^k` (baseline แฟร์ต่อ candidate) — ตามกติกาคงที่ข้อ 1 (hit logic ใหม่แยก board ไม่ปนกับ `pool6`)
4. **ตารางเปรียบเทียบ "Board Pool 1-4"** ใต้ตาราง backtest หลัก: ทุกสูตร pool6 producer (I1/I2/J2/Mix/Hermes) ถูกวัด**ซ้ำ**กับ hit-set pool 1–4 (66 เลข) ของงวดจริง — พื้นที่พิสูจน์ "เหนือกว่าทุกสูตร" แบบตรงไปตรงมา
5. Badge **"HM · Hermes Pool 1-4"** สีใหม่ (ไม่ซ้ำ `_GRP` ทั้ง 10 กลุ่ม + Mix) + ป้าย `ทดลอง` ตามกลไก `trust` เดิม; เข้า `_GRP` ด้วย key `'HM'` (พร้อม mirror ใน app.js ให้ drift-guard test `test_bp_group_map_sync.js` ผ่าน)

## User Stories

1. ในฐานะเจ้าของ ฉันต้องการให้ Hermes ผลิตเลขเต็ม 6 หลัก 10 ชุดต่องวด (อินพุต = งวดก่อนหน้า 1 งวดเท่านั้น เหมือนสูตรทั้งหมดหลัง FABLE) เพื่อใช้ทายรางวัล 1–4 ของงวดถัดไป
2. ในฐานะเจ้าของ ฉันต้องการให้ Hermes ใช้ `_buildPrize1to4Pool` + `_imperialRoundRobin` ที่มีอยู่ (reuse ไม่ก็อปปี้ — convention เดียวกับ I2/J2) เพื่อให้กลไกประกอบชุดมี source of truth เดียว
3. ในฐานะเจ้าของ ฉันต้องการเห็นการ์ด Hermes บนหน้า ทำนาย (live) พร้อมเลข 10 ชุด + ป้าย ทดลอง เพื่อเทียบกับสูตรอื่นด้วยตา
4. ในฐานะเจ้าของ ฉันต้องการแถว Hermes ในตาราง backtest ภายใต้คอลัมน์ board "Pool 1-4" แยกจาก pool 1-5 (กติกาคงที่ข้อ 1) เพื่อดู Edge/ความถี่ถูกของ Hermes โดยเฉพาะ
5. ในฐานะเจ้าของ ฉันต้องการ**ตารางเปรียบเทียบ Board Pool 1-4** ที่วัด I1/I2/J2/Mix/Hermes ด้วยเกณฑ์เดียวกัน (10 ชุด, hit-set 66 เลข) เพื่อตอบคำถาม "เหนือกว่าทุกสูตรไหม" อย่างตรงไปตรงมา
6. ในฐานะเจ้าของ ฉันต้องการให้ Hermes **มีส่วนร่วม**ใน Picks และกลไก เลขแนะนำ (ระดับเดียวกับ J2 — badge ทดลอง propagate, ไม่ gate การมีส่วนร่วม ตาม ADR-0003 decision #6) โดยใช้ group key `'HM'` เพื่อไม่ให้ 'H' ปนเข้า `experimentalGroups` และทำให้เลขแนะนำของมิสเตอร์ซีติดป้ายทดลองปลอม
7. ในฐานะเจ้าของ ฉันต้องการให้ Hermes ข้ามการผลิตเลขเมื่องวดก่อนหน้าไม่มีข้อมูล pool 1–4 (เช่นเดียวกับ I/J ข้ามงวดไร้ Sanook) เพื่อไม่ให้ total ใน backtest เจือจางด้วยงวดที่ทายไม่ได้ตั้งแต่แรก
8. ในฐานะเจ้าของ ฉันต้องการให้ candidate ของ Hermes **ต่างจาก** I1/I2/J2/Mix จริงทุกงวด (บังคับด้วยเทส fixture) เพื่อไม่ให้เป็นแค่การติดป้ายใหม่ของสูตรเดิม
9. ในฐานะเจ้าของ ฉันต้องการให้เอกสาร (CLAUDE.md, DEVELOPMENT_PLAN.md, CHANGELOG.md, CONTEXT.md glossary) บันทึก Hermes พร้อมเหตุผล ทดลองถาวร เพื่อไม่ให้ docs ล้าสมัยซ้ำแบบ FABLE
10. ในฐานะเจ้าของ ฉันต้องการให้ PRD นี้ระบุค่าคงที่ W2/W3/W4 และนิยาม pool 1–4 อย่างชัดเจน เพื่อให้การวัดผลย้อนหลังทำได้ตรงเงื่อนไขที่ประกาศไว้ (pre-commitment)
11. ในฐานะเจ้าของ ฉันต้องการเห็น**การ์ดอธิบายวิธีคิดของ Hermes** บน tab สูตรคำนวณ (steps ภาษาไทย: pool 65 เลข → ถ่วงน้ำหนัก 5:2:1 → จัดอันดับรายหลัก → ประกอบ 10 ชุด) เพื่อให้เห็นว่าสูตรที่คิดค้นใหม่คำนวณยังไง ต่างจากสูตรอื่นตรงไหน

## Implementation Decisions

**โค้ด (`static/formula-engine.js`):**
- `_buildPrize1to4Pool(row)` — copy โครงสร้าง `_buildPrize1to5Pool` (แถว prize2_1..5, prize3_1..10, prize4 split space) ตัด near1/prize5 ออก — ~10 บรรทัด
- `_hermesPool14Formula(prevRow, topN=10)` — weighted freq ต่อหลัก: `count[pos][d] += W(tier)` โดย W = {prize2:1.0, prize3:0.5, prize4:0.2} → ranked 0–9 (tie-break: digit น้อยก่อน, เหมือน `_digitPosFreq`) → `_imperialRoundRobin(rankedDigits, topN, 8)`
- `FORMULA_BT_FIELD_META.pool6_14 = {typeLabel:'Pool 1-4', board:'Pool 1-4', widths:[6], base:(k)=>({baseP:(1-Math.pow(1-66/1e6,k))*100, baseLabel:`${k} vs pool66/10⁶`})}`
- `_formulaHitForField`: เพิ่ม branch `if(fr.field==='pool6_14')return preds.some(n=>pools.pool14Set?.has(n));`
- backtest loop: สร้าง `pool14Set` (prize1 + prize2×5 + prize3×10 + prize4×50 = 66 เลข) ต่องวด; เติม bucket `s.pool14={hits,total}` ให้ทุกแถว (วัดซ้ำทุก producer ที่มี preds — เฉพาะงวดที่มี pool ครบ) — แยกจาก metric เดิมครบ (กติกาคงที่ข้อ 1)
- UI backtest: แถว Hermes ใหม่ (field pool6_14, trust ทดลอง) + ตาราง "Board Pool 1-4" (เรียงตาม edge, โชว์ hits/10/edge vs baseline 66/1e6)
- UI ทำนาย tab: ไม่ต้อง append อะไร — Hermes อยู่ใน batch → การ์ด/ dropdown กลุ่มสูตร (filter) ได้มาเองจากกลไกเดิม (ข้อมูล (prev, next) ชุดเดียวกับทุกสูตร)
- **การ์ด tab สูตรคำนวณ (เจ้าของสั่ง — ต้องมี):** สร้างผ่าน `_mkFormulaCard('HM · Hermes Pool 1-4', 'HM · Hermes Pool 1-4', steps, highlights, note, 'ทดลอง')` ตามแบบ `_misterCCards` — steps เป็นภาษาไทยอธิบายวิธีคิด: (1) รวม pool รางวัล 2/3/4 ของงวดก่อน (65 เลข) (2) นับความถี่รายหลักถ่วงน้ำหนักตามมูลค่าเงิน (ที่2 ×1.0, ที่3 ×0.4, ที่4 ×0.2 — 5:2:1 ตามเงินจริง) (3) จัดอันดับ 0–9 ต่อหลัก (4) ประกอบ 10 ชุดแบบ round-robin · **ต้องแก้ `_formulaGroupKey` ให้ `s.startsWith('HM') → 'HM'`** (ไม่งั้น data-group ตก default 'A' ไปปน filter กลุ่มพื้นบ้าน) · render เป็น section แยกแบบ `imperialCards`/`tycoonCards` (`hermesCards`) + เพิ่ม count 'HM' ใน `_renderFormulaSummary` ('สูตร 6 ตัว (pool 1-4)') + เพิ่ม `HM:'HM · Hermes Pool 1-4'` ใน `_formulaGroupLabel`
- Badge: `_GRP['HM']` สีใหม่ (เช่น teal/cyan `#2dd4bf` — ตรวจไม่ซ้ำ _GRP ทั้ง 10 กลุ่ม + Mix ก่อน) + `trust-badge` เดิม; mirror ใน app.js ด้วย (drift-guard)

**ทำไมอยู่ใน batch + group key `'HM'` (สำคัญ — refactor ที่ต้องทำ):**
- **จุดที่แก้ (app.js):** `dcRecommendedNumbers` แยก group key ด้วย `String(fr.name)[0]` สองแห่ง — `experimentalGroups` (บรรทัด ~804) และ `groupKey` ต่อแถว (บรรทัด ~813) → เปลี่ยนเป็น `fr?.group || String(fr?.name||'')[0] || '?'` — Hermes carry `group:'HM'` บน result row → extraction ได้ 'HM' ไม่ใช่ 'H' · backward-compatible: J1/J2 ยังได้ 'J', X1..X ยังได้ 'X' (ไม่มี row ไหนมี `group` field อยู่ก่อน)
- **collision จริงที่ refactor นี้แก้ (ตรวจจากโค้ดแล้ว):** ถ้า Hermes เข้า batch ด้วยชื่อขึ้นต้น 'H' + `trust:'ทดลอง'` → 'H' เข้า `experimentalGroups` → เลขแนะนำ**ทุกตัวที่มิสเตอร์ซี ('H') สนับสนุน**จะติดป้าย ทดลอง ปลอม (trust = `groups.some(g=>experimentalGroups.has(g))`) — 'HM' กันการปนนี้
- **pool6_14 ไม่อยู่ใน `DC_RECO_FIELDS`** (รายการ field ที่ render การ์ด เลขแนะนำ) — เป็น deliberate exclusion ของ pool6 family อยู่แล้ว (I1/I2/J2/Mix ก็ไม่แสดงการ์ด) → Hermes ได้ระดับ participation เท่า J2: เข้า Picks (ผ่าน `dcBuildScoreRows`, badge propagate ตาม `fr.trust` โดยชื่อ — ไม่มี collision) + เข้ากลไก convergence computation + badge propagate ถูกต้องด้วย 'HM' — **ไม่**ต้องเพิ่ม pool6_14 ใน DC_RECO_FIELDS/DC_RECO_PRODUCER_GROUPS
- **batch push (formula-engine.js):** `results.push({name:'HM · Hermes Pool 1-4', group:'HM', preds:_hermesPool14Formula(prev,10), field:'pool6_14', baseline:10, trust:'ทดลอง'})` — push เฉพาะเมื่อ preds ไม่ว่าง (งวดก่อนมี pool 1–4 ครบ) เหมือน I/J2
- **`_GRP['HM'] = ['HM · Hermes Pool 1-4', <สีใหม่>]`** + mirror เดียวกันใน app.js (BP_GROUP_MAP) — drift-guard test `test_bp_group_map_sync.js` บังคับให้ตรงกันอยู่แล้ว

**สถานะ:** `trust:'ทดลอง'` ถาวร — per ADR-0003 (J2 precedent): 0.30 expected chance hits < 1 → ไม่มี gate พิสูจน์ได้ → ไม่มี promotion path

## Testing Decisions

ไฟล์ใหม่ `scripts/test_hermes_pool14.js` (vm-extract, fixture ล้วน — แบบ `test_tycoon_pool6_leg.js`):
- `_buildPrize1to4Pool`: fixture งวดที่มี prize2/3/4 ครบ → 65 เลขเป๊ะ; ไม่มี near1/prize1/prize5 ปน; field ว่าง → ข้าม (ไม่มี "000000" ปลอม)
- Weighted freq: fixture เล็กคำนวณมือ → ranked ต่อหลักตรง (ตรวจน้ำหนัก 1.0/0.5/0.2 เข้าจริง ไม่ใช่แค่ count ดิบ)
- Candidate: 10 ชุด, ทุกชุด 6 หลัก, K=8 หลักไม่ซ้ำต่อตำแหน่ง (คุณสมบัติ round-robin), ชุดที่ 0 = อันดับ 1
- Distinctness: fixture เดียวกัน → candidate Hermes ต่างจาก I1/I2/J2/Mix ทั้ง 10 ชุด (บังคับ user story 8)
- Skip: งวดที่ pool ว่าง → `[]` (ไม่มี fallback)
- Backtest integration: แถว Hermes โผล่ field `pool6_14` + trust ทดลอง; bucket `s.pool14` นับ hits ตรงกับที่คำนวณมือจาก fixture งวดจริง
- H-pollution regression (สำคัญที่สุดของ refactor นี้): fixture formulaResults ที่มี Hermes (`group:'HM'`, `trust:'ทดลอง'`) + มิสเตอร์ซี (ชื่อขึ้นต้น 'H', ไม่ทดลอง) + สูตรอื่น → เลขแนะนำที่ มิสเตอร์ซี สนับสนุนเพียงลำพัง **ต้องไม่**ติดป้าย ทดลอง; เลขแนะนำที่ Hermes (HM) สนับสนุน → ติดป้าย — ตรวจผ่าน `dcRecommendedNumbers` จริง (vm + fixture)
- Group-key extraction: row ธรรมดาที่ไม่มี `group` field → ยังใช้ `name[0]` เหมือนเดิม (J1/J2 = 'J', X1 = 'X') — backward-compatible
- Regression: รัน suite เดิมทั้งหมดเขียว — `test_reco_producer_groups.js` (Hermes เพิ่ม field ใหม่ pool6_14 ไม่แตะ 5 field เดิม → จำนวน producer เดิมต้องไม่เปลี่ยน), `test_bp_group_map_sync.js` (**ต้องแก้ `_GRP` + mirror ใน app.js พร้อมกันใน commit เดียว** — ไม่งั้น drift-guard fail), `test_experimental_badge_propagation.js` (propagation เดิมไม่เปลี่ยน)
- Browser verify (ตาม workflow โปรเจกต์): การ์ด HM · Hermes Pool 1-4 + ป้าย ทดลอง บนหน้า ทำนาย; dropdown กลุ่มสูตรมี HM; **การ์ดอธิบายวิธีคิดบน tab สูตรคำนวณ (steps ครบ 4 ขั้น, data-group="HM", ขึ้นใน section แยก ไม่ปนกลุ่ม A)**; แถว + ตารางเปรียบเทียบ Board Pool 1-4 ใน backtest; เลขแนะนำที่มิสเตอร์ซีสนับสนุน**ไม่มี**ป้ายทดลองปลอม; ไม่มี console error

## Out of Scope

- **ไม่เพิ่ม pool6_14 ใน `DC_RECO_FIELDS`/`DC_RECO_PRODUCER_GROUPS`** — pool6 family ถูกกันออกจากการ render การ์ด เลขแนะนำ โดย design เดิมอยู่แล้ว (I1/I2/J2/Mix ก็ไม่แสดงการ์ด — ADR-0001); Hermes เข้าร่วมแค่กลไก computation/badge ตามระดับเดียวกับ J2
- **ไม่มี promotion path** — ทดลองถาวร per ADR-0003; ไม่ใช่ "รอ gate"
- **ไม่รวม near1** ในเป้า (เจ้าของระบุรางวัล 1–4 เคร่งครัด) — ถ้าอยากรวมทีหลัง = เพิ่ม 2 เลขใน constant + baseline เท่านั้น
- **ไม่ search ค่า W** — W2/W3/W4 เป็น design decision ประกาศล่วงหน้า (1.0/0.4/0.2 ตามเงินจริง); search = theater บน field นี้ (ADR-0003)
- ไม่แตะ backend / กลุ่ม A–I / Mix / กติกาคงที่ / EV & Buy Plan ใดๆ

## Further Notes

- ข้อมูลล่าสุด: `lottery_cache.csv` มี **779 งวด** (docs เก่าระบุ 777) — sanook 458 งวด → ตรวจจำนวนจริงอีกครั้งตอน implement
- "เหนือกว่า" ต้องรายงานตามจริง: ถ้าตารางเปรียบเทียบออกมา 0 hit ทุกสูตร = "เทียบไม่ได้" (โอกาสถูกโดยบังเอิญ 0.30 ครั้ง) ไม่ใช่ "Hermes แพ้" — เขียนผลแบบนี้ใน CHANGELOG
- cache-bust: ต้อง bump `?v=` ใน `index.html` เมื่อแก้ static (ธรรมเนียมบังคับของโปรเจกต์)
- ธรรมเนียม: PRD นี้ต้องผ่าน **grilling** กับเจ้าของก่อน implement (ทุกงานใหญ่ของโปรเจกต์)
