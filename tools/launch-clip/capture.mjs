// Produce the REAL Flex JSON Badbot sends, using the repo's own modules + mock data.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, writeFileSync } from 'node:fs';
mkdirSync(new URL('./build/', import.meta.url), { recursive: true });
const R = new URL('../../', import.meta.url).href;
const worker = (await import(R + 'worker.js')).default;
const { defaultSettings, bangkokDate } = await import(R + 'booking.js');
const { rosterBubble } = await import(R + 'line-roster-card.js');
const { owedMessage, paidBubble } = await import(R + 'line-bill-card.js');
const { gamesBubble, leaderboardBubble } = await import(R + 'line-board-cards.js');

const ORIGIN = 'https://site.local'; // replaced by local asset path when rendering
const out = {};

// --- menu via the real webhook ---
const db = new DatabaseSync(':memory:');
db.exec(
  'CREATE TABLE line_groups (club TEXT PRIMARY KEY,group_id TEXT,pair_code TEXT,expires_at INTEGER);' +
    'CREATE TABLE booking_clubs (club TEXT PRIMARY KEY,revision INTEGER,payload TEXT,updated_at TEXT)',
);
const group = 'C' + 'a'.repeat(32);
db.prepare('INSERT INTO line_groups (club,group_id) VALUES (?,?)').run('sena', group);
const env = {
  LINE_CHANNEL_SECRET: 's',
  LINE_CHANNEL_ACCESS_TOKEN: 't',
  DB: {
    prepare(sql) {
      const st = db.prepare(sql);
      let v = [];
      return {
        bind(...a) {
          v = a;
          return this;
        },
        first() {
          return st.get(...v);
        },
        all() {
          return { results: st.all(...v) };
        },
        run() {
          return { meta: { changes: st.run(...v).changes } };
        },
      };
    },
  },
};
for (const [club, table] of [
  ['sena', 'club_state'],
  ['88', 'club_state_88'],
]) {
  db.exec(
    `CREATE TABLE IF NOT EXISTS ${table} (id INTEGER PRIMARY KEY,revision INTEGER,payload TEXT,updated_at TEXT)`,
  );
  db.prepare(`INSERT INTO ${table} VALUES (1,1,?,?)`).run(
    JSON.stringify({ players: [], cup: null }),
    new Date().toISOString(),
  );
  db.prepare('INSERT INTO booking_clubs VALUES (?,1,?,?)').run(
    club,
    JSON.stringify({
      settings: { ...defaultSettings(), enabled: true },
      settingsVersion: 1,
      seq: 1,
      sessions: [],
    }),
    new Date().toISOString(),
  );
}
const calls = [];
globalThis.fetch = async (url, o) => {
  if (String(url).includes('/message/reply')) calls.push(JSON.parse(o.body));
  return Response.json({});
};
const raw = JSON.stringify({
  events: [
    {
      type: 'message',
      webhookEventId: 'e1',
      replyToken: 'r1',
      source: { type: 'group', groupId: group, userId: 'U1' },
      message: { type: 'text', text: 'badbot' },
    },
  ],
});
const key = await crypto.subtle.importKey(
  'raw',
  new TextEncoder().encode('s'),
  { name: 'HMAC', hash: 'SHA-256' },
  false,
  ['sign'],
);
const sig = Buffer.from(
  await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(raw)),
).toString('base64');
const waits = [];
await worker.fetch(
  new Request(ORIGIN + '/api/line/webhook', {
    method: 'POST',
    headers: { 'x-line-signature': sig },
    body: raw,
  }),
  env,
  { waitUntil: p => waits.push(p), passThroughOnException() {} },
);
await Promise.all(waits);
out.menu = calls[0].messages[0].contents;

// --- roster card after booking (mock players) ---
const names = [
  ['ต้น', 'red', 95, 3, '🥇'],
  ['มิ้นท์', 'blue', 40, 2],
  ['โอ๊ต', 'pink', 22, 1],
  ['แพร', 'green', 60, 2],
  ['บอส', 'yellow', 30, 1],
  ['ฝน', 'blue', 3, 0],
  ['เจ', 'red', 18, 1],
  ['กอล์ฟ', 'pink', 50, 2],
  ['นุ่น', 'green', 12, 1],
  ['พีท', 'yellow', 70, 3],
  ['ปุ๊ก', 'red', 8, 0, '💩'],
  ['เบียร์', 'green', 26, 1],
];
const roster = names.map(([name, line, plays, titles, award = ''], i) => ({
  id: 'p' + i,
  name,
  award,
  badge: { line, plays, titles },
}));
const session = {
  date: '2026-11-21',
  start: '19:00',
  end: '22:00',
  capacity: 12,
  confirmedCount: 12,
  waitlistCount: 0,
  courtNumbers: '3, 4, 5',
  registrations: roster.map((p, i) => ({ playerId: p.id, status: 'confirmed', position: i + 1 })),
};
out.roster = rosterBubble({ roster }, 'sena', session, {
  origin: ORIGIN,
  bookUrl: ORIGIN + '/court#booking',
  updated: '20:15',
  highlight: new Map([['p11', '✨']]),
});

// --- open bill card (fresh, nobody paid) ---
const unpaid = names.map(([n]) => ({ name: n, amount: 12000, note: '' }));
out.owed = owedMessage(
  [
    {
      club: 'sena',
      title: 'บิล Sena · ส. 21 พ.ย.',
      extra: '',
      owed: 144000,
      paidCount: 0,
      total: 12,
      unpaid,
      reviewing: 0,
      payUrl: ORIGIN + '/billing',
    },
  ],
  { heading: '', note: '', origin: ORIGIN },
).contents;
// --- all paid card ---
out.paid = paidBubble(
  {
    club: 'sena',
    label: 'SENA ส. 21 พ.ย.',
    full: true,
    total: 12,
    paidPeople: 12,
    totalPeople: 12,
    paid: names.map(([n], i) => ({
      name: n,
      payerKey: 'member:p' + i,
      amount: 12000,
      method: i % 4 === 3 ? 'cash' : 'transfer',
      shares: [],
    })),
    owing: [],
    paidSum: 144000,
    transfer: { count: 9, sum: 108000 },
    cash: { count: 3, sum: 36000 },
  },
  roster,
  ORIGIN,
);

writeFileSync(
  new URL('./build/flexdata.js', import.meta.url),
  'window.FLEX=' + JSON.stringify(out) + ';',
);
console.log(Object.keys(out), JSON.stringify(out).length);
