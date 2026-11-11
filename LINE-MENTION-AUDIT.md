# ตรวจระบบ Mention หลายคนของ Badbot

ฐานที่ตรวจ: main `0c3058e33cb4e9422e36c6b3ece2b215e9ce2163`
Branch งานแก้: `codex/multi-mention-audit`
สถานะเอกสาร: บันทึกผลทดสอบก่อน deploy; ผู้จัดอนุมัติให้นำงานแก้ขึ้น main และ deploy แล้ว การแสดงผลใน LINE จริงยังต้องยืนยันหลัง deploy

## Root cause และขอบเขตหลักฐาน

**ยังยืนยัน root cause ของแท็กสีดำบน LINE จริงไม่ได้** ไม่พบหลักฐานว่าโค้ดบิลรุ่นนี้ใช้เพียง `@ชื่อ` เพราะเส้นทางจริงส่ง `textV2` พร้อม `substitution` และ LINE userId หลายคนอยู่แล้ว ไม่พบเหตุผลตามสเปกว่า LINE รองรับเพียงหนึ่งคนต่อข้อความ และผลการสลับลำดับข้อความก่อนหน้านี้ไม่แก้อาการที่ผู้จัดพบ จึงไม่นับวิธีนั้นว่าแก้สาเหตุสำเร็จ

สิ่งที่ยืนยันจากโค้ดเดิมและทดสอบซ้ำได้:

1. `unpaid.slice(0,8)` ทำให้เฉพาะ 8 คนแรกในแต่ละบิลถูกตรวจสมาชิกและสร้าง mention คนที่ 9 เป็นต้นไปไม่ถูกแท็ก นี่เป็นบั๊กที่ทำให้แท็กไม่ครบ แต่ยังอธิบายอาการชื่อของ 2–3 คนเป็นสีดำไม่ได้
2. ชื่อในรายละเอียดบิลเป็นข้อความธรรมดา ส่วน mention อยู่ในอีกข้อความ จึงมีชื่อสองรูปแบบที่หน้าตาต่างกัน นี่เป็นลักษณะ payload เดิม ไม่ใช่หลักฐานว่า LINE แปลง mention เป็นข้อความธรรมดา
3. ตรวจสมาชิกด้วย HTTP 200 อย่างเดียว ไม่ตรวจ `userId` ใน profile response และไม่เก็บ request ID, message ID หรือ error body จาก Reply API
4. HTTP 400 ถูกจบงานโดยไม่ retry เพื่อหลีกเลี่ยง token ที่ใช้แล้ว แต่รายละเอียดสาเหตุถูกทิ้ง ส่วนหน้าตรวจใช้คำว่า “แท็กจริง” แม้มีเพียง HTTP 200 และจำนวน substitution ซึ่งยังยืนยันการแสดงผล/การแจ้งเตือนไม่ได้

ไม่มี credentials สำหรับอ่าน Worker/D1 production ในสภาพแวดล้อมนี้ หลักฐาน payload ด้านล่างจึงเป็นผลรันฟังก์ชันก่อน/หลังด้วย fixture เดียวกัน ใช้ฐานข้อมูล SQLite จำลองและ mock LINE API ไม่ใช่ payload ที่ดักจากคำสั่งจริงในกลุ่ม ผู้จัดเคยให้ผล HTTP 200 ไว้แล้ว แต่บันทึกเดิมไม่มี payload/error/request ID พอจะสรุปว่าเป็นปัญหาฝั่ง client, ตัวตนบัญชี หรือบริการ LINE

## งานแก้

