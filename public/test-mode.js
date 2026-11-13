// TEMPORARY: "TEST MODE" banner for dev-login test users (see DEV-LOGIN.md).
// Reads only the non-HttpOnly marker cookie set by /dev-login; it grants nothing.
// Real members never have the cookie, so for them this script does nothing.
(function () {
  'use strict';
  const raw = document.cookie
    .split('; ')
    .find(c => c.startsWith('__Host-sena-test='))
    ?.slice('__Host-sena-test='.length);
  if (!raw) return;
  let value = '';
  try {
    value = decodeURIComponent(raw);
  } catch {
    value = '';
  }
  const split = value.indexOf(':');
  const role = split > 0 ? value.slice(0, split) : '';
  const name = split > 0 ? value.slice(split + 1) : '';
  const club = new URLSearchParams(location.search).get('club');
  function show() {
    if (document.querySelector('#testModeBanner')) return;
    const bar = document.createElement('div');
    bar.id = 'testModeBanner';
    bar.setAttribute('role', 'status');
    bar.style.cssText =
      'position:sticky;top:0;z-index:9999;display:flex;flex-wrap:wrap;gap:6px 12px;align-items:center;justify-content:center;padding:8px 16px;background:#b91c1c;color:#fff;font:600 14px/1.4 system-ui,sans-serif;text-align:center';
    const label = document.createElement('strong');
    label.textContent = 'TEST MODE';
    const who = document.createElement('span');
    who.textContent =
      (name ? name + ' · ' : '') +
      (role === 'admin' ? 'ผู้จัด (ทดสอบ)' : 'ผู้เล่น (ทดสอบ)') +
      ' · ก๊วนทดสอบ ไม่ปนกับข้อมูลจริง';
    bar.append(label, who);
    if (club !== 'test') {
      const go = document.createElement('a');
      go.href = '/court?club=test#booking';
      go.textContent = 'ไปก๊วนทดสอบ';
      go.style.color = '#fff';
      bar.append(go);
    }
    const out = document.createElement('a');
    out.href = '/dev-logout';
    out.textContent = 'ออกจากโหมดทดสอบ';
    out.style.color = '#fff';
    // Inside the bills iframe the parent page already shows the banner.
    let embedded = false;
    try {
      embedded = window.self !== window.top;
    } catch {
      embedded = true;
    }
    if (embedded) return;
    bar.append(out);
    document.body.prepend(bar);
    // Let the club picker show the sandbox club instead of falling back to Sena.
    const select = document.querySelector('#clubSelect');
    if (select && !select.querySelector('option[value="test"]')) {
      const option = document.createElement('option');
      option.value = 'test';
      option.textContent = 'TEST (ทดสอบ)';
      select.append(option);
      if (club === 'test') select.value = 'test';
    }
  }
  if (document.body) show();
  else document.addEventListener('DOMContentLoaded', show);
})();
