const test=require('node:test');
const assert=require('node:assert/strict');
const {foodMonth,foodMonthLabel}=require('../atokore-live-v125/polish-v44.js');
test('month parsing accepts common spellings, years and ranges',()=>{
 for(const x of ['5ヶ月頃から','５か月','5カ月','5箇月'])assert.equal(foodMonth(x),5,x);
 assert.equal(foodMonth('1歳4か月頃から'),16);
 assert.equal(foodMonth('1歳半'),18);
 assert.equal(foodMonth('5〜7ヶ月'),5);
});
test('unlabelled or ambiguous ages remain unknown',()=>{
 for(const x of ['手作りスープ','5ヶ月 7ヶ月 セット','おやつ 99ヶ月'])assert.equal(foodMonth(x),null,x);
 assert.equal(foodMonthLabel(null),'月齢未設定');
 assert.equal(foodMonthLabel(16),'1歳4か月頃から');
});
