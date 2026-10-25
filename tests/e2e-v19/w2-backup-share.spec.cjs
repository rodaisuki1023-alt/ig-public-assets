// W2 items 1 and 2: restore is a replacement (warned before and confirmed after choosing a file,
// photos included), restore is not available while sharing, the sharing status is the same on home
// and in the share dialog, and product photos are shared with the family automatically.
const fs = require('node:fs');
const zlib = require('node:zlib');
const { test, expect } = require('@playwright/test');
const { open, go, stored, baseState, KEY, appConfirm } = require('./helpers.cjs');
const EMU = 'http://127.0.0.1:' + (process.env.E2E_HH_PORT || 4720);
const CFG = { url: EMU, anonKey: 'emu-anon-key', google: true, guest: true, email: false };
const DB = 'atokorePreviewProductPhotosV19';

function crc32(data) { let crc = 0xffffffff; for (const b of data) { crc ^= b; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); } return (crc ^ 0xffffffff) >>> 0; }
function chunk(type, data) { const label = Buffer.from(type), size = Buffer.alloc(4), crc = Buffer.alloc(4); size.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(Buffer.concat([label, data]))); return Buffer.concat([size, label, data, crc]); }
function png(red) {
  const header = Buffer.alloc(13); header.writeUInt32BE(40, 0); header.writeUInt32BE(40, 4); header[8] = 8; header[9] = 2;
  const pixels = Buffer.alloc(40 * (1 + 40 * 3)); for (let y = 0; y < 40; y++) for (let x = 0; x < 40; x++) { const i = y * 121 + 1 + x * 3; pixels[i] = red; pixels[i + 1] = 90; pixels[i + 2] = 255 - red; }
  return { name: 'p.png', mimeType: 'image/png', buffer: Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]) };
}
async function setPhoto(page, stockId, red = 200) {
  await go(page, 'stock');
  await page.locator(`#stockList [data-stock-id="${stockId}"] .name`).click();
  await page.click('.atk-photo-open');
  await expect(page.locator('#atkPhotoEditor input[type=checkbox]')).toHaveCount(0); // no "share this photo" choice any more
  await page.locator('#atkPhotoEditor input[type=file]').setInputFiles(png(red));
  await expect(page.locator('.atk-photo-save')).toBeEnabled();
  await page.click('.atk-photo-save');
  await expect(page.locator('.atk-detail-photo')).toBeVisible();
  await page.click('#sheet .close');
}
const photoKeys = page => page.evaluate(async db => {
  const d = await new Promise((res, rej) => { const r = indexedDB.open(db, 1); r.onsuccess = () => res(r.result); r.onerror = rej; });
  const keys = await new Promise((res, rej) => { const r = d.transaction('photos').objectStore('photos').getAllKeys(); r.onsuccess = () => res(r.result); r.onerror = rej; }); d.close();
  return keys.filter(k => k.startsWith('[')).sort();
}, DB);

test.describe('backup and restore', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('restore warns before, compares counts and photos after choosing a file, can be cancelled, and can be undone', async ({ page }, info) => {
    await open(page, { [KEY]: baseState() });
    await setPhoto(page, 2);
    await go(page, 'premium');
    await page.click('#atkBackupCard');
    await expect(page.locator('.atk-backup-warning')).toHaveText('復元すると、今の内容がバックアップの内容に置き換わります。バックアップに入っていない商品やリストは残りません。');
    const [download] = await Promise.all([page.waitForEvent('download'), page.click('.atk-backup-primary')]);
    const file = info.outputPath('backup.json'); await download.saveAs(file);
    const backup = JSON.parse(fs.readFileSync(file, 'utf8'));
    expect(backup.format).toBe(2);
    expect(backup.photos).toHaveLength(1);
    expect(backup.photos[0]).toMatchObject({ id: '2', name: 'パンパース さらさらケア おむつ テープ M', unit: '袋' });
    await expect(page.locator('#atkSafetyBanner')).toContainText('写真1枚を含みます');

    // Change everything: remove a product and the photo, add a list.
    await page.evaluate(() => { closeM(); items = items.filter(x => x.id !== 3); routines.push({ id: 77, name: '追加したリスト', items: [] }); save(); });
    await go(page, 'stock');
    await page.locator('#stockList [data-stock-id="2"] .name').click(); await page.click('.atk-photo-open');
    await page.click('.atk-photo-reset'); await appConfirm(page, true);
    await expect(page.locator('.atk-detail-photo')).toHaveCount(0); await page.click('#sheet .close');
    const changed = await stored(page);
    expect(await photoKeys(page)).toEqual([]);

    await page.evaluate(() => window.atkOpenBackup());
    await page.setInputFiles('.atk-backup-file', file);
    const asked = await appConfirm(page, false);
    expect(asked).toContain('バックアップの内容に置き換えますか？');
    expect(asked).toMatch(/バックアップの作成日時：\d{4}\/\d{1,2}\/\d{1,2}/);
    expect(asked).toContain('ストック：現在 2件 → 復元後 3件');
    expect(asked).toContain('買い物リスト：現在 1件 → 復元後 1件');
    expect(asked).toContain('いつものリスト：現在 2件 → 復元後 1件');
    expect(asked).toContain('写真：現在 0枚 → 復元後 1枚（写真もバックアップの内容に置き換わります）');
    expect(asked).toContain('件数が同じでも中身が異なる場合があります。');
    await expect(page.locator('.atk-backup-status')).toHaveText('復元を中止しました');
    expect(await stored(page)).toEqual(changed);

    await page.setInputFiles('.atk-backup-file', file);
    await appConfirm(page, true);
    await expect(page.locator('#atkSafetyBanner')).toContainText('復元しました');
    expect((await stored(page)).items).toEqual(backup.data.items);
    expect((await stored(page)).routines).toEqual(backup.data.routines);
    await expect.poll(() => photoKeys(page)).toHaveLength(1);
    await go(page, 'stock');
    await expect(page.locator('#stockList [data-stock-id="2"] .atk-user-photo')).toBeVisible();

    // Undo brings back the data and the (photo-less) state before restoring.
    await page.evaluate(() => window.atkOpenBackup());
    await page.click('.atk-backup-undo'); await appConfirm(page, true);
    await expect.poll(async () => (await stored(page)).items.length).toBe(2);
    expect(await stored(page)).toEqual(changed);
    await expect.poll(() => photoKeys(page)).toEqual([]);
    expect(page.__dialogs).toEqual([]);
    expect(page.__errors).toEqual([]);
  });
});

