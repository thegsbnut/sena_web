# สปอนเซอร์วันแข่ง Cup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ผู้เล่นลงเป็นสปอนเซอร์วัน Cup ในหน้าจอง → บอทประกาศขอบคุณ + แท็กตัวจริงในกลุ่ม → การ์ด Badbot ของก๊วนนั้นมีแถบสปอนเซอร์ท้ายการ์ดจนถึงวันแข่ง + 7 วัน

**Architecture:** ตารางใหม่ `cup_sponsors` + โมดูล `sponsors.js` (ตรรกะ/DB) และ `line-sponsor-card.js` (Flex, pure) การเขียนผ่าน `/api/booking` เป็น action ใหม่แบบเดียวกับ `job` (ข้อมูลอยู่นอกเอกสารจอง เขียนแล้วตอบเหมือน GET) เพื่อใช้ตัวตนสมาชิก การตรวจรอบ และกลไก notice เดิม แถบท้ายการ์ดใส่ที่จุดเดียวก่อนส่ง reply: bubble ที่ "ติดป้าย" ด้วย Symbol (JSON ไม่ส่งออก) จะได้แถบ การ์ดขุนเงินไม่ติดป้ายจึงไม่มีแถบโดยอัตโนมัติ

**Tech Stack:** Cloudflare Worker, D1, vanilla JS, `node --test` + `node:sqlite`

**Spec:** `docs/superpowers/specs/2026-11-20-cup-sponsors-design.md`

**ต่างจากสเปกหนึ่งจุด (ตัดสินใจตอนวางแผน):** สเปกเขียน route `/api/sponsors` แยก; แผนนี้ใช้ action ใน `/api/booking` แทน เพราะต้องใช้เอกสารจองตรวจวัน Cup/เวลาเริ่ม, ตัวตนสมาชิก, `notice` ที่หน้า `public/booking.js` ส่งเข้ากลุ่มอยู่แล้ว และหน้าได้ข้อมูลจองชุดใหม่กลับไปวาดทันที (pattern เดียวกับ `action: 'job'`)

## Global Constraints
- ก๊วน `'sena'` / `'88'` เท่านั้น จาก `?club=`; ทุกอย่างแยกก๊วน
- ตารางใหม่เพิ่มใน `schema.js` เท่านั้น และเรียก `db.prepare(SQL.cupSponsors).run()` ก่อนใช้
- แก้/ลบ = `WHERE id=? AND revision=?` → ไม่ชนตอบ 409 ข้อความไทย
- POST ใต้ `/api/` ผ่านเช็ก Origin อยู่แล้ว (worker.js) ไม่ต้องทำเพิ่ม
- frontend escape ทุกข้อความด้วย `html()`; ไม่ใช้ `confirm()`
- ข้อความ: trim, ยุบช่องว่าง, `normalize('NFC')`; `prize` 1–60, `awardNote` 1–30 (บังคับเมื่อ `other`), `message` 0–60, `displayName` 1–30 (นับด้วย `[...str].length`)
- `award` ∈ `champ | runnerUp | third | last | all | other`; ป้าย: `🥇 แชมป์`, `🥈 รองแชมป์`, `🥉 ที่ 3`, `💩 ท้ายตาราง`, `ทุกคน`, (`other` = awardNote)
- เพดาน 10 รายการต่อ club+cup_date (เฉพาะการลงใหม่; ย้ายวันเกินได้)
- ช่วงแถบ: ตั้งแต่บันทึก ถึงสิ้นวัน `cup_date + 7` เวลาไทย; ทีละรอบ = Cup เก่าสุดที่ยังไม่พ้น
- แถบไม่ใส่: `owedBubble`, `paidBubble`, ตามบิลตอนเช้า, เมนู Badbot
- แท็กเฉพาะประกาศครั้งแรก (notice `sponsor`) ตัวจริงเท่านั้น ไม่แท็กสปอนเซอร์ ≤ 3 แท็ก/ข้อความ, การ์ด + ≤ 4 ข้อความแท็ก, เกิน → quick reply; `badbot sponsor` ไม่แท็ก
- เทสใหม่ `test-sponsors.mjs` ใส่ใน script `test` ของ `package.json`; `npm run format` ก่อน commit; `npm test` + `npm run build` ต้องผ่าน

