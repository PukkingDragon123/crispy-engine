// (dayGlass.ts) The Day Glass and the hand that shakes it (TIME HUD, ui/HourglassHud.ts).
//
// HOURGLASS (1 unit = 1 voxel, neck at the origin, 66 voxels tall): two ebony end
// caps carved as lotus capitals (scalloped petal rim, a brass band with rivets, a
// turned finial, a few honest chips of wear), three bone spindles turned like
// vertebrae (beads, grooves, flared collars) and a blown-glass double bulb with a
// real pinched neck. The sand is not one mesh: SAND_STAGES pre-built fills for the
// top bulb (draining, with the funnel dip over the neck) and the bottom bulb (a
// heap at the angle of repose that grows and spreads), swapped as time runs; a
// stream of single grains falls through the neck.
//
// BONE HAND (rig, 1 unit = 1 cm, voxel size 1/K): Sundown's right gun hand as it
// reaches in from the edge of the screen. Clean bleached bone: radius and ulna with
// their styloid heads, the three amber-chitin gauntlet bands and the curved pincer
// spur of his gauntlet, a black leather strap, a cluster of carpals, four
// metacarpals with knuckle knobs and three phalanges per finger, a three-bone
// thumb. Canonical pose: wrist at the origin, forearm along +X (elbow at x = 46),
// fingers along -X, palm facing -Y, index on the +Z side.
// Parts: fore (root, pivot wrist) -> palm (pivot wrist) -> f1_1..f1_3 .. f4_1..f4_3
// (pivot at each knuckle, flex = +Z rotation), t_1 -> t_2 -> t_3 (thumb; flex axis
// meta.thumbAxis). meta.knuckles / meta.palmCentre for the HUD's grip maths.
import { VoxelModel, VF } from '../../../engine/voxel/VoxelModel';
import type { RigSpec, PartSpec, V3 } from '../../../engine/voxel/Rig';
import { Sc, shadeRamps, lerp, vadd, vsub, vmul, vnorm, vcross } from '../characters/sculpt';
import type { Ramp } from '../style';

const ramp = (base: number, shade: number, hi: number, dark: number): Ramp => ({ base, shade, hi, dark });
// Sundown's own bone and chitin (characters/sundown.ts)
const BN = ramp(0xf4ddb6, 0xe2c79a, 0xfcebcf, 0xb8936a);
const CHI = ramp(0x9c5c26, 0x713f19, 0xd28d3e, 0x4a2a12);
const LEA = ramp(0x302e33, 0x211f24, 0x58555e, 0x141316);
const EBONY = ramp(0x4a2818, 0x2e170c, 0x6e3e24, 0x1a0c06);
const BRASS = ramp(0xc8962e, 0x8a5a1a, 0xf2cf6a, 0x4a300c);
const GLASS = 0xcfe6f2;
const GLASS_EDGE = 0xf4fbff;
const SAND = [0xe9c47c, 0xdcb06a, 0xf2d496, 0xd0a25c];

const hash = (x: number, y: number, z: number) => {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return s - Math.floor(s);
};

// ================================================================== HOURGLASS
/** half height of the glass (voxels): the bulbs run from -GLASS_H to +GLASS_H */
export const GLASS_H = 25;
/** inner radius of the glass at height y (voxels): a blown double bulb with a pinched neck */
export function glassR(y: number) {
  const u = Math.min(1, Math.abs(y) / (GLASS_H + 0.5));
  return 1.25 + 11.9 * Math.pow(Math.sin(u * Math.PI * 0.9), 0.95);
}
export const SAND_STAGES = 18;
export const HOURGLASS_HEIGHT = 66;

