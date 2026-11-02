// Headless screenshot helper: node tools/shot.cjs <url> <out.png> [width] [height] [waitMs]
// Waits for window.__ready (set by the page) then captures. Prints console errors.
const { chromium } = require('playwright');
(async () => {
const [url, out, w = '1280', h = '720', waitMs = '400'] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: +w, height: +h } });
const logs = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => logs.push('[pageerror] ' + e.message));
await page.goto(url, { waitUntil: 'load', timeout: 120000 });
try { await page.waitForFunction('window.__ready === true', null, { timeout: 120000 }); } catch { logs.push('[shot] timeout waiting for __ready'); }
await page.waitForTimeout(+waitMs);
await page.screenshot({ path: out });
console.log(logs.slice(0, 30).join('\n') || '(no console errors)');
await browser.close();

})();
