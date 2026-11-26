// W2 items 1 and 2: restore is a replacement (warned before and confirmed after choosing a file,
// photos included), restore is not available while sharing, the sharing status is the same on home
// and in the share dialog, and product photos are shared with the family automatically.
const fs = require('node:fs');
const zlib = require('node:zlib');
const { test, expect } = require('@playwright/test');
const { open, go, stored, baseState, KEY, appConfirm } = require('./helpers.cjs');
const EMU = 'http://127.0.0.1:' + (process.env.E2E_HH_PORT || 4720);
const CFG = { url: EMU, anonKey: 'emu-anon-key', google: true, guest: true, email: false, photoGatewayEnabled:true };
const DB = 'atokorePreviewProductPhotosV19';

function crc32(data) { let crc = 0xffffffff; for (const b of data) { crc ^= b; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); } return (crc ^ 0xffffffff) >>> 0; }
function chunk(type, data) { const label = Buffer.from(type), size = Buffer.alloc(4), crc = Buffer.alloc(4); size.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(Buffer.concat([label, data]))); return Buffer.concat([size, label, data, crc]); }
function png(red) {
  const header = Buffer.alloc(13); header.writeUInt32BE(40, 0); header.writeUInt32BE(40, 4); header[8] = 8; header[9] = 2;
  const pixels = Buffer.alloc(40 * (1 + 40 * 3)); for (let y = 0; y < 40; y++) for (let x = 0; x < 40; x++) { const i = y * 121 + 1 + x * 3; pixels[i] = red; pixels[i + 1] = 90; pixels[i + 2] = 255 - red; }
  return { name: 'p.png', mimeType: 'image/png', buffer: Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]) };
}
async function setPhoto(page, stockId, red = 200) {
  await go(page, 'stock');
  await page.locator(`#stockList [data-stock-id="${stockId}"] .name`).click();
  await page.click('.atk-photo-open');
  await expect(page.locator('#atkPhotoEditor input[type=checkbox]')).toHaveCount(0); // no "share this photo" choice any more
  await page.locator('#atkPhotoEditor input[type=file]').setInputFiles(png(red));
  await expect(page.locator('.atk-photo-save')).toBeEnabled();
  await page.click('.atk-photo-save');
  await expect(page.locator('.atk-detail-photo')).toBeVisible();
  await page.click('#sheet .close');
}
const photoKeys = page => page.evaluate(async db => {
  const d = await new Promise((res, rej) => { const r = indexedDB.open(db, 1); r.onsuccess = () => res(r.result); r.onerror = rej; });
  const keys = await new Promise((res, rej) => { const r = d.transaction('photos').objectStore('photos').getAllKeys(); r.onsuccess = () => res(r.result); r.onerror = rej; }); d.close();
  return keys.filter(k => k.startsWith('[')).sort();
}, DB);

