// "Sundown" HD — the player: a half-dead punk cowboy, rebuilt at 1/54 m with a
// bespoke builder. (The API keeps its old names: skeletonCowboyRig & co.)
//
// DESIGN UNITS: every shape is authored in design units u on the legacy humanoid layout (see
// skeleton.ts J) and rasterised by the sculpt kit (sculpt.ts) at S = 1.5 voxels per unit.
// HEROIC CARTOON PROPORTIONS: the body is not rasterised on that layout as is. Each body part goes
// through a Warp (torso/pelvis, each arm, each leg) onto a lean, heroic figure: about 5.7 heads, 1.71 m to
// the crown, broad shoulders over a V-shaped trunk, long legs, a lean neck. The head family (head, jaw,
// eyes, brows, hair, mask, glasses, cigarette) is not warped: its voxels are exactly as sculpted, on a grid
// (1/96 m) that makes the head 30 cm. Joints / pivots / sockets are the legacy joints mapped through the
// same warps, so every animation that works in joint angles still fits.
// Mirror plane: geometric x = 0. Character LEFT = +X, faces +Z, origin on the ground.
//
// A tough rock-and-roll cowboy (an original design in the spirit of late-80s hard rock), handsome and
// alive: a hard stubbled jaw, an old knife scar on the left cheek, two modelled eyes behind round shades
// (the right iris glows Serket green: the dead are in him), long voluminous curly black hair spilling from
// under the hat in swaying locks (hairSway.ts), a cigarette in the corner of his mouth. The zombie accent is
// small and clean: one gap torn through his right cheek, the side teeth and the bone showing, a couple of
// sinew cords across it and a few black stitches on its rim.
//
// Look ('punk', the default): a sleeveless studded black leather vest over a torn cream band tee (an
// original print), a neckerchief, a bullet bandolier that also slings the board, a studded belt with a loose
// bullet belt slung over it, bare arms (a barbed-wire tattoo), silver rings, studded wristbands and a
// striped sweatband, ripped skinny jeans with a wallet chain, black harness boots with spurs, and a battered
// rocker stetson (tall flat crown, flat brim, conchos and a feather). The outlaw mask is opt-in.
import * as THREE from 'three';
import { VoxelModel, VF } from '../../../engine/voxel/VoxelModel';
import { voxelMesh } from '../../../engine/voxel/Rig';
import type { RigSpec, PartSpec, SocketSpec, V3, RigInstance } from '../../../engine/voxel/Rig';
import { TOON, Ramp } from '../style';
import { defaultExpressions } from '../toon/humanoid';
import { SUNDOWN_EXPRESSIONS } from './skeleton';
import { frogWigHat, FROG_WIG_TOP } from '../enemies/frog';
import type { CowboyLook, HatId, OutfitId } from './skeleton';
import { Sc, Warp, Col, clamp, lerp, sstep, vadd, vsub, vmul, vdot, vcross, vlen, vnorm, distPoly, spline, resample, shadeRamps, splitOff } from './sculpt';
import { SKIN as SKIN_SHARED, STUB, STUB_DOT, SCAR, LIP, NAIL, BROWHAIR, HEYE, ROT, BRUISE, MEAT, SINEW, CAVITY, THREAD_BLK, HAIR, HAIR_ALT, HAIR_TIP, HAIR_GREY, rng, vhash, dedupe, skinOver, rotEdgeCol, blotch, markBone, boneEdgeCol, stitch, strand, splitY } from './fleshKit';
import { installHairSway, type HairChain } from './hairSway';

/** metres per voxel of the HD player build */
export const SUNDOWN_HD_VS = 1 / 96;
const S = 1.5; // voxels per design unit
/** metres per output unit (one design unit of the unwarped head family) */
const UH = S * SUNDOWN_HD_VS;
const ramp = (base: number, shade: number, hi: number, dark: number): Ramp => ({ base, shade, hi, dark });

// ================================================================== PALETTE
const BN = ramp(0xf4ddb6, 0xe2c79a, 0xfcebcf, 0xb8936a);
const ENAMEL = 0xfff4de;
const SOCK = { wall: 0x7a4a2a, mid: 0x55331d, deep: 0x311c0f, void: 0x170d07 };
const EYE = { ball: 0x15110e, ring: 0x3fbf24, iris: 0x2a6a1a, core: 0xa8ff4a, glint: 0xf4ffe6, dim: 0x3c4438 };
const LEA = ramp(0x302e33, 0x211f24, 0x58555e, 0x141316); // black biker leather, cool sheen
const LEA_EDGE = 0x67626c;
const CHR = ramp(0xb6bec9, 0x6f7682, 0xf4f8ff, 0x444952);
const FLAME = [0xffd64e, 0xf68a22, 0xdc3a1a];
const FLAME_LINE = 0x8e1c10;
const DEN = ramp(0x3d5379, 0x2d3e5d, 0x5d77a2, 0x1e2a41);
const THREAD = 0xd9a03e;
const FRAY = 0xe6dfcf;
const COPPER = 0xc87a3a;
const STRAP = ramp(0x84502c, 0x663c20, 0xa36a40, 0x3e2414);
const BOOT = ramp(0x2c2729, 0x1d191b, 0x4a4246, 0x0f0d0e);
const SOLE = 0x1b1513;
const HEEL = ramp(0x4b3527, 0x37261b, 0x604534, 0x22150d);
const STITCH = 0x9c9aa4;
const VENOM = 0x8cf03c;
/** his living skin: a warm, clean sun-tan (Sundown's own ramp; fleshKit's SKIN stays as the shared default) */
const SKIN = ramp(0xcf9a74, 0xad7a58, 0xe2b48e, 0x7a4b36);
void SKIN_SHARED;
/** a clean five-o'clock shadow: one tone between skin and shade, sparse darker flecks */
const STUBBLE = 0xa8775a, STUBBLE_FLECK = 0x8a5d43;
/** the cheek gap's rim: a clean dark outline, not a wound */
const GAP_RIM = 0x3d2a24;
const M = VF.METAL;
markBone(BN.base, BN.shade, BN.hi, ENAMEL);

// ================================================================== JOINTS (design units, identical to the legacy grid)
const J: Record<string, V3> = {
  pelvis: [0, 26.5, -1.5],
  waist: [0, 29.5, -4.5],
  neck: [0, 46, -1.5],
  jaw: [0, 49.5, -2],
  eye: [3, 54, 6],
  brow: [3, 56.5, 5.5],
  hat: [0, 59, -1],
  shoulder: [8, 42.5, 0],
  elbow: [8, 33, 0],
  hand: [9, 21.5, 0],
  hip: [4, 24, 0],
  knee: [3.5, 15.5, 0],
};
const SKULL_TOP = 63;
const mg = (p: V3): V3 => [-p[0], p[1], p[2]];
const vx = (p: V3): V3 => [p[0] * S, p[1] * S, p[2] * S];

// ================================================================== PROPORTION WARPS (design layout -> heroic cartoon figure, output units)
// HEROIC CARTOON PROPORTIONS (user note, latest: "more cartoon but handsome, not weird"): an animated-film
// lead, about 5.7 heads to the crown (1.71 m), broad shoulders over a V-shaped trunk, a slim waist and narrow
// hips, long lean legs, a lean neck, hands and boots a touch stylized. The head family keeps its exact sculpt;
// the grid (1/96 m) sets its size (30 cm), and the warps below fit the body to it.
/** the head family sits HEAD_DY output units above its design height (an integer number of voxels: 69) */
const HEAD_DY = 46;
/** trunk width and depth by design height (output units per design unit): narrow hips, a slim waist, a broad
 *  chest and shoulders (the V), a lean neck */
const BODY_KX: [number, number][] = [[24, 1.3], [27.5, 1.22], [31, 1.16], [35, 1.3], [38.5, 1.5], [41.5, 1.66], [43.4, 1.66], [45.6, 1.32]];
const BODY_KZ: [number, number][] = [[24, 1.16], [29, 1.06], [32, 1.06], [36, 1.24], [40.5, 1.32], [43.4, 1.3], [45.6, 1.22]];
/** height map of the trunk and legs: ankle 8 cm, knee 47 cm, hip 86 cm, waist 1.0 m, shoulder joint 1.34 m, a lean
 *  neck, chin 1.41 m, crown 1.71 m */
const Y_BODY: [number, number][] = [[0, 0], [3, 5.2], [15.5, 30], [24, 55], [29.5, 64.5], [36, 75], [42.5, 85.6], [44, 88.6], [46, 92], [52, 99]];
/** height map of the hanging arm: elbow 1.05 m, wrist 0.83 m, grip 0.75 m, fingertips at mid-thigh */
const Y_ARM: [number, number][] = [[15, 41.2], [21.5, 48.3], [25.6, 52.9], [33, 67.4], [42.5, 85.6], [52, 99]];
/** the trunk (x and z scale with height; the neck column stays centred under the head) */
const W_BODY = new Warp(Y_BODY, BODY_KX, BODY_KZ, 0, 0, -1.5, -1.5);
/** output x of a design-x limb axis on the trunk at height y, and the output z of design z = 0 there */
const KX_AT = (y: number) => W_BODY.kx(y);
const Z0_AT = (y: number) => -1.5 + 1.5 * W_BODY.kz(y);
const Z0 = Z0_AT(42.5);
/** arms: lean, long; hands a touch broad (stylized, not clubby); the shoulder cap a little tighter */
const W_ARM = (s: number) => new Warp(Y_ARM, [[23.6, 1.72], [25.6, 1.78], [33, 1.92], [40.5, 2.08], [43.5, 1.86]], [[23.6, 1.8], [25.6, 1.78], [33, 1.9], [40.5, 2.0], [43.5, 1.8]], s * 8, s * 8 * KX_AT(42.5), 0, Z0);
/** legs: long and lean, slim knees, worn boots with a little heft at the foot */
const W_LEG = (s: number) => new Warp(Y_BODY, [[1, 1.74], [5, 1.66], [12, 1.62], [20, 1.84]], [[1, 1.7], [5, 1.6], [12, 1.62], [20, 1.78]], s * 4, s * 4 * KX_AT(24), 0, Z0_AT(24));
const WA_L = W_ARM(1), WA_R = W_ARM(-1), WL_L = W_LEG(1), WL_R = W_LEG(-1);
/** the cowboy hats are sculpted on their own design (the rocker crown); a hair over life size round the hat pivot */
const W_HAT = new Warp([[50, 50], [59, 59], [75, 75]], [[56, 1.04], [66, 1.03]], [[56, 1.04], [66, 1.03]], 0, 0, -0.9, -0.9);
const STETSONS: HatId[] = ['stetson', 'bandit'];
/** the warp new sculpts are made with (null: the unwarped head family) */
let WARP: Warp | null = null;
const sc = (name: string) => new Sc(name, S, WARP);
function warped<T>(w: Warp | null, f: () => T): T {
  const prev = WARP;
  WARP = w;
  try {
    return f();
  } finally {
    WARP = prev;
  }
}
/** design point -> output point through w (null: the head family, lifted by HEAD_DY) */
const toOut = (w: Warp | null, p: V3): V3 => (w ? w.fwd(p) : [p[0], p[1] + HEAD_DY, p[2]]);
/** dedupe a body model against a head-family model (which sits HEAD_DY * S voxels higher in rig space) */
function dedupeLifted(body: VoxelModel, headFam: VoxelModel) {
  const dy = HEAD_DY * S, del: V3[] = [];
  body.forEach((x, y, z) => {
    if (headFam.has(x, y - dy, z)) del.push([x, y, z]);
  });
  for (const [x, y, z] of del) body.del(x, y, z);
}
const pw = (v: number, p: number) => Math.pow(Math.abs(v), p);

// ================================================================== BODY ENVELOPES (garments are shells around these)
/** rows: [y, half width x, half depth z, centre z]; smooth-interpolated in y */
type Env = [number, number, number, number][];
function envAt(e: Env, y: number): [number, number, number] {
  if (y <= e[0][0]) return [e[0][1], e[0][2], e[0][3]];
  for (let i = 1; i < e.length; i++)
    if (y <= e[i][0]) {
      const a = e[i - 1], b = e[i], t = sstep((y - a[0]) / (b[0] - a[0]));
      return [lerp(a[1], b[1], t), lerp(a[2], b[2], t), lerp(a[3], b[3], t)];
    }
  const l = e[e.length - 1];
  return [l[1], l[2], l[3]];
}
const EP = 2.5;
function rhoOf(e: Env, x: number, y: number, z: number) {
  const [hx, hz, zc] = envAt(e, y);
  return Math.pow(Math.pow(Math.abs(x) / hx, EP) + Math.pow(Math.abs(z - zc) / hz, EP), 1 / EP);
}
/** angle around the body: 0 = back centre, +pi/2 = left side, +-pi = front */
function thetaOf(e: Env, x: number, y: number, z: number) {
  const [hx, hz, zc] = envAt(e, y);
  return Math.atan2(x / hx, -(z - zc) / hz);
}
/** surface point at angle th / height y, pushed out along the normal by off; also returns the normal */
function envPoint(e: Env, th: number, y: number, off: number): { p: V3; n: V3 } {
  const [hx, hz, zc] = envAt(e, y);
  const s = Math.sin(th), c = Math.cos(th);
  const x = hx * Math.sign(s) * Math.pow(Math.abs(s), 2 / EP), z = zc - hz * Math.sign(c) * Math.pow(Math.abs(c), 2 / EP);
  const nx = (Math.sign(x) * Math.pow(Math.abs(x) / hx, EP - 1)) / hx, nz = (Math.sign(z - zc) * Math.pow(Math.abs(z - zc) / hz, EP - 1)) / hz;
  const nl = Math.hypot(nx, nz) || 1;
  const n: V3 = [nx / nl, 0, nz / nl];
  return { p: [x + n[0] * off, y, z + n[2] * off], n };
}
function frontZ(e: Env, x: number, y: number, off: number) {
  const [hx, hz, zc] = envAt(e, y);
  const a = Math.min(0.995, Math.abs(x) / hx);
  return zc + hz * Math.pow(1 - Math.pow(a, EP), 1 / EP) + off;
}
function backZ(e: Env, x: number, y: number, off: number) {
  const [hx, hz, zc] = envAt(e, y);
  const a = Math.min(0.995, Math.abs(x) / hx);
  return zc - hz * Math.pow(1 - Math.pow(a, EP), 1 / EP) - off;
}
const havg = (e: Env, y: number) => {
  const [hx, hz] = envAt(e, y);
  return (hx + hz) / 2;
};

const PUNK_ENV: Env = [
  [29.6, 6.55, 4.6, -1.0],
  [32.0, 6.6, 4.9, -1.0],
  [35.0, 6.7, 5.2, -1.0],
  [38.0, 6.75, 5.35, -1.0],
  [40.0, 6.95, 5.35, -1.05],
  [41.5, 7.6, 5.3, -1.1],
  [42.8, 8.0, 5.1, -1.2],
  [43.9, 7.4, 4.8, -1.3],
  [44.7, 6.0, 4.3, -1.5],
  [45.3, 4.5, 3.8, -1.7],
];
const DUSTER_ENV: Env = [
  [29.4, 6.9, 4.9, -1.1],
  [33.0, 7.0, 5.3, -1.1],
  [37.0, 7.05, 5.5, -1.1],
  [40.0, 7.2, 5.5, -1.1],
  [41.6, 7.8, 5.4, -1.15],
  [42.9, 8.2, 5.2, -1.2],
  [44.0, 7.5, 4.9, -1.3],
  [44.8, 6.1, 4.4, -1.5],
  [45.5, 4.6, 3.9, -1.7],
];
const VEST_ENV: Env = [
  [30.4, 6.5, 4.75, -1.0],
  [34.0, 6.65, 5.15, -1.0],
  [38.0, 6.75, 5.35, -1.0],
  [41.0, 6.9, 5.3, -1.1],
  [43.4, 6.6, 4.8, -1.3],
  [44.6, 5.4, 4.2, -1.5],
];
const PONCHO_ENV: Env = [
  [32.6, 11.2, 7.7, -1.0],
  [36.0, 10.4, 7.2, -1.0],
  [39.0, 9.6, 6.8, -1.0],
  [41.5, 8.9, 6.3, -1.1],
  [43.5, 7.7, 5.6, -1.2],
  [44.9, 5.8, 4.6, -1.4],
  [45.8, 4.2, 3.7, -1.6],
];
const JEANS_ENV: Env = [
  [19.8, 5.8, 3.7, -0.9],
  [21.5, 6.45, 4.15, -1.05],
  [23.5, 6.8, 4.45, -1.2],
  [25.4, 6.75, 4.4, -1.3],
  [26.9, 6.55, 4.3, -1.35],
];
const HIP_ENV: Env = [
  [24.2, 6.4, 4.2, -1.6],
  [27.4, 6.3, 4.1, -1.6],
];

// ================================================================== SMALL HARDWARE
/** domed chrome stud on a surface (p on the surface, n outward) */
function stud(m: Sc, p: V3, n: V3, r = 0.5, pyramid = false) {
  const c = vadd(p, vmul(n, r * 0.25));
  m.ell(c, [r, r, r], (x, y, z) => {
    const up = y - c[1];
    return up > r * 0.25 ? CHR.hi : up < -r * 0.3 ? CHR.shade : CHR.base;
  }, { flags: M, p: pyramid ? 1.25 : 2 });
}
/** tapered chrome spike from a base point along dir */
function spike(m: Sc, base: V3, dir: V3, L: number, r0: number) {
  const d = vnorm(dir);
  const a = vsub(base, vmul(d, 0.35));
  const b = vadd(base, vmul(d, L));
  m.cap(a, b, r0, 0.06, (x, y, z) => {
    const t = vdot(vsub([x, y, z], base), d) / L;
    const side = (y - lerp(base[1], b[1], clamp(t, 0, 1))) * 0.8;
    return t > 0.72 ? CHR.hi : side > 0.12 ? CHR.hi : t < 0.3 && side < 0 ? CHR.shade : CHR.base;
  }, { flags: M });
  stud(m, base, d, r0 * 1.18);
}
/** chain of alternating flat / edge links along a smooth path */
function chain(m: Sc, pts: V3[], link = 1.7, col: Ramp = CHR) {
  const smooth = spline(pts, 10);
  const samples = resample(smooth, link * 0.62);
  samples.forEach((s, k) => {
    const t = s.t;
    let w1 = vcross(t, [0, 1, 0]);
    if (vlen(w1) < 0.2) w1 = vcross(t, [1, 0, 0]);
    w1 = vnorm(w1);
    const w2 = vnorm(vcross(t, w1));
    const flat = (k & 1) === 0;
    m.oell(s.p, [t, flat ? w1 : w2, flat ? w2 : w1], [link * 0.5, 0.5, 0.26], flat ? (x, y, z) => (y > s.p[1] + 0.1 ? col.hi : col.base) : col.shade, { flags: M });
  });
}

// ================================================================== SKULL
interface SkullParts {
  head: Sc;
  jaw: Sc;
  /** the bone brow over the bare (right) socket; the living brow is humanBrow() */
  brow_r: VoxelModel;
}
const SOCKET_C = (s: number): V3 => [s * 3.2, 53.85, 7.1];
const SOCKET_R: V3 = [2.3, 2.25, 3.75];
const inSocket = (x: number, y: number, z: number, grow = 1) => {
  const s = x >= 0 ? 1 : -1, c = SOCKET_C(s);
  return Math.pow(Math.abs(x - c[0]) / (SOCKET_R[0] * grow), 2.5) + Math.pow(Math.abs(y - c[1]) / (SOCKET_R[1] * grow), 2.5) + Math.pow(Math.abs(z - c[2]) / (SOCKET_R[2] * grow), 2.5) <= 1;
};
const inNose = (x: number, y: number, z: number) => {
  const a = ((Math.abs(x) - 0.6) / 0.82) ** 2 + ((y - 50.9) / 1.42) ** 2 + ((z - 6.6) / 2.1) ** 2 <= 1;
  const b = (x / 0.48) ** 2 + ((y - 52.05) / 0.68) ** 2 + ((z - 6.5) / 1.7) ** 2 <= 1;
  return a || b;
};

function buildSkull(): SkullParts {
  const h = sc('head');
  const B = BN.base;
  // cranium: a slightly boxy dome
  h.ell([0, 55.4, -0.8], [6.15, 7.6, 6.9], B, { p: 2.15 });
  // skull base / occiput and mastoids
  h.ell([0, 49.7, -4.4], [3.7, 2.3, 2.6], B, { p: 2.2 });
  for (const s of [1, -1]) h.ell([s * 4.3, 48.7, -2.6], [1.15, 1.4, 1.2], B);
  // face mass (wraps back at the sides)
  h.ell([0, 52.4, 1.4], [4.95, 4.7, 4.75], B, { p: 2.9 });
  // cheekbones + zygomatic arches running back to the ear
  for (const s of [1, -1]) {
    h.ell([s * 4.6, 51.45, 4.25], [1.8, 1.35, 1.55], B, { p: 2.2 });
    h.cap([s * 5.4, 51.55, 3.4], [s * 6.0, 51.25, -1.5], 0.62, 0.5, B);
  }
  // maxilla (upper jaw) and the glabella between the brows
  h.ell([0, 49.0, 3.3], [3.75, 1.95, 2.75], B, { p: 2.4 });
  h.ell([0, 56.35, 5.95], [1.15, 0.9, 0.6], B);
  // atlas knob under the skull (meets the neck vertebrae)
  h.cap([0, 47.6, -2.5], [0, 46.4, -2.3], 0.95, 0.8, BN.shade);
  // dark mouth interior / palate (seen when the jaw drops)
  h.ell([0, 47.1, 2.5], [3.35, 0.6, 2.35], SOCK.void);
  // upper teeth: enamel around the front of the arch, seams between teeth
  const tid = (x: number, z: number) => Math.round(Math.atan2(x, z - 2.2) / 0.42);
  h.region([-3.9, 46.9, 0.6], [3.9, 48.75, 6.2], (x, y, z) => pw(x / 2.8, 2.6) + pw((z - 3.0) / 2.05, 2.6) > 1 && z > 1.2, (x, y, z) => {
    const k = S;
    const t0 = tid(x, z), tx = tid(x + Math.sign(x || 1) / k, z), tz = tid(x, z - 1 / k);
    return t0 !== tx || t0 !== tz ? SOCK.mid : y < 47.4 ? ENAMEL : BN.hi;
  }, { mode: 'paint' });
  // eye sockets: deep rounded-square recesses, walls darkening with depth
  for (const s of [1, -1]) h.ell(SOCKET_C(s), SOCKET_R, 0, { p: 2.5, mode: 'carve' });
  h.walls([-6, 50, 2], [6, 57, 7], (x, y, z) => inSocket(x, y, z), (x, y, z) => (z > 5.55 ? null : z > 4.7 ? SOCK.wall : z > 3.9 ? SOCK.mid : SOCK.deep));
  // nasal aperture (inverted heart)
  h.region([-1.6, 49, 4], [1.6, 53, 9], inNose, 0, { mode: 'carve' });
  h.walls([-2, 48.5, 3], [2, 53.5, 7], inNose, (x, y, z) => (z > 5.6 ? SOCK.wall : SOCK.deep));
  // a crack across the right brow (story, not noise) and soft cranial sutures
  const crack: V3[] = [[-3.5, 57.4, 6.05], [-2.9, 58.5, 5.75], [-3.35, 59.4, 5.25], [-2.6, 60.6, 4.3], [-2.95, 61.5, 3.0], [-2.25, 62.3, 1.3]];
  const branch: V3[] = [[-2.9, 58.5, 5.75], [-1.9, 59.1, 5.6], [-1.6, 59.9, 5.3]];
  h.region([-5, 56.5, 0], [0, 63.5, 7], (x, y, z) => distPoly([x, y, z], crack) < 0.42 || distPoly([x, y, z], branch) < 0.3, SOCK.mid, { mode: 'paint' });
  const zig = (a: V3, b: V3, n: number, amp: number, axis: 0 | 2) => {
    const out: V3[] = [];
    for (let i = 0; i <= n; i++) {
      const p = vadd(a, vmul(vsub(b, a), i / n));
      p[axis] += i % 2 ? amp : -amp;
      out.push(p);
    }
    return out;
  };
  const coronal = [...zig([-6.0, 57.6, -0.2], [0, 63.1, 0.9], 9, 0.32, 2), ...zig([0, 63.1, 0.9], [6.0, 57.6, -0.2], 9, 0.32, 2)];
  const sagittal = zig([0, 63.1, 0.9], [0, 58.4, -7.4], 10, 0.3, 0);
  h.region([-6.5, 56, -8], [6.5, 63.5, 2], (x, y, z) => y > 57 && (distPoly([x, y, z], coronal) < 0.33 || distPoly([x, y, z], sagittal) < 0.33), BN.shade, { mode: 'paint' });

  // ---- brow ridges (split into brow_l / brow_r so expressions can tilt them)
  const br = sc('brow');
  for (const s of [1, -1])
    br.path([[s * 5.65, 55.95, 4.25], [s * 4.65, 56.7, 5.6], [s * 3.1, 57.05, 6.35], [s * 1.35, 56.9, 6.45]], (t) => 0.86 - 0.12 * Math.abs(t - 0.6), B);
  shadeRamps(br.m, [BN], true);
  splitOff(br, 'brow_l', (x) => x > 0.9); // (under the living brow: dropped)
  const brow_r = splitOff(br, 'brow_r', (x) => x < -0.9);
  h.merge(br.m); // the bit over the glabella stays on the skull

  // ---- mandible
  const jw = sc('jaw');
  for (const s of [1, -1]) {
    const body: V3[] = [[s * 4.7, 45.95, -1.7], [s * 4.4, 45.4, 1.6], [s * 3.35, 45.05, 4.2], [s * 1.6, 44.9, 5.5], [0, 44.85, 5.85]];
    jw.sweep(body, (t) => [0.95, 1.3 - 0.15 * t, 0.95], B, 0.3);
    jw.cap([s * 4.8, 45.8, -1.9], [s * 5.15, 49.0, -2.25], 0.88, 0.7, B); // ramus
    jw.ell([s * 5.15, 49.35, -2.2], [0.85, 0.65, 0.95], B); // condyle (the hinge)
    jw.cap([s * 4.7, 47.0, -0.6], [s * 4.5, 48.5, 0.75], 0.55, 0.32, B); // coronoid
  }
  jw.ell([0, 44.55, 5.45], [1.95, 1.0, 1.05], B); // chin
  jw.ell([0, 45.8, 2.25], [3.05, 0.5, 2.3], SOCK.void); // floor of the mouth
  // lower teeth ring along the arch, seams offset from the upper row (they interlock)
  const ltid = (x: number, z: number) => Math.round(Math.atan2(x, z - 2.3) / 0.42 + 0.5);
  jw.region([-4.1, 45.9, 0.4], [4.1, 47.0, 6.1], (x, y, z) => {
    const o = pw(x / 3.5, 2.4) + pw((z - 2.3) / 3.5, 2.4);
    const i = pw(x / 2.4, 2.4) + pw((z - 2.3) / 2.38, 2.4);
    return o <= 1 && i > 1 && z > 0.8;
  }, (x, y, z) => {
    const t0 = ltid(x, z), tx = ltid(x + Math.sign(x || 1) / S, z), tz = ltid(x, z - 1 / S);
    return t0 !== tx || t0 !== tz ? SOCK.mid : ENAMEL;
  });
  shadeRamps(h.m, [BN], true);
  shadeRamps(jw.m, [BN], false);
  return { head: h, jaw: jw, brow_r };
}

