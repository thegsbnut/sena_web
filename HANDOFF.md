# HANDOFF — ส่งงานระหว่าง Claude / GPT

ใครหยุดงานก่อน (โควตาหมด, หมดเวลา) ให้เขียนทับไฟล์นี้ แล้ว commit + push ก่อนเสมอ คนที่มารับช่วงอ่านไฟล์นี้ก่อนทำอย่างอื่น
**กติกาให้ไฟล์สั้น (เป้าหมาย ≤ ~40 บรรทัด):** งานที่เสร็จแล้ว → ย่อเป็นบรรทัดเดียวใน "ประวัติ" พร้อมลิงก์ spec/plan; ความรู้ถาวรย้ายไป spec หรือ `CLAUDE.md`; เก็บข้างบนเฉพาะสิ่งที่ session ถัดไปต้องรู้

## อัปเดตล่าสุด
- 2026-11-13 · Claude · branch `claude/happy-goodall-x8fbjb`: **แท็บ "บิล" แทน "จัดก๊วน" ทำเสร็จ รอเจ้าของโปรเจกต์สั่ง merge เข้า `main`** (spec/plan: `docs/superpowers/specs|plans/2026-11-13-bills-tab*`) — เว็บจริงที่ merge ไปแล้ว: เมนูล่างเขียวเข้ม + แก้แถบ LINE ล้น + ปุ่มบิลค้างเต็มแถว

## ค้างอยู่ / ขั้นต่อไป
- **Redesign "SENA Court next" (ดู `NEXT.md`)** — Worker แยก `sena-web-next` ใช้โค้ดเดิม + overlay `next/` และ D1 ชุดเดียวกับ production ไม่มี cron · branch นี้ **ยังไม่ merge ห้าม merge จนกว่าเจ้าของโปรเจกต์สั่ง**
  - URL: https://sena-web-next.thegsbnut.workers.dev · deploy ด้วย `CLOUDFLARE_API_TOKEN=proxy-injected CLOUDFLARE_ACCOUNT_ID=807aa489f9e84863cc0dc67625b674f3 npm run deploy:next` (ไม่ใช้ Workers Assets เพราะ proxy ของ session ทำให้อัปโหลดได้ 401 → `worker-next.js` รวมไฟล์หน้าเว็บเข้าสคริปต์)
  - `/court` = **หน้าตาเดิมทั้งหมด + เมนูล่างสีเขียวมะนาว** (`next/court.html` + `next-nav.css`, แก้แถบปุ่มเข้าสู่ระบบ LINE ที่ล้นแล้ว) ← แบบที่เจ้าของโปรเจกต์ขอดูล่าสุด
  - `/court-full` = ดีไซน์ใหม่เต็ม (hero รอบถัดไป, การ์ดวันที่, รายชื่อวงกลม, แท่นรางวัล) · ชุดเต็มรวมหน้าบิล/LINE/admin อยู่ใน commit ก่อนหน้า (tag `redesign-full-v2` push ไม่ผ่าน ใช้ `git log` หา commit "จัดโครงหน้าใหม่ให้ใกล้เดโม")
  - รอเจ้าของโปรเจกต์: ใส่ secret `ADMIN_KEY` ใน dashboard ของ `sena-web-next`; ถ้าจะลองจอง/จ่ายบิลผ่าน LINE ต้องสร้าง LIFF ตัวที่สองชี้ `/liff.html` ของเว็บ next แล้วแก้ `LINE_LIFF_ID` ใน `wrangler.next.jsonc`
  - ยังไม่ได้ตัดสินใจ: จะเลือก `/court` (เดิม+เมนูล่าง) หรือ `/court-full` หรือผสม (เช่น เดิม + เมนูล่าง + การ์ดวันที่ใหม่); เมนูล่างของ `/court-full` ยังเป็นสีเข้ม
  - session ไม่เปิดโดเมน next ได้ (proxy 403) → ตรวจหน้าจริงจาก session ไม่ได้ ใช้ `wrangler dev --local --compatibility-date 2026-05-22` + playwright แทน (ดู `NEXT.md`)
  - ปัญหาแถบปุ่ม LINE ล้น (`#bookingMemberLogin`) มีใน production ด้วย (`public/booking.css`) — แก้เฉพาะ next, แก้ production เมื่อเจ้าของโปรเจกต์สั่ง
  - สลับเป็นเว็บหลัก: คัดไฟล์ `next/` ที่เลือกทับ `public/` ใน commit เดียวแล้ว merge เมื่อสั่งเท่านั้น
  - เดโม mood & tone (ข้อมูลปลอม): https://claude.ai/artifact/JqtzfvCBDWd8SuCGksdiYj
