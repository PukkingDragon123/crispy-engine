// THOTH, keeper of the Hall: a tiny ibis-headed god, ten thousand years old, who
// talks like a child and collects every creature the hunter meets.
//
// STYLIZED BUILD (a lead character, not a statue): chunky 1/96 m voxels, a strong
// silhouette and a huge head (about 45% of his height).
//   - a big round head of soft white down with chubby cheeks and a long, gently
//     down-curved charcoal ibis beak (a horn tip that bends a touch to his right,
//     a chipped edge, nostril slits, a little smile line at the gape; the lower
//     mandible is its own part and clacks when he talks);
//   - big painted cartoon eyes on real eyeballs (thothEyes.ts: lids, jade irises,
//     star catchlights, kohl flicks, brows) that look at things, blink and emote;
//   - a striped lapis-and-gold headcloth with two swinging lappets, a crest tuft
//     that bounces, and a gold crescent cradling a silver moon worn at a jaunty tilt;
//   - a pear-shaped feathered body, a broad bead collar, small folded wings with
//     black primaries and a black plume bustle, like a sacred ibis;
//   - a pleated linen shendyt kilt with a gold belt and a pleated apron tab;
//   - stubby slate bird legs with knobbly knees and chunky three-toed feet;
//   - chunky four-fingered slate hands: the left hugs a little leather notebook
//     (its cover opens when he writes), the right holds a reed pen.
//
// RIG (faces +Z, LEFT = +X, origin on the ground between the feet, 1/96 m):
//   pelvis (root) → torso → head → beak, jaw, eye_l, eye_r, crown, tuft, lappet_l, lappet_r
//   torso → arm_l → fore_l → book → book_cover;  torso → arm_r → fore_r → pen
//   torso → wing_l, wing_r;  pelvis → apron, tail;  pelvis → thigh_l → shin_l → foot_l (and _r)
// Sockets: nib (pen tip), hand_l, hand_r, scroll (notebook page), head_top, beak_tip, chest.
// meta.eyes: the painted eyeballs (radius, outward yaw, pitch, lid colour).
// Animate with ThothAnim (bottom of this file): modes, moods, look-at, talk, hops.
import * as THREE from 'three';
import type { RigInstance } from '../../../engine/voxel/Rig';
import { makeVoxelMaterial, type VoxelMaterial } from '../../../engine/render/VoxelMaterial';
import { CRig, VoxelModel, VF, blob, ell, cap, paint, exposed, thicken, splitInto, finish, mixc, mulc, h01, add3, sub3, scl3, norm3, dot3, sstep, clamp01 } from '../creatures/ckit';
import type { V3, RigSpec, Col } from '../creatures/ckit';
import { ThothEyes, type EyeDot } from './thothEyes';

// ------------------------------------------------------------------ grid
const VS = 1 / 96;
const K = 1 / VS;
const U = (m: number) => m * K;
const P = (x: number, y: number, z: number): V3 => [x * K, y * K, z * K];
const Pv = (v: V3): V3 => [v[0] * K, v[1] * K, v[2] * K];
/** voxel index -> design metres at the cell centre */
const D = (i: number) => (i + 0.5) / K;
const mirX = (v: V3): V3 => [-v[0], v[1], v[2]];

// ------------------------------------------------------------------ palette (base / shade / highlight per material)
const C = {
  white: 0xf4efe4,
  whiteS: 0xd9d0c0,
  whiteL: 0xfffcf4,
  blush: 0xf2b8a8,
  plume: 0x2b2a36,
  plumeS: 0x1b1a23,
  plumeL: 0x4a5070,
  beak: 0x3b3534,
  beakS: 0x24201f,
  beakL: 0x5d5450,
  horn: 0x9c8b76,
  skin: 0x5c5e6e,
  skinS: 0x40414e,
  skinL: 0x7d8092,
  claw: 0x1e1c22,
  lapis: 0x2f56b0,
  lapisS: 0x1f3a80,
  lapisL: 0x5a82d8,
  gold: 0xe8b84a,
  goldS: 0xb8862e,
  goldL: 0xffe08a,
  carn: 0xc4512e,
  turq: 0x3cbcae,
  linen: 0xe8d4a6,
  linenS: 0xbfa676,
  linenL: 0xf6ead0,
  leather: 0x6e2c1c,
  leatherS: 0x4a1c12,
  leatherL: 0x8a4028,
  page: 0xf3e6c4,
  pageS: 0xcdb98e,
  ink: 0x2a1c14,
  reed: 0xcaa362,
  reedS: 0x8f6d38,
  red: 0xb03c26,
  moon: 0xdfe8f6,
  moonS: 0xa9b8d4,
  mouth: 0xc0656a,
  mouthS: 0x6a2a2e,
};

// ------------------------------------------------------------------ skeleton (design metres)
const J = {
  pelvis: [0, 0.15, 0] as V3,
  torso: [0, 0.19, 0] as V3,
  head: [0, 0.3, 0] as V3,
  beak: [0, 0.41, 0.098] as V3,
  jaw: [0, 0.394, 0.096] as V3,
  eye: [0.06, 0.452, 0.057] as V3,
  crown: [0, 0.53, -0.012] as V3,
  tuft: [0, 0.515, -0.078] as V3,
  lappet: [0.1, 0.44, -0.04] as V3,
  shoulder: [0.066, 0.272, 0] as V3,
  elbow: [0.092, 0.208, 0.016] as V3,
  wristL: [0.094, 0.174, 0.078] as V3,
  fistL: [0.097, 0.158, 0.096] as V3,
  wristR: [-0.092, 0.174, 0.07] as V3,
  fistR: [-0.092, 0.158, 0.088] as V3,
  hip: [0.036, 0.142, 0] as V3,
  knee: [0.04, 0.086, 0.012] as V3,
  ankle: [0.04, 0.03, -0.004] as V3,
  tail: [0, 0.172, -0.066] as V3,
  wing: [0.062, 0.276, -0.046] as V3,
  apron: [0, 0.172, 0.082] as V3,
  spine: [0.091, 0.16, 0.104] as V3,
};
const HC: V3 = [0, 0.428, -0.012];
const HR: V3 = [0.12, 0.112, 0.11];
/** the pixel dot eyes sit where this ray from the head's centre leaves the head (left eye; mirrored) */
const EYE_DIR: V3 = norm3([0.48, 0.13, 0.87]);
const CUT_WAIST = 0.19;
/** reed pen: from the right fist toward the nib (forward, down, a touch inward) */
const PEN_DIR: V3 = norm3([0.22, -0.38, 0.9]);
const PEN_NIB = 0.056;
const PEN_TAIL = 0.046;

// ------------------------------------------------------------------ helpers
/** fill every cell whose centre (design metres) has f <= 0 */
function sdf(m: VoxelModel, lo: V3, hi: V3, f: (x: number, y: number, z: number) => number, col: Col, fl?: number) {
  for (let i = Math.floor(U(lo[0])) - 1; i <= Math.ceil(U(hi[0])); i++)
    for (let j = Math.floor(U(lo[1])) - 1; j <= Math.ceil(U(hi[1])); j++)
      for (let k = Math.floor(U(lo[2])) - 1; k <= Math.ceil(U(hi[2])); k++) {
        if (f(D(i), D(j), D(k)) > 0) continue;
        const c = typeof col === 'number' ? col : col(i, j, k);
        if (c !== null) m.set(i, j, k, c, fl);
      }
}
/** distance from p to segment ab, and the parameter along it */
function segD(p: V3, a: V3, b: V3): [number, number] {
  const d = sub3(b, a);
  const t = clamp01(dot3(sub3(p, a), d) / (dot3(d, d) || 1e-9));
  const q = add3(a, scl3(d, t));
  return [Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]), t];
}
const lerpV = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// ------------------------------------------------------------------ colour fields (few tones, deliberate)
/** contour feathers: clean scallop rows on the body, plain soft down on the belly */
function plumage(i: number, j: number, k: number) {
  const X = D(i), Y = D(j), Z = D(k);
  const a = Math.atan2(X, Z);
  const front = Math.cos(a);
  if (front > 0.55 && Y > 0.15 && Y < 0.262) return Y > 0.24 ? C.white : C.whiteL;
  const v = Y / 0.026;
  const row = Math.floor(v);
  const u = (a * 0.08) / 0.034 + (row & 1) * 0.5;
  const fu = u - Math.floor(u) - 0.5;
  const fv = v - row;
  const edge = 0.22 + fu * fu * 1.7;
  if (fv < edge && fv > edge - 0.36) return C.whiteS;
  return C.white;
}
/** head down: white, a little lighter on the face, blush on the cheeks */
function headDown(i: number, j: number, k: number) {
  const X = D(i), Y = D(j), Z = D(k);
  for (const s of [1, -1]) {
    const d = Math.hypot((X - 0.068 * s) * 1.1, Y - 0.392, (Z - 0.066) * 1.3);
    if (d < 0.019) return C.blush;
  }
  if (Z > 0.04 && Y < 0.44) return C.whiteL;
  return C.white;
}
/** ibis plumes: black with a blue sheen along the rachis lines */
function plumeCol(i: number, j: number, k: number) {
  const X = D(i), Z = D(k);
  const lane = Math.floor((Math.atan2(X, -Z) * 0.06) / 0.011);
  return lane % 3 === 0 ? C.plumeL : (i + j) % 7 === 0 ? C.plumeS : C.plume;
}
/** the khat headcloth: two voxels of lapis, one of gold */
function stripes(j: number) {
  const r = ((j % 3) + 3) % 3;
  return r === 0 ? C.gold : r === 1 ? C.lapis : C.lapisS;
}

