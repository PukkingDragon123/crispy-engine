// dustUP desktop shell (Electron main process).
//
// The vite production build is served from a privileged custom scheme, app://dustup/, so ES module
// workers, fetch() of the audio files and the bundled font all load same-origin with no file:// or
// CORS quirks, and localStorage lives under one stable origin inside a stable userData folder.
//
// Flags (also readable from the environment, see below):
//   --dev            enable devtools (F12 / Ctrl+Shift+I) and forward the page console to stdout
//   --log-console    forward the page console to stdout without enabling devtools
//   --no-vsync       uncap the frame rate (off by default: it burns GPU and can tear)
//   --windowed       start in a normal window instead of maximized
//   --game-dir=PATH  serve the game from PATH instead of the bundled ./game folder
//   --smoke-test[=out.png]  boot, wait for the menu (window.__ready), optionally capture it, then
//                    exit 0 on success or 1 on a timeout or a page error
'use strict';

const { app, BrowserWindow, Menu, protocol, session, screen } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const argv = process.argv.slice(1);
const flag = (name) => argv.includes('--' + name);
const opt = (name) => {
  const hit = argv.find((a) => a.startsWith('--' + name + '='));
  return hit ? hit.slice(name.length + 3) : null;
};

const DEV = flag('dev') || process.env.DUSTUP_DEV === '1';
const SMOKE = flag('smoke-test') || opt('smoke-test') !== null;
const SMOKE_SHOT = opt('smoke-test');
const LOG_CONSOLE = DEV || SMOKE || flag('log-console');
const GAME_DIR = path.resolve(opt('game-dir') || process.env.DUSTUP_GAME_DIR || path.join(__dirname, 'game'));
const SCHEME = 'app';
const HOST = 'dustup';
const ORIGIN = `${SCHEME}://${HOST}`;

// ---------------------------------------------------------------- identity + save location
// Pin the name and userData folder so save data (localStorage) survives updates, renames of the
// install folder and dev vs packaged runs: %APPDATA%\dustUP on Windows, ~/.config/dustUP on Linux.
app.setName('dustUP');
app.setPath('userData', path.join(app.getPath('appData'), 'dustUP'));
if (process.platform === 'win32') app.setAppUserModelId('com.dustup.game');

// one copy at a time: two instances would fight over the same localStorage database
if (!SMOKE && !app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

// ---------------------------------------------------------------- GPU + timing
app.commandLine.appendSwitch('force_high_performance_gpu');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
if (flag('no-vsync')) {
  app.commandLine.appendSwitch('disable-gpu-vsync');
  app.commandLine.appendSwitch('disable-frame-rate-limit');
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, codeCache: true, corsEnabled: true },
  },
]);

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "worker-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "media-src 'self' data: blob:",
  "connect-src 'self' data: blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-src 'none'",
].join('; ');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.txt': 'text/plain; charset=utf-8',
};

async function serve(request) {
  const url = new URL(request.url);
  if (url.host !== HOST) return new Response('not found', { status: 404 });
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  const file = path.normalize(path.join(GAME_DIR, rel));
  // never leave the game folder
  if (file !== GAME_DIR && !file.startsWith(GAME_DIR + path.sep)) return new Response('forbidden', { status: 403 });
  try {
    const body = await fs.promises.readFile(file);
    const ext = path.extname(file).toLowerCase();
    const headers = {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': String(body.length),
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    };
    if (ext === '.html') headers['Content-Security-Policy'] = CSP;
    return new Response(body, { status: 200, headers });
  } catch {
    return new Response('not found', { status: 404 });
  }
}

// ---------------------------------------------------------------- window
let win = null;
const smokeErrors = [];

function toggleFullscreen() {
  if (win) win.setFullScreen(!win.isFullScreen());
}

