// Bill cards in the น้องขุนเงิน style: the mascot on top, a speech line, the
// amount on a gradient price tag, one chick per person (mint = paid, faded = not
// yet), then the names. Pure functions; mascot images live in public/mascot/.
// LINE rules kept: icons only inside baseline boxes, no absolute positioning.
import { badgeImage } from './line-roster-card.js';

// Bump when a file in public/mascot/ changes: LINE caches images by URL.
const MASCOT_VERSION = '1';
const THEMES = {
  sena: {
    deep: '#0B6B47',
    main: '#17A673',
    from: '#34C892',
    to: '#0E8F67',
    bg: '#F2FBF6',
    line: '#D3EFE0',
  },
  88: {
    deep: '#17386F',
    main: '#3F7FD6',
    from: '#5C9BF0',
    to: '#2558B0',
    bg: '#F3F7FD',
    line: '#D6E3F7',
  },
};
const OWE = '#E25563',
  OWE_BG = '#FDE7EA',
  WAIT = '#C98A12',
  WAIT_BG = '#FFF3D6',
  GREY = '#7D8A84',
  INK = '#2B3A33',
  AVATARS = ['#D9F5EA', '#FFE3EA', '#FFF1C9', '#E2ECFF', '#EDE3FF'];
// Keeps the bubble well under LINE's 30 KB limit even for a very large bill.
const MAX_ROWS = 40;
// Past this many people the chick row becomes a progress bar.
const MAX_CHICKS = 12;

// What น้องขุนเงิน says. One line is picked by bill id, so a repost of the same
// bill shows the same line. She never names anyone; names stay in the list.
export const KHUN_NGERN_LINES = {
  open: [
    'พี่ๆ ขา~ น้องขุนเงินเปิดบิลแล้วน้า 💚',
    'ตีกันเหนื่อยแล้ว มาเคลียร์ค่าคอร์ตกันน้า 🏸',
    'บิลมาแล้วค่า~ โอนตามยอดของตัวเองได้เลยน้า 💸',
  ],
  remind: ['เหลืออีก {n} คนเองน้า ขุนเงินรออยู่ค่า 🥺', 'อีกนิดเดียวก็ครบแล้ว~ สู้ๆ น้า พี่ๆ 💪'],
  last: ['เหลือพี่คนสุดท้ายแล้วน้า~ ขุนเงินรอพี่อยู่ค่า 🥺💚'],
  full: ['ครบแล้วค่า~ ขอบคุณพี่ๆ ทุกคนน้า 🎉💚', 'เก็บครบทุกบาทแล้ว! เจอกันคอร์ตหน้านะคะ 🏸'],
  short: ['ยังขาดอีก {n} คนน้า~ ขุนเงินรอพี่ๆ อยู่นะคะ 🥺'],
};
function say(kind, seed, n) {
  const list = KHUN_NGERN_LINES[kind];
  let h = 0;
  for (const c of String(seed ?? '')) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return list[h % list.length].replace('{n}', n);
}

const money = cents => (cents / 100).toLocaleString('th-TH', { maximumFractionDigits: 2 });
const clean = value =>
  String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
const text = (value, props = {}) => ({ type: 'text', text: clean(value) || ' ', ...props });
const box = (layout, contents, props = {}) => ({ type: 'box', layout, contents, ...props });
const vbox = (contents, props) => box('vertical', contents, props);
const hbox = (contents, props) => box('horizontal', contents, props);
const theme = club => THEMES[club] || THEMES.sena;
// Old LINE versions ignore gradients and fall back to the solid colour.
const gradient = (from, to) => ({
  backgroundColor: to,
  background: { type: 'linearGradient', angle: '135deg', startColor: from, endColor: to },
});
const mascot = (origin, name) => origin + '/mascot/' + name + '?v=' + MASCOT_VERSION;
// First letter for the round avatar; Thai leading vowels are skipped (เอ็ม → อ).
const initial = name =>
  (Array.from(clean(name)).find(c => !/[เแโใไ\s]/.test(c)) || '?').toUpperCase();

const hero = url => ({
  type: 'image',
  url,
  size: 'full',
  aspectRatio: '20:13',
  aspectMode: 'cover',
});
const speech = (line, t) =>
  vbox(
    [
      text('💚 น้องขุนเงิน', { size: 'xxs', weight: 'bold', color: t.main }),
      text(line, { size: 'sm', weight: 'bold', color: t.deep, wrap: true, margin: 'xs' }),
    ],
    {
      backgroundColor: '#FFFFFF',
      cornerRadius: 'xl',
      borderWidth: '1px',
      borderColor: t.line,
      paddingAll: 'md',
    },
  );
