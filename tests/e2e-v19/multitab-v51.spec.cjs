// Work 8th (multi-tab, Chromium + WebKit): two tabs of the same phone each changed a different product; the
// tab that saved second wrote its older copy over the first (expected 2/3: Chromium 1/4, WebKit 3/2), and an
// undo after that subtracted again (device stock off by one). Deterministic fault injection: the second tab
// does not receive the first tab's storage event (held), exactly the window in which the overwrite happened.
// Now every save merges with what another tab stored (quantities add both changes, a removal wins).
const { test, expect } = require('@playwright/test');
const { open, go, stored, baseState, KEY } = require('./helpers.cjs');
async function twoTabs(browser, info) {
  const ctx = await browser.newContext({ ...info.project.use, baseURL: info.project.use.baseURL, viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const a = await ctx.newPage(); await open(a, { [KEY]: baseState() });
  const b = await ctx.newPage();
  // Fault injection in B, installed before any app script: every storage listener of the page (all modules)
  // ignores events while __hold is on, i.e. the other tab's write has not reached B yet.
  await b.addInitScript(() => {
    window.__hold = true;
    const add = window.addEventListener;
    window.addEventListener = function (type, fn, opts) {
      if (type !== 'storage' || typeof fn !== 'function') return add.call(this, type, fn, opts);
      return add.call(this, type, function (e) { if (!window.__hold) return fn.call(this, e); }, opts);
    };
  });
  await open(b, null);
  return { ctx, a, b };
}
const qtyIn = async (page, id) => page.evaluate(i => items.find(x => x.id === i)?.qty, id);
test('two tabs: +1 on different products at once -> both kept (2 / 3) in storage and in both tabs', async ({ browser }, info) => {
  const { ctx, a, b } = await twoTabs(browser, info);
  try {
    expect([await qtyIn(b, 1), await qtyIn(b, 2)]).toEqual([1, 2]);
    await a.evaluate(() => adj(1, 1));                    // tab A: 牛乳 1 -> 2 (saved)
    await b.evaluate(() => adj(2, 1));                    // tab B still holds 牛乳 1: おむつ 2 -> 3
    const s = await stored(a);
    expect([s.items.find(x => x.id === 1).qty, s.items.find(x => x.id === 2).qty]).toEqual([2, 3]);
    expect([await qtyIn(b, 1), await qtyIn(b, 2)]).toEqual([2, 3]);
    await expect.poll(async () => [await qtyIn(a, 1), await qtyIn(a, 2)]).toEqual([2, 3]);   // A adopts B's write
    // A restart of either tab shows the same.
    await a.reload(); await a.waitForFunction(() => !!document.getElementById('bfNavAdd'));
    expect([await qtyIn(a, 1), await qtyIn(a, 2)]).toEqual([2, 3]);
    // Both +1 on the SAME product: 2 + 1 + 1.
    await b.evaluate(() => { window.__hold = true; });
    await a.evaluate(() => adj(3, 1)); await b.evaluate(() => adj(3, 1));
    expect((await stored(a)).items.find(x => x.id === 3).qty).toBe(8);
    expect(a.__errors).toEqual([]); expect(b.__errors).toEqual([]);
  } finally { await ctx.close(); }
});
test("two tabs: a purchase in A, a stale save in B, then A undoes -> the purchase is undone once (stock as before, B's change kept)", async ({ browser }, info) => {
  const { ctx, a, b } = await twoTabs(browser, info);
  try {
    await a.evaluate(() => { buys.push({ id: 31, name: 'パンパース さらさらケア おむつ テープ M', qty: 1, unit: '袋', stockId: 2 }); save(); render(); });
    await b.evaluate(() => { window.__hold = false; });
    await expect.poll(() => b.evaluate(() => buys.length)).toBeGreaterThan(0);
    await b.evaluate(() => { window.__hold = true; });
    await go(a, 'buy');
    await a.locator('#buyList [data-buy-id="31"]').getByRole('button', { name: /を買った$/ }).click();
    expect(await qtyIn(a, 2)).toBe(3);                    // bought: 2 -> 3, the row is done
    await b.evaluate(() => adj(1, 1));                    // B never saw the purchase: its save must not undo it
    let s = await stored(a);
    expect([s.items.find(x => x.id === 1).qty, s.items.find(x => x.id === 2).qty, s.buys.some(x => x.id === 31)]).toEqual([2, 3, false]);
    await expect.poll(() => qtyIn(a, 1)).toBe(2);         // A adopted B's change
    await a.locator('#atkUndoBar').getByRole('button', { name: '元に戻す', exact: true }).click();
    await expect.poll(() => qtyIn(a, 2)).toBe(2);
    s = await stored(a);
    expect([s.items.find(x => x.id === 1).qty, s.items.find(x => x.id === 2).qty, s.buys.filter(x => x.id === 31).length]).toEqual([2, 2, 1]);
    // B (still holding events) saves again: nothing comes back twice, nothing is subtracted twice.
    await b.evaluate(() => adj(3, 1));
    s = await stored(a);
    expect([s.items.find(x => x.id === 1).qty, s.items.find(x => x.id === 2).qty, s.items.find(x => x.id === 3).qty, s.buys.filter(x => x.id === 31).length]).toEqual([2, 2, 7, 1]);
    expect(a.__errors).toEqual([]); expect(b.__errors).toEqual([]);
  } finally { await ctx.close(); }
});
