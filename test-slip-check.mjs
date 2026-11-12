import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseSlipDate,
  normalizeRef,
  isUsableRef,
  validateReading,
  judgeSlip,
  readSlip,
  slipAiEnabled,
  DEFAULT_MODEL,
  checkSlip,
  slipChecksFor,
  pruneSlipChecks,
} from './slip-check.js';
import worker from './worker.js';

const now = new Date('2026-11-12T05:00:00Z');

test('parseSlipDate reads every format seen on real slips', () => {
  for (const [text, want] of [
    ['10 Nov 2026 12:29:04', '2026-11-10'],
    ['25 Mar 25, 13:13', '2025-03-25'],
    ['12 พ.ย. 69 11:30 น.', '2026-11-12'],
    ['10 พ.ย. 69, 12:13 น.', '2026-11-10'],
    ['01 ม.ค. 2567 12:00:00', '2024-01-01'],
    ['12 พฤศจิกายน 2569', '2026-11-12'],
    ['12/11/2569', '2026-11-12'],
    ['12/11/2026', '2026-11-12'],
  ])
    assert.equal(parseSlipDate(text, now), want, text);
});

test('parseSlipDate rejects junk and implausible years', () => {
  for (const text of ['', 'สวัสดี', '31 Feb 2026', '02 พ.ย. 2565'])
    assert.equal(parseSlipDate(text, now), null, text);
});

test('normalizeRef treats I/l/1 and O/0 alike', () => {
  assert.equal(
    normalizeRef('202211022XMj8r6IlId6H8WNs'),
    normalizeRef('202211022XMJ8r6I11d6H8WNs'),
  );
  assert.equal(normalizeRef(' KSA 0000-0001078339102 '), 'ksa00000001078339102');
});

test('isUsableRef rejects short and repeated refs', () => {
  for (const ref of ['987654', '0'.repeat(32), '1111111111']) assert.equal(isUsableRef(ref), false);
  assert.equal(isUsableRef('ksa00000001078339102'), true);
});

test('validateReading normalizes a good reading', () => {
  assert.deepEqual(
    validateReading({ is_transfer_slip: true, amount: 200, date_text: '12 พ.ย. 69', ref: 'A' }),
    { isSlip: true, amountSatang: 20000, dateText: '12 พ.ย. 69', ref: 'A' },
  );
  assert.equal(
    validateReading({ is_transfer_slip: true, amount: '1,000.00' }).amountSatang,
    100000,
  );
});

test('validateReading refuses implausible amounts and shapes', () => {
  for (const amount of [0, -5, 'abc', 2e9, null])
    assert.equal(
      validateReading({ is_transfer_slip: true, amount }).amountSatang,
      null,
      String(amount),
    );
  assert.equal(validateReading({ is_transfer_slip: false, amount: 5 }).isSlip, false);
  for (const raw of [undefined, 'text', [1, 2]])
    assert.deepEqual(validateReading(raw), {
      isSlip: false,
      amountSatang: null,
      dateText: null,
      ref: null,
    });
  assert.equal(
    validateReading({ is_transfer_slip: true, amount: 1, date_text: 'x'.repeat(100) }).dateText,
    null,
  );
});