// ------------------------------------------------------------------ builder
function buildThoth(): RigSpec {
  const rig = new CRig('thoth', VS);

  // ================================================================ body: one sculpt, split at the waist
  const bodyMass = new VoxelModel('bodyMass');
  blob(bodyMass, [
    { c: P(0, 0.218, 0.012), r: P(0.08, 0.086, 0.076) }, // round belly
    { c: P(0, 0.272, -0.002), r: P(0.066, 0.05, 0.058) }, // chest
    { c: P(0, 0.165, -0.006), r: P(0.068, 0.046, 0.062) }, // hips
    { c: P(0.052, 0.27, -0.006), r: P(0.028, 0.026, 0.03) }, // shoulder caps
    { c: P(-0.052, 0.27, -0.006), r: P(0.028, 0.026, 0.03) },
    { a: P(0, 0.29, -0.006), b: P(0, 0.33, 0), r0: U(0.042), r1: U(0.04) }, // neck
  ], plumage, { k: U(0.02), keep: (_x, y) => D(y) < 0.335 && D(y) > 0.12 });
  const pelvis = rig.part('pelvis', undefined, P(...J.pelvis));
  const torso = rig.part('torso', 'pelvis', P(...J.torso));
  splitInto(bodyMass, pelvis, torso, (_x, y) => D(y) >= CUT_WAIST, (_x, y) => D(y) >= CUT_WAIST - 0.022);
  buildKilt(rig, pelvis);
  buildCollar(torso);

  // ---- wings: small folded wings on the back, white coverts over black primaries
  {
    const w = rig.part('wing_l', 'torso', P(...J.wing));
    blob(w, [
      { c: P(0.07, 0.236, -0.06), r: P(0.02, 0.05, 0.032), rot: [0.38, 0, -0.12] },
      { a: P(0.072, 0.2, -0.074), b: P(0.078, 0.158, -0.1), r0: U(0.022), r1: U(0.007) },
    ], (i, j, k) => {
      const Y = D(j);
      if (Y < 0.205) return (k & 1) === 0 ? C.plumeS : C.plume; // primaries, separated
      if (Y < 0.222) return C.plumeL;
      return plumage(i, j, k);
    }, { k: U(0.012), keep: (x) => D(x) > 0.045 });
    rig.mirror('wing_l', 'wing_r');
  }
  // ---- tail: a drooping black plume bustle
  {
    const t = rig.part('tail', 'pelvis', P(...J.tail));
    blob(t, [
      { a: P(0, 0.176, -0.058), b: P(0, 0.112, -0.128), r0: U(0.022), r1: U(0.01) },
      { a: P(0.016, 0.172, -0.058), b: P(0.03, 0.116, -0.116), r0: U(0.017), r1: U(0.008) },
      { a: P(-0.016, 0.172, -0.058), b: P(-0.028, 0.12, -0.112), r0: U(0.017), r1: U(0.008) },
    ], plumeCol, { k: U(0.008) });
  }

  // ================================================================ head
  const head = rig.part('head', 'torso', P(...J.head));
  blob(head, [
    { c: P(...HC), r: P(...HR) }, // the big round cranium
    { c: P(0, 0.402, -0.054), r: P(0.1, 0.084, 0.076) }, // back of the skull
    { c: P(0.058, 0.372, 0.034), r: P(0.056, 0.05, 0.054) }, // chubby cheeks
    { c: P(-0.058, 0.372, 0.034), r: P(0.056, 0.05, 0.054) },
    { c: P(0, 0.404, 0.082), r: P(0.034, 0.031, 0.03) }, // beak root mound
    { a: P(0, 0.3, -0.008), b: P(0, 0.35, 0), r0: U(0.042), r1: U(0.06) }, // neck join
  ], headDown, { k: U(0.024) });
  // the khat: lapis and gold stripes over the back of the head, a gold edge band
  const khat = (x: number, y: number, z: number) => {
    const X = D(x), Y = D(y), Z = D(z);
    const a = Math.abs(Math.atan2(X, Z + 0.01));
    return Y > 0.31 && (a > 1.72 - 0.9 * sstep(0.47, 0.54, Y) || (Y > 0.505 && Z < -0.035));
  };
  paint(head, (x, y, z) => khat(x, y, z) && exposed(head, x, y, z), (_x, y) => stripes(y));
  thicken(head, (x, y, z) => khat(x, y, z) && exposed(head, x, y, z) && D(y) > 0.33, (_x, y) => stripes(y), [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, 0, -1]]);
  paint(head, (x, y, z) => {
    if (!khat(x, y, z) || !exposed(head, x, y, z)) return false;
    for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, -1, 0]] as V3[]) if (head.has(x + dx, y + dy, z + dz) && !khat(x + dx, y + dy, z + dz)) return true;
    return false;
  }, C.goldL, VF.METAL);
  finish(head, { top: 1.03, under: 0.9, skip: (c) => c === C.goldL || c === C.blush });
  // eyes: where the eye ray leaves the head. The animator lays a flat pixel dot there; the
  // stand-in (for captures that run no animator) is one dark voxel in that surface cell.
  {
    let last: [number, number, number] | null = null;
    let tExit = 0;
    for (let tt = 0; tt < 0.2; tt += 0.0015) {
      const p = add3(HC, scl3(EYE_DIR, tt));
      const c: [number, number, number] = [Math.floor(U(p[0])), Math.floor(U(p[1])), Math.floor(U(p[2]))];
      if (head.has(c[0], c[1], c[2])) {
        last = c;
        tExit = tt;
      }
    }
    const cell = last ?? [Math.floor(U(0.06)), Math.floor(U(0.44)), Math.floor(U(0.09))];
    const at = add3(HC, scl3(EYE_DIR, tExit + 0.0015));
    head.del(cell[0], cell[1], cell[2]);
    head.del(-1 - cell[0], cell[1], cell[2]);
    const el = rig.part('eye_l', 'head', Pv(at));
    el.set(cell[0], cell[1], cell[2], 0x18131e);
    rig.mirror('eye_l', 'eye_r');
  }

  // ---- lappets: two striped hanks falling behind the cheeks to the collar (they swing)
  {
    const lp = rig.part('lappet_l', 'head', P(...J.lappet));
    const a: V3 = [0.104, 0.44, -0.045], m: V3 = [0.106, 0.37, -0.03], b: V3 = [0.096, 0.296, -0.006];
    sdf(lp, [0.07, 0.28, -0.08], [0.13, 0.46, 0.03], (x, y, z) => {
      if (y < 0.29 || y > 0.452) return 1;
      const p: V3 = [x, y, z];
      const [d1, t1] = segD(p, a, m);
      const [d2, t2] = segD(p, m, b);
      const t = d1 < d2 ? t1 * 0.5 : 0.5 + t2 * 0.5;
      const c = d1 < d2 ? lerpV(a, m, t1) : lerpV(m, b, t2);
      const dx = Math.abs(x - c[0]), dz = Math.abs(z - c[2]);
      const w = 0.018 + 0.008 * t, th = 0.008;
      return Math.max(dx - th, dz - w, Math.hypot(Math.max(dx - th + 0.004, 0), Math.max(dz - w + 0.004, 0)) - 0.004);
    }, (_i, j) => (D(j) < 0.3 ? C.goldL : stripes(j)));
    rig.mirror('lappet_l', 'lappet_r');
  }
  // ---- the crest tuft: three soft feathers poking out behind the crown, black tips
  {
    const tf = rig.part('tuft', 'head', P(...J.tuft));
    const roots: [V3, V3, number][] = [
      [[0, 0.515, -0.078], [0.004, 0.592, -0.118], 0.013],
      [[0.016, 0.51, -0.082], [0.036, 0.574, -0.122], 0.011],
      [[-0.016, 0.51, -0.08], [-0.03, 0.566, -0.116], 0.01],
    ];
    for (const [a, b, r] of roots) {
      const mid = lerpV(a, b, 0.55);
      mid[2] -= 0.006;
      cap(tf, Pv(a), Pv(mid), U(r), U(r * 0.75), C.white);
      cap(tf, Pv(mid), Pv(b), U(r * 0.75), U(0.0035), (_i, j) => (D(j) > b[1] - 0.016 ? C.plume : C.white));
    }
  }
  // ---- the crown: a gold crescent cradling a silver moon on a little flared modius
  {
    const cr = rig.part('crown', 'head', P(...J.crown), [0, 0, 0.11]);
    const cz = -0.012;
    sdf(cr, [-0.04, 0.52, -0.05], [0.04, 0.556, 0.03], (x, y, z) => {
      if (y < 0.522 || y > 0.548) return 1;
      const r = 0.026 + (y - 0.522) * 0.34;
      return Math.hypot(x, (z - cz) * 1.05) - r;
    }, (_i, j) => (D(j) > 0.54 ? C.goldL : D(j) > 0.53 ? C.lapis : C.gold), VF.METAL);
    sdf(cr, [-0.075, 0.54, cz - 0.012], [0.075, 0.68, cz + 0.012], (x, y, z) => {
      const dz = Math.abs(z - cz) - 0.008;
      const o = Math.hypot(x, y - 0.604) - 0.064;
      const i = 0.05 - Math.hypot(x, y - 0.63);
      return Math.max(dz, o, i);
    }, (i, j) => (D(j) < 0.556 ? C.goldS : D(i) < -0.03 ? C.goldL : C.gold), VF.METAL);
    sdf(cr, [-0.05, 0.57, cz - 0.016], [0.05, 0.68, cz + 0.006], (x, y, z) => Math.max(Math.abs(z - cz + 0.004) - 0.0055, Math.hypot(x, y - 0.626) - 0.04), (i, j) => {
      const X = D(i), Y = D(j);
      const r = Math.hypot(X, Y - 0.626);
      if (r > 0.032) return C.goldL;
      if (Math.hypot(X - 0.012, Y - 0.632) < 0.009 || Math.hypot(X + 0.012, Y - 0.614) < 0.007) return C.moonS;
      return X < -0.008 && Y > 0.632 ? 0xffffff : C.moon;
    });
  }

  // ================================================================ beak + jaw (one sculpt, split along the gape)
  {
    const BP: V3[] = [[0, 0.41, 0.07], [0, 0.408, 0.13], [0, 0.396, 0.18], [-0.002, 0.374, 0.222], [-0.005, 0.345, 0.252], [-0.009, 0.314, 0.267]];
    const BR = [0.031, 0.0235, 0.018, 0.0128, 0.0085, 0.0048];
    const along = (Z: number) => {
      for (let i = 0; i < BP.length - 1; i++) {
        const a = BP[i], b = BP[i + 1];
        if (Z <= b[2] || i === BP.length - 2) {
          const t = clamp01((Z - a[2]) / (b[2] - a[2] || 1e-6));
          return { x: a[0] + (b[0] - a[0]) * t, y: a[1] + (b[1] - a[1]) * t, r: BR[i] + (BR[i + 1] - BR[i]) * t, t: (i + t) / (BP.length - 1) };
        }
      }
      return { x: 0, y: BP[0][1], r: BR[0], t: 0 };
    };
    const mass = new VoxelModel('beakMass');
    for (let i = 0; i < BP.length - 1; i++) cap(mass, Pv(BP[i]), Pv(BP[i + 1]), U(BR[i]), U(BR[i + 1]), 1);
    const beak = rig.part('beak', 'head', P(...J.beak));
    const jaw = rig.part('jaw', 'head', P(...J.jaw));
    const isJaw = (x: number, y: number, z: number) => {
      const a = along(D(z));
      return D(y) < a.y - a.r * 0.18 && a.t < 0.8;
    };
    const col = (x: number, y: number, z: number) => {
      const X = D(x), Y = D(y), Z = D(z);
      const a = along(Z);
      const h = (Y - a.y) / Math.max(a.r, 0.004);
      let c = a.t > 0.72 ? mixc(C.beak, C.horn, sstep(0.72, 0.98, a.t)) : C.beak;
      if (h > 0.55) c = a.t > 0.72 ? mixc(c, 0xc8b8a0, 0.35) : C.beakL; // the culmen catches the light
      else if (h < -0.6) c = mulc(c, 0.72);
      // nostril slits near the root
      if (a.t > 0.12 && a.t < 0.22 && Math.abs(h - 0.25) < 0.22 && Math.abs(X - a.x) > a.r * 0.5) c = C.beakS;
      return c;
    };
    mass.forEach((x, y, z) => {
      const c = col(x, y, z);
      if (isJaw(x, y, z)) jaw.set(x, y, z, c);
      else beak.set(x, y, z, c);
    });
    // the inside of the mouth along the gape
    const inner = (x: number, z: number) => {
      const a = along(D(z));
      return a.t > 0.06 && Math.abs(D(x) - a.x) < a.r * 0.45;
    };
    jaw.forEach((x, y, z) => {
      if (beak.has(x, y + 1, z) && inner(x, z) && jaw.has(x + 1, y, z) && jaw.has(x - 1, y, z)) jaw.set(x, y, z, C.mouth);
    });
    beak.forEach((x, y, z) => {
      if (jaw.has(x, y - 1, z) && inner(x, z) && beak.has(x + 1, y, z) && beak.has(x - 1, y, z)) beak.set(x, y, z, C.mouthS);
    });
    // a chip in the upper edge (ten thousand years of pecking)
    {
      const a = along(0.2);
      beak.del(Math.floor(U(a.x + a.r * 0.6)), Math.floor(U(a.y + a.r * 0.55)), Math.floor(U(0.2)));
    }
    const tip = BP[BP.length - 1];
    rig.socket('beak_tip', 'beak', Pv(tip));
  }

  // ================================================================ arms and hands
  {
    // upper arm: a puffy feathered sleeve with a short trailing fringe
    const arm = rig.part('arm_l', 'torso', P(...J.shoulder));
    blob(arm, [
      { a: P(...J.shoulder), b: P(...J.elbow), r0: U(0.028), r1: U(0.021) },
      { c: P(0.088, 0.222, -0.008), r: P(0.016, 0.03, 0.02), rot: [0.3, 0, 0.1] },
    ], plumage, { k: U(0.012) });
    const fore = rig.part('fore_l', 'arm_l', P(...J.elbow));
    buildHand(fore, 1);
    rig.mirror('arm_l', 'arm_r');
    const foreR = rig.part('fore_r', 'arm_r', P(...mirX(J.elbow)));
    buildHand(foreR, -1);
    rig.socket('hand_l', 'fore_l', P(...J.fistL));
    rig.socket('hand_r', 'fore_r', P(...J.fistR));
  }
  // ---- the reed pen in the right fist
  {
    const pen = rig.part('pen', 'fore_r', P(...J.fistR));
    const nib = add3(J.fistR, scl3(PEN_DIR, PEN_NIB));
    const tailP = sub3(J.fistR, scl3(PEN_DIR, PEN_TAIL));
    cap(pen, Pv(tailP), Pv(nib), U(0.0058), U(0.0042), (i, j, k) => {
      const [, t] = segD([D(i), D(j), D(k)], tailP, nib);
      if (t > 0.9) return C.ink;
      if (t < 0.12) return C.red;
      return Math.abs(t - 0.38) < 0.03 || Math.abs(t - 0.66) < 0.03 ? C.reedS : C.reed;
    });
    rig.socket('nib', 'pen', Pv(nib));
  }
  // ---- the notebook hugged in the left hand (its front cover is hinged at the spine)
  {
    const book = rig.part('book', 'fore_l', P(...J.fistL));
    const x0 = 0.03, x1 = 0.092, y0 = 0.122, y1 = 0.2, z0 = 0.084, z1 = 0.104;
    sdf(book, [x0, y0, z0], [x1, y1, z1], (x, y, z) => (x < x0 || x > x1 || y < y0 || y > y1 || z < z0 || z > z1 ? 1 : -1), (i, j, k) => {
      const X = D(i), Y = D(j), Z = D(k);
      if (Z < 0.094) return X > x1 - 0.008 ? C.leatherS : C.leather; // back cover
      if (X > x1 - 0.007) return C.leatherS; // spine
      // page block: page lines along the fore edge, ink rows on the open page
      if (X < x1 - 0.012 && X > x0 + 0.008 && Y > y0 + 0.012 && Y < y1 - 0.01) {
        const row = Math.floor((Y - y0) / 0.0105);
        return row % 2 === 0 && h01(i, row, 0, 5) > 0.25 ? C.ink : C.page;
      }
      return (j + k) % 2 === 0 ? C.page : C.pageS;
    });
    const cover = rig.part('book_cover', 'book', P(...J.spine));
    sdf(cover, [x0 - 0.004, y0 - 0.004, z1], [x1, y1 + 0.004, z1 + 0.01], (x, y, z) => (x < x0 - 0.004 || x > x1 || y < y0 - 0.004 || y > y1 + 0.004 || z < z1 || z > z1 + 0.01 ? 1 : -1), (i, j) => {
      const X = D(i), Y = D(j);
      const cx = (x0 + x1) / 2 - 0.004, cy = (y0 + y1) / 2;
      const rr = Math.hypot(X - cx, Y - cy);
      if (rr < 0.014 && Math.hypot(X - cx - 0.007, Y - cy + 0.002) > 0.012) return C.goldL; // a little gold crescent
      if ((X < x0 + 0.008 || X > x1 - 0.008) && (Y < y0 + 0.008 || Y > y1 - 0.008)) return C.gold; // corner caps
      if (X > x1 - 0.01) return C.leatherS;
      return Y > y1 - 0.012 ? C.leatherL : C.leather;
    }, VF.SOFTAO);
    rig.socket('scroll', 'book', P((x0 + x1) / 2, (y0 + y1) / 2, z1));
  }

  // ================================================================ legs
  {
    const th = rig.part('thigh_l', 'pelvis', P(...J.hip));
    blob(th, [{ a: P(...J.hip), b: P(...J.knee), r0: U(0.025), r1: U(0.016) }], plumage, { k: U(0.01) });
    const sh = rig.part('shin_l', 'thigh_l', P(...J.knee));
    ell(sh, P(J.knee[0], J.knee[1] - 0.004, J.knee[2] - 0.002), [U(0.0125), U(0.013), U(0.0125)], C.skin);
    cap(sh, P(...J.knee), P(...J.ankle), U(0.0085), U(0.0078), (_i, j) => (j % 3 === 0 ? C.skinS : C.skin));
    const ft = rig.part('foot_l', 'shin_l', P(...J.ankle));
    const ax = J.ankle[0];
    ell(ft, P(ax, 0.018, 0.004), [U(0.017), U(0.014), U(0.02)], C.skin);
    const toes: [V3, V3][] = [
      [[ax - 0.004, 0.012, 0.01], [ax - 0.024, 0.009, 0.056]],
      [[ax, 0.012, 0.012], [ax + 0.002, 0.009, 0.064]],
      [[ax + 0.004, 0.012, 0.01], [ax + 0.026, 0.009, 0.054]],
      [[ax, 0.012, -0.004], [ax + 0.002, 0.008, -0.036]],
    ];
    for (const [a, b] of toes) {
      cap(ft, Pv(a), Pv(b), U(0.0105), U(0.0085), (_i, _j, k) => ((k & 1) === 0 ? C.skinL : C.skin));
      const d = norm3(sub3(b, a));
      cap(ft, Pv(b), Pv(add3(b, [d[0] * 0.01, -0.004, d[2] * 0.01])), U(0.005), U(0.003), C.claw);
    }
    finish(ft);
    rig.mirror('thigh_l', 'thigh_r');
    rig.mirror('shin_l', 'shin_r', 'thigh_r');
    rig.mirror('foot_l', 'foot_r', 'shin_r');
  }

  for (const n of ['pelvis', 'torso', 'arm_l', 'arm_r', 'thigh_l', 'thigh_r', 'wing_l', 'wing_r', 'tail']) finish(rig.m(n), { skip: (c) => c === C.gold || c === C.goldL || c === C.lapis });

  rig.socket('head_top', 'head', P(0, 0.69, -0.012));
  rig.socket('chest', 'torso', P(0, 0.25, 0.085));
  return rig.build({
    height: 0.69,
    radius: 0.14,
    eyes: { cell: VS / 2, lift: VS * 0.85, n: EYE_DIR },
    style: 'thoth-v2',
  });
}

