// Receipt line → registered product suggestions. Different size, form, content amount or brand is
// never suggested; a confirmed match is remembered on the product and offered first next time.
const test = require('node:test');
const assert = require('node:assert/strict');
const m = require('../atokore-live-v125/receipt-match-v38.js');

const stock = [
  { id: 1, name: 'パンパース さらさらケア おむつ テープ M', cat: 'ベビー', unit: '袋' },
  { id: 2, name: 'パンパース さらさらケア おむつ テープ L', cat: 'ベビー', unit: '袋' },
  { id: 3, name: 'パンパース さらさらケア おむつ パンツ M', cat: 'ベビー', unit: '袋' },
  { id: 4, name: 'メリーズ ずっと肌さら おむつ テープ M', cat: 'ベビー', unit: '袋' },
  { id: 5, name: '明治 ほほえみ 粉ミルク 缶 800g', cat: 'ベビー', unit: '缶' },
  { id: 6, name: '明治 ほほえみ 粉ミルク キューブ', cat: 'ベビー', unit: '箱' },
  { id: 7, name: 'Rico おしりふき', cat: 'ベビー', unit: 'パック' },
  { id: 8, name: '牛乳', cat: '食料品', unit: '本' },
  { id: 9, name: 'ティッシュ', cat: '日用品', unit: '個' },
];
const names = (raw, items = stock) => m.candidates(raw, items).map(c => c.item.name);

test('abbreviated receipt names suggest the registered product of the same size and form', () => {
  assert.equal(names('ﾊﾟﾝﾊﾟｰｽ ｻﾗｻﾗｹｱ ﾃｰﾌﾟM')[0], 'パンパース さらさらケア おむつ テープ M');
  assert.equal(names('パンパース サラサラ テープ L 54枚')[0], 'パンパース さらさらケア おむつ テープ L');
  assert.equal(names('ﾒﾘｰｽﾞ ﾃｰﾌﾟM')[0], 'メリーズ ずっと肌さら おむつ テープ M');
  assert.equal(names('ﾎﾎｴﾐ 800G')[0], '明治 ほほえみ 粉ミルク 缶 800g');
  assert.equal(names('ﾘｺ ｵｼﾘﾌｷ')[0], 'Rico おしりふき', 'half-width kana is compared as kana');
  assert.equal(names('リコオシリフキ 80マイX3')[0], 'Rico おしりふき', 'pack contents and bundle counts do not hide the name');
  assert.deepEqual(names('ﾍﾞﾋﾞｰﾜｲﾌﾟ'), [], 'no similar product: no guess');
  assert.equal(names('RICO おしりふき')[0], 'Rico おしりふき');
  assert.equal(names('牛乳 1000ml')[0], '牛乳');
});

test('different size, form, brand or content amount is never suggested', () => {
  assert.ok(!names('ﾊﾟﾝﾊﾟｰｽ ｻﾗｻﾗｹｱ ﾃｰﾌﾟM').includes('パンパース さらさらケア おむつ テープ L'));
  assert.ok(!names('ﾊﾟﾝﾊﾟｰｽ ｻﾗｻﾗｹｱ ﾃｰﾌﾟM').includes('パンパース さらさらケア おむつ パンツ M'));
  assert.ok(!names('ﾊﾟﾝﾊﾟｰｽ ｻﾗｻﾗｹｱ ﾃｰﾌﾟM').includes('メリーズ ずっと肌さら おむつ テープ M'));
  assert.ok(!names('ﾎﾎｴﾐ 300G').includes('明治 ほほえみ 粉ミルク 缶 800g'), '300g is not the 800g can');
  assert.deepEqual(m.conflict(m.features('グーン テープ S'), m.features('グーン テープ M')), 'size');
  // The receipt parser removes spaces: the size is still found after the form word.
  assert.ok(!names('パンパースサラサラケアテープM64マイ').includes('パンパース さらさらケア おむつ テープ L'));
  assert.equal(names('パンパースサラサラケアテープM64マイ')[0], 'パンパース さらさらケア おむつ テープ M');
  assert.equal(m.features('ムーニーマンパンツL44マイ').size, 'l');
  assert.equal(m.features('グーンテープXL').size, 'xl');
  assert.equal(m.features('メリーズテープSS').size, 'ss');
  assert.equal(m.features('テープライト').size, '', 'a word starting with a size letter is not a size');
  assert.deepEqual(m.amounts('ﾃｰﾌﾟM 60ﾏｲ'), ['60枚']);
  assert.deepEqual(m.amounts('1.2kg 200ml 3個入'), ['1200g', '200ml', '3入'].sort());
});

test('a confirmed match is remembered on the product and comes first next time', () => {
  const items = stock.map(x => ({ ...x }));
  assert.equal(names('ﾍﾞﾋﾞｰﾜｲﾌﾟ', items).length, 0);
  assert.ok(m.remember(items[6], 'ﾍﾞﾋﾞｰﾜｲﾌﾟ 298'));
  const again = m.candidates('ﾍﾞﾋﾞｰﾜｲﾌﾟ 298', items);
  assert.equal(again[0].item.name, 'Rico おしりふき');
  assert.equal(again[0].learned, true);
  // Price differences on the same printed name do not matter; at most 10 names per product.
  assert.equal(m.candidates('ﾍﾞﾋﾞｰﾜｲﾌﾟ 318', items)[0].learned, true);
  // A slightly different OCR reading of the same printed name still finds the confirmed product.
  const noisy = m.candidates('ﾍﾞﾋﾞｰﾜｲﾌﾞ 298', items)[0];
  assert.equal(noisy.item.name, 'Rico おしりふき');
  assert.equal(noisy.learned, true);
  // ...but never across a size conflict: a confirmed "テープM" name does not pull in an "L" line.
  const tapes = stock.map(x => ({ ...x }));
  m.remember(tapes[0], 'ﾊﾟﾝﾊﾟｰｽ ｻﾗｻﾗ ﾃｰﾌﾟM');
  assert.ok(!m.candidates('ﾊﾟﾝﾊﾟｰｽ ｻﾗｻﾗ ﾃｰﾌﾟL', tapes).some(c => c.item.id === 1));
  for (let i = 0; i < 15; i++) m.remember(items[6], 'ﾅﾏｴ' + String.fromCharCode(65 + i));
  assert.equal(items[6].receiptAliases.length, 10);
});
