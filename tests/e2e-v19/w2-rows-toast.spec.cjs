// W2 items 3 and 4: shopping-row delete lives in a "…" menu away from "✓ 買った", ＋/− are at least
// 44×44 with 8px gaps; photo notices appear only when the product has a photo.
const zlib = require('node:zlib');
const { test, expect } = require('@playwright/test');
const { open, go, stored, baseState, KEY, shot, appConfirm } = require('./helpers.cjs');

function crc32(data) { let crc = 0xffffffff; for (const b of data) { crc ^= b; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); } return (crc ^ 0xffffffff) >>> 0; }
function chunk(type, data) { const label = Buffer.from(type), size = Buffer.alloc(4), crc = Buffer.alloc(4); size.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(Buffer.concat([label, data]))); return Buffer.concat([size, label, data, crc]); }
function png() {
  const header = Buffer.alloc(13); header.writeUInt32BE(30, 0); header.writeUInt32BE(30, 4); header[8] = 8; header[9] = 2;
  const pixels = Buffer.alloc(30 * 91, 120);
  return { name: 'p.png', mimeType: 'image/png', buffer: Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]) };
}
const toastTexts = page => page.evaluate(() => [...document.querySelectorAll('#stableToastV125h,#qaNotice')].map(n => n.textContent));
async function rename(page, id, name) {
  await page.evaluate(id => window.atokoreEditStock(id), id);
  await page.fill('#atkEditName', name);
  await page.click('.atk-edit-save');
  await expect.poll(async () => (await stored(page)).items.find(x => x.id === id).name).toBe(name);
}

for (const [width, height] of [[320, 568], [390, 844]]) {
  test(`shopping row at ${width}px: delete is in the "…" menu, not next to 買った; ＋/− are 44px with 8px gaps`, async ({ page }, info) => {
    await page.setViewportSize({ width, height });
    const initial = baseState({ buys: [{ id: 10, name: 'おしりふき詰替', qty: 1, unit: 'パック' }, { id: 11, name: 'とても長い名前の商品 ベビー用ボディソープ 詰め替え用 大容量パック', qty: 2, unit: '個' }] });
    await open(page, { [KEY]: initial });
    await go(page, 'buy');
    const row = page.locator('[data-buy-id="10"]');
    // No delete control in the action row next to "買った".
    const actions = row.locator('.stableBuyActions');
    await expect(actions.locator('.danger, [aria-label="削除"]')).toHaveCount(0);
    const order = await actions.locator('button').evaluateAll(bs => bs.map(b => b.textContent.trim()));
    expect(order).toEqual(['−', '＋', '✓ 買った']);
    // Sizes and gaps (CSS px).
    const box = async loc => loc.boundingBox();
    const minus = await box(row.locator('.qty button').first()), plus = await box(row.locator('.qty button').last()), boughtBtn = await box(row.locator('.stableBuyStock')), more = await box(row.locator('.stableBuyMore'));
    for (const b of [minus, plus]) { expect(b.width).toBeGreaterThanOrEqual(44); expect(b.height).toBeGreaterThanOrEqual(44); }
    expect(plus.x - (minus.x + minus.width)).toBeGreaterThanOrEqual(8);
    // 買った may wrap below the quantity controls on narrow screens; either way they stay 8px apart.
    const sameLine = boughtBtn.y < plus.y + plus.height;
    const gapPlusBought = sameLine ? boughtBtn.x - (plus.x + plus.width) : boughtBtn.y - (plus.y + plus.height);
    expect(gapPlusBought).toBeGreaterThanOrEqual(8);
    expect(more.width).toBeGreaterThanOrEqual(44); expect(more.height).toBeGreaterThanOrEqual(44);
    // The "…" button is not adjacent to 買った (different line).
    expect(more.y + more.height).toBeLessThanOrEqual(boughtBtn.y);
    info.annotations.push({ type: 'measured', description: JSON.stringify({ width, minus: [minus.width, minus.height], plus: [plus.width, plus.height], gapMinusPlus: plus.x - minus.x - minus.width, gapPlusBought, more: [more.width, more.height] }) });
    console.log('MEASURED', width, JSON.stringify({ minus: [minus.width, minus.height], plus: [plus.width, plus.height], gapMinusPlus: +(plus.x - minus.x - minus.width).toFixed(1), gapPlusBought: +gapPlusBought.toFixed(1), boughtWraps: !sameLine, more: [more.width, more.height] }));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    // Menu: opens, closes with Escape, delete still confirms in the app (cancel keeps it).
    await row.locator('.stableBuyMore').click();
    await expect(row.locator('.stableBuyMenu')).toBeVisible();
    await expect(row.locator('.stableBuyMore')).toHaveAttribute('aria-expanded', 'true');
    await shot(page, info, `w2-buy-menu-${width}`);
    await page.keyboard.press('Escape');
    await expect(row.locator('.stableBuyMenu')).toBeHidden();
    await row.locator('.stableBuyMore').click();
    await row.getByRole('menuitem', { name: '買い物リストから削除' }).click();
    expect(await appConfirm(page, false)).toContain('買い物リストから1商品を削除しますか？');
    expect((await stored(page)).buys).toHaveLength(2);
    await row.locator('.stableBuyMore').click();
    await row.getByRole('menuitem', { name: '買い物リストから削除' }).click();
    await appConfirm(page, true);
    await expect.poll(async () => (await stored(page)).buys.map(x => x.id)).toEqual([11]);
    // "買った" still works as the main action.
    await page.locator('[data-buy-id="11"] .stableBuyStock').click();
    await expect.poll(async () => (await stored(page)).buys.length).toBe(0);
    expect(page.__dialogs).toEqual([]);
    expect(page.__errors).toEqual([]);
  });
}