## Review Focus
1. **ผู้เล่นเปลี่ยนชื่อ / ถูกลบจาก roster** — แถบ/หน้าจองแสดงชื่อปัจจุบัน; ถูกลบแล้วใช้ `display_name` snapshot ไม่ขึ้น "undefined" → เทสใน Task 2 (`sponsorView`)
2. **การ์ดเกินขนาด LINE เมื่อ roster carousel ทั้งสองก๊วน + แถบ 3 บรรทัดชื่อยาว 60 ตัว** — ต้องยังต่ำกว่า 50 KB/carousel, 30 KB/bubble → เทสใน Task 4
3. **ผู้จัดเปลี่ยน "สัปดาห์ Cup" (cupWeek) แทนการติ๊กรายวัน** — วันที่หลุดจาก Cup เพราะเปลี่ยนสัปดาห์ก็ต้องนับเป็น "lost" และมีตัวเลือกย้าย → เทสใน Task 3
4. **อ่านตาราง `cup_sponsors` พัง (D1 error)** — คำตอบในกลุ่มต้องยังส่งการ์ดเดิมไม่มีแถบ และ GET หน้าจองยังทำงาน (sponsors = []) → เทสใน Task 3 และ Task 5
5. **สปอนเซอร์ลบรายการของตัวเองก่อนบอทตอบ notice / แท็กแล้ว LINE ปฏิเสธข้อความแท็ก** — ไม่ตอบ (ลบแล้ว) / การ์ดยังส่ง → เทสใน Task 5

---

### Task 1: ตาราง + ตรรกะ pure ใน `sponsors.js`

**Files:**
- Modify: `schema.js` (เพิ่มใน object `SQL` ของ `DB`)
- Create: `sponsors.js`
- Create: `test-sponsors.mjs`; Modify: `package.json` (script `test`)

**Interfaces:**
- Produces (`sponsors.js`):
  - `SPONSOR_LIMIT = 10`, `AWARDS = ['champ','runnerUp','third','last','all','other']`
  - `awardLabel(award: string, note?: string) -> string`
  - `cleanSponsorInput(input: object, { admin: boolean }) -> { prize, award, awardNote|null, message|null, displayName|null }` — ผิดกติกา `throw new BookingError(<ไทย>, 400)` (import จาก `booking.js`); `displayName` อ่านเฉพาะเมื่อ admin และไม่มี `playerId`
  - `showUntil(cupDate: 'YYYY-MM-DD') -> 'YYYY-MM-DD'` (= +7 วัน)
  - `activeSponsors(rows: Row[], today: 'YYYY-MM-DD') -> Row[]` — rows ของก๊วนเดียว; ตัด `hidden`; เลือก `cup_date` น้อยสุดที่ `showUntil(cup_date) >= today`
  - `Row` = แถว DB ตามชื่อคอลัมน์ (`id, club, cup_date, player_id, display_name, prize, award, award_note, message, hidden, created_at, updated_at, revision`)
- `SQL.cupSponsors`, `SQL.cupSponsorsDateIndex`, `SQL.cupSponsorsPlayerIndex` (unique `(club,cup_date,player_id) WHERE player_id IS NOT NULL`) — คอลัมน์ตามสเปกหัวข้อ "ข้อมูล" รวม `display_name TEXT NOT NULL`

