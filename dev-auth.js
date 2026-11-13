// TEMPORARY dev-login bypass for testing production without LINE Login.
// Off unless env DEV_AUTH === "true" AND env DEV_AUTH_SECRET is set (>= 32 chars).
// Turn it off: delete DEV_AUTH in the Cloudflare dashboard, redeploy, run
// scripts/dev-test-cleanup.mjs (see DEV-LOGIN.md).
//
// Isolation: test users (user_id "U_TEST_…", a row in member_test_users with
// is_test = 1) live only in the hidden sandbox club "test" (clubs.js TEST_CLUB):
// own roster, bookings, bills, cup table. Their session is ignored on the real
// clubs, they can never become admins of a real club, and no real LINE API is
// called for them (see mockLineCall).
import { TEST_CLUB, clubOf } from './clubs.js';
import { prepareMembers } from './member.js';
import { defaultSettings } from './booking.js';

export const TEST_UID_PREFIX = 'U_TEST_';
const TEST_UID_PATTERN = /^U_TEST_[A-Za-z0-9_-]{1,40}$/;
const TEST_SESSION_MS = 2 * 3600000;
const enc = new TextEncoder();

export const devAuthEnabled = env =>
  env?.DEV_AUTH === 'true' &&
  typeof env.DEV_AUTH_SECRET === 'string' &&
  env.DEV_AUTH_SECRET.length >= 32;
export const isTestUserId = id => typeof id === 'string' && id.startsWith(TEST_UID_PREFIX);

export function logDevAuth(event, extra = {}) {
  console.log(JSON.stringify({ level: 'info', context: 'dev-auth', event, ...extra }));
}
// Stand-in for a real LINE API call made on behalf of a test user: log what
// would have been sent and send nothing.
export function mockLineCall(api, detail = {}) {
  logDevAuth('line-api-mocked', { api, ...detail });
}

const hex = bytes =>
  Array.from(new Uint8Array(bytes), x => x.toString(16).padStart(2, '0')).join('');
const sha256 = async text =>
  new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(text)));
const hash = async text => hex(await sha256(text));
// Constant time: compare fixed-length digests, never the raw strings.
async function secretMatches(given, secret) {
  if (typeof given !== 'string' || !given || given.length > 1024) return false;
  const [a, b] = await Promise.all([sha256(given), sha256(secret)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
const random = () =>
  crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '');
const cookie = (req, name) =>
  (req.headers.get('Cookie') || '')
    .split(';')
    .map(s => s.trim())
    .find(s => s.startsWith(name + '='))
    ?.slice(name.length + 1) || '';
// Same cookie and table as the real LINE Login (member.js), only shorter-lived.
const memberCookie = (value, maxAge) =>
  '__Host-sena-member=' + value + '; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=' + maxAge;
// Readable by the page: only drives the "TEST MODE" banner, grants nothing.
const bannerCookie = (value, maxAge) =>
  '__Host-sena-test=' + value + '; Path=/; Secure; SameSite=Lax; Max-Age=' + maxAge;
const notFound = () =>
  new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });
const bad = message =>
  Response.json({ error: message }, { status: 400, headers: { 'Cache-Control': 'no-store' } });

async function prepareTestUsers(db) {
  await db
    .prepare(
      "CREATE TABLE IF NOT EXISTS member_test_users (user_id TEXT PRIMARY KEY CHECK(user_id LIKE 'U_TEST_%'),name TEXT NOT NULL,role TEXT NOT NULL CHECK(role IN ('admin','player')),is_test INTEGER NOT NULL DEFAULT 1 CHECK(is_test=1),created_at TEXT NOT NULL,last_login_at TEXT NOT NULL)",
    )
    .run();
}

// Sample players so a test session can fill up and draw a schedule.
const DUMMIES = [
  ['Dummy A', 'M', 8],
  ['Dummy B', 'M', 7],
  ['Dummy C', 'F', 6],
  ['Dummy D', 'M', 6.5],
  ['Dummy E', 'F', 5],
  ['Dummy F', 'M', 7.5],
  ['Dummy G', 'M', 5.5],
  ['Dummy H', 'F', 6],
  ['Dummy I', 'M', 9],
  ['Dummy J', 'F', 4.5],
].map(([name, gender, lv], i) => ({ id: 'test-dummy-' + (i + 1), name, thai: '', lv, gender }));

