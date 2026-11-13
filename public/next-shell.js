// Bottom tab bar: only adds presentation (tab icons, active-tab marker).
// All behaviour still comes from the original scripts (venue.js, navigation.js, booking.js …).
(function () {
  'use strict';
  const icons = {
    booking:
      '<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
    session: '<path d="M4 6h16M4 12h16M4 18h10"/><circle cx="19" cy="18" r="1.5"/>',
    roster:
      '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c1-3.5 3.5-5.5 6.5-5.5s5.5 2 6.5 5.5"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14.8c1.8.8 3 2.6 3.5 5.2"/>',
    cup: '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4"/>',
    leaderboard: '<path d="M4 20V11M10 20V5M16 20v-7M22 20H2"/>',
  };
  const svg = d => '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' + d + '</svg>';

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
        document.body.dataset.tab = id;
        window.scrollTo({ top: 0 });
      });
    });
    const active = document.querySelector('.next-tabbar .tab.active');
    document.body.dataset.tab = active ? active.dataset.tab : 'booking';
  }

  tabs();
})();
