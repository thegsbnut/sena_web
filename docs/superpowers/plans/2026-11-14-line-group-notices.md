# แจ้งเข้ากลุ่ม LINE (จอง/ถอน/จ่าย) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** หลังจอง/ถอน/จ่ายสำเร็จใน LIFF ส่งข้อความเข้ากลุ่มในนามผู้เล่น (`liff.sendMessages`) และให้บอทตอบฟรี (Reply) เมื่อข้อความมีรหัส `#xxxxx` — แท็กตัวสำรองที่ได้ขึ้น / สรุปบิลจ่ายครบ

**Architecture:** Worker สร้างข้อความ (`notice`) ในผลลัพธ์ API และเก็บรหัสใช้ครั้งเดียวใน D1 (`line-notices.js`); หน้าเว็บส่ง `notice.text` ผ่าน LINE SDK ที่โหลดตอนกดปุ่ม (ไม่ block UI); webhook เห็นรหัส → claim → reply

**Tech Stack:** Cloudflare Worker + D1, vanilla JS, LIFF SDK v2, LINE Messaging API reply (textV2 mention)

**Spec:** `docs/superpowers/specs/2026-11-14-line-group-notices-design.md`

## Global Constraints
- ห้ามใช้ Push API · ส่งไม่ได้ต้องเงียบ ไม่กระทบการจอง/จ่าย · ไม่โหลด LINE SDK ตอนเปิดหน้า
- ก๊วนในข้อความ: `clubOf(club).label.toUpperCase()` (`SENA` / `88`) · วัน: `Intl.DateTimeFormat('th-TH',{weekday:'short',day:'numeric',month:'short',timeZone:'Asia/Bangkok'})` → `ส. 16 พ.ย.`
- เงินในบิลเป็นสตางค์ (`money()` ใน billing.js)
- รหัส: `[a-z0-9]{5}` ท้ายข้อความเป็น ` #xxxxx`, ใช้ครั้งเดียว, อายุ 24 ชม., ลบแถวเก่ากว่า 7 วัน
- "จ่ายแล้ว x/n" นับ `status === 'paid'`
- เพิ่มไฟล์เทสใหม่ใน script `test` ของ `package.json`; `npm run format` ก่อน commit; bump `?v=` ของไฟล์ JS ที่แก้

## Review Focus
1. จองหลายวันพร้อมกัน / บางวันซ้ำ → ข้อความมีเฉพาะวันที่เพิ่มจริง หลายบรรทัด; ซ้ำทั้งหมด → ไม่มี notice (Task 2 test)
2. ถอนแล้วแขก/เพื่อนถูกถอนตามด้วย → สำรองขึ้นหลายคน แท็กทุกคน (Task 2 + Task 4 test)
3. รหัสถูกพิมพ์ซ้ำ / webhook retry / กลุ่มที่ผูกอีกก๊วน → บอทตอบครั้งเดียว เฉพาะกลุ่มก๊วนนั้น (Task 4 test)
4. ผู้จัดยืนยันเงินสดคนสุดท้าย → ได้รหัส + สรุปมีรายชื่อเงินสด (Task 3 + 4 test)
5. หน้าบิลอยู่ใน iframe (`#billsFrame`) → ส่งผ่าน parent ไม่ init LIFF ใน iframe (Task 5 manual check)

---

### Task 1: โมดูล `line-notices.js`
**Files:** Create `line-notices.js`, `test-line-notices.mjs`; Modify `package.json` (test script), `package.json` build ถ้ามี `node --check` รายไฟล์

**Produces:**
- `noticeDay(date: 'YYYY-MM-DD') → string` (`ส. 16 พ.ย.`)
- `noticeClub(club) → 'SENA' | '88'`
- `createNotice(db, { club, kind: 'withdraw' | 'paid', payload: object }, now = Date.now()) → Promise<string code>` — lazy `CREATE TABLE IF NOT EXISTS line_notices (code TEXT PRIMARY KEY, club TEXT NOT NULL, kind TEXT NOT NULL, payload TEXT NOT NULL, created_at INTEGER NOT NULL, used_at INTEGER)`, ลบ `created_at < now-7d`, `INSERT OR IGNORE` วนสุ่มใหม่ถ้าชน
- `claimNotice(db, code, now = Date.now()) → Promise<{club, kind, payload} | null>` — `UPDATE … SET used_at=? WHERE code=? AND used_at IS NULL AND created_at>?` (now-24h) แล้ว SELECT; changes 0 → null
- `releaseNotice(db, code)` — `used_at=NULL` (ใช้เมื่อ reply ล้ม)
- `NOTICE_CODE = /(?:^|\s)#([a-z0-9]{5})\s*$/`