- [ ] **Step 1: เขียนเทสที่ล้ม** ใน `test-sponsors.mjs`
```js
test('activeSponsors shows one cup at a time until cup day + 7', () => {
  const r = (id, cup_date, hidden = 0) => ({ id, cup_date, hidden });
  const rows = [r('a', '2026-12-12'), r('b', '2026-12-12'), r('t', '2027-01-09'), r('h', '2026-12-05', 1)];
  assert.deepEqual(activeSponsors(rows, '2026-12-01').map(x => x.id), ['a', 'b']);
  assert.deepEqual(activeSponsors(rows, '2026-12-19').map(x => x.id), ['a', 'b']); // ขอบ D+7
  assert.deepEqual(activeSponsors(rows, '2026-12-20').map(x => x.id), ['t']);      // รอบถัดไปขึ้น
  assert.deepEqual(activeSponsors(rows, '2027-01-17'), []);
  assert.deepEqual(activeSponsors([], '2026-12-01'), []);
});
test('cleanSponsorInput trims, normalizes and enforces limits', () => {
  assert.deepEqual(cleanSponsorInput({ prize: '  ลูกแบด   1 หลอด ', award: 'champ' }, { admin: false }),
    { prize: 'ลูกแบด 1 หลอด', award: 'champ', awardNote: null, message: null, displayName: null });
  assert.throws(() => cleanSponsorInput({ prize: '', award: 'champ' }, { admin: false }), /ของรางวัล/);
  assert.throws(() => cleanSponsorInput({ prize: 'x'.repeat(61), award: 'all' }, { admin: false }), /60/);
  assert.throws(() => cleanSponsorInput({ prize: 'x', award: 'other' }, { admin: false }), /มอบให้/);
  assert.throws(() => cleanSponsorInput({ prize: 'x', award: 'king' }, { admin: false }));
  assert.equal(cleanSponsorInput({ prize: 'x', award: 'all', displayName: 'ร้าน A' }, { admin: false }).displayName, null);
  assert.equal(cleanSponsorInput({ prize: 'x', award: 'all', displayName: 'ร้าน A' }, { admin: true }).displayName, 'ร้าน A');
});
test('awardLabel', () => {
  assert.equal(awardLabel('champ'), '🥇 แชมป์');
  assert.equal(awardLabel('other', 'คนตบแรงสุด'), 'คนตบแรงสุด');
});
```
- [ ] **Step 2:** เพิ่ม `test-sponsors.mjs` ใน script `test`; รัน `node --test test-sponsors.mjs` → FAIL (module not found)
- [ ] **Step 3:** เพิ่ม SQL ใน `schema.js`, เขียน `sponsors.js` ตาม Interfaces (`showUntil` ใช้ `Date.UTC` บนสตริงวันที่ ไม่ใช้เวลาเครื่อง)
- [ ] **Step 4:** `node --test test-sponsors.mjs test-schema.mjs` → PASS
- [ ] **Step 5:** `npm run format` แล้ว commit `feat(sponsors): ตาราง cup_sponsors + ตรรกะช่วงแสดง`

### Task 2: DB layer ใน `sponsors.js`

**Files:** Modify `sponsors.js`, `test-sponsors.mjs`

**Interfaces:**
- Consumes: Task 1
- Produces:
  - `listSponsors(db, { clubs: string[], from?: 'YYYY-MM-DD', dates?: string[] }) -> Row[]` (`hidden=0` เท่านั้น เรียง `created_at`)
  - `createSponsor(db, { id, club, cupDate, playerId|null, displayName, ...clean }, now:number) -> Row` — คำสั่งเดียว `INSERT … SELECT … WHERE (SELECT COUNT(*) FROM cup_sponsors WHERE club=? AND cup_date=? AND hidden=0) < 10`; 0 แถว → ถ้ามีแถวของ player นี้อยู่แล้ว 409 `คุณเป็นสปอนเซอร์วันนี้แล้ว` ไม่งั้น 409 `สปอนเซอร์วันนี้ครบ 10 คนแล้ว`; unique ชน → 409 แบบแรก; `INSERT OR IGNORE` ด้วย id เดิมซ้ำ = สำเร็จ (idempotent)
  - `updateSponsor(db, id, revision, clean, now) -> Row` / `deleteSponsor(db, id, revision) -> void` — ไม่ชน 409 `มีการแก้สปอนเซอร์จากอีกเครื่อง กรุณาโหลดใหม่`
  - `getSponsor(db, id) -> Row|null`
  - `sponsorView(rows, { players: {id,name}[], ownId|null, admin, started:boolean }) -> [{ id, name, prize, award, awardLabel, message, mine, canEdit, revision }]` — `name` = ชื่อ roster ปัจจุบันของ `player_id` ?? `display_name`; `canEdit = admin || (mine && !started)`
  - `applyCupMoves(db, club, { lost: string[], gained: string[], moves: {from,to|null}[] }, now) -> void` — ลำดับ: (1) แต่ละ move ที่ `to` มีค่า: แถว `from` ที่ player ซ้ำกับแถว `to` → `hidden=1`; ที่เหลือ `cup_date=to, revision+1`; (2) วันใน `lost` ที่ยังมีแถว → `hidden=1`; (3) วันใน `gained` → `hidden=0` ยกเว้นแถวที่ player ซ้ำกับแถวที่มองเห็นอยู่ในวันนั้น