test('judgeSlip picks the right labels', () => {
  const base = { isSlip: true, amountSatang: 20000, dateText: '12 พ.ย. 69', ref: null };
  const ctx = { amountSatang: 20000, billDate: '2026-11-12', duplicate: null, now };
  const codes = (reading, extra = {}) => judgeSlip(reading, { ...ctx, ...extra }).map(r => r.code);
  assert.deepEqual(judgeSlip(base, ctx), [{ code: 'ok' }]);
  assert.deepEqual(judgeSlip({ ...base, amountSatang: 12000 }, ctx), [
    { code: 'amount_mismatch', slipSatang: 12000, billSatang: 20000 },
  ]);
  assert.deepEqual(codes({ ...base, amountSatang: 20001 }), ['amount_mismatch']);
  assert.deepEqual(judgeSlip({ ...base, dateText: '03 พ.ย. 69' }, ctx), [
    { code: 'old_date', slipDate: '2026-11-03', billDate: '2026-11-12' },
  ]);
  assert.deepEqual(codes({ ...base, dateText: '13 พ.ย. 69' }), ['ok']);
  assert.deepEqual(codes({ ...base, dateText: null }), ['date_unreadable']);
  const duplicate = { billDate: '2026-11-05', payerName: 'สมหญิง' };
  assert.deepEqual(judgeSlip(base, { ...ctx, duplicate }), [
    { code: 'duplicate_ref', billDate: '2026-11-05', payerName: 'สมหญิง' },
  ]);
  assert.deepEqual(codes({ ...base, amountSatang: 100, dateText: '03 พ.ย. 69' }, { duplicate }), [
    'amount_mismatch',
    'old_date',
    'duplicate_ref',
  ]);
  assert.deepEqual(codes({ ...base, isSlip: false }, { duplicate }), ['unreadable']);
  assert.deepEqual(judgeSlip({ ...base, isSlip: false }, ctx), [
    { code: 'unreadable', why: 'not_slip' },
  ]);
  assert.deepEqual(judgeSlip({ ...base, amountSatang: null }, ctx), [
    { code: 'unreadable', why: 'amount' },
  ]);
});

const png = Uint8Array.of(137, 80, 78, 71, 1, 2, 3);
const fakeAi = answer => {
  const calls = [];
  return { calls, run: async (model, input) => (calls.push({ model, input }), answer) };
};
const good = { is_transfer_slip: true, amount: 50, date_text: '12 พ.ย. 69', ref: 'r' };
const goodReading = { isSlip: true, amountSatang: 5000, dateText: '12 พ.ย. 69', ref: 'r' };

test('readSlip sends the image and strict instructions to the configured model', async () => {
  const AI = fakeAi({ response: good });
  await readSlip({ AI }, png, 'image/png');
  const { model, input } = AI.calls[0];
  assert.equal(model, '@cf/meta/llama-4-scout-17b-16e-instruct');
  assert.equal(DEFAULT_MODEL, model);
  assert.equal(input.temperature, 0);
  const [instruction, image] = input.messages[0].content;
  assert.equal(instruction.type, 'text');
  assert.match(instruction.text, /date_text/);
  assert.match(image.image_url.url, /^data:image\/png;base64,/);
  await readSlip({ AI, SLIP_AI_MODEL: 'x' }, png, 'image/png');
  assert.equal(AI.calls[1].model, 'x');
});

test('readSlip understands every response shape the platform returns', async () => {
  const json = JSON.stringify(good);
  for (const answer of [
    { response: good },
    { response: json },
    { choices: [{ message: { content: json } }] },
    { response: 'ได้เลย ' + json + ' ขอบคุณ' },
  ])
    assert.deepEqual(await readSlip({ AI: fakeAi(answer) }, png, 'image/png'), goodReading);
});

test('readSlip treats garbage as not a slip and lets AI failures surface', async () => {
  assert.equal(
    (await readSlip({ AI: fakeAi({ response: 'ขออภัย' }) }, png, 'image/png')).isSlip,
    false,
  );
  const AI = { run: async () => Promise.reject(new Error('quota')) };
  await assert.rejects(readSlip({ AI }, png, 'image/png'), /quota/);
});

test('slipAiEnabled needs the switch, the AI binding and the database', () => {
  const full = { SLIP_AI_ENABLED: 'true', AI: {}, DB: {} };
  assert.equal(slipAiEnabled(full), true);
  for (const broken of [
    { ...full, SLIP_AI_ENABLED: 'false' },
    { ...full, SLIP_AI_ENABLED: undefined },
    { ...full, AI: undefined },
    { ...full, DB: undefined },
  ])
    assert.equal(slipAiEnabled(broken), false);
});

