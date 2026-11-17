import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from './worker.js';
import { defaultSettings, bangkokDate } from './booking.js';
import { prepareMembers } from './member.js';
import { billingLineMessages } from './billing.js';
import { groupMentionTarget } from './line-mentions.js';
import { createNotice, noticeDay } from './line-notices.js';
import { badgeImage, rosterBubble } from './line-roster-card.js';
import { owedMessage, paidBubble } from './line-bill-card.js';
import { cupResultBubble, gamesBubble, leaderboardBubble } from './line-board-cards.js';

const origin = 'https://example.com',
  group = 'C' + 'a'.repeat(32);
const future = n => bangkokDate(new Date(Date.now() + n * 86400000));
const nextWeekday = () => new Date(future(1) + 'T12:00:00Z').getUTCDay();
function fixture(t) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  db.exec(
    'CREATE TABLE line_groups (club TEXT PRIMARY KEY,group_id TEXT,pair_code TEXT,expires_at INTEGER);' +
      'CREATE TABLE booking_clubs (club TEXT PRIMARY KEY,revision INTEGER,payload TEXT,updated_at TEXT)',
  );
  db.prepare('INSERT INTO line_groups (club,group_id) VALUES (?,?)').run('sena', group);
  const env = {
    LINE_CHANNEL_SECRET: 'only-for-tests-secret',
    LINE_CHANNEL_ACCESS_TOKEN: 'only-for-tests-token',
    DB: {
      prepare(sql) {
        const stmt = db.prepare(sql);
        let values = [];
        return {
          bind(...args) {
            values = args;
            return this;
          },
          first() {
            return stmt.get(...values);
          },
          all() {
            return { results: stmt.all(...values) };
          },
          run() {
            return { meta: { changes: stmt.run(...values).changes } };
          },
        };
      },
    },
  };
  function seed(club, sessions = [], enabled = true, names = ['Nut', 'Bua', 'Bomb']) {
    const table = club === '88' ? 'club_state_88' : 'club_state';
    db.exec(
      `CREATE TABLE IF NOT EXISTS ${table} (id INTEGER PRIMARY KEY,revision INTEGER,payload TEXT,updated_at TEXT)`,
    );
    const players = names.map((name, i) => ({ id: 'p' + i, name, thai: '', lv: 10, gender: 'M' }));
    db.prepare(`INSERT OR REPLACE INTO ${table} VALUES (1,1,?,?)`).run(
      JSON.stringify({ players, cup: null }),
      new Date().toISOString(),
    );
    db.prepare('INSERT OR REPLACE INTO booking_clubs VALUES (?,1,?,?)').run(
      club,
      JSON.stringify({
        settings: {
          ...defaultSettings(),
          enabled,
          weekdays: [nextWeekday()],
          weeks: 1,
          capacity: 8,
        },
        settingsVersion: 1,
        seq: 20,
        sessions,
      }),
      new Date().toISOString(),
    );
  }
  seed('sena');
  seed('88', [], false);
  const calls = [];
  let status = 200;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (String(url).startsWith('https://api.line.me/v2/bot/group/'))
      return Response.json({ userId: String(url).split('/').at(-1) });
    assert.equal(url, 'https://api.line.me/v2/bot/message/reply');
    assert.equal(options.headers.Authorization, 'Bearer ' + env.LINE_CHANNEL_ACCESS_TOKEN);
    calls.push(JSON.parse(options.body));
    return Response.json({}, { status });
  });
  const key = crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(env.LINE_CHANNEL_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  async function hook(events, { invalid = false, ctx } = {}) {
    const raw = JSON.stringify({ events });
    const signature = Buffer.from(
      await crypto.subtle.sign('HMAC', await key, new TextEncoder().encode(invalid ? '{}' : raw)),
    ).toString('base64');
    return worker.fetch(
      new Request(origin + '/api/line/webhook', {
        method: 'POST',
        headers: { 'x-line-signature': signature },
        body: raw,
      }),
      env,
      ctx,
    );
  }
  const event = (text = 'badbot', extra = {}) => ({
    type: 'message',
    webhookEventId: crypto.randomUUID(),
    replyToken: crypto.randomUUID(),
    source: { type: 'group', groupId: group, userId: 'LINE-user-not-a-player-id' },
    message: { type: 'text', text },
    ...extra,
  });
  return {
    db,
    env,
    seed,
    calls,
    hook,
    event,
    status(value) {
      status = value;
    },
  };
}
function session(date, { names = 2, closed = false, holiday = null, capacity = 8 } = {}) {
  return {
    id: date,
    date,
    start: '19:00',
    end: '21:00',
    capacity,
    rounds: 1,
    closed,
    holiday,
    regularSeen: [],
    hasFilled: false,
    registrations: Array.from({ length: names }, (_, i) => ({
      id: 'r' + i,
      playerId: 'p' + i,
      seq: i,
      source: 'manual',
      ownerHash: 'never-show-this',
    })),
  };
}
// Flex cards read as text: vertical boxes become lines, other boxes join with spaces.
const flexText = node => {
  if (!node || typeof node !== 'object') return '';
  if (node.type === 'text')
    return node.contents ? node.contents.map(span => span.text).join('') : node.text;
  if (node.type === 'button') return node.action.label;
  if (node.type === 'bubble')
    return [node.header, node.body, node.footer].map(flexText).filter(Boolean).join('\n');
  if (node.type === 'carousel') return node.contents.map(flexText).join('\n\n');
  if (node.type === 'box')
    return node.contents
      .map(flexText)
      .filter(Boolean)
      .join(node.layout === 'vertical' ? '\n' : ' ');
  return '';
};
// The structure rules LINE enforces that a text-only reading cannot see: an icon
// or a span-less text may sit in a baseline box, and a baseline box holds only
// text, icon and filler ("invalid box content type" otherwise).
const flexProblems = (node, parent = null, at = 'root') => {
  if (!node || typeof node !== 'object') return [];
  const problems = [];
  if (node.type === 'icon' && parent?.layout !== 'baseline')
    problems.push(at + ': icon outside a baseline box');
  if (node.type === 'box' && node.layout === 'baseline')
    for (const child of node.contents)
      if (!['text', 'icon', 'filler'].includes(child.type))
        problems.push(at + ': ' + child.type + ' inside a baseline box');
  if (node.type === 'bubble')
    for (const part of ['header', 'hero', 'body', 'footer'])
      problems.push(...flexProblems(node[part], node, at + '.' + part));
  if (node.type === 'carousel')
    node.contents.forEach((b, i) => problems.push(...flexProblems(b, node, at + '[' + i + ']')));
  if (node.type === 'box')
    node.contents.forEach((c, i) =>
      problems.push(...flexProblems(c, node, at + '.contents[' + i + ']')),
    );
  return problems;
};
// The bill summary as text, whether it came as a Flex card or plain text.
const summaryOf = m => (m.type === 'flex' ? flexText(m.contents) : m.text);
const textOf = call =>
  call.messages
    .filter(m => m.type === 'text' || m.type === 'flex')
    .map(m => (m.type === 'text' ? m.text : flexText(m.contents)))
    .join('\n');

test('in production the webhook answers LINE at once and finishes the reply in the background', async t => {
  // LINE cancels a webhook after ~2 s and a reply takes 1-2 s: the card must not
  // depend on the request staying open (15 Nov 2026: bill opened, nothing came up).
  const f = fixture(t);
  const sent = f.calls;
  let release;
  const gate = new Promise(resolve => (release = resolve));
  const fetchOnce = globalThis.fetch;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    await gate;
    return fetchOnce(url, options);
  });
  const background = [];
  const response = await f.hook([f.event('badbot')], {
    ctx: { waitUntil: promise => background.push(promise) },
  });
  assert.equal(response.status, 200, 'LINE is answered before the reply is sent');
  assert.equal(sent.length, 0);
  assert.equal(background.length, 1);
  release();
  await Promise.all(background);
  assert.equal(sent.length, 1, 'the reply goes out in the background');
});

test('signed bill webhook sends a real LINE mention object all the way to the reply API', async t => {
  const f = fixture(t),
    userId = 'U' + 'a'.repeat(32);
  f.env.LINE_MEMBER_AUTH_ENABLED = 'true';
  f.env.LINE_LIFF_ID = '12345-test';
  await prepareMembers(f.env.DB);
  f.db.exec(
    'CREATE TABLE bills(id TEXT PRIMARY KEY,club TEXT,session_date TEXT,revision INTEGER,payload TEXT,closed_at INTEGER,slips_removed INTEGER DEFAULT 0)',
  );
  f.db.prepare('INSERT INTO bills VALUES(?,?,?,0,?,NULL,0)').run(
    'a'.repeat(32),
    'sena',
    future(0),
    JSON.stringify({
      payers: [{ name: 'Nut', payerKey: 'member:p0', amount: 8500, status: 'unpaid' }],
    }),
  );
  f.db
    .prepare("INSERT INTO member_links VALUES(?,?,?,?,?,'approved',?)")
    .run(userId, 'sena', 'p0', 'Nut', 'existing', new Date().toISOString());
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (url === 'https://api.line.me/v2/bot/group/' + group + '/member/' + userId)
      return Response.json({ userId, displayName: 'Nut' });
    assert.equal(url, 'https://api.line.me/v2/bot/message/reply');
    f.calls.push(JSON.parse(options.body));
    return Response.json({ sentMessages: [{ id: 'test-message' }] });
  });
  assert.equal((await f.hook([f.event('badbot bill')])).status, 200);
  const [summary, message] = f.calls[0].messages;
  assert.equal(f.calls[0].messages.length, 2);
  assert.equal(summary.type, 'flex');
  // With LINE login the booking link is liff.line.me; card images must still
  // come from the web app (production showed blank mascots on 15 Nov 2026).
  const images = JSON.stringify(summary.contents).match(/https:\/\/[^"]+\/mascot\/[^"]+/g);
  assert(images.length > 0);
  assert(images.every(url => url.startsWith('https://sena-web.thegsbnut.workers.dev/mascot/')));
  assert.match(summaryOf(summary), /Nut 85 บ\./);
  assert.equal(message.type, 'textV2');
  assert.deepEqual(message.substitution, {
    m0: { type: 'mention', mentionee: { type: 'user', userId } },
  });
  // Padding after the name and closing text after it: the layout that rendered in the group.
  assert.equal(message.text, 'ค้างจ่าย: {m0}' + '\u200b'.repeat(16) + '\nชำระเงินผ่านลิงก์ด้านบน');
  assert.doesNotMatch(JSON.stringify(f.calls[0].messages), /@Nut/);
  const diagnostic = JSON.parse(
    f.db.prepare('SELECT payload FROM line_bill_diagnostics WHERE group_id=?').get(group).payload,
  );
  assert.equal(diagnostic.replyStatus, 200);
  assert.equal(diagnostic.mentionCount, 1);
  assert.deepEqual(diagnostic.messageTypes, ['flex', 'textV2']);
  assert.doesNotMatch(JSON.stringify(diagnostic), new RegExp(userId));
});

