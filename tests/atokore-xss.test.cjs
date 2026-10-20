// Stored XSS regression for the production app: payloads saved in stock, shopping list, sets
// and history must never become live markup on any screen or sheet.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const base = path.resolve(__dirname, '../atokore-live-v125');
const hit = 'window.__xss=(window.__xss||0)+1';
const P = { img: `<img src=x onerror="${hit}">`, svg: `"><svg onload="${hit}">`, quote: `');${hit};//`, script: `<script>${hit}</script>` };
const evilId = `1);${hit};//`;
const today = new Date().toISOString().slice(0, 10);
const state = {
  items: [
    { id: 1, name: '牛乳' + P.img, cat: '食料品', qty: 1, unit: '本' + P.svg, place: '冷蔵庫' + P.img, expType: '消費期限' + P.svg, exp: today, memo: P.script, usage: 5 },
    { id: 2, name: 'おむつ' + P.quote, cat: "ベビー');" + hit + ';//', qty: 0, unit: '袋', place: P.svg, usage: 9 },
    { id: evilId, name: P.svg, cat: P.img, qty: 1, unit: '個', place: 'x', usage: 1 },
  ],
  buys: [{ id: 5, name: '買い物' + P.img, qty: 1, unit: '個' + P.svg }, { id: evilId, name: P.quote, qty: 1, unit: '個' }],
  routines: [{ id: 7, name: 'セット' + P.img, items: [{ id: 8, name: 'おむつ' + P.svg, qty: 1, unit: '袋' + P.img }] }],
};

function boot() {
  const html = fs.readFileSync(path.join(base, 'index.html'), 'utf8');
  const dom = new JSDOM(html, {
    url: 'https://example.invalid/ig-public-assets/', runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(w) {
      w.localStorage.setItem('atokoreTrialV4', JSON.stringify(state));
      w.localStorage.setItem('atokoreHistoryV1', JSON.stringify([{ id: 1, ts: Date.now(), title: P.img, detail: P.svg, icon: P.script }]));
      w.alert = () => {}; w.confirm = () => true;
    },
  });
  const w = dom.window;
  w.HTMLElement.prototype.scrollIntoView = function () {};
  const scripts = [...html.matchAll(/<script src="\.\/([^"?]+)/g)].map(m => m[1]).filter(f => !['family.js', 'pwa.js'].includes(f));
  for (const file of scripts) w.eval(fs.readFileSync(path.join(base, file), 'utf8'));
  return { dom, w };
}

function liveMarkup(w) {
  const doc = w.document;
  return {
    handlers: [...doc.querySelectorAll('*')].filter(el => [...el.attributes].some(a => /^on/i.test(a.name) && a.value.includes('__xss'))).length,
    scripts: [...doc.querySelectorAll('script')].filter(s => s.textContent.includes('__xss')).length,
    ran: w.__xss || 0,
  };
}

test('stored payloads stay text on every screen and sheet', () => {
  const { dom, w } = boot();
  const views = {
    home: () => w.go('home'), stock: () => w.go('stock'), buy: () => w.go('buy'), premium: () => w.go('premium'),
    chips: () => w.document.querySelectorAll('#catChips .chip').forEach(c => c.click()),
    predict: () => w.showPremium('predict'), qr: () => w.showPremium('qr'), money: () => w.showPremium('money'),
    history: () => w.openAtokoreHistory(), routine: () => w.openRoutine(7), detail: () => w.atkShowDetail?.(1),
    legacy: () => { w.renderHome(); w.renderCatalog(); },
  };
  for (const [name, show] of Object.entries(views)) {
    show();
    assert.deepEqual(liveMarkup(w), { handlers: 0, scripts: 0, ran: 0 }, name);
  }
  assert.match(w.document.getElementById('sheet').textContent + w.document.body.textContent, /<img src=x/);
  dom.window.close();
});

test('stored ids and categories cannot break out of inline handlers', () => {
  const { dom, w } = boot();
  w.go('stock');
  const handlers = [...w.document.querySelectorAll('[onclick]')].map(el => el.getAttribute('onclick'));
  assert.ok(handlers.length > 0);
  for (const h of handlers) assert.doesNotMatch(h, /__xss/, h);
  dom.window.close();
});
