import {bookingRoute} from './booking.js';

const defaultBookingUrl='https://sena-web.thegsbnut.workers.dev/court#booking';
const clubs=['sena','88'];
const day=86400000;
const thaiDay=new Intl.DateTimeFormat('th-TH',{weekday:'long',day:'numeric',month:'short',year:'numeric',timeZone:'Asia/Bangkok'});
const thaiTime=new Intl.DateTimeFormat('th-TH',{hour:'2-digit',minute:'2-digit',hour12:false,timeZone:'Asia/Bangkok'});
export const normalizeLineText=text=>String(text??'').normalize('NFKC').replace(/[\u200b\u200e\u200f\ufeff]/g,'').trim();

function command(event){
 if(event.mode==='standby')return null;
 if(event.type==='postback'){
  const data=event.postback?.data;
  if(data==='badbot:menu')return {kind:'menu'};
  if(data==='badbot:roster')return {kind:'roster',scope:'all'}; // Existing cards still work.
  const match=/^badbot:roster:(all|sena|88)$/.exec(data||'');
  return match?{kind:'roster',scope:match[1]}:null;
 }
 if(event.type!=='message'||event.message?.type!=='text')return null;
 const match=/^\/?(?:badbot|แบดบอต)(?:\s+(.*))?$/i.exec(normalizeLineText(event.message.text));
 if(!match)return null;
 const action=(match[1]||'').trim();
 // Pairing codes are consumed by the existing administrator-only pairing flow.
 if(/^[a-f0-9]{32}$/i.test(action))return null;
 const roster=/^(?:รายชื่อ|ดูรายชื่อ|ดูผู้ตี|ผู้ตี|ดูรายชื่อผู้เล่น)(?:\s+(ทั้งหมด|ทุกสนาม|all|sena|เสนา|88))?$/i.exec(action);
 if(!roster)return {kind:'menu'};
 const venue=(roster[1]||'all').toLowerCase();
 return {kind:'roster',scope:venue==='88'?'88':['sena','เสนา'].includes(venue)?'sena':'all'};
}

function bookingUrl(env,club='sena'){
 const url=new URL(env.LINE_BOOKING_URL||defaultBookingUrl);
 if(url.protocol!=='https:'||url.username||url.password)throw Error('Invalid booking URL');
 if(club==='88')url.searchParams.set('club','88');else url.searchParams.delete('club');
 return url.href;
}

function menu(urls,scope=null){
 const link=club=>({type:'button',style:'primary',color:'#168B42',action:{type:'uri',label:'🏸 จอง / ถอน '+(club==='88'?'88':'Sena'),uri:urls[club]}});
 const postback=(label,data)=>({type:'button',style:'secondary',action:{type:'postback',label,data}});
 const buttons=scope?[
  postback('🔄 ดูข้อมูลล่าสุด','badbot:roster:'+scope),
  ...(scope==='all'?clubs:[scope]).map(link),
  postback('เมนูหลัก','badbot:menu')
 ]:[
  ...clubs.map(link),
  postback('👥 ผู้ตีทุกสนาม','badbot:roster:all'),
  postback('👥 ผู้ตี Sena','badbot:roster:sena'),
  postback('👥 ผู้ตี 88','badbot:roster:88')
 ];
 return {type:'flex',altText:'SENA Badbot · จอง / ถอนชื่อ และดูรายชื่อผู้ตี',contents:{
  type:'bubble',body:{type:'box',layout:'vertical',spacing:'md',contents:[
   {type:'text',text:'🏸 SENA Badbot',weight:'bold',size:'lg',wrap:true},
   {type:'text',text:scope?'ดูคิวล่าสุด หรือเปิดเว็บเพื่อจอง / ถอนชื่อ':'เลือกสนามเพื่อจอง / ถอน หรือดูรายชื่อผู้ตี',size:'sm',wrap:true}
  ]},footer:{type:'box',layout:'vertical',spacing:'sm',contents:buttons}
 }};
}

const clean=value=>String(value??'').replace(/\s+/g,' ').trim();
function boundedSection(lines){
 const result=[];let size=0;
 for(const line of lines){
  if(size+line.length+1>8000){result.push('… รายชื่อเพิ่มเติมดูได้บนเว็บ');break;}
  result.push(line);size+=line.length+1;
 }
 return result.join('\n');
}

