// usage: node render.cjs shots t1,t2,...  |  node render.cjs cues build/sfx.json  |  node render.cjs video out.mp4 [fps] [dur]
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
(async () => {
  const [mode, arg, fpsA, durA] = process.argv.slice(2);
  const b = await chromium.launch({ args: ['--allow-file-access-from-files'] });
  const pg = await b.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
  await pg.goto('file://' + path.join(__dirname, process.env.CLIP || 'clip.html'));
  await pg.evaluate(() => window.ready);
  if (mode === 'cues') {
    fs.writeFileSync(
      arg,
      JSON.stringify(await pg.evaluate(() => ({ sfx: window.SFX, timeline: window.TIMELINE }))),
    );
  } else if (mode === 'shots') {
    fs.mkdirSync(path.join(__dirname, 'build', 'shots'), { recursive: true });
    for (const t of arg.split(',').map(Number)) {
      await pg.evaluate(t => render(t), t);
      await pg.screenshot({
        path: path.join(__dirname, 'build', 'shots', `t${t}.jpg`),
        quality: 70,
        type: 'jpeg',
      });
    }
  } else {
    const fps = +(fpsA || 30),
      dur = +(durA || 33.5);
    const ff = spawn(
      'ffmpeg',
      [
        '-y',
        '-loglevel',
        'error',
        '-f',
        'image2pipe',
        '-framerate',
        String(fps),
        '-c:v',
        'mjpeg',
        '-i',
        '-',
        '-c:v',
        'libx264',
        '-pix_fmt',
        'yuv420p',
        '-preset',
        'medium',
        '-crf',
        '20',
        arg,
      ],
      { stdio: ['pipe', 'inherit', 'inherit'] },
    );
    const n = Math.round(fps * dur);
    for (let i = 0; i < n; i++) {
      await pg.evaluate(t => render(t), i / fps);
      const buf = await pg.screenshot({ type: 'jpeg', quality: 92 });
      if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
      if (i % 150 === 0) console.log('frame', i, '/', n);
    }
    ff.stdin.end();
    await new Promise(r => ff.on('close', r));
  }
  await b.close();
})();
