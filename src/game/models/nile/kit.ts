// Nile army kit: the shared body, eyes, armour, cloth and weapons that dress
// Cleopatra's animal-human soldiers. Everything is sculpted on Sundown's bone
// figure (figure/fig.ts, 1/36 grid, geometric voxel coords, faces +Z, LEFT = +X)
// so the horde's procedural humanoid animation fits every soldier.
//
// Materials: Egyptian arsenal bronze (warm, a verdigris accent in the recesses),
// pleated linen, red-brown rawhide and leather, gold, lapis, turquoise and
// carnelian inlay. Fur, hide and feathers are broad tonal patches that run along
// the grain (the voxel detail pass lays the fine pixel texture on top).
import {
  Fig, G, Sc, VoxelModel, VF, mix, mulRGB, noise, hash3, ell, sections, limbG, coatG, cutG, isSurf, wrapShell, lineG, hornG, tube, furC, clothC, leatherC, frayStrip,
} from '../enemies/figure/fig';
import type { CSpec, ColorFn } from '../enemies/figure/fig';
import { METAL, frontZ, usekhG } from '../enemies/figure/gear';

export { METAL, frontZ, usekhG };

export const NILE = {
  bronze: [0xb87e3c, 0x8a5a2a, 0xe2aa62] as number[],
  darkBronze: [0x8a5e2e, 0x664220, 0xb4844a] as number[],
  patina: 0x4f8a72,
  gold: METAL.gold,
  lapis: 0x23439a,
  lapisHi: 0x3a62c4,
  turq: 0x2e9a8a,
  carnelian: 0xb8322a,
  linen: 0xefe4c8,
  linenShade: 0xd6c8a6,
  linenHi: 0xfbf4e2,
  rawhide: 0x8a4e2a,
  leather: 0x6a3e20,
  leatherDark: 0x3e2414,
  wood: 0x8a5a32,
  woodDark: 0x5a3a1e,
  ink: 0x120c0a,
  ivory: 0xf2e6c8,
  ivoryShade: 0xd2c09a,
  red: 0xa8281e,
};

export const res = (c: CSpec, x: number, y: number, z: number) => (typeof c === 'number' ? c : ((c as ColorFn)(x, y, z) as number));
/** geometric mirror for side s (+1 left, -1 right) */
export const XS = (s: number, x: number) => s * x;
/** voxel-index mirror for side s */
export const XI = (s: number, i: number) => (s > 0 ? i : -1 - i);

/** the jackal-built muscular trunk profile (half width, front z, back z) per voxel row */
const JT: Record<number, [number, number, number]> = {
  28: [5.2, 2.0, -5.5], 29: [5.3, 2.2, -5.6], 30: [5.5, 2.4, -5.6], 31: [5.8, 2.7, -5.7], 32: [6.2, 3.0, -5.7], 33: [6.6, 3.4, -5.8],
  34: [6.9, 3.8, -5.8], 35: [7.2, 4.1, -5.8], 36: [7.4, 4.4, -5.9], 37: [7.6, 4.6, -5.9], 38: [7.8, 4.8, -5.9], 39: [7.9, 4.9, -5.9],
  40: [8.0, 4.9, -5.9], 41: [8.0, 4.8, -5.8], 42: [7.8, 4.4, -5.7], 43: [7.3, 3.4, -5.5], 44: [5.8, 1.9, -5.0], 45: [3.9, 1.1, -4.6],
  46: [3.2, 0.9, -4.4], 47: [3.0, 0.8, -4.3],
};

