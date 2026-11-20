import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { DatabaseSync } from 'node:sqlite';
import worker from './worker.js';
import { billingLineText, paidSummary } from './billing.js';
import './public/custom-split.js';

const { split } = globalThis.SenaCustomSplit ?? {};
const A = { name: 'Nut', payerKey: 'member:1' },
  B = { name: 'Bua', payerKey: 'member:2' },
  C = { name: 'Pim', payerKey: 'member:3' },
  G = { name: 'บอส', payerKey: 'member:2', guest: true };

test('even: 1000 บาท 3 คน → share รวมเท่ายอด, แถวปัดขึ้นบาท', () => {
  const r = split({ mode: 'even', people: [A, B, C], total: 100000, receiver: 'member:1' });
  assert.equal(r.total, 100000);
  assert.deepEqual(
    r.payers.map(p => p.shares[0].amount),
    [33334, 33333, 33333],
  );
  assert.deepEqual(
    r.payers.map(p => p.amount),
    [33400, 33400, 33400],
  );
  assert.deepEqual(
    r.payers.map(p => p.owner),
    [true, false, false],
  );
});

test('guest รวมยอดเข้าแถวสมาชิกเจ้าของ', () => {
  const r = split({ mode: 'even', people: [A, B, G], total: 90000, receiver: 'member:1' });
  assert.equal(r.payers.length, 2);
  const bua = r.payers.find(p => p.payerKey === 'member:2');
  assert.equal(bua.name, 'Bua');
  assert.deepEqual(bua.shares, [
    { name: 'Bua', amount: 30000 },
    { name: 'บอส', amount: 30000 },
  ]);
  assert.equal(bua.amount, 60000);
});

test('manual: ยอดเองมีเศษสตางค์ → ปัดขึ้นต่อแถว, ยอด 0 ไม่มีแถว (ยกเว้นคนรับเงิน)', () => {
  const r = split({
    mode: 'manual',
    people: [A, B, C],
    amounts: [0, 12050, 0],
    receiver: 'member:1',
  });
  assert.equal(r.total, 12050);
  assert.deepEqual(
    r.payers.map(p => [p.payerKey, p.amount]),
    [
      ['member:1', 0],
      ['member:2', 12100],
    ],
  );
});

test('items: แต่ละรายการแบ่งเฉพาะคนในรายการ', () => {
  const r = split({
    mode: 'items',
    people: [A, B, C],
    receiver: 'member:1',
    items: [
      { name: 'หมูกระทะ', price: 90000, people: [0, 1, 2] },
      { name: 'เบียร์', price: 30001, people: [0, 1] },
    ],
  });
  assert.equal(r.total, 120001);
  assert.deepEqual(
    r.payers.map(p => p.shares[0].amount),
    [45001, 45000, 30000],
  );
});

test('ข้อผิดพลาด: คนไม่อยู่ในรายการไหน, ไม่มีคนจ่ายนอกจากคนรับเงิน, คนรับเงินเป็น guest', () => {
  assert.match(
    split({
      mode: 'items',
      people: [A, B, C],
      receiver: 'member:1',
      items: [{ name: 'x', price: 100, people: [0, 1] }],
    }).error,
    /Pim/,
  );
  assert.ok(
    split({ mode: 'manual', people: [A, B], amounts: [500, 0], receiver: 'member:1' }).error,
  );
  assert.ok(split({ mode: 'even', people: [A, B], total: 100, receiver: 'member:9' }).error);
});

test('ขอบเขต: จำนวนคน/ยอดรวม/รายการ ผิดช่วงต้องมี error', () => {
  const many = Array.from({ length: 41 }, (_, i) => ({ name: 'p' + i, payerKey: 'member:' + i }));
  assert.ok(split({ mode: 'even', people: many, total: 100000, receiver: 'member:0' }).error);
  assert.ok(split({ mode: 'even', people: [A, B], total: 99, receiver: 'member:1' }).error);
  assert.ok(split({ mode: 'even', people: [A, B], total: 10000001, receiver: 'member:1' }).error);
  assert.ok(split({ mode: 'items', people: [A, B], items: [], receiver: 'member:1' }).error);
  assert.ok(split({ mode: 'even', people: [A], total: 100000, receiver: 'member:1' }).error);
});

// ---- worker: custom bills ----
const origin = 'https://sena.example';
const users = { a: 'U' + 'a'.repeat(32), b: 'U' + 'b'.repeat(32), c: 'U' + 'c'.repeat(32) };
const today = (offsetDays = 0) =>
  new Date(Date.now() + 7 * 3600000 + offsetDays * 86400000).toISOString().slice(0, 10);
