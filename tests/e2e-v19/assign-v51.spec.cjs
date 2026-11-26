// v51 家族の買い物担当 with the draft SQL loaded in the local emulator (never a real project).
const { test, expect } = require('@playwright/test');
const { open, go, stored, baseState, KEY, appConfirm } = require('./helpers.cjs');
const EMU = 'http://127.0.0.1:' + (process.env.E2E_HH_PORT || 4720);
const CFG = { url: EMU, anonKey: 'emu-anon-key', google: true, guest: true, email: false, buyAssignments: true };

async function pair(browser, request, info, cfg = CFG) {
  await request.post(EMU + '/__test/reset');
  async function device(state) { const ctx = await browser.newContext({ ...info.project.use, baseURL: info.project.use.baseURL, viewport: { width: 390, height: 844 } }); const page = await ctx.newPage(); await page.addInitScript(c => window.ATOKORE_HOUSEHOLD_CONFIG = c, cfg); await open(page, { [KEY]: state }); return { ctx, page }; }
  const a = await device(baseState({ buys: [] })), b = await device({ items: [], buys: [], routines: [] });
  await go(a.page, 'premium'); await a.page.click('#atkHouseholdCard');
  await a.page.getByRole('button', { name: 'Googleでログイン', exact: true }).click();
  await a.page.fill('#atkHhName', 'パパ'); await a.page.getByRole('button', { name: '世帯を作る', exact: true }).click(); await appConfirm(a.page, true);
  await expect(a.page.locator('#atkHouseholdStatus')).toHaveText(/^(\d+人で共有中|家族と共有中)$/);
  await a.page.getByRole('button', { name: /家族を招待する/ }).click();
  const link = await a.page.locator('#atkHhInviteLink').inputValue();
  await b.page.goto(link); await b.page.fill('#atkHhGuestName', 'ママ');
  await b.page.getByRole('button', { name: 'Googleなしで共有に参加する', exact: true }).click();
  await expect(b.page.locator('#atkHouseholdStatus')).toHaveText(/^(\d+人で共有中|家族と共有中)$/);
  await b.page.getByRole('button', { name: '閉じる', exact: true }).click();
  await a.page.getByRole('button', { name: '閉じる', exact: true }).click();
  return { a, b };
}
const sync = p => p.evaluate(() => AtokoreHousehold.syncNow());

test('ask, reply 今回は難しい, re-ask, accept; a stale screen is refused; shopping data unchanged', async ({ browser, request }, info) => {
  test.setTimeout(150000);
  const { a, b } = await pair(browser, request, info);
  try {
    await go(a.page, 'buy'); await a.page.fill('#buyName', '牛乳'); await a.page.getByRole('button', { name: '追加', exact: true }).first().click();
    await sync(a.page); await sync(b.page); await sync(a.page);
    const box = p => p.locator('#atkAssign');
    await expect(box(a.page)).toBeVisible();
    await box(a.page).locator('[data-assign-edit]').click();
    await box(a.page).locator('select[aria-label="牛乳の担当"]').selectOption({ label: 'ママ' });
    await expect(box(a.page).locator('.atk-assign-list')).toContainText('ママが担当（返信待ち）');

    await go(b.page, 'buy'); await sync(b.page);
    await expect(box(b.page).locator('.atk-assign-list')).toContainText('あなたが担当（返信待ち）');
    const buysBefore = (await stored(b.page)).buys.map(x => [x.name, x.qty]);
    await box(b.page).locator('[data-assign-reply="decline"]').click();
    await expect(box(b.page).locator('.atk-assign-list')).toContainText('今回は難しい');
    await sync(a.page);
    await expect(box(a.page).locator('.atk-assign-list')).toContainText('今回は難しい（担当を決め直してください）');

    // A asks again; B's screen still holds the older revision and tries to take it for herself.
    await box(a.page).locator('select[aria-label="牛乳の担当"]').selectOption({ label: 'ママ' });
    await expect(box(a.page).locator('.atk-assign-list')).toContainText('ママが担当（返信待ち）');
    await box(b.page).locator('[data-assign-edit]').click();
    await box(b.page).locator('select[aria-label="牛乳の担当"]').selectOption({ label: 'パパ' });
    await expect(box(b.page).locator('.atk-assign-msg')).toHaveText('家族が先に変更しました。最新の担当を表示しています。');
    await expect(box(b.page).locator('.atk-assign-list')).toContainText('あなたが担当（返信待ち）');
    await box(b.page).locator('[data-assign-reply="accept"]').click();
    await expect(box(b.page).locator('.atk-assign-list')).toContainText('あなたが買います');
    await sync(a.page);
    await expect(box(a.page).locator('.atk-assign-list')).toContainText('ママが買います');
    expect((await stored(b.page)).buys.map(x => [x.name, x.qty])).toEqual(buysBefore);
    expect(a.page.__errors).toEqual([]); expect(b.page.__errors).toEqual([]);
  } finally { await a.ctx.close(); await b.ctx.close(); }
});

