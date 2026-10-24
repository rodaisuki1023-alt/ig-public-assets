const fs = require('node:fs');
const { test, expect } = require('@playwright/test');
const { open, go, stored, chooseBaby, baseState, KEY, HISTORY, shot, commitBatch } = require('./helpers.cjs');

// Make every write of the trial's main record fail, as a full or locked storage would.
const breakStorage = page => page.evaluate(k => {
  const original = Storage.prototype.setItem;
  window.__restoreStorage = () => { Storage.prototype.setItem = original; };
  Storage.prototype.setItem = function (key, value) {
    if (String(key).startsWith(k)) throw new DOMException('quota', 'QuotaExceededError');
    return original.call(this, key, value);
  };
}, KEY);
const raw = page => page.evaluate(k => localStorage.getItem(k), KEY);

test.describe('save failures never look like success', () => {
  test('stock +/-, delete, quick-add, edit and sets keep the saved state and say so', async ({ page }, testInfo) => {
    await open(page, { [KEY]: baseState() });
    await go(page, 'stock');
    const before = await raw(page);
    await breakStorage(page);

    // + on 牛乳
    await page.locator('#stockList [data-stock-id="1"] button.icon', { hasText: '＋' }).click();
    await expect(page.locator('#atkSafetyBanner')).toBeVisible();
    await expect(page.locator('#atkSafetyBanner')).toContainText('保存できませんでした');
    await expect(page.locator('#stockList [data-stock-id="1"]')).toContainText('1');
    expect(await page.evaluate(() => items.find(x => x.id === 1).qty)).toBe(1);
    await expect(page.locator('#stableToastV125h.on')).toHaveCount(0);
    await shot(page, testInfo, 'save-failure-banner');

    // delete (confirm accepted) keeps the item
    await page.evaluate(() => window.delItem(3));
    await page.getByRole('button',{name:'削除する',exact:true}).click();
    await page.getByRole('button',{name:'キャンセル',exact:true}).click();
    expect(await page.evaluate(() => items.some(x => x.id === 3))).toBe(true);

    // quick add commit keeps the tray and does not touch storage
    await page.click('#bfNavAdd');
    await chooseBaby(page, { kind: 'diaper', brand: 'メリーズ', type: 'テープ', size: 'S' });
    await commitBatch(page);
    await expect(page.locator('#qaNotice')).toContainText('保存できませんでした');
    expect(await page.evaluate(() => AtokoreQuickAdd.getTray().length)).toBe(1);

    // edit form shows a readable error and keeps the record
    await page.evaluate(() => window.atokoreEditStock(2));
    await page.fill('#atkEditForm input[name="qty"]', '9');
    await page.click('.atk-edit-save');
    await expect(page.locator('#atkEditError')).toContainText('空き容量');
    expect(await page.evaluate(() => items.find(x => x.id === 2).qty)).toBe(2);

    // set creation through the legacy routine flow
    await page.evaluate(() => { window.closeM(); window.newRoutine(); });
    await page.fill('#newRoutineName', '失敗テスト');
    await page.evaluate(() => window.createRoutine());
    expect(await page.evaluate(() => routines.some(r => r.name === '失敗テスト'))).toBe(false);

    expect(await raw(page)).toBe(before);

    // once storage works again the same actions succeed
    await page.evaluate(() => window.__restoreStorage());
    await page.evaluate(() => window.closeM());
    await go(page, 'stock');
    await page.locator('#stockList [data-stock-id="1"] button.icon', { hasText: '＋' }).click();
    expect((await stored(page)).items.find(x => x.id === 1).qty).toBe(2);
  });

  test('unreadable data that cannot be set aside is never overwritten by any save path', async ({ page }) => {
    // Only the backup write fails (e.g. storage nearly full); everything else works.
    await page.addInitScript(() => {
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (String(key).includes('Unreadable')) throw new DOMException('quota', 'QuotaExceededError');
        return original.call(this, key, value);
      };
    });
    await open(page, { [KEY]: '{broken json', atokorePreviewTrialV17: JSON.stringify({ items: [{ id: 1, name: 'v17', qty: 1 }], buys: [], routines: [] }) });
    await expect(page.locator('#atkSafetyBanner')).toContainText('保存を止めています');
    expect(await raw(page)).toBe('{broken json');

    await go(page, 'stock');
    await page.locator('#stockList [data-stock-id] button.icon', { hasText: '＋' }).first().click();
    expect(await raw(page)).toBe('{broken json');

    await page.click('#bfNavAdd');
    await chooseBaby(page, { kind: 'diaper', brand: 'メリーズ', type: 'テープ', size: 'S' });
    await commitBatch(page);
    await expect(page.locator('#qaNotice')).toContainText('保存できませんでした');
    expect(await raw(page)).toBe('{broken json');

    const id = await page.evaluate(() => items[0].id);
    await page.evaluate(id => window.atokoreEditStock(id), id);
    await page.click('.atk-edit-save');
    await expect(page.locator('#atkEditError')).toContainText('保存を止めています');
    expect(await raw(page)).toBe('{broken json');

    await page.evaluate(() => { window.closeM(); window.atkOpenBackup(); });
    const [download] = await Promise.all([page.waitForEvent('download'), page.click('text=読み込めなかった元のデータをファイルに保存')]);
    const file = test.info().outputPath('unreadable.txt');
    await download.saveAs(file);
    expect(fs.readFileSync(file, 'utf8')).toBe('{broken json');
  });

  test('unreadable saved data is moved aside, never deleted', async ({ page }) => {
    await open(page, { [KEY]: '{broken json' });
    await expect(page.locator('#atkSafetyBanner')).toContainText('退避');
    const aside = await page.evaluate(k => Object.keys(localStorage).filter(x => x.startsWith(k + 'Unreadable')).map(x => localStorage.getItem(x)), KEY);
    expect(aside).toEqual(['{broken json']);
  });
});

