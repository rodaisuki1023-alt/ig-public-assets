// v51 shared preparation (draft SQL in the local emulator only): settings with a revision, ticks shared.
const { test, expect } = require('@playwright/test');
const { open, go, baseState, KEY, appConfirm } = require('./helpers.cjs');
const EMU = 'http://127.0.0.1:' + (process.env.E2E_HH_PORT || 4720);
const CFG = { url: EMU, anonKey: 'emu-anon-key', google: true, guest: true, email: false, prepSharing: true };
const today = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };

test('one household list on both phones: ticks travel, a stale edit is refused and reloaded', async ({ browser, request }, info) => {
  test.setTimeout(150000);
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
    await b.page.getByRole('button', { name: '閉じる', exact: true }).click(); await a.page.getByRole('button', { name: '閉じる', exact: true }).click();

    const box = p => p.locator('#atkPrepSets');
    await go(a.page, 'buy'); await box(a.page).locator('summary').first().click();
    await box(a.page).locator('[data-prep-kid-name]').fill('上の子'); await box(a.page).locator('[data-prep-add-child]').click();
    await expect(box(a.page).locator('.atk-prep-kid')).toHaveCount(1);
    await box(a.page).locator('[data-prep-when]').selectOption('date'); await box(a.page).locator('[data-prep-date]').fill(today());
    await box(a.page).locator('[data-prep-name]').fill('お弁当'); await box(a.page).locator('[data-prep-add]').click();
    await expect(box(a.page).locator('.atk-prep-today li')).toHaveCount(1);
    await expect(box(a.page).locator('.atk-prep-note').last()).toContainText('家族と共有しています');

    await go(b.page, 'buy'); await box(b.page).locator('summary').first().click();
    await expect(box(b.page).locator('.atk-prep-today li')).toHaveText(/お弁当/);
    await box(b.page).locator('.atk-prep-today input').check();
    await expect(box(b.page).locator('.atk-prep-count')).toHaveText('今日 0/1');
    await a.page.evaluate(() => AtokorePrepSets.pullShared());
    await expect(box(a.page).locator('.atk-prep-count')).toHaveText('今日 0/1');
    await expect(box(a.page).locator('.atk-prep-today input')).toBeChecked();

    // Both edit the settings from the same revision: the second is refused and shows the latest.
    await box(a.page).locator('[data-prep-kid-name]').fill('下の子'); await box(a.page).locator('[data-prep-add-child]').click();
    await expect(box(a.page).locator('.atk-prep-kid')).toHaveCount(2);
    await box(b.page).locator('[data-prep-kid-name]').fill('三人目'); await box(b.page).locator('[data-prep-add-child]').click();
    await expect(box(b.page).locator('.atk-prep-error')).toContainText('家族が先に変更しました');
    await expect(box(b.page).locator('.atk-prep-kid')).toHaveText([/上の子/, /下の子/]);
    expect(a.page.__errors).toEqual([]); expect(b.page.__errors).toEqual([]);
  } finally { await a.ctx.close(); await b.ctx.close(); }
});