- (ไม่บังคับ) ดูผลป้าย AI กับสลิปจริงช่วงแรก โดยเฉพาะภาพถ่ายหน้าจอเอียง/เบลอ และดู neurons ที่ใช้ในหน้า Workers AI
- (ไม่บังคับ) แสดงยอด/วันที่ที่ AI อ่านได้ทุกครั้ง; ถอด QR บนสลิปเพื่อได้เลขอ้างอิงที่แม่นกว่า (นอก scope เดิม)

## ต้องรู้เกี่ยวกับระบบตรวจสลิปด้วย AI (spec: `docs/superpowers/specs/2026-11-12-slip-ai-check-design.md`)
- `slip-check.js` = โค้ด AI ทั้งหมด; ผลอยู่ตาราง `slip_checks` (ไม่แตะ payload บิล); หน้าจอ: `public/slip-check-text.js` + `public/billing.js`; เทส: `test-slip-check.mjs`
- **ผล AI เป็นแค่ตัวช่วยสำหรับผู้จัด** — ห้ามเปลี่ยนสถานะการจ่ายอัตโนมัติ และห้ามให้ผู้เล่นเห็น (ถามเจ้าของโปรเจกต์ก่อนเปลี่ยน)
- **`payer.amount` เป็นสตางค์** (สลิปเป็นบาท → คูณ 100 ฝั่งสลิปเท่านั้น); เคยผิดมาแล้ว
- **กฎวันที่:** เทียบวันที่ในสลิปกับวันที่แนบสลิป (`submittedAt`, เวลาไทย) เตือนเมื่อเก่ากว่า `OLD_SLIP_DAYS = 3` ไม่เทียบวันตีแบด (บิลสร้างล่วงหน้าได้)
- **เหตุผล "ให้ส่งใหม่" ผู้เล่นเห็น** → `rejectNote` ห้ามมีชื่อคนอื่น/บิลอื่น ไม่เกิน 240 ตัวอักษร
- ป้าย "สลิปซ้ำ" จับได้ไม่ครบ (เลขอ้างอิงยาวที่ AI อ่านเพี้ยนบางหลัก) — เป็นป้ายเตือน ไม่ใช่หลักฐาน
- โมเดล `@cf/meta/llama-4-scout-17b-16e-instruct` (var `SLIP_AI_MODEL`); วัดแล้ว: อ่านถูก 6/6 ยอดและวันที่ ~58 neurons/สลิป ≈ $0.00064; ฟรี 10,000 neurons/วัน (≈170 สลิป) เกินโควตาแผน Free → AI ล้มเหลว โค้ดแสดง "ตรวจไม่สำเร็จ" การจ่ายบิลไม่สะดุด
- **ปิด/ถอด:** `SLIP_AI_ENABLED` เป็น `"false"` ใน `wrangler.jsonc` แล้ว deploy (สวิตช์อยู่ในไฟล์ ไม่ใช่ dashboard) · หรือ `git revert` · `DROP TABLE slip_checks` ไม่บังคับ
- Minor ที่รีวิวแล้วเลื่อนไว้ (ไม่มีผลเสียร้ายแรง): แถวเก่าค้างใน `slip_checks` หลังแนบใหม่ถูกลบหลัง 180 วัน, `parseSlipDate` ยังอ่าน `12/11/69` และ `12พ.ย.69` ไม่ได้, จับเวลา "ตรวจไม่สำเร็จ" ใช้นาฬิกาเครื่องผู้จัด, ตรวจซ้ำสลิปใบจริงอาจถูกป้ายซ้ำกับใบที่คัดลอก, ป้าย ❓ ไม่บอกให้เปิดดูสลิปเอง, รูป > 300 KB ยังไม่ได้วัด token

## ข้อควรรู้เรื่องเครื่องมือ
- ต้อง `npm install` ก่อนรันเทส (ไม่มี `node_modules` ใน session ใหม่)
- force push ถูกปฏิเสธ; ถ้า branch ถูก squash-merge แล้ว ให้ `git reset --hard origin/main` ในเครื่อง แล้ว `git merge -s ours origin/<branch>` เพื่อ push ปกติได้
- token Cloudflare: เจ้าของโปรเจกต์สร้างใหม่ 2026-11-12 (Workers + D1 Edit) เก็บใน Network secrets ของ `api.cloudflare.com`; wrangler ใช้ `CLOUDFLARE_API_TOKEN=proxy-injected`

## สถานะเทส
- `npm test` 173/173 ผ่าน · `npm run build` และ `npm run format:check` ผ่าน

---
## ประวัติการส่งต่อ (ล่าสุดอยู่บน เก็บไว้ไม่เกิน 5 รายการ)
- 2026-11-12 Claude: ตรวจสลิปด้วย AI ขึ้น production (PR #24 ฟีเจอร์ · #25 เปิดใช้ · #26 กฎวันที่ + เติมเหตุผลให้ส่งใหม่); เจ้าของโปรเจกต์ทดสอบผ่าน — spec/plan ใน `docs/superpowers/`
