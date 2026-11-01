/* あとこれ v48.2 - 買い物リストの重複に気づける表示（表示だけで、数量・行は一切変更しない）
 * 家族2人がほぼ同時に同じ商品を追加すると、同期後に2行になることがある。自動で合算・削除すると
 * 意図した2行まで消えるため、ここでは知らせるだけにする。
 * 「同じ商品」の考え方は stability.js の sameProduct と同じ（名前と単位が同じ。カテゴリーは両方に
 * ある時だけ比べる）。カテゴリーがない行は判定に足りないので「重複の可能性」と書き、断定しない。
 * 名前は空白と全角半角の違いだけをそろえる。サイズ違い（M／L など名前の違い）は別の商品のまま。
 */
(function(root){
'use strict';

function normName(name){return String(name==null?'':name).normalize('NFKC').replace(/\s+/g,' ').trim()}
function unitOf(item){return normName(item&&item.unit)||'個'}
function catOf(item){return normName(item&&item.cat)}

// Returns groups of 2+ shopping rows that may be the same product.
// certain=true: the rows have the same name, unit and (non-empty) category.
// certain=false: same name and unit, but a row has no category, so whether they are the same product
// cannot be decided ("重複の可能性"). Rows whose categories differ are never put in a certain group.
function findDuplicateGroups(list){
  const byKey=new Map();
  for(const item of Array.isArray(list)?list:[]){
    const name=normName(item&&item.name);
    if(!name)continue;
    const key=name+'\u0000'+unitOf(item);
    if(!byKey.has(key))byKey.set(key,[]);
    byKey.get(key).push(item);
  }
  const groups=[];
  const group=(rows,certain)=>({name:normName(rows[0].name),unit:unitOf(rows[0]),ids:rows.map(r=>String(r.id)),certain});
  for(const rows of byKey.values()){
    if(rows.length<2)continue;
    const uncategorized=rows.filter(r=>!catOf(r));
    const cats=[...new Set(rows.map(catOf).filter(Boolean))];
    if(uncategorized.length)groups.push(group(rows,false));
    for(const cat of cats){
      const same=rows.filter(r=>catOf(r)===cat);
      if(same.length>=2)groups.push(group(same,true));
    }
  }
  return groups;
}

function noticeText(groups){
  const certain=groups.filter(g=>g.certain),maybe=groups.filter(g=>!g.certain);
  const names=g=>g.map(x=>x.name+'（'+x.ids.length+'行）').join('、');
  const parts=[];
  if(certain.length)parts.push('同じ名前・単位の商品が複数あります：'+names(certain)+'。');
  if(maybe.length)parts.push('重複の可能性があります（カテゴリーが未設定の行があり、同じ商品か判断できません）：'+names(maybe)+'。');
  parts.push('必要に応じて確認してください。数量や行は自動で変更しません。');
  return parts.join('');
}

function decorate(doc){
  const list=doc&&doc.getElementById('buyList');
  if(!list)return;
  let records=[];
  try{records=typeof buys!=='undefined'&&Array.isArray(buys)?buys:[]}catch(_){records=[]}
  const groups=findDuplicateGroups(records);
  let notice=doc.getElementById('atkBuyDupNotice');
  if(!groups.length){
    if(notice)notice.remove();
  }else{
    if(!notice){
      notice=doc.createElement('p');
      notice.id='atkBuyDupNotice';
      notice.className='atk-buy-dup-notice';
      notice.setAttribute('role','status');
      list.parentNode.insertBefore(notice,list);
    }
    notice.textContent=noticeText(groups);
  }
  // A row in a certain group is tagged as such even if it is also in a "maybe" group.
  const marked=new Map();
  for(const g of groups)for(const id of g.ids)marked.set(id,marked.get(id)===true||g.certain);
  for(const row of list.querySelectorAll('[data-buy-id]')){
    const certain=marked.get(row.dataset.buyId);
    let tag=row.querySelector('.atk-buy-dup-tag');
    if(certain===undefined){if(tag)tag.remove();continue}
    if(!tag){
      tag=doc.createElement('span');
      tag.className='atk-buy-dup-tag';
      // Below the name row, not inside it: inside the flex row it squeezed the name on narrow screens.
      const anchor=row.querySelector('.stableBuyHead')||row.querySelector('.name');
      if(anchor)anchor.insertAdjacentElement('afterend',tag);else continue;
    }
    tag.textContent=certain?'同じ商品が複数行':'重複の可能性';
  }
}

if(typeof module!=='undefined'&&module.exports)module.exports={findDuplicateGroups,noticeText,decorate,normName};
if(!root||!root.document)return;
const oldBuy=root.renderBuy;
if(typeof oldBuy==='function')root.renderBuy=function(...args){const value=oldBuy.apply(this,args);try{decorate(root.document)}catch(e){console.error('あとこれ: 重複の表示',e)}return value};
try{decorate(root.document)}catch(_){}
})(typeof window!=='undefined'?window:globalThis);
