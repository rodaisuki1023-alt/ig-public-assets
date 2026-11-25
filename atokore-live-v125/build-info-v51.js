/* Atokore v51: which app version and build the person is looking at (お試し screen), so a report
 * from a phone can be matched to the exact commit. The trial build fills in the commit; the
 * source copy shows that no build information is available. No network, no storage. */
(function(root){
'use strict';
const doc=typeof document!=='undefined'?document:null;if(!doc)return;
const el=doc.getElementById('atkBuildInfo');if(!el)return;
const raw=String(el.dataset.build||''),built=/^trial-v[0-9]+-([0-9a-f]{7}|local)$/.test(raw);
const sw=(()=>{try{return root.ATOKORE_SW_VERSION||null}catch(_){return null}})();
el.textContent='アプリ v51'+(built?' ・ ビルド '+raw:' ・ ビルド情報なし（開発用のコピー）')+(sw?' ・ '+sw:'');
root.AtokoreBuildInfo=Object.freeze({build:built?raw:null});
})(typeof window!=='undefined'?window:globalThis);