function capital(m: VoxelModel, sgn: number) {
  // layers outward from the glass: collar, lotus rim, brass band, cap, finial
  const y0 = sgn > 0 ? GLASS_H + 1 : -GLASS_H - 1;
  const layers: [number, (a: number, h: number) => number, (x: number, z: number, a: number, d: number) => number][] = [];
  const woodCol = (x: number, z: number, a: number, d: number) => {
    // turned grain: rings with the odd darker streak along the turning
    const ring = Math.sin(d * 1.7 + Math.sin(a * 3) * 0.6);
    const streak = hash(Math.round(a * 9), 0, 3) > 0.82;
    return streak ? EBONY.shade : ring > 0.55 ? EBONY.hi : EBONY.base;
  };
  layers.push([0, () => 7.5, woodCol]); // collar hugging the glass
  layers.push([1, (a) => 15.5 + 1.4 * Math.pow(Math.abs(Math.cos(a * 6)), 0.6), woodCol]); // lotus petals
  layers.push([2, (a) => 17.4 + 1.6 * Math.pow(Math.abs(Math.cos(a * 6)), 0.5), woodCol]);
  layers.push([3, () => 19.2, (x, z, a) => (Math.abs(((a / (Math.PI * 2)) * 12) % 1 - 0.5) < 0.07 ? BRASS.hi : BRASS.base)]); // brass band
  layers.push([4, () => 19.6, (x, z, a) => (Math.abs(((a / (Math.PI * 2)) * 12) % 1 - 0.5) < 0.07 ? BRASS.hi : BRASS.base)]);
  layers.push([5, () => 18.6, woodCol]);
  layers.push([6, () => 17.0, woodCol]); // the cap's bevel
  layers.push([7, () => 13.0, woodCol]);
  for (const [li, rf, cf] of layers) {
    const y = y0 + sgn * li;
    for (let x = -21; x <= 21; x++)
      for (let z = -21; z <= 21; z++) {
        const d = Math.hypot(x + 0.5, z + 0.5);
        const a = Math.atan2(z + 0.5, x + 0.5) + Math.PI;
        const R = rf(a, li);
        if (d > R) continue;
        // honest wear: a few chips knocked out of the rim
        if (d > R - 1.2 && hash(x, li, z * sgn) > 0.93) continue;
        const flags = li === 3 || li === 4 ? VF.SOLID | VF.METAL : VF.SOLID;
        m.set(x, y, z, cf(x, z, a, d), flags);
      }
  }
  // rivets on the brass band
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 + Math.PI / 12;
    const x = Math.round(Math.cos(a) * 20.2 - 0.5), z = Math.round(Math.sin(a) * 20.2 - 0.5);
    for (const dy of [3, 4]) m.set(x, y0 + sgn * dy, z, dy === 3 ? BRASS.hi : BRASS.shade, VF.SOLID | VF.METAL);
  }
  // the turned finial: a knob and a ring
  for (let k = 8; k <= 10; k++) {
    const R = k === 8 ? 7 : k === 9 ? 5 : 3;
    for (let x = -R; x <= R; x++)
      for (let z = -R; z <= R; z++) if (Math.hypot(x + 0.5, z + 0.5) <= R) m.set(x, y0 + sgn * k, z, k === 9 ? BRASS.base : EBONY.base, k === 9 ? VF.SOLID | VF.METAL : VF.SOLID);
  }
}

function spindles(m: VoxelModel) {
  // three bone posts, two in front (framing the glass), one behind
  for (const ang of [Math.PI * 0.17, Math.PI * 0.83, Math.PI * 1.5]) {
    const cx = Math.cos(ang) * 16.2, cz = Math.sin(ang) * 16.2;
    for (let y = -GLASS_H - 1; y <= GLASS_H + 1; y++) {
      const t = Math.abs(y) / (GLASS_H + 1);
      // vertebra beads, a long waist, collars flaring into the caps
      const bead = 0.55 * Math.pow(Math.abs(Math.sin(y * 0.52)), 3);
      const collar = Math.pow(t, 10) * 1.6;
      const R = 1.55 + bead + collar - 0.25 * Math.sin(t * Math.PI);
      const groove = Math.abs(Math.sin(y * 0.52)) < 0.18;
      for (let x = Math.floor(cx - 4); x <= Math.ceil(cx + 4); x++)
        for (let z = Math.floor(cz - 4); z <= Math.ceil(cz + 4); z++) {
          const d = Math.hypot(x + 0.5 - cx, z + 0.5 - cz);
          if (d > R) continue;
          m.set(x, y, z, groove ? BN.shade : hash(x, y, z) > 0.9 ? BN.hi : BN.base);
        }
    }
  }
  shadeRamps(m, [BN], true);
}

