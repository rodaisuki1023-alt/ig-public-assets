/* Atokore v51 stock levels: easy 3-level management (default) and optional detailed tracking.
 * Pure functions; no DOM, no network, no storage. Everything is computed on the device.
 *
 * Owner policy (2026-11-25):
 *  - Easy is the default: 余裕あり / そろそろ / 買う. Daily input is never required.
 *  - Detailed tracking is optional: packs, units per pack, average daily use, the day the count was
 *    taken, and a refill line in days.
 *  - The ESTIMATE is kept apart from the ACTUAL count (item.qty). Nothing here writes item.qty:
 *    an estimate never overwrites a counted stock. "使い切った" is the person's own statement and
 *    only suggests a new actual count; the screen asks before saving it.
 *  - Unknown is not zero: an item without a count or with an unusable track is "unknown"/"確認".
 *  - A size change, an implausible correction or a long time without confirmation lowers the
 *    confidence instead of pretending precision; after STALE_DAYS the estimate asks to be checked.
 *
 * Stored shape (optional, backward compatible; old items have neither field):
 *  item.level = 'plenty' | 'low' | 'buy'           // easy mode, set by the person
 *  item.levelAt = ISO time the level was set
 *  item.track = { v:1, base, since, perDay, perPack, refillDays, size, snoozeUntil, confirmedAt }
 *    base   units at `since` (packs * perPack when started from packs), >= 0
 *    since  YYYY-MM-DD the base count was taken
 *    perDay average units used per day (household total; several children: sum of their rates)
 *    t      time (ms) the base was observed; seen  purchase keys already inside `base`
 *    check  'purchase_undo' | null: a purchase inside `base` was undone; asks to be checked
 *
 * Purchases (v51 family-safe): every purchase is its OWN item field  tp<hash> = {v:1,k,q,unit,u,d,t,pu,sz}
 * (k = purchase key, u = pieces added or null when the unit is unknown, d = day, t = ms).
 * The family sync merges fields one by one (last writer wins per field), so two purchases made at
 * the same time on two phones are two different fields and both survive; the same purchase sent
 * again writes the same field with the same value and adds nothing. The estimate is recomputed
 * from base + the purchases not yet inside it, in date order. Undo clears that purchase's field.
 * A correction records which purchases it saw; a purchase made before the correction but not
 * seen by it (the family's purchase arrived later) is not guessed: the estimate asks to be checked.
 */
