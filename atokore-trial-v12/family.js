/* Atokore family-safe: non-invasive lazy P2P sync */
(()=>{
  const KEY='atokoreFamilySafeV2', VER='atokoreFamilySafeVersionV2';
  const PREFIX='atokore-safe-';
  let cfg=null, peer=null, leader=false, leaderConn=null, conns=new Map(), pollTimer=null, reconnectTimer=null;
  let applying=false, lastHash='', version=0, peerLoading=false;
  const $=id=>document.getElementById(id);
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const load=(k,f=null)=>{try{let v=JSON.parse(localStorage.getItem(k)||'null');return v??f}catch(e){return f}};
  const saveJ=(k,v)=>{try{localStorage.setItem(k,JSON.stringify(v))}catch(e){}};
  const code=()=>{const a='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';return Array.from({length:8},()=>a[Math.floor(Math.random()*a.length)]).join('')};
  const norm=v=>String(v||'').toUpperCase().replace(/[^A-Z2-9]/g,'').slice(0,8);
  const device=()=>{const a='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';return Array.from({length:6},()=>a[Math.floor(Math.random()*a.length)]).join('')};
  function state(){
    try{return {items:JSON.parse(JSON.stringify(items||[])),buys:JSON.parse(JSON.stringify(buys||[])),routines:JSON.parse(JSON.stringify(routines||[]))}}catch(e){return {items:[],buys:[],routines:[]}}
  }
  function hash(st){try{return JSON.stringify(st)}catch(e){return ''}}
  function apply(st,v){
    if(!st||!Array.isArray(st.items)||!Array.isArray(st.buys)||!Array.isArray(st.routines))return;
    applying=true;
    try{items=JSON.parse(JSON.stringify(st.items));buys=JSON.parse(JSON.stringify(st.buys));routines=JSON.parse(JSON.stringify(st.routines));version=Number(v)||Date.now();saveJ(VER,version);if(typeof save==='function')save();if(typeof render==='function')render();lastHash=hash(state())}catch(e){console.error('family apply',e)}
    applying=false; updateBtn();
  }
  function send(c,m){try{if(c&&c.open)c.send(m)}catch(e){}}
  function sendAll(m,except){if(leader)conns.forEach((c,id)=>{if(id!==except)send(c,m)});else send(leaderConn,m)}
  function onMsg(m,c){
    if(!m||typeof m!=='object')return;
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
      if(!cfg||applying)return;
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
  function openFamily(){
    cfg=load(KEY,null);version=Number(load(VER,0))||0;
    if(!cfg){
      const q=new URLSearchParams(location.search).get('family')||'';
      modal(`<button class="close" onclick="closeM()">閉じる</button><h2>👥 家族共有</h2><p class="muted">在庫・買い物リスト・いつものリストを家族の端末と同期します。</p><div class="section">新しく家族を作る</div><div class="field"><div class="label">この端末の名前</div><input id="famSafeCreateName" placeholder="例：パパ"></div><button class="btn" style="width:100%" onclick="createFamilySafe()">家族コードを作る</button><div class="section">家族に参加</div><div class="field"><div class="label">家族コード</div><input id="famSafeJoinCode" maxlength="8" value="${esc(q)}" placeholder="8文字"></div><div class="field"><div class="label">この端末の名前</div><input id="famSafeJoinName" placeholder="例：ママ"></div><button class="btn ghost" style="width:100%" onclick="joinFamilySafe()">この家族に参加</button>`);
      return;
    }
    const on=onlineCount()>0;
    modal(`<button class="close" onclick="closeM()">閉じる</button><h2>👥 家族共有</h2><div class="row"><div class="grow"><div class="name">${esc(cfg.deviceName)}</div><div class="meta">${on?`同期中 ${onlineCount()+1}台`:'接続待ち'}</div></div><span style="font-size:22px">${on?'🟢':'⚪️'}</span></div><div class="section">家族コード</div><div style="font-size:28px;font-weight:950;letter-spacing:.12em;text-align:center;padding:12px;border-radius:14px;background:#f2f6fb">${esc(cfg.familyCode)}</div><button class="btn" style="width:100%;margin-top:10px" onclick="shareFamilySafe()">奥さんに共有する</button><button class="btn ghost" style="width:100%;margin-top:8px" onclick="forceFamilySafeSync()">今すぐ同期</button><button class="btn danger" style="width:100%;margin-top:8px" onclick="leaveFamilySafe()">家族共有を解除</button><p class="muted" style="margin-top:10px">2台がオンラインになった時に自動同期します。普段の在庫・買い物操作には干渉しません。</p>`)
  }
  window.createFamilySafe=()=>{const name=($('famSafeCreateName')?.value||'').trim()||'この端末';cfg={familyCode:code(),deviceId:device(),deviceName:name,created:true};version=Date.now();saveJ(KEY,cfg);saveJ(VER,version);lastHash=hash(state());loadPeer();openFamily()};
  window.joinFamilySafe=()=>{const c=norm($('famSafeJoinCode')?.value),name=($('famSafeJoinName')?.value||'').trim()||'この端末';if(c.length!==8){alert('8文字の家族コードを入力してください');return}cfg={familyCode:c,deviceId:device(),deviceName:name,created:false};version=0;saveJ(KEY,cfg);saveJ(VER,version);loadPeer();openFamily()};
  window.shareFamilySafe=async()=>{if(!cfg)return;const base=location.origin+location.pathname;const url=base+'?family='+encodeURIComponent(cfg.familyCode);const text=`あとこれの家族共有コード：${cfg.familyCode}\n${url}`;try{if(navigator.share)await navigator.share({title:'あとこれ 家族共有',text,url});else{await navigator.clipboard.writeText(text);alert('共有内容をコピーしました')}}catch(e){}};
  window.forceFamilySafeSync=()=>{if(!cfg)return;version=Date.now();saveJ(VER,version);const st=state();lastHash=hash(st);sendAll({type:'state',version,state:st,from:cfg.deviceId});alert('同期データを送信しました')};
  window.leaveFamilySafe=()=>{if(!confirm('家族共有を解除しますか？'))return;stopPeer();clearInterval(pollTimer);localStorage.removeItem(KEY);localStorage.removeItem(VER);cfg=null;version=0;updateBtn();closeM()};
  function init(){ensureBtn();cfg=load(KEY,null);version=Number(load(VER,0))||0;if(cfg)loadPeer();const q=new URLSearchParams(location.search).get('family');if(q&&!cfg)setTimeout(openFamily,500)}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(init,100));else setTimeout(init,100);
})();
