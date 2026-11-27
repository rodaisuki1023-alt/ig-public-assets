// Work (Chromium + WebKit): while the shared undo of purchase A waits for the server, the person buys
// B; when A's answer arrives it used to remove B's undo bar and B's 「直前の「買った」」 too. Every undo
// state now belongs to one purchase: A's answer (success or failure) leaves B's bar, B's button and B's
// own 10-minute window as they are.
const { test, expect } = require('@playwright/test');
const { open, go, stored, baseState, KEY, appConfirm } = require('./helpers.cjs');
const EMU = 'http://127.0.0.1:' + (process.env.E2E_HH_PORT || 4720);
const CFG = { url: EMU, anonKey: 'emu-anon-key', google: true, guest: true, email: false };
const MILK = '牛乳', DIAPER = 'パンパース さらさらケア おむつ テープ M';
async function sharedPhone(browser, info, request, cfg = CFG) {
  await request.post(EMU + '/__test/reset');
  // No Service Worker here: WebKit's page.route does not see requests a Service Worker makes, and these
  // tests must hold the undo request at the network level in both engines.
  const ctx = await browser.newContext({ ...info.project.use, baseURL: info.project.use.baseURL, viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const page = await ctx.newPage(); page.__errors = []; page.on('pageerror', e => page.__errors.push(e.message));
  await page.addInitScript(c => window.ATOKORE_HOUSEHOLD_CONFIG = c, cfg);
  const s = baseState();
  s.buys = [{ id: 20, name: MILK, qty: 1, unit: '本', stockId: 1 }, { id: 21, name: DIAPER, qty: 1, unit: '袋', stockId: 2 }];
  await open(page, { [KEY]: s });
  await go(page, 'premium'); await page.click('#atkHouseholdCard');
  await page.getByRole('button', { name: 'Googleでログイン', exact: true }).click();
  await page.fill('#atkHhName', 'パパ'); await page.getByRole('button', { name: '世帯を作る', exact: true }).click(); await appConfirm(page, true);
  await expect(page.locator('#atkHouseholdStatus')).toHaveText(/^(\d+人で共有中|家族と共有中)$/);
  await page.getByRole('button', { name: '閉じる', exact: true }).click();
  await page.evaluate(() => window.AtokoreHousehold.syncNow());
  await go(page, 'buy');
  return { ctx, page };
}
// Holds the FIRST undo request until released (continue = server answer, fail = network/server error).
async function holdFirstUndo(page) {
  let release; const held = new Promise(r => { release = r; }); let first = true, caught = false;
  await page.route('**/rest/v1/rpc/hh_undo_purchases', async route => {
    if (!first) return route.continue();
    first = false; caught = true;
    const how = await held;
    if (how === 'fail') return route.fulfill({ status: 503, contentType: 'application/json', body: '{"message":"unavailable"}' });
    return route.continue();
  });
  // The test fails unless A's request really was held (never a race that did not happen).
  return async how => { await expect.poll(() => caught, { message: 'the first undo request was held' }).toBe(true); release(how); };
}
const qty = async (page, name) => (await stored(page)).items.find(x => x.name === name).qty;
// A household outside the trial (no reviewed undo SQL for it): the phone repairs the estimate itself, but
// only after the server confirmed the undo (Work 7th). The emulator puts every household in the trial.
async function outsideTrial(page, request) {
  await request.post(EMU + '/__test/sql', { data: { sql: 'DELETE FROM atokore_private.trial_households_v51' } });
  await page.evaluate(() => window.AtokoreHousehold.refreshReceiptSupport());
  expect(await page.evaluate(() => window.AtokoreHousehold.serverUndoEstimate())).toBe(false);
}
const ROW = { [MILK]: 20, [DIAPER]: 21 };
const buy = (page, name) => page.locator(`#buyList [data-buy-id="${ROW[name]}"]`).getByRole('button', { name: /を買った$/ }).click();
const bar = page => page.locator('#atkUndoBar');
const last = page => page.locator('#atkLastPurchaseUndo');

for (const outcome of ['success', 'fail']) test(`A's undo answer (${outcome}) after B was bought leaves B's bar, B's button and B's window`, async ({ browser, request }, info) => {
  test.setTimeout(120000);
  const { ctx, page } = await sharedPhone(browser, info, request);
  try {
    const milk0 = await qty(page, MILK), diaper0 = await qty(page, DIAPER);
    await buy(page, MILK);
    await expect(bar(page)).toBeVisible();
    const release = await holdFirstUndo(page);
    await bar(page).getByRole('button', { name: '元に戻す', exact: true }).click();   // A: waiting for the server
    await buy(page, DIAPER);                                                           // B, meanwhile
    await expect(last(page)).toContainText('パンパース');
    await expect(bar(page)).toBeVisible();
    await release(outcome);
    // A's answer has arrived: B's undo bar and B's button are still there, usable, with no foreign error.
    if (outcome === 'success') await expect.poll(() => qty(page, MILK)).toBe(milk0);
    else await page.waitForTimeout(300);
    await expect(bar(page)).toBeVisible();
    await expect(bar(page).getByRole('button', { name: '元に戻す', exact: true })).toBeEnabled();
    await expect(bar(page)).not.toContainText('戻せませんでした');
    await expect(last(page)).toContainText('パンパース');
    await expect(last(page).getByRole('button', { name: '取り消す' })).toBeEnabled();
    await expect(last(page)).toContainText('あと10分取り消せます');                   // B's own window
    await expect(last(page).locator('[role=alert]')).toHaveCount(0);
    // B can be undone, once.
    await bar(page).getByRole('button', { name: '元に戻す', exact: true }).click();
    await expect.poll(() => qty(page, DIAPER)).toBe(diaper0);
    await expect(last(page)).toHaveCount(0);
    const s = await stored(page);
    expect(s.buys.filter(b => b.name === DIAPER)).toHaveLength(1);                    // the row came back once
    if (outcome === 'fail') { expect(await qty(page, MILK)).toBe(milk0 + 1); expect(s.buys.filter(b => b.name === MILK)).toHaveLength(0); }
    else expect(s.buys.filter(b => b.name === MILK)).toHaveLength(1);
    expect(page.__errors).toEqual([]);
  } finally { await ctx.close(); }
});
test('the same through the shopping-page button, with answers in reversed order and a double tap', async ({ browser, request }, info) => {
  test.setTimeout(120000);
  const { ctx, page } = await sharedPhone(browser, info, request);
  try {
    const milk0 = await qty(page, MILK), diaper0 = await qty(page, DIAPER);
    await buy(page, MILK);
    await go(page, 'home'); await go(page, 'buy');                                     // bar gone; button remains
    await expect(bar(page)).toHaveCount(0);
    const release = await holdFirstUndo(page);
    await last(page).getByRole('button', { name: '取り消す' }).click();               // A via the button: held
    await expect(last(page).getByRole('button', { name: '取り消し中…' })).toBeDisabled();
    await buy(page, DIAPER);                                                           // B replaces the button
    await expect(last(page)).toContainText('パンパース');
    await expect(last(page).getByRole('button', { name: '取り消す' })).toBeEnabled();  // B is not "busy" because of A
    // B's undo answers first (double tap -> one undo), A's answer comes last.
    await last(page).getByRole('button', { name: '取り消す' }).evaluate(b => { b.click(); b.click(); });
    await expect.poll(() => qty(page, DIAPER)).toBe(diaper0);
    await release('success');
    await expect.poll(() => qty(page, MILK)).toBe(milk0);
    const s = await stored(page);
    expect(s.buys.filter(b => b.name === DIAPER)).toHaveLength(1);
    expect(s.buys.filter(b => b.name === MILK)).toHaveLength(1);
    // Diagnostics for the intermittent WebKit case (Work 7th): which purchase a leftover panel shows.
    await page.waitForTimeout(300);
    if (await last(page).count()) console.log('LEFTOVER> ' + JSON.stringify(await last(page).evaluate(e => ({ text: e.innerText, for: e.dataset.atkLastFor, busy: !!e.querySelector('button[disabled]') }))));
    await expect(last(page)).toHaveCount(0);
    expect(page.__errors).toEqual([]);
  } finally { await ctx.close(); }
});
test('A fails through the shopping-page button after B was bought: the error stays with A, B is clean and usable', async ({ browser, request }, info) => {
  test.setTimeout(120000);
  const { ctx, page } = await sharedPhone(browser, info, request);
  try {
    const diaper0 = await qty(page, DIAPER);
    await buy(page, MILK);
    await go(page, 'home'); await go(page, 'buy');
    const release = await holdFirstUndo(page);
    await last(page).getByRole('button', { name: '取り消す' }).click();
    const aFor = await last(page).getAttribute('data-atk-last-for');
    await buy(page, DIAPER);
    // B is registered and shown BEFORE A's answer (a capture/timing failure is told apart from a wrong panel).
    await expect(last(page)).toContainText('パンパース');
    const bFor = await last(page).getAttribute('data-atk-last-for');
    expect(bFor).not.toBe(aFor);
    await release('fail');
    await page.waitForTimeout(500);
    await expect(last(page)).toHaveAttribute('data-atk-last-for', bFor);               // still B's panel
    await expect(last(page)).toContainText('パンパース');
    await expect(last(page)).not.toContainText('牛乳');
    await expect(last(page).locator('[role=alert]')).toHaveCount(0);                  // A's error is not shown on B
    await expect(last(page).getByRole('button', { name: '取り消す' })).toBeEnabled();
    await last(page).getByRole('button', { name: '取り消す' }).click();
    await expect.poll(() => qty(page, DIAPER)).toBe(diaper0);
    expect(page.__errors).toEqual([]);
  } finally { await ctx.close(); }
});
test('outside the trial: server undo succeeded but saving the estimate failed: the confirmed repair is kept and applied on the next return to the app', async ({ browser, request }, info) => {
  test.setTimeout(120000);
  const { ctx, page } = await sharedPhone(browser, info, request);
  try {
    await outsideTrial(page, request);
    // A tracked product, so the purchase also enters the estimate (a tp… field).
    await page.evaluate(() => { const d = new Date(); const day = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      const x = items.find(i => i.id === 2); x.track = { v: 1, base: 60, since: day, perDay: 6, perPack: 60, refillDays: 5, pieceUnit: '枚', confirmedAt: day, t: Date.now() - 60000, seen: [] }; save(); render(); });
    await page.evaluate(() => window.AtokoreHousehold.syncNow());
    const tp = async () => { const x = (await stored(page)).items.find(i => i.id === 2); return Object.keys(x).filter(k => /^tp[0-9a-z]+$/.test(k) && x[k]); };
    await buy(page, DIAPER);
    await expect.poll(tp).toHaveLength(1);
    // Exactly the estimate save fails once (as on a full device).
    await page.evaluate(() => { const orig = Storage.prototype.setItem; let once = true;
      Storage.prototype.setItem = function (...a) { if (once && /revertEstimate/.test(new Error().stack || '')) { once = false; throw new DOMException('full (test)', 'QuotaExceededError'); } return orig.apply(this, a); }; });
    await bar(page).getByRole('button', { name: '元に戻す', exact: true }).click();
    await expect(bar(page)).toContainText('次の同期で自動的にやり直します');
    expect(await tp()).toHaveLength(1);                                                 // not saved yet
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await expect.poll(tp).toHaveLength(0);                                              // repaired
    expect((await stored(page)).buys.filter(b => b.id === 21 || b.name === DIAPER)).toHaveLength(1);
    expect(page.__errors).toEqual([]);
  } finally { await ctx.close(); }
});

// Server-side window (flag purchaseUndoWindowV51, synthetic trial households): the phone still shows the
// button (its own 10 minutes), but the server measures from its own receipt and the phone's purchase
// time; when the server says expired, the app says so and nothing changes.
test('server window on: a fresh undo works through hh_undo_purchases_v51; one the server sees as expired is refused and changes nothing', async ({ browser, request }, info) => {
  test.setTimeout(120000);
  const { ctx, page } = await sharedPhone(browser, info, request, { ...CFG, purchaseUndoWindowV51: true });
  try {
    const rpcs = []; page.on('request', r => { const m = /\/rpc\/(hh_undo_purchases\w*)/.exec(r.url()); if (m) rpcs.push(m[1]); });
    const milk0 = await qty(page, MILK), diaper0 = await qty(page, DIAPER);
    await buy(page, MILK);
    await bar(page).getByRole('button', { name: '元に戻す', exact: true }).click();
    await expect.poll(() => qty(page, MILK)).toBe(milk0);
    expect(rpcs).toEqual(['hh_undo_purchases_v51']);
    // B is bought; on the server it is 11 minutes old (e.g. it arrived late from an offline phone).
    await buy(page, DIAPER);
    await page.evaluate(() => window.AtokoreHousehold.syncNow());
    // Work 8th: the server measures from its own receipt of the purchase: make it 11 minutes old.
    await request.post(EMU + '/__test/sql', { data: { sql: "UPDATE atokore_private.purchase_receipts_v51 SET received_at=now()-interval '11 minutes'" } });
    await bar(page).getByRole('button', { name: '元に戻す', exact: true }).click();
    await expect(bar(page)).toContainText('10分を過ぎたため、取り消せません');
    await page.evaluate(() => window.AtokoreHousehold.syncNow());
    expect(await qty(page, DIAPER)).toBe(diaper0 + 1);                                  // stays bought
    expect((await stored(page)).buys.filter(b => b.id === 21)).toHaveLength(0);
    expect(page.__errors).toEqual([]);
  } finally { await ctx.close(); }
});

// Work 6th (E): with the server window on, only the exact answer {status:'not_enabled'} may fall back to
// the existing RPC. Any other answer of hh_undo_purchases_v51 is refused and nothing is undone.
for (const [label, answer] of [['null', { status: 200, body: 'null' }], ['empty object', { status: 200, body: '{}' }],
  ['not_enabled with extra fields', { status: 200, body: '{"status":"not_enabled","undone":1}' }],
  ['a server error', { status: 500, body: '{"message":"boom"}' }], ['an unknown status', { status: 200, body: '{"status":"later"}' }]])
test(`server window on: an answer of ${label} never falls back to the old RPC and changes nothing`, async ({ browser, request }, info) => {
  test.setTimeout(120000);
  const { ctx, page } = await sharedPhone(browser, info, request, { ...CFG, purchaseUndoWindowV51: true });
  try {
    const rpcs = []; page.on('request', r => { const m = /\/rpc\/(hh_undo_purchases\w*)/.exec(r.url()); if (m) rpcs.push(m[1]); });
    await page.route('**/rest/v1/rpc/hh_undo_purchases_v51', route => route.fulfill({ status: answer.status, contentType: 'application/json', body: answer.body }));
    const milk0 = await qty(page, MILK);
    await buy(page, MILK);
    await bar(page).getByRole('button', { name: '元に戻す', exact: true }).click();
    await expect(bar(page)).toContainText(/確認できませんでした|戻せません|通信/);
    await page.evaluate(() => window.AtokoreHousehold.syncNow());
    expect(rpcs).toEqual(['hh_undo_purchases_v51']);
    expect(await qty(page, MILK)).toBe(milk0 + 1);                                   // still bought
    expect(page.__errors).toEqual([]);
  } finally { await ctx.close(); }
});
test('server window on: the exact not_enabled answer uses the existing RPC (real households, old servers)', async ({ browser, request }, info) => {
  test.setTimeout(120000);
  const { ctx, page } = await sharedPhone(browser, info, request, { ...CFG, purchaseUndoWindowV51: true });
  try {
    const rpcs = []; page.on('request', r => { const m = /\/rpc\/(hh_undo_purchases\w*)/.exec(r.url()); if (m) rpcs.push(m[1]); });
    await page.route('**/rest/v1/rpc/hh_undo_purchases_v51', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{"status":"not_enabled"}' }));
    const milk0 = await qty(page, MILK);
    await buy(page, MILK);
    await bar(page).getByRole('button', { name: '元に戻す', exact: true }).click();
    await expect.poll(() => qty(page, MILK)).toBe(milk0);
    expect(rpcs).toEqual(['hh_undo_purchases_v51', 'hh_undo_purchases']);
    expect(page.__errors).toEqual([]);
  } finally { await ctx.close(); }
});

// Work 6th (forecast): the estimate repair after a shared undo must survive a reload or a force-quit.
async function trackedDiaper(page) {
  await page.evaluate(() => { const d = new Date(); const day = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    const x = items.find(i => i.id === 2); x.track = { v: 1, base: 60, since: day, perDay: 6, perPack: 60, refillDays: 5, pieceUnit: '枚', confirmedAt: day, t: Date.now() - 60000, seen: [] }; save(); render(); });
  await page.evaluate(() => window.AtokoreHousehold.syncNow());
}
// Estimate entries that count (a key left with null is no entry: readEntry(null) is nothing).
const tpOf = async page => { const x = (await stored(page)).items.find(i => i.id === 2); return Object.keys(x).filter(k => /^tp[0-9a-z]+$/.test(k) && x[k]); };
// A reload drops everything held in memory and aborts a request still waiting (like a force-quit).
async function reopen(ctx, page) {
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await page.reload(); await page.waitForFunction(() => window.AtokoreHousehold?.status?.().state === 'synced', null, { timeout: 30000 });
  return page;
}
test('forecast, outside the trial: the estimate save fails after a confirmed undo, then the app is reloaded -> repaired; stock, list and estimate agree', async ({ browser, request }, info) => {
  test.setTimeout(120000);
  const { ctx, page } = await sharedPhone(browser, info, request);
  try {
    await outsideTrial(page, request);
    await trackedDiaper(page);
    const diaper0 = await qty(page, DIAPER);
    await buy(page, DIAPER);
    await expect.poll(() => tpOf(page)).toHaveLength(1);
    await page.evaluate(() => { const orig = Storage.prototype.setItem; let once = true;
      Storage.prototype.setItem = function (...a) { if (once && /revertEstimate/.test(new Error().stack || '')) { once = false; throw new DOMException('full (test)', 'QuotaExceededError'); } return orig.apply(this, a); }; });
    await bar(page).getByRole('button', { name: '元に戻す', exact: true }).click();
    await expect(bar(page)).toContainText('次の同期で自動的にやり直します');
    expect(await tpOf(page)).toHaveLength(1);
    const next = await reopen(ctx, page);                                               // reload: memory is gone
    await expect.poll(() => tpOf(next)).toHaveLength(0);
    expect(await qty(next, DIAPER)).toBe(diaper0);                                     // stock reverted (server)
    expect((await stored(next)).buys.filter(b => b.name === DIAPER)).toHaveLength(1);  // back on the list
    // The confirmed repair is kept until a synced state with nothing pending shows it done, then cleared.
    await expect.poll(async () => { await next.evaluate(() => window.AtokoreHousehold.syncNow()); return next.evaluate(() => localStorage.getItem('atokorePreviewUndoRepairV19')); }).toBe(null);
    expect(next.__errors).toEqual([]);
  } finally { await ctx.close(); }
});
test('forecast: force-quit after the server undid it but before the answer arrived -> repaired on the next start', async ({ browser, request }, info) => {
  test.setTimeout(120000);
  const { ctx, page } = await sharedPhone(browser, info, request);
  try {
    await trackedDiaper(page);
    const diaper0 = await qty(page, DIAPER);
    await buy(page, DIAPER);
    await expect.poll(() => tpOf(page)).toHaveLength(1);
    let reached = false;
    await page.route('**/rest/v1/rpc/hh_undo_purchases', async route => { await route.fetch(); reached = true; /* the answer never arrives */ });
    await bar(page).getByRole('button', { name: '元に戻す', exact: true }).click();
    await expect.poll(() => reached).toBe(true);                                       // the server has undone it
    const next = await reopen(ctx, page);                                               // force-quit and start again
    await expect.poll(() => tpOf(next)).toHaveLength(0);
    expect(await qty(next, DIAPER)).toBe(diaper0);
    expect((await stored(next)).buys.filter(b => b.name === DIAPER)).toHaveLength(1);
    expect(next.__errors).toEqual([]);
  } finally { await ctx.close(); }
});
test('forecast: an undo the server refused leaves no repair behind and the estimate as bought', async ({ browser, request }, info) => {
  test.setTimeout(120000);
  const { ctx, page } = await sharedPhone(browser, info, request);
  try {
    await trackedDiaper(page);
    await buy(page, DIAPER);
    await expect.poll(() => tpOf(page)).toHaveLength(1);
    await page.route('**/rest/v1/rpc/hh_undo_purchases', route => route.fulfill({ status: 400, contentType: 'application/json', body: '{"message":"purchase_undo_expired","code":"22023"}' }));
    await bar(page).getByRole('button', { name: '元に戻す', exact: true }).click();
    await expect(bar(page)).toContainText('10分を過ぎたため');
    const next = await reopen(ctx, page);
    await next.waitForTimeout(500);
    expect(await tpOf(next)).toHaveLength(1);                                          // still bought: estimate kept
    expect(await next.evaluate(() => localStorage.getItem('atokorePreviewUndoRepairV19'))).toBe(null);
    expect(next.__errors).toEqual([]);
  } finally { await ctx.close(); }
});

// Work 7th (forecast): with the reviewed undo SQL the server removes the purchase's estimate entry in the
// SAME transaction as the stock and the shopping row; nothing on the phone has to be remembered or guessed.
test('forecast (Work 7th): server-owned estimate -> one undo changes stock, list and estimate together; a saving failure on the phone does not matter', async ({ browser, request }, info) => {
  test.setTimeout(120000);
  const { ctx, page } = await sharedPhone(browser, info, request);
  try {
    expect(await page.evaluate(() => window.AtokoreHousehold.serverUndoEstimate())).toBe(true);
    await trackedDiaper(page);
    const diaper0 = await qty(page, DIAPER);
    await buy(page, DIAPER);
    await expect.poll(() => tpOf(page)).toHaveLength(1);
    await page.evaluate(() => { const orig = Storage.prototype.setItem;      // the phone cannot save an estimate now
      Storage.prototype.setItem = function (...a) { if (/revertEstimate/.test(new Error().stack || '')) throw new DOMException('full (test)', 'QuotaExceededError'); return orig.apply(this, a); }; });
    await bar(page).getByRole('button', { name: '元に戻す', exact: true }).click();
    await expect(bar(page)).toHaveCount(0);
    const next = await reopen(ctx, page);
    await expect.poll(() => tpOf(next)).toHaveLength(0);
    expect(await qty(next, DIAPER)).toBe(diaper0);
    expect((await stored(next)).buys.filter(b => b.name === DIAPER)).toHaveLength(1);
    expect(await next.evaluate(() => localStorage.getItem('atokorePreviewUndoRepairV19'))).toBe(null);
    expect(next.__errors).toEqual([]);
  } finally { await ctx.close(); }
});
test('forecast (Work 7th): the undo answer arrives late while another tab runs 121 s ahead -> stock, list and estimate still agree', async ({ browser, request }, info) => {
  test.setTimeout(120000);
  const { ctx, page } = await sharedPhone(browser, info, request);
  try {
    await trackedDiaper(page);
    const diaper0 = await qty(page, DIAPER);
    await buy(page, DIAPER);
    await expect.poll(() => tpOf(page)).toHaveLength(1);
    let release; const held = new Promise(r => { release = r; }); let reached = false;
    await page.route('**/rest/v1/rpc/hh_undo_purchases', async route => { const resp = await route.fetch(); reached = true; await held; await route.fulfill({ response: resp }).catch(() => {}); });
    await bar(page).getByRole('button', { name: '元に戻す', exact: true }).click();
    await expect.poll(() => reached).toBe(true);
    // Another tab of the same phone with its clock 121 s ahead runs its start and sync meanwhile.
    const other = await ctx.newPage(); other.__errors = []; other.on('pageerror', e => other.__errors.push(e.message));
    await other.addInitScript(c => window.ATOKORE_HOUSEHOLD_CONFIG = c, CFG);
    await other.clock.install({ time: Date.now() + 121000 });
    await other.goto(page.url()); await other.waitForFunction(() => window.AtokoreHousehold?.status?.().state === 'synced', null, { timeout: 30000 });
    await other.evaluate(() => window.AtokoreHousehold.syncNow());
    release();
    await expect(bar(page)).toHaveCount(0);
    await page.evaluate(() => window.AtokoreHousehold.syncNow());
    for (const p of [page, other]) {
      await p.evaluate(() => window.AtokoreHousehold.syncNow());
      await expect.poll(() => tpOf(p)).toHaveLength(0);
      expect(await qty(p, DIAPER)).toBe(diaper0);
      expect((await stored(p)).buys.filter(b => b.name === DIAPER)).toHaveLength(1);
    }
    expect(page.__errors).toEqual([]); expect(other.__errors).toEqual([]);
  } finally { await ctx.close(); }
});

// Work 8th (WebKit 43/45): B's undo succeeded on the server, A's answer came later, and B's panel stayed.
// Cause: after the server confirmed B, a sync that was not "synced" at that moment (A's work in flight, a
// failed pull) made B's own undo count as failed. The undo's result is the server's answer for THIS
// purchase; the overall sync state only decides when the screen refreshes, never B's outcome.
for (const order of ['B then A', 'A then B']) test(`shopping page (Work 8th): undo answers ${order}, and the sync right after B's undo fails once -> B's panel ends, nothing stays`, async ({ browser, request }, info) => {
  test.setTimeout(120000);
  const { ctx, page } = await sharedPhone(browser, info, request);
  try {
    const milk0 = await qty(page, MILK), diaper0 = await qty(page, DIAPER);
    await buy(page, MILK);
    await go(page, 'home'); await go(page, 'buy');
    const release = await holdFirstUndo(page);
    await last(page).getByRole('button', { name: '取り消す' }).click();               // A: held
    await buy(page, DIAPER);
    await expect(last(page)).toContainText('パンパース');
    if (order === 'A then B') await release('success');
    // The first pull after B's undo answer fails (the overall state is not "synced" for a moment).
    let failNext = false, failed = 0;
    await page.route('**/rest/v1/rpc/hh_pull', async route => { if (failNext && !failed) { failed++; return route.fulfill({ status: 503, contentType: 'application/json', body: '{"message":"unavailable"}' }); } return route.continue(); });
    page.on('response', r => { if (/\/rpc\/hh_undo_purchases$/.test(r.url()) && r.status() === 200) failNext = true; });
    await last(page).getByRole('button', { name: '取り消す' }).click();
    await expect.poll(() => qty(page, DIAPER)).toBe(diaper0);
    if (order === 'B then A') await release('success');
    await expect.poll(() => qty(page, MILK)).toBe(milk0);
    await page.waitForTimeout(500);
    if (await last(page).count()) console.log('LEFTOVER> ' + JSON.stringify(await last(page).evaluate(e => ({ text: e.innerText, for: e.dataset.atkLastFor }))));
    await expect(last(page)).toHaveCount(0);
    await expect(last(page).locator('[role=alert]')).toHaveCount(0);
    expect(page.__errors).toEqual([]);
  } finally { await ctx.close(); }
});

// ---------------------------------------------------------------- Work 8th (E + forecast), both browsers
// E: a purchase made offline and synced after reconnecting used to be undone (HTTP 200) because a cached
// clock ticket travelled with it. Now only the server's receipt of the dedicated purchase command gives undo
// rights; the offline purchase is refused and nothing changes.
test('E (Work 8th): bought offline, synced after reconnecting -> the shared undo is refused; stock and list stay as bought', async ({ browser, request }, info) => {
  test.setTimeout(120000);
  const { ctx, page } = await sharedPhone(browser, info, request, { ...CFG, purchaseUndoWindowV51: true });
  try {
    expect(await page.evaluate(() => window.AtokoreHousehold.serverUndoEstimate())).toBe(true);
    const diaper0 = await qty(page, DIAPER);
    const cmd = []; page.on('request', r => { if (/\/rpc\/hh_push_v51/.test(r.url())) cmd.push(r.postDataJSON?.()?.p_receipt_ops?.length || 0); });
    await ctx.setOffline(true);
    await buy(page, DIAPER);
    await ctx.setOffline(false);
    await page.evaluate(() => window.AtokoreHousehold.syncNow());
    await page.waitForFunction(() => window.AtokoreHousehold.status().state === 'synced');
    expect(cmd.every(n => n === 0), 'the offline purchase is never sent for a receipt').toBe(true);
    await bar(page).getByRole('button', { name: '元に戻す', exact: true }).click();
    await expect(bar(page)).toContainText('サーバーが受け付けた記録がない');
    await page.evaluate(() => window.AtokoreHousehold.syncNow());
    expect(await qty(page, DIAPER)).toBe(diaper0 + 1);
    expect((await stored(page)).buys.filter(b => b.id === 21)).toHaveLength(0);
    // Bought online right away: receipt, undo works (positive control).
    await go(page, 'buy');
    await page.evaluate(() => { buys.push({ id: 22, name: '牛乳', qty: 1, unit: '本', stockId: 1 }); save(); render(); });
    await page.evaluate(() => window.AtokoreHousehold.syncNow());
    const milk0 = await qty(page, MILK);
    await page.locator('#buyList [data-buy-id="22"]').getByRole('button', { name: /を買った$/ }).click();
    await bar(page).getByRole('button', { name: '元に戻す', exact: true }).click();
    await expect.poll(() => qty(page, MILK)).toBe(milk0);
    expect(page.__errors).toEqual([]);
  } finally { await ctx.close(); }
});
// Forecast: buying the same shopping row again after its undo is a new purchase; its estimate entry used to be
// dropped by the server (stock 3, shopping 0, forecast 120 instead of 180). Now the server sees that the new
// purchase owns the entry (sb = that row) and keeps it.
test('forecast (Work 8th): buy, undo, buy the same row again -> stock, list and estimate agree (one entry counted)', async ({ browser, request }, info) => {
  test.setTimeout(120000);
  const { ctx, page } = await sharedPhone(browser, info, request, { ...CFG, purchaseUndoWindowV51: true });
  try {
    await trackedDiaper(page);
    const diaper0 = await qty(page, DIAPER);
    const remaining = p => p.evaluate(() => { const d = new Date(), day = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      return window.AtokoreStockLevels.estimate(items.find(i => i.id === 2), day).remaining; });
    const base = await remaining(page);
    await buy(page, DIAPER);
    await expect.poll(() => tpOf(page)).toHaveLength(1);
    await page.evaluate(() => window.AtokoreHousehold.syncNow());
    const bought = await remaining(page);
    expect(bought).toBeGreaterThan(base);
    await bar(page).getByRole('button', { name: '元に戻す', exact: true }).click();
    await expect(bar(page)).toHaveCount(0);
    await page.evaluate(() => window.AtokoreHousehold.syncNow());
    await expect.poll(() => tpOf(page)).toHaveLength(0);
    expect(await remaining(page)).toBe(base);
    await expect(page.locator('#buyList [data-buy-id="21"]')).toHaveCount(1);          // the row came back
    await buy(page, DIAPER);                                                            // the same row, bought again
    await page.evaluate(() => window.AtokoreHousehold.syncNow());
    const next = await reopen(ctx, page);
    await expect.poll(() => tpOf(next)).toHaveLength(1);
    expect(await qty(next, DIAPER)).toBe(diaper0 + 1);
    expect((await stored(next)).buys.filter(b => b.id === 21)).toHaveLength(0);
    expect(await remaining(next)).toBe(bought);
    expect(next.__errors).toEqual([]);
  } finally { await ctx.close(); }
});

// ---------------------------------------------------------------- Work 9th (⑤), both browsers
// B succeeds while A's answer is delayed and every pull after B's undo fails (503 aimed at B's undo: from its
// answer on): B's stock must be back within 5 s anyway. The confirmed undo answer now carries the server's own
// rows of THAT undo, taken in by change number (idempotent), independent of the overall sync.
for (const order of ['B then A', 'A then B']) test(`shopping page (Work 9th): undo answers ${order}, every pull after B's undo fails -> B's stock is back within 5 s from its own confirmed answer`, async ({ browser, request }, info) => {
  test.setTimeout(120000);
  const { ctx, page } = await sharedPhone(browser, info, request, { ...CFG, purchaseUndoWindowV51: true });
  try {
    const milk0 = await qty(page, MILK), diaper0 = await qty(page, DIAPER);
    await buy(page, MILK);
    await page.evaluate(() => window.AtokoreHousehold.syncNow());
    await go(page, 'home'); await go(page, 'buy');
    let release; const held = new Promise(r => { release = r; }); let firstA = true;
    await page.route('**/rest/v1/rpc/hh_undo_purchases_v51', async route => {
      if (firstA) { firstA = false; await held; }
      return route.continue();
    });
    await last(page).getByRole('button', { name: '取り消す' }).click();               // A: held
    await buy(page, DIAPER);
    await page.evaluate(() => window.AtokoreHousehold.syncNow());
    await expect(last(page)).toContainText('パンパース');
    if (order === 'A then B') release();
    let failPulls = false;
    await page.route('**/rest/v1/rpc/hh_pull', route => failPulls ? route.fulfill({ status: 503, contentType: 'application/json', body: '{"message":"unavailable"}' }) : route.continue());
    page.on('response', r => { if (/\/rpc\/hh_undo_purchases_v51$/.test(r.url()) && r.status() === 200 && !firstA) failPulls = true; });
    const t0 = Date.now();
    await last(page).getByRole('button', { name: '取り消す' }).click();
    await expect.poll(() => qty(page, DIAPER), { timeout: 5000 }).toBe(diaper0);
    const ms = Date.now() - t0;
    console.log('B_STOCK_BACK_MS>' + ms + ' order=' + order);
    if (order === 'B then A') release();
    await expect.poll(() => qty(page, MILK), { timeout: 10000 }).toBe(milk0);
    await expect(last(page)).toHaveCount(0);
    expect(page.__errors).toEqual([]);
  } finally { await ctx.close(); }
});
