// HUD hero models — shown large in the 3D HUD layer (Hud3D), so they are built at
// very high voxel density in a realistic material language (exception to STYLE v2):
//  • hudCylinder(n)  the "floating magazine": a heavily rusted revolver cylinder —
//    pitted iron, layered orange/brown rust blooms, flaking scale, rubbed bare-steel
//    edges and bluing remnants, deep flutes, n chamber bores, stop notches with lead
//    grooves, ratchet star + centre pin, gas ring, a faint engraved scorpion.
//  • hudRound(kind, n)  tarnished brass cartridges that seat in those chambers:
//    dented primer / green-glass venom primer with veins / struck, sooty spent case.
//  • hudHeart()  an anatomical heart (ventricles, atria + auricles, fat-filled
//    grooves, coronary arteries & veins, aorta + arch branches, pulmonary trunk,
//    venae cavae, pulmonary veins) under six separate resin-stained linen wraps.
// Shapes are analytic (SDF / distance tests on dense grids); surface colour comes
// from exposure (edges rub bright, crevices rust and grime) plus layered noise.
import { VoxelModel, VF, mix, mulRGB } from '../../../engine/voxel/VoxelModel';
import { Noise, hash3 } from '../../../engine/math/rand';
import type { RigSpec, PartSpec } from '../../../engine/voxel/Rig';

export type V3 = [number, number, number];

const NZ = new Noise(0x5e7c1);
const TAU = Math.PI * 2;
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const len2 = (x: number, y: number) => Math.sqrt(x * x + y * y);
const len3 = (x: number, y: number, z: number) => Math.sqrt(x * x + y * y + z * z);
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const wrapPi = (a: number) => {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
};
/** 3-octave simplex fbm, roughly [-0.9, 0.9] */
function fbm3(x: number, y: number, z: number, oct = 3) {
  let s = 0, a = 0.5, f = 1;
  for (let i = 0; i < oct; i++) {
    s += a * NZ.n3(x * f, y * f, z * f);
    f *= 2.03;
    a *= 0.5;
  }
  return s * 1.6;
}
/** stable per-voxel hash in [0,1) with a salt */
const h3 = (x: number, y: number, z: number, salt = 0) => hash3(x * 3 + salt * 7919, y * 5 - salt * 104729, z * 7 + salt * 1299709);

/** dense occupancy grid over an integer box [x0,x1) × [y0,y1) × [z0,z1) */
class Grid {
  readonly sx: number;
  readonly sy: number;
  readonly sz: number;
  readonly a: Uint8Array;
  constructor(readonly x0: number, readonly y0: number, readonly z0: number, x1: number, y1: number, z1: number) {
    this.sx = x1 - x0;
    this.sy = y1 - y0;
    this.sz = z1 - z0;
    this.a = new Uint8Array(this.sx * this.sy * this.sz);
  }
  idx(x: number, y: number, z: number) {
    return x - this.x0 + this.sx * (y - this.y0 + this.sy * (z - this.z0));
  }
  has(x: number, y: number, z: number) {
    return x >= this.x0 && y >= this.y0 && z >= this.z0 && x < this.x0 + this.sx && y < this.y0 + this.sy && z < this.z0 + this.sz;
  }
  get(x: number, y: number, z: number) {
    return this.has(x, y, z) ? this.a[this.idx(x, y, z)] : 0;
  }
  set(x: number, y: number, z: number, v: number) {
    if (this.has(x, y, z)) this.a[this.idx(x, y, z)] = v;
  }
  /** surface test by raw index (caller guarantees a 1-cell margin) */
  surfaceI(i: number) {
    const a = this.a, sx = this.sx, sxy = this.sx * this.sy;
    return !a[i + 1] || !a[i - 1] || !a[i + sx] || !a[i - sx] || !a[i + sxy] || !a[i - sxy];
  }
  /** 26-neighbourhood empties by raw index (caller guarantees a 1-cell margin) */
  exposureI(i: number) {
    const a = this.a, sx = this.sx, sxy = this.sx * this.sy;
    let e = 0;
    for (let dz = -sxy; dz <= sxy; dz += sxy)
      for (let dy = -sx; dy <= sx; dy += sx)
        for (let dx = -1; dx <= 1; dx++) if ((dx || dy || dz) && !a[i + dx + dy + dz]) e++;
    return e;
  }
  /** solid with at least one empty face neighbour */
  surface(x: number, y: number, z: number) {
    return !this.get(x + 1, y, z) || !this.get(x - 1, y, z) || !this.get(x, y + 1, z) || !this.get(x, y - 1, z) || !this.get(x, y, z + 1) || !this.get(x, y, z - 1);
  }
  /** number of empty cells in the 26-neighbourhood: ~9 flat, >12 convex edge, <7 crevice */
  exposure(x: number, y: number, z: number) {
    let e = 0;
    for (let dz = -1; dz <= 1; dz++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) if ((dx || dy || dz) && !this.get(x + dx, y + dy, z + dz)) e++;
    return e;
  }
  /** dominant axis-aligned outward step (toward the empty side) */
  outward(x: number, y: number, z: number): V3 {
    const ox = (this.get(x + 1, y, z) ? 0 : 1) - (this.get(x - 1, y, z) ? 0 : 1);
    const oy = (this.get(x, y + 1, z) ? 0 : 1) - (this.get(x, y - 1, z) ? 0 : 1);
    const oz = (this.get(x, y, z + 1) ? 0 : 1) - (this.get(x, y, z - 1) ? 0 : 1);
    const ax = Math.abs(ox), ay = Math.abs(oy), az = Math.abs(oz);
    if (ax >= ay && ax >= az && ax) return [Math.sign(ox), 0, 0];
    if (ay >= az && ay) return [0, Math.sign(oy), 0];
    if (az) return [0, 0, Math.sign(oz)];
    return [0, 0, 0];
  }
}

// =============================================================================
// REVOLVER CYLINDER — the floating magazine
// =============================================================================
const CYL_R = 40; // outer radius (voxels)
const CYL_L = 64; // length along Z (voxels)
const CYL_CR = 25.5; // chamber circle radius
/** 44 mm cylinder at 80 voxels across → 0.55 mm voxels */
export const HUD_CYL_VS = 0.044 / (CYL_R * 2);

/** chamber bore radius (voxels) — shrinks with more chambers so walls stay intact */
function cylChamberR(n: number) {
  const half = CYL_CR * Math.sin(Math.PI / n);
  return Math.min(11.0, half - 1.8, CYL_R - 2.8 - CYL_CR);
}
/** chamber i angle: chamber 0 at 12 o'clock, then clockwise seen from the rear (+Z) */
export function hudChamberAngle(i: number, n: number) {
  return Math.PI / 2 - (i / n) * TAU;
}

// faint engraved scorpion (line art, 21 × 31; row 0 = claws, toward the front face)
const SCORPION = [
  '....#.#.......#.#....',
  '...#...#.....#...#...',
  '...#...#.....#...#...',
  '....#.#.......#.#....',
  '.....#.........#.....',
  '......#.......#......',
  '.......#.....#.......',
  '........#####........',
  '..#....#.....#....#..',
  '...#...#.....#...#...',
  '....##.#.#.#.#.##....',
  '..#....#.....#....#..',
  '...#...#.....#...#...',
  '....##.#.....#.##....',
  '..#....#.....#....#..',
  '...#...#.....#...#...',
  '....##..#...#..##....',
  '.........#.#.........',
  '........#...#........',
  '........#...#........',
  '.........#.#.........',
  '........#...#........',
  '.........#.#.........',
  '........#...#........',
  '.........#.#.........',
  '.........#.#.........',
  '..........#..........',
  '.........#.#.........',
  '........#...#........',
  '.........##..........',
  '...........#.........',
];

export interface HudCylinder {
  model: VoxelModel;
  voxelSize: number;
  /** voxel-space pivot (axis centre) for buildVoxelGeometry */
  pivot: V3;
  meta: {
    n: number;
    /** chamber centres, metres from the axis (x, y), chamber 0 at 12 o'clock */
    chambers: [number, number][];
    chamberRadius: number;
    chamberCircle: number;
    radius: number;
    length: number;
    /** rear face (+Z) and front face (−Z) planes, metres from the pivot */
    rearZ: number;
    frontZ: number;
    ratchetRadius: number;
  };
}

const cylCache = new Map<number, HudCylinder>();

