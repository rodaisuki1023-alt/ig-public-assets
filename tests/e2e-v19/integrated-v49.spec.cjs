// Integration of the compact/month-age views and the current receipt review.
// Synthetic text only; shared services are not contacted.
const { test, expect } = require('@playwright/test');
const { open, go, stored, KEY } = require('./helpers.cjs');

test.use({ serviceWorkers: 'block' });

test('receipt review respects text size, saves once and retains manual age in the compact stock view', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  const initial = {
    items: [{ id: 1, name: 'テストスープ', cat: '離乳食', qty: 1, unit: '個', place: '食品棚', expType: '期限なし', exp: '', babyFoodMonth: 7 }],
    buys: [{ id: 10, name: 'テストスープ', cat: '離乳食', qty: 1, unit: '個', stockId: 1, babyFoodMonth: 7 }],
    routines: [],
  };
  await open(page, { [KEY]: initial });

  async function reviewAtSize(size) {
    await page.evaluate(value => { setAtokoreDisplay('font', value); closeM(); }, size);
    await go(page, 'premium');
    await page.locator('#pg-premium .premium').filter({ hasText: 'レシート一括補充' }).click();
    await page.locator('summary').filter({ hasText: 'レシートの文字を貼って読み取る' }).click();
    await page.fill('#receiptManualText', 'テストスープ ¥100\n小計 1点 ¥100');
    await page.getByRole('button', { name: '商品名を解析' }).click();
    const title = page.getByRole('heading', { name: '🧾 読み取り結果の確認' });
    await expect(title).toBeVisible();
    await expect.poll(() => page.locator('.receiptNameInput').evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    return title.evaluate(el => parseFloat(getComputedStyle(el).fontSize));
  }

  const small = await reviewAtSize('tiny');
  expect(await stored(page)).toEqual(initial);
  await page.evaluate(() => closeReceiptV7());
  const large = await reviewAtSize('large');
  expect(large).toBeGreaterThan(small);
  await page.locator('select[aria-label$="に対応する商品"]').selectOption({ label: '登録済み：テストスープ' });
  await page.locator('#receiptApplyBtn').click();
  expect(await stored(page)).toEqual(initial);
  await page.locator('#qaCommit').dblclick();
  await expect(page.locator('#pg-stock')).toHaveClass(/on/);
  const saved = await stored(page);
  expect(saved.items).toHaveLength(1);
  expect(saved.items[0]).toMatchObject({ id: 1, qty: 2, babyFoodMonth: 7, place: '食品棚' });
  expect(saved.buys).toEqual([]);
  await page.click('[data-atk-view="list"]');
  await expect(page.locator('#stockList .atk-food-month')).toHaveText('7か月頃から');
  await expect(page.locator('#stockList .atk-storage-place')).toContainText('食品棚');
  await page.reload();
  await go(page, 'stock');
  expect((await stored(page)).items[0]).toMatchObject({ qty: 2, babyFoodMonth: 7 });
  await expect(page.locator('html')).toHaveAttribute('data-atokore-font', 'large');
  await expect(page.locator('[data-atk-view="list"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#stockList .atk-food-month')).toHaveText('7か月頃から');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(page.__errors).toEqual([]);
});