function fixture(t) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  db.exec(
    'CREATE TABLE club_state(id INTEGER PRIMARY KEY,revision INTEGER,payload TEXT,updated_at TEXT);CREATE TABLE login_attempts(ip TEXT PRIMARY KEY,window INTEGER,attempts INTEGER)',
  );
  db.prepare('INSERT INTO club_state VALUES(1,1,?,?)').run(
    JSON.stringify({
      players: ['Nut', 'Pete', 'Bua', 'Solo'].map((name, i) => ({
        id: 'p' + i,
        name,
        thai: '',
        lv: 7,
        gender: 'M',
      })),
      selected: [],
      rounds: 10,
      locks: [],
      result: null,
      cup: null,
    }),
    'initial',
  );
  const binding = {
    prepare(sql) {
      const stmt = db.prepare(sql);
      let args = [];
      return {
        bind(...v) {
          args = v.map(x => (x instanceof ArrayBuffer ? new Uint8Array(x) : x));
          return this;
        },
        first() {
          return stmt.get(...args);
        },
        all() {
          return { results: stmt.all(...args) };
        },
        run() {
          return { meta: { changes: stmt.run(...args).changes } };
        },
      };
    },
  };
  binding.batch = statements => {
    db.exec('BEGIN');
    try {
      const results = statements.map(s => s.run());
      db.exec('COMMIT');
      return results;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  };
  const env = {
    DB: binding,
    SLIPS_DB: binding,
    ADMIN_KEY: 'test-key',
    LINE_MEMBER_AUTH_ENABLED: 'true',
    LINE_LOGIN_CHANNEL_ID: '12345',
    LINE_LIFF_ID: '12345-test',
    LINE_CHANNEL_ACCESS_TOKEN: 'fixture-token',
  };
  let identity = users.a;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, 'https://api.line.me/oauth2/v2.1/verify');
    assert.equal(options.body.get('client_id'), '12345');
    return Response.json({
      sub: identity,
      iss: 'https://access.line.me',
      aud: '12345',
      exp: Math.floor(Date.now() / 1000) + 3600,
      name: 'LINE name',
    });
  });
  const request = (path, body, cookie = '', method, extra = {}) =>
    worker.fetch(
      new Request(origin + path, {
        method: method ?? (body ? 'POST' : 'GET'),
        headers: { Origin: origin, Cookie: cookie, ...extra },
        ...(body ? { body: body instanceof Uint8Array ? body : JSON.stringify(body) } : {}),
      }),
      env,
    );
  const cookieOf = r => r.headers.get('Set-Cookie').split(';')[0];
  const login = async (user, player) => {
    identity = user;
    const status = await worker.fetch(
      new Request(origin + '/api/member', { headers: { Origin: origin } }),
      env,
    );
    const info = await status.json();
    const r = await worker.fetch(
      new Request(origin + '/api/member/login', {
        method: 'POST',
        headers: { Origin: origin, Cookie: cookieOf(status), 'X-Member-CSRF': info.csrf },
        body: JSON.stringify({ idToken: 'verified-by-line' }),
      }),
      env,
    );
    assert.equal(r.status, 200);
    const cookie = cookieOf(r);
    if (player)
      assert.equal((await request('/api/member/link', { playerId: player }, cookie)).status, 200);
    return cookie;
  };
  const admin = async () => cookieOf(await request('/api/login', { key: env.ADMIN_KEY }));
  const create = (cookie, body, club = 'sena') =>
    request('/api/billing?action=custom&club=' + club, body, cookie);
  return { db, env, request, login, admin, create };
}
const base = (over = {}) => ({
  title: 'ข้าวหลังตี',
  date: today(),
  transfer: '0812345678',
  receiver: 'member:p0',
  mode: 'even',
  total: 90000,
  people: [
    { payerKey: 'member:p0' },
    { payerKey: 'member:p1' },
    { name: 'บอส', guestOf: 'member:p1' },
  ],
  ...over,
});
const row = (f, id) => {
  const r = f.db.prepare('SELECT * FROM bills WHERE id=?').get(id);
  return { ...r, ...JSON.parse(r.payload) };
};

