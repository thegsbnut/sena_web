import { clubOf, CLUB_IDS, DEFAULT_CLUB } from './clubs.js';
import {
  lineReplyEvidence,
  redactedMentionPayload,
  groupMentionTarget,
  mentionGroupMessage,
  mentionNameRisk,
  planMentionMessages,
} from './line-mentions.js';
import { memberMode, liffUrl, prepareMembers } from './member.js';
import { NOTICE_CODE, claimNotice, releaseNotice, noticeClub, noticeDay } from './line-notices.js';
import { logError } from './log.js';
import { billingLineText, billingLineMessages, paidSummary, resubmitMessages } from './billing.js';
import { bookingRoute } from './booking.js';
import { latestCup, leaderboardRoute } from './leaderboard.js';
import { paidAlt, paidBubble } from './line-bill-card.js';
import { cupResultBubble, gamesBubble, leaderboardBubble } from './line-board-cards.js';
import {
  emptyBubble,
  flexFallback,
  clubHeaderStyle,
  flexMessage,
  otherDays,
  rosterAlt,
  rosterBubble,
} from './line-roster-card.js';

const defaultBookingUrl = 'https://sena-web.thegsbnut.workers.dev/court#booking';
const clubs = CLUB_IDS;
const day = 86400000;
const thaiDay = new Intl.DateTimeFormat('th-TH', {
  weekday: 'long',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'Asia/Bangkok',
});
const thaiTime = new Intl.DateTimeFormat('th-TH', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: 'Asia/Bangkok',
});
export const normalizeLineText = text =>
  String(text ?? '')
    .normalize('NFKC')
    .replace(/[\u200b\u200e\u200f\ufeff]/g, '')
    .trim();

const shortcuts = new Map([
  ['book 88', { kind: 'book', club: '88', description: 'ลิงก์จอง 88' }],
  ['book sena', { kind: 'book', club: 'sena', description: 'ลิงก์จอง Sena' }],
  ['list', { kind: 'roster', scope: 'all', description: 'รายชื่อทั้งสองสนาม' }],
  ['list 88', { kind: 'roster', scope: '88', description: 'รายชื่อ 88' }],
  ['list sena', { kind: 'roster', scope: 'sena', description: 'รายชื่อ Sena' }],
  ['matchup sena', { kind: 'matchup', description: 'คู่ตีรอบปกติ Sena' }],
  ['matchup 88cup', { kind: 'cupMatchup', club: '88', description: 'ตารางแข่ง 88 Cup' }],
  ['matchup senacup', { kind: 'cupMatchup', club: 'sena', description: 'ตารางแข่ง Sena Cup' }],
  ['senacup', { kind: 'cupResult', club: 'sena', description: 'ผล Sena Cup ล่าสุด' }],
  ['88cup', { kind: 'cupResult', club: '88', description: 'ผล 88 Cup ล่าสุด' }],
  ['leaderboard', { kind: 'leaderboard', scope: 'all', description: '5 อันดับแรกของทั้งสองสนาม' }],
  ['leaderboard sena', { kind: 'leaderboard', scope: 'sena', description: '5 อันดับแรกของ Sena' }],
  ['leaderboard 88', { kind: 'leaderboard', scope: '88', description: '5 อันดับแรกของ 88' }],
  ['bill', { kind: 'bill', scope: 'all', description: 'คนที่ยังไม่จ่ายทั้งสองสนาม' }],
  ['bill 88', { kind: 'bill', scope: '88', description: 'คนที่ยังไม่จ่ายสนาม 88' }],
  ['bill sena', { kind: 'bill', scope: 'sena', description: 'คนที่ยังไม่จ่ายสนาม Sena' }],
  ['help', { kind: 'help', description: 'รายการคำสั่ง' }],
]);

