import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import './public/job-rules.js';
import { recordAttendance } from './job-badges.js';
import { scheduledBookings } from './booking.js';

const R = globalThis.SenaJobRules;

test('job levels and stars follow the spec boundaries', () => {
  const at = n => R.jobLevel(n);
  assert.deepEqual(
    [0, 4, 5, 14, 15, 29, 30, 59, 60, 89, 90, 180, 999].map(n => [at(n).lvl, at(n).stars]),
    [
      [0, 0],
      [0, 0],
      [1, 0],
      [1, 0],
      [2, 0],
      [2, 0],
      [3, 0],
      [3, 0],
      [3, 1],
      [3, 1],
      [3, 2],
      [3, 5],
      [3, 5],
    ],
  );
});

test('default line is stable per player and spreads across all five lines', () => {
  assert.deepEqual(R.LINES, ['red', 'green', 'yellow', 'pink', 'blue']);
  assert.equal(R.defaultLine('p1'), R.defaultLine('p1'));
  const seen = new Set(Array.from({ length: 50 }, (_, i) => R.defaultLine('player-' + i)));
  assert.equal(seen.size, 5);
});

function fakeDb() {
  const db = new DatabaseSync(':memory:');
  const DB = {
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
  };
  const rows = sql =>
    db
      .prepare(sql)
      .all()
      .map(r => ({ ...r }));
  return { db, DB, rows };
}
const roster = Array.from({ length: 6 }, (_, i) => ({
  id: 'p' + i,
  name: 'Player ' + i,
  thai: '',
  lv: 5,
  gender: 'M',
}));
const reg = (playerId, extra = {}) => ({
  id: 'r-' + playerId + Math.random(),
  playerId,
  source: 'online',
  ...extra,
});

test('cron records past confirmed roster players once, skipping guests, waitlist, skipped and today', async () => {
  const { DB, rows } = fakeDb();
  const doc = {
    sessions: [
      {
        date: '2026-11-10',
        capacity: 3,
        registrations: [
          reg('p0'),
          reg('g1', { guest: { name: 'Guest', hostId: 'p0' } }),
          reg('p1'),
          reg('p2'),
        ],
      },
      { date: '2026-11-11', capacity: 3, skipped: true, registrations: [reg('p3')] },
      { date: '2026-11-12', capacity: 3, registrations: [reg('gone')] },
      { date: '2026-11-13', capacity: 3, registrations: [reg('p4')] },
    ],
  };
  assert.equal(await recordAttendance(DB, 'sena', doc, roster, '2026-11-13'), 2);
  assert.equal(await recordAttendance(DB, 'sena', doc, roster, '2026-11-13'), 0);
  assert.deepEqual(
    rows('SELECT player_id FROM attendance ORDER BY player_id').map(r => r.player_id),
    ['p0', 'p1'],
  );
});

test('scheduledBookings records attendance for each club separately', async () => {
  const { db, DB, rows } = fakeDb();
  db.exec(
    'CREATE TABLE club_state(id INTEGER PRIMARY KEY,revision INTEGER,payload TEXT,updated_at TEXT)',
  );
  db.prepare('INSERT INTO club_state VALUES(1,1,?,?)').run(
    JSON.stringify({ players: roster, cup: null }),
    'x',
  );
  const env = { DB };
  const now = new Date('2026-11-13T18:00:00Z'); // 01:00 on 14 Nov in Bangkok
  await scheduledBookings(env, now);
  const row = db.prepare("SELECT payload FROM booking_clubs WHERE club='sena'").get();
  const doc = JSON.parse(row.payload);
  doc.sessions.push({
    id: 'past',
    date: '2026-11-13',
    start: '19:00',
    end: '21:00',
    capacity: 12,
    registrations: [reg('p0')],
  });
  db.prepare("UPDATE booking_clubs SET payload=? WHERE club='sena'").run(JSON.stringify(doc));
  await scheduledBookings(env, now);
  assert.deepEqual(rows('SELECT club, player_id, session_date FROM attendance'), [
    { club: 'sena', player_id: 'p0', session_date: '2026-11-13' },
  ]);
});