test('outstanding-bill cards get badges and awards from the roster, and still go out without it', async t => {
  const f = fixture(t),
    userId = 'U' + 'b'.repeat(32);
  f.env.LINE_MEMBER_AUTH_ENABLED = 'true';
  f.env.LINE_LIFF_ID = '12345-test';
  await prepareMembers(f.env.DB);
  f.db.exec(
    'CREATE TABLE bills(id TEXT PRIMARY KEY,club TEXT,session_date TEXT,revision INTEGER,payload TEXT,closed_at INTEGER,slips_removed INTEGER DEFAULT 0)',
  );
  f.db.prepare('INSERT INTO bills VALUES(?,?,?,0,?,NULL,0)').run(
    'b'.repeat(32),
    'sena',
    future(0),
    JSON.stringify({
      payers: [{ name: 'Nut', payerKey: 'member:p0', amount: 8500, status: 'unpaid' }],
    }),
  );
  f.db
    .prepare("INSERT INTO member_links VALUES(?,?,?,?,?,'approved',?)")
    .run(userId, 'sena', 'p0', 'Nut', 'existing', new Date().toISOString());
  t.mock.method(globalThis, 'fetch', async () => Response.json({ userId, displayName: 'Nut' }));
  const roster = [{ id: 'p0', award: '🥇', badge: { line: 'green', plays: 40 } }];
  const [card] = await billingLineMessages(f.env, 'sena', origin, group, [], {
    rosterOf: async club => (club === 'sena' ? roster : []),
  });
  assert(JSON.stringify(card.contents).includes(badgeImage(origin, roster[0].badge)));
  assert.match(summaryOf(card), /🥇 Nut 85 บ\./);
  // A roster that cannot be read must not stop the card.
  const [plain] = await billingLineMessages(f.env, 'sena', origin, group, [], {
    rosterOf: async () => {
      throw new Error('roster down');
    },
  });
  assert.equal(plain.type, 'flex');
  assert.match(summaryOf(plain), /N Nut 85 บ\./);
});

// Exercise the production route: signed webhook -> D1 payer mapping -> group
// membership check -> JSON serialization -> LINE reply API (mocked transport).
async function billFixture(t, count = 1) {
  const f = fixture(t);
  f.env.LINE_MEMBER_AUTH_ENABLED = 'true';
  f.env.LINE_LIFF_ID = '12345-test';
  await prepareMembers(f.env.DB);
  f.db.exec(
    'CREATE TABLE bills(id TEXT PRIMARY KEY,club TEXT,session_date TEXT,revision INTEGER,payload TEXT,closed_at INTEGER,slips_removed INTEGER DEFAULT 0)',
  );
  const names = [
    'นัท 🏸 {friend0}',
    'ทอม 👨‍👩‍👧‍👦 "&<>"',
    ...Array.from({ length: count }, (_, i) => 'เพื่อน ' + i),
  ];
  const ids = Array.from(
    { length: count },
    (_, i) => 'U' + (100 + i).toString(16).padStart(32, '0'),
  );
  const payers = ids.map((userId, i) => {
    f.db
      .prepare("INSERT INTO member_links VALUES(?,?,?,?,?,'approved',?)")
      .run(userId, 'sena', 'audit' + i, names[i], 'existing', new Date().toISOString());
    return { name: names[i], payerKey: 'member:audit' + i, amount: 1700, status: 'unpaid' };
  });
  f.db
    .prepare('INSERT INTO bills VALUES(?,?,?,0,?,NULL,0)')
    .run('audit-bill', 'sena', future(0), JSON.stringify({ payers }));
  const profileCalls = [],
    lineNames = {};
  let replyStatus = 200,
    network = false,
    profileFailure = null;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (String(url).startsWith('https://api.line.me/v2/bot/group/')) {
      const userId = String(url).split('/').at(-1);
      profileCalls.push(userId);
      assert.equal(url, 'https://api.line.me/v2/bot/group/' + group + '/member/' + userId);
      if (profileFailure?.userId === userId) {
        if (profileFailure.network) throw Error('profile network');
        return Response.json(profileFailure.body || {}, { status: profileFailure.status || 200 });
      }
      return Response.json({
        userId,
        displayName: lineNames[userId] ?? 'ชื่อ LINE ต่างจากชื่อในก๊วน',
      });
    }
    assert.equal(url, 'https://api.line.me/v2/bot/message/reply');
    f.calls.push(JSON.parse(options.body));
    if (network) throw Error('network');
    return Response.json(
      replyStatus === 200
        ? { sentMessages: [{ id: 'line-message-id' }] }
        : {
            message: 'Invalid message for ' + ids[0],
            details: [
              { property: 'messages[1].substitution.member0', message: 'Mention rejected' },
            ],
          },
      { status: replyStatus, headers: { 'x-line-request-id': 'request-audit-123' } },
    );
  });
  return {
    ...f,
    ids,
    names,
    lineNames,
    profileCalls,
    replyStatus: value => (replyStatus = value),
    network: value => (network = value),
    profileFailure: value => (profileFailure = value),
    report: () =>
      JSON.parse(
        f.db.prepare('SELECT payload FROM line_bill_diagnostics WHERE group_id=?').get(group)
          .payload,
      ),
  };
}
// LINE renders mentions as plain text when one message holds several, so each
// payer is tagged in their own message after a plain-text summary.
// Plain-named payers are tagged together (up to three per message) after a plain
// summary; whatever does not fit the 5-message reply is offered via quick reply.
for (const count of [1, 3, 4, 10, 12, 13, 40])
  test('bill webhook tags ' + count + ' payers in grouped messages', async t => {
    const f = await billFixture(t, count);
    assert.equal((await f.hook([f.event('badbot bill')])).status, 200);
    const messages = f.calls[0].messages,
      tagMessages = messages.filter(m => m.type === 'textV2'),
      fit = Math.min(count, 4 * 3);
    assert.equal(f.calls[0].notificationDisabled, false);
    assert(messages.length <= 5);
    // One summary card listing everyone, then the grouped @ tags as text.
    assert.equal(messages[0].type, 'flex');
    for (const name of f.names.slice(0, count))
      assert(summaryOf(messages[0]).includes(name + ' 17 บ.'));
    assert(JSON.stringify(messages[0]).length <= 50000);
    const tagged = tagMessages.flatMap(m =>
      Object.values(m.substitution).map(v => v.mentionee.userId),
    );
    assert.deepEqual(tagged, f.ids.slice(0, fit));
    assert.equal(new Set(tagged).size, tagged.length);
    for (const m of tagMessages) {
      const keys = Object.keys(m.substitution);
      assert(keys.length >= 1 && keys.length <= 3);
      for (const key of keys) assert(m.text.includes('{' + key + '}\u200b'.repeat(1)));
      assert(m.text.startsWith('ค้างจ่าย: {m0}'));
      assert(m.text.endsWith('\nชำระเงินผ่านลิงก์ด้านบน'));
      assert.doesNotMatch(m.text, /\p{Extended_Pictographic}/u);
    }
    const rest = count - fit,
      quick = messages.at(-1).quickReply?.items;
    if (rest) {
      assert.equal(quick.length, 1);
      assert.equal(quick[0].action.label, 'แท็กต่ออีก ' + rest + ' คน');
      assert.equal(quick[0].action.data, 'badbot:billtag:all:' + tagMessages.length);
    } else assert.equal(quick, undefined);
    assert.deepEqual([...f.profileCalls].sort(), [...f.ids].sort());
    assert(!JSON.stringify(messages).includes('@นัท'));
    const report = f.report();
    assert.equal(report.outcome, 'accepted');
    assert.equal(report.renderingConfirmed, false);
    assert.equal(report.mentionCount, fit);
    assert.equal(report.requestId, 'request-audit-123');
    assert.deepEqual(report.sentMessageIds, ['line-message-id']);
    for (const id of f.ids) assert(!JSON.stringify(report).includes(id));
    assert(!JSON.stringify(report).includes(f.calls[0].replyToken));
    assert(!JSON.stringify(report).includes(f.env.LINE_CHANNEL_ACCESS_TOKEN));
  });
test('a payer owing on several bills is tagged once, and the summary shows each bill', async t => {
  const f = await billFixture(t, 2);
  f.db.prepare('INSERT INTO bills VALUES(?,?,?,0,?,NULL,0)').run(
    'audit-bill-2',
    'sena',
    future(1),
    JSON.stringify({
      payers: [{ name: f.names[1], payerKey: 'member:audit1', amount: 3000, status: 'unpaid' }],
    }),
  );
  await f.hook([f.event('badbot bill')]);
  const [summary, tags] = f.calls[0].messages;
  assert.equal(summary.contents.type, 'carousel');
  assert.match(summaryOf(summary), /17 บ\.[\s\S]*30 บ\./);
  assert.deepEqual(
    Object.values(tags.substitution).map(v => v.mentionee.userId),
    f.ids,
  );
});

