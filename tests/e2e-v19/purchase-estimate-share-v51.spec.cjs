// Muse P1-1 while sharing: a purchase reaches the estimate once on the buyer's phone, the estimate
// travels to the family as an ordinary field (never re-added there), and the shared undo reverts both.
const { test, expect } = require('@playwright/test');
const { open, go, stored, baseState, KEY, appConfirm } = require('./helpers.cjs');
const EMU = 'http://127.0.0.1:' + (process.env.E2E_HH_PORT || 4720);
const CFG = { url: EMU, anonKey: 'emu-anon-key', google: true, guest: true, email: false };
const localDay = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const NAME = 'パンパース さらさらケア おむつ テープ M';

async function household(browser, info, request, state) {
  await request.post(EMU + '/__test/reset');
  async function device(st) { const ctx = await browser.newContext({ ...info.project.use, baseURL: info.project.use.baseURL, viewport: { width: 390, height: 844 } }); const page = await ctx.newPage(); await page.addInitScript(c => window.ATOKORE_HOUSEHOLD_CONFIG = c, CFG); await open(page, { [KEY]: st }); return { ctx, page }; }
  const a = await device(state), b = await device({ items: [], buys: [], routines: [] });
  await go(a.page, 'premium'); await a.page.click('#atkHouseholdCard');
  await a.page.getByRole('button', { name: 'Googleでログイン', exact: true }).click();
  await a.page.fill('#atkHhName', 'パパ'); await a.page.getByRole('button', { name: '世帯を作る', exact: true }).click(); await appConfirm(a.page, true);
  await expect(a.page.locator('#atkHouseholdStatus')).toHaveText(/^(\d+人で共有中|家族と共有中)$/);
  await a.page.getByRole('button', { name: /家族を招待する/ }).click();
  const link = await a.page.locator('#atkHhInviteLink').inputValue();
  await b.page.goto(link); await b.page.fill('#atkHhGuestName', 'ママ');
  await b.page.getByRole('button', { name: 'Googleなしで共有に参加する', exact: true }).click();
  await expect(b.page.locator('#atkHouseholdStatus')).toHaveText(/^(\d+人で共有中|家族と共有中)$/);
  await b.page.getByRole('button', { name: '閉じる', exact: true }).click(); await a.page.getByRole('button', { name: '閉じる', exact: true }).click();
  return { a, b };
}
const est = p => p.evaluate(([n, d]) => { const x = items.find(i => i.name === n); return AtokoreStockLevels.estimate(x, d); }, [NAME, localDay()]);
const sync = p => p.evaluate(() => window.AtokoreHousehold.syncNow());
const tracked = () => ({ v: 1, base: 120, since: localDay(), perDay: 6, perPack: 60, refillDays: 5, pieceUnit: '枚', size: null, snoozeUntil: null, confirmedAt: localDay(), t: Date.now() - 60000, seen: [] });
function startState(rows) {
  const s = baseState();
  s.items[1] = { ...s.items[1], qty: 2, track: tracked() };
  s.buys = rows.map((id, i) => ({ id, name: NAME, qty: 1, unit: '袋', stockId: 2 }));
  return s;
}