export function groupCommand(event) {
  if (event.mode === 'standby') return null;
  if (event.type === 'postback') {
    const data = event.postback?.data;
    if (data === 'badbot:menu') return { kind: 'menu' };
    if (data === 'badbot:roster') return { kind: 'roster', scope: 'all' }; // Existing cards still work.
    const tag = /^badbot:billtag:(all|sena|88):(\d{1,3})$/.exec(data || '');
    if (tag) return { kind: 'billTag', scope: tag[1], offset: Number(tag[2]) };
    const run = /^badbot:run:([a-z0-9 ]{1,20})$/.exec(data || '');
    if (run && shortcuts.has(run[1])) return shortcuts.get(run[1]);
    const round = /^badbot:round:(sena|88):([A-Za-z0-9:_-]{1,64})$/.exec(data || '');
    if (round) return { kind: 'round', club: round[1], sessionId: round[2] };
    const match = /^badbot:roster:(all|sena|88)$/.exec(data || '');
    return match ? { kind: 'roster', scope: match[1] } : null;
  }
  if (event.type !== 'message' || event.message?.type !== 'text') return null;
  // Posted by the LIFF page after a withdrawal/payment; see line-notices.js.
  const notice = NOTICE_CODE.exec(normalizeLineText(event.message.text));
  if (notice) return { kind: 'notice', code: notice[1] };
  const match = /^\/?(?:badbot|แบดบอต)(?:\s+(.*))?$/i.exec(normalizeLineText(event.message.text));
  if (!match) return null;
  const action = (match[1] || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (shortcuts.has(action)) return shortcuts.get(action);
  // Pairing codes are consumed by the existing administrator-only pairing flow.
  if (/^[a-f0-9]{32}$/i.test(action)) return null;
  const roster =
    /^(?:รายชื่อ|ดูรายชื่อ|ดูผู้ตี|ผู้ตี|ดูรายชื่อผู้เล่น)(?:\s+(ทั้งหมด|ทุกสนาม|all|sena|เสนา|88))?$/i.exec(
      action,
    );
  if (!roster) return { kind: 'menu' };
  const venue = (roster[1] || 'all').toLowerCase();
  return {
    kind: 'roster',
    scope: venue === '88' ? '88' : ['sena', 'เสนา'].includes(venue) ? 'sena' : 'all',
  };
}

function bookingUrl(env, club = DEFAULT_CLUB) {
  if (memberMode(env) && env.LINE_LIFF_ID) return liffUrl(env, club);
  return courtUrl(env, club);
}
// Where the web app (and its public/ images) lives. Not the booking link: with
// LINE login that is liff.line.me, which does not serve our mascot or badges.
export const siteOrigin = env => new URL(courtUrl(env)).origin;
function courtUrl(env, club = DEFAULT_CLUB) {
  const url = new URL(env.LINE_BOOKING_URL || defaultBookingUrl);
  if (url.protocol !== 'https:' || url.username || url.password) throw Error('Invalid booking URL');
  if (club !== DEFAULT_CLUB) url.searchParams.set('club', club);
  else url.searchParams.delete('club');
  return url.href;
}

// "เก็บเงิน" opens the bills page in collect mode: organizers get the court bill and
// the general bill, everyone else the general bill only (the server enforces both).
function collectUrl(env, club = DEFAULT_CLUB) {
  if (memberMode(env) && env.LINE_LIFF_ID) return liffUrl(env, club, 'collect');
  const url = new URL('/billing.html', siteOrigin(env));
  url.searchParams.set('collect', '1');
  if (club !== DEFAULT_CLUB) url.searchParams.set('club', club);
  return url.href;
}
function menu(urls, collectUrls) {
  const link = club => ({
    type: 'button',
    style: 'primary',
    color: '#168B42',
    height: 'sm',
    action: { type: 'uri', label: '🏸 ' + clubOf(club).label, uri: urls[club] },
  });
  const collect = club => ({
    type: 'button',
    style: 'primary',
    color: '#B86E00',
    height: 'sm',
    action: { type: 'uri', label: '💸 ' + clubOf(club).label, uri: collectUrls[club] },
  });
  const postback = (label, data, displayText) => ({
    type: 'button',
    style: 'secondary',
    height: 'sm',
    action: { type: 'postback', label, data, displayText },
  });
  const roster = club =>
    postback(
      '👥 ' + clubOf(club).label,
      'badbot:roster:' + club,
      '👥 ขอรายชื่อผู้ตี ' + clubOf(club).label,
    );
  const row = (...contents) => ({ type: 'box', layout: 'horizontal', spacing: 'sm', contents });
  const section = (title, ...rows) => ({
    type: 'box',
    layout: 'vertical',
    spacing: 'sm',
    contents: [
      { type: 'text', text: title, size: 'xs', weight: 'bold', color: '#168B42' },
      ...rows,
    ],
  });
  return {
    type: 'flex',
    altText: 'Badbot น้องขุนเงิน · จอง / ถอนชื่อ รายชื่อ บิล และตารางจัดคู่',
    contents: {
      type: 'bubble',
      header: {
        type: 'box',
        layout: 'vertical',
        spacing: 'xs',
        ...clubHeaderStyle('sena'),
        paddingAll: 'lg',
        contents: [
          {
            type: 'text',
            text: '🏸 Badbot น้องขุนเงิน',
            weight: 'bold',
            size: 'lg',
            color: '#FFFFFF',
            wrap: true,
          },
          { type: 'text', text: 'ก๊วน Sena และ 88', size: 'xs', color: '#D6F0DE' },
        ],
      },
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'lg',
        paddingAll: 'lg',
        contents: [
          section('จอง / ถอน คิว', row(...clubs.map(link))),
          section('รายชื่อผู้ตี', row(...clubs.map(roster))),
          section('เก็บเงิน (ค่าคอร์ต / ค่าข้าว ฯลฯ)', row(...clubs.map(collect))),
          section(
            'บิล และตาราง',
            row(
              postback('💰 บิลค้างจ่าย', 'badbot:run:bill', '💰 ขอบิลค้างจ่าย'),
              postback('🆚 ตารางจัดคู่', 'badbot:run:matchup sena', '🆚 ขอตารางจัดคู่'),
            ),
            row(
              postback('🏆 อันดับ', 'badbot:run:leaderboard', '🏆 ขออันดับ'),
              postback('❓ ช่วยเหลือ', 'badbot:run:help', '❓ ขอความช่วยเหลือ'),
            ),
          ),
        ],
      },
    },
  };
}

