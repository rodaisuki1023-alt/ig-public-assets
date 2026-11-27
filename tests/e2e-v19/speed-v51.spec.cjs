// v51 第11回: speed changes keep every behaviour (hidden lists drawn when shown, −／＋ quick path, OCR parts
// only with OCR on, lazy pictures), the direct count entry, and purchase / undo / reload consistency.
const { test, expect } = require('@playwright/test');
const { open, go, stored, baseState, KEY } = require('./helpers.cjs');

test('a hidden list is drawn when its page is shown, by go() or by any page switch', async ({ page }) => {
  await open(page, { [KEY]: baseState() });
  await go(page, 'home');
  // Data changes while the shopping page is hidden (another module, the family sync...).
  await page.evaluate(() => { buys.push({ id: 77, name: 'トマト', qty: 2, unit: '個' }); refreshAtokoreUiV125H(); });
  expect(await page.evaluate(() => AtokoreViews.stale())).toEqual(expect.arrayContaining(['buy']));
  await go(page, 'buy');
  await expect(page.locator('#buyList [data-buy-id="77"]')).toContainText('トマト');
  // A switch that only flips the class (not showPage) is drawn before the next paint too.
  await page.evaluate(() => { items.find(x => x.id === 3).qty = 9; go('buy'); refreshAtokoreUiV125H(); document.querySelectorAll('.page').forEach(p => p.classList.remove('on')); document.getElementById('pg-stock').classList.add('on'); });
  await expect(page.locator('#stockList [data-stock-id="3"] .qty b')).toHaveText('9個');
  expect(page.__errors).toEqual([]);
});

test('−／＋: the number changes at once, the full redraw follows once for quick taps, every tap is saved', async ({ page }) => {
  await open(page, { [KEY]: baseState() });
  await go(page, 'stock');
  const plus = page.locator('#stockList [data-stock-id="1"] button.icon', { hasText: '＋' });
  const shown = await page.evaluate(() => {
    const b = document.querySelector('#stockList [data-stock-id="1"] .qty button:last-child');
    b.click(); const now = document.querySelector('#stockList [data-stock-id="1"] .qty b').textContent;   // same task: patched
    return now;
  });
  expect(shown).toBe('2本');
  for (let i = 0; i < 4; i++) await plus.click();
  await expect(page.locator('#stockList [data-stock-id="1"] .qty b')).toHaveText('6本');
  await expect(page.locator('#stockList [data-stock-id="1"] .bf-stock-count')).toHaveText('残り 6本');
  const s = await stored(page);
  expect(s.items.find(x => x.id === 1).qty).toBe(6);
  // The level mark (a decoration of the full redraw) follows: 牛乳 is no longer at its reorder line.
  await expect(page.locator('#stockList [data-stock-id="1"] .atk-lv-tag')).toHaveText('余裕あり');
  // The undo bar still offers the last change; history has one entry per tap.
  await expect(page.locator('#atkUndoBar')).toContainText('牛乳の数量を変更しました');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('atokorePreviewHistoryV19') || '[]').filter(h => /牛乳/.test(h.detail || '')).length)).toBe(5);
  // Shopping quantity −／＋ on the shopping page.
  await go(page, 'buy');
  await page.locator('#buyList [data-buy-id="10"] .qty button:last-child').click();
  await expect(page.locator('#buyList [data-buy-id="10"] .qty b')).toHaveText('2パック');
  expect((await stored(page)).buys.find(x => x.id === 10).qty).toBe(2);
  expect(page.__errors).toEqual([]);
});

test('a failed save on −／＋ is undone at once, never shown as done', async ({ page }) => {
  await open(page, { [KEY]: baseState() });
  await go(page, 'stock');
  // Storage full: every write throws (as in storage.spec "save failures never look like success").
  await page.evaluate(() => { Storage.prototype.setItem = function () { throw new DOMException('full', 'QuotaExceededError'); }; });
  await page.locator('#stockList [data-stock-id="1"] button.icon', { hasText: '＋' }).click();
  await expect(page.locator('#atkSafetyBanner')).toContainText('保存できませんでした');
  await expect(page.locator('#stockList [data-stock-id="1"] .qty b')).toHaveText('1本');
  expect(await page.evaluate(() => items.find(x => x.id === 1).qty)).toBe(1);
  await expect(page.locator('#atkUndoBar')).toHaveCount(0);
});

