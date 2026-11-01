/* あとこれ v10 - 表示設定（極小文字 × 超コンパクト対応） */
(()=>{
  const KEY='atokoreDisplayPrefsV1';
  const defaults={font:'standard',density:'standard'};
  let prefs=loadPrefs();

  const css=`
  .displaySettingsBtn{position:absolute;top:10px;right:12px;width:38px;height:38px;border:0;border-radius:12px;background:#eef2f7;color:#25324a;font-size:20px;display:flex;align-items:center;justify-content:center;z-index:2}
  .displaySettingsGrid{display:grid;grid-template-columns:repeat(2,1fr);gap:7px;margin:8px 0 14px}
  .displayChoice{border:1px solid #dfe4ea;background:#fff;color:#25324a;border-radius:12px;padding:9px 6px;font-weight:850;text-align:center}
  .displayChoice.on{border-color:#1677ff;background:#eef6ff;color:#0b63ce;box-shadow:0 0 0 1px #1677ff inset}
  .displayChoice small{display:block;margin-top:2px;font-size:10px;font-weight:700;color:#667085}
  .displayPreview{border:1px solid #e5e7eb;border-radius:15px;background:#fbfcfe;padding:12px;margin:10px 0 14px}
  .displayPreviewRow{display:flex;gap:10px;align-items:center;padding:8px 0;border-bottom:1px solid #eef0f3}.displayPreviewRow:last-child{border-bottom:0}
  .displayPreviewQty{font-weight:900;margin-left:auto;white-space:nowrap}
  .displayNote{font-size:12px;color:#667085;line-height:1.5}

  body{--atk-font-scale:1;font-size:calc(16px * var(--atk-font-scale))}
  body.atk-fs-tiny{--atk-font-scale:.82}
  body.atk-fs-small{--atk-font-scale:.92}
  body.atk-fs-large{--atk-font-scale:1.2}

  body.atk-density-ultra .content{padding:5px 6px}
  body.atk-density-ultra .top{padding:7px 10px;min-height:48px}
  body.atk-density-ultra .row{gap:4px;padding:4px 5px;margin:3px 0;border-radius:9px}
  body.atk-density-ultra .hero{padding:8px 9px;border-radius:12px}
  body.atk-density-ultra .hero h2{margin:2px 0}
  body.atk-density-ultra .metrics{gap:3px;margin-top:4px}
  body.atk-density-ultra .metric{padding:4px 2px;border-radius:9px}
  body.atk-density-ultra .section{margin:8px 0 4px}
  body.atk-density-ultra .quick{gap:3px}
  body.atk-density-ultra .quick button{padding:5px 2px;border-radius:9px}
  body.atk-density-ultra .quick strong{font-size:15px}
  body.atk-density-ultra .field{margin:5px 0}
  body.atk-density-ultra .field input,body.atk-density-ultra .field select,body.atk-density-ultra .field textarea{padding:7px;border-radius:8px}
  body.atk-density-ultra .products{gap:3px}
  body.atk-density-ultra .product{padding:5px;border-radius:7px}
  body.atk-density-ultra .chips{gap:3px;margin:4px 0}
  body.atk-density-ultra .chip{padding:4px 6px}
  body.atk-density-ultra .btn{padding:6px 7px;border-radius:8px}
  body.atk-density-ultra .icon{width:27px;height:27px;border-radius:7px;font-size:14px}
  body.atk-density-ultra .qty{gap:3px}
  body.atk-density-ultra .qty b{min-width:36px}
  body.atk-density-ultra .routineCard{padding:6px;margin:4px 0;border-radius:10px}
  body.atk-density-ultra .routineActions{gap:3px;margin-top:5px}
  body.atk-density-ultra .routineInline{gap:3px;margin:5px 0}
  body.atk-density-ultra .routineInline input{padding:7px}
  body.atk-density-ultra .detail{padding:6px;border-radius:9px}
  body.atk-density-ultra .sheet{padding:11px 8px 16px}
  body.atk-density-ultra .tabs{padding:1px 1px calc(1px + env(safe-area-inset-bottom))}
  body.atk-density-ultra .tab{padding:2px 1px}
  body.atk-density-ultra .bulkbar{gap:4px}
  body.atk-density-ultra .expiryBadge{margin-top:2px}

  body.atk-density-compact .content{padding:9px}
  body.atk-density-compact .top{padding:10px 12px}
  body.atk-density-compact .row{gap:7px;padding:7px 8px;margin:5px 0;border-radius:12px}
  body.atk-density-compact .hero{padding:12px;border-radius:15px}
  body.atk-density-compact .metrics{gap:5px;margin-top:7px}
  body.atk-density-compact .metric{padding:7px 4px;border-radius:12px}
  body.atk-density-compact .section{margin:12px 0 6px}
  body.atk-density-compact .quick{gap:5px}
  body.atk-density-compact .quick button{padding:8px 3px;border-radius:12px}
  body.atk-density-compact .quick strong{font-size:18px}
  body.atk-density-compact .field{margin:7px 0}
  body.atk-density-compact .field input,body.atk-density-compact .field select,body.atk-density-compact .field textarea{padding:9px;border-radius:10px}
  body.atk-density-compact .products{gap:4px}
  body.atk-density-compact .product{padding:7px;border-radius:9px}
  body.atk-density-compact .chips{gap:5px;margin:6px 0}
  body.atk-density-compact .chip{padding:6px 8px}
  body.atk-density-compact .btn{padding:8px 10px;border-radius:10px}
  body.atk-density-compact .icon{width:32px;height:32px;border-radius:9px;font-size:17px}
  body.atk-density-compact .routineCard{padding:8px;margin:6px 0;border-radius:13px}
  body.atk-density-compact .routineActions{gap:5px;margin-top:7px}
  body.atk-density-compact .routineInline{gap:5px;margin:7px 0}
  body.atk-density-compact .routineInline input{padding:9px}
  body.atk-density-compact .detail{padding:8px;border-radius:11px}
  body.atk-density-compact .sheet{padding:14px 12px 20px}
  body.atk-density-compact .tabs{padding:3px 2px calc(3px + env(safe-area-inset-bottom))}
  body.atk-density-compact .tab{padding:4px 2px}

  body.atk-density-roomy .content{padding:18px}
  body.atk-density-roomy .top{padding:18px 18px}
  body.atk-density-roomy .row{gap:12px;padding:15px;margin:11px 0;border-radius:18px}
  body.atk-density-roomy .hero{padding:22px;border-radius:23px}
  body.atk-density-roomy .metrics{gap:11px;margin-top:13px}
  body.atk-density-roomy .metric{padding:14px 8px;border-radius:18px}
  body.atk-density-roomy .section{margin:23px 0 12px}
  body.atk-density-roomy .quick{gap:11px}
  body.atk-density-roomy .quick button{padding:16px 8px;border-radius:18px}
  body.atk-density-roomy .field{margin:15px 0}
  body.atk-density-roomy .field input,body.atk-density-roomy .field select,body.atk-density-roomy .field textarea{padding:15px;border-radius:15px}
  body.atk-density-roomy .products{gap:10px}
  body.atk-density-roomy .product{padding:14px;border-radius:14px}
  body.atk-density-roomy .chips{gap:10px;margin:11px 0}
  body.atk-density-roomy .chip{padding:10px 14px}
  body.atk-density-roomy .btn{padding:13px 16px;border-radius:14px}
  body.atk-density-roomy .icon{width:44px;height:44px;border-radius:13px}
  body.atk-density-roomy .routineCard{padding:15px;margin:12px 0;border-radius:19px}
  body.atk-density-roomy .routineActions{gap:10px;margin-top:13px}
  body.atk-density-roomy .routineInline{gap:10px;margin:13px 0}
  body.atk-density-roomy .routineInline input{padding:14px}
  body.atk-density-roomy .detail{padding:14px;border-radius:17px}
  body.atk-density-roomy .sheet{padding:22px 18px 30px}
  body.atk-density-roomy .tabs{padding:7px 2px calc(7px + env(safe-area-inset-bottom))}
  body.atk-density-roomy .tab{padding:8px 2px}

  .field input,.field select,.field textarea,.routineInline input,.routineNameEdit,.receiptGrid input,.receiptGrid select,.receiptMeta input,.bulkAddText,.bulkAddGrid input,.bulkAddGrid select,.bulkAddGrid2 input,.bulkAddGrid2 select{font-size:16px!important}
  `;
  const st=document.createElement('style');st.id='atokoreDisplayStyles';st.textContent=css;document.head.appendChild(st);

  // Existing screens use many fixed px sizes, including late-injected styles.
  // Scale those declarations at their original specificity so fonts retain their
  // relative hierarchy and button dimensions are not scaled.
  function scaledSize(value, isField){
    const match=/^(\\d+(?:\\.\\d+)?)px$/.exec(value.trim());
    if(!match)return null;
    const scaled='calc('+match[1]+'px * var(--atk-font-scale, 1))';
    return isField?'max(16px, '+scaled+')':scaled;
  }
  function scaleRules(rules){
    for(const rule of Array.from(rules||[])){
      if(rule.cssRules)scaleRules(rule.cssRules);
      const style=rule.style;if(!style)return;
      // The old list-only overrides would hide the globally scaled sizes.
      if(/\\.atk-fs-(?:tiny|small|large)/.test(rule.selectorText||'')){
        style.removeProperty('font-size');continue;
      }
      const value=style.getPropertyValue('font-size');
      const selector=rule.selectorText||'';
      const isField=/(?:^|[\\s>+~,])(?:input|select|textarea)(?:[\\s.#[(:>+~,]|$)/.test(selector);
      const size=scaledSize(value,isField);
      if(size)style.setProperty('font-size',size,style.getPropertyPriority('font-size'));
    }
  }
  function scaleSheets(){
    for(const sheet of Array.from(document.styleSheets)){
      try{scaleRules(sheet.cssRules)}catch(e){/* Cross-origin sheets cannot be edited. */}
    }
  }
  function scaleInline(el){
    if(el.nodeType!==1)return;
    const isField=/^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName);
    const value=el.style.getPropertyValue('font-size');
    const size=scaledSize(value,isField);
    if(size)el.style.setProperty('font-size',size,el.style.getPropertyPriority('font-size'));
  }
  function scaleInlineTree(el){
    if(el.nodeType!==1)return;
    scaleInline(el);
    el.querySelectorAll('[style]').forEach(scaleInline);
  }
  scaleSheets();
  scaleInlineTree(document.body);
  window.addEventListener('load',scaleSheets,{once:true});
  new MutationObserver(records=>{
    for(const record of records){
      if(record.type==='attributes')scaleInline(record.target);
      else for(const node of record.addedNodes)scaleInlineTree(node);
    }
  }).observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['style']});
  new MutationObserver(scaleSheets).observe(document.head,{subtree:true,childList:true,characterData:true});

  function loadPrefs(){
    try{
      const v=JSON.parse(localStorage.getItem(KEY)||'null');
      const fonts=['tiny','small','standard','large'];
      const densities=['ultra','compact','standard','roomy'];
      return {font:fonts.includes(v?.font)?v.font:'standard',density:densities.includes(v?.density)?v.density:'standard'};
    }catch(e){return {...defaults}}
  }
  function persist(){try{localStorage.setItem(KEY,JSON.stringify({...JSON.parse(localStorage.getItem(KEY)||'{}'),...prefs}))}catch(e){}}
  function apply(){
    document.body.classList.remove('atk-fs-tiny','atk-fs-small','atk-fs-large','atk-density-ultra','atk-density-compact','atk-density-roomy');
    if(prefs.font==='tiny')document.body.classList.add('atk-fs-tiny');
    if(prefs.font==='small')document.body.classList.add('atk-fs-small');
    if(prefs.font==='large')document.body.classList.add('atk-fs-large');
    if(prefs.density==='ultra')document.body.classList.add('atk-density-ultra');
    if(prefs.density==='compact')document.body.classList.add('atk-density-compact');
    if(prefs.density==='roomy')document.body.classList.add('atk-density-roomy');
    document.documentElement.dataset.atokoreFont=prefs.font;
    document.documentElement.dataset.atokoreDensity=prefs.density;
  }
  function choice(kind,value,title,sub){
    const on=prefs[kind]===value?' on':'';
    return `<button class="displayChoice${on}" onclick="setAtokoreDisplay('${kind}','${value}')">${title}<small>${sub}</small></button>`;
  }
  function settingsHtml(){
    return `<button class="close" onclick="closeM()">閉じる</button><h2>⚙️ 表示設定</h2>
      <div class="displayNote">文字の大きさと、1画面に表示する情報量を別々に調整できます。この設定はこの端末だけに保存されます。</div>
      <div class="section">文字サイズ</div>
      <div class="displaySettingsGrid">
        ${choice('font','tiny','極小','最大情報量')}
        ${choice('font','small','小さい','一覧重視')}
        ${choice('font','standard','標準','おすすめ')}
        ${choice('font','large','大きい','読みやすさ')}
      </div>
      <div class="section">表示密度</div>
      <div class="displaySettingsGrid">
        ${choice('density','ultra','超コンパクト','最も詰める')}
        ${choice('density','compact','コンパクト','一気に見る')}
        ${choice('density','standard','標準','バランス')}
        ${choice('density','roomy','ゆったり','押しやすい')}
      </div>
      <div class="section">プレビュー（サンプル）</div>
      <div class="displayPreview">
        <div class="displayPreviewRow"><div><div class="name">牛乳</div><div class="meta">食料品・冷蔵庫・消費期限 8/31</div></div><div class="displayPreviewQty">2本</div></div>
        <div class="displayPreviewRow"><div><div class="name">オムツ</div><div class="meta">ベビー・収納</div></div><div class="displayPreviewQty">1袋</div></div>
        <div class="displayPreviewRow"><div><div class="name">卵</div><div class="meta">食料品・冷蔵庫</div></div><div class="displayPreviewQty">8個</div></div>
      </div>
      <button class="btn ghost" style="width:100%" onclick="resetAtokoreDisplay()">標準に戻す</button>`;
  }

  window.openAtokoreDisplaySettings=()=>openM(settingsHtml());
  window.setAtokoreDisplay=(kind,value)=>{
    if(kind==='font'&&!['tiny','small','standard','large'].includes(value))return;
    if(kind==='density'&&!['ultra','compact','standard','roomy'].includes(value))return;
    prefs={...prefs,[kind]:value};persist();apply();
    if(document.getElementById('sheet'))openM(settingsHtml());
  };
  window.resetAtokoreDisplay=()=>{prefs={...defaults};persist();apply();if(document.getElementById('sheet'))openM(settingsHtml())};

  function addEntryPoints(){
    const top=document.querySelector('.top');
    if(top&&!document.getElementById('displaySettingsBtn')){
      const b=document.createElement('button');b.id='displaySettingsBtn';b.className='displaySettingsBtn';b.setAttribute('aria-label','表示設定');b.title='表示設定';b.innerHTML='⚙️';b.onclick=window.openAtokoreDisplaySettings;top.appendChild(b);
    }
    const premium=document.getElementById('pg-premium');
    if(premium&&!document.getElementById('displaySettingsCard')){
      const d=document.createElement('div');d.id='displaySettingsCard';d.className='row';d.setAttribute('role','button');d.tabIndex=0;d.innerHTML='<div class="grow"><div class="name">⚙️ 表示設定</div><div class="meta">極小文字・超コンパクトにも対応</div></div>›';d.onclick=window.openAtokoreDisplaySettings;d.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();window.openAtokoreDisplaySettings()}};premium.insertBefore(d,premium.firstChild?.nextSibling||premium.firstChild);
    }
  }

  apply();addEntryPoints();
  const badge=document.querySelector('.badge');if(badge)badge.textContent='試用版 v10';
})();
