// The player's settings: kept in localStorage and applied to the engine on boot (main.ts) and
// whenever one changes. The pause newspaper (ui/PauseGazette) is the only place they are edited:
// its sliders column and its checkbox classifieds, in a run and from the menu's SETTINGS sign.
import type { Engine } from '../../engine/Engine';

export interface GameSettings {
  master: number;
  music: number;
  sfx: number;
  voice: number;
  /** mouse / aim speed multiplier (0.2 .. 3) */
  sens: number;
  invertY: boolean;
  autoPush: boolean;
  /** false: the fast preset (no shadows, low pixel ratio, no bloom) */
  high: boolean;
}

const KEY = 'dustup-settings';
export const DEFAULTS: GameSettings = { master: 0.9, music: 0.55, sfx: 1, voice: 1, sens: 1, invertY: false, autoPush: false, high: true };

let cur: GameSettings | null = null;

export function getSettings(): GameSettings {
  if (cur) return cur;
  let saved: Partial<GameSettings> = {};
  try {
    saved = JSON.parse(localStorage.getItem(KEY) ?? '{}') ?? {};
  } catch {
    /* storage blocked or bad json */
  }
  cur = { ...DEFAULTS, ...saved };
  return cur;
}

function store() {
  try {
    localStorage.setItem(KEY, JSON.stringify(cur));
  } catch {
    /* storage blocked */
  }
}

const HIGH = () => ({ shadows: true, pixelRatio: Math.min(window.devicePixelRatio, 1.5), bloom: true, shadowSize: 4096 });
const LOW = { shadows: false, pixelRatio: 0.6, bloom: false, shadowSize: 512 };

/** push one setting (or all of them) into the engine */
export function applySettings(eng: Engine, only?: keyof GameSettings) {
  const s = getSettings();
  const a = eng.audio as unknown as { setVolume?(bus: string, v: number): void };
  const all = !only;
  try {
    if (all || only === 'master') a.setVolume?.('master', s.master);
    if (all || only === 'music') a.setVolume?.('music', s.music);
    if (all || only === 'sfx') {
      a.setVolume?.('sfx', s.sfx);
      a.setVolume?.('ui', s.sfx * 0.9);
      a.setVolume?.('amb', s.sfx * 0.8);
    }
    if (all || only === 'voice') a.setVolume?.('voice', s.voice);
  } catch {
    /* audio not up yet */
  }
  if (all || only === 'sens') eng.input.sensitivity = s.sens;
  if (all || only === 'invertY') eng.input.invertY = s.invertY;
  // (auto push keeps its own flag in the input layer; it is only pushed when changed here)
  if (only === 'autoPush') eng.input.setAutoPushDesktop(s.autoPush);
  // quality only when it was changed here (boot keeps the engine's own pick unless the player chose low)
  if (only === 'high' || (all && !s.high)) eng.applyQuality(s.high ? HIGH() : LOW);
}

export function setSetting<K extends keyof GameSettings>(eng: Engine, k: K, v: GameSettings[K]) {
  const s = getSettings();
  if (s[k] === v) return;
  s[k] = v;
  store();
  applySettings(eng, k);
}
