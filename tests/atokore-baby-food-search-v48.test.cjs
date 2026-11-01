// The add screen's 離乳食 name search uses the same month-age search as the stock screen (search-v48.js).
// Before v48.2 it was a plain substring search: 「7ヶ月」 found nothing (the catalog writes か月/ヵ月/カ月) and
// 「2か月」 found every 12か月 product.
const test = require('node:test');
const assert = require('node:assert/strict');

global.window = global;
require('../atokore-live-v125/search-v48.js');
require('../atokore-live-v125/baby-food-catalog-v35.js');
const food = global.AtokoreBabyFood;
const ages = (maker, query) => [...new Set(food.find({ maker, query, ended: true }).map(p => p.age))].sort();

test('every spelling of a month age finds the same products, across makers that spell it differently', () => {
  const expected = food.find({ query: '7か月', ended: true }).map(p => p.id).sort();
  assert.ok(expected.length > 0);
  for (const q of ['7ヶ月', '７カ月', '7ヵ月', '7ケ月', '7箇月', '7ヶ']) {
    assert.deepEqual(food.find({ query: q, ended: true }).map(p => p.id).sort(), expected, q);
  }
  assert.deepEqual(ages(undefined, '7ヶ月'), ['7か月頃から', '7ヵ月頃~']);
});

test('the digit boundary holds: 2か月 does not find 12か月, 7ヶ月 does not find 17', () => {
  assert.deepEqual(food.find({ query: '2か月', ended: true }), []);
  assert.ok(ages('wakodo', '12ヶ月').every(a => a.startsWith('12')));
  assert.ok(ages(undefined, '7ヶ月').every(a => !/17/.test(a)));
});

test('a month inside a range on the package is found (7、8ヵ月頃から)', () => {
  assert.deepEqual(ages('kewpie', '8か月'), ['7、8ヵ月頃から']);
});

test('plain words and the maker/series filters still work', () => {
  assert.ok(food.find({ query: 'おかゆ', ended: true }).length > 0);
  assert.ok(food.find({ maker: 'wakodo', query: '7か月' }).every(p => p.maker.includes('和光堂')));
});
