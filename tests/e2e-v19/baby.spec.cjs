const { test, expect } = require('@playwright/test');
const { open, go, stored, chooseBaby, shot, commitBatch } = require('./helpers.cjs');

const options = (page, field) => page.$$eval(`#qaBaby [data-qa-baby="${field}"]`, els => els.map(e => e.dataset.value));
const pick = (page, field, value) => page.click(`[data-qa-baby="${field}"][data-value="${value}"]`);

test('newborn size is offered for tape only, and switching to pants clears it', async ({ page }) => {
  await open(page);
  await page.click('#bfNavAdd');
  await pick(page, 'brand', 'パンパース');
  await pick(page, 'type', 'パンツ');
  expect(await options(page, 'size')).not.toContain('新生児');
  await pick(page, 'type', 'テープ');
  expect(await options(page, 'size')).toContain('新生児');
  await pick(page, 'size', '新生児');
  await pick(page, 'type', 'パンツ');
  await expect(page.locator('#qaNotice')).toContainText('新生児サイズはテープタイプのみ');
  expect(await page.$$eval('#qaBaby [data-qa-baby="size"].selected', e => e.length)).toBe(0);
  await page.click('[data-qa-babyadd]');
  expect(await page.evaluate(() => AtokoreQuickAdd.getTray().length)).toBe(0);
});

test('マミーポコ offers pants only and selects it', async ({ page }) => {
  await open(page);
  await page.click('#bfNavAdd');
  await pick(page, 'brand', 'マミーポコ');
  expect(await options(page, 'type')).toEqual(['パンツ', 'その他']);
  expect(await page.$eval('#qaBaby [data-qa-baby="type"][data-value="パンツ"]', e => e.classList.contains('selected'))).toBe(true);
});

test('wipes never show diaper series', async ({ page }, testInfo) => {
  await open(page);
  await page.click('#bfNavAdd');
  await pick(page, 'kind', 'wipes');
  await pick(page, 'brand', 'ムーニー');
  const series = await options(page, 'series');
  expect(series).toContain('やわらか素材');
  for (const diaper of ['ムーニーマン', 'オヤスミマン', '低刺激であんしん']) expect(series).not.toContain(diaper);
  await shot(page, testInfo, 'wipes-series');
  await pick(page, 'brand', 'グーン');
  expect(await options(page, 'series')).toEqual(['その他']);
});

test('formula forms follow the official lineups that could be confirmed', async ({ page }) => {
  await open(page);
  await page.click('#bfNavAdd');
  await pick(page, 'kind', 'milk');
  await pick(page, 'brand', '和光堂');
  expect(await options(page, 'type')).toEqual(['缶', 'スティック', 'その他']);
  await pick(page, 'brand', '森永');
  expect(await options(page, 'type')).toEqual(['缶', 'スティック', 'エコらくパック はじめてセット', 'エコらくパック つめかえ用', '液体', 'その他']);
  await pick(page, 'brand', 'アイクレオ');
  expect(await options(page, 'type')).not.toContain('キューブ');
  await pick(page, 'brand', 'ビーンスターク');
  expect(await options(page, 'type')).not.toContain('キューブ');
  // Confirmed on Meiji's current product list: no powdered-stick option for ほほえみ.
  await pick(page, 'brand', '明治');
  expect(await options(page, 'type')).toEqual(['缶', 'キューブ', '液体', 'その他']);
});

test('liquid formula is named 液体ミルク, never 粉ミルク 液体', async ({ page }) => {
  await open(page);
  await page.click('#bfNavAdd');
  await chooseBaby(page, { kind: 'milk', brand: '明治', type: '液体', series: 'ほほえみ' });
  await chooseBaby(page, { kind: 'milk', brand: '明治', type: 'キューブ', series: 'ほほえみ' });
  const names = await page.evaluate(() => AtokoreQuickAdd.getTray().map(x => x.name));
  expect(names).toEqual(['明治 ほほえみ 液体ミルク 液体', '明治 ほほえみ 粉ミルク キューブ']);
  await commitBatch(page);
  await go(page, 'stock');
  const text = await page.locator('#stockList').innerText();
  expect(text).not.toContain('粉ミルク 液体');
  expect(text).not.toContain('いつもの商品');
});
