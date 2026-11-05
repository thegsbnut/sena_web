import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';import assert from 'node:assert/strict';import worker,{authorized,valid} from './worker.js';import seed from './seed.json' with {type:'json'};
test('guest can read initial roster without DB; writes require authentication',async()=>{let r=await worker.fetch(new Request('https://example.com/api/state'),{});assert.equal(r.status,200);assert.equal((await r.json()).canEdit,false);r=await worker.fetch(new Request('https://example.com/api/state',{method:'POST',headers:{Origin:'https://example.com'},body:'{}'}),{});assert.equal(r.status,401)});
test('origin and spoofed Sites headers cannot authorize',async()=>{const req=new Request('https://example.com/api/state',{method:'POST',headers:{Origin:'https://evil.com','oai-authenticated-user-email':'admin@example.com'}});assert.equal((await worker.fetch(req,{ADMIN_KEY:'a'.repeat(40)})).status,403);assert.equal(await authorized(req,{ADMIN_KEY:'a'.repeat(40)}),false)});
test('login, signed session, tamper, rate limit and logout',async()=>{const sqlite = new DatabaseSync(':memory:');
sqlite.exec('CREATE TABLE login_attempts(ip TEXT PRIMARY KEY, window INTEGER, attempts INTEGER)');
const env = {ADMIN_KEY:'abcdef7',DB:{prepare(sql) {
  const stmt = sqlite.prepare(sql); let args = [];
  return {bind(...values) { args = values; return this; }, first() { return stmt.get(...args); }, run() { return stmt.run(...args); }};
}}};const login=key=>new Request('https://example.com/api/login',{method:'POST',headers:{Origin:'https://example.com'},body:JSON.stringify({key})});assert.equal((await worker.fetch(login('wrong'),env)).status,401);const r=await worker.fetch(login(env.ADMIN_KEY),env);assert.equal(r.status,200);const cookie=r.headers.get('Set-Cookie').split(';')[0];assert(await authorized(new Request('https://example.com',{headers:{Cookie:cookie}}),env));assert(!await authorized(new Request('https://example.com',{headers:{Cookie:cookie+'x'}}),env));assert(!await authorized(new Request('https://example.com',{headers:{Cookie:cookie}}),{...env,ADMIN_KEY:'changed7'}));sqlite.exec('UPDATE login_attempts SET attempts=10');assert.equal((await worker.fetch(login(env.ADMIN_KEY),env)).status,429);const out=await worker.fetch(new Request('https://example.com/api/logout',{method:'POST',headers:{Origin:'https://example.com'}}),env);assert.match(out.headers.get('Set-Cookie'),/Max-Age=0/)});
test('validate data and score payloads',()=>{assert(valid(seed));assert(!valid({...seed,selected:['missing']}));assert(!valid({...seed,cup:{teams:[['A','B']],matches:[{a:0,b:0,sa:'<script>',sb:2}]}}))});

