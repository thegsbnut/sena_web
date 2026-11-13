# Job Badges Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** แทนตัวย่อชื่อในการ์ดจองด้วย job badge แบบ RPG ที่ไต่ขั้นตามจำนวนครั้งที่มาตี (นับอัตโนมัติจากการจองทุกคืน) + มงกุฎแชมป์ + ให้ผู้เล่นเลือกสายเอง

**Architecture:** กติกาขั้น/สาย อยู่ในไฟล์ UMD เล็กๆ `public/job-rules.js` (ใช้ทั้ง Worker และเบราว์เซอร์ แบบเดียวกับ `public/engine.js`). ฝั่ง Worker มีโมดูลใหม่ `job-badges.js` จัดการตาราง D1 `attendance`, `player_jobs` และคำนวณข้อมูล badge; `booking.js` เรียกใช้ใน cron, GET และ POST `action:'job'`. ฝั่งเบราว์เซอร์ `public/job-badges.js` วาด SVG (ยกจาก mockup) และ `public/booking.js` ใช้แทน `booking-avatar`

**Tech Stack:** Cloudflare Worker + D1, vanilla JS/CSS, `node --test` + `node:sqlite` จำลอง D1

**Spec:** `docs/superpowers/specs/2026-11-13-job-badges-design.md` · mockup `docs/superpowers/mockups/2026-11-13-badge-mockup.html` (ฟังก์ชัน `jobSvg`, `racketV`, `shuttleV`, `swordV`, `crackPath`, `heartAt`, `FOCUS`, `TWINKLE`, `disc40`, `sticker`, `jobBadge` และ `<defs>`)

## Global Constraints
- ก๊วนมีแค่ `'sena'` กับ `'88'` นับแยกกัน
- ขั้น: Novice 0–4, Job1 5–14, Job2 15–29, Job3 30+; ดาว = `min(5, floor((plays-30)/30))` เมื่อ plays ≥ 30
- สาย (ลำดับคงที่): `['red','green','yellow','pink','blue']`
- ชื่อ job ตามตารางใน spec (อังกฤษ + ไทย) ห้ามเปลี่ยน
- ไม่ลดขั้น; แขก (`guest`) และคิวสำรองไม่นับ; นับเฉพาะ session `date < bangkokDate(now)` ที่ไม่ `skipped`
- ตารางสร้าง lazy ด้วย `CREATE TABLE IF NOT EXISTS`; `player_jobs` ห้ามแตะ revision ของ `booking_clubs`
- POST ผ่าน Origin check อยู่แล้ว (router); escape ด้วย `html()` ก่อน `innerHTML`
- ไม่โหลดรูป/ไลบรารีภายนอก; `prefers-reduced-motion` หยุด animation
- ไฟล์เทสใหม่ใส่ใน script `test`; ไฟล์ JS ใหม่ใส่ใน script `build` (`node --check`); `npm run format` ก่อน commit

## Review Focus
- ผู้เล่นถูกลบออกจาก roster แต่มีแถว `attendance` ค้าง → GET ต้องไม่พัง และไม่โชว์ (badge มีเฉพาะคนใน roster) — Task 3
- cron รันซ้ำหลายครั้ง/พลาดหลายวัน → นับครั้งละหนึ่งต่อ (club, date, player) — Task 2
- ชื่อแชมป์ใน Cup ตรงกับ `thai` แทน `name` หรือมีตัวพิมพ์ต่างกัน → ยังนับ (ใช้ `cupPlayerKey`) — Task 3
- POST job ตอน `LINE_MEMBER_AUTH_ENABLED` ปิด หรือ member ยัง pending → 401 ไม่เขียนอะไร — Task 4
- Novice ที่ plays ≥ 5 แต่ยังไม่เลือกสาย ต้องโชว์ภาพ Job ของสายที่สุ่ม (ไม่ใช่ Novice) และ ! เฉพาะเจ้าของ — Task 1 / Task 6

---

### Task 1: กติกาขั้นและสาย (`public/job-rules.js`)

**Files:**
- Create: `public/job-rules.js`
- Create: `test-job-badges.mjs`
- Modify: `package.json` (เพิ่ม `test-job-badges.mjs` ใน `test`, `node --check public/job-rules.js` ใน `build`)

