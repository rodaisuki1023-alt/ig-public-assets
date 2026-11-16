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

// Attributes the matcher compares: size and form (diapers), content amount, and brands from a FIXED list only.
// Flavour is not an attribute, nor is a brand outside that list: such products can still be OFFERED as a
// candidate when the letters are alike; they are not pre-selected only because the printed text is not the
// exact confirmed text.
test('learned receipt texts: exact text pre-selects; near text, other size or amount do not; other flavour / unlisted brand are only offered', async ({ page }) => {
  const initial = { items: [
    { id: 1, name: 'テスト炭酸水 1L', cat: '食料品', qty: 1, unit: '本', place: 'パントリー', expType: '期限なし', exp: '', usage: 1, receiptAliases: ['テスト炭酸水1l'] },
    { id: 2, name: 'テストおむつ テープ M', cat: 'ベビー', qty: 1, unit: '袋', place: '収納', expType: '期限なし', exp: '', usage: 1, receiptAliases: ['テストおむつテープm'] },
    { id: 3, name: 'テストラーメン しょうゆ味', cat: '食料品', qty: 1, unit: '袋', place: 'パントリー', expType: '期限なし', exp: '', usage: 1, receiptAliases: ['テストラーメンしょうゆ味'] },
    { id: 4, name: 'メーカーA ヨーグルト 400g', cat: '食料品', qty: 1, unit: '個', place: '冷蔵庫', expType: '期限なし', exp: '', usage: 1, receiptAliases: ['メーカーaヨーグルト400g'] },
  ], buys: [], routines: [] };
  await open(page, { [KEY]: initial });
  await readText(page, [
    'テスト炭酸水1L ¥98',          // exactly the confirmed text → pre-selected
    'テスト炭酸水レ ¥98',          // near the confirmed text → offered only
    'テストおむつテープL ¥1,280',  // other size → never offered
    'テストラーメンみそ味 ¥120',   // other flavour: not detected → may be offered, not pre-selected
    'メーカーB ヨーグルト 400g ¥198', // brand not in the fixed list: not detected → may be offered, not pre-selected
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
  // The limit, stated: the other flavour IS offered as a candidate (flavour is not compared; the person must not
  // pick it blindly). Whether an unlisted brand is offered depends only on how alike the letters are (here: not).
  expect((await rowOf(page, 'テストラーメンみそ味').locator(`${PICK} option`).allTextContents()).join()).toContain('テストラーメン しょうゆ味');
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

// v49 2nd/3rd audit: print the OCR found but could not read is pointed out, never made a product; the photo
// review always says that not every miss can be detected and offers the whole photo. The OCR RESULT is
// synthetic here (the reader is replaced in the page) so the cases are deterministic; the real reader's
// output format is covered by receipt-photo-v49.spec.cjs.
async function readSynthetic(page, lines, dropped) {
  await open(page, { [KEY]: { items: [], buys: [], routines: [] } });
  await go(page, 'premium');
  await page.locator('#pg-premium .premium').filter({ hasText: 'レシート一括補充' }).click();
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  await page.setInputFiles('#receiptFile', { name: 'receipt.png', mimeType: 'image/png', buffer: png });
  await page.evaluate(([lines, dropped]) => {
    const W = 400, H = 520, c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, W, H); g.fillStyle = '#222'; g.font = '20px sans-serif';
    const items = lines.map(([text, y]) => { g.fillText(text, 20, y + 22); return { box: [[20, y], [380, y], [380, y + 28], [20, y + 28]], text, score: 0.95 }; });
    items.dropped = dropped.map(([x, y, w, h, score]) => { g.fillRect(x, y + 4, w, h - 8); return { box: [[x, y], [x + w, y], [x + w, y + h], [x, y + h]], score }; });
    items.canvas = c; items.turn = 0;
    window.AtokoreReceiptImage = { prepare: async () => ({ found: true, candidates: [{ turn: 0, canvas: c }] }) };
    window.AtokoreReceiptOcr = { ready: () => true, cached: async () => true, load: async () => {}, storage: () => ({ checked: 6, allStored: true, notStored: [] }), DOWNLOAD_MB: 38, readReceipt: async () => items };
  }, [lines, dropped]);
  await page.locator('#receiptAnalyzeBtn').click();
  await expect(page.getByRole('heading', { name: '🧾 読み取り結果の確認' })).toBeVisible();
}
const GENERAL = '読み落としをすべて検出できるわけではありません。写真と商品一覧を見比べてください。';
const BASE = [['テストストア', 10], ['テスト商品甲 ¥100', 80], ['テスト商品乙 ¥200', 130], ['テスト商品丙 ¥300', 230], ['小計 ¥600', 290], ['ポイント 6', 400]];

test('unread places inside the item list are shown with their picture; the count check says when it was not possible', async ({ page }) => {
  await readSynthetic(page, BASE, [[20, 182, 120, 28, 0.3], [160, 184, 60, 26, 0.1], [20, 402, 300, 28, 0.2]]);
  await expect(page.locator('[data-receipt-row]')).toHaveCount(3);
  await expect(page.locator('#receiptUnread')).toContainText(GENERAL);
  await expect(page.locator('#receiptUnread')).toContainText('商品の範囲に、文字として読めなかった部分が1か所');
  await expect(page.locator('#receiptUnread .receiptUnreadImgs img.receiptLineImg')).toHaveCount(1);
  // The places are not products and nothing about them is selected.
  await expect(page.locator('#receiptSelectionCount')).toHaveText('3/3件を選択');
  await expect(page.locator('#receiptCount')).toContainText('点数の照合はできていません');
});

test('no unread run found: the photo review still says misses cannot all be detected, never "none"; the whole photo opens', async ({ page }) => {
  await readSynthetic(page, BASE, []);
  const note = page.locator('#receiptUnread');
  await expect(note).toContainText(GENERAL);
  await expect(note).not.toContainText(/読み落としは(?:ありません|なし)|読み落としなし/);
  await expect(note).not.toContainText('各行の画像で確認できます');
  await page.locator('#receiptWhole summary').click();
  await expect(page.locator('#receiptWhole img.receiptWholeImg')).toBeVisible();
  // The picture is set when the section opens and decodes afterwards: wait for it, then check it is the photo.
  await expect.poll(() => page.locator('#receiptWhole img.receiptWholeImg').evaluate(i => i.complete ? i.naturalWidth : 0), { timeout: 5000 }).toBeGreaterThan(100);
});

test('dropped first product above the first row read is listed; a run on the store-name line is not', async ({ page }) => {
  await readSynthetic(page, BASE.filter(([t]) => t !== 'テスト商品甲 ¥100'), [[20, 80, 200, 28, 0.2], [150, 12, 80, 26, 0.3]]);
  await expect(page.locator('#receiptUnread')).toContainText('商品の範囲に、文字として読めなかった部分が1か所');
  await expect(page.locator('#receiptUnread .receiptUnreadImgs img')).toHaveCount(1);
});

test('no subtotal/total line, or no product read: the range is not called the item range and no pictures flood in', async ({ page }) => {
  await readSynthetic(page, BASE.filter(([t]) => !/小計|ポイント/.test(t)), [[20, 300, 200, 28, 0.2], [20, 350, 200, 28, 0.2], [20, 400, 200, 28, 0.2]]);
  let note = page.locator('#receiptUnread');
  await expect(note).toContainText('商品の範囲を確定できませんでした');
  await expect(note).not.toContainText('商品の範囲に、');
  await expect(note.locator('.receiptUnreadImgs img')).toHaveCount(0);
  await expect(note.locator('#receiptWhole')).toHaveCount(1);
  await page.locator('#sheet .close').click();
  await readSynthetic(page, [['テストストア', 10], ['小計 ¥600', 290]], [[20, 80, 200, 28, 0.2], [20, 130, 200, 28, 0.1]]);
  note = page.locator('#receiptUnread');
  await expect(page.locator('[data-receipt-row]')).toHaveCount(0);
  await expect(note).toContainText('商品の範囲を確定できませんでした');
  await expect(note).toContainText('2か所');
  await expect(note.locator('.receiptUnreadImgs img')).toHaveCount(0);
});

test('"各行の画像で確認できます" only for runs on rows that show a picture', async ({ page }) => {
  await readSynthetic(page, BASE, [[300, 132, 40, 24, 0.3]]);
  const note = page.locator('#receiptUnread');
  await expect(note).toContainText('画像を表示している行の中に、読めなかった文字が1か所あります。各行の画像で確認できます。');
  await expect(page.locator('[data-receipt-row]').filter({ hasText: 'テスト商品乙' }).locator('img.receiptLineImg')).toHaveCount(1);
  await page.locator('#sheet .close').click();
  // On a discount line (no row, no picture): a place, not "in a row".
  await readSynthetic(page, [['テストストア', 10], ['テスト商品乙 ¥200', 130], ['割引 -20', 180], ['テスト商品丙 ¥300', 230], ['小計 ¥480', 280]], [[250, 182, 60, 26, 0.3]]);
  await expect(page.locator('#receiptUnread')).not.toContainText('各行の画像で確認できます');
  await expect(page.locator('#receiptUnread')).toContainText('1か所');
});

test('the text path (no photo) shows no photo notice', async ({ page }) => {
  await open(page, { [KEY]: { items: [], buys: [], routines: [] } });
  await readText(page, 'テスト商品甲 ¥100\nテスト商品乙 ¥200\n小計 2点 ¥300');
  await expect(page.locator('#receiptUnread')).toHaveCount(0);
});

test('a matching count is not presented as proof that nothing was missed', async ({ page }) => {
  await open(page, { [KEY]: { items: [], buys: [], routines: [] } });
  await readText(page, 'テスト商品甲 ¥100\nテスト商品乙 ¥200\n小計 2点 ¥300');
  await expect(page.locator('#receiptCount')).toContainText('一致しています');
  await expect(page.locator('#receiptCount')).toContainText('読み落としがないとは限りません');
  await expect(page.locator('#receiptUnread')).toHaveCount(0);
});

test('the attribution and licenses of the reading parts are reachable from the receipt screen', async ({ page }) => {
  await open(page, { [KEY]: { items: [], buys: [], routines: [] } });
  await go(page, 'premium');
  await page.locator('#pg-premium .premium').filter({ hasText: 'レシート一括補充' }).click();
  await page.getByRole('button', { name: '文字認識の部品とライセンス' }).click();
  await expect(page.getByRole('heading', { name: '文字認識の部品とライセンス' })).toBeVisible();
  await expect(page.locator('.receiptCreditList')).toContainText('Apache License 2.0');
  await expect(page.locator('.receiptCreditList')).toContainText('onnxruntime-web 1.30.0');
  const links = await page.locator('.receiptCreditLinks a').evaluateAll(a => a.map(x => x.href));
  expect(links).toHaveLength(6);
  for (const href of links) {
    const res = await page.request.get(href);
    expect(res.status(), href).toBe(200);
    expect((await res.text()).length, href).toBeGreaterThan(200);
  }
  await page.getByRole('button', { name: '戻る' }).click();
  await expect(page.locator('#receiptAnalyzeBtn')).toBeVisible();
});
