(async()=>{
 let club='sena',pay=false,bill=null;
 function readTarget(){
  let params=new URLSearchParams(location.search);
  const state=params.get('liff.state');
  if(state){const target=new URL(state,location.origin);if(target.origin===location.origin)params=target.searchParams;}
  club=params.get('club')==='88'?'88':'sena';pay=params.get('page')==='pay';bill=params.get('bill');
 }
 const q=id=>document.getElementById(id),message=text=>q('message').textContent=text;
 const api=async(action='',body,csrf)=>{
  const response=await fetch('/api/member'+action+'?club='+club+(bill&&action==='/bills'?'&bill='+encodeURIComponent(bill):''),{method:body?'POST':'GET',headers:{...(body?{'Content-Type':'application/json'}:{}),...(csrf?{'X-Member-CSRF':csrf}:{})},...(body?{body:JSON.stringify(body)}:{}),cache:'no-store'});
  const data=await response.json();if(!response.ok)throw Error(data.error||'ดำเนินการไม่สำเร็จ');return data;
 };
 const button=(text,onclick)=>{const el=document.createElement('button');el.textContent=text;el.onclick=onclick;q('actions').append(el);return el;};
 try{
  let session=await api();
  if(!session.enabled||!session.configured){message('ระบบ LINE Login ยังไม่ได้เปิดใช้งาน กรุณาติดต่อผู้จัด');return;}
  await liff.init({liffId:session.liffId});
  readTarget();session=await api();
  if(!session.loggedIn&&liff.isLoggedIn()){
   await api('/login',{idToken:liff.getIDToken()},session.csrf);session=await api();
  }
  if(!session.loggedIn){
   message('เข้าสู่ระบบเพื่อจอง ถอน หรือชำระบิลของคุณ');
   button('เข้าสู่ระบบด้วย LINE',()=>{
    const redirect=new URL('/liff.html',location.origin);redirect.searchParams.set('club',club);redirect.searchParams.set('page',pay?'pay':'book');if(bill)redirect.searchParams.set('bill',bill);
    liff.login({redirectUri:redirect.href});
   });return;
  }
  button('ออกจากระบบ',async()=>{try{await api('/logout',{});if(liff.isLoggedIn())liff.logout();location.reload();}catch(e){message(e.message);}});
  if(session.link?.status==='pending'){message('ส่งคำขอแล้ว รอผู้จัดตรวจสอบชื่อและเปิดสิทธิ์ครั้งแรก กดรีเฟรชหลังผู้จัดอนุมัติ');button('ตรวจสถานะอีกครั้ง',()=>location.reload());return;}
  if(session.link?.status!=='approved'){
   const response=await fetch('/api/booking?club='+club),data=await response.json();if(!response.ok)throw Error(data.error);
   for(const player of data.roster){const option=document.createElement('option');option.value=player.id;option.textContent=player.name;q('existing').append(option);}
   q('existing').onchange=()=>{q('newNameLabel').hidden=Boolean(q('existing').value);q('newName').required=!q('existing').value;};q('existing').onchange();
   q('mapForm').onsubmit=async event=>{
    event.preventDefault();const submit=q('mapForm').querySelector('button');submit.disabled=true;
    try{await api('/link',q('existing').value?{playerId:q('existing').value}:{name:q('newName').value});location.reload();}catch(e){q('mapStatus').textContent=e.message;submit.disabled=false;}
   };
   message('เลือกชื่อของคุณสำหรับสนาม '+(club==='88'?'88':'Sena'));q('mapping').showModal();return;
  }
  if(!pay){location.replace('/court'+(club==='88'?'?club=88':'')+'#booking');return;}
  q('title').textContent='บิลของคุณ · '+(club==='88'?'88':'Sena');
  const {bills}=await api('/bills');
  if(bill&&bills.length===1){location.replace(bills[0].url);return;}
  message(bills.length?'เลือกบิลที่ต้องการชำระ':'ไม่พบบิลของคุณในสนามนี้ หากเป็นบิลเก่าที่ไม่ผูกสมาชิกให้ติดต่อผู้จัด');
  for(const item of bills){const section=document.createElement('section'),link=document.createElement('a');link.className='button';link.href=item.url;link.textContent=item.date+' · '+item.name+' · '+(item.amount/100).toLocaleString('th-TH')+' บ. · '+(item.status==='paid'?'จ่ายแล้ว':'เปิดบิล');section.append(link);q('actions').append(section);}
 }catch(error){message(error.message||'เข้าสู่ระบบไม่สำเร็จ กรุณาลองใหม่');}
})();
