import { clubOf, CLUB_IDS } from './clubs.js';
import { logError } from './log.js';
import {
  groupMentionTarget,
  mentionNameRisk,
  planMentionMessages,
  mentionGroupMessage,
} from './line-mentions.js';
import { memberMode, memberFor, liffUrl, prepareMembers } from './member.js';
import qrcode from 'qrcode-generator';
import { slipAiEnabled, checkSlip, slipChecksFor } from './slip-check.js';

const day = 86400000;
const maxSlipBytes = 1024 * 1024;
const maxStoredSlipBytes = 250 * 1000 * 1000;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const idPattern = /^[a-f0-9]{32}$/;
const tokenPattern = /^[a-f0-9]{64}$/;
const promptPayPattern = /^[0-9]{10}$|^[0-9]{13}$/;
const clubName = club => clubOf(club).label;
const money = cents => (cents / 100).toLocaleString('th-TH', { maximumFractionDigits: 2 });
const clean = value => (typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '');
const json = (value, status = 200) =>
  Response.json(value, {
    status,
    headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' },
  });
const fail = (message, status = 400) => json({ error: message }, status);
const randomId = () => crypto.randomUUID().replaceAll('-', '');
const token = () => randomId() + randomId();
// Encode all 128 bits of the existing bill ID; no lookup table or truncation.
const billCode = id =>
  btoa(String.fromCharCode(...id.match(/../g).map(byte => parseInt(byte, 16))))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
const billLink = (origin, bill) => new URL('/b/' + billCode(bill.id), origin).href;
export function billIdFromCode(code) {
  if (!/^[A-Za-z0-9_-]{22}$/.test(code)) return null;
  const id = Array.from(atob(code.replaceAll('-', '+').replaceAll('_', '/') + '=='), byte =>
    byte.charCodeAt(0).toString(16).padStart(2, '0'),
  ).join('');
  return billCode(id) === code ? id : null;
}
// Keep the first bill's date key intact; supplemental bills append a unique suffix.
const billDate = bill => bill.session_date.slice(0, 10);
const displayDate = date =>
  new Intl.DateTimeFormat('th-TH', {
    dateStyle: 'medium',
    timeZone: 'Asia/Bangkok',
  }).format(new Date(date + 'T12:00:00+07:00'));

export function promptPayPayload(number, amount) {
  if (!/^(?:0[0-9]{9}|[0-9]{13})$/.test(number) || !Number.isSafeInteger(amount) || amount <= 0)
    return null;
  const field = (id, value) => id + String(value.length).padStart(2, '0') + value;
  const account =
    field('00', 'A000000677010111') +
    (number.length === 10 ? field('01', '0066' + number.slice(1)) : field('02', number));
  const payload =
    field('00', '01') +
    field('01', '12') +
    field('29', account) +
    field('53', '764') +
    field('54', (amount / 100).toFixed(2)) +
    field('58', 'TH') +
    '6304';
  let crc = 0xffff;
  for (const c of payload) {
    crc ^= c.charCodeAt(0) << 8;
    for (let bit = 0; bit < 8; bit++) crc = ((crc << 1) ^ (crc & 0x8000 ? 0x1021 : 0)) & 0xffff;
  }
  return payload + crc.toString(16).padStart(4, '0').toUpperCase();
}

async function prepare(db) {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS bills (
  id TEXT PRIMARY KEY, club TEXT NOT NULL, session_date TEXT NOT NULL,
  revision INTEGER NOT NULL, payload TEXT NOT NULL, closed_at INTEGER,
  slips_removed INTEGER NOT NULL DEFAULT 0, UNIQUE (club, session_date)
 )`,
    )
    .run();
}
async function prepareSlips(db) {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS bill_slips (
  key TEXT PRIMARY KEY, bill_id TEXT NOT NULL, content_type TEXT NOT NULL,
  bytes INTEGER NOT NULL, body BLOB NOT NULL
 )`,
    )
    .run();
  await db.prepare('CREATE INDEX IF NOT EXISTS bill_slips_bill_id ON bill_slips (bill_id)').run();
}
async function readBill(db, id) {
  const row = await db.prepare('SELECT * FROM bills WHERE id=?').bind(id).first();
  return row ? { ...row, ...JSON.parse(row.payload) } : null;
}
async function promptPaySettings(db) {
  await db
    .prepare(
      'CREATE TABLE IF NOT EXISTS billing_settings (id INTEGER PRIMARY KEY CHECK(id=1), promptpay TEXT NOT NULL)',
    )
    .run();
  return await db.prepare('SELECT promptpay FROM billing_settings WHERE id=1').first();
}
async function updateBill(db, bill, payload) {
  const result = await db
    .prepare(
      'UPDATE bills SET payload=?, revision=revision+1, closed_at=? WHERE id=? AND revision=?',
    )
    .bind(
      JSON.stringify(payload),
      payload.payers.every(p => p.status === 'paid') ? (bill.closed_at ?? Date.now()) : null,
      bill.id,
      bill.revision,
    )
    .run();
  return Boolean(result.meta.changes);
}
const paidCount = bill => bill.payers.filter(p => p.status === 'paid').length;
const outstanding = bill =>
  bill.payers.reduce((total, p) => total + (p.status === 'paid' ? 0 : p.amount), 0);
