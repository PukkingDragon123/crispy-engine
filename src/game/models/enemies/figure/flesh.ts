// Desiccated flesh over Sundown's bones (husks and husk variants).
// Leathery hide shrink-wrapped over the figure's skeleton: ribs pressing through
// the chest, a sunken belly, knobby joints with bone showing, sinewy neck cords,
// claw hands with dark nails, bony bare feet, and a skin-over-skull face with
// deep sunken sockets, collapsed nose and lips drawn back from yellowed teeth.
// All coordinates are the figure's geometric voxel coords (see fig.ts).
import {
  Fig, G, Sc, VoxelModel, VF, mix, mulRGB, hash3, noise, ell, cap, CSpec,
  sections, limbG, lineG, coatG, cutG, copyWhere, isSurf, hide, agedBone, tones,
} from './fig';

export const SAND = { a: 0xf6dfb0, b: 0xeccb8f, c: 0xe0b373 };
export const CAVITY = 0x24160d;

export interface DriedOpts {
  skin: number;
  seed: number;
  /** the right forearm is stripped to bare bone (husk v2) */
  boneArmR?: boolean;
  /** sand caked on crown, shoulders and feet */
  crust?: boolean;
  /** skip the flank split (e.g. covered by a shirt) */
  noWound?: boolean;
}

export interface Skin {
  base: number;
  /** leathery hide colour function */
  hide: CSpec;
  /** skin stretched thin over bone */
  tight: number;
  dark: number;
  bone: CSpec;
}

const res = (c: CSpec, x: number, y: number, z: number) => (typeof c === 'number' ? c : c(x, y, z));
const blendC = (c: CSpec, to: number, t: number): CSpec => (x: number, y: number, z: number) => mix(res(c, x, y, z) as number, to, t);

export function skinOf(base: number, seed: number): Skin {
  return {
    base,
    hide: hide(base, seed),
    tight: mix(base, 0xd6c098, 0.2),
    dark: mix(base, 0x1e130c, 0.3),
    bone: agedBone(0xd9c59c, seed + 3),
  };
}

// ============================================================================ TORSO
/** torso cross-sections (geometric): rib rows 33..41 odd are ridges, even rows grooves */
const TORSO: Record<number, [number, number, number]> = {
  28: [4.5, 1.2, -4.9],
  29: [4.6, 1.4, -5.0],
  30: [4.8, 1.6, -5.1],
  31: [5.0, 1.9, -5.2],
  32: [5.35, 2.5, -5.3],
  33: [5.7, 3.2, -5.3],
  34: [5.95, 3.35, -5.3],
  35: [6.2, 3.5, -5.35],
  36: [6.4, 3.65, -5.4],
  37: [6.6, 3.85, -5.4],
  38: [6.85, 4.0, -5.4],
  39: [7.05, 4.15, -5.4],
  40: [7.2, 4.25, -5.4],
  41: [7.3, 4.3, -5.4],
  42: [7.2, 4.1, -5.3],
  43: [6.9, 3.0, -5.0],
  44: [5.4, 1.4, -4.2],
  45: [3.5, 0.6, -3.9],
  46: [2.5, 0.4, -3.8],
  47: [2.3, 0.3, -3.7],
};

