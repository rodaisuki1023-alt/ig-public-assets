// Shopping rows that may be the same product (v48.2): a notice and a small tag only.
// Nothing is merged, removed or changed, and 買った / 元に戻す / 削除 keep working on each row.
const { test, expect } = require('@playwright/test');
const { open, go, stored, baseState, KEY, shot, appConfirm } = require('./helpers.cjs');

const state = () => baseState({
  items: [{ id: 1, name: '牛乳', cat: '食料品', qty: 1, unit: '本', expType: '期限なし', exp: '' }],
  buys: [
    // the case this is for: two people added the same product at almost the same time
    { id: 9, name: '牛乳', qty: 1, unit: '本', stockId: 1, cat: '食料品' },
    { id: 11, name: '牛乳', qty: 2, unit: '本', cat: '食料品' },
    // size in the name differs -> different products
    { id: 12, name: 'パンパース さらさらケア テープ M', qty: 1, unit: '袋', cat: 'ベビー' },
    { id: 13, name: 'パンパース さらさらケア テープ L', qty: 1, unit: '袋', cat: 'ベビー' },
    // unit differs -> different products
    { id: 14, name: 'おしりふき', qty: 1, unit: 'パック', cat: 'ベビー' },
    { id: 15, name: 'おしりふき', qty: 1, unit: '個', cat: 'ベビー' },
    // category differs -> different products
    { id: 16, name: 'ミルク', qty: 1, unit: '本', cat: '食料品' },
    { id: 17, name: 'ミルク', qty: 1, unit: '本', cat: 'ベビー' },
  ],
  routines: [],
});
const notice = page => page.locator('#atkBuyDupNotice');

for (const width of [320, 375, 390]) {
  test(`${width}px: only the same name + unit + category is flagged, readable, no sideways scroll, nothing changed`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 800 });
    const initial = state();
    await open(page, { [KEY]: initial });
    await go(page, 'buy');
    await expect(notice(page)).toBeVisible();
    await expect(notice(page)).toHaveText('同じ名前・単位の商品が複数あります：牛乳（2行）。必要に応じて確認してください。数量や行は自動で変更しません。');
    await expect(page.locator('#buyList .atk-buy-dup-tag')).toHaveCount(2);
    for (const id of ['9', '11']) await expect(page.locator(`#buyList [data-buy-id="${id}"] .atk-buy-dup-tag`)).toHaveText('同じ商品が複数行');
    for (const id of ['12', '13', '14', '15', '16', '17']) await expect(page.locator(`#buyList [data-buy-id="${id}"] .atk-buy-dup-tag`)).toHaveCount(0);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    const box = await notice(page).boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    expect((await stored(page)).buys).toEqual(initial.buys);
    await shot(page, info, `w2-buy-duplicates-${width}`);
    expect(page.__errors).toEqual([]);
  });
}

test('a row without a category is only "重複の可能性"', async ({ page }) => {
  await open(page, { [KEY]: baseState({ buys: [{ id: 9, name: '牛乳', qty: 1, unit: '本', cat: '食料品' }, { id: 11, name: '牛乳', qty: 1, unit: '本' }], routines: [] }) });
  await go(page, 'buy');
  await expect(notice(page)).toContainText('重複の可能性があります');
  await expect(notice(page)).not.toContainText('同じ名前・単位の商品が複数あります');
  await expect(page.locator('#buyList .atk-buy-dup-tag').first()).toHaveText('重複の可能性');
});

test('no duplicates: no notice', async ({ page }) => {
  await open(page, { [KEY]: baseState() });
  await go(page, 'buy');
  await expect(page.locator('#buyList [data-buy-id]')).toHaveCount(1);
  await expect(notice(page)).toHaveCount(0);
});

test('買った, 元に戻す and 削除 work on each flagged row; the notice follows the list', async ({ page }) => {
  await open(page, { [KEY]: state() });
  await go(page, 'buy');
  // 買った on one 牛乳 row: that row goes to stock, the other stays, the notice goes away.
  await page.locator('#buyList [data-buy-id="9"] .stableBuyStock').click();
  await expect(page.locator('#buyList [data-buy-id="9"]')).toHaveCount(0);
  await expect(page.locator('#buyList [data-buy-id="11"]')).toBeVisible();
  await expect(notice(page)).toHaveCount(0);
  expect((await stored(page)).items.find(x => x.id === 1).qty).toBe(2);
  // 元に戻す brings the row back unchanged, and the notice with it.
  await page.locator('#atkUndoBar button', { hasText: '元に戻す' }).click();
  await expect(page.locator('#buyList [data-buy-id="9"]')).toBeVisible();
  await expect(notice(page)).toBeVisible();
  expect((await stored(page)).items.find(x => x.id === 1).qty).toBe(1);
  expect((await stored(page)).buys.filter(x => x.name === '牛乳').map(x => [x.id, x.qty]).sort()).toEqual([[11, 2], [9, 1]].sort());
  // 削除 from the row menu removes only that row.
  await page.locator('#buyList [data-buy-id="11"] .stableBuyMore').click();
  await page.locator('#buyMenu11 .danger').click();
  await appConfirm(page, true);
  await expect(page.locator('#buyList [data-buy-id="11"]')).toHaveCount(0);
  await expect(page.locator('#buyList [data-buy-id="9"]')).toBeVisible();
  await expect(notice(page)).toHaveCount(0);
  expect((await stored(page)).buys.find(x => x.id === 9).qty).toBe(1);
  expect(page.__errors).toEqual([]);
});
