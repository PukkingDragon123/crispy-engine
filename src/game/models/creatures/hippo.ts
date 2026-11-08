// The sand hippo, "dune behemoth": a real hippopotamus pushed into a desert
// monster (about 4 m long, 1.7 m at the plated shoulder) and its round calf.
//
// Anatomy first: a deep sagging barrel on short pillar legs, a massive head
// with the eyes, ears and nostrils raised on top (so it can lie buried in a dune
// with only those showing), a vast gape with curved lower tusks. The monster
// layer on top of it:
//  - armoured hide: rhino-like skin folds at the neck, behind the shoulders and
//    in front of the hips (each joint of the rig hides in a fold), rows of
//    keeled, sun-bleached osteoderm plates down the spine (spiked over the
//    shoulder hump and the loins), shingled shields over shoulders and haunches,
//    keratin scutes down the fronts of the forearms;
//  - a horned brow shield over each periscope eye, a rugged nasal boss, a
//    keratin "spade" under the chin for digging in;
//  - sand-polished tusks with growth rings (the left one snapped off), wind-
//    scoured chalky patches on the back, claw-rake scars, a notched ear;
//  - desert adaptations: valve flaps that seal the nostrils against blowing sand,
//    heat-venting cheek frills (bony rays and a vascular membrane) that flare in
//    display, the hippo's own red "blood sweat" sunscreen streaking from the eyes.
//
// The mouth is two sculpts that meet at the lips: heavy rounded upper flews hang over a
// broad U-shaped lower jaw; open, they show a vaulted ridged palate, gums, molars and the
// tongue lying in its bowl.
//
// RIG (faces +Z, LEFT = +X, origin on the ground under the belly):
//   body (root, mid barrel) → chest → neck → head → jaw → tongue
//                                             head → eye_l/eye_r, lid_l/lid_r, ear_l/ear_r,
//                                                    nose_l/nose_r (nostril valves), frill_l/frill_r
//   chest → leg_fl → shin_fl → foot_fl → toes_fl (and fr)
//   body → rump → leg_bl → shin_bl → foot_bl → toes_bl (and br); rump → tail1 → tail2 → tail3
// Adult 1/32 m. The calf: the same design re-proportioned (big head and eyes, short
// chubby body, soft plate buds, tusk buds, little pink frills) at 1/55 m.
// `HippoAnim` drives every pose: walk / trot / gallop with a 4-segment leg cycle
// (planted pads, flexing wrists, curling toes), spine sway and flex, breathing,
// weight shifts, idle head shakes / sniffs / foot shifts / frill flares, wallowing
// and burrowing (nostrils seal), the yawn display (frills fan, tongue lifts), the
// bite, rage, a lagging tail chain, the squash spring and the calf's carried /
// thrown / dizzy poses.
import * as THREE from 'three';
import type { RigInstance } from '../../../engine/voxel/Rig';
import { CRig, VoxelModel, VF, V3, RigSpec, Prim, ell, cap, tube, line, paint, exposed, mixc, n01, h01, wetEye, add3, sub3, scl3, dot3, norm3, cross3, sstep, invXYZ, memoBy, clamp01 } from './ckit';
import { fblob, plate, castIn, normalAt, splitMany, groove, tri, surfaceCells, cullBuried, type Pal, type PlateOpt } from './mkit';

// ============================================================================ palette
const HIDE = {
  base: 0x977061,
  light: 0xb38f7a,
  dark: 0x6c4e42,
  belly: 0xc9978a,
  pink: 0xd39686,
  scour: 0xbea488,
  scratch: 0xb2906e,
  dust: 0xd5ba8c,
  crease: 0x3e2820,
  lipFold: 0xa98670,
  sweat: 0xb4553a,
  scar: 0xe4b8a4,
  lip: 0x683e34,
  gum: 0xc06a66,
  tongue: 0xd8877c,
  tongueD: 0xa85a58,
  palate: 0xae5a58,
  ridge: 0x8c4446,
  ivory: 0xefe2c2,
  ivoryBase: 0xc4a980,
  ivoryTip: 0xfbf4e2,
  ivoryCrack: 0x8e7656,
  molar: 0xe2d4b2,
  nail: 0x4a3c34,
  nailHi: 0x7a6656,
  pad: 0x56402f,
  bristle: 0xe6d8c2,
  bristleD: 0x584034,
};
/** plates: highlight (keel crest) / light (faces) / shade (bevelled edge) / dark (sides) */
const PL_ADULT: Pal = { top: 0xefe3c6, mid: 0xcfb790, base: 0x6e5946, rim: 0xa58a69, ring: 0xb39a76, crack: 0x4a3628, sand: 0x6e5946 };
const PL_CALF: Pal = { top: 0xf2dcc8, mid: 0xe0bea6, base: 0xa47864, rim: 0xc4987f, ring: 0xd2ae96, crack: 0xa07262, sand: 0xa47864 };
const FRILL = { mem: 0xa23a2a, memD: 0x6e2420, vein: 0x4a1614, memHi: 0xcc643c, ray: 0xe6d6b4, rayD: 0xa88c6a };
const FRILL_CALF = { mem: 0xe0907c, memD: 0xc87064, vein: 0xb05a54, memHi: 0xf2b494, ray: 0xf4e4cc, rayD: 0xd8bea4 };

// ============================================================================ design (adult metres)
type Look = { baby: boolean; dv: number; s: number; bw: number; bl: number; drop: number; hk: number; lift: number; eyeK: number; lr: number };
const ADULT: Look = { baby: false, dv: 1 / 32, s: 1, bw: 1, bl: 1, drop: 0, hk: 1, lift: 0, eyeK: 1, lr: 1 };
const BABY: Look = { baby: true, dv: 1 / 20, s: 0.36, bw: 1.1, bl: 0.9, drop: 0.03, hk: 1.1, lift: 0.25, eyeK: 1.5, lr: 1.12 };

const J = {
  bodyC: [0, 0.98, -0.12] as V3,
  chestJ: [0, 1.04, 0.3] as V3,
  rumpJ: [0, 1.04, -0.6] as V3,
  neckJ: [0, 1.1, 1.02] as V3,
  /** head-space origin (the calf's head is scaled about it) */
  neck: [0, 1.12, 1.22] as V3,
  headJ: [0, 1.12, 1.29] as V3,
  hinge: [0, 1.0, 1.42] as V3,
  turret: [0.3, 1.46, 1.6] as V3,
  ear: [0.235, 1.56, 1.37] as V3,
  frill: [0.53, 1.15, 1.4] as V3,
  shoulder: [0.5, 0.92, 0.72] as V3,
  elbow: [0.53, 0.52, 0.78] as V3,
  fWrist: [0.54, 0.22, 0.84] as V3,
  fToe: [0.54, 0.075, 0.97] as V3,
  hip: [0.48, 0.95, -0.98] as V3,
  knee: [0.52, 0.55, -0.87] as V3,
  bHock: [0.53, 0.22, -1.0] as V3,
  bToe: [0.53, 0.075, -0.87] as V3,
  tail0: [0, 1.26, -1.42] as V3,
  tail1: [0, 1.12, -1.57] as V3,
  tail2: [0, 0.98, -1.66] as V3,
  tail3: [0, 0.85, -1.71] as V3,
  tailTip: [0, 0.71, -1.73] as V3,
};
const EYE_R = 0.08;
/** flat colour of hidden interior cells */
const INNER = 0x6a4434;
const mir = (v: V3): V3 => [-v[0], v[1], v[2]];
const mouthY = (q: V3) => 0.99 + 0.06 * sstep(1.72, 1.45, q[2]);
// the rig's cuts run along the skin folds (adult body space, metres)
const cutNeck = (_x: number, y: number) => 1.02 + (1.2 - y) * 0.12;
const cutChest = (_x: number, y: number) => 0.3 - (y - 1.0) * 0.2;
const cutRump = (_x: number, y: number) => -0.6 + (y - 1.0) * 0.17;
/** nostril slits (left), head space */
const NOS_A: V3 = [0.105, 1.35, 2.245], NOS_B: V3 = [0.18, 1.34, 2.31];