// ---- modelled eyes: dark glossy orbs nested in the sockets with glowing pupils
type EyeVar = 'normal' | 'intense' | 'wide' | 'dim' | 'dead' | 'shut';
function eyeModel(name: string, s: number, v: EyeVar) {
  const e = sc(name);
  const c: V3 = [(s * 10) / 3, 54, 3.45]; // centre on voxel boundaries -> a 2x2 pupil, nested deep in the socket
  const R = 1.6;
  e.ell(c, [R, R, R], EYE.ball, { flags: M });
  const ci = Math.round(c[0] * S), cj = Math.round(c[1] * S);
  for (let di = -2; di <= 1; di++)
    for (let dj = -2; dj <= 1; dj++) {
      const ox = di + 0.5, oy = dj + 0.5;
      if (Math.abs(ox) > 1 && Math.abs(oy) > 1) continue; // round the 4x4 block
      const core = Math.abs(ox) < 1 && Math.abs(oy) < 1;
      const glint = core && ox < 0 && oy > 0;
      const i = ci + di, j = cj + dj;
      let l = 30;
      while (l > -10 && !e.m.has(i, j, l)) l--;
      if (l <= -10) continue;
      let col = EYE.ball, fl: number = M;
      if (v === 'dead') col = core ? EYE.dim : EYE.ball;
      else if (v === 'shut') {
        if (core && oy < 0) (col = EYE.core), (fl = VF.GLOW);
        else if (!core && Math.abs(oy) < 1 && oy < 0) (col = EYE.ring), (fl = VF.EMISSIVE);
      } else if (v === 'dim') {
        if (core) (col = EYE.ring), (fl = VF.EMISSIVE);
      } else if (core) {
        col = glint && v !== 'intense' ? EYE.glint : EYE.core;
        fl = VF.GLOW;
      } else if (v === 'wide') (col = EYE.core), (fl = VF.GLOW);
      else if (v === 'normal') col = EYE.iris;
      e.m.set(i, j, l, col, fl);
      if (core && v !== 'dead' && v !== 'dim') e.m.set(i, j, l - 1, EYE.ring, VF.EMISSIVE);
    }
  return e.m;
}
const EYE_EXPR: Record<string, [EyeVar, EyeVar]> = {
  neutral: ['normal', 'normal'],
  focus: ['intense', 'intense'],
  smug: ['intense', 'normal'],
  surprised: ['wide', 'wide'],
  hurt: ['dim', 'dim'],
  angry: ['intense', 'intense'],
  laugh: ['shut', 'shut'],
  wink: ['shut', 'normal'],
  dead: ['dead', 'dead'],
  determined: ['intense', 'intense'],
};

// ================================================================== THE HALF-DEAD FACE
const keyAt = (k: [number, number][], v: number) => {
  if (v <= k[0][0]) return k[0][1];
  for (let i = 1; i < k.length; i++) if (v <= k[i][0]) return lerp(k[i - 1][1], k[i][1], sstep((v - k[i - 1][0]) / (k[i][0] - k[i - 1][0])));
  return k[k.length - 1][1];
};
/** signed distance (u, approx.) to the rot on the head: < 0 eaten to the bone, > 0 living skin. The zombie
 *  accent is one clean, rounded gap torn through his right cheek over the jaw: the molars, the cheekbone and the
 *  jaw bone show through it; everything else is living skin. */
function headRotSdf(x: number, y: number, z: number) {
  const jag = 0.1 * Math.sin(y * 3.1 + z * 1.3) + 0.07 * Math.sin(z * 4.3 - y * 1.7 + 0.4);
  const d = (Math.hypot((x + 4.75) / 1.4, (y - 47.8) / 1.5, (z - 2.7) / 1.7) - 1) * 1.4;
  return Math.max(d, 0.9 - z) + jag * 0.6;
}
/** skin colour just outside the gap: a crisp raw rim, then a thin bruised line, then healthy skin */
function gapEdgeCol(d: number, healthy: number) {
  return d < 0.24 ? GAP_RIM : healthy;
}
/** bone colour just inside the gap: a dark wet rim, then clean bone */
const gapBoneCol = (c: number, _d: number) => c;
const cen = (i: number) => (i + 0.5) / S;
const vi = (x: number) => Math.round(x * S - 0.5);

/** the living eye's opening, voxel rows (y = 53.0 / 53.67 / 54.33) with their column spans */
const ALMOND: [number, number, number][] = [[81, 3, 6], [80, 2, 7], [79, 3, 6]];
/**
 * His living left eye: a wet orb (white, steel-blue iris, pupil, catch-light) with real lids
 * that close over it for the expressions. Cells the head already fills are skipped.
 */
interface IrisPal { iris: number; irisLo: number; irisSh: number; glow: boolean }
const IRIS_L: IrisPal = { iris: HEYE.iris, irisLo: HEYE.irisLo, irisSh: HEYE.irisSh, glow: false };
/** the zombie eye: a living eye with a Serket-green iris that glows faintly behind the shades */
const IRIS_R: IrisPal = { iris: 0x4fd02c, irisLo: 0x9cf060, irisSh: 0x2a6a1a, glow: true };
/** mirror a model across x = 0 (cell i -> -1 - i) */
function mirrorModel(src: VoxelModel, name: string) {
  const out = new VoxelModel(name);
  src.forEach((x, y, z, c, f) => out.set(-1 - x, y, z, c, f));
  return out;
}
function humanEye(v: EyeVar, head: VoxelModel | null, pal: IrisPal = IRIS_L) {
  const m = new VoxelModel('eye_l');
  const free = (i: number, j: number, l: number) => !head || !head.has(i, j, l);
  for (let j = 77; j <= 83; j++)
    for (let i = 0; i <= 9; i++)
      for (let l = 3; l <= 9; l++) {
        const x = cen(i), y = cen(j), z = cen(l);
        if (((x - 3.4) / 2.25) ** 2 + ((y - 53.67) / 1.6) ** 2 + ((z - 4.65) / 2.0) ** 2 > 1 || !free(i, j, l)) continue;
        m.set(i, j, l, y > 54 ? HEYE.whiteSh : HEYE.white, M);
      }
  const front = (i: number, j: number) => {
    for (let l = 9; l >= 3; l--) if (m.has(i, j, l)) return l;
    return -1;
  };
  const dead = v === 'dead';
  const iris = dead ? HEYE.cloud : pal.iris, irisLo = dead ? HEYE.cloud : pal.irisLo, irisSh = dead ? 0x6e777a : pal.irisSh;
  const irisCells = new Set([iris, irisLo, irisSh]);
  const face: Record<string, number> = {
    '2,80': HEYE.corner, '3,80': HEYE.white, '4,80': dead || v === 'dim' ? iris : HEYE.glint, '5,80': dead ? 0x5c6467 : HEYE.pupil, '6,80': iris, '7,80': HEYE.whiteSh,
    '3,81': HEYE.whiteSh, '4,81': v === 'wide' ? iris : irisSh, '5,81': v === 'wide' ? iris : irisSh, '6,81': v === 'wide' ? iris : irisSh,
    '3,79': HEYE.white, '4,79': irisLo, '5,79': irisLo, '6,79': iris,
  };
  for (const [j, i0, i1] of ALMOND)
    for (let i = i0; i <= i1; i++) {
      const l = front(i, j);
      const c = face[i + ',' + j];
      if (l >= 0 && c !== undefined) m.set(i, j, l, c, c === HEYE.glint || (pal.glow && !dead && irisCells.has(c)) ? VF.EMISSIVE : M);
    }
  // lids (skin, one voxel proud of the ball) close over the opening per expression
  const lid = (j: number, i0: number, i1: number, c: number) => {
    for (let i = i0; i <= i1; i++) if (free(i, j, 10)) m.set(i, j, 10, c);
  };
  if (v === 'intense') {
    lid(81, 3, 6, HEYE.lash); // the lid drops into a hard glare
    lid(79, 3, 3, SKIN.shade);
    lid(79, 6, 6, SKIN.shade);
  } else if (v === 'dim') lid(81, 3, 6, SKIN.base);
  else if (dead) {
    lid(81, 3, 6, SKIN.shade);
    lid(80, 2, 7, HEYE.lash);
  } else if (v === 'shut') {
    lid(81, 3, 6, SKIN.base);
    lid(80, 3, 6, SKIN.base);
    lid(80, 2, 2, HEYE.lash);
    lid(80, 7, 7, HEYE.lash);
    lid(79, 3, 6, HEYE.lash);
  }
  return m;
}

/** heavy living brow with a thick black eyebrow, split by an old scar (part brow_l) */
function humanBrow(scar = true) {
  const b = sc('brow_l');
  const pts: V3[] = [[5.9, 56.35, 4.4], [4.75, 57.0, 5.95], [3.2, 57.35, 6.7], [1.45, 57.15, 6.85]];
  const browY = (x: number) => keyAt([[1.45, 57.15], [3.2, 57.35], [4.75, 57.0], [5.9, 56.35]], x);
  b.path(pts, (t) => 0.98 - 0.12 * t, (x, y, z) => {
    if (y < browY(x) - 0.1) return SKIN.base;
    if (scar && Math.abs(x - 4.05) < 0.3) return SCAR;
    return BROWHAIR;
  });
  return b.m;
}

/** the living ear on the left of the head */
function humanEar(f: Sc, s = 1) {
  const K = SKIN.base;
  f.ell([s * 6.4, 52.45, -2.4], [0.42, 1.75, 1.05], K); // the flat of the ear
  const rim: V3[] = [];
  for (let a = -0.35; a <= 3.45; a += 0.22) rim.push([s * (6.62 + 0.22 * Math.sin(a)), 52.55 + 1.85 * Math.cos(a - 0.15), -2.45 - 1.15 * Math.sin(a)]);
  f.path(rim, () => 0.42, K); // helix
  f.ell([s * 6.55, 50.85, -2.15], [0.42, 0.58, 0.5], K); // lobe
  f.ell([s * 6.62, 52.05, -1.35], [0.3, 0.42, 0.3], K); // tragus
  f.ell([s * 6.85, 52.3, -2.3], [0.4, 0.8, 0.52], SKIN.dark, { mode: 'paint' }); // concha in shadow
}

/** skin colour of the living face (lips, scar, stubble, eye bags, crow's feet); `jaw` = the lower-face part */
function faceSkinCol(x: number, y: number, z: number, i: number, j: number, l: number, jaw: boolean): number {
  const ax = Math.abs(x);
  // lips
  if (!jaw && y < 48.0 && ax < 1.95 && z > 5.55) return LIP;
  if (jaw && y > 46.25 && ax < 1.85 && z > 5.35) return LIP;
  if (x < -1.9 && x > -2.35 && y > 46.95 && y < 47.6 && z > 4.2) return SKIN.dark; // the right mouth corner
  // an old knife scar down the left cheek (no stubble grows on it)
  if (x > 0 && z > 2.2 && distPoly([x, y, 0], [[5.3, 52.8, 0], [4.65, 51.05, 0], [3.85, 48.55, 0]]) < 0.28) return SCAR;
  // the half-smirk: the left corner of the mouth pulled up round the cigarette, a short crease beside it
  if (!jaw && x > 1.8 && x < 2.8 && z > 4.0 && Math.abs(y - (47.45 + (x - 1.8) * 0.55)) < 0.3) return SKIN.dark;
  if (x > 2.3 && z > 3.8 && distPoly([x, y, 0], [[2.55, 49.45, 0], [2.95, 48.35, 0], [2.9, 47.7, 0]]) < 0.16) return SKIN.shade;
  // the lid creases, and the hollows under the cheekbones
  if (ax > 1.8 && ax < 5.2 && y > 54.75 && y < 55.3 && z > 5.6) return SKIN.shade;
  if (!jaw && ax > 3.4 && ax < 5.4 && z > 2.6 && Math.abs(y - (50.05 - (ax - 3.4) * 0.22)) < 0.2) return SKIN.shade;
  // stubble: the jaw, chin and upper lip (thinning out toward the cheekbones)
  const top = 50.1 + 0.4 * Math.sin(x * 2.1) - (ax < 1.4 && z > 6.2 ? 9 : 0);
  if ((jaw || y < top) && z > -2.8 && y > 42.5) {
    const h = vhash(i, j, l);
    if (y > top - 0.7 && !jaw) return h < 0.4 ? STUBBLE : SKIN.base;
    return h < 0.07 ? STUBBLE_FLECK : STUBBLE;
  }
  if (jaw && Math.abs(x - 0.1) < 0.35 && Math.abs(y - 44.6) < 0.35) return SKIN.shade; // the cleft of a hard chin
  return SKIN.base;
}

/** merge bone and living skin: skin wins on the living side, the bone shows where it has rotted away */
function composeFace(bone: VoxelModel, skin: VoxelModel, name: string, jaw: boolean) {
  const out = new VoxelModel(name);
  bone.forEach((i, j, l, c, f) => {
    const d = headRotSdf(cen(i), cen(j), cen(l));
    if (d < 0 || !skin.has(i, j, l)) out.set(i, j, l, d < 0 ? gapBoneCol(c, d) : c, f);
  });
  skin.forEach((i, j, l) => {
    const x = cen(i), y = cen(j), z = cen(l);
    const d = headRotSdf(x, y, z);
    if (d < 0) {
      // the gap is a shallow pit: half a unit down, clean bone with the molars in two rows and the dark
      // line of the bite between them
      if (d > -0.5) return;
      const bite = jaw ? y > 47.1 : y < 47.55;
      const teeth = jaw ? y > 45.9 : y < 48.6;
      out.set(i, j, l, bite ? SOCK.void : teeth ? (l % 3 === 0 ? SOCK.mid : ENAMEL) : y > 48.6 ? BN.base : BN.shade);
      return;
    }
    const c = skin.get(i, j, l)! & 0xffffff;
    const base = c === (SKIN.base & 0xffffff) ? faceSkinCol(x, y, z, i, j, l, jaw) : c;
    out.set(i, j, l, gapEdgeCol(d, base));
  });
  // the torn lip stands a little proud of the bone and curls back
  const lip: V3[] = [];
  out.forEach((i, j, l) => {
    const d = headRotSdf(cen(i), cen(j), cen(l));
    if (d < 0.05 || d > 0.6) return;
    for (const [a, b, c] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] as V3[]) {
      const ni = i + a, nj = j + b, nl = l + c;
      if (out.has(ni, nj, nl) || headRotSdf(cen(ni), cen(nj), cen(nl)) < 0) continue;
      if (Math.hypot(cen(ni), cen(nl) + 0.8) < Math.hypot(cen(i), cen(l) + 0.8)) continue; // only outward
      lip.push([ni, nj, nl]);
    }
  });
  for (const [i, j, l] of lip) out.set(i, j, l, GAP_RIM);
  return out;
}

interface HeadBuild {
  head: VoxelModel;
  jaw: VoxelModel;
  brow_l: VoxelModel;
  brow_r: VoxelModel;
}
/** the half-dead head: skull, living skin over the left half, the rot, the scalp hair (unless hairless under a headdress) */
function buildHead(hair: boolean): HeadBuild {
  const sk = buildSkull();
  const K = SKIN.base;
  // ---- skin over the head: one voxel over the bone, the left orbit filled (the living eye sits in it)
  const base = sk.head.m.clone();
  const orbit = sc('orbit');
  for (const s of [1, -1]) orbit.region(s > 0 ? [0.4, 50, 2] : [-6, 50, 2], s > 0 ? [6, 57.6, 6.0] : [-0.4, 57.6, 6.0], (x, y, z) => inSocket(x, y, z) && z < 6.0, K);
  base.merge(orbit.m);
  const f = sc('skin');
  skinOver(base, f.m, K);
  // scalp, nape and the hard planes of the face
  f.ell([0, 55.4, -0.8], [6.75, 8.1, 7.45], K, { p: 2.15, mode: 'under' });
  f.ell([0, 50.0, -4.4], [4.4, 2.9, 3.05], K, { p: 2.2, mode: 'under' });
  for (const s of [1, -1]) {
    f.ell([s * 4.45, 51.75, 4.4], [2.0, 1.4, 1.95], K, { p: 2.3, mode: 'under' }); // cheekbone, high and defined
    f.ell([s * 5.45, 51.4, 1.2], [1.25, 1.2, 2.9], K, { mode: 'under' }); // over the zygomatic arch
    f.ell([s * 4.9, 48.9, 2.5], [1.45, 1.95, 2.5], K, { mode: 'under' }); // masseter: a square, hard jaw
    f.ell([s * 4.65, 49.3, -2.4], [1.65, 1.85, 1.75], K, { mode: 'under' }); // under the ear
  }
  f.ell([0, 48.7, 4.35], [3.3, 1.5, 2.25], K, { p: 2.3, mode: 'under' }); // muzzle over the upper teeth
  // the nose: straight and defined, a clean bridge and a firm tip
  f.cap([0, 55.7, 6.45], [0, 51.3, 7.85], 0.8, 0.96, K, { mode: 'under' });
  f.ell([0, 50.7, 7.75], [0.92, 0.84, 0.84], K, { mode: 'under' });
  for (const s of [1, -1]) f.ell([s * 0.92, 50.25, 7.05], [0.6, 0.56, 0.7], K, { mode: 'under' });
  for (const s of [1, -1]) f.ell([s * 0.55, 49.85, 7.45], [0.32, 0.24, 0.5], SKIN.dark, { mode: 'paint' }); // nostrils
  humanEar(f, 1);
  humanEar(f, -1);
  // the eye openings, and the parting of the lips (the jaw part carries everything below it)
  for (const [j, i0, i1] of ALMOND) for (let i = i0; i <= i1; i++) for (let l = 6; l <= 13; l++) (f.m.del(i, j, l), f.m.del(-1 - i, j, l));
  f.region([-8, 40, 1.0], [8, 47.34, 10], (x, y) => y < 47.34, 0, { mode: 'carve' });
  const head = composeFace(sk.head.m, f.m, 'head', false);
  // ---- jaw: skin over the mandible, a square chin, the lower lip
  const g = sc('jaw_skin');
  skinOver(sk.jaw.m, g.m, K);
  g.ell([0, 44.6, 5.6], [2.6, 1.55, 1.45], K, { p: 2.9, mode: 'under' }); // a square, forward chin
  for (const s of [1, -1]) {
    g.sweep([[s * 5.15, 46.0, -1.7], [s * 4.85, 45.2, 1.6], [s * 3.75, 44.75, 4.2], [s * 1.8, 44.55, 5.6], [0, 44.5, 6.0]], () => [1.2, 1.25, 1.1], K, 0.3, { mode: 'under' }); // a hard jawline
    g.ell([s * 5.2, 45.9, -1.4], [1.4, 1.4, 1.5], K, { p: 2.4, mode: 'under' }); // the angle of the jaw
  }
  g.ell([0, 46.75, 5.7], [1.85, 0.48, 0.72], K, { mode: 'under' }); // lower lip
  g.region([-8, 47.34, -6], [8, 51, 10], () => true, 0, { mode: 'carve' });
  const jaw = composeFace(sk.jaw.m, g.m, 'jaw', true);
  const hs = sc('head');
  hs.m = head;
  // ---- the cheek gap: a few neat black stitches where someone sewed its upper rim back to the cheekbone
  for (const z of [1.55, 2.5, 3.4]) {
    const y = 49.35 - 0.1 * (z - 1.5), xs = (yy: number, zz: number) => {
      const j = vi(yy), l = vi(zz);
      for (let i = -20; i < 0; i++) if (head.has(i, j, l)) return cen(i);
      return -6;
    };
    stitch(hs, [xs(y + 0.75, z) - 0.25, y + 0.75, z + 0.15], [xs(y - 0.4, z) - 0.25, y - 0.4, z - 0.15], 0.2);
  }
  if (hair) hairCap(hs);
  shadeRamps(head, [BN, SKIN, ROT, HAIR], true);
  shadeRamps(jaw, [BN, SKIN, ROT], false);
  return { head, jaw, brow_l: humanBrow(true), brow_r: mirrorModel(humanBrow(false), 'brow_r') };
}

// ---- hair
/** hairline height by angle round the head (0 = front, pi = back) */
const HAIRLINE: [number, number][] = [[0, 58.35], [0.8, 58.0], [1.05, 56.4], [1.3, 55.2], [1.52, 54.7], [1.85, 54.5], [2.1, 52.7], [2.45, 50.7], [Math.PI, 49.9]];
/** a scraggly cap of black hair over the scalp: pressed flat under the hat (painted on the scalp, so no
 *  hat crown is ever pierced and the head stays whole when the hat comes off), full below the brim,
 *  combed into vertical clumps, ragged at the hairline, thinning to dead grey strands at the rot */
function hairCap(h: Sc) {
  const H = h.m;
  const thOf = (x: number, z: number) => Math.atan2(Math.abs(x), z + 0.8);
  const clumpOf = (x: number, y: number, z: number) => Math.sin(thOf(x, z) * 21 * (x >= 0 ? 1 : -1) + y * 0.35);
  const hlOf = (x: number, z: number) => {
    const th = thOf(x, z);
    return keyAt(HAIRLINE, th) + 0.42 * Math.sin(th * 15 + (x >= 0 ? 1 : -1)) + 0.25 * Math.sin(th * 29 + 0.7);
  };
  const hairCol = (x: number, y: number, z: number) => {
    const cl = clumpOf(x, y, z);
    if (headRotSdf(x, y, z) < 2 && cl > 0.55) return HAIR_GREY;
    if (y < hlOf(x, z) + 0.6) return HAIR_ALT;
    return cl > 0.55 ? HAIR.hi : cl < -0.45 ? HAIR.shade : HAIR.base;
  };
  // flat under the crown: the scalp's own surface turns to hair
  const skinC = new Set([SKIN.base, SKIN.shade, SKIN.hi].map((c) => c & 0xffffff));
  const flat: [number, number, number, number][] = [];
  H.forEach((i, j, l, c) => {
    const x = cen(i), y = cen(j), z = cen(l);
    if (y < 58.6 || !skinC.has(c & 0xffffff) || headRotSdf(x, y, z) < 0.6) return;
    if (H.has(i + 1, j, l) && H.has(i - 1, j, l) && H.has(i, j + 1, l) && H.has(i, j, l + 1) && H.has(i, j, l - 1)) return;
    flat.push([i, j, l, hairCol(x, y, z)]);
  });
  for (const [i, j, l, c] of flat) H.set(i, j, l, c);
  h.region([-8.8, 49, -10.4], [8.8, 58.75, 7.6], (x, y, z) => {
    if (y > 58.75 || H.has(vi(x), vi(y), vi(z)) || y < hlOf(x, z)) return false;
    const d = headRotSdf(x, y, z);
    if (d < 0.35) return false;
    const cl = clumpOf(x, y, z);
    let t = (0.6 + 0.75 * sstep((58.6 - y) / 2.4)) * (1 + 0.3 * cl);
    if (d < 1.4) t = cl > 0.2 ? t * 0.75 : 0;
    const n = Math.pow(Math.abs(x) / (6.75 + t), 2.15) + Math.pow(Math.abs(y - 55.4) / (8.1 + t), 2.15) + Math.pow(Math.abs(z + 0.8) / (7.45 + t), 2.15);
    return n <= 1;
  }, hairCol);
  // the sideburns running down in front of the ears
  for (const s of [1, -1])
    h.region(s > 0 ? [4.5, 50.6, -1.4] : [-7.4, 50.6, -1.4], s > 0 ? [7.4, 55.8, 2.2] : [-4.5, 55.8, 2.2], (x, y, z) => {
      if (H.has(vi(x), vi(y), vi(z))) return false;
      const th = thOf(x, z);
      if (th < 1.24 || th > 1.43 || y < 50.9 + 0.3 * Math.sin(z * 4)) return false;
      return Math.pow(x / 7.05, 2) + Math.pow((z + 0.8) / 7.7, 2) <= 1 && Math.pow(x / 6.2, 2) + Math.pow((z + 0.8) / 6.9, 2) > 0.92;
    }, (x, y) => (y < 51.6 ? HAIR_ALT : HAIR.base));
}

/** a point off the scalp at angle th (0 front, +left, +-pi back), height y, `gap` u out from the skin;
 *  below the widest row (y 55.4) the hair falls straight */
function scalpPt(th: number, y: number, gap: number): V3 {
  const yy = Math.max(y, 55.4);
  const f = Math.pow(Math.max(0, 1 - Math.pow(Math.abs(yy - 55.4) / 8.1, 2.15)), 1 / 2.15);
  return [(6.75 * f + gap) * Math.sin(th), y, -0.8 + (7.45 * f + gap) * Math.cos(th)];
}
interface HairLock {
  name: string;
  parent: string;
  model: VoxelModel;
  pivot: V3;
}
/**
 * Long, voluminous, curly dark hair spilling from under the hat: tight ringlets that open up as they fall,
 * framing the face, resting on the shoulders at the sides and falling down the upper back. Four swaying
 * two-segment chains hung from the head: hair_l / hair_r (the sides, to the shoulders), hair_bl / hair_br
 * (the back, past the shoulders). Pivots in design units (head family).
 */
