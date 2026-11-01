// v49 receipt registration while the household is shared (local emulator running the real migrations).
// Device A registers a receipt (text path, deterministic) that adds 2 to a registered product, while
// device B adds 1 to the same product before syncing. After syncing, both devices must show every change
// once: no double addition from the double-tapped final button, and B's change is not lost.
const { test, expect } = require('@playwright/test');
const { open, go, stored, baseState, KEY, appConfirm } = require('./helpers.cjs');

const EMU = 'http://127.0.0.1:' + (process.env.E2E_HH_PORT || 4720);
const CFG = { url: EMU, anonKey: 'emu-anon-key', google: true, guest: true, email: false };
const RECEIPT = `テストマート
2026/10/27 12:54
牛乳 1000ml
2コ X 単218 ¥436
テストクッキー ¥198
値引 -20
小計 3点 ¥614
合計 ¥663`;

test('a receipt registered on one device and a partner change on another both count once', async ({ browser, request }, info) => {
  test.setTimeout(120000);
  await request.post(EMU + '/__test/reset');
  async function device(state) { const ctx = await browser.newContext({ ...info.project.use, baseURL: info.project.use.baseURL }); const page = await ctx.newPage(); await page.addInitScript(c => window.ATOKORE_HOUSEHOLD_CONFIG = c, CFG); await open(page, { [KEY]: state }); return { ctx, page }; }
  const a = await device(baseState()), b = await device({ items: [], buys: [], routines: [] });
  try {
    await go(a.page, 'premium'); await a.page.click('#atkHouseholdCard'); await a.page.getByRole('button', { name: 'Googleでログイン', exact: true }).click();
    await a.page.fill('#atkHhName', 'パパ'); await a.page.getByRole('button', { name: '世帯を作る', exact: true }).click(); await appConfirm(a.page, true);
    await expect(a.page.locator('#atkHouseholdStatus')).toHaveText(/^(\d+人で共有中|家族と共有中)$/);
    await a.page.getByRole('button', { name: /家族を招待する/ }).click(); const link = await a.page.locator('#atkHhInviteLink').inputValue();
    await b.page.goto(link); await b.page.fill('#atkHhGuestName', 'ママ'); await b.page.getByRole('button', { name: 'Googleなしで共有に参加する', exact: true }).click();
    await expect(b.page.locator('#atkHouseholdStatus')).toHaveText(/^(\d+人で共有中|家族と共有中)$/);
    await a.page.getByRole('button', { name: '閉じる', exact: true }).click(); await b.page.getByRole('button', { name: '閉じる', exact: true }).click();
    await b.page.evaluate(() => AtokoreHousehold.syncNow());
    const milkBefore = (await stored(b.page)).items.find(x => x.name === '牛乳').qty;

    // B adds one milk and has not synced yet.
    await b.page.evaluate(() => { const x = items.find(x => x.name === '牛乳'); adj(x.id, 1); });

    // A registers the receipt: milk ×2 linked to the registered milk, and one new product.
    await go(a.page, 'premium');
    await a.page.locator('#pg-premium .premium').filter({ hasText: 'レシート一括補充' }).click();
    await a.page.locator('summary').filter({ hasText: 'レシートの文字を貼って読み取る' }).click();
    await a.page.fill('#receiptManualText', RECEIPT);
    await a.page.getByRole('button', { name: '商品名を解析' }).click();
    await expect(a.page.locator('#receiptCount')).toContainText('一致しています');
    const milkRow = a.page.locator('[data-receipt-row]').filter({ has: a.page.locator('select[aria-label$="に対応する商品"]') }).first();
    await expect(milkRow.locator('input[type=number]')).toHaveValue('2');
    await milkRow.locator('select[aria-label$="に対応する商品"]').selectOption({ label: '登録済み：牛乳' });
    await a.page.locator('#receiptApplyBtn').click();
    await a.page.locator('#qaCommit').dblclick();
    await expect(a.page.locator('#pg-stock')).toHaveClass(/on/);

    for (let i = 0; i < 2; i++) { await a.page.evaluate(() => AtokoreHousehold.syncNow()); await b.page.evaluate(() => AtokoreHousehold.syncNow()); }
    await a.page.evaluate(() => AtokoreHousehold.syncNow());
    for (const d of [a, b]) {
      const s = await stored(d.page);
      // Milk with a best-before date gets its own row for a new purchase (quick-add keeps lots with dates
      // apart): the registered row has B's +1, the receipt's 2 are one new row, nothing twice.
      const milk = s.items.filter(x => x.name === '牛乳').map(x => x.qty).sort();
      expect(milk).toEqual([2, milkBefore + 1].sort());
      expect(milk.reduce((t, q) => t + q, 0)).toBe(milkBefore + 2 + 1);
      expect(s.items.filter(x => x.name === 'テストクッキー')).toHaveLength(1);
      expect(s.items.find(x => x.name === 'テストクッキー').qty).toBe(1);
    }
    expect(a.page.__errors).toEqual([]); expect(b.page.__errors).toEqual([]);
  } finally { await a.ctx.close(); await b.ctx.close(); }
});