test('sharing: restore is refused with guidance, the status matches on home and in the dialog, photos are shared automatically', async ({ browser, request }, info) => {
  test.setTimeout(120000);
  await request.post(EMU + '/__test/reset');
  async function device(state) { const ctx = await browser.newContext({ ...info.project.use, baseURL: info.project.use.baseURL, viewport: { width: 390, height: 844 } }); const page = await ctx.newPage(); await page.addInitScript(c => window.ATOKORE_HOUSEHOLD_CONFIG = c, CFG); await open(page, { [KEY]: state }); return { ctx, page }; }
  const a = await device(baseState()), b = await device({ items: [], buys: [], routines: [] });
  try {
    // Before sharing: single use.
    await expect(a.page.locator('#atkHomeLastSync')).toHaveText('この端末だけで利用中');
    await setPhoto(a.page, 2, 220); // a photo from before sharing
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

    // The photo from before sharing reaches the partner without any extra step.
    const findDiaper = async page => (await stored(page)).items.find(x => x.name === 'パンパース さらさらケア おむつ テープ M');
    await expect.poll(async () => { await a.page.evaluate(() => AtokoreHousehold.syncNow()); return !!(await findDiaper(a.page))?.photoPath; }, { timeout: 20000 }).toBe(true);
    await b.page.evaluate(() => AtokoreHousehold.syncNow());
    await go(b.page, 'stock');
    await expect(b.page.locator(`#stockList [data-stock-id="${(await findDiaper(b.page)).id}"] .atk-user-photo`)).toBeVisible();

    // A photo set while sharing is shared at once.
    await setPhoto(a.page, 3, 40);
    await expect.poll(async () => { await a.page.evaluate(() => AtokoreHousehold.syncNow()); return !!(await stored(a.page)).items.find(x => x.id === 3).photoPath; }, { timeout: 20000 }).toBe(true);
    await b.page.evaluate(() => AtokoreHousehold.syncNow());
    const eggB = (await stored(b.page)).items.find(x => x.name === '卵');
    await go(b.page, 'stock');
    await expect(b.page.locator(`#stockList [data-stock-id="${eggB.id}"] .atk-user-photo`)).toBeVisible();

    // Status: same summary on home and in the dialog, with names and "this device".
    await go(a.page, 'home');
    // Members are re-read on sync (at most every 20 s), so the partner who just joined appears.
    await expect.poll(async () => { await a.page.evaluate(() => AtokoreHousehold.syncNow()); return a.page.locator('#atkHouseholdChip').textContent(); }, { timeout: 30000, intervals: [2000] }).toBe('2人で共有中');
    await a.page.click('#atkHouseholdChip');
    await expect(a.page.locator('#atkHouseholdStatus')).toHaveText('2人で共有中');
    await expect(a.page.locator('#atkHouseholdDetail')).toContainText('参加中：パパ、ママ');
    await expect(a.page.locator('#atkHouseholdDetail')).toContainText('この端末で利用中：パパ');
    await a.page.getByRole('button', { name: '閉じる', exact: true }).click();

    // Not yet sent: both places say so and offer "今すぐ同期".
    await a.ctx.setOffline(true);
    await a.page.evaluate(() => { const x = items.find(x => x.id === 1); x.qty += 1; save(); });
    await expect(a.page.locator('#atkHouseholdChip')).toHaveText('家族と共有中・未送信あり', { timeout: 10000 });
    await expect(a.page.locator('#atkHomeSyncNow')).toBeVisible();
    await expect(a.page.locator('#atkHomeSyncNow')).toHaveText('今すぐ同期');
    await a.page.click('#atkHouseholdChip');
    await expect(a.page.locator('#atkHouseholdStatus')).toHaveText('家族と共有中・未送信あり');
    await expect(a.page.locator('#atkHouseholdDetail')).toContainText('未送信の変更 1件');
    await a.page.getByRole('button', { name: '閉じる', exact: true }).click();
    await a.page.click('#atkHomeSyncNow'); // still offline: stays "not yet sent", nothing is lost
    await expect(a.page.locator('#atkHouseholdChip')).toHaveText('家族と共有中・未送信あり');
    await a.ctx.setOffline(false); // back online: sent automatically
    await expect.poll(async () => { await a.page.evaluate(() => AtokoreHousehold.syncNow()); return a.page.locator('#atkHouseholdChip').textContent(); }, { timeout: 20000, intervals: [1000] }).toBe('2人で共有中');
    await b.page.evaluate(() => AtokoreHousehold.syncNow());
    expect((await stored(b.page)).items.find(x => x.name === '牛乳').qty).toBe((await stored(a.page)).items.find(x => x.id === 1).qty);

    // Cannot confirm (offline, nothing waiting): says so, shows the last confirmed state and a re-check.
    await a.ctx.setOffline(true);
    await a.page.evaluate(() => AtokoreHousehold.syncNow());
    await expect(a.page.locator('#atkHouseholdChip')).toHaveText('共有状態を確認できません');
    await expect(a.page.locator('#atkHomeSyncNow')).toHaveText('再確認');
    await expect(a.page.locator('#atkHomeLastSync')).toContainText('最後に確認');
    await a.page.click('#atkHouseholdChip');
    await expect(a.page.locator('#atkHouseholdStatus')).toHaveText('共有状態を確認できません');
    await expect(a.page.locator('#atkHouseholdDetail')).toContainText('最後に確認した状態：');
    await expect(a.page.locator('#atkHouseholdDetail')).toContainText('2人で共有中');
    await expect(a.page.locator('#atkHouseholdSyncNow')).toHaveText('再確認する');
    await a.page.getByRole('button', { name: '閉じる', exact: true }).click();
    await a.ctx.setOffline(false);
    await expect.poll(async () => { await a.page.evaluate(() => AtokoreHousehold.syncNow()); return a.page.locator('#atkHouseholdChip').textContent(); }, { timeout: 20000, intervals: [1000] }).toBe('2人で共有中');

    // Restore is refused while sharing; saving a backup still works.
    await go(b.page, 'premium'); await b.page.click('#atkBackupCard');
    await b.page.click('.atk-backup-secondary:text("バックアップから復元")');
    await expect(b.page.locator('.atk-backup-blocked')).toBeVisible();
    await expect(b.page.locator('.atk-backup-blocked')).toContainText('家族共有に参加している間は、この端末のファイルから復元できません');
    await expect(b.page.getByRole('button', { name: '共有に再接続する' })).toBeVisible();
    await expect(b.page.getByRole('button', { name: '共有を抜けてから復元する' })).toBeVisible();
    const before = await stored(b.page);
    const backupFile = info.outputPath('b.json');
    const [download] = await Promise.all([b.page.waitForEvent('download'), b.page.click('.atk-backup-primary')]);
    await download.saveAs(backupFile);
    const saved = JSON.parse(fs.readFileSync(backupFile, 'utf8'));
    expect(saved.photos.length).toBe(2); // family photos are included even though this device never set them
    // Even if a file reaches the input, nothing is restored while sharing.
    await b.page.setInputFiles('.atk-backup-file', backupFile).catch(() => {});
    await b.page.waitForTimeout(500);
    await expect(b.page.locator('#atkConfirm')).toHaveCount(0);
    expect(await stored(b.page)).toEqual(before);
    await b.page.getByRole('button', { name: '共有を抜けてから復元する' }).click();
    await expect(b.page.locator('#atkHouseholdStatus')).toBeVisible();
    expect(a.page.__errors).toEqual([]); expect(b.page.__errors).toEqual([]);
  } finally { await a.ctx.close(); await b.ctx.close(); }
});