function hairLocks(): { locks: HairLock[]; chains: HairChain[] } {
  const R = rng(7412);
  const locks: HairLock[] = [];
  /** one ringlet: a centreline off the scalp at angle th, wound into a spiral that widens down the lock */
  type Curl = { th: number; y0: number; yEnd: number; puff: number; back: number; phase: number; r0: number };
  const ringlet = (c: Curl): { pts: V3[]; face: number[] } => {
    const pts: V3[] = [], face: number[] = [];
    const n: V3 = [Math.sin(c.th), 0, Math.cos(c.th)], tg: V3 = [Math.cos(c.th), 0, -Math.sin(c.th)];
    for (let y = c.y0; y >= c.yEnd; y -= 0.28) {
      const k = (c.y0 - y) / Math.max(1, c.y0 - c.yEnd);
      const gap = 0.85 + c.puff * sstep((c.y0 - y) / 7) + 0.07 * (55.4 - Math.min(y, 55.4));
      const p = scalpPt(c.th, y, gap);
      p[2] -= c.back * k * k;
      const rc = lerp(0.12, 0.62, sstep(k * 2.2)) * (1 - 0.25 * k);
      const ph = c.phase + (c.y0 - y) * 1.45;
      pts.push([p[0] + rc * (Math.cos(ph) * n[0] + Math.sin(ph) * tg[0]), y, p[2] + rc * (Math.cos(ph) * n[2] + Math.sin(ph) * tg[2])]);
      face.push(Math.cos(ph) * (rc > 0.2 ? 1 : 0.3));
    }
    return { pts, face };
  };
  /** curl shading: the crest of each turn catches the light, the inside of the spiral falls into shadow */
  const HC = { base: 0x30251f, shade: 0x150f0d, hi: 0x5c4434, glint: 0x84644c };
  const build = (name: string, cut: number, curls: Curl[]) => {
    const m = sc(name);
    curls.forEach((c, k) => {
      const { pts, face } = ringlet(c);
      for (let i = 1; i < pts.length; i++) {
        const t0 = (i - 1) / (pts.length - 1), t1 = i / (pts.length - 1), f = face[i];
        const col = f > 0.82 && (i + k) % 3 === 0 ? HC.glint : f > 0.42 ? HC.hi : f < -0.4 ? HC.shade : HC.base;
        m.cap(pts[i - 1], pts[i], lerp(c.r0, c.r0 * 0.72, t0), lerp(c.r0, c.r0 * 0.72, t1), col);
      }
      const tip = pts[pts.length - 1];
      if (R() < 0.4) m.ell(tip, [0.34, 0.34, 0.34], HAIR_TIP);
    });
    const [up, lo] = splitY(m.m, S, cut, name, name + '2');
    const avg = (pick: (c: Curl) => V3): V3 => {
      const a: V3 = [0, 0, 0];
      for (const c of curls) {
        const p = pick(c);
        for (let i = 0; i < 3; i++) a[i] += p[i] / curls.length;
      }
      return a;
    };
    const root = avg((c) => scalpPt(c.th, c.y0, 0.8));
    const mid = avg((c) => scalpPt(c.th, cut, 1.6));
    mid[1] = cut;
    locks.push({ name, parent: 'head', model: up, pivot: root });
    locks.push({ name: name + '2', parent: name, model: lo, pivot: mid });
  };
  // ---- the sides: from the temples, over and behind the ears, a mass of curls resting on the shoulders
  for (const s of [1, -1]) {
    const C: Curl[] = [];
    // the living side: two framing curls falling past the cheekbone to the jaw; the zombie side is tucked
    // back behind the ear so the cheek gap shows
    if (s > 0)
      for (const [th0, yE] of [[0.98, 45.6], [1.06, 44.8]] as [number, number][])
        C.push({ th: th0, y0: 57.9, yEnd: yE + R() * 0.6, puff: 0.7, back: 0.4, phase: R() * 6.3, r0: 0.62 });
    for (let k = 0; k < 10; k++) {
      const th = s * ((s > 0 ? 1.14 : 1.42) + k * (s > 0 ? 0.088 : 0.07) + (R() - 0.5) * 0.04);
      const behind = Math.abs(th) > 1.6;
      C.push({ th, y0: 57.7 - 0.1 * k + (R() - 0.5) * 0.4, yEnd: (behind ? 40.6 : 43.4) + R() * 1.6, puff: 1.5 + R() * 0.9, back: behind ? 2.0 : 1.1, phase: R() * 6.3, r0: 0.62 + R() * 0.1 });
    }
    build(s > 0 ? 'hair_l' : 'hair_r', 50.2, C);
  }
  // ---- the back: a curtain of ringlets down past the shoulders, longest at the middle
  for (const s of [1, -1]) {
    const C: Curl[] = [];
    for (let k = 0; k < 9; k++) {
      const th = s * (2.0 + k * 0.142 + (R() - 0.5) * 0.04);
      const mid = 1 - Math.abs(Math.abs(th) - Math.PI) / 1.2;
      C.push({ th, y0: 57.3 + (R() - 0.5) * 0.5, yEnd: 38.6 - 2.2 * clamp(mid, 0, 1) + R() * 1.4, puff: 1.3 + R() * 0.8, back: 0.6, phase: R() * 6.3, r0: 0.66 + R() * 0.1 });
    }
    build(s > 0 ? 'hair_bl' : 'hair_br', 47.6, C);
  }
  return {
    locks,
    chains: [
      { parts: ['hair_l', 'hair_l2'], lim: [-0.3, 0.95, -0.1, 0.7], phase: 0 },
      { parts: ['hair_r', 'hair_r2'], lim: [-0.3, 0.95, -0.7, 0.1], phase: 1.7 },
      { parts: ['hair_bl', 'hair_bl2'], lim: [-0.28, 1.05, -0.2, 0.45], phase: 3.1, stiff: 95 },
      { parts: ['hair_br', 'hair_br2'], lim: [-0.28, 1.05, -0.45, 0.2], phase: 4.4, stiff: 95 },
    ],
  };
}

// ================================================================== BONES
const zSpine = (y: number) => {
  const k: [number, number][] = [[26.5, -3.9], [31, -3.75], [35, -4.4], [40, -4.75], [43.5, -4.1], [46.5, -2.7]];
  if (y <= k[0][0]) return k[0][1];
  for (let i = 1; i < k.length; i++) if (y <= k[i][0]) return lerp(k[i - 1][1], k[i][1], sstep((y - k[i - 1][0]) / (k[i][0] - k[i - 1][0])));
  return k[k.length - 1][1];
};

function torsoBones(m: Sc, scapulae: boolean) {
  const B = BN.base;
  // vertebrae: 2-voxel bodies with a darker disc between (aligned to the grid)
  for (let n = 0; n < 9; n++) {
    const y = (41 + n * 3) / S; // 27.33 .. 43.33
    const lum = y < 33, zs = zSpine(y);
    m.ell([0, y, zs], lum ? [1.3, 0.62, 1.12] : [1.06, 0.62, 0.95], B, { p: 2.5 });
    m.ell([0, y - 1, zs], [0.8, 0.36, 0.72], BN.shade); // disc
    m.cap([0, y, zs - 0.7], [0, y - (lum ? 0.35 : 0.75), zs - 2.05], lum ? 0.5 : 0.42, 0.3, B); // spinous process
    for (const s of [1, -1]) m.cap([0, y, zs - 0.2], [s * (lum ? 2.1 : 1.7), y + 0.1, zs - 0.55], 0.36, 0.28, B); // transverse
  }
  for (const y of [44.67, 46.0]) m.ell([0, y, zSpine(y)], [0.85, 0.32, 0.78], B, { p: 2.4 }); // cervical
  m.ell([0, 45.33, zSpine(45.33)], [0.62, 0.3, 0.6], BN.shade);
  // ribs: six pairs of flat, curved bands sweeping round from the spine and dropping to the front
  const RIBS: [number, number, number, number, number][] = [
    [43.0, 4.9, 3.9, 1.4, 3.0],
    [41.2, 5.7, 4.5, 2.0, 3.0],
    [39.4, 6.15, 4.8, 2.4, 2.95],
    [37.6, 6.3, 4.9, 2.7, 2.9],
    [35.8, 6.2, 4.85, 2.9, 2.6],
    [34.0, 5.8, 4.6, 2.8, 2.15],
  ];
  const zc = -0.95;
  for (const [yb, rx, rz, drop, aEnd] of RIBS)
    for (const s of [1, -1]) {
      const pts: V3[] = [];
      for (let a = 0.3; a <= aEnd + 1e-6; a += 0.08) pts.push([s * rx * Math.sin(a), yb + 0.35 * Math.sin(clamp(a * 1.6, 0, Math.PI)) - drop * Math.pow(a / Math.PI, 1.5), zc - rz * Math.cos(a)]);
      m.sweep(pts, (t) => [0.46, 0.56 - 0.08 * t, 0.46], B, 0.2);
    }
  // sternum: manubrium, body, xiphoid
  m.ell([0, 42.1, 4.05], [1.45, 0.95, 0.55], B);
  m.sweep([[0, 41.4, 4.15], [0, 38.5, 4.12], [0, 35.6, 3.85]], (t) => [0.82 - 0.12 * t, 0.6, 0.45], B, 0.25);
  m.cap([0, 35.4, 3.8], [0, 34.0, 3.35], 0.42, 0.15, B);
  // clavicles
  for (const s of [1, -1]) m.path([[s * 1.3, 43.2, 3.75], [s * 3.6, 43.75, 3.3], [s * 5.9, 43.8, 1.6], [s * 7.2, 43.5, 0.1]], () => 0.56, B);
  if (scapulae)
    for (const s of [1, -1]) {
      const A: [number, number] = [2.6, 42.6], Bp: [number, number] = [6.6, 42.2], C: [number, number] = [3.4, 36.6];
      const sign = (p: [number, number], a: [number, number], b: [number, number]) => (p[0] - b[0]) * (a[1] - b[1]) - (a[0] - b[0]) * (p[1] - b[1]);
      m.region([s > 0 ? 2 : -7.2, 36, -7], [s > 0 ? 7.2 : -2, 43, -5], (x, y, z) => {
        const p: [number, number] = [x * s, y];
        const d1 = sign(p, A, Bp), d2 = sign(p, Bp, C), d3 = sign(p, C, A);
        const inT = !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
        const zz = -5.95 - 0.18 * (p[0] - 2.6);
        return inT && Math.abs(z - zz) < 0.36;
      }, B);
      m.cap([s * 2.6, 41.3, -6.4], [s * 7.0, 42.5, -4.4], 0.42, 0.5, B); // scapular spine -> acromion
    }
}

function pelvisBones(dst: Sc, clipY: number) {
  const B = BN.base;
  const m = sc('pelvis_bones');
  for (const s of [1, -1]) {
    // iliac wing: a thin flared bowl
    m.region([s > 0 ? 1.4 : -7, 24.4, -4.8], [s > 0 ? 7 : -1.4, 29.6, 2], (x, y, z) => {
      if (s * x < 1.6) return false;
      const d = ((s * x - 2.0) / 4.25) ** 2 + ((y - 25.0) / 4.45) ** 2 + ((z + 1.3) / 3.0) ** 2;
      return d <= 1 && d >= 0.66 && y > 24.6 && z > -4.6 && z < 1.8;
    }, B);
    m.path([[s * 1.9, 28.8, -4.0], [s * 4.4, 29.4, -2.6], [s * 5.75, 28.8, -0.4], [s * 5.25, 27.4, 1.35]], (t) => 0.5 + 0.08 * Math.sin(t * Math.PI), B); // crest
    m.ell([s * 4.3, 24.2, -0.4], [1.3, 1.3, 1.3], BN.shade); // acetabulum
    m.path([[s * 3.9, 23.5, 0.6], [s * 1.8, 23.0, 1.6], [s * 0.35, 22.8, 1.7]], () => 0.55, B); // pubis
    m.path([[s * 3.8, 23.2, -0.9], [s * 3.1, 21.7, -1.6], [s * 1.6, 21.6, 0.2], [s * 0.6, 22.3, 1.4]], () => 0.5, B); // ischium loop
  }
  m.ell([0, 25.8, -4.3], [1.9, 2.6, 1.0], B, { p: 2.4 }); // sacrum
  for (const y of [24.6, 25.9, 27.1]) for (const s of [1, -1]) m.ell([s * 0.75, y, -5.2], [0.3, 0.3, 0.3], SOCK.mid); // sacral foramina
  if (clipY > -99) m.region([-8, 15, -8], [8, clipY, 4], () => true, 0, { mode: 'carve' });
  dst.merge(m.m);
}

function humerus(m: Sc, s: number) {
  const B = BN.base;
  m.ell([s * 7.7, 42.4, -0.1], [1.45, 1.45, 1.45], B);
  m.ell([s * 8.9, 42.2, 0.2], [0.7, 0.9, 0.8], B);
  m.cap([s * 8.2, 41.6, -0.1], [s * 8.0, 34.4, 0], 0.72, 0.62, B);
  m.ell([s * 8.0, 33.6, 0], [1.45, 0.75, 0.85], B, { p: 2.4 });
}
function forearm(m: Sc, s: number) {
  const B = BN.base;
  m.ell([s * 8.2, 32.65, -0.7], [0.78, 0.9, 0.8], B); // olecranon
  m.cap([s * 8.2, 33.0, -1.0], [s * 8.2, 32.4, -1.5], 0.5, 0.4, B);
  m.ell([s * 8.75, 32.35, 0.4], [0.62, 0.55, 0.62], B); // radial head
  m.cap([s * 8.2, 32.2, -0.6], [s * 8.05, 26.7, -0.6], 0.5, 0.4, BN.shade); // ulna
  m.cap([s * 8.8, 32.0, 0.4], [s * 8.9, 26.7, 0.4], 0.42, 0.56, B); // radius
}
const FX = [6.9, 8.1, 9.3, 10.5];
/** finger bones: closed fist (holds the gun) or relaxed open hand */
function hand(m: Sc, s: number, closed: boolean) {
  const B = BN.base;
  for (const [cx, cz] of [[7.9, -0.3], [8.9, -0.45], [9.9, -0.2], [8.4, 0.6], [9.4, 0.55]] as [number, number][]) m.ell([s * cx, 25.3, cz], [0.62, 0.56, 0.56], B); // carpals
  const knob = (p: V3, r: number) => m.ell(p, [r, r, r], B);
  if (closed) {
    FX.forEach((fx, i) => {
      const x = s * fx;
      m.cap([s * (8.2 + (i - 1.5) * 0.45), 25.0, 0.0], [x, 23.15, 1.5], 0.42, 0.42, B); // metacarpal
      knob([x, 23.0, 1.85], 0.56); // knuckle
      m.cap([x, 22.8, 2.15], [x, 21.0, 2.35], 0.45, 0.42, B); // proximal
      knob([x, 20.85, 2.25], 0.46);
      m.cap([x, 20.7, 2.1], [x, 20.0, 0.85], 0.4, 0.37, B); // middle (curling back)
      m.cap([x, 20.05, 0.7], [x, 20.55, -0.25], 0.34, 0.28, B); // distal tip
    });
    m.cap([s * 7.4, 24.6, 0.4], [s * 6.2, 23.0, 1.5], 0.46, 0.42, B); // thumb
    knob([s * 6.2, 22.9, 1.65], 0.5);
    m.cap([s * 6.25, 22.8, 1.8], [s * 7.0, 22.0, 2.95], 0.42, 0.38, B);
    m.cap([s * 7.0, 22.0, 3.0], [s * 8.0, 21.75, 3.1], 0.36, 0.3, B);
  } else {
    const LEN = [0.92, 1.0, 0.95, 0.78];
    FX.forEach((fx, i) => {
      const x = s * fx, L = LEN[i], spread = s * (i - 1.5) * 0.22;
      m.cap([s * (8.2 + (i - 1.5) * 0.5), 24.9, 0.0], [x, 22.6, 0.25], 0.42, 0.4, B);
      knob([x, 22.45, 0.3], 0.53);
      const p1: V3 = [x + spread * 0.5, 22.3 - 1.9 * L, 0.85];
      m.cap([x, 22.3, 0.35], p1, 0.41, 0.38, B);
      knob(p1, 0.43);
      const p2: V3 = [x + spread, p1[1] - 1.3 * L, 1.1];
      m.cap(p1, p2, 0.36, 0.33, B);
      m.cap(p2, [x + spread * 1.2, p2[1] - 1.0 * L, 0.95], 0.31, 0.22, B);
    });
    m.path([[s * 7.5, 24.6, 0.5], [s * 6.4, 22.9, 1.0], [s * 6.0, 21.4, 1.5], [s * 6.1, 20.3, 1.75]], (t) => 0.46 - 0.16 * t, B);
  }
}
function femur(m: Sc, s: number, from = 99) {
  const B = BN.base;
  if (from > 22) {
    m.ell([s * 3.3, 24.3, -0.2], [1.25, 1.25, 1.25], B);
    m.cap([s * 3.4, 24.0, -0.2], [s * 4.6, 23.0, -0.1], 0.75, 0.75, B);
    m.ell([s * 5.2, 23.6, -0.4], [0.9, 1.1, 0.9], B);
  }
  m.cap([s * 4.4, Math.min(22.6, from), -0.1], [s * 3.7, 17.4, 0.2], 0.8, 0.72, B);
  m.ell([s * 3.6, 16.4, 0.1], [1.55, 0.95, 1.3], B, { p: 2.4 });
}
function tibia(m: Sc, s: number, to = 4.6) {
  const B = BN.base;
  m.ell([s * 3.5, 14.9, 0.1], [1.5, 0.75, 1.3], B, { p: 2.4 }); // plateau
  m.ell([s * 3.5, 15.4, 1.55], [0.82, 1.0, 0.5], BN.hi); // kneecap
  m.cap([s * 3.5, 14.5, 0.3], [s * 3.3, to, 0.0], 0.78, 0.62, B);
  m.cap([s * 4.6, 14.2, -0.4], [s * 4.35, to - 0.2, -0.4], 0.4, 0.38, BN.shade); // fibula
}

// ================================================================== THE HALF-DEAD BODY
/** the living torso under every garment (inside all garment envelopes) */
const FLESH_ENV: Env = [
  [29.2, 5.45, 3.95, -1.0],
  [31.6, 5.75, 4.25, -0.95],
  [34.0, 6.1, 4.6, -0.95],
  [37.6, 6.35, 4.9, -0.95],
  [41.0, 6.3, 4.75, -1.0],
  [43.0, 5.75, 4.3, -1.2],
  [44.4, 4.4, 3.45, -1.45],
];
/** where the torso joint splits the body: the torso owns rows above, the pelvis rows below */
const WAIST_CUT = 29.34;
const ell3 = (x: number, y: number, z: number, c: V3, r: V3) => (Math.hypot((x - c[0]) / r[0], (y - c[1]) / r[1], (z - c[2]) / r[2]) - 1) * Math.min(r[0], r[1], r[2]);
const neckZ = (y: number) => lerp(-1.15, -2.2, clamp((y - 42.6) / 5.0, 0, 1));
/** signed distance to the rot on the torso: none any more (the zombie accent is the cheek gap) */
function torsoRotSdf(_x: number, _y: number, _z: number) {
  return 9;
}
/** the stitched cut down the right of his belly (torso and pelvis) */
const INCISION: V3[] = [[-2.35, 33.7, 0], [-2.05, 31.4, 0], [-1.75, 29.2, 0], [-1.55, 27.2, 0]];
function torsoSkinCol(x: number, y: number, z: number, i: number, j: number, l: number): number {
  const [, hz, zc] = envAt(FLESH_ENV, clamp(y, 29.2, 44.4));
  const front = z > zc + hz * 0.5;
  if (front) {
    if (x > 0.6 && x < 5.4 && Math.abs(y - (37.0 + 0.06 * (x - 0.6) ** 2)) < 0.26) return SKIN.shade; // under the pectoral
    if (Math.abs(x) < 0.3 && y < 41.8) return SKIN.shade; // the sternum / belly line
    if (x > 0.45 && x < 2.7 && (Math.abs(y - 34.1) < 0.24 || Math.abs(y - 31.9) < 0.24)) return SKIN.shade; // abs
    if (Math.abs(x) < 0.55 && Math.abs(y - 43.3) < 0.3) return SKIN.shade; // the notch at the throat
  }
  if (x > 4.4 && z > zc - 1 && y < 38 && (Math.abs(y - 33.9) < 0.21 || Math.abs(y - 35.3) < 0.21 || Math.abs(y - 36.7) < 0.21)) return SKIN.shade; // ribs under a gaunt flank
  if (z < zc - hz * 0.6 && Math.abs(x) < 0.3 && y < 44) return SKIN.shade; // the spine's groove
  return SKIN.base;
}

/**
 * The torso's body: living skin on the left (collarbones, pectoral, a gaunt flank), the neck, and on
 * the right the skin torn open to the ribs (a dark cavity behind them), the flank and the shoulder
 * blade, with sinew strung across. Drawn first, garments go over it.
 */
function torsoBody(m: Sc) {
  const e = FLESH_ENV;
  const f = sc('torso_flesh');
  f.region([-7, WAIST_CUT, -7], [7, 44.6, 6], (x, y, z) => y >= WAIST_CUT && rhoOf(e, x, y, z) <= 1, SKIN.base);
  // the neck: a thick column, Adam's apple, cords of the neck
  f.sweep([[0, 42.6, -1.15], [0, 45.0, -1.6], [0, 47.6, -2.2]], (t) => [lerp(2.75, 2.35, t), 0.6, lerp(2.45, 2.25, t)], SKIN.base, 0.2);
  f.ell([0.2, 45.0, 0.72], [0.55, 0.65, 0.45], SKIN.base);
  for (const s of [1, -1]) f.path([[s * 1.3, 43.0, 2.95], [s * 3.6, 43.45, 2.75], [s * 5.9, 43.55, 1.2], [s * 7.0, 43.25, 0.05]], () => 0.5, SKIN.base); // collarbones
  const depth = (x: number, y: number, z: number) => Math.min(rhoOf(e, x, Math.min(y, 44.4), z), y > 42.6 ? Math.hypot(x / 2.6, (z - neckZ(y)) / 2.4) : 9);
  f.m.forEach((i, j, l) => {
    const [x, y, z] = f.at(i, j, l);
    const d = torsoRotSdf(x, y, z);
    if (d < 0) {
      // the torn-open cavity: only a dark inner wall is left behind the bones
      const r = depth(x, y, z);
      if (r > 0.72) return;
      m.m.set(i, j, l, r > 0.6 ? MEAT.dark : CAVITY);
      return;
    }
    const cord = y > 43.2 && Math.abs(Math.abs(x) - 1.5 + (y - 43.2) * 0.12) < 0.25 && z > neckZ(y); // neck cords
    m.m.set(i, j, l, rotEdgeCol(d, x, y, z, cord ? SKIN.shade : torsoSkinCol(x, y, z, i, j, l)));
  });
  // bones show only where the flesh is gone
  const bn = sc('torso_bones');
  torsoBones(bn, true);
  bn.m.forEach((i, j, l, c, fl) => {
    const d = torsoRotSdf(...bn.at(i, j, l));
    if (d < 0.2) m.m.set(i, j, l, boneEdgeCol(c, d), fl);
  });
}

/** the belly between the belt and the torso joint (pelvis part); the right hip rotted to the iliac crest */
function bellyBody(m: Sc) {
  const f = sc('belly');
  const hxy = (y: number) => lerp(5.75, 5.45, clamp((y - 25.4) / 3.9, 0, 1));
  f.region([-7, 25.2, -6], [7, WAIST_CUT, 4.5], (x, y, z) => y < WAIST_CUT && Math.pow(Math.abs(x) / hxy(y), 2.5) + Math.pow(Math.abs(z + 1.0) / 3.95, 2.5) <= 1, SKIN.base);
  const sdf = (_x: number, _y: number, _z: number) => 9;
  f.m.forEach((i, j, l) => {
    const [x, y, z] = f.at(i, j, l);
    const d = sdf(x, y, z);
    if (d < 0) {
      if (Math.pow(Math.abs(x) / hxy(y), 2.5) + Math.pow(Math.abs(z + 1.0) / 3.95, 2.5) < 0.55) m.m.set(i, j, l, CAVITY);
      return;
    }
    let c: number = SKIN.base;
    if (Math.abs(x - 0.35) < 0.3 && Math.abs(y - 28.35) < 0.3 && z > 2.2) c = SKIN.dark; // navel
    else if (x > 1.4 && x < 4.8 && z > 1.4 && Math.abs(y - (26.5 + (x - 1.4) * 0.62)) < 0.24) c = SKIN.shade; // the cut of the hip
    m.m.set(i, j, l, rotEdgeCol(d, x, y, z, c));
  });
  const bones = sc('belly_bones');
  pelvisBones(bones, -100);
  bones.m.forEach((i, j, l, c, fl) => {
    const p = bones.at(i, j, l), d = sdf(...p);
    if (d < 0.2 && p[1] > 25.3) m.m.set(i, j, l, boneEdgeCol(c, d), fl);
  });
}

