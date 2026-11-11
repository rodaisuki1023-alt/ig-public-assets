// Family sync safety: joining, incoming family data, restores and "overwrite everyone" must never
// silently discard this device's data. PeerJS is replaced by an in-memory fake; no network is used.
// save() mirrors the production app: it swallows storage errors and returns nothing.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const familySource = fs.readFileSync(path.resolve(__dirname, '../atokore-trial-v12/family.js'), 'utf8');

function boot({ cfg, version = 0, local, confirmAnswer = true, stored = {} } = {}) {
  const dom = new JSDOM('<!doctype html><div class="top"></div><div id="modal"><div id="sheet"></div></div>', { url: 'https://example.invalid/ig-public-assets/', runScripts: 'dangerously' });
  const w = dom.window;
  w.confirmAnswer = confirmAnswer; w.asked = []; w.alerts = []; w.sent = []; w.notices = [];
  w.confirm = m => { w.asked.push(m); return w.confirmAnswer; };
  w.alert = m => w.alerts.push(m);
  if (cfg) { w.localStorage.setItem('atokoreFamilySafeV2', JSON.stringify(cfg)); w.localStorage.setItem('atokoreFamilySafeVersionV2', String(version)); }
  for (const [k, v] of Object.entries(stored)) w.localStorage.setItem(k, v);
  w.eval(`
    // var, not let: separate eval() calls do not share let bindings (separate <script> tags do).
    var items=${JSON.stringify(local?.items || [])},buys=${JSON.stringify(local?.buys || [])},routines=${JSON.stringify(local?.routines || [])};
    function save(){try{localStorage.setItem('atokoreTrialV4',JSON.stringify({items,buys,routines}))}catch(e){}}
    save();
    function render(){}
    function openM(html){document.getElementById('sheet').innerHTML=html}
    function closeM(){}
    window.notifyAtokoreV125H=m=>notices.push(m);
    window.Peer=class{constructor(id){this.id=id;this.h={};window.peerInstance=this}on(e,f){this.h[e]=f;if(e==='open')setTimeout(()=>f(this.id),0)}destroy(){}connect(){return window.fakeConn()}};
    window.fakeConn=()=>({open:true,peer:'member-x',h:{},on(e,f){this.h[e]=f},send(m){sent.push(m)}});
  `);
  w.eval(familySource);
  return { dom, w };
}
const tick = (ms = 150) => new Promise(r => setTimeout(r, ms));
// Always close the window (this stops the sync poll timer), even when an assertion fails.
async function run(options, body) {
  const app = boot(options);
  try { await tick(); await body(app.w); } finally { app.dom.window.close(); }
}
// Make writes of matching keys fail, like a full storage.
function failWrites(w, match) {
  const original = w.Storage.prototype.setItem;
  w.Storage.prototype.setItem = function (k, v) { if (match(k)) throw new w.DOMException('quota', 'QuotaExceededError'); return original.call(this, k, v); };
  return () => { w.Storage.prototype.setItem = original; };
}
const backups = w => JSON.parse(w.localStorage.getItem('atokoreFamilyBackupV1') || '[]');
const localItems = w => JSON.parse(w.eval('JSON.stringify(items.map(x => x.name + ":" + x.qty))'));
const storedItems = w => JSON.parse(w.localStorage.getItem('atokoreTrialV4')).items.map(x => x.name + ':' + x.qty);
const stateMsgs = w => w.sent.filter(m => m.type === 'state');
const leaderWithMember = w => { const conn = w.fakeConn(); w.peerInstance.h.connection(conn); conn.h.open(); return conn; };
const member = { cfg: { familyCode: 'ABCDEFGH', deviceId: 'DEV111', deviceName: 'ママ' }, version: 100 };
const two = { items: [{ id: 1, name: 'おむつ', qty: 2 }, { id: 2, name: 'ミルク', qty: 1 }] };
const incoming = (version, list) => ({ type: 'state', version, from: 'DEV999', state: { items: list, buys: [], routines: [] } });

test('incoming family data that removes items keeps a local copy and tells the user', () => run({ ...member, local: two }, async w => {
  leaderWithMember(w).h.data(incoming(200, [{ id: 1, name: 'おむつ', qty: 2 }]));
  assert.deepEqual(localItems(w), ['おむつ:2']);
  assert.deepEqual(backups(w)[0].data.items.map(x => x.name), ['おむつ', 'ミルク']);
  assert.match(w.notices.join(), /1件が変更・削除されました/);
}));

