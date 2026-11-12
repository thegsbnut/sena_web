# SENA Court (sena_web)

ระบบจองตีแบดของก๊วน Sena และ 88 ผ่านกลุ่ม LINE: บอท Badbot (LINE OA) เปิดเมนูในกลุ่ม แล้วพาเข้าเว็บผ่าน LINE LIFF เพื่อจองคิว ดูตารางจัดคู่ และจ่ายบิล
ผู้ใช้/ผู้จัดคุยภาษาไทย — ข้อความที่แสดงผลในเว็บและในแชต LINE เป็นภาษาไทย

## Stack
- Cloudflare Worker (`worker.js` = entry, router) + static assets ใน `public/` (binding `ASSETS`)
- D1 สองตัว: `DB` (ข้อมูลหลัก) และ `SLIPS_DB` (รูปสลิปเป็น BLOB)
- Frontend เป็น vanilla JS/CSS ไม่มี framework ไม่มี bundler — ไฟล์ใน `public/` ถูกเสิร์ฟตรงๆ
- Deploy: Cloudflare Workers Builds จาก branch `main` (build `npm run build`, deploy `npx wrangler deploy`) — push ขึ้น main = ขึ้น production
- Cron `0 18 * * *` (01:00 เวลาไทย): `scheduledBookings` + `prunePaidSlips`

## โมดูลฝั่ง Worker
| ไฟล์ | หน้าที่ |
|---|---|
| `worker.js` | router, admin login (ADMIN_KEY → cookie `__Host-sena`), `/api/state`, `/api/generate`, `/b/<code>` short bill link |
| `booking.js` | `/api/booking` รอบประจำ, ลงชื่อ/ถอน, waitlist, จัดตาราง, Cup calendar |
| `billing.js` | `/api/billing` บิล, PromptPay QR, อัปโหลด/ดูสลิป, ข้อความบิลใน LINE |
| `member.js`, `member-shared.js` | LINE Login ผ่าน LIFF (verify idToken กับ LINE), session `__Host-sena-member`, ผูกบัญชี LINE กับชื่อผู้เล่นทั้งสองก๊วน |
| `line.js` | `/api/line/webhook` (ตรวจ HMAC), จับคู่กลุ่มด้วย `/badbot <code>`, หน้า admin เชื่อมกลุ่ม |
| `line-reply.js`, `line-mentions.js` | ตอบคำสั่ง/ปุ่มในกลุ่ม, สร้างข้อความ mention |
| `backups.js`, `leaderboard.js`, `booking-holidays.js` | backup state, ตารางคะแนน Cup, วันหยุด |
| `public/engine.js` | อัลกอริทึมจัดคู่ (`globalThis.Sena.generate`) ใช้ทั้งในเบราว์เซอร์และ Worker |

## ข้อตกลงสำคัญ
- ก๊วนมีสองค่าเท่านั้น: `'sena'` (ค่าเริ่มต้น) และ `'88'` เลือกด้วย query `?club=` ข้อมูลแยกกัน (เช่น `club_state` / `club_state_88`)
- ตารางสร้างแบบ lazy ด้วย `CREATE TABLE IF NOT EXISTS` ในโค้ดแต่ละโมดูล (`schema.sql` ไม่ครบ)
- ข้อมูลส่วนใหญ่เก็บเป็น JSON payload + `revision` — ทุกการเขียนต้องเป็น optimistic concurrency (`WHERE revision=?`) แล้วตอบ 409 เมื่อชน
- ทุก POST ใต้ `/api/` ต้องผ่านการเช็ก Origin (ยกเว้น LINE webhook)
- ฝั่ง frontend ต้อง escape ข้อความก่อนใส่ `innerHTML` (helper `html()`)
- `LINE_MEMBER_AUTH_ENABLED=true` ใน production: ผู้เล่นต้องล็อกอิน LINE และผูกชื่อก่อนจอง/จ่ายบิล

## Config / secrets
- vars ใน `wrangler.jsonc`: `LINE_LOGIN_CHANNEL_ID`, `LINE_LIFF_ID`, `LINE_LOGIN_ENABLED`, `LINE_MEMBER_AUTH_ENABLED`
- secrets ตั้งใน Cloudflare dashboard (ห้าม commit): `ADMIN_KEY`, `LINE_CHANNEL_SECRET`, `LINE_CHANNEL_ACCESS_TOKEN`; ตัวเลือก: `BILL_PROMPTPAY`, `LINE_BOOKING_URL`

## คำสั่ง
```
npm install
npm test             # node --test (ทุกไฟล์ test*.mjs), ต้องผ่านทั้งหมดก่อน push
npm run build        # node --check ไฟล์หลัก (ใช้ใน Cloudflare build)
npm run format       # prettier --write .
npm run format:check
```
- เทสใช้ D1/LINE แบบจำลองในไฟล์เทส ไม่ยิงไป LINE จริง
- เมื่อเพิ่มไฟล์เทสใหม่ ต้องเพิ่มชื่อไฟล์ใน script `test` ของ `package.json`
- รัน `npm run format` ก่อน commit; HTML และ `*.md` ไม่ได้จัดรูปแบบ (ดู `.prettierignore`)

## ทำงานร่วมกับ AI หลายตัว (Claude / GPT)
- เครื่องมือ GPT อ่าน `AGENTS.md` ซึ่งชี้กลับมาที่ไฟล์นี้ — แก้กฎที่นี่ที่เดียว
- `HANDOFF.md` = สถานะงานที่ส่งต่อ: ก่อนหยุดงาน (โควตาใกล้หมด) ให้อัปเดต แล้ว commit + push ทันที ตอนเริ่มงานให้อ่านก่อน
- หนึ่ง branch ให้ AI ทำทีละตัว ห้ามสองตัวแก้ branch เดียวพร้อมกัน; commit เล็กๆ บ่อยๆ
- ส่งต่อได้เมื่อ `npm test` และ `npm run build` ผ่านเท่านั้น
- merge เข้า `main` เมื่อเจ้าของโปรเจกต์สั่งเท่านั้น

## เอกสารเพิ่มเติม
`README.md` (ตั้งค่า Cloudflare), `BOOKING.md`, `LINE-LIFF.md`, `BADBOT-REPLY.md`, `LINE-MENTION-AUDIT.md` (สรุปสั้น; ฉบับเต็มใน `docs/archive/` ไม่ต้องอ่านถ้าไม่ได้แก้เรื่องแท็ก)
