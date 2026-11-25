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

// ---- Purchases as separate fields (family-safe) -----------------------------------------------
const NOW=Date.parse(T+'T03:00:00Z');
const base120=(extra={})=>L.startTrack({packs:2,perPack:60,perDay:6,pieceUnit:'枚',today:T,now:NOW-1000,...extra}).track;
const buy=(item,key,bags=1,at=NOW)=>{const p=L.purchaseEntry(item,bags,{today:T,now:at,key});return {...item,[p.field]:p.entry}};
// Field-wise merge as the family sync does it (each field: last writer wins).
const merge=(...versions)=>Object.assign({},...versions);

test('two family purchases at once both count; undoing one leaves the other; a resend adds nothing',()=>{
 const start=diaper({qty:2,track:base120()});
 assert.equal(L.estimate(start,T).remaining,120);
 const a=buy(start,'buy:A'),b=buy(start,'buy:B');            // phone A and phone B, same day, offline
 assert.equal(L.estimate(a,T).remaining,180);assert.equal(L.estimate(b,T).remaining,180);
 const both=merge(a,b),reversed=merge(b,a);
 assert.equal(L.estimate(both,T).remaining,240,'120 + 60 + 60');
 assert.deepEqual(both,reversed,'sync order does not matter');
 assert.equal(L.estimate(merge(both,b,a,b),T).remaining,240,'the same purchase sent again adds nothing');
 const fa=L.entryField('buy:A');
 const undo=L.undoEntry(both,fa,'buy:A');
 const afterUndo={...both};for(const [k,v] of Object.entries(undo.patch))if(v===undefined)delete afterUndo[k];else afterUndo[k]=v;
 assert.equal(L.estimate(afterUndo,T).remaining,180,'undo one purchase: back to 180');
 assert.equal(undo.patch.track,undefined,'nothing asks: the purchase was never inside the base');
 // A cleared field arriving from the family as null is the same as absent.
 assert.equal(L.estimate({...both,[fa]:null},T).remaining,180);
 assert.equal(L.undoEntry(both,fa,'buy:other').patch,null,'a different purchase in that field is never cleared');
 assert.notEqual(L.entryField('buy:A'),L.entryField('buy:B'));
 assert.match(L.entryField('buy:'+'x'.repeat(70)),/^tp[0-9a-z]{1,13}$/);
});
test('consumption between purchases is walked in date order; the walk never goes below zero',()=>{
 const t=L.startTrack({units:12,perDay:6,pieceUnit:'枚',today:day(-4),now:Date.parse(day(-4)+'T03:00:00Z')}).track;
 let x={id:9,name:'おしりふき',unit:'枚',qty:0,track:t};
 // 12 lasts 2 days; on day -1 (3 days later) stock had run out before buying 30.
 const p=L.purchaseEntry(x,30,{today:day(-1),now:Date.parse(day(-1)+'T03:00:00Z'),key:'k1'});x={...x,[p.field]:p.entry};
 assert.equal(L.estimate(x,T).remaining,24,'0 then +30 on day -1, minus 6 for one day');
});
test('a correction counts the purchases it saw; a family purchase it did not see asks instead of guessing',()=>{
 let x=buy(diaper({qty:2,track:base120()}),'buy:A');                // A bought: 180
 // B corrects later having seen A's purchase: base 100, A's purchase is inside it.
 const seenFix=L.correct(x.track,'still',{today:T,remaining:100,now:NOW+5000,seen:L.seenKeys(x)});
 assert.equal(L.estimate({...x,track:seenFix.track},T).remaining,100);
 // C corrects at the same time WITHOUT having received A's purchase yet (offline): it must not
 // silently drop or double it.
 const blind=L.correct(base120(),'still',{today:T,remaining:100,now:NOW+5000,seen:[]});
 assert.deepEqual(L.estimate({...x,track:blind.track},T),{status:'unknown',reason:'purchase_overlap'});
 // A purchase after the correction is simply added.
 const later=buy({...x,track:blind.track},'buy:late',1,NOW+9000);
 assert.equal(L.estimate({...later,track:{...blind.track,seen:['buy:A']}},T).remaining,160);
 // The next correction that sees everything settles it.
 const fixed=L.correct(blind.track,'still',{today:T,remaining:90,now:NOW+20000,seen:L.seenKeys(later)});
 assert.equal(L.estimate({...later,track:fixed.track},T).remaining,90);
 // Undo of a purchase that a correction already counted asks to check (the base cannot be split).
 const counted={...x,track:seenFix.track};
 const u=L.undoEntry(counted,L.entryField('buy:A'),'buy:A');
 assert.equal(u.patch.track.check,'purchase_undo');
 assert.deepEqual(L.estimate({...counted,...u.patch,[L.entryField('buy:A')]:undefined},T),{status:'unknown',reason:'purchase_undo'});
});
test('unknown unit, unit change and size change are never added by guess',()=>{
 const noPack={v:1,base:30,since:T,perDay:6,perPack:null,refillDays:5,pieceUnit:'枚',size:null,snoozeUntil:null,confirmedAt:T,t:NOW-1000,seen:[]};
 const a=buy(diaper({track:noPack}),'buy:u');
 assert.equal(a[L.entryField('buy:u')].u,null);
 assert.deepEqual(L.estimate(a,T),{status:'unknown',reason:'purchase_unit'});
 // A purchase recorded in 個 against an estimate in 枚 (the unit changed in between).
 const t=base120(),x={...diaper({track:t}),[L.entryField('k')]:{v:1,k:'k',q:1,unit:'個',u:5,d:T,t:NOW,pu:'個',sz:null}};
 assert.deepEqual(L.estimate(x,T),{status:'unknown',reason:'purchase_unit'});
 // Bought as size M while the estimate is for L.
 const sized={...diaper({size:'L',track:{...t,size:'L'}}),[L.entryField('s')]:{v:1,k:'s',q:1,unit:'袋',u:60,d:T,t:NOW,pu:'枚',sz:'M'}};
 assert.deepEqual(L.estimate(sized,T),{status:'unknown',reason:'purchase_unit'});
 // Corrupt purchase fields are ignored, never thrown.
 const odd={...diaper({track:t}),tpbad:{v:1,k:5},tpx:'junk',tpy:null,[L.entryField('z')]:{v:1,k:'z',u:-1,d:T,t:NOW}};
 assert.equal(L.estimate(odd,T).remaining,120);
 assert.equal(L.purchaseEntry(diaper(),1,{today:T,key:'k'}),null,'no estimate: nothing stored');
});
test('old tracks (no observation time or seen list) and old clients keep working',()=>{
 const old={v:1,base:60,since:T,perDay:6,perPack:60,refillDays:5,size:null,snoozeUntil:null,confirmedAt:T,applied:['x']};
 const x=buy(diaper({track:old}),'buy:o');
 assert.equal(L.estimate(x,T).remaining,120,'a purchase on the base day counts');
 // An old client rewrites the track (without t/seen) after the purchase field exists: the purchase
 // stays visible because the old track's time is the start of its base day.
 assert.equal(L.estimate({...x,track:{...old,base:60}},T).remaining,120);
 // Ancient purchases before the observation are history and may be cleared.
 const ancient={...x,[L.entryField('a')]:{v:1,k:'a',q:1,unit:'袋',u:60,d:day(-60),t:Date.parse(day(-60)+'T03:00:00Z'),pu:'枚',sz:null}};
 assert.equal(L.estimate(ancient,T).remaining,120);
 assert.deepEqual(L.staleEntries(ancient),[L.entryField('a')]);
});
test('undo on screen (polish): clears exactly the purchase field; asks only if a correction counted it',()=>{
 const {inverseCounters}=require('../atokore-live-v125/polish-v44.js');
 const start=diaper({qty:2,track:base120()}),a=buy(start,'buy:A'),both=merge(a,buy(start,'buy:B'));
 const f=L.entryField('buy:A');
 const change={key:'items',id:1,name:'パンパース テープ M',unit:'袋',delta:1,usage:0,entries:[{field:f,k:'buy:A'}]};
 const out=inverseCounters({items:[{...both,qty:4}],buys:[],routines:[]},[change]).items[0];
 assert.equal(out.qty,3);assert.equal(f in out,false);assert.equal(L.estimate(out,T).remaining,180);
 const counted={...both,qty:4,track:L.correct(both.track,'still',{today:T,remaining:200,now:NOW+1,seen:L.seenKeys(both)}).track};
 const out2=inverseCounters({items:[counted],buys:[],routines:[]},[change]).items[0];
 assert.equal(out2.track.check,'purchase_undo');
 // A purchase that was not stored as a field (no estimate) undoes like before.
 const plain=inverseCounters({items:[diaper({qty:2})],buys:[],routines:[]},[{...change,entries:undefined}]).items[0];
 assert.equal(plain.qty,1);
});
