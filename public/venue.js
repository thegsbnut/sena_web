// 'test' = hidden sandbox club for dev-login test users (only works while DEV_AUTH is on).
const activeClub = (club => (club === '88' || club === 'test' ? club : 'sena'))(
  new URL(location.href).searchParams.get('club'),
);
const venueLabel = activeClub === '88' ? '88' : activeClub === 'test' ? 'TEST' : 'Sena';
const cupName = venueLabel + ' Cup';
const clubStorage = key => key + ':' + activeClub;
function venueUrl(path, club = activeClub) {
  const url = new URL(path, location.origin);
  if (club === '88' || club === 'test') url.searchParams.set('club', club);
  else url.searchParams.delete('club');
  return url.pathname + url.search + url.hash;
}
function venueFetch(path, options) {
  return fetch(venueUrl(path), options);
}
function venueText(text) {
  const label = venueLabel.toUpperCase();
  return activeClub !== 'sena'
    ? text
        .replaceAll('Sena Cup', venueLabel + ' Cup')
        .replaceAll('SENA CUP', label + ' CUP')
        .replaceAll('SENA COURT', label + ' COURT')
        .replaceAll('SENA Court', label + ' Court')
        .replaceAll('SENA BADMINTON CLUB', label + ' BADMINTON CLUB')
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
      if (document.getElementById(id)) document.getElementById(id).hidden = activeClub !== 'sena';
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
