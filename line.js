import {bookingRoute,bangkokDate} from './booking.js';
import {normalizeLineText,replyToGroupCommand} from './line-reply.js';

const reply=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
const encode=new TextEncoder();

async function prepare(db){
 await db.prepare('CREATE TABLE IF NOT EXISTS line_groups (club TEXT PRIMARY KEY, group_id TEXT, pair_code TEXT, expires_at INTEGER)').run();
}

export async function lineWebhook(req,env){
 if(req.method!=='POST')return reply({error:'Method not allowed'},405);
 if(!env.DB||!env.LINE_CHANNEL_SECRET)return reply({error:'Webhook is not configured'},503);
 const signature=req.headers.get('x-line-signature')||'';
 if(!/^[A-Za-z0-9+/]{43}=$/.test(signature))return reply({error:'Invalid signature'},401);
 const raw=await req.arrayBuffer();
 if(raw.byteLength>1024*1024)return reply({error:'Request too large'},413);
 const key=await crypto.subtle.importKey('raw',encode.encode(env.LINE_CHANNEL_SECRET),{name:'HMAC',hash:'SHA-256'},false,['verify']);
 const bytes=Uint8Array.from(atob(signature),c=>c.charCodeAt(0));
 if(!await crypto.subtle.verify('HMAC',key,bytes,raw))return reply({error:'Invalid signature'},401);
 let body;
 try{body=JSON.parse(new TextDecoder().decode(raw));}catch{return reply({error:'Invalid JSON'},400);}
 if(!Array.isArray(body?.events))return reply({error:'Invalid events'},400);
 let replyFailed=false;
 for(const event of body.events){
  const group=event?.source?.groupId;
  if(event?.source?.type!=='group'||typeof group!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(group))continue;
  if(event.type==='leave'){
   await prepare(env.DB);
   await env.DB.prepare('UPDATE line_groups SET group_id=NULL WHERE group_id=?').bind(group).run();
   continue;
  }
  const match=event.type==='message'&&event.message?.type==='text'&&/^\/badbot\s+([a-f0-9]{32})$/i.exec(normalizeLineText(event.message.text));
  if(match){
   await prepare(env.DB);
   await env.DB.prepare('UPDATE line_groups SET group_id=?, pair_code=NULL, expires_at=NULL WHERE pair_code=? AND expires_at>?')
    .bind(group,match[1].toLowerCase(),Date.now()).run();
   continue;
  }
  try{await replyToGroupCommand(event,env);}catch{replyFailed=true;}
 }
 return reply({ok:!replyFailed},replyFailed?503:200);
}

function rosterMessages(data,s,club,origin){
 const venue=club==='88'?'88':'Sena';
 const day=new Intl.DateTimeFormat('th-TH',{weekday:'short',day:'numeric',month:'short',year:'numeric',timeZone:'Asia/Bangkok'}).format(new Date(s.date+'T12:00:00+07:00'));
 const nameById=new Map(data.roster.map(p=>[p.id,[p.award,p.name].filter(Boolean).join(' ').replace(/\s+/g,' ')]));
 const names=status=>s.registrations.filter(r=>r.status===status).map(r=>`${r.position}. ${nameById.get(r.playerId)||'ผู้เล่นที่นำออกจากก๊วน'}`);
 const confirmed=names('confirmed'),waiting=names('waitlist');
 const lines=[`🏸 ${venue}${s.isCup?' Cup':''} · สรุปรายชื่อลงตี`,`${day} · ${s.start}–${s.end} น.`,'',
  `ตัวจริง ${s.confirmedCount}/${s.capacity} คน`,...(confirmed.length?confirmed:['ยังไม่มีรายชื่อ']),'',
  `สำรอง ${s.waitlistCount} คน`,...(waiting.length?waiting:['ยังไม่มีคิวสำรอง']),'',
  'ดูคิวล่าสุด: '+origin+'/court'+(club==='88'?'?club=88':'')+'#booking'];
 const chunks=[''];
 for(const line of lines){
  const i=chunks.length-1;
  if(chunks[i].length+line.length+1>4800)chunks.push(line);
  else chunks[i]+=(chunks[i]?'\n':'')+line;
 }
 return chunks.map(text=>({type:'text',text}));
}

