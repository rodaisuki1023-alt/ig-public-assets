// v38 receipt evaluation on SYNTHETIC receipt images (not real receipts; manual tool, not run in CI).
// 1. Renders each synthetic receipt in Chromium: "scan" (clean) and "photo" (tilted, blurred, low contrast).
// 2. Applies the app's own image preparation (copied from receipt.js prep()).
// 3. Runs tesseract.js with the app's settings (jpn+eng, LSTM, psm 6, preserved spaces, tsv).
// 4. Parses with the app's receipt.js and suggests stock products with receipt-match-v38.js.
// Usage: TESS_DIR=<dir with node_modules/tesseract.js@5.1.1> node tests/receipt-eval/evaluate.cjs [count] [--old]
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { chromium } = require('@playwright/test');
const { STOCK, receipts } = require('./dataset.cjs');
const match = require('../../atokore-live-v125/receipt-match-v38.js');

const TESS = require(path.join(process.env.TESS_DIR, 'node_modules/tesseract.js'));
const OUT = process.env.EVAL_OUT || path.join(__dirname, 'out');
const count = Number(process.argv[2] || 24);
fs.mkdirSync(OUT, { recursive: true });

function parser(sourceFile) {
  const ctx = { console, C: { 食料品: ['牛乳', '卵', '食パン', 'バナナ', 'キャベツ', 'ヨーグルト', '納豆', '鶏むね肉', '豚こま肉'], 日用品: ['ティッシュ', '洗濯洗剤'] },
    document: { createElement: () => ({ textContent: '', style: {}, appendChild() {} }), head: { appendChild() {} }, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [] },
    localStorage: { getItem: () => null, setItem() {} }, URL: { createObjectURL: () => '', revokeObjectURL() {} }, Image: function Image() {},
    today: () => '2026-10-21', showPremium() {}, openM() {}, closeM() {}, alert() {}, items: [], buys: [], save() {}, render() {}, go() {} };
  ctx.window = ctx; vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(sourceFile, 'utf8'), ctx);
  return ctx.__atokoreReceiptV125M;
}
const html = (r, variant) => `<!doctype html><meta charset="utf-8"><style>
 body{margin:0;background:${variant === 'photo' ? '#d9d4cc' : '#fff'}}
 .r{width:340px;margin:${variant === 'photo' ? '24px 30px' : '0'};padding:18px 16px;background:${variant === 'photo' ? '#f3f0ea' : '#fff'};font:15px/1.55 'IPAGothic',monospace;color:#222;white-space:pre;
   ${variant === 'photo' ? 'transform:rotate(1.3deg);filter:blur(.55px) contrast(.82);box-shadow:0 2px 8px #0004' : ''}}
</style><div class="r">${r.lines.map(l => l.replace(/&/g, '&amp;').replace(/</g, '&lt;')).join('\n')}</div>`;
// receipt.js prep(): scale, white padding, grayscale with contrast (same constants).
// Experiments: PREP_WIDTH (target width, app uses 1400) and BINARIZE=1 (Otsu threshold) via env.
const PREP_WIDTH = Number(process.env.PREP_WIDTH || 1400), BINARIZE = process.env.BINARIZE === '1';
const PREP = `async src=>{const im=new Image();await new Promise((res,rej)=>{im.onload=res;im.onerror=rej;im.src=src});
 const nw=im.naturalWidth,nh=im.naturalHeight,sc=Math.min(${PREP_WIDTH/700},Math.max(1,${PREP_WIDTH}/nw),${PREP_WIDTH+800}/nw,${Math.round(PREP_WIDTH*2.3)}/nh),w=Math.round(nw*sc),h=Math.round(nh*sc),pad=Math.max(16,Math.round(Math.min(w,h)*.018)),c=document.createElement('canvas');
 c.width=w+pad*2;c.height=h+pad*2;const x=c.getContext('2d');x.fillStyle='#fff';x.fillRect(0,0,c.width,c.height);x.imageSmoothingQuality='high';x.drawImage(im,pad,pad,w,h);
 const d=x.getImageData(pad,pad,w,h),p=d.data;for(let i=0;i<p.length;i+=4){const g=Math.round(p[i]*.299+p[i+1]*.587+p[i+2]*.114),v=Math.max(0,Math.min(255,Math.round((g-128)*1.24+140)));p[i]=p[i+1]=p[i+2]=v}${BINARIZE?"const hist=new Array(256).fill(0);for(let i=0;i<p.length;i+=4)hist[p[i]]++;let sum=0,tot=p.length/4;for(let t=0;t<256;t++)sum+=t*hist[t];let sB=0,wB=0,best=0,th=128;for(let t=0;t<256;t++){wB+=hist[t];if(!wB)continue;const wF=tot-wB;if(!wF)break;sB+=t*hist[t];const mB=sB/wB,mF=(sum-sB)/wF,between=wB*wF*(mB-mF)*(mB-mF);if(between>best){best=between;th=t}}for(let i=0;i<p.length;i+=4){const v=p[i]>th?255:0;p[i]=p[i+1]=p[i+2]=v}":''}x.putImageData(d,pad,pad);return c.toDataURL('image/png')}`;

