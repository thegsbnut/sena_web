const day = 86400000;
const maxSlipBytes = 1024 * 1024;
const maxStoredSlipBytes = 250 * 1000 * 1000;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const idPattern = /^[a-f0-9]{32}$/;
const tokenPattern = /^[a-f0-9]{64}$/;
const clubName = club => club === '88' ? '88' : 'Sena';
const money = cents => (cents / 100).toLocaleString('th-TH', { maximumFractionDigits: 2 });
const clean = value => typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
const json = (value, status = 200) => Response.json(value, {
 status, headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }
});
const fail = (message, status = 400) => json({ error: message }, status);
const randomId = () => crypto.randomUUID().replaceAll('-', '');
const token = () => randomId() + randomId();
const billLink = (origin, bill) => new URL('/billing.html?bill=' + bill.id, origin).href;
const displayDate = date => new Intl.DateTimeFormat('th-TH', {
 dateStyle: 'medium', timeZone: 'Asia/Bangkok'
}).format(new Date(date + 'T12:00:00+07:00'));

async function prepare(db) {
 await db.prepare(`CREATE TABLE IF NOT EXISTS bills (
  id TEXT PRIMARY KEY, club TEXT NOT NULL, session_date TEXT NOT NULL,
  revision INTEGER NOT NULL, payload TEXT NOT NULL, closed_at INTEGER,
  slips_removed INTEGER NOT NULL DEFAULT 0, UNIQUE (club, session_date)
 )`).run();
}
async function prepareSlips(db) {
 await db.prepare(`CREATE TABLE IF NOT EXISTS bill_slips (
  key TEXT PRIMARY KEY, bill_id TEXT NOT NULL, content_type TEXT NOT NULL,
  bytes INTEGER NOT NULL, body BLOB NOT NULL
 )`).run();
 await db.prepare('CREATE INDEX IF NOT EXISTS bill_slips_bill_id ON bill_slips (bill_id)').run();
}
async function readBill(db, id) {
 const row = await db.prepare('SELECT * FROM bills WHERE id=?').bind(id).first();
 return row ? { ...row, ...JSON.parse(row.payload) } : null;
}
async function updateBill(db, bill, payload) {
 const result = await db.prepare('UPDATE bills SET payload=?, revision=revision+1, closed_at=? WHERE id=? AND revision=?')
  .bind(JSON.stringify(payload), payload.payers.every(p => p.status === 'paid') ? Date.now() : null, bill.id, bill.revision).run();
 return Boolean(result.meta.changes);
}
const paidCount = bill => bill.payers.filter(p => p.status === 'paid').length;
const outstanding = bill => bill.payers.reduce((total, p) => total + (p.status === 'paid' ? 0 : p.amount), 0);
function summary(bill) {
 return {
  id: bill.id, club: bill.club, date: bill.session_date, total: bill.total,
  count: bill.payers.length, paid: paidCount(bill), outstanding: outstanding(bill)
 };
}
function paymentView(p, privateView, admin, slipsRemoved) {
 const { id, name, amount, status, shares, note, paidAt, slipKey } = p;
 return {
  id, name, amount, status, shares: shares.length,
  ...(privateView ? { names: shares.map(x => x.name), note, paidAt, hasSlip: Boolean(slipKey) && !slipsRemoved } : {}),
  ...(admin ? { token: p.token, payerKey: p.payerKey, receiptId: p.slipKey?.split('/').at(-1) } : {})
 };
}
function billView(bill, admin, payer) {
 return {
  ...summary(bill), court: bill.court, shuttle: bill.shuttle, people: bill.people,
  ...(admin || payer ? { transfer: bill.transfer } : {}),
  ...(admin ? { revision: bill.revision, editable: !bill.payers.some(p => p.submittedAt) } : {}),
  payers: (payer ? [payer] : bill.payers).map(p => paymentView(p, admin || Boolean(payer), admin, bill.slips_removed))
 };
}
function validDate(date) {
 if (typeof date !== 'string' || !datePattern.test(date)) return false;
 const parsed = new Date(date + 'T00:00:00Z');
 return Number.isFinite(+parsed) && parsed.toISOString().slice(0, 10) === date;
}
function readDraft(input) {
 const { date, court, shuttle, attendees } = input;
 const transfer = typeof input.transfer === 'string' ? input.transfer.trim() : '';
 if (!validDate(date) || ![court, shuttle].every(n => Number.isSafeInteger(n) && n >= 0 && n <= 100000000) ||
     court + shuttle < 1 || !transfer || transfer.length > 500 ||
     !Array.isArray(attendees) || !attendees.length || attendees.length > 200 || court + shuttle < attendees.length) return null;
 const people = [];
 const keys = new Set();
 for (const item of attendees) {
  const name = clean(item?.name), payer = clean(item?.payer), payerKey = clean(item?.payerKey);
  if (!name || !payer || !payerKey || name.length > 100 || payer.length > 100 || payerKey.length > 220) return null;
  const key = payerKey + '\n' + name.normalize('NFC').toLowerCase();
  if (keys.has(key)) return null;
  keys.add(key);
  people.push({ name, payer, payerKey });
 }
 return { date, court, shuttle, transfer, people };
}
function splitBill(draft, existing = []) {
 const total = draft.court + draft.shuttle;
 const each = Math.floor(total / draft.people.length), remainder = total % draft.people.length;
 const byPayer = new Map();
 const previous = new Map(existing.map(p => [p.payerKey, p]));
 for (const [i, person] of draft.people.entries()) {
  let p = byPayer.get(person.payerKey);
  if (!p) {
   const old = previous.get(person.payerKey);
   p = { id: old?.id ?? randomId(), token: old?.token ?? token(), payerKey: person.payerKey, name: person.payer, shares: [], amount: 0, status: 'unpaid' };
   byPayer.set(person.payerKey, p);
  }
  const amount = each + Number(i < remainder);
  p.amount += amount;
  p.shares.push({ name: person.name, amount });
 }
 return { court: draft.court, shuttle: draft.shuttle, total, transfer: draft.transfer, people: draft.people.length, payers: [...byPayer.values()] };
}
async function recentSessions(db, club) {
 if (!await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='booking_clubs'").first()) return [];
 const doc = await db.prepare('SELECT payload FROM booking_clubs WHERE club=?').bind(club).first();
 if (!doc) return [];
 const table = club === '88' ? 'club_state_88' : 'club_state';
 const exists = await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").bind(table).first();
 const roster = exists ? await db.prepare(`SELECT payload FROM ${table} WHERE id=1`).first() : null;
 const players = new Map((roster ? JSON.parse(roster.payload).players : []).map(p => [p.id, p.name]));
 return JSON.parse(doc.payload).sessions.filter(s => !s.skipped && s.registrations.length)
  .sort((a, b) => b.date.localeCompare(a.date)).map(s => ({
   date: s.date, time: s.start + '–' + s.end, attendees: s.registrations.map((r, i) => {
    const host = r.guest?.hostId || r.playerId;
    const payer = players.get(host);
    return payer ? {
     name: r.guest?.name || payer, payer, payerKey: 'member:' + host,
     guest: Boolean(r.guest), attended: i < s.capacity
    } : null;
   }).filter(Boolean)
  }));
}
async function readLimitedJson(req) {
 const bytes = await readLimited(req, 128 * 1024);
 if (!bytes) return null;
 try { return JSON.parse(new TextDecoder().decode(bytes)); }
 catch { return null; }
}
async function readLimited(req, max) {
 if (!req.body || Number(req.headers.get('Content-Length')) > max) return null;
 const reader = req.body.getReader();
 const chunks = [];
 let size = 0;
 try {
  for (;;) {
   const { done, value } = await reader.read();
   if (done) break;
   size += value.length;
   if (size > max) { await reader.cancel(); return null; }
   chunks.push(value);
  }
 } finally { reader.releaseLock(); }
 const bytes = new Uint8Array(size);
 let offset = 0;
 for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
 return bytes;
}
function imageType(bytes) {
 if (bytes.length < 12) return null;
 if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
 if ([137, 80, 78, 71, 13, 10, 26, 10].every((n, i) => bytes[i] === n)) return 'image/png';
 const text = new TextDecoder();
 if (text.decode(bytes.subarray(0, 4)) === 'RIFF' && text.decode(bytes.subarray(8, 12)) === 'WEBP') return 'image/webp';
 return null;
}

export async function billingRoute(req, env, admin, club) {
 if (!env.DB) return fail('ระบบบิลยังไม่พร้อม', 503);
 const url = new URL(req.url), db = env.DB;
 const id = url.searchParams.get('bill');
 const action = url.searchParams.get('action');
 const supplied = req.headers.get('X-Bill-Token') || '';
 if (id && !idPattern.test(id)) return fail('ไม่พบบิล', 404);
 await prepare(db);
 if (!id) {
  if (!admin) return fail('กรุณาเข้าสู่ระบบผู้จัด', 401);
  if (req.method === 'GET') {
   if (action === 'sessions') return json({ sessions: await recentSessions(db, club), storageReady: Boolean(env.SLIPS_DB) });
   const rows = await db.prepare('SELECT * FROM bills ORDER BY closed_at IS NOT NULL, session_date DESC LIMIT 200').all();
   return json({ bills: rows.results.map(r => summary({ ...r, ...JSON.parse(r.payload) })), storageReady: Boolean(env.SLIPS_DB) });
  }
  if (req.method !== 'POST') return fail('Method not allowed', 405);
  const input = await readLimitedJson(req);
  const draft = input && readDraft(input);
  if (!draft) return fail('กรุณาตรวจวันที่ ค่าใช้จ่าย บัญชีรับเงิน และรายชื่อผู้ตี');
  if (!env.SLIPS_DB) return fail('ยังไม่พร้อมรับสลิป กรุณาติดต่อผู้จัดระบบ', 503);
  const billId = randomId();
  await db.prepare('INSERT OR IGNORE INTO bills (id,club,session_date,revision,payload) VALUES (?,?,?,0,?)')
   .bind(billId, club, draft.date, JSON.stringify(splitBill(draft))).run();
  const existing = await db.prepare('SELECT id FROM bills WHERE club=? AND session_date=?').bind(club, draft.date).first();
  return json({ id: existing.id, existing: existing.id !== billId });
 }
 const bill = await readBill(db, id);
 if (!bill) return fail('ไม่พบบิล', 404);
 const payer = tokenPattern.test(supplied) ? bill.payers.find(p => p.token === supplied) : null;
 if (supplied && !payer) return fail('ลิงก์ชำระเงินไม่ถูกต้อง', 403);
 if (req.method === 'GET') {
  if (action !== 'slip') return json(billView(bill, admin && !payer, payer));
  const target = payer || (admin ? bill.payers.find(p => p.id === url.searchParams.get('payer')) : null);
  if (!target) return fail('ไม่มีสิทธิ์ดูสลิป', 403);
  if (bill.slips_removed || !target.slipKey || !env.SLIPS_DB) return fail('ไม่พบสลิป', 404);
  const slip = await env.SLIPS_DB.prepare('SELECT content_type, body FROM bill_slips WHERE key=?').bind(target.slipKey).first();
  if (!slip) return fail('ไม่พบสลิป', 404);
  const type = slip.content_type;
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(type)) return fail('รูปแบบสลิปไม่ถูกต้อง', 415);
  return new Response(new Uint8Array(slip.body), { headers: {
   'Content-Type': type, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer'
  } });
 }
 if (req.method !== 'POST') return fail('Method not allowed', 405);
 const payload = { court: bill.court, shuttle: bill.shuttle, total: bill.total, transfer: bill.transfer, people: bill.people, payers: bill.payers };
 if (action === 'upload') {
  if (!payer) return fail('กรุณาเปิดลิงก์ชำระเงินของตัวเอง', 403);
  const slips = env.SLIPS_DB;
  if (!slips) return fail('ระบบรับสลิปยังไม่พร้อม', 503);
  if (!['unpaid', 'rejected'].includes(payer.status)) return fail('รายการนี้ส่งสลิปแล้ว', 409);
  const bytes = await readLimited(req, maxSlipBytes);
  const type = bytes && imageType(bytes);
  if (!type) return fail('ใช้รูป JPG, PNG หรือ WebP ขนาดไม่เกิน 1 MB');
  const key = id + '/' + payer.id + '/' + randomId();
  await prepareSlips(slips);
  const stored = await slips.prepare(`INSERT INTO bill_slips (key, bill_id, content_type, bytes, body)
   SELECT ?, ?, ?, ?, ? WHERE (SELECT COALESCE(SUM(bytes), 0) FROM bill_slips) + ? <= ?`)
   .bind(key, id, type, bytes.length, bytes.buffer, bytes.length, maxStoredSlipBytes).run();
  if (!stored.meta.changes) return fail('พื้นที่เก็บสลิปเต็ม กรุณาแจ้งผู้จัด', 507);
  const oldKey = payer.slipKey;
  Object.assign(payer, { status: 'review', slipKey: key, note: '', submittedAt: Date.now() });
  // A storage/DB error can be ambiguous. Only remove the new object after a
  // definite conflict, so a successfully attached receipt is never erased.
  if (!await updateBill(db, bill, payload)) {
   await slips.prepare('DELETE FROM bill_slips WHERE key=?').bind(key).run();
   return fail('บิลมีการเปลี่ยนแปลง กรุณาโหลดใหม่แล้วลองอีกครั้ง', 409);
  }
  if (oldKey) await slips.prepare('DELETE FROM bill_slips WHERE key=?').bind(oldKey).run().catch(console.error);
  return json({ ok: true });
 }
 if (!admin) return fail('กรุณาเข้าสู่ระบบผู้จัด', 401);
 const input = await readLimitedJson(req);
 if (action === 'edit') {
  if (bill.payers.some(p => p.submittedAt)) return fail('มีผู้ส่งสลิปแล้ว จึงแก้ยอดหรือรายชื่อไม่ได้', 409);
  const draft = input && readDraft({ ...input, date: bill.session_date });
  if (!draft || input.revision !== bill.revision) return fail('ข้อมูลบิลไม่ถูกต้องหรือเปลี่ยนแล้ว กรุณาโหลดใหม่', 409);
  return await updateBill(db, bill, splitBill(draft, bill.payers)) ? json({ ok: true }) : fail('บิลเปลี่ยนแล้ว กรุณาโหลดใหม่', 409);
 }
 if (action === 'review') {
  const target = bill.payers.find(p => p.id === input?.payer);
  if (!target || target.status !== 'review' || !target.slipKey || target.slipKey.split('/').at(-1) !== input.receiptId)
   return fail('สลิปนี้เปลี่ยนแล้ว กรุณาโหลดใหม่', 409);
  if (!['paid', 'rejected'].includes(input.status)) return fail('สถานะไม่ถูกต้อง');
  const note = clean(input.note);
  if (input.status === 'rejected' && (!note || note.length > 240)) return fail('กรุณาใส่เหตุผลไม่เกิน 240 ตัวอักษร');
  target.status = input.status;
  target.note = input.status === 'rejected' ? note : '';
  target.paidAt = input.status === 'paid' ? Date.now() : null;
  return await updateBill(db, bill, payload) ? json({ ok: true }) : fail('บิลเปลี่ยนแล้ว กรุณาโหลดใหม่', 409);
 }
 return fail('ไม่พบคำสั่ง');
}