// ---- arms
/** a fleshed upper arm (deltoid, biceps, triceps) */
function upperArmFlesh(m: Sc, s: number, K: number) {
  m.ell([s * 8.0, 41.75, -0.1], [1.98, 1.78, 1.88], K); // the deltoid cap
  m.ell([s * 8.45, 40.1, 0.1], [1.22, 1.85, 1.38], K); // the deltoid's point running down the outside
  m.cap([s * 8.1, 41.2, -0.05], [s * 8.0, 34.0, 0.05], 1.42, 1.12, K);
  m.ell([s * 8.15, 37.2, 0.75], [1.32, 2.15, 1.3], K); // biceps
  m.ell([s * 7.95, 37.9, -0.75], [1.25, 2.4, 1.18], K); // triceps
  m.ell([s * 8.0, 33.85, -0.05], [1.2, 0.8, 1.05], K);
}
/** his living left upper arm: whole, but sewn round the biceps where it was once half torn off */
function livingUpperArm(m: Sc, s: number) {
  upperArmFlesh(m, s, SKIN.base);
  const seam = (x: number, z: number) => 36.3 + 0.35 * Math.sin(Math.atan2(z, x - s * 8.05) * 2 + 0.6);
  m.region([s * 8.05 - 2.2, 34.5, -2.2], [s * 8.05 + 2.2, 38.4, 2.2], () => true, (x, y, z) => {
    const d = Math.abs(y - seam(x, z));
    if (d < 0.26) return MEAT.dark;
    if (d < 0.62) return ROT.dark;
    if (d < 1.05) return y < seam(x, z) ? ROT.base : BRUISE;
    if (d < 1.5 && y < seam(x, z)) return ROT.hi;
    return null;
  }, { mode: 'paint' });
  for (let a = -2.6; a <= 2.61; a += 0.62) {
    const dx = Math.cos(a), dz = Math.sin(a);
    const r = 1.62;
    const y = seam(s * 8.05 + dx * r, dz * r);
    stitch(m, [s * 8.05 + s * dx * r * 1.02, y + 0.55, dz * r * 1.02], [s * 8.05 + s * dx * r * 1.02, y - 0.55, dz * r * 1.02]);
  }
}
/** his dead right upper arm: necrotic skin torn open on the outside down to the humerus */
function deadUpperArm(m: Sc, s: number) {
  const f = sc('dead_arm');
  upperArmFlesh(f, s, ROT.base);
  const hole = (x: number, y: number, z: number) => ((y - 37.0) / 2.1) ** 2 + ((z - 0.35) / 1.25) ** 2 + 0.16 * Math.sin(y * 4 + z * 3) < 1 && s * x > 8.3;
  f.m.forEach((i, j, l) => {
    const [x, y, z] = f.at(i, j, l);
    if (hole(x, y, z)) {
      if (Math.hypot(x - s * 8.05, z) < 0.95) m.m.set(i, j, l, CAVITY);
      return;
    }
    const near = ((y - 37.0) / 2.1) ** 2 + ((z - 0.35) / 1.25) ** 2;
    const b = blotch(x, y, z);
    m.m.set(i, j, l, s * x > 7.6 && near < 1.35 ? MEAT.base : s * x > 7.6 && near < 1.8 ? ROT.dark : b > 0.55 ? BRUISE : b < -0.6 ? ROT.hi : ROT.base);
  });
  humerus(m, s);
  strand(m, [[s * 8.75, 39.1, 0.7], [s * 9.2, 37.1, 0.9], [s * 8.85, 35.1, 0.55]], 0.42, 0.38, SINEW.base, SINEW.shade, 0.3);
  strand(m, [[s * 8.8, 38.9, -0.2], [s * 9.3, 36.8, -0.35], [s * 8.9, 35.3, -0.15]], 0.4, 0.38, SINEW.shade, SINEW.base, 0.3);
}
/** a fleshed forearm to the wrist */
function forearmFlesh(m: Sc, s: number, K: number) {
  m.ell([s * 8.2, 32.55, -0.45], [1.25, 1.0, 1.15], K); // elbow
  m.ell([s * 8.55, 30.8, 0.2], [1.45, 2.0, 1.35], K); // the meaty top of the forearm
  m.ell([s * 8.1, 31.2, -0.45], [1.15, 1.7, 1.1], K); // the flexors underneath
  m.cap([s * 8.35, 32.2, -0.1], [s * 8.65, 26.7, -0.05], 1.3, 1.0, K);
  m.ell([s * 8.65, 26.3, -0.05], [1.05, 0.7, 0.92], K); // wrist
}
/** his living left forearm: weathered skin, a necrotic gash on the outside sewn over the ulna */
function livingForearm(m: Sc, s: number) {
  forearmFlesh(m, s, SKIN.base);
  const gash = (x: number, y: number, z: number) => distPoly([x, y, z], [[s * 9.75, 31.1, -0.55], [s * 9.85, 29.3, -0.75], [s * 9.6, 27.9, -0.6]]);
  m.region([s * 8.6 - 2.2, 26.5, -2.2], [s * 8.6 + 2.2, 32.4, 2.2], (x, y, z) => s * x > 8.9 && gash(x, y, z) < 0.42, CAVITY, { mode: 'carve' });
  m.region([s * 8.6 - 2.2, 26.5, -2.2], [s * 8.6 + 2.2, 32.4, 2.2], () => true, (x, y, z) => {
    if (s * x < 8.7) return null;
    const d = gash(x, y, z);
    return d < 0.75 ? MEAT.shade : d < 1.15 ? ROT.dark : d < 1.6 ? ROT.base : d < 2.0 ? BRUISE : null;
  }, { mode: 'paint' });
  m.cap([s * 9.15, 31.0, -0.6], [s * 9.2, 27.9, -0.65], 0.36, 0.32, BN.base); // the ulna in the wound
  for (const y of [30.6, 29.5, 28.4]) stitch(m, [s * 10.15, y + 0.3, -0.05], [s * 10.0, y - 0.3, -1.25]);
}
/** his living left hand: a big, weathered hand hanging loose; scabbed knuckles, nails */
function livingHand(m: Sc, s: number) {
  const K = SKIN.base;
  m.ell([s * 8.55, 23.75, 0.15], [2.15, 1.75, 0.95], K, { p: 2.6 }); // palm and back of the hand
  m.ell([s * 7.1, 23.55, 0.7], [0.95, 1.35, 0.8], K); // the thumb's pad
  const LEN = [0.92, 1.0, 0.95, 0.8];
  [6.33, 7.67, 9.0, 10.33].forEach((fx, i) => {
    const x = s * fx, L = LEN[i], spread = s * (i - 1.5) * 0.18;
    const p0: V3 = [x, 22.4, 0.3];
    const p1: V3 = [x + spread * 0.5, 22.3 - 1.9 * L, 0.85];
    const p2: V3 = [x + spread, p1[1] - 1.3 * L, 1.1];
    const tip: V3 = [x + spread * 1.15, p2[1] - 1.0 * L, 0.95];
    m.sweep([p0, p1, p2, tip], (t) => [0.36, 0.5, lerp(0.62, 0.5, t)], K, 0.2);
    m.ell(tip, [0.36, 0.42, 0.5], (xx, yy, zz) => (zz > tip[2] + 0.15 && yy < tip[1] + 0.2 ? NAIL : K)); // nail
    if (i < 2) m.ell([x, 22.45, 0.85], [0.4, 0.4, 0.3], MEAT.shade, { mode: 'paint' }); // split knuckles
  });
  m.path([[s * 7.5, 24.4, 0.6], [s * 6.4, 22.9, 1.05], [s * 6.0, 21.45, 1.5], [s * 6.1, 20.45, 1.75]], (t) => 0.56 - 0.14 * t, K); // thumb
}
/** a living fist closed round the gun grip: knuckles, curled fingers, the thumb wrapped over */
function livingFist(m: Sc, s: number) {
  const K = SKIN.base;
  m.ell([s * 8.55, 24.0, 0.35], [2.05, 1.8, 1.0], K, { p: 2.6 }); // the back of the hand and the palm
  m.ell([s * 7.2, 23.6, 0.9], [0.95, 1.3, 0.85], K); // the thumb's pad
  FX.forEach((fx, i) => {
    const x = s * fx;
    m.sweep([[s * (8.2 + (i - 1.5) * 0.45), 24.4, 0.35], [x, 23.0, 1.75], [x, 21.1, 2.3], [x, 20.3, 1.45], [x, 20.5, 0.35]], (t) => [0.52, 0.55, lerp(0.58, 0.5, t)], K, 0.18);
    m.ell([x, 23.0, 1.95], [0.56, 0.56, 0.52], i < 2 ? SKIN.shade : K); // knuckle (the first two scuffed)
  });
  m.path([[s * 7.4, 24.4, 0.7], [s * 6.3, 22.9, 1.75], [s * 7.0, 22.0, 2.95], [s * 7.95, 21.8, 3.1]], (t) => 0.56 - 0.12 * t, K); // thumb over the fingers
}
/** silver rings: a band round a finger at p (plus a little skull on the `skull` one) */
function ring(m: Sc, p: V3, skull = false) {
  m.ell(p, [0.6, 0.24, 0.62], (x, y) => (y > p[1] + 0.08 ? CHR.hi : CHR.base), { flags: M });
  if (skull) m.ell([p[0], p[1], p[2] + 0.5], [0.5, 0.42, 0.32], (x, y) => (y < p[1] - 0.1 ? BN.shade : BN.base));
}
/** a studded leather wristband (two rows of pyramid studs) round the wrist at height y */
function studBand(m: Sc, s: number, y0: number, y1: number, rows: number[]) {
  const c: V3 = [s * 8.6, (y0 + y1) / 2, -0.1];
  m.region([c[0] - 2, y0, -2], [c[0] + 2, y1, 2], (x, y, z) => {
    const d = Math.hypot(x - c[0], z - c[2]);
    return d < 1.62 && d > 0.9;
  }, (x, y) => (y > y1 - 0.25 || y < y0 + 0.25 ? LEA_EDGE : LEA.base));
  for (const y of rows)
    for (let a = 0; a < 7; a++) {
      const th = (a / 7) * Math.PI * 2 + 0.2 + y;
      const d: V3 = [Math.cos(th), 0, Math.sin(th)];
      stud(m, vadd([c[0], y, c[2]], vmul(d, 1.58)), d, 0.38, true);
    }
}
/** a barbed-wire tattoo band round an upper arm (pixel ink on the skin) */
function barbTattoo(m: Sc, s: number, yc: number) {
  const ax = s * 8.05, ink = 0x2c3346;
  m.region([ax - 2.6, yc - 1.4, -2.6], [ax + 2.6, yc + 1.4, 2.6], () => true, (x, y, z) => {
    const th = Math.atan2(z, (x - ax) * s);
    const w = 0.42 * Math.sin(th * 5);
    if (Math.abs(y - yc - w) < 0.2 || Math.abs(y - yc + w) < 0.2) return ink;
    const knot = Math.abs(Math.sin(th * 5)) < 0.18;
    if (knot && Math.abs(y - yc) < 0.75 && Math.abs((th * 5 / Math.PI) % 1) < 0.5) return ink; // a barb at each crossing
    return null;
  }, { mode: 'paint' });
}

/** his dead right forearm: bare radius and ulna, a ragged sleeve of rotted skin round the elbow torn
 *  into strips, sinew still running down the bones to the skeletal hand */
function deadForearm(m: Sc, s: number) {
  forearm(m, s);
  const cx = s * 8.45, cz = -0.15;
  const cut = (th: number) => 30.4 - 0.75 * Math.sin(th * 3 + 0.5) - 0.45 * Math.sin(th * 7 + 1.2);
  m.region([cx - 2, 29, -2.3], [cx + 2, 33.4, 2.0], (x, y, z) => {
    const r = Math.hypot((x - cx) / 1.3, (z - cz) / 1.2);
    return r <= 1 && r >= 0.55 && y >= cut(Math.atan2(z - cz, x - cx)) && y <= 33.25;
  }, (x, y, z) => {
    const k = y - cut(Math.atan2(z - cz, x - cx));
    return k < 0.45 ? MEAT.shade : k < 0.9 ? ROT.dark : blotch(x, y, z) > 0.6 ? BRUISE : ROT.base;
  });
  for (const [th, len] of [[0.6, 2.0], [2.2, 1.4], [-2.4, 2.3], [-1.0, 1.1], [1.4, 1.6]] as [number, number][]) {
    const p: V3 = [cx + 1.2 * Math.cos(th), cut(th) + 0.25, cz + 1.15 * Math.sin(th)];
    strand(m, [p, [p[0] + Math.cos(th) * 0.2, p[1] - len * 0.5, p[2] + Math.sin(th) * 0.25], [p[0] + Math.cos(th) * 0.3, p[1] - len, p[2] + Math.sin(th) * 0.3]], 0.44, 0.34, ROT.base, ROT.dark, 0.4);
  }
  for (const [x0, z0, x1, z1] of [[8.35, 0.55, 8.95, 0.75], [7.85, -0.55, 8.2, -0.7], [9.15, -0.35, 9.4, -0.1]] as [number, number, number, number][])
    strand(m, [[s * x0, 31.2, z0], [s * (x0 + x1) / 2, 28.8, (z0 + z1) / 2 + 0.2], [s * x1, 26.1, z1]], 0.4, 0.36, SINEW.base, SINEW.dark, 0.25);
}

// ---- legs
/** a plain trouser leg (thigh part) */
function trouserThigh(m: Sc, s: number, C: Ramp) {
  const ax0: V3 = [s * 3.95, 25.2, -0.75], ax1: V3 = [s * 3.55, 15.6, 0.25];
  m.path([ax0, [s * 3.8, 20.5, -0.2], ax1], (t) => lerp(2.42, 2.08, t), C.base);
  m.region([s > 0 ? 4 : -7, 15.4, -1.2], [s > 0 ? 7 : -4, 25.4, 0.8], (x, y, z) => Math.abs(z + 0.15) < 0.3 && s * x > 5.2, C.shade, { mode: 'paint' }); // outseam
  m.region([s * 3.6 - 2.6, 16.0, 0], [s * 3.6 + 2.6, 18.2, 3], (x, y, z) => z > 1.2 && Math.abs(y - 17.1 - 0.3 * Math.sin(x * 2)) < 0.22, C.shade, { mode: 'paint' }); // knee crease
}
/** a plain trouser leg tucked into a boot (shin part) */
function trouserShin(m: Sc, s: number, C: Ramp, boot: Ramp) {
  m.path([[s * 3.5, 15.35, 0.3], [s * 3.3, 10.0, 0.05]], (t) => lerp(2.03, 1.85, t), C.base);
  m.region([s * 3.3 - 2.5, 9.7, -2.5], [s * 3.3 + 2.5, 11.4, 2.5], (x, y, z) => Math.hypot(x - s * 3.3, z) < 2.2, (x, y) => (Math.abs(y - 10.5) < 0.22 ? C.shade : C.base)); // bunched over the boot
  cowboyBoot(m, s, boot, { spur: true });
}
const TROUSERS: Partial<Record<OutfitId, Ramp>> = {
  bare: ramp(0x5b4636, 0x45342a, 0x725a48, 0x2a1f19),
  duster: ramp(0x4c4640, 0x39342f, 0x625b54, 0x221f1c),
  sheriff: ramp(0x45464f, 0x34353c, 0x5b5c66, 0x1f2024),
  vest: ramp(0x7a6248, 0x5f4b37, 0x947a5e, 0x3b2e21),
  poncho: ramp(0x55688a, 0x425270, 0x6e82a3, 0x2a3447),
};
/** a trouser seat round the hips (pelvis part) for the outfits that are not jeans */
function trouserSeat(m: Sc, C: Ramp) {
  const e = JEANS_ENV;
  m.region([-8, 19.8, -7], [8, 26.9, 5], (x, y, z) => {
    const r = rhoOf(e, x, y, z);
    if (r > 1 || r < 1 - 1.4 / havg(e, y)) return false;
    return !(y < 22.4 && Math.abs(x) < 0.9 + (22.4 - y) * 1.1);
  }, (x, y, z) => (z > 1 && Math.abs(x) < 0.28 && y > 21.9 ? C.dark : C.base));
}
/** a plain leather belt riding the trouser seat: brass rounds in their loops, a buckle, the holster */
function trouserBelt(m: Sc, L: Ramp, buckle: Ramp) {
  const e = JEANS_ENV;
  m.region([-8.5, 25.3, -7], [8.5, 27.25, 5.5], (x, y, z) => {
    const r = rhoOf(e, x, y, z);
    return r >= 1.0 && r <= 1 + 0.9 / havg(e, y) && y >= 25.35 && y <= 27.15;
  }, (x, y) => (y < 25.7 ? L.shade : L.base));
  for (const th of [1.25, 1.55, 1.85, 2.15, -0.4, 0, 0.4]) {
    const { p } = envPoint(e, th, 26.25, 1.0);
    m.cap(vadd(p, [0, -0.6, 0]), vadd(p, [0, 0.6, 0]), 0.36, 0.36, (x, y) => (y > p[1] + 0.3 ? TOON.brass.hi : TOON.brass.base), { flags: M });
  }
  const bz = frontZ(e, 0, 26.25, 1.25);
  m.rbox([0, 26.25, bz], [1.7, 1.3, 0.4], 0.35, (x, y) => (Math.abs(x) < 0.9 && Math.abs(y - 26.25) < 0.55 ? buckle.shade : y > 26.65 ? buckle.hi : buckle.base), { flags: M });
  m.ell([0, 26.25, bz + 0.35], [0.45, 0.4, 0.3], TOON.serket.base, { flags: VF.EMISSIVE });
  holster(m, L);
}
/** the pharaoh's legs: wound in linen like the dead, gold sandals, a living left foot and the bones of the right */
function wrappedLeg(th: Sc, sh: Sc, s: number) {
  const L = ramp(0xe6dcc0, 0xc9bb98, 0xf6eed8, 0x9a8c6c);
  const wrap = (cx: number, cz: number) => (x: number, y: number, z: number) => {
    const a = Math.atan2(z - cz, x - cx);
    const f = (((y - (a / (Math.PI * 2)) * 0.85) / 0.85) % 1 + 1) % 1;
    return f < 0.18 ? L.shade : L.base;
  };
  th.path([[s * 3.95, 25.0, -0.6], [s * 3.6, 15.6, 0.2]], (t) => lerp(1.95, 1.7, t), wrap(s * 3.8, -0.2));
  sh.path([[s * 3.5, 15.35, 0.3], [s * 3.35, 3.6, -0.1]], (t) => lerp(1.72, 1.2, t), wrap(s * 3.4, 0.1));
  sh.ell([s * 3.4, 1.55, -1.4], [1.25, 1.5, 1.4], wrap(s * 3.4, -1.4)); // heel
  sh.ell([s * 3.4, 1.35, 1.6], [1.45, 1.05, 3.1], wrap(s * 3.4, 1.6)); // foot
  if (s > 0) {
    [2.4, 3.05, 3.65, 4.2, 4.7].forEach((tx, i) => sh.ell([s * tx, 0.85, 4.75 - i * 0.15], [0.36, 0.42, 0.55], SKIN.base)); // living toes
  } else {
    [2.3, 3.0, 3.7, 4.4, 5.0].forEach((tx, i) => {
      const x = s * tx;
      sh.cap([x, 0.85, 3.9], [x, 0.6, i === 0 ? 5.7 : 5.3 - i * 0.2], i === 0 ? 0.4 : 0.32, 0.26, BN.base);
      sh.ell([x, 0.8, 4.0], [0.38, 0.38, 0.38], BN.base);
    });
  }
  const G = TOON.gold;
  sh.region([s * 3.4 - 2.2, 0, -3.2], [s * 3.4 + 2.2, 0.45, 6.2], (x, y, z) => y < 0.45 && ((x - s * 3.4) / 1.8) ** 2 + ((z - 1.3) / 4.5) ** 2 <= 1, G.shade, { flags: M });
  sh.cap([s * 1.9, 1.9, 1.3], [s * 4.9, 1.9, 1.3], 0.34, 0.34, G.base, { flags: M });
  sh.cap([s * 3.4, 2.3, -2.6], [s * 3.4, 2.3, -0.4], 0.32, 0.32, G.base, { flags: M });
  shadeRamps(th.m, [L], true);
  shadeRamps(sh.m, [L, SKIN, BN], true);
}

// ================================================================== GARMENT PIECES
/** a leather/cloth shell around an envelope; open front where |x| < xo(y) (if given) */
function bodyShell(m: Sc, e: Env, y0: number, y1: number, T: number, col: Col, xo?: (y: number) => number, extraCut?: (x: number, y: number, z: number) => boolean, flags?: number) {
  m.region([-12.5, y0, -10], [12.5, y1, 9], (x, y, z) => {
    if (y < y0 || y > y1) return false;
    const r = rhoOf(e, x, y, z);
    if (r < 1 || r > 1 + T / havg(e, y)) return false;
    const [, , zc] = envAt(e, y);
    if (xo && z > zc + 1.0 && Math.abs(x) < xo(y)) return false;
    if (extraCut && extraCut(x, y, z)) return false;
    return true;
  }, col, { flags });
}

/** hot-rod flame tongues licking up from y0; th(x,y,z) gives the position around the body (u of arc) */
interface Tongue {
  at: number;
  h: number;
  w: number;
  lean: number;
}
function flameCol(tongues: Tongue[], arc: number, h: number): number | null {
  if (h < 0) return null;
  let best: number | null = null;
  for (const t of tongues) {
    if (h > t.h) continue;
    const k = h / t.h;
    const centre = t.at + t.lean * k * k * 2.2;
    const w = t.w * Math.pow(1 - k, 0.7) * (1 + 0.22 * Math.sin(h * 1.4 + t.at));
    const d = Math.abs(arc - centre);
    if (d < w) return k < 0.34 ? FLAME[0] : k < 0.68 ? FLAME[1] : FLAME[2];
    if (d < w + 0.42) best = FLAME_LINE;
  }
  if (h < 1.0) return FLAME[0];
  if (h < 1.42) return best ?? FLAME_LINE;
  return best;
}

/** a red bandana knotted round the neck, folded triangle over the sternum */
function bandana(m: Sc, R: Ramp) {
  const ring: V3[] = [];
  for (let a = 0; a <= Math.PI * 2 + 0.01; a += 0.15) ring.push([3.15 * Math.sin(a), 45.15 + 0.3 * Math.cos(a), -1.9 - 2.9 * Math.cos(a)]);
  m.path(ring, () => 0.86, R.base);
  // folded triangle draping over the manubrium
  m.region([-3.4, 40.0, 0], [3.4, 45.0, 6.4], (x, y, z) => {
    const v = (44.7 - y) / 2.3;
    if (v < 0 || v > 1) return false;
    const w = 2.6 * (1 - v);
    if (Math.abs(x) > w) return false;
    const zc = lerp(1.5, 3.6, v) + 0.6 * Math.sin(Math.PI * v) - 0.11 * x * x;
    return Math.abs(z - zc) < 0.48;
  }, (x, y, z) => {
    const v = (44.7 - y) / 2.3, w = 2.6 * (1 - v);
    const i = Math.floor(x * S), j = Math.floor(y * S);
    if (w - Math.abs(x) < 0.55) return TOON.linen.base; // printed border
    if (((i + 2 * j) % 6 === 0 || (i - 2 * j) % 6 === 0) && j % 3 === 0) return TOON.linen.hi; // paisley dots
    if (Math.abs(Math.abs(x) - (w * 0.55)) < 0.3 && v > 0.25) return R.shade; // fold crease
    return R.base;
  });
  // knot at the back-left with two stubby ears
  m.ell([2.0, 45.0, -4.95], [1.05, 0.88, 0.88], R.shade);
  m.cap([2.0, 45.0, -5.2], [3.25, 43.9, -6.0], 0.58, 0.3, R.base);
  m.cap([2.0, 45.0, -5.2], [0.95, 43.5, -6.1], 0.58, 0.3, R.base);
}

/** the saddle-leather board sling: over the left shoulder, across the chest to the right hip, round the back */
function sling(m: Sc, e: Env, off: number, bullets = false) {
  const pts: { p: V3; n: V3 }[] = [];
  for (let k = 0; k <= 160; k++) {
    const th = -Math.PI + (k / 160) * Math.PI * 2;
    const y = 37.3 + 7.7 * Math.sin(th);
    pts.push(envPoint(e, th, y, off));
  }
  for (let k = 0; k < pts.length; k++) {
    const a = pts[Math.max(0, k - 1)].p, b = pts[Math.min(pts.length - 1, k + 1)].p;
    const t = vnorm(vsub(b, a));
    const w = vnorm(vcross(pts[k].n, t));
    for (let q = -0.95; q <= 0.951; q += 0.19) {
      const edge = Math.abs(q) > 0.7;
      m.ell(vadd(pts[k].p, vmul(w, q)), [0.4, 0.4, 0.4], edge ? STRAP.shade : STRAP.base);
    }
  }
  // a bandolier: brass rounds standing across the strap down the front and over the back
  if (bullets)
    cartridges(m, pts, 3, (k) => vcross(pts[k].n, vsub(pts[Math.min(pts.length - 1, k + 1)].p, pts[Math.max(0, k - 1)].p)), 4, 158);
  // chrome buckle on the chest + a keeper on the back where the board rides
  for (const [th, big] of [[2.42, true], [-0.32, false]] as [number, boolean][]) {
    const y = 37.3 + 7.7 * Math.sin(th);
    const { p, n } = envPoint(e, th, y, off + 0.45);
    const hw = big ? 1.05 : 0.85, hh = big ? 1.25 : 1.0;
    m.region(vsub(p, [2, 2, 2]), vadd(p, [2, 2, 2]), (x, y2, z) => {
      const d = vsub([x, y2, z], p);
      if (Math.abs(vdot(d, n)) > 0.33) return false;
      const side = vnorm(vcross([0, 1, 0], n));
      const a = Math.abs(vdot(d, side)), b = Math.abs(d[1]);
      return a < hw && b < hh && (a > hw - 0.5 || b > hh - 0.5 || (big && a < 0.25));
    }, (x, y2) => (y2 > p[1] ? CHR.hi : CHR.base), { flags: M });
  }
}

