/* あとこれ v10 - 操作履歴 / アプリ更新履歴 */
(()=>{
  const KEY='atokoreHistoryV1';
  const MAX=200;
  let tab='activity';
  const css=`
  .historyTopBtn{position:absolute;top:10px;right:56px;width:38px;height:38px;border:0;border-radius:12px;background:#eef2f7;color:#25324a;font-size:18px;display:flex;align-items:center;justify-content:center;z-index:2}
  .historyHead{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:16px 0 7px}
  .historyHead .section{margin:0}
  .historyMini{border:1px solid #e5e7eb;border-radius:12px;padding:8px 9px;margin:5px 0;background:#fff;display:flex;gap:8px;align-items:flex-start}
  .historyMiniIcon{width:27px;height:27px;border-radius:8px;background:#f1f5f9;display:flex;align-items:center;justify-content:center;flex:0 0 auto}
  .historyTime{font-size:10px;color:#98a2b3;white-space:nowrap}
  .historyDetail{font-size:11px;color:#667085;margin-top:2px;line-height:1.35}
  .historyTabs{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin:10px 0}
  .historyTab{border:1px solid #dfe4ea;background:#fff;border-radius:11px;padding:9px;font-weight:850;color:#475467}
  .historyTab.on{background:#eef6ff;border-color:#1677ff;color:#0b63ce}
  .historyItem{border-bottom:1px solid #eef0f3;padding:10px 2px;display:grid;grid-template-columns:34px 1fr auto;gap:8px;align-items:start}
  .historyItem:last-child{border-bottom:0}
  .historyIcon{width:34px;height:34px;border-radius:10px;background:#f1f5f9;display:flex;align-items:center;justify-content:center}
  .historyVersion{font-size:11px;color:#6f42c1;font-weight:850;background:#f4efff;padding:3px 7px;border-radius:999px;white-space:nowrap}
  body.atk-density-ultra .historyMini{padding:4px 5px;margin:3px 0;border-radius:8px;gap:5px}
  body.atk-density-ultra .historyMiniIcon{width:22px;height:22px;border-radius:6px;font-size:12px}
  body.atk-density-ultra .historyDetail{font-size:9px}
  body.atk-density-ultra .historyTime{font-size:8px}
  `;
  const st=document.createElement('style');st.textContent=css;document.head.appendChild(st);

  const updates=[
    {v:'v12.5h',title:'個別の在庫反映とレシート選択を追加',detail:'買い物リストの各商品から1タップで在庫へ反映できるようにし、レシートはカメラ・写真・画像ファイルから選べるようにしました。'},
    {v:'v12.5g',title:'操作処理を最終統合',detail:'在庫・買い物の操作定義を1か所へ集約し、まとめて追加・在庫反映を含む成功通知を描画を止めない方式へ変更しました。'},
    {v:'v12.5',title:'在庫の複数選択→買い物をiPhone向けに再構築',detail:'ボタン押下時の実チェック状態を最優先し、反映後は他の画面更新処理に依存せず買い物画面へ直接反映するよう変更しました。'},
    {v:'v12.4',title:'操作系を総点検・安定化',detail:'在庫/買い物の選択・削除・一括削除・在庫→買い物・購入済み反映を1本の処理へ統合。買い物選択保持、カテゴリー復元、レシート店舗/日付編集も修正しました。'},
    {v:'v12.3',title:'在庫→買い物の一括移行を再修正',detail:'画面でチェックされている在庫を直接読み取り、反映確認後に買い物画面へ移動する方式に変更しました。'},
    {v:'v12.2',title:'在庫の一括買い物移行を修正',detail:'選択した在庫を直接買い物リストへ反映し、重複商品は数量をまとめるよう修正しました。'},
    {v:'v12.1',title:'在庫・買い物操作を見える化',detail:'在庫から買い物へ追加、個別削除、一括削除、購入済み反映を見つけやすい位置に整理。ホームのまとめて追加とカテゴリー導線も修正しました。'},
    {v:'v12',title:'登録単位をシンプル化',detail:'g / kg / ml / Lを通常登録から外し、個・本・袋・箱・パック・枚に絞りました。'},
    {v:'v10',title:'表示をさらに圧縮・更新履歴を追加',detail:'「極小」「超コンパクト」を追加。操作履歴とアプリ更新履歴を確認できるようにしました。'},
    {v:'v9',title:'まとめて追加',detail:'複数商品を1回の入力で確認・一括登録できるようにしました。'},
    {v:'v8',title:'表示設定',detail:'文字サイズと表示密度を端末ごとに変更できるようにしました。'},
    {v:'v7',title:'レシートOCR',detail:'レシート画像を読み取り、確認して在庫へ反映する機能を追加しました。'},
    {v:'v6',title:'一括削除',detail:'在庫・買い物リストを複数選択して削除できるようにしました。'}
  ];

  function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
  function load(){try{const a=JSON.parse(localStorage.getItem(KEY)||'[]');return Array.isArray(a)?a:[]}catch(e){return []}}
  function store(a){try{localStorage.setItem(KEY,JSON.stringify(a.slice(0,MAX)))}catch(e){}}
  function add(title,detail,type='other',icon='✎'){
    const a=load();
    a.unshift({id:Date.now()+Math.random(),ts:Date.now(),title,detail,type,icon});
    store(a);renderHome();
  }
  function fmt(ts){
    const d=Date.now()-ts,m=Math.floor(d/60000);
    if(m<1)return '今'; if(m<60)return `${m}分前`;
    const dt=new Date(ts),now=new Date();
    if(dt.toDateString()===now.toDateString())return `今日 ${String(dt.getHours()).padStart(2,'0')}:${String(dt.getMinutes()).padStart(2,'0')}`;
    return `${dt.getMonth()+1}/${dt.getDate()} ${String(dt.getHours()).padStart(2,'0')}:${String(dt.getMinutes()).padStart(2,'0')}`;
  }
  function snap(){
    try{return JSON.parse(JSON.stringify({items:typeof items!=='undefined'?items:[],buys:typeof buys!=='undefined'?buys:[],routines:typeof routines!=='undefined'?routines:[]}))}catch(e){return {items:[],buys:[],routines:[]}}
  }
  function arrDiff(before,after,label){
    const out=[],bm=new Map((before||[]).map(x=>[String(x.id),x])),am=new Map((after||[]).map(x=>[String(x.id),x]));
    for(const [id,a] of am){
      const b=bm.get(id);
      if(!b){out.push(`＋ ${a.name||label} ${a.qty??''}${a.unit||''}`.trim());continue}
      if(Number(b.qty)!==Number(a.qty))out.push(`${a.name||label} ${b.qty??''}${b.unit||''} → ${a.qty??''}${a.unit||''}`);
      else if(JSON.stringify(b)!==JSON.stringify(a))out.push(`${a.name||label} の情報を更新`);
    }
    for(const [id,b] of bm)if(!am.has(id))out.push(`− ${b.name||label} ${b.qty??''}${b.unit||''}`.trim());
    return out;
  }
  function routineDiff(before,after){
    const out=[],bm=new Map((before||[]).map(x=>[String(x.id),x])),am=new Map((after||[]).map(x=>[String(x.id),x]));
    for(const [id,a] of am){const b=bm.get(id);if(!b)out.push(`＋ ${a.name||'いつものリスト'}`);else if(JSON.stringify(b)!==JSON.stringify(a))out.push(`${a.name||'いつものリスト'} を更新`)}
    for(const [id,b] of bm)if(!am.has(id))out.push(`− ${b.name||'いつものリスト'}`);
    return out;
  }
  function changed(b,a){return JSON.stringify(b)!==JSON.stringify(a)}
  function logDiff(label,type,icon,before,after){
    if(!changed(before,after))return;
    const parts=[...arrDiff(before.items,after.items,'在庫'),...arrDiff(before.buys,after.buys,'買い物'),...routineDiff(before.routines,after.routines)];
    const detail=parts.length?parts.slice(0,3).join(' / ')+(parts.length>3?` ほか${parts.length-3}件`:''):'内容を更新しました';
    add(label,detail,type,icon);
  }
  function wrap(name,label,type,icon){
    const orig=window[name];
    if(typeof orig!=='function'||orig.__atokoreHistoryWrapped)return;
    const w=function(...args){
      const before=snap();
      let r;
      try{r=orig.apply(this,args)}catch(e){throw e}
      if(r&&typeof r.then==='function')return r.finally(()=>logDiff(label,type,icon,before,snap()));
      logDiff(label,type,icon,before,snap());return r;
    };
    w.__atokoreHistoryWrapped=true;window[name]=w;
  }
  function wrapAll(){
    [
      ['registerItem','在庫を追加','stock','＋'],['delItem','在庫を削除','stock','🗑'],['adj','在庫数を変更','stock','📦'],
      ['deleteSelectedStock','在庫を一括削除','stock','🗑'],['moveSelectedToBuy','買い物リストへ追加','buy','🛒'],
      ['addBuy','買い物を追加','buy','🛒'],['badj','買い物数量を変更','buy','🛒'],['bdel','買い物を削除','buy','🗑'],
      ['deleteSelectedBuy','買い物を一括削除','buy','🗑'],['bought','購入済みにして在庫反映','buy','✓'],['premiumBuy','買い物リストへ追加','buy','🛒'],
      ['createRoutine','いつものリストを作成','routine','↻'],['confirmSaveCurrentBuy','いつものリストを保存','routine','↻'],
      ['saveRoutineName','いつものリスト名を変更','routine','↻'],['routineAddItem','いつものリストに追加','routine','↻'],
      ['routineAdjust','いつものリスト数量を変更','routine','↻'],['routineRemoveItem','いつものリストから削除','routine','↻'],
      ['deleteRoutine','いつものリストを削除','routine','🗑'],['addWholeRoutine','いつものリストを買い物へ反映','buy','🛒'],
      ['addSelectedRoutine','いつものリストを買い物へ反映','buy','🛒'],['applyReceipt','レシートから在庫反映','receipt','🧾'],['receiptApplyV7','レシートから在庫反映','receipt','🧾'],
      ['applyParsedReceipt','レシートから在庫反映','receipt','🧾'],['applyParsedReceiptV7','レシートから在庫反映','receipt','🧾']
    ].forEach(x=>wrap(...x));
    wrap('commitBulkAddV9','まとめて在庫へ追加','stock','⚡');
  }

  function recentHtml(n=3){
    const a=load().slice(0,n);
    if(!a.length)return '<div class="empty">まだ更新履歴はありません。<br>v10以降の操作をここに記録します。</div>';
    return a.map(h=>`<div class="historyMini"><div class="historyMiniIcon">${esc(h.icon)}</div><div class="grow"><div class="name">${esc(h.title)}</div><div class="historyDetail">${esc(h.detail)}</div></div><div class="historyTime">${fmt(h.ts)}</div></div>`).join('');
  }
  function ensureUI(){
    const top=document.querySelector('.top');
    if(top&&!document.getElementById('historyTopBtn')){const b=document.createElement('button');b.id='historyTopBtn';b.className='historyTopBtn';b.title='更新履歴';b.setAttribute('aria-label','更新履歴');b.textContent='🕘';b.onclick=()=>window.openAtokoreHistory();top.appendChild(b)}
    const home=document.getElementById('pg-home');
    if(home&&!document.getElementById('historyHomeV10')){const d=document.createElement('div');d.id='historyHomeV10';d.innerHTML='<div class="historyHead"><div class="section">最近の更新</div><button class="btn ghost" style="padding:6px 9px" onclick="openAtokoreHistory()">すべて見る</button></div><div id="historyHomeListV10"></div>';home.appendChild(d)}
    const premium=document.getElementById('pg-premium');
    if(premium&&!document.getElementById('historyCardV10')){const d=document.createElement('div');d.id='historyCardV10';d.className='row';d.setAttribute('role','button');d.tabIndex=0;d.innerHTML='<div class="grow"><div class="name">🕘 更新履歴</div><div class="meta">在庫・買い物の操作履歴 / アプリ更新内容</div></div>›';d.onclick=()=>window.openAtokoreHistory();premium.insertBefore(d,premium.firstChild?.nextSibling||premium.firstChild)}
  }
  function renderHome(){const e=document.getElementById('historyHomeListV10');if(e)e.innerHTML=recentHtml(3);else if(document.getElementById('historyHomeV11')&&typeof window.renderHome==='function')window.renderHome()}
  function activityHtml(){
    const a=load();
    if(!a.length)return '<div class="empty">まだ操作履歴はありません。<br>v10以降の追加・数量変更・削除などを記録します。</div>';
    return a.map(h=>`<div class="historyItem"><div class="historyIcon">${esc(h.icon)}</div><div><div class="name">${esc(h.title)}</div><div class="historyDetail">${esc(h.detail)}</div></div><div class="historyTime">${fmt(h.ts)}</div></div>`).join('');
  }
  function updatesHtml(){return updates.map(u=>`<div class="historyItem"><div class="historyIcon">⬆</div><div><div class="name">${esc(u.title)}</div><div class="historyDetail">${esc(u.detail)}</div></div><div class="historyVersion">${u.v}</div></div>`).join('')}
  function modalHtml(){return `<button class="close" onclick="closeM()">閉じる</button><h2>🕘 更新履歴</h2><div class="historyTabs"><button class="historyTab ${tab==='activity'?'on':''}" onclick="setAtokoreHistoryTab('activity')">操作履歴</button><button class="historyTab ${tab==='app'?'on':''}" onclick="setAtokoreHistoryTab('app')">アプリ更新</button></div><div id="historyModalBody">${tab==='activity'?activityHtml():updatesHtml()}</div>${tab==='activity'?'<button class="btn danger" style="width:100%;margin-top:12px" onclick="clearAtokoreHistory()">操作履歴を消去</button>':''}`}
  window.openAtokoreHistory=()=>{ensureUI();openM(modalHtml())};
  window.setAtokoreHistoryTab=t=>{tab=t==='app'?'app':'activity';openM(modalHtml())};
  window.clearAtokoreHistory=()=>{if(!confirm('操作履歴をすべて消去しますか？'))return;store([]);renderHome();openM(modalHtml())};

  ensureUI();renderHome();wrapAll();
  const baseRender=window.render;
  if(typeof baseRender==='function'&&!baseRender.__atokoreHistoryRender){const r=function(...args){const out=baseRender.apply(this,args);ensureUI();renderHome();return out};r.__atokoreHistoryRender=true;window.render=r}
  const badge=document.querySelector('.badge');if(badge)badge.textContent='試用版 v10';
})();