/** a chunky four-fingered slate hand on a forearm (s = 1 left, -1 right; right builds mirrored in place) */
function buildHand(m: VoxelModel, s: number) {
  const elbow: V3 = [J.elbow[0] * s, J.elbow[1], J.elbow[2]];
  const wrist = s > 0 ? J.wristL : J.wristR;
  const fist = s > 0 ? J.fistL : J.fistR;
  // a feather cuff at the elbow, the slate forearm, a chubby palm
  ell(m, Pv(lerpV(elbow, wrist, 0.12)), [U(0.017), U(0.017), U(0.017)], C.white);
  cap(m, Pv(elbow), Pv(wrist), U(0.0135), U(0.0125), C.skin);
  ell(m, Pv(lerpV(fist, wrist, 0.3)), [U(0.017), U(0.019), U(0.018)], C.skin);
  if (s > 0) {
    // left: palm on the outside of the notebook's spine, three fat fingers over the cover, the thumb behind
    for (let f = 0; f < 3; f++) {
      const y = fist[1] + 0.013 - f * 0.0125;
      cap(m, P(fist[0] + 0.002, y, fist[2] + 0.009), P(fist[0] - 0.017, y - 0.002, fist[2] + 0.012), U(0.0068), U(0.0062), f === 1 ? C.skinL : C.skin);
    }
    cap(m, P(fist[0], fist[1] + 0.012, fist[2] - 0.01), P(fist[0] - 0.014, fist[1] + 0.016, fist[2] - 0.013), U(0.0062), U(0.0055), C.skin);
  } else {
    // right: a curled fist round the pen, the thumb pressing on top
    for (let f = 0; f < 3; f++) {
      const y = fist[1] + 0.011 - f * 0.0115;
      cap(m, P(fist[0] - 0.004, y, fist[2] + 0.012), P(fist[0] + 0.012, y - 0.002, fist[2] + 0.006), U(0.0068), U(0.0062), f === 1 ? C.skinL : C.skin);
    }
    cap(m, P(fist[0] - 0.008, fist[1] + 0.016, fist[2] + 0.002), P(fist[0] + 0.006, fist[1] + 0.02, fist[2] + 0.01), U(0.0062), U(0.0055), C.skin);
  }
  finish(m);
}

