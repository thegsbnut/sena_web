# บิลอื่นๆ (Custom Bills) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ผู้จัดหรือสมาชิกที่ผูก LINE สร้างบิลที่ไม่ผูกกับรอบตีแบด (เช่นค่าข้าว) หารได้ 3 แบบ มี guest ที่รวมยอดกับสมาชิก แล้วเก็บเงินผ่านระบบบิลเดิมทั้งหมด

**Architecture:** บิลประเภทใหม่เก็บในตาราง `bills` เดิม (`payload.kind = 'custom'`, `session_date = '<YYYY-MM-DD>/<32hex>'` แบบบิลเพิ่มเติม) แต่ `payers[]` มีรูปเดียวกับบิลตีแบด ทุกอย่างหลังสร้าง (QR, สลิป, เงินสด, แจ้งกลุ่ม, Badbot) จึงทำงานต่อได้ การคำนวณอยู่ในไฟล์ pure `public/custom-split.js` ใช้ทั้งเบราว์เซอร์และ Worker สิทธิ์จัดการบิลขยายจาก "ผู้จัด" เป็น "ผู้จัด หรือคนสร้างบิลนี้"

**Tech Stack:** Cloudflare Worker + D1, vanilla JS (ไม่มี bundler), `node --test` + `node:sqlite` จำลอง D1

**Spec:** `docs/superpowers/specs/2026-11-16-custom-bills-design.md` (อ่านก่อน — การตัดสินใจของเจ้าของอยู่ในนั้น)

## Global Constraints
- อ่าน `CLAUDE.md` และ `HANDOFF.md` ก่อน; ข้อความที่ผู้ใช้เห็นเป็นภาษาไทย
- เงินเป็น **สตางค์ (integer)** ทุกที่ในหลังบ้าน; แสดงผลด้วย `money()` เดิม
- ทุกการเขียนบิลผ่าน `updateBill()` เดิม (optimistic `WHERE revision=?`, ตอบ 409 เมื่อชน)
- POST ทุกตัวผ่านการเช็ก Origin เดิมของ worker (ไม่ต้องเพิ่มอะไร แต่ห้ามข้าม)
- frontend: escape ทุกข้อความก่อนใส่ `innerHTML` (ใน `public/billing.js` คือ `escape()`)
- **ผล AI (`aiCheck`, action `slip-check`) เห็น/ใช้ได้เฉพาะ `admin` จริง** ห้ามส่งให้คนสร้างบิลที่ไม่ใช่ผู้จัด
- ข้อจำกัดตาม spec: ชื่อบิล 1–40, คน 2–40, รายการ 1–30 (ชื่อ ≤ 40), ยอดรวม 100–10,000,000 สตางค์, วันที่ [วันนี้−30, วันนี้+1] เวลาไทย, สมาชิกมีบิล custom ค้าง ≤ 5
- ห้ามแตะพฤติกรรมบิลตีแบดเดิม (`readDraft`/`splitBill`/บิลเพิ่มเติม) — เทสเดิม 227 ตัวต้องผ่านทั้งหมด
- เพิ่มไฟล์เทสใหม่ใน script `test` ของ `package.json`; เพิ่มไฟล์ JS ใหม่ฝั่ง Worker ใน script `build` (`node --check`)
- เปลี่ยนไฟล์ใน `public/` ต้องเปลี่ยน `?v=` ใน `billing.html` ด้วย
- `npm run format` ก่อนทุก commit; commit เล็กๆ ต่อ task; push ขึ้น branch ที่ทำงาน ห้าม merge เข้า `main`

