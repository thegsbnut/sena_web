import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseSlipDate,
  normalizeRef,
  isUsableRef,
  validateReading,
  judgeSlip,
} from './slip-check.js';

const now = new Date('2026-11-12T05:00:00Z');

test('parseSlipDate reads every format seen on real slips', () => {
  for (const [text, want] of [
    ['10 Nov 2026 12:29:04', '2026-11-10'],
    ['25 Mar 25, 13:13', '2025-03-25'],
    ['12 พ.ย. 69 11:30 น.', '2026-11-12'],
    ['10 พ.ย. 69, 12:13 น.', '2026-11-10'],
    ['01 ม.ค. 2567 12:00:00', '2024-01-01'],
    ['12 พฤศจิกายน 2569', '2026-11-12'],
    ['12/11/2569', '2026-11-12'],
    ['12/11/2026', '2026-11-12'],
  ])
    assert.equal(parseSlipDate(text, now), want, text);
});

test('parseSlipDate rejects junk and implausible years', () => {
  for (const text of ['', 'สวัสดี', '31 Feb 2026', '02 พ.ย. 2565'])
    assert.equal(parseSlipDate(text, now), null, text);
});

test('normalizeRef treats I/l/1 and O/0 alike', () => {
  assert.equal(
    normalizeRef('202211022XMj8r6IlId6H8WNs'),
    normalizeRef('202211022XMJ8r6I11d6H8WNs'),
  );
  assert.equal(normalizeRef(' KSA 0000-0001078339102 '), 'ksa00000001078339102');
});

test('isUsableRef rejects short and repeated refs', () => {
  for (const ref of ['987654', '0'.repeat(32), '1111111111']) assert.equal(isUsableRef(ref), false);
  assert.equal(isUsableRef('ksa00000001078339102'), true);
});

test('validateReading normalizes a good reading', () => {
  assert.deepEqual(
    validateReading({ is_transfer_slip: true, amount: 200, date_text: '12 พ.ย. 69', ref: 'A' }),
    { isSlip: true, amountSatang: 20000, dateText: '12 พ.ย. 69', ref: 'A' },
  );
  assert.equal(
    validateReading({ is_transfer_slip: true, amount: '1,000.00' }).amountSatang,
    100000,
  );
});

test('validateReading refuses implausible amounts and shapes', () => {
  for (const amount of [0, -5, 'abc', 2e9, null])
    assert.equal(
      validateReading({ is_transfer_slip: true, amount }).amountSatang,
      null,
      String(amount),
    );
  assert.equal(validateReading({ is_transfer_slip: false, amount: 5 }).isSlip, false);
  for (const raw of [undefined, 'text', [1, 2]])
    assert.deepEqual(validateReading(raw), {
      isSlip: false,
      amountSatang: null,
      dateText: null,
      ref: null,
    });
  assert.equal(
    validateReading({ is_transfer_slip: true, amount: 1, date_text: 'x'.repeat(100) }).dateText,
    null,
  );
});

test('judgeSlip picks the right labels', () => {
  const base = { isSlip: true, amountSatang: 20000, dateText: '12 พ.ย. 69', ref: null };
  const ctx = { amountSatang: 20000, billDate: '2026-11-12', duplicate: null, now };
  const codes = (reading, extra = {}) => judgeSlip(reading, { ...ctx, ...extra }).map(r => r.code);
  assert.deepEqual(judgeSlip(base, ctx), [{ code: 'ok' }]);
  assert.deepEqual(judgeSlip({ ...base, amountSatang: 12000 }, ctx), [
    { code: 'amount_mismatch', slipSatang: 12000, billSatang: 20000 },
  ]);
  assert.deepEqual(codes({ ...base, amountSatang: 20001 }), ['amount_mismatch']);
  assert.deepEqual(judgeSlip({ ...base, dateText: '03 พ.ย. 69' }, ctx), [
    { code: 'old_date', slipDate: '2026-11-03', billDate: '2026-11-12' },
  ]);
  assert.deepEqual(codes({ ...base, dateText: '13 พ.ย. 69' }), ['ok']);
  assert.deepEqual(codes({ ...base, dateText: null }), ['date_unreadable']);
  const duplicate = { billDate: '2026-11-05', payerName: 'สมหญิง' };
  assert.deepEqual(judgeSlip(base, { ...ctx, duplicate }), [
    { code: 'duplicate_ref', billDate: '2026-11-05', payerName: 'สมหญิง' },
  ]);
  assert.deepEqual(codes({ ...base, amountSatang: 100, dateText: '03 พ.ย. 69' }, { duplicate }), [
    'amount_mismatch',
    'old_date',
    'duplicate_ref',
  ]);
  assert.deepEqual(codes({ ...base, isSlip: false }, { duplicate }), ['unreadable']);
  assert.deepEqual(judgeSlip({ ...base, isSlip: false }, ctx), [
    { code: 'unreadable', why: 'not_slip' },
  ]);
  assert.deepEqual(judgeSlip({ ...base, amountSatang: null }, ctx), [
    { code: 'unreadable', why: 'amount' },
  ]);
});
