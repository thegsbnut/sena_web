import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from './worker.js';
import { billingLineText, promptPayPayload, prunePaidSlips } from './billing.js';

const origin = 'https://sena.example';
function fixture(t) {
 const db = new DatabaseSync(':memory:');
 const slips = new DatabaseSync(':memory:');
 t.after(() => { db.close(); slips.close(); });
 db.exec('CREATE TABLE login_attempts(ip TEXT PRIMARY KEY,window INTEGER,attempts INTEGER)');
 const binding = database => ({ prepare(sql) {
  const stmt = database.prepare(sql);
  let args = [];
  return {
   bind(...values) { args = values.map(value => value instanceof ArrayBuffer ? new Uint8Array(value) : value); return this; },
   first() { return stmt.get(...args); },
   all() { return { results: stmt.all(...args) }; },
   async run() { return { meta: { changes: stmt.run(...args).changes } }; }
  };
 } });
 const env = { ADMIN_KEY: 'test-key', DB: binding(db), SLIPS_DB: binding(slips) };
 const request = (path, { cookie = '', token, method = 'GET', payload, body, originHeader = origin } = {}) =>
  worker.fetch(new Request(origin + path, {
   method, headers: { Origin: originHeader, Cookie: cookie, ...(token ? { 'X-Bill-Token': token } : {}) },
   body: body ?? (payload ? JSON.stringify(payload) : undefined)
  }), env);
 async function login() {
  const response = await request('/api/login', { method: 'POST', payload: { key: env.ADMIN_KEY } });
  assert.equal(response.status, 200);
  return response.headers.get('Set-Cookie').split(';')[0];
 }
 return { db, env, slips, request, login };
}
const draft = {
 date: '2026-10-01', court: 80000, shuttle: 40001, transfer: '0000000000',
 attendees: [
  { name: 'Nut', payer: 'Nut', payerKey: 'member:1' },
  { name: 'Guest', payer: 'Nut', payerKey: 'member:1' },
  { name: 'Bua', payer: 'Bua', payerKey: 'member:2' }
 ]
};
const slip = Uint8Array.of(255,216,255,224,0,0,0,0,0,0,255,217);

test('PromptPay encodes the receiver and amount with the expected checksum', () => {
 assert.equal(promptPayPayload('0123456789', 12700),
  '00020101021229370016A0000006770101110113006612345678953037645406127.005802TH6304E848');
 assert.equal(promptPayPayload('1111111111111', 1250),
  '00020101021229370016A000000677010111021311111111111115303764540512.505802TH6304E70D');
 assert.equal(promptPayPayload('0123456789', 0), null);
});

test('bill QR serves only the selected outstanding share and refuses a stale amount', async t => {
 const f = fixture(t), cookie = await f.login();
 const { id } = await (await f.request('/api/billing', { method: 'POST', payload: draft, cookie })).json();
 const path = '/api/billing?bill=' + id;
 const { payers: [nut, bua] } = await (await f.request(path, { cookie })).json();
 const qr = path + '&action=qr&payer=' + nut.id;
 const result = await f.request(qr + '&amount=' + nut.amount);
 assert.equal(result.headers.get('Content-Type'), 'image/svg+xml');
 assert.match(await result.text(), /<svg/);
 assert.equal((await f.request(qr + '&amount=' + bua.amount)).status, 409);
 assert.equal((await f.request(qr + '&amount=' + nut.amount, { token: bua.token })).status, 404);
 await f.request(path + '&action=cash', { method: 'POST', cookie, payload: { payer: nut.id, revision: 0, received: true } });
 assert.equal((await f.request(qr + '&amount=' + nut.amount)).status, 409);
});