function buildHippo(L: Look): RigSpec {
  const dv = L.dv;
  const baby = L.baby;
  const U = (m: number) => m / dv;
  const V = (p: V3): V3 => [p[0] / dv, p[1] / dv, p[2] / dv];
  const Mv = (x: number, y: number, z: number): V3 => [(x + 0.5) * dv, (y + 0.5) * dv, (z + 0.5) * dv];
  const Mc = (x: number, y: number, z: number): V3 => [x * dv, y * dv, z * dv];
  // ---- design transforms (identity for the adult; the calf is re-proportioned)
  const legK = 1 - L.drop / 0.95;
  const B = (p: V3): V3 => [p[0] * L.bw, p[1] - L.drop, p[2] * L.bl];
  const NB = B(J.neck);
  const H = (p: V3): V3 => [NB[0] + (p[0] - J.neck[0]) * L.hk, NB[1] + L.lift + (p[1] - J.neck[1]) * L.hk, NB[2] + (p[2] - J.neck[2]) * L.hk];
  const G = (p: V3): V3 => [p[0] * L.bw, p[1] * legK, p[2] * L.bl];
  const invB = (p: V3): V3 => [p[0] / L.bw, p[1] + L.drop, p[2] / L.bl];
  const invH = (p: V3): V3 => [J.neck[0] + (p[0] - NB[0]) / L.hk, J.neck[1] + (p[1] - NB[1] - L.lift) / L.hk, J.neck[2] + (p[2] - NB[2]) / L.hk];
  const invG = (p: V3): V3 => [p[0] / L.bw, p[1] / legK, p[2] / L.bl];
  const EB = (c: V3, r: V3): Prim => ({ c: V(B(c)), r: [U(r[0] * L.bw), U(r[1]), U(r[2] * L.bl)] });
  const CB = (a: V3, b: V3, r0: number, r1: number): Prim => ({ a: V(B(a)), b: V(B(b)), r0: U(r0 * L.bw), r1: U(r1 * L.bw) });
  const EH = (c: V3, r: V3): Prim => ({ c: V(H(c)), r: [U(r[0] * L.hk), U(r[1] * L.hk), U(r[2] * L.hk)] });
  const CH = (a: V3, b: V3, r0: number, r1: number): Prim => ({ a: V(H(a)), b: V(H(b)), r0: U(r0 * L.hk), r1: U(r1 * L.hk) });
  const both = (f: (s: number) => void) => [1, -1].forEach(f);
  const sx = (v: V3, s: number): V3 => (s > 0 ? v : mir(v));
  const PAL = baby ? PL_CALF : PL_ADULT;
  /** plate size (adult metres) -> voxels in body / head space */
  const pb = (m: number) => U(m * L.bw * (baby ? 0.75 : 1));
  const ph = (m: number) => U(m * L.hk * (baby ? 0.75 : 1));

  const rig = new CRig(baby ? 'baby_hippo' : 'sand_hippo', dv * L.s);
  const babyPink = (c: number) => (baby ? mixc(c, HIDE.pink, 0.32) : c);

  // ---------------------------------------------------------------- hide
  /** old wounds: a three-claw rake down the right flank, a slash on the left haunch, a bite on the left shoulder */
  const SCARS: [V3, V3][] = baby ? [] : [
    [[-0.74, 1.24, 0.1], [-0.72, 0.9, 0.36]],
    [[-0.77, 1.2, -0.0], [-0.75, 0.86, 0.26]],
    [[-0.78, 1.14, -0.1], [-0.76, 0.84, 0.14]],
    [[0.72, 1.28, -0.86], [0.78, 1.0, -0.6]],
    [[0.42, 1.52, -0.34], [0.58, 1.36, -0.04]],
  ];
  const segD = (p: V3, a: V3, b: V3) => {
    const ab = sub3(b, a);
    const t = Math.max(0, Math.min(1, dot3(sub3(p, a), ab) / dot3(ab, ab)));
    const ex = p[0] - a[0] - ab[0] * t, ey = p[1] - a[1] - ab[1] * t, ez = p[2] - a[2] - ab[2] * t;
    return Math.sqrt(ex * ex + ey * ey + ez * ez);
  };
  /** the hide at an adult-space point q (vy: -1 belly .. +1 spine) */
  const skin = (q: V3, vy: number) => {
    let c = HIDE.base;
    const m = n01(q[0], q[1], q[2], 1.4, 3);
    if (m > 0.64) c = mixc(c, HIDE.dark, 0.2 * sstep(0.64, 0.78, m));
    else if (m < 0.36) c = mixc(c, HIDE.light, 0.22 * sstep(0.36, 0.22, m));
    if (vy > 0.45) c = mixc(c, HIDE.light, sstep(0.45, 0.95, vy) * 0.42); // sun-bleached back
    if (vy < -0.38) c = mixc(c, HIDE.belly, sstep(-0.38, -0.78, vy) * 0.7); // soft pink belly
    // blood sweat: the red-orange film runs down the neck and shoulders in long streaks
    if (q[2] > 0.35 && q[1] > 0.75 && vy > -0.35 && vy < 0.7) {
      const a = Math.atan2(q[0], q[1] - 0.95);
      const st = a * 5.5 + n01(q[0], q[1] * 0.3, q[2], 3, 8) * 1.2;
      const f = sstep(0.35, 0.75, q[2]) * sstep(-0.35, 0.1, vy) * (1 - sstep(0.4, 0.7, vy));
      if (st - Math.floor(st) < 0.16 && n01(q[0], q[1], q[2], 2.2, 9) > 0.48) c = mixc(c, HIDE.sweat, 0.45 * f);
    }
    // wind-scoured patches on the back: pale and chalky, scratched along the wind by blown sand
    if (!baby && vy > 0.3) {
      const pm = n01(q[0] * 1.3, q[1] * 1.7, q[2], 1.6, 17);
      if (pm > 0.64) {
        const f = sstep(0.64, 0.7, pm) * sstep(0.3, 0.5, vy);
        c = mixc(c, HIDE.scour, 0.32 * f);
      }
    }
    if (q[1] > 0.75) for (const [a, b] of SCARS) {
      const d = segD(q, a, b);
      if (d < 0.02) c = HIDE.scar;
      else if (d < 0.042) c = mixc(c, HIDE.dark, 0.3);
    }
    if (!baby) {
      // the healed bite on the left shoulder: a crescent of pale pocks
      const bq = sub3(q, [0.66, 1.08, 0.58]);
      const br = Math.hypot(bq[1], bq[2]);
      if (q[0] > 0.4 && Math.abs(br - 0.16) < 0.02 && Math.atan2(bq[1], bq[2]) > -1.2) c = mixc(c, HIDE.scar, 0.7);
    }
    if (q[1] < 0.5) c = mixc(c, HIDE.dust, sstep(0.5, 0.18, q[1]) * 0.55); // caked sand
    return babyPink(c);
  };
  const bodyCol = (i: number, j: number, k: number) => {
    const q = invB(Mv(i, j, k));
    return skin(q, (q[1] - 0.98) / 0.6);
  };
  const lumps = (amp: number, per: number, seed: number) => (x: number, y: number, z: number) => (n01(x, y, z, dv / per, seed) - 0.5) * amp;

  // ================================================================ torso: chest hump, sagging barrel, rump, neck
  const torso = new VoxelModel('torso');
  const bodyPrims: Prim[] = [
    EB([0, 0.99, -0.12], [0.78, 0.56, 1.32]), // barrel
    EB([0, 1.06, 0.6], [0.76, 0.57, 0.66]), // chest / shoulders
    EB([0, 1.02, -0.92], [0.76, 0.56, 0.62]), // rump
    EB([0, 0.75, -0.05], [0.66, 0.36, 1.05]), // sagging belly
    CB([0, 1.02, 0.9], [0, 1.1, 1.34], 0.53, 0.47), // thick neck
    EB([0, 0.84, 1.08], [0.42, 0.26, 0.3]), // heavy throat
    EB([0.5, 0.86, 0.72], [0.28, 0.42, 0.34]), // shoulder bulges
    EB([-0.5, 0.86, 0.72], [0.28, 0.42, 0.34]),
    EB([0.48, 0.88, -0.96], [0.3, 0.44, 0.42]), // haunches
    EB([-0.48, 0.88, -0.96], [0.3, 0.44, 0.42]),
    EB([0, 1.5, -0.25], [0.42, 0.12, 0.6]), // a low ridge along the spine
    EB([0, 1.4, 0.48], [0.46, 0.2, 0.42]), // the muscled shoulder hump
  ];
  fblob(torso, bodyPrims, bodyCol, { k: U(0.16), disp: lumps(0.3, 0.5, 11), keep: (_x, y) => y >= 0, inner: INNER });
  const surf = surfaceCells(torso);
  // ---- skin folds: three rings round the neck, one behind the shoulders, one before the hips. They wrap
  // the flanks only, so the spine and belly read as one unbroken line; the rig's cuts hide in them.
  {
    const dz = (f: (x: number, y: number) => number) => (x: number, y: number, z: number) => {
      const q = invB(Mc(x, y, z));
      return ((q[2] - f(q[0], q[1])) * L.bl) / dv;
    };
    const shade = baby
      ? { floor: (c: number) => mixc(c, HIDE.crease, 0.25), front: (c: number) => mixc(c, HIDE.lipFold, 0.15) }
      : { floor: (c: number) => mixc(c, HIDE.crease, 0.55), behind: (c: number) => mixc(c, HIDE.crease, 0.1), front: (c: number) => mixc(c, HIDE.lipFold, 0.22), lip: 1.6, lipCol: (c: number) => mixc(c, HIDE.lipFold, 0.3) };
    const wob = (x: number, y: number) => (Math.sin(y * 13 + x * 3) * 0.6 + Math.sin(y * 29 - x * 7) * 0.4) * 0.012;
    const flank = (lo: number, hi: number) => (x: number, y: number, z: number) => {
      const q = invB(Mc(x, y, z));
      return q[1] > lo && q[1] < hi;
    };
    for (let r = 0; r < (baby ? 1 : 3); r++) groove(torso, dz((x, y) => cutNeck(x, y) + r * 0.125 + (r ? Math.sin(x * 5 + r) * 0.015 : 0)), { depth: 1, rim: 1.4, ...shade, region: (x, y, z) => invB(Mc(x, y, z))[2] > 0.8 && flank(0.5, 1.4)(x, y, z), cand: surf });
    groove(torso, dz((x, y) => cutChest(x, y) + wob(x, y)), { depth: 1, rim: 1.4, ...shade, cand: surf, region: flank(0.52, 1.4) });
    groove(torso, dz((x, y) => cutRump(x, y) - wob(x, y + 1)), { depth: 1, rim: 1.4, ...shade, cand: surf, region: flank(0.52, 1.4) });
    // finer echo creases either side of the big folds (layered, bunched hide)
    if (!baby)
      for (const [f, o] of [[cutChest, -0.075], [cutRump, 0.075]] as [(x: number, y: number) => number, number][])
        groove(torso, dz((x, y) => f(x, y) + o + Math.sin(y * 9 + x * 3) * 0.012), { depth: 1, width: 0.45, rim: 0.9, floor: (c) => mixc(c, HIDE.crease, 0.4), region: flank(0.6, 1.3), cand: surf });
  }
  // ---- split along the folds: body (mid barrel), chest (+ front legs), neck, rump (+ hind legs, tail)
  const body = rig.part('body', undefined, V(B(J.bodyC)));
  const chest = rig.part('chest', 'body', V(B(J.chestJ)));
  const neck = rig.part('neck', 'chest', V(B(J.neckJ)));
  const rump = rig.part('rump', 'body', V(B(J.rumpJ)));
  const torsoParts: Record<string, VoxelModel> = { body, chest, neck, rump };
  const regionOf = (x: number, y: number, z: number) => {
    const q = invB(Mv(x, y, z));
    if (q[2] > cutNeck(q[0], q[1])) return q[2] < J.headJ[2] + 0.13 ? 'neck' : 'drop';
    if (q[2] > cutChest(q[0], q[1])) return 'chest';
    if (q[2] < cutRump(q[0], q[1])) return 'rump';
    return 'body';
  };
  {
    const near = (f: (x: number, y: number) => number, sgn: number) => (x: number, y: number, z: number) => {
      const q = invB(Mv(x, y, z));
      const d = (f(q[0], q[1]) - q[2]) * sgn;
      return d >= 0 && d < 3 * dv;
    };
    // the plugs reach one cell under the skin: when a joint bends, the hide closes over the gap instead of a hole
    splitMany(torso, torsoParts, regionOf, [
      { from: 'body', to: 'chest', near: near(cutChest, 1), inner: 1 },
      { from: 'chest', to: 'neck', near: near(cutNeck, 1), inner: 1 },
      { from: 'body', to: 'rump', near: near(cutRump, -1), inner: 1 },
    ]);
  }
  // ---- osteoderm plates, grown after the split: each plate belongs wholly to the part under its centre and
  // laps over the neighbouring part, so the armour runs as one line across the folds (and hides the cuts)
  {
    const top = Math.ceil(U(2.4));
    const bell = (z: number) => Math.max(Math.exp(-(((z + 0.15) / 0.55) ** 2)), 0.85 * Math.exp(-(((z - 0.55) / 0.3) ** 2)));
    let seed = 1;
    const grow = (hit: V3, fwd: V3, o: PlateOpt) => {
      const S: V3 = [hit[0] + 0.5, hit[1] + 0.5, hit[2] + 0.5];
      plate(torsoParts[regionOf(hit[0], hit[1], hit[2])] ?? body, S, normalAt(torso, hit, 3), fwd, o, PAL);
    };
    const dorsal = (x: number, z: number, a: number, b: number, h: number, keel: number, spike = 0) => {
      const from = V(B([x, 0, z]));
      from[1] = top;
      const hit = castIn(torso, [from[0] + 0.5, from[1], from[2] + 0.5], [0, -1, 0]);
      if (hit) grow(hit, [0, 0, 1], { a: pb(a), b: pb(b), h: pb(h) * (baby ? 0.45 : 1), keel, tilt: baby ? 0.1 : 0.32, sink: 2.5, seed: seed++, sq: 2.5, spike: baby ? 0 : pb(spike), spikeLean: 0.85, clean: true });
    };
    // the spine: a single file of big keeled plates, spiked over the hump and the loins
    for (let z = 1.12; z > -1.4; z -= baby ? 0.3 : 0.235) {
      const k = bell(z);
      dorsal(0, z, 0.15 + 0.05 * k, 0.2 + 0.07 * k, 0.09 + 0.07 * k, 0.6, k > 0.8 && !baby ? 0.12 + 0.1 * k : 0);
    }
    // a flanking row each side, staggered
    for (const s of [1, -1])
      for (let z = 1.0; z > -1.3; z -= baby ? 0.34 : 0.26) {
        const k = bell(z + 0.1);
        dorsal(s * 0.36, z, 0.13 + 0.03 * k, 0.14 + 0.03 * k, 0.065 + 0.03 * k, 0.4);
      }
    // shoulder and haunch shields: three broad scales each, shingled downward like roof tiles
    if (!baby)
      both((s) => {
        for (const [p, a, h] of [[[0.6, 1.3, 0.64], 0.16, 0.08], [[0.72, 1.07, 0.56], 0.13, 0.065], [[0.7, 1.08, 0.8], 0.12, 0.06], [[0.62, 1.32, -0.98], 0.16, 0.08], [[0.74, 1.08, -0.86], 0.13, 0.065], [[0.72, 1.06, -1.12], 0.12, 0.06]] as [V3, number, number][]) {
          const tgt = V(B(sx(p, s)));
          const out = norm3([s, 0.55, 0]);
          const hit = castIn(torso, add3(tgt, scl3(out, U(0.8))), scl3(out, -1));
          if (hit) grow(hit, [0, 1, 0], { a: pb(a), b: pb(a * 1.15), h: pb(h), keel: 0.35, tilt: 0.4, sink: 2.5, seed: seed++, sq: 2.6, clean: true });
        }
      });
  }

  // ================================================================ head and jaw: two sculpts that meet at fleshy lips
  const headCol = (i: number, j: number, k: number) => {
    const q = invH(Mv(i, j, k));
    let c = HIDE.base;
    const m = n01(q[0], q[1], q[2], 2.2, 23);
    if (m > 0.66) c = mixc(c, HIDE.dark, 0.16);
    else if (m < 0.34) c = mixc(c, HIDE.light, 0.18);
    if (q[1] > 1.38) c = mixc(c, HIDE.light, sstep(1.38, 1.62, q[1]) * 0.4);
    // pink skin round the eyes, on the flews and the cheeks
    const ex = Math.abs(q[0]) - 0.33, ey = q[1] - 1.48, ez = q[2] - 1.66;
    const de = Math.sqrt(ex * ex + ey * ey + ez * ez);
    if (de < 0.2) c = mixc(c, HIDE.pink, sstep(0.2, 0.1, de) * 0.55);
    if (q[1] < 1.14 && Math.abs(q[0]) > 0.28) c = mixc(c, HIDE.pink, sstep(1.14, 0.9, q[1]) * 0.5);
    // blood sweat weeping from the eyes down the cheeks
    if (!baby && Math.abs(q[0]) > 0.2 && q[2] > 1.42 && q[2] < 1.82 && q[1] < 1.42 && q[1] > 0.95) {
      const st = (Math.abs(q[0]) * 2 + q[2]) * 9 + n01(q[0], q[1] * 0.25, q[2], 4, 3) * 1.4;
      if (st - Math.floor(st) < 0.2) c = mixc(c, HIDE.sweat, 0.45 * sstep(0.95, 1.25, q[1]));
    }
    if (q[1] < 0.7) c = mixc(c, HIDE.dust, 0.3);
    // three claw scars across the left brow
    if (!baby && q[0] > 0.12 && q[0] < 0.5 && q[1] > 1.3) {
      const g = q[2] * 0.8 + q[0] * 1.2 - q[1] * 0.2;
      for (let s = 0; s < 3; s++) if (Math.abs(g - (1.7 + s * 0.065)) < 0.011 && q[0] > 0.16 + s * 0.03) c = HIDE.scar;
    }
    return babyPink(c);
  };
  const subE = (c: V3, r: V3, k: number): Prim => ({ ...EH(c, r), sub: true, k: U(k * L.hk) });
  const head = rig.part('head', 'neck', V(H(J.headJ)));
  fblob(head, [
    EH([0, 1.3, 1.54], [0.44, 0.33, 0.4]), // cranium
    EH([0.34, 1.12, 1.55], [0.25, 0.26, 0.3]), // jowls
    EH([-0.34, 1.12, 1.55], [0.25, 0.26, 0.3]),
    EH([0, 1.18, 2.0], [0.42, 0.25, 0.46]), // the broad, rounded muzzle
    EH([0.27, 1.04, 2.08], [0.29, 0.22, 0.34]), // heavy upper-lip flews over the tusk roots
    EH([-0.27, 1.04, 2.08], [0.29, 0.22, 0.34]),
    EH([0, 1.03, 2.32], [0.3, 0.14, 0.16]), // the front lip roll
    EH([0, 1.33, 1.95], [0.28, 0.12, 0.28]), // the domed nasal pad
    EH([0.14, 1.27, 2.27], [0.1, 0.075, 0.095]), // raised nostrils
    EH([-0.14, 1.27, 2.27], [0.1, 0.075, 0.095]),
    EH(J.turret, [0.135, 0.12, 0.135]), // periscope eye turrets
    EH(mir(J.turret), [0.135, 0.12, 0.135]),
    EH([0, 1.5, 1.5], [0.28, 0.11, 0.2]), // brow
    EH([0.235, 1.53, 1.37], [0.09, 0.08, 0.08]), // ear mounds
    EH([-0.235, 1.53, 1.37], [0.09, 0.08, 0.08]),
    CH([0, 1.1, 1.3], [0, 1.12, 1.45], 0.46, 0.46), // neck join (stays inside the neck)
    subE([0, 0.4, 2.1], [0.56, 0.6, 0.85], 0.07), // the jaw's room: the flews hang lowest at the sides
    subE([0, 0.95, 1.98], [0.27, 0.14, 0.5], 0.06), // the vaulted palate
  ], headCol, { k: U(0.09 * L.hk), disp: lumps(0.3, 0.32, 21), keep: (x, y, z) => y >= 0 && invH(Mv(x, y, z))[2] >= 1.23, inner: INNER });
  const jaw = rig.part('jaw', 'head', V(H(J.hinge)));
  fblob(jaw, [
    CH([0, 0.92, 1.45], [0, 0.86, 2.12], 0.37, 0.32), // the mandible
    EH([0.24, 0.87, 2.02], [0.29, 0.2, 0.36]), // chin lobes
    EH([-0.24, 0.87, 2.02], [0.29, 0.2, 0.36]),
    EH([0.34, 0.93, 1.56], [0.23, 0.2, 0.27]), // the lower cheeks
    EH([-0.34, 0.93, 1.56], [0.23, 0.2, 0.27]),
    EH([0, 0.93, 2.3], [0.27, 0.1, 0.15]), // the lower lip roll
    subE([0, 1.62, 2.0], [0.6, 0.6, 0.95], 0.07), // the line of the lips: the jaw's rim rises toward its sides
    subE([0, 1.02, 1.93], [0.24, 0.1, 0.42], 0.05), // the tongue bowl
  ], headCol, { k: U(0.09 * L.hk), disp: lumps(0.3, 0.32, 22), keep: (x, y, z) => y >= 0 && invH(Mv(x, y, z))[2] >= 1.26, inner: INNER });
  // ---- the mouth: pink fleshy lips rolling over the gums, a wet ridged palate, gums and molars round the tongue bowl
  {
    const rep: [VoxelModel, number, number, number, number, number][] = [];
    const lipC = (edge: boolean) => mixc(HIDE.lip, HIDE.pink, edge ? 0.2 : 0.55);
    head.forEach((x, y, z) => {
      const q = invH(Mv(x, y, z));
      if (q[2] < 1.42 || q[1] > 1.16 || !exposed(head, x, y, z)) return;
      const below = !head.has(x, y - 1, z);
      const toMid = !head.has(x - Math.sign(x + 0.5), y, z);
      if (below && Math.abs(q[0]) < 0.3 && q[1] > 0.9 && q[2] < 2.42) rep.push([head, x, y, z, Math.floor(q[2] / 0.085) & 1 ? HIDE.palate : mixc(HIDE.palate, HIDE.ridge, 0.4), VF.METAL]);
      else if (below || !head.has(x, y - 2, z)) rep.push([head, x, y, z, lipC(below), VF.SOLID]);
      else if (toMid && Math.abs(q[0]) < 0.52 && q[1] < 1.06) rep.push([head, x, y, z, HIDE.gum, VF.METAL]);
    });
    jaw.forEach((x, y, z) => {
      const q = invH(Mv(x, y, z));
      if (q[2] < 1.45 || q[1] < 0.8 || !exposed(jaw, x, y, z)) return;
      const above = !jaw.has(x, y + 1, z);
      const ax = Math.abs(q[0]);
      if (above && ax < 0.25 && q[2] > 1.48 && q[2] < 2.36 && q[1] < 1.01) {
        const molar = ax > 0.16 && q[2] > 1.52 && q[2] < 1.9 && Math.floor(q[2] / 0.06) % 3 !== 0;
        rep.push([jaw, x, y, z, molar ? HIDE.molar : HIDE.gum, molar ? VF.SOLID : VF.METAL]);
      } else if (above || !jaw.has(x, y + 2, z)) rep.push([jaw, x, y, z, lipC(above), VF.SOLID]);
      else if (!jaw.has(x - Math.sign(x + 0.5), y, z) && ax < 0.5 && q[1] > 0.88) rep.push([jaw, x, y, z, HIDE.gum, VF.METAL]);
    });
    for (const [m, x, y, z, c, f] of rep) m.set(x, y, z, c, f);
  }
  // where the tongue lies: the floor of the bowl down the middle
  const floorY = new Map<number, number>();
  jaw.forEach((x, y, z) => {
    if (jaw.has(x, y + 1, z) || invH(Mv(x, y, z))[1] > 1.02) return;
    const key = z * 4096 + x;
    floorY.set(key, Math.max(floorY.get(key) ?? -1e9, y));
  });
  // ---- lower tusks: great curved sand-polished ivory sweeping up past the lip (the left one snapped off)
  const TUSK: V3[] = [[0.36, 0.9, 2.06], [0.44, 1.1, 2.19], [0.51, 1.3, 2.18], [0.54, 1.45, 2.06], [0.52, 1.53, 1.94]];
  const TUSK_R = [0.085, 0.074, 0.058, 0.036, 0.016];
  const ivoryAlong = (t: number, y: number) => {
    let c = t < 0.2 ? HIDE.ivoryBase : t > 0.8 ? HIDE.ivoryTip : mixc(HIDE.ivory, HIDE.ivoryBase, Math.max(0, 0.45 - t) * 0.5);
    if (t > 0.18 && t < 0.78 && Math.floor(y * 0.8) % 3 === 0) c = mixc(c, HIDE.ivoryBase, 0.35); // growth rings
    return c;
  };
  if (!baby) {
    both((s) => {
      const pts = TUSK.map((p) => V(H(sx(p, s))));
      tube(head, pts, TUSK_R.map((r) => U(r * L.hk) + 0.6), 0, { carve: true });
      const snapped = s > 0;
      const use = snapped ? pts.slice(0, 4) : pts;
      const radii = (snapped ? TUSK_R.slice(0, 4).map((r, i) => (i === 3 ? 0.045 : r)) : TUSK_R).map((r) => U(r * L.hk));
      const y0 = pts[0][1], y1 = pts[pts.length - 1][1];
      const endY = use[use.length - 1][1];
      tube(jaw, use, radii, (x, y) => {
        const t = (y + 0.5 - y0) / (y1 - y0);
        if (snapped && y + 0.5 > endY - 1.6) return h01(x, y, 0, 4) < 0.5 ? HIDE.ivoryCrack : HIDE.ivoryBase; // the jagged break
        return ivoryAlong(t, y);
      });
      // a long hairline crack down the outside of the right tusk
      if (!snapped) paint(jaw, (x, y, z) => {
        const t = (y + 0.5 - y0) / (y1 - y0);
        if (t < 0.25 || t > 0.75 || !exposed(jaw, x, y, z)) return false;
        return x + 0.5 < pts[1][0] - U(0.05) && Math.abs(z + 0.5 - pts[1][2] - (t - 0.5) * 3) < 0.6;
      }, HIDE.ivoryCrack);
    });
    // forward pegs of lower incisors
    both((s) => {
      cap(jaw, V(H(sx([0.07, 0.93, 2.36], s))), V(H(sx([0.09, 0.955, 2.56], s))), U(0.036), U(0.028), (_x, _y, z) => (z * dv > H([0, 0, 2.5])[2] ? HIDE.ivoryTip : HIDE.ivory));
      cap(jaw, V(H(sx([0.19, 0.93, 2.32], s))), V(H(sx([0.24, 0.955, 2.5], s))), U(0.033), U(0.025), HIDE.ivory);
    });
  } else {
    // the calf's tusk buds and milk incisors
    both((s) => {
      ell(jaw, V(H(sx([0.36, 0.97, 2.08], s))), [U(0.05 * L.hk), U(0.06 * L.hk), U(0.05 * L.hk)], HIDE.ivoryTip);
      ell(jaw, V(H(sx([0.1, 0.95, 2.42], s))), [U(0.035 * L.hk), U(0.03 * L.hk), U(0.04 * L.hk)], HIDE.ivoryTip);
    });
  }
  // ---- the tongue: a thick, wet, grooved slab in the bowl that lifts and curls when the mouth gapes
  {
    const tj = H([0, 0.95, 1.6]);
    const tongue = rig.part('tongue', 'jaw', V(tj));
    const x0 = Math.floor(V(H([0, 0, 0]))[0]);
    for (const [zz, rx, ry, rz] of [[1.66, 0.17, 0.065, 0.15], [1.86, 0.16, 0.06, 0.14], [2.04, 0.13, 0.055, 0.12], [2.17, 0.09, 0.045, 0.08]] as number[][]) {
      const c = V(H([0, 0, zz]));
      let fy = -1e9;
      for (let dz = -2; dz <= 2; dz++) fy = Math.max(fy, floorY.get((Math.floor(c[2]) + dz) * 4096 + x0) ?? -1e9);
      if (fy < -1e8) fy = V(H([0, 0.95, 0]))[1];
      c[1] = fy + 1 + U(ry * L.hk) * 0.55;
      ell(tongue, c, [U(rx * L.hk), U(ry * L.hk), U(rz * L.hk)], (x, y) => (Math.abs(x + 0.5 - x0 - 0.5) < 0.9 && y + 0.5 > c[1] ? HIDE.tongueD : mixc(HIDE.tongue, 0xf0a090, h01(x >> 1, y, 0, 3) * 0.25)), { fl: VF.METAL, keep: (_a, _b, _c, x, y, z) => !jaw.has(x, y, z) });
    }
  }
  // ---- slit nostrils that pinch shut against blowing sand
  both((s) => {
    const a = V(H(sx(NOS_A, s))), b = V(H(sx(NOS_B, s)));
    const n = Math.ceil(Math.hypot(b[0] - a[0], b[2] - a[2]) * 2) + 1;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const x = Math.floor(a[0] + (b[0] - a[0]) * t), z = Math.floor(a[2] + (b[2] - a[2]) * t);
      for (let y = Math.floor(a[1]) + 4; y > Math.floor(a[1]) - 6; y--) {
        if (!head.has(x, y, z)) continue;
        head.del(x, y, z);
        head.set(x, y - 1, z, 0x3a2420);
        break;
      }
    }
  });
  // ---- armour: horned brow shields over the eyes, a crown of plates, the nasal boss; the chin spade
  {
    let seed = 40;
    const onHead = (m: VoxelModel, target: VoxelModel, at: V3, out: V3, fwd: V3, a: number, b: number, h: number, keel: number, tilt: number, spike = 0) => {
      const tgt = V(H(at));
      const o = norm3(out);
      const hit = castIn(target, add3(tgt, scl3(o, U(0.5))), scl3(o, -1));
      if (!hit) return null;
      const n = normalAt(target, hit, 3);
      plate(m, [hit[0] + 0.5, hit[1] + 0.5, hit[2] + 0.5], n, fwd, { a: ph(a), b: ph(b), h: ph(h) * (baby ? 0.5 : 1), keel, tilt, sink: 2, seed: seed++, sq: 2.4, spike: baby ? 0 : ph(spike), spikeLean: 1.1, clean: true }, PAL);
      return hit;
    };
    both((s) => {
      // the brow shield arches over the back of the turret; two horn knobs sweep back off it
      onHead(head, head, sx([0.29, 1.56, 1.5], s), sx([0.25, 1, -0.35], s), [0, 0, 1], 0.12, 0.1, 0.05, 0.3, 0.45, 0.1);
      onHead(head, head, sx([0.17, 1.6, 1.4], s), sx([0.15, 1, -0.4], s), [0, 0, 1], 0.08, 0.07, 0.035, 0.3, 0.4, baby ? 0 : 0.06);
      // cheek scutes over the jowls
      onHead(head, head, sx([0.52, 1.22, 1.58], s), sx([1, 0.4, 0], s), [0, 1, 0], 0.1, 0.1, 0.035, 0.25, 0.35);
    });
    onHead(head, head, [0, 1.63, 1.48], [0, 1, 0], [0, 0, 1], 0.12, 0.1, 0.045, 0.4, 0.35);
    onHead(head, head, [0, 1.48, 1.9], [0, 1, 0.15], [0, 0, 1], 0.15, 0.13, 0.045, 0.25, 0.2); // nasal boss
    // a keratin spade under the chin, scraped bright from digging in
    const chin = castIn(jaw, V(H([0, 0.3, 2.12])), [0, 1, 0.25]);
    if (chin) {
      const n = normalAt(jaw, chin, 3);
      plate(jaw, [chin[0] + 0.5, chin[1] + 0.5, chin[2] + 0.5], n, [0, 0, 1], { a: ph(0.22), b: ph(0.2), h: ph(0.04) * (baby ? 0.5 : 1), keel: 0.1, tilt: -0.2, sink: 2, seed: 77, sq: 3, clean: true }, PAL);
    }
  }
  // ================================================================ eyes on periscope turrets, lids, ears
  const RE = EYE_R * L.hk * L.eyeK;
  const fwdL = norm3([0.55, 0.25, 0.8]);
  const eyeCL = add3(H(J.turret), scl3(fwdL, 0.135 * L.hk - RE * 0.55));
  both((s) => {
    const ec = V(sx(eyeCL, s));
    paint(head, (x, y, z) => Math.hypot(x + 0.5 - ec[0], y + 0.5 - ec[1], z + 0.5 - ec[2]) < U(RE) * 1.8 && exposed(head, x, y, z), (x, y, z) => mixc(headCol(x, y, z), HIDE.pink, 0.45));
    ell(head, ec, [U(RE) * 1.07, U(RE) * 1.07, U(RE) * 1.07], 0, { carve: true });
  });
  {
    const ec = V(eyeCL);
    const eye = rig.part('eye_l', 'head', ec);
    wetEye(eye, ec, U(RE), fwdL, baby
      ? { sclera: 0x24140e, iris: 0x5c3018, irisEdge: 0x2e180a, pupil: 0x070404, irisR: 0.94, pupilR: 0.6, bigGlint: 2 }
      : { sclera: 0x3a2218, iris: 0x8a4a1e, irisEdge: 0x40220e, pupil: 0x0a0605, irisR: 0.86, pupilR: 0.42, bigGlint: 2 });
    rig.mirror('eye_l', 'eye_r');
    // heavy lids: a hood of hide over the top of each eye (rotates down over it to blink)
    const lid = rig.part('lid_l', 'head', ec);
    const r0 = U(RE) + 0.35, r1 = U(RE) + 1.75;
    const up: V3 = [0, 1, 0];
    const R = Math.ceil(r1) + 1;
    for (let x = Math.floor(ec[0] - R); x <= ec[0] + R; x++)
      for (let y = Math.floor(ec[1] - R); y <= ec[1] + R; y++)
        for (let z = Math.floor(ec[2] - R); z <= ec[2] + R; z++) {
          const d: V3 = [x + 0.5 - ec[0], y + 0.5 - ec[1], z + 0.5 - ec[2]];
          const l = Math.hypot(d[0], d[1], d[2]);
          if (l < r0 || l > r1 || head.has(x, y, z)) continue;
          const n = scl3(d, 1 / l);
          const du = dot3(n, up);
          const cut = baby ? 0.62 : 0.42;
          if (du < cut || dot3(n, fwdL) < -0.2) continue;
          lid.set(x, y, z, du < cut + 0.1 ? 0x5a3a2e : mixc(headCol(x, y, z), HIDE.pink, 0.25));
        }
    rig.mirror('lid_l', 'lid_r');
  }
  {
    const eb = H(J.ear);
    const ear = rig.part('ear_l', 'head', V(eb));
    const ec = V(add3(eb, scl3([0.025, 0.08, -0.02], L.hk)));
    const er: V3 = [U(0.07 * L.hk), U(0.1 * L.hk), U(0.045 * L.hk)];
    const rot: V3 = [-0.25, 0, -0.5];
    ell(ear, ec, er, (x, y, z) => {
      const l = invXYZ([x + 0.5 - ec[0], y + 0.5 - ec[1], z + 0.5 - ec[2]], rot);
      const rim = (l[0] / er[0]) ** 2 + (l[1] / er[1]) ** 2 > 0.6;
      if (l[2] > er[2] * 0.2) return rim ? HIDE.dark : mixc(HIDE.pink, 0xc07a70, h01(x >> 1, y >> 1, z, 2) * 0.4);
      return babyPink(rim ? HIDE.light : HIDE.base);
    }, { rot });
    const er2 = rig.mirror('ear_l', 'ear_r');
    // an old notch bitten out of the right ear
    if (!baby) {
      const tip = V(sx(add3(eb, [0.06, 0.16, -0.03]), -1));
      ell(er2, tip, [U(0.03), U(0.035), U(0.06)], 0, { carve: true });
    }
  }
  // ---- nostril valves: a lip of hide beside each slit that folds over it to seal out the sand
  const noseAxis = norm3(sub3(NOS_B, NOS_A));
  {
    const a = H(NOS_A), b = H(NOS_B);
    const mid = scl3(add3(a, b), 0.5);
    const perp = norm3([noseAxis[2], 0, -noseAxis[0]]);
    const hinge = add3(mid, scl3([0, -0.01, 0], L.hk));
    const flap = rig.part('nose_l', 'head', V(hinge));
    const phi = -Math.atan2(noseAxis[2], noseAxis[0]);
    const c = V(add3(mid, scl3(add3(scl3(perp, 0.036), [0, 0.006, 0]), L.hk)));
    ell(flap, c, [U(0.08 * L.hk), U(0.032 * L.hk), U(0.042 * L.hk)], (x, y) => (y + 0.5 > c[1] + 0.4 ? mixc(HIDE.light, HIDE.pink, 0.3) : mixc(HIDE.base, HIDE.pink, 0.35)), { rot: [0, phi, 0] });
    rig.mirror('nose_l', 'nose_r');
  }
  // ---- heat-venting frills: a fan of bony rays and a hot, vascular membrane folded back along each cheek
  {
    const FR = baby ? FRILL_CALF : FRILL;
    const piv = H(J.frill);
    // (pivot sits just proud of the cheek so the folded fan stands clear of the skin)
    const frill = rig.part('frill_l', 'head', V(piv));
    const back = norm3([0.62, 0.05, -1]);
    const upv = norm3(sub3([0, 1, 0], scl3(back, dot3([0, 1, 0], back))));
    const K = baby ? 0.7 : 1;
    const rays: { d: V3; len: number }[] = [];
    const ANG = [-0.35, 0.05, 0.45, 0.85, 1.22];
    const LEN = [0.36, 0.48, 0.54, 0.5, 0.36];
    ANG.forEach((a, i) => rays.push({ d: norm3(add3(scl3(back, Math.cos(a)), scl3(upv, Math.sin(a)))), len: LEN[i] * L.hk * K }));
    const P0 = V(piv);
    // membrane first (rays overwrite it)
    for (let i = 0; i < rays.length - 1; i++) {
      const r1 = rays[i], r2 = rays[i + 1];
      const N = 6;
      for (let s = 0; s < N; s++) {
        const u0 = s / N, u1 = (s + 1) / N;
        const edge = (u: number) => {
          const d = norm3(add3(scl3(r1.d, 1 - u), scl3(r2.d, u)));
          const len = (r1.len * (1 - u) + r2.len * u) * (1 - 0.2 * Math.sin(Math.PI * u)); // scalloped edge
          return add3(P0, scl3(d, U(len)));
        };
        const near = add3(P0, scl3(norm3(add3(r1.d, r2.d)), U(0.04 * L.hk)));
        tri(frill, near, edge(u0), edge(u1), (u, v, x, y, z) => {
          const p: V3 = [x + 0.5 - P0[0], y + 0.5 - P0[1], z + 0.5 - P0[2]];
          const rr = Math.hypot(p[0], p[1], p[2]) / U(0.34 * L.hk * K);
          let col = mixc(FR.memD, FR.mem, clamp01(rr * 1.4));
          if (rr > 0.78) col = mixc(col, FR.memHi, 0.6);
          // veins branching out toward the rim
          const vv = (u0 + (u1 - u0) * (v / Math.max(1e-3, u + v)) + i) * 3.2 + rr * 1.6;
          if (vv - Math.floor(vv) < 0.13 && rr > 0.25) col = FR.vein;
          return col;
        }, VF.SOFTAO, 0.4);
      }
    }
    for (const r of rays) {
      const tip = add3(P0, scl3(r.d, U(r.len * 1.12)));
      cap(frill, P0, tip, U(0.036 * L.hk * K) + 0.4, 0.6, (x, y, z) => (Math.hypot(x + 0.5 - P0[0], y + 0.5 - P0[1], z + 0.5 - P0[2]) > U(r.len * 0.75) ? FR.ray : FR.rayD));
    }
    rig.mirror('frill_l', 'frill_r');
  }

  // ================================================================ pillar legs: upper, lower, foot (pad), toes
  const legCol = (i: number, j: number, k: number) => {
    const q = invG(Mv(i, j, k));
    let c = skin(q, Math.abs(q[0]) > 0.55 ? 0.1 : -0.2);
    // ring wrinkles at the wrists / ankles and the elbows
    if (q[1] > 0.13 && q[1] < 0.36 && (q[1] * 11 + n01(q[0], q[1], q[2], 6, 2) * 0.6) % 1 < 0.2) c = mixc(c, HIDE.crease, 0.5);
    if (q[1] > 0.46 && q[1] < 0.6 && (q[1] * 10 + n01(q[0], q[1], q[2], 6, 4) * 0.5) % 1 < 0.16) c = mixc(c, HIDE.crease, 0.4);
    if (q[1] < 0.06) c = HIDE.pad;
    return c;
  };
  const lr = L.lr;
  const buildLeg = (front: boolean) => {
    const k = front ? 'f' : 'b';
    const top = G(front ? J.shoulder : J.hip), mid = G(front ? J.elbow : J.knee), low = G(front ? J.fWrist : J.bHock);
    const toeJ = G(front ? J.fToe : J.bToe);
    const ft = front ? J.fWrist : J.bHock;
    const padC: V3 = [ft[0], 0.075, ft[2] + 0.03];
    /** keep a segment above the plane through its lower joint (the child's ball, centred on its pivot, covers the joint at any angle) */
    const above = (a: V3, b: V3) => {
      const A = V(a), Bv = V(b), ax = sub3(Bv, A);
      const L2 = dot3(ax, ax);
      return (x: number, y: number, z: number) => dot3(sub3([x + 0.5, y + 0.5, z + 0.5], A), ax) / L2 < 1 + 0.6 / Math.sqrt(L2);
    };
    const leg = rig.part('leg_' + k + 'l', front ? 'chest' : 'rump', V(top));
    fblob(leg, [
      { a: V(top), b: V(mid), r0: U((front ? 0.28 : 0.3) * lr), r1: U(0.23 * lr) },
      { c: V(add3(top, [0.04, -0.12, front ? 0.06 : -0.04])), r: [U(0.24 * lr), U(0.24 * lr), U(0.26 * lr)] }, // deltoid / thigh mass
    ], legCol, { k: U(0.08), disp: lumps(0.35, 0.3, 31), inner: INNER, keep: above(top, mid) });
    const shin = rig.part('shin_' + k + 'l', 'leg_' + k + 'l', V(mid));
    fblob(shin, [
      { a: V(mid), b: V(low), r0: U(0.23 * lr), r1: U(0.2 * lr) },
      { c: V(add3(mid, [0.02, -0.08, front ? 0.02 : -0.03])), r: [U(0.21 * lr), U(0.16 * lr), U(0.21 * lr)] },
    ], legCol, { k: U(0.06), disp: lumps(0.3, 0.3, 33), inner: INNER, keep: above(mid, low) });
    // keratin scutes down the front of the forearm / shin
    if (!baby)
      for (const [t, a, w] of [[0.28, 0.085, 0.09], [0.66, 0.075, 0.08]] as number[][]) {
        const p = add3(mid, scl3(sub3(low, mid), t));
        const hit = castIn(shin, V(add3(p, [0.08, 0, 0.6])), [-0.12, 0, -1]);
        if (!hit) continue;
        plate(shin, [hit[0] + 0.5, hit[1] + 0.5, hit[2] + 0.5], normalAt(shin, hit, 3), [0, 1, 0], { a: U(a * lr), b: U(w * lr), h: U(0.035 * lr), keel: 0.35, tilt: 0.4, sink: 2, seed: 90 + t * 10 + (front ? 0 : 7), sq: 2.6, clean: true }, PAL);
      }
    const foot = rig.part('foot_' + k + 'l', 'shin_' + k + 'l', V(low));
    fblob(foot, [
      { a: V(low), b: V(G(add3(padC, [0, 0.06, 0]))), r0: U(0.2 * lr), r1: U(0.21 * lr) },
      { c: V(G(padC)), r: [U(0.22 * lr), U(0.085 * legK), U(0.23 * lr)] },
      { c: V(G(add3(padC, [0, -0.035, 0.04]))), r: [U(0.25 * lr), U(0.042 * legK), U(0.24 * lr)] }, // wide snowshoe sole
    ], legCol, { k: U(0.05), keep: (_x, y) => y >= 0, inner: INNER });
    // the toes: four stubby digits splayed round the front of the pad, with thick hoof-nails
    const toes = rig.part('toes_' + k + 'l', 'foot_' + k + 'l', V(toeJ));
    for (const a of [-0.82, -0.27, 0.27, 0.82]) {
      const d: V3 = [Math.sin(a), 0, Math.cos(a)];
      const t0 = add3(padC, add3(scl3(d, 0.1), [0, 0.0, 0])), t1 = add3(padC, add3(scl3(d, 0.25), [0, -0.02, 0]));
      cap(toes, V(G(t0)), V(G(t1)), U(0.075 * lr), U(0.062 * lr), legCol, { keep: (_t, _a, _b, _x, y) => y >= 0 });
      const n0 = add3(padC, add3(scl3(d, 0.24), [0, -0.022, 0])), n1 = add3(padC, add3(scl3(d, 0.32), [0, -0.03, 0]));
      cap(toes, V(G(n0)), V(G(n1)), U(0.058 * lr), U(0.04 * lr), (x, y, z) => {
        const tip = dot3(sub3(Mv(x, y, z), G(padC)), d) > 0.29 * lr;
        return tip ? HIDE.nailHi : y * dv > 0.07 ? mixc(HIDE.nail, HIDE.nailHi, 0.3) : HIDE.nail;
      }, { keep: (_t, _a, _b, _x, y) => y >= 0 });
    }
    rig.mirror('leg_' + k + 'l', 'leg_' + k + 'r');
    rig.mirror('shin_' + k + 'l', 'shin_' + k + 'r', 'leg_' + k + 'r');
    rig.mirror('foot_' + k + 'l', 'foot_' + k + 'r', 'shin_' + k + 'r');
    rig.mirror('toes_' + k + 'l', 'toes_' + k + 'r', 'foot_' + k + 'r');
  };
  buildLeg(true);
  buildLeg(false);

  // ================================================================ the tail: a short, flattened, plated club with a bristle tuft
  {
    const TP = [J.tail0, J.tail1, J.tail2, J.tail3, J.tailTip];
    const TR = [0.13, 0.115, 0.095, 0.07, 0.04];
    const names = ['tail1', 'tail2', 'tail3'];
    let parent = 'rump';
    for (let i = 0; i < 3; i++) {
      const m = rig.part(names[i], parent, V(B(TP[i])));
      const a = V(B(TP[i])), b = V(B(TP[i + 1]));
      const last = i === 2;
      const end = last ? V(B(TP[4])) : b;
      fblob(m, [{ a, b: end, r0: U(TR[i] * L.bw), r1: U(TR[last ? 4 : i + 1] * L.bw) }], bodyCol, { k: 1, keep: (x, y, z) => {
        // flattened side to side
        const p: V3 = [x + 0.5, y + 0.5, z + 0.5];
        const ax = sub3(end, a);
        const t = clamp01(dot3(sub3(p, a), ax) / dot3(ax, ax));
        const c = add3(a, scl3(ax, t));
        const r = U((TR[i] + ((TR[last ? 4 : i + 1]) - TR[i]) * t) * L.bw);
        return Math.abs(p[0] - c[0]) < r * 0.72;
      } });
      if (!baby && i < 2) {
        const mid = scl3(add3(a, b), 0.5);
        const hit = castIn(m, add3(mid, [0, U(0.3), -U(0.2)]), [0, -0.83, 0.55]);
        if (hit) plate(m, [hit[0] + 0.5, hit[1] + 0.5, hit[2] + 0.5], normalAt(m, hit, 2), norm3(sub3(a, b)), { a: U(0.07), b: U(0.05), h: U(0.045), keel: 0.6, tilt: 0.4, sink: 1.5, seed: 120 + i, sq: 2.4, spike: U(0.05 - i * 0.015), spikeLean: 1, clean: true }, PAL);
      }
      if (last) {
        const tipP = B(J.tailTip);
        for (let bb = 0; bb < 9; bb++) {
          const an = (bb / 8 - 0.5) * 1.8;
          const root = add3(tipP, [Math.sin(an) * 0.025, 0.03, 0.0]);
          const tp = add3(tipP, [Math.sin(an) * 0.07, -0.11 - Math.cos(an) * 0.03, -0.03]);
          line(m, [V(root), V(tp)], bb % 2 ? HIDE.bristleD : 0x6e5040);
        }
      }
      parent = names[i];
    }
  }

  // buried ends of limbs, the head's neck join and the tail root: never seen, so never meshed
  for (const p of rig.parts) if (p.parent && /^(leg|shin|foot|toes|head|tail1)/.test(p.name)) cullBuried(p.model, rig.m(p.parent), 3);
  // overlapping parts never share an exposed cell (no coplanar z-fighting at the joints)
  for (const p of rig.parts) {
    if (!p.parent || /^(eye|lid)_/.test(p.name) || p.name === 'jaw' || p.name === 'tongue') continue;
    const par = rig.m(p.parent);
    const del: V3[] = [];
    p.model.forEach((x, y, z) => {
      if (par.has(x, y, z) && exposed(par, x, y, z)) del.push([x, y, z]);
    });
    for (const [x, y, z] of del) p.model.del(x, y, z);
  }

  const s = L.s;
  rig.socket('mouth', 'head', V(H([0, 1.0, 2.36])));
  rig.socket('back', 'body', V(B([0, 1.66, 0])));
  rig.socket('head_top', 'head', V(H([0, 1.66, 1.45])));
  rig.socket('nostril_l', 'head', V(H([0.14, 1.36, 2.28])));
  rig.socket('nostril_r', 'head', V(H([-0.14, 1.36, 2.28])));
  return rig.build({
    kind: 'hippo',
    baby,
    scale: s,
    height: (H(J.turret)[1] + 0.14 * L.hk) * s,
    backY: B([0, baby ? 1.6 : 1.68, 0])[1] * s,
    halfLen: 1.5 * L.bl * s,
    halfWid: 0.78 * L.bw * s,
    radius: 0.86 * L.bw * s,
    length: (H([0, 1, 2.5])[2] - B([0, 1, -1.6])[2]) * s,
    headZ: H([0, 1, 2.2])[2] * s,
    wallowDrop: 0.5 * s,
    burrowDrop: (1.12 - L.drop * 0.5) * s,
    lidAxis: norm3([0.8, 0, -0.55]),
    noseAxis,
  });
}

