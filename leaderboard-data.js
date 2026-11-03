// Historical cumulative totals supplied by the organizer on 3 Nov 2026.
// These totals do not imply dates or individual historical Cup results.
export const baseline = [
 ['Nut',12,10,2,239,189,1,0,2],['Bo',12,9,3,231,194,1,0,null],
 ['Pete',8,7,1,160,119,1,0,3],['Bomb',12,6,6,225,202,2,1,-3],
 ['Bua',8,5,3,153,145,1,0,-1],['Noon',8,4,4,147,137,1,0,-1],
 ['Wit',12,4,8,205,238,0,0,null],['Arm',4,3,1,73,71,0,0,'NEW'],
 ['Not',4,2,2,68,69,0,0,'NEW'],['Mac',4,2,2,77,80,0,0,-2],
 ['Mhee',4,2,2,69,78,0,0,-2],['Top',8,2,6,123,153,0,1,-1],
 ['Vin',4,1,3,72,79,0,0,'NEW'],['Zong',4,0,4,65,84,1,1,-4],
 ['Tom',12,0,12,180,252,0,3,-3]
].map(([name,played,w,l,pf,pa,crown,poo,change],index)=>({name,played,w,l,pf,pa,crown,poo,change,position:index+1}));
