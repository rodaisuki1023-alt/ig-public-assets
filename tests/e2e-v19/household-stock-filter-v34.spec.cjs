const {test,expect}=require('@playwright/test');
const {open,go,stored,baseState,KEY,shot,commitBatch}=require('./helpers.cjs');
function fixture(){
 const state=baseState({buys:[]});
 const names=[
  [4,'鶏むね肉','食料品'],[5,'玉ねぎ','食料品'],[6,'鮭','食料品'],[7,'冷凍ブロッコリー','食料品'],
  [8,'離乳食 白身魚と野菜のおかゆ 5か月','食料品'],[9,'離乳食 白身魚と野菜のおかゆ 7か月','食料品'],
  [11,'ティッシュ','日用品'],[12,'洗濯洗剤','日用品'],[13,'食器用洗剤','日用品'],[14,'浴室洗剤','日用品'],
  [15,'シャンプー','日用品'],[16,'自分で登録した道具','日用品'],[17,'離乳食 鶏と野菜','ベビー'],[18,'離乳食用スプーン','日用品']
 ];
 state.items.push(...names.map(([id,name,cat])=>({id,name,cat,qty:2,unit:'個',place:'収納',expType:'期限なし',exp:'',usage:1})));
 return state;
}
const ids=page=>page.locator('#stockList [data-stock-id]').evaluateAll(es=>es.map(e=>Number(e.dataset.stockId)));
const category=(page,name)=>page.locator('#catChips').getByRole('button',{name,exact:true}).click();
const group=(page,key)=>page.locator(`.bf-stock-subfilters [data-bf-stock-kind="${key}"]`);
for(const [width,height] of [[320,568],[375,667],[390,844],[430,932]]){
 test.describe(`household stock groups ${width}px`,()=>{
  test.use({viewport:{width,height}});
  test('food and daily groups, baby-food variants, safe bulk actions and add-page round trip',async({page},info)=>{
   const initial=fixture();await open(page,{[KEY]:initial});await go(page,'stock');
   await category(page,'食料品');const bar=page.locator('#bfStockHouseholdFilters');
   await expect(bar).toHaveAttribute('aria-label','食料品の種類');
   for(const [key,want] of [['meat',[4]],['egg',[3]],['vegetable',[5]],['fish',[6]],['frozen',[7]],['bread',[]]]){
    await group(page,key).click();expect(await ids(page)).toEqual(want);
   }
   await group(page,'frozen').click();
   const layout=await bar.evaluate(b=>({overflow:document.documentElement.scrollWidth-innerWidth,rows:new Set([...b.children].map(c=>Math.round(c.getBoundingClientRect().top))).size,minHeight:Math.min(...[...b.children].map(c=>c.getBoundingClientRect().height)),scroll:b.scrollWidth>b.clientWidth}));
   expect(layout).toEqual({overflow:0,rows:1,minHeight:44,scroll:true});
   await group(page,'frozen').scrollIntoViewIfNeeded();await shot(page,info,`${width}-v34-food-stock-filters`);
   expect(await stored(page)).toEqual(initial);
   await category(page,'日用品');await expect(bar).toHaveAttribute('aria-label','日用品の種類');
   expect(await bar.evaluate(b=>b.scrollLeft)).toBe(0);await expect(group(page,'all')).toHaveAttribute('aria-pressed','true');
   for(const [key,want] of [['paper',[11]],['laundry',[12]],['kitchen',[13,18]],['cleaning',[14]],['care',[15]],['other',[16]]]){
    await group(page,key).click();expect(await ids(page)).toEqual(want);
   }
   expect(await stored(page)).toEqual(initial);await group(page,'care').click();
   await page.click('#stockSelectToggle');await page.getByRole('button',{name:'表示中を全選択',exact:true}).click();await expect(page.locator('#stockBulkMove')).toContainText('1件');
   await group(page,'kitchen').click();await expect(page.locator('#stockBulkMove')).toContainText('0件');
   await page.getByRole('button',{name:'表示中を全選択',exact:true}).click();await page.click('#stockBulkMove');
   const moved=await stored(page);expect(moved.items).toEqual(initial.items);expect(moved.buys.map(x=>x.name)).toEqual(['食器用洗剤','離乳食用スプーン']);
   await go(page,'stock');await category(page,'ベビー');expect(await ids(page)).toEqual([2]);
   await category(page,'離乳食');expect(await ids(page)).toEqual([8,9,17]);
   await page.fill('#stockSearch','7か月');expect(await ids(page)).toEqual([9]);await page.fill('#stockSearch','');
   await page.locator('#stockList [data-stock-id="8"] .qty button').last().click();
   const adjusted=await stored(page);expect(adjusted.items.find(x=>x.id===8).qty).toBe(3);expect(adjusted.items.find(x=>x.id===9).qty).toBe(2);
   expect(adjusted.items.filter(x=>x.id!==8)).toEqual(initial.items.filter(x=>x.id!==8));
   await page.click('#bfNavAdd');await expect(page.locator('#qaBabyFood')).toBeVisible();await page.click('[data-qa-food-maker="other"]');
   for(const [field,value] of [['Brand','手作り'],['Name','野菜ペースト'],['Amount','30g'],['Format','冷凍']])await page.fill('#qaFood'+field,value);
   await page.click('[data-qa-food-add]');expect(await stored(page)).toEqual(adjusted);
   await commitBatch(page);const added=await stored(page);
   expect(added.items.filter(x=>x.name==='手作り 離乳食 野菜ペースト 30g 冷凍')).toHaveLength(1);
   expect(added.items.find(x=>x.name==='手作り 離乳食 野菜ペースト 30g 冷凍')).toMatchObject({cat:'離乳食',qty:1});
   expect(added.items.filter(x=>x.name!=='手作り 離乳食 野菜ペースト 30g 冷凍')).toEqual(adjusted.items);
   expect(added.buys).toEqual(moved.buys);expect(added.routines).toEqual(initial.routines);
   await page.reload();await go(page,'stock');await category(page,'離乳食');
   await expect(page.locator('#stockList [data-stock-id]')).toHaveCount(4);expect(await stored(page)).toEqual(added);
   expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBe(0);expect(page.__errors).toEqual([]);
  });
 });
}
