// Post a booking/withdrawal/payment notice into the LINE group the page was
// opened from, in the player's own name (liff.sendMessages: free, no OA quota).
// The LINE SDK is never loaded with the page: preload() starts fetching it when
// the player taps a button, and send() runs after the action already succeeded.
// Every failure is silent; the booking or payment is never affected.
(() => {
  if (window.SenaLineNotice) return;
  const inLine = /\bLine\//i.test(navigator.userAgent);
  const framed = window.parent !== window;
  const sdkUrl = 'https://static.line-scdn.net/liff/edge/2/sdk.js';
  let sdk = null,
    ready = null;
  function loadSdk() {
    sdk ||= window.liff
      ? Promise.resolve()
      : new Promise((resolve, reject) => {
          const script = document.createElement('script');
          script.src = sdkUrl;
          script.onload = resolve;
          script.onerror = () => {
            sdk = null;
            reject(Error('LINE SDK did not load'));
          };
          document.head.append(script);
        });
    return sdk;
  }
  function preload() {
    if (!inLine) return;
    if (framed) return window.parent.postMessage({ senaNoticePreload: true }, location.origin);
    loadSdk().catch(error => console.warn('line-notice', error));
  }
  const storage = () => {
    try {
      return window.sessionStorage;
    } catch {
      return null;
    }
  };
  // liff.init() without credentials sends the page to LINE Login with this URL as
  // the redirect, which LINE rejects (400) because /court is not the LIFF endpoint.
  // So init only with credentials: the SDK's own store, or the ones liff.js kept
  // from the LIFF launch (put back in the hash just for init). Otherwise skip.
  // Inside LINE the SDK keeps its token in sessionStorage under this exact key.
  const hasToken = liffId => Boolean(storage()?.getItem('LIFF_STORE:' + liffId + ':accessToken'));
  async function init(liffId) {
    if (hasToken(liffId)) return liff.init({ liffId });
    const launch = storage()?.getItem('sena-liff-launch');
    if (!launch) throw Error('No LIFF credentials on this page');
    const original = location.href;
    history.replaceState(history.state, '', location.pathname + location.search + launch);
    try {
      await liff.init({ liffId });
    } finally {
      history.replaceState(history.state, '', original);
    }
  }
  async function deliver(notice) {
    if (!hasToken(notice.liffId) && !storage()?.getItem('sena-liff-launch')) return;
    await loadSdk();
    ready ||= init(notice.liffId).catch(error => {
      ready = null;
      throw error;
    });
    await ready;
    if (!['group', 'room'].includes(liff.getContext()?.type)) return;
    const permission = await liff.permission.query('chat_message.write');
    if (permission.state !== 'granted') return;
    await liff.sendMessages([{ type: 'text', text: notice.text }]);
  }
  // Resolves when the message is sent or given up on; never rejects.
  async function send(notice) {
    if (!inLine || !notice?.text || !notice.liffId) return;
    // The bills tab is an iframe; LIFF only works in the top-level page.
    if (framed) return window.parent.postMessage({ senaNotice: notice }, location.origin);
    await deliver(notice).catch(error => console.warn('line-notice', error));
  }
  if (!framed)
    window.addEventListener('message', event => {
      if (event.origin !== location.origin) return;
      if (event.data?.senaNoticePreload) preload();
      if (event.data?.senaNotice) send(event.data.senaNotice);
    });
  window.SenaLineNotice = { preload, send };
})();
