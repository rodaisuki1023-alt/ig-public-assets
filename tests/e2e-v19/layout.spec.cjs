const { test, expect } = require('@playwright/test');
const { open, go, chooseBaby, shot, baseState, KEY } = require('./helpers.cjs');

const WIDTHS = [[320, 568], [375, 667], [390, 844], [430, 932]];

// Every visible control between the sticky header and the tab bar must be the topmost element at
// its own centre — i.e. nothing (a floating button, a mis-positioned tray) is drawn over it.
async function coveredControls(page, scope) {
  return page.evaluate(scope => {
    const nav = document.querySelector('.tabs').getBoundingClientRect();
    const head = document.querySelector('.top')?.getBoundingClientRect();
    const minY = head ? head.bottom : 0;
    const out = [];
    for (const el of document.querySelectorAll(scope)) {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height || r.top < minY || r.bottom > nav.top) continue;
      const x = r.left + r.width / 2, y = r.top + r.height / 2;
      // Controls scrolled out of view inside a scrolling list are clipped, not covered.
      let clipped = false;
      for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
        if (getComputedStyle(a).overflowY === 'visible') continue;
        const c = a.getBoundingClientRect();
        if (y < c.top || y > c.bottom || x < c.left || x > c.right) { clipped = true; break; }
      }
      if (clipped) continue;
      const hit = document.elementFromPoint(x, y);
      if (hit && hit !== el && !el.contains(hit)) out.push(`${(el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 12)} <- ${hit.id || hit.className}`);
    }
    return out;
  }, scope);
}

async function layoutFacts(page) {
  return page.evaluate(() => {
    const tabs = [...document.querySelectorAll('.tabs .tab')].filter(t => getComputedStyle(t).display !== 'none');
    const rects = tabs.map(t => t.getBoundingClientRect());
    return {
      overflowX: document.scrollingElement.scrollWidth - innerWidth,
      tabCount: tabs.length,
      tabRows: new Set(rects.map(r => Math.round(r.top))).size,
      tabsInside: rects.every(r => r.left >= -0.5 && r.right <= innerWidth + 0.5),
      floating: !!document.getElementById('bfAddFab'),
    };
  });
}

for (const [width, height] of WIDTHS) {
  test.describe(`${width}px`, () => {
    test.use({ viewport: { width, height } });

    test('all screens fit, tab bar is one row, nothing covers controls', async ({ page }, testInfo) => {
      await open(page, { [KEY]: baseState() });
      for (const p of ['home', 'stock', 'buy', 'premium']) {
        await go(page, p);
        await page.waitForTimeout(80);
        const facts = await layoutFacts(page);
        expect(facts.overflowX, `${p} horizontal scroll`).toBeLessThanOrEqual(0);
        expect(facts.tabCount).toBe(5);
        expect(facts.tabRows, 'tabs on one row').toBe(1);
        expect(facts.tabsInside).toBe(true);
        expect(facts.floating, 'no floating add button').toBe(false);
        expect(await coveredControls(page, '.page.on button, .page.on input'), `${p} covered controls`).toEqual([]);
        await shot(page, testInfo, `${width}-${p}`);
      }
    });

    test('batch tray and save button stay fully on screen above the tab bar', async ({ page }, testInfo) => {
      await open(page, { [KEY]: baseState() });
      await page.click('#bfNavAdd');
      await chooseBaby(page, { kind: 'diaper', brand: 'ムーニー', type: 'パンツ', size: 'L' });
      await chooseBaby(page, { kind: 'milk', brand: '明治', type: '液体', series: 'ほほえみ' });
      await page.locator('#qaCommit').scrollIntoViewIfNeeded();
      const box = await page.evaluate(() => {
        const r = id => document.getElementById(id).getBoundingClientRect();
        const tray = r('qaTray'), commit = r('qaCommit'), nav = document.querySelector('.tabs').getBoundingClientRect();
        return { tray: [tray.left, tray.right, tray.bottom], commit: [commit.left, commit.right, commit.top, commit.bottom], navTop: nav.top, vw: innerWidth };
      });
      expect(box.tray[0]).toBeGreaterThanOrEqual(0);
      expect(box.tray[1]).toBeLessThanOrEqual(box.vw);
      expect(box.commit[0]).toBeGreaterThanOrEqual(0);
      expect(box.commit[1]).toBeLessThanOrEqual(box.vw);
      expect(box.commit[3]).toBeLessThanOrEqual(box.navTop + 0.5);
      expect(await coveredControls(page, '#qaTray button')).toEqual([]);
      await expect(page.locator('#qaTrayDest')).toContainText('保存先：ストック');
      await shot(page, testInfo, `${width}-add-tray`);
      await page.click('#qaCommit');
      await expect(page.locator('#pg-stock')).toHaveClass(/on/);
    });

    test('edit sheet is styled and its save button is reachable', async ({ page }, testInfo) => {
      await open(page, { [KEY]: baseState() });
      await go(page, 'stock');
      await page.locator('#stockList [data-stock-id="2"] .name').click();
      await page.click('.atk-edit-open');
      const style = await page.evaluate(() => {
        const input = document.querySelector('#atkEditForm input[name="name"]');
        const save = document.querySelector('.atk-edit-save');
        return { inputHeight: input.getBoundingClientRect().height, saveBg: getComputedStyle(save).backgroundColor, formDisplay: getComputedStyle(document.getElementById('atkEditForm')).display };
      });
      expect(style.formDisplay).toBe('flex');
      expect(style.inputHeight).toBeGreaterThanOrEqual(44);
      expect(style.saveBg).toBe('rgb(185, 111, 86)');
      await page.locator('.atk-edit-save').scrollIntoViewIfNeeded();
      await expect(page.locator('.atk-edit-save')).toBeInViewport();
      await shot(page, testInfo, `${width}-edit`);
    });
  });
}
