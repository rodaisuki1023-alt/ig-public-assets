// W2 items 6 and 7: history entries open the product / the targets / the record of a deleted product,
// read "who: product + verb" with "この端末" when not sharing; attention cards show text reasons;
// the price report never shows unrecorded prices as 0円.
const { test, expect } = require('@playwright/test');
const { open, go, stored, baseState, KEY, appConfirm } = require('./helpers.cjs');
test.use({ viewport: { width: 390, height: 844 }, timezoneId: 'Asia/Tokyo' });

const history = page => page.locator('#atkHomeActivity .atk-home-change-open');

test('one product opens its detail; several open the list of targets; a deleted product shows the record marked 削除済み', async ({ page }) => {
  await open(page, { [KEY]: baseState() });
  await go(page, 'stock');
  await page.locator('#stockList [data-stock-id="1"] .qty button').last().click(); // 牛乳 1 → 2
  await page.evaluate(() => { stockSelectMode = true; stockSelected.add(1); stockSelected.add(3); moveSelectedToBuy(); });
  await page.evaluate(() => delItem(3)); await appConfirm(page, true); // 卵 deleted
  await go(page, 'home');
  const titles = await history(page).locator('strong').allTextContents();
  expect(titles).toEqual(['この端末：卵をストックから削除', 'この端末：牛乳 ほか1商品を買い物リストに追加', 'この端末：牛乳の在庫数を変更']);
  await expect(history(page).nth(2).locator('small')).toHaveText('1本 → 2本');
  await expect(page.locator('#atkHomeActivity')).not.toContainText('自分');

  // Single product -> its current detail.
  await history(page).nth(2).click();
  await expect(page.locator('#sheet [data-atk-detail-id="1"]')).toBeVisible();
  await page.click('#sheet .close');
  // Several products -> the list of targets; the deleted one is marked, the other opens.
  await history(page).nth(1).click();
  await expect(page.locator('#sheet h2')).toHaveText('対象の商品（2件）');
  await expect(page.locator('.atk-history-targets')).toContainText('削除済み');
  await page.locator('.atk-history-targets [data-atk-history-item="1"]').click();
  await expect(page.locator('#sheet [data-atk-detail-id="1"]')).toBeVisible();
  await page.click('#sheet .close');
  // Deleted product -> the record of the time, marked 削除済み.
  await history(page).nth(0).click();
  await expect(page.locator('#sheet h2')).toHaveText('変更の記録');
  await expect(page.locator('.atk-history-record')).toContainText('この端末：卵をストックから削除');
  await expect(page.locator('.atk-history-deleted')).toHaveText('削除済み');
  expect(page.__errors).toEqual([]);
});

test('attention card shows both reasons as text; the price report says 価格未記録 and its scope', async ({ page }) => {
  const today = await page.evaluate(() => { const d = new Date(); return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-'); });
  const [, m, d] = today.split('-').map(Number);
  await open(page, { [KEY]: baseState({ items: [
    { id: 1, name: 'ヨーグルト', cat: '食料品', qty: 1, unit: '個', minQty: 2, expType: '消費期限', exp: today, price: 150 },
    { id: 2, name: 'おしりふき', cat: 'ベビー', qty: 1, unit: 'パック', expType: '期限なし', exp: '' },
    { id: 3, name: '米', cat: '食料品', qty: 5, unit: '袋', expType: '賞味期限', exp: '2099-01-01' },
  ], buys: [], routines: [] }) });
  await go(page, 'home');
  const yogurt = page.locator('#atkTasks .atk-home-stock-wrap').filter({ hasText: 'ヨーグルト' });
  await expect(yogurt.locator('.atk-home-low')).toHaveText('補充目安以下：残り1個／目安2個');
  await expect(yogurt.locator('.atk-home-expiry')).toHaveText(`消費期限：今日まで（${m}/${d}まで）`);
  const wipes = page.locator('#atkTasks .atk-home-stock-wrap').filter({ hasText: 'おしりふき' });
  await expect(wipes.locator('.atk-home-low')).toHaveText('補充目安以下：残り1パック／目安1パック');
  await expect(wipes.locator('.atk-home-expiry')).toHaveCount(0);

  await page.evaluate(() => showPremium('money'));
  await expect(page.locator('.atk-insight-scope')).toHaveText('価格記録あり：1／3商品。未記録の商品は合計に含みません。');
  await expect(page.locator('.atk-insight-row').filter({ hasText: 'おしりふき' }).locator('strong')).toHaveText('おしりふき：価格未記録');
  await expect(page.locator('.atk-insight-row').filter({ hasText: 'ヨーグルト' }).locator('strong')).toHaveText('ヨーグルト：¥150');
  await expect(page.locator('#sheet')).not.toContainText('¥0');
  await expect(page.locator('#sheet')).not.toContainText('0円（無料）'); // only for products confirmed free
  expect(page.__errors).toEqual([]);
});

test('sharing: the member name is the actor, records from before sharing are labelled, and a shared entry opens the product', async ({ browser, request }, info) => {
  test.setTimeout(90000);
  const EMU = 'http://127.0.0.1:' + (process.env.E2E_HH_PORT || 4720);
  const CFG = { url: EMU, anonKey: 'emu-anon-key', google: true, guest: true, email: false };
  await request.post(EMU + '/__test/reset');
  const ctx = await browser.newContext({ ...info.project.use, baseURL: info.project.use.baseURL });
  const page = await ctx.newPage();
  try {
    await page.addInitScript(c => window.ATOKORE_HOUSEHOLD_CONFIG = c, CFG);
    await open(page, { [KEY]: baseState() });
    await go(page, 'stock');
    await page.locator('#stockList [data-stock-id="1"] .qty button').last().click(); // before sharing
    await page.waitForTimeout(50);
    await go(page, 'premium'); await page.click('#atkHouseholdCard');
    await page.getByRole('button', { name: 'Googleでログイン', exact: true }).click();
    await page.fill('#atkHhName', 'パパ'); await page.getByRole('button', { name: '世帯を作る', exact: true }).click(); await appConfirm(page, true);
    await expect(page.locator('#atkHouseholdStatus')).toHaveText(/人で共有中|家族と共有中/);
    await page.getByRole('button', { name: '閉じる', exact: true }).click();
    await go(page, 'stock');
    await page.locator('#stockList [data-stock-id="1"] .qty button').last().click(); // while sharing
        await expect.poll(async () => { await page.evaluate(() => AtokoreHousehold.syncNow()); await page.evaluate(() => AtokoreHousehold.refreshChanges()); return page.evaluate(() => AtokoreHousehold.homeState().changes.some(r => r.type === 'add')); }, { timeout: 20000 }).toBe(true);
    await go(page, 'home');
    await expect(page.locator('#atkHomeActivity')).toContainText('パパ：牛乳の数量を変更');
    await page.click('#atkHomeAllChanges');
    await expect(page.locator('#sheet')).toContainText('この端末・共有前の記録：牛乳の在庫数を変更');
    await page.locator('#sheet .atk-home-change-open', { hasText: 'パパ：牛乳の数量を変更' }).click();
    await expect(page.locator('#sheet [data-atk-detail-id="1"]')).toBeVisible();
    expect(page.__errors).toEqual([]);
  } finally { await ctx.close(); }
});
