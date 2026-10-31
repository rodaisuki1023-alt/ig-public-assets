// Reliability checks (v48.2): repeated taps count once, a failed save changes nothing and offers nothing
// to undo, and every message that used native alert() is shown inside the app.
const { test, expect } = require('@playwright/test');
const { open, go, stored, baseState, KEY, HISTORY } = require('./helpers.cjs');
test.use({ viewport: { width: 390, height: 844 } });

const state = () => baseState({ items: [
  { id: 1, name: '牛乳', cat: '食料品', qty: 1, unit: '本', expType: '期限なし', exp: '' },
  { id: 2, name: 'おしりふき', cat: 'ベビー', qty: 2, unit: 'パック', expType: '期限なし', exp: '' },
], buys: [{ id: 9, name: '牛乳', qty: 2, unit: '本', stockId: 1, cat: '食料品' }, { id: 10, name: '卵', qty: 1, unit: 'パック', cat: '食料品' }], routines: [] });
const history = page => page.evaluate(k => JSON.parse(localStorage.getItem(k) || '[]'), HISTORY);
const failSaves = page => page.evaluate(k => { const o = Storage.prototype.setItem; Storage.prototype.setItem = function (a, b) { if (a === k) throw new DOMException('quota', 'QuotaExceededError'); return o.call(this, a, b); }; }, KEY);

test('a double tap on 買った and on 元に戻す each count once', async ({ page }) => {
  const initial = state();
  await open(page, { [KEY]: initial });
  await go(page, 'buy');
  await page.evaluate(() => { const b = document.querySelector('#buyList [data-buy-id="9"] .stableBuyStock'); b.click(); b.click(); });
  let s = await stored(page);
  expect(s.items.find(x => x.id === 1).qty).toBe(3);
  expect(s.buys.map(x => x.name)).toEqual(['卵']);
  expect((await history(page)).length).toBe(1);
  await page.evaluate(() => { const b = [...document.querySelectorAll('#atkUndoBar button')].find(x => x.textContent.includes('元に戻す')); b.click(); b.click(); });
  await expect.poll(async () => (await stored(page)).items.find(x => x.id === 1).qty).toBe(1);
  s = await stored(page);
  expect(s.buys.map(x => [x.name, x.qty]).sort()).toEqual([['卵', 1], ['牛乳', 2]]);
  expect(page.__errors).toEqual([]);
});

test('a failed save during 買った keeps the list and stock, says so, and offers nothing to undo', async ({ page }) => {
  const initial = state();
  await open(page, { [KEY]: initial });
  await go(page, 'buy');
  await failSaves(page);
  await page.locator('#buyList [data-buy-id="9"] .stableBuyStock').click();
  await expect(page.locator('.atk-safety-text')).toContainText('保存できませんでした。変更は取り消し');
  expect(await stored(page)).toEqual(initial);
  expect(await page.evaluate(() => ({ items: items.map(x => x.qty), buys: buys.map(x => x.name) }))).toEqual({ items: [1, 2], buys: ['牛乳', '卵'] });
  await expect(page.locator('#atkUndoBar')).toHaveCount(0);
  expect(await history(page)).toEqual([]);
  await expect(page.locator('#buyList [data-buy-id="9"]')).toBeVisible();
});

test('saving the edit form twice in a row saves and records the change once', async ({ page }) => {
  await open(page, { [KEY]: state() });
  await go(page, 'stock');
  await page.evaluate(() => atokoreEditStock(1));
  await page.fill('#atkEditForm [name="qty"]', '4');
  await page.evaluate(() => { const b = document.querySelector('#atkEditForm .atk-edit-save'); b.click(); b.click(); });
  await expect.poll(async () => (await stored(page)).items.find(x => x.id === 1).qty).toBe(4);
  expect((await history(page)).length).toBe(1);
  expect(page.__errors).toEqual([]);
});

test('quick add: tapping the final save twice adds the product once', async ({ page }) => {
  await open(page, { [KEY]: state() });
  await page.click('#bfNavAdd');
  await page.fill('#qaFree', 'ベビー綿棒'); await page.click('[data-qa-free]');
  await page.click('#qaBar');
  await page.evaluate(() => { const b = document.getElementById('qaCommit'); b.click(); b.click(); });
  await expect.poll(async () => (await stored(page)).items.filter(x => x.name === 'ベビー綿棒').map(x => x.qty)).toEqual([1]);
});

