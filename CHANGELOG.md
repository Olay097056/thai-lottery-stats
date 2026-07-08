# Changelog — Thai Lottery Intelligence Dashboard

ประวัติ implementation แบบละเอียด อ้างอิงเมื่อไม่แน่ใจว่า decision เก่าตัดสินใจทำไม สำหรับสถานะปัจจุบันดู [DEVELOPMENT_PLAN.md](DEVELOPMENT_PLAN.md)

## 2026-07-08 — เจ้าสัว (Group J): สูตรจากการค้นหาระบบตัวแรก + ป้ายทดลอง — ISSUE-13→16

PRD: `PRD-group-j-tycoon-formula.md` · ADR: `docs/adr/0003-group-j-promotion-gate-and-experimental-participation.md` (gate เข้มแบบ train/validation/holdout, ป้ายทดลอง = แสดงผลอย่างเดียวไม่ gate การมีส่วนร่วม) · glossary ใหม่ใน `CONTEXT.md`: เจ้าสัว (Group J), ทดลอง, Promotion Gate, Holdout

**ที่มา:** กลุ่มสูตรแรกที่ได้จาก**การค้นหาระบบ** (systematic search เหนือครอบครัวสูตรเลขคณิตที่ประกาศไว้ล่วงหน้า — เลขจากงวดก่อนหน้าเดียว + วันที่งวดเป้าหมาย, atom แบบเดียวกับกลุ่ม D) แทนที่จะเป็นภูมิปัญญาพื้นบ้านหรือ hand-tuned — ทำให้ overfitting เป็นความเสี่ยงหลักตั้งแต่ต้น (FABLE ตายเพราะแบบนี้มาแล้ว) จึงตกลง gate เข้มกว่าเดิมก่อนเริ่มค้นหา: แบ่ง train(464)/validation(150)/holdout(127) จาก 742 คู่งวด ประเมิน holdout ครั้งเดียวจบแล้ว "ใช้ไปแล้ว" ห้ามค้นซ้ำจนกว่าจะมีงวดใหม่สะสม

**ISSUE-13 — J1 เจ้าสัว (ท้าย 2 ตัว) + สร้างกลไกป้ายทดลองจริงครั้งแรก:** prototype search (`scripts/proto_group_j_bottom2_search.py`, ลบแล้ว) ค้นหา 165 สูตรเลขคณิต ได้ finalist `pad2(|BK2 − DSUM|)` (BK2 = ท้าย3ชุด2ของงวดก่อน, DSUM = วัน+เดือน+ปี พ.ศ.2หลัก ของงวดถัดไป — เพิ่ม `_dsumValue` helper แยกออกจาก `_claudeFormulas` ของกลุ่ม D เพื่อใช้ร่วมกัน ไม่ใช่คำนวณซ้ำสองที่) — **train Edge +0.72%, validation Edge +1.67%, holdout Edge −0.21% (1/127 hit) ไม่ผ่าน gate ชัดเจน ไม่ใช่กรณีก้ำกึ่ง** ตาม ADR-0003 decision #5 สูตรที่ไม่ผ่าน gate ยังคงขึ้นระบบติดป้าย**ทดลอง**แทนการลบ (ต่างจาก FABLE) แม้ concept ทดลองจะถูกกำหนดไว้ในกติกาคงที่ตั้งแต่ต้น แต่ไม่เคยมีกลไกแสดงผลจริง — เพิ่ม `trust` field บนผล formula, badge สีเหลืองอำพัน (`.trust-badge` ใน `app.css`) ที่ dropdown กลุ่มสูตร/แถว backtest/การ์ดหน้าทำนาย, `_GRP['J']` badge ใหม่ (สีเขียวมรกต `#10b981` ไม่ซ้ำกลุ่มอื่น)

**ISSUE-14 — ส่งต่อป้ายทดลองไปยัง Picks และเลขแนะนำ:** `dcBuildScoreRows` (Pick aggregation, หน้า Decision Center ใหม่เท่านั้น — เวอร์ชัน `*Old` ที่ freeze ไว้มีจุดเรียก `add()` หน้าตาเหมือนกันเป๊ะ ต้องแก้ด้วย sed ระบุเลขบรรทัดแทน string-match เพื่อไม่ให้โดนแก้ผิดตัว) เก็บ `trust` แบบ "ใครสนับสนุนสูตรทดลองสักตัวก็ติดป้าย" (ไม่ใช่ต้องทุกตัว) ทั้งสองจุดที่เรียก `add()` (ทาง `formulaResults` ตรงที่มี edge gate และทาง `formulaMatches` ที่ไม่มี gate) · `dcRecommendedNumbers` เช็คว่ากลุ่มที่เห็นตรงกันมีกลุ่มทดลองปนไหม · เป็นป้ายแสดงผลอย่างเดียว ไม่แตะ score/rank ใดๆ (พิสูจน์ด้วย regression test เทียบค่าที่คำนวณมือ)

**ISSUE-15 — J2 เจ้าสัว (เลขเต็ม 6 หลัก / pool6):** ใช้ `_buildPrize1to5Pool`/`_digitPosFreq`/`_imperialRoundRobin` ร่วมกับกลุ่ม I โดยตรง (ไม่ก็อปปี้) ผสม 80% ความถี่ + 20% ความใกล้เคียงกับ atom ของกลุ่ม J เอง (`|BK2 − DSUM|` จาก J1) แทนเลขคณิตกลุ่ม D ที่จักรพรรดิทองคำใช้ — จงใจให้ต่างจาก I1/I2 เพื่อไม่ให้เลขแนะนำนับ J ซ้ำกับ I โดยไม่ได้ตั้งใจ (ยืนยันด้วยเทสว่า candidate ต่างกันจริงบนข้อมูล realistic) **ติดป้ายทดลองถาวร**ตาม ADR-0003 — pool ~456 งวด 10 candidate คาดถูกโดยบังเอิญไม่ถึง 1 ครั้งตลอดประวัติศาสตร์ ไม่มี gate ใดแยกฝีมือจากโชคได้ในสนามนี้ ไม่ต้องเพิ่มกลไกป้ายใหม่ ใช้ของ ISSUE-13 ต่อได้เลยตามที่ตั้งใจไว้

**ISSUE-16 — เอกสาร + ลบไฟล์ throwaway:** บันทึกผลตัวเลขจาก prototype search ลงถาวรใน `CLAUDE.md`/`DEVELOPMENT_PLAN.md`/`CHANGELOG.md` (ที่นี่) แล้วลบ `scripts/proto_group_j_bottom2_search.py` และ `scripts/NOTES-group-j-bottom2-search.md` ตามธรรมเนียม prototype skill