function similar(a, b) {
  // Same tolerance as the matcher: small/large kana, doubled characters and long-vowel marks are ignored.
  const small = { 'ぁ': 'あ', 'ぃ': 'い', 'ぅ': 'う', 'ぇ': 'え', 'ぉ': 'お', 'っ': 'つ', 'ゃ': 'や', 'ゅ': 'ゆ', 'ょ': 'よ' };
  const n = s => String(s).normalize('NFKC').toLowerCase().replace(/[\u30a1-\u30f6]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60)).replace(/[\sー~〜]/g, '').replace(/[ぁぃぅぇぉっゃゅょ]/g, c => small[c]).replace(/(.)\1+/g, '$1');
  const bg = s => { const t = n(s), m = new Map(); for (let i = 0; i < t.length - 1; i++) m.set(t.slice(i, i + 2), (m.get(t.slice(i, i + 2)) || 0) + 1); return m; };
  const x = bg(a), y = bg(b); let i = 0, nx = 0, ny = 0; for (const v of x.values()) nx += v; for (const v of y.values()) ny += v; for (const [k, v] of x) i += Math.min(v, y.get(k) || 0);
  return nx + ny ? 2 * i / (nx + ny) : 0;
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH || undefined });
  const page = await browser.newPage({ deviceScaleFactor: 2 });
  const parse = parser(path.resolve(__dirname, '../../atokore-live-v125/receipt.js'));
  const worker = await TESS.createWorker('jpn+eng', 1, { cachePath: path.join(process.env.TESS_DIR, 'lang') });
  await worker.setParameters({ tessedit_pageseg_mode: '6', preserve_interword_spaces: '1', user_defined_dpi: '300' });
  const rows = [];
  for (const r of receipts(count)) {
    for (const variant of ['scan', 'photo']) {
      await page.setContent(html(r, variant));
      const shot = await page.locator(variant === 'photo' ? 'body' : '.r').screenshot();
      const prepped = await page.evaluate(([code, src]) => (0, eval)('(' + code + ')')(src), [PREP, 'data:image/png;base64,' + shot.toString('base64')]);
      const file = path.join(OUT, `${r.id}-${variant}.png`);
      fs.writeFileSync(file, Buffer.from(prepped.split(',')[1], 'base64'));
      const t0 = Date.now();
      const z = await worker.recognize(file, { rotateAuto: true }, { text: true, tsv: true });
      const ms = Date.now() - t0;
      const parsed = parse.parseReceipt({ text: z.data.text, tsv: z.data.tsv });
      // Align parsed rows to printed lines in order (receipts keep line order): dynamic programming
      // over name similarity, so a garbled OCR row still counts as "a row appeared for this line".
      const T = r.truth, P = parsed.items, sim = T.map(t => P.map(p => similar(p.raw || p.name, t.printed)));
      const dp = Array.from({ length: T.length + 1 }, () => Array(P.length + 1).fill(0));
      for (let i = 1; i <= T.length; i++) for (let j = 1; j <= P.length; j++)
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1], sim[i - 1][j - 1] >= 0.2 ? dp[i - 1][j - 1] + sim[i - 1][j - 1] : -1);
      const pair = new Map();
      for (let i = T.length, j = P.length; i > 0 && j > 0;) {
        if (sim[i - 1][j - 1] >= 0.2 && dp[i][j] === dp[i - 1][j - 1] + sim[i - 1][j - 1]) { pair.set(i - 1, j - 1); i--; j--; }
        else if (dp[i][j] === dp[i - 1][j]) i--; else j--;
      }
      const used = new Set(pair.values());
      const lines = T.map((t, ti) => {
        const best = pair.has(ti) ? pair.get(ti) : null, found = best !== null, score = found ? sim[ti][best] : 0;
        const item = found ? P[best] : null;
        const cands = item ? match.candidates(item.raw || item.name, STOCK) : [];
        const top = cands[0]?.item.id ?? null;
        return { printed: t.printed, truthStock: t.stockId, truthQty: t.qty, found, readable: score >= 0.6, parsedName: item?.name ?? null, parsedQty: item?.qty ?? null,
          selected: item ? !!item.selected : false, top, candidateIds: cands.map(c => c.item.id), nameScore: Math.round(score * 100) / 100 };
      });
      const extras = parsed.items.filter((_, i) => !used.has(i)).map(x => x.name);
      rows.push({ id: r.id, variant, ms, ocrConfidence: Math.round(z.data.confidence), lines, extras, rejected: parsed.rejected.length, stoppedAtSubtotal: parsed.stoppedAtSubtotal });
      process.stdout.write(`${r.id} ${variant} ${ms}ms found ${lines.filter(l => l.found).length}/${lines.length} extras ${extras.length}\n`);
    }
  }
  await worker.terminate(); await browser.close();
  const summary = {};
  for (const variant of ['scan', 'photo']) {
    const rs = rows.filter(x => x.variant === variant), ls = rs.flatMap(x => x.lines), found = ls.filter(l => l.found);
    const known = found.filter(l => l.truthStock !== null), fresh = found.filter(l => l.truthStock === null);
    summary[variant] = {
      receipts: rs.length, productLines: ls.length,
      lineRecall: +(found.length / ls.length).toFixed(3),
      readableName: +(found.filter(l => l.readable).length / ls.length).toFixed(3),
      preselected: +(found.filter(l => l.selected).length / ls.length).toFixed(3),
      qtyCorrect: +(found.filter(l => l.parsedQty === l.truthQty).length / (found.length || 1)).toFixed(3),
      qtyOverCount: found.filter(l => l.parsedQty > l.truthQty).length,
      knownTopCorrect: +(known.filter(l => l.top === l.truthStock).length / (known.length || 1)).toFixed(3),
      knownInCandidates: +(known.filter(l => l.candidateIds.includes(l.truthStock)).length / (known.length || 1)).toFixed(3),
      wrongStockSuggestedTop: found.filter(l => l.top !== null && l.top !== l.truthStock).length,
      newProductsWithWrongSuggestion: fresh.filter(l => l.top !== null).length,
      extraItems: rs.reduce((s, x) => s + x.extras.length, 0),
      editsNeeded: found.filter(l => (l.truthStock !== null ? l.top !== l.truthStock : l.nameScore < 0.6) || l.parsedQty !== l.truthQty).length + (ls.length - found.length),
      medianMs: rs.map(x => x.ms).sort((a, b) => a - b)[Math.floor(rs.length / 2)], maxMs: Math.max(...rs.map(x => x.ms)),
      subtotalStop: rs.filter(x => x.stoppedAtSubtotal).length,
    };
  }
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({ summary, rows }, null, 1));
  console.log(JSON.stringify(summary, null, 1));
})().catch(e => { console.error(e); process.exit(1); });
