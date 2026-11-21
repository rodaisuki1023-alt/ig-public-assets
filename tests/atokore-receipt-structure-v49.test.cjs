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
  assert.deepEqual(rows('テスト焼うどん お 特 ¥396外\n( 2個 x @198)\n小計 ¥396'), [['テスト焼うどんお特', 2]]);
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

test('v49 2nd audit: an amount equal to the items so far never ends the list (real products are kept)', () => {
  const view = text => { const r = parse(text); return { items: r.items.map(x => [x.name, x.selected, x.reasons]), rejected: r.rejected.map(x => x.text), kind: r.boundary && r.boundary.kind }; };
  const SUM = '金額がそれまでの合計とほぼ同じ（小計の読み違いの可能性）', AFTER = '小計とみられる行より後に読み取った行';
  // Near the running total (¥1,050 after ¥1,000), the same amount, and the same amount after a discount:
  // the printed subtotal equals every line kept, so all are purchases and nothing needs review.
  for (const text of ['商品甲 ¥500\n商品乙 ¥500\n豆乳 ¥1050\n商品丙 ¥200\n小計 ¥2250',
    '商品甲 ¥500\n商品乙 ¥500\n豆乳 ¥1000\n商品丙 ¥200\n小計 ¥2200',
    '商品甲 ¥500\n商品乙 ¥700\n値引 -¥200\n豆乳 ¥1000\n商品丙 ¥200\n小計 ¥2200']) {
    assert.deepEqual(view(text).items, [['商品甲', true, []], ['商品乙', true, []], ['豆乳', true, []], ['商品丙', true, []]], text);
  }
  // No printed subtotal or item count: kept, unselected, with the reason shown; the next line is normal.
  assert.deepEqual(view('商品甲 ¥500\n商品乙 ¥500\n豆乳 ¥1000\n商品丙 ¥200').items,
    [['商品甲', true, []], ['商品乙', true, []], ['豆乳', false, [SUM]], ['商品丙', true, []]]);
  // The printed subtotal does not include it: still kept for review, never dropped.
  assert.deepEqual(view('商品甲 ¥500\n商品乙 ¥500\n豆乳 ¥1000\n小計 ¥1000\n合計 ¥1080').items,
    [['商品甲', true, []], ['商品乙', true, []], ['豆乳', false, [SUM]]]);
  // A real subtotal and a misread one still end the list; tax and payment are never products.
  let v = view('商品甲 ¥500\n商品乙 ¥500\n小計 ¥1000\n外税8% ¥80\n合計 ¥1080\nお預り ¥2000');
  assert.deepEqual(v.items.map(x => x[0]), ['商品甲', '商品乙']); assert.equal(v.kind, 'subtotal');
  v = view('商品甲 ¥500\n商品乙 ¥500\n小叶十 ¥1000\n外税8% ¥80\n合計 ¥1080');
  assert.deepEqual(v.items.map(x => x[0]), ['商品甲', '商品乙']); assert.equal(v.kind, 'subtotal');
  // A label that can only be a misread 計 is listed for review, not a product; lines after it stay products,
  // marked and unselected (v49 3rd audit: even when a later subtotal agrees, the person decides).
  v = view('商品甲 ¥500\n商品乙 ¥500\n十 ¥1000\n商品丙 ¥200\n小計 ¥1200');
  assert.deepEqual(v.items, [['商品甲', true, []], ['商品乙', true, []], ['商品丙', false, [AFTER]]]);
  assert.deepEqual(v.rejected, ['十 ¥1000']);
  v = view('商品甲 ¥500\n商品乙 ¥500\n十 ¥1000\n広告の行 ¥300\n合計 ¥1080');
  assert.deepEqual(v.items.at(-1), ['広告の行', false, [AFTER]]);
  assert.deepEqual(v.rejected, ['十 ¥1000']);
  v = view('商品甲 ¥500\n商品乙 ¥500\n十 ¥1000\nポイント 10');
  assert.deepEqual(v.items.map(x => x[0]), ['商品甲', '商品乙']); assert.equal(v.kind, 'sum');
});

