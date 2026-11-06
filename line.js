import {bookingRoute} from './booking.js';

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
 for(const event of body.events){
  const group=event?.source?.groupId;
  if(event?.source?.type!=='group'||!/^C[a-f0-9]{32}$/i.test(group))continue;
  if(event.type==='leave'){
   await prepare(env.DB);
   await env.DB.prepare('UPDATE line_groups SET group_id=NULL WHERE group_id=?').bind(group).run();
   continue;
  }
  if(event.type!=='message'||event.message?.type!=='text')continue;
  const match=/^\/badbot\s+([a-f0-9]{32})$/i.exec(event.message.text.trim());
  if(!match)continue;
  await prepare(env.DB);
  await env.DB.prepare('UPDATE line_groups SET group_id=?, pair_code=NULL, expires_at=NULL WHERE pair_code=? AND expires_at>?')
   .bind(group,match[1].toLowerCase(),Date.now()).run();
 }
 return reply({ok:true});
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

export async function lineAdmin(req,env,admin,club){
 if(!admin)return reply({error:'กรุณาเข้าสู่ระบบผู้จัด'},401);
 if(!env.DB||!env.LINE_CHANNEL_SECRET||!env.LINE_CHANNEL_ACCESS_TOKEN)return reply({error:'ยังไม่ได้ตั้งค่า LINE Secrets ใน Cloudflare'},503);
 if(!['GET','POST'].includes(req.method))return reply({error:'Method not allowed'},405);
 await prepare(env.DB);
 if(req.method==='GET'){
  const row=await env.DB.prepare('SELECT group_id FROM line_groups WHERE club=?').bind(club).first();
  return reply({connected:!!row?.group_id});
 }
 let input;
 try{input=await req.json();}catch{return reply({error:'ข้อมูลไม่ถูกต้อง'},400);}
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
