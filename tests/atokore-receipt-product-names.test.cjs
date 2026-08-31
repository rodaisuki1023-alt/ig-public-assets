const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'atokore-live-v125', 'receipt.js'),
  'utf8'
);

const badge = { textContent: '' };
const context = {
  console,
  C: {
    食料品: ['牛乳', '卵', '食パン', 'バナナ'],
    日用品: ['レジ袋'],
  },
  document: {
    createElement: () => ({ textContent: '', style: {}, appendChild() {} }),
    head: { appendChild() {} },
    getElementById: () => null,
    querySelector: (selector) => (selector === '.badge' ? badge : null),
    querySelectorAll: () => [],
  },
  localStorage: {
    getItem: () => null,
    setItem() {},
  },
  URL: {
    createObjectURL: () => 'blob:test',
    revokeObjectURL() {},
  },
  Image: function Image() {},
  today: () => '2026-08-31',
  showPremium() {},
  openM() {},
  closeM() {},
};
context.window = context;

vm.runInNewContext(source, context, { filename: 'receipt.js' });

const parser = context.__atokoreReceiptV125I;
assert.ok(parser, 'product-name parser API should be exposed for verification');

const receiptText = `
イオン上尾店
〒362-0000 埼玉県上尾市
2026/08/31 12:34
TEL 048-000-0000
4901234567890
牛乳 900ml 218
卵 10個入
258
食パン 158
レジ袋 5
オーガニックシリアル 500g 698
サクサククッキー 123 298
R-1
148
商品コード 123456
No. 123456 890
1 1 1 198
I 198
小計 1,337
消費税 133
合計 1,470
お預り 2,000
お釣り 530
`;

const parsed = parser.parseProductNames(receiptText);
assert.deepEqual(
  Array.from(parsed.items, (item) => item.name),
  ['牛乳', '卵', '食パン', 'レジ袋', 'オーガニックシリアル 500g', 'サクサククッキー', 'R-1'],
  'only product-name candidates should remain'
);
assert.equal(parsed.store, '', 'store should not be inferred in product-name-only mode');
assert.equal(parsed.date, '2026-08-31', 'purchase date should safely default to today');
for (const item of parsed.items) {
  assert.equal(item.qty, 1, 'OCR numbers must not become quantity');
  assert.equal(item.price, 0, 'OCR numbers must not become price');
  assert.equal(item.total, 0, 'OCR numbers must not become totals');
  assert.match(item.name, /[A-Za-zぁ-んァ-ヶ一-龠々ー]/);
}

const duplicateText = 'バナナ 198\nバナナ 198\n合計 396';
const duplicate = parser.parseProductNames(duplicateText);
assert.equal(duplicate.items.length, 1, 'duplicate OCR product lines should be collapsed');
assert.equal(duplicate.items[0].name, 'バナナ');
assert.equal(duplicate.items[0].qty, 1, 'duplicate OCR must not guess quantity');

assert.doesNotMatch(source, /購入単価|レシート金額/);
assert.match(source, /商品名だけをOCRで抽出します/);

console.log('Atokore receipt product names: all tests passed');