function summary(bill) {
  return {
    id: bill.id,
    club: bill.club,
    date: billDate(bill),
    total: bill.total,
    additional: bill.session_date.length > 10,
    collection: bill.payers.reduce((total, p) => total + p.amount, 0),
    count: bill.payers.length,
    paid: paidCount(bill),
    outstanding: outstanding(bill),
    cancelled: Boolean(bill.cancelled),
  };
}
function paymentView(p, privateView, admin, slipsRemoved) {
  const { id, name, amount, status, shares, note, paidAt, slipKey } = p;
  return {
    id,
    name,
    amount,
    status,
    shares: shares.length,
    ...(p.method ? { method: p.method } : {}),
    ...(privateView
      ? { names: shares.map(x => x.name), note, paidAt, hasSlip: Boolean(slipKey) && !slipsRemoved }
      : {}),
    ...(admin
      ? {
          token: p.token,
          payerKey: p.payerKey,
          receiptId: p.slipKey?.split('/').at(-1),
          withdrawals: shares
            .filter(s => s.withdrawnAt)
            .map(({ name, withdrawnAt, lateCancellation }) => ({
              name,
              withdrawnAt,
              lateCancellation,
            })),
        }
      : {}),
  };
}
function billView(bill, admin, payer) {
  return {
    ...summary(bill),
    court: bill.court,
    shuttle: bill.shuttle,
    people: bill.people,
    ...(admin || (!bill.cancelled && (payer || promptPayPattern.test(bill.transfer)))
      ? { transfer: bill.transfer }
      : {}),
    ...(admin
      ? {
          revision: bill.revision,
          editable: !bill.cancelled && !bill.payers.some(p => p.submittedAt || p.status === 'paid'),
          canUndoCash: !bill.cancelled && !bill.slips_removed,
        }
      : {}),
    payers: (payer ? [payer] : bill.payers).map(p =>
      paymentView(p, admin || Boolean(payer), admin, bill.slips_removed),
    ),
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
  if (
    !validDate(date) ||
    ![court, shuttle].every(n => Number.isSafeInteger(n) && n >= 0 && n <= 100000000) ||
    court + shuttle < 1 ||
    !promptPayPattern.test(transfer) ||
    !Array.isArray(attendees) ||
    !attendees.length ||
    attendees.length > 200 ||
    court + shuttle < attendees.length
  )
    return null;
  const people = [];
  const keys = new Set();
  for (const item of attendees) {
    const name = clean(item?.name),
      payer = clean(item?.payer),
      payerKey = clean(item?.payerKey);
    if (
      !name ||
      !payer ||
      !payerKey ||
      name.length > 100 ||
      payer.length > 100 ||
      payerKey.length > 220
    )
      return null;
    const key = payerKey + '\n' + name.normalize('NFC').toLowerCase();
    if (keys.has(key)) return null;
    keys.add(key);
    if (
      item.withdrawnAt !== undefined &&
      (typeof item.withdrawnAt !== 'string' ||
        !Number.isFinite(Date.parse(item.withdrawnAt)) ||
        typeof item.lateCancellation !== 'boolean')
    )
      return null;
    people.push({
      name,
      payer,
      payerKey,
      ...(item.withdrawnAt
        ? {
            withdrawnAt: new Date(item.withdrawnAt).toISOString(),
            lateCancellation: item.lateCancellation,
          }
        : {}),
    });
  }
  return { date, court, shuttle, transfer, people };
}
function splitBill(draft, existing = []) {
  const total = draft.court + draft.shuttle;
  const each = Math.floor(total / draft.people.length),
    remainder = total % draft.people.length;
  const byPayer = new Map();
  const previous = new Map(existing.map(p => [p.payerKey, p]));
  for (const [i, person] of draft.people.entries()) {
    let p = byPayer.get(person.payerKey);
    if (!p) {
      const old = previous.get(person.payerKey);
      p = {
        id: old?.id ?? randomId(),
        token: old?.token ?? token(),
        payerKey: person.payerKey,
        name: person.payer,
        shares: [],
        amount: 0,
        status: 'unpaid',
      };
      byPayer.set(person.payerKey, p);
    }
    const amount = each + Number(i < remainder);
    p.shares.push({
      name: person.name,
      amount,
      ...(person.withdrawnAt
        ? { withdrawnAt: person.withdrawnAt, lateCancellation: person.lateCancellation }
        : {}),
    });
  }
  for (const p of byPayer.values())
    p.amount = Math.ceil((total * p.shares.length) / (100 * draft.people.length)) * 100;
  return {
    court: draft.court,
    shuttle: draft.shuttle,
    total,
    transfer: draft.transfer,
    people: draft.people.length,
    payers: [...byPayer.values()],
  };
}
async function recentSessions(db, club) {
  if (
    !(await db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='booking_clubs'")
      .first())
  )
    return [];
  const doc = await db.prepare('SELECT payload FROM booking_clubs WHERE club=?').bind(club).first();
  if (!doc) return [];
  const table = clubOf(club).stateTable;
  const exists = await db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
    .bind(table)
    .first();
  const roster = exists
    ? await db.prepare(`SELECT payload FROM ${table} WHERE id=1`).first()
    : null;
  const players = new Map(
    (roster ? JSON.parse(roster.payload).players : []).map(p => [p.id, p.name]),
  );
  return JSON.parse(doc.payload)
    .sessions.filter(s => !s.skipped && (s.registrations.length || s.withdrawals?.length))
    .sort((a, b) => b.date.localeCompare(a.date))
    .map(s => {
      const attendees = s.registrations
        .map((r, i) => {
          const host = r.guest?.hostId || r.invitedBy || r.playerId,
            payer = players.get(host);
          return payer
            ? {
                name: r.guest?.name || players.get(r.playerId) || payer,
                payer,
                payerKey: 'member:' + host,
                guest: Boolean(r.guest),
                friend: Boolean(r.invitedBy),
                attended: i < s.capacity,
              }
            : null;
        })
        .filter(Boolean);
      const key = p => p.payerKey + '\n' + p.name.normalize('NFC').toLowerCase();
      const active = new Set(attendees.map(key)),
        activeMembers = new Set(s.registrations.filter(r => !r.guest).map(r => r.playerId)),
        activeGuests = new Set(
          s.registrations
            .filter(r => r.guest)
            .map(
              r => 'member:' + r.guest.hostId + '\n' + r.guest.name.normalize('NFC').toLowerCase(),
            ),
        ),
        withdrawals = new Map();
      for (const r of s.withdrawals ?? []) {
        const person = {
          name: r.name,
          payer: players.get(r.payerKey.slice('member:'.length)) || r.payer,
          payerKey: r.payerKey,
          guest: r.guest,
          friend: Boolean(r.invitedBy),
          attended: false,
          withdrawnAt: r.cancelledAt,
          lateCancellation: r.lateCancellation,
        };
        const identity = r.guest ? key(person) : r.playerId;
        if (
          !active.has(key(person)) &&
          !(r.guest ? activeGuests.has(key(person)) : activeMembers.has(r.playerId))
        )
          withdrawals.set(identity, person);
      }
      return {
        date: s.date,
        time: s.start + '–' + s.end,
        attendees,
        withdrawals: [...withdrawals.values()],
      };
    });
}
async function readLimitedJson(req) {
  const bytes = await readLimited(req, 128 * 1024);
  if (!bytes) return null;
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
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
      if (size > max) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}
function imageType(bytes) {
  if (bytes.length < 12) return null;
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((n, i) => bytes[i] === n)) return 'image/png';
  const text = new TextDecoder();
  if (text.decode(bytes.subarray(0, 4)) === 'RIFF' && text.decode(bytes.subarray(8, 12)) === 'WEBP')
    return 'image/webp';
  return null;
}

