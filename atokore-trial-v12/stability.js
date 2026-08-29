/* あとこれ v12.4 - 操作安定化 / 総点検修正 */
(()=>{
  const Core={
    addStockToBuy(list,item,qty=1){
      if(!item)return false;
      const unit=item.unit||'個', n=Math.max(1,Number(qty)||1);
      let b=list.find(v=>Number(v.stockId)===Number(item.id)||(v.name===item.name&&v.unit===unit));
      if(b)b.qty=(Number(b.qty)||0)+n;
      else list.push({id:Date.now()+Math.floor(Math.random()*100000),name:item.name,qty:n,unit,stockId:item.id});
      return true;
    },
    removeByIds(list,ids){const set=new Set([...ids].map(Number));return list.filter(x=>!set.has(Number(x.id)))},
    purchase(stock,list,ids,inferCat){
      const set=new Set([...ids].map(Number)),picked=list.filter(b=>set.has(Number(b.id)));
      for(const b of picked){
        let x=b.stockId!=null?stock.find(v=>Number(v.id)===Number(b.stockId)):null;
        if(!x)x=stock.find(v=>v.name===b.name&&v.unit===b.unit);
        if(x)x.qty=(Number(x.qty)||0)+(Number(b.qty)||1);
        else stock.push({id:Date.now()+Math.floor(Math.random()*100000),name:b.name,cat:inferCat(b.name),qty:Number(b.qty)||1,unit:b.unit||'個',place:'その他',expType:'期限なし',exp:'',usage:1});
      }
      return {count:picked.length,remaining:list.filter(b=>!set.has(Number(b.id)))};
    }
  };
  globalThis.__atokoreCoreV124=Core;
  if(typeof document==='undefined')return;

  const buySelected=new Set();
  const CAT={
    '食料品':['#E87520','#FFF3E8','#FFD8B5','🍚'],'日用品':['#2878C8','#EAF4FF','#C9E2FA','🧻'],'衛生・薬':['#D64A55','#FFF0F1','#F6CDD1','✚'],'ベビー':['#D65A92','#FFF0F7','#F7CDE0','👶'],'子ども':['#A76A00','#FFF8D9','#F4E29A','🧸'],'衣類':['#7755C7','#F3EFFF','#DDD2FA','👕'],'家電・生活用品':['#596579','#F0F2F5','#D8DDE5','🔋'],'防災':['#27835A','#EAF8F0','#C9EAD7','🛟'],'その他':['#596579','#F0F2F5','#D8DDE5','•']
  };
  const style=document.createElement('style');style.textContent=`
    .stableManage{border:1px solid #d7e0eb;background:#f8fbff;border-radius:15px;padding:9px;margin:7px 0 9px}.stableManageHead{display:flex;align-items:center;justify-content:space-between;gap:8px}.stableManageTitle{font-weight:950}.stableManageBtns{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:7px}.stableManageBtns .btn{min-width:0;padding:8px 5px;font-size:11px}.stableDanger{background:#fff0f0!important;color:#b42318!important}.stableDone{background:#eaf7ef!important;color:#23724d!important}.stableStockBuy{background:#edf6ff!important;color:#1268b3!important;border:1px solid #cde2f7!important}.stableCat{display:inline-flex;align-items:center;gap:3px;padding:2px 6px;border-radius:999px;font-size:9px;font-weight:900;margin-top:3px}.stableStockRow{border-left:4px solid var(--cc)!important}.stableSelected{box-shadow:0 0 0 2px #1677ff22 inset;border-color:#1677ff!important}.stableCheck{width:22px;height:22px;flex:0 0 auto}.stableEmptyManage{display:none}.stableToast{position:fixed;left:50%;bottom:92px;transform:translateX(-50%);background:#172033;color:#fff;padding:9px 13px;border-radius:999px;font-size:12px;font-weight:850;z-index:100;opacity:0;transition:opacity .16s;white-space:nowrap;pointer-events:none}.stableToast.on{opacity:1}body.atk-density-ultra .stableManage{padding:5px;border-radius:9px;margin:4px 0}.atk-density-ultra .stableManageBtns{gap:3px;margin-top:4px}.atk-density-ultra .stableManageBtns .btn{padding:5px 3px;font-size:9px}`;document.head.appendChild(style);

  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const cv=cat=>CAT[cat]||CAT['その他'];
  const vars=cat=>{const c=cv(cat);return `--cc:${c[0]};--cbg:${c[1]};--cbd:${c[2]}`};
  const unique=()=>Date.now()+Math.floor(Math.random()*1000000);
  function inferCategory(name){
    try{for(const [cat,arr] of Object.entries(C||{}))if(Array.isArray(arr)&&arr.includes(name))return cat}catch(e){}
    if(/オムツ|おむつ|おしりふき|ミルク|離乳食|ベビー/.test(name))return 'ベビー';
    if(/洗剤|柔軟剤|ティッシュ|トイレット|キッチンペーパー|ラップ|スポンジ|ゴミ袋|シャンプー|ソープ|掃除/.test(name))return '日用品';
    if(/薬|マスク|歯ブラシ|歯磨|ナプキン|消毒|絆創膏|湿布/.test(name))return '衛生・薬';
    if(/電池|電球|ケーブル|フィルター|カセットボンベ/.test(name))return '家電・生活用品';
    if(/非常|防災|簡易トイレ|アルファ米/.test(name))return '防災';
    return '食料品';
  }
  function logHistory(title,detail,type='other',icon='✎'){
    try{const k='atokoreHistoryV1',a=JSON.parse(localStorage.getItem(k)||'[]');a.unshift({id:unique(),ts:Date.now(),title,detail,type,icon});localStorage.setItem(k,JSON.stringify(a.slice(0,200)))}catch(e){}
  }
  function toast(msg){let t=document.getElementById('stableToastV124');if(!t){t=document.createElement('div');t.id='stableToastV124';t.className='stableToast';document.body.appendChild(t)}t.textContent=msg;t.classList.add('on');clearTimeout(toast._t);toast._t=setTimeout(()=>t.classList.remove('on'),1500)}
  function selectedStockIds(){
    const ids=[];try{stockSelected.forEach(id=>ids.push(Number(id)))}catch(e){}
    if(!ids.length)document.querySelectorAll('#stockList .stockPickV124:checked').forEach(x=>ids.push(Number(x.value)));
    return [...new Set(ids)].filter(Number.isFinite);
  }
  function cleanSelections(){
    const stockIds=new Set(items.map(x=>Number(x.id))),buyIds=new Set(buys.map(x=>Number(x.id)));
    try{for(const id of [...stockSelected])if(!stockIds.has(Number(id)))stockSelected.delete(id)}catch(e){}
    for(const id of [...buySelected])if(!buyIds.has(Number(id)))buySelected.delete(id);
  }
  function updateStockBulkUI(){
    const n=selectedStockIds().length;
    const m=document.getElementById('stockBulkMove');if(m)m.textContent=`🛒 選択した${n}件を買い物へ`;
    const d=document.getElementById('stockBulkDelete');if(d)d.textContent=`🗑 選択した${n}件を削除`;
  }
  function updateBuyUI(){
    const n=buySelected.size, c=document.getElementById('buyManageCountV124');if(c)c.textContent=`${n}件選択中`;
    const d=document.getElementById('buyDeleteV124');if(d)d.textContent=`🗑 選択${n?` ${n}件`:''}を削除`;
    const b=document.getElementById('buyDoneV124');if(b)b.textContent=`✓ 選択${n?` ${n}件`:''}を購入済み`;
  }

  window.visibleStock=function(){const q=(document.getElementById('stockSearch')?.value||'').trim();return items.filter(x=>(filter==='すべて'||x.cat===filter)&&(!q||String(x.name).includes(q)))};
  window.renderStock=function(){
    cleanSelections();
    const cats=['すべて',...new Set(items.map(x=>x.cat))], chips=document.getElementById('catChips');
    if(chips)chips.innerHTML=cats.map(c=>{const col=cv(c);return `<button class="chip ${c===filter?'on':''}" style="${c==='すべて'?'':`border-color:${col[2]};background:${c===filter?col[0]:col[1]};color:${c===filter?'#fff':col[0]}`}" onclick="setFilter('${esc(c)}')">${esc(c)}</button>`}).join('');
    const toggle=document.getElementById('stockSelectToggle');if(toggle)toggle.textContent=stockSelectMode?'選択を終了':'☑ 複数選択';
    const bulk=document.getElementById('stockBulkActions');if(bulk){bulk.classList.toggle('hide',!stockSelectMode);bulk.classList.add('stableManageBtns')}
    const arr=visibleStock(),list=document.getElementById('stockList');
    if(list)list.innerHTML=arr.length?arr.map(x=>{
      const picked=stockSelected.has(x.id),d=days(x.exp),near=x.exp&&d<=3,col=cv(x.cat);
      const check=stockSelectMode?`<input class="stableCheck stockPickV124" type="checkbox" value="${Number(x.id)}" ${picked?'checked':''} onchange="setStockPickV124(${Number(x.id)},this.checked)">`:'';
      const controls=stockSelectMode?`<div class="qty"><b>${esc(x.qty)}${esc(x.unit)}</b></div>`:`<div class="qty"><button class="icon" onclick="adj(${Number(x.id)},-1)">−</button><b>${esc(x.qty)}${esc(x.unit)}</b><button class="icon" onclick="adj(${Number(x.id)},1)">＋</button></div><button class="icon stableStockBuy" onclick="addStockOneToBuyV124(${Number(x.id)})" aria-label="買い物リストへ追加">🛒</button><button class="icon danger" onclick="delItem(${Number(x.id)})" aria-label="削除">🗑</button>`;
      return `<div class="row stableStockRow ${picked?'stableSelected':''} ${near?'expiryNear':''}" data-stock-id="${Number(x.id)}" style="${vars(x.cat)}"><div style="width:4px"></div>${check}<div class="grow"><div class="name">${esc(x.name)}</div><span class="stableCat" style="background:${col[1]};color:${col[0]};border:1px solid ${col[2]}">${col[3]} ${esc(x.cat)}</span><div class="meta">${esc(x.place||'未設定')}${x.exp?'・'+esc(x.expType)+' '+esc(x.exp):''}</div>${near?`<span class="expiryBadge ${d<0?'expiryExpired':''}">${d<0?'期限切れ':d===0?'今日まで':'あと'+d+'日'}</span>`:''}</div>${controls}</div>`
    }).join(''):'<div class="empty">該当なし</div>';
    updateStockBulkUI();
  };
  window.setStockPickV124=(id,on)=>{if(!stockSelectMode)return;if(on)stockSelected.add(Number(id));else stockSelected.delete(Number(id));const row=document.querySelector(`[data-stock-id="${Number(id)}"]`);if(row)row.classList.toggle('stableSelected',!!on);updateStockBulkUI()};
  window.toggleStockPick=id=>window.setStockPickV124(Number(id),!stockSelected.has(Number(id)));
  window.toggleStockSelect=()=>{stockSelectMode=!stockSelectMode;stockSelected.clear();renderStock()};
  window.selectAllVisible=()=>{visibleStock().forEach(x=>stockSelected.add(Number(x.id)));renderStock()};
  window.clearBulkSelection=()=>{stockSelected.clear();renderStock()};
  window.addStockOneToBuyV124=id=>{const x=items.find(v=>Number(v.id)===Number(id));if(!x)return;Core.addStockToBuy(buys,x,1);save();logHistory('買い物リストへ追加',`${x.name}を追加`,'buy','🛒');render();toast(`${x.name}を買い物へ追加`)};
  window.moveSelectedToBuy=()=>{const ids=selectedStockIds();if(!ids.length){alert('買い物へ追加する商品を選んでください');return}const set=new Set(ids),picked=items.filter(x=>set.has(Number(x.id)));picked.forEach(x=>Core.addStockToBuy(buys,x,1));stockSelected.clear();stockSelectMode=false;save();logHistory('買い物リストへ追加',`${picked.length}件をまとめて追加`,'buy','🛒');render();go('buy');toast(`${picked.length}件を買い物へ追加`)};
  window.deleteSelectedStock=()=>{const ids=selectedStockIds();if(!ids.length){alert('削除する商品を選んでください');return}if(!confirm(`選択した${ids.length}件を在庫から削除しますか？`))return;items=Core.removeByIds(items,ids);stockSelected.clear();stockSelectMode=false;save();logHistory('在庫を一括削除',`${ids.length}件を削除`,'stock','🗑');render();toast(`${ids.length}件を削除`)};
  window.adj=(id,d)=>{const x=items.find(v=>Number(v.id)===Number(id));if(!x)return;const before=Number(x.qty)||0;x.qty=Math.max(0,before+Number(d||0));if(Number(d)<0)x.usage=(x.usage||0)+1;save();logHistory('在庫数を変更',`${x.name} ${before}${x.unit} → ${x.qty}${x.unit}`,'stock','📦');render()};
  window.delItem=id=>{const x=items.find(v=>Number(v.id)===Number(id));if(!x)return;if(!confirm(`「${x.name}」を在庫から削除しますか？`))return;items=items.filter(v=>Number(v.id)!==Number(id));stockSelected.delete(Number(id));save();logHistory('在庫を削除',`${x.name}を削除`,'stock','🗑');render();toast('削除しました')};

  function ensureBuyManage(){
    const list=document.getElementById('buyList');if(!list)return null;let p=document.getElementById('buyManageV124');if(!p){p=document.createElement('div');p.id='buyManageV124';p.className='stableManage';p.innerHTML=`<div class="stableManageHead"><div><div class="stableManageTitle">買い物リストをまとめて操作</div><div class="meta">チェックした商品を削除・購入済みにできます</div></div><div id="buyManageCountV124" class="meta">0件選択中</div></div><div class="stableManageBtns"><button class="btn ghost" onclick="selectAllBuy()">☑ 全選択</button><button class="btn ghost" onclick="clearBuySelection()">選択解除</button><button id="buyDeleteV124" class="btn stableDanger" onclick="deleteSelectedBuy()">🗑 選択を削除</button><button id="buyDoneV124" class="btn stableDone" onclick="bought()">✓ 選択を購入済み</button></div>`;list.before(p)}return p;
  }
  window.renderBuy=function(){
    cleanSelections();const list=document.getElementById('buyList');if(!list)return;const p=ensureBuyManage();if(p)p.classList.toggle('stableEmptyManage',!buys.length);
    list.innerHTML=buys.length?buys.map(b=>`<div class="row" data-buy-id="${Number(b.id)}"><input class="buyCheck stableCheck" type="checkbox" value="${Number(b.id)}" ${buySelected.has(Number(b.id))?'checked':''} onchange="setBuyPickV124(${Number(b.id)},this.checked)"><div class="grow"><div class="name">${esc(b.name)}</div><div class="meta">${b.stockId!=null?'在庫から追加':''}</div></div><div class="qty"><button class="icon" onclick="badj(${Number(b.id)},-1)">−</button><b>${esc(b.qty)}${esc(b.unit)}</b><button class="icon" onclick="badj(${Number(b.id)},1)">＋</button></div><button class="icon danger" onclick="bdel(${Number(b.id)})" aria-label="削除">🗑</button></div>`).join(''):'<div class="empty">買うものはありません</div>';
    updateBuyUI();
  };
  window.setBuyPickV124=(id,on)=>{if(on)buySelected.add(Number(id));else buySelected.delete(Number(id));updateBuyUI()};
  window.selectedBuyIds=()=>[...buySelected];
  window.updateBuyBulkCount=updateBuyUI;
  window.selectAllBuy=()=>{buys.forEach(b=>buySelected.add(Number(b.id)));renderBuy()};
  window.clearBuySelection=()=>{buySelected.clear();renderBuy()};
  window.addBuy=()=>{const el=document.getElementById('buyName'),name=(el?.value||'').trim();if(!name)return;const unit=unitOf(name),b=buys.find(x=>x.name===name&&x.unit===unit);if(b)b.qty=(Number(b.qty)||0)+1;else buys.push({id:unique(),name,qty:1,unit});if(el)el.value='';save();logHistory('買い物を追加',`${name}を追加`,'buy','🛒');render();};
  window.badj=(id,d)=>{const b=buys.find(x=>Number(x.id)===Number(id));if(!b)return;const before=Number(b.qty)||1;b.qty=Math.max(1,before+Number(d||0));save();logHistory('買い物数量を変更',`${b.name} ${before}${b.unit} → ${b.qty}${b.unit}`,'buy','🛒');renderBuy()};
  window.bdel=id=>{const b=buys.find(x=>Number(x.id)===Number(id));if(!b)return;buys=buys.filter(x=>Number(x.id)!==Number(id));buySelected.delete(Number(id));save();logHistory('買い物を削除',`${b.name}を削除`,'buy','🗑');render();toast('削除しました')};
  window.deleteSelectedBuy=()=>{const ids=[...buySelected];if(!ids.length){alert('削除する商品を選んでください');return}if(!confirm(`選択した${ids.length}件を買い物リストから削除しますか？`))return;buys=Core.removeByIds(buys,ids);buySelected.clear();save();logHistory('買い物を一括削除',`${ids.length}件を削除`,'buy','🗑');render();toast(`${ids.length}件を削除`)};
  window.bought=()=>{const ids=[...buySelected];if(!ids.length){alert('購入済みにする商品を選んでください');return}const result=Core.purchase(items,buys,ids,inferCategory);buys=result.remaining;buySelected.clear();save();logHistory('購入済みにして在庫反映',`${result.count}件を在庫へ反映`,'buy','✓');render();toast(`${result.count}件を在庫へ反映`)};

  window.goCatV11=cat=>{filter=cat;go('stock');setTimeout(()=>{filter=cat;renderStock()},0)};
  function fixHome(){const b=document.querySelector('#pg-home .homeQuick.bulk');if(b)b.onclick=()=>{go('add');setTimeout(()=>{if(typeof openBulkAddV9==='function')openBulkAddV9()},0)}}
  const oldGo=window.go;if(typeof oldGo==='function'&&!oldGo.__stableV124){const g=function(...a){const r=oldGo.apply(this,a);setTimeout(fixHome,0);return r};g.__stableV124=true;window.go=g}
  const oldRender=window.render;if(typeof oldRender==='function'&&!oldRender.__stableV124){const r=function(...a){const out=oldRender.apply(this,a);fixHome();return out};r.__stableV124=true;window.render=r}

  fixHome();renderStock();renderBuy();
  const badge=document.querySelector('.badge');if(badge)badge.textContent='試用版 v12.4';
})();
