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
 // Existing pending selections from the approval trial become active on revisit.
 if(link?.status==='pending'&&link.kind==='existing'){
  const {state}=await roster(env.DB,club);
  if(state.players.some(p=>p.id===link.player_id))try{
   await env.DB.prepare("UPDATE member_links SET status='approved' WHERE user_id=? AND club=? AND status='pending' AND player_id=?").bind(session.user_id,club,link.player_id).run();
   link=await env.DB.prepare('SELECT player_id,name,kind,status FROM member_links WHERE user_id=? AND club=?').bind(session.user_id,club).first();
  }catch(error){if(!String(error.message).includes('UNIQUE'))throw error;}
 }
 return {userId:session.user_id,link:link||null};
}
async function roster(db,club){
 const table=club==='88'?'club_state_88':'club_state';
 await db.prepare(`CREATE TABLE IF NOT EXISTS ${table} (id INTEGER PRIMARY KEY,revision INTEGER NOT NULL,payload TEXT NOT NULL,updated_at TEXT NOT NULL)`).run();
 const row=await db.prepare(`SELECT revision,payload FROM ${table} WHERE id=1`).first();
 return {row,table,state:row?JSON.parse(row.payload):{players:[],selected:[],rounds:10,locks:[],result:null,cup:null}};
}
export async function memberRoute(req,env,admin,club){
 if(!env.DB)return json({error:'ระบบสมาชิกยังไม่พร้อม'},503);
 if(!['GET','POST'].includes(req.method))return json({error:'Method not allowed'},405);
 await prepareMembers(env.DB);
 const url=new URL(req.url),action=url.pathname.split('/').at(-1);
 if(req.method==='GET'&&action==='member'){
  const member=await memberFor(req,env,club),csrf=random();
  return json({enabled:loginEnabled(env),requireLogin:memberMode(env),configured:Boolean(env.LINE_LIFF_ID&&env.LINE_LOGIN_CHANNEL_ID),liffId:env.LINE_LIFF_ID||null,csrf,loggedIn:Boolean(member),link:member?.link||null},200,{'Set-Cookie':'__Host-sena-member-csrf='+csrf+'; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=600'});
 }
 if(req.method==='GET'&&action==='choices'){
  const member=await memberFor(req,env,club);if(!member)return json({error:'กรุณาเข้าสู่ระบบ LINE'},401);
  const {state}=await roster(env.DB,club);
  const taken=await env.DB.prepare("SELECT player_id FROM member_links WHERE club=? AND status='approved' AND user_id<>?").bind(club,member.userId).all();
  const ids=new Set(taken.results.map(r=>r.player_id));
  return json({players:state.players.filter(p=>!ids.has(p.id)).map(({id,name})=>({id,name}))});
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
  if(member.link?.status==='approved')return member.link.player_id===input.playerId?json({ok:true}):json({error:'ผูกชื่อแล้ว หากเลือกผิดให้ผู้จัดแก้ไข'},409);
  const {state}=await roster(env.DB,club),player=state.players.find(p=>p.id===input.playerId);
  if(!player||input.name!==undefined)return json({error:'ช่วงเก็บตกให้เลือกชื่อผู้เล่นเดิมเท่านั้น'},400);
  try{
   const changed=await env.DB.prepare("INSERT INTO member_links VALUES(?,?,?,?,?,'approved',?) ON CONFLICT(user_id,club) DO UPDATE SET player_id=excluded.player_id,name=excluded.name,kind='existing',status='approved',created_at=excluded.created_at WHERE member_links.status IN ('rejected','pending')")
    .bind(member.userId,club,player.id,player.name,'existing',new Date().toISOString()).run();
   if(!changed.meta.changes){const current=await env.DB.prepare("SELECT player_id FROM member_links WHERE user_id=? AND club=? AND status='approved'").bind(member.userId,club).first();if(current?.player_id!==player.id)return json({error:'การผูกเปลี่ยนแล้ว กรุณาโหลดใหม่'},409);}
  }catch(error){if(!String(error.message).includes('UNIQUE'))throw error;return json({error:'ชื่อนี้มีคนผูกแล้ว กรุณาเลือกชื่ออื่นหรือให้ผู้จัดแก้ไข'},409);}
  return json({ok:true});
 }
 if(['reassign','revoke','unlink'].includes(action)){
  if(!admin)return json({error:'กรุณาเข้าสู่ระบบผู้จัด'},401);
  if(typeof input.previousStatus!=='string'||!(input.previousPlayerId===null||typeof input.previousPlayerId==='string'))return json({error:'กรุณาโหลดการแมพล่าสุดก่อนแก้ไข'},400);
 }
 if(action==='reassign'){
  if(!admin)return json({error:'กรุณาเข้าสู่ระบบผู้จัด'},401);
  if(typeof input.userId!=='string'||!/^U[a-f0-9]{32}$/.test(input.userId))return json({error:'เลือกบัญชี LINE ที่มีในระบบ'},400);
  const {state}=await roster(env.DB,club),player=state.players.find(p=>p.id===input.playerId);
  if(!player)return json({error:'ไม่พบผู้เล่นที่เลือก'},400);
  try{
   const changed=await env.DB.prepare("UPDATE member_links SET player_id=?,name=?,kind='existing',status='approved',created_at=? WHERE user_id=? AND club=? AND player_id IS ? AND status=?")
    .bind(player.id,player.name,new Date().toISOString(),input.userId,club,input.previousPlayerId??null,input.previousStatus).run();
   if(!changed.meta.changes)return json({error:'การผูกเปลี่ยนจากอีกเครื่องแล้ว กรุณาโหลดล่าสุด'},409);
  }catch(error){if(!String(error.message).includes('UNIQUE'))throw error;return json({error:'ชื่อนี้ผูกกับบัญชีอื่นอยู่ ให้ยกเลิกการผูกเดิมก่อน'},409);}
  return json({ok:true});
 }
 if(action==='unlink'){
  const changed=await env.DB.prepare('DELETE FROM member_links WHERE user_id=? AND club=? AND player_id IS ? AND status=?').bind(input.userId,club,input.previousPlayerId,input.previousStatus).run();
  return changed.meta.changes?json({ok:true}):json({error:'การผูกเปลี่ยนจากอีกเครื่องแล้ว กรุณาโหลดล่าสุด'},409);
 }
 if(action==='revoke'){
  if(!admin)return json({error:'กรุณาเข้าสู่ระบบผู้จัด'},401);
  const changed=await env.DB.prepare("UPDATE member_links SET status='rejected' WHERE user_id=? AND club=? AND player_id IS ? AND status=?").bind(input.userId,club,input.previousPlayerId,input.previousStatus).run();
  return changed.meta.changes?json({ok:true}):json({error:'การผูกเปลี่ยนจากอีกเครื่องแล้ว กรุณาโหลดล่าสุด'},409);
 }
 return json({error:'Not found'},404);
}