const memo = memoBy((b: boolean) => (b ? 'baby' : 'adult'), (b: boolean) => buildHippo(b ? BABY : ADULT));
/** the adult sand hippo (≈ 4 m long, 1.7 m at the plated shoulder, 1/32 m) */
export function sandHippoRig(): RigSpec {
  return memo(false);
}
/** the calf (≈ 1.4 m long, round and pink-cheeked, plate buds and tusk buds; 1/55 m) */
export function babyHippoRig(): RigSpec {
  return memo(true);
}

// ============================================================================ animation
const damp = (a: number, b: number, l: number, dt: number) => a + (b - a) * (1 - Math.exp(-l * dt));
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const TAU = Math.PI * 2;
const GAIT = {
  walk: { lb: 0, lf: 0.25, rb: 0.5, rf: 0.75 },
  trot: { lb: 0.5, lf: 0, rb: 0, rf: 0.5 },
  gallop: { lb: 0, lf: 0.6, rb: 0.12, rf: 0.48 },
};
const LEGS: ['lf' | 'rf' | 'lb' | 'rb', string, number, boolean][] = [
  ['lf', 'fl', 1, true],
  ['rf', 'fr', -1, true],
  ['lb', 'bl', 1, false],
  ['rb', 'br', -1, false],
];
const _q = new THREE.Quaternion();
const _ax = new THREE.Vector3();
type Idle = 'none' | 'shake' | 'sniff' | 'shift' | 'flare' | 'gape';

