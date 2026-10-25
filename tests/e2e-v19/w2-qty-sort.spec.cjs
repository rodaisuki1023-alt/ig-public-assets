// W2 item 8: quantity limits by unit (larger saved quantities kept), quantities never clipped,
// one category label per row, and stock sort orders that are always shown and remembered.
const { test, expect } = require('@playwright/test');
const { open, go, stored, baseState, KEY, shot } = require('./helpers.cjs');

const ids = page => page.locator('#stockList [data-stock-id]').evaluateAll(rows => rows.map(r => Number(r.dataset.stockId)));
const plus = (page, id) => page.locator(`#stockList [data-stock-id="${id}"] .qty button`).last();
const minus = (page, id) => page.locator(`#stockList [data-stock-id="${id}"] .qty button`).first();
const qtyOf = async (page, id) => (await stored(page)).items.find(x => x.id === id).qty;

test.describe('limits', () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test('＋ stops at the unit limit; a larger saved quantity is kept, can go down and other fields still save', async ({ page }) => {
    await open(page, { [KEY]: baseState({ items: [
      { id: 1, name: '牛乳', cat: '食料品', qty: 998, unit: '本', place: '冷蔵庫', expType: '期限なし', exp: '' },
      { id: 2, name: 'おしりふき', cat: 'ベビー', qty: 9999, unit: '枚', place: '収納', expType: '期限なし', exp: '' },
      { id: 3, name: '米', cat: '食料品', qty: 99999, unit: 'g', place: '棚', expType: '期限なし', exp: '' },
      { id: 4, name: '紙コップ', cat: '日用品', qty: 1500, unit: '個', place: '棚', expType: '期限なし', exp: '' },
    ], buys: [{ id: 9, name: '卵', qty: 999, unit: 'パック', cat: '食料品' }], routines: [] }) });
    await go(page, 'stock');
    await page.click('[data-atk-view="list"]');
    await plus(page, 1).click();
    await expect.poll(() => qtyOf(page, 1)).toBe(999);
    await expect(plus(page, 1)).toBeDisabled();
    await expect(plus(page, 2)).toBeDisabled();
    await expect(plus(page, 3)).toBeDisabled();
    // Existing 1500個 is above 999: kept as is, ＋ disabled, − still works.
    await expect(page.locator('#stockList [data-stock-id="4"] .qty b')).toHaveText('1500個');
    await expect(plus(page, 4)).toBeDisabled();
    await minus(page, 4).click();
    await expect.poll(() => qtyOf(page, 4)).toBe(1499);
    // Calling the action directly is refused too, with a message.
    await page.evaluate(() => adj(1, 1));
    expect(await qtyOf(page, 1)).toBe(999);

    // Edit: other fields save without touching the kept quantity; raising it is refused; reducing works.
    const edit = async (values) => {
      await page.evaluate(() => atokoreEditStock(4));
      for (const [name, value] of Object.entries(values)) await page.fill(`#atkEditForm [name="${name}"]`, String(value));
      await page.click('#atkEditForm .atk-edit-save');
    };
    await edit({ name: '紙コップ 大' });
    await expect.poll(async () => (await stored(page)).items.find(x => x.id === 4)).toMatchObject({ name: '紙コップ 大', qty: 1499 });
    await page.evaluate(() => atokoreEditStock(4));
    await page.locator('#atkEditForm [name="qty"]').evaluate(el => { el.removeAttribute('max'); el.value = '1600'; });
    await page.click('#atkEditForm .atk-edit-save');
    await expect(page.locator('#atkEditError')).toHaveText('今の在庫数（1,499個）は上限の999個を超えています。この数のまま保存するか減らすことはできますが、増やすことはできません。');
    expect(await qtyOf(page, 4)).toBe(1499);
    await page.fill('#atkEditForm [name="qty"]', '1200');
    await page.click('#atkEditForm .atk-edit-save');
    await expect.poll(() => qtyOf(page, 4)).toBe(1200);
    // A normal row cannot be raised above its unit limit by editing; 枚 and g allow their larger limits.
    await page.evaluate(() => atokoreEditStock(1));
    await expect(page.locator('#atkEditForm [name="qty"]')).toHaveAttribute('max', '999');
    await page.selectOption('#atkEditForm [name="unit"]', 'g');
    await expect(page.locator('#atkEditForm [name="qty"]')).toHaveAttribute('max', '99999');
    await page.selectOption('#atkEditForm [name="unit"]', '本');
    await page.locator('#atkEditForm [name="qty"]').evaluate(el => { el.removeAttribute('max'); el.value = '1000'; });
    await page.click('#atkEditForm .atk-edit-save');
    await expect(page.locator('#atkEditError')).toHaveText('在庫数は0〜999の整数で入力してください（単位「本」の上限）');
    await page.click('#sheet .close');

    // Shopping list ＋ follows the same limit.
    await go(page, 'buy');
    await expect(page.locator('#buyList [data-buy-id="9"] .qty button').last()).toBeDisabled();
    await page.evaluate(() => badj(9, 1));
    expect((await stored(page)).buys[0].qty).toBe(999);
    expect(page.__errors).toEqual([]);
  });
});

