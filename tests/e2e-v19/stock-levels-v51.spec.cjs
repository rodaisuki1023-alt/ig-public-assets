// v51 easy 3-level stock (余裕あり / そろそろ / 買う) and the optional detailed estimate, in the real app.
// The counted stock (qty) is never changed by a level or an estimate; "使い切った" asks first.
const { test, expect } = require('@playwright/test');
const { open, go, stored, baseState, KEY, appConfirm } = require('./helpers.cjs');

const level = page => page.locator('#sheet .atk-level');
async function detail(page, id) { await page.evaluate(i => window.atkShowDetail(i), id); await expect(level(page)).toBeVisible(); }
const homeIds = page => page.locator('#atkTasks [data-atk-open]').evaluateAll(n => n.map(x => Number(x.dataset.atkOpen)));

test('old items show the existing rule; setting a level changes home alerts but never the count', async ({ page }) => {
  const initial = baseState();
  await open(page, { [KEY]: initial });
  // Before: milk (qty 1) is the only item at its reorder line; diapers (2) and eggs (6) are fine.
  expect(await homeIds(page)).toEqual([1]);
  await detail(page, 3);
  await expect(level(page).locator('.atk-level-now')).toHaveText('今：余裕あり（在庫数から）');
  expect(await stored(page)).toEqual(initial); // opening writes nothing

  await level(page).locator('[data-atk-level-set="buy"]').click();
  await expect(level(page).locator('[data-atk-level-set="buy"]')).toHaveAttribute('aria-pressed', 'true');
  let s = await stored(page);
  expect(s.items.find(x => x.id === 3)).toMatchObject({ qty: 6, level: 'buy' });
  await page.getByRole('button', { name: '閉じる', exact: true }).click();
  await go(page, 'home');
  expect((await homeIds(page)).sort()).toEqual([1, 3]);

  // "余裕あり" on the low milk removes it from the alerts; the count stays 1.
  await detail(page, 1);
  await level(page).locator('[data-atk-level-set="plenty"]').click();
  await page.getByRole('button', { name: '閉じる', exact: true }).click();
  await go(page, 'home');
  expect(await homeIds(page)).toEqual([3]);
  s = await stored(page);
  expect(s.items.find(x => x.id === 1)).toMatchObject({ qty: 1, level: 'plenty' });

  // Removing the chosen level returns to the old rule exactly.
  await detail(page, 1);
  await level(page).locator('[data-atk-level-clear]').click();
  s = await stored(page);
  expect('level' in s.items.find(x => x.id === 1)).toBe(false);
  expect('levelAt' in s.items.find(x => x.id === 1)).toBe(false);
  expect(page.__errors).toEqual([]);
});

test('detailed estimate from packs, used-up asks before changing the count', async ({ page }) => {
  await open(page, { [KEY]: baseState() });
  await detail(page, 2);
  await level(page).locator('summary').click();
  await level(page).locator('[data-atk-level-packs]').fill('2');
  await level(page).locator('[data-atk-level-per-pack]').fill('60');
  await level(page).locator('[data-atk-level-per-day]').fill('6');
  await level(page).locator('[data-atk-level-start]').click();
  await expect(level(page).locator('.atk-level-estimate')).toContainText('約2袋（120枚）');
  await expect(level(page).locator('.atk-level-estimate')).toContainText('実際の在庫数とは別です');
  let diaper = (await stored(page)).items.find(x => x.id === 2);
  expect(diaper.qty).toBe(2);
  expect(diaper.track).toMatchObject({ v: 1, base: 120, perPack: 60, perDay: 6, refillDays: 5 });

  // Used up: the estimate restarts from 0; the count changes only after confirming.
  await level(page).locator('[data-atk-level-fix="usedUp"]').click();
  await appConfirm(page, false);
  diaper = (await stored(page)).items.find(x => x.id === 2);
  expect(diaper.qty).toBe(2);
  expect(diaper.track.base).toBe(0);
  await level(page).locator('[data-atk-level-fix="usedUp"]').click();
  await appConfirm(page, true);
  await expect.poll(async () => (await stored(page)).items.find(x => x.id === 2).qty).toBe(0);

  // Stop estimating: the track is removed, everything else stays.
  await detail(page, 2);
  await level(page).locator('[data-atk-level-stop]').click();
  diaper = (await stored(page)).items.find(x => x.id === 2);
  expect('track' in diaper).toBe(false);
  expect(diaper.name).toBe('パンパース さらさらケア おむつ テープ M');
  expect(page.__errors).toEqual([]);
});

test('invalid detailed input is explained and nothing is saved; a failed save is undone', async ({ page }) => {
  const initial = baseState();
  await open(page, { [KEY]: initial });
  await detail(page, 2);
  await level(page).locator('summary').click();
  await level(page).locator('[data-atk-level-per-day]').fill('0');
  await level(page).locator('[data-atk-level-start]').click();
  await expect(level(page).locator('.atk-level-error')).toHaveText('1袋あたりの枚数を入力してください');
  await level(page).locator('[data-atk-level-per-pack]').fill('60');
  await level(page).locator('[data-atk-level-start]').click();
  await expect(level(page).locator('.atk-level-error')).toHaveText('1日に使う量は0より大きい数で入力してください');
  expect(await stored(page)).toEqual(initial);

  await page.evaluate(() => { window.__realSave = window.save; window.save = () => false; });
  await level(page).locator('[data-atk-level-set="low"]').click();
  expect(await stored(page)).toEqual(initial);
  expect(await page.evaluate(() => items.find(x => x.id === 2).level)).toBeUndefined();
  await expect(level(page).locator('[data-atk-level-set="low"]')).toHaveAttribute('aria-pressed', 'false');
});

for (const width of [320, 393, 430]) test(`かんたん管理 fits at ${width}px with 44px targets`, async ({ page }) => {
  await page.setViewportSize({ width, height: 800 });
  await open(page, { [KEY]: baseState() });
  await detail(page, 2);
  await level(page).locator('summary').click();
  const facts = await page.evaluate(() => {
    const box = document.querySelector('#sheet .atk-level');
    const targets = [...box.querySelectorAll('button,summary,input')].filter(e => e.getBoundingClientRect().width > 0).map(e => e.getBoundingClientRect().height);
    const r = box.getBoundingClientRect();
    return { min: Math.min(...targets), right: r.right, scroll: document.documentElement.scrollWidth - innerWidth };
  });
  expect(facts.min).toBeGreaterThanOrEqual(44);
  expect(facts.right).toBeLessThanOrEqual(width);
  expect(facts.scroll).toBeLessThanOrEqual(0);
});
