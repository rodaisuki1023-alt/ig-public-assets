/* あとこれ v12.5g - 操作処理の最終統合（このファイルだけが在庫・買い物操作を管理） */
(()=>{
  let idSequence=0;
  const Core={
    uniqueId(){return Date.now()*1000+(idSequence++%1000)},
    addStockToBuy(list,item,qty=1){
      if(!item||!Array.isArray(list))return false;
      const unit=item.unit||'個';
      const amount=Math.max(1,Number(qty)||1);
      let found=list.find(v=>Number(v.stockId)===Number(item.id)||(v.name===item.name&&v.unit===unit));
      if(found)found.qty=(Number(found.qty)||0)+amount;
      else list.push({id:Core.uniqueId(),name:item.name,qty:amount,unit,stockId:item.id,cat:item.cat||''});
      return true;
    },
    removeByIds(list,ids){
      const selected=new Set([...ids].map(Number).filter(Number.isFinite));
      return (Array.isArray(list)?list:[]).filter(x=>!selected.has(Number(x.id)));
    },
    purchase(stock,list,ids,inferCat=()=> '食料品'){
      const selected=new Set([...ids].map(Number).filter(Number.isFinite));
      const picked=(Array.isArray(list)?list:[]).filter(x=>selected.has(Number(x.id)));
      for(const bought of picked){
        let target=bought.stockId!=null?stock.find(x=>Number(x.id)===Number(bought.stockId)):null;
        if(!target)target=stock.find(x=>x.name===bought.name&&x.unit===bought.unit);
        if(target)target.qty=(Number(target.qty)||0)+(Number(bought.qty)||1);
        else stock.push({id:Core.uniqueId(),name:bought.name,cat:bought.cat||inferCat(bought.name),qty:Number(bought.qty)||1,unit:bought.unit||'個',place:'その他',expType:'期限なし',exp:'',usage:1});
      }
      return {count:picked.length,remaining:(Array.isArray(list)?list:[]).filter(x=>!selected.has(Number(x.id)))};
    }
  };
  globalThis.__atokoreCoreV125G=Core;
  if(typeof document==='undefined')return;

  const ACTION_OWNER='stability-v125g';
  const buySelected=new Set();
  const CAT={
    '食料品':['#E87520','#FFF3E8','#FFD8B5','🍚'],'日用品':['#2878C8','#EAF4FF','#C9E2FA','🧻'],'衛生・薬':['#D64A55','#FFF0F1','#F6CDD1','✚'],'ベビー':['#D65A92','#FFF0F7','#F7CDE0','👶'],'子ども':['#A76A00','#FFF8D9','#F4E29A','🧸'],'衣類':['#7755C7','#F3EFFF','#DDD2FA','👕'],'家電・生活用品':['#596579','#F0F2F5','#D8DDE5','🔋'],'防災':['#27835A','#EAF8F0','#C9EAD7','🛟'],'その他':['#596579','#F0F2F5','#D8DDE5','•']
  };

  const style=document.createElement('style');
  style.id='atokore-actions-v125g';
  style.textContent=`
    .stableManage{border:1px solid #d7e0eb;background:#f8fbff;border-radius:15px;padding:9px;margin:7px 0 9px}.stableManageHead{display:flex;align-items:center;justify-content:space-between;gap:8px}.stableManageTitle{font-weight:950}.stableManageBtns{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:7px}.stableManageBtns .btn{min-width:0;padding:8px 5px;font-size:11px}.stableDanger{background:#fff0f0!important;color:#b42318!important}.stableDone{background:#eaf7ef!important;color:#23724d!important}.stableStockBuy{background:#edf6ff!important;color:#1268b3!important;border:1px solid #cde2f7!important}.stableCat{display:inline-flex;align-items:center;gap:3px;padding:2px 6px;border-radius:999px;font-size:9px;font-weight:900;margin-top:3px}.stableStockRow{border-left:4px solid var(--cc)!important}.stableSelected{box-shadow:0 0 0 2px #1677ff22 inset;border-color:#1677ff!important}.stableCheck{width:22px;height:22px;flex:0 0 auto}.stableEmptyManage{display:none}.stableToast{position:fixed;left:50%;bottom:92px;transform:translateX(-50%);background:#172033;color:#fff;padding:9px 13px;border-radius:999px;font-size:12px;font-weight:850;z-index:100;opacity:0;transition:opacity .16s;white-space:nowrap;pointer-events:none}.stableToast.on{opacity:1}body.atk-density-ultra .stableManage{padding:5px;border-radius:9px;margin:4px 0}.atk-density-ultra .stableManageBtns{gap:3px;margin-top:4px}.atk-density-ultra .stableManageBtns .btn{padding:5px 3px;font-size:9px}`;
  document.head.appendChild(style);

  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const color=cat=>CAT[cat]||CAT['その他'];
  const vars=cat=>{const c=color(cat);return `--cc:${c[0]};--cbg:${c[1]};--cbd:${c[2]}`};
  const numberId=value=>Number(value);
  const validId=value=>Number.isFinite(numberId(value));

  function inferCategory(name){
    try{for(const [cat,values] of Object.entries(C||{}))if(Array.isArray(values)&&values.includes(name))return cat}catch(e){}
    if(/オムツ|おむつ|おしりふき|ミルク|離乳食|ベビー/.test(name))return 'ベビー';
    if(/洗剤|柔軟剤|ティッシュ|トイレット|キッチンペーパー|ラップ|スポンジ|ゴミ袋|シャンプー|ソープ|掃除/.test(name))return '日用品';
    if(/薬|マスク|歯ブラシ|歯磨|ナプキン|消毒|絆創膏|湿布/.test(name))return '衛生・薬';
    if(/電池|電球|ケーブル|フィルター|カセットボンベ/.test(name))return '家電・生活用品';
    if(/非常|防災|簡易トイレ|アルファ米/.test(name))return '防災';
    return '食料品';
  }

  function saveState(){try{save()}catch(e){console.error('あとこれ: 保存に失敗しました',e)}}
  function logHistory(title,detail,type='other',icon='✎'){
    try{const key='atokoreHistoryV1',history=JSON.parse(localStorage.getItem(key)||'[]');history.unshift({id:Core.uniqueId(),ts:Date.now(),title,detail,type,icon});localStorage.setItem(key,JSON.stringify(history.slice(0,200)))}catch(e){}
  }
  function toast(message){
    let node=document.getElementById('stableToastV125g');
    if(!node){node=document.createElement('div');node.id='stableToastV125g';node.className='stableToast';document.body.appendChild(node)}
    node.textContent=message;node.classList.add('on');clearTimeout(toast.timer);toast.timer=setTimeout(()=>node.classList.remove('on'),1600);
  }
  function stateSignature(){
    try{return JSON.stringify({items,buys,routines})}catch(e){return ''}
  }
  function showPage(page){
    document.querySelectorAll('.page').forEach(node=>node.classList.remove('on'));
    document.getElementById('pg-'+page)?.classList.add('on');
    document.querySelectorAll('.tab').forEach(node=>node.classList.toggle('on',node.dataset.p===page));
  }
  function cleanSelections(){
    const stockIds=new Set(items.map(x=>numberId(x.id))),buyIds=new Set(buys.map(x=>numberId(x.id)));
    for(const id of [...stockSelected])if(!stockIds.has(numberId(id)))stockSelected.delete(id);
    for(const id of [...buySelected])if(!buyIds.has(numberId(id)))buySelected.delete(id);
  }
  function renderAllViews(){
    cleanSelections();
    try{window.renderStock()}catch(e){console.error('あとこれ: 在庫表示',e)}
    try{window.renderBuy()}catch(e){console.error('あとこれ: 買い物表示',e)}
    try{if(typeof window.renderRoutines==='function')window.renderRoutines()}catch(e){console.error('あとこれ: いつものリスト表示',e)}
    try{if(typeof window.renderHome==='function')window.renderHome()}catch(e){console.error('あとこれ: ホーム表示',e)}
  }
  function finish({page,message}={}){renderAllViews();if(page)showPage(page);if(message)toast(message)}

  function syncStockSelectionFromDom(){
    const boxes=[...document.querySelectorAll('#stockList input.stockPickV125g[type="checkbox"]')];
    for(const box of boxes){const id=numberId(box.value);if(!validId(id))continue;stockSelected.delete(id);if(box.checked)stockSelected.add(id)}
    cleanSelections();return [...stockSelected].map(numberId).filter(Number.isFinite);
  }
  function syncBuySelectionFromDom(){
    const boxes=[...document.querySelectorAll('#buyList input.buyCheck[type="checkbox"]')];
    if(boxes.length){buySelected.clear();for(const box of boxes)if(box.checked&&validId(box.value))buySelected.add(numberId(box.value))}
    cleanSelections();return [...buySelected];
  }
  function updateStockBulkUI(){
    const count=stockSelected.size;
    const move=document.getElementById('stockBulkMove');if(move)move.textContent=`🛒 選択した${count}件を買い物へ`;
    const del=document.getElementById('stockBulkDelete');if(del)del.textContent=`🗑 選択した${count}件を削除`;
  }
  function updateBuyUI(){
    const count=buySelected.size;
    const label=document.getElementById('buyManageCountV125g');if(label)label.textContent=`${count}件選択中`;
    const del=document.getElementById('buyDeleteV125g');if(del)del.textContent=`🗑 選択${count?` ${count}件`:''}を削除`;
    const done=document.getElementById('buyDoneV125g');if(done)done.textContent=`📦 選択${count?` ${count}件`:''}を在庫へ反映`;
  }

  window.visibleStock=function(){
    const query=(document.getElementById('stockSearch')?.value||'').trim();
    return items.filter(x=>(filter==='すべて'||x.cat===filter)&&(!query||String(x.name).includes(query)));
  };
  window.setFilter=category=>{filter=category;window.renderStock()};
  window.renderStock=function(){
    cleanSelections();
    const cats=['すべて',...new Set(items.map(x=>x.cat||'その他'))],chips=document.getElementById('catChips');
    if(chips)chips.innerHTML=cats.map(cat=>{const c=color(cat);return `<button class="chip ${cat===filter?'on':''}" style="${cat==='すべて'?'':`border-color:${c[2]};background:${cat===filter?c[0]:c[1]};color:${cat===filter?'#fff':c[0]}`}" onclick="setFilter('${esc(cat)}')">${esc(cat)}</button>`}).join('');
    const toggle=document.getElementById('stockSelectToggle');if(toggle)toggle.textContent=stockSelectMode?'選択を終了':'☑ 複数選択';
    const bulk=document.getElementById('stockBulkActions');if(bulk){bulk.classList.toggle('hide',!stockSelectMode);bulk.classList.add('stableManageBtns')}
    const list=document.getElementById('stockList'),visible=window.visibleStock();
    if(list)list.innerHTML=visible.length?visible.map(item=>{
      const id=numberId(item.id),picked=stockSelected.has(id),left=days(item.exp),near=item.exp&&left<=3,c=color(item.cat);
      const check=stockSelectMode?`<input class="stableCheck stockPickV125g" type="checkbox" value="${id}" ${picked?'checked':''} onclick="event.stopPropagation()" onchange="setStockPickV125G(${id},this.checked)">`:'';
      const controls=stockSelectMode?`<div class="qty"><b>${esc(item.qty)}${esc(item.unit)}</b></div>`:`<div class="qty"><button class="icon" onclick="adj(${id},-1)">−</button><b>${esc(item.qty)}${esc(item.unit)}</b><button class="icon" onclick="adj(${id},1)">＋</button></div><button class="icon stableStockBuy" onclick="addStockOneToBuyV125G(${id})" aria-label="買い物リストへ追加">🛒</button><button class="icon danger" onclick="delItem(${id})" aria-label="削除">🗑</button>`;
      return `<div class="row stableStockRow ${picked?'stableSelected':''} ${near?'expiryNear':''}" data-stock-id="${id}" style="${vars(item.cat)}" onclick="toggleStockRowV125G(event,${id})"><div style="width:4px"></div>${check}<div class="grow"><div class="name">${esc(item.name)}</div><span class="stableCat" style="background:${c[1]};color:${c[0]};border:1px solid ${c[2]}">${c[3]} ${esc(item.cat||'その他')}</span><div class="meta">${esc(item.place||'未設定')}${item.exp?'・'+esc(item.expType)+' '+esc(item.exp):''}</div>${near?`<span class="expiryBadge ${left<0?'expiryExpired':''}">${left<0?'期限切れ':left===0?'今日まで':'あと'+left+'日'}</span>`:''}</div>${controls}</div>`;
    }).join(''):'<div class="empty">該当なし</div>';
    updateStockBulkUI();
  };
  window.setStockPickV125G=(id,on)=>{
    id=numberId(id);if(!validId(id)||!stockSelectMode)return;
    if(on)stockSelected.add(id);else stockSelected.delete(id);
    const checkbox=document.querySelector(`#stockList input.stockPickV125g[value="${id}"]`);if(checkbox)checkbox.checked=!!on;
    checkbox?.closest('.row')?.classList.toggle('stableSelected',!!on);updateStockBulkUI();
  };
  window.toggleStockRowV125G=(event,id)=>{if(!stockSelectMode||event?.target?.closest('button,input,select,textarea,a'))return;window.setStockPickV125G(id,!stockSelected.has(numberId(id)))};
  window.toggleStockPick=id=>window.setStockPickV125G(id,!stockSelected.has(numberId(id)));
  window.toggleStockSelect=()=>{stockSelectMode=!stockSelectMode;stockSelected.clear();window.renderStock()};
  window.selectAllVisible=()=>{window.visibleStock().forEach(x=>stockSelected.add(numberId(x.id)));window.renderStock()};
  window.clearBulkSelection=()=>{stockSelected.clear();window.renderStock()};
  window.addStockOneToBuyV125G=id=>{
    const item=items.find(x=>numberId(x.id)===numberId(id));if(!item)return;
    Core.addStockToBuy(buys,item,1);saveState();logHistory('買い物リストへ追加',`${item.name}を追加`,'buy','🛒');finish({message:`${item.name}を買い物へ追加しました`});
  };
  window.moveSelectedToBuy=()=>{
    const ids=syncStockSelectionFromDom();if(!ids.length){alert('買い物へ追加する商品を選んでください');return}
    const selected=new Set(ids),picked=items.filter(x=>selected.has(numberId(x.id)));if(!picked.length){alert('選択した商品を取得できませんでした');return}
    picked.forEach(item=>Core.addStockToBuy(buys,item,1));stockSelected.clear();stockSelectMode=false;saveState();logHistory('買い物リストへ追加',`${picked.length}件をまとめて追加`,'buy','🛒');finish({page:'buy',message:`${picked.length}件を買い物リストへ追加しました`});
  };
  window.deleteSelectedStock=()=>{
    const ids=syncStockSelectionFromDom();if(!ids.length){alert('削除する商品を選んでください');return}
    if(!confirm(`選択した${ids.length}件を在庫から削除しますか？`))return;
    items=Core.removeByIds(items,ids);stockSelected.clear();stockSelectMode=false;saveState();logHistory('在庫を一括削除',`${ids.length}件を削除`,'stock','🗑');finish({page:'stock',message:`${ids.length}件を削除しました`});
  };
  window.adj=(id,delta)=>{
    const item=items.find(x=>numberId(x.id)===numberId(id));if(!item)return;
    const before=Number(item.qty)||0;item.qty=Math.max(0,before+Number(delta||0));if(Number(delta)<0)item.usage=(item.usage||0)+1;
    saveState();logHistory('在庫数を変更',`${item.name} ${before}${item.unit} → ${item.qty}${item.unit}`,'stock','📦');finish();
  };
  window.delItem=id=>{
    const item=items.find(x=>numberId(x.id)===numberId(id));if(!item)return;
    if(!confirm(`「${item.name}」を在庫から削除しますか？`))return;
    items=items.filter(x=>numberId(x.id)!==numberId(id));stockSelected.delete(numberId(id));saveState();logHistory('在庫を削除',`${item.name}を削除`,'stock','🗑');finish({message:'削除しました'});
  };

  function ensureBuyManage(){
    const list=document.getElementById('buyList');if(!list)return null;
    let panel=document.getElementById('buyManageV125g');
    if(!panel){
      panel=document.createElement('div');panel.id='buyManageV125g';panel.className='stableManage';
      panel.innerHTML=`<div class="stableManageHead"><div><div class="stableManageTitle">買い物リストをまとめて操作</div><div class="meta">チェックした商品を削除・在庫へ反映できます</div></div><div id="buyManageCountV125g" class="meta">0件選択中</div></div><div class="stableManageBtns"><button class="btn ghost" onclick="selectAllBuy()">☑ 全選択</button><button class="btn ghost" onclick="clearBuySelection()">選択解除</button><button id="buyDeleteV125g" class="btn stableDanger" onclick="deleteSelectedBuy()">🗑 選択を削除</button><button id="buyDoneV125g" class="btn stableDone" onclick="bought()">📦 選択を在庫へ反映</button></div>`;
      list.before(panel);
    }
    return panel;
  }
  window.renderBuy=function(){
    cleanSelections();const list=document.getElementById('buyList');if(!list)return;
    const panel=ensureBuyManage();if(panel)panel.classList.toggle('stableEmptyManage',!buys.length);
    list.innerHTML=buys.length?buys.map(item=>{const id=numberId(item.id);return `<div class="row" data-buy-id="${id}"><input class="buyCheck stableCheck" type="checkbox" value="${id}" ${buySelected.has(id)?'checked':''} onchange="setBuyPickV125G(${id},this.checked)"><div class="grow"><div class="name">${esc(item.name)}</div><div class="meta">${item.stockId!=null?'在庫から追加':''}</div></div><div class="qty"><button class="icon" onclick="badj(${id},-1)">−</button><b>${esc(item.qty)}${esc(item.unit)}</b><button class="icon" onclick="badj(${id},1)">＋</button></div><button class="icon danger" onclick="bdel(${id})" aria-label="削除">🗑</button></div>`}).join(''):'<div class="empty">買うものはありません</div>';
    updateBuyUI();
  };
  window.setBuyPickV125G=(id,on)=>{id=numberId(id);if(!validId(id))return;if(on)buySelected.add(id);else buySelected.delete(id);updateBuyUI()};
  window.selectedBuyIds=syncBuySelectionFromDom;
  window.updateBuyBulkCount=updateBuyUI;
  window.selectAllBuy=()=>{buys.forEach(item=>buySelected.add(numberId(item.id)));window.renderBuy()};
  window.clearBuySelection=()=>{buySelected.clear();window.renderBuy()};
  window.addBuy=()=>{
    const input=document.getElementById('buyName'),name=(input?.value||'').trim();if(!name)return;
    const unit=unitOf(name),found=buys.find(x=>x.name===name&&x.unit===unit);
    if(found)found.qty=(Number(found.qty)||0)+1;else buys.push({id:Core.uniqueId(),name,qty:1,unit});
    if(input)input.value='';saveState();logHistory('買い物を追加',`${name}を追加`,'buy','🛒');finish({page:'buy'});
  };
  window.badj=(id,delta)=>{
    const item=buys.find(x=>numberId(x.id)===numberId(id));if(!item)return;
    const before=Number(item.qty)||1,step=(item.unit==='g'||item.unit==='ml')?100:1;item.qty=Math.max(step,before+Number(delta||0)*step);
    saveState();logHistory('買い物数量を変更',`${item.name} ${before}${item.unit} → ${item.qty}${item.unit}`,'buy','🛒');finish({page:'buy'});
  };
  window.bdel=id=>{
    const item=buys.find(x=>numberId(x.id)===numberId(id));if(!item)return;
    buys=buys.filter(x=>numberId(x.id)!==numberId(id));buySelected.delete(numberId(id));saveState();logHistory('買い物を削除',`${item.name}を削除`,'buy','🗑');finish({page:'buy',message:'削除しました'});
  };
  window.deleteSelectedBuy=()=>{
    const ids=syncBuySelectionFromDom();if(!ids.length){alert('削除する商品を選んでください');return}
    if(!confirm(`選択した${ids.length}件を買い物リストから削除しますか？`))return;
    buys=Core.removeByIds(buys,ids);buySelected.clear();saveState();logHistory('買い物を一括削除',`${ids.length}件を削除`,'buy','🗑');finish({page:'buy',message:`${ids.length}件を削除しました`});
  };
  window.bought=()=>{
    const ids=syncBuySelectionFromDom();if(!ids.length){alert('在庫へ反映する商品を選んでください');return}
    const result=Core.purchase(items,buys,ids,inferCategory);if(!result.count){alert('在庫へ反映できませんでした');return}
    buys=result.remaining;buySelected.clear();saveState();logHistory('買い物から在庫へ反映',`${result.count}件を在庫へ反映`,'stock','📦');finish({page:'stock',message:`${result.count}件を在庫へ反映しました`});
  };
  window.premiumBuy=id=>{
    const item=items.find(x=>numberId(x.id)===numberId(id));if(!item)return;
    Core.addStockToBuy(buys,item,1);saveState();logHistory('買い物リストへ追加',`${item.name}を追加`,'buy','🛒');finish({message:`${item.name}を買い物へ追加しました`});
  };

  window.goCatV11=category=>{filter=category;showPage('stock');window.renderStock()};
  window.render=renderAllViews;
  window.go=page=>{showPage(page);renderAllViews();if(page==='add'&&typeof window.renderCatalog==='function')window.renderCatalog()};
  window.refreshAtokoreUiV125G=page=>{renderAllViews();if(page)showPage(page)};
  window.notifyAtokoreV125G=toast;
  window.__atokoreActionOwner=ACTION_OWNER;

  /*
   * Legacy features are kept as focused modules, but their success alerts used to
   * block Safari before the freshly rendered DOM could be painted.  Run those
   * mutations through one final adapter: validation alerts remain blocking, while
   * a successful state change is rendered synchronously and reported as a toast.
   */
  function adaptLegacyMutation(name){
    const original=window[name];
    if(typeof original!=='function'||original.__atokoreV125GAdapted)return;
    const adapted=function(...args){
      const before=stateSignature(),notices=[],nativeAlert=window.alert;
      let result;
      window.alert=message=>notices.push(String(message));
      try{result=original.apply(this,args)}finally{window.alert=nativeAlert}
      const changed=stateSignature()!==before;
      if(changed){
        renderAllViews();
        if(notices.length)toast(notices[notices.length-1]);
      }else{
        notices.forEach(message=>nativeAlert.call(window,message));
      }
      return result;
    };
    adapted.__atokoreV125GAdapted=true;
    window[name]=adapted;
  }
  [
    'registerItem','commitBulkAddV9','receiptApplyV7','applyReceipt',
    'createRoutine','confirmSaveCurrentBuy','saveRoutineName','routineAddItem',
    'routineAdjust','routineRemoveItem','deleteRoutine','addWholeRoutine','addSelectedRoutine'
  ].forEach(adaptLegacyMutation);

  const buyInput=document.getElementById('buyName');
  if(buyInput&&!buyInput.__atokoreEnter){buyInput.__atokoreEnter=true;buyInput.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();window.addBuy()}})}
  renderAllViews();
  const badge=document.querySelector('.badge');if(badge)badge.textContent='試用版 v12.5g';
})();
