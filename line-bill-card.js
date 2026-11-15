// Flex card for the "bill paid" summary Badbot posts when the last person pays.
// Pure: takes billing.js `paidSummary()` plus the public booking roster (for
// badges and the latest Cup's 🥇/💩) and returns one LINE bubble.
import { badgeImage } from './line-roster-card.js';

const GREEN = '#2E7D32',
  DARK = '#263238',
  GREY = '#8A8F98',
  AMBER = '#B26A00',
  RED = '#C62828',
  TRACK = '#ECEEF1';
// Keeps the bubble well under LINE's 30 KB limit even for a very large bill.
const MAX_ROWS = 40;

const money = cents => (cents / 100).toLocaleString('th-TH', { maximumFractionDigits: 2 });
const clean = value =>
  String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
const text = (value, props = {}) => ({ type: 'text', text: clean(value) || ' ', ...props });
const box = (layout, contents, props = {}) => ({ type: 'box', layout, contents, ...props });
const vbox = (contents, props) => box('vertical', contents, props);
const hbox = (contents, props) => box('horizontal', contents, props);
const separator = () => ({ type: 'separator', margin: 'md', color: TRACK });

function row(payer, roster, origin, owing) {
  const player = roster.get(String(payer.payerKey || '').replace(/^member:/, ''));
  const others = (payer.shares || []).map(x => clean(x.name)).filter(n => n && n !== payer.name);
  const award = player?.award || '';
  const spans = [
    award && { type: 'span', text: award + ' ' },
    { type: 'span', text: clean(payer.name) },
    others.length && {
      type: 'span',
      text: ' (รวม ' + others.join(', ') + ')',
      size: 'xs',
      color: GREY,
    },
  ].filter(Boolean);
  const how = owing
    ? { text: 'ยังไม่จ่าย', color: RED }
    : payer.method === 'cash'
      ? { text: '💵 เงินสด', color: AMBER }
      : { text: '📲 โอน', color: GREEN };
  // Baseline: LINE accepts an icon only inside a baseline box.
  return box(
    'baseline',
    [
      { type: 'icon', url: badgeImage(origin, player?.badge), size: '18px' },
      { type: 'text', text: clean(payer.name), contents: spans, size: 'sm', wrap: true, flex: 1 },
      text(how.text, { size: 'xs', color: how.color, flex: 0, align: 'end' }),
      text(money(payer.amount), {
        size: 'sm',
        weight: 'bold',
        flex: 0,
        align: 'end',
        ...(owing ? { color: RED } : {}),
      }),
    ],
    { spacing: 'sm', margin: 'sm' },
  );
}

export function paidBubble(info, roster, origin) {
  const people = new Map(roster.map(p => [p.id, p]));
  const rows = [...info.paid.map(p => [p, false]), ...info.owing.map(p => [p, true])];
  const shown = rows.slice(0, MAX_ROWS);
  const methods = [
    info.transfer.count && `โอน ${info.transfer.count} คน`,
    info.cash.count && `เงินสด ${info.cash.count} คน`,
  ].filter(Boolean);
  const [day, ...rest] = info.label.split(' · ');
  return {
    type: 'bubble',
    size: 'mega',
    header: vbox(
      [
        text((info.full ? '✅ ' : '💸 ') + 'บิล ' + day + (info.full ? ' จ่ายครบแล้ว' : ''), {
          weight: 'bold',
          size: 'lg',
          color: '#FFFFFF',
          wrap: true,
        }),
        text(`${info.paidPeople}/${info.totalPeople} คน` + rest.map(r => ' · ' + r).join(''), {
          size: 'xs',
          color: '#FFFFFFD9',
        }),
      ],
      { backgroundColor: info.full ? GREEN : DARK, paddingAll: 'lg', spacing: 'xs' },
    ),
    body: vbox(
      [
        hbox(
          [
            text(money(info.paidSum), { size: 'xxl', weight: 'bold', flex: 0 }),
            text('บาท', { size: 'sm', color: GREY, flex: 0, margin: 'sm', gravity: 'bottom' }),
          ],
          { justifyContent: 'center', alignItems: 'flex-end' },
        ),
        ...(methods.length
          ? [text(methods.join(' · '), { size: 'xs', color: GREY, align: 'center' })]
          : []),
        separator(),
        ...shown.map(([p, owing]) => row(p, people, origin, owing)),
        ...(rows.length > shown.length
          ? [text(`… อีก ${rows.length - shown.length} คน`, { size: 'xs', color: GREY })]
          : []),
        separator(),
        hbox([
          text('รวม', { size: 'sm', weight: 'bold', flex: 1 }),
          text(money(info.paidSum) + ' บ.', { size: 'md', weight: 'bold', flex: 0, align: 'end' }),
        ]),
        ...(info.full
          ? [text('ขอบคุณทุกคนครับ 🙏🏸', { size: 'sm', align: 'center', margin: 'lg' })]
          : []),
      ],
      { spacing: 'xs', paddingAll: 'lg' },
    ),
  };
}

export const paidAlt = info =>
  (info.full ? '✅ บิล ' : '💸 บิล ') +
  info.label +
  (info.full ? ' จ่ายครบ ' : ' จ่ายแล้ว ') +
  `${info.paidPeople}/${info.totalPeople} · รวม ${money(info.paidSum)} บ.`;

