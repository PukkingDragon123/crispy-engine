// THOTH, keeper of the Hall: a tiny ibis-headed god, ten thousand years old, who
// talks like a child and collects every creature the hunter meets.
//
// The look (sculpted on one shared rig space with the organic creature kit):
//   - a big round head of soft white down with chubby cheeks, a long, gently
//     down-curved ibis beak (charcoal horn with a lighter tip, a nasal groove and
//     a real gape: the lower mandible is its own part), and huge glossy modelled
//     eyes (amber irises, deep pupils, two catchlights) lined with kohl that flicks
//     back toward the temples; feathered upper lids are their own parts and blink;
//   - a lapis tripartite wig flecked with gold, banded lappets over the chest, a
//     thin gold diadem with a little scroll tucked behind it;
//   - a crown of a gold crescent cradling a small silver moon (with its maria),
//     on a flared gold modius with lapis inlay;
//   - a chubby feathered body with scalloped plumage, a broad bead collar (gold,
//     lapis, carnelian, turquoise and drop beads), small folded wings with black
//     primaries and a black lacy tail bustle, like a sacred ibis;
//   - a pleated linen scribe's kilt with an inlaid gold belt, a carnelian tyet knot
//     and a pleated apron tab; a scribe's palette (ink wells, spare reeds) and a
//     rolled scroll tucked into the belt;
//   - stubby feathered thighs, grey scaly shins and chubby three-toed bird feet;
//   - slate-grey hands: the left holds a half-unrolled scroll of inked columns, the
//     right a reed pen.
//
// RIG (faces +Z, LEFT = +X, origin on the ground between the feet, 1/192 m):
//   pelvis (root) → torso → head → beak → jaw; head → eye_l / eye_r, lid_l / lid_r
//   (upper lids, rest rotation keeps them open: blink = rotate +X by up to
//   meta.blink.close), crown
//   torso → arm_l → fore_l → scroll; torso → arm_r → fore_r → pen
//   torso → wing_l, wing_r; pelvis → apron, tail
//   pelvis → thigh_l → shin_l → foot_l (and _r)
// Sockets: nib (pen tip), hand_l, hand_r, scroll (sheet centre, +Z out),
// head_top, beak_tip, chest.
// Animate with ThothAnim (bottom of this file): idle, run, hop, write, gasp,
// delight, stoptime, wave, think.
import * as THREE from 'three';
import type { RigInstance } from '../../../engine/voxel/Rig';
import { CRig, VoxelModel, VF, blob, ell, cap, tube, line, paint, exposed, thicken, splitInto, finish, mixc, mulc, n01, h01, wetEye, add3, sub3, scl3, norm3, cross3, dot3, sstep, clamp01 } from '../creatures/ckit';
import type { V3, RigSpec, Col } from '../creatures/ckit';

// ------------------------------------------------------------------ grid
const VS = 1 / 192;
const K = 1 / VS;
const U = (m: number) => m * K;
const P = (x: number, y: number, z: number): V3 => [x * K, y * K, z * K];
const Pv = (v: V3): V3 => [v[0] * K, v[1] * K, v[2] * K];
/** voxel index -> design metres at the cell centre */
const D = (i: number) => (i + 0.5) / K;
const mirX = (v: V3): V3 => [-v[0], v[1], v[2]];

// ------------------------------------------------------------------ palette
const C = {
  white: 0xf3f1ea,
  whiteL: 0xfdfcf8,
  whiteS: 0xd9d6ce,
  whiteD: 0xb9b5ac,
  blush: 0xf4cfc0,
  plume: 0x2a2832,
  plumeL: 0x444a60,
  plumeS: 0x1a1820,
  sheen: 0x2f4c5e,
  beak: 0x3a3532,
  beakL: 0x5f5650,
  beakD: 0x221e1d,
  beakTip: 0x857868,
  skin: 0x4f505c,
  skinL: 0x6c6e7c,
  skinD: 0x34353e,
  claw: 0x1c1a1e,
  lapis: 0x2a4ea6,
  lapisL: 0x4a74d0,
  lapisS: 0x1d387c,
  lapisD: 0x13295c,
  fleck: 0xe6c060,
  gold: 0xe8b84a,
  goldL: 0xffe38c,
  goldS: 0xb8862e,
  goldD: 0x8a5e1c,
  carn: 0xc4512e,
  carnD: 0x8e3420,
  turq: 0x3cbcae,
  turqD: 0x23887e,
  linen: 0xeee0c2,
  linenS: 0xd3c09a,
  linenD: 0xb39c74,
  papyrus: 0xead7a3,
  papyrusS: 0xcfb57c,
  papyrusD: 0xa88c56,
  ink: 0x2a1c14,
  red: 0xa83a24,
  reed: 0xcaa362,
  reedS: 0x9c7a40,
  reedD: 0x6a5026,
  wood: 0xa0703e,
  woodS: 0x7e5430,
  woodL: 0xbe8c52,
  moon: 0xe9eef7,
  moonS: 0xbcc8dc,
  moonD: 0x8e9db8,
  kohl: 0x15131b,
};
/** the beak gape, the inside of the mouth */
const MOUTH = { line: 0x1a1414, in: 0x9a4c48 };

// ------------------------------------------------------------------ skeleton (design metres)
const J = {
  pelvis: [0, 0.165, 0] as V3,
  torso: [0, 0.215, 0] as V3,
  head: [0, 0.345, 0.002] as V3,
  beak: [0, 0.444, 0.098] as V3,
  jaw: [0, 0.437, 0.1] as V3,
  eye: [0.058, 0.493, 0.089] as V3,
  crown: [0, 0.598, -0.012] as V3,
  shoulder: [0.072, 0.304, 0] as V3,
  elbow: [0.098, 0.25, 0.02] as V3,
  wrist: [0.086, 0.207, 0.07] as V3,
  fist: [0.085, 0.197, 0.09] as V3,
  hip: [0.042, 0.168, 0] as V3,
  knee: [0.047, 0.098, 0.012] as V3,
  ankle: [0.047, 0.036, -0.004] as V3,
  tail: [0, 0.2, -0.068] as V3,
  wing: [0.05, 0.302, -0.056] as V3,
};
const HC: V3 = [0, 0.474, 0];
const HR: V3 = [0.128, 0.12, 0.116];
const EYE_R = 0.035;
const CUT_WAIST = 0.215;
/** the gaze of the left eye (slightly outward, a touch down: a curious little face) */
const GAZE: V3 = norm3([0.27, -0.02, 1]);
/** reed pen: direction from the fist up to the nib, and its length past the fist */
const PEN_DIR: V3 = norm3([0.14, 0.82, 0.46]);
const PEN_LEN = 0.078;
/** upper lids: rest rotation (open) and the extra rotation that shuts them */
const LID_REST = -1.12;
const LID_CLOSE = 1.72;

// ------------------------------------------------------------------ helpers
/** fill every cell whose centre (design metres) has f <= 0 */
function sdf(m: VoxelModel, lo: V3, hi: V3, f: (x: number, y: number, z: number) => number, col: Col, fl?: number) {
  for (let i = Math.floor(U(lo[0])); i <= Math.ceil(U(hi[0])); i++)
    for (let j = Math.floor(U(lo[1])); j <= Math.ceil(U(hi[1])); j++)
      for (let k = Math.floor(U(lo[2])); k <= Math.ceil(U(hi[2])); k++) {
        if (f(D(i), D(j), D(k)) > 0) continue;
        const c = typeof col === 'number' ? col : col(i, j, k);
        if (c !== null) m.set(i, j, k, c, fl);
      }
}
/** rounded box distance in a local frame (half extents b, corner radius r) */
function rbox(p: V3, b: V3, r: number) {
  const qx = Math.abs(p[0]) - b[0] + r, qy = Math.abs(p[1]) - b[1] + r, qz = Math.abs(p[2]) - b[2] + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0) - r;
}
/** distance from p to segment ab, and the parameter along it */
function segD(p: V3, a: V3, b: V3): [number, number] {
  const d = sub3(b, a);
  const t = clamp01(dot3(sub3(p, a), d) / (dot3(d, d) || 1e-9));
  const q = add3(a, scl3(d, t));
  return [Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]), t];
}
/** a rolled papyrus: a tapered roll whose ends show the spiral of the sheet, an optional cord */
function rolledScroll(m: VoxelModel, a: V3, b: V3, r: number, o: { cord?: number; cordAt?: number; spiralEnds?: [boolean, boolean] } = {}) {
  const d = norm3(sub3(b, a));
  const L = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const ends = o.spiralEnds ?? [true, true];
  const lo: V3 = [Math.min(a[0], b[0]) - r - 0.004, Math.min(a[1], b[1]) - r - 0.004, Math.min(a[2], b[2]) - r - 0.004];
  const hi: V3 = [Math.max(a[0], b[0]) + r + 0.004, Math.max(a[1], b[1]) + r + 0.004, Math.max(a[2], b[2]) + r + 0.004];
  sdf(m, lo, hi, (x, y, z) => {
    const p = sub3([x, y, z], a);
    const t = dot3(p, d);
    if (t < 0 || t > L) return 1;
    const q = sub3(p, scl3(d, t));
    const rr = Math.hypot(q[0], q[1], q[2]);
    // the outer turn of the sheet sags a little off the roll
    return rr - r * (1 + 0.06 * Math.sin(t * 900));
  }, (i, j, k) => {
    const p = sub3([D(i), D(j), D(k)], a);
    const t = dot3(p, d);
    const q = sub3(p, scl3(d, t));
    const rr = Math.hypot(q[0], q[1], q[2]) / r;
    const end = (t < 0.0035 && ends[0]) || (t > L - 0.0035 && ends[1]);
    if (end) {
      // the spiral: light sheet edge and dark gaps winding in to the core
      const ang = Math.atan2(q[1], q[0] + 1e-9);
      const s = (rr * 3.2 + ang / (Math.PI * 2)) % 1;
      return rr < 0.22 ? C.papyrusD : s < 0.38 ? C.papyrusD : C.papyrusS;
    }
    if (o.cord !== undefined && Math.abs(t - L * (o.cordAt ?? 0.5)) < 0.0032) return o.cord;
    const fib = n01(i * 3, j * 3, k * 3, 0.4, 5) > 0.62;
    return fib ? C.papyrusS : h01(i, j, k, 8) < 0.06 ? mixc(C.papyrus, 0xffffff, 0.3) : C.papyrus;
  });
  if (o.cord !== undefined) {
    // the cord sits proud of the roll with a knot and two short tails
    const c = add3(a, scl3(d, L * (o.cordAt ?? 0.5)));
    const side = norm3(cross3(d, [0, 0, 1]).some((v) => Math.abs(v) > 1e-3) ? cross3(d, [0, 0, 1]) : [1, 0, 0]);
    ell(m, Pv(add3(c, scl3(side, r * 1.05))), [U(0.0034), U(0.0034), U(0.0034)], mulc(o.cord, 0.85));
    const t0 = add3(c, scl3(side, r * 1.3));
    line(m, [Pv(t0), Pv(add3(t0, add3(scl3(side, 0.005), [0, -0.012, 0.002])))], o.cord);
    line(m, [Pv(t0), Pv(add3(t0, add3(scl3(side, 0.002), [0.003, -0.01, -0.003])))], mulc(o.cord, 0.8));
  }
}

