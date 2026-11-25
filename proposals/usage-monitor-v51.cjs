'use strict';
// Free-tier usage monitor prototype (v51), synthetic data only. Reading real usage needs a Supabase
// Management API token (secret, owner approval). Limits from the master policy (Supabase Free,
// https://supabase.com/pricing, to be re-checked before use). Levels: <50 normal, 50 notice,
// 70 warn, 80 reduce, 90 restrict. Actions protect existing data and never delete anything.
const LIMITS=Object.freeze({dbMB:500,storageMB:1024,uncachedEgressGB:5,cachedEgressGB:5,mau:50000,edgeInvocations:500000,realtimeConcurrent:200,realtimeMessages:2000000});
const ACTIONS=Object.freeze({
 notice:['オーナーに記録（週1で確認）'],
 warn:['オーナーに通知','増加の原因（世帯・機能）を確認'],
 reduce:['ポーリングの最大間隔を延ばす（2分→5分）','写真の新規共有を一時停止（既存写真は表示）'],
 restrict:['新規の世帯作成・招待を一時停止（既存世帯は利用可）','有料プランの費用と比較して判断'],
});
function level(pct){return pct>=90?'restrict':pct>=80?'reduce':pct>=70?'warn':pct>=50?'notice':'normal'}
/** evaluate(metrics) -> rows per metric and the actions of the worst level. Unknown != zero. */
function evaluate(metrics,limits=LIMITS){
 const rows=Object.keys(limits).map(k=>{
  const v=metrics?.[k];
  if(!Number.isFinite(v)||v<0)return {metric:k,value:null,pct:null,level:'unknown'};
  const pct=Math.round(v/limits[k]*1000)/10;return {metric:k,value:v,pct,level:level(pct)};
 });
 const order=['normal','notice','warn','reduce','restrict'];
 const worst=rows.filter(r=>r.level!=='unknown').reduce((w,r)=>order.indexOf(r.level)>order.indexOf(w)?r.level:w,'normal');
 return {rows,worst,actions:ACTIONS[worst]||[],unknown:rows.filter(r=>r.level==='unknown').map(r=>r.metric)};
}
/** Linear projection of a monthly-reset metric from daily cumulative samples [{day, value}]. */
function project(samples,limit,daysInMonth=30){
 const s=(samples||[]).filter(x=>Number.isInteger(x?.day)&&x.day>=1&&Number.isFinite(x.value)).sort((a,b)=>a.day-b.day);
 if(s.length<3)return {status:'insufficient'};
 const last=s[s.length-1],perDay=last.value/last.day,end=perDay*daysInMonth;
 const dayAt=p=>perDay>0?Math.ceil(limit*p/perDay):null;
 return {status:'estimate',perDay:Math.round(perDay*100)/100,monthEnd:Math.round(end*10)/10,monthEndPct:Math.round(end/limit*1000)/10,day80:dayAt(0.8),day100:dayAt(1)};
}
module.exports={LIMITS,ACTIONS,level,evaluate,project};
if(require.main===module){
 // Synthetic example: 1,000 households after the v51 polling change (not a measurement).
 const synthetic={dbMB:61,storageMB:290,uncachedEgressGB:2.1,cachedEgressGB:0.4,mau:2100,edgeInvocations:186000,realtimeConcurrent:0,realtimeMessages:0};
 const r=evaluate(synthetic);
 console.log('SYNTHETIC DATA — not real usage');for(const x of r.rows)console.log(x.metric.padEnd(20),String(x.pct).padStart(6)+'%',x.level);
 console.log('worst:',r.worst,r.actions.join(' / ')||'(none)');
 console.log('edge projection:',JSON.stringify(project([{day:5,value:31000},{day:10,value:62000},{day:15,value:93000}],LIMITS.edgeInvocations)));
}
