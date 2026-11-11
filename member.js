import {mapBoth,MappingError} from './member-shared.js';
const json=(data,status=200,headers={})=>Response.json(data,{status,headers:{'Cache-Control':'no-store','Referrer-Policy':'no-referrer',...headers}});
export const memberMode=env=>env.LINE_MEMBER_AUTH_ENABLED==='true';
export const loginEnabled=env=>memberMode(env)||env.LINE_LOGIN_ENABLED==='true';
export const liffUrl=(env,club='sena',page='book',bill='')=>{
 const url=new URL('https://liff.line.me/'+env.LINE_LIFF_ID);
 url.searchParams.set('club',club);url.searchParams.set('page',page);if(bill)url.searchParams.set('bill',bill);return url.href;
};
const random=()=>crypto.randomUUID().replaceAll('-','')+crypto.randomUUID().replaceAll('-','');
const hash=async text=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),x=>x.toString(16).padStart(2,'0')).join('');
const cookie=(req,name)=>(req.headers.get('Cookie')||'').split(';').map(s=>s.trim()).find(s=>s.startsWith(name+'='))?.slice(name.length+1)||'';
const sessionCookie=value=>'__Host-sena-member='+value+'; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age='+(value?604800:0);
export async function prepareMembers(db){
 await db.prepare('CREATE TABLE IF NOT EXISTS member_profiles (user_id TEXT PRIMARY KEY,line_name TEXT NOT NULL)').run();
 await db.prepare('CREATE TABLE IF NOT EXISTS member_sessions (token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL,expires_at INTEGER NOT NULL)').run();
 await db.prepare('CREATE TABLE IF NOT EXISTS member_links (user_id TEXT NOT NULL,club TEXT NOT NULL,player_id TEXT,name TEXT NOT NULL,kind TEXT NOT NULL,status TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(user_id,club))').run();
 await db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS member_player_unique ON member_links(club,player_id) WHERE status='approved'").run();
}
export async function memberFor(req,env,club){
 if(!env.DB||!loginEnabled(env))return null;
 const token=cookie(req,'__Host-sena-member');if(!/^[a-f0-9]{64}$/.test(token))return null;
 await prepareMembers(env.DB);
 const session=await env.DB.prepare('SELECT user_id FROM member_sessions WHERE token_hash=? AND expires_at>?').bind(await hash(token),Date.now()).first();
 if(!session)return null;
 let link=await env.DB.prepare('SELECT player_id,name,kind,status FROM member_links WHERE user_id=? AND club=?').bind(session.user_id,club).first();
 const otherClub=club==='sena'?'88':'sena';
 const other=await env.DB.prepare('SELECT player_id,name,kind,status FROM member_links WHERE user_id=? AND club=?').bind(session.user_id,otherClub).first();
 const anchor=link?.status==='approved'||link?.status==='pending'&&link.kind==='existing'?{club,link}
  :other?.status==='approved'||other?.status==='pending'&&other.kind==='existing'?{club:otherClub,link:other}:null;
 let mappingError=null;
 if(anchor&&(link?.status!=='approved'||other?.status!=='approved'))try{
  await mapBoth(env.DB,session.user_id,anchor.club,anchor.link.player_id);
  link=await env.DB.prepare('SELECT player_id,name,kind,status FROM member_links WHERE user_id=? AND club=?').bind(session.user_id,club).first();
 }catch(error){if(!(error instanceof MappingError))throw error;mappingError=error.message;}
 return {userId:session.user_id,link:link||null,mappingError};
}