// ============================================================================ colour functions
/** overlapping bronze scales: staggered 3 x 2 cells, a lit lip on top of every scale and a dark gap */
export function scalesC(c: number[] = NILE.bronze, seed = 0, patina = NILE.patina): ColorFn {
  return (x, y, z) => {
    const row = Math.floor(y / 2);
    const u = x + z + (row & 1) * 1.5 + seed;
    const cell = ((Math.floor(u / 3) % 97) + 97) % 97;
    const lu = ((u % 3) + 3) % 3;
    const top = ((y % 2) + 2) % 2 === 1;
    if (lu < 0.6) return top ? c[0] : mix(c[1], 0x2a1808, 0.35);
    if (hash3(cell, row, seed) > 0.93) return patina;
    return top ? c[2] : hash3(cell, row, seed + 3) > 0.7 ? c[1] : c[0];
  };
}
/** pleated linen with soft vertical folds (period 2) and the odd stain */
export function pleatsC(base = NILE.linen, seed = 0): ColorFn {
  return (x, y, z) => {
    const st = noise.n3(x / 4 + seed, y / 5, z / 4 - seed);
    if (st < -0.55) return mix(base, 0x9a8460, 0.28);
    return ((x + z) & 1) === 0 ? base : mix(base, NILE.linenShade, 0.7);
  };
}
/** spotted cowhide (shield faces): broad irregular patches */
export function cowhideC(seed = 0, dark = 0x3a2418, light = 0xf0e6d2, mid = 0xa86a3a): ColorFn {
  return (x, y, z) => {
    const n = noise.n3(x / 4.2 + seed, y / 4.6 - seed, z / 4.2 + seed * 0.7);
    const k = noise.n3(x / 2.1 - seed, y / 2.3, z / 2.1 + 3.1);
    return n > 0.28 ? (k > 0.5 ? mid : dark) : n < -0.42 ? mid : light;
  };
}
/** feathers: overlapping scalloped rows (a darker tip under every feather, a lit vane), optional barring */
export function featherC(base: number, dark: number, light: number, seed = 0, bar = 0): ColorFn {
  const tipC = mix(base, dark, 0.7), edgeC = mix(base, dark, 0.3), hiC = mix(base, light, 0.55);
  return (x, y, z) => {
    const row = Math.floor((y + seed) / 2);
    const u = (((x + z + (row & 1) * 1.5) % 3) + 3) % 3;
    const v = (((y + seed) % 2) + 2) % 2;
    let c = base;
    if (v === 0 && u >= 1 && u < 2) c = tipC;
    else if (u < 1) c = edgeC;
    else if (v === 1 && u >= 2) c = hiC;
    if (bar && ((row % 4) + 4) % 4 === 0) c = mix(c, dark, 0.35);
    return c;
  };
}
/** soft fur: the light / dark tones pulled halfway to the base, broad patches running down the body */
export function softFur(base: number, light: number, dark: number, seed = 0): ColorFn {
  const L = mix(base, light, 0.5), D = mix(base, dark, 0.45);
  return (x, y, z) => {
    const n = noise.n3(x / 4.2 + seed, y / 6.5, z / 4.2 - seed);
    const s = noise.n3(x / 2.4, y / 5.2 + seed, z / 2.4);
    return s > 0.6 ? L : n < -0.42 ? D : n > 0.46 ? L : base;
  };
}
/** wrinkled hide (hippo): broad tonal patches and folds running across the limb */
export function wrinkleC(base: number, seed = 0, fold = 0x000000, pink?: number): ColorFn {
  const dark = mix(base, 0x140c10, 0.16), light = mix(base, 0xd8c8c8, 0.12), crease = mix(base, fold || 0x140c10, 0.24);
  return (x, y, z) => {
    const n = noise.n3(x / 5 + seed, y / 6 - seed, z / 5);
    const w = noise.n3(x / 2.4, y / 1.2 + seed, z / 2.4);
    if (Math.abs(w) < 0.03) return crease;
    if (pink !== undefined && n < -0.5) return mix(base, pink, 0.3);
    return n > 0.45 ? light : n < -0.38 ? dark : base;
  };
}

// ============================================================================ the body
export interface BeastSpec {
  seed: number;
  fur: CSpec;
  belly: CSpec;
  /** claws, pads, creases */
  dark: number;
  /** trunk width and limb thickness (1 = the jackal build) */
  bulk?: number;
  /** belly forward (voxels) */
  paunch?: number;
  legs: 'digi' | 'pillar' | 'bird' | 'hoof';
  /** colour of the bare lower leg / foot (bird scales, hooves) */
  foot?: CSpec;
  nail?: number;
  hand?: CSpec;
  tail?: 'bushy' | 'tuft' | 'feather' | 'stub' | 'none';
  tailCol?: CSpec;
  /** thicker fur ruff / mane over the shoulders and nape */
  mane?: CSpec;
}

export interface BodyOut {
  /** how far the arms sit outward (voxels) */
  dx: number;
  /** the fists (geometric, left / right) */
  handL: G;
  handR: G;
}

/** mirrored copy shifted along x */
function shifted(m: VoxelModel, dx: number, name: string) {
  const o = new VoxelModel(name);
  m.forEach((x, y, z, c, f) => o.set(x + dx, y, z, c, f));
  return o;
}

