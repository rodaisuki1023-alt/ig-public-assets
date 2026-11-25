/* Atokore v51 entitlements on the device: turns the server's hh_entitlements() answer into what the
 * app may show. The SERVER enforces every limit (photo slots, seats, server reads); this only
 * explains them. Rules (owner policy 2026-11-25):
 *  - unknown, broken or missing answers count as the free plan (never as paid);
 *  - everything free today stays free: existing free features are never switched off here;
 *  - a paid feature that does not exist yet is labelled 「検討中・未提供」 and can never be bought.
 */
(function(root){
'use strict';
const FREE=Object.freeze({plan:'free',cloudPhotos:5,seats:2,serverReceiptReads:3});
const PREMIUM=Object.freeze({plan:'premium',cloudPhotos:20,seats:6,serverReceiptReads:30});
// Feature catalogue: available = exists in the app today; tier = who may use it.
const FEATURES=Object.freeze({
 stockLevels:{name:'かんたん在庫（3段階）',tier:'free',available:true},
 stockEstimate:{name:'詳しく管理・残りの見積もり',tier:'free',available:true},
 prepSets:{name:'曜日・行事・子どもの持ち物',tier:'free',available:true},
 familyShare:{name:'家族2人の共有',tier:'free',available:true},
 cloudPhotos:{name:'家族で共有する写真',tier:'free',available:true},
 manualBackup:{name:'手動バックアップ・復元',tier:'free',available:true},
 morePhotos:{name:'共有写真を20枚まで',tier:'premium',available:false},
 refillNotice:{name:'切れそうな物のお知らせ',tier:'premium',available:false},
 autoPrep:{name:'曜日別の準備の自動表示（高度）',tier:'premium',available:false},
 autoBackup:{name:'自動バックアップ履歴',tier:'premium',available:false},
});
const int=(v,min,max)=>Number.isSafeInteger(v)&&v>=min&&v<=max?v:null;
/** Normalise hh_entitlements(); anything doubtful falls back to free. */
function fromServer(e,now=Date.now()){
 if(!e||typeof e!=='object')return {...FREE,source:'default'};
 const until=e.premium_until==null?null:Date.parse(e.premium_until);
 const premium=e.plan==='premium'&&(until===null||(Number.isFinite(until)&&until>now));
 const base=premium?PREMIUM:FREE,l=e.limits&&typeof e.limits==='object'?e.limits:{};
 return {plan:base.plan,cloudPhotos:base.cloudPhotos,
  seats:int(l.seats,1,20)??base.seats,serverReceiptReads:int(l.server_receipt_reads,0,999)??base.serverReceiptReads,
  seatsUsed:int(e.seats_used,0,20),source:'server'};
}
/** May the app offer this feature now? Free features are always yes; unavailable ones never. */
function canUse(feature,ent){
 const f=FEATURES[feature];if(!f||!f.available)return false;
 return f.tier==='free'||(ent?.plan==='premium');
}
function label(feature){
 const f=FEATURES[feature];if(!f)return '';
 return f.tier==='free'?'無料':f.available?'有料プラン':'有料プラン（検討中・未提供）';
}
/** Shared-photo slots left for the household, or null when the count is unknown. */
function photoSlotsLeft(ent,used){const u=int(used,0,1000);return u===null?null:Math.max(0,(ent?.cloudPhotos??FREE.cloudPhotos)-u)}
const api=Object.freeze({FREE,PREMIUM,FEATURES,fromServer,canUse,label,photoSlotsLeft});
if(typeof module!=='undefined'&&module.exports)module.exports=api;
root.AtokoreEntitlements=api;
})(typeof globalThis!=='undefined'?globalThis:this);
