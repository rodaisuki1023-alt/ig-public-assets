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
const dates=Object.freeze({remaining,label});root.AtokoreDates=dates;
if(typeof module!=='undefined'&&module.exports)module.exports=dates;
if(typeof document==='undefined')return;
root.AtokoreConfirm={open(title,description,action,onConfirm){
 document.getElementById('atkConfirm')?.remove();const previous=document.activeElement;
 const overlay=document.createElement('div');overlay.id='atkConfirm';overlay.className='atk-confirm';
 const dialog=document.createElement('section');dialog.setAttribute('role','alertdialog');dialog.setAttribute('aria-modal','true');dialog.setAttribute('aria-labelledby','atkConfirmTitle');dialog.setAttribute('aria-describedby','atkConfirmNote');
 const h=document.createElement('h2');h.id='atkConfirmTitle';h.textContent=title;
 const p=document.createElement('p');p.id='atkConfirmNote';p.textContent=description;
 const status=document.createElement('p');status.setAttribute('role','status');
 const cancel=document.createElement('button');cancel.type='button';cancel.textContent='キャンセル';
 const ok=document.createElement('button');ok.type='button';ok.textContent=action;ok.className='atk-confirm-primary';
 function close(){overlay.remove();previous?.isConnected&&previous.focus()}
 cancel.onclick=close;ok.onclick=async()=>{ok.disabled=true;try{if(await onConfirm()!==false)close();else{status.textContent='保存できませんでした。内容は変更していません。';ok.disabled=false}}catch(e){status.textContent=e.message||'操作を完了できませんでした';ok.disabled=false}};
 overlay.onkeydown=e=>{if(e.key==='Escape'){e.preventDefault();close()}if(e.key==='Tab'){e.preventDefault();(document.activeElement===cancel?ok:cancel).focus()}};
 dialog.append(h,p,status,cancel,ok);overlay.append(dialog);document.body.append(overlay);cancel.focus();
 }};
})(typeof globalThis!=='undefined'?globalThis:this);
