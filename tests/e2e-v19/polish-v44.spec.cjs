const {test,expect}=require('@playwright/test');
const {open,go,stored,baseState,KEY,shot}=require('./helpers.cjs');
const EMU='http://127.0.0.1:'+(process.env.E2E_HH_PORT||4720);
const CFG={url:EMU,anonKey:'emu-anon-key',google:true,guest:true,email:false};
for(const width of [320,390,430])test(`v44 text stock groups categories, hides pictures, remembers view and keeps quantity actions at ${width}px`,async({page},info)=>{
 await page.setViewportSize({width,height:844});await open(page,{[KEY]:baseState()});await go(page,'stock');
 await page.click('[data-atk-view="list"]');
 await expect(page.locator('#pg-stock')).toHaveClass(/atk-stock-list-mode/);await expect(page.locator('.atk-stock-category')).not.toHaveCount(0);
 const row=page.locator('#stockList [data-stock-id="1"]');await expect(row.locator('.name')).toHaveText('牛乳');
 await expect(row.locator('.atk-row-brand')).toBeHidden();await expect(row.locator('.meta')).toContainText('冷蔵庫');await expect(row.locator('.qty b')).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await shot(page,info,`v44-stock-list-${width}`);
 await page.reload();await go(page,'stock');await expect(page.locator('[data-atk-view="list"]')).toHaveAttribute('aria-pressed','true');
 const before=(await stored(page)).items.find(x=>x.id===1).qty;await row.locator('.qty button').last().click();expect((await stored(page)).items.find(x=>x.id===1).qty).toBe(before+1);
 await page.getByRole('button',{name:'元に戻す',exact:true}).click();expect((await stored(page)).items.find(x=>x.id===1).qty).toBe(before);
 await page.click('[data-atk-view="cards"]');await expect(page.locator('.atk-stock-category')).toHaveCount(0);await expect(row.locator('.atk-row-brand')).toBeVisible();
 expect(page.__errors).toEqual([]);
});
test('v44 review product opens draft editor, returns without saving stock, then commits edited fields once',async({page})=>{
 const initial=baseState();await open(page,{[KEY]:initial});
 await page.evaluate(()=>AtokoreQuickAdd.openWithEntries([{name:'半袖肌着',cat:'衣類',unit:'個',qty:1}]));
 await page.click('[data-qa-edit="0"]');await expect(page.getByRole('heading',{name:'追加予定の商品を編集'})).toBeVisible();
 await page.fill('#atkEditName','半袖肌着 90cm');await page.fill('#atkEditForm [name="qty"]','2');await page.selectOption('#atkEditForm [name="qtyBasis"]','unopened');await page.check('#atkEditForm [name="inUse"]');
 await page.fill('#atkEditForm [name="memo"]','白いもの');await page.getByRole('button',{name:'確認画面に反映する'}).click();
 expect(await stored(page)).toEqual(initial);await expect(page.locator('#qaTray')).toContainText('半袖肌着 90cm');
 await page.click('#qaCommit');let s=await stored(page);const added=s.items.find(x=>x.name==='半袖肌着 90cm');expect(added).toMatchObject({qty:2,qtyBasis:'unopened',inUse:true,memo:'白いもの'});
 await go(page,'stock');await page.click('[data-atk-view="list"]');await expect(page.locator(`[data-stock-id="${added.id}"]`)).toContainText('未開封の予備・使用中あり');
 expect(page.__errors).toEqual([]);
});
test('v44 home replenishment is explicit, adds once and excludes expiry-only stock',async({page})=>{
 const s=baseState({items:[{id:1,name:'不足のミルク',cat:'ベビー',qty:1,unit:'缶'},{id:2,name:'期限の牛乳',cat:'食料品',qty:5,unit:'本',exp:'2020-01-01'}],buys:[],routines:[]});await open(page,{[KEY]:s});
 await expect(page.locator('[data-atk-replenish]')).toHaveCount(1);await page.locator('#atkTasks [data-atk-open="1"]').click();expect(await stored(page)).toEqual(s);await page.getByRole('button',{name:'閉じる',exact:true}).click();
 await page.click('[data-atk-replenish="1"]');await expect(page.locator('[data-atk-replenish="1"]')).toBeDisabled();
 await page.evaluate(()=>document.querySelector('[data-atk-replenish="1"]').click());expect((await stored(page)).buys).toHaveLength(1);expect((await stored(page)).buys[0].qty).toBe(1);
 await page.reload();await expect(page.locator('[data-atk-replenish="1"]')).toHaveText('買い物に追加済み');
});
test('v44 local purchase undo restores shopping row and preserves an unrelated later stock change',async({page})=>{
 const initial=baseState();await open(page,{[KEY]:initial});
 await page.evaluate(()=>buyOneToStockV125H(buys[0].id));await expect(page.locator('#atkUndoBar')).toBeVisible();
 await page.evaluate(()=>{items.find(x=>x.id===1).qty+=3;save()});
 await page.getByRole('button',{name:'元に戻す',exact:true}).click();const result=await stored(page);expect(result.buys).toEqual(initial.buys);expect(result.items.find(x=>x.id===1).qty).toBe(initial.items.find(x=>x.id===1).qty+3);
});
test('v44 shared purchase undo preserves partner changes; private photos follow stock to a guest device and disappear on logout',async({browser,request},info)=>{
 await request.post(EMU+'/__test/reset');
 async function device(state){const ctx=await browser.newContext({...info.project.use,baseURL:info.project.use.baseURL});const page=await ctx.newPage();await page.addInitScript(c=>window.ATOKORE_HOUSEHOLD_CONFIG=c,CFG);await open(page,{[KEY]:state});return {ctx,page}}
 const a=await device(baseState()),b=await device({items:[],buys:[],routines:[]});
 try{
  await go(a.page,'premium');await a.page.click('#atkHouseholdCard');await a.page.getByRole('button',{name:'Googleでログイン',exact:true}).click();await a.page.fill('#atkHhName','パパ');await a.page.getByRole('button',{name:'世帯を作る',exact:true}).click();await expect(a.page.locator('#atkHouseholdStatus')).toHaveText('家族と共有済み');
  await a.page.getByRole('button',{name:/家族を招待する/}).click();const link=await a.page.locator('#atkHhInviteLink').inputValue();await b.page.goto(link);await b.page.fill('#atkHhGuestName','ママ');await b.page.getByRole('button',{name:'Googleなしで共有に参加する',exact:true}).click();await expect(b.page.locator('#atkHouseholdStatus')).toHaveText('家族と共有済み');
  await a.page.getByRole('button',{name:'閉じる',exact:true}).click();await b.page.getByRole('button',{name:'閉じる',exact:true}).click();
  await a.page.evaluate(()=>buyOneToStockV125H(buys[0].id));await a.page.evaluate(()=>AtokoreHousehold.syncNow());
  await b.page.evaluate(()=>AtokoreHousehold.syncNow());await b.page.evaluate(()=>{const x=items.find(x=>x.name==='牛乳');adj(x.id,2)});await b.page.evaluate(()=>AtokoreHousehold.syncNow());
  await a.page.getByRole('button',{name:'元に戻す',exact:true}).click();await b.page.evaluate(()=>AtokoreHousehold.syncNow());
  await expect.poll(async()=>(await stored(a.page)).buys.length).toBe(1);await b.page.evaluate(()=>AtokoreHousehold.syncNow());expect((await stored(b.page)).buys).toHaveLength(1);expect((await stored(b.page)).items.find(x=>x.name==='牛乳').qty).toBe(3);
  await expect(a.page.locator('#atkHomeActivity')).toContainText('「買った」を取り消し');
  await a.page.click('#atkHouseholdChip');await a.page.getByRole('button',{name:/変更履歴/}).click();await expect(a.page.locator('.atk-hh-history')).toContainText('「買った」を取り消し');await a.page.getByRole('button',{name:'閉じる',exact:true}).click();
  await a.page.evaluate(async()=>{const c=document.createElement('canvas');c.width=c.height=32;c.getContext('2d').fillRect(0,0,32,32);const blob=await new Promise(r=>c.toBlob(r,'image/jpeg'));await AtokoreHousehold.sharePhoto(1,blob)});
  await b.page.evaluate(()=>AtokoreHousehold.syncNow());await go(b.page,'stock');const milk=(await stored(b.page)).items.find(x=>x.name==='牛乳');
  await expect(b.page.locator(`[data-stock-id="${milk.id}"] .atk-user-photo`)).toBeVisible();
  await b.page.reload();await b.page.evaluate(()=>AtokoreHousehold.syncNow());await go(b.page,'stock');await expect(b.page.locator(`[data-stock-id="${milk.id}"] .atk-user-photo`)).toBeVisible();
  await b.page.click('#atkHouseholdChip');await b.page.getByRole('button',{name:'ログアウト',exact:true}).click();await expect(b.page.locator('#stockList .atk-user-photo')).toHaveCount(0);
  expect(a.page.__errors).toEqual([]);expect(b.page.__errors).toEqual([]);
 }finally{await a.ctx.close();await b.ctx.close()}
});
