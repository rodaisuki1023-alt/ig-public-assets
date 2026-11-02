/* Atokore v49 receipt structure — stage 3 of reading a receipt. Pure logic, no network.
 * Input: OCR lines (text + confidence). Output: which lines are products, how many of each were
 * bought, where the item list ends and how many items the receipt itself says were bought.
 * Product names are not interpreted here (receipt.js names them); this only decides structure.
 *
 * Japanese POS receipts share a small set of layouts, whatever the store:
 *   name ... price                       (most stores; price may carry 外/内/軽/※/* or E/T)
 *   name / "2コ X 単68 ¥136"             (quantity line after a name without price)
 *   name ... total / "(2個 x @198)"      (quantity line after a priced name)
 *   name / "990@ × 4個 ¥3,960"           (unit price first)
 *   name / "code 1● unit total E"         (warehouse clubs; "280-E" is a coupon)
 * A line is never a product because of its position alone, and nothing after the subtotal, total or
 * tax summary is read.
 */
(function(root){
'use strict';
// The OCR model is shared with Chinese: map the simplified forms it sometimes prints for receipt
// vocabulary back to Japanese. Only words that appear on receipts; product names are left alone.
const CJK={'单':'単','现':'現','对':'対','拔':'抜','费':'費','计':'計','额':'額','价':'価','买':'買','录':'録','錄':'録','时':'時','间':'間','产':'産','点':'点','张':'張','币':'幣','东':'東','红':'紅','马':'馬','鸡':'鶏','鱼':'魚','盐':'塩','烧':'焼','酱':'醤','发':'発','记':'記','產':'産','國':'国','會':'会','價':'価','雞':'鶏','税込':'税込'};
function fixCjk(s){return String(s).replace(/[单现对拔费计额价买录錄时间产张币东红马鸡鱼盐烧酱发记產國會價雞]/g,c=>CJK[c]||c)}
function hw(s){return fixCjk(String(s??'').normalize('NFKC')).replace(/，/g,',').replace(/￥/g,'¥').replace(/[×✕✖]/g,'x').replace(/[‐‑–—―]/g,'-')}

// Stage 3a: tidy one line. Table texture and paper edges come back as | 」 [ _ and similar marks at
// the ends of lines; they are dropped. Text is otherwise kept as read.
function clean(raw){
 let s=hw(raw).replace(/[\t　]+/g,' ').replace(/\s+/g,' ').trim();
 for(let i=0;i<3;i++)s=s.replace(/^[|｜!¦「」『』\[\]_~`'",.:;\\/]+\s*/,'').replace(/\s*[|｜!¦「」『』\[\]_~`'",:;\\/]+$/,'').trim();
 return s;
}
// A price at the end of the line: optional currency mark (OCR reads ¥ as \ Y y W and the
// reduced-rate * as x), digits, optional tax or club marks. Trailing "-" or a leading "-" is a deduction.
const PRICE=/(^|[\s¥\\])(-)?\s*(?:[¥\\YyW]\s*)?[*＊※]?\s*(\d{1,3}(?:[,.]\d{3})+|\d{1,6})\s*(-)?\s*(円)?\s*(?:[外内軽非※*＊%xX]|-?\s?[ET])?\s*\)?$/;
function priceTail(s){
 const m=s.match(PRICE);if(!m)return null;
 // The currency mark belongs to the price, not to the name before it ("…特¥198外").
 const index=m.index+(/[¥\\]/.test(m[1])?0:m[1].length),value=Number(m[3].replace(/[,.]/g,''));
 // A number glued to a word is part of the name ("ミートボール2", "1LX15"), not a price.
 const marked=/[¥\\YyW*＊※]/.test(s.slice(index,index+3))||/[外内軽非※*＊ET%]\)?$/.test(s)||m[2]||m[4]||m[5];
 if(!marked&&m[1]==='')return null;
 // ※ after a price is sometimes read as X ("¥99X"); only accepted after a currency mark.
 if(/[xX]\)?$/.test(s)&&!/[¥\\]/.test(s.slice(Math.max(0,index-1),index+3)))return null;
 return {index,value,negative:!!(m[2]||m[4]),marked:!!marked};
}
const COUNT_WORD='(?:コ|個|ケ|ヶ|ヵ|カ|点|本|袋|パック|枚|入)';
// Stage 3b: quantity lines. Returns the purchase quantity and, when both are printed, checks it
// against unit price × quantity = line total (the arithmetic wins over a misread digit).
function quantityLine(raw){
 const s=hw(raw).replace(/\s+/g,' ').trim().replace(/^\(\s*|\s*\)$/g,'').trim();
 let qty=null,unit=null,total=null,m;
 // "2コ X 単68 ¥136", "2. x単98 ¥196" (コ read as .), "2個 x @198", "2個 x 0198" (@ read as 0); the space before
 // the total may be missing when the print is proportional ("2コ X単98¥196", v49 2nd audit).
 if((m=s.match(new RegExp('^(\\d{1,2})\\s*(?:'+COUNT_WORD+'|\\.)?\\s*[xX]\\s*(?:単価?|@|[06](?=\\d{2,}))?\\s*[¥\\\\]?\\s*(\\d[\\d,]*)(?:\\s*円)?(?:(?:\\s+[¥\\\\]?|\\s*[¥\\\\])\\s*(\\d[\\d,]*))?\\s*[外内※*＊]?$'))))[qty,unit,total]=[+m[1],+m[2].replace(/,/g,''),m[3]?+m[3].replace(/,/g,''):null];
 // "@160 x 2個", "990@ x 4個 ¥3,960", "単98 x 2コ"
 else if((m=s.match(new RegExp('^(?:単価?|@)?\\s*[¥\\\\]?\\s*(\\d[\\d,]*)\\s*@?\\s*[xX]\\s*(\\d{1,2})\\s*'+COUNT_WORD+'(?:(?:\\s+[¥\\\\]?|\\s*[¥\\\\])\\s*(\\d[\\d,]*))?\\s*[外内※*＊]?$'))))[unit,qty,total]=[+m[1].replace(/,/g,''),+m[2],m[3]?+m[3].replace(/,/g,''):null];
 if(qty===null)return null;
 if(unit&&total){const r=total/unit;if(Number.isInteger(r)&&r>=1&&r<=30)qty=r}
 if(!(qty>=1&&qty<=30))return null;
 return {qty,unitPrice:unit,total,checked:!!(unit&&total&&unit*qty===total)};
}
// Warehouse-club item line under the name: item code, quantity, unit price, total, tax letter.
function clubLine(raw){
 const s=hw(raw).replace(/\s+/g,' ').trim();
 // Thousands are printed or read with "," or "." ("1.398"); the circle after the quantity is often read as 0.
 // Amounts may also be printed without separators ("1000", "12800").
 const AMT='(\\d{1,3}(?:[,.]\\d{3})+|\\d{1,7})';
 const m=s.match(new RegExp('^\\d{3,8}\\s+(\\d{1,2})\\s*[●•oOe@°]?\\s+'+AMT+'\\s+'+AMT+'\\s*(-)?\\s*-?\\s*[ET]?$','i'));
 if(!m)return null;
 const unit=+m[2].replace(/[,.]/g,''),total=+m[3].replace(/[,.]/g,'');let qty=+m[1];
 if(unit&&total){const r=total/unit;if(Number.isInteger(r)&&r>=1&&r<=30)qty=r}
 if(!(qty>=1&&qty<=30))qty=1;
 return {qty,unitPrice:unit,total,coupon:!!m[4],checked:unit*qty===total};
}
// Large-print 計 is often read as two characters (言十, 叶十, 計十) or a lookalike: read back only right
// after 小 or 合, never inside product names.
function fixKei(s){return s.replace(/^([*＊※#＃【\[(（]*)(小|合)(?:言十|叶十|計十|叶|吋|言卜|計)/,'$1$2計')}
function isSubtotal(raw){const s=fixKei(hw(raw).replace(/[\s　]+/g,'').replace(/^[|｜!！*＊※#＃:：【\[(（]+/,''));return /^(?:(?:お?買(?:い?上げ|上)|商品|課税対象|税抜|税込|軽減税率対象|8%対象|10%対象))?小計(?=$|[/:：¥Y\d(（】\]]|\d*点)/i.test(s)}
function isTotal(raw){const s=fixKei(hw(raw).replace(/[\s　]+/g,''));return /^(?:[*＊※#＃【\[]+)?合計(?=$|[:：¥Y\d】\]])/i.test(s)||/^\*{2,}合計/.test(s)}
// Tax summary and payment lines also close the item list (some receipts print no subtotal, and a
// large-print 合計 is easily misread).
function isTaxSummary(raw){const s=hw(raw).replace(/[\s　]+/g,'');return /^\(?(?:外税|内税|消費税|税率|課税|非課税|本体|税抜|税込)\S{0,6}\d{1,2}%/.test(s)||/^\(?\d{1,2}%(?:外税|内税|対象|税)/.test(s)||/^(?:お預り|お預かり|お釣り?|釣銭|クレジット|現金)(?:合計)?[¥Y\d]/.test(s)}
// The number of items the receipt says were bought ("お買上点数 9点", "小計/ 6点", "10点買", "御買上げ点数 : 15").
function printedCount(raw){
 const s=hw(raw).replace(/\s+/g,'');
 let m=s.match(/(?:買上げ?|買い上げ|お買上|御買上げ?)点数[:：]?(\d{1,3})点?/)||s.match(/^【?小計】?\/?(\d{1,3})点/)||s.match(/(?:^|\D)(\d{1,3})点買/)||s.match(/^小計.*?(\d{1,3})点/);
 return m?+m[1]:null;
}
const META=/合計|小計|税込|税抜|消費税|内税|外税|税率|お預|預り|お釣|釣銭|おつり|クレジット|電子マネー|ポイント|値引|割引|クーポン|レジ(?:No|番号|担当|係|\s|$|[:：#])|担当|責[:：]|セルフレジ|精算機|お会計券|TEL|電話|領収|商品点数|買上点数|点数|商品コード|商品番号|品番|現金|カード|支払|決済|対象額|対象金額|本体価格|お会計|レシート|取引|会員|バーコード|JAN|登録番号|インボイス|営業時間|定休日|住所|郵便|毎度|ありがとう|返品|交換|伝票|発行日時|スキャンNo|ストアNo|承認|有効期限|累計|残高|ビザ|マスター|VISA|MASTER|様$|BOTTOM OF BASKET|ITEM COUNT|WHOLESALE|THANK YOU|売上$/i;
function isMeta(s){return META.test(s)||/(?:20\d{2}|\b\d{2})\s*[\/\-.年]\s*\d{1,2}\s*[\/\-.月]\s*\d{1,2}|\b\d{1,2}:\d{2}(?::\d{2})?\b|〒\s*\d{3}[-ー]\d{4}|(?:^|\s)No\.?\s*\d{4,}|\d{2,4}-\d{2,4}-\d{3,4}/i.test(s)}
const DISCOUNT=/値引|割引|引き|クーポン|\bCPN\b|\bIRC\b|特売|まとめ売り|まとめ値引|ポイント値引|会員値引|見切/i;
function letters(s){return (s.match(/[ぁ-んァ-ヶ一-龠々ーA-Za-z]/g)||[]).length}
function jpLetters(s){return (s.match(/[ぁ-んァ-ヶ一-龠々]/g)||[]).length}
function nameLike(s){const t=s.replace(/[\d\s.,¥\\%*＊※()（）\-]/g,'');return jpLetters(t)>=2||(/[A-Za-z]{3,}/.test(t)&&letters(t)>=3)||/^(?:米|卵|麺|塩|酢|油|茶|豆|葱)$/.test(t)||/^[A-Za-z]{1,3}-?\d{1,3}$/.test(s.trim())}
const JAN=/^\d{8,14}(?:\s|$)/;
const SUM_DOUBTS=['金額がそれまでの合計とほぼ同じ（小計の読み違いの可能性）','小計とみられる行より後に読み取った行'];
// Within 98-111% of the items so far: the subtotal, or the total with 8-10% tax.
function nearSum(v,sum){return v>=Math.round(sum*0.98)&&v<=Math.round(sum*1.11)}
// A label that can only be a misread 小計/合計 (large print split or misread) or has no letters at all.
function subtotalLike(name){const t=fixKei(hw(name).replace(/[\s　|｜!！*＊※#＃:：【】\[\]()（）.・-]/g,''));return letters(t)===0||/^[小合](?:計|言|叶|吋|十|卜|ト|言十|叶十|言卜|計十)?$/.test(t)||/^(?:十|計|言十|叶十|計十)$/.test(t)}

// Stage 3c: classify every line, then assemble products with their quantities.
function structure(lines){
 const L=(lines||[]).map(l=>({text:clean(typeof l==='string'?l:l.text),confidence:typeof l==='object'&&Number.isFinite(l?.confidence)?l.confidence:null,minScore:typeof l==='object'&&Number.isFinite(l?.minScore)?l.minScore:null,area:typeof l==='object'&&Number.isFinite(l?.top)?{top:l.top,bottom:l.bottom,left:l.left,right:l.right}:null})).filter(l=>l.text);
 const products=[],rejected=[];let boundary=null,count=null,afterCpn=false,sum=0,sumLine=null;
 for(let i=0;i<L.length;i++){
  const line=L[i],s=line.text;
  if(isSubtotal(s)||isTotal(s)||isTaxSummary(s)){
   boundary={text:s,kind:isSubtotal(s)?'subtotal':isTotal(s)?'total':'tax',area:line.area};
   // A printed SUBTOTAL exactly equal to the items read shows that a short product priced near the running
   // total was a purchase: that doubt is cleared. A total within tax of the sum is not enough (v49 3rd audit).
   // Lines read after a subtotal-like line keep their doubt whatever the amounts: a non-product line can
   // make the amounts agree by chance, so the person decides (they stay listed, unselected).
   const bp=priceTail(s);
   if(bp&&!bp.negative&&boundary.kind==='subtotal'&&bp.value===sum)products.forEach(p=>{p.doubt=(p.doubt||[]).filter(d=>d!==SUM_DOUBTS[0])});
   // The item count is printed on or shortly after the boundary line; it wins over a count printed
   // inside the item list (a warehouse club prints one for the bottom-of-basket items).
   for(let k=i;k<Math.min(L.length,i+12);k++){const c=printedCount(L[k].text);if(c!==null){count=c;break}}
   break;
  }
  const pc=printedCount(s);
  if(pc!==null){count=pc;continue}
  if(/^CPN$/i.test(s)){afterCpn=true;continue}
  // A quantity line belongs to the line right above it; after a discount or another line it is not attached.
  const q=quantityLine(s);
  if(q){const p=products[products.length-1];if(p&&!p.qtyLine&&i-p.line===1&&!p.coupon){p.qty=q.qty;p.qtyLine=s;p.qtyChecked=q.checked;p.structured=true;if(!p.priced&&q.total)sum+=q.total}else rejected.push({text:s,reason:'数量の行（対応する商品が不明）',area:line.area});continue}
  const club=clubLine(s);
  if(club){const p=products[products.length-1];if(p&&p.line===i-1&&!p.qtyLine){p.qty=club.qty;p.qtyLine=s;p.qtyChecked=club.checked;p.structured=true;p.club=true;if(club.coupon||p.coupon){products.pop();sum-=club.total||0}else sum+=club.total||0}
   // An item line whose name could not be read is still a purchase: shown so it is not silently lost.
   else if(!club.coupon&&!afterCpn&&!(i>0&&/^CPN$/i.test(L[i-2]?.text||'')))rejected.push({text:s,reason:'商品名を読めない行（'+club.qty+'点）',qty:club.qty,area:line.area});
   afterCpn=false;continue}
  if(JAN.test(s)){continue}
  const price=priceTail(s);
  if(price&&price.negative){sum-=price.value;afterCpn=false;continue}
  if(DISCOUNT.test(s)){if(afterCpn)afterCpn=false;continue}
  if(isMeta(s)){continue}
  const name=(price?s.slice(0,price.index):s).trim();
  // A line whose amount is the sum of the items so far (with or without tax) is the subtotal or total even
  // when its label is misread ("小叶十", "十"): a short label is never taken as a product then.
  // v49 2nd audit: the amount alone never ends the list. A real product can cost what the items so far cost
  // (¥500+¥500 then ¥1,050), so reading goes on to the printed subtotal / total / tax / payment line:
  // - a label that is a misread 小計/合計 (or no letters at all) is not a product; it is listed for review;
  // - a short product name at that amount is kept, unselected, with the reason shown.
  // Lines read after a subtotal-like line stay products but are marked and left for the person to select.
  let doubt=null;
  if(price&&sum>0&&products.length>=2&&jpLetters(name)<=3&&letters(name)<=4&&nearSum(price.value,sum)){
   if(subtotalLike(name)){if(!sumLine)sumLine={line:i,text:s,area:line.area,count:products.length};rejected.push({text:s,reason:'小計か合計とみられる行（金額がそれまでの商品の合計とほぼ同じ）',area:line.area,sumLike:true});continue}
   doubt=SUM_DOUBTS[0];
  }
  if(!nameLike(name)){if(price||letters(name))rejected.push({text:s,reason:'商品名として判定できない文字',area:line.area});continue}
  const coupon=afterCpn;afterCpn=false;
  products.push({line:i,text:name,source:s,qty:1,qtyLine:'',qtyChecked:false,priced:!!price,price:price?price.value:null,structured:!!price,coupon,confidence:line.confidence,minScore:line.minScore,area:line.area,doubt:doubt?[doubt]:(sumLine?[SUM_DOUBTS[1]]:[])});
  if(price&&!coupon)sum+=price.value;
 }
 // No printed subtotal/total/tax line was read: the subtotal-like line is the best known end (for the count).
 if(!boundary&&sumLine){boundary={text:sumLine.text,kind:'sum',area:sumLine.area};for(let k=sumLine.line;k<Math.min(L.length,sumLine.line+12);k++){const c=printedCount(L[k].text);if(c!==null){count=c;break}}}
 // A name without price that got no quantity line is uncertain (the price may have been lost): it is
 // listed for review. Before the first real product it is the store header and is skipped.
 const out=[],first=products.findIndex(p=>p.structured);
 products.forEach((p,k)=>{
  if(p.coupon)return;
  if(!p.structured){if(first>=0&&k>first)rejected.push({text:p.source,reason:'価格も数量も読めない行',area:p.area});return}
  out.push(p);
 });
 const counted=out.reduce((s,p)=>s+p.qty,0);
 return {products:out,rejected,boundary,printedCount:count,countedQty:counted,countMatches:count===null?null:count===counted,lineCount:L.length};
}
// True once the item list has ended and the printed item count (or enough lines after the end) has
// been read: the OCR can stop reading the rest (payment, points, advertising).
function itemListEnded(lines){
 const L=(lines||[]).map(l=>clean(typeof l==='string'?l:l.text)).filter(Boolean);
 const b=L.findIndex(s=>isSubtotal(s)||isTotal(s)||isTaxSummary(s));if(b<0)return false;
 const after=L.slice(b);return after.some(s=>printedCount(s)!==null)&&after.length>=3||after.length>=12;
}
// What identifies one receipt (v49 audit, family duplicate check): the store (invoice registration number
// or phone), the printed date and time, the total and the receipt number. Member and card numbers are never
// read. strong=false when these cannot all be read; then only an on-phone warning is possible.
function receiptFacts(lines){
 const L=(lines||[]).map(l=>clean(typeof l==='string'?l:l.text)).filter(Boolean),all=L.join('\n');
 const reg=(all.match(/(?:^|[^0-9A-Za-z])T\s?(\d{13})(?!\d)/m)||[])[1]||'';
 const tel=((all.match(/(?:TEL|電話)\s*[:：]?\s*(0\d{1,4}[-ー]?\d{1,4}[-ー]?\d{3,4})/i)||[])[1]||'').replace(/\D/g,'');
 let date='',m;
 if((m=all.match(/(20\d{2})\s*[年\/.-]\s*(\d{1,2})\s*[月\/.-]\s*(\d{1,2})/)))date=m[1]+'-'+m[2].padStart(2,'0')+'-'+m[3].padStart(2,'0');
 else if((m=all.match(/(\d{1,2})\/(\d{1,2})\/(20\d{2})/)))date=m[3]+'-'+m[1].padStart(2,'0')+'-'+m[2].padStart(2,'0');
 const tm=all.match(/(?:^|[^\d])(\d{1,2})\s*[:時]\s*(\d{2})(?:\s*分)?/m),time=tm?tm[1].padStart(2,'0')+':'+tm[2]:'';
 let total='';for(const s of L){if(isTotal(s)){const p=priceTail(s);if(p&&!p.negative){total=String(p.value);break}}}
 const no=(all.match(/(?:レシート|ﾚｼｰﾄ)\s*No\.?\s*[:：]?\s*(\d{3,})|伝票番号\s*[:：]?\s*([\d-]{4,})|取引(?:No|番号)\.?\s*[:：]?\s*(\d{4,})/i)||[]).slice(1).find(Boolean)||'';
 const store=reg||tel,strong=!!(store&&date&&time&&(total||no));
 return {store,date,time,total,receiptNo:no,strong,key:strong?['r1',store,date,time,total,no].join('|'):''};
}
root.AtokoreReceiptStructure=Object.freeze({receiptFacts,itemListEnded,structure,clean,priceTail,quantityLine,clubLine,isSubtotal,isTotal,isTaxSummary,printedCount,hw});
if(typeof module!=='undefined'&&module.exports)module.exports=root.AtokoreReceiptStructure;
})(typeof window!=='undefined'?window:globalThis);
