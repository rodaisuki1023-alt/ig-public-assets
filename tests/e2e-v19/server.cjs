// Builds the v19 trial exactly like the Pages workflow, then serves it with no-cache headers.
// Layout mirrors GitHub Pages: /ig-public-assets/ (a production stand-in) and
// /ig-public-assets/preview-baby-v19/ (the sandboxed trial) share one origin.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const repo = path.resolve(__dirname, '../..');
const root = process.env.E2E_SITE_ROOT;
const port = Number(process.env.E2E_PORT || 4719);
if (!root) throw new Error('E2E_SITE_ROOT is required');

const site = path.join(root, 'ig-public-assets');
fs.rmSync(root, { recursive: true, force: true });
// Production stand-in: same app with production storage keys and no family sync network calls.
fs.mkdirSync(site, { recursive: true });
fs.cpSync(path.join(repo, 'atokore-live-v125'), site, { recursive: true });
fs.writeFileSync(path.join(site, 'family.js'), '/* e2e production stand-in: family sync disabled */\n');
execFileSync('python3', ['-I', path.join(repo, 'scripts/atokore/build-preview.py'), path.join(repo, 'atokore-live-v125'), path.join(site, 'preview-baby-v19'), '19'], { stdio: 'inherit' });

const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml' };
http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let file = path.normalize(path.join(root, decodeURIComponent(url.pathname)));
  if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) { res.writeHead(404).end('not found'); return; }
  res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
}).listen(port, '127.0.0.1', () => console.log(`e2e site on http://127.0.0.1:${port}/ig-public-assets/`));
