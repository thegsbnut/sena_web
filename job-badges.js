// Job badges: nightly attendance counts and each player's chosen job line.
// Both tables live outside the booking document, so writing them never bumps
// the booking revision (a job change must not make someone else's booking 409).
import './public/job-rules.js';

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
export async function recordAttendance(db, club, doc, players, today) {
  await prepareJobTables(db);
  const roster = new Set(players.map(p => p.id));
  let added = 0;
  for (const s of doc.sessions) {
    if (s.skipped || !(s.date < today)) continue;
    for (const r of s.registrations.slice(0, s.capacity)) {
      if (r.guest || !roster.has(r.playerId)) continue;
      const result = await db
        .prepare('INSERT OR IGNORE INTO attendance (club, session_date, player_id) VALUES (?,?,?)')
        .bind(club, s.date, r.playerId)
        .run();
      added += result.meta.changes;
    }
  }
  return added;
}