// battle damage: dents in the outer skin, chips knocked out of the rims, dings on the rear face
const DENTS: { th: number; z: number; d: number; s: number }[] = [
  { th: 0.42, z: -11, d: 2.3, s: 4.6 },
  { th: 1.95, z: 13, d: 1.7, s: 3.6 },
  { th: 3.02, z: -22, d: 2.7, s: 5.6 },
  { th: 4.38, z: 4, d: 1.5, s: 3.1 },
  { th: 5.31, z: -2, d: 2.1, s: 4.2 },
  { th: 2.52, z: 24, d: 1.9, s: 3.3 },
  { th: 1.12, z: -26, d: 1.4, s: 2.8 },
  { th: 3.86, z: 19, d: 2.4, s: 4.0 },
  { th: 5.92, z: 22, d: 1.3, s: 2.6 },
];
const CHIPS: { th: number; rear: boolean; s: number }[] = [
  { th: 0.9, rear: true, s: 3.2 },
  { th: 2.7, rear: true, s: 2.4 },
  { th: 4.6, rear: true, s: 2.8 },
  { th: 1.7, rear: false, s: 3.0 },
  { th: 3.9, rear: false, s: 2.5 },
  { th: 5.6, rear: false, s: 3.4 },
];
/** radial deficit of the outer skin: out-of-round wear + dents (voxels, ≥ 0) */
function cylWear(th: number, z: number) {
  let d = 0.3 + 0.32 * NZ.n2(th * 2.6 + 11, z * 0.07) + 0.22 * NZ.n2(th * 6.5 - 4, z * 0.16);
  for (const dn of DENTS) {
    const du = wrapPi(th - dn.th) * CYL_R, dz = z - dn.z;
    const q = (du * du + dz * dz) / (2 * dn.s * dn.s);
    if (q < 4) d += dn.d * Math.exp(-q);
  }
  return d < 0 ? 0 : d;
}

