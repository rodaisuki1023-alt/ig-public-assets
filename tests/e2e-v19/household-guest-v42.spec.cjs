// Two isolated browsers; real household SQL, simulated Auth (no real account/phone claims).
const {test,expect}=require('@playwright/test');
const {open,go,stored,baseState,KEY,shot, appConfirm}=require('./helpers.cjs');
const EMU='http://127.0.0.1:'+(process.env.E2E_HH_PORT||4720);
const CFG={url:EMU,anonKey:'emu-anon-key',google:true,guest:true,email:false};
const SESSION='atokorePreviewHouseholdSessionV19';
const EMPTY={items:[],buys:[],routines:[]};
async function device(browser,info,state=EMPTY){
 const ctx=await browser.newContext({...info.project.use,baseURL:info.project.use.baseURL});
 const page=await ctx.newPage();const requests=[];
 page.on('request',r=>{if(r.url().startsWith(EMU))requests.push(r.url())});
 await page.addInitScript(c=>{window.ATOKORE_HOUSEHOLD_CONFIG=c},CFG);
 await open(page,{[KEY]:state});return {ctx,page,requests};
}
async function login(page){
 await go(page,'premium');await page.click('#atkHouseholdCard');
 await page.getByRole('button',{name:'Googleでログイン',exact:true}).click();
}
async function owner(browser,info){
 const d=await device(browser,info,baseState());await login(d.page);
 await expect(d.page.locator('#atkHhName')).toBeVisible();await d.page.fill('#atkHhName','作成者');
 await d.page.getByRole('button',{name:'世帯を作る',exact:true}).click();await appConfirm(d.page,true);
 await expect(d.page.locator('#atkHouseholdStatus')).toHaveText(/^(\d+人で共有中|家族と共有中)$/);
 await d.page.getByRole('button',{name:/家族を招待する/}).click();
 return {...d,link:await d.page.locator('#atkHhInviteLink').inputValue(),code:await d.page.locator('#atkHhInviteCode').textContent()};
}
const sync=p=>p.evaluate(()=>window.AtokoreHousehold.syncNow());
const user=p=>p.evaluate(k=>JSON.parse(localStorage.getItem(k)).user,SESSION);
test.beforeEach(async({request})=>{await request.post(EMU+'/__test/reset')});
for(const width of [320,390])test(`invitation opens join directly at ${width}px; guest persists and refreshes without Google`,async({browser,request},info)=>{
 const a=await owner(browser,info),b=await device(browser,info);
 await b.page.setViewportSize({width,height:740});await b.page.goto(a.link);
 await expect(b.page.getByRole('heading',{name:'招待コードで家族に参加'})).toBeVisible();
 await expect(b.page.locator('#atkHhGuestCode')).toHaveValue(a.code);
 expect(b.page.url()).not.toContain('invite=');expect(b.requests.filter(u=>u.includes('/signup'))).toHaveLength(0);
 expect(await stored(b.page)).toEqual(EMPTY);
 await b.page.getByRole('button',{name:'Googleなしで共有に参加する',exact:true}).click();
 expect(b.requests.filter(u=>u.includes('/signup'))).toHaveLength(0);
 await b.page.fill('#atkHhGuestName','家族');
 expect(await b.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await shot(b.page,info,`v42-guest-join-${width}`);
 await b.page.getByRole('button',{name:'Googleなしで共有に参加する',exact:true}).click();
 await expect(b.page.locator('#atkHouseholdStatus')).toHaveText(/^(\d+人で共有中|家族と共有中)$/);
 const uid=(await user(b.page)).id;expect((await user(b.page)).is_anonymous).toBe(true);
 expect((await stored(b.page)).items.map(x=>[x.name,x.qty])).toEqual(baseState().items.map(x=>[x.name,x.qty]));
 // Expire the access token to exercise guest refresh and identity continuity.
 await b.page.evaluate(k=>{const s=JSON.parse(localStorage.getItem(k));s.expires_at=0;localStorage.setItem(k,JSON.stringify(s))},SESSION);
 await b.page.reload();await sync(b.page);expect((await user(b.page)).id).toBe(uid);expect((await user(b.page)).is_anonymous).toBe(true);
 expect(b.requests.filter(u=>u.includes('/signup'))).toHaveLength(1);
 await go(b.page,'premium');await b.page.click('#atkHouseholdCard');
 await b.page.getByRole('button',{name:'機種変更・復旧の手順を見る'}).click();
 await expect(b.page.getByRole('heading',{name:'機種変更・データの復旧'})).toBeVisible();
 await expect(b.page.locator('#sheet')).toContainText('未送信の変更（写真を含む）');
 expect(b.page.__errors).toEqual([]);await a.ctx.close();await b.ctx.close();
});
test('same Google identity on a fresh device restores shared data without a new household or invitation',async({browser},info)=>{
 const a=await owner(browser,info),b=await device(browser,info,baseState({items:[{...baseState().items[0],qty:9}],buys:[],routines:[]}));
 const before=await stored(b.page);await login(b.page);
 await expect(b.page.getByRole('button',{name:/共有のデータを使う/})).toBeVisible();
 expect(await stored(b.page)).toEqual(before);
 await b.page.getByRole('button',{name:/共有のデータを使う/}).click();await appConfirm(b.page,true);
 await expect(b.page.locator('#atkHouseholdStatus')).toHaveText(/^(\d+人で共有中|家族と共有中)$/);
 expect((await user(b.page)).id).toBe((await user(a.page)).id);
 expect((await stored(b.page)).items.map(x=>[x.name,x.qty])).toEqual(baseState().items.map(x=>[x.name,x.qty]));
 const old=await b.page.evaluate(k=>JSON.parse(localStorage.getItem(k+'BeforeShare')),KEY);expect(old.data).toEqual(before);
 expect(b.requests.filter(u=>u.includes('/hh_create')||u.includes('/hh_join'))).toEqual([]);
 await a.ctx.close();await b.ctx.close();
});
test('invalid code retry reuses guest; owner can replace a lost guest while retaining shared stock',async({browser},info)=>{
 const a=await owner(browser,info),b=await device(browser,info);
 await b.page.goto(a.link);await b.page.fill('#atkHhGuestName','旧端末');await b.page.fill('#atkHhGuestCode','ZZZZZZZZ');
 await b.page.getByRole('button',{name:'Googleなしで共有に参加する',exact:true}).click();
 await expect(b.page.getByText('招待コードが正しくありません',{exact:true})).toBeVisible();
 const uid=(await user(b.page)).id;expect(await stored(b.page)).toEqual(EMPTY);
 await b.page.fill('#atkHhGuestCode',a.code);await b.page.getByRole('button',{name:'Googleなしで共有に参加する',exact:true}).click();
 await expect(b.page.locator('#atkHouseholdStatus')).toHaveText(/^(\d+人で共有中|家族と共有中)$/);expect((await user(b.page)).id).toBe(uid);
 expect(b.requests.filter(u=>u.includes('/signup'))).toHaveLength(1);
 await a.page.getByRole('button',{name:'閉じる',exact:true}).click();
 await go(a.page,'premium');await a.page.click('#atkHouseholdCard');
 await a.page.getByRole('button',{name:'外して再招待：旧端末',exact:true}).click();await appConfirm(a.page,true);
 await a.page.getByRole('button',{name:/家族を招待する/}).click();const link=await a.page.locator('#atkHhInviteLink').inputValue();
 const c=await device(browser,info);await c.page.goto(link);await c.page.fill('#atkHhGuestName','新端末');
 await c.page.getByRole('button',{name:'Googleなしで共有に参加する',exact:true}).click();
 await expect(c.page.locator('#atkHouseholdStatus')).toHaveText(/^(\d+人で共有中|家族と共有中)$/);expect((await user(c.page)).id).not.toBe(uid);
 expect((await stored(c.page)).items.map(x=>[x.name,x.qty])).toEqual(baseState().items.map(x=>[x.name,x.qty]));
 await sync(b.page);expect((await b.page.evaluate(()=>window.AtokoreHousehold.status())).state).toBe('removed');
 await a.ctx.close();await b.ctx.close();await c.ctx.close();
});
test('failed guest session persistence never joins or changes local stock',async({browser},info)=>{
 const a=await owner(browser,info),b=await device(browser,info,baseState());const before=await stored(b.page);
 await b.page.goto(a.link);await b.page.fill('#atkHhGuestName','家族');
 await b.page.evaluate(k=>{const original=Storage.prototype.setItem;Storage.prototype.setItem=function(key,v){if(key===k)throw new DOMException('quota','QuotaExceededError');return original.call(this,key,v)}},SESSION);
 await b.page.getByRole('button',{name:'Googleなしで共有に参加する',exact:true}).click();
 await expect(b.page.getByText(/ログイン情報を端末に保存できませんでした/)).toBeVisible();
 expect(b.requests.some(u=>u.includes('/hh_join'))).toBe(false);expect(await stored(b.page)).toEqual(before);
 await a.ctx.close();await b.ctx.close();
});