- [ ] Step 1: เทส: `noticeDay('2026-11-14') === 'ส. 14 พ.ย.'`; create → claim ได้ payload; claim ซ้ำ → null; claim หลัง 25 ชม. → null; release แล้ว claim ได้อีก (ใช้ D1 จำลองแบบในเทสเดิม เช่น `test-line-reply.mjs`)
- [ ] Step 2: รันเทส → FAIL · Step 3: เขียนโค้ด · Step 4: PASS · Step 5: commit

### Task 2: notice ใน `/api/booking` (book, cancel)
**Files:** Modify `booking.js` (cancel op ~L788-842, route ~L843-892), Test `test-booking.mjs`
**Consumes:** Task 1 · **Produces:** response field `notice: { text, liffId } | undefined`

- cancel op คืนเพิ่ม `{ sessionId, name, extra: removed.length-1, promotedIds: string[] }` — promoted = playerId ใน `capacity` แรกหลังลบ ที่ไม่อยู่ใน `capacity` แรกก่อนลบ
- route สร้าง notice หลัง `mutateBooking` สำเร็จ (ไม่ใช่ใน op เพราะ op retry ได้):
  - book (`result.added>0`): วัน = `input.sessionIds` − `duplicateIds`; ต่อวัน `ตัวจริง {confirmed}/{capacity}` หรือ `สำรองคิว {n}` ตามตำแหน่งของ `input.playerId`; หนึ่งวัน `🏸 {name} จอง {CLUB} {day} · {status}`; หลายวัน `🏸 {name} จอง {CLUB}` + บรรทัด `• {day} · {status}`; มีเพื่อน/แขก ต่อท้ายบรรทัดแรก ` · +เพื่อน {friend.name}` / ` · +แขก {guest.name}`
  - cancel: `➖ {name} ถอน {CLUB} {day}` (+ ` · พร้อมแขก/เพื่อน {extra} คน` ถ้า extra>0); promotedIds ไม่ว่าง → `createNotice(kind 'withdraw', payload {sessionId, date, promotedIds})` แล้วต่อ ` #code`
  - `liffId: env.LINE_LIFF_ID`; สร้าง notice ล้ม → log `booking:notice` ไม่กระทบคำตอบ
- [ ] Step 1: เทส: จองวันเดียว (ตัวจริง), จองตอนเต็ม (สำรองคิว 1), จองสองวันหนึ่งวันซ้ำ, ซ้ำหมด → ไม่มี notice; ถอนไม่มีสำรอง → ไม่มี `#`; ถอนตอนมีสำรอง → มี `#code` และ claim ได้ `promotedIds` ถูกคน
- [ ] Step 2 FAIL · Step 3 code · Step 4 PASS + `npm test` · Step 5 commit

### Task 3: notice ใน `/api/billing` (upload, cash received)
**Files:** Modify `billing.js` (`upload` ~L638, `cash` ~L727), Test `test-billing.mjs`
**Consumes:** Task 1

- `paymentNotice(env, bill, payload, target, method: 'transfer'|'cash') → Promise<{text, liffId}>`:
  `💸 {name} จ่ายบิล {CLUB} {day}[ · บิลเพิ่มเติม] {money} บ. สำเร็จ · จ่ายแล้ว {paid}/{count}`; เงินสดใช้ `💵` และ `สำเร็จ (เงินสด)`; ทุกคน paid → `createNotice(kind 'paid', payload {billId})` ต่อ ` #code`
- ใส่ `notice` ใน `json({ ok: true, notice })` เฉพาะหลัง `updateBill` สำเร็จ, upload ทุกกรณี และ `cash` เฉพาะ `input.received === true`
- [ ] Step 1: เทส: upload คนแรกของ 2 คน → `จ่ายแล้ว 1/2` ไม่มี `#`; ผู้จัดรับเงินสดคนสุดท้าย → `💵 … (เงินสด) · จ่ายแล้ว 2/2 #xxxxx` claim ได้ `billId`; undo-cash → ไม่มี notice
- [ ] Step 2–5 ตามรูปแบบเดิม

### Task 4: บอทตอบรหัสใน webhook
**Files:** Modify `line-reply.js` (`command`, `replyToGroupCommand`, `rosterSection`), Test `test-line-reply.mjs`
**Consumes:** Task 1, `groupMentionTarget`/`mentionGroupMessage` (line-mentions.js), `member_links`

