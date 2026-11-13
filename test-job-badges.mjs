import { test } from 'node:test';
import assert from 'node:assert/strict';
import './public/job-rules.js';

const R = globalThis.SenaJobRules;

test('job levels and stars follow the spec boundaries', () => {
  const at = n => R.jobLevel(n);
  assert.deepEqual(
    [0, 4, 5, 14, 15, 29, 30, 59, 60, 89, 90, 180, 999].map(n => [at(n).lvl, at(n).stars]),
    [
      [0, 0],
      [0, 0],
      [1, 0],
      [1, 0],
      [2, 0],
      [2, 0],
      [3, 0],
      [3, 0],
      [3, 1],
      [3, 1],
      [3, 2],
      [3, 5],
      [3, 5],
    ],
  );
});

test('default line is stable per player and spreads across all five lines', () => {
  assert.deepEqual(R.LINES, ['red', 'green', 'yellow', 'pink', 'blue']);
  assert.equal(R.defaultLine('p1'), R.defaultLine('p1'));
  const seen = new Set(Array.from({ length: 50 }, (_, i) => R.defaultLine('player-' + i)));
  assert.equal(seen.size, 5);
});
