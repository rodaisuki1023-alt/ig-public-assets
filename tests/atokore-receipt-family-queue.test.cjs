// v49 2nd audit: the family receipt check queue (receipt.js) against a FAKE shared server. Covers the
// household/user scope of queued checks, failed or refused "finish" calls, signed-out answers, the reasons
// shown to the person, a household switch or sign-out during an import, and a reservation taken over by
// another member. No real server or household data is used.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function app() {
  const store = new Map();
  const told = [], asked = [];
  const server = { records: new Map(), calls: [], down: null, user: 'u1', household: 'h1', joined: true };
  const scope = () => server.joined && server.household && server.user ? server.household + ':' + server.user : null;
  const call = (fn, fp, extra) => {
    server.calls.push([fn, fp, scope()]);
    const sc = scope();
    if (!sc) return { ok: false, reason: 'signed_out', scope: null };
    if (server.down) return { ok: false, reason: server.down, scope: sc };
    const key = server.household + '|' + fp, rec = server.records.get(key);
    if (fn === 'claim') {
      if (!rec) { server.records.set(key, { by: server.user, state: 'pending', at: 1 }); return { ok: true, claimed: true, mine: true, state: 'pending', scope: sc }; }
      if (rec.by === server.user) return { ok: true, claimed: true, mine: true, state: rec.state, scope: sc };
      if (rec.state === 'pending' && rec.stale) { const who = rec.by; rec.by = server.user; rec.stale = false; return { ok: true, claimed: true, mine: true, tookOver: true, state: 'pending', who: who + 'の名前', at: 1, scope: sc }; }
      return { ok: true, claimed: false, mine: false, state: rec.state, who: rec.by + 'の名前', at: 1, scope: sc };
    }
    // finish
    if (extra === true) { if (rec && rec.by === server.user) { rec.state = 'done'; return { ok: true, scope: sc }; } return { ok: false, reason: 'not_recorded', scope: sc }; }
    if (rec && rec.by === server.user && rec.state === 'pending') server.records.delete(key);
    return { ok: true, scope: sc };
  };
  const household = {
    receiptScope: scope,
    homeState: () => ({ joined: server.joined }),
    receiptClaim: async fp => call('claim', fp),
    receiptFinish: async (fp, done) => call('finish', fp, done),
  };
  const ctx = {
    console: { log() {}, warn() {}, error() {} }, C: { 食料品: ['牛乳'] }, crypto: globalThis.crypto, TextEncoder,
    document: { createElement: () => ({ textContent: '', style: {}, appendChild() {} }), head: { appendChild() {} }, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [] },
    localStorage: { getItem: k => store.has(k) ? store.get(k) : null, setItem: (k, v) => store.set(k, String(v)) },
    URL: { createObjectURL: () => '', revokeObjectURL() {} }, Image: function Image() {},
    today: () => '2026-11-01', AtokoreDates: { localDate: () => '2026-11-01' }, AtokoreReceiptStructure: require('../atokore-live-v125/receipt-structure-v49.js'),
    AtokoreHousehold: household,
    AtokoreConfirm: { tell: (t, m) => told.push([t, m]), ask: async (t, m) => { asked.push([t, m]); return ctx.answer; } },
    answer: false, showPremium() {}, openM() {}, closeM() {}, items: [], buys: [], save() {}, render() {},
  };
  ctx.window = ctx; vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../atokore-live-v125/receipt.js'), 'utf8'), ctx);
  return { F: ctx.__receiptFamilyV49, server, told, asked, ctx, queue: () => JSON.parse(JSON.stringify(ctx.__receiptFamilyV49.claimQueue())) };
}
const receipt = (n = 1) => ({ facts: { strong: true, key: 'r1|store|2026-11-01|12:00|' + n + '|' }, imageHash: null });

test('a check queued for one household is never sent to another; it stays for its own household', async () => {
  const { F, server, queue } = app();
  F.enqueueClaims(['a'.repeat(64)], 'h1:u1');
  server.household = 'h2';
  const r = await F.flushClaims();
  assert.equal(r.sent, 0);
  assert.deepEqual(server.calls, []);
  assert.deepEqual(queue().map(k => k.scope), ['h1:u1']);
  server.household = 'h1';
  await F.flushClaims();
  assert.deepEqual(server.calls.map(c => c[2]), ['h1:u1', 'h1:u1']); // claim, then finish, for h1 only
  assert.deepEqual(queue(), []);
});

