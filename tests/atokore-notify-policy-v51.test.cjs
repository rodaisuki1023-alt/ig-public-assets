const test=require('node:test'),assert=require('node:assert/strict');
const {plan}=require('../proposals/notify-policy-v51.cjs');
const JST=h=>Date.UTC(2026,10,25,h-9,0,0); // 2026-11-25 h:00 JST
const ev=(id,kind='assignment',to='u-b')=>({id,kind,recipientId:to});
test('generic text, one combined notification, duplicates and unknown kinds dropped',()=>{
 const r=plan({events:[ev('1'),ev('2','refill'),ev('1'),{id:'x',kind:'marketing',recipientId:'u-b'}],now:JST(10)});
 assert.deepEqual(r.send,[{recipientId:'u-b',ids:['1','2'],title:'あとこれ',body:'家族から2件のお知らせがあります'}]);
 assert.deepEqual(r.drop.map(d=>d.reason).sort(),['duplicate','invalid']);
 assert.doesNotMatch(JSON.stringify(r.send),/おむつ|ミルク|牛乳/,'no product names on the lock screen');
});
test('quiet hours defer to 7:00 JST; daily cap and minimum gap defer; already sent ids never repeat',()=>{
 const q=plan({events:[ev('3')],now:JST(22)});
 assert.equal(q.defer[0].reason,'quiet_hours');assert.equal(new Date(q.defer[0].until).toISOString(),'2026-11-25T22:00:00.000Z');
 const sent=[1,2,3].map(i=>({id:'s'+i,recipientId:'u-b',at:JST(8)+i*3600000}));
 assert.equal(plan({events:[ev('4')],sent,now:JST(13)}).defer[0].reason,'daily_cap');
 assert.equal(plan({events:[ev('5')],sent:[{id:'s9',recipientId:'u-b',at:JST(12)}],now:JST(12)+10*60000}).defer[0].reason,'min_gap');
 assert.equal(plan({events:[ev('s9')],sent:[{id:'s9',recipientId:'u-b',at:JST(9)}],now:JST(12)}).drop[0].reason,'duplicate');
});
test('a kind the person turned off is dropped; other people are independent',()=>{
 const r=plan({events:[ev('6','refill','u-a'),ev('7','assignment','u-b')],prefs:{'u-a':{refill:false}},now:JST(10)});
 assert.deepEqual(r.drop,[{id:'6',reason:'turned_off'}]);assert.equal(r.send[0].recipientId,'u-b');
});
test('v51.1: no notice for one\'s own action, all-off, same subject once, too old or settled events dropped',()=>{
 const {plan}=require('../proposals/notify-policy-v51.cjs');
 const now=Date.parse('2026-11-25T03:00:00Z'); // 12:00 JST
 const ev=(id,extra={})=>({id,recipientId:'B',kind:'assignment',at:now-60000,...extra});
 const r=plan({now,events:[ev('own',{actorId:'B'}),ev('a1',{subject:'buy-1'}),ev('a2',{subject:'buy-1'}),ev('old',{at:now-40*3600000}),ev('done',{subject:'buy-2'})],
  isCurrent:e=>e.subject!=='buy-2'});
 const why=Object.fromEntries(r.drop.map(d=>[d.id,d.reason]));
 assert.deepEqual(why,{own:'own_action',a2:'same_subject',old:'expired',done:'settled'});
 assert.deepEqual(r.send.map(s=>s.ids),[['a1']]);
 assert.equal(plan({now,events:[ev('x')],prefs:{B:{all:false}}}).drop[0].reason,'turned_off');
 // A failing check counts as settled (never sends on doubt).
 assert.equal(plan({now,events:[ev('y')],isCurrent:()=>{throw Error('db')}}).drop[0].reason,'settled');
 // The lock screen never shows the subject.
 assert.doesNotMatch(r.send[0].body,/buy-1/);
});