async function diagnoseLine(req,env,expiresAt){
 const headers={Authorization:'Bearer '+env.LINE_CHANNEL_ACCESS_TOKEN};
 const api='https://api.line.me/v2/bot';
 try{
  const bot=await fetch(api+'/info',{headers});
  if(bot.status===401||bot.status===403)return 'LINE ไม่รับ Access Token กรุณาตรวจ LINE_CHANNEL_ACCESS_TOKEN';
  if(!bot.ok)return 'ตรวจข้อมูลบอทจาก LINE ไม่สำเร็จ (HTTP '+bot.status+')';
  const {displayName,basicId}=await bot.json();
  const label=[displayName,basicId].filter(Boolean).join(' ');
  const webhook=await fetch(api+'/channel/webhook/endpoint',{headers});
  if(webhook.status===404)return label+' · ยังไม่ได้ตั้ง Webhook URL';
  if(!webhook.ok)return label+' · อ่านการตั้งค่า Webhook ไม่ได้ (HTTP '+webhook.status+')';
  const {endpoint,active}=await webhook.json();
  const expected=new URL('/api/line/webhook',req.url).href;
  if(endpoint!==expected)return label+' · Webhook URL ต้องเป็น '+expected;
  if(!active)return label+' · กรุณาเปิด Use webhook ใน LINE Developers';
  const test=await fetch(api+'/channel/webhook/test',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:'{}'});
  if(!test.ok)return label+' · LINE ทดสอบ Webhook ไม่สำเร็จ (HTTP '+test.status+')';
  const result=await test.json();
  if(!result.success){
   if(result.statusCode===401)return label+' · Webhook ตอบ 401 ให้ตรวจว่า LINE_CHANNEL_SECRET ตรงกับ Channel นี้';
   return label+' · Webhook ทดสอบไม่ผ่าน'+(result.statusCode?' (HTTP '+result.statusCode+')':'');
  }
  if(!(expiresAt>Date.now()))return label+' · Webhook ผ่านแล้ว กรุณาสร้างคำสั่งใหม่ รหัสเดิมหมดอายุหรือยังไม่ได้สร้าง';
  return label+' · Webhook ผ่านแล้ว ให้เช็กว่าบอท @'+String(basicId||'').replace(/^@/,'')+' อยู่ในกลุ่ม แล้วคัดลอกคำสั่งเต็มไปส่งในกลุ่มนั้น';
 }catch{return 'ติดต่อ LINE เพื่อตรวจการตั้งค่าไม่สำเร็จ กรุณาลองอีกครั้ง';}
}

const autoDefaults={dailyLimit:3,summaryTime:'17:00'};
const publicOrigin='https://sena-web.thegsbnut.workers.dev';
const venues=['sena','88'];
const minute=60*1000;
const day=24*60*minute;
async function autoSettings(db){
 await db.prepare('CREATE TABLE IF NOT EXISTS line_auto_settings (id INTEGER PRIMARY KEY, daily_limit INTEGER NOT NULL, summary_time TEXT NOT NULL)').run();
 const row=await db.prepare('SELECT daily_limit,summary_time FROM line_auto_settings WHERE id=1').first();
 return row?{dailyLimit:row.daily_limit,summaryTime:row.summary_time}:autoDefaults;
}

const venueName=club=>club==='88'?'THE 88':'SENA COURT';
const separator='\n\n━━━━━━━━━━\n\n';
const sessionDate=new Intl.DateTimeFormat('th-TH',{weekday:'long',day:'numeric',month:'short',timeZone:'Asia/Bangkok'});
const cleanName=name=>name.replace(/\s+/g,' ').trim();

function sessionLabel({date,start,end}){
 const label=sessionDate.format(new Date(date+'T12:00:00+07:00'));
 return start&&end?`${label} · ${start}–${end} น.`:label;
}

function venueLink(club){
 return '🔗 เช็กคิว '+(club==='88'?'88':'Sena')+'\n'+publicOrigin+'/court'+(club==='88'?'?club=88':'')+'#booking';
}

function rosterText({confirmed,capacity,waiting,confirmedNames,waitingNames}){
 const numbered=names=>names?.map((name,i)=>`${i+1}. ${cleanName(name)}`)||[];
 const vacancy=confirmed>=capacity?'เต็ม':`ว่าง ${capacity-confirmed} ที่`;
 return [
  `🟢 ตัวจริง ${confirmed}/${capacity} · ${vacancy}`,...numbered(confirmedNames),
  '',waiting?`🟡 สำรอง ${waiting} คน`:'🟡 สำรอง: ไม่มี',...numbered(waitingNames)
 ].join('\n');
}