## Review Focus
1. **สมาชิกคนอื่นแอบจัดการบิลที่ไม่ใช่ของตัวเอง** — สมาชิก B ส่ง `action=cash`/`edit`/`cancel` หรือ GET `?bill=` เพื่อดูทุกแถวของบิลที่ A สร้าง ต้องได้ 401/403 และเห็นแค่แถวของตัวเอง (Task 3)
2. **ปลอม `payerKey`** — สมาชิกส่ง `people:[{payerKey:'member:ไม่มีอยู่จริง'}]` หรือชื่อที่ไม่ตรง roster: ต้องปฏิเสธ; ชื่อสมาชิกในบิลต้องมาจาก roster ฝั่งเซิร์ฟเวอร์เสมอ ไม่ใช่จาก client (Task 2)
3. **แถวของคนรับเงินที่เป็น `paid/owner` ทำให้แก้บิลไม่ได้** — เช็ก "มีคนจ่ายแล้ว" ต้องไม่นับ `method:'owner'` ทั้งใน `editable` และ action `edit` (Task 3)
4. **ปัดเศษ/ยอดรวมเพี้ยน** — หาร 1,000 บาท 3 คน, ใส่เองมีเศษสตางค์, รายการเดียวหารคนเดียว, guest ของคนรับเงิน: ผลรวม share = total พอดี และ `amount` ต่อแถว = ceil เป็นบาท (Task 1)
5. **ป้าย "บิลเพิ่มเติม" โผล่บนบิล custom** — `session_date.length > 10` ใช้อยู่ 5 จุด ต้องเปลี่ยนเป็น `billTag()` ทุกจุด และ `summary.additional` ต้องเป็น false สำหรับ custom (Task 2)

---

### Task 1: ตัวคำนวณ `public/custom-split.js`

**Files:**
- Create: `public/custom-split.js`
- Create: `test-custom-bill.mjs`
- Modify: `package.json` (เพิ่ม `test-custom-bill.mjs` ใน `test`, เพิ่ม `public/custom-split.js` ใน `build`)

**Interfaces:**
- Produces: `globalThis.SenaCustomSplit.split(draft)` (รูปแบบ IIFE เหมือน `public/engine.js`; Worker ใช้ `import './public/custom-split.js'`)
  - `draft = { mode: 'even'|'manual'|'items', people: Person[], total?: number, amounts?: number[], items?: {name: string, price: number, people: number[]}[], receiver: string }`
  - `Person = { name: string, payerKey: string, guest?: boolean }` — guest ใช้ `payerKey` ของสมาชิกเจ้าของ; ลำดับใน `people` = ลำดับเศษสตางค์; `amounts[i]`/`items[].people` อ้าง index ใน `people`
  - คืน `{ total: number, payers: { payerKey, name, shares: {name, amount}[], amount, owner: boolean }[] }` หรือ `{ error: string }` (ข้อความไทย)
  - `name` ของแถว = ชื่อของ Person ที่ไม่ใช่ guest ที่มี `payerKey` นั้น; `owner = payerKey === receiver`; `amount = Math.ceil(sum(shares)/100)*100`
  - แถวที่ sum = 0 และไม่ใช่ owner ไม่ต้องคืน

- [ ] **Step 1: เขียนเทสที่ล้ม** ใน `test-custom-bill.mjs` (`import './public/custom-split.js'; const { split } = globalThis.SenaCustomSplit;`)

```js
const A = { name: 'Nut', payerKey: 'member:1' }, B = { name: 'Bua', payerKey: 'member:2' },
  C = { name: 'Pim', payerKey: 'member:3' }, G = { name: 'บอส', payerKey: 'member:2', guest: true };
test('even: 1000 บาท 3 คน → share รวมเท่ายอด, แถวปัดขึ้นบาท', () => {
  const r = split({ mode: 'even', people: [A, B, C], total: 100000, receiver: 'member:1' });
  assert.equal(r.total, 100000);
  assert.deepEqual(r.payers.map(p => p.shares[0].amount), [33334, 33333, 33333]);
  assert.deepEqual(r.payers.map(p => p.amount), [33400, 33400, 33400]);
  assert.deepEqual(r.payers.map(p => p.owner), [true, false, false]);
});
test('guest รวมยอดเข้าแถวสมาชิกเจ้าของ', () => {
  const r = split({ mode: 'even', people: [A, B, G], total: 90000, receiver: 'member:1' });
  assert.equal(r.payers.length, 2);
  const bua = r.payers.find(p => p.payerKey === 'member:2');
  assert.equal(bua.name, 'Bua');
  assert.deepEqual(bua.shares, [{ name: 'Bua', amount: 30000 }, { name: 'บอส', amount: 30000 }]);
  assert.equal(bua.amount, 60000);
});
test('manual: ยอดเองมีเศษสตางค์ → ปัดขึ้นต่อแถว, ยอด 0 ไม่มีแถว (ยกเว้นคนรับเงิน)', () => {
  const r = split({ mode: 'manual', people: [A, B, C], amounts: [0, 12050, 0], receiver: 'member:1' });
  assert.equal(r.total, 12050);
  assert.deepEqual(r.payers.map(p => [p.payerKey, p.amount]), [['member:1', 0], ['member:2', 12100]]);
});
test('items: แต่ละรายการแบ่งเฉพาะคนในรายการ', () => {
  const r = split({ mode: 'items', people: [A, B, C], receiver: 'member:1', items: [
    { name: 'หมูกระทะ', price: 90000, people: [0, 1, 2] }, { name: 'เบียร์', price: 30001, people: [0, 1] }] });
  assert.equal(r.total, 120001);
  assert.deepEqual(r.payers.map(p => p.shares[0].amount), [45001, 45000, 30000]);
});
test('ข้อผิดพลาด: คนไม่อยู่ในรายการไหน, ไม่มีคนจ่ายนอกจากคนรับเงิน, คนรับเงินเป็น guest', () => {
  assert.match(split({ mode: 'items', people: [A, B, C], receiver: 'member:1',
    items: [{ name: 'x', price: 100, people: [0, 1] }] }).error, /Pim/);
  assert.ok(split({ mode: 'manual', people: [A, B], amounts: [500, 0], receiver: 'member:1' }).error);
  assert.ok(split({ mode: 'even', people: [A, B], total: 100, receiver: 'member:9' }).error);
});
```

