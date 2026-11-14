// The Nile wave table: who rides each wave of the Nile stage, and where they come
// from (soldiers on the banks, skiffs and barges on the river, cannons dug into the
// shore). The director (WaveDirector) asks here instead of the desert roster when
// the world is the Nile.
//
// Cleopatra's army (the NILE ARMY worker's EnemyDefs, stage 'nile') is keyed by id.
// Until an id exists in ENEMIES, its desert stand-in rides in its place, so the
// stage always plays.
import { ENEMIES, type EnemyDef } from '../enemies/EnemyDefs';
import { rnd } from '../../engine/math/rand';

export type NileWhere = 'land' | 'water' | 'bank';

export interface NileSpawn {
  id: string;
  /** first wave (of the stage's 1..100) */
  from: number;
  weight: number;
  where: NileWhere;
  /** per sub-area weight multipliers (delta / temple city / burning river) */
  area?: Partial<Record<'A' | 'B' | 'C', number>>;
  /** stand-in while the id does not exist yet */
  stand?: string;
}

/** Cleopatra's army (ids expected from the NILE ARMY worker) */
export const NILE_TABLE: NileSpawn[] = [
  { id: 'nileWolf', from: 1, weight: 5, where: 'land', stand: 'sandWolf', area: { A: 1.2 } },
  { id: 'nileJackalSpear', from: 1, weight: 4.5, where: 'land', stand: 'jackal' },
  { id: 'nileFalcon', from: 2, weight: 3, where: 'land', stand: 'jackalArcher', area: { B: 1.4 } },
  { id: 'nileBaboon', from: 3, weight: 2, where: 'bank', stand: 'bomberHusk' },
  { id: 'reedBoat', from: 3, weight: 1.6, where: 'water', area: { A: 1.4, C: 0.6 } },
  { id: 'nileHippo', from: 4, weight: 1.6, where: 'land', stand: 'mummy', area: { B: 1.3 } },
  { id: 'nileRam', from: 5, weight: 1.2, where: 'land', stand: 'cursePriest', area: { B: 1.3, C: 1.2 } },
  { id: 'bankCannon', from: 6, weight: 0.9, where: 'bank', area: { B: 1.5 } },
  { id: 'warBarge', from: 8, weight: 0.7, where: 'water', area: { B: 1.4, C: 1.2 } },
];

/** the river's restless dead and wildlife fill out the early hordes (and stand in for the army) */
const LOCALS: NileSpawn[] = [
  { id: 'husk', from: 1, weight: 3, where: 'land' },
  { id: 'scarab', from: 1, weight: 2.5, where: 'land' },
  { id: 'mummy', from: 3, weight: 1.5, where: 'land', area: { B: 1.5 } },
  { id: 'bellSnake', from: 6, weight: 1, where: 'land', area: { A: 1.5 } },
  { id: 'bandageWhipper', from: 12, weight: 0.8, where: 'land', area: { B: 1.4 } },
  { id: 'cursePriest', from: 20, weight: 0.6, where: 'land' },
  { id: 'bombScarab', from: 9, weight: 1, where: 'land' },
];

/** the Nile's spike waves */
export const NILE_THEMES = [
  { name: 'WOLF LEGION', types: ['nileWolf', 'nileJackalSpear', 'sandWolf', 'jackal'], mult: 1.2, from: 4 },
  { name: 'THE REED FLEET', types: ['reedBoat', 'warBarge', 'nileFalcon', 'jackalArcher'], mult: 1.0, from: 8 },
  { name: 'SHORE BATTERIES', types: ['bankCannon', 'nileBaboon', 'bomberHusk'], mult: 1.0, from: 13 },
  { name: 'FALCON SKIES', types: ['nileFalcon', 'jackalArcher'], mult: 1.1, from: 9 },
  { name: "THE QUEEN'S WALL", types: ['nileHippo', 'nileRam', 'mummy', 'cursePriest'], mult: 0.9, from: 18 },
  { name: 'TOMB TIDE', types: ['mummy', 'husk', 'bandageWhipper'], mult: 1.2, from: 10 },
];

export interface NileRosterEntry {
  def: EnemyDef;
  where: NileWhere;
  weight: number;
}

/** the roster for a Nile wave: the army where it exists, stand-ins where it does not */
export function nileRoster(wave: number, area: 'A' | 'B' | 'C'): NileRosterEntry[] {
  const out: NileRosterEntry[] = [];
  const seen = new Set<string>();
  for (const e of [...NILE_TABLE, ...LOCALS]) {
    if (e.from > wave) continue;
    const id = ENEMIES[e.id] ? e.id : e.stand && ENEMIES[e.stand] ? e.stand : null;
    if (!id) continue;
    const def = ENEMIES[id];
    // a stand-in keeps the army slot's place (land soldiers), never water ones
    const where: NileWhere = id === e.id ? e.where : 'land';
    const w = e.weight * (e.area?.[area] ?? 1);
    const key = id + ':' + where;
    if (seen.has(key)) {
      const prev = out.find((o) => o.def.id === id && o.where === where);
      if (prev) prev.weight += w * 0.5;
      continue;
    }
    seen.add(key);
    // the locals fade out as the army gathers
    const fade = LOCALS.includes(e) ? Math.max(0.25, 1 - wave * 0.012) : 1;
    out.push({ def, where, weight: w * fade });
  }
  return out;
}

/** the ids this table expects that do not exist yet (for the report / a dev check) */
export function missingNileIds() {
  return NILE_TABLE.filter((e) => !ENEMIES[e.id]).map((e) => e.id);
}

interface WorldLike {
  water: { isWater(x: number, z: number, minDepth?: number): boolean } | null;
  nile: { river: { bankDist(x: number, z: number): number } } | null;
  storm: { sdf(x: number, z: number): number; randomPointNear(x: number, z: number, minR: number, maxR: number, margin?: number): { x: number; z: number } | null };
}

/** a spawn point of the right kind (dry land, the river, the shore) around the hunter */
export function nileSpawnPoint(world: WorldLike, px: number, pz: number, where: NileWhere, minR: number, maxR: number, bearing?: number) {
  const water = world.water, river = world.nile?.river;
  const ok = (x: number, z: number) => {
    if (world.storm.sdf(x, z) < 5) return false;
    if (!water || !river) return true;
    if (where === 'water') return water.isWater(x, z, 1.1);
    if (where === 'bank') {
      const e = river.bankDist(x, z);
      return e > 2 && e < 14 && !water.isWater(x, z, 0.02);
    }
    return !water.isWater(x, z, 0.02);
  };
  for (let k = 0; k < 28; k++) {
    const a = bearing !== undefined && k < 12 ? bearing + (rnd.next() - 0.5) * 1.2 : rnd.next() * Math.PI * 2;
    const r = minR + rnd.next() * (maxR - minR);
    const x = px + Math.cos(a) * r, z = pz + Math.sin(a) * r;
    if (ok(x, z)) return { x, z };
  }
  // the river can be further off than a horde's ring: look wider for water
  if (where === 'water')
    for (let k = 0; k < 24; k++) {
      const a = rnd.next() * Math.PI * 2, r = maxR + rnd.next() * 40;
      const x = px + Math.cos(a) * r, z = pz + Math.sin(a) * r;
      if (ok(x, z)) return { x, z };
    }
  return where === 'water' ? null : world.storm.randomPointNear(px, pz, minR, maxR, 5);
}
