// Typed shopping entries (stability.js Core): quantity in the text, and the unit of the same name.
const test=require('node:test');const assert=require('node:assert/strict');
require('../atokore-live-v125/stability.js');
const Core=globalThis.__atokoreCoreV125H;

test('a trailing quantity is read; everything else stays the name',()=>{
  const p=t=>Core.parseTyped(t);
  assert.deepEqual(p('トマト 3'),{name:'トマト',qty:3,unit:null});
  assert.deepEqual(p('トマト　３'),{name:'トマト',qty:3,unit:null});
  assert.deepEqual(p('トマト×3'),{name:'トマト',qty:3,unit:null});
  assert.deepEqual(p('トマト x 2'),{name:'トマト',qty:2,unit:null});
  assert.deepEqual(p('卵 10個'),{name:'卵',qty:10,unit:'個'});
  assert.deepEqual(p('牛乳2本'),{name:'牛乳',qty:2,unit:'本'});
  assert.deepEqual(p('おむつ テープ M 2'),{name:'おむつ テープ M',qty:2,unit:null});
  assert.deepEqual(p('りんご 2つ'),{name:'りんご',qty:2,unit:'個'});
  // Not quantities: part of the product name, a volume, a size or a number in the middle.
  for(const t of ['単3電池','水 2L','6枚切り食パン','おしりふき 3個パック','ほほえみ 800g','iPhone15','トマト 0','トマト 100','3'])
    assert.equal(p(t).qty,1,t),assert.equal(p(t).name,t.trim(),t);
  assert.equal(p('  牛乳  ').name,'牛乳');
  assert.equal(p('').name,'');
});

test('the unit follows the same name on the list, then in stock, then the guess',()=>{
  const guess=n=>n==='牛乳'?'パック':'個';
  const stock=[{id:1,name:'牛乳',unit:'本',cat:'食料品',qty:0},{id:2,name:'卵',unit:'個',cat:'食料品'}];
  // Stock 牛乳 is counted in 本: typed 牛乳 joins it (and "買った" adds to that row), not a new パック row.
  assert.deepEqual(Core.typedBuy([],stock,{name:'牛乳',qty:1,unit:null},guess),{name:'牛乳',qty:1,unit:'本',cat:'食料品'});
  // Already on the list: that row's unit wins.
  assert.equal(Core.typedBuy([{id:9,name:'牛乳',unit:'パック'}],stock,{name:'牛乳',qty:2,unit:null},guess).unit,'パック');
  // Explicit unit in the text wins; then the stock row with another unit is not this product.
  assert.deepEqual(Core.typedBuy([],stock,{name:'牛乳',qty:2,unit:'パック'},guess),{name:'牛乳',qty:2,unit:'パック',cat:''});
  // Unknown name: the usual guess, no category.
  assert.deepEqual(Core.typedBuy([],stock,{name:'トマト',qty:3,unit:null},guess),{name:'トマト',qty:3,unit:'個',cat:''});
  // Same name in two units in stock: ambiguous -> the guess, as before.
  assert.equal(Core.typedBuy([],[...stock,{id:3,name:'牛乳',unit:'パック',cat:'食料品'}],{name:'牛乳',qty:1,unit:null},()=> 'L').unit,'L');
});

test('a typed item bought from the list adds to the stock row of the same name',()=>{
  const stock=[{id:1,name:'牛乳',unit:'本',cat:'食料品',qty:1}];
  const t=Core.typedBuy([],stock,Core.parseTyped('牛乳 2'),()=> 'パック');
  const list=[{id:50,...t}];
  const r=Core.purchase(stock,list,[50]);
  assert.equal(r.count,1);assert.equal(stock.length,1,'no second 牛乳 row');assert.equal(stock[0].qty,3);
});
