// The packing checklist is a separate, local-only trial feature. All inputs use synthetic data.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const base = path.resolve(__dirname, '../atokore-live-v125');
const html = fs.readFileSync(path.join(base, 'index.html'), 'utf8');
const source = fs.readFileSync(path.join(base, 'packing-checklist-v50.js'), 'utf8');
function open(url = 'https://example.invalid/ig-public-assets/preview-baby-v19/', saved = {}) {
  const dom = new JSDOM(html, { url, runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  for (const [k, v] of Object.entries(saved)) w.localStorage.setItem(k, v);
  w.AtokoreConfirm = { ask: async () => true };
  w.eval(source);
  const $ = sel => w.document.querySelector(sel);
  return { dom, w, $ };
}
function click(w, el) { el.dispatchEvent(new w.MouseEvent('click', { bubbles: true })); }
function change(w, el) { el.dispatchEvent(new w.Event('change', { bubbles: true })); }
const nextTick = () => new Promise(resolve => setImmediate(resolve));

test('first launch shows two unsaved templates, and no fictional stock or purchase', () => {
  const { dom, w, $ } = open();
  assert.equal($('#atkPackRows').children.length, 6);
  assert.match($('#atkPackProgress').textContent, /0\/6/);
  assert.equal(w.localStorage.length, 0, 'viewing template must not create saved data');
  assert.equal(w.localStorage.getItem('atokoreTrialV4'), null);
  assert.equal(w.localStorage.getItem('atokorePreviewTrialV19'), null);
  dom.window.close();
});

test('check one item, reload with saved data, preserve done state without touching inventory', () => {
  const stock = JSON.stringify({ items: [{ id: 1, name: 'おむつ', qty: 2 }], buys: [], routines: [] });
  const a = open(undefined, { atokorePreviewTrialV19: stock });
  const checkbox = a.$('#atkPackRows input[type=checkbox]');
  checkbox.checked = true; change(a.w, checkbox);
  const key = a.w.AtokorePackingChecklist.key;
  const saved = a.w.localStorage.getItem(key);
  assert.ok(saved);
  assert.match(a.$('#atkPackProgress').textContent, /1\/6/);
  assert.equal(a.w.localStorage.getItem('atokorePreviewTrialV19'), stock);
  a.dom.window.close();
  const b = open(undefined, { [key]: saved, atokorePreviewTrialV19: stock });
  assert.equal(b.$('#atkPackRows input[type=checkbox]').checked, true);
  assert.equal(b.w.localStorage.getItem('atokorePreviewTrialV19'), stock);
  b.dom.window.close();
});

test('daycare and outing have independent items and progress, reset only chosen checkboxes', async () => {
  const { dom, w, $ } = open();
  const first = $('#atkPackRows input[type=checkbox]');
  first.checked = true; change(w, first);
  click(w, $('[data-pack=outing]'));
  assert.match($('#atkPackProgress').textContent, /お出かけセット：0\/6/);
  assert.equal($('#atkPackRows input[type=checkbox]').checked, false);
  const outing = $('#atkPackRows input[type=checkbox]');
  outing.checked = true; change(w, outing);
  click(w, $('#atkPackReset')); await nextTick();
  assert.match($('#atkPackProgress').textContent, /お出かけセット：0\/6/);
  click(w, $('[data-pack=daycare]'));
  assert.match($('#atkPackProgress').textContent, /保育園セット：1\/6/);
  dom.window.close();
});

test('custom entries are plain text, may be removed only after in-app confirmation', async () => {
  const { dom, w, $ } = open();
  const payload = '<img src=x onerror=alert(1)>';
  $('#atkPackAddInput').value = payload;
  click(w, $('#atkPackAddButton'));
  assert.equal($('#atkPackRows').children.length, 7);
  assert.equal($('#atkPackRows img'), null, 'no HTML injection');
  assert.ok($('#atkPackRows').textContent.includes(payload));
  let accepted = false;
  w.AtokoreConfirm.ask = async () => accepted;
  click(w, $('#atkPackRows .atk-pack-row:last-child .atk-pack-remove')); await nextTick();
  assert.equal($('#atkPackRows').children.length, 7);
  accepted = true;
  click(w, $('#atkPackRows .atk-pack-row:last-child .atk-pack-remove')); await nextTick();
  assert.equal($('#atkPackRows').children.length, 6);
  dom.window.close();
});

test('quota failure leaves saved bytes and visible checkbox unchanged', () => {
  const { dom, w, $ } = open();
  const key = w.AtokorePackingChecklist.key;
  const raw = w.localStorage.getItem(key);
  const original = w.Storage.prototype.setItem;
  w.Storage.prototype.setItem = function () { throw new Error('QuotaExceededError'); };
  try {
    const box = $('#atkPackRows input[type=checkbox]');
    box.checked = true; change(w, box);
    assert.equal(w.localStorage.getItem(key), raw);
    assert.equal($('#atkPackRows input[type=checkbox]').checked, false);
    assert.match($('#atkPackError').textContent, /保存できませんでした/);
  } finally { w.Storage.prototype.setItem = original; dom.window.close(); }
});

test('corrupt previous checklist refuses all writes and keeps original bytes', () => {
  const url = 'https://example.invalid/ig-public-assets/preview-baby-v19/';
  const key = 'atokorePackingChecklistV1:/ig-public-assets/preview-baby-v19/';
  const { dom, w, $ } = open(url, { [key]: '{broken json' });
  assert.equal(w.AtokorePackingChecklist.status().locked, true);
  assert.equal($('#atkPackAddButton').disabled, true);
  assert.equal($('#atkPackRows input[type=checkbox]').disabled, true);
  assert.equal(w.localStorage.getItem(key), '{broken json');
  assert.match($('#atkPackError').textContent, /変更を停止/);
  dom.window.close();
});

test('production, v19 and other previews have distinct storage keys', () => {
  const urls = ['/ig-public-assets/', '/ig-public-assets/preview-baby-v19/', '/ig-public-assets/preview-baby-v17/'];
  const keys = urls.map(p => {
    const t = open('https://example.invalid' + p);
    const key = t.w.AtokorePackingChecklist.key;
    t.dom.window.close();
    return key;
  });
  assert.equal(new Set(keys).size, 3);
  assert.ok(keys[1].includes('preview-baby-v19'));
});

test('CSS, script and service-worker shell reference the same files', () => {
  const sw = fs.readFileSync(path.join(base, 'service-worker.js'), 'utf8');
  assert.match(html, /packing-checklist-v50\.js\?v=50/);
  assert.match(html, /packing-checklist-v50\.css\?v=50/);
  assert.ok(sw.includes("'./packing-checklist-v50.js'"));
  assert.ok(sw.includes("'./packing-checklist-v50.css'"));
  assert.ok(fs.statSync(path.join(base, 'packing-checklist-v50.css')).size > 200);
});

test('confirmation opened in daycare cannot remove or reset an item after switching to outing', async () => {
  const { dom, w, $ } = open();
  const check = $('#atkPackRows input[type=checkbox]');
  check.checked = true; change(w, check);
  let complete;
  w.AtokoreConfirm.ask = () => new Promise(resolve => { complete = resolve; });
  click(w, $('#atkPackReset'));
  click(w, $('[data-pack=outing]'));
  complete(true); await nextTick();
  click(w, $('[data-pack=daycare]'));
  assert.match($('#atkPackProgress').textContent, /保育園セット：1\/6/);

  click(w, $('#atkPackRows .atk-pack-remove'));
  click(w, $('[data-pack=outing]'));
  complete(true); await nextTick();
  assert.equal($('#atkPackRows').children.length, 6);
  click(w, $('[data-pack=daycare]'));
  assert.equal($('#atkPackRows').children.length, 6);
  dom.window.close();
});

test('stale tab cannot overwrite a newer checklist saved by a second tab', () => {
  const { dom, w, $ } = open();
  const key = w.AtokorePackingChecklist.key;
  const latest = {
    version: 1, active: 'daycare',
    lists: {
      daycare: [{ id: 'daycare-0', name: '連絡帳', done: true }],
      outing: [{ id: 'outing-0', name: 'おむつ', done: false }]
    }
  };
  const raw = JSON.stringify(latest);
  // Emulates a different tab writing the shared same-origin localStorage key.
  w.localStorage.setItem(key, raw);
  const checkbox = $('#atkPackRows input[type=checkbox]');
  checkbox.checked = true; change(w, checkbox);
  assert.equal(w.localStorage.getItem(key), raw, 'must not stomp the external write');
  assert.equal($('#atkPackRows').children.length, 1, 'reload latest data instead');
  assert.match($('#atkPackError').textContent, /別のタブ/);
  assert.equal(w.AtokorePackingChecklist.status().locked, false);
  // A deliberate retry after seeing current data may now save safely.
  const current = $('#atkPackRows input[type=checkbox]');
  current.checked = false; change(w, current);
  assert.equal(JSON.parse(w.localStorage.getItem(key)).lists.daycare[0].done, false);
  dom.window.close();
});

test('external deletion or corrupt update locks editor without resurrecting old data', () => {
  const { dom, w, $ } = open();
  const key = w.AtokorePackingChecklist.key;
  const first = $('#atkPackRows input[type=checkbox]');
  first.checked = true; change(w, first);
  w.localStorage.removeItem(key); // another tab removed the checklist
  const second = $('#atkPackRows input[type=checkbox]');
  second.checked = false; change(w, second);
  assert.equal(w.localStorage.getItem(key), null);
  assert.equal(w.AtokorePackingChecklist.status().locked, true);
  assert.match($('#atkPackError').textContent, /別のタブでチェックリストが削除/);
  dom.window.close();
});

test('storage event refreshes a changed checklist in a second tab', () => {
  const { dom, w, $ } = open();
  const key = w.AtokorePackingChecklist.key;
  const state = {
    version: 1, active: 'outing',
    lists: {
      daycare: [{ id: 'daycare-0', name: '連絡帳', done: false }],
      outing: [{ id: 'outing-0', name: '水筒', done: true }]
    }
  };
  const raw = JSON.stringify(state);
  w.localStorage.setItem(key, raw);
  w.dispatchEvent(new w.StorageEvent('storage', { key, newValue: raw, storageArea: w.localStorage }));
  assert.match($('#atkPackProgress').textContent, /お出かけセット：1\/1/);
  assert.equal($('#atkPackRows input[type=checkbox]').checked, true);
  assert.equal(w.localStorage.getItem(key), raw);
  dom.window.close();
});

test('invalid active template cannot select inherited object properties', () => {
  const url='https://example.invalid/ig-public-assets/preview-baby-v19/';
  const key='atokorePackingChecklistV1:/ig-public-assets/preview-baby-v19/';
  const source={ version:1, active:'constructor', lists: { daycare:[], outing:[] } };
  const raw=JSON.stringify(source);
  const { dom, w, $ }=open(url,{ [key]:raw });
  assert.equal(w.AtokorePackingChecklist.status().locked,true);
  assert.equal(w.localStorage.getItem(key),raw);
  assert.equal($('#atkPackAddButton').disabled,true);
  dom.window.close();
});

test('deletion confirmation cannot delete another tab newer item with a reused id', async () => {
  const { dom, w, $ } = open();
  const key = w.AtokorePackingChecklist.key;
  let answer;
  w.AtokoreConfirm.ask = () => new Promise(resolve => { answer = resolve; });
  click(w, $('#atkPackRows .atk-pack-remove'));
  const newer = {
    version: 1, active: 'daycare',
    lists: {
      daycare: [{ id: 'daycare-0', name: '新しい連絡帳', done: true }],
      outing: [{ id: 'outing-0', name: 'おむつ', done: false }]
    }
  };
  const raw = JSON.stringify(newer);
  w.localStorage.setItem(key, raw);
  w.dispatchEvent(new w.StorageEvent('storage', { key, newValue: raw, storageArea: w.localStorage }));
  answer(true);
  await nextTick();
  assert.equal(w.localStorage.getItem(key), raw, 'older confirmation must not delete new data');
  assert.match($('#atkPackRows').textContent, /新しい連絡帳/);
  dom.window.close();
});

test('reset confirmation cannot erase another tab newer checks', async () => {
  const { dom, w, $ } = open();
  const key = w.AtokorePackingChecklist.key;
  const first = $('#atkPackRows input[type=checkbox]');
  first.checked = true;
  change(w, first);
  let answer;
  w.AtokoreConfirm.ask = () => new Promise(resolve => { answer = resolve; });
  click(w, $('#atkPackReset'));
  const newer = JSON.parse(w.localStorage.getItem(key));
  newer.lists.daycare[1].done = true;
  const raw = JSON.stringify(newer);
  w.localStorage.setItem(key, raw);
  w.dispatchEvent(new w.StorageEvent('storage', { key, newValue: raw, storageArea: w.localStorage }));
  answer(true);
  await nextTick();
  assert.equal(w.localStorage.getItem(key), raw, 'stale reset must not erase a new check');
  assert.match($('#atkPackProgress').textContent, /保育園セット：2\/6/);
  dom.window.close();
});
