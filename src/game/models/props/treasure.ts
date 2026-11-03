// Treasure-hunt and field-healing props, sculpted in design centimetres:
//  - blueprintScroll: a rolled parchment schematic, ribbon and wax seal (ribbon colour by kind)
//  - mapFragment: a torn, half-curled scrap of treasure map with an inked X
//  - digMound: a suspicious heap of sand with marker stones, a bleached bone and a stake
//  - xMarker: two cattle bones crossed in an X and a stake flying a red rag
//  - glintSpot: something brassy half-buried in the sand
//  - boneCache: a prospector's skeletal hand still clutching his poke, ribs and a pick
//  - mapCase: a sealed tin map tube (blueprint cache)
//  - aloe: a medicinal aloe rosette, whole or cut back to stumps
//  - canteen: a dented tin canteen in a felt cover, hanging from a forked stick
//  - parchmentSheet: a torn sheet of parchment, the bed a schematic is photographed on
import { VoxelModel, VF, mulRGB, mix } from '../../../engine/voxel/VoxelModel';
import type { V3 } from '../../../engine/voxel/Rig';
import { Sc, clamp } from '../characters/sculpt';
import { noise, RNG } from '../../../engine/math/rand';

export interface PivotModel {
  model: VoxelModel;
  voxelSize: number;
  pivot: V3;
}
const M = VF.METAL;
const PI = Math.PI;

const PARCH = { base: 0xe8d4a6, shade: 0xc8ae7c, hi: 0xf6e8c4, stain: 0xb08c58, edge: 0x9a7444 };
const SAND = { base: 0xe2c08a, shade: 0xc9a46c, hi: 0xf0d6a4, dark: 0xb08a58 };
const BONE = { base: 0xeee2c8, shade: 0xcdbd9c, hi: 0xfff6e2, dark: 0x9a8a6a };
const WOOD = { base: 0x8a6440, shade: 0x6a4a2c, hi: 0xa8805a, dark: 0x4a3018 };
const RAG = { base: 0xb8322a, shade: 0x8a2018, hi: 0xd85a44 };
const TIN = { base: 0x9aa0a8, shade: 0x747a84, hi: 0xc8ced6, dark: 0x4a4e56 };
const BRASS = { base: 0xc89a3a, shade: 0x9a7024, hi: 0xf0cc6a };

function relief(m: VoxelModel, up = 1.1, down = 0.84) {
  const todo: [number, number, number, number, number][] = [];
  m.forEach((x, y, z, c, f) => {
    if (!m.has(x, y + 1, z)) todo.push([x, y, z, mulRGB(c, up), f]);
    else if (!m.has(x, y - 1, z)) todo.push([x, y, z, mulRGB(c, down), f]);
  });
  for (const [x, y, z, c, f] of todo) m.set(x, y, z, c, f);
  return m;
}
const piv = (s: Sc, p: V3): V3 => [p[0] * s.k, p[1] * s.k, p[2] * s.k];
/** parchment tone: soft foxing blotches and a darker age toward the edges */
const parch = (edge: (x: number, y: number, z: number) => number) => (x: number, y: number, z: number) => {
  const n = noise.n3(x * 0.18, y * 0.18, z * 0.18) * 0.5 + 0.5;
  const e = edge(x, y, z);
  let c = n > 0.78 ? PARCH.shade : n < 0.2 ? PARCH.hi : PARCH.base;
  if (e > 0.75) c = mix(c, PARCH.edge, (e - 0.75) * 2.4);
  return c;
};

// ------------------------------------------------------------------ blueprint scroll
export const SCROLL_RIBBON: Record<string, number> = { gun: 0xb8322a, attachment: 0x2a8a8a, upgrade: 0x7a3aa8, gear: 0xd0a030 };

