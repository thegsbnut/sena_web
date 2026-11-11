import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from './worker.js';
import {
  defaultSettings,
  materialize,
  bangkokDate,
  publicBooking,
  refreshSchedules,
} from './booking.js';
import { holidayOn } from './booking-holidays.js';
const origin = 'https://example.com';
const token = 'a'.repeat(64),
  otherToken = 'b'.repeat(64);
const players = Array.from({ length: 12 }, (_, i) => ({
  id: 'p' + i,
  name: 'Player ' + i,
  thai: '',
  lv: 4 + i / 2,
  gender: i % 3 === 0 ? 'F' : 'M',
}));
function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec(
    'CREATE TABLE club_state(id INTEGER PRIMARY KEY,revision INTEGER,payload TEXT,updated_at TEXT); CREATE TABLE login_attempts(ip TEXT PRIMARY KEY,window INTEGER,attempts INTEGER)',
  );
  db.prepare('INSERT INTO club_state VALUES(1,1,?,?)').run(
    JSON.stringify({ players, selected: [], rounds: 10, locks: [], result: null, cup: null }),
    'before',
  );
  const env = {
    ADMIN_KEY: 'abcdef7',
    DB: {
      prepare(sql) {
        const stmt = db.prepare(sql);
        let args = [];
        return {
          bind(...v) {
            args = v;
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
    },
  };
  const call = (body, { cookie = '', owner = token, club = 'sena', headers = {} } = {}) =>
    worker.fetch(
      new Request(origin + '/api/booking' + (club === '88' ? '?club=88' : ''), {
        method: body ? 'POST' : 'GET',
        headers: {
          Origin: origin,
          ...(cookie ? { Cookie: cookie } : {}),
          ...(owner ? { 'X-Booking-Token': owner } : {}),
          ...headers,
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      }),
      env,
    );
  const login = async () => {
    const r = await worker.fetch(
      new Request(origin + '/api/login', {
        method: 'POST',
        headers: { Origin: origin },
        body: JSON.stringify({ key: env.ADMIN_KEY }),
      }),
      env,
    );
    assert.equal(r.status, 200);
    return r.headers.get('Set-Cookie').split(';')[0];
  };
  const open = async regularIds => {
    const cookie = await login(),
      settings = {
        ...defaultSettings(),
        enabled: true,
        weekdays: [0, 1, 2, 3, 4, 5, 6],
        weeks: 1,
        capacity: 8,
        rounds: 4,
        regularIds: regularIds || [],
      };
    const r = await call({ action: 'settings', settingsVersion: 0, settings }, { cookie });
    assert.equal(r.status, 200);
    return { cookie, settings, data: await r.json() };
  };
  return { db, env, call, login, open };
}
test('booking one roster friend retains their identity and skill, permits an outside guest, and is idempotent', async t => {
  const f = fixture();
  t.after(() => f.db.close());
  const { data } = await f.open(['p2', 'p3', 'p4', 'p5', 'p6']);
  const id = data.sessions[0].id;
  const seen = [];
  const original = globalThis.Sena.generate;
  t.mock.method(globalThis.Sena, 'generate', (...args) => {
    seen.push(args[0]);
    return original(...args);
  });
  const payload = {
    action: 'book',
    playerId: 'p0',
    friendId: 'p1',
    guest: { name: 'Outside', gender: 'M' },
    sessionIds: [id],
    acceptHoliday: true,
  };
  const response = await f.call(payload);
  assert.equal(response.status, 200);
  const session = (await response.json()).sessions.find(s => s.id === id);
  assert.equal(session.registrations.length, 8);
  assert.equal(session.registrations.find(r => r.playerId === 'p1').invitedBy, 'p0');
  assert.equal(session.registrations.filter(r => r.guest).length, 1);
  const drawn = seen.find(ps => ps.some(p => p.id === 'p1')).find(p => p.id === 'p1');
  assert.equal(drawn.lv, players[1].lv);
  assert.equal(drawn.gender, players[1].gender);
  const again = await (await f.call(payload)).json();
  assert.equal(again.result.added, 0);
  assert.equal(again.sessions.find(s => s.id === id).registrations.length, 8);
  assert.equal((await f.call({ ...payload, friendId: 'p7' })).status, 409);
  assert.equal((await f.call({ ...payload, friendId: 'p0' })).status, 400);
  assert.equal((await f.call({ ...payload, friendId: 'missing' })).status, 400);
  assert.equal(
    (await f.call({ ...payload, guest: { name: 'Player 1', gender: 'M' } })).status,
    400,
  );
});
test('friend booking does not take over existing seats or payments and multi-date conflicts roll back', async t => {
  const f = fixture();
  t.after(() => f.db.close());
  const { data } = await f.open(),
    ids = data.sessions.slice(0, 2).map(s => s.id);
  await f.call({ action: 'book', playerId: 'p1', sessionIds: [ids[1]], acceptHoliday: true });
  assert.equal(
    (
      await f.call({
        action: 'book',
        playerId: 'p0',
        friendId: 'p1',
        sessionIds: ids,
        acceptHoliday: true,
      })
    ).status,
    409,
  );
  let d = await (await f.call()).json();
  assert.equal(d.sessions.find(s => s.id === ids[0]).registrations.length, 0);
  assert.equal(d.sessions.find(s => s.id === ids[1]).registrations[0].invitedBy, undefined);
  await f.call({
    action: 'book',
    playerId: 'p0',
    friendId: 'p2',
    sessionIds: [ids[0]],
    acceptHoliday: true,
  });
  assert.equal(
    (
      await f.call({
        action: 'book',
        playerId: 'p2',
        friendId: 'p3',
        sessionIds: [ids[0]],
        acceptHoliday: true,
      })
    ).status,
    409,
  );
});
test('withdrawing a host cascades to their friend and outside guest, retaining correct names and payer in history', async t => {
  const f = fixture();
  t.after(() => f.db.close());
  const { data } = await f.open(),
    id = data.sessions[0].id;
  await f.call({
    action: 'book',
    playerId: 'p0',
    friendId: 'p1',
    guest: { name: 'Outside', gender: 'F' },
    sessionIds: [id],
    acceptHoliday: true,
  });
  const session = (await (await f.call()).json()).sessions.find(s => s.id === id),
    host = session.registrations.find(r => r.playerId === 'p0');
  const response = await f.call({
    action: 'cancel',
    sessionId: id,
    registrationId: host.id,
    acceptLateCancellation: true,
  });
  assert.equal(response.status, 200);
  const after = (await response.json()).sessions.find(s => s.id === id);
  assert.equal(after.registrations.length, 0);
  assert.deepEqual(
    after.withdrawals.map(r => r.name),
    ['Player 0', 'Player 1', 'Outside'],
  );
  assert(after.withdrawals.every(r => r.payer === 'Player 0'));
});

test('withdrawals require late acknowledgement and preserve server-timed guest history without private fields', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-10T03:00:00Z') });
  const f = fixture();
  t.after(() => f.db.close());
  const { cookie, data } = await f.open(),
    sessionId = data.sessions[0].id;
  assert.equal(data.settings.cancellationNoticeHours, 48);
  await f.call({
    action: 'book',
    playerId: 'p0',
    sessionIds: [sessionId],
    acceptHoliday: true,
    guest: { name: 'Guest A', gender: 'F' },
  });
  const read = async options =>
    (await (await f.call(null, options)).json()).sessions.find(s => s.id === sessionId);
  const before = await read(),
    host = before.registrations.find(r => r.playerId === 'p0');
  const cancel = { action: 'cancel', sessionId, registrationId: host.id };
  for (const acceptLateCancellation of [undefined, false, 'true']) {
    const response = await f.call({ ...cancel, acceptLateCancellation });
    assert.equal(response.status, 409);
    assert.equal((await response.json()).code, 'LATE_CANCELLATION_ACK_REQUIRED');
  }
  assert.equal((await read()).registrations.length, 2);
  assert.equal((await read()).withdrawals.length, 0);
  const responses = await Promise.all([
    f.call({ ...cancel, acceptLateCancellation: true }),
    f.call({ ...cancel, acceptLateCancellation: true }),
  ]);
  assert.deepEqual(responses.map(r => r.status).sort(), [200, 409]);
  const after = await read();
  assert.equal(after.registrations.length, 0);
  assert.deepEqual(
    after.withdrawals.map(r => r.name),
    ['Player 0', 'Guest A'],
  );
  for (const r of after.withdrawals) {
    assert.equal(r.cancelledAt, '2026-11-10T03:00:00.000Z');
    assert.equal(r.acknowledgedAt, r.cancelledAt);
    assert.equal(r.lateCancellation, true);
    assert.equal(r.cancellationNoticeHours, 48);
    assert.equal(r.status, 'confirmed');
    assert.equal(r.cancelledByOrganizer, false);
  }
  assert.doesNotMatch(JSON.stringify(after), /ownerHash|"lv"|"gender"/);
  assert.equal((await (await f.call(null, { club: '88' })).json()).sessions.length, 0);
  t.mock.timers.setTime(Date.parse(sessionId + 'T18:01:00+07:00'));
  assert.equal((await read({ cookie: await f.login() })).withdrawals.length, 2);
});

test('48-hour boundary is inclusive, later withdrawals need consent, and rejoining preserves history', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-10T03:00:00Z') });
  const f = fixture();
  t.after(() => f.db.close());
  const { data } = await f.open(),
    sessionId = data.sessions[2].id;
  const book = () =>
    f.call({ action: 'book', playerId: 'p1', sessionIds: [sessionId], acceptHoliday: true });
  const read = async () => (await (await f.call()).json()).sessions.find(s => s.id === sessionId);
  await book();
  const deadline = Date.parse((await read()).cancellationDeadline);
  t.mock.timers.setTime(deadline);
  let r = (await read()).registrations[0];
  assert.equal((await f.call({ action: 'cancel', sessionId, registrationId: r.id })).status, 200);
  assert.equal((await read()).withdrawals[0].lateCancellation, false);
  assert.equal((await read()).withdrawals[0].acknowledgedAt, null);
  await book();
  r = (await read()).registrations[0];
  t.mock.timers.setTime(deadline + 1);
  assert.equal((await f.call({ action: 'cancel', sessionId, registrationId: r.id })).status, 409);
  assert.equal(
    (
      await f.call({
        action: 'cancel',
        sessionId,
        registrationId: r.id,
        acceptLateCancellation: true,
      })
    ).status,
    200,
  );
  await book();
  assert.equal((await read()).registrations.length, 1);
  assert.equal((await read()).withdrawals.length, 2);
});

test('organizers configure the cancellation window per club and legacy settings default to 48 hours', async t => {
  const f = fixture();
  t.after(() => f.db.close());
  const { cookie, settings } = await f.open();
  const row = f.db.prepare("SELECT payload FROM booking_clubs WHERE club='sena'").get();
  const doc = JSON.parse(row.payload);
  delete doc.settings.cancellationNoticeHours;
  f.db.prepare("UPDATE booking_clubs SET payload=? WHERE club='sena'").run(JSON.stringify(doc));
  let d = await (await f.call(null, { cookie })).json();
  assert.equal(d.settings.cancellationNoticeHours, 48);
  for (const hours of [-1, 1.5, 721, '24'])
    assert.equal(
      (
        await f.call(
          {
            action: 'settings',
            settingsVersion: 1,
            settings: { ...settings, cancellationNoticeHours: hours },
          },
          { cookie },
        )
      ).status,
      400,
    );
  assert.equal(
    (
      await f.call({
        action: 'settings',
        settingsVersion: 1,
        settings: { ...settings, cancellationNoticeHours: 24 },
      })
    ).status,
    401,
  );
  d = await (
    await f.call(
      {
        action: 'settings',
        settingsVersion: 1,
        settings: { ...settings, cancellationNoticeHours: 24 },
      },
      { cookie },
    )
  ).json();
  assert.equal(d.settings.cancellationNoticeHours, 24);
  const { cancellationNoticeHours, ...legacy } = settings;
  d = await (
    await f.call({ action: 'settings', settingsVersion: 2, settings: legacy }, { cookie })
  ).json();
  assert.equal(d.settings.cancellationNoticeHours, 24);
  d = await (
    await f.call(
      {
        action: 'settings',
        settingsVersion: 3,
        settings: { ...settings, cancellationNoticeHours: 0 },
      },
      { cookie },
    )
  ).json();
  const id = d.sessions[0].id;
  await f.call({ action: 'book', playerId: 'p0', sessionIds: [id], acceptHoliday: true });
  const session = (await (await f.call()).json()).sessions.find(s => s.id === id);
  assert.equal(
    (await f.call({ action: 'cancel', sessionId: id, registrationId: session.registrations[0].id }))
      .status,
    200,
  );
  assert.equal(
    (await (await f.call(null, { club: '88', cookie })).json()).settings.cancellationNoticeHours,
    48,
  );
});

test('billing lists withdrawn players unchecked, deduplicates rebooking, and bills them only when selected', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-10T03:00:00Z') });
  const f = fixture();
  t.after(() => f.db.close());
  f.env.SLIPS_DB = f.env.DB;
  const { cookie, data } = await f.open(),
    sessionId = data.sessions[0].id;
  const book = (playerId, guest) =>
    f.call({
      action: 'book',
      playerId,
      sessionIds: [sessionId],
      acceptHoliday: true,
      ...(guest ? { guest } : {}),
    });
  const read = async () => (await (await f.call()).json()).sessions.find(s => s.id === sessionId);
  const cancel = async playerId => {
    const r = (await read()).registrations.find(r => r.playerId === playerId);
    return f.call({
      action: 'cancel',
      sessionId,
      registrationId: r.id,
      acceptLateCancellation: true,
    });
  };
  await book('p0', { name: 'Guest A', gender: 'M' });
  await book('p1');
  await cancel('p0');
  const billing = (query = '', payload) =>
    worker.fetch(
      new Request(origin + '/api/billing' + query, {
        method: payload ? 'POST' : 'GET',
        headers: { Cookie: cookie, Origin: origin },
        ...(payload ? { body: JSON.stringify(payload) } : {}),
      }),
      f.env,
    );
  const source = async () =>
    (await (await billing('?action=sessions')).json()).sessions.find(s => s.date === sessionId);
  let session = await source();
  assert.equal(session.attendees.length, 1);
  assert.equal(session.attendees[0].attended, true);
  assert.deepEqual(
    session.withdrawals.map(p => p.name),
    ['Player 0', 'Guest A'],
  );
  assert(
    session.withdrawals.every(
      p => p.attended === false && p.withdrawnAt === '2026-11-10T03:00:00.000Z',
    ),
  );
  await book('p0', { name: 'Guest A', gender: 'M' });
  assert.equal((await source()).withdrawals.length, 0);
  await cancel('p0');
  assert.equal((await source()).withdrawals.length, 2);
  const draft = { date: sessionId, court: 90000, shuttle: 0, transfer: '0000000000' };
  session = await source();
  const id = (await (await billing('', { ...draft, attendees: session.attendees })).json()).id;
  let bill = await (await billing('?bill=' + id)).json();
  assert.equal(bill.people, 1);
  assert.equal(bill.payers.length, 1);
  assert.equal(bill.payers[0].name, 'Player 1');
  const selected = { ...session.withdrawals[0] };
  const response = await billing('?bill=' + id + '&action=edit', {
    ...draft,
    revision: bill.revision,
    attendees: [...session.attendees, selected],
  });
  assert.equal(response.status, 200);
  bill = await (await billing('?bill=' + id)).json();
  assert.equal(bill.people, 2);
  assert.equal(bill.payers.length, 2);
  const payer = bill.payers.find(p => p.name === 'Player 0');
  assert.equal(payer.amount, 45000);
  assert.deepEqual(payer.withdrawals, [
    { name: 'Player 0', withdrawnAt: selected.withdrawnAt, lateCancellation: true },
  ]);
  await cancel('p1');
  assert.equal((await source()).attendees.length, 0);
  assert.equal((await source()).withdrawals.length, 3);
  assert.equal((await (await billing('?action=sessions&club=88')).json()).sessions.length, 0);
});

