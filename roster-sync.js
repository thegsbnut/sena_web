// Each club keeps its own roster, but a LINE member is linked to one player in
// every club. When the organizer edits a linked player in one club, copy the
// change to that member's player in the other club(s), so names and levels
// stay in step without editing twice. Deletions and unlinked players are never
// copied. A rename that would clash with another name over there is skipped and
// reported instead.
import { CLUB_IDS, clubOf } from './clubs.js';
import { prepareBackups } from './backups.js';

const FIELDS = ['name', 'thai', 'lv', 'gender'];
const key = name => String(name).normalize('NFC').trim().toLowerCase();

function changesFor(before, after) {
  const old = new Map(before.map(p => [p.id, p]));
  const changes = new Map();
  for (const p of after) {
    const o = old.get(p.id);
    if (!o) continue;
    const fields = FIELDS.filter(f => o[f] !== p[f]);
    const reviewed = Boolean(o.selfSignup) && !p.selfSignup;
    if (fields.length || reviewed) changes.set(p.id, { player: p, fields, reviewed });
  }
  return changes;
}

async function linkedPairs(db, from, to) {
  try {
    const { results } = await db
      .prepare(
        "SELECT a.player_id AS src, b.player_id AS dst FROM member_links a JOIN member_links b ON a.user_id=b.user_id WHERE a.club=? AND b.club=? AND a.status='approved' AND b.status='approved'",
      )
      .bind(from, to)
      .all();
    return new Map(results.map(r => [r.src, r.dst]));
  } catch (error) {
    if (/no such table/i.test(error.message)) return new Map();
    throw error;
  }
}

export async function syncLinkedPlayers(db, club, before, after) {
  const changes = changesFor(before, after);
  const report = { synced: 0, skipped: [] };
  if (!changes.size) return report;
  for (const other of CLUB_IDS.filter(c => c !== club)) {
    const pairs = await linkedPairs(db, club, other);
    const targets = [...changes].filter(([id]) => pairs.has(id));
    if (!targets.length) continue;
    const table = clubOf(other).stateTable;
    for (let attempt = 0; attempt < 3; attempt++) {
      const row = await db.prepare(`SELECT revision,payload FROM ${table} WHERE id=1`).first();
      if (!row) break;
      const state = JSON.parse(row.payload);
      let synced = 0;
      const skipped = [];
      for (const [id, change] of targets) {
        const target = state.players.find(p => p.id === pairs.get(id));
        if (!target) continue;
        let touched = false;
        for (const field of change.fields) {
          const value = change.player[field];
          if (
            field === 'name' &&
            state.players.some(p => p !== target && key(p.name) === key(value))
          ) {
            skipped.push({ name: value, club: clubOf(other).label, reason: 'name_taken' });
            continue;
          }
          if (target[field] !== value) {
            target[field] = value;
            touched = true;
          }
        }
        if (change.reviewed && target.selfSignup) {
          delete target.selfSignup;
          touched = true;
        }
        if (touched) synced++;
      }
      if (!synced) {
        report.skipped.push(...skipped);
        break;
      }
      await prepareBackups(db, other);
      // RETURNING, not meta.changes: D1 also counts the backup trigger's row.
      const written = await db
        .prepare(
          `UPDATE ${table} SET payload=?,revision=revision+1,updated_at=? WHERE id=1 AND revision=? RETURNING revision`,
        )
        .bind(JSON.stringify(state), new Date().toISOString(), row.revision)
        .first();
      if (written) {
        report.synced += synced;
        report.skipped.push(...skipped);
        break;
      }
      if (attempt === 2) report.skipped.push({ club: clubOf(other).label, reason: 'busy' });
    }
  }
  return report;
}