/** a furred / hided humanoid beast on the figure (head left bare for the species sculptor) */
export function beastBody(F: Fig, B: BeastSpec): BodyOut {
  const bulk = B.bulk ?? 1;
  const fk = 1 + (bulk - 1) * 0.9, bk = 1 + (bulk - 1) * 0.6;
  const dx = Math.round((bulk - 1) * 7);
  const fur = B.fur;
  F.boneMirror('fore_r', 'fore_l'); // two fists
  // ---------------------------------------------------------------- trunk
  const tr = F.s('torso');
  tr.m.map.clear();
  const pa = B.paunch ?? 0;
  sections(tr, 28, 47, (y) => {
    const r = JT[Math.floor(y)];
    if (!r) return null;
    const bump = pa * Math.max(0, Math.sin(((y - 27) / 12) * Math.PI));
    return { a: r[0] * bulk + bump * 0.35, f: r[1] * fk + bump, b: r[2] * bk, p: 2.3 };
  }, fur);
  coatG(tr, (x, y, z) => z > 1.5 && Math.abs(x) < 4.2 * bulk && y > 29 && y < 43, B.belly);
  for (const s of [1, -1]) ell(tr, [s * 3.6 * bulk, 39.4, 3.6 * fk], [3.0 * bulk, 2.2, 1.4], fur);
  if (B.mane) {
    // a heavy ruff over the nape and shoulders
    ell(tr, [0, 45.2, -2.2], [5.6 * bulk, 3.2, 4.6 * bk], B.mane);
    for (const s of [1, -1]) ell(tr, [s * 5.4 * bulk, 43.0, -1.6], [3.0, 2.6, 3.8], B.mane);
  }
  const pv = F.s('pelvis');
  pv.m.map.clear();
  sections(pv, 20, 29, (y) => ({ a: (5.6 + Math.min(1, (y - 20) / 4) * 1.0) * bulk, f: 2.4 * fk + pa * 0.25, b: -5.6 * bk, p: 2.4 }), fur);
  // ---------------------------------------------------------------- limbs
  const ax = 8.6 + dx;
  for (const s1 of [1, -1]) {
    const X = (x: number) => s1 * x;
    if (s1 < 0) {
      F.boneMirror('arm_l', 'arm_r');
      F.boneMirror('thigh_l', 'thigh_r');
      F.boneMirror('shin_l', 'shin_r');
    }
    const a = F.s(s1 > 0 ? 'arm_l' : 'arm_r');
    ell(a, [X(ax), 41.3, 0.0], [2.45 * bulk, 2.6, 2.45 * bulk], fur);
    limbG(a, [X(ax), 40.0, 0.0], [X(ax - 0.1), 34.6, 0.1], (t) => (2.1 - 0.3 * t) * bulk, fur);
    ell(a, [X(ax - 0.1), 37.6, 1.0], [1.4 * bulk, 2.1, 1.0 * bulk], fur);
    ell(a, [X(ax - 0.1), 33.9, -0.1], [2.0 * bulk, 1.25, 1.7 * bulk], fur);
    const fn = s1 > 0 ? 'fore_l' : 'fore_r';
    if (dx) F.setModel(fn, shifted(F.m(fn), s1 * dx, fn));
    const f = F.s(fn);
    f.m.forEach((x, y, z) => {
      if (y >= 25) f.m.set(x, y, z, res(fur, x, y, z));
    });
    ell(f, [X(ax - 0.1), 31.9, -0.3], [1.95 * bulk, 1.25, 1.7 * bulk], fur);
    limbG(f, [X(ax), 31.4, -0.1], [X(ax + 0.3), 25.6, 0.0], (t) => (1.9 - 0.45 * t) * bulk, fur);
    const hand = B.hand ?? fur;
    const nail = B.nail ?? B.dark;
    f.m.forEach((x, y, z, c) => {
      if (y < 25) f.m.set(x, y, z, z === 2 && y <= 21 ? nail : mix(c & 0xffffff, res(hand, x, y, z), 0.8));
    });
    if (bulk > 1.05) ell(f, [X(ax + 0.3), 22.4, 0.2], [1.9 * bulk, 2.0, 1.9], hand); // a heavier paw
    // ---------------------------------------------------------------- legs
    const th = F.s(s1 > 0 ? 'thigh_l' : 'thigh_r');
    const sh = F.s(s1 > 0 ? 'shin_l' : 'shin_r');
    sh.m.map.clear();
    const lx = 3.8 + (bulk - 1) * 2.2;
    if (B.legs === 'pillar') {
      limbG(th, [X(lx), 23.4, 0.1], [X(lx - 0.2), 17.2, 0.3], (t) => (2.9 - 0.4 * t) * bulk, fur);
      ell(th, [X(lx - 0.2), 20.6, -1.2], [2.0 * bulk, 2.8, 1.6 * bulk], fur);
      ell(th, [X(lx - 0.2), 16.6, 0.4], [2.2 * bulk, 1.5, 2.1 * bulk], fur);
      ell(sh, [X(lx - 0.2), 14.6, 0.3], [2.2 * bulk, 1.5, 2.1 * bulk], fur);
      limbG(sh, [X(lx - 0.2), 14.0, 0.0], [X(lx - 0.1), 3.4, 0.4], (t) => (2.3 - 0.2 * t + Math.sin(t * Math.PI) * 0.3) * bulk, fur);
      const ft = B.foot ?? fur;
      ell(sh, [X(lx), 1.7, 1.2], [2.6 * bulk, 1.8, 3.0 * bulk], ft);
      for (let k = 0; k < 4; k++) {
        const xx = Math.floor(X(lx - 1.6 * bulk + k * 1.1 * bulk));
        const zz = Math.round(1.2 + 3.0 * bulk) - (k === 0 || k === 3 ? 1 : 0);
        sh.m.set(xx, 0, zz, nail).set(xx, 1, zz, nail).set(xx, 0, zz - 1, mulRGB(nail, 0.8));
      }
    } else if (B.legs === 'bird') {
      // feathered "trousers" to the knee, then a bare scaled tarsus on a four-toed taloned foot
      limbG(th, [X(lx), 23.4, 0.1], [X(lx - 0.2), 16.6, 0.4], (t) => 2.7 - 0.2 * t, fur);
      ell(th, [X(lx - 0.2), 20.6, -1.2], [1.8, 2.6, 1.4], fur);
      for (let y = 14; y <= 16; y++) for (let k = -2; k <= 2; k++) th.m.set(Math.floor(X(lx - 0.2 + k * 0.9)), y, (y + k) & 1 ? 2 : 1, res(fur, k, y, 0));
      const sc = B.foot ?? 0xd8a628;
      ell(sh, [X(lx - 0.2), 14.4, 0.4], [1.7, 1.3, 1.6], fur);
      limbG(sh, [X(lx - 0.2), 13.6, 0.2], [X(lx - 0.1), 2.4, 0.6], (t) => 1.25 - 0.15 * t, sc);
      for (let y = 4; y <= 12; y += 3) wrapShell(sh, y, y, mulRGB(res(sc, 0, y, 0), 0.9), (x, yy, z) => Math.abs(x - X(lx - 0.15)) < 2.3 && Math.abs(z - 0.5) < 2.3);
      for (const [ddx, dz, len] of [[-1.1, 1, 4], [0, 1, 5], [1.1, 1, 4], [0, -1, 2.5]] as number[][]) {
        const fx = X(lx - 0.1 + ddx);
        const tip: G = [fx + ddx * 0.6, 0.6, 0.6 + dz * len];
        limbG(sh, [X(lx - 0.1), 1.4, 0.6], tip, (t) => 0.9 - 0.3 * t, sc);
        hornG(sh, tip, [0, -0.6, dz], 1.6, 0.6, B.nail ?? NILE.ink, [0, -0.8, 0]);
      }
    } else {
      // digitigrade: knee -> raised hock -> long metatarsal -> padded paw or cloven hoof
      limbG(th, [X(lx), 23.4, 0.1], [X(lx - 0.2), 17.2, 0.2], (t) => (2.6 - 0.55 * t) * bulk, fur);
      ell(th, [X(lx - 0.2), 20.8, -1.3], [1.8 * bulk, 2.6, 1.3 * bulk], fur);
      ell(th, [X(lx - 0.2), 16.7, 0.4], [1.9 * bulk, 1.3, 1.8 * bulk], fur);
      ell(sh, [X(lx - 0.2), 14.6, 0.3], [1.95 * bulk, 1.3, 1.8 * bulk], fur);
      limbG(sh, [X(lx - 0.2), 14.0, -0.2], [X(lx - 0.2), 6.6, -2.0], (t) => (1.85 - 0.5 * t) * bulk, fur);
      ell(sh, [X(lx - 0.2), 6.0, -2.4], [1.15 * bulk, 1.2, 1.15], typeof fur === 'number' ? mulRGB(fur, 0.8) : B.dark);
      limbG(sh, [X(lx - 0.1), 6.0, -1.9], [X(lx + 0.1), 1.8, 2.0], (t) => (1.3 - 0.25 * t) * bulk, fur);
      if (B.legs === 'hoof') {
        const hf = B.foot ?? 0x2a2420;
        ell(sh, [X(lx + 0.1), 1.0, 2.6], [1.7, 1.1, 1.9], hf);
        for (let y = 0; y <= 2; y++) for (let z = 2; z <= 5; z++) sh.m.del(Math.floor(X(lx + 0.1)), y, z); // the cleft
        for (let k = -1; k <= 1; k++) sh.m.set(Math.floor(X(lx + 0.1 + k)), 2, 1, mulRGB(res(hf, 0, 2, 1), 1.4));
      } else {
        ell(sh, [X(lx + 0.1), 1.1, 3.0], [2.0, 1.15, 2.1], fur);
        for (let k = 0; k < 4; k++) {
          const x = X(lx - 1.3 + k);
          sh.m.set(Math.floor(x), 0, 5, B.dark).set(Math.floor(x), 0, 6, B.nail ?? NILE.ink).set(Math.floor(x), 1, 5, B.dark);
        }
      }
    }
    cutG(sh, (_x, y) => y < 0);
  }
  // ---------------------------------------------------------------- tail
  const tc = B.tailCol ?? fur;
  if (B.tail === 'bushy') {
    const tl = F.part('tail', 'pelvis', [0, 25.5, -5.5]);
    tube(tl, [[0, 25.5, -6.0], [0, 23.0, -8.6], [0, 18.5, -10.6], [0, 13.0, -11.0], [0, 9.5, -10.2]], (t) => 1.2 + Math.sin(Math.min(1, t * 1.4) * Math.PI) * 1.3 - t * 0.5, tc);
  } else if (B.tail === 'tuft') {
    const tl = F.part('tail', 'pelvis', [0, 25.5, -5.5]);
    tube(tl, [[0, 25.5, -6.0], [0, 24.5, -9.5], [0, 21.0, -12.0], [0, 16.0, -12.5], [0, 12.5, -11.4]], (t) => 0.95 - t * 0.35, tc);
    ell(tl, [0, 11.8, -11.2], [1.4, 2.0, 1.4], mulRGB(res(tc, 0, 12, -11), 0.75));
  } else if (B.tail === 'feather') {
    const tl = F.part('tail', 'pelvis', [0, 23.5, -5.5]);
    for (let k = -3; k <= 3; k++) {
      const x0 = k * 1.2;
      tube(tl, [[x0 * 0.4, 23.5, -6.2], [x0 * 0.8, 18.5, -7.6 - Math.abs(k) * 0.1], [x0, 12.0 + Math.abs(k) * 0.8, -8.2]], (t) => 0.75 - t * 0.15, tc);
    }
  } else if (B.tail === 'stub') {
    const tl = F.part('tail', 'pelvis', [0, 24.5, -6.0]);
    tube(tl, [[0, 24.5, -6.4], [0, 22.0, -8.0], [0, 19.0, -8.6]], (t) => 1.1 - t * 0.5, tc);
    for (let k = -1; k <= 0; k++) tl.m.set(k, 18, -9, B.dark).set(k, 17, -9, B.dark);
  }
  return { dx, handL: [9 + dx, 21.5, 0], handR: [-9 - dx, 21.5, 0] };
}