const clean = value =>
  String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
function boundedSection(lines) {
  const result = [];
  let size = 0;
  for (const line of lines) {
    if (size + line.length + 1 > 8000) {
      result.push('… รายชื่อเพิ่มเติมดูได้บนเว็บ');
      break;
    }
    result.push(line);
    size += line.length + 1;
  }
  return result.join('\n');
}

function displayNames(data, session) {
  const names = new Map(
    data.roster.map(p => [p.id, clean([p.award, p.name].filter(Boolean).join(' '))]),
  );
  for (const r of session.registrations) {
    if (r.invitedBy)
      names.set(
        r.playerId,
        (names.get(r.playerId) || 'ผู้เล่น') +
          ' (จองโดย ' +
          (names.get(r.invitedBy) || 'สมาชิก') +
          ' · จ่ายแทน)',
      );
    if (r.guest)
      names.set(
        r.playerId,
        clean(r.guest.name) + ' (แขกของ ' + (names.get(r.guest.hostId) || 'สมาชิก') + ')',
      );
  }
  return id => names.get(id) || 'ผู้เล่นที่นำออกจากก๊วน';
}

// Player list (ids, job badges, latest Cup 🥇/💩) for the bill cards.
export const rosterOf = env => async club => (await bookingData(env, club))?.roster ?? [];
async function bookingData(env, club) {
  const response = await bookingRoute(
    new Request('https://badbot.internal/api/booking'),
    env,
    false,
    club,
  );
  return response.ok ? await response.json() : null;
}

// The nearest upcoming round, or the given round (`sessionId`) when there is one.
function pickRound(data, now, sessionId) {
  if (sessionId) return data.sessions.find(s => s.id === sessionId) || null;
  if (!data.settings.enabled) return null;
  return (
    data.sessions
      .filter(s => !s.skipped && Date.parse(s.date + 'T' + s.start + ':00+07:00') > +now)
      .sort((a, b) => (a.date + 'T' + a.start).localeCompare(b.date + 'T' + b.start))[0] || null
  );
}

// One roster card for a club, with its altText line.
async function rosterCard(env, club, now, { data, sessionId, highlight, extra } = {}) {
  const opts = {
    origin: new URL(courtUrl(env, club)).origin,
    bookUrl: bookingUrl(env, club),
    updated: thaiTime.format(now),
    highlight,
    extra,
  };
  data ??= await bookingData(env, club);
  if (!data)
    return {
      bubble: emptyBubble(club, 'อ่านคิวไม่สำเร็จ กรุณากดดูข้อมูลล่าสุดอีกครั้ง', opts),
      alt: 'รายชื่อ ' + clubOf(club).label + ' · อ่านคิวไม่สำเร็จ',
    };
  const session = pickRound(data, now, sessionId);
  if (!session)
    return { bubble: emptyBubble(club, 'ยังไม่มีรอบเปิดรับ', opts), alt: rosterAlt(club) };
  return { bubble: rosterBubble(data, club, session, opts), alt: rosterAlt(club, session) };
}