test('booking privacy, permissions, club isolation and invalid settings', async () => {
  const f = fixture();
  let d = await (await f.call()).json();
  assert.equal(d.canEdit, false);
  assert.equal(d.settings.enabled, false);
  assert.equal(d.roster.length, 12);
  assert(!JSON.stringify(d).includes('"lv"'));
  assert(!JSON.stringify(d).includes('ownerHash'));
  assert.equal(
    (await f.call({ action: 'settings', settingsVersion: 0, settings: defaultSettings() })).status,
    401,
  );
  assert.equal((await f.call({ action: 'close', sessionId: 'x', closed: true })).status, 401);
  assert.equal((await f.call({ action: 'book', playerId: 'p1', sessionIds: ['x'] })).status, 409);
  const { cookie, settings, data } = await f.open();
  assert.equal(data.canEdit, true);
  assert.equal((await (await f.call(null, { club: '88' })).json()).roster.length, 0);
  assert.equal(
    (await f.call({ action: 'settings', settingsVersion: 0, settings }, { cookie })).status,
    409,
  );
  assert.equal(
    (
      await f.call(
        { action: 'settings', settingsVersion: 1, settings: { ...settings, end: '00:00' } },
        { cookie },
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await f.call(
        { action: 'book', playerId: 'p0', sessionIds: [data.sessions[0].id] },
        { headers: { Origin: 'https://evil.example' } },
      )
    ).status,
    403,
  );
  assert.equal((await f.call(null, { owner: 'malformed' })).status, 400);
});
test('multiweek bookings are atomic, idempotent and ownership tokens never leak', async () => {
  const f = fixture(),
    { data } = await f.open(),
    ids = data.sessions.slice(0, 3).map(s => s.id);
  let r = await f.call({ action: 'book', playerId: 'p0', sessionIds: ids, acceptHoliday: true });
  assert.equal(r.status, 200);
  let d = await r.json();
  assert.equal(d.result.added, 3);
  assert.equal(d.sessions.filter(s => s.registrations.length).length, 3);
  assert(d.sessions[0].registrations[0].canCancel);
  assert(!JSON.stringify(d).includes('ownerHash'));
  assert(!JSON.stringify(d).includes(token));
  d = await (
    await f.call({ action: 'book', playerId: 'p0', sessionIds: ids, acceptHoliday: true })
  ).json();
  assert.equal(d.result.added, 0);
  assert.equal(d.result.duplicate, 3);
  assert.equal(
    (
      await f.call({
        action: 'book',
        playerId: 'p1',
        sessionIds: [ids[0], '1900-01-01'],
        acceptHoliday: true,
      })
    ).status,
    409,
  );
  d = await (await f.call()).json();
  assert.equal(d.sessions.find(s => s.id === ids[0]).registrations.length, 1);
  const other = await (await f.call(null, { owner: null })).json();
  assert.equal(other.sessions[0].registrations[0].canCancel, true);
  const reg = d.sessions[0].registrations[0],
    cancel = {
      action: 'cancel',
      acceptLateCancellation: true,
      sessionId: ids[0],
      registrationId: reg.id,
    };
  assert.equal(
    (await f.call(cancel, { owner: null, headers: { Origin: 'https://evil.example' } })).status,
    403,
  );
  assert.equal((await f.call(cancel, { owner: otherToken })).status, 200);
  assert.equal((await f.call(cancel, { owner: null })).status, 409);
});
test('concurrent final slots, automatic promotion, rejoin at tail and stale draw removal', async () => {
  const f = fixture(),
    { data } = await f.open(),
    id = data.sessions[0].id;
  const book = i =>
    f.call({ action: 'book', playerId: 'p' + i, sessionIds: [id], acceptHoliday: true });
  for (let i = 0; i < 6; i++) assert.equal((await book(i)).status, 200);
  const concurrent = await Promise.all([book(6), book(7), book(8), book(9)]);
  assert(concurrent.every(r => r.status === 200));
  let s = (await (await f.call()).json()).sessions[0];
  assert.equal(s.confirmedCount, 8);
  assert.equal(s.waitlistCount, 2);
  assert.equal(s.scheduleStatus, 'ready');
  assert.equal(s.schedule.schedule.length, 4);
  const version = s.scheduleVersion,
    firstWait = s.registrations.find(r => r.status === 'waitlist'),
    removed = s.registrations[0];
  assert.equal(
    (
      await f.call({
        action: 'cancel',
        acceptLateCancellation: true,
        sessionId: id,
        registrationId: removed.id,
      })
    ).status,
    200,
  );
  s = (await (await f.call()).json()).sessions[0];
  assert.equal(s.registrations.find(r => r.id === firstWait.id).status, 'confirmed');
  assert.equal(s.scheduleVersion, version + 1);
  assert(!JSON.stringify(s.schedule).includes('diff'));
  await f.call({
    action: 'book',
    playerId: removed.playerId,
    sessionIds: [id],
    acceptHoliday: true,
  });
  s = (await (await f.call()).json()).sessions[0];
  assert.equal(s.registrations.at(-1).playerId, removed.playerId);
  assert.equal(s.registrations.at(-1).status, 'waitlist');
  const before = s.scheduleVersion;
  await f.call({
    action: 'cancel',
    acceptLateCancellation: true,
    sessionId: id,
    registrationId: s.registrations.at(-1).id,
  });
  s = (await (await f.call()).json()).sessions[0];
  assert.equal(s.scheduleVersion, before);
  for (const r of s.registrations.filter(r => r.status === 'waitlist'))
    await f.call({
      action: 'cancel',
      acceptLateCancellation: true,
      sessionId: id,
      registrationId: r.id,
    });
  s = (await (await f.call()).json()).sessions[0];
  await f.call({
    action: 'cancel',
    acceptLateCancellation: true,
    sessionId: id,
    registrationId: s.registrations[0].id,
  });
  s = (await (await f.call()).json()).sessions[0];
  assert.equal(s.confirmedCount, 7);
  assert.equal(s.schedule, null);
  assert.equal(s.scheduleStatus, 'insufficient');
});
test('weekly regulars do not duplicate or reappear after cancellation; future weeks roll forward', async () => {
  const f = fixture(),
    { cookie, settings, data } = await f.open(['p0', 'p1']);
  const s = data.sessions[0];
  assert.equal(s.registrations.length, 2);
  assert(s.registrations.every(r => r.source === 'regular'));
  for (let i = 0; i < 2; i++)
    assert.equal((await (await f.call()).json()).sessions[0].registrations.length, 2);
  assert.equal(
    (
      await f.call(
        {
          action: 'cancel',
          acceptLateCancellation: true,
          sessionId: s.id,
          registrationId: s.registrations[0].id,
        },
        { owner: null },
      )
    ).status,
    200,
  );
  assert.equal((await (await f.call()).json()).sessions[0].registrations.length, 1);
  let r = await f.call(
    {
      action: 'settings',
      settingsVersion: 1,
      settings: { ...settings, regularIds: ['p0', 'p1', 'p2'] },
    },
    { cookie },
  );
  assert.equal(r.status, 200);
  assert.deepEqual(
    (await r.json()).sessions[0].registrations.map(r => r.playerId),
    ['p1', 'p2'],
  );
  const now = new Date('2026-11-03T05:00:00Z'),
    doc = {
      settings: { ...settings, weekdays: [2, 4], weeks: 2, regularIds: ['p0'] },
      settingsVersion: 0,
      sessions: [],
      seq: 0,
    };
  materialize(doc, players, now);
  assert.equal(doc.sessions.length, 4);
  materialize(doc, players, new Date('2026-11-10T05:00:00Z'));
  assert.equal(doc.sessions.length, 6);
  assert(doc.sessions.every(s => s.registrations.length === 1));
});
test('Bangkok date boundary, holiday acknowledgement, skip and organizer closure', async () => {
  assert.equal(bangkokDate(new Date('2026-11-03T18:00:00Z')), '2026-11-04');
  assert.equal(holidayOn('2026-12-10'), 'วันรัฐธรรมนูญ');
  assert.equal(holidayOn('2027-05-20'), 'วันวิสาขบูชา');
  const f = fixture(),
    { cookie, settings, data } = await f.open();
  const id = data.sessions[0].id;
  let r = await f.call(
    {
      action: 'settings',
      settingsVersion: 1,
      settings: { ...settings, holidays: [{ date: id, name: 'สนามปิดซ่อม' }] },
    },
    { cookie },
  );
  assert.equal(r.status, 200);
  assert.equal((await f.call({ action: 'book', playerId: 'p0', sessionIds: [id] })).status, 409);
  assert.equal(
    (await f.call({ action: 'book', playerId: 'p0', sessionIds: [id], acceptHoliday: true }))
      .status,
    200,
  );
  r = await f.call(
    {
      action: 'settings',
      settingsVersion: 2,
      settings: {
        ...settings,
        holidayPolicy: 'skip',
        holidays: [{ date: id, name: 'สนามปิดซ่อม' }],
      },
    },
    { cookie },
  );
  assert.equal(r.status, 200);
  const s = (await r.json()).sessions[0];
  assert.equal(s.skipped, true);
  assert.equal(s.registrations.length, 1);
  assert.equal(
    (await f.call({ action: 'book', playerId: 'p1', sessionIds: [id], acceptHoliday: true }))
      .status,
    409,
  );
  assert.equal(
    (await f.call({ action: 'close', sessionId: data.sessions[1].id, closed: true }, { cookie }))
      .status,
    200,
  );
  assert.equal(
    (
      await f.call({
        action: 'book',
        playerId: 'p1',
        sessionIds: [data.sessions[1].id],
        acceptHoliday: true,
      })
    ).status,
    409,
  );
});
test('a full regular roster saves schedules respecting rest and mixed-gender rules without exposing levels', async () => {
  const f = fixture(),
    { data } = await f.open(players.slice(0, 8).map(p => p.id));
  for (const s of data.sessions) {
    assert.equal(s.scheduleStatus, 'ready');
    const rounds = s.schedule.schedule;
    for (let i = 0; i < rounds.length; i++) {
      const ids = rounds[i].ids;
      assert.equal(new Set(ids).size, 4);
      if (i) assert(!ids.some(id => rounds[i - 1].ids.includes(id)));
      assert(
        globalThis.Sena.valid(
          ids.slice(0, 2).map(id => players.find(p => p.id === id)),
          ids.slice(2).map(id => players.find(p => p.id === id)),
        ),
      );
    }
  }
  assert.deepEqual(
    data.roster.map(p => p.lv),
    players.map(p => p.lv),
  );
  const d = await (await f.call()).json();
  assert(!JSON.stringify(d).includes('"lv"'));
  assert(!JSON.stringify(d).includes('"gender"'));
  assert(!JSON.stringify(d).includes('fingerprint'));
});

test('venue maps default for existing clubs, are editable only by organizers and stay club-specific', async () => {
  const f = fixture(),
    { cookie, data } = await f.open(['p0']);
  const sena = data.venueMapUrl;
  const court88 = (await (await f.call(null, { club: '88' })).json()).venueMapUrl;
  assert.equal(sena, 'https://maps.app.goo.gl/Krmzhw3QxseJ4thW6');
  assert.equal(court88, 'https://maps.app.goo.gl/9AwoUgdYb4gjNw2w8');
  const body = {
    action: 'venueMap',
    previousUrl: sena,
    url: 'https://www.google.com/maps/search/?api=1&query=Sena',
  };
  assert.equal((await f.call(body)).status, 401);
  for (const url of [
    'javascript:alert(1)',
    'http://maps.google.com/',
    'https://maps.app.goo.gl.evil.test/x',
    'https://www.google.com/url?q=https://evil.test',
    'https://name@maps.google.com/',
    '',
  ]) {
    assert.equal((await f.call({ ...body, url }, { cookie })).status, 400);
  }
  const saved = await (await f.call(body, { cookie })).json();
  assert.equal(saved.venueMapUrl, body.url);
  assert.equal(saved.settingsVersion, data.settingsVersion);
  assert.deepEqual(saved.sessions, data.sessions);
  assert.equal((await f.call(body, { cookie })).status, 200);
  assert.equal(
    (await f.call({ ...body, url: 'https://maps.google.com/?q=Other' }, { cookie })).status,
    409,
  );
  assert.equal((await (await f.call()).json()).venueMapUrl, body.url);
  assert.equal((await (await f.call(null, { club: '88' })).json()).venueMapUrl, court88);
});

test('Cup dates use calendar-month boundaries with distinct defaults for Sena and 88', () => {
  const dates = [
    '2027-03-07',
    '2027-03-08',
    '2027-03-14',
    '2027-03-15',
    '2027-03-21',
    '2027-03-22',
    '2027-03-28',
    '2027-03-29',
    '2027-04-08',
  ];
  const doc = {
    settings: defaultSettings(),
    sessions: dates.map(date => ({
      id: date,
      date,
      start: '19:00',
      capacity: 10,
      registrations: [],
    })),
  };
  const read = club => publicBooking(doc, 0, [], false, new Date('2027-03-01'), club);
  assert.deepEqual(
    read('sena')
      .sessions.filter(s => s.isCup)
      .map(s => s.date),
    ['2027-03-08', '2027-03-14', '2027-04-08'],
  );
  assert.deepEqual(
    read('88')
      .sessions.filter(s => s.isCup)
      .map(s => s.date),
    ['2027-03-22', '2027-03-28'],
  );
  doc.sessions[1].skipped = true;
  assert.equal(read('sena').sessions[1].isCup, false);
});

test('organizers can move Cup dates without rewriting bookings, and overrides survive weekly changes', async () => {
  const f = fixture(),
    { cookie, settings } = await f.open(['p0']);
  const set = await f.call(
    { action: 'settings', settingsVersion: 1, settings: { ...settings, weeks: 5 } },
    { cookie },
  );
  assert.equal(set.status, 200);
  const before = await set.json(),
    from = before.sessions.find(s => s.isCup),
    to = before.sessions.find(s => !s.isCup && !s.skipped);
  assert.equal(before.cupWeek, 2);
  const changes = [
    { date: from.date, isCup: false },
    { date: to.date, isCup: true },
  ];
  const body = { action: 'cupCalendar', cupVersion: 0, week: 2, changes };
  assert.equal((await f.call(body)).status, 401);
  assert.equal((await f.call({ ...body, week: 6 }, { cookie })).status, 400);
  assert.equal(
    (
      await f.call(
        { ...body, changes: [...changes, { date: '1900-01-01', isCup: true }] },
        { cookie },
      )
    ).status,
    409,
  );
  const r = await f.call(body, { cookie });
  assert.equal(r.status, 200);
  const saved = await r.json();
  assert.equal(saved.cupVersion, 1);
  assert.equal(saved.settingsVersion, before.settingsVersion);
  const strip = sessions => sessions.map(({ isCup, cupOverride, ...session }) => session);
  assert.deepEqual(strip(saved.sessions), strip(before.sessions));
  assert.equal((await f.call(body, { cookie })).status, 409);
  const next = await (
    await f.call({ ...body, week: 0, cupVersion: 1, changes: [] }, { cookie })
  ).json();
  assert.deepEqual(
    next.sessions.filter(s => s.isCup).map(s => s.date),
    [to.date],
  );
  const reset = await (
    await f.call(
      { ...body, week: 2, cupVersion: 2, changes: changes.map(c => ({ ...c, isCup: null })) },
      { cookie },
    )
  ).json();
  assert.deepEqual(
    reset.sessions.filter(s => s.isCup).map(s => s.date),
    before.sessions.filter(s => s.isCup).map(s => s.date),
  );
  const guest = await (await f.call()).json();
  assert.equal(guest.cupWeek, undefined);
  assert(guest.sessions.every(s => !('cupOverride' in s)));
  assert.equal((await (await f.call(null, { cookie, club: '88' })).json()).cupWeek, 4);
});

test('updated booking draw balances levels, preserves rest and pairs women’s doubles only with women’s doubles', () => {
  const now = new Date('2027-03-01T01:00:00Z'),
    date = '2027-03-02';
  const run = gender => {
    const roster = gender.map((g, i) => ({ id: 'x' + i, gender: g, lv: i < 4 ? 2 : 12 }));
    const registrations = roster.map(p => ({ playerId: p.id }));
    const session = {
      date,
      start: '19:00',
      rounds: 4,
      capacity: 8,
      registrations,
      scheduleVersion: 2,
      fingerprint: 'old',
    };
    refreshSchedules({ settings: { enabled: true }, sessions: [session] }, roster, now);
    assert.equal(session.scheduleStatus, 'ready');
    assert.equal(session.scheduleVersion, 3);
    for (const [i, round] of session.schedule.schedule.entries()) {
      const ids = round.ids;
      const women = team => team.every(id => roster.find(p => p.id === id).gender === 'F');
      assert.equal(women(ids.slice(0, 2)), women(ids.slice(2)));
      if (i) assert(!ids.some(id => session.schedule.schedule[i - 1].ids.includes(id)));
    }
    return session.schedule.schedule;
  };
  const even = run(['F', 'F', 'F', 'F', 'M', 'M', 'M', 'M']);
  assert(
    even.every(
      ({ ids }) =>
        ids.slice(0, 2).filter(id => Number(id.slice(1)) < 4).length ===
        ids.slice(2).filter(id => Number(id.slice(1)) < 4).length,
    ),
  );
  run(['F', 'F', 'F', 'F', 'F', 'M', 'M', 'M']);
});

test('booking shows latest completed Cup awards for the selected club without exposing levels', async () => {
  const f = fixture();
  await f.call();
  const add = f.db.prepare('INSERT INTO cup_history VALUES (?,1,?,?)');
  const match = { a: 0, b: 1, sa: 21, sb: 12 };
  add.run(
    'latest',
    1,
    JSON.stringify({
      date: '2026-11-01',
      teams: [
        ['Player 0', 'Player 1'],
        ['Player 2', 'Player 3'],
      ],
      matches: [match],
    }),
  );
  add.run(
    'older',
    2,
    JSON.stringify({
      date: '2026-10-01',
      teams: [
        ['Player 4', 'Player 5'],
        ['Player 6', 'Player 7'],
      ],
      matches: [match],
    }),
  );
  const data = await (await f.call(null, { owner: null })).json();
  assert.deepEqual(
    data.roster.slice(0, 8).map(p => p.award),
    ['🥇', '🥇', '💩', '💩', '', '', '', ''],
  );
  assert(!data.roster.some(p => 'lv' in p));
  await f.call(null, { club: '88' });
  f.db.exec('INSERT INTO club_state_88 SELECT * FROM club_state');
  const other = await (await f.call(null, { club: '88' })).json();
  assert(other.roster.length > 0 && other.roster.every(p => !p.award));
});

test('reroll is organizer-only and replaces the selected schedule without changing registrations or other dates', async () => {
  const f = fixture();
  f.db
    .prepare('UPDATE club_state SET payload=?')
    .run(JSON.stringify({ players: players.map(p => ({ ...p, lv: 5, gender: 'M' })), cup: null }));
  const { data, cookie } = await f.open(players.slice(0, 8).map(p => p.id));
  const [first, second] = data.sessions;
  const body = { action: 'reroll', sessionId: first.id, scheduleVersion: first.scheduleVersion };
  assert.equal((await f.call(body, { owner: null })).status, 401);
  const r = await f.call(body, { cookie });
  assert.equal(r.status, 200);
  const saved = await r.json(),
    changed = saved.sessions[0];
  assert.equal(changed.scheduleVersion, first.scheduleVersion + 1);
  assert.deepEqual(changed.registrations, first.registrations);
  assert.notDeepEqual(changed.schedule.schedule, first.schedule.schedule);
  assert.deepEqual(saved.sessions[1], second);
  assert.equal((await f.call(body, { cookie })).status, 409);
  assert.deepEqual((await (await f.call()).json()).sessions[0].schedule, changed.schedule);
});

test('Badbot links only via a signed one-time group command and rejects retired push actions', async t => {
  const f = fixture(),
    { cookie, data } = await f.open(['p0']);
  Object.assign(f.env, {
    LINE_CHANNEL_SECRET: 'test-only-secret',
    LINE_CHANNEL_ACCESS_TOKEN: 'test-only-token',
  });
  const call = (body, auth = cookie) =>
    worker.fetch(
      new Request(origin + '/api/line', {
        method: body ? 'POST' : 'GET',
        headers: { Origin: origin, Cookie: auth },
        ...(body ? { body: JSON.stringify(body) } : {}),
      }),
      f.env,
    );
  assert.equal((await call({ action: 'pair' }, '')).status, 401);
  const { code } = await (await call({ action: 'pair' })).json();
  const groupId = 'C' + 'a'.repeat(32);
  const check = () =>
    worker.fetch(
      new Request(origin + '/api/line?diagnose=1', { headers: { Cookie: cookie } }),
      f.env,
    );
  let active = false,
    signatureWorks = false;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (url.endsWith('/info')) return Response.json({ displayName: 'Badbot', basicId: '@badbot' });
    if (url.endsWith('/endpoint'))
      return Response.json({ endpoint: origin + '/api/line/webhook', active });
    if (url.endsWith('/test'))
      return Response.json({ success: signatureWorks, statusCode: signatureWorks ? 200 : 401 });
    assert.fail('Unexpected outbound request: ' + url);
  });
  assert.match((await (await check()).json()).diagnosis, /Use webhook/);
  active = true;
  assert.match((await (await check()).json()).diagnosis, /LINE_CHANNEL_SECRET/);
  signatureWorks = true;
  assert.match((await (await check()).json()).diagnosis, /Webhook ผ่านแล้ว/);
  const event = group =>
    JSON.stringify({
      events: [
        {
          type: 'message',
          source: { type: 'group', groupId: group },
          message: { type: 'text', text: '／badbot ' + String.fromCharCode(8203) + code },
        },
      ],
    });
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(f.env.LINE_CHANNEL_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signed = async raw =>
    Buffer.from(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(raw))).toString(
      'base64',
    );
  const hook = (body, signature) =>
    worker.fetch(
      new Request(origin + '/api/line/webhook', {
        method: 'POST',
        headers: { 'x-line-signature': signature },
        body,
      }),
      f.env,
    );
  const raw = event(groupId);
  assert.equal((await hook(raw, await signed('{}'))).status, 401);
  assert.equal((await (await call()).json()).connected, false);
  assert.equal((await hook(raw, await signed(raw))).status, 200);
  assert.equal((await (await call()).json()).connected, true);
  const other = event('C' + 'b'.repeat(32));
  assert.equal((await hook(other, await signed(other))).status, 200);
  const payload = { action: 'send', sessionId: data.sessions[0].id };
  assert.equal((await call(payload, '')).status, 401);
  assert.equal((await call(payload)).status, 400);
  assert.equal(
    (await call({ action: 'autoSettings', dailyLimit: 2, summaryTime: '17:00' })).status,
    400,
  );
  let scheduled = false;
  worker.scheduled({ cron: '*/5 * * * *' }, f.env, {
    waitUntil() {
      scheduled = true;
    },
  });
  assert.equal(scheduled, false);
});

