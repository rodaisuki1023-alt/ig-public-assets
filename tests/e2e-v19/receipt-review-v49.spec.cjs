// v49 audit: what the receipt review and the confirmation screen say must be what is saved, and learned
// receipt texts may pre-select a product only when they are exactly the same (text path, deterministic;
// synthetic product names only).
const { test, expect } = require('@playwright/test');
const { open, go, stored, KEY } = require('./helpers.cjs');

async function readText(page, text) {
  await go(page, 'premium');
  await page.locator('#pg-premium .premium').filter({ hasText: 'レシート一括補充' }).click();
  await page.locator('summary').filter({ hasText: 'レシートの文字を貼って読み取る' }).click();
  await page.fill('#receiptManualText', text);
  await page.getByRole('button', { name: '商品名を解析' }).click();
  await expect(page.getByRole('heading', { name: '🧾 読み取り結果の確認' })).toBeVisible();
}
const PICK = 'select[aria-label$="に対応する商品"]';
const rowOf = (page, text) => page.locator('[data-receipt-row]').filter({ hasText: text });

test('a dated product: the review says "new row without a date", the confirmation says so, and that is what is saved', async ({ page }) => {
  const initial = { items: [
    { id: 1, name: 'テスト牛乳', cat: '食料品', qty: 1, unit: '本', place: '冷蔵庫', expType: '消費期限', exp: '2099-01-01', usage: 1 },
    { id: 2, name: 'テストティッシュ', cat: '日用品', qty: 2, unit: '個', place: '収納', expType: '期限なし', exp: '', usage: 1 },
  ], buys: [], routines: [] };
  await open(page, { [KEY]: initial });
  await readText(page, 'テスト牛乳 ¥218\nテストティッシュ ¥398\n小計 2点 ¥616');
  await rowOf(page, 'テスト牛乳').locator(PICK).selectOption({ label: '登録済み：テスト牛乳' });
  await expect(rowOf(page, 'テスト牛乳').locator('.receiptLotNote')).toContainText('期限が未設定の新しい行');
  await rowOf(page, 'テストティッシュ').locator(PICK).selectOption({ label: '登録済み：テストティッシュ' });
  await expect(rowOf(page, 'テストティッシュ').locator('.receiptLotNote')).toHaveCount(0);
  await page.locator('#receiptApplyBtn').click();
  const effects = await page.locator('#qaTrayList .qa-review-effect').allTextContents();
  expect(effects).toEqual(['期限つきの在庫とは別の行として登録（期限は未設定。今ある行は変わりません）', '登録済みの在庫に合算：2個 → 3個']);
  await page.locator('#qaCommit').click();
  await expect(page.locator('#pg-stock')).toHaveClass(/on/);
  const saved = await stored(page);
  const milks = saved.items.filter(x => x.name === 'テスト牛乳');
  expect(milks).toHaveLength(2);
  expect(milks.find(x => x.id === 1)).toMatchObject({ qty: 1, exp: '2099-01-01', expType: '消費期限' });
  const fresh = milks.find(x => x.id !== 1);
  expect(fresh.qty).toBe(1);
  expect(fresh.exp || '').toBe(''); // the existing date is never copied to the new purchase
  expect(saved.items.find(x => x.id === 2).qty).toBe(3);
  expect(page.__errors).toEqual([]);
});

test('learned receipt texts: exact text pre-selects; near text, other size, flavour, brand or amount do not', async ({ page }) => {
  const initial = { items: [
    { id: 1, name: 'テスト炭酸水 1L', cat: '食料品', qty: 1, unit: '本', place: 'パントリー', expType: '期限なし', exp: '', usage: 1, receiptAliases: ['テスト炭酸水1l'] },
    { id: 2, name: 'テストおむつ テープ M', cat: 'ベビー', qty: 1, unit: '袋', place: '収納', expType: '期限なし', exp: '', usage: 1, receiptAliases: ['テストおむつテープm'] },
    { id: 3, name: 'テストラーメン しょうゆ味', cat: '食料品', qty: 1, unit: '袋', place: 'パントリー', expType: '期限なし', exp: '', usage: 1, receiptAliases: ['テストラーメンしょうゆ味'] },
    { id: 4, name: 'メーカーA ヨーグルト 400g', cat: '食料品', qty: 1, unit: '個', place: '冷蔵庫', expType: '期限なし', exp: '', usage: 1, receiptAliases: ['メーカーaヨーグルト400g'] },
  ], buys: [], routines: [] };
  await open(page, { [KEY]: initial });
  await readText(page, [
    'テスト炭酸水1L ¥98',          // exactly the confirmed text → pre-selected
    'テスト炭酸水レ ¥98',          // near the confirmed text (another flavour?) → offered only
    'テストおむつテープL ¥1,280',  // other size → never offered
    'テストラーメンみそ味 ¥120',   // other flavour → not pre-selected
    'メーカーB ヨーグルト 400g ¥198', // other brand → not pre-selected
    'メーカーA ヨーグルト 75g ¥98',  // other amount → never offered
    '小計 6点 ¥1,892'].join('\n'));
  const value = async t => rowOf(page, t).locator(PICK).count().then(n => n ? rowOf(page, t).locator(PICK).inputValue() : null);
  // A row linked to a product shows the product name; the exact one is linked without the person choosing.
  await expect(page.locator('[data-receipt-row] .receiptLinked').filter({ hasText: 'テスト炭酸水 1L' })).toHaveCount(1);
  expect(await value('テスト炭酸水レ')).toBe('');
  const near = await rowOf(page, 'テスト炭酸水レ').locator(`${PICK} option`).allTextContents();
  expect(near.join()).toContain('前回と似た表記');
  expect(await value('テストおむつテープL')).not.toBe('2');
  const sizeOptions = await rowOf(page, 'テストおむつテープL').locator(`${PICK} option`).allTextContents();
  expect(sizeOptions.join()).not.toContain('テストおむつ テープ M');
  expect(await value('テストラーメンみそ味') || '').toBe('');
  expect(await value('メーカーBヨーグルト') || '').toBe('');
  const amountOptions = await rowOf(page, 'メーカーAヨーグルト75g').locator(`${PICK} option`).allTextContents().catch(() => []);
  expect(amountOptions.join()).not.toContain('メーカーA ヨーグルト 400g');
  // Saving adds only to the exactly matched product.
  await page.locator('#receiptApplyBtn').click();
  await page.locator('#qaCommit').click();
  await expect(page.locator('#pg-stock')).toHaveClass(/on/);
  const saved = await stored(page);
  expect(saved.items.find(x => x.id === 1).qty).toBe(2);
  for (const id of [2, 3, 4]) expect(saved.items.find(x => x.id === id).qty).toBe(1);
  expect(page.__errors).toEqual([]);
});
