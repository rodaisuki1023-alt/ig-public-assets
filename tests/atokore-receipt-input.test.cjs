const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'atokore-live-v125', 'receipt.js'), 'utf8');

assert.match(source, /id="receiptCamera"[^>]+capture="environment"/, 'カメラ撮影用の入力があること');
const filePicker = source.match(/<input id="receiptFile"[^>]+>/)?.[0] || '';
assert.ok(filePicker, '写真・ファイル選択用の入力があること');
assert.doesNotMatch(filePicker, /capture=/, 'ファイル選択側はカメラを強制しないこと');
assert.match(filePicker, /accept="image\/\*/, '画像ファイルを選択できること');
assert.equal((source.match(/onchange="receiptPickedV7\(this\)"/g) || []).length, 2, '両方の入力が同じOCR処理へ流れること');
assert.match(source, /画像ファイルを選んでください/, '画像以外を明確に拒否すること');

console.log('Atokore receipt inputs: all tests passed');
