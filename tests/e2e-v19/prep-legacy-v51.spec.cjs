// Work 7th (D): on a phone that used #112, the old prep key (atokorePrepSetsV1) may hold a household's
// shared list (#112 wrote it there). Its origin cannot be known, so it is never offered or sent to another
// household, also with the share button; it is not deleted either. Data the person entered on this phone
// after the fix (origin recorded) can still be shared. Local emulator only.
const { test, expect } = require('@playwright/test');
const { open, go, baseState, KEY, appConfirm } = require('./helpers.cjs');
const EMU = 'http://127.0.0.1:' + (process.env.E2E_HH_PORT || 4720);
const CFG = { url: EMU, anonKey: 'emu-anon-key', google: true, guest: true, email: false, prepSharing: true };
const today = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const householdList = () => ({ v: 1, children: [{ id: 'c-old', name: '旧世帯の子' }], week: {}, events: { 'c-old': { [today()]: { label: null, rows: [{ id: 'e-old', name: '旧世帯のお弁当' }] } } }, done: {} });
async function device(browser, info, state, legacy, history) {
  const ctx = await browser.newContext({ ...info.project.use, baseURL: info.project.use.baseURL, viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const page = await ctx.newPage(); page.__errors = []; page.on('pageerror', e => page.__errors.push(e.message));
  await page.addInitScript(c => window.ATOKORE_HOUSEHOLD_CONFIG = c, CFG);
  // The #112 state: the old key with a household's list, and a trace of family sharing on this phone.
  await page.addInitScript(({ legacy, history }) => {
    if (sessionStorage.getItem('qa-seeded')) return; sessionStorage.setItem('qa-seeded', '1');
    const path = location.pathname;
    if (legacy) localStorage.setItem('atokorePreviewPrepSetsV19:' + path, JSON.stringify(legacy));
    if (history) localStorage.setItem('atokorePreviewHouseholdSyncV19', JSON.stringify({ household: null, engine: null, sharedFor: '00000000-0000-4000-8000-00000000aaaa', sharedSince: Date.now() - 86400000 }));   // left a household earlier
  }, { legacy, history });
  await open(page, { [KEY]: state });
  return { ctx, page };
}
test('a #112 phone that shared before: the old key is kept and usable here, but never offered or sent to a new household', async ({ browser, request }, info) => {
  test.setTimeout(150000);
  await request.post(EMU + '/__test/reset');
  const a = await device(browser, info, baseState(), null, false);
  const b = await device(browser, info, { items: [], buys: [], routines: [] }, householdList(), true);
  const box = p => p.locator('#atkPrepSets');
  try {
    // Before joining: B still sees its old list on this phone (nothing deleted).
    await go(b.page, 'buy'); await b.page.evaluate(() => { const d = document.getElementById('atkPrepSets'); if (d) d.open = true; });
    await expect(box(b.page).locator('.atk-prep-today li')).toHaveText([/旧世帯のお弁当/]);
    // A creates a new household with no prep list; B joins.
    await go(a.page, 'premium'); await a.page.click('#atkHouseholdCard');
    await a.page.getByRole('button', { name: 'Googleでログイン', exact: true }).click();
    await a.page.fill('#atkHhName', 'パパ'); await a.page.getByRole('button', { name: '世帯を作る', exact: true }).click(); await appConfirm(a.page, true);
    await a.page.getByRole('button', { name: /家族を招待する/ }).click();
    const link = await a.page.locator('#atkHhInviteLink').inputValue();
    await b.page.goto(link); await b.page.fill('#atkHhGuestName', 'ママ');
    await b.page.getByRole('button', { name: 'Googleなしで共有に参加する', exact: true }).click();
    await expect(b.page.locator('#atkHouseholdStatus')).toHaveText(/^(\d+人で共有中|家族と共有中)$/);
    await b.page.getByRole('button', { name: '閉じる', exact: true }).click({ timeout: 1500 }).catch(() => {});
    await go(b.page, 'buy'); await b.page.evaluate(() => { const d = document.getElementById('atkPrepSets'); if (d) d.open = true; });
    await b.page.evaluate(() => AtokorePrepSets.pullShared());
    // Never offered; if a button were there, pressing it must still send nothing of the old list.
    const share = box(b.page).getByRole('button', { name: 'この端末の内容を家族と共有する' });
    await share.waitFor({ timeout: 3000 }).catch(() => {});
    if (await share.count()) { const put = b.page.waitForResponse(r => r.url().includes('/rpc/hh_prep_put')); await share.click(); await put; }
    const server = await b.page.evaluate(d => AtokoreHousehold.prepGet(d), today());
    expect(JSON.stringify(server?.doc ?? null)).not.toContain('旧世帯');
    await expect(share).toHaveCount(0);
    // The old key is still exactly there (not deleted, not rewritten).
    const kept = await b.page.evaluate(() => localStorage.getItem('atokorePreviewPrepSetsV19:' + location.pathname));
    expect(JSON.parse(kept).children[0].name).toBe('旧世帯の子');
    // After a restart the same holds (idempotent).
    await b.page.reload(); await go(b.page, 'buy'); await b.page.evaluate(() => { const d = document.getElementById('atkPrepSets'); if (d) d.open = true; });
    await b.page.evaluate(() => AtokorePrepSets.pullShared());
    await expect(box(b.page).getByRole('button', { name: 'この端末の内容を家族と共有する' })).toHaveCount(0);
    expect(a.page.__errors).toEqual([]); expect(b.page.__errors).toEqual([]);
  } finally { await a.ctx.close(); await b.ctx.close(); }
});
// Work 8th (D): no family trace is not proof of origin. A phone that never shared keeps its old list and
// can use it, but the old list is of unknown origin too: never offered or sent (a list started fresh can be).
test('a phone with no family trace: its old list is kept and usable, but of unknown origin (never offered)', async ({ browser, request }, info) => {
  test.setTimeout(150000);
  await request.post(EMU + '/__test/reset');
  const own = householdList(); own.children[0].name = '自分の子'; own.events['c-old'][today()].rows[0].name = '自分の水筒';
  const a = await device(browser, info, baseState(), null, false);
  const b = await device(browser, info, { items: [], buys: [], routines: [] }, own, false);
  const box = p => p.locator('#atkPrepSets');
  try {
    await go(a.page, 'premium'); await a.page.click('#atkHouseholdCard');
    await a.page.getByRole('button', { name: 'Googleでログイン', exact: true }).click();
    await a.page.fill('#atkHhName', 'パパ'); await a.page.getByRole('button', { name: '世帯を作る', exact: true }).click(); await appConfirm(a.page, true);
    await a.page.getByRole('button', { name: /家族を招待する/ }).click();
    const link = await a.page.locator('#atkHhInviteLink').inputValue();
    await b.page.goto(link); await b.page.fill('#atkHhGuestName', 'ママ');
    await b.page.getByRole('button', { name: 'Googleなしで共有に参加する', exact: true }).click();
    await expect(b.page.locator('#atkHouseholdStatus')).toHaveText(/^(\d+人で共有中|家族と共有中)$/);
    await b.page.getByRole('button', { name: '閉じる', exact: true }).click({ timeout: 1500 }).catch(() => {});
    await go(b.page, 'buy'); await b.page.evaluate(() => { const d = document.getElementById('atkPrepSets'); if (d) d.open = true; });
    await b.page.evaluate(() => AtokorePrepSets.pullShared());
    const share = box(b.page).getByRole('button', { name: 'この端末の内容を家族と共有する' });
    await share.waitFor({ timeout: 3000 }).catch(() => {});
    if (await share.count()) { const put = b.page.waitForResponse(r => r.url().includes('/rpc/hh_prep_put')); await share.click(); await put; }
    expect(JSON.stringify((await b.page.evaluate(d => AtokoreHousehold.prepGet(d), today()))?.doc ?? null)).not.toContain('自分の子');
    await expect(share).toHaveCount(0);
    expect(JSON.parse(await b.page.evaluate(() => localStorage.getItem('atokorePreviewPrepSetsV19:' + location.pathname))).children[0].name).toBe('自分の子');
    expect(b.page.__errors).toEqual([]);
  } finally { await a.ctx.close(); await b.ctx.close(); }
});
