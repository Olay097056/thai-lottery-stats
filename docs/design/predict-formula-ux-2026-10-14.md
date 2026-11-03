# UX update: Prediction and Formula workspace

วันที่: 2026-10-14

## แนวทางภาพ
HyperUI “โต๊ะวิเคราะห์งวด”: งวดเป้าหมายเป็นจุดนำสายตา จากนั้นเลือกมุมมอง คำนวณ และอ่านผล ใช้พื้นผิว เส้นขอบ สีเน้น และฟอนต์ที่มีอยู่แล้วของแอป เพื่อให้หน้าทำนายและสูตรเป็นชุดเดียวกับหน้าส่วนอื่น

DFII: 15 (งานปรับหน้าเฉพาะจุด)

## การเปลี่ยนแปลง
- หน้าทำนายใช้ช่องเลือกงวดร่วมที่แถบหลัก ลดช่องเลือกวันซ้ำในแท็บ
- ย่อขั้นตอนการใช้งาน และพับคำอธิบายวิธีไว้ตามต้องการ
- ให้ชุดเลขผลลัพธ์หลักมาก่อน ส่วนการตัดสินใจ/สัญญาณสนับสนุนพับไว้เป็นรายละเอียดเสริม
- Snapshot แสดงเป็นแถวขนาดกะทัดรัดพร้อมจำนวน
- หน้าใช้สูตรเน้นวันเป้าหมายและแหล่งอ้างอิงงวดก่อน; วันที่แสดงตามสถานะงวดร่วม
- รวมช่องแก้ข้อมูลประวัติไว้ในส่วนพับ โดยเปิดส่วนนี้เมื่อข้อมูลย้อนหลังไม่ครบ
- ปรับข้อความปุ่ม ตัวกรอง และป้ายผลเป็นภาษาไทยที่บอกขอบเขตคะแนนชัดเจน
- ใช้ style tokens และฟอนต์ที่โปรเจกต์มี เช่น `--gold`, `--surface`, `--border`, Noto Sans Thai และ IBM Plex Mono; ไม่เพิ่มไลบรารี

## สัญญาการทำงาน
คง id และ hook ที่ใช้โดย JavaScript ไว้ ช่องวันภายในถูกซ่อนจากการมองเห็นแต่ยังซิงก์กับวันที่หลัก รายละเอียดที่ไม่จำเป็นถูกพับหลังการคำนวณ ส่วนแก้ข้อมูลอ้างอิงยังเปิดได้ และเปิดเองในกรณีที่โหลดประวัติไม่ได้ การคำนวณและแหล่งข้อมูลเดิมไม่ได้เปลี่ยน

## ตรวจด้วยมือ
ใช้ fixture ข้อมูลจำลองบน `localhost:8515` ที่ viewport มือถือ 499×756:
- เปิดแท็บทำนายและตรวจว่ามีวันที่หลักเพียงจุดเดียว
- รันตัวอย่างและตรวจว่าผลหลักมาก่อนส่วนรายละเอียดเสริม
- เปิดแท็บสูตรและตรวจวันที่เป้าหมาย งวดอ้างอิง ปุ่มโหลด และช่องแก้ข้อมูลแบบพับ
- ตรวจ AX labels สำหรับปุ่มและ disclosure

`git diff --check` ผ่าน ไม่มีการรัน test suite ตามขอบเขตคำขอ; ผลนี้ไม่ได้ยืนยันความแม่นยำของสูตร และไม่มีการทดสอบกับผลหวยจริงหรือ backtest

## Follow-up: compact experiment disclosure
The prospective first-prize tracker is optional and records five distinct six-digit candidates per method before a draw, then compares exact first-prize outcomes when available. The collapsed control is now a compact, labeled disclosure instead of a full-width card; opening it still reveals the explanation and registration, read, and export actions.
Expanded state now has a short purpose row, three aligned core actions, separate registry/export actions, a folded rules section, and a distinct status line. This preserves the registration controls while keeping methodology copy out of the main action flow.