// ------------------------------------------------------------------ colour fields
/** scalloped contour feathers around the body, soft down on the belly */
function plumage(seed: number, belly = true) {
  return (i: number, j: number, k: number) => {
    const X = D(i), Y = D(j), Z = D(k);
    const a = Math.atan2(X, Z);
    const u = (a * 0.078) / 0.021;
    const v = Y / 0.0165;
    const row = Math.floor(v);
    const uu = u + (row & 1) * 0.5;
    const fu = uu - Math.floor(uu) - 0.5;
    const fv = v - row;
    const edge = 0.12 + fu * fu * 1.55;
    const n = n01(i, j, k, 0.16, seed);
    let c = C.white;
    if (fv < edge && fv > edge - 0.26) c = mixc(C.white, C.whiteS, 0.75);
    else if (fv >= edge && fv < edge + 0.14) c = mixc(C.white, C.whiteL, 0.7);
    // fluffy down on the round belly: no scallops, just soft clumps
    const front = Math.cos(a);
    if (belly && front > 0.45 && Y > 0.165 && Y < 0.285) {
      const w = sstep(0.45, 0.75, front) * (1 - sstep(0.26, 0.285, Y));
      c = mixc(c, n > 0.6 ? C.whiteL : n < 0.36 ? mixc(C.white, C.whiteS, 0.5) : C.white, w);
    } else if (n > 0.7) c = mixc(c, C.whiteL, 0.5);
    else if (n < 0.28) c = mixc(c, C.whiteS, 0.3);
    return c;
  };
}
/** soft white down on the head: lighter on the face, a faint blush on the cheeks */
function headDown(seed: number) {
  return (i: number, j: number, k: number) => {
    const X = D(i), Y = D(j), Z = D(k);
    const n = n01(i, j, k, 0.2, seed);
    let c = n > 0.64 ? C.whiteL : n < 0.32 ? mixc(C.white, C.whiteS, 0.45) : C.white;
    if (Z > 0.06) c = mixc(c, C.whiteL, 0.35);
    for (const s of [1, -1]) {
      const d = Math.hypot(X - 0.07 * s, Y - 0.437, (Z - 0.082) * 1.2);
      if (d < 0.026) c = mixc(c, C.blush, 0.55 * (1 - sstep(0.012, 0.026, d)));
    }
    return c;
  };
}
/** black ibis plumes with a faint blue-green sheen */
function plumeCol(seed: number) {
  return (i: number, j: number, k: number) => {
    const n = n01(i, j, k, 0.3, seed);
    if (n > 0.66) return mixc(C.plume, C.sheen, 0.6);
    if (n < 0.3) return C.plumeS;
    return h01(i, j, k, seed) < 0.05 ? C.plumeL : C.plume;
  };
}
/** lapis wig strands: alternating hanks, a light crown, rare gold flecks of pyrite */
function lapisHair(seed: number) {
  return (i: number, j: number, k: number) => {
    const X = D(i), Y = D(j), Z = D(k);
    const a = Math.atan2(X, Z - 0.0);
    const strand = Math.floor((a * 0.12) / 0.0085 + n01(i, j, k, 0.12, seed) * 0.8);
    let c = strand & 1 ? C.lapis : C.lapisS;
    if (Y > 0.57) c = mixc(c, C.lapisL, 0.35);
    if (Y < 0.4) c = mixc(c, C.lapisD, 0.3);
    if (h01(i, j, k, seed + 3) < 0.012) c = C.fleck;
    return c;
  };
}

