// v38 receipt evaluation, part 2: the same synthetic receipts as TEXT (the "paste receipt text"
// path, or a perfect OCR). Separates the parser/matcher quality from the OCR quality. Fast; no OCR.
// Usage: node tests/receipt-eval/clean-text.cjs [count]
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { STOCK, HELD_OUT, receipts } = require('./dataset.cjs');
const match = require('../../atokore-live-v125/receipt-match-v38.js');

const ctx = { console, C: { 食料品: ['牛乳', '卵', '食パン', 'バナナ', 'キャベツ', 'ヨーグルト', '納豆'], 日用品: ['ティッシュ', '洗濯洗剤'] },
  document: { createElement: () => ({ style: {}, appendChild() {} }), head: { appendChild() {} }, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [] },
  localStorage: { getItem: () => null, setItem() {} }, URL: {}, Image: function Image() {}, today: () => '2026-10-21',
  showPremium() {}, openM() {}, closeM() {}, alert() {}, items: [], buys: [], save() {}, render() {}, go() {} };
ctx.window = ctx; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.resolve(__dirname, '../../atokore-live-v125/receipt.js'), 'utf8'), ctx);
const parse = ctx.__atokoreReceiptV125M.parseReceipt;

const count = Number(process.argv[2] || 24);
const t = { lines: 0, rows: 0, qty: 0, known: 0, knownTop: 0, knownIn: 0, wrongTop: 0, newWrong: 0, extra: 0, rejectedProducts: 0, dateOk: 0, subtotal: 0, receipts: 0 };
const misses = [];
for (const r of receipts(count)) {
  t.receipts++;
  const p = parse({ text: r.lines.join('\n') });
  if (p.stoppedAtSubtotal) t.subtotal++;
  if (p.date === r.lines[2].slice(0, 10).replace(/\//g, '-')) t.dateOk++;
  t.extra += Math.max(0, p.items.length - r.truth.length);
  r.truth.forEach((truth, i) => {
    t.lines++;
    const row = p.items[i];
    if (!row) { t.rejectedProducts++; return; }
    t.rows++;
    if (row.qty === truth.qty) t.qty++;
    const c = match.candidates(row.raw, STOCK), top = c[0]?.item.id ?? null;
    if (truth.stockId !== null) {
      t.known++;
      if (top === truth.stockId) t.knownTop++; else misses.push(`${truth.printed} → ${top === null ? '(なし)' : STOCK.find(s => s.id === top).name}`);
      if (c.some(x => x.item.id === truth.stockId)) t.knownIn++;
      if (top !== null && top !== truth.stockId) t.wrongTop++;
    } else if (top !== null) { t.newWrong++; misses.push(`${truth.printed}（新商品）→ ${STOCK.find(s => s.id === top).name}`); }
  });
}
const pct = (a, b) => +(a / (b || 1)).toFixed(3);
console.log(JSON.stringify({
  receipts: t.receipts, productLines: t.lines, rowRecall: pct(t.rows, t.lines), qtyCorrect: pct(t.qty, t.rows),
  knownTopCorrect: pct(t.knownTop, t.known), knownInCandidates: pct(t.knownIn, t.known), wrongStockSuggestedTop: t.wrongTop,
  newProductsWithWrongSuggestion: t.newWrong, extraRows: t.extra, purchaseDateCorrect: pct(t.dateOk, t.receipts), subtotalStop: t.subtotal,
  distinctMisses: [...new Set(misses)],
}, null, 1));

// Held-out names, one per line on a receipt, through the same parser.
const h = { lines: 0, rows: 0, known: 0, knownTop: 0, wrongTop: 0, newWrong: 0, misses: [] };
const held = parse({ text: ['イオン', '2026/10/21', ...HELD_OUT.map(([n]) => `1100軽 ${n} ¥398`), '小計 ¥1'].join('\n') });
HELD_OUT.forEach(([printed, stockId]) => {
  h.lines++;
  const row = held.items.find(x => x.source.normalize('NFKC').includes(printed.normalize('NFKC')));
  if (!row) { h.misses.push(printed + '（行なし）'); return; }
  h.rows++;
  const top = match.candidates(row.raw, STOCK)[0]?.item.id ?? null, name = id => STOCK.find(s => s.id === id).name;
  if (stockId !== null) { h.known++; if (top === stockId) h.knownTop++; else { if (top !== null) h.wrongTop++; h.misses.push(`${printed} → ${top === null ? '(なし)' : name(top)}`); } }
  else if (top !== null) { h.newWrong++; h.misses.push(`${printed}（新商品）→ ${name(top)}`); }
});
console.log(JSON.stringify({ heldOut: { lines: h.lines, rowRecall: pct(h.rows, h.lines), knownTopCorrect: pct(h.knownTop, h.known), known: h.known,
  wrongStockSuggestedTop: h.wrongTop, newProductsWithWrongSuggestion: h.newWrong, misses: h.misses } }, null, 1));