// Data readers shared by the Flex cards and their plain-text fallbacks.
async function matchupRound(env) {
  const response = await bookingRoute(
    new Request('https://badbot.internal/api/booking'),
    env,
    false,
    'sena',
  );
  if (!response.ok) return { error: 'อ่านตารางคู่ตี Sena ไม่สำเร็จ' };
  const data = await response.json();
  const session = data.settings.enabled && data.sessions.find(s => !s.skipped && !s.isCup);
  if (!session) return { error: 'ยังไม่มีรอบปกติถัดไปของ Sena' };
  const date = thaiDay.format(new Date(session.date + 'T12:00:00+07:00'));
  const heading =
    '🏸 คู่ตี Sena · ' +
    date +
    ` · ${session.start}–${session.end} น.` +
    (session.courtNumbers ? ' · คอร์ต ' + session.courtNumbers : '');
  if (session.closed || !session.schedule?.schedule?.length)
    return { error: heading + '\nตารางคู่ยังไม่พร้อม' };
  return { data, session, heading, name: displayNames(data, session) };
}

async function cupMatches(env, club) {
  const table = clubOf(club).stateTable;
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS ${table} (id INTEGER PRIMARY KEY, revision INTEGER NOT NULL, payload TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  ).run();
  const row = await env.DB.prepare(`SELECT payload FROM ${table} WHERE id=1`).first();
  const cup = row ? JSON.parse(row.payload).cup : null;
  if (
    !cup?.matches?.length ||
    cup.matches.every(m => Number.isInteger(m.sa) && Number.isInteger(m.sb) && m.sa !== m.sb)
  )
    return null;
  return cup;
}
const cupRest = (cup, i) =>
  i > 0 && globalThis.Sena.cupRestConflicts(cup.matches.slice(i - 1, i + 1));

// Standings rows with ties sharing a rank, as the text reply shows them.
function cupRanks(cup) {
  const rows = globalThis.Sena.standings(cup.teams, cup.matches);
  let previous, rank;
  return rows.map((row, i) => {
    if (
      !previous ||
      row.w !== previous.w ||
      row.pf - row.pa !== previous.pf - previous.pa ||
      row.pf !== previous.pf
    )
      rank = i + 1;
    previous = row;
    return { ...row, rank };
  });
}

async function leaderboardRows(env, club) {
  const response = await leaderboardRoute(
    new Request('https://badbot.internal/api/leaderboard'),
    env,
    false,
    club,
  );
  return response.ok ? (await response.json()).standings : null;
}
const leaderboardLink = url => {
  const link = new URL(url);
  link.hash = 'leaderboard';
  return link.href;
};

// Table replies as Flex cards; null means "nothing to draw" and the caller sends
// the plain-text reply (which also explains why there is no table).
async function boardMessage(action, env, urls) {
  if (action.kind === 'matchup') {
    const round = await matchupRound(env);
    if (round.error) return null;
    const { session, name } = round;
    const day = noticeDay(session.date);
    const card = gamesBubble({
      club: 'sena',
      title: '🆚 คู่ตี Sena · ' + day,
      subtitle:
        `${session.start}–${session.end} น.` +
        (session.courtNumbers ? ' · คอร์ต ' + session.courtNumbers : ''),
      games: session.schedule.schedule.map(m => ({
        round: m.round,
        left: m.ids.slice(0, 2).map(name),
        right: m.ids.slice(2).map(name),
      })),
      url: urls.sena,
    });
    return flexMessage(
      [card],
      'คู่ตี Sena ' + day + ' · ' + session.schedule.schedule.length + ' เกม',
    );
  }
  if (action.kind === 'cupMatchup') {
    const cup = await cupMatches(env, action.club);
    if (!cup) return null;
    const card = gamesBubble({
      club: action.club,
      title: '🏆 ตาราง ' + clubOf(action.club).cupName,
      subtitle: cup.matches.length + ' เกม',
      games: cup.matches.map((m, i) => ({
        round: i + 1,
        left: cup.teams[m.a],
        right: cup.teams[m.b],
        rest: cupRest(cup, i),
      })),
      url: urls[action.club],
    });
    return flexMessage(
      [card],
      'ตาราง ' + clubOf(action.club).cupName + ' · ' + cup.matches.length + ' เกม',
    );
  }
  if (action.kind === 'cupResult') {
    const cup = await latestCup(env.DB, action.club);
    if (!cup) return null;
    const rows = cupRanks(cup).map(r => ({ ...r, name: clean(r.name) }));
    const card = cupResultBubble({
      club: action.club,
      title: cup.title,
      date: thaiDay.format(new Date(cup.date + 'T12:00:00+07:00')),
      rows,
      url: urls[action.club],
    });
    return flexMessage(
      [card],
      'ผล ' +
        clean(cup.title) +
        ' · แชมป์ ' +
        rows
          .filter(r => r.rank === 1)
          .map(r => r.name)
          .join(', '),
    );
  }
  if (action.kind === 'leaderboard') {
    const selected = action.scope === 'all' ? clubs : [action.scope];
    const tables = await Promise.all(selected.map(club => leaderboardRows(env, club)));
    if (tables.some(rows => !rows)) return null;
    const cards = selected.map((club, i) =>
      leaderboardBubble({
        club,
        rows: tables[i].map(r => ({ ...r, name: clean(r.name) })),
        url: leaderboardLink(courtUrl(env, club)),
      }),
    );
    return flexMessage(
      cards,
      selected
        .map((club, i) => clubOf(club).label + ' อันดับ 1 ' + (clean(tables[i][0]?.name) || '-'))
        .join(' · '),
    );
  }
  return null;
}

