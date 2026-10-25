// W2 items 5 and 9 in the browser: forgiving stock search, filters always visible and clearable,
// no-results guidance (filters -> もしかして -> add with the typed words), free entry at the top of 追加.
const { test, expect } = require('@playwright/test');
const { open, go, stored, baseState, KEY, shot } = require('./helpers.cjs');

const state = () => baseState({ items: [
  { id: 1, name: '牛乳', cat: '食料品', qty: 1, unit: '本', place: '冷蔵庫', expType: '消費期限', exp: '2099-01-01', usage: 1 },
  { id: 2, name: 'パンパース さらさらケア おむつ テープ M', cat: 'ベビー', qty: 2, unit: '袋', place: '収納', expType: '期限なし', exp: '', usage: 1 },
  { id: 3, name: 'パンパース さらさらケア おむつ テープ L', cat: 'ベビー', qty: 1, unit: '袋', place: '収納', expType: '期限なし', exp: '', usage: 1 },
  { id: 4, name: 'キユーピー ベビーフード 7ヶ月', cat: '食料品', qty: 3, unit: '個', usage: 1 },
  { id: 5, name: 'ＢＯＸティッシュ 5箱', cat: '日用品', qty: 1, unit: 'パック', usage: 1 },
] });
const shown = page => page.locator('#stockList [data-stock-id]').evaluateAll(rows => rows.map(r => Number(r.dataset.stockId)).sort((a, b) => a - b));
async function search(page, text) { await page.fill('#stockSearch', text); }
test.use({ viewport: { width: 390, height: 844 } });

test('kana, width, case and spaces find the same products; several words must all match; sizes stay apart', async ({ page }) => {
  await open(page, { [KEY]: state() });
  await go(page, 'stock');
  await search(page, 'ぱんぱーす てーぷ m'); await expect.poll(() => shown(page)).toEqual([2]);
  await search(page, 'ﾊﾟﾝﾊﾟｰｽ'); await expect.poll(() => shown(page)).toEqual([2, 3]);
  await search(page, '　パンパース　　Ｌ '); await expect.poll(() => shown(page)).toEqual([3]);
  await search(page, 'box てぃっしゅ'); await expect.poll(() => shown(page)).toEqual([5]);
  await search(page, 'キューピー'); await expect.poll(() => shown(page)).toEqual([4]);
  await search(page, 'パンパース 牛乳'); await expect.poll(() => shown(page)).toEqual([]);
  // The shown names are unchanged.
  await search(page, 'ぱんぱーす');
  await expect(page.locator('#stockList [data-stock-id="2"]')).toContainText('さらさらケア');
  expect(page.__errors).toEqual([]);
});

test('filters are always shown, can be cleared one by one or all; no results keep them and explain', async ({ page }, info) => {
  await open(page, { [KEY]: state() });
  await go(page, 'stock');
  await page.evaluate(() => setFilter('ベビー'));
  await page.locator('[data-bf-stock-kind="diaper"]').click();
  await search(page, '牛乳');
  const bar = page.locator('#atkStockConditions');
  await expect(bar).toContainText('カテゴリー：ベビー');
  await expect(bar).toContainText('種類：');
  await expect(bar).toContainText('検索：「牛乳」');
  await expect(bar.getByRole('button', { name: 'すべて解除' })).toBeVisible();
  // No results: the filters stay, the reason is shown, and clearing filters keeps the search.
  const empty = page.locator('.atk-empty-guide');
  await expect(empty).toContainText('「牛乳」に一致する商品はありません');
  await expect(empty).toContainText('カテゴリー：ベビー');
  await shot(page, info, 'w2-search-no-results');
  await expect(bar).toContainText('カテゴリー：ベビー'); // nothing cleared silently
  await empty.getByRole('button', { name: /絞り込みを解除して探す（1件）/ }).click();
  await expect.poll(() => shown(page)).toEqual([1]);
  await expect(bar).not.toContainText('カテゴリー');
  await expect(bar).toContainText('検索：「牛乳」');
  // Clear one condition.
  await bar.locator('[data-atk-clear="search"]').click();
  await expect(page.locator('#stockSearch')).toHaveValue('');
  await expect(page.locator('#atkStockConditions')).toHaveCount(0);
  await expect.poll(() => shown(page)).toEqual([1, 2, 3, 4, 5]);
  // Clear all.
  await page.evaluate(() => setFilter('ベビー')); await search(page, 'パンパース');
  await page.locator('#atkStockConditions').getByRole('button', { name: 'すべて解除' }).click();
  await expect(page.locator('#atkStockConditions')).toHaveCount(0);
  await expect(page.locator('#stockSearch')).toHaveValue('');
  expect(page.__errors).toEqual([]);
});

