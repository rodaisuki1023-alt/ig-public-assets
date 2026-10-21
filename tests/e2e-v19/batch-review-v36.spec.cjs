// v36 batch add: products are confirmed on a review screen, saved once by its final button, and the
// stock list then shows them even when an earlier category, subgroup or search word would hide them.
// Reported case: three products picked, "まとめてストックに追加" pressed, nothing seen in the stock list.
const {test,expect}=require('@playwright/test');
const zlib=require('node:zlib');
const {open,go,stored,baseState,chooseBaby,KEY,shot}=require('./helpers.cjs');
const memory=page=>page.evaluate(()=>JSON.parse(JSON.stringify({items,buys,routines})));
const visibleIds=page=>page.locator('#stockList [data-stock-id]').evaluateAll(es=>es.map(e=>Number(e.dataset.stockId)));
const category=(page,name)=>page.locator('#catChips').getByRole('button',{name,exact:true}).click();
async function failWrites(page){
 await page.evaluate(key=>{const original=Storage.prototype.setItem;window.__restoreWrites=()=>{Storage.prototype.setItem=original};
  Storage.prototype.setItem=function(k,v){if(k===key)throw new DOMException('quota','QuotaExceededError');return original.call(this,k,v)}},KEY);
}
const diaperM='パンパース さらさらケア おむつ テープ M';
function fixture(){
 const state=baseState();
 state.items.push({id:4,name:'明治 ほほえみ 粉ミルク 缶',cat:'ベビー',qty:1,unit:'缶',place:'収納',expType:'期限なし',exp:'',usage:1});
 return state;
}
// One diaper (already in stock), one milk form not yet registered, one wipes product not yet registered.
async function pickBabyTrio(page){
 await page.click('[data-qa-cat="ベビー"]');
 await chooseBaby(page,{kind:'diaper',brand:'パンパース',type:'テープ',size:'M',series:'さらさらケア'});
 await chooseBaby(page,{kind:'milk',brand:'明治',type:'キューブ'});
 await chooseBaby(page,{kind:'wipes',brand:'Rico'});
}

for(const [width,height] of [[320,568],[375,667],[390,844],[430,932]]){
 test.describe(`batch review ${width}px`,()=>{
  test.use({viewport:{width,height}});
  test('diaper, milk and wipes: leftover filters, review edits, one save, all three shown and kept after reload',async({page},info)=>{
   const initial=fixture();await open(page,{[KEY]:initial});
   // The stock list was left on ベビー > おむつ with a search word: this used to hide two of the three.
   await go(page,'stock');await category(page,'ベビー');await page.click('[data-bf-stock-kind="diaper"]');await page.fill('#stockSearch','パンパース');
   await page.click('#bfNavAdd');await pickBabyTrio(page);
   await expect(page.locator('#qaBar')).toContainText('3商品・合計3点');
   await expect(page.locator('#qaTray')).toBeHidden();
   expect(await stored(page)).toEqual(initial);
   await page.click('#qaBar');
   const rows=page.locator('#qaTrayList .qa-review-item');
   await expect(rows).toHaveCount(3);
   await expect(rows.nth(0)).toContainText(diaperM);await expect(rows.nth(0)).toContainText('登録済みの在庫に合算：2袋 → 3袋');
   await expect(rows.nth(1)).toContainText('明治 ほほえみ 粉ミルク キューブ');await expect(rows.nth(1)).toContainText('新しい商品として登録');
   await expect(rows.nth(2)).toContainText('Rico おしりふき');await expect(rows.nth(2)).toContainText('パック');
   await expect(page.locator('#qaCommit')).toHaveText('まとめてストックに追加');
   await rows.nth(1).locator('[data-step="1"]').click();
   await expect(page.locator('#qaTotal')).toHaveText('3商品（数量の合計4点）');
   expect(await stored(page)).toEqual(initial);
   await shot(page,info,`${width}-v36-review`);
   await page.click('#qaCommit');
   await expect(page.locator('#pg-stock')).toHaveClass(/on/);
   await expect(page.locator('#qaNotice')).toContainText('3商品（数量の合計4点）をストックに保存しました（うち1商品は登録済みの商品に数量を合算）');
   const saved=await stored(page);
   expect(saved.items.slice(0,4)).toEqual(initial.items.map(x=>x.id===2?{...x,qty:3}:x));
   const added=saved.items.slice(4);
   expect(added.map(x=>[x.name,x.cat,x.qty,x.unit])).toEqual([['明治 ほほえみ 粉ミルク キューブ','ベビー',2,'箱'],['Rico おしりふき','ベビー',1,'パック']]);
   expect(saved.buys).toEqual(initial.buys);expect(saved.routines).toEqual(initial.routines);
   expect(await memory(page)).toEqual(saved);
   // Every record of the batch is on screen: filter ベビー, subgroup すべて, search cleared.
   await expect(page.locator('#stockSearch')).toHaveValue('');
   await expect(page.locator('[data-bf-stock-kind="all"]')).toHaveAttribute('aria-pressed','true');
   const shown=await visibleIds(page);for(const id of [2,...added.map(x=>x.id)])expect(shown).toContain(id);
   await expect(page.locator('#stockList .bf-stock-added')).toHaveCount(3);
   await expect(page.locator(`#stockList [data-stock-id="${added[0].id}"] .bf-stock-count`)).toHaveText('残り 2箱');
   await shot(page,info,`${width}-v36-stock-after`);
   await page.reload();expect(await stored(page)).toEqual(saved);
   await page.click('#bfNavAdd');await expect(page.locator('#qaBar')).toBeHidden();
   expect(page.__errors).toEqual([]);
  });
 });
}

