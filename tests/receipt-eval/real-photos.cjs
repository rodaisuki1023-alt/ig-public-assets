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
const STOCK_RAW = JSON.parse(fs.readFileSync(path.join(DIR, 'stock.json'), 'utf8'));
const STOCK = Array.isArray(STOCK_RAW) ? STOCK_RAW : STOCK_RAW.items;
const LEARNED = !!opt('--learned');
const truthAll = JSON.parse(fs.readFileSync(path.join(DIR, 'truth.json'), 'utf8')).receipts;
const source = fs.readFileSync(RECEIPT_JS, 'utf8');
delete require.cache[MATCH_JS];
const match = require(MATCH_JS);

// The app's parser, loaded the same way as the other evaluation tools (load-receipt.cjs).
const parser = () => require('./load-receipt.cjs').loadReceipt({ receiptJs: RECEIPT_JS });
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
// Row correspondence: a parsed row is paired with a truth row when their names are at least 0.34 alike
// (dynamic programming over the receipt order). 0.34 only decides WHICH row to compare; whether the name
// and quantity are right is judged separately below (exact name, product identity, quantity).
// Several printed lines of one product (two identical warehouse-club lines) are one truth row with "lines": n.
let parseApi = null;
const digits = s => (String(s).normalize('NFKC').match(/\d+/g) || []).join(',');
function identity(parsedName, truthName) {
  // exact: same text after width/space normalisation. A truth name with '?' (not readable by eye) cannot be
  // checked letter by letter: it is never counted as exact (v49 2nd audit) and is reported as undecidable.
  const a = norm(truthName), b = norm(parsedName);
  if (!a.includes('?') && a === b) return 'exact';
  // same product: very close text, same numbers (size, amount, count) and no size/form/brand/amount conflict.
  const f = match.features(parsedName), g = match.features(truthName.replace(/\?/g, ''));
  if (sim(parsedName, truthName) >= 0.85 && digits(parsedName) === digits(truthName.replace(/\?/g, '')) && !match.conflict(f, g)) return 'same';
  // different: the name points to something else (wrong numbers, attributes or largely different text).
  return 'different';
}
function evaluate(r, parsed, ocr, stock, dropped, input) {
  const T = r.lines, P = parsed.items;
  const { pair, S } = align(T, P, (p, t) => sim(p.raw || p.name, t.name));
  const extraRows = new Set();
  const used = new Set(pair.values());
  T.forEach((t, ti) => { if ((t.lines || 1) > 1 && pair.has(ti)) P.forEach((p, pj) => { if (!used.has(pj) && S[ti][pj] >= 0.8) { extraRows.add(pj); used.add(pj); } }); });
  const ocrLines = ocr ? String(ocr.text || '').split(/\n/).filter(Boolean) : [];
  const rejectedTexts = (parsed.rejected || []).map(x => String(x.text || ''));
  const lines = T.map((t, ti) => {
    const j = pair.has(ti) ? pair.get(ti) : null, item = j === null ? null : P[j];
    const sameRows = item ? [j, ...[...extraRows].filter(k => S[ti][k] >= 0.8)] : [];
    // qtyRow: the paired row only. qtyTotal: all rows of this product (a product printed on two lines).
    const qtyRow = item ? Number(item.qty) || 0 : null;
    const qty = item ? sameRows.reduce((s, k) => s + (Number(P[k].qty) || 0), 0) : null;
    // Candidates and pre-selection come from receipt.js itself (rowCandidates / preselectId, the functions the
    // review screen runs): no copy of the condition here. Older receipt.js without them: any learned candidate.
    let cands = [], autoId = null;
    if (item && parseApi.rowCandidates) { const rc = parseApi.rowCandidates(item, stock, match); cands = rc.map(c => ({ ...c, item: { id: c.id } })); autoId = parseApi.preselectId(item, rc); }
    else if (item) { cands = parseApi.candidatesFor ? parseApi.candidatesFor(item, stock, match) : match.candidates(item.raw || item.name, stock); autoId = cands[0] && cands[0].learned ? cands[0].item.id : null; }
    const auto = autoId != null;
    const id = item ? identity(item.name, t.name) : null;
    return {
      name: t.name, truthQty: t.qty, truthStock: t.stock, printedLines: t.lines || 1,
      ocrRead: ocr ? Math.max(0, ...ocrLines.map(l => spanSim(l, t.name))) : null,
      found: !!item, alignSim: item ? Math.round(S[ti][j] * 100) / 100 : 0, rawSim: item ? Math.round(S[ti][j] * 100) / 100 : 0,
      parsedRaw: item?.raw ?? null, parsedName: item?.name ?? null, identity: id,
      qty, qtyRow, selected: item ? !!item.selected : false, low: item ? !!item.low : false, reasons: item?.reasons || [],
      top: cands[0]?.item.id ?? null, candidateIds: cands.map(c => c.item.id), autoLinked: auto, autoLinkedTo: autoId, truthUndecidable: String(t.name).includes('?'), parsedItem: item,
      // A missed product that still appears in the "読み取れなかった行" list can be noticed by the person.
      missedButListed: !item && rejectedTexts.some(x => spanSim(x, t.name) >= 0.6),
    };
  });
  const extras = P.filter((_, k) => !used.has(k)).map(x => ({ raw: x.raw || x.name, qty: x.qty, selected: !!x.selected }));
  // Places the OCR could not read inside the item list, as the review screen lists them (photo runs that kept
  // the dropped runs only; older caches did not keep them).
  const unread = Array.isArray(dropped) && parseApi.unreadAreas && Array.isArray(input) ? parseApi.unreadAreas(input, parsed, dropped) : null;
  return { lines, extras, rejected: parsed.rejected.length, printedCount: parsed.printedCount ?? null, countedQty: parsed.countedQty ?? null, stoppedAtSubtotal: parsed.stoppedAtSubtotal,
    unreadPlaces: unread ? unread.places.length : null, unreadInLine: unread ? unread.inLine : null };
}
const pct = (a, b) => b ? `${(100 * a / b).toFixed(1)}% (${a}/${b})` : '未測定（分母0）';
function summary(rows, learnedMode) {
  const L = rows.flatMap(r => r.lines), F = L.filter(l => l.found);
  const known = F.filter(l => typeof l.truthStock === 'string' && l.truthStock !== 'any'), fresh = F.filter(l => l.truthStock === null);
  const ocr = L.filter(l => l.ocrRead !== null);
  const wrong = F.filter(l => l.identity === 'different' || l.qty !== l.truthQty);
  const auto = L.filter(l => l.autoLinked);
  // Estimated places to correct (not measured with people): missing rows, pre-selected extra rows, wrong
  // quantities, and names/candidates that need changing.
  const edits = rows.map(r => r.lines.filter(l => !l.found).length + r.extras.filter(x => x.selected).length
    + r.lines.filter(l => l.found && (l.qty !== l.truthQty)).length
    + r.lines.filter(l => l.found && (typeof l.truthStock === 'string' && l.truthStock !== 'any' ? l.top !== l.truthStock : l.identity === 'different')).length);
  const med = a => a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] : '未測定';
  return {
    receipts: rows.length, truthLines: L.length, printedProductLines: L.reduce((s, l) => s + l.printedLines, 0),
    A_ocrReadable80: ocr.length ? pct(ocr.filter(l => l.ocrRead >= 0.8).length, ocr.length) : '未測定（文字列モード）',
    B_lineDetected: pct(F.length, L.length),
    B_missedButListed: `${L.filter(l => l.missedButListed).length} of ${L.length - F.length} missed rows appear in 読み取れなかった行`,
    B_nonProductRows: `${rows.reduce((s, r) => s + r.extras.length, 0)} rows (${rows.reduce((s, r) => s + r.extras.filter(x => x.selected).length, 0)} pre-selected)`,
    B_unreadListPerReceipt: { median: med(rows.map(r => r.rejected)), max: Math.max(...rows.map(r => r.rejected)), total: rows.reduce((s, r) => s + r.rejected, 0) },
    countCheck: `${rows.filter(r => r.printedCount !== null).length}/${rows.length} receipts with a printed count; mismatch shown on ${rows.filter(r => r.printedCount !== null && r.printedCount !== r.countedQty).length}`,
    // Exact: '?' truth rows are left out of the denominator and counted as undecidable.
    name_exact_ofDecidable: pct(F.filter(l => !l.truthUndecidable && l.identity === 'exact').length, L.filter(l => !l.truthUndecidable).length),
    name_undecidableTruthRows: L.filter(l => l.truthUndecidable).length,
    // MACHINE judgement, not a person's: letters ≥85% alike after normalisation, the same numbers and no
    // size/flavour/brand/amount conflict (receipt-match-v38 features). Not a product-identity accuracy.
    name_machineSimilar_ofAll: pct(F.filter(l => l.identity !== 'different').length, L.length),
    name_machineDifferent_ofDetected: pct(F.filter(l => l.identity === 'different').length, F.length),
    C_qtyCorrect_ofDetected: pct(F.filter(l => l.qty === l.truthQty).length, F.length),
    C_qtyCorrect_ofAll: pct(F.filter(l => l.qty === l.truthQty).length, L.length),
    C_qtyRowCorrect_ofDetected: pct(F.filter(l => l.qtyRow === l.truthQty).length, F.length),
    C_qtyOverCount: F.filter(l => l.qty > l.truthQty).length,
    C_qtyUnderCount: F.filter(l => l.qty < l.truthQty).length,
    E_wrongRowsFlagged: pct(wrong.filter(l => l.low || l.reasons.length).length, wrong.length),
    D_knownTopCorrect: pct(known.filter(l => l.top === l.truthStock).length, known.length),
    D_wrongTopForKnown: known.filter(l => l.top && l.top !== l.truthStock).length,
    D_newWithStockSuggested: `${fresh.filter(l => l.top).length} of ${fresh.length}`,
    D_autoLinked: learnedMode ? `${auto.length} (aliases learned from the OCR text of EARLIER receipts only; ${Math.max(0, ...rows.map(r => r.learnedAliases || 0))} aliases learned before the last receipt)` : `${auto.length} (no learned aliases: pre-selection cannot happen)`,
    D_learnedLaterOccurrences: learnedMode ? L.filter(l => l.learnedBefore).length : '未測定（--learned なし）',
    D_autoLinkedWrong: auto.filter(l => l.truthStock === null || (typeof l.truthStock === 'string' && l.truthStock !== 'any' && l.autoLinkedTo !== l.truthStock)).length,
    D_autoLinkedUnknown: auto.filter(l => l.truthStock === 'any').length,
    estimatedCorrections: { median: med(edits), max: Math.max(...edits), total: edits.reduce((a, b) => a + b, 0) },
    ms: TEXT ? '未測定（文字列モード）' : { median: med(rows.map(r => r.ms)), max: Math.max(...rows.map(r => r.ms)) },
    stoppedAtSubtotal: `${rows.filter(r => r.stoppedAtSubtotal).length}/${rows.length}`,
    B_unreadPlaces: rows.some(r => r.unreadPlaces === null) ? '未測定（OCRの除外断片を保存していない実行）' : { total: rows.reduce((s, r) => s + r.unreadPlaces, 0), max: Math.max(...rows.map(r => r.unreadPlaces)), receiptsWithAny: rows.filter(r => r.unreadPlaces > 0).length, inReadLines: rows.reduce((s, r) => s + r.unreadInLine, 0) },
    countNotChecked: `${rows.filter(r => r.printedCount === null).length}/${rows.length} receipts: printed count not read (the screen says the count check was not possible)`,
  };
}
// --learned (v49 2nd audit): receipts are read in id order; after each receipt the text the APP would remember
// on confirmation (the parsed row's OCR text, receipt.js onSaved → remember(item, raw)) is stored for the rows
// that the truth links to a registered product, and only LATER receipts are evaluated with it. No alias is
// made from the truth names. The ids are not purchase dates; with 15 receipts few products repeat, so the
// number of later occurrences is reported next to the result.
function learnAfter(stock, row) {
  let n = 0;
  for (const l of row.lines) {
    if (!l.found || typeof l.truthStock !== 'string' || l.truthStock === 'any' || !l.parsedItem) continue;
    const it = stock.find(x => x.id === l.truthStock); if (it && l.parsedItem.raw) { match.remember(it, l.parsedItem.raw); n++; }
  }
  return n;
}

