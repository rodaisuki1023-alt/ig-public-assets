const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

class FakeClassList {
  constructor() { this.values = new Set(); }
  add(...names) { names.forEach(name => this.values.add(name)); }
  remove(...names) { names.forEach(name => this.values.delete(name)); }
  toggle(name, force) {
    const on = force === undefined ? !this.values.has(name) : Boolean(force);
    if (on) this.values.add(name); else this.values.delete(name);
    return on;
  }
  contains(name) { return this.values.has(name); }
}

class FakeElement {
  constructor(id = '') {
    this.id = id;
    this.value = '';
    this.checked = false;
    this.textContent = '';
    this.innerHTML = '';
    this.style = {};
    this.dataset = {};
    this.classList = new FakeClassList();
  }
  appendChild() {}
  before() {}
  addEventListener() {}
  setAttribute() {}
  remove() {}
  closest() { return null; }
  querySelector() { return null; }
}

const elements = new Map();
for (const id of [
  'stockSearch', 'catChips', 'stockSelectToggle', 'stockBulkActions', 'stockBulkMove',
  'stockBulkDelete', 'stockList', 'buyList', 'buyName', 'pg-home', 'pg-stock',
  'pg-add', 'pg-buy', 'pg-premium',
]) elements.set(id, new FakeElement(id));

const pages = ['home', 'stock', 'add', 'buy', 'premium'].map(name => elements.get(`pg-${name}`));
pages[0].classList.add('on');
const tabs = ['home', 'stock', 'add', 'buy', 'premium'].map(name => {
  const tab = new FakeElement(`tab-${name}`);
  tab.dataset.p = name;
  if (name === 'home') tab.classList.add('on');
  return tab;
});
const badge = new FakeElement('badge');
let stockBoxes = [];
let buyBoxes = [];

const document = {
  head: new FakeElement('head'),
  body: new FakeElement('body'),
  createElement: () => new FakeElement(),
  getElementById: id => elements.get(id) || null,
  querySelector(selector) {
    if (selector === '.badge') return badge;
    return null;
  },
  querySelectorAll(selector) {
    if (selector === '.page') return pages;
    if (selector === '.tab') return tabs;
    if (selector.includes('input.stockPickV125g')) return stockBoxes;
    if (selector.includes('input.buyCheck')) return buyBoxes;
    return [];
  },
};

const storage = new Map();
let saveCalls = 0;
let homeRenders = 0;
let routineRenders = 0;
const alerts = [];

const context = {
  console,
  document,
  localStorage: {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, String(value)),
  },
  items: [
    { id: 1, name: '牛乳', cat: '食料品', qty: 1, unit: '本', place: '冷蔵庫', expType: '期限なし', exp: '' },
    { id: 2, name: 'オムツ', cat: 'ベビー', qty: 2, unit: '袋', place: '収納', expType: '期限なし', exp: '' },
    { id: 3, name: '卵', cat: '食料品', qty: 6, unit: '個', place: '冷蔵庫', expType: '期限なし', exp: '' },
  ],
  buys: [{ id: 101, name: 'シャンプー', cat: '日用品', qty: 1, unit: '本' }],
  routines: [],
  stockSelected: new Set(),
  stockSelectMode: false,
  filter: 'すべて',
  C: { 食料品: ['牛乳', '卵'], ベビー: ['オムツ'], 日用品: ['シャンプー', '洗剤'] },
  days: () => 999,
  unitOf: name => (/牛乳|洗剤|シャンプー/.test(name) ? '本' : '個'),
  save: () => { saveCalls += 1; },
  renderHome: () => { homeRenders += 1; },
  renderRoutines: () => { routineRenders += 1; },
  renderCatalog: () => {},
  alert: message => alerts.push(String(message)),
  confirm: () => true,
  setTimeout: () => 1,
  clearTimeout: () => {},
};
context.registerItem = () => {
  context.items.push({ id: 9, name: 'ティッシュ', cat: '日用品', qty: 1, unit: '箱' });
  context.save();
  context.alert('登録しました');
  context.go('stock');
};
context.createRoutine = () => context.alert('リスト名を入力してください');
context.window = context;
context.globalThis = context;
vm.createContext(context);

const source = fs.readFileSync(path.join(__dirname, '..', 'atokore-live-v125', 'stability.js'), 'utf8');
vm.runInContext(source, context, { filename: 'stability.js' });

assert.equal(context.__atokoreActionOwner, 'stability-v125g');
assert.equal(badge.textContent, '試用版 v12.5g');

context.registerItem();
assert.ok(context.items.some(item => item.id === 9));
assert.equal(alerts.length, 0, '成功通知は描画を止める alert にしないこと');
context.createRoutine();
assert.deepEqual(alerts, ['リスト名を入力してください'], '入力エラーは alert のまま伝えること');
alerts.length = 0;

elements.get('buyName').value = '洗剤';
context.addBuy();
assert.ok(context.buys.some(item => item.name === '洗剤'));
assert.equal(elements.get('buyName').value, '');

context.stockSelectMode = true;
stockBoxes = [
  { value: '1', checked: true },
  { value: '2', checked: true },
  { value: '3', checked: false },
];
context.moveSelectedToBuy();
assert.ok(context.buys.some(item => item.stockId === 1));
assert.ok(context.buys.some(item => item.stockId === 2));
assert.equal(context.stockSelectMode, false);
assert.ok(elements.get('pg-buy').classList.contains('on'), '在庫→買い物後に買い物画面へ切り替わること');

const milkBuy = context.buys.find(item => item.stockId === 1);
buyBoxes = context.buys.map(item => ({ value: String(item.id), checked: item.id === milkBuy.id }));
context.bought();
assert.equal(context.items.find(item => item.id === 1).qty, 2);
assert.ok(!context.buys.some(item => item.id === milkBuy.id));
assert.ok(elements.get('pg-stock').classList.contains('on'), '買い物→在庫後に在庫画面へ切り替わること');

const shampoo = context.buys.find(item => item.id === 101);
buyBoxes = context.buys.map(item => ({ value: String(item.id), checked: item.id === shampoo.id }));
context.deleteSelectedBuy();
assert.ok(!context.buys.some(item => item.id === 101));

context.stockSelectMode = true;
stockBoxes = context.items.map(item => ({ value: String(item.id), checked: item.id === 2 }));
context.deleteSelectedStock();
assert.ok(!context.items.some(item => item.id === 2));
assert.equal(context.stockSelectMode, false);

const eggBefore = context.items.find(item => item.id === 3).qty;
context.adj(3, 1);
assert.equal(context.items.find(item => item.id === 3).qty, eggBefore + 1);

context.premiumBuy(3);
assert.ok(context.buys.some(item => item.stockId === 3));

assert.ok(saveCalls >= 7, 'すべての変更操作で保存されること');
assert.ok(homeRenders >= 7, '操作直後にホーム表示も更新されること');
assert.ok(routineRenders >= 7, '操作直後に関連表示が同期されること');
assert.equal(alerts.length, 0);

console.log('Atokore action integration: all tests passed');