// ============================================================================ the head
/** clear the figure's skull, jaw and brows for a species sculpt */
export function clearHead(F: Fig) {
  for (const n of ['head', 'jaw', 'brow_l', 'brow_r', 'eye_l', 'eye_r']) F.s(n).m.map.clear();
  return { hd: F.s('head'), jw: F.s('jaw') };
}

export interface EyeSpec {
  /** inner (nose-side) voxel column of the LEFT eye, row of its lower line, front z */
  x0: number;
  y0: number;
  z: number;
  w: number;
  h: number;
  iris: number;
  /** pupil shape: round dot, vertical slit, horizontal bar (goats) */
  pupil?: 'round' | 'slit' | 'bar';
  /** the ring / lid line colour */
  lid?: number;
  /** sideways eyes (birds, ruminants): the eye looks out along x */
  side?: boolean;
}

/**
 * Real modelled eyes: a socket carved into the head, a dark wet back, an iris
 * with a darker lower half, a pupil and a catch-light, framed by a lid line.
 * Writes eye_l / eye_r (mirrored) and returns nothing.
 */
export function eyes(F: Fig, E: EyeSpec) {
  const hd = F.s('head');
  const lid = E.lid ?? 0x140c0a;
  for (const s of [1, -1]) {
    const name = s > 0 ? 'eye_l' : 'eye_r';
    const m = new VoxelModel(name);
    for (let i = 0; i < E.w; i++)
      for (let j = 0; j < E.h; j++) {
        const x = XI(s, E.x0 + i), y = E.y0 + j;
        const z = E.z;
        // the socket
        hd.m.del(x, y, z);
        hd.m.del(x, y, z + 1);
        hd.m.set(x, y, z - 1, 0x0c0806);
        const corner = (i === 0 || i === E.w - 1) && (j === 0 || j === E.h - 1);
        const pi = Math.floor((E.w - 1) / 2);
        const pj = Math.floor((E.h - 1) / 2);
        let c = j < E.h / 2 ? mulRGB(E.iris, 0.72) : E.iris;
        const pup = E.pupil ?? 'round';
        if (pup === 'round' && i === pi && j === pj) c = 0x060404;
        if (pup === 'slit' && i === pi) c = 0x060404;
        if (pup === 'bar' && j === pj && i >= pi - 1 && i <= pi + 1 && E.w >= 4) c = 0x060404;
        if (pup === 'bar' && j === pj && E.w < 4 && i === pi) c = 0x060404;
        if (corner) c = lid;
        const glint = j === E.h - 1 && i === Math.min(E.w - 2, pi + 1) && !corner;
        m.set(x, y, z, glint ? 0xf4ead6 : c);
      }
    F.setModel(name, m);
  }
}