export async function billingLineText(env, scope, origin) {
 if (!env.DB) return 'ระบบบิลยังไม่พร้อม';
 await prepare(env.DB);
 const query = 'SELECT * FROM bills WHERE closed_at IS NULL';
 const clubs = scope === 'all' ? ['sena', '88'] : [scope];
 const limit = scope === 'all' ? 3 : 5;
 const groups = await Promise.all(clubs.map(club =>
  env.DB.prepare(query + ' AND club=? ORDER BY session_date LIMIT ?').bind(club, limit + 1).all()));
 const rows = groups.flatMap(({ results }) => results.slice(0, limit))
  .sort((a, b) => a.session_date.localeCompare(b.session_date));
 const label = scope === 'all' ? 'ทุกสนาม' : clubName(scope);
 if (!rows.length) return '✅ ไม่มีบิลค้าง · ' + label;
 const blocks = rows.map(row => {
  const bill = { ...row, ...JSON.parse(row.payload) };
  const pending = bill.payers.filter(p => p.status !== 'paid');
  const unpaid = pending.filter(p => p.status !== 'review');
  const reviewing = pending.filter(p => p.status === 'review');
  const entries = unpaid.slice(0, 8).map(p => '• ' + p.name + ' ' + money(p.amount) + ' บ.');
  return [
   clubName(bill.club) + ' · ' + displayDate(bill.session_date) + ' · ค้าง ' + money(outstanding(bill)) + ' บ.',
   ...entries, ...(unpaid.length > 8 ? ['… ยังไม่จ่ายอีก ' + (unpaid.length - 8) + ' คน'] : []),
   ...(reviewing.length ? ['รอตรวจสลิป ' + reviewing.length + ' คน'] : []), billLink(origin, bill)
  ].join('\n');
 });
 const more = groups.some(({ results }) => results.length > limit);
 return ['💸 บิลค้าง · ' + label, ...blocks, ...(more ? [`แสดง ${limit} บิลเก่าสุดต่อสนาม · ดูบิลอื่นกับผู้จัด`] : [])].join('\n\n');
}

export async function prunePaidSlips(env) {
 if (!env.DB || !env.SLIPS_DB) return;
 await prepare(env.DB);
 const { results } = await env.DB.prepare('SELECT id, revision FROM bills WHERE closed_at<=? AND slips_removed=0 ORDER BY closed_at LIMIT 10')
  .bind(Date.now() - 30 * day).all();
 if (!results.length) return;
 await prepareSlips(env.SLIPS_DB);
 for (const { id, revision } of results) {
  await env.SLIPS_DB.prepare('DELETE FROM bill_slips WHERE bill_id=?').bind(id).run();
  await env.DB.prepare('UPDATE bills SET slips_removed=1 WHERE id=? AND revision=?').bind(id, revision).run();
 }
}