test('v49 3rd audit: a line after a subtotal-like line is never made a normal selected product by matching amounts', () => {
  const view = text => { const r = parse(text); return { items: r.items.map(x => [x.name, x.selected, x.reasons]), rejected: r.rejected.map(x => x.text) }; };
  const AFTER = '小計とみられる行より後に読み取った行', SUM = '金額がそれまでの合計とほぼ同じ（小計の読み違いの可能性）';
  // A tax-like line read after the misread subtotal makes the total agree: it stays listed, unselected, with the reason.
  let v = view('商品甲 ¥500\n商品乙 ¥500\n十 ¥1000\nテスト表示の行 ¥80\n合計 ¥1080');
  assert.deepEqual(v.items, [['商品甲', true, []], ['商品乙', true, []], ['テスト表示の行', false, [AFTER]]]);
  assert.deepEqual(v.rejected, ['十 ¥1000']);
  // A total within tax of the sum does not clear the near-total doubt either; an exactly equal subtotal does.
  v = view('商品甲 ¥500\n商品乙 ¥500\n豆乳 ¥1000\n合計 ¥2160');
  assert.deepEqual(v.items.at(-1), ['豆乳', false, [SUM]]);
  v = view('商品甲 ¥500\n商品乙 ¥500\n豆乳 ¥1000\n小計 ¥2000\n合計 ¥2160');
  assert.deepEqual(v.items.at(-1), ['豆乳', true, []]);
  // Ordinary receipts get no doubt at all (none of these lines is near the running total).
  v = view('商品甲 ¥500\n商品乙 ¥300\n商品丙 ¥200\n小計 ¥1000\n合計 ¥1080');
  assert.deepEqual(v.items, [['商品甲', true, []], ['商品乙', true, []], ['商品丙', true, []]]);
});

test('overlapping subtotal doubts keep later rows unselected even when the subtotal matches', () => {
  const AFTER = '小計とみられる行より後に読み取った行';
  const SUM = '金額がそれまでの合計とほぼ同じ（小計の読み違いの可能性）';
  for (const amount of [1000, 1050]) {
    for (const ending of ['', `\n小計 ¥${1000 + amount}`, `\n合計 ¥${1000 + amount}`]) {
      const result = parse(`商品甲 ¥500\n商品乙 ¥500\n十 ¥1000\n短品 ¥${amount}${ending}`);
      const row = result.items.find(x => x.name === '短品');
      assert.ok(row, 'the row must remain available for the person to choose');
      assert.equal(row.selected, false, 'matching amounts must not clear the post-subtotal doubt');
      assert.ok(row.reasons.includes(AFTER));
      assert.equal(row.reasons.includes(SUM), !ending.startsWith('\n小計'));
      assert.deepEqual(result.rejected.map(x => x.text), ['十 ¥1000']);
    }
  }
});

test('v49 2nd audit: unread OCR runs inside the item list are reported by place; never products', () => {
  const box = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
  const line = (text, top) => ({ text, top, bottom: top + 30, left: 20, right: 400, confidence: 90, minScore: 90 });
  const lines = [line('テスト店', 10), line('商品甲 ¥100', 100), line('商品乙 ¥200', 150), line('商品丙 ¥300', 250), line('小計 ¥600', 300), line('ポイント 6', 400)];
  const p = JSON.parse(JSON.stringify(R.parseReceipt(lines)));
  assert.deepEqual(p.items.map(x => x.name), ['商品甲', '商品乙', '商品丙']);
  const dropped = [
    { box: box(10, 15, 30, 20), score: 0.2 },   // store header: above the first product, not listed
    { box: box(300, 152, 40, 24), score: 0.3 }, // on a line that was read: part of that line
    { box: box(30, 202, 120, 26), score: 0.4 }, // between lines: a possibly missed product (two runs, one place)
    { box: box(200, 204, 60, 24), score: 0.1, empty: true },
    { box: box(30, 410, 200, 26), score: 0.2 }, // after the subtotal: payment / advertising, not listed
  ];
  const u = JSON.parse(JSON.stringify(R.unreadAreas(lines, p, dropped)));
  assert.equal(u.total, 3); assert.equal(u.inLine, 1); assert.equal(u.places.length, 1); assert.equal(u.places[0].n, 2);
  assert.ok(u.places[0].top >= 200 && u.places[0].bottom <= 230);
  assert.deepEqual(p.items.map(x => x.name), ['商品甲', '商品乙', '商品丙']); // nothing became a product
  assert.deepEqual(JSON.parse(JSON.stringify(R.unreadAreas(lines, p, []))), { places: [], inLine: 0, total: 0, rangeKnown: true });
});