/** brow ridges over the eyes (the expression rotates them) */
export function brows(F: Fig, x0: number, x1: number, y: number, z: number, col: CSpec, thick = 1) {
  for (const s of [1, -1]) {
    const b = F.s(s > 0 ? 'brow_l' : 'brow_r');
    for (let i = x0; i <= x1; i++)
      for (let t = 0; t < thick; t++) {
        const X = XI(s, i);
        b.m.set(X, y, z + t, res(col, X, y, z + t));
        if (i > x0 && i < x1 && t === 0) b.m.set(X, y + 1, z - 1, res(col, X, y + 1, z - 1));
      }
  }
}

/** the head's highest voxel + 1 */
export function headTop(F: Fig, min = 62) {
  let top = min;
  for (const n of ['head', 'hat']) if (F.has(n)) F.m(n).forEach((_x, y) => (top = Math.max(top, y + 1)));
  return top;
}

// ============================================================================ armour & cloth
/** pleated linen kilt (shendyt): belt, hip wrap, front panels riding the thighs, the swaying back panel */
export function kilt(F: Fig, o: { seed: number; belt?: CSpec; beltY?: number; long?: boolean; stripe?: number; bulk?: number; panel?: CSpec; hem?: number } = { seed: 0 }) {
  const lin = pleatsC(NILE.linen, o.seed);
  const pv = F.s('pelvis');
  wrapShell(pv, 21, 27, lin);
  const by = o.beltY ?? 27;
  const belt = o.belt ?? ((x: number) => ((x & 3) === 1 ? NILE.lapis : METAL.gold[0]));
  pv.m.forEach((x, y, z) => {
    if (y === by && isSurf(pv.m, x, y, z)) pv.m.set(x, y, z, res(belt, x, y, z), res(belt, x, y, z) === METAL.gold[0] ? VF.METAL : VF.SOLID);
    if (y === by - 1 && isSurf(pv.m, x, y, z) && o.stripe !== undefined) pv.m.set(x, y, z, o.stripe);
  });
  const bk = o.bulk ?? 1;
  const cp = F.part('coat', 'pelvis', [0, 27, -6.5 * bk]);
  const lo = o.long ? 9 : 14;
  for (let y = lo; y <= 26; y++) for (let x = Math.floor(-7 * bk); x < Math.ceil(7 * bk); x++) cp.m.set(x, y, Math.round(-8 * bk) + (y < 20 ? 1 : 0), res(lin, x, y, 0));
  for (let x = Math.floor(-7 * bk); x < Math.ceil(7 * bk); x++) cp.m.set(x, lo, Math.round(-8 * bk) + 1, NILE.linenShade);
  for (const s1 of [1, -1]) {
    const th = F.s(s1 > 0 ? 'thigh_l' : 'thigh_r');
    let zf = -99;
    for (const dx of [-1, 0, 1, 2, 3, 4, 5]) zf = Math.max(zf, frontZ(th.m, s1 > 0 ? dx : -1 - dx, 20));
    zf += 1;
    for (let y = o.long ? 11 : 15; y <= 23; y++)
      for (let x = 0; x <= Math.round(5 * bk); x++) {
        const X = s1 > 0 ? x : -1 - x;
        const apron = x <= 1;
        if (o.panel !== undefined) th.m.set(X, y, zf, res(o.panel, X, y, zf));
        else th.m.set(X, y, zf, apron ? (y & 1 ? NILE.lapis : METAL.gold[0]) : res(lin, X, y, zf), apron && !(y & 1) ? VF.METAL : VF.SOLID);
      }
    for (let x = 0; x <= Math.round(5 * bk); x++) th.m.set(s1 > 0 ? x : -1 - x, o.long ? 11 : 15, zf, o.hem ?? NILE.linenShade, o.hem !== undefined && o.hem === NILE.bronze[0] ? VF.METAL : VF.SOLID);
  }
}

