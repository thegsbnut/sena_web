# Slip AI Check Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ให้ Cloudflare Workers AI อ่านสลิปที่ผู้เล่นแนบแล้วติดป้าย (ยอดไม่ตรง / วันที่ไม่ตรง / สลิปซ้ำ / ไม่ชัดเจน) ให้ผู้จัดเห็นเท่านั้น โดยสลิปยัง auto-paid เหมือนเดิม

**Architecture:** โค้ด AI อยู่ในไฟล์ใหม่ `slip-check.js` (ฟังก์ชันล้วน + ตัวเรียก AI + เก็บผลในตาราง `slip_checks` แยกจาก payload บิล) ถูกเรียกจาก `billing.js` ผ่าน `ctx.waitUntil` หลังอัปโหลดสำเร็จ ฝั่งหน้าเว็บมีไฟล์ UMD `public/slip-check-text.js` สร้างข้อความป้ายภาษาไทยจากรหัสสาเหตุ

**Tech Stack:** Cloudflare Worker (ESM), D1, Workers AI binding `AI`, vanilla JS, `node --test`

**Spec:** `docs/superpowers/specs/2026-11-12-slip-ai-check-design.md`

## Global Constraints

- ข้อความที่ผู้ใช้เห็นเป็นภาษาไทย; ข้อความที่ใส่ `innerHTML` ต้องผ่าน `escape()` ใน `public/billing.js`
- ผล AI **ไม่แตะ payload บิลและไม่เพิ่ม `revision`**; ข้อมูลหลักยังใช้ `WHERE revision=?` ตามเดิม
- ผล AI **ห้ามหลุดถึงผู้เล่น**: ใส่ `aiCheck` ใน response เฉพาะ `admin` และไม่ใช่ view ของ payer-token
- ทุก POST ใต้ `/api/` ผ่านเช็ก Origin (มีอยู่แล้วใน `worker.js`); action ใหม่ `slip-check` เป็น admin เท่านั้น
- โมเดลเริ่มต้น `@cf/meta/llama-4-scout-17b-16e-instruct`, อ่านจาก var `SLIP_AI_MODEL`; kill switch `SLIP_AI_ENABLED` (ค่า `'true'` เท่านั้นที่เปิด); ไม่เพิ่ม secret
- ค่าเริ่มต้นใน `wrangler.jsonc` ตั้ง `SLIP_AI_ENABLED: "false"` — เปิดจริงหลังตรวจค่าใช้จ่ายและได้ OK จากเจ้าของโปรเจกต์ (spec หัวข้อ 13)
- เพิ่ม `test-slip-check.mjs` ใน script `test` และไฟล์ใหม่ใน script `build` ของ `package.json`
- ก่อน commit: `npm run format`; ก่อนส่งต่อ: `npm test` และ `npm run build` ผ่าน; เทสเดิมใน `test-billing.mjs` ห้ามแก้
- commit บน branch `ccr-cf6f2e61-foyp2b` เท่านั้น ลงท้าย commit ด้วยบรรทัด attribution ที่ session กำหนด; **ห้าม merge เข้า `main`** จนเจ้าของโปรเจกต์สั่ง

## Review Focus

1. สลิปที่แนบก่อนมีฟีเจอร์ (มี `slipKey` แต่ไม่มีแถว `slip_checks`) → หน้าผู้จัดไม่แสดงป้ายเลย (ไม่ใช่ "กำลังตรวจ") — Task 5
2. หลัง `prunePaidSlips` (`slips_removed`) → ไม่มี `aiCheck` และ `slip-check` ตอบ 404 — Task 5
3. ผู้จ่ายคนเดิมแนบสลิปใบเดิมหลังถูก "ให้ส่งใหม่" ต้องไม่ถูกป้ายซ้ำกับตัวเอง แต่ผู้จ่ายคนอื่นในบิลเดียวกันที่ ref ตรงกันต้องถูกป้าย — Task 4
4. admin เปิดบิลด้วย payer token (view ของผู้จ่าย) ต้องไม่ได้ `aiCheck` — Task 5
5. AI ตอบยอดเป็นสตริง `"1,000.00"`, ตอบข้อความรอบ JSON, หรือ `amount: 0`/ติดลบ → ไม่ crash และตัดสินถูก — Task 2/3

