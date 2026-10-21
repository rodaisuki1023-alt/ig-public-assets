// Synthetic receipts for the v38 receipt evaluation (NOT real receipts). Deterministic.
// Each product line has a known truth: the stock product it should match (or none = new product)
// and the purchase quantity. Printed names follow common Japanese POS abbreviations.
const STOCK = [
  { id: 1, name: 'パンパース さらさらケア おむつ テープ M', cat: 'ベビー', unit: '袋', qty: 1 },
  { id: 2, name: 'パンパース さらさらケア おむつ テープ L', cat: 'ベビー', unit: '袋', qty: 1 },
  { id: 3, name: 'ムーニー ムーニーマン おむつ パンツ L', cat: 'ベビー', unit: '袋', qty: 1 },
  { id: 4, name: '明治 ほほえみ 粉ミルク 缶', cat: 'ベビー', unit: '缶', qty: 1 },
  { id: 5, name: '明治 ほほえみ 粉ミルク キューブ', cat: 'ベビー', unit: '箱', qty: 1 },
  { id: 6, name: 'Rico おしりふき', cat: 'ベビー', unit: 'パック', qty: 2 },
  { id: 7, name: '牛乳', cat: '食料品', unit: '本', qty: 1 },
  { id: 8, name: '卵', cat: '食料品', unit: 'パック', qty: 1 },
  { id: 9, name: '食パン', cat: '食料品', unit: '袋', qty: 1 },
  { id: 10, name: 'ティッシュ', cat: '日用品', unit: '個', qty: 1 },
  { id: 11, name: 'ヨーグルト', cat: '食料品', unit: '個', qty: 1 },
];
// [printed name, truth stock id or null (new product), price]
const PRODUCTS = [
  ['ﾊﾟﾝﾊﾟｰｽ ｻﾗｻﾗｹｱ ﾃｰﾌﾟM 64ﾏｲ', 1, 1628], ['ﾊﾟﾝﾊﾟｰｽ ｻﾗｻﾗｹｱ ﾃｰﾌﾟL 54ﾏｲ', 2, 1628],
  ['ﾑｰﾆｰﾏﾝ ﾊﾟﾝﾂ L 44ﾏｲ', 3, 1408], ['ﾒﾘｰｽﾞ ﾃｰﾌﾟM 64ﾏｲ', null, 1738],
  ['ﾒｲｼﾞ ﾎﾎｴﾐ ｶﾝ 800G', 4, 2580], ['ﾎﾎｴﾐ ﾗｸﾗｸｷｭｰﾌﾞ 27G', 5, 3080],
  ['ﾘｺ ｵｼﾘﾌｷ 80ﾏｲX3', 6, 398], ['ﾑｰﾆｰ ｵｼﾘﾌｷ ﾂﾒｶｴ', null, 658],
  ['ﾜｺｳﾄﾞｳ ｴｲﾖｳﾏﾙｼｪ', null, 298], ['牛乳 1000ML', 7, 228],
  ['ﾀﾏｺﾞ 10ｺｲﾘ', 8, 258], ['食パン 6枚', 9, 158], ['ｽｺｯﾃｨ ﾃｨｯｼｭ 5ｺｲﾘ', 10, 398],
  ['ﾖｰｸﾞﾙﾄ 400G', 11, 178], ['バナナ', null, 198], ['ﾄﾘﾑﾈﾆｸ', null, 456],
  ['豚こま切落し', null, 598], ['ﾅｯﾄｳ 3P', null, 98], ['キャベツ', null, 158],
  ['ｾﾝﾀｸｾﾝｻﾞｲ ﾂﾒｶｴ', null, 328],
];
function rng(seed) { let s = seed; return () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; }
const yen = n => '¥' + n.toLocaleString('en-US');
function receipts(count = 24) {
  const out = [];
  for (let r = 0; r < count; r++) {
    const rand = rng(1000 + r * 7919);
    const pick = [...PRODUCTS].sort(() => rand() - 0.5).slice(0, 4 + Math.floor(rand() * 5));
    const lines = ['イオン 上尾店', '〒362-0000 埼玉県上尾市', `2026/10/${String(1 + (r % 28)).padStart(2, '0')} 1${r % 10}:${String(10 + r).slice(-2)}`, 'TEL 048-000-0000', 'レジ0012 担当 ヤマダ'];
    const truth = [];
    let subtotal = 0;
    for (const [name, stockId, price] of pick) {
      const qty = rand() < 0.25 ? 2 + Math.floor(rand() * 2) : 1;
      const code = ['1100', '1300', '1520', '1600'][Math.floor(rand() * 4)];
      if (qty > 1) { lines.push(`${code}軽 ${name}`); lines.push(`  ${qty}コ X 単${price}  ${yen(price * qty)}`); }
      else lines.push(`${code}軽 ${name}  ${yen(price)}`);
      if (rand() < 0.15) { lines.push(`  値引  -${yen(30).slice(1)}`); subtotal -= 30; }
      subtotal += price * qty;
      truth.push({ printed: name, stockId, qty });
    }
    const tax = Math.round(subtotal * 0.08);
    lines.push(`小計  ${yen(subtotal)}`, `(8%対象 ${yen(subtotal)})`, `消費税等  ${yen(tax)}`, `合計  ${yen(subtotal + tax)}`, `クレジット  ${yen(subtotal + tax)}`, 'お買上点数 ' + truth.reduce((s, t) => s + t.qty, 0) + '点', 'ありがとうございました');
    out.push({ id: 'synthetic-' + String(r + 1).padStart(2, '0'), lines, truth });
  }
  return out;
}
// Held-out printed names, written after the matcher was tuned on PRODUCTS and never used for tuning.
// [printed name, truth stock id or null]
const HELD_OUT = [
  ['ﾊﾟﾝﾊﾟｰｽ ﾃｰﾌﾟ Mｻｲｽﾞ 60ﾏｲ', 1], ['P&G ﾊﾟﾝﾊﾟｰｽ ｻﾗｻﾗ L', 2], ['ﾑｰﾆｰﾏﾝ ｴｱﾌｨｯﾄ L', 3], ['ﾑｰﾆｰﾏﾝ ﾊﾟﾝﾂ M 58ﾏｲ', null],
  ['ﾒｲｼﾞﾎﾎｴﾐ800G', 4], ['ﾎﾎｴﾐ ｷｭｰﾌﾞ 48ｺ', 5], ['ﾘｺ ﾍﾞﾋﾞｰﾜｲﾌﾟ', 6], ['ｷﾞｭｳﾆｭｳ 1L', 7], ['ﾒｲｼﾞｵｲｼｲｷﾞｭｳﾆｭｳ', 7],
  ['ﾀﾏｺﾞ Mｻｲｽﾞ 10ｺ', 8], ['ﾔﾏｻﾞｷ ｼｮｸﾊﾟﾝ 6ﾏｲ', 9], ['ﾈﾋﾟｱ ﾃｨｯｼｭ', 10], ['ﾌﾞﾙｶﾞﾘｱﾖｰｸﾞﾙﾄ', 11],
  ['ｸﾞｰﾝ ﾃｰﾌﾟ M', null], ['ﾏﾐｰﾎﾟｺ ﾊﾟﾝﾂ L', null], ['ﾎﾎｴﾐ ｴｷﾀｲ', null], ['ﾅｯﾄｳ ｵｶﾒ', null], ['ﾄｲﾚｯﾄﾍﾟｰﾊﾟｰ 12R', null],
  ['ﾊﾅｺｱﾃｨｯｼｭ', 10], ['ｱﾀｯｸ ｾﾝｻﾞｲ', null],
];
module.exports = { STOCK, PRODUCTS, HELD_OUT, receipts };
