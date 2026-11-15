# HANDOFF — ส่งงานระหว่าง Claude / GPT

ใครหยุดงานก่อน (โควตาหมด, หมดเวลา) ให้เขียนทับไฟล์นี้ แล้ว commit + push ก่อนเสมอ คนที่มารับช่วงอ่านไฟล์นี้ก่อนทำอย่างอื่น
**กติกาให้ไฟล์สั้น (เป้าหมาย ≤ ~40 บรรทัด):** งานที่เสร็จแล้ว → ย่อเป็นบรรทัดเดียวใน "ประวัติ" พร้อมลิงก์ spec/plan; ความรู้ถาวรย้ายไป spec หรือ `CLAUDE.md`; เก็บข้างบนเฉพาะสิ่งที่ session ถัดไปต้องรู้

## อัปเดตล่าสุด
- 2026-11-15 · Claude · การ์ดบิลค้าง/เปิดบิล และสรุปบิล เป็นธีม "น้องขุนเงิน" (merge แล้ว #51–#53: รูปบนการ์ด, ป้ายราคาไล่เฉด, แถวน้องนก, badge/🥇/💩; #52 แก้รูปไม่ขึ้น: ใช้ `siteOrigin()` ไม่ใช่ origin ลิงก์จอง); **PR ล่าสุดรอ merge:** ใช้ภาพวาดจริงจาก Gemini (`public/mascot/hero-*.jpg` 20:11), ประโยคน้องขุนเงินใหม่ประโยคเดียวต่อสถานการณ์ อยู่บรรทัดเดียว — รายละเอียดท้าย `BADBOT-REPLY.md`
- 2026-11-15 · Claude · merge เข้า main แล้ว (ขึ้น production): แก้การ์ดสรุปจ่ายครบที่ LINE ไม่รับ (#47) · การ์ด/เมนู Badbot แยกสีก๊วนแบบไล่เฉด (#48, #49) · รหัสแจ้งเข้ากลุ่มตอบได้ทุกกลุ่มที่ผูก · นับ "คน" ในข้อความ LINE เป็นคนจริง (#46, `peopleIn()` ใน `billing.js`) — รายละเอียด/กฎ Flex ของ LINE อยู่ใน `BADBOT-REPLY.md` ท้ายไฟล์; **การ์ด Flex ทุกแบบยังไม่ได้ดูใน LINE จริง**

- 2026-11-15 · Claude · แก้ "เปิดบิลแล้วไม่มีการ์ดขึ้น": webhook ถูก LINE ตัดที่ ~2 วินาทีกลางงานตอบ → ย้ายงานตอบไป `ctx.waitUntil` (PR รอ merge; รายละเอียดท้าย `BADBOT-REPLY.md`)

## ค้างอยู่ / ขั้นต่อไป
- **การ์ดน้องขุนเงิน:** ลองใน LINE จริง (รูป hero, ประโยคบรรทัดเดียวไม่ตกบรรทัดบนมือถือจริง, แถวไอคอนน้องนก, badge/🥇/💩); ความกว้างข้อความวัดจากฟอนต์ในเบราว์เซอร์ ฟอนต์ไทยของ LINE อาจต่างเล็กน้อย
- **ลองใน LINE จริง (ยังไม่เคย):** การ์ด Flex ทุกแบบ (รายชื่อ, สรุปจ่ายครบ, บิลค้าง, ตารางจัดคู่/Cup, อันดับ, เมนู) + สีไล่เฉด; จอง/ถอน/แนบสลิป/ผู้จัดรับเงินสดคนสุดท้าย → ข้อความเข้ากลุ่ม + บอทตอบ; แท็บบิล (! แดง, QR, เลือกสลิป); กด badge ตัวเอง → เลือกสาย; เช็กว่าคืนถัดไปตี 1 มีแถวใน `attendance`
- **สร้างบิลแล้วบางครั้งไม่เด้งเข้ากลุ่ม** (ยังไม่รู้สาเหตุ): มือถือรายงานผลลง log `line-notice:client` (`POST /api/line/notice-report`) — รอเจอครั้งที่ไม่เด้งแล้วดู `stage` (`no-credentials` / `not-group` / `no-permission` / `failed`); ถ้าไม่มีข้อความขึ้นเลยให้เปลี่ยน Endpoint LIFF เป็น root ตาม `LINE-LIFF.md`
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
- token Cloudflare: เก็บใน Network secrets ของ `api.cloudflare.com`; wrangler ใช้ `CLOUDFLARE_API_TOKEN=proxy-injected`

## สถานะเทส
- `npm test` 227/227 ผ่าน · `npm run build` และ `npm run format:check` ผ่าน

---
## ประวัติการส่งต่อ (ล่าสุดอยู่บน เก็บไว้ไม่เกิน 5 รายการ)
- 2026-11-15 Claude: Badbot ตอบเป็นการ์ด Flex ทุกแบบ (PR #39–#44 รายชื่อ/สรุปจ่ายครบ/ตาราง/อันดับ/บิลค้าง) + แก้บั๊กการ์ด + สีก๊วนไล่เฉด (#47–#49) — `BADBOT-REPLY.md`
- 2026-11-14 Claude: แจ้งเข้ากลุ่มตอนจอง/ถอน/จ่าย (#35; `LINE-LIFF.md`, spec `2026-11-14-line-group-notices*`) · tune query บิล (#34: index `bills_list`/`bills_open`, `json_each`) · tune performance (#32: โพลล์ `/api/state` เฉพาะแท็บ, `memberSession` query เดียว, `schema-cache.js`)
- 2026-11-13 Claude: Job badge 5 สาย × 3 job + เลือกสาย + badge ในแท็บรายชื่อ (#29, #30; `BOOKING.md`, spec `2026-11-13-job-badges*`)
- 2026-11-13 Claude: เมนูล่าง + แท็บบิล + ! แดง + ป้ายสถานะการ์ดจอง + ลบเว็บทดลอง; ทดลอง dev-login/รูปโปรไฟล์แล้ว revert (โค้ดเท่ากับ `064aa1e`)
- 2026-11-12 Claude: ตรวจสลิปด้วย AI ขึ้น production (#24–#26) — spec/plan ใน `docs/superpowers/`