test.describe('batch review behaviour',()=>{
 test('mixed baby, food and household products, with and without baby food, after any leftover stock view',async({page})=>{
  const initial=fixture();await open(page,{[KEY]:initial});
  const cases=[
   {prep:async()=>{await category(page,'離乳食')},food:false,expect:'すべて'},
   {prep:async()=>{await category(page,'食料品')},food:true,expect:'すべて'},
   {prep:async()=>{await page.fill('#stockSearch','卵')},food:false,expect:'すべて'},
  ];
  let before=initial;
  for(const c of cases){
   await go(page,'stock');await c.prep();
   await page.click('#bfNavAdd');
   await page.click('[data-qa-cat="ベビー"]');await chooseBaby(page,{kind:'wipes',brand:'Rico'});
   await page.click('[data-qa-cat="食料品"]');await page.click('[data-qa-pick="バナナ"]');
   await page.click('[data-qa-cat="日用品"]');await page.click('[data-qa-pick="ティッシュ"]');
   if(c.food){await page.click('[data-qa-cat="離乳食"]');await page.click('[data-qa-food-maker="wakodo"]');await page.locator('[data-qa-food-product]').first().click();await page.click('[data-qa-food-add]')}
   await page.click('#qaBar');await page.click('#qaCommit');
   await expect(page.locator('#pg-stock')).toHaveClass(/on/);
   const saved=await stored(page);
   const touched=saved.items.filter(x=>!before.items.some(y=>JSON.stringify(y)===JSON.stringify(x)));
   expect(touched.length).toBe(c.food?4:3);
   expect(await page.evaluate(()=>filter)).toBe(c.expect);await expect(page.locator('#stockSearch')).toHaveValue('');
   const shown=await visibleIds(page);for(const x of touched)expect(shown,x.name).toContain(x.id);
   // Only the chosen products changed; nothing else was rewritten.
   for(const x of before.items){const now=saved.items.find(y=>y.id===x.id);if(!touched.includes(now))expect(now).toEqual(x)}
   before=saved;
  }
  expect(page.__errors).toEqual([]);
 });

 test('three registered products only add to their own quantities; a different form stays separate',async({page})=>{
  const initial=fixture();initial.items.push({id:5,name:'Rico おしりふき',cat:'ベビー',qty:3,unit:'パック',place:'収納',expType:'期限なし',exp:'',usage:1});
  await open(page,{[KEY]:initial});await page.click('#bfNavAdd');
  await page.click('[data-qa-cat="ベビー"]');
  await chooseBaby(page,{kind:'diaper',brand:'パンパース',type:'テープ',size:'M',series:'さらさらケア'});
  await chooseBaby(page,{kind:'milk',brand:'明治',type:'缶'});
  await chooseBaby(page,{kind:'wipes',brand:'Rico'});
  await page.click('#qaBar');
  await expect(page.locator('#qaTrayList .qa-review-effect')).toHaveText(['登録済みの在庫に合算：2袋 → 3袋','登録済みの在庫に合算：1缶 → 2缶','登録済みの在庫に合算：3パック → 4パック']);
  await page.click('#qaCommit');
  const saved=await stored(page);
  expect(saved.items).toEqual(initial.items.map(x=>[2,4,5].includes(x.id)?{...x,qty:x.qty+1}:x));
  // Same brand and product but another size/type or form is a new record.
  await page.click('#bfNavAdd');await page.click('[data-qa-cat="ベビー"]');
  await chooseBaby(page,{kind:'diaper',brand:'パンパース',type:'パンツ',size:'M',series:'さらさらケア'});
  await chooseBaby(page,{kind:'milk',brand:'明治',type:'液体'});
  await page.click('#qaBar');await expect(page.locator('#qaTrayList .qa-review-effect')).toHaveText(['新しい商品として登録','新しい商品として登録']);
  await page.click('#qaCommit');
  const next=await stored(page);
  expect(next.items.slice(0,saved.items.length)).toEqual(saved.items);
  expect(next.items.slice(saved.items.length).map(x=>[x.name,x.unit])).toEqual([['パンパース さらさらケア おむつ パンツ M','袋'],['明治 ほほえみ 液体ミルク 液体','本']]);
 });

 test('going back keeps search and choices; removing, re-adding and reopening never save',async({page})=>{
  const initial=fixture();await open(page,{[KEY]:initial});await page.click('#bfNavAdd');
  await page.click('[data-qa-cat="離乳食"]');await page.click('[data-qa-food-maker="pigeon"]');
  await page.locator('[data-qa-food-product]').first().click();await page.click('[data-qa-food-add]');
  const foodName=await page.evaluate(()=>AtokoreQuickAdd.getTray()[0].name);
  await page.click('[data-qa-cat="食料品"]');await page.fill('#qaSearch','バナ');await page.click('[data-qa-pick="バナナ"]');
  await page.click('#qaBar');await expect(page.locator('#qaTrayList .qa-review-item')).toHaveCount(2);
  await page.click('[data-qa-review-back]');
  // Back on the picker exactly as it was: category, search word and the picked tile.
  await expect(page.locator('#qaPanel')).toBeVisible();
  await expect(page.locator('#qaSearch')).toHaveValue('バナ');
  await expect(page.locator('[data-qa-pick="バナナ"]')).toHaveClass(/picked/);
  await page.click('[data-qa-cat="離乳食"]');
  await expect(page.locator('[data-qa-food-maker="pigeon"]')).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('.qa-food-selected')).toContainText('選択中');
  // Remove one line on the review screen, add it again from the picker, reopen.
  await page.click('#qaBar');await page.locator('#qaTrayList .qa-review-item').nth(1).locator('[data-qa-remove]').click();
  await expect(page.locator('#qaTrayList .qa-review-item')).toHaveCount(1);
  await page.click('[data-qa-review-back]');
  await page.click('[data-qa-cat="食料品"]');await page.click('[data-qa-pick="バナナ"]');
  await page.click('#qaBar');await expect(page.locator('#qaTrayList .qa-review-item')).toHaveCount(2);
  await go(page,'home');await page.click('#bfNavAdd');await expect(page.locator('#qaBar')).toContainText('2商品');
  expect(await stored(page)).toEqual(initial);expect(await memory(page)).toEqual(initial);
  // Clearing everything still asks first.
  await page.click('#qaBar');page.removeAllListeners('dialog');const asked=[];
  page.on('dialog',d=>{asked.push(d.message());d.dismiss()});
  await page.click('[data-qa-clear]');expect(asked[0]).toContain('すべて取り消しますか');
  await expect(page.locator('#qaTrayList .qa-review-item')).toHaveCount(2);
  page.removeAllListeners('dialog');page.on('dialog',d=>d.accept());
  await page.click('#qaCommit');
  const saved=await stored(page);expect(saved.items.slice(4).map(x=>x.name)).toEqual([foodName,'バナナ']);
  expect(saved.items.slice(0,4)).toEqual(initial.items);
  expect(await page.evaluate(()=>filter)).toBe('すべて');
 });

 test('double tap and rapid taps on the final button save exactly once and touch no stock card',async({page})=>{
  const initial=fixture();await open(page,{[KEY]:initial});
  for(const tap of ['dblclick','burst']){
   const before=await stored(page);
   await page.click('#bfNavAdd');await page.click('[data-qa-cat="ベビー"]');await pickBabyTrio(page);await page.click('#qaBar');
   await page.locator('#qaCommit').evaluate(el=>el.scrollIntoView({block:'center'}));
   const box=await page.locator('#qaCommit').boundingBox(),x=box.x+box.width/2,y=box.y+box.height/2;
   if(tap==='dblclick')await page.mouse.dblclick(x,y);
   else for(let i=0;i<4;i++){await page.mouse.click(x,y);await page.waitForTimeout(60)}
   await expect(page.locator('#pg-stock')).toHaveClass(/on/);await page.waitForTimeout(500);
   const after=await stored(page);
   expect(after.items.find(i=>i.id===2).qty,tap).toBe(before.items.find(i=>i.id===2).qty+1);
   expect(after.items.length,tap).toBe(before.items.length+(tap==='dblclick'?2:0));
   for(const item of before.items.filter(i=>i.id!==2&&!/キューブ|Rico/.test(i.name)))expect(after.items.find(i=>i.id===item.id),tap).toEqual(item);
  }
 });

 test('a failed save keeps everything for a retry; a drawing error after saving never invites a second add',async({page})=>{
  const initial=fixture();await open(page,{[KEY]:initial});
  await go(page,'stock');await category(page,'食料品');
  await page.click('#bfNavAdd');await pickBabyTrio(page);await page.click('#qaBar');
  await failWrites(page);await page.click('#qaCommit');
  await expect(page.locator('#qaNotice')).toContainText('保存できませんでした。追加予定はそのまま残っています');
  await expect(page.locator('#qaTray')).toBeVisible();await expect(page.locator('#qaTrayList .qa-review-item')).toHaveCount(3);
  expect(await stored(page)).toEqual(initial);expect(await memory(page)).toEqual(initial);
  // The earlier stock view is not reset by a failed save.
  expect(await page.evaluate(()=>filter)).toBe('食料品');
  await page.evaluate(()=>window.__restoreWrites());
  const errors=[];page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
  await page.evaluate(()=>{window.render=()=>{throw Error('injected drawing failure')}});
  await page.click('#qaCommit');
  await expect(page.locator('#qaNotice')).toContainText('もう一度追加する必要はありません');
  await expect(page.locator('#qaNotice')).not.toContainText('保存できませんでした');
  const saved=await stored(page);expect(saved.items).toHaveLength(initial.items.length+2);
  expect(saved.items.find(x=>x.id===2).qty).toBe(3);
  expect(errors.some(e=>e.includes('保存後の表示更新に失敗'))).toBe(true);
  await page.reload();expect(await stored(page)).toEqual(saved);
  await page.click('#bfNavAdd');await expect(page.locator('#qaBar')).toBeHidden();
 });

 test('shopping list destination saves only there, with its own button and wording',async({page})=>{
  const initial=fixture();await open(page,{[KEY]:initial});await go(page,'buy');
  await page.click('#bfNavAdd');await page.click('[data-qa-cat="ベビー"]');await chooseBaby(page,{kind:'wipes',brand:'Rico'});
  await page.click('#qaBar');await expect(page.locator('#qaTrayDest')).toHaveText('保存先：買い物リスト');
  await expect(page.locator('#qaCommit')).toHaveText('まとめて買い物リストに追加');
  await page.click('#qaTray [data-qa-dest="stock"]');await expect(page.locator('#qaCommit')).toHaveText('まとめてストックに追加');
  await page.click('#qaTray [data-qa-dest="buy"]');await page.click('#qaCommit');
  await expect(page.locator('#pg-buy')).toHaveClass(/on/);
  const saved=await stored(page);expect(saved.items).toEqual(initial.items);expect(saved.routines).toEqual(initial.routines);
  expect(saved.buys.map(x=>[x.name,x.qty])).toEqual([...initial.buys.map(x=>[x.name,x.qty]),['Rico おしりふき',1]]);
 });

 test('an existing product photo stays on its record after the batch adds to it',async({page})=>{
  const initial=fixture();await open(page,{[KEY]:initial});await go(page,'stock');
  await page.locator('#stockList [data-stock-id="2"] .name').click();await page.click('.atk-photo-open');
  await page.locator('#atkPhotoEditor input[type=file]').setInputFiles(png());await page.click('.atk-photo-save');
  await expect(page.locator('.atk-detail-photo')).toBeVisible();await page.click('#sheet .close');
  await expect(page.locator('#stockList [data-stock-id="2"] .atk-user-photo')).toBeVisible();
  await page.click('#bfNavAdd');await pickBabyTrio(page);await page.click('#qaBar');await page.click('#qaCommit');
  await expect(page.locator('#stockList [data-stock-id="2"] .atk-user-photo')).toBeVisible();
  await page.reload();await go(page,'stock');
  await expect(page.locator('#stockList [data-stock-id="2"] .atk-user-photo')).toBeVisible();
  expect((await stored(page)).items.find(x=>x.id===2).qty).toBe(3);
 });

 test('long names, a short viewport and the on-screen keyboard leave the bar and final button usable',async({page},info)=>{
  // 390x480 approximates Safari with its toolbar or the keyboard taking the lower part of the screen.
  await page.setViewportSize({width:390,height:480});
  const initial=fixture();await open(page,{[KEY]:initial});await page.click('#bfNavAdd');
  await page.click('[data-qa-cat="日用品"]');
  const long='とても長い商品名のテスト用ボディソープ詰め替え用大容量パック 二〇〇〇ミリリットル 無香料 敏感肌向け 家族みんなで使える';
  await page.fill('#qaFree',long);await page.click('[data-qa-free]');
  await page.click('[data-qa-pick="ティッシュ"]');
  await page.locator('#qaSearch').focus();
  const facts=await page.evaluate(()=>{const s=document.getElementById('qaSearch').getBoundingClientRect(),b=document.getElementById('qaBar').getBoundingClientRect();return {overlap:!(s.bottom<=b.top||s.top>=b.bottom),overflow:document.scrollingElement.scrollWidth-innerWidth,barBottom:b.bottom,navTop:document.querySelector('.tabs').getBoundingClientRect().top}});
  expect(facts.overlap).toBe(false);expect(facts.overflow).toBeLessThanOrEqual(0);expect(facts.barBottom).toBeLessThanOrEqual(facts.navTop+0.5);
  await page.click('#qaBar');
  await expect(page.locator('#qaTrayList')).toContainText(long);
  expect(await page.evaluate(()=>document.scrollingElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(0);
  await page.locator('#qaCommit').scrollIntoViewIfNeeded();await expect(page.locator('#qaCommit')).toBeInViewport();
  await shot(page,info,'390x480-v36-long-review');
  await page.click('#qaCommit');
  expect((await stored(page)).items.some(x=>x.name===long)).toBe(true);
 });
});

function png(){
 const crc32=d=>{let c=0xffffffff;for(const b of d){c^=b;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0)}return (c^0xffffffff)>>>0};
 const chunk=(t,d)=>{const l=Buffer.from(t),s=Buffer.alloc(4),c=Buffer.alloc(4);s.writeUInt32BE(d.length);c.writeUInt32BE(crc32(Buffer.concat([l,d])));return Buffer.concat([s,l,d,c])};
 const h=Buffer.alloc(13);h.writeUInt32BE(40,0);h.writeUInt32BE(40,4);h[8]=8;h[9]=2;
 const px=Buffer.alloc(40*(1+40*3),120);for(let y=0;y<40;y++)px[y*121]=0;
 return {name:'item.png',mimeType:'image/png',buffer:Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',h),chunk('IDAT',zlib.deflateSync(px)),chunk('IEND',Buffer.alloc(0))])};
}