async function shortcutText(action, env, urls) {
  const club = action.club;
  const cupName = clubOf(club).cupName;
  if (action.kind === 'help')
    return [
      '🏸 คำสั่ง Badbot',
      ...[...shortcuts].map(([key, value]) => 'badbot ' + key + ' · ' + value.description),
    ].join('\n');
  if (action.kind === 'bill') return billingLineText(env, action.scope, new URL(urls.sena).origin);
  if (action.kind === 'book') return '🏸 จอง / ถอน ' + clubOf(club).label + '\n' + urls[club];
  if (action.kind === 'matchup') {
    const round = await matchupRound(env);
    if (round.error) return round.error;
    const { session, heading, name } = round;
    return boundedSection([
      heading,
      ...session.schedule.schedule.map(
        m =>
          'เกม ' +
          m.round +
          ' · ' +
          m.ids.slice(0, 2).map(name).join(' / ') +
          ' vs ' +
          m.ids.slice(2).map(name).join(' / '),
      ),
    ]);
  }
  if (action.kind === 'cupMatchup') {
    const cup = await cupMatches(env, club);
    if (!cup) return 'ยังไม่มีตาราง ' + cupName + ' ที่กำลังรอแข่ง';
    return boundedSection([
      '🏸 ตาราง ' + cupName,
      ...cup.matches.map(
        (m, i) =>
          'เกม ' +
          (i + 1) +
          ' · ' +
          cup.teams[m.a].map(clean).join(' / ') +
          ' vs ' +
          cup.teams[m.b].map(clean).join(' / ') +
          (cupRest(cup, i) ? ' · เว้นพักก่อนเกมนี้' : ''),
      ),
    ]);
  }
  if (action.kind === 'cupResult') {
    const cup = await latestCup(env.DB, club);
    if (!cup) return 'ยังไม่มีผล ' + cupName + ' ที่บันทึกไว้';
    return boundedSection([
      '🏆 ผล ' + clean(cup.title),
      thaiDay.format(new Date(cup.date + 'T12:00:00+07:00')),
      ...cupRanks(cup).map(
        row =>
          (row.rank === 1 ? '🥇 ' : '') +
          row.rank +
          '. ' +
          clean(row.name) +
          ' · ชนะ ' +
          row.w +
          '/' +
          row.played +
          ' · แต้ม ' +
          row.pf +
          '–' +
          row.pa,
      ),
    ]);
  }
  const selected = action.scope === 'all' ? clubs : [action.scope];
  const sections = await Promise.all(
    selected.map(club => leaderboardSection(env, club, courtUrl(env, club))),
  );
  return sections.join('\n\n━━━━━━━━━━\n\n');
}

