// Every table, index and trigger the Worker creates, in one place.
// Tables are still created lazily (`IF NOT EXISTS`, no migration step at deploy):
// schema-cache.js runs the whole list for a binding as ONE D1 batch the first
// time a request in a fresh isolate touches the schema, instead of one round trip
// per statement. The modules keep calling `db.prepare(SQL).run()` before they use
// a table, so a missing table is still created even if that batch failed.
// New table? Add its statement here and use the constant from the module.
// (test-schema.mjs fails if a module writes its own CREATE statement.)
import { CLUB_LIST, clubOf } from './clubs.js';

// ---- per club ----
export const stateTableSql = table =>
  `CREATE TABLE IF NOT EXISTS ${table} (id INTEGER PRIMARY KEY,revision INTEGER NOT NULL,payload TEXT NOT NULL,updated_at TEXT NOT NULL)`;
export const cupTableSql = table =>
  `CREATE TABLE IF NOT EXISTS ${table} (id TEXT PRIMARY KEY,revision INTEGER NOT NULL,sequence INTEGER NOT NULL,payload TEXT NOT NULL)`;
// SQLite triggers snapshot OLD in the same transaction as the successful write.
// A rejected revision never creates a misleading backup; a failed backup aborts the write.
export function backupTriggerSql(club, kind) {
  const table = kind === 'state' ? clubOf(club).stateTable : clubOf(club).cupTable;
  return `CREATE TRIGGER IF NOT EXISTS backup_${table} BEFORE UPDATE OF payload ON ${table} WHEN OLD.payload <> NEW.payload BEGIN
 INSERT INTO backups (club,kind,target,revision,payload,created_at,reason) VALUES ('${club}','${kind}',OLD.id,OLD.revision,OLD.payload,strftime('%Y-%m-%dT%H:%M:%fZ','now'),'${kind === 'state' ? 'ก่อนบันทึกข้อมูลออนไลน์ / กู้คืน' : 'ก่อนแก้ประวัติ / กู้คืน'}');
 DELETE FROM backups WHERE club='${club}' AND seq NOT IN (SELECT seq FROM backups WHERE club='${club}' ORDER BY seq DESC LIMIT 30);
 END`;
}