/** a rolled parchment, lying along X, ribbon round its middle, wax seal on top (pivot at its centre) */
export function blueprintScroll(kind: 'gun' | 'attachment' | 'upgrade' | 'gear' = 'gun'): PivotModel {
  const s = new Sc('scroll', 0.9);
  const L = 15, R = 3.2;
  // the roll: a spiral of parchment you can see at both ends
  s.region([-L - 1, -R - 1, -R - 1], [L + 1, R + 1, R + 1], (x, y, z) => {
    const r = Math.hypot(y, z);
    if (r > R + Math.sin(x * 0.4) * 0.15) return false;
    if (Math.abs(x) < L - 0.9) return true;
    if (Math.abs(x) > L + 0.2 * Math.sin(Math.atan2(y, z) * 3)) return false;
    // end faces: the spiral of rolled sheets
    const th = Math.atan2(y, z);
    const turn = (r - th / (2 * PI) * 0.85) % 0.85;
    return r > 0.5 && (turn + 0.85) % 0.85 < 0.55;
  }, parch((x) => Math.abs(x) / L));
  // the outer leaf lifts off the roll a little
  s.region([-L + 1, R - 0.4, -2], [L - 2, R + 1.4, 3.5], (x, y, z) => {
    const lift = (x + L) / (2 * L);
    return y >= R - 0.3 && y <= R + 0.5 + lift * 0.6 && z > R * 0.2 - lift * 0.5 && z < R * 0.2 + 2.6 && x > -L + 2;
  }, parch(() => 0.3));
  // ribbon: two wraps, a bow and tails
  const rib = SCROLL_RIBBON[kind] ?? SCROLL_RIBBON.gun;
  for (const x0 of [-1.6, 1.0]) s.region([x0 - 0.1, -R - 0.6, -R - 0.6], [x0 + 0.8, R + 0.6, R + 0.6], (x, y, z) => Math.hypot(y, z) <= R + 0.5, rib);
  s.ell([-0.3, R + 0.6, 0.6], [1.5, 0.7, 1.0], mulRGB(rib, 0.85));
  s.path([[-0.3, R + 0.4, 1.0], [-1.2, R - 0.6, 3.6], [-1.5, -0.5, 4.2]], () => 0.5, rib);
  s.path([[0.2, R + 0.4, 1.0], [1.4, R - 1.0, 3.8], [2.2, -1.2, 4.0]], () => 0.5, mulRGB(rib, 0.9));
  // the wax seal: a lumpy disc with a stamped scorpion-tail spiral
  s.region([1.6, R - 0.4, -2.4], [5.6, R + 1.8, 1.6], (x, y, z) => {
    const d = Math.hypot(x - 3.6, z + 0.4);
    return d <= 1.9 + Math.sin(Math.atan2(z + 0.4, x - 3.6) * 5) * 0.2 && y <= R + 0.9 + (d < 1.1 ? 0.3 : 0);
  }, (x, y, z) => {
    const d = Math.hypot(x - 3.6, z + 0.4);
    return d < 1.3 && Math.abs(Math.sin(d * 4 - Math.atan2(z + 0.4, x - 3.6))) < 0.3 ? 0x7a1a12 : 0xa82a1c;
  });
  relief(s.m, 1.08, 0.86);
  return { model: s.m, voxelSize: 1 / 90, pivot: [0, 0, 0] };
}

// ------------------------------------------------------------------ map fragment
/** a torn, half-curled scrap of map: inked coast, dotted trail and the red X (pivot centre-bottom) */
export function mapFragment(seed = 3): PivotModel {
  const s = new Sc('map', 0.9);
  const rng = new RNG(seed);
  const W = 16, D = 12;
  const tear = (a: number) => 1 + Math.sin(a * 5 + seed) * 0.06 + Math.sin(a * 13 + seed * 2) * 0.05;
  s.region([-W, -1, -D], [W + 6, 7, D], (x, y, z) => {
    // the right third curls up into a loose roll
    const a = Math.atan2(z / D, x / W);
    const r = Math.hypot(x / W, z / D);
    if (x < W * 0.5) return r <= tear(a) && y >= 0 && y < 0.9;
    const cx = W * 0.5, cr = 3.2;
    const dx = x - cx, dy = y - cr;
    const rr = Math.hypot(dx, dy);
    return Math.abs(z) < D * 0.92 * tear(z) && dx >= 0 && rr <= cr + 0.45 && rr >= cr - 0.45 && !(dx < 1.4 && dy < -1);
  }, (x, y, z) => {
    // ink: a coastline, a dotted trail and the X, burned into the sheet
    const coast = Math.abs(z - Math.sin(x * 0.35) * 3 - 3) < 0.45 && x < W * 0.45;
    const trail = Math.abs(z + 2 + Math.sin(x * 0.25) * 2.5 - x * 0.25) < 0.5 && Math.round(x * 0.9) % 2 === 0 && x < 4;
    const X = x > 2 && x < 7 && (Math.abs((x - 4.5) - (z + 4)) < 0.6 || Math.abs((x - 4.5) + (z + 4)) < 0.6) && Math.abs(z + 4) < 2.4;
    if (X && y < 1) return RAG.base;
    if ((coast || trail) && y < 1) return 0x4a3018;
    return parch((xx, yy, zz) => Math.hypot(xx / W, zz / D))(x, y, z);
  });
  void rng;
  relief(s.m, 1.06, 0.9);
  return { model: s.m, voxelSize: 1 / 90, pivot: [0, 0, 0] };
}

