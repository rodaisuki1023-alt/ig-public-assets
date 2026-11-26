// Chromium "sync stops now and then" (open since v51): one request that never settles (a stalled
// connection) kept the sync guard forever, so every later sync returned the same stuck promise and the
// app stayed 「同期中」. Every request now ends within a time limit; a push is idempotent (op_id), so
// a timed-out request is simply retried by the next sync.
const { test, expect } = require('@playwright/test');
const { open, go, baseState, KEY, appConfirm } = require('./helpers.cjs');
const EMU = 'http://127.0.0.1:' + (process.env.E2E_HH_PORT || 4720);
const CFG = { url: EMU, anonKey: 'emu-anon-key', google: true, guest: true, email: false, requestTimeoutMs: 1500 };
for (const [what, mode] of [['hh_pull', 'held'], ['hh_push', 'held'], ['hh_push', 'answer-lost']]) test(`a ${what} request (${mode}) that never answers does not stop syncing; the next sync recovers and nothing is doubled`, async ({ browser, request }, info) => {
  test.setTimeout(90000);
  await request.post(EMU + '/__test/reset');
  const ctx = await browser.newContext({ ...info.project.use, baseURL: info.project.use.baseURL, serviceWorkers: 'block' });
  const page = await ctx.newPage(); page.__errors = []; page.on('pageerror', e => page.__errors.push(e.message));
  await page.addInitScript(c => window.ATOKORE_HOUSEHOLD_CONFIG = c, CFG);
  try {
    await open(page, { [KEY]: baseState() });
    await go(page, 'premium'); await page.click('#atkHouseholdCard');
    await page.getByRole('button', { name: 'Googleでログイン', exact: true }).click();
    await page.fill('#atkHhName', 'パパ'); await page.getByRole('button', { name: '世帯を作る', exact: true }).click(); await appConfirm(page, true);
    await expect(page.locator('#atkHouseholdStatus')).toHaveText(/^(\d+人で共有中|家族と共有中)$/);
    await page.getByRole('button', { name: '閉じる', exact: true }).click();
    const st = () => page.evaluate(() => window.AtokoreHousehold.status().state);
    await expect.poll(st).toBe('synced');
    if (what === 'hh_push') await page.evaluate(() => { items[0].qty += 1; save(); render(); });
    let stalled = 0;
    await page.route('**/rest/v1/rpc/' + what, async route => { if (stalled++ === 0) { if (mode === 'answer-lost') await route.fetch(); return; } /* never answers (after the server applied it when answer-lost) */ return route.continue(); });
    const first = page.evaluate(() => window.AtokoreHousehold.syncNow().then(s => s.state));
    await expect.poll(() => stalled, { message: 'the request was held' }).toBeGreaterThan(0);
    expect(await first).toBe('offline');                                     // ended by the time limit
    await expect.poll(() => page.evaluate(() => window.AtokoreHousehold.syncNow().then(s => s.state)), { timeout: 20000 }).toBe('synced');
    const diag = await page.evaluate(() => window.AtokoreHousehold.status().timeouts);
    expect(diag).toBeGreaterThanOrEqual(1);
    if (what === 'hh_push') {
      // The held push is sent again by the next sync; op_id makes it count once: server = phone.
      const local = await page.evaluate(() => ({ name: items[0].name, qty: items[0].qty }));
      const res = await (await request.post(EMU + '/__test/sql', { data: { sql: "SELECT qty::float8 q FROM atokore_private.records WHERE kind='item' AND fields->>'name'='" + local.name.replace(/'/g, "''") + "'" } })).json();
      const rows = Array.isArray(res) ? res : res.rows;
      expect(rows.map(r => Number(r.q))).toEqual([local.qty]);
    }
    expect(page.__errors).toEqual([]);
  } finally { await ctx.close(); }
});
