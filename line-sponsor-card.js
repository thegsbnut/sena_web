// Flex pieces for Cup sponsors: the strip under every marked club card and the
// thank-you / sponsor list card. Pure: callers pass rows that already carry the
// sponsor's display `name`.
// Spec: docs/superpowers/specs/2026-11-20-cup-sponsors-design.md
import { clubOf } from './clubs.js';
import { noticeDay } from './line-notices.js';
import { clubColor } from './line-roster-card.js';
import { goldHeader } from './line-board-cards.js';
import { activeSponsors, awardLabel } from './sponsors.js';
import { SPONSOR_MARK, markSponsor } from './line-sponsor-mark.js';

export { SPONSOR_MARK, markSponsor };
const GREY = '#8A8F98',
  INK = '#4D4430',
  MAX_LINES = 3;
const STRIP = {
  sena: { bg: '#FFF6DC', head: '#8A6400', line: '#F0DFA8' },
  88: { bg: '#EEF3FC', head: '#1F4E9A', line: '#CFDCF3' },
};
const clean = value =>
  String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
const text = (value, props = {}) => ({ type: 'text', text: clean(value) || ' ', ...props });
const vbox = (contents, props = {}) => ({ type: 'box', layout: 'vertical', contents, ...props });
const cupTitle = (club, cupDate) => clubOf(club).cupName.toUpperCase() + ' ' + noticeDay(cupDate);
const label = row => awardLabel(row.award, row.award_note);
const line = row => row.name + ' · ' + row.prize + ' ' + label(row);

export function sponsorStrip(club, rows, { thanks = false, cupDate }) {
  const tone = STRIP[club] || STRIP.sena;
  const shown = rows.slice(0, MAX_LINES);
  return vbox(
    [
      text(
        thanks
          ? '🎁 ขอบคุณสปอนเซอร์ ' + cupTitle(club, cupDate)
          : '🎁 ' + cupTitle(club, cupDate) + ' · สนับสนุนโดย',
        { size: 'xxs', weight: 'bold', color: tone.head, wrap: true },
      ),
      ...shown.map(row => text(line(row), { size: 'xxs', color: INK, wrap: true, maxLines: 2 })),
      ...(rows.length > shown.length
        ? [text(`+ อีก ${rows.length - shown.length} คน`, { size: 'xxs', color: GREY })]
        : []),
    ],
    {
      backgroundColor: tone.bg,
      borderColor: tone.line,
      borderWidth: 'light',
      cornerRadius: 'md',
      paddingAll: 'md',
      spacing: 'xs',
      margin: 'md',
    },
  );
}

function decorate(bubble, rows, today) {
  const mark = bubble?.[SPONSOR_MARK];
  if (!mark) return;
  const own = rows.filter(r => r.club === mark.club && !r.hidden);
  const shown = mark.cupDate
    ? own.filter(r => r.cup_date === mark.cupDate)
    : activeSponsors(own, today);
  if (!shown.length) return;
  const strip = sponsorStrip(mark.club, shown, {
    thanks: Boolean(mark.cupDate),
    cupDate: shown[0].cup_date,
  });
  if (bubble.footer) bubble.footer.contents.push(strip);
  else bubble.footer = vbox([strip], { paddingAll: 'lg', paddingTop: 'none' });
}

// Adds the strip under every marked bubble of the reply. `rows`: sponsors of
// every club with `name`; `today`: Thai date.
export function withSponsorStrips(messages, rows, today) {
  for (const message of messages) {
    if (message?.type !== 'flex') continue;
    const bubbles =
      message.contents.type === 'carousel' ? message.contents.contents : [message.contents];
    for (const bubble of bubbles) decorate(bubble, rows, today);
  }
  return messages;
}

// The thank-you card (with `highlightId`: the new sponsor up top) or the list of
// a Cup day's sponsors; an empty list invites people to sponsor.
export function sponsorBubble({ club, cupDate, rows, highlightId, joinUrl }) {
  const star = rows.find(r => r.id === highlightId);
  const body = [];
  if (star)
    body.push(
      text(star.name, { size: 'xl', weight: 'bold', wrap: true }),
      vbox(
        [
          text(star.prize, { size: 'md', weight: 'bold', wrap: true }),
          text('มอบให้ ' + label(star), { size: 'xs', color: '#6B4B00', wrap: true }),
        ],
        { backgroundColor: '#FFF6DC', cornerRadius: 'md', paddingAll: 'md', spacing: 'xs' },
      ),
      ...(star.message
        ? [text('"' + star.message + '"', { size: 'sm', color: GREY, wrap: true })]
        : []),
      { type: 'separator', margin: 'md', color: '#ECEEF1' },
    );
  if (rows.length) {
    body.push(
      text(`สปอนเซอร์วันนี้ทั้งหมด ${rows.length} คน`, {
        size: 'xs',
        weight: 'bold',
        color: GREY,
      }),
    );
    for (const row of rows)
      body.push(
        vbox(
          [
            text(row.name + ' · ' + row.prize, { size: 'sm', wrap: true }),
            text(label(row), { size: 'xxs', color: GREY, wrap: true }),
          ],
          { spacing: 'none' },
        ),
      );
  } else
    body.push(
      text('ยังไม่มีสปอนเซอร์ ' + clubOf(club).cupName + ' ' + noticeDay(cupDate), {
        size: 'sm',
        color: GREY,
        wrap: true,
      }),
    );
  // Not marked: the strip would only repeat the list this card already shows.
  return {
    type: 'bubble',
    size: 'mega',
    header: goldHeader(
      star ? '🎁 ขอบคุณสปอนเซอร์' : '🎁 สปอนเซอร์ ' + clubOf(club).cupName,
      cupTitle(club, cupDate),
    ),
    body: vbox(body, { paddingAll: 'lg', spacing: 'sm' }),
    footer: vbox(
      [
        {
          type: 'button',
          style: 'primary',
          color: clubColor(club),
          height: 'sm',
          action: { type: 'uri', label: '🎁 ร่วมเป็นสปอนเซอร์', uri: joinUrl },
        },
      ],
      { paddingAll: 'lg', paddingTop: 'none' },
    ),
  };
}

export const sponsorAlt = (club, cupDate, rows) =>
  '🎁 สปอนเซอร์ ' +
  cupTitle(club, cupDate) +
  (rows.length ? ' · ' + rows.map(r => r.name).join(', ') : ' · ยังไม่มี');
