import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import worker from './worker.js';
import {defaultSettings,bangkokDate} from './booking.js';

const origin='https://example.com',group='C'+'a'.repeat(32);
const future=n=>bangkokDate(new Date(Date.now()+n*86400000));
const nextWeekday=()=>new Date(future(1)+'T12:00:00Z').getUTCDay();
function fixture(t){
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());
 db.exec('CREATE TABLE line_groups (club TEXT PRIMARY KEY,group_id TEXT,pair_code TEXT,expires_at INTEGER);'+
  'CREATE TABLE booking_clubs (club TEXT PRIMARY KEY,revision INTEGER,payload TEXT,updated_at TEXT)');
 db.prepare('INSERT INTO line_groups (club,group_id) VALUES (?,?)').run('sena',group);
 const env={LINE_CHANNEL_SECRET:'only-for-tests-secret',LINE_CHANNEL_ACCESS_TOKEN:'only-for-tests-token',DB:{prepare(sql){
  const stmt=db.prepare(sql);let values=[];
  return {bind(...args){values=args;return this;},first(){return stmt.get(...values);},all(){return {results:stmt.all(...values)};},run(){return {meta:{changes:stmt.run(...values).changes}};}};
 }}};
 function seed(club,sessions=[],enabled=true,names=['Nut','Bua','Bomb']){
  const table=club==='88'?'club_state_88':'club_state';
  db.exec(`CREATE TABLE IF NOT EXISTS ${table} (id INTEGER PRIMARY KEY,revision INTEGER,payload TEXT,updated_at TEXT)`);
  const players=names.map((name,i)=>({id:'p'+i,name,thai:'',lv:10,gender:'M'}));
  db.prepare(`INSERT OR REPLACE INTO ${table} VALUES (1,1,?,?)`).run(JSON.stringify({players,cup:null}),new Date().toISOString());
  db.prepare('INSERT OR REPLACE INTO booking_clubs VALUES (?,1,?,?)').run(club,JSON.stringify({
   settings:{...defaultSettings(),enabled,weekdays:[nextWeekday()],weeks:1,capacity:8},settingsVersion:1,seq:20,sessions
  }),new Date().toISOString());
 }
 seed('sena');seed('88',[],false);
 const calls=[];let status=200;
 t.mock.method(globalThis,'fetch',async(url,options)=>{
  assert.equal(url,'https://api.line.me/v2/bot/message/reply');
  assert.equal(options.headers.Authorization,'Bearer '+env.LINE_CHANNEL_ACCESS_TOKEN);
  calls.push(JSON.parse(options.body));return Response.json({}, {status});
 });
 const key=crypto.subtle.importKey('raw',new TextEncoder().encode(env.LINE_CHANNEL_SECRET),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 async function hook(events,{invalid=false}={}){
  const raw=JSON.stringify({events});
  const signature=Buffer.from(await crypto.subtle.sign('HMAC',await key,new TextEncoder().encode(invalid?'{}':raw))).toString('base64');
  return worker.fetch(new Request(origin+'/api/line/webhook',{method:'POST',headers:{'x-line-signature':signature},body:raw}),env);
 }
 const event=(text='badbot',extra={})=>({type:'message',webhookEventId:crypto.randomUUID(),replyToken:crypto.randomUUID(),
  source:{type:'group',groupId:group,userId:'LINE-user-not-a-player-id'},message:{type:'text',text},...extra});
 return {db,env,seed,calls,hook,event,status(value){status=value;}};
}
function session(date,{names=2,closed=false,holiday=null,capacity=8}={}){
 return {id:date,date,start:'19:00',end:'21:00',capacity,rounds:1,closed,holiday,regularSeen:[],hasFilled:false,
  registrations:Array.from({length:names},(_,i)=>({id:'r'+i,playerId:'p'+i,seq:i,source:'manual',ownerHash:'never-show-this'}))};
}
const textOf=call=>call.messages.filter(m=>m.type==='text').map(m=>m.text).join('\n');

