// v47 P1 fixes.
// 1) Recurring-list buttons (card "＋ ストックに追加", detail "ストックに追加" / "買い物へ追加", "このリストを削除")
//    used the browser's native confirm(). Where native dialogs are suppressed (in-app browsers, embedded
//    frames, automated review tools) confirm() returns false without showing anything, so the buttons
//    looked dead. They now ask in the app's own dialog. These tests run with native dialogs dismissed
//    immediately, like such an environment.
// 2) "✓ 買った" then "元に戻す" left a 0-quantity stock row when the purchase had created that row.
const { test, expect } = require('@playwright/test');
const { APP, KEY, stored, baseState, open, go, appConfirm } = require('./helpers.cjs');

async function openWithoutNativeDialogs(page, state) {
  page.__errors = []; page.__native = [];
  page.on('pageerror', e => page.__errors.push(String(e)));
  page.on('dialog', d => { page.__native.push(d.message()); d.dismiss(); });
  await page.addInitScript(([k, v]) => { if (!sessionStorage.getItem('__seeded')) { sessionStorage.setItem('__seeded', '1'); localStorage.setItem(k, v); } }, [KEY, JSON.stringify(state)]);
  await page.goto(APP);
  await page.waitForFunction(() => !!document.getElementById('bfNavAdd'));
}
const toBuy = page => page.evaluate(() => window.go('buy'));
const openList = async page => { await toBuy(page); await page.click('[data-bf-routine="901"]'); await expect(page.locator('#atkRoutineStockCommit')).toBeVisible(); };
const toast = page => page.locator('#stableToastV125h');

for (const [width, height] of [[320, 568], [390, 844]]) {
  test.describe(`recurring list buttons ${width}px`, () => {
    test.use({ viewport: { width, height } });

    test('card and detail buttons confirm in the app, then save once and show the result', async ({ page }) => {
      const initial = baseState();
      await openWithoutNativeDialogs(page, initial);
      await toBuy(page);
      // Card: cancel changes nothing.
      await page.click('[data-bf-routine-stock="901"]');
      const asked = await appConfirm(page, false);
      expect(asked).toContain('「ベビー定番」の2種類をストックに追加してもいいですか？');
      expect(asked).toContain('パンパース さらさらケア おむつ テープ M × 2袋');
      expect(await stored(page)).toEqual(initial);
      // Card: confirm adds to stock once and reports it.
      await page.click('[data-bf-routine-stock="901"]');
      await appConfirm(page, true);
      await expect(page.locator('#pg-stock')).toHaveClass(/on/);
      await expect(toast(page)).toContainText('2種類をストックに追加しました');
      let saved = await stored(page);
      expect(saved.items.find(x => x.id === 2).qty).toBe(4);
      expect(saved.buys).toEqual(initial.buys);

      // Card "買い物へ追加" keeps its two-step review screen.
      await toBuy(page);
      await page.click('[data-bf-routine-buy="901"]');
      await expect(page.locator('#qaTray')).toBeVisible();
      expect(await stored(page)).toEqual(saved);
      await page.click('#qaCommit');
      await expect.poll(async () => (await stored(page)).buys.length).toBe(initial.buys.length + 2);
      saved = await stored(page);

      // Detail "ストックに追加".
      await page.waitForTimeout(1400); // past the repeat-tap guard for the same list
      await openList(page);
      await page.click('#atkRoutineStockCommit');
      await appConfirm(page, true);
      await expect(page.locator('#pg-stock')).toHaveClass(/on/);
      await expect(page.locator('#modal')).not.toHaveClass(/on/);
      expect((await stored(page)).items.find(x => x.id === 2).qty).toBe(6);

      // Detail "買い物へ追加".
      saved = await stored(page);
      await openList(page);
      await page.click('#atkRoutineBuyCommit');
      expect(await appConfirm(page, true)).toContain('買い物リストに追加してもいいですか');
      await expect(page.locator('#pg-buy')).toHaveClass(/on/);
      await expect(toast(page)).toContainText('2種類を買い物リストに追加しました');
      const afterBuy = await stored(page);
      expect(afterBuy.items).toEqual(saved.items);
      expect(afterBuy.buys.find(x => x.name === 'パンパース さらさらケア おむつ テープ M').qty)
        .toBe(saved.buys.find(x => x.name === 'パンパース さらさらケア おむつ テープ M').qty + 2);

      expect(page.__native).toEqual([]);
      expect(page.__errors).toEqual([]);
    });

    test('deleting a list confirms in the app, can be cancelled, survives a failed save, and updates the counts', async ({ page }) => {
      const initial = baseState();
      await openWithoutNativeDialogs(page, initial);
      await openList(page);
      // Item delete and rename inside the detail still work as before.
      await page.fill('#routineNameEdit', '週末セット');
      await page.click('.atk-routine-name-save');
      await expect.poll(async () => (await stored(page)).routines[0].name).toBe('週末セット');
      await page.locator('#routineItems .row').filter({ hasText: '牛乳' }).locator('.danger').click();
      await expect.poll(async () => (await stored(page)).routines[0].items.length).toBe(1);
      const kept = await stored(page);

      await page.locator('.atk-routine-manage summary').click();
      await page.click('[onclick^="deleteRoutine("]');
      expect(await appConfirm(page, false)).toContain('「週末セット」を削除しますか？');
      expect(await stored(page)).toEqual(kept);
      await expect(page.locator('#modal')).toHaveClass(/on/);

      await page.evaluate(k => { const set = Storage.prototype.setItem; window.__restore = () => { Storage.prototype.setItem = set; }; Storage.prototype.setItem = function (key, v) { if (key === k) throw new DOMException('full', 'QuotaExceededError'); return set.call(this, key, v); }; }, KEY);
      await page.click('[onclick^="deleteRoutine("]');
      await appConfirm(page, true);
      await expect(page.locator('#atkConfirm')).toContainText('保存できませんでした');
      expect(await stored(page)).toEqual(kept);
      expect(await page.evaluate(() => routines.length)).toBe(1);
      await page.evaluate(() => window.__restore());
      await page.locator('#atkConfirm .atk-confirm-primary').click();
      await expect(page.locator('#atkConfirm')).toHaveCount(0);
      await expect(page.locator('#modal')).not.toHaveClass(/on/);
      await expect(toast(page)).toContainText('「週末セット」を削除しました');
      const after = await stored(page);
      expect(after.routines).toEqual([]);
      expect(after.items).toEqual(kept.items);
      expect(after.buys).toEqual(kept.buys);
      await expect(page.locator('[data-bf-routine="901"]')).toHaveCount(0);
      // The backup screen counts what is stored.
      await page.evaluate(() => window.go('premium'));
      await page.click('#atkBackupCard');
      await expect(page.locator('.atk-backup-count')).toContainText('セット0件');
      await page.reload();
      expect((await stored(page)).routines).toEqual([]);
      expect(page.__native).toEqual([]);
      expect(page.__errors).toEqual([]);
    });
  });
}

