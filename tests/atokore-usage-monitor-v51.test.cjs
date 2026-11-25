const test=require('node:test'),assert=require('node:assert/strict');
const M=require('../proposals/usage-monitor-v51.cjs');
test('levels at 50/70/80/90 % and the worst level picks the actions',()=>{
 assert.deepEqual([49.9,50,69.9,70,80,90,120].map(M.level),['normal','notice','notice','warn','reduce','restrict','restrict']);
 const r=M.evaluate({dbMB:450,storageMB:100,uncachedEgressGB:4.1,cachedEgressGB:0,mau:10,edgeInvocations:0,realtimeConcurrent:0,realtimeMessages:0});
 assert.equal(r.rows.find(x=>x.metric==='dbMB').level,'restrict');assert.equal(r.rows.find(x=>x.metric==='uncachedEgressGB').level,'reduce');
 assert.equal(r.worst,'restrict');assert.ok(r.actions.some(a=>a.includes('既存世帯は利用可')));
 assert.ok(!JSON.stringify(M.ACTIONS).includes('削除'),'no action deletes data');
});
test('missing or broken metrics are unknown, not zero',()=>{
 const r=M.evaluate({dbMB:10});
 assert.equal(r.rows.find(x=>x.metric==='storageMB').level,'unknown');assert.equal(r.unknown.length,7);assert.equal(r.worst,'normal');
 assert.equal(M.evaluate({dbMB:-1}).rows[0].level,'unknown');
});
test('monthly projection needs three samples and reports the 80 % and 100 % days',()=>{
 assert.equal(M.project([{day:1,value:1}],100).status,'insufficient');
 const p=M.project([{day:5,value:31000},{day:10,value:62000},{day:15,value:93000}],500000);
 assert.deepEqual([p.perDay,p.monthEnd,p.monthEndPct,p.day80,p.day100],[6200,186000,37.2,65,81]);
});
