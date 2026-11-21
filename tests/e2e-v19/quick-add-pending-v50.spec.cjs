// Muse P1: unfinished product selections survive reload and navigation without changing destination.
const {test, expect}=require('@playwright/test');
const {open,go,stored,KEY}=require('./helpers.cjs');
const DRAFT_KEY='atokorePreviewQuickAddPendingV19';
const draft=page=>page.evaluate(k=>JSON.parse(localStorage.getItem(k)||'null'),DRAFT_KEY);

test('an unsaved product is restored after Safari-style reload and remains uncommitted',async({page})=>{
 await open(page);
 await page.evaluate(()=>window.atkOpenAdd('stock'));
 await page.click('[data-qa-cat="食料品"]');
 await page.click('[data-qa-pick="卵"]');
 expect(await stored(page)).toBeNull();
 expect(await draft(page)).toMatchObject({v:1,destination:'stock',tray:[{name:'卵',qty:1}]});
 await page.reload({waitUntil:'load'});
 await page.waitForFunction(()=>!!window.AtokoreQuickAdd);
 expect(await stored(page)).toBeNull();
 expect(await page.evaluate(()=>window.AtokoreQuickAdd.getTray())).toMatchObject([{name:'卵',qty:1}]);
 expect(await page.evaluate(()=>window.AtokoreQuickAdd.getDestination())).toBe('stock');
 await page.evaluate(()=>window.go('add'));
 await expect(page.locator('#qaBar')).toContainText('前回の追加予定');
 await page.click('#qaBar');
 await expect(page.locator('#qaReviewNote')).toContainText('前回の追加予定を復元');
 await page.click('#qaCommit');
 await expect.poll(async()=> (await stored(page))?.items.length).toBe(1);
 expect(await draft(page)).toBeNull();
 await page.reload();
 expect(await page.evaluate(()=>window.AtokoreQuickAdd.getTray().length)).toBe(0);
 expect((await stored(page)).items).toHaveLength(1);
 expect(page.__errors).toEqual([]);
});

test('returning from shopping tab to an unsaved stock batch never changes destination',async({page})=>{
 await open(page);
 await page.evaluate(()=>window.atkOpenAdd('stock'));
 await page.click('[data-qa-cat="食料品"]');
 await page.click('[data-qa-pick="卵"]');
 await go(page,'buy');
 await page.evaluate(()=>window.atkOpenAdd('buy'));
 expect(await page.evaluate(()=>window.AtokoreQuickAdd.getDestination())).toBe('stock');
 await expect(page.locator('#qaFreeDest')).toContainText('ストックに追加');
 await page.click('#qaBar');
 await page.click('#qaCommit');
 await expect.poll(async()=> (await stored(page))?.items.length).toBe(1);
 expect((await stored(page)).buys).toEqual([]);
 expect(page.__errors).toEqual([]);
});

test('a draft intentionally destined for shopping persists without stock changes',async({page})=>{
 await open(page);
 await page.evaluate(()=>window.atkOpenAdd('buy'));
 await page.click('[data-qa-cat="食料品"]');
 await page.click('[data-qa-pick="牛乳"]');
 expect(await draft(page)).toMatchObject({destination:'buy'});
 await go(page,'home');
 await page.reload();
 expect(await page.evaluate(()=>window.AtokoreQuickAdd.getDestination())).toBe('buy');
 await page.evaluate(()=>window.go('add'));
 await page.click('#qaBar');
 await expect(page.locator('#qaTrayDest')).toHaveText('保存先：買い物リスト');
 await page.click('#qaCommit');
 await expect.poll(async()=> (await stored(page))?.buys.length).toBe(1);
 expect((await stored(page)).items).toEqual([]);
 expect(await draft(page)).toBeNull();
});

test('corrupt and expired local drafts are never imported as stock',async({page})=>{
 await open(page);
 await page.evaluate(k=>localStorage.setItem(k,JSON.stringify({v:1,savedAt:Date.now()-20*86400000,destination:'buy',tray:[{name:'不正データ',cat:'食料品',unit:'個',qty:1}]})),DRAFT_KEY);
 await page.reload();
 expect(await page.evaluate(()=>window.AtokoreQuickAdd.getTray())).toEqual([]);
 expect(await draft(page)).toBeNull();
 expect(await stored(page)).toBeNull();
 expect(page.__errors).toEqual([]);
});