export function hudCylinder(n = 6): HudCylinder {
  n = clamp(Math.round(n), 5, 9);
  const hit = cylCache.get(n);
  if (hit) return hit;
  const R = CYL_R, L = CYL_L, zr = L / 2, zf = -L / 2;
  const rb = cylChamberR(n);
  const chamberA: number[] = [];
  const ch: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = hudChamberAngle(i, n);
    chamberA.push(a);
    ch.push([Math.cos(a) * CYL_CR, Math.sin(a) * CYL_CR]);
  }
  const fluteA = chamberA.map((a) => a - Math.PI / n);
  const fluteR = 6.0, fluteC = R + 2.2, zF0 = zf + 7, zF1 = zr - 12;
  // engraving on two lands (above chamber 0 and the opposite chamber)
  const landW = R * (TAU / n) - 2 * Math.sqrt(fluteR * fluteR - 2.2 * 2.2);
  const uS = Math.min(1, (landW - 3) / 21), vS = 1.15, zE0 = zf + 8;
  const engraveLands = [0, Math.floor(n / 2)].map((i) => chamberA[i]);
  const engraveHit = (px: number, py: number, pz: number) => {
    const row = Math.floor((pz - zE0) / vS);
    if (row < 0 || row >= SCORPION.length) return false;
    const phi = Math.atan2(py, px);
    for (const a of engraveLands) {
      const du = wrapPi(phi - a) * R;
      if (Math.abs(du) > 12.5 * uS + 1) continue;
      const col = Math.floor(du / uS + 10.5);
      if (col >= 0 && col < 21 && SCORPION[SCORPION.length - 1 - row][col] === '#') return true;
    }
    return false;
  };

  const chipPts = CHIPS.map((c) => ({ x: Math.cos(c.th) * (R - 1.2), y: Math.sin(c.th) * (R - 1.2), z: c.rear ? zr - 1.0 : zf + 1.0, s: c.s }));
  const dings: { x: number; y: number; s: number }[] = [];
  for (let i = 0; i < 7; i++) {
    const a = i * 2.61 + 0.35, rr = 13 + ((i * 11) % 23);
    dings.push({ x: Math.cos(a) * rr, y: Math.sin(a) * rr, s: 1.6 + (i % 3) * 0.6 });
  }
  // wear depends only on (angle, z): tabulate it once (0.5° × one row per voxel layer)
  const TB = 720;
  const wearTab = new Float32Array(TB * L);
  for (let zi = 0; zi < L; zi++) for (let b = 0; b < TB; b++) wearTab[zi * TB + b] = cylWear((b / TB) * TAU - Math.PI, zf + zi + 0.5);
  const wearAt = (th: number, pz: number) => {
    const zi = clamp(Math.floor(pz - zf), 0, L - 1);
    const b = clamp(Math.floor(((th + Math.PI) / TAU) * TB), 0, TB - 1);
    return wearTab[zi * TB + b];
  };
  const solid = (px: number, py: number, pz: number): boolean => {
    const r = len2(px, py);
    if (pz > zf && pz < zr) {
      const dEnd = Math.min(zr - pz, pz - zf);
      const wear = r > R - 6 ? wearAt(Math.atan2(py, px), pz) : 0;
      if (r > R - Math.max(0, 2.6 - dEnd) - wear) return false; // chamfered, dented, out-of-round skin
      if (r > R - 5 && (pz > zr - 5 || pz < zf + 5))
        for (const c of chipPts) if (len3(px - c.x, py - c.y, pz - c.z) < c.s + 0.6 * NZ.n2(px * 0.7, py * 0.7)) return false;
      if (pz > zr - 1)
        for (const dg of dings) if (len2(px - dg.x, py - dg.y) < dg.s + 0.5 * NZ.n2(px * 0.9 + 3, py * 0.9)) return false;
      if (r < 2.5 && pz < 0) return false; // centre-pin bore (front half)
      if (r >= 2.5 && r < 3.7 && pz > zr - 1.2) return false; // ring groove round the pin
      for (const [cx, cy] of ch) {
        const d = len2(px - cx, py - cy);
        const cs = Math.max(0, 1.7 - (zr - pz)) + Math.max(0, 0.9 - (pz - zf)); // countersunk mouths
        if (d < rb + cs) return false;
      }
      if (r > R - 7) {
        for (const b of fluteA) {
          const fx = Math.cos(b) * fluteC, fy = Math.sin(b) * fluteC;
          const zc = pz < zF0 ? zF0 : pz > zF1 ? zF1 : pz;
          if (len3(px - fx, py - fy, pz - zc) < fluteR) return false;
        }
        for (const a of chamberA) {
          const ca = Math.cos(a), sa = Math.sin(a);
          const rho = px * ca + py * sa, t = -px * sa + py * ca;
          // bolt stop notch + its lead groove (ramp in the rotation direction)
          if (pz > zr - 17.5 && pz < zr - 12.5 && Math.abs(t) < 2.3 && rho > R - 2.4) return false;
          if (pz > zr - 16.5 && pz < zr - 13.5 && t > 2.3 && t < 9 && rho > R - 1.6 * (1 - (t - 2.3) / 6.7)) return false;
        }
        if (r > R - wear - 1.35 && engraveHit(px, py, pz)) return false;
      }
      return true;
    }
    // rear: ratchet star (n teeth) and the centre pin
    if (pz >= zr && pz < zr + 2.4) {
      if (r < 2.5) return true;
      if (r < 3.7) return false;
      const t = (((Math.atan2(py, px) - chamberA[0]) * n) / TAU) % 1;
      const tt = t < 0 ? t + 1 : t;
      return r < 7.8 + 4.6 * tt * tt; // ratchet teeth: slow ramp, sharp drop
    }
    if (pz >= zr + 2.4 && pz < zr + 4.8) {
      const k = pz - (zr + 3.4);
      return r < (k > 0 ? 2.5 * Math.sqrt(Math.max(0, 1 - (k / 1.4) * (k / 1.4))) : 2.5);
    }
    // front: gas ring
    if (pz <= zf && pz > zf - 1.6) return r > 5.6 && r < 9.2;
    return false;
  };

  const g = new Grid(-R - 3, -R - 3, zf - 3, R + 3, R + 3, zr + 7);
  const R2 = (R + 0.6) * (R + 0.6);
  for (let z = g.z0; z < g.z0 + g.sz; z++) {
    const pz = z + 0.5;
    const rMax2 = pz > zf - 1.6 && pz < zr ? R2 : 121; // ratchet / pin / gas ring are small
    for (let y = g.y0; y < g.y0 + g.sy; y++) {
      const py = y + 0.5;
      for (let x = g.x0; x < g.x0 + g.sx; x++) {
        const px = x + 0.5;
        if (px * px + py * py > rMax2) continue;
        if (solid(px, py, pz)) g.a[g.idx(x, y, z)] = 1;
      }
    }
  }

  // rust field: large blooms + mid / fine breakup, plus explicit oxidised blooms
  const blooms: { c: V3; r: number; a: number }[] = [];
  for (let i = 0; i < 11; i++) {
    const a = i * 2.39 + 0.7, zz = zf + 4 + ((i * 17.3) % (L - 8));
    blooms.push({ c: [Math.cos(a) * R, Math.sin(a) * R, zz], r: 9 + ((i * 7) % 8), a: 0.32 + ((i * 13) % 5) * 0.05 });
  }
  for (let i = 0; i < 3; i++) {
    const a = i * 2.1 + 1.1, rr = 18 + i * 7;
    blooms.push({ c: [Math.cos(a) * rr, Math.sin(a) * rr, zr], r: 8 + i * 2, a: 0.4 });
    blooms.push({ c: [Math.cos(a + 1) * rr, Math.sin(a + 1) * rr, zf], r: 9, a: 0.45 });
  }
  const rustField = (x: number, y: number, z: number) => {
    let v = 0.46 + 0.5 * fbm3(x * 0.026, y * 0.026, z * 0.026 + 3.1) + 0.12 * NZ.n3(x * 0.11 + 5, y * 0.11, z * 0.11 - 2);
    for (const b of blooms) {
      const dx = x - b.c[0], dy = y - b.c[1], dz = z - b.c[2];
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < b.r * b.r) {
        const k = 1 - Math.sqrt(d2) / b.r;
        v += b.a * k * k;
      }
    }
    return v;
  };
  const nearestChamber = (px: number, py: number) => {
    let best = 1e18;
    for (const [cx, cy] of ch) {
      const dx = px - cx, dy = py - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 < best) best = d2;
    }
    return Math.sqrt(best);
  };
  // the rust field is sampled once per surface cell and reused by both passes
  const rf = new Float32Array(g.a.length).fill(NaN);
  const rust = (i: number, px: number, py: number, pz: number) => {
    let v = rf[i];
    if (v !== v) v = rf[i] = rustField(px, py, pz);
    return v;
  };

  // pitting: clusters of pits eaten into the heavy rust, the worst ones two voxels deep
  const pits: number[] = [];
  for (let z = g.z0; z < g.z0 + g.sz; z++)
    for (let y = g.y0; y < g.y0 + g.sy; y++)
      for (let x = g.x0; x < g.x0 + g.sx; x++) {
        const i = g.idx(x, y, z);
        if (!g.a[i] || !g.surfaceI(i)) continue;
        const px = x + 0.5, py = y + 0.5, pz = z + 0.5;
        if (px * px + py * py < 144 || nearestChamber(px, py) < rb + 2.2) continue;
        const cl = NZ.n3(px * 0.21 + 7, py * 0.21, pz * 0.21);
        if (cl < 0.3 || h3(x, y, z, 1) > 0.62 || rust(i, px, py, pz) < 0.58) continue;
        pits.push(i);
        if (cl > 0.55) {
          const o = g.outward(x, y, z);
          const j2 = g.idx(x - o[0], y - o[1], z - o[2]);
          if (j2 !== i) pits.push(j2);
        }
      }
  for (const i of pits) g.a[i] = 0;

  // smooth curvature: raw exposure is meaningless on stair-stepped curves (every step looks
  // like an edge), so average it over a 5×5×5 neighbourhood of surface cells
  const expo = new Float32Array(g.a.length).fill(-1);
  for (let i = 0; i < g.a.length; i++) {
    const x = i % g.sx, y = Math.floor(i / g.sx) % g.sy, z = Math.floor(i / (g.sx * g.sy));
    if (x < 1 || y < 1 || z < 1 || x >= g.sx - 1 || y >= g.sy - 1 || z >= g.sz - 1) continue;
    if (g.a[i] && g.surfaceI(i)) expo[i] = g.exposureI(i);
  }
  const sxy = g.sx * g.sy;
  const curv = (i: number) => {
    let s2 = 0, n2 = 0;
    for (let dz = -2; dz <= 2; dz++)
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++) {
          const j = i + dx + dy * g.sx + dz * sxy;
          if (j < 0 || j >= expo.length) continue;
          const e = expo[j];
          if (e >= 0) {
            s2 += e;
            n2++;
          }
        }
    return n2 ? (s2 / n2 - 10) / 6 : 0;
  };
  const m = new VoxelModel('hud_cylinder_' + n);
  const flakes: [number, number, number, number][] = [];
  const METAL = VF.METAL;
  for (let z = g.z0; z < g.z0 + g.sz; z++)
    for (let y = g.y0; y < g.y0 + g.sy; y++)
      for (let x = g.x0; x < g.x0 + g.sx; x++) {
        const ci = g.idx(x, y, z);
        if (!g.a[ci]) continue;
        if (!g.surfaceI(ci)) {
          m.set(x, y, z, 0x3c3f44);
          continue;
        }
        const px = x + 0.5, py = y + 0.5, pz = z + 0.5;
        const r = len2(px, py);
        const conv = curv(ci);
        const j = h3(x, y, z, 2);
        const sm = 0.5 + 0.5 * NZ.n3(px * 0.16 + 3, py * 0.16, pz * 0.16 - 1);
        // ---- chamber bores: worn mouth ring, then soot fading to black
        const dch = nearestChamber(px, py);
        if (pz > zf && pz < zr && dch < rb + 1.25 && r > 4) {
          const depthR = zr - pz, depthF = pz - zf;
          let c: number;
          let f: number = VF.SOLID;
          if (depthR < 2.2) {
            c = sm < 0.38 ? 0x6e4a32 : 0xaab0b7;
            f = METAL;
          } else if (depthF < 1.8) c = sm < 0.5 ? 0x4a2c1c : 0x5e3420;
          else {
            const k = clamp01(Math.min(depthR, depthF + 4) / 14);
            c = mix(0x463a32, 0x110e0d, k);
            if (depthR < 9 && sm > 0.7) c = 0x6a3a20;
          }
          m.set(x, y, z, c, f);
          continue;
        }
        // ---- centre pin + groove: polished steel with a little crud
        if (r < 3.8 && pz > zr - 1.3) {
          const c = r < 2.6 ? (sm < 0.3 ? 0x7a4424 : conv > 0.2 ? 0xcfd4d9 : 0xa8aeb5) : 0x2a221c;
          m.set(x, y, z, c, r < 2.6 ? METAL : VF.SOLID);
          continue;
        }
        // ---- everything else: rust model
        let rho = rust(ci, px, py, pz);
        rho -= 0.62 * Math.max(0, conv); // rubbed edges
        rho += 0.45 * Math.max(0, -conv); // crevices hold rust
        if (pz > zr - 1.1 && pz < zr + 0.1 && r > 14) rho -= 0.12; // recoil-shield rub on the rear face
        if (pz >= zr - 0.2 && r < 11.5) rho -= 0.48 + 0.3 * Math.max(0, conv); // ratchet star rubbed bright by the hand
        rho = clamp01(rho);
        let c: number;
        let f: number = VF.SOLID;
        if (rho < 0.24) {
          const blued = NZ.n3(px * 0.06, py * 0.06 + 4, pz * 0.06) > 0.18 && conv <= 0.25;
          c = conv > 0.28 ? 0xc6ccd2 : blued ? (sm > 0.5 ? 0x424a5a : 0x363e4c) : sm > 0.5 ? 0x8a9199 : 0x757c85;
          f = METAL;
        } else if (rho < 0.38) {
          const t = (rho - 0.24) / 0.14;
          c = t < 0.5 ? 0x6c6a68 : 0x7a4628;
          if (t < 0.5) f = METAL;
        } else if (rho < 0.58) c = sm > 0.82 ? 0xc8742a : sm > 0.5 ? 0xb0561c : 0x984818;
        else if (rho < 0.8) c = sm > 0.5 ? 0x7c3814 : 0x662c10;
        else c = sm > 0.5 ? 0x52240e : 0x401c0b;
        if (j < 0.02) c = mulRGB(c, 0.8);
        if (conv < -0.3) c = mulRGB(c, 0.72);
        // faint engraving: floor of the cut is filled with dark oxide
        if (r > R - 2.7 && pz > zf + 3 && pz < zr - 3 && engraveHit(px, py, pz)) c = mix(mulRGB(c, 0.6), 0x3a2214, 0.4);
        m.set(x, y, z, c, f);
        // flaking scale lifts off the heavy rust
        if (rho > 0.62 && NZ.n3(px * 0.3 + 1, py * 0.3, pz * 0.3 - 7) > 0.6 && h3(x, y, z, 3) < 0.45) {
          const o = g.outward(x, y, z);
          if (o[0] || o[1] || o[2]) flakes.push([x + o[0], y + o[1], z + o[2], h3(x, y, z, 4)]);
        }
      }
  for (const [x, y, z, hh] of flakes) {
    if (g.get(x, y, z)) continue;
    m.set(x, y, z, hh < 0.55 ? 0xc0743a : 0x9a4e22);
  }

  const vs = HUD_CYL_VS;
  const res: HudCylinder = {
    model: m,
    voxelSize: vs,
    pivot: [0, 0, 0],
    meta: {
      n,
      chambers: ch.map(([cx, cy]) => [cx * vs, cy * vs] as [number, number]),
      chamberRadius: rb * vs,
      chamberCircle: CYL_CR * vs,
      radius: R * vs,
      length: L * vs,
      rearZ: zr * vs,
      frontZ: zf * vs,
      ratchetRadius: 12.4 * vs,
    },
  };
  cylCache.set(n, res);
  return res;
}

// =============================================================================
// CARTRIDGES
// =============================================================================
export type HudRoundKind = 'brass' | 'venom' | 'spent';
export interface HudRound {
  model: VoxelModel;
  voxelSize: number;
  /** voxel-space pivot: rear (head) face centre; the round extends toward −Z */
  pivot: V3;
  meta: {
    kind: HudRoundKind;
    caseRadius: number;
    rimRadius: number;
    rimThickness: number;
    length: number;
    /** seated: put the pivot this far behind (+Z of) the cylinder's rear face */
    seatOffset: number;
  };
}