for (const failure of [
  { status: 404 },
  { status: 403 },
  { network: true },
  { body: { userId: 'U' + 'f'.repeat(32) } },
])
  test(
    'bill explicitly marks an unverified member without fabricating an at-name ' +
      JSON.stringify(failure),
    async t => {
      const f = await billFixture(t, 2);
      f.profileFailure({ userId: f.ids[1], ...failure });
      assert.equal((await f.hook([f.event('badbot bill')])).status, 200);
      const messages = f.calls[0].messages;
      assert.equal(messages.length, 2);
      assert.deepEqual(
        Object.values(messages[1].substitution).map(v => v.mentionee.userId),
        [f.ids[0]],
      );
      assert.match(summaryOf(messages[0]), /แท็กไม่สำเร็จ:/);
      assert(!JSON.stringify(messages).includes('@ทอม'));
      assert.notEqual(f.report().payers.find(p => p.name === f.names[1]).reason, 'mention_ready');
    },
  );
for (const status of [400, 429, 500])
  test(
    'bill records LINE rejection details and request ID without plain-text or Push fallback ' +
      status,
    async t => {
      const f = await billFixture(t, 2);
      f.replyStatus(status);
      const event = f.event('badbot bill');
      assert.equal((await f.hook([event])).status, status === 400 ? 200 : 503);
      const report = f.report();
      assert.equal(report.replyStatus, status);
      assert.equal(report.outcome, 'rejected');
      assert.equal(report.requestId, 'request-audit-123');
      assert.match(report.error.message, /Invalid message/);
      assert.equal(report.error.details[0].property, 'messages[1].substitution.member0');
      assert(!JSON.stringify(report).includes(f.ids[0]));
      assert.equal(f.calls.length, 1);
      if (status === 400) {
        await f.hook([event]);
        assert.equal(f.calls.length, 1);
      }
    },
  );
test('bill records an uncertain network failure and permits a webhook retry', async t => {
  const f = await billFixture(t, 2),
    event = f.event('badbot bill');
  f.network(true);
  assert.equal((await f.hook([event])).status, 503);
  assert.equal(f.report().outcome, 'network_error');
  assert.equal(f.report().replyStatus, 0);
  f.network(false);
  assert.equal((await f.hook([event])).status, 200);
  assert.equal(f.report().outcome, 'accepted');
});
test('group membership check rejects malformed user IDs without calling LINE', async t => {
  fixture(t);
  const result = await groupMentionTarget({}, group, 'not-a-user');
  assert.equal(result.reason, 'invalid_line_user_id');
});
test('very long bills list everyone, tag what fits and the quick reply tags the rest for free', async t => {
  const f = await billFixture(t, 101);
  await f.hook([f.event('badbot bill')]);
  const first = f.calls[0].messages;
  assert(first.length <= 5);
  const summary = first
    .filter(m => m.type === 'text' || m.type === 'flex')
    .map(summaryOf)
    .join('\n');
  for (const name of f.names.slice(0, 101)) assert(summary.includes('• ' + name + ' 17 บ.'));
  const tagged = ms =>
    ms
      .filter(m => m.type === 'textV2')
      .flatMap(m => Object.values(m.substitution).map(v => v.mentionee.userId));
  assert.equal(tagged(first).length, 12);
  assert.equal(first.at(-1).quickReply.items[0].action.label, 'แท็กต่ออีก 89 คน');
  // Pressing the button is a postback: a new Reply with only tags, no summary, no Push.
  let data = first.at(-1).quickReply.items[0].action.data,
    all = [...tagged(first)],
    rounds = 0;
  while (data) {
    const press = f.event('', { type: 'postback', postback: { data } });
    assert.equal((await f.hook([press])).status, 200);
    const next = f.calls.at(-1).messages;
    assert.deepEqual(
      next.map(m => m.type).filter(type => type !== 'textV2'),
      [],
    );
    assert(next.length <= 4 || next.length <= 5);
    all.push(...tagged(next));
    data = next.at(-1).quickReply?.items[0].action.data;
    assert(++rounds < 30);
  }
  // Everyone is tagged exactly once across the replies.
  assert.deepEqual([...all].sort(), [...f.ids].sort());
  assert.equal(
    f.calls.every(c => c.replyToken),
    true,
  );
});

test('a stale tag-the-rest button still gets a valid reply', async t => {
  const f = await billFixture(t, 3);
  await f.hook([f.event('', { type: 'postback', postback: { data: 'badbot:billtag:all:9' } })]);
  assert.deepEqual(f.calls[0].messages, [
    { type: 'text', text: 'ไม่มีรายชื่อที่ต้องแท็กเพิ่มแล้ว' },
  ]);
  assert.equal(f.calls[0].messages[0].quickReply, undefined);
});

test('the layout seen working in the group: plain, light miscount, heavy miscount last', async t => {
  const f = await billFixture(t, 3);
  f.lineNames[f.ids[0]] = '♠️❄️Pete❄️♠️'; // heavy miscount, listed first on the bill
  f.lineNames[f.ids[1]] = 'TaToM55♾️'; // light miscount
  await f.hook([f.event('badbot bill')]);
  const tags = f.calls[0].messages.filter(m => m.type === 'textV2');
  assert.equal(tags.length, 1);
  const order = Object.values(tags[0].substitution).map(v => v.mentionee.userId);
  assert.deepEqual(order, [f.ids[2], f.ids[1], f.ids[0]]); // Nut, Tatom, Pete
  assert.equal(
    tags[0].text,
    'ค้างจ่าย: {m0}' +
      '\u200b'.repeat(16) +
      ' {m1}' +
      '\u200b'.repeat(16) +
      ' {m2}' +
      '\u200b'.repeat(16) +
      '\nชำระเงินผ่านลิงก์ด้านบน',
  );
});

test('names LINE miscounts always end their message; two heavy names never share one', async t => {
  const f = await billFixture(t, 4);
  f.lineNames[f.ids[0]] = '♠️❄️Pete❄️♠️'; // heavy, listed first on the bill
  f.lineNames[f.ids[1]] = '😀😀Bo😀'; // also heavy
  await f.hook([f.event('badbot bill')]);
  const groups = f.calls[0].messages
    .filter(m => m.type === 'textV2')
    .map(m => Object.values(m.substitution).map(v => v.mentionee.userId));
  assert.deepEqual(groups, [[f.ids[2], f.ids[3], f.ids[1]], [f.ids[0]]]);
});

