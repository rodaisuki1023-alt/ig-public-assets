// v51 曜日・行事・子どもの持ち物: per-child weekly and event rows, today's list, the summary for
// several children, daily ticks, no stock change, stale-tab and corrupt-data protection.
const { test, expect } = require('@playwright/test');
const { open, go, stored, baseState, KEY, appConfirm } = require('./helpers.cjs');
const PREP = 'atokorePrepSetsV1:/ig-public-assets/preview-baby-v19/';
const today = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const stock = () => baseState({ items: [
  { id: 1, name: 'おしりふき', cat: 'ベビー', qty: 0, unit: 'パック' },
  { id: 2, name: 'パンパース おむつ テープ M', cat: 'ベビー', qty: 2, unit: '袋' },
], buys: [], routines: [] });
const box = page => page.locator('#atkPrepSets');

test('two children: today event rows, summary counts both, ticking changes nothing else', async ({ page }) => {
  const initial = stock();
  await open(page, { [KEY]: initial });
  await go(page, 'buy');
  await box(page).locator('summary').first().click();
  for (const name of ['上の子', '下の子']) {
    await box(page).locator('[data-prep-kid-name]').fill(name);
    await box(page).locator('[data-prep-add-child]').click();
  }
  await expect(box(page).locator('.atk-prep-kid')).toHaveCount(2);
  // An event today for each child (works on any weekday).
  for (const child of ['上の子', '下の子']) {
    await box(page).locator('[data-prep-child]').selectOption({ label: child });
    await box(page).locator('[data-prep-when]').selectOption('date');
    await box(page).locator('[data-prep-date]').fill(today());
    await box(page).locator('[data-prep-label]').fill('遠足');
    await box(page).locator('[data-prep-name]').fill('おしりふき');
    await box(page).locator('[data-prep-add]').click();
  }
  await expect(box(page).locator('.atk-prep-today li')).toHaveCount(2);
  await expect(box(page).locator('.atk-prep-today li').first()).toContainText('上の子・遠足');
  await expect(box(page).locator('.atk-prep-count')).toHaveText('今日 2/2');
  // The summary lists the wipes once, for two children, and offers the shopping link.
  await page.locator('#atkPackShort summary').click();
  await expect(page.locator('#atkPackShort li.zero')).toHaveText('在庫0：おしりふき（2人分）');
  // Ticking one child's row: one left; nothing else changes.
  await box(page).locator('.atk-prep-today input').first().check();
  await expect(box(page).locator('.atk-prep-count')).toHaveText('今日 1/2');
  await expect(page.locator('#atkPackShort li.zero')).toHaveText('在庫0：おしりふき');
  expect(await stored(page)).toEqual(initial);
  // Reload keeps today's tick; the base checklist is untouched (its own key).
  await page.reload(); await go(page, 'buy');
  await expect(box(page).locator('.atk-prep-count')).toHaveText('今日 1/2');
  expect(await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('atokorePackingChecklistV1')).length)).toBe(0);
  expect(page.__errors).toEqual([]);
});

test('another tab changed the sets: the write is refused and the latest is shown; corrupt data is never overwritten', async ({ page }) => {
  await open(page, { [KEY]: stock() });
  await go(page, 'buy');
  await box(page).locator('summary').first().click();
  await box(page).locator('[data-prep-kid-name]').fill('上の子');
  await box(page).locator('[data-prep-add-child]').click();
  // Simulate another tab writing a different version.
  await page.evaluate(k => { const s = JSON.parse(localStorage.getItem(k)); s.children.push({ id: 'c-other', name: '別タブの子' }); localStorage.setItem(k, JSON.stringify(s)); }, PREP);
  await box(page).locator('[data-prep-kid-name]').fill('三人目');
  await box(page).locator('[data-prep-add-child]').click();
  await expect(box(page).locator('.atk-prep-error')).toContainText('別の画面で変更されたため');
  await expect(box(page).locator('.atk-prep-kid')).toHaveCount(2);
  expect(await page.evaluate(k => JSON.parse(localStorage.getItem(k)).children.map(c => c.name), PREP)).toEqual(['上の子', '別タブの子']);

  await page.evaluate(k => localStorage.setItem(k, '{"v":1,"children":"broken"}'), PREP);
  await page.reload(); await go(page, 'buy');
  await box(page).locator('summary').first().click();
  await expect(box(page).locator('.atk-prep-error').first()).toContainText('保存内容を読めないため');
  expect(await page.evaluate(k => localStorage.getItem(k), PREP)).toBe('{"v":1,"children":"broken"}');
});

test('removing a child asks first and removes only that child\'s rows', async ({ page }) => {
  await open(page, { [KEY]: stock() });
  await go(page, 'buy');
  await box(page).locator('summary').first().click();
  await box(page).locator('[data-prep-kid-name]').fill('上の子'); await box(page).locator('[data-prep-add-child]').click();
  await box(page).locator('[data-prep-when]').selectOption('w1'); await box(page).locator('[data-prep-name]').fill('シーツ'); await box(page).locator('[data-prep-add]').click();
  await box(page).locator('[data-prep-del-child]').click();
  await appConfirm(page, false);
  await expect(box(page).locator('.atk-prep-kid')).toHaveCount(1);
  await box(page).locator('[data-prep-del-child]').click();
  await appConfirm(page, true);
  await expect(box(page).locator('.atk-prep-kid')).toHaveCount(0);
  expect(await page.evaluate(k => JSON.parse(localStorage.getItem(k)), PREP)).toMatchObject({ children: [], week: {} });
});

for (const width of [320, 393, 430]) test(`prep sets fit at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 800 });
  await open(page, { [KEY]: stock() });
  await go(page, 'buy');
  await box(page).locator('summary').first().click();
  await box(page).locator('[data-prep-kid-name]').fill('とても長いなまえの上の子'); await box(page).locator('[data-prep-add-child]').click();
  const f = await page.evaluate(() => { const b = document.getElementById('atkPrepSets'), r = b.getBoundingClientRect();
    const t = [...b.querySelectorAll('button,summary,input,select')].filter(e => e.getBoundingClientRect().width > 0).map(e => e.getBoundingClientRect().height);
    return { right: r.right, min: Math.min(...t), scroll: document.documentElement.scrollWidth - innerWidth }; });
  expect(f.right).toBeLessThanOrEqual(width); expect(f.min).toBeGreaterThanOrEqual(44); expect(f.scroll).toBeLessThanOrEqual(0);
});
