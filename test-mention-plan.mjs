import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planMentionMessages, mentionGroupMessage, mentionNameRisk } from './line-mentions.js';

const person = (userId, risk) => ({ userId, risk });
const shape = chunks => chunks.map(c => c.map(p => p.risk));

test('plain names group together, miscounted names go last and end their message', () => {
  // Exactly the layout seen working in the real group: Nut(0) Tatom(1) Pete(8).
  assert.deepEqual(shape(planMentionMessages([person('p', 8), person('t', 1), person('n', 0)])), [
    [0, 1, 8],
  ]);
  // Plain names never wait behind a miscounted one, whatever the input order.
  assert.deepEqual(
    shape(planMentionMessages([person('a', 8), person('b', 0), person('c', 0), person('d', 4)])),
    [[0, 0, 4], [8]],
  );
  // Every mention is preceded by a total excess of at most 1.
  for (const chunks of [
    planMentionMessages(
      Array.from({ length: 30 }, (_, i) => person('u' + i, [0, 0, 0, 1, 2, 8][i % 6])),
    ),
    planMentionMessages([person('x', 1), person('y', 1), person('z', 1), person('w', 1)]),
  ])
    for (const chunk of chunks) {
      let before = 0;
      for (const p of chunk) {
        assert(before <= 1, 'excess before a mention must stay <= 1');
        before += p.risk;
      }
    }
});

test('a message holds at most three mentions and nobody is dropped or duplicated', () => {
  const people = Array.from({ length: 25 }, (_, i) => person('u' + i, i % 5 === 4 ? 6 : 0));
  const chunks = planMentionMessages(people);
  assert(chunks.every(c => c.length <= 3));
  assert.deepEqual(
    chunks
      .flat()
      .map(p => p.userId)
      .sort(),
    people.map(p => p.userId).sort(),
  );
  assert.deepEqual(planMentionMessages([]), []);
});

test('message text pads every name with invisible characters and has closing text', () => {
  const m = mentionGroupMessage(
    [person('Uaaaa', 0), person('Ubbbb', 8)],
    'ค้างจ่าย: ',
    'ชำระเงินผ่านลิงก์ด้านบน',
  );
  assert.equal(m.type, 'textV2');
  assert.deepEqual(Object.keys(m.substitution), ['m0', 'm1']);
  assert.equal(
    m.text,
    'ค้างจ่าย: {m0}' + '​'.repeat(16) + ' {m1}' + '​'.repeat(16) + '\nชำระเงินผ่านลิงก์ด้านบน',
  );
  // Padding grows with the miscount (twice its size), capped at 64.
  const big = mentionGroupMessage([person('Ucccc', 20), person('Udddd', 99)], '', 'x');
  assert(big.text.includes('{m0}' + '​'.repeat(40) + ' '));
  assert(big.text.includes('{m1}' + '​'.repeat(64) + '\n'));
  assert.doesNotMatch(m.text, /\p{Extended_Pictographic}/u);
});

test('name risk counts emoji parts only: Thai vowel and tone marks are safe', () => {
  assert.equal(mentionNameRisk('Nut'), 0);
  assert.equal(mentionNameRisk('สมชาย'), 0);
  assert.equal(mentionNameRisk('น้ำ ณัฐ ขุนทอง ต่างจากชื่อในก๊วน'), 0); // many combining marks
  assert.equal(mentionNameRisk('♠️❄️Pete❄️♠️'), 4); // four variation selectors
  assert.equal(mentionNameRisk('TaToM55♾️'), 1);
  assert.equal(mentionNameRisk('😀Bo'), 1); // surrogate pair
  assert.equal(mentionNameRisk('👨‍👩‍👧‍👦'), 7); // 4 astral + 3 joiners
  assert.equal(mentionNameRisk(''), 0);
  assert.equal(mentionNameRisk(undefined), 0);
});
