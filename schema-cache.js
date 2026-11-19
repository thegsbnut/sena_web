// The modules create their tables (and backup triggers) lazily with `CREATE ... IF NOT EXISTS` on every
// request. Each one is a full D1 round trip, which made pages noticeably slow.
// This wrapper remembers which of those statements already succeeded against a
// binding inside this Worker isolate and skips repeats. Every other statement is
// passed through untouched. A new isolate (after a deploy or eviction) checks
// once again, so a table that is genuinely missing is still created.
// Given the full schema list (schema.js), the first schema statement in an isolate
// runs the whole list as one batch, so a fresh isolate pays one round trip instead
// of one per table. If that batch fails, statements fall back to running one by one.
import { logError } from './log.js';
const SCHEMA = /^\s*CREATE\s+(?:UNIQUE\s+)?(?:TABLE|INDEX|TRIGGER)\s+IF\s+NOT\s+EXISTS\b/i;
const ensured = new WeakMap();
const bulks = new WeakMap();
const ONCE = Symbol('schema-once');

// Run `fn` (seed rows and the like) once per binding per isolate. Falls back to
// running it every time when the database is not wrapped (tests, plain bindings).
export const once = (db, key, fn) => (typeof db?.[ONCE] === 'function' ? db[ONCE](key, fn) : fn());

export function withSchemaCache(db, schema = []) {
  if (!db || typeof db.prepare !== 'function') return db;
  let done = ensured.get(db);
  if (!done) ensured.set(db, (done = new Set()));
  let started = bulks.get(db);
  if (!started) bulks.set(db, (started = new Map()));
  // One attempt per list per isolate, shared by concurrent requests.
  const bulk = () => {
    if (!schema.length || typeof db.batch !== 'function') return null;
    if (!started.has(schema))
      started.set(
        schema,
        (async () => {
          const todo = schema.filter(sql => !done.has(sql));
          if (todo.length) await db.batch(todo.map(sql => db.prepare(sql)));
          for (const sql of schema) done.add(sql);
        })().catch(error => logError('schema:batch', error)),
      );
    return started.get(schema);
  };
  return new Proxy(db, {
    get(target, prop) {
      if (prop === ONCE)
        return async (key, fn) => {
          if (done.has(key)) return;
          await fn();
          done.add(key);
        };
      if (prop !== 'prepare') {
        const value = Reflect.get(target, prop, target);
        return typeof value === 'function' ? value.bind(target) : value;
      }
      return sql => {
        if (!SCHEMA.test(sql)) return target.prepare(sql);
        if (done.has(sql)) return skipped;
        return {
          bind() {
            throw Error('Schema statements take no parameters');
          },
          async run() {
            await bulk();
            if (done.has(sql)) return skipped.run();
            const result = await target.prepare(sql).run();
            done.add(sql);
            return result;
          },
        };
      };
    },
  });
}

const skipped = {
  bind() {
    return skipped;
  },
  async run() {
    return { success: true, meta: { changes: 0 } };
  },
};
