(function(){
 'use strict';
 const root=document.getElementById('booking');if(!root)return;
 const q=s=>root.querySelector(s);
 const html=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const days=['อาทิตย์','จันทร์','อังคาร','พุธ','พฤหัส','ศุกร์','เสาร์'];
 let showAllDates=false;
 let data=null,busy=false,dirty=false,focusId='',selected=new Set(),playerId='',token=null;
 try{token=localStorage.getItem(clubStorage('booking-token'));if(!/^[a-f0-9]{64}$/.test(token||'')){token=Array.from(crypto.getRandomValues(new Uint8Array(32)),x=>x.toString(16).padStart(2,'0')).join('');localStorage.setItem(clubStorage('booking-token'),token);}playerId=localStorage.getItem(clubStorage('booking-player'))||'';}catch{token=null;}
 const displayDate=d=>new Date(d+'T12:00:00+07:00').toLocaleDateString('th-TH',{weekday:'short',day:'numeric',month:'short',year:'numeric',timeZone:'Asia/Bangkok'});
 const name=id=>data?.roster.find(p=>p.id===id)?.name||'ผู้เล่นที่นำออกจากก๊วน';
 function status(text,error=false){q('#bookingStatus').textContent=text;q('#bookingStatus').className='booking-status'+(error?' is-error':'');}
 function feedback(title,message){
  const dialog=q('#bookingFeedback');q('#bookingFeedbackTitle').textContent=title;q('#bookingFeedbackMessage').textContent=message;
  if(typeof dialog.showModal==='function'){if(!dialog.open)dialog.showModal();}else alert(title+'\n'+message);
 }
 async function request(body){
  const response=await venueFetch('/api/booking',{method:body?'POST':'GET',headers:{...(body?{'Content-Type':'application/json'}:{}),...(token?{'X-Booking-Token':token}:{})},...(body?{body:JSON.stringify(body)}:{})});
  const value=await response.json();if(!response.ok)throw Object.assign(Error(value.error||'เชื่อมต่อไม่ได้ กรุณาลองใหม่'),{status:response.status});return value;
 }
 async function load(silent=false){
  if(busy)return;busy=true;if(!silent)status('กำลังโหลดคิวจากออนไลน์…');
  try{data=await request();render();if(!silent)status('ข้อมูลล่าสุดจากออนไลน์ • เวลาไทย (UTC+7)');}
  catch(e){status(e.message,true);}finally{busy=false;}
 }
 async function mutate(body){
  if(busy)return;busy=true;root.classList.add('booking-busy');
  const isMap=body.action==='venueMap',mapInput=q('#bookingMapUrl');
  const report=isMap?(message,error=false)=>{
   const output=q('#bookingMapStatus');output.textContent=message;output.classList.toggle('is-error',error);
  }:status;
  if(isMap)q('#bookingMapReload').hidden=true;
  report('กำลังบันทึก…');
  try{data=await request(body);if(body.action==='settings')dirty=false;if(isMap&&mapInput.value.trim()===body.url)mapInput.value=mapInput.defaultValue;if(body.action==='book'){selected.clear();q('#bookingReview').close();}render();report(data.result?.message||'บันทึกแล้ว');
   if(body.action==='book'){
    const result=data.result||{},title=result.added>0?(result.duplicate?'จองสำเร็จบางรายการ':'จองคิวสำเร็จ ✓'):'มีชื่ออยู่แล้ว';
    const details=data.sessions.filter(s=>body.sessionIds.includes(s.id)).map(s=>{const r=s.registrations.find(r=>r.playerId===body.playerId);const existing=result.duplicateIds?.includes(s.id)?' • มีชื่ออยู่ก่อนแล้ว':'';return displayDate(s.date)+' • '+s.start+'–'+s.end+' น. • '+(r?.status==='confirmed'?'ตัวจริง':r?'สำรอง #'+r.position:'กรุณาตรวจรายชื่ออีกครั้ง')+existing;});
    feedback(title,('ผู้ตี: '+name(body.playerId)+'\n'+(result.message||'ตรวจสอบรายชื่อในวันที่เลือกได้ด้านล่าง'))+'\n\n'+details.join('\n'));
   }}
  catch(e){const message=e instanceof TypeError?'เชื่อมต่อไม่ได้ กรุณาตรวจอินเทอร์เน็ตแล้วลองอีกครั้ง':e.message;report(message,true);if(isMap&&e.status===409)q('#bookingMapReload').hidden=false;if(body.action==='book')feedback('จองไม่สำเร็จ',message);}finally{busy=false;root.classList.remove('booking-busy');}
 }
 root.innerHTML=`<div class="booking-toolbar"><span class="booking-club">${html(venueLabel)} COURT / จองคิว</span><button type="button" class="secondary" id="bookingRefresh">↻ อัปเดตคิว</button></div><p id="bookingStatus" class="booking-status" role="status" aria-live="polite"></p>
 <div class="booking-layout"><div><section class="panel booking-dates"><div class="sectionhead"><h2>เลือกวันตีแบด</h2><a id="bookingVenueMap" class="booking-map-link" target="_blank" rel="noopener noreferrer" hidden>แผนที่สนาม ↗</a></div><p class="hint" id="bookingPattern"></p><div id="bookingDates"></div><button type="button" class="secondary booking-more" id="bookingMore" aria-controls="bookingDates" aria-expanded="false" hidden>ดูวันเพิ่มเติม</button></section>
 <dialog id="bookingReview" class="booking-feedback booking-submit" aria-labelledby="bookingReviewTitle"><h2 id="bookingReviewTitle">ยืนยันการจอง</h2><label for="bookingPlayer">ชื่อผู้ตี</label><select id="bookingPlayer"><option value="">เลือกชื่อของคุณ…</option></select><p class="hint">ไม่มีชื่อในก๊วน? ให้ผู้จัดเพิ่มรายชื่อก่อน</p><div id="bookingHolidayConfirm" hidden><label class="booking-check"><input id="bookingAcceptHoliday" type="checkbox"> รับทราบว่าวันที่เลือกมีวันหยุด และยังต้องการจอง</label></div><div class="booking-selection"><b>วันที่เลือก</b><ul id="bookingReviewDates"></ul></div><button type="button" class="primary booking-primary" id="bookingConfirm">ยืนยันจองคิว ↗</button><form method="dialog"><button class="secondary booking-back">กลับไปเลือกวัน</button></form></dialog>
 <details id="bookingAdmin" class="panel booking-admin" hidden><summary>⚙ ตั้งค่าการจองและสนาม <span>สำหรับผู้จัด</span></summary>
 <details class="booking-map-settings"><summary>แผนที่สนาม ${html(venueLabel)}</summary><form id="bookingMapSettings"><label for="bookingMapUrl">ลิงก์ Google Maps</label><input id="bookingMapUrl" name="mapUrl" type="url" inputmode="url" maxlength="2048" required placeholder="https://maps.app.goo.gl/…"><button class="secondary" type="submit">บันทึกแผนที่สนาม</button> <button class="textbtn" id="bookingMapReload" type="button" hidden>โหลดลิงก์ล่าสุด</button><p id="bookingMapStatus" role="status"></p></form></details>
 <form id="bookingSettings"></form></details></div>
 <div><section class="panel booking-detail"><div class="sectionhead"><h2>คิวลงคอร์ต</h2><span id="bookingDetailBadge" class="booking-chip"></span></div><div id="bookingDetail"></div></section><section class="panel booking-matches"><div class="sectionhead"><h2>⚡ ตารางพร้อมลุย</h2><span class="booking-chip">จัดคู่อัตโนมัติ</span></div><div id="bookingSchedule"></div></section></div></div>
 <div class="booking-action" id="bookingAction" hidden><b id="bookingSelection" aria-live="polite"></b><button type="button" class="primary" id="bookingContinue">ดำเนินการจอง</button></div><p class="booking-footnote">วันหยุดอ้างอิงปฏิทินวันหยุดหลักปี 2569–2570 รวมวันหยุดราชการและธนาคารบางประเภท ผู้จัดเพิ่มวันหยุดพิเศษ / วันปิดสนามได้ • <a href="https://www.bot.or.th/th/financial-institutions-holiday.html" target="_blank" rel="noopener">อ้างอิง ธปท.</a> / <a href="https://www.sec.or.th/EN/Pages/News_Detail.aspx?SECID=13329" target="_blank" rel="noopener">ก.ล.ต.</a></p><dialog id="bookingFeedback" class="booking-feedback" aria-labelledby="bookingFeedbackTitle"><h2 id="bookingFeedbackTitle"></h2><p id="bookingFeedbackMessage"></p><form method="dialog"><button class="primary booking-primary" autofocus>ตกลง</button></form></dialog>`;
 function render(){
  const cfg=data.settings,map=q('#bookingVenueMap'),mapInput=q('#bookingMapUrl');
  const mapUrl=data.venueMapUrl??'';
  map.hidden=!mapUrl;
  if(mapUrl)map.href=mapUrl;else map.removeAttribute('href');
  map.setAttribute('aria-label','เปิดแผนที่สนาม '+venueLabel+' ใน Google Maps (แท็บใหม่)');
  if(data.canEdit&&(mapInput.value===mapInput.defaultValue||mapInput.value.trim()===mapUrl)){mapInput.defaultValue=mapUrl;mapInput.value=mapUrl;}
  q('#bookingPattern').textContent=cfg.enabled?`ทุกวัน${cfg.weekdays.map(d=>days[d]).join(' / ')} • ${cfg.start}–${cfg.end} น. • เปิดล่วงหน้า ${cfg.weeks} สัปดาห์`:'ผู้จัดยังไม่เปิดรับจอง • เข้าสู่ระบบผู้จัดเพื่อตั้งวัน เวลา และขาประจำ';
  const sessions=data.sessions;
  selected=new Set([...selected].filter(id=>sessions.some(s=>s.id===id&&!s.closed&&!s.skipped)&&cfg.enabled));
  if(!sessions.some(s=>s.id===focusId))focusId=sessions.find(s=>!s.skipped&&!s.closed)?.id||sessions[0]?.id||'';
  const more=q('#bookingMore');
  more.hidden=sessions.length<=3;
  more.setAttribute('aria-expanded',String(showAllDates));
  more.textContent=showAllDates?'แสดงเฉพาะรอบถัดไป':'ดูวันเพิ่มเติม';
  const visibleSessions=showAllDates?sessions:sessions.slice(0,3);
  q('#bookingDates').innerHTML=sessions.length?visibleSessions.map(s=>{
   const available=Math.max(0,s.capacity-s.confirmedCount);
   const closed=s.closed||s.skipped||!cfg.enabled;
   const mine=s.registrations.find(r=>r.playerId===playerId);
   const tone=closed?'closed':available===0?'full':available<=2?'near':'open';
   const availability=closed
    ? (s.skipped?'งดจองวันหยุด':'ปิดรับจอง')
    : available ? `เหลือ ${available} ที่ · ${s.confirmedCount}/${s.capacity} คน` : 'ตัวจริงเต็ม';
   const waitlist=tone==='full'?(s.canJoinWaitlist===false?'คิวสำรองเต็ม':'ยังรับสำรอง'):'';
   const personal=mine ? (mine.status==='confirmed'?'คุณได้ตัวจริง':'คุณอยู่สำรอง #'+mine.position) : '';
   return `<article class="booking-date availability-${tone} ${focusId===s.id?'is-focus':''} ${closed?'is-closed':''}">
    <label class="booking-date-label">
     <input type="checkbox" data-book-date="${html(s.id)}" ${selected.has(s.id)?'checked':''} ${closed?'disabled':''} aria-label="เลือก ${displayDate(s.date)}">
     <span><strong>${displayDate(s.date)}</strong><small>${html(s.start)}–${html(s.end)} น.</small></span>
    </label>
    <div class="booking-date-bottom"><div class="booking-availability"><span class="booking-availability-label">${availability}</span>${waitlist?`<strong class="booking-waitlist-label">${waitlist}</strong>`: ''}${personal?`<small>${personal}</small>`: ''}</div><button type="button" class="textbtn" data-book-focus="${html(s.id)}">ดูรายชื่อ / ตาราง</button></div>
    ${s.holiday?`<p class="booking-holiday">☀ ${html(s.holiday)}</p>`:''}
    ${!data.holidayYears.includes(Number(s.date.slice(0,4)))?'<p class="booking-holiday">⚠ ปฏิทินปีนี้ยังไม่ครบ ให้ผู้จัดตรวจวันหยุดเพิ่มเติม</p>':''}
   </article>`;

  }).join(''):'<div class="booking-empty">ยังไม่มีรอบเปิดจอง<br><small>ผู้จัดตั้งวันและเวลาได้ในเมนูด้านล่าง</small></div>';
  q('#bookingPlayer').innerHTML='<option value="">เลือกชื่อของคุณ…</option>'+data.roster.map(p=>`<option value="${html(p.id)}">${html(p.name)}${p.thai?' · '+html(p.thai):''}</option>`).join('');q('#bookingPlayer').value=playerId;playerId=q('#bookingPlayer').value;
  q('#bookingAdmin').hidden=!data.canEdit;
  if(data.canEdit&&!dirty)renderSettings();
  renderSelection();renderDetail();
 }
 function renderSelection(){
  if(!data)return;
  const chosen=data.sessions.filter(s=>selected.has(s.id));
  q('#bookingAction').hidden=!chosen.length;
  q('#bookingSelection').textContent=`เลือก ${chosen.length} วัน`;
  q('#bookingReviewDates').innerHTML=chosen.map(s=>{
   const alreadyBooked=s.registrations.some(r=>r.playerId===playerId);
   const note=alreadyBooked?' · มีชื่อแล้ว':s.confirmedCount>=s.capacity?' · รับสำรอง':'';
   return `<li>${displayDate(s.date)} · ${html(s.start)}–${html(s.end)} น.${note}</li>`;
  }).join('');
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
  if(e.target.id==='bookingMapSettings'){
   e.preventDefault();
   const input=q('#bookingMapUrl');
   mutate({action:'venueMap',url:input.value.trim(),previousUrl:input.defaultValue});
   return;
  }
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
  if(button.id==='bookingMapReload'){
   q('#bookingMapUrl').value=q('#bookingMapUrl').defaultValue;
   q('#bookingMapStatus').textContent='';button.hidden=true;load(true);
  }
  if(button.id==='bookingMore'){
   showAllDates=!showAllDates;
   render();
   if(!showAllDates)q('#bookingDates').scrollIntoView({block:'nearest'});
  }
  if(button.id==='bookingContinue'&&selected.size){
   q('#bookingAcceptHoliday').checked=false;
   q('#bookingReview').showModal();
  }
  if(button.id==='bookingRefresh'){if(dirty){status('มีการตั้งค่าที่ยังไม่บันทึก กรุณาบันทึกก่อนอัปเดตคิว',true);return;}load();}
  if(button.dataset.bookFocus){focusId=button.dataset.bookFocus;render();q('.booking-detail').scrollIntoView({behavior:'smooth',block:'nearest'});}
  if(button.dataset.bookCancel){const s=data.sessions.find(s=>s.id===focusId),r=s?.registrations.find(r=>r.id===button.dataset.bookCancel);if(r&&confirm(`ถอนชื่อ ${name(r.playerId)} วันที่ ${displayDate(s.date)}?`))mutate({action:'cancel',sessionId:s.id,registrationId:r.id});}
  if(button.id==='bookingClose'){const s=data.sessions.find(s=>s.id===focusId);if(s&&confirm(`${s.closed?'เปิด':'ปิด'}รับจองรอบ ${displayDate(s.date)}? รายชื่อเดิมยังเก็บไว้`))mutate({action:'close',sessionId:s.id,closed:!s.closed});}
  if(button.id==='bookingConfirm'){if(!q('#bookingHolidayConfirm').hidden&&!q('#bookingAcceptHoliday').checked){status('กรุณารับทราบวันหยุดก่อนยืนยันจอง',true);feedback('ยังไม่ได้ยืนยันจอง','กรุณารับทราบวันหยุดก่อนยืนยันจอง');return;}mutate({action:'book',playerId,sessionIds:[...selected],acceptHoliday:q('#bookingAcceptHoliday').checked});}
  if(button.id==='bookingCopy')copy();
 });
 document.querySelector('[data-tab="booking"]').addEventListener('click',()=>{if(!dirty)load();});
 // Poll only while this tab is visible; leave unfinished admin edits intact.
 setInterval(()=>{if(!root.hidden&&!document.hidden&&!dirty&&!q('#bookingReview').open&&!q('#bookingFeedback').open)load(true);},60000);
 const initialTab=[...document.querySelectorAll('nav .tab')].find(t=>t.dataset.tab===location.hash.slice(1)&&!t.hidden)||document.querySelector('[data-tab="booking"]');initialTab.click();
})();
