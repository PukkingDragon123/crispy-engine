#!/usr/bin/env node
// Builds the game with vite and packages it as a desktop app with Electron.
//
//   node desktop/build.cjs [--platforms=win32,linux] [--out=DIR] [--smoke] [--skip-vite]
//                          [--steam [--steam-appid=N] [--depot-windows=N] [--depot-linux=N] [--zip]]
//
// npm scripts: desktop:win (Windows x64), desktop:linux (Linux x64), desktop:all (both + smoke),
// desktop:steam (both, as unzipped SteamPipe depot folders).
// Output: <out>/dustUP-win-x64.zip and/or <out>/dustUP-linux-x64.zip. <out> defaults to
// ./release/desktop (gitignored); everything intermediate goes to <out>/.work, never into dist/.
// --steam writes <out>/steam/{content/windows,content/linux,scripts,output} instead (see
// desktop/steam/steam_upload.md); zips are skipped there unless --zip is given.
//
// Electron zips are fetched from GitHub releases (or $ELECTRON_MIRROR, e.g.
// https://npmmirror.com/mirrors/electron/) with curl, checked against SHASUMS256.txt and cached in
// <out>/.electron-cache, then handed to @electron/packager through electronZipDir. The exe icon and
// version info are written with resedit (pure JS), so no wine is needed when building on Linux.
//
// --smoke runs the packaged Linux build under xvfb-run until the menu reports ready.
'use strict';

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const opt = (name, def) => {
  const hit = args.find((a) => a.startsWith('--' + name + '='));
  return hit ? hit.slice(name.length + 3) : def;
};
const flag = (name) => args.includes('--' + name);

const OUT = path.resolve(opt('out', process.env.DUSTUP_DESKTOP_OUT || path.join(ROOT, 'release', 'desktop')));
const WORK = path.join(OUT, '.work');
const CACHE = path.join(OUT, '.electron-cache');
const PLATFORMS = opt('platforms', 'win32').split(',').map((s) => s.trim()).filter(Boolean);
const ARCH = 'x64';
const LABEL = { win32: 'win', linux: 'linux', darwin: 'mac' };
const STEAM = flag('steam');
const STEAM_DEPOT = { win32: 'windows', linux: 'linux' };
// the steamworks.js native binaries each platform keeps (the others are left out of its package)
const STEAM_NATIVE = { win32: 'win64', linux: 'linux64' };

const rootPkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const electronVersion = JSON.parse(fs.readFileSync(require.resolve('electron/package.json', { paths: [ROOT] }), 'utf8')).version;
const MIRROR = (process.env.ELECTRON_MIRROR || 'https://github.com/electron/electron/releases/download/').replace(/\/?$/, '/');
// GitHub tags carry a leading v, npmmirror folders do not
const releaseDir = MIRROR.includes('github.com') ? `v${electronVersion}` : electronVersion;

function run(cmd, cmdArgs, opts = {}) {
  console.log(`> ${cmd} ${cmdArgs.join(' ')}`);
  const r = spawnSync(cmd, cmdArgs, { stdio: 'inherit', shell: process.platform === 'win32', ...opts });
  if (r.status !== 0) throw new Error(`${cmd} failed with exit code ${r.status}`);
}

