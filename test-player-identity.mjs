import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from './worker.js';
import { cleanCup, identityFrom } from './leaderboard.js';
import { badgesFrom } from './job-badges.js';

const players = [
  { id: 'a', name: 'Ann', thai: 'แอน', lv: 5, gender: 'F' },
  { id: 'b', name: 'Bob', thai: '', lv: 5, gender: 'M' },
  { id: 'c', name: 'Cat', thai: '', lv: 5, gender: 'F' },
  { id: 'd', name: 'Dan', thai: '', lv: 5, gender: 'M' },
];
function fixture(t) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  db.exec(
    'CREATE TABLE club_state(id INTEGER PRIMARY KEY,revision INTEGER,payload TEXT,updated_at TEXT); CREATE TABLE club_state_88(id INTEGER PRIMARY KEY,revision INTEGER,payload TEXT,updated_at TEXT); CREATE TABLE login_attempts(ip TEXT PRIMARY KEY,window INTEGER,attempts INTEGER); CREATE TABLE cup_history_88 (id TEXT PRIMARY KEY, revision INTEGER NOT NULL, sequence INTEGER NOT NULL, payload TEXT NOT NULL)',
  );
  const roster = list =>
    db
      .prepare(
        "INSERT INTO club_state_88 (id,revision,payload,updated_at) VALUES (1,1,?,'') ON CONFLICT(id) DO UPDATE SET payload=excluded.payload",
      )
      .run(JSON.stringify({ players: list }));
  roster(players);
  const env = {
    ADMIN_KEY: 'testing7',
    DB: {
      prepare(sql) {
        const s = db.prepare(sql);
        let args = [];
        return {
          bind(...v) {
            args = v;
            return this;
          },
          first() {
            return s.get(...args);
          },
          all() {
            return { results: s.all(...args) };
          },
          run() {
            return { meta: { changes: s.run(...args).changes } };
          },
        };
      },
    },
  };
  let cookie = '';
  const call = (path, body) =>
    worker.fetch(
      new Request('https://example.com' + path + (path.includes('?') ? '&' : '?') + 'club=88', {
        ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}),
        headers: { Origin: 'https://example.com', Cookie: cookie },
      }),
      env,
    );
  return {
    db,
    roster,
    call,
    async login() {
      cookie = (await call('/api/login', { key: env.ADMIN_KEY })).headers
        .get('Set-Cookie')
        .split(';')[0];
    },
    board: async () => (await call('/api/leaderboard')).json(),
    save: (teams, id = 'c1', revision = 0, extra = {}) =>
      call('/api/leaderboard', {
        id,
        revision,
        cup: {
          title: 'Cup',
          date: '2026-11-17',
          inBaseline: false,
          teams,
          matches: [{ a: 0, b: 1, sa: 21, sb: 10 }],
        },
        ...extra,
      }),
  };
}
const renamed = players.map(p => (p.id === 'a' ? { ...p, name: 'Anna' } : p));
const ab = [
  ['Ann', 'Bob'],
  ['Cat', 'Dan'],
];

test('identity: เปลี่ยนชื่อในรายชื่อแล้ว Leaderboard และประวัติตามชื่อใหม่ สถิติไม่แยก', async t => {
  const f = fixture(t);
  await f.login();
  assert.equal((await f.save(ab)).status, 200);
  const stored = JSON.parse(f.db.prepare('SELECT payload FROM cup_history_88').get().payload);
  assert.deepEqual(stored.teamIds, [
    ['a', 'b'],
    ['c', 'd'],
  ]);
  f.roster(renamed);
  let board = await f.board();
  assert.ok(!board.standings.some(p => p.name === 'Ann'));
  assert.equal(board.standings.find(p => p.name === 'Anna').w, 1);
  assert.deepEqual(board.history[0].teams[0], ['Anna', 'Bob']);
  assert.equal(board.history[0].teamIds, undefined, 'ids stay internal');
  // A new cup under the new name adds to the same player.
  assert.equal(
    (
      await f.save(
        [
          ['Anna', 'Cat'],
          ['Bob', 'Dan'],
        ],
        'c2',
      )
    ).status,
    200,
  );
  board = await f.board();
  assert.equal(board.standings.find(p => p.name === 'Anna').played, 2);
  assert.equal(board.standings.filter(p => p.name === 'Anna').length, 1);
});

