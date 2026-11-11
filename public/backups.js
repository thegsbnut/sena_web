(() => {
  const panel = document.createElement('details');
  panel.id = 'backups';
  panel.className = 'panel';
  panel.hidden = true;
  panel.innerHTML =
    '<summary>🛟 สำรองข้อมูล / กู้คืน</summary><p>เก็บ 30 จุดล่าสุดของก๊วนนี้ • สำรองรายชื่อ ตาราง และ Cup ก่อนทับข้อมูลออนไลน์ / ก่อนรีเซ็ต ส่วนประวัติสำรองแยกรายการก่อนแก้ไข</p><div class="actions"><button id="backupNow" class="primary">สำรองตอนนี้</button><button id="backupRefresh" class="secondary">ดูรายการล่าสุด</button></div><p id="backupStatus" role="status"></p><div id="backupList"></div>';
  document.querySelector('#club-tools').after(panel);
  const status = text => (document.querySelector('#backupStatus').textContent = text);
  let busy = false;
  const request = async (path, body) => {
    const res = await venueFetch(
      path,
      body
        ? {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          }
        : { cache: 'no-store' },
    );
    const data = await res.json();
    if (!res.ok) throw Error(data.error);
    return data;
  };
  function currentState() {
    const snapshot = structuredClone(state);
    // Preserve score input even when the organizer has not clicked Save scores yet.
    if (snapshot.cup)
      for (const input of document.querySelectorAll('#cupResults input[data-match]')) {
        if (
          input.value !== '' &&
          (!Number.isInteger(+input.value) || +input.value < 0 || +input.value > 999)
        )
          throw Error('แก้คะแนนให้เป็นจำนวนเต็ม 0–999 ก่อนสำรอง');
        snapshot.cup.matches[+input.dataset.match][input.dataset.side] =
          input.value === '' ? '' : +input.value;
      }
    return snapshot;
  }
  async function checkpoint(reason) {
    return request('/api/backups', {
      action: 'create',
      state: currentState(),
      revision: cloudRevision,
      reason,
    });
  }
  async function list() {
    const data = await request('/api/backups');
    document.querySelector('#backupList').innerHTML = data.backups.length
      ? data.backups
          .map(
            b =>
              `<article class="panel"><b>${esc(b.reason)}</b><p>${esc(new Date(b.created_at).toLocaleString('th-TH'))} · ${b.kind === 'state' ? 'รายชื่อ / ตาราง / Cup' : 'ประวัติการแข่งขัน 1 รายการ'} · รุ่น ${b.revision}</p><div class="actions"><button class="secondary" data-preview-backup="${b.seq}">ดูรายละเอียด</button><button class="secondary" data-restore-backup="${b.seq}">กู้คืนจุดนี้</button></div><div id="backupPreview${b.seq}"></div></article>`,
          )
          .join('')
      : '<p>ยังไม่มีจุดสำรอง เริ่มได้ด้วยปุ่ม “สำรองตอนนี้”</p>';
  }
  const originalLock = cloudLock;
  cloudLock = function () {
    originalLock();
    panel.hidden = !cloudEditable;
    if (!cloudEditable) {
      document.querySelector('#backupList').replaceChildren();
      status('');
    }
  };
  async function guarded(action) {
    if (busy || cloudBusy) return;
    busy = true;
    cloudBusy = true;
    document.querySelector('main').inert = true;
    try {
      await action();
    } catch (error) {
      status(error.message);
      alert('ดำเนินการไม่สำเร็จ: ' + error.message);
    } finally {
      busy = false;
      cloudBusy = false;
      document.querySelector('main').inert = false;
      cloudLock();
    }
  }
  document.querySelector('#backupNow').onclick = () =>
    guarded(async () => {
      await checkpoint('สำรองด้วยมือ');
      await list();
      status('สำรองออนไลน์แล้ว ✓');
    });
  document.querySelector('#backupRefresh').onclick = () => guarded(() => list());
  panel.addEventListener('toggle', () => {
    if (panel.open && cloudEditable && !busy) guarded(() => list());
  });
  document.querySelector('#backupList').onclick = event => {
    const preview = event.target.dataset.previewBackup,
      restore = event.target.dataset.restoreBackup;
    if (!preview && !restore) return;
    guarded(async () => {
      const backup = await request('/api/backups?id=' + Number(preview || restore));
      if (preview) {
        const box = document.querySelector('#backupPreview' + preview);
        box.replaceChildren();
        const p = document.createElement('p');
        p.textContent =
          backup.kind === 'state'
            ? `${backup.payload.players.length} ผู้เล่น · ${backup.payload.result?.schedule?.length || 0} เกมจัดก๊วน · Cup ${backup.payload.cup?.matches?.length || 0} เกม`
            : `${backup.payload.title} · ${backup.payload.date} · ${backup.payload.matches.length} เกม`;
        box.append(p);
        return;
      }
      const label =
        backup.kind === 'state'
          ? 'รายชื่อ ตาราง และ Cup ปัจจุบัน'
          : 'ประวัติรายการนี้และคำนวณ Leaderboard ใหม่';
      if (
        !confirm(
          'กู้คืน ' +
            label +
            ' เป็นข้อมูล ณ ' +
            new Date(backup.created_at).toLocaleString('th-TH') +
            '?\nการแก้ไขในหน้าที่ค้างอยู่จะถูกยกเลิก ระบบจะสำรองข้อมูลปัจจุบันก่อนกู้คืน',
        )
      )
        return;
      let revision;
      if (backup.kind === 'state') {
        const latest = await request('/api/state');
        if (latest.revision !== cloudRevision)
          throw Error('ข้อมูลกลางเปลี่ยนจากอีกเครื่อง โหลดข้อมูลกลางใหม่ก่อนกู้คืน');
        revision = cloudRevision;
      } else {
        const latest = await request('/api/leaderboard'),
          record = latest.history.find(c => c.id === backup.target);
        if (!record) throw Error('ไม่พบประวัติรายการเดิม');
        revision = record.revision;
      }
      await request('/api/backups', {
        action: 'restore',
        id: backup.seq,
        revision,
        currentState: currentState(),
      });
      if (backup.kind === 'state') {
        // Apply the restored snapshot locally without waiting for a second network call.
        state = backup.payload;
        cloudRevision = revision + 1;
        cloudDirty = false;
        localSave();
        redrawCloud();
      }
      document.querySelector('#historyEditor').hidden = true;
      document.querySelector('#historyEditor').dataset.dirty = '0';
      document.querySelector('#leaderboardRefresh').click();
      await list();
      status('กู้คืนแล้ว ✓ ข้อมูลก่อนกู้คืนยังอยู่ในรายการสำรอง');
    });
  };
  // Keep guest games local. Organizer destructive actions stop if online backup fails.
  for (const [id, reason] of [
    ['resetCup', 'ก่อนรีเซ็ต Cup'],
    ['createCup', 'ก่อนสร้าง Cup ใหม่'],
  ]) {
    const button = document.getElementById(id),
      original = button.onclick;
    button.onclick = event => {
      if (!cloudEditable || !state.cup) return original.call(button, event);
      guarded(async () => {
        await checkpoint(reason);
        await original.call(button, event);
      });
    };
  }
  for (const input of [document.querySelector('#import'), backupFile]) {
    const original = input.onchange;
    input.onchange = event => {
      if (!input.files[0] || !cloudEditable) return original?.call(input, event);
      guarded(async () => {
        await checkpoint('ก่อนนำเข้าข้อมูล');
        await original?.call(input, event);
      });
    };
  }
  cloudLock();
})();
