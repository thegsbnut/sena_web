import { clubOf } from './clubs.js';

// Group notices: the LIFF page posts a plain text message into the group in the
// player's name (free). When the bot should add something (tag the waitlisted
// player who got a spot, or a paid-in-full summary) the text ends with " #code";
// the webhook claims that one-time code and answers with the free Reply API.
const day = 86400000;
// Fixed tables: Intl short weekday names differ between runtimes ("ส." vs "เสาร์").
const weekdays = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'],
  months = [
    'ม.ค.',
    'ก.พ.',
    'มี.ค.',
    'เม.ย.',
    'พ.ค.',
    'มิ.ย.',
    'ก.ค.',
    'ส.ค.',
    'ก.ย.',
    'ต.ค.',
    'พ.ย.',
    'ธ.ค.',
  ];
export const noticeDay = date => {
  const d = new Date(date.slice(0, 10) + 'T12:00:00Z');
  return weekdays[d.getUTCDay()] + ' ' + d.getUTCDate() + ' ' + months[d.getUTCMonth()];
};
export const noticeClub = club => clubOf(club).label.toUpperCase();
export const NOTICE_CODE = /(?:^|\s)#([a-z0-9]{5})\s*$/;

const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
const randomCode = () =>
  [...crypto.getRandomValues(new Uint8Array(5))].map(b => alphabet[b % 36]).join('');

async function prepare(db) {
  await db
    .prepare(
      'CREATE TABLE IF NOT EXISTS line_notices (code TEXT PRIMARY KEY, club TEXT NOT NULL, kind TEXT NOT NULL, payload TEXT NOT NULL, created_at INTEGER NOT NULL, used_at INTEGER)',
    )
    .run();
}

export async function createNotice(db, { club, kind, payload }, now = Date.now()) {
  await prepare(db);
  await db
    .prepare('DELETE FROM line_notices WHERE created_at<?')
    .bind(now - 7 * day)
    .run();
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = randomCode();
    const inserted = await db
      .prepare(
        'INSERT OR IGNORE INTO line_notices (code,club,kind,payload,created_at) VALUES (?,?,?,?,?)',
      )
      .bind(code, club, kind, JSON.stringify(payload), now)
      .run();
    if (inserted.meta.changes) return code;
  }
  throw Error('Could not allocate a notice code');
}

// Exactly one caller wins a code; expired or used codes return null.
export async function claimNotice(db, code, now = Date.now()) {
  await prepare(db);
  const claimed = await db
    .prepare('UPDATE line_notices SET used_at=? WHERE code=? AND used_at IS NULL AND created_at>?')
    .bind(now, code, now - day)
    .run();
  if (!claimed.meta.changes) return null;
  const row = await db
    .prepare('SELECT club,kind,payload FROM line_notices WHERE code=?')
    .bind(code)
    .first();
  return row ? { club: row.club, kind: row.kind, payload: JSON.parse(row.payload) } : null;
}

export async function releaseNotice(db, code) {
  await db.prepare('UPDATE line_notices SET used_at=NULL WHERE code=?').bind(code).run();
}

// POST /api/line/notice-report from public/line-notice.js: where a group notice
// ended up on the phone. Logged only (no database); every field is whitelisted
// and trimmed so nothing personal reaches the log.
const REPORT_STAGES = new Set(['sent', 'no-credentials', 'not-group', 'no-permission', 'failed']);
export async function noticeReport(req) {
  const text = await req.text();
  if (text.length > 2000) return new Response(null, { status: 413 });
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return new Response(null, { status: 400 });
  }
  if (!REPORT_STAGES.has(body?.stage)) return new Response(null, { status: 400 });
  const field = (value, n) =>
    String(value ?? '')
      .replace(/U[a-f0-9]{32}/g, '[LINE_USER_ID]')
      .slice(0, n);
  const entry = {
    context: 'line-notice:client',
    stage: body.stage,
    kind: field(body.kind, 4),
    page: field(body.page, 40),
    at: field(body.at, 20),
    lineContext: field(body.context, 20),
    permission: field(body.permission, 20),
    error: field(body.error, 300),
  };
  (body.stage === 'sent' ? console.log : console.warn)(JSON.stringify(entry));
  return new Response(null, { status: 204 });
}
