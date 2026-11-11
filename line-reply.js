import {mentionMessage} from './line-mentions.js';
import {memberMode,liffUrl} from './member.js';
import {billingLineText,billingLineMessages} from './billing.js';
import {bookingRoute} from './booking.js';
import {latestCup,leaderboardRoute} from './leaderboard.js';

const defaultBookingUrl='https://sena-web.thegsbnut.workers.dev/court#booking';
const clubs=['sena','88'];
const day=86400000;
const thaiDay=new Intl.DateTimeFormat('th-TH',{weekday:'long',day:'numeric',month:'short',year:'numeric',timeZone:'Asia/Bangkok'});
const thaiTime=new Intl.DateTimeFormat('th-TH',{hour:'2-digit',minute:'2-digit',hour12:false,timeZone:'Asia/Bangkok'});
export const normalizeLineText=text=>String(text??'').normalize('NFKC').replace(/[\u200b\u200e\u200f\ufeff]/g,'').trim();

const shortcuts=new Map([
 ['tagtest',{kind:'tagTest',description:'ทดสอบแท็กบัญชีผู้พิมพ์คำสั่งโดยตรง'}],
 ['book 88',{kind:'book',club:'88',description:'ลิงก์จอง 88'}],
 ['book sena',{kind:'book',club:'sena',description:'ลิงก์จอง Sena'}],
 ['list',{kind:'roster',scope:'all',description:'รายชื่อทั้งสองสนาม'}],
 ['list 88',{kind:'roster',scope:'88',description:'รายชื่อ 88'}],
 ['list sena',{kind:'roster',scope:'sena',description:'รายชื่อ Sena'}],
 ['matchup sena',{kind:'matchup',description:'คู่ตีรอบปกติ Sena'}],
 ['matchup 88cup',{kind:'cupMatchup',club:'88',description:'ตารางแข่ง 88 Cup'}],
 ['matchup senacup',{kind:'cupMatchup',club:'sena',description:'ตารางแข่ง Sena Cup'}],
 ['senacup',{kind:'cupResult',club:'sena',description:'ผล Sena Cup ล่าสุด'}],
 ['88cup',{kind:'cupResult',club:'88',description:'ผล 88 Cup ล่าสุด'}],
 ['leaderboard',{kind:'leaderboard',scope:'all',description:'5 อันดับแรกของทั้งสองสนาม'}],
 ['leaderboard sena',{kind:'leaderboard',scope:'sena',description:'5 อันดับแรกของ Sena'}],
 ['leaderboard 88',{kind:'leaderboard',scope:'88',description:'5 อันดับแรกของ 88'}],
 ['bill',{kind:'bill',scope:'all',description:'คนที่ยังไม่จ่ายทั้งสองสนาม'}],
 ['bill 88',{kind:'bill',scope:'88',description:'คนที่ยังไม่จ่ายสนาม 88'}],
 ['bill sena',{kind:'bill',scope:'sena',description:'คนที่ยังไม่จ่ายสนาม Sena'}],
 ['help',{kind:'help',description:'รายการคำสั่ง'}]
]);

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
 const action=(match[1]||'').trim().toLowerCase().replace(/\s+/g,' ');
 if(/^tagtest\s+/.test(action))return {kind:'tagTest',friends:true};
 if(shortcuts.has(action))return shortcuts.get(action);
 // Pairing codes are consumed by the existing administrator-only pairing flow.
 if(/^[a-f0-9]{32}$/i.test(action))return null;
 const roster=/^(?:รายชื่อ|ดูรายชื่อ|ดูผู้ตี|ผู้ตี|ดูรายชื่อผู้เล่น)(?:\s+(ทั้งหมด|ทุกสนาม|all|sena|เสนา|88))?$/i.exec(action);
 if(!roster)return {kind:'menu'};
 const venue=(roster[1]||'all').toLowerCase();
 return {kind:'roster',scope:venue==='88'?'88':['sena','เสนา'].includes(venue)?'sena':'all'};
}

