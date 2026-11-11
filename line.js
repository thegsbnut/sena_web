import {billingLineMessages} from './billing.js';
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

export async function lineAdmin(req,env,admin,club){
 if(!admin)return reply({error:'กรุณาเข้าสู่ระบบผู้จัด'},401);
 if(!env.DB)return reply({error:'ยังไม่ได้ผูกฐานข้อมูล DB'},503);
 if(!env.LINE_CHANNEL_SECRET)return reply({error:'Worker ยังไม่เห็น LINE_CHANNEL_SECRET ใน Cloudflare'},503);
 if(!env.LINE_CHANNEL_ACCESS_TOKEN)return reply({error:'Worker ยังไม่เห็น LINE_CHANNEL_ACCESS_TOKEN ใน Cloudflare'},503);
 if(!['GET','POST'].includes(req.method))return reply({error:'Method not allowed'},405);
 await prepare(env.DB);
 if(req.method==='GET'){
  const row=await env.DB.prepare('SELECT group_id,expires_at FROM line_groups WHERE club=?').bind(club).first();
  const connected=!!row?.group_id;
  if(new URL(req.url).searchParams.has('mentionDiagnostics')){
   if(!connected)return reply({error:'สนามนี้ยังไม่เชื่อมกลุ่ม LINE'},409);
   const payers=[],messages=await billingLineMessages(env,club,new URL(req.url).origin,row.group_id,payers);
   if(!messages)return reply({error:'ยังไม่เปิดโหมดสมาชิก LINE'},409);
   let validation={status:0,message:'ติดต่อ LINE เพื่อตรวจรูปแบบไม่ได้'};
   try{
    const result=await fetch('https://api.line.me/v2/bot/message/validate/reply',{method:'POST',headers:{Authorization:'Bearer '+env.LINE_CHANNEL_ACCESS_TOKEN,'Content-Type':'application/json'},body:JSON.stringify({messages}),signal:AbortSignal.timeout(10000)});
    validation={status:result.status};if(!result.ok){const data=await result.json();validation.message=String(data.message||'LINE ไม่รับรูปแบบข้อความ').slice(0,240);}
   }catch{}
   let webhook={checked:false};
   try{
    const result=await fetch('https://api.line.me/v2/bot/channel/webhook/endpoint',{headers:{Authorization:'Bearer '+env.LINE_CHANNEL_ACCESS_TOKEN},signal:AbortSignal.timeout(10000)});
    if(result.ok){const data=await result.json();webhook={checked:true,active:data.active,endpointMatches:data.endpoint===new URL('/api/line/webhook',req.url).href};}
   }catch{}
   const table=await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='line_bill_diagnostics'").first();
   const latest=table?await env.DB.prepare('SELECT payload,updated_at FROM line_bill_diagnostics WHERE group_id=?').bind(row.group_id).first():null;
   return reply({webhook,validation,mentionCount:messages.reduce((n,m)=>n+Object.keys(m.substitution||{}).length,0),payers,latest:latest?{...JSON.parse(latest.payload),updatedAt:latest.updated_at}:null});
  }
  const diagnosis=!connected&&new URL(req.url).searchParams.has('diagnose')?await diagnoseLine(req,env,row?.expires_at):null;
  return reply({connected,diagnosis});
 }
 let input;
 try{input=await req.json();}catch{return reply({error:'ข้อมูลไม่ถูกต้อง'},400);}
 if(input?.action==='pair'){
  const code=crypto.randomUUID().replaceAll('-','');
  await env.DB.prepare('INSERT INTO line_groups (club,pair_code,expires_at) VALUES (?,?,?) ON CONFLICT(club) DO UPDATE SET pair_code=excluded.pair_code,expires_at=excluded.expires_at')
   .bind(club,code,Date.now()+10*60*1000).run();
  return reply({code});
 }
 return reply({error:'ข้อมูลไม่ถูกต้อง'},400);
}