test('custom bill: สมาชิกสร้างได้ ชื่อจาก roster แถวคนรับเงินเป็น paid/owner', async t => {
  const f = fixture(t),
    a = await f.login(users.a, 'p0');
  await f.login(users.b, 'p1');
  const r = await f.create(
    a,
    base({
      people: [
        { payerKey: 'member:p0', name: 'ปลอม' },
        { payerKey: 'member:p1', name: 'ปลอม2' },
        { name: 'บอส', guestOf: 'member:p1' },
      ],
    }),
  );
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.existing, false);
  assert.match(body.notice.text, /ข้าวหลังตี/);
  const bill = row(f, body.id);
  assert.equal(bill.kind, 'custom');
  assert.match(bill.session_date, /^\d{4}-\d{2}-\d{2}\/[a-f0-9]{32}$/);
  assert.equal(bill.createdBy.userId, users.a);
  assert.deepEqual(
    bill.payers.map(p => p.name),
    ['Nut', 'Pete'],
  );
  const [owner, pete] = bill.payers;
  assert.equal(owner.status, 'paid');
  assert.equal(owner.method, 'owner');
  assert.equal(pete.status, 'unpaid');
  assert.equal(pete.amount, 60000);
  assert.deepEqual(
    pete.shares.map(s => s.name),
    ['Pete', 'บอส'],
  );
});

test('custom bill: ปฏิเสธ payerKey ที่ไม่ใช่สมาชิก, guestOf ที่ไม่อยู่ในบิล, receiver เป็น guest, ไม่ล็อกอิน, ชื่อบิลยาว, วันที่ไกลเกิน', async t => {
  const f = fixture(t),
    a = await f.login(users.a, 'p0');
  await f.login(users.b, 'p1');
  const bad = async (over, status = 400) =>
    assert.equal((await f.create(a, base(over))).status, status, JSON.stringify(over));
  await bad({ people: [{ payerKey: 'member:p0' }, { payerKey: 'member:nope' }] });
  await bad({ people: [{ payerKey: 'member:p0' }, { payerKey: 'member:p3' }] }); // Solo has no LINE link
  await bad({
    people: [
      { payerKey: 'member:p0' },
      { payerKey: 'member:p1' },
      { name: 'x', guestOf: 'member:p3' },
    ],
  });
  await bad({ receiver: 'member:p3' });
  await bad({ title: 'ย'.repeat(41) });
  await bad({ title: '  ' });
  await bad({ date: today(-31) });
  await bad({ date: today(2) });
  await bad({ transfer: 'abc' });
  await bad({
    people: [
      { payerKey: 'member:p0' },
      { payerKey: 'member:p1' },
      { name: 'Pete', guestOf: 'member:p1' },
      { name: 'pete', guestOf: 'member:p1' },
    ],
  });
  assert.equal((await f.create('', base())).status, 401);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM bills').get().n, 0);
});

test('custom bill: สมาชิกมีบิลค้างได้ 5 ใบ ใบที่ 6 ได้ 409; ผู้จัดไม่จำกัด', async t => {
  const f = fixture(t),
    a = await f.login(users.a, 'p0');
  await f.login(users.b, 'p1');
  for (let i = 0; i < 5; i++) assert.equal((await f.create(a, base())).status, 200);
  assert.equal((await f.create(a, base())).status, 409);
  const organizer = await f.admin();
  for (let i = 0; i < 6; i++) assert.equal((await f.create(organizer, base())).status, 200);
});

test('custom bill: เพดาน 5 ใบนับแยกก๊วน บิลก๊วน 88 ไม่กินโควตา Sena', async t => {
  const f = fixture(t),
    a = await f.login(users.a, 'p0');
  await f.login(users.b, 'p1');
  assert.equal((await f.create(a, base())).status, 200); // creates the lazy bills table
  const payload = JSON.stringify({ kind: 'custom', createdBy: { userId: users.a }, payers: [] });
  for (let i = 0; i < 5; i++)
    f.db
      .prepare('INSERT INTO bills (id,club,session_date,revision,payload) VALUES (?,?,?,0,?)')
      .run('b'.repeat(31) + i, '88', '2026-11-17/' + i, payload);
  for (let i = 0; i < 4; i++) assert.equal((await f.create(a, base())).status, 200);
  assert.equal((await f.create(a, base())).status, 409);
});

test('custom bill: action=people คืนสมาชิก approved และ me', async t => {
  const f = fixture(t),
    a = await f.login(users.a, 'p0');
  await f.login(users.b, 'p1');
  const r = await (await f.request('/api/billing?action=people&club=sena', null, a)).json();
  assert.deepEqual(r.members.map(m => m.name).sort(), ['Nut', 'Pete']);
  assert.equal(r.me, 'member:p0');
  assert.equal(r.recentSession, null);
  assert.equal((await f.request('/api/billing?action=people&club=sena')).status, 401);
});