// ------------------------------------------------------------------ dig sites
/** a suspicious mound: sand heaped over something, marker stones, a bleached bone and a stub stake */
export function digMound(seed = 1): PivotModel {
  const s = new Sc('mound', 0.42);
  const rng = new RNG(seed * 31 + 7);
  const R = 74, H = 32;
  const lump: [number, number, number][] = [];
  for (let i = 0; i < 4; i++) lump.push([rng.range(-30, 30), rng.range(-30, 30), rng.range(22, 34)]);
  s.region([-R - 4, 0, -R - 4], [R + 4, H + 12, R + 4], (x, y, z) => {
    const ang = Math.atan2(z, x);
    const r = Math.hypot(x, z * 1.12) / (R * (1 + Math.sin(ang * 3 + seed) * 0.06 + Math.sin(ang * 7) * 0.03));
    if (r >= 1) return false;
    const fall = Math.pow(1 - r * r, 1.25);
    let h = H * fall;
    // soft lumps and wind ripples, faded out toward the rim so it melts into the dune
    for (const [lx, lz, lr] of lump) h += 5 * fall * Math.max(0, 1 - Math.hypot(x - lx, z - lz) / lr) ** 2;
    h += (Math.sin(x * 0.16 + seed) * 0.9 + Math.sin(z * 0.13 + x * 0.05) * 0.8) * fall;
    return y <= h;
  }, (x, y, z) => {
    const n = noise.n3(x * 0.06 + seed, y * 0.06, z * 0.06) * 0.5 + 0.5;
    return y < 3 ? SAND.shade : n > 0.72 ? SAND.hi : n < 0.22 ? SAND.shade : SAND.base;
  });
  // marker stones laid in an X on the crown
  const top = (x: number, z: number) => {
    for (let y = H + 14; y > 0; y--) if (s.m.has(Math.round(x * s.k - 0.5), Math.round(y * s.k - 0.5), Math.round(z * s.k - 0.5))) return y;
    return 0;
  };
  for (let i = -2; i <= 2; i++) {
    if (i === 0) continue;
    for (const sg of [1, -1]) {
      const x = i * 11, z = i * 11 * sg;
      const y = top(x, z);
      s.ell([x, y + 2, z], [5.5 + rng.range(-1, 1), 3.6, 4.8], (xx, yy, zz) => (noise.n3(xx * 0.2, yy * 0.2, zz * 0.2) > 0.3 ? 0x8a7e70 : 0xa89c8a));
    }
  }
  s.ell([0, top(0, 0) + 2.5, 0], [6, 4, 6], 0x948876);
  // a bleached long-bone poking out of the side, knuckle up
  s.cap([-50, 12, 26], [-30, 32, 14], 2.6, 2.2, BONE.base);
  s.ell([-29, 33.5, 13.4], [4.2, 3.4, 3.6], BONE.hi);
  s.ell([-31.5, 34.5, 15.6], [2.6, 2.4, 2.4], BONE.base);
  // a weathered survey stake leaning out of the heap, a twist of twine round its head
  s.cap([34, 6, -24], [42, 52, -30], 2.0, 1.5, WOOD.base);
  s.cap([42, 52, -30], [42.6, 55, -30.4], 1.3, 0.8, WOOD.hi);
  s.region([38, 44, -34], [46, 50, -26], (x, y, z) => Math.abs(Math.hypot(x - 40.8, z + 29.2) - 2.3) < 0.7 && y > 45 && y < 48.5, 0x8a6a42);
  relief(s.m, 1.06, 0.9);
  return { model: s.m, voxelSize: 1 / 42, pivot: [0, 0, 0] };
}

