import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from './worker.js';
import { billingLineText, prunePaidSlips } from './billing.js';

const origin = 'https://sena.example';
function fixture(t) {
 const db = new DatabaseSync(':memory:');
 t.after(() => db.close());
 db.exec('CREATE TABLE login_attempts(ip TEXT PRIMARY KEY,window INTEGER,attempts INTEGER)');
 const files = new Map();
 const env = { ADMIN_KEY: 'test-key', DB: { prepare(sql) {
  const stmt = db.prepare(sql);
  let args = [];
  return {
   bind(...values) { args = values; return this; },
   first() { return stmt.get(...args); },
   all() { return { results: stmt.all(...args) }; },
   run() { return { meta: { changes: stmt.run(...args).changes } }; }
  };
 } }, BILL_SLIPS: {
  async put(key, body, options) { files.set(key, { body, httpMetadata: options.httpMetadata }); },
  async get(key) { return files.get(key); },
  async delete(keys) { for (const key of [keys].flat()) files.delete(key); }
 } };
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
 return { db, env, files, request, login };
}
const draft = {
 date: '2026-10-01', court: 80000, shuttle: 40001, transfer: 'บัญชีทดสอบ',
 attendees: [
  { name: 'Nut', payer: 'Nut', payerKey: 'member:1' },
  { name: 'Guest', payer: 'Nut', payerKey: 'member:1' },
  { name: 'Bua', payer: 'Bua', payerKey: 'member:2' }
 ]
};
const slip = Uint8Array.of(255,216,255,224,0,0,0,0,0,0,255,217);

test('billing splits satang exactly, groups guests, and follows outstanding older dates in Badbot', async t => {
 const f = fixture(t), cookie = await f.login();
 const post = (club, payload = draft) => f.request('/api/billing?club=' + club, { method: 'POST', payload, cookie });
 assert.equal((await f.request('/api/billing', { method: 'POST', payload: draft })).status, 401);
 const { id } = await (await post('sena')).json();
 assert.equal((await (await post('sena')).json()).id, id);
 await post('88', { ...draft, attendees: [{ name: 'Player 88', payer: 'Player 88', payerKey: 'member:88' }] });
 const path = '/api/billing?bill=' + id;
 const publicBill = await (await f.request(path)).json();
 assert.equal(publicBill.people, 3);
 assert.equal(publicBill.payers.reduce((sum, p) => sum + p.amount, 0), draft.court + draft.shuttle);
 assert.equal(publicBill.payers[0].amount, 80001);
 assert.equal(publicBill.payers[0].shares, 2);
 assert(!JSON.stringify(publicBill).includes('บัญชีทดสอบ'));
 assert(publicBill.payers.every(p => !p.token && !p.hasSlip));
 assert.match(await billingLineText(f.env, 'all', origin), /Sena[\s\S]*Nut[\s\S]*Player 88/);
 assert.doesNotMatch(await billingLineText(f.env, 'sena', origin), /Player 88/);
 assert.doesNotMatch(await billingLineText(f.env, '88', origin), /Nut|Bua/);
});

test('private slips require payer or admin, approval requires an uploaded slip, and only closed bills are pruned', async t => {
 const f = fixture(t), cookie = await f.login();
 const { id } = await (await f.request('/api/billing', { method: 'POST', payload: draft, cookie })).json();
 const path = '/api/billing?bill=' + id;
 const read = async () => (await (await f.request(path, { cookie })).json()).payers;
 let [nut, bua] = await read();
 const review = (p, status, note) => f.request(path + '&action=review', {
  method: 'POST', cookie, payload: { payer: p.id, status, note, receiptId: p.receiptId }
 });
 const upload = (p, body = slip) => f.request(path + '&action=upload', { method: 'POST', token: p.token, body });
 assert.equal((await review(nut, 'paid')).status, 409);
 assert.equal((await upload({})).status, 403);
 assert.equal((await upload(nut, new Uint8Array(1024*1024+1))).status, 400);
 assert.equal((await upload(nut)).status, 200);
 [nut, bua] = await read();
 assert.equal(nut.status, 'review');
 const privatePath = path + '&action=slip&payer=' + nut.id;
 assert.equal((await f.request(privatePath)).status, 403);
 assert.equal((await f.request(privatePath, { token: bua.token })).status, 404);
 assert.equal((await f.request(privatePath, { token: nut.token })).headers.get('Content-Type'), 'image/jpeg');
 assert.equal((await f.request(privatePath, { cookie })).status, 200);
 assert.equal((await f.request(path + '&action=edit', { method: 'POST', payload: draft, cookie })).status, 409);
 assert.equal((await review(nut, 'rejected', 'ยอดไม่ตรง')).status, 200);
 const previous = nut;
 assert.equal((await upload(nut)).status, 200);
 [nut] = await read();
 assert.equal(f.files.size, 1);
 assert.equal((await review(previous, 'paid')).status, 409);
 assert.equal((await review(nut, 'paid')).status, 200);
 assert.doesNotMatch(await billingLineText(f.env, 'all', origin), /Nut/);
 await prunePaidSlips(f.env);
 assert.equal(f.files.size, 1);
 assert.equal((await upload(bua)).status, 200);
 [, bua] = await read();
 assert.equal((await review(bua, 'paid')).status, 200);
 assert.match(await billingLineText(f.env, 'all', origin), /ไม่มีบิลค้าง/);
 f.db.prepare('UPDATE bills SET closed_at=? WHERE id=?').run(Date.now() - 91*86400000, id);
 await prunePaidSlips(f.env);
 assert.equal(f.files.size, 0);
 assert.equal((await read())[0].status, 'paid');
 assert.equal((await f.request(privatePath, { cookie })).status, 404);
});