async function roster(db,club){
 const table=club==='88'?'club_state_88':'club_state';
 await db.prepare(`CREATE TABLE IF NOT EXISTS ${table} (id INTEGER PRIMARY KEY,revision INTEGER NOT NULL,payload TEXT NOT NULL,updated_at TEXT NOT NULL)`).run();
 const row=await db.prepare(`SELECT revision,payload FROM ${table} WHERE id=1`).first();
 return {row,table,state:row?JSON.parse(row.payload):{players:[],selected:[],rounds:10,locks:[],result:null,cup:null}};
}
export async function memberRoute(req,env,admin,club){
 try{return await route(req,env,admin,club);}catch(error){if(error instanceof MappingError)return json({error:error.message},409);throw error;}
}
async function route(req,env,admin,club){
 if(!env.DB)return json({error:'ระบบสมาชิกยังไม่พร้อม'},503);
 if(!['GET','POST'].includes(req.method))return json({error:'Method not allowed'},405);
 await prepareMembers(env.DB);
 const url=new URL(req.url),action=url.pathname.split('/').at(-1);
 if(req.method==='GET'&&action==='member'){
  const member=await memberFor(req,env,club),csrf=random();
  return json({enabled:loginEnabled(env),requireLogin:memberMode(env),configured:Boolean(env.LINE_LIFF_ID&&env.LINE_LOGIN_CHANNEL_ID),liffId:env.LINE_LIFF_ID||null,csrf,loggedIn:Boolean(member),mappingError:member?.mappingError||null,link:member?.link||null},200,{'Set-Cookie':'__Host-sena-member-csrf='+csrf+'; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=600'});
 }
 if(req.method==='GET'&&action==='choices'){
  const member=await memberFor(req,env,club);if(!member)return json({error:'กรุณาเข้าสู่ระบบ LINE'},401);
  const states={},taken={};
  for(const c of ['sena','88']){
   states[c]=(await roster(env.DB,c)).state;
   const rows=await env.DB.prepare("SELECT player_id FROM member_links WHERE club=? AND status='approved' AND user_id<>?").bind(c,member.userId).all();
   taken[c]=new Set(rows.results.map(r=>r.player_id));
  }
  const names=new Set(),players=[];
  for(const c of [club,club==='sena'?'88':'sena'])for(const p of states[c].players){
   const key=p.name.normalize('NFC').trim().toLowerCase();
   if(names.has(key))continue;
   const blocked=['sena','88'].some(v=>states[v].players.some(x=>x.name.normalize('NFC').trim().toLowerCase()===key&&taken[v].has(x.id)));
   if(blocked)continue;
   names.add(key);players.push({id:p.id,name:p.name,club:c});
  }
  return json({players});
 }
 if(req.method==='GET'&&action==='requests'){
  if(!admin)return json({error:'กรุณาเข้าสู่ระบบผู้จัด'},401);
  const rows=await env.DB.prepare("SELECT l.user_id,l.player_id,l.name,l.kind,l.status,l.created_at,p.line_name FROM member_links l LEFT JOIN member_profiles p ON p.user_id=l.user_id WHERE l.club=? ORDER BY l.created_at DESC").bind(club).all();
  const {state}=await roster(env.DB,club);
  return json({requests:rows.results.map(r=>({...r,name:state.players.find(p=>p.id===r.player_id)?.name||r.name})),players:state.players.map(({id,name})=>({id,name}))});
 }
 if(req.method==='POST'&&action==='login'){
  if(!loginEnabled(env)||!env.LINE_LIFF_ID||!env.LINE_LOGIN_CHANNEL_ID)return json({error:'ยังไม่ได้เปิด LINE Login'},503);
  const csrf=cookie(req,'__Host-sena-member-csrf');
  if(!/^[a-f0-9]{64}$/.test(csrf)||req.headers.get('X-Member-CSRF')!==csrf)return json({error:'กรุณาโหลดหน้าเข้าสู่ระบบใหม่'},403);
  const raw=await req.text();if(raw.length>12000)return json({error:'ข้อมูลยาวเกินไป'},413);
  let input;try{input=JSON.parse(raw);}catch{return json({error:'ข้อมูลไม่ถูกต้อง'},400);}
 if(!input||typeof input!=='object'||Array.isArray(input))return json({error:'ข้อมูลไม่ถูกต้อง'},400);
  if(typeof input.idToken!=='string'||input.idToken.length>10000)return json({error:'ไม่พบหลักฐาน LINE Login'},400);
  const verified=await fetch('https://api.line.me/oauth2/v2.1/verify',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({id_token:input.idToken,client_id:env.LINE_LOGIN_CHANNEL_ID}),signal:AbortSignal.timeout(10000)});
  if(!verified.ok)return json({error:'LINE Login หมดอายุหรือไม่ถูกต้อง กรุณาเข้าสู่ระบบใหม่'},401);
  const profile=await verified.json();
  if(profile.iss!=='https://access.line.me'||String(profile.aud)!==String(env.LINE_LOGIN_CHANNEL_ID)||!Number.isFinite(profile.exp)||profile.exp*1000<=Date.now()||!/^U[a-f0-9]{32}$/.test(profile.sub))return json({error:'LINE Login ไม่ถูกต้อง'},401);
  await env.DB.prepare('INSERT INTO member_profiles VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET line_name=excluded.line_name').bind(profile.sub,typeof profile.name==='string'?profile.name.slice(0,200):'').run();
  const old=cookie(req,'__Host-sena-member');
  if(/^[a-f0-9]{64}$/.test(old))await env.DB.prepare('DELETE FROM member_sessions WHERE token_hash=?').bind(await hash(old)).run();
  await env.DB.prepare('DELETE FROM member_sessions WHERE expires_at<=?').bind(Date.now()).run();
  const token=random();await env.DB.prepare('INSERT INTO member_sessions VALUES(?,?,?)').bind(await hash(token),profile.sub,Date.now()+604800000).run();
  return json({ok:true},200,{'Set-Cookie':sessionCookie(token)});
 }
 const member=await memberFor(req,env,club);
 if(req.method==='POST'&&action==='logout'){
  await env.DB.prepare('DELETE FROM member_sessions WHERE token_hash=?').bind(await hash(cookie(req,'__Host-sena-member'))).run();
  return json({ok:true},200,{'Set-Cookie':sessionCookie('')});
 }
 if(req.method==='GET'&&action==='bills'){
  if(!member)return json({error:'กรุณาเข้าสู่ระบบ LINE'},401);
  if(member.link?.status!=='approved')return json({bills:[]});
  const exists=await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='bills'").first();
  if(!exists)return json({bills:[]});
  const rows=await env.DB.prepare('SELECT id,payload,session_date FROM bills WHERE club=? ORDER BY session_date DESC LIMIT 200').bind(club).all();
  const bills=[];
  for(const row of rows.results){
   if(url.searchParams.has('bill')&&url.searchParams.get('bill')!==row.id)continue;
   const bill=JSON.parse(row.payload);if(bill.cancelled)continue;
   for(const p of bill.payers)if(p.payerKey==='member:'+member.link.player_id){
    const link=new URL('/billing.html',req.url);link.searchParams.set('bill',row.id);link.searchParams.set('club',club);link.hash='pay='+p.token;
    bills.push({id:row.id,date:row.session_date.slice(0,10),name:p.name,amount:p.amount,status:p.status,url:link.href});
   }
  }
  return json({bills});
 }
 if(req.method!=='POST')return json({error:'Not found'},404);
 const raw=await req.text();if(raw.length>6000)return json({error:'ข้อมูลยาวเกินไป'},413);
 let input;try{input=JSON.parse(raw);}catch{return json({error:'ข้อมูลไม่ถูกต้อง'},400);}
 if(!input||typeof input!=='object'||Array.isArray(input))return json({error:'ข้อมูลไม่ถูกต้อง'},400);
 if(action==='link'){
  if(!member)return json({error:'กรุณาเข้าสู่ระบบ LINE'},401);
  const sourceClub=input.sourceClub??club;
  if(!['sena','88'].includes(sourceClub))return json({error:'สนามไม่ถูกต้อง'},400);
  const {state}=await roster(env.DB,sourceClub),player=state.players.find(p=>p.id===input.playerId);
  if(!player||input.name!==undefined)return json({error:'ช่วงเก็บตกให้เลือกชื่อผู้เล่นเดิมเท่านั้น'},400);
  await mapBoth(env.DB,member.userId,sourceClub,player.id);
  return json({ok:true});
 }
 if(['reassign','revoke','unlink'].includes(action)){
  if(!admin)return json({error:'กรุณาเข้าสู่ระบบผู้จัด'},401);
  if(typeof input.previousStatus!=='string'||!(input.previousPlayerId===null||typeof input.previousPlayerId==='string'))return json({error:'กรุณาโหลดการแมพล่าสุดก่อนแก้ไข'},400);
 }
 if(action==='reassign'){
  if(typeof input.userId!=='string'||!/^U[a-f0-9]{32}$/.test(input.userId))return json({error:'เลือกบัญชี LINE ที่มีในระบบ'},400);
  await mapBoth(env.DB,input.userId,club,input.playerId,{allowMove:true,expected:{playerId:input.previousPlayerId,status:input.previousStatus}});
  return json({ok:true});
 }
 if(action==='unlink'||action==='revoke'){
  await mapBoth(env.DB,input.userId,club,null,{remove:true,expected:{playerId:input.previousPlayerId,status:input.previousStatus}});
  return json({ok:true});
 }
 return json({error:'Not found'},404);
}
