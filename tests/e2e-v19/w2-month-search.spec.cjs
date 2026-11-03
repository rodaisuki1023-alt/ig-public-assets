// PR #81: month ages in the stock search. "7ヶ月" must not find 17ヶ月/27ヶ月, and the common spellings
// (ヶ月・ケ月・ヵ月・カ月・か月, full-width digits, half-typed "7ヶ") are one spelling. Shown names never change.
const { test, expect } = require('@playwright/test');
const { open, go, baseState, KEY, shot } = require('./helpers.cjs');
test.use({ viewport: { width: 390, height: 844 } });

const items = [
  { id: 1, name: '和光堂 離乳食 はじめての離乳食 裏ごし鶏レバーと野菜 7か月頃から 3個 フリーズドライ', cat: '離乳食', qty: 2, unit: '個', expType: '期限なし', exp: '' },
  { id: 2, name: '和光堂 離乳食 栄養マルシェ 和風お子さまランチ 12か月頃から 90g×1パック、80g×1パック カップ', cat: '離乳食', qty: 1, unit: '個', expType: '期限なし', exp: '' },
  { id: 3, name: 'ベビーおやつ 17ヶ月頃から', cat: '食料品', qty: 1, unit: '袋', expType: '期限なし', exp: '' },
  { id: 4, name: 'ベビーせんべい 7ケ月頃から', cat: '食料品', qty: 1, unit: '袋', expType: '期限なし', exp: '' },
  { id: 5, name: 'ボーロ 27ヵ月', cat: '食料品', qty: 1, unit: '袋', expType: '期限なし', exp: '' },
];
const shown = page => page.locator('#stockList [data-stock-id]').evaluateAll(rows => rows.map(r => Number(r.dataset.stockId)).sort((a, b) => a - b));
const search = (page, text) => page.fill('#stockSearch', text);

test('stock search: month ages keep the digit boundary and accept every common spelling', async ({ page }, info) => {
  await open(page, { [KEY]: baseState({ items, buys: [], routines: [] }) });
  await go(page, 'stock');
  for (const q of ['7ヶ月', '7か月', '７カ月', '7ヵ月', '7ケ月', '7ヶ', '7か']) {
    await search(page, q);
    await expect.poll(() => shown(page), { message: q }).toEqual([1, 4]);
  }
  await search(page, '17ヶ月'); await expect.poll(() => shown(page)).toEqual([3]);
  await search(page, '27か月'); await expect.poll(() => shown(page)).toEqual([5]);
  await search(page, '12ヵ月'); await expect.poll(() => shown(page)).toEqual([2]);
  await search(page, '2か月'); await expect.poll(() => shown(page)).toEqual([]); // not the 2 in 12か月
  await expect(page.locator('.atk-empty-guide')).toContainText('「2か月」に一致する商品はありません');
  // A bare number is still a plain substring search; several words must all match.
  await search(page, '7'); await expect.poll(() => shown(page)).toEqual([1, 3, 4, 5]);
  await search(page, '和光堂 7か月'); await expect.poll(() => shown(page)).toEqual([1]);
  // The shown names are unchanged.
  await search(page, '７カ月');
  await page.click('[data-atk-view="list"]');
  await expect(page.locator('#stockList [data-stock-id="4"]')).toContainText('7ケ月頃から');
  await expect(page.locator('#stockList .atk-food-month')).toContainText(['7か月頃から']);
  await expect(page.locator('#stockList [data-stock-id="1"] .name')).toContainText('裏ごし鶏レバーと野菜');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await shot(page, info, 'pr81-month-search-390');
  expect(page.__errors).toEqual([]);
});

test('baby-food filter: the month search is the same inside the 離乳食 category', async ({ page }) => {
  await open(page, { [KEY]: baseState({ items, buys: [], routines: [] }) });
  await go(page, 'stock');
  await page.evaluate(() => setFilter('離乳食'));
  await search(page, '7か月');
  const ids = await shown(page);
  expect(ids).toContain(1);
  expect(ids).not.toContain(2);
  expect(ids).not.toContain(3);
  expect(ids).not.toContain(5);
  await search(page, '12ヶ月');
  await expect.poll(() => shown(page)).toEqual([2]);
  expect(page.__errors).toEqual([]);
});