- [ ] **Step 1: เทสที่ล้ม** (D1 shim บน `node:sqlite` แบบใน `test-line-reply.mjs`)
  - `create ครบ 10 แล้วตัวที่ 11 → 409 /ครบ 10/`; `player เดิมลงซ้ำ → 409 /แล้ว/`; `create id เดิมซ้ำ → คืนแถวเดิม`
  - `update revision ผิด → 409`; `delete แล้ว getSponsor → null`
  - `sponsorView: เปลี่ยนชื่อใน roster → name ใหม่; player ไม่อยู่ใน roster → display_name; started=true → canEdit false สำหรับเจ้าของ, true สำหรับ admin`
  - `applyCupMoves: ย้าย 3 แถว 12→19; player ซ้ำที่ 19 → แถว 12 hidden; ย้ายรวมได้ 12 แถว (เกิน 10); lost ที่ไม่ย้าย → hidden; gained คืน hidden=0`
- [ ] **Step 2:** `node --test test-sponsors.mjs` → FAIL
- [ ] **Step 3:** implement ตาม Interfaces (ทุกฟังก์ชันเรียก `db.prepare(SQL.cupSponsors).run()` + index ผ่าน helper `prepare(db)`)
- [ ] **Step 4:** → PASS
- [ ] **Step 5:** format + commit `feat(sponsors): บันทึก/แก้/ลบ/ย้ายวัน`

### Task 3: ผูกเข้ากับ `/api/booking`

**Files:** Modify `booking.js`; Test: `test-sponsors.mjs` (เรียกผ่าน `worker.fetch` แบบ `test-booking.mjs`)

**Interfaces:**
- Consumes: Task 1–2
- Produces:
  - `export const sessionIsCup = (s, cupWeek) => !s.skipped && (s.cupOverride ?? weekOfMonth(s.date) === cupWeek)` — แทนนิพจน์เดิมใน `publicBooking`
  - GET: แต่ละ session ที่ `isCup` มี `sponsors: sponsorView(...)` และ `sponsorFull: boolean`; อ่าน `listSponsors(db,{clubs:[club], from: bangkokDate(now)})` คู่ขนานกับ `readBadgeSource`/`mutateBooking`; error → log `booking:sponsors` และ `[]`
  - POST `{ action: 'sponsorSave', date, id?, revision?, playerId?, prize, award, awardNote?, message?, displayName?, notify: boolean }`
    - สิทธิ์: memberMode + ไม่ใช่ admin → ต้อง `member.link.status==='approved'` และ `playerId === member.link.player_id`; admin ลงแทน = ไม่ส่ง `playerId` + `displayName`
    - ตรวจใน operation ของ `mutateBooking` (อ่านอย่างเดียว): session `date` มีจริง, ยังไม่เริ่ม, `sessionIsCup` จริง ไม่งั้น 409 `วันนี้ไม่ใช่วันแข่ง Cup หรือเริ่มแล้ว`
    - เขียน DB **หลัง** `mutateBooking` คืนค่า (ไม่อยู่ใน operation ที่อาจถูก retry); สร้างใหม่ใช้ `id = crypto.randomUUID()` ที่สร้างครั้งเดียวต่อ request
    - เจ้าของแก้ของคนอื่นไม่ได้ → 403
    - result: `{ message: 'บันทึกสปอนเซอร์แล้ว' }`; `notify && !id` → `notice = { text: '🎁 ขอเป็นสปอนเซอร์ ' + noticeClub(club) + ' ' + noticeDay(date) + await codeSuffix(env, club, 'sponsor', { id }), liffId }`
  - POST `{ action: 'sponsorDelete', id, revision }` → สิทธิ์เดียวกัน (`canEdit`), result `{ message: 'ยกเลิกการเป็นสปอนเซอร์แล้ว' }`
  - `cupCalendar` รับ `sponsorMoves?: {from, to|null}[]` (≤ 20): ใน operation เก็บ `isCup` ก่อน/หลังของทุก session ที่ยังไม่เริ่ม → `lost` / `gained` (รวมผลจากเปลี่ยน `week`); ตรวจ `from ∈ lost`, `to` เป็น Cup หลังแก้และยังไม่เริ่ม ไม่งั้น 400 `เลือกวันย้ายสปอนเซอร์ใหม่`; หลังบันทึกสำเร็จเรียก `applyCupMoves`
