# HANDOFF — ส่งงานระหว่าง Claude / GPT

ใครหยุดงานก่อน (โควตาหมด, หมดเวลา) ให้เขียนทับไฟล์นี้ แล้ว commit + push ก่อนเสมอ คนที่มารับช่วงอ่านไฟล์นี้ก่อนทำอย่างอื่น
**กติกาให้ไฟล์สั้น (เป้าหมาย ≤ ~40 บรรทัด):** งานที่เสร็จแล้ว → ย่อเป็นบรรทัดเดียวใน "ประวัติ" พร้อมลิงก์ spec/plan; ความรู้ถาวรย้ายไป spec หรือ `CLAUDE.md`; เก็บข้างบนเฉพาะสิ่งที่ session ถัดไปต้องรู้

## อัปเดตล่าสุด
- 2026-11-13 · Claude · branch `claude/clever-cori-cosdaj` (ยังไม่ merge): **dev-login ชั่วคราว** ทดสอบ production ไม่ต้อง LINE — ผู้ใช้ทดสอบอยู่ในก๊วนลับ `?club=test` เท่านั้น ดู `DEV-LOGIN.md` (เปิด/ปิด/ล้างข้อมูล) · Playwright ผ่านบน wrangler dev local · **อย่าลืมปิดและรัน cleanup หลังทดสอบ**
- 2026-11-13 · Claude · merge เข้า `main` แล้ว (ขึ้น production): ลบเว็บทดลอง `sena-web-next` ออกจากโค้ด · ! แดงที่แท็บ "บิล" เมื่อมีบิลค้าง · ป้าย "✓ ลงชื่อแล้ว / ⏳ สำรอง #n" ในการ์ดจอง · แก้บั๊กบิลเก่าสุดค้าง "กำลังโหลด…" — **ทดสอบด้วยข้อมูลจำลองเท่านั้น ยังไม่ได้ลองใน LINE จริงบนมือถือ**

## ค้างอยู่ / ขั้นต่อไป
- **ไม่มีงานค้างบังคับ**
- ลองใน LINE จริง: แท็บบิล (! แดง, QR บิลเก่าสุด, บันทึกรูป QR, เลือกสลิปจากแกลเลอรี), ป้ายสถานะในการ์ดวัน, ปุ่ม "ขอบิลค้างจ่าย" ในกลุ่ม — ถ้าเจอปัญหา ดูหัวข้อ "ต้องรู้" ด้านล่างก่อน
- ไอเดียยังไม่ตัดสินใจ: แจ้งเตือนส่วนตัวใน LINE (ได้ที่จากคิวสำรอง / ให้ส่งสลิปใหม่ — เช็กก่อนว่ามีอะไรอยู่แล้ว), เทสอัตโนมัติของการเลือกบิลที่เปิด (แยกเป็นไฟล์เทสได้แบบ `billing-overview.js`), ถามผู้เล่น/ผู้จัด 2–3 คนว่าติดตรงไหน, ดู neurons Workers AI กับสลิปจริง
- ตัดสินใจไม่ทำ: ชื่อผู้รับ, QR รวมหลายบิล, ปุ่มทวงเข้ากลุ่มอัตโนมัติ · Worker `sena-web-next` บน Cloudflare dashboard เจ้าของโปรเจกต์ขอเก็บไว้ (โค้ดอยู่ใน git ก่อน `ef9d50d`)

## ต้องรู้ (รายละเอียดเต็มใน spec)
- แท็บบิล: เมนูล่าง `public/next-nav.css` + `next-shell.js`; "บิล" = `#billsFrame` (iframe `/billing.html`, `bills-refresh` ตอนกดซ้ำ); แท็บ "จัดก๊วน" ซ่อนด้วย `hidden` (ห้ามลบ `#session` เพราะ `app.js` อ้าง id) — `docs/superpowers/specs/2026-11-13-bills-tab-design.md` (ท้ายไฟล์มีหมายเหตุการทำงาน)
- **สลิปที่แนบ = จ่ายแล้วทันที ไม่มีขั้นอนุมัติ** (เฉพาะเงินสดที่รอผู้จัดยืนยัน); ผู้จัดทำได้แค่ "ให้ส่งใหม่"
- `/api/member/bills` ต้องเป็น path นี้ ไม่ใช่ `?action=`; บิลที่โชว์ QR ใช้ `openMineId()` ตัวเดียวทั้งรายการและ `fillMine` (เคยพังเพราะเลือกคนละใบ)
- ตรวจสลิปด้วย AI (`slip-check.js`, spec `2026-11-12-slip-ai-check-design.md`): **ผล AI เป็นแค่ตัวช่วยผู้จัด** — ห้ามเปลี่ยนสถานะจ่ายอัตโนมัติ ห้ามให้ผู้เล่นเห็น (ถามเจ้าของก่อน); **`payer.amount` เป็นสตางค์**; เทียบวันที่สลิปกับวันที่แนบ (`OLD_SLIP_DAYS = 3`) ไม่ใช่วันตีแบด; `rejectNote` ผู้เล่นเห็น → ห้ามมีชื่อคนอื่น/บิลอื่น ≤ 240 ตัวอักษร; ปิดด้วย `SLIP_AI_ENABLED="false"` ใน `wrangler.jsonc`
- ทดสอบหน้าในเครื่อง: `.dev.vars` ใส่ `ADMIN_KEY=test-key` และ `LINE_MEMBER_AUTH_ENABLED=false` (git-ignore), `npx wrangler d1 execute DB --local --file=schema.sql`, `npx wrangler dev --local --compatibility-date 2026-05-22 --port 8799` + Playwright; ล็อกอิน LINE จริงทดสอบไม่ได้ ต้องจำลอง `/api/member/bills`
- ตรวจ deploy: `curl` หน้าจริงจาก https://sena-web.thegsbnut.workers.dev (`/court`, `/billing` — `.html` redirect) แล้วหา `?v=`
- ต้อง `npm install` ก่อนรันเทส; force push ถูกปฏิเสธ (ถ้า branch ถูก squash-merge: `git reset --hard origin/main` แล้ว `git merge -s ours origin/<branch>`)
- token Cloudflare: เก็บใน Network secrets ของ `api.cloudflare.com`; wrangler ใช้ `CLOUDFLARE_API_TOKEN=proxy-injected`

## สถานะเทส
- `npm test` 192/192 ผ่าน · `npm run build` และ `npm run format:check` ผ่าน

---
## ประวัติการส่งต่อ (ล่าสุดอยู่บน เก็บไว้ไม่เกิน 5 รายการ)
- 2026-11-13 Claude: ลบเว็บทดลอง + ! แดงแท็บบิล + ป้ายสถานะการ์ดจอง + แก้บั๊กบิลเก่าสุดไม่โหลด QR (ขึ้น production แล้ว)
- 2026-11-13 Claude: เมนูล่างเว็บจริง + แท็บบิลแทนจัดก๊วน (ผู้เล่นจ่ายในหน้าเดียว, ผู้จัดเคลียร์เงินสด/สลิปได้, LIFF ไปแท็บบิล) ขึ้น production แล้ว
- 2026-11-12 Claude: ตรวจสลิปด้วย AI ขึ้น production (PR #24 ฟีเจอร์ · #25 เปิดใช้ · #26 กฎวันที่ + เติมเหตุผลให้ส่งใหม่); เจ้าของโปรเจกต์ทดสอบผ่าน — spec/plan ใน `docs/superpowers/`