- [ ] **Step 2:** `node --test test-custom-bill.mjs` → FAIL (`SenaCustomSplit` undefined)
- [ ] **Step 3:** เขียน `public/custom-split.js` ตาม Interfaces; ตรวจขอบเขตตาม Global Constraints (คน 2–40, รายการ 1–30, ชื่อรายการ 1–40, ราคา integer ≥ 1, `amounts` integer ≥ 0 ยาวเท่า `people`, index ในรายการถูกต้องและไม่ซ้ำ, total 100–10,000,000, `receiver` ต้องเป็น payerKey ของ Person ที่ไม่ใช่ guest) — เศษสตางค์: `floor(price/n)` + 1 ให้ `price % n` คนแรก **ตามลำดับใน `people`** (ไม่ใช่ลำดับใน `items[].people`)
- [ ] **Step 4:** `node --test test-custom-bill.mjs` → PASS; `npm test` ผ่านทั้งหมด; `npm run build` ผ่าน
- [ ] **Step 5:** `npm run format` แล้ว commit `feat(bills): custom bill split calculator`

---

### Task 2: สร้างบิล custom ฝั่ง Worker + ป้ายชื่อบิล

**Files:**
- Modify: `member.js` (export helper), `billing.js` (route + labels), `test-custom-bill.mjs`

**Interfaces:**
- Consumes: `SenaCustomSplit.split` (Task 1)
- Produces:
  - `member.js`: `export async function approvedMembers(db, club): Promise<{playerId, userId, name}[]>` — `member_links` ที่ `status='approved'` ของก๊วน, `name` จาก roster ปัจจุบัน (แบบเดียวกับ action `requests`) fallback `member_links.name`
  - `GET /api/billing?action=people&club=` → `{ members: [{payerKey:'member:<id>', name}], me: 'member:<id>'|null }` เรียงชื่อด้วย `localeCompare(_, 'th')`; อนุญาต admin หรือสมาชิก approved (`memberFor`) ไม่งั้น 401
  - `POST /api/billing?action=custom&club=` body `{ title, date, transfer, receiver, mode, people: ({payerKey}|{name, guestOf})[], total?, amounts?, items? }` → 200 `{ id, existing:false, notice }` (เหมือนเปิดบิลปกติ) หรือ 400/401/409 `{error}`
  - payload ที่เก็บ: `{ kind:'custom', title, mode, total, transfer, people:<จำนวนคน>, receiver, createdBy:{userId|null, name}, draft:<body ที่ normalize แล้ว>, items?:[{name, price, names:string[]}], payers }` — `payers[i] = { id, token, payerKey, name, shares, amount, status }` เหมือน `splitBill`; แถว owner: `status:'paid', method:'owner', paidAt:<ISO now>`
  - `billTag(bill): string` ใน `billing.js` — custom → `bill.title`; บิลเพิ่มเติม (`session_date.length > 10` และไม่ใช่ custom) → `'บิลเพิ่มเติม'`; อื่นๆ `''`
  - `summary()` เพิ่ม `kind`, `title` (custom เท่านั้น) และ `additional` เป็น false สำหรับ custom