// ------------------------------------------------------------------ builder
function buildThoth(): RigSpec {
  const rig = new CRig('thoth', VS);
  const seed = 7;

  // ================================================================ body: one sculpt, split at the waist
  const bodyMass = new VoxelModel('bodyMass');
  blob(bodyMass, [
    { c: P(0, 0.238, 0.012), r: P(0.084, 0.086, 0.08) }, // round belly
    { c: P(0, 0.29, -0.004), r: P(0.07, 0.052, 0.062) }, // chest
    { c: P(0, 0.183, -0.008), r: P(0.07, 0.05, 0.064) }, // hips
    { c: P(0.056, 0.296, -0.006), r: P(0.03, 0.026, 0.03) }, // shoulder caps
    { c: P(-0.056, 0.296, -0.006), r: P(0.03, 0.026, 0.03) },
    { a: P(0, 0.31, -0.004), b: P(0, 0.372, 0), r0: U(0.04), r1: U(0.034) }, // neck
  ], plumage(seed), {
    k: U(0.02),
    disp: (x, y, z) => (n01(x, y, z, 0.3, seed + 1) - 0.5) * 0.55,
    keep: (_x, y) => D(y) < 0.37 && D(y) > 0.128,
  });
  const pelvis = rig.part('pelvis', undefined, P(...J.pelvis));
  const torso = rig.part('torso', 'pelvis', P(...J.torso));
  splitInto(bodyMass, pelvis, torso, (_x, y) => D(y) >= CUT_WAIST, (_x, y) => D(y) >= CUT_WAIST - 0.014);

  buildKilt(rig);
  buildCollar(torso);
  buildBeltKit(pelvis);

  // ================================================================ head
  const headMass = new VoxelModel('headMass');
  blob(headMass, [
    { c: P(...HC), r: P(...HR) }, // the big round cranium
    { c: P(0, 0.468, -0.03), r: P(0.118, 0.11, 0.1) }, // back of the skull
    { c: P(0.064, 0.432, 0.058), r: P(0.05, 0.044, 0.046) }, // chubby cheeks
    { c: P(-0.064, 0.432, 0.058), r: P(0.05, 0.044, 0.046) },
    { c: P(0, 0.442, 0.086), r: P(0.034, 0.03, 0.03) }, // beak root mound
    { a: P(0, 0.345, -0.004), b: P(0, 0.4, 0), r0: U(0.036), r1: U(0.06) }, // neck join
  ], headDown(seed + 2), { k: U(0.024), disp: (x, y, z) => (n01(x, y, z, 0.36, seed + 3) - 0.5) * 0.5 });
  const head = rig.part('head', 'torso', P(...J.head));
  headMass.forEach((x, y, z, c, f) => head.set(x, y, z, c, f));

  // ---- eyes: carved sockets, kohl liner with a flick toward the temples, glossy globes
  const eyeC = P(...J.eye);
  for (const e of [eyeC, mirX(eyeC)]) ell(head, e, [U(EYE_R) * 1.03, U(EYE_R) * 1.03, U(EYE_R) * 1.03], 0, { carve: true });
  for (const s of [1, -1]) {
    const e = s > 0 ? eyeC : mirX(eyeC);
    const R = U(EYE_R);
    paint(head, (x, y, z) => {
      if (!exposed(head, x, y, z)) return false;
      const d = Math.hypot(x + 0.5 - e[0], y + 0.5 - e[1], z + 0.5 - e[2]);
      return d > R * 1.0 && d < R + 1.05;
    }, C.kohl);
    // the flick: a tapered stroke back toward the temple, rising a little
    const a = add3(J.eye, [0.03 * s, 0.006, -0.024]) as V3;
    const b = add3(J.eye, [0.056 * s, 0.017, -0.056]) as V3;
    paint(head, (x, y, z) => {
      if (!exposed(head, x, y, z)) return false;
      const [d, t] = segD([D(x), D(y), D(z)], a, b);
      return d < 0.0052 * (1 - t * 0.7);
    }, C.kohl);
  }
  const eyeL = rig.part('eye_l', 'head', eyeC);
  wetEye(eyeL, eyeC, U(EYE_R), GAZE, { sclera: 0x1a110c, iris: 0x9a6224, irisEdge: 0x3a2210, pupil: 0x070405, irisR: 0.92, pupilR: 0.56, bigGlint: 2 });
  rig.mirror('eye_l', 'eye_r');

  // ---- upper lids: feathered shells around the globe with a dark lash line on the leading edge
  {
    const lid = rig.part('lid_l', 'head', eyeC, [LID_REST, 0, 0]);
    const R = U(EYE_R);
    const lo = R + 0.45, hi = R + 1.9;
    for (let i = Math.floor(eyeC[0] - hi - 1); i <= Math.ceil(eyeC[0] + hi + 1); i++)
      for (let j = Math.floor(eyeC[1] - hi - 1); j <= Math.ceil(eyeC[1] + hi + 1); j++)
        for (let k = Math.floor(eyeC[2] - hi - 1); k <= Math.ceil(eyeC[2] + hi + 1); k++) {
          const px = i + 0.5 - eyeC[0], py = j + 0.5 - eyeC[1], pz = k + 0.5 - eyeC[2];
          const d = Math.hypot(px, py, pz);
          if (d < lo || d > hi) continue;
          // arc from the front equator over the top to a little behind it (lid space: +Z front, +Y up)
          const th = Math.atan2(py, pz);
          if (th < -0.02 || th > 1.95) continue;
          if (Math.abs(px) > R * 1.05) continue;
          const lash = th < 0.2;
          lid.set(i, j, k, lash ? C.kohl : th < 0.36 ? mixc(C.white, C.whiteS, 0.6) : h01(i, j, k, 4) < 0.1 ? C.whiteL : C.white, lash ? VF.SOLID : VF.SOFTAO);
        }
    rig.mirror('lid_l', 'lid_r');
  }

  // ---- the wig: lapis hanks over the back and top of the head, lappets over the chest
  {
    const wigZone = (x: number, y: number, z: number) => {
      const X = D(x), Y = D(y), Z = D(z);
      const a = Math.abs(Math.atan2(X, Z));
      return Y > 0.538 + 0.022 * Math.cos(a) || (a > 1.22 && Y > 0.39) || (a > 1.45);
    };
    const hair = lapisHair(seed + 4);
    paint(head, (x, y, z) => wigZone(x, y, z) && exposed(head, x, y, z), hair);
    for (let layer = 0; layer < 2; layer++)
      thicken(head, (x, y, z) => wigZone(x, y, z) && exposed(head, x, y, z) && D(y) > 0.37, (x, y, z) => (D(y) < 0.37 ? null : hair(x, y, z)), [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, 0, 1], [0, 0, -1]]);
    // the back fall behind the nape
    blob(head, [
      { c: P(0, 0.418, -0.066), r: P(0.098, 0.068, 0.052) },
      { c: P(0, 0.38, -0.07), r: P(0.08, 0.036, 0.042) },
    ], hair, { k: U(0.02), keep: (_x, y, z) => D(z) < -0.03 && D(y) > 0.335, under: true });
    // lappets: two banded hanks falling in front of the shoulders
    for (const s of [1, -1]) {
      blob(head, [
        { a: P(0.104 * s, 0.452, -0.022), b: P(0.104 * s, 0.39, 0.02), r0: U(0.03), r1: U(0.028) },
        { a: P(0.104 * s, 0.39, 0.02), b: P(0.094 * s, 0.322, 0.042), r0: U(0.028), r1: U(0.022) },
      ], hair, { k: U(0.01), keep: (x) => D(x) * s > 0.072, under: true });
      // two gold bands near the ends
      paint(head, (x, y, z) => {
        const X = D(x) * s, Y = D(y);
        return X > 0.07 && exposed(head, x, y, z) && D(z) > -0.01 && ((Y > 0.334 && Y < 0.341) || (Y > 0.346 && Y < 0.351));
      }, (x, y, z) => (h01(x, y, z, 2) < 0.2 ? C.goldL : C.gold), VF.METAL);
    }
    // the diadem: a thin gold band along the wig's front edge
    paint(head, (x, y, z) => {
      if (!wigZone(x, y, z) || !exposed(head, x, y, z)) return false;
      if (D(z) < 0.0 || D(y) < 0.45) return false;
      for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, -1, 0], [0, 0, 1]] as V3[]) {
        const nx = x + dx, ny = y + dy, nz = z + dz;
        if (head.has(nx, ny, nz) && !wigZone(nx, ny, nz)) return true;
      }
      return false;
    }, C.gold, VF.METAL);
    // a little scroll tucked behind the band on his right temple
    rolledScroll(head, [-0.117, 0.478, -0.012], [-0.127, 0.545, -0.072], 0.0094, { cord: C.red, cordAt: 0.32 });
  }

  // ================================================================ beak + jaw (one sculpt, split along the gape)
  {
    const BP: V3[] = [[0, 0.444, 0.08], [0, 0.442, 0.128], [0, 0.428, 0.178], [0, 0.404, 0.222], [0, 0.372, 0.252], [0, 0.34, 0.265]];
    const BR = [0.031, 0.0235, 0.018, 0.0128, 0.008, 0.0042];
    const beakMass = new VoxelModel('beakMass');
    // centre line height and radius at a given depth (for colouring and the gape)
    const along = (Z: number) => {
      for (let i = 0; i < BP.length - 1; i++) {
        const a = BP[i], b = BP[i + 1];
        if (Z <= b[2] || i === BP.length - 2) {
          const t = clamp01((Z - a[2]) / (b[2] - a[2] || 1e-6));
          return { y: a[1] + (b[1] - a[1]) * t, r: BR[i] + (BR[i + 1] - BR[i]) * t, t: (i + t) / (BP.length - 1) };
        }
      }
      return { y: BP[0][1], r: BR[0], t: 0 };
    };
    const beakCol = (i: number, j: number, k: number) => {
      const X = D(i), Y = D(j), Z = D(k);
      const a = along(Z);
      const h = (Y - a.y) / Math.max(a.r, 0.002);
      let c = mixc(C.beak, C.beakTip, sstep(0.45, 1, a.t));
      if (h > 0.62) c = mixc(c, C.beakL, 0.6); // the culmen catches the light
      else if (h < -0.55) c = mixc(c, C.beakD, 0.5);
      // the nasal groove running along each side of the upper mandible
      if (Math.abs(h - 0.18) < 0.16 && Math.abs(X) > a.r * 0.55 && a.t > 0.06 && a.t < 0.7) c = C.beakD;
      if (h01(i, j, k, 11) < 0.05) c = mixc(c, C.beakL, 0.3);
      return c;
    };
    for (let i = 0; i < BP.length - 1; i++) cap(beakMass, Pv(BP[i]), Pv(BP[i + 1]), U(BR[i]), U(BR[i + 1]), beakCol);
    // a slightly hooked tip on the upper mandible
    ell(beakMass, P(0, 0.338, 0.266), [U(0.0048), U(0.006), U(0.0052)], C.beakTip);
    const beak = rig.part('beak', 'head', P(...J.beak));
    const jaw = rig.part('jaw', 'beak', P(...J.jaw));
    splitInto(beakMass, beak, jaw, (_x, y, z) => {
      const Z = D(z);
      if (Z > 0.25 || Z < 0.095) return false;
      const a = along(Z);
      return D(y) < a.y - a.r * 0.22;
    });
    // the gape: a dark line where the mandibles meet, pink inside
    const empty = (x: number, y: number, z: number) => !beak.has(x, y, z) && !jaw.has(x, y, z);
    const top: V3[] = [];
    jaw.forEach((x, y, z) => {
      if (!jaw.has(x, y + 1, z)) top.push([x, y, z]);
    });
    for (const [x, y, z] of top) jaw.set(x, y, z, empty(x + 1, y, z) || empty(x - 1, y, z) || empty(x, y, z + 1) ? MOUTH.line : MOUTH.in);
    beak.forEach((x, y, z) => {
      if (jaw.has(x, y - 1, z)) beak.set(x, y, z, empty(x + 1, y, z) || empty(x - 1, y, z) ? MOUTH.line : MOUTH.in);
    });
  }

  // ================================================================ crown: a gold crescent cradling the moon
  {
    const crown = rig.part('crown', 'head', P(...J.crown));
    const cy = 0.598, cz = -0.012;
    // the modius: a short flared gold drum, rope rims and a band of lapis inlay
    sdf(crown, [-0.05, cy - 0.006, cz - 0.05], [0.05, cy + 0.022, cz + 0.05], (x, y, z) => {
      const t = clamp01((y - cy) / 0.02);
      const r = 0.031 + 0.009 * t * t;
      return Math.hypot(x, (z - cz) * 1.05) - r;
    }, (i, j, k) => {
      const Y = D(j) - cy;
      const a = Math.atan2(D(i), D(k) - cz);
      if (Y < 0.004 || Y > 0.017) return (Math.floor(a * 9) + j) & 1 ? C.goldS : C.goldL; // twisted rope rims
      return Math.floor(a * 4.5 + 0.5) & 1 ? C.lapis : C.gold;
    }, VF.METAL);
    // the crescent: horns up, a rounded edge, light along its outer rim
    const cc: V3 = [0, 0.668, cz];
    sdf(crown, [-0.085, 0.6, cz - 0.012], [0.085, 0.72, cz + 0.012], (x, y, z) => {
      const d1 = Math.hypot(x - cc[0], y - cc[1]) - 0.074;
      const d2 = Math.hypot(x - cc[0], y - (cc[1] + 0.024)) - 0.064;
      const d2d = Math.max(d1, -d2);
      const zt = Math.abs(z - cz) - 0.0075;
      return Math.hypot(Math.max(d2d + 0.003, 0), Math.max(zt + 0.003, 0)) + Math.min(Math.max(d2d, zt), 0) - 0.003;
    }, (i, j, k) => {
      const x = D(i), y = D(j);
      const rr = Math.hypot(x - cc[0], y - cc[1]);
      if (rr > 0.0705) return C.goldL;
      if (Math.abs(D(k) - cz) > 0.0055) return C.goldS;
      return h01(i, j, k, 5) < 0.08 ? C.goldL : C.gold;
    }, VF.METAL);
    // the moon: a silver lens with its maria and a fine glowing rim line
    const mc: V3 = [0, 0.684, cz];
    const MR = 0.054;
    sdf(crown, [-MR - 0.004, mc[1] - MR - 0.004, cz - 0.016], [MR + 0.004, mc[1] + MR + 0.004, cz + 0.016], (x, y, z) => {
      const r = Math.hypot(x - mc[0], y - mc[1]) / MR;
      if (r > 1) return 1;
      return Math.abs(z - cz) - (0.0035 + 0.0085 * Math.pow(1 - r * r, 0.45));
    }, (i, j, k) => {
      const x = D(i) - mc[0], y = D(j) - mc[1];
      const r = Math.hypot(x, y) / MR;
      if (r > 0.86 && r < 0.93 && Math.abs(D(k) - cz) > 0.004) return C.goldL;
      const sea = n01(i * 1.6, j * 1.6, 0, 0.12, 31);
      let c = mixc(C.moon, C.moonS, sstep(-0.3, 0.9, (-x + y * 0.6) / MR * -1) * 0.5);
      if (sea > 0.62) c = mixc(c, C.moonD, 0.55);
      else if (sea > 0.55) c = mixc(c, C.moonS, 0.5);
      if (h01(i, j, k, 9) < 0.03) c = mixc(c, 0xffffff, 0.6);
      return c;
    }, VF.METAL);
    // the rim line glows faintly (moonlight), nothing else does
    paint(crown, (x, y, z) => {
      const r = Math.hypot(D(x) - mc[0], D(y) - mc[1]) / MR;
      return r > 0.86 && r < 0.93 && Math.abs(D(z) - cz) > 0.004 && exposed(crown, x, y, z);
    }, 0xfff2c4, VF.EMISSIVE | VF.METAL);
  }

  // ================================================================ arms (sculpted in their holding pose)
  {
    const SH = P(...J.shoulder), EL = P(...J.elbow), WR = P(...J.wrist), FI = P(...J.fist);
    const arm = rig.part('arm_l', 'torso', SH);
    const armCol = plumage(seed + 6, false);
    cap(arm, add3(SH, P(-0.008, 0.006, 0)), EL, U(0.026), U(0.02), armCol);
    ell(arm, add3(SH, P(0.004, 0.0, -0.002)), P(0.03, 0.028, 0.03), armCol, { under: true });
    // a gold armlet with a lapis line round the upper arm
    {
      const a = Pv(add3(J.shoulder, [0.0, 0.0, 0.0])), b = EL;
      const band = (x: number, y: number, z: number) => {
        const [, t] = segD([x + 0.5, y + 0.5, z + 0.5], a, b);
        return t > 0.56 && t < 0.72;
      };
      thicken(arm, (x, y, z) => band(x, y, z) && exposed(arm, x, y, z), (x, y, z) => {
        const [, t] = segD([x + 0.5, y + 0.5, z + 0.5], a, b);
        return t > 0.61 && t < 0.67 ? C.lapis : C.gold;
      }, [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]], VF.METAL);
    }
    const fore = rig.part('fore_l', 'arm_l', EL);
    cap(fore, EL, WR, U(0.0205), U(0.0165), armCol);
    // the wrist cuff: gold with lapis inlay
    {
      const band = (x: number, y: number, z: number) => {
        const [, t] = segD([x + 0.5, y + 0.5, z + 0.5], EL, WR);
        return t > 0.7;
      };
      thicken(fore, (x, y, z) => band(x, y, z) && exposed(fore, x, y, z), (x, y, z) => ((x + y + z) % 4 === 0 ? C.lapis : C.gold), [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0]], VF.METAL);
    }
    // the hand: a little slate-grey fist curled round a roll (axis along X)
    const skin = (i: number, j: number, k: number) => (h01(i, j, k, 13) < 0.1 ? C.skinL : n01(i, j, k, 0.4, 2) < 0.35 ? C.skinD : C.skin);
    ell(fore, FI, P(0.0165, 0.0185, 0.0155), skin);
    ell(fore, add3(FI, P(0.002, 0.012, -0.006)), P(0.013, 0.01, 0.012), skin);
    for (let f = 0; f < 3; f++) {
      const fx = J.fist[0] - 0.009 + f * 0.0088;
      tube(fore, [P(fx, 0.205, 0.099), P(fx, 0.2, 0.111), P(fx, 0.189, 0.107)], [U(0.0058), U(0.0055), U(0.005)], skin);
      fore.set(Math.floor(U(fx)), Math.floor(U(0.1875)), Math.floor(U(0.105)), C.claw);
    }
    tube(fore, [P(J.fist[0] - 0.015, 0.204, 0.087), P(J.fist[0] - 0.017, 0.205, 0.1), P(J.fist[0] - 0.011, 0.206, 0.108)], [U(0.0062), U(0.0056), U(0.005)], skin);

    // the scroll in the left hand: a top roll, a sheet of inked columns hanging down, a lower roll
    const scroll = rig.part('scroll', 'fore_l', FI);
    const top: V3 = [J.fist[0], J.fist[1], J.fist[2] + 0.004];
    rolledScroll(scroll, [top[0] - 0.044, top[1], top[2]], [top[0] + 0.042, top[1], top[2]], 0.0102);
    const sx0 = top[0] - 0.038, sx1 = top[0] + 0.036, sy0 = 0.13, sy1 = top[1] - 0.006;
    const sheetZ = (x: number, y: number) => top[2] + 0.006 + 0.0035 * Math.sin((x - sx0) * 120) * sstep(sy1, sy0, y) + (sy1 - y) * 0.06;
    for (let i = Math.floor(U(sx0)); i <= Math.ceil(U(sx1)); i++)
      for (let j = Math.floor(U(sy0)); j <= Math.ceil(U(sy1)); j++) {
        const X = D(i), Y = D(j);
        const z = Math.floor(U(sheetZ(X, Y)));
        // the writing: columns of glyph strokes between ruled lines, a red rubric at the top
        const cx = Math.floor((X - sx0) / 0.0118), cyy = Math.floor((sy1 - Y) / 0.0094);
        const lx = (X - sx0) / 0.0118 - cx, ly = (sy1 - Y) / 0.0094 - cyy;
        let col = h01(i, j, 3, 2) < 0.08 ? C.papyrusS : C.papyrus;
        if (lx > 0.9) col = mixc(C.papyrus, C.papyrusD, 0.45); // ruled column lines
        else if (lx > 0.18 && lx < 0.72 && ly > 0.12 && ly < 0.82) {
          const g = h01(cx, cyy, 7, 21);
          const mark = g < 0.3 ? (ly > 0.3 && ly < 0.65) : g < 0.55 ? lx < 0.45 : g < 0.8 ? (lx + ly) % 0.5 < 0.25 : false;
          if (mark) col = cyy === 0 ? C.red : C.ink;
        }
        scroll.set(i, j, z, col, VF.SOFTAO);
        scroll.set(i, j, z - 1, C.papyrusS, VF.SOFTAO);
      }
    rolledScroll(scroll, [sx0 - 0.004, sy0 - 0.002, sheetZ(sx0, sy0) - 0.006], [sx1 + 0.004, sy0 - 0.002, sheetZ(sx1, sy0) - 0.006], 0.0085, { cord: C.red, cordAt: 0.85 });

    rig.mirror('arm_l', 'arm_r');
    rig.mirror('fore_l', 'fore_r', 'arm_r');

    // the reed pen in the right fist: node rings, an ink-stained cut nib
    const FR = mirX(J.fist);
    const pen = rig.part('pen', 'fore_r', Pv(FR));
    const pa = add3(FR, scl3(PEN_DIR, -0.022)) as V3, pb = add3(FR, scl3(PEN_DIR, PEN_LEN)) as V3;
    const penL = PEN_LEN + 0.022;
    sdf(pen, [Math.min(pa[0], pb[0]) - 0.008, Math.min(pa[1], pb[1]) - 0.008, Math.min(pa[2], pb[2]) - 0.008], [Math.max(pa[0], pb[0]) + 0.008, Math.max(pa[1], pb[1]) + 0.008, Math.max(pa[2], pb[2]) + 0.008], (x, y, z) => {
      const [d, t] = segD([x, y, z], pa, pb);
      const r = t > 0.88 ? 0.0045 * (1 - (t - 0.88) / 0.12) + 0.0012 : 0.0046;
      return d - r;
    }, (i, j, k) => {
      const [, t] = segD([D(i), D(j), D(k)], pa, pb);
      const L = t * penL;
      if (t > 0.86) return C.ink;
      if (Math.abs(((L + 0.004) % 0.03) - 0.015) < 0.0016) return C.reedD; // nodes
      return h01(i, j, k, 6) < 0.15 ? C.reedS : C.reed;
    });
  }

  // ================================================================ wings: small, folded, black primaries
  {
    const W = J.wing;
    const wing = rig.part('wing_l', 'torso', Pv(W));
    const wc = (i: number, j: number, k: number) => {
      const Y = D(j);
      const tip = sstep(0.245, 0.205, Y);
      const row = Math.floor((0.31 - Y) / 0.014);
      const fv = ((0.31 - Y) / 0.014) % 1;
      let c = fv > 0.82 ? C.whiteS : h01(i, j, k, 2) < 0.08 ? C.whiteL : C.white;
      if (tip > 0.5) c = (row + Math.floor(D(k) * 260)) & 1 ? C.plume : mixc(C.plume, C.sheen, 0.5);
      else if (tip > 0.15 && fv < 0.4) c = mixc(c, C.plume, 0.6);
      return c;
    };
    blob(wing, [
      { c: P(W[0] + 0.012, 0.272, W[2] - 0.018), r: P(0.014, 0.036, 0.03), rot: [0.25, 0.75, 0] },
      { c: P(W[0] + 0.018, 0.222, W[2] - 0.036), r: P(0.011, 0.046, 0.022), rot: [0.42, 0.75, 0] },
      { c: P(W[0] + 0.02, 0.185, W[2] - 0.052), r: P(0.008, 0.024, 0.014), rot: [0.6, 0.75, 0] },
    ], wc, { k: U(0.012), disp: (x, y, z) => (n01(x, y, z, 0.5, 4) - 0.5) * 0.4 });
    rig.mirror('wing_l', 'wing_r');
  }

  // ================================================================ tail bustle: black lacy plumes over the kilt
  {
    const tail = rig.part('tail', 'pelvis', P(...J.tail));
    const pc = plumeCol(seed + 9);
    for (let p = 0; p < 5; p++) {
      const dx = (p - 2) * 0.016;
      const end: V3 = [dx * 1.3, 0.12 + Math.abs(p - 2) * 0.012, -0.112 + Math.abs(p - 2) * 0.006];
      const mid: V3 = [dx, 0.17, -0.098];
      tube(tail, [P(dx * 0.4, 0.205, -0.07), Pv(mid), Pv(end)], [U(0.011), U(0.011), U(0.004)], pc);
    }
    // frayed, lacy ends
    const del: V3[] = [];
    tail.forEach((x, y, z) => {
      if (D(y) < 0.15 && h01(x, y, z, 17) < 0.28 && exposed(tail, x, y, z)) del.push([x, y, z]);
    });
    for (const [x, y, z] of del) tail.del(x, y, z);
  }

  // ================================================================ legs: fluffy thighs, scaly shins, chubby bird feet
  {
    const HP = P(...J.hip), KN = P(...J.knee), AN = P(...J.ankle);
    const thigh = rig.part('thigh_l', 'pelvis', HP);
    const fluff = (i: number, j: number, k: number) => {
      const n = n01(i, j, k, 0.35, 12);
      return n > 0.62 ? C.whiteL : n < 0.34 ? C.whiteS : C.white;
    };
    cap(thigh, HP, add3(KN, P(0, 0.006, 0)), U(0.031), U(0.025), fluff);
    // a ragged fringe of down at the knee
    for (let s = 0; s < 14; s++) {
      const a = (s / 14) * Math.PI * 2;
      const len = 0.006 + h01(s, 3, 1, 4) * 0.008;
      const base: V3 = [J.knee[0] + Math.sin(a) * 0.023, J.knee[1] + 0.012, J.knee[2] + Math.cos(a) * 0.022];
      line(thigh, [Pv(base), Pv(add3(base, [Math.sin(a) * 0.003, -len, Math.cos(a) * 0.003]))], s & 1 ? C.whiteS : C.white);
    }
    const shin = rig.part('shin_l', 'thigh_l', KN);
    const scales = (i: number, j: number, k: number) => {
      const Z = D(k) - J.knee[2];
      const ring = (j % 3) === 0;
      let c = ring ? C.skinD : C.skin;
      if (Z > 0.006 && !ring) c = C.skinL; // the front scutes
      return c;
    };
    cap(shin, KN, AN, U(0.0158), U(0.0128), scales);
    const foot = rig.part('foot_l', 'shin_l', AN);
    const footCol = (i: number, j: number, k: number) => (j === 0 ? C.skinD : h01(i, j, k, 3) < 0.1 ? C.skinL : C.skin);
    const fx = J.ankle[0];
    ell(foot, P(fx, 0.017, -0.002), P(0.017, 0.016, 0.019), footCol);
    cap(foot, AN, P(fx, 0.02, -0.002), U(0.013), U(0.015), footCol);
    const toes: [number, number, number, number][] = [
      // dx at the tip, tip z, root radius, tip radius
      [0, 0.064, 0.0112, 0.0072],
      [-0.027, 0.052, 0.0102, 0.0066],
      [0.028, 0.05, 0.0102, 0.0066],
    ];
    for (const [dx, tz, r0, r1] of toes) {
      const root: V3 = [fx + dx * 0.15, 0.0115, 0.008];
      const tip: V3 = [fx + dx, 0.0085, tz];
      const mid = add3(scl3(add3(root, tip), 0.5), [0, 0.0028, 0]);
      tube(foot, [Pv(root), Pv(mid), Pv(tip)], [U(r0), U((r0 + r1) / 2), U(r1)], footCol, { keep: (_t, _a, _b, _x, y) => y >= 0 });
      // knuckle pads
      ell(foot, Pv(add3(lerp(root, tip, 0.45), [0, 0.003, 0])), [U(r0 * 1.02), U(r0 * 0.95), U(r0 * 0.95)], footCol, { keep: (_a, _b, _c, _x, y) => y >= 0 });
      // a little dark claw
      const d = norm3(sub3(tip, root));
      cap(foot, Pv(add3(tip, scl3(d, 0.004))), Pv(add3(tip, add3(scl3(d, 0.011), [0, -0.004, 0]))), U(0.004), U(0.0018), C.claw, { keep: (_t, _a, _b, _x, y) => y >= 0 });
    }
    // the short hind toe
    tube(foot, [P(fx, 0.012, -0.012), P(fx, 0.0085, -0.03)], [U(0.0085), U(0.006)], footCol, { keep: (_t, _a, _b, _x, y) => y >= 0 });
    cap(foot, P(fx, 0.008, -0.031), P(fx, 0.004, -0.037), U(0.0035), U(0.0016), C.claw, { keep: (_t, _a, _b, _x, y) => y >= 0 });
    rig.mirror('thigh_l', 'thigh_r');
    rig.mirror('shin_l', 'shin_r', 'thigh_r');
    rig.mirror('foot_l', 'foot_r', 'shin_r');
  }

  // overlapping parts never share an exposed cell (no coplanar z-fighting at the joints)
  for (const p of rig.parts) {
    if (!p.parent || p.name.startsWith('eye_')) continue;
    const par = rig.m(p.parent);
    const del: V3[] = [];
    p.model.forEach((x, y, z) => {
      if (par.has(x, y, z) && exposed(par, x, y, z)) del.push([x, y, z]);
    });
    for (const [x, y, z] of del) p.model.del(x, y, z);
  }
  // gentle sky-lit tops and shaded undersides (the renderer's cel ramp does the rest)
  for (const p of rig.parts) if (!p.name.startsWith('eye_') && p.name !== 'crown') finish(p.model, { top: 1.03, under: 0.93 });

  const nib = add3(mirX(J.fist), scl3(PEN_DIR, PEN_LEN));
  rig.socket('nib', 'pen', Pv(nib));
  rig.socket('hand_r', 'fore_r', Pv(mirX(J.fist)));
  rig.socket('hand_l', 'fore_l', P(...J.fist));
  rig.socket('scroll', 'scroll', P(J.fist[0], 0.165, J.fist[2] + 0.014));
  rig.socket('head_top', 'crown', P(0, 0.745, J.crown[2]));
  rig.socket('beak_tip', 'beak', P(0, 0.334, 0.268));
  rig.socket('chest', 'torso', P(0, 0.29, 0.065));
  return rig.build({
    kind: 'thoth',
    name: 'Thoth',
    height: 0.76,
    radius: 0.13,
    headY: HC[1],
    eyeY: J.eye[1],
    blink: { close: LID_CLOSE, rest: LID_REST },
    nib,
  });
}
const lerp = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// ------------------------------------------------------------------ kilt + apron
function buildKilt(rig: CRig) {
  const pelvis = rig.m('pelvis');
  const top = 0.221, hem = 0.122;
  const shape = (Y: number) => {
    const t = clamp01((top - Y) / (top - hem));
    const f = Math.pow(t, 1.3);
    return { t, rx: 0.075 + 0.023 * f, rz: 0.069 + 0.021 * f, cz: -0.006 + 0.007 * t };
  };
  for (let j = Math.floor(U(hem - 0.008)); j <= Math.ceil(U(top)); j++) {
    const Y = D(j);
    const s = shape(Y);
    for (let i = Math.floor(-U(0.13)); i <= Math.ceil(U(0.13)); i++)
      for (let k = Math.floor(U(-0.13)); k <= Math.ceil(U(0.13)); k++) {
        const X = D(i), Z = D(k);
        const a = Math.atan2(X / s.rx, (Z - s.cz) / s.rz);
        const r = Math.hypot(X / s.rx, (Z - s.cz) / s.rz);
        const pleat = 0.5 + 0.5 * Math.cos(a * 30);
        const outer = 1 + 0.045 * pleat * (0.25 + s.t);
        const inner = 1 - 2.8 / (s.rx * K);
        if (r > outer || r < inner) continue;
        // a hem that ripples with the pleats, a touch longer at the back
        const hemY = hem + 0.0035 * pleat - 0.004 * Math.max(0, -Math.cos(a));
        if (Y < hemY) continue;
        let c = pleat > 0.7 ? C.linen : pleat < 0.25 ? C.linenS : mixc(C.linen, C.linenS, 0.4);
        if (Y < hemY + 0.006) c = mixc(c, C.linenD, 0.45); // the turned hem
        if (h01(i, j, k, 19) < 0.04) c = mixc(c, 0xffffff, 0.4);
        pelvis.set(i, j, k, c, VF.SOFTAO);
      }
  }
  // the belt: gold, a checker of lapis and carnelian inlay, rope rims
  const b0 = 0.204, b1 = 0.223;
  for (let j = Math.floor(U(b0)); j <= Math.floor(U(b1)); j++) {
    const Y = D(j);
    const s = shape(Y);
    for (let i = Math.floor(-U(0.12)); i <= Math.ceil(U(0.12)); i++)
      for (let k = Math.floor(U(-0.12)); k <= Math.ceil(U(0.12)); k++) {
        const X = D(i), Z = D(k);
        const r = Math.hypot(X / (s.rx + 0.006), (Z - s.cz) / (s.rz + 0.006));
        if (r > 1 || r < 1 - 3 / (s.rx * K)) continue;
        const a = Math.atan2(X, Z - s.cz);
        const edge = Y < b0 + 0.004 || Y > b1 - 0.004;
        const cell = Math.floor(a * 7);
        const c = edge ? ((i + j + k) & 1 ? C.goldS : C.gold) : cell & 1 ? (cell & 2 ? C.carn : C.lapis) : C.gold;
        pelvis.set(i, j, k, c, VF.METAL);
      }
  }
  // a carnelian tyet knot at the front of the belt
  const kz = shape(0.212).rz + shape(0.212).cz + 0.009;
  blob(pelvis, [
    { c: P(0, 0.218, kz), r: P(0.008, 0.007, 0.005) },
    { a: P(0, 0.212, kz + 0.001), b: P(0, 0.196, kz + 0.003), r0: U(0.004), r1: U(0.0065) },
    { a: P(0.002, 0.209, kz), b: P(0.012, 0.207, kz - 0.002), r0: U(0.0034), r1: U(0.003) },
    { a: P(-0.002, 0.209, kz), b: P(-0.012, 0.207, kz - 0.002), r0: U(0.0034), r1: U(0.003) },
  ], (i, j, k) => (h01(i, j, k, 3) < 0.25 ? C.carnD : C.carn), { k: U(0.004), fl: VF.METAL });
  ell(pelvis, P(0, 0.218, kz + 0.002), P(0.004, 0.0035, 0.004), 0, { carve: true });

  // ---- the apron tab hanging from the belt: pleated linen, gold edging, a bead fringe
  const front = (Y: number) => {
    const s = shape(Y);
    return s.rz * (1 + 0.045 * (0.25 + s.t)) + s.cz + 0.006;
  };
  const apron = rig.part('apron', 'pelvis', P(0, 0.205, front(0.205)));
  const ay0 = 0.13, ay1 = 0.204;
  for (let j = Math.floor(U(ay0)); j <= Math.ceil(U(ay1)); j++) {
    const Y = D(j);
    const t = (ay1 - Y) / (ay1 - ay0);
    const hw = 0.021 + 0.011 * t;
    for (let i = Math.floor(-U(hw)); i < Math.ceil(U(hw)); i++) {
      const X = D(i);
      if (Math.abs(X) > hw) continue;
      const z = front(Y) + 0.004 * (1 - (X / hw) ** 2);
      const edge = Math.abs(X) > hw - 0.004 || Y < ay0 + 0.004;
      const c = edge ? C.gold : (i & 3) === 0 ? C.linenS : h01(i, j, 5, 3) < 0.05 ? 0xffffff : C.linen;
      apron.set(i, j, Math.floor(U(z)), c, edge ? VF.METAL : VF.SOFTAO);
      apron.set(i, j, Math.floor(U(z)) - 1, edge ? C.goldS : C.linenS, edge ? VF.METAL : VF.SOFTAO);
    }
  }
  const beads = [C.lapis, C.carn, C.turq, C.carn, C.lapis];
  for (let b = 0; b < 5; b++) {
    const X = (b - 2) * 0.0078;
    const z = front(ay0) + 0.003;
    ell(apron, P(X, ay0 - 0.006, z), P(0.0032, 0.0048, 0.0032), beads[b], { fl: VF.METAL });
    apron.set(Math.floor(U(X)), Math.floor(U(ay0 - 0.0015)), Math.floor(U(z)), C.gold, VF.METAL);
  }
}

