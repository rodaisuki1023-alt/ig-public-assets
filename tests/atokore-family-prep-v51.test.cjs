'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {planDay,shortagePlan,forecast,assignmentPlan,assignmentResponsePlan}=require('../proposals/atokore-family-prep-v51.cjs');
const row=(id,stockId='diaperM',unit='枚',required=5)=>({id,name:'おむつ',stockId,unit,required});
const profiles=[{id:'a',week:{1:[row('a')]},exceptions:{'2026-11-30':[]}},{id:'b',week:{1:[row('b')]}}];
test('Monday profiles independent; exception and daily instance identity',()=>{
 const first=planDay(profiles,'2026-11-23');assert.equal(first.length,2);assert.notEqual(first[0].instanceId,first[1].instanceId);assert.equal(planDay(profiles,'2026-11-30').length,1);assert.throws(()=>planDay(profiles,'2026-02-30'));
});
test('two children share one stock, queued quantities subtracted, no mutation',()=>{
 const rows=planDay(profiles,'2026-11-23'),stocks=[{id:'diaperM',name:'M',unit:'枚',qty:3}],buys=[{stockId:'diaperM',unit:'枚',qty:2}];
 const before=JSON.stringify([rows,stocks,buys]);const x=shortagePlan(rows,stocks,buys).items[0];assert.equal(x.required,10);assert.equal(x.missing,7);assert.equal(x.additional,5);assert.equal(JSON.stringify([rows,stocks,buys]),before);
});
test('unknown and different units not treated as zero or converted',()=>{
 const rows=planDay(profiles,'2026-11-23');const x=shortagePlan(rows,[{id:'diaperM',unit:'袋',qty:1}],[]);assert.equal(x.items.length,0);assert.equal(x.unresolved.length,2);assert.equal(shortagePlan(rows,[],[]).unresolved[0].status,'unregistered');
});
test('zero stock is shortage; queued or ambiguous unlinked row not duplicated',()=>{
 const rows=planDay(profiles,'2026-11-23'),stocks=[{id:'diaperM',name:'M',unit:'枚',qty:0}];
 assert.equal(shortagePlan(rows,stocks,[]).items[0].additional,10);
 assert.equal(shortagePlan(rows,stocks,[{stockId:'diaperM',qty:10,unit:'枚'}]).items[0].status,'queued');
 assert.equal(shortagePlan(rows,stocks,[{name:'M',qty:1,unit:'袋'}]).items[0].additional,null);
});
test('size variants cannot be summed; duplicate requirement rejected',()=>{
 const rows=planDay([{id:'a',week:{1:[row('a'),row('b','diaperL')]}}],'2026-11-23');
 assert.equal(shortagePlan(rows,[{id:'diaperM',unit:'枚',qty:1},{id:'diaperL',unit:'枚',qty:9}],[]).items.length,2);
 assert.throws(()=>shortagePlan([rows[0],rows[0]],[{id:'diaperM',unit:'枚',qty:1}],[]));
});
test('forecast needs seven full days and exact units',()=>{
 const d=Array.from({length:7},(_,i)=>({date:'2026-11-'+String(23-i),unit:'枚',used:6}));
 const stock={qty:18,unit:'枚'};
 assert.equal(forecast(stock,d,'2026-11-24').days,3);assert.equal(forecast(stock,d.slice(1),'2026-11-24').status,'insufficient');assert.equal(forecast({...stock,unit:'袋'},d,'2026-11-24').status,'insufficient');
});
test('assignment validates active same-household members, no self or repeated notification',()=>{
 const a={householdId:'h',buyId:'b',actorId:'a',assigneeId:'b',currentAssigneeId:null,revision:1,members:[{id:'a',householdId:'h',active:true},{id:'b',householdId:'h',active:true},{id:'c',householdId:'other',active:true},{id:'d',householdId:'h',active:false}]};
 const result=assignmentPlan(a);assert.equal(result.event.recipientId,'b');assert.deepEqual(result,assignmentPlan(a));assert.equal(assignmentPlan({...a,currentAssigneeId:'b'}).status,'unchanged');
 assert.equal(assignmentPlan({...a,assigneeId:'c'}).status,'denied');assert.equal(assignmentPlan({...a,assigneeId:'d'}).status,'denied');assert.equal(assignmentPlan({...a,assigneeId:'a'}).event,null);assert.equal(assignmentPlan({...a,assigneeId:null,currentAssigneeId:'b'}).event,null);
});

test('long valid UUID-style identifiers remain distinct and duplicate rows fail across products',()=>{
 const rows=planDay([{id:'p'.repeat(100),week:{1:[row('r'.repeat(100))]}}],'2026-11-23');
 assert.equal(shortagePlan(rows,[{id:'diaperM',unit:'枚',qty:0}],[]).items[0].missing,5);
 assert.throws(()=>shortagePlan([rows[0],{...rows[0],stockId:'diaperL'}],[{id:'diaperM',unit:'枚',qty:0},{id:'diaperL',unit:'枚',qty:0}],[]));
});

test('only assigned active member can respond; stale revision and duplicate response blocked',()=>{
 const a={householdId:'h',buyId:'b',actorId:'b',assigneeId:'b',requesterId:'a',revision:2,expectedRevision:2,response:'pending',decision:'accept',members:[{id:'a',householdId:'h',active:true},{id:'b',householdId:'h',active:true},{id:'c',householdId:'other',active:true}]};
 const p=assignmentResponsePlan(a);assert.equal(p.response,'accepted');assert.equal(p.revision,3);assert.equal(p.event.recipientId,'a');
 assert.equal(assignmentResponsePlan({...a,actorId:'a'}).status,'denied');assert.equal(assignmentResponsePlan({...a,actorId:'c'}).status,'denied');
 assert.equal(assignmentResponsePlan({...a,expectedRevision:1}).status,'stale');
 assert.equal(assignmentResponsePlan({...a,response:'accepted'}).status,'stale');
 assert.equal(assignmentResponsePlan({...a,members:a.members.map(m=>m.id==='b'?{...m,active:false}:m)}).status,'denied');
 const d=assignmentResponsePlan({...a,decision:'decline'});assert.equal(d.assigneeId,null);assert.equal(d.response,'declined');
});