test.describe('backup and restore', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('restore warns before, compares counts and photos after choosing a file, can be cancelled, and can be undone', async ({ page }, info) => {
    await open(page, { [KEY]: baseState() });
    await setPhoto(page, 2);
    await go(page, 'premium');
    await page.click('#atkBackupCard');
    await expect(page.locator('.atk-backup-warning')).toHaveText('復元すると、今の内容がバックアップの内容に置き換わります。バックアップに入っていない商品やリストは残りません。');
    const [download] = await Promise.all([page.waitForEvent('download'), page.click('.atk-backup-primary')]);
    const file = info.outputPath('backup.json'); await download.saveAs(file);
    const backup = JSON.parse(fs.readFileSync(file, 'utf8'));
    expect(backup.format).toBe(2);
    expect(backup.photos).toHaveLength(1);
    expect(backup.photos[0]).toMatchObject({ id: '2', name: 'パンパース さらさらケア おむつ テープ M', unit: '袋' });
    await expect(page.locator('#atkSafetyBanner')).toContainText('写真1枚を含みます');

    // Change everything: remove a product and the photo, add a list.
    await page.evaluate(() => { closeM(); items = items.filter(x => x.id !== 3); routines.push({ id: 77, name: '追加したリスト', items: [] }); save(); });
    await go(page, 'stock');
    await page.locator('#stockList [data-stock-id="2"] .name').click(); await page.click('.atk-photo-open');
    await page.click('.atk-photo-reset'); await appConfirm(page, true);
    await expect(page.locator('.atk-detail-photo')).toHaveCount(0); await page.click('#sheet .close');
    const changed = await stored(page);
    expect(await photoKeys(page)).toEqual([]);

    await page.evaluate(() => window.atkOpenBackup());
    await page.setInputFiles('.atk-backup-file', file);
    const asked = await appConfirm(page, false);
    expect(asked).toContain('バックアップの内容に置き換えますか？');
    expect(asked).toMatch(/バックアップの作成日時：\d{4}\/\d{1,2}\/\d{1,2}/);
    expect(asked).toContain('ストック：現在 2件 → 復元後 3件');
    expect(asked).toContain('買い物リスト：現在 1件 → 復元後 1件');
    expect(asked).toContain('いつものリスト：現在 2件 → 復元後 1件');
    expect(asked).toContain('写真：現在 0枚 → 復元後 1枚（写真もバックアップの内容に置き換わります）');
    expect(asked).toContain('件数が同じでも中身が異なる場合があります。');
    await expect(page.locator('.atk-backup-status')).toHaveText('復元を中止しました');
    expect(await stored(page)).toEqual(changed);

    await page.setInputFiles('.atk-backup-file', file);
    await appConfirm(page, true);
    await expect(page.locator('#atkSafetyBanner')).toContainText('復元しました');
    expect((await stored(page)).items).toEqual(backup.data.items);
    expect((await stored(page)).routines).toEqual(backup.data.routines);
    await expect.poll(() => photoKeys(page)).toHaveLength(1);
    await go(page, 'stock');
    await expect(page.locator('#stockList [data-stock-id="2"] .atk-user-photo')).toBeVisible();

    // Undo brings back the data and the (photo-less) state before restoring.
    await page.evaluate(() => window.atkOpenBackup());
    await page.click('.atk-backup-undo'); await appConfirm(page, true);
    await expect.poll(async () => (await stored(page)).items.length).toBe(2);
    expect(await stored(page)).toEqual(changed);
    await expect.poll(() => photoKeys(page)).toEqual([]);
    expect(page.__dialogs).toEqual([]);
    expect(page.__errors).toEqual([]);
  });
});


test('v50 P1 regression: undo restores a different original photo after importing a photo backup', async ({ page }, info) => {
  await open(page, { [KEY]: baseState() });
  // First prepare a real backup containing only product B's photo.
  await setPhoto(page, 3, 45);
  await go(page, 'premium');
  await page.click('#atkBackupCard');
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('.atk-backup-primary')]);
  const file = info.outputPath('photo-b.json');
  await download.saveAs(file);
  const backup = JSON.parse(fs.readFileSync(file, 'utf8'));
  expect(backup.photos).toHaveLength(1);
  expect(backup.photos[0].id).toBe('3');

  // Close the backup sheet before clicking stock: the modal intercepts pointer input.
  await page.evaluate(() => window.closeM());
  await expect(page.locator('#modal')).not.toHaveClass(/on/);
  // The current device now has A's photo and no B photo.
  await go(page, 'stock');
  await page.locator('#stockList [data-stock-id="3"] .name').click();
  await page.click('.atk-photo-open');
  await page.click('.atk-photo-reset');
  await appConfirm(page, true);
  await page.click('#sheet .close');
  await setPhoto(page, 2, 215);
  const before = await stored(page);
  const photoA = await photoKeys(page);
  expect(photoA).toHaveLength(1);
  expect(photoA[0]).toContain('"2"');

  // Restore photo B: A is staged as "beforeRestore:", not silently discarded.
  await page.evaluate(() => window.atkOpenBackup());
  await page.setInputFiles('.atk-backup-file', file);
  await appConfirm(page, true);
  await expect(page.locator('#atkSafetyBanner')).toContainText('復元しました');
  // The inventory save is synchronous but IndexedDB photo replacement is async.
  // Wait for B itself, not merely "one photo" (A already makes that count pass).
  await expect.poll(async () => (await photoKeys(page))[0]).toContain('"3"');

  // Undo must restore the *original* A photo and its inventory data.
  await page.evaluate(() => window.atkOpenBackup());
  await page.click('.atk-backup-undo');
  await appConfirm(page, true);
  await expect.poll(() => photoKeys(page)).toEqual(photoA);
  expect(await stored(page)).toEqual(before);
  await go(page, 'stock');
  await expect(page.locator('#stockList [data-stock-id="2"] .atk-user-photo')).toBeVisible();
  await expect(page.locator('#stockList [data-stock-id="3"] .atk-user-photo')).toHaveCount(0);
  expect(page.__errors).toEqual([]);
});

