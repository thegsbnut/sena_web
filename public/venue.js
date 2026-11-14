const activeClub = new URL(location.href).searchParams.get('club') === '88' ? '88' : 'sena';
const venueLabel = activeClub === '88' ? '88' : 'Sena';
const cupName = venueLabel + ' Cup';
const clubStorage = key => key + ':' + activeClub;
function venueUrl(path, club = activeClub) {
  const url = new URL(path, location.origin);
  if (club === '88') url.searchParams.set('club', '88');
  else url.searchParams.delete('club');
  return url.pathname + url.search + url.hash;
}
function venueFetch(path, options) {
  return fetch(venueUrl(path), options);
}
// /api/session is asked by several scripts on the same page (status bar, admin
// tools) and again on focus or tab clicks. Share one request and reuse its
// answer briefly; pass fresh=true when the role may just have changed.
let venueSessionCache = null;
function venueSession(fresh = false) {
  if (fresh || !venueSessionCache || Date.now() - venueSessionCache.at > 15000) {
    const entry = { at: Date.now() };
    entry.promise = venueFetch('/api/session', { cache: 'no-store' }).then(async r => {
      const d = await r.json();
      if (!r.ok || typeof d.canEdit !== 'boolean') throw Error(d.error || 'session');
      return d;
    });
    entry.promise.catch(() => {
      if (venueSessionCache === entry) venueSessionCache = null;
    });
    venueSessionCache = entry;
  }
  return venueSessionCache.promise;
}
function venueText(text) {
  return activeClub === '88'
    ? text
        .replaceAll('Sena Cup', '88 Cup')
        .replaceAll('SENA CUP', '88 CUP')
        .replaceAll('SENA COURT', '88 COURT')
        .replaceAll('SENA Court', '88 Court')
        .replaceAll('SENA BADMINTON CLUB', '88 BADMINTON CLUB')
    : text;
}
let leavingClub = false;
document.addEventListener('DOMContentLoaded', () => {
  const select = document.querySelector('#clubSelect');
  if (select) {
    select.value = activeClub;
    if (document.querySelector('#clubBrand'))
      document.querySelector('#clubBrand').textContent = venueLabel.toUpperCase();
    for (const id of ['baselineNote', 'aliasNote'])
      if (document.getElementById(id)) document.getElementById(id).hidden = activeClub === '88';
    select.onchange = () => {
      const next = select.value;
      if (next === activeClub) return;
      const historyDirty = document.querySelector('#historyEditor')?.dataset.dirty === '1';
      if (
        ((typeof cloudDirty !== 'undefined' && cloudDirty) || historyDirty) &&
        !confirm('มีข้อมูลที่ยังไม่บันทึก ต้องการออกจากก๊วนนี้เพื่อเปลี่ยนก๊วนหรือไม่?')
      ) {
        select.value = activeClub;
        return;
      }
      leavingClub = true;
      // Reload the document to discard in-flight responses belonging to the previous club.
      location.href = venueUrl('/court', next);
    };
  }
  function labels() {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const node of nodes) {
      if (node.parentElement?.closest('script,style,textarea')) continue;
      const value = venueText(node.nodeValue);
      if (value !== node.nodeValue) node.nodeValue = value;
    }
    for (const link of document.querySelectorAll('a[href]')) {
      const path = link.getAttribute('href');
      if (['/court', '/court.html', '/admin'].includes(path))
        link.setAttribute('href', venueUrl(path));
    }
    document.title = venueText(document.title);
  }
  labels();
  new MutationObserver(labels).observe(document.body, { childList: true, subtree: true });
});