test('enabled member mode sends both booking buttons through the configured LIFF app', async t => {
  const f = fixture(t);
  f.env.LINE_MEMBER_AUTH_ENABLED = 'true';
  f.env.LINE_LIFF_ID = '12345-test';
  await f.hook([f.event()]);
  const buttons = menuButtons(f.calls[0].messages[0]);
  for (const [i, club] of [
    [0, 'sena'],
    [1, '88'],
  ]) {
    const url = new URL(buttons[i].action.uri);
    assert.equal(url.origin, 'https://liff.line.me');
    assert.equal(url.pathname, '/12345-test');
    assert.equal(url.searchParams.get('club'), club);
    assert.equal(url.searchParams.get('page'), 'book');
    // The collect buttons open the same LIFF app on the collect page.
    const collect = new URL(buttons[i + 4].action.uri);
    assert.equal(collect.origin, 'https://liff.line.me');
    assert.equal(collect.searchParams.get('club'), club);
    assert.equal(collect.searchParams.get('page'), 'collect');
  }
  await f.hook([f.event('badbot leaderboard sena')]);
  const link = JSON.stringify(f.calls.at(-1).messages);
  assert.match(link, /https:\/\/sena-web\.thegsbnut\.workers\.dev\/court#leaderboard/);
  assert.doesNotMatch(link, /liff\.line\.me/);
});

const menuButtons = m => {
  const out = [],
    walk = n => (n.type === 'button' ? out.push(n) : (n.contents || []).forEach(walk));
  walk(m.contents.body);
  return out;
};

test('signed badbot command replies with the compact menu and distinct existing booking URLs', async t => {
  const f = fixture(t),
    before = f.db.prepare('SELECT payload FROM club_state').get().payload;
  assert.equal((await f.hook([f.event('ＢＡＤＢＯＴ')])).status, 200);
  assert.equal(f.calls.length, 1);
  const [menu] = f.calls[0].messages;
  assert.equal(menu.type, 'flex');
  const buttons = menuButtons(menu);
  assert.equal(buttons.length, 10);
  assert.deepEqual(buttons[0].action, {
    type: 'uri',
    label: '🏸 Sena',
    uri: 'https://sena-web.thegsbnut.workers.dev/court#booking',
  });
  assert.deepEqual(buttons[1].action, {
    type: 'uri',
    label: '🏸 88',
    uri: 'https://sena-web.thegsbnut.workers.dev/court?club=88#booking',
  });
  assert.deepEqual(buttons[4].action, {
    type: 'uri',
    label: '💸 Sena',
    uri: 'https://sena-web.thegsbnut.workers.dev/billing.html?collect=1',
  });
  assert.deepEqual(buttons[5].action, {
    type: 'uri',
    label: '💸 88',
    uri: 'https://sena-web.thegsbnut.workers.dev/billing.html?collect=1&club=88',
  });
  assert.deepEqual(
    buttons.filter(b => b.action.type === 'postback').map(b => b.action.data),
    [
      'badbot:roster:sena',
      'badbot:roster:88',
      'badbot:run:bill',
      'badbot:run:matchup sena',
      'badbot:run:leaderboard',
      'badbot:run:help',
    ],
  );
  assert.equal(f.db.prepare('SELECT payload FROM club_state').get().payload, before);
  assert.equal(
    f.db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name LIKE '%user%'").get().n,
    0,
  );
});

test('roster postback shows the nearest upcoming round for both courts and refresh uses a new Reply', async t => {
  const f = fixture(t),
    date = future(1);
  f.seed('sena', [session(future(-1)), session(future(6)), session(date)]);
  f.seed('88', [session(date, { names: 1 })], true, ['Pete', 'Noon']);
  const click = f.event('', { type: 'postback', postback: { data: 'badbot:roster' } });
  assert.equal((await f.hook([click])).status, 200);
  const text = textOf(f.calls[0]);
  assert.match(
    text,
    /เสนา[\s\S]*2 \/ 8 คน[\s\S]*1 Nut 2 Bua[\s\S]*88[\s\S]*1 \/ 8 คน[\s\S]*1 Pete/,
  );
  assert.match(text, /เหลือ 6 ที่/);
  assert.match(text, /อัปเดต \d\d:\d\d น\./);
  assert.doesNotMatch(text, /"lv"|gender|ownerHash|never-show-this|LINE-user-not-a-player-id/);
  // Both courts come as one swipeable carousel.
  assert.deepEqual(
    f.calls[0].messages.map(message => message.type),
    ['flex'],
  );
  assert.equal(f.calls[0].messages[0].contents.type, 'carousel');
  assert.match(f.calls[0].messages[0].altText, /^รายชื่อ Sena .* 2\/8 เหลือ 6 ที่ · รายชื่อ 88 /);
  const doc = JSON.parse(
    f.db.prepare("SELECT payload FROM booking_clubs WHERE club='sena'").get().payload,
  );
  doc.sessions
    .find(s => s.date === date)
    .registrations.push({ id: 'new', playerId: 'p2', seq: 10, source: 'manual' });
  f.db.prepare("UPDATE booking_clubs SET payload=? WHERE club='sena'").run(JSON.stringify(doc));
  assert.equal((await f.hook([f.event('badbot รายชื่อ')])).status, 200);
  assert.match(textOf(f.calls[1]), /3 \/ 8 คน[\s\S]*3 Bomb/);
  assert.notEqual(f.calls[0].replyToken, f.calls[1].replyToken);
});

test('roster buttons return scoped text only and old menu actions still work', async t => {
  const f = fixture(t),
    date = future(1);
  f.seed('sena', [session(date)]);
  f.seed('88', [session(date, { names: 1 })], true, ['Pete', 'Noon']);
  await f.hook([f.event()]);
  assert.equal(menuButtons(f.calls[0].messages[0])[2].action.data, 'badbot:roster:sena');
  const post = data => f.hook([f.event('', { type: 'postback', postback: { data } })]);
  await post('badbot:roster:all');
  const all = f.calls.at(-1);
  assert.deepEqual(
    all.messages.map(message => message.type),
    ['flex'],
  );
  assert.match(textOf(all), /📍 เสนา[\s\S]*📍 88/);
  // The all-courts reply carries free Quick Reply chips for each club.
  const chips = all.messages.at(-1).quickReply.items.map(i => i.action.data);
  assert.deepEqual(chips, ['badbot:roster:sena', 'badbot:roster:88']);
  for (const scope of ['sena', '88']) {
    const other = scope === 'sena' ? '88' : 'sena',
      beforeOther = f.db
        .prepare('SELECT payload FROM booking_clubs WHERE club=?')
        .get(other).payload;
    await post('badbot:roster:' + scope);
    const text = textOf(f.calls.at(-1));
    assert.equal(f.calls.at(-1).messages[0].quickReply, undefined);
    assert.equal(f.calls.at(-1).messages[0].contents.type, 'bubble');
    assert.match(text, scope === '88' ? /1 Pete/ : /1 Nut/);
    assert.doesNotMatch(text, scope === 'sena' ? /📍 88|Pete/ : /📍 เสนา|Nut/);
    assert.equal(
      f.db.prepare('SELECT payload FROM booking_clubs WHERE club=?').get(other).payload,
      beforeOther,
    );
  }
  // Menu buttons run existing shortcuts; unknown run keys are ignored.
  const callsBefore = f.calls.length;
  await post('badbot:run:help');
  assert.match(textOf(f.calls.at(-1)), /badbot bill/);
  await post('badbot:run:nope');
  assert.equal(f.calls.length, callsBefore + 1);
  await f.hook([f.event('', { type: 'postback', postback: { data: 'badbot:menu' } })]);
  assert.equal(f.calls.at(-1).messages.length, 1);
  assert.equal(menuButtons(f.calls.at(-1).messages[0]).length, 10);
  // The menu header fades green, like Sena's cards.
  const menuHeader = f.calls.at(-1).messages[0].contents.header;
  assert.equal(menuHeader.backgroundColor, '#168B42');
  assert.deepEqual(menuHeader.background, {
    type: 'linearGradient',
    angle: '135deg',
    startColor: '#0E6B31',
    endColor: '#2FB35A',
  });
});

test('typed roster shortcuts select Sena, เสนา, 88 or all courts', async t => {
  const f = fixture(t),
    date = future(1);
  f.seed('sena', [session(date)]);
  f.seed('88', [session(date, { names: 1 })], true, ['Pete']);
  for (const [text, scope] of [
    ['badbot รายชื่อ SENA', 'sena'],
    ['แบดบอต ดูผู้ตี เสนา', 'sena'],
    ['badbot รายชื่อ 88', '88'],
    ['badbot ดูรายชื่อผู้เล่น ทั้งหมด', 'all'],
  ]) {
    assert.equal((await f.hook([f.event(text)])).status, 200);
    const result = textOf(f.calls.at(-1));
    assert.equal(result.includes('📍 เสนา'), scope !== '88');
    assert.equal(result.includes('📍 88'), scope !== 'sena');
  }
});

test('closed rounds stay visible with an explicit status and skipped rounds are excluded', async t => {
  const f = fixture(t),
    date = future(1);
  const skipped = session(date);
  skipped.skipped = true;
  const doc = {
    settings: {
      ...defaultSettings(),
      enabled: true,
      weekdays: [nextWeekday()],
      weeks: 1,
      holidayPolicy: 'skip',
      holidays: [{ date, name: 'สนามหยุด' }],
    },
    settingsVersion: 1,
    seq: 5,
    sessions: [skipped, session(future(2), { closed: true })],
  };
  f.db.prepare("UPDATE booking_clubs SET payload=? WHERE club='sena'").run(JSON.stringify(doc));
  await f.hook([f.event('แบดบอต รายชื่อ')]);
  assert.match(textOf(f.calls[0]), /ปิดรับจอง/);
  assert.match(textOf(f.calls[0]), /88\nยังไม่มีรอบเปิดรับ/);
});

test('waitlists are ordered and both venue headings survive very long rosters within LINE limits', async t => {
  const f = fixture(t),
    names = Array.from({ length: 200 }, (_, i) => 'Player ' + i + ' ' + 'ยาว'.repeat(25));
  // Disable automatic draws here: read-only reply formatting is what this checks.
  for (const club of ['sena', '88']) {
    f.seed(club, [session(future(1), { names: 200 })], true, names);
    const row = f.db.prepare('SELECT payload FROM booking_clubs WHERE club=?').get(club);
    const doc = JSON.parse(row.payload);
    doc.sessions[0].closed = true;
    f.db.prepare('UPDATE booking_clubs SET payload=? WHERE club=?').run(JSON.stringify(doc), club);
  }
  await f.hook([f.event('badbot รายชื่อ')]);
  const call = f.calls[0],
    text = textOf(call);
  assert(call.messages.length <= 5);
  // LINE caps a bubble at 30 KB and a carousel at 50 KB; altText at 400 characters.
  const [card] = call.messages;
  assert.equal(card.type, 'flex');
  assert(card.altText.length <= 400);
  assert(JSON.stringify(card.contents).length < 50000);
  for (const bubble of card.contents.contents) assert(JSON.stringify(bubble).length < 30000);
  assert.match(text, /เสนา[\s\S]*ปิดรับจอง[\s\S]*สำรอง · 192 คน[\s\S]*1 Player 8[\s\S]*88/);
  assert.match(text, /… อีก 182 คน ดูได้บนเว็บ/);
});

test('ordinary chat, unrelated postbacks, private chats, standby, and unlinked groups produce no replies', async t => {
  const f = fixture(t);
  const events = [
    f.event('ไปตีแบดกัน'),
    f.event('badbotany'),
    f.event('badbot', { mode: 'standby' }),
    f.event('badbot', { source: { type: 'user', userId: 'someone' } }),
    f.event('badbot', { source: { type: 'group', groupId: 'C' + 'b'.repeat(32) } }),
    f.event('', { type: 'postback', postback: { data: 'other:action' } }),
    f.event('', { type: 'postback', postback: { data: 'badbot:roster:unknown' } }),
    f.event('badbot', { replyToken: '' }),
  ];
  assert.equal((await f.hook(events)).status, 200);
  assert.equal(f.calls.length, 0);
});

test('invalid signatures do not send replies, and LINE verification with no events succeeds', async t => {
  const f = fixture(t);
  assert.equal((await f.hook([f.event()], { invalid: true })).status, 401);
  assert.equal((await f.hook([])).status, 200);
  assert.equal(f.calls.length, 0);
});

test('redelivered events never send a second reply, even if their reply token changes', async t => {
  const f = fixture(t),
    event = f.event();
  await f.hook([event, event]);
  await f.hook([
    { ...event, replyToken: 'replacement-token', deliveryContext: { isRedelivery: true } },
  ]);
  assert.equal(f.calls.length, 1);
  await f.hook([f.event()]);
  assert.equal(f.calls.length, 2);
});

test('transient LINE failure allows webhook retry; an expired token never falls back to Push', async t => {
  const f = fixture(t),
    event = f.event();
  f.status(503);
  assert.equal((await f.hook([event])).status, 503);
  f.status(200);
  assert.equal((await f.hook([event])).status, 200);
  assert.equal(f.calls.length, 2);
  f.status(400);
  const expired = f.event();
  assert.equal((await f.hook([expired])).status, 200);
  await f.hook([expired]);
  assert.equal(f.calls.length, 3);
});

test('booking URL override must be HTTPS and contains no account-link flow', async t => {
  const f = fixture(t);
  f.env.LINE_BOOKING_URL = 'https://booking.example/court#booking';
  await f.hook([f.event('badbot จอง')]);
  assert.equal(menuButtons(f.calls[0].messages[0])[0].action.uri, f.env.LINE_BOOKING_URL);
  f.env.LINE_BOOKING_URL = 'javascript:alert(1)';
  assert.equal((await f.hook([f.event()])).status, 503);
  assert.equal(f.calls.length, 1);
});

test('court links preserve custom query and fragment while overriding a stale club selection', async t => {
  const f = fixture(t);
  f.env.LINE_BOOKING_URL = 'https://booking.example/court?club=88&from=line#booking';
  await f.hook([f.event()]);
  const actions = menuButtons(f.calls[0].messages[0]).map(b => b.action);
  const sena = new URL(actions[0].uri),
    other = new URL(actions[1].uri);
  assert.equal(sena.searchParams.has('club'), false);
  assert.equal(other.searchParams.get('club'), '88');
  for (const url of [sena, other]) {
    assert.equal(url.searchParams.get('from'), 'line');
    assert.equal(url.hash, '#booking');
  }
});

test('English shortcuts route bookings, lists, matchups, completed Cup results and standings', async t => {
  const f = fixture(t);
  const date = future(1);
  const players = Array.from({ length: 8 }, (_, i) => 'Sena ' + (i + 1));
  f.seed('sena', [{ ...session(date, { names: 8 }), cupOverride: false }], true, players);
  f.seed('88', [session(date)], true, ['88 One', '88 Two']);
  for (const [club, label] of [
    ['sena', 'Sena'],
    ['88', '88'],
  ]) {
    const state = club === '88' ? 'club_state_88' : 'club_state';
    const history = club === '88' ? 'cup_history_88' : 'cup_history';
    const teams = [
      [label + ' One', label + ' Two'],
      [label + ' Three', label + ' Four'],
    ];
    const cup = { teams, matches: [{ a: 0, b: 1, sa: '', sb: '' }] };
    f.db
      .prepare(`UPDATE ${state} SET payload=json_set(payload,'$.cup',json(?)) WHERE id=1`)
      .run(JSON.stringify(cup));
    f.db.exec(
      `CREATE TABLE ${history} (id TEXT PRIMARY KEY,revision INTEGER,sequence INTEGER,payload TEXT)`,
    );
    f.db.prepare(`INSERT INTO ${history} VALUES ('saved',1,1,?)`).run(
      JSON.stringify({
        title: label + ' Cup ผลทดสอบ',
        date: future(-1),
        inBaseline: false,
        teams,
        matches: [{ a: 0, b: 1, sa: 21, sb: 14 }],
      }),
    );
  }
  const cases = [
    ['BOOK 88', /club=88#booking/],
    ['book sena', /\/court#booking/],
    ['list', /📍 เสนา[\s\S]*📍 88/],
    ['list 88', /📍 88/],
    ['list sena', /📍 เสนา/],
    ['matchup sena', /เกม 1 Sena \d/],
    ['matchup 88cup', /เกม 1 88 One \/ 88 Two vs 88 Three \/ 88 Four/],
    ['matchup senacup', /เกม 1 Sena One \/ Sena Two vs Sena Three \/ Sena Four/],
    ['senacup', /🥇\nSena One \/ Sena Two\nชนะ 1\/1 · แต้ม 21–14/],
    ['88cup', /🥇\n88 One \/ 88 Two\nชนะ 1\/1 · แต้ม 21–14/],
    ['leaderboard', /Sena Leaderboard[\s\S]*5\. [\s\S]*88 Leaderboard[\s\S]*88 One/],
    ['leaderboard sena', /Sena Leaderboard[\s\S]*5\. /],
    ['leaderboard 88', /88 Leaderboard[\s\S]*88 One/],
    [
      'help',
      /badbot leaderboard ·[^\n]+\nbadbot leaderboard sena ·[^\n]+\nbadbot leaderboard 88 ·/,
    ],
  ];
  for (const [command, expected] of cases) {
    assert.equal((await f.hook([f.event('badbot ' + command)])).status, 200, command);
    const reply = f.calls.at(-1);
    // Roster lists and tables are Flex cards; the rest stay plain text.
    assert(
      reply.messages.every(
        m =>
          m.type === (/^(list|matchup|senacup|88cup|leaderboard)/.test(command) ? 'flex' : 'text'),
      ),
      command,
    );
    assert.match(textOf(reply), expected, command);
    assert.doesNotMatch(textOf(reply), /\bLv\b|ownerHash/);
    // The web links live in each card's button.
    if (command.startsWith('leaderboard')) {
      const links = JSON.stringify(reply.messages);
      assert.equal(
        command === 'leaderboard 88' || command === 'leaderboard',
        links.includes('/court?club=88#leaderboard'),
        command,
      );
      assert.equal(command !== 'leaderboard 88', links.includes('/court#leaderboard'), command);
    }
    if (command === 'leaderboard sena') assert.doesNotMatch(textOf(reply), /88 Leaderboard|88 One/);
    if (command === 'leaderboard 88')
      assert.doesNotMatch(textOf(reply), /Sena Leaderboard|Sena One/);
  }
});

test('a withdrawal code tags the promoted player for real and shows that round', async t => {
  const f = fixture(t),
    userId = 'U' + 'b'.repeat(32),
    date = future(1);
  await prepareMembers(f.env.DB);
  f.db
    .prepare("INSERT INTO member_links VALUES(?,?,?,?,?,'approved',?)")
    .run(userId, 'sena', 'p2', 'Bomb', 'existing', new Date().toISOString());
  const round = session(date, { names: 3, capacity: 2 });
  round.registrations.splice(1, 1); // Bua withdrew: Bomb moved up to a confirmed spot.
  f.seed('sena', [round]);
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (url === 'https://api.line.me/v2/bot/group/' + group + '/member/' + userId)
      return Response.json({ userId, displayName: 'Bomb' });
    assert.equal(url, 'https://api.line.me/v2/bot/message/reply');
    f.calls.push(JSON.parse(options.body));
    return Response.json({});
  });
  const code = await createNotice(f.env.DB, {
    club: 'sena',
    kind: 'withdraw',
    payload: { sessionId: date, date, promotedIds: ['p2'] },
  });
  const text = `➖ Bua ถอน SENA ${noticeDay(date)} #${code}`;
  assert.equal((await f.hook([f.event(text)])).status, 200);
  assert.equal(f.calls.length, 1);
  const [tag, ...rest] = f.calls[0].messages;
  assert.equal(tag.type, 'textV2');
  assert.deepEqual(tag.substitution.m0, { type: 'mention', mentionee: { type: 'user', userId } });
  assert.match(
    tag.text,
    new RegExp(`^🎉 \\{m0\\}\\u200b+\\nได้สิทธิ์เล่น SENA ${noticeDay(date)} แล้ว$`),
  );
  assert.deepEqual(
    rest.map(m => m.type),
    ['flex'],
  );
  const roster = flexText(rest[0].contents);
  assert.match(roster, /2 \/ 2 คน เต็ม/);
  assert.match(roster, /2 Bomb ⬆️/);
  // The same code again (copied, or redelivered with a new id) never replies twice.
  await f.hook([f.event(text)]);
  assert.equal(f.calls.length, 1);
});

test('a paid-in-full code replies with the bill summary and who paid cash', async t => {
  const f = fixture(t);
  f.db.exec(
    'CREATE TABLE bills(id TEXT PRIMARY KEY,club TEXT,session_date TEXT,revision INTEGER,payload TEXT,closed_at INTEGER,slips_removed INTEGER DEFAULT 0, created_at INTEGER)',
  );
  const id = 'c'.repeat(32);
  f.db.prepare('INSERT INTO bills (id,club,session_date,revision,payload) VALUES(?,?,?,0,?)').run(
    id,
    'sena',
    '2026-11-14',
    JSON.stringify({
      payers: [
        {
          name: 'Nut',
          amount: 8500,
          status: 'paid',
          method: 'transfer',
          paidAt: 2000,
          shares: [{ name: 'Nut' }, { name: 'Guest' }],
        },
        { name: 'Bua', amount: 9000, status: 'paid', method: 'cash', paidAt: 1000, shares: [] },
      ],
    }),
  );
  const code = await createNotice(f.env.DB, {
    club: 'sena',
    kind: 'paid',
    payload: { billId: id },
  });
  assert.equal((await f.hook([f.event('💵 Bua จ่ายบิล … #' + code)])).status, 200);
  assert.deepEqual(
    f.calls[0].messages.map(m => m.type),
    ['flex'],
  );
  assert.equal(f.calls[0].messages[0].altText, '✅ บิล SENA ส. 14 พ.ย. จ่ายครบ 3/3 · รวม 175 บ.');
  // Paid order (Bua first), each person's amount and how they paid, then the total.
  assert.equal(
    textOf(f.calls[0]),
    [
      'ได้รับยอดครบถ้วนแล้วค่า ไว้มาเล่นกันใหม่อีกน้า 🥰🎉',
      '✅ บิล SENA ส. 14 พ.ย. · 📲 โอน 1 · 💵 เงินสด 1',
      'ได้รับแล้ว',
      '฿175 ครบแล้ว ✓',
      'จ่ายแล้ว 3/3 คน', // Nut paid for a guest too: three people, two bill lines
      'รายชื่อคนจ่าย',
      'B Bua 💵 เงินสด 90', // no badge in this roster: a round initial instead
      'N Nut (รวม Guest) 📲 โอน 85',
      'รวม 175 บ.',
      'ขุนเงินเก็บครบแล้ว ไปตีแบดกันต่อน้า 🏸',
    ].join('\n'),
  );
});

test("notice codes answer in any linked group (not only their club's), and survive a failed reply", async t => {
  const f = fixture(t);
  f.db.exec(
    'CREATE TABLE bills(id TEXT PRIMARY KEY,club TEXT,session_date TEXT,revision INTEGER,payload TEXT,closed_at INTEGER,slips_removed INTEGER DEFAULT 0, created_at INTEGER)',
  );
  f.db
    .prepare('INSERT INTO bills (id,club,session_date,revision,payload) VALUES(?,?,?,0,?)')
    .run(
      'd'.repeat(32),
      '88',
      '2026-11-14',
      JSON.stringify({ payers: [{ name: 'Nut', amount: 100, status: 'paid', method: 'cash' }] }),
    );
  const other = await createNotice(f.env.DB, {
    club: '88',
    kind: 'paid',
    payload: { billId: 'd'.repeat(32) },
  });
  // A chat no club is linked to gets nothing, and the code stays usable.
  const stranger = f.event('x #' + other);
  stranger.source = { ...stranger.source, groupId: 'C' + 'b'.repeat(32) };
  await f.hook([stranger]);
  assert.equal(f.calls.length, 0);
  // 2026-11-15: an 88 booking posted in the Sena group got no reply; it should.
  f.status(503);
  assert.equal((await f.hook([f.event('x #' + other)])).status, 503);
  f.status(200);
  assert.equal((await f.hook([f.event('x #' + other)])).status, 200);
  assert.equal(f.calls.length, 2);
  assert.match(textOf(f.calls[1]), /✅ บิล 88 ส\. 14 พ\.ย\.[\s\S]*จ่ายแล้ว 1\/1 คน/);
  await f.hook([f.event('ordinary chat #zzzzz')]);
  assert.equal(f.calls.length, 2);
});

test('a booking code lists the nearest booked round, sums up the other days and offers free buttons', async t => {
  const f = fixture(t),
    [d1, d2] = [future(1), future(2)];
  const later = session(d2, { names: 3, capacity: 2 });
  f.seed('sena', [session(d1, { names: 3 }), later]);
  const code = await createNotice(f.env.DB, {
    club: 'sena',
    kind: 'book',
    payload: { playerId: 'p2', sessionIds: [d1, d2] },
  });
  assert.equal((await f.hook([f.event('🏸 Bomb จอง SENA #' + code)])).status, 200);
  const reply = f.calls[0];
  const text = textOf(reply);
  assert.deepEqual(
    reply.messages.map(m => m.type),
    ['flex'],
  );
  assert.match(text, /3 \/ 8 คน/);
  assert.match(text, /3 Bomb ✨/);
  assert.match(text, new RegExp(`📅 วันอื่นที่ Bomb จอง\\n${noticeDay(d2)} 2/2 · สำรอง 1`));
  assert.match(reply.messages[0].altText, /· จองวันอื่นอีก 1 วัน$/);
  assert.doesNotMatch(
    text.split('📅')[0],
    /สำรอง · 1 คน/,
    'only the nearest round is listed in full',
  );
  const items = reply.messages.at(-1).quickReply.items;
  assert.deepEqual(
    items.map(i => [i.action.label, i.action.data]),
    [[noticeDay(d2), 'badbot:round:sena:' + d2]],
  );
  // The button shows that day's full list (a free reply to the postback).
  await f.hook([
    f.event('', {
      type: 'postback',
      postback: { data: 'badbot:round:sena:' + d2 },
      message: undefined,
    }),
  ]);
  const second = textOf(f.calls[1]);
  assert.match(second, /2 \/ 2 คน เต็ม/);
  assert.match(second, /⏳ สำรอง · 1 คน\n1 Bomb/);
});

test('a withdrawal with nobody moving up still answers with that round', async t => {
  const f = fixture(t),
    date = future(1);
  f.seed('sena', [session(date, { names: 2 })]);
  const code = await createNotice(f.env.DB, {
    club: 'sena',
    kind: 'withdraw',
    payload: { sessionId: date, date, promotedIds: [] },
  });
  await f.hook([f.event('➖ Bomb ถอน SENA #' + code)]);
  assert.equal(f.calls[0].messages.length, 1);
  assert.equal(f.calls[0].messages[0].type, 'flex');
  assert.match(textOf(f.calls[0]), /2 \/ 8 คน[\s\S]*1 Nut 2 Bua/);
  assert.doesNotMatch(textOf(f.calls[0]), /⬆️/);
});

test('an opened-bill code replies with who still owes on that court, tagging linked members', async t => {
  const f = fixture(t),
    userId = 'U' + 'e'.repeat(32);
  f.env.LINE_MEMBER_AUTH_ENABLED = 'true';
  f.env.LINE_LIFF_ID = '12345-test';
  await prepareMembers(f.env.DB);
  f.db.exec(
    'CREATE TABLE bills(id TEXT PRIMARY KEY,club TEXT,session_date TEXT,revision INTEGER,payload TEXT,closed_at INTEGER,slips_removed INTEGER DEFAULT 0)',
  );
  f.db.prepare('INSERT INTO bills VALUES(?,?,?,0,?,NULL,0)').run(
    'f'.repeat(32),
    'sena',
    future(0),
    JSON.stringify({
      payers: [{ name: 'Nut', payerKey: 'member:p0', amount: 8500, status: 'unpaid' }],
    }),
  );
  f.db
    .prepare("INSERT INTO member_links VALUES(?,?,?,?,?,'approved',?)")
    .run(userId, 'sena', 'p0', 'Nut', 'existing', new Date().toISOString());
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (url === 'https://api.line.me/v2/bot/group/' + group + '/member/' + userId)
      return Response.json({ userId, displayName: 'Nut' });
    f.calls.push(JSON.parse(options.body));
    return Response.json({});
  });
  const code = await createNotice(f.env.DB, {
    club: 'sena',
    kind: 'bill',
    payload: { billId: 'f'.repeat(32) },
  });
  await f.hook([f.event('🧾 เปิดบิล SENA #' + code)]);
  const [summary, tag] = f.calls[0].messages;
  assert.match(summary.altText, /^💸 บิลค้าง · Sena/);
  assert.match(summaryOf(summary), /Nut 85 บ\./);
  assert.deepEqual(tag.substitution.m0.mentionee, { type: 'user', userId });
});

