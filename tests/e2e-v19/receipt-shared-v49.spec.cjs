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