/** X marks the spot: two cattle bones crossed on the sand, a stake with a red rag (pivot ground centre) */
export function xMarker(seed = 2): PivotModel {
  const s = new Sc('xmark', 0.55);
  const L = 44;
  for (const sg of [1, -1]) {
    const a: V3 = [-L * 0.7, 2.6, -L * 0.7 * sg], b: V3 = [L * 0.7, 2.6 + (sg > 0 ? 3.4 : 0), L * 0.7 * sg];
    s.cap(a, b, 2.4, 2.4, BONE.base);
    for (const e of [a, b]) {
      s.ell([e[0], e[1] + 0.6, e[2] + 2.2 * sg], [3.6, 3.2, 3.2], BONE.hi);
      s.ell([e[0], e[1] + 0.6, e[2] - 2.2 * sg], [3.2, 3.0, 3.0], BONE.base);
    }
  }
  // sand heaped round the crossing
  s.region([-26, 0, -26], [26, 8, 26], (x, y, z) => {
    const r = Math.hypot(x, z) / 24 + Math.sin(Math.atan2(z, x) * 4 + seed) * 0.07;
    return r < 1 && y <= 5.5 * (1 - r * r);
  }, (x, y, z) => (noise.n3(x * 0.1, y * 0.1, z * 0.1) > 0.4 ? SAND.hi : SAND.base), { mode: 'under' });
  // the stake and its red rag
  s.cap([24, 0, -20], [27, 92, -22], 2.4, 1.8, WOOD.base);
  s.cap([27, 92, -22], [27.4, 95, -22.2], 1.6, 1.2, WOOD.hi);
  // the rag: tied at the top, drooping and rippling in the wind, the free end torn to tatters
  s.region([26, 52, -30], [60, 92, -14], (x, y, z) => {
    const u = (x - 27.5) / 30;
    if (u < 0 || u > 1) return false;
    const top = 90 - 5 * u - 9 * u * u, bot = 74 - 3 * u - 14 * u * u;
    if (y > top || y < bot) return false;
    const v = (y - bot) / (top - bot);
    const wave = Math.sin(u * 7.5 - v * 1.4) * 2.6 * u + Math.sin(u * 15 + v * 3) * 0.6 * u;
    if (Math.abs(z + 22 - wave) > 0.75) return false;
    // tattered free end (ragged tongues) and a couple of moth holes
    const tongue = 0.8 + 0.12 * Math.sin(v * 19) + 0.06 * Math.sin(v * 41);
    if (u > tongue) return false;
    if (Math.hypot((u - 0.42) * 30, (v - 0.55) * (top - bot)) < 1.6 || Math.hypot((u - 0.7) * 30, (v - 0.3) * (top - bot)) < 1.1) return false;
    return true;
  }, (x, y, z) => {
    const u = (x - 27.5) / 30;
    const shade = Math.sin(u * 7.5) * 0.5 + 0.5;
    return u > 0.7 ? RAG.shade : shade > 0.7 ? RAG.hi : shade < 0.25 ? RAG.shade : RAG.base;
  });
  s.region([22, 86, -25], [29, 90, -19], (x, y, z) => Math.hypot(x - 27, z + 22) <= 2.8 && Math.hypot(x - 27, z + 22) >= 2.0, 0x7a5a3a); // twine
  relief(s.m, 1.08, 0.86);
  return { model: s.m, voxelSize: 1 / 55, pivot: [0, 0, 0] };
}

