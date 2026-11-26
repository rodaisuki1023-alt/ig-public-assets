// Work (Chromium + WebKit): while the shared undo of purchase A waits for the server, the person buys
// B; when A's answer arrives it used to remove B's undo bar and B's 「直前の「買った」」 too. Every undo
// state now belongs to one purchase: A's answer (success or failure) leaves B's bar, B's button and B's
// own 10-minute window as they are.
const { test, expect } = require('@playwright/test');
const { open, go, stored, baseState, KEY, appConfirm } = require('./helpers.cjs');
const EMU = 'http://127.0.0.1:' + (process.env.E2E_HH_PORT || 4720);
const CFG = { url: EMU, anonKey: 'emu-anon-key', google: true, guest: true, email: false };
const MILK = '牛乳', DIAPER = 'パンパース さらさらケア おむつ テープ M';
async function sharedPhone(browser, info, request) {
  await request.post(EMU + '/__test/reset');
  const ctx = await browser.newContext({ ...info.project.use, baseURL: info.project.use.baseURL, viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage(); page.__errors = []; page.on('pageerror', e => page.__errors.push(e.message));
  await page.addInitScript(c => window.ATOKORE_HOUSEHOLD_CONFIG = c, CFG);
  const s = baseState();
  s.buys = [{ id: 20, name: MILK, qty: 1, unit: '本', stockId: 1 }, { id: 21, name: DIAPER, qty: 1, unit: '袋', stockId: 2 }];
  await open(page, { [KEY]: s });
  await go(page, 'premium'); await page.click('#atkHouseholdCard');
  await page.getByRole('button', { name: 'Googleでログイン', exact: true }).click();
  await page.fill('#atkHhName', 'パパ'); await page.getByRole('button', { name: '世帯を作る', exact: true }).click(); await appConfirm(page, true);
  await expect(page.locator('#atkHouseholdStatus')).toHaveText(/^(\d+人で共有中|家族と共有中)$/);
  await page.getByRole('button', { name: '閉じる', exact: true }).click();
  await page.evaluate(() => window.AtokoreHousehold.syncNow());
  await go(page, 'buy');
  return { ctx, page };
}
// Holds the FIRST undo request until released (continue = server answer, fail = network/server error).
async function holdFirstUndo(page) {
  let release; const held = new Promise(r => { release = r; }); let first = true;
  await page.route('**/rest/v1/rpc/hh_undo_purchases', async route => {
    if (!first) return route.continue();
    first = false;
    const how = await held;
    if (how === 'fail') return route.fulfill({ status: 503, contentType: 'application/json', body: '{"message":"unavailable"}' });
    return route.continue();
  });
  return how => release(how);
}
const qty = async (page, name) => (await stored(page)).items.find(x => x.name === name).qty;
const ROW = { [MILK]: 20, [DIAPER]: 21 };
const buy = (page, name) => page.locator(`#buyList [data-buy-id="${ROW[name]}"]`).getByRole('button', { name: /を買った$/ }).click();
const bar = page => page.locator('#atkUndoBar');
const last = page => page.locator('#atkLastPurchaseUndo');

for (const outcome of ['success', 'fail']) test(`A's undo answer (${outcome}) after B was bought leaves B's bar, B's button and B's window`, async ({ browser, request }, info) => {
  test.setTimeout(120000);
  const { ctx, page } = await sharedPhone(browser, info, request);
  try {
    const milk0 = await qty(page, MILK), diaper0 = await qty(page, DIAPER);
    await buy(page, MILK);
    await expect(bar(page)).toBeVisible();
    const release = await holdFirstUndo(page);
    await bar(page).getByRole('button', { name: '元に戻す', exact: true }).click();   // A: waiting for the server
    await buy(page, DIAPER);                                                           // B, meanwhile
    await expect(last(page)).toContainText('パンパース');
    await expect(bar(page)).toBeVisible();
    release(outcome);
    // A's answer has arrived: B's undo bar and B's button are still there, usable, with no foreign error.
    if (outcome === 'success') await expect.poll(() => qty(page, MILK)).toBe(milk0);
    else await page.waitForTimeout(300);
    await expect(bar(page)).toBeVisible();
    await expect(bar(page).getByRole('button', { name: '元に戻す', exact: true })).toBeEnabled();
    await expect(bar(page)).not.toContainText('戻せませんでした');
    await expect(last(page)).toContainText('パンパース');
    await expect(last(page).getByRole('button', { name: '取り消す' })).toBeEnabled();
    await expect(last(page)).toContainText('あと10分取り消せます');                   // B's own window
    await expect(last(page).locator('[role=alert]')).toHaveCount(0);
    // B can be undone, once.
    await bar(page).getByRole('button', { name: '元に戻す', exact: true }).click();
    await expect.poll(() => qty(page, DIAPER)).toBe(diaper0);
    await expect(last(page)).toHaveCount(0);
    const s = await stored(page);
    expect(s.buys.filter(b => b.name === DIAPER)).toHaveLength(1);                    // the row came back once
    if (outcome === 'fail') { expect(await qty(page, MILK)).toBe(milk0 + 1); expect(s.buys.filter(b => b.name === MILK)).toHaveLength(0); }
    else expect(s.buys.filter(b => b.name === MILK)).toHaveLength(1);
    expect(page.__errors).toEqual([]);
  } finally { await ctx.close(); }
});
test('the same through the shopping-page button, with answers in reversed order and a double tap', async ({ browser, request }, info) => {
  test.setTimeout(120000);
  const { ctx, page } = await sharedPhone(browser, info, request);
  try {
    const milk0 = await qty(page, MILK), diaper0 = await qty(page, DIAPER);
    await buy(page, MILK);
    await go(page, 'home'); await go(page, 'buy');                                     // bar gone; button remains
    await expect(bar(page)).toHaveCount(0);
    const release = await holdFirstUndo(page);
    await last(page).getByRole('button', { name: '取り消す' }).click();               // A via the button: held
    await expect(last(page).getByRole('button', { name: '取り消し中…' })).toBeDisabled();
    await buy(page, DIAPER);                                                           // B replaces the button
    await expect(last(page)).toContainText('パンパース');
    await expect(last(page).getByRole('button', { name: '取り消す' })).toBeEnabled();  // B is not "busy" because of A
    // B's undo answers first (double tap -> one undo), A's answer comes last.
    await last(page).getByRole('button', { name: '取り消す' }).evaluate(b => { b.click(); b.click(); });
    await expect.poll(() => qty(page, DIAPER)).toBe(diaper0);
    release('success');
    await expect.poll(() => qty(page, MILK)).toBe(milk0);
    const s = await stored(page);
    expect(s.buys.filter(b => b.name === DIAPER)).toHaveLength(1);
    expect(s.buys.filter(b => b.name === MILK)).toHaveLength(1);
    await expect(last(page)).toHaveCount(0);
    expect(page.__errors).toEqual([]);
  } finally { await ctx.close(); }
});
test('A fails through the shopping-page button after B was bought: the error stays with A, B is clean and usable', async ({ browser, request }, info) => {
  test.setTimeout(120000);
  const { ctx, page } = await sharedPhone(browser, info, request);
  try {
    const diaper0 = await qty(page, DIAPER);
    await buy(page, MILK);
    await go(page, 'home'); await go(page, 'buy');
    const release = await holdFirstUndo(page);
    await last(page).getByRole('button', { name: '取り消す' }).click();
    await buy(page, DIAPER);
    release('fail');
    await page.waitForTimeout(500);
    await expect(last(page)).toContainText('パンパース');
    await expect(last(page).locator('[role=alert]')).toHaveCount(0);                  // A's error is not shown on B
    await expect(last(page).getByRole('button', { name: '取り消す' })).toBeEnabled();
    await last(page).getByRole('button', { name: '取り消す' }).click();
    await expect.poll(() => qty(page, DIAPER)).toBe(diaper0);
    expect(page.__errors).toEqual([]);
  } finally { await ctx.close(); }
});