test('guest API excludes levels and team differences; organizer retains them', async () => {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('CREATE TABLE club_state(id INTEGER PRIMARY KEY,revision INTEGER,payload TEXT,updated_at TEXT); CREATE TABLE login_attempts(ip TEXT PRIMARY KEY,window INTEGER,attempts INTEGER)');
  const privateState = {...seed,players:Array.from({length:8},(_,i)=>({id:String(i),name:'Player '+i,thai:'',lv:i+1,gender:'M'})),selected:Array.from({length:8},(_,i)=>String(i)),rounds:2,result:{schedule:[{round:1,ids:['0','1','2','3'],diff:4,locked:false}],counts:{'0':1}}};
  sqlite.prepare('INSERT INTO club_state VALUES(1,1,?,?)').run(JSON.stringify(privateState),'now');
  const env={ADMIN_KEY:'abcdef7',DB:{prepare(sql){const stmt=sqlite.prepare(sql);let args=[];return {bind(...values){args=values;return this;},first(){return stmt.get(...args);},run(){return stmt.run(...args);}};}}};
  const get=async cookie=>(await worker.fetch(new Request('https://example.com/api/state',{headers:cookie?{Cookie:cookie}:{}}),env)).json();
  const guest=await get();
  assert(!('lv' in guest.state.players[0]));assert(!('diff' in guest.state.result.schedule[0]));
  const login=await worker.fetch(new Request('https://example.com/api/login',{method:'POST',headers:{Origin:'https://example.com'},body:JSON.stringify({key:env.ADMIN_KEY})}),env);
  const admin=await get(login.headers.get('Set-Cookie').split(';')[0]);
  assert.equal(admin.state.players[0].lv,1);assert.equal(admin.canEdit,true);
  const generated=await worker.fetch(new Request('https://example.com/api/generate',{method:'POST',headers:{Origin:'https://example.com'},body:JSON.stringify({selected:privateState.selected,rounds:2,locks:[]})}),env);
  assert.equal(generated.status,200);
  const data=await generated.json();assert.equal(data.result.schedule.length,2);assert(!('diff' in data.result.schedule[0]));assert(!('players' in data));
});
test('cup medals follow completed scores and clear for the next cup',()=>{
 const teams=[['A','B'],['C','D'],['E','F']];
 const cup={teams,matches:[{a:0,b:1,sa:21,sb:10},{a:0,b:2,sa:21,sb:8},{a:1,b:2,sa:21,sb:9}]};
 const awards=globalThis.Sena.cupAwards(cup);
 assert.equal(awards.get('a'),'🥇');assert.equal(awards.get('b'),'🥇');
 assert.equal(awards.get('e'),'💩');assert.equal(awards.get('f'),'💩');assert(!awards.has('c'));
 assert.equal(globalThis.Sena.cupAwards(null).size,0);
 assert.equal(globalThis.Sena.cupAwards({teams,matches:globalThis.Sena.roundRobin(teams)}).size,0);
 cup.matches=cup.matches.map(m=>({...m,sa:m.sb,sb:m.sa}));
 assert.equal(globalThis.Sena.cupAwards(cup).get('a'),'💩');
 assert.equal(globalThis.Sena.cupAwards(cup).get('e'),'🥇');
});
test('round robin covers every pair once and separates consecutive teams',()=>{
 for(let n=2;n<=20;n++) {
  const matches=globalThis.Sena.roundRobin(Array.from({length:n},(_,i)=>['A'+i,'B'+i]));
  assert.equal(matches.length,n*(n-1)/2);
  assert.equal(new Set(matches.map(m=>[m.a,m.b].sort((a,b)=>a-b).join(','))).size,matches.length);
  assert(matches.every(m=>m.a!==m.b && m.sa==='' && m.sb===''));
  if(n>=5)assert.equal(globalThis.Sena.cupRestConflicts(matches),0);
  if(n===3 || n===4)assert.equal(globalThis.Sena.cupRestConflicts(matches),2);
 }
});

