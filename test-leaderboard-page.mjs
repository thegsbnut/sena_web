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
      const el = {
        id,
        hidden: false,
        disabled: false,
        innerHTML: '',
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
  const sandbox = {
    document: {
      querySelector: selector => element(selector),
      querySelectorAll: () => [],
    },
    window: { dispatchEvent() {} },
    CustomEvent: class {},
    esc: value => String(value),
    activeClub: '88',
    cupName: '88 Cup',
    state: { players: [], cup: null },
    confirm: () => true,
    venueFetch: async (path, options = {}) => {
      if (options.method === 'POST') posts.push(JSON.parse(options.body));
      const body = responses.shift() ?? {};
      return { ok: !body.error, json: async () => body };
    },
    Sena: { standings: () => [] },
    SenaHistoryForm: { parseTeams: () => [] },
    structuredClone,
    Intl,
    console,
  };
  return { sandbox, element, posts };
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
  assert.equal(element('#leaderboardStatus').textContent, 'ข้อมูลออนไลน์ล่าสุด');
});
