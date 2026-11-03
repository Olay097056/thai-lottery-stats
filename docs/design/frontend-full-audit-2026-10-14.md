# Frontend audit ทุกหน้าและทุกแท็บ — 14 ตุลาคม 2569

## ขอบเขตและหลักฐาน

ตรวจครบรายการหน้า/แท็บที่มีใน source ปัจจุบัน ไม่ได้หมายถึงพิสูจน์ทุกสถานะและทุก browser 100%:

- 7 หน้า: Dashboard, ตารางความถี่, ทำนาย/สูตร, Mix, จัดชุดซื้อ, ผลย้อนหลัง, Backtest
- 4 แท็บหลัก: ทำนาย, สูตรคำนวณ, สรุปงวดนี้, OLD VER
- 14 มุมมองสูตร: A/B/C/D/E/F/G/H/I/J/HM/ALL/BT/ASTRA
- Astra v1 และ Sigma; จัดชุดซื้อทั้งแทงรายเลขและลอตเตอรี่ใบ; ตั้งค่าเรต
- ตารางความถี่เลือกครบ 13 ประเภทรางวัล
- light/dark × 390×844, 768×1024, 1440×900
- 150 layout observations + 36 ready-state observations = 186 รายการใน matrix
- ตรวจเพิ่มเติม ready/loading/error/empty ที่ fixture รองรับ และ keyboard navigation
- Node frontend suites 35 ไฟล์: ผ่าน 32, ไม่ผ่าน 3 (รายละเอียดด้านล่าง)

ใช้ browser บน synthetic fixture เท่านั้น ไม่มี live backend worker, ไม่มีการอ่านผลหวยจริง,
ไม่มี real backtest/refresh หรือเปลี่ยนสูตร production. Formula Backtest ใน browser ใช้แถวจำลอง.
พร้อม source inspection ของ manifest/module ownership, theme tokens, snapshot handling และ HTML.
ยังไม่ได้ทดสอบทุก save/delete/export/clipboard flow, quota/corrupt-storage ทุกจุด, external news,
registered Astra outcome UI ทุกสถานะ, screen-reader จริง, zoom 200%, Safari/Firefox หรือ slow-network ทุกกรณี.
Responsive matrix คือ DOM/computed-style observations; screenshots ถูกตรวจเป็นตัวแทน ไม่ใช่ 186 ภาพ.
Fixture รอบแรกบาง endpoint คืนรูปแบบไม่ครบ จึงแก้ fixture และแยก additional ready-state evidence.
ค่า overflow=false ไม่ยืนยันว่าไม่มี clipped content เพราะ body ใช้ overflow-x:hidden.

## Coverage รายหน้า

| หน้า/แท็บ | ตรวจ | ปัญหาหลัก |
|---|---|---|
| Dashboard | light/dark/3 sizes, synthetic latest, loading/error | Lift เขียนตายตัว, metadata เล็ก, ข้อผิดพลาดทำให้ widget อื่นค้างข้อความเริ่มต้น |
| ตารางความถี่ | 13 types, ready/error/retry UI, chart | สีกราฟเหลือง literal ไม่ใช้ brand token ใน light mode |
| ทำนาย | idle/ready/error source, score note, panels | ปุ่ม .btn เปล่าใช้ native background; Beam/Pool อยู่หน้าหลักมากไป |
| สูตร A/B/C/D/E/F/G/H/I/J/HM | ทุกกลุ่มมีผลจำลอง + 6 profiles | filter/copy text เล็ก, ชื่อเป้าหมายภาษาอังกฤษ, source cutoff ผิด |
| สูตร ALL | 6 profiles/ready | ผลหลายกลุ่มยาวมากและหลายชั้นก่อนถึงเลข |
| สูตร BT | 6 profiles/ผลย้อนหลังจำลอง/ทะเบียนว่าง | โครงสร้างดีขึ้นหลังแก้ แต่ยังมี raw colors ใน Pool comparison |
| Astra v1 | ready/error/2 variants × profiles | log score ดิบยาว, ข้อมูลเก่าคำเตือนซ้ำจาก backend และ UI |
| Sigma | ready/error/profiles | component A/H/D/N/L/B แน่นและศัพท์ย่อบนการ์ดหลัก |
| สรุปงวดนี้ | ready/error/profiles + contrast measurement | native number buttons contrast ต่ำ, API fail ยัง auto-save, CTA ซ้ำ |
| OLD VER | ready/error/profiles/source | ปัญหา API failure/number buttons ร่วมกับรุ่นปัจจุบัน; status copy แยกรุ่นไม่ชัด |
| Mix | ready/error/profiles | ปุ่มจัดชุดซื้อ native, มี gradient และ metadata เล็ก; Pool label ชัดขึ้นแล้ว |
| จัดชุดซื้อ | 2 modes × profiles, config, ready/error | config/+เพิ่ม native, ปุ่มอธิบายแถวมีชื่อสัญลักษณ์ ▸, ต้นทุน/คะแนนหนุนต้องอ่านหลายชั้น |
| ผลย้อนหลัง | ready/error/retry/profiles | table scroll region มีอยู่แล้ว; ฟอร์แมตวันที่ต่างจากหน้าอื่น |
| Backtest sidebar | Ultimate ready fixture + Astra empty/error | Ultimate metric/chart colors hardcoded; Astra empty row มี dot ค้างหลังชื่อ |
| Shared shell | theme/navigation/health/responsive | mobile menu ห่อคำหลายบรรทัดและข้อมูลแน่น; pointer run บางรายการไม่ไปหน้าที่ขอ จึงยืนยัน error paths ด้วย Enter และแยก evidence |

