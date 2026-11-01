// v49 receipt structure, OCR line grouping and naming — anonymous SYNTHETIC lines only. They reproduce
// layouts seen on real Japanese receipts (no real receipt, store data or personal data is included).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const S = require('../atokore-live-v125/receipt-structure-v49.js');
const L = require('../atokore-live-v125/receipt-ocr-lines-v49.js');
const M = require('../atokore-live-v125/receipt-match-v38.js');

function receiptApi() {
  const ctx = { console, C: { 食料品: ['牛乳', '卵', 'バナナ'], 日用品: ['ティッシュ'] },
    document: { createElement: () => ({ textContent: '', style: {}, appendChild() {} }), head: { appendChild() {} }, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [] },
    localStorage: { getItem: () => null, setItem() {} }, URL: { createObjectURL: () => '', revokeObjectURL() {} }, Image: function Image() {},
    today: () => '2026-11-01', AtokoreDates: { localDate: () => '2026-11-01' }, AtokoreReceiptStructure: S, showPremium() {}, openM() {}, closeM() {}, items: [], buys: [], save() {}, render() {} };
  ctx.window = ctx; vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../atokore-live-v125/receipt.js'), 'utf8'), ctx);
  return ctx.__atokoreReceiptV125M;
}
const R = receiptApi();
// Results come from another JS realm (vm): copied before deep comparison.
const parse = text => JSON.parse(JSON.stringify(R.parseReceipt(text)));
const rows = text => parse(text).items.map(x => [x.name, x.qty]);

test('prices as OCR reads them: marks before or after, no currency sign, misread ¥, dotted thousands', () => {
  // ※ read as X after a yen sign; a glued count like "350X2" stays part of the name.
  assert.ok(S.priceTail('テスト商品A ¥99X'));
  assert.equal(S.priceTail('テスト商品A 2X'), null);
  assert.equal(S.priceTail('テストなめ茸350X2'), null);
  for (const line of ['テスト商品A *108', 'テスト商品A ¥238外', 'テスト商品A \\128外', 'テスト商品A y238外', 'テスト商品A W80外', 'テスト商品A 1.398', 'テスト商品A ¥1,280※', 'テスト商品A 258円', 'テスト商品A 1,280円']) {
    assert.ok(S.priceTail(S.clean(line)), line);
  }
  // A number glued to the name is part of the name, not a price.
  assert.equal(S.priceTail('テスト炭酸水1LX15'), null);
  assert.equal(S.priceTail('ミートボール2'), null);
  // Paper edges and table texture come back as marks at the ends of lines.
  assert.equal(S.clean('| テスト商品A ¥238外 |'), 'テスト商品A ¥238外');
});

test('purchase quantity lines in the four layouts, checked against unit price × quantity = total', () => {
  assert.deepEqual(S.quantityLine('2コ X 単68 ¥136'), { qty: 2, unitPrice: 68, total: 136, checked: true });
  assert.equal(S.quantityLine('2. ×単98 ¥196').qty, 2); // コ read as "."
  assert.equal(S.quantityLine('( 2個 x @198)').qty, 2);
  assert.equal(S.quantityLine('( 2個x 0108)').qty, 2); // @ read as 0
  assert.equal(S.quantityLine('(@160 × 2個)').qty, 2);
  assert.deepEqual(S.quantityLine('990@ × 4個 ¥3,960'), { qty: 4, unitPrice: 990, total: 3960, checked: true });
  // A misread quantity digit loses to the printed amounts.
  assert.equal(S.quantityLine('3コ X 単68 ¥136').qty, 2);
  // Not purchase quantities: point multipliers, bundle prices, discount counters.
  for (const line of ['4900000000000 (P×5)', '(まとめ売り 3コデ ¥1,000)', '( 2点 1回 -18)']) assert.equal(S.quantityLine(line), null, line);
});

test('a quantity line belongs to the line right above it, whether that line has a price or not', () => {
  assert.deepEqual(rows('テスト炭酸水 1L\n2コ X 単68 ¥136\n小計 2点 ¥136'), [['テスト炭酸水 1L', 2]]);
  assert.deepEqual(rows('テスト鉄板麺 お 特 ¥396外\n( 2個 x @198)\n小計 ¥396'), [['テスト鉄板麺お特', 2]]);
  assert.deepEqual(rows('テストおむつ パンツ 外*\n990@ × 4個 ¥3,960\n4900000000001 (P×5)\n【小計】 ¥3,960'), [['テストおむつパンツ', 4]]);
  // After a discount line it is not attached to anything (and is never a product).
  const r = parse('テスト商品A 198\n値引 -50\n2コ X 単198 ¥396\n小計 ¥346');
  assert.deepEqual(r.items.map(x => x.qty), [1]);
});