---

## File Structure

| ไฟล์ | หน้าที่ |
|---|---|
| `slip-check.js` (ใหม่) | ฟังก์ชันล้วน (`parseSlipDate`, `normalizeRef`, `isUsableRef`, `validateReading`, `judgeSlip`), ตัวเรียก AI (`readSlip`), เก็บ/อ่านผล (`checkSlip`, `slipChecksFor`, `pruneSlipChecks`), `slipAiEnabled` |
| `public/slip-check-text.js` (ใหม่) | UMD: `SlipCheckText.describe`, `.flaggedCount`, `.fmtDate`, `.fmtBaht` |
| `test-slip-check.mjs` (ใหม่) | เทสทั้งหมดของฟีเจอร์ (fixture ของตัวเอง สำเนาแนวเดียวกับ `test-billing.mjs`) |
| `billing.js` | รับ `ctx`, hook หลังอัปโหลด, แนบ `aiCheck` ให้ admin, action `slip-check` |
| `worker.js` | ส่ง `ctx` เข้า `billingRoute`; cron เรียก `pruneSlipChecks` |
| `public/billing.js`, `public/billing.html`, `public/billing.css` | แสดงป้าย, ปุ่ม "ตรวจอีกครั้ง", การ์ดสรุป |
| `wrangler.jsonc`, `package.json` | binding `AI`, vars, script `test`/`build` |

---

### Task 1: ตัวแปลงวันที่และ normalize เลขอ้างอิง

**Files:**
- Create: `slip-check.js`, `test-slip-check.mjs`
- Modify: `package.json` (เพิ่ม `test-slip-check.mjs` ใน `test`, `node --check slip-check.js` ใน `build`)

**Interfaces:**
- Produces: `parseSlipDate(text: string, now?: Date): string | null` (`'YYYY-MM-DD'` ค.ศ.), `normalizeRef(ref: string): string`, `isUsableRef(norm: string): boolean`

- [ ] **Step 1: เขียนเทสที่ล้ม** ใน `test-slip-check.mjs` (`now = new Date('2026-11-12T05:00:00Z')`)
  - `parseSlipDate reads every format seen on real slips`: `'10 Nov 2026 12:29:04'`→`'2026-11-10'`, `'25 Mar 25, 13:13'`→`'2025-03-25'`, `'12 พ.ย. 69 11:30 น.'`→`'2026-11-12'`, `'10 พ.ย. 69, 12:13 น.'`→`'2026-11-10'`, `'01 ม.ค. 2567 12:00:00'`→`'2024-01-01'`, `'12 พฤศจิกายน 2569'`→`'2026-11-12'`, `'12/11/2569'`→`'2026-11-12'`, `'12/11/2026'`→`'2026-11-12'`
  - `parseSlipDate rejects junk and implausible years`: `''`, `'สวัสดี'`, `'31 Feb 2026'`, `'02 พ.ย. 2565'` (ค.ศ. 2022 นอกช่วง −2..+1 ปี) → `null`
  - `normalizeRef treats I/l/1 and O/0 alike`: `normalizeRef('202211022XMj8r6IlId6H8WNs') === normalizeRef('202211022XMJ8r6I11d6H8WNs')`; `normalizeRef(' KSA 0000-0001078339102 ') === 'ksa00000001078339102'`
  - `isUsableRef`: `'987654'`, `'0'.repeat(32)`, `'1111111111'` → false; `'ksa00000001078339102'` → true