/** ebony caps + bone spindles */
export function hourglassFrame(): VoxelModel {
  const m = new VoxelModel('dayglass_frame');
  spindles(m);
  capital(m, 1);
  capital(m, -1);
  shadeRamps(m, [EBONY], false);
  return m;
}

/** the glass shell (drawn with the HUD's see-through material) */
export function hourglassGlass(): VoxelModel {
  const m = new VoxelModel('dayglass_glass');
  for (let y = -GLASS_H; y <= GLASS_H; y++) {
    const r = glassR(y + 0.5);
    for (let x = -15; x <= 15; x++)
      for (let z = -15; z <= 15; z++) {
        const d = Math.hypot(x + 0.5, z + 0.5);
        if (d > r + 1 || d < r) continue;
        // a pale catch-light running down the left of each bulb
        const a = Math.atan2(z + 0.5, x + 0.5);
        m.set(x, y, z, Math.abs(a - 2.2) < 0.35 ? GLASS_EDGE : GLASS, VF.SOLID | VF.SOFTAO);
      }
  }
  return m;
}

function sandCol(x: number, y: number, z: number, top: boolean) {
  if (top) return SAND[2];
  const h = hash(x, y, z);
  return h > 0.86 ? SAND[3] : h > 0.55 ? SAND[1] : SAND[0];
}

/** interior volume of one bulb between the neck and height h (voxel count, for level finding) */
function bulbCells() {
  const cells: { x: number; y: number; z: number; d: number }[] = [];
  for (let y = 1; y < GLASS_H; y++) {
    const r = glassR(y + 0.5) - 0.35;
    for (let x = -14; x <= 14; x++)
      for (let z = -14; z <= 14; z++) {
        const d = Math.hypot(x + 0.5, z + 0.5);
        if (d <= r) cells.push({ x, y, z, d });
      }
  }
  return cells;
}

/**
 * The sand fills: top[k] holds k / (STAGES - 1) of the charge (draining from the neck up, the
 * surface dipping into a funnel over the neck), bottom[k] the heap for that share fallen through.
 */
export function hourglassSand() {
  const cells = bulbCells();
  const charge = Math.round(cells.length * 0.72);
  const top: VoxelModel[] = [], bottom: VoxelModel[] = [];
  for (let k = 0; k < SAND_STAGES; k++) {
    const f = k / (SAND_STAGES - 1);
    // ---- top bulb: rank cells by "how late they drain" (low and away from the neck stays longest)
    const tm = new VoxelModel('sand_top_' + k);
    const n = Math.round(charge * f);
    if (n > 0) {
      const ranked = cells.map((c) => ({ c, s: c.y + 2.6 * Math.exp(-(c.d * c.d) / 18) * (f < 0.98 ? 1 : 0) })).sort((a, b) => a.s - b.s);
      const keep = ranked.slice(0, n);
      const set = new Set(keep.map((e) => `${e.c.x},${e.c.y},${e.c.z}`));
      for (const { c } of keep) tm.set(c.x, c.y, c.z, sandCol(c.x, c.y, c.z, !set.has(`${c.x},${c.y + 1},${c.z}`)));
    }
    top.push(tm);
    // ---- bottom bulb: a heap at the angle of repose (surface y = peak - slope * d), mirrored below the neck
    const bm = new VoxelModel('sand_bot_' + k);
    const want = Math.round(charge * (1 - f));
    if (want > 0) {
      // the heap height that holds `want` grains: search
      let lo = 0, hi = GLASS_H * 2;
      const surf = (h: number, d: number) => h - 0.62 * d;
      const count = (h: number) => {
        let c = 0;
        for (const e of cells) if (GLASS_H - e.y < surf(h, e.d)) c++;
        return c;
      };
      for (let it = 0; it < 18; it++) {
        const mid = (lo + hi) / 2;
        if (count(mid) < want) lo = mid;
        else hi = mid;
      }
      const H = hi;
      for (const e of cells) {
        const ht = GLASS_H - e.y; // height above the bottom bulb's floor
        if (ht >= surf(H, e.d)) continue;
        const y = -e.y; // mirrored into the bottom bulb
        const topFace = ht + 1 >= surf(H, e.d);
        bm.set(e.x, y, e.z, sandCol(e.x, y, e.z, topFace));
      }
    }
    bottom.push(bm);
  }
  return { top, bottom };
}

