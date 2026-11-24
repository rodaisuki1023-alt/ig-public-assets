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
  assert.deepEqual(names('パンパース サラサラ テープ L 54枚'), [], 'stock without a printed 54-sheet pack size must not be offered');
  assert.equal(names('ﾒﾘｰｽﾞ ﾃｰﾌﾟM')[0], 'メリーズ ずっと肌さら おむつ テープ M');
  assert.equal(names('ﾎﾎｴﾐ 800G')[0], '明治 ほほえみ 粉ミルク 缶 800g');
  assert.equal(names('ﾘｺ ｵｼﾘﾌｷ')[0], 'Rico おしりふき', 'half-width kana is compared as kana');
  assert.deepEqual(names('リコオシリフキ 80マイX3'), [], 'unknown stock pack size is unsafe even with a similar name');
  assert.deepEqual(names('ﾍﾞﾋﾞｰﾜｲﾌﾟ'), [], 'no similar product: no guess');
  assert.equal(names('RICO おしりふき')[0], 'Rico おしりふき');
  assert.deepEqual(names('牛乳 1000ml'), [], 'known 1000ml must not be suggested against unspecified stock capacity');
  // Kana on the receipt, kanji in the product name.
  assert.equal(names('ﾒｲｼﾞ ﾎﾎｴﾐ ｶﾝ 800G')[0], '明治 ほほえみ 粉ミルク 缶 800g');
  assert.deepEqual(names('ﾀﾏｺﾞ 10ｺｲﾘ', [{ id: 1, name: '卵' }, { id: 2, name: '牛乳' }]), [], 'unknown pack count must not be suggested');
});

test('different size, form, brand or content amount is never suggested', () => {
  assert.ok(!names('ﾊﾟﾝﾊﾟｰｽ ｻﾗｻﾗｹｱ ﾃｰﾌﾟM').includes('パンパース さらさらケア おむつ テープ L'));
  assert.ok(!names('ﾊﾟﾝﾊﾟｰｽ ｻﾗｻﾗｹｱ ﾃｰﾌﾟM').includes('パンパース さらさらケア おむつ パンツ M'));
  assert.ok(!names('ﾊﾟﾝﾊﾟｰｽ ｻﾗｻﾗｹｱ ﾃｰﾌﾟM').includes('メリーズ ずっと肌さら おむつ テープ M'));
  assert.ok(!names('ﾎﾎｴﾐ 300G').includes('明治 ほほえみ 粉ミルク 缶 800g'), '300g is not the 800g can');
  assert.deepEqual(m.conflict(m.features('グーン テープ S'), m.features('グーン テープ M')), 'size');
  // The receipt parser removes spaces: the size is still found after the form word.
  assert.ok(!names('パンパースサラサラケアテープM64マイ').includes('パンパース さらさらケア おむつ テープ L'));
  assert.deepEqual(names('パンパースサラサラケアテープM64マイ'), [], 'a printed pack count requires a known matching stock count');
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
  // A slightly different OCR reading still finds the confirmed product, but only as a suggestion (v49):
  // a near match may be another flavour or size read alike, so it is never "learned" (never pre-selected).
  const noisy = m.candidates('ﾍﾞﾋﾞｰﾜｲﾌﾞ 298', items)[0];
  assert.equal(noisy.item.name, 'Rico おしりふき');
  assert.equal(noisy.learned, false);
  assert.equal(noisy.near, true);
  // ...but never across a size conflict: a confirmed "テープM" name does not pull in an "L" line.
  const tapes = stock.map(x => ({ ...x }));
  m.remember(tapes[0], 'ﾊﾟﾝﾊﾟｰｽ ｻﾗｻﾗ ﾃｰﾌﾟM');
  assert.ok(!m.candidates('ﾊﾟﾝﾊﾟｰｽ ｻﾗｻﾗ ﾃｰﾌﾟL', tapes).some(c => c.item.id === 1));
  for (let i = 0; i < 15; i++) m.remember(items[6], 'ﾅﾏｴ' + String.fromCharCode(65 + i));
  assert.equal(items[6].receiptAliases.length, 10);
});