// Slip checks are best-effort extras: run them after the response when the
// runtime offers waitUntil, and never let them fail the request.
const background = (ctx, work) => (ctx?.waitUntil ? ctx.waitUntil(work) : void work);

export async function billingRoute(req, env, admin, club, ctx) {
  if (!env.DB) return fail('ระบบบิลยังไม่พร้อม', 503);
  const url = new URL(req.url),
    db = env.DB;
  const id = url.searchParams.get('bill');
  const action = url.searchParams.get('action');
  const supplied = req.headers.get('X-Bill-Token') || '';
  if (id && !idPattern.test(id)) return fail('ไม่พบบิล', 404);
  await prepare(db);
  if (!id) {
    if (!admin) return fail('กรุณาเข้าสู่ระบบผู้จัด', 401);
    if (req.method === 'GET') {
      const setting = await promptPaySettings(db);
      const promptpay = setting?.promptpay || env.BILL_PROMPTPAY || '';
      if (action === 'sessions') {
        const date = url.searchParams.get('date');
        const existing = validDate(date)
          ? await db
              .prepare('SELECT id FROM bills WHERE club=? AND session_date=?')
              .bind(club, date)
              .first()
          : null;
        return json({
          existing: existing?.id,
          sessions: await recentSessions(db, club),
          storageReady: Boolean(env.SLIPS_DB),
          promptpay,
        });
      }
      const rows = await db
        .prepare(
          "SELECT * FROM bills ORDER BY COALESCE(json_extract(payload, '$.cancelled'), 0), closed_at IS NOT NULL, session_date DESC LIMIT 200",
        )
        .all();
      return json({
        bills: rows.results.map(r => {
          const bill = { ...r, ...JSON.parse(r.payload) };
          return {
            ...summary(bill),
            revision: bill.revision,
            payers: bill.payers.map(p => ({
              id: p.id,
              ...(p.slipKey ? { receiptId: p.slipKey.split('/').at(-1) } : {}),
              name: p.name,
              amount: p.amount,
              status: p.status,
              ...(p.method ? { method: p.method } : {}),
              hasSlip: Boolean(p.slipKey),
            })),
          };
        }),
        storageReady: Boolean(env.SLIPS_DB),
        promptpay,
      });
    }
    if (req.method !== 'POST') return fail('Method not allowed', 405);
    const input = await readLimitedJson(req);
    if (action === 'promptpay') {
      if (!promptPayPattern.test(input?.promptpay || ''))
        return fail('กรุณาใส่เลขพร้อมเพย์ 10 หรือ 13 หลัก');
      await promptPaySettings(db);
      await db
        .prepare(
          'INSERT INTO billing_settings (id,promptpay) VALUES (1,?) ON CONFLICT(id) DO UPDATE SET promptpay=excluded.promptpay',
        )
        .bind(input.promptpay)
        .run();
      return json({ ok: true });
    }
    const draft = input && readDraft(input);
    if (!draft) return fail('กรุณาตรวจวันที่ ค่าใช้จ่าย บัญชีรับเงิน และรายชื่อผู้ตี');
    if (!env.SLIPS_DB) return fail('ยังไม่พร้อมรับสลิป กรุณาติดต่อผู้จัดระบบ', 503);
    const extra = input.additional;
    if (extra !== undefined) {
      if (typeof extra !== 'string' || !idPattern.test(extra))
        return fail('รหัสบิลเพิ่มเติมไม่ถูกต้อง');
      const first = await db
        .prepare('SELECT id FROM bills WHERE club=? AND session_date=?')
        .bind(club, draft.date)
        .first();
      if (!first) return fail('ยังไม่มีบิลเดิมในวันนี้ กรุณาเปิดบิลปกติ', 409);
    }
    const dateKey = extra ? draft.date + '/' + extra : draft.date;
    const billId = randomId();
    await db
      .prepare(
        'INSERT OR IGNORE INTO bills (id,club,session_date,revision,payload) VALUES (?,?,?,0,?)',
      )
      .bind(billId, club, dateKey, JSON.stringify(splitBill(draft)))
      .run();
    const existing = await db
      .prepare('SELECT id FROM bills WHERE club=? AND session_date=?')
      .bind(club, dateKey)
      .first();
    return json({ id: existing.id, existing: existing.id !== billId });
  }
  const bill = await readBill(db, id);
  if (!bill) return fail('ไม่พบบิล', 404);
  const member = memberMode(env) ? await memberFor(req, env, bill.club) : null;
  const owns = p =>
    member?.link?.status === 'approved' && p.payerKey === 'member:' + member.link.player_id;
  const payer = tokenPattern.test(supplied) ? bill.payers.find(p => p.token === supplied) : null;
  if (memberMode(env) && !admin && payer && !owns(payer))
    return fail('กรุณาเข้าสู่ระบบ LINE ของเจ้าของบิล', 403);
  if (supplied && !payer) return fail('ลิงก์ชำระเงินไม่ถูกต้อง', 403);
  if (req.method === 'GET') {
    if (action === 'qr') {
      const target = bill.payers.find(p => p.id === url.searchParams.get('payer'));
      if (!target || (payer && payer.id !== target.id)) return fail('ไม่พบชื่อผู้จ่าย', 404);
      if (bill.cancelled || !['unpaid', 'rejected'].includes(target.status))
        return fail('รายการนี้ไม่เปิดให้ชำระแล้ว', 409);
      if (url.searchParams.get('amount') !== String(target.amount))
        return fail('ยอดเปลี่ยนแล้ว กรุณาอัปเดตบิล', 409);
      const payload = promptPayPayload(bill.transfer, target.amount);
      if (!payload) return fail('สร้าง QR ไม่ได้ กรุณาตรวจเลขพร้อมเพย์กับผู้จัด');
      const qr = qrcode(0, 'M');
      qr.addData(payload);
      qr.make();
      return new Response(qr.createSvgTag(8, 32), {
        headers: {
          'Content-Type': 'image/svg+xml',
          'Cache-Control': 'private, no-store',
          'X-Content-Type-Options': 'nosniff',
        },
      });
    }
    if (action !== 'slip') {
      if (bill.cancelled && !admin) return json({ cancelled: true });
      const view = billView(bill, admin && !payer, payer);
      if (admin && !payer && !bill.slips_removed && slipAiEnabled(env)) {
        try {
          const checks = await slipChecksFor(db, bill.payers.map(p => p.slipKey).filter(Boolean));
          for (const p of view.payers) {
            const found = checks.get(bill.payers.find(x => x.id === p.id)?.slipKey);
            if (found) p.aiCheck = found;
          }
        } catch (error) {
          logError('billing:slip-checks', error);
        }
      }
      return json(view);
    }
    const target =
      payer || (admin ? bill.payers.find(p => p.id === url.searchParams.get('payer')) : null);
    if (!target) return fail('ไม่มีสิทธิ์ดูสลิป', 403);
    if (bill.slips_removed || !target.slipKey || !env.SLIPS_DB) return fail('ไม่พบสลิป', 404);
    const slip = await env.SLIPS_DB.prepare('SELECT content_type, body FROM bill_slips WHERE key=?')
      .bind(target.slipKey)
      .first();
    if (!slip) return fail('ไม่พบสลิป', 404);
    const type = slip.content_type;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(type))
      return fail('รูปแบบสลิปไม่ถูกต้อง', 415);
    return new Response(new Uint8Array(slip.body), {
      headers: {
        'Content-Type': type,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
      },
    });
  }
  if (req.method !== 'POST') return fail('Method not allowed', 405);
  const payload = JSON.parse(bill.payload);
  // A payer says they will pay in cash. Nothing is marked paid: the row waits
  // ("review", method cash, no slip) until the organizer confirms receipt.
  if (action === 'cash-request' || action === 'cash-cancel') {
    if (bill.cancelled) return fail('บิลนี้ถูกยกเลิกแล้ว', 409);
    const target = payload.payers.find(p => p.id === payer?.id);
    if (!target) return fail('กรุณาเปิดบิลจากลิงก์ชำระเงินของคุณ', 403);
    if (memberMode(env) && !admin && !owns(target))
      return fail('แจ้งจ่ายเงินสดได้เฉพาะบิลของตัวเอง กรุณาเข้าสู่ระบบ LINE', 403);
    if (action === 'cash-request') {
      if (!['unpaid', 'rejected'].includes(target.status) || target.slipKey)
        return fail('รายการนี้เปลี่ยนสถานะแล้ว กรุณาโหลดใหม่ หรือติดต่อผู้จัด', 409);
      Object.assign(target, {
        status: 'review',
        method: 'cash',
        note: '',
        submittedAt: Date.now(),
      });
    } else {
      if (target.status !== 'review' || target.method !== 'cash' || target.slipKey)
        return fail('รายการนี้เปลี่ยนสถานะแล้ว กรุณาโหลดใหม่', 409);
      Object.assign(target, { status: 'unpaid', method: null, submittedAt: null });
    }
    return (await updateBill(db, bill, payload))
      ? json({ ok: true })
      : fail('บิลเปลี่ยนแล้ว กรุณาโหลดใหม่', 409);
  }
  if (action === 'upload') {
    if (bill.cancelled) return fail('บิลนี้ถูกยกเลิกแล้ว', 409);
    const target = payload.payers.find(p => p.id === (payer?.id || url.searchParams.get('payer')));
    if (!target || (!payer && !promptPayPattern.test(bill.transfer)))
      return fail('กรุณาเลือกชื่อผู้จ่ายจากหน้าบิล', 403);
    if (!payer && url.searchParams.get('amount') !== String(target.amount))
      return fail('ยอดเปลี่ยนแล้ว กรุณาโหลดบิลใหม่', 409);
    if (memberMode(env) && !admin && !owns(target))
      return fail('แนบสลิปได้เฉพาะบิลของตัวเอง กรุณาเข้าสู่ระบบ LINE', 403);
    const slips = env.SLIPS_DB;
    if (!slips) return fail('ระบบรับสลิปยังไม่พร้อม', 503);
    if (!['unpaid', 'rejected'].includes(target.status)) return fail('รายการนี้ส่งสลิปแล้ว', 409);
    const bytes = await readLimited(req, maxSlipBytes);
    const type = bytes && imageType(bytes);
    if (!type) return fail('ใช้รูป JPG, PNG หรือ WebP ขนาดไม่เกิน 1 MB');
    const key = id + '/' + target.id + '/' + randomId();
    await prepareSlips(slips);
    const stored = await slips
      .prepare(
        `INSERT INTO bill_slips (key, bill_id, content_type, bytes, body)
   SELECT ?, ?, ?, ?, ? WHERE (SELECT COALESCE(SUM(bytes), 0) FROM bill_slips) + ? <= ?`,
      )
      .bind(key, id, type, bytes.length, bytes.buffer, bytes.length, maxStoredSlipBytes)
      .run();
    if (!stored.meta.changes) return fail('พื้นที่เก็บสลิปเต็ม กรุณาแจ้งผู้จัด', 507);
    const oldKey = target.slipKey,
      now = Date.now();
    Object.assign(target, {
      status: 'paid',
      method: 'transfer',
      slipKey: key,
      note: '',
      submittedAt: now,
      paidAt: now,
    });
    // A storage/DB error can be ambiguous. Only remove the new object after a
    // definite conflict, so a successfully attached receipt is never erased.
    if (!(await updateBill(db, bill, payload))) {
      await slips.prepare('DELETE FROM bill_slips WHERE key=?').bind(key).run();
      return fail('บิลมีการเปลี่ยนแปลง กรุณาโหลดใหม่แล้วลองอีกครั้ง', 409);
    }
    if (slipAiEnabled(env)) {
      background(
        ctx,
        checkSlip(env, { bill, payer: target, slipKey: key, bytes, contentType: type }),
      );
      if (oldKey)
        await env.DB.prepare('DELETE FROM slip_checks WHERE slip_key=?')
          .bind(oldKey)
          .run()
          .catch(error => logError('billing:delete-old-slip-check', error));
    }
    if (oldKey)
      await slips
        .prepare('DELETE FROM bill_slips WHERE key=?')
        .bind(oldKey)
        .run()
        .catch(error => logError('billing:delete-old-slip', error));
    return json({ ok: true });
  }
  if (!admin) return fail('กรุณาเข้าสู่ระบบผู้จัด', 401);
  const input = await readLimitedJson(req);
  if (action === 'slip-check') {
    if (!slipAiEnabled(env)) return fail('ยังไม่เปิดใช้การตรวจสลิปด้วย AI', 503);
    const target = payload.payers.find(p => p.id === input?.payer);
    const stored =
      target?.slipKey && !bill.slips_removed && env.SLIPS_DB
        ? await env.SLIPS_DB.prepare('SELECT content_type, body FROM bill_slips WHERE key=?')
            .bind(target.slipKey)
            .first()
        : null;
    if (!stored) return fail('ไม่พบสลิป', 404);
    await checkSlip(env, {
      bill,
      payer: target,
      slipKey: target.slipKey,
      bytes: new Uint8Array(stored.body),
      contentType: stored.content_type,
    });
    return json({ ok: true });
  }
  if (action === 'cancel' || action === 'restore') {
    if (input?.revision !== bill.revision) return fail('บิลเปลี่ยนแล้ว กรุณาโหลดใหม่', 409);
    payload.cancelled = action === 'cancel';
    return (await updateBill(db, bill, payload))
      ? json({ ok: true })
      : fail('บิลเปลี่ยนแล้ว กรุณาโหลดใหม่', 409);
  }
  if (bill.cancelled) return fail('กรุณาเปิดบิลอีกครั้งก่อนแก้ไข', 409);
  if (action === 'cash') {
    const target = payload.payers.find(p => p.id === input?.payer);
    if (!target || input.revision !== bill.revision || typeof input.received !== 'boolean')
      return fail('ข้อมูลบิลเปลี่ยนแล้ว กรุณาโหลดใหม่', 409);
    const declaredCash = target.status === 'review' && target.method === 'cash' && !target.slipKey;
    if (input.received && (['unpaid', 'rejected'].includes(target.status) || declaredCash)) {
      Object.assign(target, { status: 'paid', method: 'cash', paidAt: Date.now() });
    } else if (!input.received && declaredCash) {
      Object.assign(target, { status: 'unpaid', method: null, submittedAt: null });
    } else if (
      !input.received &&
      !bill.slips_removed &&
      target.status === 'paid' &&
      target.method === 'cash'
    ) {
      Object.assign(target, {
        status: target.slipKey ? 'rejected' : 'unpaid',
        method: null,
        paidAt: null,
      });
    } else return fail('สถานะการชำระเปลี่ยนแล้ว กรุณาโหลดใหม่', 409);
    return (await updateBill(db, bill, payload))
      ? json({ ok: true })
      : fail('บิลเปลี่ยนแล้ว กรุณาโหลดใหม่', 409);
  }
  if (action === 'edit') {
    if (bill.payers.some(p => p.submittedAt || p.status === 'paid')) {
      if (input?.revision !== bill.revision || !promptPayPattern.test(input?.transfer || ''))
        return fail('กรุณาตรวจเลขพร้อมเพย์และโหลดบิลใหม่', 409);
      if ('court' in input || 'shuttle' in input || 'attendees' in input)
        return fail('มีการชำระแล้ว จึงแก้ได้เฉพาะเลขพร้อมเพย์', 409);
      payload.transfer = input.transfer;
      return (await updateBill(db, bill, payload))
        ? json({ ok: true })
        : fail('บิลเปลี่ยนแล้ว กรุณาโหลดใหม่', 409);
    }
    const draft = input && readDraft({ ...input, date: billDate(bill) });
    if (!draft || input.revision !== bill.revision)
      return fail('ข้อมูลบิลไม่ถูกต้องหรือเปลี่ยนแล้ว กรุณาโหลดใหม่', 409);
    return (await updateBill(db, bill, splitBill(draft, bill.payers)))
      ? json({ ok: true })
      : fail('บิลเปลี่ยนแล้ว กรุณาโหลดใหม่', 409);
  }
  if (action === 'review') {
    const target = payload.payers.find(p => p.id === input?.payer);
    if (
      !target ||
      (target.status !== 'review' &&
        !(target.status === 'paid' && target.method !== 'cash' && input.status === 'rejected')) ||
      bill.slips_removed ||
      !target.slipKey ||
      target.slipKey.split('/').at(-1) !== input.receiptId
    )
      return fail('สลิปนี้เปลี่ยนแล้ว กรุณาโหลดใหม่', 409);
    if (!['paid', 'rejected'].includes(input.status)) return fail('สถานะไม่ถูกต้อง');
    const note = clean(input.note);
    if (input.status === 'rejected' && (!note || note.length > 240))
      return fail('กรุณาใส่เหตุผลไม่เกิน 240 ตัวอักษร');
    target.status = input.status;
    target.method = input.status === 'paid' ? 'transfer' : null;
    target.note = input.status === 'rejected' ? note : '';
    target.paidAt = input.status === 'paid' ? Date.now() : null;
    return (await updateBill(db, bill, payload))
      ? json({ ok: true })
      : fail('บิลเปลี่ยนแล้ว กรุณาโหลดใหม่', 409);
  }
  return fail('ไม่พบคำสั่ง');
}

