// Flex cards for Badbot's table replies: pair-up schedules (regular round and
// Cup), the leaderboard and the latest Cup result. Pure: callers pass plain
// rows, so nothing here reads the database.
import { clubOf } from './clubs.js';

const COLORS = { sena: '#168B42', 88: '#1F4E9A' };
const GOLD = '#B8860B',
  GREY = '#8A8F98',
  AMBER = '#B26A00',
  TRACK = '#ECEEF1';
// Keeps one bubble well under LINE's 30 KB limit.
const MAX_GAMES = 20;

const clean = value =>
  String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
const text = (value, props = {}) => ({ type: 'text', text: clean(value) || ' ', ...props });
const vbox = (contents, props = {}) => ({ type: 'box', layout: 'vertical', contents, ...props });
const hbox = (contents, props = {}) => ({ type: 'box', layout: 'horizontal', contents, ...props });
const separator = () => ({ type: 'separator', margin: 'md', color: TRACK });
const goldHeader = (title, subtitle) =>
  vbox(
    [
      text(title, { weight: 'bold', size: 'lg', color: '#FFFFFF', wrap: true }),
      ...(subtitle ? [text(subtitle, { size: 'xs', color: '#FFFFFFD9', wrap: true })] : []),
    ],
    {
      background: {
        type: 'linearGradient',
        angle: '135deg',
        startColor: GOLD,
        endColor: '#E0B33A',
      },
      paddingAll: 'lg',
      spacing: 'xs',
    },
  );
const clubHeader = (club, title, subtitle) =>
  vbox(
    [
      text(title, { weight: 'bold', size: 'lg', color: '#FFFFFF', wrap: true }),
      ...(subtitle ? [text(subtitle, { size: 'xs', color: '#FFFFFFD9', wrap: true })] : []),
    ],
    { backgroundColor: COLORS[club] || COLORS.sena, paddingAll: 'lg', spacing: 'xs' },
  );
const linkButton = (label, uri) =>
  vbox(
    [{ type: 'button', style: 'secondary', height: 'sm', action: { type: 'uri', label, uri } }],
    { paddingAll: 'lg', paddingTop: 'none' },
  );

// One game per line: "เกม n · A / B  vs  C / D". `rest` flags a back-to-back
// game in a Cup (the player rests first), shown on a warm background.
function game(g) {
  return hbox(
    [
      text('เกม ' + g.round, { size: 'xs', color: GREY, flex: 0, gravity: 'center' }),
      text(g.left.map(clean).join(' / '), { size: 'sm', wrap: true, flex: 1 }),
      text('vs', { size: 'xxs', color: GREY, flex: 0, gravity: 'center' }),
      text(g.right.map(clean).join(' / '), { size: 'sm', wrap: true, flex: 1, align: 'end' }),
    ],
    {
      spacing: 'sm',
      paddingTop: 'sm',
      paddingBottom: 'sm',
      ...(g.rest ? { backgroundColor: '#FFF8E1' } : {}),
    },
  );
}

// games: [{ round, left: [names], right: [names], rest? }]
export function gamesBubble({ club, title, subtitle, games, url, buttonLabel }) {
  const shown = games.slice(0, MAX_GAMES);
  const body = shown.flatMap((g, i) => [...(i ? [separator()] : []), game(g)]);
  if (games.length > shown.length)
    body.push(
      text(`… อีก ${games.length - shown.length} เกม`, {
        size: 'xs',
        color: GREY,
        align: 'center',
        margin: 'md',
      }),
    );
  if (games.some(g => g.rest))
    body.push(text('แถบเหลือง = เว้นพักก่อนเกมนี้', { size: 'xxs', color: AMBER, margin: 'md' }));
  return {
    type: 'bubble',
    size: 'mega',
    header: clubHeader(club, title, subtitle),
    body: vbox(body, { paddingAll: 'lg' }),
    ...(url ? { footer: linkButton(buttonLabel || 'ดูตารางทั้งหมดบนเว็บ', url) } : {}),
  };
}

