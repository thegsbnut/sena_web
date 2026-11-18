// Job badges: nightly attendance counts and each player's chosen job line.
// Both tables live outside the booking document, so writing them never bumps
// the booking revision (a job change must not make someone else's booking 409).
import './public/job-rules.js';
import './public/engine.js';
import {
  cupHistoryTable,
  goldSlots,
  goldSlotKey,
  identityFrom,
  legacyNames,
} from './leaderboard.js';

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
  // One cached summary per club (play totals, Cup titles, latest Cup). `version` goes up and the
  // payload is cleared whenever attendance or Cup history changes (triggers, so every write path,
  // including a restore or a manual edit, is covered); the next read rebuilds it.
  await db
    .prepare(
      'CREATE TABLE IF NOT EXISTS badge_summary (club TEXT PRIMARY KEY, version INTEGER NOT NULL, payload TEXT)',
    )
    .run();
  for (const [name, event, club] of [
    ['insert', 'INSERT', 'NEW.club'],
    ['delete', 'DELETE', 'OLD.club'],
  ])
    await db
      .prepare(invalidateTrigger(`badge_attendance_${name}`, event, 'attendance', club))
      .run();
}

const invalidateTrigger = (name, event, table, club) =>
  `CREATE TRIGGER IF NOT EXISTS ${name} AFTER ${event} ON ${table} BEGIN INSERT INTO badge_summary (club,version,payload) VALUES (${club},1,NULL) ON CONFLICT(club) DO UPDATE SET version=version+1, payload=NULL; END`;

// Same for a club's Cup history table (named per club, so the club is a literal).
async function prepareCupTriggers(db, club, table) {
  for (const event of ['INSERT', 'UPDATE', 'DELETE'])
    await db
      .prepare(
        invalidateTrigger(`badge_${table}_${event.toLowerCase()}`, event, table, `'${club}'`),
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
  // RETURNING lists only the rows really inserted; meta.changes would also count the
  // rows the cache-invalidation trigger writes.
  let added = 0;
  for (let i = 0; i < rows.length; i += 30) {
    const chunk = rows.slice(i, i + 30);
    const result = await db
      .prepare(
        'INSERT OR IGNORE INTO attendance (club, session_date, player_id) VALUES ' +
          chunk.map(() => '(?,?,?)').join(',') +
          ' RETURNING player_id',
      )
      .bind(...chunk.flat())
      .all();
    added += result.results.length;
  }
  return added;
}

// Same pick as leaderboard.js latestCup: newest date, then newest sequence.
export function latestOf(cups) {
  let best = null;
  for (const row of cups) {
    const date = typeof row.cup?.date === 'string' ? row.cup.date : '';
    if (!best || date > best.date || (date === best.date && row.sequence > best.sequence))
      best = { date, sequence: row.sequence, cup: row.cup };
  }
  return best ? best.cup : null;
}

// The slow part, done only when the cached summary is missing: every attendance row and
// Cup of the club boiled down to play totals, the gold-medal slots and the latest Cup.
async function buildSummary(db, club, table) {
  const [plays, cups] = await Promise.all([
    db.prepare('SELECT player_id, session_date FROM attendance WHERE club=?').bind(club).all(),
    db.prepare(`SELECT sequence, payload FROM ${table}`).all(),
  ]);
  const cupList = cups.results.map(r => ({ sequence: r.sequence, cup: JSON.parse(r.payload) }));
  // Weighted by Cup date, so a Cup recorded after the nightly job still counts retroactively
  // (recording a Cup clears the summary, which rebuilds with the new date).
  const cupDates = new Set(cupList.map(r => r.cup?.date).filter(d => d >= CUP_DAY_SINCE));
  const totals = new Map();
  for (const r of plays.results)
    totals.set(
      r.player_id,
      (totals.get(r.player_id) || 0) + (cupDates.has(r.session_date) ? CUP_DAY_PLAYS : 1),
    );
  return {
    plays: [...totals].map(([player_id, n]) => ({ player_id, n })),
    golds: cupList.flatMap(r => goldSlots(r.cup, club)),
    latest: latestOf(cupList),
  };
}

// The rows behind the badges. Read on its own so the booking route can run it
// alongside the booking document instead of after it. Normal reads cost one summary row
// plus the (roster-sized) job and name tables, however many nights or Cups there are.
export async function readBadgeSource(db, club) {
  await prepareJobTables(db);
  const table = await cupHistoryTable(db, club);
  await prepareCupTriggers(db, club, table);
  const [cached, jobs, legacy] = await Promise.all([
    db.prepare('SELECT version, payload FROM badge_summary WHERE club=?').bind(club).first(),
    db.prepare('SELECT player_id, line FROM player_jobs WHERE club=?').bind(club).all(),
    legacyNames(db, club),
  ]);
  let summary = null;
  try {
    summary = cached?.payload ? JSON.parse(cached.payload) : null;
  } catch {
    summary = null; // unreadable cache: rebuild it
  }
  if (!summary) {
    summary = await buildSummary(db, club, table);
    // Stored only if nothing changed since the version we saw (a change clears the payload and
    // bumps the version), so a rebuild that raced a write cannot leave stale numbers behind.
    await db
      .prepare(
        'INSERT INTO badge_summary (club,version,payload) VALUES (?,?,?) ON CONFLICT(club) DO UPDATE SET payload=excluded.payload WHERE badge_summary.version=excluded.version',
      )
      .bind(club, cached?.version ?? 0, JSON.stringify(summary))
      .run();
  }
  return { ...summary, jobs: jobs.results, legacy };
}

// The latest Cup, taken from the summary so the booking route skips a second query.
export const latestCupOf = source => source.latest ?? null;

// Everything the booking card needs to draw each roster player's badge. Titles and the
// latest-champion flag follow the player's roster id, so a renamed player keeps them.
// `latestAwards` is cupMedals() of the latest cup (keys 'id:<player id>').
export function badgesFrom(source, club, players, latestAwards = new Map()) {
  const playCount = new Map(source.plays.map(r => [r.player_id, r.n]));
  const chosen = new Map(source.jobs.map(r => [r.player_id, r.line]));
  const ident = identityFrom(players, club, source.legacy ?? new Map());
  const titles = new Map();
  for (const gold of source.golds) {
    const slot = goldSlotKey(ident, gold);
    titles.set(slot, (titles.get(slot) || 0) + 1);
  }
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
