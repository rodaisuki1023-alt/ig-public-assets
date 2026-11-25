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
