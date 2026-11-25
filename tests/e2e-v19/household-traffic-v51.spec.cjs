// v51 free-tier traffic: a quiet, visible shared device polls less and fetches history/members only
// when something changed; a partner's change still arrives with the next poll. Local emulator only.
const { test, expect } = require('@playwright/test');
const { open, go, stored, baseState, KEY, appConfirm } = require('./helpers.cjs');
const EMU = 'http://127.0.0.1:' + (process.env.E2E_HH_PORT || 4720);
const CFG = { url: EMU, anonKey: 'emu-anon-key', google: true, guest: true, email: false };

test('quiet shared device: one small pull per adaptive poll, no repeated history or member reads', async ({ browser, request }, info) => {
  test.setTimeout(240000);
  await request.post(EMU + '/__test/reset');
  async function device(state) { const ctx = await browser.newContext({ ...info.project.use, baseURL: info.project.use.baseURL, viewport: { width: 390, height: 844 } }); const page = await ctx.newPage(); await page.addInitScript(c => window.ATOKORE_HOUSEHOLD_CONFIG = c, CFG); await open(page, { [KEY]: state }); return { ctx, page }; }
  const a = await device(baseState()), b = await device({ items: [], buys: [], routines: [] });
  try {
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
    await a.page.evaluate(() => AtokoreHousehold.syncNow());
    await b.page.evaluate(() => AtokoreHousehold.syncNow());

    // Measure A while nothing changes anywhere (real timers, page visible).
    const calls = [];
    a.page.on('request', r => { const m = /\/rest\/v1\/rpc\/([a-z_]+)/.exec(r.url()); if (m) calls.push(m[1]); });
    await a.page.waitForTimeout(70000);
    const count = n => calls.filter(c => c === n).length;
    console.log('TRAFFIC_QUIET_70S', JSON.stringify({ total: calls.length, hh_pull: count('hh_pull'), hh_changes: count('hh_changes'), hh_my: count('hh_my'), hh_push: count('hh_push') }));
    // The previous fixed 20 s poll made 3 pulls + 3 history + 3 member reads in 70 s.
    expect(count('hh_pull')).toBeLessThanOrEqual(2);
    expect(count('hh_changes')).toBe(0);
    expect(count('hh_my')).toBe(0);
    expect(count('hh_push')).toBe(0);

    // A partner's change still arrives with A's next poll, and history follows it.
    calls.length = 0;
    await go(b.page, 'stock');
    const eggs = (await stored(b.page)).items.find(x => x.name === '卵');
    await b.page.locator(`#stockList [data-stock-id="${eggs.id}"] .qty button`).last().click();
    await b.page.evaluate(() => AtokoreHousehold.syncNow());
    await expect.poll(async () => (await stored(a.page)).items.find(x => x.name === '卵')?.qty, { timeout: 130000, intervals: [2000] }).toBe(7);
    await expect.poll(() => calls.filter(c => c === 'hh_changes').length, { timeout: 10000 }).toBeGreaterThan(0);
    expect(a.page.__errors).toEqual([]); expect(b.page.__errors).toEqual([]);
  } finally { await a.ctx.close(); await b.ctx.close(); }
});
