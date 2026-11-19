# HANDOFF — ส่งงานระหว่าง Claude / GPT / Gemini

ใครหยุดงานก่อน (โควตาหมด, หมดเวลา) ให้เขียนทับไฟล์นี้ แล้ว commit + push ก่อนเสมอ คนที่มารับช่วงอ่านไฟล์นี้ก่อนทำอย่างอื่น
**กติกาให้ไฟล์สั้น (≤ ~40 บรรทัด, ไม่เกิน ~8KB — hook ตอนเริ่ม session ตัดไฟล์ที่ยาวเกินทิ้ง AI ตัวถัดไปจะเห็นแค่ต้นไฟล์):** บรรทัดละเรื่อง งานที่เสร็จแล้วย่อเป็นบรรทัดเดียวใน "ประวัติ" รายละเอียดไปอยู่ใน spec / `BADBOT-REPLY.md` / `LINE-LIFF.md` / `CLAUDE.md`

## อัปเดตล่าสุด
- 2026-11-19 · Claude · ขึ้น main แล้ว: แก้แท็บบิลปัดแล้วไปเลื่อนหน้าข้างหลัง (ล็อก `html.bills-open` ใน `next-shell.js`/`next-nav.css`) · คำสั่งสร้างตารางทั้งหมดย้ายไป `schema.js` + `schema-cache.js` สั่งเป็น `db.batch` เดียวต่อ isolate (ตารางใหม่ต้องเพิ่มที่ `schema.js` เท่านั้น — `test-schema.mjs` ตรวจ)
- 2026-11-19 · Claude · ไม่ merge (เจ้าของบอกพอแล้ว): โหลด iframe บิลล่วงหน้า + ยิง `/api/member` พร้อมรายการบิล — commit `667b1e2` บน branch `claude/intelligent-faraday-cv6766` หยิบมาใช้ได้ถ้าเจ้าของสั่ง
- 2026-11-19 · Antigravity · #76–#80 ขึ้น main แล้ว: toast หน้าบิล, พรีวิวสลิป + modal ตรวจสลิปผู้จัด, ปุ่มดึงคนตีรอบวันนี้ในบิลค่าข้าว, ซ่อนแถบผู้จัดสำหรับคนทั่วไป + แถบโปรไฟล์สั้น, ปุ่ม `ถอนชื่อฉัน` บนการ์ดวัน + ไฮไลต์ชื่อตัวเอง · ยังไม่ได้ลองบน LINE/มือถือจริง
- 2026-11-18 · Antigravity · #70–#73 ขึ้น main แล้ว: ปุ่มเดียว `💸 เก็บเงิน`, ตาราง `member_promptpay` จำเลขพร้อมเพย์รายคน, คนสร้างบิลขึ้นจ่ายแล้วอัตโนมัติ · ยังไม่ได้ลองบน LINE/มือถือจริง

## ค้างอยู่ / ขั้นต่อไป
- **ความเร็ว (วัด 2026-11-19):** Worker CPU p50 2.7ms, wall p50 127ms / p99 1.76s; `sena-db` อยู่ APAC แต่ **`sena-bill-slips` อยู่ WNAM** (แนบ/ดูสลิปข้ามแปซิฟิก) — ย้ายต้องสร้าง D1 ใหม่ระบุ APAC แล้วก๊อปข้อมูล ยังไม่ทำ · `/api/booking` ยิง query พร้อมกันอยู่แล้ว ไม่ต้อง tune ต่อ
- **ผลรีวิวที่ยังไม่แก้ (รอเจ้าของสั่ง):** เพดานบิลทั่วไป 5 ใบเป็น check-then-insert (เลี่ยงได้ด้วยยกเลิก/เปิดใหม่); `readBadgeSource` อ่าน attendance/Cup ทั้งก้อนทุก GET จอง; `validateSettings` เก็บ field แปลกจาก client; บิลของฉัน/รายการผู้จัด `LIMIT 200` ตัดเงียบ; ชื่อแขกซ้ำเทียบด้วย `toLowerCase` ไม่ NFC; webhook ไม่กัน `webhookEventId` ซ้ำ
- **hard code ที่ควรย้ายเข้า `clubs.js`/config:** `'sena'`/`'88'` ใน frontend และ `line-reply.js`, เขตเวลา `+7*3600000` ซ้ำ 6 ที่, `HOLIDAY_YEARS` มีแค่ 2026–2027 (ปี 2028 ไม่มีวันหยุดโดยไม่เตือน), URL production ใน `line-reply.js`, `CUP_DAY_SINCE` กับ `ATTENDANCE_START` อยู่คนละที่
- บิลค่าข้าว เรื่องเล็กที่ยังไม่แก้: ชื่อบิลยาวในป้ายการ์ด, แถวคนออกเงินโผล่ใน "ของฉัน › จ่ายแล้ว"
- ไอเดียยังไม่ตัดสินใจ: job พิเศษแจกในกิจกรรม (spec job badge หัวข้อ "ไอเดียในอนาคต"), แจ้งเตือนส่วนตัวใน LINE, เทสอัตโนมัติการเลือกบิลที่เปิด, ดู neurons Workers AI กับสลิปจริง, MutationObserver ใน `cloud.js`
- ตัดสินใจไม่ทำ: ชื่อผู้รับ, QR รวมหลายบิล, ปุ่มทวงเข้ากลุ่มอัตโนมัติ, dev-login bypass บน production, รูปโปรไฟล์ LINE (โหลด LINE SDK แล้ว LIFF ช้า — เจ้าของไม่ยอมให้ช้า), cache ไฟล์ static / Smart Placement · Worker `sena-web-next` เจ้าของขอเก็บไว้ · ตารางว่างลบได้: `member_pictures`, `player_aliases`

