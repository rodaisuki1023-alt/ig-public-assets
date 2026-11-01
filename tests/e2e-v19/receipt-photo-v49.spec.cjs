// v49 receipt PHOTO path with the real on-device OCR (PP-OCRv6 via onnxruntime-web), in Chromium and WebKit.
// The picture is a SYNTHETIC receipt rendered by the test (no real receipt, no personal data): paper on a
// wooden-looking table, photographed sideways. It checks the whole chain — finding and turning the paper,
// reading, line structure, quantities, the item-count check, review and a single save — not accuracy
// on real receipts (see docs/atokore-receipt-quality-v49.md for that, measured on private photos).
// v49 audit: the OCR runtime is served from the app itself (./ocr/, vendored onnxruntime-web 1.30.0).
const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('@playwright/test');
const { open, go, stored, KEY, shot } = require('./helpers.cjs');

// Kept for older call sites: the runtime no longer comes from a CDN, so nothing has to be routed.
const ORT_DIST = 'vendored';

const LINES = [
  'テストマート 本町店', 'TEL 000-000-0000', '2026年10月27日(火) 12:54', '領収書',
  '0002 国産豚こま切れ ¥458※',
  '0003 純正ごま油 ¥398※',
  '0011 テスト炭酸水 500ml',
  '  2コ X 単98 ¥196',
  '0011 カップヨーグルト ¥248※',
  '割引 30% -75',
  '小計 ¥1,225',
  '買上点数 5点',
  '合計 ¥1,323',
  'クレジット ¥1,323',
  'ポイント残高 1,000P',
];
const seedState = () => ({
  items: [{ id: 1, name: 'ごま油', cat: '食料品', qty: 1, unit: '本', place: 'パントリー', expType: '期限なし', exp: '', usage: 1 }],
  buys: [], routines: [],
});

async function receiptPhoto(browser) {
  // Rendered in a separate page: white receipt, slightly tilted, on a brown table, turned sideways.
  const p = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1 });
  await p.setContent(`<!doctype html><meta charset="utf-8"><style>
    body{margin:0;width:1400px;height:900px;background:repeating-linear-gradient(90deg,#b98a5a 0 38px,#c79a68 38px 80px);display:flex;align-items:center;justify-content:center}
    .r{transform:rotate(-89deg);background:#fbfaf6;padding:26px 30px;width:420px;font:22px/1.5 'IPAGothic','Noto Sans CJK JP',monospace;color:#1d1d1d;white-space:pre;box-shadow:0 3px 10px #0005}
  </style><div class="r">${LINES.map(l => l.replace(/&/g, '&amp;').replace(/</g, '&lt;')).join('\n')}</div>`);
  // Fixed conditions (v49 audit): the receipt text needs a Japanese font; without it the picture is empty
  // boxes and the OCR result means nothing, so say so instead of failing somewhere later.
  const font = await p.evaluate(async () => { await document.fonts.ready; return ['IPAGothic', 'Noto Sans CJK JP'].find(f => document.fonts.check(`22px "${f}"`, 'テスト')) || null; });
  if (!font) throw new Error('No Japanese font (IPAGothic or Noto Sans CJK JP) is installed: the synthetic receipt cannot be drawn.');
  const png = await p.screenshot({ type: 'png' });
  await p.close();
  return png;
}
// No request may leave the app's own site while reading (the photo stays on the phone, parts are local).
async function serveOcr(page) {
  page.__external = [];
  page.on('request', r => { const u = new URL(r.url()); if (!['127.0.0.1', 'localhost'].includes(u.hostname) && u.protocol.startsWith('http')) page.__external.push(r.url()); });
}
async function openReceipt(page, png) {
  await go(page, 'premium');
  await page.locator('#pg-premium .premium').filter({ hasText: 'レシート一括補充' }).click();
  await page.setInputFiles('#receiptFile', { name: 'receipt.png', mimeType: 'image/png', buffer: png });
  await expect(page.locator('#receiptAnalyzeBtn')).toBeEnabled();
}

// The app's service worker fetches ./ocr/ itself (cache first), and page.route() does not see those
// requests (WebKit also skips page.route() for pages with a worker): the worker is off in this file.
test.use({ serviceWorkers: 'block' });

