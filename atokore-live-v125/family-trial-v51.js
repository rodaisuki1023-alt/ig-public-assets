/* Atokore v51: 家族機能の試用（合成データ）on the お試し page. Everything here is synthetic and stays on
 * this device: two made-up members (パパ／ママ), a made-up shopping list, two children at two daycares
 * and tomorrow's preparation. It never reads or writes the person's real stock, shopping list or
 * family sharing, never calls a server and never sends a notification.
 * It runs the reviewed rules the server drafts follow (family-prep-v51.js: assignmentPlan,
 * assignmentResponsePlan, planDay, shortagePlan; notify-policy-v51.js: plan), so what the trial shows
 * is what the real feature would decide. */
(function(root){
'use strict';
const doc=typeof document!=='undefined'?document:null;if(!doc)return;
const F=root.AtokorePrepProposal,N=root.AtokoreNotifyPolicy;if(!F||!N)return;
const KEY='atokoreFamilyTrialV1',HH='qa-family',P='qa-papa',M='qa-mama';
const NAME={[P]:'パパ',[M]:'ママ'};
const KIND={refill:'補充の予測',prep:'明日の保育園準備','assignment':'買い物のお願い','assignment-response':'お願いへの返事'};
const WHY={own_action:'自分の操作なので送りません',turned_off:'この種類をオフにしています',expired:'古いので送りません',settled:'解決済みなので送りません',
 same_subject:'同じ内容は1回だけ',duplicate:'同じ通知は1回だけ',quiet_hours:'夜間（21時〜7時）なので朝7時に',daily_cap:'1日3件までなので翌朝に',min_gap:'30分あけてから',left:'家族から抜けたので送りません'};
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const JST=540*60000;
const dayOf=ms=>new Date(ms+JST).toISOString().slice(0,10);
const atHour=(ms,h)=>{const d=new Date(ms+JST);d.setUTCHours(h,0,0,0);return d.getTime()-JST};

function fresh(now=Date.now()){
 const t=atHour(now,18);
 return {v:1,viewer:M,mamaLeft:false,now:t,seq:1,
  stock:[{id:'s-diaper-m',name:'おむつ M',unit:'枚',qty:4},{id:'s-diaper-s',name:'おむつ S',unit:'枚',qty:10},{id:'s-clothes',name:'着替えセット',unit:'組',qty:1},{id:'s-sheet',name:'お昼寝シーツ',unit:'枚',qty:1},{id:'s-milk',name:'ミルク缶',unit:'缶',qty:0}],
  buys:[{id:'b-wipes',name:'おしりふき',qty:1,unit:'パック',stockId:null,assignee:null,requester:null,response:'none',rev:0,bought:false},
   {id:'b-milk',name:'ミルク缶',qty:1,unit:'缶',stockId:'s-milk',assignee:null,requester:null,response:'none',rev:0,bought:false}],
  children:[{id:'c1',name:'上の子',place:'さくら保育園',prepBy:M},{id:'c2',name:'下の子',place:'ひまわり園',prepBy:P}],
  ticks:[],
  // Two refill predictions (diapers, milk) as the estimate would raise them.
  events:[{id:'refill-diaper-m-'+dayOf(t),kind:'refill',recipientId:M,at:t-3600000,subject:'s-diaper-m'},{id:'refill-diaper-m-p-'+dayOf(t),kind:'refill',recipientId:P,at:t-3600000,subject:'s-diaper-m'},
   {id:'refill-milk-'+dayOf(t),kind:'refill',recipientId:M,at:t-1800000,subject:'s-milk'}],
  sent:[],prefs:{[P]:{},[M]:{}},log:[]};
}
let s=load();
function load(){try{const v=JSON.parse(root.localStorage.getItem(KEY)||'null');if(v&&v.v===1&&Array.isArray(v.buys))return v}catch(_){}return fresh()}
function save(){try{root.localStorage.setItem(KEY,JSON.stringify(s))}catch(_){note('この端末に試用の状態を保存できませんでした（表示はそのまま使えます）')}}
let lastNote='';
function note(t){lastNote=t}
const members=()=>[{id:P,householdId:HH,active:true},{id:M,householdId:HH,active:!s.mamaLeft}];
const active=id=>members().some(m=>m.id===id&&m.active);
const tomorrow=()=>dayOf(s.now+86400000);
// Tomorrow's rows per child (weekday rows of the made-up week), with the stock each one uses.
function profiles(){
 const rows={c1:[{id:'r-diaper',name:'おむつ M',required:5,unit:'枚',stockId:'s-diaper-m'},{id:'r-clothes',name:'着替えセット',required:2,unit:'組',stockId:'s-clothes'},{id:'r-note',name:'連絡帳',required:1,unit:'冊',stockId:'s-note'}],
  c2:[{id:'r-diaper',name:'おむつ S',required:5,unit:'枚',stockId:'s-diaper-s'},{id:'r-sheet',name:'お昼寝シーツ',required:1,unit:'枚',stockId:'s-sheet'}]};
 const all=[0,1,2,3,4,5,6].reduce((o,d)=>(o[d]=null,o),{});
 return s.children.map(c=>({id:c.id,week:Object.fromEntries(Object.keys(all).map(d=>[d,rows[c.id]]))}));
}
function plan(){
 const rows=F.planDay(profiles(),tomorrow());
 const shortage=F.shortagePlan(rows.filter(r=>r.stockId!=='s-note'),s.stock,s.buys.filter(b=>!b.bought&&b.stockId));
 return {rows,shortage};
}
function childDone(id,rows){const mine=rows.filter(r=>r.profileId===id);return mine.length>0&&mine.every(r=>s.ticks.includes(r.instanceId))}
function event(e){if(e)s.events.push({...e,actorId:s.viewer,at:s.now})}
// --- actions (each one goes through the reviewed rule; a refusal is shown, never ignored)
function assign(id,to){
 const b=s.buys.find(x=>x.id===id);if(!b||b.bought)return;
 const assignee=to||null,current=b.assignee&&active(b.assignee)?b.assignee:null;
 const r=F.assignmentPlan({householdId:HH,buyId:b.id,actorId:s.viewer,assigneeId:assignee,currentAssigneeId:b.response==='declined'?'(declined)':current,revision:b.rev,members:members()});
 if(r.status==='denied')return note('この人には頼めません（家族から抜けています）');
 if(r.status==='unchanged')return note('担当は変わりません');
 Object.assign(b,{assignee,requester:s.viewer,rev:r.revision,response:assignee===null?'none':assignee===s.viewer?'accepted':'pending'});
 event(r.event?{...r.event,subject:b.id}:null);
 note(assignee===null?b.name+'の担当を外しました':assignee===s.viewer?b.name+'は自分で買います':NAME[assignee]+'に'+b.name+'を頼みました');
}
function respond(id,decision){
 const b=s.buys.find(x=>x.id===id);if(!b)return;
 const r=F.assignmentResponsePlan({householdId:HH,buyId:b.id,actorId:s.viewer,assigneeId:b.assignee||'-',requesterId:b.requester||'-',revision:b.rev,expectedRevision:b.rev,response:b.response,decision,members:members()});
 if(r.status!=='ready')return note(r.status==='stale'?'もう返事が済んでいます':'返事できません（頼んだ人が家族にいません）');
 Object.assign(b,{assignee:r.assigneeId,rev:r.revision,response:r.response});
 event({...r.event,subject:b.id});
 note(decision==='accept'?'「買えるよ」と返事しました':'「今回は難しい」と返事しました（担当は空きになりました）');
}
function bought(id){
 const b=s.buys.find(x=>x.id===id);if(!b||b.bought)return;
 b.bought=true;
 const st=b.stockId&&s.stock.find(x=>x.id===b.stockId);
 if(st&&st.unit===b.unit)st.qty+=b.qty;
 note(b.name+'を買いました'+(st?'（試用の在庫に'+b.qty+b.unit+'追加。明日の準備の不足も見直しました）':''));
}
function addShortage(stockId){
 const {shortage}=plan(),g=shortage.items.find(x=>x.stockId===stockId);
 if(!g||!(g.additional>0))return note('買い物リストに追加する分はありません');
 s.buys.push({id:'b-'+stockId+'-'+(s.seq++),name:g.name,qty:g.additional,unit:g.unit,stockId,assignee:null,requester:null,response:'none',rev:0,bought:false,fromPrep:true});
 note(g.name+'を'+g.additional+g.unit+'、買い物リストに追加しました（明日の準備の不足分）');
}
function setPrepBy(child,who){
 const c=s.children.find(x=>x.id===child);if(!c||!active(who))return note('この人には任せられません');
 if(c.prepBy===who)return;
 c.prepBy=who;   // tomorrow's reminder now goes to the new person (made in preview())
 note(c.name+'（'+c.place+'）の準備は'+NAME[who]+'の担当になりました');
}
// What the viewer's phone would show now, by the notification rules.
function preview(){
 const me=s.viewer,{rows}=plan();
 const current=e=>{
  if(e.kind==='assignment'){const b=s.buys.find(x=>x.id===e.subject);return !!b&&!b.bought&&b.assignee===e.recipientId&&b.response==='pending'}
  if(e.kind==='assignment-response'){const b=s.buys.find(x=>x.id===e.subject);return !!b&&!b.bought}
  if(e.kind==='prep'){const c=s.children.find(x=>x.id===e.subject);return !!c&&c.prepBy===e.recipientId&&!childDone(c.id,rows)}
  if(e.kind==='refill'){const st=s.stock.find(x=>x.id===e.subject);return !!st&&st.qty<=(st.unit==='枚'?20:0)}
  return false;
 };
 // Tomorrow's preparation reminder for whoever is in charge (made fresh each evening).
 const prepEvents=s.children.map(c=>({id:'prep-'+c.id+'-'+tomorrow()+'-'+c.prepBy,kind:'prep',recipientId:c.prepBy,at:s.now,subject:c.id}));
 const mine=[...s.events,...prepEvents].filter(e=>e.recipientId===me);
 if(me===M&&s.mamaLeft)return {left:true,send:[],defer:[],drop:mine.map(e=>({id:e.id,reason:'left'})),events:mine};
 return {...N.plan({events:mine,sent:s.sent,prefs:s.prefs,now:s.now,isCurrent:current}),events:mine};
}
// --- view
function html(){
 const me=s.viewer,{rows,shortage}=plan(),pv=preview();
 const btn=(attr,label,extra='')=>'<button type="button" '+attr+extra+'>'+esc(label)+'</button>';
 const who=id=>id?NAME[id]+(id===M&&s.mamaLeft?'（抜けた）':''):'なし';
 const buyRows=s.buys.map(b=>{
  // Who asked, in words that read naturally from this phone (never "なしへの返事").
  const asker=b.requester===me?'あなた':b.requester?NAME[b.requester]||'家族':'家族';
  const state=b.bought?'買いました':b.assignee?who(b.assignee)+'：'+({pending:'返事待ち',accepted:'買えるよ',declined:'今回は難しい'}[b.response]||''):b.response==='declined'?'担当なし（'+asker+'のお願いに「今回は難しい」と返事がありました）':'担当なし';
  const mineToAnswer=!b.bought&&b.assignee===me&&b.response==='pending'&&b.requester!==me;
  return '<li class="atk-ft-row'+(b.bought?' is-done':'')+'"><div class="atk-ft-name"><b>'+esc(b.name)+'</b> '+b.qty+esc(b.unit)+(b.fromPrep?'<small>明日の準備の不足分</small>':'')+'</div><p class="atk-ft-state">担当：'+esc(state)+'</p>'+
   (b.bought?'':'<div class="atk-ft-actions">'+
    (mineToAnswer?btn('data-ft-respond="'+b.id+'|accept"','買えるよ',' class="atk-ft-primary"')+btn('data-ft-respond="'+b.id+'|decline"','今回は難しい'):'')+
    '<label class="atk-ft-select">頼む人<select data-ft-assign="'+b.id+'"><option value="">なし</option><option value="'+P+'"'+(b.assignee===P?' selected':'')+'>パパ</option><option value="'+M+'"'+(b.assignee===M?' selected':'')+(s.mamaLeft?' disabled':'')+'>ママ'+(s.mamaLeft?'（抜けました）':'')+'</option></select></label>'+
    btn('data-ft-bought="'+b.id+'"','買った')+'</div>')+'</li>';
 }).join('');
 const prep=s.children.map(c=>{
  const mine=rows.filter(r=>r.profileId===c.id),done=childDone(c.id,rows);
  return '<li class="atk-ft-child"><div class="atk-ft-name"><b>'+esc(c.name)+'</b><small>'+esc(c.place)+'</small></div>'+
   '<label class="atk-ft-select">準備の担当<select data-ft-prepby="'+c.id+'"><option value="'+P+'"'+(c.prepBy===P?' selected':'')+'>パパ</option><option value="'+M+'"'+(c.prepBy===M?' selected':'')+(s.mamaLeft?' disabled':'')+'>ママ</option></select></label>'+
   '<ul class="atk-ft-ticks">'+mine.map(r=>{const g=shortage.items.find(x=>x.instances.includes(r.instanceId));const short=g&&g.status!=='enough';
    return '<li><label><input type="checkbox" data-ft-tick="'+esc(r.instanceId)+'"'+(s.ticks.includes(r.instanceId)?' checked':'')+'><span>'+esc(r.name)+' '+r.required+esc(r.unit)+(short?'<em>在庫が足りません</em>':'')+'</span></label></li>'}).join('')+'</ul>'+
   '<p class="atk-ft-state">'+(done?'準備：完了':'準備：あと'+mine.filter(r=>!s.ticks.includes(r.instanceId)).length+'つ')+'</p></li>';
 }).join('');
 const short=shortage.items.filter(g=>g.status!=='enough').map(g=>'<li><span>'+esc(g.name)+'：明日は'+g.required+esc(g.unit)+'、在庫'+g.available+esc(g.unit)+
  (g.status==='queued'?'（買い物リストに'+g.queued+esc(g.unit)+'あり）':'')+'</span>'+(g.additional>0?btn('data-ft-addshort="'+esc(g.stockId)+'"','不足の'+g.additional+g.unit+'を買い物に追加'):'')+'</li>').join('')||'<li>不足はありません</li>';
 const kindToggle=k=>'<label class="atk-ft-check"><input type="checkbox" data-ft-pref="'+k+'"'+(s.prefs[me]?.[k]===false?'':' checked')+(s.prefs[me]?.all===false?' disabled':'')+'><span>'+KIND[k]+'</span></label>';
 const time=new Date(s.now+JST);
 const ev=id=>pv.events.find(y=>y.id===id);
 const each=ids=>'<ul class="atk-ft-each">'+ids.map(id=>{const e=ev(id);return '<li>'+esc(KIND[e?.kind]||'')+'：'+esc(N.GENERIC[e?.kind]||'')+'</li>'}).join('')+'</ul>';
 const hm=ms=>{const d=new Date(ms+JST);return (d.getUTCMonth()+1)+'/'+d.getUTCDate()+' '+String(d.getUTCHours()).padStart(2,'0')+':'+String(d.getUTCMinutes()).padStart(2,'0')};
 const notes=[...pv.send.map(x=>'<li class="atk-ft-send"><b>届く：</b>'+esc(x.body)+'<small>（'+(x.ids.length>1?x.ids.length+'件をまとめて1通':'1通')+'・ロック画面には商品名を出しません）</small>'+each(x.ids)+'</li>'),
  ...pv.defer.map(x=>'<li class="atk-ft-defer"><b>あとで：</b>'+x.ids.length+'件 — '+esc(WHY[x.reason]||x.reason)+'<small>（'+esc(hm(x.until))+' に届く予定）</small>'+each(x.ids)+'</li>'),
  ...pv.drop.map(x=>{const e=pv.events.find(y=>y.id===x.id);return '<li class="atk-ft-drop"><b>送らない：</b>'+esc(KIND[e?.kind]||'')+' — '+esc(WHY[x.reason]||x.reason)+'</li>'})].join('')||'<li>いま届く通知はありません</li>';
 return '<p class="atk-ft-banner" role="note">【試用・合成データ】この端末の中だけで動きます。実際の家族共有、在庫・買い物リストの変更、通知の送信は行いません。</p>'+
  (lastNote?'<p class="atk-ft-note" role="status">'+esc(lastNote)+'</p>':'<p class="atk-ft-note" role="status"></p>')+
  '<div class="atk-ft-viewer" role="group" aria-label="表示する人">'+btn('data-ft-viewer="'+P+'" aria-pressed="'+(me===P)+'"','パパの画面')+btn('data-ft-viewer="'+M+'" aria-pressed="'+(me===M)+'"','ママの画面')+'</div>'+
  '<label class="atk-ft-check"><input type="checkbox" data-ft-left'+(s.mamaLeft?' checked':'')+'><span>ママが家族から抜けた（試用）</span></label>'+
  '<h4>買い物と担当</h4><ul class="atk-ft-list">'+buyRows+'</ul>'+
  '<h4>明日（'+esc(tomorrow().slice(5).replace('-','/'))+'）の保育園の準備</h4><ul class="atk-ft-list">'+prep+'</ul>'+
  '<h4>準備に足りない物</h4><ul class="atk-ft-short">'+short+'</ul>'+
  '<h4>'+NAME[me]+'のスマホに届く通知（プレビュー）</h4>'+
  '<div class="atk-ft-time"><span>試用の時刻：'+(time.getUTCMonth()+1)+'/'+time.getUTCDate()+' '+String(time.getUTCHours()).padStart(2,'0')+':00</span>'+
   [8,12,18,22].map(h=>btn('data-ft-hour="'+h+'"',h+'時')).join('')+'</div>'+
  '<label class="atk-ft-check"><input type="checkbox" data-ft-all'+(s.prefs[me]?.all===false?'':' checked')+'><span>通知を受け取る</span></label>'+
  '<div class="atk-ft-kinds">'+['refill','prep','assignment','assignment-response'].map(kindToggle).join('')+'</div>'+
  '<ul class="atk-ft-notes" aria-live="polite">'+notes+'</ul>'+
  (pv.send.length?btn('data-ft-deliver','届いたことにする（試用）'):'')+
  '<p class="atk-ft-help">夜間（21時〜7時）は朝まで待ちます。1日3件まで、30分あけて、同じ内容は1回、自分の操作・解決済み・古いものは送りません。</p>'+
  btn('data-ft-reset','合成データを最初に戻す',' class="atk-ft-reset"');
}
function render(){
 const page=doc.getElementById('pg-premium');if(!page)return;
 let box=doc.getElementById('atkFamilyTrial');
 if(!box){box=doc.createElement('details');box.id='atkFamilyTrial';box.className='atk-ftrial';
  box.innerHTML='<summary>家族機能の試用（合成データ）</summary><div class="atk-ft-body"></div>';
  const anchor=doc.getElementById('atkPhotoPreview')||doc.getElementById('atkBuildInfo');if(anchor)anchor.before(box);else page.append(box)}
 box.querySelector('.atk-ft-body').innerHTML=html();
}
doc.addEventListener('click',e=>{
 const t=e.target.closest?.('#atkFamilyTrial [data-ft-viewer],#atkFamilyTrial [data-ft-respond],#atkFamilyTrial [data-ft-bought],#atkFamilyTrial [data-ft-addshort],#atkFamilyTrial [data-ft-hour],#atkFamilyTrial [data-ft-deliver],#atkFamilyTrial [data-ft-reset]');if(!t)return;
 lastNote='';
 if(t.dataset.ftViewer){s.viewer=t.dataset.ftViewer;note(NAME[s.viewer]+'の画面を表示しています')}
 else if(t.dataset.ftRespond){const [id,d]=t.dataset.ftRespond.split('|');respond(id,d)}
 else if(t.dataset.ftBought)bought(t.dataset.ftBought);
 else if(t.dataset.ftAddshort)addShortage(t.dataset.ftAddshort);
 else if(t.dataset.ftHour){const h=Number(t.dataset.ftHour);let n=atHour(s.now,h);if(n<=s.now)n+=86400000;s.now=n;note('試用の時刻を'+h+'時に進めました')}
 else if(t.hasAttribute('data-ft-deliver')){const pv=preview();for(const x of pv.send)for(const id of x.ids)s.sent.push({id,recipientId:x.recipientId,at:s.now});s.now+=31*60000;note(pv.send.length+'通を届いたことにしました（試用）。時刻を31分進めました')}
 else if(t.hasAttribute('data-ft-reset')){s=fresh();note('合成データを最初に戻しました')}
 save();render();
});
doc.addEventListener('change',e=>{
 const t=e.target;if(!t.closest?.('#atkFamilyTrial'))return;
 lastNote='';
 if(t.dataset.ftAssign!=null)assign(t.dataset.ftAssign,t.value);
 else if(t.dataset.ftPrepby)setPrepBy(t.dataset.ftPrepby,t.value);
 else if(t.dataset.ftTick){const id=t.dataset.ftTick;s.ticks=t.checked?[...new Set([...s.ticks,id])]:s.ticks.filter(x=>x!==id)}
 else if(t.hasAttribute('data-ft-left')){
  if(!t.checked){s.mamaLeft=false;save();render();return}
  // Before leaving, say what will happen (as the real app's leave confirmation does).
  t.checked=false;
  const asked=s.buys.filter(b=>!b.bought&&b.assignee===M).length,requested=s.buys.filter(b=>!b.bought&&b.requester===M&&b.response==='pending').length,prep=s.children.filter(c=>c.prepBy===M).map(c=>c.name);
  const text='ママが家族から抜けると：'+(asked?'ママが頼まれていた買い物'+asked+'件の担当が外れます。':'')+(requested?'ママが頼んで返事がまだのお願い'+requested+'件は取り下げられます。':'')+(prep.length?prep.join('・')+'の準備の担当はパパになります。':'')+'まだ届いていない通知は送られません。（試用・合成データ）';
  const apply=()=>{s.mamaLeft=true;
   // What ママ was asked to buy is released and the preparation goes to パパ (as the server does).
   for(const b of s.buys)if(!b.bought&&(b.assignee===M||(b.requester===M&&b.response==='pending')))Object.assign(b,{assignee:null,response:'none',rev:b.rev+1});
   for(const c of s.children)if(c.prepBy===M)c.prepBy=P;if(s.viewer===M)s.viewer=P;note('ママが抜けた場合：担当と準備はパパに戻り、ママへの通知は送りません');save();render()};
  const ask=root.AtokoreConfirm?.ask;
  if(typeof ask==='function'){ask('ママが抜けた場合を試しますか？',text,'抜けた場合を試す').then(ok=>{if(ok)apply()});return}
  apply();return;
 }
 else if(t.hasAttribute('data-ft-all')){s.prefs[s.viewer]={...s.prefs[s.viewer],all:t.checked}}
 else if(t.dataset.ftPref){s.prefs[s.viewer]={...s.prefs[s.viewer],[t.dataset.ftPref]:t.checked}}
 save();render();
});
render();
root.AtokoreFamilyTrial=Object.freeze({state:()=>JSON.parse(JSON.stringify(s)),preview:()=>preview(),render});
})(typeof globalThis!=='undefined'?globalThis:this);