const pill = (label, color, background, size = 'xxs') =>
  vbox([text(label, { size, weight: 'bold', color, align: 'center' })], {
    backgroundColor: background,
    cornerRadius: 'xxl',
    paddingStart: 'md',
    paddingEnd: 'md',
    paddingTop: 'xs',
    paddingBottom: 'xs',
    flex: 0,
    justifyContent: 'center',
  });
const priceTag = (caption, label, cents, status, [from, to]) =>
  vbox(
    [
      text(caption, { size: 'xxs', color: '#FFFFFFD9', wrap: true }),
      hbox(
        [
          vbox(
            [
              text(label, { size: 'xs', color: '#FFFFFFE6' }),
              text('฿' + money(cents), { size: '3xl', weight: 'bold', color: '#FFFFFF' }),
            ],
            { flex: 1 },
          ),
          ...(status ? [status] : []),
        ],
        { alignItems: 'center', margin: 'sm' },
      ),
    ],
    { ...gradient(from, to), cornerRadius: 'xl', paddingAll: 'lg' },
  );
const panel = (contents, t) =>
  vbox(contents, {
    backgroundColor: '#FFFFFF',
    cornerRadius: 'lg',
    borderWidth: '1px',
    borderColor: t.line,
    paddingAll: 'md',
  });
function chicks(paid, total, t, origin) {
  const head = text(`จ่ายแล้ว ${paid}/${total} คน`, { size: 'xs', weight: 'bold', color: t.deep });
  if (total > MAX_CHICKS || total < 1) {
    const pct = Math.max(1, Math.min(100, Math.round((100 * paid) / (total || 1))));
    return panel(
      [
        head,
        vbox(
          [
            vbox([{ type: 'filler' }], {
              width: pct + '%',
              height: '10px',
              ...gradient(t.from, t.to),
              cornerRadius: 'md',
            }),
          ],
          { backgroundColor: t.line, height: '10px', cornerRadius: 'md', margin: 'sm' },
        ),
      ],
      t,
    );
  }
  const icons = Array.from({ length: total }, (_, i) => ({
    type: 'icon',
    url: mascot(origin, i < paid ? 'chick.png' : 'chick-off.png'),
    size: '22px',
  }));
  // Baseline: LINE accepts an icon only inside a baseline box (with text/filler).
  return panel(
    [head, box('baseline', [...icons, { type: 'filler' }], { margin: 'sm', spacing: 'xs' })],
    t,
  );
}
const avatar = (name, i) =>
  vbox([text(initial(name), { size: 'xs', weight: 'bold', color: INK, align: 'center' })], {
    width: '28px',
    height: '28px',
    cornerRadius: 'xxl',
    backgroundColor: AVATARS[i % AVATARS.length],
    justifyContent: 'center',
    flex: 0,
  });
// Players show their job badge; guests and people not in the roster get a round initial.
const lead = (p, origin, index) =>
  p.badge
    ? box('baseline', [{ type: 'icon', url: badgeImage(origin, p.badge), size: '22px' }], {
        width: '28px',
        flex: 0,
      })
    : avatar(p.name, index);
const nameText = (spans, plain) => ({
  type: 'text',
  text: clean(plain) || ' ',
  contents: spans,
  size: 'sm',
  color: INK,
  wrap: true,
  flex: 1,
  gravity: 'center',
  margin: 'md',
});
const signoff = (line, origin) =>
  box(
    'baseline',
    [
      { type: 'icon', url: mascot(origin, 'chick.png'), size: '18px' },
      text(line, { size: 'xxs', color: GREY, wrap: true, flex: 1, margin: 'sm' }),
    ],
    { margin: 'md' },
  );

// ---------- สรุปบิล (paid summary) ----------
// Takes billing.js `paidSummary()` plus the public booking roster (badges and the
// latest Cup's 🥇/💩) and returns one LINE bubble.
function paidRow(payer, roster, origin, owing, index) {
  const player = roster.get(String(payer.payerKey || '').replace(/^member:/, ''));
  const others = (payer.shares || []).map(x => clean(x.name)).filter(n => n && n !== payer.name);
  const award = player?.award || '';
  const spans = [
    award && { type: 'span', text: award + ' ' },
    { type: 'span', text: clean(payer.name) },
    others.length && {
      type: 'span',
      text: ' (รวม ' + others.join(', ') + ')',
      size: 'xxs',
      color: GREY,
    },
  ].filter(Boolean);
  const how = owing
    ? { text: 'ยังไม่จ่าย', color: OWE }
    : payer.method === 'cash'
      ? { text: '💵 เงินสด', color: WAIT }
      : { text: '📲 โอน', color: GREY };
  return hbox(
    [
      lead({ name: payer.name, badge: player?.badge }, origin, index),
      nameText(spans, payer.name),
      text(how.text, { size: 'xxs', color: how.color, flex: 0, gravity: 'center' }),
      text(money(payer.amount), {
        size: 'sm',
        weight: 'bold',
        color: owing ? OWE : INK,
        flex: 0,
        align: 'end',
        margin: 'md',
        gravity: 'center',
      }),
    ],
    { margin: 'md', alignItems: 'center' },
  );
}