test('custom bill: action=people คืน recentSession และ billing-custom มีตัวนับ/ปุ่มดึงคนตี/ไม่ rebuild DOM ตอนกด item-who', async t => {
  const f = fixture(t),
    a = await f.login(users.a, 'p0');
  await f.login(users.b, 'p1');
  const today = new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
  f.db.exec(
    'CREATE TABLE IF NOT EXISTS booking_clubs (club TEXT PRIMARY KEY, payload TEXT NOT NULL)',
  );
  f.db.prepare('INSERT INTO booking_clubs (club, payload) VALUES (?, ?)').run(
    'sena',
    JSON.stringify({
      sessions: [
        {
          date: today,
          start: '19:00',
          end: '21:00',
          capacity: 2,
          registrations: [{ playerId: 'p0' }, { playerId: 'p1' }, { playerId: 'p2' }],
          withdrawals: [],
        },
      ],
    }),
  );
  const r = await (await f.request('/api/billing?action=people&club=sena', null, a)).json();
  assert.deepEqual(r.recentSession, {
    date: today,
    time: '19:00–21:00',
    payerKeys: ['member:p0', 'member:p1'],
  });
  const js = read('./public/billing-custom.js');
  assert.match(js, /id="cbCount"/);
  assert.match(js, /id="cbPullRecent"/);
  assert.match(js, /t\.setAttribute\('aria-pressed', String\(who\.has\(t\.dataset\.id\)\)\)/);
});

test('custom bill: ป้ายใช้ชื่อบิลแทน "บิลเพิ่มเติม"', async t => {
  const f = fixture(t),
    a = await f.login(users.a, 'p0');
  await f.login(users.b, 'p1');
  const { id, notice } = await (await f.create(a, base())).json();
  assert.doesNotMatch(notice.text, /บิลเพิ่มเติม/);
  const organizer = await f.admin();
  const list = await (await f.request('/api/billing', null, organizer)).json();
  const listed = list.bills.find(b => b.id === id);
  assert.equal(listed.additional, false);
  assert.equal(listed.title, 'ข้าวหลังตี');
  assert.match(await billingLineText(f.env, 'sena', origin), /ข้าวหลังตี/);
  assert.doesNotMatch(await billingLineText(f.env, 'sena', origin), /บิลเพิ่มเติม/);
});

// ---- creator permissions ----
const slipBytes = Uint8Array.of(255, 216, 255, 224, 0, 0, 0, 0, 0, 0, 255, 217);
async function setup(t) {
  const f = fixture(t);
  const a = await f.login(users.a, 'p0'),
    b = await f.login(users.b, 'p1'),
    c = await f.login(users.c, 'p2');
  const { id } = await (await f.create(a, base())).json();
  const path = '/api/billing?club=sena&bill=' + id;
  const view = async (cookie, token) =>
    (await f.request(path, null, cookie, 'GET', token ? { 'X-Bill-Token': token } : {})).json();
  const act = (cookie, action, body) => f.request(path + '&action=' + action, body, cookie);
  return { f, a, b, c, id, path, view, act };
}

test('creator manages own custom bill: sees all rows, cash, undo, cancel, restore, no AI results', async t => {
  const { a, view, act } = await setup(t);
  let v = await view(a);
  assert.equal(v.viewer, 'creator');
  assert.equal(v.payers.length, 2);
  assert(Number.isInteger(v.revision));
  assert(v.payers.every(p => !('aiCheck' in p)));
  const pete = v.payers.find(p => p.name === 'Pete');
  assert.equal(
    (await act(a, 'cash', { payer: pete.id, revision: v.revision, received: true })).status,
    200,
  );
  v = await view(a);
  assert.equal(v.canUndoCash, true);
  assert.equal(
    (await act(a, 'cash', { payer: pete.id, revision: v.revision, received: false })).status,
    200,
  );
  v = await view(a);
  assert.equal((await act(a, 'cancel', { revision: v.revision })).status, 200);
  v = await view(a);
  assert.equal(v.cancelled, true);
  assert.equal((await act(a, 'restore', { revision: v.revision })).status, 200);
});

test("other members and strangers cannot manage a creator's bill; creators cannot manage organizer bills or run AI checks", async t => {
  const { f, a, b, c, view, act } = await setup(t);
  const v = await view(a);
  const pete = v.payers.find(p => p.name === 'Pete');
  const mine = await view(b, pete.token);
  assert.equal(mine.payers.length, 1);
  assert.equal(mine.revision, undefined);
  const publicView = await view(b);
  assert.equal(publicView.revision, undefined);
  assert(publicView.payers.every(p => !p.token));
  const attempts = [
    ['cash', { payer: pete.id, revision: v.revision, received: true }],
    ['edit', { revision: v.revision, transfer: '0899999999' }],
    ['cancel', { revision: v.revision }],
    ['restore', { revision: v.revision }],
    ['slip-check', { payer: pete.id }],
  ];
  for (const cookie of [b, c, ''])
    for (const [action, body] of attempts)
      assert.equal((await act(cookie, action, body)).status, 401, action);
  assert.equal((await act(a, 'slip-check', { payer: pete.id })).status, 401);
  const organizer = await f.admin();
  const other = await (await f.create(organizer, base())).json();
  const res = await f.request(
    '/api/billing?club=sena&action=cancel&bill=' + other.id,
    { revision: 0 },
    a,
  );
  assert.equal(res.status, 401);
});

