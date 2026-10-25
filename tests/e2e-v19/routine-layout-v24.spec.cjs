const { test, expect } = require('@playwright/test');
const { open, go, stored, baseState, KEY, shot, appConfirm } = require('./helpers.cjs');

const fixture = () => baseState({ routines: [{ id: 901, name: 'いつものベビー用品', items: [
  { id: 1, name: 'パンパース さらさらケア おむつ テープ M', qty: 2, unit: '袋' },
  { id: 2, name: 'ムーニー やわらか素材 おしりふき 詰替', qty: 1, unit: 'パック' },
] }] });

for (const [width, height] of [[320, 568], [375, 667], [390, 844], [430, 932]]) {
  test.describe(`v24 list ${width}px`, () => {
    test.use({ viewport: { width, height } });
    test('bear icons load, destination buttons are side by side and manual food entry still works', async ({ page }, info) => {
      const initial = fixture();
      initial.items[1].qty=1; // Only attention-worthy stock is featured on the v43 home.
      await open(page, { [KEY]: initial });
      await expect(page.locator('#atkTasks [data-atk-open="2"] img[src$="diaper-bear-v24.webp"]')).toBeVisible();
      await go(page, 'buy');
      await page.click('[data-bf-routine="901"]');
      await expect(page.locator('#routineAddName')).not.toBeVisible();
      await expect(page.locator('#atkRoutineCatalogOpen')).toHaveText('商品を選ぶ');
      for (const kind of ['diaper', 'wipes']) {
        const image = page.locator(`#routineItems img[src$="${kind}-bear-v24.webp"]`);
        await expect(image).toBeVisible();
        await expect.poll(() => image.evaluate(i => i.complete && i.naturalWidth > 0)).toBe(true);
      }
      const geometry = await page.evaluate(() => {
        const ids = ['atkRoutineStockCommit', 'atkRoutineBuyCommit'];
        const boxes = ids.map(id => {
          const el = document.getElementById(id), r = el.getBoundingClientRect();
          const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
          return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, clickable: hit === el || el.contains(hit) };
        });
        return { boxes, vw: innerWidth, vh: innerHeight, overflow: document.getElementById('sheet').scrollWidth - document.getElementById('sheet').clientWidth };
      });
      const [stock, buy] = geometry.boxes;
      expect(stock.top).toBe(buy.top);
      expect(stock.right).toBeLessThan(buy.left);
      expect(Math.abs(stock.width - buy.width)).toBeLessThan(1);
      expect(stock.left).toBeGreaterThanOrEqual(0);
      expect(buy.right).toBeLessThanOrEqual(geometry.vw);
      expect(buy.bottom).toBeLessThanOrEqual(geometry.vh);
      expect(stock.clickable && buy.clickable).toBe(true);
      expect(geometry.overflow).toBeLessThanOrEqual(0);
      expect(await stored(page)).toEqual(initial);
      await shot(page, info, `${width}-routine-v24`);

      await page.locator('.atk-routine-manual summary').click();
      await page.fill('#routineAddName', '麦茶');
      await page.locator('.routineInline button').click();
      const saved = await stored(page);
      expect(saved.routines[0].items.some(x => x.name === '麦茶')).toBe(true);
      expect(saved.items).toEqual(initial.items);
      expect(saved.buys).toEqual(initial.buys);
      await expect(page.locator('#routineAddName')).not.toBeVisible();
    });

    test('shopping destination confirms, cancels, recovers from save failure and suppresses repeat taps', async ({ page }) => {
      const initial = fixture();
      await open(page, { [KEY]: initial });
      await go(page, 'buy');
      await page.click('[data-bf-routine="901"]');
      const asked = [];
      await page.click('#atkRoutineBuyCommit');
      asked.push(await appConfirm(page, false));
      expect(await stored(page)).toEqual(initial);
      expect(asked[0]).toContain('買い物リストに追加してもいいですか');
      expect(asked[0]).toContain('2袋');
      expect(asked[0]).toContain('1パック');
      await page.evaluate(key => {
        const set = Storage.prototype.setItem;
        window.__v24Restore = () => { Storage.prototype.setItem = set; };
        Storage.prototype.setItem = function(k,v) { if(k === key) throw new DOMException('quota','QuotaExceededError'); return set.call(this,k,v); };
      }, KEY);
      await page.click('#atkRoutineBuyCommit');
      asked.push(await appConfirm(page, true));
      await expect(page.locator('#atkConfirm')).toContainText('保存できませんでした');
      expect(await stored(page)).toEqual(initial);
      await expect(page.locator('#modal')).toHaveClass(/on/);
      await page.evaluate(() => window.__v24Restore());
      await page.locator('#atkConfirm .atk-confirm-primary').click(); // retry from the same confirmation
      await expect(page.locator('#atkConfirm')).toHaveCount(0);
      const saved = await stored(page);
      expect(saved.items).toEqual(initial.items);
      expect(saved.routines).toEqual(initial.routines);
      expect(saved.buys.find(x => x.name === initial.routines[0].items[0].name).qty).toBe(2);
      expect(saved.buys.find(x => x.name === initial.routines[0].items[1].name).qty).toBe(1);
      expect(saved.buys.find(x => x.id === 10)).toEqual(initial.buys[0]);
      await expect(page.locator('#stableToastV125h')).toContainText('買い物リストに追加しました');
      await page.evaluate(() => AtokoreBabyFlow.addRoutineToBuy(901));
      await expect(page.locator('#atkConfirm')).toHaveCount(0); // an immediate repeat does not ask again
      expect(await stored(page)).toEqual(saved);
      expect(asked).toHaveLength(2);
      expect(page.__dialogs).toEqual([]);
      await page.reload();
      expect(await stored(page)).toEqual(saved);
    });
  });
}
