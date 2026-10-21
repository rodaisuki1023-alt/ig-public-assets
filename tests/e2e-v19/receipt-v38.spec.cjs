// Receipt registration (v38) through the "paste receipt text" path, so the result is deterministic.
// This checks parsing, suggestions, the review flow and saving — NOT the accuracy of reading photos
// (see docs/atokore-receipt-eval-v38.md for the OCR evaluation on synthetic images).
const { test, expect } = require('@playwright/test');
const { open, go, stored, KEY, shot } = require('./helpers.cjs');

const M = 'パンパース さらさらケア おむつ テープ M', L = 'パンパース さらさらケア おむつ テープ L';
const seedState = () => ({
  items: [
    { id: 1, name: M, cat: 'ベビー', qty: 1, unit: '袋', place: '収納', expType: '期限なし', exp: '', usage: 1 },
    { id: 2, name: L, cat: 'ベビー', qty: 1, unit: '袋', place: '収納', expType: '期限なし', exp: '', usage: 1 },
    { id: 3, name: 'Rico おしりふき', cat: 'ベビー', qty: 2, unit: 'パック', place: '収納', expType: '期限なし', exp: '', usage: 1 },
    { id: 4, name: '牛乳', cat: '食料品', qty: 1, unit: '本', place: '冷蔵庫', expType: '消費期限', exp: '2099-01-01', usage: 1 },
  ],
  buys: [{ id: 20, name: 'Rico おしりふき', qty: 1, unit: 'パック', cat: 'ベビー' }],
  routines: [],
});
const RECEIPT = `イオン 上尾店
2026/10/20 12:34
TEL 048-000-0000
1100軽 ﾊﾟﾝﾊﾟｰｽ ｻﾗｻﾗｹｱ ﾃｰﾌﾟM 64ﾏｲ ¥1,628
1300軽 ﾘｺ ｵｼﾘﾌｷ 80ﾏｲX3 ¥398
1520軽 食パン 6枚 ¥158
1100軽 ﾒﾘｰｽﾞ ﾃｰﾌﾟM 64ﾏｲ
  2コ X 単1738 ¥3,476
1600 MRMI-2 ¥128
値引 -50
小計 ¥5,610
消費税 ¥448
合計 ¥6,058
クレジット ¥6,058`;

async function readReceipt(page, text = RECEIPT) {
  await go(page, 'premium');
  await page.locator('#pg-premium .premium').filter({ hasText: 'レシート一括補充' }).click();
  await page.locator('summary').filter({ hasText: 'レシートの文字を貼って読み取る' }).click();
  await page.fill('#receiptManualText', text);
  await page.getByRole('button', { name: '商品名を解析' }).click();
  await expect(page.getByRole('heading', { name: '🧾 読み取り結果の確認' })).toBeVisible();
}
const PICK = 'select[aria-label$="に対応する商品"]';
const row = (page, text) => page.locator('[data-receipt-row]').filter({ hasText: text });