/** a glint in the sand: a brass compass lid and a bottle neck half-buried (pivot ground centre) */
export function glintSpot(seed = 4): PivotModel {
  const s = new Sc('glint', 0.9);
  // the drift they sit in
  s.region([-16, 0, -16], [16, 4, 16], (x, y, z) => {
    const r = Math.hypot(x, z * 1.2) / 15 + Math.sin(Math.atan2(z, x) * 3 + seed) * 0.08;
    return r < 1 && y <= 2.6 * (1 - r * r) + 0.2;
  }, (x, y, z) => (noise.n3(x * 0.15, y * 0.15, z * 0.15) > 0.35 ? SAND.hi : SAND.base));
  // compass lid tilted out of the sand
  s.region([-8, -1, -6], [2, 6, 4], (x, y, z) => {
    const u = x + 3, v = (y - 1.8) * 1.4 + (z + 1) * 0.6;
    return Math.hypot(u, v) <= 4.2 && Math.abs((z + 1) * 0.8 - (y - 1.8) * 0.5) <= 0.7;
  }, (x, y) => (y > 3.5 ? BRASS.hi : BRASS.base), { flags: M });
  // green glass bottle neck
  s.cap([6, -1, 4], [8.5, 6, 6], 1.6, 1.0, 0x4a8a58, { flags: VF.SOFTAO });
  s.ell([8.6, 6.4, 6.1], [1.2, 0.6, 1.2], 0x6aaa74, { flags: VF.SOFTAO });
  relief(s.m, 1.1, 0.88);
  return { model: s.m, voxelSize: 1 / 90, pivot: [0, 0, 0] };
}

/** what a mound or an X gives up: a prospector's bones clutching his poke (pivot ground centre) */
export function boneCache(seed = 5): PivotModel {
  const s = new Sc('bonecache', 0.64);
  // the skull on its side
  s.ell([-14, 7, 4], [7.4, 6.8, 8.2], BONE.base);
  s.ell([-14, 4, 10], [5, 3.4, 4], BONE.base); // jaw
  for (const sx of [-1, 1]) s.ell([-14 + sx * 3, 8.5, 10.8], [2.2, 2.4, 2], 0, { mode: 'carve' });
  s.walls([-24, 0, 0], [-4, 16, 14], (x, y, z) => Math.hypot(x + 17, y - 8.5, z - 10.8) < 2.4 || Math.hypot(x + 11, y - 8.5, z - 10.8) < 2.4, 0x3a2414);
  for (let i = 0; i < 5; i++) s.ell([-16.5 + i * 1.3, 3.5, 12.6], [0.6, 1.0, 0.5], i === 2 ? BRASS.hi : BONE.hi, i === 2 ? { flags: M } : {}); // a gold tooth
  // ribs arching out of the sand
  for (let i = 0; i < 4; i++) s.path([[2 + i * 4, 0, -10], [3 + i * 4, 9, -4], [4 + i * 4, 6, 6]], (t) => 1.2 - t * 0.4, BONE.base);
  s.cap([0, 2, -12], [20, 2.6, -12], 1.6, 1.4, BONE.shade); // spine
  // the arm and the hand, still clutching a leather poke
  s.cap([10, 1.2, 14], [20, 2.4, 10], 1.2, 1.0, BONE.base);
  s.ell([24, 5, 9], [6.2, 5.4, 5.6], (x, y, z) => (y > 8 ? 0x8a5a2c : 0x6a4020));
  s.ell([24, 10.6, 9], [2.6, 1.6, 2.4], 0x8a5a2c);
  s.cap([24, 10.8, 9], [24, 12.8, 9], 1.0, 0.6, 0xe6cf9f); // drawstring tuft
  for (let f = 0; f < 4; f++) s.path([[20, 2.6, 7 + f * 1.4], [21.5, 8.6, 6.6 + f * 1.4], [24.5, 9.8, 7 + f * 1.3]], () => 0.6, BONE.hi);
  for (const [x, z] of [[28.4, 4], [27, 13.5], [30, 9]] as [number, number][]) s.ell([x, 1.2, z], [1.6, 0.6, 1.6], BRASS.hi, { flags: M }); // spilled nuggets
  // his pick, the handle snapped
  s.cap([-30, 1.5, -14], [-6, 2.4, -20], 1.3, 1.2, WOOD.base);
  s.path([[-32, 1.8, -21], [-30, 3.2, -14], [-29, 2.0, -6]], (t) => 1.6 - Math.abs(t - 0.5) * 1.6, TIN.shade, { flags: M });
  void seed;
  relief(s.m, 1.08, 0.86);
  return { model: s.m, voxelSize: 1 / 64, pivot: [0, 0, 0] };
}

