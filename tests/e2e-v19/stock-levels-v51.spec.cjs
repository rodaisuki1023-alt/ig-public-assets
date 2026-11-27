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
  await level(page).locator('.atk-level-detail > summary').click();
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
  await level(page).locator('.atk-level-detail > summary').click();
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
  await level(page).locator('.atk-level-detail > summary').click();
  const facts = await page.evaluate(() => {
    const box = document.querySelector('#sheet .atk-level');
    // A radio's touch target is its whole label row (tapping anywhere on it selects it), so the
    // label is measured; the label must contain the radio and be at least 44px too.
    const target = e => e.type === 'radio' ? e.closest('label') : e;
    const shown = [...box.querySelectorAll('button,summary,input')].filter(e => e.getBoundingClientRect().width > 0);
    const targets = shown.map(e => target(e).getBoundingClientRect().height);
    const radios = shown.filter(e => e.type === 'radio').map(e => target(e).getBoundingClientRect().width);
    const r = box.getBoundingClientRect();
    return { min: Math.min(...targets), radios: radios.length, radioMinWidth: Math.min(...radios), right: r.right, scroll: document.documentElement.scrollWidth - innerWidth };
  });
  expect(facts.min).toBeGreaterThanOrEqual(44);
  expect(facts.radios).toBe(2);
  expect(facts.radioMinWidth).toBeGreaterThanOrEqual(200);
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
  await expect(level(page).locator('.atk-level-detail')).toContainText('1日に使う量（全員の合計）'); // start form of an untracked item
  await expect(level(page).locator('.atk-level-stale')).toContainText('40日たったので');
  await detail(page, 4);
  await expect(level(page).locator('.atk-level-stale')).toContainText('在庫数は0になっています');
  expect((await stored(page)).items.find(x => x.id === 4)).toMatchObject({ qty: 0, level: 'plenty' });
  expect(page.__errors).toEqual([]);
});

// Muse N-1: "6" was saved as 5.6 (shown 5.599999904632568). Cause: min="0.1" step="0.5" made the
// allowed values 0.1, 0.6 … 5.6, 6.1, so 6 was a step mismatch and any stepping (arrow key, spin
// button, stepUp/Down, Safari's stepper) snapped it to 5.6; 5.599999904632568 is Math.fround(5.6).
test('daily use: 6 stays 6 (also after stepping), 5.6 stays 5.6, children sum exactly, reload and corrections keep it', async ({ page }) => {
  await open(page, { [KEY]: baseState() });
  await detail(page, 2);
  await level(page).locator('.atk-level-detail > summary').click();
  const day = level(page).locator('[data-atk-level-per-day]');
  await day.fill('6');
  expect(await day.evaluate(e => ({ v: e.value, mismatch: e.validity.stepMismatch }))).toEqual({ v: '6', mismatch: false });
  // Stepping must never move a whole number onto a 0.1-based grid.
  await day.focus(); await page.keyboard.press('ArrowUp'); await page.keyboard.press('ArrowDown');
  expect(await day.inputValue()).toBe('6');
  await level(page).locator('[data-atk-level-packs]').fill('2');
  await level(page).locator('[data-atk-level-per-pack]').fill('60');
  await level(page).locator('[data-atk-level-start]').click();
  let t = (await stored(page)).items.find(x => x.id === 2).track;
  expect(t.perDay).toBe(6);
  await expect(level(page).locator('.atk-level-estimate')).toContainText('1日6枚で計算');
  // Reload: stored and shown as 6.
  await page.reload();
  await detail(page, 2);
  await level(page).locator('.atk-level-edit > summary').click();
  await expect(level(page).locator('[data-atk-level-edit-day]')).toHaveValue('6');
  // An intentional decimal is kept exactly.
  await level(page).locator('[data-atk-level-edit-day]').fill('5.6');
  expect(await level(page).locator('[data-atk-level-edit-day]').evaluate(e => e.validity.stepMismatch)).toBe(false);
  await level(page).locator('[data-atk-level-edit]').click();
  t = (await stored(page)).items.find(x => x.id === 2).track;
  expect(t.perDay).toBe(5.6);
  // Children 4 + 3 = 7 and 2.5 + 3.1 = 5.6 (the sum, not a float artefact).
  await level(page).locator('.atk-level-edit > summary').click();
  await level(page).locator('.atk-level-edit [data-atk-rate-mode][value="children"]').check();
  await level(page).locator('.atk-level-edit [data-atk-level-kid="0"]').fill('4');
  await level(page).locator('.atk-level-edit [data-atk-level-kid="1"]').fill('3');
  await level(page).locator('[data-atk-level-edit]').click();
  await appConfirm(page, true);                                   // the way of entering changes: confirmed
  await expect.poll(async () => (await stored(page)).items.find(x => x.id === 2).track.rateMode).toBe('children');
  t = (await stored(page)).items.find(x => x.id === 2).track;
  expect([t.perDay, t.perChild]).toEqual([7, [4, 3]]);
  await level(page).locator('.atk-level-edit > summary').click();
  await level(page).locator('.atk-level-edit [data-atk-level-kid="0"]').fill('2.5');
  await level(page).locator('.atk-level-edit [data-atk-level-kid="1"]').fill('3.1');
  await level(page).locator('[data-atk-level-edit]').click();
  t = (await stored(page)).items.find(x => x.id === 2).track;
  expect([t.perDay, t.perChild]).toEqual([5.6, [2.5, 3.1]]);
  // A correction keeps a sane rate (no float32 artefacts appear).
  await level(page).locator('[data-atk-level-fix="later"]').click();
  t = (await stored(page)).items.find(x => x.id === 2).track;
  expect(String(t.perDay)).toBe('5.6');
  expect(page.__errors).toEqual([]);
});
test('an older saved artefact (5.599999904632568) is shown as 5.6 and is not rewritten until the person saves', async ({ page }) => {
  const s = baseState();
  s.items[1].track = { v: 1, base: 120, since: localDay(), perDay: 5.599999904632568, perPack: 60, refillDays: 5, pieceUnit: '枚', confirmedAt: localDay() };
  await open(page, { [KEY]: s });
  await detail(page, 2);
  await expect(level(page).locator('.atk-level-estimate')).toContainText('1日5.6枚で計算');
  await level(page).locator('.atk-level-edit > summary').click();
  await expect(level(page).locator('[data-atk-level-edit-day]')).toHaveValue('5.6');
  expect((await stored(page)).items.find(x => x.id === 2).track.perDay).toBe(5.599999904632568);
  expect(page.__errors).toEqual([]);
});