## ต้องรู้
- แท็บบิล = iframe `#billsFrame` (`/billing.html`) ใน `court.html`; กดซ้ำส่ง `bills-refresh`; ห้ามลบ `#session` (ซ่อนด้วย `hidden`, `app.js` อ้าง id) — spec `2026-11-13-bills-tab-design.md`
- **สลิปที่แนบ = จ่ายแล้วทันที** (เฉพาะเงินสดรอผู้จัดยืนยัน) ผู้จัดทำได้แค่ "ให้ส่งใหม่"; `/api/member/bills` ต้องเป็น path นี้ ไม่ใช่ `?action=`; บิลที่โชว์ QR ใช้ `openMineId()` ตัวเดียวทั้งรายการและ `fillMine`
- AI ตรวจสลิป (`slip-check.js`, spec `2026-11-12-slip-ai-check-design.md`) เป็นแค่ตัวช่วยผู้จัด ห้ามเปลี่ยนสถานะอัตโนมัติ ห้ามให้ผู้เล่นเห็น; `payer.amount` เป็นสตางค์; `rejectNote` ผู้เล่นเห็น ห้ามมีชื่อคนอื่น ≤ 240 ตัวอักษร
- Leaderboard ผูกผู้เล่นด้วย id (`teamIds`, ตาราง `cup_name_ids`) เปลี่ยนชื่อผู้เล่นแล้วประวัติตามเอง; ก๊วนผูกกลุ่ม LINE ได้ห้องเดียว แต่สองก๊วนผูกห้องเดียวกันได้
- ข้อความน้องขุนเงิน / รูปการ์ด / วิธีดู log production: `BADBOT-REPLY.md` · LIFF / แจ้งเข้ากลุ่ม (`line-notice:client` `stage`): `LINE-LIFF.md`
- **production (อ่านอย่างเดียว ผ่านโทเคนที่ proxy ฉีดให้):** `GET api.cloudflare.com/client/v4/accounts` ได้ account id; D1 `POST /accounts/<id>/d1/database/<db>/query`; analytics `POST /client/v4/graphql` (`workersInvocationsAdaptive` scriptName `sena-web`, `d1AnalyticsAdaptiveGroups`); error 971 = เรียกถี่ไป รอสักครู่
- ทดสอบหน้าในเครื่อง: เครื่องที่ต่อเน็ตได้ใช้ `.dev.vars` (`ADMIN_KEY=test-key`, `LINE_MEMBER_AUTH_ENABLED=false`) + `npx wrangler dev --local`; ใน cloud session `wrangler dev` ต่อ Cloudflare ไม่ได้ → ใช้ server Node เล็กๆ ที่เรียก `worker.fetch` กับ D1 แบบ `node:sqlite` + ASSETS อ่านจาก `public/` แล้วเปิดด้วย Playwright; ล็อกอิน LINE จริงทดสอบไม่ได้
- ตรวจ deploy: `curl` https://sena-web.thegsbnut.workers.dev (`/court`, `/billing`) แล้วหา `?v=`; force push ถูกปฏิเสธ (ถ้า branch ถูก squash-merge: `git reset --hard origin/main` แล้ว `git merge -s ours origin/<branch>`)

## สถานะเทส
- 2026-11-19 (main `47f11e9`): `npm test` 314/314 ผ่าน · `npm run build` / `npm run format:check` ผ่าน

---
## ประวัติการส่งต่อ (ล่าสุดอยู่บน ไม่เกิน 5 รายการ)
- 2026-11-19 Claude: แก้แท็บบิลเลื่อนหน้าข้างหลัง + `schema.js` batch เดียว (cold `/api/member` 5→1, `/api/booking` 15→10 รอบ D1)
- 2026-11-19 Antigravity: UX รอบใหญ่ #76–#80 · 2026-11-18 Antigravity: หน้าบิล/เก็บเงิน #70–#73
- 2026-11-18 Claude: ตามบิลตอนเช้าไม่ใช้ Push (`line-nudge.js`, spec `2026-11-18-morning-bill-nudge-design.md`) · จัดคู่กระจายคนเจอกันทั่วขึ้น (`public/engine.js`) · GPT: แก้สลิปเก่า/ผลจอง/ลิงก์บิล LIFF (#61)
- 2026-11-17 Claude: บิลค่าข้าว + เมนู "เก็บเงิน" (#57, spec `2026-11-16-custom-bills-design.md`) · Leaderboard ผูก id · พร้อมเพย์เท่านั้น · รายการบิลผู้จัดกรอง club
- 2026-11-15 Claude: การ์ด Flex ทุกแบบ + ธีมน้องขุนเงิน + webhook ตอบเบื้องหลัง (#39–#55) — `BADBOT-REPLY.md`