// The sandbox club's booking document; booking.js only seeds the real clubs.
export async function ensureTestBooking(db) {
  await db
    .prepare(
      'CREATE TABLE IF NOT EXISTS booking_clubs (club TEXT PRIMARY KEY, revision INTEGER NOT NULL, payload TEXT NOT NULL, updated_at TEXT NOT NULL)',
    )
    .run();
  const settings = {
    ...defaultSettings(),
    enabled: true,
    weekdays: [0, 1, 2, 3, 4, 5, 6],
    start: '20:00',
    end: '22:00',
    capacity: 8,
    weeks: 1,
    regularIds: DUMMIES.slice(0, 6).map(p => p.id),
  };
  await db
    .prepare(
      'INSERT OR IGNORE INTO booking_clubs (club,revision,payload,updated_at) VALUES (?,0,?,?)',
    )
    .bind(
      TEST_CLUB,
      JSON.stringify({ settings, settingsVersion: 0, sessions: [], seq: 0 }),
      new Date().toISOString(),
    )
    .run();
}

async function ensureTestPlayer(db, uid, name, gender) {
  const table = clubOf(TEST_CLUB).stateTable,
    playerId = 'test-' + uid.slice(TEST_UID_PREFIX.length).toLowerCase();
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS ${table} (id INTEGER PRIMARY KEY,revision INTEGER NOT NULL,payload TEXT NOT NULL,updated_at TEXT NOT NULL)`,
    )
    .run();
  for (let attempt = 0; attempt < 5; attempt++) {
    const row = await db.prepare(`SELECT revision,payload FROM ${table} WHERE id=1`).first();
    const state = row
      ? JSON.parse(row.payload)
      : { players: [...DUMMIES], selected: [], rounds: 10, locks: [], result: null, cup: null };
    const existing = state.players.find(p => p.id === playerId);
    if (existing && row) return existing;
    let player = existing;
    if (!player) {
      if (state.players.length >= 200) throw Error('test roster full');
      const key = n => n.normalize('NFC').trim().toLowerCase();
      const taken = state.players.some(p => key(p.name) === key(name));
      player = {
        id: playerId,
        name: taken ? name + ' ' + uid.slice(-4) : name,
        thai: '',
        lv: 6.5,
        gender,
      };
      state.players.push(player);
    }
    const now = new Date().toISOString(),
      payload = JSON.stringify(state);
    const written = row
      ? await db
          .prepare(
            `UPDATE ${table} SET payload=?,revision=revision+1,updated_at=? WHERE id=1 AND revision=? RETURNING revision`,
          )
          .bind(payload, now, row.revision)
          .first()
      : await db
          .prepare(
            `INSERT OR IGNORE INTO ${table} (id,revision,payload,updated_at) VALUES (1,1,?,?) RETURNING revision`,
          )
          .bind(payload, now)
          .first();
    if (written) return player;
  }
  throw Error('test roster busy');
}

// GET /dev-login?key=…&uid=U_TEST_x&name=…&role=admin|player[&gender=M|F]
export async function devLoginRoute(req, env) {
  if (req.method !== 'GET' || !devAuthEnabled(env) || !env.DB) return notFound();
  const url = new URL(req.url),
    q = url.searchParams;
  if (!(await secretMatches(q.get('key'), env.DEV_AUTH_SECRET))) {
    logDevAuth('login-rejected', { reason: q.has('key') ? 'wrong_key' : 'missing_key' });
    return notFound();
  }
  const uid = q.get('uid') || '',
    role = q.get('role') || 'player',
    gender = q.get('gender') || 'M',
    name = String(q.get('name') || 'Test ' + uid.slice(TEST_UID_PREFIX.length))
      .normalize('NFC')
      .replace(/\s+/g, ' ')
      .trim();
  if (!TEST_UID_PATTERN.test(uid))
    return bad('uid ต้องขึ้นต้นด้วย U_TEST_ ตามด้วย A-Z a-z 0-9 _ - ไม่เกิน 40 ตัว');
  if (!['admin', 'player'].includes(role)) return bad('role ต้องเป็น admin หรือ player');
  if (!['M', 'F'].includes(gender)) return bad('gender ต้องเป็น M หรือ F');
  if (!name || name.length > 30 || /[\u0000-\u001f<>]/.test(name))
    return bad('name ไม่เกิน 30 ตัวอักษร ห้ามมี < >');

  const db = env.DB,
    now = new Date().toISOString();
  await prepareMembers(db);
  await prepareTestUsers(db);
  await db
    .prepare(
      'INSERT INTO member_test_users (user_id,name,role,is_test,created_at,last_login_at) VALUES (?,?,?,1,?,?) ON CONFLICT(user_id) DO UPDATE SET name=excluded.name,role=excluded.role,last_login_at=excluded.last_login_at',
    )
    .bind(uid, name, role, now, now)
    .run();
  // Same record shape the real LINE Login writes (member_profiles / member_links).
  await db
    .prepare(
      'INSERT INTO member_profiles VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET line_name=excluded.line_name',
    )
    .bind(uid, name)
    .run();
  const player = await ensureTestPlayer(db, uid, name, gender);
  await db
    .prepare(
      "INSERT INTO member_links VALUES(?,?,?,?,'new','approved',?) ON CONFLICT(user_id,club) DO UPDATE SET player_id=excluded.player_id,name=excluded.name,status='approved'",
    )
    .bind(uid, TEST_CLUB, player.id, player.name, now)
    .run();
  await ensureTestBooking(db);

  const old = cookie(req, '__Host-sena-member');
  if (/^[a-f0-9]{64}$/.test(old))
    await db
      .prepare('DELETE FROM member_sessions WHERE token_hash=?')
      .bind(await hash(old))
      .run();
  await db.prepare('DELETE FROM member_sessions WHERE expires_at<=?').bind(Date.now()).run();
  const token = random(),
    expiresAt = Date.now() + TEST_SESSION_MS;
  await db
    .prepare('INSERT INTO member_sessions VALUES(?,?,?)')
    .bind(await hash(token), uid, expiresAt)
    .run();
  logDevAuth('login', {
    uid,
    role,
    name,
    playerId: player.id,
    expiresAt: new Date(expiresAt).toISOString(),
    country: req.cf?.country || null,
  });
  const headers = new Headers({
    Location: new URL('/court?club=' + TEST_CLUB + '#booking', url.origin).href,
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
  });
  headers.append('Set-Cookie', memberCookie(token, TEST_SESSION_MS / 1000));
  headers.append(
    'Set-Cookie',
    bannerCookie(encodeURIComponent(role + ':' + name), TEST_SESSION_MS / 1000),
  );
  return new Response(null, { status: 302, headers });
}

// GET /dev-logout: always available so stale test cookies can be cleared.
export async function devLogoutRoute(req, env) {
  const token = cookie(req, '__Host-sena-member');
  let uid = null;
  if (env.DB && /^[a-f0-9]{64}$/.test(token)) {
    const tokenHash = await hash(token);
    let row = null;
    try {
      row = await env.DB.prepare('SELECT user_id FROM member_sessions WHERE token_hash=?')
        .bind(tokenHash)
        .first();
    } catch {
      row = null; // No sessions table yet: nothing to remove.
    }
    if (isTestUserId(row?.user_id)) {
      uid = row.user_id;
      await env.DB.prepare('DELETE FROM member_sessions WHERE token_hash=?').bind(tokenHash).run();
    }
  }
  if (uid) logDevAuth('logout', { uid });
  const headers = new Headers({
    Location: new URL('/court', req.url).href,
    'Cache-Control': 'no-store',
  });
  // Only clear the member cookie when it belonged to a test user.
  if (uid) headers.append('Set-Cookie', memberCookie('', 0));
  headers.append('Set-Cookie', bannerCookie('', 0));
  return new Response(null, { status: 302, headers });
}

// Called by member.js memberFor for a test session, or for any session on the
// test club. A test user exists only on the test club; nobody else does.
export async function testMemberFor(env, session, club, tokenHash) {
  if (!devAuthEnabled(env) || club !== TEST_CLUB || !isTestUserId(session.user_id)) return null;
  const link = await env.DB.prepare(
    'SELECT player_id,name,kind,status FROM member_links WHERE user_id=? AND club=?',
  )
    .bind(session.user_id, TEST_CLUB)
    .first();
  return {
    userId: session.user_id,
    link: link || null,
    mappingError: null,
    test: true,
    session: { tokenHash, expiresAt: session.expires_at },
  };
}

// Organizer rights for a test admin: only on the test club, only while DEV_AUTH is on.
export async function testIsAdmin(req, env) {
  if (!devAuthEnabled(env) || !env.DB) return false;
  if (new URL(req.url).searchParams.get('club') !== TEST_CLUB) return false;
  const token = cookie(req, '__Host-sena-member');
  if (!/^[a-f0-9]{64}$/.test(token)) return false;
  await prepareTestUsers(env.DB);
  const row = await env.DB.prepare(
    "SELECT 1 AS ok FROM member_sessions s JOIN member_test_users t ON t.user_id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND t.role='admin' AND t.is_test=1",
  )
    .bind(await hash(token), Date.now())
    .first();
  return Boolean(row);
}