export async function billingLineText(env, scope, origin) {
  if (!env.DB) return 'ระบบบิลยังไม่พร้อม';
  await prepare(env.DB);
  const query =
    "SELECT * FROM bills WHERE closed_at IS NULL AND COALESCE(json_extract(payload, '$.cancelled'), 0)=0";
  const clubs = scope === 'all' ? CLUB_IDS : [scope];
  const limit = scope === 'all' ? 3 : 5;
  const groups = await Promise.all(
    clubs.map(club =>
      env.DB.prepare(query + ' AND club=? ORDER BY session_date LIMIT ?')
        .bind(club, limit + 1)
        .all(),
    ),
  );
  const rows = groups
    .flatMap(({ results }) => results.slice(0, limit))
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
      clubName(bill.club) +
        ' · ' +
        displayDate(billDate(bill)) +
        (bill.session_date.length > 10 ? ' · บิลเพิ่มเติม' : '') +
        ' · ค้าง ' +
        money(outstanding(bill)) +
        ' บ.',
      ...entries,
      ...(unpaid.length > 8 ? ['… ยังไม่จ่ายอีก ' + (unpaid.length - 8) + ' คน'] : []),
      ...(reviewing.length ? ['รอตรวจสลิป/เงินสด ' + reviewing.length + ' คน'] : []),
      'ชำระเงินผ่านลิงก์ด้านล่าง 👇',
      billLink(origin, bill),
    ].join('\n');
  });
  const more = groups.some(({ results }) => results.length > limit);
  return [
    '💸 บิลค้าง · ' + label,
    ...blocks,
    ...(more ? [`แสดง ${limit} บิลเก่าสุดต่อสนาม · ดูบิลอื่นกับผู้จัด`] : []),
  ].join('\n\n');
}