**Interfaces:**
- Produces: `globalThis.SenaJobRules = { LINES, defaultLine(playerId: string): string, jobLevel(plays: number): { lvl: 0|1|2|3, stars: 0..5 } }` และ `module.exports` เมื่อมี `module` (แพตเทิร์นเดียวกับท้าย `public/engine.js`)

- [ ] **Step 1: Write the failing test** — `test-job-badges.mjs` เริ่มด้วย `import './public/job-rules.js'; const R = globalThis.SenaJobRules;`

```js
test('job levels and stars follow the spec boundaries', () => {
  const at = n => R.jobLevel(n);
  assert.deepEqual([0, 4, 5, 14, 15, 29, 30, 59, 60, 89, 90, 180, 999].map(n => [at(n).lvl, at(n).stars]),
    [[0,0],[0,0],[1,0],[1,0],[2,0],[2,0],[3,0],[3,0],[3,1],[3,1],[3,2],[3,5],[3,5]]);
});
test('default line is stable per player and spreads across all five lines', () => {
  assert.deepEqual(R.LINES, ['red', 'green', 'yellow', 'pink', 'blue']);
  assert.equal(R.defaultLine('p1'), R.defaultLine('p1'));
  const seen = new Set(Array.from({ length: 50 }, (_, i) => R.defaultLine('player-' + i)));
  assert.equal(seen.size, 5);
});
```

- [ ] **Step 2: Run** `node --test test-job-badges.mjs` — Expected: FAIL (`Cannot find module` / `R` undefined)
- [ ] **Step 3: Implement** `public/job-rules.js` — `defaultLine`: FNV-1a 32-bit ของ `playerId` แล้ว `% 5`
- [ ] **Step 4: Run** `node --test test-job-badges.mjs` — Expected: PASS
- [ ] **Step 5: Commit** `git add public/job-rules.js test-job-badges.mjs package.json && git commit -m "Add job badge level and line rules"`

### Task 2: บันทึกการมาตีใน cron (`job-badges.js`)

**Files:**
- Create: `job-badges.js`
- Modify: `booking.js:853-855` (`scheduledBookings`)
- Modify: `package.json` (`node --check job-badges.js` ใน `build`)
- Test: `test-job-badges.mjs`

**Interfaces:**
- Consumes: `bangkokDate(now)` จาก `booking.js` (ห้าม import วน: ส่งค่า `today` เข้าไปเป็นพารามิเตอร์แทน), `mutateBooking(env, club, null, now)` คืน `{ doc, players }`
- Produces: `prepareJobTables(db): Promise<void>` (สร้าง `attendance (club TEXT NOT NULL, session_date TEXT NOT NULL, player_id TEXT NOT NULL, PRIMARY KEY (club, session_date, player_id))` และ `player_jobs (club TEXT NOT NULL, player_id TEXT NOT NULL, line TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (club, player_id))`, ห่อด้วย `once()` จาก `schema-cache.js` แบบโมดูลอื่น); `recordAttendance(db, club, doc, players, today: string): Promise<number>` (คืนจำนวนแถวที่เพิ่มใหม่); `scheduledBookings(env, now = new Date())` รับ `now` เพื่อเทส

- [ ] **Step 1: Write the failing tests** (ใช้ fake D1 แบบ `fixture()` ใน `test-booking.mjs` — copy wrapper `DB` มาไว้ในไฟล์นี้)

```js
test('cron records past confirmed roster players once, skipping guests, waitlist, skipped and today', async () => {
  // doc.sessions: {date:'2026-11-10', capacity:2, registrations:[p0, guest(host p0), p1, p2]} → p0,p1 (p2 waitlist, guest not counted)
  //               {date:'2026-11-11', skipped:true, ...p3} → ไม่นับ
  //               {date:'2026-11-13' (= today), ...p4} → ไม่นับ
  //               registration ของ 'gone' (ไม่อยู่ใน roster) → ไม่นับ
  assert.equal(await recordAttendance(db, 'sena', doc, players, '2026-11-13'), 2);
  assert.equal(await recordAttendance(db, 'sena', doc, players, '2026-11-13'), 0);
  assert.deepEqual(rows('SELECT player_id FROM attendance ORDER BY player_id'), ['p0', 'p1']);
});
test('scheduledBookings records attendance for each club separately', async () => {
  // จองผ่าน API ด้วยเวลาที่ session ยังไม่เริ่ม แล้วเรียก scheduledBookings(env, วันถัดไป 01:00 ไทย)
  assert.deepEqual(rows("SELECT club, count(*) n FROM attendance GROUP BY club"), [{ club: 'sena', n: 1 }]);
});
```

