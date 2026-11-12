import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSlipDate, normalizeRef, isUsableRef } from './slip-check.js';

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