const diagnose = page => page.evaluate(() => ({ saveFailures: window.__atokoreSaveFailures || 0, lock: !!window.__atokoreStorageLock,
  journal: { active: AtokoreJournal.active(), failed: AtokoreJournal.failed?.(), pending: AtokoreJournal.pendingCount?.(), rev: AtokoreJournal.committedRev?.() },
  buys: buys.map(b => b.id), milk: items.find(x => x.id === 1)?.qty, banner: document.querySelector('.atk-safety-text')?.textContent || '',
  toast: document.getElementById('stableToastV125h')?.textContent || '', page: document.querySelector('.page.on')?.id, now: Date.now(), perf: performance.now(),
  sw: !!navigator.serviceWorker?.controller, nav: performance.getEntriesByType('navigation').length }));
// Muse N-3: the undo bar disappears after ~20 s or when the screen changes; the last purchase can
// still be undone from the shopping page for 10 minutes, once, restoring count and estimate.
test('last purchase: undo still possible after leaving the screen, once, count and estimate restored; not after 10 minutes', async ({ page }) => {
  await page.clock.install();
  await open(page, { [KEY]: purchaseState(tracked()) });
  await go(page, 'buy');
  await page.locator('#buyList [data-buy-id="20"]').getByRole('button', { name: /を買った$/ }).click();
  expect((await est(page, 2)).remaining).toBe(180);
  await go(page, 'stock'); await go(page, 'home');
  await expect(page.locator('#atkUndoBar')).toHaveCount(0);          // the bar is gone
  await go(page, 'buy');
  const last = page.locator('#atkLastPurchaseUndo');
  await expect(last).toContainText('直前の「買った」');
  await last.getByRole('button', { name: '取り消す' }).click();
  await expect(last).toHaveCount(0);
  const s = await stored(page), diaper = s.items.find(x => x.id === 2);
  expect(diaper.qty).toBe(2);
  expect((await est(page, 2)).remaining).toBe(60);
  expect(s.buys.map(b => b.id).sort()).toEqual([20, 21]);
  // A later purchase is offered for 10 minutes only.
  await page.locator('#buyList [data-buy-id="21"]').getByRole('button', { name: /を買った$/ }).click();
  await go(page, 'home'); await go(page, 'buy');
  // Failed on CI Chromium only (2 of 4 runs of #117), never locally (60+ runs, also at 8x CPU throttling).
  // On failure, say what the app was doing so the cause can be found instead of guessed.
  try { await expect(last).toBeVisible(); }
  catch (err) { console.log('DIAG last-purchase ' + JSON.stringify(await diagnose(page))); throw err; }
  await page.clock.fastForward('10:30');
  await go(page, 'home'); await go(page, 'buy');
  await expect(last).toHaveCount(0);
  expect((await stored(page)).items.find(x => x.id === 1).qty).toBe(2);   // not undone
  expect(page.__errors).toEqual([]);
});
test('last purchase: the bar and the shopping-page button never undo the same purchase twice', async ({ page }) => {
  await open(page, { [KEY]: purchaseState(tracked()) });
  await go(page, 'buy');
  await page.locator('#buyList [data-buy-id="20"]').getByRole('button', { name: /を買った$/ }).click();
  await page.getByRole('button', { name: '元に戻す', exact: true }).click();
  await expect(page.locator('#atkLastPurchaseUndo')).toHaveCount(0);
  const s = await stored(page);
  expect(s.items.find(x => x.id === 2).qty).toBe(2);
  expect(s.buys.filter(b => b.id === 20)).toHaveLength(1);
  expect(page.__errors).toEqual([]);
});

