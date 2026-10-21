/* Original baby-category illustrations, not vendor trademarks or packaging. */
(function(root){
'use strict';
const motifs={
 diaper:{label:'おむつ',bg:'#F7E1DA',ink:'#A96857',shape:'<path d="M13 18Q24 25 35 18L38 34Q24 43 10 34Z" fill="#FFFEF9" stroke="#A96857" stroke-width="2"/><path d="M13 18L18 30L10 34M35 18L30 30L38 34" stroke="#A96857" stroke-width="1.7" fill="none"/><path d="M19 32Q24 36 29 32" stroke="#D49D88" stroke-width="2" fill="none"/>'},
 milk:{label:'ミルク',bg:'#E7E3F4',ink:'#8C78AA',shape:'<rect x="13" y="12" width="22" height="28" rx="5" fill="#FFFEFD" stroke="#8879A4" stroke-width="2"/><path d="M13 20H35M17 15H31" stroke="#8879A4" stroke-width="1.5"/><path d="M24 25Q19 31 24 35Q29 31 24 25Z" fill="#DDD5F1" stroke="#8879A4" stroke-width="1.5"/>'},
 wipes:{label:'おしりふき',bg:'#DBEEE8',ink:'#5E9B88',shape:'<rect x="6" y="22" width="36" height="18" rx="6" fill="#FFFEFD" stroke="#5E9B88" stroke-width="2"/><path d="M16 22Q13 11 24 9Q34 12 31 22" fill="#FFFEFD" stroke="#5E9B88" stroke-width="2"/><rect x="17" y="25" width="15" height="5" rx="2.5" fill="#D4EBE2" stroke="#5E9B88" stroke-width="1.2"/>'}
};
function kind(name,cat=''){
 const value=String(name||'').normalize('NFKC');
 if(/おしりふき|お尻ふき|おしり拭き|お尻拭き|手口ふき|手口拭き/.test(value))return 'wipes';
 if(cat==='ベビー'&&value.trim()==='ミルク')return 'milk';
 if(/粉ミルク|液体ミルク|らくらくミルク|らくらくキューブ|ほほえみ|ステップ|ぐんぐん|チルミル|つよいこ|フォローアップミルク|グローアップミルク|すこやかM1|E赤ちゃん|はいはい|はぐくみ|アイクレオ|バランスミルク/.test(value))return 'milk';
 if(/おむつ|オムツ|ムーニーマン|マミーポコ|パンパース|メリーズ|グーン|オヤスミマン/.test(value))return 'diaper';
 return null;
}
function icon(type,size=42){
 const a=motifs[type];if(!a)return '';
 const dim=Math.max(32,Math.min(72,Number(size)||42));
 if(type==='diaper'||type==='wipes'||type==='milk')return '<span class="bf-baby-icon bf-icon-'+type+'" aria-hidden="true"><img class="bf-baby-art" src="./icons/baby/'+type+'-bear-v'+(type==='milk'?'26':'24')+'.webp" width="'+dim+'" height="'+dim+'" alt="" decoding="async" style="object-fit:contain"></span>';
 return '<span class="bf-baby-icon bf-icon-'+type+'" aria-hidden="true"><svg viewBox="0 0 48 48" width="'+dim+'" height="'+dim+'" xmlns="http://www.w3.org/2000/svg"><rect width="48" height="48" rx="14" fill="'+a.bg+'"/>'+a.shape+'</svg></span>';
}
const BRANDS=['パンパース','グーン','マミーポコ','ムーニー','メリーズ','明治','森永','和光堂','ビーンスターク','アイクレオ','雪印','ピジョン','レック','西松屋','アカチャンホンポ','カークランド','Rico','baby care'];
function brand(name){
 const s=String(name||'').normalize('NFKC');
 return BRANDS.find(v=>s.includes(v))||'';
}
const EXTRA_BRAND_COLORS={
 'ビーンスターク':['#DFECF7','#3B6083'],'アイクレオ':['#F8E6DC','#855342'],
 'カークランド':['#E1E8EE','#425567'],'Rico':['#DDEFE6','#3D6653'],
 'baby care':['#DDEEF5','#3E6576'],'ピジョン':['#F6E2E8','#85435D'],
 'レック':['#E6EDDC','#566C40'],'西松屋':['#FFF0CF','#795C25'],
 'アカチャンホンポ':['#FBE2DA','#8C5142'],'雪印':['#E4EAF6','#4B6088']
};
function brandAppearance(name){
 // Reuse the home's established palette instead of assigning another stock-only color.
 const known=root.AtokorePeachUI?.describe({name})?.brand;
 if(known)return {label:known.jp,homeLabel:known.en,bg:known.bg,fg:known.fg};
 const label=brand(name),colors=EXTRA_BRAND_COLORS[label]||['#EEE5DE','#6B5D55'];
 return {label,homeLabel:label,bg:colors[0],fg:colors[1]};
}
const api=Object.freeze({kind,icon,brand,brandAppearance,motifs});
if(typeof module!=='undefined'&&module.exports)module.exports=api;
root.AtokoreBabyKit=api;
})(typeof globalThis!=='undefined'?globalThis:this);
