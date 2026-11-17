/* Public test origin only; checks synthetic checklist, not family sharing/DB. */
'use strict';
const assert = require('node:assert/strict');
const { chromium, webkit } = require('@playwright/test');

const repo = 'https://raw.githack.com/rodaisuki1023-alt/ig-public-assets';
const sha = process.env.GITHUB_SHA;
assert.match(sha || '', /^[a-f0-9]{40}$/, 'review commit SHA required');
const url = repo + '/' + sha + '/atokore-live-v125/index.html';

(async () => {
  for (const [label, browserType, width] of [
    ['chromium-320', chromium, 320],
    ['chromium-393', chromium, 393],
    ['webkit-393', webkit, 393],
    ['webkit-430', webkit, 430],
  ]) {
    const browser = await browserType.launch();
    const context = await browser.newContext({
      viewport: { width, height: 820 },
      locale: 'ja-JP',
      serviceWorkers: 'block',
    });
    const page = await context.newPage();
    const errors = [], household = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('request', req => {
      if (/supabase\.co|\/auth\/v1\/|\/rest\/v1\//i.test(req.url())) household.push(req.url());
    });
    try {
      const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      assert.equal(response?.status(), 200, label + ' page must be served');
      if (!(await page.locator('#atkSafeReviewBanner').count())) {
        const markup = await page.content();
        console.log('Review browser diagnostics:', JSON.stringify({
          label, finalUrl: page.url(), responseUrl: response?.url(),
          contentType: await response?.headerValue('content-type'),
          bodyHead: markup.slice(0, 850), totalBytes: markup.length,
        }));
      }
      await page.locator('#atkSafeReviewBanner').waitFor({ timeout: 15_000 });
      assert.match(await page.locator('#atkSafeReviewBanner').textContent(), /合成データのみ/);
      assert.equal(await page.evaluate(() => window.ATOKORE_HOUSEHOLD_CONFIG), null, label + ' sharing disabled');
      await page.locator('button[data-p="buy"]').click();
      await page.locator('#atkPackingMvp').waitFor({ timeout: 15_000 });
      assert.equal(await page.locator('#atkPackRows .atk-pack-row').count(), 6, label + ' initial daycare pack');
      const first = page.locator('#atkPackRows input[type="checkbox"]').first();
      await first.check();
      assert.match(await page.locator('#atkPackProgress').textContent(), /保育園セット：1\/6/);
      const saved = await page.evaluate(() => localStorage.getItem(window.AtokorePackingChecklist.key));
      assert.ok(saved && JSON.parse(saved).lists.daycare[0].done, label + ' state committed');
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 });
      await page.locator('button[data-p="buy"]').click();
      assert.equal(await page.locator('#atkPackRows input[type="checkbox"]').first().isChecked(), true, label + ' reload preserves check');
      await page.locator('[data-pack="outing"]').click();
      assert.equal(await page.locator('#atkPackRows .atk-pack-row').count(), 6, label + ' outings kit independent');
      const scroll = await page.evaluate(() => ({
        width: window.innerWidth,
        scroll: document.documentElement.scrollWidth,
      }));
      assert.ok(scroll.scroll <= scroll.width + 2, label + ' horizontal overflow: ' + JSON.stringify(scroll));
      assert.deepEqual(household, [], label + ' must not request real household backend');
      assert.deepEqual(errors, [], label + ' must not throw JS runtime errors');
      console.log('PASS', label, 'URL', url);
    } finally {
      await context.close();
      await browser.close();
    }
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
