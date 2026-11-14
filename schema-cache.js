// The modules create their tables (and backup triggers) lazily with `CREATE ... IF NOT EXISTS` on every
// request. Each one is a full D1 round trip, which made pages noticeably slow.
// This wrapper remembers which of those statements already succeeded against a
// binding inside this Worker isolate and skips repeats. Every other statement is
// passed through untouched. A new isolate (after a deploy or eviction) checks
// once again, so a table that is genuinely missing is still created.
const SCHEMA = /^\s*CREATE\s+(?:UNIQUE\s+)?(?:TABLE|INDEX|TRIGGER)\s+IF\s+NOT\s+EXISTS\b/i;
const ensured = new WeakMap();
const ONCE = Symbol('schema-once');

// Run `fn` (seed rows and the like) once per binding per isolate. Falls back to
// running it every time when the database is not wrapped (tests, plain bindings).
export const once = (db, key, fn) => (typeof db?.[ONCE] === 'function' ? db[ONCE](key, fn) : fn());

export function withSchemaCache(db) {
  if (!db || typeof db.prepare !== 'function') return db;
  let done = ensured.get(db);
  if (!done) ensured.set(db, (done = new Set()));
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