test('v50: first-time identical product is marked exact, while similar or different sizes are not', () => {
  const items = [
    { id: 1, name: 'パンパース さらさらケア テープ M 60枚' },
    { id: 2, name: 'パンパース さらさらケア テープ L 60枚' },
    { id: 3, name: 'テストラーメン しょうゆ味' },
  ];
  const exact = m.candidates('パンパース さらさらケア テープ M 60枚', items);
  assert.equal(exact[0].item.id, 1);
  assert.equal(exact[0].exact, true);
  assert.ok(!exact.some(c => c.item.id === 2));
  assert.equal(m.candidates('テストラーメン みそ味', items).some(c => c.exact), false);
});

test('v50: printed package digits remain distinct, but standalone prices still normalize', () => {
  assert.notEqual(m.lineKey('テスト商品6'), m.lineKey('テスト商品8'));
  assert.equal(m.lineKey('ベビーワイプ 298'), m.lineKey('ベビーワイプ 318'));
  const item = { id: 5, name: 'パンパース テープ M 60枚', receiptAliases: [m.lineKey('パンパース テープ M 60枚')] };
  item.name = 'パンパース テープ L 60枚'; // item was edited after learning
  assert.equal(m.candidates('パンパース テープ M 60枚', [item]).length, 0);
});

test('P1: capacity must be explicitly comparable, including for learned aliases', () => {
 const candidates=[
  {id:1,name:'テスト飲料',receiptAliases:[m.lineKey('テスト飲料 2L')]},
  {id:2,name:'テスト飲料 500ml',receiptAliases:[m.lineKey('テスト飲料 2L')]},
  {id:3,name:'テスト飲料 2000ml',receiptAliases:[m.lineKey('テスト飲料 2L')]}
 ];
 const got=m.candidates('テスト飲料 2L',candidates);
 assert.deepEqual(got.map(x=>x.item.id),[3]);
 assert.equal(got[0].learned,true);
 assert.equal(m.conflict(m.features('テスト飲料 2L'),m.features('テスト飲料')),'amount');
 assert.equal(m.conflict(m.features('テスト飲料'),m.features('テスト飲料 2L')),'amount');
 assert.equal(m.conflict(m.features('テスト飲料 2L'),m.features('テスト飲料 2000ml')),'');
 assert.equal(m.candidates('テスト飲料',candidates).some(x=>x.item.id===3),false);
});

test('v50: explicit flavour conflict cannot be overridden by learned receipt aliases',()=>{
 const raw='テストラーメン 醤油味';
 const rows=[
  {id:1,name:'テストラーメン みそ味',receiptAliases:[m.lineKey(raw)]},
  {id:2,name:'テストラーメン しょうゆ味'},
  {id:3,name:'テストラーメン',receiptAliases:[m.lineKey(raw)]}
 ];
 assert.deepEqual(m.candidates(raw,rows).map(c=>c.item.id),[2]);
 assert.equal(m.conflict(m.features('テストゼリー ｲﾁｺﾞ味'),m.features('テストゼリー 苺味')),'');
 assert.equal(m.conflict(m.features('テストゼリー 桃味'),m.features('テストゼリー 林檎味')),'flavour');
 assert.equal(m.conflict(m.features('テストヨーグルト'),m.features('テストヨーグルト バニラ風味')),'flavour');
});
test('v50: compare explicit package multipliers separately from each package capacity',()=>{
 const raw='おしりふき ８０ﾏｲＸ３';
 const items=[
  {id:1,name:'おしりふき 80枚×6',receiptAliases:[m.lineKey(raw)]},
  {id:2,name:'おしりふき 80枚',receiptAliases:[m.lineKey(raw)]},
  {id:3,name:'おしりふき 80枚×3'}
 ];
 assert.deepEqual(m.candidates(raw,items).map(c=>c.item.id),[3]);
 assert.equal(m.conflict(m.features('テスト飲料 0.5L×6'),m.features('テスト飲料 500ml x 6')),'');
 assert.equal(m.conflict(m.features('テスト飲料 500ml×6'),m.features('テスト飲料 500ml×3')),'bundle');
 assert.deepEqual(m.features('テスト商品 x3').bundles,[],'bare x3 may be purchase quantity');
});
