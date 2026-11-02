(function(root){
function valid(a,b){const f=t=>t.filter(p=>p.gender==='F').length;return !((f(a)===2&&f(b)===1)||(f(b)===2&&f(a)===1));}
function generate(players,rounds=10,locks=[],trials=90,candidateLimit=0){
 if(players.length>24)throw Error('รองรับผู้เล่นที่เลือกสูงสุด 24 คนต่อครั้ง');
 if(players.length<8)throw Error('ต้องมีอย่างน้อย 8 คน เพื่อให้ทุกคนพักในรอบถัดไป');
 const ids=new Set(players.map(p=>p.id));const lm={};
 for(const l of locks){if(l.round<1||l.round>rounds||lm[l.round])throw Error('รอบล็อกซ้ำหรืออยู่นอกตาราง');if(new Set(l.ids).size!==4||l.ids.some(id=>!ids.has(id)))throw Error('คู่พิเศษต้องเป็นผู้เล่นที่เลือก 4 คนไม่ซ้ำ');const ps=l.ids.map(id=>players.find(p=>p.id===id));if(!valid(ps.slice(0,2),ps.slice(2)))throw Error('คู่พิเศษขัดกติกา: ห้าม ญญ พบ ชญ');lm[l.round]=ps;}
 for(let r=2;r<=rounds;r++)if(lm[r]&&lm[r-1]&&lm[r].some(p=>lm[r-1].includes(p)))throw Error('คู่พิเศษทำให้ผู้เล่นลงติดกัน');
 let best=null,bestScore=Infinity;
 for(let trial=0;trial<trials;trial++){
 const counts=Object.fromEntries(players.map(p=>[p.id,0])),pairs={},schedule=[];let prev=[],cost=0,failed=false;
 for(let r=1;r<=rounds;r++){
 let candidates=[]; const next=lm[r+1]||[];
 if(lm[r]){if(lm[r].some(p=>prev.includes(p))) {failed=true;break;}candidates=[lm[r]];}
 else {const avail=players.filter(p=>!prev.includes(p)&&!next.includes(p));if(candidateLimit && avail.length>8) {
  for(let sample=0;sample<candidateLimit;sample++){
    const pool=avail.slice(),q=[];
    for(let pick=0;pick<4;pick++) q.push(pool.splice(Math.floor(Math.random()*pool.length),1)[0]);
    candidates.push(q);
  }
} else for(let a=0;a<avail.length-3;a++)for(let b=a+1;b<avail.length-2;b++)for(let c=b+1;c<avail.length-1;c++)for(let d=c+1;d<avail.length;d++){let q=[avail[a],avail[b],avail[c],avail[d]];candidates.push(q,[q[0],q[2],q[1],q[3]],[q[0],q[3],q[1],q[2]]);}}
 let chosen=null,min=Infinity;
 for(const q of candidates){if(!valid(q.slice(0,2),q.slice(2)))continue;const diff=Math.abs(q[0].lv+q[1].lv-q[2].lv-q[3].lv);const key=(a,b)=>[a.id,b.id].sort().join('|');let s=q.reduce((s,p)=>s+counts[p.id]*30,0)+diff*4+(pairs[key(q[0],q[1])]||0)*4+(pairs[key(q[2],q[3])]||0)*4+Math.random()*22;if(s<min){min=s;chosen=q;}}
 if(!chosen){failed=true;break;}prev=chosen;chosen.forEach(p=>counts[p.id]++);for(const t of [chosen.slice(0,2),chosen.slice(2)]){let k=t.map(p=>p.id).sort().join('|');pairs[k]=(pairs[k]||0)+1;}const diff=Math.abs(chosen[0].lv+chosen[1].lv-chosen[2].lv-chosen[3].lv);cost+=diff*diff;schedule.push({round:r,ids:chosen.map(p=>p.id),diff,locked:!!lm[r]});
 }
 if(failed)continue;let score=Object.values(counts).reduce((s,n)=>s+(n-rounds*4/players.length)**2,0)*1000+cost*5+Object.values(pairs).reduce((s,n)=>s+n*n,0);if(score<bestScore){bestScore=score;best={schedule,counts};}
 }
 if(!best)throw Error('ยังจัดตารางตามเงื่อนไขนี้ไม่ได้ ลองเพิ่มผู้เล่นหรือลดคู่ล็อก');return best;
}
function roundRobin(teams){let matches=[];for(let i=0;i<teams.length;i++)for(let j=i+1;j<teams.length;j++)matches.push({a:i,b:j,sa:'',sb:''});return matches;}
function standings(teams,matches){let rows=teams.map((t,i)=>({i,name:t.join(' / '),played:0,w:0,pf:0,pa:0}));matches.forEach(m=>{if(m.sa===''||m.sb==='')return;let a=+m.sa,b=+m.sb;if(!Number.isInteger(a)||!Number.isInteger(b)||a<0||b<0||a===b)return;rows[m.a].played++;rows[m.b].played++;rows[m.a].pf+=a;rows[m.a].pa+=b;rows[m.b].pf+=b;rows[m.b].pa+=a;rows[a>b?m.a:m.b].w++;});return rows.sort((a,b)=>b.w-a.w||(b.pf-b.pa)-(a.pf-a.pa)||b.pf-a.pf);}
root.Sena={generate,valid,roundRobin,standings};if(typeof module!=='undefined')module.exports=root.Sena;
})(typeof window==='undefined'?globalThis:window);