// ------------------------------------------------------------------ broad collar (wesekh)
function buildCollar(torso: VoxelModel) {
  const ctr: V3 = [0, 0.362, -0.006];
  const bands: [number, number, number][] = [
    // [outer distance (m), bead colour, shade]
    [0.054, C.gold, C.goldS],
    [0.064, C.lapis, C.lapisD],
    [0.074, C.carn, C.carnD],
    [0.084, C.turq, C.turqD],
    [0.091, C.gold, C.goldS],
  ];
  const r0 = 0.045, rEnd = bands[bands.length - 1][0];
  const zone = (x: number, y: number, z: number) => {
    const d = Math.hypot(D(x) - ctr[0], D(y) - ctr[1], D(z) - ctr[2]);
    return d > r0 && d < rEnd && D(y) > 0.255;
  };
  const colAt = (x: number, y: number, z: number) => {
    const X = D(x) - ctr[0], Y = D(y) - ctr[1], Z = D(z) - ctr[2];
    const d = Math.hypot(X, Y, Z);
    let lo = r0;
    for (const [hi, c, s] of bands) {
      if (d < hi) {
        if (d > hi - 0.0018 || d < lo + 0.0012) return s; // the threads between rows
        // tubular beads radiating out from the neck
        const a = Math.atan2(X, Z);
        const bead = Math.floor(a * (d / 0.0042));
        return bead & 1 ? c : mixc(c, s, 0.35);
      }
      lo = hi;
    }
    return C.gold;
  };
  const isGold = (c: number) => c === C.gold || c === C.goldS;
  // two layers: the collar is a real plate on the shoulders, not paint
  for (let layer = 0; layer < 2; layer++) {
    const add: [number, number, number, number][] = [];
    torso.forEach((x, y, z) => {
      if (!zone(x, y, z) || !exposed(torso, x, y, z)) return;
      for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, 0, 1], [0, 0, -1]] as V3[]) {
        const nx = x + dx, ny = y + dy, nz = z + dz;
        if (torso.has(nx, ny, nz)) continue;
        // only grow outward, away from the neck centre
        const o = [D(nx) - ctr[0], D(ny) - ctr[1], D(nz) - ctr[2]];
        if (dx * o[0] + dy * o[1] + dz * o[2] <= 0) continue;
        add.push([nx, ny, nz, colAt(nx, ny, nz)]);
      }
    });
    for (const [x, y, z, c] of add) torso.set(x, y, z, c, isGold(c) ? VF.METAL : VF.SOLID);
  }
  // the drop beads along the outer edge: teardrops of lapis, carnelian and turquoise under gold caps
  const buckets = new Map<number, V3>();
  const edgeR = rEnd + 0.0035;
  torso.forEach((x, y, z) => {
    const X = D(x) - ctr[0], Y = D(y) - ctr[1], Z = D(z) - ctr[2];
    const d = Math.hypot(X, Y, Z);
    if (d < edgeR - 0.003 || d > edgeR + 0.002 || D(y) < 0.24 || !exposed(torso, x, y, z)) return;
    const a = Math.atan2(X, Z);
    const b = Math.round(a / 0.155);
    const cur = buckets.get(b);
    if (!cur || y > cur[1]) buckets.set(b, [x, y, z]);
  });
  const drops = [C.lapis, C.carn, C.turq];
  for (const [b, [x, y, z]] of buckets) {
    const p: V3 = [D(x), D(y), D(z)];
    const out = norm3(sub3(p, ctr));
    const c = add3(p, add3(scl3(out, 0.004), [0, -0.0052, 0]));
    ell(torso, Pv(c), P(0.0042, 0.0062, 0.0042), drops[((b % 3) + 3) % 3], { fl: VF.METAL });
    ell(torso, Pv(add3(c, [0, 0.0048, 0])), P(0.0028, 0.0018, 0.0028), C.gold, { fl: VF.METAL });
  }
}