- [ ] **Step 2: รัน** `node --test test-slip-check.mjs` — คาดว่าล้ม (ไม่มีโมดูล)
- [ ] **Step 3: เขียน `slip-check.js`** ตามกฎ spec หัวข้อ 6: เดือนไทย (เต็ม/ย่อ) → ปี พ.ศ., เดือนอังกฤษ (เต็ม/ย่อ ไม่สนตัวพิมพ์) → ปี ค.ศ.; ปี 2 หลัก: พ.ศ. `+2500`, ค.ศ. `+2000`; `dd/mm/yyyy` ปี > 2400 = พ.ศ.; ตรวจวันที่มีจริงในปฏิทิน; ปี ค.ศ. ต้องอยู่ใน `[nowYear-2, nowYear+1]` ไม่งั้น `null`. `normalizeRef`: ตัดตัวอักษรที่ไม่ใช่ `a-z0-9`, lowercase, แปลง `l`,`i`→`1` และ `o`→`0`. `isUsableRef`: ยาว ≥ 10 และมีตัวอักษรต่างกัน > 1 ตัว
- [ ] **Step 4: รันเทส** — คาดว่าผ่านทั้งหมด
- [ ] **Step 5: Commit** `git add slip-check.js test-slip-check.mjs package.json && git commit -m "Add slip date parser and ref normalizer"`

### Task 2: ตรวจผลอ่านและตัดสินป้าย

**Files:** Modify `slip-check.js`, `test-slip-check.mjs`

**Interfaces:**
- Consumes: `parseSlipDate`, `normalizeRef`, `isUsableRef` (Task 1)
- Produces:
  - `type Reading = { isSlip: boolean, amountSatang: number | null, dateText: string | null, ref: string | null }`
  - `validateReading(raw: unknown): Reading`
  - `type Reason = { code: 'ok' | 'amount_mismatch' | 'old_date' | 'duplicate_ref' | 'unreadable' | 'date_unreadable', ... }`
  - `judgeSlip(reading: Reading, ctx: { amountSatang: number, billDate: string, duplicate: { billDate: string, payerName: string } | null, now?: Date }): Reason[]`

- [ ] **Step 1: เขียนเทสที่ล้ม**
  - `validateReading`: `{is_transfer_slip:true, amount:200, date_text:'12 พ.ย. 69', ref:'A'}` → `{isSlip:true, amountSatang:20000, dateText:'12 พ.ย. 69', ref:'A'}`; `amount:'1,000.00'` → `100000`; `amount` เป็น `0`, `-5`, `'abc'`, `2e9`, `null` → `amountSatang:null`; `is_transfer_slip:false` → `isSlip:false`; `undefined`/สตริง/array → `isSlip:false` และฟิลด์อื่น `null`; `date_text` ยาว 100 ตัว → `null`
  - `judgeSlip` (table-driven, `billDate:'2026-11-12'`, `amountSatang:20000`): ยอดและวันตรง → `[{code:'ok'}]`; ยอด 12000 → `[{code:'amount_mismatch', slipSatang:12000, billSatang:20000}]`; ต่างแค่ 1 สตางค์ → `amount_mismatch`; วันที่ `'03 พ.ย. 69'` → `old_date` พร้อม `slipDate:'2026-11-03'`, `billDate:'2026-11-12'`; วันเดียวกันและหลังวันตีแบด → `ok`; `dateText:null` → `[{code:'date_unreadable'}]` (ไม่มี `ok`); `duplicate` มีค่า → `duplicate_ref` พร้อม `billDate`,`payerName`; ยอดผิด+วันเก่า+ซ้ำ → ครบสามรหัส; `isSlip:false` → `[{code:'unreadable', why:'not_slip'}]` เท่านั้น; `amountSatang:null` → `[{code:'unreadable', why:'amount'}]` เท่านั้น
- [ ] **Step 2: รัน** เทสใหม่ — คาดว่าล้ม
- [ ] **Step 3: Implement** `validateReading` ตามกฎ spec หัวข้อ 5 (ยอดเป็นตัวเลขหรือสตริงตัวเลขที่ตัด `,` ได้ > 0 และ ≤ 1,000,000 บาท → `Math.round(x*100)`; `date_text` ≤ 60 ตัว, `ref` ≤ 64 ตัว, trim) และ `judgeSlip` (`ok` ใส่เมื่อรายการสาเหตุว่างเท่านั้น; `date_unreadable` ไม่ถือเป็นปัญหา แต่ไม่ใส่ `ok`)
- [ ] **Step 4: รันเทสไฟล์นี้** — คาดว่าผ่านทั้งหมด
- [ ] **Step 5: Commit** `git commit -am "Add slip reading validation and verdict logic"`

### Task 3: ตัวเรียก Workers AI

**Files:** Modify `slip-check.js`, `test-slip-check.mjs`

