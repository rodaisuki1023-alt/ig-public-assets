/* あとこれ v12.6 - 買い物→在庫 反映修正 */
(()=>{
  if(typeof document==='undefined') return;
  const idFromCheckbox=(cb)=>{
    const direct=Number(cb?.value);
    if(Number.isFinite(direct)&&direct>0)return direct;
    const row=cb?.closest?.('.row');
    const html=row?.innerHTML||'';
    const m=html.match(/(?:setBuyPickV124|badj|bdel|bought)\((\d+)/);
    return m?Number(m[1]):NaN;
  };
  const checkedIds=()=>[...document.querySelectorAll('#buyList input[type="checkbox"]:checked')].map(idFromCheckbox).filter(Number.isFinite);
  const inferCat=(name='')=>{
    if(/オムツ|おむつ|おしりふき|ミルク|離乳食|ベビー/.test(name))return 'ベビー';
    if(/洗剤|柔軟剤|ティッシュ|トイレット|キッチンペーパー|ラップ|スポンジ|ゴミ袋|シャンプー|ソープ|掃除/.test(name))return '日用品';
    if(/薬|マスク|歯ブラシ|歯磨|ナプキン|消毒|絆創膏|湿布/.test(name))return '衛生・薬';
    if(/電池|電球|ケーブル|フィルター|カセットボンベ/.test(name))return '家電・生活用品';
    if(/非常|防災|簡易トイレ|アルファ米/.test(name))return '防災';
    if(/肌着|靴下|パジャマ|服|靴/.test(name))return '衣類';
    if(/文房具|園用品|工作|おもちゃ/.test(name))return '子ども';
    return '食料品';
  };
  const unique=()=>Date.now()+Math.floor(Math.random()*1000000);
  const log=(count)=>{try{const k='atokoreHistoryV1',a=JSON.parse(localStorage.getItem(k)||'[]');a.unshift({id:unique(),ts:Date.now(),title:'買い物から在庫へ反映',detail:`${count}件を在庫へ反映`,type:'buy',icon:'✓'});localStorage.setItem(k,JSON.stringify(a.slice(0,200)))}catch(e){}};
  const toast=(msg)=>{let t=document.getElementById('buyFixToast126');if(!t){t=document.createElement('div');t.id='buyFixToast126';t.style.cssText='position:fixed;left:50%;bottom:92px;transform:translateX(-50%);background:#172033;color:#fff;padding:9px 13px;border-radius:999px;font-size:12px;font-weight:850;z-index:9999';document.body.appendChild(t)}t.textContent=msg;clearTimeout(toast._t);toast._t=setTimeout(()=>t.remove(),1800)};
  window.reflectSelectedBuyToStockV126=()=>{
    const ids=checkedIds();
    if(!ids.length){alert('在庫へ反映する商品を選んでください');return false}
    const set=new Set(ids.map(Number));
    const picked=(Array.isArray(buys)?buys:[]).filter(b=>set.has(Number(b.id)));
    if(!picked.length){alert('選択した商品を取得できませんでした。もう一度選択してください');return false}
    for(const b of picked){
      let x=null;
      if(b.stockId!=null)x=(Array.isArray(items)?items:[]).find(v=>Number(v.id)===Number(b.stockId));
      if(!x)x=(Array.isArray(items)?items:[]).find(v=>v.name===b.name&&v.unit===b.unit);
      if(x)x.qty=(Number(x.qty)||0)+(Number(b.qty)||1);
      else items.push({id:unique(),name:b.name,cat:inferCat(b.name),qty:Number(b.qty)||1,unit:b.unit||'個',place:'その他',expType:'期限なし',exp:'',usage:1});
    }
    buys=buys.filter(b=>!set.has(Number(b.id)));
    try{save()}catch(e){try{localStorage.setItem('atokore_items',JSON.stringify(items));localStorage.setItem('atokore_buys',JSON.stringify(buys))}catch(_){} }
    log(picked.length);
    try{renderBuy()}catch(e){try{render()}catch(_){} }
    try{renderStock()}catch(e){}
    fixLabels();
    toast(`${picked.length}件を在庫へ反映しました`);
    return true;
  };
  function fixLabels(){
    const btn=document.getElementById('buyDoneV124');
    if(btn){
      const n=checkedIds().length;
      btn.textContent=`✓ 選択${n?` ${n}件`:''}を在庫へ反映`;
      btn.onclick=(e)=>{e?.preventDefault?.();e?.stopPropagation?.();window.reflectSelectedBuyToStockV126()};
    }
    document.querySelectorAll('#pg-buy .meta, #pg-buy .stableManageTitle').forEach(el=>{
      el.textContent=el.textContent.replace('削除・購入済みにできます','削除・在庫へ反映できます').replace('購入済み','在庫へ反映');
    });
  }
  document.addEventListener('change',e=>{if(e.target?.matches?.('#buyList input[type="checkbox"]'))setTimeout(fixLabels,0)},true);
  document.addEventListener('click',e=>{const b=e.target?.closest?.('#buyDoneV124');if(!b)return;e.preventDefault();e.stopImmediatePropagation();window.reflectSelectedBuyToStockV126()},true);
  const mo=new MutationObserver(()=>fixLabels());mo.observe(document.documentElement,{childList:true,subtree:true});
  setTimeout(fixLabels,0);
  const badge=document.querySelector('.badge');if(badge)badge.textContent='試用版 v12.6';
})();
