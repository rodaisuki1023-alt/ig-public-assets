const test=require('node:test');const assert=require('node:assert/strict');
const dates=require('../atokore-live-v125/common-v45.js');const {forecast,valuation}=require('../atokore-live-v125/insights-v45.js');
test('calendar expiry boundaries ignore time of day and reject invalid dates',()=>{
 for(const h of [0,12,23]){const now=new Date(2026,9,24,h,59);assert.equal(dates.remaining('2026-10-26',now),2);assert.equal(dates.remaining('2026-10-24',now),0);assert.equal(dates.remaining('2026-10-23',now),-1);assert.equal(dates.label('2026-10-26',now),'あと2日（10/26まで）')}
 assert.equal(dates.remaining('2026-02-30'),null);assert.equal(dates.remaining(''),null);assert.equal(dates.remaining('garbage'),null);
 assert.equal(dates.remaining('2027-01-01',new Date(2026,11,31,23)),1);
});
test('empty stock is always first, with explicit stock and reorder evidence',()=>{
 assert.equal(forecast({qty:0,usage:0}).priority,0);assert.equal(forecast({qty:1,minQty:2}).priority,1);assert.equal(forecast({qty:4,minQty:2}).priority,2);assert.equal(forecast({qty:3,minQty:0}).min,0);
});
test('price breakdown uses zero stock as zero and identifies old total-only records',()=>{
 assert.equal(valuation({qty:0,price:198}).value,0);assert.equal(valuation({qty:2,price:198}).value,396);assert.equal(valuation({qty:2,price:0}).value,0);assert.match(valuation({qty:2,purchaseTotal:396}).basis,/残量に連動しない/);assert.equal(valuation({qty:2,price:-1}).value,0);
});