const GLYPH: Record<string, string[]> = {
  S: ['.##', '#..', '.#.', '..#', '##.'],
  R: ['##.', '#.#', '##.', '#.#', '#.#'],
  '*': ['#.#', '.#.', '#.#'],
};

const roundCache = new Map<string, HudRound>();

export function hudRound(kind: HudRoundKind = 'brass', n = 6): HudRound {
  n = clamp(Math.round(n), 5, 9);
  const key = kind + n;
  const hit = roundCache.get(key);
  if (hit) return hit;
  const rb = cylChamberR(n);
  const sc = rb / 10.95;
  const caseR = rb - 0.75;
  const rimR = Math.min(rb + 1.9, CYL_CR * Math.sin(Math.PI / n) - 0.4);
  const rimT = 2, caseL = 40, bulletL = kind === 'spent' ? 0 : 17;
  const total = rimT + caseL + bulletL;
  const pr = 3.6 * sc; // primer pocket radius
  // headstamp: "SR" at 12 o'clock, a little star at 6 o'clock (engraved into the rear layer)
  const stampR = (pr + rimR) / 2;
  const stamp = new Set<string>();
  const put = (gl: string[], cx: number, cy: number) =>
    gl.forEach((row, ry) => [...row].forEach((chh, rx) => chh === '#' && stamp.add(`${cx + rx - 1},${cy + Math.floor(gl.length / 2) - ry}`)));
  put(GLYPH.S, -2, Math.round(stampR));
  put(GLYPH.R, 2, Math.round(stampR));
  put(GLYPH['*'], 0, -Math.round(stampR));
  // venom veins radiating from the glass primer across the head
  const veins = new Set<string>();
  if (kind === 'venom') {
    for (let v = 0; v < 7; v++) {
      let th = (v / 7) * TAU + 0.31;
      for (let rr = pr + 0.3; rr < rimR - 1.0; rr += 0.45) {
        th += NZ.n2(v * 3.1, rr * 0.35) * 0.16;
        veins.add(`${Math.floor(Math.cos(th) * rr)},${Math.floor(Math.sin(th) * rr)}`);
        if (Math.abs(rr - (pr + 3.2)) < 0.25 && v % 2 === 0)
          for (let b = 0; b < 4; b++) veins.add(`${Math.floor(Math.cos(th + 0.32) * (rr + b))},${Math.floor(Math.sin(th + 0.32) * (rr + b))}`);
      }
    }
  }
  const E = Math.ceil(rimR) + 2;
  const g = new Grid(-E, -E, -total - 2, E, E, 2);
  // region tags: 1 head, 2 case, 3 bullet, 4 primer, 5 glass
  const tag = new Grid(-E, -E, -total - 2, E, E, 2);
  for (let z = g.z0; z < g.z0 + g.sz; z++)
    for (let y = g.y0; y < g.y0 + g.sy; y++)
      for (let x = g.x0; x < g.x0 + g.sx; x++) {
        const px = x + 0.5, py = y + 0.5, pz = z + 0.5;
        const r = len2(px, py);
        let t = 0;
        if (pz > -rimT && pz < 0) {
          const rear = pz > -1;
          const nick = r > rimR - 2.2 && (len2(px - Math.cos(0.8) * rimR, py - Math.sin(0.8) * rimR) < 1.9 || len2(px - Math.cos(3.6) * rimR, py - Math.sin(3.6) * rimR) < 1.5);
          if (r < rimR - (rear ? 0.7 : 0) && !nick) {
            t = 1;
            if (r < pr) {
              if (rear) {
                t = 0;
                if (kind === 'venom' && r < pr - 1.6) t = 5;
                if (kind === 'spent' && r >= 1.4 && r < 2.2) t = 4; // crater lip pushed back
              } else {
                t = r < pr - 0.6 ? (kind === 'venom' ? 5 : 4) : 0; // primer cup + pocket gap ring
                if (kind === 'spent' && r < 1.4) t = 0; // firing-pin crater
                if (kind === 'brass' && x === 1 && y === 0) t = 0; // the dent
              }
            } else if (rear && stamp.has(`${x},${y}`)) t = 0;
          }
        } else if (pz < -rimT && pz > -rimT - caseL) {
          const s = -pz - rimT;
          let rr = caseR - 0.35 * (s / caseL);
          if (Math.abs(s - (caseL - 4)) < 0.7) rr -= 0.7; // cannelure
          if (r < rr) t = 2;
          if (kind === 'spent' && s > caseL - 8 && r < rr - 1.2) t = 0; // open, fired mouth
        } else if (bulletL > 0 && pz < -rimT - caseL && pz > -total) {
          const s = -pz - rimT - caseL;
          const bR = caseR - 0.55, nose = bulletL - 10;
          let rr = s < nose ? bR : bR * Math.pow(Math.max(0, 1 - ((s - nose) / 10) ** 2), 0.62);
          if (s < nose && Math.abs(s - 2.5) < 0.6) rr -= 0.5; // lube groove
          if (r < rr) t = 3;
        }
        if (t) {
          g.set(x, y, z, 1);
          tag.set(x, y, z, t);
        }
      }
  const m = new VoxelModel('hud_round_' + kind);
  for (let z = g.z0; z < g.z0 + g.sz; z++)
    for (let y = g.y0; y < g.y0 + g.sy; y++)
      for (let x = g.x0; x < g.x0 + g.sx; x++) {
        const t = tag.get(x, y, z);
        if (!t) continue;
        if (!g.surface(x, y, z)) {
          m.set(x, y, z, 0x6a5228);
          continue;
        }
        const px = x + 0.5, py = y + 0.5, pz = z + 0.5;
        const r = len2(px, py);
        const conv = (g.exposure(x, y, z) - 9) / 9;
        const j = h3(x, y, z, 11);
        let c: number;
        let f: number = VF.METAL;
        if (t === 1 || t === 2) {
          // tarnished brass in a few clear bands (readable under outlines)
          const tn = clamp01(0.5 + 0.55 * fbm3(px * 0.07 + 2, py * 0.07, pz * 0.07));
          c = tn < 0.42 ? 0xdaae54 : tn < 0.66 ? 0xbc9444 : tn < 0.82 ? 0x9a7638 : 0x76582c;
          if (conv > 0.25) c = tn < 0.6 ? 0xf2d488 : 0xe0bc6c;
          if (conv < -0.2 && j < 0.2) c = 0x5a8a6e; // verdigris in the crevices
          if (j < 0.03) c = mulRGB(c, 0.82);
          if (pz > -1 && veins.has(`${x},${y}`)) {
            c = j < 0.5 ? 0x4fd04a : 0x7ef07a;
            f = VF.SOLID;
          }
          if (kind === 'spent') {
            c = mix(c, 0x6a5230, 0.35);
            if (pz > -1 && r < pr + 3) c = mix(c, 0x2e2620, 0.8 * (1 - (r - pr) / 3));
            if (t === 2 && -pz - rimT > caseL - 6) c = mix(c, 0x3a302a, 0.55);
          }
          if (pz > -1 && pz < 0 && stamp.has(`${x},${y}`)) c = mulRGB(c, 0.7);
          // the floor of the headstamp / pocket ring reads darker
          if (pz < -1 && pz > -2 && r < pr + 0.2) c = mulRGB(c, 0.55);
          if (pz < -2 && r < pr) c = 0x2a2018; // seen through the pocket ring / crater
        } else if (t === 4) {
          c = kind === 'spent' ? (r < 2.3 ? mix(0x9a9488, 0x6e6a62, j) : mix(0x8a8478, 0xa6a094, j)) : mix(0xb8b4a8, 0xcfcbc0, j);
          if (r > pr - 1.2) c = mulRGB(c, 0.8);
        } else if (t === 5) {
          const core = r < pr - 2.2;
          c = core ? (j < 0.5 ? 0x8cff7e : 0x6ee86a) : mix(0x3aa848, 0x2f8a3a, j);
          f = core ? VF.EMISSIVE : VF.SOLID;
        } else {
          // lead bullet (venom rounds get a green resin dip)
          const s = -pz - rimT - caseL;
          c = NZ.n3(px * 0.2, py * 0.2, pz * 0.2) > 0 ? 0x8a8d92 : 0x74777d;
          if (j < 0.04) c = 0xb4b6b6;
          if (Math.abs(s - 2.5) < 0.9) c = 0x50535a;
          if (kind === 'venom' && s > bulletL - 5) c = j < 0.5 ? 0x3aa040 : 0x5ac85a;
          f = VF.SOLID;
        }
        m.set(x, y, z, c, f);
      }
  const vs = HUD_CYL_VS;
  const res: HudRound = {
    model: m,
    voxelSize: vs,
    pivot: [0, 0, 0],
    meta: { kind, caseRadius: caseR * vs, rimRadius: rimR * vs, rimThickness: rimT * vs, length: total * vs, seatOffset: rimT * vs },
  };
  roundCache.set(key, res);
  return res;
}

// =============================================================================
// HEART — anatomical, wrapped in mummy linen
// =============================================================================
/** ~12 cm heart at ~95 voxels tall (incl. the great vessels) */
export const HUD_HEART_VS = 1 / 750;

