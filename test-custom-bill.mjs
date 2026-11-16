import { test } from 'node:test';
import assert from 'node:assert/strict';
import './public/custom-split.js';

const { split } = globalThis.SenaCustomSplit ?? {};
const A = { name: 'Nut', payerKey: 'member:1' },
  B = { name: 'Bua', payerKey: 'member:2' },
  C = { name: 'Pim', payerKey: 'member:3' },
  G = { name: 'บอส', payerKey: 'member:2', guest: true };

test('even: 1000 บาท 3 คน → share รวมเท่ายอด, แถวปัดขึ้นบาท', () => {
  const r = split({ mode: 'even', people: [A, B, C], total: 100000, receiver: 'member:1' });
  assert.equal(r.total, 100000);
  assert.deepEqual(
    r.payers.map(p => p.shares[0].amount),
    [33334, 33333, 33333],
  );
  assert.deepEqual(
    r.payers.map(p => p.amount),
    [33400, 33400, 33400],
  );
  assert.deepEqual(
    r.payers.map(p => p.owner),
    [true, false, false],
  );
});

test('guest รวมยอดเข้าแถวสมาชิกเจ้าของ', () => {
  const r = split({ mode: 'even', people: [A, B, G], total: 90000, receiver: 'member:1' });
  assert.equal(r.payers.length, 2);
  const bua = r.payers.find(p => p.payerKey === 'member:2');
  assert.equal(bua.name, 'Bua');
  assert.deepEqual(bua.shares, [
    { name: 'Bua', amount: 30000 },
    { name: 'บอส', amount: 30000 },
  ]);
  assert.equal(bua.amount, 60000);
});

test('manual: ยอดเองมีเศษสตางค์ → ปัดขึ้นต่อแถว, ยอด 0 ไม่มีแถว (ยกเว้นคนรับเงิน)', () => {
  const r = split({
    mode: 'manual',
    people: [A, B, C],
    amounts: [0, 12050, 0],
    receiver: 'member:1',
  });
  assert.equal(r.total, 12050);
  assert.deepEqual(
    r.payers.map(p => [p.payerKey, p.amount]),
    [
      ['member:1', 0],
      ['member:2', 12100],
    ],
  );
});

test('items: แต่ละรายการแบ่งเฉพาะคนในรายการ', () => {
  const r = split({
    mode: 'items',
    people: [A, B, C],
    receiver: 'member:1',
    items: [
      { name: 'หมูกระทะ', price: 90000, people: [0, 1, 2] },
      { name: 'เบียร์', price: 30001, people: [0, 1] },
    ],
  });
  assert.equal(r.total, 120001);
  assert.deepEqual(
    r.payers.map(p => p.shares[0].amount),
    [45001, 45000, 30000],
  );
});

test('ข้อผิดพลาด: คนไม่อยู่ในรายการไหน, ไม่มีคนจ่ายนอกจากคนรับเงิน, คนรับเงินเป็น guest', () => {
  assert.match(
    split({
      mode: 'items',
      people: [A, B, C],
      receiver: 'member:1',
      items: [{ name: 'x', price: 100, people: [0, 1] }],
    }).error,
    /Pim/,
  );
  assert.ok(
    split({ mode: 'manual', people: [A, B], amounts: [500, 0], receiver: 'member:1' }).error,
  );
  assert.ok(split({ mode: 'even', people: [A, B], total: 100, receiver: 'member:9' }).error);
});

test('ขอบเขต: จำนวนคน/ยอดรวม/รายการ ผิดช่วงต้องมี error', () => {
  const many = Array.from({ length: 41 }, (_, i) => ({ name: 'p' + i, payerKey: 'member:' + i }));
  assert.ok(split({ mode: 'even', people: many, total: 100000, receiver: 'member:0' }).error);
  assert.ok(split({ mode: 'even', people: [A, B], total: 99, receiver: 'member:1' }).error);
  assert.ok(split({ mode: 'even', people: [A, B], total: 10000001, receiver: 'member:1' }).error);
  assert.ok(split({ mode: 'items', people: [A, B], items: [], receiver: 'member:1' }).error);
  assert.ok(split({ mode: 'even', people: [A], total: 100000, receiver: 'member:1' }).error);
});
