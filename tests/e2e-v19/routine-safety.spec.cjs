const { test, expect } = require('@playwright/test');
const { open, go, stored, baseState, KEY, HISTORY, shot } = require('./helpers.cjs');
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

      page.removeAllListeners('dialog');
      const confirmations = [];
      let approve = false;
      page.on('dialog', async dialog => {
        if (dialog.type() === 'confirm') {
          confirmations.push(dialog.message());
          approve ? await dialog.accept() : await dialog.dismiss();
        } else await dialog.dismiss();
      });
      await page.click('#atkRoutineStockCommit');
      expect(await raw(page)).toBe(before);
      expect(await memory(page)).toEqual(initial);
      await expect(page.locator('#modal')).toHaveClass(/on/);
      expect(confirmations[0]).toContain('パンパース さらさらケア おむつ テープ M × 2袋');
      expect(confirmations[0]).toContain('牛乳 × 1本');

      approve = true;
      await failWrites(page);
      await page.click('#atkRoutineStockCommit');
      expect(await raw(page)).toBe(before);
      expect(await memory(page)).toEqual(initial);
      await expect(page.locator('#modal')).toHaveClass(/on/);
      await page.evaluate(() => window.__restoreRoutineStorage());
      await page.click('#atkRoutineStockCommit');
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
      expect(await stored(page)).toEqual(saved);
      expect(confirmations).toHaveLength(3); // cancelled, failed, successful; no fourth prompt
      expect(await page.evaluate(() => localStorage.getItem('atokoreTrialV4'))).toBe(production);
      expect(await page.evaluate(k => JSON.parse(localStorage.getItem(k)), HISTORY)).toEqual([]);
      await shot(page, info, `${width}-routine-confirmed`);
      await page.reload();
      expect(await stored(page)).toEqual(saved);
    });

    test('stock-to-routine selection cancels safely, survives save failure and never changes inventory', async ({ page }, info) => {
      const initial = baseState({ routines: [{ id: 901, name: 'いつものやつ', items: [] }] });
      await open(page, { [KEY]: initial });
      await go(page, 'buy');
      await page.click('[data-bf-routine="901"]');
      await page.click('#atkRoutineCatalogOpen');
      await expect(page.locator('#atkRoutineStockPicker')).toBeVisible();
      page.removeAllListeners('dialog');
      let approve = false;
      let confirmations = 0;
      page.on('dialog', async dialog => {
        confirmations++;
        approve ? await dialog.accept() : await dialog.dismiss();
      });
      const product = page.locator('#stockList [data-stock-id="2"] .name');
      await product.click();
      expect(await stored(page)).toEqual(initial);
      expect(await memory(page)).toEqual(initial);
      approve = true;
      await failWrites(page);
      await product.click();
      expect(await stored(page)).toEqual(initial);
      await expect(page.locator('#atkRoutineStockNotice')).toContainText('保存できませんでした');
      await expect(page.locator('#atkRoutineStockPicker')).toBeVisible();
      await page.evaluate(() => window.__restoreRoutineStorage());
      await product.click();
      await product.click();
      const saved = await stored(page);
      expect(saved.items).toEqual(initial.items);
      expect(saved.buys).toEqual(initial.buys);
      expect(saved.routines[0].items).toHaveLength(1);
      expect(saved.routines[0].items[0]).toMatchObject({ name: initial.items[1].name, qty: 1, unit: '袋' });
      expect(confirmations).toBe(3);
      await page.click('#atkRoutineStockDone');
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
  await page.locator('#stockList [data-stock-id="2"] [aria-label="買い物リストへ追加"]').click();
  await page.locator('#stockList [data-stock-id="2"] .name').click();
  await page.click('.atk-edit-open');
  const sizeL = initial.items[1].name.replace(/ M$/, ' L');
  await page.fill('#atkEditForm input[name="name"]', sizeL);
  await page.click('.atk-edit-save');
  await page.locator('#stockList [data-stock-id="2"] [aria-label="買い物リストへ追加"]').click();
  expect((await stored(page)).buys.map(x => x.name)).toEqual([initial.items[1].name, sizeL]);
  await go(page, 'buy');
  await page.locator('#buyList [data-buy-id]').filter({ hasText: initial.items[1].name }).getByRole('button', { name: '在庫へ反映', exact: true }).click();
  const saved = await stored(page);
  expect(saved.items.find(x => x.id === 2)).toMatchObject({ name: sizeL, qty: 2 });
  expect(saved.items.find(x => x.name === initial.items[1].name)).toMatchObject({ qty: 1, unit: '袋', cat: 'ベビー' });
  expect(saved.buys.map(x => x.name)).toEqual([sizeL]);
  expect(saved.routines).toEqual(initial.routines);
  await page.reload();
  expect(await stored(page)).toEqual(saved);
});
