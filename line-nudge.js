import { bangkokDate } from './booking.js';
import { billingLineMessages } from './billing.js';
import { flexRejected, rosterOf, siteOrigin } from './line-reply.js';
import { flexFallback } from './line-roster-card.js';
import { logError } from './log.js';

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

// A bill answer (badbot bill, or the card after a bill is opened) counts as today's reminder.
export async function recordNudged(env, group, timestamp) {
  const day = nudgeDay(timestamp);
  if (day) await claimNudge(env, group, day);
}

async function reply(env, event, messages) {
  const post = body =>
    fetch('https://api.line.me/v2/bot/message/reply', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + env.LINE_CHANNEL_ACCESS_TOKEN,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        replyToken: event.replyToken,
        messages: body,
        notificationDisabled: false,
      }),
      signal: AbortSignal.timeout(10000),
    });
  let response = await post(messages);
  if (response.ok) return;
  let error = await response.json().catch(() => ({}));
  // LINE refusing a Flex card must not mean silence: send the same thing as text once.
  if (response.status === 400 && flexRejected(messages, error)) {
    response = await post(messages.map(flexFallback));
    if (response.ok) return;
    error = await response.json().catch(() => ({}));
  }
  // A 400 that text cannot fix (bad mention, token) would fail again on every message
  // today: keep the day claimed and log what LINE said. Anything else may be transient.
  if (response.status === 400) {
    logError('line-nudge:rejected', error?.message || 'LINE rejected the reminder', {
      status: 400,
      requestId: response.headers.get('x-line-request-id'),
      details: error?.details,
    });
    return;
  }
  throw Error('LINE reply unavailable (' + response.status + ')');
}

// Ordinary text in a linked group, first one after 08:00 Thai: remind the open bills,
// once per group per day, using the message's own (free) reply token.
export async function morningNudge(event, env) {
  const group = event.source?.groupId;
  if (
    event.type !== 'message' ||
    event.message?.type !== 'text' ||
    event.source?.type !== 'group' ||
    !group ||
    !event.replyToken ||
    event.mode === 'standby' ||
    !env.LINE_CHANNEL_ACCESS_TOKEN
  )
    return;
  const day = nudgeDay(Number.isFinite(event.timestamp) ? event.timestamp : Date.now());
  if (!day) return;
  const { results } = await env.DB.prepare('SELECT club FROM line_groups WHERE group_id=?')
    .bind(group)
    .all();
  if (!results.length) return;
  const scope = results.length > 1 ? 'all' : results[0].club;
  if (!(await claimNudge(env, group, day))) return;
  try {
    const messages = await billingLineMessages(env, scope, siteOrigin(env), group, [], {
      rosterOf: rosterOf(env),
      quietIfEmpty: true,
    });
    if (!messages?.length) return await releaseNudge(env, group, day);
    await reply(env, event, messages);
  } catch (error) {
    logError('line-nudge:send', error);
    await releaseNudge(env, group, day).catch(releaseError =>
      logError('line-nudge:release', releaseError),
    );
    throw error;
  }
}
