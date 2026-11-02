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
