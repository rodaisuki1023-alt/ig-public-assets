const test = require('node:test');
const assert = require('node:assert/strict');
require('../atokore-live-v125/stability.js');
const Core = globalThis.__atokoreCoreV125H;
const diaper = (extra = {}) => ({ id: 1, name: 'パンパース さらさらケア おむつ パンツ M', qty: 2, unit: '袋', cat: 'ベビー', ...extra });

test('editing an M diaper to L after adding it to shopping never restocks L with M', () => {
  const stock = [diaper()];
  const buys = [];
  Core.addStockToBuy(buys, stock[0]);
  stock[0].name = 'パンパース さらさらケア おむつ パンツ L';
  Core.purchase(stock, buys, [buys[0].id]);
  assert.equal(stock[0].qty, 2);
  assert.equal(stock.find(x => x.name === diaper().name).qty, 1);
});

test('adding edited stock does not combine different diaper sizes under the old shopping name', () => {
  const buys = [];
  Core.addStockToBuy(buys, diaper());
  Core.addStockToBuy(buys, diaper({ name: 'パンパース さらさらケア おむつ パンツ L' }));
  assert.equal(buys.length, 2);
  assert.deepEqual(buys.map(x => x.qty), [1, 1]);
});

test('stale links also respect formula form, series, brand, unit and known category', () => {
  const original = { id: 5, name: '明治 ほほえみ 粉ミルク 缶', qty: 4, cat: 'ベビー', unit: '缶' };
  for (const changed of [
    { name: '明治 ほほえみ 液体ミルク 液体', unit: '本' },
    { name: '明治 ステップ 粉ミルク 缶' },
    { name: '森永 はぐくみ 粉ミルク 缶' },
    { unit: '箱' },
    { cat: 'その他' },
  ]) {
    const stock = [{ ...original, ...changed }];
    const buys = [];
    Core.addStockToBuy(buys, original);
    Core.purchase(stock, buys, [buys[0].id]);
    assert.equal(stock[0].qty, 4, JSON.stringify(changed));
    assert.equal(stock[1].qty, 1);
  }
});

test('a stale link finds the correct existing product instead of adding a duplicate', () => {
  const stock = [diaper({ name: 'パンパース おむつ パンツ L' }), diaper({ id: 2 })];
  Core.purchase(stock, [{ id: 8, stockId: 1, name: diaper().name, unit: '袋', cat: 'ベビー', qty: 3 }], [8]);
  assert.equal(stock.length, 2);
  assert.deepEqual(stock.map(x => x.qty), [2, 5]);
});

test('legacy shopping entries without category and repeated replenishment still work', () => {
  const stock = [diaper()];
  const buys = [{ id: 8, stockId: 1, name: diaper().name, unit: '袋', qty: 1 }];
  Core.addStockToBuy(buys, stock[0], 2);
  assert.equal(buys.length, 1);
  Core.purchase(stock, buys, [8]);
  assert.equal(stock.length, 1);
  assert.equal(stock[0].qty, 5);
});
