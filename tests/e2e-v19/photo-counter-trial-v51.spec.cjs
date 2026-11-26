// Muse P2-8: the photo-slot counter can be checked from the normal photo screen with a clearly
// labelled TRIAL display (お試し setting, synthetic, this device only). Photo gate stays OFF; nothing
// is shared, contracted or enforced by a server here.
const zlib = require('node:zlib');
const { test, expect } = require('@playwright/test');
const { open, go, baseState, KEY } = require('./helpers.cjs');
function crc32(data) { let crc = 0xffffffff; for (const b of data) { crc ^= b; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); } return (crc ^ 0xffffffff) >>> 0; }
function chunk(type, data) { const label = Buffer.from(type), size = Buffer.alloc(4), crc = Buffer.alloc(4); size.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(Buffer.concat([label, data]))); return Buffer.concat([size, label, data, crc]); }
function png(red) {
  const header = Buffer.alloc(13); header.writeUInt32BE(40, 0); header.writeUInt32BE(40, 4); header[8] = 8; header[9] = 2;
  const pixels = Buffer.alloc(40 * (1 + 40 * 3)); for (let y = 0; y < 40; y++) for (let x = 0; x < 40; x++) { const i = y * 121 + 1 + x * 3; pixels[i] = red; pixels[i + 1] = 90; pixels[i + 2] = 255 - red; }
  return { name: 'p.png', mimeType: 'image/png', buffer: Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]) };
}
const many = () => baseState({ items: [1, 2, 3, 4, 5, 6].map(id => ({ id, name: 'テスト用 商品' + id, cat: '日用品', qty: 1, unit: '個' })), buys: [], routines: [] });
async function setPhoto(page, id, red) {
  await page.evaluate(i => window.atkShowDetail(i), id);
  await page.click('.atk-photo-open');
  await page.locator('#atkPhotoEditor input[type=file]').setInputFiles(png(red));
  await expect(page.locator('.atk-photo-save')).toBeEnabled();
  await page.click('.atk-photo-save');
  await expect(page.locator('.atk-detail-photo')).toBeVisible();
  await page.click('#sheet .close');
}
async function counter(page, id, trial = true) {
  await page.evaluate(i => window.atkShowDetail(i), id);
  await page.click('.atk-photo-open');
  const c = page.locator('#atkPhotoCount');
  await expect(c).toBeVisible();
  // The trial count is read from this device's photos asynchronously.
  if (trial) await expect(c).toContainText('【試用表示'); else await expect(c).not.toContainText('【試用表示');
  const text = await c.textContent();
  await page.click('#atkPhotoEditor .close');
  return text;
}
test('photo counter: off by default (device only); trial display shows 5/20, full, replace and plan-ended wording', async ({ page }) => {
  await open(page, { [KEY]: many() });
  // Default: device-only wording, no slot numbers.
  expect(await counter(page, 1, false)).toContain('この端末だけに保存されます');
  await go(page, 'premium');
  await page.selectOption('#atkPhotoPreviewPlan', 'free');
  expect(await counter(page, 1)).toMatch(/^【試用表示・合成データ】共有写真 0\/5枚.*あと5枚.*実際の家族共有・契約・サーバーの上限ではありません/);
  for (let id = 1; id <= 5; id++) await setPhoto(page, id, 40 * id);
  expect(await counter(page, 6)).toMatch(/共有写真 5\/5枚.*上限に達しています。新しい写真は共有できません（差し替えはできます）/);
  expect(await counter(page, 3)).toMatch(/共有写真 5\/5枚.*差し替えは、枠を増やしません/);
  await go(page, 'premium');
  await page.selectOption('#atkPhotoPreviewPlan', 'premium');
  expect(await counter(page, 6)).toMatch(/共有写真 5\/20枚・有料プラン.*あと15枚/);
  await setPhoto(page, 6, 250);
  await go(page, 'premium');
  await page.selectOption('#atkPhotoPreviewPlan', 'ended');
  const ended = await counter(page, 6);
  expect(ended).toMatch(/^【試用表示・合成データ：有料プラン終了後】共有写真 6\/5枚.*差し替えは、枠を増やしません/);
  // A product without a photo while above the limit: nothing is deleted, new sharing stops.
  await page.evaluate(() => { items.push({ id: 7, name: 'テスト用 商品7', cat: '日用品', qty: 1, unit: '個' }); save(); renderStock(); });
  expect(await counter(page, 7)).toMatch(/共有写真 6\/5枚.*上限を超えています。今ある写真は消えませんが、新しい写真は共有できません/);
  await go(page, 'premium');
  await page.selectOption('#atkPhotoPreviewPlan', '');
  expect(await counter(page, 7, false)).toContain('この端末だけに保存されます');
  expect(page.__errors).toEqual([]);
});

// Muse 4th: the counter must be reachable by the normal path only — stock list → tap the product →
// 写真を設定 (商品の写真) → choose the trial plan right there. No お試し page, no gate, no network.
test('photo counter: normal path (stock row tap → 商品の写真) with the trial switch inside the photo screen', async ({ page }) => {
  const requests = [];
  page.on('request', r => { const u = new URL(r.url()); if (!['127.0.0.1', 'localhost'].includes(u.hostname) && u.protocol.startsWith('http')) requests.push(r.url()); });
  await open(page, { [KEY]: many() });
  const photo = async id => {
    await go(page, 'stock');
    await page.locator(`#stockList [data-stock-id="${id}"] .name`).first().click();
    await page.getByRole('button', { name: /写真を(設定|変更)/ }).click();
    await expect(page.getByRole('heading', { name: '商品の写真' })).toBeVisible();
  };
  await photo(1);
  const c = page.locator('#atkPhotoCount');
  await expect(c).toContainText('この端末だけに保存されます');
  await page.locator('.atk-photo-trial > summary').click();
  await page.locator('.atk-photo-trial-plan').selectOption('free');
  await expect(c).toHaveText(/^【試用表示・合成データ】共有写真 0\/5枚.*実際の家族共有・契約・サーバーの上限ではありません/);
  // The choice is remembered (one setting, also shown on the お試し page) and survives a reload.
  await page.reload();
  await photo(1);
  await expect(c).toContainText('【試用表示・合成データ】共有写真 0/5枚');
  await expect(page.locator('.atk-photo-trial-plan')).toHaveValue('free');
  await page.locator('.atk-photo-trial-plan').selectOption('premium');
  await expect(c).toContainText('共有写真 0/20枚・有料プラン');
  await page.locator('.atk-photo-trial-plan').selectOption('ended');
  await expect(c).toContainText('【試用表示・合成データ：有料プラン終了後】共有写真 0/5枚');
  await page.locator('.atk-photo-trial-plan').selectOption('');
  await expect(c).toContainText('この端末だけに保存されます');
  await expect(c).not.toContainText('試用表示');
  await go(page, 'premium');
  await expect(page.locator('#atkPhotoPreviewPlan')).toHaveValue('');
  expect(requests).toEqual([]);
  expect(await page.evaluate(() => [window.AtokoreHousehold?.photoSharingEnabled?.(), window.AtokoreHousehold?.homeState?.().joined])).toEqual([false, false]);
  expect(page.__errors).toEqual([]);
});
