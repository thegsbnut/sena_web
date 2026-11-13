import { test } from 'node:test';
import assert from 'node:assert/strict';
import './public/billing-overview.js';

const { owing, reminderText, progress, reviewRows, slipRows } = globalThis.BillingOverview;
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
  assert.deepEqual(
    { ...r.groups[0], rows: undefined },
    { name: 'นัท', totalCents: 32000, bills: 2, review: false, rows: undefined },
  );
  assert.equal(r.groups[0].rows.length, 2);
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

const full = (name, amount, status, extra = {}) => ({
  id: 'p-' + name,
  name,
  amount,
  status,
  hasSlip: false,
  ...extra,
});
const withMeta = (payers, extra = {}) => ({
  id: 'b1',
  club: 'sena',
  date: '2026-11-10',
  revision: 3,
  cancelled: false,
  count: payers.length,
  paid: 0,
  payers,
  ...extra,
});

test('owing rows carry what the organizer needs to act on one person in one bill', () => {
  const r = owing([withMeta([full('นัท', 16000, 'unpaid')])]);
  assert.deepEqual(r.groups[0].rows, [
    {
      billId: 'b1',
      club: 'sena',
      date: '2026-11-10',
      revision: 3,
      payerId: 'p-นัท',
      amount: 16000,
      status: 'unpaid',
      method: undefined,
      hasSlip: false,
      receiptId: undefined,
    },
  ]);
});

test('reviewRows lists slips and cash waiting for the organizer, oldest bill first, never paid or cancelled', () => {
  const rows = reviewRows([
    withMeta(
      [full('ต้อม', 100, 'review', { hasSlip: true, receiptId: 'r1' }), full('เจ', 100, 'paid')],
      { id: 'b2', date: '2026-11-17' },
    ),
    withMeta([full('บัว', 200, 'review', { method: 'cash' })], { id: 'b1', date: '2026-11-10' }),
    withMeta([full('ปอ', 300, 'review', { hasSlip: true })], { id: 'b3', cancelled: true }),
  ]);
  assert.deepEqual(
    rows.map(r => [r.name, r.kind]),
    [
      ['บัว', 'cash'],
      ['ต้อม', 'slip'],
    ],
  );
  assert.equal(rows[1].receiptId, 'r1');
  assert.equal(rows[1].billId, 'b2');
});

test('slipRows lists paid transfers that still have a slip, never cash, unpaid or cancelled bills', () => {
  const rows = slipRows([
    withMeta([
      full('นัท', 100, 'paid', { hasSlip: true, receiptId: 'r1', method: 'transfer' }),
      full('บัว', 100, 'paid', { method: 'cash' }),
      full('ต้อม', 100, 'unpaid'),
      full('เจ', 100, 'paid', { hasSlip: false, method: 'transfer' }),
    ]),
    withMeta([full('ปอ', 100, 'paid', { hasSlip: true, method: 'transfer' })], {
      id: 'b9',
      cancelled: true,
    }),
  ]);
  assert.deepEqual(
    rows.map(r => r.name),
    ['นัท'],
  );
  assert.equal(rows[0].receiptId, 'r1');
});

test('splitLines explains the split and who the amount covers', () => {
  const { splitLines } = globalThis.BillingOverview;
  assert.deepEqual(splitLines({ court: 60000, shuttle: 12000, people: 8 }, { shares: 1 }, money), [
    'ค่าคอร์ต 600 + ค่าลูก 120 หาร 8 คน',
  ]);
  assert.deepEqual(
    splitLines(
      { court: 60000, shuttle: 0, people: 8 },
      { shares: 2, names: ['นัท', 'แขก'] },
      money,
    ),
    ['ค่าคอร์ต 600 หาร 8 คน', 'ยอดนี้รวม 2 คน: นัท, แขก'],
  );
  assert.deepEqual(splitLines({}, {}, money), []);
});
