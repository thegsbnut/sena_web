import { clubOf, DEFAULT_CLUB } from './clubs.js';
import { baseline } from './leaderboard-data.js';
import './public/engine.js';
// Built-in spelling aliases (clubs.js) only fold legacy names together: who a player
// IS comes from their roster id, so renaming someone keeps their Cup history.
const canonicalName = (name, club = DEFAULT_CLUB) => {
  const lower = name.trim().toLowerCase(),
    builtin = clubOf(club).nameAliases;
  return (Object.hasOwn(builtin, lower) && builtin[lower]) || name.trim();
};

// ---- player identity ----
// A Cup slot belongs to a roster player id: saved in the cup (`teamIds`) since Nov 2026;
// older cups and the starting table go through `cup_name_ids`, a name→id map frozen once
// per club from the roster of that day; anything else falls back to today's roster names.
export function identityFrom(players, club = DEFAULT_CLUB, legacy = new Map()) {
  const byName = new Map(),
    nameOf = new Map(),
    spelled = new Map();
  for (const p of players || []) {
    nameOf.set(p.id, p.name);
    const keys = new Set(
      [p.name, p.thai].filter(n => typeof n === 'string' && n.trim()).map(n => key(n, club)),
    );
    // Two players answering to one name: neither gets it.
    for (const n of [p.name, p.thai])
      if (typeof n === 'string' && n.trim()) spelled.set(key(n, club), n.trim());
    for (const k of keys) byName.set(k, byName.has(k) && byName.get(k) !== p.id ? null : p.id);
  }
  return { club, byName, nameOf, spelled, legacy };
}
const nameId = (ident, name) => {
  const k = key(name, ident.club);
  return ident.legacy.get(k) || ident.byName.get(k) || null;
};
const slotId = (ident, cup, t, k) => cup.teamIds?.[t]?.[k] || nameId(ident, cup.teams[t][k]);
export const slotKey = (ident, cup, t, k) => {
  const id = slotId(ident, cup, t, k);
  return id ? 'id:' + id : 'n:' + key(cup.teams[t][k], ident.club);
};
const shownName = (ident, id, name) =>
  (id && ident.nameOf.get(id)) || canonicalName(name, ident.club);
// The cup as people should read it: today's roster names, no internal ids.
export function displayCup(cup, ident) {
  const { teamIds: _ids, ...rest } = cup;
  return {
    ...rest,
    teams: cup.teams.map((team, t) =>
      team.map((name, k) => shownName(ident, slotId(ident, cup, t, k), name)),
    ),
  };
}
// 🥇 / 💩 of one cup, keyed by slotKey (so 'id:<player id>' for roster players).
export function cupMedals(cup, ident) {
  const byName = globalThis.Sena.cupAwards(cup),
    medals = new Map();
  cup?.teams?.forEach((team, t) =>
    team.forEach((name, k) => {
      const medal = byName.get(name.trim().toLowerCase());
      if (medal) medals.set(slotKey(ident, cup, t, k), medal);
    }),
  );
  return medals;
}
async function rosterOf(db, club) {
  try {
    const row = await db
      .prepare(`SELECT payload FROM ${clubOf(club).stateTable} WHERE id=1`)
      .first();
    return row ? JSON.parse(row.payload).players : [];
  } catch {
    return []; // a club whose roster table does not exist yet
  }
}
// The frozen name→id map. The first call per club builds it from the roster of the day
// (marker row name_key=''), so renaming a player later cannot cut them off their history.
export async function legacyNames(db, club) {
  await db
    .prepare(
      'CREATE TABLE IF NOT EXISTS cup_name_ids (club TEXT NOT NULL, name_key TEXT NOT NULL, player_id TEXT NOT NULL, PRIMARY KEY (club, name_key))',
    )
    .run();
  const read = async () =>
    (await db.prepare('SELECT name_key,player_id FROM cup_name_ids WHERE club=?').bind(club).all())
      .results;
  let rows = await read();
  if (!rows.some(r => r.name_key === '')) {
    const players = await rosterOf(db, club);
    // Without a roster there is nothing to freeze yet; try again on a later request.
    if (!players.length) return new Map();
    const ident = identityFrom(players, club),
      table = await cupHistoryTable(db, club),
      names = new Set(clubOf(club).hasBaseline ? baseline.map(p => key(p.name, club)) : []);
    for (const row of (await db.prepare(`SELECT payload FROM ${table}`).all()).results) {
      const cup = JSON.parse(row.payload);
      if (!cup.teamIds) for (const name of cup.teams.flat()) names.add(key(name, club));
    }
    const pairs = [...names].map(k => [k, ident.byName.get(k)]).filter(([, id]) => id);
    pairs.push(['', '']);
    // 30 rows × 3 values stays under D1's 100 bound-parameter limit.
    for (let i = 0; i < pairs.length; i += 30) {
      const chunk = pairs.slice(i, i + 30);
      await db
        .prepare(
          'INSERT OR IGNORE INTO cup_name_ids (club,name_key,player_id) VALUES ' +
            chunk.map(() => '(?,?,?)').join(','),
        )
        .bind(...chunk.flatMap(([k, id]) => [club, k, id]))
        .run();
    }
    rows = await read();
  }
  return new Map(rows.filter(r => r.name_key).map(r => [r.name_key, r.player_id]));
}
export async function loadIdentity(db, club) {
  const [players, legacy] = await Promise.all([rosterOf(db, club), legacyNames(db, club)]);
  return identityFrom(players, club, legacy);
}
// Ids for a cup about to be saved: names already tied to an id in the previous version
// of this record keep it (also under the player's current name), then the frozen
// legacy names, then today's roster.
function assignIds(cup, ident, previous) {
  const carried = new Map();
  previous?.teams.forEach((team, t) =>
    team.forEach((name, k) => {
      const id = slotId(ident, previous, t, k);
      if (!id) return;
      carried.set(key(name, ident.club), id);
      if (ident.nameOf.has(id)) carried.set(key(ident.nameOf.get(id), ident.club), id);
    }),
  );
  return cup.teams.map(team =>
    team.map(name => {
      const k = key(name, ident.club);
      return carried.get(k) || nameId(ident, name);
    }),
  );
}

