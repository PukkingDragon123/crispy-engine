// Weathering: the texture artist's last pass over a finished voxel model (user note: enemies,
// props and the gods "a lot more textured", with wear and readable anatomy). It reads the
// model's own shape, never paints pictures, and keeps every tint inside the voxel's material
// family so the renderer's pixel-art detail layer (VoxelDetail) still picks the right grain:
//   - worn edges: convex rims and corners are rubbed lighter (leather scuffs, frayed cloth,
//     polished metal, sun-bleached bone), so silhouettes and plate edges read crisply;
//   - grime: creases, sutures, rib gaps, folds and seams collect dark dirt, which carves the
//     anatomy out of flat colour;
//   - dust: up-facing surfaces catch patchy sand dust; boots, hems and feet carry ground dirt;
//   - scuffs and stains: fine scratch lines on leather, wood and metal, broad stains on cloth.
// Eyes, ink, glints and glowing voxels are left exactly as authored. A model is weathered
// only once (registries may hand out the same cached model more than once).
import { VoxelModel, VF, mix, mulRGB } from '../../engine/voxel/VoxelModel';
import { noise } from '../../engine/math/rand';

export interface WearOpts {
  seed?: number;
  /** lighten convex edges (0..1) */
  edge?: number;
  /** darken creases and recesses (0..1) */
  cavity?: number;
  /** patchy sand dust on up-facing faces (0..1) */
  dust?: number;
  /** ground dirt climbing from the model's lowest voxel, in voxels (0 = off) */
  dirtTo?: number;
  /** ground dirt strength at the very bottom (0..1) */
  dirt?: number;
  /** ground level in model voxels (default: the lowest voxel) */
  dirtFrom?: number;
  /** scratch / scuff lines on leather, wood and metal (0..1) */
  scuffs?: number;
  /** broad stains on cloth and hide (0..1) */
  stains?: number;
  /** dust and dirt colour */
  sand?: number;
  /** grime colour */
  grime?: number;
  /** skip models bigger than this (load time) */
  maxCount?: number;
}

const done = new WeakSet<VoxelModel>();
const OFF = 512;
const K = (x: number, y: number, z: number) => ((x + OFF) << 20) | ((y + OFF) << 10) | (z + OFF);

const SKIP = -1, METAL = 0, BONE = 1, SOFT = 2, DARK = 3;
function family(c: number, f: number) {
  if (f & (VF.EMISSIVE | VF.GLOW)) return SKIP;
  const r = ((c >> 16) & 255) / 255, g = ((c >> 8) & 255) / 255, b = (c & 255) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  const s = mx > 1e-4 ? (mx - mn) / mx : 0;
  if (mx < 0.085) return SKIP; // pupils, sockets, ink, lettering
  if (s < 0.09 && mx > 0.86) return SKIP; // eye whites, glints, paper whites
  if (f & VF.METAL) return METAL;
  if (s < 0.42 && mx > 0.6) return BONE; // bone, linen, pale hide, sand-bleached wood
  if (mx < 0.3) return DARK; // black felt, dark leather, obsidian
  return SOFT;
}

const ss = (a: number, b: number, t: number) => {
  const k = Math.min(1, Math.max(0, (t - a) / (b - a)));
  return k * k * (3 - 2 * k);
};

