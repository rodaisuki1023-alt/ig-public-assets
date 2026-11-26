// v51 D (Work 6th): after leaving, the old household's prep data must not stay on the phone, and it must
// never become the first shared list of a NEW household. Only the person's own data is offered, after a
// confirmation. Local emulator with the draft SQL only.
const { test, expect } = require('@playwright/test');
const { open, go, baseState, KEY, appConfirm } = require('./helpers.cjs');
const EMU = 'http://127.0.0.1:' + (process.env.E2E_HH_PORT || 4720);
const CFG = { url: EMU, anonKey: 'emu-anon-key', google: true, guest: true, email: false, prepSharing: true };
const today = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
test.use({ actionTimeout: 15000 });
const own = () => { const d = today(); return { v: 1, children: [{ id: 'c-own', name: 'Bの子' }], week: {}, events: { 'c-own': { [d]: { label: null, rows: [{ id: 'e-own', name: '水筒' }] } } }, done: {} }; };

test('leave: household prep data is removed, own data comes back, a new household gets nothing implicitly', async ({ browser, request }, info) => {
  test.setTimeout(180000);
  await request.post(EMU + '/__test/reset');
  async function device(state) { const ctx = await browser.newContext({ ...info.project.use, baseURL: info.project.use.baseURL, viewport: { width: 390, height: 844 }, serviceWorkers: 'block' }); const page = await ctx.newPage(); await page.addInitScript(c => window.ATOKORE_HOUSEHOLD_CONFIG = c, CFG); await open(page, { [KEY]: state }); return { ctx, page }; }
  const a = await device(baseState()), b = await device({ items: [], buys: [], routines: [] });
  const box = p => p.locator('#atkPrepSets');
  const personal = p => p.evaluate(() => JSON.parse(localStorage.getItem(AtokorePrepSets.KEY) || 'null'));
  try {
    // B's own prep list, made before any sharing.
    await b.page.evaluate(s => { localStorage.setItem(AtokorePrepSets.KEY, JSON.stringify(s)); AtokorePrepSets.refresh(); }, own());
    await go(a.page, 'premium'); await a.page.click('#atkHouseholdCard');
    await a.page.getByRole('button', { name: 'Googleでログイン', exact: true }).click();
    await a.page.fill('#atkHhName', 'パパ'); await a.page.getByRole('button', { name: '世帯を作る', exact: true }).click(); await appConfirm(a.page, true);
    await expect(a.page.locator('#atkHouseholdStatus')).toHaveText(/^(\d+人で共有中|家族と共有中)$/);
    await a.page.getByRole('button', { name: '閉じる', exact: true }).click();
    await go(a.page, 'buy'); await box(a.page).locator('summary').first().click();
    await box(a.page).locator('[data-prep-kid-name]').fill('上の子'); await box(a.page).locator('[data-prep-add-child]').click();
    await box(a.page).locator('[data-prep-when]').selectOption('date'); await box(a.page).locator('[data-prep-date]').fill(today());
    await box(a.page).locator('[data-prep-name]').fill('お弁当'); await box(a.page).locator('[data-prep-add]').click();
    await expect(box(a.page).locator('.atk-prep-today li')).toHaveCount(1);
    await go(a.page, 'premium'); await a.page.click('#atkHouseholdCard');
    await a.page.getByRole('button', { name: /家族を招待する/ }).click();
    const link = await a.page.locator('#atkHhInviteLink').inputValue();
    await b.page.goto(link); await b.page.fill('#atkHhGuestName', 'ママ');
    await b.page.getByRole('button', { name: 'Googleなしで共有に参加する', exact: true }).click();
    await expect(b.page.locator('#atkHouseholdStatus')).toHaveText(/^(\d+人で共有中|家族と共有中)$/);
    await b.page.getByRole('button', { name: '閉じる', exact: true }).click();

    // While shared: B sees the household's list, also after a restart; B's own data is kept apart.
    await go(b.page, 'buy'); await box(b.page).locator('summary').first().click();
    await b.page.evaluate(() => AtokorePrepSets.pullShared());
    await expect(box(b.page).locator('.atk-prep-today li')).toHaveText([/お弁当/]);
    await b.page.reload(); await go(b.page, 'buy'); await box(b.page).locator('summary').first().click();
    await expect(box(b.page).locator('.atk-prep-today li')).toHaveText([/お弁当/]);
    expect((await personal(b.page))?.children?.map(c => c.name)).toEqual(['Bの子']);
    // Offline while shared: the household list stays readable, nothing is mixed.
    await b.ctx.setOffline(true);
    await b.page.evaluate(() => AtokorePrepSets.pullShared());
    await expect(box(b.page).locator('.atk-prep-today li')).toHaveText([/お弁当/]);
    await b.ctx.setOffline(false);

    // A household answer that arrives after leaving is ignored (in flight while leaving).
    let release; const held = new Promise(r => { release = r; });
    let caught = false;
    await b.page.route('**/rest/v1/rpc/hh_prep_get', async route => { caught = true; const resp = await route.fetch(); await held; await route.fulfill({ response: resp }).catch(() => {}); });
    const late = b.page.evaluate(() => AtokorePrepSets.pullShared());
    await expect.poll(() => caught).toBe(true);
    await go(b.page, 'premium'); await b.page.click('#atkHouseholdCard');
    await b.page.getByRole('button', { name: /世帯から抜ける|抜ける/ }).first().click();
    await appConfirm(b.page, true);
    await expect(b.page.locator('#atkHouseholdStatus')).not.toHaveText(/共有中/);
    release(); await late; await b.page.unroute('**/rest/v1/rpc/hh_prep_get');

    // After leaving: the household list is gone from this phone; B's own list is back.
    await b.page.getByRole('button', { name: '閉じる', exact: true }).click({ timeout: 1500 }).catch(() => {});   // leaving closes the sheet itself
    await go(b.page, 'buy');
    await expect(box(b.page).locator('.atk-prep-today li')).toHaveText([/水筒/]);
    expect(await b.page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith(AtokorePrepSets.KEY + ':hh:')))).toEqual([]);
    expect((await personal(b.page))?.children?.map(c => c.name)).toEqual(['Bの子']);
    await b.page.reload(); await go(b.page, 'buy');
    await expect(box(b.page).locator('.atk-prep-today li')).toHaveText([/水筒/]);

    // A new household (A leaves too and starts a new one, B joins with the invite): nothing is shared by itself.
    await a.page.getByRole('button', { name: '閉じる', exact: true }).click();   // A's invite sheet from before
    await go(a.page, 'premium'); await a.page.click('#atkHouseholdCard');
    await a.page.getByRole('button', { name: /世帯から抜ける|抜ける/ }).first().click(); await appConfirm(a.page, true);
    await expect(a.page.locator('#atkHouseholdStatus')).not.toHaveText(/共有中/);
    await go(a.page, 'premium'); await a.page.click('#atkHouseholdCard');
    await a.page.fill('#atkHhName', 'パパ'); await a.page.getByRole('button', { name: '世帯を作る', exact: true }).click(); await appConfirm(a.page, true);
    await expect(a.page.locator('#atkHouseholdStatus')).toHaveText(/^(\d+人で共有中|家族と共有中)$/);
    await a.page.getByRole('button', { name: /家族を招待する/ }).click();
    const link2 = await a.page.locator('#atkHhInviteLink').inputValue();
    await b.page.goto(link2);
    if (await b.page.locator('#atkHhGuestName').count()) await b.page.fill('#atkHhGuestName', 'ママ');
    await b.page.getByRole('button', { name: /共有に参加する|参加する/ }).first().click();
    // B kept the first household's stock on the phone, so the usual stock choice comes first.
    await b.page.getByRole('button', { name: /共有のデータを使う/ }).click();
    await appConfirm(b.page, true).catch(() => {});
    await expect(b.page.locator('#atkHouseholdStatus')).toHaveText(/^(\d+人で共有中|家族と共有中)$/);
    await b.page.getByRole('button', { name: '閉じる', exact: true }).click({ timeout: 1500 }).catch(() => {});
    const h2 = await a.page.evaluate(() => AtokoreHousehold.householdId());
    expect(await b.page.evaluate(() => AtokoreHousehold.householdId())).toBe(h2);
    // A's copy of the first household's list went away with A's leave as well.
    expect(await a.page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith(AtokorePrepSets.KEY + ':hh:') && !k.endsWith(AtokoreHousehold.householdId())))).toEqual([]);
    await go(b.page, 'buy'); await box(b.page).locator('summary').first().click();
    await b.page.evaluate(() => AtokorePrepSets.pullShared());
    const server = async () => b.page.evaluate(d => AtokoreHousehold.prepGet(d), today());
    expect((await server())?.doc ?? null).toBe(null);
    // Only after B confirms, only B's own data goes to the new household.
    await box(b.page).getByRole('button', { name: 'この端末の内容を家族と共有する' }).click();
    await expect.poll(async () => (await server())?.doc?.children?.map(c => c.name)).toEqual(['Bの子']);
    await expect(box(b.page).locator('.atk-prep-today li')).toHaveText([/水筒/]);
    expect(a.page.__errors).toEqual([]); expect(b.page.__errors).toEqual([]);
  } finally { await a.ctx.close(); await b.ctx.close(); }
});