export interface HippoDrive {
  /** ground speed (m/s) */
  speed: number;
  /** yaw rate (rad/s), leans into turns */
  turn?: number;
  /** 0 standing, 1 wallowing (lying sunk in the sand), 2 burrowed (only eyes, ears, nostrils and back show) */
  sink: number;
  /** yawn / threat gape 0..1 */
  yawn: number;
  /** bite phase 0..1 (< 0: none) — the jaws snap shut at ≈ 0.4 */
  bite: number;
  /** rage 0..1: head low, ears pinned, squinting, snorting, frills fanned */
  rage: number;
  /** head yaw toward something (rad, + = its left) */
  look: number;
  /** calf poses */
  mode?: 'normal' | 'carried' | 'thrown' | 'dizzy';
}

/**
 * Procedural animation for both hippo rigs. Writes every joint each frame,
 * root scale (squash) and the body's sink. Gaits blend by speed:
 * lateral-sequence walk → diagonal trot → rotary gallop; each leg runs a
 * 4-segment cycle (swing, flexing knee / elbow, folding wrist, curling toes,
 * then a planted, level pad).
 */
export class HippoAnim {
  t = Math.random() * 10;
  phase = Math.random();
  readonly s: number;
  readonly baby: boolean;
  private sq = 0;
  private sqV = 0;
  private sinkCur = 0;
  private lookY = 0;
  private blink = 0;
  private nextBlink = 1 + Math.random() * 3;
  private earT = [9, 9];
  private nextEar = 1.5 + Math.random() * 3;
  private wagT = 9;
  private nextWag = 4 + Math.random() * 6;
  private gal = 0;
  private trot = 0;
  private amp = 0;
  private frill = 0;
  private nose = 0;
  private breathPh = Math.random() * TAU;
  private breathRate = 1;
  private idle: Idle = 'none';
  private idleT = 0;
  private idleDur = 1;
  private idleLeg = 0;
  private nextIdle = 3 + Math.random() * 5;
  private tail = [0, 0, 0, 0, 0, 0];
  private tailV = [0, 0, 0, 0, 0, 0];
  /** digging wiggle while sinking into / heaving out of the sand 0..1 */
  digging = 0;
  /** how far the body is sunk into the sand right now (m) */
  drop = 0;
  /** current sink level (0 stand, 1 wallow, 2 burrow) */
  get sunk() {
    return this.sinkCur;
  }
  private lidAxis: [THREE.Vector3, THREE.Vector3];
  private noseAxis: [THREE.Vector3, THREE.Vector3];
  private bodyY: number;
  constructor(public rig: RigInstance) {
    const meta = rig.geo.spec.meta ?? {};
    this.s = meta.scale ?? 1;
    this.baby = !!meta.baby;
    this.bodyY = rig.geo.parts[rig.geo.index['body'] ?? 0]?.offset.y ?? 0;
    const a = meta.lidAxis ?? [0.8, 0, -0.55];
    this.lidAxis = [new THREE.Vector3(a[0], a[1], a[2]).normalize(), new THREE.Vector3(-a[0], a[1], -a[2]).normalize()];
    const na = meta.noseAxis ?? [0.75, 0, 0.66];
    this.noseAxis = [new THREE.Vector3(na[0], na[1], na[2]).normalize(), new THREE.Vector3(-na[0], na[1], na[2]).normalize()];
  }
  /** squash impulse (negative = squash down, e.g. a hunter bouncing on its back) */
  kick(v: number) {
    this.sqV += v;
  }
  private rot(n: string, x: number, y = 0, z = 0) {
    this.rig.nodes[n]?.rotation.set(x, y, z);
  }
  private axisRot(n: string, axis: THREE.Vector3, a: number) {
    const node = this.rig.nodes[n];
    if (node) node.quaternion.copy(_q.setFromAxisAngle(_ax.copy(axis), a));
  }

