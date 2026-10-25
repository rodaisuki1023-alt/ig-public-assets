const { test, expect } = require('@playwright/test');
const { open, go, stored, baseState, chooseBaby, KEY, HISTORY, shot, commitBatch, appConfirm } = require('./helpers.cjs');
const raw = page => page.evaluate(k => localStorage.getItem(k), KEY);
const memory = page => page.evaluate(() => JSON.parse(JSON.stringify({ items, buys, routines })));

async function failWrites(page) {
  await page.evaluate(key => {
    const original = Storage.prototype.setItem;
    window.__restoreRoutineStorage = () => { Storage.prototype.setItem = original; };
    Storage.prototype.setItem = function(k, v) {
      if (k === key) throw new DOMException('quota', 'QuotaExceededError');
      return original.call(this, k, v);
    };
  }, KEY);
}

for (const [width, height] of [[320, 568], [375, 667], [390, 844], [430, 932]]) {
  test.describe(`routine safety ${width}px`, () => {
    test.use({ viewport: { width, height } });

    test('view, cancel, failed save, retry and rapid repeat preserve exactly the intended records', async ({ page }, info) => {
      const initial = baseState();
      const production = JSON.stringify({ marker: 'production must stay untouched' });
      await open(page, { [KEY]: initial, atokoreTrialV4: production, [HISTORY]: [] });
      await go(page, 'buy');
      const before = await raw(page);
      await page.click('[data-bf-routine="901"]');
      expect(await raw(page)).toBe(before);
      expect(await memory(page)).toEqual(initial);
      expect(page.__dialogs).toEqual([]);

      const confirmations = [];
      await page.click('#atkRoutineStockCommit');
      confirmations.push(await appConfirm(page, false));
      expect(await raw(page)).toBe(before);
      expect(await memory(page)).toEqual(initial);
      await expect(page.locator('#modal')).toHaveClass(/on/);
      expect(confirmations[0]).toContain('パンパース さらさらケア おむつ テープ M × 2袋');
      expect(confirmations[0]).toContain('牛乳 × 1本');

      await failWrites(page);
      await page.click('#atkRoutineStockCommit');
      confirmations.push(await appConfirm(page, true));
      await expect(page.locator('#atkConfirm')).toContainText('保存できませんでした');
      expect(await raw(page)).toBe(before);
      expect(await memory(page)).toEqual(initial);
      await expect(page.locator('#modal')).toHaveClass(/on/);
      await page.evaluate(() => window.__restoreRoutineStorage());
      await page.locator('#atkConfirm .atk-confirm-primary').click(); // retry from the same confirmation
      await expect(page.locator('#atkConfirm')).toHaveCount(0);
      const saved = await stored(page);
      await expect(page.locator('#pg-stock')).toHaveClass(/on/);
      expect(saved.items.find(x => x.id === 2).qty).toBe(4);
      expect(saved.items.find(x => x.id === 1).qty).toBe(1); // dated milk stays separate
      expect(saved.items.filter(x => x.name === '牛乳').map(x => x.qty)).toEqual([1, 1]);
      expect(saved.items.find(x => x.id === 3)).toEqual(initial.items[2]);
      expect(saved.buys).toEqual(initial.buys);
      expect(saved.routines).toEqual(initial.routines);

      // The same handler used by both stock buttons must suppress an immediate repeat.
      await page.evaluate(() => AtokoreBabyFlow.addRoutineToStock(901));
      await expect(page.locator('#atkConfirm')).toHaveCount(0);
      expect(await stored(page)).toEqual(saved);
      expect(confirmations).toHaveLength(2); // cancelled, then failed-and-retried; no further prompt
      expect(page.__dialogs).toEqual([]); // no native dialog at any point
      expect(await page.evaluate(() => localStorage.getItem('atokoreTrialV4'))).toBe(production);
      expect(await page.evaluate(k => JSON.parse(localStorage.getItem(k)), HISTORY)).toEqual([]);
      await shot(page, info, `${width}-routine-confirmed`);
      await page.reload();
      expect(await stored(page)).toEqual(saved);
    });

    test('add-catalog selection confirms new milk and food, survives failure and leaves stock unchanged', async ({ page }, info) => {
      const initial = baseState({ routines: [{ id: 901, name: 'いつものやつ', items: [] }] });
      await open(page, { [KEY]: initial });
      await go(page, 'buy');
      await page.click('[data-bf-routine="901"]');
      await page.click('#atkRoutineCatalogOpen');
      await expect(page.locator('#pg-add')).toHaveClass(/on/);
      await expect(page.locator('#qaRoutinePicker')).toBeVisible();
      await expect(page.locator('#modal')).not.toHaveClass(/on/);
      await chooseBaby(page, { kind: 'milk', brand: '明治', type: '缶', series: 'ほほえみ' });
      const milkIcon = page.locator('#qaBaby img[src$="milk-bear-v26.webp"]').first();
      await expect(milkIcon).toBeVisible();
      await expect.poll(() => milkIcon.evaluate(i => i.naturalWidth)).toBe(256);
      await page.click('[data-qa-cat="食料品"]');
      await page.click('[data-qa-pick="バナナ"]');
      await expect(page.locator('#qaTrayDest')).toContainText('いつものリスト');
      expect(await stored(page)).toEqual(initial);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await shot(page, info, `${width}-routine-catalog`);
      page.removeAllListeners('dialog');
      const confirmations = [];
      page.on('dialog', async dialog => { confirmations.push(dialog.message()); await dialog.accept(); });
      // v36: the review screen is the confirmation; opening it and going back saves nothing.
      await page.click('#qaBar');
      await expect(page.locator('#qaTrayList .qa-tray-item')).toHaveCount(2);
      await expect(page.locator('#qaTrayList')).toContainText('明治 ほほえみ');
      await expect(page.locator('#qaTrayList')).toContainText('バナナ');
      await expect(page.locator('#qaTrayList')).toContainText('在庫数は変わりません');
      await expect(page.locator('#qaTrayDest')).toContainText('いつものリスト');
      await expect(page.locator('#qaCommit')).toHaveText('選んだ商品をいつものリストに追加');
      await expect(page.locator('#qaTray .qa-review-dest-switch')).toBeHidden();
      await page.click('[data-qa-review-back]');
      expect(await stored(page)).toEqual(initial);
      expect(await memory(page)).toEqual(initial);
      await failWrites(page);
      await commitBatch(page);
      expect(await stored(page)).toEqual(initial);
      expect(await memory(page)).toEqual(initial);
      await expect(page.locator('#qaNotice')).toContainText('保存できませんでした');
      await expect(page.locator('#qaTrayList .qa-tray-item')).toHaveCount(2);
      await page.evaluate(() => window.__restoreRoutineStorage());
      await commitBatch(page);
      const saved = await stored(page);
      expect(saved.items).toEqual(initial.items);
      expect(saved.buys).toEqual(initial.buys);
      expect(saved.routines[0].items).toHaveLength(2);
      expect(saved.routines[0].items[0]).toMatchObject({ name: '明治 ほほえみ 粉ミルク 缶', qty: 1, unit: '缶' });
      expect(saved.routines[0].items[1].name).toBe('バナナ');
      expect(confirmations).toEqual([]);
      await expect(page.locator('#pg-buy')).toHaveClass(/on/);
      await expect(page.locator('#modal')).toHaveClass(/on/);
      await shot(page, info, `${width}-routine-picker`);
      await page.reload();
      expect(await stored(page)).toEqual(saved);
    });
  });
}