## Findings ตามความสำคัญ

### F01 — สูง: ปุ่มเลขอ่านยากจริงใน dark mode

`static/app.css:326` .num-badge กำหนดสี/ขอบแต่ไม่กำหนด background/appearance สำหรับ button.
`numChip` สร้าง button จึงได้ native rgb(240,240,240). .agree สี rgb(134,239,172)
ให้ computed contrast ประมาณ **1.23:1** กับพื้นนั้น. ภาพ decision-native-buttons-dark.png ยืนยัน.
พบปุ่ม .btn ไม่มี variant ใน Mix, จัดชุดซื้อ และทะเบียน first prize ด้วย.
แก้ shared neutral button defaults และ button.num-badge ให้ใช้ surface/text tokens พร้อม hover/focus.

### F02 — สูง: API failure ยังถูกบันทึกเป็น Snapshot แรก

`static/shared/api-client.js` คืน failure object ไม่ได้ throw. `decision-center.js:729` และ
`decision-legacy.js:607` ไม่ตรวจ error ก่อนดึง categories/history แล้วเรียก auto-save.
`decision-center.js:205` เก็บครั้งแรกต่อวันที่โดยไม่ตรวจความครบ.
Error fixture แสดงบันทึกใหม่และข้อมูลแหล่งที่มาว่าง (`decision-error-final.txt`).
ต้องแยก loading/error/partial/ready, ห้าม save เมื่อ required inputs fail และมี retry ชัดเจน.
นี่เป็นปัญหาความถูกต้องของรายงาน ไม่ใช่เพียงธีม.

### F03 — สูง: ข้อมูลที่ใช้ถึงแสดงผิดเพราะเรียง DD/MM/YYYY เป็นข้อความ

`formula-calculators.js:1307`, `decision-center.js:766` ใช้ .filter(date<ISO).sort() กับวันที่
จาก prize-history ซึ่งเป็น DD/MM/YYYY. Fixture input latest 09/08/2026 แต่ provenance แสดง
20/07/2026. ต้อง normalize เป็น ISO ก่อนเปรียบเทียบ เรียง และแปลง display ตาม locale.
ห้ามแก้ย้อนหลังใน immutable saved reports; legacy provenance ต้องระบุข้อจำกัด.

### F04 — สูง: Dashboard แสดงสถิติ Lift ตายตัว

`dashboard-ui.js:302` ใส่ข้อความ Front3 ~11.1x / Back3 ~2.2x / sum ~13.3x (n=80)
ทุกครั้งที่ผล predictor สำเร็จ แม้ใช้ fixture. ไม่ใช่ผลล่าสุดที่ API คืนและ sum ไม่ใช่โอกาสถูก 6 หลัก.
ควรนำออกหรือแสดงเป็นรายงานย้อนหลังระบุวันที่/ชุดข้อมูล/metric อย่างชัดเจน.

### F05 — กลาง: เมนูมือถือห่อคำจนอ่านยาก

390px ภาพ decision-mobile-dark.png แสดงข้อความเมนูแตกเป็นหลายบรรทัดบางคำและ footer
แน่นมาก. horizontal scroll cue มีอยู่ แต่ยังต้องกำหนด item width/nowrap/label hierarchy
และทดสอบ pointer ไม่ให้ซ้อน control. Matrix ready ทั้ง 7 หน้าเปิดได้; error pointer batch
บางครั้งคงหน้า predict จึงยังไม่สรุปสาเหตุ และยืนยัน keyboard paths แยกไว้.

### F06 — กลาง: CTA ซ้ำและ setting เชิงเทคนิคอยู่ใน flow หลัก

สรุปงวดนี้มี “คำนวณสรุปงวดนี้” ทั้ง shared bar และ local control. Predict มี Beam width/Back3
Pool พร้อมคำอธิบายเต็มก่อนผล. จัด shared primary หนึ่งจุดและ advanced settings พับเก็บได้.

### F07 — กลาง: ตัวอักษร metadata/filter เล็ก

computed copy text 11.22px และ consensus filter 11.9px. `dc-label`, `dc-source-chip`,
`dc-signal-sub` ยังคง .63–.68rem หลายจุด. ต้องกำหนด scale body/metadata/control ร่วมกัน
และตรวจข้อความไทยบนมือถือ ไม่ใช่เพิ่ม html font-size ทั้งแอปอย่างเดียว.

