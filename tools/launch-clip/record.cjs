// Record the REAL local site (wrangler dev + mock D1 data) as timestamped frames.
// usage: node record.cjs A|B   (needs `wrangler dev` on :8799 with data/ seeded — see README.md)
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const seg = process.argv[2];
const W = 390,
  H = 749; // LIFF full-size web area on a 390x844 phone
const dir = path.join(__dirname, 'build', 'rec', seg);
fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({
    viewport: { width: W, height: H },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    userAgent:
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36',
  });
  await ctx.addCookies([
    {
      name: '__Host-sena-member',
      value: 'a'.repeat(64),
      url: 'https://localhost:8799/',
      secure: true,
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
  const pg = await ctx.newPage();
  const events = [];
  const notices = [];
  pg.on('response', async r => {
    if (r.request().method() !== 'POST') return;
    try {
      const j = await r.json();
      if (j?.notice?.text) notices.push(j.notice.text);
    } catch {}
  });
  await pg.goto(
    seg === 'A' ? 'http://localhost:8799/court#booking' : 'http://localhost:8799/court#bills',
    { waitUntil: 'load' },
  );
  await sleep(3500);

  // capture loop
  const frames = [];
  let running = true,
    t0 = Date.now();
  const now = () => (Date.now() - t0) / 1000;
  const loop = (async () => {
    let i = 0;
    while (running) {
      const t = now();
      const buf = await pg.screenshot({ type: 'jpeg', quality: 88 });
      const f = `f${String(i++).padStart(4, '0')}.jpg`;
      fs.writeFileSync(path.join(dir, f), buf);
      frames.push({ t, f });
    }
  })();
  async function tap(loc, label) {
    const box = await loc.boundingBox();
    const x = box.x + box.width / 2,
      y = box.y + box.height / 2;
    events.push({ type: 'tap', t: now(), x, y, label });
    await sleep(140);
    await loc.tap();
  }

  if (seg === 'A') {
    await sleep(1000);
    await tap(pg.locator('[data-book-date]').first(), 'date');
    await sleep(1200);
    await tap(pg.locator('#bookingContinue'), 'continue');
    await sleep(1500);
    await tap(pg.locator('#bookingConfirm'), 'confirm');
    await sleep(2300);
    await tap(pg.getByRole('button', { name: 'ตกลง' }), 'ok');
    await sleep(700);
  } else {
    const fr = pg.frameLocator('#billsFrame');
    const btn = fr.locator('[data-action="mine-slip"]').first();
    await sleep(900);
    // finger-scroll down until the slip button sits in the lower part of the screen
    const target = 560;
    for (let k = 0; k < 40; k++) {
      const box = await btn.boundingBox();
      if (!box || box.y < target) break;
      const dy = Math.min(26, box.y - target + 2);
      await pg.evaluate(dy => {
        const f = document.querySelector('#billsFrame');
        const doc = f.contentDocument.scrollingElement;
        if (doc.scrollHeight > doc.clientHeight + 5) doc.scrollBy(0, dy);
        else window.scrollBy(0, dy);
      }, dy);
      await sleep(30);
    }
    events.push({ type: 'scrolled', t: now() });
    await sleep(900);
    const chooser = pg.waitForEvent('filechooser');
    await tap(btn, 'slip');
    const fc = await chooser;
    events.push({ type: 'picker', t0: now() });
    await sleep(2300); // composite shows the phone's photo picker here
    let dialogText = '';
    pg.once('dialog', async d => {
      dialogText = d.message();
      events.push({ type: 'alert', t0: now(), text: dialogText });
      await sleep(1800); // composite shows the native confirm here
      events.push({ type: 'alertTap', t: now() });
      await d.accept();
    });
    events.find(e => e.type === 'picker').t1 = now();
    await fc.setFiles(path.join(__dirname, 'slip.png'));
    await sleep(5200);
  }
  running = false;
  await loop;
  fs.writeFileSync(
    path.join(dir, 'meta.json'),
    JSON.stringify({ frames, events, notices, w: W, h: H }, null, 1),
  );
  console.log(
    seg,
    'frames',
    frames.length,
    'dur',
    frames.at(-1).t.toFixed(2),
    'events',
    JSON.stringify(events),
    'notices',
    notices,
  );
  await b.close();
})();