/** a plain leather gun belt on the hip bones (non-punk outfits) with a buckle and the holster */
function gunBelt(m: Sc, L: Ramp, buckle: Ramp) {
  bodyShell(m, HIP_ENV, 25.3, 27.1, 1.0, (x, y) => (y < 25.8 ? L.shade : L.base));
  for (const th of [1.3, 1.55, 1.8, 2.05]) {
    const { p } = envPoint(HIP_ENV, th, 26.2, 1.05);
    m.cap(vadd(p, [0, -0.6, 0]), vadd(p, [0, 0.6, 0]), 0.38, 0.38, (x, y) => (y > p[1] + 0.3 ? TOON.brass.hi : TOON.brass.base), { flags: M });
  }
  const bz = frontZ(HIP_ENV, 0, 26.2, 1.3);
  m.rbox([0, 26.2, bz], [1.7, 1.3, 0.4], 0.35, (x, y) => (Math.abs(x) < 0.9 && Math.abs(y - 26.2) < 0.55 ? buckle.shade : y > 26.6 ? buckle.hi : buckle.base), { flags: M });
  m.ell([0, 26.2, bz + 0.35], [0.45, 0.4, 0.3], TOON.serket.base, { flags: VF.EMISSIVE });
  holster(m, L);
}
function holster(m: Sc, L: Ramp) {
  const pts: V3[] = [[-7.25, 25.6, -0.2], [-7.6, 21.4, 0.25], [-7.9, 17.6, 0.7]];
  m.sweep(pts, (t) => [0.78, 1.0, 1.3 - 0.45 * t], (x, y, z) => (Math.abs(x + 8.15) < 0.45 && Math.abs(z - 0.3) > 0.95 ? L.dark : L.base), 0.25);
  m.rbox([-7.0, 25.6, -0.3], [0.65, 1.05, 1.15], 0.3, L.shade);
  m.ell([-8.55, 22.2, 0.3], [0.32, 0.8, 0.8], (x, y) => (y > 22.3 ? CHR.hi : CHR.base), { flags: M }); // concho
}

// ================================================================== BOOTS
function cowboyBoot(m: Sc, s: number, Bt: Ramp, o: { harness?: boolean; spur?: boolean; top?: number; stitch?: number } = {}) {
  const top = o.top ?? 10.4;
  const cx = s * 3.3;
  // shaft with a scalloped top (dips front and back) and pull straps
  m.region([cx - 2.3, 3.0, -2.3], [cx + 2.3, top + 0.2, 2.3], (x, y, z) => {
    const t = (top - y) / (top - 3.0);
    const r = lerp(2.1, 1.8, clamp(t, 0, 1));
    const d = Math.hypot(x - cx, z);
    if (d > r) return false;
    const th = Math.atan2(x - cx, z);
    const dip = 0.95 * Math.max(0, 1 - Math.abs(th) / 0.7) + 0.6 * Math.max(0, 1 - (Math.PI - Math.abs(th)) / 0.6);
    return y <= top - dip;
  }, (x, y, z) => {
    const th = Math.atan2(x - cx, z);
    for (let k = 0; k < 3; k++) {
      const yl = 5.3 + k * 1.5 + 0.55 * Math.sin(th * 2 + k);
      if (Math.abs(y - yl) < 0.3 && Math.cos(th) > -0.3) return o.stitch ?? STITCH;
    }
    return Bt.base;
  });
  for (const q of [1, -1]) m.rbox([cx + q * 2.05, top + 0.2, 0], [0.32, 0.75, 0.55], 0.2, Bt.shade);
  // foot: vamp + pointed toe
  const plan = (x: number, z: number, g = 0) => ((x - cx) / (1.95 + g)) ** 2 + ((z - 1.0) / (4.55 + g)) ** 2 <= 1 || ((x - cx) / (1.3 + g)) ** 2 + ((z - 4.7) / (2.2 + g)) ** 2 <= 1;
  m.ell([cx, 1.95, 1.0], [1.85, 1.75, 4.4], Bt.base, { p: 2.3 });
  m.ell([cx - s * 0.05, 1.3, 4.7], [1.25, 0.95, 2.0], Bt.base);
  m.ell([cx - s * 0.1, 1.15, 6.3], [0.62, 0.55, 0.62], Bt.base);
  m.region([cx - 3, 0, -4], [cx + 3, 0.62, 7.5], (x, y, z) => y > 0 && y < 0.62 && plan(x, z, 0.22) && z > -3.4, SOLE); // sole + welt
  m.region([cx - 3, 0.62, 2.9], [cx + 3, 3.5, 3.5], (x, y, z) => Math.abs(z - (3.2 - (y - 1.5) * 0.25)) < 0.28, o.stitch ?? STITCH, { mode: 'paint' }); // toe-cap seam
  // underslung stacked heel
  m.region([cx - 1.5, 0, -3.5], [cx + 1.5, 2.0, -1.0], (x, y, z) => y > 0 && Math.abs(x - cx) < 1.3 && z > -3.35 && z < -1.2 - (1.9 - y) * 0.38 && y < 1.95, (x, y) => ((Math.floor(y * S) & 1) ? HEEL.base : HEEL.shade));
  if (o.harness) {
    // engineer harness: strap round the ankle and over the instep, chrome O-ring on the outside
    const H: V3[] = [[s * 1.35, 2.25, 1.5], [cx, 3.15, 2.45], [s * 5.25, 2.25, 1.35], [s * 5.3, 2.45, -1.0], [cx, 2.75, -2.95], [s * 1.3, 2.45, -1.0], [s * 1.35, 2.25, 1.5]];
    m.path(spline(H, 6), () => 0.44, STRAP.dark);
    const rc: V3 = [s * 5.45, 2.35, 0.25];
    m.region(vsub(rc, [0.6, 1.0, 1.0]), vadd(rc, [0.6, 1.0, 1.0]), (x, y, z) => {
      const r = Math.hypot(y - rc[1], z - rc[2]);
      return Math.abs(x - rc[0]) < 0.36 && Math.abs(r - 0.68) < 0.27;
    }, (x, y) => (y > rc[1] ? CHR.hi : CHR.base), { flags: M });
  }
  if (o.spur ?? true) {
    // spur: heel band, shank and a star rowel standing in the YZ plane
    m.path([[s * 1.6, 2.15, -1.2], [cx, 2.2, -3.55], [s * 5.0, 2.15, -1.2]], () => 0.3, CHR.shade, { flags: M });
    m.cap([cx, 2.15, -3.5], [cx, 2.05, -4.8], 0.3, 0.26, CHR.base, { flags: M });
    const rc: V3 = [cx, 2.05, -5.7];
    m.region(vsub(rc, [0.5, 1.8, 1.8]), vadd(rc, [0.5, 1.8, 1.8]), (x, y, z) => {
      if (Math.abs(x - rc[0]) > 0.36) return false;
      const dy = y - rc[1], dz = z - rc[2], r = Math.hypot(dy, dz);
      if (r < 0.48) return true;
      if (r > 1.65) return false;
      const a = Math.atan2(dy, dz) / ((Math.PI * 2) / 6);
      const f = Math.abs(a - Math.round(a));
      return f < 0.26 * (1 - r / 1.75) + 0.05;
    }, (x, y, z) => (Math.hypot(y - rc[1], z - rc[2]) > 1.1 ? CHR.hi : CHR.base), { flags: M });
  }
}

// ================================================================== PUNK OUTFIT (the new default)
const xoPunk = (y: number) => {
  const k: [number, number][] = [[29.6, 3.55], [33, 3.75], [37, 4.15], [40, 4.6], [42.5, 5.2], [44.5, 5.0], [45.4, 4.4]];
  if (y <= k[0][0]) return k[0][1];
  for (let i = 1; i < k.length; i++) if (y <= k[i][0]) return lerp(k[i - 1][1], k[i][1], (y - k[i - 1][0]) / (k[i][0] - k[i - 1][0]));
  return k[k.length - 1][1];
};
const PUNK_T = 1.15;
const BACK_TONGUES: Tongue[] = [
  { at: 0, h: 7.6, w: 1.9, lean: 0.5 },
  { at: 3.3, h: 6.9, w: 1.7, lean: -0.7 },
  { at: -3.3, h: 7.3, w: 1.7, lean: 0.7 },
  { at: 6.6, h: 5.8, w: 1.55, lean: -0.6 },
  { at: -6.6, h: 5.4, w: 1.55, lean: 0.65 },
  { at: 9.8, h: 4.8, w: 1.4, lean: 0.5 },
  { at: -9.8, h: 5.1, w: 1.4, lean: -0.5 },
  { at: 13.2, h: 4.3, w: 1.3, lean: -0.45 },
  { at: -13.2, h: 4.0, w: 1.3, lean: 0.45 },
  { at: 16.0, h: 3.5, w: 1.1, lean: -0.35 },
  { at: -16.0, h: 3.7, w: 1.1, lean: 0.35 },
];

/** the washed-out band tee (original print, no real band): cream cotton gone grey at the seams */
const TEE = ramp(0xd6ccb8, 0xb2a690, 0xe9e2d2, 0x7d735f);
const TEE_INK = 0x1d1b20;
/** the tee's print, seen through the open vest: a striped sunset disc under an arched banner of blocky
 *  made-up glyphs, a black horizon (pixel art on the cotton, faded) */
function teePrint(x: number, y: number): number | null {
  const ax = Math.abs(x);
  const d = Math.hypot(x, y - 35.0);
  // arched banner: 3 rows of blocky glyphs between two rules
  if (d > 4.05 && d < 5.35 && y > 36.6 && ax < 3.7) {
    if (d < 4.28 || d > 5.12) return TEE_INK;
    const col = Math.floor((Math.atan2(x, y - 35.0) + 1) * 8.2);
    const row = Math.floor((d - 4.28) / 0.28);
    if (col % 4 === 3) return null; // the gap between letters
    const bits = [0b111101111, 0b110101110, 0b111100111, 0b101111101, 0b111010111, 0b100100111, 0b111101101, 0b010010010][(col * 7 + 3) % 8];
    return (bits >> (row * 3 + (col % 4))) & 1 ? 0x8a1d18 : null;
  }
  // the sunset disc, cut by stripes toward the horizon
  const r = Math.hypot(x, y - 36.9);
  if (r < 2.55 && y > 34.85) {
    if (y < 36.7 && Math.floor(y * S) % 2 === 0) return null;
    return y > 38.0 ? 0xe6b04a : y > 36.9 ? 0xd9692e : 0xb2342a;
  }
  if (Math.abs(y - 34.7) < 0.22 && ax < 3.3) return TEE_INK;
  return null;
}
/** the tee round the torso: a ragged scoop neck, cut-off armholes, a few rips showing skin */
function teeTorso(m: Sc) {
  const e = FLESH_ENV, T = 0.5;
  const rips: [number, number, number, number][] = [[2.6, 32.2, 0.55, 0.42], [-3.4, 39.6, 0.5, 0.36], [4.9, 36.0, 0.45, 0.6], [-1.2, 31.0, 0.4, 0.3]];
  m.region([-8, WAIST_CUT, -7], [8, 44.2, 7], (x, y, z) => {
    const r = rhoOf(e, x, y, z);
    if (r < 1 || r > 1 + T / havg(e, y)) return false;
    const [, , zc] = envAt(e, y);
    // scoop neck (lower at the front) and the cut-off armholes
    const neck = Math.hypot(x / 3.4, (z - neckZ(y) - 0.4) / 3.5) < 1.0 + 0.6 * sstep((y - 42.0) / 2.0) && y > 41.6 - (z > zc ? 0.5 + 0.12 * Math.sin(x * 4) : -0.6);
    if (neck) return false;
    if (Math.abs(x) > 5.95 - 0.12 * Math.sin(y * 3.3) && y > 39.2) return false;
    for (const [cx, cy, rx, ry] of rips) if (z > zc && ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 + 0.2 * Math.sin(x * 9 + y * 7) < 1) return false;
    return true;
  }, (x, y, z) => {
    const [, , zc] = envAt(e, y);
    if (z > zc + 1.0) {
      const c = teePrint(x, y);
      if (c !== null) return c;
    }
    return Math.abs(Math.abs(x) - 5.6) < 0.25 ? TEE.shade : TEE.base;
  });
}
/** a run of brass cartridges standing in their leather loops along a strap (points + outward normals) */
function cartridges(m: Sc, pts: { p: V3; n: V3 }[], every: number, across: (k: number) => V3, from = 0, to = 1e9) {
  for (let k = from; k < Math.min(pts.length, to); k += every) {
    const { p, n } = pts[k];
    const w = vnorm(across(k));
    const base = vadd(p, vmul(n, 0.42));
    const a = vsub(base, vmul(w, 0.8)), b = vadd(base, vmul(w, 0.45));
    m.cap(a, b, 0.36, 0.36, (x, y, z) => (vdot(vsub([x, y, z], base), n) > 0.18 ? TOON.brass.hi : TOON.brass.base), { flags: M });
    m.cap(b, vadd(b, vmul(w, 0.62)), 0.33, 0.12, COPPER, { flags: M });
  }
}

/** the rocker's sleeveless black leather vest over the band tee: open front with lapels, rows of pyramid
 *  studs down the fronts and round the armholes, conchos, the back patch */
function punkTorso(m: Sc) {
  const e = PUNK_ENV, T = PUNK_T;
  const outer = (y: number) => 1 + T / havg(e, y);
  teeTorso(m);
  const arm = (y: number) => 6.35 + 0.35 * Math.cos((y - 38) * 0.5);
  const armCut = (x: number, y: number) => y > 37.6 && Math.abs(x) > arm(y);
  // vest body: sleeveless (cut armholes), shoulder straps over the top
  bodyShell(m, e, 29.6, 45.0, T, LEA.base, xoPunk, (x, y) => armCut(x, y));
  // hem band with a stitch line on top
  m.region([-9, 29.6, -8], [9, 31.0, 7], (x, y, z) => {
    const r = rhoOf(e, x, y, z), [, , zc] = envAt(e, y);
    if (z > zc + 1.0 && Math.abs(x) < xoPunk(y)) return false;
    return r >= 1 + (T * 0.4) / havg(e, y) && r <= outer(y) + 0.4 / havg(e, y);
  }, (x, y) => (y > 30.75 ? LEA_EDGE : LEA.base));
  // armhole binding: a rolled leather edge round each opening
  m.region([-9.5, 37.4, -8], [9.5, 45.1, 7], (x, y, z) => {
    if (y < 37.6) return false;
    const r = rhoOf(e, x, y, z);
    return Math.abs(Math.abs(x) - arm(y)) < 0.42 && r >= 1 && r <= outer(y) + 0.3 / havg(e, y);
  }, LEA_EDGE);
  // lapels: folded-back flaps with a notch
  const lw = (y: number) => (y < 42.15 ? 2.35 * sstep((y - 36.8) / 5.2) : y < 42.85 ? 0.75 : 1.9);
  m.region([-9, 36.6, 0], [9, 44.7, 8], (x, y, z) => {
    const [, , zc] = envAt(e, y);
    if (z < zc + 1.6) return false;
    const ax = Math.abs(x), xo = xoPunk(y);
    if (ax < xo - 0.25 || ax > xo + lw(y) || armCut(x, y)) return false;
    const r = rhoOf(e, x, y, z);
    return r >= outer(y) - 0.25 / havg(e, y) && r <= outer(y) + 0.85 / havg(e, y);
  }, (x, y) => (Math.abs(x) - xoPunk(y) < 0.5 ? LEA.hi : LEA.base));
  // pyramid studs down both fronts and round the armholes, a silver concho at the chest
  for (const s of [1, -1]) {
    for (let y = 30.6; y <= 36.4; y += 1.15) {
      const x = s * (xoPunk(y) + 0.7);
      stud(m, [x, y, frontZ(e, x, y, T + 0.15)], vnorm([s * 0.25, 0, 1]), 0.42, true);
    }
    for (const y of [38.3, 39.7, 41.1]) {
      const x = s * (xoPunk(y) + lw(y) - 0.55);
      stud(m, [x, y, frontZ(e, x, y, T + 0.85)], vnorm([s * 0.35, 0, 1]), 0.44, true);
    }
    for (let y = 38.4; y <= 44.0; y += 1.2) {
      const x = s * (arm(y) - 0.85);
      stud(m, [x, y, frontZ(e, x, y, T + 0.1)], vnorm([s * 0.5, 0.1, 1]), 0.36, true);
      stud(m, [x, y, backZ(e, x, y, T + 0.1)], vnorm([s * 0.5, 0.1, -1]), 0.36, true);
    }
  }
  const cz = frontZ(e, 5.4, 34.0, T + 0.25);
  m.ell([5.4, 34.0, cz], [0.95, 0.95, 0.35], (x, y) => (Math.hypot(x - 5.4, y - 34.0) < 0.42 ? TOON.serket.base : y > 34.1 ? CHR.hi : CHR.base), { flags: M });
  // back: rocker patch arching over a round venom-drop patch
  m.region([-5, 37.6, -9], [5, 44.6, -4], (x, y, z) => {
    if (z > -4.5) return false;
    const r = rhoOf(e, x, y, z), o = outer(y);
    if (r < o - 0.2 / havg(e, y) || r > o + 0.75 / havg(e, y)) return false;
    const d = Math.hypot(x, y - 37.9);
    const rocker = d > 5.0 && d < 6.35 && Math.abs(x) < 4.6;
    const round = Math.hypot(x, y - 40.1) < 1.55;
    return rocker || round;
  }, (x, y) => {
    const d = Math.hypot(x, y - 37.9), rd = Math.hypot(x, y - 40.1);
    if (rd < 1.55) {
      const drop = Math.hypot(x, y - 39.75) < 0.72 || (y > 39.75 && y < 41.2 && Math.abs(x) < 0.72 * (41.2 - y) / 1.45);
      return rd > 1.2 ? 0x8e1c10 : drop ? VENOM : TOON.linen.base;
    }
    return d < 5.42 || d > 5.93 || Math.abs(x) > 4.15 ? TOON.linen.base : TOON.red.base;
  });
  // back yoke seam
  m.region([-8, 41.0, -8.5], [8, 41.5, -5], (x, y, z) => rhoOf(e, x, y, z) > outer(y) - 0.4 / havg(e, y) && Math.abs(x) > 4.7 && !armCut(x, y), LEA.dark, { mode: 'paint' });
  shadeRamps(m.m, [TEE], false);
}

function punkPauldron(m: Sc) {
  const pc: V3 = [-8.35, 42.9, -0.15];
  const R1: V3 = [3.15, 2.45, 3.35];
  m.shell(pc, R1, 0.85, (x, y) => (y > 44.6 ? LEA.hi : LEA.base), (x, y) => y > 41.3);
  const pc2: V3 = [-8.7, 41.75, -0.15], R2: V3 = [3.3, 2.0, 3.5];
  m.shell(pc2, R2, 0.8, LEA.base, (x, y) => y > 40.45 && y < 41.75);
  // rim edges + pyramid studs along both lames (outer half only)
  for (const [c, r, y] of [[pc, R1, 41.55], [pc2, R2, 40.65]] as [V3, V3, number][]) {
    const k = Math.sqrt(Math.max(0, 1 - ((y - c[1]) / r[1]) ** 2));
    for (let a = -1.45; a <= 1.451; a += 0.36) {
      const x = c[0] - r[0] * k * Math.cos(a), z = c[2] + r[2] * k * Math.sin(a);
      stud(m, [x, y + 0.15, z], vnorm([-(Math.cos(a)), 0.25, Math.sin(a)]), 0.45, true);
    }
  }
  // spikes rising from the dome
  const onDome = (d: V3): V3 => {
    const t = 1 / Math.sqrt((d[0] / R1[0]) ** 2 + (d[1] / R1[1]) ** 2 + (d[2] / R1[2]) ** 2);
    return vadd(pc, vmul(d, t));
  };
  for (const [d, L, r] of [
    [vnorm([-0.5, 0.86, 0]), 4.6, 1.0],
    [vnorm([-0.48, 0.74, 0.6]), 3.4, 0.86],
    [vnorm([-0.48, 0.74, -0.6]), 3.4, 0.86],
    [vnorm([-0.95, 0.3, 0.34]), 2.1, 0.64],
    [vnorm([-0.95, 0.3, -0.38]), 2.1, 0.64],
  ] as [V3, number, number][])
    spike(m, onDome(d), d, L, r);
  // chain swag hanging round the outside of the arm
  chain(m, [[-6.9, 41.1, 2.8], [-9.6, 39.2, 2.1], [-10.8, 38.75, 0.0], [-9.7, 39.2, -2.15], [-7.0, 41.1, -2.9]], 1.65);
}

/** leather sleeve on the upper arm (full): cap + tube + rolled cuff at the elbow */
function upperSleeve(m: Sc, s: number, C: Ramp, cuff: Ramp, y0 = 33.8, flames = false) {
  const ax = s * 8.0;
  m.shell([s * 8.1, 42.2, -0.1], [2.5, 2.2, 2.45], 1.0, C.base, (x, y) => y > 40.8);
  m.region([ax - 2.6, y0, -2.6], [ax + 2.6, 42.4, 2.6], (x, y, z) => {
    const r = lerp(2.0, 2.2, (y - y0) / (42.4 - y0));
    const d = Math.hypot(x - ax, z);
    return d <= r && d >= r - 1.0;
  }, C.base);
  m.region([ax - 2.6, y0 - 0.2, -2.6], [ax + 2.6, y0 + 1.0, 2.6], (x, y, z) => {
    const d = Math.hypot(x - ax, z);
    return d <= 2.32 && d >= 1.2;
  }, cuff.base);
  if (flames) {
    const arm: Tongue[] = [
      { at: 0, h: 4.4, w: 1.15, lean: 0.4 },
      { at: 1.7, h: 3.4, w: 1.0, lean: -0.4 },
      { at: 3.4, h: 3.9, w: 1.1, lean: 0.35 },
      { at: -1.7, h: 3.1, w: 1.0, lean: 0.4 },
      { at: -3.4, h: 3.6, w: 1.0, lean: -0.3 },
    ];
    m.region([ax - 2.6, y0 + 1.0, -2.6], [ax + 2.6, 40, 2.6], (x, y, z) => Math.hypot(x - ax, z) > 1.6, (x, y, z) => flameCol(arm, Math.atan2(z, -(x - ax) * s) * 2.1, y - (y0 + 1.0)), { mode: 'paint' });
  }
}

/** the rocker's right arm: bare (the vest is sleeveless), a barbed-wire tattoo round the biceps */
function punkArmR(m: Sc) {
  upperArmFlesh(m, -1, SKIN.base);
  barbTattoo(m, -1, 38.3);
  shadeRamps(m.m, [SKIN], true);
}

/** the left arm: bare, a thin studded leather band high on the biceps */
function punkArmL(m: Sc) {
  upperArmFlesh(m, 1, SKIN.base);
  const ax = 8.05;
  m.region([ax - 2.4, 39.3, -2.4], [ax + 2.4, 40.4, 2.4], (x, y, z) => {
    const d = Math.hypot(x - ax, z + 0.05);
    return d < 1.95 && d > 1.0;
  }, LEA.base);
  for (let a = 0; a < 5; a++) {
    const th = -1.3 + a * 0.65, d: V3 = [Math.cos(th), 0, Math.sin(th)];
    stud(m, vadd([ax, 39.85, -0.05], vmul(d, 1.9)), d, 0.34, true);
  }
  shadeRamps(m.m, [LEA, SKIN], true);
}

/** the gun hand: a living fist with silver rings, a wide studded wristband */
function punkForeR(m: Sc) {
  forearmFlesh(m, -1, SKIN.base);
  livingFist(m, -1);
  ring(m, [-FX[1], 22.05, 2.3], true);
  ring(m, [-FX[3], 22.05, 2.3]);
  studBand(m, -1, 25.7, 27.9, [26.35, 27.25]);
  shadeRamps(m.m, [LEA, SKIN], true);
}

/** the free hand: open, rings on two fingers, a studded cuff under a striped cloth sweatband */
function punkForeL(m: Sc) {
  forearmFlesh(m, 1, SKIN.base);
  livingHand(m, 1);
  ring(m, [7.67 + 0.05, 21.35, 0.62]);
  ring(m, [9.0 + 0.1, 21.3, 0.66], true);
  studBand(m, 1, 25.9, 27.2, [26.55]);
  const c: V3 = [8.6, 28.0, -0.1];
  m.region([c[0] - 2, 27.2, -2], [c[0] + 2, 28.8, 2], (x, y, z) => {
    const d = Math.hypot(x - c[0], z - c[2]);
    return d < 1.55 && d > 0.9 && y > 27.25 && y < 28.75;
  }, (x, y) => (Math.abs(y - 28.0) < 0.26 ? 0x1c1a1e : TOON.red.base));
  shadeRamps(m.m, [LEA, SKIN, TOON.red], true);
}