async function leaderboardSection(env, club, url) {
  const heading = '🏆 ' + clubOf(club).label + ' Leaderboard';
  const standings = await leaderboardRows(env, club);
  if (!standings) return heading + '\nอ่านอันดับไม่สำเร็จ';
  const topFive = standings
    .slice(0, 5)
    .map(
      (row, i) =>
        (row.position ?? i + 1) + '. ' + clean(row.name) + ' · ชนะ ' + row.w + '/' + row.played,
    );
  return [
    heading,
    ...(topFive.length ? topFive : ['ยังไม่มีข้อมูลอันดับ']),
    'ดูอันดับทั้งหมด: ' + leaderboardLink(url),
  ].join('\n');
}

function textMessages(text) {
  const chunks = [''];
  for (const line of text.split('\n')) {
    const i = chunks.length - 1;
    if (chunks[i].length + line.length + 1 > 4800) chunks.push(line);
    else chunks[i] += (chunks[i] ? '\n' : '') + line;
  }
  return chunks.map(text => ({ type: 'text', text }));
}

// Reply to a withdrawal notice: tag whoever moved up from the waitlist (a real
// mention when their LINE account is linked and in this group), then the round.
async function withdrawMessages(env, group, club, { sessionId, date, promotedIds }, now) {
  const data = await bookingData(env, club),
    round = data?.sessions.find(s => s.id === sessionId),
    suffix = 'ได้สิทธิ์เล่น ' + noticeClub(club) + ' ' + noticeDay(date) + ' แล้ว';
  const messages = [];
  if (round) {
    const confirmed = new Set(
      round.registrations.filter(r => r.status === 'confirmed').map(r => r.playerId),
    );
    const ids = promotedIds.filter(id => confirmed.has(id)),
      name = displayNames(data, round);
    let links = [];
    if (ids.length) {
      await prepareMembers(env.DB);
      links = (
        await env.DB.prepare(
          "SELECT player_id,user_id FROM member_links WHERE status='approved' AND club=? AND player_id IN (" +
            ids.map(() => '?').join(',') +
            ')',
        )
          .bind(club, ...ids)
          .all()
      ).results;
    }
    const targets = await Promise.all(
      links.map(async link => ({
        playerId: link.player_id,
        ...(await groupMentionTarget(env, group, link.user_id)),
      })),
    );
    const tagged = targets.filter(target => target.reason === 'mention_ready');
    const people = tagged.map(target => ({
      userId: target.userId,
      risk: mentionNameRisk(target.displayName),
    }));
    for (const chunk of planMentionMessages(people).slice(0, 3))
      messages.push(mentionGroupMessage(chunk, '🎉 ', suffix));
    const plain = ids.filter(id => !tagged.some(target => target.playerId === id)).map(name);
    if (plain.length)
      messages.push({ type: 'text', text: '🎉 ' + plain.join(', ') + ' ' + suffix });
  }
  const highlight = new Map((round ? promotedIds : []).map(id => [id, '⬆️']));
  const card = await rosterCard(env, club, now, { data, sessionId, highlight });
  return [...messages.slice(0, 4), flexMessage([card.bubble], card.alt)];
}

// Reply to a booking notice: the nearest booked round as a card (the booker
// marked ✨), a line for each other booked day, and a free quick-reply button
// per day for its full list.
async function bookMessages(env, club, { playerId, sessionIds }, now) {
  const data = await bookingData(env, club);
  const rounds = (data?.sessions ?? [])
    .filter(s => sessionIds.includes(s.id) && !s.started)
    .sort((a, b) => (a.date + 'T' + a.start).localeCompare(b.date + 'T' + b.start));
  if (!rounds.length) {
    const card = await rosterCard(env, club, now, { data });
    return [flexMessage([card.bubble], card.alt)];
  }
  const [nearest, ...others] = rounds;
  const name = clean(data.roster.find(p => p.id === playerId)?.name || 'ผู้เล่น');
  const card = await rosterCard(env, club, now, {
    data,
    sessionId: nearest.id,
    highlight: new Map([[playerId, '✨']]),
    extra: others.length ? otherDays(name, others) : [],
  });
  const message = flexMessage(
    [card.bubble],
    card.alt + (others.length ? ' · จองวันอื่นอีก ' + others.length + ' วัน' : ''),
  );
  if (others.length)
    message.quickReply = {
      items: others.slice(0, 13).map(s => ({
        type: 'action',
        action: {
          type: 'postback',
          label: noticeDay(s.date),
          data: 'badbot:round:' + club + ':' + s.id,
          displayText: '👥 รายชื่อ ' + clubOf(club).label + ' ' + noticeDay(s.date),
        },
      })),
    };
  return [message];
}

