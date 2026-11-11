import { test } from 'node:test';
import assert from 'node:assert/strict';
import './public/history-form.js';
const form = globalThis.SenaHistoryForm;
test('manual history accepts slash spacing, blank lines and Windows newlines without discarding scores', () => {
  const teams = form.parseTeams('Nut/Pete\r\n\r\nBomb / Tom\r\n');
  assert.deepEqual(teams, [
    ['Nut', 'Pete'],
    ['Bomb', 'Tom'],
  ]);
  for (const text of [
    'Nut/Pete\nBomb/Tom',
    ' Nut / Pete \r\n Bomb / Tom \r\n',
    '\nNut /Pete\n\nBomb/ Tom\n',
  ])
    assert.equal(form.sameTeams(text, teams), true);
  assert.equal(form.sameTeams('Nut / Bo\nBomb / Tom', teams), false);
  assert.equal(form.sameTeams('Bomb / Tom\nNut / Pete', teams), false);
});
test('history IDs work in browsers without randomUUID and remain API-compatible', () => {
  const id = form.newId({
    getRandomValues(bytes) {
      return bytes.fill(42);
    },
  });
  assert.match(id, /^[a-zA-Z0-9_-]{1,100}$/);
  assert.equal(id.length, 40);
  assert.equal(
    form.newId({
      randomUUID() {
        return 'provided-uuid';
      },
    }),
    'provided-uuid',
  );
});
