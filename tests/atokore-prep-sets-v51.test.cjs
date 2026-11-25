// v51 weekday / event / per-child preparation rows (pure parts).
const test=require('node:test'),assert=require('node:assert/strict');
require('../atokore-live-v125/family-prep-v51.js');
const P=require('../atokore-live-v125/prep-sets-v51.js');
const base=()=>({v:1,children:[{id:'c-a',name:'上の子'},{id:'c-b',name:'下の子'}],
 week:{'c-a':{'1':[{id:'w1',name:'シーツ'},{id:'w2',name:'おむつ'}]},'c-b':{'1':[{id:'w3',name:'おむつ'}]}},
 events:{'c-a':{'2026-11-30':{label:'遠足',rows:[{id:'e1',name:'お弁当'}]}}},done:{}});
test('Monday rows of each child plus an event that adds to the week',()=>{
 const rows=P.rowsFor(base(),'2026-11-30'); // a Monday
 assert.deepEqual(rows.map(r=>[r.child,r.name,r.event]),[['上の子','シーツ',null],['上の子','おむつ',null],['上の子','お弁当','遠足'],['下の子','おむつ',null]]);
 assert.equal(new Set(rows.map(r=>r.instanceId)).size,4,'distinct per child and date');
 assert.deepEqual(P.rowsFor(base(),'2026-12-01'),[],'Tuesday: nothing');
});
test('pending counts children per name and drops ticked rows; ticks are per date',()=>{
 const s=base(),rows=P.rowsFor(s,'2026-11-30');
 assert.deepEqual(P.pendingToday(s,'2026-11-30'),[{name:'シーツ',children:1},{name:'おむつ',children:2},{name:'お弁当',children:1}]);
 s.done['2026-11-30']=[rows.find(r=>r.child==='下の子').instanceId];
 assert.deepEqual(P.pendingToday(s,'2026-11-30').find(x=>x.name==='おむつ'),{name:'おむつ',children:1});
 assert.deepEqual(P.pendingToday(s,'2026-12-07').find(x=>x.name==='おむつ'),{name:'おむつ',children:2},'next Monday starts fresh');
});
test('strict validation: corrupt, unknown child, bad day or date and oversize are rejected',()=>{
 assert.equal(P.valid(base()),true);
 for(const mut of [s=>{s.v=2},s=>{s.children.push(...[1,2,3].map(i=>({id:'c'+i,name:'x'})))},s=>{s.week['c-x']={}},s=>{s.week['c-a']['7']=[]},
  s=>{s.events['c-a']['2026-02-30']={rows:[]}},s=>{s.week['c-a']['1'].push({id:'w9',name:''})},s=>{s.children[1].id='c-a'},s=>{s.done.bad=[]}]){
  const s=base();mut(s);assert.equal(P.valid(s),false,mut.toString());
 }
});
test('two daycares are told apart; different sizes or names are never merged into one count',()=>{
 const s=base();
 s.children[0].place='さくら保育園';s.children[1].place='ひまわり園';
 assert.equal(P.valid(s),true);
 assert.equal(P.valid({...s,children:[{id:'x',name:'子',place:'x'.repeat(21)}]}),false);
 assert.equal(P.valid({...s,children:[{id:'x',name:'子',place:5}]}),false);
 const rows=P.rowsFor(s,'2026-11-30');
 assert.deepEqual([...new Set(rows.map(r=>r.place))],['さくら保育園','ひまわり園']);
 // Sizes are part of the name: おむつ M for one child and おむつ L for the other stay two lines.
 s.week['c-a']['1']=[{id:'m',name:'おむつ M'}];s.week['c-b']['1']=[{id:'l',name:'おむつ L'}];
 assert.deepEqual(P.pendingToday(s,'2026-11-30').filter(x=>x.name.startsWith('おむつ')),[{name:'おむつ M',children:1},{name:'おむつ L',children:1}]);
 // Old saved data without a place still reads.
 assert.equal(P.valid(base()),true);
});
