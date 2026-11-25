// Muse P1-1 while sharing: a purchase reaches the estimate once on the buyer's phone, the estimate
// travels to the family as an ordinary field (never re-added there), and the shared undo reverts both.
const { test, expect } = require('@playwright/test');
const { open, go, stored, baseState, KEY, appConfirm } = require('./helpers.cjs');
const EMU = 'http://127.0.0.1:' + (process.env.E2E_HH_PORT || 4720);
const CFG = { url: EMU, anonKey: 'emu-anon-key', google: true, guest: true, email: false };
const localDay = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const NAME = 'パンパース さらさらケア おむつ テープ M';

test('shared: 買った updates the estimate once for the family, and undo reverts count and estimate', async ({ browser, request }, info) => {
  test.setTimeout(150000);
  await request.post(EMU + '/__test/reset');
  const s = baseState();
  const track = { v: 1, base: 60, since: localDay(), perDay: 6, perPack: 60, refillDays: 5, pieceUnit: '枚', size: null, snoozeUntil: null, confirmedAt: localDay() };
  s.items[1].track = track;
  s.buys = [{ id: 20, name: NAME, qty: 2, unit: '袋', stockId: 2 }];
  async function device(state) { const ctx = await browser.newContext({ ...info.project.use, baseURL: info.project.use.baseURL, viewport: { width: 390, height: 844 } }); const page = await ctx.newPage(); await page.addInitScript(c => window.ATOKORE_HOUSEHOLD_CONFIG = c, CFG); await open(page, { [KEY]: state }); return { ctx, page }; }
  const a = await device(s), b = await device({ items: [], buys: [], routines: [] });
  const diaper = async p => (await stored(p)).items.find(x => x.name === NAME);
  const sync = p => p.evaluate(() => window.AtokoreHousehold.syncNow());
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
    await b.page.getByRole('button', { name: '閉じる', exact: true }).click(); await a.page.getByRole('button', { name: '閉じる', exact: true }).click();
    await expect.poll(async () => (await diaper(b.page))?.track?.base).toBe(60);

    await go(a.page, 'buy');
    await a.page.getByRole('button', { name: NAME + 'を買った', exact: true }).click();
    expect((await diaper(a.page)).track.base).toBe(180);
    await sync(a.page); await sync(b.page);
    await expect.poll(async () => (await diaper(b.page)).qty).toBe(4);
    let theirs = await diaper(b.page);
    expect(theirs.track).toMatchObject({ base: 180, since: localDay() });
    // B syncing again (or repainting) never adds the purchase a second time.
    await sync(b.page); await b.page.evaluate(() => { window.renderStock?.(); window.renderHome?.(); });
    expect((await diaper(b.page)).track.base).toBe(180);
    await sync(a.page);
    expect((await diaper(a.page)).track.base).toBe(180);

    await a.page.getByRole('button', { name: '元に戻す', exact: true }).click();
    await expect(a.page.locator('#atkUndoBar')).toHaveCount(0);
    await expect.poll(async () => (await diaper(a.page)).qty).toBe(2);
    expect((await diaper(a.page)).track).toMatchObject({ base: 60 });
    expect((await diaper(a.page)).track.check ?? null).toBe(null);
    await sync(a.page); await sync(b.page);
    await expect.poll(async () => (await diaper(b.page)).qty).toBe(2);
    theirs = await diaper(b.page);
    expect(theirs.track).toMatchObject({ base: 60 });
    expect(a.page.__errors).toEqual([]); expect(b.page.__errors).toEqual([]);
  } finally { await a.ctx.close(); await b.ctx.close(); }
});
