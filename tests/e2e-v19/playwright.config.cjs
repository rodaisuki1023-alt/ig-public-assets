// Real-browser tests for the v19 trial. Run: npx playwright test -c tests/e2e-v19/playwright.config.cjs
// Set PW_CHROMIUM_PATH to use a preinstalled Chromium instead of a downloaded one.
const path = require('node:path');
const os = require('node:os');
const { defineConfig, devices } = require('@playwright/test');

const port = Number(process.env.E2E_PORT || 4719);
process.env.E2E_PORT = String(port);
process.env.E2E_SITE_ROOT = process.env.E2E_SITE_ROOT || path.join(os.tmpdir(), 'atokore-e2e-site');
const chromiumLaunch = process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {};
const iphone = { isMobile: true, hasTouch: true, deviceScaleFactor: 2, locale: 'ja-JP' };

module.exports = defineConfig({
  testDir: __dirname,
  testMatch: /.*\.spec\.cjs/,
  timeout: 60000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: { baseURL: `http://127.0.0.1:${port}`, viewport: { width: 390, height: 844 }, ...iphone },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], ...iphone, viewport: { width: 390, height: 844 }, launchOptions: chromiumLaunch } },
    ...(process.env.E2E_SKIP_WEBKIT ? [] : [{ name: 'webkit', use: { ...devices['iPhone 13'], locale: 'ja-JP' } }]),
  ],
  webServer: {
    command: `node ${JSON.stringify(path.join(__dirname, 'server.cjs'))}`,
    url: `http://127.0.0.1:${port}/ig-public-assets/preview-baby-v19/`,
    reuseExistingServer: false,
    timeout: 60000,
    env: { E2E_SITE_ROOT: process.env.E2E_SITE_ROOT, E2E_PORT: String(port) },
  },
});