**Interfaces:**
- Consumes: `validateReading` (Task 2)
- Produces: `DEFAULT_MODEL`, `slipAiEnabled(env): boolean` (`env.SLIP_AI_ENABLED === 'true' && env.AI && env.DB`), `readSlip(env, bytes: Uint8Array, contentType: string): Promise<Reading>` (throw เมื่อ AI ล้ม)

- [ ] **Step 1: เขียนเทสที่ล้ม** ด้วย `env.AI = { run: async (model, input) => ... }` จำลอง
  - `readSlip sends the image and strict instructions`: จับ `model`/`input`; assert `model === '@cf/meta/llama-4-scout-17b-16e-instruct'`, `input.temperature === 0`, `input.messages[0].content` มี part `type:'text'` ที่มี `date_text` และ part `image_url.url` ขึ้นต้น `data:image/png;base64,` เมื่อส่ง `contentType:'image/png'`; ตั้ง `env.SLIP_AI_MODEL='x'` → ใช้ `'x'`
  - รองรับรูปทรงคำตอบ 4 แบบให้ได้ `Reading` เดียวกัน: `{response:{is_transfer_slip:true,amount:50,date_text:'d',ref:'r'}}`, `{response:'{"is_transfer_slip":true,...}'}`, `{choices:[{message:{content:'{...}'}}]}`, content ที่มีข้อความนำหน้า/ตามหลัง JSON
  - คำตอบขยะ (`{response:'ขออภัย'}`) → `isSlip:false`; `AI.run` throw → `readSlip` reject
  - `slipAiEnabled`: `false` เมื่อไม่ตั้ง var, `'false'`, ไม่มี `AI`, ไม่มี `DB`; `true` เมื่อครบ
- [ ] **Step 2: รัน** — คาดว่าล้ม
- [ ] **Step 3: Implement** prompt ตาม spec หัวข้อ 5 (JSON เท่านั้น; `amount` = ยอดโอนไม่ใช่ค่าธรรมเนียม; `date_text` คัดลอกตามที่พิมพ์; `ref` เลือกเลขที่ยาวที่สุด; อ่านไม่ได้ = `null`), `max_tokens: 300`; แปลง bytes เป็น base64 แบบแบ่งก้อน (กัน stack overflow กับรูป ~1 MB); ดึง JSON ก้อนแรกด้วย regex แล้วส่งเข้า `validateReading`
- [ ] **Step 4: รันเทส** — คาดว่าผ่าน
- [ ] **Step 5: Commit** `git commit -am "Add Workers AI slip reader"`

### Task 4: เก็บผล ตรวจซ้ำ และล้างข้อมูลเก่า

**Files:** Modify `slip-check.js`, `test-slip-check.mjs` (เพิ่ม fixture)

**Interfaces:**
- Consumes: `readSlip`, `judgeSlip`, `parseSlipDate`, `normalizeRef`, `isUsableRef`; `logError` จาก `./log.js`
- Produces:
  - `checkSlip(env, a: { bill: {id, club, session_date}, payer: {id, name, amount}, slipKey: string, bytes: Uint8Array, contentType: string, now?: Date }): Promise<void>` — ไม่ throw ออกนอกฟังก์ชัน
  - `type AiCheck = { state: 'pending'|'done'|'error', reasons: Reason[], readAmount: number|null, readDate: string|null, checkedAt: number }`
  - `slipChecksFor(db, slipKeys: string[]): Promise<Map<string, AiCheck>>`
  - `pruneSlipChecks(env, now?: number): Promise<void>` (ลบแถว `checked_at` เก่ากว่า 180 วัน)

