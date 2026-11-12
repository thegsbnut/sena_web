# SENA Court next — เว็บดีไซน์ใหม่สำหรับทดลอง

เว็บดีไซน์ใหม่ (โทนเขียวมังงะ Final Rally, เมนูล่างแบบแอป) รันเป็น **Worker แยกอีกตัว** ใช้โค้ดฝั่งเซิร์ฟเวอร์และ JS ฝั่งหน้าเว็บชุดเดิมทั้งหมด และใช้ D1 ตัวเดียวกับ production
เว็บเดิม (`wrangler.jsonc` → `public/`) ไม่ถูกแตะ

## โครงสร้าง
| ไฟล์ | หน้าที่ |
|---|---|
| `next/` | เฉพาะไฟล์ที่ดีไซน์ใหม่: `court.html`, `billing.html`, `liff.html`, `admin.html`, `next.css`, `next-billing.css`, `next-shell.js`, `next-nav.css`, `next-ui.js` (จัดโครงหน้าใหม่จาก DOM ที่สคริปต์เดิมสร้าง: hero รอบถัดไป, การ์ดวันที่, รายชื่อแบบวงกลม, แท่นรางวัล, ซ่อนเครื่องมือผู้จัดไว้หลัง ⚙) |
| `scripts/build-next.mjs` | `npm run build:next` = คัด `public/` ไป `dist-next/` แล้วทับด้วย `next/` แล้วรวมทุกไฟล์เป็น `.next-build/assets.mjs` |
| `worker-next.js` | entry ของเว็บ next: เรียก `worker.js` เดิม แต่เสิร์ฟไฟล์หน้าเว็บจากโมดูลที่รวมไว้ (ไม่ใช้ Workers Assets) |
| `wrangler.next.jsonc` | Worker ชื่อ `sena-web-next` · D1 ทั้งสองตัวระบุ ID ตรงกับ production · **ไม่มี cron** (production รันอยู่แล้ว) |
| `test-next.mjs` | กันฟีเจอร์หาย: หน้าใหม่ต้องมี id ครบและโหลดสคริปต์เดิมครบทุกตัว |

กติกา: แก้ดีไซน์ได้แค่ HTML layout/CSS ใน `next/` ห้ามลบ id หรือ `<script>` เดิม (เทสจะล้ม) — logic ทั้งหมดอยู่ใน `public/*.js` เดิม แก้บั๊กที่นั่นแล้วทั้งสองเว็บได้พร้อมกัน

## หน้าที่เปิดดูได้
- `/court` = **หน้าตาเดิมทั้งหมด + เมนูย้ายลงแถบล่างแบบแอป** (`next/court.html` + `next-nav.css`)
- `/court-full` = ดีไซน์ใหม่เต็มรูปแบบ (hero รอบถัดไป, การ์ดวันที่, แท่นรางวัล) เก็บไว้เทียบ · ไฟล์ `court-full.html`, `next.css`, `next-ui.js` · tag `redesign-full-v2` มีชุดเต็มรวมหน้าบิล/LINE/admin
- หน้าอื่น (billing, liff, admin) ใช้ของเดิมจาก `public/`

## ที่อยู่และการ deploy
- URL: https://sena-web-next.thegsbnut.workers.dev (deploy ครั้งแรก 2026-11-12)
- deploy ด้วยมือ: `CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=807aa489f9e84863cc0dc67625b674f3 npm run deploy:next`
  - ใน Claude cloud session token ถูกฉีดโดย proxy: ใช้ `CLOUDFLARE_API_TOKEN=proxy-injected`
  - ที่ไม่ใช้ Workers Assets เพราะ proxy เขียนทับ header ของการอัปโหลด assets (ได้ 401)

## ตั้งค่าเพิ่มเติม (เจ้าของโปรเจกต์ทำใน Cloudflare)
1. (ไม่บังคับ) ให้ deploy อัตโนมัติเมื่อ push: Workers & Pages → `sena-web-next` → Settings → Build → Connect repo `sena_web`, branch ของงานนี้, Build command `npm run build:next`, Deploy command `npx wrangler deploy -c wrangler.next.jsonc`
2. Settings → Variables and Secrets ของ `sena-web-next`: ใส่ `ADMIN_KEY` (ค่าเดียวกับเว็บเดิมได้)
   - ไม่ต้องใส่ `LINE_CHANNEL_SECRET` (เว็บนี้ไม่รับ webhook)
   - `LINE_CHANNEL_ACCESS_TOKEN` ใส่ก็ได้ถ้าอยากให้ปุ่มแท็ก/ตรวจกลุ่ม LINE ใช้ได้ (จะส่งข้อความเข้ากลุ่มจริง)
4. LINE login (ถ้าจะลองจอง/จ่ายบิลแบบผู้เล่น): LINE Developers → channel LINE Login เดิม → LIFF → Add
   - Endpoint URL: `https://sena-web-next.<บัญชี>.workers.dev/liff.html`
   - Scope: `openid`, `profile` เหมือนตัวเดิม
   - นำ LIFF ID ใหม่ไปแทน `LINE_LIFF_ID` ใน `wrangler.next.jsonc` แล้ว push
   - ถ้ายังไม่ทำข้อนี้ เข้าระบบผู้จัดด้วย `ADMIN_KEY` ได้ปกติ แต่ปุ่ม LINE จะพาไปเว็บเดิม

## ทดลองในเครื่อง
```
npm run build:next
npx wrangler dev -c wrangler.next.jsonc --local --compatibility-date 2026-05-22 --var LINE_MEMBER_AUTH_ENABLED:false
```
(`--compatibility-date` เพราะ runtime ในเครื่องเก่ากว่าวันที่ใน config; D1 แบบ local ต้องรัน `schema.sql` ก่อน)

## สลับเป็นเว็บหลัก (เมื่อเจ้าของโปรเจกต์พอใจ)
คัดไฟล์ใน `next/` ทับ `public/` ใน commit เดียว แล้ว merge เข้า `main` · ย้อนกลับได้ด้วย `git revert` commit นั้น
