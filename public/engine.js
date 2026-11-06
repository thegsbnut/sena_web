(function(root){
function valid(a,b){const f=t=>t.filter(p=>p.gender==='F').length;return !((f(a)===2&&f(b)===1)||(f(b)===2&&f(a)===1));}
const pairings=([a,b,c,d])=>[[a,b,c,d],[a,c,b,d],[a,d,b,c]];
function generate(players,rounds=10,locks=[],trials=90,candidateLimit=0,{matchAllowed=valid,randomWeight=22,acceptSchedule}={}){
 const allowed=q=>matchAllowed(q.slice(0,2),q.slice(2));
 const sampleAbove=matchAllowed!==valid&&players.length>8?7:8;
 if(players.length>24)throw Error('รองรับผู้เล่นที่เลือกสูงสุด 24 คนต่อครั้ง');
 if(players.length<8)throw Error('ต้องมีอย่างน้อย 8 คน เพื่อให้ทุกคนพักในรอบถัดไป');
 const ids=new Set(players.map(p=>p.id));const lm={};
 for(const l of locks){if(l.round<1||l.round>rounds||lm[l.round])throw Error('รอบล็อกซ้ำหรืออยู่นอกตาราง');if(new Set(l.ids).size!==4||l.ids.some(id=>!ids.has(id)))throw Error('คู่พิเศษต้องเป็นผู้เล่นที่เลือก 4 คนไม่ซ้ำ');const ps=l.ids.map(id=>players.find(p=>p.id===id));if(!allowed(ps))throw Error('คู่พิเศษขัดกติกา: ห้าม ญญ พบ ชญ');lm[l.round]=ps;}
 for(let r=2;r<=rounds;r++)if(lm[r]&&lm[r-1]&&lm[r].some(p=>lm[r-1].includes(p)))throw Error('คู่พิเศษทำให้ผู้เล่นลงติดกัน');
 let best=null,bestScore=Infinity;
 for(let trial=0;trial<trials;trial++){
 const counts=Object.fromEntries(players.map(p=>[p.id,0])),pairs={},schedule=[];let prev=[],cost=0,failed=false;
 for(let r=1;r<=rounds;r++){
 let candidates=[]; const next=lm[r+1]||[];
 if(lm[r]){if(lm[r].some(p=>prev.includes(p))) {failed=true;break;}candidates=[lm[r]];}
 else {const avail=players.filter(p=>!prev.includes(p)&&!next.includes(p));if(candidateLimit && avail.length>sampleAbove) {
  for(let sample=0;sample<candidateLimit;sample++){
    const pool=avail.slice(),q=[];
    for(let pick=0;pick<4;pick++) q.push(pool.splice(Math.floor(Math.random()*pool.length),1)[0]);
    candidates.push(q);
  }
} else for(let a=0;a<avail.length-3;a++)for(let b=a+1;b<avail.length-2;b++)for(let c=b+1;c<avail.length-1;c++)for(let d=c+1;d<avail.length;d++){candidates.push(...pairings([avail[a],avail[b],avail[c],avail[d]]));}}
 // With exactly eight players, the first game's resting four must also form a legal match.
 if(matchAllowed!==valid&&players.length===8&&r===1&&rounds>1){
  candidates=candidates.filter(q=>pairings(players.filter(p=>!q.includes(p))).some(allowed));
 }
 let chosen=null,min=Infinity;
 for(const q of candidates){if(!allowed(q))continue;const diff=Math.abs(q[0].lv+q[1].lv-q[2].lv-q[3].lv);const key=(a,b)=>[a.id,b.id].sort().join('|');let s=q.reduce((s,p)=>s+counts[p.id]*30,0)+diff*4+(pairs[key(q[0],q[1])]||0)*4+(pairs[key(q[2],q[3])]||0)*4+Math.random()*randomWeight;if(s<min){min=s;chosen=q;}}
 if(!chosen){failed=true;break;}prev=chosen;chosen.forEach(p=>counts[p.id]++);for(const t of [chosen.slice(0,2),chosen.slice(2)]){let k=t.map(p=>p.id).sort().join('|');pairs[k]=(pairs[k]||0)+1;}const diff=Math.abs(chosen[0].lv+chosen[1].lv-chosen[2].lv-chosen[3].lv);cost+=diff*diff;schedule.push({round:r,ids:chosen.map(p=>p.id),diff,locked:!!lm[r]});
 }
 if(failed||acceptSchedule&&!acceptSchedule(schedule))continue;let score=Object.values(counts).reduce((s,n)=>s+(n-rounds*4/players.length)**2,0)*1000+cost*5+Object.values(pairs).reduce((s,n)=>s+n*n,0);if(score<bestScore){bestScore=score;best={schedule,counts};}
 }
 if(!best)throw Error('ยังจัดตารางตามเงื่อนไขนี้ไม่ได้ ลองเพิ่มผู้เล่นหรือลดคู่ล็อก');return best;
}
function cupRestConflicts(matches) {
 return matches.slice(1).reduce((total,match,index) => {
   const previous=matches[index];
   return total + Number(match.a===previous.a || match.a===previous.b) + Number(match.b===previous.a || match.b===previous.b);
 },0);
}
function roundRobin(teams) {
 const matches=[];
 for(let a=0;a<teams.length;a++) for(let b=a+1;b<teams.length;b++) matches.push({a,b,sa:'',sb:''});
 let best=matches, bestCost=cupRestConflicts(matches);
 for(let trial=0;trial<100 && bestCost>0;trial++) {
   const remaining=matches.slice(), ordered=[], lastPlayed=Array(teams.length).fill(-1);
   while(remaining.length) {
     const previous=ordered[ordered.length-1];
     let bestIndex=0, bestScore=Infinity;
     for(let index=0;index<remaining.length;index++) {
       const match=remaining[index];
       const overlap=previous ? Number(match.a===previous.a || match.a===previous.b)+Number(match.b===previous.a || match.b===previous.b) : 0;
       const score=overlap*10000 + Math.max(lastPlayed[match.a],lastPlayed[match.b])*2 + Math.random()*10;
       if(score<bestScore) {bestScore=score;bestIndex=index;}
     }
     const match=remaining.splice(bestIndex,1)[0];
     lastPlayed[match.a]=lastPlayed[match.b]=ordered.length;
     ordered.push(match);
   }
   const cost=cupRestConflicts(ordered);
   if(cost<bestCost) {best=ordered;bestCost=cost;}
 }
 return best;
}
function standings(teams,matches){let rows=teams.map((t,i)=>({i,name:t.join(' / '),played:0,w:0,pf:0,pa:0}));matches.forEach(m=>{if(m.sa===''||m.sb==='')return;let a=+m.sa,b=+m.sb;if(!Number.isInteger(a)||!Number.isInteger(b)||a<0||b<0||a===b)return;rows[m.a].played++;rows[m.b].played++;rows[m.a].pf+=a;rows[m.a].pa+=b;rows[m.b].pf+=b;rows[m.b].pa+=a;rows[a>b?m.a:m.b].w++;});return rows.sort((a,b)=>b.w-a.w||(b.pf-b.pa)-(a.pf-a.pa)||b.pf-a.pf);}
function cupAwards(cup) {
 const medals = new Map();
 if (!cup || cup.teams.length < 2 || !cup.matches.length || !cup.matches.every(m =>
   Number.isInteger(m.sa) && Number.isInteger(m.sb) && m.sa >= 0 && m.sb >= 0 && m.sa !== m.sb)) return medals;
 const rows = standings(cup.teams,cup.matches);
 const equal = (a,b) => a.w===b.w && a.pf-a.pa===b.pf-b.pa && a.pf===b.pf;
 for (const row of rows) {
   const badge = equal(row,rows[0]) ? '🥇' : equal(row,rows[rows.length-1]) ? '💩' : '';
   if (badge) for (const name of cup.teams[row.i]) medals.set(name.trim().toLowerCase(),badge);
 }
 return medals;
}
root.Sena={generate,valid,roundRobin,standings,cupAwards,cupRestConflicts};if(typeof module!=='undefined')module.exports=root.Sena;
})(typeof window==='undefined'?globalThis:window);
