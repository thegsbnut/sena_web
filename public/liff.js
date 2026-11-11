(async () => {
  let club = 'sena',
    pay = false,
    bill = null;
  function readTarget() {
    let params = new URLSearchParams(location.search);
    const state = params.get('liff.state');
    if (state) {
      const target = new URL(state, location.origin);
      if (target.origin === location.origin) params = target.searchParams;
    }
    club = params.get('club') === '88' ? '88' : 'sena';
    pay = params.get('page') === 'pay';
    bill = params.get('bill');
  }
  const q = id => document.getElementById(id),
    message = text => (q('message').textContent = text);
  const api = async (action = '', body, csrf) => {
    const response = await fetch(
      '/api/member' +
        action +
        '?club=' +
        club +
        (bill && action === '/bills' ? '&bill=' + encodeURIComponent(bill) : ''),
      {
        method: body ? 'POST' : 'GET',
        headers: {
          ...(body ? { 'Content-Type': 'application/json' } : {}),
          ...(csrf ? { 'X-Member-CSRF': csrf } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        cache: 'no-store',
      },
    );
    const data = await response.json();
    if (!response.ok) throw Error(data.error || 'ดำเนินการไม่สำเร็จ');
    return data;
  };
  const button = (text, onclick) => {
    const el = document.createElement('button');
    el.textContent = text;
    el.onclick = onclick;
    q('actions').append(el);
    return el;
  };
  // The LINE SDK is only needed to sign in. A visitor who already has a valid
  // session cookie (the common case) skips loading and initialising it.
  const sdkUrl = 'https://static.line-scdn.net/liff/edge/2/sdk.js';
  let liffReady = null;
  const ensureLiff = liffId =>
    (liffReady =
      liffReady ||
      (async () => {
        if (!window.liff)
          await new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = sdkUrl;
            script.onload = resolve;
            script.onerror = () => reject(Error('โหลด LINE ไม่สำเร็จ กรุณาลองใหม่'));
            document.head.append(script);
          });
        await liff.init({ liffId });
        readTarget();
      })());
  try {
    readTarget();
    let session = await api();
    if (!session.enabled || !session.configured) {
      message('ระบบ LINE Login ยังไม่ได้เปิดใช้งาน กรุณาติดต่อผู้จัด');
      return;
    }
    if (session.loggedIn && session.link?.status === 'approved' && !session.mappingError && !pay) {
      location.replace('/court' + (club === '88' ? '?club=88' : '') + '#booking');
      return;
    }
    if (!session.loggedIn) {
      message('กำลังเข้าสู่ระบบด้วย LINE…');
      await ensureLiff(session.liffId);
      if (liff.isLoggedIn()) {
        await api('/login', { idToken: liff.getIDToken() }, session.csrf);
        session = await api();
      }
    }
    if (!session.loggedIn) {
      message('เข้าสู่ระบบเพื่อจอง ถอน หรือชำระบิลของคุณ');
      button('เข้าสู่ระบบด้วย LINE', () => {
        const redirect = new URL('/liff.html', location.origin);
        redirect.searchParams.set('club', club);
        redirect.searchParams.set('page', pay ? 'pay' : 'book');
        if (bill) redirect.searchParams.set('bill', bill);
        liff.login({ redirectUri: redirect.href });
      });
      return;
    }
    button('ออกจากระบบ', async () => {
      try {
        await api('/logout', {});
        await ensureLiff(session.liffId);
        if (liff.isLoggedIn()) liff.logout();
        location.reload();
      } catch (e) {
        message(e.message);
      }
    });
    if (session.mappingError) {
      message(session.mappingError + ' · ให้ผู้จัดตรวจการแมพทั้งสองสนาม');
      return;
    }
    if (session.link?.status !== 'approved') {
      const data = await api('/choices');
      if (data.linked) {
        location.reload();
        return;
      }
      for (const player of data.players) {
        const option = document.createElement('option');
        option.value = JSON.stringify({ playerId: player.id, sourceClub: player.club });
        option.textContent = player.name;
        q('existing').append(option);
      }
      if (!data.players.length) {
        q('mapForm').hidden = true;
        q('newForm').hidden = false;
        q('mapStatus').textContent = 'ยังไม่มีชื่อว่างให้เลือก สมัครเป็นสมาชิกใหม่ได้เลย';
      }
      q('newMemberToggle').onclick = () => {
        q('newForm').hidden = !q('newForm').hidden;
        if (!q('newForm').hidden) q('newName').focus();
      };
      q('newForm').onsubmit = async event => {
        event.preventDefault();
        const submit = q('newForm').querySelector('button[type=submit]');
        submit.disabled = true;
        q('mapStatus').textContent = 'กำลังสมัคร…';
        try {
          await api('/link', {
            newMember: {
              name: q('newName').value,
              gender: q('newForm').querySelector('input[name=newGender]:checked')?.value,
            },
          });
          location.reload();
        } catch (e) {
          q('mapStatus').textContent = e.message;
          submit.disabled = false;
        }
      };
      q('mapForm').onsubmit = async event => {
        event.preventDefault();
        const submit = q('mapForm').querySelector('button');
        submit.disabled = true;
        try {
          await api('/link', JSON.parse(q('existing').value));
          location.reload();
        } catch (e) {
          q('mapStatus').textContent = e.message;
          submit.disabled = false;
        }
      };
      message('เลือกชื่อครั้งเดียว ใช้ได้ทั้ง Sena และ 88');
      q('mapping').showModal();
      return;
    }
    if (!pay) {
      location.replace('/court' + (club === '88' ? '?club=88' : '') + '#booking');
      return;
    }
    q('title').textContent = 'บิลของคุณ · ' + (club === '88' ? '88' : 'Sena');
    const { bills } = await api('/bills');
    if (bill && bills.length === 1) {
      location.replace(bills[0].url);
      return;
    }
    message(
      bills.length
        ? 'เลือกบิลที่ต้องการชำระ'
        : 'ไม่พบบิลของคุณในสนามนี้ หากเป็นบิลเก่าที่ไม่ผูกสมาชิกให้ติดต่อผู้จัด',
    );
    for (const item of bills) {
      const section = document.createElement('section'),
        link = document.createElement('a');
      link.className = 'button';
      link.href = item.url;
      link.textContent =
        item.date +
        ' · ' +
        item.name +
        ' · ' +
        (item.amount / 100).toLocaleString('th-TH') +
        ' บ. · ' +
        (item.status === 'paid' ? 'จ่ายแล้ว' : 'เปิดบิล');
      section.append(link);
      q('actions').append(section);
    }
  } catch (error) {
    message(error.message || 'เข้าสู่ระบบไม่สำเร็จ กรุณาลองใหม่');
  }
})();
