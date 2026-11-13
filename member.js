import { clubOf, counterpartClub, CLUB_IDS, DEFAULT_CLUB, isClub } from './clubs.js';
import { mapBoth, MappingError } from './member-shared.js';
const json = (data, status = 200, headers = {}) =>
  Response.json(data, {
    status,
    headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', ...headers },
  });
export const memberMode = env => env.LINE_MEMBER_AUTH_ENABLED === 'true';
export const loginEnabled = env => memberMode(env) || env.LINE_LOGIN_ENABLED === 'true';
export const liffUrl = (env, club = DEFAULT_CLUB, page = 'book', bill = '') => {
  const url = new URL('https://liff.line.me/' + env.LINE_LIFF_ID);
  url.searchParams.set('club', club);
  url.searchParams.set('page', page);
  if (bill) url.searchParams.set('bill', bill);
  return url.href;
};
const random = () =>
  crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '');
const hash = async text =>
  Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))),
    x => x.toString(16).padStart(2, '0'),
  ).join('');
const cookie = (req, name) =>
  (req.headers.get('Cookie') || '')
    .split(';')
    .map(s => s.trim())
    .find(s => s.startsWith(name + '='))
    ?.slice(name.length + 1) || '';
// Sessions slide: each visit through the LIFF entry (GET /api/member) renews an
// active session to a fresh 7 days, at most once a day, so regular players stay
// signed in while an idle session still expires after a week.
// New members sign themselves up and are linked straight away; the organizer
// adjusts the level or name later from the player list if needed.
const NEW_MEMBER_LV = 6.5;
const SESSION_MS = 7 * 86400000,
  RENEW_AFTER_MS = 86400000;
const sessionCookie = value =>
  '__Host-sena-member=' +
  value +
  '; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=' +
  (value ? SESSION_MS / 1000 : 0);
export async function prepareMembers(db) {
  await db
    .prepare(
      'CREATE TABLE IF NOT EXISTS member_profiles (user_id TEXT PRIMARY KEY,line_name TEXT NOT NULL)',
    )
    .run();
  await db
    .prepare(
      'CREATE TABLE IF NOT EXISTS member_sessions (token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL,expires_at INTEGER NOT NULL)',
    )
    .run();
  await db
    .prepare(
      'CREATE TABLE IF NOT EXISTS member_links (user_id TEXT NOT NULL,club TEXT NOT NULL,player_id TEXT,name TEXT NOT NULL,kind TEXT NOT NULL,status TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(user_id,club))',
    )
    .run();
  await db
    .prepare(
      "CREATE UNIQUE INDEX IF NOT EXISTS member_player_unique ON member_links(club,player_id) WHERE status='approved'",
    )
    .run();
  // LINE profile picture URL (from the verified ID token). Only the URL is kept;
  // browsers load the image straight from LINE's CDN. checked_at drives the weekly refresh.
  await db
    .prepare(
      'CREATE TABLE IF NOT EXISTS member_pictures (user_id TEXT PRIMARY KEY,url TEXT,checked_at INTEGER NOT NULL)',
    )
    .run();
  // LINE accounts the organizer marked as admins: same rights as the ADMIN_KEY login.
  await db
    .prepare(
      'CREATE TABLE IF NOT EXISTS member_admins (user_id TEXT PRIMARY KEY,granted_at TEXT NOT NULL)',
    )
    .run();
}

const PICTURE_PATTERN = /^https:\/\/profile\.line-scdn\.net\/[A-Za-z0-9_\-./]{1,300}$/;
const PICTURE_REFRESH_MS = 7 * 86400000;
// Anything that is not a LINE CDN picture URL is stored as "no picture".
export const linePicture = url =>
  typeof url === 'string' && PICTURE_PATTERN.test(url) && !url.includes('..') ? url : null;
