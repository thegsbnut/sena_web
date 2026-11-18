# Morning Bill Nudge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** First plain text message in a linked LINE group each day (after 06:00 Thai) makes Badbot post the open-bills reminder once, using the free Reply API.

**Architecture:** New `line-nudge.js` (day rule, per-group-per-day claim row in D1, `morningNudge`). `lineWebhook`'s background loop sends non-command events to `morningNudge`; command events go to `replyToGroupCommand` as before, which now returns `'bill'` when it answered a bill so the day is marked done. The message itself is `billingLineMessages` (same as `badbot bill`).

**Tech Stack:** Cloudflare Worker, D1 (mocked with `node:sqlite` in tests), `node --test`.

**Spec:** `docs/superpowers/specs/2026-11-18-morning-bill-nudge-design.md`

## Global Constraints

- Reply API only (`https://api.line.me/v2/bot/message/reply`); never Push.
- Day starts 06:00 `Asia/Bangkok`; messages before 06:00 never trigger.
- One reminder per **group** per Thai day, even if the group is linked to both clubs (`sena`, `88`).
- Tables are created lazily with `CREATE TABLE IF NOT EXISTS`; rows older than 7 days pruned on claim.
- Do not touch the command-reply path other than the single return value described in Task 2.
- Tests go in `test-line-reply.mjs` (reuse `billFixture`, `fixture`); no new test file, so `package.json` is unchanged.
- Run `npm run format` before committing; `npm test` and `npm run build` must pass.
- Commit messages in English, end with the attribution lines from the session reminder.

## Review Focus

- Two messages arriving at the same instant → exactly one reminder (claim race).
- Message at 05:59 Thai ignored; at 06:00 triggers.
- LINE rejects/fails the reply (500) → claim released; next message retries.
- No open bills → silent and unclaimed; a bill opened later the same day is reminded on the next message.
- Unlinked group, sticker/image, `mode: 'standby'` → nothing, and no row written.
- `LINE_MEMBER_AUTH_ENABLED` off (`billingLineMessages` returns null) → silent, unclaimed.
- Group linked to both clubs → one reply covering both; group linked to one club → only that club's bills.

---

### Task 1: Day rule and claim storage

**Files:**
- Create: `line-nudge.js`
- Test: `test-line-reply.mjs` (append)

**Interfaces:**
- Produces (all exported from `line-nudge.js`):
  - `nudgeDay(timestamp: number): string | null` — `'YYYY-MM-DD'` (Thai date, use `bangkokDate` from `booking.js`) when the Thai hour is ≥ 6, else `null`. Hour via `Intl.DateTimeFormat` with `timeZone: 'Asia/Bangkok'` as `line-reply.js` does.
  - `claimNudge(env, group: string, day: string, now = Date.now()): Promise<boolean>` — creates table `line_daily_nudges (group_id TEXT NOT NULL, day TEXT NOT NULL, claimed_at INTEGER NOT NULL, PRIMARY KEY (group_id, day))`, prunes rows with `claimed_at < now - 7 days`, `INSERT OR IGNORE`, returns `meta.changes > 0`.
  - `releaseNudge(env, group: string, day: string): Promise<void>` — deletes that row.

- [ ] **Step 1: Write failing tests** (using `fixture(t)` for `env`/`db`)
  - `nudgeDay`: `Date.parse('2026-11-18T05:59:00+07:00')` → `null`; `'2026-11-18T06:00:00+07:00'` → `'2026-11-18'`; `'2026-11-18T23:59:00+07:00'` → `'2026-11-18'`; `'2026-11-18T00:30:00+07:00'` → `null`.
  - `claimNudge` twice for same group/day → `true` then `false`; different day or different group → `true`.
  - After `releaseNudge`, `claimNudge` → `true` again.
  - A row inserted with `claimed_at = Date.now() - 8*86400000` is gone after any `claimNudge`.
- [ ] **Step 2: Run** `node --test test-line-reply.mjs` — Expected: FAIL (module missing).
- [ ] **Step 3: Implement** the three functions in `line-nudge.js`.
- [ ] **Step 4: Run** `node --test test-line-reply.mjs` — Expected: PASS.
- [ ] **Step 5: Commit** `feat: day rule and claim storage for the morning bill nudge`

---

### Task 2: morningNudge wired into the webhook

**Files:**
- Modify: `billing.js` (`billingLineMessages` ~line 1277), `line-reply.js` (exports; end of `replyToGroupCommand`), `line.js` (`replyAll`), `line-nudge.js`
- Test: `test-line-reply.mjs` (append)

