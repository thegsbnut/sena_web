// Flex cards for Badbot's roster replies (who is playing a round). Pure: takes
// the public /api/booking view and returns LINE message objects, so it never
// reads the database or leaks anything the booking page does not already show.
import './public/job-rules.js';
import { clubOf } from './clubs.js';
import { noticeDay } from './line-notices.js';

const COLORS = { sena: '#168B42', 88: '#1F4E9A' };
// Sena green, 88 blue: every card tells the clubs apart by this colour.
export const clubColor = club => COLORS[club] || COLORS.sena;
const GREY = '#8A8F98',
  AMBER = '#B26A00',
  RED = '#C62828',
  TRACK = '#ECEEF1';
// Keeps one bubble well under LINE's 30 KB bubble / 50 KB carousel limits.
const MAX_CONFIRMED = 30,
  MAX_WAITLIST = 10;

const clean = value =>
  String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
const text = (value, props = {}) => ({ type: 'text', text: clean(value) || ' ', ...props });
const vbox = (contents, props = {}) => ({ type: 'box', layout: 'vertical', contents, ...props });
const hbox = (contents, props = {}) => ({ type: 'box', layout: 'horizontal', contents, ...props });

// The pre-rendered PNG of a job badge (scripts/render-badges.cjs). Guests get a
// transparent square so names stay aligned.
export function badgeImage(origin, badge) {
  if (!badge) return origin + '/badges/blank.png';
  const { LINES, jobLevel } = globalThis.SenaJobRules;
  const { lvl, stars } = jobLevel(badge.plays);
  if (!lvl || !LINES.includes(badge.line)) return origin + '/badges/novice.png';
  return origin + '/badges/' + badge.line + '-' + lvl + (lvl === 3 ? '-' + stars : '') + '.png';
}

// One entry per registration: name, the award (🥇 / 💩 — from the latest Cup
// only, so just its winner and last place carry one), the badge, and whether
// they were just added.
function people(data, session, status, highlight) {
  const roster = new Map(data.roster.map(p => [p.id, p]));
  const name = id => clean(roster.get(id)?.name) || 'ผู้เล่นที่นำออกจากก๊วน';
  return session.registrations
    .filter(r => r.status === status)
    .sort((a, b) => a.position - b.position)
    .map(r => {
      const player = roster.get(r.playerId);
      const label = r.guest
        ? clean(r.guest.name) + ' (แขกของ ' + name(r.guest.hostId) + ')'
        : r.invitedBy
          ? name(r.playerId) + ' (จองโดย ' + name(r.invitedBy) + ' · จ่ายแทน)'
          : name(r.playerId);
      const award = (!r.guest && player?.award) || '';
      return {
        label,
        award,
        badge: (!r.guest && player?.badge) || null,
        mark: highlight.get(r.playerId) || '',
      };
    });
}

function cell(person, n, origin, color) {
  const spans = [
    person.award && { type: 'span', text: person.award + ' ' },
    {
      type: 'span',
      text: person.label,
      ...(person.mark ? { weight: 'bold', color } : {}),
    },
    person.mark && { type: 'span', text: ' ' + person.mark },
  ].filter(Boolean);
  return {
    type: 'box',
    layout: 'baseline',
    spacing: 'xs',
    flex: 1,
    contents: [
      text(String(n), { size: 'xxs', color: GREY, flex: 0 }),
      { type: 'icon', url: badgeImage(origin, person.badge), size: '20px' },
      { type: 'text', text: person.label, contents: spans, size: 'sm', wrap: true, flex: 1 },
    ],
  };
}

// Two names per row, numbered in booking order (1 2 / 3 4 / …).
function grid(list, origin, color, max) {
  const shown = list.slice(0, max),
    rows = [];
  for (let i = 0; i < shown.length; i += 2)
    rows.push(
      hbox(
        [
          cell(shown[i], i + 1, origin, color),
          shown[i + 1]
            ? cell(shown[i + 1], i + 2, origin, color)
            : vbox([{ type: 'filler' }], { flex: 1 }),
        ],
        { spacing: 'md' },
      ),
    );
  if (list.length > max)
    rows.push(text(`… อีก ${list.length - max} คน ดูได้บนเว็บ`, { size: 'xs', color: GREY }));
  return rows;
}

const label = (value, color) => text(value, { size: 'xs', weight: 'bold', color });
const separator = () => ({ type: 'separator', margin: 'lg', color: TRACK });

function header(club, title, subtitle) {
  return vbox(
    [
      text(title, { weight: 'bold', size: 'lg', color: '#FFFFFF', wrap: true }),
      ...(subtitle ? [text(subtitle, { size: 'xs', color: '#FFFFFFD9', wrap: true })] : []),
    ],
    { backgroundColor: COLORS[club] || COLORS.sena, paddingAll: 'lg', spacing: 'xs' },
  );
}

function footer(club, bookUrl, updated) {
  return vbox(
    [
      {
        type: 'button',
        style: 'primary',
        color: COLORS[club] || COLORS.sena,
        height: 'sm',
        action: { type: 'uri', label: 'จอง / ถอน ' + clubOf(club).label, uri: bookUrl },
      },
      ...(updated
        ? [text('อัปเดต ' + updated + ' น.', { size: 'xxs', color: GREY, align: 'end' })]
        : []),
    ],
    { spacing: 'sm', paddingAll: 'lg', paddingTop: 'none' },
  );
}

export function vacancyOf(session) {
  if (session.closed) return { text: 'ปิดรับจอง', color: GREY };
  if (session.confirmedCount >= session.capacity) return { text: 'เต็ม', color: RED };
  return { text: `เหลือ ${session.capacity - session.confirmedCount} ที่`, color: '#0F6B32' };
}

