(() => {
 const root=document.getElementById('buddyPane'),select=document.getElementById('buddyPlayer');
 const labels=['คู่หูสวรรค์สร้าง','คู่หูอย่าเจอกันอีกเลย','ศัตรูทางธรรมชาติ'],emojis=['😇','💀','🐍'];
 const quotes=['นายเปิด เราปิด…ประสานร่างล้างคอร์ต!','มิตรภาพนอกสนามยังอยู่…ในสนามขอแยกทีม!','ไม่ได้แพ้ทาง…แค่ยังไม่ปลดล็อกร่างสอง!'];
 let profiles=[],current=null,category=0;
 const percent=n=>Number(n.toFixed(1)).toString();
 function tab(name){
  document.querySelectorAll('[data-board-tab]').forEach(button=>{const active=button.dataset.boardTab===name;button.setAttribute('aria-selected',String(active));button.classList.toggle('active',active);});
  for(const [id,value] of [['lbTotals','rank'],['historyPane','history'],['buddyPane','buddy']])document.getElementById(id).hidden=name!==value;
  if(name==='buddy')render();
 }
 document.querySelectorAll('[data-board-tab]').forEach(button=>button.onclick=()=>tab(button.dataset.boardTab));
 window.addEventListener('sena:board-tab',event=>tab(event.detail));
 function update(data){
  profiles=SenaBuddy.calculate(data.history);
  const names=new Map();for(const name of [...data.standings.map(p=>p.name),...profiles.map(p=>p.name),...state.players.map(p=>p.name)])if(!names.has(name.toLowerCase()))names.set(name.toLowerCase(),name);
  const old=select.value;select.innerHTML=[...names.values()].map(name=>'<option value="'+esc(name)+'">'+esc(name)+'</option>').join('');
  if([...select.options].some(o=>o.value===old))select.value=old;
  select.disabled=!names.size;render();
 }
 function render(){
  const name=select.value;
  current=profiles.find(p=>p.name.toLowerCase()===name.toLowerCase())||{name,buddies:[],rivals:[]};
  const highlights=SenaBuddy.highlights(current);
  document.getElementById('buddyCards').innerHTML=labels.map((label,i)=>{
   const r=highlights[i],pct=r?(i===2?r.l/r.n*100:r.percent):0;
   const waiting=!r?(i===1&&highlights[0]?'ยังไม่มีคู่หูอื่นที่แพ้ด้วยกันครบ 3 เกม':i===2?'ยังไม่มีคู่ปรับที่แพ้ให้และเจอกันครบ 3 เกม':'รอเล่นด้วยกันให้ครบ 3 เกม'):'';
   return `<button type="button" class="buddy-card" data-buddy-category="${i}" aria-pressed="${i===category}"><span class="buddy-cardtitle"><span class="buddy-emoji">${emojis[i]}</span>${label}</span><span class="buddy-person">${r?esc(r.name):'รอสะสมสถิติ'}</span><span class="buddy-context">${name?(i===2?'อยู่ฝั่งตรงข้ามกับ ':'จับคู่กับ ')+esc(name):'ยังไม่มีรายชื่อผู้เล่นในก๊วนนี้'}</span>${r?`<span class="buddy-ratio"><span>${i===2?'แพ้ให้คนนี้':'อัตราชนะ'}</span><b>${percent(pct)}%</b></span><span class="buddy-track"><span style="width:${pct}%"></span></span><span class="buddy-record">${r.n} เกม · ชนะ ${r.w} / แพ้ ${r.l}</span><span class="buddy-quote">“${quotes[i]}”</span>`:`<span class="buddy-wait">${waiting}</span>`}<span class="buddy-more">ดูสถิติทั้งหมด ↗</span></button>`;
  }).join('');
  document.getElementById('buddyCopy').disabled=!name;document.getElementById('buddyShare').disabled=!name;document.getElementById('buddyText').value=name?SenaBuddy.text(current,venueLabel):'';
  document.getElementById('buddyStatus').textContent='';detail();
 }
 function detail(){
  document.getElementById('buddyDetailTitle').textContent=emojis[category]+' '+labels[category];
  document.getElementById('buddyColumn').textContent=category===2?'คู่ปรับ':'คู่หู';
  const rows=SenaBuddy.rows(current,category);
  document.getElementById('buddyRows').innerHTML=rows.length?rows.map(r=>`<tr><th scope="row">${esc(r.name)}${r.eligible?'':'<small>ยังไม่ครบ 3 เกม</small>'}</th><td>${r.n}</td><td>${r.w}–${r.l}</td><td>${percent(r.percent)}%</td></tr>`).join(''):'<tr><td colspan="4">ยังไม่มีประวัติรายเกมสำหรับผู้เล่นนี้</td></tr>';
  root.querySelectorAll('[data-buddy-category]').forEach(button=>button.setAttribute('aria-pressed',String(+button.dataset.buddyCategory===category)));
 }
 select.onchange=render;
 document.getElementById('buddyCards').onclick=event=>{const button=event.target.closest('[data-buddy-category]');if(!button)return;category=+button.dataset.buddyCategory;detail();};
 const output=document.getElementById('buddyOutput'),text=document.getElementById('buddyText'),status=document.getElementById('buddyStatus');
 document.getElementById('buddyShowText').onclick=()=>{output.hidden=!output.hidden;document.getElementById('buddyShowText').textContent=output.hidden?'ดูข้อความ':'ซ่อนข้อความ';};
 async function copy(){
  if(!current?.name)return;
  text.value=SenaBuddy.text(current,venueLabel);
  try{await navigator.clipboard.writeText(text.value);status.textContent='คัดลอกแล้ว ✓ พร้อมวางในกลุ่ม LINE';return;}catch{}
  output.hidden=false;text.focus();text.select();text.setSelectionRange(0,text.value.length);
  let copied=false;try{copied=document.execCommand('copy');}catch{}
  status.textContent=copied?'คัดลอกแล้ว ✓ พร้อมวางในกลุ่ม LINE':'เลือกข้อความไว้แล้ว แตะค้างเพื่อคัดลอกไปวางใน LINE';
 }
 document.getElementById('buddyCopy').onclick=copy;
 document.getElementById('buddyShare').onclick=async()=>{
  if(!current?.name)return;
  if(navigator.share)try{await navigator.share({title:'คู่หู & คู่ปรับ • '+venueLabel,text:SenaBuddy.text(current,venueLabel),url:location.origin+venueUrl('/court')});status.textContent='แชร์แล้ว ✓';return;}catch(error){if(error.name==='AbortError')return;}
  await copy();
 };
 window.addEventListener('sena:leaderboard',event=>update(event.detail));
 if(window.SenaLeaderboardSnapshot)update(window.SenaLeaderboardSnapshot);else update({history:[],standings:[]});
})();
