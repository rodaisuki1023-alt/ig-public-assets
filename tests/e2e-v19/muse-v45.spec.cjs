const {test,expect}=require('@playwright/test');
const {open,go,stored,baseState,KEY}=require('./helpers.cjs');
test('P0-1 stock deletion works when native confirm is blocked',async({page})=>{
 await open(page,{[KEY]:baseState()});await page.evaluate(()=>window.confirm=()=>false);await go(page,'stock');
 await page.click('#stockSelectToggle');await page.check('.stockPickV125h[value="1"]');await page.click('#stockBulkDelete');
 await expect(page.getByRole('button',{name:'削除する',exact:true})).toBeVisible({timeout:2000});await page.getByRole('button',{name:'削除する',exact:true}).click();
 expect((await stored(page)).items.map(x=>x.id)).toEqual([2,3]);await expect(page.locator('#stableToastV125h')).toContainText('削除');await page.reload();expect((await stored(page)).items.map(x=>x.id)).toEqual([2,3]);
 await page.evaluate(()=>window.confirm=()=>false);await go(page,'stock');await page.locator('[data-stock-id="2"] .name').click();await page.click('.atk-detail-delete');await page.getByRole('button',{name:'削除する',exact:true}).click();
 await page.reload();expect((await stored(page)).items).toEqual([baseState().items[2]]);expect(page.__errors).toEqual([]);
});
test('P0-2 date uses calendar days in home, stock and detail',async({page})=>{
 await page.clock.install({time:new Date('2026-10-24T12:00:00+09:00')});
 await open(page,{[KEY]:baseState({items:[{id:1,name:'牛乳',cat:'食料品',qty:1,unit:'本',exp:'2026-10-26',expType:'消費期限'}]})});
 await expect(page.locator('#atkTasks')).toContainText('あと2日');await expect(page.locator('#atkTasks')).toContainText('10/26まで');await go(page,'stock');
 await expect(page.locator('[data-stock-id="1"]')).toContainText('あと2日');await page.locator('[data-stock-id="1"] .name').click();await expect(page.locator('#sheet')).toContainText('あと2日');await expect(page.locator('#sheet')).toContainText('10/26まで');
});
test('P1-4 clear pending works without native dialog',async({page})=>{
 const initial=baseState();await open(page,{[KEY]:initial});await page.evaluate(()=>{window.confirm=()=>false;AtokoreQuickAdd.openWithEntries([{name:'テスト商品',cat:'日用品',qty:1,unit:'個'}])});
 await page.click('[data-qa-clear]');await expect(page.getByRole('button',{name:'全部取り消す',exact:true})).toBeVisible({timeout:2000});await page.getByRole('button',{name:'全部取り消す',exact:true}).click();
 await expect(page.locator('#qaTray')).toBeHidden();expect(await stored(page)).toEqual(initial);
});
test('P1-5 text list name and keyboard open detail; qty buttons do not',async({page})=>{
 await open(page,{[KEY]:baseState()});await go(page,'stock');await page.click('[data-atk-view="list"]');await page.locator('[data-stock-id="1"] .name').click();await expect(page.locator('#sheet .atk-detail-head')).toBeVisible({timeout:2000});
 await page.click('#sheet .close');await page.locator('[data-stock-id="1"]').focus();await page.keyboard.press('Enter');await expect(page.locator('#sheet .atk-detail-head')).toBeVisible();await page.click('#sheet .close');await page.locator('[data-stock-id="1"] .qty button').last().click();await expect(page.locator('#modal')).not.toHaveClass(/on/);
});
for(const [exp,label] of [['2026-10-24','今日まで（10/24まで）'],['2026-10-23','期限を1日超過（10/23まで）'],['','期限なし']])test('P0-2 expiry boundary '+(exp||'none'),async({page})=>{
 await page.clock.install({time:new Date('2026-10-24T12:00:00+09:00')});await open(page,{[KEY]:baseState({items:[{id:1,name:'牛乳',cat:'食料品',qty:1,unit:'本',exp,expType:exp?'消費期限':'期限なし'}]})});
 if(exp)await expect(page.locator('#atkTasks')).toContainText(label);else await expect(page.locator('.atk-home-expiry')).toHaveCount(0);
 await go(page,'stock');if(exp)await expect(page.locator('[data-stock-id="1"]')).toContainText(label);else await expect(page.locator('.expiryBadge')).toHaveCount(0);
 await page.locator('[data-stock-id="1"] .name').click();await expect(page.locator('#sheet')).toContainText(label);expect(page.__errors).toEqual([]);
});
test('P0-1 cancel leaves stock untouched and deleted low item vanishes from home',async({page})=>{
 const initial=baseState();await open(page,{[KEY]:initial});await go(page,'stock');await page.locator('[data-stock-id="1"] .name').click();await page.click('.atk-detail-delete');await page.getByRole('button',{name:'キャンセル',exact:true}).click();expect(await stored(page)).toEqual(initial);
 await page.click('.atk-detail-delete');await page.getByRole('button',{name:'削除する',exact:true}).click();await go(page,'home');await expect(page.locator('#atkTasks [data-atk-open="1"]')).toHaveCount(0);await go(page,'stock');await expect(page.locator('[data-stock-id="1"]')).toHaveCount(0);
});
test('P1-3 bought is immediate and reversible, bulk selection is distinct',async({page})=>{
 const initial=baseState();await open(page,{[KEY]:initial});await go(page,'buy');const row=page.locator('[data-buy-id="10"]');await expect(row.locator('.buyCheck')).toHaveAccessibleName(/一括操作用/);await row.getByRole('button',{name:/を買った$/}).click();
 expect((await stored(page)).buys).toHaveLength(0);expect((await stored(page)).items.find(x=>x.name==='おしりふき詰替').qty).toBe(1);await expect(page.locator('#atkUndoBar')).toContainText('買った');await page.getByRole('button',{name:'元に戻す',exact:true}).click();expect((await stored(page)).buys).toEqual(initial.buys);expect(page.__errors).toEqual([]);
});
test('P2-6 destination titles, list labels, legacy food maker, version and samples',async({page})=>{
 await open(page,{[KEY]:baseState()});await page.click('#bfNavAdd');await page.click('#bfDestination [data-qa-dest="buy"]');await expect(page.locator('#pg-add .atk-page-title h2')).toHaveText('買い物リストに追加');await page.click('#bfDestination [data-qa-dest="stock"]');await expect(page.locator('#pg-add .atk-page-title h2')).toHaveText('ストック追加');
 await page.click('[data-qa-cat="離乳食"]');await page.locator('.qa-food-legacy summary').click();await expect(page.locator('[data-qa-food-maker="kewpie"]')).toBeVisible();await go(page,'stock');await page.evaluate(()=>setFilter('離乳食'));await expect(page.locator('[data-bf-stock-kind="kewpie"]')).toBeVisible();
 await go(page,'buy');await expect(page.locator('#pg-buy')).toContainText('いつものリスト');await go(page,'premium');await expect(page.locator('#atkVersionInfo')).toContainText('機能更新 v46');await page.evaluate(()=>openAtokoreDisplaySettings());await expect(page.locator('#sheet')).toContainText('サンプル');expect(page.__errors).toEqual([]);
});
test('P2-7 estimate evidence, zero stock first, price breakdown and location naming',async({page})=>{
 await open(page,{[KEY]:baseState({items:[{id:1,name:'牛乳',qty:0,unit:'本',price:198,place:'冷蔵庫'},{id:2,name:'卵',qty:2,unit:'個',price:100,place:'冷蔵庫'}]})});await page.evaluate(()=>showPremium('predict'));await expect(page.locator('.atk-insight-row').first()).toContainText('牛乳：在庫なし');await expect(page.locator('#sheet')).toContainText('消費ペースはまだ計測していません');await expect(page.locator('#sheet')).toContainText('根拠');await page.evaluate(()=>showPremium('money'));await expect(page.locator('#sheet')).toContainText('¥200');await expect(page.locator('.atk-insight-row').first()).toContainText('¥0');await expect(page.locator('#sheet')).toContainText('100円 × 現在の数量 2個');await page.evaluate(()=>showPremium('qr'));await expect(page.getByRole('heading',{name:'保管場所別ストック'})).toBeVisible();await expect(page.locator('#sheet')).toContainText('冷蔵庫');expect(page.__errors).toEqual([]);
});
test('P3-8 empty food filter links to food picker and receipt multiline paste works',async({page})=>{
 await open(page,{[KEY]:baseState()});await go(page,'stock');await page.evaluate(()=>setFilter('離乳食'));await page.getByRole('button',{name:'商品を追加する',exact:true}).click();await expect(page.locator('#qaBabyFood')).toBeVisible();
 await page.evaluate(()=>showPremium('receipt'));await page.locator('summary').filter({hasText:'レシートの文字を貼って読み取る'}).click();await expect(page.locator('.receipt-example')).toContainText('牛乳 198円');await page.fill('#receiptManualText','牛乳 198円\r卵 258円\u2028小計 456円');await page.getByRole('button',{name:'商品名を解析',exact:true}).click();await expect(page.locator('.receiptReview')).toHaveCount(2);expect(page.__errors).toEqual([]);
});
for(const width of [320,390,430])test(`P3-8 touch targets and layout ${width}`,async({page},info)=>{
 const {shot}=require('./helpers.cjs');await page.setViewportSize({width,height:844});await open(page,{[KEY]:baseState()});await go(page,'stock');
 for(const el of await page.locator('#stockList .qty button').all()){const box=await el.boundingBox();expect(box.width).toBeGreaterThanOrEqual(44);expect(box.height).toBeGreaterThanOrEqual(44)}
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.click('[data-atk-view="list"]');await shot(page,info,'v45-stock-list-'+width);await go(page,'buy');await expect(page.locator('.stableBuyStock')).toBeVisible();const b=await page.locator('.stableBuyStock').boundingBox();expect(b.height).toBeGreaterThanOrEqual(44);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await shot(page,info,'v45-buy-'+width);expect(page.__errors).toEqual([]);
});
