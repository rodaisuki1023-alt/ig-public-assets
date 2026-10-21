const { test, expect } = require('@playwright/test');
const { open, go, KEY, HISTORY, commitBatch } = require('./helpers.cjs');

// Every payload increments window.__xss if it ever executes.
const hit = 'window.__xss=(window.__xss||0)+1';
const P = {
  img: `<img src=x onerror="${hit}">`,
  svg: `"><svg onload="${hit}">`,
  quote: `');${hit};//`,
  attr: `" onfocus="${hit}" autofocus x="`,
  script: `<script>${hit}</script>`,
};
const evilId = `1);${hit};//`;
const state = {
  items: [
    { id: 1, name: '牛乳' + P.img, cat: '食料品', qty: 1, unit: '本' + P.svg, place: '冷蔵庫' + P.img, expType: '消費期限' + P.svg, exp: new Date().toISOString().slice(0, 10), memo: P.script, store: P.attr, usage: 5 },
    { id: 2, name: 'パンパース おむつ テープ M' + P.quote, cat: "ベビー');" + hit + ';//', qty: 0, unit: '袋', place: P.svg, usage: 9 },
    { id: evilId, name: P.attr, cat: P.img, qty: 1, unit: '個', place: 'x', usage: 1 },
  ],
  buys: [{ id: 5, name: '買い物' + P.img, qty: 1, unit: '個' + P.svg }, { id: evilId, name: P.quote, qty: 1, unit: '個' }],
  routines: [{ id: 7, name: 'セット' + P.img, items: [{ id: 8, name: 'おむつ' + P.svg, qty: 1, unit: '袋' + P.img }] }],
};
const history = [{ id: 1, ts: Date.now(), title: P.img, detail: P.svg, type: 'stock', icon: P.script }];

test('stored payloads never execute on any screen, sheet or prediction view', async ({ page }) => {
  await open(page, { [KEY]: state, [HISTORY]: history });
  const views = [
    ['home', () => window.go('home')],
    ['stock', () => window.go('stock')],
    ['chips', () => document.querySelectorAll('#catChips .chip').forEach(c => c.click())],
    ['buy', () => window.go('buy')],
    ['premium', () => window.go('premium')],
    ['predict', () => window.showPremium('predict')],
    ['qr', () => window.showPremium('qr')],
    ['money', () => window.showPremium('money')],
    ['history', () => window.openAtokoreHistory()],
    ['detail', () => window.atkShowDetail(1)],
    ['edit', () => window.atokoreEditStock(1)],
    ['routine', () => window.openRoutine(7)],
    ['set-to-add', () => { window.closeM(); window.go('buy'); document.querySelector('[data-bf-routine-buy="7"]').click(); }],
    ['add-recent', () => { window.AtokoreQuickAdd.setCategory('食料品'); }],
    ['inline-legacy', () => { window.renderHome(); window.renderCatalog(); }],
  ];
  for (const [name, fn] of views) {
    await page.evaluate(fn);
    await page.waitForTimeout(120);
    const result = await page.evaluate(() => ({
      ran: window.__xss || 0,
      injected: [...document.querySelectorAll('*')].filter(el => [...el.attributes].some(a => /^on/i.test(a.name) && a.value.includes('__xss'))).length,
      scripts: [...document.querySelectorAll('script')].filter(s => s.textContent.includes('__xss')).length,
    }));
    expect(result, name).toEqual({ ran: 0, injected: 0, scripts: 0 });
  }
  expect(page.__dialogs).toEqual([]);
});

test('typed input with markup is stored as text and shown as text', async ({ page }) => {
  await open(page);
  await page.click('#bfNavAdd');
  await page.click('[data-qa-cat="食料品"]');
  await page.fill('#qaFree', P.img + 'テスト');
  await page.click('[data-qa-free]');
  await commitBatch(page);
  await go(page, 'stock');
  await page.evaluate(() => { window.showPremium('predict'); });
  await page.waitForTimeout(150);
  expect(await page.evaluate(() => window.__xss || 0)).toBe(0);
  await expect(page.locator('#sheet')).toContainText('<img src=x');
});