test('without the server feature the block never appears, even while sharing', async ({ browser, request }, info) => {
  test.setTimeout(120000);
  const { a, b } = await pair(browser, request, info, { ...CFG, buyAssignments: false });
  try {
    await go(a.page, 'buy'); await a.page.fill('#buyName', '牛乳'); await a.page.getByRole('button', { name: '追加', exact: true }).first().click();
    await sync(a.page);
    await expect(a.page.locator('#atkAssign')).toHaveCount(0);
  } finally { await a.ctx.close(); await b.ctx.close(); }
});
// Work 5th: leaving says what happens to assignments and notices first; afterwards the phone keeps no
// usable assignment state, and the server has released what the leaver was asked to buy.
test('leaving explains the effect, clears the assignment cache, and the family sees the assignment released', async ({ browser, request }, info) => {
  test.setTimeout(150000);
  const { a, b } = await pair(browser, request, info);
  try {
    await go(a.page, 'buy'); await a.page.fill('#buyName', '牛乳'); await a.page.getByRole('button', { name: '追加', exact: true }).first().click();
    await sync(a.page); await sync(b.page); await sync(a.page);
    const box = p => p.locator('#atkAssign');
    await box(a.page).locator('[data-assign-edit]').click();
    await box(a.page).locator('select[aria-label="牛乳の担当"]').selectOption({ label: 'ママ' });
    await go(b.page, 'buy'); await sync(b.page);
    await expect(box(b.page).locator('.atk-assign-list')).toContainText('あなたが担当（返信待ち）');
    const localId = await b.page.evaluate(() => buys.find(x => x.name === '牛乳').id);
    expect(await b.page.evaluate(id => AtokoreHousehold.assignmentFor(id)?.assignee, localId)).not.toBe(null);
    await go(b.page, 'premium'); await b.page.click('#atkHouseholdCard');
    await b.page.getByRole('button', { name: /世帯から抜ける|抜ける/ }).first().click();
    const text = await appConfirm(b.page, true);
    expect(text).toContain('あなたが頼まれていた買い物の担当は外れ');
    await expect(b.page.locator('#atkHouseholdStatus')).not.toHaveText(/共有中/);
    expect(await b.page.evaluate(id => AtokoreHousehold.assignmentFor(id), localId)).toBe(null);
    await sync(a.page); await a.page.evaluate(() => AtokoreHousehold.refreshAssignments());
    const aId = await a.page.evaluate(() => buys.find(x => x.name === '牛乳').id);
    expect(await a.page.evaluate(id => AtokoreHousehold.assignmentFor(id), aId)).toMatchObject({ assignee: null, response: 'none' });
    await go(a.page, 'home'); await go(a.page, 'buy');
    expect(await a.page.locator('#atkAssign').innerText().catch(() => '')).not.toContain('ママが担当');
    expect(a.page.__errors || []).toEqual([]);
  } finally { await a.ctx.close(); await b.ctx.close(); }
});
