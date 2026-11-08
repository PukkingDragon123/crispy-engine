// Flesh kit for the half-dead Sundown: palettes and small sculpt helpers shared by
// his head, body and hair (sundown.ts). The living half is sun-dark, weathered
// skin; the dead half is necrotic grey-green skin torn back to raw meat and bone,
// with crude black stitches where someone tried to hold him together.
import { VoxelModel } from '../../../engine/voxel/VoxelModel';
import type { V3 } from '../../../engine/voxel/Rig';
import type { Ramp } from '../style';
import { Sc, spline, vlen, vsub, lerp } from './sculpt';

const ramp = (base: number, shade: number, hi: number, dark: number): Ramp => ({ base, shade, hi, dark });

// ================================================================== PALETTE
/** the living half: sun-dark, weathered skin */
export const SKIN = ramp(0xbf8763, 0x9c6748, 0xd6a27e, 0x6a3f2c);
export const STUB = 0x8d6450; // five-o'clock shadow
export const STUB_DOT = 0x553c30;
export const SCAR = 0xd8ab95;
export const LIP = 0x96574a;
export const NAIL = 0xd9b3a0;
export const BROWHAIR = 0x261c18;
/** the living eye: steel-blue iris, a little bloodshot */
export const HEYE = { white: 0xe4d9c8, whiteSh: 0xb0a090, corner: 0xc0857a, iris: 0x5d87a3, irisLo: 0x84abc4, irisSh: 0x2c4556, pupil: 0x0a0b0e, glint: 0xffffff, cloud: 0x9aa3a6, lash: 0x22160f };
/** the dead half */
export const ROT = ramp(0x87906c, 0x6a7154, 0xa0a882, 0x474b37);
export const BRUISE = 0x75606a;
export const MEAT = ramp(0x80302a, 0x5c1f1b, 0xa54839, 0x36110f);
export const SINEW = ramp(0xa95c48, 0x854131, 0xc77e66, 0x55271e);
export const CAVITY = 0x260e0c;
export const STAIN = 0xc8a571;
export const THREAD_BLK = 0x1f1813;
/** scraggly black hair, sun-bleached at the ends, a few dead grey strands on the rotted side */
export const HAIR = ramp(0x2b2220, 0x1b1514, 0x463830, 0x0f0b0a);
export const HAIR_ALT = 0x342925;
export const HAIR_TIP = 0x5b493d;
export const HAIR_GREY = 0x8a847e;

// ================================================================== HELPERS
/** deterministic PRNG (strand layout stays identical on every build) */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** per-voxel hash in 0..1 (stubble, mottling) */
export const vhash = (i: number, j: number, l: number) => (((Math.imul(i, 73856093) ^ Math.imul(j, 19349663) ^ Math.imul(l, 83492791)) >>> 0) % 1000) / 1000;

/** delete from `a` every cell that `b` also fills: two meshes sharing a cell would z-fight */
export function dedupe(a: VoxelModel, b: VoxelModel | null | undefined) {
  if (!b) return a;
  const del: V3[] = [];
  a.forEach((x, y, z) => {
    if (b.has(x, y, z)) del.push([x, y, z]);
  });
  for (const [x, y, z] of del) a.del(x, y, z);
  return a;
}

/** a one-voxel skin over every voxel of `src` (18-neighbourhood dilation, src cells included) */
export function skinOver(src: VoxelModel, dst: VoxelModel, col: number) {
  const add: V3[] = [];
  src.forEach((x, y, z) => {
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++) if (Math.abs(dx) + Math.abs(dy) + Math.abs(dz) <= 2) add.push([x + dx, y + dy, z + dz]);
  });
  for (const [x, y, z] of add) if (!dst.has(x, y, z)) dst.set(x, y, z, col);
  return dst;
}

/**
 * Colour of living skin at distance d (design units) from a rot edge: raw meat on the torn
 * lip, necrotic grey-green, a mottled bruise ring, then the healthy colour.
 */
export function rotEdgeCol(d: number, x: number, y: number, z: number, healthy: number): number {
  const w = 0.24 * Math.sin(x * 1.7 + y * 2.3) + 0.18 * Math.sin(z * 2.9 - y * 1.1);
  if (d < 0.3) return MEAT.base;
  if (d < 0.72 + w * 0.5) return ROT.dark;
  if (d < 1.2 + w) return ROT.base;
  if (d < 1.75 + w) return Math.sin(x * 3.1 + z * 2.3 + y * 1.7) > 0.25 ? BRUISE : ROT.hi;
  return healthy;
}
const BONEISH = new Set<number>();
export function markBone(...c: number[]) {
  for (const v of c) BONEISH.add(v & 0xffffff);
}
/** bone just inside a rot edge: tissue still clinging, then a dirty stain */
export function boneEdgeCol(c: number, d: number): number {
  if (!BONEISH.has(c & 0xffffff)) return c;
  if (d > -0.42) return MEAT.dark;
  if (d > -0.95) return STAIN;
  return c;
}

/** a crude black stitch from a to b with a knot bead at each end */
export function stitch(m: Sc, a: V3, b: V3, r = 0.22) {
  m.cap(a, b, r, r, THREAD_BLK);
}

/** a tapered strand (hair, sinew, tatter) through pts; the last `tipK` of its length takes `tip` */
export function strand(m: Sc, pts: V3[], r0: number, r1: number, col: number, tip: number | null = null, tipK = 0.25, smooth = 5) {
  const sm = spline(pts, smooth);
  const L: number[] = [0];
  for (let i = 1; i < sm.length; i++) L.push(L[i - 1] + vlen(vsub(sm[i], sm[i - 1])));
  const tot = L[L.length - 1] || 1;
  for (let i = 1; i < sm.length; i++) {
    const t0 = L[i - 1] / tot, t1 = L[i] / tot;
    const c = tip !== null && t1 > 1 - tipK ? tip : col;
    m.cap(sm[i - 1], sm[i], lerp(r0, r1, t0), lerp(r0, r1, t1), c);
  }
}

/** split a model at design height yCut (k voxels per unit): returns [cells at/above, cells below] */
export function splitY(src: VoxelModel, k: number, yCut: number, upper: string, lower: string): [VoxelModel, VoxelModel] {
  const a = new VoxelModel(upper), b = new VoxelModel(lower);
  src.forEach((x, y, z, c, f) => ((y + 0.5) / k >= yCut ? a : b).set(x, y, z, c, f));
  return [a, b];
}
