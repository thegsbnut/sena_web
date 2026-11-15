import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  noticeDay,
  noticeClub,
  createNotice,
  claimNotice,
  releaseNotice,
  NOTICE_CODE,
} from './line-notices.js';

function d1(t) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  return {
    prepare(sql) {
      const stmt = db.prepare(sql);
      let values = [];
      return {
        bind(...args) {
          values = args;
          return this;
        },
        first: async () => stmt.get(...values),
        all: async () => ({ results: stmt.all(...values) }),
        run: async () => ({ meta: { changes: stmt.run(...values).changes } }),
      };
    },
  };
}

test('notice day and club labels', () => {
  assert.equal(noticeDay('2026-11-14'), 'ส. 14 พ.ย.');
  assert.equal(noticeClub('sena'), 'SENA');
  assert.equal(noticeClub('88'), '88');
});

test('notice code pattern only matches a trailing #code', () => {
  assert.equal(NOTICE_CODE.exec('➖ Nut ถอน SENA ส. 14 พ.ย. #w7f3a')?.[1], 'w7f3a');
  assert.equal(NOTICE_CODE.exec('#w7f3a')?.[1], 'w7f3a');
  assert.equal(NOTICE_CODE.exec('ถอน #w7f3a ครับ'), null);
  assert.equal(NOTICE_CODE.exec('ถอน#w7f3a'), null);
  assert.equal(NOTICE_CODE.exec('ถอน #W7F3A'), null);
});

test('a notice is claimed once, expires after a day and can be released', async t => {
  const db = d1(t),
    now = Date.parse('2026-11-14T10:00:00Z');
  const code = await createNotice(
    db,
    { club: 'sena', kind: 'paid', payload: { billId: 'b1' } },
    now,
  );
  assert.match(code, /^[a-z0-9]{5}$/);
  assert.deepEqual(await claimNotice(db, code, now + 1000), {
    club: 'sena',
    kind: 'paid',
    payload: { billId: 'b1' },
  });
  assert.equal(await claimNotice(db, code, now + 2000), null);
  await releaseNotice(db, code);
  assert.equal((await claimNotice(db, code, now + 3000))?.kind, 'paid');
  const old = await createNotice(db, { club: '88', kind: 'paid', payload: {} }, now);
  assert.equal(await claimNotice(db, old, now + 25 * 3600000), null);
  assert.equal(await claimNotice(db, 'zzzzz', now), null);
});

test('old notices are pruned when a new one is created', async t => {
  const db = d1(t),
    now = Date.parse('2026-11-14T10:00:00Z');
  const old = await createNotice(db, { club: 'sena', kind: 'paid', payload: {} }, now);
  await createNotice(db, { club: 'sena', kind: 'paid', payload: {} }, now + 8 * 86400000);
  const row = await db.prepare('SELECT code FROM line_notices WHERE code=?').bind(old).first();
  assert.equal(row, undefined);
});

test('notice reports from the phone are logged with whitelisted fields only', async () => {
  const { noticeReport } = await import('./line-notices.js');
  const logged = [];
  const warn = console.warn;
  console.warn = line => logged.push(JSON.parse(line));
  try {
    const post = body =>
      noticeReport(new Request('https://x.test/api/line/notice-report', { method: 'POST', body }));
    const ok = await post(
      JSON.stringify({
        stage: 'failed',
        at: 'send',
        kind: '🧾',
        page: '/court',
        error: 'FORBIDDEN U' + 'a'.repeat(32) + ' denied',
        text: 'never logged',
        name: 'Nut',
      }),
    );
    assert.equal(ok.status, 204);
    assert.equal((await post('{"stage":"hack"}')).status, 400);
    assert.equal((await post('not json')).status, 400);
    assert.equal((await post('x'.repeat(3000))).status, 413);
  } finally {
    console.warn = warn;
  }
  assert.equal(logged.length, 1);
  assert.equal(logged[0].context, 'line-notice:client');
  assert.equal(logged[0].at, 'send');
  assert.equal(logged[0].error, 'FORBIDDEN [LINE_USER_ID] denied');
  assert.doesNotMatch(JSON.stringify(logged), /never logged|Nut/);
});