**ทดสอบ:** TDD ทุก issue — `test_tycoon_formula.js` (9 checks: arithmetic ตรง, skip เมื่อข้อมูลขาดไม่มี fallback, D1 regression หลัง prefactor, integration กับ `_computeFormulasBatch`, `_GRP.J` สีไม่ซ้ำ, badge render ทั้ง `_mkFormulaCard`/`_renderBtTable`), `test_experimental_badge_propagation.js` ใหม่ (21 checks: propagation "any" semantics ทั้งสองทาง, regression คะแนน/อันดับไม่เปลี่ยนเมื่อไม่มีสูตรทดลอง), `test_tycoon_pool6_leg.js` ใหม่ (15 checks: candidate ถูกต้องตรงกับคำนวณมือ, distinct จาก I1/I2, skip guards, integration) · แก้ตามไปด้วย: `DC_RECO_PRODUCER_GROUPS.bottom2` เดิม 7 ผิดตั้งแต่ J1 ขึ้นระบบ (ตอนนี้มีผู้ผลิตจริง 8 กลุ่ม) — จับได้จาก drift-guard test ของมันเอง (`test_reco_producer_groups.js`) ไม่ใช่บั๊กที่มองข้าม · verify ใน browser จริง (preview tools) ทุก issue: J1/J2 โชว์ทั้งหน้าทำนายและตาราง backtest พร้อม badge ทดลอง, บังคับ fixture ผ่าน `dcScoreHtml`/`dcRecoCardHtml` จริงในเบราว์เซอร์ยืนยัน badge render ด้วย CSS ที่คำนวณถูกต้อง (พื้นหลังอำพัน, border-radius 999px), ไม่มี console error ตลอด

## 2026-07-07 — Rebrand "สรุปงวดนี้" + เลขแนะนำ (cross-formula convergence) — ISSUE-8→12

PRD: `PRD-decision-center-rebrand-recommended-number.md` · ADR: `docs/adr/0001` (นิยาม convergence) + `docs/adr/0002` (ห้ามยกเว้น backtest) · glossary ใหม่ใน `CONTEXT.md`: เลขแนะนำ, Formula group, Field type

**นิยามเลขแนะนำ (ตกลงผ่าน grilling ก่อนเขียนโค้ด):** เลขที่ **2+ กลุ่มสูตรตัวอักษรต่างกัน** (A–I, key ด้วย `name[0]`; X ทั้งหมด = กลุ่ม F/Codex เดียว) ทายตรงกันเป๊ะทั้งเลขและ **field type** (ห้าม merge ข้าม field แม้ยาวเท่ากัน — ต่างจาก `dcConsensusCandidates` เดิมที่ merge และถูกคงไว้ไม่แตะ) · สูตรย่อยกลุ่มเดียวกันตรงกันไม่นับ (I1+I2 ไม่ใช่ 2 กลุ่ม) · ผลตามมาที่ยอมรับ: `pool6`/`back3`/`prize1_last4_digits`/`bottom2_unit` มีผู้ผลิตกลุ่มเดียว จึงไม่มีทางเกิดเลขแนะนำ (structural ไม่ใช่ hardcode) · จัดอันดับ: จำนวนกลุ่ม desc → combined Edge desc → เลข asc · ไม่มีเลขเข้าเกณฑ์ = empty state ตรงๆ ห้าม backfill

**ISSUE-8 — แท็บ (OLD VER):** ก่อน rebrand ก๊อปหน้าสรุปงวดนี้เดิมทั้งหน้าเป็นแท็บย่อยที่ 4 (ฟังก์ชัน `*Old` ~30 ตัว + div id `-old`) เพื่อให้ rebrand แตะหน้าหลักได้อิสระ · บั๊กที่ review จับได้แล้วแก้: CSS class โดน rename ผิด (`dc-snapshot-list-old` ไม่มี rule ใน app.css → layout พัง) และ OLD VER แชร์ key `lottery_dc_snapshots` กับหน้า live ทำให้ปุ่มลบของ OLD VER ลบ Track Record จริงด้วย → แยกเป็น `lottery_dc_snapshots_old` seed ครั้งเดียวผ่าน flag `_seeded` (null-check เฉยๆ จะ reseed ทันทีหลัง clear — เจอเองตอน verify)

**ISSUE-9 — เอนจิน + UI หลัก:** `dcRecommendedNumbers(formulaResults,btMap)` pure function ใหม่ · บอร์ด `.dc-reco-*` บนสุดของหน้า (การ์ดต่อ field, explainer "A + D เห็นตรงกัน", ปุ่มดูเลขอื่นที่เข้าเกณฑ์, coverage badge x/5 นับเฉพาะ field ที่มีสิทธิ์) ใช้ token ธีมเดิมล้วน · แก้จาก review: explainer ต้อง map X→F ก่อน sort (ไม่งั้นได้ "G + H + F") · **พบ+แก้บั๊ก cache:** `app.css` ไม่มี `?v=` มาก่อน browser เสิร์ฟ CSS เก่าแบบเงียบๆ — เพิ่ม cache-bust ให้ครบ 3 ไฟล์ + บันทึกใน CLAUDE.md

**ISSUE-10 — Track Record + Edge ของตัวเอง:** auto-snapshot เก็บ top เลขแนะนำต่อ field (`s.reco`) · badge ถูก/ไม่ถูก/รอผลต่อรายการใน Track Record (reuse `dcCheckHit` เดิม) · baseline ใหม่ตามจำนวนกลุ่มผู้ผลิต: `dcRecoBaseline = C(G,2) × pRandom² × 100` (pRandom = 1/100 สำหรับ field 2 หลัก, ~5/1000 สำหรับ 3 หลัก) — ยิ่งหลายกลุ่มผลิต convergence ยิ่งเกิดง่าย บาร์ยิ่งสูง · Edge = hit rate จริง (unconditional ต่องวดที่มีผล) − baseline แสดงเป็นการ์ดแยก ไม่ปนกับ Edge สูตรหรือ Final Confidence · **บั๊กที่ review จับได้แล้วแก้:** นับกลุ่ม bottom2 ผิดเป็น 6 จริงๆ คือ **7** — สูตร E สายมูปล่อย `field:'bottom2'` ผ่าน dynamic loop (`f.name+…`) grep ตรงๆ เลยนับไม่เจอ → แก้เป็น 7 (baseline 0.21%) + เพิ่ม `scripts/test_reco_producer_groups.js` รัน engine จริงใน vm เทียบค่าคงที่กับความเป็นจริง กัน drift ในอนาคต

**ISSUE-11 — กราฟแนวโน้มเลขแนะนำ:** `dcRecoHitRateTrend` convention เดียวกับกราฟ Pick (resolved-only, 20 งวดล่าสุด, rolling 5) แต่ (ก) งวดถูกถ้าเลขแนะนำ ≥1 ตัวถูก (ข) **งวดที่ไม่มีเลขแนะนำถูกตัดออก ไม่นับเป็นพลาด** (สัญญาณที่ไม่ได้ทายอะไรพลาดไม่ได้ — deviation จาก spec ตรงตัวที่จงใจและติดป้ายใน UI) · canvas แยกจากกราฟ Pick (เส้นทอง) ไม่ merge · refactor จาก review: แยก `dcRollingRate` ใช้ร่วมสองกราฟ (OLD VER คง inline เดิม)

**ISSUE-12 — แถบเทียบเลขแนะนำ vs Pick อันดับ 1:** `dcRecoTopOverall` (comparator เดียวกับใน field: กลุ่ม → edge → เลข, tie-break ตัวที่สามเพิ่มตาม review) + `dcRecoCompareStripHtml` แสดงเคียงกัน verdict = เขียว (ตรงกัน) / ≠ (คนละเลข) · อ่านจากผลที่คำนวณแล้วเท่านั้น ไม่ fetch เพิ่ม ไม่แตะ `dcBuildScoreRows` · rename `dcRecoExplainHtml`→`dcRecoExplainText` (คืน plain text แต่ชื่อ Html ล่อให้เกิดบั๊ก escape ในอนาคต)

