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
    食料品: [
      '牛乳', '卵', '食パン', 'バナナ', 'キャベツ', '白菜', 'じゃがいも',
      'ごぼう', 'ごま油', '豚バラ肉', '豚こま肉', '厚揚げ', 'ハム', 'ベーコン',
    ],
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

const parser = context.__atokoreReceiptV125K;
assert.ok(parser, 'v12.5k receipt parser API should be exposed for verification');

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
assert.equal(parsed.store, '', 'store should not be inferred in product-name mode');
assert.equal(parsed.date, '2026-08-31', 'purchase date should safely default to today');
assert.equal(parsed.stoppedAtSubtotal, true, 'receipt parsing should stop at subtotal');
assert.equal(parsed.subtotalLine, '小計 1,337');
for (const item of parsed.items) {
  assert.equal(item.qty, 1, 'unambiguous item lines should start at one');
  assert.equal(item.price, 0, 'OCR numbers must not become price');
  assert.equal(item.total, 0, 'OCR numbers must not become totals');
  assert.match(item.name, /[A-Za-zぁ-んァ-ヶ一-龠々ー]/);
}
assert.deepEqual(
  Array.from(parsed.rejected, (entry) => entry.text),
  ['1 1 1 198', 'I 198'],
  'numeric and one-letter garbage should be rejected visibly'
);