/** weather a model in place (once); returns it */
export function weather(m: VoxelModel, o: WearOpts = {}) {
  if (done.has(m)) return m;
  done.add(m);
  const n = m.count;
  if (!n || n > (o.maxCount ?? 160000)) return m;
  const seed = o.seed ?? 0;
  const edgeA = o.edge ?? 0.14, cavA = o.cavity ?? 0.2, dustA = o.dust ?? 0.14, scufA = o.scuffs ?? 0.5, stainA = o.stains ?? 0.5;
  const sand = o.sand ?? 0xd8b47c, grime = o.grime ?? 0x3a2616;
  const map = m.map;
  let y0 = Infinity;
  if (o.dirtTo && o.dirtFrom === undefined) m.forEach((_x, y) => { if (y < y0) y0 = y; });
  if (o.dirtFrom !== undefined) y0 = o.dirtFrom;
  const dirtTo = o.dirtTo ?? 0, dirtA = o.dirt ?? 0.32;
  const out: [number, number, number, number, number][] = [];
  m.forEach((x, y, z, c, f) => {
    const fam = family(c, f);
    if (fam === SKIP) return;
    const up = !map.has(K(x, y + 1, z));
    if (!up && map.has(K(x, y - 1, z)) && map.has(K(x + 1, y, z)) && map.has(K(x - 1, y, z)) && map.has(K(x, y, z + 1)) && map.has(K(x, y, z - 1))) return; // interior
    // air in the 3x3x3 neighbourhood: flat face ~9, edge ~15, corner ~19, crease 3..6
    let air = 0;
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++) if ((dx || dy || dz) && !map.has(K(x + dx, y + dy, z + dz))) air++;
    const e = ss(11, 17, air), q = ss(7, 3, air);
    let col = c;
    // broad low-frequency breakup so nothing reads as a uniform filter
    const lo = noise.n3(x * 0.11 + seed * 1.37, y * 0.13 - seed * 0.71, z * 0.11 + seed * 2.11);
    const hi = noise.n3(x * 0.37 - seed, y * 0.41 + seed * 0.5, z * 0.37);
    if (fam === METAL) {
      if (e > 0) col = mix(col, 0xfff6e0, e * edgeA * 1.6);
      if (q > 0) col = mulRGB(col, 1 - q * cavA * 1.1);
      if (scufA > 0 && Math.abs(noise.n3(x * 0.21 + seed, y * 0.6 - x * 0.2, z * 0.21)) < 0.018 * scufA) col = mix(col, 0xffffff, 0.22);
      if (up && lo > 0.25) col = mix(col, sand, dustA * 0.5);
    } else {
      // worn, rubbed edges
      if (e > 0) col = fam === BONE ? mix(col, 0xfff3da, e * edgeA * 1.3) : fam === DARK ? mix(col, mulRGB(col, 1.9), e * edgeA * 1.6) : mix(col, mix(mulRGB(col, 1.22), sand, 0.22), e * edgeA * 1.4);
      // grime in the creases: bone gets warm brown dirt, the rest darkens
      if (q > 0) col = fam === BONE ? mix(col, mix(col, grime, 0.55), q * cavA * 1.6) : mulRGB(col, 1 - q * cavA * (fam === DARK ? 0.6 : 1.1));
      // scuffs: fine diagonal scratch lines (leather, wood, hide)
      if (scufA > 0 && fam !== BONE && Math.abs(noise.n3(x * 0.19 + y * 0.12 + seed, y * 0.33, z * 0.19 - y * 0.1)) < 0.016 * scufA) col = mix(col, mix(mulRGB(col, 1.3), sand, 0.3), 0.55);
      // hairline cracks and pores on bone
      if (fam === BONE && hi > 0.6 && Math.abs(lo) < 0.05) col = mix(col, grime, 0.32);
      // stains on cloth and hide: a few big soft blotches, stepped in two tones
      if (stainA > 0 && fam === SOFT) {
        const st = noise.n3(x * 0.07 - seed * 0.3, y * 0.09 + seed, z * 0.07);
        if (st > 0.48) col = mix(col, mix(col, 0x4a3420, 0.5), (st > 0.58 ? 0.34 : 0.18) * stainA);
      }
      // sun-bleach on top surfaces
      if (up && fam !== DARK) col = mix(col, mix(col, 0xfff0d0, 0.5), 0.08);
      // patchy settled dust
      if (up && dustA > 0) {
        const d = ss(-0.15, 0.45, lo) * dustA;
        if (d > 0.02) col = mix(col, sand, d);
      }
    }
    // ground dirt on boots, feet, hems and plinths
    if (dirtTo > 0 && y - y0 < dirtTo) {
      const t = 1 - (y - y0) / dirtTo;
      const k = dirtA * t * t * (0.65 + 0.35 * (hi * 0.5 + 0.5));
      if (k > 0.03) col = mix(col, mix(sand, 0x8a6440, 0.35), k);
    }
    if (col !== c) out.push([x, y, z, col, f]);
  });
  for (const [x, y, z, c, f] of out) m.set(x, y, z, c, f);
  return m;
}

/** the enemy profile: dusty desert dead, clear grime in every crease */
export const WEAR_ENEMY: WearOpts = { edge: 0.15, cavity: 0.24, dust: 0.16, scuffs: 0.6, stains: 0.55 };
/** props: subtler (they already carry material textures) */
export const WEAR_PROP: WearOpts = { edge: 0.12, cavity: 0.18, dust: 0.12, scuffs: 0.45, stains: 0.35, dirtTo: 5, dirt: 0.22 };

/** weather every part of a rig spec, or a static model entry, once (registries, world props) */
export function weatherEntry<T>(r: T, o: WearOpts = WEAR_PROP): T {
  const a = r as any;
  if (!a) return r;
  if (a.model instanceof VoxelModel) weather(a.model, o);
  else if (Array.isArray(a.parts)) for (const p of a.parts) if (p?.model instanceof VoxelModel) weather(p.model, { ...o, dirtTo: 0 });
  return r;
}