test('v49 2nd audit: a quantity line read without the space before the total (proportional print)', () => {
  for (const q of ['2コ X単98¥196', '2コX単98¥196', '2コ X 単98 ¥196']) assert.deepEqual({ ...S.quantityLine(q) }, { qty: 2, unitPrice: 98, total: 196, checked: true }, q);
  assert.deepEqual({ ...S.quantityLine('@160 x 2個¥320') }, { qty: 2, unitPrice: 160, total: 320, checked: true });
  // The line above keeps its name and gets the quantity; the quantity line is never a product.
  assert.deepEqual(rows('0011 テスト炭酸水 500ml\n2コ X単98¥196\n小計 ¥196'), [['テスト炭酸水 500ml', 2]]);
});

test('v49 3rd audit: unread places — dropped first product, no end line, no products, header overlap, rows without a picture', () => {
  const box = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
  const line = (text, top) => ({ text, top, bottom: top + 30, left: 20, right: 400, confidence: 90, minScore: 90 });
  const areas = (lines, dropped) => { const p = JSON.parse(JSON.stringify(R.parseReceipt(lines))); return { p, u: JSON.parse(JSON.stringify(R.unreadAreas(lines, p, dropped))) }; };
  const head = line('テストストア', 10);
  // First product dropped by the OCR (between the store name and the first product read): listed.
  let { p, u } = areas([head, line('テスト商品乙 ¥200', 130), line('テスト商品丙 ¥300', 180), line('小計 ¥500', 230)], [{ box: box(20, 82, 200, 28), score: 0.2 }]);
  assert.equal(u.rangeKnown, true); assert.equal(u.places.length, 1); assert.deepEqual(p.items.map(x => x.name), ['テスト商品乙', 'テスト商品丙']);
  // A run on the store-name line (overlapping the header) is not an item-list place.
  ({ u } = areas([head, line('テスト商品乙 ¥200', 130), line('小計 ¥200', 230)], [{ box: box(150, 12, 80, 26), score: 0.3 }]));
  assert.equal(u.total, 0); assert.equal(u.places.length, 0);
  // No subtotal/total line: the range is not known (counted, the screen does not call it the item range).
  ({ u } = areas([head, line('テスト商品乙 ¥200', 130), line('テスト商品丙 ¥300', 180)], [{ box: box(20, 300, 200, 28), score: 0.2 }]));
  assert.equal(u.rangeKnown, false); assert.equal(u.places.length, 1);
  // No product read at all: range not known; runs are counted, none become products.
  ({ p, u } = areas([head, line('小計 ¥500', 230)], [{ box: box(20, 82, 200, 28), score: 0.2 }, { box: box(20, 130, 200, 28), score: 0.1, empty: true }]));
  assert.equal(p.items.length, 0); assert.equal(u.rangeKnown, false); assert.equal(u.places.length, 2);
  // A run on a line that is read but not shown with a picture (a discount line) is a place, not "in a row".
  ({ u } = areas([head, line('テスト商品乙 ¥200', 130), line('割引 -20', 180), line('テスト商品丙 ¥300', 230), line('小計 ¥480', 280)], [{ box: box(250, 182, 60, 26), score: 0.3 }]));
  assert.equal(u.inLine, 0); assert.equal(u.places.length, 1);
});