test('messages that used native alert() appear in the app, never as a browser dialog', async ({ page }) => {
  await open(page, { [KEY]: state() });
  await go(page, 'buy');
  await page.evaluate(() => bought()); // nothing selected
  const notice = page.locator('#atkConfirm.atk-confirm-notice');
  await expect(notice).toBeVisible();
  await expect(notice.locator('h2')).toHaveText('「買った」にする商品を選んでください');
  await expect(notice.getByRole('button')).toHaveText(['OK']);
  const box = await notice.getByRole('button').boundingBox();
  expect(box.height).toBeGreaterThanOrEqual(44);
  await notice.getByRole('button', { name: 'OK' }).click();
  await expect(page.locator('#atkConfirm')).toHaveCount(0);
  // Escape closes it as well.
  await page.evaluate(() => alert('テストの通知'));
  await expect(page.locator('#atkConfirm h2')).toHaveText('テストの通知');
  await page.keyboard.press('Escape');
  await expect(page.locator('#atkConfirm')).toHaveCount(0);
  expect(page.__dialogs).toEqual([]);
  expect(await stored(page)).toEqual(state());
});

for (const width of [375, 390]) test.describe(`${width}px`, () => {
  test.use({ viewport: { width, height: 844 } });
  test('every control on the main screens is at least 44×44 and nothing scrolls sideways', async ({ page }, info) => {
    const { shot } = require('./helpers.cjs');
    await open(page, { [KEY]: baseState() });
    const small = () => page.evaluate(() => [...document.querySelectorAll('button, a[href], input[type=checkbox], select, [role=button]')].filter(e => {
      const r = e.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden' && !e.closest('[hidden]');
    }).map(e => {
      // A checkbox counts by the label it sits in, which is the area that toggles it.
      const target = e.matches('input[type=checkbox]') && e.closest('label') ? e.closest('label') : e;
      const r = target.getBoundingClientRect();
      return { name: (e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 20), w: Math.round(r.width), h: Math.round(r.height) };
    }).filter(x => x.w < 44 || x.h < 44));
    const screens = [
      ['home', () => go(page, 'home')],
      ['stock', () => go(page, 'stock')],
      ['stock list', () => page.click('[data-atk-view="list"]')],
      ['shopping', () => go(page, 'buy')],
      ['add', () => page.click('#bfNavAdd')],
      ['add baby', () => page.click('[data-qa-cat="ベビー"]')],
      ['my page', () => go(page, 'premium')],
    ];
    for (const [label, show] of screens) {
      await show();
      expect(await small(), label).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), label).toBe(true);
      if (label === 'shopping' || label === 'add baby') await shot(page, info, `v48-2-${width}-${label.replace(' ', '-')}`);
    }
    expect(page.__errors).toEqual([]);
  });
});

test('a shopping item saved without a category shows the category it will get in stock', async ({ page }) => {
  await open(page, { [KEY]: baseState({ items: [{ id: 1, name: '麦茶パック', cat: '食料品', qty: 1, unit: '袋', expType: '期限なし', exp: '' }], buys: [
    { id: 9, name: 'おしりふき詰替', qty: 1, unit: 'パック' },
    { id: 10, name: 'ゴミ袋', qty: 1, unit: '袋' },
    { id: 11, name: '麦茶パック', qty: 1, unit: '袋', stockId: 1 },
    { id: 12, name: '綿棒', qty: 1, unit: '箱', cat: '衛生・薬' },
  ], routines: [] }) });
  await go(page, 'buy');
  const label = id => page.locator(`#buyList [data-buy-id="${id}"] .atk-row-cat`);
  await expect(label(9)).toHaveText('ベビー');
  await expect(label(10)).toHaveText('日用品');
  await expect(label(11)).toHaveText('食料品');
  await expect(label(12)).toHaveText('衛生・薬'); // a saved category is never replaced
  // 「買った」 puts it in stock under the same category.
  await page.locator('#buyList [data-buy-id="9"] .stableBuyStock').click();
  await expect.poll(async () => (await stored(page)).items.find(x => x.name === 'おしりふき詰替')?.cat).toBe('ベビー');
});