test('family: two phones buy offline at the same time -> 120 + 60 + 60 = 240 on both; undo one -> 180; resend adds nothing', async ({ browser, request }, info) => {
  test.setTimeout(180000);
  const { a, b } = await household(browser, info, request, startState([20, 21]));
  const diaper = async p => (await stored(p)).items.find(x => x.name === NAME);
  try {
    await expect.poll(async () => (await est(b.page))?.remaining).toBe(120);
    await expect.poll(async () => (await stored(b.page)).buys.length).toBe(2);
    await go(a.page, 'buy'); await go(b.page, 'buy');
    // Both phones lose the connection, and each buys a DIFFERENT shopping row of the same product.
    await a.ctx.setOffline(true); await b.ctx.setOffline(true);
    const rowsA = a.page.getByRole('button', { name: NAME + 'を買った', exact: true });
    await rowsA.first().click();
    // B buys the row A did not buy (both rows look the same, so pick by shared id).
    const remainingSidsA = await a.page.evaluate(() => buys.map(x => window.AtokoreHousehold.sharedIdFor('buy', x.id)));
    const bRow = await b.page.evaluate(sids => { const r = buys.find(x => sids.includes(window.AtokoreHousehold.sharedIdFor('buy', x.id))); return r ? r.id : null; }, remainingSidsA);
    expect(bRow).not.toBe(null);
    await b.page.locator(`#buyList [data-buy-id="${bRow}"]`).getByRole('button', { name: /を買った$/ }).click();
    expect((await est(a.page)).remaining).toBe(180);
    expect((await est(b.page)).remaining).toBe(180);
    // Back online, in reversed order, with repeated syncs (resends).
    await b.ctx.setOffline(false); await a.ctx.setOffline(false);
    for (const p of [b.page, a.page, b.page]) await sync(p);
    await expect.poll(async () => (await diaper(a.page)).qty).toBe(4);
    await expect.poll(async () => (await diaper(b.page)).qty).toBe(4);
    expect((await est(a.page)).remaining).toBe(240);
    expect((await est(b.page)).remaining).toBe(240);

    // A undoes only its own purchase (the undo bar is offered for 20 seconds after buying).
    await a.page.getByRole('button', { name: '元に戻す', exact: true }).click();
    await expect(a.page.locator('#atkUndoBar')).toHaveCount(0);
    // Repeated syncs in both directions (resends) change nothing further.
    for (const p of [a.page, b.page, a.page, b.page, a.page]) await sync(p);
    await expect.poll(async () => (await diaper(b.page)).qty).toBe(3);
    expect((await est(a.page)).remaining).toBe(180);
    expect((await est(b.page)).remaining).toBe(180);
    expect(a.page.__errors).toEqual([]); expect(b.page.__errors).toEqual([]);
  } finally { await a.ctx.close(); await b.ctx.close(); }
});

test('family: both phones mark the SAME shopping row bought offline -> one restock and one purchase in the estimate', async ({ browser, request }, info) => {
  test.setTimeout(180000);
  const { a, b } = await household(browser, info, request, startState([20]));
  const diaper = async p => (await stored(p)).items.find(x => x.name === NAME);
  try {
    await expect.poll(async () => (await stored(b.page)).buys.length).toBe(1);
    await go(a.page, 'buy'); await go(b.page, 'buy');
    await a.ctx.setOffline(true); await b.ctx.setOffline(true);
    await a.page.getByRole('button', { name: NAME + 'を買った', exact: true }).click();
    await b.page.getByRole('button', { name: NAME + 'を買った', exact: true }).click();
    await a.ctx.setOffline(false); await b.ctx.setOffline(false);
    for (const p of [a.page, b.page, a.page, b.page]) await sync(p);
    const qa = (await diaper(a.page)).qty, qb = (await diaper(b.page)).qty;
    expect(qa).toBe(qb);
    // The estimate follows the shared restock: one bag of 60 for one row.
    const added = (qa - 2) * 60;
    expect((await est(a.page)).remaining).toBe(120 + added);
    expect((await est(b.page)).remaining).toBe(120 + added);
    expect(a.page.__errors).toEqual([]); expect(b.page.__errors).toEqual([]);
  } finally { await a.ctx.close(); await b.ctx.close(); }
});

test('family: a correction made without seeing the other phone\'s purchase asks to check instead of guessing', async ({ browser, request }, info) => {
  test.setTimeout(180000);
  const { a, b } = await household(browser, info, request, startState([20]));
  try {
    await expect.poll(async () => (await est(b.page))?.remaining).toBe(120);
    await go(a.page, 'buy');
    await a.ctx.setOffline(true); await b.ctx.setOffline(true);
    await a.page.getByRole('button', { name: NAME + 'を買った', exact: true }).click();
    // B, offline and unaware, counts the stock and corrects it a moment later.
    await b.page.waitForTimeout(20);
    const id = await b.page.evaluate(n => items.find(x => x.name === n).id, NAME);
    await b.page.evaluate(i => window.atkShowDetail(i), id);
    await b.page.locator('#sheet .atk-level [data-atk-level-left]').fill('100');
    await b.page.locator('#sheet .atk-level [data-atk-level-fix="still"]').click();
    await a.ctx.setOffline(false); await b.ctx.setOffline(false);
    for (const p of [a.page, b.page, a.page, b.page]) await sync(p);
    // Whichever write wins for the correction, the purchase is neither lost nor doubled silently.
    const ea = await est(a.page), eb = await est(b.page);
    expect(ea).toEqual(eb);
    expect(ea).toEqual({ status: 'unknown', reason: 'purchase_overlap' });
    expect(a.page.__errors).toEqual([]); expect(b.page.__errors).toEqual([]);
  } finally { await a.ctx.close(); await b.ctx.close(); }
});