test('a quantity change to the same item also keeps a copy first (concurrent edit)', () => run({ ...member, local: two }, async w => {
  const conn = leaderWithMember(w);
  // This device just counted a pack used, while another device sends its newer full state.
  w.eval('items[0].qty=1;save()');
  conn.h.data(incoming(200, [{ id: 1, name: 'おむつ', qty: 5 }, { id: 2, name: 'ミルク', qty: 1 }]));
  assert.deepEqual(localItems(w), ['おむつ:5', 'ミルク:1']);
  assert.deepEqual(backups(w)[0].data.items.map(x => x.name + ':' + x.qty), ['おむつ:1', 'ミルク:1']);
  // An older state arriving late changes nothing.
  conn.h.data(incoming(150, []));
  assert.deepEqual(localItems(w), ['おむつ:5', 'ミルク:1']);
}));

test('if the local copy cannot be written, the family update is held and nothing is sent', () => run({ ...member, local: two }, async w => {
  const conn = leaderWithMember(w);
  const restore = failWrites(w, k => k === 'atokoreFamilyBackupV1');
  conn.h.data(incoming(200, []));
  assert.deepEqual(localItems(w), ['おむつ:2', 'ミルク:1'], 'not overwritten');
  assert.deepEqual(storedItems(w), ['おむつ:2', 'ミルク:1']);
  assert.match(w.notices.join(), /保留/);
  const before = stateMsgs(w).length;
  w.eval('items[0].qty=9;save()');
  await tick(1600);
  assert.equal(stateMsgs(w).length, before, 'held device does not push its state over the family');
  // Once storage works again, the next family update is applied with a copy kept first.
  restore();
  conn.h.data(incoming(300, [{ id: 3, name: '卵', qty: 6 }]));
  assert.deepEqual(localItems(w), ['卵:6']);
  assert.deepEqual(backups(w)[0].data.items.map(x => x.name + ':' + x.qty), ['おむつ:9', 'ミルク:1']);
}));

test('a held family update stays held after a reload, so this device never pushes over newer data', async () => {
  let flag = null;
  await run({ ...member, local: two }, async w => {
    const restore = failWrites(w, k => k === 'atokoreFamilyBackupV1');
    leaderWithMember(w).h.data(incoming(200, []));
    restore();
    flag = w.localStorage.getItem('atokoreFamilyBlockedV1');
    assert.equal(flag, '1', 'held state is remembered');
  });
  // Reload: same stored data, version and flag; storage still short, the user edits before any family update.
  await run({ ...member, local: two, stored: { atokoreFamilyBlockedV1: flag } }, async w => {
    const conn = leaderWithMember(w);
    const before = stateMsgs(w).length;
    w.eval('items[0].qty=7;save()');
    await tick(1600);
    assert.equal(stateMsgs(w).length, before, 'held device does not broadcast after reload');
    w.document.querySelector('.top button').click();
    assert.match(w.document.getElementById('sheet').textContent, /保留/, 'the family screen explains the hold');
    // Storage works again: the family update is applied (copy kept first) and the hold is cleared.
    conn.h.data(incoming(300, [{ id: 3, name: '卵', qty: 6 }]));
    assert.deepEqual(localItems(w), ['卵:6']);
    assert.equal(w.localStorage.getItem('atokoreFamilyBlockedV1'), null);
  });
});

test('if family data cannot be saved here, the old data stays in memory and in storage', () => run({ ...member, local: two }, async w => {
  const conn = leaderWithMember(w);
  const restore = failWrites(w, k => k === 'atokoreTrialV4');
  conn.h.data(incoming(200, [{ id: 9, name: '別物', qty: 1 }]));
  restore();
  assert.deepEqual(localItems(w), ['おむつ:2', 'ミルク:1']);
  assert.deepEqual(storedItems(w), ['おむつ:2', 'ミルク:1']);
  assert.match(w.notices.join(), /保存できなかった/);
  assert.equal(w.localStorage.getItem('atokoreFamilySafeVersionV2'), '100', 'version not advanced');
}));

