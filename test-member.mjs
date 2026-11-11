import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import worker from './worker.js';
import { defaultSettings } from './booking.js';
import { billingLineMessages } from './billing.js';
const origin = 'https://sena.example',
  uid = 'U' + 'a'.repeat(32),
  other = 'U' + 'b'.repeat(32);
function fixture(t) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  db.exec(
    'CREATE TABLE club_state(id INTEGER PRIMARY KEY,revision INTEGER,payload TEXT,updated_at TEXT);CREATE TABLE login_attempts(ip TEXT PRIMARY KEY,window INTEGER,attempts INTEGER)',
  );
  db.prepare('INSERT INTO club_state VALUES(1,1,?,?)').run(
    JSON.stringify({
      players: [
        { id: 'p0', name: 'Nut', thai: '', lv: 8, gender: 'M' },
        { id: 'p1', name: 'Pete', thai: '', lv: 7, gender: 'M' },
      ],
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
  let identity = uid,
    profileOverride = {},
    calls = 0;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (String(url).startsWith('https://api.line.me/v2/bot/group/'))
      return Response.json({ userId: String(url).split('/').at(-1) });
    assert.equal(url, 'https://api.line.me/oauth2/v2.1/verify');
    calls++;
    assert.equal(options.body.get('client_id'), '12345');
    return Response.json({
      sub: identity,
      iss: 'https://access.line.me',
      aud: '12345',
      exp: Math.floor(Date.now() / 1000) + 3600,
      name: 'Odd LINE name',
      ...profileOverride,
    });
  });
  const request = (path, body, cookie = '', extra = {}) =>
    worker.fetch(
      new Request(origin + path, {
        method: body ? 'POST' : 'GET',
        headers: { Origin: origin, Cookie: cookie, 'X-Booking-Token': 'a'.repeat(64), ...extra },
        ...(body
          ? {
              body:
                typeof body === 'object' && !(body instanceof Uint8Array)
                  ? JSON.stringify(body)
                  : body,
            }
          : {}),
      }),
      env,
    );
  const cookieOf = r => r.headers.get('Set-Cookie').split(';')[0];
  const login = async (user = uid) => {
    identity = user;
    const status = await request('/api/member');
    const info = await status.json();
    const r = await request(
      '/api/member/login',
      { idToken: 'verified-by-line' },
      cookieOf(status),
      { 'X-Member-CSRF': info.csrf },
    );
    assert.equal(r.status, 200);
    return cookieOf(r);
  };
  const admin = async () => cookieOf(await request('/api/login', { key: env.ADMIN_KEY }));
  return {
    db,
    env,
    request,
    login,
    admin,
    cookieOf,
    get calls() {
      return calls;
    },
    profile: value => (profileOverride = value),
  };
}
test('one selection creates the missing counterpart once, copying source level and gender', async t => {
  const f = fixture(t),
    member = await f.login();
  assert.equal((await f.request('/api/member/link', { playerId: 'p0' }, member)).status, 200);
  const counterpart = (await (await f.request('/api/member?club=88', null, member)).json()).link;
  assert.equal(counterpart.status, 'approved');
  assert.notEqual(counterpart.player_id, 'p0');
  const before = f.db.prepare('SELECT payload,revision FROM club_state_88 WHERE id=1').get();
  const player = JSON.parse(before.payload).players[0];
  assert.deepEqual(
    { name: player.name, lv: player.lv, gender: player.gender },
    { name: 'Nut', lv: 8, gender: 'M' },
  );
  await f.request('/api/member?club=88', null, member);
  await f.request('/api/member/link', { playerId: 'p0' }, member);
  assert.deepEqual(
    f.db.prepare('SELECT payload,revision FROM club_state_88 WHERE id=1').get(),
    before,
  );
});
test('shared mapping preserves existing counterpart IDs and never alters its level, history or bills', async t => {
  const f = fixture(t),
    member = await f.login();
  const state = {
    players: [{ id: 'old-88', name: 'Nut', thai: '', lv: 4, gender: 'M' }],
    selected: ['old-88'],
    rounds: 10,
    locks: [],
    result: null,
    cup: null,
  };
  f.db.exec(
    'CREATE TABLE club_state_88(id INTEGER PRIMARY KEY,revision INTEGER,payload TEXT,updated_at TEXT)',
  );
  f.db.prepare('INSERT INTO club_state_88 VALUES(1,9,?,?)').run(JSON.stringify(state), 'old');
  const before = f.db.prepare('SELECT * FROM club_state_88').get();
  await f.request('/api/member/link', { playerId: 'p0' }, member);
  assert.equal(
    (await (await f.request('/api/member?club=88', null, member)).json()).link.player_id,
    'old-88',
  );
  assert.deepEqual(f.db.prepare('SELECT * FROM club_state_88').get(), before);
});
test('an existing one-court account backfills both courts without asking again', async t => {
  const f = fixture(t),
    member = await f.login();
  f.db
    .prepare("INSERT INTO member_links VALUES(?,?,?,?,?,'approved',?)")
    .run(uid, 'sena', 'p0', 'Nut', 'existing', new Date().toISOString());
  const response = await (await f.request('/api/member?club=88', null, member)).json();
  assert.equal(response.link.status, 'approved');
  assert.equal(response.mappingError, null);
  assert.equal(
    f.db.prepare('SELECT count(*) AS n FROM member_links WHERE user_id=?').get(uid).n,
    2,
  );
});
test('users can select a player from either roster; counterpart conflicts roll back both mappings', async t => {
  const f = fixture(t),
    member = await f.login();
  f.db.exec(
    'CREATE TABLE club_state_88(id INTEGER PRIMARY KEY,revision INTEGER,payload TEXT,updated_at TEXT)',
  );
  f.db.prepare('INSERT INTO club_state_88 VALUES(1,1,?,?)').run(
    JSON.stringify({
      players: [
        { id: 'only-88', name: 'Bank', thai: '', lv: 5, gender: 'M' },
        { id: 'old-88', name: 'Nut', thai: '', lv: 7, gender: 'M' },
      ],
      selected: [],
      rounds: 10,
      locks: [],
      result: null,
      cup: null,
    }),
    'old',
  );
  f.db
    .prepare("INSERT INTO member_links VALUES(?,?,?,?,?,'approved',?)")
    .run(other, '88', 'old-88', 'Nut', 'existing', new Date().toISOString());
  assert.equal((await f.request('/api/member/link', { playerId: 'p0' }, member)).status, 409);
  assert.equal(
    f.db.prepare('SELECT count(*) AS n FROM member_links WHERE user_id=?').get(uid).n,
    0,
  );
  const choices = await (await f.request('/api/member/choices', null, member)).json();
  assert(!choices.players.some(p => p.name === 'Nut'));
  assert(choices.players.some(p => p.id === 'only-88' && p.club === '88'));
  assert.equal(
    (await f.request('/api/member/link', { playerId: 'only-88', sourceClub: '88' }, member)).status,
    200,
  );
  assert.equal(
    (await (await f.request('/api/member', null, member)).json()).link.status,
    'approved',
  );
});
test('roster changes during mapping abort the transaction without creating a player or partial links', async t => {
  const f = fixture(t),
    member = await f.login(),
    original = f.env.DB.batch;
  f.env.DB.batch = statements => {
    f.db.prepare('UPDATE club_state SET revision=revision+1').run();
    return original(statements);
  };
  assert.equal((await f.request('/api/member/link', { playerId: 'p0' }, member)).status, 409);
  assert.equal(
    f.db.prepare('SELECT count(*) AS n FROM member_links WHERE user_id=?').get(uid).n,
    0,
  );
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM club_state_88').get().n, 0);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM member_write_guards').get().n, 0);
});