- รายชื่อ action ที่ยอมรับเพิ่ม `sponsorSave`, `sponsorDelete` (ไม่อยู่ในกลุ่มที่ต้องเป็น admin)

- [ ] **Step 1: เทสที่ล้ม** (fixture: Sena มี session Cup วันอนาคต + session ปกติ, memberMode on)
  - `สมาชิกลงสปอนเซอร์วัน Cup → GET เห็น sponsors[0].name และ mine=true`
  - `ลงวันที่ไม่ใช่ Cup → 409`; `playerId ไม่ตรงสมาชิก → 403`; `แก้ของคนอื่น → 403`
  - `notify=true → response.notice.text ลงท้าย #xxxxx และ line_notices มี kind sponsor payload {id}`
  - `ข้อมูล 88 ไม่โผล่ใน ?club=sena`
  - `cupCalendar: เอา Cup ออกวัน A + ใส่วัน B + sponsorMoves [{from:A,to:B}] → sponsors อยู่วัน B`
  - `cupCalendar: เปลี่ยน week (ไม่ติ๊กรายวัน) + moves จากวัน Cup เดิม → ย้ายได้ (lost มาจาก week)`
  - `cupCalendar: to ไม่ใช่ Cup → 400 และปฏิทินไม่ถูกบันทึก`
  - `D1 ของ cup_sponsors throw ตอน GET → 200 และ sponsors เป็น []`
- [ ] **Step 2:** → FAIL
- [ ] **Step 3:** implement
- [ ] **Step 4:** `npm test` → PASS ทั้งหมด (รวม `test-booking.mjs` เดิม)
- [ ] **Step 5:** format + commit `feat(sponsors): ลง/แก้/ลบผ่านหน้าจอง + ย้ายตามปฏิทิน Cup`

### Task 4: การ์ดและแถบใน `line-sponsor-card.js`

**Files:**
- Create: `line-sponsor-card.js`
- Modify: `line-roster-card.js` (`rosterBubble`, `emptyBubble`), `line-board-cards.js` (`gamesBubble`, `leaderboardBubble`, `cupResultBubble`) — เพิ่มแค่ `markSponsor(...)` ก่อน return
- Create: `scripts/flex-problems.mjs` — ย้าย `flexProblems` ออกจาก `test-line-reply.mjs` มาไว้ที่นี่ (export) ให้ทั้งสองไฟล์เทส import ร่วมกัน
- Test: `test-sponsors.mjs`