test('shopping a diaper M then editing stock to L keeps both sizes separate after purchase', async ({ page }) => {
  const initial = baseState({ buys: [] });
  await open(page, { [KEY]: initial });
  await go(page, 'stock');
  await page.locator('#stockList [data-stock-id="2"] .name').click();
  await page.click('.atk-detail-cart');
  await page.locator('#stockList [data-stock-id="2"] .name').click();
  await page.click('.atk-edit-open');
  const sizeL = initial.items[1].name.replace(/ M$/, ' L');
  await page.fill('#atkEditForm input[name="name"]', sizeL);
  await page.click('.atk-edit-save');
  await page.locator('#stockList [data-stock-id="2"] .name').click();
  await page.click('.atk-detail-cart');
  expect((await stored(page)).buys.map(x => x.name)).toEqual([initial.items[1].name, sizeL]);
  const sizeMBuyId = (await stored(page)).buys.find(x => x.name === initial.items[1].name).id;
  await go(page, 'buy');
  await page.locator(`#buyList [data-buy-id="${sizeMBuyId}"]`).getByRole('button', { name: /を買った$/ }).click();
  const saved = await stored(page);
  expect(saved.items.find(x => x.id === 2)).toMatchObject({ name: sizeL, qty: 2 });
  expect(saved.items.find(x => x.name === initial.items[1].name)).toMatchObject({ qty: 1, unit: '袋', cat: 'ベビー' });
  expect(saved.buys.map(x => x.name)).toEqual([sizeL]);
  expect(saved.routines).toEqual(initial.routines);
  await page.reload();
  expect(await stored(page)).toEqual(saved);
});

test('leaving a routine catalog can cancel or discard, then normal add saves only stock', async ({page}) => {
 const initial=baseState();await open(page,{[KEY]:initial});await go(page,'buy');
 await page.click('[data-bf-routine="901"]');await page.click('#atkRoutineCatalogOpen');
 await page.click('[data-qa-cat="食料品"]');await page.click('[data-qa-pick="バナナ"]');
 await go(page,'home');expect(await appConfirm(page,false)).toContain('破棄して戻りますか');await expect(page.locator('#pg-add')).toHaveClass(/on/);
 expect(await stored(page)).toEqual(initial);
 await go(page,'home');await appConfirm(page,true);await expect(page.locator('#pg-home')).toHaveClass(/on/);
 await page.click('#bfNavAdd');await expect(page.locator('#qaRoutinePicker')).toBeHidden();
 await page.click('[data-qa-cat="食料品"]');await page.click('[data-qa-pick="バナナ"]');
 await commitBatch(page);const saved=await stored(page);
 expect(saved.routines).toEqual(initial.routines);expect(saved.buys).toEqual(initial.buys);
 expect(saved.items).toHaveLength(initial.items.length+1);
});
