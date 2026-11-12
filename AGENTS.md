# คำแนะนำสำหรับ AI coding agent (GPT/Codex ฯลฯ)

อ่าน `CLAUDE.md` ก่อนเริ่มงาน — เป็นที่รวมกฎของโปรเจกต์ทั้งหมด (stack, ข้อตกลง, คำสั่ง, config) ใช้กับทุกเครื่องมือ ไม่ต้องทำตามที่นี่ซ้ำ

จากนั้นอ่าน `HANDOFF.md` เพื่อดูว่างานล่าสุดค้างอยู่ตรงไหน

กฎย่อที่ห้ามพลาด:
- ภาษาไทยในข้อความที่ผู้ใช้เห็น
- `npm test` และ `npm run build` ต้องผ่านก่อน push
- รัน `npm run format` ก่อน commit
- push ขึ้น `main` = deploy production ทำงานบน feature branch แล้วให้เจ้าของโปรเจกต์สั่ง merge
- ห้าม commit secrets