/** a sealed tin map case: a blueprint cache (pivot at its middle, axis +Y) */
export function mapCase(): PivotModel {
  const s = new Sc('mapcase', 0.9);
  s.cap([0, -18, 0], [0, 16, 0], 4.2, 4.2, (x, y, z) => (noise.n3(x * 0.2, y * 0.2, z * 0.2) > 0.45 ? 0x8a6a4a : TIN.base), { flags: M });
  for (const y of [-14, -2, 10]) s.region([-5, y, -5], [5, y + 1.2, 5], (x, yy, z) => Math.hypot(x, z) <= 4.6, TIN.hi, { flags: M });
  s.cap([0, 16, 0], [0, 21, 0], 4.6, 4.6, TIN.shade, { flags: M }); // cap
  s.ell([0, 21.2, 0], [3.2, 0.8, 3.2], TIN.hi, { flags: M });
  s.region([-1.5, 14, -5.2], [1.5, 19, -4.2], () => true, 0xa82a1c); // wax seal over the cap seam
  s.ell([0, 16.5, -5.0], [2.2, 2.2, 0.8], 0x8a1e14);
  s.cap([-4.6, 6, 0], [-6.4, -10, 0], 0.7, 0.7, 0x6a4020); // a leather strap
  relief(s.m, 1.1, 0.86);
  return { model: s.m, voxelSize: 1 / 90, pivot: [0, 0, 0] };
}

// ------------------------------------------------------------------ healing
/** a medicinal aloe: a rosette of thick, toothed, spotted leaves (cut = stumps oozing gel) */
export function aloe(seed = 1, cut = false): PivotModel {
  const s = new Sc(cut ? 'aloe_cut' : 'aloe', 0.62);
  const rng = new RNG(seed * 13 + 1);
  const G = { base: 0x5e8a4a, shade: 0x46703a, hi: 0x84ac64, spot: 0xc8d8a8, tooth: 0xd8c890, tip: 0xb87048 };
  // the dry earth ring it grows from
  s.region([-26, 0, -26], [26, 3, 26], (x, y, z) => {
    const r = Math.hypot(x, z) / 22 + Math.sin(Math.atan2(z, x) * 5 + seed) * 0.08;
    return r < 1 && y <= 2.4 * (1 - r * r);
  }, (x, y, z) => (noise.n3(x * 0.2, 0, z * 0.2) > 0.3 ? 0xb89868 : 0xa88858));
  const n = 13 + Math.floor(rng.range(0, 4));
  for (let i = 0; i < n; i++) {
    const ring = i < 5 ? 0 : i < 10 ? 1 : 2;
    const a = (i / (ring === 0 ? 5 : 5)) * PI * 2 + ring * 0.6 + rng.range(-0.2, 0.2);
    const tilt = [0.55, 0.85, 1.15][ring] + rng.range(-0.08, 0.08); // outer leaves splay out
    const len = cut ? 6 + rng.range(0, 3) : [28, 36, 30][ring] + rng.range(-4, 4);
    const w = [3.6, 4.6, 4.2][ring];
    const ca = Math.cos(a), sa = Math.sin(a);
    const pts: V3[] = [];
    for (let k = 0; k <= 6; k++) {
      const t = (k / 6) * (cut ? 0.25 : 1);
      const bend = tilt + t * t * 0.6; // leaves arch over toward their tips
      const r = Math.sin(bend) * len * t + 2;
      const y = Math.cos(bend) * len * t + 1.2;
      pts.push([ca * r, y, sa * r]);
    }
    // a thick, channelled leaf: wide at the base, a hard pointed tip
    s.sweep(pts, (t) => {
      const ww = w * (1 - t * 0.85) + 0.4;
      return [ww, ww * 0.62, ww];
    }, (x, y, z) => {
      const h = Math.hypot(x, z) + y;
      const spot = noise.n3(x * 0.6 + i, y * 0.6, z * 0.6) > 0.55;
      if (h > len * 1.1 && !cut) return G.tip;
      return spot ? G.spot : y > 14 ? G.hi : y < 5 ? G.shade : G.base;
    }, 0.5);
    // the toothed margin
    if (!cut) for (let k = 1; k < 6; k++) {
      const p = pts[k], t = k / 6;
      const ww = w * (1 - t * 0.85) + 0.4;
      for (const sd of [1, -1]) s.ell([p[0] - sa * ww * sd, p[1] + 0.4, p[2] + ca * ww * sd], [0.45, 0.6, 0.45], G.tooth);
    }
    // cut stumps: pale gel weeping out of the cut face
    if (cut) {
      const p = pts[pts.length - 1];
      s.ell([p[0], p[1] + 0.8, p[2]], [w * 0.7, 0.8, w * 0.7], 0xd8f0b8, { flags: VF.SOFTAO });
      s.ell([p[0] + ca * 1.2, p[1] - 1.2, p[2] + sa * 1.2], [0.7, 1.4, 0.7], 0xe8f8d0, { flags: VF.SOFTAO });
    }
  }
  // a flower spike on the whole plant
  if (!cut) {
    s.path([[0, 4, 0], [2, 40, 1], [4, 58, 2]], (t) => 1.2 - t * 0.6, 0x6a8a48);
    for (let k = 0; k < 9; k++) {
      const y = 46 + k * 1.6, a = k * 2.1;
      s.cap([3 + (y - 46) * 0.1, y, 1.5], [3 + Math.cos(a) * 2.6, y - 1.6, 1.5 + Math.sin(a) * 2.6], 0.7, 0.5, k > 5 ? 0xf0a040 : 0xe86a30);
    }
  }
  relief(s.m, 1.08, 0.86);
  return { model: s.m, voxelSize: 1 / 62, pivot: [0, 0, 0] };
}

