// Job badges: nightly attendance counts and each player's chosen job line.
// Both tables live outside the booking document, so writing them never bumps
// the booking revision (a job change must not make someone else's booking 409).
import './public/job-rules.js';
import './public/engine.js';
import { cupHistoryTable, cupMedals, identityFrom, legacyNames } from './leaderboard.js';

// A night that has a Cup counts as this many plays toward the badge level (normal night = 1).
export const CUP_DAY_PLAYS = 3;
// Only Cup nights on or after this date get the bonus; earlier ones are never recounted.
export const CUP_DAY_SINCE = '2026-11-17';

export async function prepareJobTables(db) {
  await db
    .prepare(
      'CREATE TABLE IF NOT EXISTS attendance (club TEXT NOT NULL, session_date TEXT NOT NULL, player_id TEXT NOT NULL, PRIMARY KEY (club, session_date, player_id))',
    )
    .run();
  await db
    .prepare(
      'CREATE TABLE IF NOT EXISTS player_jobs (club TEXT NOT NULL, player_id TEXT NOT NULL, line TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (club, player_id))',
    )
    .run();
}

// Count confirmed roster players (not guests, not waitlist) of every session
// that already happened. Idempotent, so reruns and missed nights are safe.
// `since` (YYYY-MM-DD, optional) is the go-live date: older sessions are never counted,
// so clearing the attendance table once does not let the nightly job refill it.
export async function recordAttendance(db, club, doc, players, today, since = '') {
  await prepareJobTables(db);
  const roster = new Set(players.map(p => p.id));
  const rows = [];
  for (const s of doc.sessions) {
    if (s.skipped || !(s.date < today) || s.date < since) continue;
    for (const r of s.registrations.slice(0, s.capacity))
      if (!r.guest && roster.has(r.playerId)) rows.push([club, s.date, r.playerId]);
  }
  // Workers cap D1 queries per invocation, so insert in multi-row chunks
  // (30 rows × 3 values stays under D1's 100 bound-parameter limit).
  let added = 0;
  for (let i = 0; i < rows.length; i += 30) {
    const chunk = rows.slice(i, i + 30);
    const result = await db
      .prepare(
        'INSERT OR IGNORE INTO attendance (club, session_date, player_id) VALUES ' +
          chunk.map(() => '(?,?,?)').join(','),
      )
      .bind(...chunk.flat())
      .run();
    added += result.meta.changes;
  }
  return added;
}

// The rows behind the badges. Read on its own so the booking route can run it
// alongside the booking document instead of after it.
export async function readBadgeSource(db, club) {
  await prepareJobTables(db);
  const table = await cupHistoryTable(db, club);
  const [plays, jobs, cups, legacy] = await Promise.all([
    db.prepare('SELECT player_id, session_date FROM attendance WHERE club=?').bind(club).all(),
    db.prepare('SELECT player_id, line FROM player_jobs WHERE club=?').bind(club).all(),
    db.prepare(`SELECT sequence, payload FROM ${table}`).all(),
    legacyNames(db, club),
  ]);
  const cupList = cups.results.map(r => ({ sequence: r.sequence, cup: JSON.parse(r.payload) }));
  // Weighted at read time, so a Cup recorded after the nightly job still counts retroactively.
  const cupDates = new Set(cupList.map(r => r.cup?.date).filter(d => d >= CUP_DAY_SINCE));
  const totals = new Map();
  for (const r of plays.results)
    totals.set(
      r.player_id,
      (totals.get(r.player_id) || 0) + (cupDates.has(r.session_date) ? CUP_DAY_PLAYS : 1),
    );
  return {
    plays: [...totals].map(([player_id, n]) => ({ player_id, n })),
    jobs: jobs.results,
    cups: cupList,
    legacy,
  };
}

// Same pick as leaderboard.js latestCup (newest date, then newest sequence),
// taken from rows already read so the booking route skips a second query.
export function latestCupOf(source) {
  let best = null;
  for (const row of source.cups) {
    const date = typeof row.cup?.date === 'string' ? row.cup.date : '';
    if (!best || date > best.date || (date === best.date && row.sequence > best.sequence))
      best = { date, sequence: row.sequence, cup: row.cup };
  }
  return best ? best.cup : null;
}

// Everything the booking card needs to draw each roster player's badge. Titles and the
// latest-champion flag follow the player's roster id, so a renamed player keeps them.
// `latestAwards` is cupMedals() of the latest cup (keys 'id:<player id>').
export function badgesFrom(source, club, players, latestAwards = new Map()) {
  const playCount = new Map(source.plays.map(r => [r.player_id, r.n]));
  const chosen = new Map(source.jobs.map(r => [r.player_id, r.line]));
  const ident = identityFrom(players, club, source.legacy ?? new Map());
  const titles = new Map();
  for (const { cup } of source.cups)
    for (const [slot, award] of cupMedals(cup, ident))
      if (award === '🥇') titles.set(slot, (titles.get(slot) || 0) + 1);
  const { LINES, defaultLine } = globalThis.SenaJobRules;
  return new Map(
    players.map(p => {
      const line = chosen.get(p.id);
      return [
        p.id,
        {
          plays: playCount.get(p.id) || 0,
          line: LINES.includes(line) ? line : defaultLine(p.id),
          chosen: LINES.includes(line),
          titles: titles.get('id:' + p.id) || 0,
          latestChamp: latestAwards.get('id:' + p.id) === '🥇',
        },
      ];
    }),
  );
}

export async function badgeData(db, club, players, latestAwards = new Map()) {
  return badgesFrom(await readBadgeSource(db, club), club, players, latestAwards);
}

export async function setJobLine(db, club, playerId, line) {
  await prepareJobTables(db);
  await db
    .prepare(
      'INSERT INTO player_jobs (club, player_id, line, updated_at) VALUES (?,?,?,?) ON CONFLICT (club, player_id) DO UPDATE SET line=excluded.line, updated_at=excluded.updated_at',
    )
    .bind(club, playerId, line, new Date().toISOString())
    .run();
}
