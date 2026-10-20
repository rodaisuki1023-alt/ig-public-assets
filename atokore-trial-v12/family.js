/* Atokore family-safe: non-invasive lazy P2P sync */
(()=>{
  const KEY='atokoreFamilySafeV2', VER='atokoreFamilySafeVersionV2';
  // Local copies taken before family data replaces this device's data (newest first, max 5).
  const BACKUP='atokoreFamilyBackupV1', BACKUP_MAX=5;
  // This device's own stock record (written by save()) and the "sync paused after a restore" flag.
  const DATA_KEY='atokoreTrialV4', PAUSED='atokoreFamilyPausedV1';
  const PREFIX='atokore-safe-';
  let cfg=null, peer=null, leader=false, leaderConn=null, conns=new Map(), pollTimer=null, reconnectTimer=null, familyMode='create';
  let applying=false, lastHash='', version=0, peerLoading=false;
  // blocked: a family update is waiting because this device's data could not be backed up first.
  // paused: the user restored a backup; nothing is sent or applied until they choose how to resume.
  let blocked=false, paused=false;
  const $=id=>document.getElementById(id);
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const familyStyle=document.createElement('style');familyStyle.textContent='.familyModeTabs{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin:12px 0}.familyModeTab{border:1px solid #dfe4ea;background:#fff;border-radius:11px;padding:10px 6px;font-weight:850;color:#475467}.familyModeTab.on{background:#eef6ff;border-color:#1677ff;color:#0b63ce}.familyModeHint{border-radius:11px;background:#f7f8fa;color:#667085;font-size:11px;line-height:1.5;padding:9px 10px;margin-bottom:10px}';document.head.appendChild(familyStyle);
  const load=(k,f=null)=>{try{let v=JSON.parse(localStorage.getItem(k)||'null');return v??f}catch(e){return f}};
  const saveJ=(k,v)=>{try{localStorage.setItem(k,JSON.stringify(v))}catch(e){}};
  const code=()=>{const a='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';return Array.from({length:8},()=>a[Math.floor(Math.random()*a.length)]).join('')};
  const norm=v=>String(v||'').toUpperCase().replace(/[^A-Z2-9]/g,'').slice(0,8);
  const device=()=>{const a='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';return Array.from({length:6},()=>a[Math.floor(Math.random()*a.length)]).join('')};
  function state(){
    try{return {items:JSON.parse(JSON.stringify(items||[])),buys:JSON.parse(JSON.stringify(buys||[])),routines:JSON.parse(JSON.stringify(routines||[]))}}catch(e){return {items:[],buys:[],routines:[]}}
  }
  function hash(st){try{return JSON.stringify(st)}catch(e){return ''}}
  const isEmpty=st=>!st.items.length&&!st.buys.length&&!st.routines.length;
  function backupLocal(reason){
    const st=state();if(isEmpty(st))return false;
    const list=(load(BACKUP,[])||[]).filter(x=>x&&x.data);
    if(list[0]&&hash(list[0].data)===hash(st))return true;
    list.unshift({at:Date.now(),reason,data:st});
    // Drop the oldest copies first if storage is short; never block the sync on this.
    for(let n=Math.min(list.length,BACKUP_MAX);n>0;n--){try{localStorage.setItem(BACKUP,JSON.stringify(list.slice(0,n)));return true}catch(e){}}
    return false;
  }
  function notice(message){if(typeof window.notifyAtokoreV125H==='function')window.notifyAtokoreV125H(message)}
  // Records of this device that the incoming list would remove or change (same id, different content).
  function lost(localList,incomingList){
    const incoming=new Map((incomingList||[]).map(x=>[String(x&&x.id),hash(x)]));
    return localList.filter(x=>!incoming.has(String(x.id))||incoming.get(String(x.id))!==hash(x)).length;
  }
  // Replace the in-memory state and confirm it really reached storage; otherwise put the old state back.
  // save() of the app does not report failures, so the stored record is read back and compared.
  function persist(st){
    const before=state();
    const set=s=>{items=JSON.parse(JSON.stringify(s.items));buys=JSON.parse(JSON.stringify(s.buys));routines=JSON.parse(JSON.stringify(s.routines))};
    set(st);
    let ok=false;
    try{ok=typeof save==='function'&&save()!==false&&localStorage.getItem(DATA_KEY)===hash(state())}catch(e){ok=false}
    if(!ok){set(before);try{if(typeof save==='function')save()}catch(e){}}
    return ok;
  }
  function apply(st,v){
    if(!st||!Array.isArray(st.items)||!Array.isArray(st.buys)||!Array.isArray(st.routines))return false;
    const local=state();
    const changedItems=lost(local.items,st.items),changedOther=lost(local.buys,st.buys)+lost(local.routines,st.routines);
    // Keep a copy whenever family data would remove or change anything here, or on the first sync after joining.
    const needCopy=changedItems+changedOther>0||(version===0&&!isEmpty(local)&&hash(local)!==hash(st));
    if(needCopy&&!backupLocal(version===0?'join':'family-update')){
      if(!blocked)notice('この端末のデータを退避できない（空き容量不足など）ため、家族からの更新を保留しました。この端末の変更も家族には送りません。');
      blocked=true;updateBtn();return false;
    }
    applying=true;
    const ok=persist(st);
    if(ok){version=Number(v)||Date.now();saveJ(VER,version);blocked=false}
    try{if(typeof render==='function')render()}catch(e){console.error('family render',e)}
    lastHash=hash(state());
    applying=false; updateBtn();
    if(!ok){notice('家族のデータを保存できなかったため、この端末の内容のままにしました。');return false}
    if(changedItems)notice(`家族の端末の内容で更新しました（この端末の在庫${changedItems}件が変更・削除されました。家族共有画面から元に戻せます）`);
    return true;
  }
  function send(c,m){try{if(c&&c.open)c.send(m)}catch(e){}}
  function sendAll(m,except){if(leader)conns.forEach((c,id)=>{if(id!==except)send(c,m)});else send(leaderConn,m)}
  function onMsg(m,c){
    if(!m||typeof m!=='object')return;
    if(paused){if(m.type==='state'&&leader)sendAll(m,c?.peer);return}
    if(m.type==='hello'){
      const rv=Number(m.version)||0;
      if(rv>version) send(c,{type:'requestState'}); else send(c,{type:'state',version,state:state(),from:cfg.deviceId});
      return;
    }
    if(m.type==='requestState'){send(c,{type:'state',version,state:state(),from:cfg.deviceId});return}
    if(m.type==='state'){
      const rv=Number(m.version)||0;
      if(rv>version || (rv===version && String(m.from||'')>String(cfg.deviceId))){apply(m.state,rv);if(leader)sendAll(m,c?.peer)}
    }
  }
  function attach(c){
    if(!c)return;
    c.on('open',()=>{if(leader)conns.set(c.peer,c);send(c,{type:'hello',version,deviceId:cfg.deviceId});updateBtn()});
    c.on('data',m=>onMsg(m,c));
    c.on('close',()=>{if(leader)conns.delete(c.peer);else if(c===leaderConn){leaderConn=null;schedule()};updateBtn()});
    c.on('error',()=>updateBtn());
  }
  const leaderId=()=>PREFIX+cfg.familyCode.toLowerCase();
  const memberId=()=>PREFIX+cfg.familyCode.toLowerCase()+'-'+cfg.deviceId.toLowerCase();
  function stopPeer(){clearTimeout(reconnectTimer);try{peer?.destroy()}catch(e){}peer=null;leader=false;leaderConn=null;conns.clear();updateBtn()}
  function schedule(){clearTimeout(reconnectTimer);reconnectTimer=setTimeout(startPeer,1800)}
  function becomeMember(){
    stopPeer();
    try{peer=new Peer(memberId());leader=false;peer.on('open',()=>{leaderConn=peer.connect(leaderId(),{reliable:true,serialization:'json'});attach(leaderConn)});peer.on('error',schedule);peer.on('disconnected',schedule)}catch(e){schedule()}
  }
  function startPeer(){
    if(!cfg||!window.Peer)return;
    stopPeer();
    try{
      peer=new Peer(leaderId());leader=true;
      peer.on('open',updateBtn);
      peer.on('connection',attach);
      peer.on('error',e=>{if(e?.type==='unavailable-id')becomeMember();else schedule()});
      peer.on('disconnected',schedule);
    }catch(e){becomeMember()}
    startPoll();
  }
  function loadPeer(){
    if(window.Peer){startPeer();return}
    if(peerLoading)return;peerLoading=true;
    const s=document.createElement('script');s.src='https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js';s.async=true;
    s.onload=()=>{peerLoading=false;startPeer()};s.onerror=()=>{peerLoading=false;alert('家族共有の通信準備に失敗しました。通信環境を確認してください')};document.head.appendChild(s);
  }
  function startPoll(){
    clearInterval(pollTimer);lastHash=hash(state());
    pollTimer=setInterval(()=>{
      if(!cfg||applying||blocked||paused)return;
      const st=state(), h=hash(st); if(h===lastHash)return;
      lastHash=h;version=Date.now();saveJ(VER,version);sendAll({type:'state',version,state:st,from:cfg.deviceId});updateBtn();
    },1400);
  }
  function onlineCount(){return leader?conns.size:(leaderConn?.open?1:0)}
  function updateBtn(){const b=$('familyShareSafeBtn'),d=$('familyShareSafeDot');if(!b)return;const on=!!cfg&&onlineCount()>0;b.title=cfg?(on?`家族共有：同期中 ${onlineCount()+1}台`:'家族共有：接続待ち'):'家族共有';if(d)d.style.background=on?'#22a06b':'#aab4c2'}
  function ensureBtn(){
    if($('familyShareSafeBtn'))return;
    const top=document.querySelector('.top');if(!top)return;top.style.position='relative';
    const b=document.createElement('button');b.id='familyShareSafeBtn';b.type='button';b.setAttribute('aria-label','家族共有');
    b.style.cssText='position:absolute;right:92px;top:11px;z-index:30;height:38px;min-width:42px;padding:0 8px;border:1px solid #d8e1eb;border-radius:12px;background:#fff;font-size:18px;display:flex;align-items:center;justify-content:center;gap:3px;box-shadow:0 2px 8px #22304712';
    b.innerHTML='👥<span id="familyShareSafeDot" style="width:7px;height:7px;border-radius:50%;background:#aab4c2;display:inline-block"></span>';
    b.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();openFamily()});top.appendChild(b);updateBtn();
  }
  function modal(html){if(typeof openM==='function')openM(html);else alert('家族共有画面を開けませんでした')}
  function openFamily(mode=familyMode){
    cfg=load(KEY,null);version=Number(load(VER,0))||0;
    if(!cfg){
      const q=new URLSearchParams(location.search).get('family')||'';
      familyMode=q?'join':(mode==='join'?'join':'create');
      const tabs=`<div class="familyModeTabs"><button class="familyModeTab ${familyMode==='create'?'on':''}" onclick="setFamilyModeSafe('create')">家族を作る</button><button class="familyModeTab ${familyMode==='join'?'on':''}" onclick="setFamilyModeSafe('join')">コードで参加</button></div>`;
      const form=familyMode==='create'?`<div class="familyModeHint">最初の1台で家族コードを作り、あとから他の端末を招待します。</div><div class="field"><div class="label">この端末の名前</div><input id="famSafeCreateName" placeholder="例：自分のiPhone"></div><button class="btn" style="width:100%" onclick="createFamilySafe()">家族コードを作る</button>`:`<div class="familyModeHint">家族から届いた8文字のコードを入力すると、同じ在庫・買い物リストを使えます。</div><div class="field"><div class="label">家族コード</div><input id="famSafeJoinCode" maxlength="8" value="${esc(q)}" placeholder="8文字"></div><div class="field"><div class="label">この端末の名前</div><input id="famSafeJoinName" placeholder="例：自分のiPhone"></div><button class="btn" style="width:100%" onclick="joinFamilySafe()">この家族に参加</button>`;
      modal(`<button class="close" onclick="closeM()">閉じる</button><h2>👥 家族共有</h2><p class="muted">在庫・買い物リスト・いつものリストを家族の端末と同期します。</p>${tabs}${form}`);
      return;
    }
    const on=onlineCount()>0;
    modal(`<button class="close" onclick="closeM()">閉じる</button><h2>👥 家族共有</h2><div class="row"><div class="grow"><div class="name">${esc(cfg.deviceName)}</div><div class="meta">${on?`同期中 ${onlineCount()+1}台`:'接続待ち'}</div></div><span style="font-size:22px">${on?'🟢':'⚪️'}</span></div><div class="section">家族コード</div><div style="font-size:28px;font-weight:950;letter-spacing:.12em;text-align:center;padding:12px;border-radius:14px;background:#f2f6fb">${esc(cfg.familyCode)}</div><button class="btn" style="width:100%;margin-top:10px" onclick="shareFamilySafe()">家族に共有する</button>${statusPanel()}${backupButton()}<button class="btn ghost" style="width:100%;margin-top:8px" onclick="forceFamilySafeSync()">この端末の内容で全員を上書き</button><button class="btn danger" style="width:100%;margin-top:8px" onclick="leaveFamilySafe()">家族共有を解除</button><p class="muted" style="margin-top:10px">2台がオンラインになった時に自動同期します。普段の在庫・買い物操作には干渉しません。</p>`)
  }
  function backupButton(){
    const latest=(load(BACKUP,[])||[])[0];if(!latest||!latest.data)return '';
    const when=new Date(latest.at).toLocaleString('ja-JP',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});
    return `<button class="btn ghost" style="width:100%;margin-top:8px" onclick="restoreFamilyBackupSafe()">置き換え前のデータに戻す（${esc(when)}・在庫${esc(latest.data.items.length)}件）</button>`;
  }
  function statusPanel(){
    if(paused)return `<div class="familyModeHint" style="margin-top:10px">データを元に戻したため、この端末は家族との同期を止めています（送信も受信もしません）。</div><button class="btn" style="width:100%;margin-top:8px" onclick="resumeFamilySafe('receive')">家族の最新データを受け取って再開</button><button class="btn ghost" style="width:100%;margin-top:8px" onclick="resumeFamilySafe('send')">この端末の内容を家族に送って再開</button>`;
    if(blocked)return '<div class="familyModeHint" style="margin-top:10px">この端末のデータを退避できないため、家族からの更新を保留しています。空き容量を増やしてから再読み込みしてください。</div>';
    return '';
  }
  function setPaused(on){paused=on;try{if(on)localStorage.setItem(PAUSED,'1');else localStorage.removeItem(PAUSED)}catch(e){}updateBtn()}
  window.restoreFamilyBackupSafe=()=>{
    const latest=(load(BACKUP,[])||[])[0];if(!latest||!latest.data)return;
    if(!confirm(`この端末のデータを、${new Date(latest.at).toLocaleString('ja-JP')}に保存した内容（在庫${latest.data.items.length}件）に戻します。\n家族の端末には送りません（この端末の同期は一時停止します）。戻しますか？`))return;
    if(!isEmpty(state())&&!backupLocal('before-restore')){alert('今のデータを退避できないため、元に戻すのを中止しました（何も変更していません）。');return}
    // Pause first so the sync timer can never send the restored data before the user decides.
    const wasPaused=paused;setPaused(true);
    if(!persist(latest.data)){setPaused(wasPaused);alert('元に戻せませんでした（保存に失敗しました）。データは変更していません。');return}
    lastHash=hash(state());
    if(typeof render==='function')render();
    closeM();notice('置き換え前のデータに戻しました。家族の端末には送っていません。');
  };
  window.resumeFamilySafe=mode=>{
    if(mode==='send'){
      if(!confirm('家族の全員の端末の在庫・買い物リストを、この端末の内容で上書きします。続けますか？'))return;
      setPaused(false);version=Date.now();saveJ(VER,version);const st=state();lastHash=hash(st);sendAll({type:'state',version,state:st,from:cfg.deviceId});
      closeM();notice('この端末の内容を家族に送りました');return;
    }
    // Receive: forget our version so the family's newest data is requested and applied (a copy is kept first).
    setPaused(false);version=0;saveJ(VER,0);lastHash=hash(state());
    if(cfg&&window.Peer)startPeer();
    closeM();notice('家族の最新データを受け取ります（届く前の内容は自動で退避します）');
  };
  window.setFamilyModeSafe=mode=>{familyMode=mode==='join'?'join':'create';openFamily(familyMode)};
  window.createFamilySafe=()=>{const name=($('famSafeCreateName')?.value||'').trim()||'この端末';cfg={familyCode:code(),deviceId:device(),deviceName:name,created:true};version=Date.now();saveJ(KEY,cfg);saveJ(VER,version);lastHash=hash(state());loadPeer();openFamily()};
  window.joinFamilySafe=()=>{const c=norm($('famSafeJoinCode')?.value),name=($('famSafeJoinName')?.value||'').trim()||'この端末';if(c.length!==8){alert('8文字の家族コードを入力してください');return}const local=state();if(!isEmpty(local)){if(!confirm(`参加すると、この端末の在庫${local.items.length}件・買い物${local.buys.length}件は家族のデータに置き換わります。\n置き換え前の内容はこの端末に保存され、家族共有画面から戻せます。\n参加しますか？`))return;if(!backupLocal('join')){alert('この端末のデータを退避できない（空き容量不足など）ため、参加を中止しました。何も変更していません。');return}}cfg={familyCode:c,deviceId:device(),deviceName:name,created:false};version=0;saveJ(KEY,cfg);saveJ(VER,version);loadPeer();openFamily()};
  window.shareFamilySafe=async()=>{if(!cfg)return;const base=location.origin+location.pathname;const url=base+'?family='+encodeURIComponent(cfg.familyCode);const text=`あとこれの家族共有コード：${cfg.familyCode}\n${url}`;try{if(navigator.share)await navigator.share({title:'あとこれ 家族共有',text,url});else{await navigator.clipboard.writeText(text);alert('共有内容をコピーしました')}}catch(e){}};
  window.forceFamilySafeSync=()=>{if(!cfg)return;if(!confirm('家族の全員の端末の在庫・買い物リストを、この端末の内容で上書きします。\nほかの端末で最近行った変更は失われる場合があります。続けますか？'))return;setPaused(false);blocked=false;version=Date.now();saveJ(VER,version);const st=state();lastHash=hash(st);sendAll({type:'state',version,state:st,from:cfg.deviceId});alert('この端末の内容を家族の端末に送信しました')};
  window.leaveFamilySafe=()=>{if(!confirm('家族共有を解除しますか？'))return;stopPeer();clearInterval(pollTimer);localStorage.removeItem(KEY);localStorage.removeItem(VER);setPaused(false);blocked=false;cfg=null;version=0;updateBtn();closeM()};
  function init(){ensureBtn();cfg=load(KEY,null);version=Number(load(VER,0))||0;paused=!!load(PAUSED,false);if(cfg)loadPeer();const q=new URLSearchParams(location.search).get('family');if(q&&!cfg){familyMode='join';setTimeout(()=>openFamily('join'),500)}}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(init,100));else setTimeout(init,100);
})();
