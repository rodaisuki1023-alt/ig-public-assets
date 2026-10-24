/* あとこれ / Quick Add v14
 * Search + one-tap presets + pending list with a review screen before saving. Uses the original local-first atokoreTrialV4 data model.
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
 wipes:{brands:['ムーニー','グーン','パンパース','メリーズ','レック','アカチャンホンポ','西松屋','カークランド','Rico','baby care'],types:[]}
};
/* v27: per-product milk forms verified against manufacturer lineups on 2026-10-21.
 * See docs/atokore-baby-products-v27-20261021.md for sources and exclusions.
 * Other entries are user-authored; never migrate or relabel saved inventory. */
const OTHER='その他';
const MILK_PRODUCTS=[
 {brand:'明治',name:'ほほえみ',types:['缶','キューブ','液体']},
 {brand:'和光堂',name:'はいはい',types:['缶','スティック']},
 {brand:'森永',name:'はぐくみ',types:['缶','スティック','エコらくパック はじめてセット','エコらくパック つめかえ用','液体']},
 {brand:'森永',name:'E赤ちゃん',types:['缶','スティック','エコらくパック はじめてセット','エコらくパック つめかえ用']},
 {brand:'ビーンスターク',name:'すこやかM1',types:['缶','スティック','液体']},
 {brand:'アイクレオ',name:'バランスミルク',types:['缶','スティック']},
 {brand:'アイクレオ',name:'赤ちゃんミルク',types:['液体']},
 {brand:'明治',name:'ステップ',follow:true,types:['缶','キューブ','液体']},
 {brand:'和光堂',name:'ぐんぐん',follow:true,types:['缶','スティック']},
 {brand:'森永',name:'チルミル',follow:true,types:['缶','スティック','エコらくパック はじめてセット','エコらくパック つめかえ用']},
 {brand:'ビーンスターク',name:'つよいこ',follow:true,types:['缶','スティック']},
 {brand:'アイクレオ',name:'グローアップミルク',follow:true,types:['缶','スティック']}
];
const BABY_TYPES={diaper:{'マミーポコ':['パンツ']}};
const TAPE_ONLY_SIZES=['新生児'];
const SERIES={
 diaper:{'パンパース':['さらさらケア','肌へのいちばん','おやすみパンツ'],'グーン':['ぐんぐん吸収','モレ0へ','ナイト'],'マミーポコ':['マミーポコパンツ','夜用パンツ'],'ムーニー':['ムーニーマン','低刺激であんしん','オヤスミマン'],'メリーズ':['ずっと肌さら','ファーストプレミアム','ぐっすりパンツ']},
 // Wipes never borrow diaper series. Only names listed on jp.moony.com / jp.pampers.com.
 wipes:{'ムーニー':['極上の肌ふわごこち','水分たっぷり厚手','しあわせのベビーシトラスの香り','やわらか素材','トイレに流せるタイプ'],'パンパース':['肌へのいちばん']}
};
function milkProduct(s=state){return MILK_PRODUCTS.find(x=>x.brand===s.brand&&x.name===s.series)}
function babyTypes(kind=state.kind,brand=state.brand,series=state.series){
 if(kind==='milk')return milkProduct({brand,series})?.types||BABY.milk.types;
 return BABY_TYPES[kind]?.[brand]||BABY[kind].types;
}
function chosen(field){return state[field]===OTHER?state['custom'+field[0].toUpperCase()+field.slice(1)].trim():state[field]}
function syncBabyInputs(){
 for(const field of ['Brand','Type','Size','Series','Unit']){
  const input=$('qaBaby'+field);if(input)state['custom'+field]=input.value;
 }
}