test.describe('display at 320px', () => {
  test.use({ viewport: { width: 320, height: 700 } });
  test('large quantities are shown in full and never overlap −／＋; each row shows its category once', async ({ page }, info) => {
    await open(page, { [KEY]: baseState({ items: [
      { id: 1, name: '米', cat: '食料品', qty: 99999, unit: 'g', place: '棚', expType: '期限なし', exp: '' },
      { id: 2, name: 'おしりふき', cat: 'ベビー', qty: 9999, unit: '枚', place: '収納', expType: '期限なし', exp: '' },
      { id: 3, name: '紙コップ', cat: '日用品', qty: 1234567, unit: 'パック', expType: '期限なし', exp: '' },
      { id: 4, name: 'パンパース さらさらケア テープ M', cat: 'ベビー', qty: 2, unit: '袋', place: '収納', expType: '期限なし', exp: '' },
    ], buys: [
      { id: 9, name: 'おしりふき', qty: 9999, unit: '枚', cat: 'ベビー' },
      { id: 10, name: '米', qty: 99999, unit: 'g', cat: '食料品' },
      { id: 11, name: 'パンパース さらさらケア テープ M', qty: 1, unit: '袋', cat: 'ベビー' },
    ], routines: [] }) });
    const check = (rowSel) => page.evaluate(sel => [...document.querySelectorAll(sel)].map(row => {
      const shown = [...row.querySelectorAll('.qty b, .bf-stock-count')].filter(e => getComputedStyle(e).display !== 'none' && e.offsetParent);
      const box = row.getBoundingClientRect();
      return shown.map(e => {
        const r = e.getBoundingClientRect();
        const buttons = [...(e.closest('.qty')?.querySelectorAll('button') || [])].map(b => b.getBoundingClientRect());
        return { text: e.textContent, clipped: e.scrollWidth > e.clientWidth + 1, overlap: buttons.some(b => r.left < b.right - 0.5 && r.right > b.left + 0.5 && r.top < b.bottom && r.bottom > b.top), inside: r.left >= box.left - 0.5 && r.right <= box.right + 0.5 };
      });
    }).flat(), rowSel);
    const cats = (rowSel) => page.evaluate(sel => [...document.querySelectorAll(sel)].map(row => ({
      labels: [...row.querySelectorAll('.atk-row-cat')].map(e => e.textContent),
      badge: row.querySelector('.atk-row-brand')?.textContent.trim() || '',
      meta: [...row.querySelectorAll('.grow > .meta')].map(e => e.textContent.trim()).filter(Boolean),
    })), rowSel);
    await go(page, 'stock');
    for (const view of ['cards', 'list']) {
      await page.click(`[data-atk-view="${view}"]`);
      const res = await check('#stockList [data-stock-id]');
      expect(res.length).toBeGreaterThan(0);
      for (const r of res) expect(r, view + ' ' + r.text).toMatchObject({ clipped: false, overlap: false, inside: true });
      expect(res.map(r => r.text).join(' ')).toContain('1234567パック');
      const c = await cats('#stockList [data-stock-id]');
      expect(c.map(x => x.labels)).toEqual([['ベビー'], ['ベビー'], ['食料品'], ['日用品']]);
      for (const x of c) { expect(x.meta).not.toContain(x.labels[0]); expect(x.badge).not.toBe(x.labels[0]); }
      await shot(page, info, 'w2-qty-320-' + view);
    }
    await go(page, 'buy');
    const res = await check('#buyList [data-buy-id]');
    for (const r of res) expect(r, 'buy ' + r.text).toMatchObject({ clipped: false, overlap: false, inside: true });
    const c = await cats('#buyList [data-buy-id]');
    expect(c.map(x => x.labels)).toEqual([['ベビー'], ['食料品'], ['ベビー']]);
    for (const x of c) { expect(x.meta).not.toContain(x.labels[0]); expect(x.badge).not.toBe(x.labels[0]); }
    await shot(page, info, 'w2-qty-320-buy');
    expect(page.__errors).toEqual([]);
  });
});

