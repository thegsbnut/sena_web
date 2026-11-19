import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { DB_SCHEMA, SLIPS_SCHEMA } from './schema.js';
import { withSchemaCache } from './schema-cache.js';

// A D1-like binding over real SQLite that records every statement it runs.
function sqliteD1({ failBatch = false } = {}) {
  const db = new DatabaseSync(':memory:');
  const ran = [],
    batches = [];
  const binding = {
    ran,
    batches,
    db,
    prepare(sql) {
      return {
        sql,
        bind() {
          return this;
        },
        async run() {
          ran.push(sql);
          db.exec(sql);
          return { meta: { changes: 0 } };
        },
      };
    },
    async batch(statements) {
      batches.push(statements.map(s => s.sql));
      if (failBatch) throw Error('D1 batch failed');
      db.exec('BEGIN');
      try {
        for (const s of statements) db.exec(s.sql);
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
      return statements.map(() => ({ success: true }));
    },
  };
  return binding;
}
const tables = db =>
  db
    .prepare("SELECT type,name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name")
    .all()
    .map(r => r.type + ':' + r.name);

test('the full schema is valid SQLite, in a working order, and safe to run twice', () => {
  for (const schema of [DB_SCHEMA, SLIPS_SCHEMA]) {
    const db = new DatabaseSync(':memory:');
    for (let i = 0; i < 2; i++) for (const sql of schema) db.exec(sql);
    assert.equal(new Set(schema).size, schema.length, 'no duplicate statements');
  }
  const db = new DatabaseSync(':memory:');
  for (const sql of DB_SCHEMA) db.exec(sql);
  const names = tables(db);
  for (const expected of [
    'table:club_state',
    'table:club_state_88',
    'table:cup_history_88',
    'table:bills',
    'table:member_sessions',
    'trigger:backup_club_state_88',
    'trigger:backup_cup_history',
    'index:member_player_unique',
  ])
    assert.ok(names.includes(expected), expected);
});

test('no module writes its own CREATE statement: new tables go in schema.js', () => {
  const offenders = readdirSync('.')
    .filter(f => f.endsWith('.js') && f !== 'schema.js')
    .filter(f =>
      /CREATE\s+(?:UNIQUE\s+)?(?:TABLE|INDEX|TRIGGER)/i.test(
        readFileSync(f, 'utf8').replace(/\/\/.*$/gm, ''),
      ),
    );
  assert.deepEqual(offenders, []);
});

test('a fresh isolate creates every table in one batch; later schema statements skip D1', async () => {
  const raw = sqliteD1();
  const db = withSchemaCache(raw, DB_SCHEMA);
  // Two requests arrive together on a cold isolate.
  await Promise.all([
    db.prepare(DB_SCHEMA.find(s => s.includes('member_sessions'))).run(),
    withSchemaCache(raw, DB_SCHEMA)
      .prepare(DB_SCHEMA.find(s => s.includes(' bills ')))
      .run(),
  ]);
  assert.equal(raw.batches.length, 1);
  assert.deepEqual(raw.batches[0], DB_SCHEMA);
  assert.deepEqual(raw.ran, []);
  for (const sql of DB_SCHEMA) await withSchemaCache(raw, DB_SCHEMA).prepare(sql).run();
  assert.equal(raw.batches.length, 1);
  assert.deepEqual(raw.ran, []);
  // A statement missing from the list still runs on its own (and only once).
  const extra = 'CREATE TABLE IF NOT EXISTS not_listed (id INTEGER PRIMARY KEY)';
  await withSchemaCache(raw, DB_SCHEMA).prepare(extra).run();
  await withSchemaCache(raw, DB_SCHEMA).prepare(extra).run();
  assert.deepEqual(raw.ran, [extra]);
  assert.ok(tables(raw.db).includes('table:not_listed'));
});

test('if the batch fails, tables are still created one by one and the error is logged', async t => {
  const logged = [];
  t.mock.method(console, 'error', line => logged.push(line));
  const raw = sqliteD1({ failBatch: true });
  const sql = DB_SCHEMA.find(s => s.includes('member_sessions'));
  await withSchemaCache(raw, DB_SCHEMA).prepare(sql).run();
  await withSchemaCache(raw, DB_SCHEMA).prepare(sql).run();
  assert.equal(raw.batches.length, 1, 'the batch is not retried in the same isolate');
  assert.deepEqual(raw.ran, [sql]);
  assert.ok(tables(raw.db).includes('table:member_sessions'));
  assert.match(logged.join('\n'), /schema:batch/);
});

test('the slip database gets only its own list', async () => {
  const raw = sqliteD1();
  await withSchemaCache(raw, SLIPS_SCHEMA).prepare(SLIPS_SCHEMA[0]).run();
  assert.deepEqual(raw.batches, [SLIPS_SCHEMA]);
  assert.deepEqual(tables(raw.db).sort(), ['index:bill_slips_bill_id', 'table:bill_slips']);
});
