// Guards for the redesign preview (next/ overlay served by wrangler.next.jsonc).
// The redesign may change layout and styles, but must keep every feature of the original pages.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildNext } from './scripts/build-next.mjs';

const pages = readdirSync('next').filter(f => f.endsWith('.html'));
// court-full.html is the full redesign of court.html, kept for side-by-side comparison.
const original = f => join('public', f.replace(/-full\.html$/, '.html'));
const ids = s => [...s.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]).sort();
const scripts = s =>
  [...s.matchAll(/<script[^>]*\ssrc="([^"?]+)/g)].map(m => m[1].replace(/^\//, '')).sort();

test('every redesigned page replaces an existing page', () => {
  assert.ok(pages.length > 0);
  for (const f of pages) assert.ok(existsSync(original(f)), f + ' has no original');
});

test('redesigned pages keep every element id of the original', () => {
  for (const f of pages) {
    const before = ids(readFileSync(original(f), 'utf8'));
    const after = ids(readFileSync(join('next', f), 'utf8'));
    assert.deepEqual(
      before.filter(id => !after.includes(id)),
      [],
      f + ' lost ids',
    );
  }
});

test('redesigned pages load every original script', () => {
  for (const f of pages) {
    const before = scripts(readFileSync(original(f), 'utf8'));
    const after = scripts(readFileSync(join('next', f), 'utf8'));
    assert.deepEqual(
      before.filter(src => !after.includes(src)),
      [],
      f + ' dropped scripts',
    );
  }
});

test('build copies public/ and overlays next/', () => {
  const out = mkdtempSync(join(tmpdir(), 'sena-next-'));
  try {
    buildNext(out, join(out, '..', 'sena-next-assets-' + process.pid + '.mjs'));
    for (const f of readdirSync('public')) assert.ok(existsSync(join(out, f)), f + ' missing');
    for (const f of readdirSync('next'))
      assert.equal(readFileSync(join(out, f), 'utf8'), readFileSync(join('next', f), 'utf8'));
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test('preview worker has no cron and production config is unchanged', () => {
  const cfg = readFileSync('wrangler.next.jsonc', 'utf8');
  assert.doesNotMatch(cfg, /"triggers"/);
  assert.match(cfg, /"main": "worker-next\.js"/);
  assert.match(readFileSync('wrangler.jsonc', 'utf8'), /"directory": "\.\/public"/);
  assert.match(readFileSync('wrangler.jsonc', 'utf8'), /"main": "worker\.js"/);
});

test('bundled assets behave like Workers Assets', async () => {
  buildNext();
  const { serveAsset } = await import('./worker-next.js');
  const get = path => serveAsset(new Request('https://next.test' + path));
  let r = get('/court.html?club=88');
  assert.equal(r.status, 307);
  assert.equal(r.headers.get('Location'), 'https://next.test/court?club=88');
  r = get('/court');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('Content-Type'), /text\/html/);
  assert.match(await r.text(), /next-nav\.css/);
  r = get('/next-nav.css');
  assert.match(r.headers.get('Content-Type'), /text\/css/);
  r = get('/final-rally.webp');
  assert.equal(r.headers.get('Content-Type'), 'image/webp');
  assert.deepEqual(
    new Uint8Array(await r.arrayBuffer()),
    new Uint8Array(readFileSync('public/final-rally.webp')),
  );
  assert.equal(get('/missing.js').status, 404);
  assert.equal(serveAsset(new Request('https://next.test/court', { method: 'POST' })).status, 405);
});
