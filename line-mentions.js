// Shared by the real-group tagtest command and billing reminders.
export function mentionMessage(userIds,prefix,suffix=''){
 const ids=[...new Set(userIds)].filter(id=>/^U[a-f0-9]{32}$/.test(id)).slice(0,20);
 if(!ids.length)return null;
 const substitution=Object.fromEntries(ids.map((userId,i)=>['friend'+i,{type:'mention',mentionee:{type:'user',userId}}]));
 return {type:'textV2',text:prefix+ids.map((_,i)=>'{friend'+i+'}').join(' ')+suffix,substitution};
}