test.describe('receipt photo, on-device OCR', () => {
  test.skip(!ORT_DIST, 'onnxruntime-web is not installed (npm install --no-save onnxruntime-web@1.30.0)');
  test.setTimeout(240000);

  test('a sideways photo is turned, read, checked against the item count and saved once', async ({ page, browser }, info) => {
    const png = await receiptPhoto(browser);
    await serveOcr(page);
    const initial = seedState();
    await open(page, { [KEY]: initial });
    await openReceipt(page, png);
    await page.locator('#receiptAnalyzeBtn').click();
    // First use asks before downloading the reading parts; the photo stays on the device.
    await expect(page.locator('#atkConfirmTitle')).toHaveText('読み取りの準備（初回のみ）');
    await expect(page.locator('#atkConfirmNote')).toContainText('外部には送りません');
    await expect(page.locator('#atkConfirmNote')).toContainText(/最大約\d+MB/);
    await page.locator('#atkConfirm .atk-confirm-primary').click();
    await expect(page.getByRole('heading', { name: '🧾 読み取り結果の確認' })).toBeVisible({ timeout: 200000 });

    const rows = page.locator('[data-receipt-row]');
    const names = await rows.evaluateAll(rs => rs.map(r => (r.querySelector('.receiptNameInput')?.value || r.querySelector('.receiptLinked small')?.textContent || '').replace(/^レシート：/, '')));
    // Products only: no header, discount, subtotal, count, total, payment or points line.
    expect(names.length).toBe(4);
    expect(names.join('|')).not.toMatch(/割引|小計|点数|合計|クレジット|ポイント|TEL|領収/);
    const qty = n => rows.filter({ has: page.locator(`input[value*="${n}"]`) }).first().locator('input[type=number]');
    // "2コ X 単98" is the purchase quantity of the line above; "500ml" stays in the name.
    const soda = rows.filter({ has: page.locator('input[value*="炭酸水"]') });
    await expect(soda.locator('input[type=number]')).toHaveValue('2');
    await expect(soda.locator('.receiptNameInput')).toHaveValue(/500ml/);
    await expect(qty('ヨーグルト')).toHaveValue('1');
    // The receipt's own count (5) equals the quantities read (1 + 1 + 2 + 1).
    await expect(page.locator('#receiptCount')).toContainText('一致しています');
    // The registered sesame oil is suggested, not chosen for the person.
    const oil = rows.filter({ hasText: 'ごま油' });
    await expect(oil.locator('select[aria-label$="に対応する商品"]')).toHaveValue('');
    await oil.locator('select[aria-label$="に対応する商品"]').selectOption({ label: '登録済み：ごま油' });
    // v49 audit: every row shows the printed line cut from the photo, so a misread name can be compared.
    await expect(rows.first().locator('img.receiptLineImg')).toBeVisible();
    expect(await rows.locator('img.receiptLineImg').count()).toBe(4);
    await shot(page, info, 'v49-receipt-photo-review');
    expect(await stored(page)).toEqual(initial); // nothing saved before the final button

    await page.locator('#receiptApplyBtn').click();
    await expect(page.locator('#qaTray')).toBeVisible();
    // A double tap on the final button saves once.
    await page.locator('#qaCommit').dblclick();
    await expect(page.locator('#pg-stock')).toHaveClass(/on/);
    const saved = await stored(page);
    expect(saved.items.find(x => x.id === 1).qty).toBe(2);
    const added = saved.items.filter(x => x.id !== 1);
    expect(added.length).toBe(3);
    expect(added.reduce((s, x) => s + x.qty, 0)).toBe(4);
    expect(page.__errors).toEqual([]);
    expect(page.__external).toEqual([]);
  });
});

test.describe('receipt photo: consent and failures', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'download consent and failure handling are browser-independent');

  test('cancelling the first download fetches nothing and changes nothing', async ({ page, browser }) => {
    const png = await receiptPhoto(browser);
    const fetched = [];
    page.on('request', r => { if (/\/ocr\/|onnxruntime-web/.test(r.url())) fetched.push(r.url()); });
    const initial = seedState();
    await open(page, { [KEY]: initial });
    await openReceipt(page, png);
    await page.locator('#receiptAnalyzeBtn').click();
    await page.locator('#atkConfirm').getByRole('button', { name: 'キャンセル' }).click();
    await expect(page.locator('#atkConfirm')).toHaveCount(0);
    await expect(page.locator('#receiptAnalyzeBtn')).toBeEnabled();
    expect(fetched).toEqual([]);
    expect(await stored(page)).toEqual(initial);
  });

  test('when the reading parts cannot be downloaded, nothing is registered and the next steps are offered', async ({ page, browser }) => {
    const png = await receiptPhoto(browser);
    await page.route('**/ocr/**', route => route.fulfill({ status: 404, body: '' }));
    if (ORT_DIST) await serveOcr(page);
    const initial = seedState();
    await open(page, { [KEY]: initial });
    await openReceipt(page, png);
    await page.locator('#receiptAnalyzeBtn').click();
    await page.locator('#atkConfirm .atk-confirm-primary').click();
    await expect(page.locator('#receiptFailed')).toContainText('何も登録していません', { timeout: 60000 });
    await expect(page.locator('#receiptFailed').getByRole('button', { name: '商品を選んで追加' })).toBeVisible();
    await expect(page.locator('#receiptAnalyzeBtn')).toBeEnabled();
    expect(await stored(page)).toEqual(initial);
  });

  test('when nothing could be read, the picture can be read again turned by a quarter', async ({ page, browser }) => {
    test.skip(!ORT_DIST, 'onnxruntime-web is not installed');
    test.setTimeout(240000);
    // A table with no receipt on it: nothing to read.
    const p = await browser.newPage({ viewport: { width: 900, height: 600 } });
    await p.setContent('<body style="margin:0;background:repeating-linear-gradient(90deg,#b98a5a 0 38px,#c79a68 38px 80px)">');
    const png = await p.screenshot(); await p.close();
    await serveOcr(page);
    const initial = seedState();
    await open(page, { [KEY]: initial });
    await openReceipt(page, png);
    await page.locator('#receiptAnalyzeBtn').click();
    await page.locator('#atkConfirm .atk-confirm-primary').click();
    await expect(page.getByRole('heading', { name: '🧾 読み取り結果の確認' })).toBeVisible({ timeout: 200000 });
    await expect(page.locator('[data-receipt-row]')).toHaveCount(0);
    await page.getByRole('button', { name: '向きを変えて読み直す' }).click();
    // Read again without asking for the download a second time; nothing is saved.
    await expect(page.locator('#atkConfirm')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: '🧾 読み取り結果の確認' })).toBeVisible({ timeout: 200000 });
    expect(await stored(page)).toEqual(initial);
    expect(page.__errors).toEqual([]);
  });
});
