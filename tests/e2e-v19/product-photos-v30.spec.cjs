const {test,expect}=require('@playwright/test');
const zlib=require('node:zlib');
const {open,go,stored,baseState,KEY,shot}=require('./helpers.cjs');
const DB='atokorePreviewProductPhotosV19';
// Synthetic PNG fixtures, including metadata that must not survive canvas conversion.
function crc32(data){let crc=0xffffffff;for(const b of data){crc^=b;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0)}return (crc^0xffffffff)>>>0}
function chunk(type,data){const label=Buffer.from(type),size=Buffer.alloc(4),crc=Buffer.alloc(4);size.writeUInt32BE(data.length);crc.writeUInt32BE(crc32(Buffer.concat([label,data])));return Buffer.concat([size,label,data,crc])}
function photo(blue=false){
 const header=Buffer.alloc(13);header.writeUInt32BE(80,0);header.writeUInt32BE(40,4);header[8]=8;header[9]=2;
 const pixels=Buffer.alloc(40*(1+80*3));for(let y=0;y<40;y++)for(let x=0;x<80;x++){const i=y*241+1+x*3;pixels[i]=blue?20:230;pixels[i+1]=80;pixels[i+2]=blue?230:20}
 return {name:'test-product.png',mimeType:'image/png',buffer:Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('tEXt',Buffer.from('Comment\0GPS_TEST_PRIVATE_METADATA')),chunk('IDAT',zlib.deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))])};
}
const row=page=>page.locator('#stockList [data-stock-id="2"]');
async function editor(page){await row(page).locator('.name').click();await page.click('.atk-photo-open');await expect(page.locator('#atkPhotoEditor')).toBeVisible()}
async function choose(page,file=photo()){await page.locator('#atkPhotoEditor input[type=file]').setInputFiles(file);await expect(page.locator('.atk-photo-save')).toBeEnabled()}
async function savePhoto(page){await choose(page);await page.click('.atk-photo-save');await expect(page.locator('.atk-detail-photo')).toBeVisible();await page.click('#sheet .close')}
const imageFacts=page=>page.evaluate(async dbName=>{
 const db=await new Promise((resolve,reject)=>{const r=indexedDB.open(dbName,1);r.onsuccess=()=>resolve(r.result);r.onerror=reject});
 const records=await new Promise((resolve,reject)=>{const r=db.transaction('photos').objectStore('photos').getAll();r.onsuccess=()=>resolve(r.result);r.onerror=reject});db.close();
 return Promise.all(records.map(async r=>{
  const bytes=r.bytes;
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(b=>b.toString(16).padStart(2,'0')).join('');
  return {type:'image/jpeg',size:bytes.byteLength,hash,metadata:new TextDecoder().decode(bytes).includes('GPS_TEST_PRIVATE_METADATA')};
 }));
},DB);
for(const [width,height] of [[320,568],[375,667],[390,844],[430,932]]){
 test.describe(`private product photo ${width}px`,()=>{
  test.use({viewport:{width,height}});
  test('preview cancellation, private commit, home/stock icons, reload and corner controls',async({page},info)=>{
   const initial=baseState();initial.items.push({...initial.items[1],id:4,name:'パンパース さらさらケア おむつ テープ L'});
   const uploads=[];page.on('request',r=>{if(['POST','PUT'].includes(r.method()))uploads.push(r.url())});
   await open(page,{[KEY]:initial});await go(page,'stock');await editor(page);await choose(page);
   await expect(page.locator('.atk-photo-preview')).toBeVisible();expect(await stored(page)).toEqual(initial);
   await page.click('#atkPhotoEditor .close');await page.click('#sheet .close');
   await expect(row(page).locator('.atk-user-photo')).toHaveCount(0);expect(await imageFacts(page)).toEqual([]);
   await editor(page);await savePhoto(page);
   await expect(row(page).locator('.atk-user-photo')).toBeVisible();
   await expect(page.locator('#stockList [data-stock-id="4"] .atk-user-photo')).toHaveCount(0);
   expect(await stored(page)).toEqual(initial);
   const records=await imageFacts(page);expect(records).toHaveLength(1);expect(records[0]).toMatchObject({type:'image/jpeg',metadata:false});expect(records[0].size).toBeLessThanOrEqual(81920);
   await go(page,'home');await expect(page.locator('#pg-home [data-atk-open="2"] .atk-user-photo')).toBeVisible();
   await page.reload();await go(page,'stock');
   const img=row(page).locator('.atk-user-photo');await expect(img).toBeVisible();await expect.poll(()=>img.evaluate(i=>i.naturalWidth)).toBe(256);
   await row(page).locator('.name').scrollIntoViewIfNeeded();await shot(page,info,`${width}-v30-product-photo`);
   expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(0);
   await row(page).locator('.qty button').last().click();expect((await stored(page)).items.find(x=>x.id===2).qty).toBe(3);
   await expect(page.locator('#modal')).not.toHaveClass(/on/);await expect(row(page).locator('.atk-user-photo')).toBeVisible();
   expect(uploads).toEqual([]);
  });
 });
}
test('invalid files and failed photo transactions preserve saved photos and all inventory',async({page})=>{
 const initial=baseState();await open(page,{[KEY]:initial});await go(page,'stock');await editor(page);await savePhoto(page);
 const before=await imageFacts(page);await editor(page);
 await page.locator('#atkPhotoEditor input[type=file]').setInputFiles({name:'unsafe.png',mimeType:'image/png',buffer:Buffer.from('<svg onload="window.photoXss=true"></svg>')});
 await expect(page.locator('.atk-photo-status')).toContainText('対応していない');await expect(page.locator('.atk-photo-save')).toBeDisabled();
 await page.locator('#atkPhotoEditor input[type=file]').setInputFiles({name:'broken.png',mimeType:'image/png',buffer:Buffer.from([137,80,78,71,13,10,26,10])});
 await expect(page.locator('.atk-photo-status')).toContainText('読み込めません');
 await choose(page,photo(true));
 await page.evaluate(()=>{window.photoOriginalPut=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(...args){if(this.name==='photos')throw new DOMException('quota','QuotaExceededError');return window.photoOriginalPut.apply(this,args)}});
 await page.click('.atk-photo-save');await expect(page.locator('.atk-photo-status')).toContainText('変更前の写真と在庫は残っています');
 expect(await stored(page)).toEqual(initial);expect(await imageFacts(page)).toEqual(before);
 await page.click('#atkPhotoEditor .close');await expect(page.locator('.atk-detail-photo')).toBeVisible();
 await page.evaluate(()=>{IDBObjectStore.prototype.put=window.photoOriginalPut});
 await page.click('.atk-photo-open');await page.click('.atk-photo-reset');await expect(page.locator('.atk-detail-photo')).toHaveCount(0);
 await page.click('#sheet .close');await expect(row(page).locator('.atk-user-photo')).toHaveCount(0);await expect(row(page).locator('.bf-baby-art')).toBeVisible();
 expect(await stored(page)).toEqual(initial);expect(await imageFacts(page)).toEqual([]);
});
test('renaming keeps the photo, replacing an ID with a different product cannot inherit it',async({page})=>{
 await open(page,{[KEY]:baseState()});await go(page,'stock');await editor(page);await savePhoto(page);
 await row(page).locator('.name').click();await page.click('.atk-edit-open');
 await page.fill('#atkEditForm input[name=name]','ムーニー おむつ パンツ L');await page.click('.atk-edit-save');
 await expect(row(page).locator('.atk-user-photo')).toBeVisible();
 await page.reload();await go(page,'stock');await expect(row(page).locator('.atk-user-photo')).toBeVisible();
 const before=await stored(page);before.items.find(x=>x.id===2).name='明治 ほほえみ 粉ミルク 缶';
 await page.evaluate(({k,data})=>localStorage.setItem(k,JSON.stringify(data)),{k:KEY,data:before});
 await page.reload();await go(page,'stock');await expect(row(page).locator('.atk-user-photo')).toHaveCount(0);
});
test('unavailable photo storage does not affect stock; normal app never enables photo UI',async({page})=>{
 await page.addInitScript(()=>{Object.defineProperty(IDBFactory.prototype,'open',{configurable:true,value(){throw new DOMException('denied','SecurityError')}})});
 const initial=baseState();await open(page,{[KEY]:initial});await go(page,'stock');await editor(page);await choose(page);await page.click('.atk-photo-save');
 await expect(page.locator('.atk-photo-status')).toContainText('保存領域を開けません');expect(await stored(page)).toEqual(initial);
 await page.goto('/ig-public-assets/');await go(page,'stock');await page.locator('#stockList [data-stock-id="2"] .name').click();
 await expect(page.locator('.atk-photo-open')).toHaveCount(0);
});