**Interfaces:**
- Produces:
  - `SPONSOR_MARK = Symbol('sponsor')`; `markSponsor(bubble, club, cupDate?) -> bubble` (ตั้ง `bubble[SPONSOR_MARK] = { club, cupDate: cupDate ?? null }`)
  - `sponsorStrip(club, rows: {name, prize, award, award_note}[], { thanks?: boolean, cupDate }) -> FlexBox` — หัว `🎁 SENA CUP ส. 12 ธ.ค. · สนับสนุนโดย` (thanks: `🎁 ขอบคุณสปอนเซอร์ SENA CUP ส. 12 ธ.ค.`) ใช้ `noticeClub`/`noticeDay`; บรรทัดละคน `ชื่อ · ของรางวัล ป้าย` สูงสุด 3 + `+ อีก n คน`; พื้น Sena `#FFF6DC` / 88 `#EEF3FC`; text `wrap: true, maxLines: 2`
  - `withSponsorStrips(messages, rows: Row[] (ทุกก๊วน, มี name แล้ว), today) -> messages` — เดินทุก flex message (bubble/carousel); bubble ที่มี mark: `cupDate` ว่าง → `activeSponsors(rows ของ club, today)`; มี `cupDate` (ผล Cup) → แถวของวันนั้น + `thanks`; ไม่มีแถว → ไม่แตะ; ต่อท้าย `footer.contents` (ไม่มี footer → สร้าง vbox `paddingAll: 'lg'`)
  - `sponsorBubble({ club, cupDate, rows, highlightId?, joinUrl }) -> bubble` — หัวทอง (`goldHeader` จาก line-board-cards.js — export เพิ่ม), ถ้ามี `highlightId`: ชื่อใหญ่ + กล่องของรางวัล + ป้าย + ข้อความ; รายชื่อทั้งหมดของวันนั้น; ปุ่ม `🎁 ร่วมเป็นสปอนเซอร์` สี `clubColor(club)`; rows ว่าง → ข้อความ `ยังไม่มีสปอนเซอร์ <cupName> <วัน>` + ปุ่มเดิม; คืน bubble ที่ `markSponsor(club)` แล้ว
  - `sponsorAlt(club, cupDate, rows) -> string`

- [ ] **Step 1: เทสที่ล้ม**
  - `withSponsorStrips ใส่แถบใน rosterBubble ที่ mark แล้ว แต่ไม่ใส่ใน owedBubble/paidBubble ของบิลเดียวกันใน message เดียวกัน`
  - `carousel sena + 88: แต่ละใบได้แถวของก๊วนตัวเอง; ก๊วนที่ไม่มีแถว ไม่มีแถบ`
  - `cupResultBubble(mark ด้วย cupDate เก่ากว่า 7 วัน) ยังได้แถบ thanks`
  - `แถบ 5 คน → 3 บรรทัด + '+ อีก 2 คน'`
  - `JSON.stringify ของ bubble ไม่มีร่องรอย mark`
  - `flexProblems ว่างสำหรับ sponsorBubble (มี/ไม่มี highlight/rows ว่าง) และ bubble ที่มีแถบ`
  - `roster carousel 2 ก๊วน × 30 ชื่อ + แถบ 3 บรรทัด ชื่อ 30 ตัว ของรางวัล 60 ตัว: JSON < 50000 ไบต์ และแต่ละ bubble < 30000`
- [ ] **Step 2:** → FAIL
- [ ] **Step 3:** implement + ย้าย `flexProblems` ไป `scripts/flex-problems.mjs` (test-line-reply.mjs import แทน)
- [ ] **Step 4:** `npm test` → PASS
- [ ] **Step 5:** format + commit `feat(sponsors): การ์ดขอบคุณ + แถบท้ายการ์ด`

### Task 5: Badbot ตอบในกลุ่ม (`line-reply.js`)

**Files:** Modify `line-reply.js`; Test: `test-line-reply.mjs`