**ทดสอบ:** TDD ทุก issue (เทสเขียน red ก่อนฟังก์ชันเกิด) — `test_recommended_numbers.js` (23 checks), `test_decision_track_record.js` ขยาย 25→45, `test_reco_producer_groups.js` ใหม่ (7) · verify ใน browser จริงทุกขั้น: convergence จริงบน bottom2 (A+D+F → "62") และ front3 (D+F → "471"), Hit/Miss/Pending ถูกต้องกับ snapshot สังเคราะห์งวดที่มีผลจริง, กราฟ rolling ให้ [100,50,66.7] ตาม pattern ที่ inject, strip โชว์ทั้งเคสตรง (=เขียว) และไม่ตรง (62≠642), OLD VER ไม่กระทบทุกรอบ, ไม่มี console error

## 2026-07-07 — จักรพรรดิ/จักรพรรดิทองคำ: แก้ candidate กระจุกตัว รอบ 2 (round-robin ต่อหลัก)

**ทำไมต้องแก้รอบ 2:** รอบแรก (ด้านล่าง, `PRD-imperial-formula-candidate-diversity.md`) วัดผิดมิติ — average pairwise Hamming distance ขยับขึ้นจริง (1.80→2.53) แต่ user ตัดสิน "กระจุกไหม" จาก **ความหลากหลายต่อหลัก (ต่อคอลัมน์)** ซึ่งยังต่ำอยู่ (ครึ่งนึงของหลักมีแค่ 2-3 ตัวไม่ซ้ำจาก 10 candidate) user ส่งภาพผลรางวัลที่ 4 จริงมาเทียบ ("กูอยากได้แบบนี้") ซึ่งแทบทุกหลักไม่ซ้ำกันเลยตลอดทั้งชุด ดู `PRD-imperial-formula-diversity-round-robin.md` สำหรับ grilling session รอบ 2 เต็ม (4 คำถาม — ตกลงเป้าวัดใหม่เป็น "จำนวนหลักไม่ซ้ำต่อตำแหน่ง", ตกลง K=8 จาก 10 (ไม่ใช่ K=10 เต็ม เพราะจะทำให้ freqScore ไม่มีผลต่อว่าหลักไหนโผล่เลย เหลือแค่ตัวเรียงลำดับ), พบปัญหา performance ของแนวทาง cartesian ที่ top-8 (8⁶=262,144 ชุด/ครั้ง) จึงเปลี่ยนสถาปัตยกรรมทั้งหมด)

**แก้:** ลบ `_imperialCandidates`/`_imperialDiverseSelect` (กลไกรอบ 1) ทิ้งทั้งคู่ แทนที่ด้วย `_imperialRoundRobin(rankedPerPosition, topN=10, K=8)` — สร้าง candidate ตรงจาก ranked list ต่อหลัก (ไม่มี cartesian pool เลย): candidate `i` หลัก `p` = อันดับที่ `(i%K + floor(i/K)*(p+1)) % K` ของหลักนั้น การันตี K=8 หลักไม่ซ้ำต่อตำแหน่งแบบเป๊ะด้วยการสร้าง (ไม่ใช่ fallback/relax แบบรอบ 1) เร็วกว่าเดิมมาก (O(topN×6) ไม่ขึ้นกับ K) — candidate 0 ยังเป็นอันดับ 1 (เก่งสุด) ทุกตำแหน่งเหมือนเดิม `_imperialFormula` ใช้ ranking ความถี่ล้วนจาก `_digitPosFreq` ตรงๆ ส่วน `_imperialGoldFormula` ปรับ blend จาก "ทั้งชุด 6 หลัก" เป็น **ต่อหลัก** (80% ความถี่ + 20% ความใกล้เคียงต่อหลักกับเลขเป้าหมาย) เพื่อให้เข้ากับสถาปัตยกรรมใหม่ ยังคงต่างจากจักรพรรดิจริง (ยืนยันด้วยเทส "genuinely disagree")

**ยืนยันด้วยข้อมูลจริง (งวด 01/07/2026) — กระจายเต็มตามเป้า:** จำนวนหลักไม่ซ้ำต่อตำแหน่งของทั้ง I1 และ I2 เป็น **`[8,8,8,8,8,8]`** ทุกตำแหน่ง (จากที่รอบ 1 ยังเหลือ `[1,3,3,2,2,3]`/`[1,2,2,2,2,2]`) — ตัวอย่างจริง I1: `482455 256024 324349 507197 910663 678988 749201 861776 227681 300906` (candidate 0 เหมือนรอบ 1 เป๊ะ ตามที่ตั้งใจไว้ว่าตัวเก่งสุดต้องไม่เปลี่ยน)

**Edge:** รัน backtest จริงกับ 455 งวดเทียบรอบ 1 (before) vs รอบ 2 (after) — จักรพรรดิทองคำยังคง 0/455, edge −0.1679% เท่าเดิม ส่วนจักรพรรดิขยับจาก 0/455 (−0.1679%) เป็น **1/455, edge +0.0519%** — ขยับขึ้นจากการที่ candidate set เปลี่ยนไปโดนเลขนึงเข้าพอดี 1 งวด ไม่ใช่หลักฐานว่าสูตรแม่นขึ้นจริง (baseline คาดหวัง ~0.76 ครั้งถูกจาก 455 งวดอยู่แล้ว 1 ครั้งยังอยู่ในกรอบ noise ปกติเป๊ะ) รายงานตามจริงตามธรรมเนียมโปรเจกต์ ไม่ได้ตั้งใจไล่ตัวเลขนี้

**ทดสอบ:** เขียนเทส TDD ก่อนแก้โค้ด เขียน `scripts/test_imperial_formula.js` ใหม่เกือบทั้งไฟล์ (unit test ตรงของ `_imperialRoundRobin`: candidate 0 = อันดับ 1 ทุกตำแหน่งเสมอ, ไม่มีแถวซ้ำ, กระจายเป๊ะ K=8 ต่อตำแหน่ง, อันดับ 8-9 ไม่โผล่เลย, ทดสอบกรณี worst-case ทุกตำแหน่งมี ranking เดียวกันเป๊ะยังไม่ซ้ำแถว (พิสูจน์ด้วยมือ+ยืนยันด้วยเทส ตรงตาม `999999 888888 777777 666666 555555 444444 333333 222222 876543 765432`), กรณี topN≤K, เช็คว่า `_imperialCandidates`/`_imperialDiverseSelect` ไม่เหลือในโค้ดแล้ว) ผ่านทั้งหมด พร้อม test เดิมทุกไฟล์ไม่มี regression

## 2026-07-07 — จักรพรรดิ/จักรพรรดิทองคำ: แก้ candidate กระจุกตัว (candidate diversity fix)

**สาเหตุ** (ผู้ใช้สังเกตเห็นเอง ระหว่าง grilling session): candidate ~10 ชุดที่ I1/I2 ให้มาแต่ละงวดคล้ายกันหมด ต่างกันแค่ 1-2 หลัก ขณะที่เลขรางวัลจริงกระจายเต็มทุกหลัก — สาเหตุคือ `_imperialCandidates` เดิมคัดมาแค่ top-2 ความถี่ต่อหลัก แล้วจัดอันดับด้วย freqScore รวม ทำให้ candidate อันดับรองๆ เป็นแค่ "เพื่อนบ้าน" ของจุดคะแนนสูงสุดจุดเดียว (สลับ 1-2 หลักจากตัวที่ดีที่สุด) ไม่ใช่การกระจายจริง ดู `PRD-imperial-formula-candidate-diversity.md` สำหรับรายละเอียดเต็มของ grilling session (7 คำถาม กว่าจะเจอ root cause นี้ — เริ่มจากถามว่าจะ retroactive-gate I1/I2 ไหม, ตัดสินใจไม่แตะเรื่อง label/gate รอบนี้, ปฏิเสธไอเดียเพิ่ม `pool_tail3` metric เพราะเข้าข่าย metric-shopping, จนมาเจอปัญหา clustering จริงจากที่ user สังเกต)

