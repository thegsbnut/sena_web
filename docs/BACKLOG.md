# BACKLOG — งานค้าง / ข้อสังเกตที่ยังไม่แก้

ย้ายมาจาก HANDOFF.md ตัดรายการที่ทำเสร็จออกแล้ว — เจ้าของสั่งก่อนจึงค่อยทำ ทำเสร็จข้อไหนให้ลบข้อนั้น

- **ความเร็ว (วัด 2026-11-19):** Worker CPU p50 2.7ms, wall p50 127ms / p99 1.76s; `sena-db` อยู่ APAC แต่ **`sena-bill-slips` อยู่ WNAM** (แนบ/ดูสลิปข้ามแปซิฟิก) — ย้ายต้องสร้าง D1 ใหม่ระบุ APAC แล้วก๊อปข้อมูล ยังไม่ทำ
- สปอนเซอร์ ค้าง: ย้ายวันไม่ใช่ db.batch, รอบปิดรับจองยังลงได้ (server)
- **ผลรีวิวที่ยังไม่แก้ (รอเจ้าของสั่ง):** เพดานบิลทั่วไป 5 ใบเป็น check-then-insert (เลี่ยงได้ด้วยยกเลิก/เปิดใหม่); `readBadgeSource` อ่าน attendance/Cup ทั้งก้อนทุก GET จอง; `validateSettings` เก็บ field แปลกจาก client; บิลของฉัน/รายการผู้จัด `LIMIT 200` ตัดเงียบ; ชื่อแขกซ้ำเทียบด้วย `toLowerCase` ไม่ NFC; webhook ไม่กัน `webhookEventId` ซ้ำ
- **hard code ที่ควรย้ายเข้า `clubs.js`/config:** `'sena'`/`'88'` ใน frontend และ `line-reply.js`, เขตเวลา `+7*3600000` ซ้ำ 6 ที่, `HOLIDAY_YEARS` มีแค่ 2026–2027 (ปี 2028 ไม่มีวันหยุดโดยไม่เตือน), URL production ใน `line-reply.js`, `CUP_DAY_SINCE` กับ `ATTENDANCE_START` อยู่คนละที่
- บิลค่าข้าว เรื่องเล็กที่ยังไม่แก้: ชื่อบิลยาวในป้ายการ์ด, แถวคนออกเงินโผล่ใน "ของฉัน › จ่ายแล้ว"
- ไอเดียยังไม่ตัดสินใจ: job พิเศษแจกในกิจกรรม, แจ้งเตือนส่วนตัวใน LINE, ดู neurons Workers AI กับสลิปจริง
- ตัดสินใจไม่ทำ: ชื่อผู้รับ, QR รวมหลายบิล, ปุ่มทวงเข้ากลุ่มอัตโนมัติ, dev-login bypass บน production, รูปโปรไฟล์ LINE (โหลด LINE SDK แล้ว LIFF ช้า — เจ้าของไม่ยอมให้ช้า), cache ไฟล์ static / Smart Placement · Worker `sena-web-next` เจ้าของขอเก็บไว้ · ตารางว่างลบได้: `member_pictures`, `player_aliases`
