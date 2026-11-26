// Work 7th: two stock-date checks failed in Japan (JST) and passed in UTC. The calendar day is the
// phone's own day in every zone. Fixed clocks on both sides of the JST/UTC date change, in Asia/Tokyo
// and in UTC, with the exact expected values for that zone (nothing is loosened).
const { test, expect } = require('@playwright/test');
const { open, stored, baseState, KEY, appConfirm } = require('./helpers.cjs');
const dayIn = (ms, tz) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
const DAY = 86400000;
for (const tz of ['Asia/Tokyo', 'UTC']) for (const at of ['2026-11-27T00:30:00+09:00', '2026-11-27T09:30:00+09:00', '2026-11-26T23:59:30+09:00']) {
  test(`calendar days in ${tz} at ${at}: a level chosen 40 days ago says 40日; yesterday's prep ticks are kept`, async ({ browser }, info) => {
    const now = Date.parse(at);
    const ctx = await browser.newContext({ ...info.project.use, baseURL: info.project.use.baseURL, timezoneId: tz });
    const page = await ctx.newPage(); page.__errors = []; page.on('pageerror', e => page.__errors.push(e.message));
    await page.clock.setFixedTime(new Date(now));
    try {
      const s = baseState();
      s.items[2] = { ...s.items[2], level: 'plenty', levelAt: new Date(now - 40 * DAY).toISOString() };
      await open(page, { [KEY]: s });
      expect(await page.evaluate(() => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); })).toBe(dayIn(now, tz));
      await page.evaluate(i => window.atkShowDetail(i), 3);
      await expect(page.locator('#sheet .atk-level .atk-level-stale')).toContainText('40日たったので');
      const [m, d] = dayIn(now - 40 * DAY, tz).slice(5).split('-');
      await expect(page.locator('#sheet .atk-level .atk-level-stale')).toContainText(m + '/' + d + 'に設定');
      await page.evaluate(() => window.closeM?.());
      // Prep ticks: today and yesterday (this zone's calendar) are kept, two days ago is dropped.
      const today = dayIn(now, tz), yesterday = dayIn(now - DAY, tz), before = dayIn(now - 2 * DAY, tz);
      const prepKey = await page.evaluate(() => AtokorePrepSets.KEY);
      await page.evaluate(({ k, today, yesterday, before }) => {
        localStorage.setItem(k, JSON.stringify({ v: 1, children: [{ id: 'c1', name: '上の子' }], week: {}, events: {}, done: { [today]: ['t'], [yesterday]: ['y'], [before]: ['b'] } }));
        AtokorePrepSets.refresh();
      }, { k: prepKey, today, yesterday, before });
      await page.evaluate(() => go('buy'));
      const box = page.locator('#atkPrepSets');
      await box.locator('summary').first().click();
      await box.locator('[data-prep-kid-name]').fill('下の子'); await box.locator('[data-prep-add-child]').click();
      await expect(box.locator('.atk-prep-kid')).toHaveCount(2);
      const done = await page.evaluate(k => JSON.parse(localStorage.getItem(k)).done, prepKey);
      expect(Object.keys(done).sort()).toEqual([yesterday, today].sort());
      expect(page.__errors).toEqual([]);
    } finally { await ctx.close(); }
  });
}
