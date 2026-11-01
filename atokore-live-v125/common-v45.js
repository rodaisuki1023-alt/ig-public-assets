/* Calendar dates and app confirmations shared across screens. */
(function(root){
'use strict';
function remaining(value,now=new Date()){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(value||''))return null;
 const [y,m,d]=value.split('-').map(Number),t=new Date(y,m-1,d);
 if(t.getFullYear()!==y||t.getMonth()!==m-1||t.getDate()!==d)return null;
 return Math.round((Date.UTC(y,m-1,d)-Date.UTC(now.getFullYear(),now.getMonth(),now.getDate()))/86400000);
}
function label(value,now){const n=remaining(value,now);if(n===null)return '';const [,m,d]=value.split('-').map(Number);return (n<0?'期限を'+Math.abs(n)+'日超過':n===0?'今日まで':'あと'+n+'日')+'（'+m+'/'+d+'まで）'}
function localDate(now=new Date()){return [now.getFullYear(),String(now.getMonth()+1).padStart(2,'0'),String(now.getDate()).padStart(2,'0')].join('-')}
const dates=Object.freeze({remaining,label,localDate});root.AtokoreDates=dates;
if(typeof module!=='undefined'&&module.exports)module.exports=dates;
if(typeof document==='undefined')return;
root.AtokoreNotices={
 hide(){document.querySelectorAll('#qaNotice,#stableToastV125h').forEach(n=>n.classList.remove('on'))},
 show(node,duration){this.hide();clearTimeout(node._atkNoticeTimer);const undo=document.getElementById('atkUndoBar');node.style.bottom=undo?(root.innerHeight-undo.getBoundingClientRect().top+8)+'px':'';node.classList.add('on');node._atkNoticeTimer=setTimeout(()=>node.classList.remove('on'),duration)}
};
// The app's own confirmation. Native confirm() is never used: some in-app browsers, embedded frames
// and review tools suppress it without UI and it then returns false, so the action looks dead.
root.AtokoreConfirm={open(title,description,action,onConfirm,onCancel){
 const prior=document.getElementById('atkConfirm');if(prior){prior.remove();prior._atkCancel?.()}
 const previous=document.activeElement;
 const overlay=document.createElement('div');overlay.id='atkConfirm';overlay.className='atk-confirm';
 const dialog=document.createElement('section');dialog.setAttribute('role','alertdialog');dialog.setAttribute('aria-modal','true');dialog.setAttribute('aria-labelledby','atkConfirmTitle');dialog.setAttribute('aria-describedby','atkConfirmNote');
 const h=document.createElement('h2');h.id='atkConfirmTitle';h.textContent=title;
 const p=document.createElement('p');p.id='atkConfirmNote';p.textContent=description;
 const status=document.createElement('p');status.setAttribute('role','status');
 const cancel=document.createElement('button');cancel.type='button';cancel.textContent='キャンセル';
 const ok=document.createElement('button');ok.type='button';ok.textContent=action;ok.className='atk-confirm-primary';
 // Cancelled (button, Escape, or replaced by another confirmation) reports once to onCancel.
 overlay._atkCancel=()=>{overlay._atkCancel=null;onCancel?.()};
 function close(){overlay.remove();previous?.isConnected&&previous.focus()}
 function dismiss(){close();overlay._atkCancel?.()}
 cancel.onclick=dismiss;ok.onclick=async()=>{ok.disabled=true;try{if(await onConfirm()!==false){overlay._atkCancel=null;close()}else{status.textContent='保存できませんでした。内容は変更していません。';ok.disabled=false}}catch(e){status.textContent=e.message||'操作を完了できませんでした';ok.disabled=false}};
 overlay.onkeydown=e=>{if(e.key==='Escape'){e.preventDefault();dismiss()}if(e.key==='Tab'){e.preventDefault();(document.activeElement===cancel?ok:cancel).focus()}};
 dialog.append(h,p,status,cancel,ok);overlay.append(dialog);document.body.append(overlay);cancel.focus();
 },
 // Resolves true when the person chose the action, false when they cancelled.
 ask(title,description,action){return new Promise(resolve=>root.AtokoreConfirm.open(title,description,action,()=>{resolve(true)},()=>resolve(false)))},
 // A notice with a single button, for messages that need no choice.
 tell(title,description='',action='OK'){
  root.AtokoreConfirm.open(title,description,action,()=>true);
  const overlay=document.getElementById('atkConfirm'),ok=overlay?.querySelector('.atk-confirm-primary');if(!overlay||!ok)return;
  overlay.querySelector('button:not(.atk-confirm-primary)')?.remove();
  overlay.classList.add('atk-confirm-notice');
  overlay.onkeydown=e=>{if(e.key==='Escape'){e.preventDefault();ok.click()}if(e.key==='Tab'){e.preventDefault();ok.focus()}};
  ok.focus();
 }
};
// Messages that still call alert() (validation, "could not complete", older screens) are shown in the
// app too: where the native dialog is suppressed the person would otherwise get no answer at all.
root.alert=message=>root.AtokoreConfirm.tell(String(message??''));
})(typeof globalThis!=='undefined'?globalThis:this);