test('owner row does not block edit; a real payment does (only PromptPay changes then)', async t => {
  const { a, b, view, act } = await setup(t);
  let v = await view(a);
  assert.equal(v.editable, true);
  const pete = v.payers.find(p => p.name === 'Pete');
  const edited = {
    title: 'ข้าวใหม่',
    transfer: '0812345678',
    receiver: 'member:p0',
    mode: 'items',
    items: [
      { name: 'หมู', price: 60000, people: [0, 1, 2] },
      { name: 'เบียร์', price: 30000, people: [1, 2] },
    ],
    people: base().people,
    revision: v.revision,
  };
  assert.equal((await act(a, 'edit', edited)).status, 200);
  v = await view(a);
  const after = v.payers.find(p => p.name === 'Pete');
  assert.equal(after.token, pete.token);
  assert.equal(after.amount, 70000);
  assert.equal(v.title, 'ข้าวใหม่');
  const upload = await act(
    b,
    'upload&payer=' +
      after.id +
      '&amount=' +
      after.amount +
      '&paymentRevision=' +
      v.paymentRevision,
    slipBytes,
  );
  assert.equal(upload.status, 200);
  v = await view(a);
  assert.equal(v.editable, false);
  assert.equal((await act(a, 'edit', { ...edited, revision: v.revision })).status, 409);
  assert.equal(
    (await act(a, 'edit', { revision: v.revision, transfer: '0899999999' })).status,
    200,
  );
});

test('creator can view and reject slips on own bill, other members cannot view them, owner row is untouchable', async t => {
  const { a, b, c, view, act, path, f } = await setup(t);
  let v = await view(a);
  const pete = v.payers.find(p => p.name === 'Pete'),
    owner = v.payers.find(p => p.name === 'Nut');
  assert.equal(
    (
      await act(
        b,
        'upload&payer=' + pete.id + '&amount=' + pete.amount + '&paymentRevision=0',
        slipBytes,
      )
    ).status,
    200,
  );
  const slipPath = path + '&action=slip&payer=' + pete.id;
  const seen = await f.request(slipPath, null, a);
  assert.equal(seen.status, 200);
  assert.equal(seen.headers.get('Content-Type'), 'image/jpeg');
  assert.equal((await f.request(slipPath, null, c)).status, 403);
  v = await view(a);
  const withSlip = v.payers.find(p => p.name === 'Pete');
  assert.equal(
    (
      await act(a, 'review', {
        payer: withSlip.id,
        status: 'rejected',
        note: 'ยอดไม่ตรง',
        receiptId: withSlip.receiptId,
      })
    ).status,
    200,
  );
  v = await view(a);
  assert.equal(
    (await act(a, 'review', { payer: owner.id, status: 'rejected', note: 'x', receiptId: 'x' }))
      .status,
    409,
  );
  assert.equal(
    (await act(a, 'cash', { payer: owner.id, revision: v.revision, received: false })).status,
    409,
  );
});

// ---- member bills list ----
test('member bills include title and the bills I created', async t => {
  const { f, a, b, c, id } = await setup(t);
  const mine = await (await f.request('/api/member/bills?club=sena', null, b)).json();
  assert.equal(mine.bills.length, 1);
  assert.equal(mine.bills[0].title, 'ข้าวหลังตี');
  assert.equal(mine.bills[0].amount, 60000);
  assert.deepEqual(mine.created, []);
  const creator = await (await f.request('/api/member/bills?club=sena', null, a)).json();
  assert.equal(creator.created.length, 1);
  const made = creator.created[0];
  assert.equal(made.id, id);
  assert.equal(made.title, 'ข้าวหลังตี');
  assert.equal(made.date, today());
  assert.equal(made.cancelled, false);
  assert.equal(made.count, 2);
  assert.equal(made.paid, 1);
  assert.equal(made.outstanding, 60000);
  assert.equal(made.url, `/billing.html?manage=1&club=sena&bill=${id}`);
  const other = await (await f.request('/api/member/bills?club=sena', null, c)).json();
  assert.deepEqual(other.created, []);
  assert.deepEqual(other.bills, []);
});

// ---- frontend wiring (file checks, like test-billing.mjs) ----
const read = file => readFileSync(new URL(file, import.meta.url), 'utf8');

test('billing.html loads the splitter and the form before billing.js', () => {
  const html = read('./public/billing.html');
  const at = name => html.indexOf(name);
  assert(at('/custom-split.js') > 0 && at('/billing-custom.js') > 0);
  assert(at('/custom-split.js') < at('/billing.js'));
  assert(at('/billing-custom.js') < at('/billing.js'));
});

