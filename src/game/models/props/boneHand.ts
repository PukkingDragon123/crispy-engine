// (boneHand.ts) Sundown's skeletal gun hand, the one that reaches into the HUD to grab and shake the day
// hourglass (ui/SoulGlassHud.ts).
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
import { VF } from '../../../engine/voxel/VoxelModel';
import type { RigSpec, PartSpec, V3 } from '../../../engine/voxel/Rig';
import { Sc, shadeRamps, lerp, vadd, vsub, vmul, vnorm, vcross } from '../characters/sculpt';
import type { Ramp } from '../style';

// Sundown's own bone and chitin (characters/sundown.ts)
const ramp = (base: number, shade: number, hi: number, dark: number): Ramp => ({ base, shade, hi, dark });
const BN = ramp(0xf4ddb6, 0xe2c79a, 0xfcebcf, 0xb8936a);
const CHI = ramp(0x9c5c26, 0x713f19, 0xd28d3e, 0x4a2a12);
const LEA = ramp(0x302e33, 0x211f24, 0x58555e, 0x141316);
const BRASS = ramp(0xc8962e, 0x8a5a1a, 0xf2cf6a, 0x4a300c);

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
