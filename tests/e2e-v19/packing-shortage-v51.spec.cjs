// v51 出かける前の確認: a folded summary of unticked packing items against registered stock.
// Never changes stock, never adds a product twice, never guesses unknown or ambiguous stock.
const { test, expect } = require('@playwright/test');
const { open, go, stored, baseState, KEY } = require('./helpers.cjs');

const state = () => baseState({ items: [
  { id: 1, name: 'おしりふき', cat: 'ベビー', qty: 0, unit: 'パック' },          // counted zero: can be added
  { id: 2, name: 'パンパース おむつ テープ M', cat: 'ベビー', qty: 2, unit: '袋' },      // two diaper kinds: choose
  { id: 3, name: 'パンパース おむつ テープ L', cat: 'ベビー', qty: 0, unit: '袋' },
  { id: 4, name: 'タオル', cat: '日用品', qty: 3, unit: '枚' },                   // enough: not listed
], buys: [], routines: [] });

test('summary lists zero, ambiguous and unregistered items; one tap adds only the zero once', async ({ page }) => {
  const initial = state();
  await open(page, { [KEY]: initial });
  await go(page, 'buy');
  const box = page.locator('#atkPackShort');
  await expect(box).toBeVisible();
  await expect(box.locator('.atk-pack-short-count')).toHaveText('要確認 5件');
  await box.locator('summary').click();
  await expect(box.locator('li.zero')).toHaveText('在庫0：おしりふき');
  await expect(box.locator('li.choose')).toHaveText('サイズ・種類を選んでください：おむつ');
  await expect(box.locator('li.unknown')).toHaveText('在庫を確認してください：連絡帳、着替え、水筒');
  expect(await stored(page)).toEqual(initial); // looking changes nothing

  await box.locator('[data-pack-short-add]').click();
  await expect(box.locator('.atk-pack-short-msg')).toHaveText('1件を買い物リストに追加しました。');
  let s = await stored(page);
  expect(s.buys.map(b => [b.name, b.qty, b.stockId])).toEqual([['おしりふき', 1, 1]]);
  expect(s.items).toEqual(initial.items); // stock untouched
  await expect(box.locator('li.queued')).toHaveText('買い物リストにあります：おしりふき');
  await expect(box.locator('[data-pack-short-add]')).toHaveCount(0);

  // A ticked item is packed: it leaves the summary, and ticking never consumes stock.
  await page.locator('#atkPackRows input[aria-label="連絡帳を準備済みにする"]').check();
  await expect(box.locator('li.unknown')).toHaveText('在庫を確認してください：着替え、水筒');
  s = await stored(page);
  expect(s.items).toEqual(initial.items);
  expect(page.__errors).toEqual([]);
});

test('a failed shopping save is reported and nothing is left half-added', async ({ page }) => {
  const initial = state();
  await open(page, { [KEY]: initial });
  await go(page, 'buy');
  await page.locator('#atkPackShort summary').click();
  await page.evaluate(() => { const real = Storage.prototype.setItem; window.__restore = () => { Storage.prototype.setItem = real }; Storage.prototype.setItem = function (k, v) { if (/TrialV/.test(k)) throw new DOMException('quota', 'QuotaExceededError'); return real.call(this, k, v); }; });
  await page.locator('[data-pack-short-add]').click();
  await expect(page.locator('#atkPackShort .atk-pack-short-msg')).toContainText('保存できなかった商品があります（1件）');
  await page.evaluate(() => window.__restore());
  expect(await page.evaluate(() => buys.length)).toBe(0);
  expect((await stored(page)).buys).toEqual([]);
});

for (const width of [320, 393, 430]) test(`summary fits at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 800 });
  await open(page, { [KEY]: state() });
  await go(page, 'buy');
  await page.locator('#atkPackShort summary').click();
  const f = await page.evaluate(() => { const b = document.getElementById('atkPackShort'), r = b.getBoundingClientRect();
    const t = [...b.querySelectorAll('summary,button')].map(e => e.getBoundingClientRect().height);
    return { right: r.right, min: Math.min(...t), scroll: document.documentElement.scrollWidth - innerWidth }; });
  expect(f.right).toBeLessThanOrEqual(width); expect(f.min).toBeGreaterThanOrEqual(44); expect(f.scroll).toBeLessThanOrEqual(0);
});
