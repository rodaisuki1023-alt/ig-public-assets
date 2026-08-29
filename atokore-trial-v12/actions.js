/* あとこれ v12.1 - 在庫/買い物 操作導線の復元・見える化 */
(()=>{
  const css=`
  .manageCard{border:1px solid #cfd9e7!important;background:#f8fbff!important;border-radius:16px!important;padding:10px!important;box-shadow:0 2px 8px #22304708}
  .manageCard .name{font-weight:950}.manageCard .meta{line-height:1.45}.manageCard #stockSelectToggle{white-space:nowrap}
  #stockBulkActions.manageBulk{margin:7px 0 10px;padding:8px;border:1px solid #dbe4ee;border-radius:14px;background:#fff;display:grid;grid-template-columns:1fr 1fr;gap:6px}
  #stockBulkActions.manageBulk.hide{display:none}.manageBulk .btn{min-width:0!important;width:100%;font-size:12px;padding:9px 6px}
  .stockToBuyV12{background:#edf6ff!important;color:#1268b3!important;border:1px solid #cde2f7!important}
  .stockDeleteV12{background:#fff0f0!important;color:#b42318!important;border:1px solid #f7cccc!important}
  .buyManageV12{border:1px solid #dbe4ee;border-radius:16px;background:#f8fbff;padding:10px;margin:8px 0 10px}
  .buyManageHead{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:7px}.buyManageTitle{font-weight:950}.buyManageCount{font-size:11px;color:#667085}
  .buyManageBtns{display:grid;grid-template-columns:1fr 1fr;gap:6px}.buyManageBtns .btn{font-size:12px;padding:9px 6px}
  .buyDeleteTop{background:#fff0f0!important;color:#b42318!important}.buyDoneTop{background:#eaf7ef!important;color:#23724d!important}
  .actionToastV12{position:fixed;left:50%;bottom:92px;transform:translateX(-50%);background:#172033;color:#fff;padding:9px 13px;border-radius:999px;font-size:12px;font-weight:850;z-index:99;box-shadow:0 8px 24px #0004;opacity:0;transition:opacity .18s;pointer-events:none;white-space:nowrap}.actionToastV12.on{opacity:1}
  body.atk-density-ultra .manageCard{padding:5px!important;border-radius:9px!important}.atk-density-ultra #stockBulkActions.manageBulk,.atk-density-ultra .buyManageV12{padding:5px;border-radius:9px;gap:3px;margin:4px 0}.atk-density-ultra .manageBulk .btn,.atk-density-ultra .buyManageBtns .btn{padding:5px 3px;font-size:9px}
  `;
  const st=document.createElement('style');st.textContent=css;document.head.appendChild(st);

  function toast(msg){
    let t=document.getElementById('actionToastV12');
    if(!t){t=document.createElement('div');t.id='actionToastV12';t.className='actionToastV12';document.body.appendChild(t)}
    t.textContent=msg;t.classList.add('on');clearTimeout(toast._t);toast._t=setTimeout(()=>t.classList.remove('on'),1400);
  }

  function getItems(){try{return typeof items!=='undefined'&&Array.isArray(items)?items:[]}catch(e){return []}}
  function getBuys(){try{return typeof buys!=='undefined'&&Array.isArray(buys)?buys:[]}catch(e){return []}}

  window.addStockOneToBuyV12=id=>{
    try{
      const x=getItems().find(v=>Number(v.id)===Number(id));if(!x)return;
      let b=getBuys().find(v=>v.stockId===x.id||(v.name===x.name&&v.unit===x.unit));
      if(b)b.qty=(Number(b.qty)||0)+1;
      else buys.push({id:Date.now()+Number(id),name:x.name,qty:1,unit:x.unit||'個',stockId:x.id});
      save();render();toast(`${x.name}を買い物へ追加`);
    }catch(e){console.error(e)}
  };

  function ensureStock(){
    const pg=document.getElementById('pg-stock');if(!pg)return;
    const toggle=document.getElementById('stockSelectToggle');
    if(toggle){
      const card=toggle.closest('.row');
      if(card){
        card.classList.add('manageCard');
        const n=card.querySelector('.name');if(n)n.textContent='在庫をまとめて操作';
        const m=card.querySelector('.meta');if(m)m.textContent='複数選択して、買い物リストへ追加・一括削除できます';
        toggle.textContent=(typeof stockSelectMode!=='undefined'&&stockSelectMode)?'選択を終了':'☑ 複数選択';
      }
    }
    const bulk=document.getElementById('stockBulkActions');
    if(bulk){
      bulk.classList.add('manageBulk');
      const all=bulk.querySelector('button[onclick*="selectAllVisible"]');if(all)all.textContent='☑ 表示中を全選択';
      const move=document.getElementById('stockBulkMove');if(move)move.textContent=`🛒 選択した${typeof stockSelected!=='undefined'?stockSelected.size:0}件を買い物へ`;
      const del=document.getElementById('stockBulkDelete');if(del)del.textContent=`🗑 選択した${typeof stockSelected!=='undefined'?stockSelected.size:0}件を削除`;
      const clear=bulk.querySelector('button[onclick*="clearBulkSelection"]');if(clear)clear.textContent='選択解除';
    }
    const selecting=typeof stockSelectMode!=='undefined'&&stockSelectMode;
    document.querySelectorAll('#stockList .row').forEach(row=>{
      const del=[...row.querySelectorAll('button')].find(b=>/delItem\(/.test(b.getAttribute('onclick')||''));
      if(!del)return;
      const mt=(del.getAttribute('onclick')||'').match(/delItem\((\d+)\)/);if(!mt)return;
      const id=mt[1];
      del.textContent='🗑';del.title='この在庫を削除';del.setAttribute('aria-label','この在庫を削除');del.classList.add('stockDeleteV12');
      if(!selecting&&!row.querySelector(`.stockToBuyV12[data-id="${id}"]`)){
        const b=document.createElement('button');b.className='icon stockToBuyV12';b.dataset.id=id;b.textContent='🛒';b.title='買い物リストへ追加';b.setAttribute('aria-label','買い物リストへ追加');b.onclick=()=>window.addStockOneToBuyV12(Number(id));del.before(b);
      }
    });
  }

  function buySelectedCount(){try{return typeof selectedBuyIds==='function'?selectedBuyIds().length:document.querySelectorAll('.buyCheck:checked').length}catch(e){return 0}}
  function updateBuyTop(){
    const n=buySelectedCount();
    const c=document.getElementById('buyManageCountV12');if(c)c.textContent=`${n}件選択中`;
    const d=document.getElementById('buyDeleteTopV12');if(d)d.textContent=`🗑 選択${n?` ${n}件`:''}を削除`;
    const done=document.getElementById('buyDoneTopV12');if(done)done.textContent=`✓ 選択${n?` ${n}件`:''}を購入済み`;
  }
  function ensureBuy(){
    const pg=document.getElementById('pg-buy'),list=document.getElementById('buyList');if(!pg||!list)return;
    let panel=document.getElementById('buyManageV12');
    if(!panel){
      panel=document.createElement('div');panel.id='buyManageV12';panel.className='buyManageV12';
      panel.innerHTML=`<div class="buyManageHead"><div><div class="buyManageTitle">買い物リストをまとめて操作</div><div class="meta">チェックした商品を削除・購入済みにできます</div></div><div id="buyManageCountV12" class="buyManageCount">0件選択中</div></div><div class="buyManageBtns"><button class="btn ghost" onclick="selectAllBuy();updateBuyTopV12()">☑ 全選択</button><button class="btn ghost" onclick="clearBuySelection();updateBuyTopV12()">選択解除</button><button id="buyDeleteTopV12" class="btn buyDeleteTop" onclick="deleteSelectedBuy()">🗑 選択を削除</button><button id="buyDoneTopV12" class="btn buyDoneTop" onclick="bought()">✓ 選択を購入済み</button></div>`;
      list.before(panel);
    }
    document.querySelectorAll('#buyList .buyCheck').forEach(ch=>{ch.title='まとめて操作する商品を選択';ch.setAttribute('aria-label','商品を選択')});
    document.querySelectorAll('#buyList button[onclick^="bdel("]').forEach(b=>{b.textContent='🗑';b.title='この商品を削除';b.setAttribute('aria-label','この商品を削除')});
    updateBuyTop();
  }
  window.updateBuyTopV12=updateBuyTop;

  function fixHome(){
    const bulk=document.querySelector('#pg-home .homeQuick.bulk');
    if(bulk)bulk.onclick=()=>{go('add');setTimeout(()=>{if(typeof openBulkAddV9==='function')openBulkAddV9();else document.getElementById('bulkAddEntryV9')?.click()},30)};
  }
  window.goCatV11=cat=>{
    try{filter=cat}catch(e){}
    go('stock');
    setTimeout(()=>{try{filter=cat;renderStock()}catch(e){};ensureStock()},0);
  };

  function ensureAll(){ensureStock();ensureBuy();fixHome()}

  const rStock=window.renderStock;
  if(typeof rStock==='function'){window.renderStock=function(...a){const r=rStock.apply(this,a);ensureStock();return r}}
  const rBuy=window.renderBuy;
  if(typeof rBuy==='function'){window.renderBuy=function(...a){const r=rBuy.apply(this,a);ensureBuy();return r}}
  const uBuy=window.updateBuyBulkCount;
  if(typeof uBuy==='function'){window.updateBuyBulkCount=function(...a){const r=uBuy.apply(this,a);updateBuyTop();return r}}
  const rAll=window.render;
  if(typeof rAll==='function'){window.render=function(...a){const r=rAll.apply(this,a);ensureAll();return r}}
  const g=window.go;
  if(typeof g==='function'){window.go=function(...a){const r=g.apply(this,a);setTimeout(ensureAll,0);return r}}

  ensureAll();
})();
