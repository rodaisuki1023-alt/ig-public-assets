/* Atokore v19 storage bootstrap — runs in <head> before the app reads localStorage.
 * 1) A stored value that cannot be parsed is moved aside (never deleted) so the app can start.
 * 2) Sandbox trials only: copy the previous trial's data once. The source key is never modified.
 */
(function(root){
'use strict';
const KEY='atokoreTrialV4',HISTORY='atokoreHistoryV1';
const SOURCES=[['atokorePreviewTrialV17','atokorePreviewHistoryV17'],['atokorePreviewTrialV16','atokorePreviewHistoryV16']];
function valid(state){return !!state&&typeof state==='object'&&Array.isArray(state.items)&&Array.isArray(state.buys)&&Array.isArray(state.routines)}
function parse(raw){try{return JSON.parse(raw)}catch(e){return undefined}}
function run(store){
 const notes=[];
 let raw=null;
 try{raw=store.getItem(KEY)}catch(e){return notes}
 if(raw!==null&&!valid(parse(raw))){
  const aside=KEY+'Unreadable'+Date.now();
  try{store.setItem(aside,raw);store.removeItem(KEY);notes.push({type:'unreadable',key:aside})}
  catch(e){notes.push({type:'unreadable-kept'})}
  raw=null;
 }
 // Production keys are never migrated; only renamed sandbox keys copy older trial data.
 if(raw===null&&KEY.indexOf('atokorePreview')===0){
  for(const [dataKey,historyKey] of SOURCES){
   let source=null;try{source=store.getItem(dataKey)}catch(e){}
   const state=source===null?undefined:parse(source);
   if(!valid(state))continue;
   try{
    store.setItem(KEY,source);
    if(store.getItem(KEY)!==source)throw Error('copy mismatch');
    let history=null;try{history=store.getItem(historyKey)}catch(e){}
    if(history!==null&&store.getItem(HISTORY)===null&&Array.isArray(parse(history)))store.setItem(HISTORY,history);
    store.setItem(KEY+'MigratedFrom',JSON.stringify({from:dataKey,at:Date.now(),items:state.items.length,buys:state.buys.length,routines:state.routines.length}));
    notes.push({type:'migrated',from:dataKey,items:state.items.length});
   }catch(e){try{store.removeItem(KEY)}catch(_){}notes.push({type:'migration-failed',from:dataKey})}
   break;
  }
 }
 return notes;
}
const api=Object.freeze({run,valid,KEY});
if(typeof module!=='undefined'&&module.exports)module.exports=api;
root.AtokoreStorageBootstrap=api;
let store=null;try{store=root.localStorage||null}catch(e){}
if(store&&typeof document!=='undefined')root.__atokoreBootNotes=run(store);
})(typeof globalThis!=='undefined'?globalThis:this);