test('もしかして: up to three suggestions; the typed words stay until a suggestion is tapped', async ({ page }) => {
  await open(page, { [KEY]: state() });
  await go(page, 'stock');
  await search(page, 'ぱんぱす');
  const guide = page.locator('.atk-empty-guide');
  await expect(guide).toContainText('「ぱんぱす」に一致する商品はありません');
  const maybe = guide.locator('[data-atk-maybe]');
  await expect(maybe.first()).toHaveText('パンパース');
  expect(await maybe.count()).toBeLessThanOrEqual(3);
  await expect(page.locator('#stockSearch')).toHaveValue('ぱんぱす');
  await maybe.first().click();
  await expect(page.locator('#stockSearch')).toHaveValue('パンパース');
  await expect.poll(() => shown(page)).toEqual([2, 3]);
});

test('no match: the typed words go to the add screen; nothing is saved until the final button', async ({ page }) => {
  const initial = state();
  await open(page, { [KEY]: initial });
  await go(page, 'stock');
  await search(page, 'ベビー綿棒');
  await page.locator('.atk-empty-guide').getByRole('button', { name: '「ベビー綿棒」をストックに追加する' }).click();
  await expect(page.locator('#pg-add')).toHaveClass(/on/);
  await expect(page.locator('#qaFree')).toHaveValue('ベビー綿棒');
  await expect(page.locator('#qaFreeDest')).toHaveText('保存先：ストックに追加');
  expect(await stored(page)).toEqual(initial);
  await page.click('[data-qa-free]');
  expect(await stored(page)).toEqual(initial); // only pending
  await page.click('#qaBar'); await page.click('#qaCommit');
  await expect.poll(async () => (await stored(page)).items.some(x => x.name === 'ベビー綿棒')).toBe(true);
});

test('add screen: free entry always at the top with the destination; catalog no-results offer the same steps', async ({ page }) => {
  await open(page, { [KEY]: state() });
  await page.click('#bfNavAdd');
  const top = page.locator('#qaFreeTop');
  await expect(top).toBeVisible();
  await expect(top.locator('h3')).toHaveText('商品名を入力して追加');
  await expect(page.locator('#qaFreeDest')).toHaveText('保存先：ストックに追加');
  await page.click('[data-qa-dest="buy"]');
  await expect(page.locator('#qaFreeDest')).toHaveText('保存先：買い物リストに追加');
  const topBox = await top.boundingBox(), tilesBox = await page.locator('#qaTabs').boundingBox();
  expect(topBox.y).toBeLessThan(tilesBox.y);
  // Catalog search without results.
  await page.click('[data-qa-cat="日用品"]'); // catalog categories show the search (ベビー has its own picker)
  await page.fill('#qaSearch', 'しゃんぷー はっと');
  const none = page.locator('.qa-no-results');
  await expect(none).toContainText('「しゃんぷー はっと」に一致する商品はありません');
  await none.getByRole('button', { name: '「しゃんぷー はっと」を追加する' }).click();
  await expect(page.locator('#qaFree')).toHaveValue('しゃんぷー はっと');
  // Typo -> suggestion from the catalog / registered names.
  await page.fill('#qaSearch', 'てぃしゅ');
  await expect(page.locator('.qa-maybe button').first()).toBeVisible();
  await expect(page.locator('#qaSearch')).toHaveValue('てぃしゅ'); // not changed until a suggestion is tapped
  const first = await page.locator('.qa-maybe button').first().textContent();
  await page.locator('.qa-maybe button').first().click();
  await expect(page.locator('#qaSearch')).toHaveValue(first);
  await expect(page.locator('#qaTiles .qa-tile').first()).toBeVisible();
  // A suggestion found only in another category offers that category instead of switching silently.
  await page.fill('#qaSearch', 'ぱんぱす');
  await page.locator('.qa-maybe button', { hasText: 'パンパース' }).click();
  await expect(page.locator('#qaSearch')).toHaveValue('パンパース');
  await expect(page.locator('#qaTabs .selected')).toHaveText('日用品');
  expect(page.__errors).toEqual([]);
});