async function rosterSection(env,club,now){
 const heading='📍 '+(club==='88'?'88':'เสนา');
 const response=await bookingRoute(new Request('https://badbot.internal/api/booking'),env,false,club);
 if(!response.ok)return heading+'\nอ่านคิวไม่สำเร็จ กรุณากดดูข้อมูลล่าสุดอีกครั้ง';
 const data=await response.json();
 const session=data.settings.enabled&&data.sessions
  .filter(s=>!s.skipped&&Date.parse(s.date+'T'+s.start+':00+07:00')>+now)
  .sort((a,b)=>(a.date+'T'+a.start).localeCompare(b.date+'T'+b.start))[0];
 if(!session)return heading+'\nยังไม่มีรอบเปิดรับ';
 const names=new Map(data.roster.map(p=>[p.id,clean([p.award,p.name].filter(Boolean).join(' '))]));
 const numbered=status=>session.registrations.filter(r=>r.status===status)
  .sort((a,b)=>a.position-b.position)
  .map((r,i)=>`${i+1}. ${names.get(r.playerId)||'ผู้เล่นที่นำออกจากก๊วน'}`);
 const confirmed=numbered('confirmed'),waiting=numbered('waitlist');
 const vacancy=session.closed?'ปิดรับจอง':session.confirmedCount>=session.capacity?'เต็ม':`เหลือ ${session.capacity-session.confirmedCount} ที่`;
 return boundedSection([
  heading+(session.isCup?' · CUP':''),
  thaiDay.format(new Date(session.date+'T12:00:00+07:00'))+` · ${session.start}–${session.end} น.`,
  `👥 ผู้ตี ${session.confirmedCount}/${session.capacity} คน · ${vacancy}`,
  ...confirmed.length?confirmed:['ยังไม่มีผู้ลงชื่อ'],
  '',waiting.length?`⏳ สำรอง ${session.waitlistCount} คน`:'⏳ สำรอง: ไม่มี',...waiting
 ]);
}

function textMessages(text){
 const chunks=[''];
 for(const line of text.split('\n')){
  const i=chunks.length-1;
  if(chunks[i].length+line.length+1>4800)chunks.push(line);
  else chunks[i]+=(chunks[i]?'\n':'')+line;
 }
 return chunks.map(text=>({type:'text',text}));
}

async function eventKey(event){
 const value=event.source.groupId+'\n'+(event.webhookEventId||event.replyToken);
 const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));
 return [...new Uint8Array(bytes)].map(b=>b.toString(16).padStart(2,'0')).join('');
}

// Called only after lineWebhook verifies the signature. Never links a LINE user
// to a player, changes a booking, or falls back to the chargeable Push API.
export async function replyToGroupCommand(event,env){
 const action=command(event),group=event.source?.groupId;
 if(!action||event.source?.type!=='group'||!group||!event.replyToken)return;
 await env.DB.prepare('CREATE TABLE IF NOT EXISTS line_groups (club TEXT PRIMARY KEY, group_id TEXT, pair_code TEXT, expires_at INTEGER)').run();
 const linked=await env.DB.prepare('SELECT club FROM line_groups WHERE group_id=? LIMIT 1').bind(group).first();
 if(!linked)return;
 if(!env.LINE_CHANNEL_ACCESS_TOKEN)throw Error('LINE reply is not configured');
 const urls=Object.fromEntries(clubs.map(club=>[club,bookingUrl(env,club)])),now=new Date();
 const db=env.DB;
 await db.prepare('CREATE TABLE IF NOT EXISTS line_reply_events (id TEXT PRIMARY KEY, created_at INTEGER NOT NULL)').run();
 await db.prepare('DELETE FROM line_reply_events WHERE created_at<?').bind(+now-7*day).run();
 const id=await eventKey(event);
 const claim=await db.prepare('INSERT OR IGNORE INTO line_reply_events (id,created_at) VALUES (?,?)').bind(id,+now).run();
 if(!claim.meta.changes)return;
 try{
  const messages=[];
  if(action.kind==='roster'){
   const selected=action.scope==='all'?clubs:[action.scope];
   const sections=await Promise.all(selected.map(club=>rosterSection(env,club,now)));
   const text='🏸 รอบตีที่กำลังจะถึง\n\n'+sections.join('\n\n━━━━━━━━━━\n\n')+
    '\n\nอัปเดต ณ '+thaiTime.format(now)+' น.\n'+selected.map(club=>'จอง / ถอน '+(club==='88'?'88':'Sena')+': '+urls[club]).join('\n');
   messages.push(...textMessages(text));
  }
  messages.push(menu(urls,action.kind==='roster'?action.scope:null));
  const response=await fetch('https://api.line.me/v2/bot/message/reply',{
   method:'POST',headers:{Authorization:'Bearer '+env.LINE_CHANNEL_ACCESS_TOKEN,'Content-Type':'application/json'},
   body:JSON.stringify({replyToken:event.replyToken,messages}),signal:AbortSignal.timeout(10000)
  });
  // Expired/used tokens and other permanent failures must never become Pushes.
  if(!response.ok&&response.status!==400)throw Error('LINE reply unavailable');
 }catch(error){
  await db.prepare('DELETE FROM line_reply_events WHERE id=?').bind(id).run();
  throw error;
 }
}