/** the pleated linen shendyt, its gold belt and knot (pelvis), and the pleated apron tab (own part) */
function buildKilt(rig: CRig, pelvis: VoxelModel) {
  const hem = (a: number) => 0.104 + 0.01 * Math.cos(a);
  const R = (Y: number) => 0.06 + (0.19 - Y) * 0.3;
  sdf(pelvis, [-0.1, 0.09, -0.1], [0.1, 0.194, 0.1], (x, y, z) => {
    const a = Math.atan2(x, z);
    if (y > 0.19 || y < hem(a)) return 1;
    return Math.hypot(x / 1.04, (z - 0.004) / 0.98) - R(y);
  }, (i, j, k) => {
    const X = D(i), Y = D(j), Z = D(k);
    const a = Math.atan2(X, Z);
    if (Y > 0.172) {
      // the belt: gold with lapis inlay, a carnelian knot at the front left
      if (Math.hypot(X - 0.034, Y - 0.18) < 0.011 && Z > 0.04) return C.carn;
      return Math.floor((a * 0.07) / 0.0105) % 3 === 0 ? C.lapis : C.gold;
    }
    if (Y < hem(a) + 0.009) return C.linenS;
    const pleat = Math.floor((a * 0.075) / 0.0105) & 1;
    return pleat ? C.linen : C.linenL;
  });
  // the apron tab hanging from the belt
  const ap = rig.part('apron', 'pelvis', P(...J.apron));
  sdf(ap, [-0.04, 0.09, 0.07], [0.04, 0.175, 0.105], (x, y, z) => {
    if (y > 0.174 || y < 0.094) return 1;
    const w = 0.018 + (0.174 - y) * 0.16;
    const zf = 0.084 + (0.174 - y) * 0.2;
    return Math.max(Math.abs(x) - w, Math.abs(z - zf) - 0.006);
  }, (i, j) => {
    const Y = D(j);
    if (Y < 0.104) return C.goldL;
    if (Y > 0.164) return C.goldS;
    const c = Math.abs(D(i));
    return c < 0.006 ? C.gold : (i & 1) === 0 ? C.lapis : C.lapisL;
  });
}

