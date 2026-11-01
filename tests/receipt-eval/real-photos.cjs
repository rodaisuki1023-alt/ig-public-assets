// Receipt evaluation on REAL receipt photos kept OUTSIDE this repository (manual tool, not run in CI).
// The photos, the hand-made ground truth and the stock list are private: this file only reads them.
//
// RECEIPT_DIR layout (private):
//   truth.json  { receipts: [{ id, split: 'dev'|'holdout', points, lines: [{ name, qty, stock }] }] }
//               name = printed product text as read by a person ('?' = unreadable by eye)
//               qty = purchase quantity; stock = id in stock.json, null (new product) or 'any' (unknowable)
//   stock.json  [{ id, name, cat, unit }]  the registered products used for matching
//   img/<id>.jpg     photos as taken (no manual rotation or cropping)
//   text/<id>.txt    optional: a person's transcription of the whole receipt ("文字列解析", --text)
//
// It runs the app's own code: the image preparation function and the parser are read from
// atokore-live-v125/receipt.js (or RECEIPT_JS), the matcher from receipt-match-v38.js, and OCR is
// tesseract.js 5.1.1 with the app's settings. Text mode (--text) skips OCR and is reported separately:
// a transcription is not an OCR result.
//
// Usage:
//   TESS_DIR=<dir with node_modules/tesseract.js@5.1.1 and lang/*.traineddata.gz> RECEIPT_DIR=<private dir> \
//   node tests/receipt-eval/real-photos.cjs [--split dev|holdout|all] [--text] [--only r01,r02] [--json out.json]
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const args = process.argv.slice(2);
const opt = name => { const i = args.indexOf(name); return i < 0 ? null : (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true); };
const DIR = process.env.RECEIPT_DIR;
if (!DIR) { console.error('RECEIPT_DIR is required (private photos and truth are not in the repository).'); process.exit(2); }
const SPLIT = opt('--split') || 'dev', TEXT = !!opt('--text'), ONLY = opt('--only') ? String(opt('--only')).split(',') : null;
// --prep app: the image preparation inside receipt.js (v48 and before).
// --prep v49: receipt-image-v49.js (find the paper, crop, turn upright, even out the light).
const PREP = opt('--prep') || 'app';
const CACHE = opt('--from-cache') ? String(opt('--from-cache')) : null;
// --engine tesseract (v48 and before) | ppocr (v49: receipt-ppocr-v49.js in Chromium, as on the phone).
// For ppocr, ORT_DIST may point at a local onnxruntime-web@1.30.0/dist to avoid the CDN in tests.
const ENGINE = opt('--engine') || 'tesseract';
const APP_DIR = path.resolve(path.join(__dirname, '../../atokore-live-v125'));
const IMAGE_JS = path.resolve(path.join(__dirname, '../../atokore-live-v125/receipt-image-v49.js'));
const RECEIPT_JS = path.resolve(process.env.RECEIPT_JS || path.join(__dirname, '../../atokore-live-v125/receipt.js'));
const MATCH_JS = path.resolve(process.env.MATCH_JS || path.join(__dirname, '../../atokore-live-v125/receipt-match-v38.js'));
const truth = JSON.parse(fs.readFileSync(path.join(DIR, 'truth.json'), 'utf8')).receipts
  .filter(r => (SPLIT === 'all' || r.split === SPLIT) && (!ONLY || ONLY.includes(r.id)));
const STOCK = JSON.parse(fs.readFileSync(path.join(DIR, 'stock.json'), 'utf8'));
const source = fs.readFileSync(RECEIPT_JS, 'utf8');
delete require.cache[MATCH_JS];
const match = require(MATCH_JS);