test('the printed item count is read in its common forms', () => {
  for (const [line, n] of [['お買上点数 9点', 9], ['小計/ 6点 ¥866', 6], ['小計 3点 ¥300', 3], ['買上点数 26点', 26], ['御買上げ点数 :15', 15], ['10点買', 10]]) assert.equal(S.printedCount(line), n, line);
  const r = parse('テスト商品A ¥100\nテスト商品B\n2コ X 単50 ¥100\n小計/ 3点 ¥200');
  assert.equal(r.countMatches, true);
});

test('header text and store codes are not products; department and tax codes leave the name', () => {
  const r = parse('テストストア 本町店\nTEL 000-000-0000\n2026年10月27日(火) 12:54 #000019\n責:セルフレジ\nお会計券 #000008 R2827 11:44\n外8 テスト高糖度トマト ¥238外\n13*テスト麺 あっさり味 ¥388\n0011テストバター 軽 ¥354\n0002 テスト鶏もも 大 ¥758※\n外8 テスト玉子 Lサイズ S001 ¥238外\nS001)Lサイズ特売 -50\n小計 ¥1,926');
  // Spaces between Japanese words are removed as before (receipts space-pad names).
  assert.deepEqual(r.items.map(x => x.raw), ['テスト高糖度トマト', 'テスト麺あっさり味', 'テストバター', 'テスト鶏もも大', 'テスト玉子 Lサイズ']);
  assert.equal(r.rejected.length, 0);
});

test('OCR quirks are tidied in names: Chinese forms of receipt words, voicing marks of half-width kana', () => {
  assert.equal(S.hw('2コX单68'), '2コX単68');
  assert.deepEqual(rows('テストプ*ラント*パン ¥980\nテストカ°ムハ°イ ¥399\n小计 ¥1,379'), [['テストブランドパン', 1], ['テストガムパイ', 1]]);
});

test('a generic name replaces the printed one only when the word is most of the name', () => {
  assert.deepEqual(rows('テスト玉子 Lサイズ ¥238\n小計 ¥238').map(r => r[0]), ['テスト玉子 Lサイズ']);
  // v49 audit: a printed size stays in the name (M and L eggs are different products); the generic name is
  // only used to look for the registered product.
  assert.deepEqual(rows('玉子 Lサイズ ¥238\n玉子 ¥228\nテスト玉子とハムのサンド ¥358\nテストバナナケーキミニ ¥128\nテスト麦茶2L ¥118\nバナナ ¥198\n小計 ¥1,268').map(r => r[0]),
    ['玉子 Lサイズ', '卵', 'テスト玉子とハムのサンド', 'テストバナナケーキミニ', 'テスト麦茶2L', 'バナナ']);
});

test('suggestions: the printed text, then the generic name; never a different size or amount', () => {
  const stock = [{ id: 1, name: '卵' }, { id: 2, name: '豚こま肉' }, { id: 3, name: 'テスト麦茶 2L' }];
  const pick = raw => { const it = R.parseReceipt(raw + ' ¥100\n小計 ¥100').items[0]; return Array.from(R.candidatesFor(it, stock, M), c => c.item.id); };
  assert.deepEqual(pick('玉子 Lサイズ'), [1]);
  assert.deepEqual(pick('テスト麦茶 650ml'), []);
  assert.deepEqual(pick('テスト麦茶650m|'), []); // OCR read the l of ml as |
  assert.deepEqual(pick('テスト麦茶2L'), [3]);
  assert.deepEqual(pick('テスト玉子とハムのサンド'), []);
});

test('OCR boxes on one printed line are joined left to right', () => {
  const box = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
  const lines = L.groupBoxes([
    { box: box(400, 102, 80, 30), text: '*108', score: 0.99 },
    { box: box(20, 100, 300, 32), text: 'テスト緑茶 600ml', score: 0.97 },
    { box: box(20, 150, 300, 32), text: 'テストスナック', score: 0.9 },
    { box: box(400, 149, 80, 30), text: '*233', score: 0.98 },
  ]);
  assert.deepEqual(lines.map(l => l.text), ['テスト緑茶 600ml *108', 'テストスナック *233']);
  assert.ok(lines.every(l => l.confidence >= 90));
});

