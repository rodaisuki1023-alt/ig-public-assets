// Two (or more) devices running the real sync engine against the real server SQL (PGlite).
// Each device stores its data and sync metadata in its own fake localStorage, so a "reload" is a new
// engine reading the same storage. The network can be cut or can lose responses after the server applied.
const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../atokore-live-v125/household-core-v37.js');
const { createDb, call } = require('./household/pg.cjs');

const A = '00000000-0000-4000-8000-0000000000a1', B = '00000000-0000-4000-8000-0000000000b2';
let seed = 1;
const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };

function device(db, uid, initial, name) {
  const store = new Map([['data', JSON.stringify(initial)]]);
  const net = { mode: 'up' };
  const dev = {
    name, store, net, failLocalWrite: false, failMetaWrite: null,
    state: () => JSON.parse(store.get('data')),
    edit(fn) { const s = dev.state(); fn(s); store.set('data', JSON.stringify(s)); },
    engine: null,
    boot() {
      dev.engine = core.createEngine({
        readState: () => JSON.parse(store.get('data') || 'null'),
        writeState: s => { if (dev.failLocalWrite) return false; store.set('data', JSON.stringify(s)); return true; },
        readMeta: () => JSON.parse(store.get('meta') || 'null'),
        writeMeta: m => { if(dev.failMetaWrite?.(m))return false;store.set('meta', JSON.stringify(m)); return true; },
        rpc: async (fn, args) => {
          if (net.mode === 'down') throw Object.assign(Error('offline'), { code: 'network' });
          const res = await call(db, uid, fn, args);
          if (net.mode === 'lose-response'||(net.mode==='lose-push-response'&&fn==='hh_push')) { net.mode = 'up'; throw Object.assign(Error('response lost'), { code: 'network' }); }
          return res;
        },
        device: name, rand,
      });
      return dev;
    },
  };
  return dev.boot();
}
const item = (id, name, qty, unit = '袋', cat = 'ベビー') => ({ id, name, cat, qty, unit, place: '収納', expType: '期限なし', exp: '', usage: 1 });
const qtyOf = (dev, name) => dev.state().items.find(x => x.name === name)?.qty;

async function household(localA, localB = { items: [], buys: [], routines: [] }) {
  const db = await createDb();
  const a = device(db, A, localA, 'iphone-a'), b = device(db, B, localB, 'iphone-b');
  await call(db, A, 'hh_create', { p_name: 'わが家', p_display_name: 'ママ' });
  a.engine.startAsCreator();
  await a.engine.sync();
  const { code } = await call(db, A, 'hh_invite_create');
  await call(db, B, 'hh_join', { p_code: code, p_display_name: 'パパ' });
  b.engine.startAsJoiner();
  return { db, a, b };
}
const start = () => ({ items: [item(1, 'パンパース テープ M', 3), item(2, '明治 ほほえみ 缶', 2, '缶')], buys: [], routines: [{ id: 5, name: 'いつもの', items: [{ id: 1, name: 'パンパース テープ M', qty: 1, unit: '袋' }] }] });

test('creator shares existing data once; a member with an empty device receives all of it', async () => {
  const { db, a, b } = await household(start());
  await b.engine.adopt({ useShared: true });
  assert.deepEqual(b.state().items.map(x => [x.name, x.qty]), [['パンパース テープ M', 3], ['明治 ほほえみ 缶', 2]]);
  assert.equal(b.state().routines[0].items[0].name, 'パンパース テープ M');
  // The creator's local ids did not change (photos are keyed by them).
  assert.deepEqual(a.state().items.map(x => x.id), [1, 2]);
  const rows = await db.query('select count(*)::int as n from atokore_private.records');
  assert.equal(rows.rows[0].n, 3);
  assert.equal(a.engine.status().pending, 0);
});

test('both use the same stock while offline: both decrements count after they reconnect', async () => {
  const { a, b } = await household(start());
  await b.engine.adopt({ useShared: true });
  a.net.mode = 'down'; b.net.mode = 'down';
  a.edit(s => { s.items[0].qty -= 1; });
  b.edit(s => { s.items[0].qty -= 1; s.items[1].qty += 3; });
  await assert.rejects(a.engine.sync(), /offline/);
  await assert.rejects(b.engine.sync(), /offline/);
  assert.equal(a.engine.status().pending, 1, 'saved on the device, not yet shared');
  a.net.mode = 'up'; b.net.mode = 'up';
  await a.engine.sync(); await b.engine.sync(); await a.engine.sync();
  for (const d of [a, b]) {
    assert.equal(qtyOf(d, 'パンパース テープ M'), 1, d.name);
    assert.equal(qtyOf(d, '明治 ほほえみ 缶'), 5, d.name);
  }
});

