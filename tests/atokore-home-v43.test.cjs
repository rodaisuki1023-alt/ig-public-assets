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
 assert.ok(entries.some(x=>x.title==='パパ：2商品をストックに追加'&&x.detail==='牛乳、卵'));
 // W2: an unknown actor is never guessed.
 assert.equal(home.sharedEntries([{at,who:null,kind:'stock',type:'delete',name:'牛乳'}])[0].title,'実行者不明：牛乳をストックから削除');
 assert.equal(home.sharedEntries([{at:'bad'}]).length,0);
 assert.doesNotMatch(JSON.stringify(entries),/NaN|undefined/);
});

test('local history stays anonymous to family members and preserves long and hostile text as data',()=>{
 const rows=[{ts:10,title:'在庫数を変更',detail:'<img src=x onerror=alert(1)> 2→1'},{ts:20,title:'在庫数を変更',detail:'<img src=x onerror=alert(1)> 2→1'}];
 const entries=home.localEntries(rows);assert.equal(entries.length,2);assert.equal(entries[0].who,'この端末');assert.equal(entries[0].at,20);
 assert.equal(entries[0].detail,rows[0].detail);
});

test('W2: local entries read "who: product + verb" / change; before sharing is labelled; no guessed arrows',()=>{
 const rows=[{ts:30,title:'在庫数を変更',detail:'牛乳 1本 → 2本',refs:[{id:1,kind:'item',name:'牛乳',unit:'本'}],change:'1本 → 2本'},
  {ts:20,title:'買い物を削除',detail:'卵、パンを削除',refs:[{id:5,kind:'buy',name:'卵'},{id:6,kind:'buy',name:'パン'}],change:'買い物リストから削除'},
  {ts:10,title:'在庫数を変更',detail:'牛乳 2本 → 1本'}];
 const solo=home.localEntries(rows);
 assert.deepEqual(solo.map(x=>x.title),['この端末：牛乳の在庫数を変更','この端末：卵 ほか1商品を買い物リストから削除','この端末：在庫数を変更']);
 assert.equal(solo[0].detail,'1本 → 2本','the change does not repeat the name');
 assert.equal(solo[2].detail,'牛乳 2本 → 1本','older entries are shown as recorded');
 const shared=home.localEntries(rows,{joined:true,sharedSince:25});
 assert.equal(shared[0].who,'この端末');assert.equal(shared[1].who,'この端末・共有前の記録');
 // A shared row without a recorded before/after shows only the recorded delta.
 const row=home.sharedEntries([{at:'2026-10-25T10:00:00Z',who:'ママ',kind:'item',type:'add',name:'牛乳',unit:'本',delta:-1}])[0];
 assert.equal(row.detail,'数量 -1本');assert.doesNotMatch(row.detail,/→/);
});
