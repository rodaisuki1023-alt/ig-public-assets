// v51 Muse/Work findings, in the real app: list 3-level marks with direct change, home reasons by
// source, size/brand candidates, 0-quantity registration, unit suggestion, settings edit with
// per-child use, build information. Counts (qty) never change through a level or an estimate.
const { test, expect } = require('@playwright/test');
const { open, go, stored, baseState, KEY } = require('./helpers.cjs');

const localDay = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const level = page => page.locator('#sheet .atk-level');
async function detail(page, id) { await page.evaluate(i => window.atkShowDetail(i), id); await expect(level(page)).toBeVisible(); }

test('list mode: every product shows its level and source; one tap sets it, the same tap clears it', async ({ page }) => {
  const initial = baseState();
  await open(page, { [KEY]: initial });
  await go(page, 'stock');
  await page.locator('[data-atk-view="list"]').click();
  const egg = page.locator('#stockList [data-stock-id="3"] .atk-lv');
  await expect(egg.locator('.atk-lv-src')).toHaveText('在庫数');
  await expect(egg.locator('[data-atk-lv-set]')).toHaveText(['余裕あり', 'そろそろ', '買う']);
  await egg.locator('[data-atk-lv-set="buy"]').click();
  let s = await stored(page);
  expect(s.items.find(x => x.id === 3)).toMatchObject({ level: 'buy', qty: 6 });
  await expect(page.locator('#stockList [data-stock-id="3"] .atk-lv .atk-lv-src')).toHaveText('自分');
  await expect(page.locator('#stockList [data-stock-id="3"] [data-atk-lv-set="buy"]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#stockList [data-stock-id="3"] [data-atk-lv-set="buy"]').click();
  s = await stored(page);
  expect('level' in s.items.find(x => x.id === 3)).toBe(false);
  expect(s.items.map(x => x.qty)).toEqual(initial.items.map(x => x.qty));
  // Tapping a level never opens the product sheet.
  await expect(page.locator('#sheet .atk-level')).toHaveCount(0);
  expect(page.__errors).toEqual([]);
});

test('card mode: a small label on the picture shows the level and its source; the card does not grow', async ({ page }) => {
  const s = baseState();
  s.items[0] = { ...s.items[0], level: 'low', levelAt: new Date().toISOString() };
  await open(page, { [KEY]: s });
  await go(page, 'stock');
  await page.locator('[data-atk-view="cards"]').click();
  const tag = page.locator('#stockList [data-stock-id="1"] .atk-lv-tag');
  await expect(tag).toHaveText('そろそろ');
  await expect(tag).toHaveAttribute('aria-label', '牛乳の残りの目安：そろそろ（自分）');
  await expect(page.locator('#stockList [data-stock-id="3"] .atk-lv-tag')).toHaveAttribute('aria-label', /（在庫数）$/);
  // Inside the picture: no extra line under the card.
  const inside = await page.locator('#stockList [data-stock-id="1"]').evaluate(c => { const t = c.querySelector('.atk-lv-tag').getBoundingClientRect(), a = c.querySelector('.atk-row-brand').getBoundingClientRect(); return t.top >= a.top && t.bottom <= a.bottom; });
  expect(inside).toBe(true);
  expect(page.__errors).toEqual([]);
});

const reasonItems = () => [
  { id: 1, name: '牛乳', cat: '食料品', qty: 5, unit: '本', level: 'buy', levelAt: new Date().toISOString() },
  { id: 2, name: 'パンパース テープ M', cat: 'ベビー', qty: 3, unit: '袋', track: { v: 1, base: 12, since: localDay(), perDay: 6, perPack: 60, refillDays: 5, pieceUnit: '枚', confirmedAt: localDay() } },
  { id: 3, name: '卵', cat: '食料品', qty: 0, unit: '個' },
  { id: 4, name: 'おしりふき', cat: 'ベビー', qty: 0, unit: 'パック', level: 'plenty', levelAt: new Date().toISOString() },
  { id: 5, name: 'ティッシュ', cat: '日用品', qty: 4, unit: '箱', level: 'plenty', levelAt: new Date(Date.now() - 40 * 86400000).toISOString() },
];
const REASONS = { 1: ['自分で「買う」に設定'], 2: ['見積もり：あと', '実際の在庫数とは別'], 3: ['補充目安以下：在庫なし'], 4: ['在庫数と合っていません'], 5: ['前回から日数がたっています'] };
// Home shows two products at a time (space-saving), so the reasons are checked two by two.
for (const ids of [[1, 2], [3, 4], [5]]) test(`home reasons say what decided them (${ids.join(',')}); old or contradicted levels ask`, async ({ page }) => {
  await open(page, { [KEY]: baseState({ items: reasonItems().filter(x => ids.includes(x.id)), buys: [] }) });
  await go(page, 'home');
  await page.locator('#atkHomeAttentionDetails summary').click();
  for (const id of ids) for (const text of REASONS[id]) await expect(page.locator(`#atkTasks [data-atk-open="${id}"]`)).toContainText(text);
  if (ids.includes(5)) {
    await go(page, 'stock');
    await page.locator('[data-atk-view="list"]').click();
    await expect(page.locator('#stockList [data-stock-id="5"] .atk-lv-src')).toHaveText('要確認');
  }
  expect(page.__errors).toEqual([]);
});

test('several sizes: the candidates show name, size and stock; only the counted-0 one can be added', async ({ page }) => {
  const s = baseState({ items: [
    { id: 1, name: 'パンパース おむつ テープ M', cat: 'ベビー', qty: 2, unit: '袋' },
    { id: 2, name: 'パンパース おむつ テープ L', cat: 'ベビー', qty: 0, unit: '袋' },
  ], buys: [], routines: [] });
  await open(page, { [KEY]: s });
  await go(page, 'buy');
  const box = page.locator('#atkPackShort');
  await box.locator('summary').click();
  const cands = box.locator('.atk-pack-cands li');
  await expect(cands).toHaveCount(2);
  await expect(cands.nth(0)).toContainText('パンパース おむつ テープ M');
  await expect(cands.nth(0)).toContainText('在庫 2袋');
  await expect(cands.nth(0)).toContainText('在庫あり');
  await expect(cands.nth(0).locator('[data-pack-cand-add]')).toHaveCount(0);
  await cands.nth(1).locator('[data-pack-cand-add]').click();
  await expect(box.locator('.atk-pack-short-msg')).toContainText('パンパース おむつ テープ Lを買い物リストに追加しました');
  const after = await stored(page);
  expect(after.buys.map(b => [b.name, b.stockId])).toEqual([['パンパース おむつ テープ L', 2]]);
  expect(after.items).toEqual(s.items);
  // Once one size is on the shopping list, the line says so and nothing else is asked.
  await expect(box.locator('li.queued')).toHaveText('買い物リストにあります：おむつ');
  expect(page.__errors).toEqual([]);
});

test('a new product can be registered with 0; an existing product is never lowered by it', async ({ page }) => {
  await open(page, { [KEY]: baseState() });
  await page.click('#bfNavAdd');
  await page.click('[data-qa-cat="日用品"]');
  await page.fill('#qaFree', 'テスト用 ゼロ登録の洗剤');
  await page.click('[data-qa-free]');
  await page.click('#qaBar');
  const dec = page.getByRole('button', { name: 'テスト用 ゼロ登録の洗剤の数量を減らす' });
  await expect(dec).toBeEnabled();
  await dec.click();
  await expect(page.locator('#qaTrayList')).toContainText('在庫0の商品として登録');
  await expect(dec).toBeDisabled();
  await page.click('#qaCommit');
  const made = (await stored(page)).items.find(x => x.name === 'テスト用 ゼロ登録の洗剤');
  expect(made).toMatchObject({ qty: 0 });
  expect(page.__errors).toEqual([]);
});

test('units follow the product, even a brand name alone; the person can still change it', async ({ page }) => {
  await open(page, { [KEY]: baseState() });
  const got = await page.evaluate(() => ['パンパース', 'メリーズ', 'おむつ', 'ほほえみ', 'ほほえみ らくらくキューブ', '液体ミルク', 'おしりふき', '牛乳'].map(n => unitOf(n)));
  // 牛乳 keeps the existing rule (パック, as sold); only baby products are new here.
  expect(got).toEqual(['袋', '袋', '袋', '缶', '箱', '本', 'パック', 'パック']);
  expect(await page.locator('#addUnit option').allTextContents()).toContain('缶');
  expect(page.__errors).toEqual([]);
});

test('settings: pieces per bag and daily use can be changed later; several children are summed', async ({ page }) => {
  const s = baseState();
  await open(page, { [KEY]: s });
  await detail(page, 2);
  await level(page).locator('.atk-level-detail > summary').click();
  await level(page).locator('[data-atk-level-packs]').fill('2');
  await level(page).locator('[data-atk-level-per-pack]').fill('60');
  await level(page).locator('.atk-level-detail > [data-atk-rate] [data-atk-rate-mode][value="children"]').check();
  await level(page).locator('.atk-level-detail > [data-atk-rate] [data-atk-level-kid="0"]').fill('5');
  await level(page).locator('.atk-level-detail > [data-atk-rate] [data-atk-level-kid="1"]').fill('4');
  await expect(level(page).locator('.atk-level-detail > [data-atk-rate] [data-atk-rate-sum]')).toHaveText('計算に使う量：1日9枚（5＋4）');
  await level(page).locator('[data-atk-level-start]').click();
  let t = (await stored(page)).items.find(x => x.id === 2).track;
  expect(t).toMatchObject({ base: 120, perPack: 60, perDay: 9, perChild: [5, 4], rateMode: 'children' });
  await level(page).locator('.atk-level-edit > summary').click();
  await expect(level(page).locator('.atk-level-edit')).toContainText('子どもごと：5＋4');
  await level(page).locator('[data-atk-level-edit-pack]').fill('54');
  await level(page).locator('.atk-level-edit [data-atk-level-kid="1"]').fill('6');
  await level(page).locator('[data-atk-level-edit]').click();
  t = (await stored(page)).items.find(x => x.id === 2).track;
  expect(t).toMatchObject({ base: 120, perPack: 54, perDay: 11, perChild: [5, 6], rateMode: 'children' });
  expect((await stored(page)).items.find(x => x.id === 2).qty).toBe(2);
  expect(page.__errors).toEqual([]);
});

test('the お試し screen shows which build this is', async ({ page }) => {
  await open(page, { [KEY]: baseState() });
  await go(page, 'premium');
  // One label everywhere: version line, tab title and header badge (Muse P3-3).
  await expect(page.locator('#atkVersionInfo')).toHaveText(/^アプリ v51 ・ ビルド trial-v19-(local|[0-9a-f]{7})$/);
  await expect(page.locator('#atkBuildInfo')).toBeHidden();
  await expect(page).toHaveTitle(/^あとこれ v51（trial-v19-(local|[0-9a-f]{7})）$/);
  // The old header badge is no longer shown by the current header; if present it carries the same label.
  for (const t of await page.locator('h1 .badge').allTextContents()) expect(t).toBe('試用版 v51');
  expect(await page.locator('#pg-premium').innerText()).not.toMatch(/v48|機能更新/);
  expect(page.__errors).toEqual([]);
});

test('two daycares: each child can carry the name of their 園, shown in the list and today\'s rows', async ({ page }) => {
  await open(page, { [KEY]: baseState() });
  await go(page, 'buy');
  const box = page.locator('#atkPrepSets');
  await box.locator('summary').first().click();
  await box.locator('[data-prep-kid-name]').fill('上の子');
  await box.locator('[data-prep-kid-place]').fill('さくら保育園');
  await box.locator('[data-prep-add-child]').click();
  await box.locator('[data-prep-kid-name]').fill('下の子');
  await box.locator('[data-prep-kid-place]').fill('ひまわり園');
  await box.locator('[data-prep-add-child]').click();
  await expect(box.locator('.atk-prep-kid')).toHaveText([/上の子（さくら保育園）/, /下の子（ひまわり園）/]);
  await expect(box.locator('[data-prep-child] option')).toHaveText(['上の子（さくら保育園）', '下の子（ひまわり園）']);
  expect(page.__errors).toEqual([]);
});

test('a level changed by mistake can be put back from the same row; close buttons are 44px', async ({ page }) => {
  const s = baseState();
  s.items[2] = { ...s.items[2], level: 'low', levelAt: '2026-11-20T00:00:00.000Z' };
  await open(page, { [KEY]: s });
  await go(page, 'stock');
  await page.locator('[data-atk-view="list"]').click();
  const row = page.locator('#stockList [data-stock-id="3"]');
  await row.locator('[data-atk-lv-set="buy"]').click();
  expect((await stored(page)).items.find(x => x.id === 3).level).toBe('buy');
  await row.locator('[data-atk-lv-undo]').click();
  const back = (await stored(page)).items.find(x => x.id === 3);
  expect([back.level, back.levelAt]).toEqual(['low', '2026-11-20T00:00:00.000Z']);
  await expect(row.locator('[data-atk-lv-undo]')).toHaveCount(0);
  await expect(page.locator('#sheet .atk-level')).toHaveCount(0);           // never opened the sheet
  // Product without a level: the undo removes the new level again.
  const egg = page.locator('#stockList [data-stock-id="1"]');
  await egg.locator('[data-atk-lv-set="plenty"]').click();
  await egg.locator('[data-atk-lv-undo]').click();
  expect('level' in (await stored(page)).items.find(x => x.id === 1)).toBe(false);
  await page.evaluate(() => window.atkShowDetail(1));
  const close = await page.locator('#sheet .close').boundingBox();
  expect(close.height).toBeGreaterThanOrEqual(44);
  expect(close.width).toBeGreaterThanOrEqual(44);
  expect(page.__errors).toEqual([]);
});

test('compact 余裕あり prototype: off by default; when turned on in お試し, other levels keep one-tap buttons', async ({ page }) => {
  await open(page, { [KEY]: baseState() });
  await go(page, 'stock');
  await page.locator('[data-atk-view="list"]').click();
  const egg = page.locator('#stockList [data-stock-id="3"]');            // 6個: 余裕あり by count
  await expect(egg.locator('[data-atk-lv-set]')).toHaveCount(3);          // default: unchanged
  await go(page, 'premium');
  await page.locator('[data-atk-compact]').check();
  await go(page, 'stock');
  await expect(egg.locator('[data-atk-lv-set]')).toHaveCount(0);
  await egg.locator('[data-atk-lv-open]').click();                        // 2nd tap needed: the trade-off
  await egg.locator('[data-atk-lv-set="buy"]').click();
  expect((await stored(page)).items.find(x => x.id === 3).level).toBe('buy');
  await expect(egg.locator('[data-atk-lv-set]')).toHaveCount(3);          // not 余裕あり any more: full buttons
  await go(page, 'premium');
  await page.locator('[data-atk-compact]').uncheck();
  expect(page.__errors).toEqual([]);
});
