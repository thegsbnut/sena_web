(function () {
  'use strict';
  const bar = document.createElement('aside');
  bar.id = 'senaAuthBar';
  bar.className = 'sena-authbar';
  bar.dataset.role = 'pending';
  bar.setAttribute('aria-label', 'สถานะการเข้าสู่ระบบ');
  bar.innerHTML =
    '<div class="sena-auth-inner"><span class="sena-auth-state" role="status" aria-live="polite"><i aria-hidden="true"></i><b id="senaAuthLabel">กำลังตรวจสอบสถานะ…</b></span><div class="sena-auth-actions"><a id="senaAuthLogin" href="' +
    venueUrl('/admin') +
    '" hidden>เข้าสู่ระบบผู้จัด</a><button id="senaAuthLogout" type="button" hidden>ออกจากระบบ</button><button id="senaAuthRetry" type="button" hidden>ตรวจสอบอีกครั้ง</button></div><p id="senaAuthError" role="alert" hidden></p></div>';
  document.body.prepend(bar);
  const label = bar.querySelector('#senaAuthLabel'),
    login = bar.querySelector('#senaAuthLogin'),
    logout = bar.querySelector('#senaAuthLogout'),
    retry = bar.querySelector('#senaAuthRetry'),
    error = bar.querySelector('#senaAuthError');
  let role = null,
    checking = false,
    loggingOut = false;
  function leavePage() {
    if (typeof leavingClub !== 'undefined') leavingClub = true;
    location.reload();
  }
  function announceChange() {
    try {
      localStorage.setItem('sena-auth-changed', String(Date.now()));
    } catch {}
  }
  async function check() {
    if (checking || loggingOut) return;
    checking = true;
    try {
      const r = await venueFetch('/api/session', { cache: 'no-store' }),
        d = await r.json();
      if (!r.ok || typeof d.canEdit !== 'boolean') throw Error();
      const changed = role !== null && role !== d.canEdit;
      role = d.canEdit;
      bar.dataset.role = role ? 'admin' : 'guest';
      label.textContent = role ? 'ผู้ดูแลระบบ' : 'ผู้ใช้งานทั่วไป';
      logout.hidden = !role;
      login.hidden = role;
      retry.hidden = true;
      error.hidden = true;
      document
        .querySelectorAll('#club-tools a[href*="/admin"]')
        .forEach(link => (link.hidden = role));
      window.dispatchEvent(new CustomEvent('sena-auth-change', { detail: { canEdit: role } }));
      // Refresh all protected views when a session expires or changes in another tab.
      if (changed) leavePage();
    } catch {
      bar.dataset.role = 'unknown';
      label.textContent = 'ตรวจสอบสถานะไม่ได้';
      retry.hidden = false;
      logout.hidden = role !== true;
      login.hidden = role !== false;
    } finally {
      checking = false;
    }
  }
  logout.onclick = async () => {
    if (loggingOut) return;
    const unsaved =
      (typeof cloudDirty !== 'undefined' && cloudDirty) ||
      document.querySelector('#historyEditor')?.dataset.dirty === '1';
    if (unsaved && !confirm('มีข้อมูลที่ยังไม่บันทึก ต้องการออกจากระบบหรือไม่?')) return;
    loggingOut = true;
    logout.disabled = true;
    label.textContent = 'กำลังออกจากระบบ…';
    error.hidden = true;
    try {
      const r = await venueFetch('/api/logout', { method: 'POST' });
      if (!r.ok) throw Error();
      announceChange();
      leavePage();
    } catch {
      label.textContent = role ? 'ผู้ดูแลระบบ' : 'ตรวจสอบสถานะไม่ได้';
      error.textContent = 'ออกจากระบบไม่สำเร็จ กรุณาลองอีกครั้ง';
      error.hidden = false;
      loggingOut = false;
      logout.disabled = false;
    }
  };
  retry.onclick = check;
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) check();
  });
  window.addEventListener('focus', check);
  window.addEventListener('storage', e => {
    if (e.key === 'sena-auth-changed') check();
  });
  document.querySelectorAll('nav .tab').forEach(tab => tab.addEventListener('click', check));
  check();
  setInterval(() => {
    if (!document.hidden) check();
  }, 60000);
})();
