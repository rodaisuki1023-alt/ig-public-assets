// Smoke test for the receipt evaluation tools, so they cannot silently break again (v49 audit).
// Uses SYNTHETIC data only: a temporary "private" folder with a made-up truth file and transcriptions.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const dir = path.join(__dirname, 'receipt-eval');
const run = (file, args = [], env = {}) => execFileSync(process.execPath, [path.join(dir, file), ...args], { env: { ...process.env, ...env }, encoding: 'utf8', timeout: 120000 });

test('clean-text.cjs (synthetic receipts as text) runs and reports', () => {
  const out = run('clean-text.cjs', ['4']);
  assert.match(out, /"heldOut"/);
});

test('evaluate.cjs --dry-run loads the current parser without OCR', () => {
  const out = JSON.parse(run('evaluate.cjs', ['3', '--dry-run']).trim().split('\n').pop());
  assert.equal(out.dryRun, true);
  assert.ok(out.parsedRows > 0);
});

test('real-photos.cjs text mode: metrics, unmeasured fields and real pre-selection', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'receipt-eval-'));
  fs.mkdirSync(path.join(tmp, 'text'));
  fs.writeFileSync(path.join(tmp, 'truth.json'), JSON.stringify({ receipts: [{ id: 'x1', split: 'dev', lines: [
    { name: 'テスト炭酸水 1L', qty: 2, stock: 's1' },
    { name: 'テストクッキー', qty: 1, stock: null },
    { name: 'テスト麦茶 2L', qty: 1, stock: 's2' },
  ] }] }));
  // The transcription reads the soda exactly as confirmed before, the tea with one character different.
  fs.writeFileSync(path.join(tmp, 'text', 'x1.txt'), 'テストストア\nテスト炭酸水 1L\n2コ X 単98 ¥196\nテストクッキー ¥198\nテスト麦茶 2L ¥158\n小計 4点 ¥552\n合計 ¥596');
  fs.writeFileSync(path.join(tmp, 'stock.json'), JSON.stringify({ items: [{ id: 's1', name: 'テスト炭酸水 1L' }, { id: 's2', name: 'テスト麦茶 2L' }],
    nearAliases: [['s2', 'テスト麦茶 2Lー']] }));
  const base = JSON.parse(fs.readFileSync(path.join(tmp, 'truth.json'), 'utf8'));
  const outFile = path.join(tmp, 'out.json');
  run('real-photos.cjs', ['--split', 'all', '--text', '--json', outFile], { RECEIPT_DIR: tmp });
  let r = JSON.parse(fs.readFileSync(outFile, 'utf8'));
  assert.equal(r.summary.B_lineDetected, '100.0% (3/3)');
  assert.equal(r.summary.C_qtyCorrect_ofAll, '100.0% (3/3)');
  assert.equal(r.summary.name_exact_ofAll, '100.0% (3/3)');
  assert.match(r.summary.ms, /未測定/);
  assert.match(r.summary.A_ocrReadable80, /未測定/);
  assert.match(r.summary.D_autoLinked, /^0 \(no learned aliases/);
  // With the confirmed texts learned, the exact text pre-selects; nothing is pre-selected for the new product.
  run('real-photos.cjs', ['--split', 'all', '--text', '--learned', '--json', outFile], { RECEIPT_DIR: tmp });
  r = JSON.parse(fs.readFileSync(outFile, 'utf8'));
  const rows = r.rows[0].lines;
  assert.equal(rows[0].autoLinkedTo, 's1');
  assert.equal(rows[1].autoLinked, false);
  assert.equal(r.summary.D_autoLinkedWrong, 0);
  assert.ok(base.receipts.length === 1);
  fs.rmSync(tmp, { recursive: true, force: true });
});
