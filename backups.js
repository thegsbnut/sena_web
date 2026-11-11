import { clubOf } from './clubs.js';
import { cleanCup } from './leaderboard.js';
const reply = (data, status = 200) =>
  Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
const tables = club => ({ state: clubOf(club).stateTable, history: clubOf(club).cupTable });
// SQLite triggers snapshot OLD in the same transaction as the successful write.
// A rejected revision never creates a misleading backup; a failed backup aborts the write.
export async function prepareBackups(db, club) {
  const t = tables(club);
  await db
    .prepare(
      'CREATE TABLE IF NOT EXISTS backups (seq INTEGER PRIMARY KEY AUTOINCREMENT, club TEXT NOT NULL, kind TEXT NOT NULL, target TEXT NOT NULL, revision INTEGER NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL, reason TEXT NOT NULL)',
    )
    .run();
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS ${t.state} (id INTEGER PRIMARY KEY,revision INTEGER NOT NULL,payload TEXT NOT NULL,updated_at TEXT NOT NULL)`,
    )
    .run();
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS ${t.history} (id TEXT PRIMARY KEY,revision INTEGER NOT NULL,sequence INTEGER NOT NULL,payload TEXT NOT NULL)`,
    )
    .run();
  await db
    .prepare(
      `CREATE TRIGGER IF NOT EXISTS backups_retention AFTER INSERT ON backups BEGIN DELETE FROM backups WHERE club=NEW.club AND seq NOT IN (SELECT seq FROM backups WHERE club=NEW.club ORDER BY seq DESC LIMIT 30); END`,
    )
    .run();
  for (const kind of ['state', 'history'])
    await db
      .prepare(
        `CREATE TRIGGER IF NOT EXISTS backup_${t[kind]} BEFORE UPDATE OF payload ON ${t[kind]} WHEN OLD.payload <> NEW.payload BEGIN
 INSERT INTO backups (club,kind,target,revision,payload,created_at,reason) VALUES ('${club}','${kind}',OLD.id,OLD.revision,OLD.payload,strftime('%Y-%m-%dT%H:%M:%fZ','now'),'${kind === 'state' ? 'ก่อนบันทึกข้อมูลออนไลน์ / กู้คืน' : 'ก่อนแก้ประวัติ / กู้คืน'}');
 DELETE FROM backups WHERE club='${club}' AND seq NOT IN (SELECT seq FROM backups WHERE club='${club}' ORDER BY seq DESC LIMIT 30);
 END`,
      )
      .run();
}
export async function backupsRoute(req, env, isAdmin, club, valid) {
  if (!isAdmin) return reply({ error: 'กรุณาเข้าสู่ระบบผู้จัด' }, 401);
  if (!env.DB) return reply({ error: 'ยังไม่ได้ตั้งค่าฐานข้อมูล' }, 503);
  await prepareBackups(env.DB, club);
  const url = new URL(req.url),
    id = url.searchParams.get('id');
  if (req.method === 'GET') {
    if (id) {
      const row = await env.DB.prepare('SELECT * FROM backups WHERE seq=? AND club=?')
        .bind(id, club)
        .first();
      if (!row) return reply({ error: 'ไม่พบข้อมูลสำรองในก๊วนนี้' }, 404);
      return reply({ ...row, payload: JSON.parse(row.payload) });
    }
    const rows = await env.DB.prepare(
      'SELECT seq,kind,target,revision,created_at,reason FROM backups WHERE club=? ORDER BY seq DESC LIMIT 30',
    )
      .bind(club)
      .all();
    return reply({ backups: rows.results });
  }
  if (req.method !== 'POST') return reply({ error: 'Method not allowed' }, 405);
  let input;
  try {
    const text = await req.text();
    if (text.length > 500000) throw Error();
    input = JSON.parse(text);
  } catch {
    return reply({ error: 'ข้อมูลสำรองไม่ถูกต้องหรือใหญ่เกินไป' }, 400);
  }
  if (input.action === 'create') {
    if (!valid(input.state) || !Number.isInteger(input.revision) || input.revision < 0)
      return reply({ error: 'ข้อมูลสำรองไม่ถูกต้อง' }, 400);
    const reason = [
      'ก่อนรีเซ็ต Cup',
      'ก่อนสร้าง Cup ใหม่',
      'ก่อนนำเข้าข้อมูล',
      'ก่อนกู้คืน',
      'สำรองด้วยมือ',
    ].includes(input.reason)
      ? input.reason
      : 'สำรองด้วยมือ';
    await env.DB.prepare(
      "INSERT INTO backups (club,kind,target,revision,payload,created_at,reason) VALUES (?,'state','1',?,?,?,?)",
    )
      .bind(club, input.revision, JSON.stringify(input.state), new Date().toISOString(), reason)
      .run();
    await env.DB.prepare(
      'DELETE FROM backups WHERE club=? AND seq NOT IN (SELECT seq FROM backups WHERE club=? ORDER BY seq DESC LIMIT 30)',
    )
      .bind(club, club)
      .run();
    return reply({ ok: true });
  }
  if (
    input.action !== 'restore' ||
    !Number.isInteger(input.id) ||
    !Number.isInteger(input.revision) ||
    input.revision < 0
  )
    return reply({ error: 'ข้อมูลกู้คืนไม่ถูกต้อง' }, 400);
  const row = await env.DB.prepare('SELECT * FROM backups WHERE seq=? AND club=?')
    .bind(input.id, club)
    .first();
  if (!row) return reply({ error: 'ไม่พบข้อมูลสำรองในก๊วนนี้' }, 404);
  // Read the requested snapshot before creating another backup: retention may remove the oldest row.
  if (input.currentState !== undefined) {
    if (!valid(input.currentState)) return reply({ error: 'ข้อมูลปัจจุบันสำรองไม่ได้' }, 400);
    await env.DB.prepare(
      "INSERT INTO backups (club,kind,target,revision,payload,created_at,reason) VALUES (?,'state','1',?,?,?,'ก่อนกู้คืน')",
    )
      .bind(club, input.revision, JSON.stringify(input.currentState), new Date().toISOString())
      .run();
  }
  const t = tables(club);
  let result;
  if (row.kind === 'state') {
    const state = JSON.parse(row.payload);
    if (!valid(state)) return reply({ error: 'ข้อมูลสำรองรุ่นนี้กู้คืนไม่ได้' }, 400);
    const now = new Date().toISOString();
    result =
      input.revision === 0
        ? await env.DB.prepare(
            `INSERT OR IGNORE INTO ${t.state} (id,revision,payload,updated_at) VALUES (1,1,?,?) RETURNING revision`,
          )
            .bind(row.payload, now)
            .first()
        : await env.DB.prepare(
            `UPDATE ${t.state} SET payload=?,revision=revision+1,updated_at=? WHERE id=1 AND revision=? RETURNING revision`,
          )
            .bind(row.payload, now, input.revision)
            .first();
  } else {
    let cup;
    try {
      cup = cleanCup(JSON.parse(row.payload), club);
    } catch {
      return reply({ error: 'ประวัติสำรองกู้คืนไม่ได้' }, 400);
    }
    result = await env.DB.prepare(
      `UPDATE ${t.history} SET payload=?,revision=revision+1 WHERE id=? AND revision=? RETURNING revision`,
    )
      .bind(JSON.stringify(cup), row.target, input.revision)
      .first();
  }
  // RETURNING row = this write happened (D1's meta.changes also counts the backup trigger).
  if (!result)
    return reply({ error: 'ข้อมูลเปลี่ยนจากอีกเครื่อง กรุณาโหลดใหม่แล้วเลือกกู้คืนอีกครั้ง' }, 409);
  return reply({ ok: true, kind: row.kind, revision: input.revision + 1 });
}
