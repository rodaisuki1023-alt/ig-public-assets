const {test,expect}=require('@playwright/test');
const {open,go,stored,baseState,KEY,shot}=require('./helpers.cjs');
const pick=(p,f,v)=>p.click(`[data-qa-baby="${f}"][data-value="${v}"]`);
for(const [width,height] of [[320,568],[375,667],[390,844],[430,932]]){
 test.describe(`v27 baby products ${width}px`,()=>{
  test.use({viewport:{width,height}});
  test('custom values stay editable and named milk, follow-ups and wipes persist separately',async({page},info)=>{
   const initial=baseState();await open(page,{[KEY]:initial});await page.click('#bfNavAdd');
   await pick(page,'brand','その他');await pick(page,'type','その他');await pick(page,'size','その他');
   await page.fill('#qaBabyBrand','自分のブランド');await page.fill('#qaBabyType','夜用パンツ');
   await page.fill('#qaBabyUnit','袋');await page.fill('#qaBabySize','スーパービッグ');
   await page.click('[data-qa-step="1"]');
   await expect(page.locator('#qaBabyBrand')).toHaveValue('自分のブランド');
   await page.fill('#qaBabyBrand','変更ブランド');await page.click('[data-qa-babyadd]');
   expect(await stored(page)).toEqual(initial);
   await pick(page,'kind','milk');await pick(page,'brand','明治');await pick(page,'type','缶');
   await page.click('[data-qa-babyadd]');
   await page.locator('.qa-followup summary').click();await pick(page,'product','明治|ステップ');
   await pick(page,'type','缶');await page.click('[data-qa-babyadd]');
   await pick(page,'brand','その他');await page.fill('#qaBabyBrand','独自メーカー');
   await page.fill('#qaBabySeries','独自ミルク');await pick(page,'type','スティック');
   await page.click('[data-qa-babyadd]');
   await pick(page,'kind','wipes');
   await expect(page.locator('#qaBaby [data-qa-baby="type"]')).toHaveCount(0);
   await expect(page.locator('#qaBaby [data-value="ピジョン"]')).toHaveCount(0);
   for(const brand of ['カークランド','Rico','baby care']){await pick(page,'brand',brand);await page.click('[data-qa-babyadd]')}
   await pick(page,'brand','その他');await page.fill('#qaBabyBrand','自分のおしりふき');
   await page.click('[data-qa-step="1"]');await expect(page.locator('#qaBabyBrand')).toHaveValue('自分のおしりふき');
   await page.click('[data-qa-babyadd]');
   expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
   await shot(page,info,`${width}-v27-custom-wipes`);
   await page.click('#qaCommit');const saved=await stored(page);
   expect(saved.items).toHaveLength(initial.items.length+8);
   expect(saved.items.find(x=>x.name==='変更ブランド おむつ 夜用パンツ スーパービッグ')).toMatchObject({qty:2,unit:'袋'});
   expect(saved.items.filter(x=>/明治 (ほほえみ|ステップ) 粉ミルク 缶/.test(x.name))).toHaveLength(2);
   expect(saved.items.some(x=>x.name==='独自メーカー 独自ミルク 粉ミルク スティック')).toBe(true);
   for(const brand of ['カークランド','Rico','baby care'])expect(saved.items.some(x=>x.name===brand+' おしりふき')).toBe(true);
   expect(saved.buys).toEqual(initial.buys);expect(saved.routines).toEqual(initial.routines);
   await page.reload();expect(await stored(page)).toEqual(saved);
   await go(page,'stock');await shot(page,info,`${width}-v27-saved`);
  });
 });
}
test('all five follow-up products save as separate shopping entries and unsupported forms are absent',async({page},info)=>{
 const initial=baseState();await open(page,{[KEY]:initial});await page.click('#bfNavAdd');
 await pick(page,'kind','milk');await page.click('[data-qa-dest="buy"]');
 await page.locator('.qa-followup summary').click();await shot(page,info,'v27-milk-products');
 for(const [brand,name] of [['明治','ステップ'],['和光堂','ぐんぐん'],['森永','チルミル'],['ビーンスターク','つよいこ'],['アイクレオ','グローアップミルク']]){
  await pick(page,'product',brand+'|'+name);
  if(brand!=='明治'){
   await expect(page.locator('#qaBaby [data-qa-baby="type"][data-value="液体"]')).toHaveCount(0);
   await expect(page.locator('#qaBaby [data-qa-baby="type"][data-value="キューブ"]')).toHaveCount(0);
  }
  await pick(page,'type','缶');await page.click('[data-qa-babyadd]');
 }
 await page.click('#qaCommit');const saved=await stored(page);
 expect(saved.items).toEqual(initial.items);expect(saved.routines).toEqual(initial.routines);
 expect(saved.buys).toHaveLength(initial.buys.length+5);
 expect(new Set(saved.buys.map(x=>x.name)).size).toBe(saved.buys.length);
});
