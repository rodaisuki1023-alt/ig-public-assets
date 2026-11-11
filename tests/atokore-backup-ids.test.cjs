// Synthetic backups only. DOM tests exercise the real file-change/parse/restore path in JSDOM.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const source = path.resolve(__dirname, '../atokore-live-v125/data-safety-v19.js');
const { parseBackup } = require(source);
const row = (id, name = 'テスト商品') => ({ id, name, qty: 1, unit: '個' });
const routine = id => ({ id, name: 'テストセット', items: [row(1)] });
const empty = () => ({ items: [], buys: [], routines: [] });

test('duplicate IDs are refused within each top-level list, including numeric-string aliases', () => {
  for (const key of ['items', 'buys', 'routines']) {
    for (const second of [7, '7', '07', '7.0']) {
      const state = empty(), make = key === 'routines' ? routine : row;
      state[key] = [make(7), make(second)];
      assert.throws(() => parseBackup(JSON.stringify({ app: 'atokore', format: 2, data: state })), /同じID/);
    }
  }
});

test('unique IDs preserve rows, references and photos; the same ID across lists is legitimate', () => {
  const state = { items: [row(7), row(8)], buys: [{ ...row(7), stockId: 7 }], routines: [routine(7), routine(8)] };
  const photos = [{ id: '7', marker: 'synthetic' }];
  const result = parseBackup(JSON.stringify({ app: 'atokore', data: state, photos }));
  assert.deepEqual(result.state, state);
  assert.deepEqual(result.photos, photos);
  assert.equal(result.dropped, 0);
  assert.deepEqual(parseBackup(JSON.stringify(state)).state, state, 'legacy plain backups remain supported');
});

test('existing handling of invalid rows remains explicit, with valid rows retained', () => {
  const state = { ...empty(), items: [row(1), { id: 2, qty: 1 }] };
  const result = parseBackup(JSON.stringify(state));
  assert.deepEqual(result.state.items, [row(1)]);
  assert.equal(result.dropped, 1);
});

function screen(t) {
  const dom = new JSDOM('<body><section id="pg-premium"><div class="section"></div></section><div id="sheet"></div></body>', { url: 'https://example.invalid/', runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  const w = dom.window;
  const initial = { ...empty(), items: [row(11, 'テスト保存済み')] };
  w.eval('var items = [], buys = [], routines = [];');
  w.items = initial.items; w.buys = initial.buys; w.routines = initial.routines;
  w.localStorage.setItem('atokoreTrialV4', JSON.stringify(initial));
  w.localStorage.setItem('atokoreTrialV4BeforeRestore', 'previous undo sentinel');
  w.localStorage.setItem('atokoreHistoryV1', '[{"title":"テスト既存履歴"}]');
  const calls = { confirm: 0, photos: 0, render: 0 };
  w.AtokoreConfirm = { ask: async () => { calls.confirm++; return true; } };
  w.AtokoreProductPhotos = { parsePhotos: x => x, replaceAll: async () => { calls.photos++; } };
  w.render = () => { calls.render++; };
  w.eval(fs.readFileSync(source, 'utf8'));
  const snapshot = () => Object.fromEntries(Object.keys(w.localStorage).map(k => [k, w.localStorage.getItem(k)]));
  async function choose(state) {
    w.atkOpenBackup();
    const input = w.document.querySelector('.atk-backup-file');
    const text = JSON.stringify({ app: 'atokore', data: state });
    Object.defineProperty(input, 'files', { value: [{ size: text.length, text: async () => text }] });
    input.dispatchEvent(new w.Event('change'));
    await new Promise(resolve => setImmediate(resolve));
  }
  return { w, initial, calls, snapshot, choose };
}

test('a duplicate-ID file is rejected before confirmation and leaves state, undo, history and photos untouched', async t => {
  const s = screen(t), before = s.snapshot();
  await s.choose({ ...empty(), items: [row(7, 'テスト甲'), row('7', 'テスト乙')] });
  assert.match(s.w.document.querySelector('.atk-backup-status').textContent, /同じID/);
  assert.deepEqual(s.calls, { confirm: 0, photos: 0, render: 0 });
  assert.deepEqual(s.snapshot(), before);
  assert.deepEqual(JSON.parse(s.w.JSON.stringify({ items: s.w.items, buys: s.w.buys, routines: s.w.routines })), s.initial);
});

test('a valid file still reaches confirmation and restore', async t => {
  const s = screen(t), next = { ...empty(), items: [row(7), row(8)] };
  await s.choose(next);
  assert.deepEqual(s.calls, { confirm: 1, photos: 1, render: 2 });
  assert.deepEqual(JSON.parse(s.w.localStorage.getItem('atokoreTrialV4')), next);
});