export function paidBubble(info, roster, origin) {
  const t = theme(info.club);
  const people = new Map(roster.map(p => [p.id, p]));
  const rows = [...info.paid.map(p => [p, false]), ...info.owing.map(p => [p, true])];
  const shown = rows.slice(0, MAX_ROWS);
  const short = info.totalPeople - info.paidPeople;
  const ways = [
    info.transfer.count && `📲 โอน ${info.transfer.count}`,
    info.cash.count && `💵 เงินสด ${info.cash.count}`,
  ].filter(Boolean);
  return {
    type: 'bubble',
    size: 'mega',
    hero: hero(mascot(origin, info.full ? 'done.jpg' : 'remind.jpg')),
    body: vbox(
      [
        speech(info.full ? say('full', info.id) : say('short', info.id, short), t),
        priceTag(
          (info.full ? '✅ บิล ' : '💸 บิล ') +
            info.label +
            (info.full ? ' จ่ายครบแล้ว' : '') +
            ways.map(w => ' · ' + w).join(''),
          'ได้รับแล้ว',
          info.paidSum,
          info.full
            ? pill('ครบแล้ว ✓', t.deep, '#FFFFFF')
            : pill(`ขาด ${short} คน`, OWE, '#FFFFFF'),
          info.full ? [t.from, t.to] : ['#FF9DB0', OWE],
        ),
        chicks(info.paidPeople, info.totalPeople, t, origin),
        panel(
          [
            text('รายชื่อคนจ่าย', { size: 'xs', weight: 'bold', color: t.deep }),
            ...shown.map(([p, owing], i) => paidRow(p, people, origin, owing, i)),
            ...(rows.length > shown.length
              ? [
                  text(`… อีก ${rows.length - shown.length} คน`, {
                    size: 'xxs',
                    color: GREY,
                    margin: 'sm',
                  }),
                ]
              : []),
            hbox(
              [
                text('รวม', {
                  size: 'sm',
                  weight: 'bold',
                  color: t.deep,
                  flex: 1,
                  gravity: 'center',
                }),
                text(money(info.paidSum) + ' บ.', {
                  size: 'lg',
                  weight: 'bold',
                  color: t.main,
                  flex: 0,
                }),
              ],
              { margin: 'lg' },
            ),
          ],
          t,
        ),
      ],
      { backgroundColor: t.bg, paddingAll: 'lg', spacing: 'md' },
    ),
    footer: vbox(
      [
        signoff(
          info.full
            ? 'ขุนเงินเก็บครบแล้ว ไปตีแบดกันต่อน้า 🏸'
            : 'ใครยังไม่จ่าย กด "บิลค้าง" ในเมนูได้เลยค่ะ',
          origin,
        ),
      ],
      { backgroundColor: t.bg, paddingAll: 'lg', paddingTop: 'none' },
    ),
  };
}

export const paidAlt = info =>
  (info.full ? '✅ บิล ' : '💸 บิล ') +
  info.label +
  (info.full ? ' จ่ายครบ ' : ' จ่ายแล้ว ') +
  `${info.paidPeople}/${info.totalPeople} · รวม ${money(info.paidSum)} บ.`;