function parser() {
  const ctx = { console, C: { 食料品: ['牛乳', '卵', '食パン', 'バナナ', 'ヨーグルト', '納豆'], 日用品: ['ティッシュ', '洗濯洗剤'] },
    document: { createElement: () => ({ textContent: '', style: {}, appendChild() {} }), head: { appendChild() {} }, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [] },
    localStorage: { getItem: () => null, setItem() {} }, URL: { createObjectURL: () => '', revokeObjectURL() {} }, Image: function Image() {},
    today: () => '2026-11-01', AtokoreDates: { localDate: () => '2026-11-01' }, AtokoreReceiptStructure: require('../../atokore-live-v125/receipt-structure-v49.js'), showPremium() {}, openM() {}, closeM() {}, alert() {}, items: [], buys: [], save() {}, render() {}, go() {} };
  ctx.window = ctx; vm.createContext(ctx);
  vm.runInContext(source, ctx);
  return ctx.__atokoreReceiptV125M;
}
// The app's image preparation, taken from receipt.js so the evaluation follows the shipped code.
function prepSource() {
  const start = source.indexOf('async function prep(f){');
  if (start < 0) throw Error('prep() not found in receipt.js');
  let depth = 0, i = source.indexOf('{', start);
  for (; i < source.length; i++) { if (source[i] === '{') depth++; else if (source[i] === '}' && --depth === 0) break; }
  return source.slice(start, i + 1);
}
// Character similarity after the normalisation people would not notice (width, case, spaces).
const norm = s => String(s ?? '').normalize('NFKC').toLowerCase().replace(/[\s　]+/g, '');
function lev(a, b) {
  const m = a.length, n = b.length; if (!m) return n; if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) { const cur = [i]; for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] || a[i - 1] === '?' ? 0 : 1)); prev = cur; }
  return prev[n];
}
function sim(text, printed) { const a = norm(printed), b = norm(text); if (!a) return 0; return Math.max(0, 1 - lev(a, b) / Math.max(a.length, b.length)); }
// Best similarity of a printed name with any span of an OCR line (the line also holds prices and codes).
function spanSim(line, printed) {
  const a = norm(printed), t = norm(line); if (!a || !t) return 0;
  let best = 0; for (let i = 0; i < t.length; i++) for (const L of [a.length - 2, a.length - 1, a.length, a.length + 1, a.length + 2]) {
    if (L < 1 || i + L > t.length) continue; const s = 1 - lev(a, t.slice(i, i + L)) / Math.max(a.length, L); if (s > best) best = s;
  }
  return best;
}
function align(T, P, score) {
  const S = T.map(t => P.map(p => score(p, t)));
  const dp = Array.from({ length: T.length + 1 }, () => Array(P.length + 1).fill(0));
  for (let i = 1; i <= T.length; i++) for (let j = 1; j <= P.length; j++)
    dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1], S[i - 1][j - 1] >= 0.34 ? dp[i - 1][j - 1] + S[i - 1][j - 1] : -1);
  const pair = new Map();
  for (let i = T.length, j = P.length; i > 0 && j > 0;) {
    if (S[i - 1][j - 1] >= 0.34 && dp[i][j] === dp[i - 1][j - 1] + S[i - 1][j - 1]) { pair.set(i - 1, j - 1); i--; j--; }
    else if (dp[i][j] === dp[i - 1][j]) i--; else j--;
  }
  return { pair, S };
}
// Several printed lines of the same product (e.g. two identical Costco lines) are one truth row with
// "lines": n; parsed rows are compared after the parser has merged or kept them.
let parseApi = null;
function evaluate(r, parsed, ocr) {
  const T = r.lines, P = parsed.items;
  const { pair, S } = align(T, P, (p, t) => sim(p.raw || p.name, t.name));
  // A truth row with several printed lines may legitimately get several parsed rows: sum their quantity.
  const extraRows = new Set();
  const used = new Set(pair.values());
  T.forEach((t, ti) => { if ((t.lines || 1) > 1 && pair.has(ti)) P.forEach((p, pj) => { if (!used.has(pj) && S[ti][pj] >= 0.8) { extraRows.add(pj); used.add(pj); } }); });
  const ocrLines = ocr ? String(ocr.text || '').split(/\n/).filter(Boolean) : [];
  const lines = T.map((t, ti) => {
    const j = pair.has(ti) ? pair.get(ti) : null, item = j === null ? null : P[j];
    const sameRows = item ? [j, ...[...extraRows].filter(k => S[ti][k] >= 0.8)] : [];
    const qty = item ? sameRows.reduce((s, k) => s + (Number(P[k].qty) || 0), 0) : null;
    // Older receipt.js (before v49) has no candidatesFor: it asked the matcher with the printed text only.
    const cands = !item ? [] : parseApi.candidatesFor ? parseApi.candidatesFor(item, STOCK, match) : match.candidates(item.raw || item.name, STOCK);
    return {
      name: t.name, truthQty: t.qty, truthStock: t.stock,
      ocrRead: ocr ? Math.max(0, ...ocrLines.map(l => spanSim(l, t.name))) : null,
      found: !!item, rawSim: item ? Math.round(S[ti][j] * 100) / 100 : 0, parsedRaw: item?.raw ?? null, parsedName: item?.name ?? null,
      qty, selected: item ? !!item.selected : false, low: item ? !!item.low : false,
      top: cands[0]?.item.id ?? null, candidateIds: cands.map(c => c.item.id), autoLinked: false,
    };
  });
  const extras = P.filter((_, k) => !used.has(k)).map(x => ({ raw: x.raw || x.name, qty: x.qty, selected: !!x.selected }));
  return { lines, extras, rejected: parsed.rejected.length, stoppedAtSubtotal: parsed.stoppedAtSubtotal };
}
const pct = (a, b) => b ? `${(100 * a / b).toFixed(1)}% (${a}/${b})` : '—';
function summary(rows) {
  const L = rows.flatMap(r => r.lines), F = L.filter(l => l.found);
  const known = F.filter(l => typeof l.truthStock === 'string' && l.truthStock !== 'any'), fresh = F.filter(l => l.truthStock === null);
  const ocr = L.filter(l => l.ocrRead !== null);
  const edits = rows.map(r => r.lines.filter(l => !l.found).length + r.extras.filter(x => x.selected).length
    + r.lines.filter(l => l.found && (l.qty !== l.truthQty)).length
    + r.lines.filter(l => l.found && (typeof l.truthStock === 'string' && l.truthStock !== 'any' ? l.top !== l.truthStock : l.rawSim < 0.8)).length);
  return {
    receipts: rows.length, truthLines: L.length,
    A_ocrReadable80: ocr.length ? pct(ocr.filter(l => l.ocrRead >= 0.8).length, ocr.length) : 'not OCR (text mode)',
    A_ocrReadable50: ocr.length ? pct(ocr.filter(l => l.ocrRead >= 0.5).length, ocr.length) : 'not OCR (text mode)',
    B_lineDetected: pct(F.length, L.length),
    B_nonProductRows: `${rows.reduce((s, r) => s + r.extras.length, 0)} rows (${rows.reduce((s, r) => s + r.extras.filter(x => x.selected).length, 0)} pre-selected)`,
    B_nonProductShare: pct(rows.reduce((s, r) => s + r.extras.length, 0), rows.reduce((s, r) => s + r.extras.length, 0) + F.length),
    name_raw80: pct(F.filter(l => l.rawSim >= 0.8).length, L.length),
    name_rawExact: pct(F.filter(l => l.rawSim >= 0.999).length, L.length),
    C_qtyCorrect_ofDetected: pct(F.filter(l => l.qty === l.truthQty).length, F.length),
    C_qtyOverCount: F.filter(l => l.qty > l.truthQty).length,
    C_qtyUnderCount: F.filter(l => l.qty < l.truthQty).length,
    D_knownTopCorrect: pct(known.filter(l => l.top === l.truthStock).length, known.length),
    D_wrongTopForKnown: known.filter(l => l.top && l.top !== l.truthStock).length,
    D_newWithStockSuggested: `${fresh.filter(l => l.top).length} of ${fresh.length}`,
    D_autoLinked: L.filter(l => l.autoLinked).length,
    editsPerReceipt: { median: [...edits].sort((a, b) => a - b)[Math.floor(edits.length / 2)], max: Math.max(...edits), total: edits.reduce((a, b) => a + b, 0) },
    ms: TEXT ? 'n/a (text)' : { median: rows.map(r => r.ms).sort((a, b) => a - b)[Math.floor(rows.length / 2)], max: Math.max(...rows.map(r => r.ms)) },
    stoppedAtSubtotal: `${rows.filter(r => r.stoppedAtSubtotal).length}/${rows.length}`,
  };
}