/** a dented tin canteen in a felt cover hanging from a forked stick (pivot ground centre) */
export function canteen(): PivotModel {
  const s = new Sc('canteen', 1.0);
  // the forked stick, planted in the sand
  s.cap([0, -2, -2], [-1, 52, -2], 1.3, 1.0, WOOD.base);
  s.cap([-1, 50, -2], [-6, 62, -1], 0.9, 0.7, WOOD.shade);
  s.cap([-1, 50, -2], [5, 61, -3], 0.9, 0.7, WOOD.base);
  s.region([-10, 0, -12], [10, 3, 8], (x, y, z) => {
    const r = Math.hypot(x, z + 2) / 8;
    return r < 1 && y <= 2.2 * (1 - r * r);
  }, SAND.base);
  // the canteen: a fat lens of tin in a felt jacket, a little dented
  const cy = 30;
  s.region([-12, cy - 12, -6], [12, cy + 12, 6], (x, y, z) => {
    const r = Math.hypot(x, y - cy) / 11;
    const dent = Math.max(0, 1 - Math.hypot(x - 4, y - cy + 4) / 4) * 1.4;
    return r <= 1 && Math.abs(z) <= 4.6 * Math.sqrt(Math.max(0, 1 - r * r)) + 0.6 - dent;
  }, (x, y, z) => {
    const r = Math.hypot(x, y - cy);
    if (r > 10.2) return TIN.shade; // the crimped seam showing at the rim
    return noise.n3(x * 0.3, y * 0.3, z * 0.3) > 0.4 ? 0x6a6a5a : 0x7a7a66; // grey felt
  }, { flags: 0 });
  s.region([-12, cy - 12, -1], [12, cy + 12, 1], (x, y) => Math.abs(Math.hypot(x, y - cy) - 10.6) < 0.7, TIN.base, { flags: M });
  // neck, chained cork
  s.cap([0, cy + 10, 0], [0, cy + 14, 0], 2.2, 1.8, TIN.hi, { flags: M });
  s.cap([0, cy + 14, 0], [0, cy + 16.5, 0], 1.7, 1.9, 0xa07850);
  s.path([[1.5, cy + 15, 0], [4, cy + 13, 1.5], [5.5, cy + 10, 1]], () => 0.4, TIN.dark, { flags: M });
  // the canvas strap looped over the fork
  s.path([[-9, cy + 6, 0], [-6, 58, -1.5], [-2, 61, -2], [3, 58, -2.5], [9, cy + 6, 0]], () => 0.9, 0xb8a078);
  // a stitched hide patch
  s.region([-5, cy - 6, 4], [5, cy + 3, 6], (x, y, z) => Math.hypot(x + 0.5, y - cy + 1.5) <= 4 && z > 4.2, (x, y) => (Math.abs(Math.hypot(x + 0.5, y - cy + 1.5) - 3.4) < 0.4 ? 0xe6cf9f : 0x8a5a2c), { mode: 'paint' });
  relief(s.m, 1.1, 0.86);
  return { model: s.m, voxelSize: 1 / 100, pivot: [0, 0, 0] };
}

