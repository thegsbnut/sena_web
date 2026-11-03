import {baseline} from './leaderboard-data.js';
import './public/engine.js';
const canonicalName = name => ({nott:'Not',not:'Not',beau:'Bo',bo:'Bo'}[name.trim().toLowerCase()] || name.trim());
const key = name => canonicalName(name).toLowerCase();
export function cleanCup(value) {
 if(!value || typeof value.title!=='string' || !value.title.trim() || value.title.length>100 || !/^\d{4}-\d{2}-\d{2}$/.test(value.date) || (Number.isNaN(Date.parse(value.date+'T00:00:00Z')) || new Date(value.date+'T00:00:00Z').toISOString().slice(0,10)!==value.date) || typeof value.inBaseline!=='boolean') throw Error('กรอกชื่อรายการ วันที่ และสถานะยอดตั้งต้นให้ครบ');
 const teams=value.teams;
 if(!Array.isArray(teams) || teams.length<2 || teams.length>20 || !teams.every(team=>Array.isArray(team)&&team.length===2&&team.every(name=>typeof name==='string'&&name.trim()&&name.length<=100)))throw Error('ต้องมี 2–20 ทีม ทีมละ 2 คน');
 const names=teams.flat().map(key);
 if(new Set(names).size!==names.length)throw Error('ผู้เล่นต้องอยู่ทีมเดียวต่อรายการ');
 const matches=value.matches;
 if(!Array.isArray(matches)||matches.length!==teams.length*(teams.length-1)/2)throw Error('ต้องกรอกผลพบกันหมดให้ครบทุกคู่');
 const pairs=new Set();
 for(const m of matches){
  if(!m || !Number.isInteger(m.a)||!Number.isInteger(m.b)||m.a<0||m.b<0||m.a>=teams.length||m.b>=teams.length||m.a===m.b || !['sa','sb'].every(k=>Number.isInteger(m[k])&&m[k]>=0&&m[k]<=999)||m.sa===m.sb)throw Error('คะแนนต้องครบ เป็นจำนวนเต็ม 0–999 และไม่เสมอ');
  pairs.add([m.a,m.b].sort((a,b)=>a-b).join(','));
 }
 if(pairs.size!==matches.length)throw Error('คู่แข่งขันซ้ำ');
 return {title:value.title.trim(),date:value.date,inBaseline:value.inBaseline,teams:teams.map(t=>t.map(canonicalName)),matches:matches.map(({a,b,sa,sb})=>({a,b,sa,sb}))};
}
function addCup(totals,cup){
 const rows=globalThis.Sena.standings(cup.teams,cup.matches);
 const equal=(a,b)=>a.w===b.w&&a.pf-a.pa===b.pf-b.pa&&a.pf===b.pf;
 for(const row of rows)for(const name of cup.teams[row.i]){
  const id=key(name),p=totals.get(id)||{name:canonicalName(name),played:0,w:0,l:0,pf:0,pa:0,crown:0,poo:0};
  p.played+=row.played;p.w+=row.w;p.l+=row.played-row.w;p.pf+=row.pf;p.pa+=row.pa;
  if(equal(row,rows[0]))p.crown++;
  else if(equal(row,rows[rows.length-1]))p.poo++;
  totals.set(id,p);
 }
}
function ordered(cups){
 const totals=new Map(baseline.map(p=>[key(p.name),{...p}]));
 for(const cup of cups)addCup(totals,cup);
 return [...totals.values()].sort((a,b)=>b.w-a.w||(b.pf-b.pa)-(a.pf-a.pa)||b.pf-a.pf||a.name.localeCompare(b.name));
}
export function standings(history){
 const counted=history.filter(c=>!c.inBaseline).sort((a,b)=>a.sequence-b.sequence);
 if(!counted.length)return baseline.map(p=>({...p,diff:p.pf-p.pa,winPercent:p.w/p.played*100}));
 const previous=ordered(counted.slice(0,-1)),ranks=new Map(previous.map((p,i)=>[key(p.name),i+1]));
 return ordered(counted).map((p,i)=>({...p,position:i+1,diff:p.pf-p.pa,winPercent:p.played?p.w/p.played*100:0,change:ranks.has(key(p.name))?ranks.get(key(p.name))-(i+1):'NEW'}));
}
export async function leaderboardRoute(req,env,isAdmin){
 const reply=(value,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store'}});
 if(req.method!=='GET'&&!isAdmin)return reply({error:'กรุณาเข้าสู่ระบบผู้จัด'},401);
 if(!env.DB)return reply({error:'ยังไม่ได้ตั้งค่าฐานข้อมูล'},503);
 await env.DB.prepare('CREATE TABLE IF NOT EXISTS cup_history (id TEXT PRIMARY KEY, revision INTEGER NOT NULL, sequence INTEGER NOT NULL, payload TEXT NOT NULL)').run();
 if(req.method==='POST'){
  let input;
  try{const text=await req.text();if(text.length>100000)throw Error('ข้อมูลใหญ่เกินไป');input=JSON.parse(text);input.cup=cleanCup(input.cup);if(typeof input.id!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(input.id)||!Number.isInteger(input.revision)||input.revision<0)throw Error('ข้อมูลรายการไม่ถูกต้อง');}
  catch(error){return reply({error:error.message},400);}
  const payload=JSON.stringify(input.cup);
  const result=input.revision===0
   ? await env.DB.prepare('INSERT OR IGNORE INTO cup_history (id,revision,sequence,payload) VALUES (?,1,(SELECT COALESCE(MAX(sequence),0)+1 FROM cup_history),?)').bind(input.id,payload).run()
   : await env.DB.prepare('UPDATE cup_history SET payload=?,revision=revision+1 WHERE id=? AND revision=?').bind(payload,input.id,input.revision).run();
  if(result.meta.changes!==1)return reply({error:'รายการนี้บันทึกแล้วหรือมีการแก้จากอีกเครื่อง กรุณาโหลดประวัติใหม่ก่อน'},409);
  return reply({ok:true,revision:input.revision+1});
 }
 if(req.method!=='GET')return reply({error:'Method not allowed'},405);
 const result=await env.DB.prepare('SELECT id,revision,sequence,payload FROM cup_history ORDER BY sequence').all();
 const history=result.results.map(row=>{const cup=JSON.parse(row.payload);return {...cup,teams:cup.teams.map(team=>team.map(canonicalName)),id:row.id,revision:row.revision,sequence:row.sequence};});
 return reply({history,standings:standings(history),canEdit:isAdmin});
}
