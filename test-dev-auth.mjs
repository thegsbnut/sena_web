// TEMPORARY dev-login (dev-auth.js): gate, session, isolation from the real clubs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import worker from './worker.js';
import { groupMentionTarget } from './line-mentions.js';

const origin = 'https://sena.example',
  SECRET = 'x'.repeat(48);
const realRoster = JSON.stringify({
  players: [{ id: 'p0', name: 'Nut', thai: '', lv: 8, gender: 'M' }],
  selected: [],
  rounds: 10,
  locks: [],
  result: null,
  cup: null,
});

function fixture(t, envOverride = {}) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  db.exec(
    'CREATE TABLE club_state(id INTEGER PRIMARY KEY,revision INTEGER,payload TEXT,updated_at TEXT);CREATE TABLE login_attempts(ip TEXT PRIMARY KEY,window INTEGER,attempts INTEGER)',
  );
  db.prepare('INSERT INTO club_state VALUES(1,1,?,?)').run(realRoster, 'initial');
  const binding = {
    prepare(sql) {
      const stmt = db.prepare(sql);
      let args = [];
      return {
        bind(...v) {
          args = v;
          return this;
        },
        first() {
          return stmt.get(...args) ?? null;
        },
        all() {
          return { results: stmt.all(...args) };
        },
        run() {
          return { meta: { changes: stmt.run(...args).changes } };
        },
      };
    },
    batch(statements) {
      db.exec('BEGIN');
      try {
        const results = statements.map(s => s.run());
        db.exec('COMMIT');
        return results;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
  };
  const env = {
    DB: binding,
    SLIPS_DB: binding,
    ADMIN_KEY: 'test-key',
    LINE_MEMBER_AUTH_ENABLED: 'true',
    LINE_LOGIN_CHANNEL_ID: '12345',
    LINE_LIFF_ID: '12345-test',
    DEV_AUTH: 'true',
    DEV_AUTH_SECRET: SECRET,
    ...envOverride,
  };
  const lineCalls = [];
  t.mock.method(globalThis, 'fetch', async url => {
    lineCalls.push(String(url));
    return new Response('{}', { status: 500 });
  });
  const logs = [];
  t.mock.method(console, 'log', line => logs.push(String(line)));
  const request = (path, { body, cookie = '', headers = {} } = {}) =>
    worker.fetch(
      new Request(origin + path, {
        method: body ? 'POST' : 'GET',
        redirect: 'manual',
        headers: { Origin: origin, Cookie: cookie, ...headers },
        ...(body ? { body: JSON.stringify(body) } : {}),
      }),
      env,
    );
  const login = (q = {}) =>
    request(
      '/dev-login?' +
        new URLSearchParams({ key: SECRET, uid: 'U_TEST_admin1', name: 'Tester', ...q }),
    );
  const cookiesOf = r => r.headers.getSetCookie().map(c => c.split(';')[0]);
  const sessionOf = r => cookiesOf(r).find(c => c.startsWith('__Host-sena-member='));
  return { db, env, request, login, cookiesOf, sessionOf, lineCalls, logs };
}

test('dev-login is a 404 when off, without the key, or with a wrong/short key', async t => {
  for (const env of [
    { DEV_AUTH: undefined },
    { DEV_AUTH: 'false' },
    { DEV_AUTH_SECRET: 'short' },
  ]) {
    const f = fixture(t, env);
    assert.equal((await f.login()).status, 404);
  }
  const f = fixture(t);
  assert.equal((await f.request('/dev-login?uid=U_TEST_a')).status, 404);
  assert.equal((await f.login({ key: SECRET + 'y' })).status, 404);
  assert.equal((await f.login({ key: 'y'.repeat(48) })).status, 404);
  assert.ok(f.logs.some(l => l.includes('login-rejected') && l.includes('wrong_key')));
  assert.ok(!f.logs.some(l => l.includes(SECRET)), 'the key is never logged');
  assert.equal(
    f.db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name='member_test_users'").get().n,
    0,
  );
});

test('dev-login validates uid, role and name', async t => {
  const f = fixture(t);
  assert.equal((await f.login({ uid: 'U' + 'a'.repeat(32) })).status, 400);
  assert.equal((await f.login({ uid: 'U_TEST_' })).status, 400);
  assert.equal((await f.login({ role: 'owner' })).status, 400);
  assert.equal((await f.login({ name: '<b>' })).status, 400);
});

test('dev-login creates an is_test user, a 2-hour session and logs it', async t => {
  const f = fixture(t);
  const r = await f.login({ role: 'admin' });
  assert.equal(r.status, 302);
  assert.equal(new URL(r.headers.get('Location')).search, '?club=test');
  const cookies = r.headers.getSetCookie();
  const member = cookies.find(c => c.startsWith('__Host-sena-member='));
  assert.match(member, /HttpOnly/);
  assert.match(member, /Max-Age=7200/);
  assert.match(
    cookies.find(c => c.startsWith('__Host-sena-test=')),
    /Max-Age=7200/,
  );
  const user = f.db.prepare('SELECT * FROM member_test_users').get();
  assert.equal(user.user_id, 'U_TEST_admin1');
  assert.equal(user.is_test, 1);
  assert.equal(user.role, 'admin');
  const session = f.db.prepare('SELECT * FROM member_sessions').get();
  assert.ok(Math.abs(session.expires_at - Date.now() - 7200000) < 5000);
  assert.equal(
    f.db.prepare('SELECT line_name FROM member_profiles WHERE user_id=?').get('U_TEST_admin1')
      .line_name,
    'Tester',
  );
  const link = f.db.prepare('SELECT * FROM member_links').all();
  assert.deepEqual(
    link.map(l => [l.club, l.status]),
    [['test', 'approved']],
  );
  const roster = JSON.parse(f.db.prepare('SELECT payload FROM club_state_test').get().payload);
  assert.ok(roster.players.some(p => p.id === link[0].player_id && p.name === 'Tester'));
  assert.equal(f.db.prepare('SELECT payload FROM club_state').get().payload, realRoster);
  assert.ok(f.logs.some(l => l.includes('"event":"login"') && l.includes('U_TEST_admin1')));
  // Logging in again reuses the user and player.
  await f.login({ role: 'player' });
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM member_test_users').get().n, 1);
  assert.equal(f.db.prepare('SELECT role FROM member_test_users').get().role, 'player');
});

test('a test session works only on the sandbox club and is never renewed', async t => {
  const f = fixture(t);
  const cookie = f.sessionOf(await f.login({ role: 'admin' }));
  const test = await f.request('/api/member?club=test', { cookie });
  const info = await test.json();
  assert.equal(info.loggedIn, true);
  assert.equal(info.test, true);
  assert.equal(info.link.status, 'approved');
  // An old-looking session would normally be slid to 7 days on this call.
  f.db.prepare('UPDATE member_sessions SET expires_at=?').run(Date.now() + 3600000);
  const again = await f.request('/api/member?club=test', { cookie });
  assert.ok(!again.headers.getSetCookie().some(c => c.startsWith('__Host-sena-member=')));
  assert.ok(
    f.db.prepare('SELECT expires_at FROM member_sessions').get().expires_at < Date.now() + 3700000,
  );
  const real = await (await f.request('/api/member', { cookie })).json();
  assert.equal(real.loggedIn, false);
  assert.equal(real.test, undefined);
  // Admin rights on the sandbox club only.
  assert.deepEqual(await (await f.request('/api/session?club=test', { cookie })).json(), {
    canEdit: true,
    via: 'test',
  });
  assert.equal((await (await f.request('/api/session', { cookie })).json()).canEdit, false);
  assert.equal((await (await f.request('/api/session?club=88', { cookie })).json()).canEdit, false);
  // Real admin data is out of reach.
  assert.equal(
    (await f.request('/api/state', { cookie, body: { state: {}, revision: 1 } })).status,
    401,
  );
  // LINE mapping/login is closed on the sandbox club (mapBoth would write the real clubs).
  assert.equal(
    (await f.request('/api/member/link?club=test', { cookie, body: { playerId: 'p0' } })).status,
    403,
  );
  assert.equal((await f.request('/api/line?club=test', { cookie })).status, 403);
});

test('a test player is not an admin and books only in the sandbox club', async t => {
  const f = fixture(t);
  const cookie = f.sessionOf(await f.login({ uid: 'U_TEST_p1', name: 'Player One' }));
  assert.equal(
    (await (await f.request('/api/session?club=test', { cookie })).json()).canEdit,
    false,
  );
  const token = { 'X-Booking-Token': 'a'.repeat(64) };
  const doc = await (await f.request('/api/booking?club=test', { cookie, headers: token })).json();
  assert.ok(doc.sessions.length >= 1);
  const me = f.db.prepare("SELECT player_id FROM member_links WHERE club='test'").get().player_id;
  const r = await f.request('/api/booking?club=test', {
    cookie,
    headers: token,
    body: { action: 'book', playerId: me, sessionIds: [doc.sessions[0].id], acceptHoliday: true },
  });
  assert.equal(r.status, 200, JSON.stringify(await r.clone().json()));
  const stored = JSON.parse(
    f.db.prepare("SELECT payload FROM booking_clubs WHERE club='test'").get().payload,
  );
  assert.ok(stored.sessions[0].registrations.some(x => x.playerId === me));
  // The real club cannot be booked with a test session.
  const realDoc = await (await f.request('/api/booking', { cookie, headers: token })).json();
  assert.ok(!realDoc.roster.some(p => p.id === me));
  const real = JSON.parse(
    f.db.prepare("SELECT payload FROM booking_clubs WHERE club='sena'").get().payload,
  );
  assert.ok(real.sessions.every(s => s.registrations.every(x => x.playerId !== me)));
});

test('turning DEV_AUTH off ends test sessions and hides the sandbox club', async t => {
  const f = fixture(t);
  const cookie = f.sessionOf(await f.login({ role: 'admin' }));
  f.env.DEV_AUTH = 'false';
  assert.equal((await f.request('/api/member?club=test', { cookie })).status, 400);
  assert.equal((await (await f.request('/api/member', { cookie })).json()).loggedIn, false);
  assert.equal((await f.login()).status, 404);
});

test('sandbox bills and real bills never cross', async t => {
  const f = fixture(t);
  f.db.exec(
    'CREATE TABLE bills (id TEXT PRIMARY KEY, club TEXT NOT NULL, session_date TEXT NOT NULL, revision INTEGER NOT NULL, payload TEXT NOT NULL, closed_at INTEGER, slips_removed INTEGER NOT NULL DEFAULT 0, UNIQUE (club, session_date))',
  );
  const bill = (id, club) =>
    f.db
      .prepare('INSERT INTO bills VALUES(?,?,?,0,?,NULL,0)')
      .run(
        id,
        club,
        '2026-11-10',
        JSON.stringify({ date: '2026-11-10', transfer: '', payers: [], court: 0, shuttle: 0 }),
      );
  bill('realbill000000000001', 'sena');
  bill('testbill000000000001', 'test');
  const cookie = f.sessionOf(await f.login({ role: 'admin' }));
  const testList = await (await f.request('/api/billing?club=test', { cookie })).json();
  assert.deepEqual(
    testList.bills.map(b => b.id),
    ['testbill000000000001'],
  );
  assert.equal(
    (await f.request('/api/billing?club=test&bill=realbill000000000001', { cookie })).status,
    404,
  );
  const adminCookie = (await f.request('/api/login', { body: { key: 'test-key' } })).headers
    .getSetCookie()[0]
    .split(';')[0];
  const realList = await (await f.request('/api/billing', { cookie: adminCookie })).json();
  assert.deepEqual(
    realList.bills.map(b => b.id),
    ['realbill000000000001'],
  );
  assert.equal(
    (await f.request('/api/billing?bill=testbill000000000001', { cookie: adminCookie })).status,
    404,
  );
});

test('no real LINE API call is made for a test user', async t => {
  const f = fixture(t);
  const result = await groupMentionTarget(f.env, 'Cgroup', 'U_TEST_p1');
  assert.equal(result.reason, 'test_user_mocked');
  assert.deepEqual(f.lineCalls, []);
  assert.ok(f.logs.some(l => l.includes('line-api-mocked') && l.includes('U_TEST_p1')));
});

test('dev-logout removes only a test session', async t => {
  const f = fixture(t);
  const cookie = f.sessionOf(await f.login());
  const r = await f.request('/dev-logout', { cookie });
  assert.equal(r.status, 302);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM member_sessions').get().n, 0);
  assert.ok(r.headers.getSetCookie().some(c => c.startsWith('__Host-sena-member=;')));
});