test('billing rounds each payer total up to baht, groups guests, and follows older dates in Badbot', async t => {
 const f = fixture(t), cookie = await f.login();
 const post = (club, payload = draft) => f.request('/api/billing?club=' + club, { method: 'POST', payload, cookie });
 assert.equal((await f.request('/api/billing', { method: 'POST', payload: draft })).status, 401);
 const { id } = await (await post('sena')).json();
 assert.equal((await (await post('sena')).json()).id, id);
 await post('88', { ...draft, attendees: [{ name: 'Player 88', payer: 'Player 88', payerKey: 'member:88' }] });
 const path = '/api/billing?bill=' + id;
 const publicBill = await (await f.request(path)).json();
 assert.equal(publicBill.people, 3);
 assert.equal(publicBill.total, draft.court + draft.shuttle);
 assert.equal(publicBill.collection, 120200);
 assert.deepEqual(publicBill.payers.map(p => p.amount), [80100, 40100]);
 assert.equal(publicBill.payers[0].shares, 2);
 assert.equal(publicBill.transfer, draft.transfer);
 assert(publicBill.payers.every(p => !p.token && !p.hasSlip));
 assert.match(await billingLineText(f.env, 'all', origin), /Sena[\s\S]*Nut[\s\S]*Player 88/);
 assert.doesNotMatch(await billingLineText(f.env, 'sena', origin), /Player 88/);
 assert.doesNotMatch(await billingLineText(f.env, '88', origin), /Nut|Bua/);
});

test('only organizers can record and undo cash, without requiring a slip', async t => {
 const f = fixture(t), cookie = await f.login();
 const { id } = await (await f.request('/api/billing', { method: 'POST', payload: draft, cookie })).json();
 const path = '/api/billing?bill=' + id;
 const { payers: [nut, bua] } = await (await f.request(path)).json();
 const cash = (payer, received, revision, auth = cookie) => f.request(path + '&action=cash', {
  method: 'POST', cookie: auth, payload: { payer, received, revision }
 });
 assert.equal((await cash(nut.id, true, 0, '')).status, 401);
 assert.equal((await cash(nut.id, true, 0)).status, 200);
 assert.equal((await cash(bua.id, true, 0)).status, 409);
 assert.equal((await cash(bua.id, true, 1)).status, 200);
 assert.match(await billingLineText(f.env, 'all', origin), /ไม่มีบิลค้าง/);
 const paid = await (await f.request(path, { cookie })).json();
 assert.equal(paid.editable, false);
 assert(paid.payers.every(p => p.status === 'paid' && p.method === 'cash' && !p.hasSlip));
 assert.equal((await cash(nut.id, false, 2)).status, 200);
 assert.match(await billingLineText(f.env, 'all', origin), /Nut/);
});

test('public uploads auto-pay the selected row, slips stay private, and only closed bills are pruned', async t => {
 const f = fixture(t), cookie = await f.login();
 const { id } = await (await f.request('/api/billing', { method: 'POST', payload: draft, cookie })).json();
 const path = '/api/billing?bill=' + id;
 const read = async () => (await (await f.request(path, { cookie })).json()).payers;
 let [nut, bua] = await read();
 const review = (p, status, note) => f.request(path + '&action=review', {
  method: 'POST', cookie, payload: { payer: p.id, status, note, receiptId: p.receiptId }
 });
 const upload = (p, body = slip) => f.request(path + '&action=upload&payer=' + p.id + '&amount=' + p.amount, { method: 'POST', body });
 assert.equal((await review(nut, 'paid')).status, 409);
 assert.equal((await upload({})).status, 403);
 assert.equal((await upload(nut, new Uint8Array(1024*1024+1))).status, 400);
 assert.equal((await upload({ ...nut, amount: nut.amount - 1 })).status, 409);
 assert.equal((await upload(nut)).status, 200);
 [nut, bua] = await read();
 assert.equal(nut.status, 'paid');
 const privatePath = path + '&action=slip&payer=' + nut.id;
 assert.equal((await f.request(privatePath)).status, 403);
 assert.equal((await f.request(privatePath, { token: bua.token })).status, 404);
 const privateSlip = await f.request(privatePath, { token: nut.token });
 assert.equal(privateSlip.headers.get('Content-Type'), 'image/jpeg');
 assert.deepEqual(new Uint8Array(await privateSlip.arrayBuffer()), slip);
 assert.equal((await f.request(privatePath, { cookie })).status, 200);
 assert.equal((await f.request(path + '&action=edit', { method: 'POST', payload: draft, cookie })).status, 409);
 assert.equal((await upload(nut)).status, 409);
 const countSlips = () => f.slips.prepare('SELECT COUNT(*) AS count FROM bill_slips').get().count;
 assert.equal(countSlips(), 1);
 assert.equal((await review(nut, 'rejected', 'กรุณาตรวจชื่อ')).status, 200);
 assert.equal((await read())[0].status, 'rejected');
 assert.equal((await upload(nut)).status, 200);
 assert.equal(countSlips(), 1);
 assert.doesNotMatch(await billingLineText(f.env, 'all', origin), /Nut/);
 await prunePaidSlips(f.env);
 assert.equal(countSlips(), 1);
 const fill = f.slips.prepare('INSERT INTO bill_slips VALUES (?, ?, ?, ?, ?)');
 fill.run('full', 'another-bill', 'image/jpeg', 250_000_000, slip);
 assert.equal((await upload(bua)).status, 507);
 assert.equal((await read())[1].status, 'unpaid');
 f.slips.prepare("DELETE FROM bill_slips WHERE key='full'").run();
 assert.equal((await upload(bua)).status, 200);
 [, bua] = await read();
 assert.equal(bua.status, 'paid');
 assert.match(await billingLineText(f.env, 'all', origin), /ไม่มีบิลค้าง/);
 f.db.prepare('UPDATE bills SET closed_at=? WHERE id=?').run(Date.now() - 29*86400000, id);
 await prunePaidSlips(f.env);
 assert.equal(countSlips(), 2);
 f.db.prepare('UPDATE bills SET closed_at=? WHERE id=?').run(Date.now() - 31*86400000, id);
 await prunePaidSlips(f.env);
 assert.equal(countSlips(), 0);
 assert.equal((await read())[0].status, 'paid');
 assert.equal((await f.request(privatePath, { cookie })).status, 404);
});


