const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {
  productKey, packageKey, canMergeInventory, unitPrice, ownCatalogFields
} = require(path.join(__dirname, '..', 'atokore-live-v125', 'catalog', 'baby-catalog.js'));

const diaper = {
  category: 'diaper', brand: 'パンパース', series: 'さらさらケア',
  form: 'パンツ', size: 'M', packageQuantity: 60, packageUnit: '枚', bundleCount: 1
};
const milk = {
  category: 'milk', brand: '明治', series: 'ほほえみ', form: '粉ミルク・缶',
  stage: '0ヶ月から', packageQuantity: 800, packageUnit: 'g', bundleCount: 1
};

test('diaper product key distinguishes brand, form and size', () => {
  assert.notEqual(productKey(diaper), productKey({...diaper, brand: 'グーン'}));
  assert.notEqual(productKey(diaper), productKey({...diaper, form: 'テープ'}));
  assert.notEqual(productKey(diaper), productKey({...diaper, size: 'L'}));
  assert.equal(productKey(diaper), productKey({...diaper, size: 'ｍ', brand: ' パンパース '})); // full-width m
});

test('same diaper product may have distinct pack sizes and bundles', () => {
  assert.equal(productKey(diaper), productKey({...diaper, packageQuantity: 72}));
  assert.notEqual(packageKey(diaper), packageKey({...diaper, packageQuantity: 72}));
  assert.notEqual(packageKey(diaper), packageKey({...diaper, bundleCount: 2}));
  assert.equal(canMergeInventory(diaper, {...diaper}), true);
  assert.equal(canMergeInventory(diaper, {...diaper, packageQuantity: 72}), false);
});

test('milk form and stage are distinct; no g/mL implicit interchange', () => {
  assert.notEqual(productKey(milk), productKey({...milk, form: '液体ミルク'}));
  assert.notEqual(productKey(milk), productKey({...milk, stage: 'フォローアップ'}));
  assert.notEqual(packageKey(milk), packageKey({...milk, packageUnit: 'mL'}));
});

test('invalid and ambiguous item inputs fail closed', () => {
  assert.throws(() => productKey({...diaper, size: ''}), /size/);
  assert.throws(() => packageKey({...diaper, packageQuantity: 0}), /packageQuantity/);
  assert.throws(() => packageKey({...diaper, packageUnit: 'g'}), /invalid package unit/);
  assert.throws(() => packageKey({...diaper, bundleCount: 1.5}), /bundleCount/);
});

test('unit price requires actual shipping cost and compatible units', () => {
  assert.deepEqual(unitPrice({priceYen:3000,shippingYen:0,packageQuantity:60,bundleCount:2,packageUnit:'枚'}),
    {priceYenPerUnit:25,unitLabel:'枚',totalUnits:120});
  assert.deepEqual(unitPrice({priceYen:2000,shippingYen:0,packageQuantity:800,packageUnit:'g'}),
    {priceYenPerUnit:250,unitLabel:'100g',totalUnits:800});
  assert.equal(unitPrice({priceYen:3000,packageQuantity:60,packageUnit:'枚'}),null);
  assert.equal(unitPrice({priceYen:3000,shippingYen:0,packageQuantity:0,packageUnit:'枚'}),null);
});

test('first-party allowlist keeps retailer and advertising properties out', () => {
  const selected = ownCatalogFields({...diaper, rakutenItemCode:'test', affiliateUrl:'https://example.test', itemPrice:5000, imageUrl:'https://example.test/p.jpg'});
  assert.equal(selected.rakutenItemCode, undefined);
  assert.equal(selected.affiliateUrl, undefined);
  assert.equal(selected.itemPrice, undefined);
  assert.equal(selected.imageUrl, undefined);
  assert.equal(packageKey(selected),packageKey(diaper));
});