test.describe('copy from the previous trial', () => {
  const v17 = { items: [{ id: 1, name: '前の試用版の在庫', cat: '食料品', qty: 3, unit: '個' }], buys: [], routines: [{ id: 2, name: '前のセット', items: [] }] };

  test('v17 data is copied once and the v17 original is untouched', async ({ page }) => {
    await open(page, { atokorePreviewTrialV17: v17, atokorePreviewHistoryV17: [{ id: 1, ts: 1, title: '前の履歴', detail: '' }] });
    expect(await stored(page)).toEqual(v17);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('atokorePreviewTrialV17')))).toEqual(v17);
    expect(await page.evaluate(h => JSON.parse(localStorage.getItem(h))[0].title, HISTORY)).toBe('前の履歴');
    await expect(page.locator('#atkSafetyBanner')).toContainText('コピー');
    await page.evaluate(() => { items[0].qty = 5; save(); });
    await page.reload();
    expect((await stored(page)).items[0].qty).toBe(5);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('atokorePreviewTrialV17')).items[0].qty)).toBe(3);
  });

  test('existing v19 data is never overwritten by an older trial', async ({ page }) => {
    const mine = baseState();
    await open(page, { [KEY]: mine, atokorePreviewTrialV17: v17 });
    expect((await stored(page)).items.map(x => x.name)).toEqual(mine.items.map(x => x.name));
  });
});

test.describe('backup and restore', () => {
  test('export, change, restore, and undo the restore', async ({ page }, testInfo) => {
    await open(page, { [KEY]: baseState() });
    await go(page, 'premium');
    await page.click('#atkBackupCard');
    await shot(page, testInfo, 'backup-sheet');
    const [download] = await Promise.all([page.waitForEvent('download'), page.click('.atk-backup-primary')]);
    const file = testInfo.outputPath('backup.json');
    await download.saveAs(file);
    const backup = JSON.parse(fs.readFileSync(file, 'utf8'));
    expect(backup.app).toBe('atokore');
    expect(backup.data.items).toHaveLength(3);

    await page.evaluate(() => { window.closeM(); items = items.filter(x => x.id !== 3); save(); });
    expect((await stored(page)).items).toHaveLength(2);

    await page.evaluate(() => window.atkOpenBackup());
    await page.setInputFiles('.atk-backup-file', file);
    await expect(page.locator('#atkSafetyBanner')).toContainText('復元しました');
    expect((await stored(page)).items).toHaveLength(3);
    expect(page.__dialogs.some(m => m.includes('置き換えます'))).toBe(true);

    await page.evaluate(() => window.atkOpenBackup());
    await page.click('.atk-backup-undo');
    expect((await stored(page)).items).toHaveLength(2);
  });

  test('a file that is not an Atokore backup changes nothing', async ({ page }, testInfo) => {
    await open(page, { [KEY]: baseState() });
    const before = await raw(page);
    const bad = testInfo.outputPath('bad.json');
    fs.writeFileSync(bad, JSON.stringify({ hello: 'world' }));
    await page.evaluate(() => window.atkOpenBackup());
    await page.setInputFiles('.atk-backup-file', bad);
    await expect(page.locator('.atk-backup-status')).toContainText('バックアップファイルではありません');
    expect(await raw(page)).toBe(before);
  });
});
