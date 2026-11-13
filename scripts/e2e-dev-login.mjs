#!/usr/bin/env node
// Playwright check of every page as a dev-login test admin and test player.
//   BASE_URL=https://sena-web.thegsbnut.workers.dev DEV_AUTH_SECRET=… node scripts/e2e-dev-login.mjs
//   (default BASE_URL http://localhost:8799 for `wrangler dev`)
// Saves storageState to .auth/admin.json and .auth/player.json (git-ignored) and
// screenshots to e2e-output/. Exits 1 on any failed check.
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const BASE = (process.env.BASE_URL || 'http://localhost:8799').replace(/\/$/, '');
const SECRET = process.env.DEV_AUTH_SECRET;
if (!SECRET) {
  console.error('ตั้ง DEV_AUTH_SECRET ก่อนรัน');
  process.exit(1);
}
mkdirSync('.auth', { recursive: true });
mkdirSync('e2e-output', { recursive: true });

const USERS = {
  admin: { uid: 'U_TEST_e2e_admin', name: 'E2E Admin', role: 'admin' },
  player: { uid: 'U_TEST_e2e_player', name: 'E2E Player', role: 'player' },
};
// Bottom tabs on /court; hidden ones (session, roster) are only shown to admins.
const TABS = ['booking', 'bills', 'roster', 'cup', 'leaderboard'];
const failures = [];
const check = (ok, message) => {
  console.log((ok ? '  ✓ ' : '  ✗ ') + message);
  if (!ok) failures.push(message);
};

const browser = await chromium.launch();
try {
  // Gate: wrong key must look like a missing page.
  {
    const context = await browser.newContext();
    const r = await context.request.get(
      BASE + '/dev-login?key=wrong&uid=U_TEST_x&name=x&role=player',
      { maxRedirects: 0 },
    );
    check(r.status() === 404, 'wrong key → 404 (got ' + r.status() + ')');
    await context.close();
  }

  for (const [label, user] of Object.entries(USERS)) {
    console.log('\n[' + label + ']');
    // 1) Log in via /dev-login and save storageState.
    const login = await browser.newContext();
    const page = await login.newPage();
    const url = new URL(BASE + '/dev-login');
    for (const [k, v] of Object.entries({ key: SECRET, ...user })) url.searchParams.set(k, v);
    await page.goto(url.href);
    check(new URL(page.url()).searchParams.get('club') === 'test', 'redirected to ?club=test');
    await login.storageState({ path: '.auth/' + label + '.json' });
    await login.close();

    // 2) Visit every page with the saved state.
    const context = await browser.newContext({ storageState: '.auth/' + label + '.json' });
    const errors = [];
    context.on('page', p => {
      p.on('pageerror', e => errors.push(p.url() + ' · ' + e.message));
      p.on('response', r => {
        if (r.url().includes('/api/') && r.status() >= 500) errors.push(r.status() + ' ' + r.url());
      });
    });
    const p = await context.newPage();

    const member = await (await p.request.get(BASE + '/api/member?club=test')).json();
    check(
      member.loggedIn && member.test && member.link?.status === 'approved',
      'session on test club',
    );
    const real = await (await p.request.get(BASE + '/api/member')).json();
    check(!real.loggedIn, 'not logged in on real club');
    const session = await (await p.request.get(BASE + '/api/session?club=test')).json();
    check(session.canEdit === (user.role === 'admin'), 'canEdit on test club = ' + session.canEdit);
    const realSession = await (await p.request.get(BASE + '/api/session')).json();
    check(!realSession.canEdit, 'no admin rights on real club');

    await p.goto(BASE + '/court?club=test#booking');
    await p.waitForLoadState('networkidle');
    check(await p.locator('#testModeBanner').isVisible(), 'TEST MODE banner on /court');
    for (const tab of TABS) {
      const button = p.locator('.next-tabbar .tab[data-tab="' + tab + '"]');
      if (!(await button.isVisible())) {
        console.log('  - tab ' + tab + ' hidden for ' + label);
        continue;
      }
      await button.click();
      await p.waitForLoadState('networkidle');
      await p.screenshot({ path: `e2e-output/${label}-court-${tab}.png`, fullPage: true });
      check((await p.locator('body').getAttribute('data-tab')) === tab, 'tab ' + tab);
    }
    for (const path of ['/billing.html?club=test', '/admin?club=test']) {
      await p.goto(BASE + path);
      await p.waitForLoadState('networkidle');
      const name = path.replace(/[^a-z]+/g, '-').replace(/^-|-$/g, '');
      await p.screenshot({ path: `e2e-output/${label}-${name}.png`, fullPage: true });
      check(await p.locator('#testModeBanner').isVisible(), 'TEST MODE banner on ' + path);
    }
    check(
      !errors.length,
      'no page errors / 5xx' + (errors.length ? ': ' + errors.join(' | ') : ''),
    );
    await context.close();
  }
} finally {
  await browser.close();
}
console.log(failures.length ? '\nล้มเหลว ' + failures.length + ' ข้อ' : '\nผ่านทั้งหมด');
process.exit(failures.length ? 1 : 0);
