const {test,expect}=require('@playwright/test');
const {open,go,stored,baseState,KEY,shot}=require('./helpers.cjs');
function fixture(){
 const state=baseState({buys:[]});
 const extra=[
  [4,'パンパース 水分たっぷり おしりふき','ベビー'],[5,'明治 ほほえみ 粉ミルク 缶','ベビー'],
  [6,'森永 チルミル フォローアップミルク 缶','ベビー'],[7,'ベビーローション','ベビー'],
  [8,'自分で登録したベビー用品','ベビー'],[9,'ｵﾑﾂ L','ベビー'],[10,'ミルク','ベビー'],
  [11,'お尻拭き','ベビー'],[12,'ミルクパン','食料品']
 ];
 state.items.push(...extra.map(([id,name,cat])=>({id,name,cat,qty:2,unit:'個',place:'収納',expType:'期限なし',exp:'',usage:1})));
 return state;
}
const ids=page=>page.locator('#stockList [data-stock-id]').evaluateAll(es=>es.map(e=>Number(e.dataset.stockId)));
const category=(page,name)=>page.locator('#catChips').getByRole('button',{name,exact:true}).click();
const group=(page,key)=>page.locator(`[data-bf-stock-kind="${key}"]`);
for(const [width,height] of [[320,568],[375,667],[390,844],[430,932]]){
 test.describe(`baby stock filters ${width}px`,()=>{
  test.use({viewport:{width,height}});
  test('existing stock, search, corner controls and bulk selection follow the baby subgroup',async({page},info)=>{
   const initial=fixture();await open(page,{[KEY]:initial});await go(page,'stock');
   await expect(page.locator('#bfStockBabyFilters')).toHaveCount(0);
   await category(page,'ベビー');expect(await ids(page)).toEqual([2,4,5,6,7,8,9,10,11]);
   const bar=page.getByRole('group',{name:'ベビー用品の種類'});
   await expect(bar.getByRole('button')).toHaveText(['すべて','おむつ','ミルク','おしりふき','その他']);
   await group(page,'diaper').click();expect(await ids(page)).toEqual([2,9]);
   await group(page,'milk').focus();await group(page,'milk').press('Enter');
   await expect(group(page,'milk')).toBeFocused();await expect(group(page,'milk')).toHaveAttribute('aria-pressed','true');
   expect(await ids(page)).toEqual([5,6,10]);
   await page.fill('#stockSearch','明治');expect(await ids(page)).toEqual([5]);
   await page.fill('#stockSearch','該当なし検索');await expect(page.locator('#stockList .empty')).toBeVisible();
   await expect(bar).toBeVisible();await group(page,'wipes').click();expect(await ids(page)).toEqual([]);
   await page.fill('#stockSearch','');expect(await ids(page)).toEqual([4,11]);
   await group(page,'other').click();expect(await ids(page)).toEqual([7,8]);
   expect(await stored(page)).toEqual(initial);
   await group(page,'milk').click();
   const layout=await bar.evaluate(b=>({overflow:document.documentElement.scrollWidth-innerWidth,buttons:[...b.querySelectorAll('button')].map(e=>{const r=e.getBoundingClientRect();return {height:r.height,left:r.left,right:r.right}}),width:innerWidth}));
   expect(layout.overflow).toBeLessThanOrEqual(0);
   for(const b of layout.buttons){expect(b.height).toBeGreaterThanOrEqual(44);expect(b.left).toBeGreaterThanOrEqual(0);expect(b.right).toBeLessThanOrEqual(width)}
   await group(page,'milk').scrollIntoViewIfNeeded();await shot(page,info,`${width}-v33-baby-stock-filters`);
   await page.locator('#stockList [data-stock-id="5"] .qty button').last().click();
   const adjusted=await stored(page);expect(adjusted.items.find(x=>x.id===5).qty).toBe(3);
   expect(adjusted.items.filter(x=>x.id!==5)).toEqual(initial.items.filter(x=>x.id!==5));
   await expect(group(page,'milk')).toHaveAttribute('aria-pressed','true');expect(await ids(page)).toEqual([5,6,10]);
   await group(page,'diaper').click();await page.click('#stockSelectToggle');
   await page.getByRole('button',{name:'表示中を全選択',exact:true}).click();await expect(page.locator('#stockBulkMove')).toContainText('2件');
   await group(page,'wipes').click();await expect(page.locator('#stockBulkMove')).toContainText('0件');
   await page.getByRole('button',{name:'表示中を全選択',exact:true}).click();await expect(page.locator('#stockBulkMove')).toContainText('2件');
   await page.click('#stockBulkMove');const moved=await stored(page);
   expect(moved.items).toEqual(adjusted.items);expect(moved.routines).toEqual(initial.routines);
   expect(moved.buys.map(x=>x.name)).toEqual([initial.items.find(x=>x.id===4).name,'お尻拭き']);
   await go(page,'stock');await category(page,'食料品');await expect(bar).toHaveCount(0);expect(await ids(page)).toEqual([1,3,12]);
   await category(page,'ベビー');expect(await ids(page)).toEqual([2,4,5,6,7,8,9,10,11]);await expect(group(page,'all')).toHaveAttribute('aria-pressed','true');
   await page.reload();await go(page,'stock');await category(page,'ベビー');expect(await ids(page)).toEqual([2,4,5,6,7,8,9,10,11]);
   expect(await stored(page)).toEqual(moved);expect(page.__errors).toEqual([]);
  });
 });
}
