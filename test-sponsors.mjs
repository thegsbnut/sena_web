import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import {
  activeSponsors,
  applyCupMoves,
  awardLabel,
  cleanSponsorInput,
  createSponsor,
  deleteSponsor,
  getSponsor,
  listSponsors,
  showUntil,
  sponsorView,
  updateSponsor,
} from './sponsors.js';

// A D1-like binding over in-memory SQLite.
export function sqliteD1(t) {
  const db = new DatabaseSync(':memory:');
  t?.after(() => db.close());
  return {
    raw: db,
    prepare(sql) {
      const stmt = db.prepare(sql);
      let values = [];
      return {
        bind(...args) {
          values = args;
          return this;
        },
        async first() {
          return stmt.get(...values) ?? null;
        },
        async all() {
          return { results: stmt.all(...values) };
        },
        async run() {
          return { meta: { changes: Number(stmt.run(...values).changes) } };
        },
      };
    },
  };
}

test('activeSponsors shows one cup at a time until cup day + 7', () => {
  const r = (id, cup_date, hidden = 0) => ({ id, cup_date, hidden });
  const rows = [
    r('a', '2026-12-12'),
    r('b', '2026-12-12'),
    r('t', '2027-01-09'),
    r('h', '2026-12-05', 1),
  ];
  const ids = today => activeSponsors(rows, today).map(x => x.id);
  assert.deepEqual(ids('2026-12-01'), ['a', 'b']);
  assert.deepEqual(ids('2026-12-19'), ['a', 'b']);
  assert.deepEqual(ids('2026-12-20'), ['t']);
  assert.deepEqual(ids('2027-01-16'), ['t']);
  assert.deepEqual(ids('2027-01-17'), []);
  assert.deepEqual(activeSponsors([], '2026-12-01'), []);
});

test('showUntil adds seven days across month and year ends', () => {
  assert.equal(showUntil('2026-12-28'), '2027-01-04');
  assert.equal(showUntil('2027-02-25'), '2027-03-04');
});

test('cleanSponsorInput trims, normalizes and enforces limits', () => {
  assert.deepEqual(
    cleanSponsorInput({ prize: '  ลูกแบด   1 หลอด ', award: 'champ' }, { admin: false }),
    { prize: 'ลูกแบด 1 หลอด', award: 'champ', awardNote: null, message: null, displayName: null },
  );
  assert.throws(
    () => cleanSponsorInput({ prize: '', award: 'champ' }, { admin: false }),
    /ของรางวัล/,
  );
  assert.throws(
    () => cleanSponsorInput({ prize: 'x'.repeat(61), award: 'all' }, { admin: false }),
    /60/,
  );
  assert.equal(
    cleanSponsorInput({ prize: 'x'.repeat(60), award: 'all' }, { admin: false }).prize.length,
    60,
  );
  assert.throws(
    () => cleanSponsorInput({ prize: 'x', award: 'other' }, { admin: false }),
    /มอบให้/,
  );
  assert.equal(
    cleanSponsorInput({ prize: 'x', award: 'other', awardNote: ' คนตบแรงสุด ' }, { admin: false })
      .awardNote,
    'คนตบแรงสุด',
  );
  assert.equal(
    cleanSponsorInput({ prize: 'x', award: 'all', awardNote: 'zzz' }, { admin: false }).awardNote,
    null,
  );
  assert.throws(() => cleanSponsorInput({ prize: 'x', award: 'king' }, { admin: false }));
  assert.throws(
    () =>
      cleanSponsorInput({ prize: 'x', award: 'all', message: 'y'.repeat(61) }, { admin: false }),
    /60/,
  );
  assert.equal(
    cleanSponsorInput({ prize: 'x', award: 'all', displayName: 'ร้าน A' }, { admin: false })
      .displayName,
    null,
  );
  assert.equal(
    cleanSponsorInput({ prize: 'x', award: 'all', displayName: 'ร้าน A' }, { admin: true })
      .displayName,
    'ร้าน A',
  );
  assert.equal(
    cleanSponsorInput(
      { prize: 'x', award: 'all', playerId: 'p1', displayName: 'ร้าน A' },
      { admin: true },
    ).displayName,
    null,
  );
  assert.equal(cleanSponsorInput({ prize: 'é', award: 'all' }, { admin: false }).prize, 'é');
});

