// W2 item 0: confirmations that used native confirm() now use the app's own dialog. These run with
// native dialogs dismissed at once (as in in-app browsers / review tools) and fail if one appears.
const { test, expect } = require('@playwright/test');
const { APP, KEY, HISTORY, stored, baseState, appConfirm } = require('./helpers.cjs');

async function openWithoutNativeDialogs(page, values) {
  page.__errors = []; page.__native = [];
  page.on('pageerror', e => page.__errors.push(String(e)));
  page.on('dialog', d => { page.__native.push(d.message()); d.dismiss(); });
  await page.addInitScript(entries => { if (!sessionStorage.getItem('__seeded')) { sessionStorage.setItem('__seeded', '1'); for (const [k, v] of Object.entries(entries)) localStorage.setItem(k, JSON.stringify(v)); } }, values);
  await page.goto(APP);
  await page.waitForFunction(() => !!document.getElementById('bfNavAdd'));
}
test.use({ viewport: { width: 390, height: 844 } });

test('unsaved list name and adding a stock product to a list ask in the app; cancel changes nothing', async ({ page }) => {
  const initial = baseState();
  await openWithoutNativeDialogs(page, { [KEY]: initial });
  await page.evaluate(() => window.go('buy'));
  await page.click('[data-bf-routine="901"]');
  await page.fill('#routineNameEdit', 'まだ保存していない名前');
  await page.click('#atkRoutineCatalogOpen');
  expect(await appConfirm(page, false)).toContain('リスト名はまだ保存されていません');
  await expect(page.locator('#modal')).toHaveClass(/on/); // still on the list
  await page.click('#atkRoutineCatalogOpen');
  await appConfirm(page, true);
  await expect(page.locator('#pg-add')).toHaveClass(/on/);
  expect((await stored(page)).routines[0].name).toBe('ベビー定番');

  // Stock picker: choose a stock product for the list.
  await page.evaluate(() => { AtokoreQuickAdd.cancelRoutinePicker(false); AtokoreRoutineCatalog.start(901); });
  await expect(page.locator('#pg-stock')).toHaveClass(/on/);
  await page.locator('#stockList [data-stock-id="3"]').click(); // 卵, not yet in the list
  expect(await appConfirm(page, false)).toContain('「卵」を「ベビー定番」に追加してもいいですか？');
  expect(await stored(page)).toEqual(initial);
  await page.locator('#stockList [data-stock-id="3"]').click();
  await appConfirm(page, true);
  await expect.poll(async () => (await stored(page)).routines[0].items.map(x => x.name)).toContain('卵');
  expect((await stored(page)).items).toEqual(initial.items);
  expect(page.__native).toEqual([]);
  expect(page.__errors).toEqual([]);
});

test('clearing the history asks in the app and cancel keeps it', async ({ page }) => {
  const history = [{ id: 'h1', ts: Date.now(), title: '在庫を追加', detail: '牛乳', type: 'stock', icon: '+' }];
  await openWithoutNativeDialogs(page, { [KEY]: baseState(), [HISTORY]: history });
  await page.evaluate(() => window.openAtokoreHistory());
  await page.evaluate(() => window.clearAtokoreHistory());
  expect(await appConfirm(page, false)).toContain('操作履歴をすべて消去しますか？');
  expect(await page.evaluate(k => JSON.parse(localStorage.getItem(k)).length, HISTORY)).toBe(1);
  await page.evaluate(() => window.clearAtokoreHistory());
  await appConfirm(page, true);
  await expect.poll(() => page.evaluate(k => JSON.parse(localStorage.getItem(k)).length, HISTORY)).toBe(0);
  expect(page.__native).toEqual([]);
});
