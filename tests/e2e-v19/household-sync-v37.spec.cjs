// Household sharing (limited test) with two independent browser contexts = two people, two accounts.
// The backend is the local emulator (tests/household/emulator.cjs): real migration SQL in PGlite,
// Supabase Auth/PostgREST wire format. Real Supabase and real phones are NOT exercised here.
const { test, expect } = require('@playwright/test');
const { open, go, stored, baseState, KEY, shot, appConfirm } = require('./helpers.cjs');

const EMU = 'http://127.0.0.1:' + (process.env.E2E_HH_PORT || 4720);
const CONFIG = { url: EMU, anonKey: 'emu-anon-key' };
const diaper = 'パンパース さらさらケア おむつ テープ M';

async function person(browser, info, state, { config = CONFIG } = {}) {
  const u = info.project.use;
  const ctx = await browser.newContext({ baseURL: u.baseURL, viewport: u.viewport, isMobile: u.isMobile, hasTouch: u.hasTouch, deviceScaleFactor: u.deviceScaleFactor, userAgent: u.userAgent, locale: 'ja-JP' });
  const page = await ctx.newPage();
  page.__requests = [];
  page.on('request', r => { if (r.url().startsWith(EMU)) page.__requests.push(r.url()); });
  await page.addInitScript(c => { window.ATOKORE_HOUSEHOLD_CONFIG = c; }, config);
  await open(page, state ? { [KEY]: state } : undefined);
  return { ctx, page };
}
async function signIn(page, request, email) {
  await go(page, 'premium');
  await page.click('#atkHouseholdCard');
  await page.fill('#atkHhEmail', email);
  await page.getByRole('button', { name: '確認コードを送る' }).click();
  await expect(page.locator('#atkHhCode')).toBeVisible();
  const { code } = await (await request.get(EMU + '/__test/otp?email=' + encodeURIComponent(email))).json();
  await page.fill('#atkHhCode', code);
  await page.getByRole('button', { name: 'ログイン', exact: true }).click();
}
const sync = page => page.evaluate(() => window.AtokoreHousehold.syncNow());
const qty = async (page, name) => (await stored(page)).items.find(x => x.name === name)?.qty;
const idOf = async (page, name) => (await stored(page)).items.find(x => x.name === name)?.id;
async function tapStock(page, name, which) {
  await go(page, 'stock');
  await page.locator('#catChips').getByRole('button', { name: 'すべて', exact: true }).click();
  const id = await idOf(page, name);
  await page.locator(`#stockList [data-stock-id="${id}"] .qty button`).nth(which === '+' ? 1 : 0).click();
}

test.beforeEach(async ({ request }) => { await request.post(EMU + '/__test/reset'); });

async function failFinalMetadata(page){
  await page.evaluate(()=>{
    const original=Storage.prototype.setItem;
    window.restoreFinalMetadata=()=>{Storage.prototype.setItem=original};
    let checkpointWritten=false;
    Storage.prototype.setItem=function(k,v){
      if(k==='atokorePreviewHouseholdSyncV19'){
        const m=JSON.parse(v).engine;
        if(m?.pendingApply)checkpointWritten=true;
        if(checkpointWritten&&m?.shadow&&!m.pendingApply)throw new DOMException('quota','QuotaExceededError');
      }
      return original.call(this,k,v);
    };
  });
}

test('interrupted metadata commit reloads without counting the remote stock increment twice',async({browser,request},info)=>{
  const {A,B}=await sharedPair(browser,request,info);
  await tapStock(A.page,diaper,'+');await sync(A.page);
  await failFinalMetadata(B.page);await sync(B.page);
  expect(await qty(B.page,diaper)).toBe(3);
  expect((await B.page.evaluate(()=>window.AtokoreHousehold.status())).recovering).toBe(true);
  await B.page.reload();await B.page.waitForFunction(()=>!!window.AtokoreHousehold);
  await sync(B.page);await sync(A.page);
  expect(await qty(A.page,diaper)).toBe(3);expect(await qty(B.page,diaper)).toBe(3);
  expect((await B.page.evaluate(()=>window.AtokoreHousehold.status())).recovering).toBe(false);
  await A.ctx.close();await B.ctx.close();
});