test('awardLabel', () => {
  assert.equal(awardLabel('champ'), '🥇 แชมป์');
  assert.equal(awardLabel('runnerUp'), '🥈 รองแชมป์');
  assert.equal(awardLabel('third'), '🥉 ที่ 3');
  assert.equal(awardLabel('last'), '💩 ท้ายตาราง');
  assert.equal(awardLabel('all'), 'ทุกคน');
  assert.equal(awardLabel('other', 'คนตบแรงสุด'), 'คนตบแรงสุด');
});

const base = { prize: 'ลูกแบด', award: 'champ', awardNote: null, message: null };
const add = (db, id, playerId, extra = {}) =>
  createSponsor(
    db,
    {
      id,
      club: 'sena',
      cupDate: '2026-12-12',
      playerId,
      displayName: playerId || 'ร้าน',
      ...base,
      ...extra,
    },
    1000,
  );
const status = async promise => {
  try {
    await promise;
    return 'ok';
  } catch (e) {
    return e.status + ' ' + e.message;
  }
};

test('createSponsor caps a cup day at 10 and one entry per player', async t => {
  const db = sqliteD1(t);
  for (let i = 0; i < 10; i++) await add(db, 's' + i, 'p' + i);
  assert.match(await status(add(db, 's10', 'p10')), /^409 .*ครบ 10/);
  assert.match(await status(add(db, 'x', 'p1')), /^409 .*แล้ว/);
  const again = await add(db, 's3', 'p3');
  assert.equal(again.id, 's3');
  assert.equal((await listSponsors(db, { clubs: ['sena'] })).length, 10);
  assert.equal(await status(add(db, 'other', 'p20', { cupDate: '2026-12-19' })), 'ok');
});

test('organizer entries without a player do not collide', async t => {
  const db = sqliteD1(t);
  await add(db, 'a', null, { displayName: 'ร้าน A' });
  await add(db, 'b', null, { displayName: 'ร้าน B' });
  assert.equal((await listSponsors(db, { clubs: ['sena'] })).length, 2);
});

test('update and delete use the revision', async t => {
  const db = sqliteD1(t);
  await add(db, 'a', 'p1');
  assert.match(await status(updateSponsor(db, 'a', 2, { ...base, prize: 'ใหม่' }, 2000)), /^409/);
  const row = await updateSponsor(db, 'a', 1, { ...base, prize: 'ใหม่' }, 2000);
  assert.equal(row.prize, 'ใหม่');
  assert.equal(row.revision, 2);
  assert.equal(row.display_name, 'p1');
  assert.match(await status(deleteSponsor(db, 'a', 1)), /^409/);
  await deleteSponsor(db, 'a', 2);
  assert.equal(await getSponsor(db, 'a'), null);
});

test('listSponsors filters club, dates, hidden rows and from', async t => {
  const db = sqliteD1(t);
  await add(db, 'a', 'p1');
  await add(db, 'b', 'p2', { cupDate: '2026-11-01' });
  await add(db, 'c', 'p3', { club: '88' });
  db.raw.exec("UPDATE cup_sponsors SET hidden=1 WHERE id='a'");
  await add(db, 'd', 'p4');
  const ids = async q => (await listSponsors(db, q)).map(r => r.id).sort();
  assert.deepEqual(await ids({ clubs: ['sena'] }), ['b', 'd']);
  assert.deepEqual(await ids({ clubs: ['sena'], from: '2026-12-01' }), ['d']);
  assert.deepEqual(await ids({ clubs: ['sena', '88'], dates: ['2026-12-12'] }), ['c', 'd']);
});