const corruptedReceipt = `
1520軽純正ごま油 ¥328
1520軽 MRMIー2 ¥128
|1100#8 キャベツ 1コ ¥158
1100軽 新じゃがいも
2コ X 単88 ¥176
1100軽 ごぼう ¥138
1100軽 ごぼう ¥298
合計 ¥1,107
`;
const corrected = parser.parseReceipt(corruptedReceipt);
assert.deepEqual(
  Array.from(corrected.items, (item) => item.name),
  ['純正ごま油', 'キャベツ', '新じゃがいも', 'ごぼう'],
  'tax/category prefixes and quantity suffixes must not enter product names'
);
assert.equal(corrected.items.find((item) => item.name === '新じゃがいも').qty, 2);
assert.equal(corrected.items.find((item) => item.name === 'ごぼう').qty, 2);
assert.equal(corrected.items.find((item) => item.name === 'キャベツ').qty, 1);
assert.deepEqual(
  Array.from(corrected.rejected, (entry) => entry.text),
  ['1520軽 MRMIー2 ¥128'],
  'unreadable Latin OCR noise must not be auto-registered'
);
for (const item of corrected.items) {
  assert.doesNotMatch(item.name, /^(?:[|Il]?\d{4}|#8)/);
  assert.doesNotMatch(item.name, /¥|\d+円/);
}

const supermarketReceipt = `
1600 レジ袋（大） ¥5
1520軽 フレッシュパック ¥228
1520軽 くらこん塩こんぶ小 ¥118
1520軽 純正ごま油 ¥328
1520軽 無添加コーン ¥128
1300軽 豚ばらうす切り ¥387
1300軽 豚こま切れ ¥690
1100軽 白菜 1/4
2コ X 単98 ¥196
1100軽 いんげん ¥198
1100軽 キャベツ 1コ ¥158
1100軽 じゃがいも ¥398
1520軽 シーチキンM4缶 ¥458
1100軽 たまねぎ バラ ¥88
1100軽 新じゃがいも
2コ X 単88 ¥176
1300軽 豚ひき肉 ¥125
1300軽 伊藤ロースハム ¥258
1580軽 やわらか厚あげ ¥94
1300軽 伊藤ハムベーコン ¥258
1100軽 ごぼう ¥138
1100軽 ごぼう ¥298
小計 ¥4,727
合計 ¥5,104
`;
const supermarket = parser.parseReceipt(supermarketReceipt);
assert.equal(supermarket.items.length, 19, 'the 20 receipt rows should become 19 unique products');
assert.equal(supermarket.stoppedAtSubtotal, true, 'supermarket receipt should stop at subtotal');
assert.equal(supermarket.items.find((item) => item.name === '白菜').qty, 2);
assert.equal(supermarket.items.find((item) => item.name === '新じゃがいも').qty, 2);
assert.equal(supermarket.items.find((item) => item.name === 'ごぼう').qty, 2);
assert.ok(supermarket.items.some((item) => item.name === 'シーチキンM4缶'));
assert.ok(supermarket.items.some((item) => item.name === '豚バラ肉'));
assert.ok(supermarket.items.some((item) => item.name === '豚こま肉'));

const tsv = [
  'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext',
  '5\t1\t1\t1\t1\t1\t10\t10\t70\t20\t92\t1520軽',
  '5\t1\t1\t1\t1\t2\t90\t10\t140\t20\t88\t純正ごま油',
  '5\t1\t1\t1\t1\t3\t250\t10\t50\t20\t95\t¥328',
  '5\t1\t1\t1\t2\t1\t10\t40\t70\t20\t93\t1520軽',
  '5\t1\t1\t1\t2\t2\t90\t40\t100\t20\t20\tMRMIー2',
  '5\t1\t1\t1\t2\t3\t250\t40\t50\t20\t90\t¥128',
  '5\t1\t1\t1\t3\t1\t10\t70\t70\t20\t40\t1100軽',
  '5\t1\t1\t1\t3\t2\t90\t70\t100\t20\t35\tキャベツ',
  '5\t1\t1\t1\t3\t3\t250\t70\t50\t20\t38\t¥158',
].join('\n');
const tsvLines = parser.parseTsvLines(tsv);
assert.equal(tsvLines.length, 3, 'TSV words should be grouped into spatial receipt lines');
assert.equal(tsvLines[0].text, '1520軽 純正ごま油 ¥328');
const structured = parser.parseReceipt({ text: 'この文字は使わない 999', tsv });
assert.deepEqual(Array.from(structured.items, (item) => item.name), ['純正ごま油', 'キャベツ']);
assert.equal(structured.items[1].low, true, 'low-confidence OCR must require review');
assert.equal(structured.items[1].selected, false, 'low-confidence OCR must not be preselected');
assert.equal(structured.rejected.length, 1);

const duplicate = parser.parseProductNames('バナナ 198\nバナナ 198\n合計 396');
assert.equal(duplicate.items.length, 1, 'duplicate product lines should be collapsed');
assert.equal(duplicate.items[0].name, 'バナナ');
assert.equal(duplicate.items[0].qty, 2, 'repeated receipt rows should become an explicit quantity');

const postSubtotalNoise = parser.parseReceipt(`
牛乳 218
卵 258
お買い上げ 小 計
476
サマーキャンペーン 500
アンケート謝礼 100
ポイント残高 2,000
`);
assert.deepEqual(
  Array.from(postSubtotalNoise.items, (item) => item.name),
  ['牛乳', '卵'],
  'product-like text after subtotal must never become stock candidates'
);
assert.equal(postSubtotalNoise.stoppedAtSubtotal, true);
assert.equal(postSubtotalNoise.subtotalLine, 'お買い上げ 小 計 476');
assert.equal(postSubtotalNoise.rejected.length, 0, 'post-subtotal text should not be evaluated at all');

for (const line of [
  '小計 1,234',
  '小 計 ¥1,234',
  'お買上小計 ￥1,234',
  'お買い上げ小計:1234',
  '税込小計（8%） 1,234',
  '課税対象小計 1,234',
]) {
  assert.equal(parser.isSubtotalBoundary(line), true, `subtotal variant should stop parsing: ${line}`);
}
assert.equal(parser.isSubtotalBoundary('小計算ドリル 398'), false, 'a product containing similar characters must not stop parsing');

assert.doesNotMatch(source, /購入単価|レシート金額/);
assert.match(source, /「小計」を見つけた時点で読み取りを終了/);
assert.match(source, /要確認・未選択/);
assert.match(source, /tessedit_pageseg_mode:'6'/);
assert.match(source, /tsv:true/);

console.log('Atokore receipt structure parser: all tests passed');
