// Share the same parsing rules when building scores and checking a submission.
globalThis.SenaHistoryForm = {
 parseTeams(text){return text.split(/\r?\n/).map(line=>line.trim()).filter(Boolean).map(line=>line.split('/').map(name=>name.trim()));},
 sameTeams(text,teams){return JSON.stringify(this.parseTeams(text))===JSON.stringify(teams);},
 newId(source=globalThis.crypto){
  if(typeof source?.randomUUID==='function')return source.randomUUID();
  const bytes=source.getRandomValues(new Uint8Array(16));
  return 'history-'+Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
 }
};
