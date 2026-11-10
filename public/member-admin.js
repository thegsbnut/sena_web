(async()=>{
 const response=await venueFetch('/api/session'),session=await response.json();if(!session.canEdit)return;
 const container=document.getElementById('roster');if(!container)return;
 const panel=document.createElement('section');panel.className='panel';
 panel.innerHTML='<h2>บัญชี LINE และคำขอผูกผู้เล่น</h2><p>ชื่อเดิมให้ตรวจสอบว่าเป็นเจ้าของชื่อจริง ชื่อใหม่ให้กำหนดชื่อ LV และเพศก่อนอนุมัติ เมื่ออนุมัติแล้วแก้ชื่อได้จากรายชื่อผู้เล่นเดิม โดยรหัสสมาชิกยังคงเดิม</p><button type="button">โหลดคำขอล่าสุด</button><div class="member-requests"></div><p role="status"></p>';
 container.prepend(panel);
 const rows=panel.querySelector('.member-requests'),status=panel.querySelector('[role=status]');
 const api=async(action,body)=>{
  const r=await venueFetch('/api/member/'+action,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:{},...(body?{body:JSON.stringify(body)}:{})});const d=await r.json();if(!r.ok)throw Error(d.error);return d;
 };
 async function load(){try{
  rows.replaceChildren();const {requests}=await api('requests');
  for(const item of requests){
   const row=document.createElement('div');row.className='panel';const label=document.createElement('p');label.textContent=item.name+' · LINE: '+(item.line_name||'ไม่ระบุ')+' · '+item.kind+' · '+item.status+' · บัญชี …'+item.user_id.slice(-6);row.append(label);
   if(item.status==='pending'){
    const name=document.createElement('input');name.value=item.name;name.maxLength=80;name.setAttribute('aria-label','ชื่อในก๊วน');
    const lv=document.createElement('input');lv.type='number';lv.min='0';lv.max='100';lv.step='0.1';lv.placeholder='LV';lv.setAttribute('aria-label','LV ผู้เล่นใหม่');
    const gender=document.createElement('select');for(const [value,text] of [['','เลือกเพศ'],['M','ชาย'],['F','หญิง']])gender.add(new Option(text,value));gender.setAttribute('aria-label','เพศผู้เล่นใหม่');
    if(item.kind==='new')row.append(name,lv,gender);
    for(const [action,text] of [['approve','อนุมัติ'],['reject','ปฏิเสธ']]){
     const button=document.createElement('button');button.textContent=text;button.type='button';button.onclick=async()=>{
      if(action==='approve'&&item.kind==='new'&&(!lv.value||!gender.value)){status.textContent='กรอกชื่อ LV และเพศก่อนอนุมัติ';return;}
      if(!confirm(text+'คำขอ '+item.name+'?'))return;button.disabled=true;
      try{await api(action,{userId:item.user_id,name:name.value,lv:Number(lv.value),gender:gender.value});status.textContent='บันทึกแล้ว กรุณาโหลดข้อมูลกลางล่าสุดก่อนแก้รายชื่อ';await load();window.dispatchEvent(new Event('member-approved'));}catch(e){status.textContent=e.message;button.disabled=false;}
     };row.append(button);
    }
   }else if(item.status==='approved'){
    const revoke=document.createElement('button');revoke.textContent='ยกเลิกการผูก LINE';revoke.onclick=async()=>{if(!confirm('ยกเลิกสิทธิ์ LINE ของ '+item.name+'? ข้อมูลผู้เล่นและบิลยังอยู่'))return;try{await api('revoke',{userId:item.user_id});await load();}catch(e){status.textContent=e.message;}};row.append(revoke);
   }rows.append(row);
  }
  if(!requests.length)rows.textContent='ยังไม่มีคำขอ';
 }catch(e){status.textContent=e.message;}}
 panel.querySelector('button').onclick=load;await load();
})();