export async function prunePaidSlips(env) {
  if (!env.DB || !env.SLIPS_DB) return;
  await prepare(env.DB);
  const { results } = await env.DB.prepare(
    'SELECT id, revision, slips_removed FROM bills WHERE closed_at<=? AND slips_removed<>1 ORDER BY closed_at LIMIT 10',
  )
    .bind(Date.now() - 30 * day)
    .all();
  if (!results.length) return;
  await prepareSlips(env.SLIPS_DB);
  for (const { id, revision, slips_removed } of results) {
    if (!slips_removed) {
      const claim = await env.DB.prepare(
        'UPDATE bills SET slips_removed=2, revision=revision+1 WHERE id=? AND revision=? AND slips_removed=0',
      )
        .bind(id, revision)
        .run();
      if (!claim.meta.changes) continue;
    }
    await env.SLIPS_DB.prepare('DELETE FROM bill_slips WHERE bill_id=?').bind(id).run();
    await env.DB.prepare('UPDATE bills SET slips_removed=1 WHERE id=? AND slips_removed=2')
      .bind(id)
      .run();
  }
}

// No private payer tokens are placed in group messages. The LIFF destination
// resolves the signed-in account to its own payer after authentication.
export async function billingLineMessages(
  env,
  scope,
  origin,
  groupId,
  diagnostics = [],
  { tagsFrom = null } = {},
) {
  if (!memberMode(env) || !env.LINE_LIFF_ID) return null;
  await prepare(env.DB);
  await prepareMembers(env.DB);
  const clubs = scope === 'all' ? CLUB_IDS : [scope],
    limit = scope === 'all' ? 3 : 5;
  const groups = await Promise.all(
    clubs.map(club =>
      env.DB.prepare(
        "SELECT * FROM bills WHERE closed_at IS NULL AND COALESCE(json_extract(payload,'$.cancelled'),0)=0 AND club=? ORDER BY session_date LIMIT ?",
      )
        .bind(club, limit + 1)
        .all(),
    ),
  );
  const rows = groups
    .flatMap(g => g.results.slice(0, limit))
    .sort((a, b) => a.session_date.localeCompare(b.session_date));
  if (!rows.length)
    return [
      {
        type: 'text',
        text: '✅ ไม่มีบิลค้าง · ' + (scope === 'all' ? 'ทุกสนาม' : clubName(scope)),
      },
    ];
  // The summary is plain text and lists everyone. Tags follow in grouped messages
  // (see planMentionMessages for the layout rules); what does not fit in the
  // 5-message reply is offered as a "tag the rest" quick-reply button.
  const messages = [],
    membership = new Map(),
    owed = new Map();
  let text = '';
  const flush = () => {
    if (text) messages.push({ type: 'text', text });
    text = '';
  };
  const append = line => {
    if (text && text.length + line.length + 1 > 4500) flush();
    text += (text ? '\n' : '') + line;
  };
  append('💸 บิลค้าง · ' + (scope === 'all' ? 'ทุกสนาม' : clubName(scope)));
  for (const row of rows) {
    const bill = { ...row, ...JSON.parse(row.payload) },
      pending = bill.payers.filter(p => p.status !== 'paid'),
      unpaid = pending.filter(p => p.status !== 'review');
    const entries = await Promise.all(
      unpaid.map(async p => {
        const link = await env.DB.prepare(
          "SELECT user_id FROM member_links WHERE club=? AND player_id=? AND status='approved'",
        )
          .bind(bill.club, p.payerKey?.startsWith('member:') ? p.payerKey.slice(7) : '')
          .first();
        if (!link) {
          const reason = p.payerKey?.startsWith('member:') ? 'not_linked' : 'legacy_payer_key';
          diagnostics.push({ name: p.name, reason });
          return { p, reason };
        }
        if (!membership.has(link.user_id))
          membership.set(link.user_id, groupMentionTarget(env, groupId, link.user_id));
        const result = await membership.get(link.user_id),
          { userId, displayName, ...evidence } = result;
        diagnostics.push({ name: p.name, ...evidence });
        return { p, ...result };
      }),
    );
    append(
      '\n' +
        clubName(bill.club) +
        ' · ' +
        displayDate(billDate(bill)) +
        (bill.session_date.length > 10 ? ' · บิลเพิ่มเติม' : '') +
        ' · ค้าง ' +
        money(outstanding(bill)) +
        ' บ.',
    );
    for (const { p, userId, displayName, reason } of entries) {
      if (userId) {
        const seen = owed.get(userId);
        owed.set(userId, {
          amount: (seen?.amount || 0) + p.amount,
          risk: seen?.risk ?? mentionNameRisk(displayName),
        });
        append('• ' + p.name + ' ' + money(p.amount) + ' บ.');
      } else
        append(
          '• ' +
            p.name +
            ' ' +
            money(p.amount) +
            ' บ. · แท็กไม่สำเร็จ: ' +
            ({
              not_linked: 'ยังไม่ผูกบัญชี LINE',
              legacy_payer_key: 'บิลยังไม่อ้างอิงสมาชิก',
              not_in_group_or_provider_mismatch: 'ไม่พบสมาชิกในกลุ่มปลายทาง',
            }[reason] || 'ตรวจยืนยันสมาชิก LINE ไม่สำเร็จ'),
        );
    }
    const reviewing = pending.length - unpaid.length;
    if (reviewing) append('รอตรวจสลิป/เงินสด ' + reviewing + ' คน');
    append('ชำระเงินของคุณผ่านลิงก์ด้านล่าง 👇\n' + liffUrl(env, bill.club, 'pay', bill.id));
  }
  if (groups.some(g => g.results.length > limit))
    append('แสดง ' + limit + ' บิลเก่าสุดต่อสนาม · ดูบิลอื่นกับผู้จัด');
  flush();
  // Continuation from the quick-reply button: only the next tags, no summary.
  if (tagsFrom !== null) messages.length = 0;
  if (messages.length > 5) {
    diagnostics.push({ reason: 'reply_message_limit' });
    return [
      {
        type: 'text',
        text: 'บิลมีรายชื่อมากเกินส่งครบในคำตอบเดียว กรุณาใช้ badbot bill sena หรือ badbot bill 88 หรือให้ผู้จัดแยกบิล',
      },
    ];
  }
  return addTagMessages(messages, owed, scope, diagnostics, tagsFrom);
}

