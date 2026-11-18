(function (root) {
  function valid(a, b) {
    const f = t => t.filter(p => p.gender === 'F').length;
    return !((f(a) === 2 && f(b) === 1) || (f(b) === 2 && f(a) === 1));
  }
  // Weights: equal games per player first, then level balance, then spreading who plays
  // with/against whom. STEP = greedy per-game penalty, SCORE = whole-schedule penalty.
  const COUNT_STEP = 300,
    PARTNER_STEP = 20,
    MEET_STEP = 5,
    COUNT_SCORE = 1000,
    DIFF_SCORE = 5,
    PARTNER_SCORE = 20,
    MEET_SCORE = 5,
    // Stepping on court and seeing nobody new (all three already met today) is what feels repetitive.
    STALE_STEP = 150,
    STALE_SCORE = 150,
    // Cap the polish work so a big roster stays cheap inside the Worker.
    POLISH_BUDGET = 2500;
  const pairings = ([a, b, c, d]) => [
    [a, b, c, d],
    [a, c, b, d],
    [a, d, b, c],
  ];
  function generate(
    players,
    rounds = 10,
    locks = [],
    trials = 90,
    candidateLimit = 0,
    { matchAllowed = valid, randomWeight = 22, acceptSchedule } = {},
  ) {
    const allowed = q => matchAllowed(q.slice(0, 2), q.slice(2));
    const sampleAbove = matchAllowed !== valid && players.length > 8 ? 7 : 8;
    if (players.length > 24) throw Error('รองรับผู้เล่นที่เลือกสูงสุด 24 คนต่อครั้ง');
    if (players.length < 8) throw Error('ต้องมีอย่างน้อย 8 คน เพื่อให้ทุกคนพักในรอบถัดไป');
    const ids = new Set(players.map(p => p.id));
    const lm = {};
    for (const l of locks) {
      if (l.round < 1 || l.round > rounds || lm[l.round]) throw Error('รอบล็อกซ้ำหรืออยู่นอกตาราง');
      if (new Set(l.ids).size !== 4 || l.ids.some(id => !ids.has(id)))
        throw Error('คู่พิเศษต้องเป็นผู้เล่นที่เลือก 4 คนไม่ซ้ำ');
      const ps = l.ids.map(id => players.find(p => p.id === id));
      if (!allowed(ps)) throw Error('คู่พิเศษขัดกติกา: ห้าม ญญ พบ ชญ');
      lm[l.round] = ps;
    }
    for (let r = 2; r <= rounds; r++)
      if (lm[r] && lm[r - 1] && lm[r].some(p => lm[r - 1].includes(p)))
        throw Error('คู่พิเศษทำให้ผู้เล่นลงติดกัน');
    const n = players.length,
      fair = (rounds * 4) / n,
      at = new Map(players.map((p, i) => [p, i]));
    const key = (a, b) => {
      const i = at.get(a),
        j = at.get(b);
      return i < j ? i * n + j : j * n + i;
    };
    const meetings = q => [
      key(q[0], q[1]),
      key(q[0], q[2]),
      key(q[0], q[3]),
      key(q[1], q[2]),
      key(q[1], q[3]),
      key(q[2], q[3]),
    ];
    // Players in game q who have already met all three others (met = pair tallies so far).
    const staleIn = (q, met) =>
      q.filter((p, i) => q.every((o, j) => i === j || met[key(p, o)] > 0)).length;
    const seen = new Uint8Array(n * n);
    // How many times, over the whole schedule in order, someone steps on court with no new face.
    function staleCount(games) {
      seen.fill(0);
      let stale = 0;
      for (const q of games) {
        stale += staleIn(q, seen);
        for (const k of meetings(q)) seen[k] = 1;
      }
      return stale;
    }
    const diffOf = q => Math.abs(q[0].lv + q[1].lv - q[2].lv - q[3].lv);
    // Running tallies for one schedule; add(q, ±1) updates them and returns the score change,
    // so the polish step can try thousands of swaps cheaply.
    function tally() {
      const counts = new Int16Array(n),
        pairs = new Int16Array(n * n),
        met = new Int16Array(n * n);
      const bump = (map, k, sign, weight) => {
        const old = map[k];
        map[k] = old + sign;
        return ((old + sign) ** 2 - old ** 2) * weight;
      };
      return {
        counts,
        pairs,
        met,
        score: n * fair * fair * COUNT_SCORE,
        add(q, sign) {
          let d = diffOf(q) ** 2 * DIFF_SCORE * sign;
          for (const p of q) {
            const i = at.get(p),
              old = counts[i];
            counts[i] = old + sign;
            d += ((old + sign - fair) ** 2 - (old - fair) ** 2) * COUNT_SCORE;
          }
          d += bump(pairs, key(q[0], q[1]), sign, PARTNER_SCORE);
          d += bump(pairs, key(q[2], q[3]), sign, PARTNER_SCORE);
          for (const k of meetings(q)) d += bump(met, k, sign, MEET_SCORE);
          this.score += d;
          return d;
        },
      };
    }
    // Greedy round-by-round picking can't see that today's leftovers decide who meets later,
    // so afterwards try swapping a resting player in, or re-pairing a game, and keep any change
    // that lowers the whole-schedule score (fewer repeat partners/opponents, same fairness).
    function polish(games, t) {
      let stale = staleCount(games);
      const rests = (r, p) => !games[r - 1]?.includes(p) && !games[r + 1]?.includes(p);
      // Try a list of edits ([[round, newGame], ...]); keep it if every game stays legal and the score drops.
      let budget = POLISH_BUDGET;
      const attempt = edits => {
        if (--budget < 0 || !edits.every(([, o]) => allowed(o))) return false;
        const olds = edits.map(([r]) => games[r]);
        let d = 0;
        edits.forEach(([r, o], i) => {
          d += t.add(olds[i], -1) + t.add(o, 1);
          games[r] = o;
        });
        const restOk = edits.every(([r, o]) => o.every(p => rests(r, p)));
        const nextStale = restOk ? staleCount(games) : stale;
        d += (nextStale - stale) * STALE_SCORE;
        if (restOk && d < -1e-9) {
          stale = nextStale;
          return true;
        }
        edits.forEach(([r, o], i) => {
          t.add(o, -1);
          t.add(olds[i], 1);
          games[r] = olds[i];
        });
        return false;
      };
      const swap = (q, from, to) => q.map(p => (p === from ? to : p));
      for (let pass = 0, improved = true; improved && budget > 0; pass++) {
        improved = false;
        for (let r = 0; r < games.length; r++) {
          if (lm[r + 1]) continue;
          if (
            pairings(games[r])
              .slice(1)
              .some(o => attempt([[r, o]]))
          ) {
            improved = true;
            continue;
          }
          // x leaves game r for resting y, and y gives x their seat in another game r2,
          // so nobody's number of games changes.
          search: for (const x of games[r])
            for (const y of players) {
              if (games[r].includes(y)) continue;
              for (let r2 = 0; r2 < games.length; r2++) {
                if (r2 === r || lm[r2 + 1] || !games[r2].includes(y) || games[r2].includes(x))
                  continue;
                if (
                  attempt([
                    [r, swap(games[r], x, y)],
                    [r2, swap(games[r2], y, x)],
                  ])
                ) {
                  improved = true;
                  break search;
                }
              }
            }
        }
      }
    }
    const toSchedule = games =>
      games.map((q, i) => ({
        round: i + 1,
        ids: q.map(p => p.id),
        diff: diffOf(q),
        locked: !!lm[i + 1],
      }));
    const drafts = [];
    for (let trial = 0; trial < trials; trial++) {
      const t = tally(),
        { counts, pairs, met } = t,
        games = [];
      let prev = [],
        failed = false;
      for (let r = 1; r <= rounds; r++) {
        let candidates = [];
        const next = lm[r + 1] || [];
        if (lm[r]) {
          if (lm[r].some(p => prev.includes(p))) {
            failed = true;
            break;
          }
          candidates = [lm[r]];
        } else {
          const avail = players.filter(p => !prev.includes(p) && !next.includes(p));
          if (candidateLimit && avail.length > sampleAbove) {
            for (let sample = 0; sample < candidateLimit; sample++) {
              const pool = avail.slice(),
                q = [];
              for (let pick = 0; pick < 4; pick++)
                q.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
              candidates.push(q);
            }
          } else
            for (let a = 0; a < avail.length - 3; a++)
              for (let b = a + 1; b < avail.length - 2; b++)
                for (let c = b + 1; c < avail.length - 1; c++)
                  for (let d = c + 1; d < avail.length; d++) {
                    candidates.push(...pairings([avail[a], avail[b], avail[c], avail[d]]));
                  }
        }
        // With exactly eight players, the first game's resting four must also form a legal match.
        if (matchAllowed !== valid && players.length === 8 && r === 1 && rounds > 1) {
          candidates = candidates.filter(q =>
            pairings(players.filter(p => !q.includes(p))).some(allowed),
          );
        }
        let chosen = null,
          min = Infinity;
        for (const q of candidates) {
          if (!allowed(q)) continue;
          let s =
            q.reduce((s, p) => s + counts[at.get(p)] * COUNT_STEP, 0) +
            diffOf(q) * 4 +
            pairs[key(q[0], q[1])] * PARTNER_STEP +
            pairs[key(q[2], q[3])] * PARTNER_STEP +
            meetings(q).reduce((s, k) => s + met[k] * MEET_STEP, 0) +
            staleIn(q, met) * STALE_STEP +
            Math.random() * randomWeight;
          if (s < min) {
            min = s;
            chosen = q;
          }
        }
        if (!chosen) {
          failed = true;
          break;
        }
        prev = chosen;
        t.add(chosen, 1);
        games.push(chosen);
      }
      if (failed || (acceptSchedule && !acceptSchedule(toSchedule(games)))) continue;
      drafts.push({ games, t, score: t.score + staleCount(games) * STALE_SCORE });
    }
    if (!drafts.length) throw Error('ยังจัดตารางตามเงื่อนไขนี้ไม่ได้ ลองเพิ่มผู้เล่นหรือลดคู่ล็อก');
    const draft = drafts.reduce((a, b) => (b.score < a.score ? b : a));
    const polished = draft.games.slice();
    polish(polished, draft.t);
    let schedule = toSchedule(polished);
    if (acceptSchedule && !acceptSchedule(schedule)) schedule = toSchedule(draft.games);
    const best = { schedule, counts: Object.fromEntries(players.map(p => [p.id, 0])) };
    for (const g of schedule) for (const id of g.ids) best.counts[id]++;
    return best;
  }
  function cupRestConflicts(matches) {
    return matches.slice(1).reduce((total, match, index) => {
      const previous = matches[index];
      return (
        total +
        Number(match.a === previous.a || match.a === previous.b) +
        Number(match.b === previous.a || match.b === previous.b)
      );
    }, 0);
  }
  function roundRobin(teams) {
    const matches = [];
    for (let a = 0; a < teams.length; a++)
      for (let b = a + 1; b < teams.length; b++) matches.push({ a, b, sa: '', sb: '' });
    let best = matches,
      bestCost = cupRestConflicts(matches);
    for (let trial = 0; trial < 100 && bestCost > 0; trial++) {
      const remaining = matches.slice(),
        ordered = [],
        lastPlayed = Array(teams.length).fill(-1);
      while (remaining.length) {
        const previous = ordered[ordered.length - 1];
        let bestIndex = 0,
          bestScore = Infinity;
        for (let index = 0; index < remaining.length; index++) {
          const match = remaining[index];
          const overlap = previous
            ? Number(match.a === previous.a || match.a === previous.b) +
              Number(match.b === previous.a || match.b === previous.b)
            : 0;
          const score =
            overlap * 10000 +
            Math.max(lastPlayed[match.a], lastPlayed[match.b]) * 2 +
            Math.random() * 10;
          if (score < bestScore) {
            bestScore = score;
            bestIndex = index;
          }
        }
        const match = remaining.splice(bestIndex, 1)[0];
        lastPlayed[match.a] = lastPlayed[match.b] = ordered.length;
        ordered.push(match);
      }
      const cost = cupRestConflicts(ordered);
      if (cost < bestCost) {
        best = ordered;
        bestCost = cost;
      }
    }
    return best;
  }
  function standings(teams, matches) {
    let rows = teams.map((t, i) => ({ i, name: t.join(' / '), played: 0, w: 0, pf: 0, pa: 0 }));
    matches.forEach(m => {
      if (m.sa === '' || m.sb === '') return;
      let a = +m.sa,
        b = +m.sb;
      if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < 0 || a === b) return;
      rows[m.a].played++;
      rows[m.b].played++;
      rows[m.a].pf += a;
      rows[m.a].pa += b;
      rows[m.b].pf += b;
      rows[m.b].pa += a;
      rows[a > b ? m.a : m.b].w++;
    });
    return rows.sort((a, b) => b.w - a.w || b.pf - b.pa - (a.pf - a.pa) || b.pf - a.pf);
  }
  function cupAwards(cup) {
    const medals = new Map();
    if (
      !cup ||
      cup.teams.length < 2 ||
      !cup.matches.length ||
      !cup.matches.every(
        m =>
          Number.isInteger(m.sa) &&
          Number.isInteger(m.sb) &&
          m.sa >= 0 &&
          m.sb >= 0 &&
          m.sa !== m.sb,
      )
    )
      return medals;
    const rows = standings(cup.teams, cup.matches);
    const equal = (a, b) => a.w === b.w && a.pf - a.pa === b.pf - b.pa && a.pf === b.pf;
    for (const row of rows) {
      const badge = equal(row, rows[0]) ? '🥇' : equal(row, rows[rows.length - 1]) ? '💩' : '';
      if (badge) for (const name of cup.teams[row.i]) medals.set(name.trim().toLowerCase(), badge);
    }
    return medals;
  }
  root.Sena = { generate, valid, roundRobin, standings, cupAwards, cupRestConflicts };
  if (typeof module !== 'undefined') module.exports = root.Sena;
})(typeof window === 'undefined' ? globalThis : window);
