# DEV-LOGIN (ชั่วคราว) — ทดสอบ production โดยไม่ต้อง LINE Login

โค้ด: `dev-auth.js` · เทส: `test-dev-auth.mjs` · Playwright: `scripts/e2e-dev-login.mjs` · ล้างข้อมูล: `scripts/dev-test-cleanup.mjs`

## หลักการ
- ปิดอยู่เสมอ เว้นแต่ `DEV_AUTH="true"` **และ** มี secret `DEV_AUTH_SECRET` ยาว ≥ 32 ตัว — ไม่ครบ / key ผิด / ไม่มี key → 404
- `GET /dev-login?key=<DEV_AUTH_SECRET>&uid=U_TEST_xxx&name=ชื่อ&role=admin|player[&gender=M|F]`
  → สร้าง session แบบเดียวกับ LINE Login จริง (cookie `__Host-sena-member`, ตาราง `member_sessions`, `member_profiles`, `member_links`) แต่หมดอายุใน 2 ชม. และไม่ต่ออายุ
- ผู้ใช้ทดสอบเก็บใน `member_test_users` (`is_test = 1`) — ไม่เพิ่มคอลัมน์ในตารางจริง (INSERT ของ LINE Login จริงใช้ `VALUES(?,?)`)
- **แยกขาด:** ผู้ใช้ทดสอบอยู่ได้เฉพาะก๊วนลับ `?club=test` (roster `club_state_test`, booking/bill/cup แยก) — ใน sena/88 ถือว่าไม่ได้ล็อกอิน, admin ทดสอบเป็นผู้จัดได้เฉพาะก๊วน test, ก๊วน test ผูกกลุ่ม LINE ไม่ได้ ไม่อยู่ใน `CLUB_IDS` จึงไม่โผล่ในรายชื่อ/อันดับ/บิลค้าง/ข้อความกลุ่ม
- ไม่เรียก LINE API จริงให้ U_TEST_ (log `line-api-mocked` แทน); ทุกการใช้ /dev-login ถูก log (`context: dev-auth`) ไม่ log key
- หน้าเว็บโชว์แถบแดง "TEST MODE" (`public/test-mode.js`) · `/dev-logout` ออกจากโหมดทดสอบ
- หมายเหตุ: key อยู่ใน URL → ติดประวัติเบราว์เซอร์ อย่าแชร์ลิงก์ และเปลี่ยน secret หลังใช้เสร็จ

## เปิด
1. Cloudflare dashboard → Worker `sena-web` → Settings → Variables: เพิ่ม `DEV_AUTH` = `true` (Text) และ `DEV_AUTH_SECRET` (Secret, สุ่มยาว เช่น `openssl rand -hex 32`)
2. ทดสอบ: `BASE_URL=https://sena-web.thegsbnut.workers.dev DEV_AUTH_SECRET=... node scripts/e2e-dev-login.mjs`

## ปิด (checklist)
1. ลบ `DEV_AUTH` (และ `DEV_AUTH_SECRET`) ใน Cloudflare dashboard → Variables
2. Redeploy (กด Deploy ใน dashboard หรือ push ขึ้น main)
3. ตรวจ: `curl -s -o /dev/null -w '%{http_code}' 'https://sena-web.thegsbnut.workers.dev/dev-login?key=x'` ต้องได้ `404` และ `/court?club=test` ต้องตอบ "ไม่พบก๊วน"
4. ล้างข้อมูล: `node scripts/dev-test-cleanup.mjs --remote --dry-run` ดูจำนวน แล้ว `node scripts/dev-test-cleanup.mjs --remote`
5. (ถ้าจะเลิกถาวร) ลบโค้ด: revert commit ที่เพิ่ม dev-login
