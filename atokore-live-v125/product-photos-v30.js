/* Private product photos. Local JPEGs stay in IndexedDB; explicit family sharing uses
 * the household adapter's private Storage bucket. Never upload existing local photos automatically.
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
 const k=key(item);
 loadFor(item).then(url=>{
  if(!head.isConnected)return;
  let image=head.querySelector('.atk-detail-photo');
  if(url){if(!image){image=element('img','atk-detail-photo');image.alt='商品の写真';head.prepend(image)}image.src=url}
  else image?.remove();
  head.querySelector('.atk-photo-open').textContent=url?'写真を変更':'写真を設定';
  if(url&&root.AtokoreHousehold?.homeState?.().joined&&!item.photoPath&&!head.querySelector('.atk-photo-share')){
   const share=element('button','atk-photo-share','この端末の写真を家族と共有');share.type='button';
   share.addEventListener('click',async()=>{share.disabled=true;try{const record=await transaction('readonly',(s,done)=>{const r=s.get(k);r.onsuccess=()=>done(r.result)});const blob=recordBlob(record);if(!blob)throw Error('写真が見つかりません');const result=await root.AtokoreHousehold.sharePhoto(item.id,blob);share.textContent=result.shared?'家族に写真を共有しました':'写真は送信待ちです';root.render?.()}catch(e){share.textContent='共有できませんでした。再試行';share.disabled=false}});head.append(share);
  }
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
 const note=element('p','atk-photo-note',joined?'家族と共有する写真は、参加中の家族だけが見られます。共有済みの写真は同じGoogleアカウントで復旧できます。端末だけの写真は対象外です。':'写真はこのブラウザ内に保存されます。家族共有を始めた後、商品詳細から写真も共有できます。端末だけの写真はバックアップには含まれません。');
 panel.append(close,title,name,preview,pick,file,status,save,reset,note);sheet.append(panel);
 let shareChoice=null;
 if(joined){const label=element('label','atk-edit-inuse');shareChoice=element('input');shareChoice.type='checkbox';shareChoice.checked=true;shareChoice.disabled=!!item.photoPath;label.append(shareChoice,doc.createTextNode('この写真を家族と共有する'));note.before(label)}
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
   await transaction('readwrite',store=>remove?store.delete(session.key):store.put({bytes},session.key));
   cacheBlob(session.key,remove?null:session.blob);
   if(joined&&(shareChoice?.checked||remove&&current.photoPath)){
    const result=await root.AtokoreHousehold.sharePhoto(id,remove?null:session.blob);
    if(!result.shared)root.notifyAtokoreV125H?.('写真は端末に保存済みです。家族への共有情報は送信待ちです。');
   }
   resetShared();
   dispose();root.renderHome?.();root.renderStock?.();root.atkShowDetail?.(id);
  }catch(error){message('端末に保存できた写真は残っています。'+error.message);busy(false)}
 }
 save.addEventListener('click',()=>commit(false));reset.addEventListener('click',()=>commit(true));
 loadFor(item).then(url=>{if(active()&&!session.blob){if(url){preview.src=url;preview.hidden=false;reset.hidden=false}}}).catch(()=>message('写真の保存領域を読み込めませんでした。再読み込みしてお試しください。'));
}
async function moveIdentity(before,after){
 const previous=key(before),next=key(after);if(previous===next)return;
 try{
  await transaction('readwrite',store=>{
   const req=store.get(previous);req.onsuccess=()=>{if(req.result){store.put(req.result,next);store.delete(previous)}};
  });
  const old=cache.get(previous);if(old)root.URL.revokeObjectURL(old);cache.delete(previous);cache.delete(next);
  decorate();detailPhoto();
 }catch(_){root.notifyAtokoreV125H?.('商品情報は保存しましたが、写真を引き継げませんでした。写真を設定し直してください。')}
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
 });
 decorate();detailPhoto();
 root.addEventListener('pagehide',()=>{dispose();for(const url of cache.values())if(url)root.URL.revokeObjectURL(url);cache.clear()});
 root.addEventListener('pageshow',event=>{if(event.persisted){if(doc.getElementById('atkPhotoEditor'))root.closeM?.();root.renderHome?.();root.renderStock?.();detailPhoto()}});
}
const api=Object.freeze({key,fileKind,validBlob});
if(typeof module!=='undefined'&&module.exports)module.exports=api;
root.AtokoreProductPhotos=api;
if(doc)install();
})(typeof globalThis!=='undefined'?globalThis:this);