async function eventKey(event) {
  const value = event.source.groupId + '\n' + (event.webhookEventId || event.replyToken);
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// True when LINE's 400 points at a Flex message of this reply (a card it refused),
// as opposed to text/mention problems that resending as text cannot fix.
export function flexRejected(messages, error) {
  const flexAt = new Set(
    messages.flatMap((m, i) => (m.type === 'flex' ? ['messages[' + i + ']'] : [])),
  );
  const named = /^messages\[\d+\]/;
  const rejected = error?.details?.length
    ? error.details.map(d =>
        named.test(d.property || '')
          ? named.exec(d.property)[0]
          : /messages\[\d+\]/.exec(error.message || '')?.[0],
      )
    : [];
  return rejected.some(at => flexAt.has(at));
}

// Called only after lineWebhook verifies the signature. Never links a LINE user
// to a player, changes a booking, or falls back to the chargeable Push API.
export async function replyToGroupCommand(event, env) {
  const action = groupCommand(event),
    group = event.source?.groupId;
  if (!action || event.source?.type !== 'group' || !group || !event.replyToken) return;
  await env.DB.prepare(
    'CREATE TABLE IF NOT EXISTS line_groups (club TEXT PRIMARY KEY, group_id TEXT, pair_code TEXT, expires_at INTEGER)',
  ).run();
  const linked = await env.DB.prepare('SELECT club FROM line_groups WHERE group_id=? LIMIT 1')
    .bind(group)
    .first();
  if (!linked) return;
  if (!env.LINE_CHANNEL_ACCESS_TOKEN) throw Error('LINE reply is not configured');
  const urls = Object.fromEntries(clubs.map(club => [club, bookingUrl(env, club)])),
    collectUrls = Object.fromEntries(clubs.map(club => [club, collectUrl(env, club)])),
    now = new Date();
  const db = env.DB;
  await db
    .prepare(
      'CREATE TABLE IF NOT EXISTS line_reply_events (id TEXT PRIMARY KEY, created_at INTEGER NOT NULL)',
    )
    .run();
  await db
    .prepare('DELETE FROM line_reply_events WHERE created_at<?')
    .bind(+now - 7 * day)
    .run();
  const id = await eventKey(event);
  const claim = await db
    .prepare('INSERT OR IGNORE INTO line_reply_events (id,created_at) VALUES (?,?)')
    .bind(id, +now)
    .run();
  if (!claim.meta.changes) return;
  let notice = null;
  try {
    const messages = [],
      mentionDiagnostics = [];
    if (action.kind === 'notice') {
      notice = await claimNotice(db, action.code, +now);
      // Any linked group may answer, whichever club the code is for: people open
      // the other club's LIFF page from their own group (an 88 booking posted in
      // the Sena group). The code is one-time, so it cannot be answered twice.
      if (!notice) return;
      if (notice.kind === 'book')
        messages.push(...(await bookMessages(env, notice.club, notice.payload, now)));
      else if (notice.kind === 'withdraw')
        messages.push(...(await withdrawMessages(env, group, notice.club, notice.payload, now)));
      else if (notice.kind === 'bill') {
        const owed = await billingLineMessages(
          env,
          notice.club,
          siteOrigin(env),
          group,
          mentionDiagnostics,
          { rosterOf: rosterOf(env) },
        );
        if (!owed) return;
        messages.push(...owed);
      } else if (notice.kind === 'resubmit') {
        const chase = await resubmitMessages(env, group, notice.payload);
        if (!chase) return;
        messages.push(...chase);
      } else if (notice.kind === 'paid') {
        const info = await paidSummary(env, notice.payload.billId);
        if (!info) return;
        // Badges and the latest 🥇/💩 come from the booking roster; if it cannot be
        // read the card still goes out, just without them.
        const roster = (await bookingData(env, info.club))?.roster ?? [];
        messages.push(
          flexMessage(
            [paidBubble(info, roster, new URL(courtUrl(env, info.club)).origin)],
            paidAlt(info),
          ),
        );
      } else return;
    } else if (action.kind === 'round') {
      const card = await rosterCard(env, action.club, now, { sessionId: action.sessionId });
      messages.push(flexMessage([card.bubble], card.alt));
    } else if (action.kind === 'roster') {
      const selected = action.scope === 'all' ? clubs : [action.scope];
      const cards = await Promise.all(selected.map(club => rosterCard(env, club, now)));
      messages.push(
        flexMessage(
          cards.map(c => c.bubble),
          cards.map(c => c.alt).join(' · '),
        ),
      );
      if (action.scope === 'all')
        messages.at(-1).quickReply = {
          items: clubs.map(club => ({
            type: 'action',
            action: {
              type: 'postback',
              label: clubOf(club).label,
              data: 'badbot:roster:' + club,
              displayText: '👥 ขอรายชื่อผู้ตี ' + clubOf(club).label,
            },
          })),
        };
    } else if (action.kind === 'billTag' && memberMode(env) && env.LINE_LIFF_ID) {
      messages.push(
        ...(await billingLineMessages(
          env,
          action.scope,
          siteOrigin(env),
          group,
          mentionDiagnostics,
          { tagsFrom: action.offset },
        )),
      );
    } else if (action.kind === 'bill' && memberMode(env) && env.LINE_LIFF_ID) {
      messages.push(
        ...(await billingLineMessages(
          env,
          action.scope,
          siteOrigin(env),
          group,
          mentionDiagnostics,
          { rosterOf: rosterOf(env) },
        )),
      );
    } else if (action.kind === 'menu') {
      messages.push(menu(urls, collectUrls));
    } else {
      const card = await boardMessage(action, env, urls);
      messages.push(...(card ? [card] : textMessages(await shortcutText(action, env, urls))));
    }
    let response, evidence;
    const send = async body => {
      try {
        response = await fetch('https://api.line.me/v2/bot/message/reply', {
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
        evidence = await lineReplyEvidence(response, body);
      } catch (error) {
        logError('line-reply:send', error, { command: action.kind });
        response = undefined;
        evidence = {
          replyStatus: 0,
          outcome: 'network_error',
          error: { message: 'LINE reply timed out or network failed' },
          payload: redactedMentionPayload(body),
          payloadRedacted: true,
          renderingConfirmed: false,
        };
      }
    };
    await send(messages);
    // A Flex card LINE refuses must not leave the group without an answer: when
    // LINE points at a flex message (validation details), send the same reply
    // once more with the cards flattened to text. An expired token has no details.
    // LINE names the message either in each detail's property
    // ("messages[0].contents.body") or only in the error message, with properties
    // relative to the card ("A message (messages[0]) …" + "/body/contents/3").
    if (response?.status === 400 && flexRejected(messages, evidence?.error)) {
      logError('line-reply:flex-rejected', evidence.error?.message, {
        command: action.kind,
        details: evidence.error?.details,
      });
      await send(messages.map(flexFallback));
    }
    if (action.kind === 'bill')
      try {
        await db
          .prepare(
            'CREATE TABLE IF NOT EXISTS line_bill_diagnostics (group_id TEXT PRIMARY KEY,payload TEXT NOT NULL,updated_at TEXT NOT NULL)',
          )
          .run();
        const report = {
          ...evidence,
          command: 'badbot bill',
          mentionCount: messages.reduce(
            (n, m) =>
              n + Object.values(m.substitution || {}).filter(v => v.type === 'mention').length,
            0,
          ),
          messageTypes: messages.map(m => m.type),
          payers: mentionDiagnostics,
        };
        await db
          .prepare(
            'INSERT INTO line_bill_diagnostics VALUES(?,?,?) ON CONFLICT(group_id) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at',
          )
          .bind(group, JSON.stringify(report), new Date().toISOString())
          .run();
      } catch (error) {
        logError('line-reply:store-diagnostic', error);
      }
    if (!response) throw Error('LINE reply unavailable');
    if (!response.ok)
      logError('line-reply:rejected', evidence.error?.message, {
        command: action.kind,
        status: evidence.replyStatus,
        requestId: evidence.requestId,
        details: evidence.error?.details,
      });
    // Expired/used tokens and other permanent failures must never become Pushes.
    if (!response.ok && response.status !== 400) throw Error('LINE reply unavailable');
    // The caller counts an answered bill as the day's reminder (line-nudge.js).
    return response.ok && (action.kind === 'bill' || notice?.kind === 'bill') ? 'bill' : undefined;
  } catch (error) {
    await db.prepare('DELETE FROM line_reply_events WHERE id=?').bind(id).run();
    if (notice) await releaseNotice(db, action.code);
    throw error;
  }
}