test('pack contents are never purchase quantities', () => {
  assert.deepEqual(rows('テスト吹き棒11本入 22mL ¥100外\nテスト炭酸水1LX15 ¥998\nテストおしりふき 60枚 ¥298\n小計 3点 ¥1,396'),
    [['テスト吹き棒11本入 22mL', 1], ['テスト炭酸水1LX15', 1], ['テストおしりふき 60枚', 1]]);
});

test('warehouse-club layout: item-code lines give the quantity, coupons are dropped, unreadable names are shown', () => {
  const r = parse([
    '>>> BEGIN BOTTOM OF BASKET <<<', '※ TEST SPARKLING ASSORT', '91529 10 1.398 1,398 E', 'CPN', '※ TEST SPARKLING ASSORT', '95334 10 280 280-E',
    '>>> BOTTOM OF BASKET ITEM COUNT 1 <<<', '御買上げ点数 :1',
    '※ テストコーヒー-50', '571577 10 1.548 1.548 E', '※ テストコーヒー-50', '571577 10 1.548 1,548 E',
    '※', '577393 10 1.078 1.078 E',
    '※ テスト塩辛', '24563 10 1,328 1.328 E', 'CPN', '※ テスト塩辛IRC 270-E', '9349 10 270',
    '**** 合計 5,352', '現金 0', 'クレジットカード 5,352', '御買上げ点数 :5',
  ].join('\n'));
  assert.deepEqual(r.items.map(x => [x.name, x.qty, x.selected]), [['TEST SPARKLING ASSORT', 1, true], ['テストコーヒー-50', 2, true], ['テスト塩辛', 1, true]]);
  // The final count (5), not the bottom-of-basket count (1), is compared: 4 read, one line unreadable.
  assert.equal(r.printedCount, 5);
  assert.equal(r.countedQty, 4);
  assert.equal(r.countMatches, false);
  assert.ok(r.rejected.some(x => /商品名を読めない行（1点）/.test(x.reason)));
  assert.ok(!r.items.some(x => /IRC|CPN/.test(x.name)));
});

test('the item list ends at subtotal, total or the tax summary, even when the large 合計 is misread', () => {
  const r = parse('テスト商品A ¥388\nテスト商品B ¥173\n外税8%(対象 ¥561) ¥44\n十 ¥605\nクレジット ¥605\n当月お買上累計額 ¥6,622\nビザ/マスター');
  assert.deepEqual(r.items.map(x => x.name), ['テスト商品A', 'テスト商品B']);
  assert.equal(r.boundary.kind, 'tax');
  const t = parse('テスト商品A ¥100\n**** 合計 100\nテストっぽい広告文 999');
  assert.deepEqual(t.items.map(x => x.name), ['テスト商品A']);
  assert.equal(S.itemListEnded(['テスト商品A ¥100', '小計 ¥100', '買上点数 1点', '合計 ¥108']), true);
  assert.equal(S.itemListEnded(['テスト商品A ¥100', 'テスト商品B ¥200']), false);
});

test('the printed item count is read in its common forms', () => {
  for (const [line, n] of [['お買上点数 9点', 9], ['小計/ 6点 ¥866', 6], ['小計 3点 ¥300', 3], ['買上点数 26点', 26], ['御買上げ点数 :15', 15], ['10点買', 10]]) assert.equal(S.printedCount(line), n, line);
  const r = parse('テスト商品A ¥100\nテスト商品B\n2コ X 単50 ¥100\n小計/ 3点 ¥200');
  assert.equal(r.countMatches, true);
});

test('header text and store codes are not products; department and tax codes leave the name', () => {
  const r = parse('テストストア 本町店\nTEL 000-000-0000\n2026年10月27日(火) 12:54 #000019\n責:セルフレジ\nお会計券 #000008 R2827 11:44\n外8 テスト高糖度トマト ¥238外\n13*テスト麺 こってり味 ¥388\n0011テストバター 軽 ¥354\n0002 テスト豚切落し 大 ¥758※\n外8 テスト玉子 Mサイズ S001 ¥238外\nS001)Mサイズ特売 -50\n小計 ¥1,926');
  // Spaces between Japanese words are removed as before (receipts space-pad names).
  assert.deepEqual(r.items.map(x => x.raw), ['テスト高糖度トマト', 'テスト麺こってり味', 'テストバター', 'テスト豚切落し大', 'テスト玉子 Mサイズ']);
  assert.equal(r.rejected.length, 0);
});

test('OCR quirks are tidied in names: Chinese forms of receipt words, voicing marks of half-width kana', () => {
  assert.equal(S.hw('2コX单68'), '2コX単68');
  assert.deepEqual(rows('テストプ*レント*アイスコ-ヒ- ¥980\nオーカ°ニックハ°ナナ ¥399\n小计 ¥1,379'), [['テストブレンドアイスコーヒー', 1], ['オーガニックパナナ', 1]]);
});

