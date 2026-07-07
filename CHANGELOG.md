# Changelog — Thai Lottery Intelligence Dashboard

ประวัติ implementation แบบละเอียด อ้างอิงเมื่อไม่แน่ใจว่า decision เก่าตัดสินใจทำไม สำหรับสถานะปัจจุบันดู [DEVELOPMENT_PLAN.md](DEVELOPMENT_PLAN.md)

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
