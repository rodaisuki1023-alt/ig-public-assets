// v39 first run (start with up to 5 everyday products) and the optional per-product reorder line.
const { test, expect } = require('@playwright/test');
const { open, go, stored, KEY, shot } = require('./helpers.cjs');

const ONBOARDING = 'atokorePreviewOnboardingV19';
const card = page => page.locator('#atkOnboarding');
const chip = (page, name) => page.locator(`[data-ob-pick="${name}"]`);
const onboardingState = page => page.evaluate(k => JSON.parse(localStorage.getItem(k) || 'null'), ONBOARDING);
const noHorizontalScroll = page => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

for (const [width, height] of [[320, 568], [375, 560], [390, 844], [430, 932]]) {
  test(`first run at ${width}x${height}: choose, set a reorder line, saved once from the review screen`, async ({ page }, info) => {
    await page.setViewportSize({ width, height });
    await open(page);
    await expect(card(page)).toBeVisible();
    expect(await onboardingState(page)).toBeNull(); // showing the card writes nothing
    // The built-in examples (牛乳・卵) are not offered again, so nothing is added to their counts.
    await expect(chip(page, '牛乳')).toHaveCount(0);
    await expect(chip(page, '卵')).toHaveCount(0);
    await expect(page.locator('[data-ob-go]')).toBeDisabled();
    for (const name of ['おしりふき', 'トイレットペーパー', 'ティッシュ', '洗濯洗剤', '食器用洗剤']) await chip(page, name).click();
    await chip(page, 'お米').click();
    await expect(page.locator('#atkObError')).toContainText('5つまで');
    await expect(chip(page, 'お米')).toHaveAttribute('aria-pressed', 'false');
    await chip(page, '食器用洗剤').click(); // deselect
    await expect(page.locator('[data-ob-go]')).toHaveText('選んだ4つを確認する');
    await page.locator('.atk-ob-more summary').click();
    await page.fill('[data-ob-min="トイレットペーパー"]', '2');
    expect(await noHorizontalScroll(page)).toBe(true);
    await shot(page, info, `${width}x${height}-v39-onboarding`);
    expect(await stored(page)).toBeNull(); // nothing saved yet
    await page.click('[data-ob-go]');
    await expect(page.locator('#qaTray')).toBeVisible();
    expect(await stored(page)).toBeNull();
    await page.click('#qaCommit');
    await expect.poll(async () => (await stored(page))?.items.length).toBe(7);
    const saved = await stored(page);
    expect(saved.items.slice(0, 3).map(x => [x.id, x.name, x.qty])).toEqual([[1, '牛乳', 1], [2, 'オムツ', 2], [3, '卵', 6]]);
    const added = Object.fromEntries(saved.items.slice(3).map(x => [x.name, x]));
    expect(Object.keys(added).sort()).toEqual(['おしりふき', 'ティッシュ', 'トイレットペーパー', '洗濯洗剤'].sort());
    expect(Object.values(added).every(x => x.qty === 1)).toBe(true);
    expect(added['トイレットペーパー'].minQty).toBe(2);
    expect('minQty' in added['おしりふき']).toBe(false);
    expect((await onboardingState(page)).doneAt).toBeTruthy();
    await go(page, 'home');
    await expect(card(page)).toHaveCount(0);
    await expect(page.locator('#atkOnboardingTip')).toBeVisible();
    await page.click('[data-ob-tip-ok]');
    await expect(page.locator('#atkOnboardingTip')).toHaveCount(0);
    await page.reload();
    await expect(page.locator('#atkOnboarding, #atkOnboardingTip')).toHaveCount(0);
    expect(page.__errors).toEqual([]);
  });
}

test('closing the card saves nothing and it stays closed; with saved data it never appears', async ({ page }) => {
  await open(page);
  await page.click('[data-ob-later]');
  await expect(card(page)).toHaveCount(0);
  expect(await stored(page)).toBeNull();
  await page.reload();
  await expect(card(page)).toHaveCount(0);

  const other = await page.context().newPage();
  await open(other, { [KEY]: { items: [{ id: 5, name: 'ミルク', cat: 'ベビー', qty: 1, unit: '缶' }], buys: [], routines: [] } });
  await expect(other.locator('#atkOnboarding')).toHaveCount(0);
});

test('a failed save keeps the first-run card and sets no reorder line; retry works', async ({ page }) => {
  await open(page);
  await chip(page, 'トイレットペーパー').click();
  await page.locator('.atk-ob-more summary').click();
  await page.fill('[data-ob-min="トイレットペーパー"]', '-1');
  await page.click('[data-ob-go]');
  await expect(page.locator('#atkObError')).toContainText('0〜9999');
  await page.fill('[data-ob-min="トイレットペーパー"]', '3');
  await page.click('[data-ob-go]');
  await page.evaluate(k => { const o = Storage.prototype.setItem; window.__undo = () => { Storage.prototype.setItem = o; }; Storage.prototype.setItem = function (key, v) { if (key === k) throw new DOMException('full', 'QuotaExceededError'); return o.call(this, key, v); }; }, KEY);
  await page.click('#qaCommit');
  await expect(page.locator('#qaNotice')).toContainText('保存できませんでした');
  expect(await stored(page)).toBeNull();
  expect(await onboardingState(page)).toBeNull(); // not marked done
  await page.evaluate(() => window.__undo());
  await page.click('#qaCommit');
  await expect.poll(async () => (await stored(page))?.items.find(x => x.name === 'トイレットペーパー')?.minQty).toBe(3);
});

test('reorder line in the edit form: 要補充 follows it, empty means the default, bad values are refused', async ({ page }) => {
  await open(page, { [KEY]: { items: [{ id: 7, name: 'おしりふき', cat: 'ベビー', qty: 3, unit: 'パック', place: '収納', expType: '期限なし', exp: '' }], buys: [], routines: [] } });
  await go(page, 'home');
  await expect(page.locator('#atkLowCount')).toHaveText('0');
  await page.evaluate(() => window.atokoreEditStock(7));
  const field = page.locator('#atkEditForm input[name="minQty"]');
  await expect(field).toHaveValue('');
  await field.fill('10000');
  await page.click('.atk-edit-save');
  // The browser refuses it before submitting (the app's own check is covered by the unit test).
  expect(await field.evaluate(el => el.validity.valid)).toBe(false);
  await expect(page.locator('#atkEditForm')).toBeVisible();
  expect((await stored(page)).items[0].minQty).toBeUndefined();
  await field.fill('3');
  await page.click('.atk-edit-save');
  await expect.poll(async () => (await stored(page)).items[0].minQty).toBe(3);
  await go(page, 'home');
  await expect(page.locator('#atkLowCount')).toHaveText('1');
  await page.evaluate(() => window.atokoreEditStock(7));
  await page.locator('#atkEditForm input[name="minQty"]').fill('');
  await page.click('.atk-edit-save');
  await expect.poll(async () => 'minQty' in (await stored(page)).items[0]).toBe(false);
  await go(page, 'home');
  await expect(page.locator('#atkLowCount')).toHaveText('0');
  expect(page.__errors).toEqual([]);
});