function autoMessage(title,sections,notice=''){
 const body=title+'\n\n'+sections.map(({text,club})=>text+'\n\n'+venueLink(club)).join(separator);
 if(body.length+notice.length<=4800)return body+notice;
 const footer='\n\n… ดูรายชื่อและรอบทั้งหมดบนเว็บ\n\n'+sections.map(({club})=>venueLink(club)).join('\n\n')+notice;
 return body.slice(0,4800-footer.length).replace(/[\uD800-\uDBFF]$/,'')+footer;
}

function alertText(changes,last,summarySent,summaryTime){
 const sections=[];
 for(const club of venues){
  const byDate=new Map();
  for(const change of changes.filter(item=>item.club===club)){
   if(!byDate.has(change.date))byDate.set(change.date,[]);
   byDate.get(change.date).push(change);
  }
  if(!byDate.size)continue;
  const rounds=[...byDate.keys()].sort().map(date=>{
   const events=byDate.get(date),latest=events.at(-1);
   const updates=[
    ['➕ ลงชื่อ',events.filter(item=>item.action==='book').map(item=>item.name)],
    ['➖ ถอนชื่อ',events.filter(item=>item.action==='cancel').map(item=>item.name)],
    ['⬆️ เลื่อนขึ้นตัวจริง',events.map(item=>item.promoted).filter(Boolean)]
   ].filter(([,names])=>names.length).map(([label,names])=>label+': '+names.map(cleanName).join(', '));
   return ['📅 '+sessionLabel(latest),updates.join('\n'),rosterText(latest)].join('\n\n');
  });
  sections.push({club,text:'📍 '+venueName(club)+'\n'+rounds.join('\n\n')});
 }
 const count=sections.length===2?'2 สนาม':`${new Set(changes.map(item=>item.date)).size} รอบ`;
 const notice=last?'\n\nครบโควตาแจ้งเตือนวันนี้แล้ว '+(summarySent?'ดูยอดล่าสุดได้ที่เว็บ':'กันไว้ 1 ครั้งสำหรับสรุป '+summaryTime+' น.'):'';
 return autoMessage('🏸 BADBOT · อัปเดตคิว '+count,sections,notice);
}

async function combinedSummary(env,now,summaryTime){
 const sections=await Promise.all(venues.map(async club=>{
  const response=await bookingRoute(new Request(publicOrigin+'/api/booking'),env,false,club);
  if(!response.ok)throw Error('Cannot read booking summary');
  const data=await response.json();
  const session=data.settings.enabled&&data.sessions.find(s=>!s.skipped&&Date.parse(s.date+'T'+s.start+':00+07:00')>+now);
  const heading='📍 '+venueName(club);
  if(!session)return {club,text:heading+'\nยังไม่มีรอบถัดไป'};
  const names=new Map(data.roster.map(p=>[p.id,[p.award,p.name].filter(Boolean).join(' ')]));
  const roster=status=>session.registrations.filter(r=>r.status===status).map(r=>names.get(r.playerId)||'ผู้เล่นที่นำออกจากก๊วน');
  const queues=rosterText({confirmed:session.confirmedCount,capacity:session.capacity,waiting:session.waitlistCount,
   confirmedNames:roster('confirmed'),waitingNames:roster('waitlist')});
  return {club,text:heading+(session.isCup?' · CUP':'')+'\n'+sessionLabel(session)+'\n\n'+queues};
 }));
 return autoMessage('🏸 BADBOT · สรุปคิว '+summaryTime,sections);
}
async function lineGet(token,path){
 const response=await fetch('https://api.line.me/v2/bot'+path,{headers:{Authorization:'Bearer '+token}});
 if(!response.ok)throw Error('Cannot check LINE quota');
 return response.json();
}

function quotaUsage(token){
 return Promise.all([lineGet(token,'/message/quota'),lineGet(token,'/message/quota/consumption')]);
}

async function availableQuota(token,group,reserve){
 const [[quota,usage],members]=await Promise.all([
  quotaUsage(token),lineGet(token,'/group/'+encodeURIComponent(group)+'/members/count')
 ]);
 if(quota.type==='none')return true;
 return Number.isFinite(quota.value)&&Number.isFinite(usage.totalUsage)&&members.count>0&&
  quota.value-usage.totalUsage>=members.count*(reserve?2:1);
}