// ---- v49 audit: the same receipt imported by two family members (fingerprint of store, date, time,
// total and receipt number; synthetic receipt text).
const FACT_RECEIPT = (time = '12:54', day = '27') => `テストストア
登録番号 T1234567890123
2026年10月${day}日(火) ${time}
レシートNo 4321
テストせんべい ¥198
小計 1点 ¥198
合計 ¥213`;
async function pair(browser, request, info) {
  await request.post(EMU + '/__test/reset');
  async function device(state) { const ctx = await browser.newContext({ ...info.project.use, baseURL: info.project.use.baseURL }); const page = await ctx.newPage(); await page.addInitScript(c => window.ATOKORE_HOUSEHOLD_CONFIG = c, CFG); await open(page, { [KEY]: state }); return { ctx, page }; }
  const a = await device(baseState()), b = await device({ items: [], buys: [], routines: [] });
  await go(a.page, 'premium'); await a.page.click('#atkHouseholdCard'); await a.page.getByRole('button', { name: 'Googleでログイン', exact: true }).click();
  await a.page.fill('#atkHhName', 'パパ'); await a.page.getByRole('button', { name: '世帯を作る', exact: true }).click(); await appConfirm(a.page, true);
  await expect(a.page.locator('#atkHouseholdStatus')).toHaveText(/^(\d+人で共有中|家族と共有中)$/);
  await a.page.getByRole('button', { name: /家族を招待する/ }).click(); const link = await a.page.locator('#atkHhInviteLink').inputValue();
  await b.page.goto(link); await b.page.fill('#atkHhGuestName', 'ママ'); await b.page.getByRole('button', { name: 'Googleなしで共有に参加する', exact: true }).click();
  await expect(b.page.locator('#atkHouseholdStatus')).toHaveText(/^(\d+人で共有中|家族と共有中)$/);
  await a.page.getByRole('button', { name: '閉じる', exact: true }).click(); await b.page.getByRole('button', { name: '閉じる', exact: true }).click();
  return { a, b };
}
async function readTextOn(page, text) {
  await go(page, 'premium');
  await page.locator('#pg-premium .premium').filter({ hasText: 'レシート一括補充' }).click();
  await page.locator('summary').filter({ hasText: 'レシートの文字を貼って読み取る' }).click();
  await page.fill('#receiptManualText', text);
  await page.getByRole('button', { name: '商品名を解析' }).click();
  await expect(page.getByRole('heading', { name: '🧾 読み取り結果の確認' })).toBeVisible();
}
const senbei = async page => (await stored(page)).items.filter(x => x.name === 'テストせんべい').reduce((t, x) => t + x.qty, 0);

