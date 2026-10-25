const {test,expect}=require('@playwright/test');
const {open,go,stored,baseState,KEY,HISTORY,shot, appConfirm}=require('./helpers.cjs');
const EMU='http://127.0.0.1:'+(process.env.E2E_HH_PORT||4720);
const CFG={url:EMU,anonKey:'emu-anon-key',google:true,guest:true,email:false};
for(const width of [320,390,430])test(`home v43 has two safe actions, real local activity and a single navigation row at ${width}px`,async({page},info)=>{
 await page.setViewportSize({width,height:844});
 const date=new Date();date.setDate(date.getDate()+2);const exp=[date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-');
 const state=baseState({items:[{...baseState().items[1],qty:1},{id:77,name:'にんじんペースト',cat:'離乳食',qty:5,unit:'個',exp}],buys:baseState().buys});
 await open(page,{[KEY]:state,[HISTORY]:[{ts:Date.now()-600000,title:'ストックを追加',detail:'おしりふき 2個'},{ts:Date.now()-1800000,title:'買い物に追加',detail:'粉ミルク 1缶'},{ts:Date.now()-3600000,title:'数量を変更',detail:'オムツ 2袋 → 1袋'}]});
 await expect(page.locator('.atk-home-v43 .atk-actions button')).toHaveCount(2);
 await expect(page.locator('#homeHero,.atk-summary')).toHaveCount(0);
 await expect(page.locator('#atkTasks [data-atk-open]')).toHaveCount(2);
 await expect(page.locator('#atkTasks')).toContainText('あと2日');
 await expect(page.locator('#atkHomeActivity li')).toHaveCount(3);
 await expect(page.locator('#atkHomeBuyBadge')).toHaveText('1');
 expect(await stored(page)).toEqual(state);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 const geometry=await page.locator('.tabs .tab').evaluateAll(tabs=>tabs.filter(t=>getComputedStyle(t).display!=='none').map(t=>{const r=t.getBoundingClientRect();return {top:r.top,right:r.right,left:r.left,bottom:r.bottom}}));
 expect(geometry).toHaveLength(5);expect(new Set(geometry.map(r=>r.top)).size).toBe(1);
 expect(geometry.every(r=>r.left>=0&&r.right<=width&&r.bottom<=844)).toBe(true);
 await shot(page,info,`v43-home-${width}`);
 await page.locator('#atkTasks [data-atk-open="2"]').click();await expect(page.locator('#sheet')).toContainText('M');
 expect(await stored(page)).toEqual(state);await page.getByRole('button',{name:'閉じる',exact:true}).click();
 await page.locator('#atkHomeAllChanges').click();await expect(page.getByRole('heading',{name:'この端末の変更履歴'})).toBeVisible();
 await page.getByRole('button',{name:'閉じる',exact:true}).click();
 await page.locator('#pg-home [data-atk-add]').click();await expect(page.locator('#pg-add')).toHaveClass(/on/);expect(await stored(page)).toEqual(state);
 await go(page,'home');await page.locator('#pg-home [data-atk-receipt]').click();await expect(page.locator('#sheet')).toContainText('レシート');expect(await stored(page)).toEqual(state);
 expect(page.__errors).toEqual([]);
});

test('no alerts for sufficient stock, new successful batch appears once, failed save adds no activity',async({page})=>{
 const initial=baseState({items:[{...baseState().items[1],qty:9}],buys:[],routines:[]});
 await open(page,{[KEY]:initial,[HISTORY]:[]});await expect(page.locator('#atkHomeAttention')).toBeHidden();
 await page.locator('#pg-home [data-atk-add]').click();
 await page.evaluate(()=>window.AtokoreQuickAdd.openWithEntries([{name:'新しいティッシュ',qty:2,unit:'箱',cat:'日用品'}]));
 await page.evaluate(()=>{const old=Storage.prototype.setItem;window.undoSave=()=>Storage.prototype.setItem=old;Storage.prototype.setItem=function(k,v){if(k==='atokorePreviewTrialV19')throw new DOMException('full','QuotaExceededError');return old.call(this,k,v)}});
 await page.click('#qaCommit');await expect(page.locator('#qaNotice')).toContainText('保存できませんでした');
 expect(await page.evaluate(k=>JSON.parse(localStorage.getItem(k)),HISTORY)).toEqual([]);expect(await stored(page)).toEqual(initial);
 await page.evaluate(()=>window.undoSave());await page.click('#qaCommit');await go(page,'home');
 await expect(page.locator('#atkHomeActivity')).toContainText('新しいティッシュ');await expect(page.locator('#atkHomeActivity li')).toHaveCount(1);
 await page.reload();await expect(page.locator('#atkHomeActivity')).toContainText('新しいティッシュ');
});

test('long names and hostile history stay readable at 320px; more alerts reveal only actual attention items',async({page})=>{
 await page.setViewportSize({width:320,height:640});
 const state=baseState({items:[{id:1,name:'とても長い商品名'.repeat(10),cat:'日用品',qty:1,unit:'個'},{id:2,name:'期限切れ',qty:5,unit:'本',exp:'2020-01-01'},{id:3,name:'不足している商品',qty:0,unit:'個'},{id:4,name:'十分ある商品',qty:9,unit:'個'}],buys:[],routines:[]});
 await open(page,{[KEY]:state,[HISTORY]:[{ts:Date.now(),title:'<img src=x onerror="window.__unsafe=true">',detail:'<script>bad()</script>'}]});
 await expect(page.locator('#atkHomeActivity')).toContainText('<img');await expect(page.locator('#atkHomeActivity img, #atkHomeActivity script')).toHaveCount(0);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await expect(page.locator('#atkTasks [data-atk-open]').first()).toHaveAttribute('data-atk-open','2');
 await page.locator('#atkHomeMoreStock').click();await expect(page.locator('#sheet [data-atk-open]')).toHaveCount(3);
 await expect(page.locator('#sheet')).not.toContainText('十分ある商品');expect(await stored(page)).toEqual(state);
});

test('two household members see confirmed family history, retries do not duplicate it and logout hides it',async({browser,request},info)=>{
 await request.post(EMU+'/__test/reset');
 async function device(state){const ctx=await browser.newContext({...info.project.use,baseURL:info.project.use.baseURL});const page=await ctx.newPage();await page.addInitScript(c=>window.ATOKORE_HOUSEHOLD_CONFIG=c,CFG);await open(page,{[KEY]:state});return {ctx,page}}
 const a=await device(baseState()),b=await device({items:[],buys:[],routines:[]});
 try{
  await go(a.page,'premium');await a.page.click('#atkHouseholdCard');await a.page.getByRole('button',{name:'Googleでログイン',exact:true}).click();
  await a.page.fill('#atkHhName','共有テスト担当');await a.page.getByRole('button',{name:'世帯を作る',exact:true}).click();await appConfirm(a.page,true);
  await expect(a.page.locator('#atkHouseholdStatus')).toHaveText(/^(\d+人で共有中|家族と共有中)$/);await a.page.getByRole('button',{name:/家族を招待する/}).click();
  const link=await a.page.locator('#atkHhInviteLink').inputValue();await b.page.goto(link);await b.page.fill('#atkHhGuestName','家族');
  await b.page.getByRole('button',{name:'Googleなしで共有に参加する',exact:true}).click();await expect(b.page.locator('#atkHouseholdStatus')).toHaveText(/^(\d+人で共有中|家族と共有中)$/);
  await a.page.getByRole('button',{name:'閉じる',exact:true}).click();await b.page.getByRole('button',{name:'閉じる',exact:true}).click();
  await a.page.evaluate(()=>{adj(1,1)});await a.page.evaluate(()=>AtokoreHousehold.syncNow());await b.page.evaluate(()=>AtokoreHousehold.syncNow());
  await go(b.page,'home');await expect(b.page.locator('#atkHomeHistoryTitle')).toHaveText('家族の最近の変更');
  await expect(b.page.locator('#atkHomeActivity')).toContainText('共有テスト担当：牛乳の数量を変更');
  const content=await b.page.locator('#atkHomeActivity').textContent();await b.page.evaluate(()=>AtokoreHousehold.syncNow());expect(await b.page.locator('#atkHomeActivity').textContent()).toBe(content);
  await request.post(EMU+'/__test/history-failure',{data:{enabled:true}});
  await b.page.evaluate(()=>AtokoreHousehold.syncNow());await expect(b.page.locator('#atkHomeHistoryNote')).toContainText('履歴を更新できませんでした');
  await expect(b.page.locator('#atkHomeActivity')).toContainText('共有テスト担当');await expect(b.page.locator('#atkHomeHistoryRefresh')).toBeVisible();
  await request.post(EMU+'/__test/history-failure',{data:{enabled:false}});await b.page.locator('#atkHomeHistoryRefresh').click();await expect(b.page.locator('#atkHomeHistoryRefresh')).toBeHidden();
  await b.page.addInitScript(()=>Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>false}));await b.page.reload();
  await expect(b.page.locator('#atkHomeHistoryNote')).toContainText('履歴を更新できませんでした');await expect(b.page.locator('#atkHouseholdChip')).toHaveText('共有状態を確認できません');
  await b.page.evaluate(()=>Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>true}));await b.page.evaluate(()=>AtokoreHousehold.syncNow());
  await expect(b.page.locator('#atkHomeActivity')).toContainText('共有テスト担当：牛乳の数量を変更');
  await b.page.locator('#atkHouseholdChip').click();await b.page.getByRole('button',{name:'ログアウト',exact:true}).click();await appConfirm(b.page,true);
  await expect(b.page.locator('#atkHomeHistoryTitle')).toHaveText('この端末の最近の変更');await expect(b.page.locator('#atkHomeActivity')).not.toContainText('共有テスト担当');
  expect(b.page.__errors).toEqual([]);
 }finally{await a.ctx.close();await b.ctx.close()}
});