// Outstanding-bills card ("badbot bill", or when a bill is opened): one bubble
// per bill. Everyone still owing is listed by name, so people the bot cannot tag
// still see themselves; the @ tags themselves follow as text messages because
// Flex cannot carry mentions. bills: [{ title, extra, owed, paidCount, total,
// unpaid: [{ name, amount, note }], reviewing, payUrl }]
const MAX_ROWS_PER_BILL = 20;
function owedRows(unpaid) {
  // Long lists collapse into one wrapped text so every name still fits the card.
  if (unpaid.length > MAX_ROWS_PER_BILL)
    return [
      {
        type: 'text',
        text: unpaid.map(p => '• ' + clean(p.name) + ' ' + money(p.amount) + ' บ.').join('\n'),
        size: 'xs',
        wrap: true,
      },
    ];
  return unpaid.map(p =>
    vbox(
      [
        hbox([
          {
            type: 'text',
            text: clean(p.name),
            contents: [
              { type: 'span', text: clean(p.name) },
              ...(p.people > 1
                ? [{ type: 'span', text: ` (รวม ${p.people} คน)`, size: 'xs', color: GREY }]
                : []),
            ],
            size: 'sm',
            wrap: true,
            flex: 1,
          },
          text(money(p.amount) + ' บ.', {
            size: 'sm',
            weight: 'bold',
            color: RED,
            flex: 0,
            align: 'end',
          }),
        ]),
        ...(p.note ? [text(p.note, { size: 'xxs', color: GREY, wrap: true })] : []),
      ],
      { margin: 'sm' },
    ),
  );
}

export function owedBubble(b, note) {
  const pct = Math.min(100, Math.round((100 * b.paidCount) / (b.total || 1)));
  return {
    type: 'bubble',
    size: 'mega',
    header: vbox(
      [
        text('💸 ' + b.title, { weight: 'bold', size: 'lg', color: '#FFFFFF', wrap: true }),
        text((b.extra ? b.extra + ' · ' : '') + `จ่ายแล้ว ${b.paidCount}/${b.total} คน`, {
          size: 'xs',
          color: '#FFFFFFD9',
        }),
      ],
      { backgroundColor: DARK, paddingAll: 'lg', spacing: 'xs' },
    ),
    body: vbox(
      [
        hbox(
          [
            text('ค้าง', { size: 'sm', color: GREY, flex: 0, gravity: 'bottom' }),
            text(money(b.owed), { size: 'xxl', weight: 'bold', flex: 0, margin: 'sm' }),
            text('บาท', { size: 'sm', color: GREY, flex: 0, margin: 'sm', gravity: 'bottom' }),
          ],
          { justifyContent: 'center', alignItems: 'flex-end' },
        ),
        vbox(
          [
            vbox([{ type: 'filler' }], {
              width: Math.max(pct, 1) + '%',
              height: '6px',
              backgroundColor: GREEN,
            }),
          ],
          { backgroundColor: TRACK, height: '6px', cornerRadius: 'md', margin: 'md' },
        ),
        ...(b.unpaid.length
          ? [
              text('ยังไม่จ่าย ' + b.unpaid.reduce((n, p) => n + (p.people || 1), 0) + ' คน', {
                size: 'xs',
                weight: 'bold',
                color: RED,
                margin: 'lg',
              }),
              ...owedRows(b.unpaid),
            ]
          : []),
        ...(b.reviewing
          ? [
              text(`รอตรวจสลิป/เงินสด ${b.reviewing} คน`, {
                size: 'xs',
                weight: 'bold',
                color: AMBER,
                margin: 'lg',
              }),
            ]
          : []),
        ...(note ? [text(note, { size: 'xxs', color: GREY, wrap: true, margin: 'lg' })] : []),
      ],
      { spacing: 'xs', paddingAll: 'lg' },
    ),
    footer: vbox(
      [
        {
          type: 'button',
          style: 'primary',
          color: GREEN,
          height: 'sm',
          action: { type: 'uri', label: '💳 จ่าย / ดู QR', uri: b.payUrl },
        },
      ],
      { paddingAll: 'lg', paddingTop: 'none' },
    ),
  };
}

// The whole card, or null when it would not fit LINE's limits (30 KB a bubble,
// 50 KB a carousel, 12 bubbles): the caller then sends the plain-text summary.
export function owedMessage(bills, { heading, note }) {
  if (!bills.length || bills.length > 12) return null;
  const bubbles = bills.map((b, i) => owedBubble(b, i === bills.length - 1 ? note : ''));
  const message = {
    type: 'flex',
    altText: (
      heading +
      ' · ' +
      bills
        .map(
          b =>
            b.title.replace(/^บิล /, '') +
            ' ค้าง ' +
            b.unpaid.reduce((n, p) => n + (p.people || 1), 0) +
            ' คน',
        )
        .join(' · ')
    ).slice(0, 400),
    contents: bubbles.length === 1 ? bubbles[0] : { type: 'carousel', contents: bubbles },
  };
  const size = bubble => new TextEncoder().encode(JSON.stringify(bubble)).length;
  if (bubbles.some(b => size(b) > 28000) || size(message.contents) > 45000) return null;
  return message;
}
