(function () {
  'use strict';
  const root = document.getElementById('booking');
  if (!root) return;
  const q = s => root.querySelector(s);
  const mobileDetails = matchMedia('(max-width: 760px)');
  const html = s =>
    String(s ?? '').replace(
      /[&<>"']/g,
      c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
    );
  const days = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัส', 'ศุกร์', 'เสาร์'];
  let showAllDates = false,
    cupDirty = false;
  const cupBadge = `<strong class="booking-cup-badge">🏆 ${html(cupName)} <span>· วันแข่งขัน</span></strong>`;
  const defaultCupDate = (date, week) => Math.ceil(Number(date.slice(8, 10)) / 7) === week;
  let data = null,
    busy = false,
    dirty = false,
    focusId = '',
    selected = new Set(),
    playerId = '',
    token = null,
    pendingCancellation = null,
    sponsorEditing = null,
    serverClockOffset = 0;
  const sponsorAwards = [
    ['champ', '🥇 แชมป์'],
    ['runnerUp', '🥈 รองแชมป์'],
    ['third', '🥉 ที่ 3'],
    ['last', '💩 ท้ายตาราง'],
    ['all', 'ทุกคน'],
    ['other', 'อื่นๆ'],
  ];
  const inLine = /\bLine\//i.test(navigator.userAgent);
  try {
    token = localStorage.getItem(clubStorage('booking-token'));
    if (!/^[a-f0-9]{64}$/.test(token || '')) {
      token = Array.from(crypto.getRandomValues(new Uint8Array(32)), x =>
        x.toString(16).padStart(2, '0'),
      ).join('');
      localStorage.setItem(clubStorage('booking-token'), token);
    }
    playerId = localStorage.getItem(clubStorage('booking-player')) || '';
  } catch {
    token = null;
  }
  const displayDate = d =>
    new Date(d + 'T12:00:00+07:00').toLocaleDateString('th-TH', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'Asia/Bangkok',
    });
  const displayTimestamp = value =>
    new Date(value).toLocaleString('th-TH', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      timeZone: 'Asia/Bangkok',
    }) + ' น.';
  const sessionOf = s => s || data?.sessions.find(x => x.id === focusId);
  const guest = (id, s) => sessionOf(s)?.registrations.find(r => r.playerId === id)?.guest;
  const player = (id, s) => data?.roster.find(p => p.id === id) ?? guest(id, s);
  const rawName = (id, s) => player(id, s)?.name || 'ผู้เล่นที่นำออกจากก๊วน';
  const name = (id, short = false, s = null) => {
    const invited = sessionOf(s)?.registrations.find(r => r.playerId === id)?.invitedBy;
    if (invited && !short)
      return rawName(id, s) + ' (จองโดย ' + rawName(invited, s) + ' · จ่ายแทน)';
    const extra = guest(id, s);
    if (extra)
      return short ? extra.name : extra.name + ' (แขกของ ' + rawName(extra.hostId, s) + ')';
    // The job badge crown replaces 🥇; the 💩 joke stays in front of the name.
    const award = player(id, s)?.award === '🥇' ? '' : player(id, s)?.award;
    return award ? award + ' ' + rawName(id, s) : rawName(id, s);
  };
  // Game lists: guests and invited friends are shown by their own name only; the roster keeps
  // "แขกของ …" / "จองโดย …".
  const gameName = id => name(id, true);
  const level = id => player(id)?.lv;
  const rosterBadge = r => (!r.guest && data?.roster.find(p => p.id === r.playerId)?.badge) || null;
  let jobTarget = null;
  function badgeFor(r) {
    const badge = rosterBadge(r),
      mine = Boolean(badge) && data?.member?.playerId === r.playerId,
      art = SenaJobs.badgeHtml(badge ?? { plays: 0 }, 35, { mine });
    if (!badge || !(mine || data?.canEdit)) return art;
    const label = mine ? 'เลือกสาย job ของฉัน' : 'เลือกสาย job ให้ ' + rawName(r.playerId);
    return `<button type="button" class="jb-own" data-job-pick="${html(r.playerId)}" aria-label="${html(label)}">${art}</button>`;
  }
  // Short play count: organizers see everyone's, players see their own with the next goal.
  function playCount(r) {
    const badge = rosterBadge(r),
      mine = Boolean(badge) && data?.member?.playerId === r.playerId;
    if (!badge || !(mine || data?.canEdit)) return '';
    const goal = mine ? SenaJobRules.nextGoal(badge.plays) : null;
    return ' · 🏸' + badge.plays + (goal ? '/' + goal : '');
  }
  function openJobPicker(playerId) {
    const target = data?.roster.find(p => p.id === playerId);
    if (!target?.badge) return;
    jobTarget = playerId;
    const own = target.badge,
      mine = playerId === data?.member?.playerId;
    jobPicker.querySelector('#jobPickerTitle').textContent = mine
      ? 'เลือกสายของคุณ'
      : 'เลือกสายให้ ' + target.name;
    jobPicker.querySelector('#jobPickerStatus').textContent = '';
    jobPicker.querySelector('#jobPickerGrid').innerHTML = SenaJobRules.LINES.map(line => {
      const preview = {
        ...own,
        line,
        chosen: true,
        plays: Math.min(30, Math.max(5, own.plays)),
        titles: 0,
      };
      const current = own.chosen && own.line === line;
      return `<button type="button" data-job-line="${line}" aria-pressed="${current}" style="--jb-line:${SenaJobs.JOBS[line].color}">${current ? '<i class="job-picker-check" aria-hidden="true">✓</i>' : ''}${SenaJobs.badgeHtml(preview, 48)}<b>${html(SenaJobs.JOBS[line].th)}</b><small>${html(current ? 'สายปัจจุบัน' : SenaJobs.jobName(preview))}</small></button>`;
    }).join('');
    jobPicker.showModal();
  }
  const formatLevel = new Intl.NumberFormat('th-TH', { maximumFractionDigits: 2 });
  function levelBadge(id) {
    const lv = level(id);
    return data.canEdit && Number.isFinite(lv)
      ? `<span class="booking-lv">Lv ${formatLevel.format(lv)}</span>`
      : '';
  }
  function matchTeam(ids) {
    if (!data.canEdit) return `<span>${html(ids.map(gameName).join(' / '))}</span>`;
    const levels = ids.map(level);
    const average = levels.every(Number.isFinite)
      ? `<small>Lv เฉลี่ย ${formatLevel.format((levels[0] + levels[1]) / 2)}</small>`
      : '';
    return `<div class="booking-match-team">${ids.map(id => `<span>${html(gameName(id))} ${levelBadge(id)}</span>`).join('')}${average}</div>`;
  }
  const syncTime = new Intl.DateTimeFormat('th-TH', {
    timeZone: 'Asia/Bangkok',
    hour: '2-digit',
    minute: '2-digit',
  });
  // Card above the dates for players who cannot book yet: not logged in, name not linked, or waiting.
  function renderLogin() {
    const card = q('#bookingLogin');
    const member = data.member || {};
    if (!data.requireLogin || data.canEdit || member.playerId) {
      card.hidden = true;
      return;
    }
    const [title, text, cta] = !member.loggedIn
      ? [
          'ยังไม่ได้เข้าสู่ระบบ',
          'เข้าสู่ระบบ LINE ครั้งเดียว เพื่อจองคิว ถอนชื่อ และจ่ายบิล',
          'เข้าสู่ระบบด้วย LINE',
        ]
      : member.status === 'pending'
        ? ['รอผู้จัดยืนยันชื่อ', 'ผู้จัดยืนยันแล้วจะจองคิวได้ทันที', 'ดูสถานะ']
        : [
            'ยังไม่ได้ผูกชื่อผู้เล่น',
            'เลือกชื่อของคุณครั้งเดียว เพื่อจองคิว ถอนชื่อ และจ่ายบิล',
            'ผูกชื่อผู้เล่น',
          ];
    q('#bookingLoginTitle').textContent = title;
    q('#bookingLoginText').textContent = text;
    q('#bookingMemberLogin').textContent = cta;
    card.hidden = false;
  }
  function status(text, error = false) {
    q('#bookingStatus').textContent = text;
    q('#bookingStatus').className = 'booking-status' + (error ? ' is-error' : '');
  }
  function feedback(title, message) {
    const dialog = q('#bookingFeedback');
    q('#bookingFeedbackTitle').textContent = title;
    q('#bookingFeedbackMessage').textContent = message;
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else alert(title + '\n' + message);
  }
  async function request(body) {
    const notify =
      ['book', 'cancel'].includes(body?.action) ||
      (body?.action === 'sponsorSave' && body.notify === true);
    if (notify) window.SenaLineNotice?.preload();
    const response = await venueFetch('/api/booking', {
      method: body ? 'POST' : 'GET',
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { 'X-Booking-Token': token } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const value = await response.json();
    if (!response.ok)
      throw Object.assign(Error(value.error || 'เชื่อมต่อไม่ได้ กรุณาลองใหม่'), {
        status: response.status,
        ...value,
      });
    if (value.serverNow) serverClockOffset = Date.parse(value.serverNow) - Date.now();
    if (notify && value.notice) setTimeout(() => window.SenaLineNotice?.send(value.notice));
    return value;
  }
  async function load(silent = false) {
    if (busy) return;
    busy = true;
    if (!silent) status('กำลังโหลดคิวจากออนไลน์…');
    try {
      data = await request();
      render();
      publishJobs();
      publishNextCup();
      if (!silent) status(`อัปเดตล่าสุด ${syncTime.format(new Date())} น.`);
    } catch (e) {
      status(e.message, true);
    } finally {
      busy = false;
    }
  }
  async function mutate(body) {
    if (busy) return;
    busy = true;
    root.classList.add('booking-busy');
    const isMap = body.action === 'venueMap',
      isCup = body.action === 'cupCalendar',
      isJob = body.action === 'job',
      isSponsor = ['sponsorSave', 'sponsorDelete'].includes(body.action),
      mapInput = q('#bookingMapUrl');
    const detailDialog = q('#bookingDetailsDialog');
    const inDetails = detailDialog.open,
      isReroll = body.action === 'reroll';
    const report = (message, error = false) => {
      if (!isMap && !isCup && !(isSponsor && error)) status(message, error);
      const output = isMap
        ? q('#bookingMapStatus')
        : isCup
          ? q('#bookingCupStatus')
          : isJob
            ? jobPicker.querySelector('#jobPickerStatus')
            : isSponsor && error
              ? q('#bookingSponsorStatus')
              : inDetails && detailDialog.open
                ? q('#bookingDetailsStatus')
                : isReroll
                  ? q('#bookingRerollStatus')
                  : null;
      if (output) {
        output.textContent = message;
        output.classList.toggle('is-error', error);
      }
    };
    if (isMap) q('#bookingMapReload').hidden = true;
    const cupInputs = isCup ? [...q('#bookingCupSettings').querySelectorAll('select,input')] : [];
    for (const input of cupInputs) input.disabled = true;
    if (isCup) q('#bookingCupReload').hidden = true;
    report('กำลังบันทึก…');
    try {
      data = await request(body);
      if (body.action === 'settings') dirty = false;
      if (isCup) cupDirty = false;
      if (isJob) jobPicker.close();
      if (isSponsor) {
        q('#bookingSponsorDialog').close();
        sponsorEditing = null;
      }
      publishJobs();
      publishNextCup();
      if (isMap && mapInput.value.trim() === body.url) mapInput.value = mapInput.defaultValue;
      if (body.action === 'book') {
        selected.clear();
        q('#bookingReview').close();
      }
      if (body.action === 'cancel') {
        q('#bookingCancelDialog').close();
        pendingCancellation = null;
      }
      render();
      report(
        (data.result?.message || 'บันทึกแล้ว') +
          (isSponsor && body.notify && !inLine
            ? ' · พิมพ์ badbot sponsor ในกลุ่ม LINE เพื่อโชว์การ์ด'
            : ''),
      );
      if (isReroll) {
        const draw = q('.booking-draw');
        if (draw) draw.open = true;
      }
      if (detailDialog.open && !detailDialog.contains(document.activeElement))
        q('#bookingDetailsClose').focus({ preventScroll: true });
      if (body.action === 'book') {
        const result = data.result || {},
          title =
            result.added > 0
              ? result.duplicate
                ? 'จองสำเร็จบางรายการ'
                : 'จองคิวสำเร็จ ✓'
              : 'มีชื่ออยู่แล้ว';
        const details = data.sessions
          .filter(s => body.sessionIds.includes(s.id))
          .map(s => {
            const r = s.registrations.find(r => r.playerId === body.playerId);
            const existing = result.duplicateIds?.includes(s.id) ? ' • มีชื่ออยู่ก่อนแล้ว' : '';
            return (
              displayDate(s.date) +
              ' • ' +
              s.start +
              '–' +
              s.end +
              ' น. • ' +
              (r?.status === 'confirmed'
                ? 'ตัวจริง'
                : r
                  ? 'สำรอง #' + r.position
                  : 'กรุณาตรวจรายชื่ออีกครั้ง') +
              existing
            );
          });
        feedback(
          title,
          'ผู้ตี: ' +
            name(body.playerId) +
            '\n' +
            (result.message || 'ตรวจสอบรายชื่อในวันที่เลือกได้ด้านล่าง') +
            '\n\n' +
            details.join('\n'),
        );
      }
    } catch (e) {
      const message =
        e instanceof TypeError ? 'เชื่อมต่อไม่ได้ กรุณาตรวจอินเทอร์เน็ตแล้วลองอีกครั้ง' : e.message;
      report(message, true);
      if (body.action === 'cancel') {
        q('#bookingCancelStatus').textContent = message;
        if (e.code === 'LATE_CANCELLATION_ACK_REQUIRED') {
          q('#bookingCancelWarning').hidden = false;
          q('#bookingCancelDeadline').textContent =
            'ถอนปลอดภัยก่อน ' +
            displayTimestamp(e.cancellationDeadline) +
            ' (' +
            e.cancellationNoticeHours +
            ' ชั่วโมงก่อนเริ่ม)';
          q('#bookingCancelConfirm').textContent = 'รับทราบและยืนยันถอนตัว';
          q('#bookingCancelDialog').dataset.late = '1';
        }
      }
      if (e.status === 409) {
        if (isMap) q('#bookingMapReload').hidden = false;
        if (isCup) q('#bookingCupReload').hidden = false;
      }
      if (body.action === 'book') feedback('จองไม่สำเร็จ', message);
    } finally {
      for (const input of cupInputs) input.disabled = false;
      busy = false;
      root.classList.remove('booking-busy');
    }
  }
  function showCancellation(session, registration) {
    const dialog = q('#bookingCancelDialog');
    pendingCancellation = { sessionId: session.id, registrationId: registration.id };
    const late = Date.now() + serverClockOffset > Date.parse(session.cancellationDeadline);
    dialog.dataset.late = late ? '1' : '0';
    q('#bookingCancelName').textContent =
      'ถอนชื่อ ' +
      name(registration.playerId, false, session) +
      ' วันที่ ' +
      displayDate(session.date) +
      (session.registrations.some(
        r => r.guest?.hostId === registration.playerId || r.invitedBy === registration.playerId,
      )
        ? ' พร้อมเพื่อนและแขกที่ลงชื่อมาด้วย'
        : '');
    q('#bookingCancelDeadline').textContent =
      'ถอนปลอดภัยก่อน ' +
      displayTimestamp(session.cancellationDeadline) +
      ' (' +
      session.cancellationNoticeHours +
      ' ชั่วโมงก่อนเริ่ม)';
    q('#bookingCancelWarning').hidden = !late;
    q('#bookingCancelConfirm').textContent = late ? 'รับทราบและยืนยันถอนตัว' : 'ยืนยันถอนตัว';
    q('#bookingCancelStatus').textContent = '';
    dialog.showModal();
  }
  function withdrawalSection(session) {
    const rows = session.withdrawals ?? [];
    return `<section class="booking-withdrawals"><h4>รายชื่อคนถอน <span>${rows.length} รายการ</span></h4>${
      [...rows]
        .reverse()
        .map(
          r =>
            `<div class="booking-person"><div><strong>${html(r.name)}</strong>${r.guest ? ` <small>แขกของ ${html(r.payer)}</small>` : r.invitedBy ? ` <small>เพื่อนของ ${html(r.payer)} · คนชวนจ่ายแทน</small>` : ''}<small>ถอน ${html(displayTimestamp(r.cancelledAt))} · ${r.status === 'waitlist' ? 'เดิมเป็นสำรอง' : 'เดิมเป็นตัวจริง'}</small><small>${r.lateCancellation ? '⚠ ถอนหลังกำหนด · รับทราบเรื่องค่าใช้จ่ายแล้ว' : 'ถอนในเวลาปลอดภัย'}${r.cancelledByOrganizer ? ' · ผู้จัดถอนให้' : ''}${session.registrations.some(x => x.playerId === r.playerId || (x.guest && r.guest && x.guest.name === r.name && rawName(x.guest.hostId) === r.payer)) ? ' · กลับมาลงชื่อแล้ว' : ''}</small></div></div>`,
        )
        .join('') || '<p class="hint">ยังไม่มีประวัติการถอนตัว</p>'
    }<p class="hint">เวลาไทย · ประวัติเริ่มเก็บหลังเปิดใช้ระบบนี้</p></section>`;
  }
  root.innerHTML = `<div id="bookingLogin" class="booking-login" hidden><div><b id="bookingLoginTitle"></b><small id="bookingLoginText"></small></div><a id="bookingMemberLogin" class="booking-login-cta" href="${html(venueUrl('/liff.html'))}"></a></div><div id="bookingProfile" class="booking-profile" hidden></div>
 <div class="booking-layout"><div><section class="panel booking-dates"><div class="sectionhead"><h2>เลือกวันตีแบด</h2><div class="booking-head-tools"><a id="bookingVenueMap" class="booking-map-link" target="_blank" rel="noopener noreferrer" hidden>แผนที่สนาม ↗</a><button type="button" class="booking-refresh" id="bookingRefresh" aria-label="อัปเดตคิว" title="อัปเดตคิว">↻</button></div></div><p class="hint" id="bookingPattern"></p><p id="bookingStatus" class="booking-status" role="status" aria-live="polite"></p><div id="bookingDates"></div><button type="button" class="secondary booking-more" id="bookingMore" aria-controls="bookingDates" aria-expanded="false" hidden>ดูวันเพิ่มเติม</button></section>
 <dialog id="bookingCancelDialog" class="booking-feedback" aria-labelledby="bookingCancelTitle" aria-describedby="bookingCancelName bookingCancelDeadline bookingCancelWarning"><h2 id="bookingCancelTitle">ยืนยันถอนตัว</h2><p id="bookingCancelName"></p><p id="bookingCancelDeadline" class="hint"></p><p id="bookingCancelWarning" class="booking-cancel-warning" hidden>⚠ เลยเวลาถอนปลอดภัยแล้ว หากผู้เล่นไม่ครบจนไม่สามารถตีได้ อาจมีค่าใช้จ่าย โดยผู้จัดจะพิจารณาอีกครั้ง</p><p id="bookingCancelStatus" role="status"></p><div class="actions"><button type="button" class="primary" id="bookingCancelConfirm">ยืนยันถอนตัว</button><button type="button" class="secondary" id="bookingCancelBack">กลับ</button></div></dialog>
 <dialog id="bookingSponsorDialog" class="booking-feedback booking-submit booking-sponsor-dialog" aria-labelledby="bookingSponsorTitle"><form id="bookingSponsorForm"><h2 id="bookingSponsorTitle">🎁 สปอนเซอร์</h2><label for="sponsorPrize">ของรางวัล</label><input id="sponsorPrize" type="text" maxlength="60" required placeholder="เช่น ลูกแบด 1 หลอด"><fieldset class="booking-sponsor-awards"><legend>มอบให้</legend>${sponsorAwards.map(([value, label]) => `<label><input type="radio" name="sponsorAward" value="${value}"><span>${label}</span></label>`).join('')}</fieldset><input id="sponsorAwardNote" type="text" maxlength="30" placeholder="เช่น คนตบแรงสุด" aria-label="มอบให้ใคร" hidden><label for="sponsorMessage">ข้อความถึงเพื่อนๆ <small>(ไม่ใส่ก็ได้)</small></label><input id="sponsorMessage" type="text" maxlength="60" placeholder="เช่น สู้ๆ นะทุกคน"><div id="sponsorNameField" hidden><label for="sponsorDisplayName">ชื่อผู้สนับสนุน</label><input id="sponsorDisplayName" type="text" maxlength="30"><p class="hint" id="sponsorNameHint"></p></div><label class="booking-check" id="sponsorNotifyRow"><input type="checkbox" id="sponsorNotify" checked> แจ้งเข้ากลุ่ม LINE ของก๊วน</label><p id="bookingSponsorStatus" role="status"></p><div class="actions"><button type="submit" class="primary" id="sponsorSubmit">ยืนยันเป็นสปอนเซอร์</button><button type="button" class="secondary" id="sponsorBack">กลับ</button></div><p id="sponsorDeleteRow" hidden><button type="button" class="textbtn" id="sponsorDelete">ยกเลิกการเป็นสปอนเซอร์</button> <span id="sponsorDeleteConfirm" hidden>แน่ใจไหม? <button type="button" class="secondary" id="sponsorDeleteYes">ยืนยันยกเลิก</button></span></p></form></dialog>
 <dialog id="bookingReview" class="booking-feedback booking-submit" aria-labelledby="bookingReviewTitle"><h2 id="bookingReviewTitle">ยืนยันการจอง</h2><div id="bookingPlayerLocked" class="booking-player-locked" hidden></div><label id="bookingPlayerLabel" for="bookingPlayer">ชื่อสมาชิกผู้จองหลัก</label><select id="bookingPlayer" aria-describedby="bookingPlayerHint"><option value="">เลือกชื่อของคุณ…</option></select><p class="hint" id="bookingPlayerHint" aria-live="polite"></p><div id="bookingFriendOption" hidden><label class="booking-check"><input type="checkbox" id="bookingHasFriend"> จองให้เพื่อนในระบบ 1 คน</label><div id="bookingFriendFields" hidden><label>เลือกเพื่อน<select id="bookingFriend"><option value="">เลือกชื่อเพื่อน…</option></select></label><p class="hint">คนชวนจ่ายแทนเพื่อน รวมในบิลของคนชวน เพื่อนต้องยังไม่มีชื่อในวันที่เลือก</p></div></div><div id="bookingGuestOption" hidden><label class="booking-check"><input type="checkbox" id="bookingHasGuest"> เพิ่มแขก (Guest)</label><div id="bookingGuestFields" class="booking-fields" hidden><label>ชื่อแขก<input id="bookingGuestName" type="text" maxlength="80" placeholder="ชื่อแขก"></label><label>เพศสำหรับจัดคู่<select id="bookingGuestGender"><option value="">เลือกเพศ</option><option value="M">ชาย</option><option value="F">หญิง</option></select></label></div></div><div id="bookingHolidayConfirm" hidden><label class="booking-check"><input id="bookingAcceptHoliday" type="checkbox"> รับทราบว่าวันที่เลือกมีวันหยุด และยังต้องการจอง</label></div><div class="booking-selection"><b>วันที่เลือก</b><ul id="bookingReviewDates"></ul></div><button type="button" class="primary booking-primary" id="bookingConfirm">ยืนยันจองคิว ↗</button><form method="dialog"><button class="secondary booking-back">กลับไปเลือกวัน</button></form></dialog>
 <details id="bookingAdmin" class="panel booking-admin" hidden><summary>⚙ ตั้งค่าการจองและสนาม <span>สำหรับผู้จัด</span></summary>
 <details class="booking-cup-settings"><summary>🏆 วันแข่งขัน ${html(cupName)}</summary>
 <form id="bookingCupSettings"><label for="bookingCupWeek">สัปดาห์แข่งขันประจำเดือน</label>
 <select id="bookingCupWeek"><option value="0">กำหนดวันเอง</option>${['1–7', '8–14', '15–21', '22–28', '29–สิ้นเดือน'].map((range, i) => `<option value="${i + 1}">สัปดาห์ที่ ${i + 1} · วันที่ ${range}</option>`).join('')}</select>
 <fieldset><legend>เลือกวันแข่งเป็นรายรอบ</legend><p class="hint">ติ๊กเพื่อกำหนดให้เป็นวันแข่ง หรือเอาติ๊กออกเพื่อให้เป็นรอบปกติ รอบที่ไม่ได้ปรับจะใช้สัปดาห์ประจำเดือน</p><div id="bookingCupDates"></div></fieldset><div id="bookingSponsorMoves"></div>
 <button class="secondary" type="submit">บันทึกวันแข่งขัน</button> <button class="textbtn" id="bookingCupReload" type="button" hidden>โหลดค่าล่าสุด</button><p id="bookingCupStatus" role="status"></p></form></details>
 <details class="booking-map-settings"><summary>แผนที่สนาม ${html(venueLabel)}</summary><form id="bookingMapSettings"><label for="bookingMapUrl">ลิงก์ Google Maps</label><input id="bookingMapUrl" name="mapUrl" type="url" inputmode="url" maxlength="2048" required placeholder="https://maps.app.goo.gl/…"><button class="secondary" type="submit">บันทึกแผนที่สนาม</button> <button class="textbtn" id="bookingMapReload" type="button" hidden>โหลดลิงก์ล่าสุด</button><p id="bookingMapStatus" role="status"></p></form></details>
 <details class="booking-map-settings"><summary>🔔 เชื่อม Badbot กับกลุ่ม LINE</summary>
 <p class="hint">สร้างคำสั่งแล้วส่งในกลุ่ม LINE ที่ต้องการเปิดใช้ Badbot รหัสใช้ได้ครั้งเดียวใน 10 นาที</p>
 <button type="button" class="secondary" id="bookingLinePair">สร้างคำสั่งเชื่อมกลุ่ม</button>
 <button type="button" class="secondary" id="bookingLineCheck">ตรวจการเชื่อมต่อ</button>
 <textarea id="bookingLineCommand" aria-label="คำสั่งเชื่อม Badbot" rows="2" readonly hidden></textarea>
 <p id="bookingLineSetupStatus" role="status" class="hint"></p>
 </details>
 <form id="bookingSettings"></form></details></div>
 <div id="bookingInlineDetails"><div id="bookingDetailPanels"><section class="panel booking-detail"><div class="sectionhead"><h2>คิวลงคอร์ต</h2><span id="bookingDetailBadge" class="booking-chip"></span></div><div id="bookingDetail"></div></section><section class="panel booking-matches"><div class="sectionhead"><h2>⚡ ตารางพร้อมลุย</h2><span class="booking-chip">จัดคู่อัตโนมัติ</span></div><div id="bookingSchedule"></div></section></div></div></div>
 <dialog id="bookingDetailsDialog" class="booking-details-dialog" aria-labelledby="bookingDetailsTitle" aria-describedby="bookingDetailsMeta">
 <header class="booking-details-header">
 <div><h2 id="bookingDetailsTitle">รายละเอียด / ถอนตัว</h2><p id="bookingDetailsMeta"></p></div>
 <form method="dialog"><button id="bookingDetailsClose" type="submit" aria-label="ปิด" autofocus><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button></form>
 </header>
 <p id="bookingDetailsStatus" role="status"></p><div id="bookingDetailsContent"></div></dialog>
 <div class="booking-action" id="bookingAction" hidden><b id="bookingSelection" aria-live="polite"></b><button type="button" class="primary" id="bookingContinue">ดำเนินการจอง</button></div><p class="booking-footnote">วันหยุดอ้างอิงปฏิทินวันหยุดหลักปี 2569–2570 รวมวันหยุดราชการและธนาคารบางประเภท ผู้จัดเพิ่มวันหยุดพิเศษ / วันปิดสนามได้ • <a href="https://www.bot.or.th/th/financial-institutions-holiday.html" target="_blank" rel="noopener">อ้างอิง ธปท.</a> / <a href="https://www.sec.or.th/EN/Pages/News_Detail.aspx?SECID=13329" target="_blank" rel="noopener">ก.ล.ต.</a></p><dialog id="bookingFeedback" class="booking-feedback" aria-labelledby="bookingFeedbackTitle"><h2 id="bookingFeedbackTitle"></h2><p id="bookingFeedbackMessage"></p><form method="dialog"><button class="primary booking-primary" autofocus>ตกลง</button></form></dialog>`;
  // The picker and the shared SVG gradients live outside #booking: the roster tab
  // (app.js) opens the picker while this section is hidden, and a hidden parent
  // would stop both the dialog and the gradients from rendering.
  document.body.insertAdjacentHTML(
    'beforeend',
    `<dialog id="jobPicker" class="booking-feedback job-picker" aria-labelledby="jobPickerTitle"><h2 id="jobPickerTitle">เลือกสายของคุณ</h2><p class="hint">ขั้น job นับจากจำนวนครั้งที่มาตี เปลี่ยนสายได้ตลอดโดยไม่ต้องเริ่มใหม่</p><div class="job-picker-grid" id="jobPickerGrid"></div><p id="jobPickerStatus" class="booking-status" role="status" aria-live="polite"></p><form method="dialog"><button class="secondary">ปิด</button></form></dialog>${SenaJobs.defsHtml()}`,
  );
  const jobPicker = document.getElementById('jobPicker');
  jobPicker.addEventListener('click', e => {
    const button = e.target.closest('[data-job-line]');
    if (!button || busy) return;
    button.classList.add('is-saving');
    mutate({
      action: 'job',
      line: button.dataset.jobLine,
      ...(data?.canEdit ? { playerId: jobTarget } : {}),
    }).finally(() => button.classList.remove('is-saving'));
  });
  // Lets the roster tab (app.js) draw the same badges without a second request.
  let jobsSignature = '';
  function publishJobs() {
    const signature = JSON.stringify([
      data?.canEdit,
      data?.member?.playerId,
      data?.roster?.map(p => [p.id, p.badge]),
    ]);
    if (signature === jobsSignature) return;
    jobsSignature = signature;
    document.dispatchEvent(new CustomEvent('sena-jobs'));
  }
  // Next Cup day for the Cup tab's "Cup ครั้งถัดไป" card (app.js renderCupNext).
  function publishNextCup() {
    const s = data?.sessions?.find(x => x.isCup && !x.started && !x.skipped);
    window.SenaNextCup = s
      ? {
          date: s.date,
          label: displayDate(s.date),
          time: `${s.start}–${s.end} น.${courtSuffix(s)}`,
        }
      : null;
    document.dispatchEvent(new CustomEvent('sena-next-cup'));
  }
  window.SenaBookingJobs = {
    badge: id => data?.roster?.find(p => p.id === id)?.badge || null,
    canPick: id => Boolean(data?.canEdit || (id && id === data?.member?.playerId)),
    pick: id => {
      if (!busy) openJobPicker(id);
    },
  };
  const detailsDialog = q('#bookingDetailsDialog');
  const supportsDetailsPopup = typeof detailsDialog.showModal === 'function';
  root.classList.toggle('booking-details-popup', supportsDetailsPopup);
  let detailsTriggerId = '';
  detailsDialog.addEventListener('close', () => {
    q('#bookingInlineDetails').append(q('#bookingDetailPanels'));
    const trigger = [...root.querySelectorAll('[data-book-focus]')].find(
      button => button.dataset.bookFocus === detailsTriggerId,
    );
    if (mobileDetails.matches) trigger?.focus({ preventScroll: true });
  });
  mobileDetails.addEventListener('change', () => {
    if (!mobileDetails.matches && detailsDialog.open) detailsDialog.close();
  });
  function renderProfile() {
    const box = q('#bookingProfile');
    const me = data.member?.playerId && data.roster.find(p => p.id === data.member.playerId);
    if (!me) {
      box.hidden = true;
      box.innerHTML = '';
      return;
    }
    const badge = me.badge || { plays: 0 };
    const jobTh = SenaJobs.jobThai(badge);
    const lineTh = badge.chosen && SenaJobs.JOBS[badge.line]?.th;
    const goal = SenaJobRules.nextGoal(badge.plays);
    const playsText = '🏸 ' + badge.plays + (goal ? '/' + goal : '') + ' ครั้ง';
    const ready = !badge.chosen && SenaJobRules.jobLevel(badge.plays).lvl >= 1;
    const roleTag = data.canEdit ? '<span class="booking-profile-role">ผู้จัด</span>' : '';
    box.hidden = false;
    box.innerHTML = `<div class="booking-profile-main"><button type="button" class="jb-own" data-job-pick="${html(me.id)}" aria-label="เลือกสาย job ของฉัน">${SenaJobs.badgeHtml(badge, 40, { mine: true })}</button><div class="booking-profile-info"><div class="booking-profile-name"><strong>${html(me.name)}</strong>${roleTag}</div><div class="booking-profile-meta">${html(jobTh)}${lineTh ? ' · ' + html(lineTh) : ''} · ${html(playsText)}</div></div></div><button type="button" class="booking-profile-pick" data-job-pick="${html(me.id)}">${ready ? 'เลือกสาย !' : 'เปลี่ยนสาย'}</button>`;
  }
  // Who sponsors as "me": the linked LINE member, or the picked name without LINE login.
  const sponsorSelf = () => data.member?.playerId || (data.requireLogin ? '' : playerId);
  function sponsorBox(s) {
    const rows = s.sponsors || [];
    const mine = rows.find(r => r.mine);
    const open = !s.started && !s.closed && !s.skipped && (data.canEdit || sponsorSelf());
    const list = rows.length
      ? `<div class="booking-sponsors"><b>🎁 สปอนเซอร์ ${rows.length} คน</b>${rows
          .map(
            r =>
              `<div class="booking-sponsor"><span><strong>${html(r.name)}</strong> ${html(r.prize)} · ${html(r.awardLabel)}</span>${r.canEdit && !r.mine ? `<button type="button" class="textbtn" data-sponsor-edit="${html(r.id)}" data-sponsor-session="${html(s.id)}">แก้</button>` : ''}</div>`,
          )
          .join('')}</div>`
      : '';
    const action = !open
      ? ''
      : mine?.canEdit
        ? `<button type="button" class="booking-sponsor-action" data-sponsor-edit="${html(mine.id)}" data-sponsor-session="${html(s.id)}">แก้สปอนเซอร์ของฉัน</button>`
        : mine
          ? ''
          : s.sponsorFull
            ? '<p class="hint">สปอนเซอร์ครบ 10 คนแล้ว</p>'
            : `<button type="button" class="booking-sponsor-action" data-sponsor-new="${html(s.id)}">🎁 ร่วมเป็นสปอนเซอร์</button>`;
    return list + action;
  }
  function openSponsor(sessionId, sponsorId) {
    const s = data.sessions.find(x => x.id === sessionId);
    if (!s) return;
    const row = sponsorId ? (s.sponsors || []).find(r => r.id === sponsorId) : null;
    sponsorEditing = { sessionId, date: s.date, id: row?.id, revision: row?.revision };
    q('#bookingSponsorTitle').textContent =
      (row ? 'แก้สปอนเซอร์' : '🎁 สปอนเซอร์') + ' ' + cupName + ' · ' + displayDate(s.date);
    q('#sponsorPrize').value = row?.prize || '';
    for (const radio of root.querySelectorAll('[name="sponsorAward"]'))
      radio.checked = radio.value === (row?.award || 'champ');
    q('#sponsorAwardNote').value = row?.awardNote || '';
    q('#sponsorMessage').value = row?.message || '';
    // Organizers can enter a sponsor who is not a player (a shop, a friend).
    q('#sponsorNameField').hidden = !(data.canEdit && !row);
    q('#sponsorDisplayName').value = '';
    q('#sponsorDisplayName').required = data.canEdit && !row && !sponsorSelf();
    q('#sponsorNameHint').textContent = sponsorSelf()
      ? 'เว้นว่าง = ลงในชื่อของคุณ'
      : 'ชื่อร้านหรือคนที่ให้ของรางวัล';
    q('#sponsorNotifyRow').hidden = Boolean(row);
    q('#sponsorNotify').checked = true;
    q('#sponsorDeleteRow').hidden = !row;
    q('#sponsorDeleteConfirm').hidden = true;
    q('#sponsorSubmit').textContent = row ? 'บันทึกการแก้ไข' : 'ยืนยันเป็นสปอนเซอร์';
    q('#bookingSponsorStatus').textContent = '';
    syncSponsorNote();
    q('#bookingSponsorDialog').showModal();
  }
  function syncSponsorNote() {
    const other = root.querySelector('[name="sponsorAward"]:checked')?.value === 'other';
    q('#sponsorAwardNote').hidden = !other;
    q('#sponsorAwardNote').required = other;
  }
  function sponsorBody() {
    const name = q('#sponsorDisplayName').value.trim();
    const body = {
      action: 'sponsorSave',
      date: sponsorEditing.date,
      prize: q('#sponsorPrize').value,
      award: root.querySelector('[name="sponsorAward"]:checked')?.value,
      awardNote: q('#sponsorAwardNote').value,
      message: q('#sponsorMessage').value,
    };
    if (sponsorEditing.id)
      return { ...body, id: sponsorEditing.id, revision: sponsorEditing.revision };
    if (data.canEdit && name)
      return { ...body, displayName: name, notify: q('#sponsorNotify').checked };
    return { ...body, playerId: sponsorSelf(), notify: q('#sponsorNotify').checked };
  }
  // Organizer: where each un-ticked Cup day's sponsors go. The default is the one
  // day newly ticked in the same month, else "do not move (hide)".
  function renderSponsorMoves() {
    const box = q('#bookingSponsorMoves');
    if (!box || !data) return;
    const checked = new Map(
      [...root.querySelectorAll('[data-cup-date]')].map(b => [b.dataset.cupDate, b.checked]),
    );
    // Keep only what the organizer picked; untouched rows follow the default.
    const previous = new Map(
      [...box.querySelectorAll('[data-move-from][data-touched]')].map(sel => [
        sel.dataset.moveFrom,
        sel.value,
      ]),
    );
    const open = data.sessions.filter(s => !s.skipped && !s.started);
    const lost = open.filter(s => s.isCup && s.sponsors?.length && !checked.get(s.date));
    const targets = open.filter(s => checked.get(s.date));
    box.innerHTML = lost
      .map(s => {
        const added = targets.filter(t => !t.isCup && t.date.slice(0, 7) === s.date.slice(0, 7));
        const fallback = added.length === 1 ? added[0].date : '';
        const value = previous.has(s.date) ? previous.get(s.date) : fallback;
        const options = [
          `<option value="">ไม่ย้าย (ซ่อนไว้)</option>`,
          ...targets.map(
            t =>
              `<option value="${html(t.date)}" ${t.date === value ? 'selected' : ''}>${displayDate(t.date)}</option>`,
          ),
        ].join('');
        const touched = previous.has(s.date) ? ' data-touched="1"' : '';
        return `<label class="booking-sponsor-move">${displayDate(s.date)} มีสปอนเซอร์ ${s.sponsors.length} คน → ย้ายไป <select data-move-from="${html(s.date)}"${touched}>${options}</select></label>`;
      })
      .join('');
  }
  function render() {
    const linked = data.member?.playerId;
    if (data.requireLogin && !data.canEdit) {
      if (linked) playerId = linked;
    } else if (!playerId && linked) playerId = linked;
    renderLogin();
    const selfId = linked || playerId;
    renderProfile();
    const cfg = data.settings,
      map = q('#bookingVenueMap'),
      mapInput = q('#bookingMapUrl');
    const mapUrl = data.venueMapUrl ?? '';
    map.hidden = !mapUrl;
    if (mapUrl) map.href = mapUrl;
    else map.removeAttribute('href');
    map.setAttribute('aria-label', 'เปิดแผนที่สนาม ' + venueLabel + ' ใน Google Maps (แท็บใหม่)');
    if (
      data.canEdit &&
      (mapInput.value === mapInput.defaultValue || mapInput.value.trim() === mapUrl)
    ) {
      mapInput.defaultValue = mapUrl;
      mapInput.value = mapUrl;
    }
    q('#bookingPattern').textContent = cfg.enabled
      ? `ทุกวัน${cfg.weekdays.map(d => days[d]).join(' / ')} • ${cfg.start}–${cfg.end} น. • เปิดล่วงหน้า ${cfg.weeks} สัปดาห์`
      : 'ผู้จัดยังไม่เปิดรับจอง • เข้าสู่ระบบผู้จัดเพื่อตั้งวัน เวลา และขาประจำ';
    const sessions = data.sessions;
    selected = new Set(
      [...selected].filter(
        id =>
          sessions.some(s => s.id === id && !s.started && !s.closed && !s.skipped) && cfg.enabled,
      ),
    );
    if (!sessions.some(s => s.id === focusId))
      focusId =
        sessions.find(s => !s.started && !s.skipped && !s.closed)?.id || sessions[0]?.id || '';
    const more = q('#bookingMore');
    more.hidden = sessions.length <= 3;
    more.setAttribute('aria-expanded', String(showAllDates));
    const hiddenCup =
      sessions.slice(3).some(s => s.isCup && !s.closed) &&
      !sessions.slice(0, 3).some(s => s.isCup && !s.closed);
    more.textContent = showAllDates
      ? 'แสดงเฉพาะรอบถัดไป'
      : hiddenCup
        ? `ดูวันเพิ่มเติม · 🏆 ${cupName}`
        : 'ดูวันเพิ่มเติม';
    const visibleSessions = showAllDates ? sessions : sessions.slice(0, 3);
    q('#bookingDates').innerHTML = sessions.length
      ? visibleSessions
          .map(s => {
            const available = Math.max(0, s.capacity - s.confirmedCount);
            const closed = s.started || s.closed || s.skipped || !cfg.enabled;
            // Not logged in / not linked yet: show the real seats, but no checkbox to pick the day.
            const needsLogin = data.requireLogin && !data.canEdit && !data.member?.playerId;
            const mine = s.registrations.find(r => r.playerId === selfId);
            const tone = closed
              ? 'closed'
              : available === 0
                ? 'full'
                : available <= 2
                  ? 'near'
                  : 'open';
            const availability = closed
              ? s.started
                ? 'รอบที่ผ่านมา'
                : s.skipped
                  ? 'งดจองวันหยุด'
                  : 'ปิดรับจอง'
              : available
                ? `เหลือ ${available} ที่ · ${s.confirmedCount}/${s.capacity} คน`
                : `ตัวจริงเต็ม · ${s.confirmedCount}/${s.capacity} คน`;
            const waitlist =
              tone === 'full' ? (s.canJoinWaitlist === false ? 'คิวสำรองเต็ม' : 'ยังรับสำรอง') : '';
            const personal = mine
              ? mine.status === 'confirmed'
                ? '<span class="booking-me booking-me-in">✓ ลงชื่อแล้ว</span>'
                : `<span class="booking-me booking-me-wait">⏳ สำรอง #${html(mine.position)}</span>`
              : '';
            return `<article class="booking-date availability-${tone} ${focusId === s.id ? 'is-focus' : ''} ${closed ? 'is-closed' : ''} ${needsLogin ? 'needs-login' : ''} ${mine ? 'has-me' : ''}">
    ${s.isCup ? cupBadge : ''}
    <label class="booking-date-label">
     ${needsLogin ? '' : `<input type="checkbox" data-book-date="${html(s.id)}" ${selected.has(s.id) ? 'checked' : ''} ${closed ? 'disabled' : ''} aria-label="เลือก ${displayDate(s.date)}${s.isCup ? ' · ' + html(cupName) : ''}">`}
     <span><strong>${displayDate(s.date)}</strong><small>${html(s.start)}–${html(s.end)} น.${html(courtSuffix(s))}</small></span>${personal}
    </label>
    <div class="booking-date-bottom"><div class="booking-availability"><span class="booking-availability-label">${availability}</span>${waitlist ? `<strong class="booking-waitlist-label">${waitlist}</strong>` : ''}</div><div class="booking-date-actions"><button type="button" class="booking-roster-action" ${mobileDetails.matches && supportsDetailsPopup ? 'aria-haspopup="dialog"' : ''} data-book-focus="${html(s.id)}">${mine?.canCancel ? 'รายละเอียด' : 'รายละเอียด / ถอนตัว'}</button>${mine?.canCancel ? `<button type="button" class="booking-withdraw-action" data-book-cancel="${html(mine.id)}" data-book-session="${html(s.id)}" aria-label="ถอนชื่อฉัน วันที่ ${displayDate(s.date)}">ถอนชื่อฉัน</button>` : ''}</div></div>
    ${s.isCup ? sponsorBox(s) : ''}
    ${s.holiday ? `<p class="booking-holiday">☀ ${html(s.holiday)}</p>` : ''}
    ${!data.holidayYears.includes(Number(s.date.slice(0, 4))) ? '<p class="booking-holiday">⚠ ปฏิทินปีนี้ยังไม่ครบ ให้ผู้จัดตรวจวันหยุดเพิ่มเติม</p>' : ''}
   </article>`;
          })
          .join('')
      : '<div class="booking-empty">ยังไม่มีรอบเปิดจอง<br><small>ผู้จัดตั้งวันและเวลาได้ในเมนูด้านล่าง</small></div>';
    q('#bookingAdmin').hidden = !data.canEdit;
    if (data.canEdit && !dirty) renderSettings();
    if (data.canEdit && !cupDirty) renderCupSettings();
    renderSelection();
    renderDetail();
  }
  function renderSelection() {
    if (!data) return;
    const chosen = data.sessions.filter(s => selected.has(s.id));
    const booked = new Map();
    for (const session of chosen)
      for (const { playerId: id } of session.registrations)
        booked.set(id, (booked.get(id) || 0) + 1);
    const picker = q('#bookingPlayer');
    const locked = Boolean(data.requireLogin && !data.canEdit && data.member?.playerId);
    const options =
      data.requireLogin && !data.canEdit
        ? data.roster.filter(p => p.id === data.member?.playerId)
        : data.roster;
    picker.innerHTML =
      '<option value="">เลือกชื่อของคุณ…</option>' +
      options
        .map(p => {
          const count = booked.get(p.id) || 0;
          const note = count ? ` · จองแล้ว ${count}/${chosen.length} วัน` : '';
          return `<option value="${html(p.id)}">${html(name(p.id))}${p.thai ? ' · ' + html(p.thai) : ''}${note}</option>`;
        })
        .join('');
    const eligible = options.some(p => p.id === playerId);
    picker.value = eligible ? playerId : '';
    picker.disabled = !options.length || (data.requireLogin && !data.canEdit);
    const lockedBar = q('#bookingPlayerLocked');
    const pickerLabel = q('#bookingPlayerLabel');
    const showLocked = locked && Boolean(picker.value);
    lockedBar.hidden = !showLocked;
    picker.hidden = showLocked;
    pickerLabel.hidden = showLocked;
    if (showLocked) {
      const me = options.find(p => p.id === picker.value);
      lockedBar.innerHTML = `<span class="booking-player-locked-label">จองในชื่อ</span><strong>${html(me?.name || rawName(picker.value))}</strong><span class="booking-player-locked-via">LINE ✓</span>`;
    } else {
      lockedBar.innerHTML = '';
    }
    q('#bookingFriendOption').hidden = !picker.value;
    const friendPicker = q('#bookingFriend'),
      previousFriend = friendPicker.value;
    friendPicker.innerHTML =
      '<option value="">เลือกชื่อเพื่อน…</option>' +
      data.roster
        .filter(p => p.id !== picker.value)
        .map(p => `<option value="${html(p.id)}">${html(p.name)}</option>`)
        .join('');
    friendPicker.value = previousFriend === picker.value ? '' : previousFriend;
    const withFriend = Boolean(picker.value && q('#bookingHasFriend').checked);
    q('#bookingFriendFields').hidden = !withFriend;
    q('#bookingGuestOption').hidden = !picker.value;
    const withGuest = Boolean(picker.value && q('#bookingHasGuest').checked);
    q('#bookingGuestFields').hidden = !withGuest;
    q('#bookingPlayerHint').textContent = !options.length
      ? 'ให้ผู้จัดเพิ่มรายชื่อสมาชิกก่อน'
      : picker.value && (booked.get(picker.value) || 0) === chosen.length
        ? 'สมาชิกจองครบแล้ว ยังเพิ่มเพื่อนหรือแขกในรอบนี้ได้'
        : 'แขกนับเป็นหนึ่งที่นั่ง และจะลงชื่อในทุกวันที่เลือก';
    q('#bookingAction').hidden = !chosen.length;
    q('#bookingSelection').textContent = `เลือก ${chosen.length} วัน`;
    q('#bookingReviewDates').innerHTML = chosen
      .map(s => {
        const alreadyBooked = s.registrations.some(r => r.playerId === picker.value);
        const note = alreadyBooked
          ? ' · มีชื่อแล้ว'
          : s.confirmedCount >= s.capacity
            ? ' · รับสำรอง'
            : '';
        return `<li>${displayDate(s.date)} · ${html(s.start)}–${html(s.end)} น.${s.isCup ? ' · 🏆 ' + html(cupName) : ''}${note}</li>`;
      })
      .join('');
    q('#bookingHolidayConfirm').hidden = !chosen.some(s => s.holiday);
    q('#bookingConfirm').disabled =
      !chosen.length ||
      !picker.value ||
      !token ||
      !data.settings.enabled ||
      (!withGuest && !withFriend && (booked.get(picker.value) || 0) === chosen.length) ||
      (withFriend && !friendPicker.value);
    if (!token)
      status('เบราว์เซอร์ไม่ให้เก็บรหัสจัดการการจอง กรุณาเปิดเว็บใน Safari / Chrome โดยตรง', true);
  }
  function renderDetail() {
    const s = data.sessions.find(s => s.id === focusId);
    const sessionTime = s
      ? `${s.start}–${s.end} น.${courtSuffix(s)}${s.skipped ? ' • งดรับจองวันหยุด' : s.closed ? ' • ปิดรับจอง' : ''}`
      : '';
    q('#bookingDetailsMeta').textContent = s ? `${displayDate(s.date)} · ${sessionTime}` : '';
    q('#bookingDetailBadge').textContent = s ? `${s.confirmedCount} / ${s.capacity} คน` : '';
    if (!s) {
      q('#bookingDetail').innerHTML =
        '<div class="booking-empty">เลือกวัน แล้วพบก๊วนของคุณที่นี่ 🏸</div>';
      q('#bookingSchedule').innerHTML =
        '<p class="hint">เมื่อคนครบ ระบบจะบันทึกตารางคู่ให้อัตโนมัติ</p>';
      return;
    }
    const selfId = data.member?.playerId || playerId;
    const isMe = r => Boolean(selfId && r.playerId === selfId);
    const row = r =>
      `<div class="booking-person${isMe(r) ? ' is-me' : ''}">${badgeFor(r)}<div><strong>${html(name(r.playerId))}</strong> ${isMe(r) ? '<span class="booking-me-tag">ฉัน</span> ' : ''}${levelBadge(r.playerId)}<small>${rosterBadge(r) ? html(SenaJobs.jobName(rosterBadge(r)) + playCount(r)) + ' · ' : ''}${r.source === 'regular' ? '↻ ขาประจำ' : r.status === 'waitlist' ? 'สำรอง #' + r.position : 'ลงชื่อออนไลน์'}</small></div>${r.canCancel ? `<button type="button" class="booking-cancel" data-book-cancel="${html(r.id)}" data-book-session="${html(s.id)}" aria-label="ถอนชื่อ ${html(name(r.playerId))}">ถอนชื่อ</button>` : ''}</div>`;
    q('#bookingDetail').innerHTML =
      `${s.isCup ? cupBadge : ''}<h3 class="booking-session-date">${displayDate(s.date)}</h3><p class="hint booking-session-time">${html(sessionTime)}</p><button type="button" class="secondary" id="bookingCopyRoster">📋 คัดลอกรายชื่อส่ง LINE</button><p id="bookingRosterCopyStatus" role="status" class="hint"></p><h4>ตัวจริง <span>${s.confirmedCount} คน</span></h4>${
        s.registrations
          .filter(r => r.status === 'confirmed')
          .map(row)
          .join('') || '<p class="hint">มาเปิดก๊วนเป็นคนแรกกัน!</p>'
      }<div class="booking-waitlist"><h4>คิวสำรอง <span>${s.waitlistCount} คน</span></h4>${
        s.registrations
          .filter(r => r.status === 'waitlist')
          .map(row)
          .join('') || '<p class="hint">ยังไม่มีคิวสำรอง</p>'
      }<p class="hint">เมื่อมีคนถอน ตัวสำรองอันดับแรกจะขึ้นแทนทันที</p></div>${withdrawalSection(s)}${data.canEdit ? `<a class="booking-bill-action" href="${html(venueUrl('/billing.html?manage=1&date=' + encodeURIComponent(s.date)))}">จบและคิดเงิน ↗</a>${s.started ? '' : ` <button type="button" class="secondary" id="bookingEditCourts">แก้เลขคอร์ต</button> <button type="button" class="secondary" id="bookingClose">${s.closed ? 'เปิดรับจองรอบนี้' : 'ปิดรับจองรอบนี้'}</button>`}` : ''}`;
    const messages = {
      waiting: `รออีก ${Math.max(0, s.capacity - s.confirmedCount)} คนให้ครบก๊วน แล้วจัดคู่ทันที`,
      insufficient: 'เหลือน้อยกว่า 8 คน จึงพักตารางไว้ก่อน เพื่อให้ทุกคนได้พักอย่างน้อย 1 เกม',
      closed: 'รอบนี้ปิดรับจอง / ข้ามวันหยุด จึงพักตารางไว้ก่อน',
      failed: 'เงื่อนไขผู้เล่นยังจัดคู่ไม่ได้ ให้ผู้จัดตรวจรายชื่อและตั้งค่าอีกครั้ง',
    };
    q('#bookingSchedule').innerHTML =
      s.schedule && data.settings.enabled && !s.closed && !s.skipped
        ? `<div class="booking-ready">✓ บันทึกตารางแล้ว <small>เวอร์ชัน ${s.scheduleVersion} • ${s.rounds} เกม</small></div><p class="hint">ปรับคู่และบันทึกใหม่เมื่อรายชื่อตัวจริงเปลี่ยน • พักอย่างน้อย 1 เกม</p><button type="button" class="primary booking-primary" id="bookingCopy">📋 Copy ตารางลง LINE</button>${data.canEdit && !s.started ? `<button type="button" class="secondary booking-primary" id="bookingReroll">↻ จัดคู่ใหม่</button><p id="bookingRerollStatus" role="status" class="hint"></p>` : ''}<p id="bookingCopyStatus" role="status"></p><details class="booking-draw"><summary>ดูตารางทั้งหมด ${s.rounds} เกม</summary>${s.schedule.schedule.map(m => `<div class="booking-match"><b>GAME ${String(m.round).padStart(2, '0')}</b><div>${matchTeam(m.ids.slice(0, 2))}<em>VS</em>${matchTeam(m.ids.slice(2))}</div></div>`).join('')}<div class="booking-counts">${Object.entries(
            s.schedule.counts,
          )
            .map(([id, n]) => `<span>${html(gameName(id))} <b>${n} เกม</b></span>`)
            .join('')}</div></details>`
        : `<div class="booking-empty">🏸<p>${messages[s.scheduleStatus] || 'เมื่อคนครบ ระบบจะจัดคู่และบันทึกตารางให้ทันที'}</p></div>`;
  }
  function renderCupSettings() {
    q('#bookingCupSettings').dataset.version = String(data.cupVersion);
    q('#bookingCupWeek').value = String(data.cupWeek);
    q('#bookingCupDates').innerHTML =
      data.sessions
        .filter(s => !s.skipped)
        .map(
          s =>
            `<label class="booking-check"><input type="checkbox" data-cup-date="${html(s.date)}" data-override="${s.cupOverride ?? ''}" data-original="${s.cupOverride ?? ''}" ${s.isCup ? 'checked' : ''}>${displayDate(s.date)} · ${html(s.start)} น.</label>`,
        )
        .join('') ||
      '<p class="hint">ยังไม่มีรอบให้เลือก ตั้งวันตีประจำก่อนเพื่อเลือกวันแข่งรายรอบ</p>';
    q('#bookingSponsorMoves').innerHTML = '';
    renderSponsorMoves();
  }
  function renderSettings() {
    const cfg = data.settings;
    q('#bookingSettings').innerHTML =
      `<p class="hint">บันทึกแล้วมีผลกับรอบอนาคต รวมเวลา จำนวนคน และตารางคู่ • รอบเดิมที่มีคนจองจะยังเก็บไว้ แม้เปลี่ยนวันประจำ</p><label class="booking-check"><input name="enabled" type="checkbox" ${cfg.enabled ? 'checked' : ''}> เปิดรับจองออนไลน์</label><fieldset><legend>วันตีประจำ</legend><div class="booking-weekdays">${days.map((d, i) => `<label><input type="checkbox" name="weekday" value="${i}" ${cfg.weekdays.includes(i) ? 'checked' : ''}><span>${d}</span></label>`).join('')}</div></fieldset><div class="booking-fields"><label>เริ่ม<input name="start" type="time" value="${cfg.start}" required></label><label>สิ้นสุด<input name="end" type="time" value="${cfg.end}" required></label><label>เลขคอร์ตเริ่มต้น<input name="courtNumbers" type="text" maxlength="80" placeholder="เช่น 6, 7" value="${html(cfg.courtNumbers ?? '')}"></label><label>ตัวจริง (8–24 คน)<input name="capacity" type="number" min="8" max="24" value="${cfg.capacity}" required></label><label>จำนวนเกม (1–30)<input name="rounds" type="number" min="1" max="30" value="${cfg.rounds}" required></label><label>เปิดล่วงหน้า (สัปดาห์)<input name="weeks" type="number" min="1" max="8" value="${cfg.weeks}" required></label><label>ถอนปลอดภัยก่อนเริ่ม (ชั่วโมง)<input name="cancellationNoticeHours" type="number" min="0" max="720" step="1" value="${cfg.cancellationNoticeHours ?? 48}" required><small>หลังกำหนดยังถอนได้ แต่ต้องรับทราบว่าอาจมีค่าใช้จ่าย · 0 = ไม่เตือนก่อนเริ่ม</small></label><label>ถ้าตรงวันหยุด<select name="holidayPolicy"><option value="warn" ${cfg.holidayPolicy === 'warn' ? 'selected' : ''}>แจ้งเตือน แต่จองได้</option><option value="skip" ${cfg.holidayPolicy === 'skip' ? 'selected' : ''}>ข้าม / งดรับจอง</option></select></label></div><fieldset><legend>↻ ขาประจำ ลงชื่อให้อัตโนมัติทุกสัปดาห์</legend><p class="hint">ถ้าเกินจำนวน ตัวสำรองเรียงตามลำดับที่เพิ่มขาประจำ • ถอนแล้วจะไม่เพิ่มกลับในวันเดิม</p><div class="booking-regulars">${data.roster.map(p => `<label class="booking-check"><input type="checkbox" name="regular" value="${html(p.id)}" ${cfg.regularIds.includes(p.id) ? 'checked' : ''}>${html(p.name)}</label>`).join('') || '<p class="hint">เพิ่มรายชื่อในแท็บรายชื่อผู้เล่นก่อน</p>'}</div></fieldset><details><summary>เพิ่มวันหยุดพิเศษ / วันปิดสนาม</summary><label class="hint" for="bookingHolidays">หนึ่งวันต่อบรรทัด: YYYY-MM-DD ชื่อวันหยุด</label><textarea id="bookingHolidays" name="holidays" rows="4" placeholder="2026-12-24 สนามปิดซ่อม">${html(cfg.holidays.map(h => h.date + ' ' + h.name).join('\n'))}</textarea></details><button type="submit" class="primary booking-primary">บันทึกวันประจำ &amp; ขาประจำ</button>`;
  }
  function courtSuffix(s) {
    return s.courtNumbers ? ' · คอร์ต ' + s.courtNumbers : '';
  }
  function lineText() {
    const s = data.sessions.find(s => s.id === focusId);
    if (!s?.schedule) return '';
    return [
      `🏸 ${venueLabel} • ก๊วนพร้อมลุย!`,
      `${displayDate(s.date)} | ${s.start}–${s.end} น.${courtSuffix(s)}`,
      `ตัวจริง ${s.confirmedCount}/${s.capacity} คน • ตาราง v${s.scheduleVersion}`,
      '',
      ...s.schedule.schedule.map(
        m =>
          `เกม ${m.round} ⚡ ${m.ids.slice(0, 2).map(gameName).join(' / ')} VS ${m.ids.slice(2).map(gameName).join(' / ')}`,
      ),
      '',
      'จำนวนเกมแต่ละคน',
      ...Object.entries(s.schedule.counts).map(([id, n]) => `${gameName(id)}: ${n} เกม`),
      ...(s.waitlistCount
        ? [
            '',
            'สำรอง: ' +
              s.registrations
                .filter(r => r.status === 'waitlist')
                .map(r => `${r.position}. ${name(r.playerId)}`)
                .join(', '),
          ]
        : []),
      '',
      'พักอย่างน้อย 1 เกม • รายชื่อเปลี่ยน ระบบจัดคู่ใหม่',
      'ตรวจตารางล่าสุด: ' + location.origin + venueUrl('/court') + '#booking',
    ].join('\n');
  }
  function rosterText() {
    const s = data.sessions.find(s => s.id === focusId);
    if (!s) return '';
    const list = status =>
      s.registrations
        .filter(r => r.status === status)
        .map(r => `${r.position}. ${name(r.playerId)}`);
    const confirmed = list('confirmed'),
      waitlist = list('waitlist');
    return [
      `🏸 ${s.isCup ? cupName : venueLabel + ' Court'} • รายชื่อนักตีแบด`,
      `${displayDate(s.date)} | ${s.start}–${s.end} น.${courtSuffix(s)}`,
      '',
      `ตัวจริง ${s.confirmedCount}/${s.capacity} คน`,
      ...(confirmed.length ? confirmed : ['ยังไม่มีรายชื่อ']),
      '',
      `สำรอง ${s.waitlistCount} คน`,
      ...(waitlist.length ? waitlist : ['ยังไม่มีคิวสำรอง']),
      '',
      'ดูคิวล่าสุด: ' + location.origin + venueUrl('/court') + '#booking',
    ].join('\n');
  }
  async function copy(text, output, label) {
    if (!text || !output) return;
    try {
      await navigator.clipboard.writeText(text);
      output.textContent = 'คัดลอกแล้ว พร้อมวางใน LINE ✓';
    } catch {
      const box = document.createElement('textarea');
      box.value = text;
      box.readOnly = true;
      box.setAttribute('aria-label', label);
      output.after(box);
      box.focus();
      box.select();
      let ok = false;
      try {
        ok = document.execCommand('copy');
      } catch {}
      output.textContent = ok
        ? 'คัดลอกแล้ว พร้อมวางใน LINE ✓'
        : 'กดค้างในช่องข้อความ แล้วเลือกคัดลอก';
      if (ok) box.remove();
    }
  }
  async function lineAction(button, body, output) {
    button.disabled = true;
    output.textContent = 'กำลังเชื่อมต่อ LINE…';
    try {
      const response = await venueFetch(
        body ? '/api/line' : '/api/line?diagnose=1',
        body
          ? {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body),
            }
          : {},
      );
      const result = await response.json();
      if (!response.ok) throw Error(result.error);
      if (result.code) {
        const command = q('#bookingLineCommand');
        command.value = '/badbot ' + result.code;
        command.hidden = false;
        output.textContent = 'คัดลอกคำสั่งด้านบนไปส่งในกลุ่ม แล้วกดตรวจการเชื่อมต่อ';
      } else if (body) output.textContent = result.message;
      else {
        output.textContent = result.connected
          ? 'สนามนี้เชื่อมกลุ่ม LINE แล้ว'
          : 'สนามนี้ยังไม่ได้เชื่อมกลุ่ม LINE' + (result.diagnosis ? ' · ' + result.diagnosis : '');
      }
    } catch (e) {
      output.textContent = e.message || 'เชื่อมต่อ LINE ไม่สำเร็จ';
    } finally {
      button.disabled = false;
    }
  }
  root.addEventListener('change', e => {
    if (e.target.matches('[data-book-date]')) {
      e.target.checked
        ? selected.add(e.target.dataset.bookDate)
        : selected.delete(e.target.dataset.bookDate);
      focusId = e.target.dataset.bookDate;
      renderSelection();
      renderDetail();
    }
    if (['bookingHasGuest', 'bookingHasFriend', 'bookingFriend'].includes(e.target.id))
      renderSelection();
    if (e.target.id === 'bookingPlayer') {
      playerId = e.target.value;
      try {
        localStorage.setItem(clubStorage('booking-player'), playerId);
      } catch {}
      render();
    }
    if (e.target.closest('#bookingSettings')) dirty = true;
    if (e.target.closest('#bookingCupSettings')) {
      cupDirty = true;
      const week = Number(q('#bookingCupWeek').value);
      if (e.target.id === 'bookingCupWeek') {
        for (const checkbox of root.querySelectorAll('[data-cup-date]')) {
          const { cupDate, override } = checkbox.dataset;
          checkbox.checked = override === '' ? defaultCupDate(cupDate, week) : override === 'true';
        }
      } else if (e.target.dataset.cupDate) {
        e.target.dataset.override =
          e.target.checked === defaultCupDate(e.target.dataset.cupDate, week)
            ? ''
            : String(e.target.checked);
      }
      if (e.target.dataset.moveFrom) e.target.dataset.touched = '1';
      else renderSponsorMoves();
    }
    if (e.target.name === 'sponsorAward') syncSponsorNote();
  });
  root.addEventListener('input', e => {
    if (e.target.closest('#bookingSettings')) dirty = true;
  });
  root.addEventListener('submit', e => {
    if (e.target.id === 'bookingCupSettings') {
      e.preventDefault();
      const changed = [...e.target.querySelectorAll('[data-cup-date]')].filter(
        checkbox => checkbox.dataset.override !== checkbox.dataset.original,
      );
      const changes = changed.map(checkbox => {
        const { cupDate: date, override } = checkbox.dataset;
        return { date, isCup: override === '' ? null : override === 'true' };
      });
      mutate({
        action: 'cupCalendar',
        week: Number(q('#bookingCupWeek').value),
        cupVersion: Number(e.target.dataset.version),
        changes,
        sponsorMoves: [...root.querySelectorAll('[data-move-from]')].map(select => ({
          from: select.dataset.moveFrom,
          to: select.value || null,
        })),
      });
      return;
    }
    if (e.target.id === 'bookingSponsorForm') {
      e.preventDefault();
      if (sponsorEditing) mutate(sponsorBody());
      return;
    }
    if (e.target.id === 'bookingMapSettings') {
      e.preventDefault();
      const input = q('#bookingMapUrl');
      mutate({ action: 'venueMap', url: input.value.trim(), previousUrl: input.defaultValue });
      return;
    }
    if (e.target.id !== 'bookingSettings') return;
    e.preventDefault();
    const form = new FormData(e.target),
      holidays = [];
    for (const line of String(form.get('holidays') || '')
      .split('\n')
      .map(s => s.trim())
      .filter(Boolean)) {
      const match = line.match(/^(\d{4}-\d{2}-\d{2})\s+(.+)$/);
      if (!match) {
        status('วันหยุดต้องเป็น YYYY-MM-DD ตามด้วยชื่อวันหยุด', true);
        return;
      }
      holidays.push({ date: match[1], name: match[2] });
    }
    const checked = Array.from(e.target.querySelectorAll('[name=regular]:checked'), el => el.value);
    // Preserve the order in which existing regulars joined the list.
    const regularIds = [
      ...data.settings.regularIds.filter(id => checked.includes(id)),
      ...checked.filter(id => !data.settings.regularIds.includes(id)),
    ];
    mutate({
      action: 'settings',
      settingsVersion: data.settingsVersion,
      settings: {
        enabled: form.has('enabled'),
        weekdays: form.getAll('weekday').map(Number),
        start: form.get('start'),
        end: form.get('end'),
        capacity: Number(form.get('capacity')),
        rounds: Number(form.get('rounds')),
        weeks: Number(form.get('weeks')),
        cancellationNoticeHours: Number(form.get('cancellationNoticeHours')),
        holidayPolicy: form.get('holidayPolicy'),
        regularIds,
        holidays,
        courtNumbers: form.get('courtNumbers'),
      },
    });
  });
  root.addEventListener('click', e => {
    const button = e.target.closest('button');
    if (!button || busy) return;
    if (button.hasAttribute('data-job-pick')) openJobPicker(button.dataset.jobPick);
    if (button.dataset.sponsorNew) openSponsor(button.dataset.sponsorNew);
    if (button.dataset.sponsorEdit)
      openSponsor(button.dataset.sponsorSession, button.dataset.sponsorEdit);
    if (button.id === 'sponsorBack') q('#bookingSponsorDialog').close();
    if (button.id === 'sponsorDelete') q('#sponsorDeleteConfirm').hidden = false;
    if (button.id === 'sponsorDeleteYes' && sponsorEditing?.id)
      mutate({ action: 'sponsorDelete', id: sponsorEditing.id, revision: sponsorEditing.revision });
    if (button.id === 'bookingCupReload') {
      cupDirty = false;
      q('#bookingCupStatus').textContent = '';
      button.hidden = true;
      load(true);
    }
    if (button.id === 'bookingMapReload') {
      q('#bookingMapUrl').value = q('#bookingMapUrl').defaultValue;
      q('#bookingMapStatus').textContent = '';
      button.hidden = true;
      load(true);
    }
    if (button.id === 'bookingMore') {
      showAllDates = !showAllDates;
      render();
      if (!showAllDates) q('#bookingDates').scrollIntoView({ block: 'nearest' });
    }
    if (button.id === 'bookingContinue' && selected.size) {
      q('#bookingAcceptHoliday').checked = false;
      q('#bookingHasFriend').checked = false;
      q('#bookingFriend').value = '';
      q('#bookingHasGuest').checked = false;
      q('#bookingGuestName').value = '';
      q('#bookingGuestGender').value = '';
      renderSelection();
      q('#bookingReview').showModal();
    }
    if (button.id === 'bookingRefresh') {
      if (dirty || cupDirty) {
        status('มีการตั้งค่าที่ยังไม่บันทึก กรุณาบันทึกก่อนอัปเดตคิว', true);
        return;
      }
      load();
    }
    if (button.dataset.bookFocus) {
      focusId = button.dataset.bookFocus;
      for (const trigger of root.querySelectorAll('[data-book-focus]')) {
        trigger
          .closest('.booking-date')
          .classList.toggle('is-focus', trigger.dataset.bookFocus === focusId);
      }
      renderDetail();
      if (mobileDetails.matches && supportsDetailsPopup) {
        detailsTriggerId = focusId;
        const content = q('#bookingDetailsContent');
        q('#bookingDetailsStatus').textContent = '';
        content.append(q('#bookingDetailPanels'));
        detailsDialog.showModal();
        content.scrollTop = 0;
      } else q('.booking-detail').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
    if (button.dataset.bookCancel) {
      const s = data.sessions.find(s => s.id === (button.dataset.bookSession || focusId)),
        r = s?.registrations.find(r => r.id === button.dataset.bookCancel);
      if (r) showCancellation(s, r);
    }
    if (button.id === 'bookingCancelBack') q('#bookingCancelDialog').close();
    if (button.id === 'bookingCancelConfirm' && pendingCancellation)
      mutate({
        action: 'cancel',
        ...pendingCancellation,
        acceptLateCancellation: q('#bookingCancelDialog').dataset.late === '1',
      });
    if (button.id === 'bookingEditCourts') {
      const s = data.sessions.find(item => item.id === focusId);
      if (!s || !data.canEdit) return;
      const courtNumbers = prompt(
        'เลขคอร์ตวันที่ ' + displayDate(s.date) + ' เช่น 6, 7 (เว้นว่างเพื่อใช้ค่าเริ่มต้น)',
        s.courtNumbers,
      );
      if (courtNumbers !== null)
        mutate({
          action: 'courtNumbers',
          sessionId: s.id,
          courtNumbers,
          previousCourtNumbers: s.courtNumbersOverride,
        });
    }
    if (button.id === 'bookingClose') {
      const s = data.sessions.find(s => s.id === focusId);
      if (
        s &&
        confirm(
          `${s.closed ? 'เปิด' : 'ปิด'}รับจองรอบ ${displayDate(s.date)}? รายชื่อเดิมยังเก็บไว้`,
        )
      )
        mutate({ action: 'close', sessionId: s.id, closed: !s.closed });
    }
    if (button.id === 'bookingConfirm') {
      const acceptHoliday = q('#bookingAcceptHoliday').checked;
      if (!q('#bookingHolidayConfirm').hidden && !acceptHoliday) {
        feedback('ยังไม่ได้ยืนยันจอง', 'กรุณารับทราบวันหยุดก่อนยืนยันจอง');
        return;
      }
      const guest = q('#bookingHasGuest').checked
        ? { name: q('#bookingGuestName').value.trim(), gender: q('#bookingGuestGender').value }
        : null;
      if (guest && (!guest.name || !guest.gender)) {
        feedback('ยังไม่ได้ยืนยันจอง', 'กรอกชื่อและเลือกเพศของแขกให้ครบ');
        return;
      }
      const friendId = q('#bookingHasFriend').checked ? q('#bookingFriend').value : null;
      if (q('#bookingHasFriend').checked && !friendId) {
        feedback('ยังไม่ได้ยืนยันจอง', 'เลือกชื่อเพื่อนในระบบก่อน');
        return;
      }
      mutate({
        action: 'book',
        ...(friendId ? { friendId } : {}),
        playerId: q('#bookingPlayer').value,
        sessionIds: [...selected],
        acceptHoliday,
        ...(guest ? { guest } : {}),
      });
    }
    if (button.id === 'bookingReroll') {
      const s = data.sessions.find(s => s.id === focusId);
      if (s?.schedule && confirm('จัดคู่ใหม่และแทนตารางเดิมของรอบนี้?'))
        mutate({ action: 'reroll', sessionId: s.id, scheduleVersion: s.scheduleVersion });
    }
    if (button.id === 'bookingCopy')
      copy(lineText(), q('#bookingCopyStatus'), 'ตารางสำหรับคัดลอกลง LINE');
    if (
      button.id === 'bookingLinePair' &&
      confirm('สร้างคำสั่งสำหรับเชื่อมหรือเปลี่ยนกลุ่ม LINE ของสนามนี้?')
    )
      lineAction(button, { action: 'pair' }, q('#bookingLineSetupStatus'));
    if (button.id === 'bookingLineCheck') lineAction(button, null, q('#bookingLineSetupStatus'));
    if (button.id === 'bookingCopyRoster')
      copy(rosterText(), q('#bookingRosterCopyStatus'), 'รายชื่อสำหรับคัดลอกลง LINE');
  });
  // The roster tab shows the same badges: fetch once if the booking tab was skipped.
  document.querySelector('[data-tab="roster"]')?.addEventListener('click', () => {
    if (!data) load(true);
  });
  document.querySelector('[data-tab="booking"]').addEventListener('click', () => {
    if (!dirty && !cupDirty) load();
  });
  // Poll only while this tab is visible; leave unfinished admin edits intact.
  setInterval(() => {
    if (
      !root.hidden &&
      !document.hidden &&
      !dirty &&
      !cupDirty &&
      !detailsDialog.open &&
      !q('#bookingReview').open &&
      !q('#bookingFeedback').open
    )
      load(true);
  }, 60000);
  const initialTab =
    [...document.querySelectorAll('nav .tab')].find(
      t => t.dataset.tab === location.hash.slice(1) && !t.hidden,
    ) || document.querySelector('[data-tab="booking"]');
  initialTab.click();
})();
