const statusEl = document.querySelector('#status');
document.querySelector('#login').onsubmit = async e => {
  e.preventDefault();
  const btn = e.target.querySelector('button');
  btn.disabled = true;
  try {
    const res = await venueFetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: document.querySelector('#key').value }),
    });
    const data = await res.json();
    document.querySelector('#key').value = '';
    if (!res.ok) throw Error(data.error);
    try {
      localStorage.setItem('sena-auth-changed', String(Date.now()));
    } catch {}
    location.href = venueUrl('/court.html');
  } catch (e) {
    statusEl.textContent = e.message;
  } finally {
    btn.disabled = false;
  }
};
window.addEventListener('sena-auth-change', event => {
  const admin = event.detail.canEdit;
  document.querySelector('#login').hidden = admin;
  document.querySelector('#adminIntro').hidden = admin;
  document.querySelector('#adminTitle').textContent = admin
    ? 'คุณอยู่ในสถานะผู้ดูแลระบบ'
    : 'เข้าสู่ระบบผู้จัด';
  if (admin) statusEl.textContent = 'จัดการก๊วนได้ทุกส่วน หรือออกจากระบบได้จากแถบด้านบน';
});
