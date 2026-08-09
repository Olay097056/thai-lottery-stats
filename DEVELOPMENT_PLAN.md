# แผนพัฒนา — Thai Lottery Intelligence Dashboard

> อัปเดตล่าสุด: 2026-07-09 · Phase 1–3.7 เสร็จสมบูรณ์ · Phase 4 (FABLE) ถูกยกเลิก · Phase 5 (จักรพรรดิ/จักรพรรดิทองคำ) เสร็จสมบูรณ์ (รวม candidate diversity fix รอบ 2 — round-robin ต่อหลัก) · Phase 6 (เจ้าสัว J1/J2 + ป้ายทดลองบน Picks/เลขแนะนำ) เสร็จสมบูรณ์ · **Phase 7 (จัดชุดซื้อ/Buy Plan — 2 โหมด, EV คู่, ledger บาทจริง) เสร็จสมบูรณ์** · **Phase 8 (Hermes Pool 1-4 — สูตรทายเลขเต็ม 6 หลัก เป้า pool รางวัล 1-4 ถ่วงน้ำหนักมูลค่าเงิน 5:2:1, ทดลองถาวรตาม ADR-0003) เสร็จสมบูรณ์** · frontend แยกไฟล์ + จัดระเบียบ path เสร็จ · หน้า "สรุปงวดนี้" (Decision Center) ปรับปรุงใหม่ (ตัดซ้ำซ้อน + track record + edge badge) เสร็จสมบูรณ์ — ดู [CHANGELOG.md](CHANGELOG.md) สำหรับประวัติละเอียด

## สถานะปัจจุบัน

| ส่วน | สถานะ |
|---|---|
| Database | prize1–3 ครบ 777 งวด (myhora) · prize4/5 + near1/2/3 ครบ 456 งวด (sanook, ~2549–ปัจจุบัน) |
| UI | macOS dark skin · 7 หน้า: Dashboard / ตารางความถี่ / ทำนาย-สูตร / ไม่รู้ซื้ออะไรดี (Mix) / จัดชุดซื้อ (Buy Plan) / ผลย้อนหลัง / Backtest |
| สูตร | A–H + สายมู (ใช้ผลงวดก่อน 1 งวด) + **I จักรพรรดิ/จักรพรรดิทองคำ** (ไม่มี promotion gate) + **J เจ้าสัว J1/J2** (ค้นหาระบบ, ทั้งคู่ติดป้ายทดลองถาวรตาม ADR-0003) |

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

**จักรพรรดิ (ISSUE-6) — เสร็จแล้ว:** `_buildPrize1to5Pool` (สร้าง pool จาก near1+prize2-5 ของงวดก่อนหน้า) + `_digitPosFreq` (นับความถี่เลขต่อหลัก, reusable) + `_imperialFormula` (จัดอันดับด้วยความถี่ล้วน, สร้าง candidate ผ่าน `_imperialRoundRobin` — ดูหัวข้อ candidate diversity fix รอบ 2 ด้านล่าง) ใน `formula-engine.js` แสดงทั้งในหน้า "ทำนาย" (กลุ่ม I dropdown) และตาราง backtest (badge "I · จักรพรรดิ", field `pool6`) เป็นสูตรปกติทันที ไม่มี promotion gate/ป้ายทดลอง

**จักรพรรดิทองคำ (ISSUE-7) — เสร็จแล้ว:** `_imperialGoldFormula` ใช้ `_digitPosFreq` เดิม ผสม 80% ความถี่ + 20% ความใกล้เคียงเชิงระยะห่างของตัวเลข**ต่อหลัก** (ปรับจาก "ทั้งชุด" เป็น "ต่อหลัก" ตอน round-robin fix — ดูด้านล่าง; ไม่ใช่ exact-match — พบว่า exact-match ทำให้ 20% ไม่มีผลจริงกับข้อมูลจริงเลย ดู CHANGELOG.md) กับเลขคณิตจากกลุ่ม D (`prize1 + วัน×เดือน×ปี ของงวดถัดไป`) ยืนยันแล้วว่า candidate set ต่างจากจักรพรรดิจริงทุกงวด แสดงเป็น "I2 จักรพรรดิทองคำ" ใต้ badge เดียวกัน

**Candidate diversity fix รอบ 1 — แทนที่แล้วด้วยรอบ 2 (ดู `PRD-imperial-formula-candidate-diversity.md` สำหรับ root-cause diagnosis ที่ยังใช้ได้อยู่):** แนวทางแรก (top-2→top-3 ต่อหลัก + `_imperialDiverseSelect` แบบ Hamming distance) วัดผิดมิติ — ดูรอบ 2