// ---- storage and wiring tests: in-memory D1 stand-ins, as in test-billing.mjs ----
const origin = 'https://sena.example';
const draft = {
  date: '2026-10-01',
  court: 80000,
  shuttle: 40001,
  transfer: '0000000000',
  attendees: [
    { name: 'Nut', payer: 'Nut', payerKey: 'member:1' },
    { name: 'Bua', payer: 'Bua', payerKey: 'member:2' },
  ],
};
const jpeg = Uint8Array.of(255, 216, 255, 224, 0, 0, 0, 0, 0, 0, 255, 217);
const checkedAt = new Date('2026-11-12T05:00:00Z');

function fixture(t, { enabled = true } = {}) {
  const db = new DatabaseSync(':memory:');
  const slips = new DatabaseSync(':memory:');
  t.after(() => {
    db.close();
    slips.close();
  });
  db.exec('CREATE TABLE login_attempts(ip TEXT PRIMARY KEY,window INTEGER,attempts INTEGER)');
  const binding = database => ({
    prepare(sql) {
      const stmt = database.prepare(sql);
      let args = [];
      return {
        bind(...values) {
          args = values.map(v => (v instanceof ArrayBuffer ? new Uint8Array(v) : v));
          return this;
        },
        first: () => stmt.get(...args),
        all: () => ({ results: stmt.all(...args) }),
        run: async () => ({ meta: { changes: stmt.run(...args).changes } }),
      };
    },
  });
  const f = { db, slips, pending: [], ai: { calls: 0, answer: () => ({ response: good }) } };
  f.env = {
    ADMIN_KEY: 'test-key',
    DB: binding(db),
    SLIPS_DB: binding(slips),
    SLIP_AI_ENABLED: enabled ? 'true' : 'false',
    AI: {
      run: async (...args) => {
        f.ai.calls++;
        return f.ai.answer(...args);
      },
    },
  };
  const ctx = { waitUntil: p => f.pending.push(p) };
  f.settle = async () => {
    await Promise.all(f.pending.splice(0));
  };
  f.request = (
    path,
    { cookie = '', token, method = 'GET', payload, body, originHeader = origin } = {},
  ) =>
    worker.fetch(
      new Request(origin + path, {
        method,
        headers: {
          Origin: originHeader,
          Cookie: cookie,
          ...(token ? { 'X-Bill-Token': token } : {}),
        },
        body: body ?? (payload ? JSON.stringify(payload) : undefined),
      }),
      f.env,
      ctx,
    );
  f.login = async () => {
    const response = await f.request('/api/login', {
      method: 'POST',
      payload: { key: 'test-key' },
    });
    return response.headers.get('Set-Cookie').split(';')[0];
  };
  f.newBill = async () => {
    const cookie = await f.login();
    const { id } = await (
      await f.request('/api/billing', { method: 'POST', payload: draft, cookie })
    ).json();
    const row = db.prepare('SELECT * FROM bills WHERE id=?').get(id);
    return { id, cookie, row, payers: JSON.parse(row.payload).payers };
  };
  return f;
}
const slipAnswer = (payer, extra = {}) => ({
  response: { ...good, amount: payer.amount, date_text: '02 ต.ค. 69', ...extra },
});
const args = (bill, payer, slipKey) => ({
  bill: bill.row,
  payer,
  slipKey,
  bytes: jpeg,
  contentType: 'image/jpeg',
  now: checkedAt,
});