/** one falling grain (the stream and the shaken spray) */
export function sandGrain(): VoxelModel {
  const m = new VoxelModel('sand_grain');
  m.set(0, 0, 0, SAND[2]);
  return m;
}

// ================================================================== BONE HAND
/** voxels per cm of the hand rig */
export const HAND_K = 2.4;
const FZ = [2.75, 0.95, -0.9, -2.6];
const FL: [number, number, number][] = [
  [4.3, 2.6, 1.9],
  [4.8, 3.0, 2.1],
  [4.5, 2.8, 2.0],
  [3.6, 2.1, 1.8],
];
const MC_X = [-8.2, -8.6, -8.3, -7.6];

function forearmPart(s: Sc) {
  const B = BN.base;
  // radius (thumb side, +Z) thick at the wrist; ulna (-Z) thick at the elbow
  s.cap([1.6, 0.1, 1.25], [44, 0.35, 0.75], 1.15, 0.72, B);
  s.ell([1.2, -0.1, 1.55], [1.25, 1.05, 1.15], B); // radial styloid head
  s.cap([2.4, 0.0, -1.35], [45, 0.5, -0.55], 0.62, 0.98, BN.shade);
  s.ell([1.5, 0.05, -1.65], [0.85, 0.8, 0.8], B); // ulnar head
  s.ell([46.2, 0.6, -0.4], [1.6, 1.35, 1.35], B); // olecranon
  s.ell([44.8, 0.4, 1.0], [1.0, 0.9, 0.9], B); // radial head
  // three amber-chitin gauntlet bands flaring toward the elbow, each lapping the next, bone-pale lips
  for (let k = 0; k < 3; k++) {
    const x0 = 3.0 + k * 3.6, x1 = x0 + 3.6;
    s.region([x0, -3.6, -4.2], [x1, 3.6, 4.2], (x, y, z) => {
      const t = (x - x0) / (x1 - x0);
      const R = lerp(2.55, 2.85, k / 2) + 0.45 * t;
      const d = Math.hypot(y / 0.92, z);
      return d < R && d > R - 0.75;
    }, (x) => (x > x1 - 0.45 ? BN.hi : CHI.base));
  }
  // the pincer spur: a curved bone blade swept back along the ulnar side, teeth on its inner edge
  s.path([[2.6, 0.6, -3.1], [7.5, 1.6, -4.3], [13.5, 2.0, -4.2]], (t) => 0.95 - 0.75 * t, (x) => (x > 9 ? BN.hi : BN.base));
  for (const x of [5.2, 7.4, 9.6]) s.cap([x, 1.0, -3.6], [x + 0.9, 0.9, -3.0], 0.3, 0.1, BN.hi);
  // a black leather strap above the gauntlet, its buckle tongue
  s.region([15.5, -3.4, -3.8], [17.3, 3.4, 3.8], (x, y, z) => {
    const d = Math.hypot(y / 0.9, z);
    return d < 2.75 && d > 2.05;
  }, (x) => (x > 16.9 ? LEA.hi : LEA.base));
  s.ell([16.4, 2.6, 0.3], [0.7, 0.45, 0.6], BRASS.base, { flags: VF.SOLID | VF.METAL });
  shadeRamps(s.m, [BN, CHI, LEA], true);
}

function palmPart(s: Sc) {
  const B = BN.base;
  // carpals: two rows of knobbly little bones
  for (const [x, z, r] of [[-0.6, 1.9, 0.75], [-0.7, 0.5, 0.72], [-0.6, -0.9, 0.7], [-0.7, -2.1, 0.62], [-2.0, 2.4, 0.66], [-2.1, 1.0, 0.68], [-2.0, -0.4, 0.66], [-2.0, -1.8, 0.62]] as [number, number, number][])
    s.ell([x, -0.15, z], [r, r * 0.85, r * 0.9], B);
  // metacarpals fanning out to the knuckles
  FZ.forEach((z, i) => {
    s.cap([-2.5, 0.0, z * 0.62], [MC_X[i] + 0.55, 0.05, z], 0.52, 0.44, B);
    s.ell([MC_X[i], 0.05, z], [0.72, 0.68, 0.66], BN.hi); // knuckle
  });
  shadeRamps(s.m, [BN], true);
}