test('family: an imported receipt warns the other member with name and state; cancel adds nothing, "different purchase" adds once', async ({ browser, request }, info) => {
  test.setTimeout(150000);
  const { a, b } = await pair(browser, request, info);
  try {
    await readTextOn(a.page, FACT_RECEIPT());
    await a.page.locator('#receiptApplyBtn').click();
    await a.page.locator('#qaCommit').click();
    await expect(a.page.locator('#pg-stock')).toHaveClass(/on/);
    for (let i = 0; i < 2; i++) { await a.page.evaluate(() => AtokoreHousehold.syncNow()); await b.page.evaluate(() => AtokoreHousehold.syncNow()); }
    expect(await senbei(b.page)).toBe(1);
    // B reads the same receipt (re-shot, or the same paper): warned before the confirmation screen.
    await readTextOn(b.page, FACT_RECEIPT());
    await b.page.locator('#receiptApplyBtn').click();
    await expect(b.page.locator('#atkConfirmTitle')).toHaveText('同じレシートを家族が取り込み済みです');
    await expect(b.page.locator('#atkConfirmNote')).toContainText('パパさん');
    await b.page.locator('#atkConfirm').getByRole('button', { name: 'キャンセル' }).click();
    await expect(b.page.locator('#qaTray')).toBeHidden();
    expect(await senbei(b.page)).toBe(1);
    // Only an explicit choice imports it again (a different purchase with an identical receipt is rare but real).
    await b.page.locator('#receiptApplyBtn').click();
    await b.page.locator('#atkConfirm .atk-confirm-primary').click();
    await b.page.locator('#qaCommit').click();
    await expect(b.page.locator('#pg-stock')).toHaveClass(/on/);
    expect(await senbei(b.page)).toBe(2);
    expect(a.page.__errors).toEqual([]); expect(b.page.__errors).toEqual([]);
  } finally { await a.ctx.close(); await b.ctx.close(); }
});

test('family: while one member is importing, the other is told it is in progress; a different day is not a duplicate', async ({ browser, request }, info) => {
  test.setTimeout(150000);
  const { a, b } = await pair(browser, request, info);
  try {
    await readTextOn(a.page, FACT_RECEIPT());
    await a.page.locator('#receiptApplyBtn').click();
    await expect(a.page.locator('#qaTray')).toBeVisible(); // A is on the confirmation screen, not saved yet
    await readTextOn(b.page, FACT_RECEIPT());
    await b.page.locator('#receiptApplyBtn').click();
    await expect(b.page.locator('#atkConfirmTitle')).toHaveText('同じレシートを家族が取り込み中です');
    await b.page.locator('#atkConfirm').getByRole('button', { name: 'キャンセル' }).click();
    // Cancelling keeps the review open (nothing saved); it is closed before reading the next receipt.
    await expect(b.page.getByRole('heading', { name: '🧾 読み取り結果の確認' })).toBeVisible();
    await b.page.locator('#sheet .close').click();
    await a.page.locator('#qaCommit').click();
    await expect(a.page.locator('#pg-stock')).toHaveClass(/on/);
    // The same products bought another day: no warning.
    await readTextOn(b.page, FACT_RECEIPT('18:02', '28'));
    await b.page.locator('#receiptApplyBtn').click();
    await expect(b.page.locator('#qaTray')).toBeVisible();
    await expect(b.page.locator('#atkConfirm')).toHaveCount(0);
    await b.page.locator('#qaCommit').click();
    await expect(b.page.locator('#pg-stock')).toHaveClass(/on/);
    expect(await senbei(b.page)).toBe(1);
    expect(a.page.__errors).toEqual([]); expect(b.page.__errors).toEqual([]);
  } finally { await a.ctx.close(); await b.ctx.close(); }
});

test('family: imported offline, the check runs when the connection is back and only warns; stock is not changed automatically', async ({ browser, request }, info) => {
  test.setTimeout(150000);
  const { a, b } = await pair(browser, request, info);
  try {
    await readTextOn(a.page, FACT_RECEIPT());
    await a.page.locator('#receiptApplyBtn').click();
    await a.page.locator('#qaCommit').click();
    await expect(a.page.locator('#pg-stock')).toHaveClass(/on/);
    // B has no connection to the shared server.
    await b.page.route(EMU + '/rest/v1/rpc/**', route => route.abort());
    await readTextOn(b.page, FACT_RECEIPT());
    await b.page.locator('#receiptApplyBtn').click();
    await expect(b.page.locator('#atkConfirmTitle')).toHaveText('家族の取り込み状況を確認できませんでした');
    await b.page.locator('#atkConfirm .atk-confirm-primary').click();
    await b.page.locator('#qaCommit').click();
    await expect(b.page.locator('#pg-stock')).toHaveClass(/on/);
    const local = await senbei(b.page);
    await b.page.unroute(EMU + '/rest/v1/rpc/**');
    await b.page.evaluate(() => window.receiptFlushClaimsV49());
    await expect(b.page.locator('#atkConfirmTitle')).toHaveText('同じレシートを家族が取り込んでいました');
    await expect(b.page.locator('#atkConfirmNote')).toContainText('自動では変更していません');
    expect(await senbei(b.page)).toBe(local);
  } finally { await a.ctx.close(); await b.ctx.close(); }
});
