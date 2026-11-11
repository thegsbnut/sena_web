import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withSchemaCache, once } from './schema-cache.js';

function fakeD1({ failFirst = false } = {}) {
  const executed = [];
  let failures = failFirst ? 1 : 0;
  return {
    executed,
    prepare(sql) {
      return {
        bind() {
          return this;
        },
        async run() {
          if (/^CREATE/.test(sql) && failures-- > 0) throw Error('D1 busy');
          executed.push(sql);
          return { meta: { changes: 1 } };
        },
        async first() {
          executed.push(sql);
          return { ok: 1 };
        },
      };
    },
    async batch(list) {
      return Promise.all(list.map(s => s.run()));
    },
  };
}
const ddl = 'CREATE TABLE IF NOT EXISTS t (id INTEGER PRIMARY KEY)';

test('a schema statement runs once per binding; later requests skip the round trip', async () => {
  const raw = fakeD1();
  for (let request = 0; request < 3; request++) {
    const db = withSchemaCache(raw);
    await db.prepare(ddl).run();
    await db.prepare('SELECT 1').first();
  }
  assert.deepEqual(raw.executed, [ddl, 'SELECT 1', 'SELECT 1', 'SELECT 1']);
});

test('a failed schema statement is retried on the next request', async () => {
  const raw = fakeD1({ failFirst: true });
  await assert.rejects(withSchemaCache(raw).prepare(ddl).run(), /D1 busy/);
  await withSchemaCache(raw).prepare(ddl).run();
  await withSchemaCache(raw).prepare(ddl).run();
  assert.deepEqual(raw.executed, [ddl]);
});

test('separate databases keep separate caches and other statements pass through', async () => {
  const a = fakeD1(),
    b = fakeD1();
  await withSchemaCache(a).prepare(ddl).run();
  await withSchemaCache(b).prepare(ddl).run();
  await withSchemaCache(a).prepare('INSERT INTO t VALUES(1)').bind().run();
  await withSchemaCache(a).batch([a.prepare('DELETE FROM t')]);
  assert.deepEqual(a.executed, [ddl, 'INSERT INTO t VALUES(1)', 'DELETE FROM t']);
  assert.deepEqual(b.executed, [ddl]);
  assert.equal(withSchemaCache(undefined), undefined);
});

test('once() runs a seed a single time per binding, retries after failure, and runs always on unwrapped bindings', async () => {
  const raw = fakeD1();
  let runs = 0;
  const seed = async () => void runs++;
  for (let i = 0; i < 3; i++) await once(withSchemaCache(raw), 'seed', seed);
  assert.equal(runs, 1);
  let attempts = 0;
  const flaky = async () => {
    if (!attempts++) throw Error('boom');
    runs++;
  };
  await assert.rejects(once(withSchemaCache(raw), 'flaky', flaky), /boom/);
  await once(withSchemaCache(raw), 'flaky', flaky);
  await once(withSchemaCache(raw), 'flaky', flaky);
  assert.equal(runs, 2);
  await once(raw, 'seed', seed);
  await once(raw, 'seed', seed);
  assert.equal(runs, 4);
});