- [ ] **Step 1: เขียน fixture + เทสที่ล้ม** — fixture ใน `test-slip-check.mjs`: `DatabaseSync` in-memory 2 ก้อน + wrapper `binding()` เหมือน `test-billing.mjs:14-38`, `env` มี `AI` จำลอง, `SLIP_AI_ENABLED:'true'`; สร้างบิลผ่าน `worker.fetch POST /api/billing` (login ด้วย `ADMIN_KEY` เหมือน `test-billing.mjs:56-63`, ใช้ `draft` แนวเดียวกัน) แล้วอ่านแถวจาก `bills`
  - `checkSlip stores a done row without touching the bill`: AI ตอบยอด 200 บาท ตรงบิล → แถว `state:'done'`, `reasons:[{code:'ok'}]`, `read_amount:20000`; `bills.revision` และ `payload` ไม่เปลี่ยน
  - `checkSlip records an error row and never throws when the AI fails`
  - `duplicate refs`: สลิปสองใบต่างผู้จ่าย `ref` เดียวกัน (ต่างกันแค่ `I`/`l`) → ใบที่สองได้ `duplicate_ref` พร้อมชื่อผู้จ่ายคนแรกและ `billDate`; **ผู้จ่ายคนเดิม + `slipKey` ใหม่ + ref เดิม → ไม่ซ้ำ**; `ref` สั้น (`'987654'`) → ไม่นับซ้ำ
  - `slipChecksFor` คืน Map ตาม key, key ที่ไม่มีแถวไม่อยู่ใน Map
  - `pruneSlipChecks` ลบแถวอายุ 181 วัน เหลือแถวอายุ 179 วัน
- [ ] **Step 2: รัน** — คาดว่าล้ม
- [ ] **Step 3: Implement** ตาราง `slip_checks` ตาม spec หัวข้อ 7 (`CREATE TABLE/INDEX IF NOT EXISTS` ผ่าน `env.DB.prepare(...).run()`); `checkSlip`: เขียนแถว `pending` → `readSlip` → ถ้า `isUsableRef(refNorm)` หาแถวอื่นที่ `ref_norm` เท่ากัน (`NOT (bill_id=? AND payer_id=?)`) แล้วอ่านวันที่/ชื่อผู้จ่ายจาก `bills` → `judgeSlip` (`amountSatang = payer.amount * 100`, `billDate = session_date.slice(0,10)`) → `INSERT OR REPLACE` แถว `done`; ทั้งฟังก์ชันอยู่ใน try/catch: ล้มเหลว → เขียนแถว `error` (ถ้าเขียนไม่ได้ก็แค่ `logError('slip-check', e)`)
- [ ] **Step 4: รันเทส** — คาดว่าผ่าน
- [ ] **Step 5: Commit** `git commit -am "Store slip check results with duplicate detection"`

### Task 5: ต่อเข้า billing, worker, cron และ config

**Files:** Modify `billing.js`, `worker.js`, `wrangler.jsonc`, `test-slip-check.mjs`

**Interfaces:**
- Consumes: `slipAiEnabled`, `checkSlip`, `slipChecksFor`, `pruneSlipChecks` (Task 3–4)
- Produces: `billingRoute(req, env, admin, club, ctx)`; payer ใน response ของ admin มี `aiCheck?: AiCheck`; `POST /api/billing?bill=<id>&action=slip-check` body `{payer}` → `{ok:true}`

- [ ] **Step 1: เขียนเทสที่ล้ม** (integration ผ่าน `worker.fetch(req, env, ctx)` โดย `ctx = { waitUntil: p => pending.push(p) }` และ `await Promise.all(pending)` ก่อน assert; รูปแบบคำขออัปโหลดตาม `test-billing.mjs:321-331`)
  - `upload stays paid at once and the check appears for the organizer`: ตอบ 200 และสถานะ `paid` ก่อน settle; หลัง settle admin `GET /api/billing?bill=` → payer มี `aiCheck.state === 'done'`
  - `players never receive aiCheck`: JSON ของ GET แบบไม่ล็อกอิน, แบบ payer-token, และแบบ **admin cookie + payer-token** ไม่มีสตริง `aiCheck`
  - `AI failure leaves payment intact`: AI throw → payer ยัง `paid`, `aiCheck.state === 'error'`
  - `SLIP_AI_ENABLED off`: `AI.run` ไม่ถูกเรียก, ไม่มีแถว `slip_checks`, ไม่มี `aiCheck`
  - `bills with slips from before the feature show no aiCheck`: ลบแถว `slip_checks` แล้ว GET → payer ไม่มี `aiCheck`
  - `slip-check action`: ไม่ล็อกอิน → 401; Origin ผิด → 403; admin หลัง AI ล้มครั้งแรก เรียกซ้ำ → `ok:true` และ `aiCheck.state === 'done'`; ผู้จ่ายที่ไม่มีสลิป → 404; หลัง `slips_removed=1` → 404 และ GET ไม่มี `aiCheck`
