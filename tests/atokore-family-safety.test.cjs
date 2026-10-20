// Family sync safety: joining, incoming family data and "overwrite everyone" must never silently
// discard this device's data. PeerJS is replaced by an in-memory fake; no network is used.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const familySource = fs.readFileSync(path.resolve(__dirname, '../atokore-trial-v12/family.js'), 'utf8');

function boot({ cfg, version = 0, local, confirmAnswer = true } = {}) {
  const dom = new JSDOM('<!doctype html><div class="top"></div><div id="modal"><div id="sheet"></div></div>', { url: 'https://example.invalid/ig-public-assets/', runScripts: 'dangerously' });
  const w = dom.window;
  w.confirmAnswer = confirmAnswer; w.asked = []; w.alerts = []; w.sent = []; w.notices = [];
  w.confirm = m => { w.asked.push(m); return w.confirmAnswer; };
  w.alert = m => w.alerts.push(m);
  if (cfg) { w.localStorage.setItem('atokoreFamilySafeV2', JSON.stringify(cfg)); w.localStorage.setItem('atokoreFamilySafeVersionV2', String(version)); }
  w.eval(`
    // var, not let: separate eval() calls do not share let bindings (separate <script> tags do).
    var items=${JSON.stringify(local?.items || [])},buys=${JSON.stringify(local?.buys || [])},routines=${JSON.stringify(local?.routines || [])};
    function save(){localStorage.setItem('atokoreTrialV4',JSON.stringify({items,buys,routines}));return true}
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
const tick = () => new Promise(r => setTimeout(r, 150));
// Always close the window (this stops the sync poll timer), even when an assertion fails.
async function run(options, body) {
  const app = boot(options);
  try { await tick(); await body(app.w); } finally { app.dom.window.close(); }
}
const backups = w => JSON.parse(w.localStorage.getItem('atokoreFamilyBackupV1') || '[]');
const localItems = w => JSON.parse(w.eval('JSON.stringify(items.map(x => x.name))'));
const leaderWithMember = w => { const conn = w.fakeConn(); w.peerInstance.h.connection(conn); conn.h.open(); return conn; };
const member = { cfg: { familyCode: 'ABCDEFGH', deviceId: 'DEV111', deviceName: 'ママ' }, version: 100 };

test('incoming family data that removes items keeps a local copy and tells the user', () => run(
  { ...member, local: { items: [{ id: 1, name: 'おむつ' }, { id: 2, name: 'ミルク' }] } },
  async w => {
    const conn = leaderWithMember(w);
    conn.h.data({ type: 'state', version: 200, from: 'DEV999', state: { items: [{ id: 1, name: 'おむつ' }], buys: [], routines: [] } });
    assert.deepEqual(localItems(w), ['おむつ']);
    assert.equal(backups(w).length, 1);
    assert.deepEqual(backups(w)[0].data.items.map(x => x.name), ['おむつ', 'ミルク']);
    assert.match(w.notices.join(), /1件が置き換わりました/);
  }));

test('restoring the copy brings the replaced items back', () => run(
  { ...member, local: { items: [{ id: 1, name: 'おむつ' }, { id: 2, name: 'ミルク' }] } },
  async w => {
    const conn = leaderWithMember(w);
    conn.h.data({ type: 'state', version: 200, from: 'DEV999', state: { items: [], buys: [], routines: [] } });
    assert.deepEqual(localItems(w), []);
    w.document.querySelector('.top button').click();
    assert.match(w.document.getElementById('sheet').textContent, /置き換え前のデータに戻す/);
    w.restoreFamilyBackupSafe();
    assert.deepEqual(localItems(w), ['おむつ', 'ミルク']);
    assert.deepEqual(JSON.parse(w.localStorage.getItem('atokoreTrialV4')).items.map(x => x.name), ['おむつ', 'ミルク']);
  }));

test('joining with local data asks first; cancelling changes nothing', () => run(
  { local: { items: [{ id: 1, name: 'おむつ' }] }, confirmAnswer: false },
  async w => {
    w.document.body.insertAdjacentHTML('beforeend', '<input id="famSafeJoinCode" value="ABCD-EFGH"><input id="famSafeJoinName" value="パパ">');
    w.joinFamilySafe();
    assert.equal(w.asked.length, 1);
    assert.match(w.asked[0], /在庫1件.*置き換わります/s);
    assert.equal(w.localStorage.getItem('atokoreFamilySafeV2'), null, 'not joined');
    w.confirmAnswer = true;
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
  { ...member, local: { items: [{ id: 1, name: 'おむつ' }] }, confirmAnswer: false },
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
