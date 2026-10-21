const {test,expect}=require('@playwright/test');
const {open,go,stored,baseState,KEY,shot}=require('./helpers.cjs');
const products=[
 ['パンパース さらさらケア おむつ テープ M','袋',2],
 ['グーン モレ0へ おむつ パンツ L','袋',1],
 ['明治 ほほえみ 粉ミルク 缶','缶',3],
 ['森永 はぐくみ 粉ミルク 缶','缶',2],
 ['ビーンスターク すこやかM1 粉ミルク 缶','缶',4],
 ['アイクレオ グローアップミルク 粉ミルク 缶','缶',2],
 ['Rico おしりふき','パック',2],
 ['baby care おしりふき','パック',2],
 ['カークランド おしりふき','パック',2],
 ['自分のブランド 厚手でやわらかいタイプ おしりふき','パック',2],
 ['バナナ','個',2],
 ['パンパース とても長いシリーズ名を入力したおむつ 夜用パンツ スーパービッグ','袋',2],
];
const initialState=()=>baseState({items:products.map(([name,unit,qty],i)=>({id:101+i,name,unit,qty,cat:i===10?'食料品':'ベビー',place:'収納',expType:'期限なし',exp:'',usage:1}))});
const row=(page,id)=>page.locator(`#stockList [data-stock-id="${id}"]`);
for(const [width,height] of [[320,568],[375,667],[390,844],[430,932]]){
 test.describe(`v28 stock cards ${width}px`,()=>{
  test.use({viewport:{width,height}});
  test('manufacturer colors match home, two columns fit, details and stock controls remain separate',async({page},info)=>{
   const initial=initialState();await open(page,{[KEY]:initial});
   const home=await page.locator('#pg-home [data-atk-open]').evaluateAll(els=>els.map(el=>({id:el.dataset.atkOpen,bg:getComputedStyle(el.querySelector('.atk-brand')).backgroundColor})));
   await go(page,'stock');expect(await stored(page)).toEqual(initial);
   const facts=await page.locator('#stockList').evaluate(el=>{
    const cards=[...el.querySelectorAll('[data-stock-id]')];
    return {grid:getComputedStyle(el).display,columns:getComputedStyle(el).gridTemplateColumns.split(' ').length,
     overflow:document.documentElement.scrollWidth-innerWidth,
     colors:cards.map(c=>({id:c.dataset.stockId,bg:getComputedStyle(c.querySelector('.atk-row-brand')).backgroundColor})),
     controlsFit:cards.every(c=>[...c.querySelectorAll('.qty button')].every(b=>{
      const r=b.getBoundingClientRect(),p=c.getBoundingClientRect();return r.width>=44&&r.height>=44&&r.left>=p.left&&r.right<=p.right;
     }))};
   });
   expect(facts.grid).toBe('grid');expect(facts.columns).toBe(2);expect(facts.overflow).toBeLessThanOrEqual(0);expect(facts.controlsFit).toBe(true);
   for(const c of home)expect(facts.colors.find(x=>x.id===c.id).bg).toBe(c.bg);
   expect(new Set(facts.colors.slice(0,9).map(x=>x.bg)).size).toBe(9);
   for(const id of [101,103,107])await expect.poll(()=>row(page,id).locator('img').evaluate(i=>i.naturalWidth)).toBe(256);
   await row(page,101).scrollIntoViewIfNeeded();await shot(page,info,`${width}-v28-stock-cards`);
   await row(page,101).locator('.name').click();await expect(page.locator('#modal')).toHaveClass(/on/);
   expect(await stored(page)).toEqual(initial);await page.click('#sheet .close');
   await row(page,101).locator('.qty button').last().click();
   const adjusted=await stored(page);expect(adjusted.items.find(x=>x.id===101).qty).toBe(3);
   expect(adjusted.items.filter(x=>x.id!==101)).toEqual(initial.items.filter(x=>x.id!==101));
   expect(adjusted.buys).toEqual(initial.buys);expect(adjusted.routines).toEqual(initial.routines);
   await row(page,101).focus();await row(page,101).press('Enter');
   await expect(page.locator('#modal')).toHaveClass(/on/);expect(await stored(page)).toEqual(adjusted);
   await page.click('.atk-edit-open');
   await page.fill('#atkEditForm input[name="name"]','ムーニー やわらか おむつ テープ M');await page.click('.atk-edit-save');
   await expect(row(page,101).locator('.bf-baby-brand')).toHaveText('ムーニー');
   expect(await row(page,101).locator('.atk-row-brand').evaluate(e=>getComputedStyle(e).backgroundColor)).toBe('rgb(220, 232, 255)');
   const edited=await stored(page);expect(edited.items.find(x=>x.id===101).qty).toBe(3);
   await page.reload();expect(await stored(page)).toEqual(edited);
   await go(page,'stock');await page.fill('#stockSearch','存在しない商品検索');
   await expect(page.locator('#stockList .empty')).toBeVisible();expect(await stored(page)).toEqual(edited);
  });
  test('bulk selection still selects the intended cards without changing inventory',async({page})=>{
   const initial=initialState();await open(page,{[KEY]:initial});await go(page,'stock');
   await page.click('#stockSelectToggle');await row(page,102).locator('.stableCheck').check();
   await row(page,103).locator('.name').click();
   await expect(page.locator('#stockBulkMove')).toContainText('2件');
   expect(await stored(page)).toEqual(initial);
   await page.click('#stockBulkMove');const saved=await stored(page);
   expect(saved.items).toEqual(initial.items);expect(saved.routines).toEqual(initial.routines);
   expect(saved.buys).toHaveLength(initial.buys.length+2);
   for(const id of [102,103])expect(saved.buys.find(b=>b.name===initial.items.find(x=>x.id===id).name)).toMatchObject({qty:1});
  });
 });
}
