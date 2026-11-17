// Safe, synthetic browser coverage of the local-only packing checklist.
// Existing inventory and the family-sync backend are not modified.
const { test, expect } = require('@playwright/test');
const { open, go, stored, KEY, appConfirm, baseState } = require('./helpers.cjs');

const packKey = 'atokorePackingChecklistV1:/ig-public-assets/preview-baby-v19/';
const noHorizontalScroll = page => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);

for (const [width, height] of [[320, 568], [375, 667], [393, 852], [430, 932]]) {
  test(`packing checklist at ${width}px: toggle, persist, add, reset without changing stock`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    const original = baseState();
    await open(page, { [KEY]: original });
    const stockBefore = await stored(page);
    await go(page, 'buy');
    await expect(page.locator('#atkPackingMvp')).toBeVisible();
    await expect(page.locator('#atkPackRows .atk-pack-row')).toHaveCount(6);
    await expect(page.locator('#atkPackProgress')).toHaveText('保育園セット：0/6 準備済み');
    expect(await noHorizontalScroll(page)).toBe(true);

    await page.locator('#atkPackRows input[type=checkbox]').first().check();
    await expect(page.locator('#atkPackProgress')).toHaveText('保育園セット：1/6 準備済み');
    expect(await stored(page)).toEqual(stockBefore);
    await page.reload();
    await go(page, 'buy');
    await expect(page.locator('#atkPackRows input[type=checkbox]').first()).toBeChecked();
    await expect(page.locator('#atkPackProgress')).toHaveText('保育園セット：1/6 準備済み');

    await page.locator('[data-pack=outing]').click();
    await expect(page.locator('#atkPackProgress')).toHaveText('お出かけセット：0/6 準備済み');
    await page.locator('#atkPackAddInput').fill('日焼け止め');
    await page.locator('#atkPackAddButton').click();
    await expect(page.locator('#atkPackRows .atk-pack-row')).toHaveCount(7);
    await expect(page.locator('#atkPackRows')).toContainText('日焼け止め');

    await page.locator('#atkPackRows input[type=checkbox]').first().check();
    await page.locator('#atkPackReset').click();
    await appConfirm(page, true);
    await expect(page.locator('#atkPackProgress')).toHaveText('お出かけセット：0/7 準備済み');
    await page.locator('[data-pack=daycare]').click();
    await expect(page.locator('#atkPackProgress')).toHaveText('保育園セット：1/6 準備済み');
    expect(await stored(page)).toEqual(stockBefore);
    expect(await noHorizontalScroll(page)).toBe(true);
    expect(page.__errors).toEqual([]);
  });
}

test('packing deletion confirms in-app and does not delete inventory', async ({ page }) => {
  const original = baseState();
  await open(page, { [KEY]: original });
  const stockBefore = await stored(page);
  await go(page, 'buy');
  await page.locator('#atkPackRows .atk-pack-remove').first().click();
  await appConfirm(page, false);
  await expect(page.locator('#atkPackRows .atk-pack-row')).toHaveCount(6);
  await page.locator('#atkPackRows .atk-pack-remove').first().click();
  await appConfirm(page, true);
  await expect(page.locator('#atkPackRows .atk-pack-row')).toHaveCount(5);
  expect(await stored(page)).toEqual(stockBefore);
  expect(page.__dialogs).toEqual([]);
});

test('production and trial checklists never reuse the same storage key', async ({ page }) => {
  await open(page, { [KEY]: baseState() });
  await go(page, 'buy');
  const trialKey = await page.evaluate(() => window.AtokorePackingChecklist.key);
  expect(trialKey).toBe(packKey);
  await page.locator('#atkPackRows input[type=checkbox]').first().check();
  const saved = await page.evaluate(k => localStorage.getItem(k), trialKey);
  expect(saved).toBeTruthy();

  // The test server uses a same-origin production stand-in with household sync disabled.
  const second = await page.context().newPage();
  await second.goto('/ig-public-assets/', { waitUntil: 'load' });
  const productionKey = await second.evaluate(() => window.AtokorePackingChecklist?.key);
  expect(productionKey).toBe('atokorePackingChecklistV1:/ig-public-assets/');
  expect(productionKey).not.toBe(trialKey);
  expect(await second.evaluate(k => localStorage.getItem(k), productionKey)).toBeNull();
  expect(await second.evaluate(k => localStorage.getItem(k), trialKey)).toBe(saved);
  await second.close();
});

test('unreadable checklist is protected; trial stock remains unchanged', async ({ page }) => {
  const original = baseState();
  await open(page, { [KEY]: original, [packKey]: '{broken-json' });
  const stockBefore = await stored(page);
  await go(page, 'buy');
  await expect(page.locator('#atkPackAddButton')).toBeDisabled();
  await expect(page.locator('#atkPackError')).toContainText('変更を停止しています');
  expect(await page.evaluate(k => localStorage.getItem(k), packKey)).toBe('{broken-json');
  expect(await stored(page)).toEqual(stockBefore);
});
