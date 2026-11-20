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
