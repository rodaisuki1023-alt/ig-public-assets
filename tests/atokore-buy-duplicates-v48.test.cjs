// Shopping rows that may be the same product (v48.2). Notice only: nothing is merged, removed or changed.
const test = require('node:test');
const assert = require('node:assert/strict');
const { findDuplicateGroups, noticeText } = require('../atokore-live-v125/buy-duplicates-v48.js');

const row = (id, name, unit, cat, qty = 1) => ({ id, name, unit, cat, qty });

test('no duplicates: nothing to show', () => {
  assert.deepEqual(findDuplicateGroups([row(1, '牛乳', '本', '食料品'), row(2, '卵', 'パック', '食料品')]), []);
  assert.deepEqual(findDuplicateGroups([]), []);
  assert.deepEqual(findDuplicateGroups(null), []);
});

test('same name, unit and category (two people added it at once): certain', () => {
  const groups = findDuplicateGroups([row(1, '牛乳', '本', '食料品'), row(2, '牛乳', '本', '食料品', 2), row(3, '卵', 'パック', '食料品')]);
  assert.deepEqual(groups, [{ name: '牛乳', unit: '本', ids: ['1', '2'], certain: true }]);
  assert.match(noticeText(groups), /^同じ名前・単位の商品が複数あります：牛乳（2行）。/);
  assert.match(noticeText(groups), /数量や行は自動で変更しません/);
});

test('size written in the name differs: different products', () => {
  assert.deepEqual(findDuplicateGroups([
    row(1, 'パンパース さらさらケア テープ M', '袋', 'ベビー'),
    row(2, 'パンパース さらさらケア テープ L', '袋', 'ベビー'),
  ]), []);
});

test('unit differs: different products', () => {
  assert.deepEqual(findDuplicateGroups([row(1, 'おしりふき', 'パック', 'ベビー'), row(2, 'おしりふき', '個', 'ベビー')]), []);
});

test('category differs: never called the same product', () => {
  assert.deepEqual(findDuplicateGroups([row(1, 'ミルク', '本', '食料品'), row(2, 'ミルク', '本', 'ベビー')]), []);
});

test('a row without a category: only "重複の可能性", never certain', () => {
  const groups = findDuplicateGroups([row(1, '牛乳', '本', '食料品'), row(2, '牛乳', '本', '')]);
  assert.deepEqual(groups, [{ name: '牛乳', unit: '本', ids: ['1', '2'], certain: false }]);
  assert.match(noticeText(groups), /^重複の可能性があります（カテゴリーが未設定の行があり、同じ商品か判断できません）：牛乳（2行）。/);
  assert.doesNotMatch(noticeText(groups), /同じ名前・単位の商品が複数あります/);
});

test('mixed: two rows of one category are certain, an uncategorized row only makes it "possible"', () => {
  const groups = findDuplicateGroups([row(1, 'ミルク', '本', 'ベビー'), row(2, 'ミルク', '本', 'ベビー'), row(3, 'ミルク', '本', '食料品'), row(4, 'ミルク', '本')]);
  assert.deepEqual(groups, [
    { name: 'ミルク', unit: '本', ids: ['1', '2', '3', '4'], certain: false },
    { name: 'ミルク', unit: '本', ids: ['1', '2'], certain: true },
  ]);
});

test('spacing and full-width differences are the same name; a missing unit is 個 like the app', () => {
  const groups = findDuplicateGroups([row(1, 'Ｒｉｃｏ　おしりふき', undefined, 'ベビー'), row(2, 'Rico  おしりふき ', '個', 'ベビー')]);
  assert.deepEqual(groups, [{ name: 'Rico おしりふき', unit: '個', ids: ['1', '2'], certain: true }]);
});

test('the list itself is never changed', () => {
  const list = [row(1, '牛乳', '本', '食料品', 1), row(2, '牛乳', '本', '食料品', 3)];
  const before = JSON.stringify(list);
  findDuplicateGroups(list);
  assert.equal(JSON.stringify(list), before);
});
