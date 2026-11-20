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
| `line-roster-card.js`, `line-bill-card.js`, `line-board-cards.js` | การ์ด Flex รายชื่อผู้ตี / สรุปบิลจ่ายครบ / ตารางจัดคู่ อันดับ ผล Cup (badge PNG ใน `public/badges/`) |
| `line-nudge.js` | ตามบิลค้างตอนเช้าแบบไม่ push: ข้อความตัวอักษรแรกของวัน (หลัง 08:00 เวลาไทย) ในกลุ่มที่ผูกก๊วน → ตอบการ์ดบิลค้างด้วย reply token ของข้อความนั้น 1 ครั้งต่อกลุ่มต่อวัน (ตาราง `line_daily_nudges`) |
| `sponsors.js`, `line-sponsor-card.js`, `line-sponsor-mark.js` | สปอนเซอร์วันแข่ง Cup: ตาราง `cup_sponsors`, ลง/แก้/ลบผ่าน `/api/booking` (`sponsorSave`/`sponsorDelete`), ย้ายตามปฏิทิน Cup, การ์ดขอบคุณ + แท็กตัวจริง, แถบท้ายการ์ด (ยกเว้นขุนเงิน) ตั้งแต่ลงถึง Cup+7 วัน — spec `docs/superpowers/specs/2026-11-20-cup-sponsors-design.md` |
| `backups.js`, `leaderboard.js`, `booking-holidays.js` | backup state, ตารางคะแนน Cup, วันหยุด |
| `public/engine.js` | อัลกอริทึมจัดคู่ (`globalThis.Sena.generate`) ใช้ทั้งในเบราว์เซอร์และ Worker |
| `public/custom-split.js`, `public/billing-custom.js` | บิลอื่นๆ (ค่าข้าว ฯลฯ ไม่ผูกกับรอบตีแบด): ตัวคำนวณหาร 3 แบบ (`globalThis.SenaCustomSplit.split` ใช้ทั้งเบราว์เซอร์และ Worker) + ฟอร์มสร้าง/แก้; ฝั่ง Worker อยู่ใน `billing.js` (`action=custom` / `people`, สิทธิ์ `manager` = ผู้จัดหรือคนสร้างบิล) — spec `docs/superpowers/specs/2026-11-16-custom-bills-design.md` |

## ข้อตกลงสำคัญ
- ก๊วนมีสองค่าเท่านั้น: `'sena'` (ค่าเริ่มต้น) และ `'88'` เลือกด้วย query `?club=` ข้อมูลแยกกัน (เช่น `club_state` / `club_state_88`)
- ตารางสร้างแบบ lazy (`CREATE … IF NOT EXISTS`) แต่คำสั่งทั้งหมดอยู่ที่ `schema.js` ที่เดียว: โมดูลเรียก `db.prepare(SQL.xxx).run()` ก่อนใช้ตาราง และ `schema-cache.js` รวมทั้งรายการเป็น `db.batch` เดียวต่อ isolate — ตารางใหม่ให้เพิ่มใน `schema.js` เท่านั้น (`test-schema.mjs` ตรวจ; `schema.sql` ไม่ครบ ไม่ต้องอ่าน)
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