async function savePicture(db, userId, url) {
  await db
    .prepare(
      'INSERT INTO member_pictures VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET url=excluded.url,checked_at=excluded.checked_at',
    )
    .bind(userId, linePicture(url), Date.now())
    .run();
}
// player id -> picture URL for the club's linked members (for rosters).
export async function memberPictures(db, club) {
  if (!db) return new Map();
  await prepareMembers(db);
  const { results } = await db
    .prepare(
      "SELECT l.player_id,p.url FROM member_links l JOIN member_pictures p ON p.user_id=l.user_id WHERE l.club=? AND l.status='approved' AND p.url IS NOT NULL",
    )
    .bind(club)
    .all();
  return new Map(results.map(r => [r.player_id, r.url]));
}
// LINE checks the ID token; we only accept one issued for our channel and still valid.
async function verifyIdToken(env, idToken) {
  const verified = await fetch('https://api.line.me/oauth2/v2.1/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ id_token: idToken, client_id: env.LINE_LOGIN_CHANNEL_ID }),
    signal: AbortSignal.timeout(10000),
  });
  if (!verified.ok) return { error: 'LINE Login หมดอายุหรือไม่ถูกต้อง กรุณาเข้าสู่ระบบใหม่' };
  const profile = await verified.json();
  if (
    profile.iss !== 'https://access.line.me' ||
    String(profile.aud) !== String(env.LINE_LOGIN_CHANNEL_ID) ||
    !Number.isFinite(profile.exp) ||
    profile.exp * 1000 <= Date.now() ||
    !/^U[a-f0-9]{32}$/.test(profile.sub)
  )
    return { error: 'LINE Login ไม่ถูกต้อง' };
  return { profile };
}
async function readJsonBody(req, max) {
  const raw = await req.text();
  if (raw.length > max) return { error: json({ error: 'ข้อมูลยาวเกินไป' }, 413) };
  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    return { error: json({ error: 'ข้อมูลไม่ถูกต้อง' }, 400) };
  }
  if (!input || typeof input !== 'object' || Array.isArray(input))
    return { error: json({ error: 'ข้อมูลไม่ถูกต้อง' }, 400) };
  return { input };
}
const csrfOK = req => {
  const csrf = cookie(req, '__Host-sena-member-csrf');
  return /^[a-f0-9]{64}$/.test(csrf) && req.headers.get('X-Member-CSRF') === csrf;
};

// True when the request carries a live LINE member session whose account is
// marked admin and is still linked to a player. Checked on every request, so
// removing the mark (or unlinking the account) takes effect immediately.
export async function memberIsAdmin(req, env) {
  if (!env.DB || !loginEnabled(env)) return false;
  const token = cookie(req, '__Host-sena-member');
  if (!/^[a-f0-9]{64}$/.test(token)) return false;
  await prepareMembers(env.DB);
  const row = await env.DB.prepare(
    "SELECT 1 AS ok FROM member_sessions s JOIN member_admins a ON a.user_id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND EXISTS(SELECT 1 FROM member_links l WHERE l.user_id=s.user_id AND l.status='approved')",
  )
    .bind(await hash(token), Date.now())
    .first();
  return Boolean(row);
}
export async function memberFor(req, env, club) {
  if (!env.DB || !loginEnabled(env)) return null;
  const token = cookie(req, '__Host-sena-member');
  if (!/^[a-f0-9]{64}$/.test(token)) return null;
  await prepareMembers(env.DB);
  const tokenHash = await hash(token);
  const session = await env.DB.prepare(
    'SELECT user_id,expires_at FROM member_sessions WHERE token_hash=? AND expires_at>?',
  )
    .bind(tokenHash, Date.now())
    .first();
  if (!session) return null;
  const otherClub = counterpartClub(club);
  const linkFor = c =>
    env.DB.prepare('SELECT player_id,name,kind,status FROM member_links WHERE user_id=? AND club=?')
      .bind(session.user_id, c)
      .first();
  // Both clubs' links are independent reads: fetch them together.
  let [link, other] = await Promise.all([linkFor(club), linkFor(otherClub)]);
  const anchor =
    link?.status === 'approved' || (link?.status === 'pending' && link.kind === 'existing')
      ? { club, link }
      : other?.status === 'approved' || (other?.status === 'pending' && other.kind === 'existing')
        ? { club: otherClub, link: other }
        : null;
  let mappingError = null;
  if (anchor && (link?.status !== 'approved' || other?.status !== 'approved'))
    try {
      await mapBoth(env.DB, session.user_id, anchor.club, anchor.link.player_id);
      link = await env.DB.prepare(
        'SELECT player_id,name,kind,status FROM member_links WHERE user_id=? AND club=?',
      )
        .bind(session.user_id, club)
        .first();
    } catch (error) {
      if (!(error instanceof MappingError)) throw error;
      mappingError = error.message;
    }
  return {
    userId: session.user_id,
    link: link || null,
    mappingError,
    session: { tokenHash, expiresAt: session.expires_at },
  };
}

