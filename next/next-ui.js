// Redesign layer: rearranges what the original scripts render, without changing behaviour.
// - booking: "next round" hero with seat bar + one-tap booking, compact date cards
// - leaderboard: podium for the top three
// - organizer tools (cloud sync, backups) live behind the ⚙ button
// Every action still goes through the original controls (checkbox, buttons) in booking.js etc.
(function () {
  'use strict';
  const $ = (s, root = document) => root.querySelector(s);
  const esc = s =>
    String(s).replace(
      /[&<>"']/g,
      c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
    );
  // Avoid reacting to our own DOM writes.
  let writing = false;
  const write = fn => {
    writing = true;
    try {
      fn();
    } finally {
      writing = false;
    }
  };

  // displayDate() in booking.js renders "เสาร์ 14 พ.ย. 2569".
  function splitDate(text) {
    const [weekday = '', day = '', month = ''] = String(text).trim().split(/\s+/);
    return { weekday, day, month };
  }
  function seatsOf(card) {
    const label = $('.booking-availability-label', card)?.textContent || '';
    const m = label.match(/(\d+)\s*\/\s*(\d+)\s*คน/);
    if (m) return { taken: +m[1], capacity: +m[2], label };
    return { taken: null, capacity: null, label };
  }

  function decorateCards() {
    document.querySelectorAll('#bookingDates .booking-date:not([data-nx])').forEach(card => {
      const strong = $('.booking-date-label strong', card);
      if (!strong) return;
      const d = splitDate(strong.textContent);
      const block = document.createElement('span');
      block.className = 'nx-date';
      block.setAttribute('aria-hidden', 'true');
      block.innerHTML = `<small>${esc(d.weekday)}</small><b>${esc(d.day)}</b><i>${esc(d.month)}</i>`;
      const label = $('.booking-date-label', card);
      label.insertBefore(block, label.querySelector('span'));
      const roster = $('.booking-roster-action', card);
      if (roster) roster.textContent = 'รายชื่อ ›';
      card.dataset.nx = '1';
    });
  }

  function nextCard() {
    const cards = [...document.querySelectorAll('#bookingDates .booking-date')];
    return cards.find(c => !c.classList.contains('is-closed')) || cards[0] || null;
  }

  function renderHero() {
    const copy = $('.rally-copy');
    if (!copy) return;
    let box = $('.nx-next', copy);
    const card = nextCard();
    if (!card) {
      if (box) box.remove();
      return;
    }
    if (!box) {
      box = document.createElement('div');
      box.className = 'nx-next';
      copy.append(box);
    }
    const date = $('.booking-date-label strong', card)?.textContent || '';
    const time = $('.booking-date-label > span:not(.nx-date) small', card)?.textContent || '';
    const { taken, capacity, label } = seatsOf(card);
    const personal = $('.booking-availability small', card)?.textContent || '';
    const box2 = $('input[data-book-date]', card);
    const canBook = box2 && !box2.disabled && !personal;
    const bar =
      capacity && capacity <= 30
        ? `<div class="nx-seats" aria-hidden="true">${Array.from(
            { length: capacity },
            (_, i) => `<i class="${i < taken ? '' : 'free'}"></i>`,
          ).join('')}</div>`
        : '';
    const html = `<span class="nx-eyebrow">รอบถัดไป</span><div class="nx-when">${esc(date)}</div><div class="nx-time">${esc(time)}</div>${bar}<div class="nx-note">${esc(personal || label)}</div><button type="button" class="nx-cta ${canBook ? 'go' : ''}">${canBook ? 'จองรอบนี้ →' : 'ดูรายชื่อ →'}</button>`;
    if (box.dataset.html !== html) {
      box.innerHTML = html;
      box.dataset.html = html;
    }
    $('.nx-cta', box).onclick = () => {
      const target = nextCard();
      if (!target) return;
      const input = $('input[data-book-date]', target);
      if (canBook && input && !input.disabled) {
        if (!input.checked) input.click();
        // booking.js shows the action bar once a date is selected; continue to its review dialog.
        setTimeout(() => $('#bookingContinue')?.click(), 0);
      } else {
        $('.booking-roster-action', target)?.click();
      }
    };
  }

  function renderPodium() {
    const rows = [...document.querySelectorAll('#leaderboardRows tr')].slice(0, 3);
    const host = $('#lbTotals');
    if (!host) return;
    let podium = $('#nxPodium');
    if (rows.length < 3) {
      if (podium) podium.remove();
      return;
    }
    const people = rows.map(tr => {
      const cells = tr.children;
      return {
        name: cells[1]?.textContent || '',
        w: cells[3]?.textContent,
        l: cells[4]?.textContent,
      };
    });
    const pod = (p, place, cls) =>
      `<div class="nx-pod ${cls}">${place === 1 ? '<span class="nx-crown">KING</span>' : ''}<span class="nx-ava">${esc(p.name.slice(0, 2))}</span><b>${esc(p.name)}</b><small>${esc(p.w)}–${esc(p.l)}</small><div class="nx-block">${place}</div></div>`;
    const html =
      pod(people[1], 2, 'second') + pod(people[0], 1, 'first') + pod(people[2], 3, 'third');
    if (!podium) {
      podium = document.createElement('section');
      podium.id = 'nxPodium';
      podium.className = 'nx-podium';
      podium.setAttribute('aria-label', 'สามอันดับแรก');
      host.before(podium);
    }
    if (podium.dataset.html !== html) {
      podium.innerHTML = html;
      podium.dataset.html = html;
    }
    podium.hidden = $('#lbTotals')?.hidden;
  }

  function tools() {
    const button = $('.next-tools');
    if (!button) return;
    const open = location.hash === '#club-tools';
    document.body.classList.toggle('nx-tools-open', open);
    button.setAttribute('aria-expanded', String(open));
    button.onclick = e => {
      e.preventDefault();
      const next = !document.body.classList.contains('nx-tools-open');
      document.body.classList.toggle('nx-tools-open', next);
      button.setAttribute('aria-expanded', String(next));
      if (next) setTimeout(() => $('#club-tools')?.scrollIntoView({ behavior: 'smooth' }), 0);
    };
  }

  function update() {
    if (writing) return;
    write(() => {
      decorateCards();
      renderHero();
      renderPodium();
    });
  }

  let queued = false;
  new MutationObserver(() => {
    if (writing || queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      update();
    });
  }).observe(document.body, { childList: true, subtree: true, characterData: true });
  document.addEventListener('click', e => {
    if (e.target.closest('[data-board-tab]')) setTimeout(update, 0);
  });
  document.addEventListener('change', e => {
    if (e.target.matches('input[data-book-date]')) update();
  });
  tools();
  update();
})();