test('v49 audit: general OCR repairs are flagged, never silent; separators and real words are kept', () => {
  const one = text => parse(text + '\n小計 ¥100').items[0];
  // A half-width voicing mark read as "・" between kana; a real separator after ル stays.
  let it = one('テストカ・ーテ・ンセット ¥100');
  assert.equal(it.name, 'テストガーデンセット');
  assert.ok(it.reasons.includes('濁点か半濁点か不確か') && !it.selected);
  assert.equal(one('テストル・ポワン 生地 ¥100').name, 'テストル・ポワン生地');
  // One hiragana letter inside a katakana word is flagged, not changed; particles are real words.
  it = one('テストクがーパン ¥100');
  assert.equal(it.name, 'テストクがーパン');
  assert.ok(it.reasons.includes('読み違いの可能性がある文字'));
  it = one('テストピーのスープ ¥100');
  assert.equal(it.name, 'テストピーのスープ');
  assert.equal(it.reasons.length, 0);
  // Katakana ニ between kanji; traditional 產; a code with ☆ before the name.
  assert.equal(one('山ニ屋 テストせんべい ¥100').name, '山二屋テストせんべい');
  assert.equal(one('外国產テストバナナ ¥100').name, '外国産テストバナナ');
  assert.equal(one('0008☆テスト野菜 ¥100').raw, 'テスト野菜');
  // "7" before katakana may be a misread ア: flagged, not changed ("7P" brand names stay as printed).
  it = one('7イテストソーダ ¥100');
  assert.equal(it.raw, '7イテストソーダ');
  assert.ok(it.reasons.includes('読み違いの可能性がある文字'));
  assert.equal(one('7Pテスト茶 600ml *108').reasons.length, 0);
});

test('v49 audit: a misread voicing mark still finds the registered product, sizes still block', () => {
  assert.deepEqual(M.candidates('テストプロック', [{ id: 1, name: 'テストブロック' }]).map(c => c.item.id), [1]);
  assert.deepEqual(M.candidates('ハナナ', [{ id: 1, name: 'バナナ' }]).map(c => c.item.id), [1]);
  assert.deepEqual(M.candidates('テスト麦茶 650ml', [{ id: 1, name: 'テスト麦茶 2L' }]), []);
});

test('P1 audit: learned texts match only with compatible capacity; unreadable capacity is not suggested', () => {
  const stock = [{ id: 1, name: 'テスト炭酸水 1L', receiptAliases: [M.lineKey('テスト炭酸水1L')] }];
  assert.equal(M.candidates('テスト炭酸水1L', stock)[0].learned, true);
  assert.deepEqual(M.candidates('テスト炭酸水レ', stock),[],
    'when a 1L label becomes unreadable, never offer or preselect that stock volume');
});


