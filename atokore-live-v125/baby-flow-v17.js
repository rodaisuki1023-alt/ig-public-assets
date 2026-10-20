/* Atokore v17 mobile navigation + routine-to-picker handoff.
 * Only the sandbox trial loads this file; no marketplace images or third-party scripts.
 */
(function(root){
'use strict';
const doc=typeof document==='undefined'?null:document;
const $=id=>doc?.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const kit=root.AtokoreBabyKit;
function records(){try{return Array.isArray(items)?items:[]}catch(e){return []}}
function sets(){try{return Array.isArray(routines)?routines:[]}catch(e){return []}}
function catFor(name){
 const n=String(name||'');
 const exact=records().find(x=>x.name===n);if(exact?.cat)return exact.cat;
 if(kit?.kind(n))return 'ベビー';
 if(/洗剤|ティッシュ|トイレット|ラップ|スポンジ|シャンプー|ゴミ袋/.test(n))return '日用品';
 return '食料品';
}
function prepared(id){
 const routine=sets().find(x=>String(x.id)===String(id));if(!routine)return null;
 const entries=(routine.items||[]).filter(x=>x&&x.name).map(x=>({
  name:String(x.name).trim(),qty:Math.max(1,Math.min(999,Math.round(Number(x.qty)||1))),
  cat:catFor(x.name),unit:String(x.unit||'個')
 }));
 return {routine,entries};
}
function fromRoutine(id,dest){
 const r=prepared(id);if(!r)return;
 if(!r.entries.length){root.alert?.('このセットには商品がまだありません');return}
 root.closeM?.();
 root.AtokoreQuickAdd?.openWithEntries(r.entries,dest);
 if(r.entries.some(x=>x.cat==='ベビー'))root.AtokoreQuickAdd?.setCategory('ベビー');
 else root.AtokoreQuickAdd?.setCategory('食料品');
}
function showSets(){
 const el=$('routineList');if(!el)return;
 const all=sets();
 if(!all.length){
  el.innerHTML='<div class="bf-empty">いつものセットはまだありません。<br>買い物リストから、よく使う組み合わせを保存できます。</div>';
  return;
 }
 el.innerHTML=all.map(x=>{
  const count=Array.isArray(x.items)?x.items.length:0,first=(x.items||[]).slice(0,3).map(i=>i.name).join('、');
  return '<article class="bf-routine">'+
   '<button type="button" class="bf-routine-main" data-bf-routine="'+esc(x.id)+'"><span class="bf-routine-icon">♡</span><span class="bf-routine-copy"><strong>'+esc(x.name)+'</strong><small>'+count+'商品'+(first?' ・ '+esc(first):'')+'</small></span><span class="bf-arrow">›</span></button>'+
   '<div class="bf-routine-actions"><button type="button" data-bf-routine="'+esc(x.id)+'">＋ ストック追加に反映</button>'+
   '<button type="button" data-bf-routine-buy="'+esc(x.id)+'">買い物へ追加</button>'+
   '<button type="button" data-bf-routine-edit="'+esc(x.id)+'" aria-label="'+esc(x.name)+'を編集">編集</button></div></article>'
 }).join('');
}
function decorateBabyRows(selector){
 doc?.querySelectorAll(selector).forEach(row=>{
  const name=row.querySelector('.name');if(!name)return;
  const raw=name.title||name.textContent||'';
  const kind=kit?.kind(raw);
  if(!kind)return;
  const badge=row.querySelector('.atk-row-brand');
  if(badge&&!badge.classList.contains('bf-baby-product')){
   const brand=kit.brand(raw);
   badge.classList.add('bf-baby-product');
   badge.innerHTML=kit.icon(kind,42)+'<span class="bf-baby-brand">'+esc(brand||(kind==='diaper'?'おむつ':kind==='milk'?'ミルク':'おしりふき'))+'</span>';
  }
 });
}
function decorateHome(){
 doc?.querySelectorAll('#pg-home .atk-item-card').forEach(row=>{
  const brand=row.querySelector('.atk-brand,.atk-brand-generic');
  if(!brand||brand.classList.contains('bf-home-product'))return;
  const title=row.querySelector('.atk-item-copy strong')?.textContent||'';
  const raw=title+' '+brand.textContent;
  const type=kit.kind(raw);if(!type)return;
  brand.classList.add('bf-home-product');
  brand.insertAdjacentHTML('afterbegin',kit.icon(type,32));
 });
}
function modifyBuy(){
 const page=$('pg-buy');if(!page)return;
 const list=$('routineList');if(!list)return;
 const section=list.previousElementSibling;
 const heading=Array.from(page.querySelectorAll('.section')).find(x=>x.textContent.includes('いつものリスト'));
 if(heading)heading.textContent='いつものセット';
 if(!page.querySelector('#bfBuyPick')){
  const actions=doc.createElement('div');actions.className='bf-shopping-start';
  actions.innerHTML='<button type="button" id="bfBuyPick">＋ 商品一覧から買い物に追加</button><p>食品やベビー用品をまとめて選べます。カテゴリを選び直す必要はありません。</p>';
  page.querySelector('.row')?.insertAdjacentElement('afterend',actions);
 }
 const note=list.previousElementSibling;
 if(note?.classList.contains('muted'))note.textContent='セットをタップすると商品が追加画面に読み込まれます。数量を確認して保存するだけ。';
}
function activePage(){
 const page=doc?.querySelector('.page.on')?.id||'pg-home';
 return page.replace(/^pg-/,'');
}
function syncFab(){
 const fab=$('bfAddFab');if(!fab)return;
 const modalOpen=!!$('modal')?.classList.contains('on');
 const addPage=activePage()==='add';
 const editor=!!$('atkEditForm');
 const batch=!!$('qaTray')?.classList.contains('qa-tray-open')&&addPage;
 fab.hidden=modalOpen||addPage||editor||batch;
 fab.setAttribute('aria-hidden',fab.hidden?'true':'false');
}
function install(){
 if(!doc)return;
 doc.body.classList.add('atk-v17');
 const nav=doc.querySelector('.tabs');
 const add=nav?.querySelector('[data-p="add"]');
 if(add){add.setAttribute('hidden','');add.style.setProperty('display','none','important');}
 if(!doc.getElementById('bfAddFab')){
  const fab=doc.createElement('button');
  fab.type='button';fab.id='bfAddFab';fab.textContent='＋ 商品を追加';
  fab.setAttribute('aria-label','商品を追加：ストックまたは買い物リスト');
  fab.addEventListener('click',()=>root.atkOpenAdd?.(activePage()==='buy'?'buy':'stock'));
  doc.body.appendChild(fab);
 }
 const header=$('pg-stock')?.querySelector('.atk-page-title button[data-atk-add]');
 if(header){header.textContent='＋ ストック追加';header.setAttribute('aria-label','ストック追加');}
 const oldOpen=root.atkOpenAdd;
 root.atkOpenAdd=function(destination){
  const selected=destination==='buy'?'buy':'stock';
  oldOpen?.();
  root.AtokoreQuickAdd?.setCategory('ベビー');
  root.AtokoreQuickAdd?.setDestination(selected);
  syncFab();
 };
 const oldRenderRoutines=root.renderRoutines;
 root.renderRoutines=function(...args){if(typeof oldRenderRoutines==='function')oldRenderRoutines.apply(this,args);showSets()};
 const oldStock=root.renderStock,oldBuy=root.renderBuy,oldHome=root.renderHome;
 if(typeof oldStock==='function')root.renderStock=function(...args){const x=oldStock.apply(this,args);decorateBabyRows('#stockList [data-stock-id]');return x};
 if(typeof oldBuy==='function')root.renderBuy=function(...args){const x=oldBuy.apply(this,args);decorateBabyRows('#buyList [data-buy-id]');return x};
 if(typeof oldHome==='function')root.renderHome=function(...args){const x=oldHome.apply(this,args);decorateHome();return x};
 modifyBuy();
 doc.addEventListener('click',ev=>{
  const r=ev.target.closest?.('[data-bf-routine],[data-bf-routine-buy],[data-bf-routine-edit],#bfBuyPick');
  if(!r)return;
  if(r.id==='bfBuyPick'){
   root.AtokoreQuickAdd?.setDestination('buy');
   root.AtokoreQuickAdd?.openWithEntries([],'buy');
   root.AtokoreQuickAdd?.setCategory('ベビー');
  }else if(r.hasAttribute('data-bf-routine')){
   fromRoutine(r.dataset.bfRoutine,'stock');
  }else if(r.hasAttribute('data-bf-routine-buy')){
   fromRoutine(r.dataset.bfRoutineBuy,'buy');
  }else if(r.hasAttribute('data-bf-routine-edit')){
   root.openRoutine?.(Number(r.dataset.bfRoutineEdit));
  }
 });
 const previousGo=root.go;
 if(typeof previousGo==='function')root.go=function(page,...args){
  const result=previousGo.call(this,page,...args);syncFab();return result;
 };
 const previousOpen=root.openM,previousClose=root.closeM;
 if(typeof previousOpen==='function')root.openM=function(...args){
  const result=previousOpen.apply(this,args);syncFab();return result;
 };
 if(typeof previousClose==='function')root.closeM=function(...args){
  const result=previousClose.apply(this,args);syncFab();return result;
 };
 if(typeof MutationObserver!=='undefined'){
  const modal=$('modal');
  if(modal)new MutationObserver(syncFab).observe(modal,{attributes:true,attributeFilter:['class','style','aria-hidden']});
 }
 syncFab();
 showSets();decorateBabyRows('#stockList [data-stock-id]');decorateBabyRows('#buyList [data-buy-id]');decorateHome();
}
const api=Object.freeze({catFor,prepared});
if(typeof module!=='undefined'&&module.exports)module.exports=api;
root.AtokoreBabyFlow=api;
if(doc&&typeof window!=='undefined')install();
})(typeof globalThis!=='undefined'?globalThis:this);
