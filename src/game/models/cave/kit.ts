// Shared sculpting helpers for the sand cave (models/cave/*): hexagonal glowing
// crystals that grow out of rock, flesh and membrane shaders, wet glints, and a
// meter-space "sheet" filler for wing membranes and fins.
import { Sc, M3, VF, mix, mulRGB, hash3, noise } from '../enemies/real/rk';
import type { ColorFn } from '../enemies/real/rk';

export interface CrystalPal {
  /** colour deep at the root (barely lit) */
  deep: number;
  mid: number;
  /** facet edges and the upper body */
  light: number;
  /** the bright core near the tip */
  core: number;
}

export const CRYSTAL: Record<'cyan' | 'violet' | 'teal' | 'rose', CrystalPal> = {
  cyan: { deep: 0x0b3d55, mid: 0x1592b8, light: 0x6fe8ff, core: 0xd4fcff },
  violet: { deep: 0x2c0f56, mid: 0x7a34c8, light: 0xc79bff, core: 0xf2e2ff },
  teal: { deep: 0x0a3a3a, mid: 0x14a090, light: 0x7af0d6, core: 0xdcfff4 },
  rose: { deep: 0x4a1236, mid: 0xb2407e, light: 0xff9ccc, core: 0xffe4f2 },
};

const norm = (v: M3): M3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const cross = (a: M3, b: M3): M3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/**
 * One hexagonal crystal (a six-sided prism with a pyramidal termination) growing from
 * `base` along `dir`, `len` long and `r` across the flats. Facet edges catch light,
 * a bright core rises toward the tip, faint growth bands ring the body, and everything
 * above the buried root glows (EMISSIVE). `tip` = share of the length that is the point.
 */