/** bronze scale corselet over the trunk between rows y0..y1 (sleeveless), shoulder straps of rawhide */
export function corselet(F: Fig, o: { y0?: number; y1?: number; metal?: number[]; seed?: number; trim?: number; front?: boolean } = {}) {
  const tr = F.s('torso');
  const y0 = o.y0 ?? 30, y1 = o.y1 ?? 42;
  const sc = scalesC(o.metal ?? NILE.bronze, o.seed ?? 0);
  wrapShell(tr, y0, y1, sc, () => true, VF.METAL);
  // rawhide edging at the hem and neckline
  const trim = o.trim ?? NILE.rawhide;
  tr.m.forEach((x, y, z, _c, f) => {
    if ((y === y0 || y === y1) && f & VF.METAL && isSurf(tr.m, x, y, z)) tr.m.set(x, y, z, trim);
  });
  // shoulder straps
  for (const s of [1, -1]) for (let z = -5; z <= 4; z++) for (let x = 4; x <= 6; x++) {
    const X = XI(s, x);
    let top = -99;
    for (let y = 48; y >= y1; y--) if (tr.m.has(X, y, z)) {
      top = y;
      break;
    }
    if (top > y1 && top < 47) tr.m.set(X, top + 1, z, x === 5 ? NILE.rawhide : NILE.leatherDark);
  }
}

/** a band of metal around a limb part between rows (bracers, greaves, armlets) */
export function bandG(s: Sc, y0: number, y1: number, col: CSpec, metal = true) {
  wrapShell(s, y0, y1, col, () => true, metal ? VF.METAL : VF.SOLID);
}

/** leather war belt with a bronze buckle plate at the front */
export function warBelt(F: Fig, y: number, o: { leather?: number; plate?: number[] } = {}) {
  const pv = F.s('pelvis');
  const L = o.leather ?? NILE.rawhide;
  wrapShell(pv, y, y + 1, (x, yy, z) => (z > 1 && Math.abs(x + 0.5) < 2.2 ? (o.plate ?? NILE.bronze)[yy === y ? 0 : 2] : (x + yy) % 5 === 0 ? mulRGB(L, 0.75) : L));
}

/** striped linen nemes over the cranium with lappets on the chest (part `hat`) */
export function nemes(F: Fig, o: { y0: number; y1: number; hx: number; zb: number; zf: number; c1?: number; c2?: number; lappets?: boolean; earGap?: [number, number] }) {
  const hat = F.part('hat', 'head', [...F.J.hat] as G);
  const c1 = o.c1 ?? METAL.gold[0], c2 = o.c2 ?? NILE.lapis;
  const col = (y: number) => (y & 1 ? c1 : c2);
  for (let y = o.y0; y <= o.y1; y++) {
    const k = (y - o.y0) / Math.max(1, o.y1 - o.y0);
    const hx = o.hx * (1 - Math.max(0, k - 0.7) * 1.2);
    for (let x = Math.floor(-hx) - 1; x <= Math.ceil(hx); x++)
      for (let z = Math.floor(o.zb) - 1; z <= Math.ceil(o.zf); z++) {
        const ax = Math.abs(x + 0.5);
        const zz = (z + 0.5 - (o.zb + o.zf) / 2) / ((o.zf - o.zb) / 2);
        const r = (ax / hx) ** 2.2 + Math.abs(zz) ** 2.2;
        if (r > 1 || r < 0.55) continue;
        if (z > (o.zf + o.zb) / 2 + 1 && y < o.y1 - 3 && ax < hx - 1.4) continue; // the face stays open
        if (o.earGap && ax > o.earGap[0] && ax < o.earGap[1] && y > o.y1 - 4 && z >= -4 && z <= 0) continue;
        hat.m.set(x, y, z, col(y), col(y) === c1 && c1 === METAL.gold[0] ? VF.METAL : VF.SOLID);
      }
  }
  if (o.lappets)
    for (const s of [1, -1])
      for (let y = o.y0 - 10; y <= o.y0; y++)
        for (let x = Math.round(o.hx - 2); x <= Math.round(o.hx - 1); x++)
          for (let z = 0; z <= 3; z++) hat.m.set(XI(s, x), y, z, col(y), col(y) === c1 && c1 === METAL.gold[0] ? VF.METAL : VF.SOLID);
  return hat;
}

