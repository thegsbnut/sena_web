import { test } from 'node:test';
import assert from 'node:assert/strict';
import './public/billing-overview.js';

const { owing, reminderText, progress } = globalThis.BillingOverview;
const row = (name, amount, status = 'unpaid') => ({ name, amount, status, hasSlip: false });
const bill = (payers, extra = {}) => ({
  cancelled: false,
  count: payers.length,
  paid: 0,
  payers,
  ...extra,
});
const money = cents => String(cents / 100);

test('owing merges the same name across two bills', () => {
  const r = owing([bill([row('นัท', 16000)]), bill([row('นัท', 16000), row('บัว', 8000)])]);
  assert.deepEqual(r.groups[0], { name: 'นัท', totalCents: 32000, bills: 2, review: false });
  assert.equal(r.totalCents, 40000);
  assert.equal(r.people, 2);
});

test('owing ignores paid rows and cancelled bills', () => {
  const r = owing([
    bill([row('นัท', 16000, 'paid'), row('บัว', 8000)]),
    bill([row('เจ', 99900)], { cancelled: true }),
  ]);
  assert.deepEqual(
    r.groups.map(g => g.name),
    ['บัว'],
  );
  assert.equal(r.totalCents, 8000);
});

test('owing flags review only for people with a row waiting for the organizer, and still counts the amount', () => {
  const r = owing([bill([row('ต้อม', 16000, 'review'), row('เจ', 16000)])]);
  const byName = Object.fromEntries(r.groups.map(g => [g.name, g]));
  assert.equal(byName['ต้อม'].review, true);
  assert.equal(byName['เจ'].review, false);
  assert.equal(r.reviewCount, 1);
  assert.equal(r.totalCents, 32000);
});

test('owing sorts by amount descending, then name', () => {
  const r = owing([bill([row('ข', 100), row('ก', 100), row('ค', 500)])]);
  assert.deepEqual(
    r.groups.map(g => g.name),
    ['ค', 'ก', 'ข'],
  );
});

test('reminderText names the club and every person, and is empty when nobody owes', () => {
  const text = reminderText(
    [{ name: 'นัท', totalCents: 32000, bills: 2, review: false }],
    'Sena',
    money,
  );
  assert.match(text, /Sena/);
  assert.match(text, /นัท/);
  assert.match(text, /320/);
  assert.equal(reminderText([], 'Sena', money), '');
});

test('progress is 0 when a bill has no payers', () => {
  assert.equal(progress({ count: 0, paid: 0 }), 0);
  assert.equal(progress({ count: 4, paid: 3 }), 0.75);
});