// ------------------------------------------------------------------ belt kit: palette and a rolled scroll
function buildBeltKit(pelvis: VoxelModel) {
  // the scribe's palette tucked in at his right hip: wood, two ink wells, spare reeds
  {
    const c: V3 = [-0.089, 0.205, 0.028];
    const L = norm3([0.06, 1, 0.34]);
    const N = norm3([-1, 0, 0.18]);
    const Wd = norm3(cross3(L, N));
    const toLocal = (p: V3): V3 => {
      const q = sub3(p, c);
      return [dot3(q, Wd), dot3(q, L), dot3(q, N)];
    };
    sdf(pelvis, [c[0] - 0.03, c[1] - 0.07, c[2] - 0.04], [c[0] + 0.03, c[1] + 0.07, c[2] + 0.04], (x, y, z) => rbox(toLocal([x, y, z]), [0.0155, 0.054, 0.0052], 0.0034), (i, j, k) => {
      const q = toLocal([D(i), D(j), D(k)]);
      const grain = Math.sin(q[0] * 900 + n01(i, j, k, 0.25, 3) * 4);
      let col = grain > 0.55 ? C.woodL : grain < -0.6 ? C.woodS : C.wood;
      // two ink wells near the top, a slot of spare reeds below
      for (const [wx, ink] of [[-0.0068, C.ink], [0.0068, C.red]] as [number, number][]) if (Math.hypot(q[0] - wx, q[1] - 0.04) < 0.0048 && q[2] > 0.002) col = ink;
      if (Math.abs(q[0]) < 0.0042 && q[1] > -0.03 && q[1] < 0.028 && q[2] > 0.002) col = Math.abs(q[0]) < 0.0012 ? C.reedD : C.reed;
      return col;
    });
    // carve the wells so the ink sits a voxel down
    for (const wx of [-0.0068, 0.0068]) {
      const w = add3(c, add3(scl3(Wd, wx), add3(scl3(L, 0.04), scl3(N, 0.0058))));
      ell(pelvis, Pv(w), P(0.0036, 0.0036, 0.0036), 0, { carve: true });
    }
  }
  // a rolled scroll tucked in at his left hip, tied with a red cord
  rolledScroll(pelvis, [0.083, 0.17, 0.04], [0.097, 0.258, 0.016], 0.0096, { cord: C.red, cordAt: 0.55, spiralEnds: [false, true] });
}