- `command()`: ข้อความ text ที่ match `NOTICE_CODE` → `{ kind: 'notice', code }` (เช็กก่อน badbot regex)
- ใน `replyToGroupCommand` kind notice: claim; null → return เงียบ (ก่อน dedupe insert ก็ได้); กลุ่มต้องมีแถว `line_groups WHERE group_id=? AND club=?` ไม่งั้น release + return; reply ล้ม → `releaseNotice`
- withdraw: อ่าน booking (`bookingRoute` แบบ rosterSection) หา session `payload.sessionId`; ผู้ได้ขึ้นที่มี `member_links` approved + `groupMentionTarget` ready → `mentionGroupMessage(chunk, '🎉 ', 'ได้สิทธิ์เล่น {CLUB} {day} แล้ว')` (chunk ด้วย `planMentionMessages`); ที่เหลือ (แขก/ไม่ผูก/ไม่อยู่กลุ่ม) → text `🎉 {name} ได้สิทธิ์เล่น {CLUB} {day} แล้ว`; ตามด้วย roster ของ session นั้น: `rosterSection(env, club, now, sessionId?)` (เพิ่มพารามิเตอร์เลือก session); รวม ≤ 5 ข้อความ
- paid: `readBill` → `✅ บิล {CLUB} {day} จ่ายครบ {n}/{n} · รวม {money(sum amount)} บ.` + บรรทัด `💵 เงินสด {k} คน: a, b` ถ้ามี (export helper จาก billing.js: `paidSummaryText(env, billId)`)
- [ ] Step 1: เทส: รหัส withdraw → reply มี textV2 mention userId ของคนผูก + roster; ส่งรหัสเดิมอีก → ไม่ fetch reply; กลุ่มผูกก๊วนอื่น → ไม่ reply; รหัส paid → ข้อความสรุปพร้อมเงินสด; reply 500 → claim ได้ใหม่
- [ ] Step 2–5

### Task 5: หน้าเว็บส่งข้อความ + ลิงก์ endpoint
**Files:** Create `public/line-notice.js`; Modify `public/booking.js` (`submit` ~L205-260), `public/billing.js` (upload ×2 ~L800/L829, cash ×2 ~L1065/L1210), `public/court.html`, `public/billing.html`, `worker.js` (L221), `package.json` build ถ้ามีรายชื่อไฟล์
- `window.SenaLineNotice = { preload(), send(notice) }`:
  - เฉพาะ UA มี `Line/`; ใน iframe → `parent.postMessage({ senaNotice })` / `{ senaNoticePreload: true }` ไปที่ `location.origin`; top-level ฟัง `message` (เช็ก origin)
  - `preload()` โหลด `https://static.line-scdn.net/liff/edge/2/sdk.js` ครั้งเดียว; `send()` → preload → `liff.init({liffId})` ครั้งเดียว → context type `group`/`room` → `liff.permission.query('chat_message.write')` granted → `liff.sendMessages([{type:'text',text}])`; error ทั้งหมด `console.warn` เท่านั้น
- เรียก `preload()` ตอนเริ่ม request (book/cancel/upload/cash) และ `send(data.notice)` หลังสำเร็จ โดยไม่ await
- worker: `/` ที่มี query `page` หรือ `liff.state` → redirect `/liff.html` + query เดิม (เผื่อเปลี่ยน endpoint เป็น root); อื่นๆ คงเดิม
- [ ] Step 1: เทส worker redirect ใน `test.mjs` (หรือไฟล์ที่ทดสอบ worker routing)
- [ ] Step 2: wrangler dev + Playwright: stub `window.liff` (UA มี `Line/`) ยืนยันว่า booking และหน้าบิลใน iframe เรียก `sendMessages` ด้วยข้อความถูกต้อง และ UI แสดงสำเร็จก่อน
- [ ] Step 3: commit

### Task 6: เอกสาร
- `LINE-LIFF.md`: scope `chat_message.write`, ข้อจำกัด (ต้องเปิดจากกลุ่ม), ถ้าส่งไม่ขึ้นบน `/court` ให้เปลี่ยน endpoint เป็น `https://sena-web.thegsbnut.workers.dev/`
- `HANDOFF.md`: สถานะ + ยังไม่ได้ทดสอบใน LINE จริง
- `npm test`, `npm run build`, `npm run format:check` ผ่าน → commit + push