test('sharing: restore is refused with guidance, the status matches on home and in the dialog, photos are shared automatically', async ({ browser, request }, info) => {
  test.setTimeout(120000);
  await request.post(EMU + '/__test/reset');
  async function device(state) { const ctx = await browser.newContext({ ...info.project.use, baseURL: info.project.use.baseURL, viewport: { width: 390, height: 844 } }); const page = await ctx.newPage(); await page.addInitScript(c => window.ATOKORE_HOUSEHOLD_CONFIG = c, CFG); await open(page, { [KEY]: state }); return { ctx, page }; }
  const a = await device(baseState()), b = await device({ items: [], buys: [], routines: [] });
  const navigation=[];
  // Diagnostics for the intermittent CI "execution context destroyed": every main-frame
  // navigation with its query KEYS only (never values: they can carry an auth code), and every
  // navigation request with the URL it was redirected from. Synthetic emulator data only.
  const keys=u=>{try{const x=new URL(u);return {path:x.pathname,query:[...x.searchParams.keys()].sort(),hash:!!x.hash}}catch(_){return {path:'?'}}};
  for(const [deviceId,device] of [['sender',a],['receiver',b]]){
    device.page.on('framenavigated',frame=>{if(frame===device.page.mainFrame())navigation.push({device:deviceId,event:'committed',...keys(frame.url()),at:Date.now()})});
    device.page.on('request',r=>{if(r.isNavigationRequest()&&r.frame()===device.page.mainFrame())navigation.push({device:deviceId,event:'request',...keys(r.url()),from:r.redirectedFrom()?keys(r.redirectedFrom().url()).path:null,at:Date.now()})});
    // v51: the 2nd sighting (run 45616466115) showed NO main-frame navigation on the sender when
    // its context was destroyed, so renderer crashes, page close, load events, detached frames and
    // console errors are recorded as well (diagnostics only; no waits or retries change).
    device.page.on('crash',()=>navigation.push({device:deviceId,event:'crash',at:Date.now()}));
    device.page.on('close',()=>navigation.push({device:deviceId,event:'close',at:Date.now()}));
    device.page.on('domcontentloaded',()=>navigation.push({device:deviceId,event:'domcontentloaded',at:Date.now()}));
    device.page.on('load',()=>navigation.push({device:deviceId,event:'load',at:Date.now()}));
    device.page.on('framedetached',f=>navigation.push({device:deviceId,event:'framedetached',main:f===device.page.mainFrame(),at:Date.now()}));
    device.page.on('console',m=>{if(m.type()==='error')navigation.push({device:deviceId,event:'console-error',text:m.text().slice(0,160),at:Date.now()})});
    device.page.on('pageerror',e=>navigation.push({device:deviceId,event:'pageerror',text:String(e).slice(0,160),at:Date.now()}));
    // 3rd step (trace of run 45619019248): same frame, URL and page before and after, and the page
    // kept sending requests, so no navigation happened. Record which execution context Chromium
    // destroys (main world or another) with its id; Chromium only, diagnostics only.
    if(info.project.name==='chromium'){
     const cdp=await device.page.context().newCDPSession(device.page);
     cdp.on('Runtime.executionContextCreated',e=>navigation.push({device:deviceId,event:'ctx-created',id:e.context.id,name:e.context.name||'',def:!!e.context.auxData?.isDefault,type:e.context.auxData?.type||'',at:Date.now()}));
     cdp.on('Runtime.executionContextDestroyed',e=>navigation.push({device:deviceId,event:'ctx-destroyed',id:e.executionContextId,at:Date.now()}));
     cdp.on('Runtime.executionContextsCleared',()=>navigation.push({device:deviceId,event:'ctx-cleared',at:Date.now()}));
     await cdp.send('Runtime.enable');
    }
  }
  try {
    // Before sharing: single use.
    await expect(a.page.locator('#atkHomeLastSync')).toHaveText('この端末だけで利用中');
    await setPhoto(a.page, 2, 220); // a photo from before sharing
    await go(a.page, 'premium'); await a.page.click('#atkHouseholdCard');
    await a.page.getByRole('button', { name: 'Googleでログイン', exact: true }).click();
    await a.page.fill('#atkHhName', 'パパ'); await a.page.getByRole('button', { name: '世帯を作る', exact: true }).click(); await appConfirm(a.page, true);
    await expect(a.page.locator('#atkHouseholdStatus')).toHaveText(/^(\d+人で共有中|家族と共有中)$/);
    await a.page.getByRole('button', { name: /家族を招待する/ }).click();
    const link = await a.page.locator('#atkHhInviteLink').inputValue();
    await b.page.goto(link); await b.page.fill('#atkHhGuestName', 'ママ');
    await b.page.getByRole('button', { name: 'Googleなしで共有に参加する', exact: true }).click();
    await expect(b.page.locator('#atkHouseholdStatus')).toHaveText(/^(\d+人で共有中|家族と共有中)$/);
    await b.page.getByRole('button', { name: '閉じる', exact: true }).click();
    await a.page.getByRole('button', { name: '閉じる', exact: true }).click();

    // The photo from before sharing reaches the partner without any extra step.
    const findDiaper = async page => (await stored(page)).items.find(x => x.name === 'パンパース さらさらケア おむつ テープ M');
    await expect.poll(async () => { await a.page.evaluate(() => AtokoreHousehold.syncNow()); return !!(await findDiaper(a.page))?.photoPath; }, { timeout: 20000 }).toBe(true);
    await b.page.evaluate(() => AtokoreHousehold.syncNow());
    await go(b.page, 'stock');
    await expect(b.page.locator(`#stockList [data-stock-id="${(await findDiaper(b.page)).id}"] .atk-user-photo`)).toBeVisible();

    // A photo set while sharing is shared at once.
    // Delay the app's fetch BEFORE the real request reaches the emulator.
    // This works without Playwright route interception or service-worker races.
    await a.page.evaluate(()=>{
      const original=window.fetch,gate={observed:0};
      let release;const wait=new Promise(resolve=>{release=resolve});
      gate.release=()=>{window.fetch=original;release()};
      window.__photoWriteGate=gate;
      window.fetch=async function(input,init){
        const url=typeof input==='string'?input:input?.url||String(input);
        let body;try{body=JSON.parse(init?.body||'{}')}catch{}
        if(url.endsWith('/functions/v1/atokore-photo-gateway')&&body?.operation==='write'){
          gate.observed++;await wait;
        }
        return original.call(this,input,init);
      };
    });
    try{
      await setPhoto(a.page, 3, 40);
      // Local image is visible and saved, even while the request is delayed.
      expect((await stored(a.page)).items.find(x=>x.id===3).photoPath??null).toBeNull();
      await expect.poll(async()=>{
        const seen=await a.page.evaluate(()=>window.__photoWriteGate.observed);
        if(!seen)await a.page.evaluate(()=>{void AtokoreHousehold.syncNow();});
        return seen>0;
      },{timeout:20000}).toBe(true);
    }finally{await a.page.evaluate(()=>window.__photoWriteGate?.release())}
    // Local photoPath can appear before the asynchronous hh_push has been
    // acknowledged. Observe the authoritative server row, then the receiving
    // device's exact reference, before checking the actual rendered image.
    let serverPath;
    await expect.poll(async()=>{
      // 4th step: CDP showed NO context destroyed at the failure, and Playwright reports any
      // unclassified protocol error (e.g. "Promise was collected") with this navigation text.
      // A live timer keeps the race promise referenced, so a syncNow() promise that never settles
      // becomes an explicit, logged failure instead of an opaque one (no extra wait: still fails).
      try{
       const r=await a.page.evaluate(()=>Promise.race([AtokoreHousehold.syncNow().then(()=>'settled'),new Promise(res=>setTimeout(()=>res('hang'),15000))]));
       if(r==='hang'){console.log('PHOTO_QA_SYNC_HANG',JSON.stringify({failedAt:Date.now(),navigation}));throw Error('syncNow() did not settle within 15 s (sync promise hangs)')}
      }catch(error){
       if(/did not settle/.test(error.message))throw error;
        // Let the navigation event that destroyed the context arrive before logging it.
        await a.page.waitForLoadState('domcontentloaded').catch(()=>{});
        console.log('PHOTO_QA_NAVIGATION',JSON.stringify({failedAt:Date.now(),closed:a.page.isClosed(),navigation,url:keys(a.page.url())}));throw error}
      const res=await request.post(EMU+'/__test/sql',{data:{sql:"SELECT fields->>'photoPath' AS path FROM atokore_private.records WHERE kind='item' AND NOT deleted AND fields->>'name'='卵'"}});
      expect(res.ok()).toBe(true);
      const rows=await res.json();
      expect(rows).toHaveLength(1);
      serverPath=rows[0].path;
      return typeof serverPath==='string'&&serverPath.endsWith('.jpg');
    },{timeout:20000}).toBe(true);
    expect((await stored(a.page)).items.find(x=>x.id===3).photoPath).toBe(serverPath);
    await expect.poll(async()=>{
      await b.page.evaluate(()=>AtokoreHousehold.syncNow());
      return (await stored(b.page)).items.find(x=>x.name==='卵')?.photoPath??null;
    },{timeout:20000}).toBe(serverPath);
    const eggB = (await stored(b.page)).items.find(x => x.name === '卵');
    await go(b.page, 'stock');
    const receivedRow=b.page.locator(`#stockList [data-stock-id="${eggB.id}"]`);
    await expect(receivedRow).toBeVisible();
    // Verify transport separately, without touching the UI's object-URL cache.
    // If this fails the issue is the receiver authorization/transport, not DOM.
    const received=await b.page.evaluate(async({id,path})=>{
      try{const blob=await AtokoreHousehold.fetchPhoto(id,path);return {ok:!!blob,type:blob?.type||null,bytes:blob?.size||0}}
      catch(e){return {ok:false,error:String(e.message||e)}}
    },{id:eggB.id,path:serverPath});
    if(!received.ok){
      const scope=await b.page.evaluate(id=>AtokoreHousehold.photoScope(id),eggB.id);
      const events=await (await request.get(EMU+'/__test/photo-events')).json();
      console.log('PHOTO_QA_RECEIVE',JSON.stringify({
        // Synthetic local fixture only. No user/token/image bytes in logs.
        scopeMatches:!!scope&&serverPath.startsWith(scope.household+'/'+scope.sid+'/'),
        enabled:await b.page.evaluate(()=>AtokoreHousehold.photoSharingEnabled()),
        received,events
      }));
    }
    expect(received).toMatchObject({ok:true,type:'image/jpeg'});
    expect(received.bytes).toBeGreaterThan(0);
    const receivedImage=receivedRow.locator('.atk-user-photo');
    await expect(receivedImage).toBeVisible();
    await expect.poll(()=>receivedImage.evaluate(img=>img.complete&&img.naturalWidth>0)).toBe(true);

    // Status: same summary on home and in the dialog, with names and "this device".
    await go(a.page, 'home');
    // Members are re-read on sync (at most every 20 s), so the partner who just joined appears.
    await expect.poll(async () => { await a.page.evaluate(() => AtokoreHousehold.syncNow()); return a.page.locator('#atkHouseholdChip').textContent(); }, { timeout: 30000, intervals: [2000] }).toBe('2人で共有中');
    await a.page.click('#atkHouseholdChip');
    await expect(a.page.locator('#atkHouseholdStatus')).toHaveText('2人で共有中');
    await expect(a.page.locator('#atkHouseholdDetail')).toContainText('参加中：パパ、ママ');
    await expect(a.page.locator('#atkHouseholdDetail')).toContainText('この端末で利用中：パパ');
    await a.page.getByRole('button', { name: '閉じる', exact: true }).click();

    // Not yet sent: both places say so and offer "今すぐ同期".
    await a.ctx.setOffline(true);
    await a.page.evaluate(() => { const x = items.find(x => x.id === 1); x.qty += 1; save(); });
    await expect(a.page.locator('#atkHouseholdChip')).toHaveText('家族と共有中・未送信あり', { timeout: 10000 });
    await expect(a.page.locator('#atkHomeSyncNow')).toBeVisible();
    await expect(a.page.locator('#atkHomeSyncNow')).toHaveText('今すぐ同期');
    await a.page.click('#atkHouseholdChip');
    await expect(a.page.locator('#atkHouseholdStatus')).toHaveText('家族と共有中・未送信あり');
    await expect(a.page.locator('#atkHouseholdDetail')).toContainText('未送信の変更 1件');
    await a.page.getByRole('button', { name: '閉じる', exact: true }).click();
    await a.page.click('#atkHomeSyncNow'); // still offline: stays "not yet sent", nothing is lost
    await expect(a.page.locator('#atkHouseholdChip')).toHaveText('家族と共有中・未送信あり');
    await a.ctx.setOffline(false); // back online: sent automatically
    await expect.poll(async () => { await a.page.evaluate(() => AtokoreHousehold.syncNow()); return a.page.locator('#atkHouseholdChip').textContent(); }, { timeout: 20000, intervals: [1000] }).toBe('2人で共有中');
    await b.page.evaluate(() => AtokoreHousehold.syncNow());
    expect((await stored(b.page)).items.find(x => x.name === '牛乳').qty).toBe((await stored(a.page)).items.find(x => x.id === 1).qty);

    // Cannot confirm (offline, nothing waiting): says so, shows the last confirmed state and a re-check.
    await a.ctx.setOffline(true);
    await a.page.evaluate(() => AtokoreHousehold.syncNow());
    await expect(a.page.locator('#atkHouseholdChip')).toHaveText('共有状態を確認できません');
    await expect(a.page.locator('#atkHomeSyncNow')).toHaveText('再確認');
    await expect(a.page.locator('#atkHomeLastSync')).toContainText('最後に確認');
    await a.page.click('#atkHouseholdChip');
    await expect(a.page.locator('#atkHouseholdStatus')).toHaveText('共有状態を確認できません');
    await expect(a.page.locator('#atkHouseholdDetail')).toContainText('最後に確認した状態：');
    await expect(a.page.locator('#atkHouseholdDetail')).toContainText('2人で共有中');
    await expect(a.page.locator('#atkHouseholdSyncNow')).toHaveText('再確認する');
    await a.page.getByRole('button', { name: '閉じる', exact: true }).click();
    await a.ctx.setOffline(false);
    await expect.poll(async () => { await a.page.evaluate(() => AtokoreHousehold.syncNow()); return a.page.locator('#atkHouseholdChip').textContent(); }, { timeout: 20000, intervals: [1000] }).toBe('2人で共有中');

    // Restore is refused while sharing; saving a backup still works.
    await go(b.page, 'premium'); await b.page.click('#atkBackupCard');
    await b.page.click('.atk-backup-secondary:text("バックアップから復元")');
    await expect(b.page.locator('.atk-backup-blocked')).toBeVisible();
    await expect(b.page.locator('.atk-backup-blocked')).toContainText('家族共有に参加している間は、この端末のファイルから復元できません');
    await expect(b.page.getByRole('button', { name: '共有に再接続する' })).toBeVisible();
    await expect(b.page.getByRole('button', { name: '共有を抜けてから復元する' })).toBeVisible();
    const before = await stored(b.page);
    const backupFile = info.outputPath('b.json');
    const [download] = await Promise.all([b.page.waitForEvent('download'), b.page.click('.atk-backup-primary')]);
    await download.saveAs(backupFile);
    const saved = JSON.parse(fs.readFileSync(backupFile, 'utf8'));
    expect(saved.photos.length).toBe(2); // family photos are included even though this device never set them
    // Even if a file reaches the input, nothing is restored while sharing.
    await b.page.setInputFiles('.atk-backup-file', backupFile).catch(() => {});
    await b.page.waitForTimeout(500);
    await expect(b.page.locator('#atkConfirm')).toHaveCount(0);
    expect(await stored(b.page)).toEqual(before);
    await b.page.getByRole('button', { name: '共有を抜けてから復元する' }).click();
    await expect(b.page.locator('#atkHouseholdStatus')).toBeVisible();
    expect(a.page.__errors).toEqual([]); expect(b.page.__errors).toEqual([]);
  } finally { await a.ctx.close(); await b.ctx.close(); }
});