test('a generic name replaces the printed one only when the word is most of the name', () => {
  assert.deepEqual(rows('テスト玉子 Mサイズ ¥238\n小計 ¥238').map(r => r[0]), ['テスト玉子 Mサイズ']);
  // v49 audit: a printed size stays in the name (M and L eggs are different products); the generic name is
  // only used to look for the registered product.
  assert.deepEqual(rows('玉子 Mサイズ ¥238\n玉子 ¥228\nテスト玉子とハムのサンド ¥358\nテストバナナケーキミニ ¥128\nテスト麦茶2L ¥118\nバナナ ¥198\n小計 ¥1,268').map(r => r[0]),
    ['玉子 Mサイズ', '卵', 'テスト玉子とハムのサンド', 'テストバナナケーキミニ', 'テスト麦茶2L', 'バナナ']);
});

test('suggestions: the printed text, then the generic name; never a different size or amount', () => {
  const stock = [{ id: 1, name: '卵' }, { id: 2, name: '豚こま肉' }, { id: 3, name: 'テスト麦茶 2L' }];
  const pick = raw => { const it = R.parseReceipt(raw + ' ¥100\n小計 ¥100').items[0]; return Array.from(R.candidatesFor(it, stock, M), c => c.item.id); };
  assert.deepEqual(pick('玉子 Mサイズ'), [1]);
  assert.deepEqual(pick('テスト麦茶 650ml'), []);
  assert.deepEqual(pick('テスト麦茶650m|'), []); // OCR read the l of ml as |
  assert.deepEqual(pick('テスト麦茶2L'), [3]);
  assert.deepEqual(pick('テスト玉子とハムのサンド'), []);
});

test('OCR boxes on one printed line are joined left to right', () => {
  const box = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
  const lines = L.groupBoxes([
    { box: box(400, 102, 80, 30), text: '*108', score: 0.99 },
    { box: box(20, 100, 300, 32), text: 'テスト白桃烏龍茶 600ml', score: 0.97 },
    { box: box(20, 150, 300, 32), text: 'テストポッキー', score: 0.9 },
    { box: box(400, 149, 80, 30), text: '*233', score: 0.98 },
  ]);
  assert.deepEqual(lines.map(l => l.text), ['テスト白桃烏龍茶 600ml *108', 'テストポッキー *233']);
  assert.ok(lines.every(l => l.confidence >= 90));
});

test('v49 audit: general OCR repairs are flagged, never silent; separators and real words are kept', () => {
  const one = text => parse(text + '\n小計 ¥100').items[0];
  // A half-width voicing mark read as "・" between kana; a real separator after ル stays.
  let it = one('ハリホ・ーコ・ールト・ベア ¥100');
  assert.equal(it.name, 'ハリボーゴールドベア');
  assert.ok(it.reasons.includes('濁点か半濁点か不確か') && !it.selected);
  assert.equal(one('イル・チッチョ 生ハム ¥100').name, 'イル・チッチョ生ハム');
  // One hiragana letter inside a katakana word is flagged, not changed; particles are real words.
  it = one('オーがニックバナナ ¥100');
  assert.equal(it.name, 'オーがニックバナナ');
  assert.ok(it.reasons.includes('読み違いの可能性がある文字'));
  it = one('ヤッポーのチキンナゲット ¥100');
  assert.equal(it.name, 'ヤッポーのチキンナゲット');
  assert.equal(it.reasons.length, 0);
  // Katakana ニ between kanji; traditional 產; a code with ☆ before the name.
  assert.equal(one('不ニ家 アンパンマン ¥100').name, '不二家アンパンマン');
  assert.equal(one('エクアドル產バナナ ¥100').name, 'エクアドル産バナナ');
  assert.equal(one('0008☆ブロッコリー ¥100').raw, 'ブロッコリー');
  // "7" before katakana may be a misread ア: flagged, not changed ("7P" brand names stay as printed).
  it = one('7イリス強炭酸水 ¥100');
  assert.equal(it.raw, '7イリス強炭酸水');
  assert.ok(it.reasons.includes('読み違いの可能性がある文字'));
  assert.equal(one('7P白桃烏龍茶 600ml *108').reasons.length, 0);
});

test('v49 audit: a misread voicing mark still finds the registered product, sizes still block', () => {
  assert.deepEqual(M.candidates('プロッコリー', [{ id: 1, name: 'ブロッコリー' }]).map(c => c.item.id), [1]);
  assert.deepEqual(M.candidates('ハナナ', [{ id: 1, name: 'バナナ' }]).map(c => c.item.id), [1]);
  assert.deepEqual(M.candidates('テスト麦茶 650ml', [{ id: 1, name: 'テスト麦茶 2L' }]), []);
});

test('v49 audit: learned texts pre-select only when exactly the same; near texts are offered', () => {
  const stock = [{ id: 1, name: 'テスト炭酸水 1L', receiptAliases: [M.lineKey('テスト炭酸水1L')] }];
  assert.equal(M.candidates('テスト炭酸水1L', stock)[0].learned, true);
  const near = M.candidates('テスト炭酸水レ', stock)[0];
  assert.equal(near.learned, false);
  assert.equal(near.near, true);
});