**แก้:** ขยาย top-2 → **top-3** ความถี่ต่อหลักใน `_imperialCandidates` (เพดาน candidate ก่อน dedupe จาก 64 เป็น 729) + เพิ่มฟังก์ชันร่วมใหม่ `_imperialDiverseSelect(candidates, scoreKey, topN, minDist=2)` — เดินตาม candidate ที่เรียงคะแนนมากไปน้อย เลือกตัวคะแนนสูงสุดก่อนเสมอ แล้วรับตัวถัดไปเฉพาะที่ห่าง (Hamming distance) จากทุกตัวที่เลือกไปแล้วอย่างน้อย `minDist` หลัก ถ้าเดินจนหมดแล้วยังไม่ครบ `topN` จะผ่อน `minDist` ลงทีละ 1 แล้วเริ่มใหม่ (ไม่มีทางคืนค่าน้อยกว่า topN ที่ขอ ถ้ามี candidate ไม่ซ้ำพอ) — `_imperialFormula` (จักรพรรดิ, ให้คะแนนด้วย `freqScore`) และ `_imperialGoldFormula` (จักรพรรดิทองคำ, ให้คะแนนด้วย `blended`) เรียกใช้ฟังก์ชันร่วมนี้แทนที่ `.sort().slice(0,topN)` เดิม

**ยืนยันแล้วว่า Edge ไม่เปลี่ยน (ตามที่คาดไว้ล่วงหน้า ไม่ใช่ผลข้างเคียงที่ไม่ตั้งใจ):** รัน backtest จริงกับข้อมูล 455 งวดที่มี Sanook ครบ เทียบ before (top-2, sort/slice ธรรมดา) vs after (top-3, diverse-select) ทั้งคู่ยังคง **0/455 ครั้งถูก, edge −0.1679%** เท่ากันเป๊ะทั้งก่อนและหลัง — ตรงตามที่ตกลงกันไว้ตอน grilling ว่าเพดาน edge ที่แท้จริงของสูตรที่อ้างอิงงวดก่อนหน้าเดียวควรใกล้ 0 อยู่แล้ว (หวยรัฐบาลออกแบบมาสุ่มจริง) งานนี้ไม่ได้ทำเพื่อไล่ edge แต่ทำเพื่อลบ artifact ที่ candidate กระจุกตัว

**ยืนยันด้วยข้อมูลจริง (งวด 01/07/2026):** จำนวนหลักที่ไม่ซ้ำกันต่อตำแหน่ง (position 1-6) ของ I1 จาก `[1,2,2,2,2,2]` (before) เป็น `[1,3,3,2,2,3]` (after) — กระจายมากขึ้นชัดเจนในตำแหน่งที่สัญญาณความถี่ไม่ได้เด่นสุดขั้ว ส่วนตำแหน่งที่ 1 (หลักแรก) ยังคงเหลือหลักเดียวทั้งคู่ เพราะสัญญาณความถี่ที่ตำแหน่งนั้นเด่นชัดมากจนเป็นตัวเลือกที่ดีที่สุดในทุก candidate จริงๆ (ไม่ใช่บั๊ก — diverse-select ยังให้น้ำหนักคะแนนก่อนเสมอ ไม่ใช่กระจายแบบสุ่มล้วน)

**ทดสอบ:** เขียนเทส TDD ก่อนแก้โค้ด เพิ่มใน `scripts/test_imperial_formula.js` (3 เช็คใหม่: diverse-select กระจายกว่า naive top-N จริง + เก็บตัวคะแนนสูงสุดไว้เสมอ, minDist ผ่อนอัตโนมัติเมื่อ candidate กระจายไม่พอ ไม่คืนค่าน้อยกว่า topN, `_imperialFormula` ต่อสายกับ `_imperialDiverseSelect` จริงบนข้อมูล realistic fixture ไม่ใช่แค่นิยามทิ้งไว้เฉยๆ) ผ่านทั้งหมด พร้อม test เดิมทุกไฟล์ (`test_codexpool_coeffs.js`, `test_codexpool_presets.js`, `test_pool_field_rename.js`, `test_decision_track_record.js`) ไม่มี regression

**หมายเหตุ verify:** ไม่สามารถเปิด browser preview ได้ตรงๆ ในรอบนี้ (พอร์ต 8509 ถูกใช้โดย session อื่นที่รันเซิร์ฟเวอร์อยู่ก่อนแล้ว) จึงยืนยันด้วยการเรียกฟังก์ชันตรงจาก Node กับข้อมูลจริงที่ดึงจากเซิร์ฟเวอร์ที่รันอยู่ (`/api/prize-history`) แทน — เทียบ before/after เห็นผลตรงตามคาด

## 2026-07-07 — ปรับปรุงหน้า "สรุปงวดนี้" (Decision Center): ตัดซ้ำซ้อน + track record + edge badge

**ตัดข้อมูลซ้ำซ้อน** (ตกลงกับ user ผ่าน grilling session ก่อนเริ่มโค้ด): รวม hero board (การ์ดบนสุด) กับ "Final Confidence Score" เป็นก้อนเดียว (เดิมแยก 2 ที่คำนวณจาก `scored` ตัวเดียวกันแต่โชว์คนละ layout) · ย้ายการ์ด "Prize1 เน้นสุด"/"เลขหนุนข้ามหมวด" จาก panel "Decision Center" (ถูกลบทั้ง panel) เข้า hero แบบละเอียด (ใช้ `predDetailHtml` แทน chip ธรรมดา) · ลบการ์ด "หน้า 3 เด่น" แยก (ซ้ำเป๊ะกับ "เลขหน้า 3 ตัว" ใน hero) · ลบการ์ด "Next Actions" (ข้อความ static ไม่เปลี่ยนตามข้อมูลจริง)

**เพิ่ม Track Record + กราฟแนวโน้มอัตราถูก:** เปลี่ยนปุ่ม "บันทึก Snapshot" (manual) เป็น **auto-save ทุกครั้งที่เปิดหน้า** (`dcAutoSaveSnapshot`, cap 20→60 รายการ, localStorage เดิม) · เพิ่ม `dcActualForDate`/`dcCheckHit`/`dcSnapshotResult` เช็คว่าเลขที่เคยแนะนำถูกผลจริงไหม (นิยาม: 6 หลักต้องตรง รางวัลที่ 1 เป๊ะ, 3 หลักถูกถ้าตรงกับ 1 ใน 5 ชุด 3 หลักที่ออกจริง (3บน/3หน้า×2/3หลัง×2), 2 หลักต้องตรง 2 ตัวล่างเป๊ะ, งวดที่ยังไม่ออกผล = "รอผล" ไม่นับรวมสถิติ) · รวม "Snapshot งวด" เดิมกับ track record เป็นการ์ดเดียว (แสดง badge ถูก/ไม่ถูก/รอผลต่อแถว) · เพิ่ม `dcHitRateTrend` (rolling 5 งวด, 20 งวดล่าสุดที่มีผล) วาดเป็น line chart ด้วย Chart.js ตัวเดิมที่มีอยู่แล้ว (`mkChart`)

