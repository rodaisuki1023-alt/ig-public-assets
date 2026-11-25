// v51 backward compatibility: v50 data (no level/estimate, a saved v50 checklist, no prep sets)
// opens with every v51 feature present, and nothing is rewritten until the person changes something.
const { test, expect } = require('@playwright/test');
const { open, go, stored, baseState, KEY } = require('./helpers.cjs');
const PACK = 'atokorePackingChecklistV1:/ig-public-assets/preview-baby-v19/';
const PREP = 'atokorePrepSetsV1:/ig-public-assets/preview-baby-v19/';

test('v50 stock and checklist open unchanged; old reorder rule still decides the alerts', async ({ page }) => {
  const initial = baseState({ items: [
    { id: 1, name: '牛乳', cat: '食料品', qty: 1, unit: '本' },
    { id: 2, name: 'パンパース おむつ テープ M', cat: 'ベビー', qty: 3, unit: '袋', minQty: 3 },
    { id: 3, name: '卵', cat: '食料品', qty: 6, unit: '個' },
  ] });
  const pack = JSON.stringify({ version: 1, active: 'outing', lists: {
    daycare: [{ id: 'daycare-0', name: '連絡帳', done: true }],
    outing: [{ id: 'outing-0', name: 'おむつ', done: false }, { id: 'custom-x', name: '日焼け止め', done: true }] } });
  await page.addInitScript(([k, v]) => { if (!sessionStorage.getItem('pack')) { sessionStorage.setItem('pack', '1'); localStorage.setItem(k, v); } }, [PACK, pack]);
  await open(page, { [KEY]: initial });
  // Alerts: milk (1 <= default 1) and diapers (3 <= own line 3); eggs fine. Same as v50.
  expect((await page.locator('#atkTasks [data-atk-open]').evaluateAll(n => n.map(x => Number(x.dataset.atkOpen)))).sort()).toEqual([1, 2]);
  await go(page, 'buy');
  await expect(page.locator('#atkPackRows')).toContainText('日焼け止め');
  await expect(page.locator('#atkPrepSets')).toBeVisible();
  await page.evaluate(() => window.atkShowDetail(3));
  await expect(page.locator('#sheet .atk-level-now')).toHaveText('今：余裕あり（在庫数から）');
  // Nothing was written: stock, the v50 checklist bytes, and no prep record yet.
  expect(await stored(page)).toEqual(initial);
  expect(await page.evaluate(k => localStorage.getItem(k), PACK)).toBe(pack);
  expect(await page.evaluate(k => localStorage.getItem(k), PREP)).toBeNull();
  expect(page.__errors).toEqual([]);
});