test('signed badbot command replies with exactly two buttons and the existing booking URL',async t=>{
 const f=fixture(t),before=f.db.prepare('SELECT payload FROM club_state').get().payload;
 assert.equal((await f.hook([f.event('ＢＡＤＢＯＴ')])).status,200);
 assert.equal(f.calls.length,1);
 const [menu]=f.calls[0].messages;
 assert.equal(menu.type,'flex');
 const buttons=menu.contents.footer.contents;
 assert.equal(buttons.length,2);
 assert.deepEqual(buttons[0].action,{type:'uri',label:'🏸 จอง / ถอนชื่อ',uri:'https://sena-web.thegsbnut.workers.dev/court#booking'});
 assert.deepEqual(buttons[1].action,{type:'postback',label:'👥 ดูรายชื่อผู้ตี',data:'badbot:roster'});
 assert.equal(f.db.prepare('SELECT payload FROM club_state').get().payload,before);
 assert.equal(f.db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name LIKE '%user%'").get().n,0);
});

test('roster postback shows the nearest upcoming round for both courts and refresh uses a new Reply',async t=>{
 const f=fixture(t),date=future(1);
 f.seed('sena',[session(future(-1)),session(future(6)),session(date)]);
 f.seed('88',[session(date,{names:1})],true,['Pete','Noon']);
 const click=f.event('',{type:'postback',postback:{data:'badbot:roster'}});
 assert.equal((await f.hook([click])).status,200);
 const text=textOf(f.calls[0]);
 assert.match(text,/เสนา[\s\S]*2\/8 คน[\s\S]*1\. Nut\n2\. Bua[\s\S]*88[\s\S]*1\/8 คน[\s\S]*1\. Pete/);
 assert.match(text,/เหลือ 6 ที่/);assert.match(text,/อัปเดต ณ/);
 assert.doesNotMatch(text,/"lv"|gender|ownerHash|never-show-this|LINE-user-not-a-player-id/);
 assert.equal(f.calls[0].messages.at(-1).contents.footer.contents[1].action.label,'🔄 ดูข้อมูลล่าสุด');
 const doc=JSON.parse(f.db.prepare("SELECT payload FROM booking_clubs WHERE club='sena'").get().payload);
 doc.sessions.find(s=>s.date===date).registrations.push({id:'new',playerId:'p2',seq:10,source:'manual'});
 f.db.prepare("UPDATE booking_clubs SET payload=? WHERE club='sena'").run(JSON.stringify(doc));
 assert.equal((await f.hook([f.event('badbot รายชื่อ')])).status,200);
 assert.match(textOf(f.calls[1]),/3\/8 คน[\s\S]*3\. Bomb/);
 assert.notEqual(f.calls[0].replyToken,f.calls[1].replyToken);
});

test('closed rounds stay visible with an explicit status and skipped rounds are excluded',async t=>{
 const f=fixture(t),date=future(1);
 const skipped=session(date);skipped.skipped=true;
 const doc={settings:{...defaultSettings(),enabled:true,weekdays:[nextWeekday()],weeks:1,holidayPolicy:'skip',holidays:[{date,name:'สนามหยุด'}]},settingsVersion:1,seq:5,sessions:[skipped,session(future(2),{closed:true})]};
 f.db.prepare("UPDATE booking_clubs SET payload=? WHERE club='sena'").run(JSON.stringify(doc));
 await f.hook([f.event('แบดบอต รายชื่อ')]);
 assert.match(textOf(f.calls[0]),/ปิดรับจอง/);
 assert.match(textOf(f.calls[0]),/88\nยังไม่มีรอบเปิดรับ/);
});

test('waitlists are ordered and both venue headings survive very long rosters within LINE limits',async t=>{
 const f=fixture(t),names=Array.from({length:200},(_,i)=>'Player '+i+' '+('ยาว'.repeat(25)));
 // Disable automatic draws here: read-only reply formatting is what this checks.
 for(const club of ['sena','88']){
  f.seed(club,[session(future(1),{names:200})],true,names);
  const row=f.db.prepare('SELECT payload FROM booking_clubs WHERE club=?').get(club);
  const doc=JSON.parse(row.payload);doc.sessions[0].closed=true;
  f.db.prepare('UPDATE booking_clubs SET payload=? WHERE club=?').run(JSON.stringify(doc),club);
 }
 await f.hook([f.event('badbot รายชื่อ')]);
 const call=f.calls[0],text=textOf(call);
 assert(call.messages.length<=5);
 assert(call.messages.filter(m=>m.type==='text').every(m=>m.text.length<=5000));
 assert.match(text,/เสนา[\s\S]*สำรอง 192 คน[\s\S]*1\. Player 8[\s\S]*88/);
 assert.match(text,/รายชื่อเพิ่มเติมดูได้บนเว็บ/);
});

test('ordinary chat, unrelated postbacks, private chats, standby, and unlinked groups produce no replies',async t=>{
 const f=fixture(t);
 const events=[f.event('ไปตีแบดกัน'),f.event('badbotany'),f.event('badbot',{mode:'standby'}),
  f.event('badbot',{source:{type:'user',userId:'someone'}}),
  f.event('badbot',{source:{type:'group',groupId:'C'+'b'.repeat(32)}}),
  f.event('',{type:'postback',postback:{data:'other:action'}}),f.event('badbot',{replyToken:''})];
 assert.equal((await f.hook(events)).status,200);assert.equal(f.calls.length,0);
});

test('invalid signatures do not send replies, and LINE verification with no events succeeds',async t=>{
 const f=fixture(t);
 assert.equal((await f.hook([f.event()],{invalid:true})).status,401);
 assert.equal((await f.hook([])).status,200);assert.equal(f.calls.length,0);
});

test('redelivered events never send a second reply, even if their reply token changes',async t=>{
 const f=fixture(t),event=f.event();
 await f.hook([event,event]);
 await f.hook([{...event,replyToken:'replacement-token',deliveryContext:{isRedelivery:true}}]);
 assert.equal(f.calls.length,1);
 await f.hook([f.event()]);assert.equal(f.calls.length,2);
});

test('transient LINE failure allows webhook retry; an expired token never falls back to Push',async t=>{
 const f=fixture(t),event=f.event();
 f.status(503);assert.equal((await f.hook([event])).status,503);
 f.status(200);assert.equal((await f.hook([event])).status,200);
 assert.equal(f.calls.length,2);
 f.status(400);const expired=f.event();
 assert.equal((await f.hook([expired])).status,200);
 await f.hook([expired]);assert.equal(f.calls.length,3);
});

test('booking URL override must be HTTPS and contains no account-link flow',async t=>{
 const f=fixture(t);f.env.LINE_BOOKING_URL='https://booking.example/court#booking';
 await f.hook([f.event('badbot จอง')]);
 assert.equal(f.calls[0].messages[0].contents.footer.contents[0].action.uri,f.env.LINE_BOOKING_URL);
 f.env.LINE_BOOKING_URL='javascript:alert(1)';
 assert.equal((await f.hook([f.event()])).status,503);assert.equal(f.calls.length,1);
});
