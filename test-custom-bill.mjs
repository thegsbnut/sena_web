import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import worker from './worker.js';
import { billingLineText } from './billing.js';
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
  const request = (path, body, cookie = '', method) =>
    worker.fetch(
      new Request(origin + path, {
        method: method ?? (body ? 'POST' : 'GET'),
        headers: { Origin: origin, Cookie: cookie },
        ...(body ? { body: JSON.stringify(body) } : {}),
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

test('custom bill: action=people คืนสมาชิก approved และ me', async t => {
  const f = fixture(t),
    a = await f.login(users.a, 'p0');
  await f.login(users.b, 'p1');
  const r = await (await f.request('/api/billing?action=people&club=sena', null, a)).json();
  assert.deepEqual(r.members.map(m => m.name).sort(), ['Nut', 'Pete']);
  assert.equal(r.me, 'member:p0');
  assert.equal((await f.request('/api/billing?action=people&club=sena')).status, 401);
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