test('offline changes survive a reload and are sent once when back online', async () => {
  const { a, b } = await household(start());
  await b.engine.adopt({ useShared: true });
  b.net.mode = 'down';
  b.edit(s => { s.items.push(item(Date.now(), 'Rico おしりふき', 2, 'パック')); s.items[0].qty += 1; });
  await assert.rejects(b.engine.sync());
  const pending = b.engine.status().pending;
  assert.ok(pending >= 2);
  b.boot(); // reload: same storage, new engine
  assert.equal(b.engine.status().pending, pending);
  b.net.mode = 'up';
  await b.engine.sync(); await a.engine.sync();
  assert.equal(qtyOf(a, 'Rico おしりふき'), 2);
  assert.equal(qtyOf(a, 'パンパース テープ M'), 4);
});

test('a lost response is retried without counting twice, on the server or on screen', async () => {
  const { a, b } = await household(start());
  await b.engine.adopt({ useShared: true });
  a.edit(s => { s.items[1].qty += 1; });
  a.net.mode = 'lose-response';
  await assert.rejects(a.engine.sync(), /response lost/);
  assert.equal(qtyOf(a, '明治 ほほえみ 缶'), 3, 'screen shows the change once');
  await a.engine.sync(); await a.engine.sync();
  assert.equal(qtyOf(a, '明治 ほほえみ 缶'), 3);
  await b.engine.sync();
  assert.equal(qtyOf(b, '明治 ほほえみ 缶'), 3);
});

test('delete on one device and edit on the other: the product stays deleted', async () => {
  const { a, b } = await household(start());
  await b.engine.adopt({ useShared: true });
  b.net.mode = 'down';
  a.edit(s => { s.items = s.items.filter(x => x.name !== '明治 ほほえみ 缶'); });
  await a.engine.sync();
  b.edit(s => { const x = s.items.find(i => i.name === '明治 ほほえみ 缶'); x.qty += 2; x.memo = 'セールで購入'; });
  b.net.mode = 'up';
  await b.engine.sync();
  assert.equal(qtyOf(b, '明治 ほほえみ 缶'), undefined);
  await a.engine.sync();
  assert.equal(qtyOf(a, '明治 ほほえみ 缶'), undefined);
});

test('the same purchase finished on two devices restocks once', async () => {
  const s = start(); s.buys.push({ id: 30, name: 'パンパース テープ M', qty: 2, unit: '袋', cat: 'ベビー' });
  const { a, b } = await household(s);
  await b.engine.adopt({ useShared: true });
  const bought = d => d.edit(st => { const buy = st.buys.find(x => x.name === 'パンパース テープ M'); st.buys = st.buys.filter(x => x !== buy); st.items.find(x => x.name === buy.name).qty += buy.qty; });
  bought(a); bought(b);
  await a.engine.sync(); await b.engine.sync(); await a.engine.sync();
  for (const d of [a, b]) {
    assert.equal(qtyOf(d, 'パンパース テープ M'), 5, d.name);
    assert.equal(d.state().buys.length, 0);
  }
});

test('joining with data on the device: nothing is replaced silently; sizes never merge', async () => {
  const mine = { items: [item(7, 'パンパース テープ M', 5), item(8, 'パンパース テープ L', 1), item(9, '自分のメモ品', 1, '個', 'その他')], buys: [], routines: [] };
  // Choice 1: use the shared data. Exact same product keeps this device's local id (its photo).
  const one = await household(start(), mine);
  await one.b.engine.adopt({ useShared: true });
  assert.deepEqual(one.b.state().items.map(x => [x.id, x.name, x.qty]).sort(), [[7, 'パンパース テープ M', 3], [one.b.state().items.find(x => x.name === '明治 ほほえみ 缶').id, '明治 ほほえみ 缶', 2]].sort());
  await one.a.engine.sync();
  assert.equal(qtyOf(one.a, 'パンパース テープ M'), 3, 'the creator is untouched');
  // Choice 2: add chosen products. M is summed only because the person asked; L is added as new; the memo item is skipped.
  const two = await household(start(), mine);
  const offers = core.matchLocal(two.b.state(), (await call(two.db, B, 'hh_pull', { p_since: 0 })).records.reduce((v, r) => ({ ...v, [r.kind + ':' + r.id]: { ...r, qty: Number(r.qty) } }), {}));
  assert.deepEqual(offers.map(o => [o.name, o.sharedId ? 'same' : 'new']), [['パンパース テープ M', 'same'], ['パンパース テープ L', 'new'], ['自分のメモ品', 'new']]);
  await two.b.engine.adopt({ add: [{ key: 'item:7', mode: 'sum' }, { key: 'item:8', mode: 'new' }, { key: 'item:9', mode: 'skip' }] });
  await two.a.engine.sync();
  for (const d of [two.a, two.b]) {
    assert.equal(qtyOf(d, 'パンパース テープ M'), 8, d.name);
    assert.equal(qtyOf(d, 'パンパース テープ L'), 1, d.name);
    assert.equal(qtyOf(d, '自分のメモ品'), undefined, d.name);
  }
});