test('sponsorView follows roster names and edit rights', () => {
  const rows = [
    { id: 'a', player_id: 'p1', display_name: 'Old', prize: 'x', award: 'champ', revision: 1 },
    { id: 'b', player_id: 'gone', display_name: 'Ghost', prize: 'y', award: 'all', revision: 1 },
    {
      id: 'c',
      player_id: null,
      display_name: 'ร้าน',
      prize: 'z',
      award: 'other',
      award_note: 'MVP',
      revision: 3,
    },
  ];
  const players = [{ id: 'p1', name: 'Nott' }];
  const view = sponsorView(rows, { players, ownId: 'p1', admin: false, started: false });
  assert.deepEqual(
    view.map(v => [v.name, v.mine, v.canEdit, v.awardLabel]),
    [
      ['Nott', true, true, '🥇 แชมป์'],
      ['Ghost', false, false, 'ทุกคน'],
      ['ร้าน', false, false, 'MVP'],
    ],
  );
  assert.equal(
    sponsorView(rows, { players, ownId: 'p1', admin: false, started: true })[0].canEdit,
    false,
  );
  assert.ok(
    sponsorView(rows, { players, ownId: null, admin: true, started: true }).every(v => v.canEdit),
  );
});

test('applyCupMoves moves, hides and restores sponsors', async t => {
  const db = sqliteD1(t);
  for (let i = 0; i < 6; i++) await add(db, 'a' + i, 'p' + i);
  for (let i = 4; i < 10; i++) await add(db, 'b' + i, 'p' + i, { cupDate: '2026-12-19' });
  await add(db, 'z', 'p1', { cupDate: '2026-12-26' });
  await applyCupMoves(
    db,
    'sena',
    {
      lost: ['2026-12-12', '2026-12-26'],
      gained: [],
      moves: [{ from: '2026-12-12', to: '2026-12-19' }],
    },
    5000,
  );
  const on = async date =>
    (await listSponsors(db, { clubs: ['sena'], dates: [date] })).map(r => r.id).sort();
  // p4/p5 already sponsor the 19th: their rows from the 12th are hidden, not duplicated.
  assert.deepEqual(await on('2026-12-19'), [
    'a0',
    'a1',
    'a2',
    'a3',
    'b4',
    'b5',
    'b6',
    'b7',
    'b8',
    'b9',
  ]);
  assert.deepEqual(await on('2026-12-12'), []);
  assert.deepEqual(await on('2026-12-26'), []);
  assert.equal((await getSponsor(db, 'a0')).revision, 2);
  await applyCupMoves(db, 'sena', { lost: [], gained: ['2026-12-26'], moves: [] }, 6000);
  assert.deepEqual(await on('2026-12-26'), ['z']);
});

test('moving past the cap keeps everyone', async t => {
  const db = sqliteD1(t);
  for (let i = 0; i < 8; i++) await add(db, 'a' + i, 'p' + i);
  for (let i = 8; i < 12; i++) await add(db, 'b' + i, 'p' + i, { cupDate: '2026-12-19' });
  await applyCupMoves(
    db,
    'sena',
    { lost: ['2026-12-12'], gained: [], moves: [{ from: '2026-12-12', to: '2026-12-19' }] },
    5000,
  );
  assert.equal((await listSponsors(db, { clubs: ['sena'], dates: ['2026-12-19'] })).length, 12);
});

test('a hidden row does not block the same player from moving back in', async t => {
  const db = sqliteD1(t);
  await add(db, 'old', 'p1', { cupDate: '2026-12-19' });
  await applyCupMoves(db, 'sena', { lost: ['2026-12-19'], gained: [], moves: [] }, 2000);
  await add(db, 'new', 'p1');
  await applyCupMoves(
    db,
    'sena',
    { lost: ['2026-12-12'], gained: [], moves: [{ from: '2026-12-12', to: '2026-12-19' }] },
    3000,
  );
  assert.deepEqual(
    (await listSponsors(db, { clubs: ['sena'], dates: ['2026-12-19'] })).map(r => r.id),
    ['new'],
  );
});