**Interfaces:**
- Consumes: Task 2 (`listSponsors`, `getSponsor`), Task 4 ทั้งหมด
- Produces:
  - คำสั่งใหม่ใน map: `sponsor` (scope all), `sponsor sena`, `sponsor 88` → `{ kind: 'sponsor', scope }`, ขึ้นใน `help`
  - postback `badbot:sponsorTag:<id>:<offset>` → `{ kind: 'sponsorTag', id, offset }`
  - `sponsorMessages(env, group, club, sponsorId, { tagsFrom = 0, card = true }, now) -> messages|null`:
    แถว `getSponsor` ไม่มี/hidden → `null` (ไม่ตอบ, log `line-reply:sponsor-gone`);
    การ์ด `sponsorBubble({ highlightId })` (เมื่อ `card`); ตัวจริงของ session `cup_date` จาก `bookingData` (`status==='confirmed'`, ไม่เอา `player_id` ของสปอนเซอร์) → member_links + `groupMentionTarget` → `planMentionMessages` → ข้อความ `mentionGroupMessage(chunk, '', 'รับทราบด้วยน้า ขอบคุณสปอนเซอร์กันด้วย')`;
    คนแท็กไม่ได้ → ข้อความธรรมดา `ชื่อ1, ชื่อ2 รับทราบด้วยน้า ขอบคุณสปอนเซอร์กันด้วย`;
    รวมไม่เกิน 5 ข้อความ; แท็กเหลือ → `quickReply` ปุ่ม `แท็กต่ออีก N คน` postback `badbot:sponsorTag:<id>:<offset ถัดไป>`
  - notice kind `sponsor` → `sponsorMessages(..., { card: true })`; `sponsorTag` → `{ card: false, tagsFrom: offset }`
  - `kind: 'sponsor'` → การ์ด `sponsorBubble` ของ `activeSponsors` ต่อก๊วน (ไม่มี → Cup ถัดไปในหน้าจองแบบ rows ว่าง; ไม่มี Cup ถัดไป → ข้อความ `ยังไม่มีวันแข่ง Cup ที่เปิดจอง`) — ไม่แท็ก
  - ก่อนส่ง reply (จุดเดียว หลังสร้าง `messages` ครบ): `rows = await listSponsors(db, { clubs })` + เติม `name` จาก roster (`bookingData` ที่อ่านแล้ว หรือ `clubStateFor`) → `withSponsorStrips(messages, rows, bangkokDate(now))`; ทั้งหมดใน try/catch → พัง = ส่งเดิม (log `line-reply:sponsor-strip`)
  - ข้อความแท็กถูก LINE ปฏิเสธ (400 ที่ไม่ใช่ flex) → ส่งซ้ำเฉพาะ flex message (ใช้ `flexRejected` เพื่อแยกกรณี)

- [ ] **Step 1: เทสที่ล้ม** (fixture เดิมใน `test-line-reply.mjs` + member_links + LINE fetch mock)
  - `notice sponsor → reply[0] เป็นการ์ดขอบคุณ, ตามด้วยข้อความ textV2 แท็กตัวจริงที่ผูก LINE, ไม่แท็กสำรองและไม่แท็กตัวสปอนเซอร์`
  - `ตัวจริง 15 คนผูกหมด → การ์ด + 4 ข้อความแท็ก (12 คน) + quickReply 'แท็กต่ออีก 3 คน'; postback sponsorTag → 1 ข้อความ 3 แท็ก ไม่มีการ์ด`
  - `คนไม่ผูก LINE → อยู่ในข้อความธรรมดา`
  - `แถวถูกลบก่อน claim → ไม่มี reply`
  - `badbot sponsor → การ์ดเท่านั้น ไม่มี textV2`
  - `badbot list sena ช่วงสปอนเซอร์ active → bubble footer มีแถบ; badbot bill → การ์ดบิลไม่มีแถบ`
  - `listSponsors throw → badbot list sena ยังตอบการ์ด (ไม่มีแถบ)`
  - `LINE 400 ที่ messages[1] (textV2) → ส่งซ้ำเฉพาะการ์ด`
- [ ] **Step 2:** → FAIL
- [ ] **Step 3:** implement
- [ ] **Step 4:** `npm test` → PASS
- [ ] **Step 5:** format + commit `feat(sponsors): Badbot ประกาศ + แท็ก + คำสั่ง sponsor + แถบทุกการ์ด`

### Task 6: หน้าเว็บ (`public/booking.js`, `public/booking.css`, `public/court.html`)

**Files:** Modify ทั้งสามไฟล์ (bump `?v=` ของ booking.js/booking.css ใน HTML ตามที่โปรเจกต์ทำ)

