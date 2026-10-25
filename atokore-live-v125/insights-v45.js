/* Explain estimates using saved facts instead of unsupported precision. */
(function(root){
'use strict';
const doc=typeof document==='undefined'?null:document;
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function forecast(x){const qty=Math.max(0,Number(x.qty)||0),min=x.minQty==null||x.minQty===''?1:Math.max(0,Number(x.minQty)||0);return {qty,min,priority:qty===0?0:qty<=min?1:2,label:qty===0?'在庫なし・補充を確認':qty<=min?'補充目安以下':'補充目安より多い'}}
function valuation(x){const qty=Math.max(0,Number(x.qty)||0),price=Number(x.price),total=Number(x.purchaseTotal);if(x.freeConfirmed===true)return {value:0,recorded:true,free:true,basis:'無料と確認済み'};if(Number.isFinite(price)&&price>0)return {value:price*qty,recorded:true,basis:'記録した購入価格 '+price.toLocaleString()+'円 × 現在の数量 '+qty+(x.unit||'個')};if(Number.isFinite(total)&&total>0)return {value:total,recorded:true,basis:'保存済みの購入合計 '+total.toLocaleString()+'円（現在の残量に連動しない参考額）'};return {value:0,recorded:false,basis:'価格未記録・合計に含みません'}}
const api={forecast,valuation};root.AtokoreInsights=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;if(!doc)return;
const all=()=>{try{return items}catch(_){return []}};
const close='<button class="close" onclick="closeM()">閉じる</button>';
const oldShow=root.showPremium;
root.showPremium=function(k){
 if(k==='predict'){
  const rows=all().map(x=>({x,...forecast(x)})).sort((a,b)=>a.priority-b.priority||a.qty-b.qty);
  root.openM(close+'<h2>消費予測（補充の目安）</h2><p class="atk-insight-note">消費ペースはまだ計測していません。現在の数量と補充目安で並べています。使い切る日や確率の予測ではありません。</p>'+rows.map(r=>'<div class="atk-insight-row"><strong>'+esc(r.x.name)+'：'+r.label+'</strong><p>根拠：'+esc(r.x.qtyBasis==='unopened'?'未開封の予備':'残り')+r.qty+esc(r.x.unit||'個')+' ／ 補充目安 '+r.min+esc(r.x.unit||'個')+'以下'+(r.x.purchase?' ／ 前回購入日 '+esc(r.x.purchase):' ／ 購入日未記録')+'</p><button class="btn" onclick="premiumBuy('+Number(r.x.id)+')">買い物リストに追加</button></div>').join('')+(!rows.length?'<p>ストックを登録すると表示されます。</p>':''));return;
 }
 if(k==='money'){
  // W2 item 7: products without a price say "価格未記録" (never ¥0); 0円 only when confirmed free.
  const rows=all().map(x=>({x,...valuation(x)})),value=rows.reduce((s,x)=>s+x.value,0),recorded=rows.filter(r=>r.recorded).length;
  const amount=r=>!r.recorded?'価格未記録':r.free?'0円（無料）':'¥'+r.value.toLocaleString('ja-JP',{maximumFractionDigits:2});
  root.openM(close+'<h2>価格記録レポート</h2><div class="metric"><b>¥'+value.toLocaleString('ja-JP',{maximumFractionDigits:2})+'</b><span>記録から計算した参考金額</span></div><p class="atk-insight-note">購入価格を1個あたりの価格として、現在の数量を掛けています。購入合計だけの記録は残量と連動しない参考額です。実際の節約額ではありません。</p><p class="atk-insight-scope">価格記録あり：'+recorded+'／'+rows.length+'商品。未記録の商品は合計に含みません。</p>'+rows.map(r=>'<div class="atk-insight-row'+(r.recorded?'':' is-unrecorded')+'"><strong>'+esc(r.x.name)+'：'+amount(r)+'</strong><p>'+esc(r.basis)+(r.x.store?' ／ '+esc(r.x.store):'')+(r.x.purchase?' ／ '+esc(r.x.purchase):'')+'</p></div>').join(''));return;
 }
 if(k==='qr'){
  const places=[...new Set(all().map(x=>x.place||'未設定'))];root.openM(close+'<h2>保管場所別ストック</h2>'+places.map(place=>'<div class="atk-insight-row"><strong>'+esc(place)+'</strong><p>'+esc(all().filter(x=>(x.place||'未設定')===place).map(x=>x.name+' '+x.qty+(x.unit||'個')).join(' ／ '))+'</p></div>').join('')+(!places.length?'<p>商品の保管場所を登録すると、ここでまとめて確認できます。</p>':''));return;
 }
 return oldShow.apply(this,arguments);
};
for(const [key,title,note] of [['predict','消費予測（補充の目安）','残りの数量と補充目安から確認'],['qr','保管場所別ストック','冷蔵庫・収納など場所ごとに確認'],['money','価格記録レポート','保存した価格と計算の内訳を確認']]){
 const row=doc.querySelector('#pg-premium [onclick="showPremium(\''+key+'\')"]');if(row){row.querySelector('.name').textContent=title;row.querySelector('.meta').textContent=note}
}
const version=doc.createElement('p');version.id='atkVersionInfo';version.className='atk-insight-note';version.textContent='ベビー特化 試用版 v19 ／ 機能更新 v47（2026/10/25）。v19は試用版の公開先、v47は更新履歴の番号です。';doc.getElementById('pg-premium')?.append(version);doc.title='あとこれ｜ベビー特化 試用版v19・機能更新v47';
const originalStock=root.renderStock;
root.renderStock=function(...args){const result=originalStock.apply(this,args);const empty=doc.querySelector('#stockList .empty');if(empty){empty.textContent='条件に合う商品はありません。検索や絞り込みを変えるか、商品を追加してください。';const button=doc.createElement('button');button.type='button';button.className='atk-empty-add';button.textContent='商品を追加する';button.onclick=()=>{const category=typeof filter!=='undefined'&&filter==='離乳食'?'離乳食':null;root.atkOpenAdd();if(category)root.AtokoreQuickAdd.setCategory(category)};empty.append(doc.createElement('br'),button)}return result};
root.renderStock();
})(typeof globalThis!=='undefined'?globalThis:this);
