// Optional Steamworks integration for the desktop shell (main process side).
//
// Steam is only touched when an app id is found, so the plain build runs with no Steam at all:
//   1. --steam-appid=N on the command line (--no-steam turns everything off)
//   2. DUSTUP_STEAM_APPID in the environment
//   3. SteamAppId in the environment (the Steam client sets it when it launches the game)
//   4. steam_appid.txt next to the executable, or in the working directory
// 480 is Valve's public test app (Spacewar): use it only for local testing.
//
// setupSteam() must run before app 'ready': the overlay needs Chromium switches (in-process GPU,
// no DirectComposition) that only apply when set before the GPU process starts.
'use strict';

const path = require('node:path');
const fs = require('node:fs');

const ACH_ID = /^[A-Za-z0-9_.-]{1,128}$/;
const RP_KEY = /^[A-Za-z0-9_.#-]{1,64}$/;

function readAppIdFile(file) {
  try {
    const n = parseInt(fs.readFileSync(file, 'utf8').trim(), 10);
    return Number.isFinite(n) && n > 0 ? { id: n, source: file } : null;
  } catch {
    return null;
  }
}

function resolveAppId(argv) {
  if (argv.includes('--no-steam') || process.env.DUSTUP_NO_STEAM === '1') return null;
  const hit = argv.find((a) => a.startsWith('--steam-appid='));
  const tries = [
    hit && { v: hit.slice('--steam-appid='.length), source: '--steam-appid' },
    process.env.DUSTUP_STEAM_APPID && { v: process.env.DUSTUP_STEAM_APPID, source: 'DUSTUP_STEAM_APPID' },
    process.env.SteamAppId && { v: process.env.SteamAppId, source: 'SteamAppId' },
  ];
  for (const t of tries) {
    if (!t) continue;
    const n = parseInt(t.v, 10);
    if (Number.isFinite(n) && n > 0) return { id: n, source: t.source };
  }
  const dirs = [path.dirname(process.execPath), process.cwd()];
  for (const d of dirs) {
    const r = readAppIdFile(path.join(d, 'steam_appid.txt'));
    if (r) return r;
  }
  return null;
}

/**
 * Initialises Steam when an app id is present and registers the IPC handlers behind window.steam.
 * Never throws: on any failure the bridge simply reports Steam as unavailable.
 */
function setupSteam({ app, ipcMain, argv, origin, log }) {
  const state = { client: null, appId: null, source: null, reason: 'no app id', overlay: false };
  const found = resolveAppId(argv);
  if (found) {
    state.appId = found.id;
    state.source = found.source;
    try {
      const steamworks = require('steamworks.js');
      state.client = steamworks.init(found.id);
      state.reason = '';
      if (!argv.includes('--no-steam-overlay')) {
        steamworks.electronEnableSteamOverlay();
        state.overlay = true;
      }
      let who = '';
      try {
        who = state.client.localplayer.getName();
      } catch {}
      log(`[steam] ready: app ${found.id} (from ${found.source}), player ${who || 'unknown'}, overlay ${state.overlay ? 'on' : 'off'}`);
    } catch (e) {
      state.client = null;
      state.reason = (e && e.message) || String(e);
      log(`[steam] unavailable (app ${found.id} from ${found.source}): ${state.reason}`);
    }
  }

  // only the game's own pages may talk to Steam
  const trusted = (event) => {
    const url = (event.senderFrame && event.senderFrame.url) || '';
    return url.startsWith(origin + '/');
  };
  const call = (fn, fallback) => {
    if (!state.client) return fallback;
    try {
      return fn(state.client);
    } catch (e) {
      log(`[steam] call failed: ${(e && e.message) || e}`);
      return fallback;
    }
  };

  ipcMain.on('steam:available', (event) => {
    event.returnValue = trusted(event) && !!state.client;
  });
  ipcMain.handle('steam:unlock', (event, id) => {
    if (!trusted(event) || typeof id !== 'string' || !ACH_ID.test(id)) return false;
    return call((c) => !!c.achievement.activate(id), false);
  });
  ipcMain.handle('steam:isUnlocked', (event, id) => {
    if (!trusted(event) || typeof id !== 'string' || !ACH_ID.test(id)) return false;
    return call((c) => !!c.achievement.isActivated(id), false);
  });
  ipcMain.handle('steam:playerName', (event) => {
    if (!trusted(event)) return null;
    return call((c) => c.localplayer.getName() || null, null);
  });
  ipcMain.handle('steam:richPresence', (event, key, value) => {
    if (!trusted(event) || typeof key !== 'string' || !RP_KEY.test(key)) return false;
    if (value != null && (typeof value !== 'string' || value.length > 256)) return false;
    return call((c) => (c.localplayer.setRichPresence(key, value == null ? null : value), true), false);
  });

  return state;
}

module.exports = { setupSteam, resolveAppId };