- [ ] **Step 1: เขียนเทสที่ล้ม** — คัด fixture จาก `test-member.mjs` (บรรทัด ~1–130: D1 จำลอง, LINE verify จำลอง, `login(user)`, `admin()`) มาไว้ต้นไฟล์ แล้วผูกผู้ใช้ 3 คนเป็นสมาชิก approved ของ `sena` เทส:
  - `custom bill: สมาชิกสร้างได้ ชื่อจาก roster แถวคนรับเงินเป็น paid/owner` — POST หาร even 3 คน + guest ของคนที่ 2, ตรวจ 200, อ่านแถวจาก D1: `kind==='custom'`, `session_date` ตรง `/^\d{4}-\d{2}-\d{2}\/[a-f0-9]{32}$/`, ชื่อแถวตรง roster แม้ client ส่ง `name` อื่นมากับ `payerKey`, แถว receiver `status==='paid' && method==='owner'`, `notice` ไม่ว่าง
  - `custom bill: ปฏิเสธ payerKey ที่ไม่ใช่สมาชิก, guestOf ที่ไม่อยู่ในบิล, receiver เป็น guest, ไม่ล็อกอิน (401), ชื่อบิลยาว 41 ตัว, วันที่ 31 วันก่อน`
  - `custom bill: สมาชิกมีบิลค้างได้ 5 ใบ ใบที่ 6 ได้ 409; ผู้จัดไม่จำกัด`
  - `custom bill: action=people คืนสมาชิก approved และ me`
  - `custom bill: ป้ายใช้ชื่อบิลแทน "บิลเพิ่มเติม"` — `notice.text` (หรือฟิลด์ข้อความของ notice) มี title, ไม่มี `บิลเพิ่มเติม`; `GET /api/billing` (admin list) แถวนั้น `additional===false`, `title` ตรง; `billingLineText` ของก๊วนมี title
- [ ] **Step 2:** `node --test test-custom-bill.mjs` → FAIL
- [ ] **Step 3:** ทำ `approvedMembers` ใน `member.js`
- [ ] **Step 4:** ใน `billingRoute` ก่อนบล็อก `if (!id) { if (!admin) ... }` (`billing.js:448`) เพิ่มทาง `action === 'people'` (GET) และ `action === 'custom'` (POST) ที่อนุญาต admin หรือ `memberFor(req, env, club)` ที่ `link.status==='approved'` — normalize body: สมาชิก → `{ name: <roster>, payerKey }`, guest → `{ name: clean(name) ≤ 40, payerKey: guestOf, guest:true }` (`guestOf` ต้องเป็นสมาชิกที่อยู่ใน `people` ด้วย, ชื่อซ้ำในบิลเดียว = error), `transfer` ตาม `promptPayPattern`, วันที่ใช้ `validDate` + ช่วงเวลาไทย, นับบิลค้างของผู้สร้างด้วย `json_extract(payload,'$.createdBy.userId')=? AND closed_at IS NULL AND COALESCE(json_extract(payload,'$.cancelled'),0)=0`; เรียก `split`, สร้าง `payers` ด้วย `randomId()`/`token()`, `INSERT` แบบเดียวกับบิลเพิ่มเติม (`dateKey = date + '/' + randomId()`), ตอบด้วย `openedNotice` · `import './public/custom-split.js'` ที่หัวไฟล์
- [ ] **Step 5:** เพิ่ม `billTag` แล้วแทน `session_date.length > 10` ทั้ง 5 จุด (`summary`, `billLabel`, ข้อความบิลค้าง ~`:1011`, ข้อความแท็ก ~`:1176`, การ์ด `extra` ~`:1199`) ให้ผลกับบิลเดิมเหมือนเดิมทุกตัวอักษร; `billView` ส่ง `kind, title, mode, items, receiver` เพิ่มเมื่อเป็น custom
- [ ] **Step 6:** `node --test test-custom-bill.mjs` → PASS; `npm test` ทั้งหมดผ่าน; `npm run build` ผ่าน
- [ ] **Step 7:** format + commit `feat(bills): create custom bills (members or organizer)`

---

### Task 3: สิทธิ์คนสร้างบิล + แก้บิล custom

**Files:**
- Modify: `billing.js`, `test-custom-bill.mjs`