/** the broad bead collar (usekh) over the chest and shoulders */
function buildCollar(torso: VoxelModel) {
  const zone = (x: number, y: number, z: number) => {
    const X = D(x), Y = D(y), Z = D(z);
    const a = Math.atan2(X, Z);
    const lo = 0.256 + 0.026 * (1 - Math.cos(a)) * 0.5;
    return Y > lo && Y < 0.318;
  };
  const col = (x: number, y: number, z: number) => {
    const X = D(x), Y = D(y), Z = D(z);
    const a = Math.atan2(X, Z);
    const lo = 0.256 + 0.026 * (1 - Math.cos(a)) * 0.5;
    const r = Math.floor((Y - lo) / 0.0105);
    if (r <= 0) return Math.floor((a * 0.08) / 0.0105) & 1 ? C.goldL : C.turq; // drop beads
    return [C.carn, C.gold, C.lapis, C.gold, C.turq, C.gold][Math.min(5, r - 1)];
  };
  paint(torso, (x, y, z) => zone(x, y, z) && exposed(torso, x, y, z), col, VF.METAL);
  thicken(torso, (x, y, z) => zone(x, y, z) && exposed(torso, x, y, z) && D(y) < 0.31, (x, y, z) => (zone(x, y, z) ? col(x, y, z) : null), [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]], VF.METAL);
}

const cache: { spec: RigSpec | null } = { spec: null };
/** Thoth, keeper of the Hall (cached: the sculpt runs once) */
export function thothRig(): RigSpec {
  return (cache.spec ??= buildThoth());
}

// =====================================================================================================
// ANIMATION
// =====================================================================================================
export type ThothMode = 'idle' | 'run' | 'hop' | 'write' | 'gasp' | 'delight' | 'stoptime' | 'wave' | 'think' | 'giggle' | 'peek';
export type ThothMood = 'neutral' | 'happy' | 'surprised' | 'sly' | 'sleepy' | 'excited' | 'curious' | 'sad' | 'determined' | 'focus';
/** the mood each mode wears unless one is set */
const MODE_MOOD: Record<ThothMode, ThothMood> = {
  idle: 'neutral', run: 'curious', hop: 'excited', write: 'focus', gasp: 'surprised', delight: 'excited', stoptime: 'determined', wave: 'happy', think: 'sly', giggle: 'happy', peek: 'curious',
};

const damp = (a: number, b: number, l: number, dt: number) => a + (b - a) * (1 - Math.exp(-l * dt));
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
type Tri = [number, number, number];
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _g = new THREE.Vector3();

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

const TH_JOINTS = ['pelvis', 'torso', 'head', 'beak', 'jaw', 'crown', 'tuft', 'lappet_l', 'lappet_r', 'arm_l', 'arm_r', 'fore_l', 'fore_r', 'pen', 'book', 'book_cover', 'wing_l', 'wing_r', 'thigh_l', 'thigh_r', 'shin_l', 'shin_r', 'foot_l', 'foot_r', 'tail', 'apron'];
type Fidget = 'preen' | 'tap' | 'scribble' | 'bounce' | 'tailflick' | 'crown' | 'peekbook' | 'hopturn' | 'yawn' | 'lookback';
const FIDGETS: [Fidget, number, number][] = [
  // name, weight, seconds
  ['preen', 1, 1.6], ['tap', 1.2, 1.4], ['scribble', 1.2, 1.8], ['bounce', 1, 1.0], ['tailflick', 1, 0.7], ['crown', 0.7, 1.3], ['peekbook', 0.8, 1.5], ['hopturn', 0.6, 0.9], ['yawn', 0.3, 2.0], ['lookback', 0.8, 1.6],
];
interface Syl {
  t0: number;
  d: number;
  a: number;
}
/** the material Thoth's voxels draw with: no pixel-detail layer (his stylized look wants clean colour) */
let thothMat: VoxelMaterial | null = null;

