// LINE profile pictures on top of the initials avatar.
// Performance: the picture is a small thumbnail ("/small") loaded straight from
// LINE's CDN, lazily (only when scrolled into view), with a fixed size so the
// page never shifts. The initials stay underneath: they show while loading and
// remain if there is no picture or it fails.
const avatarLoaded = new Set(),
  avatarFailed = new Set();
function avatarImg(url) {
  if (typeof url !== 'string' || !url.startsWith('https://profile.line-scdn.net/')) return '';
  const src = url + '/small';
  if (avatarFailed.has(src)) return '';
  const safe = src.replace(
    /[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
  // Already loaded once: show at once on re-render, without the fade.
  const loaded = avatarLoaded.has(src) ? ' loaded' : '';
  return `<img class="avatar-pic${loaded}" src="${safe}" alt="" width="36" height="36" loading="lazy" decoding="async" fetchpriority="low" referrerpolicy="no-referrer">`;
}
// One listener for every picture on the page (load/error do not bubble: capture).
document.addEventListener(
  'load',
  e => {
    if (e.target.classList?.contains('avatar-pic')) {
      avatarLoaded.add(e.target.getAttribute('src'));
      e.target.classList.add('loaded');
    }
  },
  true,
);
document.addEventListener(
  'error',
  e => {
    if (e.target.classList?.contains('avatar-pic')) {
      avatarFailed.add(e.target.getAttribute('src'));
      e.target.remove();
    }
  },
  true,
);
