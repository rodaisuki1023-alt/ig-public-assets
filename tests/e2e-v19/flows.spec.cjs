const { test, expect } = require('@playwright/test');
const { open, go, stored, chooseBaby, baseState, KEY, shot } = require('./helpers.cjs');

test.describe('register, edit, delete', () => {
  test('several items survive reload; edit and delete only touch their own record', async ({ page }) => {
    await open(page, { [KEY]: baseState() });
    await page.click('#bfNavAdd');
    await chooseBaby(page, { kind: 'diaper', brand: 'ムーニー', type: 'パンツ', size: 'L', series: 'オヤスミマン' });
    await chooseBaby(page, { kind: 'wipes', brand: 'ピジョン', type: '詰替' });
    await page.click('[data-qa-cat="食料品"]');
    await page.click('[data-qa-pick="バナナ"]');
    await page.click('#qaCommit');
    await expect(page.locator('#qaNotice')).toContainText('3種類をストックに保存しました');
    await page.reload();
    let data = await stored(page);
    expect(data.items.map(x => x.name)).toEqual(expect.arrayContaining(['ムーニー オヤスミマン おむつ パンツ L', 'ピジョン おしりふき 詰替', 'バナナ']));
    const before = data.items.length;

    // Registering an existing product again adds to it instead of creating or overwriting a record.
    await page.click('#bfNavAdd');
    await chooseBaby(page, { kind: 'diaper', brand: 'パンパース', type: 'テープ', size: 'M', series: 'さらさらケア' });
    await page.click('#qaCommit');
    await expect(page.locator('#qaNotice')).toContainText('合算');
    data = await stored(page);
    expect(data.items).toHaveLength(before);
    expect(data.items.find(x => x.id === 2).qty).toBe(3);

    // Edit
    await go(page, 'stock');
    await page.locator('#stockList [data-stock-id="3"] .name').click();
    await page.click('.atk-edit-open');
    await page.fill('#atkEditForm input[name="name"]', '卵（Lサイズ）');
    await page.fill('#atkEditForm input[name="qty"]', '10');
    await page.click('.atk-edit-save');
    data = await stored(page);
    expect(data.items.find(x => x.id === 3)).toMatchObject({ name: '卵（Lサイズ）', qty: 10 });
    expect(data.items).toHaveLength(before);

    // Delete
    await page.evaluate(() => window.delItem(1));
    await page.reload();
    data = await stored(page);
    expect(data.items.some(x => x.id === 1)).toBe(false);
    expect(data.items).toHaveLength(before - 1);
    expect(data.items.find(x => x.id === 3).name).toBe('卵（Lサイズ）');
  });
});

test.describe('いつものセット', () => {
  test('tapping the same set again does not add its quantities twice', async ({ page }, testInfo) => {
    await open(page, { [KEY]: baseState() });
    await go(page, 'buy');
    await page.click('[data-bf-routine-buy="901"]');
    const first = await page.evaluate(() => AtokoreQuickAdd.getTray().map(x => [x.name, x.qty]));
    expect(first).toEqual([['パンパース さらさらケア おむつ テープ M', 2], ['牛乳', 1]]);
    await go(page, 'buy');
    await page.click('[data-bf-routine-buy="901"]');
    expect(await page.evaluate(() => AtokoreQuickAdd.getTray().map(x => [x.name, x.qty]))).toEqual(first);
    await expect(page.locator('#qaNotice')).toContainText('読み込み済み');
    // the stock variant of the same set only switches the destination
    await go(page, 'buy');
    await page.click('[data-bf-routine="901"]');
    expect(await page.evaluate(() => AtokoreQuickAdd.getTray().map(x => [x.name, x.qty]))).toEqual(first);
    await expect(page.locator('#qaCommit')).toHaveText('まとめてストックに追加');
    expect(page.__dialogs).toEqual([]);
    await shot(page, testInfo, 'set-loaded');
  });

  test('loading a set over edited items asks first; cancel keeps them', async ({ page }) => {
    await open(page);
    await page.evaluate(() => { routines.push({ id: 5, name: 'セットA', items: [{ id: 1, name: '牛乳', qty: 2, unit: '本' }] }); save(); render(); });
    page.removeAllListeners('dialog');
    const answers = [false, true];
    const asked = [];
    page.on('dialog', d => { asked.push(d.message()); answers.shift() ? d.accept() : d.dismiss(); });
    await page.click('#bfNavAdd');
    await chooseBaby(page, { kind: 'diaper', brand: 'グーン', type: 'パンツ', size: 'L' });
    await go(page, 'buy');
    await page.click('[data-bf-routine="5"]');
    expect(asked).toHaveLength(1);
    expect(await page.evaluate(() => AtokoreQuickAdd.getTray().map(x => x.name))).toEqual(['グーン おむつ パンツ L']);
    await go(page, 'buy');
    await page.click('[data-bf-routine="5"]');
    expect(await page.evaluate(() => AtokoreQuickAdd.getTray().map(x => [x.name, x.qty]))).toEqual([['牛乳', 2]]);
  });

  test('switching destination keeps the selection and commits only to the chosen list', async ({ page }) => {
    await open(page, { [KEY]: baseState() });
    const stockBefore = (await stored(page)).items;
    await page.click('#bfNavAdd');
    await chooseBaby(page, { kind: 'diaper', brand: 'パンパース', type: 'パンツ', size: 'L' });
    await page.click('#bfDestination [data-qa-dest="buy"]');
    await expect(page.locator('#qaNotice')).toContainText('買い物リスト');
    await expect(page.locator('#qaTrayDest')).toContainText('保存先：買い物リスト');
    await page.click('#qaCommit');
    const data = await stored(page);
    expect(data.items).toEqual(stockBefore);
    expect(data.buys.some(x => x.name === 'パンパース おむつ パンツ L')).toBe(true);
  });
});