// ---- shared tables (DB) ----
export const SQL = {
  backups:
    'CREATE TABLE IF NOT EXISTS backups (seq INTEGER PRIMARY KEY AUTOINCREMENT, club TEXT NOT NULL, kind TEXT NOT NULL, target TEXT NOT NULL, revision INTEGER NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL, reason TEXT NOT NULL)',
  backupsRetention:
    'CREATE TRIGGER IF NOT EXISTS backups_retention AFTER INSERT ON backups BEGIN DELETE FROM backups WHERE club=NEW.club AND seq NOT IN (SELECT seq FROM backups WHERE club=NEW.club ORDER BY seq DESC LIMIT 30); END',
  bills: `CREATE TABLE IF NOT EXISTS bills (
  id TEXT PRIMARY KEY, club TEXT NOT NULL, session_date TEXT NOT NULL,
  revision INTEGER NOT NULL, payload TEXT NOT NULL, closed_at INTEGER,
  slips_removed INTEGER NOT NULL DEFAULT 0, UNIQUE (club, session_date)
 )`,
  // Bills are never deleted, so these keep the hot reads from growing with history:
  // the organizer list (same ORDER BY expressions, no full sort) and the open-bill
  // lookups behind LINE replies (closed bills are skipped instead of scanned).
  billsListIndex:
    "CREATE INDEX IF NOT EXISTS bills_list ON bills (COALESCE(json_extract(payload, '$.cancelled'), 0), closed_at IS NOT NULL, session_date DESC)",
  billsOpenIndex:
    'CREATE INDEX IF NOT EXISTS bills_open ON bills (club, session_date) WHERE closed_at IS NULL',
  billingSettings:
    'CREATE TABLE IF NOT EXISTS billing_settings (id INTEGER PRIMARY KEY CHECK(id=1), promptpay TEXT NOT NULL)',
  memberPromptPay:
    'CREATE TABLE IF NOT EXISTS member_promptpay (user_id TEXT PRIMARY KEY, promptpay TEXT NOT NULL, updated_at TEXT NOT NULL)',
  slipChecks: `CREATE TABLE IF NOT EXISTS slip_checks (
  slip_key TEXT PRIMARY KEY, club TEXT NOT NULL, bill_id TEXT NOT NULL, payer_id TEXT NOT NULL,
  state TEXT NOT NULL, labels TEXT, read_amount INTEGER, read_date TEXT, read_ref TEXT,
  ref_norm TEXT, model TEXT, checked_at INTEGER)`,
  slipChecksRefIndex: 'CREATE INDEX IF NOT EXISTS slip_checks_ref_norm ON slip_checks (ref_norm)',
  bookingClubs:
    'CREATE TABLE IF NOT EXISTS booking_clubs (club TEXT PRIMARY KEY, revision INTEGER NOT NULL, payload TEXT NOT NULL, updated_at TEXT NOT NULL)',
  courtQueue:
    'CREATE TABLE IF NOT EXISTS court_queue (club TEXT PRIMARY KEY, revision INTEGER NOT NULL, payload TEXT NOT NULL, updated_at TEXT NOT NULL)',
  memberProfiles:
    'CREATE TABLE IF NOT EXISTS member_profiles (user_id TEXT PRIMARY KEY,line_name TEXT NOT NULL)',
  memberSessions:
    'CREATE TABLE IF NOT EXISTS member_sessions (token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL,expires_at INTEGER NOT NULL)',
  memberLinks:
    'CREATE TABLE IF NOT EXISTS member_links (user_id TEXT NOT NULL,club TEXT NOT NULL,player_id TEXT,name TEXT NOT NULL,kind TEXT NOT NULL,status TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(user_id,club))',
  memberPlayerUnique:
    "CREATE UNIQUE INDEX IF NOT EXISTS member_player_unique ON member_links(club,player_id) WHERE status='approved'",
  // LINE accounts the organizer marked as admins: same rights as the ADMIN_KEY login.
  memberAdmins:
    'CREATE TABLE IF NOT EXISTS member_admins (user_id TEXT PRIMARY KEY,granted_at TEXT NOT NULL)',
  memberWriteGuards:
    'CREATE TABLE IF NOT EXISTS member_write_guards (id TEXT PRIMARY KEY,ok INTEGER NOT NULL CHECK(ok=1))',
  attendance:
    'CREATE TABLE IF NOT EXISTS attendance (club TEXT NOT NULL, session_date TEXT NOT NULL, player_id TEXT NOT NULL, PRIMARY KEY (club, session_date, player_id))',
  playerJobs:
    'CREATE TABLE IF NOT EXISTS player_jobs (club TEXT NOT NULL, player_id TEXT NOT NULL, line TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (club, player_id))',
  cupNameIds:
    'CREATE TABLE IF NOT EXISTS cup_name_ids (club TEXT NOT NULL, name_key TEXT NOT NULL, player_id TEXT NOT NULL, PRIMARY KEY (club, name_key))',
  lineGroups:
    'CREATE TABLE IF NOT EXISTS line_groups (club TEXT PRIMARY KEY, group_id TEXT, pair_code TEXT, expires_at INTEGER)',
  lineReplyEvents:
    'CREATE TABLE IF NOT EXISTS line_reply_events (id TEXT PRIMARY KEY, created_at INTEGER NOT NULL)',
  lineBillDiagnostics:
    'CREATE TABLE IF NOT EXISTS line_bill_diagnostics (group_id TEXT PRIMARY KEY,payload TEXT NOT NULL,updated_at TEXT NOT NULL)',
  lineNotices:
    'CREATE TABLE IF NOT EXISTS line_notices (code TEXT PRIMARY KEY, club TEXT NOT NULL, kind TEXT NOT NULL, payload TEXT NOT NULL, created_at INTEGER NOT NULL, used_at INTEGER)',
  lineDailyNudges:
    'CREATE TABLE IF NOT EXISTS line_daily_nudges (group_id TEXT NOT NULL, day TEXT NOT NULL, claimed_at INTEGER NOT NULL, PRIMARY KEY (group_id, day))',
  sessionSigning:
    'CREATE TABLE IF NOT EXISTS session_signing (id INTEGER PRIMARY KEY, secret TEXT NOT NULL)',
  // Cup sponsors (sponsors.js): one row per sponsor of a club's Cup day.
  cupSponsors: `CREATE TABLE IF NOT EXISTS cup_sponsors (
  id TEXT PRIMARY KEY, club TEXT NOT NULL, cup_date TEXT NOT NULL, player_id TEXT,
  display_name TEXT NOT NULL, prize TEXT NOT NULL, award TEXT NOT NULL, award_note TEXT,
  message TEXT, hidden INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL, revision INTEGER NOT NULL DEFAULT 1
 )`,
  cupSponsorsDateIndex:
    'CREATE INDEX IF NOT EXISTS cup_sponsors_date ON cup_sponsors (club, cup_date)',
  cupSponsorsPlayerIndex:
    'CREATE UNIQUE INDEX IF NOT EXISTS cup_sponsors_player ON cup_sponsors (club, cup_date, player_id) WHERE player_id IS NOT NULL',
};

// ---- slip images (SLIPS_DB) ----
export const SLIPS_SQL = {
  billSlips: `CREATE TABLE IF NOT EXISTS bill_slips (
  key TEXT PRIMARY KEY, bill_id TEXT NOT NULL, content_type TEXT NOT NULL,
  bytes INTEGER NOT NULL, body BLOB NOT NULL
 )`,
  billSlipsBillIndex: 'CREATE INDEX IF NOT EXISTS bill_slips_bill_id ON bill_slips (bill_id)',
};

// Batch order: tables before the indexes and triggers that name them.
const isTable = sql => /^CREATE TABLE/.test(sql);
const ordered = list => [...list.filter(isTable), ...list.filter(sql => !isTable(sql))];
export const DB_SCHEMA = ordered([
  ...CLUB_LIST.flatMap(c => [stateTableSql(c.stateTable), cupTableSql(c.cupTable)]),
  ...Object.values(SQL),
  ...CLUB_LIST.flatMap(c => [backupTriggerSql(c.id, 'state'), backupTriggerSql(c.id, 'history')]),
]);
export const SLIPS_SCHEMA = ordered(Object.values(SLIPS_SQL));