test('a resend-slip code tags the payer with the link; it stays quiet once they have resent', async t => {
  const f = fixture(t),
    userId = 'U' + 'd'.repeat(32),
    billId = '9'.repeat(32);
  f.env.LINE_MEMBER_AUTH_ENABLED = 'true';
  f.env.LINE_LIFF_ID = '12345-test';
  await prepareMembers(f.env.DB);
  f.db.exec(
    'CREATE TABLE bills(id TEXT PRIMARY KEY,club TEXT,session_date TEXT,revision INTEGER,payload TEXT,closed_at INTEGER,slips_removed INTEGER DEFAULT 0)',
  );
  const save = status =>
    f.db.prepare('INSERT OR REPLACE INTO bills VALUES(?,?,?,0,?,NULL,0)').run(
      billId,
      'sena',
      '2026-11-14',
      JSON.stringify({
        payers: [{ id: 'x1', name: 'Nut', payerKey: 'member:p0', amount: 8500, status }],
      }),
    );
  save('rejected');
  f.db
    .prepare("INSERT INTO member_links VALUES(?,?,?,?,?,'approved',?)")
    .run(userId, 'sena', 'p0', 'Nut', 'existing', new Date().toISOString());
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (url === 'https://api.line.me/v2/bot/group/' + group + '/member/' + userId)
      return Response.json({ userId, displayName: 'Nut' });
    f.calls.push(JSON.parse(options.body));
    return Response.json({});
  });
  const code = () =>
    createNotice(f.env.DB, {
      club: 'sena',
      kind: 'resubmit',
      payload: { billId, payerId: 'x1' },
    });
  await f.hook([f.event('⚠️ สลิปของ Nut ใช้ไม่ได้ #' + (await code()))]);
  const [message] = f.calls[0].messages;
  assert.equal(message.type, 'textV2');
  assert.deepEqual(message.substitution.m0.mentionee, { type: 'user', userId });
  assert.match(
    message.text,
    /^⚠️ \{m0\}​+\nกรุณาส่งสลิปใหม่ที่ https:\/\/liff\.line\.me\/12345-test\?/,
  );
  assert.match(message.text, /page=pay/);
  save('paid');
  await f.hook([f.event('⚠️ สลิปของ Nut ใช้ไม่ได้ #' + (await code()))]);
  assert.equal(f.calls.length, 1, 'already resent, nothing to chase');
});