// Names in a cup that match no roster player, no earlier cup and no starting-table name
// (the organizer must confirm these), each with the closest known names as suggestions.
const editDistance = (a, b) => {
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++)
      next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    row = next;
  }
  return row[b.length];
};
const close = (a, b) => {
  if (a === b) return false;
  const d = editDistance(a, b);
  return (
    d <= 2 ||
    (Math.min(a.length, b.length) >= 2 && (a.includes(b) || b.includes(a))) ||
    (a[0] === b[0] && d <= 3)
  );
};
export function unknownNames(cup, history, ident) {
  const club = ident.club,
    known = new Map(),
    add = name => {
      if (typeof name === 'string' && name.trim())
        known.set(key(name, club), canonicalName(name, club));
    };
  for (const name of ident.spelled.values()) add(name);
  if (clubOf(club).hasBaseline) for (const p of baseline) add(p.name);
  for (const c of history) {
    for (const team of c.teams) for (const name of team) add(name);
    for (const team of displayCup(c, ident).teams) for (const name of team) add(name);
  }
  const unknown = [];
  for (const name of cup.teams.flat()) {
    const k = key(name, club);
    if (known.has(k) || unknown.some(u => u.name === name)) continue;
    const suggestions = [
      ...new Set(
        [...known]
          .filter(([other]) => close(k, other))
          .sort((a, b) => editDistance(k, a[0]) - editDistance(k, b[0]))
          .map(([, display]) => display),
      ),
    ].slice(0, 3);
    unknown.push({ name, suggestions });
  }
  return unknown;
}
const key = (name, club = DEFAULT_CLUB) => canonicalName(name, club).toLowerCase();
export { key as cupPlayerKey };
export async function cupHistoryTable(db, club) {
  const table = clubOf(club).cupTable;
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS ${table} (id TEXT PRIMARY KEY, revision INTEGER NOT NULL, sequence INTEGER NOT NULL, payload TEXT NOT NULL)`,
    )
    .run();
  return table;
}
export async function latestCup(db, club) {
  const table = await cupHistoryTable(db, club);
  const row = await db
    .prepare(
      `SELECT payload FROM ${table} ORDER BY json_extract(payload,'$.date') DESC, sequence DESC LIMIT 1`,
    )
    .first();
  return row ? displayCup(JSON.parse(row.payload), await loadIdentity(db, club)) : null;
}
export function cleanCup(value, club = DEFAULT_CLUB) {
  if (
    !value ||
    typeof value.title !== 'string' ||
    !value.title.trim() ||
    value.title.length > 100 ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value.date) ||
    Number.isNaN(Date.parse(value.date + 'T00:00:00Z')) ||
    new Date(value.date + 'T00:00:00Z').toISOString().slice(0, 10) !== value.date ||
    typeof value.inBaseline !== 'boolean'
  )
    throw Error('กรอกชื่อรายการ วันที่ และสถานะยอดตั้งต้นให้ครบ');
  const teams = value.teams;
  if (
    !Array.isArray(teams) ||
    teams.length < 2 ||
    teams.length > 20 ||
    !teams.every(
      team =>
        Array.isArray(team) &&
        team.length === 2 &&
        team.every(name => typeof name === 'string' && name.trim() && name.length <= 100),
    )
  )
    throw Error('ต้องมี 2–20 ทีม ทีมละ 2 คน');
  const names = teams.flat().map(name => key(name, club));
  if (new Set(names).size !== names.length) throw Error('ผู้เล่นต้องอยู่ทีมเดียวต่อรายการ');
  const matches = value.matches;
  if (!Array.isArray(matches) || matches.length !== (teams.length * (teams.length - 1)) / 2)
    throw Error('ต้องกรอกผลพบกันหมดให้ครบทุกคู่');
  const pairs = new Set();
  for (const m of matches) {
    if (
      !m ||
      !Number.isInteger(m.a) ||
      !Number.isInteger(m.b) ||
      m.a < 0 ||
      m.b < 0 ||
      m.a >= teams.length ||
      m.b >= teams.length ||
      m.a === m.b ||
      !['sa', 'sb'].every(k => Number.isInteger(m[k]) && m[k] >= 0 && m[k] <= 999) ||
      m.sa === m.sb
    )
      throw Error('คะแนนต้องครบ เป็นจำนวนเต็ม 0–999 และไม่เสมอ');
    pairs.add([m.a, m.b].sort((a, b) => a - b).join(','));
  }
  if (pairs.size !== matches.length) throw Error('คู่แข่งขันซ้ำ');
  // Player ids travel with a restored backup; a normal save recomputes them (assignIds).
  const ids = value.teamIds;
  const validIds =
    Array.isArray(ids) &&
    ids.length === teams.length &&
    ids.every(
      t =>
        Array.isArray(t) &&
        t.length === 2 &&
        t.every(id => id === null || (typeof id === 'string' && id && id.length <= 100)),
    );
  return {
    title: value.title.trim(),
    date: value.date,
    inBaseline: value.inBaseline,
    teams: teams.map(t => t.map(name => canonicalName(name, club))),
    ...(validIds ? { teamIds: ids.map(t => [...t]) } : {}),
    matches: matches.map(({ a, b, sa, sb }) => ({ a, b, sa, sb })),
  };
}
function addCup(totals, cup, ident) {
  const rows = globalThis.Sena.standings(cup.teams, cup.matches);
  const equal = (a, b) => a.w === b.w && a.pf - a.pa === b.pf - b.pa && a.pf === b.pf;
  for (const row of rows)
    cup.teams[row.i].forEach((name, k) => {
      const id = slotKey(ident, cup, row.i, k),
        p = totals.get(id) || {
          name: shownName(ident, slotId(ident, cup, row.i, k), name),
          played: 0,
          w: 0,
          l: 0,
          pf: 0,
          pa: 0,
          crown: 0,
          poo: 0,
        };
      p.played += row.played;
      p.w += row.w;
      p.l += row.played - row.w;
      p.pf += row.pf;
      p.pa += row.pa;
      if (equal(row, rows[0])) p.crown++;
      else if (equal(row, rows[rows.length - 1])) p.poo++;
      totals.set(id, p);
    });
}
// Starting-table rows keyed like cup slots, shown under today's roster name.
const startingRows = ident =>
  (clubOf(ident.club).hasBaseline ? baseline : []).map(p => {
    const id = nameId(ident, p.name);
    return [
      id ? 'id:' + id : 'n:' + key(p.name, ident.club),
      { ...p, name: shownName(ident, id, p.name) },
    ];
  });
function ordered(cups, ident) {
  const totals = new Map(startingRows(ident));
  for (const cup of cups) addCup(totals, cup, ident);
  return [...totals].sort(
    ([, a], [, b]) =>
      b.w - a.w || b.pf - b.pa - (a.pf - a.pa) || b.pf - a.pf || a.name.localeCompare(b.name),
  );
}
// `history` holds the cups as stored (names + teamIds). Without an identity (tests, old
// callers) players are matched by name only, as before ids existed.
export function standings(history, club = DEFAULT_CLUB, ident = identityFrom([], club)) {
  const counted = history.filter(c => !c.inBaseline).sort((a, b) => a.sequence - b.sequence);
  if (!counted.length)
    return startingRows(ident).map(([, p]) => ({
      ...p,
      diff: p.pf - p.pa,
      winPercent: (p.w / p.played) * 100,
    }));
  const ranks = new Map(ordered(counted.slice(0, -1), ident).map(([id], i) => [id, i + 1]));
  return ordered(counted, ident).map(([id, p], i) => ({
    ...p,
    position: i + 1,
    diff: p.pf - p.pa,
    winPercent: p.played ? (p.w / p.played) * 100 : 0,
    change: ranks.has(id) ? ranks.get(id) - (i + 1) : 'NEW',
  }));
}
export async function leaderboardRoute(req, env, isAdmin, club = DEFAULT_CLUB) {
  const reply = (value, status = 200) =>
    Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
  if (req.method !== 'GET' && !isAdmin) return reply({ error: 'กรุณาเข้าสู่ระบบผู้จัด' }, 401);
  if (!env.DB) return reply({ error: 'ยังไม่ได้ตั้งค่าฐานข้อมูล' }, 503);
  const table = await cupHistoryTable(env.DB, club);
  const ident = await loadIdentity(env.DB, club);
  if (req.method === 'POST') {
    let input;
    try {
      const text = await req.text();
      if (text.length > 100000) throw Error('ข้อมูลใหญ่เกินไป');
      input = JSON.parse(text);
      input.cup = cleanCup(input.cup, club);
      if (!clubOf(club).hasBaseline && input.cup.inBaseline)
        throw Error('ก๊วน 88 ยังไม่มียอดสะสมตั้งต้น กรุณานับรายการนี้เป็นผลใหม่');
      if (
        typeof input.id !== 'string' ||
        !/^[a-zA-Z0-9_-]{1,100}$/.test(input.id) ||
        !Number.isInteger(input.revision) ||
        input.revision < 0
      )
        throw Error('ข้อมูลรายการไม่ถูกต้อง');
    } catch (error) {
      return reply({ error: error.message }, 400);
    }
    // The organizer's screen asks for this check: unknown spellings are the usual cause of
    // one player showing up twice (Bo/Beau). Unconfirmed names come back as a 409.
    if (input.checkNames === true && input.acceptUnknown !== true) {
      const rows = await env.DB.prepare(`SELECT payload FROM ${table}`).all();
      const unknown = unknownNames(
        input.cup,
        rows.results.map(r => JSON.parse(r.payload)),
        ident,
      );
      if (unknown.length)
        return reply(
          {
            error: 'พบชื่อที่ไม่ตรงกับรายชื่อ: ' + unknown.map(u => u.name).join(', '),
            code: 'UNKNOWN_NAMES',
            unknown,
          },
          409,
        );
    }
    const previous =
      input.revision > 0
        ? await env.DB.prepare(`SELECT payload FROM ${table} WHERE id=?`).bind(input.id).first()
        : null;
    input.cup.teamIds = assignIds(input.cup, ident, previous && JSON.parse(previous.payload));
    const ids = input.cup.teamIds.flat().filter(Boolean);
    if (new Set(ids).size !== ids.length)
      return reply(
        { error: 'มีผู้เล่นคนเดียวกันอยู่สองช่อง (ชื่อเล่น/ชื่อไทยของคนเดียวกัน)' },
        400,
      );
    const payload = JSON.stringify(input.cup);
    const result =
      input.revision === 0
        ? await env.DB.prepare(
            `INSERT OR IGNORE INTO ${table} (id,revision,sequence,payload) VALUES (?,1,(SELECT COALESCE(MAX(sequence),0)+1 FROM ${table}),?) RETURNING revision`,
          )
            .bind(input.id, payload)
            .first()
        : await env.DB.prepare(
            `UPDATE ${table} SET payload=?,revision=revision+1 WHERE id=? AND revision=? RETURNING revision`,
          )
            .bind(payload, input.id, input.revision)
            .first();
    // RETURNING row = this write happened (D1's meta.changes also counts the backup trigger).
    if (!result)
      return reply(
        { error: 'รายการนี้บันทึกแล้วหรือมีการแก้จากอีกเครื่อง กรุณาโหลดประวัติใหม่ก่อน' },
        409,
      );
    return reply({ ok: true, revision: input.revision + 1 });
  }
  if (req.method !== 'GET') return reply({ error: 'Method not allowed' }, 405);
  const result = await env.DB.prepare(
    `SELECT id,revision,sequence,payload FROM ${table} ORDER BY sequence`,
  ).all();
  const stored = result.results.map(row => ({
    ...JSON.parse(row.payload),
    id: row.id,
    revision: row.revision,
    sequence: row.sequence,
  }));
  return reply({
    history: stored.map(cup => displayCup(cup, ident)),
    standings: standings(stored, club, ident),
    canEdit: isAdmin,
  });
}