(function(root){
'use strict';
const LEVELS=Object.freeze(['plenty','low','buy']);
const LABEL=Object.freeze({plenty:'余裕あり',low:'そろそろ',buy:'買う',unknown:'確認'});
const DAY=86400000;
const STALE_DAYS=30;          // no confirmation for this long: ask instead of estimating
const DEFAULT_REFILL_DAYS=5;  // "そろそろ" when the estimate reaches this many days
const CHECKS=Object.freeze(['purchase_undo']);
const ENTRY=/^tp[0-9a-z]{1,13}$/;
const OLD_PURCHASE_DAYS=30;   // a purchase this long before the last observation is history, not a question
const MAX_UNITS=99999,MAX_PER_DAY=9999,MAX_PER_PACK=9999,MAX_PACKS=999,MAX_REFILL=60;

const isDay=s=>{if(typeof s!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(s))return false;const t=Date.parse(s+'T00:00:00Z');return Number.isFinite(t)&&new Date(t).toISOString().slice(0,10)===s};
const dayOf=t=>new Date(t).toISOString().slice(0,10);
const between=(a,b)=>Math.round((Date.parse(b+'T00:00:00Z')-Date.parse(a+'T00:00:00Z'))/DAY);
const num=(v,max,{min=0,int=false}={})=>{const n=Number(v);return Number.isFinite(n)&&n>=min&&n<=max&&(!int||Number.isInteger(n))?n:null};
const round1=n=>Math.round(n*10)/10;

/** Valid track or null. Never throws; corrupt data simply means "no estimate". */
function readTrack(t){
 if(!t||typeof t!=='object'||t.v!==1)return null;
 const base=num(t.base,MAX_UNITS),perDay=num(t.perDay,MAX_PER_DAY,{min:0.01});
 if(base===null||perDay===null||!isDay(t.since))return null;
 const perPack=t.perPack==null?null:num(t.perPack,MAX_PER_PACK,{min:1,int:true});
 const refillDays=t.refillDays==null?DEFAULT_REFILL_DAYS:num(t.refillDays,MAX_REFILL,{min:1,int:true});
 if(t.perPack!=null&&perPack===null||refillDays===null)return null;
 const pieceUnit=typeof t.pieceUnit==='string'&&t.pieceUnit.length<=4?t.pieceUnit:null;
 const seen=Array.isArray(t.seen)?t.seen.filter(k=>typeof k==='string'&&k.length>0&&k.length<=80).slice(-40):[];
 const check=CHECKS.includes(t.check)?t.check:null;
 // Older tracks have no observation time: the start of their base day (any time zone) is used.
 const at=Number.isSafeInteger(t.t)&&t.t>0?t.t:Date.parse(t.since+'T00:00:00Z')-14*3600000;
 const perChild=Array.isArray(t.perChild)&&t.perChild.length>=2&&t.perChild.length<=6&&t.perChild.every(n=>num(n,MAX_PER_DAY,{min:0.01})!==null)?t.perChild.map(Number):null;
 return {v:1,base,since:t.since,perDay,perPack,refillDays,pieceUnit,perChild,size:typeof t.size==='string'?t.size.slice(0,40):null,
  snoozeUntil:isDay(t.snoozeUntil)?t.snoozeUntil:null,confirmedAt:isDay(t.confirmedAt)?t.confirmedAt:t.since,t:at,seen,check};
}

/** Start detailed tracking. Either units, or packs × perPack. Returns {track} or {error}. */
function startTrack({units=null,packs=null,perPack=null,perDay,perChild=null,refillDays=DEFAULT_REFILL_DAYS,size=null,pieceUnit=null,today,now=Date.now(),seen=[]}={}){
 if(!isDay(today))return {error:'日付を確認できませんでした'};
 // Several children: each child's own daily use is summed (the sum is what the estimate uses).
 const kids=Array.isArray(perChild)?perChild.filter(v=>v!==null&&v!==''&&v!==undefined):[];
 if(kids.length===1)perDay=kids[0];
 if(kids.length>=2){const sum=combinedPerDay(kids);if(sum===null)return {error:'子どもごとの量は0より大きい数で入力してください'};perDay=sum}
 const d=num(perDay,MAX_PER_DAY,{min:0.01});if(d===null)return {error:'1日に使う量は0より大きい数で入力してください'};
 const r=num(refillDays,MAX_REFILL,{min:1,int:true});if(r===null)return {error:'補充ラインは1〜'+MAX_REFILL+'日で入力してください'};
 let base,pp=null;
 if(packs!=null){
  const p=num(packs,MAX_PACKS,{int:true});pp=num(perPack,MAX_PER_PACK,{min:1,int:true});
  if(p===null||pp===null)return {error:'袋数と1袋の枚数（個数）を整数で入力してください'};
  base=p*pp;
 }else{
  base=num(units,MAX_UNITS);
  if(base===null)return {error:'残りの数量を0以上で入力してください'};
  if(perPack!=null){pp=num(perPack,MAX_PER_PACK,{min:1,int:true});if(pp===null)return {error:'1袋の枚数（個数）を整数で入力してください'}}
 }
 const pu=typeof pieceUnit==='string'&&pieceUnit.length<=4?pieceUnit:null;
 const pc=kids.length>=2?kids.map(Number):null;
 return {track:{v:1,base,since:today,perDay:d,perPack:pp,refillDays:r,pieceUnit:pu,perChild:pc,size:size?String(size).slice(0,40):null,snoozeUntil:null,confirmedAt:today,t:now,seen:[...seen].slice(-40),check:null}};
}

/** Estimate for one item on `today`. Never reads or changes item.qty for the estimate itself. */
function estimate(item,today){
 const t=readTrack(item?.track);
 if(!t||!isDay(today))return {status:'none'};
 const elapsed=between(t.since,today);
 if(elapsed<0)return {status:'unknown',reason:'future_date'};
 // Size or product changed since tracking started: the old rate does not apply.
 if(t.size&&item.size&&t.size!==String(item.size))return {status:'unknown',reason:'size_changed'};
 // A purchase that could not be added safely (unknown unit, undone after a later change).
 if(t.check)return {status:'unknown',reason:t.check};
 const p=pending(item,t);
 if(p.reason)return {status:'unknown',reason:p.reason};
 // A purchase also tells that stock is there: the newest counted purchase refreshes the date.
 const fresh=p.list.reduce((a,e)=>e.day>a?e.day:a,t.confirmedAt);
 const sinceConfirm=between(fresh,today);
 if(sinceConfirm>STALE_DAYS)return {status:'unknown',reason:'stale',days:sinceConfirm};
 // Walk from the base through each purchase in date order (stock cannot go below 0 in between).
 let lv=t.base,cur=t.since;
 for(const e of p.list){const day=e.day>today?today:e.day<t.since?t.since:e.day;lv=Math.max(0,lv-t.perDay*between(cur,day))+e.u;cur=day}
 const remaining=Math.max(0,lv-t.perDay*between(cur,today));
 const daysLeft=remaining/t.perDay;
 // Uncertainty grows with time since the last confirmation (±10% per week, at least ±1 day).
 const spread=Math.max(1,daysLeft*Math.min(0.5,0.1*Math.ceil(Math.max(1,sinceConfirm)/7)));
 const snoozed=t.snoozeUntil&&t.snoozeUntil>today;
 const level=remaining<=0?'buy':daysLeft<=t.refillDays?(daysLeft<=Math.max(1,t.refillDays/2)?'buy':'low'):'plenty';
 return {status:'estimate',remaining:round1(remaining),daysLeft:Math.floor(daysLeft),range:[Math.max(0,Math.floor(daysLeft-spread)),Math.ceil(daysLeft+spread)],
  packs:t.perPack?round1(remaining/t.perPack):null,runOut:dayOf(Date.parse(today+'T00:00:00Z')+Math.floor(daysLeft)*DAY),
  level,snoozed:!!snoozed,since:t.since,confirmedAt:t.confirmedAt,perDay:t.perDay,purchases:p.list.length,added:round1(p.list.reduce((a,e)=>a+e.u,0))};
}

/** The level the screen shows: the person's own level wins; then a usable estimate; then the
 * existing qty/minQty rule (old data, read only); otherwise unknown. Source is always reported. */
function displayLevel(item,today){
 if(item&&LEVELS.includes(item.level))return {level:item.level,label:LABEL[item.level],source:'manual'};
 const e=estimate(item,today);
 if(e.status==='estimate')return {level:e.level,label:LABEL[e.level],source:'estimate',estimate:e};
 if(e.status==='unknown')return {level:'unknown',label:LABEL.unknown,source:'estimate',reason:e.reason};
 const q=Number(item?.qty);
 if(!Number.isFinite(q)||q<0)return {level:'unknown',label:LABEL.unknown,source:'none'};
 const min=Number.isFinite(Number(item?.minQty))&&item.minQty!=null?Number(item.minQty):1;
 return {level:q===0?'buy':q<=min?'low':'plenty',label:LABEL[q===0?'buy':q<=min?'low':'plenty'],source:'count'};
}

/** Easy mode: set a level. Returns the fields to merge (never touches qty or the track). */
function setLevel(level,now){
 if(!LEVELS.includes(level))return {error:'選べるのは「余裕あり」「そろそろ」「買う」です'};
 return {patch:{level,levelAt:new Date(now).toISOString()}};
}
function clearLevel(){return {patch:{level:undefined,levelAt:undefined}}}

/** Corrections from the person. Each returns {track} (and for used-up a suggestion), or {error}.
 *  still : "まだある" — the estimate ran out too early: slow the rate (at most 30% per step) and
 *          restart from the person's remaining amount if given, otherwise from a small remainder.
 *  usedUp: "使い切った" — learn the real rate from the elapsed days; suggest actual count 0.
 *  later : "後で確認" — hide the reminder for 3 days; the estimate itself is unchanged. */
function correct(track,kind,{today,remaining=null,now=Date.now(),seen=[]}={}){
 const t=readTrack(track);if(!t)return {error:'見積もりの設定がありません'};
 if(!isDay(today))return {error:'日付を確認できませんでした'};
 const elapsed=between(t.since,today);if(elapsed<0)return {error:'日付を確認できませんでした'};
 if(kind==='later')return {track:{...t,snoozeUntil:dayOf(Date.parse(today+'T00:00:00Z')+3*DAY)}};
 // Both corrections below are the person's own observation, so they also settle a pending check.
 if(kind==='still'){
  const left=remaining==null?null:num(remaining,MAX_UNITS);
  if(remaining!=null&&left===null)return {error:'残りの数量を0以上で入力してください'};
  const used=Math.max(0,t.base-(left??0));
  // Only a stated remaining amount is an observation; without it, just slow the rate a little.
  const observed=left!=null&&elapsed>=3?used/elapsed:null;
  const perDay=Math.max(0.01,observed==null?t.perDay*0.85:Math.max(t.perDay*0.7,Math.min(t.perDay,(t.perDay+observed)/2)));
  const base=left??Math.max(t.perDay,t.perPack?Math.min(t.perPack,t.perDay*3):t.perDay*3);
  return {track:{...t,base,since:today,perDay:round1(perDay*100)/100,snoozeUntil:null,confirmedAt:today,t:now,seen:[...seen].slice(-40),check:null},approximate:left==null};
 }
 if(kind==='usedUp'){
  // Only a plausible observation updates the rate (at least 3 days, within x0.5..x2 of before).
  const observed=elapsed>=3?t.base/elapsed:null;
  const perDay=observed!=null&&observed>=t.perDay*0.5&&observed<=t.perDay*2?round1((t.perDay+observed)/2*100)/100:t.perDay;
  return {track:{...t,base:0,since:today,perDay,snoozeUntil:null,confirmedAt:today,t:now,seen:[...seen].slice(-40),check:null},suggestQty:0,learned:perDay!==t.perDay};
 }
 return {error:'unknown correction'};
}

/** Purchase confirmed once (packs or units). Adds to the CURRENT estimate and restarts from today.
 * The actual count (qty) is updated only by the existing purchase flow, never here. */
function addPurchase(track,{packs=null,units=null,today}={}){
 const t=readTrack(track);if(!t)return {error:'見積もりの設定がありません'};
 if(!isDay(today)||between(t.since,today)<0)return {error:'日付を確認できませんでした'};
 let add;
 if(packs!=null){if(!t.perPack)return {error:'1袋の枚数（個数）が未設定です'};const p=num(packs,MAX_PACKS,{min:1,int:true});if(p===null)return {error:'袋数を1以上の整数で入力してください'};add=p*t.perPack}
 else{add=num(units,MAX_UNITS,{min:0.01});if(add===null)return {error:'数量を0より大きい数で入力してください'}}
 const now=Math.max(0,t.base-t.perDay*between(t.since,today));
 if(now+add>MAX_UNITS)return {error:'数量が大きすぎます'};
 return {track:{...t,base:round1(now+add),since:today,snoozeUntil:null,confirmedAt:today}};
}

// ---- Purchases as separate fields -------------------------------------------------------------
const hash36=v=>{let h=2166136261,g=5381;for(let i=0;i<v.length;i++){const c=v.charCodeAt(i);h^=c;h=Math.imul(h,16777619);g=(Math.imul(g,33)+c)|0}return (h>>>0).toString(36)+(g>>>0).toString(36).slice(0,4)};
/** The item field that holds one purchase (same key -> same field, so a resend changes nothing). */
function entryField(key){return 'tp'+hash36(String(key)).slice(0,13)}
function readEntry(v){
 if(!v||typeof v!=='object'||v.v!==1||typeof v.k!=='string'||!v.k||v.k.length>80||!isDay(v.d)||!Number.isSafeInteger(v.t))return null;
 const u=v.u==null?null:num(v.u,MAX_UNITS,{min:0.01});
 if(v.u!=null&&u===null)return null;
 return {k:v.k,u,q:Number(v.q)||null,unit:typeof v.unit==='string'?v.unit.slice(0,8):'',day:v.d,t:v.t,pu:typeof v.pu==='string'?v.pu.slice(0,4):null,sz:typeof v.sz==='string'?v.sz.slice(0,40):null};
}
/** Every purchase stored on the item: [{field, entry}] (null / cleared fields are skipped). */
function entries(item){
 const out=[];
 for(const [f,v] of Object.entries(item||{}))if(ENTRY.test(f)){const e=readEntry(v);if(e)out.push({field:f,entry:e})}
 return out.sort((a,b)=>a.entry.day<b.entry.day?-1:a.entry.day>b.entry.day?1:a.entry.t-b.entry.t||(a.entry.k<b.entry.k?-1:1));
}
/** Keys of the purchases the person can see now (a correction stores them as already counted). */
function seenKeys(item){return entries(item).map(x=>x.entry.k).slice(-40)}
// Purchases to add on top of the base; or the reason the estimate must ask instead.
function pending(item,t){
 const seen=new Set(t.seen),list=[];
 for(const {entry:e} of entries(item)){
  if(seen.has(e.k))continue;
  if(e.t<=t.t){
   if(e.t<t.t-OLD_PURCHASE_DAYS*DAY)continue;
   return {reason:'purchase_overlap',list};
  }
  if(e.u===null||(t.pieceUnit&&e.pu&&e.pu!==t.pieceUnit)||(t.size&&e.sz&&e.sz!==t.size))return {reason:'purchase_unit',list};
  list.push(e);
 }
 return {list};
}
/** The existing purchase flow just added `delta` (in the item's own unit: 袋, 個 …) to the counted
 * stock. Returns {field, entry} to store on the item, or null when the item has no estimate.
 * Bags/boxes need the pieces per bag; without it (or after a unit change) the amount is stored as
 * unknown (u:null) and the estimate asks to be checked instead of guessing. */
function purchaseEntry(item,delta,{today,now=Date.now(),key}={}){
 const t=readTrack(item?.track);if(!t)return null;
 if(typeof key!=='string'||!key||key.length>80||!isDay(today))return null;
 const d=num(delta,MAX_UNITS,{min:0.01}),u=units(item);
 const sameUnit=!t.pieceUnit||t.pieceUnit===u.piece;
 const add=d===null||!sameUnit?null:u.container?(t.perPack?d*t.perPack:null):d;
 return {field:entryField(key),entry:{v:1,k:key,q:d,unit:u.unit,u:add==null||add>MAX_UNITS?null:round1(add),d:today,t:now,pu:u.piece,sz:item.size?String(item.size).slice(0,40):null}};
}
/** Undo of one purchase: clear its field (only if it still holds that purchase). When the purchase
 * was already inside a correction's base, the base cannot be taken apart: ask to check. */
function undoEntry(item,field,key){
 const e=readEntry(item?.[field]);if(!e||e.k!==key)return {patch:null};
 const t=readTrack(item?.track);
 const patch={[field]:undefined};
 if(t&&t.seen.includes(key))patch.track={...item.track,check:'purchase_undo'};
 return {patch};
}
/** Purchases long before the last observation that may be cleared to keep the item small. */
function staleEntries(item){
 const t=readTrack(item?.track);if(!t)return [];
 return entries(item).filter(x=>x.entry.t<t.t-OLD_PURCHASE_DAYS*DAY).map(x=>x.field);
}

/** Change the pieces per bag and/or the daily use later. The estimate continues from what it
 * shows today (past days keep the old rate); purchases already counted stay counted. When the
 * estimate cannot decide (unknown, stale, a purchase to check) it asks to check first. */
function editTrack(item,{perPack,perDay,perChild=null,today,now=Date.now()}={}){
 const t=readTrack(item?.track);if(!t)return {error:'見積もりの設定がありません'};
 const e=estimate(item,today);
 if(e.status!=='estimate')return {error:'今の残りが分からないため変更できません。先に「まだある」で残りを入れてください'};
 const kids=Array.isArray(perChild)?perChild.filter(v=>v!==null&&v!==''&&v!==undefined):[];
 let d=perDay==null||perDay===''?t.perDay:num(perDay,MAX_PER_DAY,{min:0.01});
 if(kids.length>=2){d=combinedPerDay(kids);if(d===null)return {error:'子どもごとの量は0より大きい数で入力してください'}}
 else if(kids.length===1)d=num(kids[0],MAX_PER_DAY,{min:0.01});
 if(d===null)return {error:'1日に使う量は0より大きい数で入力してください'};
 let pp=t.perPack;
 if(perPack!=null&&perPack!==''){pp=num(perPack,MAX_PER_PACK,{min:1,int:true});if(pp===null)return {error:'1袋の枚数（個数）を整数で入力してください'}}
 return {track:{...t,base:e.remaining,since:today,perDay:d,perPack:pp,perChild:kids.length>=2?kids.map(Number):null,t:now,seen:seenKeys(item),check:null}};
}

/** Several children: the household rate is the sum of each child's own daily use. */
function combinedPerDay(rates){
 if(!Array.isArray(rates)||!rates.length||rates.length>6)return null;
 let sum=0;for(const r of rates){const n=num(r,MAX_PER_DAY,{min:0.01});if(n===null)return null;sum+=n}
 return round1(sum*100)/100;
}

/** A changed size (e.g. diaper M -> L) keeps the actual count but resets the estimate. */
function changeSize(track,size,{today}={}){
 const t=readTrack(track);if(!t)return {track:null};
 if(!isDay(today))return {error:'日付を確認できませんでした'};
 return {track:null,reason:'size_changed',previous:{size:t.size,perDay:t.perDay}};
}

// A product counted in bags/boxes/packs is estimated in the pieces inside (diapers and wipes: 枚).
function units(item){
 const unit=String(item?.unit||'個');const container=/^(袋|箱|パック)$/.test(unit);
 const brand=root.AtokoreUnits?.pieceFor?.(item?.name,unit);
 const piece=container?(brand||(/おむつ|オムツ|パンツ|テープ|おしりふき/.test(String(item?.name||''))?'枚':'個')):unit;
 return {unit,container,piece};
}
const api=Object.freeze({units,LEVELS,LABEL,STALE_DAYS,DEFAULT_REFILL_DAYS,readTrack,startTrack,estimate,displayLevel,setLevel,clearLevel,correct,editTrack,addPurchase,entryField,readEntry,entries,seenKeys,purchaseEntry,undoEntry,staleEntries,combinedPerDay,changeSize});
if(typeof module!=='undefined'&&module.exports)module.exports=api;
root.AtokoreStockLevels=api;
})(typeof globalThis!=='undefined'?globalThis:this);
