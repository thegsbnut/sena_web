# BACKLOG — งานค้าง / ข้อสังเกตที่ยังไม่แก้

ย้ายมาจาก HANDOFF.md ตรวจกับโค้ดและ production เมื่อ 2026-11-20 (ตัดข้อที่เสร็จแล้วออก: webhook กัน `webhookEventId` ซ้ำ, ตาราง `member_pictures`/`player_aliases` ไม่มีใน production แล้ว) — เจ้าของสั่งก่อนจึงค่อยทำ ทำเสร็จข้อไหนให้ลบข้อนั้น

- **ความเร็ว (วัด 2026-11-19):** Worker CPU p50 2.7ms, wall p50 127ms / p99 1.76s; `sena-db` อยู่ APAC แต่ **`sena-bill-slips` อยู่ WNAM** (แนบ/ดูสลิปข้ามแปซิฟิก) — ย้ายต้องสร้าง D1 ใหม่ระบุ APAC แล้วก๊อปข้อมูล ยังไม่ทำ
- สปอนเซอร์ ค้าง: ย้ายวันไม่ใช่ db.batch, รอบปิดรับจองยังลงได้ (server)
- **ผลรีวิวที่ยังไม่แก้ (รอเจ้าของสั่ง):** เพดานบิลทั่วไป 5 ใบเป็น check-then-insert (เลี่ยงได้ด้วยยกเลิก/เปิดใหม่); `readBadgeSource` อ่าน attendance/Cup ทั้งก้อนทุก GET จอง; `validateSettings` เก็บ field แปลกจาก client; บิลของฉัน/รายการผู้จัด `LIMIT 200` ตัดเงียบ; ชื่อแขกซ้ำเทียบด้วย `toLowerCase` ไม่ NFC เหลือที่เดียว: `booking.js:822` (ที่อื่นใช้ NFC แล้ว)
- **hard code ที่ควรย้ายเข้า `clubs.js`/config:** `'sena'`/`'88'` ใน frontend และ `line-reply.js`, เขตเวลา `+7*3600000` ซ้ำ 5 ที่ (`billing.js`, `public/billing.js`, `public/billing-custom.js`, `slip-check.js`, `booking.js`), `HOLIDAY_YEARS` มีตารางวันพระใหญ่/วันหยุดพิเศษแค่ 2026–2027 (ปีอื่นวันหยุดประจำ+ชดเชยเสาร์อาทิตย์คิดให้เอง มีคำเตือนในการ์ดวัน ต้องเพิ่มตารางปีใหม่เมื่อ ธปท. ประกาศ), URL production ใน `line-reply.js`, `CUP_DAY_SINCE` กับ `ATTENDANCE_START` อยู่คนละที่
- บิลค่าข้าว เรื่องเล็ก (ยังไม่ได้ตรวจกับโค้ด): ชื่อบิลยาวในป้ายการ์ด, แถวคนออกเงินโผล่ใน "ของฉัน › จ่ายแล้ว"
- ไอเดียยังไม่ตัดสินใจ: job พิเศษแจกในกิจกรรม, แจ้งเตือนส่วนตัวใน LINE, ดู neurons Workers AI กับสลิปจริง
- ตัดสินใจไม่ทำ: ชื่อผู้รับ, QR รวมหลายบิล, ปุ่มทวงเข้ากลุ่มอัตโนมัติ, dev-login bypass บน production, รูปโปรไฟล์ LINE (โหลด LINE SDK แล้ว LIFF ช้า — เจ้าของไม่ยอมให้ช้า), cache ไฟล์ static / Smart Placement · Worker `sena-web-next` เจ้าของขอเก็บไว้