// A privately supplied grocery receipt established this *layout* only. Synthetic names,
// no real store identifiers, cashier names, photo, registration number, or receipt ID.
// The paper has 20 product rows but 22 purchased units (two separate '2個 x @price'
// sublines), an egg discount, 8%-tax footer, cash tender, and change.
test('v50 anonymized 20-line grocery receipt: 22 units, two quantity sublines, 50-yen discount, tax/payment never products', () => {
  const text = [
    '合成ストア（テスト専用）',
    '2026年10月04日(日) 12:54',
    'お会計券 #000005 R0001 12:53',
    '外8 テスト長ねぎ 緑テープ ¥98外',
    '外8 テストブロッコリー ¥236外',
    '(2個 x @118)',
    '外8 テスト小松菜 2個束 ¥158外',
    '外8 テストキャベツ ¥98外',
    '外8 テストきゅうり ¥168外',
    '外8 テスト長なす 黄色テープ ¥158外',
    '外8 テストミニトマト 黄色テープ ¥238外',
    '外8 テスト紅はるか 水色テープ ¥298外',
    '外8 テスト北海道たこ ¥420外',
    '外8 テスト生鮭 ¥530外',
    '外8 テストあさり ¥290外',
    '外8 テスト豚バラブロック ¥777外',
    '外8 テスト鶏むね肉 ¥599外',
    '外8 テスト鶏もも肉 ¥983外',
    '外8 テスト豚ひき肉 大 ¥584外',
    '外8 テストソーセージ ¥178外',
    '外8 テストミートボール2 ¥248外',
    '外8 テスト豆腐 ¥216外',
    '(2個 x @108)',
    '外8 テストヨーグルト プレミ ¥598外',
    '外8 テスト玉子M1 ¥238外',
    'P001)Mサイズ特売 -50',
    '小計 ¥7,063',
    '消費税8% 8% ¥565',
    '買上点数 22点',
    '合計 ¥7,628',
    'お預り ¥10,050',
    'お釣り ¥2,422',
    'ご来店ありがとうございました'
  ].join('\n');
  const structural = S.structure(text.split('\n'));
  const result = parse(text);
  assert.equal(result.date, '2026-10-04', 'receipt date is the purchase date, not a use-by date');
  assert.equal(structural.products.length, 20, 'product rows are not purchase units');
  assert.equal(result.items.length, 20, 'not a single printed code, discount, tax, or payment line becomes an item');
  assert.equal(result.countedQty, 22, 'two 2-unit items make 22 pieces');
  assert.equal(result.printedCount, 22);
  assert.equal(result.countMatches, true);
  assert.equal(result.boundary?.kind, 'subtotal');
  assert.deepEqual(
    result.items.filter(item => item.qty === 2).map(item => item.name).sort(),
    ['テストブロッコリー', 'テスト豆腐'].sort()
  );
  assert.equal(result.items.find(item => item.name.includes('小松菜'))?.qty, 1,
    '2個束 is a product descriptor, not two purchased bunches');
  assert.equal(result.items.find(item => item.name.includes('ミートボール2'))?.qty, 1,
    'a trailing model-size digit never changes purchase quantity');
  assert.equal(structural.products.reduce((sum,item) => sum + item.price, 0), 7113);
  const discount = S.priceTail('P001)Mサイズ特売 -50');
  assert.deepEqual({ value: discount?.value, negative: discount?.negative }, { value: 50, negative: true });
  assert.equal(7113 - discount.value, 7063, 'printed subtotal cross-check');
  assert.equal(Math.round(7063 * 0.08), 565, 'tax is a validation figure and not a stock item');
  assert.equal(7063 + 565, 7628, 'tender and change are never stock items');
  assert.ok(!result.items.some(x => /特売|小計|買上点数|預り|釣り|消費税/.test(x.name)));
  assert.ok(result.items.every(x => x.selected), 'synthetic clean lines are selectable only in review, not automatically saved');
});


test('v50 Muse P2: two-line product + explicit quantity/yen total appears for manual review, never auto-add', () => {
  const receipt='テストおむつ パンツ M 60枚\n1点 ¥1380\nテスト牛乳\n2点 ¥436\n小計 3点 ¥1816';
  const r=parse(receipt);
  assert.equal(r.items.length,2,'two product names with the total on the next line must not disappear');
  assert.deepEqual(r.items.map(x=>x.qty),[1,2]);
  assert.equal(r.countMatches,true);
  for(const x of r.items){
    assert.equal(x.selected,false,'uncertain split-layout rows must stay unchecked');
    assert.equal(x.low,true);
    assert.ok(x.reasons.includes('商品名と価格が別々の行です。内容と数量を確認してください'));
  }
  // Standard same-line receipts are still normal and selected as before.
  const standard=parse('テスト牛乳 ¥218\n小計 1点 ¥218');
  assert.equal(standard.items.length,1);
  assert.equal(standard.items[0].selected,true);
  // Orphan totals and misleading quantity-like summaries never auto-create stock rows.
  const orphan=S.structure(['1点 ¥288','小計 1点 ¥288']);
  assert.equal(orphan.products.length,0);
  assert.ok(orphan.rejected.some(x=>x.text==='1点 ¥288'));
  // A store heading can look like a product, but no split pair is trusted.
  const header=parse('テスト店\n1点 ¥288\n小計 1点 ¥288');
  assert.ok(header.items.every(x=>x.selected===false));
  // Plain price without an explicit yen sign does not qualify for this uncertain pattern.
  assert.equal(S.structure(['テスト牛乳','1点 288','小計 1点 ¥288']).products.length,0);
});