test('signed out or expired: the queue is kept, nothing is reported as checked', async () => {
  const { F, server, queue } = app();
  F.enqueueClaims(['b'.repeat(64)], 'h1:u1');
  server.down = 'auth';
  let r = await F.flushClaims();
  assert.equal(r.stop, 'auth'); assert.equal(queue().length, 1);
  server.down = null; server.user = null; // signed out: no scope at all
  r = await F.flushClaims();
  assert.equal(r.sent, 0); assert.equal(queue().length, 1);
});

test('the reasons are told apart; only "offline" promises a later check', () => {
  const { F } = app();
  assert.match(F.claimNotice('offline')[1], /通信が戻ってから/);
  for (const reason of ['auth', 'unavailable', 'not_member', 'error']) assert.doesNotMatch(F.claimNotice(reason)[1], /通信が戻/, reason);
  assert.match(F.claimNotice('auth')[1], /ログインが切れて/);
  assert.match(F.claimNotice('unavailable')[1], /まだ対応していません/);
  assert.match(F.claimNotice('not_member')[1], /外れて/);
});

test('saved, then the record is not marked ({ok:false} or offline): queued, never counted as recorded', async () => {
  const { F, server, queue } = app();
  const fc = await F.familyCheck(receipt(1));
  assert.equal(fc.checked, true); assert.equal(fc.keys.length, 1);
  server.down = 'offline';
  await F.finishClaims(fc);
  assert.equal(queue().length, 1, 'offline finish is queued');
  server.down = null;
  await F.flushClaims();
  assert.deepEqual(queue(), []);
  assert.equal([...server.records.values()][0].state, 'done');
});

test('household switch or sign-out between the check and the save: queued for the original household only', async () => {
  const { F, server, queue } = app();
  const fc = await F.familyCheck(receipt(2));
  server.household = 'h2';
  const before = server.calls.length;
  await F.finishClaims(fc);
  assert.equal(server.calls.length, before, 'nothing is sent to the new household');
  assert.deepEqual(queue().map(k => k.scope), ['h1:u1']);
  server.user = null; // signed out before the next import: said so, nothing reserved or queued for nobody
  const calls = server.calls.length;
  const fc2 = await F.familyCheck(receipt(3));
  assert.equal(fc2.reason, 'signed_out'); assert.equal(fc2.checked, false);
  await F.finishClaims(fc2);
  assert.equal(server.calls.length, calls);
  assert.deepEqual(queue().map(k => k.scope), ['h1:u1']);
});

test('a reservation taken over by another member: the late finish is refused, queued and reported; stock is not touched', async () => {
  const { F, server, told, queue, ctx } = app();
  const fc = await F.familyCheck(receipt(4));
  // Another member took the stale reservation before this device marked it done.
  const rec = [...server.records.values()][0]; rec.by = 'u2'; rec.state = 'pending';
  await F.finishClaims(fc);
  assert.equal(told.length, 1);
  assert.match(told[0][1], /u2の名前さん/);
  assert.match(told[0][1], /自動では変更していません/);
  assert.deepEqual(queue(), [], 'the other member is now known: nothing more to ask');
  assert.deepEqual(ctx.items, []);
});

test('a reservation left unfinished for long is shown before taking it over; cancel releases it', async () => {
  const { F, server, asked, ctx } = app();
  server.records.set('h1|' + 'c'.repeat(64), { by: 'u2', state: 'pending', stale: true });
  // The receipt key is a hash: make the stale record match it.
  const fp = (await F.familyCheck(receipt(5))).keys[0];
  server.records.clear(); server.calls.length = 0;
  server.records.set('h1|' + fp, { by: 'u2', state: 'pending', stale: true });
  ctx.answer = false;
  const fc = await F.familyCheck(receipt(5));
  assert.equal(fc.go, false);
  assert.match(asked.at(-1)[0], /途中で止まっています/);
  assert.equal(server.records.has('h1|' + fp), false, 'the taken-over reservation is released on cancel');
});

test('a failed check before saving (offline / unavailable) gives its reason and queues only for that household', async () => {
  const { F, server, queue } = app();
  server.down = 'unavailable';
  const fc = await F.familyCheck(receipt(6));
  assert.equal(fc.checked, false); assert.equal(fc.reason, 'unavailable');
  await F.finishClaims(fc);
  assert.deepEqual(queue().map(k => k.scope), ['h1:u1']);
});