export async function scheduledLine(env,now=new Date()){
 if(!env.DB||!env.LINE_CHANNEL_SECRET||!env.LINE_CHANNEL_ACCESS_TOKEN)return;
 const db=env.DB;
 await prepare(db);
 const {results:groups}=await db.prepare('SELECT club,group_id FROM line_groups WHERE group_id IS NOT NULL').all();
 const group=groups.find(row=>row.club==='sena')?.group_id;
 if(!group||groups.find(row=>row.club==='88')?.group_id!==group)return;
 const cfg=await autoSettings(db);
 const date=bangkokDate(now),start=Date.parse(date+'T00:00:00+07:00');
 const summaryAt=Date.parse(date+'T'+cfg.summaryTime+':00+07:00');
 await db.prepare('CREATE TABLE IF NOT EXISTS line_auto_jobs (date TEXT, slot TEXT, retry_key TEXT NOT NULL, group_id TEXT NOT NULL, content TEXT NOT NULL, cutoff INTEGER NOT NULL, sent INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(date,slot))').run();
 const {results:jobs}=await db.prepare('SELECT * FROM line_auto_jobs WHERE date=? ORDER BY cutoff').bind(date).all();
 const summary=jobs.find(job=>job.slot==='summary');
 const alerts=jobs.filter(job=>job.slot!=='summary');
 const {results:docs}=await db.prepare("SELECT club,payload FROM booking_clubs WHERE club IN ('sena','88')").all();
 const changes=docs.flatMap(row=>(JSON.parse(row.payload).lineChanges||[]).map(item=>({...item,club:row.club}))).sort((a,b)=>a.at-b.at);
 const summaryDue=+now>=summaryAt&&!summary?.sent&&changes.some(item=>item.at>=summaryAt-day&&item.at<summaryAt);
 const pending=changes.filter(item=>item.at>=start&&item.at>(alerts.at(-1)?.cutoff??start-1));
 let job=summaryDue?summary:alerts.find(item=>!item.sent);
 if(!summaryDue&&job&&alerts.length>cfg.dailyLimit-1)return;
 if(!summaryDue&&!job&&(alerts.length>=cfg.dailyLimit-1||!pending.length||+now-pending[0].at<10*minute))return;
 if(job&&job.group_id!==group)return;
 if(!await availableQuota(env.LINE_CHANNEL_ACCESS_TOKEN,group,!summaryDue&&!summary?.sent))return;
 if(!job){
  const slot=summaryDue?'summary':'alert-'+(alerts.length+1);
  const batch=summaryDue?[]:pending.filter(item=>item.at<=pending[0].at+10*minute);
  const cutoff=summaryDue?summaryAt:batch.at(-1).at;
  const content=summaryDue?await combinedSummary(env,now,cfg.summaryTime):alertText(batch,alerts.length===cfg.dailyLimit-2,!!summary?.sent,cfg.summaryTime);
  await db.prepare('INSERT OR IGNORE INTO line_auto_jobs (date,slot,retry_key,group_id,content,cutoff) VALUES (?,?,?,?,?,?)')
   .bind(date,slot,crypto.randomUUID(),group,content,cutoff).run();
  job=await db.prepare('SELECT * FROM line_auto_jobs WHERE date=? AND slot=?').bind(date,slot).first();
 }
 if(job.sent||job.group_id!==group)return;
 const response=await fetch('https://api.line.me/v2/bot/message/push',{
  method:'POST',headers:{Authorization:'Bearer '+env.LINE_CHANNEL_ACCESS_TOKEN,'Content-Type':'application/json','X-Line-Retry-Key':job.retry_key},
  body:JSON.stringify({to:group,messages:[{type:'text',text:job.content}]})
 });
 if(response.ok||(response.status===409&&response.headers.has('x-line-accepted-request-id'))){
  await db.prepare('UPDATE line_auto_jobs SET sent=1 WHERE date=? AND slot=?').bind(date,job.slot).run();
  await db.prepare('DELETE FROM line_auto_jobs WHERE date<?').bind(bangkokDate(new Date(+now-7*day))).run();
 }
}
export async function lineAdmin(req,env,admin,club){
 if(!admin)return reply({error:'กรุณาเข้าสู่ระบบผู้จัด'},401);
 if(!env.DB)return reply({error:'ยังไม่ได้ผูกฐานข้อมูล DB'},503);
 if(!env.LINE_CHANNEL_SECRET)return reply({error:'Worker ยังไม่เห็น LINE_CHANNEL_SECRET ใน Cloudflare'},503);
 if(!env.LINE_CHANNEL_ACCESS_TOKEN)return reply({error:'Worker ยังไม่เห็น LINE_CHANNEL_ACCESS_TOKEN ใน Cloudflare'},503);
 if(!['GET','POST'].includes(req.method))return reply({error:'Method not allowed'},405);
 if(req.method==='GET'&&new URL(req.url).searchParams.has('quota')){
  try{
   const [quota,usage]=await quotaUsage(env.LINE_CHANNEL_ACCESS_TOKEN);
   const used=usage.totalUsage;
   const limit=quota.type==='none'?null:quota.value;
   if(!Number.isSafeInteger(used)||used<0||
    (quota.type!=='none'&&(quota.type!=='limited'||!Number.isSafeInteger(limit)||limit<0)))throw Error('Invalid LINE quota');
   return reply({quota:{used,limit,remaining:limit===null?null:Math.max(0,limit-used)}});
  }catch{
   return reply({error:'อ่านโควต้าจาก LINE ไม่สำเร็จ กรุณาลองใหม่'},502);
  }
 }
 await prepare(env.DB);
 if(req.method==='GET'){
  const row=await env.DB.prepare('SELECT group_id,expires_at FROM line_groups WHERE club=?').bind(club).first();
  const connected=!!row?.group_id;
  const diagnosis=!connected&&new URL(req.url).searchParams.has('diagnose')?await diagnoseLine(req,env,row?.expires_at):null;
  return reply({connected,diagnosis,auto:await autoSettings(env.DB)});
 }
 let input;
 try{input=await req.json();}catch{return reply({error:'ข้อมูลไม่ถูกต้อง'},400);}
 if(input?.action==='autoSettings'){
  const {dailyLimit,summaryTime}=input;
  if(!Number.isInteger(dailyLimit)||dailyLimit<1||dailyLimit>10||typeof summaryTime!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(summaryTime))return reply({error:'กรอกโควตา 1–10 ครั้งและเวลาสรุปให้ถูกต้อง'},400);
  await autoSettings(env.DB);
  await env.DB.prepare('INSERT INTO line_auto_settings (id,daily_limit,summary_time) VALUES (1,?,?) ON CONFLICT(id) DO UPDATE SET daily_limit=excluded.daily_limit,summary_time=excluded.summary_time')
   .bind(dailyLimit,summaryTime).run();
  return reply({message:'บันทึกการส่งอัตโนมัติสำหรับทั้งสองสนามแล้ว'});
 }
 if(input?.action==='pair'){
  const code=crypto.randomUUID().replaceAll('-','');
  await env.DB.prepare('INSERT INTO line_groups (club,pair_code,expires_at) VALUES (?,?,?) ON CONFLICT(club) DO UPDATE SET pair_code=excluded.pair_code,expires_at=excluded.expires_at')
   .bind(club,code,Date.now()+10*60*1000).run();
  return reply({code});
 }
 if(input?.action!=='send'||typeof input.sessionId!=='string')return reply({error:'ข้อมูลไม่ถูกต้อง'},400);
 const row=await env.DB.prepare('SELECT group_id FROM line_groups WHERE club=?').bind(club).first();
 if(!row?.group_id)return reply({error:'เชื่อมกลุ่ม LINE ของสนามนี้ก่อน'},409);
 const response=await bookingRoute(new Request(req.url),env,false,club);
 if(!response.ok)return response;
 const data=await response.json();
 const s=data.sessions.find(item=>item.id===input.sessionId&&!item.skipped);
 if(!s)return reply({error:'ไม่พบรอบตีที่ส่งได้'},404);
 const messages=rosterMessages(data,s,club,new URL(req.url).origin);
 if(messages.length>5)return reply({error:'รายชื่อยาวเกินจำนวนที่ LINE รับต่อครั้ง'},400);
 const result=await fetch('https://api.line.me/v2/bot/message/push',{
  method:'POST',headers:{Authorization:'Bearer '+env.LINE_CHANNEL_ACCESS_TOKEN,'Content-Type':'application/json'},
  body:JSON.stringify({to:row.group_id,messages})
 });
 if(!result.ok)return reply({error:'LINE ส่งไม่สำเร็จ กรุณาตรวจโควตา กลุ่ม และ Access Token'},502);
 return reply({message:'ส่งสรุปเข้ากลุ่ม LINE แล้ว'});
}
