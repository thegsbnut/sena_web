import { bangkokDate } from './booking.js';

const DAY_MS = 86400000;
const NUDGE_FROM_HOUR = 8;
const thaiHour = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  hourCycle: 'h23',
  timeZone: 'Asia/Bangkok',
});

// The Thai date a message counts for, or null before 08:00 (too early to nudge).
export function nudgeDay(timestamp) {
  const at = new Date(timestamp);
  if (Number(thaiHour.format(at)) < NUDGE_FROM_HOUR) return null;
  return bangkokDate(at);
}

async function prepare(db) {
  await db
    .prepare(
      'CREATE TABLE IF NOT EXISTS line_daily_nudges (group_id TEXT NOT NULL, day TEXT NOT NULL, claimed_at INTEGER NOT NULL, PRIMARY KEY (group_id, day))',
    )
    .run();
}

// True only for the caller that gets to send today's reminder for this group.
export async function claimNudge(env, group, day, now = Date.now()) {
  await prepare(env.DB);
  await env.DB.prepare('DELETE FROM line_daily_nudges WHERE claimed_at<?')
    .bind(now - 7 * DAY_MS)
    .run();
  const claim = await env.DB.prepare(
    'INSERT OR IGNORE INTO line_daily_nudges (group_id,day,claimed_at) VALUES (?,?,?)',
  )
    .bind(group, day, now)
    .run();
  return claim.meta.changes > 0;
}

export async function releaseNudge(env, group, day) {
  await prepare(env.DB);
  await env.DB.prepare('DELETE FROM line_daily_nudges WHERE group_id=? AND day=?')
    .bind(group, day)
    .run();
}