**เพิ่ม edge badge ต่อเลขที่แนะนำ:** `dcBuildScoreRows` เก็บ `r.topEdge` (backtest edge สูงสุดจากสูตรที่หนุนเลขนั้น) แสดงเป็น badge สีเขียว/แดงตามเครื่องหมายต่อจาก score/100 ทุกจุดที่ใช้ `dcScoreHtml`

**ยืนยันแล้ว:** เขียนเทส TDD ก่อนแก้โค้ด (`scripts/test_decision_track_record.js`, 25 checks: `dcActualForDate`/`dcCheckHit`/`dcSnapshotResult`/`dcHitRateTrend` รวม edge case "รอผล" และ `take`-truncation, edge tracking ใน `dcBuildScoreRows`) ผ่านทั้งหมด พร้อม test เดิมทั้ง 4 ไฟล์ (`test_imperial_formula.js` ฯลฯ) ไม่มี regression · ตรวจใน browser จริงผ่าน preview tools: seed snapshot ย้อนหลังด้วยผลจริงจาก `/api/prize-history` verify ว่า hit-check ตรง (เช่น bottom2 งวด 16/06/2026 คือ "48" ตรงกับที่ทาย → ถูก, งวด 01/07/2026 bottom2 จริงคือ "62" ไม่ตรงกับที่ทาย → ไม่ถูก) และกราฟ rolling ให้ค่าตรงตามคำนวณมือ (100,100,100,100,80) · ไม่มี console error

**บั๊ก dev ที่เจอระหว่าง verify (ไม่ใช่บั๊กโค้ด):** `static/app.js` โหลดแบบไม่มี cache-busting query string (ต่างจาก `formula-engine.js?v=...`) ทำให้ browser ใช้ JS เก่าจาก cache ค้างแม้ server จะ serve ไฟล์ใหม่แล้ว (`curl` ยืนยันไฟล์ถูกต้อง แต่ `typeof dcAutoSaveSnapshot` ในเบราว์เซอร์ยัง `undefined`) — แก้โดยเพิ่ม `?v=dc-track-record1` ต่อท้าย `app.js` ใน `index.html`

## 2026-07-07 — แก้ total ของจักรพรรดิ/จักรพรรดิทองคำ ไม่ให้นับงวดที่ทายไม่ได้

**สาเหตุ:** ลองรัน backtest ด้วยข้อมูลย้อนหลังเยอะขึ้น (599 งวด แทน 200) เพื่อดูว่า edge ของจักรพรรดิ/จักรพรรดิทองคำ (ที่เท่ากันเป๊ะในผลก่อนหน้า) จะต่างกันไหมเมื่อมีข้อมูลมากขึ้น — พบว่า `total` ที่รายงาน (599) เจือจางด้วยงวดที่ไม่มีข้อมูล Sanook ในงวดก่อนหน้า (144 จาก 599 งวด) ซึ่งจักรพรรดิ/จักรพรรดิทองคำ**ทายไม่ได้ตั้งแต่แรก** (preds ว่างเปล่า) ไม่ใช่ "ทายแล้วพลาด" — แต่ `_computeFormulasBatch` เดิม push ผลลัพธ์เข้า backtest เสมอแม้ preds ว่าง ทำให้ถูกนับเป็น miss โดยอัตโนมัติ เจือจาง sample size ที่มีความหมายจริง

**แก้:** `_computeFormulasBatch`'s I-section เช็ค `if(_I.length)`/`if(_IG.length)` ก่อน push ผลลัพธ์ (ตรงกับที่ `_imperialCards` ฝั่งหน้า "ทำนาย" ทำอยู่แล้ว) — ยืนยันแล้วว่า `total` เปลี่ยนจาก 599 เป็น 455 (ตรงกับจำนวนงวดที่มีข้อมูล Sanook บนงวดก่อนหน้าจริง) โดยกลุ่มสูตรอื่นที่ไม่พึ่ง Sanook data (A-H) ยัง `total=599` เหมือนเดิมไม่กระทบ

**ผลลัพธ์ backtest ที่ 455 งวด (ข้อมูลเต็มที่มี):** จักรพรรดิ กับ จักรพรรดิทองคำ ยัง 0/455 ครั้งถูกทั้งคู่ edge เท่ากันเป๊ะ (−0.168%) — ไม่ใช่บั๊ก ยังเป็นผลจาก baseline ที่ต่ำมาก (~0.168%/งวด) ต่อให้มีข้อมูลเต็มที่ก็ยังมีโอกาสสูงที่จะเจอ 0 ครั้งถูกทั้งคู่ (ดูเหตุผลเต็มในรายการก่อนหน้า)

## 2026-07-07 — เพิ่มสูตรจักรพรรดิทองคำ กลุ่ม I (ISSUE-7)

**รีแฟกเตอร์:** แยก `_imperialCandidates(ranked)` ออกจาก `_imperialFormula` (cartesian expansion + dedupe ของเลข 2 อันดับแรกต่อหลัก) ให้ทั้งจักรพรรดิและจักรพรรดิทองคำเรียกใช้ร่วมกัน ไม่มี logic ซ้ำ — ยืนยันแล้วว่า จักรพรรดิ ให้ผลลัพธ์เหมือนเดิมทุกประการหลังรีแฟกเตอร์

**เพิ่ม `_imperialGoldFormula(prevRow, nextDay, nextMonth, nextYear2, topN)`:** ผสมคะแนน 80% ความถี่ (freqScore, normalize ด้วยคะแนนสูงสุดที่เป็นไปได้) + 20% ความใกล้เคียงกับเลขคณิต `(รางวัลที่1 + วัน×เดือน×ปี ของงวดถัดไป) mod 1,000,000` (สูตรเดียวกับกลุ่ม D) แสดงเป็น "I2 จักรพรรดิทองคำ" ทั้งในตาราง backtest (field `pool6`) และหน้า "ทำนาย" (การ์ดที่ 2 ใต้กลุ่ม I เดิม)

**บั๊กสำคัญที่พบระหว่างทดสอบกับข้อมูลจริง (ไม่ใช่แค่ fixture สังเคราะห์):** ออกแบบแรกใช้ "ความใกล้เคียง" แบบ exact-match ต่อหลัก (ตรงเป๊ะ=1 ไม่ตรง=0) — ทดสอบกับข้อมูลจริงพบว่าจักรพรรดิทองคำให้ผลลัพธ์**เหมือนจักรพรรดิทุกตัวอักษร** เพราะผู้สมัคร (candidate) มาจากเลข 2 อันดับแรกของความถี่เท่านั้น (สูงสุด 2 ตัวต่อหลัก จาก 10 ตัว) โอกาสที่เลขคณิตเป้าหมายจะตรงเป๊ะกับ 1 ใน 2 ตัวนั้นต่ำมาก ทำให้ closeness=0 ทุกชุดเสมอ คะแนนผสมเลยตกไปเป็นแค่ freqScore ล้วนๆ (20% ไม่มีผลจริงเลย) — แก้โดยเปลี่ยนเป็นระยะห่างเชิงตัวเลข `9-|เลขชุด−เลขเป้าหมาย|` ต่อหลัก (normalize ด้วย 54) แทน exact-match ยืนยันแล้วว่าหลังแก้ จักรพรรดิ กับ จักรพรรดิทองคำ ให้ candidate set ต่างกันจริงทุกงวดที่ทดสอบ (ทั้งจาก test script และเทียบกับข้อมูลจริงใน browser)

