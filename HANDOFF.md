# HANDOFF — ส่งงานระหว่าง Claude / GPT

ใครหยุดงานก่อน (โควตาหมด, หมดเวลา) ให้เขียนทับไฟล์นี้ แล้ว commit + push ก่อนเสมอ คนที่มารับช่วงอ่านไฟล์นี้ก่อนทำอย่างอื่น
**กติกาให้ไฟล์สั้น (เป้าหมาย ≤ ~40 บรรทัด):** งานที่เสร็จแล้ว → ย่อเป็นบรรทัดเดียวใน "ประวัติ" พร้อมลิงก์ spec/plan; ความรู้ถาวรย้ายไป spec หรือ `CLAUDE.md`; เก็บข้างบนเฉพาะสิ่งที่ session ถัดไปต้องรู้

## อัปเดตล่าสุด
- 2026-11-15 · Claude · merge เข้า main แล้ว (ขึ้น production) **การ์ดบิลธีม "น้องขุนเงิน"** (#51–#55): บิลค้าง/เปิดบิล + สรุปบิล = รูปบนการ์ด 20:11 (`public/mascot/hero-*.jpg`, ภาพวาดจากเจ้าของที่ตัดพื้นแล้ว) · ประโยคน้องขุนเงินประโยคเดียวต่อสถานการณ์ บรรทัดเดียว · ป้ายราคาไล่เฉด · แถวน้องนกคนละตัว · badge + 🥇/💩 ในรายชื่อคนค้าง (#52 แก้รูปไม่ขึ้น: ใช้ `siteOrigin()` ไม่ใช่ origin ลิงก์จอง) · **#55 webhook ตอบ LINE ทันทีแล้วตอบการ์ดใน `ctx.waitUntil`** (LINE ตัด webhook ที่ ~2 วินาที ตอนเปิดบิลการ์ดเลยไม่ออกและรหัส #xxxxx ถูกใช้ทิ้ง) — รายละเอียด/กฎทั้งหมดท้าย `BADBOT-REPLY.md`; ดีไซน์ https://claude.ai/artifact/CKZN9ktfE34KnwszesCmCx
- **การ์ด Flex ทุกแบบรวมถึงของน้องขุนเงินยังไม่ได้ดูใน LINE จริงหลังแก้ล่าสุด** — เจ้าของเห็นแค่ช่วงรูปไม่ขึ้น (แก้แล้ว) และครั้งที่การ์ดไม่ออก (แก้แล้ว #55); ยังไม่มีคนยืนยันว่าเปิดบิลแล้วการ์ดขึ้นครบหลัง deploy 23:31 น.

## ค้างอยู่ / ขั้นต่อไป
- **บิลอื่นๆ / บิลกินข้าว + เมนู "เก็บเงิน" — merge เข้า main แล้ว (#57, 2026-11-17)**: ผู้จัดหรือสมาชิกที่ผูก LINE สร้างบิลค่าข้าว ฯลฯ ได้ หาร 3 แบบ + guest ผูกกับสมาชิก ปัดขึ้นบาท คนสร้างจัดการบิลตัวเองได้ · ทางเข้า: การ์ดเมนู Badbot "เก็บเงิน" 💸 Sena/88 → หน้าสองแท็บ ค่าคอร์ต (ผู้จัด) / ทั่วไป (ทุกคน) · spec `docs/superpowers/specs/2026-11-16-custom-bills-design.md` · **ยังไม่ได้ลองใน LINE จริง:** การ์ดเมนูใหม่ (ปุ่มเก็บเงินเคยพาไปหน้าจองเพราะ `liff.js` ข้ามไป #booking เมื่อล็อกอินแล้ว — แก้แล้วบน branch รอ merge, มีเทสรัน `liff.js` จริงใน `test-custom-bill.mjs`), LIFF `page=collect`, สมาชิกที่ไม่ใช่ผู้จัดสร้าง/รับเงินสด/แก้/ยกเลิกบิล · เรื่องเล็กที่ยังไม่แก้: ชื่อบิลยาวในป้ายการ์ด, แถวคนออกเงินโผล่ใน "ของฉัน › จ่ายแล้ว", เพดาน 5 ใบเลี่ยงได้ด้วยยกเลิก/เปิดใหม่
- **ถามเจ้าของก่อนทำอย่างอื่น:** หลัง #55 เปิดบิลแล้วการ์ดขึ้นไหม (ดู `$workers.outcome` ของ webhook ใน observability ถ้ายังไม่ขึ้น); รูป hero/ประโยคบรรทัดเดียว/แถวน้องนก/badge/🥇💩 บนมือถือจริงถูกไหม (ความกว้างข้อความวัดจากฟอนต์ในเบราว์เซอร์ ฟอนต์ไทยของ LINE อาจต่างเล็กน้อย); รูปน้องที่ใช้ตัดมาจากตาราง 2×2 ของ Gemini (~600px) ถ้ามีต้นฉบับใหญ่กว่านี้ให้เปลี่ยน — ใช้ชื่อไฟล์ใหม่หรือเพิ่ม `MASCOT_VERSION`; ไฟล์ `public/mascot/open|remind|done.jpg` (แบบเก่า) ค้างไว้ให้แชตเก่า ลบได้ภายหลัง
- **ลองใน LINE จริง (ยังไม่เคย):** การ์ด Flex ทุกแบบ (รายชื่อ, สรุปจ่ายครบ, บิลค้าง, ตารางจัดคู่/Cup, อันดับ, เมนู) + สีไล่เฉด; จอง/ถอน/แนบสลิป/ผู้จัดรับเงินสดคนสุดท้าย → ข้อความเข้ากลุ่ม + บอทตอบ; แท็บบิล (! แดง, QR, เลือกสลิป); กด badge ตัวเอง → เลือกสาย; เช็กว่าคืนถัดไปตี 1 มีแถวใน `attendance`
- **สร้างบิลแล้วบางครั้งไม่เด้งเข้ากลุ่ม** (น่าจะเป็นเหตุเดียวกับ webhook ถูกตัดที่ ~2 วินาที ซึ่งแก้ใน #55 — ถ้ายังเกิดหลัง #55 ค่อยตามต่อ): มือถือรายงานผลลง log `line-notice:client` (`POST /api/line/notice-report`) — รอเจอครั้งที่ไม่เด้งแล้วดู `stage` (`no-credentials` / `not-group` / `no-permission` / `failed`); ถ้าไม่มีข้อความขึ้นเลยให้เปลี่ยน Endpoint LIFF เป็น root ตาม `LINE-LIFF.md`
- ผูกกลุ่ม: ก๊วนผูกได้ห้องเดียว แต่ผูกสองก๊วนเข้าห้องเดียวกันได้ (ตอนนี้ Sena = No Jackson, 88 = อีกห้อง; เจ้าของยังไม่ผูกเพิ่ม)
- ไอเดียยังไม่ตัดสินใจ: job พิเศษแจกในกิจกรรม (spec job badge หัวข้อ "ไอเดียในอนาคต"), แจ้งเตือนส่วนตัวใน LINE, เทสอัตโนมัติการเลือกบิลที่เปิด, ถามผู้เล่น/ผู้จัด 2–3 คนว่าติดตรงไหน, ดู neurons Workers AI กับสลิปจริง, MutationObserver ใน `cloud.js`
- ตัดสินใจไม่ทำ: ชื่อผู้รับ, QR รวมหลายบิล, ปุ่มทวงเข้ากลุ่มอัตโนมัติ, dev-login bypass บน production (ทำแล้ว revert), รูปโปรไฟล์ LINE (ทำแล้ว revert: โหลด LINE SDK ทำให้ LIFF ช้า เจ้าของไม่ยอมให้ช้า; ตาราง `member_pictures` ค้างใน D1 ลบได้), cache ไฟล์ static / Smart Placement · Worker `sena-web-next` บน Cloudflare เจ้าของขอเก็บไว้ (โค้ดอยู่ใน git ก่อน `ef9d50d`)

## ต้องรู้ (รายละเอียดเต็มใน spec)
- แท็บบิล: เมนูล่าง `public/next-nav.css` + `next-shell.js`; "บิล" = `#billsFrame` (iframe `/billing.html`, `bills-refresh` ตอนกดซ้ำ); แท็บ "จัดก๊วน" ซ่อนด้วย `hidden` (ห้ามลบ `#session` เพราะ `app.js` อ้าง id) — `docs/superpowers/specs/2026-11-13-bills-tab-design.md` (ท้ายไฟล์มีหมายเหตุการทำงาน)
- **สลิปที่แนบ = จ่ายแล้วทันที ไม่มีขั้นอนุมัติ** (เฉพาะเงินสดที่รอผู้จัดยืนยัน); ผู้จัดทำได้แค่ "ให้ส่งใหม่"
- `/api/member/bills` ต้องเป็น path นี้ ไม่ใช่ `?action=`; บิลที่โชว์ QR ใช้ `openMineId()` ตัวเดียวทั้งรายการและ `fillMine` (เคยพังเพราะเลือกคนละใบ)
- ตรวจสลิปด้วย AI (`slip-check.js`, spec `2026-11-12-slip-ai-check-design.md`): **ผล AI เป็นแค่ตัวช่วยผู้จัด** — ห้ามเปลี่ยนสถานะจ่ายอัตโนมัติ ห้ามให้ผู้เล่นเห็น (ถามเจ้าของก่อน); **`payer.amount` เป็นสตางค์**; เทียบวันที่สลิปกับวันที่แนบ (`OLD_SLIP_DAYS = 3`) ไม่ใช่วันตีแบด; `rejectNote` ผู้เล่นเห็น → ห้ามมีชื่อคนอื่น/บิลอื่น ≤ 240 ตัวอักษร; ปิดด้วย `SLIP_AI_ENABLED="false"` ใน `wrangler.jsonc`
- ทดสอบหน้าในเครื่อง: `.dev.vars` ใส่ `ADMIN_KEY=test-key` และ `LINE_MEMBER_AUTH_ENABLED=false` (git-ignore), `npx wrangler d1 execute DB --local --file=schema.sql`, `npx wrangler dev --local --compatibility-date 2026-05-22 --port 8799` + Playwright; ล็อกอิน LINE จริงทดสอบไม่ได้ ต้องจำลอง `/api/member/bills`
- ตรวจ deploy: `curl` หน้าจริงจาก https://sena-web.thegsbnut.workers.dev (`/court`, `/billing` — `.html` redirect) แล้วหา `?v=`
- ต้อง `npm install` ก่อนรันเทส; force push ถูกปฏิเสธ (ถ้า branch ถูก squash-merge: `git reset --hard origin/main` แล้ว `git merge -s ours origin/<branch>`)
- **ดู log/ฐานข้อมูล production** (ใช้ได้ ผ่านโทเคนที่ proxy ฉีดให้): `GET api.cloudflare.com/client/v4/accounts` ได้ account id; observability `POST /accounts/<id>/workers/observability/telemetry/query` (ดูรูปแบบใน `BADBOT-REPLY.md`) — event ของ `POST /api/line/webhook` มี `$workers.outcome` + `wallTimeMs` (**`canceled` ~1980ms = LINE ตัดสาย**); D1 `POST /accounts/<id>/d1/database/<db>/query` อ่านตาราง `line_notices` ฯลฯ ได้ (`GET .../d1/database` ได้รายชื่อ DB); เรียกถี่ได้ error 971 (throttle) รอสักครู่ — ใช้อ่านอย่างเดียว
- ภาพน้องขุนเงินมาจากเจ้าของ (Gemini) ผมตัดพื้นครีมด้วยการ flood-fill จากขอบ แล้ววางบนพื้นฟ้ามิ้นต์อ่อน 1040×572 (ผมมิ้นต์ของน้องกลืนกับพื้นเขียวเข้ม) — สคริปต์ไม่ได้เก็บไว้ ถ้าได้ภาพใหม่ให้ทำ 3 ท่า open/remind/done ขนาด 20:11 ไม่มีตัวหนังสือในรูป; โดเมน `share.gemini.google` อยู่ใน allowlist เครือข่ายของ environment แต่เปิดไม่สำเร็จ ให้เจ้าของแนบรูปในแชตแทน
- แก้ข้อความน้องขุนเงิน (`KHUN_NGERN_LINES`) ต้องวัดความกว้างก่อน: กล่องคำพูด ~270px, 12px ได้ ~255px, 11px ~260px
- token Cloudflare: เก็บใน Network secrets ของ `api.cloudflare.com`; wrangler ใช้ `CLOUDFLARE_API_TOKEN=proxy-injected`

## สถานะเทส
- `npm test` 256/256 ผ่าน · `npm run build` และ `npm run format:check` ผ่าน

---
## ประวัติการส่งต่อ (ล่าสุดอยู่บน เก็บไว้ไม่เกิน 5 รายการ)
- 2026-11-15 Claude: การ์ดบิลธีมน้องขุนเงิน + badge/🥇💩 + รูปชุดใหม่ + webhook ตอบเบื้องหลัง (#51–#55) — `BADBOT-REPLY.md`
- 2026-11-15 Claude: Badbot ตอบเป็นการ์ด Flex ทุกแบบ (PR #39–#44 รายชื่อ/สรุปจ่ายครบ/ตาราง/อันดับ/บิลค้าง) + แก้บั๊กการ์ด + สีก๊วนไล่เฉด (#47–#49) — `BADBOT-REPLY.md`
- 2026-11-14 Claude: แจ้งเข้ากลุ่มตอนจอง/ถอน/จ่าย (#35; `LINE-LIFF.md`, spec `2026-11-14-line-group-notices*`) · tune query บิล (#34: index `bills_list`/`bills_open`, `json_each`) · tune performance (#32: โพลล์ `/api/state` เฉพาะแท็บ, `memberSession` query เดียว, `schema-cache.js`)
- 2026-11-13 Claude: Job badge 5 สาย × 3 job + เลือกสาย + badge ในแท็บรายชื่อ (#29, #30; `BOOKING.md`, spec `2026-11-13-job-badges*`)
- 2026-11-13 Claude: เมนูล่าง + แท็บบิล + ! แดง + ป้ายสถานะการ์ดจอง + ลบเว็บทดลอง; ทดลอง dev-login/รูปโปรไฟล์แล้ว revert (โค้ดเท่ากับ `064aa1e`)