**Candidate diversity fix รอบ 2 — เสร็จแล้ว (2026-07-07, ดู `PRD-imperial-formula-diversity-round-robin.md`):** user ชี้ว่ายังกระจุกอยู่ (เทียบกับผลรางวัลที่ 4 จริง) เพราะรอบ 1 วัด Hamming distance รวมทั้งชุด ไม่ใช่ความหลากหลาย**ต่อหลัก** ที่ตาเห็นจริง แก้โดยลบ `_imperialCandidates`/`_imperialDiverseSelect` ทิ้ง แทนที่ด้วย `_imperialRoundRobin(rankedPerPosition, topN=10, K=8)` สร้าง candidate ตรงจาก ranked list ต่อหลัก (ไม่มี cartesian pool อีกต่อไป — เลี่ยงปัญหา top-8 cartesian ระเบิดเป็น 262,144 ชุด/ครั้ง) การันตี K=8 หลักไม่ซ้ำต่อตำแหน่งแบบเป๊ะด้วยการสร้าง ไม่ใช่ fallback ยืนยันด้วยข้อมูลจริงว่ากระจายเต็ม `[8,8,8,8,8,8]` ทุกตำแหน่งทั้ง I1/I2 (จากเดิม `[1,3,3,2,2,3]`/`[1,2,2,2,2,2]`)

## Phase 6 — เจ้าสัว (Group J) + ป้ายทดลองบน Picks/เลขแนะนำ (เสร็จสมบูรณ์, 2026-07-08)

กลุ่มสูตรแรกที่ได้จากการ**ค้นหาระบบ** (systematic search เหนือครอบครัวสูตรที่ประกาศไว้ล่วงหน้า — เลขจากงวดก่อนหน้าเดียว + วันที่งวดเป้าหมาย) แทนที่จะเป็นภูมิปัญญาพื้นบ้าน ทำให้ overfitting เป็นความเสี่ยงหลักตั้งแต่ต้น จึงออกแบบ promotion gate เข้มกว่าเดิม (train/validation/holdout split, ประเมิน holdout ครั้งเดียวจบ) — ดู `docs/adr/0003-group-j-promotion-gate-and-experimental-participation.md` (ADR-0003) และ `PRD-group-j-tycoon-formula.md`

**J1 เจ้าสัว (ท้าย 2 ตัว) — เสร็จแล้ว (ISSUE-13):** ผลจาก prototype search (`scripts/proto_group_j_bottom2_search.py`, ลบแล้วหลังบันทึกผลที่นี่) ค้นหา 165 สูตรเลขคณิตที่ประกาศไว้ล่วงหน้า บน train(464)/validation(150)/holdout(127) จาก 742 คู่งวดที่ใช้ได้ ได้ finalist `pad2(|BK2 − DSUM|)` (BK2 = ท้าย3ชุด2ของงวดก่อน, DSUM = วัน+เดือน+ปี พ.ศ.2หลัก ของงวดถัดไป ใช้ `_dsumValue` ร่วมกับกลุ่ม D) — **train Edge +0.72%, validation Edge +1.67%, holdout Edge −0.21% (1/127 hit) — ไม่ผ่าน gate อย่างชัดเจน** (ไม่ใช่กรณีก้ำกึ่ง) ตาม ADR-0003 decision #5 สูตรที่ไม่ผ่าน gate ยังคงขึ้นระบบ ติดป้าย**ทดลอง**แทนการลบทิ้ง (ต่างจาก FABLE ที่ถูกลบทั้งหมด) — holdout ถูกใช้ไปแล้ว ห้ามค้นหาซ้ำด้วย family เดิมจนกว่าจะมีงวดใหม่สะสมมากพอสำหรับ holdout ชุดใหม่

**J2 เจ้าสัว (เลขเต็ม 6 หลัก / pool6) — เสร็จแล้ว (ISSUE-15):** ใช้ `_buildPrize1to5Pool`/`_digitPosFreq`/`_imperialRoundRobin` ร่วมกับกลุ่ม I โดยตรง (ไม่ก็อปปี้) ผสม 80% คะแนนความถี่ + 20% ความใกล้เคียงกับ atom ของกลุ่ม J เอง (`|BK2 − DSUM|` จาก J1) แทนที่จะใช้เลขคณิตของกลุ่ม D เหมือนจักรพรรดิทองคำ — ยืนยันแล้วว่า candidate ต่างจาก I1/I2 จริงทุกงวด (ป้องกันไม่ให้เลขแนะนำนับ J ซ้ำกับ I โดยไม่ได้ตั้งใจ) **ติดป้ายทดลองถาวร**ตาม ADR-0003 — ที่ปริมาณข้อมูล pool ~456 งวด 10 candidate คาดว่าถูกโดยบังเอิญไม่ถึง 1 ครั้งตลอดประวัติศาสตร์ทั้งหมด จึงไม่มี gate ใดแยกฝีมือจากโชคได้ในสนามนี้

