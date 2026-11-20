// Cup sponsors: players who give a prize on their club's Cup day. One row per
// sponsor in `cup_sponsors` (DB). Pure helpers first, database helpers below.
// Spec: docs/superpowers/specs/2026-11-20-cup-sponsors-design.md
import { BookingError } from './booking.js';
import { SQL } from './schema.js';

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

// The earliest cup day whose sponsors can still be on show today (today - 7):
// reads of the strip never need older rows.
export function windowStart(today) {
  const [y, m, d] = today.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d - 7)).toISOString().slice(0, 10);
}

// Rows of one club: the sponsors of the earliest Cup still inside its window,
// so the next Cup's sponsors wait until the previous window ends.
export function activeSponsors(rows, today) {
  const visible = rows.filter(r => !r.hidden && showUntil(r.cup_date) >= today);
  const first = visible.map(r => r.cup_date).sort()[0];
  return first ? visible.filter(r => r.cup_date === first) : [];
}

// ---- database ----
async function prepare(db) {
  await db.prepare(SQL.cupSponsors).run();
  await db.prepare(SQL.cupSponsorsDateIndex).run();
  await db.prepare(SQL.cupSponsorsPlayerIndex).run();
}
const conflict = message => {
  throw new BookingError(message, 409);
};
const STALE = 'มีการแก้สปอนเซอร์จากอีกเครื่อง กรุณาโหลดใหม่';
const marks = n => Array(n).fill('?').join(',');

export async function getSponsor(db, id) {
  await prepare(db);
  return await db.prepare('SELECT * FROM cup_sponsors WHERE id=?').bind(id).first();
}

// Visible rows of the given clubs, oldest first; optionally only the given cup
// dates or from a date on.
export async function listSponsors(db, { clubs, from, dates }) {
  await prepare(db);
  if (!clubs.length || dates?.length === 0) return [];
  let sql = `SELECT * FROM cup_sponsors WHERE hidden=0 AND club IN (${marks(clubs.length)})`;
  const values = [...clubs];
  if (from) {
    sql += ' AND cup_date>=?';
    values.push(from);
  }
  if (dates) {
    sql += ` AND cup_date IN (${marks(dates.length)})`;
    values.push(...dates);
  }
  return (
    await db
      .prepare(sql + ' ORDER BY created_at, id')
      .bind(...values)
      .all()
  ).results;
}

// One statement checks the cap and inserts, so two people cannot both take the
// tenth place. A repeat of the same id (a retried request) returns the row.
export async function createSponsor(db, s, now) {
  await prepare(db);
  if (s.playerId)
    await db
      .prepare('DELETE FROM cup_sponsors WHERE club=? AND cup_date=? AND player_id=? AND hidden=1')
      .bind(s.club, s.cupDate, s.playerId)
      .run();
  const inserted = await db
    .prepare(
      `INSERT OR IGNORE INTO cup_sponsors (id,club,cup_date,player_id,display_name,prize,award,award_note,message,hidden,created_at,updated_at,revision)
       SELECT ?,?,?,?,?,?,?,?,?,0,?,?,1
       WHERE (SELECT COUNT(*) FROM cup_sponsors WHERE club=? AND cup_date=? AND hidden=0) < ?`,
    )
    .bind(
      s.id,
      s.club,
      s.cupDate,
      s.playerId ?? null,
      s.displayName,
      s.prize,
      s.award,
      s.awardNote ?? null,
      s.message ?? null,
      now,
      now,
      s.club,
      s.cupDate,
      SPONSOR_LIMIT,
    )
    .run();
  const row = await getSponsor(db, s.id);
  if (inserted.meta.changes || row) return row;
  if (s.playerId) {
    const mine = await db
      .prepare('SELECT id FROM cup_sponsors WHERE club=? AND cup_date=? AND player_id=?')
      .bind(s.club, s.cupDate, s.playerId)
      .first();
    if (mine) conflict('คุณเป็นสปอนเซอร์วันนี้แล้ว');
  }
  conflict(`สปอนเซอร์วันนี้ครบ ${SPONSOR_LIMIT} คนแล้ว`);
}

