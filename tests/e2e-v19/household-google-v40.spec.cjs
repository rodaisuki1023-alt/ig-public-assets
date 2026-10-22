// Browser auth protocol/UX tests with a simulated Google redirect. Not a real Google login.
const {test,expect}=require('@playwright/test');
const {createHash}=require('node:crypto');
const {open,go,stored,baseState,KEY,shot}=require('./helpers.cjs');
const EMU='http://127.0.0.1:'+(process.env.E2E_HH_PORT||4720);
const OAUTH='atokorePreviewHouseholdOAuthV19',SESSION='atokorePreviewHouseholdSessionV19';
test.beforeEach(async({request})=>{await request.post(EMU+'/__test/reset')});
async function google(page,request){
 let exchanges=0,challenge=null;
 await page.addInitScript(config=>{window.ATOKORE_HOUSEHOLD_CONFIG=config},{url:EMU,anonKey:'emu-anon-key',google:true,email:false});
 page.on('request',req=>{
  if(req.url().startsWith(EMU+'/auth/v1/authorize?')){
   const u=new URL(req.url());challenge=u.searchParams.get('code_challenge');expect(u.searchParams.get('code_challenge_method')).toBe('s256');
  }
  if(req.url().includes('/auth/v1/token?grant_type=pkce')&&req.method()==='POST'){
   exchanges++;expect(req.headers().authorization).toBeUndefined();
   expect(req.postDataJSON().auth_code).toBeTruthy();
   expect(challenge).toBe(createHash('sha256').update(req.postDataJSON().code_verifier).digest('base64url'));
  }
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
