/* Atokore v38 receipt matching — pure logic, no network.
 * Receipt lines are abbreviated ("ﾊﾟﾝﾊﾟｰｽ ｻﾗｻﾗ ﾃｰﾌﾟM 60ﾏｲ"). This suggests products already in stock,
 * but never across a different size, form (tape/pants), content amount or brand: those are
 * different products even when the names look alike. A match the family confirmed once is stored on
 * the product itself (item.receiptAliases), so it is offered first next time and travels with the
 * product when the household shares data.
 */
(function(root){
'use strict';
const BRANDS=['パンパース','グーン','マミーポコ','ムーニー','メリーズ','明治','森永','和光堂','ビーンスターク','アイクレオ','雪印','ピジョン','レック','西松屋','アカチャンホンポ','カークランド','Rico','キユーピー'];
function nfkc(s){return String(s??'').normalize('NFKC')}
function hira(s){return s.replace(/[ァ-ヶ]/g,c=>String.fromCharCode(c.charCodeAt(0)-0x60))}
// Key used to remember a receipt line: the same printed text maps to the same key.
function lineKey(raw){return nfkc(raw).toLowerCase().replace(/[\s\-‐‑–—・･_*＊※#＃()（）\[\]【】「」『』:：.．,，/\\]/g,'').replace(/[¥￥]?\d[\d,]*円?$/,'')}
// OCR of receipt fonts often confuses small and large kana, doubles them, or drops the long-vowel
// mark, so comparisons ignore those differences.
const SMALL={'ぁ':'あ','ぃ':'い','ぅ':'う','ぇ':'え','ぉ':'お','っ':'つ','ゃ':'や','ゅ':'ゆ','ょ':'よ','ゎ':'わ'};
function compact(s){return hira(nfkc(s).toLowerCase()).replace(/[\s\-‐‑–—・･_*＊※#＃()（）\[\]【】「」『』:：.．,，/\\ー~〜]/g,'').replace(/[ぁぃぅぇぉっゃゅょゎ]/g,c=>SMALL[c]).replace(/(.)\1+/g,'$1')}
const SIZE=/(新生児|nb|ss|s|m|l|xl|ビッグより大きい|ビッグ|big|スーパービッグ)(?=$|[^a-z])/i;
// Content amount of one sold unit: "60枚", "800g", "200ml", "3個入", "2本入". Never the purchase quantity.
function amounts(s){
 const out=[];const t=nfkc(s).toLowerCase().replace(/ﾏｲ|マイ/g,'枚');
 for(const m of t.matchAll(/(\d+(?:\.\d+)?)\s*(kg|g|ml|l|枚|個入|本入|袋入|包|缶|入)/g)){
  let n=Number(m[1]),u=m[2];
  if(u==='kg'){n*=1000;u='g'}if(u==='l'){n*=1000;u='ml'}if(u==='個入'||u==='本入'||u==='袋入'||u==='入')u='入';
  out.push(n+u);
 }
 return out.sort();
}
function features(name){
 const t=nfkc(name),low=t.toLowerCase();
 const brand=BRANDS.find(b=>t.includes(b)||compact(t).includes(compact(b)))||'';
 const tokens=low.replace(/(\d+(?:\.\d+)?)\s*(kg|g|ml|l|枚|個入|本入|袋入|包|缶|入)/g,' ').split(/[\s　]+/).filter(Boolean);
 // A size is a standalone token (or a size letter glued to the form: "テープm").
 let size='';for(const tok of tokens){const m=tok.match(/^(?:テープ|パンツ|ﾃｰﾌﾟ|ﾊﾟﾝﾂ)?(新生児|nb|ss|s|m|l|xl|ビッグより大きい|スーパービッグ|ビッグ|big)$/i);if(m){size=m[1].toLowerCase()}}
 // The receipt parser removes spaces ("パンパースサラサラケアテープm64マイ"): a size right after the form or "サイズ" counts too.
 if(!size){const m=low.replace(/[\s　]+/g,'').match(/(?:テープ|パンツ|ﾃｰﾌﾟ|ﾊﾟﾝﾂ|サイズ|ｻｲｽﾞ)(新生児|nb|ss|xl|s|m|l|ビッグより大きい|スーパービッグ|ビッグ|big)(?![a-z])/);if(m)size=m[1]}
 size=size.replace('big','ビッグ').replace('nb','新生児');
 const form=/テープ|ﾃｰﾌﾟ/.test(t)?'tape':/パンツ|ﾊﾟﾝﾂ/.test(t)?'pants':'';
 return {brand,size,form,amounts:amounts(t)};
}
// Content amounts ("80ﾏｲ", "800G") and bundle counts ("x3") are compared separately, not as name text.
function bigrams(s){const c=compact(s).replace(/\d+(?:\.\d+)?(?:kg|g|ml|l|枚|まい|個入|こいり|本入|袋入|包|缶|入)/g,'').replace(/[x×]\d+/g,'');const out=new Map();for(let i=0;i<c.length-1;i++){const b=c.slice(i,i+2);out.set(b,(out.get(b)||0)+1)}if(c.length===1)out.set(c,1);return out}
function dice(a,b){
 const x=bigrams(a),y=bigrams(b);let inter=0,nx=0,ny=0;
 for(const v of x.values())nx+=v;for(const v of y.values())ny+=v;
 for(const [k,v] of x)inter+=Math.min(v,y.get(k)||0);
 return nx+ny?2*inter/(nx+ny):0;
}
// Share of the receipt text found in the product name (abbreviations are mostly subsets).
function coverage(raw,name){const x=bigrams(raw),y=bigrams(name);let hit=0,n=0;for(const [k,v] of x){n+=v;hit+=Math.min(v,y.get(k)||0)}return n?hit/n:0}
function conflict(a,b){
 if(a.size&&b.size&&a.size!==b.size)return 'size';
 if(a.form&&b.form&&a.form!==b.form)return 'form';
 if(a.brand&&b.brand&&a.brand!==b.brand)return 'brand';
 if(a.amounts.length&&b.amounts.length&&a.amounts.join()!==b.amounts.join())return 'amount';
 return '';
}
/* candidates(raw, items) → [{item, score, learned}] best first, at most 3. */
function candidates(raw,items,{limit=3,min=0.5}={}){
 const key=lineKey(raw),f=features(raw),out=[];
 for(const item of Array.isArray(items)?items:[]){
  if(!item||typeof item.name!=='string')continue;
  if(Array.isArray(item.receiptAliases)&&item.receiptAliases.includes(key)){out.push({item,score:1,learned:true});continue}
  const g=features(item.name);if(conflict(f,g))continue;
  // The same printed name is rarely read identically twice: a close match to a confirmed name counts too.
  const near=Array.isArray(item.receiptAliases)?Math.max(0,...item.receiptAliases.map(a=>dice(a,key))):0;
  if(near>=0.75){out.push({item,score:0.9+near/20,learned:true});continue}
  let s=Math.max(dice(raw,item.name),coverage(raw,item.name)*0.92);
  if(f.brand&&f.brand===g.brand)s+=0.1;
  if(f.size&&f.size===g.size)s+=0.05;
  if(f.amounts.length&&f.amounts.join()===g.amounts.join())s+=0.05;
  if(s>=min)out.push({item,score:Math.min(s,0.99),learned:false});
 }
 return out.sort((a,b)=>b.score-a.score||String(a.item.name).localeCompare(String(b.item.name))).slice(0,limit);
}
// Remember a confirmed match on the product (max 10 per product, newest last).
function remember(item,raw){
 const key=lineKey(raw);if(!item||!key)return false;
 const list=Array.isArray(item.receiptAliases)?item.receiptAliases.filter(k=>k!==key):[];
 list.push(key);item.receiptAliases=list.slice(-10);
 return true;
}
const api=Object.freeze({candidates,remember,features,lineKey,amounts,conflict});
if(typeof module!=='undefined'&&module.exports)module.exports=api;
root.AtokoreReceiptMatch=api;
})(typeof globalThis!=='undefined'?globalThis:this);
