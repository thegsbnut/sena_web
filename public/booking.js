(function(){
 'use strict';
 const root=document.getElementById('booking');if(!root)return;
 const q=s=>root.querySelector(s);
 const mobileDetails=matchMedia('(max-width: 760px)');
 const html=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const days=['อาทิตย์','จันทร์','อังคาร','พุธ','พฤหัส','ศุกร์','เสาร์'];
 let showAllDates=false,cupDirty=false;
 const cupBadge=`<strong class="booking-cup-badge">🏆 ${html(cupName)} <span>· วันแข่งขัน</span></strong>`;
 const defaultCupDate=(date,week)=>Math.ceil(Number(date.slice(8,10))/7)===week;
 let data=null,busy=false,dirty=false,focusId='',selected=new Set(),playerId='',token=null;
 try{token=localStorage.getItem(clubStorage('booking-token'));if(!/^[a-f0-9]{64}$/.test(token||'')){token=Array.from(crypto.getRandomValues(new Uint8Array(32)),x=>x.toString(16).padStart(2,'0')).join('');localStorage.setItem(clubStorage('booking-token'),token);}playerId=localStorage.getItem(clubStorage('booking-player'))||'';}catch{token=null;}
 const displayDate=d=>new Date(d+'T12:00:00+07:00').toLocaleDateString('th-TH',{weekday:'short',day:'numeric',month:'short',year:'numeric',timeZone:'Asia/Bangkok'});
 const player=id=>data?.roster.find(p=>p.id===id);
 const rawName=id=>player(id)?.name||'ผู้เล่นที่นำออกจากก๊วน';
 const name=id=>{const award=player(id)?.award;return award?award+' '+rawName(id):rawName(id);};
 const level=id=>player(id)?.lv;
 const formatLevel=new Intl.NumberFormat('th-TH',{maximumFractionDigits:2});
 function levelBadge(id){
  const lv=level(id);
  return data.canEdit&&Number.isFinite(lv)?`<span class="booking-lv">Lv ${formatLevel.format(lv)}</span>`:'';
 }
 function matchTeam(ids){
  if(!data.canEdit)return `<span>${html(ids.map(name).join(' / '))}</span>`;
  const levels=ids.map(level);
  const average=levels.every(Number.isFinite)?`<small>Lv เฉลี่ย ${formatLevel.format((levels[0]+levels[1])/2)}</small>`:'';
  return `<div class="booking-match-team">${ids.map(id=>`<span>${html(name(id))} ${levelBadge(id)}</span>`).join('')}${average}</div>`;
 }
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
  const isMap=body.action==='venueMap',isCup=body.action==='cupCalendar',mapInput=q('#bookingMapUrl');
  const detailDialog=q('#bookingDetailsDialog');
  const inDetails=detailDialog.open,isReroll=body.action==='reroll';
  const report=(message,error=false)=>{
   if(!isMap&&!isCup)status(message,error);
   const output=isMap?q('#bookingMapStatus'):isCup?q('#bookingCupStatus'):inDetails&&detailDialog.open?q('#bookingDetailsStatus'):isReroll?q('#bookingRerollStatus'):null;
   if(output){output.textContent=message;output.classList.toggle('is-error',error);}
  };
  if(isMap)q('#bookingMapReload').hidden=true;
  const cupInputs=isCup?[...q('#bookingCupSettings').querySelectorAll('select,input')]:[];
  for(const input of cupInputs)input.disabled=true;
  if(isCup)q('#bookingCupReload').hidden=true;
  report('กำลังบันทึก…');
  try{data=await request(body);if(body.action==='settings')dirty=false;if(isCup)cupDirty=false;if(isMap&&mapInput.value.trim()===body.url)mapInput.value=mapInput.defaultValue;if(body.action==='book'){selected.clear();q('#bookingReview').close();}render();report(data.result?.message||'บันทึกแล้ว');
   if(isReroll){const draw=q('.booking-draw');if(draw)draw.open=true;}
   if(detailDialog.open&&!detailDialog.contains(document.activeElement))q('#bookingDetailsClose').focus({preventScroll:true});
   if(body.action==='book'){
    const result=data.result||{},title=result.added>0?(result.duplicate?'จองสำเร็จบางรายการ':'จองคิวสำเร็จ ✓'):'มีชื่ออยู่แล้ว';
    const details=data.sessions.filter(s=>body.sessionIds.includes(s.id)).map(s=>{const r=s.registrations.find(r=>r.playerId===body.playerId);const existing=result.duplicateIds?.includes(s.id)?' • มีชื่ออยู่ก่อนแล้ว':'';return displayDate(s.date)+' • '+s.start+'–'+s.end+' น. • '+(r?.status==='confirmed'?'ตัวจริง':r?'สำรอง #'+r.position:'กรุณาตรวจรายชื่ออีกครั้ง')+existing;});
    feedback(title,('ผู้ตี: '+name(body.playerId)+'\n'+(result.message||'ตรวจสอบรายชื่อในวันที่เลือกได้ด้านล่าง'))+'\n\n'+details.join('\n'));
   }}
  catch(e){const message=e instanceof TypeError?'เชื่อมต่อไม่ได้ กรุณาตรวจอินเทอร์เน็ตแล้วลองอีกครั้ง':e.message;report(message,true);if(e.status===409){if(isMap)q('#bookingMapReload').hidden=false;if(isCup)q('#bookingCupReload').hidden=false;}if(body.action==='book')feedback('จองไม่สำเร็จ',message);}finally{for(const input of cupInputs)input.disabled=false;busy=false;root.classList.remove('booking-busy');}
 }
 root.innerHTML=`<div class="booking-toolbar"><span class="booking-club">${html(venueLabel)} COURT / จองคิว</span><button type="button" class="secondary" id="bookingRefresh">↻ อัปเดตคิว</button></div><p id="bookingStatus" class="booking-status" role="status" aria-live="polite"></p>
 <div class="booking-layout"><div><section class="panel booking-dates"><div class="sectionhead"><h2>เลือกวันตีแบด</h2><a id="bookingVenueMap" class="booking-map-link" target="_blank" rel="noopener noreferrer" hidden>แผนที่สนาม ↗</a></div><p class="hint" id="bookingPattern"></p><div id="bookingDates"></div><button type="button" class="secondary booking-more" id="bookingMore" aria-controls="bookingDates" aria-expanded="false" hidden>ดูวันเพิ่มเติม</button></section>
 <dialog id="bookingReview" class="booking-feedback booking-submit" aria-labelledby="bookingReviewTitle"><h2 id="bookingReviewTitle">ยืนยันการจอง</h2><label for="bookingPlayer">ชื่อผู้ตี</label><select id="bookingPlayer" aria-describedby="bookingPlayerHint"><option value="">เลือกชื่อของคุณ…</option></select><p class="hint" id="bookingPlayerHint" aria-live="polite"></p><div id="bookingHolidayConfirm" hidden><label class="booking-check"><input id="bookingAcceptHoliday" type="checkbox"> รับทราบว่าวันที่เลือกมีวันหยุด และยังต้องการจอง</label></div><div class="booking-selection"><b>วันที่เลือก</b><ul id="bookingReviewDates"></ul></div><button type="button" class="primary booking-primary" id="bookingConfirm">ยืนยันจองคิว ↗</button><form method="dialog"><button class="secondary booking-back">กลับไปเลือกวัน</button></form></dialog>
 <details id="bookingAdmin" class="panel booking-admin" hidden><summary>⚙ ตั้งค่าการจองและสนาม <span>สำหรับผู้จัด</span></summary>
 <details class="booking-cup-settings"><summary>🏆 วันแข่งขัน ${html(cupName)}</summary>
 <form id="bookingCupSettings"><label for="bookingCupWeek">สัปดาห์แข่งขันประจำเดือน</label>
 <select id="bookingCupWeek"><option value="0">กำหนดวันเอง</option>${['1–7','8–14','15–21','22–28','29–สิ้นเดือน'].map((range,i)=>`<option value="${i+1}">สัปดาห์ที่ ${i+1} · วันที่ ${range}</option>`).join('')}</select>
 <fieldset><legend>เลือกวันแข่งเป็นรายรอบ</legend><p class="hint">ติ๊กเพื่อกำหนดให้เป็นวันแข่ง หรือเอาติ๊กออกเพื่อให้เป็นรอบปกติ รอบที่ไม่ได้ปรับจะใช้สัปดาห์ประจำเดือน</p><div id="bookingCupDates"></div></fieldset>
 <button class="secondary" type="submit">บันทึกวันแข่งขัน</button> <button class="textbtn" id="bookingCupReload" type="button" hidden>โหลดค่าล่าสุด</button><p id="bookingCupStatus" role="status"></p></form></details>
 <details class="booking-map-settings"><summary>แผนที่สนาม ${html(venueLabel)}</summary><form id="bookingMapSettings"><label for="bookingMapUrl">ลิงก์ Google Maps</label><input id="bookingMapUrl" name="mapUrl" type="url" inputmode="url" maxlength="2048" required placeholder="https://maps.app.goo.gl/…"><button class="secondary" type="submit">บันทึกแผนที่สนาม</button> <button class="textbtn" id="bookingMapReload" type="button" hidden>โหลดลิงก์ล่าสุด</button><p id="bookingMapStatus" role="status"></p></form></details>
 <details class="booking-map-settings"><summary>🔔 เชื่อม Badbot กับกลุ่ม LINE</summary>
 <p class="hint">สร้างคำสั่งแล้วส่งในกลุ่ม LINE ที่ต้องการเปิดใช้ Badbot รหัสใช้ได้ครั้งเดียวใน 10 นาที</p>
 <button type="button" class="secondary" id="bookingLinePair">สร้างคำสั่งเชื่อมกลุ่ม</button>
 <button type="button" class="secondary" id="bookingLineCheck">ตรวจการเชื่อมต่อ</button>
 <textarea id="bookingLineCommand" aria-label="คำสั่งเชื่อม Badbot" rows="2" readonly hidden></textarea>
 <p id="bookingLineSetupStatus" role="status" class="hint"></p>
 </details>
 <form id="bookingSettings"></form></details></div>
 <div id="bookingInlineDetails"><div id="bookingDetailPanels"><section class="panel booking-detail"><div class="sectionhead"><h2>คิวลงคอร์ต</h2><span id="bookingDetailBadge" class="booking-chip"></span></div><div id="bookingDetail"></div></section><section class="panel booking-matches"><div class="sectionhead"><h2>⚡ ตารางพร้อมลุย</h2><span class="booking-chip">จัดคู่อัตโนมัติ</span></div><div id="bookingSchedule"></div></section></div></div></div>
 <dialog id="bookingDetailsDialog" class="booking-details-dialog" aria-labelledby="bookingDetailsTitle" aria-describedby="bookingDetailsMeta">
 <header class="booking-details-header">
 <div><h2 id="bookingDetailsTitle">ดูรายชื่อ / ถอนตัว</h2><p id="bookingDetailsMeta"></p></div>
 <form method="dialog"><button id="bookingDetailsClose" type="submit" aria-label="ปิด" autofocus><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button></form>
 </header>
 <p id="bookingDetailsStatus" role="status"></p><div id="bookingDetailsContent"></div></dialog>
 <div class="booking-action" id="bookingAction" hidden><b id="bookingSelection" aria-live="polite"></b><button type="button" class="primary" id="bookingContinue">ดำเนินการจอง</button></div><p class="booking-footnote">วันหยุดอ้างอิงปฏิทินวันหยุดหลักปี 2569–2570 รวมวันหยุดราชการและธนาคารบางประเภท ผู้จัดเพิ่มวันหยุดพิเศษ / วันปิดสนามได้ • <a href="https://www.bot.or.th/th/financial-institutions-holiday.html" target="_blank" rel="noopener">อ้างอิง ธปท.</a> / <a href="https://www.sec.or.th/EN/Pages/News_Detail.aspx?SECID=13329" target="_blank" rel="noopener">ก.ล.ต.</a></p><dialog id="bookingFeedback" class="booking-feedback" aria-labelledby="bookingFeedbackTitle"><h2 id="bookingFeedbackTitle"></h2><p id="bookingFeedbackMessage"></p><form method="dialog"><button class="primary booking-primary" autofocus>ตกลง</button></form></dialog>`;
 const detailsDialog=q('#bookingDetailsDialog');
 const supportsDetailsPopup=typeof detailsDialog.showModal==='function';
 root.classList.toggle('booking-details-popup',supportsDetailsPopup);
 let detailsTriggerId='';
 detailsDialog.addEventListener('close',()=>{
  q('#bookingInlineDetails').append(q('#bookingDetailPanels'));
  const trigger=[...root.querySelectorAll('[data-book-focus]')].find(button=>button.dataset.bookFocus===detailsTriggerId);
  if(mobileDetails.matches)trigger?.focus({preventScroll:true});
 });
 mobileDetails.addEventListener('change',()=>{if(!mobileDetails.matches&&detailsDialog.open)detailsDialog.close();});
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
  const hiddenCup=sessions.slice(3).some(s=>s.isCup&&!s.closed)&&!sessions.slice(0,3).some(s=>s.isCup&&!s.closed);
  more.textContent=showAllDates?'แสดงเฉพาะรอบถัดไป':hiddenCup?`ดูวันเพิ่มเติม · 🏆 ${cupName}`:'ดูวันเพิ่มเติม';
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
    ${s.isCup?cupBadge:''}
    <label class="booking-date-label">
     <input type="checkbox" data-book-date="${html(s.id)}" ${selected.has(s.id)?'checked':''} ${closed?'disabled':''} aria-label="เลือก ${displayDate(s.date)}${s.isCup?' · '+html(cupName):''}">
     <span><strong>${displayDate(s.date)}</strong><small>${html(s.start)}–${html(s.end)} น.</small></span>
    </label>
    <div class="booking-date-bottom"><div class="booking-availability"><span class="booking-availability-label">${availability}</span>${waitlist?`<strong class="booking-waitlist-label">${waitlist}</strong>`: ''}${personal?`<small>${personal}</small>`: ''}</div><button type="button" class="booking-roster-action" ${mobileDetails.matches&&supportsDetailsPopup?'aria-haspopup="dialog"':''} data-book-focus="${html(s.id)}">ดูรายชื่อ / ถอนตัว</button></div>
    ${s.holiday?`<p class="booking-holiday">☀ ${html(s.holiday)}</p>`:''}
    ${!data.holidayYears.includes(Number(s.date.slice(0,4)))?'<p class="booking-holiday">⚠ ปฏิทินปีนี้ยังไม่ครบ ให้ผู้จัดตรวจวันหยุดเพิ่มเติม</p>':''}
   </article>`;

  }).join(''):'<div class="booking-empty">ยังไม่มีรอบเปิดจอง<br><small>ผู้จัดตั้งวันและเวลาได้ในเมนูด้านล่าง</small></div>';
  q('#bookingAdmin').hidden=!data.canEdit;
  if(data.canEdit&&!dirty)renderSettings();
  if(data.canEdit&&!cupDirty)renderCupSettings();
  renderSelection();renderDetail();
 }
 function renderSelection(){
  if(!data)return;
  const chosen=data.sessions.filter(s=>selected.has(s.id));
  const booked=new Map();
  for(const session of chosen)for(const {playerId:id} of session.registrations)booked.set(id,(booked.get(id)||0)+1);
  const picker=q('#bookingPlayer');
  const options=data.roster.filter(p=>!chosen.length||(booked.get(p.id)||0)<chosen.length);
  picker.innerHTML='<option value="">เลือกชื่อของคุณ…</option>'+options.map(p=>{
   const count=booked.get(p.id)||0;
   const note=chosen.length>1&&count?` · จองแล้ว ${count}/${chosen.length} วัน`:'';
   return `<option value="${html(p.id)}">${html(name(p.id))}${p.thai?' · '+html(p.thai):''}${note}</option>`;
  }).join('');
  const eligible=options.some(p=>p.id===playerId);
  picker.value=eligible?playerId:'';
  picker.disabled=!options.length;
  q('#bookingPlayerHint').textContent=!data.roster.length?'ไม่มีชื่อในก๊วน? ให้ผู้จัดเพิ่มรายชื่อก่อน'
   :!options.length?'ทุกคนในรายชื่อจองครบทุกวันที่เลือกแล้ว'
   :chosen.length===1?'แสดงเฉพาะคนที่ยังไม่ได้จองวันนี้'
   :'ระบบจะจองเฉพาะวันที่ชื่อนี้ยังไม่ได้จอง';
  q('#bookingAction').hidden=!chosen.length;
  q('#bookingSelection').textContent=`เลือก ${chosen.length} วัน`;
  q('#bookingReviewDates').innerHTML=chosen.map(s=>{
   const alreadyBooked=s.registrations.some(r=>r.playerId===picker.value);
   const note=alreadyBooked?' · มีชื่อแล้ว':s.confirmedCount>=s.capacity?' · รับสำรอง':'';
   return `<li>${displayDate(s.date)} · ${html(s.start)}–${html(s.end)} น.${s.isCup?' · 🏆 '+html(cupName):''}${note}</li>`;
  }).join('');
  q('#bookingHolidayConfirm').hidden=!chosen.some(s=>s.holiday);
  q('#bookingConfirm').disabled=!chosen.length||!picker.value||!token||!data.settings.enabled;
  if(!token)status('เบราว์เซอร์ไม่ให้เก็บรหัสจัดการการจอง กรุณาเปิดเว็บใน Safari / Chrome โดยตรง',true);
 }
 function renderDetail(){
  const s=data.sessions.find(s=>s.id===focusId);
  const sessionTime=s?`${s.start}–${s.end} น.${s.skipped?' • งดรับจองวันหยุด':s.closed?' • ปิดรับจอง':''}`:'';
  q('#bookingDetailsMeta').textContent=s?`${displayDate(s.date)} · ${sessionTime}`:'';
  q('#bookingDetailBadge').textContent=s?`${s.confirmedCount} / ${s.capacity} คน`:'';
  if(!s){q('#bookingDetail').innerHTML='<div class="booking-empty">เลือกวัน แล้วพบก๊วนของคุณที่นี่ 🏸</div>';q('#bookingSchedule').innerHTML='<p class="hint">เมื่อคนครบ ระบบจะบันทึกตารางคู่ให้อัตโนมัติ</p>';return;}
  const row=r=>`<div class="booking-person"><span class="booking-avatar">${html(rawName(r.playerId).slice(0,2))}</span><div><strong>${html(name(r.playerId))}</strong> ${levelBadge(r.playerId)}<small>${r.source==='regular'?'↻ ขาประจำ':r.status==='waitlist'?'สำรอง #'+r.position:'ลงชื่อออนไลน์'}</small></div>${r.canCancel?`<button type="button" class="booking-cancel" data-book-cancel="${html(r.id)}" aria-label="ถอนชื่อ ${html(name(r.playerId))}">ถอนชื่อ</button>`:''}</div>`;
  q('#bookingDetail').innerHTML=`${s.isCup?cupBadge:''}<h3 class="booking-session-date">${displayDate(s.date)}</h3><p class="hint booking-session-time">${html(sessionTime)}</p><button type="button" class="secondary" id="bookingCopyRoster">📋 คัดลอกรายชื่อส่ง LINE</button><p id="bookingRosterCopyStatus" role="status" class="hint"></p><h4>ตัวจริง <span>${s.confirmedCount} คน</span></h4>${s.registrations.filter(r=>r.status==='confirmed').map(row).join('')||'<p class="hint">มาเปิดก๊วนเป็นคนแรกกัน!</p>'}<div class="booking-waitlist"><h4>คิวสำรอง <span>${s.waitlistCount} คน</span></h4>${s.registrations.filter(r=>r.status==='waitlist').map(row).join('')||'<p class="hint">ยังไม่มีคิวสำรอง</p>'}<p class="hint">เมื่อมีคนถอน ตัวสำรองอันดับแรกจะขึ้นแทนทันที</p></div>${data.canEdit?`<button type="button" class="secondary" id="bookingClose">${s.closed?'เปิดรับจองรอบนี้':'ปิดรับจองรอบนี้'}</button>`:''}`;
  const messages={waiting:`รออีก ${Math.max(0,s.capacity-s.confirmedCount)} คนให้ครบก๊วน แล้วจัดคู่ทันที`,insufficient:'เหลือน้อยกว่า 8 คน จึงพักตารางไว้ก่อน เพื่อให้ทุกคนได้พักอย่างน้อย 1 เกม',closed:'รอบนี้ปิดรับจอง / ข้ามวันหยุด จึงพักตารางไว้ก่อน',failed:'เงื่อนไขผู้เล่นยังจัดคู่ไม่ได้ ให้ผู้จัดตรวจรายชื่อและตั้งค่าอีกครั้ง'};
  q('#bookingSchedule').innerHTML=s.schedule&&data.settings.enabled&&!s.closed&&!s.skipped?`<div class="booking-ready">✓ บันทึกตารางแล้ว <small>เวอร์ชัน ${s.scheduleVersion} • ${s.rounds} เกม</small></div><p class="hint">ปรับคู่และบันทึกใหม่เมื่อรายชื่อตัวจริงเปลี่ยน • พักอย่างน้อย 1 เกม</p><button type="button" class="primary booking-primary" id="bookingCopy">📋 Copy ตารางลง LINE</button>${data.canEdit?`<button type="button" class="secondary booking-primary" id="bookingReroll">↻ จัดคู่ใหม่</button><p id="bookingRerollStatus" role="status" class="hint"></p>`:''}<p id="bookingCopyStatus" role="status"></p><details class="booking-draw"><summary>ดูตารางทั้งหมด ${s.rounds} เกม</summary>${s.schedule.schedule.map(m=>`<div class="booking-match"><b>GAME ${String(m.round).padStart(2,'0')}</b><div>${matchTeam(m.ids.slice(0,2))}<em>VS</em>${matchTeam(m.ids.slice(2))}</div></div>`).join('')}<div class="booking-counts">${Object.entries(s.schedule.counts).map(([id,n])=>`<span>${html(name(id))} <b>${n} เกม</b></span>`).join('')}</div></details>`:`<div class="booking-empty">🏸<p>${messages[s.scheduleStatus]||'เมื่อคนครบ ระบบจะจัดคู่และบันทึกตารางให้ทันที'}</p></div>`;
 }
 function renderCupSettings(){
  q('#bookingCupSettings').dataset.version=String(data.cupVersion);
  q('#bookingCupWeek').value=String(data.cupWeek);
  q('#bookingCupDates').innerHTML=data.sessions.filter(s=>!s.skipped).map(s=>
   `<label class="booking-check"><input type="checkbox" data-cup-date="${html(s.date)}" data-override="${s.cupOverride??''}" data-original="${s.cupOverride??''}" ${s.isCup?'checked':''}>${displayDate(s.date)} · ${html(s.start)} น.</label>`
  ).join('')||'<p class="hint">ยังไม่มีรอบให้เลือก ตั้งวันตีประจำก่อนเพื่อเลือกวันแข่งรายรอบ</p>';
 }
 function renderSettings(){
  const cfg=data.settings;
  q('#bookingSettings').innerHTML=`<p class="hint">บันทึกแล้วมีผลกับรอบอนาคต รวมเวลา จำนวนคน และตารางคู่ • รอบเดิมที่มีคนจองจะยังเก็บไว้ แม้เปลี่ยนวันประจำ</p><label class="booking-check"><input name="enabled" type="checkbox" ${cfg.enabled?'checked':''}> เปิดรับจองออนไลน์</label><fieldset><legend>วันตีประจำ</legend><div class="booking-weekdays">${days.map((d,i)=>`<label><input type="checkbox" name="weekday" value="${i}" ${cfg.weekdays.includes(i)?'checked':''}><span>${d}</span></label>`).join('')}</div></fieldset><div class="booking-fields"><label>เริ่ม<input name="start" type="time" value="${cfg.start}" required></label><label>สิ้นสุด<input name="end" type="time" value="${cfg.end}" required></label><label>ตัวจริง (8–24 คน)<input name="capacity" type="number" min="8" max="24" value="${cfg.capacity}" required></label><label>จำนวนเกม (1–30)<input name="rounds" type="number" min="1" max="30" value="${cfg.rounds}" required></label><label>เปิดล่วงหน้า (สัปดาห์)<input name="weeks" type="number" min="1" max="8" value="${cfg.weeks}" required></label><label>ถ้าตรงวันหยุด<select name="holidayPolicy"><option value="warn" ${cfg.holidayPolicy==='warn'?'selected':''}>แจ้งเตือน แต่จองได้</option><option value="skip" ${cfg.holidayPolicy==='skip'?'selected':''}>ข้าม / งดรับจอง</option></select></label></div><fieldset><legend>↻ ขาประจำ ลงชื่อให้อัตโนมัติทุกสัปดาห์</legend><p class="hint">ถ้าเกินจำนวน ตัวสำรองเรียงตามลำดับที่เพิ่มขาประจำ • ถอนแล้วจะไม่เพิ่มกลับในวันเดิม</p><div class="booking-regulars">${data.roster.map(p=>`<label class="booking-check"><input type="checkbox" name="regular" value="${html(p.id)}" ${cfg.regularIds.includes(p.id)?'checked':''}>${html(p.name)}</label>`).join('')||'<p class="hint">เพิ่มรายชื่อในแท็บรายชื่อผู้เล่นก่อน</p>'}</div></fieldset><details><summary>เพิ่มวันหยุดพิเศษ / วันปิดสนาม</summary><label class="hint" for="bookingHolidays">หนึ่งวันต่อบรรทัด: YYYY-MM-DD ชื่อวันหยุด</label><textarea id="bookingHolidays" name="holidays" rows="4" placeholder="2026-12-24 สนามปิดซ่อม">${html(cfg.holidays.map(h=>h.date+' '+h.name).join('\n'))}</textarea></details><button type="submit" class="primary booking-primary">บันทึกวันประจำ &amp; ขาประจำ</button>`;
 }
 function lineText(){
  const s=data.sessions.find(s=>s.id===focusId);if(!s?.schedule)return '';
  return [`🏸 ${venueLabel} • ก๊วนพร้อมลุย!`,`${displayDate(s.date)} | ${s.start}–${s.end} น.`,`ตัวจริง ${s.confirmedCount}/${s.capacity} คน • ตาราง v${s.scheduleVersion}`,'',...s.schedule.schedule.map(m=>`เกม ${m.round} ⚡ ${m.ids.slice(0,2).map(name).join(' / ')} VS ${m.ids.slice(2).map(name).join(' / ')}`),'','จำนวนเกมแต่ละคน',...Object.entries(s.schedule.counts).map(([id,n])=>`${name(id)}: ${n} เกม`),...(s.waitlistCount?['','สำรอง: '+s.registrations.filter(r=>r.status==='waitlist').map(r=>`${r.position}. ${name(r.playerId)}`).join(', ')]:[]),'','พักอย่างน้อย 1 เกม • รายชื่อเปลี่ยน ระบบจัดคู่ใหม่','ตรวจตารางล่าสุด: '+location.origin+venueUrl('/court')+'#booking'].join('\n');
 }
 function rosterText(){
  const s=data.sessions.find(s=>s.id===focusId);if(!s)return '';
  const list=status=>s.registrations.filter(r=>r.status===status).map(r=>`${r.position}. ${name(r.playerId)}`);
  const confirmed=list('confirmed'),waitlist=list('waitlist');
  return [`🏸 ${s.isCup?cupName:venueLabel+' Court'} • รายชื่อนักตีแบด`,
   `${displayDate(s.date)} | ${s.start}–${s.end} น.`,'',
   `ตัวจริง ${s.confirmedCount}/${s.capacity} คน`,...(confirmed.length?confirmed:['ยังไม่มีรายชื่อ']),'',
   `สำรอง ${s.waitlistCount} คน`,...(waitlist.length?waitlist:['ยังไม่มีคิวสำรอง']),
   '', 'ดูคิวล่าสุด: '+location.origin+venueUrl('/court')+'#booking'
  ].join('\n');
 }
 async function copy(text,output,label){
  if(!text||!output)return;
  try{await navigator.clipboard.writeText(text);output.textContent='คัดลอกแล้ว พร้อมวางใน LINE ✓';}
  catch{
   const box=document.createElement('textarea');box.value=text;box.readOnly=true;box.setAttribute('aria-label',label);
   output.after(box);box.focus();box.select();let ok=false;
   try{ok=document.execCommand('copy');}catch{}
   output.textContent=ok?'คัดลอกแล้ว พร้อมวางใน LINE ✓':'กดค้างในช่องข้อความ แล้วเลือกคัดลอก';
   if(ok)box.remove();
  }
 }
 async function lineAction(button,body,output){
  button.disabled=true;output.textContent='กำลังเชื่อมต่อ LINE…';
  try{
   const response=await venueFetch(body?'/api/line':'/api/line?diagnose=1',body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{});
   const result=await response.json();
   if(!response.ok)throw Error(result.error);
   if(result.code){
    const command=q('#bookingLineCommand');command.value='/badbot '+result.code;command.hidden=false;
    output.textContent='คัดลอกคำสั่งด้านบนไปส่งในกลุ่ม แล้วกดตรวจการเชื่อมต่อ';
   }else if(body)output.textContent=result.message;
   else{
    output.textContent=result.connected?'สนามนี้เชื่อมกลุ่ม LINE แล้ว':'สนามนี้ยังไม่ได้เชื่อมกลุ่ม LINE'+(result.diagnosis?' · '+result.diagnosis:'');
   }
  }catch(e){output.textContent=e.message||'เชื่อมต่อ LINE ไม่สำเร็จ';}
  finally{button.disabled=false;}
 }
 root.addEventListener('change',e=>{
  if(e.target.matches('[data-book-date]')){e.target.checked?selected.add(e.target.dataset.bookDate):selected.delete(e.target.dataset.bookDate);focusId=e.target.dataset.bookDate;renderSelection();renderDetail();}
  if(e.target.id==='bookingPlayer'){playerId=e.target.value;try{localStorage.setItem(clubStorage('booking-player'),playerId);}catch{}render();}
  if(e.target.closest('#bookingSettings'))dirty=true;
  if(e.target.closest('#bookingCupSettings')){
   cupDirty=true;
   const week=Number(q('#bookingCupWeek').value);
   if(e.target.id==='bookingCupWeek'){
    for(const checkbox of root.querySelectorAll('[data-cup-date]')){
     const {cupDate,override}=checkbox.dataset;
     checkbox.checked=override===''?defaultCupDate(cupDate,week):override==='true';
    }
   }else if(e.target.dataset.cupDate){
    e.target.dataset.override=e.target.checked===defaultCupDate(e.target.dataset.cupDate,week)?'':String(e.target.checked);
   }
  }
 });
 root.addEventListener('input',e=>{if(e.target.closest('#bookingSettings'))dirty=true;});
 root.addEventListener('submit',e=>{
  if(e.target.id==='bookingCupSettings'){
   e.preventDefault();
   const changed=[...e.target.querySelectorAll('[data-cup-date]')].filter(checkbox=>checkbox.dataset.override!==checkbox.dataset.original);
   const changes=changed.map(checkbox=>{
    const {cupDate:date,override}=checkbox.dataset;
    return {date,isCup:override===''?null:override==='true'};
   });
   mutate({action:'cupCalendar',week:Number(q('#bookingCupWeek').value),cupVersion:Number(e.target.dataset.version),changes});
   return;
  }
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
  if(button.id==='bookingCupReload'){
   cupDirty=false;q('#bookingCupStatus').textContent='';button.hidden=true;load(true);
  }
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
  if(button.id==='bookingRefresh'){if(dirty||cupDirty){status('มีการตั้งค่าที่ยังไม่บันทึก กรุณาบันทึกก่อนอัปเดตคิว',true);return;}load();}
  if(button.dataset.bookFocus){
   focusId=button.dataset.bookFocus;
   for(const trigger of root.querySelectorAll('[data-book-focus]')){
    trigger.closest('.booking-date').classList.toggle('is-focus',trigger.dataset.bookFocus===focusId);
   }
   renderDetail();
   if(mobileDetails.matches&&supportsDetailsPopup){
    detailsTriggerId=focusId;
    const content=q('#bookingDetailsContent');
    q('#bookingDetailsStatus').textContent='';
    content.append(q('#bookingDetailPanels'));
    detailsDialog.showModal();
    content.scrollTop=0;
   }else q('.booking-detail').scrollIntoView({behavior:'smooth',block:'nearest'});
  }
  if(button.dataset.bookCancel){const s=data.sessions.find(s=>s.id===focusId),r=s?.registrations.find(r=>r.id===button.dataset.bookCancel);if(r&&confirm(`ถอนชื่อ ${name(r.playerId)} วันที่ ${displayDate(s.date)}?`))mutate({action:'cancel',sessionId:s.id,registrationId:r.id});}
  if(button.id==='bookingClose'){const s=data.sessions.find(s=>s.id===focusId);if(s&&confirm(`${s.closed?'เปิด':'ปิด'}รับจองรอบ ${displayDate(s.date)}? รายชื่อเดิมยังเก็บไว้`))mutate({action:'close',sessionId:s.id,closed:!s.closed});}
  if(button.id==='bookingConfirm'){if(!q('#bookingHolidayConfirm').hidden&&!q('#bookingAcceptHoliday').checked){status('กรุณารับทราบวันหยุดก่อนยืนยันจอง',true);feedback('ยังไม่ได้ยืนยันจอง','กรุณารับทราบวันหยุดก่อนยืนยันจอง');return;}mutate({action:'book',playerId:q('#bookingPlayer').value,sessionIds:[...selected],acceptHoliday:q('#bookingAcceptHoliday').checked});}
  if(button.id==='bookingReroll'){
   const s=data.sessions.find(s=>s.id===focusId);
   if(s?.schedule&&confirm('จัดคู่ใหม่และแทนตารางเดิมของรอบนี้?'))mutate({action:'reroll',sessionId:s.id,scheduleVersion:s.scheduleVersion});
  }
  if(button.id==='bookingCopy')copy(lineText(),q('#bookingCopyStatus'),'ตารางสำหรับคัดลอกลง LINE');
  if(button.id==='bookingLinePair'&&confirm('สร้างคำสั่งสำหรับเชื่อมหรือเปลี่ยนกลุ่ม LINE ของสนามนี้?'))lineAction(button,{action:'pair'},q('#bookingLineSetupStatus'));
  if(button.id==='bookingLineCheck')lineAction(button,null,q('#bookingLineSetupStatus'));
  if(button.id==='bookingCopyRoster')copy(rosterText(),q('#bookingRosterCopyStatus'),'รายชื่อสำหรับคัดลอกลง LINE');
 });
 document.querySelector('[data-tab="booking"]').addEventListener('click',()=>{if(!dirty&&!cupDirty)load();});
 // Poll only while this tab is visible; leave unfinished admin edits intact.
 setInterval(()=>{if(!root.hidden&&!document.hidden&&!dirty&&!cupDirty&&!detailsDialog.open&&!q('#bookingReview').open&&!q('#bookingFeedback').open)load(true);},60000);
 const initialTab=[...document.querySelectorAll('nav .tab')].find(t=>t.dataset.tab===location.hash.slice(1)&&!t.hidden)||document.querySelector('[data-tab="booking"]');initialTab.click();
})();
