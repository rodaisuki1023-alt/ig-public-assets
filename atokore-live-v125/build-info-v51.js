/* Atokore v51: one version label everywhere (Muse P3-3): the browser tab title, the header badge
 * and the お試し/マイページ version line all say "v51" and the exact build (commit), so a report from
 * a phone can be matched to the code. The trial build fills in the commit; the source copy says that
 * no build information is available. No network, no storage. Older markers in index.html stay in
 * place for the existing build checks; only what the person sees is unified here. */
(function(root){
'use strict';
const doc=typeof document!=='undefined'?document:null;if(!doc)return;
const el=doc.getElementById('atkBuildInfo');
const raw=String(el?.dataset.build||''),built=/^trial-v[0-9]+-([0-9a-f]{7}|local)$/.test(raw);
const build=built?raw:null;
const label='アプリ v51 ・ '+(built?'ビルド '+raw:'ビルド情報なし（開発用のコピー）');
function apply(){
 doc.title='あとこれ v51'+(built?'（'+raw+'）':'');
 for(const badge of doc.querySelectorAll('h1 .badge'))badge.textContent=(built?'試用版 ':'')+'v51';
 const line=doc.getElementById('atkVersionInfo');
 if(line){line.textContent=label;if(el)el.hidden=true}
 else if(el){el.textContent=label;el.hidden=false}
}
apply();
// Some older modules write the badge/title once more after loading; keep the single label.
root.addEventListener?.('load',apply);
root.AtokoreBuildInfo=Object.freeze({build,label});
})(typeof window!=='undefined'?window:globalThis);
