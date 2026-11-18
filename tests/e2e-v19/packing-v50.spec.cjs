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

for (const width of [320,393,430]) test('v50 kit bridge: buying from packed list preserves stock/checks and avoids duplicate buys at '+width+'px',async({page})=>{
 await page.setViewportSize({width,height:780});
 await open(page,{[KEY]:baseState()});
 const initial=await stored(page);
 await go(page,'buy');
 const kit=page.locator('#atkPackRows .atk-pack-row').nth(2);
 await expect(kit.locator('.atk-pack-label span')).toHaveText('おむつ');
 await expect(kit.locator('.atk-pack-stock-hint')).toContainText('ストック登録：2袋');
 const action=kit.locator('.atk-pack-to-buy');
 await expect(action).toBeEnabled();
 const box=await action.boundingBox();
 expect(box.height).toBeGreaterThanOrEqual(44);
 expect(await stored(page)).toEqual(initial);
 await action.click();
 const after=await stored(page);
 expect(after.items).toEqual(initial.items);
 expect(after.buys.filter(x=>x.name==='パンパース さらさらケア おむつ テープ M')).toHaveLength(1);
 const picked=after.buys.find(x=>x.name==='パンパース さらさらケア おむつ テープ M');
 expect(picked).toMatchObject({stockId:2,qty:1,unit:'袋',cat:'ベビー'});
 await expect(page.locator('#atkPackRows .atk-pack-row').nth(2).locator('.atk-pack-to-buy')).toHaveText('追加済み');
 await expect(page.locator('#atkPackRows .atk-pack-row').nth(2).locator('.atk-pack-to-buy')).toBeDisabled();
 await page.reload();
 await go(page,'buy');
 await expect(page.locator('#atkPackRows .atk-pack-row').nth(2).locator('.atk-pack-to-buy')).toBeDisabled();
 await page.evaluate(id=>window.buyOneToStockV125H(id),picked.id);
 const final=await stored(page);
 expect(final.buys.some(x=>x.id===picked.id)).toBe(false);
 expect(final.items.find(x=>x.id===2)?.qty).toBe(3);
 await expect(page.locator('#atkPackRows .atk-pack-row').nth(2).locator('.atk-pack-stock-hint')).toContainText('ストック登録：3袋');
 await expect(page.locator('#atkPackRows input[type=checkbox]').nth(2)).not.toBeChecked();
 expect(await noHorizontalScroll(page)).toBe(true);
 expect(page.__errors).toEqual([]);
});

test('v50 kit bridge: variant selection is explicit and missing stock is not automatically a shortage',async({page})=>{
 const input=baseState();
 input.items.push({id:4,name:'メリーズ おむつ パンツ L',cat:'ベビー',qty:0,unit:'袋',place:'収納',expType:'期限なし',exp:'',usage:1});
 await open(page,{[KEY]:input});
 await go(page,'buy');
 const diaper=page.locator('#atkPackRows .atk-pack-row').nth(2);
 await expect(diaper.locator('.atk-pack-stock-hint')).toContainText('複数の商品あり');
 const picker=diaper.locator('select.atk-pack-stock-choice');
 await expect(picker.locator('option')).toHaveCount(3);
 const action=diaper.locator('.atk-pack-to-buy');
 await expect(action).toBeDisabled();
 await picker.selectOption('4');
 await action.click();
 const after=await stored(page);
 expect(after.buys.find(x=>x.name==='メリーズ おむつ パンツ L')).toMatchObject({qty:1,unit:'袋',stockId:4});
 expect(after.items.find(x=>x.id===4)?.qty).toBe(0);
 const towel=page.locator('#atkPackRows .atk-pack-row').nth(4);
 await expect(towel.locator('.atk-pack-label span')).toHaveText('タオル');
 await expect(towel.locator('.atk-pack-stock-hint')).toContainText('不足確定ではありません');
 expect(page.__dialogs).toEqual([]);
});

test('v50 kit bridge: no-size diaper memo requires consent, cancel does not write any data',async({page})=>{
 await open(page,{[KEY]:baseState({items:[],buys:[]})});
 await go(page,'buy');
 const kit=page.locator('#atkPackRows .atk-pack-row').nth(2);
 await expect(kit.locator('.atk-pack-stock-hint')).toContainText('未確認');
 const initial=await stored(page);
 await kit.locator('.atk-pack-to-buy').click();
 const warning=await appConfirm(page,false);
 expect(warning).toContain('サイズやメーカーを確認');
 expect(await stored(page)).toEqual(initial);
 await page.locator('#atkPackRows .atk-pack-row').nth(2).locator('.atk-pack-to-buy').click();
 await appConfirm(page,true);
 const queued=await stored(page);
 expect(queued.buys).toHaveLength(1);
 expect(queued.buys[0]).toMatchObject({name:'おむつ',qty:1,cat:'ベビー'});
 expect(queued.items).toEqual([]);
});

test('v50 kit bridge: Safari quota write failure never claims an unsaved shopping item',async({page})=>{
 await open(page,{[KEY]:baseState()});
 await go(page,'buy');
 const before=await stored(page);
 await page.evaluate(key=>{
   const original=Storage.prototype.setItem;
   window.__restoreKitQuota=()=>{Storage.prototype.setItem=original};
   Storage.prototype.setItem=function(k,v){
     if(k===key)throw new DOMException('quota','QuotaExceededError');
     return original.call(this,k,v);
   };
 },KEY);
 const button=page.locator('#atkPackRows .atk-pack-row').nth(2).locator('.atk-pack-to-buy');
 await button.click();
 await expect(page.locator('#atkPackError')).toContainText('保存できませんでした');
 expect(await stored(page)).toEqual(before);
 await page.evaluate(()=>window.__restoreKitQuota());
 await button.click();
 expect((await stored(page)).buys.filter(x=>x.name==='パンパース さらさらケア おむつ テープ M')).toHaveLength(1);
 expect(page.__dialogs).toEqual([]);
});
