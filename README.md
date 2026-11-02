# SENA Court — Cloudflare
เว็บจัดก๊วน + Sena Cup จากโปรเจกต์เดิม โดยเว็บเดิมยังไม่ถูกแก้ไขหรือลบ

## ตั้งค่าบนมือถือ
1. Cloudflare → Workers & Pages → Worker ที่เชื่อม repo นี้ → Settings → Builds
   - Worker name: `sena-web` (ถ้าตั้งชื่ออื่น ให้แก้ `name` ใน wrangler.jsonc ให้ตรง)
   - Build command: `npm run build`
   - Deploy command: `npx wrangler deploy`
   - Root directory: `/` และ branch: `main`
2. Deploy ครั้งแรกเปิดเว็บและโหมดเพื่อนได้ แต่ยังบันทึกข้อมูลกลางไม่ได้
3. Cloudflare → Storage & Databases → D1 → Create database → ตั้งชื่อ `sena-db`
4. ใน D1 → Console วาง SQL สองคำสั่งจาก `schema.sql` แล้ว Execute
5. คัดลอก Database ID (ไม่ใช่รหัสลับ) แล้วเพิ่มใน `wrangler.jsonc`:
```json
"d1_databases": [{"binding":"DB","database_name":"sena-db","database_id":"ใส่ Database ID จริง"}]
```
ใส่ comma หลัง `"keep_vars": true` ก่อนเพิ่มรายการนี้ แล้ว commit เพื่อ deploy ใหม่
6. Worker → Settings → Variables and Secrets → Add → ชนิด Secret
   - Name: `ADMIN_KEY`
   - Value: รหัสสุ่มอย่างน้อย 7 ตัวอักษร เก็บในตัวจัดการรหัสผ่าน
   - ห้ามใส่รหัสนี้ใน GitHub หรือส่งลงแชต
   - Save/Deploy ตามหน้าจอ
7. เปิด URL ของ Worker → เข้าสู่ระบบผู้จัด → ใส่ ADMIN_KEY → ทดลองบันทึกออนไลน์

## ย้ายข้อมูลเดิม
- เว็บเก่า: แท็บรายชื่อ → ส่งออก JSON (ล็อกอินและโหลดข้อมูลกลางล่าสุดก่อน)
- เว็บใหม่: ล็อกอินผู้จัด → นำเข้าไฟล์สำรองจากเว็บเดิม → ตรวจข้อมูล → บันทึกขึ้นออนไลน์
- ข้อมูลเดิมในเบราว์เซอร์ไม่ย้ายข้ามโดเมนอัตโนมัติ
- เว็บเริ่มด้วยรายชื่อว่าง ผู้จัดเพิ่มรายชื่อใหม่หลังตั้งค่า D1 และเข้าสู่ระบบได้
- อย่าปิดเว็บเก่าจนทดสอบเว็บใหม่ทั้งโหมดผู้จัดและเพื่อนสำเร็จ

## สิทธิ์
- เพื่อน: จัดเกมและ Sena Cup ในเบราว์เซอร์ของตนได้ ไม่เขียน DB กลาง
- ผู้จัด: ใช้ ADMIN_KEY เข้าสู่ระบบ; cookie HttpOnly/Secure อายุ 8 ชั่วโมง
- API ไม่เชื่อ header ของ ChatGPT Sites; ตรวจ session, Origin และ revision ก่อนเขียน
- รหัสผิดจำกัด 10 ครั้ง/IP/ช่วง 15 นาที; เปลี่ยน ADMIN_KEY ยกเลิก session เดิม
- ใช้แผน Free และติดตามโควตาจาก Cloudflare; ไม่มีการเปิดบริการเสียเงินจากโค้ดนี้

ทดสอบ: `npm test` • ไม่มี dependency ฝั่ง runtime • DB สร้าง schema.sql เพียงครั้งแรก