test('identity: ประวัติเก่าที่ไม่มี id ผูกด้วยชื่อครั้งเดียว แล้วเปลี่ยนชื่อภายหลังได้', async t => {
  const f = fixture(t);
  await f.login();
  // A cup saved before ids existed: names only.
  f.db.prepare('INSERT INTO cup_history_88 (id,revision,sequence,payload) VALUES (?,1,1,?)').run(
    'old',
    JSON.stringify({
      title: 'Old',
      date: '2026-11-01',
      inBaseline: false,
      teams: ab,
      matches: [{ a: 0, b: 1, sa: 21, sb: 10 }],
    }),
  );
  await f.board(); // first read freezes Ann→a
  assert.equal(
    f.db.prepare("SELECT player_id FROM cup_name_ids WHERE club='88' AND name_key='ann'").get()
      .player_id,
    'a',
  );
  f.roster(renamed);
  const board = await f.board();
  assert.equal(board.standings.find(p => p.name === 'Anna').w, 1);
  assert.ok(!board.standings.some(p => p.name === 'Ann'));
  // Editing the old record with either name keeps the same player.
  for (const name of ['Anna', 'Ann']) {
    const revision = (await f.board()).history[0].revision;
    const teams = [
      [name, 'Bob'],
      ['Cat', 'Dan'],
    ];
    assert.equal((await f.save(teams, 'old', revision)).status, 200);
    const stored = JSON.parse(f.db.prepare('SELECT payload FROM cup_history_88').get().payload);
    assert.equal(stored.teamIds[0][0], 'a');
  }
});

test('identity: ชื่อเล่นกับชื่อไทยของคนเดียวกันอยู่สองช่องไม่ได้', async t => {
  const f = fixture(t);
  await f.login();
  const res = await f.save([
    ['Ann', 'Bob'],
    ['แอน', 'Dan'],
  ]);
  assert.equal(res.status, 400);
});

test('checkNames: ชื่อที่ไม่รู้จักต้องยืนยัน พร้อมชื่อใกล้เคียงจากรายชื่อ', async t => {
  const f = fixture(t);
  await f.login();
  const warn = await f.save(
    [
      ['Anne', 'Bob'],
      ['Cat', 'Dann'],
    ],
    'c1',
    0,
    { checkNames: true },
  );
  assert.equal(warn.status, 409);
  const body = await warn.json();
  assert.equal(body.code, 'UNKNOWN_NAMES');
  assert.deepEqual(
    body.unknown.map(u => u.name),
    ['Anne', 'Dann'],
  );
  assert.ok(body.unknown[0].suggestions.includes('Ann'));
  assert.ok(body.unknown[1].suggestions.includes('Dan'));
  assert.equal((await f.board()).history.length, 0, 'refused save writes nothing');
  // Roster names pass the check; a confirmed unknown name is saved without an id.
  assert.equal((await f.save(ab, 'c1', 0, { checkNames: true })).status, 200);
  const odd = [
    ['Zed', 'Bob'],
    ['Cat', 'Dan'],
  ];
  assert.equal((await f.save(odd, 'c2', 0, { checkNames: true, acceptUnknown: true })).status, 200);
  const rows = f.db.prepare('SELECT payload FROM cup_history_88 ORDER BY sequence').all();
  assert.equal(JSON.parse(rows[1].payload).teamIds[0][0], null);
});

test('badge: จำนวนแชมป์และแชมป์ล่าสุดตาม id ผู้เล่น แม้เปลี่ยนชื่อแล้ว', () => {
  const cup = {
    title: 'Cup',
    date: '2026-11-17',
    teams: ab,
    teamIds: [
      ['a', 'b'],
      ['c', 'd'],
    ],
    matches: [{ a: 0, b: 1, sa: 21, sb: 10 }],
  };
  const source = { plays: [], jobs: [], cups: [{ sequence: 1, cup }], legacy: new Map() };
  const ident = identityFrom(renamed, '88');
  const awards = new Map([['id:a', '🥇']]);
  const badges = badgesFrom(source, '88', renamed, awards);
  assert.equal(badges.get('a').titles, 1);
  assert.equal(badges.get('a').latestChamp, true);
  assert.equal(badges.get('c').titles, 0);
  assert.equal(ident.nameOf.get('a'), 'Anna');
});

test('cleanCup เก็บ teamIds ที่ถูกรูปแบบไว้ (กู้คืนจาก backup) และทิ้งที่ผิดรูปแบบ', () => {
  const base = {
    title: 'Cup',
    date: '2026-11-17',
    inBaseline: false,
    teams: ab,
    matches: [{ a: 0, b: 1, sa: 21, sb: 10 }],
  };
  assert.deepEqual(
    cleanCup(
      {
        ...base,
        teamIds: [
          ['a', null],
          ['c', 'd'],
        ],
      },
      '88',
    ).teamIds,
    [
      ['a', null],
      ['c', 'd'],
    ],
  );
  assert.equal(cleanCup({ ...base, teamIds: [['a']] }, '88').teamIds, undefined);
});
