(() => {
  const params = new URLSearchParams(location.search);
  const club = params.get('club') === '88' ? '88' : 'sena';
  let id = params.get('bill');
  const manage = params.get('manage') === '1';
  const payerToken = new URLSearchParams(location.hash.slice(1)).get('pay');
  const root = document.querySelector('#billing');
  const status = document.querySelector('#status');
  const receipt = document.querySelector('#receipt');
  const paymentQr = document.querySelector('#paymentQr');
  const qrImage = paymentQr.querySelector('img');
  const qrSaveHint = paymentQr.querySelector('#paymentQrSaveHint');
  const qrPhotoFallback =
    'กดค้างที่รูป QR แล้วเลือกบันทึกรูปภาพ ถ้าเปิดจาก LINE แล้วไม่มีตัวเลือกนี้ ให้เปิดหน้าบิลใน Safari หรือ Chrome';
  let qrPhoto, qrPhotoUrl;
  const clubName = value => (value === '88' ? '88' : 'Sena');
  const money = cents =>
    (cents / 100).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const escape = value =>
    String(value ?? '').replace(
      /[&<>"']/g,
      c =>
        ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#39;',
        })[c],
    );
  const dateLabel = value =>
    new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium', timeZone: 'Asia/Bangkok' }).format(
      new Date(value + 'T12:00:00+07:00'),
    );
  const withdrawalTime = value =>
    new Date(value).toLocaleString('th-TH', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      timeZone: 'Asia/Bangkok',
    }) + ' น.';
  const states = {
    unpaid: 'ยังไม่จ่าย',
    review: 'รอตรวจสลิป',
    rejected: 'ส่งสลิปใหม่',
    paid: 'จ่ายแล้ว',
  };
  const order = { unpaid: 0, rejected: 1, review: 2, paid: 3 };
  let memberSession = null;
  let busy = false,
    slipUrl,
    bill,
    adminList,
    sessions = [],
    attendees = [],
    editing = false;
  const validPromptPay = value => /^(?:[0-9]{10}|[0-9]{13})$/.test(value);
  const clubQuery = club === '88' ? '?club=88' : '';
  let embedded = false;
  try {
    embedded = window.self !== window.top;
  } catch {
    embedded = true;
  }
  document.body.classList.toggle('embedded', embedded);
  document.querySelector('#back').href = '/court' + clubQuery + '#booking';
  const picker = document.querySelector('#venuePicker');
  const clubSelect = picker.querySelector('select');
  clubSelect.value = club;
  clubSelect.addEventListener('change', () =>
    location.assign('/billing.html?club=' + encodeURIComponent(clubSelect.value)),
  );
  for (const link of document.querySelectorAll('.next-tabbar [data-go]'))
    link.href = '/court' + clubQuery + '#' + link.dataset.go;
  document.querySelector('.next-tabbar .tab.active').href = '/billing.html' + clubQuery;
  receipt.addEventListener('close', () => {
    if (slipUrl) URL.revokeObjectURL(slipUrl);
    slipUrl = undefined;
    receipt.querySelector('img').removeAttribute('src');
  });
  paymentQr.addEventListener('close', () => {
    if (qrPhotoUrl) URL.revokeObjectURL(qrPhotoUrl);
    qrPhoto = qrPhotoUrl = undefined;
    qrImage.removeAttribute('src');
  });
  // Share/save the QR image: the system share sheet offers "Save Image"; otherwise show the hint.
  async function shareQrPhoto(photo, hint) {
    const data = { files: [photo] };
    if (!photo || !navigator.share || !navigator.canShare?.(data)) {
      hint.textContent = qrPhotoFallback;
      return;
    }
    try {
      await navigator.share(data);
    } catch (error) {
      if (error.name !== 'AbortError') hint.textContent = qrPhotoFallback;
    }
  }
  // The server draws the QR as SVG; turn it into a PNG File so it can be saved to Photos.
  async function qrPng(svgBlob) {
    const url = URL.createObjectURL(svgBlob);
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      canvas.getContext('2d').drawImage(image, 0, 0);
      const png = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      if (!png) throw Error('เตรียมรูป QR ไม่สำเร็จ กรุณาลองอีกครั้ง');
      return new File([png], 'promptpay.png', { type: 'image/png' });
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  paymentQr
    .querySelector('#paymentQrSave')
    .addEventListener('click', () => shareQrPhoto(qrPhoto, qrSaveHint));

  function endpoint(action, payer) {
    const url = new URL('/api/billing', location.origin);
    url.searchParams.set('club', club);
    if (id) url.searchParams.set('bill', id);
    if (action) url.searchParams.set('action', action);
    if (payer) url.searchParams.set('payer', payer);
    return url;
  }
  async function request(action, options = {}, payer, amount) {
    const headers = new Headers(options.headers);
    if (payerToken) headers.set('X-Bill-Token', payerToken);
    const url = endpoint(action, payer);
    if (amount !== undefined) url.searchParams.set('amount', amount);
    if (action === 'sessions') {
      url.searchParams.delete('bill');
      if (bill?.club) url.searchParams.set('club', bill.club);
      if (params.has('date')) url.searchParams.set('date', params.get('date'));
    }
    const response = await fetch(url, { ...options, headers, cache: 'no-store' });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw Error(error.error || 'เชื่อมต่อระบบบิลไม่สำเร็จ');
    }
    return ['slip', 'qr'].includes(action) ? response.blob() : response.json();
  }
  function post(action, data) {
    return request(action, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
  }
  // Organizer-only AI slip check lines; all text is escaped before innerHTML.
  function aiLines(p) {
    const text = window.SlipCheckText,
      check = p.aiCheck;
    if (!text || !check || !p.hasSlip) return '';
    if (check.state !== 'done')
      return `<small class="ai-check info">${text.stale(check) ? '⏳ AI ตรวจไม่สำเร็จ' : '⏳ กำลังตรวจสลิปด้วย AI…'}</small>`;
    return check.reasons
      .map(reason => {
        const d = text.describe(reason, check);
        return `<small class="ai-check ${d.level}">🤖 ${d.icon} ${escape(d.text)}</small>`;
      })
      .join('');
  }
  function message(text, error = false) {
    status.textContent = text;
    status.classList.toggle('error', error);
  }
  async function run(operation) {
    if (busy) return;
    busy = true;
    root.setAttribute('aria-busy', 'true');
    message('กำลังดำเนินการ…');
    try {
      await operation();
    } catch (error) {
      message(error.message, true);
    } finally {
      busy = false;
      root.removeAttribute('aria-busy');
    }
  }
  function linkToBill(billId, admin = false) {
    const url = new URL('/billing.html', location.origin);
    url.searchParams.set('bill', billId);
    if (admin) {
      url.searchParams.set('manage', '1');
      url.searchParams.set('club', club);
    }
    return url;
  }
  async function copy(value) {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      const box = document.createElement('textarea');
      box.value = value;
      box.setAttribute('aria-label', 'ข้อความพร้อมคัดลอก');
      box.readOnly = true;
      root.prepend(box);
      box.select();
      if (document.execCommand('copy')) box.remove();
      else {
        message('กดค้างในช่องข้อความเพื่อคัดลอก');
        return;
      }
    }
    message('คัดลอกแล้ว');
  }
  let additionalKey, additionalDate, originalBillId;
  function showBill() {
    if (memberSession?.requireLogin && !manage && !payerToken) {
      (embedded ? window.top : window).location.replace(
        '/liff.html?page=pay&club=' + bill.club + '&bill=' + bill.id,
      );
      return;
    }
    const organizer = manage && Number.isInteger(bill.revision);
    const rosterTab = document.querySelector('.next-tabbar [data-go=roster]');
    if (rosterTab) rosterTab.hidden = !organizer;
    const memberReadOnly = memberSession?.requireLogin && !memberSession.loggedIn && !organizer;
    if (bill.cancelled && !organizer) {
      root.innerHTML = '<h1>บิลนี้ถูกยกเลิกแล้ว</h1>';
      message('');
      return;
    }
    const rows = [...bill.payers].sort((a, b) => order[a.status] - order[b.status]);
    const who = payerToken ? rows[0] : null;
    const flagged = organizer ? window.SlipCheckText?.flaggedCount(bill.payers) || 0 : 0;
    const promptpay = validPromptPay(bill.transfer);
    root.innerHTML = `
   ${organizer || payerToken ? `<a class="back-link" href="/billing.html?club=${escape(bill.club)}">← กลับหน้าบิลหลัก</a>` : ''}
   ${organizer ? '<button type="button" data-action="mention-diagnostics">ตรวจแท็กบิล LINE</button>' : ''}
   <h1>${bill.additional ? 'บิลเพิ่มเติม' : 'ค่าใช้จ่าย'} · ${clubName(bill.club)}</h1>
   <p class="muted">${dateLabel(bill.date)} · ผู้ถูกเรียกเก็บ ${bill.people} คน</p>
   <section class="summary">
    <div class="card-title"><h2>ยอดเรียกเก็บ ${money(bill.collection)} บาท</h2><strong class="${bill.outstanding ? 'due' : 'paid'}">${bill.outstanding ? 'ค้าง ' + money(bill.outstanding) + ' บ.' : 'จ่ายครบแล้ว'}</strong></div>
    <p>ค่าคอร์ต ${money(bill.court)} + ค่าลูก ${money(bill.shuttle)} บาท · จ่ายแล้ว ${bill.paid}/${bill.count} บิล</p>
    ${bill.collection > bill.total ? `<p class="muted">ปัดขึ้นรวม ${money(bill.collection - bill.total)} บาท</p>` : ''}
    ${flagged ? `<p class="ai-check warn">🤖 มีสลิปที่ควรตรวจ ${flagged} ใบ</p>` : ''}
   </section>
   ${memberReadOnly ? '<p><a class="button" href="/liff.html?page=pay&club=' + bill.club + '&bill=' + bill.id + '">เข้าสู่ระบบ LINE เพื่อจ่ายบิลของคุณ</a></p>' : ''}${bill.cancelled ? '<p class="error">บิลนี้ถูกยกเลิกแล้ว</p>' : ''}
   ${bill.transfer && !bill.cancelled ? `<section><h2>${promptpay ? 'พร้อมเพย์' : 'ช่องทางโอนเงิน'}</h2><div class="transfer actions"><strong>${escape(bill.transfer)}</strong>${promptpay ? '<button type="button" data-action="copy-promptpay">คัดลอกเลขพร้อมเพย์</button>' : ''}</div></section>` : ''}
   <section>
    <div class="card-title"><h2>${who ? 'ยอดของคุณ' : 'สถานะการชำระ'}</h2><button type="button" data-action="reload">อัปเดต</button></div>
    ${rows
      .map(
        p => `
     <div class="row"><div><strong>${escape(p.name)}</strong>${p.shares > 1 ? ` <small>รวม ${p.shares} คน</small>` : ''}
      <div class="${p.status === 'paid' ? 'paid' : 'due'}">${money(p.amount)} บาท · ${p.method === 'cash' ? (p.status === 'paid' ? 'จ่ายเงินสดแล้ว' : 'แจ้งจ่ายเงินสด รอผู้จัดยืนยัน') : states[p.status]}</div>
      ${organizer ? aiLines(p) : ''}
      ${organizer && p.withdrawals?.length ? p.withdrawals.map(r => `<small class="withdrawal-time">${escape(r.name)} · ถอน ${escape(withdrawalTime(r.withdrawnAt))}</small>`).join('') : ''}${p.note && p.status !== 'paid' ? `<small>${escape(p.note)}</small>` : ''}${p.names && p.shares > 1 ? `<small>${escape(p.names.join(', '))}</small>` : ''}</div>
      <div class="actions">
       ${p.hasSlip ? `<button type="button" data-action="slip" data-payer="${p.id}">ดูสลิป</button>` : ''}
       ${organizer && p.hasSlip && p.aiCheck && window.SlipCheckText?.stale(p.aiCheck) ? `<button type="button" data-action="ai-recheck" data-payer="${p.id}">ตรวจอีกครั้ง</button>` : ''}
       ${!memberReadOnly && !bill.cancelled && promptpay && ['unpaid', 'rejected'].includes(p.status) ? `<button type="button" class="primary" data-action="qr" data-payer="${p.id}">จ่ายด้วย QR</button>` : ''}
       ${!memberReadOnly && !bill.cancelled && (promptpay || who) && ['unpaid', 'rejected'].includes(p.status) ? `<button type="button" data-action="upload" data-payer="${p.id}">แนบสลิป</button>` : ''}
       ${who && !organizer && !memberReadOnly && !bill.cancelled && ['unpaid', 'rejected'].includes(p.status) && !p.hasSlip ? `<button type="button" data-action="cash-request" data-payer="${p.id}">จ่ายด้วยเงินสด</button>` : ''}
       ${who && !organizer && !bill.cancelled && p.status === 'review' && p.method === 'cash' ? `<button type="button" data-action="cash-cancel" data-payer="${p.id}">ยกเลิกแจ้งจ่ายเงินสด</button>` : ''}
       ${organizer && !bill.cancelled && p.hasSlip && p.status === 'review' ? `<button type="button" class="primary" data-action="approve" data-payer="${p.id}">ยืนยันจ่าย</button>` : ''}
       ${organizer && !bill.cancelled && p.hasSlip && p.method !== 'cash' && ['review', 'paid'].includes(p.status) ? `<button type="button" data-action="reject" data-payer="${p.id}">ให้ส่งใหม่</button>` : ''}
       ${organizer && !bill.cancelled && (['unpaid', 'rejected'].includes(p.status) || (p.status === 'review' && p.method === 'cash' && !p.hasSlip)) ? `<button type="button" class="${p.status === 'review' ? 'primary' : ''}" data-action="cash" data-payer="${p.id}">รับเงินสด</button>` : ''}
       ${organizer && bill.canUndoCash && p.method === 'cash' ? `<button type="button" data-action="undo-cash" data-payer="${p.id}">${p.status === 'review' ? 'ยังไม่ได้รับเงิน' : 'ยกเลิกรับเงินสด'}</button>` : ''}
      </div></div>`,
      )
      .join('')}
    <input type="file" id="paymentSlip" accept="image/*" hidden>
    ${!memberReadOnly && !bill.cancelled && promptpay && !who ? '<p class="muted">แนบสลิปในแถวชื่อของคุณ ระบบจะบันทึกว่าจ่ายแล้วทันที</p>' : ''}
   </section>
   ${organizer ? `<div class="actions">${bill.cancelled ? '<button data-action="restore" type="button">เปิดบิลอีกครั้ง</button>' : `<button data-action="share" type="button">คัดลอกบิล / รายชื่อคนค้าง</button><button data-action="edit" type="button">${bill.editable ? 'แก้ไขบิล' : 'แก้เลขพร้อมเพย์'}</button><button data-action="cancel" type="button">ยกเลิกบิล</button>`}<a class="button" href="/billing.html?manage=1&club=${club}">บิลทั้งหมด</a></div>` : ''}`;
    message('');
  }
  function fillAttendees(date) {
    const previous =
      adminList.bills.find(b => b.club === club && b.date === date && !b.additional)?.id ||
      (date === params.get('date') ? originalBillId : undefined);
    const notice = root.querySelector('#additionalNotice');
    notice.hidden = !previous;
    if (previous) notice.querySelector('a').href = linkToBill(previous, true).href;
    const source = sessions.find(s => s.date === date);
    attendees = [...(source?.attendees || []), ...(source?.withdrawals || [])].map(row => ({
      ...row,
      attended: !previous && !row.withdrawnAt && row.attended,
    }));
    renderAttendees();
  }
  function renderAttendees() {
    const row = (p, i) =>
      `<label class="attendee"><input type="checkbox" data-index="${i}" ${p.attended ? 'checked' : ''}><span>${escape(p.name)}${p.guest ? ` <small>แขกของ ${escape(p.payer)}</small>` : ''}${p.friend ? ` <small>เพื่อนของ ${escape(p.payer)} · จ่ายรวมกับคนชวน</small>` : ''}${p.withdrawnAt ? `<small class="withdrawal-time">ถอน ${escape(withdrawalTime(p.withdrawnAt))} · ${p.lateCancellation ? 'หลังกำหนด' : 'ในเวลาปลอดภัย'}</small>` : ''}</span></label>`;
    root.querySelector('#attendance').innerHTML =
      (attendees.some(p => !p.withdrawnAt)
        ? attendees.map((p, i) => (p.withdrawnAt ? '' : row(p, i))).join('')
        : '<p class="muted">ยังไม่มีรายชื่อผู้ตีจริงสำหรับวันนี้ เพิ่มชื่อด้านล่างได้</p>') +
      `<div class="withdrawn-attendees"><h3>รายชื่อคนถอน</h3><p class="muted">ไม่เลือกเก็บเงินไว้เป็นค่าเริ่มต้น ผู้จัดเลือกเพิ่มได้ตามที่ตกลงกัน · เวลาไทย</p>${attendees.some(p => p.withdrawnAt) ? attendees.map((p, i) => (p.withdrawnAt ? row(p, i) : '')).join('') : '<p class="muted">ไม่มีรายชื่อคนถอนสำหรับวันนี้</p>'}</div>`;
    preview();
  }
  function cents(value) {
    if (!/^\d+(?:\.\d{1,2})?$/.test(value)) return null;
    const [baht, fraction = ''] = value.split('.');
    const total = Number(baht) * 100 + Number(fraction.padEnd(2, '0'));
    return Number.isSafeInteger(total) ? total : null;
  }
  function costDraft() {
    const form = root.querySelector('#draft');
    const f = new FormData(form);
    const court = cents(f.get('court') || '0');
    const shuttle = f.has('perShuttle')
      ? cents(f.get('shuttle') || '0') * Number(f.get('shuttleCount'))
      : cents(f.get('shuttle') || '0');
    if (
      court === null ||
      !Number.isSafeInteger(shuttle) ||
      shuttle < 0 ||
      (f.has('perShuttle') && cents(f.get('shuttle') || '0') === null)
    )
      return null;
    return {
      date: f.get('date'),
      court,
      shuttle,
      transfer: f.get('transfer'),
      attendees: attendees
        .filter(p => p.attended)
        .map(({ name, payer, payerKey, withdrawnAt, lateCancellation }) => ({
          name,
          payer,
          payerKey,
          ...(withdrawnAt ? { withdrawnAt, lateCancellation } : {}),
        })),
    };
  }
  function preview() {
    const draft = costDraft();
    const out = root.querySelector('#preview');
    if (!draft || !draft.attendees.length) {
      out.textContent = 'เลือกรายชื่อที่ต้องการเก็บเงินเพื่อดูยอด';
      return;
    }
    const total = draft.court + draft.shuttle;
    const byPayer = new Map();
    draft.attendees.forEach(p => {
      const row = byPayer.get(p.payerKey) || { name: p.payer, seats: 0 };
      row.seats++;
      byPayer.set(p.payerKey, row);
    });
    const payers = [...byPayer.values()];
    for (const p of payers)
      p.amount = Math.ceil((total * p.seats) / (100 * draft.attendees.length)) * 100;
    const collection = payers.reduce((sum, p) => sum + p.amount, 0);
    out.innerHTML = `<strong>ยอดเรียกเก็บ ${money(collection)} บาท · ผู้ถูกเรียกเก็บ ${draft.attendees.length} คน</strong>
   <p>ค่าใช้จ่าย ${money(total)} บาท${collection > total ? ' · ปัดขึ้นรวม ' + money(collection - total) + ' บาท' : ''}</p>
   ${payers.map(p => `<div class="row"><span>${escape(p.name)}${p.seats > 1 ? ' · ' + p.seats + ' คน' : ''}</span><strong>${money(p.amount)} บ.</strong></div>`).join('')}`;
  }
  function showDraft() {
    document.body.classList.remove('home');
    const today = new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
    const suppliedDate = params.get('date');
    const date = editing
      ? bill.date
      : /^\d{4}-\d{2}-\d{2}$/.test(suppliedDate || '')
        ? suppliedDate
        : sessions.find(s => s.date <= today)?.date || today;
    const last = editing
      ? null
      : adminList.bills
          .filter(b => !b.cancelled && b.club === club && b.court + b.shuttle > 0)
          .sort((a, b) => b.date.localeCompare(a.date))[0];
    root.innerHTML = `
   <a class="back-link" href="/billing.html?club=${club}">← กลับหน้าบิลหลัก</a>
   <h1>จบและคิดเงิน · ${clubName(club)}</h1>
   ${!editing && !adminList?.storageReady ? '<p class="error">ระบบเก็บสลิปยังไม่พร้อม เปิดบิลได้เมื่อเชื่อมพื้นที่เก็บสลิปแล้ว</p>' : ''}
   <form id="draft">
    <section>
     <h2>1. เช็กคนที่มาตีจริง</h2>
     ${
       editing
         ? ''
         : `<label>เลือกรอบที่จองไว้<select id="source"><option value="">เลือกวันที่เอง</option>${[
             ...sessions,
           ]
             .sort((a, b) => a.date.localeCompare(b.date))
             .map(
               s =>
                 `<option value="${s.date}" ${s.date === date ? 'selected' : ''}>${dateLabel(s.date)} · ${escape(s.time)}</option>`,
             )
             .join('')}</select></label>`
     }
     <label>วันที่ตี<input type="date" name="date" value="${date}" required ${editing ? 'readonly' : ''}></label>
     ${editing ? '' : '<p id="additionalNotice" class="error" hidden>วันนี้มีบิลแล้ว เลือกเฉพาะคนหรือรายการที่ตกหล่น <a>ดูบิลเดิม</a></p>'}
     <div id="attendance"></div>
     <div class="grid"><label>เพิ่มผู้ตีจริง<input id="addName" maxlength="100" placeholder="ชื่อผู้ตี"></label><label>แขกของ (ถ้ามี)<input id="addHost" maxlength="100" placeholder="ชื่อสมาชิกผู้ชวน"></label></div>
     <button type="button" data-action="add-attendee">+ เพิ่มชื่อ</button>
    </section>
    <section>
     <h2>2. ใส่ค่าใช้จ่ายและบัญชีรับเงิน</h2>
     <div class="grid"><label>ค่าคอร์ตรวม (บาท)<input name="court" type="number" min="0" max="1000000" step="0.01" value="${editing ? bill.court / 100 : (last?.court ?? 0) / 100}"></label>
     <label id="shuttleLabel">ค่าลูกรวม (บาท)<input name="shuttle" type="number" min="0" max="1000000" step="0.01" value="${editing ? bill.shuttle / 100 : (last?.shuttle ?? 0) / 100}"></label></div>
     ${!editing && last ? `<p class="muted">เติมค่าจากบิลล่าสุด (${dateLabel(last.date)}) ให้แล้ว — แก้ได้</p>` : ''}
     <label class="attendee"><input type="checkbox" name="perShuttle"> คิดจากจำนวนลูก × ราคาต่อลูก</label>
     <label id="countLabel" hidden>จำนวนลูก<input name="shuttleCount" type="number" min="1" max="999" step="1" value="1"></label>
     <label>เลขพร้อมเพย์<input name="transfer" required inputmode="numeric" pattern="[0-9]{10}|[0-9]{13}" maxlength="13" value="${escape(editing ? bill.transfer : adminList.promptpay)}"></label>
     ${editing ? '' : '<label class="attendee"><input type="checkbox" name="savePromptPay"> ใช้เลขนี้เป็นค่าเริ่มต้นสำหรับบิลถัดไป</label>'}
    </section>
    <section class="summary"><h2>3. ตรวจยอดก่อนเปิดบิล</h2><div id="preview"></div></section>
    <div class="actions"><button class="primary" type="submit" ${!editing && !adminList.storageReady ? 'disabled' : ''}>${editing ? 'บันทึกการแก้ไข' : 'เปิดบิล'}</button>
    <button type="button" data-action="cancel-draft">กลับ</button></div>
   </form>`;
    if (editing) {
      attendees = bill.payers.flatMap(p =>
        p.names.map(name => ({
          name,
          payer: p.name,
          payerKey: p.payerKey,
          guest: name !== p.name,
          attended: true,
          ...(p.withdrawals?.find(row => row.name === name) || {}),
        })),
      );
      const source = sessions.find(s => s.date === date);
      for (const row of [...(source?.attendees || []), ...(source?.withdrawals || [])]) {
        if (!attendees.some(p => p.name === row.name && p.payerKey === row.payerKey))
          attendees.push({ ...row, attended: false });
      }
      renderAttendees();
    } else fillAttendees(date);
    message('');
  }
  function adminOverviewHtml() {
    const overview = window.BillingOverview;
    const rows = adminList.bills;
    const owe = overview.owing(rows);
    const open = rows.filter(b => !b.cancelled && b.outstanding);
    const finished = [
      ['จ่ายครบ', rows.filter(b => !b.cancelled && !b.outstanding)],
      ['ยกเลิก', rows.filter(b => b.cancelled)],
    ];
    const attrs = (r, name) =>
      `data-bill="${escape(r.billId)}" data-club="${escape(r.club)}" data-payer="${escape(r.payerId)}" data-revision="${r.revision}" data-receipt="${escape(r.receiptId || '')}" data-name="${escape(name)}" data-amount="${r.amount}"`;
    const person = g => {
      const cashRows = g.rows.filter(r => ['unpaid', 'rejected'].includes(r.status));
      return `<div class="owe-card"><div class="owe"><div><strong>${escape(g.name)}</strong><small>ค้าง ${g.bills} บิล</small>${g.review ? '<span class="chip">รอตรวจ</span>' : ''}</div>
       <div class="r">${money(g.totalCents)} บ.<button type="button" class="nag" data-action="nag" data-name="${escape(g.name)}">ทวง</button></div></div>
       ${
         cashRows.length
           ? `<details class="owe-rows"><summary>รับเงินสด</summary>${cashRows
               .map(
                 r =>
                   `<div class="owe-row"><span>${dateLabel(r.date)} · ${money(r.amount)} บ.</span><button type="button" data-action="rv-cash" ${attrs(r, g.name)}>รับเงินสดแล้ว</button></div>`,
               )
               .join('')}</details>`
           : ''
       }</div>`;
    };
    const review = overview.reviewRows(rows);
    const slips = overview.slipRows(rows);
    const flagged = window.SlipCheckText?.flaggedCount(slips) || 0;
    const slipCard = r =>
      `<div class="owe-row slip-row"><span><strong>${escape(r.name)}</strong> · ${dateLabel(r.date)} · ${money(r.amount)} บ.${aiLines(r)}</span>
       <span class="slip-buttons"><button type="button" data-action="rv-slip" ${attrs(r, r.name)}>ดูสลิป</button><button type="button" data-action="rv-reject" ${attrs(r, r.name)}>ให้ส่งใหม่</button></span></div>`;
    const reviewCard = r =>
      `<div class="review-card"><div class="owe"><div><strong>${escape(r.name)}</strong><small>${dateLabel(r.date)} · ${r.kind === 'cash' ? 'แจ้งจ่ายเงินสด' : 'ส่งสลิปแล้ว'}</small>${aiLines(r)}</div><div class="r">${money(r.amount)} บ.</div></div>
       <div class="pay-actions review-actions">${
         r.kind === 'cash'
           ? `<button type="button" class="primary" data-action="rv-cash" ${attrs(r, r.name)}>รับเงินสดแล้ว</button><button type="button" data-action="rv-undo-cash" ${attrs(r, r.name)}>ยังไม่ได้รับเงิน</button>`
           : `<button type="button" data-action="rv-slip" ${attrs(r, r.name)}>ดูสลิป</button><button type="button" class="primary" data-action="rv-approve" ${attrs(r, r.name)}>ยืนยันจ่าย</button><button type="button" data-action="rv-reject" ${attrs(r, r.name)}>ให้ส่งใหม่</button>`
       }</div>
       <a class="more" href="/billing.html?manage=1&club=${escape(r.club)}&bill=${escape(r.billId)}">รายละเอียดบิล</a></div>`;
    const billRow = b =>
      `<a class="bill" href="/billing.html?manage=1&club=${b.club}&bill=${b.id}"><span class="h"><strong>${clubName(b.club)} · ${dateLabel(b.date)}${b.additional ? ' · บิลเพิ่มเติม' : ''}</strong><span>จ่ายแล้ว ${b.paid}/${b.count}</span></span>
       <span class="bar"><i style="width:${Math.round(overview.progress(b) * 100)}%"></i></span>
       <small>${b.cancelled ? 'ยกเลิกแล้ว' : b.outstanding ? 'ค้าง ' + money(b.outstanding) + ' บาท' : 'รวม ' + money(b.collection) + ' บาท'}</small></a>`;
    const inner = `
   <div class="actions"><a class="button create-bill" href="/billing.html?manage=1&new=1&club=${club}">+ สร้างบิลใหม่</a></div>
   <div class="hero"><small>ค้างรวมทั้งก๊วน</small>
    <div class="big">${money(owe.totalCents)} <span>บาท · ${owe.people} คน</span></div>
    ${review.length ? `<p class="flag">รอตรวจ ${review.length} รายการ</p>` : ''}</div>
   ${!adminList.storageReady ? '<p class="error">ระบบเก็บสลิปยังไม่พร้อม</p>' : ''}
   ${review.length ? `<h2 class="sec">รอตรวจ (${review.length})</h2>${review.map(reviewCard).join('')}` : ''}
   ${slips.length ? `<details class="slip-list"${flagged ? ' open' : ''}><summary>สลิปที่แนบแล้ว (${slips.length})${flagged ? ` · ⚠️ ควรเปิดดู ${flagged}` : ''} · ดูสลิป / ให้ส่งใหม่</summary>${slips.map(slipCard).join('')}</details>` : ''}
   <h2 class="sec">ใครยังค้าง</h2>
   ${owe.groups.length > 5 ? '<input type="search" id="oweSearch" class="owe-search" placeholder="ค้นหาชื่อ" aria-label="ค้นหาชื่อคนค้าง" autocomplete="off">' : ''}
   ${
     owe.groups.length
       ? owe.groups.slice(0, 5).map(person).join('') +
         (owe.groups.length > 5
           ? `<details><summary>ดูทั้งหมด ${owe.groups.length} คน</summary>${owe.groups.slice(5).map(person).join('')}</details>`
           : '') +
         `<div class="actions"><button type="button" data-action="nag-all">ทวงทั้งหมด (คัดลอกรายชื่อ)</button><a class="button" target="_top" href="https://line.me/R/share?text=${encodeURIComponent(overview.reminderText(owe.groups, clubName(club), money))}">ส่งต่อใน LINE</a></div>`
       : '<p class="muted">ไม่มีบิลค้าง 🎉</p>'
   }
   <h2 class="sec">บิลค้างแยกตามวัน</h2>
   ${open.length ? open.map(billRow).join('') : '<p class="muted">ยังไม่มีรายการ</p>'}
   ${finished
     .filter(([, list]) => list.length)
     .map(
       ([title, list]) =>
         `<details><summary>${title} (${list.length})</summary>${list.map(billRow).join('')}</details>`,
     )
     .join('')}
   <details class="tools"><summary>⋯ ตั้งค่า</summary>
    <div class="actions"><button type="button" data-action="reload">อัปเดต</button><button type="button" data-action="set-promptpay">ตั้งค่าเลขพร้อมเพย์เริ่มต้น</button><button type="button" data-action="mention-diagnostics">ตรวจแท็กบิล LINE</button></div></details>`;
    return zone('admin', 'ผู้จัดการ · รีวิวบิล', 'สำหรับผู้จัด', inner);
  }
  async function openDraft() {
    if (!adminList) throw Error('กรุณาเข้าสู่ระบบผู้จัด');
    const draft = await request('sessions');
    originalBillId = draft.existing;
    sessions = draft.sessions;
    adminList.storageReady = draft.storageReady;
    adminList.promptpay = draft.promptpay;
    showDraft();
  }
  // Home page (no ?bill=): "ของฉัน" for any logged-in player, plus the overview for organizers.
  let mine = { state: 'login', bills: [] },
    openBill;
  const mineCache = new Map();
  const payTokenOf = item => new URLSearchParams(new URL(item.url).hash.slice(1)).get('pay');
  async function loadMine() {
    try {
      const response = await fetch('/api/member/bills?club=' + club, { cache: 'no-store' });
      if (response.status === 401) return { state: 'login', bills: [] };
      if (!response.ok) return { state: 'error', bills: [] };
      const data = await response.json();
      // A reply without a bills list is an error, never "no bills".
      if (!Array.isArray(data.bills)) return { state: 'error', bills: [] };
      return { state: 'ok', bills: data.bills };
    } catch {
      return { state: 'error', bills: [] };
    }
  }
  // Detail + QR for one of my bills. Only the expanded bill asks for a QR.
  async function mineDetail(item) {
    if (mineCache.has(item.id)) return mineCache.get(item.id);
    const headers = { 'X-Bill-Token': payTokenOf(item) };
    const url = new URL('/api/billing', location.origin);
    url.searchParams.set('club', club);
    url.searchParams.set('bill', item.id);
    const response = await fetch(url, { headers, cache: 'no-store' });
    if (!response.ok) throw Error('โหลดบิลไม่สำเร็จ');
    const detail = await response.json();
    const payer = detail.payers[0];
    let photo, photoUrl;
    if (payer && validPromptPay(detail.transfer) && ['unpaid', 'rejected'].includes(payer.status)) {
      url.searchParams.set('action', 'qr');
      url.searchParams.set('payer', payer.id);
      url.searchParams.set('amount', payer.amount);
      const qr = await fetch(url, { headers, cache: 'no-store' });
      if (qr.ok) {
        photo = await qrPng(await qr.blob());
        photoUrl = URL.createObjectURL(photo);
      }
    }
    const result = { detail, payer, photo, photoUrl };
    mineCache.set(item.id, result);
    return result;
  }
  function zone(kind, title, note, inner) {
    return `<section class="zone zone-${kind}"><div class="zone-head"><h2>${title}</h2><span>${note}</span></div>${inner}</section>`;
  }
  function mineCall(item, action, options = {}, payer, amount) {
    const url = new URL('/api/billing', location.origin);
    url.searchParams.set('club', club);
    url.searchParams.set('bill', item.id);
    url.searchParams.set('action', action);
    if (payer) url.searchParams.set('payer', payer);
    if (amount !== undefined) url.searchParams.set('amount', amount);
    const headers = new Headers(options.headers);
    headers.set('X-Bill-Token', payTokenOf(item));
    return fetch(url, { ...options, headers, cache: 'no-store' }).then(async response => {
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw Error(error.error || 'เชื่อมต่อระบบบิลไม่สำเร็จ');
      }
      return response.json();
    });
  }
  // Organizer action on one payer row from the list (cookie auth; the row carries bill id, payer id, revision).
  async function adminCall(el, action, body) {
    const url = new URL('/api/billing', location.origin);
    url.searchParams.set('club', el.dataset.club);
    url.searchParams.set('bill', el.dataset.bill);
    url.searchParams.set('action', action);
    if (action === 'slip') url.searchParams.set('payer', el.dataset.payer);
    const response = await fetch(url, {
      method: body ? 'POST' : 'GET',
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store',
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw Error(error.error || 'เชื่อมต่อระบบบิลไม่สำเร็จ');
    }
    return action === 'slip' ? response.blob() : response.json();
  }
  const mineItem = billId => mine.bills.find(b => b.id === billId);
  function mineChanged() {
    mineCache.clear();
    return load();
  }
  function mineHtml() {
    const loginLink = '/liff.html?page=pay&club=' + club;
    const head = '';
    const wrap = inner => zone('mine', 'ของฉัน', 'บิลที่คุณต้องจ่าย', inner);
    if (mine.state === 'login')
      return wrap(
        `<p class="muted">กรุณาเข้าสู่ระบบ LINE เพื่อดูบิลของคุณ</p><a class="button" target="_top" href="${loginLink}">เข้าสู่ระบบ LINE</a>`,
      );
    if (mine.state === 'error')
      return wrap(
        '<p class="error">โหลดบิลของคุณไม่สำเร็จ</p><div class="actions"><button type="button" data-action="reload">ลองอีกครั้ง</button></div>',
      );
    const unpaid = mine.bills
      .filter(b => ['unpaid', 'rejected'].includes(b.status))
      .sort((a, b) => a.date.localeCompare(b.date));
    const waiting = mine.bills.filter(b => b.status === 'review');
    const paid = mine.bills.filter(b => b.status === 'paid');
    const total = unpaid.reduce((sum, b) => sum + b.amount, 0);
    const statusBanner = unpaid.length
      ? `<div class="status status-due"><b>มีค้างจ่าย</b><div class="big">${money(total)} <span>บาท · ${unpaid.length} บิล</span></div>${unpaid.length > 1 ? '<small>จ่ายทีละบิล เริ่มจากบิลเก่าสุดก่อน · สลิปหนึ่งใบต่อหนึ่งบิล</small>' : ''}</div>`
      : waiting.length
        ? `<div class="status status-ok"><b>ไม่มีค้างจ่าย</b><small>มี ${waiting.length} บิลรอผู้จัดตรวจสลิป</small></div>`
        : '<div class="status status-ok"><b>ไม่มีค้างจ่าย ✓</b></div>';
    if (!mine.bills.length)
      return wrap(
        memberSession?.link?.status === 'approved'
          ? statusBanner
          : '<div class="status status-due"><b>บัญชี LINE นี้ยังไม่ได้ผูกกับชื่อผู้เล่น</b><small>กรุณาแจ้งผู้จัดให้ผูกชื่อให้</small></div>',
      );
    const open = unpaid.some(b => b.id === openBill) ? openBill : unpaid[0]?.id;
    const title = b => `${dateLabel(b.date)}`;
    const slipButton = b =>
      b.hasSlip
        ? `<button type="button" class="pill2" data-action="mine-view-slip" data-bill="${b.id}">ดูสลิป</button>`
        : '';
    return wrap(`${statusBanner}
   ${unpaid
     .map(b =>
       b.id === open
         ? `<div class="mine" data-bill="${b.id}"><div class="t"><strong>${title(b)}</strong><span class="amt due">${money(b.amount)} บ.</span></div>
            ${b.status === 'rejected' ? '<small class="error">ผู้จัดให้ส่งสลิปใหม่</small>' : ''}<div class="mine-body" data-body="${b.id}"><small>กำลังโหลด…</small></div></div>`
         : `<div class="mine collapsed"><div class="t"><div><strong>${title(b)}</strong><br><small>ยังไม่จ่าย</small></div><span class="amt due">${money(b.amount)} บ.</span><button type="button" class="pill2" data-action="open-mine" data-bill="${b.id}">จ่ายด้วย QR</button></div></div>`,
     )
     .join('')}
   ${waiting.map(b => `<div class="mine collapsed"><div class="t"><div><strong>${title(b)}</strong><br><small>${b.hasSlip ? 'ส่งสลิปแล้ว' : 'แจ้งจ่ายเงินสดแล้ว'} · รอผู้จัดตรวจ</small></div><span class="amt">${money(b.amount)} บ.</span>${slipButton(b)}</div></div>`).join('')}
   ${paid.length ? `<details><summary>จ่ายแล้ว (${paid.length})</summary>${paid.map(b => `<div class="owe"><div><strong>${title(b)}</strong>${b.method === 'cash' ? '<small>เงินสด</small>' : ''}</div><div class="r">✓ ${money(b.amount)} บ.${slipButton(b)}</div></div>`).join('')}</details>` : ''}`);
  }

  async function fillMine() {
    const item =
      mine.bills.find(b => b.id === openBill) ||
      mine.bills.find(b => ['unpaid', 'rejected'].includes(b.status));
    const body = item && root.querySelector(`[data-body="${item.id}"]`);
    if (!body) return;
    try {
      const { detail, payer, photoUrl } = await mineDetail(item);
      const slipButton = `<button type="button" data-action="mine-slip" data-bill="${item.id}">แนบสลิป</button>`;
      const cashButton = payer?.hasSlip
        ? ''
        : `<button type="button" data-action="mine-cash" data-bill="${item.id}">จ่ายเงินสด</button>`;
      const actions = `<div class="pay-actions">${
        photoUrl
          ? `<button type="button" class="primary" data-action="save-qr" data-bill="${item.id}">บันทึกลงรูปภาพ</button>`
          : ''
      }${slipButton}${cashButton}</div><input type="file" id="mineSlip" accept="image/*" hidden>`;
      const note =
        payer?.status === 'rejected' && payer.note
          ? `<p class="reject-note"><b>ผู้จัดให้ส่งสลิปใหม่:</b> ${escape(payer.note)}</p>`
          : '';
      const split = window.BillingOverview.splitLines(detail, payer, money)
        .map(line => `<small class="split">${escape(line)}</small>`)
        .join('');
      const copies = validPromptPay(detail.transfer)
        ? `<div class="copy-row"><span>พร้อมเพย์ <b>${escape(detail.transfer)}</b></span><button type="button" class="pill2" data-action="mine-copy" data-value="${escape(detail.transfer)}">คัดลอกเลข</button></div>
           <div class="copy-row"><span>ยอด <b>${money(item.amount)}</b> บาท</span><button type="button" class="pill2" data-action="mine-copy" data-value="${(item.amount / 100).toFixed(2)}">คัดลอกยอด</button></div>`
        : '';
      body.innerHTML = `${note}${split}${
        photoUrl
          ? `<img class="qr" src="${photoUrl}" alt="QR พร้อมเพย์สำหรับยอดของคุณ"><p class="qrnote">ตรวจชื่อผู้รับและยอดก่อนยืนยัน</p><p id="mineSaveHint" class="muted" role="status"></p>`
          : ''
      }${copies}${photoUrl ? '' : detail.transfer && !copies ? `<p>ช่องทางโอนเงิน</p><div class="transfer">${escape(detail.transfer)}</div>` : ''}${actions}`;
    } catch (error) {
      body.innerHTML = `<p class="error">${escape(error.message)}</p><a class="button" href="${escape(item.url)}">เปิดหน้าบิล</a>`;
    }
  }
  function showHome() {
    document.body.classList.add('home');
    root.innerHTML = mineHtml() + (adminList ? adminOverviewHtml() : '');
    const roster = document.querySelector('.next-tabbar [data-go=roster]');
    if (roster) roster.hidden = !adminList;
    message('');
    fillMine();
  }
  root.addEventListener('input', event => {
    if (event.target.id !== 'oweSearch') return;
    const q = event.target.value.trim().toLowerCase();
    for (const card of root.querySelectorAll('.owe-card')) {
      card.hidden =
        Boolean(q) && !card.querySelector('strong').textContent.toLowerCase().includes(q);
      if (q && !card.hidden) card.closest('details')?.setAttribute('open', '');
    }
  });
  window.addEventListener('message', event => {
    if (event.origin === location.origin && event.data === 'bills-refresh' && !id && !editing)
      run(load);
  });
  async function load() {
    document.body.classList.remove('home');
    picker.hidden = Boolean(id);
    if (id) {
      bill = await request();
      showBill();
      return;
    }
    mineCache.clear();
    const [list, memberBills] = await Promise.all([request().catch(() => null), loadMine()]);
    adminList = list;
    mine = memberBills;
    // Tell the menu around this page (court.html) whether to show the red "!" on the bills tab.
    if (window.parent !== window && mine.state === 'ok')
      parent.postMessage(
        {
          type: 'bills-due',
          count: mine.bills.filter(b => ['unpaid', 'rejected'].includes(b.status)).length,
        },
        location.origin,
      );
    showHome();
  }
  async function compress(file) {
    if (!file || file.size > 20 * 1024 * 1024) throw Error('เลือกรูปสลิปขนาดไม่เกิน 20 MB');
    const url = URL.createObjectURL(file);
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      const canvas = document.createElement('canvas');
      const ratio = Math.min(1, 1400 / Math.max(image.naturalWidth, image.naturalHeight));
      canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio));
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = 'white';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      for (const quality of [0.88, 0.78, 0.66]) {
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
        if (blob && (blob.size <= 320 * 1024 || (quality === 0.66 && blob.size <= 1024 * 1024)))
          return blob;
      }
    } catch {
      if (['image/jpeg', 'image/png', 'image/webp'].includes(file.type) && file.size <= 1024 * 1024)
        return file;
    } finally {
      URL.revokeObjectURL(url);
    }
    throw Error('เปิดรูปสลิปไม่ได้หรือรูปใหญ่เกินไป ลองใช้ภาพหน้าจอ JPG หรือ PNG');
  }
  root.addEventListener('input', e => {
    if (!e.target.closest('#draft')) return;
    if (e.target.matches('[data-index]'))
      attendees[Number(e.target.dataset.index)].attended = e.target.checked;
    if (e.target.name === 'perShuttle') {
      root.querySelector('#countLabel').hidden = !e.target.checked;
      root.querySelector('#shuttleLabel').firstChild.textContent = e.target.checked
        ? 'ราคาต่อลูก (บาท)'
        : 'ค่าลูกรวม (บาท)';
    }
    preview();
  });
  root.addEventListener('change', e => {
    if (e.target.id === 'mineSlip') {
      const input = e.target,
        item = mineItem(input.dataset.bill),
        file = input.files[0];
      input.value = '';
      if (!file || !item) return;
      return run(async () => {
        const { payer } = await mineDetail(item);
        if (
          !confirm(
            'แนบสลิปและบันทึกว่าจ่ายแล้วสำหรับ ' +
              payer.name +
              ' จำนวน ' +
              money(payer.amount) +
              ' บาท?',
          )
        )
          return;
        const blob = await compress(file);
        await mineCall(
          item,
          'upload',
          { method: 'POST', headers: { 'Content-Type': blob.type }, body: blob },
          payer.id,
          payer.amount,
        );
        await mineChanged();
        message('แนบสลิปแล้ว · จ่ายแล้ว');
      });
    }
    if (e.target.id === 'paymentSlip') {
      const input = e.target,
        payer = bill.payers.find(p => p.id === input.dataset.payer);
      const file = input.files[0];
      if (
        file &&
        payer &&
        confirm(
          'แนบสลิปและบันทึกว่าจ่ายแล้วสำหรับ ' +
            payer.name +
            ' จำนวน ' +
            money(payer.amount) +
            ' บาท?',
        )
      )
        run(async () => {
          const blob = await compress(file);
          await request(
            'upload',
            { method: 'POST', headers: { 'Content-Type': blob.type }, body: blob },
            payer.id,
            payer.amount,
          );
          await load();
          message('แนบสลิปแล้ว · จ่ายแล้ว');
        });
      input.value = '';
      return;
    }
    if (!e.target.closest('#draft') || editing) return;
    if (e.target.id === 'source' && e.target.value) {
      root.querySelector('[name=date]').value = e.target.value;
      fillAttendees(e.target.value);
    } else if (e.target.name === 'date') {
      root.querySelector('#source').value = e.target.value;
      fillAttendees(e.target.value);
    }
  });
  root.addEventListener('submit', e => {
    e.preventDefault();
    if (e.target.id === 'draft') {
      const draft = costDraft();
      const savePromptPay = new FormData(e.target).has('savePromptPay');
      if (!draft || !draft.attendees.length || draft.court + draft.shuttle < 1) {
        message('ตรวจค่าใช้จ่ายและเลือกรายชื่อที่ต้องการเก็บเงินก่อน', true);
        return;
      }
      run(async () => {
        if (editing) {
          await post('edit', { ...draft, revision: bill.revision });
          editing = false;
          await load();
        } else {
          if (savePromptPay) await post('promptpay', { promptpay: draft.transfer });
          let result;
          if (additionalKey && additionalDate === draft.date) {
            result = await post(null, { ...draft, additional: additionalKey });
          } else {
            result = await post(null, draft);
            if (result.existing) {
              if (!confirm('วันนี้เปิดบิลไปแล้ว ต้องการสร้างบิลเพิ่มเติมแยกจากบิลเดิมใช่ไหม?'))
                return message('');
              additionalKey = Array.from(crypto.getRandomValues(new Uint8Array(16)), n =>
                n.toString(16).padStart(2, '0'),
              ).join('');
              additionalDate = draft.date;
              result = await post(null, { ...draft, additional: additionalKey });
            }
          }
          id = result.id;
          location.replace(linkToBill(id, true).href);
        }
      });
    }
  });
  root.addEventListener('click', e => {
    const target = e.target.closest('[data-action]');
    if (!target || busy) return;
    const action = target.dataset.action;
    const payer = bill?.payers.find(p => p.id === target.dataset.payer);
    if (action === 'mention-diagnostics')
      return run(async () => {
        const response = await fetch('/api/line?mentionDiagnostics=1&club=' + club, {
            cache: 'no-store',
          }),
          data = await response.json();
        if (!response.ok) throw Error(data.error || 'ตรวจไม่ได้');
        const reasons = {
          mention_ready: 'ยืนยัน userId ในกลุ่มแล้ว',
          not_linked: 'ยังไม่พบการผูกบัญชีผู้จ่าย',
          legacy_payer_key: 'บิลเก่าไม่ได้อ้างอิงรหัสสมาชิก',
          not_in_group_or_provider_mismatch: 'LINE หาในกลุ่มไม่เจอ: ตรวจสมาชิกกลุ่มและ Provider',
          line_credentials_rejected: 'LINE ไม่รับสิทธิ์ Access Token',
          invalid_line_user_id: 'รหัส LINE ไม่ถูกต้อง',
          line_profile_identity_mismatch: 'LINE ตอบรหัสสมาชิกไม่ตรงกับที่ขอ',
          reply_message_limit: 'รายชื่อเกินขีดจำกัดคำตอบ: ยังไม่ได้แท็กใคร',
          line_profile_error: 'LINE ตรวจสมาชิกไม่สำเร็จ',
          line_profile_timeout_or_network: 'ตรวจสมาชิกหมดเวลาหรือเครือข่ายขัดข้อง',
        };
        const lines = [
          'ผลตรวจแท็ก LINE · ' + clubName(club),
          'รูปแบบข้อความ: HTTP ' + data.validation.status,
          'พร้อมแท็กตอนตรวจ: ' + data.mentionCount + ' คน',
          data.webhook.checked
            ? 'Webhook: ' +
              (data.webhook.endpointMatches ? 'URL ถูกต้อง' : 'URL ไม่ตรงกับเว็บนี้') +
              ' · ' +
              (data.webhook.active ? 'เปิดอยู่' : 'ปิดอยู่')
            : 'ยังตรวจ Webhook ไม่ได้',
          ...data.payers.map(
            p =>
              '• ' +
              p.name +
              ': ' +
              (reasons[p.reason] || p.reason) +
              (p.httpStatus ? ' (HTTP ' + p.httpStatus + ')' : ''),
          ),
        ];
        if (data.latest)
          lines.push(
            'คำสั่งที่ตรวจล่าสุด: ' +
              (data.latest.command || 'badbot bill') +
              ' · ' +
              new Date(data.latest.updatedAt).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' }),
            'ส่งถึง LINE: HTTP ' +
              data.latest.replyStatus +
              ' · ส่งข้อมูล mention ' +
              data.latest.mentionCount +
              ' รายการ · ' +
              data.latest.messageTypes.join(', '),
            ...data.latest.payers.map(p => '• ' + p.name + ': ' + (reasons[p.reason] || p.reason)),
          );
        else lines.push('ยังไม่มีบันทึกคำสั่งจริง ให้พิมพ์ badbot bill ในกลุ่มแล้วกดตรวจอีกครั้ง');
        if (data.latest) {
          lines.push(
            'ผล API: ' +
              ({
                accepted: 'LINE รับคำขอแล้ว แต่ยังไม่ยืนยันสีแท็กหรือการแจ้งเตือน',
                rejected: 'LINE ปฏิเสธข้อความ — การแท็กไม่สำเร็จ',
                network_error: 'ติดต่อ LINE ไม่สำเร็จ — ยังยืนยันการส่งไม่ได้',
              }[data.latest.outcome] || 'บันทึกเก่ามีเฉพาะ HTTP status'),
          );
          if (data.latest.requestId) lines.push('LINE request ID: ' + data.latest.requestId);
          if (data.latest.error) lines.push('Error: ' + JSON.stringify(data.latest.error));
          if (data.latest.payload)
            lines.push(
              'Payload ที่ส่ง (แทน userId ด้วยรหัสตัวอย่าง; ไม่เก็บ replyToken):',
              JSON.stringify(data.latest.payload, null, 2),
            );
        }
        if (data.validation.message) lines.push(data.validation.message);
        let report = root.querySelector('#mentionReport');
        if (!report) {
          report = document.createElement('textarea');
          report.id = 'mentionReport';
          report.readOnly = true;
          report.rows = 12;
          report.setAttribute('aria-label', 'ผลตรวจแท็ก LINE สำหรับคัดลอก');
          root.prepend(report);
        }
        report.value = lines.join('\n');
        message('ตรวจแล้ว คัดลอกผลตรวจด้านบนส่งให้ผู้จัดหรือผู้พัฒนาได้');
      });
    if (action === 'nag' || action === 'nag-all') {
      const groups = window.BillingOverview.owing(adminList.bills).groups;
      const chosen = action === 'nag' ? groups.filter(g => g.name === target.dataset.name) : groups;
      return copy(window.BillingOverview.reminderText(chosen, clubName(club), money));
    }
    if (action === 'mine-slip') {
      const input = root.querySelector('#mineSlip');
      input.dataset.bill = target.dataset.bill;
      return input.click();
    }
    if (action === 'mine-cash') {
      const item = mineItem(target.dataset.bill);
      return run(async () => {
        const { payer } = await mineDetail(item);
        if (
          !confirm(
            'แจ้งว่าจะจ่ายด้วยเงินสด ' +
              money(payer.amount) +
              ' บาท? ยอดจะยังไม่ถูกบันทึกว่าจ่าย จนกว่าผู้จัดจะยืนยันว่าได้รับเงินแล้ว',
          )
        )
          return;
        await mineCall(
          item,
          'cash-request',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{}',
          },
          payer.id,
        );
        await mineChanged();
        message('แจ้งจ่ายเงินสดแล้ว · รอผู้จัดยืนยัน');
      });
    }
    if (action.startsWith('rv-')) {
      const name = target.dataset.name,
        amount = money(Number(target.dataset.amount));
      if (action === 'rv-slip')
        return run(async () => {
          slipUrl = URL.createObjectURL(await adminCall(target, 'slip'));
          receipt.querySelector('img').src = slipUrl;
          receipt.showModal();
          message('');
        });
      if (action === 'rv-approve') {
        if (!confirm('ตรวจยอดและบัญชีรับเงินแล้ว ยืนยันว่า ' + name + ' จ่าย ' + amount + ' บาท?'))
          return;
        return run(async () => {
          await adminCall(target, 'review', {
            payer: target.dataset.payer,
            receiptId: target.dataset.receipt,
            status: 'paid',
            note: '',
          });
          await load();
          message('ยืนยันแล้ว · ' + name + ' จ่ายแล้ว');
        });
      }
      if (action === 'rv-reject') {
        const aiCheck = adminList.bills
          .find(b => b.id === target.dataset.bill)
          ?.payers.find(p => p.id === target.dataset.payer)?.aiCheck;
        const note = prompt(
          'เหตุผลที่ให้ส่งสลิปใหม่',
          window.SlipCheckText?.rejectNote(aiCheck) || '',
        );
        if (note === null) return;
        return run(async () => {
          await adminCall(target, 'review', {
            payer: target.dataset.payer,
            receiptId: target.dataset.receipt,
            status: 'rejected',
            note: note.trim(),
          });
          await load();
          message('ให้ ' + name + ' ส่งสลิปใหม่แล้ว');
        });
      }
      const received = action === 'rv-cash';
      if (
        !confirm(
          received
            ? 'ยืนยันว่าได้รับเงินสดจาก ' + name + ' ' + amount + ' บาทแล้ว?'
            : 'ยกเลิกรายการรับเงินสดของ ' + name + '?',
        )
      )
        return;
      return run(async () => {
        await adminCall(target, 'cash', {
          payer: target.dataset.payer,
          received,
          revision: Number(target.dataset.revision),
        });
        await load();
        message(received ? 'บันทึกรับเงินสดแล้ว' : 'ยกเลิกรายการรับเงินสดแล้ว');
      });
    }
    if (action === 'open-mine') {
      openBill = target.dataset.bill;
      return showHome();
    }
    if (action === 'mine-copy') return copy(target.dataset.value);
    if (action === 'mine-view-slip')
      return run(async () => {
        const item = mineItem(target.dataset.bill);
        const response = await fetch(
          `/api/billing?club=${club}&bill=${encodeURIComponent(item.id)}&action=slip`,
          { headers: { 'X-Bill-Token': payTokenOf(item) }, cache: 'no-store' },
        );
        if (!response.ok) throw Error('ไม่พบสลิป (อาจถูกลบหลังจ่ายครบแล้ว)');
        slipUrl = URL.createObjectURL(await response.blob());
        receipt.querySelector('img').src = slipUrl;
        receipt.showModal();
        message('');
      });
    if (action === 'save-qr')
      return shareQrPhoto(
        mineCache.get(target.dataset.bill)?.photo,
        root.querySelector('#mineSaveHint'),
      );
    if (action === 'reload') return run(load);
    if (action === 'set-promptpay') {
      const promptpay = prompt('เลขพร้อมเพย์เริ่มต้น 10 หรือ 13 หลัก', adminList.promptpay)?.trim();
      if (promptpay === undefined) return;
      if (!validPromptPay(promptpay)) {
        message('กรุณาใส่เลขพร้อมเพย์ 10 หรือ 13 หลัก', true);
        return;
      }
      return run(async () => {
        await post('promptpay', { promptpay });
        await load();
        message('บันทึกเลขพร้อมเพย์เริ่มต้นแล้ว');
      });
    }
    if (action === 'edit') {
      if (bill.editable)
        return run(async () => {
          sessions = (await request('sessions')).sessions;
          editing = true;
          showDraft();
        });
      const transfer = prompt('เลขพร้อมเพย์ 10 หรือ 13 หลัก', bill.transfer)?.trim();
      if (transfer === undefined) return;
      if (!validPromptPay(transfer)) {
        message('กรุณาใส่เลขพร้อมเพย์ 10 หรือ 13 หลัก', true);
        return;
      }
      return run(async () => {
        await post('edit', { transfer, revision: bill.revision });
        await load();
      });
    }
    if (action === 'cancel' || action === 'restore') {
      if (
        action === 'cancel' &&
        !confirm('ยกเลิกบิลนี้และซ่อนจากรายการค้าง? คุณเปิดบิลอีกครั้งได้')
      )
        return;
      return run(async () => {
        await post(action, { revision: bill.revision });
        await load();
      });
    }
    if (action === 'cancel-draft') {
      editing = false;
      return bill ? showBill() : showHome();
    }
    if (action === 'add-attendee') {
      const nameInput = root.querySelector('#addName'),
        hostInput = root.querySelector('#addHost');
      const name = nameInput.value.trim(),
        host = hostInput.value.trim() || name;
      if (!name) {
        nameInput.focus();
        return;
      }
      const normalize = value => value.normalize('NFC').toLowerCase();
      const existing = attendees.find(p => normalize(p.payer) === normalize(host));
      const payerKey = existing?.payerKey || 'name:' + normalize(host);
      const same = attendees.find(
        p => normalize(p.name) === normalize(name) && p.payerKey === payerKey,
      );
      if (same) same.attended = true;
      else
        attendees.push({
          name,
          payer: existing?.payer || host,
          payerKey,
          attended: true,
          guest: Boolean(hostInput.value.trim()),
        });
      nameInput.value = hostInput.value = '';
      return renderAttendees();
    }
    if (action === 'copy-promptpay') return run(() => copy(bill.transfer));
    if (action === 'qr' && payer)
      return run(async () => {
        qrPhoto = await qrPng(await request('qr', {}, payer.id, payer.amount));
        qrImage.src = qrPhotoUrl = URL.createObjectURL(qrPhoto);
        qrSaveHint.textContent = navigator.canShare?.({ files: [qrPhoto] })
          ? 'ในเมนูแชร์ เลือกบันทึกรูปภาพ (Save Image)'
          : qrPhotoFallback;
        paymentQr.querySelector('#paymentQrAmount').textContent =
          payer.name + ' · ' + money(payer.amount) + ' บาท';
        paymentQr.showModal();
        message('');
      });
    if ((action === 'cash-request' || action === 'cash-cancel') && payer) {
      if (
        action === 'cash-request' &&
        !confirm(
          'แจ้งว่าจะจ่ายด้วยเงินสด ' +
            money(payer.amount) +
            ' บาท? ยอดจะยังไม่ถูกบันทึกว่าจ่าย จนกว่าผู้จัดจะยืนยันว่าได้รับเงินแล้ว',
        )
      )
        return;
      return run(async () => {
        await post(action, {});
        await load();
      });
    }
    if ((action === 'cash' || action === 'undo-cash') && payer) {
      const received = action === 'cash';
      if (
        !confirm(
          received
            ? 'ยืนยันว่าได้รับเงินสดจาก ' + payer.name + ' ' + money(payer.amount) + ' บาทแล้ว?'
            : 'ยกเลิกรายการรับเงินสดของ ' + payer.name + '?',
        )
      )
        return;
      return run(async () => {
        await post('cash', { payer: payer.id, received, revision: bill.revision });
        await load();
      });
    }
    if (action === 'upload' && payer) {
      const input = root.querySelector('#paymentSlip');
      input.dataset.payer = payer.id;
      return input.click();
    }
    if (action === 'share') {
      const lines = [
        '💸 ' + clubName(bill.club) + ' · ' + dateLabel(bill.date),
        'ค้าง ' + money(bill.outstanding) + ' บาท',
      ];
      for (const p of bill.payers.filter(p => ['unpaid', 'rejected'].includes(p.status)))
        lines.push('• ' + p.name + ' ' + money(p.amount) + ' บาท · ' + states[p.status]);
      const reviewing = bill.payers.filter(p => p.status === 'review').length;
      if (reviewing) lines.push('รอตรวจสลิป/เงินสด ' + reviewing + ' คน');
      lines.push(linkToBill(id).href);
      return run(() => copy(lines.join('\n')));
    }
    if (action === 'ai-recheck' && payer)
      return run(async () => {
        await post('slip-check', { payer: payer.id });
        await load();
      });
    if (action === 'slip' && payer)
      return run(async () => {
        const blob = await request('slip', {}, payer.id);
        slipUrl = URL.createObjectURL(blob);
        receipt.querySelector('img').src = slipUrl;
        receipt.showModal();
        message('');
      });
    if ((action === 'approve' || action === 'reject') && payer) {
      const note =
        action === 'reject'
          ? prompt('เหตุผลที่ให้ส่งสลิปใหม่', window.SlipCheckText?.rejectNote(payer.aiCheck) || '')
          : '';
      if (
        note === null ||
        (action === 'approve' &&
          !confirm(
            'ตรวจยอดและบัญชีรับเงินแล้ว ยืนยันว่า ' +
              payer.name +
              ' จ่าย ' +
              money(payer.amount) +
              ' บาท?',
          ))
      )
        return;
      run(async () => {
        await post('review', {
          payer: payer.id,
          receiptId: payer.receiptId,
          status: action === 'approve' ? 'paid' : 'rejected',
          note,
        });
        await load();
      });
    }
  });
  run(async () => {
    try {
      const memberResponse = await fetch('/api/member?club=' + club, { cache: 'no-store' });
      if (memberResponse.ok) memberSession = await memberResponse.json();
      if (
        memberSession?.requireLogin &&
        !manage &&
        id &&
        (!memberSession.loggedIn || !payerToken)
      ) {
        (embedded ? window.top : window).location.replace(
          '/liff.html?page=pay&club=' + club + '&bill=' + encodeURIComponent(id),
        );
        return;
      }
      await load();
      if (!id && manage && (params.has('date') || params.has('new'))) await openDraft();
    } catch (error) {
      if (manage && !payerToken)
        root.innerHTML =
          '<h1>บิลค่าใช้จ่าย</h1><a class="button" href="/court#booking">เข้าสู่ระบบผู้จัดจากหน้าจอง</a>';
      throw error;
    }
  });
})();