// Work P1: the deadline is decided when the undo starts, not only when the button is drawn. A page
// left open (timers frozen in the background, simulated with setSystemTime, which moves the clock
// without running timers) must not undo at 10:00 or later, from the button or from the bar.
async function buyDiaper(page) {
  await page.clock.install();
  await open(page, { [KEY]: purchaseState(tracked()) });
  await go(page, 'buy');
  // Stop the page clock BEFORE the purchase: from then on only fastForward/setSystemTime move it, so the
  // purchase time is exact. With the clock left running, a loaded machine spent over a second between
  // fastForward('09:59') and the tap, and the deadline passed in real time (reproduced under parallel load).
  const t0 = (await page.evaluate(() => Date.now())) + 1000;
  await page.clock.pauseAt(t0);
  await page.locator('#buyList [data-buy-id="20"]').getByRole('button', { name: /を買った$/ }).click();
  expect((await est(page, 2)).remaining).toBe(180);
  return t0;
}
async function unchangedAfterRefusal(page) {
  const s = await stored(page);
  expect(s.items.find(x => x.id === 2).qty).toBe(4);
  expect((await est(page, 2)).remaining).toBe(180);
  expect(s.buys.map(b => b.id)).toEqual([21]);
}
test('last purchase deadline: 9:59 still undoes (count, estimate and the shopping row come back)', async ({ page }) => {
  await buyDiaper(page);
  await page.clock.fastForward('09:59');
  const last = page.locator('#atkLastPurchaseUndo');
  await expect(last).toContainText('あと1分取り消せます');
  await last.getByRole('button', { name: '取り消す' }).click();
  await expect(last).toHaveCount(0);
  const s = await stored(page);
  expect(s.items.find(x => x.id === 2).qty).toBe(2);
  expect((await est(page, 2)).remaining).toBe(60);
  expect(s.buys.map(b => b.id).sort()).toEqual([20, 21]);
  expect(page.__errors).toEqual([]);
});
for (const at of ['10:00', '10:01']) {
  test(`last purchase deadline: a button left on screen is refused at ${at} and changes nothing`, async ({ page }) => {
    const t0 = await buyDiaper(page);
    const last = page.locator('#atkLastPurchaseUndo');
    await expect(last).toBeVisible();
    const [m, s] = at.split(':').map(Number);
    await page.clock.setSystemTime(t0 + (m * 60 + s) * 1000);       // no timer runs: the stale button stays
    await expect(last).toBeVisible();
    await last.getByRole('button', { name: '取り消す' }).click();
    await expect(page.locator('#stableToastV125h')).toContainText('10分を過ぎたため、取り消せません');
    await expect(last).toHaveCount(0);
    await unchangedAfterRefusal(page);
    expect(page.__errors).toEqual([]);
  });
}
test('last purchase deadline: the 20-second bar, if frozen on screen, is refused after 10:00 too', async ({ page }) => {
  const t0 = await buyDiaper(page);
  const bar = page.locator('#atkUndoBar');
  await expect(bar).toBeVisible();
  await page.clock.setSystemTime(t0 + 601000);
  await bar.getByRole('button', { name: '元に戻す', exact: true }).click();
  await expect(bar).toContainText('10分を過ぎたため、取り消せません');
  await unchangedAfterRefusal(page);
  // The refusal is final: pressing again does not undo either.
  await bar.getByRole('button', { name: '元に戻す', exact: true }).click();
  await unchangedAfterRefusal(page);
  expect(page.__errors).toEqual([]);
});
test('last purchase deadline: staying on the screen removes the button at 10:00; returning from the background re-checks', async ({ page }) => {
  const t0 = await buyDiaper(page);
  const last = page.locator('#atkLastPurchaseUndo');
  await page.clock.fastForward('09:59');
  await expect(last).toBeVisible();
  await page.clock.fastForward('00:01');                          // the deadline timer fires on screen
  await expect(last).toHaveCount(0);
  await unchangedAfterRefusal(page);
  // A second purchase; the phone sleeps past the deadline (timers frozen) and comes back.
  await page.locator('#buyList [data-buy-id="21"]').getByRole('button', { name: /を買った$/ }).click();
  await expect(last).toBeVisible();
  const t1 = await page.evaluate(() => Date.now());
  await page.clock.setSystemTime(t1 + 600000);
  await expect(last).toBeVisible();
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(last).toHaveCount(0);
  expect((await stored(page)).items.find(x => x.id === 1).qty).toBe(2);   // the milk purchase stays
  expect(page.__errors).toEqual([]);
});
test('last purchase deadline: setting the phone clock back does not extend the window', async ({ page }) => {
  await buyDiaper(page);
  const last = page.locator('#atkLastPurchaseUndo');
  await page.clock.runFor(360000);                                   // 6:00 really passed
  const t6 = await page.evaluate(() => Date.now());
  await page.clock.setSystemTime(t6 - 300000);                       // the clock is moved back 5 minutes
  await page.clock.runFor(1000);
  await expect(last).toBeVisible();                                  // still within 10 minutes (6:01)
  await page.clock.runFor(240000);                                   // 10:01 really passed; the wall clock says 5:01
  await expect(last).toHaveCount(0);
  await unchangedAfterRefusal(page);
  expect(page.__errors).toEqual([]);
});
test('last purchase deadline: a double tap starts one undo only', async ({ page }) => {
  await buyDiaper(page);
  const button = page.locator('#atkLastPurchaseUndo').getByRole('button', { name: '取り消す' });
  await button.evaluate(b => { b.click(); b.click(); });
  await expect(page.locator('#atkLastPurchaseUndo')).toHaveCount(0);
  const s = await stored(page);
  expect(s.items.find(x => x.id === 2).qty).toBe(2);
  expect(s.buys.filter(b => b.id === 20)).toHaveLength(1);
  expect(page.__errors).toEqual([]);
});

