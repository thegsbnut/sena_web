import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import worker from './worker.js';
import seed from './seed.json' with {type:'json'};
import './public/cup-history.js';
const sync=globalThis.SenaCupHistory;
test('finishing 88 Cup without saving online state updates totals once and score edits update the original event',async()=>{
 const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE club_state(id INTEGER PRIMARY KEY,revision INTEGER,payload TEXT,updated_at TEXT); CREATE TABLE login_attempts(ip TEXT PRIMARY KEY,window INTEGER,attempts INTEGER)');
 const env={ADMIN_KEY:'testing7',DB:{prepare(sql){const s=db.prepare(sql);let args=[];return {bind(...v){args=v;return this;},first(){return s.get(...args);},all(){return {results:s.all(...args)};},run(){return {meta:{changes:s.run(...args).changes}};}};}}};
 let cookie='';const call=(path,body,admin=true)=>worker.fetch(new Request('https://example.com'+path,{...(body?{method:'POST',body:JSON.stringify(body)}:{}),headers:{Origin:'https://example.com',...(admin?{Cookie:cookie}:{})}}),env);
 cookie=(await call('/api/login',{key:env.ADMIN_KEY})).headers.get('Set-Cookie').split(';')[0];
 const request=async(path,body)=>{const r=await call(path+'?club=88',body),d=await r.json();if(!r.ok)throw Error(d.error);return d;};
 const cup={id:'test-completed',teams:[['A','B'],['C','D']],matches:[{a:0,b:1,sa:21,sb:10}]};
 // Finishing must work even if the separate online-state Save is never pressed.
 assert.deepEqual(await sync.sync(cup,{request,title:'88 Cup',date:'2026-11-03'}),{saved:true});
 let board=await (await call('/api/leaderboard?club=88',null,false)).json();assert.equal(board.history.length,1);assert.equal(board.standings.find(p=>p.name==='A').w,1);
 assert.equal((await sync.sync(cup,{request,title:'88 Cup',date:'2026-11-04'})).unchanged,true);
 board=await request('/api/leaderboard');assert.equal(board.history[0].revision,1);assert.equal(board.standings.find(p=>p.name==='A').played,1);
 // An organizer's title/date survive later score synchronization.
 await request('/api/leaderboard',{id:cup.id,revision:1,cup:{...board.history[0],title:'Custom title',date:'2026-10-31'}});
 cup.matches[0]={a:0,b:1,sa:10,sb:21};await sync.sync(cup,{request,title:'88 Cup',date:'2026-11-03'});
 board=await request('/api/leaderboard');assert.equal(board.history.length,1);assert.equal(board.history[0].title,'Custom title');assert.equal(board.history[0].date,'2026-10-31');assert.equal(board.standings.find(p=>p.name==='A').played,1);assert.equal(board.standings.find(p=>p.name==='A').w,0);
 assert.equal((await (await call('/api/leaderboard')).json()).standings.length,15);
});
test('unfinished, tied or missing games do not create history; legacy Cup ids are stable across reloads',async()=>{
 const cup={teams:[['A','B'],['C','D']],matches:[{a:0,b:1,sa:21,sb:''}]};
 assert.equal(sync.complete(cup),false);assert.equal(sync.complete(null),false);
 let calls=0;assert.deepEqual(await sync.sync(cup,{request(){calls++;}}),{saved:false});assert.equal(calls,0);
 cup.matches[0].sb=21;assert.equal(sync.complete(cup),false);cup.matches[0].sb=10;assert.equal(sync.complete(cup),true);
 assert.equal(await sync.ensureId(structuredClone(cup)),await sync.ensureId(structuredClone(cup)));
 const broken=structuredClone(cup);broken.matches=[];assert.equal(sync.complete(broken),false);
});