test('roster cards pick the pre-rendered badge picture for each job level', () => {
  const o = 'https://x.test';
  assert.equal(badgeImage(o, null), o + '/badges/blank.png');
  assert.equal(badgeImage(o, { line: 'red', plays: 4 }), o + '/badges/novice.png');
  assert.equal(badgeImage(o, { line: 'red', plays: 5 }), o + '/badges/red-1.png');
  assert.equal(badgeImage(o, { line: 'pink', plays: 15 }), o + '/badges/pink-2.png');
  assert.equal(badgeImage(o, { line: 'blue', plays: 30 }), o + '/badges/blue-3-0.png');
  assert.equal(badgeImage(o, { line: 'blue', plays: 95 }), o + '/badges/blue-3-2.png');
  assert.equal(badgeImage(o, { line: 'blue', plays: 999 }), o + '/badges/blue-3-5.png');
  assert.equal(badgeImage(o, { line: 'purple', plays: 50 }), o + '/badges/novice.png');
  // Every picture a card can point at exists in public/ (scripts/render-badges.cjs).
  const plays = [0, 5, 15, ...[0, 1, 2, 3, 4, 5].map(s => 30 + 30 * s)];
  for (const line of globalThis.SenaJobRules.LINES)
    for (const n of plays) {
      const file = badgeImage('public', { line, plays: n });
      assert(existsSync(new URL('./' + file, import.meta.url)), file);
    }
  assert(existsSync(new URL('./public/badges/blank.png', import.meta.url)));
});

