/* Atokore v51 家族の買い物担当: who buys which shopping row, with replies 買えるよ / 今回は難しい.
 * A compact block above the shopping list (rows themselves are untouched). Shown only while sharing
 * and when the server has the reviewed assignment SQL (AtokoreHousehold.assignmentsEnabled()).
 * The server decides: membership, expected revision (a stale screen is refused and refreshed),
 * only the person asked may reply. Nothing here changes stock or the shopping list.
 */
(function(root){
'use strict';
const doc=typeof document!=='undefined'?document:null;if(!doc)return;
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let busy=false,message='',editing=false;
function hh(){return root.AtokoreHousehold}
function list(){try{return Array.isArray(buys)?buys:[]}catch(_){return []}}
function enabled(){const h=hh();return !!h?.assignmentsEnabled?.()&&h.homeState?.().joined===true}
function statusText(a,members,me){
 const who=id=>id===me?'あなた':(members.find(m=>m.id===id)?.name||'家族');
 if(a.response==='declined')return '今回は難しい（担当を決め直してください）';
 if(!a.assignee)return null;
 if(a.response==='accepted')return who(a.assignee)+'が買います';
 return who(a.assignee)+'が担当（返信待ち）';
}
function paint(){
 const anchor=doc.getElementById('buyList');let box=doc.getElementById('atkAssign');
 if(!anchor||!enabled()){box?.remove();return}
 const h=hh(),me=h.myId?.(),members=h.familyMembers?.()||[];
 const rows=list().map(b=>({b,a:h.assignmentFor?.(b.id)})).filter(x=>x.a);
 const shown=rows.filter(x=>statusText(x.a,members,me));
 if(!box){box=doc.createElement('section');box.id='atkAssign';box.className='atk-assign';box.setAttribute('aria-label','家族の買い物担当');anchor.before(box)}
 const lines=shown.map(({b,a})=>{
  const mine=a.assignee===me&&a.response==='pending'&&a.requester!==me;
  return '<li><span class="atk-assign-name">'+esc(b.name)+'</span><span class="atk-assign-state">'+esc(statusText(a,members,me))+'</span>'+
   (mine?'<span class="atk-assign-reply"><button type="button" data-assign-reply="accept" data-buy="'+Number(b.id)+'">買えるよ</button><button type="button" class="ghost" data-assign-reply="decline" data-buy="'+Number(b.id)+'">今回は難しい</button></span>':'')+'</li>';
 }).join('');
 const opts=a=>'<option value="">担当なし</option>'+members.map(m=>'<option value="'+esc(m.id)+'"'+(a.assignee===m.id?' selected':'')+'>'+esc(m.id===me?'自分':m.name)+'</option>').join('');
 const editor=editing?'<ul class="atk-assign-edit">'+rows.map(({b,a})=>'<li><span class="atk-assign-name">'+esc(b.name)+'</span><select data-assign-to="'+Number(b.id)+'" aria-label="'+esc(b.name)+'の担当"'+(busy?' disabled':'')+'>'+opts(a)+'</select></li>').join('')+'</ul>':'';
 box.innerHTML='<div class="atk-assign-head"><b>家族の買い物担当</b><button type="button" class="atk-assign-toggle" data-assign-edit aria-expanded="'+editing+'">'+(editing?'閉じる':'担当を決める')+'</button></div>'+
  (lines?'<ul class="atk-assign-list">'+lines+'</ul>':(editing?'':'<p class="atk-assign-note">まだ担当はありません。</p>'))+editor+
  (message?'<p class="atk-assign-msg" role="status">'+esc(message)+'</p>':'');
}
async function run(task){
 if(busy)return;busy=true;paint();
 try{const r=await task();message=r?.status==='stale'?'家族が先に変更しました。最新の担当を表示しています。':r?.status==='denied'?'この操作はできません（担当の人だけが返事できます）。':r?.status==='gone'?'この買い物はもうリストにありません。':''}
 catch(e){message=String(e?.message||'担当を変更できませんでした。通信を確認してください。')}
 finally{busy=false;paint()}
}
doc.addEventListener('click',e=>{
 const t=e.target.closest?.('[data-assign-edit],[data-assign-reply]');if(!t||!doc.getElementById('atkAssign')?.contains(t))return;
 if(t.hasAttribute('data-assign-edit')){editing=!editing;message='';paint();return}
 const id=Number(t.dataset.buy),decision=t.dataset.assignReply;
 run(()=>hh().respondBuy(id,decision));
});
doc.addEventListener('change',e=>{
 const t=e.target;if(!t.matches?.('[data-assign-to]')||!doc.getElementById('atkAssign')?.contains(t))return;
 run(()=>hh().assignBuy(Number(t.dataset.assignTo),t.value||null));
});
doc.addEventListener('atokore-assignments-updated',()=>{if(!busy)paint()});
doc.addEventListener('atokore-household-updated',()=>{if(!busy)paint()});
const base=root.renderBuy;
if(typeof base==='function')root.renderBuy=function(...args){const r=base.apply(this,args);try{paint()}catch(err){console.error('あとこれ: 担当',err)}return r};
paint();
root.AtokoreAssignUI=Object.freeze({refresh:paint,statusText});
})(typeof globalThis!=='undefined'?globalThis:this);
