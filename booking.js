import { clubOf, CLUB_IDS, DEFAULT_CLUB } from './clubs.js';
import { memberMode } from './member.js';
import { once } from './schema-cache.js';
import './public/engine.js';
import { latestCup, cupPlayerKey } from './leaderboard.js';
import { holidayOn, HOLIDAY_YEARS } from './booking-holidays.js';
import { recordAttendance, badgeData, setJobLine } from './job-badges.js';
const reply = (v, status = 200) =>
  Response.json(v, { status, headers: { 'Cache-Control': 'no-store' } });
export class BookingError extends Error {
  constructor(message, status = 400, details = {}) {
    super(message);
    this.status = status;
    this.details = details;
  }
}
const fail = (message, status = 400) => {
  throw new BookingError(message, status);
};
const defaultVenueMaps = {
  sena: 'https://maps.app.goo.gl/Krmzhw3QxseJ4thW6',
  88: 'https://maps.app.goo.gl/9AwoUgdYb4gjNw2w8',
};
const venueMapFor = (doc, club) => doc.venueMapUrl ?? defaultVenueMaps[club];
function validateVenueMap(value) {
  const link = typeof value === 'string' ? value.trim() : '';
  const url = link.length <= 2048 ? URL.parse(link) : null;
  const isMapsPath = /^\/maps(?:\/|$)/;
  if (
    !url ||
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.port ||
    !(
      (url.hostname === 'maps.app.goo.gl' && url.pathname.length > 1) ||
      url.hostname === 'maps.google.com' ||
      (['www.google.com', 'google.com', 'goo.gl'].includes(url.hostname) &&
        isMapsPath.test(url.pathname))
    )
  ) {
    fail('กรุณาใส่ลิงก์ Google Maps ที่ขึ้นต้นด้วย https://');
  }
  return url.href;
}
export const defaultSettings = () => ({
  enabled: false,
  weekdays: [2, 4],
  start: '18:00',
  end: '21:00',
  capacity: 12,
  rounds: 10,
  weeks: 4,
  cancellationNoticeHours: 48,
  courtNumbers: '',
  regularIds: [],
  holidayPolicy: 'warn',
  holidays: [],
});
export const bangkokDate = (now = new Date()) =>
  new Date(+now + 7 * 3600000).toISOString().slice(0, 10);
