import { logError } from './log.js';

// AI-assisted slip checking. Everything here is advisory: it never changes a
// payment status, and billing.js treats it as removable (see the design spec).

const THAI_MONTHS = [
  ['มกราคม', 'มค'],
  ['กุมภาพันธ์', 'กพ'],
  ['มีนาคม', 'มีค'],
  ['เมษายน', 'เมย'],
  ['พฤษภาคม', 'พค'],
  ['มิถุนายน', 'มิย'],
  ['กรกฎาคม', 'กค'],
  ['สิงหาคม', 'สค'],
  ['กันยายน', 'กย'],
  ['ตุลาคม', 'ตค'],
  ['พฤศจิกายน', 'พย'],
  ['ธันวาคม', 'ธค'],
];
const thaiMonth = new Map(THAI_MONTHS.flatMap((names, i) => names.map(name => [name, i + 1])));
const ENGLISH_MONTHS = [
  'jan',
  'feb',
  'mar',
  'apr',
  'may',
  'jun',
  'jul',
  'aug',
  'sep',
  'oct',
  'nov',
  'dec',
];

function buildDate(day, month, year, now) {
  if (!(month >= 1 && month <= 12 && day >= 1 && day <= 31)) return null;
  const nowYear = now.getUTCFullYear();
  if (year < nowYear - 2 || year > nowYear + 1) return null;
  const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const parsed = new Date(iso + 'T00:00:00Z');
  return Number.isFinite(+parsed) && parsed.toISOString().slice(0, 10) === iso ? iso : null;
}

// Returns 'YYYY-MM-DD' (Gregorian) or null. Thai month names mean a Buddhist-era
// year, English month names a Gregorian one; two-digit years follow that rule.
export function parseSlipDate(text, now = new Date()) {
  if (typeof text !== 'string') return null;
  const numeric = text.match(/(\d{1,2})\s*[/.-]\s*(\d{1,2})\s*[/.-]\s*(\d{2,4})/);
  if (numeric) {
    let year = Number(numeric[3]);
    if (year > 2400) year -= 543;
    else if (year < 100) year += 2000;
    return buildDate(Number(numeric[1]), Number(numeric[2]), year, now);
  }
  const named = text.match(/(\d{1,2})\s+([^\d\s,]+)\s+(\d{2,4})/);
  if (!named) return null;
  const word = named[2].replaceAll('.', '');
  let year = Number(named[3]);
  let month = thaiMonth.get(word);
  if (month) {
    if (year < 100) year += 2500;
    if (year > 2400) year -= 543;
  } else {
    month = ENGLISH_MONTHS.indexOf(word.slice(0, 3).toLowerCase()) + 1;
    if (year < 100) year += 2000;
  }
  return buildDate(Number(named[1]), month, year, now);
}

// Bank references are read by a model, so look-alike characters get merged
// before comparing (SCB references contain I, l and 1 side by side).
export const normalizeRef = ref =>
  String(ref ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .replace(/[li]/g, '1')
    .replace(/o/g, '0');

export const isUsableRef = norm => norm.length >= 10 && new Set(norm).size > 1;

const MAX_AMOUNT_SATANG = 1_000_000 * 100;
const text = (value, max) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= max ? trimmed : null;
};

// The model's JSON is untrusted input: anything that does not look right
// becomes null, which the verdict treats as "unreadable", never as a guess.
export function validateReading(raw) {
  const obj = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const parsed =
    typeof obj.amount === 'number'
      ? obj.amount
      : typeof obj.amount === 'string' && /^[\d,]+(\.\d+)?$/.test(obj.amount.trim())
        ? Number(obj.amount.replaceAll(',', ''))
        : NaN;
  const satang = Math.round(parsed * 100);
  return {
    isSlip: obj.is_transfer_slip === true || obj.is_transfer_slip === 'true',
    amountSatang: satang > 0 && satang <= MAX_AMOUNT_SATANG ? satang : null,
    dateText: text(obj.date_text, 60),
    ref: text(obj.ref, 64),
  };
}

export function judgeSlip(reading, { amountSatang, billDate, duplicate, now = new Date() }) {
  if (!reading.isSlip)
    return [{ code: 'unreadable', why: reading.unparsed ? 'unparsed' : 'not_slip' }];
  if (reading.amountSatang == null) return [{ code: 'unreadable', why: 'amount' }];
  const reasons = [];
  if (reading.amountSatang !== amountSatang)
    reasons.push({
      code: 'amount_mismatch',
      slipSatang: reading.amountSatang,
      billSatang: amountSatang,
    });
  const slipDate = parseSlipDate(reading.dateText, now);
  if (!slipDate) reasons.push({ code: 'date_unreadable' });
  else if (slipDate < billDate) reasons.push({ code: 'old_date', slipDate, billDate });
  if (duplicate)
    reasons.push({
      code: 'duplicate_ref',
      billDate: duplicate.billDate,
      payerName: duplicate.payerName,
    });
  return reasons.length ? reasons : [{ code: 'ok' }];
}

export const DEFAULT_MODEL = '@cf/meta/llama-4-scout-17b-16e-instruct';

export const slipAiEnabled = env =>
  env?.SLIP_AI_ENABLED === 'true' && Boolean(env.AI) && Boolean(env.DB);

const PROMPT = [
  'You read Thai bank transfer slips. Look at the image and answer with ONE JSON object only, no markdown, no extra text:',
  '{"is_transfer_slip": true|false, "amount": number|null, "date_text": string|null, "ref": string|null}',
  '- amount: the transferred amount as a plain number in baht (e.g. 1000.00), not the fee.',
  '- date_text: the date exactly as printed on the slip, copied character by character (keep Thai month names and the year digits as printed).',
  '- ref: the transaction reference number (หมายเลขอ้างอิง / รหัสอ้างอิง / เลขที่รายการ / Ref No.). If there are several, choose the longest one. Copy it exactly.',
  'If a value is unreadable use null. If the image is not a transfer slip set is_transfer_slip to false.',
].join('\n');

function toBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

// Workers AI answers either {response: object|string} or an OpenAI-style
// {choices:[{message:{content}}]} depending on the model; accept both.
function replyOf(output) {
  const raw = output?.response ?? output?.choices?.[0]?.message?.content;
  if (raw && typeof raw === 'object') return raw;
  const match = typeof raw === 'string' ? raw.match(/\{[\s\S]*\}/) : null;
  try {
    return match ? JSON.parse(match[0]) : null;
  } catch {
    return null;
  }
}

// Throws when the AI call itself fails; a reply that cannot be understood is
// returned as "not a slip" instead.
export async function readSlip(env, bytes, contentType) {
  const output = await env.AI.run(env.SLIP_AI_MODEL || DEFAULT_MODEL, {
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: PROMPT },
          {
            type: 'image_url',
            image_url: { url: `data:${contentType};base64,${toBase64(bytes)}` },
          },
        ],
      },
    ],
    max_tokens: 300,
    temperature: 0,
  });
  const reply = replyOf(output);
  const reading = validateReading(reply);
  // A reply we could not parse says nothing about the picture: keep that apart from "not a slip".
  return reply ? reading : { ...reading, unparsed: true };
}

// ---- storage: derived data in its own table, never in the bill payload ----
const KEEP_DAYS = 180;
async function ensureTable(db) {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS slip_checks (
  slip_key TEXT PRIMARY KEY, club TEXT NOT NULL, bill_id TEXT NOT NULL, payer_id TEXT NOT NULL,
  state TEXT NOT NULL, labels TEXT, read_amount INTEGER, read_date TEXT, read_ref TEXT,
  ref_norm TEXT, model TEXT, checked_at INTEGER)`,
    )
    .run();
  await db
    .prepare('CREATE INDEX IF NOT EXISTS slip_checks_ref_norm ON slip_checks (ref_norm)')
    .run();
}

async function findDuplicate(db, { norm, billId, payerId, slipKey }) {
  const hit = await db
    .prepare(
      'SELECT bill_id, payer_id FROM slip_checks WHERE ref_norm=? AND slip_key<>? AND NOT (bill_id=? AND payer_id=?) LIMIT 1',
    )
    .bind(norm, slipKey, billId, payerId)
    .first();
  if (!hit) return null;
  const bill = await db
    .prepare('SELECT session_date, payload FROM bills WHERE id=?')
    .bind(hit.bill_id)
    .first();
  const name = bill && JSON.parse(bill.payload).payers?.find(p => p.id === hit.payer_id)?.name;
  return { billDate: bill ? bill.session_date.slice(0, 10) : '', payerName: name || 'ผู้เล่นอื่น' };
}

// Never throws: a failed check must not affect the upload that triggered it.
export async function checkSlip(
  env,
  { bill, payer, slipKey, bytes, contentType, now = new Date() },
) {
  const db = env.DB;
  const save = (state, f = {}) =>
    db
      .prepare(
        'INSERT OR REPLACE INTO slip_checks (slip_key,club,bill_id,payer_id,state,labels,read_amount,read_date,read_ref,ref_norm,model,checked_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
      )
      .bind(
        slipKey,
        bill.club,
        bill.id,
        payer.id,
        state,
        f.labels ? JSON.stringify(f.labels) : null,
        f.amount ?? null,
        f.date ?? null,
        f.ref ?? null,
        f.norm ?? null,
        f.model ?? null,
        now.getTime(),
      )
      .run();
  try {
    await ensureTable(db);
    await save('pending');
    const reading = await readSlip(env, bytes, contentType);
    const norm = normalizeRef(reading.ref);
    const duplicate = isUsableRef(norm)
      ? await findDuplicate(db, { norm, billId: bill.id, payerId: payer.id, slipKey })
      : null;
    const reasons = judgeSlip(reading, {
      amountSatang: payer.amount, // bills store satang
      billDate: bill.session_date.slice(0, 10),
      duplicate,
      now,
    });
    await save('done', {
      labels: reasons,
      amount: reading.amountSatang,
      date: parseSlipDate(reading.dateText, now),
      ref: reading.ref,
      norm,
      model: env.SLIP_AI_MODEL || DEFAULT_MODEL,
    });
  } catch (error) {
    logError('slip-check', error);
    await save('error').catch(inner => logError('slip-check:save-error', inner));
  }
}

export async function slipChecksFor(db, slipKeys) {
  const found = new Map();
  if (!slipKeys.length) return found;
  await ensureTable(db);
  for (let i = 0; i < slipKeys.length; i += 50) {
    const keys = slipKeys.slice(i, i + 50);
    const rows = await db
      .prepare(`SELECT * FROM slip_checks WHERE slip_key IN (${keys.map(() => '?').join(',')})`)
      .bind(...keys)
      .all();
    for (const r of rows.results)
      found.set(r.slip_key, {
        state: r.state,
        reasons: r.labels ? JSON.parse(r.labels) : [],
        readAmount: r.read_amount,
        readDate: r.read_date,
        checkedAt: r.checked_at,
      });
  }
  return found;
}

export async function pruneSlipChecks(env, now = Date.now()) {
  if (!env.DB) return;
  await ensureTable(env.DB);
  await env.DB.prepare('DELETE FROM slip_checks WHERE checked_at<?')
    .bind(now - KEEP_DAYS * 86400000)
    .run();
}
