// Loads the app's receipt parser (receipt.js with the v49 structure stage) outside the browser, the same
// way for every evaluation tool. RECEIPT_JS / STRUCTURE_JS may point at another version to compare.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const APP = path.resolve(__dirname, '../../atokore-live-v125');
function loadReceipt({ receiptJs = process.env.RECEIPT_JS || path.join(APP, 'receipt.js'), structureJs = process.env.STRUCTURE_JS || path.join(APP, 'receipt-structure-v49.js'), today = '2026-11-01' } = {}) {
  const ctx = { console, C: { 食料品: ['牛乳', '卵', '食パン', 'バナナ', 'キャベツ', 'ヨーグルト', '納豆'], 日用品: ['ティッシュ', '洗濯洗剤'] },
    document: { createElement: () => ({ textContent: '', style: {}, appendChild() {} }), head: { appendChild() {} }, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [] },
    localStorage: { getItem: () => null, setItem() {} }, URL: { createObjectURL: () => '', revokeObjectURL() {} }, Image: function Image() {},
    today: () => today, AtokoreDates: { localDate: () => today }, showPremium() {}, openM() {}, closeM() {}, alert() {}, items: [], buys: [], save() {}, render() {}, go() {} };
  if (fs.existsSync(structureJs)) { delete require.cache[path.resolve(structureJs)]; ctx.AtokoreReceiptStructure = require(path.resolve(structureJs)); }
  ctx.window = ctx; vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.resolve(receiptJs), 'utf8'), ctx, { filename: 'receipt.js' });
  const api = ctx.__atokoreReceiptV125M;
  if (!api || typeof api.parseReceipt !== 'function') throw Error('receipt.js did not expose its parser');
  return api;
}
module.exports = { loadReceipt, APP };
