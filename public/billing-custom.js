// Form for a custom bill (e.g. dinner after badminton): not tied to a session.
// mount() draws it into `root`; billing.js supplies the server calls (see opts).
// The maths is SenaCustomSplit.split, the same code the Worker runs to check it.
(() => {
  const esc = value =>
    String(value ?? '').replace(
      /[&<>"']/g,
      c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
    );
  const money = cents =>
    (cents / 100).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  // Baht typed by a person → satang. Empty stays NaN so "missing" is never read as 0.
  const toCents = value => {
    const text = String(value ?? '')
      .replace(/,/g, '')
      .trim();
    return text === '' ? NaN : Math.round(Number(text) * 100);
  };
  const thaiToday = () => new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
  const STORE = 'sena-custom-promptpay';
  const remembered = () => {
    try {
      return localStorage.getItem(STORE) || '';
    } catch {
      return '';
    }
  };
  const remember = value => {
    try {
      localStorage.setItem(STORE, value);
    } catch {
      /* private mode: just do not remember */
    }
  };
  const promptPayOk = value => /^(?:0[0-9]{9}|[0-9]{13})$/.test(value);

  async function mount(root, opts) {
    const { fetchPeople, submit, cancel, run, message, initial } = opts;
    const editing = Boolean(initial);
    let people;
    try {
      people = await fetchPeople();
    } catch (error) {
      root.innerHTML = `<h1>สร้างบิลอื่นๆ</h1><p class="error">${esc(error.message)}</p>`;
      return;
    }
    const nameOf = key => people.members.find(m => m.payerKey === key)?.name || key;
    let nextGuest = 1;
    const state = {
      title: initial?.title ?? '',
      date: initial?.date ?? thaiToday(),
      transfer: initial?.transfer || people.myPromptpay || remembered(),
      chosen: [], // member keys in the order they were ticked
      guests: [], // { id, name, guestOf }
      receiver: '',
      mode: 'even',
      total: '',
      amounts: {}, // person id → baht text
      items: [], // { name, price, who: Set of person ids }
    };
    if (initial) {
      const draft = initial.draft;
      const ids = draft.people.map(p => (p.guest ? 'g' + nextGuest++ : p.payerKey));
      draft.people.forEach((p, i) => {
        if (p.guest) state.guests.push({ id: ids[i], name: p.name, guestOf: p.payerKey });
        else state.chosen.push(p.payerKey);
      });
      state.receiver = draft.receiver;
      state.mode = draft.mode;
      if (draft.mode === 'even') state.total = String(draft.total / 100);
      if (draft.mode === 'manual')
        draft.amounts.forEach((n, i) => (state.amounts[ids[i]] = String(n / 100)));
      if (draft.mode === 'items')
        state.items = draft.items.map(item => ({
          name: item.name,
          price: String(item.price / 100),
          who: new Set(item.people.map(i => ids[i])),
        }));
    } else if (people.me) {
      state.chosen.push(people.me);
      state.receiver = people.me;
    }

    root.innerHTML = `
   <h1>${editing ? 'แก้ไขบิล' : 'สร้างบิลอื่นๆ'}</h1>
   <p class="muted">ใช้กับบิลที่ไม่เกี่ยวกับรอบตีแบด เช่น ค่าข้าวหลังตี</p>
   <form id="customBill" novalidate>
    <section>
     <h2>1. รายละเอียด</h2>
     <label>ชื่อบิล<input id="cbTitle" maxlength="40" placeholder="เช่น ข้าวหลังตี" value="${esc(state.title)}" required></label>
     <label>วันที่<input id="cbDate" type="date" value="${esc(state.date)}" ${editing ? 'readonly' : ''} required></label>
     <label>คนออกเงิน<select id="cbReceiver"></select></label>
     <label>เลขพร้อมเพย์ของคนออกเงิน<input id="cbTransfer" inputmode="numeric" maxlength="13" pattern="[0-9]{10}|[0-9]{13}" value="${esc(state.transfer)}" required></label>
    </section>
    <section>
     <h2>2. ใครร่วมจ่าย</h2>
     <input id="cbSearch" type="search" placeholder="ค้นหาชื่อสมาชิก" aria-label="ค้นหาชื่อสมาชิก" autocomplete="off">
     <div id="cbMembers"></div>
     <div class="cb-guest-add">
      <input id="cbGuestName" maxlength="40" placeholder="ชื่อ guest" aria-label="ชื่อ guest">
      <select id="cbGuestOf" aria-label="มากับ"></select>
      <button type="button" data-cb="add-guest">+ เพิ่ม guest</button>
     </div>
     <p class="muted">guest คือคนที่ไม่ได้ผูก LINE ต้องเลือกว่ามากับใคร ยอดของ guest จะรวมไปกับสมาชิกคนนั้น</p>
     <div id="cbGuests"></div>
    </section>
    <section>
     <h2>3. วิธีหาร</h2>
     <div class="cb-modes" role="group" aria-label="วิธีหาร">
      <button type="button" data-cb="mode" data-mode="even">หารเท่ากัน</button>
      <button type="button" data-cb="mode" data-mode="manual">ใส่ยอดเอง</button>
      <button type="button" data-cb="mode" data-mode="items">แยกรายการ</button>
     </div>
     <div id="cbMode"></div>
    </section>
    <section class="summary">
     <h2>4. ตรวจยอดก่อนเปิดบิล</h2>
     <div id="cbPreview" aria-live="polite"></div>
     <div class="actions"><button id="cbSubmit" class="primary" type="submit">${editing ? 'บันทึกการแก้ไข' : 'เปิดบิล'}</button><button type="button" data-cb="cancel">ยกเลิก</button></div>
    </section>
   </form>`;
    const $ = selector => root.querySelector(selector);

    // Everyone in the bill in a fixed order: members as ticked, then guests.
    const everyone = () => [
      ...state.chosen.map(key => ({ id: key, name: nameOf(key), payerKey: key, guest: false })),
      ...state.guests.map(g => ({ id: g.id, name: g.name, payerKey: g.guestOf, guest: true })),
    ];
    function draftFromState() {
      const list = everyone();
      const index = id => list.findIndex(p => p.id === id);
      const draft = {
        mode: state.mode,
        people: list.map(p => ({ name: p.name, payerKey: p.payerKey, guest: p.guest })),
        receiver: state.receiver,
      };
      if (state.mode === 'even') draft.total = toCents(state.total);
      if (state.mode === 'manual')
        draft.amounts = list.map(p => {
          const text = state.amounts[p.id];
          return text === undefined || String(text).trim() === '' ? 0 : toCents(text);
        });
      if (state.mode === 'items')
        draft.items = state.items.map(item => ({
          name: item.name.trim(),
          price: toCents(item.price),
          people: [...item.who].map(index).filter(i => i >= 0),
        }));
      return draft;
    }
    function body(draft) {
      const out = {
        title: state.title.trim(),
        date: state.date,
        transfer: state.transfer.trim(),
        receiver: state.receiver,
        mode: draft.mode,
        people: state.chosen
          .map(key => ({ payerKey: key }))
          .concat(state.guests.map(g => ({ name: g.name, guestOf: g.guestOf }))),
      };
      if (draft.mode === 'even') out.total = draft.total;
      if (draft.mode === 'manual') out.amounts = draft.amounts;
      if (draft.mode === 'items') out.items = draft.items;
      return out;
    }

    function renderReceiver() {
      if (!state.chosen.includes(state.receiver)) state.receiver = state.chosen[0] || '';
      const options = state.chosen
        .map(
          key =>
            `<option value="${esc(key)}" ${key === state.receiver ? 'selected' : ''}>${esc(nameOf(key))}</option>`,
        )
        .join('');
      $('#cbReceiver').innerHTML = options || '<option value="">เลือกผู้ร่วมจ่ายก่อน</option>';
      const guestOf = $('#cbGuestOf');
      const keep = guestOf.value;
      guestOf.innerHTML =
        state.chosen
          .map(key => `<option value="${esc(key)}">มากับ ${esc(nameOf(key))}</option>`)
          .join('') || '<option value="">เลือกสมาชิกก่อน</option>';
      if (state.chosen.includes(keep)) guestOf.value = keep;
    }
    function renderMembers() {
      $('#cbMembers').innerHTML = `<div class="cb-members">${people.members
        .map(
          m =>
            `<label class="attendee" data-name="${esc(m.name.toLowerCase())}"><input type="checkbox" data-cb="member" value="${esc(m.payerKey)}" ${state.chosen.includes(m.payerKey) ? 'checked' : ''}> ${esc(m.name)}</label>`,
        )
        .join('')}</div>`;
      filterMembers();
    }
    function filterMembers() {
      const q = $('#cbSearch').value.trim().toLowerCase();
      for (const label of root.querySelectorAll('#cbMembers label'))
        label.hidden = Boolean(q) && !label.dataset.name.includes(q);
    }
    function renderGuests() {
      $('#cbGuests').innerHTML = state.guests
        .map(
          g =>
            `<span class="cb-chip">${esc(g.name)} (มากับ ${esc(nameOf(g.guestOf))}) <button type="button" data-cb="remove-guest" data-id="${esc(g.id)}" aria-label="ลบ ${esc(g.name)}">×</button></span>`,
        )
        .join('');
    }
    function renderMode() {
      for (const button of root.querySelectorAll('[data-cb=mode]'))
        button.setAttribute('aria-pressed', String(button.dataset.mode === state.mode));
      const list = everyone();
      if (state.mode === 'even')
        $('#cbMode').innerHTML =
          `<label>ยอดรวม (บาท)<input id="cbTotal" type="number" inputmode="decimal" min="0" step="0.01" value="${esc(state.total)}"></label><p class="muted">หารเท่ากันทุกคน (guest นับเป็นหนึ่งคน)</p>`;
      if (state.mode === 'manual')
        $('#cbMode').innerHTML =
          list
            .map(
              p =>
                `<label>${esc(p.name)}${p.guest ? ' (guest)' : ''} (บาท)<input type="number" inputmode="decimal" min="0" step="0.01" data-cb="amount" data-id="${esc(p.id)}" value="${esc(state.amounts[p.id] ?? '')}"></label>`,
            )
            .join('') + '<p id="cbManualSum" class="muted"></p>';
      if (state.mode === 'items')
        $('#cbMode').innerHTML =
          state.items
            .map(
              (item, i) => `<div class="cb-item" data-item="${i}">
        <div class="grid"><label>รายการ<input data-cb="item-name" data-item="${i}" maxlength="40" placeholder="เช่น หมูกระทะ" value="${esc(item.name)}"></label>
        <label>ราคา (บาท)<input data-cb="item-price" data-item="${i}" type="number" inputmode="decimal" min="0" step="0.01" value="${esc(item.price)}"></label></div>
        <div class="cb-who">${list
          .map(
            p =>
              `<button type="button" class="cb-pick" data-cb="item-who" data-item="${i}" data-id="${esc(p.id)}" aria-pressed="${item.who.has(p.id)}">${esc(p.name)}</button>`,
          )
          .join(
            '',
          )}<button type="button" class="cb-pick" data-cb="item-all" data-item="${i}">ทุกคน</button><button type="button" data-cb="item-remove" data-item="${i}">ลบรายการ</button></div>
       </div>`,
            )
            .join('') + '<button type="button" data-cb="item-add">+ เพิ่มรายการ</button>';
      updateManualSum();
    }
    function updateManualSum() {
      const sum = $('#cbManualSum');
      if (!sum) return;
      const total = draftFromState().amounts?.reduce((n, v) => n + (Number.isFinite(v) ? v : 0), 0);
      sum.textContent = 'รวม ' + money(total || 0) + ' บาท';
    }
    // Returns the error text (or '') so the submit button can follow the preview.
    function preview() {
      const draft = draftFromState();
      const box = $('#cbPreview');
      let problem = '';
      if (!state.title.trim()) problem = 'กรุณาใส่ชื่อบิล';
      else if (!promptPayOk(state.transfer.trim()))
        problem =
          'กรุณาใส่พร้อมเพย์เท่านั้น: เบอร์โทร 10 หลัก (ขึ้นต้น 0) หรือเลขบัตรประชาชน 13 หลัก ไม่รับเลขบัญชีธนาคาร';
      if (!state.chosen.length) {
        box.innerHTML = '<p class="muted">เลือกผู้ร่วมจ่ายและใส่ยอดเพื่อดูยอดต่อคน</p>';
        $('#cbSubmit').disabled = true;
        return;
      }
      if (state.mode === 'manual' && draft.amounts.every(n => n === 0)) {
        box.innerHTML = '<p class="muted">ใส่ยอดของแต่ละคนด้านบน</p>';
        $('#cbSubmit').disabled = true;
        return;
      }
      const result = globalThis.SenaCustomSplit.split(draft);
      if (result.error) {
        box.innerHTML = `<p class="error">${esc(result.error)}</p>`;
        $('#cbSubmit').disabled = true;
        return;
      }
      const guests = new Set(state.guests.map(g => g.name));
      const rounded = result.payers.reduce((n, p) => n + p.amount, 0) - result.total;
      box.innerHTML = `${result.payers
        .map(
          p =>
            `<div class="row"><div><strong>${esc(p.name)}</strong>${p.owner ? ' <small>คนออกเงิน ✓</small>' : ''}${
              p.shares.length > 1
                ? `<small class="cb-sub">${p.shares.map(s => esc(s.name) + (guests.has(s.name) ? ' (guest)' : '') + ' ' + money(s.amount)).join(' + ')}</small>`
                : ''
            }</div><div class="due">${money(p.amount)} บาท</div></div>`,
        )
        .join(
          '',
        )}<p><strong>ยอดรวม ${money(result.total)} บาท</strong>${rounded ? ` · ปัดขึ้นรวม ${money(rounded)} บาท` : ''}</p>${problem ? `<p class="error">${esc(problem)}</p>` : ''}`;
      $('#cbSubmit').disabled = Boolean(problem);
    }
    const structure = () => {
      renderReceiver();
      renderGuests();
      renderMode();
      preview();
    };

    root.addEventListener('input', event => {
      const t = event.target,
        kind = t.dataset?.cb;
      if (t.id === 'cbTitle') state.title = t.value;
      else if (t.id === 'cbDate') state.date = t.value;
      else if (t.id === 'cbTransfer') state.transfer = t.value;
      else if (t.id === 'cbTotal') state.total = t.value;
      else if (t.id === 'cbSearch') return filterMembers();
      else if (kind === 'amount') {
        state.amounts[t.dataset.id] = t.value;
        updateManualSum();
      } else if (kind === 'item-name') state.items[Number(t.dataset.item)].name = t.value;
      else if (kind === 'item-price') state.items[Number(t.dataset.item)].price = t.value;
      else return;
      preview();
    });
    root.addEventListener('change', event => {
      const t = event.target;
      if (t.id === 'cbReceiver') {
        const prev = state.receiver;
        state.receiver = t.value;
        if (!editing && people.me) {
          if (state.receiver === people.me && prev !== people.me && !state.transfer.trim()) {
            state.transfer = people.myPromptpay || remembered();
            $('#cbTransfer').value = state.transfer;
          } else if (state.receiver !== people.me && prev === people.me) {
            state.transfer = '';
            $('#cbTransfer').value = '';
          }
        }
        preview();
      } else if (t.dataset?.cb === 'member') {
        if (t.checked) state.chosen.push(t.value);
        else {
          state.chosen = state.chosen.filter(key => key !== t.value);
          // A guest cannot stay once the member they came with is out of the bill.
          state.guests = state.guests.filter(g => g.guestOf !== t.value);
        }
        const keep = new Set(everyone().map(p => p.id));
        for (const item of state.items)
          for (const id of [...item.who]) if (!keep.has(id)) item.who.delete(id);
        structure();
      }
    });
    root.addEventListener('click', event => {
      const t = event.target.closest('[data-cb]');
      if (!t) return;
      const kind = t.dataset.cb;
      if (kind === 'cancel') return cancel();
      if (kind === 'mode') {
        state.mode = t.dataset.mode;
        if (state.mode === 'items' && !state.items.length)
          state.items.push({ name: '', price: '', who: new Set(everyone().map(p => p.id)) });
        renderMode();
        preview();
      } else if (kind === 'add-guest') {
        const name = $('#cbGuestName').value.trim().replace(/\s+/g, ' '),
          guestOf = $('#cbGuestOf').value;
        if (!name || !state.chosen.includes(guestOf)) {
          message('ใส่ชื่อ guest และเลือกสมาชิกที่มาด้วย', true);
          return;
        }
        if (everyone().some(p => p.name.toLowerCase() === name.toLowerCase())) {
          message('ชื่อนี้อยู่ในบิลแล้ว กรุณาใช้ชื่ออื่น', true);
          return;
        }
        message('');
        state.guests.push({ id: 'g' + nextGuest++, name, guestOf });
        $('#cbGuestName').value = '';
        structure();
      } else if (kind === 'remove-guest') {
        state.guests = state.guests.filter(g => g.id !== t.dataset.id);
        for (const item of state.items) item.who.delete(t.dataset.id);
        structure();
      } else if (kind === 'item-add') {
        state.items.push({ name: '', price: '', who: new Set(everyone().map(p => p.id)) });
        renderMode();
        preview();
      } else if (kind === 'item-remove') {
        state.items.splice(Number(t.dataset.item), 1);
        renderMode();
        preview();
      } else if (kind === 'item-who') {
        const who = state.items[Number(t.dataset.item)].who;
        who.has(t.dataset.id) ? who.delete(t.dataset.id) : who.add(t.dataset.id);
        renderMode();
        preview();
      } else if (kind === 'item-all') {
        state.items[Number(t.dataset.item)].who = new Set(everyone().map(p => p.id));
        renderMode();
        preview();
      }
    });
    root.addEventListener('submit', event => {
      event.preventDefault();
      preview();
      if ($('#cbSubmit').disabled) return message('ตรวจรายละเอียดและยอดก่อนเปิดบิล', true);
      const draft = draftFromState();
      run(async () => {
        if (!editing && (!people.me || state.receiver === people.me))
          remember(state.transfer.trim());
        await submit(body(draft));
      });
    });

    renderMembers();
    structure();
  }
  window.SenaCustomBill = { mount };
})();
