// Job badge artwork (ported from docs/superpowers/mockups/2026-11-13-badge-mockup.html).
// Pure string building: safe to load in Node for tests. Ids and classes in the
// generated SVG get a "jb-" prefix so they cannot clash with the rest of the page.
(function (root) {
  const Rules = root.SenaJobRules;
  function hash(x, y) {
    let h = (x * 374761393 + y * 668265263) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  const P2 = (r, a) => `${(20 + r * Math.cos(a)).toFixed(2)} ${(20 + r * Math.sin(a)).toFixed(2)}`;
  const TWINKLE = (x, y, cls) =>
    `<path class="${cls}" transform="translate(${x} ${y})" d="M0 -3.4L.9 -.9L3.4 0L.9 .9L0 3.4L-.9 .9L-3.4 0L-.9 -.9Z" fill="#fff3a6" stroke="#6a35c8" stroke-width=".6"/>`;
  const INK = '#1b1b2f';
  const SKIRT =
    'M-2.6 2.6L-7 -8.5Q-5.25 -10.2 -3.5 -8.8Q-1.75 -10.4 0 -9Q1.75 -10.4 3.5 -8.8Q5.25 -10.2 7 -8.5L2.6 2.6Z';
  const CORK = 'M-3 3.5H3A3 3.3 0 0 1 -3 3.5Z';
  const tf = (cx, cy, ang, sc) => `translate(${cx} ${cy}) rotate(${ang}) scale(${sc})`;
  function shuttleV(cx, cy, ang, sc, band = '#e8413c', attrs = '') {
    return `<g transform="${tf(cx, cy, ang, sc)}" ${attrs}>
<path d="${SKIRT}" fill="#fff"/><path d="M1.1 2.6L3.5 -8.8Q5.25 -10.2 7 -8.5L2.6 2.6Z" fill="#cfd9ee"/>
<path d="M-1.2 2.6L-3.5 -8.8M1.2 2.6L3.5 -8.8M0 2.6V-9" stroke="#9aa6c0" stroke-width=".5"/>
<path d="${SKIRT}" fill="none" stroke="${INK}" stroke-width=".85" stroke-linejoin="round"/>
<rect x="-3" y="1.8" width="6" height="1.7" rx=".4" fill="${band}" stroke="${INK}" stroke-width=".7"/>
<path d="${CORK}" fill="#f6e4c0"/><path d="M1 3.6H3A3 3.3 0 0 1 .6 6.6Z" fill="#d9b480"/>
<path d="${CORK}" fill="none" stroke="${INK}" stroke-width=".85"/><ellipse cx="-1.2" cy="4.6" rx=".7" ry=".45" fill="#fff"/></g>`;
  }
  const disc40 = (bg, inner) =>
    `<g clip-path="url(#clipC)"><circle cx="20" cy="20" r="20" fill="${bg}"/>${inner}</g>`;
  const sticker = (rim = '#fff') =>
    `<circle cx="20" cy="20" r="18.9" fill="none" stroke="${rim}" stroke-width="1.8"/><circle cx="20" cy="20" r="19.6" fill="none" stroke="${INK}" stroke-width=".9"/>`;
  const FOCUS = (() => {
    let d = '';
    for (let i = 0; i < 30; i++) {
      const a = (i / 30) * 2 * Math.PI + (i % 3) * 0.05,
        r0 = 8.5 + ((i * 7) % 6),
        w = 0.05 + (i % 2) * 0.035;
      d += `M${P2(25, a - w)}L${P2(r0, a)}L${P2(25, a + w)}Z`;
    }
    return `<path d="${d}" fill="#fff" opacity=".85"/>`;
  })();
  const JOBS = {
    red: {
      th: 'สายตบ',
      color: '#d7263d',
      jobs: [
        ['Smasher', 'นักตบ'],
        ['Court Breaker', 'ผู้ทุบคอร์ท'],
        ['Floor Annihilator', 'ผู้ทำลายพื้นสนาม'],
      ],
    },
    green: {
      th: 'สายตัด',
      color: '#1f9d55',
      jobs: [
        ['Slicer', 'นักตัด'],
        ['Edge Dancer', 'นักร่ายคม'],
        ['Petrifier', 'ผู้สาปคู่แข่งเป็นหิน'],
      ],
    },
    yellow: {
      th: 'สายเลี้ยว',
      color: '#b58900',
      jobs: [
        ['Switcher', 'นักเปลี่ยนทาง'],
        ['Drifter', 'นักดริฟต์'],
        ['Turn Signal Ignorer', 'ผู้ไม่เคยเปิดไฟเลี้ยว'],
      ],
    },
    pink: {
      th: 'สายหยอด',
      color: '#e0559a',
      jobs: [
        ['Net Dropper', 'นักหยอดหน้าเน็ต'],
        ['Charmer', 'นักหว่านเสน่ห์'],
        ['Flirt Master', 'จอมเจ้าชู้หน้าเน็ต'],
      ],
    },
    blue: {
      th: 'สายสะสมไม้',
      color: '#2f6fd0',
      jobs: [
        ['Racket Switcher', 'นักเปลี่ยนไม้'],
        ['Racket Collector', 'นักสะสมไม้'],
        ['Weapon Dealer', 'พ่อค้าอาวุธ'],
      ],
    },
  };
  function swordV(cx, cy, ang, sc) {
    return `<g transform="${tf(cx, cy, ang, sc)}"><path d="M0 -12L1.3 -10.4V2H-1.3V-10.4Z" fill="url(#gBlade)" stroke="${INK}" stroke-width=".6" stroke-linejoin="round"/><path d="M0 -11V1.5" stroke="#fff" stroke-width=".35" opacity=".8"/><rect x="-3.6" y="2" width="7.2" height="1.3" rx=".5" fill="#ffcc33" stroke="${INK}" stroke-width=".6"/><rect x="-.8" y="3.3" width="1.6" height="3.8" fill="#7a4a24" stroke="${INK}" stroke-width=".5"/><circle cx="0" cy="7.9" r="1.1" fill="#ffcc33" stroke="${INK}" stroke-width=".5"/></g>`;
  }
  const COIN = (x, y, cls = '') =>
    `<g class="${cls}"><circle cx="${x}" cy="${y}" r="1.7" fill="#ffd84a" stroke="${INK}" stroke-width=".55"/><path d="M${x - 0.6} ${y - 0.7}h1.2" stroke="#fff6c2" stroke-width=".45"/></g>`;
  const RIM = ['#ffffff', '#ffffff', '#dfe6ea', '#ffd86b'];
  const HEART =
    'M20 30C8 22 8 12 14 11C17 10.5 19 12.5 20 14C21 12.5 23 10.5 26 11C32 12 32 22 20 30Z';
  const heartAt = (x, y, sc, fill, cls = '') =>
    `<path class="${cls}" transform="translate(${x} ${y}) scale(${sc}) translate(-20 -20)" d="${HEART}" fill="${fill}" stroke="${INK}" stroke-width="${0.8 / sc}"/>`;
  function racketV(cx, cy, ang, sc, frame = '#e8413c', grip = '#2a62d8') {
    const rx = 4.6,
      ry = 6,
      hy = -6;
    let st = '';
    for (let k = -4.8; k <= 4.8; k += 1.6) {
      const hw = rx * Math.sqrt(1 - (k / ry) ** 2) - 0.3;
      st += `M${(-hw).toFixed(2)} ${(hy + k).toFixed(2)}H${hw.toFixed(2)}`;
    }
    for (let k = -3.2; k <= 3.2; k += 1.6) {
      const hh = ry * Math.sqrt(1 - (k / rx) ** 2) - 0.3;
      st += `M${k.toFixed(2)} ${(hy - hh).toFixed(2)}V${(hy + hh).toFixed(2)}`;
    }
    return `<g transform="${tf(cx, cy, ang, sc)}"><rect x="-.6" y="-.3" width="1.2" height="9" fill="#cfd6d4" stroke="${INK}" stroke-width=".6"/><rect x="-1.4" y="8" width="2.8" height="6.5" rx=".9" fill="${grip}" stroke="${INK}" stroke-width=".8"/><path d="${st}" stroke="#f4f6f8" stroke-width=".45"/><ellipse cx="0" cy="${hy}" rx="${rx}" ry="${ry}" fill="none" stroke="${INK}" stroke-width="2.4"/><ellipse cx="0" cy="${hy}" rx="${rx}" ry="${ry}" fill="none" stroke="${frame}" stroke-width="1.3"/></g>`;
  }
  function crackPath(cx, cy, n, R, seed, squash = 0.55) {
    let d = '';
    for (let i = 0; i < n; i++) {
      let a = (i / n) * 2 * Math.PI + (hash(i, seed) - 0.5) * 0.5;
      d += `M${cx} ${cy}`;
      for (let k = 1; k <= 4; k++) {
        a += (hash(i * 7 + k, seed) - 0.5) * 0.7;
        const r = (R * k) / 4;
        d += `L${(cx + r * Math.cos(a)).toFixed(1)} ${(cy + r * Math.sin(a) * squash).toFixed(1)}`;
      }
    }
    return d;
  }
  const FLOOR = (fill, line) =>
    `<path d="M0 23H40V40H0Z" fill="${fill}"/><path d="M0 27.5H40M8 23L2 40M32 23L38 40M20 23V40" stroke="${line}" stroke-width=".7" opacity=".75"/>`;
  const ROCK = (x, y, c = '#6b2a1a') =>
    `<path transform="translate(${x} ${y})" d="M0 0l3 -1.2l1.2 2.4l-2.4 1.4Z" fill="${c}" stroke="${INK}" stroke-width=".5"/>`;
  const NET = `<rect x="0" y="27" width="40" height="13" fill="url(#netPat)"/><rect x="0" y="26" width="40" height="1.6" fill="#fff" stroke="${INK}" stroke-width=".5"/>`;
  const FIGURE = `<g fill="#9aa39d" stroke="${INK}" stroke-width=".8" stroke-linejoin="round"><circle cx="16" cy="13.5" r="3.2"/><path d="M13.5 17.5Q11.5 22 13 26L9.5 32H17.5L19 28H23L26 32H30L25.5 24.5Q22.5 21.5 20 17.5Z"/><path d="M18.5 19L23.5 24.5L22 26Z"/></g><path d="M14 20l2 2M22 29l1.5 -2M12 27l2 1" stroke="#5d6560" stroke-width=".6" fill="none"/>`;
  function jobSvg(line, lvl) {
    if (!lvl)
      return (
        disc40('url(#gNovice)', '') + racketV(20, 22, 20, 0.95, '#6f7769', '#c9b38a') + sticker()
      );
    const rim = RIM[lvl];
    switch (line + lvl) {
      case 'red1':
        return (
          disc40('url(#gSmash)', FOCUS) +
          shuttleV(12.5, 27, 45, 0.6) +
          racketV(24, 20, 35, 0.9) +
          sticker(rim)
        );
      case 'red2':
        return (
          disc40(
            'url(#gRed2)',
            FLOOR('#7a1020', '#ffd6dc') +
              `<path d="${crackPath(21, 31, 8, 13, 3)}" stroke="${INK}" stroke-width=".8" fill="none"/>${ROCK(9, 28)}${ROCK(30, 27)}`,
          ) +
          racketV(13, 16, -30, 0.75) +
          shuttleV(21, 27.5, 12, 0.6) +
          sticker(rim)
        );
      case 'red3':
        return (
          disc40(
            'url(#gRed3)',
            `<g class="pulse"><path d="${crackPath(20, 25, 11, 26, 5, 0.7)}" stroke="#ff9a2a" stroke-width="2" fill="none" filter="url(#glowR)"/></g><path d="${crackPath(20, 25, 11, 26, 5, 0.7)}" stroke="#1a0303" stroke-width=".8" fill="none"/><ellipse cx="20" cy="25.5" rx="6.5" ry="3" fill="#1a0303" stroke="#ff8a1f" stroke-width=".8"/><g class="bob">${ROCK(7, 11)}${ROCK(31, 9)}${ROCK(33, 18, '#8a3a20')}${ROCK(5, 19, '#8a3a20')}</g>`,
          ) +
          shuttleV(20, 21.5, 10, 0.72) +
          sticker(rim)
        );
      case 'green1':
        return (
          disc40(
            'url(#gGreen1)',
            `<path d="M5 31Q17 10 35 5Q20 14 8 33Z" fill="#fff" opacity=".9"/>`,
          ) +
          racketV(21, 22, -25, 0.9, '#1f9d55') +
          sticker(rim)
        );
      case 'green2':
        return (
          disc40(
            'url(#gGreen2)',
            `<path d="M5 31Q17 10 35 5Q20 14 8 33Z" fill="#fff" opacity=".9"/><path d="M35 31Q23 10 5 5Q20 14 32 33Z" fill="#c9f5d9" opacity=".85"/>`,
          ) +
          racketV(20, 22, 0, 0.9, '#c9f5d9', '#0f5132') +
          TWINKLE(29, 9, '') +
          sticker(rim)
        );
      case 'green3':
        return (
          disc40(
            'url(#gGreen3)',
            `${FIGURE}${racketV(31, 33, 70, 0.4, '#6f7769', '#555')}<path class="pulse" d="M35 3L38.5 6.5L5.5 38L2 34.5Z" fill="#fff" filter="url(#glow)"/><path d="M35 3L38.5 6.5L5.5 38L2 34.5Z" fill="#eafff2"/><g class="bob">${ROCK(26, 12, '#9aa39d')}${ROCK(9, 9, '#9aa39d')}</g>`,
          ) + sticker(rim)
        );
      case 'yellow1':
        return (
          disc40(
            'url(#gYellow1)',
            `<path d="M9 31V18Q9 11.5 15.5 11.5H23V7.5L31.5 14L23 20.5V16.5H16Q14 16.5 14 18.5V31Z" fill="#fff" stroke="${INK}" stroke-width=".9" stroke-linejoin="round"/>`,
          ) +
          shuttleV(26, 28, -90, 0.45) +
          sticker(rim)
        );
      case 'yellow2':
        return (
          disc40(
            'url(#gYellow2)',
            `<g stroke="#3a3a3a" stroke-width="2.2" fill="none" stroke-dasharray="2.2 1"><path d="M3 33Q13 30 17 22Q21 14 33 12"/><path d="M6 36Q16 33 20 25Q24 17 35 15.5"/></g><g fill="#f4f4f4" stroke="${INK}" stroke-width=".5"><circle cx="7" cy="30" r="2.4"/><circle cx="10.5" cy="33.5" r="2"/><circle cx="4.5" cy="34" r="1.6"/></g>`,
          ) +
          shuttleV(31, 12.5, 70, 0.6) +
          sticker(rim)
        );
      case 'yellow3':
        return (
          disc40(
            'url(#gYellow3)',
            `<rect x="4.5" y="11" width="31" height="16" rx="5" fill="#2b2b33" stroke="${INK}" stroke-width=".9"/><path class="blink" d="M7.5 19L14 13.5V16.8H17.5V21.2H14V24.5Z" fill="#ffb300" filter="url(#glowG)"/><path class="blink" d="M32.5 19L26 13.5V16.8H22.5V21.2H26V24.5Z" fill="#ffb300" filter="url(#glowG)"/><rect x="18.8" y="14" width="2.4" height="10" rx=".8" fill="#e8413c"/><g fill="#fff" opacity=".9"><rect x="4" y="32" width="9" height=".8" rx=".4"/><rect x="7" y="35" width="7" height=".8" rx=".4"/></g>`,
          ) +
          shuttleV(23, 33.5, -90, 0.42) +
          sticker(rim)
        );
      case 'blue1':
        return (
          disc40(
            'url(#gBlue1)',
            `<g stroke="#fff" stroke-width="1.5" fill="none" stroke-linecap="round"><path d="M7 13A14 14 0 0 1 30 7.5"/><path d="M33 27A14 14 0 0 1 10 32.5"/></g><path d="M29 4.5L33.5 8.5L28 10Z" fill="#fff"/><path d="M11 35.5L6.5 31.5L12 30Z" fill="#fff"/>`,
          ) +
          racketV(15, 22, -22, 0.78) +
          racketV(25.5, 22, 22, 0.78, '#ffcc33', '#1f9d55') +
          sticker(rim)
        );
      case 'blue2':
        return (
          disc40(
            'url(#gBlue2)',
            `<rect x="5" y="8" width="30" height="2.4" rx="1" fill="#a0683a" stroke="${INK}" stroke-width=".6"/><g fill="#d9b06b" stroke="${INK}" stroke-width=".4"><circle cx="12" cy="9.2" r=".7"/><circle cx="20" cy="9.2" r=".7"/><circle cx="28" cy="9.2" r=".7"/></g>`,
          ) +
          racketV(12, 24, 0, 0.66, '#e8413c', '#2a62d8') +
          racketV(20, 24, 0, 0.66, '#ffcc33', '#1f9d55') +
          racketV(28, 24, 0, 0.66, '#c9a0ff', '#333') +
          TWINKLE(33, 15, '') +
          sticker(rim)
        );
      case 'blue3':
        return (
          disc40(
            'url(#gBlue3)',
            `${swordV(9.5, 20, 152, 0.85)}${swordV(30.5, 20, 208, 0.85)}${swordV(14.5, 17.5, 170, 0.9)}${swordV(25.5, 17.5, 190, 0.9)}${racketV(20, 22, 2, 0.62, '#ffcc33', '#e8413c')}<path d="M0 40V33Q6 27.5 13 28.5Q20 26.5 27 28.5Q34 27.5 40 33V40Z" fill="#2c3350" stroke="${INK}" stroke-width=".7"/>${swordV(13, 33.5, 82, 0.7)}${swordV(27, 34, -78, 0.7)}${COIN(7, 34)}${COIN(33.5, 35)}${COIN(20, 35.5)}${COIN(24.5, 31.5)}<g class="tw">${TWINKLE(9.5, 13, '')}</g><g class="tw tw2">${TWINKLE(31, 12.5, '')}</g>`,
          ) + sticker(rim)
        );
      case 'pink1':
        return (
          disc40(
            'url(#gPink1)',
            `${NET}<path d="M5 11Q15 3 20 18" stroke="#fff" stroke-width=".9" stroke-dasharray="1 1.4" fill="none"/>`,
          ) +
          shuttleV(22, 19.5, 15, 0.6) +
          sticker(rim)
        );
      case 'pink2':
        return (
          disc40('url(#gPink2)', `${NET}${heartAt(20, 17, 0.85, '#ff3d7f')}`) +
          shuttleV(20, 19, 0, 0.55) +
          TWINKLE(8, 8, '') +
          TWINKLE(32, 11, '') +
          sticker(rim)
        );
      case 'pink3':
        return (
          disc40(
            'url(#gPink3)',
            `${heartAt(8, 30, 0.22, '#ffd1e6', 'rise')}${heartAt(32, 31, 0.18, '#ffd1e6', 'rise d1')}${heartAt(30, 14, 0.2, '#ffd1e6', 'rise d2')}`,
          ) +
          `<g class="beat"><path d="${HEART}" transform="translate(20 20.5) scale(1.25) translate(-20 -20)" fill="url(#gHeart)" stroke="${INK}" stroke-width=".7"/><ellipse cx="14.5" cy="15" rx="2" ry="1.2" fill="#fff" opacity=".8" transform="rotate(-30 14.5 15)"/></g>` +
          shuttleV(20.5, 20.5, -15, 0.5) +
          sticker(rim)
        );
    }
  }
  const NOVICE = ['Novice', 'มือใหม่'];
  const PIP_CROWN = `<svg viewBox="0 0 24 18" aria-hidden="true"><path d="M2 15 0.5 3.5 7 8 12 0.5 17 8 23.5 3.5 22 15Z" fill="#173f35"/><rect x="2" y="15.5" width="20" height="2.5" rx="1" fill="#173f35"/></svg>`;
  const DEFS = `<clipPath id="jb-clip"><circle cx="20" cy="20" r="19.4"/></clipPath><pattern id="jb-netPat" width="2.5" height="2.5" patternUnits="userSpaceOnUse"><path d="M0 0H2.5V2.5" fill="none" stroke="#fff" stroke-width=".4" opacity=".85"/></pattern><linearGradient id="jb-gNovice" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e3e6de"/><stop offset="1" stop-color="#a3aa9b"/></linearGradient><radialGradient id="jb-gSmash"><stop offset="0" stop-color="#ff6b6b"/><stop offset="1" stop-color="#a50f2d"/></radialGradient><radialGradient id="jb-gRed2" cx=".5" cy=".35"><stop offset="0" stop-color="#ef4b5a"/><stop offset="1" stop-color="#7a0a1c"/></radialGradient><radialGradient id="jb-gRed3" cx=".5" cy=".62"><stop offset="0" stop-color="#ff6a2a"/><stop offset=".45" stop-color="#8a1010"/><stop offset="1" stop-color="#2a0404"/></radialGradient><linearGradient id="jb-gGreen1" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#9be8b2"/><stop offset="1" stop-color="#1f9d55"/></linearGradient><linearGradient id="jb-gGreen2" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#43c47a"/><stop offset="1" stop-color="#0f5132"/></linearGradient><radialGradient id="jb-gGreen3" cx=".5" cy=".4"><stop offset="0" stop-color="#34c77b"/><stop offset="1" stop-color="#05301c"/></radialGradient><linearGradient id="jb-gYellow1" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff4a3"/><stop offset="1" stop-color="#f5c400"/></linearGradient><linearGradient id="jb-gYellow2" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffe066"/><stop offset="1" stop-color="#f29e00"/></linearGradient><radialGradient id="jb-gYellow3"><stop offset="0" stop-color="#fff07a"/><stop offset="1" stop-color="#e09a00"/></radialGradient><linearGradient id="jb-gPink1" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffd6ea"/><stop offset="1" stop-color="#ff8fc2"/></linearGradient><linearGradient id="jb-gPink2" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffa6d1"/><stop offset="1" stop-color="#d9408a"/></linearGradient><radialGradient id="jb-gPink3"><stop offset="0" stop-color="#ff8cc0"/><stop offset="1" stop-color="#9c0052"/></radialGradient><linearGradient id="jb-gHeart" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff9cc2"/><stop offset="1" stop-color="#e0004f"/></linearGradient><linearGradient id="jb-gBlue1" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#a8d4ff"/><stop offset="1" stop-color="#2f7be0"/></linearGradient><linearGradient id="jb-gBlue2" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5aa2f0"/><stop offset="1" stop-color="#164a9e"/></linearGradient><radialGradient id="jb-gBlue3" cx=".5" cy=".35"><stop offset="0" stop-color="#4a8cff"/><stop offset="1" stop-color="#081a48"/></radialGradient><linearGradient id="jb-gBlade" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#ffffff"/><stop offset=".5" stop-color="#cfd8e3"/><stop offset="1" stop-color="#8a97a8"/></linearGradient><linearGradient id="jb-gHolyWing" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset=".6" stop-color="#fff2c4"/><stop offset="1" stop-color="#f0c35a"/></linearGradient><filter id="jb-glow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation=".8" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter><filter id="jb-glowR" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="1.1" result="b"/><feFlood flood-color="#ff2a4d"/><feComposite in2="b" operator="in" result="c"/><feMerge><feMergeNode in="c"/><feMergeNode in="SourceGraphic"/></feMerge></filter><filter id="jb-glowG" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="1.2" result="b"/><feFlood flood-color="#ffd86b"/><feComposite in2="b" operator="in" result="c"/><feMerge><feMergeNode in="c"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`;
  const prefix = svg =>
    svg
      .replace(/url\(#clipC\)/g, 'url(#jb-clip)')
      .replace(/url\(#([\w-]+)\)/g, (m, id) => (id.startsWith('jb-') ? m : `url(#jb-${id})`))
      .replace(
        /class="([^"]*)"/g,
        (m, c) =>
          `class="${c
            .split(' ')
            .filter(Boolean)
            .map(x => 'jb-' + x)
            .join(' ')}"`,
      );
  const cache = new Map();
  const art = (line, lvl) => {
    const k = line + lvl;
    if (!cache.has(k)) cache.set(k, prefix(jobSvg(line, lvl)));
    return cache.get(k);
  };
  const resolve = badge => {
    const line = Rules.LINES.includes(badge?.line) ? badge.line : null;
    const { lvl, stars } = Rules.jobLevel(badge?.plays);
    return line && lvl
      ? { line, lvl, stars, names: JOBS[line].jobs[lvl - 1] }
      : { line, lvl: 0, stars: 0, names: NOVICE };
  };
  const esc = s =>
    String(s).replace(
      /[&<>"']/g,
      c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
    );
  const jobName = badge => resolve(badge).names[0];
  const jobThai = badge => resolve(badge).names[1];
  function badgeHtml(badge, size, { mine = false } = {}) {
    const r = resolve(badge);
    const titles = Math.max(0, Number(badge?.titles) || 0);
    const ready = mine && !badge?.chosen && Rules.jobLevel(badge?.plays).lvl >= 1;
    const label =
      r.names[0] + (titles ? ` แชมป์ ${titles} ครั้ง` : '') + (ready ? ' ยังไม่ได้เลือกสาย' : '');
    const pip = titles
      ? `<span class="jb-pip${badge.latestChamp ? ' jb-fresh' : ''}" style="font-size:${size * 0.5}px">${PIP_CROWN}${titles > 1 ? `<b>${titles}</b>` : ''}</span>`
      : '';
    const mark = ready ? `<span class="jb-ready" style="font-size:${size * 0.42}px">!</span>` : '';
    const stars = r.stars
      ? `<span class="jb-stars" style="font-size:${Math.max(7, size * 0.22)}px">${'★'.repeat(r.stars)}</span>`
      : '';
    return `<span class="jb-badge" style="width:${size}px;height:${size}px" role="img" aria-label="${esc(label)}"><svg viewBox="0 0 40 40" aria-hidden="true">${art(r.line, r.lvl)}</svg>${pip}${mark}${stars}</span>`;
  }
  const defsHtml = () =>
    `<svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false"><defs>${DEFS}</defs></svg>`;
  root.SenaJobs = { JOBS, NOVICE, jobName, jobThai, badgeHtml, defsHtml, resolve };
})(typeof window === 'undefined' ? globalThis : window);