- ใส่ mention ที่บรรทัดผู้จ่ายโดยตรง เช่น `• {member0} (Nut) 17 บ.` ใช้ชื่อในวงเล็บเป็นชื่อในก๊วน และ userId ใน substitution เป็นผู้รับจริง ไม่อาศัยชื่อที่ผู้ใช้ตั้ง
- ตรวจผู้จ่ายทุกคนในบิลที่แสดง ไม่ตัดที่ 8 คน; cache ผลตรวจ userId เดียวกันภายในคำสั่งเดียว
- ตรวจ `GET /v2/bot/group/{groupId}/member/{userId}` กับกลุ่มจาก signed webhook และต้องได้ profile.userId ตรงกัน ผู้ที่ตรวจไม่ผ่านจะไม่ถูกใส่ substitution และมีข้อความ “แท็กไม่สำเร็จ” พร้อมเหตุผล
- 1, 2, 10 และ 20 คนอยู่ใน message เดียวเมื่อความยาวอยู่ในขีดจำกัด 21 คนแบ่งเป็น 2 message ตามขีดจำกัด LINE ไม่ส่งหนึ่ง message ต่อคน
- ข้อความยาวแบ่งก่อน 4,500 UTF-16 code units / 20 mentions ต่อ message และไม่ส่งเกิน 5 messages ต่อ reply หากเกินจะแจ้งว่ายังไม่ได้แท็กใคร ไม่ตัดรายชื่อทิ้งเงียบ ๆ
- ภาษาไทยและ Unicode emoji ไม่ต้องคำนวณ index ของชื่อ ใช้ placeholder แทน และ escape วงเล็บปีกกาในชื่อเป็น `{{`/`}}` ตาม textV2 ชื่อที่มี HTML characters เป็นข้อมูลข้อความ ไม่แทรก HTML
- กำหนด `notificationDisabled:false` อย่างชัดเจน ส่ง mention พร้อมการแจ้งเตือนปกติ แต่ไม่มี API หลักฐานว่าโทรศัพท์ผู้รับแสดงแจ้งเตือนแล้ว และยังขึ้นกับการตั้งค่า LINE/อุปกรณ์ผู้รับ
- เก็บ outcome แยก accepted/rejected/network_error, HTTP status, LINE request ID, sent message IDs และ error message/details ไม่ retry ด้วย Push หรือเปลี่ยนเป็น `@ชื่อ` ธรรมดา
- เก็บโครงสร้าง payload จริงก่อน serialization โดยแทน userId ด้วยรหัสตัวอย่างที่คงความสัมพันธ์เดิม ไม่เก็บ replyToken หรือ Access Token หน้าผู้จัดแสดง payload/error/request ID และไม่เรียก HTTP 200 ว่ายืนยันแท็กจริง
- ใช้ตาราง diagnostic เดิม ไม่เปลี่ยนยอดบิล, การผูกบัญชี, การจอง, LIFF หรือระบบ OCR

## Payload ก่อนแก้

ตัวอย่าง 2 คน รันโค้ดของ main เดิมกับ fixture จริง รหัส U000… เป็นรหัสทดสอบ ไม่ใช่ LINE ID ของสมาชิก ช่อง replyToken ถูกปิดบัง

```json
{
  "replyToken": "REDACTED_REPLY_TOKEN",
  "messages": [
    {
      "type": "text",
      "text": "💸 บิลค้าง · ทุกสนาม\n\nSena · 10 พ.ย. 2569 · ค้าง 34 บ.\n• Nut 17 บ.\n• Tom 17 บ.\nชำระเงินของคุณผ่านลิงก์ด้านล่าง 👇\nhttps://liff.line.me/12345-test?club=sena&page=pay&bill=example-bill"
    },
    {
      "type": "textV2",
      "text": "ผู้รับผิดชอบบิลที่ยังค้าง: {friend0} {friend1}",
      "substitution": {
        "friend0": {
          "type": "mention",
          "mentionee": {
            "type": "user",
            "userId": "U00000000000000000000000000000001"
          }
        },
        "friend1": {
          "type": "mention",
          "mentionee": {
            "type": "user",
            "userId": "U00000000000000000000000000000002"
          }
        }
      }
    }
  ]
}
```

