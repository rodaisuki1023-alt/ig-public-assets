// W2 item 8: quantity limits by unit (existing larger quantities kept) and stock sort orders.
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../atokore-live-v125/stock-rules-v48.js');

test('limits by unit; other units keep the screen fallback', () => {
  for (const u of ['個', '袋', '缶', '箱', '本', 'パック']) assert.equal(R.limit(u), 999);
  assert.equal(R.limit('枚'), 9999);
  assert.equal(R.limit('g'), 99999); assert.equal(R.limit('mL'), 99999); assert.equal(R.limit('ml'), 99999);
  assert.equal(R.limit('セット', 999), 999); assert.equal(R.limit('kg'), null);
  assert.equal(R.canIncrease(998, '個'), true); assert.equal(R.canIncrease(999, '個'), false);
  assert.equal(R.canIncrease(9999, '枚'), false); assert.equal(R.canIncrease(99900, 'g', 100), false); assert.equal(R.canIncrease(99899, 'g', 100), true);
  assert.equal(R.limitMessage('個'), '数量の上限は999個です');
  assert.equal(R.limitMessage('枚'), '数量の上限は9,999枚です');
});

test('edits: within the limit pass; a kept larger quantity may stay or go down, never up', () => {
  assert.equal(R.checkEdit(999, { unit: '個', before: 3, beforeUnit: '個' }), null);
  assert.match(R.checkEdit(1000, { unit: '個', before: 3, beforeUnit: '個' }), /0〜999の整数/);
  assert.equal(R.checkEdit(1500, { unit: '個', before: 1500, beforeUnit: '個' }), null); // unchanged
  assert.equal(R.checkEdit(1200, { unit: '個', before: 1500, beforeUnit: '個' }), null); // reduced
  assert.match(R.checkEdit(1600, { unit: '個', before: 1500, beforeUnit: '個' }), /1,500個）は上限の999個を超えています/);
  assert.match(R.checkEdit(5000, { unit: '個', before: 5000, beforeUnit: 'g' }), /0〜999/); // unit change makes a new over-limit value
  assert.equal(R.checkEdit(99999, { unit: 'g', before: 1, beforeUnit: 'g' }), null);
  assert.match(R.checkEdit(-1, { unit: '個', before: 1 }), /0〜999/);
  assert.match(R.checkEdit(1.5, { unit: '個', before: 1 }), /整数/);
  assert.equal(R.inputMax('個', 1500), 1500); assert.equal(R.inputMax('個', 3), 999); assert.equal(R.inputMax('kg', 3), 99999);
});

const list = [
  { id: 1, name: '牛乳', cat: '食料品', qty: 1, unit: '本', exp: '2026-10-27' },
  { id: 2, name: 'おしりふき', cat: 'ベビー', qty: 5, unit: 'パック', exp: '' },
  { id: 3, name: 'ヨーグルト', cat: '食料品', qty: 0, unit: '個', minQty: 2, exp: '2026-10-25' },
  { id: 4, name: '卵', cat: '食料品', qty: 6, unit: '個', exp: '2026-10-20' },
  { id: 5, name: 'BOXティッシュ', cat: '日用品', qty: 2, unit: '箱', minQty: 2, exp: '' },
  { id: 6, name: 'おむつ', cat: 'ベビー', qty: 1, unit: '袋', exp: '' },
];
const names = rows => rows.map(x => x.name);
const today = new Date(2026, 9, 25);

test('default: category order, then product name', () => {
  // Names compare with the Japanese collation: kana by 50音; kanji by code order (readings are not known).
  assert.deepEqual(names(R.sortItems(list, 'category')), ['おしりふき', 'おむつ', 'ヨーグルト', '牛乳', '卵', 'BOXティッシュ']);
  assert.deepEqual(R.SORTS.map(x => x[1]), ['カテゴリー別', '追加した順（新しい順）', '期限が近い順', '補充が必要な順']);
  assert.equal(R.sortLabel('nope'), 'カテゴリー別');
});

test('expiry: overdue, today, nearer dates, then no expiry, across categories', () => {
  assert.deepEqual(names(R.sortItems(list, 'expiry', { today })), ['卵', 'ヨーグルト', '牛乳', 'おしりふき', 'おむつ', 'BOXティッシュ']);
});

test('refill needed first (most short first), then the rest by category', () => {
  // ヨーグルト 0/2, then three at exactly their line (ties by category), then the rest by category.
  assert.deepEqual(names(R.sortItems(list, 'refill')), ['ヨーグルト', 'おむつ', '牛乳', 'BOXティッシュ', 'おしりふき', '卵']);
});

test('added: newest registered first, regardless of id size', () => {
  const mixed = [{ id: 1700000000000000, name: 'a' }, { id: 2, name: 'b' }, { id: 1700000000000, name: 'c' }];
  assert.deepEqual(names(R.sortItems(mixed, 'added')), ['c', 'b', 'a']);
  assert.deepEqual(names(R.sortItems([mixed[0], mixed[2]], 'added', { registered: mixed })), ['c', 'a']);
});
