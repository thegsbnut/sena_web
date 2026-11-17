import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from './worker.js';

function fixture(t) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  db.exec(
    'CREATE TABLE club_state(id INTEGER PRIMARY KEY,revision INTEGER,payload TEXT,updated_at TEXT); CREATE TABLE login_attempts(ip TEXT PRIMARY KEY,window INTEGER,attempts INTEGER)',
  );
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
  const call = async (path, body, admin = true) =>
    worker.fetch(
      new Request('https://example.com' + path, {
        ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}),
        headers: { Origin: 'https://example.com', ...(admin ? { Cookie: cookie } : {}) },
      }),
      env,
    );
  return {
    async login() {
      cookie = (await call('/api/login', { key: env.ADMIN_KEY }, false)).headers
        .get('Set-Cookie')
        .split(';')[0];
    },
    call,
  };
}
const cupOf = (teams, id = 'c1') => ({
  id,
  revision: 0,
  cup: {
    title: 'Cup',
    date: '2026-11-17',
    inBaseline: false,
    teams,
    matches: [{ a: 0, b: 1, sa: 21, sb: 10 }],
  },
});
const q = '?club=88';

test('alias: เพิ่มแล้วชื่อสะกดต่างรวมเป็นคนเดียว ลบแล้วแยกกัน', async t => {
  const f = fixture(t);
  await f.login();
  assert.equal(
    (
      await f.call(
        '/api/leaderboard' + q,
        cupOf([
          ['Ann', 'Bob'],
          ['Cat', 'Dan'],
        ]),
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await f.call(
        '/api/leaderboard' + q,
        cupOf(
          [
            ['Annie', 'Eve'],
            ['Cat', 'Dan'],
          ],
          'c2',
        ),
      )
    ).status,
    200,
  );
  let board = await (await f.call('/api/leaderboard' + q)).json();
  assert.ok(
    board.standings.some(p => p.name === 'Annie') && board.standings.some(p => p.name === 'Ann'),
  );
  const add = await f.call('/api/leaderboard' + q, {
    action: 'alias',
    alias: 'Annie',
    canonical: 'Ann',
  });
  assert.equal(add.status, 200);
  board = await (await f.call('/api/leaderboard' + q)).json();
  assert.ok(!board.standings.some(p => p.name === 'Annie'));
  assert.equal(board.standings.find(p => p.name === 'Ann').played, 2);
  assert.ok(board.aliases.some(a => a.alias === 'annie' && a.canonical === 'Ann' && !a.builtin));
  // A name saved later through the alias is stored under the main name.
  await f.call(
    '/api/leaderboard' + q,
    cupOf(
      [
        ['ANNIE', 'Fay'],
        ['Cat', 'Dan'],
      ],
      'c3',
    ),
  );
  board = await (await f.call('/api/leaderboard' + q)).json();
  assert.deepEqual(board.history.find(c => c.id === 'c3').teams[0], ['Ann', 'Fay']);
  await f.call('/api/leaderboard' + q, { action: 'unalias', alias: 'annie' });
  board = await (await f.call('/api/leaderboard' + q)).json();
  assert.ok(board.standings.some(p => p.name === 'Annie'));
});

test('alias: ปฏิเสธชื่อซ้ำตัวเอง ชื่อหลักของคนอื่น ค่าตั้งต้น และคนที่ไม่ใช่ผู้จัด', async t => {
  const f = fixture(t);
  await f.login();
  const post = body => f.call('/api/leaderboard', body);
  assert.equal((await post({ action: 'alias', alias: 'Beau', canonical: 'beau' })).status, 400);
  // "Nott" is the main name of the built-in "not" alias, so it cannot become an alias itself.
  assert.equal((await post({ action: 'alias', alias: 'Nott', canonical: 'Tom' })).status, 400);
  assert.equal((await post({ action: 'unalias', alias: 'not' })).status, 400);
  assert.equal((await post({ action: 'alias', alias: '', canonical: 'Tom' })).status, 400);
  // Pointing at an alias lands on its main name.
  assert.equal((await post({ action: 'alias', alias: 'Noot', canonical: 'Not' })).status, 200);
  const board = await (await f.call('/api/leaderboard')).json();
  assert.equal(board.aliases.find(a => a.alias === 'noot').canonical, 'Nott');
  const anonymous = await f.call(
    '/api/leaderboard',
    { action: 'alias', alias: 'X', canonical: 'Y' },
    false,
  );
  assert.equal(anonymous.status, 401);
  assert.equal((await (await f.call('/api/leaderboard', null, false)).json()).aliases, undefined);
});

test('checkNames: ชื่อที่ไม่รู้จักต้องยืนยัน พร้อมชื่อใกล้เคียง; ยืนยันแล้วบันทึกได้', async t => {
  const f = fixture(t);
  await f.login();
  const first = {
    ...cupOf([
      ['Beau', 'Tom'],
      ['Cat', 'Dan'],
    ]),
    checkNames: true,
    acceptUnknown: true,
  };
  assert.equal((await f.call('/api/leaderboard' + q, first)).status, 200);
  const next = {
    ...cupOf(
      [
        ['Bo', 'Tom'],
        ['Cat', 'Dann'],
      ],
      'c2',
    ),
    checkNames: true,
  };
  const warn = await f.call('/api/leaderboard' + q, next);
  assert.equal(warn.status, 409);
  const body = await warn.json();
  assert.equal(body.code, 'UNKNOWN_NAMES');
  assert.deepEqual(
    body.unknown.map(u => u.name),
    ['Bo', 'Dann'],
  );
  assert.ok(body.unknown[0].suggestions.includes('Beau'));
  assert.ok(body.unknown[1].suggestions.includes('Dan'));
  // Nothing was written by the refused request.
  assert.equal((await (await f.call('/api/leaderboard' + q)).json()).history.length, 1);
  assert.equal(
    (await f.call('/api/leaderboard' + q, { ...next, acceptUnknown: true })).status,
    200,
  );
  // Known names (earlier cups) pass; without checkNames nothing is checked.
  const known = {
    ...cupOf(
      [
        ['Cat', 'Tom'],
        ['Dan', 'Beau'],
      ],
      'c3',
    ),
    checkNames: true,
  };
  assert.equal((await f.call('/api/leaderboard' + q, known)).status, 200);
  assert.equal(
    (
      await f.call(
        '/api/leaderboard' + q,
        cupOf(
          [
            ['Zed', 'Yan'],
            ['Xi', 'Wu'],
          ],
          'c4',
        ),
      )
    ).status,
    200,
  );
});