- [ ] **Step 2: รัน** — คาดว่าล้ม
- [ ] **Step 3: Implement**
  - `worker.js`: `async fetch(req, env, ctx)` → ส่ง `ctx` เป็นอาร์กิวเมนต์ที่ 5 ของ `billingRoute` (บรรทัด ~231); ใน `scheduled` เพิ่ม `ctx.waitUntil(pruneSlipChecks(env).catch(error => logError('cron:prune-slip-checks', error)))`
  - `billing.js` upload (หลัง `updateBill` สำเร็จ ก่อน `return json({ok:true})`): `if (slipAiEnabled(env)) background(ctx, checkSlip(env, {...}))` โดย `background = (ctx, p) => (ctx?.waitUntil ? ctx.waitUntil(p) : void p)`
  - route GET บิล: เมื่อ `admin && !payer && !bill.slips_removed && slipAiEnabled(env)` โหลด `slipChecksFor` แล้วใส่ `aiCheck` ให้ payer ที่มีแถว
  - action `slip-check` วางหลัง `if (!admin) return fail(...)`: หา payer จาก `input.payer`, 404 (`'ไม่พบสลิป'`) ถ้าไม่มี `slipKey`/`slips_removed`/ไม่พบรูปใน `SLIPS_DB`, 503 ถ้า `!slipAiEnabled(env)`; `await checkSlip(...)` แล้ว `json({ok:true})`
  - `wrangler.jsonc`: เพิ่ม `"ai": { "binding": "AI" }`, vars `"SLIP_AI_ENABLED": "false"`, `"SLIP_AI_MODEL": "@cf/meta/llama-4-scout-17b-16e-instruct"`
- [ ] **Step 4: รัน** `npm test` — คาดว่า **ทั้งชุดผ่าน** รวม `test-billing.mjs` ที่ไม่ได้แก้
- [ ] **Step 5: Commit** `git commit -am "Wire slip AI check into billing, worker and cron"`

### Task 6: หน้าจอผู้จัด

**Files:**
- Create: `public/slip-check-text.js`
- Modify: `public/billing.js` (แถวผู้จ่าย ~บรรทัด 194-206, การ์ดสรุป ~183-185, handler ปุ่ม ~บรรทัด 745-790), `public/billing.html` (แท็ก script บรรทัด 10), `public/billing.css`, `test-slip-check.mjs`, `package.json` (`node --check public/slip-check-text.js` ใน `build`)

**Interfaces:**
- Produces (UMD แบบ `public/engine.js`, `globalThis.SlipCheckText`): `describe(reason: Reason, check: AiCheck): { icon: string, text: string, level: 'ok'|'warn'|'info' }`, `flaggedCount(payers: {aiCheck?: AiCheck}[]): number`, `fmtDate(iso: string): string` (`'2026-11-12'`→`'12 พ.ย. 69'`), `fmtBaht(satang: number): string`

- [ ] **Step 1: เขียนเทสที่ล้ม** (`import './public/slip-check-text.js'` แล้วอ่าน `globalThis.SlipCheckText`) — assert ข้อความตรงตาม spec หัวข้อ 2:
  - `ok` → `'ตรวจผ่าน — ยอด 200 บาท · 12 พ.ย. 69'` (`level:'ok'`)
  - `amount_mismatch {slipSatang:12000, billSatang:20000}` → `'ยอดเงินไม่ตรง — สลิป 120 บาท แต่บิล 200 บาท'`
  - `old_date {slipDate:'2026-11-03', billDate:'2026-11-12'}` → `'วันที่ไม่ตรง — สลิปลงวันที่ 3 พ.ย. 69 ซึ่งก่อนวันตีแบด 12 พ.ย. 69'`
  - `duplicate_ref {billDate:'2026-11-05', payerName:'สมหญิง'}` → `'สลิปซ้ำ — ใช้แล้วในบิล 5 พ.ย. 69 ของ สมหญิง'`
  - `unreadable` `why:'amount'` → `'สลิปไม่ชัดเจน — อ่านยอดเงินไม่ได้'`, `why:'not_slip'` → `'สลิปไม่ชัดเจน — รูปนี้ไม่ใช่สลิปโอนเงิน'`; `date_unreadable` → `'อ่านวันที่ไม่ได้ (ไม่ได้ตัดสินเรื่องวันที่)'` (`level:'info'`)
  - `level:'warn'` สำหรับ `amount_mismatch`/`old_date`/`duplicate_ref`/`unreadable`
  - `flaggedCount` นับเฉพาะ payer ที่ `state:'done'` และมี reason ระดับ warn; ไม่นับ `ok`, `info`, `error`, `pending`, หรือ payer ไม่มี `aiCheck`
