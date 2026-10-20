const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('@playwright/test');
const { APP, KEY } = require('./helpers.cjs');

const PROD = '/ig-public-assets/';
const PRODUCTION_KEYS = ['atokoreTrialV4', 'atokoreHistoryV1', 'atokoreDisplayPrefsV1', 'atokoreReceiptAliases', 'atokorePwaInstallDismissedAt'];

async function waitForWorker(page) {
  return page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return false;
    const reg = await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) await new Promise(r => navigator.serviceWorker.addEventListener('controllerchange', r, { once: true }));
    return reg.scope;
  });
}

test('trial and production keep separate storage, caches and service workers', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'service worker cache inspection is checked in Chromium');
  page.on('dialog', d => d.accept());

  // Production stand-in with its own data and an unrelated cache from another app.
  await page.goto(PROD);
  const prodScope = await waitForWorker(page);
  expect(prodScope).toMatch(/\/ig-public-assets\/$/);
  await page.evaluate(keys => { keys.forEach(k => localStorage.setItem(k, 'production-' + k)); return caches.open('someone-elses-cache').then(c => c.put('/x', new Response('x'))); }, PRODUCTION_KEYS);

  // Use the trial: add stock, change display prefs, dismiss install card.
  await page.goto(APP);
  const trialScope = await waitForWorker(page);
  expect(trialScope).toMatch(/\/preview-baby-v19\/$/);
  await page.evaluate(() => { items.push({ id: 77, name: 'trial', cat: '食料品', qty: 1, unit: '個' }); save(); window.setAtokoreDisplay?.('font', 'large'); });
  await page.reload();
  await waitForWorker(page);

  const result = await page.evaluate(async keys => {
    const names = await caches.keys();
    const entries = {};
    for (const n of names) entries[n] = (await (await caches.open(n)).keys()).map(r => new URL(r.url).pathname);
    return { names, entries, production: keys.map(k => localStorage.getItem(k)), all: Object.keys(localStorage) };
  }, PRODUCTION_KEYS);

  expect(result.production).toEqual(PRODUCTION_KEYS.map(k => 'production-' + k));
  expect(result.names).toContain('someone-elses-cache');
  const prodCache = result.names.find(n => n.includes(':/ig-public-assets/:'));
  const trialCache = result.names.find(n => n.includes(':/ig-public-assets/preview-baby-v19/:'));
  expect(prodCache).toBeTruthy();
  expect(trialCache).toBeTruthy();
  expect(result.entries[prodCache].filter(p => p.includes('/preview-baby-v19/')), 'production worker never caches trial files').toEqual([]);
  expect(result.entries[trialCache].every(p => p.startsWith(APP))).toBe(true);
  const written = result.all.filter(k => !PRODUCTION_KEYS.includes(k));
  expect(written.length).toBeGreaterThan(0);
  expect(written.every(k => k.startsWith('atokorePreview')), written.join(',')).toBe(true);
  expect(await page.evaluate(k => JSON.parse(localStorage.getItem(k)).items.some(x => x.id === 77), KEY)).toBe(true);
});

test('a new release is shown on the next load, and the app still opens offline', async ({ page, context, browserName }) => {
  test.skip(browserName !== 'chromium', 'offline service worker behaviour is checked in Chromium');
  const file = path.join(process.env.E2E_SITE_ROOT, 'ig-public-assets/preview-baby-v19/index.html');
  const original = fs.readFileSync(file, 'utf8');
  try {
    await page.goto(APP);
    await waitForWorker(page);
    fs.writeFileSync(file, original.replace('</body>', '<div id="releaseMarker">new release</div></body>'));
    await page.reload();
    await expect(page.locator('#releaseMarker')).toHaveText('new release');
    await context.setOffline(true);
    await page.reload();
    await expect(page.locator('#bfNavAdd')).toBeVisible();
  } finally {
    await context.setOffline(false);
    fs.writeFileSync(file, original);
  }
});
