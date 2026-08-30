/* あとこれ v12.7 - 家族共有（Peer-to-Peer / 家族コード） */
(()=>{
  const CFG_KEY='atokoreFamilyV1';
  const OPS_KEY='atokoreFamilyOpsV1';
  const SNAP_KEY='atokoreFamilyLastSnapshotV1';
  const PEER_SRC='https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js';
  const PEER_PREFIX='atokore-family-';
  const DEVICE_MAX=5;
  const MAX_OPS=1200;

  let cfg=loadJSON(CFG_KEY,null);
  let ops=Array.isArray(loadJSON(OPS_KEY,[]))?loadJSON(OPS_KEY,[]):[];
  let lastSnapshot=loadJSON(SNAP_KEY,null);
  let peer=null, isLeader=false, leaderConn=null, memberConns=new Map(), reconnectTimer=null;
  let applyingRemote=false, lastRemoteAt=0;
  let originalSave=null;

  function loadJSON(k,f){try{const v=JSON.parse(localStorage.getItem(k)||'null');return v??f}catch(e){return f}}
  function putJSON(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch(e){}}
  function now(){return Date.now()}
  function rnd(n=6){const chars='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';let s='';for(let i=0;i<n;i++)s+=chars[Math.floor(Math.random()*chars.length)];return s}
  function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
  function codeNorm(s){return String(s||'').toUpperCase().replace(/[^A-Z2-9]/g,'').replace(/[IO01]/g,'').slice(0,8)}
  function getState(){
    let a=[],b=[],r=[];
    try{a=Array.isArray(items)?JSON.parse(JSON.stringify(items)):[]}catch(e){}
    try{b=Array.isArray(buys)?JSON.parse(JSON.stringify(buys)):[]}catch(e){}
    try{r=Array.isArray(routines)?JSON.parse(JSON.stringify(routines)):[]}catch(e){}
    return {items:a,buys:b,routines:r};
  }
  function setState(s){
    try{items=Array.isArray(s.items)?JSON.parse(JSON.stringify(s.items)):[]}catch(e){}
    try{buys=Array.isArray(s.buys)?JSON.parse(JSON.stringify(s.buys)):[]}catch(e){}
    try{routines=Array.isArray(s.routines)?JSON.parse(JSON.stringify(s.routines)):[]}catch(e){}
  }
  function mapById(arr){const m=new Map();(arr||[]).forEach(x=>m.set(String(x.id),x));return m}
  function same(a,b){try{return JSON.stringify(a)===JSON.stringify(b)}catch(e){return false}}
  function pushOp(op){ops.push(op);if(ops.length>MAX_OPS)ops=ops.slice(-MAX_OPS);putJSON(OPS_KEY,ops)}
  function makeOp(collection,type,id,value){return {opId:`${cfg?.deviceId||'d'}-${now()}-${rnd(4)}`,ts:now(),deviceId:cfg?.deviceId||'local',collection,type,id:String(id),value:value?JSON.parse(JSON.stringify(value)):null}}
  function diffCollection(name,prev,next){
    const p=mapById(prev),n=mapById(next),out=[];
    n.forEach((v,id)=>{if(!p.has(id)||!same(p.get(id),v))out.push(makeOp(name,'upsert',id,v))});
    p.forEach((v,id)=>{if(!n.has(id))out.push(makeOp(name,'delete',id,null))});
    return out;
  }
  function diffState(prev,next){
    prev=prev||{items:[],buys:[],routines:[]};
    return [
      ...diffCollection('items',prev.items,next.items),
      ...diffCollection('buys',prev.buys,next.buys),
      ...diffCollection('routines',prev.routines,next.routines)
    ];
  }
  function applyOps(allOps){
    const state={items:[],buys:[],routines:[]};
    const collMaps={items:new Map(),buys:new Map(),routines:new Map()};
    [...allOps].sort((a,b)=>(a.ts-b.ts)||String(a.opId).localeCompare(String(b.opId))).forEach(op=>{
      const m=collMaps[op.collection];if(!m)return;
      if(op.type==='delete')m.delete(String(op.id));
      else if(op.value)m.set(String(op.id),JSON.parse(JSON.stringify(op.value)));
    });
    Object.keys(collMaps).forEach(k=>state[k]=[...collMaps[k].values()]);
    return state;
  }
  function dedupeOps(incoming){
    const ids=new Set(ops.map(x=>x.opId));let added=0;
    (incoming||[]).forEach(op=>{if(!op||!op.opId||ids.has(op.opId))return;ids.add(op.opId);ops.push(op);added++});
    if(ops.length>MAX_OPS)ops=ops.slice(-MAX_OPS);
    if(added)putJSON(OPS_KEY,ops);
    return added;
  }
  function bootstrapOpsFromCurrent(){
    if(!cfg||ops.length)return;
    const s=getState(),t=now();
    ['items','buys','routines'].forEach(c=>(s[c]||[]).forEach((v,i)=>pushOp({opId:`${cfg.deviceId}-base-${t}-${c}-${i}`,ts:t+i,deviceId:cfg.deviceId,collection:c,type:'upsert',id:String(v.id),value:v})));
    lastSnapshot=s;putJSON(SNAP_KEY,lastSnapshot);
  }
  function wrapSave(){
    if(originalSave||typeof window.save!=='function')return;
    originalSave=window.save;
    window.save=function(){
      const before=lastSnapshot||getState();
      const ret=originalSave.apply(this,arguments);
      const after=getState();
      if(cfg&&!applyingRemote){
        const changes=diffState(before,after);
        changes.forEach(pushOp);
        if(changes.length)broadcast({type:'ops',ops:changes,from:cfg.deviceId});
      }
      lastSnapshot=after;putJSON(SNAP_KEY,lastSnapshot);
      updateFamilyStatus();
      return ret;
    };
  }
  function persistRemoteState(){
    applyingRemote=true;
    const s=applyOps(ops);setState(s);
    try{(originalSave||window.save)?.call(window)}catch(e){try{localStorage.setItem('atokoreTrialV4',JSON.stringify(s))}catch(_){} }
    lastSnapshot=s;putJSON(SNAP_KEY,s);lastRemoteAt=now();
    try{render()}catch(e){}
    applyingRemote=false;updateFamilyStatus();
  }

  function send(conn,msg){try{if(conn?.open)conn.send(msg)}catch(e){}}
  function broadcast(msg,exceptPeer){
    if(isLeader){memberConns.forEach((c,id)=>{if(id!==exceptPeer)send(c,msg)})}
    else send(leaderConn,msg);
  }
  function handleMsg(msg,conn){
    if(!msg||typeof msg!=='object')return;
    if(msg.type==='hello'){
      if(Array.isArray(msg.ops)){
        const added=dedupeOps(msg.ops);if(added)persistRemoteState();
      }
      send(conn,{type:'hello',deviceId:cfg.deviceId,deviceName:cfg.deviceName,ops,ts:now()});
      updateFamilyStatus();
      return;
    }
    if(msg.type==='ops'){
      const added=dedupeOps(msg.ops);if(added){persistRemoteState();if(isLeader)broadcast(msg,conn?.peer)}
      return;
    }
    if(msg.type==='requestAll'){send(conn,{type:'hello',deviceId:cfg.deviceId,deviceName:cfg.deviceName,ops,ts:now()})}
  }
  function attachConn(conn){
    if(!conn)return;
    conn.on('open',()=>{if(isLeader)memberConns.set(conn.peer,conn);send(conn,{type:'hello',deviceId:cfg.deviceId,deviceName:cfg.deviceName,ops,ts:now()});updateFamilyStatus()});
    conn.on('data',m=>handleMsg(m,conn));
    conn.on('close',()=>{if(isLeader)memberConns.delete(conn.peer);else if(conn===leaderConn){leaderConn=null;scheduleReconnect()}updateFamilyStatus()});
    conn.on('error',()=>updateFamilyStatus());
  }
  function destroyPeer(){try{peer?.destroy()}catch(e){}peer=null;leaderConn=null;memberConns.clear();isLeader=false}
  function scheduleReconnect(){clearTimeout(reconnectTimer);reconnectTimer=setTimeout(()=>{if(cfg)startPeer()},2200)}
  function leaderId(){return `${PEER_PREFIX}${cfg.familyCode.toLowerCase()}`}
  function memberId(){return `${PEER_PREFIX}${cfg.familyCode.toLowerCase()}-${cfg.deviceId.toLowerCase()}`}
  function becomeMember(){
    destroyPeer();
    try{
      peer=new Peer(memberId());isLeader=false;
      peer.on('open',()=>{leaderConn=peer.connect(leaderId(),{reliable:true,serialization:'json'});attachConn(leaderConn);updateFamilyStatus()});
      peer.on('error',e=>{if(e?.type==='unavailable-id'){cfg.deviceId=rnd(6);putJSON(CFG_KEY,cfg);scheduleReconnect()}else scheduleReconnect();updateFamilyStatus()});
      peer.on('disconnected',scheduleReconnect);
    }catch(e){scheduleReconnect()}
  }
  function startPeer(){
    if(!cfg||!window.Peer)return;
    destroyPeer();clearTimeout(reconnectTimer);
    try{
      peer=new Peer(leaderId());isLeader=true;
      peer.on('open',()=>{updateFamilyStatus()});
      peer.on('connection',c=>{if(memberConns.size>=DEVICE_MAX){try{c.close()}catch(e){};return}attachConn(c)});
      peer.on('error',e=>{if(e?.type==='unavailable-id')becomeMember();else {scheduleReconnect();updateFamilyStatus()}});
      peer.on('disconnected',scheduleReconnect);
    }catch(e){becomeMember()}
  }
  function loadPeer(){
    if(window.Peer){startPeer();return}
    const old=document.querySelector('script[data-atk-peer]');if(old)return;
    const s=document.createElement('script');s.src=PEER_SRC;s.async=true;s.dataset.atkPeer='1';s.onload=startPeer;s.onerror=()=>{updateFamilyStatus('通信ライブラリを読み込めません')};document.head.appendChild(s);
  }
  function connectedCount(){return isLeader?memberConns.size:(leaderConn?.open?1:0)}
  function statusText(){if(!cfg)return '未設定';const n=connectedCount();return n>0?`同期中 ${n+1}台`:'接続待ち'}
  function updateFamilyStatus(force){
    const b=document.getElementById('familyShareBtn');if(!b)return;
    b.classList.toggle('familyOnline',!!cfg&&connectedCount()>0);
    b.title=force||`家族共有：${statusText()}`;
    const dot=b.querySelector('.familyDot');if(dot)dot.dataset.on=(!!cfg&&connectedCount()>0)?'1':'0';
  }

  function addStyles(){
    if(document.getElementById('familyStyles'))return;
    const s=document.createElement('style');s.id='familyStyles';s.textContent=`
      .familyShareBtn{position:absolute;right:82px;top:12px;z-index:5;border:1px solid #d8e1eb;background:#fff;border-radius:12px;min-width:38px;height:38px;padding:0 8px;font-size:18px;box-shadow:0 2px 8px #22304710;display:flex;align-items:center;justify-content:center;gap:3px}.familyDot{width:7px;height:7px;border-radius:50%;background:#aab4c2;border:1px solid #fff}.familyDot[data-on='1']{background:#28a36a}.familyShareBtn.familyOnline{background:#eefaf3;border-color:#cfe8d9}.familyCode{font-size:30px;font-weight:950;letter-spacing:.12em;text-align:center;padding:12px;border-radius:14px;background:#f2f6fb;border:1px dashed #b9c7d8}.familyStatusCard{padding:12px;border:1px solid #e0e6ed;border-radius:14px;background:#f8fafc;margin:10px 0}.familyStatusLine{display:flex;justify-content:space-between;gap:10px;align-items:center}.familyStatusPill{font-size:11px;font-weight:900;padding:4px 8px;border-radius:999px;background:#eef2f6}.familyStatusPill.on{background:#e8f8ef;color:#23724d}.familyHelp{font-size:11px;color:#667085;line-height:1.55}.familyJoinGrid{display:grid;grid-template-columns:1fr;gap:8px}.familyJoinGrid input{font-size:16px;padding:12px;border:1px solid #d8dee8;border-radius:12px;width:100%;box-sizing:border-box}
      body.atk-density-ultra .familyShareBtn{top:6px;right:68px;height:31px;min-width:32px;border-radius:9px;font-size:15px}
    `;document.head.appendChild(s);
  }
  function addButton(){
    const top=document.querySelector('.top');if(!top||document.getElementById('familyShareBtn'))return;top.style.position='relative';
    const b=document.createElement('button');b.id='familyShareBtn';b.className='familyShareBtn';b.setAttribute('aria-label','家族共有');b.innerHTML='👥<span class="familyDot"></span>';b.onclick=openFamily;top.appendChild(b);updateFamilyStatus();
  }
  function openFamily(){
    if(!cfg){openM(`<button class="close" onclick="closeM()">閉じる</button><h2>👥 家族共有</h2><div class="familyHelp">夫婦の「あとこれ」を同じ在庫・買い物リストにできます。最初の接続時だけ、2台ともこの画面を開いておいてください。</div><div class="section">新しく家族を作る</div><div class="familyJoinGrid"><input id="familyDeviceName" placeholder="この端末の名前（例：パパ）" value=""><button class="btn" style="width:100%" onclick="createAtokoreFamily()">家族コードを作る</button></div><div class="section">家族コードで参加</div><div class="familyJoinGrid"><input id="familyJoinCode" maxlength="8" placeholder="8文字の家族コード"><input id="familyJoinName" placeholder="この端末の名前（例：ママ）"><button class="btn ghost" style="width:100%" onclick="joinAtokoreFamily()">この家族に参加</button></div>`);return}
    const online=connectedCount()>0;
    openM(`<button class="close" onclick="closeM()">閉じる</button><h2>👥 家族共有</h2><div class="familyStatusCard"><div class="familyStatusLine"><b>${esc(cfg.deviceName||'この端末')}</b><span class="familyStatusPill ${online?'on':''}">${online?'同期中':'接続待ち'}</span></div><div class="meta" style="margin-top:4px">${online?`${connectedCount()+1}台が接続中`:'相手の端末が開くと自動で同期します'}</div></div><div class="section">家族コード</div><div class="familyCode">${esc(cfg.familyCode)}</div><button class="btn" style="width:100%;margin-top:10px" onclick="shareAtokoreFamily()">家族に共有する</button><div class="familyHelp" style="margin-top:10px">奥さん側で同じURLを開き、この家族コードを入力してください。共有開始後は在庫・買い物リスト・いつものリストが同期されます。</div><div class="section">同期</div><button class="btn ghost" style="width:100%" onclick="forceAtokoreFamilySync()">今すぐ同期する</button><button class="btn danger" style="width:100%;margin-top:8px" onclick="leaveAtokoreFamily()">家族共有を解除</button>`)
  }
  function familyLink(){const u=new URL(location.href);u.searchParams.set('family',cfg.familyCode);return u.toString()}
  window.createAtokoreFamily=()=>{
    const name=(document.getElementById('familyDeviceName')?.value||'').trim()||'この端末';
    cfg={familyCode:rnd(8),deviceId:rnd(6),deviceName:name,createdAt:now()};putJSON(CFG_KEY,cfg);ops=[];putJSON(OPS_KEY,ops);lastSnapshot=null;bootstrapOpsFromCurrent();loadPeer();openFamily();
  };
  window.joinAtokoreFamily=()=>{
    const code=codeNorm(document.getElementById('familyJoinCode')?.value||'');if(code.length!==8){alert('8文字の家族コードを入力してください');return}
    const name=(document.getElementById('familyJoinName')?.value||'').trim()||'この端末';
    cfg={familyCode:code,deviceId:rnd(6),deviceName:name,joinedAt:now()};putJSON(CFG_KEY,cfg);ops=[];putJSON(OPS_KEY,ops);lastSnapshot={items:[],buys:[],routines:[]};putJSON(SNAP_KEY,lastSnapshot);loadPeer();openFamily();
  };
  window.shareAtokoreFamily=async()=>{
    if(!cfg)return;const text=`あとこれの家族共有に参加してね。\n家族コード：${cfg.familyCode}\n${familyLink()}`;
    try{if(navigator.share){await navigator.share({title:'あとこれ 家族共有',text,url:familyLink()});return}}catch(e){}
    try{await navigator.clipboard.writeText(text);alert('家族コードとURLをコピーしました')}catch(e){prompt('この内容を送ってください',text)}
  };
  window.forceAtokoreFamilySync=()=>{if(!cfg)return;broadcast({type:'requestAll',from:cfg.deviceId});setTimeout(openFamily,250)};
  window.leaveAtokoreFamily=()=>{if(!confirm('家族共有を解除しますか？\nこの端末の現在の在庫データは残ります。'))return;destroyPeer();cfg=null;ops=[];lastSnapshot=getState();localStorage.removeItem(CFG_KEY);localStorage.removeItem(OPS_KEY);putJSON(SNAP_KEY,lastSnapshot);closeM();updateFamilyStatus()};
  window.openAtokoreFamily=openFamily;

  function autoJoinFromUrl(){
    const q=codeNorm(new URL(location.href).searchParams.get('family')||'');if(cfg||q.length!==8)return;
    setTimeout(()=>{openFamily();const i=document.getElementById('familyJoinCode');if(i)i.value=q;},450)
  }

  function init(){
    addStyles();addButton();wrapSave();if(cfg){bootstrapOpsFromCurrent();loadPeer()}autoJoinFromUrl();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();

  window.__atokoreFamilyCoreV127={diffState,applyOps,codeNorm};
})();