test('linked accounts get no mapping choices and other users cannot see any already-linked name', async t => {
  const f = fixture(t),
    first = await f.login();
  await f.request('/api/member/link', { playerId: 'p0' }, first);
  for (const club of ['sena', '88']) {
    const own = await (await f.request('/api/member/choices?club=' + club, null, first)).json();
    assert.deepEqual(own, { players: [], linked: true });
  }
  const second = await f.login(other);
  for (const club of ['sena', '88']) {
    const available = await (
      await f.request('/api/member/choices?club=' + club, null, second)
    ).json();
    assert(!available.players.some(p => p.name === 'Nut'));
    assert(available.players.some(p => p.name === 'Pete'));
  }
});

test('friend billing belongs to the inviter and both inviter and friend can cancel the sponsored seat', async t => {
  const f = fixture(t),
    admin = await f.admin(),
    host = await f.login(),
    friend = await f.login(other);
  await f.request('/api/member/link', { playerId: 'p0' }, host);
  await f.request('/api/member/link', { playerId: 'p1' }, friend);
  const setup = await (
    await f.request(
      '/api/booking',
      {
        action: 'settings',
        settingsVersion: 0,
        settings: {
          ...defaultSettings(),
          enabled: true,
          weekdays: [0, 1, 2, 3, 4, 5, 6],
          weeks: 1,
          capacity: 8,
        },
      },
      admin,
    )
  ).json();
  const id = setup.sessions[0].id,
    booking = {
      action: 'book',
      playerId: 'p0',
      friendId: 'p1',
      guest: { name: 'Outside', gender: 'F' },
      sessionIds: [id],
      acceptHoliday: true,
    };
  assert.equal((await f.request('/api/booking', booking, host)).status, 200);
  assert.equal((await f.request('/api/booking', booking)).status, 403);
  const sessions = await (await f.request('/api/billing?action=sessions', null, admin)).json();
  const source = sessions.sessions.find(s => s.date === id);
  assert.deepEqual(
    source.attendees.map(p => p.name),
    ['Nut', 'Pete', 'Outside'],
  );
  assert(source.attendees.every(p => p.payer === 'Nut' && p.payerKey === 'member:p0'));
  const created = await (
    await f.request(
      '/api/billing',
      { date: id, court: 90000, shuttle: 0, transfer: '0000000000', attendees: source.attendees },
      admin,
    )
  ).json();
  const bill = await (await f.request('/api/billing?bill=' + created.id, null, admin)).json();
  assert.equal(bill.payers.length, 1);
  assert.equal(bill.payers[0].name, 'Nut');
  assert.equal(bill.payers[0].amount, 90000);
  assert.equal(bill.payers[0].shares, 3);
  assert.equal((await (await f.request('/api/member/bills', null, host)).json()).bills.length, 1);
  assert.equal((await (await f.request('/api/member/bills', null, friend)).json()).bills.length, 0);
  const read = async cookie =>
    (await (await f.request('/api/booking', null, cookie)).json()).sessions.find(s => s.id === id);
  for (const cookie of [host, friend])
    assert.equal((await read(cookie)).registrations.find(r => r.playerId === 'p1').canCancel, true);
  const r = (await read(friend)).registrations.find(r => r.playerId === 'p1');
  assert.equal(
    (
      await f.request(
        '/api/booking',
        { action: 'cancel', sessionId: id, registrationId: r.id, acceptLateCancellation: true },
        friend,
      )
    ).status,
    200,
  );
  assert.equal(
    (await read(host)).registrations.some(r => r.playerId === 'p0'),
    true,
  );
  const withdrawn = (
    await (await f.request('/api/billing?action=sessions', null, admin)).json()
  ).sessions.find(s => s.date === id).withdrawals[0];
  assert.equal(withdrawn.name, 'Pete');
  assert.equal(withdrawn.payer, 'Nut');
  assert.equal(withdrawn.attended, false);
});

