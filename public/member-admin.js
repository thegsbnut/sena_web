(async () => {
  const response = await venueFetch('/api/session'),
    session = await response.json();
  if (!session.canEdit) return;
  const container = document.getElementById('roster');
  if (!container) return;
  const panel = document.createElement('section');
  panel.className = 'panel';
  // Collapsed by default: the list is long and rarely needed. It loads on first open.
  panel.innerHTML =
    '<details class="member-collapse"><summary><h2>บัญชี LINE และการแมพผู้เล่น</h2></summary><p>ช่วงเก็บตก ผู้เล่นเลือกชื่อเดิมแล้วใช้งานได้ทันที ผู้จัดแก้ชื่อได้จากรายชื่อผู้เล่นด้านล่าง และแก้การแมพ LINE ได้ที่นี่ การแก้และลบการผูกมีผลทั้งสองสนาม หากชื่อเป้าหมายผูกกับบัญชีอื่น ให้ยกเลิกการผูกนั้นก่อนย้าย</p><button type="button" class="member-reload">โหลดการแมพล่าสุด</button><div class="member-requests"></div><p role="status"></p></details>';
  container.prepend(panel);
  const details = panel.querySelector('details'),
    rows = panel.querySelector('.member-requests'),
    status = panel.querySelector('[role=status]');
  const api = async (action, body) => {
    const r = await venueFetch('/api/member/' + action, {
      method: body ? 'POST' : 'GET',
      headers: body ? { 'Content-Type': 'application/json' } : {},
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const d = await r.json();
    if (!r.ok) throw Error(d.error);
    return d;
  };
  async function load() {
    try {
      rows.replaceChildren();
      const { requests, players } = await api('requests');
      for (const item of requests) {
        const row = document.createElement('div');
        row.className = 'panel';
        const label = document.createElement('p');
        label.textContent =
          (item.status === 'approved' ? item.name : 'ยังไม่ผูกสำเร็จ') +
          ' · LINE: ' +
          (item.line_name || 'ไม่ระบุ');
        row.append(label);
        const details = document.createElement('details'),
          summary = document.createElement('summary'),
          code = document.createElement('code');
        summary.textContent = 'ดู LINE userId';
        code.textContent = item.user_id;
        details.append(summary, code);
        row.append(details);
        const picker = document.createElement('select');
        picker.setAttribute(
          'aria-label',
          'แมพผู้เล่นสำหรับ ' + (item.line_name || item.user_id.slice(-6)),
        );
        picker.style.maxWidth = '100%';
        picker.add(new Option('เลือกชื่อผู้เล่น…', ''));
        for (const player of players) picker.add(new Option(player.name, player.id));
        picker.value = item.player_id || '';
        row.append(picker);
        const buttons = [];
        for (const [action, text] of [
          ['reassign', 'บันทึกการแมพ'],
          ['unlink', 'ลบการผูก LINE'],
        ]) {
          const button = document.createElement('button');
          button.type = 'button';
          button.textContent = text;
          buttons.push(button);
          row.append(button);
          button.onclick = async () => {
            if (action === 'reassign' && !picker.value) {
              status.textContent = 'เลือกชื่อผู้เล่นก่อน';
              return;
            }
            const target = players.find(p => p.id === picker.value)?.name || '';
            if (
              !confirm(
                action === 'reassign'
                  ? 'ย้ายบัญชี LINE นี้ไปเป็น ' +
                      target +
                      '? เปลี่ยนการผูกทั้งสองสนาม สิทธิ์จองและบิลจะอ้างถึงชื่อใหม่นี้'
                  : 'ลบการผูก LINE ของ ' +
                      item.name +
                      '? ลบการผูกทั้งสองสนาม เปิด LIFF อีกครั้งจะเลือกชื่อใหม่ได้ ข้อมูลผู้เล่น บิล และประวัติยังอยู่',
              )
            )
              return;
            for (const b of buttons) b.disabled = true;
            try {
              await api(action, {
                userId: item.user_id,
                playerId: picker.value,
                previousPlayerId: item.player_id,
                previousStatus: item.status,
              });
              status.textContent =
                action === 'unlink'
                  ? 'ลบการผูกแล้ว เปิดหรือรีเฟรช LIFF เพื่อเลือกชื่อใหม่ได้'
                  : 'บันทึกการแมพแล้ว';
              await load();
            } catch (e) {
              status.textContent = e.message;
              for (const b of buttons) b.disabled = false;
            }
          };
        }
        rows.append(row);
      }
      if (!requests.length) rows.textContent = 'ยังไม่มีการผูก LINE';
    } catch (e) {
      status.textContent = e.message;
    }
  }
  panel.querySelector('.member-reload').onclick = load;
  let loaded = false;
  details.addEventListener('toggle', () => {
    if (details.open && !loaded) {
      loaded = true;
      load();
    }
  });
})();
