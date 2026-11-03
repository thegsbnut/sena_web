// Public Cup history only. Aggregate per-person relations; never read roster levels.
globalThis.SenaBuddy={
 minimum:3,
 calculate(history){
  const people=new Map(),seen=new Set();
  const key=name=>name.trim().toLowerCase();
  const person=name=>{const id=key(name);if(!people.has(id))people.set(id,{name:name.trim(),buddies:new Map(),rivals:new Map()});return people.get(id);};
  const add=(map,name,won)=>{const id=key(name),row=map.get(id)||{name:name.trim(),n:0,w:0,l:0};row.n++;row.w+=Number(won);row.l+=Number(!won);map.set(id,row);};
  for(const cup of history){
   if(cup.id&&seen.has(cup.id))continue;if(cup.id)seen.add(cup.id);
   if(!Array.isArray(cup.teams)||!Array.isArray(cup.matches))continue;
   for(const m of cup.matches){
    if(!Number.isInteger(m.sa)||!Number.isInteger(m.sb)||m.sa<0||m.sb<0||m.sa===m.sb||m.a===m.b)continue;
    const a=cup.teams[m.a],b=cup.teams[m.b];
    if(![a,b].every(t=>Array.isArray(t)&&t.length===2&&t.every(n=>typeof n==='string'&&n.trim()))||new Set([...a,...b].map(key)).size!==4)continue;
    for(const [team,opponents,won] of [[a,b,m.sa>m.sb],[b,a,m.sb>m.sa]])for(let i=0;i<2;i++){
     const p=person(team[i]);add(p.buddies,team[1-i],won);for(const opponent of opponents)add(p.rivals,opponent,won);
    }
   }
  }
  return [...people.values()].map(p=>({name:p.name,buddies:[...p.buddies.values()],rivals:[...p.rivals.values()]}));
 },
 rows(profile,kind){
  const rows=(kind===2?profile.rivals:profile.buddies).map(r=>({...r,percent:r.w/r.n*100,eligible:r.n>=this.minimum}));
  return rows.sort((a,b)=>Number(b.eligible)-Number(a.eligible)||(kind===0?b.w/b.n-a.w/a.n:a.w/a.n-b.w/b.n)||b.n-a.n||a.name.localeCompare(b.name));
 },
 highlights(profile){
  const best=this.rows(profile,0).find(r=>r.eligible)||null;
  const worst=this.rows(profile,1).find(r=>r.eligible&&r.l>0&&r.name.toLowerCase()!==best?.name.toLowerCase())||null;
  const rival=this.rows(profile,2).find(r=>r.eligible&&r.l>0)||null;
  return [best,worst,rival];
 },
 text(profile,club){
  const labels=['😇 คู่หูสวรรค์สร้าง','💀 คู่หูอย่าเจอกันอีกเลย','🐍 ศัตรูทางธรรมชาติ'];
  return '🏸 เปิดแฟ้มลับ '+profile.name+' • '+club+'\n'+this.highlights(profile).map((r,i)=>labels[i]+': '+(r?r.name+' — '+(i===2?'เจอกัน':'จับคู่กัน')+' '+r.n+' เกม ชนะ '+r.w+' แพ้ '+r.l:'รอสะสมสถิติ')).join('\n')+'\n🔥 นัดหน้า ถึงเวลาเปลี่ยนชะตา!';
 }
};
