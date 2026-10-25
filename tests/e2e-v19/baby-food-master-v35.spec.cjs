const {test,expect}=require('@playwright/test');
const {open,go,stored,baseState,KEY,shot,commitBatch}=require('./helpers.cjs');
const catalog=require('../../atokore-live-v125/baby-food-catalog-v35.js');
const category=(page,name)=>page.locator('#catChips').getByRole('button',{name,exact:true}).click();
// Which products are shown (W2: the display order follows the stock sort, tested in w2-qty-sort.spec.cjs).
const ids=page=>page.locator('#stockList [data-stock-id]').evaluateAll(es=>es.map(e=>Number(e.dataset.stockId)).sort((a,b)=>a-b));
function fixture(){const s=baseState({buys:[]});s.items.push(
 {id:4,name:'和光堂 離乳食 おかゆ 7か月',cat:'食料品',qty:2,unit:'個',place:'収納'},
 {id:5,name:'手作り 離乳食 野菜ペースト',cat:'ベビー',qty:1,unit:'個',place:'冷凍庫'},
 {id:6,...catalog.line('pigeon-2856',1),place:'収納'});return s}
for(const [width,height] of [[320,568],[375,667],[390,844],[430,932]]){
 test.describe(`infant food master ${width}px`,()=>{
  test.use({viewport:{width,height}});
  test('independent category, manufacturer and month filters, explicit selection, retail counts and reload',async({page},info)=>{
   const initial=fixture();await open(page,{[KEY]:initial});await go(page,'stock');
   await category(page,'離乳食');expect(await ids(page)).toEqual([4,5,6]);
   await page.click('[data-bf-stock-kind="pigeon"]');expect(await ids(page)).toEqual([6]);
   await page.click('#bfStockFoodMore summary');await page.selectOption('#bfStockFoodMonth','7');
   await page.selectOption('#bfStockFoodSeries','カップシリーズ');expect(await ids(page)).toEqual([6]);
   await page.click('[data-bf-stock-kind="other"]');expect(await ids(page)).toEqual([5]);
   expect(await stored(page)).toEqual(initial);
   await category(page,'食料品');expect(await ids(page)).toEqual([1,3]);
   await category(page,'ベビー');expect(await ids(page)).toEqual([2]);
   await category(page,'離乳食');await page.click('#bfNavAdd');await expect(page.locator('#qaBabyFood')).toBeVisible();
   const ended=page.locator('.qa-food-legacy');await expect(ended).not.toHaveAttribute('open','');
   await page.click('[data-qa-food-maker="wakodo"]');await page.selectOption('#qaFoodSeriesSelect','栄養マルシェ');
   await page.click('[data-qa-food-month="7"]');await page.click('[data-qa-food-product="wakodo-63018533"]');
   await expect(page.locator('[data-qa-food-product]')).toHaveCount(1);
   await page.click('[data-qa-food-step="1"]');await page.locator('.qa-food-selected').scrollIntoViewIfNeeded();
   await shot(page,info,`${width}-v35-food-picker`);
   expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBe(0);
   await page.click('[data-qa-food-add]');expect(await stored(page)).toEqual(initial);
   await page.click('[data-qa-food-maker="pigeon"]');await page.selectOption('#qaFoodSeriesSelect','カップシリーズ');
   await page.click('[data-qa-food-month="5"]');await expect(page.locator('[data-qa-food-product="pigeon-2856"]')).toHaveCount(0);
   await page.click('[data-qa-food-product="pigeon-2813"]');await page.click('[data-qa-food-step="-1"]');await page.click('[data-qa-food-add]');
   expect(await stored(page)).toEqual(initial);await commitBatch(page);
   const after=await stored(page);expect(after.items.filter(x=>x.id<=6)).toEqual(initial.items);
   const a=after.items.filter(x=>x.name===catalog.fullName(catalog.get('wakodo-63018533')));
   const b=after.items.filter(x=>x.name===catalog.fullName(catalog.get('pigeon-2813')));
   expect(a).toHaveLength(1);expect(a[0]).toMatchObject({cat:'離乳食',qty:2,unit:'個'});
   expect(b).toHaveLength(1);expect(b[0]).toMatchObject({cat:'離乳食',qty:1,unit:'個'});
   expect(after.buys).toEqual([]);expect(after.routines).toEqual(initial.routines);
   await go(page,'stock');await category(page,'離乳食');await page.click('[data-bf-stock-kind="all"]');
   await expect(page.locator('#stockList [data-stock-id]')).toHaveCount(5);
   await page.locator('#stockList').scrollIntoViewIfNeeded();await shot(page,info,`${width}-v35-food-stock`);
   expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBe(0);
   await page.reload();await go(page,'stock');await category(page,'離乳食');
   await expect(page.locator('#stockList [data-stock-id]')).toHaveCount(5);expect(await stored(page)).toEqual(after);expect(page.__errors).toEqual([]);
  });
 });
}
test('legacy infant-food photo survives home/stock decorations and reload without rewriting inventory',async({page})=>{
 const initial=fixture();initial.items.find(x=>x.id===4).qty=1;await open(page,{[KEY]:initial});await go(page,'stock');await category(page,'離乳食');
 const row=page.locator('#stockList [data-stock-id="4"]');await row.locator('.name').click();await page.click('.atk-photo-open');
 const buffer=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=80;c.height=80;const x=c.getContext('2d');x.fillStyle='#be865b';x.fillRect(0,0,80,80);return Array.from(Uint8Array.from(atob(c.toDataURL('image/png').split(',')[1]),s=>s.charCodeAt(0)))});
 await page.locator('#atkPhotoEditor input[type=file]').setInputFiles({name:'handmade.png',mimeType:'image/png',buffer:Buffer.from(buffer)});
 await expect(page.locator('.atk-photo-save')).toBeEnabled();await page.click('.atk-photo-save');await expect(page.locator('.atk-detail-photo')).toBeVisible();await page.click('#sheet .close');
 await expect(row.locator('.atk-user-photo')).toBeVisible();await go(page,'home');
 await expect(page.locator('#pg-home [data-atk-open="4"] .atk-user-photo')).toBeVisible();await go(page,'stock');
 await expect(row.locator('.atk-user-photo')).toBeVisible();await page.reload();await go(page,'stock');await category(page,'離乳食');
 await expect(row.locator('.atk-user-photo')).toBeVisible();expect(await stored(page)).toEqual(initial);expect(page.__errors).toEqual([]);
});