(async () => {
  const parse = parser(); parseApi = parse;
  const EVAL_STOCK = LEARNED ? STOCK.map(x => ({ ...x, receiptAliases: [] })) : STOCK;
  const seenStock = new Set();let aliasCount = 0;
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
    let input, ocr = null, ms = 0, dropped = null;
    if (CACHE) {
      // Parser-only iteration on OCR output saved by an earlier run (EVAL_SAVE_OCR); OCR is not re-run.
      const z = JSON.parse(fs.readFileSync(path.join(CACHE, r.id + '.ocr.json'), 'utf8'));
      // Raw OCR boxes are regrouped with the current receipt-ocr-lines-v49.js, so line-grouping changes are measured too.
      const regrouped = z.items ? require(process.env.LINES_JS || path.join(APP_DIR, 'receipt-ocr-lines-v49.js')).groupBoxes(z.items) : null;
      ocr = { text: regrouped ? regrouped.map(l => l.text).join('\n') : z.text, confidence: z.confidence }; input = regrouped || (z.lines ? z.lines : { text: z.text, tsv: z.tsv }); ms = z.ms; dropped = z.dropped || null;
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
        return { turn: items.turn, items: [...items], dropped: items.dropped || null, stats: items.stats };
      }, bytes);
      ms = Date.now() - t0;
      const lines = require(path.join(APP_DIR, 'receipt-ocr-lines-v49.js')).groupBoxes(res.items);
      ocr = { text: lines.map(l => l.text).join('\n'), confidence: null };
      input = lines; dropped = res.dropped;
      if (process.env.EVAL_SAVE_OCR) {
        fs.writeFileSync(path.join(process.env.EVAL_SAVE_OCR, r.id + '.ocr.txt'), ocr.text);
        fs.writeFileSync(path.join(process.env.EVAL_SAVE_OCR, r.id + '.ocr.json'), JSON.stringify({ text: ocr.text, lines, items: res.items, dropped: res.dropped, confidence: null, ms, turn: res.turn, stats: res.stats }));
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
    const row = { id: r.id, split: r.split, ms, ocrConfidence: ocr ? Math.round(ocr.confidence) : null, learnedAliases: aliasCount, ...evaluate(r, parsed, ocr, EVAL_STOCK, dropped, input) };
    for (const l of row.lines) { const known = typeof l.truthStock === 'string' && l.truthStock !== 'any'; l.learnedBefore = LEARNED && known && seenStock.has(l.truthStock); if (known && l.found) seenStock.add(l.truthStock); }
    if (LEARNED) aliasCount += learnAfter(EVAL_STOCK, row);
    for (const l of row.lines) delete l.parsedItem;
    rows.push(row);
    const L = row.lines;
    console.log(`${r.id} ${TEXT ? 'text' : ms + 'ms'} found ${L.filter(l => l.found).length}/${L.length} qtyOK ${L.filter(l => l.found && l.qty === l.truthQty).length} extras ${row.extras.length}${ocr ? ' ocrRead80 ' + L.filter(l => l.ocrRead >= 0.8).length : ''}`);
  }
  if (worker) await worker.terminate();
  if (browser) await browser.close();
  const out = { mode: TEXT ? 'text (transcription, not OCR)' : CACHE ? 'cached OCR ' + CACHE : ENGINE === 'ppocr' ? 'photo OCR (PP-OCRv6 in Chromium, receipt-ppocr-v49.js)' : 'photo OCR (tesseract.js 5.1.1, prep ' + PREP + ')', split: SPLIT, receiptJs: path.relative(process.cwd(), RECEIPT_JS), summary: summary(rows, LEARNED), learned: LEARNED, rows };
  console.log(JSON.stringify(out.summary, null, 1));
  if (opt('--json')) fs.writeFileSync(String(opt('--json')), JSON.stringify(out, null, 1));
})().catch(e => { console.error(e); process.exit(1); });
