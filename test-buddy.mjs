import {test} from 'node:test';
import assert from 'node:assert/strict';
import './public/buddy-stats.js';
const buddy=globalThis.SenaBuddy;
const event=(id,teams=[['A','B'],['C','D']],sa=21,sb=10)=>({id,teams,matches:[{a:0,b:1,sa,sb}]});
test('each match records one partner and two individual rivals, with opposite wins/losses',()=>{
 const result=buddy.calculate([event('one')]);
 const a=result.find(p=>p.name==='A'),c=result.find(p=>p.name==='C');
 assert.deepEqual(a.buddies,[{name:'B',n:1,w:1,l:0}]);
 assert.deepEqual(a.rivals,[{name:'C',n:1,w:1,l:0},{name:'D',n:1,w:1,l:0}]);
 assert.deepEqual(c.buddies,[{name:'D',n:1,w:0,l:1}]);
 assert.equal(buddy.highlights(a)[0],null);
});
test('three games qualify; empty and partial history do not invent results',()=>{
 const records=[event('one'),event('two'),event('three')];
 assert.equal(buddy.highlights(buddy.calculate(records.slice(0,2))[0])[0],null);
 assert.equal(buddy.highlights(buddy.calculate(records)[0])[0].n,3);
 assert.deepEqual(buddy.calculate([]),[]);
 assert.deepEqual(buddy.calculate([{...event('blank'),matches:[{a:0,b:1,sa:'',sb:''}]},event('tie',undefined,21,21)]),[]);
});
test('best, distinct worst buddy and natural enemy use win rates and recompute from edited history',()=>{
 const records=Array.from({length:3},(_,i)=>event('best'+i)).concat(Array.from({length:3},(_,i)=>event('worst'+i,[['A','C'],['B','D']],10,21)));
 const a=buddy.calculate(records).find(p=>p.name==='A');
 const [best,worst,rival]=buddy.highlights(a);assert.equal(best.name,'B');assert.equal(worst.name,'C');assert.equal(rival.name,'B');
 assert.equal(best.n,3);assert.equal(worst.w,0);
 const edited=structuredClone(records);edited.at(-1).matches[0]={a:0,b:1,sa:21,sb:10};
 assert.equal(buddy.calculate(edited).find(p=>p.name==='A').buddies.find(p=>p.name==='C').w,1);
 assert.equal(buddy.calculate(records).find(p=>p.name==='A').buddies.find(p=>p.name==='C').w,0);
});
test('duplicate record IDs do not count twice, detailed baseline events count, and output contains public fields only',()=>{
 const e=event('same');e.inBaseline=true;e.lv=99;e.secret='not for output';
 const a=buddy.calculate([e,e]).find(p=>p.name==='A');assert.equal(a.buddies[0].n,1);
 assert(!JSON.stringify(a).includes('secret'));assert(!JSON.stringify(a).includes('lv'));
 const text=buddy.text(a,'88');assert(text.includes('88'));assert(text.includes('รอสะสมสถิติ'));assert(!text.includes('Lv'));
});
test('new club and no eligible relations show empty highlights; never name the same buddy as both best and worst',()=>{
 assert.deepEqual(buddy.highlights({name:'New',buddies:[],rivals:[]}),[null,null,null]);
 const p={name:'A',buddies:[{name:'B',n:3,w:1,l:2}],rivals:[{name:'C',n:3,w:3,l:0}]};
 assert.equal(buddy.highlights(p)[0].name,'B');assert.equal(buddy.highlights(p)[1],null);assert.equal(buddy.highlights(p)[2],null);
});
