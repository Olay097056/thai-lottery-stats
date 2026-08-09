# ปรับหน้าไม่รู้ซื้ออะไรดี (Mix) ตามระบบดีไซน์

Type: task
Status: closed (2026-07-14)
Assignee: claude (claimed 2026-07-14)
Blocked by: 02 (closed)

## Question

ใช้ระบบดีไซน์ที่ล็อกจาก #02 กับหน้า **ไม่รู้ซื้ออะไรดี / Mix** (`page-mix`; `loadMixPage` ใน `app.js`)

ครอบคลุม: control row (เลือกงวด + ปุ่มผสมใหม่), การ์ดผลเลขผสม 6 หลัก, track record, ปุ่มลิงก์ไป "จัดชุดซื้อจากเลขชุดนี้"

**ข้อกำหนด:** เปลี่ยนแค่ look — ห้ามแก้ logic `_mixCompute`/พฤติกรรม, bump `?v=`, ยืนยันบนแอปจริง (ผสมเลขได้, track record แสดงผล, ไม่มี console error)

**ผลลัพธ์:** หน้า Mix ตรงตามระบบดีไซน์

## Resolution (2026-07-14)

**ยืนยันบนแอปจริงแล้ว (browser tools ฟื้นจาก outage):** เปิดหน้า Mix — ผสมเลขจริง (เลขอันดับ 1: 457964, โหวตครบ 6 หลัก, ป้ายเลข 22 ใบ), hero เป็น glass (`blur(28px) saturate(1.3)` + พื้น `rgba(255,255,255,.055)`), เงาเลขใหญ่เป็นทองใหม่ `rgba(255,214,10,.22)`, track record บันทึก/แสดงผล, ไม่มี console error → ปิดตั๋ว

### รายละเอียดงาน (บันทึกไว้ตอนติด outage)

หน้า Mix ใช้คอมโพเนนต์กลาง (dc-*, num-badge, ปุ่ม, การ์ด) ที่ถูกธีมใหม่ครอบจาก #03/#04 แล้ว — แก้เพิ่ม 2 จุด (CSS ล้วน, `?v=macos4`):

- `.mix-hero` → วัสดุ glass (`--surface-glass` + `--glass-blur`) — hero ของหน้าเป็นจุดเด่นตามกติกา vibrancy
- `.mix-hero-num` text-shadow ทองเก่า `rgba(233,182,77,.25)` → ทองใหม่ `rgba(255,214,10,.22)`
- สีกราฟ Mix trend ใน app.js (`#f2ca73`) เป็นของตั๋ว #06 — ไม่แตะ

เซิร์ฟเวอร์ยืนยันส่งไฟล์ใหม่แล้ว (curl: HTML อ้าง `?v=macos4`, CSS มีทองใหม่) แต่ **ยืนยันบนแอปจริงผ่าน browser ยังไม่ได้** — เครื่องมือ browser ของ session ติด outage ชั่วคราว ปิดตั๋วได้เมื่อเปิดหน้า Mix แล้วเห็น: ผสมเลขได้, hero เป็น glass เงาทองใหม่, track record แสดง, ไม่มี console error