test('a device that cannot save locally keeps its data and sync state, then catches up', async () => {
  const { a, b } = await household(start());
  await b.engine.adopt({ useShared: true });
  a.edit(s => { s.items[0].qty = 9; });
  await a.engine.sync();
  b.failLocalWrite = true;
  const before = b.store.get('data'), meta = b.store.get('meta');
  await assert.rejects(b.engine.sync(), /local_save_failed/);
  assert.equal(b.store.get('data'), before, 'device data unchanged');
  assert.equal(JSON.parse(b.store.get('meta')).shadow.items[0].qty, JSON.parse(meta).shadow.items[0].qty, 'shadow still matches the stored data');
  b.failLocalWrite = false;
  await b.engine.sync();
  assert.equal(qtyOf(b, 'パンパース テープ M'), 9);
});

test('a refused change blocks sync, preserves local data across reloads, and needs explicit recovery', async () => {
  const { a, b } = await household(start());
  await b.engine.adopt({ useShared: true });
  a.edit(s => { s.items[0].name = 'あ'.repeat(130); });
  await assert.rejects(a.engine.sync(), /sync_rejected/);
  assert.equal(a.engine.status().pending, 0);
  assert.equal(a.engine.status().rejected, 1);
  assert.equal(a.engine.meta().rejected[0].status, 'rejected:bad_field');
  assert.equal(a.state().items[0].name, 'あ'.repeat(130));
  a.boot();
  await assert.rejects(a.engine.sync(), /sync_rejected/);
  await assert.rejects(a.engine.pull(), /sync_rejected/);
  assert.equal(a.state().items[0].name, 'あ'.repeat(130));
  await b.engine.sync();
  assert.equal(b.state().items[0].name, 'パンパース テープ M');
  a.engine.resolveRejected();
  await a.engine.sync();
  assert.equal(a.state().items[0].name, 'パンパース テープ M');
});

test('a lost rejection response cannot make a refused new product disappear on retry', async () => {
  const { db, a } = await household(start());
  await db.exec('update atokore_private.households set record_limit = 3');
  a.edit(s => s.items.push(item(99, 'ローカルだけの商品', 2)));
  a.net.mode = 'lose-response';
  await assert.rejects(a.engine.sync(), /response lost/);
  a.boot();
  await assert.rejects(a.engine.sync(), /sync_rejected/);
  assert.equal(qtyOf(a, 'ローカルだけの商品'), 2);
  assert.equal(a.engine.meta().rejected[0].status, 'rejected:record_limit');
});

test('metadata failure after receiving stock cannot turn a remote increment into a new local increment', async () => {
  const { a, b } = await household(start());await b.engine.adopt({useShared:true});
  a.edit(s=>{s.items[0].qty++});await a.engine.sync();
  b.failMetaWrite=m=>!m.pendingApply&&m.shadow?.items[0]?.qty===4;
  await assert.rejects(b.engine.sync(),/sync_meta_not_saved/);
  assert.equal(qtyOf(b,'パンパース テープ M'),4);
  assert.ok(JSON.parse(b.store.get('meta')).pendingApply);
  b.failMetaWrite=null;b.boot();await b.engine.sync();await a.engine.sync();
  assert.equal(qtyOf(a,'パンパース テープ M'),4);assert.equal(qtyOf(b,'パンパース テープ M'),4);
  assert.equal(b.engine.status().pending,0);assert.equal(b.engine.meta().pendingApply,null);
});

