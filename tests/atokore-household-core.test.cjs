// Pure household sync logic: saved-state differences → operations, and server state + pending
// operations → local state. No network or browser.
const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../atokore-live-v125/household-core-v37.js');

const it = (id, name, qty, unit = '袋') => ({ id, name, cat: 'ベビー', unit, qty });
const strip = ops => ops.map(({ op_id, ts, ...o }) => o);

test('quantity changes become deltas, other edits become per-field sets, removals become deletes', () => {
  const prev = { items: [it(1, 'パンパース テープ M', 3), it(2, '明治 ほほえみ 缶', 1, '缶')], buys: [], routines: [] };
  const next = { items: [{ ...it(1, 'パンパース テープ M', 2), memo: '夜用' }], buys: [], routines: [] };
  const { ops } = core.diff(prev, next, { 'item:1': 'item-aaaaaaaa', 'item:2': 'item-bbbbbbbb' });
  assert.deepEqual(strip(ops), [
    { type: 'add', kind: 'item', id: 'item-aaaaaaaa', delta: -1 },
    { type: 'set', kind: 'item', id: 'item-aaaaaaaa', field: 'memo', value: '夜用' },
    { type: 'delete', kind: 'item', id: 'item-bbbbbbbb' },
  ]);
  assert.ok(ops.every(o => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(o.op_id)));
});

test('a shopping row bought into stock becomes one purchase operation, matched by exact name and unit', () => {
  const prev = { items: [it(1, 'メリーズ パンツ L', 1)], buys: [{ id: 9, name: 'メリーズ パンツ L', unit: '袋', qty: 2 }, { id: 10, name: '和光堂 おかゆ', unit: '個', qty: 3 }], routines: [] };
  const next = { items: [it(1, 'メリーズ パンツ L', 3), { id: 11, name: '和光堂 おかゆ', cat: '離乳食', unit: '個', qty: 3 }], buys: [], routines: [] };
  const map = { 'item:1': 'item-llllllll', 'buy:9': 'buy-99999999', 'buy:10': 'buy-10101010' };
  const { ops, map: m } = core.diff(prev, next, map);
  assert.deepEqual(strip(ops), [
    { type: 'complete_buy', buy: 'buy-99999999', item: 'item-llllllll', delta: 2 },
    { type: 'complete_buy', buy: 'buy-10101010', item: m['item:11'], delta: 3, item_fields: { name: '和光堂 おかゆ', cat: '離乳食', unit: '個' } },
  ]);
  // A different size is not the same product: no purchase link, plain delete + add.
  const sized = core.diff({ items: [it(1, 'メリーズ パンツ L', 1)], buys: [{ id: 9, name: 'メリーズ パンツ M', unit: '袋', qty: 1 }], routines: [] },
    { items: [it(1, 'メリーズ パンツ L', 2)], buys: [], routines: [] }, map);
  assert.deepEqual(strip(sized.ops).map(o => o.type), ['add', 'delete']);
});

test('local state is rebuilt from server records plus pending operations; tombstones stay deleted', () => {
  const base = { 'item:item-aaaaaaaa': { kind: 'item', id: 'item-aaaaaaaa', fields: { name: 'A', unit: '袋' }, qty: 1, deleted: false },
    'item:item-dddddddd': { kind: 'item', id: 'item-dddddddd', fields: { name: 'D', unit: '袋' }, qty: 4, deleted: true } };
  const view = core.rebase(base, [
    { type: 'add', kind: 'item', id: 'item-aaaaaaaa', delta: -3 },
    { type: 'add', kind: 'item', id: 'item-dddddddd', delta: 1 },
    { type: 'set', kind: 'item', id: 'item-dddddddd', field: 'name', value: 'D2' },
    { type: 'create', kind: 'item', id: 'item-nnnnnnnn', fields: { name: 'N', unit: '個' }, qty: 2 },
  ]);
  assert.equal(view['item:item-aaaaaaaa'].qty, 0);
  assert.equal(view['item:item-dddddddd'].deleted, true);
  assert.equal(view['item:item-dddddddd'].fields.name, 'D');
  assert.equal(view['item:item-nnnnnnnn'].qty, 2);
});

test('records new to this device get ids from a separate band; existing ids and order are kept', () => {
  const prev = { items: [it(1700000000000, 'B', 1), it(5, 'A', 1)], buys: [], routines: [] };
  const map = { 'item:1700000000000': 'item-bbbbbbbb', 'item:5': 'item-aaaaaaaa' };
  const view = {
    'item:item-aaaaaaaa': { kind: 'item', id: 'item-aaaaaaaa', fields: { name: 'A' }, qty: 2 },
    'item:item-cccccccc': { kind: 'item', id: 'item-cccccccc', fields: { name: 'C' }, qty: 1 },
    'item:item-bbbbbbbb': { kind: 'item', id: 'item-bbbbbbbb', fields: { name: 'B' }, qty: 1 },
  };
  const { state, map: m } = core.materialize(view, map, prev);
  assert.deepEqual(state.items.map(x => x.name), ['B', 'A', 'C']);
  assert.deepEqual(state.items.slice(0, 2).map(x => x.id), [1700000000000, 5]);
  const c = state.items[2].id;
  assert.ok(Number.isSafeInteger(c) && c > 7e15, 'outside the ids the app makes from Date.now()');
  assert.equal(m['item:' + c], 'item-cccccccc');
  // Removed on the server: gone locally and its mapping forgotten.
  const again = core.materialize({ 'item:item-aaaaaaaa': view['item:item-aaaaaaaa'] }, m, state);
  assert.deepEqual(again.state.items.map(x => x.name), ['A']);
  assert.deepEqual(Object.values(again.map), ['item-aaaaaaaa']);
});

test('same product offers after joining require exact name, unit and category', () => {
  const view = { 'item:item-aaaaaaaa': { kind: 'item', id: 'item-aaaaaaaa', fields: { name: 'パンパース テープ M', unit: '袋', cat: 'ベビー' }, qty: 3 } };
  const offers = core.matchLocal({ items: [it(1, 'パンパース テープ M', 2), it(2, 'パンパース テープ L', 1), { ...it(3, 'パンパース テープ M', 1), cat: 'その他' }], buys: [], routines: [] }, view);
  assert.deepEqual(offers.map(o => [o.name, o.sharedId, o.sharedQty]), [['パンパース テープ M', 'item-aaaaaaaa', 3], ['パンパース テープ L', null, null], ['パンパース テープ M', null, null]]);
});
