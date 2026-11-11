import { clubOf, CLUB_IDS } from './clubs.js';
export class MappingError extends Error {
  constructor(message) {
    super(message);
    this.status = 409;
  }
}
const fail = message => {
  throw new MappingError(message);
};
const key = name => name.normalize('NFC').trim().toLowerCase();
async function readRoster(db, club) {
  const table = clubOf(club).stateTable;
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS ${table} (id INTEGER PRIMARY KEY,revision INTEGER NOT NULL,payload TEXT NOT NULL,updated_at TEXT NOT NULL)`,
    )
    .run();
  const row = await db.prepare(`SELECT revision,payload FROM ${table} WHERE id=1`).first();
  return {
    table,
    row,
    state: row
      ? JSON.parse(row.payload)
      : { players: [], selected: [], rounds: 10, locks: [], result: null, cup: null },
  };
}
const rosterWrite = (db, r, time) =>
  r.row
    ? db
        .prepare(`UPDATE ${r.table} SET payload=?,revision=revision+1,updated_at=? WHERE id=1`)
        .bind(JSON.stringify(r.state), time)
    : db.prepare(`INSERT INTO ${r.table} VALUES(1,1,?,?)`).bind(JSON.stringify(r.state), time);
// D1 batch is a transaction. The CHECK guard aborts the entire batch when any
// roster or binding changed since it was read, including inserts into empty rows.
export async function mapBoth(
  db,
  userId,
  club,
  playerId,
  { expected = null, remove = false, allowMove = false, create = null } = {},
) {
  const clubs = CLUB_IDS,
    rosters = {},
    links = {};
  for (const c of clubs) {
    rosters[c] = await readRoster(db, c);
    links[c] = await db
      .prepare('SELECT * FROM member_links WHERE user_id=? AND club=?')
      .bind(userId, c)
      .first();
  }
  const current = links[club];
  if (
    expected &&
    (!current || current.player_id !== expected.playerId || current.status !== expected.status)
  )
    fail('การผูกเปลี่ยนแล้ว กรุณาโหลดล่าสุด');
  // A brand-new member: add them to this club's roster in the same transaction,
  // then the loop below mirrors them into the other club exactly like a mapping.
  let source;
  if (create) {
    if (CLUB_IDS.some(c => links[c]?.status === 'approved'))
      fail('บัญชี LINE นี้ผูกชื่อไว้แล้ว กรุณาโหลดหน้าใหม่');
    if (CLUB_IDS.some(c => rosters[c].state.players.some(p => key(p.name) === key(create.name))))
      fail(
        'มีชื่อ "' +
          create.name +
          '" ในระบบอยู่แล้ว ถ้าเป็นชื่อของคุณให้เลือกจากรายชื่อ ถ้าไม่ใช่ให้ใช้ชื่ออื่น',
      );
    if (rosters[club].state.players.length >= 200) fail('รายชื่อเต็ม กรุณาติดต่อผู้จัด');
    source = {
      id: 'new:' + crypto.randomUUID().replaceAll('-', '').slice(0, 20),
      name: create.name,
      thai: '',
      lv: create.lv,
      gender: create.gender,
      // Shown to the organizer as "new, LV not reviewed" until they edit the player.
      selfSignup: { lineName: create.lineName || '', at: new Date().toISOString() },
    };
    rosters[club].state.players.push(source);
  } else source = rosters[club].state.players.find(p => p.id === playerId);
  if (!remove && !source) fail('ไม่พบชื่อผู้เล่นที่เลือก');
  const conditions = [],
    args = [],
    writes = [],
    time = new Date().toISOString();
  const condition = (sql, ...values) => {
    conditions.push(sql);
    args.push(...values);
  };
  for (const c of clubs) {
    const snapshot = links[c],
      r = rosters[c];
    if (snapshot)
      condition(
        'EXISTS(SELECT 1 FROM member_links WHERE user_id=? AND club=? AND player_id IS ? AND status=? AND created_at=?)',
        userId,
        c,
        snapshot.player_id,
        snapshot.status,
        snapshot.created_at,
      );
    else condition('NOT EXISTS(SELECT 1 FROM member_links WHERE user_id=? AND club=?)', userId, c);
    if (remove) {
      writes.push(
        db.prepare('DELETE FROM member_links WHERE user_id=? AND club=?').bind(userId, c),
      );
      continue;
    }
    if (r.row)
      condition(`EXISTS(SELECT 1 FROM ${r.table} WHERE id=1 AND revision=?)`, r.row.revision);
    else condition(`NOT EXISTS(SELECT 1 FROM ${r.table} WHERE id=1)`);
    if (create && c === club) writes.push(rosterWrite(db, r, time));
    const matches =
      c === club ? [source] : r.state.players.filter(p => key(p.name) === key(source.name));
    if (matches.length > 1) fail('มีชื่อซ้ำในอีกสนาม ให้ผู้จัดตรวจการแมพก่อน');
    let target = matches[0];
    if (!target) {
      const bytes = await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(club + ':' + source.id),
      );
      const id =
        'shared:' +
        Array.from(new Uint8Array(bytes), n => n.toString(16).padStart(2, '0')).join('');
      const existing = r.state.players.find(p => p.id === id);
      target = existing || {
        id,
        name: source.name,
        thai: source.thai || '',
        lv: source.lv,
        gender: source.gender,
        ...(source.selfSignup ? { selfSignup: source.selfSignup } : {}),
      };
      if (!Number.isFinite(target.lv) || !['M', 'F'].includes(target.gender))
        fail('รายชื่อเดิมยังไม่มี LV หรือเพศ ให้ผู้จัดตรวจสอบก่อน');
      if (!existing) {
        if (r.state.players.length >= 200) fail('รายชื่ออีกสนามเต็ม ให้ผู้จัดตรวจสอบก่อน');
        r.state.players.push(target);
        writes.push(rosterWrite(db, r, time));
      }
    }
    if (!allowMove && snapshot?.status === 'approved' && snapshot.player_id !== target.id)
      fail('บัญชีนี้มีการแมพต่างกันอยู่ ให้ผู้จัดแก้ไข');
    condition(
      "NOT EXISTS(SELECT 1 FROM member_links WHERE club=? AND player_id=? AND status='approved' AND user_id<>?)",
      c,
      target.id,
      userId,
    );
    writes.push(
      db
        .prepare(
          "INSERT INTO member_links VALUES(?,?,?,?,?,'approved',?) ON CONFLICT(user_id,club) DO UPDATE SET player_id=excluded.player_id,name=excluded.name,kind=excluded.kind,status=excluded.status,created_at=excluded.created_at",
        )
        .bind(userId, c, target.id, target.name, create ? 'new' : 'existing', time),
    );
  }
  await db
    .prepare(
      'CREATE TABLE IF NOT EXISTS member_write_guards (id TEXT PRIMARY KEY,ok INTEGER NOT NULL CHECK(ok=1))',
    )
    .run();
  const operation = crypto.randomUUID();
  const guard = db
    .prepare(
      'INSERT INTO member_write_guards VALUES(?,CASE WHEN ' +
        conditions.map(c => '(' + c + ')').join(' AND ') +
        ' THEN 1 ELSE 0 END)',
    )
    .bind(operation, ...args);
  try {
    await db.batch([
      guard,
      ...writes,
      db.prepare('DELETE FROM member_write_guards WHERE id=?').bind(operation),
    ]);
  } catch (error) {
    if (/constraint|unique|check/i.test(error.message))
      fail('ชื่อถูกผูกหรือข้อมูลเปลี่ยนแล้ว กรุณาโหลดใหม่ หรือติดต่อผู้จัด');
    throw error;
  }
}