const cache: { spec: RigSpec | null } = { spec: null };
/** Thoth, keeper of the Hall (cached: the sculpt runs once) */
export function thothRig(): RigSpec {
  return (cache.spec ??= buildThoth());
}

// =====================================================================================================
// ANIMATION
// =====================================================================================================
export type ThothMode = 'idle' | 'run' | 'hop' | 'write' | 'gasp' | 'delight' | 'stoptime' | 'wave' | 'think';

const damp = (a: number, b: number, l: number, dt: number) => a + (b - a) * (1 - Math.exp(-l * dt));
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
type Tri = [number, number, number];
const _v = new THREE.Vector3();

class Spring {
  x = 0;
  v = 0;
  constructor(public k = 120, public c = 10) {}
  step(target: number, dt: number) {
    const h = Math.min(dt, 1 / 30);
    const a = this.k * (target - this.x) - this.c * this.v;
    this.v += a * h;
    this.x += this.v * h;
    return this.x;
  }
}

const TH_JOINTS = ['pelvis', 'torso', 'head', 'beak', 'jaw', 'crown', 'arm_l', 'arm_r', 'fore_l', 'fore_r', 'pen', 'scroll', 'wing_l', 'wing_r', 'thigh_l', 'thigh_r', 'shin_l', 'shin_r', 'foot_l', 'foot_r', 'tail', 'apron'];

