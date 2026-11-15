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
const vbox = (contents, props = {}) => ({ type: 'box', layout: 'vertical', contents, ...props });
const hbox = (contents, props = {}) => ({ type: 'box', layout: 'horizontal', contents, ...props });
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
  return hbox(
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
    { spacing: 'sm', alignItems: 'center', margin: 'sm' },
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
        text(`${info.paid.length}/${info.total} คน` + rest.map(r => ' · ' + r).join(''), {
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
  `${info.paid.length}/${info.total} · รวม ${money(info.paidSum)} บ.`;