import {cleanCup,standings as leaderboardStandings,leaderboardRoute} from './leaderboard.js';
const historyFixture=()=>({title:'Cup test',date:'2026-11-03',inBaseline:false,teams:[['Nut','Pete'],['Bomb','Tom']],matches:[{a:0,b:1,sa:21,sb:10}]});
test('leaderboard baseline exactly preserves supplied historical totals',()=>{
 const rows=leaderboardStandings([]);assert.equal(rows.length,15);
 assert.deepEqual(rows.find(p=>p.name==='Nut'),{name:'Nut',played:12,w:10,l:2,pf:239,pa:189,crown:1,poo:0,change:2,position:1,diff:50,winPercent:10/12*100});
 assert.equal(rows.find(p=>p.name==='Bo').w,9);assert.equal(rows.find(p=>p.name==='Bua').w,5);assert.equal(rows.find(p=>p.name==='Zong').crown,1);
});
test('history adds totals once, excluded imports do not add, editing recomputes',()=>{
 const c={...historyFixture(),sequence:1};let rows=leaderboardStandings([c]);
 assert.equal(rows.find(p=>p.name==='Nut').w,11);assert.equal(rows.find(p=>p.name==='Nut').pf,260);assert.equal(rows.find(p=>p.name==='Tom').poo,4);
 rows=leaderboardStandings([{...c,inBaseline:true}]);assert.equal(rows.find(p=>p.name==='Nut').w,10);
 rows=leaderboardStandings([{...c,matches:[{a:0,b:1,sa:10,sb:21}]}]);assert.equal(rows.find(p=>p.name==='Nut').w,10);assert.equal(rows.find(p=>p.name==='Nut').l,3);assert.equal(rows.find(p=>p.name==='Bomb').w,7);
});
test('history rejects missing games, duplicate players, ties and private extra fields',()=>{
 const c=historyFixture();assert.throws(()=>cleanCup({...c,matches:[]}));assert.throws(()=>cleanCup({...c,teams:[['Nut','Pete'],['nut','Tom']]}));assert.throws(()=>cleanCup({...c,matches:[{a:0,b:1,sa:21,sb:21}]}));
 assert(!('lv' in cleanCup({...c,lv:99})));
});
test('history API is public read, admin only write and uses revision for retries and concurrent edits',async()=>{
 const db=new DatabaseSync(':memory:');const env={DB:{prepare(sql){const stmt=db.prepare(sql);let args=[];return {bind(...v){args=v;return this;},first(){return stmt.get(...args);},all(){return {results:stmt.all(...args)};},run(){const r=stmt.run(...args);return {meta:{changes:r.changes}};}};}}};
 const get=()=>new Request('https://example.com/api/leaderboard');
 let r=await leaderboardRoute(get(),env,false);assert.equal(r.status,200);assert.equal((await r.json()).standings.length,15);
 const post=(revision=0,cup=historyFixture())=>new Request('https://example.com/api/leaderboard',{method:'POST',body:JSON.stringify({id:'cup-1',revision,cup})});
 assert.equal((await leaderboardRoute(post(),env,false)).status,401);
 assert.equal((await leaderboardRoute(post(),env,true)).status,200);
 assert.equal((await leaderboardRoute(post(),env,true)).status,409);
 assert.equal((await leaderboardRoute(post(1,{...historyFixture(),inBaseline:true}),env,true)).status,200);
 assert.equal((await leaderboardRoute(post(1),env,true)).status,409);
 r=await leaderboardRoute(get(),env,false);const result=await r.json();assert.equal(result.history.length,1);assert.equal(result.standings.find(p=>p.name==='Nut').w,10);assert.equal(result.canEdit,false);assert(!JSON.stringify(result).includes('"lv"'));
});
test('historical aliases merge with current Bo and Not without duplicate players',()=>{
 const old={...historyFixture(),sequence:1,teams:[['Beau','Nott'],['Bomb','Tom']]};
 const rows=leaderboardStandings([old]);
 assert.equal(rows.length,15);assert.equal(rows.find(p=>p.name==='Bo').w,10);assert.equal(rows.find(p=>p.name==='Not').w,3);
 assert(!rows.some(p=>['Beau','Nott'].includes(p.name)));
 const cleaned=cleanCup(old);assert.deepEqual(cleaned.teams[0],['Bo','Not']);
 assert.throws(()=>cleanCup({...old,teams:[['Bo','Beau'],['Not','Tom']]}));
 assert.equal(leaderboardStandings([]).find(p=>p.name==='Bo').pf,231);
});


test('session status exposes role only, checks signed cookies and shares login across clubs',async()=>{
 const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE login_attempts(ip TEXT PRIMARY KEY,window INTEGER,attempts INTEGER)');
 const env={ADMIN_KEY:'abcdef7',DB:{prepare(sql){const stmt=db.prepare(sql);let args=[];return{bind(...v){args=v;return this;},first(){return stmt.get(...args);},run(){return stmt.run(...args);}};}}};
 const session=(cookie,club='sena')=>worker.fetch(new Request('https://example.com/api/session?club='+club,{headers:cookie?{Cookie:cookie}:{}}),env);
 const guest=await session();assert.equal(guest.headers.get('Cache-Control'),'no-store');assert.deepEqual(await guest.json(),{canEdit:false});
 const login=await worker.fetch(new Request('https://example.com/api/login',{method:'POST',headers:{Origin:'https://example.com'},body:JSON.stringify({key:env.ADMIN_KEY})}),env);
 const cookie=login.headers.get('Set-Cookie').split(';')[0];
 assert.deepEqual(await(await session(cookie)).json(),{canEdit:true});assert.deepEqual(await(await session(cookie,'88')).json(),{canEdit:true});
 assert.deepEqual(await(await session(cookie+'x')).json(),{canEdit:false});assert.deepEqual(await(await session('__Host-sena=1.'+'0'.repeat(64))).json(),{canEdit:false});
 const out=await worker.fetch(new Request('https://example.com/api/logout',{method:'POST',headers:{Origin:'https://example.com',Cookie:cookie}}),env);
 assert.match(out.headers.get('Set-Cookie'),/Max-Age=0/);assert.deepEqual(await(await session(out.headers.get('Set-Cookie').split(';')[0])).json(),{canEdit:false});
});
