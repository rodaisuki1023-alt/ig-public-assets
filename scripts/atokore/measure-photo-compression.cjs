// Measures the app's own product-photo compression (AtokoreProductPhotos.compress) in Chromium on
// SYNTHETIC photo-like images (gradients, noise, shapes, text). Not real photos: real-photo sizes
// must still be measured on an iPhone. Usage:
//   E2E_SITE_ROOT=<built site root> node scripts/atokore/measure-photo-compression.cjs
const { chromium } = require('playwright');
const http = require('node:http'), fs = require('node:fs'), path = require('node:path');
const root = process.env.E2E_SITE_ROOT;
if (!root) throw Error('E2E_SITE_ROOT (a built trial site) is required');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(new URL(q.url, 'http://x').pathname)); if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r); });
server.listen(0, async () => {
  const browser = await chromium.launch(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {});
  try {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}/ig-public-assets/preview-baby-v19/index.html`);
    const rows = await page.evaluate(async () => {
      const make = async (w, h, seed, kind) => {
        const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d');
        let s = seed; const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
        const g = x.createLinearGradient(0, 0, w, h); g.addColorStop(0, `hsl(${seed * 37 % 360},60%,70%)`); g.addColorStop(1, `hsl(${seed * 91 % 360},50%,35%)`);
        x.fillStyle = g; x.fillRect(0, 0, w, h);
        for (let i = 0; i < 40; i++) { x.fillStyle = `hsla(${rnd() * 360},70%,${30 + rnd() * 50}%,.8)`; x.fillRect(rnd() * w, rnd() * h, rnd() * w / 3, rnd() * h / 3); }
        x.fillStyle = '#fff'; x.font = `${Math.round(h / 10)}px sans-serif`; x.fillText('パンパース テープ M 60枚', w * .1, h * .5);
        const img = x.getImageData(0, 0, w, h); for (let i = 0; i < img.data.length; i += 4) { const n = (rnd() - .5) * 40; img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n; } x.putImageData(img, 0, 0);
        const blob = await new Promise(r => c.toBlob(r, kind, .92));
        return new File([blob], 'photo.' + (kind === 'image/png' ? 'png' : 'jpg'), { type: kind });
      };
      const out = [];
      for (const [w, h, kind] of [[4032, 3024, 'image/jpeg'], [3024, 4032, 'image/jpeg'], [1920, 1080, 'image/jpeg'], [1080, 1080, 'image/png'], [640, 480, 'image/jpeg']])
        for (let seed = 1; seed <= 4; seed++) {
          const f = await make(w, h, seed, kind), t = performance.now(), b = await window.AtokoreProductPhotos.compress(f);
          out.push({ w, h, kind, inBytes: f.size, outBytes: b.size, ms: Math.round(performance.now() - t) });
        }
      return out;
    });
    const sizes = rows.map(r => r.outBytes).sort((a, b) => a - b);
    const mean = Math.round(sizes.reduce((a, b) => a + b, 0) / sizes.length);
    console.log(JSON.stringify({ synthetic: true, n: rows.length, outMeanBytes: mean, outMedianBytes: sizes[Math.floor(sizes.length / 2)], outMaxBytes: sizes.at(-1), limitBytes: 81920, rows }, null, 1));
  } finally { await browser.close(); server.close(); }
});
