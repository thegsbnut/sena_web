import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import worker from './worker.js';
import {defaultSettings,materialize,bangkokDate} from './booking.js';
import {holidayOn} from './booking-holidays.js';
const origin='https://example.com';
const token='a'.repeat(64),otherToken='b'.repeat(64);
const players=Array.from({length:12},(_,i)=>({id:'p'+i,name:'Player '+i,thai:'',lv:4+i/2,gender:i%3===0?'F':'M'}));
function fixture(){
 const db=new DatabaseSync(':memory:');
 db.exec('CREATE TABLE club_state(id INTEGER PRIMARY KEY,revision INTEGER,payload TEXT,updated_at TEXT); CREATE TABLE login_attempts(ip TEXT PRIMARY KEY,window INTEGER,attempts INTEGER)');
 db.prepare('INSERT INTO club_state VALUES(1,1,?,?)').run(JSON.stringify({players,selected:[],rounds:10,locks:[],result:null,cup:null}),'before');
 const env={ADMIN_KEY:'abcdef7',DB:{prepare(sql){const stmt=db.prepare(sql);let args=[];return{bind(...v){args=v;return this;},first(){return stmt.get(...args);},all(){return{results:stmt.all(...args)};},run(){return{meta:{changes:stmt.run(...args).changes}};}};}}};
 const call=(body,{cookie='',owner=token,club='sena',headers={}}={})=>worker.fetch(new Request(origin+'/api/booking'+(club==='88'?'?club=88':''),{method:body?'POST':'GET',headers:{Origin:origin,...(cookie?{Cookie:cookie}:{}),...(owner?{'X-Booking-Token':owner}:{}),...headers},...(body?{body:JSON.stringify(body)}:{})}),env);
 const login=async()=>{const r=await worker.fetch(new Request(origin+'/api/login',{method:'POST',headers:{Origin:origin},body:JSON.stringify({key:env.ADMIN_KEY})}),env);assert.equal(r.status,200);return r.headers.get('Set-Cookie').split(';')[0];};
 const open=async regularIds=>{const cookie=await login(),settings={...defaultSettings(),enabled:true,weekdays:[0,1,2,3,4,5,6],weeks:1,capacity:8,rounds:4,regularIds:regularIds||[]};const r=await call({action:'settings',settingsVersion:0,settings},{cookie});assert.equal(r.status,200);return{cookie,settings,data:await r.json()};};
 return {db,env,call,login,open};
}
test('booking privacy, permissions, club isolation and invalid settings',async()=>{
 const f=fixture();let d=await(await f.call()).json();assert.equal(d.canEdit,false);assert.equal(d.settings.enabled,false);assert.equal(d.roster.length,12);assert(!JSON.stringify(d).includes('"lv"'));assert(!JSON.stringify(d).includes('ownerHash'));
 assert.equal((await f.call({action:'settings',settingsVersion:0,settings:defaultSettings()})).status,401);
 assert.equal((await f.call({action:'close',sessionId:'x',closed:true})).status,401);
 assert.equal((await f.call({action:'book',playerId:'p1',sessionIds:['x']})).status,409);
 const {cookie,settings,data}=await f.open();assert.equal(data.canEdit,true);assert.equal((await(await f.call(null,{club:'88'})).json()).roster.length,0);
 assert.equal((await f.call({action:'settings',settingsVersion:0,settings},{cookie})).status,409);
 assert.equal((await f.call({action:'settings',settingsVersion:1,settings:{...settings,end:'00:00'}},{cookie})).status,400);
 assert.equal((await f.call({action:'book',playerId:'p0',sessionIds:[data.sessions[0].id]},{headers:{Origin:'https://evil.example'}})).status,403);
 assert.equal((await f.call(null,{owner:'malformed'})).status,400);
});
test('multiweek bookings are atomic, idempotent and ownership tokens never leak',async()=>{
 const f=fixture(),{data}=await f.open(),ids=data.sessions.slice(0,3).map(s=>s.id);
 let r=await f.call({action:'book',playerId:'p0',sessionIds:ids,acceptHoliday:true});assert.equal(r.status,200);
 let d=await r.json();assert.equal(d.result.added,3);assert.equal(d.sessions.filter(s=>s.registrations.length).length,3);
 assert(d.sessions[0].registrations[0].canCancel);assert(!JSON.stringify(d).includes('ownerHash'));assert(!JSON.stringify(d).includes(token));
 d=await(await f.call({action:'book',playerId:'p0',sessionIds:ids,acceptHoliday:true})).json();assert.equal(d.result.added,0);assert.equal(d.result.duplicate,3);
 assert.equal((await f.call({action:'book',playerId:'p1',sessionIds:[ids[0],'1900-01-01'],acceptHoliday:true})).status,409);
 d=await(await f.call()).json();assert.equal(d.sessions.find(s=>s.id===ids[0]).registrations.length,1);
 const other=await(await f.call(null,{owner:otherToken})).json();assert.equal(other.sessions[0].registrations[0].canCancel,false);
 const reg=d.sessions[0].registrations[0];assert.equal((await f.call({action:'cancel',sessionId:ids[0],registrationId:reg.id},{owner:otherToken})).status,403);
});
test('concurrent final slots, automatic promotion, rejoin at tail and stale draw removal',async()=>{
 const f=fixture(),{data}=await f.open(),id=data.sessions[0].id;
 const book=i=>f.call({action:'book',playerId:'p'+i,sessionIds:[id],acceptHoliday:true});
 for(let i=0;i<6;i++)assert.equal((await book(i)).status,200);
 const concurrent=await Promise.all([book(6),book(7),book(8),book(9)]);assert(concurrent.every(r=>r.status===200));
 let s=(await(await f.call()).json()).sessions[0];assert.equal(s.confirmedCount,8);assert.equal(s.waitlistCount,2);assert.equal(s.scheduleStatus,'ready');assert.equal(s.schedule.schedule.length,4);
 const version=s.scheduleVersion,firstWait=s.registrations.find(r=>r.status==='waitlist'),removed=s.registrations[0];
 assert.equal((await f.call({action:'cancel',sessionId:id,registrationId:removed.id})).status,200);
 s=(await(await f.call()).json()).sessions[0];assert.equal(s.registrations.find(r=>r.id===firstWait.id).status,'confirmed');assert.equal(s.scheduleVersion,version+1);assert(!JSON.stringify(s.schedule).includes('diff'));
 await f.call({action:'book',playerId:removed.playerId,sessionIds:[id],acceptHoliday:true});s=(await(await f.call()).json()).sessions[0];assert.equal(s.registrations.at(-1).playerId,removed.playerId);assert.equal(s.registrations.at(-1).status,'waitlist');
 const before=s.scheduleVersion;await f.call({action:'cancel',sessionId:id,registrationId:s.registrations.at(-1).id});s=(await(await f.call()).json()).sessions[0];assert.equal(s.scheduleVersion,before);
 for(const r of s.registrations.filter(r=>r.status==='waitlist'))await f.call({action:'cancel',sessionId:id,registrationId:r.id});
 s=(await(await f.call()).json()).sessions[0];await f.call({action:'cancel',sessionId:id,registrationId:s.registrations[0].id});s=(await(await f.call()).json()).sessions[0];assert.equal(s.confirmedCount,7);assert.equal(s.schedule,null);assert.equal(s.scheduleStatus,'insufficient');
});
test('weekly regulars do not duplicate or reappear after cancellation; future weeks roll forward',async()=>{
 const f=fixture(),{cookie,settings,data}=await f.open(['p0','p1']);const s=data.sessions[0];assert.equal(s.registrations.length,2);assert(s.registrations.every(r=>r.source==='regular'));
 for(let i=0;i<2;i++)assert.equal((await(await f.call()).json()).sessions[0].registrations.length,2);
 assert.equal((await f.call({action:'cancel',sessionId:s.id,registrationId:s.registrations[0].id})).status,403);
 assert.equal((await f.call({action:'cancel',sessionId:s.id,registrationId:s.registrations[0].id},{cookie})).status,200);
 assert.equal((await(await f.call()).json()).sessions[0].registrations.length,1);
 let r=await f.call({action:'settings',settingsVersion:1,settings:{...settings,regularIds:['p0','p1','p2']}},{cookie});assert.equal(r.status,200);assert.deepEqual((await r.json()).sessions[0].registrations.map(r=>r.playerId),['p1','p2']);
 const now=new Date('2026-11-03T05:00:00Z'),doc={settings:{...settings,weekdays:[2,4],weeks:2,regularIds:['p0']},settingsVersion:0,sessions:[],seq:0};materialize(doc,players,now);assert.equal(doc.sessions.length,4);
 materialize(doc,players,new Date('2026-11-10T05:00:00Z'));assert.equal(doc.sessions.length,6);assert(doc.sessions.every(s=>s.registrations.length===1));
});
test('Bangkok date boundary, holiday acknowledgement, skip and organizer closure',async()=>{
 assert.equal(bangkokDate(new Date('2026-11-03T18:00:00Z')),'2026-11-04');assert.equal(holidayOn('2026-12-10'),'วันรัฐธรรมนูญ');assert.equal(holidayOn('2027-05-20'),'วันวิสาขบูชา');
 const f=fixture(),{cookie,settings,data}=await f.open();const id=data.sessions[0].id;
 let r=await f.call({action:'settings',settingsVersion:1,settings:{...settings,holidays:[{date:id,name:'สนามปิดซ่อม'}]}},{cookie});assert.equal(r.status,200);
 assert.equal((await f.call({action:'book',playerId:'p0',sessionIds:[id]})).status,409);
 assert.equal((await f.call({action:'book',playerId:'p0',sessionIds:[id],acceptHoliday:true})).status,200);
 r=await f.call({action:'settings',settingsVersion:2,settings:{...settings,holidayPolicy:'skip',holidays:[{date:id,name:'สนามปิดซ่อม'}]}},{cookie});assert.equal(r.status,200);const s=(await r.json()).sessions[0];assert.equal(s.skipped,true);assert.equal(s.registrations.length,1);
 assert.equal((await f.call({action:'book',playerId:'p1',sessionIds:[id],acceptHoliday:true})).status,409);
 assert.equal((await f.call({action:'close',sessionId:data.sessions[1].id,closed:true},{cookie})).status,200);
 assert.equal((await f.call({action:'book',playerId:'p1',sessionIds:[data.sessions[1].id],acceptHoliday:true})).status,409);
});
test('a full regular roster saves schedules respecting rest and mixed-gender rules without exposing levels',async()=>{
 const f=fixture(),{data}=await f.open(players.slice(0,8).map(p=>p.id));
 for(const s of data.sessions){assert.equal(s.scheduleStatus,'ready');const rounds=s.schedule.schedule;for(let i=0;i<rounds.length;i++){
  const ids=rounds[i].ids;assert.equal(new Set(ids).size,4);if(i)assert(!ids.some(id=>rounds[i-1].ids.includes(id)));
  assert(globalThis.Sena.valid(ids.slice(0,2).map(id=>players.find(p=>p.id===id)),ids.slice(2).map(id=>players.find(p=>p.id===id))));
 }}
 const d=await(await f.call()).json();assert(!JSON.stringify(d).includes('"lv"'));assert(!JSON.stringify(d).includes('"gender"'));assert(!JSON.stringify(d).includes('fingerprint'));
});
