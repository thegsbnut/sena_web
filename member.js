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
 const link=await env.DB.prepare('SELECT player_id,name,kind,status FROM member_links WHERE user_id=? AND club=?').bind(session.user_id,club).first();
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
 if(req.method==='GET'&&action==='requests'){
  if(!admin)return json({error:'กรุณาเข้าสู่ระบบผู้จัด'},401);
  const rows=await env.DB.prepare("SELECT l.user_id,l.player_id,l.name,l.kind,l.status,l.created_at,p.line_name FROM member_links l LEFT JOIN member_profiles p ON p.user_id=l.user_id WHERE l.club=? ORDER BY l.created_at DESC").bind(club).all();
  return json({requests:rows.results});
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
  if(member.link&&member.link.status!=='rejected')return json({error:'ส่งคำขอแล้วหรือผูกชื่อไว้แล้ว'},409);
  const {state}=await roster(env.DB,club);
  const player=state.players.find(p=>p.id===input.playerId);
  const name=player?.name||(typeof input.name==='string'?input.name.normalize('NFC').trim().replace(/\s+/g,' '):'');
  if((input.playerId&&!player)||!name||name.length>80||/[\p{Cc}\p{Cf}]/u.test(name))return json({error:'เลือกชื่อเดิมหรือกรอกชื่อใหม่ให้ถูกต้อง'},400);
  if(!player&&state.players.some(p=>p.name.toLowerCase()===name.toLowerCase()))return json({error:'มีชื่อนี้แล้ว กรุณาเลือกชื่อเดิม'},409);
  await env.DB.prepare("INSERT INTO member_links VALUES(?,?,?,?,?,'pending',?) ON CONFLICT(user_id,club) DO UPDATE SET player_id=excluded.player_id,name=excluded.name,kind=excluded.kind,status='pending',created_at=excluded.created_at WHERE member_links.status='rejected'")
   .bind(member.userId,club,player?.id||null,name,player?'existing':'new',new Date().toISOString()).run();
  return json({ok:true});
 }
 if(action==='revoke'){
  if(!admin)return json({error:'กรุณาเข้าสู่ระบบผู้จัด'},401);
  await env.DB.prepare("UPDATE member_links SET status='rejected' WHERE user_id=? AND club=?").bind(input.userId,club).run();return json({ok:true});
 }
 if(action==='approve'||action==='reject'){
  if(!admin)return json({error:'กรุณาเข้าสู่ระบบผู้จัด'},401);
  const request=await env.DB.prepare("SELECT * FROM member_links WHERE user_id=? AND club=? AND status='pending'").bind(input.userId,club).first();
  if(!request)return json({error:'คำขอเปลี่ยนแล้ว กรุณาโหลดใหม่'},409);
  if(action==='reject'){
   await env.DB.prepare("UPDATE member_links SET status='rejected' WHERE user_id=? AND club=? AND status='pending'").bind(input.userId,club).run();return json({ok:true});
  }
  const {state,row,table}=await roster(env.DB,club);
  let id=request.player_id;
  if(request.kind==='new'){
   id='line:'+await hash(memberKey(request.user_id,club));
   const name=typeof input.name==='string'?input.name.trim():request.name;
   if(!name||name.length>80||/[\p{Cc}\p{Cf}]/u.test(name)||state.players.some(p=>p.id!==id&&p.name.toLowerCase()===name.toLowerCase())||state.players.length>=200&&!state.players.some(p=>p.id===id)||!Number.isFinite(input.lv)||input.lv<0||input.lv>100||!['M','F'].includes(input.gender))return json({error:'ตรวจชื่อ LV และเพศของผู้เล่นใหม่'},400);
   // Stable ID makes retries safe if the roster write succeeds before approval.
   id='line:'+await hash(memberKey(request.user_id,club));
   const existing=state.players.find(p=>p.id===id);
   if(!existing){
    state.players.push({id,name,thai:'',lv:input.lv,gender:input.gender});
    const result=row?await env.DB.prepare(`UPDATE ${table} SET payload=?,revision=revision+1,updated_at=? WHERE id=1 AND revision=?`).bind(JSON.stringify(state),new Date().toISOString(),row.revision).run():await env.DB.prepare(`INSERT OR IGNORE INTO ${table} VALUES(1,1,?,?)`).bind(JSON.stringify(state),new Date().toISOString()).run();
    if(!result.meta.changes)return json({error:'รายชื่อเปลี่ยนแล้ว กรุณาโหลดใหม่'},409);
   }
  }else if(!state.players.some(p=>p.id===id))return json({error:'ไม่พบผู้เล่นเดิมแล้ว'},409);
  try{
   await env.DB.prepare("UPDATE member_links SET player_id=?,status='approved' WHERE user_id=? AND club=? AND status='pending'").bind(id,input.userId,club).run();
  }catch{return json({error:'ชื่อนี้ถูกผูกกับบัญชีอื่นแล้ว'},409);}
  return json({ok:true});
 }
 return json({error:'Not found'},404);
}
const memberKey=(userId,club)=>club+':'+userId;