// ------------------------------------------------------------------ the schematic bed
/** a torn sheet of parchment lying in XZ (top face up at y = 1), ink dimension marks round a frame */
export function parchmentSheet(w = 120, d = 74, seed = 1): PivotModel {
  const s = new Sc('sheet', 1);
  const rng = new RNG(seed);
  const torn = (a: number) => 1 + Math.sin(a * 7 + seed) * 0.012 + Math.sin(a * 19 + seed * 3) * 0.01 + (rng.next() - 0.5) * 0.004;
  s.region([-w / 2 - 2, 0, -d / 2 - 2], [w / 2 + 2, 2, d / 2 + 2], (x, y, z) => {
    const u = Math.abs(x) / (w / 2), v = Math.abs(z) / (d / 2);
    const a = Math.atan2(z, x);
    const k = Math.pow(Math.pow(u, 8) + Math.pow(v, 8), 1 / 8);
    return k <= torn(a);
  }, (x, y, z) => {
    const u = Math.abs(x) / (w / 2), v = Math.abs(z) / (d / 2);
    const e = Math.max(u, v);
    const n = noise.n3(x * 0.07 + seed, 0, z * 0.07) * 0.5 + 0.5;
    const ring = Math.abs(Math.hypot(x + w * 0.3, z - d * 0.22) - 9) < 0.9 && n > 0.35; // a coffee ring
    let c = n > 0.74 ? PARCH.shade : n < 0.24 ? PARCH.hi : PARCH.base;
    if (ring) c = PARCH.stain;
    if (e > 0.86) c = mix(c, PARCH.edge, Math.min(1, (e - 0.86) * 5));
    // ink frame and corner ticks (the draughtsman's border)
    const fx = Math.abs(Math.abs(x) - w * 0.43) < 0.55 && Math.abs(z) < d * 0.4;
    const fz = Math.abs(Math.abs(z) - d * 0.4) < 0.55 && Math.abs(x) < w * 0.43;
    const tick = (Math.abs(Math.abs(x) - w * 0.43) < 2.5 && Math.abs(Math.abs(z) - d * 0.4) < 0.5) || (Math.abs(Math.abs(z) - d * 0.4) < 2.5 && Math.abs(Math.abs(x) - w * 0.43) < 0.5);
    if (y > 1 && (fx || fz || tick)) return 0x3a2412;
    return c;
  });
  // a curl lifting at two corners
  for (const [cx, cz] of [[-w / 2 + 3, d / 2 - 3], [w / 2 - 4, -d / 2 + 6]] as [number, number][])
    s.region([cx - 6, 1, cz - 6], [cx + 6, 4, cz + 6], (x, y, z) => Math.hypot(x - cx, z - cz) < 4.5 && y <= 1 + (4.5 - Math.hypot(x - cx, z - cz)) * 0.5, PARCH.hi);
  return { model: s.m, voxelSize: 1 / 100, pivot: piv(s, [0, 0, 0]) };
}

/** wooden roller with brass end caps for the unrolling parchment (axis Y, pivot centre) */
export function scrollRoller(len = 60): PivotModel {
  const s = new Sc('roller', 0.8);
  s.cap([0, -len / 2, 0], [0, len / 2, 0], 1.9, 1.9, (x, y, z) => (Math.sin(y * 0.5 + Math.atan2(z, x) * 2) > 0.7 ? WOOD.shade : WOOD.base));
  for (const sy of [-1, 1]) {
    s.cap([0, sy * (len / 2 - 0.5), 0], [0, sy * (len / 2 + 2.2), 0], 2.6, 2.4, BRASS.base, { flags: M });
    s.ell([0, sy * (len / 2 + 3.6), 0], [2.3, 2.0, 2.3], BRASS.hi, { flags: M });
    s.ell([0, sy * (len / 2 + 5.4), 0], [1.1, 1.1, 1.1], BRASS.base, { flags: M });
  }
  return { model: s.m, voxelSize: 1 / 80, pivot: [0, 0, 0] };
}

export { clamp };