test('roster cards show badges, only the latest Cup 🥇 and 💩, guests and who just joined', () => {
  const data = {
    roster: [
      { id: 'a', name: 'Champ', award: '🥇', badge: { line: 'red', plays: 95, titles: 3 } },
      { id: 'b', name: 'Last', award: '💩', badge: { line: 'green', plays: 6, titles: 1 } },
      { id: 'c', name: 'New', award: '', badge: { line: 'blue', plays: 0, titles: 0 } },
      { id: 'd', name: 'Old', award: '', badge: { line: 'pink', plays: 40, titles: 2 } },
    ],
  };
  const session = {
    date: '2026-11-21',
    start: '19:00',
    end: '22:00',
    capacity: 5,
    confirmedCount: 5,
    waitlistCount: 0,
    courtNumbers: '3, 4',
    registrations: [
      { playerId: 'a', status: 'confirmed', position: 1 },
      { playerId: 'b', status: 'confirmed', position: 2 },
      { playerId: 'g1', status: 'confirmed', position: 3, guest: { name: 'Pal', hostId: 'a' } },
      { playerId: 'c', status: 'confirmed', position: 4 },
      { playerId: 'd', status: 'confirmed', position: 5 },
    ],
  };
  const bubble = rosterBubble(data, 'sena', session, {
    origin: 'https://x.test',
    bookUrl: 'https://x.test/court#booking',
    updated: '20:15',
    highlight: new Map([['c', '✨']]),
  });
  const text = flexText(bubble);
  assert.match(text, /^📍 เสนา · ส\. 21 พ\.ย\.\n19:00–22:00 น\. · คอร์ต 3, 4/);
  assert.match(text, /5 \/ 5 คน เต็ม/);
  // Only the latest Cup's winner and last place carry a mark; past champions
  // (Old won twice before) get none, and there is no 👑 history tag.
  assert.match(text, /1 🥇 Champ 2 💩 Last\n3 Pal \(แขกของ Champ\) 4 New ✨\n5 Old/);
  assert.doesNotMatch(text, /👑/);
  const icons = JSON.stringify(bubble).match(/https:\/\/x\.test\/badges\/[\w-]+\.png/g);
  assert.deepEqual(icons, [
    'https://x.test/badges/red-3-2.png',
    'https://x.test/badges/green-1.png',
    'https://x.test/badges/blank.png',
    'https://x.test/badges/novice.png',
    'https://x.test/badges/pink-3-0.png',
  ]);
  assert.equal(bubble.footer.contents[0].action.uri, 'https://x.test/court#booking');
  assert.deepEqual(flexProblems(bubble), []);
});

test('a roster card LINE rejects is resent once as plain text; an expired token is not', async t => {
  const f = fixture(t),
    date = future(1);
  f.seed('sena', [session(date)]);
  const bodies = [];
  let reject = true;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const body = JSON.parse(options.body);
    bodies.push(body);
    if (reject && body.messages.some(m => m.type === 'flex'))
      return Response.json(
        {
          message: 'A message (messages[0]) in the request body is invalid',
          details: [{ property: 'messages[0].contents.body', message: 'invalid' }],
        },
        { status: 400 },
      );
    return Response.json({});
  });
  assert.equal((await f.hook([f.event('badbot รายชื่อ')])).status, 200);
  assert.equal(bodies.length, 2);
  const [fallback] = bodies[1].messages;
  assert.equal(fallback.type, 'text');
  assert.match(fallback.text, /📍 เสนา[\s\S]*1 Nut 2 Bua[\s\S]*━━━━━━━━━━[\s\S]*📍 88/);
  assert.deepEqual(
    fallback.quickReply.items.map(i => i.action.data),
    ['badbot:roster:sena', 'badbot:roster:88'],
  );
  // A spent reply token (no validation details) is never retried.
  reject = false;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    bodies.push(JSON.parse(options.body));
    return Response.json({ message: 'Invalid reply token' }, { status: 400 });
  });
  await f.hook([f.event('badbot รายชื่อ')]);
  assert.equal(bodies.length, 3);
});

test('a summary card LINE rejects with its real error shape is resent as plain text', async t => {
  const f = fixture(t);
  f.db.exec(
    'CREATE TABLE bills(id TEXT PRIMARY KEY,club TEXT,session_date TEXT,revision INTEGER,payload TEXT,closed_at INTEGER,slips_removed INTEGER DEFAULT 0, created_at INTEGER)',
  );
  const id = 'd'.repeat(32);
  f.db.prepare('INSERT INTO bills (id,club,session_date,revision,payload) VALUES(?,?,?,0,?)').run(
    id,
    'sena',
    '2026-11-14',
    JSON.stringify({
      payers: [
        { name: 'Bua', amount: 9000, status: 'paid', method: 'cash', paidAt: 1, shares: [] },
      ],
    }),
  );
  const code = await createNotice(f.env.DB, {
    club: 'sena',
    kind: 'paid',
    payload: { billId: id },
  });
  const bodies = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const body = JSON.parse(options.body);
    bodies.push(body);
    // What LINE answered in production (2026-11-15): the index is only in the
    // message, the property is relative to the flex contents.
    if (body.messages.some(m => m.type === 'flex'))
      return Response.json(
        {
          message: 'A message (messages[0]) in the request body is invalid',
          details: [{ property: '/body/contents/3', message: 'invalid box content type' }],
        },
        { status: 400 },
      );
    return Response.json({});
  });
  assert.equal((await f.hook([f.event('💵 Bua จ่ายบิล … #' + code)])).status, 200);
  assert.equal(bodies.length, 2);
  assert.equal(bodies[1].messages[0].type, 'text');
  assert.match(bodies[1].messages[0].text, /ได้รับยอดครบถ้วน[\s\S]*Bua/);
});

test('bill summary cards show each person with badge, latest 🥇/💩, amount and how they paid', () => {
  const roster = [
    { id: 'p1', name: 'Champ', award: '🥇', badge: { line: 'red', plays: 95 } },
    { id: 'p2', name: 'Last', award: '💩', badge: { line: 'green', plays: 6 } },
  ];
  const info = {
    club: 'sena',
    label: 'SENA ส. 14 พ.ย.',
    full: false,
    total: 4,
    paidPeople: 4, // Last also covers Pal
    totalPeople: 5,
    paid: [
      { name: 'Champ', payerKey: 'member:p1', amount: 12000, method: 'transfer', shares: [] },
      {
        name: 'Last',
        payerKey: 'member:p2',
        amount: 24000,
        method: 'cash',
        shares: [{ name: 'Last' }, { name: 'Pal' }],
      },
      { name: 'Old', payerKey: 'legacy', amount: 12000, method: 'transfer' },
    ],
    owing: [{ name: 'Late', payerKey: 'member:p9', amount: 12000 }],
    paidSum: 48000,
    transfer: { count: 2, sum: 24000 },
    cash: { count: 1, sum: 24000 },
  };
  const bubble = paidBubble(info, roster, 'https://x.test');
  // LINE refused the first real card: badge icons sat in horizontal boxes.
  assert.deepEqual(flexProblems(bubble), []);
  assert.equal(
    flexText(bubble),
    [
      'แงงง ขุนเงินแอบเหงา บิลยังรอคนโอนอยู่น้าาา',
      '💸 บิล SENA ส. 14 พ.ย. · 📲 โอน 2 · 💵 เงินสด 1',
      'ได้รับแล้ว',
      '฿480 ขาด 1 คน',
      'จ่ายแล้ว 4/5 คน',
      'รายชื่อคนจ่าย',
      '🥇 Champ 📲 โอน 120',
      '💩 Last (รวม Pal) 💵 เงินสด 240',
      'O Old 📲 โอน 120', // not in the roster: a round initial instead of a badge
      'L Late ยังไม่จ่าย 120',
      'รวม 480 บ.',
      'ใครยังไม่จ่าย กด "บิลค้าง" ในเมนูได้เลยค่ะ',
    ].join('\n'),
  );
  // Not paid in full: the "pleading" mascot and a pink price tag.
  assert.equal(bubble.hero.url, 'https://x.test/mascot/hero-remind.jpg?v=1');
  const tag = b => b.body.contents[1];
  assert.equal(tag(bubble).background.endColor, '#E25563');
  const full = { ...info, full: true, paid: [...info.paid, ...info.owing], owing: [] };
  assert.equal(
    paidBubble(full, roster, 'https://x.test').hero.url,
    'https://x.test/mascot/hero-done.jpg?v=1',
  );
  // Paid in full the tag fades between two shades of the club's colour.
  assert.deepEqual(tag(paidBubble(full, roster, 'https://x.test')).background, {
    type: 'linearGradient',
    angle: '135deg',
    startColor: '#34C892',
    endColor: '#0E8F67',
  });
  assert.equal(
    tag(paidBubble({ ...full, club: '88' }, roster, 'https://x.test')).backgroundColor,
    '#2558B0',
    '88 is blue',
  );
  // One chick per person: four mint (paid), one faded.
  const chicks = JSON.stringify(bubble.body.contents[2]);
  assert.equal(chicks.match(/mascot\/chick\.png/g).length, 4);
  assert.equal(chicks.match(/mascot\/chick-off\.png/g).length, 1);
  assert.deepEqual(JSON.stringify(bubble).match(/https:\/\/x\.test\/badges\/[\w-]+\.png/g), [
    'https://x.test/badges/red-3-2.png',
    'https://x.test/badges/green-1.png',
  ]);
  // A huge bill stays inside LINE's 30 KB bubble limit.
  const many = {
    ...info,
    paid: Array.from({ length: 200 }, (_, i) => ({ ...info.paid[0], name: 'P' + i })),
  };
  const big = JSON.stringify(paidBubble(many, roster, 'https://x.test'));
  assert(big.length < 30000);
  assert.match(flexText(JSON.parse(big)), /… อีก 161 คน/);
});