const TAG_PREFIX = 'ค้างจ่าย: ',
  TAG_SUFFIX = 'ชำระเงินผ่านลิงก์ด้านบน';
// Tag chunks from `from` on, as many as the 5-message reply allows; if some are
// left, a quick-reply button on the last message tags the next ones for free.
function addTagMessages(messages, owed, scope, diagnostics, from) {
  const people = [...owed].map(([userId, v]) => ({ userId, ...v })),
    chunks = planMentionMessages(people),
    start = from ?? 0,
    slots = 5 - messages.length,
    shown = chunks.slice(start, start + slots);
  for (const chunk of shown) messages.push(mentionGroupMessage(chunk, TAG_PREFIX, TAG_SUFFIX));
  // A stale button (bills paid or changed since) must still produce a valid reply.
  if (!messages.length) messages.push({ type: 'text', text: 'ไม่มีรายชื่อที่ต้องแท็กเพิ่มแล้ว' });
  const left = chunks.slice(start + slots).reduce((n, c) => n + c.length, 0);
  if (left && messages.length)
    messages.at(-1).quickReply = {
      items: [
        {
          type: 'action',
          action: {
            type: 'postback',
            label: 'แท็กต่ออีก ' + left + ' คน',
            data: 'badbot:billtag:' + scope + ':' + (start + slots),
            displayText: 'แท็กต่อ',
          },
        },
      ],
    };
  if (left) diagnostics.push({ reason: 'mention_continued', remaining: left });
  return messages;
}
