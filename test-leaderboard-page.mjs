import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Run the real public/leaderboard.js against a stub page: a missing helper (a variable
// lost in an edit) only shows up in the browser as "Can't find variable", so load the
// script, let it draw a board and save a cup through the name check.
function page(responses) {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) {
      let html = '';
      const el = {
        id,
        hidden: false,
        disabled: false,
        get innerHTML() {
          return html;
        },
        set innerHTML(v) {
          html = String(v);
          const opts = this.options;
          if (opts.length && !opts.some(o => o.value === this.value)) this.value = opts[0].value;
          if (!opts.length && this.value) this.value = '';
        },
        get options() {
          return [...html.matchAll(/<option value="([^"]*)">/g)].map(m => ({ value: m[1] }));
        },
        textContent: '',
        value: '',
        dataset: {},
        elements: new Proxy({}, { get: (_, name) => element(id + '.' + name) }),
        addEventListener() {},
        querySelector: selector => element(id + ' ' + selector),
        querySelectorAll: () => [],
        closest: () => element(id + ':closest'),
        scrollIntoView() {},
        focus() {},
        reset() {},
      };
      elements.set(id, el);
    }
    return elements.get(id);
  };
  const posts = [];
  const events = [];
  const listeners = new Map();
  const sandbox = {
    document: {
      getElementById: id => element('#' + id),
      querySelector: selector => element(selector),
      querySelectorAll: () => [],
    },
    CustomEvent: class {
      constructor(type, init = {}) {
        this.type = type;
        this.detail = init.detail;
      }
    },
    esc: value => String(value),
    activeClub: '88',
    cupName: '88 Cup',
    venueLabel: '88 Club',
    state: { players: [], cup: null },
    confirm: () => true,
    venueFetch: async (path, options = {}) => {
      if (options.method === 'POST') posts.push(JSON.parse(options.body));
      const body = responses.shift() ?? {};
      return { ok: !body.error, json: async () => body };
    },
    Sena: { standings: () => [], cupAwards: () => new Map() },
    SenaHistoryForm: { parseTeams: () => [] },
    structuredClone,
    Intl,
    console,
  };
  sandbox.window = sandbox;
  sandbox.dispatchEvent = ev => {
    events.push(ev);
    for (const fn of listeners.get(ev.type) || []) fn(ev);
  };
  sandbox.addEventListener = (type, fn) => {
    if (!listeners.has(type)) listeners.set(type, []);
    listeners.get(type).push(fn);
  };
  return { sandbox, element, posts, events };
}

test('leaderboard.js วาดตารางอันดับได้โดยไม่มีตัวแปรหาย', async () => {
  const board = {
    canEdit: true,
    history: [],
    standings: [
      {
        position: 1,
        name: 'Ann',
        played: 2,
        w: 2,
        l: 0,
        pf: 42,
        pa: 20,
        diff: 22,
        winPercent: 100,
        crown: 1,
        poo: 0,
        change: 1,
      },
      {
        position: 2,
        name: 'Bob',
        played: 2,
        w: 0,
        l: 2,
        pf: 20,
        pa: 42,
        diff: -22,
        winPercent: 0,
        crown: 0,
        poo: 1,
        change: 'NEW',
      },
    ],
  };
  const { sandbox, element } = page([board]);
  vm.runInNewContext(readFileSync('./public/leaderboard.js', 'utf8'), sandbox);
  await new Promise(resolve => setTimeout(resolve, 10));
  const rows = element('#leaderboardRows').innerHTML;
  assert.match(rows, /Ann/);
  assert.match(rows, /↑ 1/);
  assert.match(rows, /NEW/);
  assert.doesNotMatch(rows, /class="is-me"/);
  assert.equal(sandbox.window.SenaLeaderboardSnapshot.me, null);
  assert.equal(element('#leaderboardStatus').textContent, '');
});

test('leaderboard.js ไฮไลต์แถวของสมาชิกที่ล็อกอินและส่งชื่อ me ให้ buddy-ui เลือกอัตโนมัติ', async () => {
  const board = {
    canEdit: false,
    me: 'Bob',
    history: [
      {
        title: 'Cup 1',
        date: '2026-11-17',
        teams: [
          ['Ann', 'Bob'],
          ['Cat', 'Dan'],
        ],
        matches: [{ a: 0, b: 1, sa: 21, sb: 15 }],
      },
    ],
    standings: [
      {
        position: 1,
        name: 'Ann',
        played: 1,
        w: 1,
        l: 0,
        pf: 21,
        pa: 15,
        diff: 6,
        winPercent: 100,
        crown: 1,
        poo: 0,
        change: 'NEW',
      },
      {
        position: 2,
        name: 'Bob',
        played: 1,
        w: 1,
        l: 0,
        pf: 21,
        pa: 15,
        diff: 6,
        winPercent: 100,
        crown: 0,
        poo: 0,
        change: 'NEW',
      },
    ],
  };
  const { sandbox, element, events } = page([board]);
  vm.runInNewContext(readFileSync('./public/buddy-stats.js', 'utf8'), sandbox);
  vm.runInNewContext(readFileSync('./public/buddy-ui.js', 'utf8'), sandbox);
  vm.runInNewContext(readFileSync('./public/leaderboard.js', 'utf8'), sandbox);
  await new Promise(resolve => setTimeout(resolve, 10));

  const rows = element('#leaderboardRows').innerHTML;
  assert.match(
    rows,
    /<tr class="is-me"><td class="rank-2">2<\/td><th scope="row">Bob <span class="me-tag">คุณ<\/span><\/th>/,
  );
  assert.equal(sandbox.window.SenaLeaderboardSnapshot.me, 'Bob');
  assert.equal(events.at(-1)?.detail?.me, 'Bob');

  // buddy-ui auto-selects Bob from data.me on initial load
  const select = element('#buddyPlayer');
  assert.equal(select.value, 'Bob');

  // Once the user manually switches to Ann, a subsequent refresh must not override their choice
  select.value = 'Ann';
  select.onchange();
  sandbox.window.dispatchEvent(
    new sandbox.CustomEvent('sena:leaderboard', { detail: { ...board } }),
  );
  assert.equal(select.value, 'Ann');
});

test('cup history cards name the champion and the last-place team', async () => {
  const { readFileSync } = await import('node:fs');
  const js = readFileSync(new URL('./public/leaderboard.js', import.meta.url), 'utf8');
  assert.match(js, /Sena\.cupAwards\(c\)/);
  assert.match(js, /👑 แชม:/);
  assert.match(js, /💩 อุนจิ:/);
});