export function driedTorso(F: Fig, K: Skin, o: DriedOpts) {
  const s = F.s('torso');
  const bones = F.bone['torso'];
  s.m.map.clear();
  // ---- solid organic volume
  sections(s, 28, 47, (y) => {
    const r = TORSO[Math.floor(y)];
    return r ? { a: r[0], f: r[1], b: r[2], p: 2.25 } : null;
  }, K.hide);
  // ribs pressing through the hide: grooves carved into the outer layer, slanting down toward the
  // breastbone (a chevron like a real starved rib cage); the upper chest stays a flat pectoral plate
  const groove = (x: number, y: number, z: number) => {
    const ax = Math.abs(x + 0.5);
    if (ax < 1.2 || z < -2) return false;
    if (y >= 39 && ax < 4.6 && z > 0) return false; // pectorals
    const yy = y + Math.round((7.2 - ax) * 0.42);
    return yy >= 34 && yy <= 42 && (yy & 1) === 0 && y >= 32 && y <= 41;
  };
  const cutList: [number, number, number][] = [];
  s.m.forEach((x, y, z) => {
    if (!groove(x, y, z)) return;
    const out = (!s.m.has(x, y, z + 1) && z > 0) || (!s.m.has(x + 1, y, z) && x >= 0) || (!s.m.has(x - 1, y, z) && x < 0);
    if (out) cutList.push([x, y, z]);
  });
  for (const [x, y, z] of cutList) s.m.del(x, y, z);
  for (const [x, y, z] of cutList)
    for (const [dx, dz] of [[0, -1], [x < 0 ? 1 : -1, 0]] as [number, number][]) if (s.m.has(x + dx, y, z + dz)) s.m.set(x + dx, y, z + dz, mix(res(K.hide, x, y, z) as number, K.dark, 0.32));
  coatG(s, (x, y, z) => y > 32 && y < 42 && z > -2.5 && Math.abs(x) > 1.2 && !groove(Math.floor(x), Math.floor(y), Math.floor(z)) && (groove(Math.floor(x), Math.floor(y) - 1, Math.floor(z)) || groove(Math.floor(x), Math.floor(y) + 1, Math.floor(z))), (x, y, z) => mix(res(K.hide, x, y, z) as number, K.tight, 0.26));
  // breastbone: a continuous pale ridge down the middle of the cage
  for (let y = 35; y <= 42; y++) {
    const z0 = Math.floor(TORSO[y][1] - 0.5);
    for (const x of [-1, 0]) s.m.set(x, y, z0, mix(K.tight, 0xd8c49c, 0.2)).set(x, y, z0 - 1, K.tight);
  }
  // collarbones: pale ridges over the top of the chest
  for (let x = 1; x <= 6; x++) for (const sx of [1, -1]) s.m.set(sx > 0 ? x : -1 - x, 43, 3 - (x > 4 ? 1 : 0), K.tight);
  // ---- back: vertebrae bumps, shoulder blades, the C7 knob
  for (let y = 29; y <= 43; y += 2) for (const x of [-1, 0]) s.m.set(x, y, -6, mix(K.tight, 0xd8c49c, 0.25));
  for (const x of [-1, 0]) s.m.set(x, 44, -5, K.tight).set(x, 45, -5, mix(K.tight, K.base, 0.5));
  for (const sx of [1, -1])
    for (let y = 38; y <= 42; y++)
      for (let x = 2; x <= 5; x++) {
        if ((y === 38 && (x === 2 || x === 5)) || (y === 42 && x === 5)) continue;
        const X = sx > 0 ? x : -1 - x;
        studZ(s.m, X, y, -6, 1, y === 42 ? K.tight : res(K.hide, X, y, -6) as number);
      }
  // ---- neck: sinew cords from behind the jaw to the breastbone, ringed windpipe
  for (const sx of [1, -1]) {
    cap(s, [sx * 3.4, 47.6, -2.6], [sx * 2.4, 45.6, -0.6], 0.62, 0.62, K.tight);
    cap(s, [sx * 2.4, 45.6, -0.6], [sx * 0.9, 43.9, 2.0], 0.62, 0.58, K.tight);
  }
  for (let y = 44; y <= 47; y++) for (const x of [-1, 0]) s.m.set(x, y, 0, y & 1 ? K.tight : K.dark);
  // ---- sunken belly with a dry gash on the right
  for (let y = 29; y <= 31; y++) for (const x of [-1, 0]) s.m.set(x, y, frontZ(s.m, x, y), K.dark); // crease down the middle
  for (const [x, y] of [[-4, 31], [-3, 30], [-3, 31], [-2, 29], [-2, 30]] as [number, number][]) {
    const z = frontZ(s.m, x, y);
    s.m.del(x, y, z);
    s.m.set(x, y, z - 1, CAVITY);
    s.m.set(x - 1, y + 1, frontZ(s.m, x - 1, y + 1), K.tight);
  }
  // ---- the split in the left flank: real ribs exposed, sand pouring out
  if (!o.noWound) flankSplit(F, s, bones, K);
  // ---- shrink-wrapped lumps so nothing reads as a primitive
  return s;
}