// v51 A2: the gateway names every upload itself. When the sync right after an upload cannot
// confirm it (push lost), the photo stays "not yet shared" and is retried. The retry must reuse
// the uploaded path and only confirm it: a second upload would get a new path, the family would
// read a reference that is no longer current (denied) and the first file would be orphaned.
test('photo share retried after an unconfirmed sync uploads once and both phones keep one path', async ({ browser, request }, info) => {
  test.setTimeout(120000);
  await request.post(EMU + '/__test/reset');
  async function device(state) { const ctx = await browser.newContext({ ...info.project.use, baseURL: info.project.use.baseURL, viewport: { width: 390, height: 844 } }); const page = await ctx.newPage(); await page.addInitScript(c => window.ATOKORE_HOUSEHOLD_CONFIG = c, CFG); await open(page, { [KEY]: state }); return { ctx, page }; }
  const a = await device(baseState()), b = await device({ items: [], buys: [], routines: [] });
  const writes = async () => (await (await request.get(EMU + '/__test/photo-events')).json()).filter(e => e.operation === 'write' && e.status === 200);
  const serverPath = async () => { const rows = await (await request.post(EMU + '/__test/sql', { data: { sql: "SELECT fields->>'photoPath' AS path FROM atokore_private.records WHERE kind='item' AND NOT deleted AND fields->>'name'='卵'" } })).json(); return rows[0]?.path ?? null; };
  try {
    await go(a.page, 'premium'); await a.page.click('#atkHouseholdCard');
    await a.page.getByRole('button', { name: 'Googleでログイン', exact: true }).click();
    await a.page.fill('#atkHhName', 'パパ'); await a.page.getByRole('button', { name: '世帯を作る', exact: true }).click(); await appConfirm(a.page, true);
    await expect(a.page.locator('#atkHouseholdStatus')).toHaveText(/^(\d+人で共有中|家族と共有中)$/);
    await a.page.getByRole('button', { name: /家族を招待する/ }).click();
    const link = await a.page.locator('#atkHhInviteLink').inputValue();
    await b.page.goto(link); await b.page.fill('#atkHhGuestName', 'ママ');
    await b.page.getByRole('button', { name: 'Googleなしで共有に参加する', exact: true }).click();
    await expect(b.page.locator('#atkHouseholdStatus')).toHaveText(/^(\d+人で共有中|家族と共有中)$/);
    await b.page.getByRole('button', { name: '閉じる', exact: true }).click();
    await a.page.getByRole('button', { name: '閉じる', exact: true }).click();
    await a.page.evaluate(() => AtokoreHousehold.syncNow());

    // The upload succeeds, but the push that would record it on the server is lost.
    await request.post(EMU + '/__test/drop-push', { data: { email: 'google@example.test', enabled: true } });
    await setPhoto(a.page, 3, 40);
    await expect.poll(async () => (await writes()).length, { timeout: 20000 }).toBe(1);
    const uploaded = (await writes())[0].path;
    await expect.poll(async () => (await request.post(EMU + '/__test/drop-push', { data: { email: 'google@example.test', enabled: true } }).then(r => r.json())).attempts, { timeout: 20000 }).toBeGreaterThan(0);
    expect(await serverPath()).toBeNull();

    // Connection back: every later sync re-runs the share queue. It must confirm, not re-upload.
    await request.post(EMU + '/__test/drop-push', { data: { email: 'google@example.test', enabled: false } });
    await expect.poll(async () => { await a.page.evaluate(() => AtokoreHousehold.syncNow()); return serverPath(); }, { timeout: 20000 }).toBe(uploaded);
    for (let i = 0; i < 3; i++) await a.page.evaluate(() => AtokoreHousehold.syncNow());
    expect((await writes()).map(w => w.path)).toEqual([uploaded]);
    expect((await stored(a.page)).items.find(x => x.id === 3).photoPath).toBe(uploaded);
    // The device record is marked shared once the family has the photo, so no later scan resends it.
    await expect.poll(() => a.page.evaluate(() => new Promise(res => { const r = indexedDB.open('atokorePreviewProductPhotosV19', 1); r.onsuccess = () => { const q = r.result.transaction('photos').objectStore('photos').getAll(); q.onsuccess = () => { res(q.result.filter(v => v && v.bytes && v.pending === true).length); r.result.close(); }; }; })), { timeout: 20000 }).toBe(0);

    // The partner receives exactly that reference and may read it.
    await expect.poll(async () => { await b.page.evaluate(() => AtokoreHousehold.syncNow()); return (await stored(b.page)).items.find(x => x.name === '卵')?.photoPath ?? null; }, { timeout: 20000 }).toBe(uploaded);
    const eggB = (await stored(b.page)).items.find(x => x.name === '卵');
    const received = await b.page.evaluate(async ({ id, path }) => { const blob = await AtokoreHousehold.fetchPhoto(id, path); return { type: blob?.type, bytes: blob?.size || 0 }; }, { id: eggB.id, path: uploaded });
    expect(received.type).toBe('image/jpeg'); expect(received.bytes).toBeGreaterThan(0);
    expect(a.page.__errors).toEqual([]); expect(b.page.__errors).toEqual([]);
  } finally { await a.ctx.close(); await b.ctx.close(); }
});