test('OCR parts are read only while OCR is on; pictures of hidden screens wait until shown', async ({ page, browser }, info) => {
  const loaded = p => p.evaluate(() => ['AtokoreReceiptImage', 'AtokoreReceiptOcr', 'AtokoreReceiptLines', 'AtokoreReceiptStructure'].map(k => !!window[k]));
  await open(page, { [KEY]: baseState() }, { receiptExperimental: false });
  expect(await loaded(page)).toEqual([false, false, false, false]);
  expect(await page.evaluate(() => [...document.scripts].some(s => /receipt-ppocr/.test(s.src)))).toBe(false);
  expect(await page.evaluate(() => [...document.querySelectorAll('img.bf-baby-art')].every(i => i.loading === 'lazy'))).toBe(true);
  const ctx = await browser.newContext({ ...info.project.use });
  try {
    const on = await ctx.newPage();
    await open(on, { [KEY]: baseState() }, { receiptExperimental: true });
    expect(await loaded(on)).toEqual([true, true, true, true]);
    expect(on.__errors).toEqual([]);
  } finally { await ctx.close(); }
  expect(page.__errors).toEqual([]);
});

test('direct count entry in the product sheet: one step, recorded like ＋／－, wrong input refused', async ({ page }) => {
  await open(page, { [KEY]: baseState() });
  await go(page, 'stock');
  await page.evaluate(() => window.atkShowDetail(2));
  const box = page.locator('#sheet .atk-detail-setqty');
  await box.locator('summary').click();
  const input = box.locator('[data-atk-setqty-input]');
  for (const bad of ['-1', '1.5', '']) {
    await input.fill(bad);
    await box.getByRole('button', { name: 'この数にする' }).click();
    await expect(page.locator('#sheet .atk-detail-setqty-note')).toHaveText('0〜9999の整数で入力してください。');
  }
  expect((await stored(page)).items.find(x => x.id === 2).qty).toBe(2);
  await input.fill('60');
  await page.locator('#sheet .atk-detail-setqty').getByRole('button', { name: 'この数にする' }).click();
  await expect(page.locator('#sheet .atk-detail-qty')).toContainText('60 袋');
  expect((await stored(page)).items.find(x => x.id === 2).qty).toBe(60);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('atokorePreviewHistoryV19') || '[]')[0]?.detail)).toContain('2袋 → 60袋');
  const sum = await page.locator('#sheet .atk-detail-setqty summary').boundingBox();
  expect(sum.height).toBeGreaterThanOrEqual(44);
  expect(page.__errors).toEqual([]);
});

test('purchase, undo and reload agree: stock, shopping list and history, and no undo after a reload', async ({ page }) => {
  await open(page, { [KEY]: baseState({ buys: [{ id: 10, name: 'おしりふき詰替', qty: 1, unit: 'パック' }, { id: 11, name: '牛乳', qty: 2, unit: '本' }] }) });
  await go(page, 'buy');
  await page.locator('#buyList [data-buy-id="11"] .stableBuyStock').click();
  await page.locator('#atkUndoBar').getByRole('button', { name: '元に戻す', exact: true }).click();
  let s = await stored(page);
  expect(s.items.find(x => x.id === 1).qty).toBe(1);
  expect(s.buys.map(b => b.id).sort()).toEqual([10, 11]);
  await page.locator('#buyList [data-buy-id="11"] .stableBuyStock').click();
  await page.reload();
  await page.waitForFunction(() => !!document.getElementById('bfNavAdd'));
  s = await stored(page);
  expect(s.items.find(x => x.id === 1).qty).toBe(3);
  expect(s.buys.map(b => b.id)).toEqual([10]);
  await go(page, 'buy');
  await expect(page.locator('#atkLastPurchaseUndo')).toHaveCount(0);     // kept in memory only: a reload ends it
  await go(page, 'stock');
  await expect(page.locator('#stockList [data-stock-id="1"] .qty b')).toHaveText('3本');
  expect(page.__errors).toEqual([]);
});
