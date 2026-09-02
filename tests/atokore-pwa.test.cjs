const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', 'atokore-live-v125');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const index = read('index.html');
const manifest = JSON.parse(read('manifest.webmanifest'));
const worker = read('service-worker.js');
const pwa = read('pwa.js');

assert.equal(manifest.name, 'あとこれ｜家庭の在庫・買い物リスト');
assert.equal(manifest.short_name, 'あとこれ');
assert.equal(manifest.display, 'standalone');
assert.equal(manifest.start_url, './?source=pwa');
assert.equal(manifest.scope, './');
assert.equal(manifest.theme_color, '#1677ff');
assert.ok(manifest.icons.some(icon => icon.sizes === '192x192'));
assert.ok(manifest.icons.some(icon => icon.sizes === '512x512' && icon.purpose.includes('maskable')));

for (const file of ['icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png']) {
  assert.ok(fs.existsSync(path.join(root, file)), `missing ${file}`);
  assert.ok(worker.includes(`'./${file}'`), `service worker does not cache ${file}`);
}

assert.match(index, /rel="manifest" href="\.\/manifest\.webmanifest"/);
assert.match(index, /rel="apple-touch-icon" href="\.\/icons\/icon-180\.png"/);
assert.match(index, /name="apple-mobile-web-app-capable" content="yes"/);
assert.match(index, /src="\.\/pwa\.js\?v=pwa1"/);
assert.match(pwa, /ホーム画面に追加/);
assert.match(pwa, /serviceWorker\.register\('\.\/service-worker\.js'/);
assert.match(worker, /request\.mode === 'navigate'/);

console.log('Atokore PWA tests passed');
