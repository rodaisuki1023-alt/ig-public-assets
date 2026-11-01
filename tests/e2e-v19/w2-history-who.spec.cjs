// The shared sheet's 変更履歴 must read who=null as 「実行者不明」, like the home screen does.
// The current server hh_changes (20261025090000_atokore_history_w2.sql) returns who=null when no membership
// covers the time of an operation; older definitions always returned a name and no record_id.
// The household is created on the local emulator; only the hh_changes response is replaced in the browser,
// so no real household data is read or written.
const { test, expect } = require('@playwright/test');
const { open, go, baseState, KEY, shot, appConfirm } = require('./helpers.cjs');

const EMU = 'http://127.0.0.1:' + (process.env.E2E_HH_PORT || 4720);
const CONFIG = { url: EMU, anonKey: 'emu-anon-key' };

test.beforeEach(async ({ request }) => { await request.post(EMU + '/__test/reset'); });

test('shared-sheet history shows 実行者不明 for who=null and keeps names and old-format rows readable', async ({ page, request }, info) => {
  await page.addInitScript(c => { window.ATOKORE_HOUSEHOLD_CONFIG = c; }, CONFIG);
  await open(page, { [KEY]: baseState() });
  await go(page, 'premium');
  await page.click('#atkHouseholdCard');
  await page.fill('#atkHhEmail', 'mama@example.test');
  await page.getByRole('button', { name: '確認コードを送る' }).click();
  await expect(page.locator('#atkHhCode')).toBeVisible();
  const { code } = await (await request.get(EMU + '/__test/otp?email=mama%40example.test')).json();
  await page.fill('#atkHhCode', code);
  await page.getByRole('button', { name: 'ログイン', exact: true }).click();
  await page.fill('#atkHhName', 'ママ');
  await page.getByRole('button', { name: '世帯を作る' }).click();
  await appConfirm(page, true);
  await expect(page.locator('#atkHouseholdStatus')).toHaveText(/^(\d+人で共有中|家族と共有中)$/);

  const at = new Date(Date.UTC(2026, 9, 31, 3, 5)).toISOString();
  await page.route(`${EMU}/rest/v1/rpc/hh_changes`, route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify([
      // current definition: record_id present, who unknown for this operation
      { at, type: 'add', kind: 'item', result: 'applied', record_id: 'r1', who: null, name: 'Rico おしりふき', unit: 'パック', delta: 1 },
      // current definition, known member
      { at, type: 'create', kind: 'buy', result: 'applied', record_id: 'r2', who: 'パパ', name: 'パンパース M', unit: '袋' },
      // older definition: who always a name, no record_id
      { at, type: 'complete_buy', kind: 'buy', result: 'applied', who: 'ママ', name: 'ミルク', delta: 2 },
      // malformed values must not break the list
      { at: 'not-a-date', type: 'add', who: '', name: null, delta: 'x' },
    ]),
  }));
  await page.getByRole('button', { name: /変更履歴/ }).click();
  const rows = page.locator('.atk-hh-history li');
  await expect(rows).toHaveCount(4);
  await expect(rows.nth(0)).toContainText('実行者不明：Rico おしりふき ＋1');
  await expect(rows.nth(1)).toContainText('パパ：パンパース M 追加');
  await expect(rows.nth(2)).toContainText('ママ：ミルク 「買った」でストックに追加');
  await expect(rows.nth(3)).toContainText('日時不明 実行者不明：（削除済み） 数量を変更');
  await expect(page.locator('.atk-hh-history')).not.toContainText('null');
  await expect(page.locator('.atk-hh-history')).not.toContainText('NaN');
  await expect(page.locator('.atk-hh-history')).not.toContainText('Invalid Date');
  await shot(page, info, `${info.project.name}-w2-history-who`);
});