test('v50 Muse round 3: no-space 1点¥1,280 has a manual-review product, not a lost line',()=>{
 const r=parse('パンパーステープM\n1点¥1,280\n小計 1点 ¥1,280');
 assert.equal(r.items.length,1);
 assert.equal(r.items[0].qty,1);
 assert.equal(r.items[0].selected,false);
 assert.equal(r.items[0].low,true);
 assert.ok(r.items[0].reasons.includes('商品名と価格が別々の行です。内容と数量を確認してください'));
 // The price line must not turn into an independent product.
 assert.equal(r.items.filter(x=>/1点|1,280/.test(x.name)).length,0);
 const normal=parse('テスト牛乳 ¥218\n小計 1点 ¥218');
 assert.equal(normal.items.length,1);
 assert.equal(normal.items[0].selected,true);
});

test('v50 Muse round 3: a carton of 10 eggs is one purchase unless separate quantity is explicit',()=>{
 const packed=parse('タマゴ 10コ ¥258\n小計 1点 ¥258');
 assert.equal(packed.items.length,1);
 assert.equal(packed.items[0].qty,1,'10 eggs in a carton are not 10 cartons bought');
 assert.equal(packed.countMatches,true);
 // A true explicitly printed purchase quantity is still honored.
 const two=parse('タマゴ 10コ\n2コ X 単258 ¥516\n小計 2点 ¥516');
 assert.equal(two.items.length,1);
 assert.equal(two.items[0].qty,2,'a separate quantity × unit-price row still wins');
});

test('v50 real-receipt follow-up: warehouse-club names keep trailing pack-size numerals', () => {
  // Fictional items only. The following item-code line carries the price; the
  // number at the end of the preceding name is NOT a price or purchase quantity.
  const text=[
    'テスト衛生用品 100',
    '581695 1● 1,598 1,598 T',
    'CPN',
    'テスト衛生用品 100',
    '9322 1● 320 320-T',
    'テストヨーグルト 800',
    '585967 1● 658 658 E',
    '**** 合計 1,936',
    '御買上げ点数 : 2'
  ].join('\n');
  const st=S.structure(text.split('\n'));
  assert.deepEqual(st.products.map(x=>[x.text,x.qty]),[
    ['テスト衛生用品 100',1],
    ['テストヨーグルト 800',1],
  ]);
  const parsed=parse(text);
  assert.equal(parsed.items.length,2);
  assert.equal(parsed.items[0].qty,1);
  assert.equal(parsed.items[1].qty,1);
  assert.equal(parsed.printedCount,2);
  assert.ok(parsed.items.some(x=>/衛生用品\s*100/.test(x.name)),
    'the content amount stays in the candidate name');
  assert.ok(parsed.items.some(x=>/ヨーグルト\s*800/.test(x.raw)),
    'the amount stays in the printed raw name even when a generic display name is shown');
  assert.ok(!parsed.items.some(x=>/CPN|IRC/.test(x.name)));
  // Outside club receipts, terminal bare numerals retain existing price parsing.
  const normal=S.structure(['テスト商品 ¥200','小計 1点 ¥200']);
  assert.equal(normal.products[0].text,'テスト商品');
});

