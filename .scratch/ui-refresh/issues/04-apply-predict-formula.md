# ปรับหน้าทำนาย/สูตร (ทุกแท็บย่อย) ตามระบบดีไซน์

Type: task
Status: closed (2026-07-14)
Assignee: claude (claimed 2026-07-14)
Blocked by: 02 (closed)

## Question

ใช้ระบบดีไซน์ที่ล็อกจาก #02 กับหน้า **ทำนาย/สูตร** (`page-predict`) — หน้าที่แน่นสุดในแอป

ครอบคลุมทุกแท็บย่อย:
- **ทำนาย** — toolbar, badges, ตารางผลทำนายทุกประเภท (grid เลียนใบหวย)
- **สูตรคำนวณ** — panel กรอกข้อมูลงวดก่อน, แท็บกลุ่มสูตร A–J + Backtest, การ์ดสูตร, ป้าย trust "ทดลอง"
- **สรุปงวดนี้** — Hero/Confidence board, Pick chips, เลขแนะนำ, track record, กราฟ hit-rate
- **(OLD VER)** — ปรับให้เข้าชุด แต่คงพฤติกรรม frozen ไว้

**ข้อกำหนด:** เปลี่ยนแค่ look — ห้ามแตะ logic สูตร/backtest/scoring, bump `?v=`, ยืนยันบนแอปจริงทุกแท็บย่อย (รันสูตร, สลับกลุ่ม, รัน backtest ยังทำงาน, ไม่มี console error)

**ผลลัพธ์:** หน้าทำนาย/สูตรทุกแท็บตรงตามระบบดีไซน์

## Resolution (2026-07-14)

โครงหลัก (segmented tabs, ปุ่ม, การ์ด, input, ตาราง) ได้จากกติกากลางของ #03 แล้ว — ตั๋วนี้เก็บ "ทองเก่า" hardcode ที่เหลือในโซน page-predict ให้เป็นระบบใหม่ (`?v=macos3`):

- ชุด Decision Center (สรุปงวดนี้): `.dc-pick.top` / `.dc-match[open]` / `.dc-reco-board` / `.dc-reco-head` / `.dc-reco-card.has-num` → tint ทองใหม่ `rgba(255,214,10,…)`; `.dc-meter-fill` gradient จบที่ `#ffd60a`
- Toolbar ทำนาย `.pred-shared-bar`, `.predict-spotlight`, `.predict-copy:hover`, `.rank-1`, `.ftab-btn[data-color=gold].active` → tint ทองใหม่
- แยก state ออกจากทองตามกติกา "ทอง=เลขเท่านั้น": `.ov-caution` → `--orange`; `.formula-chip.target` พื้นเพี้ยน (ส้มเก่า) → tint น้ำเงิน accent
- markup จุดเดียว: section header "รางวัลที่ 1" ใน index.html → tint ทองใหม่
- **ไม่แตะ JS** — สีกราฟใน app.js (เส้น trend ทองเก่า ฯลฯ) เป็นของตั๋ว #06 ธีม Chart.js

ยืนยันบนแอปจริง: สลับครบ 4 แท็บ (predict/formula/decision/oldver), decision คำนวณจริง (6 picks, 5 reco cards, สีใหม่ทุกจุด), ไม่มี console error