// ---- /api/booking integration ----
const { bookingRoute, defaultSettings, bangkokDate } = await import('./booking.js');
const roster = ['Nott', 'Beau', 'Ice', 'Pong'].map((name, i) => ({
  id: 'p' + i,
  name,
  thai: '',
  lv: 5,
  gender: 'M',
}));
const day = n => bangkokDate(new Date(Date.now() + n * 86400000));
function bookingFixture(t) {
  const db = sqliteD1(t);
  for (const table of ['club_state', 'club_state_88']) {
    db.raw.exec(
      `CREATE TABLE ${table}(id INTEGER PRIMARY KEY,revision INTEGER,payload TEXT,updated_at TEXT)`,
    );
    db.raw
      .prepare(`INSERT INTO ${table} VALUES(1,1,?,?)`)
      .run(JSON.stringify({ players: roster, selected: [], cup: null }), 'x');
  }
  const env = { DB: db, LINE_MEMBER_AUTH_ENABLED: 'true', LINE_LIFF_ID: 'liff-test' };
  const member = id => ({ userId: 'U' + id, link: { status: 'approved', player_id: id } });
  const call = async (body, { admin = false, as = null, club = 'sena' } = {}) => {
    const response = await bookingRoute(
      new Request('https://example.com/api/booking' + (club === '88' ? '?club=88' : ''), {
        method: body ? 'POST' : 'GET',
        headers: { Origin: 'https://example.com', 'X-Booking-Token': 'a'.repeat(64) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      }),
      env,
      admin,
      club,
      as ? member(as) : null,
    );
    return { status: response.status, data: await response.json() };
  };
  // Every day open for 2 weeks; Cup only where cupCalendar says (week 0 = none by default).
  const open = async (club = 'sena', cups = [day(3)]) => {
    const settings = {
      ...defaultSettings(),
      enabled: true,
      weekdays: [0, 1, 2, 3, 4, 5, 6],
      weeks: 2,
    };
    let r = await call({ action: 'settings', settingsVersion: 0, settings }, { admin: true, club });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    r = await call(
      {
        action: 'cupCalendar',
        week: 0,
        cupVersion: 0,
        changes: cups.map(date => ({ date, isCup: true })),
      },
      { admin: true, club },
    );
    assert.equal(r.status, 200, JSON.stringify(r.data));
    return r.data;
  };
  const sponsor = (as, extra = {}) =>
    call(
      {
        action: 'sponsorSave',
        date: day(3),
        playerId: as,
        prize: 'ลูกแบด 1 หลอด',
        award: 'champ',
        ...extra,
      },
      { as },
    );
  const cupOf = (data, date = day(3)) => data.sessions.find(s => s.date === date);
  return { db, env, call, open, sponsor, cupOf };
}

test('a member sponsors a Cup day and sees it on the booking page', async t => {
  const f = bookingFixture(t);
  await f.open();
  const r = await f.sponsor('p1', { message: 'สู้ๆ' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.result.message, 'บันทึกสปอนเซอร์แล้ว');
  const mine = f.cupOf((await f.call(null, { as: 'p1' })).data);
  assert.deepEqual(
    mine.sponsors.map(s => [s.name, s.prize, s.awardLabel, s.mine, s.canEdit]),
    [['Beau', 'ลูกแบด 1 หลอด', '🥇 แชมป์', true, true]],
  );
  assert.equal(mine.sponsorFull, false);
  const other = f.cupOf((await f.call(null, { as: 'p2' })).data);
  assert.equal(other.sponsors[0].mine, false);
  assert.equal(other.sponsors[0].canEdit, false);
  const regular = (await f.call(null)).data.sessions.find(s => !s.isCup);
  assert.equal(regular.sponsors, undefined);
});

test('sponsoring is refused on a regular day, for someone else, or when not logged in', async t => {
  const f = bookingFixture(t);
  await f.open();
  assert.equal((await f.sponsor('p1', { date: day(4) })).status, 409);
  assert.equal(
    (
      await f.call(
        { action: 'sponsorSave', date: day(3), playerId: 'p2', prize: 'x', award: 'all' },
        { as: 'p1' },
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await f.call({
        action: 'sponsorSave',
        date: day(3),
        playerId: 'p2',
        prize: 'x',
        award: 'all',
      })
    ).status,
    403,
  );
  assert.equal((await f.sponsor('p1', { prize: '' })).status, 400);
});

test('only the owner or an organizer can edit or delete', async t => {
  const f = bookingFixture(t);
  await f.open();
  const { id, revision } = f.cupOf((await f.sponsor('p1')).data).sponsors[0];
  const edit = { action: 'sponsorSave', id, revision, date: day(3), prize: 'ไม้แบด', award: 'all' };
  assert.equal((await f.call({ ...edit, playerId: 'p2' }, { as: 'p2' })).status, 403);
  const r = await f.call({ ...edit, playerId: 'p1' }, { as: 'p1' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(f.cupOf(r.data).sponsors[0].prize, 'ไม้แบด');
  assert.equal((await f.call({ ...edit, playerId: 'p1' }, { as: 'p1' })).status, 409);
  assert.equal(
    (await f.call({ action: 'sponsorDelete', id, revision: 2 }, { as: 'p2' })).status,
    403,
  );
  const gone = await f.call({ action: 'sponsorDelete', id, revision: 2 }, { admin: true });
  assert.equal(gone.status, 200);
  assert.equal(gone.data.result.message, 'ยกเลิกการเป็นสปอนเซอร์แล้ว');
  assert.deepEqual(f.cupOf(gone.data).sponsors, []);
});

test('an organizer can add a sponsor who is not a player', async t => {
  const f = bookingFixture(t);
  await f.open();
  const r = await f.call(
    {
      action: 'sponsorSave',
      date: day(3),
      displayName: 'ร้านแบดมินตัน',
      prize: 'ลูกแบด',
      award: 'all',
    },
    { admin: true },
  );
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(f.cupOf(r.data).sponsors[0].name, 'ร้านแบดมินตัน');
});

test('notify asks the page to post a notice with a sponsor code', async t => {
  const f = bookingFixture(t);
  await f.open();
  const r = await f.sponsor('p1', { notify: true });
  const { noticeDay } = await import('./line-notices.js');
  assert.match(
    r.data.notice.text,
    new RegExp('^🎁 ขอเป็นสปอนเซอร์ SENA ' + noticeDay(day(3)) + ' #[a-z0-9]{5}$'),
  );
  assert.equal(r.data.notice.liffId, 'liff-test');
  const code = r.data.notice.text.slice(-5);
  const row = f.db.raw.prepare('SELECT kind,payload FROM line_notices WHERE code=?').get(code);
  assert.equal(row.kind, 'sponsor');
  assert.equal(JSON.parse(row.payload).id, f.cupOf(r.data).sponsors[0].id);
  assert.equal((await f.sponsor('p2')).data.notice, undefined);
});

test('clubs keep their own sponsors', async t => {
  const f = bookingFixture(t);
  await f.open();
  await f.open('88');
  await f.sponsor('p1');
  const r88 = await f.call(null, { club: '88' });
  assert.deepEqual(f.cupOf(r88.data).sponsors, []);
});

test('moving the Cup moves its sponsors when the organizer picks the new day', async t => {
  const f = bookingFixture(t);
  await f.open();
  await f.sponsor('p1');
  const r = await f.call(
    {
      action: 'cupCalendar',
      week: 0,
      cupVersion: 1,
      changes: [
        { date: day(3), isCup: null },
        { date: day(5), isCup: true },
      ],
      sponsorMoves: [{ from: day(3), to: day(5) }],
    },
    { admin: true },
  );
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(f.cupOf(r.data, day(5)).sponsors[0].name, 'Beau');
});

test('a Cup lost through the week setting can move its sponsors too', async t => {
  const f = bookingFixture(t);
  const cupDay = day(3),
    week = Math.ceil(Number(cupDay.slice(8, 10)) / 7);
  // Make day(3) a Cup by week, then sponsor it.
  let r = await f.call(
    {
      action: 'settings',
      settingsVersion: 0,
      settings: { ...defaultSettings(), enabled: true, weekdays: [0, 1, 2, 3, 4, 5, 6], weeks: 2 },
    },
    { admin: true },
  );
  r = await f.call({ action: 'cupCalendar', week, cupVersion: 0, changes: [] }, { admin: true });
  assert.ok(f.cupOf(r.data).isCup);
  await f.sponsor('p1');
  const target = day(12);
  r = await f.call(
    {
      action: 'cupCalendar',
      week: 0,
      cupVersion: 1,
      changes: [{ date: target, isCup: true }],
      sponsorMoves: [{ from: cupDay, to: target }],
    },
    { admin: true },
  );
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(f.cupOf(r.data, target).sponsors.length, 1);
});

test('without a move the sponsors are hidden, and come back with the Cup', async t => {
  const f = bookingFixture(t);
  await f.open();
  await f.sponsor('p1');
  let r = await f.call(
    { action: 'cupCalendar', week: 0, cupVersion: 1, changes: [{ date: day(3), isCup: null }] },
    { admin: true },
  );
  assert.equal(f.db.raw.prepare('SELECT hidden FROM cup_sponsors').get().hidden, 1);
  r = await f.call(
    { action: 'cupCalendar', week: 0, cupVersion: 2, changes: [{ date: day(3), isCup: true }] },
    { admin: true },
  );
  assert.equal(f.cupOf(r.data).sponsors.length, 1);
});

test('a move to a day that is not a Cup is refused and the calendar is not saved', async t => {
  const f = bookingFixture(t);
  await f.open();
  await f.sponsor('p1');
  const r = await f.call(
    {
      action: 'cupCalendar',
      week: 0,
      cupVersion: 1,
      changes: [{ date: day(3), isCup: null }],
      sponsorMoves: [{ from: day(3), to: day(6) }],
    },
    { admin: true },
  );
  assert.equal(r.status, 400);
  assert.match(r.data.error, /ย้ายสปอนเซอร์/);
  assert.ok(f.cupOf((await f.call(null)).data).isCup);
});

test('the booking page still loads when sponsors cannot be read', async t => {
  const f = bookingFixture(t);
  await f.open();
  await f.sponsor('p1');
  const prepare = f.db.prepare.bind(f.db);
  f.db.prepare = sql => {
    if (/FROM cup_sponsors/.test(sql)) throw Error('D1 down');
    return prepare(sql);
  };
  t.mock.method(console, 'error', () => {});
  const r = await f.call(null);
  assert.equal(r.status, 200);
  assert.deepEqual(f.cupOf(r.data).sponsors, []);
});

test("an organizer edits a player's entry without sending the player", async t => {
  const f = bookingFixture(t);
  await f.open();
  const { id, revision } = f.cupOf((await f.sponsor('p1')).data).sponsors[0];
  const r = await f.call(
    { action: 'sponsorSave', id, revision, prize: 'ไม้แบด', award: 'third' },
    { admin: true },
  );
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual(
    [f.cupOf(r.data).sponsors[0].name, f.cupOf(r.data).sponsors[0].awardLabel],
    ['Beau', '🥉 ที่ 3'],
  );
});