(async () => {
  const parse = parser(); parseApi = parse;
  const rows = [];
  let browser, page, worker;
  if (!TEXT && !CACHE && ENGINE === 'ppocr') {
    const { chromium } = require('@playwright/test');
    browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH || undefined });
    page = await browser.newPage();
    const types = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.onnx': 'application/octet-stream', '.txt': 'text/plain; charset=utf-8', '.html': 'text/html' };
    await page.route('https://app.test/**', route => {
      const rel = new URL(route.request().url()).pathname.replace(/^\//, '');
      if (rel === 'eval.html') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><meta charset="utf-8"><script src="receipt-image-v49.js"></script><script src="receipt-ppocr-v49.js"></script><script src="receipt-ocr-lines-v49.js"></script><script src="receipt-structure-v49.js"></script>' });
      const f = path.join(APP_DIR, rel); if (!f.startsWith(APP_DIR) || !fs.existsSync(f)) return route.fulfill({ status: 404, body: '' });
      route.fulfill({ contentType: types[path.extname(f)] || 'application/octet-stream', body: fs.readFileSync(f) });
    });
    if (process.env.ORT_DIST) await page.route('https://cdn.jsdelivr.net/npm/onnxruntime-web@*/dist/**', route => {
      const f = path.join(process.env.ORT_DIST, path.basename(new URL(route.request().url()).pathname));
      route.fulfill({ contentType: types[path.extname(f)] || 'application/octet-stream', body: fs.readFileSync(f), headers: { 'access-control-allow-origin': '*' } });
    });
    await page.goto('https://app.test/eval.html');
    const t0 = Date.now(); await page.evaluate(() => window.AtokoreReceiptOcr.load()); console.log(`ppocr models loaded in ${Date.now() - t0}ms`);
  } else if (!TEXT && !CACHE) {
    const { chromium } = require('@playwright/test');
    const TESS = require(path.join(process.env.TESS_DIR, 'node_modules/tesseract.js'));
    browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH || undefined });
    page = await browser.newPage();
    await page.setContent('<!doctype html><meta charset="utf-8">');
    if (PREP === 'app') await page.addScriptTag({ content: prepSource() + ';window.__prep=prep;' });
    else await page.addScriptTag({ path: IMAGE_JS });
    worker = await TESS.createWorker('jpn+eng', 1, { langPath: path.join(process.env.TESS_DIR, 'lang'), cachePath: path.join(process.env.TESS_DIR, 'cache'), gzip: true });
    await worker.setParameters({ tessedit_pageseg_mode: '6', preserve_interword_spaces: '1', user_defined_dpi: '300' });
  }
  for (const r of truth) {
    let input, ocr = null, ms = 0;
    if (CACHE) {
      // Parser-only iteration on OCR output saved by an earlier run (EVAL_SAVE_OCR); OCR is not re-run.
      const z = JSON.parse(fs.readFileSync(path.join(CACHE, r.id + '.ocr.json'), 'utf8'));
      ocr = { text: z.text, confidence: z.confidence }; input = z.lines ? z.lines : { text: z.text, tsv: z.tsv }; ms = z.ms;
    } else if (TEXT) {
      const f = path.join(DIR, 'text', r.id + '.txt');
      if (!fs.existsSync(f)) { console.error(`${r.id}: no transcription, skipped`); continue; }
      input = fs.readFileSync(f, 'utf8');
    } else if (ENGINE === 'ppocr') {
      const bytes = fs.readFileSync(path.join(DIR, 'img', r.id + '.jpg')).toString('base64');
      const t0 = Date.now();
      // Same steps as receipt.js: find/crop/turn the paper; when sideways, keep the turn the OCR reads
      // better on a strip; then OCR the whole receipt.
      const res = await page.evaluate(async b64 => {
        const bin = atob(b64), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
        const R = window.AtokoreReceiptImage, O = window.AtokoreReceiptOcr, L = window.AtokoreReceiptLines, S = window.AtokoreReceiptStructure;
        const p = await R.prepare(new File([u], 'r.jpg', { type: 'image/jpeg' }));
        const items = await O.readReceipt(p, { stopAfter: got => S.itemListEnded(L.groupBoxes(got)) });
        return { turn: items.turn, items: [...items], stats: items.stats };
      }, bytes);
      ms = Date.now() - t0;
      const lines = require(path.join(APP_DIR, 'receipt-ocr-lines-v49.js')).groupBoxes(res.items);
      ocr = { text: lines.map(l => l.text).join('\n'), confidence: null };
      input = lines;
      if (process.env.EVAL_SAVE_OCR) {
        fs.writeFileSync(path.join(process.env.EVAL_SAVE_OCR, r.id + '.ocr.txt'), ocr.text);
        fs.writeFileSync(path.join(process.env.EVAL_SAVE_OCR, r.id + '.ocr.json'), JSON.stringify({ text: ocr.text, lines, confidence: null, ms, turn: res.turn, stats: res.stats }));
      }
    } else {
      const bytes = fs.readFileSync(path.join(DIR, 'img', r.id + '.jpg')).toString('base64');
      const t0 = Date.now();
      const prepped = await page.evaluate(async ([b64, mode]) => {
        const bin = atob(b64), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
        const file = new File([u], 'r.jpg', { type: 'image/jpeg' });
        if (mode === 'app') return { images: [(await window.__prep(file)).toDataURL('image/png')], turns: [0] };
        const R = window.AtokoreReceiptImage, p = await R.prepare(file);
        return { found: p.found, sideways: p.sideways, turns: p.candidates.map(c => c.turn), images: p.candidates.map(c => c.canvas.toDataURL('image/png')), strips: p.candidates.length > 1 ? p.candidates.map(c => R.strip(c.canvas).toDataURL('image/png')) : [] };
      }, [bytes, PREP]);
      // Sideways paper: keep the turn the OCR reads with higher confidence on a strip (as the app does).
      let pick = 0;
      if (prepped.strips && prepped.strips.length > 1) {
        const conf = [];
        for (const s of prepped.strips) conf.push((await worker.recognize(Buffer.from(s.split(',')[1], 'base64'), {}, { text: true })).data.confidence);
        pick = conf[1] > conf[0] ? 1 : 0;
      }
      const img = Buffer.from(prepped.images[pick].split(',')[1], 'base64');
      if (process.env.EVAL_SAVE_OCR) fs.writeFileSync(path.join(process.env.EVAL_SAVE_OCR, r.id + '.prep.png'), img);
      const z = await worker.recognize(img, { rotateAuto: true }, { text: true, tsv: true });
      ms = Date.now() - t0;
      ocr = { text: z.data.text, confidence: z.data.confidence };
      input = { text: z.data.text, tsv: z.data.tsv };
      if (process.env.EVAL_SAVE_OCR) {
        fs.writeFileSync(path.join(process.env.EVAL_SAVE_OCR, r.id + '.ocr.txt'), z.data.text);
        fs.writeFileSync(path.join(process.env.EVAL_SAVE_OCR, r.id + '.ocr.json'), JSON.stringify({ text: z.data.text, tsv: z.data.tsv, confidence: z.data.confidence, ms }));
      }
    }
    const parsed = parse.parseReceipt(input);
    const row = { id: r.id, split: r.split, ms, ocrConfidence: ocr ? Math.round(ocr.confidence) : null, ...evaluate(r, parsed, ocr) };
    rows.push(row);
    const L = row.lines;
    console.log(`${r.id} ${TEXT ? 'text' : ms + 'ms'} found ${L.filter(l => l.found).length}/${L.length} qtyOK ${L.filter(l => l.found && l.qty === l.truthQty).length} extras ${row.extras.length}${ocr ? ' ocrRead80 ' + L.filter(l => l.ocrRead >= 0.8).length : ''}`);
  }
  if (worker) await worker.terminate();
  if (browser) await browser.close();
  const out = { mode: TEXT ? 'text (transcription, not OCR)' : CACHE ? 'cached OCR ' + CACHE : ENGINE === 'ppocr' ? 'photo OCR (PP-OCRv6 in Chromium, receipt-ppocr-v49.js)' : 'photo OCR (tesseract.js 5.1.1, prep ' + PREP + ')', split: SPLIT, receiptJs: path.relative(process.cwd(), RECEIPT_JS), summary: summary(rows), rows };
  console.log(JSON.stringify(out.summary, null, 1));
  if (opt('--json')) fs.writeFileSync(String(opt('--json')), JSON.stringify(out, null, 1));
})().catch(e => { console.error(e); process.exit(1); });
