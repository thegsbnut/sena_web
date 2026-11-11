import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from './worker.js';
import { logError } from './log.js';

const captureLogs = t => {
  const logs = [];
  t.mock.method(console, 'error', (...args) => logs.push(args.join(' ')));
  return logs;
};
const brokenDB = {
  prepare() {
    throw Error('D1_ERROR: no such table: club_state');
  },
};

test('malformed JSON is a 400 client error and is not logged as a server fault', async t => {
  const logs = captureLogs(t);
  const r = await worker.fetch(
    new Request('https://example.com/api/login', {
      method: 'POST',
      headers: { Origin: 'https://example.com' },
      body: '{not json',
    }),
    { ADMIN_KEY: 'abcdef7', DB: brokenDB },
  );
  assert.equal(r.status, 400);
  assert.equal(logs.length, 0);
});

test('unexpected failures still answer 503 but are logged with route context and no secrets', async t => {
  const logs = captureLogs(t);
  const r = await worker.fetch(new Request('https://example.com/api/state?club=88'), {
    ADMIN_KEY: 'super-secret-admin-key',
    DB: brokenDB,
  });
  assert.equal(r.status, 503);
  assert.equal(logs.length, 1);
  const entry = JSON.parse(logs[0]);
  assert.equal(entry.level, 'error');
  assert.equal(entry.context, 'request');
  assert.equal(entry.method, 'GET');
  assert.equal(entry.path, '/api/state');
  assert.match(entry.message, /no such table/);
  assert.doesNotMatch(logs[0], /super-secret-admin-key/);
});

test('log entries redact LINE user IDs', t => {
  const logs = captureLogs(t);
  logError('test', Error('profile failed for U' + 'a'.repeat(32)));
  assert.doesNotMatch(logs[0], /U[a]{32}/);
  assert.match(JSON.parse(logs[0]).message, /\[LINE_USER_ID\]/);
});

test('a failing nightly job is logged instead of disappearing', async t => {
  const logs = captureLogs(t);
  const pending = [];
  await worker.scheduled(
    { cron: '0 18 * * *' },
    { DB: brokenDB, SLIPS_DB: brokenDB },
    {
      waitUntil: p => pending.push(p),
    },
  );
  await Promise.all(pending);
  const contexts = logs.map(l => JSON.parse(l).context);
  assert(contexts.includes('cron:bookings') || contexts.includes('cron:prune-slips'));
});