test('LIFF endpoint serves HTML without redirecting away from its registered URL', async () => {
  const response = await worker.fetch(new Request(origin + '/liff.html?club=88'), {
    ASSETS: {
      fetch(request) {
        const url = new URL(request.url);
        assert.equal(url.pathname, '/liff');
        assert.equal(url.searchParams.get('club'), '88');
        return new Response('<!doctype html>', { headers: { 'Content-Type': 'text/html' } });
      },
    },
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Location'), null);
});
test('login-only trial allows real account setup before enforcing booking login', async t => {
  const f = fixture(t);
  f.env.LINE_MEMBER_AUTH_ENABLED = 'false';
  f.env.LINE_LOGIN_ENABLED = 'true';
  const admin = await f.admin(),
    member = await f.login();
  const status = await (await f.request('/api/member', null, member)).json();
  assert.equal(status.loggedIn, true);
  assert.equal(status.enabled, true);
  assert.equal(status.requireLogin, false);
  const setup = await (
    await f.request(
      '/api/booking',
      {
        action: 'settings',
        settingsVersion: 0,
        settings: {
          ...defaultSettings(),
          enabled: true,
          weekdays: [0, 1, 2, 3, 4, 5, 6],
          weeks: 1,
          capacity: 8,
        },
      },
      admin,
    )
  ).json();
  const book = {
    action: 'book',
    playerId: 'p0',
    sessionIds: [setup.sessions[0].id],
    acceptHoliday: true,
  };
  assert.equal((await f.request('/api/booking', book)).status, 200);
  f.env.LINE_MEMBER_AUTH_ENABLED = 'true';
  assert.equal((await f.request('/api/booking', { ...book, playerId: 'p1' })).status, 403);
});

test('LINE login verifies server-side audience, expiry and CSRF; forged sessions fail', async t => {
  const f = fixture(t);
  assert.equal((await f.request('/api/member/login', { idToken: 'fake' })).status, 403);
  assert.equal(f.calls, 0);
  const r = await f.request('/api/member'),
    info = await r.json(),
    cookie = f.cookieOf(r);
  assert.equal(
    (await f.request('/api/member/login', 'null', cookie, { 'X-Member-CSRF': info.csrf })).status,
    400,
  );
  for (const invalid of [
    { aud: 'wrong' },
    { exp: 0 },
    { iss: 'https://evil.test' },
    { sub: 'attacker' },
  ]) {
    f.profile(invalid);
    assert.equal(
      (
        await f.request('/api/member/login', { idToken: 'fake' }, cookie, {
          'X-Member-CSRF': info.csrf,
        })
      ).status,
      401,
    );
  }
  f.profile({});
  const member = await f.login();
  assert.equal((await (await f.request('/api/member', null, member)).json()).loggedIn, true);
  assert.equal(
    (await (await f.request('/api/member', null, '__Host-sena-member=' + '0'.repeat(64))).json())
      .loggedIn,
    false,
  );
  await f.request('/api/member/logout', {}, member);
  assert.equal((await (await f.request('/api/member', null, member)).json()).loggedIn, false);
});
test('active member sessions slide to a fresh week at most once a day; expired ones stay expired', async t => {
  const f = fixture(t);
  const member = await f.login();
  const sessionCookies = r =>
    r.headers.getSetCookie().filter(c => c.startsWith('__Host-sena-member='));
  const expiry = () => f.db.prepare('SELECT expires_at FROM member_sessions').get().expires_at;
  // Just signed in: nothing to renew.
  let r = await f.request('/api/member', null, member);
  assert.equal((await r.json()).loggedIn, true);
  assert.deepEqual(sessionCookies(r), []);
  // Two days later (five days left): renewed in the database and in the cookie.
  f.db.prepare('UPDATE member_sessions SET expires_at=?').run(Date.now() + 5 * 86400000);
  r = await f.request('/api/member', null, member);
  assert.equal((await r.json()).loggedIn, true);
  assert.equal(sessionCookies(r).length, 1);
  assert.match(
    sessionCookies(r)[0],
    /^__Host-sena-member=[a-f0-9]{64}; .*HttpOnly.*Max-Age=604800$/,
  );
  assert.equal(sessionCookies(r)[0].split(';')[0], member);
  assert(expiry() > Date.now() + 6.9 * 86400000);
  // An expired session is never revived.
  f.db.prepare('UPDATE member_sessions SET expires_at=?').run(Date.now() - 1000);
  r = await f.request('/api/member', null, member);
  assert.equal((await r.json()).loggedIn, false);
  assert.deepEqual(sessionCookies(r), []);
  assert(expiry() < Date.now());
});
test('a new member signs up with a unique name and is linked in both clubs at LV 6.5 without approval', async t => {
  const f = fixture(t),
    member = await f.login();
  const signUp = (body, cookie = member) =>
    f.request('/api/member/link', { newMember: body }, cookie);
  // Bad input is refused before anything is written.
  for (const bad of [
    { name: '', gender: 'M' },
    { name: 'x'.repeat(31), gender: 'M' },
    { name: 'Ok' },
    { name: '<b>', gender: 'F' },
  ])
    assert.equal((await signUp(bad)).status, 400);
  // Existing names (any case or spacing, either club) are reported as already in the system.
  for (const name of ['Nut', '  nut ', 'PETE'])
    assert.match(
      (await (await signUp({ name, gender: 'M' })).json()).error,
      /มีชื่อ .* ในระบบอยู่แล้ว/,
    );
  // A unique name: linked straight away, both clubs, default level.
  const r = await signUp({ name: '  มด  ', gender: 'F' });
  assert.equal(r.status, 200);
  const me = await (await f.request('/api/member', null, member)).json();
  assert.equal(me.link.status, 'approved');
  assert.equal(me.link.name, 'มด');
  for (const table of ['club_state', 'club_state_88']) {
    const players = JSON.parse(
      f.db.prepare(`SELECT payload FROM ${table} WHERE id=1`).get().payload,
    ).players;
    const added = players.filter(p => p.name === 'มด');
    assert.equal(added.length, 1, table);
    assert.deepEqual([added[0].lv, added[0].gender, added[0].thai], [6.5, 'F', ''], table);
  }
  const links = f.db
    .prepare('SELECT club,kind,status FROM member_links WHERE user_id=? ORDER BY club')
    .all(uid);
  assert.deepEqual(
    links.map(l => [l.club, l.kind, l.status]),
    [
      ['88', 'new', 'approved'],
      ['sena', 'new', 'approved'],
    ],
  );
  // Signing up again with the same account, or someone else taking the same name, is refused.
  assert.equal((await signUp({ name: 'อีกชื่อ', gender: 'F' })).status, 409);
  const second = await f.login(other);
  assert.match(
    (await (await signUp({ name: 'มด', gender: 'M' }, second)).json()).error,
    /ในระบบอยู่แล้ว/,
  );
  // The new player is a normal roster entry: the organizer can rename it and the link stays.
  const admin = await f.admin();
  const state = await (await f.request('/api/state', null, admin)).json();
  state.state.players.find(p => p.name === 'มด').name = 'มดแดง';
  assert.equal(
    (await f.request('/api/state', { state: state.state, revision: state.revision }, admin)).status,
    200,
  );
  assert.equal(
    (await (await f.request('/api/member', null, member)).json()).link.status,
    'approved',
  );
});

test('organizer edits of linked players reach the other club; self sign-ups are flagged for review', async t => {
  const f = fixture(t),
    member = await f.login(),
    admin = await f.admin();
  assert.equal(
    (await f.request('/api/member/link', { newMember: { name: 'มด', gender: 'F' } }, member))
      .status,
    200,
  );
  const roster = table =>
    JSON.parse(f.db.prepare(`SELECT payload FROM ${table} WHERE id=1`).get().payload).players;
  const mod = table => roster(table).find(p => p.name === 'มด');
  // Flagged in both clubs with the LINE profile name, visible to organizers only.
  for (const table of ['club_state', 'club_state_88'])
    assert.equal(mod(table).selfSignup.lineName, 'Odd LINE name', table);
  const guest = await (await f.request('/api/state')).json();
  assert(!JSON.stringify(guest).includes('selfSignup'));
  assert(!JSON.stringify(guest).includes('Odd LINE name'));
  // 88 has an unrelated 'Zed'; Sena has an unlinked 'Pete'.
  const s88 = f.db.prepare('SELECT revision,payload FROM club_state_88 WHERE id=1').get();
  const st88 = JSON.parse(s88.payload);
  st88.players.push({ id: 'z88', name: 'Zed', thai: '', lv: 5, gender: 'M' });
  f.db.prepare('UPDATE club_state_88 SET payload=? WHERE id=1').run(JSON.stringify(st88));
  const save = async edit => {
    const cur = await (await f.request('/api/state', null, admin)).json();
    edit(cur.state.players);
    return (
      await f.request('/api/state', { state: cur.state, revision: cur.revision }, admin)
    ).json();
  };
  // Organizer reviews มด in Sena: renames, sets LV, clears the flag -> mirrored to 88.
  let result = await save(players => {
    const p = players.find(x => x.name === 'มด');
    Object.assign(p, { name: 'มดแดง', lv: 7.5 });
    delete p.selfSignup;
    players.find(x => x.name === 'Pete').lv = 9;
  });
  assert.equal(result.synced, 1);
  assert.deepEqual(result.skipped, []);
  const in88 = roster('club_state_88').find(p => p.name === 'มดแดง');
  assert.equal(in88.lv, 7.5);
  assert.equal(in88.selfSignup, undefined);
  // Unlinked players are not copied (Pete exists only in Sena's roster anyway).
  assert(!roster('club_state_88').some(p => p.name === 'Pete'));
  // A rename that clashes over there keeps the old name there, still copies LV, and says so.
  result = await save(players =>
    Object.assign(
      players.find(x => x.name === 'มดแดง'),
      { name: 'Zed', lv: 8 },
    ),
  );
  assert.equal(result.synced, 1);
  assert.deepEqual(result.skipped, [{ name: 'Zed', club: '88', reason: 'name_taken' }]);
  const after = roster('club_state_88').find(p => p.id === in88.id);
  assert.deepEqual([after.name, after.lv], ['มดแดง', 8]);
  // The member stays linked through all of it.
  assert.equal(
    (await (await f.request('/api/member', null, member)).json()).link.status,
    'approved',
  );
});

test('an organizer can mark a linked LINE account as admin; it then has full organizer rights until unmarked', async t => {
  const f = fixture(t),
    key = await f.admin(),
    member = await f.login(),
    stranger = await f.login(other);
  assert.equal((await f.request('/api/member/link', { playerId: 'p0' }, member)).status, 200);
  const session = async cookie => (await f.request('/api/session', null, cookie)).json();
  const grant = (userId, admin, cookie = key) =>
    f.request('/api/member/admin', { userId, admin }, cookie);
  const saveRoster = async cookie => {
    const cur = await (await f.request('/api/state', null, key)).json();
    cur.state.players[1].lv = cur.state.players[1].lv + 0.5;
    return f.request('/api/state', { state: cur.state, revision: cur.revision }, cookie);
  };
  // Plain members are not organizers and cannot grant anything.
  assert.deepEqual(await session(member), { canEdit: false, via: null });
  assert.equal((await grant(uid, true, member)).status, 401);
  assert.equal((await saveRoster(member)).status, 401);
  // Only linked accounts can be marked.
  assert.equal((await grant(other, true)).status, 409);
  assert.equal((await grant('not-a-line-id', true)).status, 400);
  // The organizer marks the member; the account list shows it.
  assert.equal((await grant(uid, true)).status, 200);
  const list = await (await f.request('/api/member/admins', null, key)).json();
  assert.deepEqual(
    list.players.map(p => [p.playerId, p.userId, p.admin]),
    [['p0', uid, true]],
  );
  assert.equal((await f.request('/api/member/admins', null, stranger)).status, 401);
  // Now the member is an organizer in both clubs, with no ADMIN_KEY login.
  assert.deepEqual(await session(member), { canEdit: true, via: 'line' });
  assert.equal((await (await f.request('/api/state?club=88', null, member)).json()).canEdit, true);
  assert.equal((await saveRoster(member)).status, 200);
  assert.equal(
    typeof (await (await f.request('/api/state', null, member)).json()).state.players[0].lv,
    'number',
  );
  // Equal rights include marking others (once they are linked).
  assert.equal((await f.request('/api/member/link', { playerId: 'p1' }, stranger)).status, 200);
  assert.equal((await grant(other, true, member)).status, 200);
  assert.equal((await session(stranger)).via, 'line');
  // Unmarking takes effect on the very next request.
  assert.equal((await grant(uid, false)).status, 200);
  assert.deepEqual(await session(member), { canEdit: false, via: null });
  assert.equal((await saveRoster(member)).status, 401);
  // Unlinking an account also removes its admin mark.
  const before = await (await f.request('/api/member/requests', null, key)).json();
  const link = before.requests.find(r => r.user_id === other);
  assert.equal(
    (
      await f.request(
        '/api/member/unlink',
        { userId: other, previousPlayerId: link.player_id, previousStatus: link.status },
        key,
      )
    ).status,
    200,
  );
  assert.deepEqual(await session(stranger), { canEdit: false, via: null });
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM member_admins').get().n, 0);
  // The ADMIN_KEY login keeps working regardless.
  assert.deepEqual(await session(key), { canEdit: true, via: 'key' });
});

test('existing-player linking is immediate, isolates clubs, and limits booking and cancellation to self', async t => {
  const f = fixture(t),
    admin = await f.admin(),
    member = await f.login();
  const settings = {
    ...defaultSettings(),
    enabled: true,
    weekdays: [0, 1, 2, 3, 4, 5, 6],
    weeks: 1,
    capacity: 8,
  };
  const configured = await (
      await f.request('/api/booking', { action: 'settings', settingsVersion: 0, settings }, admin)
    ).json(),
    sessionId = configured.sessions[0].id;
  const booking = { action: 'book', playerId: 'p0', sessionIds: [sessionId], acceptHoliday: true };
  assert.equal((await f.request('/api/booking', booking)).status, 403);
  assert.equal((await f.request('/api/member/link', { playerId: 'p0' }, member)).status, 200);
  assert.equal((await f.request('/api/member/approve', { userId: uid }, admin)).status, 404);
  assert.equal((await f.request('/api/booking', booking, member)).status, 200);
  assert.equal(
    (await f.request('/api/booking', { ...booking, playerId: 'p1' }, member)).status,
    403,
  );
  assert.equal(
    (await (await f.request('/api/member?club=88', null, member)).json()).link.status,
    'approved',
  );
  await f.request('/api/booking', { ...booking, playerId: 'p1' }, admin);
  let data = await (await f.request('/api/booking', null, member)).json(),
    session = data.sessions.find(s => s.id === sessionId);
  const mine = session.registrations.find(r => r.playerId === 'p0'),
    theirs = session.registrations.find(r => r.playerId === 'p1');
  assert.equal(mine.canCancel, true);
  assert.equal(theirs.canCancel, false);
  assert.equal(
    (
      await f.request(
        '/api/booking',
        { action: 'cancel', sessionId, registrationId: theirs.id, acceptLateCancellation: true },
        member,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await f.request(
        '/api/booking',
        { action: 'cancel', sessionId, registrationId: mine.id, acceptLateCancellation: true },
        member,
      )
    ).status,
    200,
  );
  const second = await f.login(other);
  assert.equal((await f.request('/api/member/link', { playerId: 'p0' }, second)).status, 409);
  await f.request(
    '/api/member/revoke',
    { userId: uid, previousPlayerId: 'p0', previousStatus: 'approved' },
    admin,
  );
  assert.equal((await f.request('/api/booking', booking, member)).status, 403);
});
test('linking rejects malformed choices and admin renaming preserves the linked ID', async t => {
  const f = fixture(t),
    admin = await f.admin(),
    member = await f.login();
  for (const body of [
    { name: 'New member' },
    { playerId: 'missing' },
    { playerId: 'p0', name: 'Changed' },
  ])
    assert.equal((await f.request('/api/member/link', body, member)).status, 400);
  assert.equal((await f.request('/api/member/link', { playerId: 'p0' }, member)).status, 200);
  const choices = await (await f.request('/api/member/choices', null, await f.login(other))).json();
  assert.deepEqual(
    choices.players.map(p => p.id),
    ['p1'],
  );
  const before = await (await f.request('/api/state', null, admin)).json();
  before.state.players[0].name = 'Edited by admin';
  assert.equal(
    (await f.request('/api/state', { state: before.state, revision: before.revision }, admin))
      .status,
    200,
  );
  assert.equal((await (await f.request('/api/member', null, member)).json()).link.player_id, 'p0');
  const list = await (await f.request('/api/member/requests', null, admin)).json();
  assert.equal(list.requests[0].name, 'Edited by admin');
});
test('organizers can correct mappings; other users, occupied names and stale changes cannot overwrite them', async t => {
  const f = fixture(t),
    admin = await f.admin(),
    first = await f.login(),
    second = await f.login(other);
  await f.request('/api/member/link', { playerId: 'p0' }, first);
  await f.request('/api/member/link', { playerId: 'p1' }, second);
  const move = { userId: uid, playerId: 'p1', previousPlayerId: 'p0', previousStatus: 'approved' };
  assert.equal((await f.request('/api/member/reassign', move, first)).status, 401);
  assert.equal((await f.request('/api/member/reassign', move, admin)).status, 409);
  assert.equal(
    (
      await f.request(
        '/api/member/revoke',
        { userId: other, previousPlayerId: 'p1', previousStatus: 'approved' },
        admin,
      )
    ).status,
    200,
  );
  assert.equal((await f.request('/api/member/reassign', move, admin)).status, 200);
  assert.equal(
    (await f.request('/api/member/reassign', { ...move, playerId: 'p0' }, admin)).status,
    409,
  );
  assert.equal(
    (
      await f.request(
        '/api/member/revoke',
        { userId: uid, previousPlayerId: 'p0', previousStatus: 'approved' },
        admin,
      )
    ).status,
    409,
  );
  assert.equal((await (await f.request('/api/member', null, first)).json()).link.player_id, 'p1');
  assert.equal((await f.request('/api/member/link', { playerId: 'p0' }, first)).status, 409);
});
test('admin unlink resets the first-login picker without deleting players, bills or the LINE session', async t => {
  const f = fixture(t),
    admin = await f.admin(),
    member = await f.login();
  await f.request('/api/member/link', { playerId: 'p0' }, member);
  const rosterBefore = f.db.prepare('SELECT payload FROM club_state WHERE id=1').get().payload;
  const body = { userId: uid, previousPlayerId: 'p0', previousStatus: 'approved' };
  assert.equal((await f.request('/api/member/unlink', body, member)).status, 401);
  assert.equal(
    (await f.request('/api/member/unlink', { ...body, previousPlayerId: 'p1' }, admin)).status,
    409,
  );
  assert.equal((await f.request('/api/member/unlink', body, admin)).status, 200);
  const session = await (await f.request('/api/member', null, member)).json();
  assert.equal(session.loggedIn, true);
  assert.equal(session.link, null);
  assert.equal((await (await f.request('/api/member?club=88', null, member)).json()).link, null);
  assert.equal(
    f.db.prepare('SELECT payload FROM club_state WHERE id=1').get().payload,
    rosterBefore,
  );
  assert(
    (await (await f.request('/api/member/choices', null, member)).json()).players.some(
      p => p.id === 'p0',
    ),
  );
  assert.equal((await f.request('/api/member/link', { playerId: 'p0' }, member)).status, 200);
  assert.equal(
    (await (await f.request('/api/member', null, member)).json()).link.status,
    'approved',
  );
});

test('pending existing-name requests from the trial activate on revisit without approval', async t => {
  const f = fixture(t),
    member = await f.login();
  f.db
    .prepare("INSERT INTO member_links VALUES(?,?,?,?,?,'pending',?)")
    .run(uid, 'sena', 'p0', 'Nut', 'existing', new Date().toISOString());
  assert.equal(
    (await (await f.request('/api/member', null, member)).json()).link.status,
    'approved',
  );
});

test('organizer mention diagnostics report the actual fallback and verify the webhook without sending chat messages', async t => {
  const f = fixture(t),
    admin = await f.admin(),
    member = await f.login();
  f.env.LINE_CHANNEL_SECRET = 'fixture-secret';
  await f.request('/api/member/link', { playerId: 'p0' }, member);
  const draft = {
    date: '2026-11-10',
    court: 10000,
    shuttle: 0,
    transfer: '0000000000',
    attendees: [
      { name: 'Nut', payer: 'Nut', payerKey: 'member:p0' },
      { name: 'Pete', payer: 'Pete', payerKey: 'name:pete' },
    ],
  };
  await f.request('/api/billing', draft, admin);
  f.db.exec(
    'CREATE TABLE line_groups(club TEXT PRIMARY KEY,group_id TEXT,pair_code TEXT,expires_at INTEGER)',
  );
  f.db.prepare('INSERT INTO line_groups(club,group_id) VALUES(?,?)').run('sena', 'Ctest');
  let profileStatus = 200,
    networkFailure = false;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert(!String(url).endsWith('/message/reply'));
    assert(!String(url).endsWith('/message/push'));
    if (String(url).includes('/group/')) {
      if (networkFailure) throw Error('network');
      return Response.json({ userId: String(url).split('/').at(-1) }, { status: profileStatus });
    }
    if (String(url).endsWith('/message/validate/reply')) {
      const payload = JSON.parse(options.body);
      assert(payload.messages.every(m => ['textV2', 'text'].includes(m.type)));
      return new Response('{}');
    }
    assert(String(url).endsWith('/channel/webhook/endpoint'));
    return Response.json({ endpoint: origin + '/api/line/webhook', active: true });
  });
  assert.equal((await f.request('/api/line?mentionDiagnostics=1')).status, 401);
  let report = await (await f.request('/api/line?mentionDiagnostics=1', null, admin)).json();
  assert.equal(report.mentionCount, 1);
  assert.equal(report.validation.status, 200);
  assert.equal(report.webhook.endpointMatches, true);
  assert(report.payers.some(p => p.reason === 'legacy_payer_key'));
  profileStatus = 404;
  report = await (await f.request('/api/line?mentionDiagnostics=1', null, admin)).json();
  assert.equal(report.mentionCount, 0);
  assert(
    report.payers.some(
      p => p.reason === 'not_in_group_or_provider_mismatch' && p.httpStatus === 404,
    ),
  );
  networkFailure = true;
  report = await (await f.request('/api/line?mentionDiagnostics=1', null, admin)).json();
  assert(report.payers.some(p => p.reason === 'line_profile_timeout_or_network'));
  assert(!JSON.stringify(report).includes(uid));
});

test('maximum bill reminders list every payer by name, tag in groups, and stay within five LINE messages', async t => {
  const f = fixture(t);
  await f.request('/api/member');
  f.db.exec(
    'CREATE TABLE bills(id TEXT PRIMARY KEY,club TEXT,session_date TEXT,revision INTEGER,payload TEXT,closed_at INTEGER,slips_removed INTEGER DEFAULT 0)',
  );
  let n = 0;
  const ids = [];
  for (const club of ['sena', '88'])
    for (let day = 1; day <= 3; day++) {
      const payers = [];
      for (let i = 0; i < 8; i++) {
        const id = 'p' + n,
          userId = 'U' + (++n).toString(16).padStart(32, '0');
        ids.push(userId);
        const name = 'x'.repeat(96) + n;
        f.db
          .prepare("INSERT INTO member_links VALUES(?,?,?,?,?,'approved',?)")
          .run(userId, club, id, name, 'existing', new Date().toISOString());
        payers.push({ name, payerKey: 'member:' + id, amount: 100000000, status: 'unpaid' });
      }
      f.db
        .prepare('INSERT INTO bills VALUES(?,?,?,0,?,NULL,0)')
        .run(club + day, club, '2026-11-0' + day, JSON.stringify({ payers }));
    }
  const messages = await billingLineMessages(f.env, 'all', origin, 'Ctest');
  assert(messages.length <= 5);
  assert(messages.every(m => m.text.length <= 5000));
  const mentions = messages.filter(m => m.type === 'textV2'),
    summaries = messages.filter(m => m.type === 'text');
  assert.equal(messages.length, 5);
  assert.equal(summaries.length, 2);
  // Grouped tags (<= 3 names each) fill the three remaining slots; the rest is
  // offered through the quick-reply button.
  assert(mentions.every(m => Object.keys(m.substitution).length <= 3));
  const tagged = mentions.flatMap(m => Object.values(m.substitution).map(v => v.mentionee.userId));
  assert.equal(new Set(tagged).size, tagged.length);
  assert.equal(tagged.length, 9);
  assert(tagged.every(id => ids.includes(id)));
  assert.equal(messages.at(-1).quickReply.items[0].action.label, 'แท็กต่ออีก 39 คน');
  const billText = summaries.map(m => m.text).join('\n');
  assert.equal((billText.match(/• /g) || []).length, 48);
});

test('personal bill links reveal only the owner; uploads enforce ownership; group mentions contain no payer tokens', async t => {
  const f = fixture(t),
    admin = await f.admin(),
    member = await f.login();
  await f.request('/api/member/link', { playerId: 'p0' }, member);
  const draft = {
    date: '2026-11-10',
    court: 10000,
    shuttle: 0,
    transfer: '0000000000',
    attendees: [
      { name: 'Nut', payer: 'Nut', payerKey: 'member:p0' },
      { name: 'Pete', payer: 'Pete', payerKey: 'member:p1' },
    ],
  };
  const { id } = await (await f.request('/api/billing', draft, admin)).json();
  const view = await (await f.request('/api/billing?bill=' + id, null, admin)).json(),
    [mine, theirs] = view.payers;
  assert.equal((await f.request('/api/member/bills')).status, 401);
  const own = await (await f.request('/api/member/bills?bill=' + id, null, member)).json();
  assert.equal(own.bills.length, 1);
  assert(own.bills[0].url.includes(mine.token));
  assert(!JSON.stringify(own).includes(theirs.token));
  const path =
    '/api/billing?bill=' + id + '&action=upload&payer=' + theirs.id + '&amount=' + theirs.amount;
  const slip = Uint8Array.of(255, 216, 255, 224, 0, 0, 0, 0, 0, 0, 255, 217);
  assert.equal((await f.request(path, slip, member)).status, 403);
  assert.equal((await f.request(path, slip)).status, 403);
  assert.equal(
    (await f.request('/api/billing?bill=' + id, null, member, { 'X-Bill-Token': theirs.token }))
      .status,
    403,
  );
  const messages = await billingLineMessages(f.env, 'all', origin, 'C' + 'a'.repeat(32));
  assert.equal(messages.at(-1).type, 'textV2');
  assert.equal(messages[0].type, 'text');
  assert.equal(Object.values(messages.at(-1).substitution)[0].mentionee.userId, uid);
  assert.match(messages[0].text, /https:\/\/liff.line.me\/12345-test\?club=sena&page=pay&bill=/);
  assert(!JSON.stringify(messages).includes(mine.token));
  assert(!JSON.stringify(messages).includes(theirs.token));
  assert.equal(
    (
      await f.request(
        '/api/billing?bill=' + id + '&action=upload&payer=' + mine.id + '&amount=' + mine.amount,
        slip,
        member,
      )
    ).status,
    200,
  );
  await f.request(
    '/api/member/reassign',
    { userId: uid, playerId: 'p1', previousPlayerId: 'p0', previousStatus: 'approved' },
    admin,
  );
  const moved = await (await f.request('/api/member/bills?bill=' + id, null, member)).json();
  assert.equal(moved.bills[0].name, 'Pete');
  assert(!JSON.stringify(moved).includes(mine.token));
  assert.equal(
    (await f.request('/api/billing?bill=' + id, null, member, { 'X-Bill-Token': mine.token }))
      .status,
    403,
  );
});
