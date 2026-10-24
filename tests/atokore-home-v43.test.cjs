const test=require('node:test');
const assert=require('node:assert/strict');
const home=require('../atokore-live-v125/home-v43.js');

test('attention uses calendar days, rejects invalid dates and puts expired items first without duplicating low stock',()=>{
 const now=new Date(2026,9,23,23,59);
 assert.equal(home.expiryDays({exp:'2026-10-25'},now),2);
 assert.equal(home.expiryDays({exp:'2026-02-30'},now),null);
 assert.equal(home.expiryDays({exp:'bad'},now),null);
 const rows=[{id:1,qty:1,exp:''},{id:2,qty:4,exp:'2026-10-25'},{id:3,qty:1,exp:'2026-10-22'},{id:4,qty:8,exp:'2026-10-30'}];
 assert.deepEqual(home.attention(rows,now).map(x=>x.item.id),[3,2,1]);
 assert.equal(home.attention([{qty:8}],now).length,0);
});

test('shared activity groups only matching server timestamps, people, operation types and destinations',()=>{
 const at='2026-10-23T12:00:00Z';
 const rows=[{at,who:'パパ',kind:'stock',type:'create',name:'牛乳'},{at,who:'パパ',kind:'stock',type:'create',name:'卵'},
  {at,who:'ママ',kind:'stock',type:'create',name:'粉ミルク'},{at,who:'パパ',kind:'buy',type:'create',name:'おしりふき'},
  {at:'2026-10-23T12:00:01Z',who:'パパ',kind:'stock',type:'add',name:'牛乳',delta:-1}];
 const entries=home.sharedEntries(rows);
 assert.equal(entries.length,4);assert.match(entries[0].detail,/−1|-1/);
 assert.ok(entries.some(x=>x.title==='パパがストックの2商品を追加'&&x.detail==='牛乳、卵'));
 assert.equal(home.sharedEntries([{at:'bad'}]).length,0);
 assert.doesNotMatch(JSON.stringify(entries),/NaN|undefined/);
});

test('local history stays anonymous to family members and preserves long and hostile text as data',()=>{
 const rows=[{ts:10,title:'在庫数を変更',detail:'<img src=x onerror=alert(1)> 2→1'},{ts:20,title:'在庫数を変更',detail:'<img src=x onerror=alert(1)> 2→1'}];
 const entries=home.localEntries(rows);assert.equal(entries.length,2);assert.equal(entries[0].who,'自分');assert.equal(entries[0].at,20);
 assert.equal(entries[0].detail,rows[0].detail);
});
