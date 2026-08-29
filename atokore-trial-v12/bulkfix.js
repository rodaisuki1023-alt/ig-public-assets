/* あとこれ v12.3 - 在庫一括→買い物リスト 確実反映 */
(()=>{
  function selectedStockIdsFromScreen(){
    const ids=[];
    document.querySelectorAll('#stockList input[type="checkbox"]:checked').forEach(ch=>{
      const row=ch.closest('.row');
      const src=((ch.getAttribute('onclick')||'')+' '+(row?.getAttribute('onclick')||''));
      const m=src.match(/toggleStockPick\((\d+)\)/);
      if(m)ids.push(Number(m[1]));
    });
    if(!ids.length){
      try{if(stockSelected&&stockSelected.size)stockSelected.forEach(id=>ids.push(Number(id)))}catch(e){}
    }
    return [...new Set(ids)].filter(Number.isFinite);
  }

  function addSelectedToBuyV123(){
    try{
      const ids=selectedStockIdsFromScreen();
      if(!ids.length){alert('買い物へ追加する商品を選んでください');return}
      const set=new Set(ids);
      const selected=items.filter(x=>set.has(Number(x.id)));
      if(!selected.length){alert('選択した商品を取得できませんでした。もう一度選択してください');return}

      let added=0;
      selected.forEach(x=>{
        const unit=x.unit||'個';
        let b=buys.find(v=>Number(v.stockId)===Number(x.id)||(v.name===x.name&&v.unit===unit));
        if(b)b.qty=(Number(b.qty)||0)+1;
        else buys.push({id:Date.now()+Math.floor(Math.random()*100000),name:x.name,qty:1,unit,stockId:x.id});
        added++;
      });

      save();

      const reflected=selected.every(x=>buys.some(v=>Number(v.stockId)===Number(x.id)||(v.name===x.name&&v.unit===(x.unit||'個'))));
      if(!reflected){alert('買い物リストへの反映を確認できませんでした。もう一度お試しください');return}

      try{stockSelected.clear();stockSelectMode=false}catch(e){}
      if(typeof renderBuy==='function')renderBuy();
      if(typeof render==='function')render();
      if(typeof go==='function')go('buy');
      setTimeout(()=>{try{renderBuy()}catch(e){}},0);
      setTimeout(()=>alert(`${added}件を買い物リストに追加しました`),10);
    }catch(e){
      console.error('addSelectedToBuyV123',e);
      alert('買い物リストへの追加に失敗しました');
    }
  }

  window.moveSelectedToBuyV123=addSelectedToBuyV123;
  window.moveSelectedToBuy=addSelectedToBuyV123;

  function wireButton(){
    const b=document.getElementById('stockBulkMove');
    if(!b)return;
    b.removeAttribute('onclick');
    b.onclick=addSelectedToBuyV123;
  }

  const rs=window.renderStock;
  if(typeof rs==='function')window.renderStock=function(...a){const r=rs.apply(this,a);wireButton();return r};
  const rr=window.render;
  if(typeof rr==='function')window.render=function(...a){const r=rr.apply(this,a);wireButton();return r};
  const gg=window.go;
  if(typeof gg==='function')window.go=function(...a){const r=gg.apply(this,a);setTimeout(wireButton,0);return r};

  wireButton();
})();