// Muse N-1b: with per-child amounts saved, a typed total was silently ignored. The way of entering
// is now an explicit choice; the chosen numbers are always used and the others are kept.
async function rateState(page, track) {
  const s = baseState();
  s.items[1].track = { v: 1, base: 120, since: localDay(), perPack: 60, refillDays: 5, pieceUnit: '枚', confirmedAt: localDay(), ...track };
  await open(page, { [KEY]: s });
  await detail(page, 2);
  await level(page).locator('.atk-level-edit > summary').click();
}
const trackOf = async page => (await stored(page)).items.find(x => x.id === 2).track;
test('daily use mode: older per-child data opens as 子どもごと; switching to 合計 uses the typed 6, keeps 4＋3, survives reload, and can be put back', async ({ page }) => {
  await rateState(page, { perDay: 7, perChild: [4, 3] });          // saved before the mode existed
  const ed = level(page).locator('.atk-level-edit');
  await expect(ed.locator('[data-atk-rate-mode][value="children"]')).toBeChecked();
  await expect(ed.locator('[data-atk-rate-sum]')).toHaveText('計算に使う量：1日7枚（4＋3）');
  await expect(ed.locator('[data-atk-level-edit-day]')).toBeHidden();
  await ed.locator('[data-atk-rate-mode][value="total"]').check();
  await expect(ed.locator('[data-atk-level-kid="0"]')).toBeHidden();
  await expect(ed.locator('[data-atk-level-edit-day]')).toHaveValue('7');     // the current total, visible
  await ed.locator('[data-atk-level-edit-day]').fill('6');
  await expect(ed.locator('[data-atk-rate-sum]')).toContainText('計算に使う量：1日6枚（合計で入力）');
  await expect(ed.locator('[data-atk-rate-sum]')).toContainText('子どもごとの量（4＋3）は消さずに残しています');
  await ed.locator('[data-atk-level-edit]').click();
  const text = await appConfirm(page, true);
  expect(text).toContain('1日6枚');
  expect(text).toContain('（4＋3）は消さずに残します');
  await expect.poll(async () => (await trackOf(page)).perDay).toBe(6);
  expect(await trackOf(page)).toMatchObject({ perDay: 6, perChild: [4, 3], rateMode: 'total' });
  await expect(level(page).locator('.atk-level-estimate')).toContainText('1日6枚で計算');
  await page.reload();
  await detail(page, 2);
  await expect(level(page).locator('.atk-level-estimate')).toContainText('1日6枚で計算');
  await level(page).locator('.atk-level-edit > summary').click();
  await expect(ed.locator('[data-atk-rate-mode][value="total"]')).toBeChecked();
  await expect(ed).toContainText('1日6枚（合計で入力）');
  // Switching back restores the kept children's amounts (nothing was lost).
  await ed.locator('[data-atk-rate-mode][value="children"]').check();
  await expect(ed.locator('[data-atk-level-kid="0"]')).toHaveValue('4');
  await expect(ed.locator('[data-atk-level-kid="1"]')).toHaveValue('3');
  expect(page.__errors).toEqual([]);
});
test('daily use mode: 合計 → 子どもごと, cancel changes nothing, confirm uses 4＋3=7, then 変える前の設定に戻す restores 6', async ({ page }) => {
  await rateState(page, { perDay: 6, rateMode: 'total' });
  const ed = level(page).locator('.atk-level-edit');
  await expect(ed.locator('[data-atk-rate-mode][value="total"]')).toBeChecked();
  await ed.locator('[data-atk-rate-mode][value="children"]').check();
  await ed.locator('[data-atk-level-kid="0"]').fill('4');
  await ed.locator('[data-atk-level-kid="1"]').fill('3');
  await expect(ed.locator('[data-atk-rate-sum]')).toHaveText('計算に使う量：1日7枚（4＋3）');
  await ed.locator('[data-atk-level-edit]').click();
  await appConfirm(page, false);
  expect(await trackOf(page)).toMatchObject({ perDay: 6, rateMode: 'total' });
  await ed.locator('[data-atk-level-edit]').click();
  await appConfirm(page, true);
  await expect.poll(async () => (await trackOf(page)).perDay).toBe(7);
  expect(await trackOf(page)).toMatchObject({ perDay: 7, perChild: [4, 3], rateMode: 'children' });
  await level(page).locator('[data-atk-level-undo]').click();
  await expect.poll(async () => (await trackOf(page)).perDay).toBe(6);
  expect((await trackOf(page)).rateMode).toBe('total');
  expect(page.__errors).toEqual([]);
});
test('daily use mode: 5.6 typed as the total stays 5.6; an empty 子どもごと is refused with a message, never ignored', async ({ page }) => {
  await rateState(page, { perDay: 6, rateMode: 'total' });
  const ed = level(page).locator('.atk-level-edit');
  await ed.locator('[data-atk-level-edit-day]').fill('5.6');
  await ed.locator('[data-atk-level-edit]').click();
  await expect.poll(async () => (await trackOf(page)).perDay).toBe(5.6);
  await level(page).locator('.atk-level-edit > summary').click();
  await ed.locator('[data-atk-rate-mode][value="children"]').check();
  await ed.locator('[data-atk-level-edit]').click();
  await expect(level(page).locator('.atk-level-error')).toContainText('子どもごとの量を、1人以上');
  expect((await trackOf(page)).perDay).toBe(5.6);
  expect(page.__errors).toEqual([]);
});
test('daily use per child: 0.125 is kept exactly (shown, edited and saved without rounding)', async ({ page }) => {
  await rateState(page, { perDay: 0.25, perChild: [0.125, 0.125], rateMode: 'children' });
  const ed = level(page).locator('.atk-level-edit');
  await expect(ed.locator('[data-atk-level-kid="0"]')).toHaveValue('0.125');
  await expect(ed.locator('[data-atk-rate-sum]')).toHaveText('計算に使う量：1日0.25枚（0.125＋0.125）');
  await ed.locator('[data-atk-level-kid="1"]').fill('0.1');
  await ed.locator('[data-atk-level-edit]').click();
  await expect.poll(async () => (await trackOf(page)).perDay).toBe(0.225);
  expect((await trackOf(page)).perChild).toEqual([0.125, 0.1]);
  expect(page.__errors).toEqual([]);
});