export function crystal(s: Sc, base: M3, dir: M3, len: number, r: number, pal: CrystalPal, o: { tip?: number; twist?: number; glow?: boolean; seed?: number } = {}) {
  const vs = s.vs;
  const d = norm(dir);
  const ref: M3 = Math.abs(d[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
  const u = norm(cross(d, ref));
  const w = cross(d, u);
  const tw = o.twist ?? hash3(base[0] * 31, base[1] * 17, base[2] * 7) * 1.0;
  const cu = Math.cos(tw), su = Math.sin(tw);
  const U: M3 = [u[0] * cu + w[0] * su, u[1] * cu + w[1] * su, u[2] * cu + w[2] * su];
  const W: M3 = [w[0] * cu - u[0] * su, w[1] * cu - u[1] * su, w[2] * cu - u[2] * su];
  const tipK = o.tip ?? 0.28;
  const seed = o.seed ?? 0;
  const R = r * 1.16 + vs;
  const end: M3 = [base[0] + d[0] * len, base[1] + d[1] * len, base[2] + d[2] * len];
  const lo: M3 = [Math.min(base[0], end[0]) - R, Math.min(base[1], end[1]) - R, Math.min(base[2], end[2]) - R];
  const hi: M3 = [Math.max(base[0], end[0]) + R, Math.max(base[1], end[1]) + R, Math.max(base[2], end[2]) + R];
  const S3 = Math.sqrt(3) / 2;
  const fl = (o.glow ?? true) ? VF.EMISSIVE | VF.SOFTAO : VF.SOFTAO;
  for (let i = s.i(lo[0]); i <= s.i(hi[0]); i++)
    for (let j = s.i(lo[1]); j <= s.i(hi[1]); j++)
      for (let k = s.i(lo[2]); k <= s.i(hi[2]); k++) {
        const px = (i + 0.5) * vs - base[0], py = (j + 0.5) * vs - base[1], pz = (k + 0.5) * vs - base[2];
        const t = (px * d[0] + py * d[1] + pz * d[2]) / len;
        if (t < -0.02 || t > 1) continue;
        const a = px * U[0] + py * U[1] + pz * U[2];
        const b = px * W[0] + py * W[1] + pz * W[2];
        // hexagon (flat-to-flat = 2r): max of the three axis projections
        const hx = Math.max(Math.abs(a), Math.abs(a * 0.5 + b * S3), Math.abs(a * 0.5 - b * S3));
        const taper = t > 1 - tipK ? (1 - t) / tipK : 1;
        const rr = r * (0.9 + 0.1 * (1 - t)) * taper;
        if (hx > rr + vs * 0.35) continue;
        // colour: root deep, body mid -> light upward, facet edges light, core toward the tip
        const edge = hx / Math.max(rr, 1e-4);
        const ang = Math.atan2(b, a);
        const corner = Math.abs(Math.cos(ang * 3));
        const band = Math.abs(Math.sin((t * len) / (vs * 5.5) + seed)) < 0.12 ? 0.82 : 1;
        let c = mix(pal.deep, pal.mid, Math.min(1, t * 2.2));
        c = mix(c, pal.light, Math.max(0, t - 0.35) * 1.1);
        if (corner > 0.93 && edge > 0.7) c = mix(c, pal.light, 0.65);
        if (t > 1 - tipK * 1.3) c = mix(c, pal.core, (t - (1 - tipK * 1.3)) / (tipK * 1.3));
        if (edge < 0.45 && t > 0.3) c = mix(c, pal.core, 0.35);
        const h = hash3(i + seed, j, k);
        if (h < 0.025) c = mix(c, 0xffffff, 0.5); // inclusions / glints
        c = mulRGB(c, band);
        s.m.set(i, j, k, c, t < 0.06 ? VF.SOFTAO : fl);
      }
}

/**
 * A spray of crystals fanning out of one point (`up` = the main growth direction):
 * a big central spire and smaller satellites leaning outward, all rooted in `c`.
 */
export function crystalSpray(s: Sc, c: M3, up: M3, size: number, pal: CrystalPal, seed: number, n = 6, o: { glow?: boolean; spread?: number } = {}) {
  const d = norm(up);
  const ref: M3 = Math.abs(d[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
  const u = norm(cross(d, ref));
  const w = cross(d, u);
  const spread = o.spread ?? 0.75;
  crystal(s, c, d, size, size * 0.17, pal, { seed, glow: o.glow });
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2 + hash3(seed, k, 3) * 0.9;
    const tilt = 0.35 + hash3(k, seed, 5) * spread;
    const dir: M3 = [d[0] + (u[0] * Math.cos(a) + w[0] * Math.sin(a)) * tilt, d[1] + (u[1] * Math.cos(a) + w[1] * Math.sin(a)) * tilt, d[2] + (u[2] * Math.cos(a) + w[2] * Math.sin(a)) * tilt];
    const L = size * (0.35 + hash3(k, 7, seed) * 0.45);
    const off = size * 0.06;
    const b: M3 = [c[0] + (u[0] * Math.cos(a) + w[0] * Math.sin(a)) * off, c[1] + (u[1] * Math.cos(a) + w[1] * Math.sin(a)) * off, c[2] + (u[2] * Math.cos(a) + w[2] * Math.sin(a)) * off];
    crystal(s, b, dir, L, L * (0.16 + hash3(k, 1, seed) * 0.06), pal, { seed: seed + k * 3, glow: o.glow });
  }
}

/** a wet-skin / flesh shader: broad mottling between three tones, fine pores, optional veins */
export function fleshC(base: number, light: number, dark: number, vs: number, seed = 0, o: { cell?: number; veins?: number; vein?: number; pores?: number } = {}): ColorFn {
  const cell = (o.cell ?? 0.12) / vs;
  const veins = o.veins ?? 0;
  const vein = o.vein ?? mix(dark, 0x6a4aa0, 0.4);
  const pores = o.pores ?? 0.03;
  return (x, y, z) => {
    const n = noise.n3(x / cell + seed, y / cell, z / cell - seed);
    let c = n > 0.32 ? mix(base, light, 0.6) : n < -0.38 ? mix(base, dark, 0.55) : base;
    if (veins > 0) {
      const v = Math.abs(noise.n3(x / (cell * 0.55) - seed * 2, y / (cell * 0.55), z / (cell * 0.55) + 3.1));
      if (v < 0.04 * veins) c = mix(c, vein, 0.45);
    }
    const h = hash3(x + seed, y * 3, z);
    if (h < pores) c = mulRGB(c, 0.9);
    else if (h > 1 - pores * 0.6) c = mix(c, light, 0.4);
    return c;
  };
}

/** leathery bat membrane: thin dark skin, lighter veins radiating along `axis` lines, warmer near the edges */
export function membraneC(base: number, vein: number, vs: number, seed = 0): ColorFn {
  const cell = 0.05 / vs;
  return (x, y, z) => {
    const n = noise.n3(x / cell + seed, y / cell, z / (cell * 0.7));
    const v = Math.abs(noise.n3(x / (cell * 2.2) - seed, y / (cell * 2.2), z / (cell * 0.5)));
    let c = n > 0.4 ? mulRGB(base, 1.12) : n < -0.45 ? mulRGB(base, 0.85) : base;
    if (v < 0.035) c = mix(c, vein, 0.55);
    if (hash3(x, y + seed, z) < 0.02) c = mulRGB(c, 0.8);
    return c;
  };
}

/** point-in-polygon on the XZ plane (meters) */
export function inPoly(px: number, pz: number, poly: [number, number][]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if (zi > pz !== zj > pz && px < ((xj - xi) * (pz - zi)) / (zj - zi + 1e-12) + xi) inside = !inside;
  }
  return inside;
}

/**
 * A thin sheet (membrane, fin) filling a polygon in the XZ plane, lifted to
 * y = height(x, z). Two voxels thick where it is steep so it never shows holes.
 */
export function sheetXZ(s: Sc, poly: [number, number][], height: (x: number, z: number) => number, col: ColorFn | number, fl?: number) {
  const vs = s.vs;
  let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
  for (const [x, z] of poly) {
    x0 = Math.min(x0, x);
    x1 = Math.max(x1, x);
    z0 = Math.min(z0, z);
    z1 = Math.max(z1, z);
  }
  for (let i = s.i(x0); i <= s.i(x1); i++)
    for (let k = s.i(z0); k <= s.i(z1); k++) {
      const x = (i + 0.5) * vs, z = (k + 0.5) * vs;
      if (!inPoly(x, z, poly)) continue;
      const y = height(x, z);
      const yn = Math.max(height(x + vs, z), height(x - vs, z), height(x, z + vs), height(x, z - vs));
      const ym = Math.min(height(x + vs, z), height(x - vs, z), height(x, z + vs), height(x, z - vs));
      const j0 = s.i(Math.min(y, (y + ym) / 2)), j1 = s.i(Math.max(y, (y + yn) / 2));
      for (let j = j0; j <= Math.max(j0, j1); j++) s.m.set(i, j, k, col, fl);
    }
}

/**
 * A thin sheet in the YZ plane (dorsal / ventral fins): filled between yLo(z) and
 * yHi(z) at x = xAt(z), `th` meters thick.
 */
export function finYZ(s: Sc, z0: number, z1: number, yLo: (z: number) => number, yHi: (z: number) => number, xAt: (z: number) => number, col: ColorFn | number, th: number, fl?: number) {
  const vs = s.vs;
  for (let k = s.i(Math.min(z0, z1)); k <= s.i(Math.max(z0, z1)); k++) {
    const z = (k + 0.5) * vs;
    const a = yLo(z), b = yHi(z);
    if (b <= a) continue;
    const xc = xAt(z);
    for (let j = s.i(a); j <= s.i(b); j++)
      for (let i = s.i(xc - th / 2); i <= s.i(xc + th / 2 - 1e-6); i++) s.m.set(i, j, k, col, fl);
  }
}

/** a few wet highlight voxels on the upward-facing surface (glossy damp skin, slick rock) */
export function wetGlints(s: Sc, chance: number, col = 0xffffff, seed = 0, pred: (x: number, y: number, z: number) => boolean = () => true) {
  const m = s.m;
  const todo: [number, number, number, number][] = [];
  m.forEach((x, y, z, c) => {
    if (m.has(x, y + 1, z)) return;
    if (hash3(x * 7 + seed, y * 3, z * 5) > chance) return;
    if (!pred(x, y, z)) return;
    todo.push([x, y, z, mix(c, col, 0.55)]);
  });
  for (const [x, y, z, c] of todo) m.set(x, y, z, c, VF.SOFTAO);
}

export { norm as norm3, cross as cross3 };
