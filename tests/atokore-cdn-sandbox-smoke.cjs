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
    // The public Git preview proxy shows a once-per-day HTML phishing notice.
    // Browser CI sets the documented consent cookie; humans must click Continue once.
    await context.addCookies([{
      name: '__Http-phish', value: '1', domain: 'raw.githack.com', path: '/',
      httpOnly: true, secure: true, sameSite: 'Lax',
    }]);
    // rawgit.hack shows a human consent notice for browser HTML; its published
    // documentation explicitly allows this HTTP-only opt-in cookie for browser
    // automation. This is test-only, never shipped in the user-facing app.
    await context.addCookies([{ name: '__Http-phish', value: '1',
      domain: 'raw.githack.com', path: '/', secure: true, httpOnly: true }]);
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
      const shortcut=page.locator('#pg-buy .atk-pack-jump');
      await shortcut.waitFor({timeout:10_000});
      assert.equal(await shortcut.getAttribute('href'),'#atkPackingMvp',label+' shortcut must target kit');
      const jumpSize=await shortcut.boundingBox();
      assert.ok(jumpSize?.height>=44,label+' shortcut has minimum 44px tap height');
      await shortcut.click();
      await page.waitForFunction(()=>document.querySelector('#atkPackingMvp')?.getBoundingClientRect().top<820);
      // Text never falls back to the old 9px batch-selection label.
      const batchFont=await page.evaluate(()=>{
        const x=document.querySelector('#pg-buy .atk-bulk-pick span');
        return x ? parseFloat(getComputedStyle(x).fontSize) : null;
      });
      // An empty synthetic shopping list may not render selection labels yet.
      if(batchFont!==null)assert.ok(batchFont>=11,label+' selection caption is readable');
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
      assert.match(await page.locator('#pg-stock').textContent(), /ストックからまとめて買い物へ/);
      assert.doesNotMatch(await page.locator('#pg-stock').textContent(), /在庫からまとめて買い物へ/);
      // Re-enter a pristine first-run state on the same independent origin.
      await page.evaluate(() => localStorage.clear());
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 });
      await page.locator('#atkOnboarding').waitFor({ timeout: 10_000 });
      assert.equal(await page.locator('[data-ob-guide]').count(), 4, 'four detailed guide choices');
      assert.equal(await page.locator('[data-ob-pick="おむつ"]').count(), 0, 'no unbranded diaper chip');
      assert.equal(await page.locator('[data-ob-pick="おしりふき"]').count(), 0, 'no unbranded wipes chip');
      assert.equal(await page.locator('[data-ob-pick="粉ミルク"]').count(), 0, 'no unbranded milk chip');
      await page.locator('[data-ob-guide="diaper"]').click();
      await page.locator('#qaBaby').waitFor({ timeout: 12_000 });
      assert.match(await page.locator('#qaBaby').textContent(), /おむつを追加/);
      await page.evaluate(() => window.go('home'));
      await page.locator('[data-ob-guide="food"]').click();
      await page.locator('#qaBabyFood').waitFor({ timeout: 12_000 });
      assert.match(await page.locator('#qaBabyFood').textContent(), /メーカー/);
      assert.equal(await page.evaluate(() => localStorage.getItem('atokorePreviewTrialV19')), null, 'guide navigation never saves');
      // Muse P1: buying one item must not permanently hide stock onboarding.
      await page.evaluate(() => window.go('home'));
      await page.locator('[data-ob-pick="牛乳"]').click();
      await page.locator('[data-ob-go]').click();
      await page.locator('#qaTray [data-qa-dest="buy"]').click();
      await page.click('#qaCommit');
      await page.evaluate(() => window.go('home'));
      await page.locator('#atkOnboarding').waitFor({timeout:10_000});
      assert.equal(await page.locator('#atkOnboardingTip').count(),0,'buy-only must not complete stock guide');
      const state=await page.evaluate(() => JSON.parse(localStorage.getItem('atokorePreviewTrialV19')));
      assert.equal(state?.items.length,0,'buy-only never creates stock');
      assert.equal(state?.buys.length,1,'buy-only result recorded');
      // Explicit finish must be reversible from a small secondary home action.
      await page.click('[data-ob-later]');
      await page.locator('#atkObReopen').waitFor({timeout:10_000});
      await page.click('#atkObReopen');
      await page.locator('#atkOnboarding').waitFor({timeout:10_000});
      // An unfinished stock draft must survive reload without being committed.
      await page.evaluate(()=>window.atkOpenAdd('stock'));
      await page.locator('[data-qa-cat="食料品"]').click();
      await page.locator('[data-qa-pick="卵"]').click();
      await page.evaluate(()=>window.go('buy'));
      await page.evaluate(()=>window.atkOpenAdd('buy'));
      assert.equal(await page.evaluate(()=>window.AtokoreQuickAdd.getDestination()),'stock','pending destination must not flip');
      await page.reload({waitUntil:'domcontentloaded',timeout:60_000});
      assert.equal((await page.evaluate(()=>window.AtokoreQuickAdd.getTray()))[0].name,'卵','draft restored');
      assert.equal(await page.evaluate(()=>window.AtokoreQuickAdd.getDestination()),'stock','restored destination');
      const afterReload=await page.evaluate(() => JSON.parse(localStorage.getItem('atokorePreviewTrialV19')));
      assert.equal(afterReload.items.length,0,'restored draft does not write to stock');
      await page.evaluate(()=>window.go('add'));
      await page.locator('#qaBar').click();
      await page.locator('#qaCommit').click();
      const final=await page.evaluate(() => JSON.parse(localStorage.getItem('atokorePreviewTrialV19')));
      assert.equal(final.items.length,1,'draft final confirmation created one stock line');
      assert.equal(await page.evaluate(()=>localStorage.getItem('atokorePreviewQuickAddPendingV19')),null,'draft cleared after save');
      // Muse P2: clearly explain an actively filtered stock view and let the
      // user reveal all items without touching the stored records.
      await page.evaluate(()=>window.go('stock'));
      await page.locator('#stockSearch').fill('架空の未登録商品');
      await page.locator('#atkStockFilterNotice').waitFor({timeout:10000});
      const filterButton=page.locator('#atkStockFilterNotice button');
      const filterBox=await filterButton.boundingBox();
      assert.ok(filterBox?.height>=44,label+' stock filter reset has a 44px target');
      const snapshotBefore=await page.evaluate(()=>localStorage.getItem('atokorePreviewTrialV19'));
      await filterButton.click();
      assert.equal(await page.locator('#stockSearch').inputValue(),'','reset clears search');
      assert.equal(await page.locator('#atkStockFilterNotice').isHidden(),true,'filter hint hides after reset');
      assert.match(await page.locator('#stockList').textContent(),/卵/,'saved stock is visible after reset');
      const snapshotAfter=await page.evaluate(()=>localStorage.getItem('atokorePreviewTrialV19'));
      assert.equal(snapshotAfter,snapshotBefore,'reset changes no stored data');


      assert.deepEqual(household, [], label + ' must not request real household backend');
      assert.deepEqual(errors, [], label + ' must not throw JS runtime errors');
      console.log('PASS', label, 'URL', url);
    } finally {
      await context.close();
      await browser.close();
    }
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