function phalanx(s: Sc, at: V3, dir: V3, len: number, r0: number, r1: number, tip: boolean) {
  const B = BN.base;
  const end = vadd(at, vmul(dir, len));
  s.cap(vadd(at, vmul(dir, 0.28)), vadd(end, vmul(dir, tip ? -0.05 : -0.3)), r0, tip ? 0.16 : r1, B);
  // a waisted shaft: knobbly ends
  s.ell(vadd(at, vmul(dir, 0.38)), [r0 * 1.12, r0 * 1.05, r0 * 1.12], B);
  if (!tip) s.ell(vadd(end, vmul(dir, -0.32)), [r1 * 1.25, r1 * 1.15, r1 * 1.25], BN.hi);
  else s.ell(vadd(end, vmul(dir, -0.55)), [0.33, 0.26, 0.33], BN.hi); // the tuft
}

export interface HandMeta {
  height: number;
  /** knuckle positions (cm, hand space) */
  knuckles: V3[];
  /** where an object sits against the palm (cm, hand space) */
  palmCentre: V3;
  /** the thumb's flex axis (hand space, unit) */
  thumbAxis: V3;
}

/** Sundown's skeletal right hand and forearm, rigged per joint (see the header) */
export function boneHandRig(): RigSpec {
  const K = HAND_K;
  const vx = (p: V3): V3 => [p[0] * K, p[1] * K, p[2] * K];
  const parts: PartSpec[] = [];
  const fore = new Sc('hand_fore', K);
  forearmPart(fore);
  parts.push({ name: 'fore', model: fore.m, pivot: [0, 0, 0], attach: [0, 0, 0] });
  const palm = new Sc('hand_palm', K);
  palmPart(palm);
  parts.push({ name: 'palm', model: palm.m, pivot: [0, 0, 0], attach: [0, 0, 0], parent: 'fore' });
  const knuckles: V3[] = [];
  FZ.forEach((z, i) => {
    let at: V3 = [MC_X[i], 0.05, z];
    knuckles.push(at);
    // the fingers splay a little: index and pinky angle outward
    const dir = vnorm([-1, 0, (z > 0 ? 0.06 : -0.06) * (Math.abs(z) > 2 ? 1.6 : 0.6)]);
    let parent = 'palm';
    FL[i].forEach((len, j) => {
      const s = new Sc(`hand_f${i + 1}_${j + 1}`, K);
      const r0 = [0.5, 0.42, 0.36][j] * (i === 3 ? 0.9 : 1), r1 = [0.44, 0.37, 0.3][j] * (i === 3 ? 0.9 : 1);
      phalanx(s, at, dir, len, r0, r1, j === 2);
      shadeRamps(s.m, [BN], true);
      const name = `f${i + 1}_${j + 1}`;
      parts.push({ name, model: s.m, pivot: vx(at), attach: vx(at), parent });
      parent = name;
      at = vadd(at, vmul(dir, len));
    });
  });
  // the thumb: from the trapezium, angled forward and down, three bones
  const tDir = vnorm([-0.62, -0.38, 0.69]);
  const tLen = [3.6, 2.8, 2.2];
  let at: V3 = [-1.6, -0.35, 2.9];
  let parent = 'palm';
  tLen.forEach((len, j) => {
    const s = new Sc(`hand_t_${j + 1}`, K);
    phalanx(s, at, tDir, len, [0.58, 0.46, 0.38][j], [0.5, 0.4, 0.3][j], j === 2);
    shadeRamps(s.m, [BN], true);
    const name = `t_${j + 1}`;
    parts.push({ name, model: s.m, pivot: vx(at), attach: vx(at), parent });
    parent = name;
    at = vadd(at, vmul(tDir, len));
  });
  const thumbAxis = vnorm(vcross(tDir, [0, -1, 0]));
  const meta: HandMeta = { height: 0.08, knuckles, palmCentre: [-5.2, -1.4, 0.2], thumbAxis };
  void vsub;
  return { name: 'bone_hand', voxelSize: 1 / K, parts, meta: meta as unknown as Record<string, unknown> };
}