/**
 * Thoth's procedural animation. Layered on the rest pose: damped pose targets per
 * mode, a mood that drives the painted eyes and brows, bird-like head saccades and
 * stabilisation, idle fidgets, syllable beak clacks, hops, squash and stretch, and
 * springy secondary motion (crown, tuft, lappets, wings, tail, apron, notebook cover).
 *
 *   const rig = new RigInstance(geo);  const anim = new ThothAnim(rig);
 *   anim.mode = 'run'; anim.speed = 2.5;      // the caller moves rig.root along the ground
 *   anim.lookAt = camera.position;              // eyes lead, the head follows
 *   anim.setMood('excited', 1.5);               // or leave the mood to the mode
 *   anim.talk(1.2, 'Ooh! A new one!');          // beak clacks per syllable (sync with Voice.say)
 *   anim.glance(point, 0.8);  anim.hop();  anim.kick(-3);  anim.flutter();
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
  /** vertical root offset the pose wants this frame (m): run bounce, hops, crouch */
  rootLift = 0;
  /** body lean the pose wants (radians about X), applied on the pelvis already */
  lean = 0;
  /** the mood in effect this frame (set one with setMood) */
  mood: ThothMood = 'neutral';
  eyes: ThothEyes;
  private moodSet: ThothMood | null = null;
  private moodLeft = 0;
  private P: Record<string, Tri> = {};
  private T: Record<string, Tri> = {};
  private base: Record<string, { rot: THREE.Euler; pos: THREE.Vector3 }> = {};
  private sq = new Spring(260, 12);
  private crownS = [new Spring(150, 6), new Spring(150, 6)];
  private tuftS = [new Spring(110, 4.5), new Spring(110, 4.5)];
  private lapS = [new Spring(90, 5), new Spring(90, 5)];
  private wingS = [new Spring(220, 9), new Spring(220, 9)];
  private tailS = new Spring(140, 6);
  private apronS = new Spring(170, 8);
  private coverS = new Spring(120, 11);
  private gait = 0;
  private blink = 0;
  private nextBlink = 1.6;
  private doubleBlink = false;
  // head saccades: the head holds, then snaps to a new heading like a bird's
  private hYaw = 0;
  private hPitch = 0;
  private hYawT = 0;
  private hPitchT = 0;
  private tilt = 0;
  private tTilt = 0;
  private holdT = 0;
  // the eyes' own target (world)
  private eyeT = new THREE.Vector3();
  private eyeHas = false;
  private glanceAt = new THREE.Vector3();
  private glanceLeft = 0;
  private nextGlance = 4;
  private wander = new THREE.Vector3(0, 0.4, 2);
  private nextWander = 0;
  private prevMode: ThothMode = 'idle';
  private modeT = 0;
  private lift = 0;
  private hopY = 0;
  private hopV = 0;
  private fidget: Fidget | null = null;
  private fidgetT = 0;
  private fidgetLen = 1;
  private nextFidget = 3;
  private syl: Syl[] = [];
  private talkT = 0;
  private talkLen = 0;
  private talkAsk = false;
  private talkBang = false;
  private rnd: () => number;

  constructor(public rig: RigInstance, seed = 3) {
    for (const p of rig.geo.parts) this.base[p.name] = { rot: p.rest.clone(), pos: p.offset.clone() };
    for (const n of TH_JOINTS) {
      this.P[n] = [0, 0, 0];
      this.T[n] = [0, 0, 0];
    }
    let s = (seed * 9301 + 49297) % 233280;
    this.rnd = () => (s = (s * 9301 + 49297) % 233280) / 233280;
    this.t = this.rnd() * 10;
    this.nextFidget = 2 + this.rnd() * 3;
    // his voxels draw clean (no pixel-detail layer); the eyes are painted balls
    if (rig.geo.spec.meta?.style === 'thoth-v2') {
      thothMat ??= makeVoxelMaterial({ detail: false });
      for (const m of Object.values(rig.meshes)) if (m.material === rig.material) m.material = thothMat;
      rig.material = thothMat;
    }
    this.eyes = new ThothEyes(rig);
  }

  /** squash & stretch impulse (+ stretch, - squash) */
  kick(a: number) {
    this.sq.v += a;
  }
  /** flap the little wings (excitement) */
  flutter(a = 1) {
    this.wingS[0].v += 14 * a;
    this.wingS[1].v += 14 * a;
    this.tuftS[0].v += 6 * a;
  }
  /** a little hop in place (adds to rootLift) */
  hop(power = 1) {
    if (this.hopY > 0.004) return;
    this.hopV = 0.95 * power;
    this.kick(-2.2 * power);
  }
  /** an excited burst: a hop, a flutter, sparkly eyes */
  excite(power = 1, seconds = 1.2) {
    this.hop(power);
    this.flutter(1.2 * power);
    this.setMood('excited', seconds);
  }
  /** wear a mood for `seconds` (0: until cleared with setMood(null)) */
  setMood(m: ThothMood | null, seconds = 0) {
    this.moodSet = m;
    this.moodLeft = m && seconds > 0 ? seconds : 0;
  }
  /** a quick look at something else (eyes first, the head follows) */
  glance(p: THREE.Vector3, seconds = 0.8) {
    this.glanceAt.copy(p);
    this.glanceLeft = seconds;
    this.blinkNow(0.07);
  }
  /** clack the beak for `seconds` (call alongside Voice.say); with the line's text the clacks follow its syllables */
  talk(seconds: number, text?: string) {
    const dur = Math.max(0.2, seconds);
    this.syl = [];
    const words = (text ?? '').split(/\s+/).filter(Boolean);
    const units: { n: number; pause: number; stress: boolean }[] = [];
    if (words.length) {
      for (const w of words) {
        const n = Math.max(1, (w.toLowerCase().match(/[aeiouy]+/g) ?? []).length);
        units.push({ n, pause: /[.,!?;:]$/.test(w) ? 2.2 : 0.4, stress: /!$/.test(w) || /^[A-Z]{2,}/.test(w) });
      }
    } else for (let i = 0; i < Math.max(1, Math.round(dur * 2.2)); i++) units.push({ n: 1 + Math.floor(this.rnd() * 3), pause: 0.5, stress: this.rnd() < 0.2 });
    const total = units.reduce((a, u) => a + u.n + u.pause, 0);
    const step = dur / total;
    let t = 0;
    for (const u of units) {
      for (let i = 0; i < u.n; i++) {
        const a = (u.stress && i === u.n - 1 ? 1 : 0.55 + this.rnd() * 0.35) * (i === 0 ? 1 : 0.85);
        this.syl.push({ t0: t, d: step * (0.75 + this.rnd() * 0.2), a });
        t += step;
      }
      t += u.pause * step;
    }
    this.talkT = 0;
    this.talkLen = dur;
    this.talkAsk = /\?\s*$/.test(text ?? '');
    this.talkBang = /!/.test(text ?? '');
  }
  /** seconds in the current mode */
  get modeTime() {
    return this.modeT;
  }
  /** he is talking */
  get talking() {
    return this.talkT < this.talkLen;
  }
  dispose() {
    this.eyes.dispose();
  }

  private blinkNow(len = 0.07) {
    if (this.blink > 0) return;
    this.blink = len;
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
    const root = this.rig.root;
    if (this.mode !== this.prevMode) {
      this.prevMode = this.mode;
      this.modeT = 0;
      this.fidget = null;
      if (this.mode === 'gasp') this.kick(-3.2), this.flutter(1.4), this.blinkNow(0.06);
      if (this.mode === 'stoptime') this.kick(-2.5), this.flutter(2);
      if (this.mode === 'delight') this.flutter(1.2);
      if (this.mode === 'giggle') this.kick(1.2);
    }
    this.modeT += dt;
    const mt = this.modeT;
    for (const n of TH_JOINTS) this.set(n, 0, 0, 0);
    let l = 14;
    let lift = 0;
    let lookW = 1;
    let jawOpen = 0;
    let wingOut = 0;
    let lean = 0;
    let cover = 0;
    let eyeSquash = 0;
    let headFwd = 0;
    let stab = 0.5; // how much the head cancels the body's sway (birds hold their heads still)
    let mood: ThothMood = MODE_MOOD[this.mode] ?? 'neutral';
    let lookPen = false;

    // ---------------------------------------------------------------- idle fidgets
    if (this.mode === 'idle' && !this.talking) {
      this.nextFidget -= dt;
      if (!this.fidget && this.nextFidget <= 0) {
        const total = FIDGETS.reduce((a, f) => a + f[1], 0);
        let r = R() * total;
        for (const f of FIDGETS) {
          r -= f[1];
          if (r <= 0) {
            this.fidget = f[0];
            this.fidgetLen = f[2];
            break;
          }
        }
        this.fidgetT = 0;
        this.nextFidget = 2.2 + R() * 3.5;
        if (this.fidget === 'hopturn' || this.fidget === 'bounce') this.hop(this.fidget === 'hopturn' ? 0.8 : 0.55);
        if (this.fidget === 'tailflick') this.tailS.v += 9;
      }
    } else if (this.mode !== 'idle') this.fidget = null;
    if (this.fidget) {
      this.fidgetT += dt;
      if (this.fidgetT >= this.fidgetLen) this.fidget = null;
    }

    // ---------------------------------------------------------------- mode poses
    switch (this.mode) {
      case 'idle': {
        // a gentle weight shift, the notebook hugged, the pen held ready
        const sway = Math.sin(t * 1.25);
        this.set('pelvis', 0, sway * 0.05, sway * 0.03);
        this.set('torso', 0.02, -sway * 0.04, -sway * 0.02);
        this.set('arm_r', -0.12, 0, -0.06);
        this.set('fore_r', -0.3);
        this.set('arm_l', -0.08, 0, 0.02);
        this.set('fore_l', -0.12);
        this.set('thigh_l', 0, 0, sway * 0.03);
        this.set('thigh_r', 0, 0, sway * 0.03);
        const f = this.fidget, k = this.fidget ? this.fidgetT / this.fidgetLen : 0;
        const env = sstep(0, 0.18, k) * (1 - sstep(0.78, 1, k));
        if (f === 'preen') {
          // nibbles at his left wing: head down and round, beak working
          this.set('head', 0.55 * env, 0.9 * env, 0.25 * env);
          this.set('wing_l', 0, 0, 0);
          wingOut = 0.45 * env;
          jawOpen = env * Math.max(0, Math.sin(t * 26)) * 0.25;
          lookW = 1 - env;
          mood = 'focus';
          eyeSquash = 0.4 * env;
        } else if (f === 'tap') {
          // taps the pen on his beak, thinking
          this.set('arm_r', -1.05 * env, 0.2 * env, 0.25 * env);
          this.set('fore_r', -1.45 * env + Math.max(0, Math.sin(t * 13)) * 0.18 * env);
          this.set('head', -0.15 * env, -0.25 * env, -0.18 * env);
          mood = env > 0.5 ? 'sly' : mood;
          lookW = 1 - env * 0.7;
        } else if (f === 'scribble') {
          // a quick note
          this.set('arm_l', -0.45 * env, -0.1 * env, -0.35 * env);
          this.set('fore_l', -0.7 * env);
          this.set('book', 0.35 * env, -0.3 * env, 0);
          this.set('arm_r', -0.75 * env, 0.25 * env, 0.45 * env);
          this.set('fore_r', -0.95 * env + Math.sin(t * 30) * 0.08 * env, 0.35 * env + Math.sin(t * 11) * 0.15 * env);
          this.set('head', 0.4 * env, 0.15 * env, 0);
          cover = env;
          lookPen = env > 0.3;
          lookW = 1 - env;
          mood = 'focus';
        } else if (f === 'bounce') {
          this.set('arm_l', -0.2 * env, 0, 0.35 * env);
          this.set('arm_r', -0.2 * env, 0, -0.35 * env);
          mood = 'happy';
        } else if (f === 'crown') {
          // straightens his moon with a little proud tug
          this.set('arm_r', -2.5 * env, 0, -0.35 * env);
          this.set('fore_r', -1.2 * env);
          this.set('head', -0.08 * env, 0, -0.12 * env + Math.sin(t * 18) * 0.04 * env);
          if (env > 0.6 && R() < dt * 6) this.crownS[1].v += 3;
          mood = env > 0.5 ? 'happy' : mood;
        } else if (f === 'peekbook') {
          // checks his notes with a satisfied nod
          this.set('arm_l', -0.45 * env, -0.1 * env, -0.3 * env);
          this.set('fore_l', -0.7 * env);
          this.set('book', 0.35 * env, -0.3 * env, 0);
          this.set('head', (0.45 + Math.sin(t * 9) * 0.08 * sstep(0.5, 0.7, k)) * env, 0.3 * env, 0.1 * env);
          cover = 0.55 * env;
          lookPen = env > 0.3;
          lookW = 1 - env;
          mood = k > 0.55 ? 'happy' : 'curious';
        } else if (f === 'hopturn') {
          this.set('pelvis', 0, Math.sin(k * Math.PI) * 0.6, 0);
          this.set('arm_l', -0.4 * env, 0, 0.5 * env);
          this.set('arm_r', -0.4 * env, 0, -0.5 * env);
          wingOut = 0.5 * env;
          mood = 'excited';
        } else if (f === 'yawn') {
          // a huge little yawn: stretches up, beak wide, eyes squeezed
          this.set('arm_l', -2.6 * env, 0, 0.4 * env);
          this.set('arm_r', -2.6 * env, 0, -0.4 * env);
          this.set('fore_l', -0.4 * env);
          this.set('fore_r', -0.4 * env);
          this.set('head', -0.35 * env, 0, 0.1 * env);
          this.set('torso', -0.12 * env);
          jawOpen = 0.6 * sstep(0.15, 0.4, k) * (1 - sstep(0.7, 0.9, k));
          lift = 0.01 * env;
          lookW = 1 - env;
          mood = 'sleepy';
          eyeSquash = env;
        } else if (f === 'lookback') {
          // something behind him? a long curious look over his shoulder
          this.set('head', 0.05 * env, -1.1 * env, 0.3 * env);
          this.set('torso', 0, -0.35 * env, 0);
          lookW = 1 - env;
          mood = 'curious';
        }
        break;
      }
      case 'think': {
        // the pen on the beak, head cocked, a little foot tap
        this.set('arm_r', -1.0, 0.25, 0.25);
        this.set('fore_r', -1.5 + Math.max(0, Math.sin(t * 7)) * 0.12, 0.3, 0);
        this.set('arm_l', -0.25, 0, 0.12);
        this.set('fore_l', -0.45);
        this.set('head', -0.16, 0, 0.32);
        this.set('foot_l', -0.25 * Math.max(0, Math.sin(t * 9)));
        lookW = 0.35;
        break;
      }
      case 'run': {
        // a toddler's scamper: quick steps, big arm pumps, leaning in, the head held level
        const f = clamp(2.4 + this.speed * 0.9, 2.6, 6.5);
        this.gait += dt * f * Math.PI;
        const g = this.gait;
        const s = Math.sin(g), c = Math.cos(g);
        const st = clamp(0.55 + this.speed * 0.12, 0.6, 1.0);
        this.set('thigh_l', -st * s - 0.1);
        this.set('thigh_r', st * s - 0.1);
        this.set('shin_l', 0.25 + Math.max(0, c) * 1.0 * st);
        this.set('shin_r', 0.25 + Math.max(0, -c) * 1.0 * st);
        this.set('foot_l', -0.3 * Math.max(0, -s) + 0.25 * Math.max(0, s));
        this.set('foot_r', -0.3 * Math.max(0, s) + 0.25 * Math.max(0, -s));
        this.set('arm_l', 0.7 * s - 0.25, 0, 0.2);
        this.set('arm_r', -0.7 * s - 0.25, 0, -0.2);
        this.set('fore_l', -0.55 - 0.25 * Math.max(0, -s));
        this.set('fore_r', -0.6 - 0.25 * Math.max(0, s));
        this.set('pelvis', 0, 0.12 * s, 0.04 * c);
        this.set('torso', 0.06, -0.14 * s, 0.03 * c);
        lean = 0.14 + this.speed * 0.025;
        lift = Math.abs(Math.sin(g)) * 0.024 * st;
        this.set('head', -0.1 - lean * 0.6, 0, 0);
        // the pigeon bob: the head pushes ahead, then holds while the body catches up
        headFwd = (((g / Math.PI) % 1) < 0.35 ? 1 : 0) * 0.006;
        this.set('tail', 0.15 * Math.abs(s));
        wingOut = 0.2 + 0.15 * Math.abs(s);
        stab = 0.8;
        lookW = 0.55;
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
        // the notebook up in front of his chest, cover open, head bowed, the pen scribbling
        this.set('arm_l', -0.45, -0.1, -0.35);
        this.set('fore_l', -0.7, 0, 0);
        this.set('book', 0.35, -0.3, 0);
        this.set('arm_r', -0.75, 0.25, 0.45);
        this.set('fore_r', -0.95, 0.35, 0);
        const sc = Math.sin(t * 31), sc2 = Math.sin(t * 13.7);
        this.add('fore_r', sc * 0.06, sc2 * 0.16, 0);
        this.add('arm_r', 0, 0, Math.sin(t * 5.1) * 0.05);
        this.set('head', 0.38, -0.1 + sc2 * 0.05, -0.1);
        this.set('torso', 0.08, 0, 0);
        jawOpen = 0.05 + Math.max(0, Math.sin(t * 4.3)) * 0.04; // concentrating, beak just parted
        cover = 1;
        lookPen = true;
        lookW = 0;
        l = 18;
        break;
      }
      case 'gasp': {
        // a sharp intake: leans back, hands up by his cheeks, beak wide, eyes huge
        const k = sstep(0, 0.12, mt);
        this.set('torso', -0.22 * k);
        this.set('head', -0.25 * k);
        this.set('arm_l', -1.5 * k, 0, 0.45 * k);
        this.set('arm_r', -1.5 * k, 0, -0.45 * k);
        this.set('fore_l', -1.35 * k);
        this.set('fore_r', -1.35 * k);
        this.set('thigh_l', 0.1 * k);
        this.set('thigh_r', 0.1 * k);
        jawOpen = 0.55 * k;
        wingOut = 0.75 * k;
        lookW = 0.6;
        stab = 0;
        l = 30;
        break;
      }
      case 'delight': {
        // bouncy hops in place, arms up, eyes squeezing happy at the top of each bounce
        const b = Math.abs(Math.sin(mt * 8.5));
        lift = b * 0.055;
        const tuck = 1 - b;
        this.set('thigh_l', -0.4 * b - 0.3 * tuck);
        this.set('thigh_r', -0.4 * b - 0.3 * tuck);
        this.set('shin_l', 0.7 * b + 0.6 * tuck);
        this.set('shin_r', 0.7 * b + 0.6 * tuck);
        this.set('arm_l', -2.4 + Math.sin(mt * 17) * 0.25, 0, 0.35);
        this.set('arm_r', -2.4 - Math.sin(mt * 17) * 0.25, 0, -0.35);
        this.set('fore_l', -0.3);
        this.set('fore_r', -0.3);
        this.set('torso', -0.1, Math.sin(mt * 4.25) * 0.15, 0);
        this.set('head', -0.18, 0, Math.sin(mt * 4.25) * 0.24);
        jawOpen = 0.35;
        wingOut = 0.6 + 0.4 * b;
        if (b > 0.85) mood = 'happy';
        lookW = 0.35;
        stab = 0;
        l = 26;
        break;
      }
      case 'stoptime': {
        // feet planted wide, the pen thrust up like a wand, notebook flung out, beak shouting
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
        wingOut = 1.25 * k;
        lift = -0.012 * k;
        cover = 0.5 * k;
        lookW = 0.2;
        stab = 0;
        l = 32;
        break;
      }
      case 'wave': {
        this.set('arm_r', -2.5, 0, -0.5 + Math.sin(t * 10) * 0.35);
        this.set('fore_r', -0.5 + Math.sin(t * 10 + 0.6) * 0.3);
        this.set('arm_l', -0.15, 0, 0.1);
        this.set('head', 0, 0, Math.sin(t * 5) * 0.14);
        this.set('pelvis', 0, 0, Math.sin(t * 5) * 0.04);
        jawOpen = 0.2;
        wingOut = 0.25;
        lookW = 0.85;
        break;
      }
      case 'giggle': {
        // a hand over the beak, shoulders shaking with little hee-hees
        const sh = Math.sin(t * 24) * 0.5 + 0.5;
        this.set('arm_l', -1.25, 0.2, -0.15);
        this.set('fore_l', -1.45, 0, 0);
        this.set('arm_r', -0.3, 0, -0.2);
        this.set('fore_r', -0.5);
        this.set('torso', 0.12 + sh * 0.05, 0, Math.sin(t * 12) * 0.05);
        this.set('head', 0.15 + sh * 0.06, 0.25, 0.22);
        jawOpen = 0.12 + sh * 0.1;
        lift = sh * 0.006;
        lookW = 0.5;
        break;
      }
      case 'peek': {
        // leans right in for a close look, up on his toes, beak first
        const k = sstep(0, 0.25, mt);
        this.set('pelvis', 0.22 * k);
        this.set('torso', 0.18 * k);
        this.set('head', -0.15 * k, 0, 0.35 * k + Math.sin(t * 2.2) * 0.06 * k);
        this.set('arm_l', 0.3 * k, 0, 0.1 * k);
        this.set('arm_r', 0.35 * k, 0, -0.15 * k);
        this.set('foot_l', 0.35 * k);
        this.set('foot_r', 0.35 * k);
        this.set('shin_l', -0.15 * k);
        this.set('shin_r', -0.15 * k);
        this.set('tail', 0.35 * k);
        lift = 0.01 * k;
        headFwd = 0.012 * k;
        lookW = 1;
        break;
      }
    }
    // mood: a set one wins, then the talking flavour, then the pose's own
    if (this.moodLeft > 0) {
      this.moodLeft -= dt;
      if (this.moodLeft <= 0) this.moodSet = null;
    }
    if (this.moodSet) mood = this.moodSet;
    else if (this.talking && this.mode === 'idle') mood = this.talkBang ? 'excited' : 'happy';
    this.mood = mood;

    // ---------------------------------------------------------------- where to look
    this.nextWander -= dt;
    this.glanceLeft -= dt;
    this.nextGlance -= dt;
    let target: THREE.Vector3 | null = null;
    if (lookPen) target = this.rig.sockets.nib?.getWorldPosition(_g) ?? null;
    else if (this.glanceLeft > 0) target = this.glanceAt;
    else if (this.lookAt) {
      target = this.lookAt;
      // even while he watches you, his eyes wander off to something now and then
      if (this.nextGlance <= 0 && !this.talking && this.mode === 'idle') {
        this.nextGlance = 3.5 + R() * 5;
        root.updateWorldMatrix(true, false);
        this.glance(root.localToWorld(_w.set((R() - 0.5) * 3, 0.2 + R() * 1.2, 0.6 + R() * 1.5)), 0.5 + R() * 0.6);
      }
    } else {
      if (this.nextWander <= 0) {
        this.nextWander = 0.8 + R() * 2.2;
        this.wander.set((R() - 0.5) * 3.2, 0.1 + R() * 0.9, 0.5 + R() * 2);
      }
      root.updateWorldMatrix(true, false);
      target = root.localToWorld(_w.copy(this.wander));
    }
    if (target) {
      this.eyeT.copy(target);
      this.eyeHas = true;
    }
    // the head: holds, then snaps toward where the eyes are (saccades); a curious tilt
    if (this.eyeHas) {
      root.updateWorldMatrix(true, false);
      const p = root.worldToLocal(_v.copy(this.eyeT));
      const sc = root.scale.y || 1;
      const yaw = clamp(Math.atan2(p.x, p.z), -1.25, 1.25);
      const pitch = clamp(-Math.atan2(p.y - 0.45 * sc, Math.hypot(p.x, p.z)), -0.6, 0.55);
      this.holdT -= dt;
      const err = Math.abs(yaw - this.hYawT) + Math.abs(pitch - this.hPitchT);
      if (err > 0.18 || this.holdT <= 0) {
        this.hYawT = yaw;
        this.hPitchT = pitch;
        this.holdT = 0.5 + R() * 1.2;
        if (err > 0.6) this.blinkNow(0.07); // big head turns come with a blink
      }
    }
    if (R() < dt * 0.3) this.tTilt = R() < 0.55 ? (R() < 0.5 ? -0.3 : 0.3) : 0;
    if (this.talking && this.talkAsk && this.talkT > this.talkLen * 0.6) this.tTilt = 0.32;
    this.hYaw = damp(this.hYaw, this.hYawT, 16, dt);
    this.hPitch = damp(this.hPitch, this.hPitchT, 16, dt);
    this.tilt = damp(this.tilt, this.tTilt, 7, dt);

    // look on top (head and a touch of torso)
    this.add('head', this.hPitch * 0.75 * lookW, this.hYaw * 0.72 * lookW, this.tilt * lookW);
    this.add('torso', 0, this.hYaw * 0.18 * lookW, 0);
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
    // hops in place: a little ballistic arc on top of the pose's own lift
    if (this.hopV !== 0 || this.hopY > 0) {
      this.hopV -= 9.8 * dt;
      this.hopY += this.hopV * dt;
      if (this.hopY <= 0) {
        this.hopY = 0;
        if (this.hopV < -0.3) this.kick(-2.6 * Math.min(1, -this.hopV));
        this.hopV = 0;
      }
    }
    this.lift = damp(this.lift, lift, this.mode === 'run' || this.mode === 'delight' || this.mode === 'hop' ? 40 : 12, dt);
    this.rootLift = this.lift + this.hopY;

    // ---------------------------------------------------------------- talking: one beak clack per syllable
    let chat = 0;
    if (this.talking) {
      this.talkT += dt;
      for (const s of this.syl) {
        const u = (this.talkT - s.t0) / s.d;
        if (u > 0 && u < 1) chat = Math.max(chat, Math.pow(Math.sin(u * Math.PI), 0.7) * s.a);
      }
    }
    // ---------------------------------------------------------------- secondary motion
    const breathe = Math.sin(t * 2.3);
    const ph = this.P.head, pt = this.P.torso;
    const cr0 = this.crownS[0].step(-ph[0] * 0.5, dt), cr1 = this.crownS[1].step(-ph[2] * 0.6 - ph[1] * 0.1, dt);
    const tf0 = this.tuftS[0].step(-ph[0] * 0.8 + this.hopV * 0.12, dt), tf1 = this.tuftS[1].step(-ph[2] * 0.8 - ph[1] * 0.3, dt);
    const lp0 = this.lapS[0].step(-ph[0] * 0.7 - pt[0] * 0.4 + this.hopV * 0.08, dt), lp1 = this.lapS[1].step(-ph[2] * 0.7, dt);
    const w0 = this.wingS[0].step(wingOut, dt), w1 = this.wingS[1].step(wingOut, dt);
    const tl = this.tailS.step(this.mode === 'run' ? 0.25 : 0, dt);
    const ap = this.apronS.step(-this.P.thigh_l[0] * 0.25 - this.P.thigh_r[0] * 0.25 + this.lean * 0.6 + this.hopV * 0.1, dt);
    const cv = this.coverS.step(cover, dt);
    // blinking (now and then a double)
    this.nextBlink -= dt;
    if (this.nextBlink <= 0) {
      this.nextBlink = this.doubleBlink ? 0.22 : 1.6 + R() * 3.4;
      this.doubleBlink = !this.doubleBlink && R() < 0.22;
      this.blinkNow(0.06 + R() * 0.03);
    }
    this.blink = Math.max(0, this.blink - dt);

    // ---------------------------------------------------------------- write the joints
    const rot = (n: string, x: number, y: number, z: number) => {
      const node = this.rig.nodes[n];
      const b = this.base[n];
      if (!node || !b) return;
      node.rotation.set(b.rot.x + x, b.rot.y + y, b.rot.z + z);
    };
    const W = (n: string, dx = 0, dy = 0, dz = 0) => {
      const c = this.P[n];
      if (c) rot(n, c[0] + dx, c[1] + dy, c[2] + dz);
    };
    // the head cancels part of the body's sway (stabilised like a bird's)
    const bodyY = this.P.pelvis[1] + this.P.torso[1], bodyZ = this.P.pelvis[2] + this.P.torso[2];
    W('pelvis');
    W('torso', breathe * 0.03);
    W('head', -breathe * 0.02 + chat * 0.05, -bodyY * stab, -bodyZ * stab);
    const hb = this.base.head, hn = this.rig.nodes.head;
    if (hb && hn) hn.position.set(hb.pos.x, hb.pos.y + breathe * 0.0012, hb.pos.z + headFwd);
    W('beak', -chat * 0.06);
    W('jaw', clamp(jawOpen + chat * 0.42, 0, 0.75));
    W('crown', cr0 * 0.6, 0, cr1 * 0.6);
    W('tuft', tf0, 0, tf1);
    W('lappet_l', lp0, 0, Math.max(0, lp1) * 0.6);
    W('lappet_r', lp0, 0, Math.min(0, lp1) * 0.6);
    for (const n of ['arm_l', 'arm_r', 'fore_l', 'fore_r', 'pen', 'book', 'thigh_l', 'thigh_r', 'shin_l', 'shin_r', 'foot_l', 'foot_r']) W(n);
    W('book_cover', 0, clamp(cv, -0.1, 1.2) * 2.6, 0);
    W('wing_l', -w0 * 0.25 + breathe * 0.02, w0 * 0.3, w0 * 0.85);
    W('wing_r', -w1 * 0.25 + breathe * 0.02, -w1 * 0.3, -w1 * 0.85);
    W('tail', tl + Math.sin(t * 3.1) * 0.04, Math.sin(t * 2.3) * 0.08, 0);
    W('apron', clamp(ap, -0.6, 0.6));
    // squash & stretch (volume preserving) on the whole body
    const s = clamp(this.sq.step(0, dt) + chat * 0.015, -0.3, 0.3);
    this.rig.nodes.pelvis?.scale.set(1 - s * 0.45, 1 + s, 1 - s * 0.45);

    // ---------------------------------------------------------------- the pixel dot eyes
    // the mood picks a tiny pixel shape; blinks squash the dot to a dash for a frame or two
    let dot: EyeDot = mood === 'happy' ? 'happy' : mood === 'surprised' ? 'big' : mood === 'sleepy' ? 'sleepy' : 'dot';
    if (eyeSquash > 0.5) dot = mood === 'happy' ? 'happy' : 'blink';
    if (this.blink > 0 && dot !== 'happy') dot = 'blink';
    const spark = mood === 'excited' && Math.floor(t * 7) % 3 !== 0;
    // gaze: the dots slide one cell toward what he is looking at (both together, in head space)
    let gx = 0, gy = 0;
    const hn2 = this.rig.nodes.head;
    if (this.eyeHas && hn2 && dot !== 'blink') {
      hn2.updateWorldMatrix(true, false);
      _v.copy(this.eyeT);
      hn2.worldToLocal(_v);
      _v.sub(_w.set(0, 0.14, 0.09)).normalize();
      gx = _v.x > 0.32 ? 1 : _v.x < -0.32 ? -1 : 0;
      gy = _v.y > 0.38 ? 1 : _v.y < -0.38 ? -1 : 0;
    }
    for (let i = 0; i < 2; i++) this.eyes.set(i, dot, gx, gy, spark);
  }
}
