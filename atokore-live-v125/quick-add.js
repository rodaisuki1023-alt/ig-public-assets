/* あとこれ / Quick Add v14
 * Search + one-tap presets + batch tray. Uses the original local-first atokoreTrialV4 data model.
 * No third-party images, payments, affiliate APIs, or network requests.
 */
(function(root) {
'use strict';
const doc=typeof document==='undefined'?null:document;
const $=id=>doc?.getElementById(id);
const safe=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const BABY={
 diaper:{brands:['パンパース','グーン','マミーポコ','ムーニー','メリーズ'],types:['パンツ','テープ'],sizes:['新生児','S','M','L','ビッグ','ビッグより大きい']},
 milk:{brands:['明治','和光堂','森永','ビーンスターク','アイクレオ'],types:['缶','キューブ','スティック','液体']},
 wipes:{brands:['ムーニー','グーン','パンパース','メリーズ','ピジョン','レック','アカチャンホンポ','西松屋'],types:['詰替','本体']}
};
/* v19: only constraints confirmed on manufacturer sites (read 2026-10-20). The full product master
 * (per-series sizes, two newborn sizes, Mはいはい/Mたっち, スーパービッグ …) is a later phase.
 * - 新生児: tape only (Pampers, Merries, Moony, GOO.N, MamyPoko product pages list no newborn pants)
 * - マミーポコ: pants only (mamypoko.jp lists no tape type)
 * - 和光堂 はいはい: 810g/300g cans and stick packs only (wakodo.co.jp)
 * - ビーンスターク: cans, sticks (つよいこ) and liquid (すこやかM1) only (beanstalksnow.co.jp)
 * - 森永 / アイクレオ: no cube product on the official lineups (morinagamilk.co.jp/products/babyfood/, glico.com/jp/product/babyfood/icreo)
 * - 明治: lineup could not be read (site refuses automated access), so its options are unchanged
 * Brands not listed here keep every option because their lineup could not be confirmed. */
const BABY_TYPES={diaper:{'マミーポコ':['パンツ']},milk:{'和光堂':['缶','スティック'],'ビーンスターク':['缶','スティック','液体'],'森永':['缶','スティック','液体'],'アイクレオ':['缶','スティック','液体']}};
const TAPE_ONLY_SIZES=['新生児'];
const SERIES={
 diaper:{'パンパース':['さらさらケア','肌へのいちばん','おやすみパンツ'],'グーン':['ぐんぐん吸収','モレ0へ','ナイト'],'マミーポコ':['マミーポコパンツ','夜用パンツ'],'ムーニー':['ムーニーマン','低刺激であんしん','オヤスミマン'],'メリーズ':['ずっと肌さら','ファーストプレミアム','ぐっすりパンツ']},
 milk:{'明治':['ほほえみ','ステップ'],'森永':['はぐくみ','E赤ちゃん','チルミル'],'和光堂':['はいはい','ぐんぐん'],'ビーンスターク':['すこやかM1','つよいこ'],'アイクレオ':['バランスミルク','フォローアップミルク']},
 // Wipes never borrow diaper series. Only names listed on jp.moony.com / jp.pampers.com.
 wipes:{'ムーニー':['極上の肌ふわごこち','水分たっぷり厚手','しあわせのベビーシトラスの香り','やわらか素材','トイレに流せるタイプ'],'パンパース':['肌へのいちばん']}
};
function babyTypes(kind=state.kind,brand=state.brand){return BABY_TYPES[kind]?.[brand]||BABY[kind].types}
function babySizes(type=state.type){return BABY.diaper.sizes.filter(s=>type!=='パンツ'||!TAPE_ONLY_SIZES.includes(s))}
function babyProductLabel(kind=state.kind,type=state.type){return kind==='diaper'?'おむつ':kind==='milk'?(type==='液体'?'液体ミルク':'粉ミルク'):'おしりふき'}
function babyChoiceError(s=state){
 if(!s.brand||!s.type||(s.kind==='diaper'&&!s.size))return 'ブランド・種類・サイズ（おむつの場合）を選んでください';
 if(!babyTypes(s.kind,s.brand).includes(s.type))return s.brand+'に「'+s.type+'」はありません';
 if(s.kind==='diaper'&&s.type==='パンツ'&&TAPE_ONLY_SIZES.includes(s.size))return '新生児サイズはテープタイプのみです';
 return '';
}
const TOP={
 '食料品':['卵','牛乳','鶏むね肉','豚こま肉','玉ねぎ','にんじん','じゃがいも','トマト','キャベツ','ブロッコリー','バナナ','りんご','豆腐','納豆','食パン','米','鮭','ヨーグルト','冷凍うどん','麦茶','味噌','チーズ'],
 '日用品':['ティッシュ','トイレットペーパー','洗濯洗剤','柔軟剤','食器用洗剤','キッチンペーパー','ラップ','ゴミ袋','シャンプー','ハンドソープ','スポンジ','浴室洗剤','除菌シート'],
 'ベビー':['おしりふき','おしりふき詰替','ベビーソープ','ベビーローション','液体ミルク','哺乳瓶洗剤','オムツM'],
 '衛生・薬':['マスク','絆創膏','消毒液','歯ブラシ','歯磨き粉','綿棒','ハンドクリーム']
};
const LABEL={meat:'お肉',egg:'卵',vegetable:'野菜',fruit:'果物',milk:'牛乳・乳製品',bread:'パン',fish:'魚',rice:'ご飯・主食',frozen:'冷凍食品',beans:'豆腐・納豆',drink:'飲み物',season:'調味料',house:'日用品',paper:'紙製品',wash:'洗剤',baby:'ベビー',health:'衛生・薬',other:'その他'};
const COLOR={
 meat:['#F9E0DA','#B8665D'],egg:['#FEF0D2','#C58B43'],vegetable:['#E2F1DB','#618B58'],
 fruit:['#F9E4D7','#C67D60'],milk:['#E2EAFB','#6485B8'],bread:['#F8E7CF','#AD814E'],
 fish:['#DFEEF4','#5C91A9'],rice:['#F5E9D9','#A58A67'],frozen:['#E3EEF7','#7796B9'],
 beans:['#E6EDDA','#7F9970'],drink:['#DFF0E9','#659A84'],season:['#F5E2D4','#A5765D'],
 house:['#EEE7F2','#8B79A2'],paper:['#E6EDF5','#7F91AE'],wash:['#E5EDF6','#658AAA'],
 baby:['#F5E1E5','#C37E93'],health:['#E7EEEA','#759586'],other:['#EFE9E2','#978476']
};
function kindOf(name,cat='食料品'){
 const n=String(name||'').normalize('NFKC');
 if(/卵|たまご|玉子/.test(n))return 'egg';
 if(/豚|鶏|牛肉|ひき肉|ウインナー|ハム|ベーコン|ソーセージ|お肉|肉$/.test(n))return 'meat';
 if(/玉ねぎ|にんじん|じゃがいも|キャベツ|レタス|白菜|大根|きゅうり|トマト|ピーマン|パプリカ|なす|ねぎ|ほうれん草|小松菜|ブロッコリー|もやし|きのこ|しめじ|しいたけ|えのき|野菜/.test(n))return 'vegetable';
 if(/りんご|バナナ|みかん|キウイ|ぶどう|いちご|フルーツ|果物/.test(n))return 'fruit';
 if(/鮭|さば|ぶり|あじ|たら|まぐろ|魚|ツナ/.test(n))return 'fish';
 if(/牛乳|豆乳|ヨーグルト|チーズ|バター|生クリーム|ミルク/.test(n)&&cat!=='ベビー')return 'milk';
 if(/食パン|ロールパン|ベーグル|パン$/.test(n))return 'bread';
 if(/納豆|豆腐|油揚げ|厚揚げ/.test(n))return 'beans';
 if(/冷凍|アイス|餃子|からあげ/.test(n))return 'frozen';
 if(/米|ごはん|うどん|そば|そうめん|パスタ|麺|シリアル|オートミール/.test(n))return 'rice';
 if(/味噌|醤油|みりん|塩|砂糖|酢|ソース|マヨネーズ|ケチャップ|油|こしょう|調味|だし/.test(n))return 'season';
 if(/麦茶|緑茶|コーヒー|ジュース|炭酸|水$|飲み物/.test(n))return 'drink';
 if(/ティッシュ|ペーパー|タオル|トイレット/.test(n))return 'paper';
 if(/洗剤|柔軟|漂白|ソープ|シャンプー|洗顔/.test(n))return 'wash';
 if(cat==='ベビー'||/おむつ|オムツ|おしりふき|哺乳瓶|ベビー/.test(n))return 'baby';
 if(cat==='衛生・薬'||/薬|マスク|消毒|歯ブラシ|歯磨き|絆創膏|綿棒/.test(n))return 'health';
 if(cat==='日用品'||/ラップ|ゴミ袋|スポンジ|掃除|キッチン|除湿|消臭/.test(n))return 'house';
 return 'other';
}
function shape(k,color){
 const L=color,fill='#fffdfb';
 switch(k){
 case 'egg':return '<ellipse cx="17" cy="26" rx="7" ry="10" fill="'+fill+'" stroke="'+L+'" stroke-width="2"/><ellipse cx="31" cy="26" rx="7" ry="10" fill="'+fill+'" stroke="'+L+'" stroke-width="2"/>';
 case 'meat':return '<path d="M11 23 Q14 11 25 13 Q37 13 38 24 Q39 35 26 36 L17 33 Q10 30 11 23Z" fill="'+fill+'" stroke="'+L+'" stroke-width="2"/><path d="M19 22 Q25 18 31 23 M17 29 Q23 31 29 29" stroke="'+L+'" stroke-width="2" fill="none" stroke-linecap="round"/>';
 case 'vegetable':return '<path d="M25 15 Q35 14 32 25 L25 39 Q19 33 17 24 Q16 17 25 15Z" fill="#F3AE77" stroke="'+L+'" stroke-width="1.7"/><path d="M24 17 Q15 10 17 7 Q24 7 25 14 Q26 6 32 7 Q33 13 27 17" fill="'+fill+'" stroke="'+L+'" stroke-width="1.7"/>';
 case 'fruit':return '<circle cx="24" cy="26" r="12" fill="#F7C7A1" stroke="'+L+'" stroke-width="2"/><path d="M24 14 V11 Q29 8 34 12 Q30 17 25 16" stroke="'+L+'" fill="#E5F3DB" stroke-width="2"/>';
 case 'milk':return '<path d="M16 13 H30 L34 19 V38 H15 V19 Z" fill="'+fill+'" stroke="'+L+'" stroke-width="2"/><path d="M16 13 L20 19 H34 M20 19 V38 M24 25 Q20 31 25 34 Q30 30 24 25Z" fill="none" stroke="'+L+'" stroke-width="1.8"/>';
 case 'bread':return '<path d="M13 20 Q11 10 23 10 Q38 10 36 20 V37 H13Z" fill="#F7DFC1" stroke="'+L+'" stroke-width="2"/><path d="M19 22 Q18 17 24 17 Q31 17 30 22 V32 H19Z" fill="'+fill+'" stroke="'+L+'" stroke-width="1.6"/>';
 case 'fish':return '<path d="M10 24 Q24 11 35 24 Q24 38 10 24Z M35 24 L42 16 V32Z" fill="'+fill+'" stroke="'+L+'" stroke-width="2"/><circle cx="17" cy="23" r="2" fill="'+L+'"/>';
 case 'rice':return '<path d="M12 24 H36 L33 36 H15Z" fill="'+fill+'" stroke="'+L+'" stroke-width="2"/><path d="M15 24 Q13 15 23 14 Q33 15 33 24" fill="'+fill+'" stroke="'+L+'" stroke-width="2"/>';
 case 'beans':return '<rect x="12" y="17" width="24" height="21" rx="5" fill="'+fill+'" stroke="'+L+'" stroke-width="2"/><path d="M18 26 H31 M18 31 H28" stroke="'+L+'" stroke-width="2"/>';
 case 'frozen':return '<path d="M24 10 V38 M10 24 H38 M14 14 L34 34 M34 14 L14 34" stroke="'+L+'" stroke-width="2.5" stroke-linecap="round"/>';
 case 'drink':return '<path d="M16 17 H34 L32 38 H18Z" fill="'+fill+'" stroke="'+L+'" stroke-width="2"/><path d="M21 17 L24 10 H34 M20 29 Q25 26 31 29" fill="none" stroke="'+L+'" stroke-width="2"/>';
 case 'season':return '<rect x="17" y="17" width="16" height="23" rx="4" fill="'+fill+'" stroke="'+L+'" stroke-width="2"/><rect x="20" y="10" width="10" height="7" rx="2" fill="'+fill+'" stroke="'+L+'" stroke-width="2"/><path d="M21 28 H29" stroke="'+L+'" stroke-width="2"/>';
 case 'paper':return '<rect x="11" y="17" width="28" height="20" rx="5" fill="'+fill+'" stroke="'+L+'" stroke-width="2"/><path d="M20 17 V12 H30 V17 M18 26 H32" stroke="'+L+'" stroke-width="2" fill="none"/>';
 case 'wash':return '<rect x="16" y="16" width="18" height="25" rx="5" fill="'+fill+'" stroke="'+L+'" stroke-width="2"/><path d="M19 16 V9 H28 V16 M21 29 H29" stroke="'+L+'" stroke-width="2" fill="none"/>';
 case 'baby':return '<path d="M13 22 Q24 28 35 22 L37 36 Q25 44 11 36Z" fill="'+fill+'" stroke="'+L+'" stroke-width="2"/><path d="M13 22 L19 32 L11 36 M35 22 L30 32 L37 36" fill="none" stroke="'+L+'" stroke-width="1.6"/>';
 case 'health':return '<rect x="13" y="19" width="22" height="18" rx="5" fill="'+fill+'" stroke="'+L+'" stroke-width="2"/><path d="M24 22 V34 M18 28 H30" stroke="'+L+'" stroke-width="2.5"/>';
 default:return '<rect x="14" y="13" width="20" height="25" rx="5" fill="'+fill+'" stroke="'+L+'" stroke-width="2"/><path d="M18 22 H30 M18 29 H27" stroke="'+L+'" stroke-width="2"/>';
 }
}
function iconFor(name,cat='食料品'){
 const individual=root.AtokoreIndividualIcons?.icon(name);
 if(individual)return individual;
 const k=kindOf(name,cat),[bg,line]=COLOR[k];
 return '<span class="qa-icon" aria-hidden="true"><svg viewBox="0 0 48 48" width="42" height="42" xmlns="http://www.w3.org/2000/svg"><rect width="48" height="48" rx="14" fill="'+bg+'"/>'+shape(k,line)+'</svg></span>';
}
function stockItems(){try{return Array.isArray(items)?items:[]}catch(e){return []}}
function catalog(cat){
 let local=[];try{local=Array.isArray(C[cat])?C[cat]:[]}catch(e){}
 const popular=TOP[cat]||[];
 return [...new Set([...popular,...local])];
}
function defaultUnit(name,cat){
 try {if(typeof unitOf==='function')return unitOf(name)}catch(e){}
 if(/卵/.test(name))return 'パック';
 if(cat==='ベビー')return '袋';
 return '個';
}
function modelKey(x){return [x.cat,x.name,x.unit].join('\u0001')}
function validateLine(entry){
 if(!entry||typeof entry.name!=='string'||!entry.name.trim()||entry.name.length>120)throw Error('商品名を確認してください');
 if(!entry.cat||!entry.unit)throw Error('カテゴリと単位を確認してください');
 if(!Number.isSafeInteger(entry.qty)||entry.qty<1||entry.qty>999)throw Error('数量は1〜999で指定してください');
 return {...entry,name:entry.name.trim()};
}
function buildBatch(existing,selected,time=Date.now()){
 const next=existing.map(x=>({...x})),ids=new Set(next.map(x=>Number(x.id)));
 let unique=Math.max(Number(time)||1,1);
 for(const raw of selected){
  const v=validateLine(raw);
  const match=next.find(x=>x.name===v.name&&x.cat===v.cat&&x.unit===v.unit&&(!x.exp||x.expType==='期限なし'));
  if(match){match.qty=(Number(match.qty)||0)+v.qty;continue}
  while(ids.has(unique))unique++;
  ids.add(unique);
  next.push({id:unique++,name:v.name,cat:v.cat,qty:v.qty,unit:v.unit,expType:'期限なし',exp:'',purchase:'',price:0,store:'',place:v.cat==='食料品'?'冷蔵庫':'収納',memo:'',usage:1});
 }
 return next;
}
const state={destination:'stock',cat:'ベビー',group:'すべて',query:'',showAll:false,view:'quick',tray:[],kind:'diaper',brand:'',type:'',size:'',series:'',qty:1,committing:false,loadedSet:null,loadedSnapshot:''};
const destLabel=d=>d==='buy'?'買い物リスト':'ストック';
const commitLabel=()=>'まとめて'+destLabel(state.destination)+'に追加';
const traySnapshot=()=>JSON.stringify(state.tray.map(x=>[modelKey(x),x.qty]));
// Changing where the pending items go is allowed, but always said out loud.
function changeDestination(dest){
 const next=dest==='buy'?'buy':'stock';
 if(next!==state.destination&&state.tray.length)notify('追加予定の'+state.tray.length+'種類は「'+destLabel(next)+'」に保存されます');
 state.destination=next;renderDestination();
}
function addLine(entry){
 const v=validateLine(entry),found=state.tray.find(x=>modelKey(x)===modelKey(v));
 if(found)found.qty=Math.min(999,found.qty+v.qty);
 else state.tray.push(v);
 renderTray();renderItems();
}
function renderNav(){
 const el=$('qaTabs');if(!el)return;
 const tabs=[['ベビー','ベビー'],['食料品','食品'],['日用品','日用品'],['衛生・薬','衛生・薬'],['その他','その他']];
 el.innerHTML=tabs.map(([cat,label])=>'<button type="button" class="'+(state.cat===cat?'selected':'')+'" data-qa-cat="'+safe(cat)+'">'+label+'</button>').join('');
}
function groupOptions(){
 const available=state.cat==='食料品'?['すべて','meat','egg','vegetable','fruit','milk','fish','bread','rice','beans','frozen','drink','season','other'] :
 state.cat==='日用品'?['すべて','paper','wash','house','other']:['すべて'];
 return available;
}
function renderGroups(){
 const el=$('qaGroups');if(!el)return;
 el.innerHTML=groupOptions().map(g=>'<button type="button" data-qa-group="'+safe(g)+'" class="'+(state.group===g?'selected':'')+'">'+(g==='すべて'?'すべて':LABEL[g])+'</button>').join('');
}
function listed(){
 const full=state.cat==='その他'?[...new Set(['子ども','衣類','家電・生活用品','防災'].flatMap(c=>catalog(c)).map(n=>n))]:catalog(state.cat);
 const q=state.query.trim().normalize('NFKC').toLocaleLowerCase('ja');
 const arr=full.filter(n=>(state.group==='すべて'||kindOf(n,state.cat)===state.group)&&(!q||n.normalize('NFKC').toLocaleLowerCase('ja').includes(q)));
 return {total:arr.length,visible:arr.slice(0,state.showAll?120:24)};
}
function renderItems(){
 const host=$('qaTiles');if(!host)return;
 const {total,visible}=listed();
 const selected=new Map(state.tray.map(x=>[modelKey(x),x.qty]));
 host.innerHTML=visible.map(n=>{
  const cat=state.cat==='その他'?(Object.keys(C).find(c=>catalog(c).includes(n))||'日用品'):state.cat;
  const qty=selected.get(modelKey({cat,name:n,unit:defaultUnit(n,cat)}));
  return '<button type="button" class="qa-tile '+(qty?'picked':'')+'" data-qa-pick="'+safe(n)+'" data-qa-tilecat="'+safe(cat)+'" aria-label="'+safe(n)+'を追加">'+
   '<span class="qa-name">'+safe(n)+'</span><span class="qa-tile-add">'+(qty?qty:'＋')+'</span></button>';
 }).join('') || '<div class="qa-no-results">該当する商品がありません。下の自由入力から追加できます。</div>';
 const more=$('qaMore');if(more){more.hidden=total<=visible.length;more.textContent='さらに表示（全'+total+'件）'}
}
function renderRecent(){
 const container=$('qaRecent');if(!container)return;
 const names=[],seen=new Set();
 for(const x of stockItems().slice().reverse()){
  if(names.length>=6)break;
  if(seen.has(modelKey(x)))continue;
  if(state.cat!=='その他'&&state.cat!==x.cat)continue;
  seen.add(modelKey(x));names.push(x);
 }
 container.innerHTML=names.length?'<div class="qa-subtitle">最近登録した商品</div><div class="qa-recent">'+names.map((x,i)=>'<button type="button" data-qa-recent="'+i+'"><span>'+safe(x.name)+'</span><b>＋</b></button>').join('')+'</div>':'';
 container.__qaItems=names;
}
function babyBrands(){
 return BABY[state.kind].brands;
}
function chooseBabyField(type,val){
 if(type==='brand'){
  state.brand=val;state.series='';
  const allowed=babyTypes();
  if(state.type&&!allowed.includes(state.type))state.type='';
  if(allowed.length===1)state.type=allowed[0];
 }
 if(type==='kind'){state.kind=val;state.brand='';state.series='';state.type='';state.size=''}
 if(type==='type'&&babyTypes().includes(val)){
  state.type=val;
  if(val==='パンツ'&&TAPE_ONLY_SIZES.includes(state.size)){state.size='';notify('新生児サイズはテープタイプのみです。サイズを選び直してください')}
 }
 if(type==='size'&&(state.kind!=='diaper'||babySizes().includes(val)))state.size=val;
 if(type==='series')state.series=val;
 renderBaby();
}
function renderBaby(){
 const el=$('qaBaby');if(!el)return;
 const b=state.kind;
 const suggestions=SERIES[b]||{};
 const icon=kind=>root.AtokoreBabyKit?.icon(kind)||'';
 const sizes=b==='diaper'?'<div class="qa-subtitle">③ サイズ</div><div class="qa-option-chips">'+babySizes().map(n=>'<button type="button" class="'+(state.size===n?'selected':'')+'" data-qa-baby="size" data-value="'+safe(n)+'">'+safe(n)+'</button>').join('')+'</div>':'';
 const lines=(suggestions[state.brand]||[]).map(n=>'<button type="button" class="'+(state.series===n?'selected':'')+'" data-qa-baby="series" data-value="'+safe(n)+'">'+safe(n)+'</button>').join('');
 el.innerHTML='<div class="qa-baby-intro"><span class="qa-baby-intro-icon">'+icon(b)+'</span><span><strong>'+({diaper:'おむつ',milk:'ミルク',wipes:'おしりふき'}[b])+'を追加</strong><small>メーカー・種類・サイズを選ぶだけ</small></span></div>'+
 '<div class="qa-baby-kind">'+[['diaper','おむつ'],['milk','ミルク'],['wipes','おしりふき']].map(([k,n])=>'<button type="button" class="'+(b===k?'selected':'')+'" data-qa-baby="kind" data-value="'+k+'">'+icon(k)+'<span>'+n+'</span></button>').join('')+'</div>'+
 '<div class="qa-subtitle">① ブランド</div><div class="qa-brand-chips">'+babyBrands().map(n=>'<button type="button" class="'+(state.brand===n?'selected':'')+'" data-qa-baby="brand" data-value="'+safe(n)+'">'+safe(n)+'</button>').join('')+'</div>'+
 '<div class="qa-subtitle">② '+(b==='wipes'?'包装':'種類')+'</div><div class="qa-option-chips">'+babyTypes().map(n=>'<button type="button" class="'+(state.type===n?'selected':'')+'" data-qa-baby="type" data-value="'+safe(n)+'">'+safe(n)+'</button>').join('')+'</div>'+
 sizes+
 (lines?'<div class="qa-subtitle">商品シリーズ（任意）</div><div class="qa-option-chips qa-lines">'+lines+'</div>':'')+
 '<details class="qa-baby-extra"><summary>シリーズを自分で入力する（任意）</summary><input id="qaBabySeries" maxlength="45" placeholder="例：さらさらケア" value="'+safe(state.series)+'"></details>'+
 '<div class="qa-baby-bottom"><label>数量 <span>パック・缶などの個数</span></label><div class="qa-step"><button data-qa-step="-1" type="button" aria-label="減らす">−</button><b id="qaBabyQty">'+state.qty+'</b><button data-qa-step="1" type="button" aria-label="増やす">＋</button></div></div>'+
 '<button type="button" class="qa-baby-add" data-qa-babyadd>＋ ストックに追加</button>'+ 
 '<p class="qa-baby-save-note" id="qaBabySaveNote"></p>';
 renderDestination();
}
function addBaby(){
 const problem=babyChoiceError();
 if(problem){notify(problem);return}
 const desc=[state.brand,state.series,babyProductLabel(),state.type,state.kind==='diaper'?state.size:''].filter(Boolean).join(' ');
 addLine({cat:'ベビー',name:desc,qty:state.qty,unit:state.kind==='diaper'?'袋':state.kind==='wipes'?'パック':state.type==='缶'?'缶':state.type==='液体'?'本':'箱'});
 notify('追加予定に入れました（まだ保存されていません）。下の「'+commitLabel()+'」で保存します');
}
function renderTray(){
 const box=$('qaTray'),list=$('qaTrayList'),n=$('qaTotal'),button=$('qaCommit');
 if(!box||!list)return;
 const lines=state.tray,count=lines.length;
 box.hidden=!count;
 n.textContent=count+'種類・合計'+lines.reduce((sum,x)=>sum+x.qty,0)+'点（未保存）';
 const dest=$('qaTrayDest');if(dest)dest.textContent='保存先：'+destLabel(state.destination)+'　まだ保存されていません';
 list.innerHTML=lines.map((v,i)=>'<div class="qa-tray-item"><span class="qa-tray-thumb">'+iconFor(v.name,v.cat)+'</span><span class="qa-tray-name">'+safe(v.name)+'<small>'+safe(v.cat)+'</small></span><div class="qa-step"><button data-qa-adjust="'+i+'" data-step="-1" aria-label="減らす">−</button><b>'+v.qty+'</b><button data-qa-adjust="'+i+'" data-step="1" aria-label="増やす">＋</button></div><button class="qa-remove" data-qa-remove="'+i+'" aria-label="削除">×</button></div>').join('');
 button.disabled=!count||state.committing;
 box.classList.toggle('qa-tray-open',count>0);
 $('pg-add')?.classList.toggle('qa-has-tray',count>0);
}
function notify(msg){
 let x=$('qaNotice');
 if(!x){x=doc.createElement('div');x.id='qaNotice';x.className='qa-notice';x.setAttribute('role','status');doc.body.appendChild(x)}
 x.textContent=msg;x.classList.add('on');clearTimeout(notify.timer);
 notify.timer=setTimeout(()=>x.classList.remove('on'),2200);
}
function commit(){
 if(state.committing||!state.tray.length)return;
 state.committing=true;
 const before=stockItems(),tray=state.tray.map(x=>({...x}));
 let merged=0;
 try{
  root.AtokoreDataSafety?.assertWritable?.();
  if(state.destination==='buy'){
   const nextBuys=buys.map(x=>({...x}));
   for(const x of tray){const found=nextBuys.find(y=>y.name===x.name&&y.unit===x.unit);
    if(found){found.qty=Number(found.qty||0)+x.qty;merged++}
    else nextBuys.push({id:Date.now()+nextBuys.length+1,name:x.name,qty:x.qty,unit:x.unit,cat:x.cat});
   }
   root.localStorage.setItem('atokoreTrialV4',JSON.stringify({items,buys:nextBuys,routines}));
   buys=nextBuys;
  }else{
   const next=buildBatch(before,tray);
   merged=tray.length-(next.length-before.length);
   root.localStorage.setItem('atokoreTrialV4',JSON.stringify({items:next,buys,routines}));
   items=next;
  }
  state.tray=[];state.committing=false;state.loadedSet=null;state.loadedSnapshot='';
  renderTray();
  root.render?.();
  root.go?.(state.destination==='buy'?'buy':'stock');
  notify(tray.length+'種類を'+destLabel(state.destination)+'に保存しました'+(merged?'（うち'+merged+'種類は登録済みの商品に数量を合算）':''));
 }catch(err){
  state.committing=false;renderTray();
  notify('保存できませんでした。内容を残しているので、もう一度お試しください。');
  root.console?.error?.('あとこれ一括登録に失敗',err);
 }
}
function openQuick(){
 if(!doc)return;
 const p=$('pg-add');if(!p)return;
 p.classList.remove('atk-not-baby');
 state.view='quick';
 p.classList.remove('qa-details-mode');
 try{root.go('add')}catch(e){}
 renderAll();
}
function renderAll(){renderNav();renderGroups();renderItems();renderRecent();renderBaby();renderTray();switchCatVisibility();renderDestination()}
function switchCatVisibility(){
 const baby=state.cat==='ベビー';
 $('qaBaby')?.classList.toggle('qa-hidden',!baby);
 $('qaCatalogSection')?.classList.toggle('qa-hidden',baby);
 $('qaRecent')?.classList.toggle('qa-hidden',baby);
}
function setup(){
 const p=$('pg-add');if(!p)return;
 doc.body.classList.add('atk-v14');
 const pane=doc.createElement('section');pane.id='qaPanel';pane.className='qa-panel';
 pane.innerHTML='<div class="qa-heading"><strong>商品を選んで、まとめて追加</strong><span>おむつ・ミルク・おしりふきをかんたん登録。食品・日用品も使えます</span></div>'+ 
 '<div class="bf-destination" id="bfDestination"><button type="button" data-qa-dest="stock">ストックに追加</button><button type="button" data-qa-dest="buy">買い物リストに追加</button></div>'+ 
 '<div class="qa-main"><div id="qaTabs" class="qa-category-tabs"></div>'+
 '<div id="qaCatalogSection"><div class="qa-search"><span>⌕</span><input id="qaSearch" type="search" placeholder="商品名を検索" autocomplete="off" aria-label="商品名を検索"></div><div id="qaGroups" class="qa-group-tabs"></div><div class="qa-subtitle">タップすると追加予定に入ります</div><div id="qaTiles" class="qa-tiles"></div><button id="qaMore" data-qa-more class="qa-more" hidden type="button">さらに表示</button><div class="qa-free"><input id="qaFree" placeholder="リストにない商品名を入力" maxlength="120"><button type="button" data-qa-free>＋追加</button></div></div>'+
 '<div id="qaBaby" class="qa-baby"></div><div id="qaRecent"></div></div>';
 const heading=p.querySelector('.atk-page-title');
 if(heading)heading.insertAdjacentElement('afterend',pane);else p.prepend(pane);
 p.classList.add('qa-quick-mode');
 const tray=doc.createElement('section');tray.id='qaTray';tray.className='qa-tray';tray.hidden=true;
 tray.innerHTML='<div class="qa-tray-header"><b id="qaTotal">0件</b><button data-qa-clear type="button">全部取り消す</button></div><p id="qaTrayDest" class="qa-tray-dest"></p><div id="qaTrayList"></div><button id="qaCommit" type="button" data-qa-commit>まとめて登録する</button>';
 p.appendChild(tray);
 renderAll();
 $('qaSearch').addEventListener('input',e=>{state.query=e.target.value;state.showAll=false;renderItems()});
 $('qaFree').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();addFree()}});
 const originalOpen=root.atkOpenAdd;
 root.atkOpenAdd=function(){openQuick()};
 doc.addEventListener('click',e=>{
  const btn=e.target.closest?.('[data-qa-cat],[data-qa-group],[data-qa-pick],[data-qa-more],[data-qa-recent],[data-qa-baby],[data-qa-step],[data-qa-babyadd],[data-qa-free],[data-qa-adjust],[data-qa-remove],[data-qa-clear],[data-qa-commit],[data-qa-dest]');
  if(!btn||!p.contains(btn))return;
  if(btn.dataset.qaDest){changeDestination(btn.dataset.qaDest);return}
  if(btn.dataset.qaCat){state.cat=btn.dataset.qaCat;state.group='すべて';state.query='';state.showAll=false;$('qaSearch').value='';renderAll();return}
  if(btn.dataset.qaGroup){state.group=btn.dataset.qaGroup;state.showAll=false;renderGroups();renderItems();return}
  if(btn.hasAttribute('data-qa-pick')){const name=btn.dataset.qaPick,cat=btn.dataset.qaTilecat;addLine({name,cat,qty:1,unit:defaultUnit(name,cat)});return}
  if(btn.id==='qaMore'){state.showAll=true;renderItems();return}
  if(btn.hasAttribute('data-qa-recent')){const item=$('qaRecent').__qaItems[Number(btn.dataset.qaRecent)];if(item)addLine({name:item.name,cat:item.cat,qty:1,unit:item.unit});return}
  if(btn.dataset.qaBaby){chooseBabyField(btn.dataset.qaBaby,btn.dataset.value);return}
  if(btn.hasAttribute('data-qa-step')){state.qty=Math.max(1,Math.min(99,state.qty+Number(btn.dataset.qaStep)));renderBaby();return}
  if(btn.hasAttribute('data-qa-babyadd')){state.series=$('qaBabySeries')?.value.trim()||state.series||'';addBaby();return}
  if(btn.hasAttribute('data-qa-free')){addFree();return}
  if(btn.hasAttribute('data-qa-adjust')){const i=Number(btn.dataset.qaAdjust),v=state.tray[i];if(v){v.qty=Math.min(999,v.qty+Number(btn.dataset.step));if(v.qty<=0)state.tray.splice(i,1);renderTray();renderItems()}return}
  if(btn.hasAttribute('data-qa-remove')){state.tray.splice(Number(btn.dataset.qaRemove),1);renderTray();renderItems();return}
  if(btn.hasAttribute('data-qa-clear')){if(root.confirm?.('追加予定をすべて取り消しますか？')){state.tray=[];renderTray();renderItems()}return}
  if(btn.hasAttribute('data-qa-commit')){commit()}
 });
 function addFree(){
  const raw=$('qaFree').value.trim();if(!raw){notify('商品名を入力してください');return}
  const cat=state.cat;
  addLine({name:raw,cat,qty:1,unit:defaultUnit(raw,cat)});$('qaFree').value='';
 }
 const oldGo=root.go;
 if(typeof oldGo==='function')root.go=function(page,...rest){const result=oldGo.call(this,page,...rest);if(page==='add'){if(state.view==='quick')p.classList.remove('qa-details-mode');renderAll()}return result};
 const oldStock=root.renderStock,oldBuy=root.renderBuy,oldHome=root.renderHome;
 if(typeof oldStock==='function')root.renderStock=function(...a){const v=oldStock.apply(this,a);decorateRows('#stockList [data-stock-id]');return v};
 if(typeof oldBuy==='function')root.renderBuy=function(...a){const v=oldBuy.apply(this,a);decorateRows('#buyList [data-buy-id]');return v};
 if(typeof oldHome==='function')root.renderHome=function(...a){const v=oldHome.apply(this,a);decorateHome();return v};
 decorateRows('#stockList [data-stock-id]');decorateRows('#buyList [data-buy-id]');decorateHome();
}
function decorateRows(query){
 doc?.querySelectorAll(query).forEach(row=>{
  const title=row.querySelector('.name'),badge=row.querySelector('.atk-row-brand');
  if(!title||!badge||badge.classList.contains('qa-picture-badge'))return;
  const kind=kindOf(title.title||title.textContent,'食料品');
  if(kind==='baby'||(kind==='other'&&!root.AtokoreIndividualIcons?.resolve(title.title||title.textContent)))return;
  if(badge.classList.contains('atk-row-generic')){
   badge.classList.add('qa-picture-badge');
   badge.innerHTML=iconFor(title.title||title.textContent,'食料品');
   badge.setAttribute('aria-label',LABEL[kind]);
  }
 });
}
function decorateHome(){
 doc?.querySelectorAll('#pg-home .atk-brand-generic').forEach(node=>{
  if(node.classList.contains('qa-picture-badge'))return;
  const card=node.closest('.atk-item-card');
  const name=card?.querySelector('.atk-item-copy strong')?.textContent||'';
  const kind=kindOf(name);
  if(kind==='other'&&!root.AtokoreIndividualIcons?.resolve(name))return;
  node.classList.add('qa-picture-badge');node.innerHTML=iconFor(name);
 });
}
function renderDestination(){
 const node=$('bfDestination');if(!node)return;
 node.querySelectorAll('[data-qa-dest]').forEach(x=>x.classList.toggle('selected',x.dataset.qaDest===state.destination));
 const button=$('qaCommit');if(button)button.textContent=commitLabel();
 const baby=$('qaBaby')?.querySelector('[data-qa-babyadd]');
 if(baby)baby.textContent='＋ 追加予定に入れる';
 const note=$('qaBabySaveNote');
 if(note)note.textContent='まだ保存されません。最後に下の「'+commitLabel()+'」を押すと保存されます。';
 const dest=$('qaTrayDest');if(dest)dest.textContent='保存先：'+destLabel(state.destination)+'　まだ保存されていません';
}
function openWithEntries(entries,destination='stock',options={}){
 const list=Array.isArray(entries)?entries:[];
 const setId=options&&options.setId!=null?String(options.setId):null;
 if(!list.length){changeDestination(destination);openQuick();return}
 // The same set, untouched since it was loaded: never add its quantities a second time.
 if(setId!==null&&state.loadedSet===setId&&state.loadedSnapshot===traySnapshot()){
  changeDestination(destination);openQuick();
  notify('このセットは読み込み済みです。数量を確認して「'+commitLabel()+'」を押してください');
  return;
 }
 if(state.tray.length&&!root.confirm?.('追加予定に'+state.tray.length+'種類の商品があります（まだ保存されていません）。\nセットの内容に入れ替えますか？\n「キャンセル」なら今の追加予定をそのまま残します。')){
  changeDestination(state.destination);openQuick();return;
 }
 const next=[];let skipped=0;
 for(const x of list){
  let v;try{v=validateLine(x)}catch(e){skipped++;continue}
  const found=next.find(y=>modelKey(y)===modelKey(v));
  if(found)found.qty=Math.min(999,found.qty+v.qty);else next.push(v);
 }
 state.tray=next;state.loadedSet=setId;state.loadedSnapshot=traySnapshot();
 state.destination=destination==='buy'?'buy':'stock';
 openQuick();renderTray();renderItems();renderDestination();
 if(skipped)notify(skipped+'件は内容を確認できなかったため読み込みませんでした');
}
function setCategory(cat){state.cat=cat;state.group='すべて';state.query='';state.showAll=false;if($('qaSearch'))$('qaSearch').value='';renderAll()}
const api=Object.freeze({kindOf,iconFor,buildBatch,validateLine,modelKey,openWithEntries,setCategory,setDestination(dest){changeDestination(dest)},getTray(){return state.tray.map(x=>({...x}))}});
if(typeof module!=='undefined'&&module.exports)module.exports=api;
root.AtokoreQuickAdd=api;
if(doc&&typeof window!=='undefined')setup();
})(typeof globalThis!=='undefined'?globalThis:this);
