// คิวสนาม (court queue) API: GET /api/queue, POST /api/queue (organizers only).
// One live queue per club, stored as { state, undo } JSON with a revision. Every POST is an
// intent ("start court 2"); the Worker applies it with public/queue-engine.js so all devices
// see the same result. Stale revisions get 409 + the current queue (no silent retry: the
// organizer pressed the button on an older picture of the courts).
import './public/queue-engine.js';
import { clubOf } from './clubs.js';
import { bangkokDate } from './booking.js';

const Q = globalThis.SenaQueue;
const UNDO_SIZE = 10;
// Same default level booking.js uses for guests.
const GUEST_LEVEL = 6.5;
const reply = (v, status = 200) =>
  Response.json(v, { status, headers: { 'Cache-Control': 'no-store' } });
class QueueRouteError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}
const fail = (message, status = 400) => {
  throw new QueueRouteError(message, status);
};

async function prepare(DB) {
  // schema-cache.js skips this after the first success in an isolate.
  await DB.prepare(
    'CREATE TABLE IF NOT EXISTS court_queue (club TEXT PRIMARY KEY, revision INTEGER NOT NULL, payload TEXT NOT NULL, updated_at TEXT NOT NULL)',
  ).run();
}
async function roster(DB, club) {
  const table = clubOf(club).stateTable;
  try {
    const row = await DB.prepare(`SELECT payload FROM ${table} WHERE id=1`).first();
    return row ? JSON.parse(row.payload).players || [] : [];
  } catch {
    return [];
  }
}
// Today's booked players (ตัวจริง only, in booking order) and the session's court numbers.
async function todaySession(DB, club, players, now) {
  let row = null;
  try {
    row = await DB.prepare('SELECT payload FROM booking_clubs WHERE club=?').bind(club).first();
  } catch {
    return null;
  }
  if (!row) return null;
  const doc = JSON.parse(row.payload),
    today = bangkokDate(now);
  const s = (doc.sessions || []).find(x => x.date === today && !x.skipped);
  if (!s) return null;
  const byId = new Map(players.map(p => [p.id, p]));
  const hosts = new Set(
    s.registrations.filter(r => !r.guest && byId.has(r.playerId)).map(r => r.playerId),
  );
  const booked = s.registrations
    .filter(r => (r.guest ? hosts.has(r.guest.hostId) : hosts.has(r.playerId)))
    .slice(0, s.capacity)
    .map(r =>
      r.guest
        ? { id: r.playerId, name: r.guest.name, g: r.guest.gender, lv: GUEST_LEVEL, guest: true }
        : (p => ({ id: p.id, name: p.name, g: p.gender, lv: p.lv }))(byId.get(r.playerId)),
    );
  const courtNumbers = String(s.courtNumbers ?? doc.settings?.courtNumbers ?? '')
    .split(',')
    .map(x => x.trim())
    .filter(Boolean);
  return { date: s.date, start: s.start, end: s.end, booked, courtNumbers };
}
async function read(DB, club) {
  const row = await DB.prepare('SELECT revision,payload,updated_at FROM court_queue WHERE club=?')
    .bind(club)
    .first();
  return row
    ? { revision: row.revision, updatedAt: row.updated_at, ...JSON.parse(row.payload) }
    : { revision: 0, updatedAt: null, state: null, undo: [] };
}
async function write(DB, club, revision, payload, now) {
  const text = JSON.stringify(payload),
    at = now.toISOString();
  const done =
    revision === 0
      ? await DB.prepare(
          'INSERT OR IGNORE INTO court_queue (club,revision,payload,updated_at) VALUES (?,1,?,?) RETURNING revision',
        )
          .bind(club, text, at)
          .first()
      : await DB.prepare(
          'UPDATE court_queue SET payload=?,revision=revision+1,updated_at=? WHERE club=? AND revision=? RETURNING revision',
        )
          .bind(text, at, club, revision)
          .first();
  return done ? done.revision : null;
}
function cleanName(value) {
  if (typeof value !== 'string' || value.length > 80) fail('ชื่อไม่ถูกต้อง');
  const name = value.normalize('NFC').trim().replace(/\s+/g, ' ');
  if (!name || name.length > 40 || /[\p{Cc}\p{Cf}]/u.test(name)) fail('ชื่อไม่ถูกต้อง');
  return name;
}
function walkIn(input) {
  if (!input || typeof input !== 'object') fail('ข้อมูลผู้เล่นไม่ถูกต้อง');
  if (!['M', 'F'].includes(input.g)) fail('กรุณาเลือกเพศ');
  if (!Number.isFinite(input.lv) || input.lv < 0 || input.lv > 100) fail('Lv ไม่ถูกต้อง');
  return { id: 'w:' + crypto.randomUUID(), name: cleanName(input.name), lv: input.lv, g: input.g };
}
const view = (data, admin, extra = {}) => ({
  state: admin ? data.state : Q.publicView(data.state),
  revision: data.revision,
  updatedAt: data.updatedAt,
  canUndo: admin ? data.undo.length > 0 : false,
  canEdit: admin,
  ...extra,
});