**Interfaces:**
- Consumes: payload `createdBy`, `draft`, แถว owner (Task 2)
- Produces:
  - ใน `billingRoute` ต่อจาก `const member = memberMode(env) ? await memberFor(...) : null` (`billing.js:559`): `const manager = admin || (bill.kind === 'custom' && Boolean(member) && bill.createdBy?.userId === member.userId)` (ถ้าปิดโหมดสมาชิก คนสร้างที่ไม่ใช่ผู้จัดจะจัดการไม่ได้ — ยอมรับ)
  - `billView(bill, admin, payer, manager)` → เมื่อ `manager` ให้มุมมองเต็มแบบผู้จัด (`revision`, `editable`, `canUndoCash`, ทุกแถว, `token`/`payerKey`) และเพิ่ม `viewer: admin ? 'admin' : 'creator'`; `aiCheck` เติมเฉพาะ `admin`
  - `editable` และ action `edit`: "มีคนจ่ายแล้ว" = `p.method !== 'owner' && (p.submittedAt || p.status === 'paid')`
  - action `edit` ของบิล custom: body แบบเดียวกับ `action=custom` (ยกเว้น `date`/`title` เปลี่ยนได้แค่ `title`) + `revision`; คำนวณใหม่ด้วย `split`, คง `id`/`token` เดิมตาม `payerKey` (แบบ `splitBill(draft, existing)`), แถว owner ใหม่เป็น paid/owner; ข้อความแจ้ง `✏️ บิล <billLabel> แก้ยอดแล้ว · …` แบบเดิม

- [ ] **Step 1: เขียนเทสที่ล้ม:**
  - `creator manages own custom bill` — A สร้าง; A `GET ?bill=` เห็นทุกแถว + `viewer==='creator'` + ไม่มี `aiCheck`; A `cash` แถวของ B ได้ 200; A `review` reject สลิปได้; A `cancel`/`restore` ได้
  - `other members cannot manage` — B (อยู่ในบิล) `GET ?bill=` เห็นแถวตัวเองแถวเดียว ไม่มี `revision`; B `cash`/`edit`/`cancel` ได้ 401; C (ไม่อยู่ในบิล) เหมือนกัน; A ใช้ `action=slip-check` ได้ 401; A กับบิลตีแบดของผู้จัด → ไม่มีสิทธิ์จัดการ
  - `owner row does not block edit` — บิลใหม่ `editable===true`; A แก้จาก even เป็น items ได้, token แถว B คงเดิม; หลัง B แนบสลิป แก้ยอดได้ 409 แต่แก้พร้อมเพย์ได้
  - `creator can view slips of own bill` — B แนบสลิป → A GET slip ของ B ได้ 200
- [ ] **Step 2:** รัน → FAIL
- [ ] **Step 3:** ทำตาม Interfaces: GET organizer view (`:589`) และดูสลิป (`:603`) ใช้ `manager` แทน `admin`; ด่าน `if (!admin)` ที่ `billing.js:710` เปลี่ยนเป็น `if (!manager)` แล้วใส่ `if (!admin)` ซ้ำไว้ใน `slip-check` (`:712`); ทาง `edit` แยก custom ไปฟังก์ชัน `editCustom(...)` ห้ามแก้ทางบิลตีแบด
- [ ] **Step 4:** `npm test` ผ่านทั้งหมด (รวมเทสบิลเดิม) + `npm run build`
- [ ] **Step 5:** format + commit `feat(bills): custom bill creators manage their own bill`

---

### Task 4: `/api/member/bills` — ชื่อบิล + "บิลที่ฉันสร้าง"

**Files:**
- Modify: `member.js` (action `bills` ~`:346`), `test-custom-bill.mjs`

**Interfaces:**
- Produces: แต่ละแถวใน `bills` เพิ่ม `title` (`json_extract(b.payload,'$.title')`, null สำหรับบิลตีแบด); response เพิ่ม `created: [{ id, date, title, paid, count, outstanding, cancelled, url }]` — บิล custom ที่ `createdBy.userId = member.userId` ของก๊วนนั้น ล่าสุด 20 ใบ (รวมที่ยกเลิก), `paid/count` นับแถว ไม่นับ owner ใน `count` ก็ได้แต่ต้องตรงกันทั้งสองค่า, `url = /billing.html?manage=1&club=<club>&bill=<id>`
- ห้ามเพิ่ม query ต่อบิล: `created` ใช้ query เดียว