function flankSplit(F: Fig, s: Sc, bones: VoxelModel, K: Skin) {
  const c: G = [6.6, 36.6, 0.3], r: G = [1.6, 2.9, 1.9];
  const inside = (x: number, y: number, z: number) => ((x - c[0]) / r[0]) ** 2 + ((y - c[1]) / r[1]) ** 2 + ((z - c[2]) / r[2]) ** 2 <= 1;
  cutG(s, inside);
  // cavity walls: everything now facing the hole goes dark
  const dark: [number, number, number][] = [];
  s.m.forEach((x, y, z) => {
    for (const [dx, dy, dz] of [[1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] as G[])
      if (inside(x + dx + 0.5, y + dy + 0.5, z + dz + 0.5) && !s.m.has(x + dx, y + dy, z + dz)) {
        dark.push([x, y, z]);
        return;
      }
  });
  for (const [x, y, z] of dark) s.m.set(x, y, z, (y & 1) ? CAVITY : mix(CAVITY, 0x4a2c1a, 0.35));
  // the figure's own ribs show through the tear
  copyWhere(bones, s.m, (x, y, z) => inside(x, y, z), agedBone(0xd2bd92, 4));
  // torn, peeled lips of hide around the rim
  for (let a = 0; a < Math.PI * 2; a += 0.42) {
    const x = c[0] + 0.3, y = c[1] + Math.sin(a) * (r[1] + 0.4), z = c[2] + Math.cos(a) * (r[2] + 0.35);
    const X = Math.floor(x + (hash3(Math.round(a * 10), 1, 7) > 0.5 ? 0.6 : 0)), Y = Math.floor(y), Z = Math.floor(z);
    if (!s.m.has(X - 1, Y, Z) && !s.m.has(X - 2, Y, Z)) continue;
    s.m.set(X, Y, Z, mix(K.tight, 0xb89870, 0.3));
  }
  // sand heaped in the bottom of the split and pouring down the flank
  const sand = tones(SAND.c, SAND.b, SAND.a, 2.2, 11);
  for (let z = -1; z <= 1; z++) for (const y of [34, 35]) s.m.set(5, y, z, res(sand, 5, y, z) as number);
  for (let y = 33; y >= 28; y--)
    for (const z of y >= 31 ? [0, 1] : [1]) {
      const x = sideX(s.m, y, z) + 1;
      s.m.set(x, y, z, res(sand, x, y, z) as number);
    }
  void F;
}

// ============================================================================ PELVIS
const PELVIS: Record<number, [number, number, number]> = {
  21: [4.6, 1.3, -4.3],
  22: [5.5, 1.9, -5.0],
  23: [6.0, 2.2, -5.6],
  24: [6.2, 2.3, -5.8],
  25: [6.3, 2.3, -5.7],
  26: [6.3, 2.3, -5.5],
  27: [6.2, 2.1, -5.3],
  28: [5.8, 1.6, -5.1],
  29: [5.0, 1.3, -5.0],
};
export function driedPelvis(F: Fig, K: Skin) {
  const s = F.s('pelvis');
  s.m.map.clear();
  sections(s, 21, 29, (y) => {
    const r = PELVIS[Math.floor(y)];
    return r ? { a: r[0], f: r[1], b: r[2], p: 2.3 } : null;
  }, K.hide);
  // hip bones jutting through the hide
  for (const sx of [1, -1]) {
    ell(s, [sx * 6.0, 28.6, 0.3], [0.95, 0.9, 1.35], K.tight);
    ell(s, [sx * 5.4, 27.8, 1.6], [0.8, 0.7, 0.7], mix(K.tight, 0xd8c49c, 0.3));
  }
  // sacrum ridge
  for (let y = 23; y <= 28; y++) for (const x of [-1, 0]) s.m.set(x, y, -6, y & 1 ? K.tight : res(K.hide, x, y, -6) as number);
  return s;
}

// ============================================================================ LIMBS (side s: +1 left, -1 right)
export function driedArm(F: Fig, K: Skin, s1: number) {
  const name = s1 > 0 ? 'arm_l' : 'arm_r';
  if (s1 < 0) F.boneMirror('arm_l', 'arm_r');
  const s = F.s(name);
  hideBones(s, K);
  const X = (x: number) => s1 * x;
  ell(s, [X(8.5), 41.4, 0.0], [2.1, 2.35, 2.2], K.hide); // wasted deltoid
  limbG(s, [X(8.6), 40.2, 0.0], [X(8.5), 34.8, 0.1], (t) => 1.72 - 0.34 * t, K.hide);
  ell(s, [X(8.5), 38.0, 0.95], [1.15, 1.9, 0.85], K.hide); // biceps
  ell(s, [X(8.7), 38.6, -0.95], [1.2, 2.2, 0.9], K.hide); // triceps
  ell(s, [X(8.5), 33.9, -0.1], [1.85, 1.2, 1.45], blendC(K.hide, K.tight, 0.55)); // elbow condyles
  // tendon cord down the inner arm
  lineG(s, [[X(7.0), 40.0, 0.6], [X(7.1), 36.0, 0.8]], K.tight);
  return s;
}

export function driedForearm(F: Fig, K: Skin, s1: number, o: { bone?: boolean; nails?: number } = {}) {
  const name = s1 > 0 ? 'fore_l' : 'fore_r';
  // both claws start from the figure's open left hand (the right fist is for gunslingers)
  if (s1 < 0) F.boneMirror('fore_l', 'fore_r');
  const s = F.s(name);
  const X = (x: number) => s1 * x;
  if (o.bone) {
    // stripped to the bone: the figure's own radius/ulna and finger bones, aged, with a torn cuff of hide at the elbow
    const ab = agedBone(0xb8a27a, 7, 0x6a5434);
    s.m.forEach((x, y, z) => s.m.set(x, y, z, res(ab, x, y, z) as number));
    for (let a = 0; a < Math.PI * 2; a += 0.3) {
      const yy = 31.6 - hash3(Math.round(a * 10), 1, 1) * 1.6;
      s.dot([X(8.5) + Math.sin(a) * 1.7, yy, Math.cos(a) * 1.6 - 0.2], res(K.hide, 0, Math.floor(yy), 0) as number);
    }
    lineG(s, [[X(9.4), 30.2, -1.0], [X(9.8), 28.0, -1.3], [X(9.6), 26.6, -1.0]], K.dark); // dangling sinew
    return s;
  }
  // the claw replaces the figure's hand bones entirely
  s.m.forEach((x, y, z) => {
    if (y < 25) s.m.del(x, y, z);
  });
  hideBones(s, K);
  ell(s, [X(8.5), 31.9, -0.4], [1.7, 1.2, 1.5], blendC(K.hide, K.tight, 0.5)); // olecranon
  ell(s, [X(8.5), 31.5, -1.95], [0.7, 0.85, 0.65], K.tight);
  limbG(s, [X(8.6), 31.4, -0.1], [X(8.9), 26.4, 0.0], (t) => 1.6 - 0.5 * t, K.hide);
  ell(s, [X(9.2), 29.9, 0.45], [1.15, 1.7, 1.05], K.hide); // brachioradialis
  ell(s, [X(10.0), 26.5, -0.6], [0.6, 0.6, 0.6], K.tight); // wrist knobs
  ell(s, [X(7.8), 26.7, 0.4], [0.55, 0.55, 0.55], K.tight);
  clawHand(s, K, s1, o.nails ?? 0x1c120b);
  return s;
}

/** dried claw: hide over the figure's palm, four long hooked fingers with dark nails, a thumb */
export function clawHand(s: Sc, K: Skin, s1: number, nail: number) {
  const X = (x: number) => s1 * x;
  ell(s, [X(9.0), 23.1, 0.0], [2.05, 2.25, 2.0], K.hide);
  // tendons on the back of the hand
  for (const x of [8.0, 9.4]) lineG(s, [[X(x), 25.0, -2.0], [X(x), 21.6, -1.9]], K.tight);
  const len = [3.4, 4.6, 4.4, 3.2];
  for (let k = 0; k < 4; k++) {
    const x = X(7.5 + k);
    const L = len[k];
    const tone = k & 1 ? mulRGB(K.base, 0.92) : K.base;
    const col = (t: number) => (t < 0.12 ? K.tight : t > 0.86 ? nail : tone);
    lineG(s, [[x, 21.2, 0.4], [x, 21.2 - L * 0.5, 0.9], [x, 21.2 - L * 0.85, 1.9], [x, 21.2 - L, 2.8]], col);
  }
  lineG(s, [[X(6.6), 23.6, 1.2], [X(6.1), 21.8, 2.3], [X(6.5), 20.4, 3.0], [X(6.8), 19.7, 3.4]], (t) => (t > 0.8 ? nail : K.base));
}

export function driedThigh(F: Fig, K: Skin, s1: number) {
  const name = s1 > 0 ? 'thigh_l' : 'thigh_r';
  if (s1 < 0) F.boneMirror('thigh_l', 'thigh_r');
  const s = F.s(name);
  hideBones(s, K);
  const X = (x: number) => s1 * x;
  limbG(s, [X(3.7), 23.2, 0.2], [X(3.5), 17.4, 0.3], (t) => 2.3 - 0.55 * t, K.hide);
  ell(s, [X(3.8), 20.2, 1.25], [1.6, 2.5, 1.1], K.hide); // quadriceps
  ell(s, [X(3.4), 20.8, -1.15], [1.5, 2.4, 1.0], K.hide); // hamstrings
  ell(s, [X(5.7), 22.9, -0.2], [0.8, 1.0, 0.9], K.tight); // greater trochanter
  ell(s, [X(3.5), 16.8, 0.3], [1.95, 1.35, 1.8], blendC(K.hide, K.tight, 0.5)); // knee condyles
  return s;
}

export function driedShin(F: Fig, K: Skin, s1: number, o: { nails?: number; crust?: boolean } = {}) {
  const name = s1 > 0 ? 'shin_l' : 'shin_r';
  if (s1 < 0) F.boneMirror('shin_l', 'shin_r');
  const s = F.s(name);
  hideBones(s, K);
  const X = (x: number) => s1 * x;
  ell(s, [X(3.5), 14.8, 0.2], [1.85, 1.15, 1.6], blendC(K.hide, K.tight, 0.4)); // tibial plateau
  ell(s, [X(3.5), 15.0, 2.0], [0.9, 1.0, 0.75], K.tight); // kneecap
  limbG(s, [X(3.5), 13.8, -0.3], [X(3.5), 4.8, -0.2], (t) => 1.45 - 0.45 * t, K.hide);
  ell(s, [X(3.45), 11.4, -1.1], [1.3, 2.6, 1.0], K.hide); // calf
  coatG(s, (x, y, z) => y > 6 && y < 13.6 && z > 0.6 && Math.abs(x - X(3.5)) < 0.8, K.tight); // shin bone ridge
  ell(s, [X(2.2), 4.0, -0.2], [0.7, 0.7, 0.7], K.tight); // ankle bones
  ell(s, [X(4.8), 4.4, -0.3], [0.7, 0.7, 0.7], K.tight);
  // bony bare foot over the figure's foot
  ell(s, [X(3.9), 1.3, -1.9], [1.8, 1.4, 1.5], K.hide); // heel
  ell(s, [X(3.9), 1.0, 1.6], [1.95, 1.1, 2.9], K.hide); // arch
  for (let k = 0; k < 4; k++) {
    const x = X(2.5 + k);
    lineG(s, [[x, 1.6, 0.4], [x, 0.9, 4.0]], K.tight); // tendons
    const tip = k === 0 ? 6.4 : 5.9 - k * 0.15;
    lineG(s, [[x, 0.5, 4.0], [x, 0.5, tip]], (t) => (t > 0.75 ? o.nails ?? 0x1c120b : K.base));
  }
  cutG(s, (x, y) => y < 0); // never below the sole
  if (o.crust !== false) coatG(s, (x, y, z) => y < 1.2 + noise.n3(x / 1.8, y, z / 1.8) * 0.7, dusty(K, 5));
  return s;
}

// ============================================================================ HEAD (hide over Sundown's skull)
const isTeeth = (x: number, y: number, z: number) => y === 48 && z === 5 && x >= -4 && x <= 3;
const isMouth = (y: number, z: number) => y === 47 && z >= 2;
const isSocket = (x: number, y: number, z: number) => ((x >= 0 && x <= 4) || (x >= -5 && x <= -1)) && y >= 51 && y <= 56 && z >= 1 && z <= 4;
const isNose = (x: number, y: number, z: number) => (x === -1 || x === 0) && y >= 50 && y <= 51 && z >= 3 && z <= 4;

export function driedHead(F: Fig, K: Skin, o: { seed: number; crust?: boolean; patch?: 'brow' | 'temple' | 'none'; hair?: boolean; paint?: boolean }) {
  const s = F.s('head');
  const m = s.m;
  const sock = [0x3a2416, 0x2e1c10, 0x24150c];
  const recolor: [number, number, number, number][] = [];
  m.forEach((x, y, z) => {
    if (isTeeth(x, y, z)) {
      const gap = x === 2 || x === -4;
      recolor.push([x, y, z, gap ? CAVITY : (x & 1) ? 0xa68c5e : 0xbca274]);
    } else if (isMouth(y, z)) recolor.push([x, y, z, z === 5 ? -1 : CAVITY]);
    else if (isSocket(x, y, z)) recolor.push([x, y, z, sock[Math.min(2, Math.max(0, 4 - z))]]);
    else if (isNose(x, y, z)) recolor.push([x, y, z, CAVITY]);
    else if (isSurf(m, x, y, z)) recolor.push([x, y, z, res(K.hide, x, y, z) as number]);
  });
  for (const [x, y, z, c] of recolor) {
    if (c < 0) m.del(x, y, z);
    else m.set(x, y, z, c);
  }
  for (const sx of [1, -1]) {
    const X = (x: number) => (sx > 0 ? x : -1 - x);
    // cheekbones poking through, sunken cheeks beneath
    for (const [x, y, z] of [[4, 51, 4], [4, 51, 5], [5, 51, 4], [5, 51, 3], [5, 50, 3], [5, 50, 4]] as G[]) if (m.has(X(x), y, z)) m.set(X(x), y, z, res(K.bone, X(x), y, z) as number);
    m.set(X(5), 51, 5, res(K.bone, X(5), 51, 5) as number);
    for (const [x, y] of [[3, 49], [4, 49], [3, 50], [4, 50]] as [number, number][]) {
      m.del(X(x), y, 5);
      m.set(X(x), y, 4, K.dark);
    }
    // dried eyelids: a drooping upper lid and sagging corners make an almond opening
    for (let i = 1; i <= 4; i++) m.set(X(i), 55, 5, i === 1 || i === 4 ? K.base : mix(K.base, K.dark, 0.35));
    m.set(X(2), 55, 4, K.dark).set(X(3), 55, 4, K.dark);
    m.set(X(1), 52, 5, K.base).set(X(4), 52, 5, K.base);
    // shrivelled ear on the side of the skull
    const ex = sx > 0 ? 6 : -7;
    for (const [y, z] of [[51, -2], [52, -2], [53, -2], [54, -2], [54, -1], [53, 0], [52, 0], [51, -1]] as [number, number][]) m.set(ex, y, z, y >= 54 ? K.tight : mix(res(K.hide, ex, y, z) as number, K.dark, 0.2));
    for (const y of [52, 53]) m.set(ex, y, -1, K.dark);
  }
  // collapsed nose ridge over the nostril holes
  for (const x of [-1, 0]) for (const y of [51, 52, 53]) m.set(x, y, 6, y === 51 ? mix(K.base, K.dark, 0.4) : res(K.hide, x, y, 6) as number);
  // upper lip pulled back from the teeth: a dark curled rim
  for (let x = -3; x <= 2; x++) {
    m.set(x, 49, 5, mix(K.base, K.dark, 0.55));
    if (hash3(x, 4, o.seed) > 0.55) m.set(x, 49, 6, K.dark);
  }
  // bone showing where the hide tore away
  if (o.patch === 'brow') {
    for (let x = 1; x <= 4; x++) for (let y = 58; y <= 60; y++) if (!(x === 4 && y === 60)) for (const z of [4, 5]) if (m.has(x, y, z) && isSurf(m, x, y, z)) m.set(x, y, z, res(K.bone, x, y, z) as number);
    for (const [x, y] of [[0, 59], [1, 61], [3, 61], [5, 59], [2, 57], [4, 57]] as [number, number][]) if (m.has(x, y, 5)) m.set(x, y, 5, mix(K.tight, 0xb89870, 0.2));
  } else if (o.patch === 'temple') {
    for (let y = 54; y <= 58; y++) for (let z = -2; z <= 2; z++) if (m.has(-6, y, z) && !(y === 58 && z === 2)) m.set(-6, y, z, res(K.bone, -6, y, z) as number);
  }
  // hairline cracks over the cranium
  const crackCol = mix(K.base, 0x140c08, 0.6);
  for (const pts of [[[2, 62.5, 2], [3.5, 60.5, 4.5], [4.5, 58, 5.8]], [[-3, 62, -4], [-5.5, 58.5, -6], [-6.4, 56, -3]]] as G[][])
    coatG(s, (x, y, z) => distPoly(pts, x, y, z) < 0.62, crackCol);
  // dust caked on the crown and the back of the skull (patchy, mixed into the hide)
  if (o.crust !== false) {
    const dust = dusty(K, o.seed + 2);
    coatG(s, (x, y, z) => (y > 60.4 && noise.n3(x / 2.2, y / 2.2, z / 2.2 + o.seed) > -0.1) || (y > 56 && z < -6 && noise.n3(x / 2, y / 2, o.seed) > 0.25), dust);
  }
  // wisps of dry hair at the back of the head
  if (o.hair) for (const [x, len] of [[-4, 5], [-2, 7], [1, 6], [3, 4]] as [number, number][]) lineG(s, [[x + 0.5, 59.5, -7.5], [x + 0.2, 59.5 - len * 0.5, -7.6], [x + 0.7, 59.5 - len, -7.8]], 0x2b1f17);
  // Set war paint: red-ochre drips under the left eye
  if (o.paint !== false) for (let y = 50; y <= 51; y++) if (m.has(2, y, 5)) m.set(2, y, 5, mix(res(K.hide, 2, y, 5) as number, 0x6a2414, 0.55));
  return s;
}

/** mandible under hide: lower lip shrivelled, gappy yellow teeth, a tongue remnant */
export function driedJaw(F: Fig, K: Skin, seed: number) {
  const s = F.s('jaw');
  const m = s.m;
  const todo: [number, number, number, number][] = [];
  m.forEach((x, y, z) => {
    if (y === 46 && z === 5) todo.push([x, y, z, x === 1 || x === -3 ? CAVITY : (x & 1) ? 0xa08658 : 0xb89e70]);
    else if (y === 46 && z >= 1 && z <= 4 && x >= -4 && x <= 3) todo.push([x, y, z, (x === 0 || x === -1) && z <= 3 ? 0x4a2418 : CAVITY]);
    else if (isSurf(m, x, y, z)) todo.push([x, y, z, res(K.hide, x, y, z) as number]);
  });
  for (const [x, y, z, c] of todo) m.set(x, y, z, c);
  for (let x = -3; x <= 2; x++) {
    m.set(x, 45, 5, mix(K.base, K.dark, 0.55));
    if (hash3(x, 9, seed) > 0.6) m.set(x, 45, 6, K.dark);
  }
  for (const sx of [1, -1]) lineG(s, [[sx * 5.2, 48.2, -2.4], [sx * 5.1, 46.4, -0.6]], K.tight); // masseter cords
  return s;
}

/** shrivelled, cloudy eyeballs sunk deep in the sockets (modelled, no glow) — or a dim ember for alphas */
export function driedEyes(F: Fig, o: { ember?: boolean } = {}) {
  for (const sx of [1, -1]) {
    const name = sx > 0 ? 'eye_l' : 'eye_r';
    const m = new VoxelModel(name);
    const X = (x: number) => (sx > 0 ? x : -1 - x);
    for (const i of [2, 3])
      for (const y of [53, 54]) {
        const x = X(i);
        const glint = y === 54 && i === (sx > 0 ? 2 : 3);
        m.set(x, y, 2, 0x3a3024);
        const front = glint ? 0xd4ccb8 : y === 53 ? (i === 2 ? 0x8a8068 : 0x7a705a) : 0xa29a84;
        m.set(x, y, 3, front);
      }
    if (o.ember) m.set(X(sx > 0 ? 3 : 2), 53, 3, 0xff6a2a, VF.EMISSIVE);
    F.setModel(name, m);
  }
}

/** brow ridges: hide over the bony rim, overhanging the sunken sockets */
export function driedBrows(F: Fig, K: Skin) {
  for (const sx of [1, -1]) {
    const name = sx > 0 ? 'brow_l' : 'brow_r';
    const s = F.s(name);
    const X = (x: number) => (sx > 0 ? x : -1 - x);
    for (let i = 1; i <= 4; i++) {
      s.m.set(X(i), 56, 5, mix(K.tight, K.base, 0.35));
      s.m.set(X(i), 56, 6, i === 1 ? K.base : res(K.hide, X(i), 56, 6) as number);
    }
  }
}

/** the whole desiccated body (no clothes) */
export function driedBody(F: Fig, o: DriedOpts) {
  const K = skinOf(o.skin, o.seed);
  driedTorso(F, K, o);
  driedPelvis(F, K);
  for (const s1 of [1, -1]) {
    driedArm(F, K, s1);
    driedForearm(F, K, s1, { bone: s1 < 0 && !!o.boneArmR });
    driedThigh(F, K, s1);
    driedShin(F, K, s1, { crust: o.crust });
  }
  driedJaw(F, K, o.seed);
  driedBrows(F, K);
  if (o.crust !== false) {
    // sand caked on the shoulders and the upper back
    const dust = dusty(K, o.seed + 9);
    coatG(F.s('torso'), (x, y, z) => y > 42.6 + noise.n2(x * 0.6, z * 0.6 + o.seed) * 1.1 && z < 1 && noise.n3(x / 2, y / 2, z / 2) > -0.2, dust);
    for (const n of ['arm_l', 'arm_r']) coatG(F.s(n), (x, y, z) => y > 42.4 + noise.n2(x * 0.7 + o.seed, z * 0.7) * 0.8 && noise.n3(x / 2, y / 2, z / 2 + 3) > -0.1, dust);
  }
  return K;
}

/** sun-baked dust in the hide's own tones (not a pale cap) */
export function dusty(K: Skin, seed: number): CSpec {
  const a = mix(K.base, SAND.c, 0.3), b = mix(K.base, SAND.b, 0.2), c = mix(K.base, SAND.c, 0.4);
  return tones(b, a, c, 2.6, seed);
}
/** repaint every voxel of a part (the bare figure bones) with hide before fleshing it out */
export function hideBones(s: Sc, K: Skin) {
  s.m.forEach((x, y, z) => s.m.set(x, y, z, res(K.hide, x, y, z) as number));
}

/** frontmost voxel z of a column (x, y) */
export function frontZ(m: VoxelModel, x: number, y: number) {
  for (let z = 16; z >= -16; z--) if (m.has(x, y, z)) return z;
  return 0;
}
/** outermost (+x) voxel of a row (y, z) */
export function sideX(m: VoxelModel, y: number, z: number) {
  for (let x = 16; x >= -16; x--) if (m.has(x, y, z)) return x;
  return 0;
}
/** set a voxel and fill toward the body (dz = +1 inward for back studs) until solid (max 3) */
export function studZ(m: VoxelModel, x: number, y: number, z: number, dz: number, c: number) {
  m.set(x, y, z, c);
  for (let k = 1; k <= 3; k++) {
    if (m.has(x, y, z + dz * k)) return;
    m.set(x, y, z + dz * k, c);
  }
}
/** distance from point to a polyline */
export function distPoly(pts: G[], x: number, y: number, z: number) {
  let best = 1e9;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const d: G = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const L2 = d[0] * d[0] + d[1] * d[1] + d[2] * d[2] || 1e-9;
    const t = Math.max(0, Math.min(1, ((x - a[0]) * d[0] + (y - a[1]) * d[1] + (z - a[2]) * d[2]) / L2));
    best = Math.min(best, Math.hypot(x - a[0] - d[0] * t, y - a[1] - d[1] * t, z - a[2] - d[2] * t));
  }
  return best;
}

export { blendC, res as resolve };
