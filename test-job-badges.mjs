import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import './public/job-rules.js';
import { recordAttendance } from './job-badges.js';
import { scheduledBookings, bookingRoute } from './booking.js';
import worker from './worker.js';

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

function bookingEnv() {
  const f = fakeDb();
  f.db.exec(
    'CREATE TABLE club_state(id INTEGER PRIMARY KEY,revision INTEGER,payload TEXT,updated_at TEXT); CREATE TABLE login_attempts(ip TEXT PRIMARY KEY,window INTEGER,attempts INTEGER)',
  );
  f.db
    .prepare('INSERT INTO club_state VALUES(1,1,?,?)')
    .run(JSON.stringify({ players: roster, cup: null }), 'x');
  const env = { ADMIN_KEY: 'abcdef7', DB: f.DB };
  const get = async () =>
    (
      await worker.fetch(
        new Request('https://example.com/api/booking', {
          headers: { Origin: 'https://example.com' },
        }),
        env,
      )
    ).json();
  return { ...f, env, get };
}

test('booking roster carries plays, chosen or default line and Cup titles', async () => {
  const f = bookingEnv();
  await f.get();
  const add = f.db.prepare("INSERT INTO attendance VALUES ('sena', ?, ?)");
  for (let d = 1; d <= 6; d++) add.run('2026-10-0' + d, 'p0');
  add.run('2026-10-01', 'gone');
  f.db.prepare("INSERT INTO player_jobs VALUES ('sena','p0','pink','x')").run();
  const cup = f.db.prepare('INSERT INTO cup_history VALUES (?,1,?,?)');
  const match = [{ a: 0, b: 1, sa: 21, sb: 12 }];
  cup.run(
    'old',
    1,
    JSON.stringify({
      date: '2026-10-01',
      teams: [
        ['Player 0', 'Player 1'],
        ['Player 2', 'Player 3'],
      ],
      matches: match,
    }),
  );
  cup.run(
    'latest',
    2,
    JSON.stringify({
      date: '2026-11-01',
      teams: [
        ['player 0', 'Player 4'],
        ['Player 2', 'Player 5'],
      ],
      matches: match,
    }),
  );
  const data = await f.get();
  assert.equal(data.roster.length, roster.length);
  assert.deepEqual(data.roster[0].badge, {
    plays: 6,
    line: 'pink',
    chosen: true,
    titles: 2,
    latestChamp: true,
  });
  assert.deepEqual(data.roster[3].badge, {
    plays: 0,
    line: R.defaultLine('p3'),
    chosen: false,
    titles: 0,
    latestChamp: false,
  });
  assert.equal(data.roster[1].badge.titles, 1);
});

test('approved members change only their own line without touching the booking revision', async () => {
  const f = bookingEnv();
  await f.get();
  const revision = () =>
    f.db.prepare("SELECT revision FROM booking_clubs WHERE club='sena'").get().revision;
  const route = (body, member) =>
    bookingRoute(
      new Request('https://example.com/api/booking', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
      f.env,
      false,
      'sena',
      member,
    );
  const approved = id => ({ link: { status: 'approved', player_id: id } });
  const before = revision();
  const res = await route({ action: 'job', line: 'blue' }, approved('p0'));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.roster[0].badge.line, 'blue');
  assert.equal(body.result.message, 'เปลี่ยนสายแล้ว');
  assert.equal(revision(), before);
  assert.equal((await route({ action: 'job', line: 'purple' }, approved('p0'))).status, 400);
  assert.equal(
    (await route({ action: 'job', line: 'red' }, { link: { status: 'pending', player_id: 'p0' } }))
      .status,
    401,
  );
  assert.equal((await route({ action: 'job', line: 'red' }, null)).status, 401);
  assert.deepEqual(f.rows('SELECT player_id, line FROM player_jobs'), [
    { player_id: 'p0', line: 'blue' },
  ]);
});

test('badge markup reflects level, line, crown, stars and own-only ready marker', async () => {
  await import('./public/job-badges.js');
  const J = globalThis.SenaJobs;
  const b = (o = {}) => ({
    plays: 0,
    line: 'red',
    chosen: false,
    titles: 0,
    latestChamp: false,
    ...o,
  });
  assert.match(J.badgeHtml(b(), 35), /aria-label="Novice"/);
  assert.equal(J.jobName(b({ plays: 30, line: 'blue' })), 'Weapon Dealer');
  assert.equal(J.jobName(b({ plays: 15, line: 'yellow' })), 'Drifter');
  assert.equal(J.jobThai(b({ plays: 5, line: 'pink' })), 'นักหยอดหน้าเน็ต');
  assert.match(J.badgeHtml(b({ plays: 95 }), 35), /★★</);
  assert.doesNotMatch(J.badgeHtml(b({ plays: 6 }), 35), /jb-ready/);
  assert.match(J.badgeHtml(b({ plays: 6 }), 35, { mine: true }), /jb-ready/);
  assert.doesNotMatch(J.badgeHtml(b({ plays: 6, chosen: true }), 35, { mine: true }), /jb-ready/);
  assert.match(J.badgeHtml(b({ titles: 3, latestChamp: true }), 35), /jb-pip jb-fresh[\s\S]*>3</);
  assert.match(J.badgeHtml(b({ plays: 40, line: '<x>' }), 35), /aria-label="Novice"/);
  assert.match(J.defsHtml(), /id="jb-clip"/);
});

test('an unchosen champion still sees the ready marker next to the crown on their own badge', async () => {
  await import('./public/job-badges.js');
  const html = globalThis.SenaJobs.badgeHtml(
    { plays: 40, line: 'red', chosen: false, titles: 1, latestChamp: false },
    35,
    { mine: true },
  );
  assert.match(html, /jb-pip/);
  assert.match(html, /jb-ready/);
});
