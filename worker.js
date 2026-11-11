// Includes the direct LINE tagtest command for production diagnosis.
import { memberRoute, memberFor, memberMode } from './member.js';
import { billingRoute, prunePaidSlips, billIdFromCode } from './billing.js';
import { lineAdmin, lineWebhook } from './line.js';
import { bookingRoute, scheduledBookings } from './booking.js';
import { backupsRoute, prepareBackups } from './backups.js';
import { leaderboardRoute } from './leaderboard.js';
import './public/engine.js';
import seed from './seed.json' with { type: 'json' };
const enc = new TextEncoder();
const json = (data, status = 200, headers = {}) =>
  Response.json(data, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
const ready = env => typeof env.ADMIN_KEY === 'string' && env.ADMIN_KEY.length >= 7;
async function digest(s) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(s)));
}
async function equal(a, b) {
  const [x, y] = await Promise.all([digest(a), digest(b)]);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}
async function sign(value, key) {
  const k = await crypto.subtle.importKey(
    'raw',
    enc.encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return Array.from(new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(value))))
    .map(x => x.toString(16).padStart(2, '0'))
    .join('');
}
async function sessionSignature(exp, env, initialize = false) {
  if (initialize) {
    await env.DB.prepare(
      'CREATE TABLE IF NOT EXISTS session_signing (id INTEGER PRIMARY KEY, secret TEXT NOT NULL)',
    ).run();
    await env.DB.prepare(
      'INSERT OR IGNORE INTO session_signing (id,secret) VALUES (1,lower(hex(randomblob(32))))',
    ).run();
  }
  const row = await env.DB.prepare('SELECT secret FROM session_signing WHERE id=1').first();
  if (!row?.secret) throw Error('Missing session signing key');
  return sign(JSON.stringify([exp, env.ADMIN_KEY]), row.secret);
}
export async function authorized(req, env) {
  if (!ready(env) || !env.DB) return false;
  const token = (req.headers.get('Cookie') || '')
    .split(';')
    .map(s => s.trim())
    .find(s => s.startsWith('__Host-sena='))
    ?.slice(12);
  if (!token) return false;
  const [exp, sig] = token.split('.');
  if (!/^\d+$/.test(exp) || Number(exp) <= Date.now() || Number(exp) > Date.now() + 28800000)
    return false;
  if (!/^[0-9a-f]{64}$/.test(sig || '')) return false;
  try {
    return await equal(sig, await sessionSignature(exp, env));
  } catch {
    return false;
  }
}
const cookie = value =>
  '__Host-sena=' + value + '; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=28800';