- [ ] **Step 2: Run** `node --test test-job-badges.mjs` — Expected: FAIL (`recordAttendance` not exported)
- [ ] **Step 3: Implement** `recordAttendance` (`INSERT OR IGNORE` ทีละแถว รวมผล `meta.changes`) และแก้ `scheduledBookings` ให้ `const { doc, players } = await mutateBooking(env, club, null, now); await recordAttendance(env.DB, club, doc, players, bangkokDate(now));` ต่อก๊วน
- [ ] **Step 4: Run** `npm test` — Expected: PASS ทั้งหมด
- [ ] **Step 5: Commit** `git commit -m "Record nightly attendance for job badges"`

### Task 3: ข้อมูล badge ใน GET `/api/booking`

**Files:**
- Modify: `job-badges.js`
- Modify: `booking.js` (`bookingRoute` ส่วนอ่านข้อมูลคู่กับ `latestCup`, `publicBooking` ใส่ `badge` ใน `roster`)
- Test: `test-job-badges.mjs`

**Interfaces:**
- Consumes: `prepareJobTables`, `SenaJobRules.defaultLine`, `cupPlayerKey(name, club)` จาก `leaderboard.js`, `globalThis.Sena.cupAwards(cup)`, ตาราง cup history ของก๊วน (`clubOf(club).cupTable`, คอลัมน์ `payload`)
- Produces: `badgeData(db, club, players): Promise<Map<playerId, { plays: number, line: string, chosen: boolean, titles: number, latestChamp: boolean }>>`; `publicBooking(..., awards, badges = new Map())` ใส่ `badge` ให้แต่ละคนใน `roster` (คนที่ไม่มีใน Map ได้ `{ plays: 0, line: defaultLine(id), chosen: false, titles: 0, latestChamp: false }`)

- [ ] **Step 1: Write the failing test**

```js
test('booking roster carries plays, chosen or default line and Cup titles', async () => {
  // attendance: p0×6 (+ แถวของ 'gone' ที่ไม่อยู่ใน roster), player_jobs: p0→'pink'
  // cup_history: สอง Cup ที่ 'Player 0' ได้ 🥇 (ครั้งหนึ่งสะกด 'player 0'), Cup ล่าสุด p0 ได้ 🥇
  const data = await (await f.call(null, { owner: null })).json();
  assert.deepEqual(data.roster[0].badge, { plays: 6, line: 'pink', chosen: true, titles: 2, latestChamp: true });
  assert.deepEqual(data.roster[1].badge, { plays: 0, line: R.defaultLine('p1'), chosen: false, titles: 0, latestChamp: false });
  assert.equal(data.roster.length, players.length);
});
```

- [ ] **Step 2: Run** — Expected: FAIL (`badge` undefined)
- [ ] **Step 3: Implement** `badgeData` (3 query ใน `Promise.all`: `SELECT player_id, count(*) n FROM attendance WHERE club=? GROUP BY player_id`, `SELECT player_id, line FROM player_jobs WHERE club=?`, cup history ทั้งหมด → นับ 🥇 ต่อ `cupPlayerKey`, จับคู่ผู้เล่นด้วย `name` หรือ `thai`) และเรียกใน `bookingRoute` คู่กับ `latestCup` ใน `Promise.all` เดิม; `latestChamp` = award ของ Cup ล่าสุด (Map `awards` ที่มีอยู่) เป็น `'🥇'`
- [ ] **Step 4: Run** `npm test` — Expected: PASS (รวมเทส award เดิมใน `test-booking.mjs`)
- [ ] **Step 5: Commit** `git commit -m "Expose job badge data in booking roster"`

### Task 4: POST `action: 'job'` เปลี่ยนสาย

**Files:**
- Modify: `job-badges.js`, `booking.js` (`bookingRoute`: รายการ action ที่รู้จัก และจัดการก่อน `mutateBooking`)
- Test: `test-job-badges.mjs`

