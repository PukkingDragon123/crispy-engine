// Preload (isolated world): exposes a tiny window.steam bridge to the game. Every call is safe
// without Steam: isAvailable() is false and the rest resolve to false / null.
//
//   window.steam.isAvailable()            -> boolean
//   window.steam.unlock('ACH_ID')         -> Promise<boolean>   (sets and stores the achievement)
//   window.steam.isUnlocked('ACH_ID')     -> Promise<boolean>
//   window.steam.playerName()             -> Promise<string | null>
//   window.steam.setRichPresence(k, v)    -> Promise<boolean>   (v null clears the key)
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

let available = null;

contextBridge.exposeInMainWorld('steam', {
  isAvailable() {
    if (available === null) {
      try {
        available = ipcRenderer.sendSync('steam:available') === true;
      } catch {
        available = false;
      }
    }
    return available;
  },
  unlock: (id) => ipcRenderer.invoke('steam:unlock', String(id)),
  isUnlocked: (id) => ipcRenderer.invoke('steam:isUnlocked', String(id)),
  playerName: () => ipcRenderer.invoke('steam:playerName'),
  setRichPresence: (key, value) => ipcRenderer.invoke('steam:richPresence', String(key), value == null ? null : String(value)),
});