test('court numbers inherit the venue default and preserve authorized per-date overrides', async t => {
  const f = fixture();
  t.after(() => f.db.close());
  const { cookie, settings, data } = await f.open();
  const [first, second] = data.sessions;
  const saveDefault = (courtNumbers, settingsVersion) =>
    f.call(
      { action: 'settings', settingsVersion, settings: { ...settings, courtNumbers } },
      { cookie },
    );
  assert.equal((await saveDefault('6,7', 1)).status, 200);
  const change = {
    action: 'courtNumbers',
    sessionId: first.id,
    courtNumbers: ' 9, 10, 9 ',
    previousCourtNumbers: null,
  };
  assert.equal((await f.call(change)).status, 401);
  assert.equal((await f.call({ ...change, courtNumbers: '6, x' }, { cookie })).status, 400);
  assert.equal((await f.call(change, { cookie })).status, 200);
  assert.equal((await f.call(change, { cookie })).status, 409);
  assert.equal((await saveDefault('3', 2)).status, 200);
  const read = async () => new Map((await (await f.call()).json()).sessions.map(s => [s.id, s]));
  let rows = await read();
  assert.equal(rows.get(first.id).courtNumbers, '9, 10');
  assert.equal(rows.get(second.id).courtNumbers, '3');
  assert.equal(
    (await f.call({ ...change, courtNumbers: '', previousCourtNumbers: '9, 10' }, { cookie }))
      .status,
    200,
  );
  rows = await read();
  assert.equal(rows.get(first.id).courtNumbers, '3');
});