test('a checkpoint that cannot be persisted leaves stock untouched; retry receives the change once', async () => {
  const {a,b}=await household(start());await b.engine.adopt({useShared:true});
  a.edit(s=>{s.items[0].qty++});await a.engine.sync();
  b.failMetaWrite=m=>!!m.pendingApply;
  await assert.rejects(b.engine.sync(),/sync_meta_not_saved/);assert.equal(qtyOf(b,'パンパース テープ M'),3);
  b.failMetaWrite=null;b.boot();await b.engine.sync();await a.engine.sync();assert.equal(qtyOf(a,'パンパース テープ M'),4);
});

test('a crash after the checkpoint but before the state write recovers without treating the old state as an edit', async () => {
  const {a,b}=await household(start());await b.engine.adopt({useShared:true});
  a.edit(s=>{s.items[0].qty++});await a.engine.sync();
  b.failLocalWrite=true;await assert.rejects(b.engine.sync(),/local_save_failed/);
  assert.ok(b.engine.meta().pendingApply);assert.equal(qtyOf(b,'パンパース テープ M'),3);
  b.failLocalWrite=false;b.boot();await b.engine.sync();await a.engine.sync();
  assert.equal(qtyOf(a,'パンパース テープ M'),4);assert.equal(qtyOf(b,'パンパース テープ M'),4);
});

test('edits after interrupted state commit block before diff/network and preserve the current data for recovery', async () => {
  const {a,b}=await household(start());await b.engine.adopt({useShared:true});
  a.edit(s=>{s.items[0].qty++});await a.engine.sync();
  b.failMetaWrite=m=>!m.pendingApply&&m.shadow?.items[0]?.qty===4;
  await assert.rejects(b.engine.sync(),/sync_meta_not_saved/);
  b.edit(s=>{s.items[0].qty=5});b.failMetaWrite=null;b.boot();
  await assert.rejects(b.engine.sync(),/sync_recovery_needed/);
  assert.equal(qtyOf(b,'パンパース テープ M'),5);assert.equal(b.engine.status().pending,0);
  await a.engine.sync();assert.equal(qtyOf(a,'パンパース テープ M'),4);
  // The UI saves a backup and asks first; the engine then accepts the shared copy.
  b.engine.resolveRejected();await b.engine.sync();await a.engine.sync();assert.equal(qtyOf(b,'パンパース テープ M'),4);assert.equal(qtyOf(a,'パンパース テープ M'),4);
});

test('interrupted joining recovers the chosen new stock once without losing the unsent adoption queue', async () => {
  const mine={items:[item(99,'Rico おしりふき',2)],buys:[],routines:[]};
  const {a,b}=await household(start(),mine);
  b.failMetaWrite=m=>!m.pendingApply&&m.shadow!==null;
  await assert.rejects(b.engine.adopt({add:[{key:'item:99',mode:'new'}]}),/sync_meta_not_saved/);
  assert.ok(b.engine.meta().pendingApply);assert.equal(b.engine.meta().shadow,null);
  b.failMetaWrite=null;b.boot();await b.engine.sync();await a.engine.sync();await b.engine.sync();
  assert.equal(qtyOf(a,'Rico おしりふき'),2);assert.equal(qtyOf(b,'Rico おしりふき'),2);assert.equal(b.engine.status().pending,0);
});

for(const failure of ['metadata','lost-response'])test('retrying a summed adoption after '+failure+' resumes the original operation once',async()=>{
  const mine={items:[item(7,'パンパース テープ M',5)],buys:[],routines:[]};
  const {a,b}=await household(start(),mine),choices={add:[{key:'item:7',mode:'sum'}]};
  if(failure==='metadata')b.failMetaWrite=m=>!m.pendingApply&&m.shadow!==null;
  else b.net.mode='lose-push-response';
  await assert.rejects(b.engine.adopt(choices),failure==='metadata'?/sync_meta_not_saved/:/response lost/);
  const operation=b.engine.meta().outbox[0];assert.equal(operation.delta,5);
  b.failMetaWrite=null;b.boot();
  assert.equal(b.engine.meta().outbox[0].op_id,operation.op_id);
  await b.engine.adopt(choices);await a.engine.sync();await b.engine.sync();
  assert.equal(qtyOf(a,'パンパース テープ M'),8);assert.equal(qtyOf(b,'パンパース テープ M'),8);assert.equal(b.engine.status().pending,0);
});