### F08 — กลาง: literal colors/gradient ยังไม่เข้ากติกา flat HyperUI

`dashboard-ui.js` chart yellow rgba(255,214,10,.7); `history-ui.js:167/198` ใช้ Apple green,
orange/red และ chart palette literal. Decision/Mix หลาย panel มี gold/green gradients.
เปลี่ยน interactive/status/chart เป็น theme semantic tokens; สีประจำสูตรที่ล็อกไว้คงเดิม.

### F09 — กลาง: Astra score/components แย่งพื้นที่เลข

v1 แสดง log_score binary64 ดิบหลายทศนิยม; Sigma แสดง component 6 ค่าในทุกเลข.
ให้จำนวนทศนิยมสำหรับ display เท่านั้นและย้ายรายละเอียดไป disclosure โดยเก็บ score ดิบ
ใน report/export และคงการเรียงเดิม. Deduplicate stale-data warnings ที่มีความหมายเดียวกัน.

### F10 — กลาง: accessibility ราย control ยังต้องปรับ

Buy Plan row explain toggle มี label เป็น ▸ ใน DOM snapshot; title ช่วย tooltip แต่ควรมี
aria-label ที่ระบุเลข/หน้าที่ และ aria-controls ให้สัมพันธ์กับแถวรายละเอียด.
51? ไม่ใช่: static shell มี **50 inputs/selects/textareas**, ไม่มี duplicate IDs.
ห้า config inputs อยู่ภายใน label จึงมี implicit labels ถูกต้อง; scanner ที่หาเฉพาะ for
ไม่ถือเป็น finding. ตรวจ keyboard/visible-focus ของ disclosure และ copy/delete ต่อ.

### F11 — ต่ำ: presentation provenance ยังใช้ศัพท์ภายในมาก

UTC ISO timestamp, SHA256, client_unverified, settings JSON แสดงยาวใน details.
ควรให้ Thai readable time/source label และเก็บค่าดิบในรายละเอียด/ส่งออก. Astra registry
placeholder แสดง “Astra v1 · ทดลอง ·” ทั้งที่ไม่มี code hash; render separator เฉพาะมีค่า.

### F12 — กลาง: audit tests สะท้อนความคาดหวังเก่า

32/35 suites ผ่าน. accessibility และ ux suites ยัง assert green active tab / var(--text)
ขณะที่ direction ล่าสุดใช้ brand gold; ต้องตัดสิน design contract และตรวจ contrast ก่อนเปลี่ยน assert.
Docs test นับ regex id="page-*" รวม subtree/status IDs และอาจ match data-status-id จึงอ้าง
11 pages ทั้งที่ actual `.page` มี 7. อย่าแก้ CLAUDE ให้บอก 11 เพื่อให้ test ผ่าน.
CSS scanner พบ --text1 ไม่มี definition; ตรวจ affected cascade และแทนด้วย token ที่มีจริง.

## สิ่งที่ผ่านและข้อจำกัด

ไม่พบ duplicate ID ใน shell; ไม่พบ JS error/warn ใน ready fixture ระหว่าง snapshots/log capture.
7 pages และทุก formula option reachable ใน ready matrix; html document ไม่มี horizontal overflow
ใน 186 observations แต่ clipping ยังต้องตรวจต่างหาก. Formula sort buttons แก้ธีมแล้ว มี aria-sort,
keyboard action และ focus styles; board-local summary ไม่มี headline raw hit ข้ามเป้าหมายแล้ว.
Astra Backtest views แยก prospective กับย้อนหลังและระบุ empty state ถูกต้อง.
ยังไม่ใช่ WCAG certification หรือหลักฐาน predictive accuracy.

## ลำดับแก้ที่เสนอ

1. F02/F03/F04 — ความถูกต้องของ error state, provenance และสถิติบน Dashboard
2. F01/F05/F10 — button defaults, contrast, mobile nav และ keyboard labels
3. F06/F07/F08/F09/F11 — ลดความแน่น/คำศัพท์ภายในและจัด theme tokens
4. F12 — เปลี่ยน contract tests ให้ตรวจ behavior/DOM จริงตาม design ที่ตกลง

## หลักฐาน

ไฟล์ทั้งหมดอยู่ `.scratch/frontend-full-audit/`: viewport-theme-matrix.json,
ready-states-matrix.json, formula-tabs.json, initial-pages.json, additional-states.json,
error-states-verified.json, decision-error-final.txt, decision-dark-contrast.json,
node-tests.json, static-inventory.json และ screenshots. error-states.json เป็น pointer
attempt แรกที่บางหน้าไม่ถูกเปิด ใช้ verified file เป็นหลัก. Fixture server ถูกหยุดหลังตรวจ;
viewport reset และแท็บใช้งาน audit ปิดแล้ว. ไม่มี production source edits ในรอบ audit นี้.
