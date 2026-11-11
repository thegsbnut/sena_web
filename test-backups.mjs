import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from './worker.js';
import seed from './seed.json' with { type: 'json' };
async function fixture() {
  const db = new DatabaseSync(':memory:');
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
  const call = (path, body, admin = true, origin = 'https://example.com') =>
    worker.fetch(
      new Request('https://example.com' + path, {
        ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}),
        headers: { Origin: origin, ...(admin ? { Cookie: cookie } : {}) },
      }),
      env,
    );
  cookie = (await call('/api/login', { key: env.ADMIN_KEY })).headers
    .get('Set-Cookie')
    .split(';')[0];
  const json = async (path, body, admin = true) => (await call(path, body, admin)).json();
  return { db, call, json };
}
const roster = (name = 'Player') => ({
  ...structuredClone(seed),
  players: [{ id: 'p1', name, thai: '', gender: 'M', lv: 9 }],
});
test('backups require organizer and correct origin; state restore is isolated, revision checked and reversible', async () => {
  const { call, json, db } = await fixture();
  assert.equal((await call('/api/backups', null, false)).status, 401);
  assert.equal(
    (await call('/api/backups', { action: 'create', state: roster(), revision: 0 }, false)).status,
    401,
  );
  assert.equal(
    (
      await call(
        '/api/backups',
        { action: 'create', state: roster(), revision: 0 },
        true,
        'https://evil.example',
      )
    ).status,
    403,
  );
  assert.equal((await call('/api/state', { state: roster('Before'), revision: 0 })).status, 200);
  assert.equal((await call('/api/state', { state: roster('After'), revision: 1 })).status, 200);
  let list = (await json('/api/backups')).backups;
  assert.equal(list.length, 1);
  const id = list[0].seq;
  assert.equal((await json('/api/backups?id=' + id)).payload.players[0].name, 'Before');
  assert.equal((await call('/api/backups?id=' + id, null, false)).status, 401);
  assert.equal((await call('/api/backups?club=88&id=' + id)).status, 404);
  assert.equal(
    (await call('/api/backups?club=88', { action: 'restore', id, revision: 0 })).status,
    404,
  );
  assert.equal((await call('/api/backups', { action: 'restore', id, revision: 1 })).status, 409);
  assert.equal(
    (
      await call('/api/backups', {
        action: 'restore',
        id,
        revision: 2,
        currentState: roster('Unsaved'),
      })
    ).status,
    200,
  );
  assert.equal((await json('/api/state')).state.players[0].name, 'Before');
  list = (await json('/api/backups')).backups;
  assert.equal(list.length, 3);
  assert.equal((await json('/api/backups?id=' + list[0].seq)).payload.players[0].name, 'After');
  assert.equal((await json('/api/backups?id=' + list[1].seq)).payload.players[0].name, 'Unsaved');
  assert.equal(
    (await call('/api/backups', { action: 'restore', id: list[0].seq, revision: 3 })).status,
    200,
  );
  assert.equal((await json('/api/state')).state.players[0].name, 'After');
  const guest = await json('/api/state', null, false);
  assert(!JSON.stringify(guest).includes('"lv"'));
  // If snapshot insertion fails, SQLite rolls back the associated state update.
  db.exec(
    "CREATE TRIGGER fail_backup BEFORE INSERT ON backups BEGIN SELECT RAISE(ABORT,'simulated failure'); END",
  );
  assert.equal(
    (await call('/api/state', { state: roster('Must not persist'), revision: 4 })).status,
    503,
  );
  assert.equal((await json('/api/state')).state.players[0].name, 'After');
});
test('history edit backups restore the same record and recompute totals without duplicates', async () => {
  const { call, json } = await fixture();
  const cup = {
    title: 'Example',
    date: '2026-11-03',
    inBaseline: false,
    teams: [
      ['A', 'B'],
      ['C', 'D'],
    ],
    matches: [{ a: 0, b: 1, sa: 21, sb: 10 }],
  };
  assert.equal(
    (await call('/api/leaderboard?club=88', { id: 'cup', revision: 0, cup })).status,
    200,
  );
  const edited = { ...cup, matches: [{ a: 0, b: 1, sa: 10, sb: 21 }] };
  assert.equal(
    (await call('/api/leaderboard?club=88', { id: 'cup', revision: 1, cup: edited })).status,
    200,
  );
  const b = (await json('/api/backups?club=88')).backups[0];
  assert.equal(b.kind, 'history');
  assert.equal(
    (await call('/api/backups?club=88', { action: 'restore', id: b.seq, revision: 1 })).status,
    409,
  );
  assert.equal(
    (await call('/api/backups?club=88', { action: 'restore', id: b.seq, revision: 2 })).status,
    200,
  );
  const board = await json('/api/leaderboard?club=88');
  assert.equal(board.history.length, 1);
  assert.equal(board.history[0].revision, 3);
  assert.equal(board.standings.find(p => p.name === 'A').w, 1);
  assert.equal(board.standings.find(p => p.name === 'A').played, 1);
  assert.equal((await json('/api/backups')).backups.length, 0);
});
test('retention keeps 30 per club and oldest selected snapshot can be restored even when checkpoint prunes it', async () => {
  const { call, json } = await fixture();
  await call('/api/state', { state: roster('Current'), revision: 0 });
  for (let i = 0; i < 32; i++)
    assert.equal(
      (await call('/api/backups', { action: 'create', state: roster('Backup ' + i), revision: 1 }))
        .status,
      200,
    );
  await call('/api/backups?club=88', { action: 'create', state: roster('88'), revision: 0 });
  let list = (await json('/api/backups')).backups;
  assert.equal(list.length, 30);
  const oldest = list.at(-1);
  assert.equal((await json('/api/backups?id=' + oldest.seq)).payload.players[0].name, 'Backup 2');
  assert.equal(
    (
      await call('/api/backups', {
        action: 'restore',
        id: oldest.seq,
        revision: 1,
        currentState: roster('Unsaved'),
      })
    ).status,
    200,
  );
  assert.equal((await json('/api/state')).state.players[0].name, 'Backup 2');
  assert.equal((await json('/api/backups')).backups.length, 30);
  assert.equal((await json('/api/backups?club=88')).backups.length, 1);
});
