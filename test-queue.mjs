import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import worker from './worker.js';
import { bangkokDate } from './booking.js';
import './public/queue-engine.js';

const Q = globalThis.SenaQueue;
const origin = 'https://example.com';
const players = Array.from({ length: 12 }, (_, i) => ({
  id: 'p' + i,
  name: 'Player ' + i,
  thai: '',
  lv: 4 + (i % 5),
  gender: i % 4 === 0 ? 'F' : 'M',
}));
const qp = n => players.slice(0, n).map(p => ({ id: p.id, name: p.name, lv: p.lv, g: p.gender }));
// Deterministic "random" so engine tests don't flake.
const seeded =
  (seed = 1) =>
  () =>
    ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

function fixture({ session = true } = {}) {
  const db = new DatabaseSync(':memory:');
  db.exec(
    'CREATE TABLE club_state(id INTEGER PRIMARY KEY,revision INTEGER,payload TEXT,updated_at TEXT); CREATE TABLE login_attempts(ip TEXT PRIMARY KEY,window INTEGER,attempts INTEGER); CREATE TABLE booking_clubs (club TEXT PRIMARY KEY, revision INTEGER NOT NULL, payload TEXT NOT NULL, updated_at TEXT NOT NULL)',
  );
  db.prepare('INSERT INTO club_state VALUES(1,1,?,?)').run(
    JSON.stringify({ players, selected: [], rounds: 10, locks: [], result: null, cup: null }),
    'before',
  );
  const today = bangkokDate(new Date());
  const regs = players.slice(0, 9).map((p, i) => ({ id: 'r' + i, playerId: p.id, seq: i + 1 }));
  regs.splice(2, 0, {
    id: 'rg',
    playerId: 'guest:abc',
    seq: 99,
    guest: { name: 'Outside', gender: 'F', hostId: 'p0' },
  });
  db.prepare('INSERT INTO booking_clubs VALUES (?,?,?,?)').run(
    'sena',
    1,
    JSON.stringify({
      settings: { courtNumbers: '' },
      sessions: session
        ? [
            {
              id: today,
              date: today,
              start: '19:00',
              end: '22:00',
              capacity: 8,
              registrations: regs,
              courtNumbers: '6, 7',
            },
          ]
        : [],
      seq: 10,
    }),
    'x',
  );
  const env = {
    ADMIN_KEY: 'abcdef7',
    DB: {
      prepare(sql) {
        const stmt = db.prepare(sql);
        let args = [];
        return {
          bind(...v) {
            args = v;
            return this;
          },
          first() {
            return stmt.get(...args) ?? null;
          },
          all() {
            return { results: stmt.all(...args) };
          },
          run() {
            return { meta: { changes: stmt.run(...args).changes } };
          },
        };
      },
    },
  };
  const call = (body, cookie = '', club = 'sena') =>
    worker.fetch(
      new Request(origin + '/api/queue' + (club === '88' ? '?club=88' : ''), {
        method: body ? 'POST' : 'GET',
        headers: { Origin: origin, ...(cookie ? { Cookie: cookie } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      }),
      env,
    );
  const login = async () => {
    const r = await worker.fetch(
      new Request(origin + '/api/login', {
        method: 'POST',
        headers: { Origin: origin },
        body: JSON.stringify({ key: env.ADMIN_KEY }),
      }),
      env,
    );
    assert.equal(r.status, 200);
    return r.headers.get('Set-Cookie').split(';')[0];
  };
  return { db, call, login };
}

test('engine: fills every court with four distinct waiting players', () => {
  const S = Q.create(qp(12), 2, 1000, seeded());
  assert.equal(S.courts.length, 2);
  const called = S.courts.flatMap(c => c.teams.flat());
  assert.equal(called.length, 8);
  assert.equal(new Set(called).size, 8);
  for (const id of called) assert.equal(S.players[id].status, 'called');
  assert.equal(Object.values(S.players).filter(p => p.status === 'wait').length, 4);
});

test('engine: fewest games go first and games count on start, not on call', () => {
  const rng = seeded(7);
  const S = Q.create(qp(8), 1, 0, rng);
  const first = S.courts[0].teams.flat();
  assert.ok(first.every(id => S.players[id].games === 0));
  Q.apply(S, { action: 'startCourt', court: 0 }, { now: 10, rng });
  assert.ok(first.every(id => S.players[id].games === 1 && S.players[id].status === 'play'));
  Q.apply(S, { action: 'finish', court: 0, win: 'a' }, { now: 20, rng });
  // The next four are the four who have not played yet.
  const next = S.courts[0].teams.flat();
  assert.ok(next.every(id => !first.includes(id)));
  assert.equal(S.history.length, 1);
  assert.equal(S.history[0].win, 'a');
  const winners = first.slice(0, 2);
  assert.ok(winners.every(id => S.players[id].wins === 1));
});

test('engine: rest swaps the player out without counting a game and skips their next call', () => {
  const rng = seeded(3);
  const S = Q.create(qp(9), 1, 0, rng);
  const [out] = S.courts[0].teams.flat();
  Q.apply(S, { action: 'rest', court: 0, pid: out }, { now: 5, rng });
  assert.equal(S.players[out].status, 'wait');
  assert.equal(S.players[out].games, 0);
  assert.ok(!S.courts[0].teams.flat().includes(out));
  assert.equal(S.courts[0].teams.flat().length, 4);
});

test('engine: women pair never meets a mixed pair when avoidable', () => {
  const mixed = [
    { id: 'f1', name: 'F1', lv: 5, g: 'F' },
    { id: 'f2', name: 'F2', lv: 5, g: 'F' },
    { id: 'f3', name: 'F3', lv: 5, g: 'F' },
    { id: 'm1', name: 'M1', lv: 5, g: 'M' },
  ];
  for (let seed = 1; seed < 30; seed++) {
    const S = Q.create(mixed, 1, 0, seeded(seed));
    const [a, b] = S.courts[0].teams;
    // 3 women + 1 man: every split has FF vs MF, so the rule must relax rather than stall.
    assert.ok(a && b);
  }
  const six = mixed.concat([
    { id: 'm2', name: 'M2', lv: 5, g: 'M' },
    { id: 'f4', name: 'F4', lv: 5, g: 'F' },
  ]);
  for (let seed = 1; seed < 30; seed++) {
    const S = Q.create(six, 1, 0, seeded(seed));
    const [a, b] = S.courts[0].teams;
    assert.ok(Q.validMatch(S, a, b));
  }
});

test('engine: late arrival starts at the average and leave/rejoin keeps their count', () => {
  const rng = seeded(5);
  const S = Q.create(qp(8), 1, 0, rng);
  Q.apply(S, { action: 'startCourt', court: 0 }, { now: 1, rng });
  Q.apply(S, { action: 'finish', court: 0 }, { now: 2, rng });
  Q.apply(S, { action: 'startCourt', court: 0 }, { now: 3, rng });
  Q.apply(S, { action: 'finish', court: 0 }, { now: 4, rng });
  Q.apply(S, { action: 'add', player: null }, { now: 5, rng, player: qp(9)[8] });
  assert.equal(S.players.p8.games, 1);
  const waiting = Object.values(S.players).find(p => p.status === 'wait');
  Q.apply(S, { action: 'leave', pid: waiting.id }, { now: 6, rng });
  assert.equal(S.players[waiting.id].status, 'gone');
  Q.apply(S, { action: 'add' }, { now: 7, rng, player: S.players[waiting.id] });
  assert.equal(S.players[waiting.id].status, 'wait');
  assert.throws(() => Q.apply(S, { action: 'finish', court: 0 }, { now: 8, rng }), Q.QueueError);
});

test('engine: public view hides Lv', () => {
  const S = Q.create(qp(8), 1, 0, seeded());
  const v = Q.publicView(S);
  assert.ok(Object.values(v.players).every(p => !('lv' in p)));
  assert.equal(S.players.p0.lv, players[0].lv);
});

test('api: organizer starts from today booking, guests watch without Lv', async t => {
  const f = fixture();
  t.after(() => f.db.close());
  const guest = await (await f.call()).json();
  assert.equal(guest.state, null);
  assert.equal(guest.canEdit, false);
  assert.equal(guest.roster, undefined);
  assert.equal((await f.call({ action: 'start', revision: 0, ids: ['p0'] })).status, 401);

  const cookie = await f.login();
  const before = await (await f.call(null, cookie)).json();
  assert.equal(before.canEdit, true);
  // Capacity 8 keeps the first 8 registrations (the guest is third).
  assert.deepEqual(
    before.session.booked.map(p => p.id),
    ['p0', 'p1', 'guest:abc', 'p2', 'p3', 'p4', 'p5', 'p6'],
  );
  assert.deepEqual(before.session.courtNumbers, ['6', '7']);
  assert.equal(before.roster.length, 12);

  const ids = before.session.booked.map(p => p.id).filter(id => id !== 'p6');
  const r = await f.call(
    {
      action: 'start',
      revision: 0,
      ids,
      extra: [{ name: ' Walk  In ', lv: 6.5, g: 'M' }],
      courts: 2,
    },
    cookie,
  );
  assert.equal(r.status, 200);
  const started = await r.json();
  assert.equal(Object.keys(started.state.players).length, 8);
  assert.ok(Object.values(started.state.players).some(p => p.name === 'Walk In'));
  assert.equal(started.state.players['guest:abc'].lv, 6.5);
  assert.deepEqual(started.state.labels, ['6', '7']);
  assert.equal(started.state.courts.filter(c => c.phase === 'called').length, 2);

  const watch = await (await f.call()).json();
  assert.equal(watch.revision, started.revision);
  assert.ok(Object.values(watch.state.players).every(p => !('lv' in p)));
  assert.equal(watch.canUndo, false);
  assert.equal(
    (await f.call({ action: 'startCourt', revision: watch.revision, court: 0 })).status,
    401,
  );
});

test('api: stale revision gets 409 with the current queue; undo restores', async t => {
  const f = fixture();
  t.after(() => f.db.close());
  const cookie = await f.login();
  const start = await (
    await f.call({ action: 'start', revision: 0, ids: players.slice(0, 8).map(p => p.id) }, cookie)
  ).json();
  const go = await f.call({ action: 'startCourt', revision: start.revision, court: 0 }, cookie);
  assert.equal(go.status, 200);
  const played = await go.json();
  assert.equal(played.state.courts[0].phase, 'playing');

  const stale = await f.call({ action: 'reroll', revision: start.revision, court: 0 }, cookie);
  assert.equal(stale.status, 409);
  const body = await stale.json();
  assert.equal(body.revision, played.revision);
  assert.equal(body.state.courts[0].phase, 'playing');

  const wrongPhase = await f.call(
    { action: 'reroll', revision: played.revision, court: 0 },
    cookie,
  );
  assert.equal(wrongPhase.status, 400);

  const undone = await (await f.call({ action: 'undo', revision: played.revision }, cookie)).json();
  assert.equal(undone.state.courts[0].phase, 'called');
  assert.deepEqual(undone.state.courts[0].teams, start.state.courts[0].teams);

  const ended = await (await f.call({ action: 'end', revision: undone.revision }, cookie)).json();
  assert.equal(ended.state, null);
  assert.equal(ended.canUndo, true);
});

test('api: validates input and works without a booking session', async t => {
  const f = fixture({ session: false });
  t.after(() => f.db.close());
  const cookie = await f.login();
  const info = await (await f.call(null, cookie)).json();
  assert.equal(info.session, null);
  const bad = async (body, status = 400) =>
    assert.equal((await f.call({ revision: 0, ...body }, cookie)).status, status);
  await bad({ action: 'start', ids: ['p0', 'p1', 'p2'] });
  await bad({ action: 'start', ids: ['p0', 'p1', 'p2', 'nobody'] }, 409);
  await bad({ action: 'start', ids: ['p0', 'p1', 'p2', 'p3'], courts: 9 });
  await bad({
    action: 'start',
    ids: ['p0', 'p1', 'p2'],
    extra: [{ name: '\u0000', lv: 5, g: 'M' }],
  });
  await bad({ action: 'start', ids: ['p0', 'p1', 'p2'], extra: [{ name: 'X', lv: 5, g: 'X' }] });
  await bad({ action: 'startCourt', court: 0 });
  await bad({ action: 'nope' });
  const ok = await f.call(
    { action: 'start', revision: 0, ids: ['p0', 'p1', 'p2', 'p3', 'p4'] },
    cookie,
  );
  assert.equal(ok.status, 200);
  const s = await ok.json();
  assert.equal(s.state.courts.length, 1);
  const add = await f.call({ action: 'add', revision: s.revision, pid: 'p9' }, cookie);
  assert.equal(add.status, 200);
  assert.equal((await add.json()).state.players.p9.name, 'Player 9');
});

test('api: club=88 queue is isolated from sena even without club_state_88', async t => {
  const f = fixture();
  t.after(() => f.db.close());
  const cookie = await f.login();
  const sena = await f.call(
    { action: 'start', revision: 0, ids: ['p0', 'p1', 'p2', 'p3'] },
    cookie,
    'sena',
  );
  assert.equal(sena.status, 200);
  const g88 = await (await f.call(null, cookie, '88')).json();
  assert.equal(g88.state, null);
  assert.deepEqual(g88.roster, []);
  const start88 = await f.call(
    {
      action: 'start',
      revision: 0,
      ids: [],
      extra: [
        { name: 'A', lv: 5, g: 'M' },
        { name: 'B', lv: 5, g: 'M' },
        { name: 'C', lv: 5, g: 'M' },
        { name: 'D', lv: 5, g: 'M' },
      ],
    },
    cookie,
    '88',
  );
  assert.equal(start88.status, 200);
  assert.equal(Object.keys((await start88.json()).state.players).length, 4);
});

test('page: queue.js boots and renders guest and organizer views without errors', async () => {
  const html = fs.readFileSync('public/queue.html', 'utf8');
  const ids = [...html.matchAll(/id="([^"]+)"/g)].map(m => m[1]);
  const els = new Map(
    ids.map(id => [
      id,
      {
        id,
        value: '',
        textContent: '',
        innerHTML: '',
        hidden: false,
        disabled: false,
        href: '',
        open: false,
        classList: { toggle() {}, add() {}, remove() {} },
        setAttribute() {},
      },
    ]),
  );
  const activeState = Q.create(qp(8), 2, 1000, seeded(), ['6', '7']);
  for (const [name, payload, check] of [
    [
      'guest-empty',
      { state: null, revision: 0, updatedAt: null, canUndo: false, canEdit: false },
      s => s.includes('ยังไม่เริ่มคิววันนี้'),
    ],
    [
      'admin-setup',
      {
        state: null,
        revision: 0,
        updatedAt: null,
        canUndo: false,
        canEdit: true,
        session: {
          date: '2026-11-18',
          start: '19:00',
          end: '22:00',
          booked: qp(8),
          courtNumbers: ['6', '7'],
        },
        roster: qp(8),
      },
      s => s.includes('เริ่มคิว 8 คน'),
    ],
    [
      'admin-active',
      {
        state: activeState,
        revision: 1,
        updatedAt: 'x',
        canUndo: true,
        canEdit: true,
        session: null,
        roster: qp(8),
      },
      s => s.includes('COURT'),
    ],
  ]) {
    els.get('status').hidden = false;
    els.get('status').textContent = '';
    els.get('app').innerHTML = '';
    const ctx = {
      URLSearchParams,
      Date,
      Math,
      Object,
      Array,
      Set,
      Map,
      JSON,
      String,
      Number,
      Boolean,
      SenaQueue: Q,
      location: { search: '', assign() {} },
      localStorage: { getItem: () => null, setItem() {} },
      matchMedia: () => ({ matches: true }),
      setInterval: () => 0,
      setTimeout: () => 0,
      clearTimeout: () => {},
      fetch: async () => ({ ok: true, json: async () => payload }),
      document: {
        hidden: false,
        activeElement: null,
        body: { classList: { toggle() {}, add() {}, remove() {} } },
        querySelector: sel => (sel.startsWith('#') ? els.get(sel.slice(1)) || null : null),
        querySelectorAll: () => [],
        addEventListener() {},
      },
    };
    ctx.window = ctx;
    vm.runInNewContext(fs.readFileSync('public/queue.js', 'utf8'), ctx);
    await new Promise(r => setTimeout(r, 10));
    assert.equal(els.get('status').hidden, true, name + ': ' + els.get('status').textContent);
    assert.ok(check(els.get('app').innerHTML), name);
  }
});