## Payload หลังแก้

ข้อมูลบิลและผู้จ่ายเดียวกัน จากฟังก์ชันที่แก้ ไม่ได้ส่งข้อความเข้ากลุ่มจริง

```json
{
  "replyToken": "REDACTED_REPLY_TOKEN",
  "messages": [
    {
      "type": "textV2",
      "text": "💸 บิลค้าง · ทุกสนาม\n\nSena · 10 พ.ย. 2569 · ค้าง 34 บ.\n• {member0} (Nut) 17 บ.\n• {member1} (Tom) 17 บ.\nชำระเงินของคุณผ่านลิงก์ด้านล่าง 👇\nhttps://liff.line.me/12345-test?club=sena&page=pay&bill=example-bill",
      "substitution": {
        "member0": {
          "type": "mention",
          "mentionee": {
            "type": "user",
            "userId": "U00000000000000000000000000000001"
          }
        },
        "member1": {
          "type": "mention",
          "mentionee": {
            "type": "user",
            "userId": "U00000000000000000000000000000002"
          }
        }
      }
    }
  ],
  "notificationDisabled": false
}
```

## การตรวจสอบ

- signed webhook -> อ่าน payerKey จาก D1 จำลอง -> ตรวจ userId/กลุ่ม -> serialize request -> mock Reply API: 1, 2, 10, 20 และ 21 คน
- ชื่อไทย, emoji แบบหลาย code points, อัญประกาศ, HTML characters, วงเล็บปีกกาที่ดูเหมือน placeholder
- สมาชิกไม่อยู่ในกลุ่ม (404), ไม่มีสิทธิ์ (403), network failure, profile ตอบ userId ไม่ตรง; ไม่มี fallback `@ชื่อ`
- Reply API 400/429/500 และ network failure: เก็บ error/request ID, การ retry webhook ตามเดิม, ไม่ส่ง Push
- ไม่เก็บรหัสสมาชิกจริง/Access Token/replyToken ใน diagnostic; กลุ่มได้เฉพาะ LIFF URL ไม่มี private payer token
- คำสั่ง tagtest ทดสอบหลายคนในข้อความเดียว และแจ้งสมาชิกที่ตรวจไม่ผ่าน
- รายชื่อเกิน 5 messages จะได้คำเตือนชัดเจน ไม่ส่งรายชื่อบางส่วนแล้วอ้างว่าครบ
- Browser UI ทดสอบผ่าน Chromium จำลองขนาด iPhone/Android ไม่ใช่การทดสอบสี mention หรือการแจ้งเตือนในแอป LINE จริง

หลังได้รับอนุมัติ deploy ต้องให้สมาชิกอย่างน้อย 2 คนตรวจข้อความเดียวกันจาก badbot bill ว่าชื่อแต่ละคนเป็นลิงก์และกดเปิดได้ และให้ผู้รับตรวจ mention notification ถ้ายังเป็นสีดำ ให้ใช้ LINE request ID + payload ที่แทนรหัสแล้ว + message ID จากรายการที่เพิ่งส่งเพื่อสืบค้นต่อ ไม่สรุปว่า HTTP 200 แปลว่าการแท็กทำงานแล้ว

## เอกสารอ้างอิง

- [LINE textV2 และ mention objects](https://developers.line.biz/en/reference/messaging-api/nojs/#text-message-v2): รองรับหลาย mention สูงสุด 20 ต่อ message, ผู้ถูกแท็กต้องอยู่ในกลุ่มปลายทาง และ validate endpoint ตรวจความเป็นสมาชิกไม่ได้
- [LINE ReplyMessageRequest](https://line.github.io/line-bot-sdk-nodejs/apidocs/@line/namespaces/messagingApi/type-aliases/ReplyMessageRequest.html): notificationDisabled=false และข้อจำกัดการแจ้งเตือนตามการตั้งค่าผู้ใช้
