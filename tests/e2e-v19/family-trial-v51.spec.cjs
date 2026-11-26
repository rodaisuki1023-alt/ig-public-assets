// 家族機能の試用（合成データ）: パパ／ママ, 担当と返事, 保育園の準備担当, 不足→買い物→準備, 通知プレビュー.
// Everything is synthetic and on this device: no network, no change to the real stock or shopping list,
// no real family sharing and nothing sent.
const { test, expect } = require('@playwright/test');
const { open, go, stored, baseState, KEY, appConfirm } = require('./helpers.cjs');
const trial = page => page.locator('#atkFamilyTrial');
async function start(page) {
  const external = [];
  page.on('request', r => { const u = new URL(r.url()); if (u.protocol.startsWith('http') && !['127.0.0.1', 'localhost'].includes(u.hostname)) external.push(r.url()); });
  await open(page, { [KEY]: baseState() });
  await go(page, 'premium');
  await trial(page).locator('summary').click();
  await expect(trial(page)).toContainText('【試用・合成データ】');
  return external;
}
const viewer = (page, who) => trial(page).getByRole('button', { name: who + 'の画面' }).click();
const row = (page, name) => trial(page).locator('.atk-ft-row', { hasText: name });
const notes = page => trial(page).locator('.atk-ft-notes');
test('assignment and reply: ママ asks パパ, パパ answers 今回は難しい, ママ sees the reply in the notification preview', async ({ page }) => {
  const external = await start(page);
  const before = await stored(page);
  await viewer(page, 'ママ');
  await row(page, 'おしりふき').locator('[data-ft-assign]').selectOption({ label: 'パパ' });
  await expect(trial(page).locator('.atk-ft-note')).toHaveText('パパにおしりふきを頼みました');
  await expect(row(page, 'おしりふき')).toContainText('担当：パパ：返事待ち');
  await expect(row(page, 'おしりふき').getByRole('button', { name: '買えるよ' })).toHaveCount(0);   // not for the one who asked
  await viewer(page, 'パパ');
  await expect(notes(page)).toContainText('届く：');                                                      // パパ: the request (combined)
  await row(page, 'おしりふき').getByRole('button', { name: '今回は難しい' }).click();
  await expect(row(page, 'おしりふき')).toContainText('担当なし（ママのお願いに「今回は難しい」と返事がありました）');
  await viewer(page, 'ママ');
  await expect(row(page, 'おしりふき')).toContainText('担当なし（あなたのお願いに「今回は難しい」と返事がありました）');
  await expect(row(page, 'おしりふき')).not.toContainText('なしへの返事');
  await expect(notes(page)).toContainText('届く：');
  expect(JSON.stringify(await page.evaluate(() => AtokoreFamilyTrial.preview().events.map(e => e.kind)))).toContain('assignment-response');
  // A second reply to the same request is refused by the rule (no longer pending).
  await viewer(page, 'パパ');
  await expect(row(page, 'おしりふき').getByRole('button', { name: '買えるよ' })).toHaveCount(0);
  expect(await stored(page)).toEqual(before);                                                             // the real data is untouched
  expect(external).toEqual([]);
  expect(page.__errors).toEqual([]);
});
test('preparation: two daycares, the person in charge, the shortage goes to shopping, buying it clears the shortage, ticking completes', async ({ page }) => {
  await start(page);
  const child = name => trial(page).locator('.atk-ft-child', { hasText: name });
  await expect(child('上の子')).toContainText('さくら保育園');
  await expect(child('下の子')).toContainText('ひまわり園');
  await expect(child('上の子').locator('.atk-ft-ticks li', { hasText: 'おむつ M' })).toContainText('在庫が足りません');   // 5 needed, 4 in stock
  await trial(page).getByRole('button', { name: '不足の1枚を買い物に追加' }).click();
  await expect(row(page, 'おむつ M')).toContainText('明日の準備の不足分');
  await expect(trial(page).locator('.atk-ft-short')).toContainText('買い物リストに1枚あり');
  await row(page, 'おむつ M').getByRole('button', { name: '買った' }).click();
  await expect(trial(page).locator('.atk-ft-note')).toContainText('明日の準備の不足も見直しました');
  await expect(child('上の子').locator('.atk-ft-ticks li', { hasText: 'おむつ M' })).not.toContainText('在庫が足りません');
  await expect(child('上の子').locator('.atk-ft-ticks li', { hasText: '着替えセット' })).toContainText('在庫が足りません');   // still short: shown, not hidden
  // Tick everything for 上の子 → 完了.
  for (const box of await child('上の子').locator('[data-ft-tick]').all()) await box.check();
  await expect(child('上の子')).toContainText('準備：完了');
  // 下の子's preparation goes to ママ: ママ's phone gets tomorrow's reminder; パパ's no longer does.
  await viewer(page, 'ママ');
  await child('下の子').locator('[data-ft-prepby]').selectOption({ label: 'ママ' });
  await expect(trial(page).locator('.atk-ft-note')).toContainText('下の子（ひまわり園）の準備はママの担当になりました');
  const kinds = await page.evaluate(() => AtokoreFamilyTrial.preview().events.map(e => e.kind + ':' + e.subject));
  expect(kinds).toContain('prep:c2');
  expect(page.__errors).toEqual([]);
});
test('notification preview: quiet hours, everything off, a kind off, settled items, and a member who left', async ({ page }) => {
  await start(page);
  await viewer(page, 'ママ');
  await expect(notes(page)).toContainText('届く：家族から');                               // refill (diapers, milk) + prep, combined into one
  await expect(notes(page)).toContainText('ロック画面には商品名を出しません');
  await expect(notes(page)).toContainText('補充の予測：そろそろ補充が必要な物があります');    // each notice's own text
  await expect(notes(page)).toContainText('明日の保育園準備：明日の準備を確認してください');
  await trial(page).getByRole('button', { name: '22時', exact: true }).click();
  await expect(notes(page)).toContainText('夜間（21時〜7時）なので朝7時に');
  await expect(notes(page)).toContainText('07:00 に届く予定');                         // the planned time is shown
  await trial(page).getByRole('button', { name: '8時', exact: true }).click();
  await expect(notes(page)).toContainText('届く：');
  // Buying the milk settles the milk refill prediction.
  await row(page, 'ミルク缶').getByRole('button', { name: '買った' }).click();
  await expect(notes(page)).toContainText('補充の予測 — 解決済みなので送りません');
  // One kind off, then everything off.
  await trial(page).locator('[data-ft-pref="refill"]').uncheck();
  await expect(notes(page)).toContainText('補充の予測 — この種類をオフにしています');
  await trial(page).locator('[data-ft-all]').uncheck();
  await expect(notes(page)).not.toContainText('届く：');
  // Delivered (trial) counts toward the gap: nothing more for 30 minutes.
  await trial(page).locator('[data-ft-all]').check();
  await trial(page).getByRole('button', { name: '届いたことにする（試用）' }).click();
  await expect(notes(page)).not.toContainText('届く：');
  // ママ leaves: what she was asked is released and nothing is sent to her.
  await trial(page).locator('[data-ft-left]').click();
  const said = await appConfirm(page, true);                                         // what happens is said first
  expect(said).toContain('まだ届いていない通知は送られません');
  await expect(trial(page).locator('.atk-ft-note')).toContainText('ママへの通知は送りません');
  await expect(row(page, 'おしりふき').locator('[data-ft-assign] option', { hasText: 'ママ' })).toHaveAttribute('disabled', '');
  await expect(row(page, 'おしりふき').locator('[data-ft-assign] option', { hasText: 'ママ' })).toHaveText('ママ（抜けました）');
  await viewer(page, 'ママ');
  await expect(notes(page)).toContainText('家族から抜けたので送りません');
  await expect(notes(page)).not.toContainText('届く：');
  expect(page.__errors).toEqual([]);
});
for (const width of [320, 393]) test(`family trial fits ${width}px with 44px targets and no sideways scroll`, async ({ page }) => {
  await page.setViewportSize({ width, height: 852 });
  await start(page);
  const f = await page.evaluate(() => {
    const box = document.getElementById('atkFamilyTrial');
    const t = e => (e.type === 'checkbox' || e.type === 'radio') ? e.closest('label') : e;
    const hs = [...box.querySelectorAll('button,select,input,summary')].filter(e => e.getBoundingClientRect().width > 0).map(e => t(e).getBoundingClientRect().height);
    return { min: Math.min(...hs), right: box.getBoundingClientRect().right, scroll: document.documentElement.scrollWidth - innerWidth };
  });
  expect(f.min).toBeGreaterThanOrEqual(44);
  expect(f.right).toBeLessThanOrEqual(width);
  expect(f.scroll).toBeLessThanOrEqual(0);
});
