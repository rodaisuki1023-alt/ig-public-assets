/* Atokore individual product illustrations v1
 * All glyphs are original vector drawings. Never reproduce product packaging/logos.
 * Product names remain the primary identifier; SVGs are decorative, not inferred SKU data.
 */
(function(root) {
'use strict';
const PATTERNS=[
 ['onion',/玉ねぎ|たまねぎ|タマネギ/],['carrot',/にんじん|人参|ニンジン/],
 ['potato',/じゃがいも|ジャガイモ|馬鈴薯/],['tomato',/トマト/],
 ['broccoli',/ブロッコリー/],['cabbage',/キャベツ/],['lettuce',/レタス/],
 ['cucumber',/きゅうり|キュウリ/],['pepper',/ピーマン|パプリカ/],
 ['radish',/大根/],['spinach',/ほうれん草|小松菜/],
 ['mushroom',/きのこ|しめじ|しいたけ|えのき|エリンギ/],
 ['egg',/卵|たまご|玉子/],
 ['chicken',/鶏むね肉|鶏もも肉|鶏肉|からあげ/],['pork',/豚こま|豚バラ|豚ロース|豚肉/],
 ['mince',/ひき肉|挽肉/],['beef',/牛こま|牛薄切り|牛肉/],
 ['salmon',/鮭|サーモン/],['fish',/さば|ぶり|あじ|たら|魚/],
 ['banana',/バナナ/],['apple',/りんご|リンゴ/],['strawberry',/いちご|イチゴ/],
 ['orange',/みかん|オレンジ/],['milk',/牛乳|低脂肪乳|豆乳/],
 ['bread',/食パン|ロールパン|ベーグル/],['cheese',/チーズ/],['yogurt',/ヨーグルト/],
 ['tofu',/豆腐|厚揚げ/],['natto',/納豆/],
 ['rice',/お米|無洗米|白米|パックご飯|米$/],['tea',/麦茶|緑茶/],
 ['tissue',/ティッシュ|ティシュ/],['toilet',/トイレットペーパー/],
 ['detergent',/洗濯洗剤|柔軟剤|液体洗剤/],['dish',/食器用洗剤|食洗機洗剤/],
 ['garbage',/ゴミ袋/],['shampoo',/シャンプー/]
];
const ART={
 onion:['#F9EADC','<path d="M24 17C15 17 12 27 16 34Q19 41 24 41Q29 41 33 34C37 27 33 17 24 17Z" fill="#DEB882"/><path d="M24 17V7M24 18Q18 13 17 9M24 18Q30 11 32 9" stroke="#5B8B65"/><path d="M24 20Q19 28 21 36M25 21Q31 29 27 36" stroke="#BC8E63" stroke-width="1.5"/>'],
 carrot:['#F6EDDC','<path d="M19 19Q23 15 30 20L24 39Q20 41 19 36L15 23Z" fill="#EDAA68"/><path d="M21 19Q14 13 16 8Q22 11 23 17Q25 10 32 10Q31 17 25 19" fill="#A6C99A" stroke="#58835D"/><path d="M19 27L24 29M21 33L25 34" stroke="#C7804E" stroke-width="1.5"/>'],
 potato:['#F9EEDC','<path d="M15 23C18 14 31 14 35 23Q39 35 28 39Q16 43 13 34Q11 29 15 23Z" fill="#DDBB8D"/><circle cx="20" cy="25" r="1.3" fill="#AE835D" stroke="none"/><circle cx="29" cy="29" r="1.5" fill="#AE835D" stroke="none"/><circle cx="22" cy="35" r="1.2" fill="#AE835D" stroke="none"/>'],
 tomato:['#FCE6E3','<circle cx="24" cy="28" r="13" fill="#E8897B"/><path d="M24 14L25 22L32 19L28 25L35 27L25 27L24 30L22 26L14 27L19 22L16 18L23 21Z" fill="#8EB586" stroke="#618D67" stroke-width="1.3"/>'],
 broccoli:['#E7F2E5','<path d="M21 30H28L30 40H20Z" fill="#B4CA9B"/><circle cx="17" cy="23" r="7" fill="#87B88A"/><circle cx="24" cy="18" r="8" fill="#A0C89A"/><circle cx="31" cy="23" r="8" fill="#88B58A"/><path d="M20 29Q24 34 29 29" stroke="#679873"/>'],
 cabbage:['#EAF1E0','<circle cx="24" cy="26" r="15" fill="#D5E6AE"/><path d="M11 24Q17 18 23 20Q32 22 37 31M17 15Q27 28 17 38M29 15Q20 28 31 37" fill="none" stroke="#87AD72" stroke-width="1.8"/>'],
 lettuce:['#EAF2E6','<path d="M11 28Q9 17 16 18Q19 10 25 15Q32 9 35 18Q43 22 36 30Q37 38 28 38Q19 43 15 35Q10 35 11 28Z" fill="#BBDBAC"/><path d="M24 35Q17 25 21 18M24 35Q30 24 34 22M24 35Q18 30 14 29" fill="none" stroke="#82AA75"/>'],
 cucumber:['#E9F1E4','<path d="M14 35Q11 22 17 17Q27 11 33 16Q39 22 34 30Q28 40 14 35Z" fill="#A6C895"/><path d="M17 33Q16 22 24 18" fill="none" stroke="#638E65"/><circle cx="30" cy="24" r="1" fill="#6D9567" stroke="none"/>'],
 pepper:['#E7F2E5','<path d="M23 17Q18 15 15 20Q11 27 16 36Q20 39 23 35Q28 41 32 36Q38 26 33 19Q29 15 25 18Z" fill="#9FC990"/><path d="M24 19Q21 12 26 9" fill="none" stroke="#628A63" stroke-width="2.5"/><path d="M23 19Q27 29 24 36" fill="none" stroke="#79A86D"/>'],
 radish:['#F5EFE7','<path d="M15 21Q23 17 33 21Q34 30 26 39L21 42Q18 33 15 21Z" fill="#FFFDFC"/><path d="M18 19Q14 11 17 8Q23 13 23 19M23 19Q24 10 30 8Q31 15 27 20" fill="#B5D2A1" stroke="#749771"/><path d="M18 27Q25 29 32 26" fill="none" stroke="#DAD0BF"/>'],
 spinach:['#E8F1E8','<path d="M23 39V20M23 28Q12 25 14 16Q22 14 24 24M23 28Q34 23 34 13Q26 13 23 23" stroke="#5B946F" fill="#B7D9BB" stroke-width="2"/><path d="M22 35L15 39M24 35L31 39" stroke="#84B58D"/>'],
 mushroom:['#F3ECE5','<path d="M21 28H29V39H21Z" fill="#FEFAED"/><path d="M11 27Q11 14 25 14Q39 14 39 27Z" fill="#CDB096"/><path d="M18 22H19M29 20H30M25 25H26" stroke="#9B7863" stroke-width="2.5"/>'],
 egg:['#FFF0D9','<ellipse cx="18" cy="28" rx="7" ry="10" fill="#FFFCF5"/><ellipse cx="30" cy="27" rx="7" ry="11" fill="#F8E3CA"/><path d="M16 36Q18 38 21 35" stroke="#CBA883"/>'],
 chicken:['#FBE6E0','<path d="M14 23Q13 15 23 15Q34 15 36 26Q36 32 30 35Q25 37 20 32Q14 33 14 23Z" fill="#F3C7B7"/><path d="M31 34L37 39M37 39Q42 35 43 39Q45 44 39 43L34 38" fill="#FFF9F3" stroke="#B97A70"/><path d="M18 23Q22 19 27 21" stroke="#C8867B"/>'],
 pork:['#FBE6E4','<path d="M12 26Q10 18 19 15Q29 11 36 19Q40 27 32 35Q26 41 17 36Q12 33 12 26Z" fill="#F0B8B2"/><path d="M17 24Q22 20 28 23Q34 26 29 32" fill="none" stroke="#D28E89" stroke-width="2.4"/>'],
 mince:['#F9E3DE','<path d="M11 30Q10 23 17 23Q17 16 24 17Q31 14 35 22Q41 25 36 32Q35 39 28 37Q22 42 18 36Q12 38 11 30Z" fill="#E9ABA5"/><path d="M16 29Q21 24 27 28M23 35Q29 30 35 31" stroke="#C98480" fill="none"/>'],
 beef:['#F7E1DE','<path d="M12 23Q14 12 26 14Q40 15 38 27Q36 39 24 38Q12 36 12 23Z" fill="#CC8C86"/><path d="M18 24Q24 18 33 23M17 31Q23 34 30 30" stroke="#F6CFC7" fill="none" stroke-width="2.8"/>'],
 salmon:['#E3EDF3','<path d="M11 26Q22 12 36 26Q23 39 11 26Z" fill="#F5B2A0"/><path d="M36 26L42 18V34Z" fill="#B4D4D9"/><circle cx="19" cy="24" r="1.6" fill="#597E91" stroke="none"/><path d="M24 19L28 32" stroke="#FFF0DC"/>'],
 fish:['#E0EEF4','<path d="M11 25Q24 12 36 25Q24 38 11 25Z" fill="#BCD6E2"/><path d="M36 25L43 17V33Z" fill="#9EC6D7"/><circle cx="18" cy="24" r="1.5" fill="#597F91" stroke="none"/><path d="M25 19L27 31" stroke="#7DAABD"/>'],
 banana:['#FDF1D9','<path d="M12 18Q20 37 38 22Q36 36 25 39Q15 40 12 18Z" fill="#F2CE70"/><path d="M12 18L11 14M38 22L40 18" stroke="#B3924C"/>'],
 apple:['#F9E3DE','<path d="M24 20Q18 15 13 22Q7 31 15 38Q20 41 24 38Q29 41 34 37Q41 28 35 21Q30 16 24 20Z" fill="#E7A18E"/><path d="M24 20V11M25 16Q31 11 35 15Q32 19 25 18" fill="#C1D7A5" stroke="#758F6C"/>'],
 strawberry:['#FCE7E8','<path d="M15 22Q17 14 26 18Q35 16 34 24Q33 34 24 41Q15 35 15 22Z" fill="#E48A89"/><path d="M15 20L20 14L25 19L30 14L34 21" fill="#95B987"/><path d="M21 26L22 28M28 26L27 28M24 33L24 34" stroke="#F7E9D1" stroke-width="1.8"/>'],
 orange:['#FDE9D6','<circle cx="24" cy="27" r="13" fill="#F4B873"/><path d="M24 14L25 10M25 14Q30 9 35 12Q31 17 25 15" fill="#B5CB93" stroke="#779567"/><circle cx="20" cy="31" r="1" fill="#E69A51" stroke="none"/>'],
 milk:['#E5EDF7','<path d="M15 17L19 11H31L35 17V39H15Z" fill="#FEFCF8"/><path d="M15 17H35M19 11L23 17V39" fill="none"/><path d="M26 26Q22 31 26 34Q30 31 26 26Z" fill="#B3CEE0"/>'],
 bread:['#FAE9D6','<path d="M12 22Q10 11 23 11Q38 11 37 22V39H12Z" fill="#EBC69B"/><path d="M18 23Q17 18 24 18Q31 18 31 24V33H18Z" fill="#FFF7E8"/>'],
 cheese:['#FBF0DC','<path d="M11 36L36 24L36 38H11Z" fill="#F2D37A"/><circle cx="28" cy="34" r="2" fill="#DFAF4A" stroke="none"/><circle cx="20" cy="34" r="1.8" fill="#DFAF4A" stroke="none"/>'],
 yogurt:['#E8EEF5','<path d="M15 18H35L31 39H19Z" fill="#FEFCFB"/><rect x="13" y="14" width="24" height="6" rx="3" fill="#A5C9D9"/><circle cx="25" cy="30" r="5" fill="#EFB0A7"/>'],
 tofu:['#F2EFE8','<path d="M12 21L28 15L39 22L22 28Z" fill="#FCF8ED"/><path d="M12 21V34L22 41V28M22 41L39 34V22" fill="#F6EFDF"/>'],
 natto:['#F1EDDF','<path d="M11 22H38V36Q24 41 11 36Z" fill="#FFF9F0"/><path d="M11 22Q23 15 38 22" fill="none"/><circle cx="20" cy="29" r="3.6" fill="#CDAF7A" stroke="none"/><circle cx="29" cy="29" r="3.6" fill="#CDAF7A" stroke="none"/><path d="M18 23Q23 26 28 23" stroke="#CFBB9A"/>'],
 rice:['#F4EDE4','<path d="M13 23H35L32 38H16Z" fill="#FFFDF6"/><path d="M15 23Q15 16 24 16Q34 16 33 23" fill="#FBF8EC"/><path d="M12 39H36" stroke-width="2.5"/>'],
 tea:['#E5F1E9','<path d="M17 13H31L34 19V39H15V19Z" fill="#FDFEFB"/><path d="M17 13L20 19H34M20 19V39" fill="none"/><path d="M22 27Q24 24 26 27Q28 30 26 33Q24 36 22 33Q20 30 22 27Z" fill="#B8D5B1"/>'],
 tissue:['#E7ECF4','<rect x="10" y="23" width="28" height="15" rx="4" fill="#FAFCFF"/><path d="M19 24V15Q25 9 32 16V24" fill="#FFFDFD"/><path d="M19 29H30" stroke="#98ABC2"/>'],
 toilet:['#E7ECF4','<circle cx="23" cy="25" r="13" fill="#FCFCFF"/><circle cx="23" cy="25" r="5" fill="#D4DFE9"/><path d="M23 12H35Q41 17 39 27" fill="none"/>'],
 detergent:['#E3EFF0','<path d="M17 17H32V39H15V23Z" fill="#FDFEFC"/><path d="M19 17V11H29V17M17 21H32" fill="none"/><rect x="19" y="27" width="10" height="6" rx="2" fill="#B7D7D2" stroke="none"/>'],
 dish:['#E4EEF1','<rect x="16" y="17" width="18" height="23" rx="5" fill="#FCFEFD"/><path d="M19 17V11H29M29 11V16" fill="none"/><path d="M20 29Q25 24 30 29" fill="none" stroke="#92C8C6"/>'],
 garbage:['#E9EDF1','<path d="M17 19L19 38H31L33 19Z" fill="#F9FCFD"/><path d="M14 19H36M20 14H30M24 22V34" fill="none"/>'],
 shampoo:['#E8E8F2','<rect x="17" y="18" width="16" height="22" rx="5" fill="#FCFCFF"/><path d="M21 18V10H30M30 10H35M22 28H28" fill="none"/>']
};
function resolve(name){
 const n=String(name||'').normalize('NFKC');
 return PATTERNS.find(([,reg])=>reg.test(n))?.[0]||null;
}
function icon(name){
 const key=resolve(name);if(!key)return null;
 const [background,body]=ART[key];
 return '<span class="qa-icon qa-item-icon" aria-hidden="true" data-product-icon="'+key+'">'+
 '<svg viewBox="0 0 48 48" width="44" height="44" xmlns="http://www.w3.org/2000/svg">'+
 '<rect width="48" height="48" rx="14" fill="'+background+'"/>'+
 '<g fill="none" stroke="#735F50" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round">'+body+'</g>'+
 '</svg></span>';
}
const api=Object.freeze({resolve,icon,keys:Object.freeze(Object.keys(ART))});
if(typeof module!=='undefined'&&module.exports)module.exports=api;
root.AtokoreIndividualIcons=api;
})(typeof globalThis!=='undefined'?globalThis:this);
