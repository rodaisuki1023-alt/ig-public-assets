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
// お試し: the switch for the photo-slot trial display read by product-photos-v30.js (Muse P2-8).
const PREVIEW_KEY='atokorePhotoCounterPreviewV1';
function previewPlan(){try{const v=root.localStorage.getItem(PREVIEW_KEY);return ['free','premium','ended'].includes(v)?v:null}catch(_){return null}}
function previewSetting(){
 const page=doc?.getElementById('pg-premium');if(!page||doc.getElementById('atkPhotoPreview'))return;
 const box=doc.createElement('div');box.id='atkPhotoPreview';box.className='atk-photo-preview-setting';
 box.innerHTML='<label for="atkPhotoPreviewPlan"><b>写真枠の試用表示（合成データ）</b></label>'+
  '<p class="atk-photo-note">写真画面の「共有写真 n/5枚」などの表示を、この端末の写真を使って確かめるための設定です。実際の家族共有・契約・サーバー上限は変わりません。</p>'+
  '<select id="atkPhotoPreviewPlan"><option value="">オフ（通常）</option><option value="free">無料プラン（5枚）として表示</option><option value="premium">有料プラン（20枚）として表示</option><option value="ended">有料プラン終了後（5枚）として表示</option></select>';
 const anchor=doc.getElementById('atkBuildInfo');if(anchor)anchor.before(box);else page.append(box);
 const sel=box.querySelector('select');sel.value=previewPlan()||'';
 sel.addEventListener('change',()=>{try{if(sel.value)root.localStorage.setItem(PREVIEW_KEY,sel.value);else root.localStorage.removeItem(PREVIEW_KEY)}catch(_){root.notifyAtokoreV125H?.('この設定を保存できませんでした')}});
}
apply();previewSetting();
// Some older modules write the badge/title once more after loading; keep the single label.
root.addEventListener?.('load',apply);
root.AtokoreBuildInfo=Object.freeze({build,label});
})(typeof window!=='undefined'?window:globalThis);