**Interfaces:**
- Consumes: `bookingRoute(req, env, admin, club, member)` (เทสเรียกตรงด้วย `member = { link: { status: 'approved', player_id: 'p0' } }` และ `env.LINE_MEMBER_AUTH_ENABLED = 'true'`), `memberMode(env)`
- Produces: `setJobLine(db, club, playerId, line): Promise<void>` (upsert `player_jobs`); response เป็น view ปกติของ `/api/booking` พร้อม `result: { message: 'เปลี่ยนสายแล้ว' }`

- [ ] **Step 1: Write the failing test**

```js
test('approved members change only their own line without touching the booking revision', async () => {
  const before = revision();
  const res = await route({ action: 'job', line: 'blue' }, approved('p0'));
  assert.equal(res.status, 200);
  assert.equal((await res.json()).roster[0].badge.line, 'blue');
  assert.equal(revision(), before);
  assert.equal((await route({ action: 'job', line: 'purple' }, approved('p0'))).status, 400);
  assert.equal((await route({ action: 'job', line: 'red' }, { link: { status: 'pending', player_id: 'p0' } })).status, 401);
  assert.equal((await route({ action: 'job', line: 'red' }, null)).status, 401);
  assert.deepEqual(rows('SELECT player_id, line FROM player_jobs'), [{ player_id: 'p0', line: 'blue' }]);
});
```

- [ ] **Step 2: Run** — Expected: FAIL (`ไม่พบคำสั่ง` 400 for the first call)
- [ ] **Step 3: Implement** — `line` ไม่อยู่ใน `SenaJobRules.LINES` → `fail('สายไม่ถูกต้อง')`; ไม่ใช่ member approved → `fail('กรุณาเข้าสู่ระบบ LINE และผูกชื่อก่อน', 401)`; เขียนแล้ววิ่งต่อด้วย `mutateBooking(env, club, null, now)` ตามเส้นทาง GET
- [ ] **Step 4: Run** `npm test` — Expected: PASS
- [ ] **Step 5: Commit** `git commit -m "Let members choose their job line"`

### Task 5: ชุดภาพ badge (`public/job-badges.js`, `public/job-badges.css`)

**Files:**
- Create: `public/job-badges.js`, `public/job-badges.css`
- Modify: `package.json` (`node --check public/job-badges.js`)
- Test: `test-job-badges.mjs`

**Interfaces:**
- Consumes: `globalThis.SenaJobRules`
- Produces: `globalThis.SenaJobs = { JOBS, jobName(badge): string, jobThai(badge): string, badgeHtml(badge, size: number, { mine = false } = {}): string, defsHtml(): string }` — `badge` คือ object จาก Task 3; `JOBS` = ตารางชื่อจาก spec (key ตาม `LINES`, `jobs: [[en, th] ×3]`, `th` ชื่อสาย, `color`); Novice = `{ en: 'Novice', th: 'มือใหม่' }`. ยก SVG จาก mockup ส่วน job style ทั้งหมด (รวม Weapon Dealer ที่ดาบคมปักลง) ส่วน `<defs>` เอาเฉพาะ id ที่ job style ใช้ โดยเติม prefix `jb-` ให้ทุก id (กันชนกับ id อื่นในหน้า); `!` ขึ้นเมื่อ `mine && !badge.chosen && jobLevel(plays).lvl >= 1`; มงกุฎเมื่อ `titles > 0` (เรืองแสงเมื่อ `latestChamp`); ดาวตาม `jobLevel().stars`
- CSS ยกจาก mockup: `.pip`, `.ready`, `.stars`, `.pulse`, `.bob`, `.blink`, `.beat`, `.rise`, `.tw` + keyframes + `prefers-reduced-motion` โดยเติม prefix `jb-` ให้ทุก class/keyframe

- [ ] **Step 1: Write the failing test** (`import './public/job-badges.js'` ใน Node ได้เพราะไม่แตะ DOM ตอนโหลด)

```js
test('badge markup reflects level, line, crown, stars and own-only ready marker', () => {
  const J = globalThis.SenaJobs;
  const b = (o = {}) => ({ plays: 0, line: 'red', chosen: false, titles: 0, latestChamp: false, ...o });
  assert.match(J.badgeHtml(b(), 35), /aria-label="Novice"/);
  assert.equal(J.jobName(b({ plays: 30, line: 'blue' })), 'Weapon Dealer');
  assert.equal(J.jobName(b({ plays: 15, line: 'yellow' })), 'Drifter');
  assert.match(J.badgeHtml(b({ plays: 95 }), 35), /★★/);
  assert.doesNotMatch(J.badgeHtml(b({ plays: 6 }), 35), /jb-ready/);
  assert.match(J.badgeHtml(b({ plays: 6 }), 35, { mine: true }), /jb-ready/);
  assert.match(J.badgeHtml(b({ titles: 3, latestChamp: true }), 35), /jb-pip jb-fresh[\s\S]*>3</);
  assert.match(J.badgeHtml(b({ plays: 1, line: '<x>' }), 35), /Novice/);
});
```

