// v51 everyday usability (2026-11-27): typed shopping entries, duplicate packing items, plan comparison.
const { test, expect } = require('@playwright/test');
const { open, go, stored, baseState, KEY } = require('./helpers.cjs');

const addTyped = async (page, text) => { await page.fill('#buyName', text); await page.getByRole('button', { name: '追加', exact: true }).first().click(); };

test('a typed name already in stock uses the stock unit; "買った" adds to that row, never a second one', async ({ page }) => {
  await open(page, { [KEY]: baseState() });
  await go(page, 'buy');
  // Stock 牛乳 is counted in 本 (the usual guess for 牛乳 is パック).
  await addTyped(page, '牛乳');
  let s = await stored(page);
  expect(s.buys.filter(x => x.name === '牛乳')).toEqual([expect.objectContaining({ qty: 1, unit: '本', cat: '食料品' })]);
  // Typed again with a quantity: the same row grows and the screen says so.
  await addTyped(page, '牛乳 2');
  await expect(page.locator('#atkNoticeHost, body')).toContainText('牛乳は買い物リストにあるので、数量を3本にしました');
  s = await stored(page);
  expect(s.buys.filter(x => x.name === '牛乳')).toEqual([expect.objectContaining({ qty: 3, unit: '本' })]);
  const row = s.buys.find(x => x.name === '牛乳');
  await page.locator(`[data-buy-id="${row.id}"] .stableBuyStock`).click();
  s = await stored(page);
  expect(s.items.filter(x => x.name === '牛乳')).toEqual([expect.objectContaining({ id: 1, qty: 4, unit: '本' })]);
  expect(page.__errors).toEqual([]);
});

test('a quantity typed after the name is read; numbers that belong to the name are kept', async ({ page }) => {
  await open(page, { [KEY]: baseState({ items: [], buys: [] }) });
  await go(page, 'buy');
  await addTyped(page, 'トマト 3');
  await addTyped(page, '卵 10個');
  await addTyped(page, '単3電池');
  const s = await stored(page);
  expect(s.buys.map(x => [x.name, x.qty, x.unit])).toEqual([['トマト', 3, '個'], ['卵', 10, '個'], ['単3電池', 1, s.buys[2].unit]]);
  await expect(page.locator('#buyList')).toContainText('3個');
  expect(page.__errors).toEqual([]);
});

test('the same item cannot be added twice to a packing set; the notice says why', async ({ page }) => {
  await open(page, { [KEY]: baseState() });
  await go(page, 'buy');
  const rows = page.locator('#atkPackRows input[type=checkbox]');
  const before = await rows.count();
  await page.fill('#atkPackAddInput', ' おむつ ');
  await page.click('#atkPackAddButton');
  await expect(page.locator('#atkPackError')).toHaveText('「おむつ」はすでに保育園セットにあります。');
  await expect(rows).toHaveCount(before);
  await expect(page.locator('#atkPackAddInput')).toHaveValue(' おむつ ');
  await page.fill('#atkPackAddInput', '帽子');
  await page.click('#atkPackAddButton');
  await expect(rows).toHaveCount(before + 1);
  await expect(page.locator('#atkPackError')).toBeHidden();
  expect(page.__errors).toEqual([]);
});

for (const width of [320, 393])
  test('my page lists free vs paid from the feature catalogue; the estimate is free; nothing to buy at ' + width + 'px', async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await open(page, { [KEY]: baseState() }, { receiptExperimental: false });
    await go(page, 'premium');
    const intro = page.locator('#premiumIntroV125m');
    await expect(intro).toContainText('今ある機能は、正式版でも無料のままです');
    const box = page.locator('#atkPlanCompare');
    await expect(box).toBeVisible();
    await box.locator('summary').click();
    const cols = box.locator('.atkPlanCols > div');
    await expect(cols.nth(0)).toContainText('詳しく管理・残りの見積もり');
    await expect(cols.nth(0)).toContainText('家族2人の共有');
    await expect(cols.nth(1)).toContainText('共有写真を20枚まで');
    await expect(cols.nth(1)).toContainText('（検討中・未提供）');
    await expect(cols.nth(1)).not.toContainText('見積もり');
    await expect(box.locator('button, a')).toHaveCount(0);
    expect((await box.locator('summary').boundingBox()).height).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    expect(page.__errors).toEqual([]);
  });

test('a tracked product shows the estimate days on its stock card in both views; untracked ones do not', async ({ page }) => {
  const day = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  const s = baseState();
  s.items[1].track = { v: 1, base: 120, since: day, perDay: 6, perPack: 60, refillDays: 5, confirmedAt: day, t: Date.now() };
  await page.clock.setFixedTime(new Date(day + 'T12:00:00+09:00'));
  await open(page, { [KEY]: s });
  await go(page, 'stock');
  const tracked = page.locator('#stockList [data-stock-id="2"] .atk-lv-days');
  await expect(tracked).toHaveText('見積 あと18〜22日');
  await expect(tracked).toHaveAttribute('aria-label', /の見積もり：あと18〜22日/);
  await expect(page.locator('#stockList [data-stock-id="1"] .atk-lv-days')).toHaveCount(0);
  // The same range as the product sheet.
  await page.evaluate(() => window.atkShowDetail(2));
  await expect(page.locator('#sheet .atk-level-estimate')).toContainText('あと18〜22日');
  await page.getByRole('button', { name: '閉じる', exact: true }).click();
  const list = page.getByRole('button', { name: /写真なし/ });
  if (await list.count()) { await list.first().click(); await expect(tracked).toHaveText('見積 あと18〜22日'); }
  expect((await page.evaluate(() => (JSON.parse(localStorage.getItem('atokorePreviewTrialV19')).items.find(x => x.id === 2) || {}).qty))).toBe(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  expect(page.__errors).toEqual([]);
});

test('everyday saving: quick taps, a purchase and an added item survive an immediate reload', async ({ page }) => {
  await open(page, { [KEY]: baseState() });
  await go(page, 'stock');
  const plus = page.locator('#stockList [data-stock-id="3"] button.icon', { hasText: '＋' });
  for (let i = 0; i < 8; i++) await plus.click();
  await go(page, 'buy');
  await page.locator('[data-buy-id="10"] .stableBuyStock').click();
  await addTyped(page, 'トマト 2');
  await page.reload();
  await page.waitForFunction(() => !!document.getElementById('bfNavAdd'));
  const s = await stored(page);
  expect(s.items.find(x => x.id === 3).qty).toBe(14);
  expect(s.items.find(x => x.name === 'おしりふき詰替')).toMatchObject({ qty: 1 });
  expect(s.buys.map(x => [x.name, x.qty])).toEqual([['トマト', 2]]);
  await go(page, 'stock');
  await expect(page.locator('#stockList [data-stock-id="3"] .qty b')).toHaveText('14個');
  expect(page.__errors).toEqual([]);
});