  update(dt: number, d: HippoDrive) {
    const t = (this.t += dt);
    const n = this.rig.nodes;
    const s = this.s;
    const mode = d.mode ?? 'normal';
    const rage = d.rage, yawn = d.yawn;
    // ---------------------------------------------------------------- gait
    const sp = d.speed / s;
    this.amp = damp(this.amp, clamp(sp / 1.1, 0, 1), 6, dt);
    this.trot = damp(this.trot, sstep(1.9, 3.4, sp), 4, dt);
    this.gal = damp(this.gal, sstep(5, 7.2, sp), 4, dt);
    const stride = (this.baby ? 1.25 : 1.6) + sp * 0.22;
    this.phase = (this.phase + (dt * Math.max(sp, this.amp * 0.6)) / stride) % 1;
    const ph = this.phase, amp = this.amp, tr = this.trot, gl = this.gal;
    // ---------------------------------------------------------------- sink (wallow / burrow)
    const prevSink = this.sinkCur;
    this.sinkCur = damp(this.sinkCur, d.sink, d.sink > this.sinkCur ? 0.9 : rage > 0.3 ? 4.5 : 1.6, dt);
    this.digging = clamp((Math.abs(this.sinkCur - prevSink) / Math.max(dt, 1e-4)) * 2, 0, 1);
    const w = Math.min(1, this.sinkCur), bur = Math.max(0, this.sinkCur - 1);
    const meta = this.rig.geo.spec.meta ?? {};
    const drop = (this.drop = (meta.wallowDrop ?? 0.5 * s) * w + ((meta.burrowDrop ?? 1.1 * s) - (meta.wallowDrop ?? 0.5 * s)) * bur);
    // ---------------------------------------------------------------- idle behaviours (standing about)
    const calmStand = mode === 'normal' && amp < 0.12 && this.sinkCur < 0.3 && rage < 0.15 && yawn < 0.1 && d.bite < 0;
    this.nextIdle -= dt;
    if (this.idle !== 'none') {
      this.idleT += dt;
      if (this.idleT >= this.idleDur || !calmStand) this.idle = 'none';
    } else if (calmStand && this.nextIdle <= 0) {
      const r = Math.random();
      this.idle = r < 0.24 ? 'shake' : r < 0.48 ? 'sniff' : r < 0.74 ? 'shift' : r < 0.88 ? 'flare' : 'gape';
      this.idleT = 0;
      this.idleDur = this.idle === 'shake' ? 1.1 : this.idle === 'sniff' ? 2.2 : this.idle === 'shift' ? 1.6 : this.idle === 'flare' ? 2.4 : 1.8;
      this.idleLeg = Math.floor(Math.random() * 4);
      this.nextIdle = 4 + Math.random() * 7;
    }
    const iK = this.idle === 'none' ? 0 : Math.sin(Math.PI * clamp(this.idleT / this.idleDur, 0, 1));
    const shake = this.idle === 'shake' ? iK : 0, sniff = this.idle === 'sniff' ? iK : 0, shift = this.idle === 'shift' ? iK : 0;
    const flareI = this.idle === 'flare' ? iK : 0, gapeI = this.idle === 'gape' ? iK : 0;
    // ---------------------------------------------------------------- breathing (faster after running and in a rage)
    this.breathRate = damp(this.breathRate, 1 + amp * 0.8 + gl * 1.2 + rage * 1.4, 0.6, dt);
    this.breathPh += dt * this.breathRate * (this.baby ? 2.6 : 1.8);
    const br = Math.sin(this.breathPh);
    for (const [part, k] of [['body', 1], ['chest', 0.8], ['rump', 0.4]] as [string, number][]) {
      const m = this.rig.meshes[part];
      if (m) m.scale.set(1 + br * 0.012 * k, 1 + br * 0.016 * k, 1);
    }
    // ---------------------------------------------------------------- body and spine
    const bob = (-(0.022 + 0.03 * tr) * Math.abs(Math.cos(ph * TAU * 2)) * (1 - gl) + 0.06 * gl * Math.sin(ph * TAU)) * amp * s;
    let roll = 0.035 * amp * Math.sin(ph * TAU) * (1 - tr * 0.5) * (1 - gl) - (d.turn ?? 0) * 0.05;
    let pitch = 0.08 * gl * Math.sin(ph * TAU + 1.2) * amp - 0.05 * yawn;
    roll += Math.sin(t * 9) * 0.07 * this.digging;
    if (d.bite >= 0) pitch += 0.06 * sstep(0.32, 0.42, d.bite) * (1 - sstep(0.5, 1, d.bite));
    if (mode === 'dizzy') roll += Math.sin(t * 6) * 0.08;
    // weight shift: lean off the foot being lifted
    if (shift > 0) roll += (this.idleLeg & 1 ? 1 : -1) * 0.03 * shift;
    n['body']?.position.set(n['body'].position.x, this.bodyY + bob - drop, n['body'].position.z);
    this.rot('body', pitch, 0, roll);
    // the spine: shoulders and hips swing against each other at a walk, flex and extend at a gallop
    const sw = Math.sin(ph * TAU) * amp * (1 - gl);
    const flex = Math.sin(ph * TAU + 0.9) * gl * amp;
    this.rot('chest', 0.05 * flex - 0.02 * w + br * 0.006, 0.045 * sw + (d.turn ?? 0) * 0.04, 0.012 * sw);
    this.rot('rump', -0.06 * flex + 0.04 * bur, -0.04 * sw - (d.turn ?? 0) * 0.03, -0.01 * sw);
    // ---------------------------------------------------------------- legs
    LEGS.forEach(([k, id, side, front], li) => {
      const off = lerp(lerp(GAIT.walk[k], GAIT.trot[k], tr), GAIT.gallop[k], gl);
      const a = (ph + off) * TAU;
      const A = (0.32 + 0.12 * tr + 0.2 * gl) * amp;
      const swing = Math.sin(a), lift = Math.max(0, Math.cos(a)) * amp;
      let ux = -A * swing * (front ? 0.55 : 0.5), uz = 0;
      let kx = lift * (front ? 0.85 : 0.75);
      // foot: level on the ground through the stance, folding back as it lifts
      let fx = -(ux + kx) * (1 - Math.min(1, lift * 1.4)) + lift * (front ? 0.9 : 0.4);
      let tx = lift * 0.55 - (1 - lift) * 0.08 * amp;
      // idle: lift one foot and set it down again
      if (shift > 0 && li === this.idleLeg) {
        kx += 0.5 * shift;
        ux -= 0.12 * shift;
        fx += 0.25 * shift;
        tx += 0.3 * shift;
      }
      // lying down: front legs reach forward, hind legs fold under, all splay a little
      ux += (front ? -0.7 : -0.55) * w;
      kx += (front ? 1.35 : 1.5) * w;
      fx += (front ? -0.55 : -0.85) * w;
      uz += side * 0.22 * w;
      if (mode === 'carried') {
        ux = Math.sin(t * 17 + (front ? 0 : 1.6) + side) * 0.65;
        kx = 0.4 + Math.sin(t * 17 + side * 2) * 0.3;
        fx = 0.3 + Math.sin(t * 17 + side * 2 + 0.8) * 0.4;
        tx = 0.4;
        uz = side * 0.2;
      } else if (mode === 'thrown') {
        ux = front ? -0.9 : 0.8;
        uz = side * 0.55;
        kx = 0.2;
        fx = front ? -0.3 : 0.4;
        tx = -0.2;
      }
      this.rot('leg_' + id, ux, 0, uz);
      this.rot('shin_' + id, kx);
      this.rot('foot_' + id, fx);
      this.rot('toes_' + id, tx);
    });
    // ---------------------------------------------------------------- neck, head, jaw, tongue
    let look = clamp(d.look, -0.6, 0.6);
    if (mode === 'carried') look = Math.sin(t * 2.3) * 0.45;
    if (mode === 'dizzy') look += Math.cos(t * 6) * 0.3;
    if (this.idle === 'sniff') look += Math.sin(this.idleT * 2.4) * 0.25 * sniff;
    this.lookY = damp(this.lookY, look, 4, dt);
    let hx = 0.04 * amp * Math.sin(ph * TAU * 2 + 1) * (1 - gl) - 0.6 * pitch * gl + 0.12 * rage + 0.1 * gl;
    hx += -0.55 * yawn - 0.2 * bur + 0.28 * sniff - 0.3 * gapeI + br * 0.012;
    let jx = 0.12 * rage + 1.2 * yawn + 0.06 * gl + Math.max(0, Math.sin(t * 0.8)) * 0.02 + 0.9 * gapeI;
    if (d.bite >= 0) {
      const b = d.bite;
      const open = b < 0.32 ? sstep(0, 0.32, b) : b < 0.44 ? 1 - sstep(0.32, 0.44, b) : 0;
      jx += 1.15 * open;
      hx += b < 0.32 ? -0.3 * sstep(0, 0.32, b) : b < 0.5 ? lerp(-0.3, 0.3, sstep(0.32, 0.42, b)) : 0.3 * (1 - sstep(0.5, 1, b));
    }
    let hz = Math.sin(this.idleT * 22) * 0.32 * shake;
    if (mode === 'carried') jx = 0.3 + Math.max(0, Math.sin(t * 9)) * 0.25;
    if (mode === 'thrown') jx = 0.7;
    if (mode === 'dizzy') hz = Math.sin(t * 6) * 0.28;
    this.rot('neck', hx * 0.35, this.lookY * 0.4, hz * 0.4);
    this.rot('head', hx * 0.65, this.lookY * 0.5, hz * 0.7);
    this.rot('jaw', jx);
    const open = clamp(jx / 1.2, 0, 1);
    this.rot('tongue', -0.4 * open * (yawn + gapeI > 0.3 ? 1 : 0.4) + Math.sin(t * 5) * 0.06 * open, 0, Math.sin(t * 3.3) * 0.05 * open);
    // ---------------------------------------------------------------- frills: fanned in display and rage, vented at a gallop
    this.frill = damp(this.frill, Math.max(rage * 0.95, yawn * 0.9, gl * 0.55, flareI, mode === 'thrown' ? 1 : 0, this.digging * 0.3), 5, dt);
    const fr = this.frill * 1.05 + br * 0.03 + (this.frill > 0.5 ? Math.sin(t * 13) * 0.03 * this.frill : 0);
    this.rot('frill_l', -fr * 0.25, -fr, 0);
    this.rot('frill_r', -fr * 0.25, fr, 0);
    // ---------------------------------------------------------------- nostril valves: sealed under the sand, flared to snort
    const seal = clamp(this.sinkCur * 0.9 + this.digging * 0.5, 0, 1);
    const snort = rage > 0.4 ? Math.max(0, Math.sin(t * 7)) * rage : 0;
    this.nose = damp(this.nose, seal * 1.9 - snort * 0.45 - sniff * Math.max(0, Math.sin(this.idleT * 16)) * 0.4 + br * 0.08, 8, dt);
    for (let e = 0; e < 2; e++) this.axisRot(e === 0 ? 'nose_l' : 'nose_r', this.noseAxis[e], (e === 0 ? 1 : -1) * this.nose);
    // ---------------------------------------------------------------- ears: twirl now and then, pinned back in rage / at speed
    this.nextEar -= dt;
    if (this.nextEar <= 0) {
      this.nextEar = 1.5 + Math.random() * 4;
      const e = Math.random() < 0.5 ? 0 : 1;
      this.earT[e] = 0;
      if (Math.random() < 0.4) this.earT[1 - e] = -0.08;
    }
    for (let e = 0; e < 2; e++) {
      this.earT[e] += dt;
      const et = this.earT[e];
      const twirl = (et >= 0 && et < 0.4 ? Math.sin(et * 45) * 0.7 * (1 - et / 0.4) : 0) + Math.sin(this.idleT * 25 + e) * 0.6 * shake;
      const back = 0.65 * rage + 0.4 * yawn + 0.3 * gl + 0.5 * bur + (mode === 'thrown' ? 0.8 : 0) + (mode === 'carried' ? Math.sin(t * 11 + e) * 0.3 : 0);
      this.rot(e === 0 ? 'ear_l' : 'ear_r', -back, twirl, 0);
    }
    // ---------------------------------------------------------------- lids: blinks, sleepy idle, squint
    this.nextBlink -= dt;
    if (this.nextBlink <= 0) {
      this.nextBlink = 2 + Math.random() * 4;
      this.blink = 0.16;
    }
    this.blink = Math.max(0, this.blink - dt);
    let lid = (this.baby ? 0 : 0.1) + 0.4 * rage + 0.6 * yawn + 0.35 * bur + 0.5 * shake + (mode === 'dizzy' ? 0.7 : 0);
    if (mode === 'thrown' || mode === 'carried') lid = -0.25;
    if (this.blink > 0) lid = this.baby ? 1.35 : 1.25;
    for (let e = 0; e < 2; e++) this.axisRot(e === 0 ? 'lid_l' : 'lid_r', this.lidAxis[e], lid);
    // ---------------------------------------------------------------- tail chain: lagging springs (wag bursts, sways with the gait, streams at a gallop)
    this.nextWag -= dt;
    if (this.nextWag <= 0) {
      this.nextWag = 5 + Math.random() * 8;
      this.wagT = 0;
    }
    this.wagT += dt;
    const wag = this.wagT < 1.1 ? Math.sin(this.wagT * 24) * 0.5 : 0;
    const yawDrive = wag + Math.sin(ph * TAU) * 0.18 * amp * (1 - gl) + (mode === 'carried' ? Math.sin(t * 20) * 0.5 : 0) + Math.sin(t * 1.3) * 0.05;
    const pitchDrive = 0.4 * gl + 0.18 * tr * amp + 0.12 * rage - 0.1 * w + Math.sin(t * 1.7) * 0.03;
    for (let i = 0; i < 3; i++) {
      const kS = 140 - i * 30, cS = 9;
      const parentY = i === 0 ? yawDrive * 0.6 : this.tail[(i - 1) * 2];
      const parentX = i === 0 ? pitchDrive * 0.5 : this.tail[(i - 1) * 2 + 1] * 0.8;
      const ty = parentY * (i === 0 ? 1 : 1.05), tx = parentX + (i === 0 ? 0 : pitchDrive * 0.25);
      this.tailV[i * 2] += (kS * (ty - this.tail[i * 2]) - cS * this.tailV[i * 2]) * dt;
      this.tailV[i * 2 + 1] += (kS * (tx - this.tail[i * 2 + 1]) - cS * this.tailV[i * 2 + 1]) * dt;
      this.tail[i * 2] = clamp(this.tail[i * 2] + this.tailV[i * 2] * dt, -1.2, 1.2);
      this.tail[i * 2 + 1] = clamp(this.tail[i * 2 + 1] + this.tailV[i * 2 + 1] * dt, -0.8, 1.2);
      this.rot('tail' + (i + 1), this.tail[i * 2 + 1], this.tail[i * 2], 0);
    }
    // ---------------------------------------------------------------- squash spring (bounces, landings)
    this.sqV += (-170 * this.sq - 11 * this.sqV) * dt;
    this.sq += this.sqV * dt;
    const q = clamp(this.sq, -0.45, 0.45);
    this.rig.root.scale.set(1 - q * 0.45, 1 + q, 1 - q * 0.45);
  }
}