export async function queueRoute(req, env, admin, club, now = new Date()) {
  try {
    if (!env.DB) fail('ยังไม่ได้ผูกฐานข้อมูล DB', 503);
    if (!['GET', 'POST'].includes(req.method)) fail('Method not allowed', 405);
    await prepare(env.DB);
    if (req.method === 'GET') {
      const data = await read(env.DB, club);
      if (!admin) return reply(view(data, false));
      // Organizers also get today's booking list and the roster, to start or add players.
      const players = await roster(env.DB, club);
      return reply(
        view(data, true, {
          session: await todaySession(env.DB, club, players, now),
          roster: players.map(p => ({ id: p.id, name: p.name, g: p.gender, lv: p.lv })),
        }),
      );
    }
    if (!admin) fail('กรุณาเข้าสู่ระบบผู้จัด', 401);
    const text = await req.text();
    if (text.length > 20000) fail('ข้อมูลยาวเกินไป');
    let input;
    try {
      input = JSON.parse(text);
    } catch {
      fail('ข้อมูลไม่ถูกต้อง');
    }
    if (!input || typeof input !== 'object' || typeof input.action !== 'string')
      fail('ข้อมูลไม่ถูกต้อง');
    if (!Number.isInteger(input.revision) || input.revision < 0) fail('ข้อมูลไม่ถูกต้อง');
    const data = await read(env.DB, club);
    if (data.revision !== input.revision)
      return reply(
        {
          error: 'มีการเปลี่ยนแปลงจากอีกเครื่อง โหลดคิวล่าสุดให้แล้ว ลองกดอีกครั้ง',
          ...view(data, true),
        },
        409,
      );
    const t = +now;
    let state = data.state,
      undo = data.undo || [],
      message;
    const remember = () => {
      undo = [JSON.stringify(state), ...undo].slice(0, UNDO_SIZE);
    };
    if (input.action === 'start') {
      // ids: roster ids and/or today's booked guest ids; extra: walk-ins typed by hand.
      const players = await roster(env.DB, club),
        session = await todaySession(env.DB, club, players, now);
      if (!Array.isArray(input.ids) || input.ids.length > Q.MAX_PLAYERS) fail('รายชื่อไม่ถูกต้อง');
      const extra = Array.isArray(input.extra) ? input.extra : [];
      if (extra.length > Q.MAX_PLAYERS) fail('รายชื่อไม่ถูกต้อง');
      const known = new Map(
        players.map(p => [p.id, { id: p.id, name: p.name, g: p.gender, lv: p.lv }]),
      );
      for (const b of session?.booked || []) if (b.guest) known.set(b.id, b);
      const chosen = [...new Set(input.ids)].map(id => {
        const p = typeof id === 'string' && known.get(id);
        if (!p) fail('รายชื่อเปลี่ยนแล้ว กรุณาโหลดหน้าใหม่', 409);
        return { id: p.id, name: p.name, g: p.g, lv: p.lv };
      });
      const all = chosen.concat(extra.map(walkIn));
      const courts = input.courts == null ? undefined : input.courts;
      if (courts !== undefined && !Number.isInteger(courts)) fail('จำนวนคอร์ตไม่ถูกต้อง');
      if (state) remember();
      state = Q.create(all, courts, t, Math.random, session?.courtNumbers || []);
      message = 'เริ่มคิว ' + all.length + ' คน ' + state.courts.length + ' คอร์ต';
    } else if (input.action === 'end') {
      if (!state) fail('ยังไม่ได้เริ่มคิว');
      remember();
      state = null;
      message = 'ปิดคิววันนี้แล้ว';
    } else if (input.action === 'undo') {
      if (!undo.length) fail('ไม่มีอะไรให้ย้อนกลับ');
      state = JSON.parse(undo[0]);
      undo = undo.slice(1);
      message = 'ย้อนกลับแล้ว';
    } else {
      if (!state) fail('ยังไม่ได้เริ่มคิว');
      let player = null;
      if (input.action === 'add') {
        if (typeof input.pid === 'string') {
          if (Object.hasOwn(state.players, input.pid)) player = state.players[input.pid];
          else {
            const p = (await roster(env.DB, club)).find(x => x.id === input.pid);
            if (!p) fail('ไม่พบผู้เล่นในก๊วน');
            player = { id: p.id, name: p.name, g: p.gender, lv: p.lv };
          }
        } else player = walkIn(input.player);
      }
      const before = JSON.stringify(state);
      const next = JSON.parse(before);
      message = Q.apply(next, input, { now: t, player });
      undo = [before, ...undo].slice(0, UNDO_SIZE);
      state = next;
    }
    const revision = await write(env.DB, club, data.revision, { state, undo }, now);
    if (revision == null) {
      const fresh = await read(env.DB, club);
      return reply(
        {
          error: 'มีการเปลี่ยนแปลงจากอีกเครื่อง โหลดคิวล่าสุดให้แล้ว ลองกดอีกครั้ง',
          ...view(fresh, true),
        },
        409,
      );
    }
    return reply({
      message,
      ...view({ state, undo, revision, updatedAt: now.toISOString() }, true),
    });
  } catch (error) {
    if (error instanceof QueueRouteError) return reply({ error: error.message }, error.status);
    if (error instanceof Q.QueueError) return reply({ error: error.message }, 400);
    throw error;
  }
}
