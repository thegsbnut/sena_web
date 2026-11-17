import { clubOf, DEFAULT_CLUB } from './clubs.js';
import { baseline } from './leaderboard-data.js';
import './public/engine.js';
// Name aliases: the built-in ones live in clubs.js; the organizer adds more in the app
// (table player_aliases). The database ones are loaded per request into this per-club map
// so the many synchronous callers of cupPlayerKey/canonicalName stay unchanged.
const dbAliases = new Map();
const aliasKey = name => name.trim().toLowerCase();
const canonicalName = (name, club = DEFAULT_CLUB) => {
  const lower = aliasKey(name),
    stored = dbAliases.get(club),
    builtin = clubOf(club).nameAliases;
  if (stored?.has(lower)) return stored.get(lower);
  return (Object.hasOwn(builtin, lower) && builtin[lower]) || name.trim();
};
export async function loadAliases(db, club) {
  await db
    .prepare(
      'CREATE TABLE IF NOT EXISTS player_aliases (club TEXT NOT NULL, alias TEXT NOT NULL, canonical TEXT NOT NULL, PRIMARY KEY (club, alias))',
    )
    .run();
  const rows = await db
    .prepare('SELECT alias,canonical FROM player_aliases WHERE club=?')
    .bind(club)
    .all();
  dbAliases.set(club, new Map(rows.results.map(r => [r.alias, r.canonical])));
}
const MAX_ALIASES = 200;
export function listAliases(club) {
  const builtin = Object.entries(clubOf(club).nameAliases).map(([alias, canonical]) => ({
    alias,
    canonical,
    builtin: true,
  }));
  const stored = [...(dbAliases.get(club) ?? [])].map(([alias, canonical]) => ({
    alias,
    canonical,
    builtin: false,
  }));
  return [...builtin, ...stored];
}
// Returns an error message, or null after changing the table. `alias` always points
// at a main name (never at another alias), so one lookup is enough.
export async function changeAlias(db, club, action, input) {
  const clean = v => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '');
  const alias = clean(input.alias),
    lower = aliasKey(alias);
  if (!alias || alias.length > 100) return 'กรอกชื่อที่ต้องการรวม 1–100 ตัวอักษร';
  if (action === 'unalias') {
    if (Object.hasOwn(clubOf(club).nameAliases, lower))
      return 'ชื่อนี้เป็นค่าตั้งต้นของระบบ ลบจากหน้าเว็บไม่ได้';
    await db.prepare('DELETE FROM player_aliases WHERE club=? AND alias=?').bind(club, lower).run();
    return null;
  }
  const typed = clean(input.canonical);
  if (!typed || typed.length > 100) return 'กรอกชื่อหลัก 1–100 ตัวอักษร';
  const canonical = canonicalName(typed, club);
  if (aliasKey(canonical) === lower) return 'สองชื่อนี้เป็นชื่อเดียวกันอยู่แล้ว';
  if (listAliases(club).some(a => aliasKey(a.canonical) === lower))
    return `“${alias}” เป็นชื่อหลักของชื่ออื่นอยู่ ลบชื่อที่ชี้มาที่มันก่อน`;
  if (!dbAliases.get(club)?.has(lower) && listAliases(club).length >= MAX_ALIASES)
    return 'มีรายการรวมชื่อมากเกินไป';
  await db
    .prepare(
      'INSERT INTO player_aliases (club,alias,canonical) VALUES (?,?,?) ON CONFLICT(club,alias) DO UPDATE SET canonical=excluded.canonical',
    )
    .bind(club, lower, canonical)
    .run();
  return null;
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
export async function unknownNames(db, club, cup, history) {
  const known = new Map(),
    add = name => {
      if (typeof name === 'string' && name.trim())
        known.set(key(name, club), canonicalName(name, club));
    };
  try {
    const row = await db
      .prepare(`SELECT payload FROM ${clubOf(club).stateTable} WHERE id=1`)
      .first();
    for (const p of row ? JSON.parse(row.payload).players : []) {
      add(p.name);
      add(p.thai);
    }
  } catch {
    // A club without a roster table yet simply has no roster names.
  }
  if (clubOf(club).hasBaseline) for (const p of baseline) add(p.name);
  for (const c of history) for (const team of c.teams) for (const name of team) add(name);
  const unknown = [];
  for (const name of cup.teams.flat()) {
    const k = key(name, club);
    if (known.has(k) || unknown.some(u => u.name === name)) continue;
    const suggestions = [...known]
      .filter(([other]) => close(k, other))
      .sort((a, b) => editDistance(k, a[0]) - editDistance(k, b[0]))
      .slice(0, 3)
      .map(([, display]) => display);
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
  return row ? JSON.parse(row.payload) : null;
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
  return {
    title: value.title.trim(),
    date: value.date,
    inBaseline: value.inBaseline,
    teams: teams.map(t => t.map(name => canonicalName(name, club))),
    matches: matches.map(({ a, b, sa, sb }) => ({ a, b, sa, sb })),
  };
}
function addCup(totals, cup, club) {
  const rows = globalThis.Sena.standings(cup.teams, cup.matches);
  const equal = (a, b) => a.w === b.w && a.pf - a.pa === b.pf - b.pa && a.pf === b.pf;
  for (const row of rows)
    for (const name of cup.teams[row.i]) {
      const id = key(name, club),
        p = totals.get(id) || {
          name: canonicalName(name, club),
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
    }
}
function ordered(cups, club) {
  const totals = new Map(
    (clubOf(club).hasBaseline ? baseline : []).map(p => [key(p.name, club), { ...p }]),
  );
  for (const cup of cups) addCup(totals, cup, club);
  return [...totals.values()].sort(
    (a, b) =>
      b.w - a.w || b.pf - b.pa - (a.pf - a.pa) || b.pf - a.pf || a.name.localeCompare(b.name),
  );
}
export function standings(history, club = DEFAULT_CLUB) {
  const starting = clubOf(club).hasBaseline ? baseline : [];
  const counted = history.filter(c => !c.inBaseline).sort((a, b) => a.sequence - b.sequence);
  if (!counted.length)
    return starting.map(p => ({ ...p, diff: p.pf - p.pa, winPercent: (p.w / p.played) * 100 }));
  const previous = ordered(counted.slice(0, -1), club),
    ranks = new Map(previous.map((p, i) => [key(p.name, club), i + 1]));
  return ordered(counted, club).map((p, i) => ({
    ...p,
    position: i + 1,
    diff: p.pf - p.pa,
    winPercent: p.played ? (p.w / p.played) * 100 : 0,
    change: ranks.has(key(p.name, club)) ? ranks.get(key(p.name, club)) - (i + 1) : 'NEW',
  }));
}
export async function leaderboardRoute(req, env, isAdmin, club = DEFAULT_CLUB) {
  const reply = (value, status = 200) =>
    Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
  if (req.method !== 'GET' && !isAdmin) return reply({ error: 'กรุณาเข้าสู่ระบบผู้จัด' }, 401);
  if (!env.DB) return reply({ error: 'ยังไม่ได้ตั้งค่าฐานข้อมูล' }, 503);
  const table = await cupHistoryTable(env.DB, club);
  await loadAliases(env.DB, club);
  if (req.method === 'POST') {
    let input;
    try {
      const text = await req.text();
      if (text.length > 100000) throw Error('ข้อมูลใหญ่เกินไป');
      input = JSON.parse(text);
      if (input?.action === 'alias' || input?.action === 'unalias') {
        const problem = await changeAlias(env.DB, club, input.action, input);
        if (problem) throw Error(problem);
        await loadAliases(env.DB, club);
        return reply({ ok: true, aliases: listAliases(club) });
      }
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
      const unknown = await unknownNames(
        env.DB,
        club,
        input.cup,
        rows.results.map(r => JSON.parse(r.payload)),
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
  const history = result.results.map(row => {
    const cup = JSON.parse(row.payload);
    return {
      ...cup,
      teams: cup.teams.map(team => team.map(name => canonicalName(name, club))),
      id: row.id,
      revision: row.revision,
      sequence: row.sequence,
    };
  });
  return reply({
    history,
    standings: standings(history, club),
    canEdit: isAdmin,
    ...(isAdmin ? { aliases: listAliases(club) } : {}),
  });
}
