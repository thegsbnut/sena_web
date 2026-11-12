// Guards for the redesign preview (next/ overlay served by wrangler.next.jsonc).
// The redesign may change layout and styles, but must keep every feature of the original pages.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildNext } from './scripts/build-next.mjs';

const pages = readdirSync('next').filter(f => f.endsWith('.html'));
const ids = s => [...s.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]).sort();
const scripts = s =>
  [...s.matchAll(/<script[^>]*\ssrc="([^"?]+)/g)].map(m => m[1].replace(/^\//, '')).sort();

test('every redesigned page replaces an existing page', () => {
  assert.ok(pages.length > 0);
  for (const f of pages) assert.ok(existsSync(join('public', f)), f + ' has no original');
});

test('redesigned pages keep every element id of the original', () => {
  for (const f of pages) {
    const before = ids(readFileSync(join('public', f), 'utf8'));
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
    const before = scripts(readFileSync(join('public', f), 'utf8'));
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
    buildNext(out);
    for (const f of readdirSync('public')) assert.ok(existsSync(join(out, f)), f + ' missing');
    for (const f of readdirSync('next'))
      assert.equal(readFileSync(join(out, f), 'utf8'), readFileSync(join('next', f), 'utf8'));
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test('preview worker has no cron and does not serve public/ directly', () => {
  const cfg = readFileSync('wrangler.next.jsonc', 'utf8');
  assert.doesNotMatch(cfg, /"triggers"/);
  assert.match(cfg, /"directory": "\.\/dist-next"/);
  assert.notEqual(JSON.parse(readFileSync('package.json', 'utf8')).name, undefined);
  assert.match(readFileSync('wrangler.jsonc', 'utf8'), /"directory": "\.\/public"/);
});