test('table cards: schedule cap and rest marks, podium order, shared first place', () => {
  const make = n =>
    Array.from({ length: n }, (_, i) => ({
      round: i + 1,
      left: ['A' + i, 'B' + i],
      right: ['C' + i, 'D' + i],
      rest: i === 2,
    }));
  // A usual night (10 games) shows every game, with the rest legend.
  const schedule = gamesBubble({
    club: 'sena',
    title: 'T',
    games: make(10),
    url: 'https://x.test/court',
  });
  const text = flexText(schedule);
  assert.match(text, /เกม 10 A9 \/ B9 vs C9 \/ D9\nแถบเหลือง = เว้นพักก่อนเกมนี้/);
  assert.doesNotMatch(text, /อีก/);
  assert.equal(schedule.footer.contents[0].action.uri, 'https://x.test/court');
  // Only a very long schedule is cut, and even long names stay inside LINE's 30 KB.
  assert.match(
    flexText(gamesBubble({ club: 'sena', title: 'T', games: make(30) })),
    /เกม 20 .*\n… อีก 10 เกม/,
  );
  const long = make(30).map(g => ({ ...g, left: ['ยาว'.repeat(40), 'ยาว'.repeat(40)] }));
  assert(JSON.stringify(gamesBubble({ club: '88', title: 'T', games: long })).length < 30000);

  const row = (name, w) => ({ name, w, played: 10 });
  const board = leaderboardBubble({
    club: 'sena',
    rows: ['ต้น', 'แนน', 'เจ', 'โอ๊ต', 'มิ้นท์', 'ไม่โชว์'].map((n, i) => row(n, 9 - i)),
    url: 'https://x.test/court#leaderboard',
  });
  // Podium blocks stand 2nd · 1st · 3rd with 1st the tallest; 4th and 5th are rows.
  const [podium] = board.body.contents;
  assert.deepEqual(
    podium.contents.map(b => b.contents[1].text),
    ['แนน', 'ต้น', 'เจ'],
  );
  assert.deepEqual(
    podium.contents.map(b => b.height),
    ['104px', '118px', '96px'],
  );
  assert.match(
    flexText(board),
    /🥈\nแนน\nชนะ 8\/10 🥇\nต้น\nชนะ 9\/10 🥉\nเจ\nชนะ 7\/10\n4\. โอ๊ต ชนะ 6\/10\n5\. มิ้นท์ ชนะ 5\/10\nดูอันดับทั้งหมด$/,
  );
  assert.doesNotMatch(flexText(board), /ไม่โชว์/);
  // Fewer than three players: plain rows, no podium.
  const small = leaderboardBubble({ club: '88', rows: [row('หนึ่ง', 3), row('สอง', 2)] });
  assert.equal(flexText(small).includes('🥇'), false);
  assert.match(flexText(small), /1\. หนึ่ง ชนะ 3\/10\n2\. สอง ชนะ 2\/10/);

  const cup = cupResultBubble({
    club: 'sena',
    title: 'Sena Cup #12',
    date: 'ส. 7 พ.ย.',
    rows: [
      { rank: 1, name: 'A / B', w: 3, played: 4, pf: 80, pa: 60 },
      { rank: 1, name: 'C / D', w: 3, played: 4, pf: 80, pa: 60 },
      { rank: 3, name: 'E / F', w: 1, played: 4, pf: 50, pa: 70 },
    ],
  });
  assert.equal(
    flexText(cup),
    [
      '🏆 Sena Cup #12',
      'ส. 7 พ.ย.',
      '🥇',
      'A / B',
      'ชนะ 3/4 · แต้ม 80–60',
      'C / D',
      'ชนะ 3/4 · แต้ม 80–60',
      '3. E / F 1/4 · 50–70',
    ].join('\n'),
  );
  // The leaderboard keeps its gold fade; the schedule takes the club's gradient.
  assert.equal(board.header.background.startColor, '#B8860B');
  assert.equal(schedule.header.background.startColor, '#0E6B31');
  for (const b of [schedule, board, small, cup]) assert.deepEqual(flexProblems(b), []);
});

test('table shortcuts with nothing to show still answer in plain text', async t => {
  const f = fixture(t);
  for (const command of ['senacup', 'matchup senacup', 'matchup sena']) {
    await f.hook([f.event('badbot ' + command)]);
    assert.deepEqual(
      f.calls.at(-1).messages.map(m => m.type),
      ['text'],
      command,
    );
  }
  assert.match(textOf(f.calls[0]), /ยังไม่มีผล Sena Cup/);
  assert.match(textOf(f.calls[1]), /ยังไม่มีตาราง Sena Cup/);
});

test('outstanding-bill cards list each person owing, tag failures and cash waiting; oversize falls back', () => {
  const bill = (title, unpaid, extra = {}) => ({
    club: extra.club || 'sena',
    title,
    extra: '',
    owed: unpaid.reduce((n, p) => n + p.amount, 0),
    paidCount: 9,
    total: 9 + unpaid.length + (extra.reviewing || 0),
    unpaid,
    reviewing: 0,
    payUrl: 'https://liff.line.me/x?club=sena&page=pay&bill=b1',
    ...extra,
  });
  const card = owedMessage(
    [
      bill(
        'บิล Sena · ส. 14 พ.ย.',
        [
          { name: 'บอส', amount: 12000, note: '' },
          { name: 'ปาล์ม', amount: 12000, note: 'แท็กไม่สำเร็จ: ยังไม่ผูกบัญชี LINE' },
        ],
        { reviewing: 1 },
      ),
      bill('บิล 88 · อา. 15 พ.ย.', [{ name: 'หมิว', amount: 15000, note: '' }], {
        extra: 'บิลเพิ่มเติม',
        club: '88',
      }),
    ],
    { heading: '💸 บิลค้าง · ทุกสนาม', note: 'แสดง 3 บิลเก่าสุดต่อสนาม · ดูบิลอื่นกับผู้จัด' },
  );
  assert.equal(
    card.altText,
    '💸 บิลค้าง · ทุกสนาม · Sena · ส. 14 พ.ย. ค้าง 2 คน · 88 · อา. 15 พ.ย. ค้าง 1 คน',
  );
  assert.deepEqual(flexProblems(card.contents), []);
  const [sena, other] = card.contents.contents;
  const colors = b => [
    b.body.contents[1].backgroundColor,
    b.footer.contents[0].action && b.footer.contents[0].color,
  ];
  assert.deepEqual(colors(sena), ['#0E8F67', '#17A673']);
  assert.deepEqual(colors(other), ['#2558B0', '#3F7FD6'], 'an 88 bill is blue throughout');
  assert.equal(
    flexText(sena),
    [
      'แงงง ขุนเงินแอบเหงา บิลยังรอคนโอนอยู่น้าาา', // some paid already: a reminder line
      '🧾 บิล Sena · ส. 14 พ.ย.',
      'ยอดค้างทั้งหมด',
      '฿240',
      'จ่ายแล้ว 9/12 คน',
      'ยังไม่จ่าย 2 คน',
      'บ บอส 120 บ.', // round initial, name, amount
      'ป ปาล์ม 120 บ.',
      'แท็กไม่สำเร็จ: ยังไม่ผูกบัญชี LINE',
      '⏳ รอตรวจสลิป/เงินสด 1 คน',
      '💳 จ่าย / ดู QR',
      'จ่ายแล้วแนบสลิปในหน้าจ่ายได้เลยน้า ขอบคุณค่ะ',
    ].join('\n'),
  );
  assert.equal(
    sena.footer.contents[0].action.uri,
    'https://liff.line.me/x?club=sena&page=pay&bill=b1',
  );
  // "Showing the oldest bills" sits on the last card only; extra bills say so.
  assert.match(
    flexText(other),
    /฿150 บิลเพิ่มเติม\nจ่ายแล้ว 9\/10 คน[\s\S]*แสดง 3 บิลเก่าสุดต่อสนาม/,
  );
  assert.doesNotMatch(flexText(sena), /แสดง 3 บิล/);
  // A fresh bill (nobody paid yet) gets the winking mascot and an opening line;
  // reminders get the pleading one.
  const fresh = owedMessage(
    [
      bill('บิล Sena · ส. 14 พ.ย.', [{ name: 'บอส', amount: 12000, note: '' }], {
        paidCount: 0,
        total: 1,
      }),
    ],
    { heading: 'h', note: '', origin: 'https://x.test' },
  ).contents;
  assert.equal(fresh.hero.url, 'https://x.test/mascot/hero-open.jpg?v=1');
  assert.match(flexText(fresh), /เปิดบิลแล้วค่าาา ใครพร้อมโอนยกมือขึ้นนน/);
  assert.match(sena.hero.url, /\/mascot\/hero-remind\.jpg\?v=1$/);
  // Players show their job badge and the latest Cup's 🥇; guests keep a round initial.
  const badged = owedMessage(
    [
      bill('บิล Sena · ส. 14 พ.ย.', [
        {
          name: 'Champ',
          amount: 12000,
          note: '',
          badge: { line: 'green', plays: 40 },
          award: '🥇',
        },
        { name: 'Guest', amount: 12000, note: '' },
      ]),
    ],
    { heading: 'h', note: '', origin: 'https://x.test' },
  ).contents;
  assert.deepEqual(flexProblems(badged), []);
  assert.deepEqual(JSON.stringify(badged).match(/https:\/\/x\.test\/badges\/[\w-]+\.png/g), [
    badgeImage('https://x.test', { line: 'green', plays: 40 }),
  ]);
  assert.match(flexText(badged), /🥇 Champ 120 บ\.\nG Guest 120 บ\./);
  // A line that covers several people (host + guest) counts every one of them.
  const hosted = owedMessage(
    [bill('บิล Sena · ส. 14 พ.ย.', [{ name: 'เจ', amount: 24000, note: '', people: 2 }])],
    { heading: 'h', note: '' },
  );
  assert.match(flexText(hosted.contents), /ยังไม่จ่าย 2 คน\nจ เจ \(รวม 2 คน\) 240 บ\./);
  assert.match(hosted.altText, /ค้าง 2 คน$/);
  // Past 20 people, a bill lists everyone in one compact block.
  const crowd = Array.from({ length: 60 }, (_, i) => ({ name: 'P' + i, amount: 1700, note: '' }));
  const big = owedMessage([bill('บิล Sena · ส. 14 พ.ย.', crowd)], { heading: 'h', note: '' });
  assert.match(flexText(big.contents), /• P0 17 บ\.\n• P1 17 บ\.[\s\S]*• P59 17 บ\./);
  // A card LINE would refuse for size is not built; the caller sends text instead.
  const huge = crowd.map(p => ({ ...p, name: 'ยาว'.repeat(200) + p.name }));
  assert.equal(
    owedMessage([bill('บิล Sena · ส. 14 พ.ย.', huge)], { heading: 'h', note: '' }),
    null,
  );
});