test('restoring the copy brings items back, pauses sync and sends nothing to the family', () => run({ ...member, local: two }, async w => {
  const conn = leaderWithMember(w);
  conn.h.data(incoming(200, []));
  assert.deepEqual(localItems(w), []);
  w.document.querySelector('.top button').click();
  assert.match(w.document.getElementById('sheet').textContent, /置き換え前のデータに戻す/);
  const before = stateMsgs(w).length;
  w.restoreFamilyBackupSafe();
  assert.deepEqual(localItems(w), ['おむつ:2', 'ミルク:1']);
  assert.deepEqual(storedItems(w), ['おむつ:2', 'ミルク:1']);
  await tick(1600);
  assert.equal(stateMsgs(w).length, before, 'restored data is not re-synced to other devices');
  conn.h.data(incoming(300, []));
  assert.deepEqual(localItems(w), ['おむつ:2', 'ミルク:1'], 'paused device ignores family updates');
  w.document.querySelector('.top button').click();
  assert.match(w.document.getElementById('sheet').textContent, /受け取って再開/);
  w.resumeFamilySafe('receive');
  await tick();
  w.peerInstance.h.connection(conn); conn.h.open();
  conn.h.data(incoming(400, [{ id: 3, name: '卵', qty: 6 }]));
  assert.deepEqual(localItems(w), ['卵:6'], 'resuming takes the family data again');
}));

test('a restore that cannot be saved is not reported as success and changes nothing', () => run({ ...member, local: two }, async w => {
  leaderWithMember(w).h.data(incoming(200, [{ id: 1, name: 'おむつ', qty: 2 }]));
  const restore = failWrites(w, k => k === 'atokoreTrialV4');
  w.notices.length = 0;
  w.restoreFamilyBackupSafe();
  restore();
  assert.deepEqual(localItems(w), ['おむつ:2']);
  assert.deepEqual(storedItems(w), ['おむつ:2']);
  assert.match(w.alerts.join(), /元に戻せませんでした/);
  assert.doesNotMatch(w.notices.join(), /戻しました/);
  assert.equal(w.localStorage.getItem('atokoreFamilyPausedV1'), null, 'sync not left paused');
}));

test('joining with local data asks first; cancelling changes nothing; a failed copy stops the join', () => run(
  { local: { items: [{ id: 1, name: 'おむつ', qty: 1 }] }, confirmAnswer: false },
  async w => {
    w.document.body.insertAdjacentHTML('beforeend', '<input id="famSafeJoinCode" value="ABCD-EFGH"><input id="famSafeJoinName" value="パパ">');
    w.joinFamilySafe();
    assert.match(w.asked[0], /在庫1件.*置き換わります/s);
    assert.equal(w.localStorage.getItem('atokoreFamilySafeV2'), null, 'not joined');
    w.confirmAnswer = true;
    const restore = failWrites(w, k => k === 'atokoreFamilyBackupV1');
    w.joinFamilySafe();
    restore();
    assert.equal(w.localStorage.getItem('atokoreFamilySafeV2'), null, 'no join without a copy');
    assert.match(w.alerts.join(), /参加を中止/);
    w.joinFamilySafe();
    assert.ok(w.localStorage.getItem('atokoreFamilySafeV2'), 'joined after consent');
    assert.equal(backups(w)[0].reason, 'join');
  }));

test('joining from an empty device does not ask', () => run({}, async w => {
  w.document.body.insertAdjacentHTML('beforeend', '<input id="famSafeJoinCode" value="ABCDEFGH"><input id="famSafeJoinName" value="パパ">');
  w.joinFamilySafe();
  assert.equal(w.asked.length, 0);
  assert.ok(w.localStorage.getItem('atokoreFamilySafeV2'));
}));

test('"overwrite everyone" requires confirmation and sends nothing when cancelled', () => run(
  { ...member, local: { items: [{ id: 1, name: 'おむつ', qty: 1 }] }, confirmAnswer: false },
  async w => {
    leaderWithMember(w);
    const before = w.sent.length;
    w.forceFamilySafeSync();
    assert.match(w.asked.at(-1), /全員の端末.*上書き/s);
    assert.equal(w.sent.length, before, 'nothing broadcast');
    w.confirmAnswer = true;
    w.forceFamilySafeSync();
    assert.equal(w.sent.at(-1).type, 'state');
  }));