test('v50 holdout-format regression: a barcode after an unpriced line keeps a review-only product', () => {
  // Fictional receipt only. No private receipt images or item details are stored in GitHub.
  const r=parse([
    'テストストア',
    'テスト商品甲 ¥354',
    '0004 テスト食材 軽',
    '4580781733565',
    'テスト商品乙 ¥398',
    '小計 ¥1,106'
  ].join('\n'));
  assert.equal(r.items.length,3,'an OCR price omission must not silently drop a product name');
  assert.deepEqual(r.items.map(x=>x.qty),[1,1,1]);
  const fixed=r.items[1];
  assert.equal(fixed.selected,false,'a recovered unpriced item must not be preselected');
  assert.equal(fixed.low,true);
  assert.ok(fixed.reasons.some(x=>x.includes('商品コードは読めましたが価格・数量が不明')));
  assert.equal(r.items[0].selected,true);
  assert.equal(r.items[2].selected,true);
  // A store name followed by a barcode BEFORE any confirmed product is not a purchase.
  const head=parse('テスト店\n4901234567890\nテスト牛乳 ¥120\n小計 ¥120');
  assert.equal(head.items.length,1);
  // A coupon/barcode after the subtotal is never a purchase.
  const end=parse('テスト牛乳 ¥120\n小計 ¥120\nテスト割引\n4901234567890');
  assert.equal(end.items.length,1);
  // Bare no-price names not followed by a code remain excluded.
  const noCode=parse('テスト牛乳 ¥120\nテスト食材\nテスト豆腐 ¥130\n小計 ¥250');
  assert.equal(noCode.items.length,2);
});

test('P1: restaurant 3-cup price multiplication is purchase quantity, not a 1-item preselection', () => {
 for(const v of ['3杯×単価580 ¥1,740','3杯×単580¥1740','3 杯 × 単580 ¥1,740']){
  assert.equal(S.quantityLine(v)?.qty,3,v);
 }
 assert.equal(S.quantityLine('2名×単1,300 ¥2,600')?.qty,2);
 const r=parse('テスト生ビール\n3杯×単価580 ¥1,740\n小計 3点 ¥1,740');
 assert.equal(r.items.length,1);
 assert.equal(r.items[0].qty,3);
 assert.equal(r.countMatches,true);
 assert.equal(r.items[0].selected,true,'clear unit/total arithmetic is safe for ordinary rows');
 // If the OCR loses the amount, it cannot prove the quantity. Keep the row
 // visible but leave the quantity to manual correction and individual review.
 const uncertain=parse('テスト生ビール\n3杯×単価\n小計 3点 ¥1,740');
 assert.equal(uncertain.items.length,1);
 assert.equal(uncertain.items[0].selected,false);
 assert.equal(uncertain.items[0].low,true);
 assert.equal(uncertain.items[0].qty,1);
 assert.equal(uncertain.countMatches,false);
 assert.ok(uncertain.rejected.some(x=>/3杯/.test(x.text)));
 const inconsistent=parse('テスト生ビール\n3杯×単580 ¥1,160\n小計 2点 ¥1,160');
 assert.equal(inconsistent.items.length,1);
 assert.equal(inconsistent.items[0].qty,2);
 assert.equal(inconsistent.items[0].selected,false);
 assert.ok(inconsistent.items[0].reasons.some(x=>x.includes('印字数量と単価・金額が食い違います')));
 const inline=parse('テスト生ビール 3杯×単580 ¥1,740\n小計 3点 ¥1,740');
 assert.equal(inline.items.length,1);
 assert.equal(inline.items[0].qty,3);
 assert.equal(inline.items[0].selected,false,'an inline quantity hint must be reviewed before registration');
});

test('P2: payable membership fee is a purchase; tax amount labels do not become merchandise',()=>{
 const s=parse(['会員入会金 ¥750','テスト飲料 ¥200','税額 ¥16','8%課税対象金額 ¥200','小計 2点 ¥950'].join('\n'));
 assert.deepEqual(s.items.map(x=>x.name),['会員入会金','テスト飲料']);
 assert.equal(s.items.filter(x=>/税額|課税/.test(x.name)).length,0);
 const meta=parse('会員番号 00001234\nテスト飲料 ¥200\n小計 1点 ¥200');
 assert.equal(meta.items.length,1);
});
