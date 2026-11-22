// Safe, synthetic browser coverage of the local-only packing checklist.
// Existing inventory and the family-sync backend are not modified.
const { test, expect } = require('@playwright/test');
const { open, go, stored, KEY, appConfirm, baseState } = require('./helpers.cjs');

// Keep worker activation out of packing UI tests; pwa.spec.cjs covers worker behavior.
test.use({ serviceWorkers: 'block' });

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

for(const width of [320,393])test('Muse P2: shopping shortcut reaches kit and batch-select caption is readable at '+width+'px',async({page})=>{
 await page.setViewportSize({width,height:720});
 await open(page,{[KEY]:baseState()});
 const original=await stored(page);
 await go(page,'buy');
 const jump=page.locator('#pg-buy .atk-pack-jump');
 await expect(jump).toBeVisible();
 await expect(jump).toHaveAttribute('href','#atkPackingMvp');
 const bb=await jump.boundingBox();
 expect(bb.height).toBeGreaterThanOrEqual(44);
 await expect(page.locator('#pg-buy .atk-bulk-pick span').first()).toHaveCSS('font-size','11px');
 const before=await page.locator('#atkPackingMvp').evaluate(el=>el.getBoundingClientRect().top);
 await jump.click();
 await expect.poll(async()=>page.locator('#atkPackingMvp').evaluate(el=>el.getBoundingClientRect().top)).toBeLessThan(before);
 const top=await page.locator('#atkPackingMvp').evaluate(el=>el.getBoundingClientRect().top);
 expect(top).toBeLessThan(720);
 await expect(page.locator('#atkPackRows .atk-pack-row')).toHaveCount(6);
 expect(await stored(page)).toEqual(original);
 expect(await noHorizontalScroll(page)).toBe(true);
 expect(page.__errors).toEqual([]);
});

for(const width of [320,393])test('Muse P2: delete and reset are distinguishable without restoring removed items at '+width+'px',async({page})=>{
 await page.setViewportSize({width,height:760});
 await open(page,{[KEY]:baseState()});
 const before=await stored(page);
 await go(page,'buy');
 const reset=page.locator('#atkPackReset');
 await expect(reset).toHaveText('準備済みチェックをすべて外す');
 await page.locator('#atkPackRows input[type=checkbox]').first().check();
 const second=page.locator('#atkPackRows .atk-pack-row').nth(1);
 const removedName=await second.locator('.atk-pack-label span').textContent();
 await second.locator('.atk-pack-remove').click();
 await expect(page.locator('#atkConfirmNote')).toContainText('削除した項目は戻りません');
 await appConfirm(page,true);
 await expect(page.locator('#atkPackRows .atk-pack-row')).toHaveCount(5);
 await expect(page.locator('#atkPackRows')).not.toContainText(removedName);
 await reset.click();
 await expect(page.locator('#atkConfirmNote')).toContainText('削除済みの項目は復元されません');
 await appConfirm(page,true);
 await expect(page.locator('#atkPackRows .atk-pack-row')).toHaveCount(5);
 await expect(page.locator('#atkPackRows input[type=checkbox]').first()).not.toBeChecked();
 await expect(page.locator('#atkPackProgress')).toHaveText('保育園セット：0/5 準備済み');
 expect(await stored(page)).toEqual(before);
 expect(await noHorizontalScroll(page)).toBe(true);
 expect(page.__errors).toEqual([]);
});

for(const width of [320,393,430]) test('v50 owner review: packing rows stay compact without shopping actions at '+width+'px',async({page})=>{
 await page.setViewportSize({width,height:780});
 const initial=baseState();
 await open(page,{[KEY]:initial});await go(page,'buy');
 const rows=page.locator('#atkPackRows .atk-pack-row');
 await expect(rows).toHaveCount(6);
 await expect(rows.nth(2).locator('.atk-pack-stock-inline')).toHaveText('在庫：2袋');
 await expect(page.locator('#atkPackRows .atk-pack-to-buy,#atkPackRows .atk-pack-stock-choice,#atkPackRows .atk-pack-shopping-helper')).toHaveCount(0);
 for(const row of await rows.all()){
  const box=await row.boundingBox();expect(box.height).toBeLessThanOrEqual(72);
 }
 await rows.nth(2).locator('input[type=checkbox]').check();
 await expect(rows.nth(2).locator('input[type=checkbox]')).toBeChecked();
 expect(await stored(page)).toEqual(initial);
 await page.reload();await go(page,'buy');
 await expect(page.locator('#atkPackRows .atk-pack-row').nth(2).locator('input[type=checkbox]')).toBeChecked();
 expect(await stored(page)).toEqual(initial);
 expect(await noHorizontalScroll(page)).toBe(true);
});

test('v50 compact packing preserves legacy preferred variant metadata but never buys automatically',async({page})=>{
 const initial=baseState();
 initial.items.push({id:4,name:'メリーズ おむつ パンツ L',cat:'ベビー',qty:0,unit:'袋'});
 await open(page,{[KEY]:initial});await go(page,'buy');
 const kitKey=await page.evaluate(()=>window.AtokorePackingChecklist.key);
 await page.locator('#atkPackRows input[type=checkbox]').first().check();
 await page.evaluate(k=>{
  const v=JSON.parse(localStorage.getItem(k));
  v.lists.daycare[2].preferredStock={id:'4',name:'メリーズ おむつ パンツ L',unit:'袋'};
  localStorage.setItem(k,JSON.stringify(v));
 },kitKey);
 await page.reload();await go(page,'buy');
 await expect(page.locator('#atkPackRows .atk-pack-to-buy,#atkPackRows .atk-pack-stock-choice')).toHaveCount(0);
 expect(await stored(page)).toEqual(initial);
 await expect(page.locator('#atkPackRows input[type=checkbox]').first()).toBeChecked();
 const saved=await page.evaluate(k=>JSON.parse(localStorage.getItem(k)).lists.daycare[2].preferredStock,kitKey);
 expect(saved).toEqual({id:'4',name:'メリーズ おむつ パンツ L',unit:'袋'});
 expect(page.__dialogs).toEqual([]);
});

test('v50 paid-feature preview is explicitly not a purchasable subscription',async({page})=>{
  await open(page,{[KEY]:baseState()});
  await go(page,'premium');
  await expect(page.locator('#atkPremiumDisclosure')).toContainText('購入・契約・請求は発生しません');
  await expect(page.locator('#pg-premium')).toContainText('機能プレビュー（無料・課金なし）');
  await page.locator('#pg-premium .premium').nth(1).click();
  await expect(page.locator('#sheet')).toContainText('補充の目安（試算）');
  await expect(page.locator('#sheet')).toContainText('実際の不足日や購入時期を予測・保証するものではありません');
  expect(page.__errors).toEqual([]);
});
