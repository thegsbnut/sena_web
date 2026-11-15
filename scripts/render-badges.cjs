// Renders the job badges (public/job-badges.js) to PNG for LINE Flex messages,
// which cannot show SVG. Run after changing badge art: node scripts/render-badges.cjs
// Output: public/badges/novice.png, blank.png, <line>-1.png, <line>-2.png, <line>-3-<stars>.png
const { chromium } = require('playwright');
const path = require('path');
const root = path.join(__dirname, '..', 'public');
const SIZE = 72;
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 400, height: 400 } });
  await page.setContent(
    `<style>html,body{margin:0;background:transparent}#b{padding:20px;display:inline-block}</style><div id="d"></div><div id="b"></div>`,
  );
  await page.addStyleTag({ path: path.join(root, 'job-badges.css') });
  await page.addScriptTag({ path: path.join(root, 'job-rules.js') });
  await page.addScriptTag({ path: path.join(root, 'job-badges.js') });
  await page.evaluate(() => (document.getElementById('d').innerHTML = SenaJobs.defsHtml()));
  const plays = { 1: 5, 2: 15 };
  const jobs = [['novice', { plays: 0, line: 'red' }]];
  for (const line of await page.evaluate(() => SenaJobRules.LINES)) {
    jobs.push([line + '-1', { line, plays: plays[1] }], [line + '-2', { line, plays: plays[2] }]);
    for (let s = 0; s <= 5; s++) jobs.push([line + '-3-' + s, { line, plays: 30 + 30 * s }]);
  }
  for (const [file, badge] of jobs) {
    await page.evaluate(
      ([badge, size]) =>
        (document.getElementById('b').innerHTML = SenaJobs.badgeHtml(
          { ...badge, chosen: true },
          size,
        )),
      [badge, SIZE],
    );
    // A square canvas keeps the stars (drawn below the disc) inside the image.
    const box = await page.$('#b .jb-badge').then(e => e.boundingBox());
    const side = SIZE * 1.2;
    await page.screenshot({
      path: path.join(root, 'badges', file + '.png'),
      omitBackground: true,
      clip: { x: box.x - SIZE * 0.1, y: box.y - SIZE * 0.02, width: side, height: side },
    });
  }
  // Guests have no badge: a transparent square keeps the names aligned.
  await page.evaluate(() => (document.getElementById('b').innerHTML = ''));
  await page.setViewportSize({ width: 400, height: 400 });
  await page.screenshot({
    path: path.join(root, 'badges', 'blank.png'),
    omitBackground: true,
    clip: { x: 300, y: 300, width: SIZE * 1.2, height: SIZE * 1.2 },
  });
  await browser.close();
  console.log('rendered', jobs.length, 'badges');
})();