const MEDAL = ['🥇', '🥈', '🥉'];
// The three podium blocks stand at different heights, 1st tallest in the middle.
function podium(rows) {
  const block = (row, place) =>
    vbox(
      [
        text(MEDAL[place], { size: 'xxl', align: 'center' }),
        text(row.name, { size: 'sm', weight: 'bold', align: 'center', wrap: true }),
        text(`ชนะ ${row.w}/${row.played}`, { size: 'xxs', color: GREY, align: 'center' }),
      ],
      {
        flex: 1,
        height: ['118px', '104px', '96px'][place],
        backgroundColor: ['#FFF4CC', '#EEF0F3', '#F7E6DA'][place],
        cornerRadius: 'md',
        paddingAll: 'sm',
        spacing: 'xs',
      },
    );
  return hbox([block(rows[1], 1), block(rows[0], 0), block(rows[2], 2)].filter(Boolean), {
    spacing: 'sm',
    alignItems: 'flex-end',
  });
}

// rows: [{ position?, name, w, played }] already ranked best first.
export function leaderboardBubble({ club, rows, url }) {
  const top = rows.slice(0, 5);
  const podiumRows = top.length >= 3 ? top.slice(0, 3) : [];
  const rest = podiumRows.length ? top.slice(3) : top;
  const body = [
    ...(podiumRows.length ? [podium(podiumRows)] : []),
    ...rest.flatMap((row, i) => [
      ...(i || podiumRows.length ? [separator()] : []),
      hbox(
        [
          text(`${row.position ?? top.indexOf(row) + 1}. ${row.name}`, {
            size: 'sm',
            wrap: true,
            flex: 1,
          }),
          text(`ชนะ ${row.w}/${row.played}`, { size: 'xs', color: GREY, flex: 0, align: 'end' }),
        ],
        { paddingTop: 'sm', paddingBottom: 'sm' },
      ),
    ]),
    ...(top.length ? [] : [text('ยังไม่มีข้อมูลอันดับ', { size: 'sm', color: GREY })]),
  ];
  return {
    type: 'bubble',
    size: 'mega',
    header: goldHeader(
      '🏆 ' + clubOf(club).label + ' Leaderboard',
      'สะสมจาก ' + clubOf(club).cupName + ' ทุกครั้ง',
    ),
    body: vbox(body, { paddingAll: 'lg' }),
    ...(url ? { footer: linkButton('ดูอันดับทั้งหมด', url) } : {}),
  };
}

// rows: [{ rank, name, w, played, pf, pa }] best first; rank ties share a number.
export function cupResultBubble({ club, title, date, rows, url }) {
  const winners = rows.filter(r => r.rank === 1);
  const rest = rows.filter(r => r.rank !== 1);
  const body = [
    vbox(
      [
        text('🥇', { size: 'xxl', align: 'center' }),
        ...winners.flatMap(r => [
          text(r.name, { size: 'lg', weight: 'bold', align: 'center', wrap: true }),
          text(`ชนะ ${r.w}/${r.played} · แต้ม ${r.pf}–${r.pa}`, {
            size: 'xs',
            color: GREY,
            align: 'center',
          }),
        ]),
      ],
      { spacing: 'xs', paddingBottom: 'md' },
    ),
    ...rest.flatMap(r => [
      separator(),
      hbox(
        [
          text(`${r.rank}. ${r.name}`, { size: 'sm', wrap: true, flex: 1 }),
          text(`${r.w}/${r.played} · ${r.pf}–${r.pa}`, {
            size: 'xs',
            color: GREY,
            flex: 0,
            align: 'end',
          }),
        ],
        { paddingTop: 'sm', paddingBottom: 'sm' },
      ),
    ]),
  ];
  return {
    type: 'bubble',
    size: 'mega',
    header: goldHeader('🏆 ' + clean(title), date),
    body: vbox(body, { paddingAll: 'lg' }),
    ...(url ? { footer: linkButton('ดูอันดับ ' + clubOf(club).cupName, url) } : {}),
  };
}
