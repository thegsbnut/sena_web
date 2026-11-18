// คิวสนาม (court queue): pure state functions shared by the Worker and the browser.
// Ported from the owner's demo (คิวสนาม_Sena.html). The Worker is the only writer;
// the page only renders. Rules (see the page's "กติกา" box):
// - fewest games first, then longest wait (lastEnd);
// - among players tied at the cut-off pick the most balanced / freshest split;
// - avoid the same four meeting again (may mix in someone one game ahead), repeat partners;
// - gender rule from engine.js: women's pair never meets a mixed pair (relaxed only if impossible);
// - "พัก" when called = not a game, stays in the queue but sits out the next call;
// - a game counts when "เริ่มตี" is pressed, not when called.
(function (root) {
  const MAX_COURTS = 8,
    MAX_PLAYERS = 40,
    LOG_SIZE = 40,
    HISTORY_SIZE = 60,
    REPEAT_FOUR = 40,
    AHEAD_COST = 55;

  class QueueError extends Error {}
  const fail = message => {
    throw new QueueError(message);
  };
  const key = (a, b) => (a < b ? a + '|' + b : b + '|' + a);
  const byOrder = (a, b) => a.games - b.games || a.lastEnd - b.lastEnd;
  const fourKey = f => f.slice().sort().join('~');
  const matchKey = t =>
    t
      .map(x => x.slice().sort().join('~'))
      .sort()
      .join('/');
  const splits = f => [
    [
      [f[0], f[1]],
      [f[2], f[3]],
    ],
    [
      [f[0], f[2]],
      [f[1], f[3]],
    ],
    [
      [f[0], f[3]],
      [f[1], f[2]],
    ],
  ];
  function combos(arr, k, start = 0, cur = [], out = []) {
    if (cur.length === k) {
      out.push(cur.slice());
      return out;
    }
    for (let i = start; i < arr.length; i++) {
      cur.push(arr[i]);
      combos(arr, k, i + 1, cur, out);
      cur.pop();
    }
    return out;
  }

  // ---------- state ----------
  function create(players, courts, now = Date.now(), rng = Math.random, labels = []) {
    if (!Array.isArray(players) || players.length < 4) fail('ต้องมีผู้เล่นอย่างน้อย 4 คน');
    if (players.length > MAX_PLAYERS) fail('รองรับสูงสุด ' + MAX_PLAYERS + ' คน');
    const count = Number.isInteger(courts) ? courts : Math.max(1, Math.round(players.length / 6));
    if (count < 1 || count > MAX_COURTS) fail('จำนวนคอร์ตต้องอยู่ระหว่าง 1–' + MAX_COURTS);
    const S = {
      v: 1,
      t: 1,
      createdAt: now,
      labels: labels.slice(0, MAX_COURTS).map(String),
      players: {},
      courts: Array.from({ length: count }, (_, n) => ({
        n: n + 1,
        phase: 'idle',
        teams: null,
        startedAt: 0,
      })),
      partner: {},
      meet: {},
      fours: {},
      log: [],
      history: [],
    };
    for (const p of players) {
      if (S.players[p.id]) fail('มีชื่อซ้ำในคิว');
      S.players[p.id] = {
        id: p.id,
        name: p.name,
        lv: p.lv,
        g: p.g,
        games: 0,
        // A little noise so the first calls aren't always in booking order.
        lastEnd: rng() * 0.5,
        status: 'wait',
        since: now,
      };
    }
    fill(S, rng);
    log(S, 'เริ่มคิว ' + players.length + ' คน ' + count + ' คอร์ต', now);
    return S;
  }
  // Real court numbers from the booking settings (e.g. "6, 7"); falls back to 1, 2, …
  const label = (S, c) => (S.labels && S.labels[c.n - 1]) || String(c.n);
  function log(S, txt, now = Date.now()) {
    S.log.unshift({ t: now, txt });
    S.log.length = Math.min(S.log.length, LOG_SIZE);
  }

  // ---------- selection ----------
  const eligible = (S, all = false) =>
    Object.values(S.players).filter(p => p.status === 'wait' && (all || !(p.skip > 0)));
  const clearSkips = S =>
    Object.values(S.players).forEach(p => {
      if (p.skip > 0) p.skip--;
    });
  function validMatch(S, x, y) {
    const f = t => t.filter(id => S.players[id].g === 'F').length;
    return !((f(x) === 2 && f(y) === 1) || (f(y) === 2 && f(x) === 1));
  }
  const strength = (S, team) => team.reduce((s, id) => s + S.players[id].lv, 0);

  // Picks 4 players (keeping `forced` ones) and the split into two teams.
  function choose(S, pool, forced = [], opts = {}, rng = Math.random) {
    const need = 4 - forced.length;
    const sorted = pool.slice().sort(byOrder);
    if (sorted.length < need) return null;
    const cut = need ? sorted[need - 1].games : 0;
    const must = sorted.filter(p => p.games < cut);
    const tied = sorted.filter(p => p.games === cut);
    // Players one game ahead may be mixed in, at a cost, so the same four don't keep
    // meeting when the other court is slow and only eight people are free.
    const higher = sorted.filter(p => p.games === cut + 1).slice(0, 4);
    const cand = must.concat(tied.slice(0, Math.max(0, need - must.length) + 2), higher);
    const rank = new Map(sorted.map((p, i) => [p.id, i]));
    for (const strict of [true, false]) {
      let best = null,
        bestScore = Infinity;
      for (const pick of combos(cand, need)) {
        if (must.some(m => !pick.includes(m))) continue;
        const four = forced.concat(pick.map(p => p.id));
        for (const teams of splits(four)) {
          if (opts.avoid && matchKey(teams) === opts.avoid) continue;
          if (strict && !validMatch(S, teams[0], teams[1])) continue;
          const diff = Math.abs(strength(S, teams[0]) - strength(S, teams[1]));
          const partner = teams.reduce((s, t) => s + (S.partner[key(t[0], t[1])] || 0), 0);
          let meets = 0;
          for (let i = 0; i < 4; i++)
            for (let j = i + 1; j < 4; j++) meets += S.meet[key(four[i], four[j])] || 0;
          const rankCost =
            pick.reduce((s, p) => s + rank.get(p.id), 0) * 2 +
            pick.filter(p => p.games > cut).length * AHEAD_COST;
          const repeatFour = S.fours[fourKey(four)] || 0;
          const score =
            diff * 6 +
            partner * 18 +
            meets * 4 +
            repeatFour * REPEAT_FOUR +
            rankCost +
            rng() * (opts.noise ?? 2);
          if (score < bestScore) {
            bestScore = score;
            best = teams;
          }
        }
      }
      if (best) return best;
    }
    return null;
  }
  function setCalled(S, court, teams) {
    court.teams = teams;
    court.phase = 'called';
    teams.flat().forEach(id => {
      S.players[id].status = 'called';
    });
    clearSkips(S);
  }
  function fill(S, rng = Math.random) {
    for (const c of S.courts) {
      if (c.phase !== 'idle') continue;
      const teams =
        choose(S, eligible(S), [], {}, rng) || choose(S, eligible(S, true), [], {}, rng);
      if (teams) setCalled(S, c, teams);
    }
  }
  function releaseCourt(S, c) {
    if (c.teams)
      c.teams.flat().forEach(id => {
        if (S.players[id].status === 'called') S.players[id].status = 'wait';
      });
    c.teams = null;
    c.phase = 'idle';
  }
  const names = (S, team) => team.map(id => S.players[id].name).join('+');

  // ---------- actions ----------
  // Every action mutates S in place; callers clone first if they need the old value.
  function courtAt(S, index, phase) {
    const c = S.courts[index];
    if (!Number.isInteger(index) || !c) fail('ไม่พบคอร์ต');
    if (phase && c.phase !== phase)
      fail('คอร์ต ' + label(S, c) + ' เปลี่ยนสถานะไปแล้ว กรุณาโหลดใหม่');
    return c;
  }
  function playerAt(S, id) {
    const p = typeof id === 'string' && Object.hasOwn(S.players, id) ? S.players[id] : null;
    if (!p) fail('ไม่พบผู้เล่น');
    return p;
  }
  function startCourt(S, c, now) {
    const four = c.teams.flat();
    four.forEach(id => {
      const p = S.players[id];
      p.status = 'play';
      p.games++;
    });
    for (const t of c.teams) S.partner[key(t[0], t[1])] = (S.partner[key(t[0], t[1])] || 0) + 1;
    for (let i = 0; i < 4; i++)
      for (let j = i + 1; j < 4; j++)
        S.meet[key(four[i], four[j])] = (S.meet[key(four[i], four[j])] || 0) + 1;
    S.fours[fourKey(four)] = (S.fours[fourKey(four)] || 0) + 1;
    c.phase = 'playing';
    c.startedAt = now;
    log(S, 'คอร์ต ' + label(S, c) + ' เริ่มตี: ' + c.teams.map(t => names(S, t)).join(' vs '), now);
  }
  function finishCourt(S, c, win, now, rng) {
    S.history.unshift({
      n: c.n,
      start: c.startedAt,
      end: now,
      a: c.teams[0].map(id => S.players[id].name),
      b: c.teams[1].map(id => S.players[id].name),
      sa: strength(S, c.teams[0]),
      sb: strength(S, c.teams[1]),
      win,
    });
    S.history.length = Math.min(S.history.length, HISTORY_SIZE);
    c.teams.forEach((team, i) =>
      team.forEach(id => {
        const p = S.players[id],
          won = win && (win === 'a') === (i === 0);
        if (!win) p.nores = (p.nores || 0) + 1;
        else if (won) p.wins = (p.wins || 0) + 1;
        else p.losses = (p.losses || 0) + 1;
      }),
    );
    const who = c.teams
      .flat()
      .map(id => S.players[id].name)
      .join(', ');
    c.teams.flat().forEach(id => {
      const p = S.players[id];
      // Someone marked "กลับบ้าน" mid-game stays gone.
      if (p.status === 'play') p.status = 'wait';
      p.lastEnd = S.t++;
      p.since = now;
    });
    c.teams = null;
    c.phase = 'idle';
    const side = win === 'a' ? 'ซ้ายชนะ' : win === 'b' ? 'ขวาชนะ' : 'ไม่ระบุผล';
    log(S, 'คอร์ต ' + label(S, c) + ' จบ (' + side + '): ' + who, now);
    fill(S, rng);
  }
  function restPlayer(S, c, id, now, rng) {
    if (!c.teams.flat().includes(id)) fail('ผู้เล่นคนนี้ไม่ได้อยู่ในคอร์ตนี้');
    const p = S.players[id],
      keep = c.teams.flat().filter(x => x !== id);
    p.status = 'wait';
    p.skip = 1;
    p.lastEnd = S.t++;
    p.since = now;
    log(S, p.name + ' กดพัก (ไม่นับเกม) คอร์ต ' + label(S, c) + ' กลับเข้าคิว', now);
    const pool = Object.values(S.players).filter(x => x.status === 'wait' && x.id !== id);
    const teams =
      choose(
        S,
        pool.filter(x => !(x.skip > 0)),
        keep,
        {},
        rng,
      ) || choose(S, pool, keep, {}, rng);
    if (teams) setCalled(S, c, teams);
    else {
      keep.forEach(x => {
        S.players[x].status = 'wait';
      });
      c.teams = null;
      c.phase = 'idle';
    }
    fill(S, rng);
  }
  function reroll(S, c, rng) {
    const old = matchKey(c.teams);
    releaseCourt(S, c);
    const opts = { avoid: old, noise: 10 };
    const teams =
      choose(S, eligible(S), [], opts, rng) || choose(S, eligible(S, true), [], opts, rng);
    if (teams) setCalled(S, c, teams);
    fill(S, rng);
  }
  function swapPlayers(S, aId, bId, now) {
    const a = playerAt(S, aId),
      b = playerAt(S, bId);
    if (a.id === b.id) fail('เลือกคนละคนเพื่อสลับ');
    if (!['called', 'wait'].includes(a.status) || !['called', 'wait'].includes(b.status))
      fail('สลับได้เฉพาะคนที่ถูกเรียกหรือรออยู่ในคิว');
    if (a.status === 'wait' && b.status === 'wait') fail('ต้องมีอย่างน้อย 1 คนที่ถูกเรียกในคอร์ต');
    for (const c of S.courts) {
      if (c.phase !== 'called' || !c.teams) continue;
      c.teams = c.teams.map(team => team.map(id => (id === a.id ? b.id : id === b.id ? a.id : id)));
    }
    const statusA = a.status;
    a.status = b.status;
    b.status = statusA;
    if (a.status === 'called') delete a.skip;
    if (b.status === 'called') delete b.skip;
    log(S, 'สลับ ' + a.name + ' ↔ ' + b.name, now);
  }
  function addPlayer(S, player, now, rng) {
    if (Object.hasOwn(S.players, player.id)) {
      const p = S.players[player.id];
      if (p.status !== 'gone') fail(p.name + ' อยู่ในคิวแล้ว');
      p.status = 'wait';
      p.lastEnd = S.t++;
      p.since = now;
      log(S, p.name + ' กลับมาเข้าคิว', now);
    } else {
      const live = Object.values(S.players).filter(p => p.status !== 'gone');
      if (live.length >= MAX_PLAYERS) fail('รองรับสูงสุด ' + MAX_PLAYERS + ' คน');
      // Late arrivals start at the current average so they don't jump the whole queue.
      const avg = live.length ? Math.floor(live.reduce((s, p) => s + p.games, 0) / live.length) : 0;
      S.players[player.id] = {
        id: player.id,
        name: player.name,
        lv: player.lv,
        g: player.g,
        games: avg,
        lastEnd: S.t++,
        status: 'wait',
        since: now,
      };
      log(S, player.name + ' มาเพิ่ม เริ่มนับที่ ' + avg + ' เกม', now);
    }
    fill(S, rng);
  }

  // apply(S, input, { now, rng, player }) — `player` is the resolved roster/guest entry for 'add'.
  function apply(S, input, { now = Date.now(), rng = Math.random, player = null } = {}) {
    switch (input.action) {
      case 'startCourt': {
        const c = courtAt(S, input.court, 'called');
        startCourt(S, c, now);
        return 'คอร์ต ' + label(S, c) + ' เริ่มตี';
      }
      case 'finish': {
        const c = courtAt(S, input.court, 'playing');
        const win = input.win === 'a' || input.win === 'b' ? input.win : null;
        finishCourt(S, c, win, now, rng);
        return 'คอร์ต ' + label(S, c) + ' จบแล้ว เรียกคู่ใหม่ให้';
      }
      case 'rest': {
        const c = courtAt(S, input.court, 'called');
        const p = playerAt(S, input.pid);
        restPlayer(S, c, p.id, now, rng);
        return p.name + ' พัก กลับเข้าคิว เรียกคนอื่นแทนแล้ว';
      }
      case 'reroll': {
        const c = courtAt(S, input.court, 'called');
        reroll(S, c, rng);
        return 'จัดคู่ใหม่ให้คอร์ต ' + label(S, c);
      }
      case 'swap': {
        swapPlayers(S, input.a, input.b, now);
        return 'สลับ ' + S.players[input.a].name + ' ↔ ' + S.players[input.b].name;
      }
      case 'skip': {
        const p = playerAt(S, input.pid);
        if (p.status !== 'wait') fail(p.name + ' ไม่ได้อยู่ในคิวรอ');
        p.skip = 1;
        p.lastEnd = S.t++;
        log(S, p.name + ' ขอข้ามรอบถัดไป (ยังอยู่ในคิว)', now);
        return p.name + ' ข้ามรอบถัดไป ยังอยู่ในคิว';
      }
      case 'leave': {
        const p = playerAt(S, input.pid);
        if (p.status === 'gone') fail(p.name + ' กลับบ้านไปแล้ว');
        if (p.status === 'play') fail(p.name + ' กำลังตีอยู่ จบเกมก่อน');
        if (p.status === 'called') fail(p.name + ' ถูกเรียกอยู่ กด "พัก" ในคอร์ตก่อน');
        p.status = 'gone';
        log(S, p.name + ' กลับบ้านแล้ว', now);
        fill(S, rng);
        return p.name + ' กลับบ้าน';
      }
      case 'add': {
        if (!player) fail('ไม่พบผู้เล่น');
        addPlayer(S, player, now, rng);
        return player.name + ' เข้าคิวแล้ว';
      }
      case 'addCourt': {
        if (S.courts.length >= MAX_COURTS) fail('รองรับสูงสุด ' + MAX_COURTS + ' คอร์ต');
        S.courts.push({ n: S.courts.length + 1, phase: 'idle', teams: null, startedAt: 0 });
        log(S, 'เพิ่มเป็น ' + S.courts.length + ' คอร์ต', now);
        fill(S, rng);
        return 'เพิ่มเป็น ' + S.courts.length + ' คอร์ต';
      }
      case 'removeCourt': {
        if (S.courts.length <= 1) fail('ต้องมีอย่างน้อย 1 คอร์ต');
        const c = S.courts[S.courts.length - 1];
        if (c.phase === 'playing')
          fail('คอร์ต ' + label(S, c) + ' กำลังตีอยู่ จบเกมก่อนแล้วค่อยลดคอร์ต');
        releaseCourt(S, c);
        S.courts.pop();
        log(S, 'ลดเหลือ ' + S.courts.length + ' คอร์ต', now);
        fill(S, rng);
        return 'ลดเหลือ ' + S.courts.length + ' คอร์ต';
      }
      default:
        fail('ไม่พบคำสั่ง');
    }
  }

  // What non-organizers see: no Lv (same rule as guestState in worker.js).
  function publicView(S) {
    if (!S) return null;
    const players = {};
    for (const [id, p] of Object.entries(S.players)) {
      const { lv, ...rest } = p;
      players[id] = rest;
    }
    return {
      ...S,
      players,
      partner: undefined,
      fours: undefined,
      history: S.history.map(({ sa, sb, ...rest }) => rest),
    };
  }

  root.SenaQueue = {
    MAX_COURTS,
    MAX_PLAYERS,
    QueueError,
    create,
    apply,
    choose,
    fill,
    validMatch,
    strength,
    byOrder,
    key,
    publicView,
    label,
  };
  if (typeof module !== 'undefined') module.exports = root.SenaQueue;
})(typeof window === 'undefined' ? globalThis : window);
