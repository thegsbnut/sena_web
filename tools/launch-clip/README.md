# คลิปเปิดตัว SENA Court

คลิปแนวตั้ง 1080×1920 ยาว 53 วินาที ไฟล์ล่าสุดอยู่ที่ `out/sena-court-launch-v4.mp4` (มีเสียงพากย์น้องขุนเงิน) ส่วน `out/sena-court-launch-v3.mp4` เป็นเวอร์ชันไม่มีเสียงพากย์

เครื่องมือนี้ใช้ทำคลิปเท่านั้น ไม่ถูก deploy เพราะ Worker เสิร์ฟเฉพาะ `public/` และไม่ได้ส่งอะไรไป LINE หรือ production

## ของจริงในคลิป และส่วนที่จำลอง
- **การ์ด Badbot สร้างจากโค้ดจริง:** `capture.mjs` ยิงคำว่า `badbot` เข้า webhook จริง (LINE จำลอง) เพื่อเอาการ์ดเมนู และเรียก `rosterBubble` / `owedMessage` / `paidBubble` ด้วยข้อมูลจำลอง แล้ว `flex.js` วาด Flex JSON เป็น HTML ให้เหมือน LINE
- **หน้าเว็บเป็นเว็บจริง:** รันด้วย `wrangler dev` บนฐานข้อมูลในเครื่อง (`data/seed.sql` = ผู้เล่น 12 คน, เปิดจองวันเสาร์ ลงชื่อแล้ว 11 คน; `data/member.sql` = session LINE ของ "เบียร์" ที่ผูกชื่อแล้ว; `data/bill.json` = บิล 1,440 บ.) `record.cjs` อัดหน้าจอขณะกดจริงเป็นเฟรมพร้อมเวลา
- **ข้อความแจ้งเข้ากลุ่ม** ในแชตเป็นข้อความที่ API ตอบกลับมาจริงตอนอัด
- **ส่วนที่วาดขึ้นเอง:** หัวแชต LINE, แถบหัว LIFF, นิ้วกด, ตัวเลือกรูป และป๊อปอัป `confirm()` (เบราว์เซอร์ headless ไม่แสดงหน้าต่างของระบบ จึงวาดทับตรงจังหวะที่เกิดจริง)
- **ข้อมูลทั้งหมดเป็นข้อมูลจำลอง:** ชื่อสมมติ, พร้อมเพย์ `0000000000` และ `slip.png` เป็นสลิปตัวอย่างแบบกลาง ไม่ใช่ของธนาคารใด
- **เสียงพากย์:** `voiceover.py` ส่งบทใน `voiceover.txt` ไปเสียงสังเคราะห์ของ Microsoft (`th-TH-PremwadeeNeural`, pitch +45Hz) แล้วปรับให้เสียงเด็กลงด้วย ffmpeg (`VO_SHIFT=1.09`) เครื่องต้องเข้าถึงโฮสต์ `speech.platform.bing.com` ได้
- **เพลงกับเสียงเอฟเฟกต์สังเคราะห์ด้วยโค้ด** (`music.py`, `sfx.py`) จึงไม่ติดลิขสิทธิ์ ฟอนต์ Prompt (OFL) อยู่ใน `a/`

## ขั้นตอนสร้างใหม่
ไฟล์ที่ได้ระหว่างทางอยู่ใน `build/` (git-ignore) เครื่องต้องมี Playwright/Chromium, ffmpeg, python3 + numpy และฟอนต์ไทยของระบบ (เช่น Noto Sans Thai) เพื่อให้หน้าเว็บที่อัดแสดงภาษาไทย

```bash
# 1) เว็บจริงในเครื่อง (จาก root repo): .dev.vars ต้องมี ADMIN_KEY=test-key และห้ามตั้ง LINE_MEMBER_AUTH_ENABLED=false
npx wrangler d1 execute DB --local --file=schema.sql
npx wrangler dev --local --compatibility-date 2026-05-22 --port 8799   # เปิดค้างไว้อีกหน้าต่าง

# 2) การ์ด + อัดเว็บ (จาก tools/launch-clip)
node capture.mjs            # -> build/flexdata.js
bash record-all.sh          # -> build/rec/A, build/rec/B, build/recdata.js

# 3) เพลง เสียง และวิดีโอ
node render.cjs cues build/sfx.json
python3 music.py build/music.wav 26 21          # 26 ห้อง (52 วิ) ช่วงท้ายเริ่มห้องที่ 21
python3 sfx.py build/music.wav build/mix.wav build/sfx.json
node render.cjs video build/video.mp4 30 53
pip install edge-tts && python3 voiceover.py tts                 # -> build/vo/NN.mp3
python3 voiceover.py mix build/mix.wav build/mix-vo.wav          # เพลงเบาลงตอนน้องพูด
ffmpeg -i build/video.mp4 -i build/mix-vo.wav -map 0:v -map 1:a -c:v copy -c:a aac -b:a 192k -shortest out/clip.mp4
```

ดูภาพบางจังหวะก่อนเรนเดอร์ทั้งคลิปได้ด้วย `node render.cjs shots 6.5,20,30` (ได้ไฟล์ `build/shots/t*.jpg`) เวลาของทุกฉากกำหนดไว้ในตัวแปร `T` ใน `clip.html`
