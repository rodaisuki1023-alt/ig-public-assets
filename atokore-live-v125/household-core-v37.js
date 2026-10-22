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
   created.push(op({type:'create',kind:r.kind,id:m[key],fields:r.fields,qty:r.qty,ts:now,_key:key}));
   continue;
  }
  // Present before but never shared (e.g. saved while sharing was off): send it as a new record.
  if(!m[key]){m[key]=newSid(r.kind,rand);created.push(op({type:'create',kind:r.kind,id:m[key],fields:r.fields,qty:r.qty,ts:now,_key:key}));continue}
  if(COUNTERS[r.kind]&&r.qty!==old.qty)adds.push(op({type:'add',kind:r.kind,id:m[key],delta:r.qty-old.qty,_key:key}));
  for(const k of new Set([...Object.keys(old.fields),...Object.keys(r.fields)])){
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
  if(made)done.item_fields=made.fields;
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
 function flush(){
  recoverApply();
  if(!meta.shadow)return 0;
  const cur=io.readState();if(!cur)return 0;
  const {ops,map}=diff(meta.shadow,cur,meta.map,{now:now(),rand});
  if(!ops.length)return 0;
  save({...meta,outbox:[...meta.outbox,...ops],map,shadow:clone(cur)});
  return ops.length;
 }
 async function push(){
  recoverApply();
  assertResolved();
  while(meta.outbox.length){
   const batch=meta.outbox.slice(0,100);
   const res=await io.rpc('hh_push',{p_ops:batch,p_device:io.device||null});
   const answered=new Map((res?.results||[]).map(r=>[String(r.op_id),r.status]));
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
   for(const r of res.records||[])base[r.kind+':'+r.id]={kind:r.kind,id:r.id,fields:r.fields||{},qty:Number(r.qty)||0,deleted:!!r.deleted};
   cursor=Number(res.cursor)||cursor;more=!!res.more&&(res.records||[]).length>0;
  }
  save({...meta,base,cursor});
  apply();
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
  while(more){const res=await io.rpc('hh_pull',{p_since:cursor});for(const r of res.records||[])base[r.kind+':'+r.id]={kind:r.kind,id:r.id,fields:r.fields||{},qty:Number(r.qty)||0,deleted:!!r.deleted};cursor=Number(res.cursor)||cursor;more=!!res.more&&(res.records||[]).length>0}
  const local=records(io.readState()||EMPTY),view=rebase(base,[]),map={},outbox=[];
  for(const c of choices?.add||[]){
   const r=local[c.key];if(!r||c.mode==='skip')continue;
   const twin=Object.values(view).find(s=>!s.deleted&&s.kind===r.kind&&identity(s.fields)===identity(r.fields)&&(s.fields.cat||'')===(r.fields.cat||''));
   if(twin&&c.mode==='sum'){map[c.key]=twin.id;if(r.qty>0&&COUNTERS[r.kind])outbox.push({op_id:uuid(rand),type:'add',kind:r.kind,id:twin.id,delta:r.qty});continue}
   if(twin&&c.mode!=='new'){map[c.key]=twin.id;continue}
   const sid=newSid(r.kind,rand);map[c.key]=sid;
   outbox.push({op_id:uuid(rand),type:'create',kind:r.kind,id:sid,fields:r.fields,qty:r.qty,ts:now()});
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
 return {flush,push,pull,apply,sync,status,resolveRejected,startAsCreator,startAsJoiner,adopt,meta:()=>clone(meta)};
}

const api=Object.freeze({records,diff,rebase,materialize,matchLocal,identity,newSid,uuid,createEngine,freshMeta});
if(typeof module!=='undefined'&&module.exports)module.exports=api;
root.AtokoreHouseholdCore=api;
})(typeof globalThis!=='undefined'?globalThis:this);