function babySizes(type=state.type){return BABY.diaper.sizes.filter(s=>type!=='パンツ'||!TAPE_ONLY_SIZES.includes(s))}
function babyProductLabel(kind=state.kind,type=state.type){return kind==='diaper'?'おむつ':kind==='milk'?(type==='液体'?'液体ミルク':type===OTHER?'ミルク':'粉ミルク'):'おしりふき'}
function babyChoiceError(s=state){
 if(!s.brand)return '商品・ブランドを選んでください';
 if(s.brand===OTHER&&!s.customBrand.trim())return 'ブランド名を入力してください';
 if(s.kind==='milk'&&(!s.series||(s.series===OTHER&&!s.customSeries.trim())))return '商品名を入力してください';
 if(s.kind!=='wipes'&&!s.type)return '種類を選んでください';
 if(s.type===OTHER&&!s.customType.trim())return '種類を入力してください';
 if(s.kind==='diaper'&&(!s.size||(s.size===OTHER&&!s.customSize.trim())))return 'サイズを選ぶか入力してください';
 if(s.series===OTHER&&!s.customSeries.trim()&&s.brand!==OTHER)return '商品名・シリーズを入力してください';
 if(s.kind!=='wipes'&&s.type!==OTHER&&!babyTypes(s.kind,s.brand,s.series).includes(s.type))return 'この商品の種類を選び直してください';
 if(s.kind==='diaper'&&s.type==='パンツ'&&TAPE_ONLY_SIZES.includes(s.size===OTHER?s.customSize.trim():s.size))return '新生児サイズはテープタイプのみです';
 return '';
}
const TOP={
 '食料品':['卵','牛乳','鶏むね肉','豚こま肉','玉ねぎ','にんじん','じゃがいも','トマト','キャベツ','ブロッコリー','バナナ','りんご','豆腐','納豆','食パン','米','鮭','ヨーグルト','冷凍うどん','麦茶','味噌','チーズ'],
 '日用品':['ティッシュ','トイレットペーパー','洗濯洗剤','柔軟剤','食器用洗剤','キッチンペーパー','ラップ','ゴミ袋','シャンプー','ハンドソープ','スポンジ','浴室洗剤','除菌シート'],
 'ベビー':['おしりふき','おしりふき詰替','ベビーソープ','ベビーローション','液体ミルク','哺乳瓶洗剤','オムツM'],
 '衛生・薬':['マスク','絆創膏','消毒液','歯ブラシ','歯磨き粉','綿棒','ハンドクリーム']
};
const LABEL={meat:'お肉',egg:'卵',vegetable:'野菜',fruit:'果物',milk:'牛乳・乳製品',bread:'パン',fish:'魚',rice:'ご飯・主食',frozen:'冷凍食品',beans:'豆腐・納豆',drink:'飲み物',season:'調味料',house:'日用品',paper:'紙製品',wash:'洗剤',baby:'ベビー',babyfood:'離乳食',laundry:'洗濯用品',kitchen:'キッチン用品',cleaning:'掃除用品',care:'お風呂・ケア',health:'衛生・薬',other:'その他'};
function groupsFor(cat){
 if(cat==='食料品')return ['すべて','meat','egg','vegetable','fruit','milk','fish','bread','rice','beans','frozen','drink','season','other'];
 if(cat==='日用品')return ['すべて','paper','laundry','kitchen','cleaning','care','other'];
 return ['すべて'];
}
function groupLabel(key){return key==='すべて'?'すべて':LABEL[key]||'その他'}
function isBabyFood(name){
 if(root.AtokoreBabyFood)return root.AtokoreBabyFood.isFood(name);
 const n=String(name||'').normalize('NFKC');
 return /離乳食|ベビーフード|栄養マルシェ|グーグーキッチン|手作り応援|らくらくまんま/.test(n)&&!/スプーン|フォーク|食器|エプロン|保存容器|調理器具/.test(n);
}
function subgroupOf(name,cat){
 const n=String(name||'').normalize('NFKC');
 if(cat==='食料品'){
  // Match the product's purpose before its ingredients, e.g. fish/vegetables in baby food.
  if(isBabyFood(n))return 'babyfood';
  if(/冷凍|アイス/.test(n))return 'frozen';
  const kind=kindOf(n,cat);return groupsFor(cat).includes(kind)?kind:'other';
 }
 if(cat==='日用品'){
  if(/ティッシュ|ペーパー|トイレットロール/.test(n))return 'paper';
  if(/洗濯|洗たく|柔軟|衣類用|おしゃれ着/.test(n))return 'laundry';
  if(/食器|台所|キッチン|ラップ|アルミホイル|クッキングシート|スプーン|フォーク|保存容器/.test(n))return 'kitchen';
  if(/掃除|浴室|風呂用洗剤|トイレ|カビ|床用|窓用|排水口|ゴミ袋|消臭|除湿|除菌|漂白/.test(n))return 'cleaning';
  if(/シャンプー|コンディショナー|リンス|ボディ|ハンドソープ|石けん|石鹸|せっけん|洗顔|入浴|歯ブラシ|歯磨き|ローション|クリーム/.test(n))return 'care';
  if(/スポンジ/.test(n))return 'kitchen';
 }
 return 'other';
}
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
 if(root.AtokoreBabyFood&&(cat==='離乳食'||isBabyFood(name)))return root.AtokoreBabyFood.icon();
 const babyKind=root.AtokoreBabyKit?.kind(name,cat);
 if(babyKind)return root.AtokoreBabyKit.icon(babyKind,42);
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
  const match=batchMatch(next,v);
  if(match){const qty=(Number(match.qty)||0)+v.qty;if(v.draftEdited)Object.assign(match,draftFields(v));match.qty=qty;continue}
  while(ids.has(unique))unique++;
  ids.add(unique);
  next.push({id:unique++,name:v.name,cat:v.cat,qty:v.qty,unit:v.unit,expType:'期限なし',exp:'',purchase:'',price:0,store:'',place:v.cat==='食料品'?'冷蔵庫':'収納',memo:'',usage:1,...(v.draftEdited?draftFields(v):{})});
 }
 return next;
}
function draftFields(v){const out={};for(const k of ['place','exp','expType','memo','minQty','purchase','store','price','qtyBasis','inUse'])if(v[k]!==undefined)out[k]=v[k];return out}
function batchMatch(list,v){return list.find(x=>x.name===v.name&&x.cat===v.cat&&x.unit===v.unit&&(v.draftEdited?(x.exp||'')===(v.exp||''):(!x.exp||x.expType==='期限なし')))}
const state={destination:'stock',cat:'ベビー',group:'すべて',query:'',showAll:false,view:'quick',tray:[],kind:'diaper',brand:'',type:'',size:'',series:'',customBrand:'',customType:'',customSize:'',customSeries:'',customUnit:'個',qty:1,committing:false,reviewing:false,pickScroll:0,afterSave:null,loadedSet:null,loadedSnapshot:'',routineTarget:null};
const food={maker:'',series:'',month:'',query:'',limit:24,selected:'',qty:1,customBrand:'',customSeries:'',customName:'',customAge:'',customAmount:'',customFormat:''};
function syncFoodInputs(){for(const field of ['Brand','Series','Name','Age','Amount','Format']){const input=$('qaFood'+field);if(input)food['custom'+field]=input.value}}
function foodInput(field,label,limit=45){return '<label>'+safe(label)+'<input id="qaFood'+field+'" maxlength="'+limit+'" value="'+safe(food['custom'+field])+'" autocomplete="off"></label>'}
function renderFood(){
 const el=$('qaBabyFood'),catalog=root.AtokoreBabyFood;if(!el||!catalog)return;
 const active=doc.activeElement?.id,position=doc.activeElement?.selectionStart;
 const selected=catalog.get(food.selected),maker=catalog.makers.find(m=>m.key===food.maker);
 const option=(key,label)=>'<button type="button" data-qa-food-maker="'+key+'" aria-pressed="'+(food.maker===key)+'">'+safe(label)+'</button>';
 let body='';
 if(food.maker==='other')body='<div class="qa-food-custom">'+foodInput('Brand','メーカー・手作りの名前',30)+foodInput('Series','シリーズ（任意）',35)+foodInput('Name','商品名',55)+foodInput('Age','商品に表示された月齢（任意）',18)+foodInput('Amount','内容量・個数（例：80g、80g×2）',25)+foodInput('Format','形状（パウチ・カップ・冷凍など）',15)+'</div>';
 else if(maker){
  const available=catalog.find({maker:food.maker,ended:!!maker.ended}),series=[...new Set(available.map(p=>p.series))];
  const list=catalog.find({maker:food.maker,series:food.series,month:food.month,query:food.query,ended:!!maker.ended});
  const shown=selected?list.filter(p=>p.id===selected.id):list.slice(0,food.limit);
  body=(maker.ended?'<p class="qa-food-ended">キユーピーは2026年8月末で育児食の生産終了。手元の商品を登録する場合の候補です。</p>':'')+
   '<label class="qa-food-series">② シリーズ<select id="qaFoodSeriesSelect"><option value="">すべてのシリーズ</option>'+series.map(s=>'<option'+(food.series===s?' selected':'')+'>'+safe(s)+'</option>').join('')+'</select></label>'+
   '<div class="qa-food-months" role="group" aria-label="商品の表示月齢"><button type="button" data-qa-food-month="" aria-pressed="'+(!food.month)+'">すべて</button>'+[...new Set(available.map(p=>p.month))].sort((a,b)=>a-b).map(m=>'<button type="button" data-qa-food-month="'+m+'" aria-pressed="'+(food.month===String(m))+'">'+safe(m<12?m+'か月頃':m===12?'12か月頃':'1歳'+(m-12)+'か月頃')+'</button>').join('')+'</div>'+
   '<label class="qa-food-search">商品名を検索<input id="qaFoodSearch" type="search" value="'+safe(food.query)+'" placeholder="例：おかゆ、しらす" autocomplete="off"></label>'+
   '<p class="qa-food-result">③ 商品を選ぶ（'+list.length+'件）</p><div class="qa-food-products">'+shown.map(p=>'<button type="button" data-qa-food-product="'+p.id+'" aria-pressed="'+(food.selected===p.id)+'"><strong>'+safe(p.name)+'</strong><small>'+safe(p.age)+'・'+safe(p.amount)+'・'+safe(p.format)+'</small></button>').join('')+(list.length?'':'<p>該当する商品がありません。月齢や検索条件を変えてください。</p>')+'</div>'+
   (selected?'<button type="button" data-qa-food-unselect class="qa-more">別の商品を選ぶ</button>':list.length>food.limit?'<button type="button" data-qa-food-more class="qa-more">さらに表示（残り'+(list.length-food.limit)+'件）</button>':'');
 }
 el.innerHTML='<div class="qa-baby-intro"><span class="qa-baby-intro-icon">'+catalog.icon(48)+'</span><span><strong>離乳食を追加</strong><small>メーカーから商品を選べます</small></span></div><div class="qa-subtitle">① メーカー</div><div class="qa-food-makers">'+catalog.makers.filter(m=>!m.ended).map(m=>option(m.key,m.name)).join('')+option('other','その他・手作り')+'</div><details class="qa-food-legacy"'+(maker?.ended?' open':'')+'><summary>生産終了品を登録する</summary><div class="qa-food-makers">'+catalog.makers.filter(m=>m.ended).map(m=>option(m.key,m.name+'（生産終了）')).join('')+'</div></details>'+body+
  (food.maker?'<p class="qa-food-selected">'+(food.maker==='other'?'入力した商品':selected?'選択中：'+safe(catalog.fullName(selected)):'商品はまだ選択していません')+'</p><div class="qa-baby-bottom"><label>数量 <span>表示の1商品を1個として数えます</span></label><div class="qa-step"><button type="button" data-qa-food-step="-1" aria-label="離乳食の数量を減らす">−</button><b>'+food.qty+'</b><button type="button" data-qa-food-step="1" aria-label="離乳食の数量を増やす">＋</button></div></div><button type="button" class="qa-baby-add" data-qa-food-add>＋ 追加予定に入れる</button><p class="qa-food-note">2個入りなども表示内容量の1商品で1個です。月齢・内容量はお手元の商品表示をご確認ください。まだ保存されません。</p>':'');
 if(active?.startsWith('qaFood')){const input=$(active);input?.focus({preventScroll:true});if(typeof position==='number'&&input?.type==='text')input.setSelectionRange?.(position,position)}
}
function addFood(){
 syncFoodInputs();try{
  let entry;
  if(food.maker==='other'){
   if(!food.customBrand.trim()||!food.customName.trim()||!food.customAmount.trim()||!food.customFormat.trim())throw Error('メーカー（手作りの名前）・商品名・内容量・形状を入力してください');
   entry={name:[food.customBrand,'離乳食',food.customSeries,food.customName,food.customAge,food.customAmount,food.customFormat].map(s=>s.trim()).filter(Boolean).join(' '),cat:'離乳食',qty:food.qty,unit:'個'};
  }else{
   const p=root.AtokoreBabyFood?.get(food.selected),maker=root.AtokoreBabyFood?.makers.find(m=>m.key===food.maker);
   if(!p||p.maker!==maker?.name)throw Error('商品を選んでください');
   entry=root.AtokoreBabyFood.line(p.id,food.qty);
  }
  addLine(entry);notify(PENDING_NOTICE);
 }catch(e){notify(e.message||'内容を確認してください')}
}
const destLabel=d=>state.routineTarget?'いつものリスト':d==='buy'?'買い物リスト':'ストック';
const commitLabel=()=>state.routineTarget?'選んだ商品をいつものリストに追加':'まとめて'+destLabel(state.destination)+'に追加';
const PENDING_NOTICE='追加予定に入れました（まだ保存されていません）。下の「追加した商品を確認する」から保存できます';
const traySnapshot=()=>JSON.stringify(state.tray.map(x=>[modelKey(x),x.qty]));
// Changing where the pending items go is allowed, but always said out loud.
function changeDestination(dest){
 if(state.routineTarget)return;
 const next=dest==='buy'?'buy':'stock';
 if(next!==state.destination&&state.tray.length)notify('追加予定の'+state.tray.length+'商品は「'+destLabel(next)+'」に保存されます');
 state.destination=next;renderDestination();renderTray();
}
function addLine(entry){
 const v=validateLine(entry),found=state.tray.find(x=>modelKey(x)===modelKey(v));
 if(found)found.qty=Math.min(999,found.qty+v.qty);
 else state.tray.push(v);
 renderTray();renderItems();
}
function renderNav(){
 const el=$('qaTabs');if(!el)return;
 const tabs=[['ベビー','ベビー'],['離乳食','離乳食'],['食料品','食品'],['日用品','日用品'],['衛生・薬','衛生・薬'],['その他','その他']];
 el.innerHTML=tabs.map(([cat,label])=>'<button type="button" class="'+(state.cat===cat?'selected':'')+'" data-qa-cat="'+safe(cat)+'">'+label+'</button>').join('');
}
function groupOptions(){
 return groupsFor(state.cat);
}
function renderGroups(){
 const el=$('qaGroups');if(!el)return;
 el.innerHTML=groupOptions().map(g=>'<button type="button" data-qa-group="'+safe(g)+'" class="'+(state.group===g?'selected':'')+'">'+(g==='すべて'?'すべて':LABEL[g])+'</button>').join('');
}
function listed(){
 const full=state.cat==='その他'?[...new Set(['子ども','衣類','家電・生活用品','防災'].flatMap(c=>catalog(c)).map(n=>n))]:catalog(state.cat);
 const q=state.query.trim().normalize('NFKC').toLocaleLowerCase('ja');
 const arr=full.filter(n=>(state.group==='すべて'||subgroupOf(n,state.cat)===state.group)&&(!q||n.normalize('NFKC').toLocaleLowerCase('ja').includes(q)));
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
function babyBrands(){return [...BABY[state.kind].brands,OTHER]}
function resetCustom(){for(const field of ['Brand','Type','Size','Series'])state['custom'+field]='';state.customUnit='個'}
function chooseBabyField(field,val){
 syncBabyInputs();
 if(field==='kind'){
  if(!BABY[val])return;
  state.kind=val;state.brand='';state.series='';state.type='';state.size='';resetCustom();
 }
 if(field==='brand'){
  if(!babyBrands().includes(val))return;
  state.brand=val;state.series=state.kind==='milk'?(MILK_PRODUCTS.find(x=>x.brand===val)?.name||OTHER):'';
  state.type='';resetCustom();
 }
 if(field==='product'){
  const product=MILK_PRODUCTS.find(x=>x.brand+'|'+x.name===val);if(!product)return;
  state.brand=product.brand;state.series=product.name;state.type='';resetCustom();
 }
 if(field==='brand'||field==='product'){
  const allowed=babyTypes();if(allowed.length===1)state.type=allowed[0];
 }
 if(field==='type'&&(val===OTHER||babyTypes().includes(val))){
  state.type=val;
  if(val==='パンツ'&&TAPE_ONLY_SIZES.includes(state.size)){state.size='';notify('新生児サイズはテープタイプのみです。サイズを選び直してください')}
 }
 if(field==='size'&&(val===OTHER||babySizes().includes(val)))state.size=val;
 if(field==='series')state.series=val;
 renderBaby();
}
function babyOption(field,value,label=value,extra=''){
 return '<button type="button" class="'+(state[field]===value?'selected':'')+'" data-qa-baby="'+field+'" data-value="'+safe(value)+'">'+safe(label)+extra+'</button>';
}
function customInput(field,label,placeholder='',limit=45){
 return '<label class="qa-custom-field">'+safe(label)+'<input id="qaBaby'+field+'" maxlength="'+limit+'" value="'+safe(state['custom'+field])+'" placeholder="'+safe(placeholder)+'" autocomplete="off"></label>';
}
function milkOptions(follow){
 return MILK_PRODUCTS.filter(x=>!!x.follow===follow).map(x=>{
  const first=MILK_PRODUCTS.find(p=>p.brand===x.brand)===x;
  const field=first?'brand':'product',value=first?x.brand:x.brand+'|'+x.name;
  const selected=state.brand===x.brand&&state.series===x.name;
  return '<button type="button" class="'+(selected?'selected':'')+'" data-qa-baby="'+field+'" data-value="'+safe(value)+'"><span>'+safe(x.name)+'</span><small>'+safe(x.brand)+'</small></button>';
 }).join('');
}
function renderBaby(){
 const el=$('qaBaby');if(!el)return;
 const b=state.kind,icon=kind=>root.AtokoreBabyKit?.icon(kind)||'';
 const brands=b==='milk'?'<div class="qa-subtitle">① 商品</div><div class="qa-brand-chips qa-milk-products">'+milkOptions(false)+'</div><details class="qa-followup"><summary>フォローアップミルク</summary><div class="qa-brand-chips qa-milk-products">'+milkOptions(true)+'</div></details><div class="qa-option-chips">'+babyOption('brand',OTHER)+'</div>':'<div class="qa-subtitle">① ブランド</div><div class="qa-brand-chips">'+babyBrands().map(n=>babyOption('brand',n)).join('')+'</div>';
 const customBrand=state.brand===OTHER?customInput('Brand','ブランド名','一覧にないブランド名')+(b==='milk'?customInput('Series','商品名','例：いつもの粉ミルク'):''):'';
 const types=b==='wipes'?'':'<div class="qa-subtitle">② 種類</div><div class="qa-option-chips">'+[...babyTypes(),OTHER].map(n=>babyOption('type',n)).join('')+'</div>'+(state.type===OTHER?customInput('Type','種類','例：大袋')+customInput('Unit','数える単位','例：袋',12):'');
 const sizes=b==='diaper'?'<div class="qa-subtitle">③ サイズ</div><div class="qa-option-chips">'+[...babySizes(),OTHER].map(n=>babyOption('size',n)).join('')+'</div>'+(state.size===OTHER?customInput('Size','サイズ','例：スーパービッグ'):''):'';
 const series=b==='milk'?'':'<div class="qa-subtitle">商品名・シリーズ（任意）</div><div class="qa-option-chips qa-lines">'+[...(SERIES[b]?.[state.brand]||[]),OTHER].map(n=>babyOption('series',n)).join('')+'</div>'+(state.series===OTHER?customInput('Series','商品名・シリーズ','例：いつものシリーズ'):'');
 el.innerHTML='<div class="qa-baby-intro"><span class="qa-baby-intro-icon">'+icon(b)+'</span><span><strong>'+({diaper:'おむつ',milk:'ミルク',wipes:'おしりふき'}[b])+'を追加</strong><small>'+({diaper:'ブランド・種類・サイズを選ぶだけ',milk:'商品名・種類を選ぶだけ',wipes:'ブランドを選ぶだけ'}[b])+'</small></span></div>'+
 '<div class="qa-baby-kind">'+[['diaper','おむつ'],['milk','ミルク'],['wipes','おしりふき']].map(([k,n])=>'<button type="button" class="'+(b===k?'selected':'')+'" data-qa-baby="kind" data-value="'+k+'">'+icon(k)+'<span>'+n+'</span></button>').join('')+'</div>'+brands+customBrand+types+sizes+series+
 '<div class="qa-baby-bottom"><label>数量 <span>パック・缶などの個数</span></label><div class="qa-step"><button data-qa-step="-1" type="button" aria-label="減らす">−</button><b id="qaBabyQty">'+state.qty+'</b><button data-qa-step="1" type="button" aria-label="増やす">＋</button></div></div>'+
 '<button type="button" class="qa-baby-add" data-qa-babyadd>＋ 追加予定に入れる</button><p class="qa-baby-save-note" id="qaBabySaveNote"></p>';
 // Keep the selected follow-up visible after changing forms or quantity.
 if(b==='milk'&&milkProduct()?.follow)el.querySelector('.qa-followup').open=true;
 renderDestination();
}
function addBaby(){
 syncBabyInputs();
 const problem=babyChoiceError();if(problem){notify(problem);return}
 const brand=chosen('brand'),series=chosen('series'),type=state.kind==='wipes'?'':chosen('type');
 const desc=[brand,series,babyProductLabel(),type,state.kind==='diaper'?chosen('size'):''].filter(Boolean).join(' ');
 try{
  addLine({cat:'ベビー',name:desc,qty:state.qty,unit:state.kind==='diaper'?'袋':state.kind==='wipes'?'パック':state.type===OTHER?(state.customUnit.trim()||'個'):state.type==='缶'?'缶':state.type==='液体'?'本':'箱'});
  notify(PENDING_NOTICE);
 }catch(e){notify('商品名は120文字以内で入力してください')}
}
// Pending lines are counted as products and as a total quantity, never mixed up.
function pendingSummary(lines=state.tray){return lines.length+'商品（数量の合計'+lines.reduce((sum,x)=>sum+x.qty,0)+'点）'}
// What the final button will do to each line, using the same matching rules as commit().
function stockMatch(v){return batchMatch(stockItems(),v)}
function buyMatch(v){let list=[];try{list=Array.isArray(buys)?buys:[]}catch(e){}return list.find(y=>y.name===v.name&&y.unit===v.unit)}
function lineEffect(v){
 if(state.routineTarget)return 'いつものリストに追加（在庫数は変わりません）';
 if(state.destination==='buy'){const found=buyMatch(v);return found?'買い物リストに登録済み：'+found.qty+v.unit+' → '+(Number(found.qty||0)+v.qty)+v.unit:'買い物リストに新しく追加'}
 const found=stockMatch(v);return found?'登録済みの在庫に合算：'+found.qty+v.unit+' → '+(Number(found.qty||0)+v.qty)+v.unit:'新しい商品として登録';
}
function lineDetails(v){
 const parts=[];
 if(root.AtokoreBabyFood&&(v.cat==='離乳食'||isBabyFood(v.name))){const d=root.AtokoreBabyFood.describe(v);parts.push(d.maker||'',d.age||'',d.amount||'',d.format||'')}
 else{const brand=root.AtokoreBabyKit?.brand?.(v.name);if(brand)parts.push(brand)}
 parts.push(v.cat,v.unit+'で数えます');
 return parts.filter(Boolean).join('／');
}
function renderTray(){
 const box=$('qaTray'),list=$('qaTrayList'),n=$('qaTotal'),button=$('qaCommit'),bar=$('qaBar');
 if(!box||!list)return;
 const lines=state.tray,count=lines.length;
 if(!count&&state.reviewing)setReviewing(false);
 // While choosing products only a compact bar is shown; the list and the final button live in the review screen.
 if(bar){bar.hidden=!count||state.reviewing;const label=$('qaBarCount');if(label)label.textContent='追加予定 '+lines.length+'商品・合計'+lines.reduce((sum,x)=>sum+x.qty,0)+'点'}
 box.hidden=!count||!state.reviewing;
 n.textContent=pendingSummary(lines);
 const dest=$('qaTrayDest');if(dest)dest.textContent='保存先：'+destLabel(state.destination);
 list.innerHTML=lines.map((v,i)=>'<div class="qa-tray-item qa-review-item"><span class="qa-tray-thumb">'+iconFor(v.name,v.cat)+'</span><div class="qa-review-copy"><button type="button" class="qa-review-name qa-review-edit" data-qa-edit="'+i+'" aria-label="'+safe(v.name)+'の追加予定を編集">'+safe(v.name)+' <span aria-hidden="true">✎</span></button><small>'+safe(lineDetails(v))+'</small><small class="qa-review-effect">'+safe(lineEffect(v))+'</small></div><div class="qa-review-controls"><div class="qa-step"><button type="button" data-qa-adjust="'+i+'" data-step="-1" aria-label="'+safe(v.name)+'の数量を減らす"'+(v.qty<=1?' disabled':'')+'>−</button><b>'+v.qty+'</b><button type="button" data-qa-adjust="'+i+'" data-step="1" aria-label="'+safe(v.name)+'の数量を増やす"'+(v.qty>=999?' disabled':'')+'>＋</button></div><button type="button" class="qa-remove" data-qa-remove="'+i+'" aria-label="'+safe(v.name)+'を追加予定から削除">削除</button></div></div>').join('');
 button.disabled=!count||state.committing;
 $('pg-add')?.classList.toggle('qa-has-pending',count>0);
}
function editPending(index){
 const line=state.tray[index];if(!line||state.committing)return;
 const found=stockMatch(line),draft={place:line.cat==='食料品'?'冷蔵庫':'収納',expType:'期限なし',exp:'',...(found||{}),...line,id:index+1};
 root.atokoreEditStock?.(draft.id,{item:draft,onSave:next=>{
  if(next.qty<1||next.qty>999)throw Error('追加する数量は1〜999で指定してください');
  state.tray[index]={...line,name:next.name,cat:next.cat,unit:next.unit,qty:next.qty,...draftFields(next),draftEdited:true};
  renderTray();renderItems();
 },onCancel:()=>renderTray()});
 const qty=doc.querySelector('#atkEditForm [name="qty"]');if(qty){qty.min='1';qty.max='999';qty.parentNode.firstChild.textContent='追加する数量'}
}
function setReviewing(on){
 const page=$('pg-add');
 if(on&&!state.reviewing)state.pickScroll=root.scrollY||0;
 state.reviewing=!!on;
 page?.classList.toggle('qa-reviewing',state.reviewing);
}
// Opening, closing and leaving the review never changes saved data; only the final button does.
function openReview(){
 if(!state.tray.length)return;
 setReviewing(true);renderTray();renderDestination();
 $('qaNotice')?.classList.remove('on');
 try{root.scrollTo?.(0,0)}catch(e){}
 $('qaReviewTitle')?.focus?.({preventScroll:true});
}
function closeReview(){
 if(!state.reviewing)return;
 const top=state.pickScroll;
 setReviewing(false);renderTray();
 try{root.scrollTo?.(0,top)}catch(e){}
}
function notify(msg){
 let x=$('qaNotice');
 if(!x){x=doc.createElement('div');x.id='qaNotice';x.className='qa-notice';x.setAttribute('role','status');doc.body.appendChild(x)}
 x.textContent=msg;x.classList.add('on');clearTimeout(notify.timer);
 notify.timer=setTimeout(()=>x.classList.remove('on'),2200);
}
// Writes the pending lines. Throws (and changes nothing) unless the new state is confirmed stored.
function persist(tray){
 root.AtokoreDataSafety?.assertWritable?.();
 if(state.routineTarget){
  if(state.routineTarget.onCommit(tray)!==true)throw Error('いつものリストを保存できませんでした');
  return {merged:0,ids:[]};
 }
 const key='atokoreTrialV4',store=root.localStorage;
 if(state.destination==='buy'){
  const nextBuys=buys.map(x=>({...x})),ids=new Set(nextBuys.map(x=>Number(x.id)));let merged=0,sequence=Date.now();
  for(const x of tray){const found=nextBuys.find(y=>y.name===x.name&&y.unit===x.unit);
   if(found){found.qty=Number(found.qty||0)+x.qty;merged++}
   else{while(ids.has(sequence))sequence++;ids.add(sequence);nextBuys.push({id:sequence++,name:x.name,qty:x.qty,unit:x.unit,cat:x.cat})}
  }
  const raw=JSON.stringify({items,buys:nextBuys,routines});
  store.setItem(key,raw);if(store.getItem(key)!==raw)throw Error('保存結果を確認できませんでした');
  buys=nextBuys;
  return {merged,ids:[]};
 }
 const before=stockItems(),next=buildBatch(before,tray);
 const raw=JSON.stringify({items:next,buys,routines});
 store.setItem(key,raw);if(store.getItem(key)!==raw)throw Error('保存結果を確認できませんでした');
 items=next;
 // Ids of every record this batch created or added to (one per line), so the list can show them.
 const byLine=tray.map(v=>batchMatch(next,v)?.id??null);
 return {merged:tray.length-(next.length-before.length),ids:byLine.filter(id=>id!=null),byLine};
}
// The list opens right under the finger after a save; a fast second tap on the final button must not
// land on whatever appears there (a card's −/＋, a filter, a header button). Only taps near the spot
// of the saving tap, within a double-tap interval, are absorbed; anything else works normally.
function absorbStrayTaps(origin,ms=400){
 if(!doc||!origin||!origin.detail)return;
 const x=origin.clientX,y=origin.clientY,landed=doc.querySelector('.page.on')?.id;
 const stop=e=>{
  if(doc.querySelector('.page.on')?.id!==landed){doc.removeEventListener('click',stop,true);return}
  if(Math.hypot(e.clientX-x,e.clientY-y)<=48){e.preventDefault();e.stopImmediatePropagation()}
 };
 doc.addEventListener('click',stop,true);setTimeout(()=>doc.removeEventListener('click',stop,true),ms);
}
function commit(origin){
 // Only the button on the review screen saves; the list must have been shown to the user first.
 if(state.committing||!state.tray.length||!state.reviewing)return false;
 state.committing=true;renderTray();
 const tray=state.tray.map(x=>({...x})),target=state.routineTarget,dest=state.destination;
 let result;
 try{result=persist(tray)}
 catch(err){
  // Nothing was stored: keep the pending lines and the review screen so the user can retry.
  state.committing=false;renderTray();
  notify('保存できませんでした。追加予定はそのまま残っています。内容を確認して、もう一度お試しください。');
  root.console?.error?.('あとこれ一括登録に失敗',err);
  return false;
 }
 // Saved. From here on a drawing problem must never be reported as a failed save (that would invite a second add).
 const afterSave=state.afterSave;
 try{root.AtokoreHistory?.add(target?'いつものリストに商品を追加':dest==='buy'?'買い物リストへ追加':'ストックに商品を追加',tray.slice(0,2).map(x=>x.name).join('、')+(tray.length>2?' ほか'+(tray.length-2)+'商品':''),target?'routine':dest==='buy'?'buy':'stock','＋')}catch(e){root.console?.warn?.('あとこれ: 操作履歴を表示できませんでした',e)}
 state.tray=[];state.committing=false;state.loadedSet=null;state.loadedSnapshot='';state.afterSave=null;
 if(target)state.routineTarget=null;
 let displayFailed=false;
 const step=fn=>{try{fn()}catch(e){displayFailed=true;root.console?.error?.('あとこれ: 保存後の表示更新に失敗',e)}};
 step(()=>{setReviewing(false);renderTray();renderItems();renderDestination()});
 let message;
 if(target){
  step(()=>root.renderRoutines?.());
  step(()=>{root.go?.('buy');root.openRoutine?.(target.id,true)});
  message=tray.length+'商品を「いつものリスト」に保存しました。在庫数は変更していません';
 }else{
  step(()=>root.render?.());
  step(()=>root.go?.(dest==='buy'?'buy':'stock'));
  if(dest!=='buy')step(()=>root.AtokoreBabyFlow?.revealStock?.(result.ids));
  message=pendingSummary(tray)+'を'+destLabel(dest)+'に保存しました'+(result.merged?'（うち'+result.merged+'商品は登録済みの商品に数量を合算）':'');
 }
 step(()=>absorbStrayTaps(origin));
 // The caller that handed these lines over (e.g. the receipt screen) may record follow-ups; the
 // stock itself is already saved, so a failure here is reported but never undoes the save.
 if(typeof afterSave==='function')step(()=>afterSave({lines:tray,byLine:result.byLine||[],destination:dest}));
 notify(message+(displayFailed?'。画面の更新に失敗しました。再読み込みすると表示されます（もう一度追加する必要はありません）':''));
 return true;
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
function renderAll(){renderNav();renderGroups();renderItems();renderRecent();renderBaby();renderFood();renderTray();switchCatVisibility();renderDestination()}
function switchCatVisibility(){
 const baby=state.cat==='ベビー',babyfood=state.cat==='離乳食';
 $('qaBaby')?.classList.toggle('qa-hidden',!baby);
 $('qaBabyFood')?.classList.toggle('qa-hidden',!babyfood);
 $('qaCatalogSection')?.classList.toggle('qa-hidden',baby||babyfood);
 $('qaRecent')?.classList.toggle('qa-hidden',baby||babyfood);
}
function setup(){
 const p=$('pg-add');if(!p)return;
 doc.body.classList.add('atk-v14');
 const pane=doc.createElement('section');pane.id='qaPanel';pane.className='qa-panel';
 pane.innerHTML='<div class="qa-routine-pick-head" id="qaRoutinePicker" hidden><button type="button" data-qa-routine-back>← いつものリストに戻る</button><strong>いつものリストに商品を追加</strong><p>選んだ商品はストック数を増やさず、このリストだけに保存します。</p></div>'+
 '<div class="qa-heading"><strong>商品を選んで、まとめて追加</strong><span>おむつ・ミルク・おしりふきをかんたん登録。食品・日用品も使えます</span></div>'+ 
 '<div class="bf-destination" id="bfDestination"><button type="button" data-qa-dest="stock">ストックに追加</button><button type="button" data-qa-dest="buy">買い物リストに追加</button></div>'+ 
 '<div class="qa-main"><div id="qaTabs" class="qa-category-tabs"></div>'+
 '<div id="qaCatalogSection"><div class="qa-search"><span>⌕</span><input id="qaSearch" type="search" placeholder="商品名を検索" autocomplete="off" aria-label="商品名を検索"></div><div id="qaGroups" class="qa-group-tabs"></div><div class="qa-subtitle">タップすると追加予定に入ります</div><div id="qaTiles" class="qa-tiles"></div><button id="qaMore" data-qa-more class="qa-more" hidden type="button">さらに表示</button><div class="qa-free"><input id="qaFree" placeholder="リストにない商品名を入力" maxlength="120"><button type="button" data-qa-free>＋追加</button></div></div>'+
 '<div id="qaBaby" class="qa-baby"></div><div id="qaBabyFood" class="qa-babyfood"></div><div id="qaRecent"></div></div>'+
 '<button type="button" id="qaBar" class="qa-bar" data-qa-review hidden><span class="qa-bar-open">追加した商品を確認する</span><span class="qa-bar-count" id="qaBarCount"></span></button>';
 const heading=p.querySelector('.atk-page-title');
 if(heading)heading.insertAdjacentElement('afterend',pane);else p.prepend(pane);
 p.classList.add('qa-quick-mode');
 // Review screen: replaces the product picker (which stays in the DOM, so search and choices are kept).
 const tray=doc.createElement('section');tray.id='qaTray';tray.className='qa-review';tray.hidden=true;tray.setAttribute('aria-labelledby','qaReviewTitle');
 tray.innerHTML='<button type="button" class="qa-review-back" data-qa-review-back>← 商品選びに戻る</button><h2 id="qaReviewTitle" tabindex="-1">追加する商品の確認</h2><p id="qaTotal" class="qa-review-total"></p>'+
  '<div class="qa-review-dest"><p id="qaTrayDest" class="qa-tray-dest"></p><div class="qa-review-dest-switch" role="group" aria-label="保存先"><button type="button" data-qa-dest="stock">ストック</button><button type="button" data-qa-dest="buy">買い物リスト</button></div></div>'+
  '<div id="qaTrayList" class="qa-review-list"></div>'+
  '<p class="qa-review-note" id="qaReviewNote">下のボタンを押すまで保存されません。</p><button id="qaCommit" type="button" data-qa-commit>まとめて登録する</button>'+
  '<button type="button" class="qa-review-clear" data-qa-clear>追加予定を全部取り消す</button>';
 p.appendChild(tray);
 renderAll();
 $('qaBaby').addEventListener('input',syncBabyInputs);
 $('qaBabyFood').addEventListener('input',e=>{syncFoodInputs();if(e.target.id==='qaFoodSearch'){food.query=e.target.value;food.selected='';food.limit=24;renderFood()}});
 $('qaBabyFood').addEventListener('change',e=>{if(e.target.id==='qaFoodSeriesSelect'){food.series=e.target.value;food.selected='';food.limit=24;renderFood()}});
 $('qaBabyFood').addEventListener('click',e=>{
  const button=e.target.closest('button');if(!button)return;syncFoodInputs();
  if(button.hasAttribute('data-qa-food-maker')){const key=button.dataset.qaFoodMaker;if(key!=='other'&&!root.AtokoreBabyFood?.makers.some(m=>m.key===key))return;food.maker=key;food.series='';food.month='';food.query='';food.selected='';food.limit=24;renderFood()}
  else if(button.hasAttribute('data-qa-food-month')){food.month=button.dataset.qaFoodMonth;food.selected='';food.limit=24;renderFood()}
  else if(button.hasAttribute('data-qa-food-product')){const p=root.AtokoreBabyFood?.get(button.dataset.qaFoodProduct);if(p&&root.AtokoreBabyFood.makerOf(p.maker)===food.maker){food.selected=p.id;renderFood()}}
  else if(button.hasAttribute('data-qa-food-more')){food.limit+=24;renderFood()}
  else if(button.hasAttribute('data-qa-food-unselect')){food.selected='';renderFood()}
  else if(button.hasAttribute('data-qa-food-step')){food.qty=Math.max(1,Math.min(99,food.qty+Number(button.dataset.qaFoodStep)));renderFood()}
  else if(button.hasAttribute('data-qa-food-add'))addFood();
 });
 $('qaSearch').addEventListener('input',e=>{state.query=e.target.value;state.showAll=false;renderItems()});
 $('qaFree').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();addFree()}});
 const originalOpen=root.atkOpenAdd;
 root.atkOpenAdd=function(){openQuick()};
 doc.addEventListener('click',e=>{
  const btn=e.target.closest?.('[data-qa-cat],[data-qa-group],[data-qa-pick],[data-qa-more],[data-qa-recent],[data-qa-baby],[data-qa-step],[data-qa-babyadd],[data-qa-free],[data-qa-adjust],[data-qa-remove],[data-qa-clear],[data-qa-commit],[data-qa-dest],[data-qa-routine-back],[data-qa-review],[data-qa-review-back],[data-qa-edit]');
  if(!btn||!p.contains(btn))return;
  if(btn.hasAttribute('data-qa-edit')){editPending(Number(btn.dataset.qaEdit));return}
  if(btn.hasAttribute('data-qa-routine-back')){cancelRoutinePicker(true);return}
  if(btn.hasAttribute('data-qa-review')){openReview();return}
  if(btn.hasAttribute('data-qa-review-back')){closeReview();return}
  if(btn.dataset.qaDest){changeDestination(btn.dataset.qaDest);return}
  if(btn.dataset.qaCat){state.cat=btn.dataset.qaCat;state.group='すべて';state.query='';state.showAll=false;$('qaSearch').value='';renderAll();return}
  if(btn.dataset.qaGroup){state.group=btn.dataset.qaGroup;state.showAll=false;renderGroups();renderItems();return}
  if(btn.hasAttribute('data-qa-pick')){const name=btn.dataset.qaPick,cat=btn.dataset.qaTilecat;addLine({name,cat,qty:1,unit:defaultUnit(name,cat)});return}
  if(btn.id==='qaMore'){state.showAll=true;renderItems();return}
  if(btn.hasAttribute('data-qa-recent')){const item=$('qaRecent').__qaItems[Number(btn.dataset.qaRecent)];if(item)addLine({name:item.name,cat:item.cat,qty:1,unit:item.unit});return}
  if(btn.dataset.qaBaby){chooseBabyField(btn.dataset.qaBaby,btn.dataset.value);return}
  if(btn.hasAttribute('data-qa-step')){syncBabyInputs();state.qty=Math.max(1,Math.min(99,state.qty+Number(btn.dataset.qaStep)));renderBaby();return}
  if(btn.hasAttribute('data-qa-babyadd')){addBaby();return}
  if(btn.hasAttribute('data-qa-free')){addFree();return}
  if(btn.hasAttribute('data-qa-adjust')){const i=Number(btn.dataset.qaAdjust),v=state.tray[i];if(v){v.qty=Math.max(1,Math.min(999,v.qty+Number(btn.dataset.step)));renderTray();renderItems()}return}
  if(btn.hasAttribute('data-qa-remove')){state.tray.splice(Number(btn.dataset.qaRemove),1);renderTray();renderItems();return}
  if(btn.hasAttribute('data-qa-clear')){if(root.confirm?.('追加予定をすべて取り消しますか？（保存済みの在庫は変わりません）')){state.tray=[];state.afterSave=null;renderTray();renderItems()}return}
  if(btn.hasAttribute('data-qa-commit')){commit(e)}
 });
 function addFree(){
  const raw=$('qaFree').value.trim();if(!raw){notify('商品名を入力してください');return}
  const cat=state.cat;
  addLine({name:raw,cat,qty:1,unit:defaultUnit(raw,cat)});$('qaFree').value='';
 }
 const oldGo=root.go;
 if(typeof oldGo==='function')root.go=function(page,...rest){if(page!=='add'&&state.routineTarget&&!cancelRoutinePicker(false))return false;if(page!=='add'&&state.reviewing){setReviewing(false);renderTray()}const result=oldGo.call(this,page,...rest);if(page==='add'){if(state.view==='quick')p.classList.remove('qa-details-mode');renderAll()}return result};
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
 const routine=!!state.routineTarget;
 const heading=$('qaRoutinePicker');
 if(heading)heading.hidden=!routine;
 node.hidden=routine;
 $('pg-add')?.classList.toggle('qa-routine-picking',routine);
 doc.querySelectorAll('#pg-add [data-qa-dest]').forEach(x=>{const on=x.dataset.qaDest===state.destination;x.classList.toggle('selected',on);x.setAttribute('aria-pressed',String(on))});
 const switcher=doc.querySelector('#qaTray .qa-review-dest-switch');if(switcher)switcher.hidden=routine;
 const button=$('qaCommit');if(button)button.textContent=commitLabel();
 const baby=$('qaBaby')?.querySelector('[data-qa-babyadd]');
 if(baby)baby.textContent='＋ 追加予定に入れる';
 const note=$('qaBabySaveNote');
 if(note)note.textContent='まだ保存されません。「追加した商品を確認する」で内容を確かめ、最後に「'+commitLabel()+'」を押すと保存されます。';
 const dest=$('qaTrayDest');if(dest)dest.textContent='保存先：'+destLabel(state.destination);
 const review=$('qaReviewNote');if(review)review.textContent='「'+commitLabel()+'」を押すまで保存されません。'+(routine?'ストック数・買い物リストは変わりません。':'');
}
function cancelRoutinePicker(returnToList=false){
 if(!state.routineTarget)return true;
 if(state.tray.length&&!root.confirm?.('まだ保存していない商品があります。選択を破棄して戻りますか？'))return false;
 const target=state.routineTarget;
 state.routineTarget=null;state.tray=[];state.loadedSet=null;state.loadedSnapshot='';state.afterSave=null;
 setReviewing(false);renderTray();renderDestination();
 if(returnToList){root.go?.('buy');root.openRoutine?.(target.id,true)}
 return true;
}
function openRoutinePicker(id,onCommit){
 if(!Number.isSafeInteger(Number(id))||typeof onCommit!=='function')return false;
 if(state.tray.length&&!root.confirm?.('追加予定の商品があります。破棄して「いつものリスト」の商品を選びますか？'))return false;
 state.tray=[];state.loadedSet=null;state.loadedSnapshot='';state.afterSave=null;setReviewing(false);
 state.routineTarget={id:Number(id),onCommit};
 state.destination='stock';
 openQuick();setCategory('ベビー');renderDestination();
 return true;
}
function openWithEntries(entries,destination='stock',options={}){
 const list=Array.isArray(entries)?entries:[];
 const setId=options&&options.setId!=null?String(options.setId):null;
 if(!list.length){changeDestination(destination);openQuick();return}
 // The same set, untouched since it was loaded: never add its quantities a second time.
 if(setId!==null&&state.loadedSet===setId&&state.loadedSnapshot===traySnapshot()){
  changeDestination(destination);openQuick();openReview();
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
 state.afterSave=typeof options?.onSaved==='function'?options.onSaved:null;
 state.destination=destination==='buy'?'buy':'stock';
 openQuick();openReview();renderItems();
 if(skipped)notify(skipped+'件は内容を確認できなかったため読み込みませんでした');
}
function setCategory(cat){state.cat=cat;state.group='すべて';state.query='';state.showAll=false;if($('qaSearch'))$('qaSearch').value='';renderAll()}
const api=Object.freeze({openReview,closeReview,isReviewing(){return state.reviewing},kindOf,groupsFor,groupLabel,subgroupOf,isBabyFood,iconFor,buildBatch,validateLine,modelKey,openWithEntries,setCategory,openRoutinePicker,cancelRoutinePicker,isRoutinePicker(){return !!state.routineTarget},setDestination(dest){changeDestination(dest)},getTray(){return state.tray.map(x=>({...x}))}});
if(typeof module!=='undefined'&&module.exports)module.exports=api;
root.AtokoreQuickAdd=api;
if(doc&&typeof window!=='undefined')setup();
})(typeof globalThis!=='undefined'?globalThis:this);