- [ ] **Step 1:** เทส `member bills include title and created list` — A สร้างบิล custom; B เห็นแถวของตัวเองพร้อม `title`; A เห็นบิลใน `created` (แถว owner ของ A อาจอยู่ใน `bills` ด้วยสถานะ paid — ยอมรับ); C ได้ `created: []`
- [ ] **Step 2:** รัน → FAIL; **Step 3:** ทำ; **Step 4:** `npm test` + `npm run build` ผ่าน
- [ ] **Step 5:** format + commit `feat(bills): member bills list shows custom titles and own bills`

---

### Task 5: หน้าสร้างบิลอื่นๆ (frontend)

**Files:**
- Create: `public/billing-custom.js` (ฟอร์มทั้งหมด), เพิ่มสไตล์ท้าย `public/billing.css`
- Modify: `public/billing.html` (โหลด `custom-split.js` และ `billing-custom.js` แบบ `defer` ก่อน `billing.js`, bump `?v=` ทุกไฟล์ที่แก้), `public/billing.js` (จุดเข้า + ปุ่ม)
- Test: เพิ่มเทสแบบอ่านไฟล์ใน `test-custom-bill.mjs` (สไตล์เดียวกับ `test-billing.mjs:448-484`)

**Interfaces:**
- Consumes: `GET /api/billing?action=people`, `POST /api/billing?action=custom` (Task 2), `SenaCustomSplit.split` (Task 1)
- Produces: `window.SenaCustomBill.mount(root, { club, admin, post, notify })` — `post` = ตัวส่งคำขอของ `billing.js` (มี Origin/headers แล้ว), `notify(notice)` = ทางเดียวกับที่ `billing.js` ใช้ส่ง notice เข้ากลุ่มหลังเปิดบิล (`line-notice.js`); สำเร็จแล้วไป `/billing.html?manage=1&club=<club>&bill=<id>`
- จุดเข้า: `billing.js` เมื่อ `params.get('custom') === 'new'` เรียก `mount` แทนหน้าปกติ; ปุ่ม `+ สร้างบิลอื่นๆ (เช่น ค่าข้าว)` ลิงก์ `/billing.html?custom=new&club=<club>` แสดงทั้งหน้ารายการบิลของผู้จัดและหน้า "ของฉัน" ของสมาชิกที่ approved

ฟอร์ม (ข้อความไทยตามนี้):
1. **"1. รายละเอียด"** — ชื่อบิล (placeholder `เช่น ข้าวหลังตี`), วันที่ (ค่าเริ่มต้นวันนี้เวลาไทย), คนออกเงิน (select จากคนที่เลือกในข้อ 2 ที่ไม่ใช่ guest, ค่าเริ่มต้น `me`), เลขพร้อมเพย์ของคนออกเงิน (จำค่าล่าสุดใน `localStorage` คีย์ `sena-custom-promptpay` ห่อ try/catch)
2. **"2. ใครร่วมจ่าย"** — ช่องค้นหา + checklist สมาชิกจาก `members`; ปุ่ม `+ เพิ่ม guest` = ชื่อ + select "มากับ" (เฉพาะสมาชิกที่ติ๊กแล้ว) แสดงเป็นป้าย `บอส (มากับ Bua)` ลบได้; ถ้าเอาสมาชิกออก guest ของเขาต้องหายด้วย
3. **"3. วิธีหาร"** — ปุ่มสลับ 3 แบบ `หารเท่ากัน` / `ใส่ยอดเอง` / `แยกรายการ`: หารเท่า = ช่องยอดรวม (บาท ทศนิยม 2); ใส่เอง = ช่องยอดต่อคน + บรรทัด `รวม X บาท`; แยกรายการ = แถวรายการ (ชื่อ, ราคา, ชิปชื่อคนกดเลือก/ไม่เลือก, ปุ่ม `ทุกคน`) + `+ เพิ่มรายการ`, ลบรายการได้
4. **"4. ตรวจยอดก่อนเปิดบิล"** — เรียก `split()` ทุกครั้งที่ฟอร์มเปลี่ยน: แสดงแต่ละแถว `ชื่อ X บาท` (+ `รวม guest: …`), แถวคนออกเงินขึ้น `คนออกเงิน ✓`, บรรทัด `ยอดรวม X บาท · ปัดขึ้นรวม Y บาท`, ถ้า `error` แสดงข้อความแดงและปิดปุ่ม; ปุ่ม `เปิดบิล`
- แปลงบาทเป็นสตางค์ด้วย `Math.round(value * 100)`

