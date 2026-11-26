const test=require('node:test'),assert=require('node:assert/strict');
const E=require('../atokore-live-v125/entitlements-v51.js');
const now=Date.parse('2026-11-25T00:00:00Z');
test('doubtful answers are the free plan, never paid',()=>{
 for(const x of [null,undefined,'premium',{},{plan:'gold'},{plan:'premium',premium_until:'2026-01-01T00:00:00Z'},{plan:'premium',premium_until:'not a date'}])
  assert.equal(E.fromServer(x,now).plan,'free',JSON.stringify(x));
 const p=E.fromServer({plan:'premium',premium_until:null,limits:{seats:6,server_receipt_reads:30},seats_used:2},now);
 assert.deepEqual([p.plan,p.cloudPhotos,p.seats,p.seatsUsed],['premium',20,6,2]);
 assert.equal(E.fromServer({plan:'free',limits:{seats:99}},now).seats,2,'out-of-range seat limit ignored');
});
test('free features stay free for everyone; unavailable paid features can never be used or bought',()=>{
 const free=E.fromServer(null,now),prem=E.fromServer({plan:'premium'},now);
 for(const f of ['stockLevels','stockEstimate','prepSets','familyShare','cloudPhotos','manualBackup']){assert.equal(E.canUse(f,free),true);assert.equal(E.label(f),'無料')}
 for(const f of ['morePhotos','refillNotice','autoPrep','autoBackup']){assert.equal(E.canUse(f,prem),false);assert.equal(E.label(f),'有料プラン（検討中・未提供）')}
 assert.equal(E.canUse('unknown',prem),false);
});
test('photo slots follow the plan and unknown counts stay unknown',()=>{
 assert.equal(E.photoSlotsLeft(E.fromServer(null,now),3),2);
 assert.equal(E.photoSlotsLeft(E.fromServer({plan:'premium'},now),25),0);
 assert.equal(E.photoSlotsLeft(E.fromServer(null,now),undefined),null);
});
test('photo counter: device-only vs shared, replace uses no slot, above the limit nothing is deleted',()=>{
 const E=require('../atokore-live-v125/entitlements-v51.js');
 assert.match(E.photoCounter({}).text,/この端末だけ/);
 assert.equal(E.photoCounter({}).tone,'local');
 assert.match(E.photoCounter({joined:true,sharing:false}).text,/止まっています/);
 const free=E.fromServer({plan:'free'}),paid=E.fromServer({plan:'premium'});
 assert.equal(E.photoCounter({joined:true,sharing:true,used:3,ent:free}).text,'共有写真 3/5枚・無料プラン。あと2枚共有できます。');
 assert.equal(E.photoCounter({joined:true,sharing:true,used:5,ent:free}).tone,'full');
 assert.match(E.photoCounter({joined:true,sharing:true,used:5,ent:free,hasShared:true}).text,/差し替えは、枠を増やしません/);
 const over=E.photoCounter({joined:true,sharing:true,used:12,ent:E.fromServer({plan:'premium',premium_until:'2000-01-01'})});
 assert.equal(over.tone,'over');assert.match(over.text,/12\/5枚.*今ある写真は消えません/);
 assert.match(E.photoCounter({joined:true,sharing:true,used:3,ent:paid}).text,/3\/20枚・有料プラン/);
 assert.match(E.photoCounter({joined:true,sharing:true,used:3}).text,/プランは確認中/,'no server answer yet');
 assert.equal(E.photoCounter({joined:true,sharing:true,used:null}).tone,'unknown','unknown is not 0');
});