**Interfaces:**
- Consumes: Task 3 (ฟิลด์ GET `sponsors`, `sponsorFull`; actions `sponsorSave`/`sponsorDelete`; `cupCalendar.sponsorMoves`; `notice`)
- UI ตามจอ 1–2 ในดีไซน์:
  - การ์ดวัน Cup: กล่อง `.booking-sponsors` (มีแถว) + ปุ่ม `🎁 ร่วมเป็นสปอนเซอร์` / `แก้สปอนเซอร์ของฉัน` (ซ่อนเมื่อ closed/started/skipped/ไม่ได้ล็อกอินในโหมดสมาชิก; `sponsorFull` และยังไม่ได้ลง → ข้อความ `ครบ 10 คนแล้ว`)
  - `<dialog id="bookingSponsorDialog">` ใน `court.html`: ช่อง `#sponsorPrize` (maxlength 60), ชิป radio `name="sponsorAward"`, `#sponsorAwardNote` (โชว์เมื่อ other, maxlength 30), `#sponsorMessage` (maxlength 60), `#sponsorDisplayName` (เฉพาะผู้จัด), checkbox `#sponsorNotify` (checked), ปุ่มยืนยัน, ปุ่ม `ยกเลิกการเป็นสปอนเซอร์` + แถวยืนยันในหน้า; status `#bookingSponsorStatus`
  - ผู้จัด: ปุ่มลบในแต่ละแถว (ยืนยันในหน้า)
  - หลังบันทึก: `notice` → `window.SenaLineNotice?.preload()` ตอนกดยืนยัน และ `SenaLineNotice.send(notice)` หลังสำเร็จ (แบบ `public/billing.js:966-972`); นอก LINE → status `บันทึกแล้ว พิมพ์ badbot sponsor ในกลุ่มเพื่อโชว์การ์ด`
  - ปฏิทิน Cup (ผู้จัด): ใต้ `#bookingCupDates` วาด `#bookingSponsorMoves` ใหม่ทุกครั้งที่ checkbox/สัปดาห์เปลี่ยน: แต่ละวันที่ `s.isCup && s.sponsors.length` แต่ตอนนี้ไม่ติ๊ก → `<select data-move-from>` ตัวเลือก = วันที่ติ๊กอยู่ที่ยังไม่เริ่ม + `ไม่ย้าย (ซ่อนไว้)`; ค่าเริ่มต้น = วันที่ "ติ๊กเพิ่ม" (เดิมไม่ใช่ Cup) ในเดือนเดียวกันถ้ามีพอดี 1 วัน; submit ส่ง `sponsorMoves`

- [ ] **Step 1:** implement
- [ ] **Step 2:** `npm test && npm run build` → PASS
- [ ] **Step 3: ตรวจด้วยตา** — server Node เล็กๆ เรียก `worker.fetch` + D1 `node:sqlite` + ASSETS จาก `public/` (ตาม HANDOFF "ทดสอบหน้าในเครื่อง") ตั้ง `LINE_MEMBER_AUTH_ENABLED=false`, `ADMIN_KEY=test-key`; Playwright ขนาดมือถือ: ลงสปอนเซอร์ → เห็นในการ์ดวัน → แก้ → ยกเลิก; ผู้จัด: ย้าย Cup แล้วเลือกวันย้าย → สปอนเซอร์ย้าย; ส่งภาพหน้าจอให้เจ้าของ
- [ ] **Step 4:** format + commit `feat(sponsors): หน้าจอง ฟอร์มสปอนเซอร์ + ย้ายตามปฏิทิน Cup`

### Task 7: เอกสาร + ตรวจรวม

**Files:** `BADBOT-REPLY.md`, `BOOKING.md`, `CLAUDE.md` (ตารางโมดูล: `sponsors.js`, `line-sponsor-card.js`), `HANDOFF.md`

- [ ] **Step 1:** เขียนเอกสาร (สั้น ชี้ไปสเปก)
- [ ] **Step 2:** `npm run format:check && npm test && npm run build` → ผ่านทั้งหมด
- [ ] **Step 3:** commit + push branch `claude/optimistic-goodall-3m86nj` (ไม่ merge main — รอเจ้าของสั่ง)
