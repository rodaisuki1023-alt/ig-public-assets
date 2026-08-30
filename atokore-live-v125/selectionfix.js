/* あとこれ v12.5 - iPhone向け在庫選択→買い物 確実反映 */
(()=>{
  if(typeof document==='undefined')return;

  const pickSet=new Set();
  const num=v=>Number(v);
  const finite=v=>Number.isFinite(num(v));

  function checkedIds(){
    return [...document.querySelectorAll('#stockList input.stockPickV124[type="checkbox"]:checked')]
      .map(x=>num(x.value)).filter(Number.isFinite);
  }
  function currentIds(){
    const dom=checkedIds();
    if(dom.length)return [...new Set(dom)];
    if(pickSet.size)return [...pickSet];
    try{
      const a=[]; stockSelected.forEach(id=>a.push(num(id)));
      return [...new Set(a.filter(Number.isFinite))];
    }catch(e){return []}
  }
  function syncLegacy(){
    try{stockSelected.clear();pickSet.forEach(id=>stockSelected.add(id))}catch(e){}
  }
  function refreshCount(){
    // DOMのチェック状態を最優先。再描画前は内部Setを利用。
    const dom=checkedIds();
    if(dom.length||document.querySelectorAll('#stockList input.stockPickV124').length){
      pickSet.clear();dom.forEach(id=>pickSet.add(id));syncLegacy();
    }
    const n=pickSet.size;
    const m=document.getElementById('stockBulkMove');
    const d=document.getElementById('stockBulkDelete');
    if(m)m.textContent=`🛒 選択した${n}件を買い物へ`;
    if(d)d.textContent=`🗑 選択した${n}件を削除`;
  }
  function selectPage(page){
    document.querySelectorAll('.page').forEach(x=>x.classList.remove('on'));
    document.getElementById('pg-'+page)?.classList.add('on');
    document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('on',x.dataset.p===page));
  }
  function addOne(item){
    const unit=item.unit||'個';
    let b=buys.find(v=>num(v.stockId)===num(item.id)||(v.name===item.name&&v.unit===unit));
    if(b)b.qty=(Number(b.qty)||0)+1;
    else buys.push({id:Date.now()+Math.floor(Math.random()*1000000),name:item.name,qty:1,unit,stockId:item.id});
  }
  function showSuccess(msg){
    try{if(typeof toast==='function'){toast(msg);return}}catch(e){}
    const old=document.getElementById('selectionToastV125');if(old)old.remove();
    const t=document.createElement('div');t.id='selectionToastV125';t.textContent=msg;
    t.style.cssText='position:fixed;left:50%;bottom:90px;transform:translateX(-50%);z-index:999;background:#172033;color:white;padding:10px 14px;border-radius:999px;font-size:12px;font-weight:850;white-space:nowrap';
    document.body.appendChild(t);setTimeout(()=>t.remove(),1800);
  }
  function log(title,detail){
    try{const k='atokoreHistoryV1',a=JSON.parse(localStorage.getItem(k)||'[]');a.unshift({id:Date.now()+Math.random(),ts:Date.now(),title,detail,type:'buy',icon:'🛒'});localStorage.setItem(k,JSON.stringify(a.slice(0,200)))}catch(e){}
  }

  function moveNow(){
    const ids=currentIds();
    if(!ids.length){alert('買い物へ追加する商品を選んでください');return}
    const set=new Set(ids.map(num));
    const picked=items.filter(x=>set.has(num(x.id)));
    if(!picked.length){alert('選択した商品を取得できませんでした。いったん「選択解除」して、もう一度選んでください。');return}

    const before=buys.length;
    picked.forEach(addOne);
    try{save()}catch(e){console.error('v12.5 save',e)}

    // メモリ上で反映されたかを必ず確認する。
    const ok=picked.every(x=>buys.some(b=>num(b.stockId)===num(x.id)||(b.name===x.name&&b.unit===(x.unit||'個'))));
    if(!ok){alert('買い物リストへの反映を確認できませんでした。');return}

    pickSet.clear();syncLegacy();
    try{stockSelectMode=false}catch(e){}

    // render()/go()のラッパー競合を避け、必要画面だけ直接更新する。
    try{if(typeof renderBuy==='function')renderBuy()}catch(e){console.error('v12.5 renderBuy',e)}
    try{if(typeof renderStock==='function')renderStock()}catch(e){console.error('v12.5 renderStock',e)}
    try{if(typeof renderHome==='function')renderHome()}catch(e){console.error('v12.5 renderHome',e)}
    selectPage('buy');
    log('買い物リストへ追加',`${picked.length}件をまとめて追加`);
    showSuccess(`${picked.length}件を買い物リストへ追加しました`);
  }

  function deleteNow(){
    const ids=currentIds();
    if(!ids.length){alert('削除する商品を選んでください');return}
    if(!confirm(`選択した${ids.length}件を在庫から削除しますか？`))return;
    const set=new Set(ids.map(num));
    const before=items.length;
    items=items.filter(x=>!set.has(num(x.id)));
    const removed=before-items.length;
    pickSet.clear();syncLegacy();
    try{stockSelectMode=false}catch(e){}
    try{save()}catch(e){}
    try{if(typeof renderStock==='function')renderStock()}catch(e){}
    try{if(typeof renderHome==='function')renderHome()}catch(e){}
    showSuccess(`${removed}件を削除しました`);
  }

  function wire(){
    const list=document.getElementById('stockList');
    if(list&&!list.__v125wired){
      list.__v125wired=true;
      list.addEventListener('change',e=>{
        const ch=e.target.closest?.('input.stockPickV124[type="checkbox"]');
        if(!ch)return;
        const id=num(ch.value);if(!finite(id))return;
        if(ch.checked)pickSet.add(id);else pickSet.delete(id);
        syncLegacy();
        ch.closest('.row')?.classList.toggle('stableSelected',ch.checked);
        refreshCount();
      });
      list.addEventListener('click',e=>{
        if(e.target.closest('button,input,select,textarea,a'))return;
        let mode=false;try{mode=!!stockSelectMode}catch(err){}
        if(!mode)return;
        const row=e.target.closest('[data-stock-id]');if(!row)return;
        const ch=row.querySelector('input.stockPickV124[type="checkbox"]');if(!ch)return;
        ch.checked=!ch.checked;ch.dispatchEvent(new Event('change',{bubbles:true}));
      });
    }
    const move=document.getElementById('stockBulkMove');
    if(move){move.removeAttribute('onclick');move.onclick=e=>{e.preventDefault();e.stopPropagation();moveNow()}}
    const del=document.getElementById('stockBulkDelete');
    if(del){del.removeAttribute('onclick');del.onclick=e=>{e.preventDefault();e.stopPropagation();deleteNow()}}
  }

  // 既存の関数名もv12.5へ統一。
  window.moveSelectedToBuy=moveNow;
  window.deleteSelectedStock=deleteNow;
  window.setStockPickV124=(id,on)=>{
    id=num(id);if(!finite(id))return;
    if(on)pickSet.add(id);else pickSet.delete(id);
    syncLegacy();
    const ch=document.querySelector(`#stockList input.stockPickV124[value="${id}"]`);if(ch)ch.checked=!!on;
    ch?.closest('.row')?.classList.toggle('stableSelected',!!on);
    refreshCount();
  };
  window.toggleStockPick=id=>window.setStockPickV124(id,!pickSet.has(num(id)));
  window.clearBulkSelection=()=>{
    pickSet.clear();syncLegacy();
    document.querySelectorAll('#stockList input.stockPickV124').forEach(x=>x.checked=false);
    document.querySelectorAll('#stockList .stableSelected').forEach(x=>x.classList.remove('stableSelected'));
    refreshCount();
  };
  window.selectAllVisible=()=>{
    document.querySelectorAll('#stockList input.stockPickV124').forEach(ch=>{ch.checked=true;const id=num(ch.value);if(finite(id))pickSet.add(id)});
    syncLegacy();document.querySelectorAll('#stockList [data-stock-id]').forEach(x=>x.classList.add('stableSelected'));refreshCount();
  };

  // renderStockでDOMが作り直された後も選択を復元・再配線する。
  const oldRenderStock=window.renderStock;
  if(typeof oldRenderStock==='function'&&!oldRenderStock.__v125){
    const wrapped=function(...args){
      const r=oldRenderStock.apply(this,args);
      document.querySelectorAll('#stockList input.stockPickV124').forEach(ch=>{const id=num(ch.value);ch.checked=pickSet.has(id)});
      wire();refreshCount();return r;
    };
    wrapped.__v125=true;window.renderStock=wrapped;
  }

  wire();refreshCount();
  const badge=document.querySelector('.badge');if(badge)badge.textContent='試用版 v12.5';
})();
