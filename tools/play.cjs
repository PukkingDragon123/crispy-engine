// Scripted headless play-test: node tools/play.cjs <url> <outPrefix> <script.json|inline-json>
// Script: [{ "wait": ms } | { "down": "KeyW" } | { "up": "KeyW" } | { "click": true } | { "shot": "name" } | { "eval": "js" }]
const { chromium } = require('playwright');
(async () => {
  const [url, out, scriptArg, w = '1280', h = '720'] = process.argv.slice(2);
  const fs = require('fs');
  const script = JSON.parse(fs.existsSync(scriptArg) ? fs.readFileSync(scriptArg, 'utf8') : scriptArg);
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: +w, height: +h } });
  const logs = [];
  page.on('console', (m) => { const t = m.type(); if (t === 'error' || t === 'warning' || t === 'log') logs.push(`[${t}] ${m.text()}`); });
  page.on('pageerror', (e) => logs.push('[pageerror] ' + e.message + '\n' + (e.stack || '').split('\n').slice(0, 4).join('\n')));
  await page.goto(url, { waitUntil: 'load', timeout: 180000 });
  try { await page.waitForFunction('window.__ready === true', null, { timeout: 180000 }); } catch { logs.push('[play] timeout waiting for __ready'); }
  for (const step of script) {
    if (step.wait) await page.waitForTimeout(step.wait);
    if (step.down) await page.keyboard.down(step.down);
    if (step.up) await page.keyboard.up(step.up);
    if (step.press) await page.keyboard.press(step.press);
    if (step.click) await page.mouse.click(+w / 2, +h / 2);
    if (step.move) await page.mouse.move(step.move[0], step.move[1]);
    if (step.mousedown) { await page.mouse.move(+w / 2, +h / 2); await page.mouse.down({ button: step.mousedown }); }
    if (step.mouseup) await page.mouse.up({ button: step.mouseup });
    if (step.eval) { try { const r = await page.evaluate(step.eval); if (r !== undefined) logs.push('[eval] ' + JSON.stringify(r)); } catch (e) { logs.push('[eval-error] ' + e.message); } }
    if (step.shot) await page.screenshot({ path: `${out}_${step.shot}.png`, timeout: 180000 });
  }
  console.log(logs.slice(0, 60).join('\n') || '(no logs)');
  await browser.close();
})();