- [ ] **Step 1:** เทสอ่านไฟล์: `billing.html` โหลด `custom-split.js` และ `billing-custom.js` ก่อน `billing.js`; `billing-custom.js` เรียก `action=people` และ `action=custom`; ไม่มี `innerHTML` ที่ต่อตัวแปรโดยไม่ผ่าน escape (ให้เช็กว่ามี helper escape ในไฟล์)
- [ ] **Step 2:** ทำฟอร์ม; **Step 3:** `npm test` + `npm run build` ผ่าน
- [ ] **Step 4: ลองในเครื่อง** ตามหัวข้อ "ทดสอบหน้าในเครื่อง" ใน `HANDOFF.md` (`.dev.vars` ADMIN_KEY, `wrangler dev --local`) + Playwright viewport 390×844: ผู้จัดสร้างบิลทั้ง 3 แบบ (สมาชิกจำลองด้วยการ INSERT `member_links` approved ใน D1 local) แล้วจับภาพหน้าจอฟอร์มและหน้าบิลหลังสร้าง เก็บใน scratchpad รายงานผลตามจริง
- [ ] **Step 5:** format + commit `feat(bills): custom bill form`

---

### Task 6: หน้าบิล custom + เอกสาร

**Files:**
- Modify: `public/billing.js` (`showBill` ~`:227-288`, รายการบิลผู้จัด ~`:485`), `public/billing-overview.js` (แสดง `title`), "ของฉัน" (แสดงส่วน `บิลที่ฉันสร้าง` จาก `created`), `public/billing.html` (`?v=`), `test-custom-bill.mjs`
- Docs: `CLAUDE.md` (ตารางโมดูล: แถว `public/custom-split.js`), `HANDOFF.md`, ท้าย spec (หมายเหตุการทำงาน)

**Interfaces:**
- Consumes: `billView` fields `kind, title, mode, items, receiver, viewer` (Task 2–3), `created` (Task 4)

- [ ] **Step 1:** เทสอ่านไฟล์: `billing.js` ใช้ `bill.title` ในหัวบิลและรายการ; ปุ่ม `mention-diagnostics` และลิงก์ `บิลทั้งหมด` อยู่หลังเงื่อนไข `viewer === 'admin'`
- [ ] **Step 2:** `showBill` สำหรับ custom: หัว `<title> · <ก๊วน>`; แทนบรรทัด `ค่าคอร์ต … + ค่าลูก …` ด้วยรายการ (`items`: `ชื่อ ราคา บาท · n คน`) หรือ `หารเท่ากัน`/`ใส่ยอดเอง`; แถว `method==='owner'` แสดง `คนออกเงิน` ไม่มีปุ่มจ่าย/รับเงินสด/ยกเลิกรับเงินสด; `viewer==='creator'` ซ่อนปุ่มของผู้จัดจริง (ตรวจแท็ก, บิลทั้งหมด) แต่คงปุ่มรับเงินสด/ให้ส่งใหม่/แก้/ยกเลิก; ปุ่ม `แก้ไขบิล` ของ custom เปิด `SenaCustomBill.mount` ในโหมดแก้ (ส่ง `draft`, `revision` และให้ POST `action=edit`)
  - **ต้องเช็ก:** เปิด `?manage=1&bill=` ในฐานะสมาชิก (ไม่ใช่ admin) ต้องไม่พังเพราะโหลดรายการบิลผู้จัด (`adminList`) ไม่ได้ — ถ้าพังให้โหลดเฉพาะเมื่อเป็น admin
- [ ] **Step 3:** รายการบิลผู้จัดและ "ของฉัน" แสดง `title` แทน `· บิลเพิ่มเติม` เมื่อมี
- [ ] **Step 4:** `npm test`, `npm run build`, `npm run format:check` ผ่าน; ลองในเครื่องแบบ Task 5: หน้าบิลมุมมองผู้จัด, มุมมองคนสร้าง (จำลอง `/api/member/bills` ตามที่ HANDOFF บอก), มุมมองผู้จ่าย — จับภาพ
- [ ] **Step 5:** อัปเดตเอกสาร + `HANDOFF.md` (ย่อตามกติกา, บอกว่ายังไม่ได้ลองใน LINE จริง) → format + commit `feat(bills): custom bill view, labels and docs` → push branch (ห้าม merge `main`)
