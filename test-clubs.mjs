import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from './worker.js';
import seed from './seed.json' with { type: 'json' };
import { cleanCup, standings as leaderboardStandings } from './leaderboard.js';
test('clubs isolate roster writes, generation, history and totals while preserving legacy Sena', async () => {
  const db = new DatabaseSync(':memory:');
  db.exec(
    'CREATE TABLE club_state(id INTEGER PRIMARY KEY,revision INTEGER,payload TEXT,updated_at TEXT); CREATE TABLE login_attempts(ip TEXT PRIMARY KEY,window INTEGER,attempts INTEGER)',
  );
  const sena = {
    ...seed,
    players: Array.from({ length: 8 }, (_, i) => ({
      id: 's' + i,
      name: 'Sena ' + i,
      thai: '',
      lv: 7,
      gender: 'M',
    })),
  };
  db.prepare('INSERT INTO club_state VALUES(1,4,?,?)').run(JSON.stringify(sena), 'before');
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
            const r = stmt.run(...args);
            return { meta: { changes: r.changes } };
          },
        };
      },
    },
  };
  const login = await worker.fetch(
    new Request('https://example.com/api/login', {
      method: 'POST',
      headers: { Origin: 'https://example.com' },
      body: JSON.stringify({ key: env.ADMIN_KEY }),
    }),
    env,
  );
  const cookie = login.headers.get('Set-Cookie').split(';')[0];
  const get = async path =>
    (await worker.fetch(new Request('https://example.com' + path), env)).json();
  const post = (path, body, admin = true) =>
    worker.fetch(
      new Request('https://example.com' + path, {
        method: 'POST',
        headers: { Origin: 'https://example.com', ...(admin ? { Cookie: cookie } : {}) },
        body: JSON.stringify(body),
      }),
      env,
    );
  assert.equal((await get('/api/state')).revision, 4);
  let state88 = await get('/api/state?club=88');
  assert.equal(state88.state.players.length, 0);
  assert.equal(state88.revision, 0);
  const roster88 = {
    ...seed,
    players: Array.from({ length: 8 }, (_, i) => ({
      id: 'e' + i,
      name: '88 ' + i,
      thai: '',
      lv: 4,
      gender: 'M',
    })),
  };
  assert.equal(
    (await post('/api/state?club=88', { revision: 0, state: roster88 }, false)).status,
    401,
  );
  assert.equal((await post('/api/state?club=88', { revision: 0, state: roster88 })).status, 200);
  assert.equal((await get('/api/state')).state.players[0].name, 'Sena 0');
  assert.equal((await get('/api/state')).revision, 4);
  state88 = await get('/api/state?club=88');
  assert.equal(state88.state.players[0].name, '88 0');
  assert(!('lv' in state88.state.players[0]));
  assert.equal((await post('/api/state?club=88', { revision: 0, state: roster88 })).status, 409);
  assert.equal(
    (
      await post(
        '/api/generate?club=88',
        { selected: sena.players.map(p => p.id), rounds: 2, locks: [] },
        false,
      )
    ).status,
    409,
  );
  assert.equal(
    (
      await post(
        '/api/generate?club=88',
        { selected: roster88.players.map(p => p.id), rounds: 2, locks: [] },
        false,
      )
    ).status,
    200,
  );
  assert.equal((await get('/api/leaderboard')).standings.length, 15);
  assert.equal((await get('/api/leaderboard?club=88')).standings.length, 0);
  const input = {
    id: 'same-id',
    revision: 0,
    cup: {
      title: 'Test cup',
      date: '2026-11-03',
      inBaseline: false,
      teams: [
        ['P1', 'P2'],
        ['P3', 'P4'],
      ],
      matches: [{ a: 0, b: 1, sa: 21, sb: 10 }],
    },
  };
  assert.equal((await post('/api/leaderboard', input)).status, 200);
  assert.equal((await post('/api/leaderboard?club=88', input)).status, 200);
  assert.equal((await get('/api/leaderboard?club=88')).history.length, 1);
  assert.equal((await get('/api/leaderboard')).history.length, 1);
  assert.equal(
    (await get('/api/leaderboard?club=88')).standings.find(p => p.name === 'P1').played,
    1,
  );
  assert.equal((await get('/api/leaderboard')).standings.find(p => p.name === 'P1').played, 1);
  assert.equal(
    (await worker.fetch(new Request('https://example.com/api/state?club=invalid'), env)).status,
    400,
  );
});

test('Sena aliases are scoped to Sena and 88 has no historical baseline', () => {
  assert.deepEqual(leaderboardStandings([], '88'), []);
  assert.equal(
    cleanCup(
      {
        ...{
          title: 'Test cup',
          date: '2026-11-03',
          inBaseline: false,
          teams: [
            ['P1', 'P2'],
            ['P3', 'P4'],
          ],
          matches: [{ a: 0, b: 1, sa: 21, sb: 10 }],
        },
        teams: [
          ['Beau', 'Nott'],
          ['Bomb', 'Tom'],
        ],
      },
      '88',
    ).teams[0][0],
    'Beau',
  );
});

test('club config keeps the production table names, order and fallbacks', async () => {
  const { CLUB_LIST, CLUB_IDS, DEFAULT_CLUB, isClub, clubOf, counterpartClub } =
    await import('./clubs.js');
  // These names are in the live database: changing them would orphan existing data.
  assert.deepEqual(
    CLUB_LIST.map(c => [c.id, c.stateTable, c.cupTable]),
    [
      ['sena', 'club_state', 'cup_history'],
      ['88', 'club_state_88', 'cup_history_88'],
    ],
  );
  assert.deepEqual(CLUB_IDS, ['sena', '88']);
  assert.equal(DEFAULT_CLUB, 'sena');
  assert.deepEqual(
    [isClub('sena'), isClub('88'), isClub('99'), isClub(null)],
    [true, true, false, false],
  );
  assert.equal(clubOf('nope').id, 'sena');
  assert.deepEqual([counterpartClub('sena'), counterpartClub('88')], ['88', 'sena']);
  assert.deepEqual(
    CLUB_LIST.map(c => [c.label, c.heading, c.cupName, c.defaultCupWeek, c.hasBaseline]),
    [
      ['Sena', 'เสนา', 'Sena Cup', 2, true],
      ['88', '88', '88 Cup', 4, false],
    ],
  );
});