- [ ] **Step 2: Run** — Expected: FAIL
- [ ] **Step 3: Implement** ตาม Interfaces (สายที่ไม่รู้จักถือเป็น Novice)
- [ ] **Step 4: Run** `npm test && npm run build` — Expected: PASS
- [ ] **Step 5: Commit** `git commit -m "Add job badge artwork module"`

### Task 6: ใช้ badge ในการ์ดจอง + แผ่นเลือกสาย

**Files:**
- Modify: `public/booking.js` (~บรรทัด 60–70 `name()` ตัด 🥇 ออก คง 💩; ~510 แทน `booking-avatar`; `<small>` เติมชื่อ job; ตัวจัดการคลิก badge ของตัวเอง)
- Modify: `public/booking.css` (สไตล์แผ่นเลือกสาย + ขนาด `.jb-badge` 35px, มือถือ 32px ถ้าการ์ดแคบ)
- Modify: `public/court.html` (โหลด `job-rules.js`, `job-badges.js`, `job-badges.css` ก่อน `booking.js`, bump `?v=` ของ `booking.js`/`booking.css`)

**Interfaces:**
- Consumes: `SenaJobs.badgeHtml/defsHtml/JOBS/jobName`, `data.member.playerId`, `request(body)` ที่มีอยู่ใน `public/booking.js`
- Produces: ปุ่ม badge ของตัวเอง (`<button type="button" class="jb-own" data-job-pick>`), แผ่น `<dialog id="jobPicker">` 5 ปุ่ม `data-job-line="<line>"` แต่ละปุ่มมีรูป Job 1 ของสายนั้น + ชื่อ `th` + ชื่อ Job 1 อังกฤษ; ส่ง `request({ action: 'job', line })` แล้ว render ใหม่จาก response

- [ ] **Step 1: Implement** — ใส่ `defsHtml()` ลงหน้าครั้งเดียวตอนเริ่ม; badge ของ `r.playerId` ที่ไม่ใช่แขก (แขกใช้ badge Novice ที่ `plays: 0`, ไม่มีชื่อ job ใน `<small>`)
- [ ] **Step 2: Verify ในเครื่อง** — ตาม HANDOFF: `.dev.vars` (`ADMIN_KEY=test-key`, `LINE_MEMBER_AUTH_ENABLED=false`), `npx wrangler d1 execute DB --local --file=schema.sql`, `npx wrangler dev --local --compatibility-date 2026-05-22 --port 8799`, ใส่แถว `attendance` จำลองด้วย `wrangler d1 execute --local`, Playwright เปิด `/court` ที่ 420px ถ่ายภาพการ์ดจอง — Expected: เห็น badge ระดับต่างๆ, มงกุฎ, ดาว, ไม่มี error ใน console; ทดสอบแผ่นเลือกสายด้วยการจำลอง `data.member` (ล็อกอิน LINE จริงทดสอบไม่ได้)
- [ ] **Step 3: Run** `npm test && npm run build && npm run format:check` — Expected: PASS
- [ ] **Step 4: Commit** `git commit -m "Show job badges in booking card and add line picker"`

### Task 7: เอกสารและส่งต่อ

**Files:**
- Modify: `HANDOFF.md`, `BOOKING.md` (หัวข้อสั้น: กติกา badge, ตาราง `attendance`/`player_jobs`, cron), spec (สถานะ → ทำแล้วบน branch)

- [ ] **Step 1:** เขียนเอกสาร (HANDOFF ≤ ~40 บรรทัด ตามกติกาในไฟล์)
- [ ] **Step 2: Run** `npm test && npm run build && npm run format:check` — Expected: PASS
- [ ] **Step 3: Commit + push** `git push -u origin claude/bold-dijkstra-s6qjbu` (ไม่ merge main จนกว่าเจ้าของสั่ง)