function punkPelvis(m: Sc) {
  const e = JEANS_ENV;
  bellyBody(m);
  // the tee's ragged hem hangs over the belly to the belt
  m.region([-7.5, 26.6, -6.5], [7.5, WAIST_CUT, 5.2], (x, y, z) => {
    const hx = 5.75 + 0.5, hz = 3.95 + 0.5;
    const r = Math.pow(Math.abs(x) / hx, 2.5) + Math.pow(Math.abs(z + 1.0) / hz, 2.5);
    const hem = 27.0 + 0.35 * Math.sin(x * 2.3 + z * 1.7) + 0.2 * Math.sin(x * 5.1);
    return r <= 1 && r > 0.72 && y > hem;
  }, (x, y) => (y < 27.6 ? TEE.shade : TEE.base));
  // a loose bullet belt slung low round the hips, dropping to the holster side
  {
    const ring: { p: V3; n: V3 }[] = [];
    for (let k = 0; k <= 120; k++) {
      const th = -Math.PI + (k / 120) * Math.PI * 2;
      ring.push(envPoint(e, th, 24.35 + 1.05 * Math.sin(th + 2.1), 1.35));
    }
    for (let k = 0; k < ring.length; k++) {
      const { p, n } = ring[k];
      for (let q = -0.55; q <= 0.551; q += 0.22) m.ell(vadd(p, [0, q, 0]), [0.42, 0.42, 0.42], Math.abs(q) > 0.4 ? STRAP.shade : STRAP.base);
      if (k % 30 === 7) m.rbox(vadd(p, vmul(n, 0.3)), [0.9, 0.85, 0.3], 0.2, (x, y) => (y > p[1] ? CHR.hi : CHR.base), { flags: M });
    }
    cartridges(m, ring, 3, () => [0, 1, 0], 2, 118);
  }
  // jeans seat (low-rise), crotch split between the legs
  m.region([-8, 19.8, -7], [8, 26.9, 5], (x, y, z) => {
    const r = rhoOf(e, x, y, z);
    if (r > 1 || r < 1 - 1.4 / havg(e, y)) return false;
    return !(y < 22.4 && Math.abs(x) < 0.9 + (22.4 - y) * 1.1);
  }, DEN.base);
  // whiskers (faded creases at the hip front), fly seam + J-stitch, pocket openings, rivets
  m.region([-8, 19.8, 0], [8, 26.9, 5], (x, y, z) => z > 1.0, (x, y, z) => {
    const ax = Math.abs(x);
    for (const [y0, sl] of [[21.4, 0.32], [22.2, 0.22], [23.0, 0.12]] as [number, number][]) if (ax > 1.6 && ax < 4.2 && Math.abs(y - (y0 + (ax - 1.6) * sl)) < 0.22) return DEN.hi;
    if (ax < 0.3 && y > 21.9) return DEN.dark;
    if (x > 0.7 && x < 1.25 && y > 22.3 && y < 25.2) return THREAD;
    const py = 25.25 - Math.pow(Math.max(0, ax - 2.9) / 3.3, 1.6) * 2.4;
    if (ax > 2.9 && ax < 6.3 && Math.abs(y - py) < 0.3) return DEN.dark;
    if (ax > 2.9 && ax < 6.3 && Math.abs(y - (py - 0.5)) < 0.18) return THREAD;
    return null;
  }, { mode: 'paint' });
  for (const s of [1, -1]) {
    const x = s * 6.0;
    m.ell([x, 23.25, frontZ(e, x, 23.25, 0.05)], [0.3, 0.3, 0.3], COPPER, { flags: M });
  }
  // back pockets with amber stitching and the arcuate double arc
  m.region([-7, 20.6, -7], [7, 25.4, -3], (x, y, z) => z < -3.5 && rhoOf(e, x, y, z) > 1 - 0.55 / havg(e, y), (x, y) => {
    const ax = Math.abs(x);
    if (ax < 1.5 || ax > 5.5 || y < 21.0 || y > 24.9) return null;
    if (ax < 1.85 || ax > 5.15 || y < 21.35) return THREAD;
    const arc = 23.6 - 0.45 * Math.sin(((ax - 1.5) / 4) * Math.PI);
    if (Math.abs(y - arc) < 0.17 || Math.abs(y - arc + 0.6) < 0.17) return THREAD;
    return DEN.shade;
  }, { mode: 'paint' });
  // studded black belt with an oval buckle (venom cabochon) and belt loops
  m.region([-8.5, 25.3, -7], [8.5, 27.25, 5.5], (x, y, z) => {
    const r = rhoOf(e, x, y, z);
    return r >= 1.0 && r <= 1 + 0.95 / havg(e, y) && y >= 25.35 && y <= 27.15;
  }, (x, y) => (y > 26.9 || y < 25.6 ? LEA_EDGE : LEA.base));
  for (let th = -2.55; th <= 2.551; th += 0.42) {
    if (Math.abs(th) > 2.2 && Math.abs(th) < 2.7) continue;
    if (th < -1.1 && th > -2.0) continue; // holster drop
    const { p, n } = envPoint(e, th, 26.25, 0.95);
    stud(m, p, n, 0.46, true);
  }
  const bz = frontZ(e, 0, 26.25, 1.2);
  m.ell([0, 26.25, bz], [2.35, 1.5, 0.5], (x, y) => {
    const d = (x / 2.35) ** 2 + ((y - 26.25) / 1.5) ** 2;
    return d > 0.72 ? (y > 26.3 ? CHR.hi : CHR.base) : d > 0.5 ? CHR.dark : CHR.shade;
  }, { flags: M, p: 2.2 });
  m.ell([0, 26.25, bz + 0.42], [0.78, 0.62, 0.42], (x, y) => (x < -0.15 && y > 26.4 ? 0xe6ffd0 : VENOM), { flags: VF.EMISSIVE });
  for (const th of [2.0, -2.0, 1.15, -1.15, 0]) {
    const { p, n } = envPoint(e, th, 26.25, 1.05);
    m.region(vsub(p, [1.2, 1.4, 1.2]), vadd(p, [1.2, 1.4, 1.2]), (x, y, z) => {
      const d = vsub([x, y, z], p), side = vnorm(vcross([0, 1, 0], n));
      return Math.abs(vdot(d, side)) < 0.38 && Math.abs(d[1]) < 1.15 && Math.abs(vdot(d, n)) < 0.3;
    }, DEN.shade);
  }
  holster(m, LEA);
  // wallet chain from the front belt loop to the back pocket
  chain(m, [[5.95, 25.0, 2.3], [6.95, 22.7, 1.25], [7.1, 21.6, -0.8], [6.65, 22.3, -3.0], [4.95, 23.6, -4.85]], 1.5);
  shadeRamps(m.m, [DEN, LEA, BN, SKIN], true);
}

/** an irregular rip mask on the front of a leg (centre cx, cy; radii rx, ry) */
const ripMask = (x: number, y: number, cx: number, cy: number, rx: number, ry: number) => {
  const a = Math.atan2(y - cy, x - cx);
  return ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1 + 0.16 * Math.sin(a * 5 + 1.3) + 0.08 * Math.sin(a * 9);
};

function punkThigh(m: Sc, s: number) {
  const ax0: V3 = [s * 3.95, 25.2, -0.75], ax1: V3 = [s * 3.55, 15.6, 0.25];
  m.path([ax0, [s * 3.8, 20.5, -0.2], ax1], (t) => lerp(2.45, 2.1, t), DEN.base);
  // side seam (shade) along the outside of the leg
  m.region([s > 0 ? 4 : -7, 15.4, -1.2], [s > 0 ? 7 : -4, 25.4, 0.8], (x, y, z) => Math.abs(z + 0.15) < 0.3 && s * x > 5.2, DEN.shade, { mode: 'paint' });
  const rip = s > 0 ? { cx: s * 3.6, cy: 16.95, rx: 1.45, ry: 1.45 } : { cx: s * 3.75, cy: 19.6, rx: 1.4, ry: 0.55 };
  const inRip = (x: number, y: number, z: number) => z > -0.2 && ripMask(x, y, rip.cx, rip.cy, rip.rx, rip.ry);
  m.region([rip.cx - 2, rip.cy - 2, -0.4], [rip.cx + 2, rip.cy + 2, 3.2], inRip, 0, { mode: 'carve' });
  m.walls([rip.cx - 2.2, rip.cy - 2.2, -0.6], [rip.cx + 2.2, rip.cy + 2.2, 3.4], (x, y, z) => z > -0.2 && ripMask(x, y, rip.cx, rip.cy, rip.rx, rip.ry), (x, y, z) => (z > 0.6 ? FRAY : DEN.dark));
  if (s > 0) {
    m.ell([s * 3.6, 16.75, 0.3], [1.75, 2.05, 1.72], SKIN.base, { mode: 'under' }); // the knee through the rip
    m.ell([s * 3.6, 16.2, 1.65], [0.8, 0.85, 0.5], SKIN.hi, { mode: 'under' });
  } else m.cap([s * 3.9, 21.5, -0.4], [s * 3.65, 17.8, 0.1], 1.85, 1.75, SKIN.base, { mode: 'under' }); // thigh through the slash
  // white weft threads bridging the hole
  m.region([rip.cx - 2, rip.cy - 2, 0], [rip.cx + 2, rip.cy + 2, 3.2], (x, y, z) => {
    const j = Math.floor(y * S);
    if (j % 2 || !ripMask(x, y, rip.cx, rip.cy, rip.rx * 0.98, rip.ry * 0.9)) return false;
    const fz = lerp(ax0[2], ax1[2], (ax0[1] - y) / (ax0[1] - ax1[1])) + lerp(2.45, 2.1, (ax0[1] - y) / (ax0[1] - ax1[1])) - 0.35;
    return Math.abs(z - fz) < 0.36;
  }, FRAY);
  shadeRamps(m.m, [DEN, BN, SKIN, ROT], true);
}

function punkShin(m: Sc, s: number) {
  m.path([[s * 3.5, 15.35, 0.3], [s * 3.3, 10.0, 0.05]], (t) => lerp(2.05, 1.85, t), DEN.base);
  // stacking folds just above the boot
  m.region([s * 3.3 - 2.5, 9.7, -2.5], [s * 3.3 + 2.5, 11.0, 2.5], (x, y, z) => Math.hypot(x - s * 3.3, z) < 2.18, (x, y) => (Math.abs(y - 10.35) < 0.22 ? DEN.shade : DEN.base));
  if (s > 0) {
    // the lower half of the knee rip
    const inRip = (x: number, y: number, z: number) => z > -0.2 && ripMask(x, y, s * 3.6, 16.95, 1.45, 1.45);
    m.region([s * 3.6 - 2, 14, -0.4], [s * 3.6 + 2, 15.9, 3.2], inRip, 0, { mode: 'carve' });
    m.walls([s * 3.6 - 2.2, 13.8, -0.6], [s * 3.6 + 2.2, 16, 3.4], (x, y, z) => z > -0.2 && ripMask(x, y, s * 3.6, 16.95, 1.45, 1.45), (x, y, z) => (z > 0.6 ? FRAY : DEN.dark));
  }
  if (s > 0) m.region([s * 3.6 - 2, 14.0, -1], [s * 3.6 + 2, 15.5, 2.4], (x, y, z) => y < 15.5 && ((x - s * 3.6) / 1.75) ** 2 + ((y - 16.75) / 2.05) ** 2 + ((z - 0.3) / 1.72) ** 2 <= 1, SKIN.base, { mode: 'under' });
  cowboyBoot(m, s, BOOT, { harness: true, spur: true });
  shadeRamps(m.m, [DEN, BOOT, BN, SKIN], true);
}

// ================================================================== OTHER OUTFITS (same HD language)
interface Look {
  coat: Ramp;
  trim: Ramp;
  band: Ramp;
  boot: Ramp;
  belt: Ramp;
}
const LOOKS: Record<OutfitId, Look> = {
  bare: { coat: TOON.leather, trim: TOON.leatherDark, band: TOON.red, boot: TOON.leather, belt: TOON.leatherDark },
  punk: { coat: LEA, trim: LEA, band: TOON.red, boot: BOOT, belt: LEA },
  duster: { coat: TOON.duster, trim: TOON.leatherDark, band: TOON.red, boot: TOON.leather, belt: TOON.leatherDark },
  poncho: { coat: TOON.poncho, trim: TOON.linen, band: TOON.turquoise, boot: TOON.leather, belt: TOON.leatherDark },
  vest: { coat: TOON.leather, trim: TOON.leatherDark, band: TOON.red, boot: ramp(0x8e3b26, 0x6c2a1b, 0xad5236, 0x4a1a10), belt: TOON.leatherDark },
  sheriff: { coat: ramp(0x3a3a48, 0x2a2a36, 0x50505e, 0x1a1a22), trim: TOON.black, band: TOON.black, boot: TOON.black, belt: TOON.black },
  pharaoh: { coat: TOON.linen, trim: TOON.gold, band: TOON.lapis, boot: TOON.gold, belt: TOON.gold },
};

function sheriffStar(m: Sc, c: V3) {
  const G = TOON.gold;
  m.region([c[0] - 1.6, c[1] - 1.6, c[2] - 0.4], [c[0] + 1.6, c[1] + 1.6, c[2] + 0.4], (x, y, z) => {
    if (Math.abs(z - c[2]) > 0.3) return false;
    const dx = x - c[0], dy = y - c[1], r = Math.hypot(dx, dy), a = Math.atan2(dx, dy);
    const f = Math.abs(((a / ((Math.PI * 2) / 5)) % 1 + 1) % 1 - 0.5);
    return r < 0.55 + (1.45 - 0.55) * Math.pow(f * 2, 2.2) || r < 0.6;
  }, (x, y) => (y > c[1] + 0.4 ? G.hi : G.base), { flags: M });
}

function dusterTorso(m: Sc, C: Ramp, T: Ramp) {
  const e = DUSTER_ENV;
  const xo = (y: number) => lerp(4.4, 5.5, sstep((y - 36) / 8));
  bodyShell(m, e, 29.4, 45.5, 1.2, C.base, xo);
  const outer = (y: number) => 1 + 1.2 / havg(e, y);
  // wide lapels, standing collar
  m.region([-9, 35.4, 0], [9, 44.8, 8], (x, y, z) => {
    const [, , zc] = envAt(e, y);
    if (z < zc + 1.6) return false;
    const ax = Math.abs(x), w = 2.6 * sstep((y - 35.4) / 6);
    if (ax < xo(y) - 0.2 || ax > xo(y) + w) return false;
    const r = rhoOf(e, x, y, z);
    return r >= outer(y) - 0.25 / havg(e, y) && r <= outer(y) + 0.85 / havg(e, y);
  }, T.base);
  m.region([-6.5, 44.2, -6.5], [6.5, 47.2, 2.4], (x, y, z) => {
    const hx = 4.7, hz = 3.9, zc = -1.75;
    const r = Math.pow(Math.pow(Math.abs(x) / hx, 2.4) + Math.pow(Math.abs(z - zc) / hz, 2.4), 1 / 2.4);
    return r >= 1 && r <= 1 + 0.8 / 4.3 && z < zc + 1.9;
  }, T.base);
  // yoke + back seam + half-belt with a brass button; patch pocket on the left chest
  m.region([-9, 29.4, -9], [9, 45, -3], (x, y, z) => rhoOf(e, x, y, z) > outer(y) - 0.4 / havg(e, y) && (Math.abs(y - 41.8) < 0.25 || (Math.abs(x) < 0.3 && y < 41.6)), C.dark, { mode: 'paint' });
  m.region([-5, 30.6, -9], [5, 31.8, -4], (x, y, z) => rhoOf(e, x, y, z) > outer(y) - 0.2 / havg(e, y) && rhoOf(e, x, y, z) < outer(y) + 0.6 / havg(e, y) && Math.abs(x) < 4.6, T.base);
  m.ell([0, 31.2, backZ(e, 0, 31.2, 1.75)], [0.42, 0.42, 0.3], TOON.brass.hi, { flags: M });
  m.region([5, 32.6, 0], [7.4, 35.6, 8], (x, y, z) => x > 5.25 && x < 7.1 && y > 32.8 && y < 35.4 && rhoOf(e, x, y, z) > outer(y) - 0.2 / havg(e, y) && rhoOf(e, x, y, z) < outer(y) + 0.6 / havg(e, y) && z > 0, (x, y) => (y > 35.0 ? T.base : C.shade));
}

function dusterSkirt(C: Ramp, T: Ramp) {
  const m = sc('coat');
  const hx = (y: number) => lerp(8.5, 7.3, (y - 19) / 10.8), hz = (y: number) => lerp(5.6, 4.9, (y - 19) / 10.8), zc = -1.4;
  m.region([-9.5, 19, -8], [9.5, 29.8, 5], (x, y, z) => {
    const r = Math.pow(Math.pow(Math.abs(x) / hx(y), 2.5) + Math.pow(Math.abs(z - zc) / hz(y), 2.5), 1 / 2.5);
    if (r < 1 || r > 1 + 1.1 / ((hx(y) + hz(y)) / 2)) return false;
    if (z > zc + 1 && Math.abs(x) < 3.2) return false; // open front
    if (y < 23.4 && Math.abs(x) < 0.4 && z < zc) return false; // back vent
    return true;
  }, (x, y) => (y < 19.5 ? C.shade : C.base));
  for (const s of [1, -1]) m.region([s * 6, 24.6, -2.6], [s * 9.6, 25.6, 0.6], (x, y, z) => Math.abs(x) > hx(y) + 0.4 && Math.abs(x) < hx(y) + 1.1, T.base); // pocket flaps
  shadeRamps(m.m, [C, T], true);
  return { m, hxB: hx(19), hzB: hz(19), zc };
}

function vestTorso(m: Sc, C: Ramp, T: Ramp, star: boolean) {
  const e = VEST_ENV;
  const arm = (x: number, y: number, z: number) => Math.abs(x) > 5.2 && y > 36.6 && Math.hypot((Math.abs(x) - 8) / 3.2, (y - 42.6) / 6.2) < 1;
  bodyShell(m, e, 30.4, 44.6, 1.0, C.base, () => 2.6, arm);
  m.walls([-9, 30, -8], [9, 45, 7], (x, y, z) => rhoOf(e, x, y, z) < 1 + 1.0 / havg(e, y) && rhoOf(e, x, y, z) > 1 && (arm(x, y, z) || (z > envAt(e, y)[2] + 1 && Math.abs(x) < 2.6)), T.base);
  for (const y of [33.2, 35.6, 38.0]) m.ell([-3.2, y, frontZ(e, -3.2, y, 1.25)], [0.4, 0.4, 0.3], TOON.brass.hi, { flags: M });
  chain(m, [[-3.2, 33.2, frontZ(e, -3.2, 33.2, 1.3)], [-0.5, 32.0, frontZ(e, -0.5, 32.0, 2.6)], [2.4, 32.6, frontZ(e, 2.4, 32.6, 1.5)], [4.4, 33.4, frontZ(e, 4.4, 33.4, 1.2)]], 1.2, TOON.gold);
  if (star) sheriffStar(m, [5.0, 38.4, frontZ(e, 5.0, 38.4, 1.35)]);
}

function ponchoTorso(m: Sc, C: Ramp) {
  const e = PONCHO_ENV;
  bodyShell(m, e, 32.6, 45.8, 0.9, (x, y) => {
    const j = Math.floor(y * S), i = Math.floor(x * S);
    if (y > 36.6 && y < 37.5) return (i + j) % 4 < 2 ? TOON.turquoise.base : TOON.linen.base;
    if (y > 38.2 && y < 39.0) return TOON.red.base;
    if (y > 40.0 && y < 40.9) return (i - j) % 4 < 2 ? TOON.turquoise.base : TOON.linen.base;
    if (y < 33.2) return C.shade;
    return C.base;
  });
  // fringe along the hem
  for (let th = -Math.PI; th < Math.PI; th += 0.16) {
    const { p } = envPoint(e, th, 32.6, 0.45);
    m.cap(p, vadd(p, [0, -1.3, 0]), 0.24, 0.2, TOON.linen.shade);
  }
}

function pharaohTorso(m: Sc) {
  const e = FLESH_ENV;
  const rows: [number, number, number][] = [[43.9, 44.7, TOON.gold.base], [42.9, 43.9, TOON.lapis.base], [41.9, 42.9, TOON.gold.hi], [40.9, 41.9, TOON.turquoise.base], [40.0, 40.9, TOON.gold.base]];
  for (const [y0, y1, c] of rows)
    m.region([-9, y0, -8], [9, y1, 7], (x, y, z) => {
      const r = rhoOf(e, x, y, z), o = 1 + (0.6 + (44.7 - y) * 0.25) / havg(e, y);
      return r >= o && r <= o + 0.9 / havg(e, y) && y >= y0 && y < y1;
    }, c, { flags: c === TOON.gold.base || c === TOON.gold.hi ? M : VF.SOLID });
  // scarab pectoral on the sternum
  const z = frontZ(e, 0, 37.6, 0.9);
  m.ell([0, 37.6, z], [1.2, 1.5, 0.5], TOON.lapis.base);
  m.ell([0, 38.6, z + 0.3], [0.55, 0.45, 0.35], TOON.turquoise.hi);
  for (const s of [1, -1]) m.cap([s * 1.0, 37.8, z], [s * 2.4, 38.6, z - 0.3], 0.4, 0.25, TOON.gold.base, { flags: M });
}

function shendyt() {
  const m = sc('coat');
  const L = TOON.linen;
  const hx = (y: number) => lerp(8.4, 7.1, (y - 17.4) / 10.6), hz = 4.9, zc = -1.3;
  m.region([-9, 17.4, -7], [9, 28.0, 5], (x, y, z) => {
    const r = Math.pow(Math.pow(Math.abs(x) / hx(y), 2.4) + Math.pow(Math.abs(z - zc) / hz, 2.4), 1 / 2.4);
    return r >= 1 && r <= 1 + 1.0 / ((hx(y) + hz) / 2);
  }, (x, y, z) => ((Math.floor((Math.atan2(x, -(z - zc)) + 4) * 9) & 1) ? L.base : L.shade));
  m.region([-9, 27.0, -7], [9, 28.4, 5], (x, y, z) => {
    const r = Math.pow(Math.pow(Math.abs(x) / (hx(y) + 0.2), 2.4) + Math.pow(Math.abs(z - zc) / (hz + 0.2), 2.4), 1 / 2.4);
    return r >= 1 && r <= 1.2;
  }, TOON.gold.base, { flags: M });
  m.rbox([0, 22.6, zc + hz + 1.25], [1.6, 4.6, 0.3], 0.2, (x, y) => ((Math.floor(y * S) % 3 === 0) ? TOON.lapis.base : TOON.gold.base), { flags: M });
  shadeRamps(m.m, [L], true);
  return m;
}

// ================================================================== HATS (fit the dome; hat part pivots at J.hat)
function stetson(F: Ramp, band: number, o: { battered?: boolean; gambler?: boolean; studs?: boolean; feather?: number; rocker?: boolean } = {}) {
  const h = sc('hat');
  const B0 = 58.85;
  const RK = !!o.rocker;
  const lean = (k: number) => (o.battered ? (RK ? 0.25 : 0.4) * k : 0);
  // brim: cattleman curl at the sides (the rocker's is flatter and narrower), dipped front/back, torn notch + bullet hole when battered
  const BX = RK ? 12.7 : 13.6, BZ = RK ? 11.3 : 12.2;
  const curl = RK ? 1.25 : o.gambler ? 0.7 : 2.6;
  const brimY = (x: number, z: number) => B0 + curl * Math.pow(Math.abs(x) / BX, 3) - (RK ? 0.55 : 0.8) * Math.pow(Math.max(0, (z + 0.6) / BZ), 2) - 0.35 * Math.pow(Math.max(0, -(z + 0.6) / BZ), 2);
  h.region([-14.6, B0 - 1.5, -13.6], [14.6, B0 + 3.6, 12.6], (x, y, z) => {
    const ex = x / BX, ez = (z + 0.6) / BZ;
    let e = ex * ex + ez * ez;
    if (o.battered) {
      const a = Math.atan2(x, z + 0.6);
      e *= 1 + 0.03 * Math.sin(a * 7 + 1) + (Math.abs(a - 0.62) < 0.13 ? 0.18 * (1 - Math.abs(a - 0.62) / 0.13) : 0);
      if (Math.hypot(x + 9.2, z + 6.2) < 0.62) return false; // bullet hole
    }
    if (e > 1) return false;
    const yb = brimY(x, z);
    return y >= yb && y <= yb + 0.82;
  }, (x, y, z) => {
    const e = (x / BX) ** 2 + ((z + 0.6) / BZ) ** 2;
    return e > 0.88 ? F.shade : F.base;
  });
  // crown: pinched cattleman crease (or flat gambler top; the rocker's is a tall, straight-walled stovepipe
  // crown with a flat top and a soft telescope crease), a lived-in lean and a dent
  const yTop = RK ? 69.2 : o.gambler ? 65.7 : 66.6;
  h.region([-8, B0, -9], [8, yTop + 0.6, 7], (x, y, z) => {
    if (y < B0 + 0.35) return false;
    const k = (y - B0) / (yTop - B0);
    const lx = x - lean(k);
    let rx = RK ? lerp(6.7, 6.05, k) : lerp(6.75, o.gambler ? 6.3 : 5.45, k);
    const rz = RK ? lerp(7.4, 6.75, k) : lerp(7.45, o.gambler ? 7.0 : 6.3, k), zc = -0.9;
    if (o.battered && lx > 0) rx -= (RK ? 0.6 : 0.95) * Math.exp(-(((y - (RK ? 64.4 : 63.3)) / 1.7) ** 2) - ((z + 1.2) / 2.3) ** 2);
    const d = Math.pow(Math.abs(lx) / rx, RK ? 3.2 : 2.6) + Math.pow(Math.abs(z - zc) / rz, RK ? 3.2 : 2.6);
    if (d > 1) return false;
    let top = yTop;
    if (RK) {
      // telescope crease: a shallow ring pressed into the flat top, the rim left standing round it
      const rr = Math.pow(Math.abs(lx) / (rx - 1.3), 2.6) + Math.pow(Math.abs(z - zc) / (rz - 1.3), 2.6);
      top -= 0.85 * sstep((1.05 - rr) / 0.25) + 0.35 * d * d;
    } else if (!o.gambler) {
      top -= 1.5 * Math.exp(-((lx / 1.25) ** 2)) * sstep((z + 6) / 3);
      if (z > 1.5) top -= 1.7 * Math.exp(-(((Math.abs(lx) - 2.7) / 1.05) ** 2)) * sstep((z - 1.5) / 4);
      top -= 0.9 * sstep((z - 4) / 2.5);
    }
    if (y > top) return false;
    const di = Math.pow(Math.abs(lx) / (rx - 1.05), 2.6) + Math.pow(Math.abs(z - zc) / (rz - 1.05), 2.6);
    return !(di < 1 && y < top - 1.05);
  }, F.base);
  // band round the crown base
  h.region([-8, B0 + 0.35, -9], [8, B0 + (RK ? 2.35 : 1.95), 7], (x, y, z) => {
    const rx = 6.75 - 0.15, rz = 7.45 - 0.15;
    const d = Math.pow(Math.abs(x) / rx, 2.6) + Math.pow(Math.abs(z + 0.9) / rz, 2.6);
    return d > 0.78 && d < 1.12;
  }, band, { mode: 'paint' });
  if (o.studs) {
    for (let a = -2.4; a <= 2.41; a += 0.6) {
      const x = 6.85 * Math.sin(a), z = -0.9 + 7.55 * Math.cos(a);
      stud(h, [x, B0 + (RK ? 1.35 : 1.15), z], vnorm([Math.sin(a), 0, Math.cos(a)]), RK ? 0.56 : 0.48);
    }
  }
  if (o.feather !== undefined) {
    // a barred feather tucked in the band on the left, its blade turned to face front-left
    const pts = spline([[6.3, B0 + 1.1, -1.6], [7.35, B0 + 3.6, -3.3], [8.0, B0 + 6.4, -5.3], [8.05, B0 + 8.3, -6.6]], 6);
    const smp = resample(pts, 0.22);
    smp.forEach((q, k) => {
      const t = k / Math.max(1, smp.length - 1);
      let n = vnorm([1, 0, 0.85]);
      n = vnorm(vsub(n, vmul(q.t, vdot(n, q.t))));
      const w = vnorm(vcross(q.t, n));
      const half = 0.22 + 0.85 * Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.08)), 0.55);
      h.oell(q.p, [q.t, w, n], [0.3, half, 0.27], (x, y, z) => {
        const off = Math.abs(vdot(vsub([x, y, z], q.p), w));
        if (off < 0.18) return TOON.linen.shade; // quill
        return t > 0.84 ? TOON.white.base : (Math.floor(t * 9) & 1) ? TOON.linen.base : o.feather!;
      });
    });
  }
  if (o.battered) {
    // bullet hole through the front of the crown, scorched rim
    const hole = (x: number, y: number) => Math.hypot(x + 2.9, y - 64.1) < 0.6;
    h.region([-4, 63, 2], [-2, 65.2, 7], (x, y, z) => hole(x, y), 0, { mode: 'carve' });
    h.walls([-4.5, 62.5, 1.5], [-1.5, 65.7, 7], (x, y) => hole(x, y), F.dark);
  }
  shadeRamps(h.m, [F], true);
  return h.m;
}

