import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activeSponsors, awardLabel, cleanSponsorInput, showUntil } from './sponsors.js';

test('activeSponsors shows one cup at a time until cup day + 7', () => {
  const r = (id, cup_date, hidden = 0) => ({ id, cup_date, hidden });
  const rows = [
    r('a', '2026-12-12'),
    r('b', '2026-12-12'),
    r('t', '2027-01-09'),
    r('h', '2026-12-05', 1),
  ];
  const ids = today => activeSponsors(rows, today).map(x => x.id);
  assert.deepEqual(ids('2026-12-01'), ['a', 'b']);
  assert.deepEqual(ids('2026-12-19'), ['a', 'b']);
  assert.deepEqual(ids('2026-12-20'), ['t']);
  assert.deepEqual(ids('2027-01-16'), ['t']);
  assert.deepEqual(ids('2027-01-17'), []);
  assert.deepEqual(activeSponsors([], '2026-12-01'), []);
});

test('showUntil adds seven days across month and year ends', () => {
  assert.equal(showUntil('2026-12-28'), '2027-01-04');
  assert.equal(showUntil('2027-02-25'), '2027-03-04');
});

test('cleanSponsorInput trims, normalizes and enforces limits', () => {
  assert.deepEqual(
    cleanSponsorInput({ prize: '  ลูกแบด   1 หลอด ', award: 'champ' }, { admin: false }),
    { prize: 'ลูกแบด 1 หลอด', award: 'champ', awardNote: null, message: null, displayName: null },
  );
  assert.throws(
    () => cleanSponsorInput({ prize: '', award: 'champ' }, { admin: false }),
    /ของรางวัล/,
  );
  assert.throws(
    () => cleanSponsorInput({ prize: 'x'.repeat(61), award: 'all' }, { admin: false }),
    /60/,
  );
  assert.equal(
    cleanSponsorInput({ prize: 'x'.repeat(60), award: 'all' }, { admin: false }).prize.length,
    60,
  );
  assert.throws(
    () => cleanSponsorInput({ prize: 'x', award: 'other' }, { admin: false }),
    /มอบให้/,
  );
  assert.equal(
    cleanSponsorInput({ prize: 'x', award: 'other', awardNote: ' คนตบแรงสุด ' }, { admin: false })
      .awardNote,
    'คนตบแรงสุด',
  );
  assert.equal(
    cleanSponsorInput({ prize: 'x', award: 'all', awardNote: 'zzz' }, { admin: false }).awardNote,
    null,
  );
  assert.throws(() => cleanSponsorInput({ prize: 'x', award: 'king' }, { admin: false }));
  assert.throws(
    () =>
      cleanSponsorInput({ prize: 'x', award: 'all', message: 'y'.repeat(61) }, { admin: false }),
    /60/,
  );
  assert.equal(
    cleanSponsorInput({ prize: 'x', award: 'all', displayName: 'ร้าน A' }, { admin: false })
      .displayName,
    null,
  );
  assert.equal(
    cleanSponsorInput({ prize: 'x', award: 'all', displayName: 'ร้าน A' }, { admin: true })
      .displayName,
    'ร้าน A',
  );
  assert.equal(
    cleanSponsorInput(
      { prize: 'x', award: 'all', playerId: 'p1', displayName: 'ร้าน A' },
      { admin: true },
    ).displayName,
    null,
  );
  assert.equal(cleanSponsorInput({ prize: 'é', award: 'all' }, { admin: false }).prize, 'é');
});

test('awardLabel', () => {
  assert.equal(awardLabel('champ'), '🥇 แชมป์');
  assert.equal(awardLabel('runnerUp'), '🥈 รองแชมป์');
  assert.equal(awardLabel('third'), '🥉 ที่ 3');
  assert.equal(awardLabel('last'), '💩 ท้ายตาราง');
  assert.equal(awardLabel('all'), 'ทุกคน');
  assert.equal(awardLabel('other', 'คนตบแรงสุด'), 'คนตบแรงสุด');
});