test('renaming a product without a photo never shows a photo notice, even when photo storage fails', async ({ page }) => {
  await open(page, { [KEY]: baseState() });
  await go(page, 'stock');
  // Photo storage unusable (e.g. private browsing, storage blocked): every photo transaction fails.
  await page.evaluate(() => { IDBDatabase.prototype.transaction = function () { throw new DOMException('blocked', 'InvalidStateError'); }; });
  await rename(page, 3, '卵 Lサイズ');
  await page.waitForTimeout(800);
  expect((await toastTexts(page)).join()).not.toContain('写真');
  expect(page.__errors).toEqual([]);
});

test('a product with a photo: renaming keeps it; if carrying it over fails, saving and the photo are reported separately', async ({ page }) => {
  await open(page, { [KEY]: baseState() });
  await go(page, 'stock');
  await page.locator('#stockList [data-stock-id="3"] .name').click();
  await page.click('.atk-photo-open');
  await page.locator('#atkPhotoEditor input[type=file]').setInputFiles(png());
  await page.click('.atk-photo-save');
  await expect(page.locator('.atk-detail-photo')).toBeVisible();
  await page.click('#sheet .close');
  await rename(page, 3, '卵 10個入り');
  await page.waitForTimeout(500);
  expect((await toastTexts(page)).join()).not.toContain('写真だけ');
  await expect(page.locator('#stockList [data-stock-id="3"] .atk-user-photo')).toBeVisible();
  // Now make moving the photo fail.
  await page.evaluate(() => { const put = IDBObjectStore.prototype.put; IDBObjectStore.prototype.put = function (...a) { if (this.name === 'photos') throw new DOMException('quota', 'QuotaExceededError'); return put.apply(this, a); }; });
  await rename(page, 3, '卵 6個入り');
  await expect.poll(async () => (await toastTexts(page)).join()).toContain('商品は保存しました。写真だけ引き継げませんでした');
  expect((await stored(page)).items.find(x => x.id === 3).name).toBe('卵 6個入り');
});