test('editing after interrupted sync keeps the device copy and requires backup before recovery',async({browser,request},info)=>{
  const {A,B}=await sharedPair(browser,request,info);
  await tapStock(A.page,diaper,'+');await sync(A.page);
  await failFinalMetadata(B.page);await sync(B.page);
  await tapStock(B.page,diaper,'+');expect(await qty(B.page,diaper)).toBe(4);
  await B.page.reload();await B.page.waitForFunction(()=>!!window.AtokoreHousehold);
  await sync(B.page);expect(await qty(B.page,diaper)).toBe(4);
  await go(B.page,'premium');await B.page.click('#atkHouseholdCard');
  await expect(B.page.locator('.atk-hh-rejected')).toContainText('保存の途中で止まりました');
  await B.page.evaluate(key=>{
    const original=Storage.prototype.setItem;window.restoreRecoveryStorage=()=>{Storage.prototype.setItem=original};
    Storage.prototype.setItem=function(k,v){if(k===key+'SyncRecovery')throw new DOMException('quota','QuotaExceededError');return original.call(this,k,v)};
  },KEY);
  await B.page.getByRole('button',{name:'控えを残して共有データに合わせる'}).click();await appConfirm(B.page,true);
  expect(await qty(B.page,diaper)).toBe(4);
  expect((await B.page.evaluate(()=>window.AtokoreHousehold.status())).recovering).toBe(true);
  await B.page.evaluate(()=>window.restoreRecoveryStorage());
  await B.page.getByRole('button',{name:'控えを残して共有データに合わせる'}).click();await appConfirm(B.page,true);
  await expect(B.page.locator('#atkHouseholdStatus')).toHaveText('家族と共有済み');
  const backup=await B.page.evaluate(key=>JSON.parse(localStorage.getItem(key+'SyncRecovery')),KEY);
  expect(backup.data.items.find(x=>x.name===diaper).qty).toBe(4);
  await sync(A.page);expect(await qty(A.page,diaper)).toBe(3);expect(await qty(B.page,diaper)).toBe(3);
  await A.ctx.close();await B.ctx.close();
});

test('interrupted first adoption reloads the original selection and sends the chosen product once',async({browser,request},info)=>{
  const mine={items:[{id:51,name:'Rico おしりふき',cat:'ベビー',qty:2,unit:'パック',place:'収納',expType:'期限なし',exp:'',usage:1}],buys:[],routines:[]};
  const A=await person(browser,info,baseState()),B=await person(browser,info,mine);
  await signIn(A.page,request,'mama@example.test');await A.page.fill('#atkHhName','ママ');
  await A.page.getByRole('button',{name:'世帯を作る'}).click();await appConfirm(A.page,true);
  await A.page.getByRole('button',{name:/家族を招待する/}).click();
  const code=(await A.page.locator('#atkHhInviteCode').textContent()).trim();
  await signIn(B.page,request,'papa@example.test');await B.page.fill('#atkHhName','パパ');
  await B.page.fill('#atkHhJoinCode',code);await B.page.getByRole('button',{name:'参加する'}).click();
  await B.page.getByRole('button',{name:/この端末の商品も共有に加える/}).click();
  await failFinalMetadata(B.page);
  await B.page.getByRole('button',{name:'選んだ内容で共有を始める'}).click();
  await expect.poll(()=>B.page.evaluate(()=>JSON.parse(localStorage.getItem('atokorePreviewHouseholdSyncV19')).engine.pendingApply!=null)).toBe(true);
  const interrupted=await B.page.evaluate(()=>JSON.parse(localStorage.getItem('atokorePreviewHouseholdSyncV19')).engine);
  expect(interrupted.shadow).toBeNull();expect(interrupted.outbox).toHaveLength(1);
  expect(await qty(B.page,'Rico おしりふき')).toBe(2);
  await B.page.reload();await B.page.waitForFunction(()=>!!window.AtokoreHousehold);
  await sync(B.page);await sync(A.page);
  expect(await qty(A.page,'Rico おしりふき')).toBe(2);expect(await qty(B.page,'Rico おしりふき')).toBe(2);
  expect((await stored(A.page)).items.filter(x=>x.name==='Rico おしりふき')).toHaveLength(1);
  expect((await B.page.evaluate(()=>window.AtokoreHousehold.status())).recovering).toBe(false);
  await go(B.page,'premium');await B.page.click('#atkHouseholdCard');
  await expect(B.page.locator('#atkHouseholdStatus')).toHaveText('家族と共有済み');
  await A.ctx.close();await B.ctx.close();
});

