// Only synthetic households on the local emulator; never a live Supabase account.
const { test, expect } = require('@playwright/test');
const { open, stored, baseState, KEY, appConfirm } = require('./helpers.cjs');
const EMU = 'http://127.0.0.1:' + (process.env.E2E_HH_PORT || 4720);
const CFG = { url: EMU, anonKey: 'emu-anon-key', google: true, guest: true, email: false };
const previous = () => baseState({ items: [{ id: 1, name: 'テスト復元前の商品', cat: '食料品', qty: 77, unit: '個' }], buys: [], routines: [] });

test('undo of an earlier local restore cannot replace a joined household on either device', async ({ browser, request }, info) => {
  test.setTimeout(120000);
  await request.post(EMU + '/__test/reset');
  async function device(entries) {
    const ctx = await browser.newContext({ ...info.project.use, baseURL: info.project.use.baseURL, serviceWorkers: 'block' });
    const page = await ctx.newPage();
    await page.addInitScript(c => window.ATOKORE_HOUSEHOLD_CONFIG = c, CFG);
    await open(page, entries);
    return { ctx, page };
  }
  const a = await device({ [KEY]: baseState(), [KEY + 'BeforeRestore']: { at: 1, data: previous() } });
  const b = await device({ [KEY]: { items: [], buys: [], routines: [] } });
  try {
    await a.page.evaluate(() => AtokoreHousehold.open());
    await a.page.getByRole('button', { name: 'Googleでログイン', exact: true }).click();
    await a.page.fill('#atkHhName', 'テスト作成者');
    await a.page.getByRole('button', { name: '世帯を作る', exact: true }).click();
    await appConfirm(a.page, true);
    await expect(a.page.locator('#atkHouseholdStatus')).toHaveText(/^(\d+人で共有中|家族と共有中)$/);
    await a.page.getByRole('button', { name: /家族を招待する/ }).click();
    await b.page.goto(await a.page.locator('#atkHhInviteLink').inputValue());
    await b.page.fill('#atkHhGuestName', 'テスト参加者');
    await b.page.getByRole('button', { name: 'Googleなしで共有に参加する', exact: true }).click();
    await expect(b.page.locator('#atkHouseholdStatus')).toHaveText(/^(\d+人で共有中|家族と共有中)$/);
    const beforeA = await stored(a.page), beforeB = await stored(b.page);
    const undoBefore = await a.page.evaluate(k => localStorage.getItem(k + 'BeforeRestore'), KEY);
    await a.page.evaluate(() => atkOpenBackup());
    await a.page.click('.atk-backup-undo');
    // If old code asks, exercise the dangerous confirmation rather than stopping at its dialog.
    if (await a.page.locator('#atkConfirm').count()) await appConfirm(a.page, true);
    // Let the real local-first watcher notice changes, then explicitly synchronize both devices.
    await a.page.waitForTimeout(1700);
    await a.page.evaluate(() => AtokoreHousehold.syncNow());
    await b.page.evaluate(() => AtokoreHousehold.syncNow());
    const afterA = await stored(a.page), afterB = await stored(b.page);
    console.info(JSON.stringify({ scenario: 'undo-while-sharing', localUnchanged: JSON.stringify(afterA) === JSON.stringify(beforeA), partnerUnchanged: JSON.stringify(afterB) === JSON.stringify(beforeB) }));
    await expect(a.page.locator('#atkSafetyBanner')).toContainText('家族共有に参加している間');
    expect(afterA).toEqual(beforeA); expect(afterB).toEqual(beforeB);
    expect(await a.page.evaluate(k => localStorage.getItem(k + 'BeforeRestore'), KEY)).toBe(undoBefore);
    expect(a.page.__errors).toEqual([]); expect(b.page.__errors).toEqual([]);
  } finally { await a.ctx.close(); await b.ctx.close(); }
});

test('joining while the undo confirmation is open rechecks membership before changing data or photos', async ({ page }) => {
  await open(page, { [KEY]: baseState(), [KEY + 'BeforeRestore']: { at: 1, data: previous() } });
  const before = await stored(page);
  // This test isolates the membership transition during the asynchronous confirmation.
  await page.evaluate(() => {
    window.__testJoined = false; window.__testPhotoUndo = 0;
    window.AtokoreHousehold = { homeState: () => ({ joined: window.__testJoined }) };
    window.AtokoreProductPhotos = { undoReplace: () => { window.__testPhotoUndo++; } };
    atkOpenBackup();
  });
  await page.click('.atk-backup-undo');
  await expect(page.locator('#atkConfirm')).toBeVisible();
  await page.evaluate(() => { window.__testJoined = true; });
  await appConfirm(page, true);
  console.info(JSON.stringify({ scenario: 'joined-during-confirmation', localUnchanged: JSON.stringify(await stored(page)) === JSON.stringify(before), photoUndoCalls: await page.evaluate(() => window.__testPhotoUndo) }));
  await expect(page.locator('#atkSafetyBanner')).toContainText('家族共有に参加している間');
  expect(await stored(page)).toEqual(before);
  expect(await page.evaluate(() => window.__testPhotoUndo)).toBe(0);
});

test('joining during file-restore confirmation cannot replace saved data or photos', async ({ page }) => {
  await open(page, { [KEY]: baseState() });
  const before = await stored(page);
  const next = baseState({ items: [{ id: 99, name: '合成ファイル内の商品', cat: '日用品', qty: 8, unit: '個' }], buys: [], routines: [] });
  await page.evaluate(() => {
    window.__testJoinedDuringFileRestore = false;
    window.__testPhotoReplacements = 0;
    window.AtokoreHousehold = { homeState: () => ({ joined: window.__testJoinedDuringFileRestore }) };
    window.AtokoreProductPhotos = {
      parsePhotos: () => [],
      countPhotos: async () => 0,
      replaceAll: () => { window.__testPhotoReplacements++; },
    };
    atkOpenBackup();
  });
  const backup = { app: 'atokore', format: 2, data: next, photos: [] };
  await page.setInputFiles('.atk-backup-file', {
    name: 'synthetic-backup.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(backup)),
  });
  // The file was selected before joining; the application must recheck when
  // the async confirmation resolves, not rely on the earlier share status.
  await expect(page.locator('#atkConfirm')).toBeVisible();
  await page.evaluate(() => { window.__testJoinedDuringFileRestore = true; });
  await appConfirm(page, true);
  await expect(page.locator('#atkSafetyBanner')).toContainText('家族共有に参加している間');
  expect(await stored(page)).toEqual(before);
  expect(await page.evaluate(k => localStorage.getItem(k + 'BeforeRestore'), KEY)).toBeNull();
  expect(await page.evaluate(() => window.__testPhotoReplacements)).toBe(0);
  expect(page.__errors).toEqual([]);
});