test.describe('sort', () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test('default category → name; the chosen order is always shown, runs across categories and is remembered', async ({ page }) => {
    const iso = d => [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');
    const day = n => { const d = new Date(); d.setDate(d.getDate() + n); return iso(d); };
    await open(page, { [KEY]: baseState({ items: [
      { id: 1, name: '牛乳', cat: '食料品', qty: 3, unit: '本', expType: '消費期限', exp: day(2) },
      { id: 2, name: 'おしりふき', cat: 'ベビー', qty: 5, unit: 'パック', expType: '期限なし', exp: '' },
      { id: 3, name: 'ヨーグルト', cat: '食料品', qty: 0, unit: '個', minQty: 2, expType: '消費期限', exp: day(0) },
      { id: 4, name: 'ゆで卵', cat: '食料品', qty: 6, unit: '個', expType: '賞味期限', exp: day(-3) },
      { id: 5, name: 'ティッシュ', cat: '日用品', qty: 1, unit: '箱', expType: '期限なし', exp: '' },
      { id: 6, name: 'あかちゃん綿棒', cat: 'ベビー', qty: 4, unit: '個', expType: '期限なし', exp: '' },
    ], buys: [{ id: 9, name: 'b-first', qty: 1, unit: '個' }, { id: 8, name: 'a-second', qty: 1, unit: '個' }], routines: [] }) });
    await go(page, 'stock');
    const label = page.locator('#atkStockSort .atk-sort-current');
    await expect(label).toHaveText('並び順：カテゴリー別');
    expect(await ids(page)).toEqual([6, 2, 4, 3, 1, 5]); // ベビー(あ…, お…) 食料品(ゆ, ヨ, 牛乳) 日用品
    await page.click('[data-atk-view="list"]');
    await expect(page.locator('.atk-stock-category')).toHaveText(['ベビー（2商品）', '食料品（3商品）', '日用品（1商品）']);

    await page.selectOption('#atkStockSort select', 'expiry');
    await expect(label).toHaveText('並び順：期限が近い順');
    expect(await ids(page)).toEqual([4, 3, 1, 6, 2, 5]); // overdue, today, in 2 days, then no expiry by category
    await expect(page.locator('.atk-stock-category')).toHaveCount(0); // across categories

    await page.selectOption('#atkStockSort select', 'refill');
    await expect(label).toHaveText('並び順：補充が必要な順');
    expect((await ids(page)).slice(0, 2)).toEqual([3, 5]); // 0/2 then 1/1

    await page.selectOption('#atkStockSort select', 'added');
    await expect(label).toHaveText('並び順：追加した順（新しい順）');
    expect(await ids(page)).toEqual([6, 5, 4, 3, 2, 1]);

    // Filters and search keep the order; the choice survives a reload.
    await page.selectOption('#atkStockSort select', 'expiry');
    await page.evaluate(() => setFilter('食料品'));
    expect(await ids(page)).toEqual([4, 3, 1]);
    await page.reload(); await page.waitForFunction(() => !!document.getElementById('bfNavAdd'));
    await go(page, 'stock');
    await expect(page.locator('#atkStockSort .atk-sort-current')).toHaveText('並び順：期限が近い順');
    await expect(page.locator('#atkStockSort select')).toHaveValue('expiry');

    // The shopping list keeps the order things were added.
    await go(page, 'buy');
    expect(await page.locator('#buyList [data-buy-id]').evaluateAll(r => r.map(x => Number(x.dataset.buyId)))).toEqual([9, 8]);
    expect(page.__errors).toEqual([]);
  });
});
