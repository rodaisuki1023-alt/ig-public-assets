// v49 audit: the receipt-reading parts with the service worker ON (Chromium; WebKit does not route requests
// of pages with a worker, and the worker's offline behaviour is checked in Chromium like pwa.spec.cjs).
// download → restart → offline → app update → site data cleared → damaged cached copy.
// The picture is a SYNTHETIC receipt rendered by the test.
const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('@playwright/test');
const { open, go, KEY } = require('./helpers.cjs');

test.skip(({ browserName }) => browserName !== 'chromium', 'service worker behaviour is checked in Chromium');
test.setTimeout(300000);

async function receiptPhoto(browser) {
  const p = await browser.newPage({ viewport: { width: 900, height: 900 }, deviceScaleFactor: 1 });
  await p.setContent(`<!doctype html><meta charset="utf-8"><style>body{margin:0;width:900px;height:900px;background:#b98a5a;display:flex;align-items:center;justify-content:center}
  .r{background:#fbfaf6;padding:26px 30px;width:420px;font:22px/1.5 'IPAGothic','Noto Sans CJK JP',monospace;color:#1d1d1d;white-space:pre}</style>
  <div class="r">テストマート\n2026年10月27日(火) 12:54\nテスト純正ごま油 ¥398※\nテストヨーグルト ¥248※\n小計 2点 ¥646\n合計 ¥697</div>`);
  const png = await p.screenshot({ type: 'png' }); await p.close(); return png;
}
async function worker(page) {
  return page.evaluate(async () => { const reg = await navigator.serviceWorker.ready; if (!navigator.serviceWorker.controller) await new Promise(r => navigator.serviceWorker.addEventListener('controllerchange', r, { once: true })); return reg.scope; });
}
// Opens the receipt sheet, reads the picture; returns whether the download notice was shown.
async function read(page, png) {
  await go(page, 'premium');
  await page.locator('#pg-premium .premium').filter({ hasText: 'レシート一括補充' }).click();
  await page.setInputFiles('#receiptFile', { name: 'receipt.png', mimeType: 'image/png', buffer: png });
  await page.locator('#receiptAnalyzeBtn').click();
  const asked = await page.locator('#atkConfirmTitle').filter({ hasText: '読み取りの準備' }).waitFor({ timeout: 4000 }).then(() => true, () => false);
  if (asked) await page.locator('#atkConfirm .atk-confirm-primary').click();
  await expect(page.getByRole('heading', { name: '🧾 読み取り結果の確認' })).toBeVisible({ timeout: 200000 });
  await expect(page.locator('[data-receipt-row]')).toHaveCount(2);
  await page.locator('#sheet .close').click();
  return asked;
}
const modelCache = page => page.evaluate(async () => {
  const keys = await caches.keys(), name = keys.find(k => k.startsWith('atokore-ocr:'));
  return { keys, name, files: name ? (await (await caches.open(name)).keys()).map(r => new URL(r.url).pathname.split('/').pop()).sort() : [] };
});

test('reading parts: downloaded once, used after a restart, offline and after an app update; asked again after clearing; a damaged copy is replaced', async ({ browser, context }) => {
  const png = await receiptPhoto(browser);
  const PARTS = ['ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm', 'ort.wasm.min.js', 'ppocrv6-det-small-int8.onnx', 'ppocrv6-dict.txt', 'ppocrv6-rec-small.onnx'];
  let page = await context.newPage();
  await open(page, { [KEY]: { items: [], buys: [], routines: [] } });
  await worker(page); await page.reload(); await worker(page);

  // 1. First use: asked, downloaded, kept by the worker in its own cache.
  expect(await read(page, png)).toBe(true);
  let mc = await modelCache(page);
  expect(mc.files).toEqual(PARTS);

  // 2. "Restart": a new page in the same browser. Not asked again; every part comes from the worker cache.
  await page.close(); page = await context.newPage();
  const fromNetwork = [];
  page.on('response', r => { if (/\/ocr\//.test(r.url()) && !r.fromServiceWorker()) fromNetwork.push(r.url()); });
  await open(page, { [KEY]: { items: [], buys: [], routines: [] } });
  await worker(page);
  expect(await read(page, png)).toBe(false);
  expect(fromNetwork).toEqual([]);

  // 3. Offline: the app opens and reads.
  await context.setOffline(true);
  await page.reload();
  expect(await read(page, png)).toBe(false);
  await context.setOffline(false);

  // 4. App update (new worker version): the app cache is replaced, the reading parts are kept.
  const sw = path.join(process.env.E2E_SITE_ROOT, 'ig-public-assets/preview-baby-v19/service-worker.js');
  const original = fs.readFileSync(sw, 'utf8');
  try {
    fs.writeFileSync(sw, original.replace(/const CACHE_VERSION = '([^']+)';/, "const CACHE_VERSION = '$1-test-update';"));
    await page.evaluate(async () => { const reg = await navigator.serviceWorker.getRegistration(); await reg.update(); });
    await expect.poll(async () => (await modelCache(page)).keys.some(k => k.endsWith('-test-update')), { timeout: 30000 }).toBe(true);
    await page.reload();
    mc = await modelCache(page);
    expect(mc.files).toEqual(PARTS);
    expect(await read(page, png)).toBe(false);
  } finally { fs.writeFileSync(sw, original); }

  // 5. Site data cleared: the download notice comes back before anything is fetched.
  await page.evaluate(async () => { for (const k of await caches.keys()) await caches.delete(k); });
  await page.close(); page = await context.newPage();
  await open(page, { [KEY]: { items: [], buys: [], routines: [] } });
  await worker(page);
  expect(await read(page, png)).toBe(true);

  // 6. A damaged cached copy (wrong bytes) is detected by its SHA-256 and replaced; reading works.
  await page.evaluate(async () => {
    const name = (await caches.keys()).find(k => k.startsWith('atokore-ocr:')), c = await caches.open(name);
    const url = new URL('./ocr/ppocrv6-dict.txt', document.baseURI).href;
    await c.put(url, new Response('broken', { headers: { 'content-type': 'text/plain' } }));
  });
  await page.close(); page = await context.newPage();
  await open(page, { [KEY]: { items: [], buys: [], routines: [] } });
  await worker(page);
  await read(page, png);
  const fixed = await page.evaluate(async () => {
    const name = (await caches.keys()).find(k => k.startsWith('atokore-ocr:')), c = await caches.open(name);
    const hit = await c.match(new URL('./ocr/ppocrv6-dict.txt', document.baseURI).href);
    const d = await crypto.subtle.digest('SHA-256', await hit.arrayBuffer());
    return [...new Uint8Array(d)].map(x => x.toString(16).padStart(2, '0')).join('');
  });
  expect(fixed).toBe('f7aa897ca828a4c7c9e2739c30f9161a33306d532f020bcdb91dcfb664a5507e');
});
