// v51 free SEO tools (draft): arithmetic only on the visitor's own numbers.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path');
const T=require('../atokore-tools-v51/tools-calc-v51.js');
test('days left from bags, per bag, loose sheets and daily use',()=>{
 assert.deepEqual(T.daysLeft({bags:2,perBag:60,loose:10,perDay:6}),{total:130,days:21});
 assert.equal(T.daysLeft({bags:0,perBag:60,loose:5,perDay:6}).days,0);
 for(const bad of [{bags:-1,perBag:60,perDay:6},{bags:1.5,perBag:60,perDay:6},{bags:1,perBag:0,perDay:6},{bags:1,perBag:60,perDay:0},{bags:1,perBag:60,perDay:''},{bags:'',perBag:60,perDay:6}])
  assert.ok(T.daysLeft(bad).error,JSON.stringify(bad));
});
test('monthly use rounds sheets and bags up; month length 28-31',()=>{
 assert.deepEqual(T.monthly({perDay:6,perBag:60,days:30}),{sheets:180,bags:3,days:30});
 assert.deepEqual(T.monthly({perDay:5.5,perBag:54,days:31}),{sheets:171,bags:4,days:31});
 assert.ok(T.monthly({perDay:6,perBag:60,days:40}).error);
});
test('run-out date and invalid input',()=>{
 assert.equal(T.runOutDate('2026-11-25',21),'2026-12-16');
 assert.equal(T.runOutDate('2026-02-30',1),null);assert.equal(T.runOutDate('2026-11-25',-1),null);
});
test('draft page stays out of search, sends nothing and makes no unsupported claims',()=>{
 const html=fs.readFileSync(path.join(__dirname,'../atokore-tools-v51/index.html'),'utf8');
 assert.match(html,/<meta name="robots" content="noindex,nofollow">/);
 assert.doesNotMatch(html,/fetch\(|XMLHttpRequest|sendBeacon|<script src="https?:/);
 assert.doesNotMatch(html,/新生児は|平均\d+枚|必ず|No\.?1|日本一/);
 assert.match(html,/持ち物は園によって違います/);
});
test('powdered milk days from the visitor\'s own can size and feeds',()=>{
 assert.deepEqual(T.milkDays({canGrams:800,cans:1,perFeedGrams:14,feedsPerDay:6}),{perDay:84,days:9,total:800});
 assert.equal(T.milkDays({canGrams:800,cans:2,perFeedGrams:14,feedsPerDay:6}).days,19);
 for(const bad of [{canGrams:0,perFeedGrams:14,feedsPerDay:6},{canGrams:800,perFeedGrams:0,feedsPerDay:6},{canGrams:800,perFeedGrams:14,feedsPerDay:1.5},{canGrams:800,cans:0,perFeedGrams:14,feedsPerDay:6}])
  assert.ok(T.milkDays(bad).error,JSON.stringify(bad));
});