// `clean` from cleanSponsorInput; `displayName` refreshes the snapshot when given.
export async function updateSponsor(db, id, revision, clean, now) {
  await prepare(db);
  const updated = await db
    .prepare(
      `UPDATE cup_sponsors SET prize=?,award=?,award_note=?,message=?,display_name=COALESCE(?,display_name),
       updated_at=?,revision=revision+1 WHERE id=? AND revision=? AND hidden=0`,
    )
    .bind(
      clean.prize,
      clean.award,
      clean.awardNote ?? null,
      clean.message ?? null,
      clean.displayName ?? null,
      now,
      id,
      revision,
    )
    .run();
  if (!updated.meta.changes) conflict(STALE);
  return await getSponsor(db, id);
}

export async function deleteSponsor(db, id, revision) {
  await prepare(db);
  const deleted = await db
    .prepare('DELETE FROM cup_sponsors WHERE id=? AND revision=?')
    .bind(id, revision)
    .run();
  if (!deleted.meta.changes) conflict(STALE);
}

// What the booking page shows for one Cup day.
export function sponsorView(rows, { players, ownId, admin, started }) {
  const names = new Map(players.map(p => [p.id, p.name]));
  return rows.map(r => {
    const mine = Boolean(ownId) && r.player_id === ownId;
    return {
      id: r.id,
      name: names.get(r.player_id) ?? r.display_name,
      prize: r.prize,
      award: r.award,
      awardLabel: awardLabel(r.award, r.award_note),
      awardNote: r.award_note ?? null,
      message: r.message ?? null,
      mine,
      canEdit: Boolean(admin) || (mine && !started),
      revision: r.revision,
    };
  });
}

// After an organizer saves the Cup calendar: `lost` / `gained` are the dates
// that stopped / started being a Cup; `moves` says where each lost day's
// sponsors go (`to: null` = hide them).
export async function applyCupMoves(db, club, { lost, gained, moves }, now) {
  await prepare(db);
  const run = (sql, ...values) =>
    db
      .prepare(sql)
      .bind(...values)
      .run();
  for (const { from, to } of moves) {
    if (!to) continue;
    // Stale hidden rows at the destination would block the unique index.
    await run(
      `DELETE FROM cup_sponsors WHERE club=? AND cup_date=? AND hidden=1 AND player_id IN
       (SELECT player_id FROM cup_sponsors WHERE club=? AND cup_date=? AND hidden=0 AND player_id IS NOT NULL)`,
      club,
      to,
      club,
      from,
    );
    // A player already sponsoring the destination keeps that entry.
    await run(
      `UPDATE cup_sponsors SET hidden=1,updated_at=?,revision=revision+1
       WHERE club=? AND cup_date=? AND hidden=0 AND player_id IN
       (SELECT player_id FROM cup_sponsors WHERE club=? AND cup_date=? AND hidden=0 AND player_id IS NOT NULL)`,
      now,
      club,
      from,
      club,
      to,
    );
    await run(
      'UPDATE cup_sponsors SET cup_date=?,updated_at=?,revision=revision+1 WHERE club=? AND cup_date=? AND hidden=0',
      to,
      now,
      club,
      from,
    );
  }
  for (const date of lost)
    await run(
      'UPDATE cup_sponsors SET hidden=1,updated_at=?,revision=revision+1 WHERE club=? AND cup_date=? AND hidden=0',
      now,
      club,
      date,
    );
  for (const date of gained)
    await run(
      'UPDATE cup_sponsors SET hidden=0,updated_at=?,revision=revision+1 WHERE club=? AND cup_date=? AND hidden=1',
      now,
      club,
      date,
    );
}