/**
 * Thoth's procedural animation. Layered on the rest pose: damped pose targets per
 * mode, springy secondary motion (crown, wings, tail, apron, scroll), blinks, a
 * look-at, beak chatter while he talks, squash & stretch.
 *
 *   const rig = new RigInstance(buildRigGeo(thothRig(), 'thoth'));
 *   const anim = new ThothAnim(rig);
 *   anim.mode = 'run'; anim.speed = 2.5;   // the caller moves rig.root along the ground
 *   anim.talk(1.2);                          // chatter for 1.2 s (sync with Voice.say)
 *   anim.update(dt);  rig.root.position.y += anim.rootLift;
 */
export class ThothAnim {
  t = 0;
  mode: ThothMode = 'idle';
  /** ground speed for the run cycle (m/s): the caller moves the root */
  speed = 2;
  /** world point to look at (null: he looks around on his own) */
  lookAt: THREE.Vector3 | null = null;
  /** 0..1 progress of a hop (pose only; the caller lifts the root by `rootLift`) */
  hopK = 0;
  /** vertical root offset the pose wants this frame (m): run bounce, delight hops, crouch */
  rootLift = 0;
  /** body lean the pose wants (radians about X), applied on the pelvis already */
  lean = 0;
  private talkT = 0;
  private P: Record<string, Tri> = {};
  private T: Record<string, Tri> = {};
  private base: Record<string, { rot: THREE.Euler; pos: THREE.Vector3 }> = {};
  private sq = new Spring(240, 11);
  private crownS = [new Spring(160, 7), new Spring(160, 7)];
  private wingS = [new Spring(220, 9), new Spring(220, 9)];
  private tailS = new Spring(140, 7);
  private apronS = new Spring(170, 8);
  private scrollS = new Spring(150, 7);
  private gait = 0;
  private blink = 0;
  private nextBlink = 1.6;
  private yaw = 0;
  private pitch = 0;
  private tYaw = 0;
  private tPitch = 0;
  private nextLook = 0;
  private tilt = 0;
  private tTilt = 0;
  private prevMode: ThothMode = 'idle';
  private modeT = 0;
  private lift = 0;
  private rnd: () => number;
  private lidClose: number;

  constructor(public rig: RigInstance, seed = 3) {
    for (const p of rig.geo.parts) this.base[p.name] = { rot: p.rest.clone(), pos: p.offset.clone() };
    for (const n of TH_JOINTS) {
      this.P[n] = [0, 0, 0];
      this.T[n] = [0, 0, 0];
    }
    let s = (seed * 9301 + 49297) % 233280;
    this.rnd = () => (s = (s * 9301 + 49297) % 233280) / 233280;
    this.t = this.rnd() * 10;
    this.lidClose = rig.geo.spec.meta?.blink?.close ?? LID_CLOSE;
  }

  /** squash & stretch impulse (+ stretch, - squash) */
  kick(a: number) {
    this.sq.v += a;
  }
  /** flap the little wings (excitement) */
  flutter(a = 1) {
    this.wingS[0].v += 14 * a;
    this.wingS[1].v += 14 * a;
  }
  /** chatter the beak for `seconds` (call alongside Voice.say) */
  talk(seconds: number) {
    this.talkT = Math.max(this.talkT, seconds);
  }
  /** seconds in the current mode */
  get modeTime() {
    return this.modeT;
  }

  private set(n: string, x: number, y = 0, z = 0) {
    const t = this.T[n];
    if (t) {
      t[0] = x;
      t[1] = y;
      t[2] = z;
    }
  }
  private add(n: string, x: number, y = 0, z = 0) {
    const t = this.T[n];
    if (t) {
      t[0] += x;
      t[1] += y;
      t[2] += z;
    }
  }