- [ ] **Step 2: รัน** — คาดว่าล้ม
- [ ] **Step 3: Implement `public/slip-check-text.js`** แล้วต่อเข้า `public/billing.js` — แสดงเฉพาะ `organizer` และเฉพาะ payer ที่มี `aiCheck`: หนึ่งบรรทัดต่อสาเหตุ (`<small class="ai-check warn|ok|info">🤖 ...`) ใต้บรรทัดสถานะ, **ทุกข้อความผ่าน `escape()`** (ชื่อผู้จ่ายในป้ายสลิปซ้ำมาจากข้อมูลผู้ใช้); `state:'pending'` → `⏳ กำลังตรวจสลิปด้วย AI…`; `state:'error'` หรือ `pending` เกิน 2 นาที (`Date.now() - checkedAt > 120000`) → `⏳ AI ตรวจไม่สำเร็จ` + ปุ่ม `data-action="ai-recheck"` ที่ handler เรียก `post('slip-check', {payer: payer.id})` ใน `run(...)` แล้ว `load()`; การ์ดสรุปเมื่อ `flaggedCount > 0`: `🤖 มีสลิปที่ควรตรวจ N ใบ`; เพิ่ม `<script defer src="/slip-check-text.js?v=...">` ก่อน `billing.js` และ bump `?v=` ของ `billing.js`; สไตล์ `.ai-check` ใน `billing.css` (ok สีจาง, warn สีเตือน)
- [ ] **Step 4: รัน** `npm test && npm run build` — คาดว่าผ่าน
- [ ] **Step 5: Commit** `git commit -am "Show slip AI check labels to organizers"`

### Task 7: ตรวจยืนยันรวมและส่งต่อ

**Files:** Modify `HANDOFF.md`

- [ ] **Step 1:** `npm run format && npm run format:check && npm test && npm run build` — คาดว่าผ่านทั้งหมด; `git diff main -- test-billing.mjs` ต้องว่าง
- [ ] **Step 2: Smoke กับ AI จริง** ด้วยสคริปต์ชั่วคราวใน scratchpad (ไม่ commit) ที่สร้าง `env.AI = { run: (model, input) => fetch REST ของ Workers AI }` แล้วเรียก `readSlip` กับสลิปทั้ง 6 ใบ **ขนาดต้นฉบับ ไม่ย่อ** — ผ่านเมื่อยอดถูก 6/6 และวันที่แปลงได้ถูก 6/6 (ความเสี่ยงที่ spike ยังไม่ครอบคลุม: spike ย่อรูปเหลือ 1024px แต่ Worker ส่งรูปต้นฉบับ ≤ 1 MB; ถ้าถูกปฏิเสธต้องเพิ่มขั้นตอนลดขนาดใน plan นี้)
- [ ] **Step 3: อัปเดต `HANDOFF.md`** — เสร็จแล้ว/ขั้นต่อไป และ **ยังไม่ได้ตรวจยืนยัน**: ค่าใช้จ่าย/โควตา Workers AI ต่อสลิป, การแสดงผลบนหน้าบิลจริง (ยังไม่เห็นด้วยตา), ความแม่นกับภาพถ่ายหน้าจอจริงของก๊วน, การตั้ง `SLIP_AI_ENABLED` เป็น `"true"` ใน production
- [ ] **Step 4:** `git commit -am "Update handoff for slip AI check" && git push -u origin ccr-cf6f2e61-foyp2b`
