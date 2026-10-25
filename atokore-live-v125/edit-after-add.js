/* Edit after add — first-party local-only UI. Uses existing atokoreTrialV4 records. */
(function(root){
'use strict';
const $=id=>typeof document==='undefined'?null:document.getElementById(id);
const esc=text=>String(text??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const CATEGORIES=['食料品','日用品','衛生・薬','ベビー','離乳食','子ども','衣類','家電・生活用品','防災','その他'];
const UNITS=['個','本','袋','箱','パック','枚','缶','セット','g','kg','mL','L'];
const PLACES=['','冷蔵庫','冷凍庫','パントリー','洗面所','トイレ','収納','防災収納','その他'];
const EXPIRY=['期限なし','賞味期限','消費期限','使用期限'];
function formOptions(values,selected){
 return [...new Set([...values,String(selected||'')])].filter(Boolean).map(v=>'<option value="'+esc(v)+'"'+(v===selected?' selected':'')+'>'+esc(v)+'</option>').join('');
}
function read(id){
 try{return items.find(x=>Number(x.id)===Number(id))||null}catch(e){return null}
}
function validate(input,current,options={}){
 if(!current||!Number.isSafeInteger(Number(current.id)))throw Error('編集する商品が見つかりません');
 const name=String(input.name||'').trim();
 if(!name||name.length>120)throw Error('商品名は1〜120文字で入力してください');
 const qty=Number(input.qty);
 const cat=String(input.cat||''),unit=String(input.unit||''),place=String(input.place||'');
 // W2 item 8: limit by unit; a saved quantity already above it may stay as it is or be reduced.
 const rules=root.AtokoreStockRules;
 if(rules&&!options.skipQtyLimit){const problem=rules.checkEdit(qty,{unit,before:current.qty,beforeUnit:current.unit});if(problem)throw Error(problem)}
 else if(!Number.isSafeInteger(qty)||qty<0||qty>99999)throw Error('在庫数は0〜99999の整数を入力してください');
 if(!CATEGORIES.includes(cat)||!unit||unit.length>24)throw Error('カテゴリー・単位を確認してください');
 const expType=String(input.expType||'期限なし');
 if(!EXPIRY.includes(expType))throw Error('期限の種類を確認してください');
 const exp=expType==='期限なし'?'':String(input.exp||'');
 if(expType!=='期限なし'&&!/^\d{4}-\d{2}-\d{2}$/.test(exp))throw Error('期限日を入力してください');
 const memo=String(input.memo||'').trim();
 if(memo.length>500)throw Error('メモは500文字以内で入力してください');
 const store=String(input.store||'').trim();
 if(store.length>120)throw Error('購入店舗は120文字以内で入力してください');
 const price=Number(input.price||0);
 if(!Number.isFinite(price)||price<0||price>10000000)throw Error('購入価格を確認してください');
 // Optional reorder line: empty means the default (要補充 at 1 or less).
 const rawMin=input.minQty==null?'':String(input.minQty).trim();
 const minQty=rawMin===''?null:Number(rawMin);
 if(minQty!==null&&(!Number.isSafeInteger(minQty)||minQty<0||minQty>9999))throw Error('補充の目安は0〜9999の整数で入力してください（空欄なら1）');
 const next={...current,name,cat,qty,unit,place,expType,exp,memo,store,price,
  purchase:String(input.purchase||'')};
 if(input.qtyBasis!==undefined){
  if(!['total','unopened'].includes(input.qtyBasis))throw Error('在庫の数え方を確認してください');
  next.qtyBasis=input.qtyBasis;next.inUse=input.inUse==='on'||input.inUse===true;
 }
 if(minQty===null)delete next.minQty;else next.minQty=minQty;
 return next;
}
function edit(id,options={}){
 const draft=typeof options.onSave==='function';
 const item=draft?options.item:read(id);if(!item){root.alert?.('商品が見つかりません');return}
 const n=Number(item.id);if(!Number.isSafeInteger(n))return;
 const panel='<button type="button" class="close" onclick="closeM()">閉じる</button>'+
 '<form id="atkEditForm" class="atk-edit-form">'+
 '<h2>'+(draft?'追加予定の商品を編集':'商品情報を編集')+'</h2><p class="atk-edit-hint">'+(draft?'確認画面へ戻ってから、まとめて追加するまで保存されません。':'必要な情報だけ変更できます。')+'</p>'+
 '<label>商品名<input name="name" id="atkEditName" maxlength="120" required value="'+esc(item.name)+'"></label>'+
 '<div class="atk-edit-pair"><label>在庫数<input name="qty" type="number" required min="0" max="'+(root.AtokoreStockRules?root.AtokoreStockRules.inputMax(item.unit,item.qty):99999)+'" step="1" inputmode="numeric" value="'+esc(item.qty)+'"></label>'+
 '<label>単位<select name="unit">'+formOptions(UNITS,item.unit||'個')+'</select></label></div>'+
 '<label>在庫の数え方<select name="qtyBasis"><option value="total"'+(item.qtyBasis!=='unopened'?' selected':'')+'>使用中を含む個数</option><option value="unopened"'+(item.qtyBasis==='unopened'?' selected':'')+'>未開封の予備だけ</option></select><small>数え方を変更しても数量は自動で変わりません。上の数を合わせてください。</small></label>'+
 '<label class="atk-edit-inuse"><input name="inUse" type="checkbox"'+(item.inUse?' checked':'')+'>使用中の商品が別にある（任意）</label>'+
 '<label class="atk-edit-reorder">補充の目安（任意）<span class="atk-edit-inline"><span>残り</span><input name="minQty" type="number" min="0" max="9999" step="1" inputmode="numeric" placeholder="1" value="'+esc(item.minQty??'')+'"><span>以下でホームの「補充・期限の確認」に表示</span></span><small>空欄なら残り1以下で表示します</small></label>'+
 '<label>カテゴリー<select name="cat">'+formOptions(CATEGORIES,item.cat||'その他')+'</select></label>'+
 '<label>保管場所<select name="place"><option value="">未設定</option>'+formOptions(PLACES,item.place||'')+'</select></label>'+
 '<div class="atk-edit-pair"><label>期限の種類<select name="expType">'+formOptions(EXPIRY,item.expType||'期限なし')+'</select></label>'+
 '<label id="atkEditExpiryWrap">期限日<input name="exp" type="date" value="'+esc(item.exp||'')+'"></label></div>'+
 '<label>メモ<textarea name="memo" maxlength="500" rows="3" placeholder="例：いつものメーカー">'+esc(item.memo||'')+'</textarea></label>'+
 '<details class="atk-edit-extra"><summary>購入情報（必要な場合）</summary>'+
 '<label>購入日<input name="purchase" type="date" value="'+esc(item.purchase||'')+'"></label>'+
 '<label>1個あたりの購入価格<input name="price" type="number" min="0" max="10000000" step="1" inputmode="numeric" value="'+esc(item.price||0)+'"></label>'+
 '<label>購入店舗<input name="store" maxlength="120" value="'+esc(item.store||'')+'"></label></details>'+
 '<p id="atkEditError" class="atk-edit-error" role="alert" hidden></p>'+
 '<button type="submit" class="atk-edit-save">'+(draft?'確認画面に反映する':'変更を保存する')+'</button>'+
 '</form>';
 root.openM?.(panel);
 const form=$('atkEditForm');if(!form)return;
 const expiry=form.elements.namedItem('expType'),expiryWrap=$('atkEditExpiryWrap');
 const toggle=()=>{expiryWrap.hidden=expiry.value==='期限なし';form.elements.namedItem('exp').required=expiry.value!=='期限なし'};
 expiry.addEventListener('change',toggle);toggle();
 // The quantity field follows the selected unit's limit (a kept higher quantity stays allowed for its own unit).
 const unitField=form.elements.namedItem('unit'),qtyField=form.elements.namedItem('qty'),rules=root.AtokoreStockRules;
 if(rules&&unitField&&qtyField)unitField.addEventListener('change',()=>{qtyField.max=String(rules.inputMax(unitField.value,unitField.value===item.unit?item.qty:0,draft?999:99999))});
 form.addEventListener('submit',event=>{
  event.preventDefault();
 const curr=draft?options.item:read(id),error=$('atkEditError');
  try{
   root.AtokoreDataSafety?.assertWritable?.();
   const values=Object.fromEntries(new FormData(form).entries());
   const next=validate(values,curr,draft?{skipQtyLimit:true}:{});
   if(draft){options.onSave(next);root.closeM?.();return}
   // Optimistic in-memory updates are avoided: write to localStorage before UI mutation.
   const records=items.map(x=>Number(x.id)===n?next:x);
   localStorage.setItem('atokoreTrialV4',JSON.stringify({items:records,buys,routines}));
   items=records;
   document.dispatchEvent(new CustomEvent('atokore-stock-edited',{detail:{before:curr,after:next}}));
   // Notify any existing local-first family/sync adapters, then redraw.
   if(typeof root.save==='function')root.save();
   root.render?.();
   root.closeM?.();
   root.notifyAtokoreV125H?.('商品情報を変更しました');
  }catch(e){
   // Storage failures (quota, private mode) leave the saved record untouched; never show a raw DOMException.
   const storageFailure=typeof DOMException!=='undefined'&&e instanceof DOMException;
   if(error){error.textContent=storageFailure?'保存できませんでした。端末の空き容量を確認してください（変更前の内容は残っています）':(e?.message||'保存に失敗しました');error.hidden=false}
  }
 });
 if(draft){const close=$('sheet')?.querySelector('.close');if(close){close.removeAttribute('onclick');close.addEventListener('click',()=>{root.closeM?.();options.onCancel?.()})}}
}
function install(){
 const nav=document.querySelector('.tabs');
 if(nav){
  const tab=nav.querySelector('.tab[data-p="add"]');
  if(tab){tab.style.display='';tab.innerHTML='<b>＋</b>ストック追加';tab.setAttribute('aria-label','ストック追加');tab.setAttribute('title','ストック追加')}
 }
 // Keep the quick-add page simple: advanced editing now lives under each stock item.
 const page=$('pg-add');page?.classList.add('atk-edit-after-add');
}
const api=Object.freeze({validate,formOptions});
if(typeof module!=='undefined'&&module.exports)module.exports=api;
root.atokoreEditStock=edit;root.AtokoreEditAfterAdd=api;
if(typeof document!=='undefined'&&typeof window!=='undefined')install();
})(typeof globalThis!=='undefined'?globalThis:this);