test.describe('bought, then undo', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('a product that was only on the shopping list leaves no stock row behind', async ({ page }) => {
    const initial = baseState();
    await open(page, { [KEY]: initial });
    await go(page, 'buy');
    await page.locator('[data-buy-id="10"] .stableBuyStock').click();
    const bought = await stored(page);
    expect(bought.items.filter(x => x.name === 'おしりふき詰替').map(x => x.qty)).toEqual([1]);
    expect(bought.buys).toEqual([]);
    await page.locator('#atkUndoBar button', { hasText: '元に戻す' }).click();
    await expect(page.locator('#atkUndoBar')).toHaveCount(0);
    const undone = await stored(page);
    expect(undone.items).toEqual(initial.items); // no 0-quantity row
    expect(undone.buys).toEqual(initial.buys);
    await go(page, 'stock');
    await expect(page.locator('#stockList')).not.toContainText('おしりふき詰替');
    await page.reload();
    expect((await stored(page)).items).toEqual(initial.items);
    await go(page, 'home');
    await expect(page.locator('#atkHomeAttention')).toBeVisible();
    await expect(page.locator('#atkHomeAttention')).not.toContainText('おしりふき詰替'); // not in the attention list
    expect(page.__errors).toEqual([]);
  });

  test('a product already in stock only gets its quantity back', async ({ page }) => {
    const initial = baseState({ buys: [{ id: 11, name: 'パンパース さらさらケア おむつ テープ M', qty: 1, unit: '袋', cat: 'ベビー', stockId: 2 }] });
    await open(page, { [KEY]: initial });
    await go(page, 'buy');
    await page.locator('[data-buy-id="11"] .stableBuyStock').click();
    expect((await stored(page)).items.find(x => x.id === 2).qty).toBe(3);
    await page.locator('#atkUndoBar button', { hasText: '元に戻す' }).click();
    await expect(page.locator('#atkUndoBar')).toHaveCount(0);
    const undone = await stored(page);
    expect(undone.items).toEqual(initial.items);
    expect(undone.buys.map(x => x.id)).toEqual([11]);
  });

  test('if the new stock row was changed afterwards, undo refuses and changes nothing', async ({ page }) => {
    await open(page, { [KEY]: baseState() });
    await go(page, 'buy');
    await page.locator('[data-buy-id="10"] .stableBuyStock').click();
    const id = (await stored(page)).items.find(x => x.name === 'おしりふき詰替').id;
    // Changed behind the undo bar (e.g. by another screen): 1 → 2.
    await page.evaluate(id => { items.find(x => x.id === id).qty = 2; save(); }, id);
    const changed = await stored(page);
    await page.locator('#atkUndoBar button', { hasText: '元に戻す' }).click();
    await expect(page.locator('#atkUndoBar')).toContainText('戻せません');
    expect(await stored(page)).toEqual(changed);
  });
});