test('guests occupy booking seats, join the draw, and retain the inviting member', async t => {
  const f = fixture();
  t.after(() => f.db.close());
  const { cookie, data } = await f.open();
  const sessionId = data.sessions[0].id;
  const book = async (playerId, guest) =>
    f.call({ action: 'book', playerId, sessionIds: [sessionId], acceptHoliday: true, guest });
  const read = async options => await (await f.call(null, options)).json();
  assert.equal((await book('p0')).status, 200);
  assert.equal((await book('p0', { name: 'Guest A', gender: 'X' })).status, 400);
  const guest = { name: 'Guest A', gender: 'F', lv: 99 };
  assert.equal((await (await book('p0', guest)).json()).result.guestsAdded, 1);
  assert.equal((await (await book('p0', guest)).json()).result.guestsAdded, 0);
  for (let i = 1; i <= 6; i++) assert.equal((await book('p' + i)).status, 200);
  const publicData = await read(),
    session = publicData.sessions.find(s => s.id === sessionId);
  const entry = session.registrations.find(r => r.guest);
  assert.deepEqual(entry.guest, { name: 'Guest A', hostId: 'p0' });
  assert.equal(
    publicData.roster.some(p => p.id === entry.playerId),
    false,
  );
  assert.equal(session.confirmedCount, 8);
  assert(session.schedule.counts[entry.playerId] > 0);
  const adminData = await read({ cookie });
  assert.equal(
    adminData.sessions.find(s => s.id === sessionId).registrations.find(r => r.guest).guest.lv,
    6.5,
  );
  const host = session.registrations.find(r => r.playerId === 'p0');
  assert.equal(
    (
      await f.call({
        action: 'cancel',
        acceptLateCancellation: true,
        sessionId,
        registrationId: host.id,
      })
    ).status,
    200,
  );
  assert.equal(
    (await read()).sessions.find(s => s.id === sessionId).registrations.some(r => r.guest),
    false,
  );
});