// ============================================================================ weapons
/** the curved bronze khopesh in a fist: grip, guard ring, straight neck, then the hooked blade forward */
export function khopesh(F: Fig, part: string, parent: string, hand: G, o: { gold?: boolean; size?: number } = {}) {
  const wp = F.part(part, parent, hand);
  const k = o.size ?? 1;
  const hx = hand[0], hy = hand[1];
  const B = o.gold ? METAL.gold : NILE.bronze;
  const xa = Math.floor(hx) - (hx < 0 ? 0 : 0);
  // grip with leather wrap and pommel
  for (let y = Math.round(hy - 2); y <= Math.round(hy + 3); y++) wp.m.set(xa, y, 0, (y & 1) ? NILE.leather : NILE.leatherDark).set(xa, y, -1, NILE.leatherDark);
  wp.m.set(xa, Math.round(hy + 4), 0, B[2], VF.METAL).set(xa, Math.round(hy + 4), -1, B[0], VF.METAL);
  for (const [dx, dz] of [[0, 1], [0, -2], [1, 0], [-1, 0], [1, -1], [-1, -1]]) wp.m.set(xa + dx, Math.round(hy - 3), dz, B[0], VF.METAL);
  // the blade: straight neck down, then the sickle sweeping forward and up
  const pts: G[] = [];
  const N = 26;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const L = 22 * k;
    if (t < 0.38) pts.push([xa + 0.5, hy - 4 - t * L * 0.95, 0.5 + t * 1.2]);
    else {
      const u = (t - 0.38) / 0.62;
      const a = u * Math.PI * 0.95;
      const R = 6.2 * k;
      const cy = hy - 4 - 0.38 * L * 0.95, cz = 0.5 + 0.46 + R;
      pts.push([xa + 0.5, cy - Math.sin(a) * R, cz - Math.cos(a) * R]);
    }
  }
  for (let i = 0; i < pts.length; i++) {
    const [x, y, z] = pts[i];
    const t = i / (pts.length - 1);
    const w = t < 0.38 ? 1.1 : 1.6 + Math.sin(((t - 0.38) / 0.62) * Math.PI) * 1.4;
    // the blade is flat (x is its thickness); width runs perpendicular to the path in the y-z plane
    const nx = i < pts.length - 1 ? pts[i + 1] : pts[i];
    const px = i > 0 ? pts[i - 1] : pts[i];
    const ty = nx[1] - px[1], tz = nx[2] - px[2];
    const tl = Math.hypot(ty, tz) || 1;
    const ny = -tz / tl, nz = ty / tl; // outward normal (the cutting edge side)
    for (let s = -0.4; s <= w; s += 0.5) {
      const yy = Math.floor(y + ny * s), zz = Math.floor(z + nz * s);
      const edge = s > w - 0.6;
      const spine = s < 0.2;
      const c = edge ? B[2] : spine ? B[1] : B[0];
      wp.m.set(Math.floor(x) , yy, zz, c, VF.METAL);
      if (!edge && t > 0.3) wp.m.set(Math.floor(x) + (hx < 0 ? 1 : -1), yy, zz, spine ? B[1] : B[0], VF.METAL);
    }
  }
  const tip = pts[pts.length - 1];
  F.sock(part + '_tip', part, tip);
  return wp;
}

/** a long spear: ash shaft with rawhide bindings, a leaf-shaped bronze head, a bronze butt-spike; rests pointing forward (+Z) */
export function spear(F: Fig, part: string, parent: string, hand: G, o: { len?: number; back?: number; pennant?: number; gold?: boolean } = {}) {
  const sp = F.part(part, parent, hand);
  const fwd = o.len ?? 52, back = o.back ?? 22;
  const x = Math.floor(hand[0]), y = Math.floor(hand[1]);
  const B = o.gold ? METAL.gold : NILE.bronze;
  for (let z = -back; z <= fwd; z++) {
    const bind = (z > fwd - 8 && z < fwd - 5) || (z > -3 && z < 3 && Math.abs(z) > 1);
    sp.m.set(x, y, z, bind ? NILE.rawhide : (z & 3) === 0 ? NILE.woodDark : NILE.wood);
  }
  // leaf blade
  for (let i = 0; i <= 10; i++) {
    const z = fwd + 1 + i;
    const w = i < 2 ? 0 : Math.round(Math.sin((i / 10) * Math.PI) * 1.4 + (i < 5 ? 0.3 : 0));
    for (let d = -w; d <= w; d++) sp.m.set(x, y + d, z, Math.abs(d) === w && w > 0 ? B[2] : d === 0 ? B[1] : B[0], VF.METAL);
  }
  sp.m.set(x, y, fwd + 1, B[1], VF.METAL).set(x + 1, y, fwd + 1, B[1], VF.METAL).set(x - 1, y, fwd + 1, B[1], VF.METAL);
  // butt spike
  for (let i = 1; i <= 3; i++) sp.m.set(x, y, -back - i, B[i === 3 ? 2 : 0], VF.METAL);
  if (o.pennant !== undefined)
    for (let z = fwd - 9; z <= fwd - 2; z++) {
      const len = 1 + Math.floor((fwd - 2 - z) / 3);
      for (let d = 1; d <= len; d++) sp.m.set(x, y + d, z - Math.floor(d / 2), (z + d) & 1 ? o.pennant : mulRGB(o.pennant, 0.82));
    }
  F.sock(part + '_tip', part, [x + 0.5, y + 0.5, fwd + 11]);
  return sp;
}

