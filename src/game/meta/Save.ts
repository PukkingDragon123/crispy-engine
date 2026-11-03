// Persistent progress (localStorage): the bank (a cut of every run's haul),
// cosmetics and gun parts you've bought, your chosen look/loadout, codex
// kill counts and records.
export interface GunLoadout {
  barrel: 'standard' | 'long' | 'snub' | 'serket';
  cylinder: 'standard' | 'venom' | 'gold' | 'bone';
  grip: 'wood' | 'bone' | 'ivory' | 'scarab';
  sight: 'none' | 'iron' | 'scope';
}

export interface SaveData {
  v: 1;
  bank: number;
  runs: number;
  bestWave: number;
  kills: number;
  unlocked: string[]; // 'hat:duck', 'outfit:poncho', 'board:cyber', 'gun:barrel:long' ...
  look: { hat: string; outfit: string; board: string };
  gun: GunLoadout;
  codex: Record<string, number>;
  seenIntro: boolean;
}

const KEY = 'dustup-save-v1';

export const PRICES: Record<string, number> = {
  'hat:stetson': 0, 'hat:bandit': 120, 'hat:sombrero': 180, 'hat:tophat': 220, 'hat:nemes': 320, 'hat:duck': 400, 'hat:wig': 99999,
  'outfit:punk': 0, 'outfit:duster': 0, 'outfit:vest': 140, 'outfit:poncho': 200, 'outfit:sheriff': 260, 'outfit:pharaoh': 380,
  'board:driftwood': 0, 'board:cactus': 160, 'board:bone': 220, 'board:scarab_gold': 360, 'board:cyber': 450, 'board:serket': 520,
  'gun:barrel:standard': 0, 'gun:barrel:long': 150, 'gun:barrel:snub': 110, 'gun:barrel:serket': 300,
  'gun:cylinder:standard': 0, 'gun:cylinder:venom': 180, 'gun:cylinder:gold': 240, 'gun:cylinder:bone': 140,
  'gun:grip:wood': 0, 'gun:grip:bone': 90, 'gun:grip:ivory': 160, 'gun:grip:scarab': 220,
  'gun:sight:none': 0, 'gun:sight:iron': 80, 'gun:sight:scope': 200,
};

export const HATS = ['stetson', 'bandit', 'sombrero', 'tophat', 'nemes', 'duck', 'wig'];
export const OUTFITS = ['punk', 'duster', 'vest', 'poncho', 'sheriff', 'pharaoh'];
export const BOARDS = ['driftwood', 'cactus', 'bone', 'scarab_gold', 'cyber', 'serket'];
export const GUN_PARTS: { [K in keyof GunLoadout]: GunLoadout[K][] } = {
  barrel: ['standard', 'long', 'snub', 'serket'],
  cylinder: ['standard', 'venom', 'gold', 'bone'],
  grip: ['wood', 'bone', 'ivory', 'scarab'],
  sight: ['none', 'iron', 'scope'],
};

/** what each gun part does in a run (small, flavorful bonuses) */
export const GUN_PERKS: Record<string, string> = {
  'barrel:standard': 'Reliable. Boring. Loyal.',
  'barrel:long': '+15% damage, +range, -8% fire rate',
  'barrel:snub': '+15% fire rate, -10% damage',
  'barrel:serket': '+10% damage, shots build poison faster',
  'cylinder:standard': 'Six honest chambers.',
  'cylinder:venom': 'First round of each cylinder is a venom round',
  'cylinder:gold': '+1 chamber, gold glints',
  'cylinder:bone': '+10% reload speed',
  'grip:wood': 'Warm walnut. Feels like home.',
  'grip:bone': '+5% crit chance',
  'grip:ivory': '+10% crit damage',
  'grip:scarab': '+8% gold from kills',
  'sight:none': 'Point and pray.',
  'sight:iron': '+aim assist',
  'sight:scope': 'Zoomed aim: +25% headshot damage',
};

function fresh(): SaveData {
  return {
    v: 1,
    bank: 0,
    runs: 0,
    bestWave: 0,
    kills: 0,
    unlocked: Object.keys(PRICES).filter((k) => PRICES[k] === 0),
    look: { hat: 'stetson', outfit: 'punk', board: 'driftwood' },
    gun: { barrel: 'standard', cylinder: 'standard', grip: 'wood', sight: 'none' },
    codex: {},
    seenIntro: false,
  };
}

let cache: SaveData | null = null;

export function loadSave(): SaveData {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const d = JSON.parse(raw) as SaveData;
      if (d && d.v === 1) {
        cache = { ...fresh(), ...d };
        // the punk biker jacket is Sundown's new signature look: hand it to old saves once
        if (!cache.unlocked.includes('outfit:punk')) {
          cache.unlocked.push('outfit:punk');
          if (cache.look.outfit === 'duster') cache.look.outfit = 'punk';
        }
        return cache;
      }
    }
  } catch {
    /* storage blocked: play without saving */
  }
  cache = fresh();
  return cache;
}

export function writeSave(d = loadSave()) {
  cache = d;
  try {
    localStorage.setItem(KEY, JSON.stringify(d));
  } catch {
    /* ignore */
  }
}

export function owns(key: string) {
  return loadSave().unlocked.includes(key);
}

export function buy(key: string): boolean {
  const d = loadSave();
  const p = PRICES[key] ?? 999999;
  if (d.unlocked.includes(key)) return true;
  if (d.bank < p) return false;
  d.bank -= p;
  d.unlocked.push(key);
  writeSave(d);
  return true;
}

/** bank a cut of the run and record stats; returns the amount banked */
export function awardRun(r: { wave: number; kills: number; totalGold: number; totalBounty: number }, codex: Record<string, number>) {
  const d = loadSave();
  const cut = Math.round(r.totalGold * 0.35 + r.totalBounty * 0.06 + r.wave * 4);
  d.bank += cut;
  d.runs++;
  d.kills += r.kills;
  d.bestWave = Math.max(d.bestWave, r.wave);
  for (const [k, v] of Object.entries(codex)) d.codex[k] = (d.codex[k] ?? 0) + v;
  writeSave(d);
  return cut;
}

/** stat modifiers granted by the equipped gun parts */
export function gunMods(g: GunLoadout): { stat: string; type: 'flat' | 'pct'; value: number; source: string }[] {
  const out: { stat: string; type: 'flat' | 'pct'; value: number; source: string }[] = [];
  const add = (stat: string, type: 'flat' | 'pct', value: number) => out.push({ stat, type, value, source: 'gun' });
  if (g.barrel === 'long') add('gunDmg', 'pct', 0.15), add('fireRate', 'pct', -0.08);
  if (g.barrel === 'snub') add('fireRate', 'pct', 0.15), add('gunDmg', 'pct', -0.1);
  if (g.barrel === 'serket') add('gunDmg', 'pct', 0.1), add('poisonStacks', 'flat', 1);
  if (g.cylinder === 'venom') add('poisonStacks', 'flat', 1);
  if (g.cylinder === 'gold') add('ammo', 'flat', 1);
  if (g.cylinder === 'bone') add('reloadSpeed', 'pct', 0.1);
  if (g.grip === 'bone') add('critChance', 'flat', 0.05);
  if (g.grip === 'ivory') add('critDmg', 'flat', 0.1);
  if (g.grip === 'scarab') add('goldGain', 'pct', 0.08);
  if (g.sight === 'iron') add('spread', 'pct', -0.15);
  if (g.sight === 'scope') add('critDmg', 'flat', 0.1);
  return out;
}
