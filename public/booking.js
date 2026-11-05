(function(){
 'use strict';
 const root=document.getElementById('booking');if(!root)return;
 const q=s=>root.querySelector(s);
 const html=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const days=['อาทิตย์','จันทร์','อังคาร','พุธ','พฤหัส','ศุกร์','เสาร์'];
 let data=null,busy=false,dirty=false,focusId='',selected=new Set(),playerId='',token=null;
 try{token=localStorage.getItem(clubStorage('booking-token'));if(!/^[a-f0-9]{64}$/.test(token||'')){token=Array.from(crypto.getRandomValues(new Uint8Array(32)),x=>x.toString(16).padStart(2,'0')).join('');localStorage.setItem(clubStorage('booking-token'),token);}playerId=localStorage.getItem(clubStorage('booking-player'))||'';}catch{token=null;}
 const displayDate=d=>new Date(d+'T12:00:00+07:00').toLocaleDateString('th-TH',{weekday:'short',day:'numeric',month:'short',year:'numeric',timeZone:'Asia/Bangkok'});
 const name=id=>data?.roster.find(p=>p.id===id)?.name||'ผู้เล่นที่นำออกจากก๊วน';
 function status(text,error=false){q('#bookingStatus').textContent=text;q('#bookingStatus').className='booking-status'+(error?' is-error':'');}
 async function request(body){
  const response=await venueFetch('/api/booking',{method:body?'POST':'GET',headers:{...(body?{'Content-Type':'application/json'}:{}),...(token?{'X-Booking-Token':token}:{})},...(body?{body:JSON.stringify(body)}:{})});
  const value=await response.json();if(!response.ok)throw Error(value.error||'เชื่อมต่อไม่ได้ กรุณาลองใหม่');return value;
 }
 async function load(silent=false){
  if(busy)return;busy=true;if(!silent)status('กำลังโหลดคิวจากออนไลน์…');
  try{data=await request();render();if(!silent)status('ข้อมูลล่าสุดจากออนไลน์ • เวลาไทย (UTC+7)');}
  catch(e){status(e.message,true);}finally{busy=false;}
 }
 async function mutate(body){
  if(busy)return;busy=true;root.classList.add('booking-busy');status('กำลังบันทึก…');
  try{data=await request(body);if(body.action==='settings')dirty=false;if(body.action==='book')selected.clear();render();status(data.result?.message||'บันทึกแล้ว');}
  catch(e){status(e.message,true);}finally{busy=false;root.classList.remove('booking-busy');}
 }
 root.innerHTML=`<div class="booking-toolbar"><span class="booking-club">${html(venueLabel)} COURT / จองคิว</span><button type="button" class="secondary" id="bookingRefresh">↻ อัปเดตคิว</button></div><p id="bookingStatus" class="booking-status" role="status" aria-live="polite"></p>
 <div class="booking-layout"><div><section class="panel booking-dates"><div class="sectionhead"><h2>01 <span>เลือกวันที่จะมา</span></h2><span class="booking-chip">เลือกได้หลายสัปดาห์</span></div><p class="hint" id="bookingPattern"></p><div id="bookingDates"></div></section>
 <section class="panel booking-submit"><h2>02 <span>ลงชื่อให้พร้อม</span></h2><label for="bookingPlayer">ชื่อผู้ลงตี</label><select id="bookingPlayer"><option value="">เลือกชื่อของคุณ…</option></select><p class="hint">ไม่มีชื่อในก๊วน? ให้ผู้จัดเพิ่มรายชื่อก่อน</p><div id="bookingHolidayConfirm" hidden><label class="booking-check"><input id="bookingAcceptHoliday" type="checkbox"> รับทราบว่าวันที่เลือกมีวันหยุด และยังต้องการจอง</label></div><div class="booking-selection" id="bookingSelection">ยังไม่ได้เลือกวัน</div><button type="button" class="primary booking-primary" id="bookingConfirm">ยืนยันจองคิว ↗</button><p class="hint">เต็มแล้วจะเข้าคิวสำรองตามลำดับ • ถอนชื่อได้จากเครื่องที่ใช้จอง หรือให้ผู้จัดช่วย</p></section>
 <details id="bookingAdmin" class="panel booking-admin" hidden><summary>⚙ ตั้งค่ารอบประจำ &amp; ขาประจำ <span>สำหรับผู้จัด</span></summary><form id="bookingSettings"></form></details></div>
 <div><section class="panel booking-detail"><div class="sectionhead"><h2>คิวลงคอร์ต</h2><span id="bookingDetailBadge" class="booking-chip"></span></div><div id="bookingDetail"></div></section><section class="panel booking-matches"><div class="sectionhead"><h2>⚡ ตารางพร้อมลุย</h2><span class="booking-chip">จัดคู่อัตโนมัติ</span></div><div id="bookingSchedule"></div></section></div></div>
 <p class="booking-footnote">วันหยุดอ้างอิงปฏิทินวันหยุดหลักปี 2569–2570 รวมวันหยุดราชการและธนาคารบางประเภท ผู้จัดเพิ่มวันหยุดพิเศษ / วันปิดสนามได้ • <a href="https://www.bot.or.th/th/financial-institutions-holiday.html" target="_blank" rel="noopener">อ้างอิง ธปท.</a> / <a href="https://www.sec.or.th/EN/Pages/News_Detail.aspx?SECID=13329" target="_blank" rel="noopener">ก.ล.ต.</a></p>`;
 function render(){
  const cfg=data.settings;
  q('#bookingPattern').textContent=cfg.enabled?`ทุกวัน${cfg.weekdays.map(d=>days[d]).join(' / ')} • ${cfg.start}–${cfg.end} น. • เปิดล่วงหน้า ${cfg.weeks} สัปดาห์`:'ผู้จัดยังไม่เปิดรับจอง • เข้าสู่ระบบผู้จัดเพื่อตั้งวัน เวลา และขาประจำ';
  const sessions=data.sessions;
  selected=new Set([...selected].filter(id=>sessions.some(s=>s.id===id&&!s.closed&&!s.skipped)&&cfg.enabled));
  if(!sessions.some(s=>s.id===focusId))focusId=sessions.find(s=>!s.skipped&&!s.closed)?.id||sessions[0]?.id||'';
  q('#bookingDates').innerHTML=sessions.length?sessions.map(s=>{
   const full=s.confirmedCount>=s.capacity,near=s.capacity-s.confirmedCount<=2,closed=s.closed||s.skipped||!cfg.enabled;
   const tag=closed?(s.skipped?'ข้ามวันหยุด':s.closed?'ปิดรอบนี้':'พักรับจอง'):full?'เต็ม • รับสำรอง':near?'ใกล้เต็มแล้ว':'เปิดรับจอง';
   const mine=s.registrations.find(r=>r.playerId===playerId);
   return `<article class="booking-date ${focusId===s.id?'is-focus':''} ${closed?'is-closed':''}"><div class="booking-date-top"><label class="booking-date-label"><input type="checkbox" data-book-date="${html(s.id)}" ${selected.has(s.id)?'checked':''} ${closed?'disabled':''} aria-label="เลือก ${displayDate(s.date)}"><strong>${displayDate(s.date)}</strong></label><span class="booking-tag ${full?'is-full':near?'is-near':''}">${tag}</span></div><div class="booking-date-info"><span>◷ ${html(s.start)}–${html(s.end)} น.</span><b>${s.confirmedCount}<small> / ${s.capacity} คน</small></b></div><div class="booking-meter"><i style="width:${Math.min(100,s.confirmedCount/s.capacity*100)}%"></i></div><div class="booking-date-bottom"><span>${mine?`✓ มีชื่อแล้ว (${mine.status==='confirmed'?'ตัวจริง':'สำรอง #'+mine.position})`:s.waitlistCount?`สำรอง ${s.waitlistCount} คน`:`ว่างอีก ${s.capacity-s.confirmedCount} ที่`}</span><button type="button" class="textbtn" data-book-focus="${html(s.id)}">ดูรายชื่อ / ตาราง →</button></div>${s.holiday?`<p class="booking-holiday">☀ ${html(s.holiday)}${s.skipped?' • งดรับจอง':''}</p>`:''}${!data.holidayYears.includes(Number(s.date.slice(0,4)))?'<p class="booking-holiday">⚠ ปฏิทินปีนี้ยังไม่ครบ ให้ผู้จัดตรวจวันหยุดเพิ่มเติม</p>':''}</article>`;
  }).join(''):'<div class="booking-empty">ยังไม่มีรอบเปิดจอง<br><small>ผู้จัดตั้งวันและเวลาได้ในเมนูด้านล่าง</small></div>';
  q('#bookingPlayer').innerHTML='<option value="">เลือกชื่อของคุณ…</option>'+data.roster.map(p=>`<option value="${html(p.id)}">${html(p.name)}${p.thai?' · '+html(p.thai):''}</option>`).join('');q('#bookingPlayer').value=playerId;
  q('#bookingAdmin').hidden=!data.canEdit;
  if(data.canEdit&&!dirty)renderSettings();
  renderSelection();renderDetail();
 }
 function renderSelection(){
  if(!data)return;
  const chosen=data.sessions.filter(s=>selected.has(s.id)),duplicate=chosen.filter(s=>s.registrations.some(r=>r.playerId===playerId)).length;
  const ready=chosen.filter(s=>s.confirmedCount<s.capacity&&!s.registrations.some(r=>r.playerId===playerId)).length;
  const standby=chosen.length-ready-duplicate;
  q('#bookingSelection').textContent=chosen.length?`เลือก ${chosen.length} วัน • ตัวจริง ${ready} วัน • สำรอง ${standby} วัน${duplicate?` • มีชื่อแล้ว ${duplicate} วัน`:''}`:'ยังไม่ได้เลือกวัน';
  q('#bookingHolidayConfirm').hidden=!chosen.some(s=>s.holiday);
  q('#bookingConfirm').disabled=!chosen.length||!playerId||!token||!data.settings.enabled;
  if(!token)status('เบราว์เซอร์ไม่ให้เก็บรหัสจัดการการจอง กรุณาเปิดเว็บใน Safari / Chrome โดยตรง',true);
 }
 function renderDetail(){
  const s=data.sessions.find(s=>s.id===focusId);
  q('#bookingDetailBadge').textContent=s?`${s.confirmedCount} / ${s.capacity} คน`:'';
  if(!s){q('#bookingDetail').innerHTML='<div class="booking-empty">เลือกวัน แล้วพบก๊วนของคุณที่นี่ 🏸</div>';q('#bookingSchedule').innerHTML='<p class="hint">เมื่อคนครบ ระบบจะบันทึกตารางคู่ให้อัตโนมัติ</p>';return;}
  const row=r=>`<div class="booking-person"><span class="booking-avatar">${html(name(r.playerId).slice(0,2))}</span><div><strong>${html(name(r.playerId))}</strong><small>${r.source==='regular'?'↻ ขาประจำ':r.status==='waitlist'?'สำรอง #'+r.position:'ลงชื่อออนไลน์'}</small></div>${r.canCancel?`<button type="button" class="booking-cancel" data-book-cancel="${html(r.id)}" aria-label="ถอนชื่อ ${html(name(r.playerId))}">ถอนชื่อ</button>`:''}</div>`;
  q('#bookingDetail').innerHTML=`<h3>${displayDate(s.date)}</h3><p class="hint">${html(s.start)}–${html(s.end)} น.${s.skipped?' • งดรับจองวันหยุด':s.closed?' • ปิดรับจอง':''}</p><h4>ตัวจริง <span>${s.confirmedCount} คน</span></h4>${s.registrations.filter(r=>r.status==='confirmed').map(row).join('')||'<p class="hint">มาเปิดก๊วนเป็นคนแรกกัน!</p>'}<div class="booking-waitlist"><h4>คิวสำรอง <span>${s.waitlistCount} คน</span></h4>${s.registrations.filter(r=>r.status==='waitlist').map(row).join('')||'<p class="hint">ยังไม่มีคิวสำรอง</p>'}<p class="hint">เมื่อมีคนถอน ตัวสำรองอันดับแรกจะขึ้นแทนทันที</p></div>${data.canEdit?`<button type="button" class="secondary" id="bookingClose">${s.closed?'เปิดรับจองรอบนี้':'ปิดรับจองรอบนี้'}</button>`:''}`;
  const messages={waiting:`รออีก ${Math.max(0,s.capacity-s.confirmedCount)} คนให้ครบก๊วน แล้วจัดคู่ทันที`,insufficient:'เหลือน้อยกว่า 8 คน จึงพักตารางไว้ก่อน เพื่อให้ทุกคนได้พักอย่างน้อย 1 เกม',closed:'รอบนี้ปิดรับจอง / ข้ามวันหยุด จึงพักตารางไว้ก่อน',failed:'เงื่อนไขผู้เล่นยังจัดคู่ไม่ได้ ให้ผู้จัดตรวจรายชื่อและตั้งค่าอีกครั้ง'};
  q('#bookingSchedule').innerHTML=s.schedule&&data.settings.enabled&&!s.closed&&!s.skipped?`<div class="booking-ready">✓ บันทึกตารางแล้ว <small>เวอร์ชัน ${s.scheduleVersion} • ${s.rounds} เกม</small></div><p class="hint">ปรับคู่และบันทึกใหม่เมื่อรายชื่อตัวจริงเปลี่ยน • พักอย่างน้อย 1 เกม</p><button type="button" class="primary booking-primary" id="bookingCopy">📋 Copy ตารางลง LINE</button><p id="bookingCopyStatus" role="status"></p><details class="booking-draw"><summary>ดูตารางทั้งหมด ${s.rounds} เกม</summary>${s.schedule.schedule.map(m=>`<div class="booking-match"><b>GAME ${String(m.round).padStart(2,'0')}</b><div><span>${html(m.ids.slice(0,2).map(name).join(' / '))}</span><em>VS</em><span>${html(m.ids.slice(2).map(name).join(' / '))}</span></div></div>`).join('')}<div class="booking-counts">${Object.entries(s.schedule.counts).map(([id,n])=>`<span>${html(name(id))} <b>${n} เกม</b></span>`).join('')}</div></details>`:`<div class="booking-empty">🏸<p>${messages[s.scheduleStatus]||'เมื่อคนครบ ระบบจะจัดคู่และบันทึกตารางให้ทันที'}</p></div>`;
 }
 function renderSettings(){
  const cfg=data.settings;
  q('#bookingSettings').innerHTML=`<p class="hint">บันทึกแล้วมีผลกับรอบอนาคต รวมเวลา จำนวนคน และตารางคู่ • รอบเดิมที่มีคนจองจะยังเก็บไว้ แม้เปลี่ยนวันประจำ</p><label class="booking-check"><input name="enabled" type="checkbox" ${cfg.enabled?'checked':''}> เปิดรับจองออนไลน์</label><fieldset><legend>วันตีประจำ</legend><div class="booking-weekdays">${days.map((d,i)=>`<label><input type="checkbox" name="weekday" value="${i}" ${cfg.weekdays.includes(i)?'checked':''}><span>${d}</span></label>`).join('')}</div></fieldset><div class="booking-fields"><label>เริ่ม<input name="start" type="time" value="${cfg.start}" required></label><label>สิ้นสุด<input name="end" type="time" value="${cfg.end}" required></label><label>ตัวจริง (8–24 คน)<input name="capacity" type="number" min="8" max="24" value="${cfg.capacity}" required></label><label>จำนวนเกม (1–30)<input name="rounds" type="number" min="1" max="30" value="${cfg.rounds}" required></label><label>เปิดล่วงหน้า (สัปดาห์)<input name="weeks" type="number" min="1" max="8" value="${cfg.weeks}" required></label><label>ถ้าตรงวันหยุด<select name="holidayPolicy"><option value="warn" ${cfg.holidayPolicy==='warn'?'selected':''}>แจ้งเตือน แต่จองได้</option><option value="skip" ${cfg.holidayPolicy==='skip'?'selected':''}>ข้าม / งดรับจอง</option></select></label></div><fieldset><legend>↻ ขาประจำ ลงชื่อให้อัตโนมัติทุกสัปดาห์</legend><p class="hint">ถ้าเกินจำนวน ตัวสำรองเรียงตามลำดับที่เพิ่มขาประจำ • ถอนแล้วจะไม่เพิ่มกลับในวันเดิม</p><div class="booking-regulars">${data.roster.map(p=>`<label class="booking-check"><input type="checkbox" name="regular" value="${html(p.id)}" ${cfg.regularIds.includes(p.id)?'checked':''}>${html(p.name)}</label>`).join('')||'<p class="hint">เพิ่มรายชื่อในแท็บรายชื่อผู้เล่นก่อน</p>'}</div></fieldset><details><summary>เพิ่มวันหยุดพิเศษ / วันปิดสนาม</summary><label class="hint" for="bookingHolidays">หนึ่งวันต่อบรรทัด: YYYY-MM-DD ชื่อวันหยุด</label><textarea id="bookingHolidays" name="holidays" rows="4" placeholder="2026-12-24 สนามปิดซ่อม">${html(cfg.holidays.map(h=>h.date+' '+h.name).join('\n'))}</textarea></details><button type="submit" class="primary booking-primary">บันทึกวันประจำ &amp; ขาประจำ</button>`;
 }
 function lineText(){
  const s=data.sessions.find(s=>s.id===focusId);if(!s?.schedule)return '';
  return [`🏸 ${venueLabel} • ก๊วนพร้อมลุย!`,`${displayDate(s.date)} | ${s.start}–${s.end} น.`,`ตัวจริง ${s.confirmedCount}/${s.capacity} คน • ตาราง v${s.scheduleVersion}`,'',...s.schedule.schedule.map(m=>`เกม ${m.round} ⚡ ${m.ids.slice(0,2).map(name).join(' / ')} VS ${m.ids.slice(2).map(name).join(' / ')}`),'','จำนวนเกมแต่ละคน',...Object.entries(s.schedule.counts).map(([id,n])=>`${name(id)}: ${n} เกม`),...(s.waitlistCount?['','สำรอง: '+s.registrations.filter(r=>r.status==='waitlist').map(r=>`${r.position}. ${name(r.playerId)}`).join(', ')]:[]),'','พักอย่างน้อย 1 เกม • รายชื่อเปลี่ยน ระบบจัดคู่ใหม่','ตรวจตารางล่าสุด: '+location.origin+venueUrl('/court')+'#booking'].join('\n');
 }
 async function copy(){
  const text=lineText();if(!text)return;
  try{await navigator.clipboard.writeText(text);q('#bookingCopyStatus').textContent='คัดลอกแล้ว พร้อมวางใน LINE ✓';}
  catch{const box=document.createElement('textarea');box.value=text;box.setAttribute('aria-label','ตารางสำหรับคัดลอกลง LINE');q('#bookingSchedule').append(box);box.focus();box.select();let ok=false;try{ok=document.execCommand('copy');}catch{}q('#bookingCopyStatus').textContent=ok?'คัดลอกแล้ว พร้อมวางใน LINE ✓':'กดค้างในช่องข้อความ แล้วเลือกคัดลอก';if(ok)box.remove();}
 }
 root.addEventListener('change',e=>{
  if(e.target.matches('[data-book-date]')){e.target.checked?selected.add(e.target.dataset.bookDate):selected.delete(e.target.dataset.bookDate);focusId=e.target.dataset.bookDate;renderSelection();renderDetail();}
  if(e.target.id==='bookingPlayer'){playerId=e.target.value;try{localStorage.setItem(clubStorage('booking-player'),playerId);}catch{}render();}
  if(e.target.closest('#bookingSettings'))dirty=true;
 });
 root.addEventListener('input',e=>{if(e.target.closest('#bookingSettings'))dirty=true;});
 root.addEventListener('submit',e=>{
  if(e.target.id!=='bookingSettings')return;e.preventDefault();
  const form=new FormData(e.target),holidays=[];
  for(const line of String(form.get('holidays')||'').split('\n').map(s=>s.trim()).filter(Boolean)){
   const match=line.match(/^(\d{4}-\d{2}-\d{2})\s+(.+)$/);if(!match){status('วันหยุดต้องเป็น YYYY-MM-DD ตามด้วยชื่อวันหยุด',true);return;}holidays.push({date:match[1],name:match[2]});
  }
  const checked=Array.from(e.target.querySelectorAll('[name=regular]:checked'),el=>el.value);
  // Preserve the order in which existing regulars joined the list.
  const regularIds=[...data.settings.regularIds.filter(id=>checked.includes(id)),...checked.filter(id=>!data.settings.regularIds.includes(id))];
  mutate({action:'settings',settingsVersion:data.settingsVersion,settings:{enabled:form.has('enabled'),weekdays:form.getAll('weekday').map(Number),start:form.get('start'),end:form.get('end'),capacity:Number(form.get('capacity')),rounds:Number(form.get('rounds')),weeks:Number(form.get('weeks')),holidayPolicy:form.get('holidayPolicy'),regularIds,holidays}});
 });
 root.addEventListener('click',e=>{
  const button=e.target.closest('button');if(!button||busy)return;
  if(button.id==='bookingRefresh'){if(dirty){status('มีการตั้งค่าที่ยังไม่บันทึก กรุณาบันทึกก่อนอัปเดตคิว',true);return;}load();}
  if(button.dataset.bookFocus){focusId=button.dataset.bookFocus;render();q('.booking-detail').scrollIntoView({behavior:'smooth',block:'nearest'});}
  if(button.dataset.bookCancel){const s=data.sessions.find(s=>s.id===focusId),r=s?.registrations.find(r=>r.id===button.dataset.bookCancel);if(r&&confirm(`ถอนชื่อ ${name(r.playerId)} วันที่ ${displayDate(s.date)}?`))mutate({action:'cancel',sessionId:s.id,registrationId:r.id});}
  if(button.id==='bookingClose'){const s=data.sessions.find(s=>s.id===focusId);if(s&&confirm(`${s.closed?'เปิด':'ปิด'}รับจองรอบ ${displayDate(s.date)}? รายชื่อเดิมยังเก็บไว้`))mutate({action:'close',sessionId:s.id,closed:!s.closed});}
  if(button.id==='bookingConfirm'){if(!q('#bookingHolidayConfirm').hidden&&!q('#bookingAcceptHoliday').checked){status('กรุณารับทราบวันหยุดก่อนยืนยันจอง',true);return;}mutate({action:'book',playerId,sessionIds:[...selected],acceptHoliday:q('#bookingAcceptHoliday').checked});}
  if(button.id==='bookingCopy')copy();
 });
 document.querySelector('[data-tab="booking"]').addEventListener('click',()=>{if(!dirty)load();});
 // Poll only while this tab is visible; leave unfinished admin edits intact.
 setInterval(()=>{if(!root.hidden&&!document.hidden&&!dirty)load(true);},60000);
 if(location.hash==='#booking'){document.querySelector('[data-tab="booking"]').click();}
})();