**หมายเหตุความจริงจาก manual browser check:** แม้ candidate set ต่างกันจริงทุกงวด แต่ edge ในตาราง backtest (หน้าต่าง 20/50/200 งวดที่มีในระบบ) ออกมาเท่ากันเป๊ะ — ไม่ใช่บั๊ก แต่เป็นผลจากคณิตศาสตร์: baseline ของ field `pool6` ต่ำมาก (~0.168%/งวด สำหรับเลข 6 หลักตรง pool ~168 เลข) ทั้งสองสูตรเลยได้ 0 ครั้งถูกในช่วงข้อมูลที่มี — เมื่อถูก 0 ครั้งเท่ากัน edge (`%แม่นจริง − baseline`) จะเท่ากันเสมอไม่ว่า candidate set จะต่างกันแค่ไหน (baseline ขึ้นกับจำนวนชุดทำนาย ไม่ใช่ตัวตนของชุด) ไม่ได้พยายามบิดข้อมูลให้ดูต่างกัน เพราะขัดกติกาข้อ 1

**ยืนยันแล้ว:** ทุก test script ผ่าน (`test_imperial_formula.js` 8 การตรวจสอบ รวมถึง distinctness proof บน realistic fixture, `test_codexpool_presets.js`, `test_codexpool_coeffs.js`, `test_pool_field_rename.js`), backtest table 40 แถว, หน้า "ทำนาย" กลุ่ม I มี 2 การ์ด (I1+I2), ไม่มี console error, standards/spec review (2 agent) ผ่านไม่มี hard violation

## 2026-07-06 — เพิ่มสูตรจักรพรรดิ กลุ่ม I (ISSUE-6)

**เพิ่ม 3 ฟังก์ชันใน `static/formula-engine.js`:** `_buildPrize1to5Pool(row)` (สร้าง pool จาก near1+prize2-5 ของงวดก่อนหน้าเดียว, ไม่รวม prize1) · `_digitPosFreq(pool6)` (นับความถี่เลขแต่ละหลัก 1-6 จาก pool, ranking พร้อม tie-break แบบเรียงเลขน้อยไปมาก — reusable, ISSUE-7 จะใช้ต่อ) · `_imperialFormula(prevRow, topN)` (เลือก 2 อันดับแรกต่อหลัก, ผสม cartesian ทั้ง 6 หลัก, คัดคะแนนรวมสูงสุด ~10 ชุด, คืนค่าว่างถ้าไม่มีข้อมูล pool)

**Wiring ครบทั้ง 2 จุด:** backtest table (แถว "I1 จักรพรรดิ" field `pool6` badge "I · จักรพรรดิ" สี `#c084fc`) และหน้า "ทำนาย" (dropdown กลุ่มสูตรใหม่ตัว I, panel `formula-results-I`, นับรวมในสรุปยอดสูตรทั้งหมด)

**บั๊กที่พบระหว่าง implement (คนละ workflow phase เจอเอง แก้เอง):** `String(v||'').padStart(6,'0')` ทำให้ field ว่างเปล่ากลายเป็น `"000000"` ปลอมที่ผ่าน regex `/^\d{6}$/` — แก้โดยเช็ค `.trim()` ว่าง**ก่อน** pad เสมอ

**Gap ที่พบตอน verify แล้วแก้เพิ่ม (main loop, หลัง workflow):** workflow เข้าใจผิดว่า wiring หน้า "ทำนาย" เสร็จแล้ว (เพราะเรียก `_computeFormulasBatch` ตรงๆ ทดสอบ) แต่จริงๆ ฟังก์ชันนั้นใช้แค่ฝั่ง backtest — หน้า "ทำนาย" จริงสร้างการ์ดเองแยกต่างหากผ่าน `runAllFormulas()`/`_codexCards`-style function คนละเส้นทาง เพิ่ม `_imperialCards(prevRow)` ตามแพทเทิร์นเดียวกับ `_codexCards` แล้ว wire เข้า `runAllFormulas()` จริง — พบว่าหน้า "ทำนาย" เดิมโหลดจาก `/api/history` (ไม่มีคอลัมน์ Sanook) เปลี่ยนเป็น `/api/prize-history` (superset คอลัมน์เดิมครบ + near1/prize2-5) แทน ไม่ต้องเพิ่ม fetch ใหม่

**ยืนยันแล้ว:** ทุก test script ผ่าน (`test_imperial_formula.js`, `test_codexpool_presets.js`, `test_codexpool_coeffs.js`, `test_pool_field_rename.js`), backtest table 39 แถว, หน้า "ทำนาย" กลุ่ม F/Codex ยังทำงานปกติหลังเปลี่ยน endpoint, ไม่มี console error

**ยังไม่ทำ:** ISSUE-7 (จักรพรรดิทองคำ — ผสม `_digitPosFreq` เดิมกับเลขคณิตกลุ่ม D)

## 2026-07-06 — ลบ FABLE ทั้งหมด (ISSUE-5)

FABLE ไม่ผ่าน promotion gate หลังจากพยายาม tune หลายรอบ (grid search, rolling W50/W100/W200, validation/live) — ตัดสินใจยกเลิกทั้งหมดแทนที่จะพัฒนาต่อ (ดู DEVELOPMENT_PLAN.md Phase 4)

**ลบ:** `fable_formula.py` ทั้งไฟล์ · 4 endpoints (`/api/fable`, `/api/fable-backtest`, `/api/fable-grid-search`, `/api/fable-holdout-report`) จาก `main.py` · ~600 บรรทัดของ FABLE UI/state/Lab ใน `static/formula-engine.js` · markup ของ FABLE tab ใน `static/index.html` · CSS ของ FABLE ใน `static/app.css` · การผูก FABLE เข้า Decision Center ใน `static/app.js` (API call, การ์ดแสดงผล, filter `startsWith('FB')` 2 จุดที่ไม่จำเป็นอีกต่อไป) · scripts ที่ทดสอบ FABLE (`scripts/test_fable_rolling_windows.py`, `scripts/test_fable_grid_search_rolling.py`)

**เก็บไว้ (ไม่ใช่ของ FABLE โดยเฉพาะ):** กลไก backtest ที่เทียบว่าเลขที่ทายตรงกับ pool รางวัล 1-5 ของงวดนั้นไหม — เปลี่ยนชื่อ field type จาก `fable6`/`fable_pool3` เป็น `pool6`/`pool_tail3` (และ `fablePool`/`fablePoolT3` เป็น `pool6Set`/`poolTail3Set`) ยืนยันด้วย regression test (`scripts/test_pool_field_rename.js`) ว่า baseline formula และ hit-check logic เหมือนเดิมทุกประการ ไม่มีผลกระทบต่อ backtest ที่มีอยู่

**อัปเดตเอกสาร:** CLAUDE.md และ DEVELOPMENT_PLAN.md ลบการอ้างอิง FABLE ที่ยัง active ออก แทนที่ด้วยบันทึกการยกเลิก + ชี้ไปยัง Phase 5 (จักรพรรดิ/จักรพรรดิทองคำ — ดู PRD-replace-fable-with-imperial-formulas.md)

**ยืนยันแล้ว:** app โหลดผ่าน, ไม่มี console error, ไม่มี "fable" หลงเหลือในโค้ด (`grep` ทั้ง repo), backtest table ยังทำงานปกติ (38 แถว A-H ครบ), Decision Center โหลดได้ปกติ

