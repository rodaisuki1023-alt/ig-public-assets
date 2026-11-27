// Work 8th (D): data of unknown origin is isolated by default. The absence of a family-sharing trace is not
// proof that a list is the person's own, and nothing turns unknown into own. Reproduces Work's cases:
//  - an own list whose origin came from the earlier heuristic (plain 'own', e.g. after a history-only partial
//    restore removed the family trace) was offered and shared,
//  - an interrupted migration whose family trace was then lost was promoted unknown -> own on the rerun,
//  - a list of another account on the same phone, and a list rewritten by something else (a restore),
// and the positive control: a list started here from nothing can be shared by its owner. Local emulator only.
const { test, expect } = require('@playwright/test');
const { open, go, baseState, KEY, appConfirm } = require('./helpers.cjs');
const EMU = 'http://127.0.0.1:' + (process.env.E2E_HH_PORT || 4720);
const CFG = { url: EMU, anonKey: 'emu-anon-key', google: true, guest: true, email: false, prepSharing: true };
const today = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const list = name => ({ v: 1, children: [{ id: 'c-x', name }], week: {}, events: { 'c-x': { [today()]: { label: null, rows: [{ id: 'e-x', name: name + 'のお弁当' }] } } }, done: {} });
async function device(browser, info, state) {
  const ctx = await browser.newContext({ ...info.project.use, baseURL: info.project.use.baseURL, viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const page = await ctx.newPage(); page.__errors = []; page.on('pageerror', e => page.__errors.push(e.message));
  await page.addInitScript(c => window.ATOKORE_HOUSEHOLD_CONFIG = c, CFG);
  await open(page, { [KEY]: state });
  return { ctx, page };
}
const openPrep = async page => { await go(page, 'buy'); await page.evaluate(() => { const d = document.getElementById('atkPrepSets'); if (d) d.open = true; }); };
// Seed localStorage of this page by the app's own key names (they differ in the preview build), then restart.
async function seed(page, fn, arg) { await page.evaluate(fn, arg); await page.reload(); }
async function household(a, b) {
  await go(a.page, 'premium'); await a.page.click('#atkHouseholdCard');
  await a.page.getByRole('button', { name: 'Googleでログイン', exact: true }).click();
  await a.page.fill('#atkHhName', 'パパ'); await a.page.getByRole('button', { name: '世帯を作る', exact: true }).click(); await appConfirm(a.page, true);
  await a.page.getByRole('button', { name: /家族を招待する/ }).click();
  const link = await a.page.locator('#atkHhInviteLink').inputValue();
  await b.page.goto(link); await b.page.fill('#atkHhGuestName', 'ママ');
  await b.page.getByRole('button', { name: 'Googleなしで共有に参加する', exact: true }).click();
  await expect(b.page.locator('#atkHouseholdStatus')).toHaveText(/^(\d+人で共有中|家族と共有中)$/);
  await b.page.getByRole('button', { name: '閉じる', exact: true }).click({ timeout: 1500 }).catch(() => {});
  await openPrep(b.page);
  await b.page.evaluate(() => AtokorePrepSets.pullShared());
}
// Never offered; if a button were there anyway, pressing it must still send nothing of that list.
async function notShared(b, marker) {
  const share = b.page.locator('#atkPrepSets').getByRole('button', { name: 'この端末の内容を家族と共有する' });
  await share.waitFor({ timeout: 3000 }).catch(() => {});
  if (await share.count()) { const put = b.page.waitForResponse(r => r.url().includes('/rpc/hh_prep_put')); await share.click(); await put; }
  const server = await b.page.evaluate(d => AtokoreHousehold.prepGet(d), today());
  expect(JSON.stringify(server?.doc ?? null)).not.toContain(marker);
  await expect(share).toHaveCount(0);
  expect(await b.page.evaluate(() => AtokorePrepSets.shareable())).toBe(false);
}
const cases = [
  ['an own list recorded by the earlier heuristic (plain "own", no family trace after a partial restore)', async page => {
    await seed(page, l => { localStorage.setItem(AtokorePrepSets.KEY, JSON.stringify(l)); localStorage.setItem(AtokorePrepSets.PROV, 'own'); }, list('復元の子'));
  }, '復元の子'],
  ['an interrupted migration whose family trace was lost before the rerun', async page => {
    // 1) the old key and a trace of an earlier household: the migration records unknown ...
    await seed(page, l => { localStorage.setItem(AtokorePrepSets.LEGACY_KEY, JSON.stringify(l)); localStorage.setItem(Object.keys(localStorage).find(k => /HouseholdSyncV/.test(k)) || 'atokorePreviewHouseholdSyncV19', JSON.stringify({ household: null, engine: null, sharedFor: '00000000-0000-4000-8000-00000000aaaa', sharedSince: Date.now() - 86400000 })); }, list('中断の子'));
    // 2) ... the copy was interrupted (own list missing) and the family trace is gone; the migration runs again.
    await seed(page, () => { localStorage.removeItem(AtokorePrepSets.KEY); for (const k of Object.keys(localStorage)) if (/HouseholdSyncV/.test(k)) localStorage.removeItem(k); });
  }, '中断の子'],
  ['a list started here by another account on this phone', async page => {
    await openPrep(page);
    await page.fill('[data-prep-kid-name]', '別アカウントの子'); await page.click('[data-prep-add-child]');
    await expect(page.locator('.atk-prep-kid')).toHaveText([/別アカウントの子/]);
    await seed(page, () => { const p = JSON.parse(localStorage.getItem(AtokorePrepSets.PROV)); p.owner = '99999999-9999-4999-8999-999999999999'; localStorage.setItem(AtokorePrepSets.PROV, JSON.stringify(p)); });
  }, '別アカウントの子'],
  ['an own list rewritten by something else (a restore of another list)', async page => {
    await openPrep(page);
    await page.fill('[data-prep-kid-name]', '自分の子'); await page.click('[data-prep-add-child]');
    await expect(page.locator('.atk-prep-kid')).toHaveText([/自分の子/]);
    await seed(page, l => localStorage.setItem(AtokorePrepSets.KEY, JSON.stringify(l)), list('書き換えの子'));
  }, '書き換えの子'],
];
for (const [name, prepare, marker] of cases) {
  test('D (Work 8th): ' + name + ' -> kept here, never offered or sent', async ({ browser, request }, info) => {
    test.setTimeout(150000);
    await request.post(EMU + '/__test/reset');
    const a = await device(browser, info, baseState());
    const b = await device(browser, info, { items: [], buys: [], routines: [] });
    try {
      await prepare(b.page);
      await openPrep(b.page);
      await expect(b.page.locator('.atk-prep-kid')).toHaveText([new RegExp(marker)]);   // kept and usable here
      await household(a, b);
      await notShared(b, marker);
      // After leaving and editing it here (a new child), it still cannot be shared: nothing promotes it.
      await b.page.evaluate(() => document.dispatchEvent(new Event('atokore-household-left')));
      await b.page.fill('[data-prep-kid-name]', '編集で追加'); await b.page.click('[data-prep-add-child]');
      expect(await b.page.evaluate(() => AtokorePrepSets.shareable())).toBe(false);
      expect(a.page.__errors).toEqual([]); expect(b.page.__errors).toEqual([]);
    } finally { await a.ctx.close(); await b.ctx.close(); }
  });
}
test('D (Work 8th) positive control: a list started here from nothing is the owner\'s and can be shared', async ({ browser, request }, info) => {
  test.setTimeout(150000);
  await request.post(EMU + '/__test/reset');
  const a = await device(browser, info, baseState());
  const b = await device(browser, info, { items: [], buys: [], routines: [] });
  try {
    await openPrep(b.page);
    await b.page.fill('[data-prep-kid-name]', '新しく作った子'); await b.page.click('[data-prep-add-child]');
    await expect(b.page.locator('.atk-prep-kid')).toHaveText([/新しく作った子/]);
    expect(await b.page.evaluate(() => AtokorePrepSets.provenance())).toBe('own');
    await household(a, b);
    await b.page.locator('#atkPrepSets').getByRole('button', { name: 'この端末の内容を家族と共有する' }).click();
    await expect.poll(async () => (await b.page.evaluate(d => AtokoreHousehold.prepGet(d), today()))?.doc?.children?.map(c => c.name)).toEqual(['新しく作った子']);
    // Bound to the account that shared it.
    const owner = await b.page.evaluate(() => JSON.parse(localStorage.getItem(AtokorePrepSets.PROV)).owner);
    expect(owner).toBe(await b.page.evaluate(() => AtokoreHousehold.myId()));
    expect(a.page.__errors).toEqual([]); expect(b.page.__errors).toEqual([]);
  } finally { await a.ctx.close(); await b.ctx.close(); }
});
