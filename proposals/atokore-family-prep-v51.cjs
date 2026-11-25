'use strict';
// Isolated proposal. No browser, storage, database, billing or notification network access.
// Inputs must come from authenticated, validated state before any eventual integration.
const key=x=>typeof x==='string'&&x.length>0&&x.length<=100;
const count=x=>Number.isSafeInteger(x)&&x>=0&&x<=99999;
const dayKey=s=>{if(typeof s!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(s))return false;const d=new Date(s+'T00:00:00Z');return Number.isFinite(+d)&&d.toISOString().slice(0,10)===s};
const copy=x=>JSON.parse(JSON.stringify(x));
function planDay(profiles,date){
 if(!dayKey(date)||!Array.isArray(profiles))throw Error('invalid date or profiles');
 const day=new Date(date+'T00:00:00Z').getUTCDay(),result=[],seen=new Set();
 for(const p of profiles){
  if(!p||!key(p.id)||seen.has(p.id)||!Array.isArray(p.week?.[day]??[]))throw Error('invalid profile');
  seen.add(p.id);
  const override=p.exceptions&&Object.prototype.hasOwnProperty.call(p.exceptions,date)?p.exceptions[date]:undefined;
  const rows=override===undefined?p.week?.[day]??[]:override;
  if(!Array.isArray(rows)||rows.length>50)throw Error('invalid rows');
  const ids=new Set();
  for(const row of rows){
   if(!row||!key(row.id)||ids.has(row.id)||!key(row.name)||!count(row.required)||row.required===0||!key(row.unit))throw Error('invalid requirement');
   ids.add(row.id);result.push({...copy(row),profileId:p.id,date,instanceId:JSON.stringify([date,p.id,row.id])});
  }
 }
 return result;
}
function shortagePlan(rows,stocks,buys){
 if(![rows,stocks,buys].every(Array.isArray))throw Error('invalid data');
 const groups=new Map(),unresolved=[],seen=new Set();
 for(const r of rows){
  if(r&&typeof r.instanceId==='string'&&r.instanceId.length<=1300){if(seen.has(r.instanceId))throw Error('duplicate requirement');seen.add(r.instanceId)}
  if(!r||typeof r.instanceId!=='string'||r.instanceId.length===0||r.instanceId.length>1300||!key(r.stockId)||!key(r.unit)||!count(r.required)||r.required===0){unresolved.push({instanceId:r?.instanceId??null,status:'unregistered'});continue}
  const matches=stocks.filter(s=>s&&String(s.id)===r.stockId);
  if(matches.length!==1){unresolved.push({instanceId:r.instanceId,status:matches.length?'ambiguous':'unregistered'});continue}
  const stock=matches[0];
  if(stock.unit!==r.unit||!count(stock.qty)){unresolved.push({instanceId:r.instanceId,status:'unit_or_quantity_unknown'});continue}
  const id=JSON.stringify([r.stockId,r.unit]),g=groups.get(id)||{stockId:r.stockId,name:stock.name,unit:r.unit,available:stock.qty,required:0,instances:[]};
  if(g.instances.includes(r.instanceId))throw Error('duplicate requirement');
  if(!count(g.required+r.required))throw Error('quantity overflow');
  g.required+=r.required;g.instances.push(r.instanceId);groups.set(id,g);
 }
 const items=[...groups.values()].map(g=>{
  const related=buys.filter(b=>b&&String(b.stockId)===g.stockId);
  // Unlinked same-name rows may already represent the purchase: ask rather than duplicate.
  const uncertain=buys.some(b=>b&&b.stockId==null&&b.name===g.name)||related.some(b=>b.unit!==g.unit||!count(b.qty));
  const queued=related.filter(b=>b.unit===g.unit&&count(b.qty)).reduce((n,b)=>n+b.qty,0);
  const missing=Math.max(0,g.required-g.available);
  return {...g,missing,queued,additional:uncertain?null:Math.max(0,missing-queued),status:missing===0?'enough':uncertain?'review_existing':queued>=missing?'queued':'shortage'};
 });
 return {items,unresolved};
}
function forecast(stock,daily,asOf){
 if(!stock||!key(stock.unit)||!count(stock.qty)||!dayKey(asOf)||!Array.isArray(daily))return {status:'unknown'};
 // Require 7 explicit consecutive completed days in the exact same unit;
 // missing observations are not treated as zero, and same-day edits must be resolved upstream.
 const days=Array.from({length:7},(_,i)=>new Date(Date.parse(asOf+'T00:00:00Z')-(i+1)*86400000).toISOString().slice(0,10));
 const values=[];
 for(const date of days){
  const hits=daily.filter(x=>x&&x.date===date);
  if(hits.length!==1||hits[0].unit!==stock.unit||!count(hits[0].used))return {status:'insufficient'};
  values.push(hits[0].used);
 }
 const total=values.reduce((a,b)=>a+b,0);
 if(!total)return {status:'insufficient'};
 return {status:'estimate',days:Math.floor(stock.qty*7/total),average:total/7,unit:stock.unit,sampleDays:7};
}
function assignmentPlan({householdId,buyId,actorId,assigneeId,currentAssigneeId,revision,members}={}){
 if(![householdId,buyId,actorId].every(key)||!count(revision)||!Array.isArray(members))throw Error('invalid assignment');
 // Reference policy for a SERVER-side transaction, never a client authorization decision.
 const active=id=>members.some(m=>m&&m.id===id&&m.householdId===householdId&&m.active===true);
 if(!active(actorId)||!(assigneeId===null||key(assigneeId)&&active(assigneeId)))return {status:'denied'};
 if(currentAssigneeId===assigneeId)return {status:'unchanged'};
 if(revision===99999)throw Error('revision overflow');
 const next=revision+1;
 return {status:'ready',revision:next,assigneeId,
  event:assigneeId===null||assigneeId===actorId?null:{id:JSON.stringify([householdId,buyId,next,'assignment']),recipientId:assigneeId,title:'あとこれ',body:'買い物のお願いがあります',kind:'assignment'}};
}

// Reference policy for a server transaction with locked current record and membership.
// A declined request releases the item, so the household can find another buyer.
function assignmentResponsePlan({householdId,buyId,actorId,assigneeId,requesterId,revision,expectedRevision,response,decision,members}={}){
 if(![householdId,buyId,actorId,assigneeId,requesterId].every(key)||!count(revision)||!count(expectedRevision)||!Array.isArray(members)||!['accept','decline'].includes(decision))throw Error('invalid response');
 const active=id=>members.some(m=>m&&m.id===id&&m.householdId===householdId&&m.active===true);
 if(actorId!==assigneeId||actorId===requesterId||!active(actorId)||!active(requesterId))return {status:'denied'};
 if(revision!==expectedRevision||response!=='pending')return {status:'stale'};
 if(revision===99999)throw Error('revision overflow');
 const next=revision+1,accepted=decision==='accept';
 return {status:'ready',revision:next,assigneeId:accepted?assigneeId:null,response:accepted?'accepted':'declined',
  event:{id:JSON.stringify([householdId,buyId,next,'response']),recipientId:requesterId,title:'あとこれ',body:accepted?'買い物のお願いが引き受けられました':'買い物の担当を確認してください',kind:'assignment-response'}};
}
if(typeof module==='object'&&module.exports)module.exports={planDay,shortagePlan,forecast,assignmentPlan,assignmentResponsePlan};
else if(typeof window==='object')window.AtokorePrepProposal=Object.freeze({planDay,shortagePlan,forecast,assignmentPlan,assignmentResponsePlan});
