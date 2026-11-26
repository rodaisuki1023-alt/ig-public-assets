/* Atokore v51 units from product names (pure; also used by Node tests).
 * Baby products are counted the way they are bought: diapers in bags (袋, pieces inside: 枚),
 * wipes in packs (パック, 枚), powdered milk in cans (缶; cubes/sticks in boxes: 箱), liquid milk in
 * bottles (本). A brand alone ("パンパース", "メリーズ", "ほほえみ") is enough. Anything else returns
 * null and the existing rule decides. Only a suggestion: the person can always change the unit.
 */
(function(root){
'use strict';
const norm=s=>String(s??'').normalize('NFKC').trim();
const WIPES=/おしりふき|お尻ふき|おしり拭き|お尻拭き/;
const DIAPER=/おむつ|オムツ|紙おむつ|パンパース|メリーズ|ムーニー|グーン|マミーポコ|GENKI|ゲンキ|ナチュラルムーニー|ママベアー|はじめての肌着/i;
const LIQUID=/液体ミルク|らくらくミルク|液体/;
const MILK=/粉ミルク|ミルク|ほほえみ|はいはい|はぐくみ|すこやか|E赤ちゃん|アイクレオ|ぐんぐん|チルミル|つよいこ|ペプチドミルク|明治ステップ|ステップ\s*(缶|キューブ|らくらく)/;
const BOXED=/キューブ|スティック|エコらくパック/;
const DAIRY=/牛乳|豆乳|低脂肪|乳飲料|ミルクティー|ミルクココア|ミルクパン|ミルクレープ|ミルクチョコ|練乳|コンデンス/;
function kind(name){
 const n=norm(name);if(!n)return null;
 if(WIPES.test(n))return 'wipes';
 if(DIAPER.test(n))return 'diaper';
 if(MILK.test(n)&&!DAIRY.test(n))return 'milk';
 return null;
}
function unitFor(name){
 const n=norm(name),k=kind(n);
 if(k==='wipes')return 'パック';
 if(k==='diaper')return '袋';
 if(k==='milk')return LIQUID.test(n)?'本':BOXED.test(n)?'箱':'缶';
 return null;
}
/** Pieces counted inside one bag/box/pack for the estimate (diapers and wipes: 枚). */
function pieceFor(name,unit){
 const k=kind(name);
 if((k==='diaper'||k==='wipes')&&/^(袋|箱|パック)$/.test(String(unit||'')))return '枚';
 return null;
}
const api=Object.freeze({kind,unitFor,pieceFor});
if(typeof module!=='undefined'&&module.exports)module.exports=api;
root.AtokoreUnits=api;
})(typeof globalThis!=='undefined'?globalThis:this);