## ต้องรู้ (ข้อควรระวังที่เคยพลาด)
- แท็บบิล = iframe `#billsFrame` (`/billing.html`) ใน `court.html`; กดซ้ำส่ง `bills-refresh`; ห้ามลบ `#session` (ซ่อนด้วย `hidden`, `app.js` อ้าง id) — spec `2026-11-13-bills-tab-design.md`
- **สลิปที่แนบ = จ่ายแล้วทันที** (เฉพาะเงินสดรอผู้จัดยืนยัน) ผู้จัดทำได้แค่ "ให้ส่งใหม่"; `/api/member/bills` ต้องเป็น path นี้ ไม่ใช่ `?action=`; บิลที่โชว์ QR ใช้ `openMineId()` ตัวเดียวทั้งรายการและ `fillMine`
- AI ตรวจสลิป (`slip-check.js`, spec `2026-11-12-slip-ai-check-design.md`) เป็นแค่ตัวช่วยผู้จัด ห้ามเปลี่ยนสถานะอัตโนมัติ ห้ามให้ผู้เล่นเห็น; `payer.amount` เป็นสตางค์; `rejectNote` ผู้เล่นเห็น ห้ามมีชื่อคนอื่น ≤ 240 ตัวอักษร
- Leaderboard ผูกผู้เล่นด้วย id (`teamIds`, ตาราง `cup_name_ids`) เปลี่ยนชื่อผู้เล่นแล้วประวัติตามเอง; ก๊วนผูกกลุ่ม LINE ได้ห้องเดียว แต่สองก๊วนผูกห้องเดียวกันได้
- ข้อความน้องขุนเงิน / รูปการ์ด / วิธีดู log production: `BADBOT-REPLY.md` · LIFF / แจ้งเข้ากลุ่ม (`line-notice:client` `stage`): `LINE-LIFF.md`

## ทำงานร่วมกับ AI หลายตัว (Claude / GPT)
- เครื่องมือ GPT อ่าน `AGENTS.md` ซึ่งชี้กลับมาที่ไฟล์นี้ — แก้กฎที่นี่ที่เดียว
- `HANDOFF.md` = สถานะงานที่ส่งต่อ: ก่อนหยุดงาน (โควตาใกล้หมด) ให้อัปเดต แล้ว commit + push ทันที ตอนเริ่มงานให้อ่านก่อน
- หนึ่ง branch ให้ AI ทำทีละตัว ห้ามสองตัวแก้ branch เดียวพร้อมกัน; commit เล็กๆ บ่อยๆ
- ส่งต่อได้เมื่อ `npm test` และ `npm run build` ผ่านเท่านั้น
- merge เข้า `main` เมื่อเจ้าของโปรเจกต์สั่งเท่านั้น

## Antigravity Remote Agent
- ใช้กฎในหัวข้อนี้เฉพาะตอนทำงานผ่าน Antigravity Remote Agent เท่านั้น
- ก่อนเริ่มงานให้อ่าน `HANDOFF.md`; ถ้าหยุดงานก่อนเสร็จ (โควตา/หมดเวลา) ให้อัปเดต `HANDOFF.md` แล้ว commit + push ตามกฎ handoff ด้านบน
- งานที่ขอให้แก้โค้ด: ให้เริ่มจาก `main` ล่าสุดและสร้าง branch ใหม่สำหรับงานนั้น
- รัน `npm run format`, `npm test` และ `npm run build` ตามกฎเดิมของโปรเจกต์ — ข้อยกเว้นเดียวของกฎ "ส่งต่อได้เมื่อ test/build ผ่านเท่านั้น": หากเช็กที่บังคับรันไม่ได้ ให้รายงานคำสั่งกับ error ที่เจอ แล้วรอเจ้าของโปรเจกต์ตัดสินใจก่อนส่งงาน
- เมื่อ checks ผ่าน: ให้ใช้ GitHub plugin (`gh api` / `gh pr create`) ส่งไฟล์ที่แก้ขึ้น branch แล้วเปิด Draft PR เข้า `main` พร้อมส่งลิงก์ PR, สรุปสิ่งที่แก้ และผล checks ให้เจ้าของโปรเจกต์ตรวจและกด merge เอง
- หากถามให้วิเคราะห์หรือรีวิวอย่างเดียว ให้ตอบในแชตโดยไม่ต้องสร้าง branch หรือเปิด PR

## เอกสารเพิ่มเติม
`docs/DEV-NOTES.md` (ดู production / ทดสอบหน้าในเครื่อง / ตรวจ deploy), `docs/BACKLOG.md` (งานค้างที่ยังไม่สั่งทำ), `README.md` (ตั้งค่า Cloudflare), `BOOKING.md`, `LINE-LIFF.md`, `BADBOT-REPLY.md`, `LINE-MENTION-AUDIT.md` (สรุปสั้น; ฉบับเต็มใน `docs/archive/` ไม่ต้องอ่านถ้าไม่ได้แก้เรื่องแท็ก)