test('retrying the placement button after a metadata failure sums the original amount only once',async({browser,request},info)=>{
  const mine={items:[{id:51,name:diaper,cat:'ベビー',qty:5,unit:'袋',place:'収納',expType:'期限なし',exp:'',usage:1}],buys:[],routines:[]};
  const A=await person(browser,info,baseState()),B=await person(browser,info,mine);
  await signIn(A.page,request,'mama@example.test');await A.page.fill('#atkHhName','ママ');
  await A.page.getByRole('button',{name:'世帯を作る'}).click();await appConfirm(A.page,true);
  await A.page.getByRole('button',{name:/家族を招待する/}).click();
  const code=(await A.page.locator('#atkHhInviteCode').textContent()).trim();
  await signIn(B.page,request,'papa@example.test');await B.page.fill('#atkHhName','パパ');
  await B.page.fill('#atkHhJoinCode',code);await B.page.getByRole('button',{name:'参加する'}).click();
  await B.page.getByRole('button',{name:/この端末の商品も共有に加える/}).click();
  await B.page.locator('.atk-hh-offer select').selectOption('sum');
  await failFinalMetadata(B.page);
  const startSharing=B.page.getByRole('button',{name:'選んだ内容で共有を始める'});
  await startSharing.click();await expect(startSharing).toBeEnabled();
  expect(await qty(B.page,diaper)).toBe(7);
  await B.page.evaluate(()=>window.restoreFinalMetadata());
  await startSharing.click();await expect(B.page.locator('#atkHouseholdStatus')).toHaveText('家族と共有済み');
  await sync(A.page);await sync(B.page);
  expect(await qty(A.page,diaper)).toBe(7);expect(await qty(B.page,diaper)).toBe(7);
  await A.ctx.close();await B.ctx.close();
});

test('rejected local edits stay on device across reload; recovery saves a copy before accepting shared data', async ({ browser, request }, info) => {
  const { A, B } = await sharedPair(browser, request, info);
  const bad='あ'.repeat(130);
  await A.page.evaluate(({key,bad})=>{const s=JSON.parse(localStorage.getItem(key));s.items[0].name=bad;localStorage.setItem(key,JSON.stringify(s))},{key:KEY,bad});
  await sync(A.page);
  expect((await stored(A.page)).items[0].name).toBe(bad);
  await A.page.reload();await A.page.waitForFunction(()=>!!window.AtokoreHousehold);
  await sync(A.page);
  expect((await stored(A.page)).items[0].name).toBe(bad);
  await go(A.page,'premium');await A.page.click('#atkHouseholdCard');
  await expect(A.page.locator('.atk-hh-rejected')).toContainText('端末の内容を残して同期を止めています');
  await A.page.getByRole('button',{name:'控えを残して共有データに合わせる'}).click();await appConfirm(A.page,true);
  await expect(A.page.locator('#atkHouseholdStatus')).toHaveText('家族と共有済み');
  const copy=await A.page.evaluate(key=>JSON.parse(localStorage.getItem(key+'SyncRecovery')),KEY);
  expect(copy.data.items[0].name).toBe(bad);expect(copy.engine.rejected).toHaveLength(1);
  expect((await stored(A.page)).items[0].name).toBe('牛乳');
  await sync(B.page);expect((await stored(B.page)).items[0].name).toBe('牛乳');
  await A.ctx.close();await B.ctx.close();
});

test('without a configured backend nothing is shown and nothing is sent', async ({ browser }, info) => {
  const { ctx, page } = await person(browser, info, baseState(), { config: null });
  await go(page, 'premium');
  await expect(page.locator('#atkHouseholdCard')).toHaveCount(0);
  await expect(page.locator('#atkHouseholdChip')).toHaveCount(0);
  await page.waitForTimeout(1500);
  expect(page.__requests).toEqual([]);
  await ctx.close();
});