// v48.2: the add screen's 離乳食 search uses the same month-age search (it was a plain substring search).
test('add screen (離乳食): month ages keep the digit boundary and accept every spelling', async ({ page }, info) => {
  await open(page, { [KEY]: baseState({ items: [], buys: [], routines: [] }) });
  await go(page, 'add');
  await page.click('[data-qa-cat="離乳食"]');
  const ages = () => page.locator('.qa-food-products [data-qa-food-product] small').evaluateAll(xs => [...new Set(xs.map(x => x.textContent.split('・')[0]))].sort());
  const count = async () => Number((await page.locator('.qa-food-result').textContent()).match(/（(\d+)件）/)[1]);
  // 和光堂 writes か月; ピジョン writes ヵ月.
  await page.click('[data-qa-food-maker="wakodo"]');
  await page.fill('#qaFoodSearch', '7か月');
  await expect.poll(ages).toEqual(['7か月頃から']);
  const wakodo7 = await count();
  for (const q of ['7ヶ月', '７カ月', '7ケ月', '7ヶ']) {
    await page.fill('#qaFoodSearch', q);
    await expect.poll(count, { message: q }).toBe(wakodo7);
    await expect.poll(ages, { message: q }).toEqual(['7か月頃から']);
  }
  await page.fill('#qaFoodSearch', '2か月');
  await expect.poll(count).toBe(0); // not the 2 in 12か月
  await page.fill('#qaFoodSearch', '12ヶ月');
  await expect.poll(ages).toEqual(['12か月頃から']);
  await page.click('[data-qa-food-maker="pigeon"]');
  await page.fill('#qaFoodSearch', '7か月');
  await expect.poll(ages).toEqual(['7ヵ月頃~']);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await shot(page, info, 'v48-2-add-babyfood-month-search-390');
  expect(page.__errors).toEqual([]);
});

test('manual baby food age can be selected and survives reload', async ({page})=>{
 const stock=[{id:81,name:'手作りスープ',cat:'その他',qty:1,unit:'個',expType:'期限なし',exp:''}];
 await open(page,{[KEY]:baseState({items:stock,buys:[],routines:[]})});
 await go(page,'stock');await page.evaluate(()=>window.atokoreEditStock(81));
 await page.locator('#atkEditForm select[name="cat"]').selectOption('離乳食');
 await page.locator('#atkEditForm select[name="babyFoodMonth"]').selectOption('16');
 await page.locator('#atkEditForm button[type="submit"]').click();
 await page.click('[data-atk-view="list"]');
 await expect(page.locator('#stockList .atk-food-month')).toContainText(['1歳4か月頃から']);
 await page.reload();await go(page,'stock');
 await expect(page.locator('#stockList .atk-food-month')).toContainText(['1歳4か月頃から']);
 await expect(page.locator('#stockList [data-stock-id="81"] .name')).toHaveText('手作りスープ');
});

test('baby food is ordered by age in card and list views, including manually entered age',async({page})=>{
 const food=[
  {id:91,name:'おかゆ 12か月頃から',cat:'離乳食',qty:1,unit:'個'},
  {id:92,name:'手作りスープ',cat:'離乳食',babyFoodMonth:6,qty:1,unit:'個'},
  {id:93,name:'月齢が不明な離乳食',cat:'離乳食',qty:1,unit:'個'},
  {id:94,name:'野菜 7ヶ月頃から',cat:'離乳食',qty:1,unit:'個'}
 ];
 await open(page,{[KEY]:baseState({items:food,buys:[],routines:[]})});
 await go(page,'stock');
 const order=()=>page.locator('#stockList [data-stock-id]').evaluateAll(rows=>rows.map(r=>Number(r.dataset.stockId)));
 await expect.poll(order).toEqual([92,94,91,93]);
 await page.click('[data-atk-view="list"]');
 await expect.poll(order).toEqual([92,94,91,93]);
 await expect(page.locator('#stockList .atk-food-month')).toHaveText(['6か月頃から','7か月頃から','1歳から','月齢未設定'].map(x=>x==='1歳から'?'1歳頃から':x));
 expect(page.__errors).toEqual([]);
});