test('billing.js opens the form from ?custom=new, fetches members and posts action=custom', () => {
  const js = read('./public/billing.js');
  assert.match(js, /params\.get\('custom'\) === 'new'/);
  assert.match(js, /action=people/);
  assert.match(js, /post\('custom'/);
});

test('billing-custom.js escapes every name it puts into innerHTML', () => {
  const js = read('./public/billing-custom.js');
  for (const [, expr] of js.matchAll(/\$\{([^}]*)\}/g))
    if (/\b(name|title|value|transfer)\b/.test(expr) && !/esc\(|money\(|\.length/.test(expr))
      assert.fail('unescaped interpolation: ' + expr);
  for (const label of ['หารเท่ากัน', 'ใส่ยอดเอง', 'แยกรายการ', '+ เพิ่มแขก', 'เปิดบิล'])
    assert(js.includes(label), label);
});

test('the build checks the new browser file', () => {
  assert.match(read('./package.json'), /node --check public\/billing-custom\.js/);
});

// ---- bill page (Task 6) ----
test('creator view carries the saved split for editing; a payer view does not', async t => {
  const { a, b, view } = await setup(t);
  const v = await view(a);
  assert.equal(v.draft.mode, 'even');
  assert.equal(v.draft.total, 90000);
  assert.equal(v.draft.people.length, 3);
  assert.equal(v.draft.receiver, 'member:p0');
  assert.equal(v.mode, 'even');
  const pete = v.payers.find(p => p.name === 'Pete');
  const mine = await view(b, pete.token);
  assert.equal(mine.draft, undefined);
});

test('bill page shows the title, hides organizer-only buttons from creators and handles owner rows', () => {
  const js = read('./public/billing.js');
  assert.match(js, /bill\.kind === 'custom'[\s\S]{0,80}escape\(bill\.title\)/);
  assert.match(js, /const isAdmin = organizer && bill\.viewer === 'admin'/);
  assert.match(js, /\$\{isAdmin \? '<button type="button" data-action="mention-diagnostics"/);
  assert.match(js, /isAdmin\s*\?\s*`<a class="button" href="\/billing\.html\?manage=1&club=/);
  assert.match(js, /p\.method === 'owner'/);
  assert.match(js, /showCustom\(\{[\s\S]{0,160}draft: bill\.draft/);
  assert.match(js, /post\('edit', \{ \.\.\.data, revision: bill\.revision \}\)/);
});

test("lists show the title, never mistake a custom bill for the day's badminton bill, and list my own bills", () => {
  const js = read('./public/billing.js');
  assert.match(js, /!b\.additional && b\.kind !== 'custom'/);
  assert.match(js, /escape\(b\.title\)/);
  assert.match(js, /data\.created/);
  assert.match(js, /บิลที่ฉันสร้าง/);
  assert.match(js, /bill\.title/);
});

test('people list works for the organizer even before any member table exists', async t => {
  const f = fixture(t);
  const organizer = await f.admin();
  const res = await f.request('/api/billing?action=people&club=sena', null, organizer);
  assert.equal(res.status, 200);
  assert.deepEqual((await res.json()).members, []);
});

test("paid summary card never counts the organizer's own row as money received", async t => {
  const { f, a, id, view, act } = await setup(t);
  const v = await view(a);
  const pete = v.payers.find(p => p.name === 'Pete');
  assert.equal(
    (await act(a, 'cash', { payer: pete.id, revision: v.revision, received: true })).status,
    200,
  );
  const info = await paidSummary(f.env, id);
  assert.equal(info.full, true);
  assert.equal(info.paidSum, 60000);
  assert.deepEqual(info.cash, { count: 1, sum: 60000 });
  assert.deepEqual(info.transfer, { count: 0, sum: 0 });
});

test('re-tapping the bills tab does not wipe the custom bill form', () => {
  const js = read('./public/billing.js');
  assert.match(js, /event\.data === 'bills-refresh' &&\s*!id &&\s*!editing &&\s*!customOpen/);
  assert.match(js, /customOpen = true/);
});

// ---- collect page (Badbot menu → เก็บเงิน) ----
test('collect page: two tabs, the court tab only for organizers, organizers start on it', () => {
  const js = read('./public/billing.js');
  assert.match(js, /params\.get\('collect'\) === '1'/);
  assert.match(
    js,
    /organizer\s*\?\s*`<button[^`]*data-tab="court"[^`]*>เก็บเงินค่าคอร์ต<\/button>`/,
  );
  assert.match(js, /เก็บเงินทั่วไป/);
  assert.match(js, /tab = organizer \? tab \|\| 'court' : 'general'/);
  // Single unified entry point visible to everyone on the bills home page, styled green (.create-bill).
  assert.equal((js.match(/collect=1&club=\$\{club\}/g) || []).length, 1);
  assert.match(
    js,
    /class="button create-bill" href="\/billing\.html\?collect=1&club=\$\{club\}">💸 เก็บเงิน/,
  );
  assert.doesNotMatch(js, /สร้างบิลใหม่/);
  assert.doesNotMatch(js, /canCollect/);
  assert.doesNotMatch(js, /manage=1&new=1&club=/);
});

test('LIFF collect page lands on the bills tab in collect mode', () => {
  const liff = read('./public/liff.js');
  assert.match(liff, /params\.get\('page'\) === 'collect'/);
  assert.match(liff, /set\('bills', 'collect'\)/);
  assert.match(liff, /pay \? 'pay' : collect \? 'collect' : 'book'/);
  const shell = read('./public/next-shell.js');
  assert.match(shell, /get\('bills'\) === 'collect'/);
  assert.match(shell, /set\('collect', '1'\)/);
});

// Run the real liff.js for an already logged-in, linked member and report where it sends them.
async function liffLands(search, session = {}) {
  const replaced = [];
  const location = {
    search,
    hash: '',
    origin: 'https://sena.example',
    href: 'https://sena.example/liff.html' + search,
    replace: url => replaced.push(url),
  };
  const element = () => ({ textContent: '', hidden: false, append() {}, replaceChildren() {} });
  const sandbox = {
    location,
    URL,
    URLSearchParams,
    console,
    sessionStorage: { setItem() {}, getItem() {} },
    document: { getElementById: element, createElement: element },
    fetch: async () =>
      Response.json({
        enabled: true,
        configured: true,
        loggedIn: true,
        link: { status: 'approved' },
        csrf: 'x',
        ...session,
      }),
  };
  sandbox.window = sandbox;
  await vm.runInNewContext(read('./public/liff.js'), sandbox);
  return replaced;
}

test('LIFF sends a logged-in member to the page they asked for (book, collect, pay)', async () => {
  assert.deepEqual(await liffLands('?club=sena&page=book'), ['/court#booking']);
  assert.deepEqual(await liffLands('?club=88&page=book'), ['/court?club=88#booking']);
  assert.deepEqual(await liffLands('?club=sena&page=collect'), ['/court?bills=collect#bills']);
  assert.deepEqual(await liffLands('?club=88&page=collect'), [
    '/court?club=88&bills=collect#bills',
  ]);
  assert.deepEqual(await liffLands('?club=sena&page=pay'), ['/court#bills']);
  const bill = 'a'.repeat(32);
  assert.deepEqual(await liffLands('?club=sena&page=pay&bill=' + bill), [
    '/court?bill=' + bill + '#bills',
  ]);
  assert.deepEqual(
    await liffLands('?liff.state=' + encodeURIComponent('?club=88&page=pay&bill=' + bill)),
    ['/court?club=88&bill=' + bill + '#bills'],
  );
  // LINE hands the original query over as liff.state
  assert.deepEqual(
    await liffLands('?liff.state=' + encodeURIComponent('?club=sena&page=collect')),
    ['/court?bills=collect#bills'],
  );
});

test('member_promptpay: จำเลขเฉพาะของตัวเอง ใช้ได้ทั้งสองก๊วน ไม่เปิดเผยให้คนอื่น และไม่ทับเมื่อสร้างแทนเพื่อน', async t => {
  const f = fixture(t),
    a = await f.login(users.a, 'p0'),
    b = await f.login(users.b, 'p1');
  // Before creating any bill, myPromptpay is empty.
  const before = await (await f.request('/api/billing?action=people&club=sena', null, a)).json();
  assert.equal(before.myPromptpay, '');

  // User A creates a custom bill as receiver -> saved to member_promptpay.
  assert.equal(
    (await f.create(a, base({ transfer: '0891112222', receiver: 'member:p0' }))).status,
    200,
  );
  const afterA = await (await f.request('/api/billing?action=people&club=sena', null, a)).json();
  assert.equal(afterA.myPromptpay, '0891112222');

  // Privacy: user B never sees user A's PromptPay.
  const afterB = await (await f.request('/api/billing?action=people&club=sena', null, b)).json();
  assert.equal(afterB.myPromptpay, '');

  // User A creates a bill on behalf of B (receiver !== me) -> must NOT overwrite A's saved PromptPay.
  assert.equal(
    (await f.create(a, base({ transfer: '0899998888', receiver: 'member:p1' }))).status,
    200,
  );
  const stillA = await (await f.request('/api/billing?action=people&club=sena', null, a)).json();
  assert.equal(stillA.myPromptpay, '0891112222');

  // Shared across clubs (user_id is global across Sena and 88).
  const adminCookie = await f.admin();
  const s88 = await (
    await f.request('/api/billing?action=people&club=88', null, `${a}; ${adminCookie}`)
  ).json();
  assert.equal(s88.myPromptpay, '0891112222');
});

test('court bill: คนสร้างบิลขึ้นสถานะ paid/owner อัตโนมัติ จำเลขพร้อมเพย์รายคน และแก้บิลแล้วยังคงสถานะเดิม', async t => {
  const f = fixture(t),
    a = await f.login(users.a, 'p0'),
    b = await f.login(users.b, 'p1'),
    adminCookie = await f.admin();
  const orgA = `${adminCookie}; ${a}`;
  const orgB = `${adminCookie}; ${b}`;

  // Set global default promptpay in billing_settings.
  assert.equal(
    (await f.request('/api/billing?action=promptpay&club=sena', { promptpay: '0800000000' }, orgA))
      .status,
    200,
  );

  // Before organizer A saves their own number, sessions falls back to global default and exposes me.
  const s1 = await (await f.request('/api/billing?action=sessions&club=sena', null, orgA)).json();
  assert.equal(s1.me, 'member:p0');
  assert.equal(s1.promptpay, '0800000000');

  // Organizer A creates a court bill with A (p0) and B (p1) using A's personal PromptPay.
  const d = today();
  const created = await f.request(
    '/api/billing?club=sena',
    {
      date: d,
      court: 40000,
      shuttle: 20000,
      transfer: '0812223333',
      attendees: [
        { name: 'เอ', payer: 'เอ', payerKey: 'member:p0' },
        { name: 'บี', payer: 'บี', payerKey: 'member:p1' },
      ],
    },
    orgA,
  );
  assert.equal(created.status, 200);
  const { id } = await created.json();
  const bill = row(f, id);
  assert.equal(bill.receiver, 'member:p0');
  assert.equal(bill.closed_at, null);
  const payerA = bill.payers.find(p => p.payerKey === 'member:p0');
  const payerB = bill.payers.find(p => p.payerKey === 'member:p1');
  assert.equal(payerA.status, 'paid');
  assert.equal(payerA.method, 'owner');
  assert.equal(payerB.status, 'unpaid');

  // Bill remains editable because only the owner is marked paid; editing preserves owner paid status.
  const view = await (await f.request(`/api/billing?club=sena&bill=${id}`, null, orgA)).json();
  assert.equal(view.editable, true);
  assert.equal(view.receiver, 'member:p0');
  const edited = await f.request(
    `/api/billing?club=sena&bill=${id}&action=edit`,
    {
      revision: view.revision,
      court: 50000,
      shuttle: 20000,
      transfer: '0812223333',
      attendees: [
        { name: 'เอ', payer: 'เอ', payerKey: 'member:p0' },
        { name: 'บี', payer: 'บี', payerKey: 'member:p1' },
      ],
    },
    orgA,
  );
  assert.equal(edited.status, 200);
  const afterEdit = row(f, id);
  assert.equal(afterEdit.payers.find(p => p.payerKey === 'member:p0').method, 'owner');
  assert.equal(afterEdit.payers.find(p => p.payerKey === 'member:p0').status, 'paid');
  assert.equal(afterEdit.payers.find(p => p.payerKey === 'member:p1').status, 'unpaid');

  // Organizer A now gets their own saved PromptPay in both court sessions and custom people endpoints;
  // organizer B still falls back to global default (never sees A's number).
  const s2A = await (await f.request('/api/billing?action=sessions&club=sena', null, orgA)).json();
  assert.equal(s2A.promptpay, '0812223333');
  const p2A = await (await f.request('/api/billing?action=people&club=sena', null, orgA)).json();
  assert.equal(p2A.myPromptpay, '0812223333');
  const s2B = await (await f.request('/api/billing?action=sessions&club=sena', null, orgB)).json();
  assert.equal(s2B.promptpay, '0800000000');

  // A court bill with ONLY the creator as attendee starts closed immediately.
  const solo = await f.request(
    '/api/billing?club=sena',
    {
      date: '2026-12-01',
      court: 20000,
      shuttle: 0,
      transfer: '0812223333',
      attendees: [{ name: 'เอ', payer: 'เอ', payerKey: 'member:p0' }],
    },
    orgA,
  );
  assert.equal(solo.status, 200);
  const soloRow = row(f, (await solo.json()).id);
  assert.ok(soloRow.closed_at > 0);
  assert.equal(soloRow.payers[0].method, 'owner');
});