function bookingUrl(env,club='sena'){
 if(memberMode(env)&&env.LINE_LIFF_ID)return liffUrl(env,club);
 return courtUrl(env,club);
}
function courtUrl(env,club='sena'){
 const url=new URL(env.LINE_BOOKING_URL||defaultBookingUrl);
 if(url.protocol!=='https:'||url.username||url.password)throw Error('Invalid booking URL');
 if(club==='88')url.searchParams.set('club','88');else url.searchParams.delete('club');
 return url.href;
}

function menu(urls){
 const link=club=>({type:'button',style:'primary',color:'#168B42',action:{type:'uri',label:'🏸 จอง / ถอน '+(club==='88'?'88':'Sena'),uri:urls[club]}});
 const postback=(label,data,displayText)=>({type:'button',style:'secondary',action:{type:'postback',label,data,displayText}});
 const buttons=[
  ...clubs.map(link),
  postback('👥 ผู้ตีทุกสนาม','badbot:roster:all','👥 ขอรายชื่อผู้ตีทุกสนาม'),
  postback('👥 ผู้ตี Sena','badbot:roster:sena','👥 ขอรายชื่อผู้ตี Sena'),
  postback('👥 ผู้ตี 88','badbot:roster:88','👥 ขอรายชื่อผู้ตี 88')
 ];
 return {type:'flex',altText:'SENA Badbot · จอง / ถอนชื่อ และดูรายชื่อผู้ตี',contents:{
  type:'bubble',body:{type:'box',layout:'vertical',spacing:'md',contents:[
   {type:'text',text:'🏸 SENA Badbot',weight:'bold',size:'lg',wrap:true},
   {type:'text',text:'เลือกสนามเพื่อจอง / ถอน หรือดูรายชื่อผู้ตี',size:'sm',wrap:true}
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

function displayNames(data,session){
 const names=new Map(data.roster.map(p=>[p.id,clean([p.award,p.name].filter(Boolean).join(' '))]));
 for(const r of session.registrations){
  if(r.invitedBy)names.set(r.playerId,(names.get(r.playerId)||'ผู้เล่น')+' (จองโดย '+(names.get(r.invitedBy)||'สมาชิก')+' · จ่ายแทน)');
  if(r.guest)names.set(r.playerId,clean(r.guest.name)+' (แขกของ '+(names.get(r.guest.hostId)||'สมาชิก')+')');
 }
 return id=>names.get(id)||'ผู้เล่นที่นำออกจากก๊วน';
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
 const name=displayNames(data,session);
 const numbered=status=>session.registrations.filter(r=>r.status===status)
  .sort((a,b)=>a.position-b.position)
  .map((r,i)=>`${i+1}. ${name(r.playerId)}`);
 const confirmed=numbered('confirmed'),waiting=numbered('waitlist');
 const vacancy=session.closed?'ปิดรับจอง':session.confirmedCount>=session.capacity?'เต็ม':`เหลือ ${session.capacity-session.confirmedCount} ที่`;
 return boundedSection([
  heading+(session.isCup?' · CUP':''),
  thaiDay.format(new Date(session.date+'T12:00:00+07:00'))+` · ${session.start}–${session.end} น.${session.courtNumbers?' · คอร์ต '+session.courtNumbers:''}`,
  `👥 ผู้ตี ${session.confirmedCount}/${session.capacity} คน · ${vacancy}`,
  ...confirmed.length?confirmed:['ยังไม่มีผู้ลงชื่อ'],
  '',waiting.length?`⏳ สำรอง ${session.waitlistCount} คน`:'⏳ สำรอง: ไม่มี',...waiting
 ]);
}

async function shortcutText(action,env,urls){
 const club=action.club;
 const cupName=club==='88'?'88 Cup':'Sena Cup';
 if(action.kind==='help')return ['🏸 คำสั่ง Badbot',...[...shortcuts].map(([key,value])=>'badbot '+key+' · '+value.description)].join('\n');
 if(action.kind==='bill')return billingLineText(env,action.scope,new URL(urls.sena).origin);
 if(action.kind==='book')return '🏸 จอง / ถอน '+(club==='88'?'88':'Sena')+'\n'+urls[club];
 if(action.kind==='matchup'){
  const response=await bookingRoute(new Request('https://badbot.internal/api/booking'),env,false,'sena');
  if(!response.ok)return 'อ่านตารางคู่ตี Sena ไม่สำเร็จ';
  const data=await response.json();
  const session=data.settings.enabled&&data.sessions.find(s=>!s.skipped&&!s.isCup);
  if(!session)return 'ยังไม่มีรอบปกติถัดไปของ Sena';
  const date=thaiDay.format(new Date(session.date+'T12:00:00+07:00'));
  const heading='🏸 คู่ตี Sena · '+date+` · ${session.start}–${session.end} น.`+(session.courtNumbers?' · คอร์ต '+session.courtNumbers:'');
  if(session.closed||!session.schedule?.schedule?.length)return heading+'\nตารางคู่ยังไม่พร้อม';
  const name=displayNames(data,session);
  return boundedSection([heading,...session.schedule.schedule.map(m=>'เกม '+m.round+' · '+m.ids.slice(0,2).map(name).join(' / ')+' vs '+m.ids.slice(2).map(name).join(' / '))]);
 }
 if(action.kind==='cupMatchup'){
  const table=club==='88'?'club_state_88':'club_state';
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS ${table} (id INTEGER PRIMARY KEY, revision INTEGER NOT NULL, payload TEXT NOT NULL, updated_at TEXT NOT NULL)`).run();
  const row=await env.DB.prepare(`SELECT payload FROM ${table} WHERE id=1`).first();
  const cup=row?JSON.parse(row.payload).cup:null;
  if(!cup?.matches?.length||cup.matches.every(m=>Number.isInteger(m.sa)&&Number.isInteger(m.sb)&&m.sa!==m.sb))return 'ยังไม่มีตาราง '+cupName+' ที่กำลังรอแข่ง';
  return boundedSection(['🏸 ตาราง '+cupName,...cup.matches.map((m,i)=>'เกม '+(i+1)+' · '+cup.teams[m.a].map(clean).join(' / ')+' vs '+cup.teams[m.b].map(clean).join(' / ')+(i>0&&globalThis.Sena.cupRestConflicts(cup.matches.slice(i-1,i+1))?' · เว้นพักก่อนเกมนี้':''))]);
 }
 if(action.kind==='cupResult'){
  const cup=await latestCup(env.DB,club);
  if(!cup)return 'ยังไม่มีผล '+cupName+' ที่บันทึกไว้';
  const rows=globalThis.Sena.standings(cup.teams,cup.matches);
  let previous,rank;
  return boundedSection(['🏆 ผล '+clean(cup.title),thaiDay.format(new Date(cup.date+'T12:00:00+07:00')),...rows.map((row,i)=>{
   if(!previous||row.w!==previous.w||row.pf-row.pa!==previous.pf-previous.pa||row.pf!==previous.pf)rank=i+1;
   previous=row;
   return (rank===1?'🥇 ':'')+rank+'. '+clean(row.name)+' · ชนะ '+row.w+'/'+row.played+' · แต้ม '+row.pf+'–'+row.pa;
  })]);
 }
 const selected=action.scope==='all'?clubs:[action.scope];
 const sections=await Promise.all(selected.map(club=>leaderboardSection(env,club,courtUrl(env,club))));
 return sections.join('\n\n━━━━━━━━━━\n\n');
}

async function leaderboardSection(env,club,url){
 const heading='🏆 '+(club==='88'?'88':'Sena')+' Leaderboard';
 const response=await leaderboardRoute(new Request('https://badbot.internal/api/leaderboard'),env,false,club);
 if(!response.ok)return heading+'\nอ่านอันดับไม่สำเร็จ';
 const {standings}=await response.json();
 const link=new URL(url);
 link.hash='leaderboard';
 const topFive=standings.slice(0,5).map((row,i)=>(row.position??i+1)+'. '+clean(row.name)+' · ชนะ '+row.w+'/'+row.played);
 return [heading,...(topFive.length?topFive:['ยังไม่มีข้อมูลอันดับ']), 'ดูอันดับทั้งหมด: '+link.href].join('\n');
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
  const messages=[],mentionDiagnostics=[];
  if(action.kind==='tagTest'){
   if(action.friends){
    const ids=[...new Set((event.message.mention?.mentionees||[]).filter(m=>m.type==='user'&&!m.isSelf&&/^U[a-f0-9]{32}$/.test(m.userId||'')).map(m=>m.userId))].slice(0,20);
    if(!ids.length)messages.push({type:'text',text:'พิมพ์ badbot tagtest แล้วพิมพ์ @ และแตะเลือกชื่อเพื่อนจากรายชื่อของ LINE ก่อนส่ง แค่พิมพ์ @ชื่อเป็นตัวหนังสือจะทดสอบไม่ได้'});
    else{
     messages.push(mentionMessage(ids,'ทดสอบแท็กเพื่อน: ','\nลองแตะชื่อและให้เพื่อนตรวจการแจ้งเตือนการกล่าวถึง'));
    }
   }else{
   const userId=event.source.userId;
   if(!/^U[a-f0-9]{32}$/.test(userId||'')){
    messages.push({type:'text',text:'LINE ไม่ส่งรหัสบัญชีของผู้พิมพ์มา จึงยังทดสอบแท็กไม่ได้'});
   }else{
    const substitution={you:{type:'mention',mentionee:{type:'user',userId}}};
    messages.push({type:'textV2',text:'ทดสอบแท็กผู้พิมพ์คำสั่ง: {you}\nลองแตะชื่อและตรวจการแจ้งเตือนการกล่าวถึง',substitution});
   }
   }
  }else if(action.kind==='roster'){
   const selected=action.scope==='all'?clubs:[action.scope];
   const sections=await Promise.all(selected.map(club=>rosterSection(env,club,now)));
   const text='🏸 รอบตีที่กำลังจะถึง\n\n'+sections.join('\n\n━━━━━━━━━━\n\n')+
    '\n\nอัปเดต ณ '+thaiTime.format(now)+' น.';
   messages.push(...textMessages(text));
  }else if(action.kind==='bill'&&memberMode(env)&&env.LINE_LIFF_ID){
   messages.push(...await billingLineMessages(env,action.scope,new URL(urls.sena).origin,group,mentionDiagnostics));
  }else if(action.kind==='menu'){
   messages.push(menu(urls));
  }else{
   messages.push(...textMessages(await shortcutText(action,env,urls)));
  }
  const response=await fetch('https://api.line.me/v2/bot/message/reply',{
   method:'POST',headers:{Authorization:'Bearer '+env.LINE_CHANNEL_ACCESS_TOKEN,'Content-Type':'application/json'},
   body:JSON.stringify({replyToken:event.replyToken,messages}),signal:AbortSignal.timeout(10000)
  });
  if(action.kind==='bill')try{
   await db.prepare('CREATE TABLE IF NOT EXISTS line_bill_diagnostics (group_id TEXT PRIMARY KEY,payload TEXT NOT NULL,updated_at TEXT NOT NULL)').run();
   const report={replyStatus:response.status,mentionCount:messages.reduce((n,m)=>n+Object.values(m.substitution||{}).filter(v=>v.type==='mention').length,0),messageTypes:messages.map(m=>m.type),payers:mentionDiagnostics};
   await db.prepare('INSERT INTO line_bill_diagnostics VALUES(?,?,?) ON CONFLICT(group_id) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at').bind(group,JSON.stringify(report),new Date().toISOString()).run();
  }catch{console.error('Unable to store bill mention diagnostic');}
  // Expired/used tokens and other permanent failures must never become Pushes.
  if(!response.ok&&response.status!==400)throw Error('LINE reply unavailable');
 }catch(error){
  await db.prepare('DELETE FROM line_reply_events WHERE id=?').bind(id).run();
  throw error;
 }
}