  update(dt: number) {
    const R = this.rnd;
    this.t += dt;
    const t = this.t;
    if (this.mode !== this.prevMode) {
      this.prevMode = this.mode;
      this.modeT = 0;
      if (this.mode === 'gasp') this.kick(-3.2), this.flutter(1.4);
      if (this.mode === 'stoptime') this.kick(-2.5), this.flutter(2);
      if (this.mode === 'delight') this.flutter(1.2);
    }
    this.modeT += dt;
    const mt = this.modeT;
    for (const n of TH_JOINTS) this.set(n, 0, 0, 0);
    let l = 16;
    let lift = 0;
    let lookW = 1;
    let eyeOpen = 1; // 1 open, 0 shut (lids)
    let eyeScale = 1;
    let jawOpen = 0;
    let wingOut = 0;
    let lean = 0;
    // ---------------------------------------------------------------- look target
    this.nextLook -= dt;
    if (this.lookAt) {
      this.rig.root.updateWorldMatrix(true, false);
      const p = this.rig.root.worldToLocal(_v.copy(this.lookAt));
      this.tYaw = clamp(Math.atan2(p.x, p.z), -1.2, 1.2);
      this.tPitch = clamp(-Math.atan2(p.y - 0.47, Math.hypot(p.x, p.z)), -0.6, 0.5);
    } else if (this.nextLook <= 0) {
      this.nextLook = 0.6 + R() * 1.8;
      this.tYaw = (R() - 0.5) * 1.4;
      this.tPitch = (R() - 0.6) * 0.4;
    }
    this.nextLook = Math.min(this.nextLook, 4);
    if (R() < dt * 0.35) this.tTilt = R() < 0.6 ? (R() < 0.5 ? -0.32 : 0.32) : 0; // the curious bird head tilt
    this.yaw = damp(this.yaw, this.tYaw, 9, dt);
    this.pitch = damp(this.pitch, this.tPitch, 9, dt);
    this.tilt = damp(this.tilt, this.tTilt, 5, dt);

    // ---------------------------------------------------------------- mode poses
    switch (this.mode) {
      case 'idle': {
        // a gentle sway, the pen tapping the scroll now and then
        const sway = Math.sin(t * 1.3);
        this.set('pelvis', 0, sway * 0.05, sway * 0.025);
        this.set('torso', 0.02, -sway * 0.04, -sway * 0.02);
        this.set('arm_r', -0.15, 0, -0.05);
        this.set('fore_r', -0.35 + Math.max(0, Math.sin(t * 2.2)) ** 6 * -0.25);
        this.set('arm_l', -0.08, 0, 0.04);
        this.set('fore_l', -0.15);
        break;
      }
      case 'think': {
        // the pen on the beak, head cocked, a little foot tap
        this.set('arm_r', -1.0, 0.25, 0.25);
        this.set('fore_r', -1.55, 0.3, 0);
        this.set('pen', 0.3, 0, 0.4);
        this.set('arm_l', -0.25, 0, 0.12);
        this.set('fore_l', -0.55);
        this.set('head', -0.18, 0, 0.3);
        this.set('foot_l', -0.25 * Math.max(0, Math.sin(t * 9)));
        lookW = 0.3;
        eyeOpen = 0.88;
        break;
      }
      case 'run': {
        // a toddler's scamper: quick steps, big arm pumps, leaning in, head bobbing
        const f = clamp(2.4 + this.speed * 0.9, 2.6, 6.5);
        this.gait += dt * f * Math.PI;
        const g = this.gait;
        const s = Math.sin(g), c = Math.cos(g);
        const st = clamp(0.55 + this.speed * 0.12, 0.6, 1.0);
        this.set('thigh_l', -st * s - 0.1);
        this.set('thigh_r', st * s - 0.1);
        this.set('shin_l', 0.25 + Math.max(0, c) * 1.0 * st);
        this.set('shin_r', 0.25 + Math.max(0, -c) * 1.0 * st);
        this.set('foot_l', -0.25 * Math.max(0, -s) + 0.2 * Math.max(0, s));
        this.set('foot_r', -0.25 * Math.max(0, s) + 0.2 * Math.max(0, -s));
        this.set('arm_l', 0.65 * s - 0.2, 0, 0.18);
        this.set('arm_r', -0.65 * s - 0.2, 0, -0.18);
        this.set('fore_l', -0.6 - 0.25 * Math.max(0, -s));
        this.set('fore_r', -0.6 - 0.25 * Math.max(0, s));
        this.set('pelvis', 0, 0.12 * s, 0);
        this.set('torso', 0.06, -0.16 * s, 0.03 * c);
        lean = 0.12 + this.speed * 0.025;
        lift = Math.abs(Math.sin(g)) * 0.022 * st;
        this.set('head', -0.08 + 0.06 * Math.abs(c), 0.1 * s, 0);
        this.set('tail', 0.15 * Math.abs(s));
        wingOut = 0.15 + 0.12 * Math.abs(s);
        lookW = 0.35;
        l = 26;
        break;
      }
      case 'hop': {
        const k = clamp(this.hopK, 0, 1);
        const air = Math.sin(Math.PI * k);
        const crouch = k < 0.15 ? k / 0.15 : k > 0.85 ? (1 - k) / 0.15 : 0;
        this.set('thigh_l', -0.9 * crouch - 0.35 * air);
        this.set('thigh_r', -0.9 * crouch - 0.35 * air);
        this.set('shin_l', 1.4 * crouch + 0.6 * air);
        this.set('shin_r', 1.4 * crouch + 0.6 * air);
        this.set('foot_l', -0.5 * crouch + 0.4 * air);
        this.set('foot_r', -0.5 * crouch + 0.4 * air);
        this.set('arm_l', -1.3 * air, 0, 0.6 * air);
        this.set('arm_r', -1.3 * air, 0, -0.6 * air);
        lift = -0.03 * crouch;
        wingOut = 0.9 * air;
        l = 30;
        break;
      }
      case 'write': {
        // scroll up in front of his chest, head bowed, the pen scribbling across it
        this.set('arm_l', -0.62, -0.2, -0.22);
        this.set('fore_l', -1.0, 0, 0);
        this.set('scroll', 0.35, -0.25, 0);
        this.set('arm_r', -0.72, 0.15, 0.32);
        this.set('fore_r', -1.12, 0.25, 0);
        this.set('pen', 0.9, 0, 0.2);
        const sc = Math.sin(t * 31), sc2 = Math.sin(t * 13.7);
        this.add('fore_r', sc * 0.06, sc2 * 0.16, 0);
        this.add('arm_r', 0, 0, Math.sin(t * 5.1) * 0.06);
        this.set('head', 0.32, -0.12 + sc2 * 0.04, -0.12);
        this.set('torso', 0.08, 0, 0);
        this.add('beak', Math.sin(t * 6) * 0.04);
        jawOpen = 0.06; // concentrating, beak just parted
        eyeOpen = 0.96;
        eyeScale = 1.04;
        lookW = 0;
        l = 20;
        break;
      }
      case 'gasp': {
        // a sharp intake: leans back, hands up by his cheeks, beak wide, eyes huge
        const k = sstep(0, 0.12, mt);
        this.set('torso', -0.22 * k);
        this.set('head', -0.25 * k);
        this.set('arm_l', -1.55 * k, 0, 0.45 * k);
        this.set('arm_r', -1.55 * k, 0, -0.45 * k);
        this.set('fore_l', -1.4 * k);
        this.set('fore_r', -1.4 * k);
        this.set('thigh_l', 0.1 * k);
        this.set('thigh_r', 0.1 * k);
        jawOpen = 0.55 * k;
        eyeOpen = 1.12;
        eyeScale = 1 + 0.12 * k;
        wingOut = 0.75 * k;
        lookW = 0.5;
        l = 30;
        break;
      }
      case 'delight': {
        // bouncy little hops in place, arms up, eyes squeezed happy
        const b = Math.abs(Math.sin(mt * 9));
        lift = b * 0.05;
        const tuck = 1 - b;
        this.set('thigh_l', -0.4 * b - 0.3 * tuck);
        this.set('thigh_r', -0.4 * b - 0.3 * tuck);
        this.set('shin_l', 0.7 * b + 0.6 * tuck);
        this.set('shin_r', 0.7 * b + 0.6 * tuck);
        this.set('arm_l', -2.4 + Math.sin(mt * 18) * 0.25, 0, 0.35);
        this.set('arm_r', -2.4 - Math.sin(mt * 18) * 0.25, 0, -0.35);
        this.set('fore_l', -0.3);
        this.set('fore_r', -0.3);
        this.set('torso', -0.1, Math.sin(mt * 4.5) * 0.15, 0);
        this.set('head', -0.18, 0, Math.sin(mt * 4.5) * 0.22);
        jawOpen = 0.35;
        eyeOpen = 1.08; // big shining eyes
        eyeScale = 1.08;
        wingOut = 0.6 + 0.4 * b;
        lookW = 0.2;
        l = 26;
        break;
      }
      case 'stoptime': {
        // feet planted wide, the pen thrust up like a wand, scroll flung out, beak shouting
        const k = sstep(0, 0.18, mt);
        this.set('thigh_l', -0.1 * k, 0, 0.32 * k);
        this.set('thigh_r', -0.1 * k, 0, -0.32 * k);
        this.set('shin_l', 0.25 * k, 0, -0.2 * k);
        this.set('shin_r', 0.25 * k, 0, 0.2 * k);
        this.set('arm_r', -2.75 * k, 0, -0.2 * k);
        this.set('fore_r', -0.15 * k);
        this.set('pen', -0.6 * k);
        this.set('arm_l', -0.6 * k, 0, 1.05 * k);
        this.set('fore_l', -0.4 * k);
        this.set('torso', -0.14 * k, 0.12 * k, 0);
        this.set('head', -0.3 * k, 0, 0);
        jawOpen = 0.5 * k;
        eyeOpen = 1.1;
        eyeScale = 1 + 0.08 * k;
        wingOut = 1.25 * k;
        lift = -0.012 * k;
        lookW = 0.15;
        l = 32;
        break;
      }
      case 'wave': {
        this.set('arm_r', -2.5, 0, -0.5 + Math.sin(t * 10) * 0.35);
        this.set('fore_r', -0.5 + Math.sin(t * 10 + 0.6) * 0.3);
        this.set('arm_l', -0.15, 0, 0.1);
        this.set('head', 0, 0, Math.sin(t * 5) * 0.12);
        jawOpen = 0.2;
        eyeOpen = 1;
        wingOut = 0.25;
        lookW = 0.8;
        break;
      }
    }
    // look on top (head and a touch of torso)
    this.add('head', this.pitch * 0.8 * lookW, this.yaw * 0.75 * lookW, this.tilt * lookW);
    this.add('torso', 0, this.yaw * 0.2 * lookW, 0);
    this.add('pelvis', lean, 0, 0);
    this.lean = lean;
    // ease toward the targets
    const k = 1 - Math.exp(-l * dt);
    for (const n of TH_JOINTS) {
      const c = this.P[n], g = this.T[n];
      c[0] += (g[0] - c[0]) * k;
      c[1] += (g[1] - c[1]) * k;
      c[2] += (g[2] - c[2]) * k;
    }
    this.lift = damp(this.lift, lift, this.mode === 'run' || this.mode === 'delight' || this.mode === 'hop' ? 40 : 12, dt);
    this.rootLift = this.lift;

    // ---------------------------------------------------------------- secondary motion
    const breathe = Math.sin(t * 2.4) * 0.025;
    this.talkT = Math.max(0, this.talkT - dt);
    const chat = this.talkT > 0 ? Math.max(0, Math.sin(t * 22)) * 0.3 + Math.max(0, Math.sin(t * 9.3)) * 0.12 : 0;
    const cr0 = this.crownS[0].step(-this.P.head[0] * 0.5, dt), cr1 = this.crownS[1].step(-this.P.head[2] * 0.5, dt);
    const w0 = this.wingS[0].step(wingOut, dt), w1 = this.wingS[1].step(wingOut, dt);
    const tl = this.tailS.step(this.mode === 'run' ? 0.25 : 0, dt);
    const ap = this.apronS.step(-this.P.thigh_l[0] * 0.25 - this.P.thigh_r[0] * 0.25 + this.lean * 0.6, dt);
    const scr = this.scrollS.step(-this.P.fore_l[0] * 0.5, dt);
    // blinking
    this.nextBlink -= dt;
    if (this.nextBlink <= 0) {
      this.nextBlink = 1.4 + R() * 3.2;
      this.blink = 0.14;
    }
    this.blink = Math.max(0, this.blink - dt);
    let shut = 1 - clamp(eyeOpen, 0, 1.2);
    if (this.blink > 0) shut = Math.max(shut, Math.sin((this.blink / 0.14) * Math.PI));

    // ---------------------------------------------------------------- write the joints
    const rot = (n: string, x: number, y: number, z: number) => {
      const node = this.rig.nodes[n];
      const b = this.base[n];
      if (!node || !b) return;
      node.rotation.set(b.rot.x + x, b.rot.y + y, b.rot.z + z);
    };
    const W = (n: string, dx = 0, dy = 0, dz = 0) => {
      const c = this.P[n];
      rot(n, c[0] + dx, c[1] + dy, c[2] + dz);
    };
    W('pelvis');
    W('torso', breathe);
    W('head', -breathe * 0.6);
    W('beak');
    W('jaw', clamp(jawOpen + chat, 0, 0.7));
    W('crown', cr0 * 0.6, 0, cr1 * 0.6);
    for (const n of ['arm_l', 'arm_r', 'fore_r', 'pen', 'thigh_l', 'thigh_r', 'shin_l', 'shin_r', 'foot_l', 'foot_r']) W(n);
    W('fore_l');
    W('scroll', scr * 0.4);
    W('wing_l', -w0 * 0.25, w0 * 0.3, w0 * 0.85);
    W('wing_r', -w1 * 0.25, -w1 * 0.3, -w1 * 0.85);
    W('tail', tl + Math.sin(t * 3.1) * 0.04, Math.sin(t * 2.3) * 0.08, 0);
    W('apron', clamp(ap, -0.6, 0.6));
    const lid = clamp(shut, -0.15, 1) * this.lidClose;
    rot('lid_l', lid, 0, 0);
    rot('lid_r', lid, 0, 0);
    for (const n of ['eye_l', 'eye_r']) this.rig.nodes[n]?.scale.setScalar(eyeScale);
    // squash & stretch (volume preserving) on the whole body
    const s = clamp(this.sq.step(0, dt) + chat * 0.02, -0.3, 0.3);
    this.rig.nodes.pelvis?.scale.set(1 - s * 0.45, 1 + s, 1 - s * 0.45);
  }
}
