/* あとこれ v9 - 一括追加 */
(()=>{
  const cats=['食料品','日用品','衛生・薬','ベビー','子ども','衣類','家電・生活用品','防災','その他'];
  const units=['個','本','袋','箱','パック','枚'];
  let draft=[];

  const css=`
  .bulkAddEntry{width:100%;margin:0 0 12px;background:#eef6ff;color:#0b63ce;border:1px solid #cfe2ff}
  .bulkAddHint{font-size:12px;color:#667085;line-height:1.55;margin:6px 0 10px}
  .bulkAddText{width:100%;min-height:150px;padding:12px;border:1px solid #d9dee7;border-radius:12px;font-size:16px;line-height:1.55;resize:vertical;background:#fff}
  .bulkAddReview{border:1px solid #dfe4ea;border-radius:14px;padding:10px;margin:9px 0;background:#fff}
  .bulkAddTop{display:grid;grid-template-columns:auto 1fr;gap:8px;align-items:center}
  .bulkAddCheck{width:22px;height:22px}
  .bulkAddGrid{display:grid;grid-template-columns:1fr 88px 102px;gap:7px;margin-top:8px}
  .bulkAddGrid2{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-top:7px}
  .bulkAddGrid input,.bulkAddGrid select,.bulkAddGrid2 input,.bulkAddGrid2 select{width:100%;padding:9px;border:1px solid #d9dee7;border-radius:10px;background:#fff;font-size:16px}
  .bulkAddFoot{position:sticky;bottom:-26px;background:#fff;padding:10px 0 4px;border-top:1px solid #eef0f3;margin-top:10px}
  .bulkAddCount{font-size:12px;color:#667085;margin:8px 0}
  `;
  const st=document.createElement('style');st.textContent=css;document.head.appendChild(st);

  function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
  function norm(s){return String(s||'').normalize('NFKC').trim()}
  function inferUnit(name){
    try{return typeof unitOf==='function'?unitOf(name):'個'}catch(e){return '個'}
  }
  function defaultQty(unit){return 1}
  function inferCat(name){
    try{
      for(const [cat,arr] of Object.entries(C||{})) if(Array.isArray(arr)&&arr.includes(name)) return cat;
    }catch(e){}
    if(/オムツ|おむつ|おしりふき|ミルク|離乳食|ベビー/.test(name))return 'ベビー';
    if(/洗剤|柔軟剤|ティッシュ|トイレット|キッチンペーパー|ラップ|スポンジ|ゴミ袋|シャンプー|ソープ|掃除/.test(name))return '日用品';
    if(/薬|マスク|歯ブラシ|歯磨|ナプキン|消毒|絆創膏|湿布/.test(name))return '衛生・薬';
    if(/電池|電球|ケーブル|フィルター|カセットボンベ/.test(name))return '家電・生活用品';
    if(/非常|防災|簡易トイレ|アルファ米/.test(name))return '防災';
    return '食料品';
  }
  function parseLine(line,index){
    let s=norm(line).replace(/^[-・•●□✓✔︎\s]+/,'').trim();
    if(!s)return null;
    s=s.replace(/[×ｘX]/g,'x');
    let qty=null,unit=null,name=s;
    let m=s.match(/^(.*?)(?:\s+|x)(\d+(?:\.\d+)?)\s*(個|本|袋|箱|パック|枚)\s*$/i);
    if(!m) m=s.match(/^(.*?)(\d+(?:\.\d+)?)\s*(個|本|袋|箱|パック|枚)\s*$/i);
    if(m){name=norm(m[1]);qty=Number(m[2]);unit=m[3];}
    else {
      m=s.match(/^(.*?)(?:\s+|x)(\d+(?:\.\d+)?)\s*$/i);
      if(m){name=norm(m[1]);qty=Number(m[2]);}
    }
    if(!name)name='商品';
    unit=unit||inferUnit(name);
    
    if(!units.includes(unit))unit=inferUnit(name);
    if(!Number.isFinite(qty)||qty<=0)qty=defaultQty(unit);
    return {id:Date.now()+index+Math.floor(Math.random()*1000),checked:true,name,qty,unit,cat:inferCat(name),exp:'',expType:'期限なし'};
  }

  function openBulk(){
    draft=[];
    openM(`<button class="close" onclick="closeM()">閉じる</button>
      <h2>⚡ まとめて追加</h2>
      <div class="bulkAddHint">1行に1商品でまとめて入力できます。商品名だけでも登録できます。必要なときだけ数量を足してください。</div>
      <textarea id="bulkAddText" class="bulkAddText" placeholder="牛乳 2本\n卵 10個\nオムツ 2袋\n豚バラ肉 1パック"></textarea>
      <div class="bulkAddHint">「牛乳×2」「牛乳 2」のような書き方にも対応します。</div>
      <button class="btn" style="width:100%" onclick="parseBulkAddV9()">入力内容を確認</button>`);
    setTimeout(()=>document.getElementById('bulkAddText')?.focus(),120);
  }
  window.openBulkAddV9=openBulk;

  window.parseBulkAddV9=()=>{
    const text=(document.getElementById('bulkAddText')?.value||'').trim();
    if(!text){alert('追加する商品を入力してください');return}
    draft=text.split(/\r?\n/).map((x,i)=>parseLine(x,i)).filter(Boolean);
    if(!draft.length){alert('商品を読み取れませんでした');return}
    renderReview();
  };

  function options(list,val){return list.map(x=>`<option ${x===val?'selected':''}>${esc(x)}</option>`).join('')}
  function renderReview(){
    openM(`<button class="close" onclick="closeM()">閉じる</button>
      <h2>一括追加の確認</h2>
      <div class="bulkAddHint">商品名・数量・単位・カテゴリーを必要なら修正してから登録してください。</div>
      <div class="bulkAddCount"><b id="bulkAddSelectedCount">0</b>件を登録予定</div>
      <div id="bulkAddRows">${draft.map((d,i)=>rowHtml(d,i)).join('')}</div>
      <div class="bulkAddGrid2">
        <button class="btn ghost" onclick="bulkAddSelectAllV9(true)">全選択</button>
        <button class="btn ghost" onclick="bulkAddSelectAllV9(false)">全解除</button>
      </div>
      <label class="row" style="margin-top:10px"><input id="bulkAddMerge" type="checkbox" checked><div class="grow"><div class="name">同じ商品は在庫に合算</div><div class="meta">同じ商品名・単位で期限なしの場合</div></div></label>
      <div class="bulkAddFoot"><button class="btn" style="width:100%" onclick="commitBulkAddV9()">選択した商品を在庫へ追加</button></div>`);
    updateCount();
  }
  function rowHtml(d,i){return `<div class="bulkAddReview" data-i="${i}">
    <div class="bulkAddTop"><input class="bulkAddCheck" type="checkbox" ${d.checked?'checked':''} onchange="bulkAddFieldV9(${i},'checked',this.checked)"><input value="${esc(d.name)}" oninput="bulkAddFieldV9(${i},'name',this.value)" style="width:100%;padding:9px;border:1px solid #d9dee7;border-radius:10px;font-size:16px;font-weight:800"></div>
    <div class="bulkAddGrid"><select onchange="bulkAddFieldV9(${i},'cat',this.value)">${options(cats,d.cat)}</select><input type="number" min="0" step="any" value="${d.qty}" oninput="bulkAddFieldV9(${i},'qty',this.value)"><select onchange="bulkAddFieldV9(${i},'unit',this.value)">${options(units,d.unit)}</select></div>
    <div class="bulkAddGrid2"><select onchange="bulkAddFieldV9(${i},'expType',this.value)">${options(['期限なし','賞味期限','消費期限','使用期限'],d.expType)}</select><input type="date" value="${esc(d.exp)}" onchange="bulkAddFieldV9(${i},'exp',this.value)"></div>
  </div>`}
  window.bulkAddFieldV9=(i,k,v)=>{
    const d=draft[i];if(!d)return;
    if(k==='qty')v=Number(v);
    d[k]=v;
    if(k==='checked')updateCount();
  };
  function updateCount(){const n=draft.filter(x=>x.checked).length;const el=document.getElementById('bulkAddSelectedCount');if(el)el.textContent=n}
  window.bulkAddSelectAllV9=v=>{draft.forEach(x=>x.checked=v);renderReview()};

  window.commitBulkAddV9=()=>{
    const selected=draft.filter(x=>x.checked&&String(x.name||'').trim());
    if(!selected.length){alert('登録する商品を選んでください');return}
    const merge=document.getElementById('bulkAddMerge')?.checked!==false;
    const now=Date.now();
    let merged=0,added=0;
    selected.forEach((d,i)=>{
      const name=String(d.name).trim();
      const qty=Number(d.qty);
      if(!Number.isFinite(qty)||qty<=0)return;
      const expType=d.expType||'期限なし';
      const exp=expType==='期限なし'?'':(d.exp||'');
      let hit=null;
      if(merge&&expType==='期限なし') hit=items.find(x=>x.name===name&&x.unit===d.unit&&(!x.exp||x.expType==='期限なし'));
      if(hit){hit.qty=(Number(hit.qty)||0)+qty;merged++;return}
      items.push({id:now+i,name,cat:d.cat||inferCat(name),qty,unit:d.unit||inferUnit(name),expType,exp,purchase:'',price:0,store:'',place:'その他',memo:'',usage:1});
      added++;
    });
    save();render();closeM();go('stock');
    alert(`${added+merged}件を在庫へ反映しました${merged?`（${merged}件は既存在庫に合算）`:''}`);
  };

  function addEntry(){
    const pg=document.getElementById('pg-add');if(!pg||document.getElementById('bulkAddEntryV9'))return;
    const section=pg.querySelector('.section');
    const b=document.createElement('button');
    b.id='bulkAddEntryV9';b.className='btn bulkAddEntry';b.innerHTML='⚡ まとめて追加する';b.onclick=openBulk;
    if(section)section.insertAdjacentElement('afterend',b);else pg.prepend(b);
  }
  addEntry();
  const badge=document.querySelector('.badge');if(badge)badge.textContent='試用版 v9';
})();
