// Browser auth protocol/UX tests with a simulated Google redirect. Not a real Google login.
const {test,expect}=require('@playwright/test');
const {createHash}=require('node:crypto');
const {open,go,stored,baseState,KEY,shot}=require('./helpers.cjs');
const EMU='http://127.0.0.1:'+(process.env.E2E_HH_PORT||4720);
const OAUTH='atokorePreviewHouseholdOAuthV19',SESSION='atokorePreviewHouseholdSessionV19';
const cors={'access-control-allow-origin':'*','access-control-allow-headers':'apikey,content-type','access-control-allow-methods':'POST,OPTIONS'};
test.beforeEach(async({request})=>{await request.post(EMU+'/__test/reset')});
async function google(page,request){
 const email='google@example.test',headers={apikey:'emu-anon-key'};
 await request.post(EMU+'/auth/v1/otp',{headers,data:{email}});
 const {code}=await(await request.get(EMU+'/__test/otp?email='+email)).json();
 const s=await(await request.post(EMU+'/auth/v1/verify',{headers,data:{type:'email',email,token:code}})).json();
 let exchanges=0,challenge=null;
 await page.addInitScript(config=>{window.ATOKORE_HOUSEHOLD_CONFIG=config},{url:EMU,anonKey:'emu-anon-key',google:true,email:false});
 await page.route(EMU+'/auth/v1/authorize?**',async route=>{
  const u=new URL(route.request().url());challenge=u.searchParams.get('code_challenge');
  expect(u.searchParams.get('code_challenge_method')).toBe('s256');
  await route.fulfill({status:302,headers:{location:u.searchParams.get('redirect_to')+'&code=fake-google-code'}});
 });
 await page.route(EMU+'/auth/v1/token?grant_type=pkce',async route=>{
  if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers:cors});
  exchanges++;expect(route.request().headers().authorization).toBeUndefined();
  expect(route.request().postDataJSON().auth_code).toBe('fake-google-code');
  expect(challenge).toBe(createHash('sha256').update(route.request().postDataJSON().code_verifier).digest('base64url'));
  await route.fulfill({status:200,contentType:'application/json',headers:cors,body:JSON.stringify(s)});
 });
 return ()=>exchanges;
}
for(const width of [320,375,390,430])test(`Google entry and callback at ${width}px preserve stock and ask before sharing`,async({page,request},info)=>{
 await page.setViewportSize({width,height:640});const exchanges=await google(page,request);
 await open(page,{[KEY]:baseState()});const before=await stored(page);
 await go(page,'premium');await page.click('#atkHouseholdCard');
 await expect(page.getByRole('button',{name:'Googleでログイン'})).toBeVisible();
 await expect(page.locator('#atkHhEmail')).toHaveCount(0);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 if(width===320)await shot(page,info,'v40-google-login-320');
 await page.getByRole('button',{name:'Googleでログイン'}).click();
 await expect(page.locator('#atkHhName')).toBeVisible();
 expect(exchanges()).toBe(1);expect(new URL(page.url()).search).toBe('');
 expect(await page.evaluate(k=>localStorage.getItem(k),OAUTH)).toBeNull();
 expect(await stored(page)).toEqual(before);
 expect(await page.evaluate(k=>JSON.parse(localStorage.getItem(k)).user.id,SESSION)).toBeTruthy();
 await page.reload();expect(exchanges()).toBe(1);expect(await stored(page)).toEqual(before);
 expect(page.__errors).toEqual([]);
});
test('session storage failure after callback does not claim sign-in or change stock',async({page,request})=>{
 await google(page,request);
 await page.addInitScript(key=>{const set=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k===key)throw new DOMException('quota','QuotaExceededError');return set.call(this,k,v)}},SESSION);
 await open(page,{[KEY]:baseState()});const before=await stored(page);
 await go(page,'premium');await page.click('#atkHouseholdCard');await page.getByRole('button',{name:'Googleでログイン'}).click();
 await expect(page.getByRole('button',{name:'Googleでログイン'})).toBeVisible();
 await expect(page.locator('#atkHhName')).toHaveCount(0);
 expect(await stored(page)).toEqual(before);
 expect(await page.evaluate(k=>localStorage.getItem(k),SESSION)).toBeNull();
 expect(new URL(page.url()).search).toBe('');
});
