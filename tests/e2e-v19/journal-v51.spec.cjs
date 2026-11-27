// Work 9th (①, Chromium + WebKit): atomic persistence across tabs. Deterministic fault injection:
//  - "hold": tab B sees neither storage events nor journal broadcasts (exactly the window in which two writes
//    from the same base cross), installed before any app script;
//  - commits blocked in a tab (its IndexedDB readwrite transactions throw), then the tab is closed;
//  - the write-ahead log cannot be written (storage full).
// Expected (Work 9th): different products 2/3, the same product 3, a closed tab's change recovered once, a
// refused save is reported and nothing appears twice.
const { test, expect } = require('@playwright/test');
const { open, go, baseState, KEY } = require('./helpers.cjs');
const hold = () => {
  window.__hold = true;
  const add = window.addEventListener;
  window.addEventListener = function (type, fn, opts) {
    if (type !== 'storage' || typeof fn !== 'function') return add.call(this, type, fn, opts);
    return add.call(this, type, function (e) { if (!window.__hold) return fn.call(this, e); }, opts);
  };
  const BC = window.BroadcastChannel;
  if (BC) window.BroadcastChannel = class extends BC { set onmessage(f) { super.onmessage = e => { if (!window.__hold) f(e); }; } get onmessage() { return super.onmessage; } };
};
async function tabs(browser, info) {
  const ctx = await browser.newContext({ ...info.project.use, baseURL: info.project.use.baseURL, viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const a = await ctx.newPage(); await open(a, { [KEY]: baseState() });
  await a.evaluate(() => AtokoreJournal.ready);
  const b = await ctx.newPage(); await b.addInitScript(hold); await open(b, null);
  await b.evaluate(() => AtokoreJournal.ready);
  return { ctx, a, b };
}
const qty = (p, id) => p.evaluate(i => items.find(x => x.id === i)?.qty, id);
const committed = p => p.evaluate(async () => { await AtokoreJournal.flush(); return AtokoreJournal.readStored(); });
const cq = async (p, id) => (await committed(p)).items.find(x => x.id === id)?.qty;
test('① two tabs from the same base: different products 2/3, the same product 3; after a restart too', async ({ browser }, info) => {
  const { ctx, a, b } = await tabs(browser, info);
  try {
    await Promise.all([a.evaluate(() => adj(1, 1)), b.evaluate(() => adj(2, 1))]);          // 牛乳 1->2, おむつ 2->3
    expect([await cq(a, 1), await cq(a, 2)]).toEqual([2, 3]);
    await Promise.all([a.evaluate(() => adj(3, 1)), b.evaluate(() => adj(3, 1))]);          // 卵 6 -> 8 (both counted)
    await Promise.all([a, b].map(p => p.evaluate(() => AtokoreJournal.flush())));
    expect(await cq(b, 3)).toBe(8);
    await b.evaluate(() => { window.__hold = false; });
    for (const p of [a, b]) { await p.reload(); await p.waitForFunction(() => !!document.getElementById('bfNavAdd')); await p.evaluate(() => AtokoreJournal.ready); }
    for (const p of [a, b]) expect([await qty(p, 1), await qty(p, 2), await qty(p, 3)]).toEqual([2, 3, 8]);
    expect(a.__errors).toEqual([]); expect(b.__errors).toEqual([]);
  } finally { await ctx.close(); }
});
test('① a tab whose commit cannot run is closed: its change is recovered from its log on the next start, once', async ({ browser }, info) => {
  const { ctx, a, b } = await tabs(browser, info);
  try {
    await b.evaluate(() => { const t = IDBDatabase.prototype.transaction; IDBDatabase.prototype.transaction = function (n, m) { if (m === 'readwrite') throw new DOMException('blocked (test)', 'InvalidStateError'); return t.apply(this, arguments); }; });
    await b.evaluate(() => adj(2, 1));                                                     // shown as saved: kept in B's log
    expect(await b.evaluate(() => AtokoreJournal.pendingCount())).toBeGreaterThan(0);
    await b.close();                                                                        // the tab ends before it could commit
    const c = await ctx.newPage(); await open(c, null); await c.evaluate(() => AtokoreJournal.ready);
    expect(await cq(c, 2)).toBe(3);                                                         // recovered once
    await c.reload(); await c.waitForFunction(() => !!document.getElementById('bfNavAdd')); await c.evaluate(() => AtokoreJournal.ready);
    expect(await cq(c, 2)).toBe(3);                                                         // never twice
    expect(await a.evaluate(async () => { await new Promise(r => setTimeout(r, 300)); return items.find(x => x.id === 2).qty; })).toBe(3);
  } finally { await ctx.close(); }
});
test('① the log cannot be written (storage full): the save is refused and said so; nothing is applied later', async ({ browser }, info) => {
  const { ctx, a, b } = await tabs(browser, info);
  try {
    const before = await cq(a, 1);
    await a.evaluate(() => { const o = Storage.prototype.setItem; Storage.prototype.setItem = function (k, v) { if (/:wal:/.test(k)) throw new DOMException('full (test)', 'QuotaExceededError'); return o.apply(this, arguments); }; });
    const ok = await a.evaluate(() => { const x = items.find(i => i.id === 1); x.qty += 1; return save(); });
    expect(ok).toBe(false);
    await expect(a.locator('#atkSafetyBanner')).toHaveClass(/on/);
    expect(await qty(a, 1)).toBe(before);                                                   // the screen shows what is stored
    expect(await cq(b, 1)).toBe(before);
  } finally { await ctx.close(); }
});
// Work 10th hypothesis 1, reproduced on CI WebKit (#117, run 45992973319): two tabs saved the same product at
// once; the slower tab's cache write (from before the other tab's commit) landed after the newest commit, and
// the next start adopted that cache as "newer than IndexedDB" -> 卵 8 became 7. Deterministic form: a cache of
// THIS version (its digest matches) that is older than the committed state is written, then the app restarts.
// Like the other tests here, without the service worker (WebKit reports its registration cut by a reload
// as a page error; the PWA has its own tests).
test.describe('① restart', () => {
test.use({ serviceWorkers: 'block' });
test('① a late cache write of this version that is older than the committed state never replaces it on restart', async ({ page }) => {
  await open(page, { [KEY]: baseState() });
  await page.evaluate(() => AtokoreJournal.ready);
  await page.evaluate(() => { adj(3, 1); adj(3, 1); });                       // 卵 6 -> 8
  await page.evaluate(() => AtokoreJournal.flush());
  expect((await page.evaluate(() => AtokoreJournal.readStored())).items.find(x => x.id === 3).qty).toBe(8);
  // The late write itself happens outside this tab's save path (another tab's writeCache): it is placed
  // before the app's scripts on the next start, exactly as the other tab left it.
  await page.evaluate(key => {
    const digest = raw => { let h = 0x811c9dc5; for (let i = 0; i < raw.length; i++) { h ^= raw.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return raw.length + '.' + h.toString(36); };
    const stale = JSON.parse(localStorage.getItem(key)); stale.items.find(x => x.id === 3).qty = 7;
    const raw = JSON.stringify(stale);
    sessionStorage.setItem('__qaStale', JSON.stringify([key, raw, digest(raw)]));
  }, KEY);
  await page.addInitScript(() => {
    const s = sessionStorage.getItem('__qaStale'); if (!s) return; sessionStorage.removeItem('__qaStale');
    const [key, raw, sum] = JSON.parse(s); localStorage.setItem(key + ':jsum', sum); localStorage.setItem(key, raw);
  });
  await page.reload();
  await page.waitForFunction(() => !!document.getElementById('bfNavAdd'));
  await page.evaluate(() => AtokoreJournal.ready);
  expect(await page.evaluate(() => items.find(x => x.id === 3).qty)).toBe(8);
  expect((await page.evaluate(() => AtokoreJournal.readStored())).items.find(x => x.id === 3).qty).toBe(8);
  expect(await page.evaluate(k => JSON.parse(localStorage.getItem(k)).items.find(x => x.id === 3).qty, KEY)).toBe(8);   // the cache is rewritten
  expect(page.__errors).toEqual([]);
});
});