## 2026-07-06 — FABLE grid-search top-5 rolling compare + Group F coefficient presets

**ISSUE-1/2 (FABLE):** แยก `fable_rolling_windows()` ออกจาก `fable_backtest()` ให้ reuse ได้ (ผ่าน `_prepared` context กัน prep ซ้ำ) แล้วต่อยอดใน `fable_grid_search()`: หลัง evaluate 20 configs ด้วย train/holdout ตามเดิม เลือก **top 5 ตาม holdout score** (ไม่ใช่ `stable` flag เพราะวันที่ไม่มี config ไหนผ่านเลยก็ยังต้องเห็นตารางเทียบ) แล้วรัน rolling W50/W100/W200 เฉพาะกลุ่มนั้นผ่าน engine เดียวกับ `/api/fable-backtest?gate=true` (verify แล้วว่าตัวเลขตรงกันเป๊ะ ไม่มี logic สองชุด) ไม่มีการ persist ผลข้าม session ตามที่ตกลง

**ISSUE-3/4 (Formula Group F):** parameterize coefficient ของ `_codexPool`/`_codexFormulas` (เดิม hardcode 7 ค่า) เป็น `CODEX_DEFAULT_COEFFS` + เพิ่ม `CODEX_COEFF_PRESETS` 5 ชุด (baseline, recency-heavy, sameday-heavy, overdue-heavy, balanced) โผล่เป็นแถว `X10-X13` แยกในตาราง backtest หลัก (กลุ่ม D และสูตรพื้นบ้านอื่นไม่แตะ เพราะเป็นเลขคณิตตายตัว tune ไม่ได้จริง) หน้า "ทำนาย" ยังใช้ baseline อย่างเดียวเสมอ — ยืนยันด้วย `_codexCards`/`_codexFormulas` เส้นทาง predict ไม่อ้าง `CODEX_COEFF_PRESETS` เลย

**หมายเหตุ dev:** เจอ server ที่รันอยู่ (PID เก่า) ไม่มี `--reload` เลยเสิร์ฟโค้ดเก่าตอน verify ในเบราว์เซอร์ — ต้อง restart ผ่าน `.claude/launch.json`; และเจอ browser cache ค้าง static JS แม้ restart แล้ว ต้อง bump cache-busting query string ใน `index.html` (`?v=codex-presets1`)

## 2026-07-06 — แยกไฟล์ frontend + จัดระเบียบ path project

**แยก static/index.html (3006 บรรทัด) ออกเป็น 3 ไฟล์:**
- `static/app.css` — CSS ทั้งหมด (685 บรรทัด)
- `static/app.js` — core JS: init, api(), showPage/switchPredTab, loadXxx page loaders, Chart.js wiring (1750 บรรทัด)
- `static/index.html` — เหลือแค่ markup (568 บรรทัด)
- `static/formula-engine.js` — เดิม ไม่แตะ
- Script load order: formula-engine.js ก่อน app.js (app.js เรียก `init()` ท้ายไฟล์ที่ต้องพึ่งฟังก์ชันใน formula-engine.js)
- ยืนยันแล้ว: ไม่มีชื่อฟังก์ชันชนกันระหว่าง app.js/formula-engine.js, syntax ผ่าน, ทุก asset โหลด HTTP 200 ผ่าน server จริง

**ย้าย dev/debug script เข้า `scripts/`:** `debug.py`, `sweep.py`, `_rebuild_analyzer.py`, `test_scrape.py`, `test_multi_year.py`, `scrape_all.py` — เพิ่ม `sys.path` fix ให้แต่ละไฟล์ resolve project root เองเวลารันจาก `scripts/`

