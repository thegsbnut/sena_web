// Cup sponsors: players who give a prize on their club's Cup day. One row per
// sponsor in `cup_sponsors` (DB). Pure helpers first, database helpers below.
// Spec: docs/superpowers/specs/2026-11-20-cup-sponsors-design.md
import { BookingError } from './booking.js';

export const SPONSOR_LIMIT = 10;
export const AWARDS = ['champ', 'runnerUp', 'third', 'last', 'all', 'other'];
const LABELS = {
  champ: '🥇 แชมป์',
  runnerUp: '🥈 รองแชมป์',
  third: '🥉 ที่ 3',
  last: '💩 ท้ายตาราง',
  all: 'ทุกคน',
};
export const awardLabel = (award, note) =>
  award === 'other' ? String(note ?? '') : (LABELS[award] ?? '');

const fail = message => {
  throw new BookingError(message, 400);
};
const tidy = value =>
  String(value ?? '')
    .normalize('NFC')
    .replace(/\s+/g, ' ')
    .trim();
function field(value, label, max, required) {
  const text = tidy(value);
  if (!text) {
    if (required) fail(`กรุณาใส่${label}`);
    return null;
  }
  if ([...text].length > max) fail(`${label}ยาวได้ไม่เกิน ${max} ตัวอักษร`);
  return text;
}

// The editable fields of a sponsor, cleaned. `displayName` only counts for an
// organizer entering a sponsor who is not a player (no `playerId`).
export function cleanSponsorInput(input, { admin }) {
  if (!AWARDS.includes(input?.award)) fail('กรุณาเลือกว่ามอบของรางวัลให้ใคร');
  return {
    prize: field(input.prize, 'ของรางวัล', 60, true),
    award: input.award,
    awardNote: input.award === 'other' ? field(input.awardNote, 'ผู้ที่มอบให้', 30, true) : null,
    message: field(input.message, 'ข้อความ', 60, false),
    displayName:
      admin && !input.playerId ? field(input.displayName, 'ชื่อผู้สนับสนุน', 30, true) : null,
  };
}

// The last day a Cup's sponsors show under the cards: cup day + 7.
export function showUntil(cupDate) {
  const [y, m, d] = cupDate.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + 7)).toISOString().slice(0, 10);
}

// Rows of one club: the sponsors of the earliest Cup still inside its window,
// so the next Cup's sponsors wait until the previous window ends.
export function activeSponsors(rows, today) {
  const visible = rows.filter(r => !r.hidden && showUntil(r.cup_date) >= today);
  const first = visible.map(r => r.cup_date).sort()[0];
  return first ? visible.filter(r => r.cup_date === first) : [];
}
