// คิวสนาม page (/queue). Renders the shared queue from /api/queue; organizers send intents,
// everyone else watches (polling). Look and court animations come from the owner's demo.
(() => {
  'use strict';
  const params = new URLSearchParams(location.search);
  const club = params.get('club') === '88' ? '88' : 'sena';
  const clubQuery = club === '88' ? '?club=88' : '';
  const api = '/api/queue' + clubQuery;
  const Q = window.SenaQueue;
  const $ = s => document.querySelector(s);
  $('#clubSelect').value = club;
  $('#clubSelect').onchange = () =>
    location.assign('/queue' + ($('#clubSelect').value === '88' ? '?club=88' : ''));
  $('#homeLink').href = '/court' + clubQuery;
  $('#clubBrand').textContent = club === '88' ? '88' : 'SENA';
  $('#clubSub').textContent = club === '88' ? '88 BADMINTON CLUB' : 'SENA BADMINTON CLUB';
  const esc = s =>
    String(s).replace(
      /[&<>"']/g,
      c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
    );
  const LEVELS = [3, 3.5, 4, 4.5, 5, 5.5, 6, 6.5, 7, 7.5, 8, 8.5, 9];
  let D = null, // last /api/queue answer
    S = null,
    showLv = true,
    busy = false,
    toastTimer,
    prevKeys = null,
    prevStats = null,
    soundOn = false,
    audio,
    walkins = [], // setup: typed-in players before the queue starts
    picked = null; // setup: Set of chosen ids

  const admin = () => !!D?.canEdit;
  const lvOn = () => admin() && showLv;
  const P = id => S.players[id];
  const label = c => Q.label(S, c);
  const toast = t => {
    const el = $('#toast');
    el.textContent = t;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      el.hidden = true;
    }, 2800);
  };

  // ---------- server ----------
  async function load(quiet) {
    try {
      const r = await fetch(api, { cache: 'no-store', credentials: 'same-origin' });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'โหลดคิวไม่สำเร็จ');
      if (quiet && D && data.revision === D.revision && data.canEdit === D.canEdit) return;
      take(data);
    } catch (e) {
      if (!quiet) $('#status').textContent = e.message || 'โหลดคิวไม่สำเร็จ';
    }
  }
  function take(data) {
    D = data;
    S = data.state;
    $('#status').hidden = true;
    render();
  }
  async function send(action, extra = {}, after) {
    if (busy || !D) return;
    busy = true;
    document.body.classList.add('busy');
    try {
      const r = await fetch(api, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, revision: D.revision, ...extra }),
      });
      const data = await r.json().catch(() => ({}));
      if (data.state !== undefined && data.revision !== undefined) take(data);
      if (!r.ok) return toast(data.error || 'บันทึกไม่สำเร็จ');
      if (data.message) toast(data.message);
      after && after();
    } catch {
      toast('เชื่อมต่อไม่ได้ ลองอีกครั้ง');
    } finally {
      busy = false;
      document.body.classList.remove('busy');
    }
  }

  // ---------- helpers ----------
  const mmss = ms => {
    const s = Math.max(0, Math.floor(ms / 1000));
    return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
  };
  const timer = since =>
    `<span class="num" data-since="${since}">${mmss(Date.now() - since)}</span>`;
  const lvTag = p => (lvOn() ? `<small>Lv ${p.lv}</small>` : '');
  const strength = team => team.reduce((s, id) => s + (P(id).lv || 0), 0);
  const hash = s => [...String(s)].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7);
  const eligibleCount = () =>
    Object.values(S.players).filter(p => p.status === 'wait' && !(p.skip > 0)).length;

  // ---------- court drawings (from the demo) ----------
  const LINES = `<svg class="lines" viewBox="0 0 100 60" preserveAspectRatio="none" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.6" vector-effect="non-scaling-stroke"><rect x="2" y="2" width="96" height="56" vector-effect="non-scaling-stroke"/><path d="M2 6.3H98M2 53.7H98M7.4 2V58M92.6 2V58M35.8 2V58M64.2 2V58M2 30H35.8M64.2 30H98" vector-effect="non-scaling-stroke"/></g><path class="netline" d="M50 0V60" vector-effect="non-scaling-stroke"/></svg>`;
  const SKINS = ['#f3cfa7', '#e6b78a', '#c98f63', '#f7d9bf'];
  const HAIR = {
    M: ['#1f1a17', '#4a2f1b', '#2b2f3a'],
    F: ['#2a1a12', '#7b3f1d', '#1b1b2a', '#a8561f'],
  };
  const OUT = '#041f17';
  function character(p, team, slot) {
    const h = hash(p.id);
    const skin = SKINS[(h * 3 + 1) % SKINS.length],
      hair = HAIR[p.g === 'F' ? 'F' : 'M'][(h * 5 + 2) % (p.g === 'F' ? 4 : 3)];
    const shirt = team === 'a' ? '#dbfa30' : '#f6f2dd',
      sh = p.g === 'F' ? 11 : 12.5;
    const st = `stroke="${OUT}" stroke-width="1.3" stroke-linejoin="round"`;
    const hit = [0, 3, 4.5, 1.5][slot];
    const tail =
      p.g === 'F'
        ? `<g transform="translate(-8 0)"><g class="pony"><ellipse cx="-5" cy="0" rx="6" ry="3.2" fill="${hair}" ${st}/></g></g><circle cx="-8.5" cy="0" r="1.9" fill="#ff6fa8"/>`
        : '';
    return `<g class="lean" style="animation-delay:${-slot * 0.7}s"><g transform="scale(${team === 'b' ? -1.3 : 1.3} 1.3)">
      <ellipse cx="-1" cy="3" rx="15" ry="13" fill="#041f17" opacity=".35"/>
      <g class="ftA"><ellipse cx="5" cy="-7" rx="5.2" ry="2.7" fill="#f6f2dd" ${st}/></g>
      <g class="ftB"><ellipse cx="-4" cy="7" rx="5.2" ry="2.7" fill="#f6f2dd" ${st}/></g>
      <g transform="translate(0 -10)"><g class="armback"><rect x="-1.5" y="-2.2" width="13" height="4.4" rx="2.2" fill="${skin}" ${st}/></g></g>
      <ellipse cx="0" cy="0" rx="6.8" ry="${sh}" fill="${shirt}" ${st}/>
      <g transform="translate(0 ${sh - 2})"><g class="racketarm" style="animation-delay:${hit - 0.12 - 6}s">
        <rect x="-1" y="-2.2" width="13" height="4.4" rx="2.2" fill="${skin}" ${st}/>
        <circle cx="12.5" cy="0" r="2.6" fill="${skin}" ${st}/>
        <path d="M14 0H22" stroke="#2b2b2b" stroke-width="2.2" stroke-linecap="round"/>
        <ellipse cx="30" cy="0" rx="8.4" ry="6.3" fill="rgba(246,242,221,.12)" stroke="#f6f2dd" stroke-width="1.9"/>
        <path d="M30 -6.3V6.3M24 -3.4L36 3.4M24 3.4L36 -3.4" stroke="#f6f2dd" stroke-width=".6" opacity=".7"/>
      </g></g>
      ${tail}
      <circle cx="1" cy="0" r="8.3" fill="${skin}" ${st}/>
      <path d="M4 -7.2A8.3 8.3 0 1 0 4 7.2Q7.6 0 4 -7.2Z" fill="${hair}" ${st}/>
      <circle cx="6.4" cy="-3" r=".9" fill="${OUT}"/><circle cx="6.4" cy="3" r=".9" fill="${OUT}"/>
    </g></g>`;
  }
  function stageHtml(c) {
    const spots = [
      [
        { x: 108, y: 70 },
        { x: 108, y: 170 },
      ],
      [
        { x: 292, y: 70 },
        { x: 292, y: 170 },
      ],
    ];
    const bodies = [];
    c.teams.forEach((team, ti) => {
      const k = ti === 0 ? 'a' : 'b';
      team.forEach((id, i) => {
        const p = P(id),
          sp = spots[ti][i],
          slot = ti * 2 + i;
        const text = p.name + (lvOn() ? ' · ' + p.lv : '');
        const w = Math.max(44, Math.min(text.length, 18) * 6.4 + 24);
        bodies.push(`<g transform="translate(${sp.x} ${sp.y})"><g class="walk" style="--d:${-slot * 0.9}s;--t:${2.6 + slot * 0.45}s"><g class="char" style="--i:${slot}"><ellipse class="puff" rx="10" ry="10" fill="none" stroke="#dbfa30" stroke-width="2"/>${character(p, k, slot)}</g>
          <g class="tag" style="--i:${slot}" transform="translate(0 25)"><rect x="${-w / 2}" y="-8" width="${w}" height="16" rx="8" fill="${k === 'a' ? '#dbfa30' : '#f6f2dd'}" stroke="${OUT}" stroke-width="1.2"/><text x="${-w / 2 + 9}" y="4" font-size="11" font-weight="800" fill="${p.g === 'F' ? '#c2185b' : '#1565c0'}">${p.g === 'F' ? '♀' : '♂'}</text><text x="${-w / 2 + 20}" y="4" font-size="11" font-weight="800" fill="${OUT}">${esc(text.length > 18 ? text.slice(0, 17) + '…' : text)}</text></g></g></g>`);
      });
    });
    return `<div class="pitch play"><svg viewBox="0 0 400 240" role="img" aria-label="กำลังตี ${esc(c.teams.map(t => t.map(id => P(id).name).join(' กับ ')).join(' สู้ '))}">
      <rect width="400" height="240" fill="#0a281d"/>
      <rect x="12" y="12" width="376" height="216" fill="#1d5a3b"/>
      <g fill="none" stroke="#e8f2cf" stroke-width="1.8" opacity=".8"><rect x="12" y="12" width="376" height="216"/><path d="M12 28H388M12 212H388M33 12V228M367 12V228M144 12V228M256 12V228M12 120H144M256 120H388"/></g>
      <path d="M200 6V234" stroke="#dbfa30" stroke-width="3" stroke-dasharray="5 5"/>
      <g class="shuttle-top"><ellipse class="sh-shadow" cx="3" cy="9" rx="5" ry="2.2" fill="#041f17" opacity=".4"/><g class="lift"><path d="M-2 0L-11 -5.5L-8 0L-11 5.5Z" fill="#dbfa30" stroke="${OUT}" stroke-width=".9"/><circle cx="1.5" cy="0" r="3.3" fill="#f6f2dd" stroke="${OUT}" stroke-width=".9"/></g></g>
      ${bodies.join('')}
    </svg></div>`;
  }
  function sideHtml(c, team, k) {
    return `<div class="side ${k}">${team
      .map((id, i) => {
        const p = P(id);
        const rest =
          c.phase === 'called' && admin()
            ? `<button class="rest" type="button" data-act="rest" data-court="${c.n - 1}" data-pid="${esc(id)}" aria-label="พัก ${esc(p.name)}">พัก</button>`
            : '';
        return `<div class="who" style="--i:${i + (k === 'b' ? 2 : 0)}"><span class="n">${esc(p.name)}</span>${lvTag(p)}${rest}</div>`;
      })
      .join('')}</div>`;
  }
  function courtHtml(c, fresh) {
    const i = c.n - 1;
    let state,
      body,
      actions = '';
    if (c.phase === 'idle') {
      state = '<span class="state">ว่าง</span>';
      body = `<div class="pitch idle">${LINES}<div class="pitch-empty">รอคนพร้อมให้ครบ 4 คน<br><small>ตอนนี้พร้อม ${eligibleCount()} คน</small></div></div>`;
    } else {
      const [a, b] = c.teams;
      const sa = strength(a),
        sb = strength(b);
      body = `${c.phase === 'playing' ? stageHtml(c) : `<div class="pitch">${LINES}${sideHtml(c, a, 'a')}${sideHtml(c, b, 'b')}</div>`}
        ${lvOn() ? `<div class="balance"><span>ผลรวม Lv ${sa} vs ${sb}</span><span>ต่างกัน ${Math.abs(sa - sb)}</span></div>` : ''}`;
      if (c.phase === 'called') {
        state = '<span class="state call"><i class="dot"></i>เรียกลงสนาม</span>';
        actions = `<button class="call-btn" type="button" data-act="startCourt" data-court="${i}">เริ่มตี ▶</button><button class="ghost" type="button" data-act="reroll" data-court="${i}">↻ จัดใหม่</button>`;
      } else {
        state = `<span class="state play"><i class="dot"></i>กำลังตี ${timer(c.startedAt)}</span>`;
        actions = `<button class="finish-btn" type="button" data-act="finish" data-court="${i}">จบการแข่ง</button>`;
      }
    }
    return `<article class="court ${fresh ? 'fresh' : ''}" data-phase="${c.phase}"><div class="court-head"><h2><span>COURT</span> ${esc(label(c))}</h2>${state}</div>${body}${actions && admin() ? `<div class="court-actions">${actions}</div>` : ''}</article>`;
  }

  // ---------- setup (no queue yet) ----------
  function renderSetup() {
    const session = D.session,
      roster = D.roster || [];
    const booked = session?.booked || [];
    if (!picked) picked = new Set(booked.map(p => p.id));
    const bookedIds = new Set(booked.map(p => p.id));
    const others = roster
      .filter(p => !bookedIds.has(p.id))
      .sort((a, b) => a.name.localeCompare(b.name, 'th'));
    const pick = p =>
      `<li><label><input type="checkbox" data-pick="${esc(p.id)}" ${picked.has(p.id) ? 'checked' : ''}>${esc(p.name)}<small>${p.g === 'F' ? '♀' : '♂'} Lv ${p.lv}${p.guest ? ' · แขก' : ''}</small></label></li>`;
    const count = picked.size + walkins.length;
    const autoCourts = session?.courtNumbers?.length || Math.max(1, Math.round(count / 6));
    const courtSel = $('#setupCourts')?.value;
    const courts = courtSel ? +courtSel : Math.min(Q.MAX_COURTS, autoCourts);
    $('#app').innerHTML = `<section class="panel setup" aria-label="เริ่มคิว">
      <div class="setup-head"><h3>เริ่มคิววันนี้ <small>${session ? 'รอบ ' + esc(session.date) + ' · ' + esc(session.start) + '–' + esc(session.end) + (session.courtNumbers.length ? ' · คอร์ต ' + esc(session.courtNumbers.join(', ')) : '') : 'วันนี้ไม่มีรอบที่จองไว้ เลือกจากรายชื่อสมาชิกได้'}</small></h3>${D.canUndo ? '<button type="button" id="setupUndo">↶ กู้คิวที่เพิ่งปิด</button>' : ''}</div>
      ${booked.length ? `<p class="note">คนที่จองรอบวันนี้ (ตัวจริง) ติ๊กออกคนที่ไม่มา</p><ul class="picks">${booked.map(pick).join('')}</ul>` : ''}
      <details ${booked.length ? '' : 'open'}><summary>เพิ่มจากรายชื่อสมาชิก (${others.length})</summary><ul class="picks">${others.map(pick).join('')}</ul></details>
      <div><p class="note">คนนอกรายชื่อ (พิมพ์ชื่อเอง)</p>
        <form class="addpick" id="walkForm"><label>ชื่อ<input id="walkName" maxlength="40" required placeholder="ชื่อเล่น"></label><label>Lv<select id="walkLv">${LEVELS.map(n => `<option ${n === 6.5 ? 'selected' : ''}>${n}</option>`).join('')}</select></label><label>เพศ<select id="walkG"><option value="M">ชาย</option><option value="F">หญิง</option></select></label><button type="submit">เพิ่ม</button></form>
        <div class="walkins">${walkins.map((w, i) => `<span>${esc(w.name)} · ${w.g === 'F' ? '♀' : '♂'} ${w.lv}<button type="button" data-unwalk="${i}" aria-label="ลบ ${esc(w.name)}">✕</button></span>`).join('')}</div></div>
      <div class="go"><label class="note">จำนวนคอร์ต <select id="setupCourts">${Array.from({ length: Q.MAX_COURTS }, (_, n) => `<option ${n + 1 === courts ? 'selected' : ''}>${n + 1}</option>`).join('')}</select></label>
        <button class="call-btn" type="button" id="startQueue" ${count < 4 ? 'disabled' : ''}>เริ่มคิว ${count} คน ▶</button>
        ${count < 4 ? '<span class="note">ต้องมีอย่างน้อย 4 คน</span>' : ''}</div>
    </section>`;
  }

  // ---------- main render ----------
  function render() {
    document.body.classList.toggle('readonly', !admin());
    $('#bar').hidden = !S;
    $('#sync').innerHTML = admin()
      ? `ผู้จัด · ทุกเครื่องเห็นคิวเดียวกัน`
      : `ดูอย่างเดียว · อัปเดตอัตโนมัติ · <a href="/court${club === '88' ? '?club=88' : ''}">ผู้จัดเข้าสู่ระบบที่หน้าหลัก</a>`;
    if (!S) {
      prevKeys = null;
      $('#summary').innerHTML = '';
      $('#rules').hidden = true;
      if (admin()) return renderSetup();
      $('#app').innerHTML =
        '<section class="panel empty-queue"><h3>ยังไม่เริ่มคิววันนี้</h3><p class="note">ผู้จัดเริ่มคิวแล้วหน้านี้จะแสดงคอร์ตให้เอง</p></section>';
      return;
    }
    $('#rules').hidden = false;
    picked = null;
    walkins = [];
    const all = Object.values(S.players);
    const live = all.filter(p => p.status !== 'gone');
    const total = all.reduce((s, p) => s + p.games, 0);
    let pairs = 0,
      unmet = 0;
    for (let i = 0; i < live.length; i++)
      for (let j = i + 1; j < live.length; j++) {
        pairs++;
        if (!S.meet[Q.key(live[i].id, live[j].id)]) unmet++;
      }
    $('#summary').innerHTML =
      `<span><b class="num">${live.length}</b>ผู้เล่น</span><span><b class="num">${total / 4}</b>เกมที่ตี</span><span><b class="num">${unmet}<small>/${pairs}</small></b>คู่ที่ยังไม่เคยเจอกัน</span>`;

    const keys = S.courts.map(c => c.phase + ':' + JSON.stringify(c.teams));
    const justCalled =
      prevKeys && S.courts.some((c, i) => c.phase === 'called' && keys[i] !== prevKeys[i]);
    const courtsHtml = S.courts
      .map((c, i) => courtHtml(c, !prevKeys || keys[i] !== prevKeys[i]))
      .join('');
    prevKeys = keys;
    if (justCalled) alertCall();

    const waiting = all.filter(p => p.status === 'wait').sort(Q.byOrder);
    let nextShown = 0;
    const called = all.filter(p => p.status === 'called').length;
    const queueHtml = `<h3>คิวรอ <small>${waiting.length} คน${called ? ' · กำลังถูกเรียก ' + called : ''}</small></h3>
      <ol class="rows">${
        waiting
          .map((p, i) => {
            const skipped = p.skip > 0,
              isNext = !skipped && ++nextShown <= 4;
            return `<li class="row ${isNext ? 'next' : ''}"><span class="pos num">${i + 1}</span><span class="nm">${esc(p.name)}${skipped ? ' <em class="skip">ข้ามรอบนี้</em>' : ''}<small>${lvOn() ? 'Lv ' + p.lv + ' · ' : ''}ตี ${p.games} เกม · รอ ${timer(p.since)}</small></span><button type="button" data-act="skip" data-pid="${esc(p.id)}" ${skipped ? 'disabled' : ''}>พักก่อน</button><button type="button" data-act="leave" data-pid="${esc(p.id)}" aria-label="${esc(p.name)} กลับบ้าน">กลับบ้าน</button></li>`;
          })
          .join('') || '<li class="note">ไม่มีคนรอ</li>'
      }</ol>
      <p class="note">สีเขียว = คิวที่จะถูกเรียกต่อไป (ตีน้อยสุดก่อน แล้วรอนานสุด) · คนที่กดพักยังอยู่ในคิว แค่ข้ามการเรียกครั้งถัดไป</p>`;

    const inQueue = new Set(all.filter(p => p.status !== 'gone').map(p => p.id));
    const gone = all.filter(p => p.status === 'gone');
    const addable = (D.roster || [])
      .filter(p => !inQueue.has(p.id) && !Object.hasOwn(S.players, p.id))
      .sort((a, b) => a.name.localeCompare(b.name, 'th'));
    const sideHtml = admin()
      ? `<h3>มีคนมาสาย</h3>
      ${
        addable.length || gone.length
          ? `<form class="addpick" id="pickForm"><label>จากรายชื่อ<select id="addPid">${gone.map(p => `<option value="${esc(p.id)}">${esc(p.name)} (กลับมา)</option>`).join('')}${addable.map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</select></label><button type="submit">เพิ่มเข้าคิว</button></form>`
          : ''
      }
      <form class="add" id="addForm"><label>ชื่อ (คนนอก)<input id="addName" maxlength="40" required placeholder="ชื่อเล่น"></label><label>Lv<select id="addLv">${LEVELS.map(n => `<option ${n === 6.5 ? 'selected' : ''}>${n}</option>`).join('')}</select></label><label>เพศ<select id="addG"><option value="M">ชาย</option><option value="F">หญิง</option></select></label><button type="submit">เพิ่มเข้าคิว</button></form>
      <h3>บันทึกล่าสุด</h3>
      <ul class="log">${S.log
        .slice(0, 6)
        .map(l => `<li>${esc(l.txt)}</li>`)
        .join('')}</ul>`
      : `<h3>บันทึกล่าสุด</h3><ul class="log">${S.log
          .slice(0, 8)
          .map(l => `<li>${esc(l.txt)}</li>`)
          .join('')}</ul>`;

    const hist = S.history || [];
    const decided = hist.filter(h => h.win).length,
      playingNow = S.courts.filter(c => c.phase === 'playing').length;
    const statsHtml = `<h3>สรุปผลรายคน <small>จบแล้ว ${hist.length} เกม · มีผล ${decided} · ไม่ระบุ ${hist.length - decided}${playingNow ? ' · กำลังตี ' + playingNow : ''}</small></h3>
      <div class="tablewrap"><table class="stats"><thead><tr><th scope="col">ผู้เล่น</th><th scope="col">ตี</th><th scope="col">ชนะ</th><th scope="col">แพ้</th><th scope="col">ไม่ระบุ</th></tr></thead><tbody>${all
        .map(
          p =>
            `<tr class="${p.status === 'gone' ? 'gone' : ''} ${prevStats && prevStats[p.id] !== undefined && prevStats[p.id] !== [p.games, p.wins, p.losses, p.nores].join() ? 'flash' : ''}"><th scope="row">${esc(p.name)}${p.status === 'play' ? ' <i class="dot-live" title="กำลังตี"></i>' : ''}${p.status === 'gone' ? ' <small>กลับแล้ว</small>' : ''}</th><td class="num">${p.games}</td><td class="num w">${p.wins || 0}</td><td class="num l">${p.losses || 0}</td><td class="num n">${p.nores || 0}</td></tr>`,
        )
        .join('')}</tbody></table></div>
      <p class="note">"ตี" นับตั้งแต่กดเริ่มตี (รวมเกมที่กำลังตีอยู่ ● ) · ชนะ + แพ้ + ไม่ระบุ = เกมที่จบแล้ว</p>`;
    prevStats = Object.fromEntries(
      all.map(p => [p.id, [p.games, p.wins, p.losses, p.nores].join()]),
    );
    const hm = t =>
      new Date(t).toLocaleTimeString('th-TH', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Asia/Bangkok',
      });
    const historyHtml = `<h3>ประวัติการแข่ง <small>จบแล้ว ${hist.length} เกม</small></h3>
      <ol class="hist" reversed>${
        hist
          .slice(0, 30)
          .map(
            h =>
              `<li><div class="hmeta"><b>คอร์ต ${esc(Q.label(S, h))}</b><span class="num">${hm(h.start)}–${hm(h.end)} · ${mmss(h.end - h.start)}</span></div><div class="hteams"><span class="${h.win === 'a' ? 'won' : ''}">${h.a.map(esc).join(' + ')}${h.win === 'a' ? ' <i>ชนะ</i>' : ''}</span><em>vs</em><span class="${h.win === 'b' ? 'won' : ''}">${h.b.map(esc).join(' + ')}${h.win === 'b' ? ' <i>ชนะ</i>' : ''}</span>${h.win ? '' : '<small>ไม่ระบุผล</small>'}</div>${lvOn() ? `<small class="num">Lv ${h.sa} vs ${h.sb}</small>` : ''}</li>`,
          )
          .join('') || '<li class="note">ยังไม่มีเกมที่จบ กด "จบการแข่ง" แล้วจะมาอยู่ตรงนี้</li>'
      }</ol>`;

    $('#app').innerHTML = `<section class="courts" aria-label="สนาม">${courtsHtml}</section>
      <section class="panels"><div class="panel">${queueHtml}</div><div class="panel">${sideHtml}</div></section>
      <section class="panel" aria-label="สรุปผลรายคน">${statsHtml}</section>
      <section class="panel" aria-label="ประวัติการแข่ง">${historyHtml}</section>`;

    $('#courtCount').textContent = S.courts.length;
    $('#courtPlus').disabled = S.courts.length >= Q.MAX_COURTS;
    $('#courtMinus').disabled = S.courts.length <= 1;
    $('#undo').disabled = !D.canUndo;
    for (const el of document.querySelectorAll('.admin-only')) el.hidden = !admin();
    $('#lvToggle').textContent = 'Lv: ' + (showLv ? 'แสดง' : 'ซ่อน');
    $('#lvToggle').setAttribute('aria-pressed', String(showLv));
  }

  // ---------- events ----------
  document.addEventListener('click', e => {
    const pickBox = e.target.closest('input[data-pick]');
    if (pickBox) {
      pickBox.checked ? picked.add(pickBox.dataset.pick) : picked.delete(pickBox.dataset.pick);
      return renderSetup();
    }
    const un = e.target.closest('button[data-unwalk]');
    if (un) {
      walkins.splice(+un.dataset.unwalk, 1);
      return renderSetup();
    }
    if (e.target.closest('#setupUndo')) return send('undo');
    if (e.target.closest('#startQueue')) {
      return send('start', {
        ids: [...picked],
        extra: walkins,
        courts: +$('#setupCourts').value,
      });
    }
    const b = e.target.closest('button[data-act]');
    if (!b || !admin() || !S) return;
    const court = b.dataset.court != null ? +b.dataset.court : undefined,
      pid = b.dataset.pid;
    const act = b.dataset.act;
    if (act === 'finish') return openFinish(S.courts[court]);
    if (act === 'leave' && !confirm(P(pid).name + ' กลับบ้าน? (กดเพิ่มกลับเข้าคิวได้ทีหลัง)'))
      return;
    send(act, { court, pid });
  });
  document.addEventListener('submit', e => {
    e.preventDefault();
    const id = e.target.id;
    if (id === 'walkForm') {
      const name = $('#walkName').value.trim();
      if (!name) return;
      walkins.push({ name, lv: +$('#walkLv').value, g: $('#walkG').value });
      renderSetup();
      $('#walkName').focus();
    } else if (id === 'addForm') {
      const name = $('#addName').value.trim();
      if (name) send('add', { player: { name, lv: +$('#addLv').value, g: $('#addG').value } });
    } else if (id === 'pickForm') {
      send('add', { pid: $('#addPid').value });
    }
  });
  document.addEventListener('change', e => {
    if (e.target.id === 'setupCourts') renderSetup();
  });
  $('#undo').onclick = () => send('undo');
  $('#courtPlus').onclick = () => send('addCourt');
  $('#courtMinus').onclick = () => {
    const last = S.courts[S.courts.length - 1];
    if (last.phase === 'playing')
      return toast('คอร์ต ' + label(last) + ' กำลังตีอยู่ จบเกมก่อนแล้วค่อยลดคอร์ต');
    send('removeCourt');
  };
  $('#endQueue').onclick = () => {
    if (confirm('ปิดคิววันนี้? (กด "ย้อนกลับ" ได้ถ้ากดผิด)')) send('end');
  };
  $('#lvToggle').onclick = () => {
    showLv = !showLv;
    render();
  };
  try {
    soundOn = localStorage.getItem('sena-queue-sound') === '1';
  } catch {
    /* storage blocked */
  }
  const paintSound = () => {
    $('#soundToggle').textContent = 'เสียงเรียก: ' + (soundOn ? 'เปิด' : 'ปิด');
    $('#soundToggle').setAttribute('aria-pressed', String(soundOn));
  };
  $('#soundToggle').onclick = () => {
    soundOn = !soundOn;
    paintSound();
    try {
      localStorage.setItem('sena-queue-sound', soundOn ? '1' : '0');
    } catch {
      /* storage blocked */
    }
    if (soundOn) alertCall();
  };
  paintSound();

  // ---------- effects ----------
  const calm = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  function confetti(x, y, count = 90) {
    if (calm()) return;
    const cv = $('#fx'),
      ctx = cv.getContext('2d'),
      dpr = devicePixelRatio || 1;
    cv.width = innerWidth * dpr;
    cv.height = innerHeight * dpr;
    ctx.scale(dpr, dpr);
    const colors = ['#dbfa30', '#f6f2dd', '#7b9e62', '#ffffff', '#b6dc2a'];
    const bits = Array.from({ length: count }, () => {
      const a = Math.random() * Math.PI * 2,
        v = 3 + Math.random() * 7;
      return {
        x,
        y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v - 5,
        w: 5 + Math.random() * 6,
        h: 3 + Math.random() * 5,
        r: Math.random() * 6,
        vr: (Math.random() - 0.5) * 0.4,
        c: colors[Math.floor(Math.random() * colors.length)],
      };
    });
    let frame = 0;
    (function tick() {
      ctx.clearRect(0, 0, innerWidth, innerHeight);
      bits.forEach(b => {
        b.vy += 0.28;
        b.vx *= 0.99;
        b.x += b.vx;
        b.y += b.vy;
        b.r += b.vr;
        ctx.save();
        ctx.translate(b.x, b.y);
        ctx.rotate(b.r);
        ctx.globalAlpha = Math.max(0, 1 - frame / 90);
        ctx.fillStyle = b.c;
        ctx.fillRect(-b.w / 2, -b.h / 2, b.w, b.h);
        ctx.restore();
      });
      if (++frame < 90) requestAnimationFrame(tick);
      else ctx.clearRect(0, 0, innerWidth, innerHeight);
    })();
  }
  function alertCall() {
    if (!soundOn) return;
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      [660, 880].forEach((f, i) => {
        const o = audio.createOscillator(),
          g = audio.createGain(),
          t = audio.currentTime + i * 0.16;
        o.type = 'sine';
        o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
        o.connect(g);
        g.connect(audio.destination);
        o.start(t);
        o.stop(t + 0.32);
      });
    } catch {
      /* audio blocked */
    }
    try {
      navigator.vibrate && navigator.vibrate([90, 50, 90]);
    } catch {
      /* not supported */
    }
  }
  // Confirm dialog: who won (or leave it blank) before the court is closed.
  function openFinish(c) {
    const dlg = $('#finishDlg'),
      [a, b] = c.teams;
    const side = (team, k) =>
      `<button type="button" class="win-btn" data-win="${k}"><span class="wl">ฝั่ง${k === 'a' ? 'ซ้าย' : 'ขวา'}ชนะ</span><span class="wn">${team.map(id => esc(P(id).name)).join(' + ')}</span></button>`;
    dlg.innerHTML = `<form method="dialog" class="dlg"><h2>จบการแข่ง คอร์ต ${esc(label(c))}</h2><p class="note">ใครชนะ? ผลจะบันทึกในประวัติการแข่ง</p><div class="win-row">${side(a, 'a')}${side(b, 'b')}</div><button type="button" class="skipwin" data-win="">ไม่ระบุผล แค่จบเกม</button><button type="button" class="cancelwin" data-win="cancel">ยกเลิก (ยังตีอยู่)</button></form>`;
    dlg.onclick = e => {
      const w = e.target.closest('[data-win]');
      if (!w) {
        if (e.target === dlg) dlg.close();
        return;
      }
      const v = w.dataset.win;
      dlg.close();
      if (v === 'cancel') return;
      const box = (
        document.querySelectorAll('.court')[c.n - 1]?.querySelector('.pitch') || document.body
      ).getBoundingClientRect();
      send('finish', { court: c.n - 1, win: v || null }, () => {
        if (v)
          confetti(box.left + box.width * (v === 'a' ? 0.28 : 0.72), box.top + box.height * 0.45);
        else confetti(box.left + box.width / 2, box.top + box.height / 2, 14);
      });
    };
    dlg.showModal();
  }

  setInterval(() => {
    document.querySelectorAll('[data-since]').forEach(el => {
      el.textContent = mmss(Date.now() - +el.dataset.since);
    });
  }, 1000);
  // Everyone follows the shared queue; skip polling while hidden or while a dialog/form is in use.
  setInterval(() => {
    if (document.hidden || busy || $('#finishDlg').open) return;
    if (!S && admin()) return; // organizer is filling the setup form
    if (document.activeElement?.matches('input, select')) return;
    load(true);
  }, 4000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) load(true);
  });
  load();
})();
