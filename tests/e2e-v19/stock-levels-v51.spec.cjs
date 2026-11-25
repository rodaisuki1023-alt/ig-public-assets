// v51 easy 3-level stock (余裕あり / そろそろ / 買う) and the optional detailed estimate, in the real app.
// The counted stock (qty) is never changed by a level or an estimate; "使い切った" asks first.
const { test, expect } = require('@playwright/test');
const { open, go, stored, baseState, KEY, appConfirm } = require('./helpers.cjs');

const level = page => page.locator('#sheet .atk-level');
async function detail(page, id) { await page.evaluate(i => window.atkShowDetail(i), id); await expect(level(page)).toBeVisible(); }
const homeIds = page => page.locator('#atkTasks [data-atk-open]').evaluateAll(n => n.map(x => Number(x.dataset.atkOpen)));

test('old items show the existing rule; setting a level changes home alerts but never the count', async ({ page }) => {
  const initial = baseState();
  await open(page, { [KEY]: initial });
  // Before: milk (qty 1) is the only item at its reorder line; diapers (2) and eggs (6) are fine.
  expect(await homeIds(page)).toEqual([1]);
  await detail(page, 3);
  await expect(level(page).locator('.atk-level-now')).toHaveText('今：余裕あり（在庫数から）');
  expect(await stored(page)).toEqual(initial); // opening writes nothing

  await level(page).locator('[data-atk-level-set="buy"]').click();
  await expect(level(page).locator('[data-atk-level-set="buy"]')).toHaveAttribute('aria-pressed', 'true');
  let s = await stored(page);
  expect(s.items.find(x => x.id === 3)).toMatchObject({ qty: 6, level: 'buy' });
  await page.getByRole('button', { name: '閉じる', exact: true }).click();
  await go(page, 'home');
  expect((await homeIds(page)).sort()).toEqual([1, 3]);

  // "余裕あり" on the low milk removes it from the alerts; the count stays 1.
  await detail(page, 1);
  await level(page).locator('[data-atk-level-set="plenty"]').click();
  await page.getByRole('button', { name: '閉じる', exact: true }).click();
  await go(page, 'home');
  expect(await homeIds(page)).toEqual([3]);
  s = await stored(page);
  expect(s.items.find(x => x.id === 1)).toMatchObject({ qty: 1, level: 'plenty' });

  // Removing the chosen level returns to the old rule exactly.
  await detail(page, 1);
  await level(page).locator('[data-atk-level-clear]').click();
  s = await stored(page);
  expect('level' in s.items.find(x => x.id === 1)).toBe(false);
  expect('levelAt' in s.items.find(x => x.id === 1)).toBe(false);
  expect(page.__errors).toEqual([]);
});

test('detailed estimate from packs, used-up asks before changing the count', async ({ page }) => {
  await open(page, { [KEY]: baseState() });
  await detail(page, 2);
  await level(page).locator('summary').click();
  await level(page).locator('[data-atk-level-packs]').fill('2');
  await level(page).locator('[data-atk-level-per-pack]').fill('60');
  await level(page).locator('[data-atk-level-per-day]').fill('6');
  await level(page).locator('[data-atk-level-start]').click();
  await expect(level(page).locator('.atk-level-estimate')).toContainText('約2袋（120枚）');
  await expect(level(page).locator('.atk-level-estimate')).toContainText('実際の在庫数とは別です');
  let diaper = (await stored(page)).items.find(x => x.id === 2);
  expect(diaper.qty).toBe(2);
  expect(diaper.track).toMatchObject({ v: 1, base: 120, perPack: 60, perDay: 6, refillDays: 5 });

  // Used up: the estimate restarts from 0; the count changes only after confirming.
  await level(page).locator('[data-atk-level-fix="usedUp"]').click();
  await appConfirm(page, false);
  diaper = (await stored(page)).items.find(x => x.id === 2);
  expect(diaper.qty).toBe(2);
  expect(diaper.track.base).toBe(0);
  await level(page).locator('[data-atk-level-fix="usedUp"]').click();
  await appConfirm(page, true);
  await expect.poll(async () => (await stored(page)).items.find(x => x.id === 2).qty).toBe(0);

  // Stop estimating: the track is removed, everything else stays.
  await detail(page, 2);
  await level(page).locator('[data-atk-level-stop]').click();
  diaper = (await stored(page)).items.find(x => x.id === 2);
  expect('track' in diaper).toBe(false);
  expect(diaper.name).toBe('パンパース さらさらケア おむつ テープ M');
  expect(page.__errors).toEqual([]);
});