**ป้ายทดลอง (ทดลอง badge) — สร้างกลไกจริงครั้งแรก (ISSUE-13, ISSUE-14):** แม้ concept "ทดลอง" จะถูกกำหนดไว้ในกติกาคงที่ข้อ 3 ตั้งแต่ต้น แต่ไม่เคยมีการแสดงผลจริงในหน้าเว็บมาก่อน — เพิ่ม `trust` field บนผล formula (`'ทดลอง'` หรือ `null`) แสดงเป็น badge สีเหลืองอำพัน (`.trust-badge` ใน `app.css`) ที่ dropdown กลุ่มสูตร, แถวตาราง backtest, การ์ดหน้า "ทำนาย" และ**ส่งต่อ (propagate)** ไปยัง Pick (Final Confidence board) และเลขแนะนำ (Recommended Number) ที่มีสูตรทดลองสนับสนุนอยู่บางส่วน — เป็นป้ายแสดงผลอย่างเดียว ไม่มีผลต่อคะแนน/อันดับ/การมีส่วนร่วมใดๆ ทั้งสิ้น (ADR-0003 decision #6)

## Phase 7 — จัดชุดซื้อ (Buy Plan) (เสร็จสมบูรณ์, 2026-07-09)

หน้า sidebar ใหม่ที่แปลง Pick/เลขแนะนำ เป็น**แผนการใช้เงินจริง** พร้อม EV ที่ซื่อสัตย์และ ledger บาทสะสม — ตอบคำถาม "มีงบเท่านี้ ซื้ออะไร ตัวละเท่าไหร่ ระยะยาวเสียเท่าไหร่จริงๆ" ที่หน้าอื่นไม่ตอบ · governing ADR: `docs/adr/0004-buy-plan-tab-dual-ev-and-honest-pnl.md` (ADR-0004) · PRD: `PRD-buy-plan-tab.md` · glossary ใน CONTEXT.md: จัดชุดซื้อ, ชุดซื้อ, EV คู่, แก้เอง · client-side ล้วน (ใช้ fetch ที่ Decision Center ทำอยู่แล้ว ไม่มี endpoint ใหม่)

- **ISSUE-17 — หน้า + โหมดแทงรายเลข:** seam `bpBuildPlan` (แบ่ง tier ตามความเสี่ยง, จัดสรรตามคะแนน Pick ×1.5 boost เลขแนะนำ, min/round/cap/drop/remainder ให้รวมเท่างบเป๊ะ) + EV คู่ (ทฤษฎีนำเสมอ −5%/บาท, adjusted เตือน noise เมื่อ ≥0) · config flyout + prefs ใน localStorage
- **ISSUE-18 — แก้ก่อนเซฟ + ล็อก + resolve เป็นบาท + ledger:** แถวแก้ได้ (สtake/ลบ/เพิ่มเอง ติดป้าย **แก้เอง**), บันทึกเอง→immutable (`lottery_buyplan_history`), seam `bpResolvePlan` (ถูก×payout ที่ freeze ไว้, net = returned − spent) + `bpLedger` (สะสมทั้งหมด vs random-play) · resolve อัตโนมัติตอนเปิดหน้า, config เปลี่ยนไม่แตะแผนที่เซฟแล้ว
- **ISSUE-19 — โหมดลอตเตอรี่ใบ:** งบ→จำนวนใบ, รายการเลข 6 หลักจาก I/J2 pool6 + ทำนายรางวัลที่ 1 + Mix (เป็น source ไม่ใช่กลุ่มสูตร) พร้อมบันได เต็ม6→ท้าย3→ท้าย2 · EV จากตารางรางวัลรัฐบาล (คืนคาดหวัง 48฿/ใบ = −40% ที่ 80฿, เทียบ −5% ของแทงรายเลข ~8 เท่า) · `bpResolveTicket` เทียบตารางรางวัลเต็ม (ที่1/ข้างเคียง/ที่2–5/หน้า3/ท้าย3/ท้าย2), งวดที่ไม่มีคอลัมน์ Sanook ติดธง unverifiable ไม่นับเป็นพลาด
- **ISSUE-20 — ปุ่มเชื่อมจาก Mix + เอกสาร:** ปุ่ม "จัดชุดซื้อจากเลขชุดนี้ →" บนหน้า Mix (`bpFromMix`, เปิดโหมดลอตเตอรี่ใบ) — budget-cuts ของ Mix ไม่ถูกแตะ · เอกสารปิดงาน (ไฟล์นี้ + CLAUDE.md + CHANGELOG.md)

**เทส:** `scripts/test_buyplan_build.js` / `_resolve.js` / `_ticket.js` (vm-extracted, fixture-driven — seam ล้วน ไม่แตะ DOM/network) · CSS block `.bp-*` ท้าย `app.css` · bump `?v=buyplan1→4` ครบ 3 ไฟล์

## Phase 8 — Hermes Pool 1-4 (HM): สูตรทายเลขเต็ม 6 หลัก เป้า pool รางวัล 1–4 (เสร็จสมบูรณ์, 2026-08-08)

สูตรที่เจ้าของสั่งคิดค้น (PRD: `PRD-hermes-pool-1-4.md`, สเปกตกลงผ่าน grilling ครบ 5 ข้อ) — ตอบเป้าหมาย "ทำนายเพื่อถูกรางวัลที่ 1/2/3/4" โดย**จำกัดเป้าเป็น pool 1–4 (66 เลข)** ตัด prize5 (100 เลขที่เจือจาง) และข้างเคียงออก ต่างจาก I1/I2/J2/Mix ที่ทาย pool 1–5 (168 เลข)

- **สูตร:** `_hermesPool14Formula` — ความถี่รายหลัก (ตำแหน่ง 1–6) จาก pool รางวัล 2/3/4 ของงวดก่อนหน้า (65 เลข) **ถ่วงน้ำหนักตามมูลค่าเงินจริง 5:2:1** (prize2 ×1.0 / prize3 ×0.4 / prize4 ×0.2 — ค่าคงที่ design, ไม่ search ตาม ADR-0003) → จัดอันดับ 0–9 ต่อหลัก → ประกอบ 10 ชุดผ่าน `_imperialRoundRobin` (K=8) · อินพุต = งวดก่อนหน้า 1 งวดเท่านั้น ไม่ใช้เลขคณิต/วันที่
- **สถานะ: ทดลองถาวร** per ADR-0003 (J2 precedent) — 457 งวด × 10 ชุด × 66/10⁶ ≈ 0.30 hit ที่คาดโดยบังเอิญตลอดประวัติ → ไม่มี gate พิสูจน์ได้
- **ผลจริง (ยืนยันตรง engine + ข้อมูลจริง):** ถูก **2 ครั้ง** (คาด 0.30) — `685863` @ 01/02/2024, `086093` @ 30/12/2021 ทั้งคู่เป็นรางวัลที่ 4 · edge **+0.37%** (~6.7× สุ่ม, P(≥2|λ=0.30)≈3.7%) — น่าสนใจแต่ n=2 เล็กเกินจะสรุปอะไร · ตารางเปรียบเทียบ 50 งวดล่าสุด: 0 hit ทุกสูตร = "เทียบไม่ได้" ตามที่ PRD ประกาศ
- **Refactor ที่มาพร้อมกัน:** `dcRecommendedNumbers` group key = `fr.group || name[0]` (กัน 'HM' → 'H' ปน experimentalGroups → มิสเตอร์ซีไม่ติดป้ายทดลองปลอม) · `_formulaGroupKey` รู้จัก 'HM' · `_GRP['HM']` + `BP_GROUP_MAP.HM` (drift-guard) · `bpGroupsForSources` รู้จัก prefix HM
- **พื้นผิว:** การ์ดอธิบายวิธีคิด 4 ขั้นตอน (tab สูตรคำนวณ, panel `formula-results-HM` + dropdown) · batch ทำนาย · backtest แถว field `pool6_14` (board "Pool 1-4", baseline 66/10⁶) + **ตารางเปรียบเทียบ Board Pool 1-4** (I1/I2/J2/Mix/Hermes วัดซ้ำเกณฑ์เดียวกัน — พื้นที่พิสูจน์ "เหนือกว่าทุกสูตร")
- **เทส:** `scripts/test_hermes_pool14.js` ใหม่ (40 checks) + อัปเดต `test_tycoon_formula.js` (trust groups = J+HM) · suite 15 ไฟล์เขียว · browser verify ครบ · bump `?v=macos6 → hermes1`
