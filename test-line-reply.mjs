import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import worker from './worker.js';
import {defaultSettings,bangkokDate} from './booking.js';
import {prepareMembers} from './member.js';

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

test('tagtest mentions the verified webhook sender directly without any roster or profile lookup',async t=>{
 const f=fixture(t),userId='U'+'b'.repeat(32);
 const event=f.event('badbot tagtest');event.source.userId=userId;
 assert.equal((await f.hook([event])).status,200);
 const messages=f.calls[0].messages;
 assert.equal(messages.length,2);
 assert.equal(messages[0].text,'Mention test: {you}');
 for(const message of messages){
  assert.equal(message.type,'textV2');
  assert.deepEqual(message.substitution.you,{type:'mention',mentionee:{type:'user',userId}});
  assert(!message.text.includes(userId));
 }
 assert.equal(f.db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name='member_links'").get().n,0);
});

test('tagtest does not fabricate a user ID when LINE does not provide one',async t=>{
 const f=fixture(t);assert.equal((await f.hook([f.event('badbot tagtest')])).status,200);
 assert.equal(f.calls[0].messages[0].type,'text');
 assert.match(textOf(f.calls[0]),/ไม่ส่งรหัสบัญชี/);
});

test('signed bill webhook sends a real LINE mention object all the way to the reply API',async t=>{
 const f=fixture(t),userId='U'+'a'.repeat(32);
 f.env.LINE_MEMBER_AUTH_ENABLED='true';f.env.LINE_LIFF_ID='12345-test';
 await prepareMembers(f.env.DB);
 f.db.exec('CREATE TABLE bills(id TEXT PRIMARY KEY,club TEXT,session_date TEXT,revision INTEGER,payload TEXT,closed_at INTEGER,slips_removed INTEGER DEFAULT 0)');
 f.db.prepare('INSERT INTO bills VALUES(?,?,?,0,?,NULL,0)').run('a'.repeat(32),'sena',future(0),JSON.stringify({payers:[{name:'Nut',payerKey:'member:p0',amount:8500,status:'unpaid'}]}));
 f.db.prepare("INSERT INTO member_links VALUES(?,?,?,?,?,'approved',?)").run(userId,'sena','p0','Nut','existing',new Date().toISOString());
 t.mock.method(globalThis,'fetch',async(url,options)=>{
  if(url==='https://api.line.me/v2/bot/group/'+group+'/member/'+userId)return Response.json({userId,displayName:'Nut'});
  assert.equal(url,'https://api.line.me/v2/bot/message/reply');
  f.calls.push(JSON.parse(options.body));return Response.json({sentMessages:[{id:'test-message'}]});
 });
 assert.equal((await f.hook([f.event('badbot bill')])).status,200);
 const message=f.calls[0].messages[0];
 assert.equal(message.type,'textV2');
 assert.deepEqual(message.substitution.u0,{type:'mention',mentionee:{type:'user',userId}});
 assert.match(message.text,/Nut 85 บ\. \{u0\}/);
 assert.doesNotMatch(message.text,/@Nut/);
 const diagnostic=JSON.parse(f.db.prepare('SELECT payload FROM line_bill_diagnostics WHERE group_id=?').get(group).payload);
 assert.equal(diagnostic.replyStatus,200);assert.equal(diagnostic.mentionCount,1);assert.deepEqual(diagnostic.messageTypes,['textV2']);
 assert.doesNotMatch(JSON.stringify(diagnostic),new RegExp(userId));
});

test('enabled member mode sends both booking buttons through the configured LIFF app',async t=>{
 const f=fixture(t);f.env.LINE_MEMBER_AUTH_ENABLED='true';f.env.LINE_LIFF_ID='12345-test';
 await f.hook([f.event()]);
 const buttons=f.calls[0].messages[0].contents.footer.contents;
 for(const [i,club] of [[0,'sena'],[1,'88']]){
  const url=new URL(buttons[i].action.uri);
  assert.equal(url.origin,'https://liff.line.me');assert.equal(url.pathname,'/12345-test');
  assert.equal(url.searchParams.get('club'),club);assert.equal(url.searchParams.get('page'),'book');
 }
 await f.hook([f.event('badbot leaderboard sena')]);
 assert.match(textOf(f.calls.at(-1)),/https:\/\/sena-web\.thegsbnut\.workers\.dev\/court#leaderboard/);
 assert.doesNotMatch(textOf(f.calls.at(-1)),/liff\.line\.me/);
});

test('signed badbot command replies with five buttons and distinct existing booking URLs',async t=>{
 const f=fixture(t),before=f.db.prepare('SELECT payload FROM club_state').get().payload;
 assert.equal((await f.hook([f.event('ＢＡＤＢＯＴ')])).status,200);
 assert.equal(f.calls.length,1);
 const [menu]=f.calls[0].messages;
 assert.equal(menu.type,'flex');
 const buttons=menu.contents.footer.contents;
 assert.equal(buttons.length,5);
 assert.deepEqual(buttons.slice(2).map(button=>button.action.displayText),[
  '👥 ขอรายชื่อผู้ตีทุกสนาม','👥 ขอรายชื่อผู้ตี Sena','👥 ขอรายชื่อผู้ตี 88'
 ]);
 assert.deepEqual(buttons[0].action,{type:'uri',label:'🏸 จอง / ถอน Sena',uri:'https://sena-web.thegsbnut.workers.dev/court#booking'});
 assert.deepEqual(buttons[1].action,{type:'uri',label:'🏸 จอง / ถอน 88',uri:'https://sena-web.thegsbnut.workers.dev/court?club=88#booking'});
 assert.deepEqual(buttons.slice(2).map(b=>b.action.data),['badbot:roster:all','badbot:roster:sena','badbot:roster:88']);
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
 assert.deepEqual(f.calls[0].messages.map(message=>message.type),['text']);
 const doc=JSON.parse(f.db.prepare("SELECT payload FROM booking_clubs WHERE club='sena'").get().payload);
 doc.sessions.find(s=>s.date===date).registrations.push({id:'new',playerId:'p2',seq:10,source:'manual'});
 f.db.prepare("UPDATE booking_clubs SET payload=? WHERE club='sena'").run(JSON.stringify(doc));
 assert.equal((await f.hook([f.event('badbot รายชื่อ')])).status,200);
 assert.match(textOf(f.calls[1]),/3\/8 คน[\s\S]*3\. Bomb/);
 assert.notEqual(f.calls[0].replyToken,f.calls[1].replyToken);
});

test('roster buttons return scoped text only and old menu actions still work',async t=>{
 const f=fixture(t),date=future(1);
 f.seed('sena',[session(date)]);
 f.seed('88',[session(date,{names:1})],true,['Pete','Noon']);
 await f.hook([f.event()]);
 const actions=f.calls[0].messages[0].contents.footer.contents.map(button=>button.action);
 for(const [index,scope] of [[2,'all'],[3,'sena'],[4,'88']]){
  const beforeOther=f.db.prepare('SELECT payload FROM booking_clubs WHERE club=?').get(scope==='sena'?'88':'sena').payload;
  await f.hook([f.event('',{type:'postback',postback:{data:actions[index].data}})]);
  const call=f.calls.at(-1),text=textOf(call);
  assert.deepEqual(call.messages.map(message=>message.type),['text']);
  assert.match(text,scope==='88'?/1\. Pete/:/1\. Nut/);
  if(scope==='all')assert.match(text,/📍 เสนา[\s\S]*📍 88/);
  else{
   assert.doesNotMatch(text,scope==='sena'?/📍 88|Pete/:/📍 เสนา|Nut/);
   assert.equal(f.db.prepare('SELECT payload FROM booking_clubs WHERE club=?').get(scope==='sena'?'88':'sena').payload,beforeOther);
  }
 }
 const refresh=actions[4];
 await f.hook([f.event('',{type:'postback',postback:{data:refresh.data}})]);
 assert.match(textOf(f.calls.at(-1)),/1\. Pete/);assert.doesNotMatch(textOf(f.calls.at(-1)),/📍 เสนา|Nut/);
 await f.hook([f.event('',{type:'postback',postback:{data:'badbot:menu'}})]);
 assert.equal(f.calls.at(-1).messages.length,1);
 assert.equal(f.calls.at(-1).messages[0].contents.footer.contents.length,5);
});

test('typed roster shortcuts select Sena, เสนา, 88 or all courts',async t=>{
 const f=fixture(t),date=future(1);
 f.seed('sena',[session(date)]);f.seed('88',[session(date,{names:1})],true,['Pete']);
 for(const [text,scope] of [['badbot รายชื่อ SENA','sena'],['แบดบอต ดูผู้ตี เสนา','sena'],['badbot รายชื่อ 88','88'],['badbot ดูรายชื่อผู้เล่น ทั้งหมด','all']]){
  assert.equal((await f.hook([f.event(text)])).status,200);
  const result=textOf(f.calls.at(-1));
  assert.equal(result.includes('📍 เสนา'),scope!=='88');
  assert.equal(result.includes('📍 88'),scope!=='sena');
 }
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
  f.event('',{type:'postback',postback:{data:'other:action'}}),
  f.event('',{type:'postback',postback:{data:'badbot:roster:unknown'}}),f.event('badbot',{replyToken:''})];
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

test('court links preserve custom query and fragment while overriding a stale club selection',async t=>{
 const f=fixture(t);f.env.LINE_BOOKING_URL='https://booking.example/court?club=88&from=line#booking';
 await f.hook([f.event()]);
 const actions=f.calls[0].messages[0].contents.footer.contents.map(b=>b.action);
 const sena=new URL(actions[0].uri),other=new URL(actions[1].uri);
 assert.equal(sena.searchParams.has('club'),false);assert.equal(other.searchParams.get('club'),'88');
 for(const url of [sena,other]){assert.equal(url.searchParams.get('from'),'line');assert.equal(url.hash,'#booking');}
});

test('English shortcuts route bookings, lists, matchups, completed Cup results and standings',async t=>{
 const f=fixture(t);
 const date=future(1);
 const players=Array.from({length:8},(_,i)=>'Sena '+(i+1));
 f.seed('sena',[{...session(date,{names:8}),cupOverride:false}],true,players);
 f.seed('88',[session(date)],true,['88 One','88 Two']);
 for(const [club,label] of [['sena','Sena'],['88','88']]){
  const state=club==='88'?'club_state_88':'club_state';
  const history=club==='88'?'cup_history_88':'cup_history';
  const teams=[[label+' One',label+' Two'],[label+' Three',label+' Four']];
  const cup={teams,matches:[{a:0,b:1,sa:'',sb:''}]};
  f.db.prepare(`UPDATE ${state} SET payload=json_set(payload,'$.cup',json(?)) WHERE id=1`).run(JSON.stringify(cup));
  f.db.exec(`CREATE TABLE ${history} (id TEXT PRIMARY KEY,revision INTEGER,sequence INTEGER,payload TEXT)`);
  f.db.prepare(`INSERT INTO ${history} VALUES ('saved',1,1,?)`).run(JSON.stringify({
   title:label+' Cup ผลทดสอบ',date:future(-1),inBaseline:false,teams,matches:[{a:0,b:1,sa:21,sb:14}]
  }));
 }
 const cases=[
  ['BOOK 88',/club=88#booking/],['book sena',/\/court#booking/],
  ['list',/📍 เสนา[\s\S]*📍 88/],['list 88',/📍 88/],['list sena',/📍 เสนา/],
  ['matchup sena',/เกม 1 · Sena \d/],
  ['matchup 88cup',/88 One \/ 88 Two vs 88 Three \/ 88 Four/],
  ['matchup senacup',/Sena One \/ Sena Two vs Sena Three \/ Sena Four/],
  ['senacup',/🥇 1\. Sena One \/ Sena Two · ชนะ 1\/1/],
  ['88cup',/🥇 1\. 88 One \/ 88 Two · ชนะ 1\/1/],
  ['leaderboard',/Sena Leaderboard[\s\S]*5\.[\s\S]*\/court#leaderboard[\s\S]*88 Leaderboard[\s\S]*88 One[\s\S]*\/court\?club=88#leaderboard/],
  ['leaderboard sena',/Sena Leaderboard[\s\S]*5\.[\s\S]*\/court#leaderboard/],
  ['leaderboard 88',/88 Leaderboard[\s\S]*88 One[\s\S]*\/court\?club=88#leaderboard/],
  ['help',/badbot leaderboard ·[^\n]+\nbadbot leaderboard sena ·[^\n]+\nbadbot leaderboard 88 ·/]
 ];
 for(const [command,expected] of cases){
  assert.equal((await f.hook([f.event('badbot '+command)])).status,200,command);
  const reply=f.calls.at(-1);
  assert(reply.messages.every(m=>m.type==='text'),command);
  assert.match(textOf(reply),expected,command);
  assert.doesNotMatch(textOf(reply),/\bLv\b|ownerHash/);
  if(command==='leaderboard sena')assert.doesNotMatch(textOf(reply),/88 Leaderboard|88 One/);
  if(command==='leaderboard 88')assert.doesNotMatch(textOf(reply),/Sena Leaderboard|Sena One/);
 }
});
