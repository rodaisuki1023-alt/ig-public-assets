/* Atokore W2 item 8 rules: quantity limits by unit and stock sort orders. Pure functions; no DOM.
 * - Limits: 個・袋・缶・箱・本・パック 999 / 枚 9,999 / g・mL 99,999. Other units (セット, kg, L …)
 *   have no unit limit here and keep each screen's previous limit (fallback).
 * - A quantity already above the limit is kept as it is: other fields can be saved without touching
 *   it and it can be reduced; only raising it (or a new value above the limit) is refused.
 * - Sorts: category -> name (default), newest added first, expiry (overdue -> today -> later -> none),
 *   refill needed first. The priority sorts run across categories.
 */
(function(root){
'use strict';
const LIMITS=Object.freeze({'個':999,'袋':999,'缶':999,'箱':999,'本':999,'パック':999,'枚':9999,'g':99999,'mL':99999,'ml':99999});
const fmt=n=>Number(n).toLocaleString('ja-JP');
function limit(unit,fallback=null){const u=String(unit??'').trim();return Object.prototype.hasOwnProperty.call(LIMITS,u)?LIMITS[u]:fallback}
function canIncrease(qty,unit,step=1,fallback=Infinity){return (Number(qty)||0)+Number(step||1)<=limit(unit,fallback)}
// Message for a refused increase from a control (＋ button).
function limitMessage(unit,fallback){const max=limit(unit,fallback);return '数量の上限は'+fmt(max)+String(unit||'')+'です'}
// Edit check: returns null when allowed, otherwise the message to show.
function checkEdit(next,{unit,before,beforeUnit,min=0,fallback=99999,label='在庫数'}={}){
 const qty=Number(next),max=limit(unit,fallback);
 if(!Number.isSafeInteger(qty)||qty<min)return label+'は'+min+'〜'+fmt(max)+'の整数で入力してください（単位「'+unit+'」の上限）';
 if(qty<=max)return null;
 const prev=Number(before);
 if(String(beforeUnit??unit)===String(unit)&&Number.isSafeInteger(prev)&&qty<=prev)return null;
 if(String(beforeUnit??unit)===String(unit)&&Number.isSafeInteger(prev)&&prev>max)
  return '今の'+label+'（'+fmt(prev)+unit+'）は上限の'+fmt(max)+unit+'を超えています。この数のまま保存するか減らすことはできますが、増やすことはできません。';
 return label+'は'+min+'〜'+fmt(max)+'の整数で入力してください（単位「'+unit+'」の上限）';
}
// Largest value an input may offer: the unit limit, or the kept quantity when it is already higher.
function inputMax(unit,current,fallback=99999){const max=limit(unit,fallback),q=Number(current);return Number.isSafeInteger(q)&&q>max?q:max}

const SORTS=Object.freeze([['category','カテゴリー別'],['added','追加した順（新しい順）'],['expiry','期限が近い順'],['refill','補充が必要な順']]);
const SORT_KEYS=SORTS.map(x=>x[0]);
const sortLabel=key=>(SORTS.find(x=>x[0]===key)||SORTS[0])[1];
const CAT_ORDER=['ベビー','離乳食','食料品','日用品','衛生・薬','子ども','衣類','家電・生活用品','防災','その他'];
function categoryOf(item,isBabyFood){return isBabyFood?.(item)?'離乳食':String(item?.cat||'その他')}
const reorderDefault=x=>{const m=x?.minQty;return m===''||m==null||!Number.isSafeInteger(Number(m))?1:Number(m)};
function daysLeft(exp,today){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(String(exp||'')))return null;
 const [y,m,d]=String(exp).split('-').map(Number),t=today instanceof Date?today:new Date();
 return Math.round((Date.UTC(y,m-1,d)-Date.UTC(t.getFullYear(),t.getMonth(),t.getDate()))/86400000);
}
function sortItems(list,mode,opts={}){
 const rows=(Array.isArray(list)?list:[]).map((item,index)=>({item,index}));
 const order=new Map((opts.registered||list||[]).map((x,i)=>[x,i]));
 const cat=x=>{const c=categoryOf(x,opts.isBabyFood),i=CAT_ORDER.indexOf(c);return i<0?CAT_ORDER.length:i};
 const byCategory=(a,b)=>cat(a.item)-cat(b.item)||categoryOf(a.item,opts.isBabyFood).localeCompare(categoryOf(b.item,opts.isBabyFood),'ja')||
  String(a.item.name||'').localeCompare(String(b.item.name||''),'ja',{numeric:true})||a.index-b.index;
 let cmp=byCategory;
 if(mode==='added')cmp=(a,b)=>(order.get(b.item)??b.index)-(order.get(a.item)??a.index);
 else if(mode==='expiry'){
  const left=x=>daysLeft(x.exp,opts.today);
  cmp=(a,b)=>{const x=left(a.item),y=left(b.item);if(x===null&&y===null)return byCategory(a,b);if(x===null)return 1;if(y===null)return -1;return x-y||byCategory(a,b)};
 }else if(mode==='refill'){
  const at=opts.reorderAt||reorderDefault;
  const need=x=>(Number(x.qty)||0)<=at(x);
  const ratio=x=>{const m=at(x);return m>0?(Number(x.qty)||0)/m:(Number(x.qty)||0)};
  cmp=(a,b)=>{const x=need(a.item),y=need(b.item);if(x!==y)return x?-1:1;if(x)return ratio(a.item)-ratio(b.item)||byCategory(a,b);return byCategory(a,b)};
 }
 return rows.sort(cmp).map(r=>r.item);
}
const api=Object.freeze({LIMITS,limit,canIncrease,limitMessage,checkEdit,inputMax,SORTS,SORT_KEYS,sortLabel,CAT_ORDER,categoryOf,daysLeft,sortItems});
if(typeof module!=='undefined'&&module.exports)module.exports=api;
root.AtokoreStockRules=api;
})(typeof globalThis!=='undefined'?globalThis:this);