/** rawhide-over-wood shield on the outer side of the left forearm (faces +X), rounded top, bronze rim and boss */
export function shieldG(F: Fig, hand: G, o: { h?: number; w?: number; seed?: number; face?: CSpec; tower?: boolean; emblem?: number; studs?: boolean } = {}) {
  const sd = F.part('shield', 'fore_l', [hand[0] + 2, 27, 0]);
  const H = o.h ?? 21, W = o.w ?? 6.2;
  const X0 = Math.floor(hand[0]) + 3;
  const y0 = 13;
  const face = o.face ?? cowhideC(o.seed ?? 0);
  const B = NILE.bronze;
  for (let y = y0; y <= y0 + H; y++)
    for (let z = -Math.ceil(W) - 1; z <= Math.ceil(W); z++) {
      const gz = z + 0.5;
      const top = y0 + H - W;
      const halfW = o.tower ? W : y >= top ? Math.sqrt(Math.max(0, 1 - ((y - top) / W) ** 2)) * W : W;
      const hw = o.tower ? (y > y0 + H - 2 ? W - 1 : W) : halfW;
      if (Math.abs(gz) > hw) continue;
      const rim = Math.abs(gz) > hw - 1 || y === y0 || (o.tower && y === y0 + H);
      // a gentle convex curve: the centre stands out
      const bulge = Math.round((1 - (gz / W) ** 2) * (o.tower ? 1.4 : 1));
      const xF = X0 + bulge;
      sd.m.set(xF, y, z, rim ? B[0] : res(face, xF, y, z), rim ? VF.METAL : VF.SOLID);
      sd.m.set(xF - 1, y, z, rim ? B[1] : NILE.woodDark, rim ? VF.METAL : VF.SOLID);
      if (o.studs && !rim && (y % 4 === 0) && Math.abs(gz) > hw - 2.2) sd.m.set(xF + 1, y, z, B[2], VF.METAL);
      if (o.tower && !rim && (y - y0) % 7 === 0) sd.m.set(xF, y, z, B[1], VF.METAL);
    }
  // the boss and emblem
  const cy = y0 + Math.round(H * 0.52);
  for (let dy = -2; dy <= 2; dy++)
    for (let dz = -2; dz <= 2; dz++) {
      if (Math.abs(dy) + Math.abs(dz) > 3) continue;
      const k = Math.abs(dy) + Math.abs(dz);
      sd.m.set(X0 + 2, cy + dy, dz, k === 0 ? B[2] : k <= 1 ? B[0] : B[1], VF.METAL);
      if (k <= 1) sd.m.set(X0 + 3, cy + dy, dz, B[k === 0 ? 2 : 0], VF.METAL);
    }
  if (o.emblem !== undefined) for (const [dy, dz] of [[4, 0], [-4, 0], [0, 4], [0, -4], [3, 3], [3, -3], [-3, 3], [-3, -3]]) sd.m.set(X0 + 2, cy + dy, dz, o.emblem, o.emblem === METAL.gold[0] ? VF.METAL : VF.SOLID);
  // grip strap inside
  for (let y = 22; y <= 30; y += 8) for (let z = -1; z <= 1; z++) sd.m.set(X0 - 2, y, z, NILE.leatherDark);
  return sd;
}

/** composite recurve bow in the left fist, laid along rest Z so it stands upright when the arm aims */
export function bowG(F: Fig, hand: G, o: { gold?: boolean; len?: number } = {}) {
  const bw = F.part('bow', 'fore_l', hand);
  const L = o.len ?? 20;
  const x = Math.floor(hand[0]);
  const G1 = o.gold ? METAL.gold : [0x5a3a22, 0x3e2614, 0x8a5a32];
  for (let z = -L; z <= L - 1; z++) {
    const t = (z + 0.5) / L;
    const curve = t * t * 4.6 - (Math.abs(t) > 0.86 ? (Math.abs(t) - 0.86) * 18 : 0);
    const y = Math.round(21 + curve);
    const grip = Math.abs(t) < 0.12;
    const tip = Math.abs(t) > 0.86;
    const c = grip ? NILE.carnelian : tip ? METAL.gold[2] : (z & 3) === 0 ? G1[1] : G1[0];
    bw.m.set(x, y, z, c, tip || o.gold ? VF.METAL : VF.SOLID);
    bw.m.set(x + 1, y, z, grip ? NILE.leatherDark : c, tip || o.gold ? VF.METAL : VF.SOLID);
    if (!tip && !grip && Math.abs(t) > 0.3) bw.m.set(x, y - 1, z, NILE.ivoryShade); // horn belly
  }
  for (let z = -L + 2; z <= L - 3; z++) bw.m.set(x + 1, 26, z, 0xf0e8d8); // string
  return bw;
}

/** quiver of arrows on the back (torso), strap across the chest */
export function quiverG(F: Fig, o: { leather?: number; fletch?: number } = {}) {
  const tr = F.s('torso');
  const L = leatherC(o.leather ?? 0x7a4a26, 7);
  limbG(tr, [-4, 30, -8.5], [-6.5, 43, -8.0], () => 1.9, L);
  for (const y of [32, 40]) for (let x = -8; x <= -3; x++) for (let z = -11; z <= -6; z++) if (tr.m.has(x, y, z) && isSurf(tr.m, x, y, z)) tr.m.set(x, y, z, NILE.bronze[0], VF.METAL);
  for (const [dx, dz] of [[0, 0], [1, -1], [-1, 1], [1, 1], [0, -1]] as [number, number][]) {
    const x = -7 + dx, z = -8 + dz;
    for (let y = 44; y <= 46; y++) tr.m.set(x, y, z, 0x8a5a30);
    tr.m.set(x, 47, z, o.fletch ?? 0xf0e6d0).set(x, 48, z, (dx + dz) & 1 ? NILE.carnelian : 0x1a1a22);
  }
  for (let y = 31; y <= 43; y++) {
    const x = Math.round(5 - (y - 31) * 0.8);
    tr.m.set(x, y, frontZ(tr.m, x, y) + 1, 0x5a3a22);
  }
}

export { mix, mulRGB, noise, hash3, ell, sections, limbG, coatG, cutG, isSurf, wrapShell, lineG, hornG, tube, furC, clothC, leatherC, frayStrip, VoxelModel, VF };
export type { CSpec, ColorFn, G, Sc };
