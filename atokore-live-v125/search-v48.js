/* Atokore W2 search: forgiving matching without changing what is shown.
 * - Hiragana/katakana, full/half width (kana, letters, digits) and upper/lower case are the same.
 * - Spaces (full or half width) separate words; every word must be found (AND).
 * - Confirmed spellings of the same brand are the same (キユーピー/キューピー, Pampers/パンパース …).
 * - Sizes (S, M, L, XL, NB, ビッグ …) match only as a whole size, so "M" never finds L, ML or "mamy".
 * - Long vowels, small kana and っ are NOT folded here; "もしかして" suggestions handle those.
 * Pure functions; no DOM.
 */
(function(root){
'use strict';
// Applied after folding katakana to hiragana and letters to lower case.
const BRANDS=[[/きゅーぴー/g,'きゆーぴー'],[/pampers/g,'ぱんぱーす'],[/goo\.?n/g,'ぐーん'],[/mamy\s?poko/g,'まみーぽこ'],[/moony/g,'むーにー'],[/merries/g,'めりーず']];
const SIZE=/^(?:ss|s|m|l|xl|xxl|nb|新生児|びっぐ|big)$/;
function hira(s){return s.replace(/[ァ-ヶ]/g,c=>String.fromCharCode(c.charCodeAt(0)-0x60))}
function norm(text){
 let t=hira(String(text??'').normalize('NFKC').toLowerCase());
 for(const [re,to] of BRANDS)t=t.replace(re,to);
 return t.replace(/\s+/g,' ').trim();
}
function words(query){return norm(query).split(' ').filter(Boolean)}
const escapeRe=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
function hasWord(hay,word){
 if(!SIZE.test(word))return hay.includes(word);
 return new RegExp('(^|[^a-z])'+escapeRe(word)+'(?![a-z])').test(hay);
}
function matches(text,query){const w=words(query);if(!w.length)return true;const hay=norm(text);return w.every(x=>hasWord(hay,x))}

// "もしかして": looser comparison (long vowels, small kana, っ) for up to 3 words from known names.
const SMALL={'ぁ':'あ','ぃ':'い','ぅ':'う','ぇ':'え','ぉ':'お','ゃ':'や','ゅ':'ゆ','ょ':'よ','ゎ':'わ'};
function loose(text){return norm(text).replace(/[ー\-‐–— ・]/g,'').replace(/っ/g,'').replace(/[ぁぃぅぇぉゃゅょゎ]/g,c=>SMALL[c])}
function bigrams(s){const m=new Map();for(let i=0;i<s.length-1;i++){const b=s.slice(i,i+2);m.set(b,(m.get(b)||0)+1)}if(s.length===1)m.set(s,1);return m}
function similarity(a,b){
 if(!a||!b)return 0;if(a===b)return 1;
 const x=bigrams(a),y=bigrams(b);let inter=0,nx=0,ny=0;
 for(const v of x.values())nx+=v;for(const v of y.values())ny+=v;
 for(const [k,v] of x)inter+=Math.min(v,y.get(k)||0);
 return nx+ny?2*inter/(nx+ny):0;
}
function suggestions(query,names,limit=3){
 const q=loose(query);if(q.length<2)return [];
 const best=new Map();
 for(const name of names||[]){
  if(typeof name!=='string'||!name.trim()||matches(name,query))continue;
  for(const word of String(name).normalize('NFKC').split(/[\s　]+/).filter(Boolean)){
   const w=loose(word);if(w.length<2)continue;
   const score=w===q?1:Math.max(similarity(q,w),w.includes(q)&&q.length>=3?0.8:0);
   if(score<0.5)continue;
   if(!best.has(word)||best.get(word)<score)best.set(word,score);
  }
 }
 return [...best.entries()]
  .sort((a,b)=>b[1]-a[1]||a[0].length-b[0].length||a[0].localeCompare(b[0],'ja')).slice(0,limit).map(([label])=>label);
}
const api=Object.freeze({norm,words,matches,loose,suggestions});
if(typeof module!=='undefined'&&module.exports)module.exports=api;
root.AtokoreSearch=api;
})(typeof globalThis!=='undefined'?globalThis:this);
