const assert = require('node:assert/strict');
const path = require('node:path');

delete global.document;
require(path.join(__dirname, '..', 'atokore-live-v125', 'stability.js'));

const Core = global.__atokoreCoreV125H;
assert.ok(Core, '統合操作コアが読み込めること');

{
  const buys = [];
  const milk = { id: 1, name: '牛乳', qty: 2, unit: '本', cat: '食料品' };
  assert.equal(Core.addStockToBuy(buys, milk, 1), true);
  assert.equal(buys.length, 1);
  assert.equal(buys[0].qty, 1);
  assert.equal(buys[0].stockId, 1);
  Core.addStockToBuy(buys, milk, 2);
  assert.equal(buys.length, 1, '同じ在庫は買い物リストで重複させないこと');
  assert.equal(buys[0].qty, 3);
}

{
  const list = [{ id: 1 }, { id: 2 }, { id: 3 }];
  assert.deepEqual(Core.removeByIds(list, ['1', 3]), [{ id: 2 }]);
}

{
  const stock = [{ id: 10, name: '卵', qty: 4, unit: '個', cat: '食料品' }];
  const buys = [
    { id: 20, stockId: 10, name: '卵', qty: 6, unit: '個' },
    { id: 21, name: 'ティッシュ', qty: 2, unit: '箱', cat: '日用品' },
    { id: 22, name: '対象外', qty: 1, unit: '個' },
  ];
  const result = Core.purchase(stock, buys, [20, 21], () => 'その他');
  assert.equal(result.count, 2);
  assert.deepEqual(result.remaining.map(item => item.id), [22]);
  assert.equal(stock.find(item => item.id === 10).qty, 10, '既存在庫へ数量を加算すること');
  const tissue = stock.find(item => item.name === 'ティッシュ');
  assert.ok(tissue, '未登録商品は在庫へ新規追加すること');
  assert.equal(tissue.qty, 2);
  assert.equal(tissue.cat, '日用品');
}

{
  const item={id:81,name:'手作りスープ',qty:1,unit:'個',cat:'離乳食',babyFoodMonth:16};
  const buys=[];Core.addStockToBuy(buys,item);assert.equal(buys[0].babyFoodMonth,16);
  const stock=[];Core.purchase(stock,buys,[buys[0].id]);assert.equal(stock[0].babyFoodMonth,16);
  const existing={...item,id:82,babyFoodMonth:8};Core.purchase([existing],buys,[buys[0].id]);assert.equal(existing.babyFoodMonth,8);
  const noAge=[];Core.addStockToBuy(noAge,{id:83,name:'不明',unit:'個',cat:'離乳食'});assert.equal('babyFoodMonth' in noAge[0],false);
}
console.log('Atokore action core: all tests passed');
