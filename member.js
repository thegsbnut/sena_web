import { clubOf, counterpartClub, CLUB_IDS, DEFAULT_CLUB, isClub } from './clubs.js';
import { mapBoth, MappingError } from './member-shared.js';
import { prepareBills } from './billing.js';
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
  // LINE accounts the organizer marked as admins: same rights as the ADMIN_KEY login.
  await db
    .prepare(
      'CREATE TABLE IF NOT EXISTS member_admins (user_id TEXT PRIMARY KEY,granted_at TEXT NOT NULL)',
    )
    .run();
}

// One round trip per request for everything the auth checks need: the live
// session, whether its account is marked admin, and its links in both clubs.
// Several routes ask more than once (organizer check, then the member itself),
// so the lookup is cached per request.
const sessionCache = new WeakMap();
function memberSession(req, env) {
  if (!sessionCache.has(req))
    sessionCache.set(
      req,
      (async () => {
        if (!env.DB || !loginEnabled(env)) return null;
        const token = cookie(req, '__Host-sena-member');
        if (!/^[a-f0-9]{64}$/.test(token)) return null;
        await prepareMembers(env.DB);
        const tokenHash = await hash(token);
        const { results } = await env.DB.prepare(
          'SELECT s.user_id,s.expires_at,EXISTS(SELECT 1 FROM member_admins a WHERE a.user_id=s.user_id) AS marked,l.club,l.player_id,l.name,l.kind,l.status FROM member_sessions s LEFT JOIN member_links l ON l.user_id=s.user_id WHERE s.token_hash=? AND s.expires_at>?',
        )
          .bind(tokenHash, Date.now())
          .all();
        if (!results.length) return null;
        const links = new Map(
          results
            .filter(r => r.club != null)
            .map(({ club, player_id, name, kind, status }) => [
              club,
              { player_id, name, kind, status },
            ]),
        );
        return {
          userId: results[0].user_id,
          expiresAt: results[0].expires_at,
          tokenHash,
          links,
          // Admin rights need the mark and an account still linked to a player.
          admin:
            Boolean(results[0].marked) && [...links.values()].some(l => l.status === 'approved'),
        };
      })(),
    );
  return sessionCache.get(req);
}

// True when the request carries a live LINE member session whose account is
// marked admin and is still linked to a player. Checked on every request, so
// removing the mark (or unlinking the account) takes effect immediately.
export async function memberIsAdmin(req, env) {
  return Boolean((await memberSession(req, env))?.admin);
}
export async function memberFor(req, env, club) {
  const session = await memberSession(req, env);
  if (!session) return null;
  const otherClub = counterpartClub(club);
  let link = session.links.get(club) ?? null,
    other = session.links.get(otherClub) ?? null;
  const anchor =
    link?.status === 'approved' || (link?.status === 'pending' && link.kind === 'existing')
      ? { club, link }
      : other?.status === 'approved' || (other?.status === 'pending' && other.kind === 'existing')
        ? { club: otherClub, link: other }
        : null;
  let mappingError = null;
  if (anchor && (link?.status !== 'approved' || other?.status !== 'approved'))
    try {
      await mapBoth(env.DB, session.userId, anchor.club, anchor.link.player_id);
      // The cached links are stale now: later checks in this request read again.
      sessionCache.delete(req);
      link = await env.DB.prepare(
        'SELECT player_id,name,kind,status FROM member_links WHERE user_id=? AND club=?',
      )
        .bind(session.userId, club)
        .first();
    } catch (error) {
      if (!(error instanceof MappingError)) throw error;
      mappingError = error.message;
    }
  return {
    userId: session.userId,
    link: link || null,
    mappingError,
    session: { tokenHash: session.tokenHash, expiresAt: session.expiresAt },
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
    return Response.json(
      {
        enabled: loginEnabled(env),
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
    const csrf = cookie(req, '__Host-sena-member-csrf');
    if (!/^[a-f0-9]{64}$/.test(csrf) || req.headers.get('X-Member-CSRF') !== csrf)
      return json({ error: 'กรุณาโหลดหน้าเข้าสู่ระบบใหม่' }, 403);
    const raw = await req.text();
    if (raw.length > 12000) return json({ error: 'ข้อมูลยาวเกินไป' }, 413);
    let input;
    try {
      input = JSON.parse(raw);
    } catch {
      return json({ error: 'ข้อมูลไม่ถูกต้อง' }, 400);
    }
    if (!input || typeof input !== 'object' || Array.isArray(input))
      return json({ error: 'ข้อมูลไม่ถูกต้อง' }, 400);
    if (typeof input.idToken !== 'string' || input.idToken.length > 10000)
      return json({ error: 'ไม่พบหลักฐาน LINE Login' }, 400);
    const verified = await fetch('https://api.line.me/oauth2/v2.1/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ id_token: input.idToken, client_id: env.LINE_LOGIN_CHANNEL_ID }),
      signal: AbortSignal.timeout(10000),
    });
    if (!verified.ok)
      return json({ error: 'LINE Login หมดอายุหรือไม่ถูกต้อง กรุณาเข้าสู่ระบบใหม่' }, 401);
    const profile = await verified.json();
    if (
      profile.iss !== 'https://access.line.me' ||
      String(profile.aud) !== String(env.LINE_LOGIN_CHANNEL_ID) ||
      !Number.isFinite(profile.exp) ||
      profile.exp * 1000 <= Date.now() ||
      !/^U[a-f0-9]{32}$/.test(profile.sub)
    )
      return json({ error: 'LINE Login ไม่ถูกต้อง' }, 401);
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
  if (req.method === 'POST' && action === 'logout') {
    await env.DB.prepare('DELETE FROM member_sessions WHERE token_hash=?')
      .bind(await hash(cookie(req, '__Host-sena-member')))
      .run();
    return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie('') });
  }
  if (req.method === 'GET' && action === 'bills') {
    if (!member) return json({ error: 'กรุณาเข้าสู่ระบบ LINE' }, 401);
    if (member.link?.status !== 'approved') return json({ bills: [] });
    await prepareBills(env.DB);
    // Only this member's payer entries leave the database: the filter runs in
    // SQL instead of reading and parsing up to 200 whole bills per request.
    const only = url.searchParams.get('bill');
    const rows = await env.DB.prepare(
      "SELECT b.id,b.session_date,b.slips_removed,p.value AS payer FROM bills b, json_each(b.payload,'$.payers') p WHERE b.club=? AND COALESCE(json_extract(b.payload,'$.cancelled'),0)=0 AND json_extract(p.value,'$.payerKey')=?" +
        (only === null ? '' : ' AND b.id=?') +
        ' ORDER BY b.session_date DESC, p.key LIMIT 200',
    )
      .bind(club, 'member:' + member.link.player_id, ...(only === null ? [] : [only]))
      .all();
    const bills = rows.results.map(row => {
      const p = JSON.parse(row.payer);
      const link = new URL('/billing.html', req.url);
      link.searchParams.set('bill', row.id);
      link.searchParams.set('club', club);
      link.hash = 'pay=' + p.token;
      return {
        id: row.id,
        date: row.session_date.slice(0, 10),
        name: p.name,
        amount: p.amount,
        status: p.status,
        ...(p.method ? { method: p.method } : {}),
        hasSlip: Boolean(p.slipKey) && !row.slips_removed,
        url: link.href,
      };
    });
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
