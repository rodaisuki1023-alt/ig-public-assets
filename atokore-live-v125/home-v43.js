/* Home v43: read-only summaries of the existing stock and change history. */
(function(root){
'use strict';
const doc=typeof document==='undefined'?null:document;
const $=id=>doc?.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const paths={home:'M3 11 12 3l9 8v10h-6v-7H9v7H3Z',stock:'M4 5h16v16H4ZM3 2h18v5H3Zm6 9h6',add:'M12 4v16M4 12h16',buy:'m2 3 3 1 3 12h11l3-9H6M9 21h.01M19 21h.01',premium:'M20 21v-2a7 7 0 0 0-14 0v2M17 7a5 5 0 1 1-10 0 5 5 0 0 1 10 0',receipt:'M5 2h14v20l-3-2-4 2-4-2-3 2Zm3 5h8M8 11h8M8 15h5'};
function icon(name){return '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="'+paths[name]+'"/></svg>'}
const dates=root.AtokoreDates||(typeof require==='function'?require('./common-v45.js'):null);
function expiryDays(item,now){return dates.remaining(item?.exp,now)}
function attention(items,now){
 return items.map(item=>({item,days:expiryDays(item,now),low:root.atokoreIsLow?root.atokoreIsLow(item):Number(item.qty)<=1}))
  .filter(x=>x.low||(x.days!==null&&x.days<=3))
  .sort((a,b)=>((a.days!==null&&a.days<=3)?a.days:Infinity)-((b.days!==null&&b.days<=3)?b.days:Infinity));
}
function relative(at,now=Date.now()){
 const t=new Date(at).getTime();if(!Number.isFinite(t))return '';
 const mins=Math.max(0,Math.floor((now-t)/60000));if(mins<1)return 'たった今';if(mins<60)return mins+'分前';
 const d=new Date(t),today=new Date(now),time=d.toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'});
 return (d.toDateString()===today.toDateString()?'今日 ':d.toLocaleDateString('ja-JP',{month:'numeric',day:'numeric'})+' ')+time;
}
function sharedEntries(rows){
 const groups=[];
 for(const row of rows||[]){
  if(!Number.isFinite(new Date(row?.at).getTime()))continue;
  const key=JSON.stringify([row.at,row.who,row.type,row.kind]);
  const prior=groups.find(g=>g.key===key);
  if(prior)prior.rows.push(row);else groups.push({key,rows:[row]});
 }
 return groups.map(g=>{
  const r=g.rows[0],who=String(r.who||'家族'),name=String(r.name||'削除済みの商品');
  const place=r.kind==='buy'?'買い物リスト':r.kind==='routine'?'いつものリスト':'ストック';
  const what=r.type==='undo_purchase'?'の「買った」を取り消し':r.type==='complete_buy'?'を「買った」':r.type==='create'?'を追加':r.type==='delete'?'を削除':r.type==='add'?'の数量を変更':'を更新';
  const qty=Number(r.delta),unit=String(r.unit||'個'),delta=r.type==='add'&&r.beforeQty!=null&&r.afterQty!=null?r.beforeQty+unit+' → '+r.afterQty+unit:r.type==='add'&&r.delta!==null&&Number.isFinite(qty)?'数量 '+(qty>0?'＋':'')+qty+unit:r.type==='create'&&r.afterQty!=null?place+'に'+r.afterQty+unit+'追加':r.type==='set'?({name:'商品名',place:'保管場所',exp:'期限',memo:'メモ',qtyBasis:'在庫の数え方',inUse:'使用中の有無',photoPath:'写真'}[r.field]||'商品情報')+'を変更':place;
  return {at:r.at,who,title:who+'が'+(g.rows.length>1?place+'の'+g.rows.length+'商品':name)+what,
   detail:g.rows.length>1?g.rows.slice(0,2).map(x=>String(x.name||'削除済みの商品')).join('、')+(g.rows.length>2?' ほか'+(g.rows.length-2)+'商品':''):r.type==='complete_buy'?(r.delta!=null?r.delta+unit+'「買った」でストックに追加':'「買った」でストックに追加'):delta,
   type:r.type==='complete_buy'?'purchase':r.kind==='buy'?'buy':'stock'};
 }).sort((a,b)=>new Date(b.at)-new Date(a.at));
}
function localEntries(rows){
 return (rows||[]).filter(r=>r&&Number.isFinite(Number(r.ts)))
  .map(r=>({at:Number(r.ts),who:'自分',title:String(r.title||'内容を変更'),detail:String(r.detail||''),type:r.type==='buy'?'buy':'stock'}))
  .sort((a,b)=>b.at-a.at);
}
function activityHTML(entries,exact=false){
 return entries.map(r=>'<li class="atk-home-change"><span class="atk-home-avatar '+(r.type==='buy'?'is-buy':r.type==='purchase'?'is-purchase':'')+'" aria-hidden="true">'+esc(Array.from(r.who)[0]||'家')+'</span><span class="atk-home-change-copy"><strong>'+esc(r.title)+'</strong><small>'+esc(r.detail)+'</small></span><time datetime="'+esc(new Date(r.at).toISOString())+'">'+esc(exact?new Date(r.at).toLocaleString('ja-JP',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}):relative(r.at))+'</time></li>').join('');
}
function card(x){
 const item=x.item,raw=String(item.name||'商品'),id=Number(item.id),kit=root.AtokoreBabyKit;
 const type=kit?.kind(raw,item.cat),d=root.AtokorePeachUI?.describe(item),food=root.AtokoreBabyFood;
 let title=raw,sub=item.cat||'',art='';
 if(type){
  art=kit.icon(type,48);
  title=type==='diaper'?'オムツ'+(d?.size?' '+d.size+'サイズ':''):type==='wipes'?'おしりふき':(d?.line&&d.line!=='粉ミルク'?d.line+' ':'')+'粉ミルク';
  sub=[kit.brand(raw),d?.type,d?.line&&![title,'おむつ','おしりふき','粉ミルク'].includes(d.line)?d.line:''].filter(Boolean).join('・')||raw;
 }else art=(food?.isRecord(item)?food.icon(48):root.AtokoreIndividualIcons?.icon(raw))||icon('stock');
 const expiry=root.AtokoreDates?.label(item.exp)||'';
 const labels=(x.low?'<span class="atk-home-low">'+(Number(item.qty)<=0?(item.qtyBasis==='unopened'?'未開封の予備なし':'在庫なし'):esc(root.AtokorePolish?.stockLabel(item)||'残り'+item.qty+(item.unit||'個')))+'</span>':'')+(expiry?'<span class="atk-home-expiry '+(x.days<=0?'is-overdue':'')+'">'+esc(expiry)+'</span>':'');
 const already=(()=>{try{return buys.some(b=>root.__atokoreCoreV125H?.sameProduct(b,item))}catch(_){return false}})();
 const control=x.low&&Number.isSafeInteger(id)?'<button type="button" data-atk-replenish="'+id+'"'+(already?' disabled':'')+'>'+(already?'買い物に追加済み':'買い物に追加')+'</button>':'';
 return '<div class="atk-home-stock-wrap"><button type="button" class="atk-item-card atk-home-stock" '+(Number.isSafeInteger(id)?'data-atk-open="'+id+'"':'disabled')+'><span class="atk-item-id"><span class="atk-brand bf-home-product">'+art+'</span></span><span class="atk-item-copy"><strong>'+esc(title)+'</strong><small>'+esc(sub)+'</small></span><span class="atk-home-flags">'+labels+'</span><span class="atk-chevron" aria-hidden="true">›</span></button>'+control+'</div>';
}
function html(){return '<div class="atk-home atk-home-v43">'+
 '<div class="atk-actions"><button type="button" data-atk-add class="atk-action atk-action-primary">'+icon('add')+'<span>ストック追加</span></button><button type="button" data-atk-receipt class="atk-action atk-action-peach">'+icon('receipt')+'<span>レシートで追加</span></button></div>'+
 '<section id="atkHomeAttention" aria-labelledby="atkHomeAttentionTitle"><div class="atk-section-head"><h2 id="atkHomeAttentionTitle">補充・期限の確認</h2><button type="button" data-atk-nav="stock">ストックへ ›</button></div><p class="atk-home-history-note">補充目安以下の商品と、期限まで3日以内の商品。補充目安は商品編集で変更できます（未設定は数量1以下）。</p><div id="atkTasks" class="atk-home-stock-list"></div><button type="button" id="atkHomeMoreStock" class="atk-home-more" hidden></button></section>'+
 '<section aria-labelledby="atkHomeHistoryTitle"><div class="atk-section-head"><h2 id="atkHomeHistoryTitle">最近の変更</h2><button type="button" id="atkHomeAllChanges">すべて見る ›</button></div><p id="atkHomeHistoryNote" class="atk-home-history-note" role="status"></p><ol id="atkHomeActivity" class="atk-home-activity"></ol><button type="button" id="atkHomeHistoryRefresh" class="atk-home-more" hidden>履歴を再読み込み</button></section></div>'}
function state(){try{return root.AtokoreHousehold?.homeState?.()||{joined:false}}catch(_){return {joined:false}}}
function entries(s){return s.joined?sharedEntries(s.changes):localEntries(root.AtokoreHistory?.recent?.()||[])}
let lastCards='';
function render(){
 if(!$('atkHomeActivity'))return;
 let data=[],buy=[];try{data=items;buy=buys}catch(_){}
 const checks=attention(Array.isArray(data)?data:[]),cards=checks.slice(0,2).map(card).join('');
 $('atkHomeAttention').hidden=!checks.length;
 if(cards!==lastCards){$('atkTasks').innerHTML=cards;lastCards=cards}
 const more=$('atkHomeMoreStock');more.hidden=checks.length<=2;more.textContent='ほか'+Math.max(0,checks.length-2)+'商品を確認';
 const badge=$('atkHomeBuyBadge');if(badge){badge.hidden=!buy.length;badge.textContent=buy.length>99?'99+':String(buy.length)}
 const s=state(),list=entries(s);
 $('atkHomeHistoryTitle').textContent=s.joined?'家族の最近の変更':'この端末の最近の変更';
 const note=s.joined?(s.historyState==='error'?'履歴を更新できませんでした。表示中の履歴は前回取得した内容です。':s.historyState==='loading'?'家族の履歴を読み込んでいます…':list.length?'':'まだ家族の変更はありません。'):list.length?'':'商品を追加したり、数を変えたりすると、ここに表示されます。';
 $('atkHomeHistoryNote').textContent=note;$('atkHomeHistoryNote').hidden=!note;
 $('atkHomeHistoryRefresh').hidden=!(s.joined&&s.historyState==='error');
 const content=activityHTML(list.slice(0,3));if($('atkHomeActivity').innerHTML!==content)$('atkHomeActivity').innerHTML=content;
 $('atkHomeActivity').hidden=!list.length;
 const start=$('atkHomeShareStart');if(start){start.hidden=!!s.joined;start.disabled=!root.AtokoreHousehold?.open}
 // Same summary as the share dialog (household-sync shareSummary); the chip next to this shows its headline.
 const sum=s.summary||{kind:'local',headline:'この端末だけで利用中'};
 const time=$('atkHomeLastSync');
 if(time){time.textContent=!s.joined?sum.headline:sum.kind==='shared'?(s.lastSync?'最終同期 '+relative(s.lastSync):''):sum.kind==='pending'?'未送信 '+sum.pending+'件':sum.kind==='unknown'?(s.lastSync?'最後に確認 '+relative(s.lastSync):'未確認'):'';time.hidden=!time.textContent}
 const sync=$('atkHomeSyncNow');if(sync){sync.hidden=!(s.joined&&(sum.kind==='pending'||sum.kind==='unknown'));sync.textContent=sum.kind==='unknown'?'再確認':'今すぐ同期'}
}
function openAll(){
 const s=state(),list=entries(s),title=s.joined?'家族の変更履歴':'この端末の変更履歴';
 root.openM?.('<button class="close" onclick="closeM()">閉じる</button><h2>'+title+'</h2>'+(s.joined&&s.historyState==='error'?'<p>履歴を更新できませんでした。前回取得した履歴を表示しています。</p>':'')+'<ol class="atk-home-activity atk-home-all">'+activityHTML(list,true)+'</ol>'+(!list.length?'<p>まだ変更履歴はありません。</p>':''));
}
function install(){
 doc.body.classList.add('atk-home-v43');
 const top=doc.querySelector('.top');
 if(top)top.innerHTML='<div class="atk-top-title"><h1>あとこれ</h1><span>わが家のストック</span></div><div class="atk-home-sharing"><button type="button" id="atkHomeShareStart">家族と共有する</button><small id="atkHomeLastSync"></small><button type="button" id="atkHomeSyncNow" hidden>今すぐ同期</button></div>';
 for(const [page,label] of [['home','ホーム'],['stock','ストック'],['buy','買い物'],['premium','マイページ']]){
  const tab=doc.querySelector('.tabs [data-p="'+page+'"]');if(tab)tab.innerHTML=icon(page)+'<span>'+label+'</span>'+(page==='buy'?'<span id="atkHomeBuyBadge" class="atk-home-buy-badge" hidden></span>':'');
 }
 const add=$('bfNavAdd');if(add)add.innerHTML=icon('add')+'<span>追加</span>';
 doc.addEventListener('DOMContentLoaded',()=>{const add=$('bfNavAdd');if(add)add.innerHTML=icon('add')+'<span>追加</span>';root.renderHome?.()},{once:true});
 doc.addEventListener('click',e=>{
  if(e.target.closest('#atkHomeAllChanges'))openAll();
  if(e.target.closest('#atkHomeShareStart'))root.AtokoreHousehold?.open?.();
  if(e.target.closest('#atkHomeSyncNow')){const b=e.target.closest('#atkHomeSyncNow');b.disabled=true;Promise.resolve(root.AtokoreHousehold?.syncNow?.()).finally(()=>{b.disabled=false;root.renderHome?.()})}
  if(e.target.closest('#atkHomeHistoryRefresh'))root.AtokoreHousehold?.refreshChanges?.();
  if(e.target.closest('#atkHomeMoreStock')){
   let a=[];try{a=items}catch(_){}
   root.openM?.('<button class="close" onclick="closeM()">閉じる</button><h2>補充・期限の確認</h2><div class="atk-home-stock-list">'+attention(a).map(card).join('')+'</div>');
  }
 });
 doc.addEventListener('atokore-household-updated',()=>{root.renderHome?.()});
 doc.addEventListener('atokore-history-updated',()=>{root.renderHome?.()});
}
const api=Object.freeze({html,render,install,attention,expiryDays,relative,sharedEntries,localEntries});
root.AtokoreHome=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
