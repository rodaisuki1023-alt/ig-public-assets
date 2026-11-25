// v51 easy 3-level stock and optional detailed estimate (pure, on-device).
const test=require('node:test');
const assert=require('node:assert/strict');
const L=require('../atokore-live-v125/stock-levels-v51.js');
const T='2026-11-25';
const day=(n)=>new Date(Date.parse(T+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
const diaper=(extra={})=>({id:1,name:'パンパース テープ M',cat:'ベビー',qty:2,unit:'袋',...extra});

test('old items keep working: no level/track means the existing count rule, read only',()=>{
 const item=diaper({minQty:2}),copy=JSON.stringify(item);
 assert.deepEqual(L.displayLevel(item,T),{level:'low',label:'そろそろ',source:'count'});
 assert.equal(L.displayLevel({...item,qty:0},T).level,'buy');
 assert.equal(L.displayLevel({...item,qty:5},T).level,'plenty');
 assert.equal(L.displayLevel({...item,qty:'x'},T).level,'unknown','unknown is not zero');
 assert.equal(L.displayLevel({...item,minQty:undefined,qty:1},T).level,'low','default refill line 1');
 assert.equal(JSON.stringify(item),copy,'nothing is written');
});
test('easy mode: the person\'s level wins over count and estimate, and never changes qty',()=>{
 const {patch}=L.setLevel('buy',Date.parse(T+'T08:00:00Z'));
 assert.deepEqual(Object.keys(patch).sort(),['level','levelAt']);
 const item={...diaper({qty:9}),...patch};
 assert.equal(L.displayLevel(item,T).source,'manual');assert.equal(L.displayLevel(item,T).label,'買う');
 assert.ok(L.setLevel('few',0).error);
 assert.deepEqual(L.clearLevel().patch,{level:undefined,levelAt:undefined});
});
test('detailed: packs × per pack, daily use, refill line; estimate is separate from the count',()=>{
 const {track}=L.startTrack({packs:2,perPack:60,perDay:6,refillDays:5,size:'M',today:T});
 assert.equal(track.base,120);
 const item=diaper({qty:2,track,size:'M'});
 let e=L.estimate(item,T);assert.equal(e.status,'estimate');assert.equal(e.remaining,120);assert.equal(e.daysLeft,20);assert.equal(e.level,'plenty');assert.equal(e.packs,2);
 e=L.estimate(item,day(16));assert.equal(e.daysLeft,4);assert.equal(e.level,'low');
 e=L.estimate(item,day(18));assert.equal(e.level,'buy');
 e=L.estimate(item,day(25));assert.equal(e.remaining,0);assert.equal(e.level,'buy');
 assert.equal(item.qty,2,'the counted stock is never replaced by the estimate');
 assert.ok(e.range[0]<=e.daysLeft&&e.range[1]>=e.daysLeft);
 assert.equal(L.estimate(item,day(10)).runOut,day(20));
});
test('uncertainty grows and a long-unconfirmed estimate asks to be checked instead',()=>{
 const {track}=L.startTrack({units:600,perDay:6,today:T});
 const item=diaper({track});
 const w1=L.estimate(item,day(7)),w4=L.estimate(item,day(28));
 assert.ok((w4.range[1]-w4.range[0])/Math.max(1,w4.daysLeft)>=(w1.range[1]-w1.range[0])/Math.max(1,w1.daysLeft));
 const stale=L.estimate(item,day(L.STALE_DAYS+1));
 assert.deepEqual([stale.status,stale.reason],['unknown','stale']);
 assert.equal(L.displayLevel(item,day(40)).label,'確認');
});
test('size change resets the estimate and is reported, the count is kept',()=>{
 const {track}=L.startTrack({packs:1,perPack:60,perDay:6,size:'M',today:T});
 const item=diaper({track,size:'L'});
 assert.deepEqual([L.estimate(item,day(1)).status,L.estimate(item,day(1)).reason],['unknown','size_changed']);
 const r=L.changeSize(track,'L',{today:day(1)});
 assert.equal(r.track,null);assert.equal(r.previous.perDay,6);
});
test('several children: household daily use is the sum of each child',()=>{
 assert.equal(L.combinedPerDay([6,4.5]),10.5);
 assert.equal(L.combinedPerDay([]),null);assert.equal(L.combinedPerDay([6,-1]),null);assert.equal(L.combinedPerDay(Array(7).fill(1)),null);
 const {track}=L.startTrack({packs:3,perPack:60,perDay:L.combinedPerDay([6,4]),today:T});
 assert.equal(L.estimate({track},day(9)).daysLeft,9);
});
test('purchase adds to the current estimate once and restarts from today',()=>{
 const {track}=L.startTrack({packs:1,perPack:60,perDay:6,today:T});
 const r=L.addPurchase(track,{packs:2,today:day(5)});
 assert.equal(r.track.base,150);assert.equal(r.track.since,day(5));
 assert.equal(L.addPurchase(L.startTrack({units:10,perDay:1,today:T}).track,{packs:1,today:T}).error,'1袋の枚数（個数）が未設定です');
 assert.ok(L.addPurchase(track,{packs:0,today:T}).error);
 assert.ok(L.addPurchase(track,{units:5,today:day(-1)}).error,'not before the count date');
});
test('used up: learns a plausible rate, suggests count 0, never writes it',()=>{
 const {track}=L.startTrack({packs:1,perPack:60,perDay:6,today:T});
 const r=L.correct(track,'usedUp',{today:day(8)}); // 60 in 8 days = 7.5/day
 assert.equal(r.suggestQty,0);assert.equal(r.track.base,0);assert.equal(r.track.perDay,6.75);assert.equal(r.learned,true);
 const odd=L.correct(track,'usedUp',{today:day(1)});
 assert.equal(odd.track.perDay,6,'too few days: no learning');
 const wild=L.correct(track,'usedUp',{today:day(30)}); // 2/day is below half: implausible
 assert.equal(wild.track.perDay,6);
});
test('still have some: slows the rate at most 30% and restarts from the stated amount',()=>{
 const {track}=L.startTrack({packs:1,perPack:60,perDay:6,today:T});
 const r=L.correct(track,'still',{today:day(10),remaining:20});
 assert.equal(r.track.base,20);assert.equal(r.track.since,day(10));assert.ok(r.track.perDay>=4.2&&r.track.perDay<=6);
 const rough=L.correct(track,'still',{today:day(10)});
 assert.equal(rough.approximate,true);assert.ok(rough.track.perDay<6);
 assert.ok(L.correct(track,'still',{today:day(10),remaining:-3}).error);
});
test('later hides the reminder for three days without changing the estimate',()=>{
 const {track}=L.startTrack({units:10,perDay:5,today:T});
 const r=L.correct(track,'later',{today:day(1)});
 assert.equal(r.track.snoozeUntil,day(4));assert.equal(r.track.base,10);
 assert.equal(L.estimate({track:r.track},day(2)).snoozed,true);
 assert.equal(L.estimate({track:r.track},day(4)).snoozed,false);
});
test('corrupt or hostile tracks never throw and never produce a number',()=>{
 for(const t of [null,{},{v:2},{v:1,base:-1,since:T,perDay:1},{v:1,base:1,since:'2026-13-40',perDay:1},{v:1,base:1,since:T,perDay:0},{v:1,base:1e9,since:T,perDay:1},{v:1,base:1,since:T,perDay:1,perPack:0.5},{v:1,base:1,since:T,perDay:1,refillDays:999}])
  assert.equal(L.estimate({track:t},T).status,'none',JSON.stringify(t));
 assert.equal(L.estimate({track:{v:1,base:5,since:day(3),perDay:1}},T).status,'unknown','future count date');
 for(const bad of [{perDay:0,units:5,today:T},{perDay:1,units:5,today:'x'},{perDay:1,packs:1.5,perPack:60,today:T},{perDay:1,packs:1,perPack:0,today:T},{perDay:1,units:-1,today:T},{perDay:1,units:5,refillDays:0,today:T}])
  assert.ok(L.startTrack(bad).error,JSON.stringify(bad));
});

test('purchase adds to the estimate once per key, in pieces for bags, and moves the base date',()=>{
 const start=L.startTrack({packs:1,perPack:60,perDay:6,pieceUnit:'枚',today:day(-5),size:null}).track;
 const item=diaper({qty:1,track:start});
 // 5 days × 6/day used from 60: 30 left; +2 bags × 60 = 150 from today.
 const r=L.purchaseTrack(item,2,{today:T,key:'buy:a'});
 assert.equal(r.added,120);assert.equal(r.track.base,150);assert.equal(r.track.since,T);assert.deepEqual(r.track.applied,['buy:a']);
 assert.equal(L.estimate({...item,track:r.track},T).remaining,150);
 const again=L.purchaseTrack({...item,track:r.track},2,{today:T,key:'buy:a'});
 assert.equal(again.unchanged,true);assert.equal(again.track.base,150,'a retry or repaint never adds twice');
 const other=L.purchaseTrack({...item,track:r.track},1,{today:T,key:'buy:b'});
 assert.equal(other.track.base,210);assert.deepEqual(other.track.applied,['buy:a','buy:b']);
 // Only the last 8 keys are kept (bounded storage).
 let t=r.track;for(let i=0;i<12;i++)t=L.purchaseTrack({...item,track:t},1,{today:T,key:'k'+i}).track;
 assert.equal(t.applied.length,8);assert.equal(t.applied.at(-1),'k11');
 // Not a tracked item / bad key.
 assert.deepEqual(L.purchaseTrack(diaper(),1,{today:T,key:'x'}),{track:null});
 assert.equal(L.purchaseTrack(item,1,{today:T,key:''}).error,'purchase_key');
});
test('purchase in an unknown unit is never guessed: the estimate asks to be checked',()=>{
 const noPack={v:1,base:30,since:day(-1),perDay:6,perPack:null,refillDays:5,pieceUnit:'枚',size:null,snoozeUntil:null,confirmedAt:day(-1)};
 const r=L.purchaseTrack(diaper({track:noPack}),1,{today:T,key:'buy:c'});
 assert.equal(r.check,'purchase_unit');assert.equal(r.track.base,30,'nothing added');
 assert.deepEqual(L.estimate(diaper({track:r.track}),T),{status:'unknown',reason:'purchase_unit'});
 // The unit changed since tracking started (pieces 個 -> bag counted in 枚): not added either.
 const pieces=L.startTrack({units:10,perDay:2,pieceUnit:'個',today:day(-1)}).track;
 assert.equal(L.purchaseTrack({id:2,name:'ゼリー',unit:'袋',qty:1,track:pieces},1,{today:T,key:'k'}).check,'purchase_unit');
 // A future base date cannot be advanced safely.
 assert.equal(L.purchaseTrack(diaper({track:{...noPack,perPack:60,since:day(2),confirmedAt:day(2)}}),1,{today:T,key:'k'}).check,'purchase_unit');
 // The check stays through a later addable purchase, and the person's own correction settles it.
 const later=L.purchaseTrack(diaper({track:{...r.track,perPack:60}}),1,{today:T,key:'buy:d'});
 assert.equal(later.track.check,'purchase_unit');assert.equal(later.track.base,84); // 30-6 used +60
 const fixed=L.correct(later.track,'still',{today:T,remaining:80});
 assert.equal(fixed.track.check,null);assert.equal(L.estimate(diaper({track:fixed.track}),T).status,'estimate');
 // Corrupt check/applied values are ignored, never thrown.
 const odd=L.readTrack({...noPack,check:'other',applied:['ok',5,'x'.repeat(81)]});
 assert.equal(odd.check,null);assert.deepEqual(odd.applied,['ok']);
});
test('a plain-unit product adds the bought amount directly; old tracks without the new fields still work',()=>{
 const old={v:1,base:6,since:day(-2),perDay:1,perPack:null,refillDays:5,size:null,snoozeUntil:null,confirmedAt:day(-2)};
 const milk={id:3,name:'牛乳',unit:'本',qty:1,track:old};
 const r=L.purchaseTrack(milk,2,{today:T,key:'buy:e'});
 assert.equal(r.track.base,6);assert.equal(r.added,2);
 assert.equal(L.estimate(milk,T).remaining,4);
});
test('undoing a purchase restores the estimate only if nothing changed it since; otherwise it asks',()=>{
 const {inverseCounters}=require('../atokore-live-v125/polish-v44.js');
 const before=L.startTrack({packs:1,perPack:60,perDay:6,pieceUnit:'枚',today:T}).track;
 const after=L.purchaseTrack(diaper({qty:1,track:before}),1,{today:T,key:'buy:u'}).track;
 const change={key:'items',id:1,name:'パンパース テープ M',unit:'袋',delta:1,usage:0,track:{before,after}};
 const state=t=>({items:[diaper({qty:2,track:t})],buys:[],routines:[]});
 // Keys come back sorted from the server (jsonb): still recognised as unchanged.
 const sorted=Object.fromEntries(Object.keys(after).sort().map(k=>[k,after[k]]));
 const undone=inverseCounters(state(sorted),[change]);
 assert.equal(undone.items[0].qty,1);assert.deepEqual(undone.items[0].track,before);
 const edited=inverseCounters(state({...after,base:5}),[change]);
 assert.equal(edited.items[0].qty,1);assert.equal(edited.items[0].track.base,5);assert.equal(edited.items[0].track.check,'purchase_undo');
 assert.deepEqual(L.estimate(edited.items[0],T),{status:'unknown',reason:'purchase_undo'});
 // A purchase that started the product's first estimate-less row keeps working as before.
 const plain=inverseCounters({items:[diaper({qty:2})],buys:[],routines:[]},[{...change,track:undefined}]);
 assert.equal(plain.items[0].qty,1);assert.equal('track' in plain.items[0],false);
});
