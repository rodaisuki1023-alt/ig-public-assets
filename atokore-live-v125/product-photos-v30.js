/* Product photos. JPEGs (256px, metadata stripped) are kept in IndexedDB. While the family shares
 * data, every product photo is shared through the household's private Storage bucket, like the
 * product itself: a photo set while sharing is sent right away (or when the connection is back),
 * and photos set before sharing started are sent once sharing is confirmed.
 * Local records: {bytes, pending} — pending:true means "not yet sent to the family";
 * {removed:true, pending:true} means "removal not yet sent". Backups include the photos.
 */
(function(root){
'use strict';
const DB='atokorePreviewProductPhotosV19',STORE='photos',MAX_INPUT=20*1024*1024,MAX_OUTPUT=80*1024;
const doc=typeof document==='undefined'?null:document;
const storageError=()=>Error('写真を保存できませんでした。空き容量やブラウザの設定を確認してください。変更前の写真と在庫は残っています。');
function key(item){return JSON.stringify([String(item.id),String(item.name||''),String(item.unit||'個')])}
function validBlob(blob){return !!blob&&blob.type==='image/jpeg'&&blob.size>0&&blob.size<=MAX_OUTPUT}
function recordBlob(record){
 const bytes=record?.bytes;
 if(!(bytes instanceof Uint8Array)||!bytes.length||bytes.length>MAX_OUTPUT||fileKind(bytes.slice(0,32))!=='jpeg')return null;
 return new root.Blob([bytes],{type:'image/jpeg'});
}
function fileKind(bytes){
 if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return 'jpeg';
 if([137,80,78,71,13,10,26,10].every((n,i)=>bytes[i]===n))return 'png';
 const text=String.fromCharCode(...bytes);
 if(text.slice(0,4)==='RIFF'&&text.slice(8,12)==='WEBP')return 'webp';
 if(text.slice(4,8)==='ftyp'&&/heic|heix|hevc|hevx|mif1/.test(text.slice(8)))return 'heic';
 return null;
}
function readItem(id){try{return items.find(x=>String(x.id)===String(id))||null}catch(_){return null}}
let connection=null;
function database(){
 if(connection)return connection;
 connection=new Promise((resolve,reject)=>{
  let req,settled=false;
  const fail=()=>{if(!settled){settled=true;reject(Error('写真の保存領域を開けませんでした。ほかのタブを閉じて再読み込みしてください。'))}};
  try{req=root.indexedDB.open(DB,1)}catch(_){fail();return}
  req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains(STORE))req.result.createObjectStore(STORE)};
  req.onerror=fail;req.onblocked=fail;
  req.onsuccess=()=>{
   const db=req.result;if(settled){db.close();return}settled=true;
   db.onversionchange=()=>{db.close();connection=null};resolve(db);
  };
 }).catch(error=>{connection=null;throw error});
 return connection;
}
async function transaction(mode,work){
 const db=await database();
 return new Promise((resolve,reject)=>{
  let tx,result;
  try{tx=db.transaction(STORE,mode);work(tx.objectStore(STORE),value=>{result=value})}
  catch(error){try{tx?.abort()}catch(_){}reject(storageError());return}
  tx.oncomplete=()=>resolve(result);
  tx.onerror=tx.onabort=()=>reject(storageError());
 });
}
const cache=new Map(),pending=new Map(),originals=new WeakMap();
function cacheBlob(k,blob){
 const old=cache.get(k);if(old)root.URL.revokeObjectURL(old);
 const url=validBlob(blob)?root.URL.createObjectURL(blob):null;cache.set(k,url);return url;
}
async function load(k){
 if(cache.has(k))return cache.get(k);
 if(pending.has(k))return pending.get(k);
 const task=transaction('readonly',(store,done)=>{const req=store.get(k);req.onsuccess=()=>done(req.result)})
  .then(record=>cache.has(k)?cache.get(k):cacheBlob(k,recordBlob(record))).finally(()=>pending.delete(k));
 pending.set(k,task);return task;
}
const sharedCache=new Map(),sharedPending=new Map();let photoHousehold='';
function scopeKey(){const s=root.AtokoreHousehold?.homeState?.();return s?.joined?root.AtokoreHousehold?.photoScope?.(readFirstId())?.household||'':''}
function readFirstId(){try{return items[0]?.id}catch(_){return null}}
function resetShared(){for(const url of sharedCache.values())if(url)root.URL.revokeObjectURL(url);sharedCache.clear();sharedPending.clear()}
async function loadFor(item){
 const hh=root.AtokoreHousehold,scope=hh?.photoScope?.(item.id);
 if(!scope||!item.photoPath)return load(key(item));
 const sk=scope.household+':'+scope.user+':'+item.photoPath;
 if(sharedCache.has(sk))return sharedCache.get(sk);
 if(sharedPending.has(sk))return sharedPending.get(sk);
 const task=hh.fetchPhoto(item.id,item.photoPath).then(async blob=>{
  const current=readItem(item.id),now=hh.photoScope(item.id);
  if(!blob||!validBlob(blob)||!current||current.photoPath!==item.photoPath||now?.household!==scope.household||now?.user!==scope.user)return null;
  if(fileKind(new Uint8Array(await blob.slice(0,32).arrayBuffer()))!=='jpeg')return null;
  const url=root.URL.createObjectURL(blob);sharedCache.set(sk,url);return url;
 }).finally(()=>{if(sharedPending.get(sk)===task)sharedPending.delete(sk)});
 sharedPending.set(sk,task);return task;
}
async function compress(file){
 if(!file||!file.size||file.size>MAX_INPUT)throw Error('写真は20MB以下のJPEG・PNG・WebP・HEICを選んでください。');
 const bytes=new Uint8Array(await file.slice(0,32).arrayBuffer());
 if(!fileKind(bytes))throw Error('対応していない画像です。JPEG・PNG・WebPの写真を選んでください。');
 const url=root.URL.createObjectURL(file),image=new root.Image();
 try{
  await new Promise((resolve,reject)=>{
   const fail=()=>{clearTimeout(timer);reject(Error('写真を読み込めませんでした。HEICの場合はJPEGに変換して選び直してください。'))};
   const timer=setTimeout(fail,15000);image.onload=()=>{clearTimeout(timer);resolve()};image.onerror=fail;image.src=url;
  });
  if(!image.naturalWidth||!image.naturalHeight||image.naturalWidth*image.naturalHeight>50000000)throw Error('写真が大きすぎます。サイズを小さくして選び直してください。');
  const canvas=doc.createElement('canvas');canvas.width=256;canvas.height=256;
  const ctx=canvas.getContext('2d');if(!ctx)throw Error('このブラウザでは写真を処理できません。');
  const scale=Math.min(256/image.naturalWidth,256/image.naturalHeight);
  const width=image.naturalWidth*scale,height=image.naturalHeight*scale;
  ctx.fillStyle='#fff';ctx.fillRect(0,0,256,256);ctx.drawImage(image,(256-width)/2,(256-height)/2,width,height);
  // Drawing into a fresh canvas strips original EXIF/location metadata.
  for(const quality of [.82,.65,.45]){
   const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',quality));
   if(validBlob(blob))return blob;
  }
  throw Error('写真を小さくできませんでした。別の写真を選んでください。');
 }finally{image.onload=image.onerror=null;image.src='';root.URL.revokeObjectURL(url)}
}
function element(tag,cls,text){const el=doc.createElement(tag);if(cls)el.className=cls;if(text)el.textContent=text;return el}
function picture(badge,url){
 if(!badge)return;
 if(!originals.has(badge))originals.set(badge,[...badge.childNodes].map(n=>n.cloneNode(true)));
 if(!url){if(badge.classList.contains('atk-has-photo')){badge.replaceChildren(...originals.get(badge).map(n=>n.cloneNode(true)));badge.classList.remove('atk-has-photo')}return}
 if(badge.querySelector('.atk-user-photo')?.getAttribute('src')===url)return;
 const label=badge.querySelector('.bf-baby-brand,.atk-photo-brand')?.textContent||badge.textContent.trim();
 const img=element('img','atk-user-photo');img.alt='';img.src=url;img.width=256;img.height=256;
 img.addEventListener('error',()=>picture(badge,null),{once:true});
 badge.replaceChildren(img);if(label)badge.append(element('span','atk-photo-brand',label));badge.classList.add('atk-has-photo');
}
function decorate(){
 for(const row of doc.querySelectorAll('#stockList [data-stock-id],#pg-home [data-atk-open],#buyList [data-buy-id]')){
  let item=readItem(row.dataset.stockId||row.dataset.atkOpen);
  if(row.dataset.buyId){try{const buy=buys.find(x=>String(x.id)===row.dataset.buyId);item=items.find(x=>root.__atokoreCoreV125H.sameProduct(x,buy))}catch(_){}}
  if(!item)continue;
  const k=key(item),badge=row.querySelector('.atk-row-brand,.atk-brand');if(!badge)continue;
  loadFor(item).then(url=>{if(row.isConnected&&key(readItem(item.id)||{})===k)picture(badge,url)}).catch(()=>picture(badge,null));
 }
}
let editor=null;
function dispose(){if(editor){editor.serial++;if(editor.preview)root.URL.revokeObjectURL(editor.preview);editor=null}}
function detailPhoto(){
 const head=doc.querySelector('#sheet [data-atk-detail-id]');if(!head)return;
 const item=readItem(head.dataset.atkDetailId);if(!item)return;
 if(!head.querySelector('.atk-photo-open')){
  const button=element('button','atk-photo-open','写真を設定');button.type='button';
  button.addEventListener('click',()=>openEditor(item.id));head.append(button);
 }
 loadFor(item).then(url=>{
  if(!head.isConnected)return;
  let image=head.querySelector('.atk-detail-photo');
  if(url){if(!image){image=element('img','atk-detail-photo');image.alt='商品の写真';head.prepend(image)}image.src=url}
  else image?.remove();
  head.querySelector('.atk-photo-open').textContent=url?'写真を変更':'写真を設定';
 }).catch(()=>{});
}
function openEditor(id){
 const item=readItem(id);if(!item)return;
 root.openM?.('');
 const sheet=doc.getElementById('sheet');if(!sheet)return;
 const panel=element('div','atk-photo-editor');panel.id='atkPhotoEditor';
 const close=element('button','close','閉じる');close.type='button';close.addEventListener('click',()=>{if(!editor?.busy){dispose();root.atkShowDetail?.(id)}});
 const title=element('h2','','商品の写真'),name=element('p','',item.name);
 const preview=element('img','atk-photo-preview');preview.alt='設定する写真のプレビュー';preview.hidden=true;
 const pick=element('button','atk-photo-pick','撮影・写真を選ぶ');pick.type='button';
 const file=element('input');file.type='file';file.accept='image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif';file.hidden=true;file.setAttribute('aria-label','商品の写真を選択');
 const status=element('p','atk-photo-status');status.setAttribute('role','status');
 const save=element('button','atk-photo-save','この写真にする');save.type='button';save.disabled=true;
 const reset=element('button','atk-photo-reset','元のアイコンに戻す');reset.type='button';reset.hidden=true;
 const joined=!!root.AtokoreHousehold?.homeState?.().joined;
 const note=element('p','atk-photo-note',joined?'写真は家族と自動で共有されます（参加中の家族だけが見られます）。バックアップファイルにも含まれます。':'写真はこのブラウザ内に保存され、バックアップファイルにも含まれます。家族共有を始めると、自動で家族と共有されます。');
 panel.append(close,title,name,preview,pick,file,status,save,reset,note);sheet.append(panel);
 const session={panel,serial:0,busy:false,preview:null,blob:null,key:key(item)};editor=session;
 const active=()=>editor===session&&panel.isConnected;
 const busy=value=>{session.busy=value;pick.disabled=close.disabled=reset.disabled=value;save.disabled=value||!session.blob};
 const message=text=>{if(active())status.textContent=text};
 pick.addEventListener('click',()=>file.click());
 file.addEventListener('change',async()=>{
  const chosen=file.files?.[0];file.value='';if(!chosen)return;
  const serial=++session.serial;busy(true);message('写真を準備しています…');
  try{
   const blob=await compress(chosen);if(!active()||serial!==session.serial)return;
   if(session.preview)root.URL.revokeObjectURL(session.preview);
   session.blob=blob;session.preview=root.URL.createObjectURL(blob);preview.src=session.preview;preview.hidden=false;
   message('この写真でよければ保存してください。');
  }catch(error){message(error.message)}finally{if(active()&&serial===session.serial)busy(false)}
 });
 async function commit(remove){
  if(!active()||session.busy||(!remove&&!session.blob))return;
  if(remove&&!await root.AtokoreConfirm.ask('写真を外しますか？','写真を外して元のアイコンに戻します。','写真を外す'))return;
  if(remove&&(!active()||session.busy))return; // closed or busy while the question was open
  busy(true);message('保存しています…');
  try{
   root.AtokoreDataSafety?.assertWritable?.();
   const current=readItem(id);if(!current||key(current)!==session.key)throw Error('商品情報が変わりました。閉じてから選び直してください。');
   // Typed bytes avoid Blob cloning differences in WebKit's IndexedDB implementations.
   const bytes=remove?null:new Uint8Array(await session.blob.arrayBuffer());
   const sharing=!!root.AtokoreHousehold?.homeState?.().joined;
   // While sharing, the change is marked "not yet sent" until the family has it.
   const record=remove?(sharing&&current.photoPath?{removed:true,pending:true}:null):(sharing?{bytes,pending:true}:{bytes});
   await transaction('readwrite',store=>record?store.put(record,session.key):store.delete(session.key));
   cacheBlob(session.key,remove?null:session.blob);
   resetShared();
   if(sharing&&record){
    const sent=await sendOne(current,record).catch(()=>false);
    if(!sent)root.notifyAtokoreV125H?.('写真は端末に保存しました。家族への共有は、つながったときに自動で送ります。');
   }
   dispose();root.renderHome?.();root.renderStock?.();root.atkShowDetail?.(id);
  }catch(error){message('端末に保存できた写真は残っています。'+error.message);busy(false)}
 }
 save.addEventListener('click',()=>commit(false));reset.addEventListener('click',()=>commit(true));
 loadFor(item).then(url=>{if(active()&&!session.blob){if(url){preview.src=url;preview.hidden=false;reset.hidden=false}}}).catch(()=>message('写真の保存領域を読み込めませんでした。再読み込みしてお試しください。'));
}
// ---------------------------------------------------------------- sharing with the family
async function readRecord(k){return transaction('readonly',(store,done)=>{const r=store.get(k);r.onsuccess=()=>done(r.result)})}
async function allRecords(){
 return transaction('readonly',(store,done)=>{
  const out=[];const r=store.openCursor();
  r.onsuccess=()=>{const c=r.result;if(!c){done(out);return}if(typeof c.key==='string'&&c.key.startsWith('['))out.push([c.key,c.value]);c.continue()};
 });
}
// Sends one local photo change to the family. True when the family has it.
async function sendOne(item,record){
 const hh=root.AtokoreHousehold;if(!hh?.homeState?.().joined)return false;
 const k=key(item);
 const blob=record.removed?null:recordBlob(record);if(!record.removed&&!blob)return false;
 // Throws when the upload or the record could not be made; once it returns, the photo's place is
 // recorded in the product and reaches the family with the next sync.
 await hh.sharePhoto(item.id,blob);
 const latest=await readRecord(k);
 // Only clear the marker if the photo was not changed again meanwhile.
 if(latest&&(latest.removed===record.removed)&&(record.removed||latest.bytes?.length===record.bytes?.length)){
  await transaction('readwrite',store=>latest.removed?store.delete(k):store.put({bytes:latest.bytes,pending:false},k));
 }
 resetShared();decorate();detailPhoto();
 return true;
}
// Which local photos still have to reach the family: changes made while sharing (pending), and
// photos from before sharing started (no marker) for products that have no family photo yet.
function needsSending(item,record){
 if(!item||!record)return false;
 if(record.pending===true)return true;
 return record.pending===undefined&&!record.removed&&!item.photoPath;
}
let sharing=null;
async function shareWaiting(){
 const hh=root.AtokoreHousehold,s=hh?.homeState?.();
 if(!s?.joined||s.state!=='synced'||sharing)return sharing;
 sharing=(async()=>{
  let list=[];try{list=items.slice()}catch(_){}
  const byKey=new Map(list.map(x=>[key(x),x]));
  for(const [k,record] of await allRecords()){
   const item=byKey.get(k);
   if(!needsSending(item,record))continue;
   if(!await sendOne(item,record).catch(()=>false))break; // try again on the next update
  }
 })().finally(()=>{sharing=null});
 return sharing;
}
// ---------------------------------------------------------------- backup
function toBase64(bytes){let s='';for(let i=0;i<bytes.length;i+=8192)s+=String.fromCharCode(...bytes.subarray(i,i+8192));return root.btoa(s)}
function fromBase64(text){
 if(typeof text!=='string'||text.length>MAX_OUTPUT*2)return null;
 try{const bin=root.atob(text),out=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)out[i]=bin.charCodeAt(i);return out}catch(_){return null}
}
// Photos of the given products for a backup file: the device copy, or the family photo when only
// the family has it. missing counts photos that could not be read (e.g. offline).
async function exportPhotos(list){
 const photos=[];let missing=0;
 for(const item of list){
  let bytes=null;
  try{const r=await readRecord(key(item));if(r&&!r.removed&&recordBlob(r))bytes=r.bytes}catch(_){}
  if(!bytes&&item.photoPath&&root.AtokoreHousehold?.homeState?.().joined){
   try{const blob=await root.AtokoreHousehold.fetchPhoto(item.id,item.photoPath);if(blob&&validBlob(blob))bytes=new Uint8Array(await blob.arrayBuffer())}catch(_){missing++;continue}
  }
  if(bytes)photos.push({id:String(item.id),name:String(item.name||''),unit:String(item.unit||'個'),jpeg:toBase64(bytes)});
  else if(item.photoPath)missing++;
 }
 return {photos,missing};
}
// Validates photos read from a backup file: only small JPEGs for products in the restored data.
function parsePhotos(list,restoredItems){
 const wanted=new Set((restoredItems||[]).map(x=>key(x)));const out=[];
 for(const p of Array.isArray(list)?list:[]){
  if(!p||typeof p!=='object')continue;
  const k=key({id:p.id,name:p.name,unit:p.unit}),bytes=fromBase64(p.jpeg);
  if(!wanted.has(k)||!bytes||!bytes.length||bytes.length>MAX_OUTPUT||fileKind(bytes.slice(0,32))!=='jpeg')continue;
  out.push({k,bytes});
 }
 return out;
}
async function countPhotos(list){
 let n=0;
 for(const item of list){
  if(item.photoPath){n++;continue}
  try{const r=await readRecord(key(item));if(r&&!r.removed&&recordBlob(r))n++}catch(_){}
 }
 return n;
}
const ASIDE='beforeRestore:';
// Restore replaces the photos as well; the current ones are set aside so "復元前に戻す" brings them back.
async function replaceAll(parsed){
 await transaction('readwrite',store=>{
  const r=store.openCursor();
  r.onsuccess=()=>{
   const c=r.result;if(!c){for(const p of parsed)store.put({bytes:p.bytes},p.k);return}
   if(typeof c.key==='string'){if(c.key.startsWith(ASIDE))c.delete();else{store.put(c.value,ASIDE+c.key);c.delete()}}
   c.continue();
  };
 });
 for(const url of cache.values())if(url)root.URL.revokeObjectURL(url);cache.clear();
}
async function undoReplace(){
 await transaction('readwrite',store=>{
  const keep=[],r=store.openCursor();
  r.onsuccess=()=>{
   const c=r.result;
   if(!c){for(const [k,v] of keep)store.put(v,k);return}
   if(typeof c.key==='string'){if(c.key.startsWith(ASIDE))keep.push([c.key.slice(ASIDE.length),c.value]);c.delete()}
   c.continue();
  };
 });
 for(const url of cache.values())if(url)root.URL.revokeObjectURL(url);cache.clear();
}
// A rename keeps the device photo. Only a product that has a photo here is reported: a product
// without a photo is never told that "the photo" could not be carried over.
async function moveIdentity(before,after){
 const previous=key(before),next=key(after);if(previous===next)return;
 let record;
 try{record=await readRecord(previous)}
 catch(_){if(cache.get(previous))root.notifyAtokoreV125H?.('商品は保存しました。写真だけ引き継げませんでした。写真を設定し直してください。');return}
 if(!record){cache.delete(previous);return}
 try{
  await transaction('readwrite',store=>{store.put(record,next);store.delete(previous)});
  const old=cache.get(previous);if(old)root.URL.revokeObjectURL(old);cache.delete(previous);cache.delete(next);
  decorate();detailPhoto();
 }catch(_){root.notifyAtokoreV125H?.('商品は保存しました。写真だけ引き継げませんでした。写真を設定し直してください。')}
}
function install(){
 // Never enable this UI in the normal app or another trial sharing this origin.
 if(!/\/preview-baby-v19\//.test(root.location?.pathname||''))return;
 for(const name of ['renderHome','renderStock','renderBuy']){
  const prior=root[name];if(typeof prior==='function')root[name]=function(...args){const result=prior.apply(this,args);decorate();return result};
 }
 const priorOpen=root.openM,priorClose=root.closeM;
 root.openM=function(...args){dispose();const result=priorOpen.apply(this,args);detailPhoto();return result};
 root.closeM=function(...args){if(editor?.busy)return;dispose();return priorClose.apply(this,args)};
 doc.addEventListener('atokore-stock-edited',event=>moveIdentity(event.detail.before,event.detail.after));
 doc.addEventListener('atokore-household-updated',()=>{
  const next=scopeKey();if(next!==photoHousehold){photoHousehold=next;resetShared();decorate();detailPhoto()}
  shareWaiting();
 });
 decorate();detailPhoto();
 root.addEventListener('pagehide',()=>{dispose();for(const url of cache.values())if(url)root.URL.revokeObjectURL(url);cache.clear()});
 root.addEventListener('pageshow',event=>{if(event.persisted){if(doc.getElementById('atkPhotoEditor'))root.closeM?.();root.renderHome?.();root.renderStock?.();detailPhoto()}});
}
const api=Object.freeze({key,fileKind,validBlob,needsSending,exportPhotos,parsePhotos,countPhotos,replaceAll,undoReplace,shareWaiting});
if(typeof module!=='undefined'&&module.exports)module.exports=api;
root.AtokoreProductPhotos=api;
if(doc)install();
})(typeof globalThis!=='undefined'?globalThis:this);