test('organizers can set a default, edit before payment and cancel or restore an existing bill', async t => {
 const f = fixture(t), cookie = await f.login();
 const post = (path, payload, auth = cookie) => f.request(path, { method: 'POST', cookie: auth, payload });
 const settings = '/api/billing?action=promptpay';
 const sessions = '/api/billing?action=sessions&date=' + draft.date;
 assert.equal((await post(settings, { promptpay: draft.transfer }, '')).status, 401);
 assert.equal((await post(settings, { promptpay: 'invalid' })).status, 400);
 assert.equal((await post(settings, { promptpay: draft.transfer })).status, 200);
 assert.equal((await (await f.request(sessions, { cookie })).json()).promptpay, draft.transfer);
 const { id } = await (await post('/api/billing', draft)).json();
 const path = '/api/billing?bill=' + id;
 assert.equal((await (await f.request(sessions, { cookie })).json()).existing, id);
 assert.equal((await post(path + '&action=edit', { ...draft, court: 90000, revision: 0 })).status, 200);
 assert.equal((await post(path + '&action=cancel', { revision: 0 })).status, 409);
 assert.equal((await post(path + '&action=cancel', { revision: 1 })).status, 200);
 assert.deepEqual(await (await f.request(path)).json(), { cancelled: true });
 assert.match(await billingLineText(f.env, 'all', origin), /ไม่มีบิลค้าง/);
 assert.equal((await post(path + '&action=restore', { revision: 2 })).status, 200);
 assert.equal((await (await f.request(path)).json()).court, 90000);
 assert.match(await billingLineText(f.env, 'all', origin), /Nut/);
});

test('a confirmed supplemental bill has a distinct link, displays the same date, and retries safely', async t => {
 const f = fixture(t), cookie = await f.login();
 const post = (payload, club = 'sena') => f.request('/api/billing?club=' + club, { method: 'POST', payload, cookie });
 const additional = 'a'.repeat(32);
 assert.equal((await post({ ...draft, additional })).status, 409);
 const first = await (await post(draft)).json();
 assert.deepEqual(await (await post(draft)).json(), { id: first.id, existing: true });
 const extra = await (await post({ ...draft, additional })).json();
 assert.notEqual(extra.id, first.id);
 assert.deepEqual(await (await post({ ...draft, additional })).json(), { id: extra.id, existing: true });
 const view = await (await f.request('/api/billing?bill=' + extra.id)).json();
 assert.equal(view.date, draft.date);
 assert.equal(view.additional, true);
 assert.match(await billingLineText(f.env, 'sena', origin), /บิลเพิ่มเติม/);
 assert.equal((await post({ ...draft, additional }, '88')).status, 409);
});