const originOK = req => req.headers.get('Origin') === new URL(req.url).origin;
export function valid(s) {
  if (
    !s ||
    !Array.isArray(s.players) ||
    s.players.length > 200 ||
    !s.players.every(
      p =>
        p &&
        typeof p.id === 'string' &&
        typeof p.name === 'string' &&
        p.name.trim() &&
        p.name.length <= 100 &&
        typeof p.thai === 'string' &&
        Number.isFinite(p.lv) &&
        p.lv >= 0 &&
        p.lv <= 100 &&
        ['M', 'F'].includes(p.gender),
    )
  )
    return false;
  const ids = new Set(s.players.map(p => p.id));
  if (
    ids.size !== s.players.length ||
    !Array.isArray(s.selected) ||
    !s.selected.every(id => ids.has(id)) ||
    !Number.isInteger(s.rounds) ||
    s.rounds < 1 ||
    s.rounds > 30 ||
    !Array.isArray(s.locks)
  )
    return false;
  if (
    s.result &&
    (!Array.isArray(s.result.schedule) ||
      !s.result.schedule.every(
        m => Array.isArray(m.ids) && m.ids.length === 4 && m.ids.every(id => ids.has(id)),
      ) ||
      !s.result.counts ||
      !Object.keys(s.result.counts).every(id => ids.has(id)))
  )
    return false;
  if (
    s.cup &&
    (!Array.isArray(s.cup.teams) ||
      s.cup.teams.length > 20 ||
      !s.cup.teams.every(
        t =>
          Array.isArray(t) &&
          t.length === 2 &&
          t.every(n => typeof n === 'string' && n.length <= 100),
      ) ||
      !Array.isArray(s.cup.matches) ||
      !s.cup.matches.every(
        m =>
          Number.isInteger(m.a) &&
          m.a >= 0 &&
          m.a < s.cup.teams.length &&
          Number.isInteger(m.b) &&
          m.b >= 0 &&
          m.b < s.cup.teams.length &&
          ['sa', 'sb'].every(
            k => m[k] === '' || (Number.isInteger(m[k]) && m[k] >= 0 && m[k] <= 999),
          ),
      ))
  )
    return false;
  return true;
}
async function body(req, max) {
  const text = await req.text();
  if (text.length > max) throw Error('body too large');
  return JSON.parse(text);
}
export function guestState(state) {
  return {
    players: state.players.map(({ id, name, thai, gender }) => ({ id, name, thai, gender })),
    selected: state.selected,
    rounds: state.rounds,
    locks: state.locks,
    result: state.result ? guestResult(state.result) : null,
    cup: state.cup,
  };
}
function guestResult(result) {
  return {
    schedule: result.schedule.map(({ round, ids, locked }) => ({ round, ids, locked })),
    counts: result.counts,
  };
}
export default {
  async scheduled(event, env, ctx) {
    if (event.cron === '0 18 * * *') {
      ctx.waitUntil(scheduledBookings(env));
      ctx.waitUntil(prunePaidSlips(env));
    }
  },
  async fetch(req, env) {
    const url = new URL(req.url),
      path = url.pathname;
    try {
      // Preserve the exact LIFF endpoint; Assets normally redirects .html to /liff.
      if (path === '/liff.html') {
        const target = new URL(req.url);
        target.pathname = '/liff';
        return env.ASSETS.fetch(new Request(target, req));
      }
      if (path.startsWith('/b/')) {
        if (!['GET', 'HEAD'].includes(req.method))
          return json({ error: 'Method not allowed' }, 405);
        const id = billIdFromCode(path.slice(3));
        if (!id) return json({ error: 'ไม่พบลิงก์บิล' }, 404);
        return Response.redirect(new URL('/billing.html?bill=' + id, url.origin).href, 302);
      }
      const club = url.searchParams.get('club') || 'sena';
      if (!['sena', '88'].includes(club)) return json({ error: 'ไม่พบก๊วนที่เลือก' }, 400);
      const stateTable = club === '88' ? 'club_state_88' : 'club_state';
      if (club === '88' && env.DB && ['/api/state', '/api/generate'].includes(path))
        await env.DB.prepare(
          'CREATE TABLE IF NOT EXISTS club_state_88 (id INTEGER PRIMARY KEY,revision INTEGER NOT NULL,payload TEXT NOT NULL,updated_at TEXT NOT NULL)',
        ).run();
      if (path === '/') return Response.redirect(url.origin + '/court.html', 302);
      if (path === '/api/line/webhook') return await lineWebhook(req, env);
      if (path.startsWith('/api/') && req.method !== 'GET' && !originOK(req))
        return json({ error: 'Origin ไม่ถูกต้อง' }, 403);
      if (path === '/api/session')
        return req.method === 'GET'
          ? json({ canEdit: await authorized(req, env) })
          : json({ error: 'Method not allowed' }, 405);
      if (path === '/api/line') return await lineAdmin(req, env, await authorized(req, env), club);
      if (path === '/api/billing')
        return await billingRoute(req, env, await authorized(req, env), club);
      if (path === '/api/member' || path.startsWith('/api/member/'))
        return await memberRoute(req, env, await authorized(req, env), club);
      if (path === '/api/booking')
        return await bookingRoute(
          req,
          env,
          await authorized(req, env),
          club,
          await memberFor(req, env, club),
        );
      if (path === '/api/backups')
        return await backupsRoute(req, env, await authorized(req, env), club, valid);
      if (path === '/api/leaderboard') {
        const admin = await authorized(req, env);
        if (admin && env.DB && req.method === 'POST') await prepareBackups(env.DB, club);
        return await leaderboardRoute(req, env, admin, club);
      }
      if (path === '/api/login' && req.method === 'POST') {
        if (!env.DB)
          return json({ error: 'กรุณาผูกฐานข้อมูล D1 ชื่อ DB กับ Worker ใน Production' }, 503);
        if (typeof env.ADMIN_KEY !== 'string' || !env.ADMIN_KEY)
          return json(
            {
              error:
                'Worker ยังไม่พบ ADMIN_KEY ใน Production ตรวจชื่อ Secret ให้เป็นตัวใหญ่ แล้วกด Deploy',
            },
            503,
          );
        if (!ready(env))
          return json(
            {
              error:
                'ADMIN_KEY ที่ตั้งใน Cloudflare สั้นเกินไป กรุณาตั้งรหัสอย่างน้อย 7 ตัวอักษร แล้วกด Deploy',
            },
            503,
          );
        const input = await body(req, 1024);
        if (typeof input.key !== 'string' || input.key.length > 256)
          return json({ error: 'ข้อมูลไม่ถูกต้อง' }, 400);
        const ip = Array.from(await digest(req.headers.get('CF-Connecting-IP') || 'unknown')).join(
            '',
          ),
          window = Math.floor(Date.now() / 900000);
        const attempt = await env.DB.prepare(
          'INSERT INTO login_attempts (ip,window,attempts) VALUES (?,?,1) ON CONFLICT(ip) DO UPDATE SET window=excluded.window, attempts=CASE WHEN login_attempts.window=excluded.window THEN login_attempts.attempts+1 ELSE 1 END RETURNING attempts',
        )
          .bind(ip, window)
          .first();
        if (attempt.attempts > 10)
          return json({ error: 'ลองหลายครั้งเกินไป กรุณารอ 15 นาที' }, 429, {
            'Retry-After': '900',
          });
        if (!(await equal(input.key, env.ADMIN_KEY)))
          return json({ error: 'รหัสผู้จัดไม่ถูกต้อง' }, 401);
        const exp = String(Date.now() + 28800000);
        return json({ ok: true }, 200, {
          'Set-Cookie': cookie(exp + '.' + (await sessionSignature(exp, env, true))),
        });
      }
      if (path === '/api/logout' && req.method === 'POST')
        return json({ ok: true }, 200, {
          'Set-Cookie': '__Host-sena=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0',
        });
      if (path === '/api/generate' && req.method === 'POST') {
        if (
          memberMode(env) &&
          !(await authorized(req, env)) &&
          (await memberFor(req, env, club))?.link?.status !== 'approved'
        )
          return json({ error: 'กรุณาเข้าสู่ระบบ LINE และผูกชื่อก่อน' }, 401);
        if (!env.DB) return json({ error: 'ยังไม่ได้ตั้งค่าฐานข้อมูล' }, 503);
        const input = await body(req, 10000);
        if (
          !Array.isArray(input.selected) ||
          input.selected.length > 24 ||
          new Set(input.selected).size !== input.selected.length ||
          !Number.isInteger(input.rounds) ||
          input.rounds < 1 ||
          input.rounds > 30 ||
          !Array.isArray(input.locks) ||
          input.locks.length > 30 ||
          !input.locks.every(
            l => l && Number.isInteger(l.round) && Array.isArray(l.ids) && l.ids.length === 4,
          )
        )
          return json({ error: 'ข้อมูลจัดคู่ไม่ถูกต้อง' }, 400);
        const row = await env.DB.prepare(`SELECT payload FROM ${stateTable} WHERE id=1`).first();
        const roster = row ? JSON.parse(row.payload) : seed;
        const players = roster.players.filter(p => input.selected.includes(p.id));
        if (players.length !== input.selected.length)
          return json({ error: 'รายชื่อเปลี่ยนแล้ว กรุณาโหลดข้อมูลกลางใหม่' }, 409);
        try {
          return json({
            result: guestResult(
              globalThis.Sena.generate(players, input.rounds, input.locks, 3, 60),
            ),
          });
        } catch {
          return json({ error: 'จัดคู่ตามเงื่อนไขนี้ไม่ได้ กรุณาตรวจจำนวนคนและคู่ล็อก' }, 400);
        }
      }
      if (path === '/api/state') {
        const canEdit = await authorized(req, env);
        if (req.method === 'GET') {
          if (!env.DB)
            return json({
              state: guestState(seed),
              revision: 0,
              updatedAt: null,
              canEdit: false,
              setupRequired: true,
            });
          const row = await env.DB.prepare(
            `SELECT revision,payload,updated_at FROM ${stateTable} WHERE id=1`,
          ).first();
          return json({
            state: canEdit
              ? row
                ? JSON.parse(row.payload)
                : seed
              : guestState(row ? JSON.parse(row.payload) : seed),
            revision: row?.revision || 0,
            updatedAt: row?.updated_at || null,
            canEdit,
          });
        }
        if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
        if (!canEdit) return json({ error: 'กรุณาเข้าสู่ระบบผู้จัด' }, 401);
        if (!env.DB) return json({ error: 'ยังไม่ได้ผูก DB' }, 503);
        const input = await body(req, 500000);
        if (!valid(input.state) || !Number.isInteger(input.revision) || input.revision < 0)
          return json({ error: 'ข้อมูลไม่ถูกต้อง' }, 400);
        await prepareBackups(env.DB, club);
        const now = new Date().toISOString(),
          payload = JSON.stringify(input.state);
        const r =
          input.revision === 0
            ? await env.DB.prepare(
                `INSERT OR IGNORE INTO ${stateTable} (id,revision,payload,updated_at) VALUES (1,1,?,?)`,
              )
                .bind(payload, now)
                .run()
            : await env.DB.prepare(
                `UPDATE ${stateTable} SET payload=?,revision=revision+1,updated_at=? WHERE id=1 AND revision=?`,
              )
                .bind(payload, now, input.revision)
                .run();
        if (r.meta.changes !== 1)
          return json(
            { error: 'มีข้อมูลใหม่จากอีกเครื่อง กรุณาสำรองข้อมูลแล้วโหลดข้อมูลกลางใหม่' },
            409,
          );
        return json({ revision: input.revision + 1, updatedAt: now });
      }
      if (path.startsWith('/api/')) return json({ error: 'Not found' }, 404);
      return env.ASSETS.fetch(req);
    } catch {
      return json(
        {
          error:
            'ยังใช้บริการนี้ไม่ได้ ตรวจการตั้งค่า D1 และรัน schema.sql ก่อน หรือทดลองใหม่อีกครั้ง',
        },
        503,
      );
    }
  },
};