test('checkSlip stores a done row without touching the bill', async t => {
  const f = fixture(t);
  const bill = await f.newBill();
  const [nut] = bill.payers;
  f.ai.answer = () => slipAnswer(nut);
  await checkSlip(f.env, args(bill, nut, 'k1'));
  const row = f.db.prepare('SELECT * FROM slip_checks WHERE slip_key=?').get('k1');
  assert.equal(row.state, 'done');
  assert.deepEqual(JSON.parse(row.labels), [{ code: 'ok' }]);
  assert.equal(row.read_amount, nut.amount * 100);
  assert.equal(row.read_date, '2026-10-02');
  const after = f.db.prepare('SELECT revision, payload FROM bills WHERE id=?').get(bill.id);
  assert.equal(after.revision, bill.row.revision);
  assert.equal(after.payload, bill.row.payload);
});

test('checkSlip records an error row and never throws when the AI fails', async t => {
  const f = fixture(t);
  const bill = await f.newBill();
  f.ai.answer = () => Promise.reject(new Error('quota'));
  await checkSlip(f.env, args(bill, bill.payers[0], 'k1'));
  assert.equal(f.db.prepare('SELECT state FROM slip_checks').get().state, 'error');
});

test('duplicate refs flag other payers but never the same payer re-sending', async t => {
  const f = fixture(t);
  const bill = await f.newBill();
  const [nut, bua] = bill.payers;
  const reasons = key =>
    JSON.parse(f.db.prepare('SELECT labels FROM slip_checks WHERE slip_key=?').get(key).labels);
  f.ai.answer = () => slipAnswer(nut, { ref: 'KSA00000001078339102' });
  await checkSlip(f.env, args(bill, nut, 'k1'));
  f.ai.answer = () => slipAnswer(nut, { ref: 'KSA00000001078339102' });
  await checkSlip(f.env, args(bill, nut, 'k2'));
  assert.deepEqual(reasons('k2'), [{ code: 'ok' }]);
  f.ai.answer = () => slipAnswer(bua, { ref: 'KSA0000000I078339102' });
  await checkSlip(f.env, args(bill, bua, 'k3'));
  assert.deepEqual(reasons('k3'), [
    { code: 'duplicate_ref', billDate: '2026-10-01', payerName: 'Nut' },
  ]);
  f.ai.answer = () => slipAnswer(nut, { ref: '987654' });
  await checkSlip(f.env, args(bill, nut, 'k4'));
  f.ai.answer = () => slipAnswer(bua, { ref: '987654' });
  await checkSlip(f.env, args(bill, bua, 'k5'));
  assert.deepEqual(reasons('k5'), [{ code: 'ok' }]);
});

test('slipChecksFor returns known keys only', async t => {
  const f = fixture(t);
  const bill = await f.newBill();
  const [nut] = bill.payers;
  f.ai.answer = () => slipAnswer(nut);
  await checkSlip(f.env, args(bill, nut, 'k1'));
  const found = await slipChecksFor(f.env.DB, ['k1', 'missing']);
  assert.deepEqual([...found.keys()], ['k1']);
  assert.deepEqual(found.get('k1'), {
    state: 'done',
    reasons: [{ code: 'ok' }],
    readAmount: nut.amount * 100,
    readDate: '2026-10-02',
    checkedAt: checkedAt.getTime(),
  });
});

test('pruneSlipChecks drops rows older than 180 days only', async t => {
  const f = fixture(t);
  const bill = await f.newBill();
  const [nut] = bill.payers;
  f.ai.answer = () => slipAnswer(nut);
  await checkSlip(f.env, args(bill, nut, 'seed'));
  const now = Date.UTC(2027, 5, 1),
    day = 86400000;
  const add = f.db.prepare(
    "INSERT INTO slip_checks (slip_key,club,bill_id,payer_id,state,checked_at) VALUES (?, 'sena', 'b', 'p', 'done', ?)",
  );
  add.run('old', now - 181 * day);
  add.run('recent', now - 179 * day);
  await pruneSlipChecks(f.env, now);
  const keys = f.db.prepare('SELECT slip_key FROM slip_checks ORDER BY slip_key').all();
  assert.deepEqual(
    keys.map(r => r.slip_key),
    ['recent'],
  );
});