// A card for one round. `highlight` maps playerId → mark (✨ just booked,
// ⬆️ moved up from the waitlist); `extra` is appended under the names.
export function rosterBubble(data, club, session, opts) {
  const { origin, bookUrl, updated, highlight = new Map(), extra = [] } = opts;
  const color = COLORS[club] || COLORS.sena;
  const confirmed = people(data, session, 'confirmed', highlight),
    waiting = people(data, session, 'waitlist', highlight);
  const vacancy = vacancyOf(session);
  const pct = Math.min(100, Math.round((100 * session.confirmedCount) / (session.capacity || 1)));
  const body = [
    hbox(
      [
        {
          type: 'box',
          layout: 'baseline',
          flex: 1,
          contents: [
            text(String(session.confirmedCount), { size: 'xxl', weight: 'bold', flex: 0 }),
            text(`/ ${session.capacity} คน`, { size: 'sm', color: GREY, margin: 'sm' }),
          ],
        },
        vbox([text(vacancy.text, { size: 'xs', weight: 'bold', color: vacancy.color })], {
          flex: 0,
          backgroundColor: vacancy.color + '1A',
          cornerRadius: 'xl',
          paddingStart: 'md',
          paddingEnd: 'md',
          paddingTop: 'xs',
          paddingBottom: 'xs',
          justifyContent: 'center',
        }),
      ],
      { alignItems: 'center' },
    ),
    vbox(
      [
        vbox([{ type: 'filler' }], {
          width: Math.max(pct, 1) + '%',
          height: '6px',
          backgroundColor: session.closed ? GREY : color,
        }),
      ],
      { backgroundColor: TRACK, height: '6px', cornerRadius: 'md', margin: 'md' },
    ),
    label('ตัวจริง', color),
    ...(confirmed.length
      ? grid(confirmed, origin, color, MAX_CONFIRMED)
      : [text('ยังไม่มีผู้ลงชื่อ', { size: 'sm', color: GREY })]),
    separator(),
    label(waiting.length ? `⏳ สำรอง · ${session.waitlistCount} คน` : '⏳ สำรอง · ไม่มี', AMBER),
    ...grid(waiting, origin, color, MAX_WAITLIST),
    ...(extra.length ? [separator(), ...extra] : []),
  ];
  const day = noticeDay(session.date);
  return {
    type: 'bubble',
    size: 'mega',
    header: header(
      club,
      '📍 ' + clubOf(club).heading + ' · ' + day + (session.isCup ? ' · CUP' : ''),
      `${session.start}–${session.end} น.` +
        (session.courtNumbers ? ' · คอร์ต ' + session.courtNumbers : ''),
    ),
    body: vbox(body, { spacing: 'sm', paddingAll: 'lg' }),
    footer: footer(club, bookUrl, updated),
  };
}

// A card for a club with nothing to list (no open round, read failure).
export function emptyBubble(club, message, { bookUrl, updated }) {
  return {
    type: 'bubble',
    size: 'mega',
    header: header(club, '📍 ' + clubOf(club).heading),
    body: vbox([text(message, { size: 'sm', color: GREY, wrap: true })], { paddingAll: 'lg' }),
    footer: footer(club, bookUrl, updated),
  };
}

// The "other days" block of a multi-day booking.
export function otherDays(name, rounds) {
  return [
    label('📅 วันอื่นที่ ' + clean(name) + ' จอง', COLORS.sena),
    ...rounds.map(s =>
      hbox([
        text(noticeDay(s.date), { size: 'sm', flex: 1 }),
        text(`${s.confirmedCount}/${s.capacity} · สำรอง ${s.waitlistCount}`, {
          size: 'xs',
          color: GREY,
          align: 'end',
          flex: 0,
        }),
      ]),
    ),
  ];
}

// altText: what notifications and the chat list show (max 400 characters).
export function rosterAlt(club, session) {
  if (!session) return 'รายชื่อ ' + clubOf(club).label + ' · ยังไม่มีรอบเปิดรับ';
  return (
    'รายชื่อ ' +
    clubOf(club).label +
    ' ' +
    noticeDay(session.date) +
    ` · ${session.confirmedCount}/${session.capacity} ${vacancyOf(session).text}`
  );
}

export function flexMessage(bubbles, altText) {
  return {
    type: 'flex',
    altText: altText.slice(0, 400),
    contents: bubbles.length === 1 ? bubbles[0] : { type: 'carousel', contents: bubbles },
  };
}

// Plain text of a Flex card: vertical boxes become lines, other boxes join with
// spaces. Used when LINE rejects a card, so the reply still goes out.
export function flexText(node) {
  if (!node || typeof node !== 'object') return '';
  if (node.type === 'text')
    return node.contents ? node.contents.map(span => span.text).join('') : node.text;
  if (node.type === 'bubble')
    return [node.header, node.body].map(flexText).filter(Boolean).join('\n');
  if (node.type === 'carousel') return node.contents.map(flexText).join('\n\n━━━━━━━━━━\n\n');
  if (node.type === 'box')
    return node.contents
      .map(flexText)
      .filter(s => s.trim())
      .join(node.layout === 'vertical' ? '\n' : ' ');
  return '';
}

export function flexFallback(message) {
  if (message.type !== 'flex') return message;
  const fallback = { type: 'text', text: flexText(message.contents).slice(0, 5000) };
  if (message.quickReply) fallback.quickReply = message.quickReply;
  return fallback;
}
