(() => {
 const section=document.querySelector('#leaderboard');
 document.querySelector('#historyForm').addEventListener('input',()=>document.querySelector('#historyEditor').dataset.dirty='1');
 let data={history:[],standings:[],canEdit:false}, editing=null, draft=null, busy=false;
 const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Bangkok',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const status=text=>document.querySelector('#leaderboardStatus').textContent=text;
 const nameOf=team=>team.join(' / ');
 const changeText=value=>value==='NEW'?'NEW':value===null||value===0?'—':value>0?'↑ '+value:'↓ '+Math.abs(value);
 function draw(){
  const rows=data.standings;
  document.querySelector('#leaderboardRows').innerHTML=rows.map(p=>`<tr><td class="rank-${p.position}">${p.position}</td><th scope="row">${esc(p.name)}</th><td>${p.played}</td><td>${p.w}</td><td>${p.l}</td><td>${p.pf}</td><td>${p.pa}</td><td>${p.diff>0?'+':''}${p.diff}</td><td>${p.winPercent.toFixed(2)}%</td><td>${p.crown||'—'}</td><td>${p.poo||'—'}</td><td class="${typeof p.change==='number'?(p.change>0?'up':p.change<0?'down':''):''}">${esc(changeText(p.change))}</td></tr>`).join('');
  document.querySelector('#manualHistory').hidden=!data.canEdit;
  document.querySelector('#cupArchiveHint').textContent=data.canEdit?'บันทึกคะแนนครบ แล้วกดจบการแข่งขันเพื่อเพิ่มประวัติและยอดสะสม':'ผู้จัดที่เข้าสู่ระบบสามารถบันทึกจบการแข่งขันได้';
  document.querySelector('#archiveCup').hidden=!data.canEdit;
  document.querySelector('#historyList').innerHTML=data.history.length?data.history.slice().reverse().map(c=>{
   const standings=Sena.standings(c.teams,c.matches);
   return `<article class="panel"><div class="sectionhead"><h2>${esc(c.title)}</h2><span>${esc(c.date)}</span></div><p class="hint">${c.inBaseline?'รวมอยู่ในยอดตั้งต้นแล้ว':'นับเพิ่มในสถิติสะสม'} · ${c.matches.length} เกม</p><details><summary>ดูอันดับและคะแนน</summary><ol>${standings.map(row=>`<li>${esc(row.name)} · ชนะ ${row.w} · แต้ม ${row.pf}–${row.pa}</li>`).join('')}</ol>${c.matches.map((m,i)=>`<p>เกม ${i+1} · ${esc(nameOf(c.teams[m.a]))} <b>${m.sa} : ${m.sb}</b> ${esc(nameOf(c.teams[m.b]))}</p>`).join('')}</details>${data.canEdit?`<button class="secondary" data-edit-history="${esc(c.id)}">แก้ไขรายการนี้</button>`:''}</article>`;
  }).join(''):(activeClub==='88'?'<div class="panel">ยังไม่มีประวัติ 88 Cup • เริ่มบันทึกการแข่งขันแรกได้เลย</div>':'<div class="panel">ยังไม่มีผลแยกรายการ • สถิติจากภาพเก็บเป็นยอดสะสมตั้งต้นแล้ว</div>');
 }
 async function load(){
  const res=await venueFetch('/api/leaderboard',{cache:'no-store'}),body=await res.json();
  if(!res.ok)throw Error(body.error);
  data=body;draw();status('ข้อมูลออนไลน์ล่าสุด');
 }
 function openEditor(record=null,current=false){
  if(!data.canEdit)return;
  editing=record;
  draft=record?structuredClone(record):current?structuredClone(state.cup):null;
  const form=document.querySelector('#historyForm');form.reset();
  form.elements.title.value=record?.title||cupName;form.elements.date.value=record?.date||today();
  form.elements.inBaseline.checked=record?.inBaseline||false;form.elements.inBaseline.closest('label').hidden=activeClub==='88';
  form.elements.teams.value=draft?draft.teams.map(nameOf).join('\n'):'';
  document.querySelector('#historyEditor').hidden=false;document.querySelector('#historyEditor').dataset.dirty='0';
  renderScoreEditor();form.elements.title.focus();
 }
 function renderScoreEditor(){
  document.querySelector('#historyScores').innerHTML=draft?draft.matches.map((m,i)=>`<div class="cupmatch"><span>เกม ${i+1} · ${esc(nameOf(draft.teams[m.a]))}</span><input type="number" min="0" max="999" required data-history-score="${i}" data-side="sa" aria-label="คะแนนทีมแรกเกม ${i+1}" value="${m.sa}"><span>:</span><input type="number" min="0" max="999" required data-history-score="${i}" data-side="sb" aria-label="คะแนนทีมสองเกม ${i+1}" value="${m.sb}"><span>${esc(nameOf(draft.teams[m.b]))}</span></div>`).join(''):'';
 }
 document.querySelector('[data-tab="leaderboard"]').addEventListener('click',()=>load().catch(e=>status(e.message)));
 document.querySelector('#leaderboardRefresh').onclick=()=>load().catch(e=>status(e.message));
 document.querySelector('#manualHistory').onclick=()=>openEditor();
 document.querySelector('#historyList').onclick=e=>{const id=e.target.dataset.editHistory;if(id)openEditor(data.history.find(c=>c.id===id));};
 document.querySelector('#cancelHistory').onclick=()=>{document.querySelector('#historyEditor').hidden=true;document.querySelector('#historyEditor').dataset.dirty='0';};
 document.querySelector('#buildHistoryScores').onclick=()=>{
  const teams=document.querySelector('#historyForm').elements.teams.value.split('\n').map(s=>s.trim()).filter(Boolean).map(s=>s.split('/').map(n=>n.trim()));
  if(teams.length<2||teams.length>20||teams.some(t=>t.length!==2||t.some(n=>!n))||new Set(teams.flat().map(n=>n.toLowerCase())).size!==teams.flat().length)return status('กรอก 2–20 ทีม ชื่อไม่ซ้ำ ทีมละ 2 คน คั่นด้วย /');
  if(draft&&!confirm('สร้างช่องคะแนนใหม่และล้างคะแนนที่กำลังแก้?'))return;
  draft={teams,matches:Sena.roundRobin(teams)};renderScoreEditor();
 };
 document.querySelector('#archiveCup').onclick=async()=>{
  try{
   if(!state.cup||!state.cup.matches.length||state.cup.matches.some(m=>!Number.isInteger(m.sa)||!Number.isInteger(m.sb)||m.sa===m.sb))throw Error('กรุณาบันทึกคะแนนครบทุกเกมก่อนจบการแข่งขัน');
   for(const input of document.querySelectorAll('#cupResults input[data-match]')){if(String(state.cup.matches[Number(input.dataset.match)][input.dataset.side])!==input.value)throw Error('กรุณากดบันทึกคะแนนล่าสุดก่อนจบการแข่งขัน');}
   await load();
   if(!data.canEdit)throw Error('กรุณาเข้าสู่ระบบผู้จัด');
   // Older Cups had no id. A stable legacy id prevents duplicate submissions from other devices.
   if(!state.cup.id){const bytes=new TextEncoder().encode(JSON.stringify(state.cup.teams));const hash=new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));state.cup.id='legacy-'+Array.from(hash).map(b=>b.toString(16).padStart(2,'0')).join('');save();}
   const record=data.history.find(c=>c.id===state.cup.id);
   openEditor(record||null,true);
   document.querySelector('[data-tab="leaderboard"]').click();
  }catch(error){document.querySelector('#cupArchiveHint').textContent=error.message;}
 };
 document.querySelector('#historyForm').onsubmit=async event=>{
  event.preventDefault();if(busy)return;
  if(!draft)return status('กดสร้างช่องคะแนนก่อนบันทึก');
  const form=event.target;
  if(form.elements.teams.value.trim()!==draft.teams.map(nameOf).join('\n'))return status('แก้รายชื่อแล้ว กรุณาสร้างช่องคะแนนใหม่');
  const matches=draft.matches.map(m=>({...m}));
  for(const input of form.querySelectorAll('[data-history-score]'))matches[Number(input.dataset.historyScore)][input.dataset.side]=input.value===''?'':Number(input.value);
  if(!draft.id)draft.id=crypto.randomUUID();
  const id=editing?.id || draft.id;
  const cup={title:form.elements.title.value,date:form.elements.date.value,inBaseline:form.elements.inBaseline.checked,teams:draft.teams,matches};
  busy=true;const button=form.querySelector('[type="submit"]');button.disabled=true;
  try{
   const res=await venueFetch('/api/leaderboard',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,revision:editing?.revision||0,cup})}),body=await res.json();
   if(!res.ok)throw Error(body.error);
   document.querySelector('#historyEditor').hidden=true;document.querySelector('#historyEditor').dataset.dirty='0';await load();status('บันทึกประวัติและคำนวณยอดสะสมแล้ว ✓');
  }catch(error){status(error.message);}finally{busy=false;button.disabled=false;}
 };
 load().catch(e=>status(e.message));
})();
