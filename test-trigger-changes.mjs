import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from './worker.js';

// D1 reports rows written by triggers in meta.changes (the backup trigger adds
// a row whenever a roster or Cup payload really changes). node:sqlite does not,
// so this binding reports the total_changes() delta to behave like D1.
function d1Like(db) {
  return {
    prepare(sql) {
      const stmt = db.prepare(sql);
      let args = [];
      return {
        bind(...values) {
          args = values;
          return this;
        },
        async first() {
          return stmt.get(...args) ?? null;
        },
        async all() {
          return { results: stmt.all(...args) };
        },
        async run() {
          const before = db.prepare('SELECT total_changes() AS n').get().n;
          stmt.run(...args);
          return { meta: { changes: db.prepare('SELECT total_changes() AS n').get().n - before } };
        },
      };
    },
  };
}
const origin = 'https://sena.example';

test('saving changed data succeeds even though the backup trigger also writes a row', async t => {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  db.exec('CREATE TABLE login_attempts(ip TEXT PRIMARY KEY, window INTEGER, attempts INTEGER)');
  const env = { ADMIN_KEY: 'test-admin-key', DB: d1Like(db) };
  const call = (path, body, cookie = '') =>
    worker.fetch(
      new Request(origin + path, {
        method: body ? 'POST' : 'GET',
        headers: { Origin: origin, Cookie: cookie, 'Content-Type': 'application/json' },
        body: body && JSON.stringify(body),
      }),
      env,
    );
  const cookie = (await call('/api/login', { key: env.ADMIN_KEY })).headers
    .get('Set-Cookie')
    .split(';')[0];
  const state = lv => ({
    players: [{ id: 'p0', name: 'Nut', thai: '', lv, gender: 'M' }],
    selected: [],
    rounds: 10,
    locks: [],
  });
  for (const [revision, lv] of [
    [0, 5],
    [1, 6],
    [2, 7],
  ]) {
    const r = await call('/api/state', { state: state(lv), revision }, cookie);
    assert.equal(r.status, 200, 'save at revision ' + revision);
    assert.equal((await r.json()).revision, revision + 1);
  }
  // A genuinely stale revision is still refused, and nothing is written.
  assert.equal((await call('/api/state', { state: state(9), revision: 1 }, cookie)).status, 409);
  const saved = await (await call('/api/state', null, cookie)).json();
  assert.deepEqual([saved.revision, saved.state.players[0].lv], [3, 7]);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM backups').get().n, 2);
});
