/* Atokore household sharing — pure logic (no network, no DOM).
 * The app keeps saving {items, buys, routines} exactly as before. This module compares two saved
 * states and turns the difference into operations: quantity changes become deltas (so two people
 * using stock at the same time both count), other fields become per-field sets, removals become
 * deletes, and "bought → restocked" becomes one complete_buy operation the server applies once.
 * It also rebuilds the local state from the server's records plus operations not yet acknowledged.
 */
(function(root){
'use strict';
const KINDS=[['item','items'],['buy','buys'],['routine','routines']];
const COUNTERS={item:true,buy:true,routine:false};

function clone(v){return v==null?v:JSON.parse(JSON.stringify(v))}
function same(a,b){return JSON.stringify(a)===JSON.stringify(b)}
// A new record never carries cleared (null) fields, e.g. undone purchase fields (tp…): they mean
// "absent", and leaving them out keeps a restored record within the server's field limit.
function wireFields(fields,managed){const out={};for(const [k,v] of Object.entries(fields||{}))if(v!==null&&v!==undefined&&!(managed&&k==='photoPath'))out[k]=v;return out}
function legacyPhotoMutation(o){return o.field==='photoPath'||Object.prototype.hasOwnProperty.call(o.fields||{},'photoPath')||Object.prototype.hasOwnProperty.call(o.item_fields||{},'photoPath')}
function intQty(v){const n=Math.round(Number(v));return Number.isFinite(n)&&n>0?Math.min(n,99999):0}

// Saved app state → {"item:12": {kind, local, fields, qty}}
function records(state){
 const out={};
 for(const [kind,key] of KINDS){
  for(const raw of Array.isArray(state?.[key])?state[key]:[]){
   if(!raw||raw.id==null||typeof raw.name!=='string'||!raw.name.trim())continue;
   const fields={};
   for(const [k,v] of Object.entries(raw))if(k!=='id'&&k!=='qty'&&v!==undefined)fields[k]=clone(v);
   out[kind+':'+raw.id]={kind,local:String(raw.id),fields,qty:COUNTERS[kind]?intQty(raw.qty):0};
  }
 }
 return out;
}

function newSid(kind,rand=Math.random){
 const a='abcdefghijkmnpqrstuvwxyz23456789';let s=kind+'-';
 for(let i=0;i<16;i++)s+=a[Math.floor(rand()*a.length)];
 return s;
}
function uuid(rand=Math.random){
 const h=[...Array(32)].map(()=>Math.floor(rand()*16).toString(16));
 h[12]='4';h[16]=(8+Math.floor(rand()*4)).toString(16);
 return h.slice(0,8).join('')+'-'+h.slice(8,12).join('')+'-'+h.slice(12,16).join('')+'-'+h.slice(16,20).join('')+'-'+h.slice(20).join('');
}
// The same product for purchases and for "same item on both sides" offers: exact name and unit
// (and category where both have one). Sizes and capacities are part of the name, so they never merge.
function identity(fields){return [String(fields?.name||'').trim(),String(fields?.unit||'')].join('\u0001')}

/* Compare two saved states. map: {"item:12": sid}. Returns new ops and the updated map.
 * opts: {now, rand, device} */
function diff(prev,next,map,opts={}){
 const now=opts.now??Date.now(),rand=opts.rand||Math.random,a=records(prev),b=records(next),m={...map},ops=[];
 const op=o=>{const x={op_id:uuid(rand),...o};ops.push(x);return x};
 const created=[],deletedBuys=[],adds=[];
 for(const [key,r] of Object.entries(b)){
  const old=a[key];
  if(!old){
   if(!m[key])m[key]=newSid(r.kind,rand);
   created.push(op({type:'create',kind:r.kind,id:m[key],fields:wireFields(r.fields,opts.managedPhotos),qty:r.qty,ts:now,_key:key}));
   continue;
  }
  // Present before but never shared (e.g. saved while sharing was off): send it as a new record.
  if(!m[key]){m[key]=newSid(r.kind,rand);created.push(op({type:'create',kind:r.kind,id:m[key],fields:wireFields(r.fields,opts.managedPhotos),qty:r.qty,ts:now,_key:key}));continue}
  if(COUNTERS[r.kind]&&r.qty!==old.qty)adds.push(op({type:'add',kind:r.kind,id:m[key],delta:r.qty-old.qty,_key:key}));
  for(const k of new Set([...Object.keys(old.fields),...Object.keys(r.fields)])){
   if(opts.managedPhotos&&k==='photoPath')continue;
   if(same(old.fields[k],r.fields[k]))continue;
   op({type:'set',kind:r.kind,id:m[key],field:k,value:r.fields[k]===undefined?null:r.fields[k],ts:now});
  }
 }
 for(const [key,r] of Object.entries(a)){
  if(b[key]||!m[key])continue;
  const d=op({type:'delete',kind:r.kind,id:m[key],_key:key,_fields:r.fields,_qty:r.qty});
  if(r.kind==='buy')deletedBuys.push(d);
 }
 // A shopping row that disappeared while the same product was restocked by the same amount is a purchase.
 for(const del of deletedBuys){
  const want=identity(del._fields);
  const add=adds.find(x=>x.kind==='item'&&x.delta>0&&identity(b[x._key].fields)===want&&x.delta===del._qty);
  const made=!add&&created.find(x=>x.kind==='item'&&identity(x.fields)===want&&x.qty===del._qty);
  const target=add||made;if(!target||!del._qty)continue;
  const done={type:'complete_buy',buy:del.id,item:target.id,delta:del._qty,ts:now};
  // Work 9th: the op id of a purchase is fixed when the person buys (the estimate entry already names it).
  const fixed=typeof opts.opIdFor==='function'?opts.opIdFor(del.id):null;
  if(typeof fixed==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(fixed))del.op_id=fixed;
  if(made)done.item_fields=made.fields;
  // v51 (Work 8th): a purchase made while the server's purchase command is reachable is marked "rc" (receipt
  // wanted). Only such an op, sent soon after, goes through hh_push_v51 and can get undo rights; an op made
  // offline never does. "est" is kept for older servers; the reviewed SQL decides ownership itself (sb).
  if(typeof opts.receipts==='function'&&opts.receipts()===true)done.rc=true;
  const est=ops.filter(x=>x.type==='set'&&x.id===target.id&&/^tp[0-9a-z]{1,13}$/.test(x.field)&&x.value&&typeof x.value.k==='string'&&x.value.k.length<=80)
   .map(x=>({field:x.field,k:x.value.k}));
  if(made)for(const [f,v] of Object.entries(made.fields||{}))if(/^tp[0-9a-z]{1,13}$/.test(f)&&v&&typeof v.k==='string'&&v.k.length<=80)est.push({field:f,k:v.k});
  if(est.length)done.est=est.slice(0,8);
  Object.assign(del,done);delete del.kind;delete del.id;
  ops.splice(ops.indexOf(target),1);
  if(add)adds.splice(adds.indexOf(add),1);else created.splice(created.indexOf(made),1);
 }
 for(const o of ops){delete o._key;delete o._fields;delete o._qty}
 return {ops,map:m};
}

// Server records (by sid) + pending ops → local view (by sid). Server rules are mirrored:
// counters never go below zero, tombstones stay deleted, a completed purchase restocks once.
function rebase(base,pending){
 const view={};
 for(const r of Object.values(base||{}))view[r.kind+':'+r.id]={kind:r.kind,id:r.id,fields:clone(r.fields)||{},qty:Number(r.qty)||0,deleted:!!r.deleted};
 const get=(kind,id)=>view[kind+':'+id];
 for(const o of pending||[]){
  if(o.type==='create'){if(!get(o.kind,o.id))view[o.kind+':'+o.id]={kind:o.kind,id:o.id,fields:clone(o.fields),qty:Number(o.qty)||0,deleted:false};continue}
  if(o.type==='complete_buy'){
   const buy=get('buy',o.buy);if(!buy||buy.deleted)continue;
   buy.deleted=true;
   const item=get('item',o.item);
   if(item){if(!item.deleted)item.qty=Math.min(item.qty+o.delta,99999)}
   else if(o.item_fields)view['item:'+o.item]={kind:'item',id:o.item,fields:clone(o.item_fields),qty:o.delta,deleted:false};
   continue;
  }
  const r=get(o.kind,o.id);if(!r||r.deleted)continue;
  if(o.type==='delete')r.deleted=true;
  else if(o.type==='add')r.qty=Math.min(Math.max(r.qty+o.delta,0),99999);
  else if(o.type==='set'){if(o.value===null)delete r.fields[o.field];else r.fields[o.field]=clone(o.value)}
 }
 return view;
}

/* View (by sid) → saved app state. Local ids stay stable (photos are keyed by them); records new
 * to this device get fresh ids that were never used here. Existing order is kept, new ones appended.
 * The app makes ids from Date.now() (~1.8e12) or Date.now()*1000 (~1.8e15), so ids made here use a
 * band from 7e15 that the app's own ids will not reach, while staying a safe integer. */
const LOCAL_ID_BAND=7e15;
function materialize(view,map,prevState,opts={}){
 const bySid={};for(const [key,sid] of Object.entries(map||{}))bySid[sid]=key;
 const m={...map},used=new Set(),state={};
 for(const [,key] of KINDS)for(const x of Array.isArray(prevState?.[key])?prevState[key]:[])used.add(Number(x.id));
 for(const k of Object.keys(m))used.add(Number(k.split(':')[1]));
 let next=Math.max(LOCAL_ID_BAND,...[...used].filter(x=>Number.isSafeInteger(x)&&x>=LOCAL_ID_BAND))+1;
 const fresh=()=>{while(used.has(next))next++;used.add(next);return next++};
 for(const [kind,key] of KINDS){
  const order=(Array.isArray(prevState?.[key])?prevState[key]:[]).map(x=>String(x.id));
  const rows=[];
  for(const r of Object.values(view)){
   if(r.kind!==kind||r.deleted)continue;
   let localKey=bySid[r.id];
   if(!localKey){localKey=kind+':'+fresh();m[localKey]=r.id;bySid[r.id]=localKey}
   const local=localKey.split(':')[1],idNum=Number(local);
   const row={id:Number.isFinite(idNum)?idNum:local,...clone(r.fields)};
   if(COUNTERS[kind])row.qty=r.qty;
   rows.push(row);
  }
  rows.sort((x,y)=>{const i=order.indexOf(String(x.id)),j=order.indexOf(String(y.id));return (i<0?1e9:i)-(j<0?1e9:j)});
  state[key]=rows;
 }
 // Forget mappings of records that no longer exist anywhere.
 for(const [k,sid] of Object.entries(m))if(!view[k.split(':')[0]+':'+sid])delete m[k];
 return {state,map:m};
}

// After joining: which local records already exist on the shared side (exact same product)?
function matchLocal(localState,view){
 const shared=Object.values(view).filter(r=>!r.deleted);
 return Object.values(records(localState)).map(r=>{
  const twin=shared.find(s=>s.kind===r.kind&&identity(s.fields)===identity(r.fields)&&(s.fields.cat||'')===(r.fields.cat||''));
  return {key:r.kind+':'+r.local,kind:r.kind,name:r.fields.name,unit:r.fields.unit||'',qty:r.qty,sharedId:twin?.id||null,sharedQty:twin?twin.qty:null};
 });
}

/* Sync engine shared by the app and the tests. Storage and network are injected:
 *  readState() → saved app state | null      writeState(state) → true when stored and read back
 *  readMeta()/writeMeta(meta) → sync metadata (outbox survives reloads)   rpc(fn,args) → server result
 * "Saved on this device" and "shared with the family" stay separate: an operation leaves the outbox
 * only when the server has answered for it. */
const EMPTY={items:[],buys:[],routines:[]};
function freshMeta(){return {shadow:null,map:{},outbox:[],base:{},cursor:0,rejected:[],pendingApply:null,lastSync:0}}
// A purchase sent later than this after it was made is treated like the offline outbox (no receipt).
const RECEIPT_MAX_AGE_MS=60000;
function createEngine(io){
 const now=io.now||(()=>Date.now()),rand=io.rand||Math.random;
 let meta={...freshMeta(),...(io.readMeta()||{})};
 const save=next=>{if(!io.writeMeta(next))throw Object.assign(Error('sync_meta_not_saved'),{code:'storage'});meta=next};
 // The app state and sync metadata are separate storage entries. Journal BEFORE the state write
 // so a crash/quota failure between them can never turn a received change into a new local delta.
 function recoverApply(){
  const p=meta.pendingApply;if(!p)return;
  if(!p.after||!['items','buys','routines'].every(k=>Array.isArray(p.after[k]))||!p.map||typeof p.map!=='object')throw Object.assign(Error('sync_recovery_needed'),{code:'recovery'});
  const current=io.readState();
  if(!same(current,p.after)){
   if(!same(current,p.before))throw Object.assign(Error('sync_recovery_needed'),{code:'recovery'});
   // The app edits its in-memory arrays in place; never expose the journal's own target object.
   if(!io.writeState(clone(p.after)))throw Object.assign(Error('local_save_failed'),{code:'storage'});
  }
  save({...meta,map:p.map,shadow:clone(p.after),pendingApply:null,lastSync:p.at});
 }
 function commitState(state,map){
  recoverApply();
  save({...meta,pendingApply:{before:clone(io.readState()),after:clone(state),map:clone(map),at:now()}});
  recoverApply();
 }
 // Local changes since the last check become operations (persisted before anything is sent).
 const sending=new Set();   // op ids in an hh_push request right now (never changed while in flight)
 // Another tab of the same phone may have advanced the sync record (shadow, outbox) since this one read
 // it; diffing against a stale shadow would send that tab's change again (Work 7th: a second undo).
 function reloadMeta(){const m=io.readMeta();if(m)meta={...freshMeta(),...m}}
 function flush(){
  reloadMeta();
  recoverApply();
  if(!meta.shadow)return 0;
  const cur=io.readState();if(!cur)return 0;
  const {ops,map}=diff(meta.shadow,cur,meta.map,{now:now(),rand,managedPhotos:io.managedPhotos===true,receipts:io.receipts,opIdFor:io.opIdFor});
  if(!ops.length)return 0;
  // v51 (Work 7th): the estimate entry of a purchase is often saved right after the purchase itself (a
  // later diff). It is attached to that product's latest complete_buy while it is still unsent, so the
  // server can remove it in the same transaction as an undo. An op already being sent is never changed.
  const outbox=meta.outbox.slice();
  for(const x of ops){
   if(x.type!=='set'||!/^tp[0-9a-z]{1,13}$/.test(x.field)||!x.value||typeof x.value.k!=='string'||x.value.k.length>80)continue;
   for(let i=outbox.length-1;i>=0;i--){
    const o=outbox[i];if(o.type!=='complete_buy'||o.item!==x.id)continue;
    if(!sending.has(o.op_id)){const est=Array.isArray(o.est)?o.est.slice():[];
     if(est.length<8&&!est.some(e=>e.field===x.field&&e.k===x.value.k)){est.push({field:x.field,k:x.value.k});outbox[i]={...o,est}}}
    break;
   }
  }
  save({...meta,outbox:[...outbox,...ops],map,shadow:clone(cur)});
  return ops.length;
 }
 async function push(){
  recoverApply();
  assertResolved();
  if(io.managedPhotos&&meta.outbox.some(legacyPhotoMutation))throw Object.assign(Error('photo_migration_recovery_needed'),{code:'recovery'});
  while(meta.outbox.length){
   const batch=meta.outbox.slice(0,100);
   for(const o of batch)sending.add(o.op_id);
   let res;
   try{
    // Work 8th: purchases marked for a receipt and sent within a minute of being made go through the
    // dedicated purchase command (same batch, same rules). Only its exact {status:'not_enabled'} falls
    // back to the ordinary push; any other unexpected answer is not acknowledged (nothing is cleared).
    const rc=typeof io.receipts==='function'&&io.receipts()===true?batch.filter(o=>o.type==='complete_buy'&&o.rc===true&&Number.isFinite(o.ts)&&now()-o.ts<=RECEIPT_MAX_AGE_MS).map(o=>o.op_id):[];
    if(rc.length){
     res=await io.rpc('hh_push_v51',{p_ops:batch,p_receipt_ops:rc,p_device:io.device||null});
     const keys=res&&typeof res==='object'&&!Array.isArray(res)?Object.keys(res):[];
     if(keys.length===1&&res.status==='not_enabled')res=await io.rpc('hh_push',{p_ops:batch,p_device:io.device||null});
     else if(res?.status!=='ready')res=null;
    }else res=await io.rpc('hh_push',{p_ops:batch,p_device:io.device||null});
   }
   finally{for(const o of batch)sending.delete(o.op_id)}
   const answered=new Map((res?.results||[]).map(r=>[String(r.op_id),r.status]));
   // Work 9th: purchases the server gave a receipt to (only those can be undone in sharing).
   if(Array.isArray(res?.receipts)&&res.receipts.length){const got=new Set([...(meta.receipts||[]),...res.receipts.filter(x=>typeof x==='string')]);meta={...meta,receipts:[...got].slice(-200)}}
   const rejected=[...meta.rejected];
   for(const o of batch){const s=answered.get(o.op_id);if(s&&s.startsWith('rejected'))rejected.push({op:o,status:s,at:now()})}
   const outbox=meta.outbox.filter(o=>!answered.has(o.op_id));
   if(outbox.length===meta.outbox.length)throw Object.assign(Error('push_not_acknowledged'),{code:'server'});
   save({...meta,outbox,rejected});
   assertResolved();
  }
 }
 async function pull(){
  recoverApply();
  assertResolved();
  let more=true,base={...meta.base},cursor=meta.cursor;
  while(more){
   const res=await io.rpc('hh_pull',{p_since:cursor});
   for(const r of res.records||[])base[r.kind+':'+r.id]={kind:r.kind,id:r.id,fields:r.fields||{},qty:Number(r.qty)||0,deleted:!!r.deleted,...(r.seq!=null&&Number.isSafeInteger(Number(r.seq))?{seq:Number(r.seq)}:{})};
   cursor=Number(res.cursor)||cursor;more=!!res.more&&(res.records||[]).length>0;
  }
  save({...meta,base,cursor});
  apply();
 }
 // Work 9th: records the server returned for a confirmed operation of this person (e.g. an undo) are taken into
 // the base at once, only where their change number is newer (idempotent), then the device data is rebuilt.
 function adopt_records(list){
  recoverApply();
  const base={...meta.base};let changed=false;
  for(const r of Array.isArray(list)?list:[]){
   if(!r||typeof r.kind!=='string'||typeof r.id!=='string'||!Number.isSafeInteger(Number(r.seq)))continue;
   const key=r.kind+':'+r.id,old=base[key];
   if(old&&Number.isSafeInteger(Number(old.seq))&&Number(old.seq)>=Number(r.seq))continue;
   base[key]={kind:r.kind,id:r.id,fields:r.fields||{},qty:Number(r.qty)||0,deleted:!!r.deleted,seq:Number(r.seq)};changed=true;
  }
  if(!changed)return false;
  save({...meta,base});
  apply();
  return true;
 }
 // Rebuild the device's data from the server's records plus operations still waiting to be sent.
 function apply(){
  assertResolved();
  flush();
  const view=rebase(meta.base,meta.outbox);
  const {state,map}=materialize(view,meta.map,io.readState()||EMPTY,{now:now()});
  commitState(state,map);
  return state;
 }
 // Never pull while operations may have reached the server without an answer: their effect
 // would be counted twice on screen. The next push gets "duplicate" for them and clears them.
 function assertResolved(){if(meta.rejected.length)throw Object.assign(Error('sync_rejected'),{code:'rejected'})}
 // Called only after the person explicitly chooses recovery and the UI saves a device backup.
 function resolveRejected(){
  const current=io.readState();
  if(meta.pendingApply&&!current)throw Object.assign(Error('sync_recovery_needed'),{code:'recovery'});
  save({...meta,rejected:[],...(meta.pendingApply?{shadow:clone(current),map:meta.pendingApply.map,pendingApply:null}:{})});
 }
 async function sync(){flush();assertResolved();await push();await pull();return status()}
 function status(){return {pending:meta.outbox.length,rejected:meta.rejected.length,recovering:!!meta.pendingApply,lastSync:meta.lastSync,cursor:meta.cursor,started:!!meta.shadow}}
 // Creating a household: everything on this device becomes the first shared data.
 function startAsCreator(){recoverApply();save({...freshMeta(),shadow:clone(EMPTY)});return flush()}
 // Joining: nothing local is sent until the person chooses (see adopt()).
 function startAsJoiner(){recoverApply();save({...freshMeta()})}
 /* After joining and pulling: choices = {useShared:true} or {add:[{key, mode:'new'|'sum'|'skip'}]}.
  * Records not added stay out of the shared list; the caller keeps a backup of the device's data. */
 async function adopt(choices){
  recoverApply();
  // Retrying the placement button must resume its original operation ids/quantities. Once the
  // chosen state is committed, rebuilding "sum" from that state would count it a second time.
  if(meta.shadow){await sync();return io.readState()}
  let more=true,base={},cursor=0;
  while(more){const res=await io.rpc('hh_pull',{p_since:cursor});for(const r of res.records||[])base[r.kind+':'+r.id]={kind:r.kind,id:r.id,fields:r.fields||{},qty:Number(r.qty)||0,deleted:!!r.deleted,...(r.seq!=null&&Number.isSafeInteger(Number(r.seq))?{seq:Number(r.seq)}:{})};cursor=Number(res.cursor)||cursor;more=!!res.more&&(res.records||[]).length>0}
  const local=records(io.readState()||EMPTY),view=rebase(base,[]),map={},outbox=[];
  for(const c of choices?.add||[]){
   const r=local[c.key];if(!r||c.mode==='skip')continue;
   const twin=Object.values(view).find(s=>!s.deleted&&s.kind===r.kind&&identity(s.fields)===identity(r.fields)&&(s.fields.cat||'')===(r.fields.cat||''));
   if(twin&&c.mode==='sum'){map[c.key]=twin.id;if(r.qty>0&&COUNTERS[r.kind])outbox.push({op_id:uuid(rand),type:'add',kind:r.kind,id:twin.id,delta:r.qty});continue}
   if(twin&&c.mode!=='new'){map[c.key]=twin.id;continue}
   const sid=newSid(r.kind,rand);map[c.key]=sid;
   outbox.push({op_id:uuid(rand),type:'create',kind:r.kind,id:sid,fields:wireFields(r.fields,io.managedPhotos===true),qty:r.qty,ts:now()});
  }
  // Keep this device's local ids (and their photos) for exact-same products it already had.
  for(const r of Object.values(local)){
   if(Object.prototype.hasOwnProperty.call(map,r.kind+':'+r.local))continue;
   const twin=Object.values(view).find(s=>!s.deleted&&s.kind===r.kind&&identity(s.fields)===identity(r.fields)&&(s.fields.cat||'')===(r.fields.cat||'')&&!Object.values(map).includes(s.id));
   if(twin)map[r.kind+':'+r.local]=twin.id;
  }
  save({...freshMeta(),base,cursor,map,outbox,shadow:null});
  const state=materialize(rebase(base,outbox),map,io.readState()||EMPTY,{now:now()});
  commitState(state.state,state.map);
  await push();
  return state.state;
 }
 return {flush,push,pull,apply,sync,status,resolveRejected,startAsCreator,startAsJoiner,adopt,adoptRecords:adopt_records,meta:()=>clone(meta)};
}

const api=Object.freeze({records,diff,rebase,materialize,matchLocal,identity,newSid,uuid,createEngine,freshMeta});
if(typeof module!=='undefined'&&module.exports)module.exports=api;
root.AtokoreHouseholdCore=api;
})(typeof globalThis!=='undefined'?globalThis:this);