function sombrero() {
  const straw = ramp(0xe8c47a, 0xc9a25a, 0xf8dc9c, 0x9a7a3a);
  const h = sc('hat');
  const B0 = 58.85;
  h.region([-18.5, B0 - 0.5, -19], [18.5, B0 + 3.4, 18], (x, y, z) => {
    const r = Math.hypot(x, z + 0.6);
    if (r > 18) return false;
    const yb = B0 + (r > 15 ? 2.3 * sstep((r - 15) / 3) : 0);
    return y >= yb && y <= yb + 0.82;
  }, (x, y, z) => {
    const r = Math.hypot(x, z + 0.6);
    return r > 16.9 ? TOON.red.base : (Math.floor(r * 0.75) & 1) ? straw.base : straw.shade;
  });
  h.region([-9, B0, -9.6], [9, 72.8, 8.4], (x, y, z) => {
    const rr = y < 61 ? 8.4 : 8.4 - (y - 61) * 0.62;
    const r = Math.hypot(x, z + 0.6);
    return r <= rr && (r >= rr - 1.1 || y > 71.6) && y < 72.6 - (r / 8.4) * 0.4;
  }, (x, y, z) => ((Math.floor(y * S) + Math.floor((Math.atan2(x, z + 0.6) + 4) * 6)) % 3 === 0 ? straw.shade : straw.base));
  h.region([-9.2, 60.5, -9.8], [9.2, 62.3, 8.6], (x, y, z) => Math.hypot(x, z + 0.6) > 7.35, (x, y, z) => {
    const a = Math.floor((Math.atan2(x, z + 0.6) + 4) * 4);
    return a % 3 === 0 ? TOON.green.base : y < 61.3 ? TOON.red.base : TOON.gold.base;
  }, { mode: 'paint' });
  shadeRamps(h.m, [straw], true);
  return h.m;
}

function tophat() {
  const K = TOON.black;
  const h = sc('hat');
  const B0 = 58.85;
  h.region([-11, B0 - 0.5, -11], [11, B0 + 2, 10], (x, y, z) => {
    const e = (x / 10.6) ** 2 + ((z + 0.6) / 9.8) ** 2;
    if (e > 1) return false;
    const yb = B0 + (Math.abs(x) > 8.2 ? 1.1 * sstep((Math.abs(x) - 8.2) / 2.4) : 0);
    return y >= yb && y <= yb + 0.8;
  }, K.base);
  h.region([-7.6, B0, -8.8], [7.6, 75.4, 7.0], (x, y, z) => {
    const f = y > 70 ? (y - 70) * 0.07 : 0;
    const d = Math.pow(Math.abs(x) / (6.9 + f), 3) + Math.pow(Math.abs(z + 0.85) / (7.0 + f), 3);
    const di = Math.pow(Math.abs(x) / (5.9 + f), 3) + Math.pow(Math.abs(z + 0.85) / (6.0 + f), 3);
    return d <= 1 && (di > 1 || y > 74.4) && y <= 75.3;
  }, (x, y) => (y > 61.2 && y < 63.4 ? TOON.red.base : y > 74.9 ? K.hi : K.base));
  // a playing card tucked in the band
  const cz = 6.15;
  h.rbox([3.9, 64.4, cz], [1.05, 1.55, 0.22], 0.15, TOON.white.base);
  h.ell([3.9, 64.4, cz + 0.2], [0.42, 0.5, 0.2], TOON.red.base);
  shadeRamps(h.m, [K], true);
  return h.m;
}

function nemes() {
  const G = TOON.gold, L = TOON.lapis;
  const h = sc('hat');
  const stripe = (x: number, y: number) => ((Math.floor(y * S / 1.5) & 1) ? L.base : G.base);
  const fl = (x: number, y: number) => ((Math.floor(y * S / 1.5) & 1) ? VF.SOLID : M);
  void fl;
  h.shell([0, 55.6, -0.9], [7.0, 8.45, 7.75], 0.95, stripe, (x, y, z) => y > 50 && !(z > 1.2 && y < 57.6), { p: 2.25 });
  h.region([-7, 57.4, 2], [7, 58.5, 7.5], (x, y, z) => Math.pow(Math.abs(x) / 7.0, 2.25) + Math.pow(Math.abs(y - 55.6) / 8.45, 2.25) + Math.pow(Math.abs(z + 0.9) / 7.75, 2.25) <= 1 && z > 1.2, G.hi, { mode: 'paint', flags: M });
  for (const s of [1, -1]) h.rbox([s * 7.5, 44.6, 0], [1.2, 6.3, 0.9], 0.4, stripe);
  h.region([-3.6, 42.6, -9.4], [3.6, 51, -6.6], (x, y, z) => Math.abs(x) < 1.6 + (y - 42.6) * 0.25 && z < -7.0 && z > -8.6 && y < 50.6, stripe);
  // uraeus cobra rearing on the forehead, ruby eyes
  h.cap([0, 57.8, 6.5], [0, 60.6, 7.4], 0.55, 0.42, G.base, { flags: M });
  h.ell([0, 60.9, 7.5], [0.95, 1.0, 0.45], G.hi, { flags: M });
  for (const s of [1, -1]) h.ell([s * 0.35, 61.1, 7.95], [0.18, 0.18, 0.18], TOON.red.hi, { flags: M });
  shadeRamps(h.m, [G, L], true);
  return h.m;
}

function hatDuck() {
  const yel = ramp(0xffd23a, 0xe8a91c, 0xffeb8a, 0xb07a10);
  const org = ramp(0xff8a2a, 0xd8661a, 0xffac5a, 0x9a4410);
  const h = sc('hat');
  h.ell([0, 63.4, -1.0], [6.6, 3.7, 7.6], yel.base, { p: 2.2 }); // body on the dome
  h.ell([0, 69.5, 2.4], [3.7, 3.7, 3.6], yel.base); // head
  h.cap([0, 64.4, -6.6], [0, 67.0, -9.2], 1.7, 0.6, yel.base); // tail flick
  for (const s of [1, -1]) h.ell([s * 6.0, 63.9, -1.4], [1.0, 2.4, 4.1], yel.shade); // wings
  h.ell([0, 68.5, 6.4], [2.2, 0.85, 2.2], org.base); // beak
  h.ell([0, 67.7, 6.0], [1.8, 0.45, 1.8], org.shade);
  for (const s of [1, -1]) {
    h.ell([s * 2.35, 70.4, 4.75], [0.78, 0.78, 0.6], 0x14100c, { flags: M }); // glossy toy eyes
    h.ell([s * 2.35 - 0.3, 70.75, 5.25], [0.22, 0.22, 0.2], 0xffffff);
  }
  shadeRamps(h.m, [yel, org], true);
  return h.m;
}

function buildHat(id: HatId, o: OutfitId) {
  switch (id) {
    case 'duck':
      return hatDuck();
    case 'sombrero':
      return sombrero();
    case 'nemes':
      return nemes();
    case 'tophat':
      return tophat();
    case 'bandit':
      return warped(W_HAT, () => stetson(ramp(0x34302e, 0x242120, 0x4a4542, 0x141212), 0xb8bcc4, { gambler: true, studs: true, feather: TOON.red.base }));
    case 'wig':
      return frogWigHat(54); // Mama Frog's fabulous wig
    default:
      if (o === 'sheriff') return warped(W_HAT, () => stetson(ramp(0x5a4a3c, 0x45382c, 0x726050, 0x2c2218), TOON.black.base));
      return warped(W_HAT, () => stetson(ramp(0x3a302c, 0x282120, 0x54463e, 0x171312), 0x1a1618, { battered: true, studs: true, feather: 0x3a2a20, rocker: true }));
  }
}
const HAT_TOP: Record<HatId, number> = { stetson: 67.3, duck: 73.3, sombrero: 72.8, nemes: 64.6, tophat: 75.5, bandit: 66.2, wig: FROG_WIG_TOP };
/** the hat's top in head-family units (the stetsons through their size-up warp) */
const hatTopOf = (id: HatId) => (STETSONS.includes(id) ? W_HAT.Y(HAT_TOP[id]) : HAT_TOP[id]);

// ================================================================== OUTLAW MASK (cloth tied over the lower face)
/** the cloth wraps the jaw like a loose cylinder: rows [y, half width, half depth, centre z] (head frame) */
const MASK_ENV: Env = [
  [43.6, 5.0, 3.9, 3.3],
  [45.0, 6.0, 5.05, 2.05],
  [46.6, 6.3, 5.73, 1.12],
  [48.0, 6.15, 6.8, -0.25],
  [49.4, 6.1, 7.03, -0.53],
  [51.2, 6.2, 7.03, -0.68],
];
const MASK_T = 0.8;
/** top hem: just under the nose cavity at the front, rising over the cheeks to the knot at the back */
const maskTop = (c: number) => 50.9 - 1.55 * Math.pow((c + 1) / 2, 1.6);
/** bottom edge: under the chin at the front (the drape carries on below), a narrow band at the back */
const maskBot = (c: number) => 48.6 - 4.6 * Math.pow((c + 1) / 2, 0.7);
const MASK_LOOK: Record<OutfitId, { r: Ramp; print: number; dim: number }> = {
  punk: { r: ramp(0x7c2622, 0x5c1a17, 0x9c3c33, 0x380f0c), print: 0xc08a76, dim: 0x8e4a3e }, // oxblood, faded rose paisley
  bare: { r: TOON.red, print: 0xd8b8a0, dim: TOON.red.hi },
  duster: { r: TOON.red, print: 0xd8b8a0, dim: TOON.red.hi },
  vest: { r: TOON.red, print: 0xd8b8a0, dim: TOON.red.hi },
  poncho: { r: TOON.turquoise, print: 0xe6dcc4, dim: TOON.turquoise.hi },
  sheriff: { r: TOON.black, print: 0x8a8580, dim: 0x58524e },
  pharaoh: { r: TOON.lapis, print: TOON.gold.base, dim: TOON.lapis.hi },
};

/** where the head-side band ends; below it the chin cloth (riding the jaw) carries on, tucked under it */
const headBot = (c: number) => 48.6 - 3.1 * Math.pow((c + 1) / 2, 0.8);
/** the chin cloth wraps front and sides of the jaw (c > -0.78), from under the jawline up under the head band */
const jawBot = (c: number) => lerp(44.6, 43.9, (c + 0.78) / 1.78);
const jawTop = (c: number) => lerp(49.6, 48.8, (c + 0.78) / 1.78);

/**
 * An outlaw's cloth pulled up over the jaw and teeth, knotted behind the skull.
 * `head`: the band over the upper teeth, cheeks and the back of the skull + the knot (a `mask` part, child of head).
 * `jaw`: the chin cloth + the frayed drape, merged into the `jaw` part so it follows the jaw (talking, laughing)
 * and the bone can never poke out; it tucks under the head band, so an open jaw only parts the cloth in a dark fold.
 */
function outlawMask(o: OutfitId) {
  const { r: R, print, dim } = MASK_LOOK[o] ?? MASK_LOOK.punk;
  const mh = sc('mask'), mj = sc('jaw_cloth');
  const e = MASK_ENV;
  const cOf = (x: number, y: number, z: number) => -Math.cos(thetaOf(e, x, y, z)); // 1 front, -1 back
  // faded paisley: teardrop dots on a staggered lattice (deliberate, not noise)
  const printAt = (x: number, y: number, z: number) => {
    const i = Math.floor(x * S), j = Math.floor(y * S), l = Math.floor(z * S);
    const h = i + l + (Math.floor(j / 4) & 1) * 3;
    const jm = ((j % 4) + 4) % 4, hm = ((h % 6) + 6) % 6;
    if (jm === 0 && hm === 0) return print;
    if (jm === 1 && hm === 1) return dim;
    if (jm === 2 && hm === 3) return dim;
    return null;
  };
  const cloth = (x: number, y: number, z: number) => {
    const th = Math.abs(thetaOf(e, x, y, z)), c = -Math.cos(th);
    if (Math.abs(c) < 0.85 && ((((y - 44.2 + th * 1.35) / 1.55) % 1) + 1) % 1 < 0.17) return R.shade; // tension creases toward the knot
    return printAt(x, y, z) ?? R.base;
  };
  // ---- head band: over the upper teeth, under the nose, round the cheeks to the back of the skull
  mh.region([-7.5, 45.2, -9], [7.5, 51.6, 8.5], (x, y, z) => {
    const rr = rhoOf(e, x, y, z);
    if (rr < 1 || rr > 1 + MASK_T / havg(e, y)) return false;
    const c = cOf(x, y, z);
    return y <= maskTop(c) && y >= headBot(c);
  }, (x, y, z) => (maskTop(cOf(x, y, z)) - y < 0.5 ? R.hi : cloth(x, y, z)));
  // rolled hem standing proud just under the nose, and a soft roll along the lower edge where it overlaps the chin cloth
  mh.region([-7, 44.8, -9], [7, 51.4, 8.5], (x, y, z) => {
    const rr = rhoOf(e, x, y, z), c = cOf(x, y, z);
    if (rr < 1 + MASK_T / havg(e, y) || rr > 1 + (MASK_T + 0.45) / havg(e, y)) return false;
    const t = maskTop(c), b = headBot(c);
    return (y <= t && y > t - 0.55) || (c > -0.6 && y >= b && y < b + 0.6);
  }, (x, y, z) => (y > 48 ? R.hi : R.shade));
  // raised folds where the cloth is pulled taut over the cheeks toward the knot
  for (const s of [1, -1])
    for (const [y0, y1] of [[49.6, 47.4], [50.1, 48.3]] as [number, number][]) {
      const pts: V3[] = [];
      for (let k = 0; k <= 12; k++) {
        const t = k / 12, th = s * lerp(0.95, 2.3, t), y = lerp(y0, y1, t);
        const c = -Math.cos(th);
        if (y > maskTop(c) - 0.3 || y < headBot(c) + 0.3) continue;
        pts.push(envPoint(e, th, y, MASK_T - 0.1).p);
      }
      if (pts.length > 1) mh.path(pts, (t) => 0.36 * Math.sin(Math.PI * clamp(t * 1.1, 0, 1)) + 0.12, R.shade);
    }
  // ---- chin cloth (on the jaw): outer layer below the head band, tucked one layer inside it above
  mj.region([-7.5, 43.4, -5], [7.5, 49.8, 8.5], (x, y, z) => {
    const c = cOf(x, y, z);
    if (c < -0.78 || y < jawBot(c) || y > jawTop(c)) return false;
    const rr = rhoOf(e, x, y, z), h = havg(e, y);
    return y > headBot(c) - 0.15 ? rr >= 1 - 0.75 / h && rr < 1 : rr >= 1 && rr <= 1 + MASK_T / h;
  }, cloth);
  // the drape hanging in front of the throat: a frayed triangle with soft folds
  const drapeZ = (x: number, v: number) => 7.15 - v * 0.75 - 0.05 * x * x + 0.32 * Math.sin(x * 1.9 + v * 2) * (0.3 + v);
  const drapeW = (v: number) => 4.9 * (1 - Math.pow(v, 1.3));
  const tipX = (v: number) => 0.35 * v;
  mj.region([-5.4, 40.4, 3.5], [5.4, 44.7, 8.6], (x, y, z) => {
    const v = (44.55 - y) / 3.75;
    if (v < 0 || v > 1) return false;
    const w = drapeW(v) * (1 + 0.06 * Math.sin(y * 7.3));
    if (Math.abs(x - tipX(v)) > w) return false;
    return Math.abs(z - drapeZ(x, v)) < 0.42;
  }, (x, y, z) => {
    const v = (44.55 - y) / 3.75, w = drapeW(v);
    if (w - Math.abs(x - tipX(v)) < 0.55) return print; // faded border
    if (Math.sin(x * 1.9 + v * 2) < -0.55 && v > 0.2) return R.shade; // fold valleys
    return printAt(x, y, z) ?? R.base;
  });
  // fraying: loose threads off the drape edges and the bottom of the chin cloth
  for (let k = 1; k <= 9; k++) {
    const v = k / 10;
    for (const s of [1, -1]) {
      if ((k + (s > 0 ? 0 : 1)) % 2) continue;
      const y = 44.55 - v * 3.75, x = tipX(v) + s * drapeW(v);
      const z = drapeZ(x, v);
      mj.cap([x, y, z], [x + s * 0.15, y - 0.6 - 0.35 * (k % 3), z - 0.1], 0.22, 0.16, k % 3 ? R.shade : dim);
    }
  }
  for (const s of [1, -1])
    for (const th of [1.45, 1.8, 2.15]) {
      const c = -Math.cos(th), y = jawBot(c) + 0.1;
      const { p } = envPoint(e, s * th, y, MASK_T * 0.5);
      mj.cap(p, [p[0], p[1] - 0.7, p[2]], 0.22, 0.16, R.shade);
    }
  // ---- the knot behind the skull, with two short tails (the long ends flutter as engine cloth from bandana_anchor)
  mh.ell([0.45, 50.05, -8.25], [1.25, 1.0, 0.95], R.shade);
  mh.ell([-0.65, 50.3, -8.0], [0.85, 0.78, 0.75], R.base);
  mh.ell([1.55, 50.3, -8.0], [0.85, 0.78, 0.75], R.base);
  mh.region([-0.2, 49.2, -9.4], [1.1, 51.0, -8.6], (x, y, z) => Math.abs(x - 0.45) < 0.22 && z < -8.9, R.dark, { mode: 'paint' });
  for (const [pts, w0] of [
    [[[0.1, 49.4, -8.6], [-0.55, 48.0, -9.0], [-0.75, 46.9, -9.1]], 0.78],
    [[[0.9, 49.4, -8.6], [1.65, 47.85, -9.05], [2.05, 46.5, -9.15]], 0.72],
  ] as [V3[], number][]) {
    mh.sweep(pts, (t) => [w0 - 0.3 * t, 0.42, 0.3], (x, y) => (y < pts[2][1] + 0.5 ? dim : R.base), 0.18);
    const end = pts[2];
    for (const dx of [-0.35, 0.3]) mh.cap([end[0] + dx, end[1], end[2]], [end[0] + dx * 1.3, end[1] - 0.55, end[2] - 0.05], 0.18, 0.14, R.shade);
  }
  shadeRamps(mh.m, [R], true);
  shadeRamps(mj.m, [R], true);
  return { head: mh.m, jaw: mj.m, R };
}

// ================================================================== THE CIGARETTE (hanging from the corner of his mouth)
/** where the cigarette sits in the left corner of the lips, and its glowing tip (design units, head family) */
const CIG_A: V3 = [1.55, 47.25, 5.15];
const CIG_B: V3 = [3.3, 46.15, 9.35];
/** a hand-rolled smoke drooping from the corner of his mouth: tan filter in the lips, white paper, a grey
 *  ash collar and a glowing ember tip (rides the jaw) */
function cigarette() {
  const m = sc('cig');
  const d = vnorm(vsub(CIG_B, CIG_A)), L = vlen(vsub(CIG_B, CIG_A));
  const tAt = (x: number, y: number, z: number) => vdot(vsub([x, y, z], CIG_A), d) / L;
  m.cap(CIG_A, CIG_B, 0.44, 0.42, (x, y, z) => {
    const t = tAt(x, y, z);
    if (t < 0.3) return (Math.floor((x + y * 2 + z) * S) & 3) === 0 ? 0xb98445 : 0xd9a35f; // the cork filter, flecked
    if (t > 0.93) return 0x8e8a84; // ash
    if (Math.abs(t - 0.31) < 0.025) return 0xc9a24a; // the gold band at the filter
    return y > CIG_A[1] + (CIG_B[1] - CIG_A[1]) * t ? 0xfbf8f0 : 0xe4ded2;
  });
  m.ell(vadd(CIG_B, vmul(d, 0.25)), [0.42, 0.42, 0.42], (x, y, z) => (tAt(x, y, z) > 1.06 ? 0xffd07a : 0xff6a1f), { flags: VF.GLOW });
  return m.m;
}

// ================================================================== SUNGLASSES (round punk shades over the sockets)
const FRAME = ramp(0x34363d, 0x1c1d22, 0x8c919c, 0x0c0c0e); // gunmetal
const LENS = { top: 0x0f1015, mid: 0x171a22, low: 0x252c3a, streak: 0xaebdd6, crack: 0xd6dde8 };
const LENS_C = (s: number): V3 => [(s * 10) / 3, 53.75, 7.35];
const LENS_R = 1.82;
/** the glow of his dead eye seen through the tint, per eye variant (2x2 voxel columns in front of the pupil);
 *  the living eye does not glow */
function lensGlow(m: Sc, s: number, v: EyeVar) {
  if (v === 'dead' || s > 0) return;
  const c = LENS_C(s);
  const ci = Math.round(c[0] * S), cj = Math.round(54 * S);
  for (let di = -2; di <= 1; di++)
    for (let dj = -2; dj <= 1; dj++) {
      const ox = di + 0.5, oy = dj + 0.5;
      const core = Math.abs(ox) < 1 && Math.abs(oy) < 1;
      if (!core && v !== 'wide') continue;
      if (Math.abs(ox) > 1 && Math.abs(oy) > 1) continue;
      if (v === 'shut' && (!core || oy > 0)) continue;
      let l = 30;
      while (l > 0 && !m.m.has(ci + di, cj + dj, l)) l--;
      if (l <= 0) continue;
      const col = v === 'intense' ? 0x7ee83c : v === 'dim' ? 0x2e5a1c : core ? 0x58b82c : 0x2f6a1c;
      m.m.set(ci + di, cj + dj, l, col, v === 'intense' || (v === 'wide' && core) ? VF.GLOW : VF.EMISSIVE);
    }
}
/** round shades: dark reflective lenses in thin gunmetal rims, a keyhole bridge, temples hooked round the skull; the right lens is cracked */
function sunglasses(vl: EyeVar, vr: EyeVar) {
  const g = sc('glasses');
  for (const s of [1, -1]) {
    const c = LENS_C(s);
    // slightly domed lens
    g.region([c[0] - 2.5, c[1] - 2.5, 6.35], [c[0] + 2.5, c[1] + 2.5, 8.15], (x, y, z) => {
      const r = Math.hypot(x - c[0], y - c[1]);
      if (r > LENS_R) return false;
      const zf = c[2] + 0.3 - 0.28 * (r / LENS_R) ** 2;
      return z <= zf && z >= zf - 0.78; // at least one full voxel layer everywhere (no hole in the middle)
    }, (x, y) => {
      const dx = x - c[0], dy = y - c[1];
      if (Math.abs(dx + dy * 0.9 + 0.9) < 0.22 || Math.abs(dx + dy * 0.9 + 0.2) < 0.13) return LENS.streak; // reflection streaks
      return dy > 0.9 ? LENS.top : dy < -0.9 ? LENS.low : LENS.mid;
    }, { flags: M });
    // thin metal rim
    g.region([c[0] - 2.8, c[1] - 2.8, 6.55], [c[0] + 2.8, c[1] + 2.8, 8.05], (x, y, z) => {
      const r = Math.hypot(x - c[0], y - c[1]);
      return r >= LENS_R - 0.1 && r <= LENS_R + 0.42 && z >= 6.85 && z <= 7.7;
    }, (x, y) => (y > c[1] + 1.2 ? FRAME.hi : FRAME.base), { flags: M });
    // hinge + temple arm running back along the skull, hooking down behind
    g.rbox([s * 5.5, 54.3, 7.0], [0.42, 0.42, 0.45], 0.15, FRAME.base, { flags: M });
    // the living side hooks over the ear; the dead side rests over the bare skull's ear hole
    const tx = s > 0 ? [6.95, 7.2, 7.0, 6.45] : [6.45, 6.6, 6.4, 6.0];
    g.path([[s * 5.7, 54.35, 6.75], [s * tx[0], 54.75, 4.0], [s * tx[1], 54.95, -0.8], [s * tx[2], 54.6, -2.9], [s * tx[3], 53.3, -3.9]], (t) => 0.3 - 0.05 * t, (x, y, z) => (z < -2.4 ? FRAME.dark : FRAME.base), { flags: M });
    // nose pad
    g.ell([s * 1.15, 52.75, 6.85], [0.3, 0.42, 0.25], 0x9aa2b0, { flags: M });
  }
  // keyhole bridge arching over the nose
  g.path([[-1.6, 54.25, 7.65], [-0.85, 54.95, 7.9], [0, 55.15, 7.95], [0.85, 54.95, 7.9], [1.6, 54.25, 7.65]], () => 0.27, FRAME.hi, { flags: M });
  // a crack across the right lens (+ a chipped rim edge)
  const cr = LENS_C(-1);
  const crack: V3[] = [[cr[0] - 1.75, cr[1] + 1.2, 7], [cr[0] - 0.9, cr[1] + 0.55, 7], [cr[0] - 0.45, cr[1] + 0.85, 7], [cr[0] + 0.35, cr[1] - 0.1, 7], [cr[0] + 0.25, cr[1] - 0.95, 7]];
  const branch: V3[] = [[cr[0] - 0.9, cr[1] + 0.55, 7], [cr[0] - 1.1, cr[1] - 0.4, 7]];
  g.region([cr[0] - 2.3, cr[1] - 2.3, 6.35], [cr[0] + 2.3, cr[1] + 2.3, 8.15], (x, y) => distPoly([x, y, 7], crack) < 0.22 || distPoly([x, y, 7], branch) < 0.16, LENS.crack, { mode: 'paint', flags: M });
  lensGlow(g, 1, vl);
  lensGlow(g, -1, vr);
  shadeRamps(g.m, [FRAME], false);
  return g.m;
}