function has(cmd) {
  const r = spawnSync(process.platform === 'win32' ? 'where' : 'which', [cmd], { stdio: 'ignore' });
  return r.status === 0;
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function download(url, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = dest + '.part';
  if (has('curl')) run('curl', ['-fSL', '--retry', '3', '--connect-timeout', '30', '-o', tmp, url]);
  else throw new Error('curl is required to download Electron (' + url + ')');
  fs.renameSync(tmp, dest);
}

function ensureElectronZip(platform) {
  const name = `electron-v${electronVersion}-${platform}-${ARCH}.zip`;
  const zip = path.join(CACHE, name);
  const sums = path.join(CACHE, `SHASUMS256-${electronVersion}.txt`);
  if (!fs.existsSync(sums)) download(`${MIRROR}${releaseDir}/SHASUMS256.txt`, sums);
  const line = fs.readFileSync(sums, 'utf8').split('\n').find((l) => l.trim().endsWith('*' + name) || l.trim().endsWith(' ' + name));
  if (!line) throw new Error(`no checksum for ${name}`);
  const want = line.trim().split(/\s+/)[0];
  if (fs.existsSync(zip) && sha256(zip) === want) return;
  download(`${MIRROR}${releaseDir}/${name}`, zip);
  const got = sha256(zip);
  if (got !== want) {
    fs.rmSync(zip, { force: true });
    throw new Error(`checksum mismatch for ${name}: ${got} != ${want}`);
  }
}

function zipDir(parent, folder, zipFile) {
  fs.rmSync(zipFile, { force: true });
  if (has('zip')) run('zip', ['-q', '-r', '-y', '-9', zipFile, folder], { cwd: parent });
  else if (process.platform === 'win32')
    run('powershell', ['-NoProfile', '-Command', `Compress-Archive -Path '${path.join(parent, folder)}' -DestinationPath '${zipFile}'`]);
  else throw new Error('zip is required to archive the build');
}

function stageApp() {
  const stage = path.join(WORK, 'app');
  fs.rmSync(stage, { recursive: true, force: true });
  fs.mkdirSync(stage, { recursive: true });
  const game = path.join(stage, 'game');
  if (flag('skip-vite') && fs.existsSync(path.join(WORK, 'game-cache', 'index.html'))) {
    fs.cpSync(path.join(WORK, 'game-cache'), game, { recursive: true });
  } else {
    run('npx', ['vite', 'build', '--outDir', game, '--emptyOutDir'], { cwd: ROOT });
    fs.rmSync(path.join(WORK, 'game-cache'), { recursive: true, force: true });
    fs.cpSync(game, path.join(WORK, 'game-cache'), { recursive: true });
  }
  if (!fs.existsSync(path.join(game, 'index.html'))) throw new Error('vite build produced no index.html');
  for (const f of ['main.cjs', 'preload.cjs', 'steam.cjs', 'icon.png', 'icon.ico'])
    fs.copyFileSync(path.join(__dirname, f), path.join(stage, f));
  // steamworks.js (prebuilt N-API binaries, loaded only when a Steam app id is present)
  const swSrc = path.dirname(require.resolve('steamworks.js/package.json', { paths: [ROOT] }));
  const swDst = path.join(stage, 'node_modules', 'steamworks.js');
  fs.mkdirSync(path.join(swDst, 'dist'), { recursive: true });
  for (const f of ['index.js', 'package.json', 'LICENSE']) fs.copyFileSync(path.join(swSrc, f), path.join(swDst, f));
  for (const d of Object.values(STEAM_NATIVE))
    fs.cpSync(path.join(swSrc, 'dist', d), path.join(swDst, 'dist', d), {
      recursive: true,
      filter: (f) => !f.endsWith('.lib'),
    });
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
  pkg.version = rootPkg.version;
  delete pkg.scripts;
  delete pkg.devDependencies;
  fs.writeFileSync(path.join(stage, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
  return stage;
}

const LINUX_LAUNCHER = `#!/bin/sh
# Starts dustUP. Falls back to --no-sandbox when the Chromium sandbox cannot start: running as
# root, or no setuid chrome-sandbox while unprivileged user namespaces are unavailable or
# restricted (Ubuntu 24.04+, some container runtimes).
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"
EXTRA=""
if [ "$(id -u)" = "0" ]; then
  EXTRA="--no-sandbox"
elif [ ! -u "$DIR/chrome-sandbox" ]; then
  if [ "$(cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns 2>/dev/null)" = "1" ] ||
     ! unshare --user true >/dev/null 2>&1; then
    EXTRA="--no-sandbox"
  fi
fi
exec "$DIR/dustUP" $EXTRA "$@"
`;

function fillSteamTokens(text) {
  const map = {
    '@APP_ID@': opt('steam-appid', ''),
    '@DEPOT_WINDOWS@': opt('depot-windows', ''),
    '@DEPOT_LINUX@': opt('depot-linux', ''),
    '@VERSION@': rootPkg.version,
  };
  for (const [k, v] of Object.entries(map)) if (v) text = text.split(k).join(v);
  return text;
}

function writeSteamKit(results) {
  const root = path.join(OUT, 'steam');
  const scripts = path.join(root, 'scripts');
  fs.mkdirSync(scripts, { recursive: true });
  fs.mkdirSync(path.join(root, 'output'), { recursive: true });
  const built = new Set(results.map((r) => STEAM_DEPOT[r.platform]));
  let app = fs.readFileSync(path.join(__dirname, 'steam', 'app_build.vdf'), 'utf8');
  // a depot that was not built this time is dropped from the app build
  if (!built.has('windows')) app = app.replace(/^.*depot_build_windows\.vdf.*\n/m, '');
  if (!built.has('linux')) app = app.replace(/^.*depot_build_linux\.vdf.*\n/m, '');
  fs.writeFileSync(path.join(scripts, 'app_build.vdf'), fillSteamTokens(app));
  for (const d of ['windows', 'linux'])
    if (built.has(d)) {
      const f = `depot_build_${d}.vdf`;
      fs.writeFileSync(path.join(scripts, f), fillSteamTokens(fs.readFileSync(path.join(__dirname, 'steam', f), 'utf8')));
    }
  fs.copyFileSync(path.join(__dirname, 'steam', 'steam_upload.md'), path.join(root, 'steam_upload.md'));
  const left = fs.readdirSync(scripts).filter((f) => /@[A-Z_]+@/.test(fs.readFileSync(path.join(scripts, f), 'utf8')));
  if (left.length) console.log(`note: ${left.join(', ')} still hold @...@ placeholders (pass --steam-appid / --depot-windows / --depot-linux)`);
  console.log(`steam kit: ${root}`);
}

async function main() {
  console.log(`dustUP desktop build: electron ${electronVersion}, platforms ${PLATFORMS.join(', ')}, out ${OUT}`);
  fs.mkdirSync(WORK, { recursive: true });
  for (const p of PLATFORMS) ensureElectronZip(p);
  const stage = stageApp();
  const { packager } = await import('@electron/packager');
  const results = [];
  for (const platform of PLATFORMS) {
    const packOut = path.join(WORK, 'pack');
    const paths = await packager({
      dir: stage,
      out: packOut,
      overwrite: true,
      platform,
      arch: ARCH,
      electronVersion,
      electronZipDir: CACHE,
      name: 'dustUP',
      executableName: 'dustUP',
      appVersion: rootPkg.version,
      buildVersion: rootPkg.version,
      appCopyright: 'dustUP',
      icon: path.join(__dirname, platform === 'win32' ? 'icon.ico' : 'icon.png'),
      // native Steam binaries must sit on disk, not inside app.asar
      asar: { unpack: '*.{node,dll,so,dylib}' },
      ignore: Object.entries(STEAM_NATIVE)
        .filter(([p]) => p !== platform)
        .map(([, d]) => new RegExp(`^/node_modules/steamworks\\.js/dist/${d}(/|$)`)),
      prune: false,
      derefSymlinks: true,
      win32metadata: {
        CompanyName: 'dustUP',
        FileDescription: 'dustUP',
        ProductName: 'dustUP',
        InternalName: 'dustUP',
        OriginalFilename: 'dustUP.exe',
      },
    });
    const built = paths[0];
    const folder = `dustUP-${LABEL[platform] || platform}-${ARCH}`;
    const final = path.join(path.dirname(built), folder);
    if (path.resolve(built) !== path.resolve(final)) {
      fs.rmSync(final, { recursive: true, force: true });
      fs.renameSync(built, final);
    }
    // the game is English only: keep Chromium's en-US strings, drop the other ~50 MB of locales
    const locales = path.join(final, 'locales');
    if (fs.existsSync(locales))
      for (const f of fs.readdirSync(locales)) if (!/^en-US\./.test(f)) fs.rmSync(path.join(locales, f), { force: true });
    if (platform === 'linux') {
      fs.writeFileSync(path.join(final, 'dustUP.sh'), LINUX_LAUNCHER, { mode: 0o755 });
      fs.copyFileSync(path.join(__dirname, 'icon.png'), path.join(final, 'dustUP.png'));
    }
    const readme = fs.readFileSync(path.join(__dirname, 'README-players.txt'), 'utf8');
    fs.writeFileSync(path.join(final, 'README.txt'), platform === 'win32' ? readme.replace(/\r?\n/g, '\r\n') : readme);
    // the extracted Electron files come out world-writable; tighten that before archiving
    if (process.platform !== 'win32') run('chmod', ['-R', 'go-w', final]);
    const res = { platform, dir: final, zip: null, mb: null };
    if (!STEAM || flag('zip')) {
      const zipFile = path.join(OUT, folder + '.zip');
      zipDir(path.dirname(final), folder, zipFile);
      res.zip = zipFile;
      res.mb = (fs.statSync(zipFile).size / 1048576).toFixed(1);
      console.log(`packaged ${platform}-${ARCH}: ${zipFile} (${res.mb} MB)`);
    }
    if (STEAM && STEAM_DEPOT[platform]) {
      const depot = path.join(OUT, 'steam', 'content', STEAM_DEPOT[platform]);
      fs.rmSync(depot, { recursive: true, force: true });
      fs.mkdirSync(path.dirname(depot), { recursive: true });
      fs.cpSync(final, depot, { recursive: true, verbatimSymlinks: true });
      // local testing only (the depot scripts exclude it): 480 is Valve's Spacewar test app
      const appid = opt('steam-appid', '480');
      if (appid !== 'none') fs.writeFileSync(path.join(depot, 'steam_appid.txt'), appid + '\n');
      res.depot = depot;
      console.log(`depot folder ${platform}-${ARCH}: ${depot}`);
    }
    results.push(res);
  }
  if (STEAM) writeSteamKit(results);

  if (flag('smoke')) {
    const linux = results.find((r) => r.platform === 'linux');
    if (!linux) throw new Error('--smoke needs the linux platform in --platforms');
    const shot = path.join(OUT, 'smoke-menu.png');
    const exe = path.join(linux.dir, 'dustUP');
    const smokeArgs = [
      '--no-sandbox',
      // software WebGL for a headless box; plain --use-angle=swiftshader loses the context under xvfb
      '--use-gl=angle',
      '--use-angle=swiftshader-webgl',
      '--enable-unsafe-swiftshader',
      // software rendering is slow enough to trip the GPU hang watchdog while the menu builds
      '--disable-gpu-watchdog',
      `--smoke-test=${shot}`,
    ];
    if (has('xvfb-run')) run('xvfb-run', ['-a', '-s', '-screen 0 1600x900x24', exe, ...smokeArgs]);
    else run(exe, smokeArgs);
    console.log(`smoke screenshot: ${shot}`);
  }
  console.log('\ndone:');
  for (const r of results) {
    if (r.zip) console.log(`  ${r.zip}  ${r.mb} MB`);
    if (r.depot) console.log(`  ${r.depot}/`);
  }
}

main().catch((e) => {
  console.error(e && e.stack ? e.stack : e);
  process.exit(1);
});
