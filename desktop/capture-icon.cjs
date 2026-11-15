#!/usr/bin/env node
// Regenerates desktop/icon.png + desktop/icon.ico from a render of the live menu scene: the red "UP"
// of the dustUP sign, rendered at full resolution through camera.setViewOffset (a zoomed sub-frame
// of the real menu camera), then cropped and scaled with ImageMagick.
//
//   node desktop/capture-icon.cjs <url of a running build, e.g. http://127.0.0.1:5174/?mute=1>
//
// Needs Playwright (as tools/play.cjs) and ImageMagick's convert.
'use strict';

const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const { chromium } = require('playwright');

(async () => {
  const url = process.argv[2] || 'http://127.0.0.1:5174/?mute=1';
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dustup-icon-'));
  const raw = path.join(tmp, 'sign.png');
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 768, height: 768 } });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.goto(url, { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction('window.__ready === true', null, { timeout: 240000, polling: 2000 });
  await page.waitForTimeout(4000);
  await page.evaluate(() => {
    const s = window.__engine.current;
    const place = s.placeCamera.bind(s);
    // the 1280x720 menu frame, sub-rect around the "UP" letters, rendered at the full viewport size
    s.placeCamera = (dt) => {
      place(dt);
      s.camera.aspect = 1280 / 720;
      s.camera.setViewOffset(1280, 720, 596, 60, 200, 200);
    };
  });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: raw, timeout: 240000 });
  await browser.close();
  const png = path.join(__dirname, 'icon.png');
  const ico = path.join(__dirname, 'icon.ico');
  const run = (a) => {
    const r = spawnSync('convert', a, { stdio: 'inherit' });
    if (r.status !== 0) throw new Error('convert failed');
  };
  run([raw, '-crop', '600x600+68+72', '+repage', '-resize', '512x512', png]);
  run([png, '-define', 'icon:auto-resize=256,128,64,48,32,24,16', ico]);
  console.log('wrote', png, ico);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