test('create, invite, join with own data (nothing replaced silently), share both ways, history, XSS-safe names', async ({ browser, request }, info) => {
  const mine = { items: [{ id: 50, name: diaper, cat: 'ベビー', qty: 5, unit: '袋', place: '収納', expType: '期限なし', exp: '', usage: 1 },
    { id: 51, name: 'Rico おしりふき', cat: 'ベビー', qty: 2, unit: 'パック', place: '収納', expType: '期限なし', exp: '', usage: 1 }], buys: [], routines: [] };
  const A = await person(browser, info, baseState());
  const B = await person(browser, info, mine);
  const beforeA = await stored(A.page);

  await signIn(A.page, request, 'mama@example.test');
  await A.page.fill('#atkHhName', 'ママ');
  await A.page.getByRole('button', { name: '世帯を作る' }).click();await appConfirm(A.page,true);
  await expect(A.page.locator('#atkHouseholdStatus')).toHaveText('家族と共有済み');
  expect(await stored(A.page)).toEqual(beforeA); // the creator's data and ids are untouched
  expect(JSON.parse(await A.page.evaluate(k => localStorage.getItem(k + 'BeforeShare'), KEY)).data).toEqual(beforeA);
  await A.page.getByRole('button', { name: /家族を招待する/ }).click();
  const code = (await A.page.locator('#atkHhInviteCode').textContent()).trim();
  expect(code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
  await shot(A.page, info, `${info.project.name}-v37-household-invite`);

  await signIn(B.page, request, 'papa@example.test');
  await B.page.fill('#atkHhName', '<i>パパ</i>');
  await B.page.fill('#atkHhJoinCode', code.toLowerCase());
  await B.page.getByRole('button', { name: '参加する' }).click();
  // B has data: a choice is required; nothing changed yet.
  await expect(B.page.getByRole('button', { name: /共有のデータを使う/ })).toBeVisible();
  expect(await stored(B.page)).toEqual(mine);
  await B.page.getByRole('button', { name: /この端末の商品も共有に加える/ }).click();
  const offers = B.page.locator('.atk-hh-offer');
  await expect(offers).toHaveCount(2);
  await expect(offers.nth(0)).toContainText('共有にも同じ商品があります（共有 2袋／この端末 5袋）');
  await expect(offers.nth(1)).toContainText('この端末だけにある商品です');
  await shot(B.page, info, `${info.project.name}-v37-household-join-choice`);
  await B.page.getByRole('button', { name: '選んだ内容で共有を始める' }).click(); // defaults: shared qty for the twin, add Rico
  await expect(B.page.locator('#atkHouseholdStatus')).toHaveText('家族と共有済み');
  expect(await qty(B.page, diaper)).toBe(2);
  expect(await idOf(B.page, diaper)).toBe(50); // B keeps its own id (and photo) for the same product
  expect(await qty(B.page, 'Rico おしりふき')).toBe(2);
  expect((await stored(B.page)).items.map(x => x.name).sort()).toEqual([...beforeA.items.map(x => x.name), 'Rico おしりふき'].sort());
  expect(JSON.parse(await B.page.evaluate(k => localStorage.getItem(k + 'BeforeShare'), KEY)).data).toEqual(mine);

  await A.page.click('#sheet .close'); await B.page.click('#sheet .close');
  await sync(A.page);
  expect(await qty(A.page, 'Rico おしりふき')).toBe(2);
  expect((await stored(A.page)).buys.map(x => x.name)).toEqual(beforeA.buys.map(x => x.name));

  // History says who did what; display names are text, never markup.
  await tapStock(B.page, 'Rico おしりふき', '+');
  await expect.poll(async () => { await sync(B.page); await sync(A.page); return qty(A.page, 'Rico おしりふき'); }).toBe(3);
  await go(A.page, 'premium'); await A.page.click('#atkHouseholdCard');
  await A.page.getByRole('button', { name: /変更履歴/ }).click();
  await expect(A.page.locator('.atk-hh-history li').first()).toContainText('<i>パパ</i>：Rico おしりふき ＋1');
  await expect(A.page.locator('.atk-hh-members')).toContainText('<i>パパ</i>');
  expect(await A.page.locator('.atk-hh-members i, .atk-hh-history i').count()).toBe(0);
  await expect(A.page.locator('#sheet')).not.toContainText('null');
  await shot(A.page, info, `${info.project.name}-v37-household-dashboard`);
  expect([...A.page.__errors, ...B.page.__errors]).toEqual([]);
  await A.ctx.close(); await B.ctx.close();
});

async function sharedPair(browser, request, info) {
  const A = await person(browser, info, baseState());
  const B = await person(browser, info, { items: [], buys: [], routines: [] });
  await signIn(A.page, request, 'mama@example.test');
  await A.page.fill('#atkHhName', 'ママ');
  await A.page.getByRole('button', { name: '世帯を作る' }).click();await appConfirm(A.page,true);
  await A.page.getByRole('button', { name: /家族を招待する/ }).click();
  const code = (await A.page.locator('#atkHhInviteCode').textContent()).trim();
  await signIn(B.page, request, 'papa@example.test');
  await B.page.fill('#atkHhName', 'パパ');
  await B.page.fill('#atkHhJoinCode', code);
  await B.page.getByRole('button', { name: '参加する' }).click();
  await expect(B.page.locator('#atkHouseholdStatus')).toHaveText('家族と共有済み');
  await A.page.click('#sheet .close'); await B.page.click('#sheet .close');
  return { A, B };
}

test('both use stock offline; rapid taps and reload while the write endpoint is unavailable count once', async ({ browser, request }, info) => {
  const { A, B } = await sharedPair(browser, request, info);
  expect(await qty(B.page, diaper)).toBe(2);
  await A.ctx.setOffline(true); await B.ctx.setOffline(true);
  await tapStock(A.page, diaper, '-');
  await tapStock(B.page, diaper, '-');
  await expect(A.page.locator('#atkHouseholdChip')).toHaveText(/送信待ち|オフライン/);
  // An immediate offline failure must release the in-flight guard; a resolved promise must
  // not stay assigned forever and prevent all later reconnect/retry requests.
  expect((await sync(A.page)).state).toBe('offline');
  expect((await sync(B.page)).state).toBe('offline');
  await A.ctx.setOffline(false); await B.ctx.setOffline(false);
  await sync(A.page); await sync(B.page); await sync(A.page);
  expect(await qty(A.page, diaper)).toBe(0);
  expect(await qty(B.page, diaper)).toBe(0);

  // Write endpoint unavailable: three quick taps survive a reload and arrive exactly once.
  // WebKit throttles timers in background pages; exercise the phone's active screen.
  await B.page.bringToFront();
  // Cut the actual HTTP connection in the server instead of Playwright route interception.
  await request.post(EMU+'/__test/drop-push',{data:{email:'papa@example.test',enabled:true}});
  await tapStock(B.page, '牛乳', '+');
  const milkId = await idOf(B.page, '牛乳');
  for (let i = 0; i < 2; i++) await B.page.locator(`#stockList [data-stock-id="${milkId}"] .qty button`).nth(1).click();
  expect(await qty(B.page, '牛乳')).toBe(4);
  // Exercise the same explicit retry as "今すぐ同期"; background timer scheduling differs in WebKit.
  // The first half above separately checks that automatic local-change detection shows pending/offline.
  // A retry can join a pull already in flight when the taps occurred. Keep explicitly retrying
  // until an authenticated write actually reaches the failing endpoint; never infer this from a timer.
  await expect.poll(async()=>{
    const failed=await sync(B.page);
    const fault=await(await request.get(EMU+'/__test/drop-push?email=papa%40example.test')).json();
    return {seen:fault.attempts>0,attempts:fault.attempts,state:failed.state,navigatorOnline:await B.page.evaluate(()=>navigator.onLine),status:await B.page.evaluate(()=>window.AtokoreHousehold.status())};
  },{timeout:10000}).toMatchObject({seen:true,state:'offline'});
  expect(await B.page.evaluate(() => window.AtokoreHousehold.status().pending)).toBeGreaterThan(0);
  const operationIds=await B.page.evaluate(()=>JSON.parse(localStorage.getItem('atokorePreviewHouseholdSyncV19')).engine.outbox.map(o=>o.op_id));
  await sync(A.page);expect(await qty(A.page,'牛乳')).toBe(1);
  await B.page.reload();
  await B.page.waitForFunction(() => !!window.AtokoreHousehold);
  expect(await qty(B.page, '牛乳')).toBe(4);
  expect(await B.page.evaluate(()=>JSON.parse(localStorage.getItem('atokorePreviewHouseholdSyncV19')).engine.outbox.map(o=>o.op_id))).toEqual(operationIds);
  await request.post(EMU+'/__test/drop-push',{data:{email:'papa@example.test',enabled:false}});
  await sync(B.page); await sync(B.page); await sync(A.page);
  expect(await qty(A.page, '牛乳')).toBe(4);
  expect(await qty(B.page, '牛乳')).toBe(4);
  await expect(A.page.locator('#atkHouseholdChip')).toHaveText('共有済み');
  await A.ctx.close(); await B.ctx.close();
});

test('the same purchase finished on both phones restocks once; delete beats a late edit', async ({ browser, request }, info) => {
  const { A, B } = await sharedPair(browser, request, info);
  // baseState has a shopping row "おしりふき詰替"; both mark it bought while offline.
  await A.ctx.setOffline(true); await B.ctx.setOffline(true);
  for (const p of [A.page, B.page]) {
    await go(p, 'buy');
    await p.locator('#buyList [data-buy-id]').filter({ hasText: 'おしりふき詰替' }).getByRole('button', { name: /を買った$/ }).click();
  }
  await A.ctx.setOffline(false); await B.ctx.setOffline(false);
  await sync(A.page); await sync(B.page); await sync(A.page);
  for (const p of [A.page, B.page]) {
    const s = await stored(p);
    expect(s.buys.some(x => x.name === 'おしりふき詰替')).toBe(false);
    expect(s.items.filter(x => x.name === 'おしりふき詰替').map(x => x.qty)).toEqual([1]);
  }
  // A deletes the eggs; B, offline, edits them. They stay deleted for both.
  await B.ctx.setOffline(true);
  await A.page.evaluate(() => { const i = items.findIndex(x => x.name === '卵'); items.splice(i, 1); save(); render(); });
  await sync(A.page);
  await tapStock(B.page, '卵', '+');
  await B.ctx.setOffline(false);
  await sync(B.page); await sync(A.page);
  expect(await qty(B.page, '卵')).toBeUndefined();
  expect(await qty(A.page, '卵')).toBeUndefined();
  await A.ctx.close(); await B.ctx.close();
});

test('leave keeps the device data, re-join asks again; the free plan stops at two accounts', async ({ browser, request }, info) => {
  const { A, B } = await sharedPair(browser, request, info);
  await go(A.page, 'premium'); await A.page.click('#atkHouseholdCard');
  await expect(A.page.getByText('無料の家族共有は2人までです')).toBeVisible();
  const kept = await stored(B.page);
  await go(B.page, 'premium'); await B.page.click('#atkHouseholdCard');
  await B.page.getByRole('button', { name: /この世帯から抜ける/ }).click();await appConfirm(B.page,true);
  await expect(B.page.locator('#atkHouseholdChip')).toBeHidden();
  expect(await stored(B.page)).toEqual(kept);
  await tapStock(B.page, diaper, '+'); // not shared any more
  await sync(A.page);
  expect(await qty(A.page, diaper)).toBe(2);
  // Re-join: B has data again, so B chooses; using the shared data replaces only after confirmation.
  await A.page.click('#sheet .close'); await go(A.page, 'premium'); await A.page.click('#atkHouseholdCard');
  await A.page.getByRole('button', { name: /家族を招待する/ }).click();
  const code = (await A.page.locator('#atkHhInviteCode').textContent()).trim();
  await go(B.page, 'premium'); await B.page.click('#atkHouseholdCard');
  await B.page.fill('#atkHhName', 'パパ');
  await B.page.fill('#atkHhJoinCode', code);
  await B.page.getByRole('button', { name: '参加する' }).click();
  await B.page.getByRole('button', { name: /共有のデータを使う/ }).click();await appConfirm(B.page,true);
  await expect(B.page.locator('#atkHouseholdStatus')).toHaveText('家族と共有済み');
  expect(await qty(B.page, diaper)).toBe(2);
  expect(await idOf(B.page, diaper)).toBe(kept.items.find(x => x.name === diaper).id);
  await A.ctx.close(); await B.ctx.close();
});

for (const [width, height] of [[320, 568], [430, 932]]) {
  test(`household screens fit at ${width}px`, async ({ browser, request }, info) => {
    const { A } = await sharedPair(browser, request, { ...info, project: { ...info.project, use: { ...info.project.use, viewport: { width, height } } } });
    await go(A.page, 'premium'); await A.page.click('#atkHouseholdCard');
    const overflow = await A.page.evaluate(() => document.scrollingElement.scrollWidth - innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    for (const b of await A.page.locator('#sheet button.atk-hh-primary, #sheet button.atk-hh-secondary, #sheet button.atk-hh-link').all()) {
      const box = await b.boundingBox();
      if (box) expect(box.height, await b.textContent()).toBeGreaterThanOrEqual(44);
    }
    await shot(A.page, info, `${width}-v37-household-dashboard`);
    await A.ctx.close();
  });
}
