// v51 unit suggestion from product names (Muse E3): brand-only names, cans, boxes, bags.
const test=require('node:test'),assert=require('node:assert/strict');
const U=require('../atokore-live-v125/units-v51.js');
test('baby products get the unit they are bought in, even from a brand name alone',()=>{
 for(const [name,unit] of [['パンパース',  '袋'],['メリーズ テープ M','袋'],['ムーニーマン L','袋'],['おむつ','袋'],['グーン パンツ BIG','袋'],
  ['おしりふき','パック'],['ほほえみ','缶'],['明治ほほえみ らくらくキューブ','箱'],['はいはい スティック','箱'],['ほほえみ らくらくミルク','本'],
  ['液体ミルク','本'],['粉ミルク','缶'],['すこやかM1','缶'],['E赤ちゃん','缶'],['ぐんぐん','缶']])
  assert.equal(U.unitFor(name),unit,name);
});
test('ordinary food and dairy are left to the existing rule',()=>{
 for(const name of ['牛乳','豆乳','ミルクティー','ミルクパン','ミルクレープ','卵','食パン','','ステップ台'])assert.equal(U.unitFor(name),null,name);
 assert.equal(U.unitFor(null),null);
});
test('pieces inside bags: diapers and wipes are counted in 枚; others are not guessed',()=>{
 assert.equal(U.pieceFor('パンパース','袋'),'枚');assert.equal(U.pieceFor('おしりふき','パック'),'枚');
 assert.equal(U.pieceFor('ほほえみ','缶'),null);assert.equal(U.pieceFor('パンパース','個'),null);
});
test('the estimate counts a brand-only diaper bag in 枚',()=>{
 global.AtokoreUnits=U;
 const L=require('../atokore-live-v125/stock-levels-v51.js');
 assert.deepEqual(L.units({name:'メリーズ',unit:'袋'}),{unit:'袋',container:true,piece:'枚'});
 assert.deepEqual(L.units({name:'ほほえみ',unit:'缶'}),{unit:'缶',container:false,piece:'缶'});
});