test('invalid detailed input is explained and nothing is saved; a failed save is undone', async ({ page }) => {
  const initial = baseState();
  await open(page, { [KEY]: initial });
  await detail(page, 2);
  await level(page).locator('summary').click();
  await level(page).locator('[data-atk-level-per-day]').fill('0');
  await level(page).locator('[data-atk-level-start]').click();
  await expect(level(page).locator('.atk-level-error')).toHaveText('1袋あたりの枚数を入力してください');
  await level(page).locator('[data-atk-level-per-pack]').fill('60');
  await level(page).locator('[data-atk-level-start]').click();
  await expect(level(page).locator('.atk-level-error')).toHaveText('1日に使う量は0より大きい数で入力してください');
  expect(await stored(page)).toEqual(initial);

  await page.evaluate(() => { window.__realSave = window.save; window.save = () => false; });
  await level(page).locator('[data-atk-level-set="low"]').click();
  expect(await stored(page)).toEqual(initial);
  expect(await page.evaluate(() => items.find(x => x.id === 2).level)).toBeUndefined();
  await expect(level(page).locator('[data-atk-level-set="low"]')).toHaveAttribute('aria-pressed', 'false');
});

for (const width of [320, 393, 430]) test(`かんたん管理 fits at ${width}px with 44px targets`, async ({ page }) => {
  await page.setViewportSize({ width, height: 800 });
  await open(page, { [KEY]: baseState() });
  await detail(page, 2);
  await level(page).locator('summary').click();
  const facts = await page.evaluate(() => {
    const box = document.querySelector('#sheet .atk-level');
    const targets = [...box.querySelectorAll('button,summary,input')].filter(e => e.getBoundingClientRect().width > 0).map(e => e.getBoundingClientRect().height);
    const r = box.getBoundingClientRect();
    return { min: Math.min(...targets), right: r.right, scroll: document.documentElement.scrollWidth - innerWidth };
  });
  expect(facts.min).toBeGreaterThanOrEqual(44);
  expect(facts.right).toBeLessThanOrEqual(width);
  expect(facts.scroll).toBeLessThanOrEqual(0);
});