// ---------- เปิดบิล / บิลค้าง ----------
// "badbot bill", or when a bill is opened: one bubble per bill. Everyone still
// owing is listed by name, so people the bot cannot tag still see themselves; the
// @ tags follow as text messages because Flex cannot carry mentions.
// bills: [{ id, club, title, extra, owed, paidCount, total,
//   unpaid: [{ name, amount, people, note }], reviewing, payUrl }]
const MAX_ROWS_PER_BILL = 20;
function owedRows(unpaid, compact, origin) {
  // Long lists collapse into one wrapped text so every name still fits the card.
  if (unpaid.length > MAX_ROWS_PER_BILL)
    return [
      // Raw text: text() would collapse the line breaks between names.
      {
        type: 'text',
        text: unpaid.map(p => '• ' + clean(p.name) + ' ' + money(p.amount) + ' บ.').join('\n'),
        size: 'xs',
        wrap: true,
        margin: 'sm',
      },
    ];
  return unpaid.map((p, i) => {
    const name = {
      ...nameText(
        [
          ...(p.award ? [{ type: 'span', text: p.award + ' ' }] : []),
          { type: 'span', text: clean(p.name) },
          ...(p.people > 1
            ? [{ type: 'span', text: ` (รวม ${p.people} คน)`, size: 'xxs', color: GREY }]
            : []),
        ],
        p.name,
      ),
      ...(compact ? { margin: 'none' } : {}),
    };
    const amount = money(p.amount) + ' บ.';
    // Compact rows (many bills at once) drop the avatar and pill to stay small.
    const row = compact
      ? hbox([name, text(amount, { size: 'sm', weight: 'bold', color: OWE, flex: 0 })], {
          margin: 'sm',
        })
      : hbox([lead(p, origin, i), name, pill(amount, OWE, OWE_BG, 'xs')], {
          alignItems: 'center',
          margin: 'md',
        });
    if (!p.note) return row;
    // The row's top margin moves to the wrapper so spacing matches plain rows.
    const { margin, ...inner } = row;
    return vbox([inner, text(p.note, { size: 'xxs', color: GREY, wrap: true, margin: 'xs' })], {
      margin,
    });
  });
}

export function owedBubble(b, note, origin, compact = false) {
  const t = theme(b.club);
  const left = b.unpaid.reduce((n, p) => n + (p.people || 1), 0);
  const fresh = b.paidCount === 0;
  const line = fresh
    ? say('open', b.id)
    : left === 1
      ? say('last', b.id)
      : say('remind', b.id, left);
  return {
    type: 'bubble',
    size: 'mega',
    hero: hero(mascot(origin, fresh ? 'open.jpg' : 'remind.jpg')),
    body: vbox(
      [
        speech(line, t),
        priceTag(
          '🧾 ' + b.title,
          'ยอดค้างทั้งหมด',
          b.owed,
          b.extra ? pill(b.extra, WAIT, WAIT_BG) : null,
          [t.from, t.to],
        ),
        chicks(b.paidCount, b.total, t, origin),
        ...(b.unpaid.length || b.reviewing
          ? [
              panel(
                [
                  ...(b.unpaid.length
                    ? [
                        text(`ยังไม่จ่าย ${left} คน`, { size: 'xs', weight: 'bold', color: OWE }),
                        ...owedRows(b.unpaid, compact, origin),
                      ]
                    : []),
                  ...(b.reviewing
                    ? [
                        hbox([pill(`⏳ รอตรวจสลิป/เงินสด ${b.reviewing} คน`, WAIT, WAIT_BG)], {
                          margin: b.unpaid.length ? 'lg' : 'none',
                        }),
                      ]
                    : []),
                ],
                t,
              ),
            ]
          : []),
        ...(note ? [text(note, { size: 'xxs', color: GREY, wrap: true })] : []),
      ],
      { backgroundColor: t.bg, paddingAll: 'lg', spacing: 'md' },
    ),
    footer: vbox(
      [
        {
          type: 'button',
          style: 'primary',
          color: t.main,
          height: 'md',
          action: { type: 'uri', label: '💳 จ่าย / ดู QR', uri: b.payUrl },
        },
        signoff('จ่ายแล้วแนบสลิปในหน้าจ่ายได้เลยน้า ขอบคุณค่ะ', origin),
      ],
      { backgroundColor: t.bg, paddingAll: 'lg', paddingTop: 'none' },
    ),
  };
}

// The whole card, or null when it would not fit LINE's limits (30 KB a bubble,
// 50 KB a carousel, 12 bubbles): the caller then sends the plain-text summary.
export function owedMessage(bills, { heading, note, origin }) {
  if (!bills.length || bills.length > 12) return null;
  const size = value => new TextEncoder().encode(JSON.stringify(value)).length;
  const build = compact => {
    const bubbles = bills.map((b, i) =>
      owedBubble(b, i === bills.length - 1 ? note : '', origin, compact),
    );
    return bubbles.length === 1 ? bubbles[0] : { type: 'carousel', contents: bubbles };
  };
  const fits = contents =>
    (contents.contents || [contents]).every(b => size(b) <= 28000) && size(contents) <= 45000;
  // Full rows first; a big batch of bills falls back to compact rows, then to text.
  let contents = build(false);
  if (!fits(contents)) contents = build(true);
  if (!fits(contents)) return null;
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
    contents,
  };
  return message;
}