async function roster(db, club) {
  const table = clubOf(club).stateTable;
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS ${table} (id INTEGER PRIMARY KEY,revision INTEGER NOT NULL,payload TEXT NOT NULL,updated_at TEXT NOT NULL)`,
    )
    .run();
  const row = await db.prepare(`SELECT revision,payload FROM ${table} WHERE id=1`).first();
  return {
    row,
    table,
    state: row
      ? JSON.parse(row.payload)
      : { players: [], selected: [], rounds: 10, locks: [], result: null, cup: null },
  };
}
export async function memberRoute(req, env, admin, club) {
  try {
    return await route(req, env, admin, club);
  } catch (error) {
    if (error instanceof MappingError) return json({ error: error.message }, 409);
    throw error;
  }
}
async function route(req, env, admin, club) {
  if (!env.DB) return json({ error: 'ระบบสมาชิกยังไม่พร้อม' }, 503);
  if (!['GET', 'POST'].includes(req.method)) return json({ error: 'Method not allowed' }, 405);
  await prepareMembers(env.DB);
  const url = new URL(req.url),
    action = url.pathname.split('/').at(-1);
  if (req.method === 'GET' && action === 'member') {
    const member = await memberFor(req, env, club),
      csrf = random(),
      headers = new Headers({
        'Cache-Control': 'no-store',
        'Referrer-Policy': 'no-referrer',
      });
    headers.append(
      'Set-Cookie',
      '__Host-sena-member-csrf=' +
        csrf +
        '; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=600',
    );
    if (member && member.session.expiresAt - Date.now() < SESSION_MS - RENEW_AFTER_MS) {
      const renewed = await env.DB.prepare(
        'UPDATE member_sessions SET expires_at=? WHERE token_hash=? AND expires_at>?',
      )
        .bind(Date.now() + SESSION_MS, member.session.tokenHash, Date.now())
        .run();
      if (renewed.meta.changes === 1)
        headers.append('Set-Cookie', sessionCookie(cookie(req, '__Host-sena-member')));
    }
    // Ask the LIFF page for a fresh ID token when the picture is missing or a week old.
    let refreshPicture = false;
    if (member?.link?.status === 'approved') {
      const pic = await env.DB.prepare('SELECT checked_at FROM member_pictures WHERE user_id=?')
        .bind(member.userId)
        .first();
      refreshPicture = !pic || pic.checked_at < Date.now() - PICTURE_REFRESH_MS;
    }
    return Response.json(
      {
        enabled: loginEnabled(env),
        refreshPicture,
        requireLogin: memberMode(env),
        configured: Boolean(env.LINE_LIFF_ID && env.LINE_LOGIN_CHANNEL_ID),
        liffId: env.LINE_LIFF_ID || null,
        csrf,
        loggedIn: Boolean(member),
        mappingError: member?.mappingError || null,
        link: member?.link || null,
      },
      { headers },
    );
  }
  if (req.method === 'GET' && action === 'choices') {
    const member = await memberFor(req, env, club);
    if (!member) return json({ error: 'กรุณาเข้าสู่ระบบ LINE' }, 401);
    if (member.link?.status === 'approved') return json({ players: [], linked: true });
    const states = {},
      taken = {};
    for (const c of CLUB_IDS) {
      states[c] = (await roster(env.DB, c)).state;
      const rows = await env.DB.prepare(
        "SELECT player_id FROM member_links WHERE club=? AND status='approved' AND user_id<>?",
      )
        .bind(c, member.userId)
        .all();
      taken[c] = new Set(rows.results.map(r => r.player_id));
    }
    const names = new Set(),
      players = [];
    for (const c of [club, counterpartClub(club)])
      for (const p of states[c].players) {
        const key = p.name.normalize('NFC').trim().toLowerCase();
        if (names.has(key)) continue;
        const blocked = CLUB_IDS.some(v =>
          states[v].players.some(
            x => x.name.normalize('NFC').trim().toLowerCase() === key && taken[v].has(x.id),
          ),
        );
        if (blocked) continue;
        names.add(key);
        players.push({ id: p.id, name: p.name, club: c });
      }
    return json({ players });
  }
  if (req.method === 'GET' && action === 'admins') {
    if (!admin) return json({ error: 'กรุณาเข้าสู่ระบบผู้จัด' }, 401);
    const rows = await env.DB.prepare(
      "SELECT l.player_id,l.user_id,p.line_name,(a.user_id IS NOT NULL) AS admin FROM member_links l LEFT JOIN member_profiles p ON p.user_id=l.user_id LEFT JOIN member_admins a ON a.user_id=l.user_id WHERE l.club=? AND l.status='approved'",
    )
      .bind(club)
      .all();
    return json({
      players: rows.results.map(r => ({
        playerId: r.player_id,
        userId: r.user_id,
        lineName: r.line_name || '',
        admin: Boolean(r.admin),
      })),
    });
  }
  if (req.method === 'GET' && action === 'requests') {
    if (!admin) return json({ error: 'กรุณาเข้าสู่ระบบผู้จัด' }, 401);
    const rows = await env.DB.prepare(
      'SELECT l.user_id,l.player_id,l.name,l.kind,l.status,l.created_at,p.line_name FROM member_links l LEFT JOIN member_profiles p ON p.user_id=l.user_id WHERE l.club=? ORDER BY l.created_at DESC',
    )
      .bind(club)
      .all();
    const { state } = await roster(env.DB, club);
    return json({
      requests: rows.results.map(r => ({
        ...r,
        name: state.players.find(p => p.id === r.player_id)?.name || r.name,
      })),
      players: state.players.map(({ id, name }) => ({ id, name })),
    });
  }
  if (req.method === 'POST' && action === 'login') {
    if (!loginEnabled(env) || !env.LINE_LIFF_ID || !env.LINE_LOGIN_CHANNEL_ID)
      return json({ error: 'ยังไม่ได้เปิด LINE Login' }, 503);
    if (!csrfOK(req)) return json({ error: 'กรุณาโหลดหน้าเข้าสู่ระบบใหม่' }, 403);
    const body = await readJsonBody(req, 12000);
    if (body.error) return body.error;
    const { input } = body;
    if (typeof input.idToken !== 'string' || input.idToken.length > 10000)
      return json({ error: 'ไม่พบหลักฐาน LINE Login' }, 400);
    const { profile, error } = await verifyIdToken(env, input.idToken);
    if (error) return json({ error }, 401);
    await savePicture(env.DB, profile.sub, profile.picture);
    await env.DB.prepare(
      'INSERT INTO member_profiles VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET line_name=excluded.line_name',
    )
      .bind(profile.sub, typeof profile.name === 'string' ? profile.name.slice(0, 200) : '')
      .run();
    const old = cookie(req, '__Host-sena-member');
    if (/^[a-f0-9]{64}$/.test(old))
      await env.DB.prepare('DELETE FROM member_sessions WHERE token_hash=?')
        .bind(await hash(old))
        .run();
    await env.DB.prepare('DELETE FROM member_sessions WHERE expires_at<=?').bind(Date.now()).run();
    const token = random();
    await env.DB.prepare('INSERT INTO member_sessions VALUES(?,?,?)')
      .bind(await hash(token), profile.sub, Date.now() + SESSION_MS)
      .run();
    return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie(token) });
  }
  const member = await memberFor(req, env, club);
  // Weekly picture refresh from the LIFF page: a fresh, LINE-verified ID token of
  // the same account that owns this session.
  if (req.method === 'POST' && action === 'picture') {
    if (!member) return json({ error: 'กรุณาเข้าสู่ระบบ LINE' }, 401);
    if (!csrfOK(req)) return json({ error: 'กรุณาโหลดหน้าใหม่' }, 403);
    const body = await readJsonBody(req, 12000);
    if (body.error) return body.error;
    if (typeof body.input.idToken !== 'string' || body.input.idToken.length > 10000)
      return json({ error: 'ไม่พบหลักฐาน LINE Login' }, 400);
    const { profile, error } = await verifyIdToken(env, body.input.idToken);
    if (error) return json({ error }, 401);
    if (profile.sub !== member.userId) return json({ error: 'บัญชี LINE ไม่ตรงกัน' }, 403);
    await savePicture(env.DB, member.userId, profile.picture);
    return json({ ok: true });
  }
  if (req.method === 'POST' && action === 'logout') {
    await env.DB.prepare('DELETE FROM member_sessions WHERE token_hash=?')
      .bind(await hash(cookie(req, '__Host-sena-member')))
      .run();
    return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie('') });
  }
  if (req.method === 'GET' && action === 'bills') {
    if (!member) return json({ error: 'กรุณาเข้าสู่ระบบ LINE' }, 401);
    if (member.link?.status !== 'approved') return json({ bills: [] });
    const exists = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='bills'",
    ).first();
    if (!exists) return json({ bills: [] });
    const rows = await env.DB.prepare(
      'SELECT id,payload,session_date,slips_removed FROM bills WHERE club=? ORDER BY session_date DESC LIMIT 200',
    )
      .bind(club)
      .all();
    const bills = [];
    for (const row of rows.results) {
      if (url.searchParams.has('bill') && url.searchParams.get('bill') !== row.id) continue;
      const bill = JSON.parse(row.payload);
      if (bill.cancelled) continue;
      for (const p of bill.payers)
        if (p.payerKey === 'member:' + member.link.player_id) {
          const link = new URL('/billing.html', req.url);
          link.searchParams.set('bill', row.id);
          link.searchParams.set('club', club);
          link.hash = 'pay=' + p.token;
          bills.push({
            id: row.id,
            date: row.session_date.slice(0, 10),
            name: p.name,
            amount: p.amount,
            status: p.status,
            ...(p.method ? { method: p.method } : {}),
            hasSlip: Boolean(p.slipKey) && !row.slips_removed,
            url: link.href,
          });
        }
    }
    return json({ bills });
  }
  if (req.method !== 'POST') return json({ error: 'Not found' }, 404);
  const raw = await req.text();
  if (raw.length > 6000) return json({ error: 'ข้อมูลยาวเกินไป' }, 413);
  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    return json({ error: 'ข้อมูลไม่ถูกต้อง' }, 400);
  }
  if (!input || typeof input !== 'object' || Array.isArray(input))
    return json({ error: 'ข้อมูลไม่ถูกต้อง' }, 400);
  if (action === 'admin') {
    if (!admin) return json({ error: 'กรุณาเข้าสู่ระบบผู้จัด' }, 401);
    if (typeof input.userId !== 'string' || !/^U[a-f0-9]{32}$/.test(input.userId))
      return json({ error: 'เลือกบัญชี LINE ที่ผูกไว้' }, 400);
    if (typeof input.admin !== 'boolean') return json({ error: 'ข้อมูลไม่ถูกต้อง' }, 400);
    if (input.admin) {
      const linked = await env.DB.prepare(
        "SELECT 1 FROM member_links WHERE user_id=? AND status='approved'",
      )
        .bind(input.userId)
        .first();
      if (!linked) return json({ error: 'ต้องผูกบัญชี LINE กับชื่อผู้เล่นก่อน' }, 409);
      await env.DB.prepare('INSERT OR IGNORE INTO member_admins VALUES(?,?)')
        .bind(input.userId, new Date().toISOString())
        .run();
    } else
      await env.DB.prepare('DELETE FROM member_admins WHERE user_id=?').bind(input.userId).run();
    return json({ ok: true, admin: input.admin });
  }
  if (action === 'link') {
    if (!member) return json({ error: 'กรุณาเข้าสู่ระบบ LINE' }, 401);
    if (input.newMember !== undefined) {
      const name = String(input.newMember?.name ?? '')
          .normalize('NFC')
          .replace(/\s+/g, ' ')
          .trim(),
        gender = input.newMember?.gender;
      if (!name || name.length > 30 || /[\u0000-\u001f<>]/.test(name))
        return json({ error: 'กรุณาใส่ชื่อเล่นในก๊วน ไม่เกิน 30 ตัวอักษร' }, 400);
      if (!['M', 'F'].includes(gender)) return json({ error: 'กรุณาเลือกเพศ' }, 400);
      const profile = await env.DB.prepare('SELECT line_name FROM member_profiles WHERE user_id=?')
        .bind(member.userId)
        .first();
      await mapBoth(env.DB, member.userId, club, null, {
        create: {
          name,
          gender,
          lv: NEW_MEMBER_LV,
          lineName: String(profile?.line_name || '').slice(0, 60),
        },
      });
      return json({ ok: true });
    }
    const sourceClub = input.sourceClub ?? club;
    if (!isClub(sourceClub)) return json({ error: 'สนามไม่ถูกต้อง' }, 400);
    const { state } = await roster(env.DB, sourceClub),
      player = state.players.find(p => p.id === input.playerId);
    if (!player || input.name !== undefined)
      return json({ error: 'ช่วงเก็บตกให้เลือกชื่อผู้เล่นเดิมเท่านั้น' }, 400);
    await mapBoth(env.DB, member.userId, sourceClub, player.id);
    return json({ ok: true });
  }
  if (['reassign', 'revoke', 'unlink'].includes(action)) {
    if (!admin) return json({ error: 'กรุณาเข้าสู่ระบบผู้จัด' }, 401);
    if (
      typeof input.previousStatus !== 'string' ||
      !(input.previousPlayerId === null || typeof input.previousPlayerId === 'string')
    )
      return json({ error: 'กรุณาโหลดการแมพล่าสุดก่อนแก้ไข' }, 400);
  }
  if (action === 'reassign') {
    if (typeof input.userId !== 'string' || !/^U[a-f0-9]{32}$/.test(input.userId))
      return json({ error: 'เลือกบัญชี LINE ที่มีในระบบ' }, 400);
    await mapBoth(env.DB, input.userId, club, input.playerId, {
      allowMove: true,
      expected: { playerId: input.previousPlayerId, status: input.previousStatus },
    });
    return json({ ok: true });
  }
  if (action === 'unlink' || action === 'revoke') {
    await mapBoth(env.DB, input.userId, club, null, {
      remove: true,
      expected: { playerId: input.previousPlayerId, status: input.previousStatus },
    });
    await env.DB.prepare('DELETE FROM member_admins WHERE user_id=?').bind(input.userId).run();
    return json({ ok: true });
  }
  return json({ error: 'Not found' }, 404);
}