for (const [width, height] of [[320, 568], [390, 844]]) {
  test.describe(`receipt ${width}px`, () => {
    test.use({ viewport: { width, height } });
    test('pack contents are not quantities, suggestions respect size, unreadable lines can be added, saved once via the review screen', async ({ page }, info) => {
      const initial = seedState();
      await open(page, { [KEY]: initial });
      await readReceipt(page);
      // Rows: purchase quantities, never the "64枚" / "6枚" pack contents.
      const diaper = page.locator('[data-receipt-row]').nth(0);
      await expect(diaper.locator('input[type=number]')).toHaveValue('1');
      await expect(row(page, '食パン').locator('input[type=number]')).toHaveValue('1');
      await expect(page.locator('[data-receipt-row]').nth(3).locator('input[type=number]')).toHaveValue('2');
      // Suggestions: the registered M tape is offered, the L tape is not; nothing is chosen for the person.
      const pick = diaper.locator(PICK);
      await expect(pick).toHaveValue('');
      const options = await pick.locator('option').allTextContents();
      expect(options).toContain('登録済み：' + M);
      expect(options.join()).not.toContain(L);
      await pick.selectOption({ label: '登録済み：' + M });
      await expect(page.locator('[data-receipt-row]').nth(0)).toContainText('レシート：');
      await page.locator('[data-receipt-row]').nth(1).locator(PICK).selectOption({ label: '登録済み：Rico おしりふき' });
      // The line that could not be read is listed and can be added.
      const rejected = page.locator('.receiptRejected');
      await expect(rejected).toContainText('MRMI-2');
      await expect(rejected).not.toContainText('値引'); // discounts, subtotal, tax and payment are neither products nor "unreadable"
      await expect(page.locator('[data-receipt-row]').filter({ hasText: '値引' })).toHaveCount(0);
      await expect(rejected).not.toContainText('小計');
      await rejected.getByRole('button', { name: '商品として追加' }).click();
      await expect(page.locator('[data-receipt-row]')).toHaveCount(5);
      await page.locator('[data-receipt-row]').nth(4).locator('.receiptCheck').uncheck();
      await expect(page.locator('.receiptStatus').filter({ hasText: '購入日：2026-10-20' })).toBeVisible();
      await shot(page, info, `${width}-v38-receipt-review`);
      expect(await stored(page)).toEqual(initial); // nothing saved yet
      await page.locator('#receiptApplyBtn').click();
      // The shared review screen shows what will happen; only its final button saves.
      await expect(page.locator('#qaTray')).toBeVisible();
      const effects = await page.locator('#qaTrayList .qa-review-effect').allTextContents();
      expect(effects).toEqual(['登録済みの在庫に合算：1袋 → 2袋', '登録済みの在庫に合算：2パック → 3パック', '新しい商品として登録', '新しい商品として登録']);
      expect(await stored(page)).toEqual(initial);
      await page.locator('#qaCommit').click();
      await expect(page.locator('#pg-stock')).toHaveClass(/on/);
      await expect.poll(async () => (await stored(page)).items.find(x => x.id === 1).receiptAliases?.length).toBe(1);
      const saved = await stored(page);
      expect(saved.items.find(x => x.id === 1)).toMatchObject({ qty: 2, purchase: '2026-10-20' });
      expect(saved.items.find(x => x.id === 2)).toEqual(initial.items[1]); // the L tape is untouched
      expect(saved.items.find(x => x.id === 3).qty).toBe(3);
      expect(saved.items.find(x => x.id === 4)).toEqual(initial.items[3]);
      const added = saved.items.filter(x => x.id > 4).map(x => [x.name, x.qty]);
      expect(added).toEqual([['食パン', 1], ['メリーズテープM64マイ', 2]]);
      expect(saved.items.some(x => !x.exp && x.exp !== '' && x.expType !== '期限なし')).toBe(false);
      expect(saved.buys).toEqual([]); // the bought wipes left the shopping list
      expect(page.__errors).toEqual([]);
    });
  });
}

test('the same receipt again: a duplicate warning, and the confirmed product is offered first', async ({ page }) => {
  await open(page, { [KEY]: seedState() });
  await readReceipt(page);
  await page.locator('[data-receipt-row]').nth(0).locator(PICK).selectOption({ label: '登録済み：' + M });
  await page.locator('#receiptApplyBtn').click();
  await page.locator('#qaCommit').click();
  await expect.poll(async () => (await stored(page)).items.find(x => x.id === 1).qty).toBe(2);
  const before = await stored(page);
  await readReceipt(page);
  await expect(page.locator('#receiptDuplicate')).toContainText('同じ可能性があります');
  await expect(page.locator('[data-receipt-row]').nth(0).locator(PICK)).toHaveValue('1');
  await expect(page.locator('[data-receipt-row]').nth(0).locator('select option:checked')).toContainText('前回と同じ');
  // A warning only: closing changes nothing.
  await page.click('#sheet .close');
  expect(await stored(page)).toEqual(before);
});

test('a failed save keeps the stock and the lines; nothing from the receipt is learned until saved', async ({ page }) => {
  const initial = seedState();
  await open(page, { [KEY]: initial });
  await readReceipt(page);
  await page.locator('[data-receipt-row]').nth(0).locator(PICK).selectOption({ label: '登録済み：' + M });
  await page.locator('#receiptApplyBtn').click();
  await page.evaluate(k => { const o = Storage.prototype.setItem; window.__undo = () => { Storage.prototype.setItem = o; }; Storage.prototype.setItem = function (key, v) { if (key === k) throw new DOMException('full', 'QuotaExceededError'); return o.call(this, key, v); }; }, KEY);
  await page.locator('#qaCommit').click();
  await expect(page.locator('#qaNotice')).toContainText('保存できませんでした');
  expect(await stored(page)).toEqual(initial);
  expect(await page.evaluate(() => items.find(x => x.id === 1).receiptAliases)).toBeUndefined();
  await page.evaluate(() => window.__undo());
  await page.locator('#qaCommit').click();
  await expect.poll(async () => (await stored(page)).items.find(x => x.id === 1).qty).toBe(2);
});
