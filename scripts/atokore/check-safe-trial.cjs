// Opens a safe trial build in Chromium (local static server, Service Worker allowed) and checks it:
// no request leaves this origin, no CSP violation, robots noindex, null household config, OCR hidden,
// its own storage keys / photo DB / SW caches, the build SHA shown, and the main actions working.
// Usage: node scripts/atokore/check-safe-trial.cjs <siteRoot> <pathInSite> [screenshotDir]
const { chromium } = require('playwright');
const http = require('node:http'), fs = require('node:fs'), path = require('node:path');
const [root, sub, shots] = process.argv.slice(2);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.onnx': 'application/octet-stream', '.wasm': 'application/wasm' };
const server = http.createServer((q, r) => {
  const f = path.join(root, decodeURIComponent(new URL(q.url, 'http://x').pathname));
  if (!f.startsWith(path.resolve(root)) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); }
  r.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r);
});
const fail = [];
const check = (ok, label) => { console.log((ok ? 'PASS ' : 'FAIL ') + label); if (!ok) fail.push(label); };
server.listen(0, async () => {
  const origin = `http://127.0.0.1:${server.address().port}`, url = origin + '/' + sub.replace(/^\/|\/$/g, '') + '/index.html';
  const browser = await chromium.launch(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {});
  try {
    for (const width of [320, 393, 430]) {
      const ctx = await browser.newContext({ viewport: { width, height: 852 }, isMobile: true, hasTouch: true, locale: 'ja-JP' });
      const page = await ctx.newPage(); const outside = [], errors = [];
      page.on('request', q => { if (!q.url().startsWith(origin) && !/^(data|blob):/.test(q.url())) outside.push(q.url()); });
      page.on('pageerror', e => errors.push(e.message));
      await page.addInitScript(() => { window.__csp = []; document.addEventListener('securitypolicyviolation', e => window.__csp.push(e.violatedDirective + ' ' + e.blockedURI)); });
      await page.goto(url); await page.waitForTimeout(800);
      const facts = await page.evaluate(async () => ({
        robots: document.querySelector('meta[name=robots]')?.content, csp: !!document.querySelector('meta[http-equiv="Content-Security-Policy"]'),
        config: window.ATOKORE_HOUSEHOLD_CONFIG, household: !!window.AtokoreHousehold, photoGate: window.AtokoreHousehold?.photoSharingEnabled?.() ?? false, joined: window.AtokoreHousehold?.homeState?.().joined ?? false,
        ocrHidden: [...document.querySelectorAll('[data-atk-experimental-receipt]')].every(x => x.hidden || !x.offsetParent),
        build: window.AtokoreBuildInfo?.build, title: document.title,
        keys: Object.keys(localStorage), dbs: indexedDB.databases ? (await indexedDB.databases()).map(d => d.name) : null,
      }));
      if (width === 320) {
        check(facts.robots === 'noindex, nofollow, noarchive', 'robots noindex meta');
        check(facts.csp, 'CSP meta present');
        check(facts.config === null, 'household config is null');
        check(facts.photoGate === false && facts.joined === false, 'family sharing and cloud photos off (sync module ' + (facts.household ? 'loaded, disabled' : 'not started') + ')');
        check(facts.ocrHidden, 'OCR hidden');
        check(/^trial-v19-[0-9a-f]{7}$/.test(facts.build || '') && facts.title.includes(facts.build), 'build SHA shown: ' + facts.build);
      }
      // Main actions on synthetic data: add a product, buy from the list, open the family trial.
      await page.evaluate(() => window.go('add'));
      await page.evaluate(() => { items.push({ id: 900 + Math.floor(Math.random() * 99), name: '合成 おしりふき', cat: 'ベビー', qty: 1, unit: 'パック' }); save(); window.render?.(); });
      await page.evaluate(() => window.go('premium'));
      await page.locator('#atkFamilyTrial > summary').click();
      const trialOk = await page.locator('#atkFamilyTrial').innerText();
      await page.evaluate(() => window.go('stock'));
      if (shots) await page.screenshot({ path: path.join(shots, `safe-${width}-stock.png`), fullPage: false });
      await page.evaluate(() => window.go('premium'));
      if (shots) await page.screenshot({ path: path.join(shots, `safe-${width}-premium.png`), fullPage: false });
      const after = await page.evaluate(async () => ({ keys: Object.keys(localStorage), csp: window.__csp, scroll: document.documentElement.scrollWidth - innerWidth,
        caches: (await caches.keys()), sw: !!(await navigator.serviceWorker?.getRegistration?.()) }));
      check(outside.length === 0, `${width}px: no request outside this origin (${outside.length})`);
      check(after.csp.length === 0, `${width}px: no CSP violation ${after.csp.join(' | ')}`);
      check(errors.length === 0, `${width}px: no page error ${errors.join(' | ')}`);
      check(after.scroll <= 0, `${width}px: no sideways scroll`);
      check(trialOk.includes('【試用・合成データ】'), `${width}px: family trial opens`);
      if (width === 320) {
        check(after.keys.length > 0 && after.keys.every(k => k.startsWith('atokoreSafeTrial')), 'storage keys are the safe-trial ones: ' + after.keys.join(','));
        check((facts.dbs || []).every(n => n.startsWith('atokoreSafeTrial')), 'photo DB is the safe-trial one: ' + (facts.dbs || []).join(','));
        check(after.caches.every(c => c.startsWith('atokore-safe-trial-')), 'service-worker caches are the safe-trial ones: ' + after.caches.join(','));
      }
      await ctx.close();
    }
  } finally { await browser.close(); server.close(); }
  console.log(fail.length ? `FAILED ${fail.length}` : 'ALL PASS'); process.exit(fail.length ? 1 : 0);
});