**Interfaces:**
- Consumes: Task 1 functions.
- Produces:
  - `billing.js`: `billingLineMessages(env, scope, origin, groupId, diagnostics, { tagsFrom, rosterOf, quietIfEmpty })` — when `quietIfEmpty` is true and there are no open bills, return `[]` instead of the "✅ ไม่มีบิลค้าง" text. Default behavior unchanged.
  - `line-reply.js`: export `groupCommand` (the existing `command(event)`), `siteOrigin`, `rosterOf` (existing helpers, just exported). `replyToGroupCommand` returns `'bill'` when the Reply API answered `response.ok` and `action.kind === 'bill' || notice?.kind === 'bill'`; otherwise `undefined` as today.
  - `line-nudge.js`: `recordNudged(env, group: string, timestamp: number): Promise<void>` — `nudgeDay`; if non-null, `claimNudge` (ignore result). `morningNudge(event, env): Promise<void>`.
  - `line.js` `replyAll`: for each event, `const action = groupCommand(event)`; if `action` → `const answered = await replyToGroupCommand(event, env)`; `if (answered === 'bill') await recordNudged(env, event.source.groupId, event.timestamp ?? Date.now())`; else → `await morningNudge(event, env)`. Existing try/catch/`logError` stays.

`morningNudge` rules, in order: ignore unless `event.type === 'message'`, `event.message?.type === 'text'`, `event.source?.type === 'group'`, `event.replyToken` set, `event.mode !== 'standby'`, `env.LINE_CHANNEL_ACCESS_TOKEN` set; `day = nudgeDay(event.timestamp ?? Date.now())` non-null; clubs = `SELECT club FROM line_groups WHERE group_id=?` (none → return); scope = `'all'` if both clubs else that club; `claimNudge` false → return; build `billingLineMessages(env, scope, siteOrigin(env), group, [], { rosterOf: rosterOf(env), quietIfEmpty: true })`; null or empty → `releaseNudge`, return; POST the Reply API (`notificationDisabled: false`, 10 s timeout); on HTTP 400 retry once with `messages.map(flexFallback)`; if still not ok or network error → `releaseNudge`, `logError('line-nudge:send', …)`, throw. Any exception while building messages also releases the claim.

- [ ] **Step 1: Write failing tests** using `billFixture(t)` with `event('สวัสดี', { timestamp })` where `timestamp = Date.parse(future(0) + 'T08:00:00+07:00')`:
  - `morning nudge: first plain message gets one bill reply`: `f.calls.length === 1`, `messages[0].type === 'flex'`, reply token equals the event's; second plain message same day → still 1 call.
  - `morning nudge: two simultaneous messages send one reminder`: `Promise.all([f.hook([e1]), f.hook([e2])])` → 1 call.
  - `morning nudge: ignored before 06:00 Thai`: timestamp `…T05:59:00+07:00` → 0 calls, no row in `line_daily_nudges`; `…T06:00:00+07:00` → 1 call.
  - `morning nudge: next Thai day reminds again`: timestamps on `future(0)` and `future(1)` → 2 calls.
  - `morning nudge: silent without open bills`: bill row removed → 0 calls, no row; after re-inserting the bill, the next message → 1 call.
  - `morning nudge: failed reply is retried by the next message`: `f.replyStatus(500)` → `hook` returns 200 (no ctx → check status via the existing no-ctx path: expect 503) and row released; `f.replyStatus(200)`; next message → one successful call.
  - `morning nudge: ignores stickers, standby events and unlinked groups`: event with `message: { type: 'sticker' }`; `mode: 'standby'`; `source.groupId` of a group not in `line_groups` → 0 calls, no row.
  - `morning nudge: command first does not consume the day`: `badbot list` then plain text → 2 calls total, second is the bill card.
  - `morning nudge: badbot bill counts as the reminder`: `badbot bill` then plain text → only the first call.
  - `morning nudge: group linked to both clubs sends one reply for both`: also link `'88'` to `group` (insert into `line_groups`) with an open 88 bill → single call whose card mentions both club names; with only sena linked, an open 88 bill is not in the reply.
  - `morning nudge: member auth off stays silent`: `f.env.LINE_MEMBER_AUTH_ENABLED = 'false'` → 0 calls, no row.
- [ ] **Step 2: Run** `node --test test-line-reply.mjs` — Expected: new tests FAIL, existing pass.
- [ ] **Step 3: Implement** the interfaces above in `billing.js`, `line-reply.js`, `line-nudge.js`, `line.js`.
- [ ] **Step 4: Run** `npm test && npm run build && npm run format:check` — Expected: all PASS.
- [ ] **Step 5: Commit** `feat: Badbot reminds open bills on the first message of the morning`

---

### Task 3: Docs and handoff

**Files:**
- Modify: `BADBOT-REPLY.md` (append a bullet at the end), `HANDOFF.md`, `CLAUDE.md` (module table row for `line-nudge.js`)

- [ ] **Step 1: Document** in `BADBOT-REPLY.md`: trigger rule (first plain text message after 06:00 Thai, once per group per Thai day, Reply API only), `line_daily_nudges`, commands don't consume the day except bill answers, silent when nothing is owed. Add the `line-nudge.js` row to the `CLAUDE.md` module table. Add a top "อัปเดตล่าสุด" entry in `HANDOFF.md` (not yet tried in real LINE: check that the first morning message produces the card with tags, and that a group linked to both clubs gets one message); trim the oldest history line so history stays ≤ 5.
- [ ] **Step 2: Run** `npm run format:check && npm test && npm run build` — Expected: PASS.
- [ ] **Step 3: Commit** `docs: morning bill nudge`
