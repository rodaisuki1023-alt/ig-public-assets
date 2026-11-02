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

// v49 2nd audit: print the OCR found but could not read is pointed out (inside the item list only), never
// made a product; a receipt whose item count could not be read says the count check was not possible.
// The OCR RESULT is synthetic here (the reader is replaced in the page) so the places are deterministic;
// the real reader's output format is covered by receipt-photo-v49.spec.cjs.
test('unread places inside the item list are shown with their picture; the count check says when it was not possible', async ({ page }) => {
  await open(page, { [KEY]: { items: [], buys: [], routines: [] } });
  await go(page, 'premium');
  await page.locator('#pg-premium .premium').filter({ hasText: 'レシート一括補充' }).click();
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  await page.setInputFiles('#receiptFile', { name: 'receipt.png', mimeType: 'image/png', buffer: png });
  await page.evaluate(() => {
    const W = 400, H = 520, c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, W, H); g.fillStyle = '#222'; g.font = '20px sans-serif';
    const at = (text, y, x = 20, w = 360, score = 0.95) => { g.fillText(text, x, y + 22); return { box: [[x, y], [x + w, y], [x + w, y + 28], [x, y + 28]], text, score }; };
    const items = [at('テストストア', 10), at('テスト商品甲 ¥100', 80), at('テスト商品乙 ¥200', 130), at('テスト商品丙 ¥300', 230), at('小計 ¥600', 290), at('ポイント 6', 400)];
    g.fillRect(20, 186, 200, 20); // something printed between 乙 and 丙 that could not be read
    const box = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
    items.dropped = [{ box: box(20, 182, 120, 28), score: 0.3 }, { box: box(160, 184, 60, 26), score: 0.1, empty: true }, { box: box(20, 402, 300, 28), score: 0.2 }];
    items.canvas = c; items.turn = 0;
    window.AtokoreReceiptImage = { prepare: async () => ({ found: true, candidates: [{ turn: 0, canvas: c }] }) };
    window.AtokoreReceiptOcr = { ready: () => true, cached: async () => true, load: async () => {}, DOWNLOAD_MB: 38, readReceipt: async () => items };
  });
  await page.locator('#receiptAnalyzeBtn').click();
  await expect(page.getByRole('heading', { name: '🧾 読み取り結果の確認' })).toBeVisible();
  await expect(page.locator('[data-receipt-row]')).toHaveCount(3);
  await expect(page.locator('#receiptUnread')).toContainText('文字として読めなかった部分が1か所');
  await expect(page.locator('#receiptUnread img.receiptLineImg')).toHaveCount(1);
  // The places are not products and nothing about them is selected.
  await expect(page.locator('#receiptSelectionCount')).toHaveText('3/3件を選択');
  await expect(page.locator('#receiptCount')).toContainText('点数の照合はできていません');
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
