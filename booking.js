import './public/engine.js';
import {holidayOn,HOLIDAY_YEARS} from './booking-holidays.js';
const reply=(v,status=200)=>Response.json(v,{status,headers:{'Cache-Control':'no-store'}});
export class BookingError extends Error {constructor(message,status=400){super(message);this.status=status;}}
const fail=(message,status=400)=>{throw new BookingError(message,status);};
export const defaultSettings=()=>({enabled:false,weekdays:[2,4],start:'18:00',end:'21:00',capacity:12,rounds:10,weeks:4,regularIds:[],holidayPolicy:'warn',holidays:[]});
export const bangkokDate=(now=new Date())=>new Date(+now+7*3600000).toISOString().slice(0,10);
const addDays=(date,n)=>new Date(Date.parse(date+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
const startsAt=s=>Date.parse(s.date+'T'+s.start+':00+07:00');
const validDate=d=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&!Number.isNaN(Date.parse(d))&&new Date(d+'T00:00:00Z').toISOString().slice(0,10)===d;
const validTime=t=>typeof t==='string'&&/^([01]\d|2[0-3]):[0-5]\d$/.test(t);
const integer=(v,min,max)=>Number.isInteger(v)&&v>=min&&v<=max;
export function validateSettings(input,roster) {
 if(!input||typeof input.enabled!=='boolean'||!Array.isArray(input.weekdays)||!input.weekdays.length||input.weekdays.length>7||new Set(input.weekdays).size!==input.weekdays.length||!input.weekdays.every(d=>integer(d,0,6))||!validTime(input.start)||!validTime(input.end)||input.end<=input.start||!integer(input.capacity,8,24)||!integer(input.rounds,1,30)||!integer(input.weeks,1,8)||!Array.isArray(input.regularIds)||input.regularIds.length>200||new Set(input.regularIds).size!==input.regularIds.length||!input.regularIds.every(id=>roster.some(p=>p.id===id))||!['warn','skip'].includes(input.holidayPolicy)||!Array.isArray(input.holidays)||input.holidays.length>100||!input.holidays.every(h=>h&&validDate(h.date)&&typeof h.name==='string'&&h.name.trim()&&h.name.length<=100))fail('ตรวจวัน เวลา จำนวนคน และรายชื่อขาประจำอีกครั้ง');
 return {...input,weekdays:[...input.weekdays].sort(),holidays:input.holidays.map(h=>({date:h.date,name:h.name.trim()})),regularIds:[...input.regularIds]};
}
async function prepare(DB) {
 await DB.prepare('CREATE TABLE IF NOT EXISTS booking_clubs (club TEXT PRIMARY KEY, revision INTEGER NOT NULL, payload TEXT NOT NULL, updated_at TEXT NOT NULL)').run();
 await DB.prepare('INSERT OR IGNORE INTO booking_clubs (club,revision,payload,updated_at) VALUES (?,0,?,?)').bind('sena',JSON.stringify({settings:defaultSettings(),settingsVersion:0,sessions:[],seq:0}),new Date().toISOString()).run();
 await DB.prepare('INSERT OR IGNORE INTO booking_clubs (club,revision,payload,updated_at) VALUES (?,0,?,?)').bind('88',JSON.stringify({settings:defaultSettings(),settingsVersion:0,sessions:[],seq:0}),new Date().toISOString()).run();
}
async function rosterFor(DB,club) {
 const table=club==='88'?'club_state_88':'club_state';
 // A newly configured club need not have a roster yet.
 await DB.prepare(`CREATE TABLE IF NOT EXISTS ${table} (id INTEGER PRIMARY KEY,revision INTEGER NOT NULL,payload TEXT NOT NULL,updated_at TEXT NOT NULL)`).run();
 const row=await DB.prepare(`SELECT payload FROM ${table} WHERE id=1`).first();
 return row?JSON.parse(row.payload).players:[];
}
export function materialize(doc,players,now=new Date()) {
 const cfg=doc.settings,today=bangkokDate(now),rosterIds=new Set(players.map(p=>p.id));
 // Retain a month of recent sessions; current/future bookings are never pruned.
 doc.sessions=doc.sessions.filter(s=>s.date>=addDays(today,-30));
 if(cfg.enabled){
  for(let n=0;n<cfg.weeks*7;n++){
   const date=addDays(today,n);
   if(!cfg.weekdays.includes(new Date(date+'T00:00:00Z').getUTCDay())||Date.parse(date+'T'+cfg.start+':00+07:00')<=+now)continue;
   let s=doc.sessions.find(x=>x.id===date);
   if(!s){s={id:date,date,start:cfg.start,end:cfg.end,capacity:cfg.capacity,rounds:cfg.rounds,registrations:[],regularSeen:[],hasFilled:false,schedule:null,scheduleVersion:0,fingerprint:'',closed:false};doc.sessions.push(s);}
   if(startsAt(s)<=+now)continue;
   // An explicit settings save updates the future slots; regular decisions are
   // remembered so a canceled regular is never silently re-added on the next GET.
   for(const id of cfg.regularIds){
    if(!rosterIds.has(id)||s.regularSeen.includes(id))continue;
    s.regularSeen.push(id);
    if(!s.registrations.some(r=>r.playerId===id))s.registrations.push({id:crypto.randomUUID(),playerId:id,seq:++doc.seq,source:'regular',ownerHash:null,createdAt:now.toISOString()});
   }
  }
 }
 for(const s of doc.sessions){
  s.holiday=holidayOn(s.date,cfg.holidays);
  s.skipped=!!s.holiday&&cfg.holidayPolicy==='skip';
  s.registrations=s.registrations.filter(r=>rosterIds.has(r.playerId));
  s.registrations.sort((a,b)=>a.seq-b.seq);
 }
 doc.sessions.sort((a,b)=>a.date.localeCompare(b.date));
}
export function refreshSchedules(doc,players,now=new Date()) {
 // Identical weekly rosters can share a draw; avoid repeating expensive work
 // when materializing several weeks of regular bookings in one request.
 const draws=new Map(doc.sessions.filter(s=>s.scheduleStatus==='ready'&&s.schedule).map(s=>[s.fingerprint,s.schedule]));
 for(const s of doc.sessions){
  if(startsAt(s)<=+now)continue;
  const ids=s.registrations.slice(0,s.capacity).map(r=>r.playerId);
  if(ids.length===s.capacity)s.hasFilled=true;
  const chosen=ids.map(id=>players.find(p=>p.id===id)).filter(Boolean);
  const fingerprint=JSON.stringify([ids,s.rounds,chosen.map(p=>[p.lv,p.gender]),s.skipped,s.closed,doc.settings.enabled]);
  if(fingerprint===s.fingerprint)continue;
  s.fingerprint=fingerprint;
  if(!s.hasFilled){s.schedule=null;s.scheduleStatus='waiting';continue;}
  s.scheduleVersion++;s.scheduleUpdatedAt=now.toISOString();
  if(s.closed||s.skipped||!doc.settings.enabled){s.schedule=null;s.scheduleStatus='closed';continue;}
  if(chosen.length<8){s.schedule=null;s.scheduleStatus='insufficient';continue;}
  try {
   if(draws.has(fingerprint))s.schedule=draws.get(fingerprint);
   else {const result=globalThis.Sena.generate(chosen,s.rounds,[],1,40);
    s.schedule={schedule:result.schedule.map(({round,ids})=>({round,ids})),counts:result.counts};draws.set(fingerprint,s.schedule);}
   s.scheduleStatus='ready';
  } catch {s.schedule=null;s.scheduleStatus='failed';}
 }
}
async function ownerHash(req) {
 const token=req.headers.get('X-Booking-Token');
 if(!token)return null;
 if(!/^[a-f0-9]{64}$/.test(token))fail('รหัสจัดการการจองไม่ถูกต้อง');
 return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token)))].map(x=>x.toString(16).padStart(2,'0')).join('');
}
export function publicBooking(doc,revision,players,admin,owner,now=new Date()) {
 const cfg=doc.settings;
 return {revision,canEdit:admin,settingsVersion:doc.settingsVersion,settings:admin?cfg:{enabled:cfg.enabled,weekdays:cfg.weekdays,start:cfg.start,end:cfg.end,capacity:cfg.capacity,weeks:cfg.weeks,holidayPolicy:cfg.holidayPolicy},holidayYears:HOLIDAY_YEARS,roster:players.map(({id,name,thai})=>({id,name,thai})),serverNow:now.toISOString(),sessions:doc.sessions.filter(s=>startsAt(s)>+now).map(s=>({
  id:s.id,date:s.date,start:s.start,end:s.end,capacity:s.capacity,rounds:s.rounds,holiday:s.holiday,skipped:s.skipped,closed:s.closed,confirmedCount:Math.min(s.registrations.length,s.capacity),waitlistCount:Math.max(0,s.registrations.length-s.capacity),schedule:s.schedule,scheduleVersion:s.scheduleVersion,scheduleUpdatedAt:s.scheduleUpdatedAt,scheduleStatus:s.scheduleStatus,
  registrations:s.registrations.map((r,i)=>({id:r.id,playerId:r.playerId,source:r.source,status:i<s.capacity?'confirmed':'waitlist',position:i<s.capacity?i+1:i-s.capacity+1,canCancel:admin||!!owner&&r.ownerHash===owner}))
 }))};
}
export async function mutateBooking(env,club,operation,now=new Date()) {
 if(!env.DB)fail('ยังไม่ได้ผูกฐานข้อมูล DB',503);
 await prepare(env.DB);
 for(let attempt=0;attempt<8;attempt++){
  const row=await env.DB.prepare('SELECT revision,payload FROM booking_clubs WHERE club=?').bind(club).first();
  const doc=JSON.parse(row.payload),before=row.payload,players=await rosterFor(env.DB,club);
  materialize(doc,players,now);
  const result=operation?await operation(doc,players):null;
  materialize(doc,players,now);refreshSchedules(doc,players,now);
  const payload=JSON.stringify(doc);
  if(payload===before)return {doc,revision:row.revision,players,result};
  const update=await env.DB.prepare('UPDATE booking_clubs SET payload=?,revision=revision+1,updated_at=? WHERE club=? AND revision=?').bind(payload,now.toISOString(),club,row.revision).run();
  if(update.meta.changes===1)return {doc,revision:row.revision+1,players,result};
 }
 fail('มีผู้จองพร้อมกันหลายคน กรุณาลองอีกครั้ง',409);
}
export async function bookingRoute(req,env,admin,club) {
 try {
  if(!['GET','POST'].includes(req.method))return reply({error:'Method not allowed'},405);
  const owner=await ownerHash(req),now=new Date();
  let input=null;
  if(req.method==='POST'){
   const text=await req.text();if(text.length>30000)fail('ข้อมูลยาวเกินไป');
   try{input=JSON.parse(text);}catch{fail('ข้อมูลไม่ถูกต้อง');}
   if(!input||typeof input!=='object')fail('ข้อมูลไม่ถูกต้อง');
   if(['settings','close'].includes(input.action)&&!admin)fail('กรุณาเข้าสู่ระบบผู้จัด',401);
   if(!['settings','close','book','cancel'].includes(input.action))fail('ไม่พบคำสั่ง');
  }
  const outcome=await mutateBooking(env,club,input?(doc,players)=>{
   if(input.action==='settings'){
    if(input.settingsVersion!==doc.settingsVersion)fail('ผู้จัดอีกเครื่องแก้การตั้งค่าแล้ว กรุณาโหลดใหม่',409);
    const cfg=validateSettings(input.settings,players);
    doc.settings=cfg;doc.settingsVersion++;
    for(const s of doc.sessions){if(startsAt(s)<=+now)continue;
     s.start=cfg.start;s.end=cfg.end;s.capacity=cfg.capacity;s.rounds=cfg.rounds;
     s.registrations=s.registrations.filter(r=>r.source!=='regular'||cfg.regularIds.includes(r.playerId));
     s.regularSeen=s.regularSeen.filter(id=>cfg.regularIds.includes(id));
    }
    return {message:'บันทึกการตั้งค่าและลงชื่อขาประจำแล้ว'};
   }
   const session=id=>{
    const s=doc.sessions.find(s=>s.id===id);
    if(!s||startsAt(s)<=+now)fail('รอบนี้เริ่มแล้ว หรือไม่มีในตาราง กรุณาโหลดใหม่',409);
    return s;
   };
   if(input.action==='close'){
    const s=session(input.sessionId);if(typeof input.closed!=='boolean')fail('ข้อมูลไม่ถูกต้อง');
    s.closed=input.closed;return {message:s.closed?'ปิดรับจองรอบนี้แล้ว':'เปิดรับจองรอบนี้แล้ว'};
   }
   if(input.action==='book'){
    if(!doc.settings.enabled)fail('ผู้จัดยังไม่เปิดรับจอง',409);
    if(!owner)fail('กรุณาเปิดใช้พื้นที่จัดเก็บในเบราว์เซอร์เพื่อจัดการการจอง');
    if(!players.some(p=>p.id===input.playerId))fail('ไม่พบผู้เล่นในก๊วน กรุณาติดต่อผู้จัด');
    if(!Array.isArray(input.sessionIds)||input.sessionIds.length<1||input.sessionIds.length>56||new Set(input.sessionIds).size!==input.sessionIds.length)fail('เลือกวันที่ต้องการจองอย่างน้อย 1 วัน');
    const sessions=input.sessionIds.map(session);
    if(sessions.some(s=>s.closed||s.skipped))fail('มีวันที่ปิดรับจองหรือข้ามวันหยุดอยู่ กรุณาเลือกใหม่',409);
    if(sessions.some(s=>s.holiday)&&input.acceptHoliday!==true)fail('มีวันหยุดในวันที่เลือก กรุณายืนยันรับทราบก่อนจอง',409);
    let added=0;
    const duplicateIds=[];
    for(const s of sessions){
     if(s.registrations.some(r=>r.playerId===input.playerId)){duplicateIds.push(s.id);continue;}
     if(s.registrations.length>=200)fail('คิวสำรองรอบนี้เต็มแล้ว',409);
     s.registrations.push({id:crypto.randomUUID(),playerId:input.playerId,seq:++doc.seq,source:'manual',ownerHash:owner,createdAt:now.toISOString()});added++;
    }
    const duplicate=duplicateIds.length;
    return {added,duplicate,duplicateIds,message:added?`จองเรียบร้อย ${added} วัน${duplicate?` • ลงชื่อไว้แล้ว ${duplicate} วัน`:''}`:'มีชื่อในวันที่เลือกแล้ว ไม่ได้เพิ่มซ้ำ'};
   }
   if(input.action==='cancel'){
    const s=session(input.sessionId),r=s.registrations.find(r=>r.id===input.registrationId);
    if(!r)fail('รายการนี้ถูกถอนแล้ว กรุณาโหลดใหม่',409);
    if(!admin&&(!owner||r.ownerHash!==owner))fail('ถอนการจองได้จากเครื่องที่จอง หรือให้ผู้จัดช่วยถอน',403);
    s.registrations=s.registrations.filter(x=>x.id!==r.id);
    return {message:'ถอนชื่อแล้ว • คิวสำรองและตารางคู่ปรับให้อัตโนมัติ'};
   }
  }:null,now);
  return reply({...publicBooking(outcome.doc,outcome.revision,outcome.players,admin,owner,now),result:outcome.result});
 }catch(e){if(e instanceof BookingError)return reply({error:e.message},e.status);throw e;}
}
export async function scheduledBookings(env) {
 for(const club of ['sena','88'])await mutateBooking(env,club,null);
}