function sdEll(px: number, py: number, pz: number, c: V3, r: V3) {
  const x = (px - c[0]) / r[0], y = (py - c[1]) / r[1], z = (pz - c[2]) / r[2];
  const k0 = Math.sqrt(x * x + y * y + z * z);
  const k1 = Math.sqrt((x / r[0]) ** 2 + (y / r[1]) ** 2 + (z / r[2]) ** 2);
  return k1 > 1e-6 ? (k0 * (k0 - 1)) / k1 : -Math.min(r[0], r[1], r[2]);
}
/** iq round cone between a (r1) and b (r2) */
function sdRoundCone(px: number, py: number, pz: number, a: V3, b: V3, r1: number, r2: number) {
  const bax = b[0] - a[0], bay = b[1] - a[1], baz = b[2] - a[2];
  const l2 = bax * bax + bay * bay + baz * baz;
  const rr = r1 - r2, a2 = l2 - rr * rr, il2 = 1 / l2;
  const pax = px - a[0], pay = py - a[1], paz = pz - a[2];
  const y = pax * bax + pay * bay + paz * baz;
  const z = y - l2;
  const qx = pax * l2 - bax * y, qy = pay * l2 - bay * y, qz = paz * l2 - baz * y;
  const x2 = qx * qx + qy * qy + qz * qz;
  const y2 = y * y * l2, z2 = z * z * l2;
  const k = Math.sign(rr) * rr * rr * x2;
  if (Math.sign(z) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - r2;
  if (Math.sign(y) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - r1;
  return (Math.sqrt(x2 * a2 * il2) + y * rr) * il2 - r1;
}
function smin(a: number, b: number, k: number) {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}
function segDist(px: number, py: number, pz: number, a: V3, b: V3) {
  const bx = b[0] - a[0], by = b[1] - a[1], bz = b[2] - a[2];
  const t = clamp01(((px - a[0]) * bx + (py - a[1]) * by + (pz - a[2]) * bz) / (bx * bx + by * by + bz * bz));
  return len3(px - a[0] - bx * t, py - a[1] - by * t, pz - a[2] - bz * t);
}
const norm = (v: V3): V3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

// anatomy (voxel units; +Y up, +Z anterior/toward the viewer, +X = the heart's left)
const H_BASE: V3 = [-3, 2, 2];
const H_APEX: V3 = [16, -38, 11];
const H_AXIS = norm([H_APEX[0] - H_BASE[0], H_APEX[1] - H_BASE[1], H_APEX[2] - H_BASE[2]]);
const ELL = {
  lv: { c: [9, -8, -3] as V3, r: [20, 24, 20] as V3 },
  rv: { c: [-9, -3, 8] as V3, r: [21, 22, 16] as V3 },
  ra: { c: [-22, 13, -2] as V3, r: [13, 14, 13] as V3 },
  la: { c: [5, 17, -14] as V3, r: [16, 11, 12] as V3 },
  rau: { c: [-15, 22, 10] as V3, r: [9, 5.5, 6] as V3 },
  lau: { c: [19, 20, 7] as V3, r: [8, 5, 5.5] as V3 },
};
const N_AV = norm([0.28, 1, 0.12]);
const AV_P: V3 = [-3, 11, 0];

function bodyRaw(px: number, py: number, pz: number) {
  let d = sdRoundCone(px, py, pz, H_BASE, H_APEX, 22, 5);
  d = smin(d, sdEll(px, py, pz, ELL.lv.c, ELL.lv.r), 9);
  d = smin(d, sdEll(px, py, pz, ELL.rv.c, ELL.rv.r), 9);
  d = smin(d, sdEll(px, py, pz, ELL.ra.c, ELL.ra.r), 6);
  d = smin(d, sdEll(px, py, pz, ELL.la.c, ELL.la.r), 7);
  d = smin(d, sdEll(px, py, pz, ELL.rau.c, ELL.rau.r), 3);
  d = smin(d, sdEll(px, py, pz, ELL.lau.c, ELL.lau.r), 3);
  return d;
}
/** surface point of the raw body along +Z (front) or −Z (back) at (x, y) */
function surfZ(sd: (x: number, y: number, z: number) => number, x: number, y: number, front: boolean) {
  for (let i = 0; i <= 160; i++) {
    const z = front ? 40 - i * 0.5 : -44 + i * 0.5;
    if (sd(x, y, z) <= 0) return z;
  }
  return NaN;
}

interface Tube {
  pts: V3[];
  r: number[];
  wall: number;
  kind: 'aorta' | 'pulm' | 'vein' | 'pvein';
  /** last point is a cut (flat end, open lumen) */
  cut: boolean;
}
const VESSELS: Tube[] = [
  { kind: 'aorta', pts: [[-3, 14, 1], [-3, 27, 1], [-2, 37, -1], [3, 44, -5], [11, 47, -10], [18, 45, -16]], r: [7.6, 7.6, 7.3, 7.0, 6.8, 6.6], wall: 2.0, cut: true },
  { kind: 'aorta', pts: [[1, 43, -4], [0, 54, -5]], r: [3.4, 3.2], wall: 1.3, cut: true },
  { kind: 'aorta', pts: [[8, 46, -8], [8, 56, -9]], r: [3.0, 2.8], wall: 1.2, cut: true },
  { kind: 'aorta', pts: [[14, 46, -12], [16, 55, -14]], r: [3.0, 2.8], wall: 1.2, cut: true },
  { kind: 'pulm', pts: [[7, 12, 15], [9, 24, 14], [10, 33, 8], [9, 37, 1]], r: [7, 7, 6.6, 6.3], wall: 1.8, cut: false },
  { kind: 'pulm', pts: [[9, 37, 1], [19, 38, -5]], r: [5, 4.6], wall: 1.5, cut: true },
  { kind: 'pulm', pts: [[9, 37, 1], [-4, 36, -8]], r: [4.8, 4.4], wall: 1.5, cut: true },
  { kind: 'vein', pts: [[-20, 20, -6], [-20, 35, -7], [-19, 44, -8]], r: [6.4, 6.4, 6.2], wall: 1.4, cut: true },
  { kind: 'vein', pts: [[-15, -4, -13], [-16, -17, -19]], r: [6.6, 6.4], wall: 1.4, cut: true },
  { kind: 'pvein', pts: [[13, 19, -22], [19, 20, -31]], r: [3.0, 2.8], wall: 1.1, cut: true },
  { kind: 'pvein', pts: [[-1, 19, -23], [-5, 20, -32]], r: [3.0, 2.8], wall: 1.1, cut: true },
  { kind: 'pvein', pts: [[9, 13, -24], [14, 12, -32]], r: [2.8, 2.6], wall: 1.0, cut: true },
];
/** coronary arteries (1) and veins (2): (x, y) polylines draped over the front or back */
const CORONARY: { kind: 1 | 2; front: boolean; xy: [number, number][]; r0: number; r1: number }[] = [
  { kind: 1, front: true, xy: [[2, 12], [4, 2], [7, -10], [10, -22], [13, -32]], r0: 1.9, r1: 1.1 }, // LAD
  { kind: 1, front: true, xy: [[4, 2], [10, -4], [17, -10], [22, -16]], r0: 1.4, r1: 0.9 }, // diagonal 1
  { kind: 1, front: true, xy: [[7, -10], [13, -16], [18, -23]], r0: 1.2, r1: 0.8 }, // diagonal 2
  { kind: 1, front: true, xy: [[-4, 13], [-12, 11], [-20, 8], [-27, 3]], r0: 1.9, r1: 1.4 }, // RCA
  { kind: 1, front: true, xy: [[-20, 8], [-21, -4], [-18, -16], [-14, -26]], r0: 1.3, r1: 0.8 }, // acute marginal
  { kind: 1, front: true, xy: [[4, 13], [12, 12], [20, 9], [26, 4]], r0: 1.6, r1: 1.1 }, // circumflex
  { kind: 1, front: false, xy: [[-6, 6], [-2, -8], [3, -20], [8, -30]], r0: 1.5, r1: 0.9 }, // posterior descending
  { kind: 2, front: true, xy: [[4, 11], [6, 1], [9, -11], [12, -23]], r0: 1.4, r1: 1.0 }, // great cardiac vein
  { kind: 2, front: true, xy: [[-10, -2], [-14, -14]], r0: 0.9, r1: 0.7 },
  { kind: 2, front: true, xy: [[14, -6], [19, -14]], r0: 0.9, r1: 0.7 },
  { kind: 2, front: false, xy: [[-3, 7], [1, -6], [5, -18]], r0: 1.2, r1: 0.8 }, // middle cardiac vein
];

interface WrapDef {
  n: V3;
  c: V3;
  w: number;
  /** angular coverage around n (radians, null = full ring) */
  span: [number, number] | null;
  layer: number;
  tail: boolean;
}

export interface HudHeartPart {
  model: VoxelModel;
  voxelSize: number;
  pivot: V3;
}
export interface HudHeart {
  /** heart = muscle + fat + coronaries; aorta / pulmonary / vena pulse separately; wraps unwind */
  parts: { heart: HudHeartPart; aorta: HudHeartPart; pulmonary: HudHeartPart; vena: HudHeartPart; wraps: HudHeartPart[] };
  meta: {
    /** total height (m) */
    height: number;
    width: number;
    /** voxel-space beat pivot shared by every part */
    pivot: V3;
    /** each wrap's band-plane normal (unit, voxel/model space) — rotate around it to unwind */
    wrapAxes: V3[];
    apex: V3;
  };
}

let heartCache: HudHeart | null = null;

export function hudHeart(): HudHeart {
  if (heartCache) return heartCache;
  const X0 = -44, X1 = 44, Y0 = -46, Y1 = 64, Z0 = -42, Z1 = 36;
  const g = new Grid(X0, Y0, Z0, X1, Y1, Z1);
  const sx = g.sx, sy = g.sy;
  const N = g.sx * g.sy * g.sz;
  // grooves need their endpoints on the raw surface
  const IV0: V3 = [3, 10, surfZ(bodyRaw, 3, 10, true)];
  const IV1: V3 = [12, -30, surfZ(bodyRaw, 12, -30, true)];
  const PIV0: V3 = [-6, 6, surfZ(bodyRaw, -6, 6, false)];
  const PIV1: V3 = [7, -30, surfZ(bodyRaw, 7, -30, false)];
  const grooveW = (px: number, py: number, pz: number) => {
    const dav = (px - AV_P[0]) * N_AV[0] + (py - AV_P[1]) * N_AV[1] + (pz - AV_P[2]) * N_AV[2];
    const wav = Math.exp(-(dav * dav) / (2 * 2.2 * 2.2));
    const div = segDist(px, py, pz, IV0, IV1);
    const wiv = Math.exp(-(div * div) / (2 * 3 * 3));
    const dpiv = segDist(px, py, pz, PIV0, PIV1);
    const wpiv = Math.exp(-(dpiv * dpiv) / 18);
    return { wav, wiv, wpiv };
  };
  const body = (px: number, py: number, pz: number) => {
    const gw = grooveW(px, py, pz);
    // lumpy, organic muscle: broad swellings + smaller knots, never a clean primitive
    const lump = 1.0 * fbm3(px * 0.045 + 1, py * 0.045, pz * 0.045) + 0.45 * NZ.n3(px * 0.13, py * 0.13 + 5, pz * 0.13);
    return bodyRaw(px, py, pz) + 2.3 * gw.wav + 2.0 * gw.wiv + 1.8 * gw.wpiv + lump;
  };
  // 1) body SDF on the grid (only inside the anatomy's box; far cells stay "far")
  const sd = new Float32Array(N).fill(99);
  // sphere-traced along rows: far-outside cells only need "> shell", deep-inside cells only the sign
  const LIP = 1.7;
  for (let z = -34; z < 32; z++)
    for (let y = -46; y < 38; y++)
      for (let x = -40; x < 36; ) {
        const v = body(x + 0.5, y + 0.5, z + 0.5);
        let i = g.idx(x, y, z);
        sd[i] = v;
        if (v <= 0) g.a[i] = 1;
        let skip = v > 6 ? Math.floor((v - 5) / LIP) : v < -2.5 ? Math.floor((-v - 1.5) / LIP) : 0;
        x++;
        while (skip-- > 0 && x < 36) {
          i++;
          sd[i] = v > 0 ? 5.5 : -2;
          if (v <= 0) g.a[i] = 1;
          x++;
        }
      }
  // 2) great vessels: tubes with open lumens outside the body, flat cut ends
  const vid = new Uint8Array(N); // 1-based vessel index
  const cutF = new Uint8Array(N);
  const lumen = new Uint8Array(N);
  VESSELS.forEach((v, vi) => {
    for (let s = 0; s < v.pts.length - 1; s++) {
      const a = v.pts[s], b = v.pts[s + 1];
      const ra = v.r[s], rbb = v.r[s + 1];
      const last = v.cut && s === v.pts.length - 2;
      const bx = b[0] - a[0], by = b[1] - a[1], bz = b[2] - a[2];
      const l2 = bx * bx + by * by + bz * bz, len = Math.sqrt(l2);
      const rm = Math.max(ra, rbb) + 1;
      for (let z = Math.floor(Math.min(a[2], b[2]) - rm); z <= Math.ceil(Math.max(a[2], b[2]) + rm); z++)
        for (let y = Math.floor(Math.min(a[1], b[1]) - rm); y <= Math.ceil(Math.max(a[1], b[1]) + rm); y++)
          for (let x = Math.floor(Math.min(a[0], b[0]) - rm); x <= Math.ceil(Math.max(a[0], b[0]) + rm); x++) {
            if (!g.has(x, y, z)) continue;
            const px = x + 0.5, py = y + 0.5, pz = z + 0.5;
            let t = ((px - a[0]) * bx + (py - a[1]) * by + (pz - a[2]) * bz) / l2;
            if (last && t > 1) continue; // flat cut
            t = clamp01(t);
            const d = len3(px - a[0] - bx * t, py - a[1] - by * t, pz - a[2] - bz * t);
            // organic vessel walls: gentle swellings along the length, never a perfect pipe
            const r = (ra + (rbb - ra) * t) * (1 + 0.07 * NZ.n2(vi * 7.3 + (s + t) * 1.9, Math.atan2(pz - a[2] - bz * t, px - a[0] - bx * t) * 0.6));
            if (d > r) continue;
            const i = g.idx(x, y, z);
            g.a[i] = 1;
            if (!vid[i] || sd[i] > -1) vid[i] = vi + 1;
            if (last && (1 - t) * len < 1.3) cutF[i] = 1;
            if (d < r - v.wall && sd[i] > 0.8) lumen[i] = 1;
          }
    }
  });
  for (let i = 0; i < N; i++) if (lumen[i]) g.a[i] = 0;
  // 3) coronary vessels draped over the surface (sitting in the grooves)
  const art = new Uint8Array(N);
  for (const cv of CORONARY) {
    const pts: V3[] = [];
    for (const [x, y] of cv.xy) {
      const z = surfZ(body, x, y, cv.front);
      if (!Number.isNaN(z)) pts.push([x, y, z + (cv.front ? -0.4 : 0.4)]);
    }
    for (let s = 0; s < pts.length - 1; s++) {
      const a = pts[s], b = pts[s + 1];
      const tA = s / (pts.length - 1), tB = (s + 1) / (pts.length - 1);
      const rm = cv.r0 + 1;
      for (let z = Math.floor(Math.min(a[2], b[2]) - rm); z <= Math.ceil(Math.max(a[2], b[2]) + rm); z++)
        for (let y = Math.floor(Math.min(a[1], b[1]) - rm); y <= Math.ceil(Math.max(a[1], b[1]) + rm); y++)
          for (let x = Math.floor(Math.min(a[0], b[0]) - rm); x <= Math.ceil(Math.max(a[0], b[0]) + rm); x++) {
            if (!g.has(x, y, z)) continue;
            const px = x + 0.5, py = y + 0.5, pz = z + 0.5;
            const bx = b[0] - a[0], by = b[1] - a[1], bz = b[2] - a[2];
            const t = clamp01(((px - a[0]) * bx + (py - a[1]) * by + (pz - a[2]) * bz) / (bx * bx + by * by + bz * bz));
            const d = len3(px - a[0] - bx * t, py - a[1] - by * t, pz - a[2] - bz * t);
            const r = cv.r0 + (cv.r1 - cv.r0) * (tA + (tB - tA) * t);
            if (d > r) continue;
            const i = g.idx(x, y, z);
            if (sd[i] < -3.5 || vid[i]) continue;
            g.a[i] = 1;
            art[i] = cv.kind;
          }
    }
  }
  // 4) colour + split into parts: the vessels leave the heart as their own pulsing pieces
  const heart = new VoxelModel('hud_heart');
  const aortaM = new VoxelModel('hud_heart_aorta');
  const pulmM = new VoxelModel('hud_heart_pulmonary');
  const venaM = new VoxelModel('hud_heart_vena');
  const partOf = (i: number) => {
    if (!vid[i] || sd[i] < 0.6) return heart; // vessel collars stay on the heart
    const k = VESSELS[vid[i] - 1].kind;
    return k === 'aorta' ? aortaM : k === 'pulm' ? pulmM : venaM;
  };
  const B1 = norm(cross(H_AXIS, [0, 0, 1]));
  const B2 = cross(H_AXIS, B1);
  const roots: V3[] = [VESSELS[0].pts[0], VESSELS[4].pts[0], VESSELS[7].pts[0]];
  for (let z = Z0; z < Z1; z++)
    for (let y = Y0; y < Y1; y++)
      for (let x = X0; x < X1; x++) {
        const i = x - X0 + sx * (y - Y0 + sy * (z - Z0));
        if (!g.a[i]) continue;
        const target = partOf(i);
        if (!g.surfaceI(i)) {
          target.set(x, y, z, target === heart ? 0x5a1412 : 0x6a2a2a);
          continue;
        }
        const px = x + 0.5, py = y + 0.5, pz = z + 0.5;
        const e = g.exposureI(i);
        const conv = (e - 9) / 9;
        const j = h3(x, y, z, 21);
        let c: number;
        if (art[i]) {
          c = art[i] === 1 ? (conv > 0.2 ? 0xd0503e : 0xb03228) : conv > 0.2 ? 0x6a3458 : 0x52284a;
        } else if (vid[i]) {
          const v = VESSELS[vid[i] - 1];
          const nearLumen = lumen[g.idx(x + 1, y, z)] || lumen[g.idx(x - 1, y, z)] || lumen[g.idx(x, y + 1, z)] || lumen[g.idx(x, y - 1, z)] || lumen[g.idx(x, y, z + 1)] || lumen[g.idx(x, y, z - 1)];
          const tone = NZ.n3(px * 0.12 + 9, py * 0.12, pz * 0.12) > 0;
          if (nearLumen) c = tone ? 0x5a1214 : 0x420c0e;
          else if (cutF[i]) c = conv > 0.1 ? 0xe8b0a0 : 0xb87a6c;
          else {
            c = v.kind === 'aorta' ? (tone ? 0xc68474 : 0xb06e60) : v.kind === 'pulm' ? (tone ? 0xc06a5e : 0xa85a50) : v.kind === 'vein' ? (tone ? 0x6e5290 : 0x5a4278) : tone ? 0x8a5a78 : 0x744868;
            if (v.kind !== 'vein' && h3(x, y, z, 22) < 0.02) c = 0xb86a5a; // vasa vasorum
            if (conv < -0.3) c = mulRGB(c, 0.8);
            // fat collars where the vessels leave the heart
            if (sd[i] < 2.2 && v.kind !== 'pvein' && NZ.n3(px * 0.2, py * 0.2, pz * 0.2) > -0.2) c = tone ? 0xe8c05c : 0xd4a040;
          }
        } else {
          const gw = grooveW(px, py, pz);
          let fat = Math.max(gw.wav * 1.2, gw.wiv, gw.wpiv * 0.9);
          for (const r0 of roots) fat = Math.max(fat, 1 - len3(px - r0[0], py - r0[1], pz - r0[2]) / 15);
          const blot = NZ.n3(px * 0.11 + 4, py * 0.11, pz * 0.11);
          if (blot > 0.4 && py > -8) fat = Math.max(fat, (blot - 0.4) * 3);
          const auricle = Math.min(sdEll(px, py, pz, ELL.rau.c, ELL.rau.r), sdEll(px, py, pz, ELL.lau.c, ELL.lau.r)) < 1.2;
          if (fat > 0.45) {
            const lob = 0.5 + 0.5 * NZ.n3(px * 0.26, py * 0.26 + 2, pz * 0.26);
            c = lob > 0.64 ? 0xf4d878 : lob < 0.32 ? 0xd4a040 : 0xe8c05c;
            if (fat < 0.6) c = mix(c, 0x9a3a2e, 0.25); // thin fat over muscle at the margins
          } else if (auricle) {
            c = 0x74202a;
            if (Math.sin(py * 1.7 + px * 0.9 + pz * 0.4) > 0.55) c = 0x5e1a22; // crinkled appendage
          } else {
            const n = clamp01(0.5 + 0.55 * fbm3(px * 0.07, py * 0.07 + 7, pz * 0.07));
            c = n < 0.38 ? 0x7a1e1c : n < 0.68 ? 0x8e2622 : 0xa8342c;
            // myocardial fibre bands spiralling round the long axis
            const qx = px - H_BASE[0], qy = py - H_BASE[1], qz = pz - H_BASE[2];
            const along = qx * H_AXIS[0] + qy * H_AXIS[1] + qz * H_AXIS[2];
            const psi = Math.atan2(qx * B2[0] + qy * B2[1] + qz * B2[2], qx * B1[0] + qy * B1[1] + qz * B1[2]);
            if (Math.sin(psi * 9 + along * 0.45) > 0.84) c = mulRGB(c, 0.84);
            if (along > 38) c = mulRGB(c, 0.9); // apex
            if (j < 0.012 && e > 10) c = 0xb44a40; // wet glints
          }
          if (conv < -0.35) c = mulRGB(c, 0.78);
        }
        target.set(x, y, z, c);
      }

  // 5) six linen wraps (separate parts), layered: rings first, then crossing diagonals on top
  const center: V3 = [3, -10, 3];
  const along = (t: number): V3 => [H_BASE[0] + (H_APEX[0] - H_BASE[0]) * t, H_BASE[1] + (H_APEX[1] - H_BASE[1]) * t, H_BASE[2] + (H_APEX[2] - H_BASE[2]) * t];
  // φ = 0 is the front-most point of each band, so spans place the gaps where the eye sees them
  const WRAPS: WrapDef[] = [
    { n: norm([0.32, -0.93, 0.18]), c: along(0.3), w: 6, span: null, layer: 0, tail: false },
    { n: norm([0.5, -0.85, 0.12]), c: along(0.56), w: 6.5, span: [-2.7, 1.6], layer: 0, tail: false },
    { n: norm([0.36, -0.9, 0.3]), c: along(0.8), w: 5, span: [-0.8, 2.9], layer: 0, tail: true },
    { n: norm([0.15, 1, 0.1]), c: [-4, 15, 0], w: 5, span: [0.6, 3.1], layer: 0, tail: false },
    { n: norm([0.82, 0.38, 0.42]), c: center, w: 5.5, span: [-2.4, 0.4], layer: 1, tail: false },
    { n: norm([-0.66, 0.42, 0.62]), c: [2, -4, 4], w: 5, span: [0.2, 2.8], layer: 1, tail: true },
  ];
  const used = new Uint8Array(N);
  const wraps: HudHeartPart[] = [];
  // the thin shell just outside the body is the only place wraps can live: list it once
  const shell: number[] = [];
  for (let z = Z0 + 1; z < Z1 - 1; z++)
    for (let y = Y0 + 1; y < Y1 - 1; y++)
      for (let x = X0 + 1; x < X1 - 1; x++) {
        const i = x - X0 + sx * (y - Y0 + sy * (z - Z0));
        const d = sd[i];
        if (d > 0.45 && d <= 4.6 && !g.a[i]) shell.push(i);
      }
  const sxy = sx * sy;
  const pivot: V3 = [center[0], center[1], center[2]];
  WRAPS.forEach((wd, k) => {
    const wm = new VoxelModel('hud_heart_wrap_' + k);
    // u = the band-plane direction closest to the viewer (+Z)
    const fz = dot([0, 0, 1], wd.n);
    const u = Math.abs(fz) > 0.97 ? norm(cross(wd.n, [0, 1, 0])) : norm([-wd.n[0] * fz, -wd.n[1] * fz, 1 - wd.n[2] * fz]);
    const v = cross(wd.n, u);
    const half = wd.w / 2;
    const spanMid = wd.span ? (wd.span[0] + wd.span[1]) / 2 : 0;
    const spanHalf = wd.span ? (wd.span[1] - wd.span[0]) / 2 : Math.PI;
    const linen = (x: number, y: number, z: number, s: number, phi: number, inner: boolean) => {
      const px = x + 0.5, py = y + 0.5, pz = z + 0.5;
      const jj = h3(x, y, z, 31 + k);
      let c = NZ.n3(px * 0.12 + k, py * 0.12, pz * 0.12) > 0 ? 0xd2c8ae : 0xc0b496;
      const b = Math.floor(s + half);
      if (b % 5 === 0) c = mulRGB(c, 0.92); // fold lines where the strip overlaps itself
      if (Math.abs(s) > half - 1.1) c = mulRGB(c, 0.9); // frayed edge shade
      void phi;
      const resin = NZ.n3(px * 0.07 + k * 13, py * 0.07, pz * 0.07 - k * 5);
      if (resin > 0.32) c = resin > 0.58 ? 0x6a4420 : resin > 0.44 ? 0x8c5a2a : mix(c, 0x8c5a2a, 0.45); // resin-soaked patches
      if (inner && jj < 0.03) c = 0x6a2620; // old blood seeping through
      if (jj > 0.975) c = mulRGB(c, 0.78); // grit
      return c;
    };
    // band cells: a ~2-voxel shell over the body (upper layers ride over the lower wraps)
    const rowEnd0: number[] = [], rowEnd1: number[] = [];
    for (let row = 0; row <= wd.w + 1; row++) {
      rowEnd0.push((h3(row, k, 1, 41) - 0.5) * 0.24 + (row % 3 === 0 ? 0.07 : 0));
      rowEnd1.push((h3(row, k, 2, 42) - 0.5) * 0.24 + (row % 3 === 1 ? 0.08 : 0));
    }
    let endPt: V3 | null = null, endBest = -1;
    const [nx, ny, nz] = wd.n, [ux, uy, uz] = u, [vx, vy, vz] = v, [cx, cy, cz] = wd.c;
    const dMax = 2.5 + wd.layer * 2.0;
    for (const i of shell) {
      const d = sd[i];
      if (d > dMax || used[i]) continue;
      const z = Math.floor(i / sxy) + Z0, rem = i % sxy, y = Math.floor(rem / sx) + Y0, x = (rem % sx) + X0;
      {
          const px = x + 0.5, py = y + 0.5, pz = z + 0.5;
          const qx = px - cx, qy = py - cy, qz = pz - cz;
          const sn = qx * nx + qy * ny + qz * nz;
          if (Math.abs(sn) > half + 2) continue;
          const phi = Math.atan2(qx * vx + qy * vy + qz * vz, qx * ux + qy * uy + qz * uz);
          const s = sn + 0.9 * NZ.n2(phi * 2.2 + k * 7, k);
          if (Math.abs(s) > half + (h3(x, y, z, 43) < 0.12 ? 0.6 : 0)) continue; // ragged thread edges
          if (wd.span) {
            const row = clamp(Math.floor(s + half), 0, rowEnd0.length - 1);
            const dphi = wrapPi(phi - spanMid);
            if (dphi < -spanHalf - rowEnd0[row] || dphi > spanHalf + rowEnd1[row]) continue;
            if (dphi > endBest) {
              endBest = dphi;
              endPt = [px, py, pz];
            }
          }
          if (d > 2.5) {
            // upper layer only where it actually crosses a lower wrap
            let over = false;
            for (let dz = -sxy; dz <= sxy && !over; dz += sxy)
              for (let dy = -sx; dy <= sx && !over; dy += sx)
                for (let dx = -1; dx <= 1 && !over; dx++) if (used[i + dx + dy + dz]) over = true;
            if (!over) continue;
          }
          used[i] = k + 1;
          wm.set(x, y, z, linen(x, y, z, s, phi, d < 1.4), VF.SOFTAO);
      }
    }
    // loose tail: the strip peels off its end and hangs, fraying at the bottom
    if (wd.tail && endPt) {
      const E = endPt;
      const out = norm([E[0] - center[0], 0, E[2] - center[2]]);
      const len = k === 5 ? 20 : 13;
      for (let t = 0; t <= len; t += 0.5) {
        for (let jw = -half * 0.8; jw <= half * 0.8; jw += 0.5) {
          if (t > len - 3 && h3(Math.round(jw * 2), k, Math.round(t * 2), 44) < (t - (len - 3)) / 3.5) continue;
          const curl = Math.sin(t * 0.25 + k) * 1.6;
          for (let th = 0; th < 2; th++) {
            const px = E[0] + out[0] * (1.4 + t * 0.09 + th * 0.8) + wd.n[0] * jw * 0.9 + out[2] * curl * 0.3;
            const py = E[1] - t + wd.n[1] * jw * 0.3;
            const pz = E[2] + out[2] * (1.4 + t * 0.09 + th * 0.8) + wd.n[2] * jw * 0.9 - out[0] * curl * 0.3;
            const x = Math.floor(px), y = Math.floor(py), z = Math.floor(pz);
            if (!g.has(x, y, z)) continue;
            const i = g.idx(x, y, z);
            if (g.a[i] || used[i]) continue;
            used[i] = k + 1;
            wm.set(x, y, z, linen(x, y, z, jw, t * 0.3, false), VF.SOFTAO);
          }
        }
      }
      // a few dangling threads
      for (let tr = 0; tr < 4; tr++) {
        const jw = (h3(tr, k, 3, 45) - 0.5) * wd.w;
        const tl = 5 + Math.floor(h3(tr, k, 4, 46) * 9);
        for (let t = 0; t < tl; t++) {
          const x = Math.floor(E[0] + out[0] * 2.2 + wd.n[0] * jw + Math.sin(t * 0.7 + tr) * 0.6);
          const y = Math.floor(E[1] - len - 1 - t * 0.9);
          const z = Math.floor(E[2] + out[2] * 2.2 + wd.n[2] * jw);
          if (!g.has(x, y, z) || g.a[g.idx(x, y, z)] || used[g.idx(x, y, z)]) continue;
          used[g.idx(x, y, z)] = k + 1;
          wm.set(x, y, z, mix(0xd8caa4, 0xc0ad86, h3(x, y, z, 47)), VF.SOFTAO);
        }
      }
    }
    wraps.push({ model: wm, voxelSize: HUD_HEART_VS, pivot });
  });

  // vessel part pivots: where each main trunk leaves the muscle
  const rootOf = (v: Tube): V3 => {
    for (let si = 0; si < v.pts.length - 1; si++)
      for (let t = 0; t <= 1; t += 0.05) {
        const a = v.pts[si], bb = v.pts[si + 1];
        const pt: V3 = [a[0] + (bb[0] - a[0]) * t, a[1] + (bb[1] - a[1]) * t, a[2] + (bb[2] - a[2]) * t];
        if (body(pt[0], pt[1], pt[2]) > 0.6) return pt;
      }
    return v.pts[0];
  };
  const aortaRoot = rootOf(VESSELS[0]), pulmRoot = rootOf(VESSELS[4]), venaRoot = rootOf(VESSELS[7]);
  const b = heart.bounds();
  let minY = b.minY, maxY = b.maxY, minX = b.minX, maxX = b.maxX;
  for (const w of [...wraps, { model: aortaM }, { model: pulmM }, { model: venaM }]) {
    if (!w.model.count) continue;
    const wb = w.model.bounds();
    minY = Math.min(minY, wb.minY);
    maxY = Math.max(maxY, wb.maxY);
    minX = Math.min(minX, wb.minX);
    maxX = Math.max(maxX, wb.maxX);
  }
  const VS = HUD_HEART_VS;
  heartCache = {
    parts: {
      heart: { model: heart, voxelSize: VS, pivot },
      aorta: { model: aortaM, voxelSize: VS, pivot: aortaRoot },
      pulmonary: { model: pulmM, voxelSize: VS, pivot: pulmRoot },
      vena: { model: venaM, voxelSize: VS, pivot: venaRoot },
      wraps,
    },
    meta: {
      height: (maxY - minY + 1) * VS,
      width: (maxX - minX + 1) * VS,
      pivot,
      wrapAxes: WRAPS.map((w) => w.n),
      apex: H_APEX,
    },
  };
  return heartCache;
}

/**
 * The heart as a rig (RigInstance-ready): `heart` root (beat pivot at the rig origin),
 * children `aorta`, `pulmonary`, `vena` (pulse around their roots) and `wrap1`…`wrap6`
 * (share the beat pivot; unwind by rotating around meta.wrapAxes[i]).
 * displayVoxelSize overrides the real-scale voxel size (e.g. for the model viewer).
 */
export function hudHeartRig(displayVoxelSize?: number): RigSpec {
  const h = hudHeart();
  const P = h.meta.pivot;
  const parts: PartSpec[] = [{ name: 'heart', model: h.parts.heart.model, pivot: P, attach: [0, 0, 0] }];
  const child = (name: string, part: HudHeartPart) => parts.push({ name, model: part.model, pivot: part.pivot, parent: 'heart', attach: part.pivot });
  child('aorta', h.parts.aorta);
  child('pulmonary', h.parts.pulmonary);
  child('vena', h.parts.vena);
  h.parts.wraps.forEach((w, i) => w.model.count && child('wrap' + (i + 1), w));
  const vs = displayVoxelSize ?? HUD_HEART_VS;
  return {
    name: 'hud_heart',
    voxelSize: vs,
    parts,
    meta: { height: (h.meta.height / HUD_HEART_VS) * vs, wrapAxes: h.meta.wrapAxes, pivots: { heart: P, aorta: h.parts.aorta.pivot, pulmonary: h.parts.pulmonary.pivot, vena: h.parts.vena.pivot } },
  };
}

// =============================================================================
// viewer previews (display-scaled so the model viewer frames them nicely)
// =============================================================================
export function hudCylinderPreview(n = 6, loaded = false) {
  const c = hudCylinder(n);
  const m = c.model.clone();
  if (loaded) {
    const zr = CYL_L / 2;
    c.meta.chambers.forEach(([cx, cy], i) => {
      if (i === 2 || i === 4) return; // two empty chambers
      const r = hudRound(i === 1 ? 'venom' : 'brass', n);
      const ox = Math.round(cx / c.voxelSize), oy = Math.round(cy / c.voxelSize);
      r.model.forEach((x, y, z, col, f) => m.set(x + ox, y + oy, z + zr + 2, col, f));
    });
  }
  return { model: m, voxelSize: 1 / 60 };
}
export function hudRoundPreview() {
  const m = new VoxelModel('hud_round_preview');
  (['brass', 'venom', 'spent'] as HudRoundKind[]).forEach((k, i) => {
    const r = hudRound(k, 6);
    r.model.forEach((x, y, z, col, f) => m.set(x + (i - 1) * 30, y, z, col, f));
  });
  return { model: m, voxelSize: 1 / 60 };
}
export function hudHeartPreview(wraps = true) {
  const h = hudHeart();
  const m = h.parts.heart.model.clone();
  for (const v of [h.parts.aorta, h.parts.pulmonary, h.parts.vena]) v.model.forEach((x, y, z, col, f) => m.set(x, y, z, col, f));
  if (wraps) for (const w of h.parts.wraps) w.model.forEach((x, y, z, col, f) => m.set(x, y, z, col, f));
  return { model: m, voxelSize: 1 / 80 };
}
