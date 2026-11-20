# DEV-NOTES — วิธีดู production / ทดสอบ / ตรวจ deploy

ย้ายมาจาก HANDOFF.md (ข้อมูลถาวร ไม่ใช่สถานะงาน) — CLAUDE.md ชี้มาที่นี่

- **production (อ่านอย่างเดียว ผ่านโทเคนที่ proxy ฉีดให้):** `GET api.cloudflare.com/client/v4/accounts` ได้ account id; D1 `POST /accounts/<id>/d1/database/<db>/query`; analytics `POST /client/v4/graphql` (`workersInvocationsAdaptive`, `d1AnalyticsAdaptiveGroups`); error 971 = เรียกถี่ไป
- ทดสอบหน้าในเครื่อง: เครื่องที่ต่อเน็ตได้ใช้ `.dev.vars` (`ADMIN_KEY=test-key`, `LINE_MEMBER_AUTH_ENABLED=false`) + `npx wrangler dev --local`; ใน cloud session `wrangler dev` ต่อ Cloudflare ไม่ได้ → ใช้ server Node เล็กๆ ที่เรียก `worker.fetch` กับ D1 แบบ `node:sqlite` + ASSETS อ่านจาก `public/` แล้วเปิดด้วย Playwright; ล็อกอิน LINE จริงทดสอบไม่ได้
- ตรวจ deploy: `curl` https://sena-web.thegsbnut.workers.dev (`/court`, `/billing`) แล้วหา `?v=`; force push ถูกปฏิเสธ (ถ้า branch ถูก squash-merge: `git reset --hard origin/main` แล้ว `git merge -s ours origin/<branch>`)