// Muse P1-1: 「買った」 must reach the estimate once, move its base date, and be undone with the purchase.
const localDay = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const tracked = (extra = {}) => ({ v: 1, base: 60, since: localDay(), perDay: 6, perPack: 60, refillDays: 5, pieceUnit: '枚', size: null, snoozeUntil: null, confirmedAt: localDay(), ...extra });
function purchaseState(track) {
  const s = baseState();
  s.items[1].track = track;
  s.items[0].track = { v: 1, base: 1, since: localDay(), perDay: 0.5, perPack: null, refillDays: 2, pieceUnit: '本', size: null, snoozeUntil: null, confirmedAt: localDay() };
  s.buys = [{ id: 20, name: 'パンパース さらさらケア おむつ テープ M', qty: 2, unit: '袋', stockId: 2 }, { id: 21, name: '牛乳', qty: 1, unit: '本', stockId: 1 }];
  return s;
}
const est = (page, id) => page.evaluate(([i, d]) => AtokoreStockLevels.estimate(items.find(x => x.id === i), d), [id, localDay()]);
const tp = item => Object.keys(item).filter(k => /^tp[0-9a-z]+$/.test(k) && item[k]);
test('買った adds the bought bags to the estimate once and undo puts both back', async ({ page }) => {
  await open(page, { [KEY]: purchaseState(tracked()) });
  await go(page, 'buy');
  await page.locator('#buyList [data-buy-id="20"]').getByRole('button', { name: /を買った$/ }).click();
  let s = await stored(page), diaper = s.items.find(x => x.id === 2);
  expect(diaper.qty).toBe(4);
  expect(diaper.track).toEqual(tracked());                // the base itself is never rewritten
  expect(tp(diaper)).toHaveLength(1);
  expect(diaper[tp(diaper)[0]]).toMatchObject({ v: 1, q: 2, unit: '袋', u: 120, pu: '枚' });
  expect((await est(page, 2)).remaining).toBe(180);
  expect((await est(page, 1)).remaining).toBe(1);        // the other estimate is untouched
  await detail(page, 2);
  await expect(level(page).locator('.atk-level-estimate')).toContainText('約3袋（180枚）');
  await page.locator('#modal').evaluate(m => m.click());
  await page.getByRole('button', { name: '元に戻す', exact: true }).click();
  s = await stored(page); diaper = s.items.find(x => x.id === 2);
  expect(diaper.qty).toBe(2);
  expect(tp(diaper)).toHaveLength(0);
  expect(diaper.track).toEqual(tracked());
  expect((await est(page, 2)).remaining).toBe(60);
  expect(s.buys.map(b => b.id).sort()).toEqual([20, 21]);
  expect(page.__errors).toEqual([]);
});
test('bulk 買った updates each tracked product once; a repaint or second render adds nothing', async ({ page }) => {
  await open(page, { [KEY]: purchaseState(tracked()) });
  await go(page, 'buy');
  for (const id of [20, 21]) await page.locator(`#buyList [data-buy-id="${id}"] .buyCheck`).check();
  await page.evaluate(() => window.bought());
  const s = await stored(page);
  expect((await est(page, 2)).remaining).toBe(180);
  expect((await est(page, 1)).remaining).toBe(2);   // 1 本 + 1 本 (plain unit)
  await page.evaluate(() => { window.renderStock?.(); window.renderHome?.(); window.renderBuy?.(); });
  expect((await stored(page)).items).toEqual(s.items);
  expect(page.__errors).toEqual([]);
});
test('bags without a known count per bag: nothing is added and the estimate asks to be checked', async ({ page }) => {
  await open(page, { [KEY]: purchaseState(tracked({ perPack: null })) });
  await go(page, 'buy');
  await page.locator('#buyList [data-buy-id="20"]').getByRole('button', { name: /を買った$/ }).click();
  const diaper = (await stored(page)).items.find(x => x.id === 2);
  expect(diaper.qty).toBe(4);
  expect(diaper[tp(diaper)[0]].u).toBe(null);
  expect(await est(page, 2)).toEqual({ status: 'unknown', reason: 'purchase_unit' });
  await detail(page, 2);
  await expect(level(page).locator('.atk-level-estimate')).toContainText('買った分を見積もりに足せませんでした');
  // The person's own check settles it.
  await level(page).locator('[data-atk-level-left]').fill('150');
  await level(page).locator('[data-atk-level-fix="still"]').click();
  expect((await est(page, 2)).remaining).toBe(150);
  expect(page.__errors).toEqual([]);
});
test('if the estimate cannot be saved after a purchase, the count stays bought and the estimate is unchanged', async ({ page }) => {
  await open(page, { [KEY]: purchaseState(tracked()) });
  await go(page, 'buy');
  // Only the write that carries the purchase field fails (the purchase itself was already saved).
  await page.evaluate(() => { const real = Storage.prototype.setItem; Storage.prototype.setItem = function (k, v) { if (/TrialV/.test(k) && /"tp[0-9a-z]+":\{"v":1,"k":"buy:/.test(String(v))) throw new DOMException('quota', 'QuotaExceededError'); return real.call(this, k, v); }; });
  await page.locator('#buyList [data-buy-id="20"]').getByRole('button', { name: /を買った$/ }).click();
  const diaper = (await stored(page)).items.find(x => x.id === 2);
  expect(diaper.qty).toBe(4);
  expect(tp(diaper)).toHaveLength(0);
  expect(await page.evaluate(() => Object.keys(items.find(x => x.id === 2)).filter(k => /^tp/.test(k)).length)).toBe(0);
  expect((await est(page, 2)).remaining).toBe(60);
  expect(page.__errors).toEqual([]);
});
test('a correction can be put back; a chosen level shows its date and asks again when old or contradicted', async ({ page }) => {
  const s = purchaseState(tracked());
  const old = new Date(Date.now() - 40 * 86400000).toISOString();
  s.items[2] = { ...s.items[2], level: 'plenty', levelAt: old };
  s.items.push({ id: 4, name: 'おしりふき', cat: 'ベビー', qty: 0, unit: 'パック', level: 'plenty', levelAt: new Date().toISOString() });
  await open(page, { [KEY]: s });
  await detail(page, 2);
  await level(page).locator('[data-atk-level-fix="usedUp"]').click();
  await appConfirm(page, false);
  expect((await stored(page)).items.find(x => x.id === 2).track.base).toBe(0);
  await level(page).locator('[data-atk-level-undo]').click();
  let diaper = (await stored(page)).items.find(x => x.id === 2);
  expect(diaper.track).toEqual(tracked());
  expect(diaper.qty).toBe(2);
  await expect(level(page).locator('[data-atk-level-undo]')).toHaveCount(0);
  // Old level: dated and asks again; it still decides nothing on its own.
  await detail(page, 3);
  await expect(level(page).locator('.atk-level-detail')).toContainText('全員分を足した量'); // start form of an untracked item
  await expect(level(page).locator('.atk-level-stale')).toContainText('40日たったので');
  await detail(page, 4);
  await expect(level(page).locator('.atk-level-stale')).toContainText('在庫数は0になっています');
  expect((await stored(page)).items.find(x => x.id === 4)).toMatchObject({ qty: 0, level: 'plenty' });
  expect(page.__errors).toEqual([]);
});
