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

test('real-photos.cjs text mode: metrics, unmeasured fields, and pre-selection learned from earlier receipts only', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'receipt-eval-'));
  fs.mkdirSync(path.join(tmp, 'text'));
  // x1 then x2 (id order). The soda is on both; on x2 the tea is read with one extra character.
  fs.writeFileSync(path.join(tmp, 'truth.json'), JSON.stringify({ receipts: [
    { id: 'x1', split: 'dev', lines: [{ name: 'テスト炭酸水 1L', qty: 2, stock: 's1' }, { name: 'テストクッキー', qty: 1, stock: null }, { name: 'テスト麦茶 2L', qty: 1, stock: 's2' }] },
    { id: 'x2', split: 'dev', lines: [{ name: 'テスト炭酸水 1L', qty: 1, stock: 's1' }, { name: 'テスト麦茶 2L', qty: 1, stock: 's2' }, { name: 'テスト?ム', qty: 1, stock: null }] },
  ] }));
  fs.writeFileSync(path.join(tmp, 'text', 'x1.txt'), 'テストストア\nテスト炭酸水 1L\n2コ X 単98 ¥196\nテストクッキー ¥198\nテスト麦茶 2L ¥158\n小計 4点 ¥552\n合計 ¥596');
  fs.writeFileSync(path.join(tmp, 'text', 'x2.txt'), 'テストストア\nテスト炭酸水 1L ¥98\nテスト麦茶 2Lー ¥158\nテストガム ¥100\n小計 3点 ¥356');
  fs.writeFileSync(path.join(tmp, 'stock.json'), JSON.stringify({ items: [{ id: 's1', name: 'テスト炭酸水 1L' }, { id: 's2', name: 'テスト麦茶 2L' }] }));
  const outFile = path.join(tmp, 'out.json');
  run('real-photos.cjs', ['--split', 'all', '--text', '--json', outFile], { RECEIPT_DIR: tmp });
  let r = JSON.parse(fs.readFileSync(outFile, 'utf8'));
  assert.equal(r.summary.B_lineDetected, '100.0% (6/6)');
  assert.equal(r.summary.C_qtyCorrect_ofAll, '100.0% (6/6)');
  // The '?' truth row is not counted as exact and leaves the denominator.
  assert.equal(r.summary.name_exact_ofDecidable, '80.0% (4/5)');
  assert.equal(r.summary.name_undecidableTruthRows, 1);
  assert.ok('name_machineSimilar_ofAll' in r.summary && !('name_sameProduct_ofAll' in r.summary));
  assert.match(r.summary.ms, /未測定/);
  assert.match(r.summary.A_ocrReadable80, /未測定/);
  assert.match(r.summary.B_unreadPlaces, /未測定/);
  assert.match(r.summary.D_autoLinked, /^0 \(no learned aliases/);
  // --learned: the OCR text of x1's confirmed rows is remembered after x1 and used for x2 only.
  run('real-photos.cjs', ['--split', 'all', '--text', '--learned', '--json', outFile], { RECEIPT_DIR: tmp });
  r = JSON.parse(fs.readFileSync(outFile, 'utf8'));
  const [x1, x2] = r.rows;
  assert.equal(x1.lines[0].autoLinked, false, 'nothing is learned before the first receipt');
  assert.equal(x2.lines[0].autoLinkedTo, 's1', 'the exact text read on x1 pre-selects on x2');
  assert.equal(x2.lines[1].autoLinked, false, 'a near text is offered, never pre-selected');
  assert.equal(x2.lines[2].autoLinked, false);
  assert.equal(r.summary.D_learnedLaterOccurrences, 2);
  assert.equal(r.summary.D_autoLinkedWrong, 0);
  fs.rmSync(tmp, { recursive: true, force: true });
});