**จัดระเบียบ path — บังคับให้ lottery_stats มีแต่ไฟล์ของโปรเจกต์นี้เท่านั้น:**
- ลบ `tools/NewHireFormatter/` (C# HR tool ปนมา) — เช็คแล้วมีต้นฉบับอยู่ที่ `Desktop/claude/Codex/NewHireFormatter` แล้ว ลบสำเนาปลอดภัย
- ลบ `scripts/*bitn*.ps1` + ไฟล์เกี่ยวข้อง (network switch audit toolkit, 11 ไฟล์) — ไม่มีสำเนาที่อื่นในทั้ง workspace, ผู้ใช้ยืนยันให้ลบถาวรหลังเช็ค
- ย้าย `.streamlit/` เข้า `archive/` (config ของ Streamlit dashboard เก่าที่ archive ไปแล้วพร้อม `app.py`)
- ย้าย `app.py` (Streamlit เก่า, ไม่มีไฟล์ไหน import) เข้า `archive/`
- ลบไฟล์ log ค้าง: `enrich_err.txt` (0 byte), `enrich_log.txt`
- ย่อ `AGENTS.md` เป็น pointer ชี้ CLAUDE.md (เดิมเป็นสำเนา CLAUDE.md เวอร์ชันเก่าที่พูดถึง Watchlist/ML/8-pages ที่ถอดไปแล้ว — ข้อมูลขัดกัน)

**⚠️ ความผิดพลาดที่เกิดระหว่างทำ + วิธีแก้:** ตอนลบกลุ่มไฟล์ bitn เผลอลบ `scripts/run_here.ps1` ไปด้วย เพราะเห็นอยู่ติดกันใน listing แรกเลยเข้าใจผิดว่าเป็นไฟล์ในกลุ่มเดียวกัน — ทั้งที่จริงเป็นไฟล์ของโปรเจกต์นี้ (root `run_here.bat` เรียกใช้ตรงๆ) ไฟล์เดิมไม่อยู่ใน git กู้คืนต้นฉบับไม่ได้ **เขียนใหม่แทนที่** โดยอิงพฤติกรรมจาก `run.bat` (หา venv ที่ `%LOCALAPPDATA%\lottery_stats_runtime\.venv`, ติดตั้ง `requirements-api.txt`, รัน uvicorn) เพิ่มส่วนสร้าง venv อัตโนมัติตามที่ `run.bat` comment ใบ้ไว้ว่า `run_here.bat` ทำหน้าที่ "automatic setup" — ไฟล์ใหม่ผ่าน PowerShell syntax parse แล้ว แต่**ยังไม่ได้รันทดสอบจริงแบบ end-to-end** ควรลองรัน `run_here.bat` เองอีกครั้งเพื่อยืนยัน

## 2026-07-03 — macOS Dark restyle + UX audit fixes
- Restyle ทั้งแอปเป็น macOS dark: vibrancy sidebar + traffic lights, system-blue accent, segmented-control tabs, push buttons, translucent scrollbars
- แก้จาก UX audit: font-size ฐาน 17px (เดิมเล็กสุด ~10px), toast แจ้งเมื่อ API error, confirm ก่อนลบ FABLE snapshot, disabled button state, sticky table header ทึบแสง
- แก้ sub-tab สูตรที่เยอะเกิน (11 ปุ่ม) → รวม 8 กลุ่มสูตรหลักเป็น dropdown เดียว, เหลือปุ่มแยกแค่ ALL/FABLE/Backtest
- เหตุผลเลข FABLE จาก `title` tooltip (hover-only) → ปุ่มกดเปิด/ปิดข้อความ (keyboard/touch เข้าถึงได้)
- แก้ `launch.json` ให้ชี้ venv python ที่ถูกต้อง + `--app-dir lottery_stats --reload`

## 2026-07-02 — FABLE Phase 4 (4.5–4.13) + Gate Hardening + Decision Center rehearsal

**Signals เพิ่มทีละสัญญาณ พร้อม experiment:**
- `near_miss`: เลขใกล้ ±1 และเลขซ้ำใน pool history
- `slice_transition`: pattern ข้ามงวด head3→tail3, tail3→tail2
- `diversity_penalty`: greedy ranking ลด prefix/suffix ซ้ำในชุด final picks
- `draw_day`: แก้บั๊ก "เลือกงวด 1 ส.ค. กับ 16 ส.ค. ได้เลขเดิม" — เพิ่มน้ำหนักเลขจาก pool ของงวดในอดีตที่ slot วันตรงกัน (1.0) + เดือนตรงกัน (+0.6) คูณ recency; ยืนยันว่า `/api/fable?date=` ให้ผลต่างกันตามวันที่แล้ว

**Runtime optimization:** precompute pool/date arrays แทนเรียก `_draw_pool()`/`iterrows()` ซ้ำทุกงวด, cache `_neighbor_map`/`_all_slices` แทน regenerate — เร็วขึ้น 13–26% (ยืนยัน edge ตัวเลขไม่เปลี่ยนก่อน-หลัง)

**Gate hardening:** เพิ่ม validation/live window (ช่วงเก่ากว่า rolling ไม่ทับกัน) ให้ promotion gate ต้องพิสูจน์ generalization ข้ามช่วงเวลา ไม่ใช่แค่ overfit 200 งวดล่าสุด — แยก `_walk_forward_eval()` ใช้ engine เดียวกันทั้ง rolling/validation/live

**Decision Center rehearsal:** เพิ่มการ์ด "🧪 FABLE — สูตรทดลอง" ใน Decision Center แสดงเลขแบบ dashed border พร้อมข้อความชัดว่ายังไม่นับคะแนน — ยืนยันว่า config ชื่อขึ้นต้น `FB` ถูกกรองออกจาก `dcBuildScoreRows()` แล้ว (ไม่มีน้ำหนักรั่วเข้าคะแนนจริง)

**ผลทดลอง draw_day weight (200 งวด, window=100):**

| drawday_w | tail2 edge | tail3 edge |
|---|---:|---:|
| 0.0 | +0.155 | −0.025 |
| 0.25 (default) | +0.145 | +0.020 |
| 0.5 | +0.140 | +0.045 |

Grid search (80 งวด train/holdout) กลับให้ `drawday_off` ดีกว่า `default_v2`/`drawday_on_050` ทั้ง train และ holdout — สรุปว่าสัญญาณนี้ยังอยู่ระดับ noise ไม่ชัดว่าช่วยจริง ไม่กระทบ promotion gate (ยังไม่ผ่านทั้งคู่)

**Bug สำคัญที่แก้ระหว่างทาง:** `/api/fable-grid-search` และ `/api/fable-holdout-report` ไม่เคยคำนวณ `draw_day` เลยเพราะใช้ path คำนวณคนละตัวจาก `_score_tails` (`_tail_feature_table`/`_rank_feature_table`) — เพิ่ม `dates`/`target_ts` ให้ตรงกันแล้ว

**Runtime issue ที่เจอ:** server dev ที่รันไม่มี `--reload` เป็น process เก่าจากก่อน session — แก้ไข `.claude/launch.json` แล้ว restart ยืนยันผ่าน browser จริง

## 2026-07-02 — FABLE v1→v2 (Phase 4.1–4.4)
- v1: ทายเลขท้าย 2/3 ตัวจาก pool รางวัล 1–4 (~66 เลข/งวด) — signals: cross-frequency, digit-position, momentum, anti-lag
- v2: ขยาย pool เป็นรางวัล 1–5 (~168 เลข/งวด รวม prize5) + เพิ่ม **เลข 6 หลัก** (จับคู่ head3×tail3 คะแนนสูงสุด) เพราะเป้าหมายจริงคือถูกรางวัล ไม่ใช่แค่เลขท้าย
- Backtest 100 งวด: 6 หลักตรงตัว 0 hit (โอกาส ~0.17%/งวด), tail2 edge +0.3, tail3 edge −0.26 — ยังไม่ชนะสุ่ม
- เพิ่ม tab "✨ FABLE" ในหน้าสูตรคำนวณ, เข้าตาราง Backtest เป็น board แยก "FABLE (pool 1-5)" baseline ของตัวเอง

## 2026-07-02 — Phase 3.7: Desktop-First UI Cleanup
- ถอดเมนู/หน้า Watchlist และ ML Prediction ออกจาก sidebar (ไม่ได้ใช้จริงใน workflow) — เก็บ backend endpoints ไว้เป็น reference
- Sidebar เหลือ 5 หน้า: Dashboard / ทำนาย-สูตร / ตารางความถี่ / ผลย้อนหลัง / Backtest
- ตัดสินใจ: UI เป็น desktop-first ไม่ลงทุน mobile-friendly เพิ่มนอกจากแก้บั๊กที่ทำ desktop พัง
- QA ผ่าน desktop widths 1366/1440/1920px

## 2026-07-02 — Phase 3: UI ปรับปรุงรวม
- Shared control bar (date + ประเภทหวย) เหนือ tabs หน้าทำนาย/สูตร แทนที่แต่ละ tab มี date ของตัวเอง
- Dashboard: การ์ด "สูตรเด่นงวดนี้" จาก backtest ล่าสุด
- Decision Center: เพิ่มสัญญาณจากรางวัลรอง (prize2/3 10 งวดล่าสุด) แยกจาก metric backtest
- Mobile 480px ทดสอบผ่าน (ก่อนตัดสินใจ desktop-first ใน 3.7)
- Frontend cutoff งวดวันนี้ปรับเป็น 16:00 Bangkok

## 2026-07-02 — Phase 2: ปรับสูตรเดิมให้สอดคล้อง Database
- Backtest: เพิ่มคอลัมน์ "ถูกรอง" เช็กเลขทายตรงเลขท้าย near1/prize2/prize3/prize4/prize5 (นับแยกจาก hit/edge เดิม)
- แก้บั๊ก `/api/prize-history` ไม่คืน front3/back3 ครบ (backtest ต้องใช้)
- เพิ่ม rolling-window edge W50/W100/W200 — badge "⚠ ต่ำกว่าสุ่ม" เมื่อ W200 edge < −5%

## 2026-07-01/02 — Phase 1: Sanook data source + prize4/5
- เพิ่ม `sanook_scraper.py` ดึงรางวัลที่ 2/3 (+ข้างเคียง) เสริม myhora.com (ที่มีแค่รางวัล 1)
- ขยายดึงรางวัลที่ 4 (50 ใบ)/5 (100 ใบ) — เก็บเป็น string คั่น space ในคอลัมน์เดียว ไม่แตกเป็น 150 คอลัมน์
- Backfill: enriched 456/777 งวด (Sanook มีข้อมูลย้อนถึง ~2549, หยุดอัตโนมัติเมื่อไม่พบ 30 งวดติด)
- แก้บั๊ก timezone: `clientDraws()` ใช้ `getTimezoneOffset()` ผิดสูตรบน Windows UTC+7 ทำให้วันที่หวยออกวันนี้แสดงผิด — เปลี่ยนเป็น `7*3600*1000` ตรงๆ
- Merge หน้าทำนาย + สูตรคำนวณ + สรุปงวดนี้ (Decision Center) เป็นหน้าเดียวแบบ tabs
