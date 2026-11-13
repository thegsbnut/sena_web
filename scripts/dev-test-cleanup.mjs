#!/usr/bin/env node
// Delete every dev-login test user (is_test = 1, user_id "U_TEST_…") and all
// sandbox-club ("test") data from D1. Real members' rows are never touched:
// every statement is limited to user_id LIKE 'U_TEST_%' or club = 'test'.
//
//   node scripts/dev-test-cleanup.mjs --remote            # production
//   node scripts/dev-test-cleanup.mjs --remote --dry-run  # only count what would go
//   node scripts/dev-test-cleanup.mjs --local             # wrangler dev database
import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
const target = args.includes('--remote') ? '--remote' : args.includes('--local') ? '--local' : '';
const dryRun = args.includes('--dry-run');
if (!target) {
  console.error('ระบุ --remote (production) หรือ --local');
  process.exit(1);
}
const TEST_USER = "user_id LIKE 'U\\_TEST\\_%' ESCAPE '\\'";
const TEST_CLUB = "club='test'";

function d1(database, sql) {
  const out = execFileSync(
    'npx',
    ['wrangler', 'd1', 'execute', database, target, '--yes', '--json', '--command', sql],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] },
  );
  return JSON.parse(out.slice(out.indexOf('[')));
}
const rows = (database, sql) => d1(database, sql).flatMap(r => r.results || []);
const tables = database =>
  new Set(rows(database, "SELECT name FROM sqlite_master WHERE type='table'").map(r => r.name));

const db = tables('DB');
// [table, WHERE] for every place a test user or the sandbox club can leave rows.
const targets = [
  ['member_sessions', TEST_USER],
  ['member_links', `${TEST_USER} OR ${TEST_CLUB}`],
  ['member_admins', TEST_USER],
  ['member_profiles', TEST_USER],
  ['bills', TEST_CLUB],
  ['slip_checks', TEST_CLUB],
  ['booking_clubs', TEST_CLUB],
  ['backups', TEST_CLUB],
  ['line_groups', TEST_CLUB],
].filter(([table]) => db.has(table));
const dropped = ['club_state_test', 'cup_history_test', 'member_test_users'].filter(t => db.has(t));

const billIds = db.has('bills')
  ? rows('DB', `SELECT id FROM bills WHERE ${TEST_CLUB}`).map(r => r.id)
  : [];
for (const [table, where] of targets) {
  const [{ n }] = rows('DB', `SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`);
  console.log(`DB.${table}: ${n} แถว`);
}
for (const table of dropped) console.log(`DB.${table}: ลบทั้งตาราง`);
const idList = billIds.map(id => "'" + String(id).replaceAll("'", "''") + "'").join(',');
let slips = false;
if (billIds.length) {
  slips = tables('SLIPS_DB').has('bill_slips');
  if (slips) {
    const [{ n }] = rows(
      'SLIPS_DB',
      `SELECT COUNT(*) AS n FROM bill_slips WHERE bill_id IN (${idList})`,
    );
    console.log(`SLIPS_DB.bill_slips: ${n} รูป`);
  }
}
if (dryRun) {
  console.log('dry-run: ยังไม่ได้ลบอะไร');
  process.exit(0);
}

if (slips) d1('SLIPS_DB', `DELETE FROM bill_slips WHERE bill_id IN (${idList})`);
const statements = [
  ...targets.map(([table, where]) => `DELETE FROM ${table} WHERE ${where}`),
  ...dropped.map(table => `DROP TABLE IF EXISTS ${table}`),
];
if (statements.length) d1('DB', statements.join(';\n'));

// Verify: nothing test-related may remain.
const left = targets
  .map(([table, where]) => [
    table,
    rows('DB', `SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`)[0].n,
  ])
  .filter(([, n]) => n);
const stillThere = [...tables('DB')].filter(t => dropped.includes(t));
if (left.length || stillThere.length) {
  console.error('ยังเหลือข้อมูลทดสอบ:', left, stillThere);
  process.exit(1);
}
console.log('ลบผู้ใช้ทดสอบและข้อมูลก๊วนทดสอบครบแล้ว');
