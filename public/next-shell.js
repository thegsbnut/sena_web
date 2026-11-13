// Bottom tab bar: only adds presentation (tab icons, active-tab marker).
// All behaviour still comes from the original scripts (venue.js, navigation.js, booking.js …).
(function () {
  'use strict';
  const icons = {
    booking:
      '<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
    session: '<path d="M4 6h16M4 12h16M4 18h10"/><circle cx="19" cy="18" r="1.5"/>',
    bills: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>',
    roster:
      '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c1-3.5 3.5-5.5 6.5-5.5s5.5 2 6.5 5.5"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14.8c1.8.8 3 2.6 3.5 5.2"/>',
    cup: '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4"/>',
    leaderboard: '<path d="M4 20V11M10 20V5M16 20v-7M22 20H2"/>',
  };
  const svg = d => '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' + d + '</svg>';

  // Bills live in an iframe inside the page, so switching tabs never reloads the page.
  function billsFrame() {
    const frame = document.querySelector('#billsFrame');
    if (!frame) return;
    document.documentElement.style.setProperty(
      '--nav-h',
      document.querySelector('.next-tabbar').offsetHeight + 'px',
    );
    const club = typeof activeClub !== 'undefined' ? activeClub : '';
    if (!frame.getAttribute('src'))
      frame.src = '/billing.html' + (club === '88' || club === 'test' ? '?club=' + club : '');
    else frame.contentWindow?.postMessage('bills-refresh', location.origin);
  }

  // Red "!" on the bills tab while the player has an unpaid (or re-send) bill. Quiet on any error.
  function markDue(count) {
    const tab = document.querySelector('.next-tabbar .tab[data-tab="bills"]');
    if (!tab) return;
    if (count > 0) {
      tab.dataset.due = '1';
      tab.setAttribute('aria-label', 'บิล มีบิลค้างจ่าย');
    } else {
      delete tab.dataset.due;
      tab.removeAttribute('aria-label');
    }
  }
  async function checkDue() {
    try {
      const club = typeof activeClub !== 'undefined' ? activeClub : 'sena';
      const response = await fetch('/api/member/bills?club=' + club, { cache: 'no-store' });
      if (!response.ok) return markDue(0);
      const data = await response.json();
      if (!Array.isArray(data.bills)) return markDue(0);
      markDue(data.bills.filter(b => ['unpaid', 'rejected'].includes(b.status)).length);
    } catch {
      markDue(0);
    }
  }
  window.addEventListener('message', event => {
    if (event.origin === location.origin && event.data?.type === 'bills-due')
      markDue(Number(event.data.count) || 0);
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) checkDue();
  });

  function tabs() {
    document.querySelectorAll('.next-tabbar .tab').forEach(tab => {
      const id = tab.dataset.tab;
      if (icons[id] && !tab.querySelector('svg')) {
        const label = document.createElement('span');
        label.textContent = tab.textContent;
        tab.textContent = '';
        tab.insertAdjacentHTML('afterbegin', svg(icons[id]));
        tab.append(label);
      }
      tab.addEventListener('click', () => {
        if (id === 'bills') billsFrame();
        document.body.dataset.tab = id;
        window.scrollTo({ top: 0 });
      });
    });
    const active = document.querySelector('.next-tabbar .tab.active');
    document.body.dataset.tab = active ? active.dataset.tab : 'booking';
    if (active?.dataset.tab === 'bills') billsFrame();
  }

  tabs();
  checkDue();
})();
