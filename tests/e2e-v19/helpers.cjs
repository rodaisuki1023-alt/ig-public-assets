const fs = require('node:fs');
const path = require('node:path');

const APP = '/ig-public-assets/preview-baby-v19/';
const KEY = 'atokorePreviewTrialV19';
const HISTORY = 'atokorePreviewHistoryV19';
const screenDir = process.env.E2E_SCREEN_DIR || path.join(__dirname, 'screenshots');

// Seed storage once per test (sessionStorage guard survives reloads in the same tab).
async function seed(page, entries) {
  await page.addInitScript(values => {
    if (sessionStorage.getItem('__e2eSeeded')) return;
    sessionStorage.setItem('__e2eSeeded', '1');
    for (const [k, v] of Object.entries(values)) localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v));
  }, entries);
}

async function open(page, entries) {
  page.__dialogs = [];
  page.on('dialog', d => { page.__dialogs.push(d.message()); d.type() === 'confirm' ? d.accept() : d.dismiss(); });
  page.__errors = [];
  page.on('pageerror', e => page.__errors.push(String(e)));
  if (entries) await seed(page, entries);
  await page.goto(APP, { waitUntil: 'load' });
  await page.waitForFunction(() => !!document.getElementById('bfNavAdd'));
}

const stored = page => page.evaluate(k => JSON.parse(localStorage.getItem(k) || 'null'), KEY);
const go = (page, p) => page.evaluate(p => window.go(p), p);

async function chooseBaby(page, { kind, brand, type, size, series }) {
  await page.click(`[data-qa-baby="kind"][data-value="${kind}"]`);
  await page.click(`[data-qa-baby="brand"][data-value="${brand}"]`);
  if (kind === 'milk' && series && !['ほほえみ','はいはい','はぐくみ','すこやかM1','バランスミルク'].includes(series)) {
    const follow=page.locator('.qa-followup');
    if (await follow.count()) await follow.locator('summary').click();
    await page.click(`[data-qa-baby="product"][data-value="${brand}|${series}"]`);
  }
  if (type && kind !== 'wipes') await page.click(`[data-qa-baby="type"][data-value="${type}"]`);
  if (size) await page.click(`[data-qa-baby="size"][data-value="${size}"]`);
  if (series && kind !== 'milk') await page.click(`[data-qa-baby="series"][data-value="${series}"]`);
  await page.click('[data-qa-babyadd]');
}

// v36: pending products are saved only from the review screen. Opens it (unless already open)
// and presses the destination-specific final button.
async function commitBatch(page) {
  if (await page.locator('#qaBar').isVisible()) await page.click('#qaBar');
  await page.click('#qaCommit');
}

async function shot(page, testInfo, name) {
  fs.mkdirSync(screenDir, { recursive: true });
  const file = path.join(screenDir, `${testInfo.project.name}-${name}.png`);
  await page.screenshot({ path: file });
  return file;
}

function baseState(extra = {}) {
  return {
    items: [
      { id: 1, name: '牛乳', cat: '食料品', qty: 1, unit: '本', place: '冷蔵庫', expType: '消費期限', exp: '2099-01-01', usage: 1 },
      { id: 2, name: 'パンパース さらさらケア おむつ テープ M', cat: 'ベビー', qty: 2, unit: '袋', place: '収納', expType: '期限なし', exp: '', usage: 1 },
      { id: 3, name: '卵', cat: '食料品', qty: 6, unit: '個', place: '冷蔵庫', usage: 1 },
    ],
    buys: [{ id: 10, name: 'おしりふき詰替', qty: 1, unit: 'パック' }],
    routines: [{ id: 901, name: 'ベビー定番', items: [{ id: 1, name: 'パンパース さらさらケア おむつ テープ M', qty: 2, unit: '袋' }, { id: 2, name: '牛乳', qty: 1, unit: '本' }] }],
    ...extra,
  };
}

// v47: answers the app's own confirmation (#atkConfirm) and returns its text. Native dialogs are
// recorded in page.__dialogs by open(); callers can assert that none appeared.
async function appConfirm(page, accept) {
  const dialog = page.locator('#atkConfirm');
  await dialog.waitFor({ state: 'visible' });
  const text = await dialog.innerText();
  await dialog.locator(accept ? '.atk-confirm-primary' : 'button:not(.atk-confirm-primary)').click();
  return text;
}

module.exports = { APP, KEY, HISTORY, seed, open, stored, go, chooseBaby, commitBatch, shot, baseState, appConfirm };
