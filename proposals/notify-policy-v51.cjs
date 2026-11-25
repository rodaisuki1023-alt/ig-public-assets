'use strict';
// Isolated notification policy prototype (v51). Sends NOTHING: decides which queued events may be
// delivered now, later or never. A future server worker would run it right before sending, after
// re-checking membership and settings. Real Web Push needs owner approval and iPhone testing.
// Rules: generic lock-screen text only (no product names); per-recipient daily cap; minimum gap;
// quiet hours deferred to the morning; several events inside the gap are combined into one;
// duplicate event ids are dropped; a kind the person turned off is dropped.
const DEFAULTS=Object.freeze({dailyCap:3,minGapMinutes:30,quietStart:21,quietEnd:7,tzOffsetMinutes:540});
const KINDS=new Set(['assignment','assignment-response','refill','prep']);
const GENERIC=Object.freeze({assignment:'買い物のお願いがあります','assignment-response':'買い物のお願いに返事がありました',refill:'そろそろ補充が必要な物があります',prep:'明日の準備を確認してください'});
function localHour(ms,tz){return new Date(ms+tz*60000).getUTCHours()}
function localDay(ms,tz){return new Date(ms+tz*60000).toISOString().slice(0,10)}
function nextMorning(ms,o){const d=new Date(ms+o.tzOffsetMinutes*60000);if(d.getUTCHours()>=o.quietEnd)d.setUTCDate(d.getUTCDate()+1);d.setUTCHours(o.quietEnd,0,0,0);return d.getTime()-o.tzOffsetMinutes*60000}
/** plan({events, sent, prefs, now, options}) -> {send, defer, drop}. Pure; never throws on bad rows. */
function plan({events=[],sent=[],prefs={},now,options={}}={}){
 const o={...DEFAULTS,...options},out={send:[],defer:[],drop:[]};
 if(!Number.isFinite(now))throw Error('now required');
 const seen=new Set(sent.map(s=>s&&s.id)),byRecipient=new Map();
 for(const e of events){
  if(!e||typeof e.id!=='string'||!e.id||typeof e.recipientId!=='string'||!KINDS.has(e.kind)){out.drop.push({id:e?.id??null,reason:'invalid'});continue}
  if(seen.has(e.id)){out.drop.push({id:e.id,reason:'duplicate'});continue}
  seen.add(e.id);
  if(prefs[e.recipientId]?.[e.kind]===false){out.drop.push({id:e.id,reason:'turned_off'});continue}
  const list=byRecipient.get(e.recipientId)||[];list.push(e);byRecipient.set(e.recipientId,list);
 }
 for(const [recipientId,list] of byRecipient){
  const mine=sent.filter(s=>s&&s.recipientId===recipientId&&Number.isFinite(s.at));
  const today=mine.filter(s=>localDay(s.at,o.tzOffsetMinutes)===localDay(now,o.tzOffsetMinutes)).length;
  const last=Math.max(-Infinity,...mine.map(s=>s.at));
  const h=localHour(now,o.tzOffsetMinutes),quiet=o.quietStart>o.quietEnd?(h>=o.quietStart||h<o.quietEnd):(h>=o.quietStart&&h<o.quietEnd);
  const ids=list.map(e=>e.id);
  if(quiet){out.defer.push({recipientId,ids,until:nextMorning(now,o),reason:'quiet_hours'});continue}
  if(today>=o.dailyCap){out.defer.push({recipientId,ids,until:nextMorning(now,o),reason:'daily_cap'});continue}
  if(now-last<o.minGapMinutes*60000){out.defer.push({recipientId,ids,until:last+o.minGapMinutes*60000,reason:'min_gap'});continue}
  // One notification per recipient per decision; several events become one generic line.
  const body=list.length===1?GENERIC[list[0].kind]:'家族から'+list.length+'件のお知らせがあります';
  out.send.push({recipientId,ids,title:'あとこれ',body});
 }
 return out;
}
module.exports={plan,DEFAULTS,GENERIC};