const addDays = (date, n) =>
  new Date(Date.parse(date + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const startsAt = s => Date.parse(s.date + 'T' + s.start + ':00+07:00');
const validDate = d =>
  typeof d === 'string' &&
  /^\d{4}-\d{2}-\d{2}$/.test(d) &&
  !Number.isNaN(Date.parse(d)) &&
  new Date(d + 'T00:00:00Z').toISOString().slice(0, 10) === d;
const validTime = t => typeof t === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
const integer = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;
const cupWeekFor = (doc, club) => doc.cupWeek ?? clubOf(club).defaultCupWeek;
const weekOfMonth = date => Math.ceil(Number(date.slice(8, 10)) / 7);
function normalizeCourtNumbers(value) {
  if (typeof value !== 'string' || value.length > 80) fail('กรอกเลขคอร์ตคั่นด้วยจุลภาค เช่น 6, 7');
  const trimmed = value.trim();
  if (!trimmed) return '';
  const numbers = trimmed.split(',').map(part => part.trim());
  if (numbers.some(number => !/^[1-9]\d{0,2}$/.test(number)))
    fail('กรอกเลขคอร์ตคั่นด้วยจุลภาค เช่น 6, 7');
  return [...new Set(numbers)].join(', ');
}
export function validateSettings(input, roster) {
  const cancellationNoticeHours = input?.cancellationNoticeHours ?? 48;
  if (!integer(cancellationNoticeHours, 0, 720))
    fail('กำหนดเวลาถอนปลอดภัยเป็นจำนวนชั่วโมงเต็ม 0–720 ชั่วโมง');
  if (
    !input ||
    typeof input.enabled !== 'boolean' ||
    !Array.isArray(input.weekdays) ||
    !input.weekdays.length ||
    input.weekdays.length > 7 ||
    new Set(input.weekdays).size !== input.weekdays.length ||
    !input.weekdays.every(d => integer(d, 0, 6)) ||
    !validTime(input.start) ||
    !validTime(input.end) ||
    input.end <= input.start ||
    !integer(input.capacity, 8, 24) ||
    !integer(input.rounds, 1, 30) ||
    !integer(input.weeks, 1, 8) ||
    !Array.isArray(input.regularIds) ||
    input.regularIds.length > 200 ||
    new Set(input.regularIds).size !== input.regularIds.length ||
    !input.regularIds.every(id => roster.some(p => p.id === id)) ||
    !['warn', 'skip'].includes(input.holidayPolicy) ||
    !Array.isArray(input.holidays) ||
    input.holidays.length > 100 ||
    !input.holidays.every(
      h =>
        h &&
        validDate(h.date) &&
        typeof h.name === 'string' &&
        h.name.trim() &&
        h.name.length <= 100,
    )
  )
    fail('ตรวจวัน เวลา จำนวนคน และรายชื่อขาประจำอีกครั้ง');
  return {
    ...input,
    cancellationNoticeHours,
    courtNumbers: normalizeCourtNumbers(input.courtNumbers ?? ''),
    weekdays: [...input.weekdays].sort(),
    holidays: input.holidays.map(h => ({ date: h.date, name: h.name.trim() })),
    regularIds: [...input.regularIds],
  };
}
async function prepare(DB) {
  await DB.prepare(
    'CREATE TABLE IF NOT EXISTS booking_clubs (club TEXT PRIMARY KEY, revision INTEGER NOT NULL, payload TEXT NOT NULL, updated_at TEXT NOT NULL)',
  ).run();
  // The two starter rows only need to exist once; do not repeat them on every request.
  await once(DB, 'booking_clubs:seed', () =>
    Promise.all(
      CLUB_IDS.map(club =>
        DB.prepare(
          'INSERT OR IGNORE INTO booking_clubs (club,revision,payload,updated_at) VALUES (?,0,?,?)',
        )
          .bind(
            club,
            JSON.stringify({
              settings: defaultSettings(),
              settingsVersion: 0,
              sessions: [],
              seq: 0,
            }),
            new Date().toISOString(),
          )
          .run(),
      ),
    ),
  );
}
async function clubStateFor(DB, club) {
  const table = clubOf(club).stateTable;
  // A newly configured club need not have a roster yet.
  await DB.prepare(
    `CREATE TABLE IF NOT EXISTS ${table} (id INTEGER PRIMARY KEY,revision INTEGER NOT NULL,payload TEXT NOT NULL,updated_at TEXT NOT NULL)`,
  ).run();
  const row = await DB.prepare(`SELECT payload FROM ${table} WHERE id=1`).first();
  return row ? JSON.parse(row.payload) : { players: [], cup: null };
}
export function materialize(doc, players, now = new Date()) {
  doc.settings.cancellationNoticeHours ??= 48;
  const cfg = doc.settings,
    today = bangkokDate(now),
    rosterIds = new Set(players.map(p => p.id));
  // Retain a month of recent sessions; current/future bookings are never pruned.
  doc.sessions = doc.sessions.filter(s => s.date >= addDays(today, -30));
  if (cfg.enabled) {
    for (let n = 0; n < cfg.weeks * 7; n++) {
      const date = addDays(today, n);
      if (
        !cfg.weekdays.includes(new Date(date + 'T00:00:00Z').getUTCDay()) ||
        Date.parse(date + 'T' + cfg.start + ':00+07:00') <= +now
      )
        continue;
      let s = doc.sessions.find(x => x.id === date);
      if (!s) {
        s = {
          id: date,
          date,
          start: cfg.start,
          end: cfg.end,
          capacity: cfg.capacity,
          rounds: cfg.rounds,
          registrations: [],
          regularSeen: [],
          hasFilled: false,
          schedule: null,
          scheduleVersion: 0,
          fingerprint: '',
          closed: false,
        };
        doc.sessions.push(s);
      }
      if (startsAt(s) <= +now) continue;
      // An explicit settings save updates the future slots; regular decisions are
      // remembered so a canceled regular is never silently re-added on the next GET.
      for (const id of cfg.regularIds) {
        if (!rosterIds.has(id) || s.regularSeen.includes(id)) continue;
        s.regularSeen.push(id);
        if (!s.registrations.some(r => r.playerId === id))
          s.registrations.push({
            id: crypto.randomUUID(),
            playerId: id,
            seq: ++doc.seq,
            source: 'regular',
            ownerHash: null,
            createdAt: now.toISOString(),
          });
      }
    }
  }
  for (const s of doc.sessions) {
    s.holiday = holidayOn(s.date, cfg.holidays);
    s.skipped = !!s.holiday && cfg.holidayPolicy === 'skip';
    const hosts = new Set(
      s.registrations.filter(r => !r.guest && rosterIds.has(r.playerId)).map(r => r.playerId),
    );
    s.registrations = s.registrations.filter(r =>
      r.guest
        ? hosts.has(r.guest.hostId)
        : hosts.has(r.playerId) && (!r.invitedBy || hosts.has(r.invitedBy)),
    );
    s.registrations.sort((a, b) => a.seq - b.seq);
  }
  doc.sessions.sort((a, b) => a.date.localeCompare(b.date));
}
const guestLevel = 6.5;
function bookingPlayers(session, players) {
  return session.registrations
    .slice(0, session.capacity)
    .map(r =>
      r.guest
        ? { id: r.playerId, name: r.guest.name, gender: r.guest.gender, lv: guestLevel }
        : players.find(p => p.id === r.playerId),
    )
    .filter(Boolean);
}
function bookingGuest(input, hostId) {
  if (input == null) return null;
  if (
    typeof input.name !== 'string' ||
    input.name.length > 80 ||
    !['M', 'F'].includes(input.gender)
  )
    fail('กรอกชื่อและเพศของแขกให้ครบ');
  const name = input.name.normalize('NFC').trim().replace(/\s+/g, ' ');
  if (!name || /[\p{Cc}\p{Cf}]/u.test(name)) fail('ชื่อแขกไม่ถูกต้อง');
  return { name, gender: input.gender, hostId };
}
const womensDoubles = team => team.every(player => player.gender === 'F');
const bookingMatchAllowed = (a, b) => womensDoubles(a) === womensDoubles(b);
const drawSignature = schedule =>
  JSON.stringify(
    schedule.map(({ ids }) =>
      [JSON.stringify(ids.slice(0, 2).sort()), JSON.stringify(ids.slice(2).sort())].sort(),
    ),
  );
function generateBookingSchedule(players, rounds, previous) {
  const previousDraw = previous && drawSignature(previous.schedule);
  const result = globalThis.Sena.generate(players, rounds, [], previous ? 8 : 3, 40, {
    matchAllowed: bookingMatchAllowed,
    randomWeight: previous ? 12 : 3,
    acceptSchedule: previousDraw ? schedule => drawSignature(schedule) !== previousDraw : undefined,
  });
  return {
    schedule: result.schedule.map(({ round, ids }) => ({ round, ids })),
    counts: result.counts,
  };
}
export function refreshSchedules(doc, players, now = new Date()) {
  // Identical weekly rosters can share a draw; avoid repeating expensive work
  // when materializing several weeks of regular bookings in one request.
  const draws = new Map(
    doc.sessions
      .filter(s => s.scheduleStatus === 'ready' && s.schedule && !s.scheduleRerolled)
      .map(s => [s.fingerprint, s.schedule]),
  );
  for (const s of doc.sessions) {
    if (startsAt(s) <= +now) continue;
    const ids = s.registrations.slice(0, s.capacity).map(r => r.playerId);
    if (ids.length === s.capacity) s.hasFilled = true;
    const chosen = bookingPlayers(s, players);
    const fingerprint = JSON.stringify([
      'booking-v2',
      ids,
      s.rounds,
      chosen.map(p => [p.lv, p.gender]),
      s.skipped,
      s.closed,
      doc.settings.enabled,
    ]);
    if (fingerprint === s.fingerprint) continue;
    s.fingerprint = fingerprint;
    delete s.scheduleRerolled;
    if (!s.hasFilled) {
      s.schedule = null;
      s.scheduleStatus = 'waiting';
      continue;
    }
    s.scheduleVersion++;
    s.scheduleUpdatedAt = now.toISOString();
    if (s.closed || s.skipped || !doc.settings.enabled) {
      s.schedule = null;
      s.scheduleStatus = 'closed';
      continue;
    }
    if (chosen.length < 8) {
      s.schedule = null;
      s.scheduleStatus = 'insufficient';
      continue;
    }
    try {
      if (draws.has(fingerprint)) s.schedule = draws.get(fingerprint);
      else {
        s.schedule = generateBookingSchedule(chosen, s.rounds);
        draws.set(fingerprint, s.schedule);
      }
      s.scheduleStatus = 'ready';
    } catch {
      s.schedule = null;
      s.scheduleStatus = 'failed';
    }
  }
}
async function ownerHash(req) {
  const token = req.headers.get('X-Booking-Token');
  if (!token) return null;
  if (!/^[a-f0-9]{64}$/.test(token)) fail('รหัสจัดการการจองไม่ถูกต้อง');
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)))]
    .map(x => x.toString(16).padStart(2, '0'))
    .join('');
}
export function publicBooking(
  doc,
  revision,
  players,
  admin,
  now = new Date(),
  club = DEFAULT_CLUB,
  awards = new Map(),
  badges = new Map(),
) {
  const cfg = doc.settings,
    cupWeek = cupWeekFor(doc, club);
  const upcoming = doc.sessions.filter(s => startsAt(s) > +now);
  const sessions = admin
    ? [
        ...upcoming,
        ...doc.sessions
          .filter(
            s =>
              startsAt(s) <= +now &&
              !s.skipped &&
              (s.registrations.length || s.withdrawals?.length),
          )
          .reverse(),
      ]
    : upcoming;
  return {
    revision,
    canEdit: admin,
    settingsVersion: doc.settingsVersion,
    ...(admin ? { cupWeek, cupVersion: doc.cupVersion ?? 0 } : {}),
    settings: admin
      ? cfg
      : {
          enabled: cfg.enabled,
          weekdays: cfg.weekdays,
          start: cfg.start,
          end: cfg.end,
          capacity: cfg.capacity,
          weeks: cfg.weeks,
          holidayPolicy: cfg.holidayPolicy,
        },
    holidayYears: HOLIDAY_YEARS,
    roster: players.map(({ id, name, thai, lv }) => ({
      id,
      name,
      thai,
      award:
        awards.get(cupPlayerKey(name, club)) || awards.get(cupPlayerKey(thai || '', club)) || '',
      badge: badges.get(id) ?? {
        plays: 0,
        line: globalThis.SenaJobRules.defaultLine(id),
        chosen: false,
        titles: 0,
        latestChamp: false,
      },
      ...(admin ? { lv } : {}),
    })),
    serverNow: now.toISOString(),
    sessions: sessions.map(s => ({
      id: s.id,
      date: s.date,
      started: startsAt(s) <= +now,
      courtNumbers: s.courtNumbers ?? cfg.courtNumbers ?? '',
      isCup: !s.skipped && (s.cupOverride ?? weekOfMonth(s.date) === cupWeek),
      ...(admin
        ? { cupOverride: s.cupOverride ?? null, courtNumbersOverride: s.courtNumbers ?? null }
        : {}),
      start: s.start,
      end: s.end,
      capacity: s.capacity,
      rounds: s.rounds,
      holiday: s.holiday,
      skipped: s.skipped,
      closed: s.closed,
      confirmedCount: Math.min(s.registrations.length, s.capacity),
      waitlistCount: Math.max(0, s.registrations.length - s.capacity),
      canJoinWaitlist: s.registrations.length < 200,
      schedule: s.schedule,
      scheduleVersion: s.scheduleVersion,
      scheduleUpdatedAt: s.scheduleUpdatedAt,
      scheduleStatus: s.scheduleStatus,
      cancellationNoticeHours: cfg.cancellationNoticeHours ?? 48,
      cancellationDeadline: new Date(
        startsAt(s) - (cfg.cancellationNoticeHours ?? 48) * 3600000,
      ).toISOString(),
      withdrawals: (s.withdrawals ?? []).map(
        ({
          registrationId,
          playerId,
          name,
          payer,
          guest,
          cancelledAt,
          lateCancellation,
          cancellationNoticeHours,
          acknowledgedAt,
          status,
          cancelledByOrganizer,
          invitedBy,
        }) => ({
          registrationId,
          playerId,
          name,
          payer,
          guest,
          cancelledAt,
          lateCancellation,
          cancellationNoticeHours,
          acknowledgedAt,
          status,
          cancelledByOrganizer,
          invitedBy,
        }),
      ),
      registrations: s.registrations.map((r, i) => ({
        id: r.id,
        playerId: r.playerId,
        source: r.source,
        ...(r.invitedBy ? { invitedBy: r.invitedBy } : {}),
        ...(r.guest
          ? {
              guest: {
                name: r.guest.name,
                hostId: r.guest.hostId,
                ...(admin ? { lv: guestLevel } : {}),
              },
            }
          : {}),
        status: i < s.capacity ? 'confirmed' : 'waitlist',
        position: i < s.capacity ? i + 1 : i - s.capacity + 1,
        canCancel: startsAt(s) > +now,
      })),
    })),
  };
}
export async function mutateBooking(env, club, operation, now = new Date()) {
  if (!env.DB) fail('ยังไม่ได้ผูกฐานข้อมูล DB', 503);
  await prepare(env.DB);
  for (let attempt = 0; attempt < 8; attempt++) {
    // The booking document and the roster are independent: read them together.
    const [row, { players, cup }] = await Promise.all([
      env.DB.prepare('SELECT revision,payload FROM booking_clubs WHERE club=?').bind(club).first(),
      clubStateFor(env.DB, club),
    ]);
    const doc = JSON.parse(row.payload),
      before = row.payload;
    materialize(doc, players, now);
    const result = operation ? await operation(doc, players) : null;
    materialize(doc, players, now);
    refreshSchedules(doc, players, now);
    const payload = JSON.stringify(doc);
    if (payload === before) return { doc, revision: row.revision, players, cup, result };
    const update = await env.DB.prepare(
      'UPDATE booking_clubs SET payload=?,revision=revision+1,updated_at=? WHERE club=? AND revision=?',
    )
      .bind(payload, now.toISOString(), club, row.revision)
      .run();
    if (update.meta.changes === 1) return { doc, revision: row.revision + 1, players, cup, result };
  }
  fail('มีผู้จองพร้อมกันหลายคน กรุณาลองอีกครั้ง', 409);
}
export async function bookingRoute(req, env, admin, club, member = null) {
  try {
    if (!['GET', 'POST'].includes(req.method)) return reply({ error: 'Method not allowed' }, 405);
    const owner = await ownerHash(req),
      now = new Date();
    let input = null,
      jobResult = null;
    if (req.method === 'POST') {
      const text = await req.text();
      if (text.length > 30000) fail('ข้อมูลยาวเกินไป');
      try {
        input = JSON.parse(text);
      } catch {
        fail('ข้อมูลไม่ถูกต้อง');
      }
      if (!input || typeof input !== 'object') fail('ข้อมูลไม่ถูกต้อง');
      if (
        ['settings', 'close', 'venueMap', 'cupCalendar', 'reroll', 'courtNumbers'].includes(
          input.action,
        ) &&
        !admin
      )
        fail('กรุณาเข้าสู่ระบบผู้จัด', 401);
      if (
        ![
          'settings',
          'close',
          'book',
          'cancel',
          'venueMap',
          'cupCalendar',
          'reroll',
          'courtNumbers',
          'job',
        ].includes(input.action)
      )
        fail('ไม่พบคำสั่ง');
      // A job line lives outside the booking document: write it, then answer like a GET.
      if (input.action === 'job') {
        if (member?.link?.status !== 'approved') fail('กรุณาเข้าสู่ระบบ LINE และผูกชื่อก่อน', 401);
        if (!globalThis.SenaJobRules.LINES.includes(input.line)) fail('สายไม่ถูกต้อง');
        await setJobLine(env.DB, club, member.link.player_id, input.line);
        jobResult = { message: 'เปลี่ยนสายแล้ว' };
        input = null;
      }
    }
    // Cup history is independent of the booking document: fetch both at once.
    const [cupHistory, outcome] = await Promise.all([
      env.DB ? latestCup(env.DB, club) : null,
      mutateBooking(
        env,
        club,
        input
          ? (doc, players) => {
              if (input.action === 'venueMap') {
                const next = validateVenueMap(input.url),
                  current = venueMapFor(doc, club);
                if (next === current) return { message: 'บันทึกลิงก์แผนที่แล้ว' };
                if (input.previousUrl !== current)
                  fail('ลิงก์แผนที่ถูกแก้จากอีกเครื่อง กรุณาอัปเดตคิวแล้วลองใหม่', 409);
                doc.venueMapUrl = next;
                return { message: 'บันทึกลิงก์แผนที่แล้ว' };
              }
              if (input.action === 'settings') {
                if (input.settingsVersion !== doc.settingsVersion)
                  fail('ผู้จัดอีกเครื่องแก้การตั้งค่าแล้ว กรุณาโหลดใหม่', 409);
                const cfg = validateSettings(
                  {
                    ...input.settings,
                    cancellationNoticeHours:
                      input.settings?.cancellationNoticeHours ??
                      doc.settings.cancellationNoticeHours ??
                      48,
                    courtNumbers: input.settings?.courtNumbers ?? doc.settings.courtNumbers ?? '',
                  },
                  players,
                );
                doc.settings = cfg;
                doc.settingsVersion++;
                for (const s of doc.sessions) {
                  if (startsAt(s) <= +now) continue;
                  s.start = cfg.start;
                  s.end = cfg.end;
                  s.capacity = cfg.capacity;
                  s.rounds = cfg.rounds;
                  s.registrations = s.registrations.filter(
                    r => r.source !== 'regular' || cfg.regularIds.includes(r.playerId),
                  );
                  s.regularSeen = s.regularSeen.filter(id => cfg.regularIds.includes(id));
                }
                return { message: 'บันทึกการตั้งค่าและลงชื่อขาประจำแล้ว' };
              }
              const session = id => {
                const s = doc.sessions.find(s => s.id === id);
                if (!s || startsAt(s) <= +now)
                  fail('รอบนี้เริ่มแล้ว หรือไม่มีในตาราง กรุณาโหลดใหม่', 409);
                return s;
              };
              if (input.action === 'courtNumbers') {
                const s = session(input.sessionId);
                const next = normalizeCourtNumbers(input.courtNumbers);
                if ((s.courtNumbers ?? null) !== input.previousCourtNumbers)
                  fail('เลขคอร์ตถูกแก้จากอีกเครื่อง กรุณาโหลดใหม่', 409);
                if (next) s.courtNumbers = next;
                else delete s.courtNumbers;
                return { message: 'บันทึกเลขคอร์ตแล้ว' };
              }
              if (input.action === 'cupCalendar') {
                const { week, changes, cupVersion } = input;
                if (cupVersion !== (doc.cupVersion ?? 0))
                  fail('ผู้จัดอีกเครื่องแก้ปฏิทิน Cup แล้ว กรุณาโหลดค่าล่าสุด', 409);
                if (
                  !integer(week, 0, 5) ||
                  !Array.isArray(changes) ||
                  changes.length > doc.sessions.length ||
                  !changes.every(
                    c =>
                      c && validDate(c.date) && (c.isCup === null || typeof c.isCup === 'boolean'),
                  ) ||
                  new Set(changes.map(c => c.date)).size !== changes.length
                )
                  fail('ตรวจสัปดาห์และวันแข่ง Cup อีกครั้ง');
                for (const { date, isCup } of changes) {
                  const s = session(date);
                  if (s.skipped) fail('รอบนี้งดจองวันหยุด กรุณาโหลดค่าล่าสุด', 409);
                  if (isCup === null) delete s.cupOverride;
                  else s.cupOverride = isCup;
                }
                doc.cupWeek = week;
                doc.cupVersion = (doc.cupVersion ?? 0) + 1;
                return { message: 'บันทึกวันแข่งขันแล้ว' };
              }
              if (input.action === 'reroll') {
                const s = session(input.sessionId);
                refreshSchedules(doc, players, now);
                if (
                  !doc.settings.enabled ||
                  s.closed ||
                  s.skipped ||
                  !s.schedule ||
                  s.scheduleVersion !== input.scheduleVersion
                ) {
                  fail('ตารางรอบนี้เปลี่ยนแล้วหรือยังไม่พร้อม กรุณาอัปเดตคิว', 409);
                }
                const chosen = bookingPlayers(s, players);
                try {
                  s.schedule = generateBookingSchedule(chosen, s.rounds, s.schedule);
                } catch {
                  fail('ยังไม่พบตารางแบบอื่นที่เข้าเงื่อนไข จึงเก็บตารางเดิมไว้', 409);
                }
                s.scheduleRerolled = true;
                s.scheduleVersion++;
                s.scheduleUpdatedAt = now.toISOString();
                return { message: 'จัดคู่ใหม่และบันทึกตารางแล้ว' };
              }
              if (input.action === 'close') {
                const s = session(input.sessionId);
                if (typeof input.closed !== 'boolean') fail('ข้อมูลไม่ถูกต้อง');
                s.closed = input.closed;
                return { message: s.closed ? 'ปิดรับจองรอบนี้แล้ว' : 'เปิดรับจองรอบนี้แล้ว' };
              }
              if (input.action === 'book') {
                if (
                  memberMode(env) &&
                  !admin &&
                  (member?.link?.status !== 'approved' || input.playerId !== member.link.player_id)
                )
                  fail('กรุณาเข้าสู่ระบบ LINE และผูกชื่อของคุณก่อนจอง', 403);
                if (!doc.settings.enabled) fail('ผู้จัดยังไม่เปิดรับจอง', 409);
                if (!owner) fail('กรุณาเปิดใช้พื้นที่จัดเก็บในเบราว์เซอร์เพื่อจัดการการจอง');
                const player = players.find(p => p.id === input.playerId);
                if (!player) fail('ไม่พบผู้เล่นในก๊วน กรุณาติดต่อผู้จัด');
                if (
                  !Array.isArray(input.sessionIds) ||
                  input.sessionIds.length < 1 ||
                  input.sessionIds.length > 56 ||
                  new Set(input.sessionIds).size !== input.sessionIds.length
                )
                  fail('เลือกวันที่ต้องการจองอย่างน้อย 1 วัน');
                const sessions = input.sessionIds.map(session);
                if (sessions.some(s => s.closed || s.skipped))
                  fail('มีวันที่ปิดรับจองหรือข้ามวันหยุดอยู่ กรุณาเลือกใหม่', 409);
                if (sessions.some(s => s.holiday) && input.acceptHoliday !== true)
                  fail('มีวันหยุดในวันที่เลือก กรุณายืนยันรับทราบก่อนจอง', 409);
                const guest = bookingGuest(input.guest, player.id);
                const friend =
                  input.friendId == null ? null : players.find(p => p.id === input.friendId);
                if (input.friendId != null && (!friend || friend.id === player.id))
                  fail('เลือกเพื่อนในระบบที่ไม่ใช่ตัวเอง 1 คน');
                let added = 0,
                  guestsAdded = 0,
                  friendsAdded = 0;
                const duplicateIds = [];
                for (const s of sessions) {
                  const hasHost = s.registrations.some(r => r.playerId === player.id);
                  const hostBooking = s.registrations.find(r => r.playerId === player.id);
                  if (hostBooking?.invitedBy && (guest || friend))
                    fail('รอบนี้มีเพื่อนจองและจ่ายแทนให้แล้ว ให้ผู้จัดช่วยก่อนเพิ่มคนอื่น', 409);
                  const currentFriend =
                    friend && s.registrations.find(r => r.playerId === friend.id);
                  if (currentFriend && currentFriend.invitedBy !== player.id)
                    fail('เพื่อนที่เลือกมีชื่อในรอบนี้แล้ว ไม่เปลี่ยนผู้จ่ายให้โดยอัตโนมัติ', 409);
                  if (
                    friend &&
                    s.registrations.some(r => r.invitedBy === player.id && r.playerId !== friend.id)
                  )
                    fail('จองให้เพื่อนในระบบได้ 1 คนต่อรอบ', 409);
                  const nameKey = value => value.normalize('NFC').trim().toLowerCase();
                  const sponsored =
                    friend ||
                    players.find(p =>
                      s.registrations.some(r => r.playerId === p.id && r.invitedBy === player.id),
                    );
                  if (
                    guest &&
                    (nameKey(guest.name) === nameKey(player.name) ||
                      (sponsored && nameKey(guest.name) === nameKey(sponsored.name)))
                  )
                    fail('ชื่อแขกซ้ำกับสมาชิกในกลุ่ม กรุณาระบุชื่อให้ต่างกัน');
                  if (
                    friend &&
                    s.registrations.some(
                      r =>
                        r.guest?.hostId === player.id &&
                        nameKey(r.guest.name) === nameKey(friend.name),
                    )
                  )
                    fail('ชื่อเพื่อนซ้ำกับแขกที่จองไว้ กรุณาให้ผู้จัดตรวจสอบก่อน');
                  const addFriend = friend && !currentFriend;
                  const addGuest =
                    guest &&
                    !s.registrations.some(
                      r =>
                        r.guest?.hostId === player.id &&
                        r.guest.name.toLowerCase() === guest.name.toLowerCase(),
                    );
                  const seats =
                    Number(!hasHost) + Number(Boolean(addGuest)) + Number(Boolean(addFriend));
                  if (!seats) {
                    duplicateIds.push(s.id);
                    continue;
                  }
                  if (s.registrations.length + seats > 200) fail('คิวสำรองรอบนี้เต็มแล้ว', 409);
                  const register = (playerId, extra = {}) => {
                    s.registrations.push({
                      id: crypto.randomUUID(),
                      playerId,
                      seq: ++doc.seq,
                      source: 'manual',
                      ownerHash: owner,
                      createdAt: now.toISOString(),
                      ...extra,
                    });
                  };
                  if (!hasHost) register(player.id);
                  if (addFriend) {
                    register(friend.id, { invitedBy: player.id });
                    friendsAdded++;
                  }
                  if (addGuest) {
                    register('guest:' + crypto.randomUUID(), { guest });
                    guestsAdded++;
                  }
                  added++;
                }
                const duplicate = duplicateIds.length;
                return {
                  added,
                  guestsAdded,
                  friendsAdded,
                  duplicate,
                  duplicateIds,
                  message: added
                    ? `จองเรียบร้อย ${added} วัน${friendsAdded ? ` • จองให้เพื่อน ${friendsAdded} ที่นั่ง` : ``}${guestsAdded ? ` • เพิ่มแขก ${guestsAdded} ที่นั่ง` : ''}${duplicate ? ` • ลงชื่อไว้แล้ว ${duplicate} วัน` : ''}`
                    : 'มีชื่อในวันที่เลือกแล้ว ไม่ได้เพิ่มซ้ำ',
                };
              }
              if (input.action === 'cancel') {
                const s = session(input.sessionId),
                  r = s.registrations.find(r => r.id === input.registrationId);
                if (!r) fail('รายการนี้ถูกถอนแล้ว กรุณาโหลดใหม่', 409);
                if (
                  memberMode(env) &&
                  !admin &&
                  (member?.link?.status !== 'approved' ||
                    ((r.guest?.hostId || r.invitedBy || r.playerId) !== member.link.player_id &&
                      r.playerId !== member.link.player_id))
                )
                  fail('ถอนได้เฉพาะรายการของตัวเอง กรุณาให้ผู้จัดช่วย', 403);
                const hours = doc.settings.cancellationNoticeHours ?? 48;
                const deadline = startsAt(s) - hours * 3600000,
                  late = +now > deadline;
                if (late && input.acceptLateCancellation !== true)
                  throw new BookingError(
                    `เลยเวลาถอนปลอดภัย ${hours} ชั่วโมงก่อนเริ่มแล้ว หากผู้เล่นไม่ครบจนไม่สามารถตีได้ อาจมีค่าใช้จ่าย กรุณากดรับทราบก่อนยืนยันถอนตัว`,
                    409,
                    {
                      code: 'LATE_CANCELLATION_ACK_REQUIRED',
                      cancellationNoticeHours: hours,
                      cancellationDeadline: new Date(deadline).toISOString(),
                    },
                  );
                const removed = s.registrations.filter(
                  x =>
                    x.id === r.id || x.guest?.hostId === r.playerId || x.invitedBy === r.playerId,
                );
                s.withdrawals ??= [];
                for (const x of removed) {
                  const host = x.guest?.hostId || x.invitedBy || x.playerId,
                    payer = players.find(p => p.id === host)?.name || 'ผู้เล่นที่นำออกจากก๊วน';
                  s.withdrawals.push({
                    registrationId: x.id,
                    playerId: x.playerId,
                    name: x.guest?.name || players.find(p => p.id === x.playerId)?.name || payer,
                    payer,
                    payerKey: 'member:' + host,
                    guest: Boolean(x.guest),
                    ...(x.invitedBy ? { invitedBy: x.invitedBy } : {}),
                    cancelledAt: now.toISOString(),
                    lateCancellation: late,
                    cancellationNoticeHours: hours,
                    acknowledgedAt: late ? now.toISOString() : null,
                    status: s.registrations.indexOf(x) < s.capacity ? 'confirmed' : 'waitlist',
                    cancelledByOrganizer: admin,
                    ...(member ? { actorUserId: member.userId } : {}),
                  });
                }
                s.registrations = s.registrations.filter(
                  x =>
                    x.id !== r.id && x.guest?.hostId !== r.playerId && x.invitedBy !== r.playerId,
                );
                return { message: 'ถอนชื่อแล้ว • คิวสำรองและตารางคู่ปรับให้อัตโนมัติ' };
              }
            }
          : null,
        now,
      ),
    ]);
    const awards = new Map(
      [...globalThis.Sena.cupAwards(cupHistory ?? outcome.cup)].map(([name, award]) => [
        cupPlayerKey(name, club),
        award,
      ]),
    );
    const badges = await badgeData(env.DB, club, outcome.players, awards);
    const view = publicBooking(
      outcome.doc,
      outcome.revision,
      outcome.players,
      admin,
      now,
      club,
      awards,
      badges,
    );
    if (memberMode(env)) {
      view.requireLogin = true;
      view.member = {
        loggedIn: Boolean(member),
        status: member?.link?.status || null,
        playerId: member?.link?.status === 'approved' ? member.link.player_id : null,
      };
      for (const session of view.sessions)
        for (const r of session.registrations)
          r.canCancel =
            r.canCancel &&
            (admin ||
              (member?.link?.status === 'approved' &&
                ((r.guest?.hostId || r.invitedBy || r.playerId) === member.link.player_id ||
                  r.playerId === member.link.player_id)));
    }
    return reply({
      ...view,
      venueMapUrl: venueMapFor(outcome.doc, club),
      result: jobResult ?? outcome.result,
    });
  } catch (e) {
    if (e instanceof BookingError) return reply({ error: e.message, ...e.details }, e.status);
    throw e;
  }
}
export async function scheduledBookings(env, now = new Date()) {
  for (const club of CLUB_IDS) {
    const { doc, players } = await mutateBooking(env, club, null, now);
    await recordAttendance(env.DB, club, doc, players, bangkokDate(now));
  }
}
