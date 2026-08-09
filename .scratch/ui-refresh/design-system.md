# Design System — macOS แท้ (locked 2026-07-14, ticket #02)

ระบบดีไซน์กลางของ UI refresh — แปลงจากทิศทาง "D — macOS แท้" (ตั๋ว #01) ผ่าน grilling กับเจ้าของ
ตั๋วลงมือ 03–05 ต้องยึดไฟล์นี้เป็นแหล่งความจริงเดียว

## หลักการ

1. **Vibrancy เฉพาะจุดเด่น** — hero / KPI / sidebar ใช้ `--surface-glass` + blur; การ์ดเนื้อหาหนาแน่น (ตาราง, Decision Center, Backtest) ใช้ `--surface` ทึบ
2. **ทอง = เลขหวย + แบรนด์เท่านั้น** — เลขรางวัล/ป้ายเลข/เลขร้อน + โลโก้ ใช้ทอง; ทุกอย่าง interactive (ปุ่มหลัก, ลิงก์, nav active) ใช้ `--accent` น้ำเงิน; หัวข้อหน้า = ขาว
3. **ฟอนต์เลข: IBM Plex Mono นำ** — `'IBM Plex Mono','SF Mono',ui-monospace,monospace` (คุมหน้าตาทุกเครื่อง; Windows ไม่มี SF Mono)
4. **ฟอนต์ข้อความ: system stack** — `-apple-system,BlinkMacSystemFont,'SF Pro Text','Segoe UI Variable','Segoe UI','Noto Sans Thai',sans-serif` — เลิกใช้ Syne เป็น display
5. **ไม่มี hover-lift บนการ์ด** — แบบ mac; interactive ตอบสนองเฉพาะตัวมันเอง

## Tokens (`:root` ใน app.css)

| Token | ค่า | ใช้กับ |
|---|---|---|
| `--bg` | `#161618` (พื้น gradient `#212124→#161618` บน body) | พื้นหลังแอป |
| `--surface` | `#1e1e21` | การ์ดทึบ |
| `--surface-glass` | `rgba(255,255,255,.055)` (+`--glass-blur`) | hero/KPI/sidebar |
| `--glass-blur` | `blur(28px) saturate(1.3)` | backdrop-filter |
| `--surface2` / `--surface3` | `#28282c` / `#333338` | ปุ่มรอง / hover |
| `--border` / `--border2` | `rgba(255,255,255,.14)` / `rgba(255,255,255,.09)` | ขอบเข้ม/เบา |
| `--text` / `--text2` / `--text3` | `#f5f5f7` / `#aeaeb4` / `#8e8e93` | ข้อความ 3 ระดับ |
| `--gold` | `#ffd60a` | เลขหวย + โลโก้ |
| `--gold2` | `#ffe14d` | เลขเน้น/hover |
| `--gold-dim` | `#8f7a10` | ขอบป้ายเลข |
| `--accent` | `#0a84ff` | ปุ่มหลัก ลิงก์ nav active |
| `--green` / `--red` / `--orange` | `#30d158` / `#ff453a` / `#ff9f0a` | success / danger / warn+ทดลอง |
| `--sp-1..7` | `4/8/12/16/20/24/32px` | spacing scale (การ์ด padding 16, กริด gap 14) |
| `--radius` | `12px` การ์ด | `--radius-digit` 10 · `--radius-btn` 8 · `--radius-badge` 6 · pill 999 |
| `--shadow-card` | `0 0 0 .5px rgba(255,255,255,.06) inset, 0 6px 18px rgba(0,0,0,.28)` | การ์ดทุกแบบ |
| `--mac-font` | system stack ข้างบน | ข้อความทั้งหมด |
| `--mac-mono` | `'IBM Plex Mono','SF Mono',ui-monospace,monospace` | เลขทั้งหมด |

สีกลุ่มสูตร / consensus-badge (hot แดง, agree เขียว, backtest+ cyan ฯลฯ) **คงค่าเดิม** — semantic ที่ผู้ใช้จำแล้ว

## สเปกคอมโพเนนต์

- **Card** — `--surface` + `--shadow-card`, radius 12, padding 16; ไม่มี hover-lift; แบบ glass เพิ่ม `background:var(--surface-glass); backdrop-filter:var(--glass-blur)`
- **card-title** — ฟอนต์ระบบ (ไม่ mono ไม่ uppercase), 600, `.78rem`, `--text3`
- **page-title** — ฟอนต์ระบบ 700, `1.7rem`, สีขาว `--text`, tracking `-.015em`
- **Button primary** — พื้น `--accent`, ตัวขาว 600, radius 8, hover `brightness(1.12)`
- **Button secondary** — พื้น `rgba(255,255,255,.09)`, ขอบ `.5px rgba(255,255,255,.10)`, ตัว `--text`, hover พื้น `--surface3`
- **Nav item active** — ตัว+ไอคอน `--accent`, พื้น `rgba(10,132,255,.12)`, radius 8 แคปซูล (margin ข้าง 8px), **ไม่มี border-left ทอง**
- **ตาราง** — หัวคอลัมน์ = สไตล์ card-title; เส้นคั่น `--border2`; row hover `rgba(255,255,255,.04)`; เลขหวยในตาราง mono ทอง
- **Digit box** — พื้น `rgba(255,255,255,.07)`, ขอบ `.5px rgba(255,255,255,.14)`, radius 10, เลขทอง 600
- **num-badge** — ขอบ 1px `--gold-dim`, ตัว `--gold`, radius 6; hot/cold/agree สีเดิม
- **trust-badge (ทดลอง)** — pill ส้มโทนเดิม
- **KPI tile** — card + ค่า mono 1.55rem; ตัวเด่น (countdown) `--gold`
- **Status pill** — radius 999, เขียว + จุดนำหน้า
- **Transition** — `all .18s ease` เฉพาะ interactive

## อ้างอิง

- ตั๋ว #01 + prototype: `static/prototype-ui-refresh.html` (variant d) — ลบได้หลังตั๋ว 03–05 เสร็จ
- กติกายืนจาก map: แตะแค่ CSS/markup เบาๆ, bump `?v=` ทุกครั้งที่แก้ static, desktop-first