// ================================================================== BANDAGE WRAP (left on his right forearm after using a bandage)
/**
 * Linen wound round Sundown's right forearm (between the elbow and the wrist cuff).
 * Mesh it with `pivot` and add it to the rig's `fore_r` node at the origin.
 */
export function forearmWrapModel(kind: 'trail' | 'embalm' = 'trail'): { model: VoxelModel; voxelSize: number; pivot: V3 } {
  return warped(WA_R, () => forearmWrap(kind));
}
function forearmWrap(kind: 'trail' | 'embalm'): { model: VoxelModel; voxelSize: number; pivot: V3 } {
  const m = sc('wrap_' + kind);
  const L = kind === 'embalm' ? ramp(0xdcc690, 0xbea66c, 0xf0dcaa, 0x8a7444) : ramp(0xeee4cc, 0xd2c4a2, 0xfff6e2, 0xa89a78);
  const cx = -8.5, cz = -0.1, y0 = 27.7, y1 = 31.6, R = 1.22, pitch = 0.82;
  m.region([cx - 2, y0 - 0.3, cz - 2], [cx + 2, y1 + 0.3, cz + 2], (x, y, z) => {
    const d = Math.hypot(x - cx, z - cz);
    if (d < R - 0.05 || d > R + 0.42 || y < y0 || y > y1) return false;
    return true;
  }, (x, y, z) => {
    const a = Math.atan2(z - cz, x - cx);
    const f = (((y - y0 - (a / (Math.PI * 2)) * pitch) / pitch) % 1 + 1) % 1; // position across the winding strip
    if (f < 0.16) return L.shade; // overlap edge of each turn
    if (kind === 'embalm' && Math.abs(f - 0.55) < 0.1) return TOON.gold.base;
    return L.base;
  });
  // the tucked-in end, slightly loose
  m.cap([cx - R - 0.2, y0 + 0.9, cz + 0.6], [cx - R - 0.45, y0 - 0.2, cz + 0.9], 0.36, 0.26, L.base);
  shadeRamps(m.m, [L], true);
  return { model: m.m, voxelSize: SUNDOWN_HD_VS, pivot: vx(WA_R.fwd(mg(J.elbow))) };
}

// ================================================================== RIG
const STRAP_OFF: Record<OutfitId, [Env, number]> = {
  punk: [PUNK_ENV, PUNK_T + 0.5],
  duster: [DUSTER_ENV, 1.7],
  sheriff: [DUSTER_ENV, 1.7],
  vest: [VEST_ENV, 1.5],
  poncho: [PONCHO_ENV, 1.4],
  bare: [FLESH_ENV, 0.55],
  pharaoh: [FLESH_ENV, 0.55],
};

/** Sundown, the player: HD build (1/54 m). Same part names, tree, joints and sockets as ever. */
export function skeletonCowboyRig(look: CowboyLook = { hat: 'stetson', outfit: 'punk' }): RigSpec {
  const o = look.outfit;
  const LK = LOOKS[o] ?? LOOKS.punk;
  // no loose hair under a headdress that is itself the hair (nemes, the frog wig)
  const hairy = look.hat !== 'nemes' && look.hat !== 'wig';
  WARP = null;
  const hd = buildHead(hairy);
  const punk = o === 'punk';
  const coatish = o === 'duster' || o === 'sheriff';

  // ---- torso: the half-dead body first, garments over it (trunk warp)
  WARP = W_BODY;
  const torso = sc('torso');
  torsoBody(torso);
  if (punk) punkTorso(torso);
  else if (coatish) dusterTorso(torso, LK.coat, LK.trim);
  else if (o === 'vest') vestTorso(torso, LK.coat, LK.trim, false);
  else if (o === 'poncho') ponchoTorso(torso, LK.coat);
  else if (o === 'pharaoh') pharaohTorso(torso);
  if (o === 'sheriff') {
    sheriffStar(torso, [5.4, 38.6, frontZ(DUSTER_ENV, 5.4, 38.6, 1.6)]);
    torso.path([[-1.0, 45.0, 1.6], [0, 41.0, 4.9], [0, 37.6, 5.3]], () => 0.2, TOON.black.base); // bolo string
    torso.ell([0, 41.6, 5.0], [0.6, 0.6, 0.35], TOON.silver.hi, { flags: M });
  }
  // the outlaw mask (default on every outfit) is the bandana pulled up over the face; without it he wears it round the neck
  // the outlaw mask is off unless the look asks for it: his face, the stubble and the cigarette show
  const masked = look.mask === true;
  const mask = masked ? warped(null, () => outlawMask(o)) : null;
  if (!masked && o !== 'sheriff' && o !== 'pharaoh') bandana(torso, LK.band);
  const [senv, soff] = STRAP_OFF[o] ?? STRAP_OFF.punk;
  sling(torso, senv, soff, punk);
  shadeRamps(torso.m, [BN, SKIN, LK.coat, LK.trim, LK.band, STRAP], true);

  // ---- pelvis
  const pelvis = sc('pelvis');
  const TR = TROUSERS[o];
  if (punk) punkPelvis(pelvis);
  else {
    bellyBody(pelvis);
    if (TR) {
      trouserSeat(pelvis, TR);
      trouserBelt(pelvis, LK.belt, TOON.brass);
    } else gunBelt(pelvis, LK.belt, o === 'pharaoh' ? TOON.gold : TOON.brass);
    shadeRamps(pelvis.m, [BN, SKIN, LK.belt, ...(TR ? [TR] : [])], true);
  }

  // ---- arms: the living left, the dead right (each through its own arm warp)
  WARP = WA_L;
  const armL = sc('arm_l'), foreL = sc('fore_l');
  WARP = WA_R;
  const armR = sc('arm_r'), foreR = sc('fore_r');
  if (punk) {
    warped(WA_L, () => (punkArmL(armL), punkForeL(foreL)));
    warped(WA_R, () => (punkArmR(armR), punkForeR(foreR)));
  } else {
    warped(WA_L, () => {
      livingUpperArm(armL, 1);
      livingForearm(foreL, 1);
      livingHand(foreL, 1);
      if (coatish) upperSleeve(armL, 1, LK.coat, LK.trim);
    });
    warped(WA_R, () => {
      deadUpperArm(armR, -1);
      deadForearm(foreR, -1);
      hand(foreR, -1, true);
      if (coatish) upperSleeve(armR, -1, LK.coat, LK.trim);
    });
    if (o === 'pharaoh')
      for (const [m, s, y, ax, r0, r1] of [[armL, 1, 37.8, 8.0, 1.62, 2.05], [armR, -1, 37.8, 8.0, 1.62, 2.05], [foreL, 1, 28.2, 8.5, 1.3, 1.7], [foreR, -1, 28.2, 8.5, 0.75, 1.35]] as [Sc, number, number, number, number, number][])
        m.region([s * ax - 2.2, y - 0.6, -2.2], [s * ax + 2.2, y + 0.6, 2.2], (x, yy, z) => {
          const d = Math.hypot(x - s * ax, z);
          return d < r1 && d > r0 - 0.4;
        }, (x, yy) => (yy > y ? TOON.gold.hi : TOON.gold.base), { flags: M });
    for (const m of [armL, armR, foreL, foreR]) shadeRamps(m.m, [BN, SKIN, ROT, LK.coat, LK.trim], true);
  }

  // ---- legs: trousers into boots (jeans for the punk), linen wraps and sandals for the pharaoh
  WARP = WL_L;
  const thighL = sc('thigh_l'), shinL = sc('shin_l');
  WARP = WL_R;
  const thighR = sc('thigh_r'), shinR = sc('shin_r');
  for (const [th, sh, s, w] of [[thighL, shinL, 1, WL_L], [thighR, shinR, -1, WL_R]] as [Sc, Sc, number, Warp][])
    warped(w, () => {
      if (punk) {
        punkThigh(th, s);
        punkShin(sh, s);
      } else if (o === 'pharaoh' || !TR) wrappedLeg(th, sh, s);
      else {
        trouserThigh(th, s, TR);
        trouserShin(sh, s, TR, LK.boot);
        shadeRamps(th.m, [TR], true);
        shadeRamps(sh.m, [TR, LK.boot], true);
      }
    });
  WARP = null; // everything below is the unwarped head family (or picks its warp explicitly)

  const hat = buildHat(look.hat, o);
  const topY = STETSONS.includes(look.hat) ? Math.max(hatTopOf(look.hat), modelTop(hat)) : hatTopOf(look.hat);
  const cig = mask ? null : cigarette();

  // ---- hair locks, glasses, and every cell two meshes would share (they would z-fight)
  const hair = hairy ? hairLocks() : null;
  const shades = look.shades !== false;
  const glassCache = new Map<string, VoxelModel>();
  const glassesOf = (l: EyeVar, r: EyeVar) => {
    let m = glassCache.get(l + r);
    if (!m) glassCache.set(l + r, (m = sunglasses(l, r)));
    return m;
  };
  const head = hd.head, jaw = hd.jaw;
  if (mask) {
    mask.jaw.forEach((x, y, z, c, f) => jaw.set(x, y, z, c, f)); // the chin cloth rides the jaw
    dedupe(head, mask.head);
    dedupe(jaw, mask.head);
  }
  dedupe(jaw, head);
  if (cig) (dedupe(cig, jaw), dedupe(cig, head));
  dedupe(hd.brow_l, head);
  dedupe(hd.brow_r, head);
  if (shades) {
    const g = glassesOf('normal', 'normal');
    dedupe(head, g);
    dedupe(hd.brow_l, g);
    dedupe(hd.brow_r, g);
  }
  for (const lk of hair?.locks ?? []) for (const other of [head, jaw, mask?.head, hd.brow_l]) dedupe(lk.model, other);
  dedupeLifted(torso.m, head);
  dedupeLifted(torso.m, jaw);
  dedupe(pelvis.m, torso.m);
  for (const [a, f] of [[armL, foreL], [armR, foreR]] as [Sc, Sc][]) {
    dedupe(a.m, torso.m);
    dedupe(a.m, f.m);
  }

  // ---- expressions: jaw / brow angles + modelled eye variants (the living eye's lids close over it)
  const expressions = defaultExpressions([...SUNDOWN_EXPRESSIONS]) as Record<string, { jaw?: number; brow?: [number, number]; parts?: Record<string, VoxelModel> }>;
  const eyeCache = new Map<string, VoxelModel>();
  let hm: VoxelModel | null = null;
  const headMirror = () => (hm ??= mirrorModel(head, 'head_m'));
  const eye = (side: 'l' | 'r', v: EyeVar) => {
    const k = side + v;
    let m = eyeCache.get(k);
    if (!m) eyeCache.set(k, (m = side === 'l' ? humanEye(v, head) : mirrorModel(humanEye(v, headMirror(), IRIS_R), 'eye_r')));
    return m;
  };
  for (const [name, [l, r]] of Object.entries(EYE_EXPR))
    if (expressions[name] && (l !== 'normal' || r !== 'normal')) expressions[name].parts = { eye_l: eye('l', l), eye_r: eye('r', r), ...(shades ? { glasses: glassesOf(l, r) } : {}) };

  const parts: PartSpec[] = [];
  /** the warp each part was sculpted through (absent: the unwarped head family) */
  const PW: Record<string, Warp> = { pelvis: W_BODY, torso: W_BODY, coat: W_BODY, arm_l: WA_L, fore_l: WA_L, arm_r: WA_R, fore_r: WA_R, thigh_l: WL_L, shin_l: WL_L, thigh_r: WL_R, shin_r: WL_R };
  /** a part-space point: through the part's warp, or as sculpted for the head family */
  const at = (part: string, p: V3): V3 => vx(PW[part] ? PW[part].fwd(p) : p);
  const P = (name: string, model: VoxelModel, joint: V3, parent?: string) => {
    if (model.count === 0) return;
    // the head family hangs off the torso lifted by HEAD_DY; inside it, nothing moves
    const attach = parent && !PW[name] && PW[parent] ? vx(toOut(null, joint)) : at(name, joint);
    parts.push({ name, model, pivot: at(name, joint), attach, parent });
  };
  P('pelvis', pelvis.m, J.pelvis);
  P('torso', torso.m, J.waist, 'pelvis');
  P('head', head, J.neck, 'torso');
  P('jaw', jaw, J.jaw, 'head');
  P('eye_l', eye('l', 'normal'), J.eye, 'head');
  P('eye_r', eye('r', 'normal'), mg(J.eye), 'head');
  P('brow_l', hd.brow_l, J.brow, 'head');
  P('brow_r', hd.brow_r, mg(J.brow), 'head');
  if (cig) P('cig', cig, J.jaw, 'jaw');
  P('hat', hat, J.hat, 'head');
  for (const lk of hair?.locks ?? []) P(lk.name, lk.model, lk.pivot, lk.parent);
  if (shades) P('glasses', glassesOf('normal', 'normal'), J.neck, 'head');
  if (mask) P('mask', mask.head, J.neck, 'head');
  P('arm_l', armL.m, J.shoulder, 'torso');
  P('fore_l', foreL.m, J.elbow, 'arm_l');
  P('arm_r', armR.m, mg(J.shoulder), 'torso');
  P('fore_r', foreR.m, mg(J.elbow), 'arm_r');
  P('thigh_l', thighL.m, J.hip, 'pelvis');
  P('shin_l', shinL.m, J.knee, 'thigh_l');
  P('thigh_r', thighR.m, mg(J.hip), 'pelvis');
  P('shin_r', shinR.m, mg(J.knee), 'thigh_r');
  let skirt: ReturnType<typeof dusterSkirt> | null = null;
  if (coatish) {
    skirt = warped(W_BODY, () => dusterSkirt(LK.coat, LK.trim));
    P('coat', skirt.m.m, [0, 29.5, -6.5], 'pelvis');
  }
  if (o === 'pharaoh') P('coat', warped(W_BODY, () => shendyt()).m, [0, 28.5, -5.5], 'pelvis');
  const hairChains = (hair?.chains ?? []).filter((c) => c.parts.every((n) => parts.some((p) => p.name === n)));

  const poncho = o === 'poncho';
  const sock = (part: string, p: V3, rot?: V3): SocketSpec => ({ part, at: at(part, p), rot });
  const backZu = punk ? backZ(PUNK_ENV, 0, 39, PUNK_T) : backZ(senv, 0, 39, soff - 0.5);
  const sockets: Record<string, SocketSpec> = {
    hand_r: sock('fore_r', mg(J.hand)),
    hand_l: sock('fore_l', J.hand),
    head_top: sock('head', [0, SKULL_TOP + 0.5, -1]),
    back: sock('torso', [0, 37, backZu - 0.3]),
    // Pinch perches on the left shoulder, on top of the torn sleeve stump
    shoulder_l: sock('torso', [8, 45.0, -0.4]),
    shoulder_r: sock('torso', [-8, 45.6, -0.4]),
    hip_r: sock('pelvis', [-7.8, 25, 0.5]),
    chest: sock('torso', [0, 38, 5.4]),
    eye_l: sock('head', J.eye),
    eye_r: sock('head', mg(J.eye)),
    mouth: sock('jaw', [0, 47.5, 6]),
    ...(cig ? { cig_tip: sock('cig', vadd(CIG_B, vmul(vnorm(vsub(CIG_B, CIG_A)), 0.55))), mouth_corner: sock('jaw', [1.9, 47.2, 6.0]) } : {}),
    hat_top: sock('hat', [0, topY, -1]),
    // Pinch's perches (empty anchors on the head bone, +Z out of the face): on the hat crown, in either eye socket
    perch_hat: sock('head', [0, crownTop(hat, topY) + 0.15, -1.2]),
    perch_eyeL: sock('head', [J.eye[0], J.eye[1], J.eye[2] - 0.6]),
    // on the zombie side Pinch peeks out of the cheek gap
    perch_eyeR: sock('head', [-5.45, 47.8, 2.85]),
    // the cloth tails flutter from the mask knot (or from the back of the neck bandana)
    bandana_anchor: mask ? sock('mask', [0.45, 48.9, -8.75]) : sock('torso', [0, 45.2, -5.6]),
    // the sandboard rides between the shoulder blades, held by the sling (see attachBoardOnBack)
    board_back: sock('torso', [0, 39, backZu - 1.0]),
    ...(poncho
      ? {
          coat_anchor_l: sock('torso', [11.4, 33, 0]),
          coat_anchor_r: sock('torso', [-11.4, 33, 0]),
          coat_anchor_back: sock('torso', [0, 33, -8.4]),
          coat_anchor_front: sock('torso', [0, 33, 6.4]),
        }
      : skirt
        ? {
            coat_anchor_l: sock('coat', [skirt.hxB + 0.4, 19.4, skirt.zc]),
            coat_anchor_r: sock('coat', [-skirt.hxB - 0.4, 19.4, skirt.zc]),
            coat_anchor_back: sock('coat', [0, 19.4, skirt.zc - skirt.hzB - 0.6]),
            coat_anchor_front: sock('pelvis', [0, 22, 3]),
          }
        : {
            coat_anchor_l: sock('pelvis', [10, 19.5, -2]),
            coat_anchor_r: sock('pelvis', [-10, 19.5, -2]),
            coat_anchor_back: sock('pelvis', [0, 19.5, -9]),
            coat_anchor_front: sock('pelvis', [0, 22, 3]),
          }),
  };
  /** design point -> rig-space metres (through the trunk warp, or lifted for the head family) */
  const mm = (p: V3, w: Warp | null = null) => toOut(w, p).map((v) => v * UH);
  const clothCoat = coatish || poncho;
  return {
    name: `cowboy_${look.hat}_${look.outfit}${mask ? '' : '_nomask'}${shades ? '' : '_noshades'}`,
    voxelSize: SUNDOWN_HD_VS,
    parts,
    sockets,
    meta: {
      look,
      hd: true,
      // stylized cartoon rig: PlayerAnim layers squash and stretch, overshoot, a broader stance and the bounce on it
      toon: 1,
      // third-person camera fitted to the short body (CameraRig.fitHero)
      cam: { height: 1.16, shoulder: 1.0, dist: 2.62 },
      // the extra half-stance a toon rider takes on the deck (PlayerAnim, times its leg scale)
      stanceWide: 0.025,
      // where the free hand takes the hat brim (head-local metres): the front of the brim, a touch to his left
      hatGrip: mm([2.2, 59.6, 10.4]).map((v, i) => v - mm(J.neck)[i]),
      // the cigarette (CigSmoke curls its smoke from the cig_tip socket)
      smoke: cig ? { tip: 'cig_tip', mouth: 'mouth_corner' } : undefined,
      height: (topY + HEAD_DY) * UH,
      skullTop: (SKULL_TOP + 0.5 + HEAD_DY) * UH,
      hatTop: (topY + HEAD_DY) * UH,
      chinY: (44.4 + HEAD_DY) * UH,
      radius: 0.32,
      hipY: W_BODY.Y(J.hip[1]) * UH,
      kneeY: W_BODY.Y(J.knee[1]) * UH,
      shoulderY: W_BODY.Y(J.shoulder[1]) * UH,
      elbowY: WA_L.Y(J.elbow[1]) * UH,
      handY: WA_L.Y(J.hand[1]) * UH,
      upperArmLen: (WA_L.Y(J.shoulder[1]) - WA_L.Y(J.elbow[1])) * UH,
      foreArmLen: (WA_L.Y(J.elbow[1]) - WA_L.Y(J.hand[1])) * UH,
      legLen: W_BODY.Y(J.hip[1]) * UH,
      facePivots: { eye_l: mm(J.eye), eye_r: mm(mg(J.eye)), brow_l: mm(J.brow), brow_r: mm(mg(J.brow)), jaw: mm(J.jaw) },
      // modelled eyeballs with glowing Serket-green pupils (no 2D overlay)
      eyeColor: EYE.core,
      eyes: 'voxel',
      expressions,
      // rigged hair locks that sway on their own once installHairSway(rig) runs (attachBoardOnBack does it)
      hair: hairChains.length ? { chains: hairChains } : undefined,
      cloth: {
        coat: clothCoat ? [LK.coat.base, LK.coat.shade, LK.trim.base] : undefined,
        coatStyle: poncho ? 'poncho' : clothCoat ? 'tails' : undefined,
        coatLen: o === 'sheriff' ? 0.7 : o === 'duster' ? 0.62 : poncho ? 0.36 : 0,
        coatWidth: poncho ? 0.6 : 0.5,
        bandana: mask ? [mask.R.base, mask.R.shade] : o !== 'sheriff' && o !== 'pharaoh' ? [LK.band.base, LK.band.shade] : undefined,
        bandanaLen: mask ? 0.2 : 0.16,
      },
    },
  };
}

/** top of the hat's crown over the head's midline (design units); `fallback` when the hat has no cell there */
/** the highest cell of a head-family model (design units) */
function modelTop(m: VoxelModel) {
  let top = -1e9;
  m.forEach((x, y) => (top = Math.max(top, (y + 1) / S)));
  return top;
}
function crownTop(hat: VoxelModel, fallback: number) {
  let top = -1e9;
  hat.forEach((x, y, z) => {
    if (Math.abs((x + 0.5) / S) < 0.8 && Math.abs((z + 0.5) / S + 1.2) < 0.8) top = Math.max(top, (y + 1) / S);
  });
  return top > -1e9 ? top : fallback;
}

// ================================================================== PINCH'S PERCHES
/** names of the empty perch anchors on Sundown's head bone (sockets of the same name in the spec) */
export const PERCH_NAMES = { hat: 'perch_hat', eyeL: 'perch_eyeL', eyeR: 'perch_eyeR' } as const;
/**
 * Pinch's perch anchors on a Sundown rig: `perch_hat` (on the hat crown), `perch_eyeL` / `perch_eyeR`
 * (in the left / right eye socket; character left = +X). All three are empty Object3Ds parented to the
 * `head` bone, +Z pointing out of the face. Pass the RigInstance root (or anything above it). Finds the
 * anchors by name; on a fresh RigInstance it names them, adding an empty Object3D called exactly
 * `perch_hat` / `perch_eyeL` / `perch_eyeR` at the rig socket of that name (idempotent).
 * Missing keys mean the rig has no such perch (another hero).
 */
export function getPerchAnchors(root: THREE.Object3D): { hat?: THREE.Object3D; eyeL?: THREE.Object3D; eyeR?: THREE.Object3D } {
  const out: { hat?: THREE.Object3D; eyeL?: THREE.Object3D; eyeR?: THREE.Object3D } = {};
  for (const [k, name] of Object.entries(PERCH_NAMES) as [keyof typeof PERCH_NAMES, string][]) {
    let a = root.getObjectByName(name);
    if (!a) {
      const sock = root.getObjectByName('socket:' + name);
      if (sock?.parent) {
        a = new THREE.Object3D();
        a.name = name;
        a.position.copy(sock.position);
        a.quaternion.copy(sock.quaternion);
        sock.parent.add(a);
      }
    }
    if (a) out[k] = a;
  }
  return out;
}

// ================================================================== BOARD ON THE BACK
export const BOARD_BACK_SOCKET = 'board_back';
export interface BoardBackOpts {
  /** material for a {model, voxelSize} or BufferGeometry board (default: the rig's material) */
  material?: THREE.Material;
  /** sideways tilt across the back in radians (default 0.6: nose up over his right shoulder, clear of his hat, Pinch and his hair) */
  tilt?: number;
  /** how far the board centre hangs below the socket, metres (default 0.17) */
  drop?: number;
}
/**
 * Mount a sandboard on Sundown's back, slung between the shoulder blades on the
 * `board_back` socket: deck art facing out, nose up over his right shoulder.
 * Also installs his hair sway (installHairSway, idempotent) on the rig.
 * `board` may be a sandboardModel() result ({ model, voxelSize }), a BufferGeometry
 * (e.g. player.boardMesh.geometry) or any Object3D (used as-is, not cloned).
 * Returns the holder group (toggle `.visible`, or `.removeFromParent()`), or null when
 * the rig has no `board_back` socket.
 */
export function attachBoardOnBack(rig: RigInstance, board: { model: VoxelModel; voxelSize: number } | THREE.BufferGeometry | THREE.Object3D, opts: BoardBackOpts = {}): THREE.Group | null {
  const sockG = rig.sockets[BOARD_BACK_SOCKET];
  if (!sockG) return null;
  installHairSway(rig); // a hero dressed for show: let his hair move
  const mat = opts.material ?? (rig.material as unknown as THREE.Material);
  let obj: THREE.Object3D;
  if (board instanceof THREE.Object3D) obj = board;
  else if (board instanceof THREE.BufferGeometry) {
    const mesh = new THREE.Mesh(board, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    obj = mesh;
  } else obj = voxelMesh(board.model, board.voxelSize, 'center', mat);
  // measure the board in its own frame
  obj.removeFromParent();
  obj.position.set(0, 0, 0);
  obj.rotation.set(0, 0, 0);
  obj.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(obj);
  const holder = new THREE.Group();
  holder.name = 'board_back';
  holder.rotation.z = opts.tilt ?? 0.6;
  const inner = new THREE.Group();
  inner.rotation.x = -Math.PI / 2; // board +Z (nose) -> up, deck +Y -> away from his back
  holder.add(inner);
  // base flat against the sling, centre hanging `drop` below the socket
  obj.position.set(-(box.min.x + box.max.x) / 2, -box.min.y + 0.004, -(box.min.z + box.max.z) / 2 - (opts.drop ?? 0.17));
  inner.add(obj);
  sockG.add(holder);
  return holder;
}
