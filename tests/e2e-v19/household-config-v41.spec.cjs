// Uses the shipped trial config. Provider navigation is intercepted: no real account is used.
const {test,expect}=require('@playwright/test');
const {open,go,stored,baseState,KEY,shot}=require('./helpers.cjs');
const BACKEND='https://vzyxurodowpjltwbgbyc.supabase.co';
const OAUTH='atokorePreviewHouseholdOAuthV19';
const SESSION='atokorePreviewHouseholdSessionV19';

for(const width of [320,375,390,430])test(`trial Google entry at ${width}px leaves existing stock local`,async({page},info)=>{
  await page.setViewportSize({width,height:640});
  const requests=[];
  page.on('request',r=>{if(r.url().startsWith(BACKEND+'/'))requests.push(r.url())});
  await page.route(BACKEND+'/**',route=>route.abort());
  await open(page,{[KEY]:baseState()});
  const before=await stored(page);
  await go(page,'premium');await page.click('#atkHouseholdCard');
  await expect(page.getByRole('button',{name:'Googleでログイン'})).toBeVisible();
  await expect(page.locator('#atkHhEmail')).toHaveCount(0);
  await expect(page.locator('#atkHhName')).toHaveCount(0);
  expect(await stored(page)).toEqual(before);
  expect(await page.evaluate(k=>localStorage.getItem(k),SESSION)).toBeNull();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.reload();
  expect(await stored(page)).toEqual(before);
  expect(requests).toEqual([]);
  expect(page.__errors).toEqual([]);
  await go(page,'premium');await page.click('#atkHouseholdCard');
  await shot(page,info,`v41-enabled-google-${width}`);
});

test('cancelled provider navigation cleans the URL and preserves existing stock',async({page})=>{
  let authorizations=0;
  const unexpected=[];
  await page.route(BACKEND+'/**',async route=>{
    const u=new URL(route.request().url());
    if(u.pathname!=='/auth/v1/authorize'){
      unexpected.push(u.pathname);await route.abort();return;
    }
    authorizations++;
    expect(u.searchParams.get('provider')).toBe('google');
    expect(u.searchParams.get('code_challenge_method')).toBe('s256');
    expect(u.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const callback=new URL(u.searchParams.get('redirect_to'));
    expect(callback.pathname).toBe('/ig-public-assets/preview-baby-v19/');
    expect(callback.searchParams.get('atokore_auth')).toMatch(/^[A-Za-z0-9_-]{32}$/);
    callback.searchParams.set('error','access_denied');
    // WebKit cannot fulfill a mocked 302; a simulated provider page navigates back instead.
    const destination=JSON.stringify(callback.href).replace(/</g,'\\u003c');
    await route.fulfill({status:200,contentType:'text/html',body:'<!doctype html><script>location.replace('+destination+')</script>'});
  });
  await open(page,{[KEY]:baseState()});const before=await stored(page);
  await go(page,'premium');await page.click('#atkHouseholdCard');
  const authorized=page.waitForRequest(r=>r.url().startsWith(BACKEND+'/auth/v1/authorize?'));
  await page.getByRole('button',{name:'Googleでログイン'}).click();
  await authorized;
  // Wait for this attempt to be consumed, rather than matching the old document's blank URL.
  await expect.poll(()=>page.evaluate(k=>localStorage.getItem(k),OAUTH)).toBeNull();
  await expect.poll(()=>new URL(page.url()).search).toBe('');
  await expect(page.getByRole('button',{name:'Googleでログイン'})).toBeVisible();
  await expect(page.locator('#atkHhName')).toHaveCount(0);
  expect(authorizations).toBe(1);expect(unexpected).toEqual([]);
  expect(await stored(page)).toEqual(before);
  expect(await page.evaluate(k=>localStorage.getItem(k),OAUTH)).toBeNull();
  expect(await page.evaluate(k=>localStorage.getItem(k),SESSION)).toBeNull();
  await page.reload();expect(await stored(page)).toEqual(before);
  expect(page.__errors).toEqual([]);
});