function createWindow() {
  const work = screen.getPrimaryDisplay().workAreaSize;
  const minW = Math.min(1280, work.width);
  const minH = Math.min(720, work.height);
  win = new BrowserWindow({
    title: 'dustUP',
    width: Math.max(minW, Math.min(1600, work.width)),
    height: Math.max(minH, Math.min(900, work.height)),
    minWidth: minW,
    minHeight: minH,
    frame: false,
    fullscreenable: true,
    autoHideMenuBar: true,
    backgroundColor: '#040309',
    show: false,
    icon: path.join(__dirname, process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      backgroundThrottling: false,
      devTools: DEV,
      spellcheck: false,
    },
  });
  win.setMenuBarVisibility(false);
  win.removeMenu();

  // the page title must not replace the window title
  win.on('page-title-updated', (e) => e.preventDefault());

  win.once('ready-to-show', () => {
    if (!flag('windowed') && !SMOKE) win.maximize();
    win.show();
    win.focus();
  });

  const wc = win.webContents;
  wc.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    const key = input.key;
    if (key === 'F11' || (key === 'Enter' && input.alt)) {
      e.preventDefault();
      if (!input.isAutoRepeat) toggleFullscreen();
      return;
    }
    if (DEV && (key === 'F12' || (key.toLowerCase() === 'i' && input.control && input.shift))) {
      e.preventDefault();
      wc.toggleDevTools();
      return;
    }
    // no browser zoom or reload shortcuts in release
    if (!DEV && (input.control || input.meta) && ['r', '=', '+', '-', '0'].includes(key.toLowerCase())) e.preventDefault();
    if (!DEV && key === 'F5') e.preventDefault();
  });
  wc.setVisualZoomLevelLimits(1, 1).catch(() => {});

  // stay on the game: no navigation away, no popups
  wc.on('will-navigate', (e, url) => {
    if (!url.startsWith(ORIGIN + '/')) e.preventDefault();
  });
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
  wc.on('will-attach-webview', (e) => e.preventDefault());

  if (LOG_CONSOLE) {
    wc.on('console-message', (e) => {
      const level = e.level ?? 'info';
      const msg = e.message;
      const line = `[page:${level}] ${msg}`;
      if (level === 'error') {
        smokeErrors.push(msg);
        console.error(line);
      } else console.log(line);
    });
  }
  wc.on('render-process-gone', (_e, details) => {
    console.error('[dustUP] renderer gone:', details.reason);
    if (SMOKE) app.exit(1);
  });

  win.loadURL(`${ORIGIN}/index.html`);
  if (SMOKE) runSmoke(wc);
}

async function runSmoke(wc) {
  const t0 = Date.now();
  const limit = +(process.env.DUSTUP_SMOKE_TIMEOUT || 300000);
  await new Promise((r) => wc.once('did-finish-load', r));
  let ready = false;
  while (Date.now() - t0 < limit) {
    ready = await wc.executeJavaScript('window.__ready === true').catch(() => false);
    if (ready) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  const scene = await wc
    .executeJavaScript('(window.__engine && window.__engine.current && window.__engine.current.constructor.name) || null')
    .catch(() => null);
  if (ready) await new Promise((r) => setTimeout(r, 4000));
  if (SMOKE_SHOT) {
    try {
      const img = await wc.capturePage();
      fs.writeFileSync(path.resolve(SMOKE_SHOT), img.toPNG());
    } catch (e) {
      console.error('[smoke] capture failed', e);
    }
  }
  const ok = ready && smokeErrors.length === 0;
  console.log(
    `[smoke] ${ok ? 'PASS' : 'FAIL'} ready=${ready} scene=${scene} errors=${smokeErrors.length} ` +
      `seconds=${((Date.now() - t0) / 1000).toFixed(1)} userData=${app.getPath('userData')}`,
  );
  app.exit(ok ? 0 : 1);
}

app.on('second-instance', () => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
});

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  protocol.handle(SCHEME, serve);
  // the game needs pointer lock and fullscreen; nothing else (camera, mic, notifications ...)
  const allowed = new Set(['pointerLock', 'fullscreen']);
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(allowed.has(permission)));
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => allowed.has(permission));
  createWindow();
});

app.on('window-all-closed', () => app.quit());
