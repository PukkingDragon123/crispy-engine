// The dromedary (1/40 m, realistic proportions): a deep chest and tucked belly
// under one tall hump crowned with shaggy fur tufts, long slender legs with
// knobbly calloused knees and broad two-toed padded feet, a long U-curved neck,
// and an expressive face: heavy hooded upper lids with long curled lashes over
// glossy modelled eyes, a bony brow, small rounded ears, slit nostrils, a split
// (cleft) upper lip and a droopy lower lip. Dressed as a pack camel: a woven
// kilim saddle blanket with a fringe, a wooden pack-saddle frame lashed with
// rope, a bedroll, leather saddlebags, a goatskin water bag, a clay jug and a
// tasselled halter with brass studs and a lead rope.
//
// Rig (camel/quadruped convention, extended):
//   body (root) → neck → head → jaw, eye_l/eye_r, lid_l/lid_r, ear_l/ear_r
//   body → leg_fl/leg_fr (shoulder → knee) → shin_fl/shin_fr (knee → foot)
//   body → leg_bl/leg_br (hip → hock) → shin_bl/shin_br (hock → foot)
//   body → tail → tail_tip
// `CamelIdle` animates it: chewing (lateral grind), blinking heavy lids, ear
// flicks, tail swish, head look-around, breathing and an optional kneel (cush).
import * as THREE from 'three';
import type { RigSpec, V3 } from '../../../engine/voxel/Rig';
import type { RigInstance } from '../../../engine/voxel/Rig';
import { RBm, Sc, M3, VF, mix, mulRGB, hash3, noise, ell, cap, tube, paint, hollow, lumpy } from '../enemies/real/rk';
import { VoxelModel } from '../../../engine/voxel/VoxelModel';
import { Prim, splitInto, wetEye, thicken, smoothVox, fur as cfur, norm3 } from './ckit';
import { plate, castIn, normalAt, type Pal } from './mkit';

const VS = 1 / 40;
export const CAMEL_EXPRESSIONS = ['neutral', 'bored', 'smug', 'spit'];

const HIDE = { base: 0xc49a64, light: 0xdcbc8a, dark: 0x9a7248, belly: 0xdcc39a, shag: 0x8a623c, muzzle: 0xd2b896, callus: 0x6e5844, pad: 0x4e3e32, nail: 0x2a201a };
const KILIM = { red: 0x9a2e22, deep: 0x5e1a16, indigo: 0x2c3a6c, ochre: 0xd09a3a, cream: 0xeadcc0, green: 0x3e6a4a };
const WOOD = { base: 0x7a5432, dark: 0x553820, hi: 0x9a6e44 };
const LEATHER = { base: 0x6e4428, dark: 0x4a2c18, hi: 0x8e5a36 };
const ROPE: [number, number] = [0xc8a66e, 0x9a7a48];
const BRASS = 0xd8a840;
/** the calluses: thick, worn keratin pads (chest, knees, elbows, stifles, hocks) */
const CALLUS: Pal = { top: 0xb4a088, mid: 0x8a745e, base: 0x5a4a3c, rim: 0x6c5a48, ring: 0x7a6650, crack: 0x3a2e26, sand: 0x5a4a3c };

const V = (p: M3): V3 => [p[0] / VS, p[1] / VS, p[2] / VS];
const E = (c: M3, r: M3, rot?: V3, sub = false): Prim => ({ c: V(c), r: [r[0] / VS, r[1] / VS, r[2] / VS], rot, sub });
const C = (a: M3, b: M3, r0: number, r1: number): Prim => ({ a: V(a), b: V(b), r0: r0 / VS, r1: r1 / VS });
/** voxel index -> metres (voxel centre) */
const M = (i: number) => (i + 0.5) * VS;

/** the camel's coat: soft fur streaks, lighter belly / legs / muzzle, darker shaggy hump and withers */
const coatFur = cfur(HIDE.base, HIDE.light, HIDE.dark, 2.6, 4, [1, 2.4, 1.3]);
function coat(x: number, y: number, z: number) {
  const Y = M(y), Z = M(z);
  let c = coatFur(x, y, z);
  if (Y < 1.32 && Z < 1.0) c = mix(c, HIDE.belly, Math.min(0.75, (1.32 - Y) * 3));
  if (Y > 1.9 && Z < 0.3 && Z > -0.5) c = mix(c, HIDE.shag, Math.min(0.6, (Y - 1.9) * 3.5));
  if (Z > 1.58) c = mix(c, HIDE.muzzle, Math.min(0.7, (Z - 1.58) * 4));
  if (Z > 0.9 && Z < 1.3 && Y < 1.55) c = mix(c, HIDE.light, 0.25); // pale throat
  return c;
}
/** legs: coat fading to a paler, dustier lower leg */
function legCoat(x: number, y: number, z: number) {
  const Y = M(y);
  const c = coatFur(x, y, z);
  return Y < 0.7 ? mix(c, 0xd8c4a0, Math.min(0.5, (0.7 - Y) * 1.2)) : c;
}

/**
 * Organic smooth union of ellipsoids / tapered capsules (+ smooth subtractions),
 * evaluated block by block with only the primitives that can reach each block
 * (same maths as ckit's blob, much faster for a big body).
 */
function fastBlob(m: VoxelModel, prims: Prim[], col: (x: number, y: number, z: number) => number, k: number, disp: (x: number, y: number, z: number) => number) {
  const box = prims.map((q) => {
    const pad = k + 2.5;
    if (q.a && q.b) {
      const R = Math.max(q.r0 ?? 1, q.r1 ?? 1) + pad;
      return [Math.min(q.a[0], q.b[0]) - R, Math.min(q.a[1], q.b[1]) - R, Math.min(q.a[2], q.b[2]) - R, Math.max(q.a[0], q.b[0]) + R, Math.max(q.a[1], q.b[1]) + R, Math.max(q.a[2], q.b[2]) + R];
    }
    const R = Math.max(q.r![0], q.r![1], q.r![2]) + pad;
    return [q.c![0] - R, q.c![1] - R, q.c![2] - R, q.c![0] + R, q.c![1] + R, q.c![2] + R];
  });
  const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
  prims.forEach((q, i) => {
    if (q.sub) return;
    for (let a = 0; a < 3; a++) {
      lo[a] = Math.min(lo[a], box[i][a]);
      hi[a] = Math.max(hi[a], box[i][a + 3]);
    }
  });
  const sd = (q: Prim, px: number, py: number, pz: number) => {
    if (q.a && q.b) {
      const a = q.a, b = q.b;
      const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
      const ax = px - a[0], ay = py - a[1], az = pz - a[2];
      const t = Math.max(0, Math.min(1, (ax * dx + ay * dy + az * dz) / (dx * dx + dy * dy + dz * dz || 1e-6)));
      return Math.hypot(ax - dx * t, ay - dy * t, az - dz * t) - ((q.r0 ?? 1) + ((q.r1 ?? q.r0 ?? 1) - (q.r0 ?? 1)) * t);
    }
    const c = q.c!, r = q.r!;
    const vx = px - c[0], vy = py - c[1], vz = pz - c[2];
    const k0 = Math.hypot(vx / r[0], vy / r[1], vz / r[2]);
    const k1 = Math.hypot(vx / (r[0] * r[0]), vy / (r[1] * r[1]), vz / (r[2] * r[2])) || 1e-6;
    return (k0 * (k0 - 1)) / k1;
  };
  const smin = (a: number, b: number) => {
    const h = Math.max(k - Math.abs(a - b), 0) / k;
    return Math.min(a, b) - h * h * k * 0.25;
  };
  const B = 8;
  for (let bx = Math.floor(lo[0]); bx <= hi[0]; bx += B)
    for (let by = Math.floor(lo[1]); by <= hi[1]; by += B)
      for (let bz = Math.floor(lo[2]); bz <= hi[2]; bz += B) {
        const act: Prim[] = [];
        prims.forEach((q, i) => {
          const b = box[i];
          if (b[0] <= bx + B && b[3] >= bx && b[1] <= by + B && b[4] >= by && b[2] <= bz + B && b[5] >= bz) act.push(q);
        });
        if (!act.some((q) => !q.sub)) continue;
        for (let i = bx; i < bx + B; i++)
          for (let j = by; j < by + B; j++)
            for (let kk = bz; kk < bz + B; kk++) {
              const px = i + 0.5, py = j + 0.5, pz = kk + 0.5;
              let d = 1e9;
              let first = true;
              for (const q of act) {
                const di = sd(q, px, py, pz);
                if (q.sub) d = -smin(-d, di);
                else if (first) {
                  d = di;
                  first = false;
                } else d = smin(d, di);
              }
              if (d > 2.5) continue;
              if (d + disp(px, py, pz) > 0) continue;
              m.set(i, j, kk, col(i, j, kk));
            }
      }
}

const N6: [number, number, number][] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
/** shaggy fur tufts: clumps chosen by noise, hairs 1..len voxels outward (and slightly downward) */
function tufts(m: VoxelModel, pred: (X: number, Y: number, Z: number) => boolean, col: (src: number, t: number) => number, density: number, len: number, seed: number) {
  const add: [number, number, number, number][] = [];
  m.forEach((x, y, z, c) => {
    if (!pred(M(x), M(y), M(z))) return;
    const clump = noise.n3(x * 0.33 + seed, y * 0.33, z * 0.33 - seed) * 0.5 + 0.5;
    if (hash3(x + seed, y, z) > density * (0.4 + clump)) return;
    const start = Math.floor(hash3(x, y + seed * 3, z) * 6);
    for (let k = 0; k < 6; k++) {
      const [dx, dy, dz] = N6[(start + k) % 6];
      if (dy < 0 || m.has(x + dx, y + dy, z + dz)) continue;
      const L = 1 + Math.floor(clump * len * hash3(z, x, y + seed));
      for (let l = 1; l <= L; l++) {
        const sag = dy === 0 && l > 1 ? -1 : 0;
        add.push([x + dx * l, y + dy * l + sag, z + dz * l, col(c, l / L)]);
      }
      break;
    }
  });
  for (const [x, y, z, c] of add) if (!m.has(x, y, z)) m.set(x, y, z, c);
}

/** woven kilim pattern (by metres on the blanket): a deep red field, clean woven bands, a dark border */
function kilim(Y: number, Z: number, edge: number) {
  if (edge < 0.03) return KILIM.deep;
  if (edge < 0.05) return KILIM.ochre;
  if (edge < 0.065) return KILIM.deep;
  // two bands down each flank: indigo with a row of cream lozenges, then ochre
  const by = Y - 1.36;
  const lz = ((Z + 2) % 0.12) / 0.12 - 0.5;
  if (by > 0.1 && by < 0.17) return Math.abs(lz) * 0.12 < (0.035 - Math.abs(by - 0.135)) * 0.9 ? KILIM.cream : KILIM.indigo;
  if (by > 0.2 && by < 0.225) return KILIM.ochre;
  if (by > 0.42 && by < 0.445) return KILIM.ochre;
  return KILIM.red;
}

let cached: RigSpec | null = null;
/** memoised: the sculpt takes a moment and every caller shares the same spec */
export function camelRig(): RigSpec {
  return (cached ??= buildCamel());
}

function buildCamel(): RigSpec {
  const rb = new RBm('camel_dromedary', VS);

  // ================================================================ one organic mass: torso, hump, neck, head
  const mass = new VoxelModel('camel_mass');
  const prims: Prim[] = [
    E([0, 1.5, 0.4], [0.27, 0.34, 0.4]), // chest
    E([0, 1.32, 0.52], [0.19, 0.2, 0.22]), // brisket
    E([0, 1.43, -0.12], [0.31, 0.29, 0.5]), // barrel
    E([0, 1.56, -0.62], [0.245, 0.26, 0.3]), // flank
    E([0, 1.63, -0.84], [0.2, 0.19, 0.17]), // rump
    E([0, 1.73, 0.38], [0.15, 0.14, 0.26]), // withers
    E([0, 1.86, -0.1], [0.25, 0.26, 0.42]), // hump base
    E([0, 2.03, -0.06], [0.17, 0.14, 0.25]), // hump crown
    E([0.2, 1.42, 0.45], [0.1, 0.22, 0.15]), // shoulders
    E([-0.2, 1.42, 0.45], [0.1, 0.22, 0.15]),
    E([0.19, 1.42, -0.62], [0.11, 0.24, 0.2]), // haunches
    E([-0.19, 1.42, -0.62], [0.11, 0.24, 0.2]),
    E([0, 1.06, -0.58], [0.42, 0.16, 0.32], undefined, true), // tucked-up flank
    // the long U-curved neck: down and forward from the chest, then up to the poll
    C([0, 1.6, 0.68], [0, 1.5, 0.92], 0.165, 0.13),
    C([0, 1.5, 0.92], [0, 1.53, 1.08], 0.13, 0.112),
    C([0, 1.53, 1.08], [0, 1.69, 1.22], 0.112, 0.097),
    C([0, 1.69, 1.22], [0, 1.88, 1.3], 0.097, 0.087),
    C([0, 1.88, 1.3], [0, 2.04, 1.33], 0.087, 0.082),
    C([0, 1.43, 0.9], [0, 1.46, 1.06], 0.08, 0.07), // throat keel
    // head: cranium, brow, nasal bridge, cheeks, bulbous muzzle, upper lip lobes
    E([0, 2.1, 1.4], [0.095, 0.095, 0.12]),
    E([0, 2.13, 1.47], [0.08, 0.065, 0.09]),
    C([0, 2.1, 1.48], [0, 2.02, 1.72], 0.075, 0.06),
    E([0.05, 2.03, 1.5], [0.05, 0.06, 0.09]),
    E([-0.05, 2.03, 1.5], [0.05, 0.06, 0.09]),
    E([0, 1.985, 1.76], [0.068, 0.055, 0.075]),
    E([0.03, 1.958, 1.815], [0.036, 0.034, 0.034]),
    E([-0.03, 1.958, 1.815], [0.036, 0.034, 0.034]),
  ];
  fastBlob(mass, prims, coat, 3.2, (x, y, z) => noise.n3(x * 0.12, y * 0.12, z * 0.12) * 0.35);
  smoothVox(mass, 1, 13);
  // the cleft upper lip and slit nostrils
  const del: V3[] = [];
  mass.forEach((x, y, z) => {
    const X = M(x), Y = M(y), Z = M(z);
    if (Math.abs(X) < VS * 0.6 && Y < 1.975 && Z > 1.8) del.push([x, y, z]);
  });
  for (const [x, y, z] of del) mass.del(x, y, z);
  mass.forEach((x, y, z) => {
    const X = M(x), Y = M(y), Z = M(z);
    for (const sx of [-1, 1]) if (Math.abs(X - sx * 0.033) < VS * 0.7 && Math.abs(Y - 2.003 - (Z - 1.79) * 0.6) < VS * 0.6 && Z > 1.775 && Z < 1.83) mass.set(x, y, z, 0x3a2a1e);
  });
  // sternal callus (the chest pad it kneels on) + knee-like elbow pads
  ell(new Sc(mass, VS), [0, 1.13, 0.48], [0.11, 0.05, 0.13], (x, y, z) => mix(HIDE.callus, HIDE.pad, hash3(x, y, z) * 0.5));
  // eye sockets
  for (const sx of [-1, 1]) ell(new Sc(mass, VS), [sx * 0.09, 2.115, 1.485], [0.042, 0.042, 0.042], 0, { carve: true });

  // split: body | neck | head (hidden plugs keep the joints closed when they bend)
  const body = rb.pm('body', undefined, [0, 1.5, 0]);
  const neck = rb.pm('neck', 'body', [0, 1.58, 0.72]);
  const head = rb.pm('head', 'neck', [0, 2.03, 1.33]);
  const isHead = (X: number, Y: number, Z: number) => (Y > 1.97 && Z > 1.27) || Z > 1.44;
  const isNeck = (X: number, Y: number, Z: number) => (Y - 1.5) * 0.55 + (Z - 0.8) * 0.835 > 0;
  const upper = new VoxelModel('upper');
  splitInto(mass, body.m, upper, (x, y, z) => isNeck(M(x), M(y), M(z)) || isHead(M(x), M(y), M(z)), (x, y, z) => (M(y) - 1.5) * 0.55 + (M(z) - 0.8) * 0.835 > -0.08);
  splitInto(upper, neck.m, head.m, (x, y, z) => isHead(M(x), M(y), M(z)), (x, y, z) => (M(y) > 1.9 && M(z) > 1.2) || M(z) > 1.38);

  // ================================================================ fur tufts: hump crown, withers, throat, forelock
  tufts(body.m, (X, Y, Z) => (Y > 1.95 && Z > -0.4 && Z < 0.25) || (Y > 1.72 && Z > 0.2 && Z < 0.62 && Math.abs(X) < 0.12), (src, t) => mix(mix(src, HIDE.shag, 0.6), 0x6e4a2a, t * 0.5), 0.55, 3, 3);
  tufts(neck.m, (X, Y, Z) => Y < 1.62 && Z > 0.8 && Z < 1.2 && Math.abs(X) < 0.08, (src, t) => mix(mix(src, HIDE.shag, 0.45), HIDE.dark, t * 0.4), 0.6, 3, 5);
  tufts(neck.m, (X, Y, Z) => Y > 1.62 && Z < 1.25 && Z > 0.7 && Math.abs(X) < 0.05, (src) => mix(src, HIDE.shag, 0.5), 0.35, 2, 6);
  tufts(head.m, (X, Y, Z) => Y > 2.16 && Z < 1.46, (src, t) => mix(mix(src, HIDE.shag, 0.55), 0x5e3e22, t * 0.4), 0.7, 2, 7);
  tufts(body.m, (X, Y, Z) => Math.abs(Math.abs(X) - 0.27) < 0.06 && Y > 1.12 && Y < 1.3 && Z > 0.3 && Z < 0.55, (src) => mix(src, HIDE.shag, 0.4), 0.4, 2, 8); // elbow tufts

  // ================================================================ the neck in two: the low U-bend and the upright upper neck (the head rides on neck2)
  {
    const NB: M3 = [0, 1.53, 1.08];
    const nn = norm3([0, 0.19, 0.3]);
    const neck2 = rb.pm('neck2', 'neck', NB);
    const side = (x: number, y: number, z: number) => (M(y) - NB[1]) * nn[1] + (M(z) - NB[2]) * nn[2];
    const mv: [number, number, number, number, number][] = [];
    const plug: [number, number, number, number, number][] = [];
    neck.m.forEach((x, y, z, c, f) => {
      const d = side(x, y, z);
      if (d > 0) mv.push([x, y, z, c, f]);
      else if (d > -0.05) {
        // a hidden plug so the bend never opens a gap
        let inner = true;
        for (const [dx, dy, dz] of N6) if (!neck.m.has(x + dx * 2, y + dy * 2, z + dz * 2)) inner = false;
        if (inner) plug.push([x, y, z, c, f]);
      }
    });
    for (const [x, y, z, c, f] of mv) {
      neck.m.del(x, y, z);
      neck2.m.set(x, y, z, c, f);
    }
    for (const [x, y, z, c, f] of plug) neck2.m.set(x, y, z, c, f);
    rb.parts.find((p) => p.name === 'head')!.parent = 'neck2';
    const i2 = rb.parts.findIndex((p) => p.name === 'neck2');
    const [n2] = rb.parts.splice(i2, 1);
    rb.parts.splice(rb.parts.findIndex((p) => p.name === 'neck') + 1, 0, n2);
  }

  // ================================================================ head dressing: brow, halter, tassels
  const hs = head;
  for (const sx of [-1, 1]) ell(hs, [sx * 0.082, 2.158, 1.475], [0.032, 0.022, 0.05], coat); // bony brow ridge
  // halter: noseband, cheek straps, headstall behind the ears, brass studs
  const band = (pred: (X: number, Y: number, Z: number) => boolean, col: number) => {
    const add: V3[] = [];
    hs.m.forEach((x, y, z) => {
      if (!pred(M(x), M(y), M(z))) return;
      for (const [dx, dy, dz] of N6) if (!hs.m.has(x + dx, y + dy, z + dz) && dy >= 0) add.push([x + dx, y + dy, z + dz]);
    });
    for (const [x, y, z] of add) hs.m.set(x, y, z, col);
  };
  band((X, Y, Z) => Math.abs(Z - 1.64) < 0.018 && Y > 1.94, 0x9a2a1c); // noseband
  band((X, Y, Z) => Math.abs(Z - 1.4 + (Y - 2.1) * 0.35) < 0.016 && Math.abs(X) > 0.06 && Y < 2.12, 0x9a2a1c); // cheek straps
  band((X, Y, Z) => Math.abs(Z - 1.345) < 0.016 && Y > 2.11, 0x9a2a1c); // headstall over the poll
  for (const sx of [-1, 1]) for (const [y, z] of [[2.0, 1.64], [2.04, 1.64], [2.06, 1.42], [1.98, 1.44]]) hs.dot([sx * (z > 1.6 ? 0.072 : 0.098), y, z], BRASS, VF.METAL);
  // woollen pompom tassels swinging from the noseband sides
  for (const sx of [-1, 1]) {
    const top: M3 = [sx * 0.075, 1.96, 1.64];
    hs.line(top, [sx * 0.085, 1.88, 1.62], 0x2c3a6c);
    ell(hs, [sx * 0.086, 1.865, 1.62], [0.02, 0.022, 0.02], (x, y, z) => (hash3(x, y, z) < 0.5 ? KILIM.red : KILIM.ochre));
    for (let f = 0; f < 4; f++) hs.line([sx * 0.086 + (f - 1.5) * VS * 0.5, 1.85, 1.62], [sx * 0.088 + (f - 1.5) * VS * 0.7, 1.81, 1.62 + (f % 2) * VS], f % 2 ? KILIM.red : KILIM.cream);
  }
  // nose ring + lead rope falling along the throat
  hs.dot([0, 1.935, 1.7], BRASS, VF.METAL);
  hs.dot([0, 1.925, 1.69], BRASS, VF.METAL);
  // ================================================================ eyes (modelled) + heavy hooded lids with long lashes
  const EYE: M3 = [0.088, 2.115, 1.487];
  const fwd: M3 = [0.85, 0.1, 0.52];
  const eyeL = rb.pm('eye_l', 'head', EYE);
  wetEye(eyeL.m, V(EYE), 0.04 / VS, fwd, { sclera: 0x1c120c, iris: 0x3e2614, irisEdge: 0x1a0e08, pupil: 0x080504, irisR: 0.9, pupilR: 0.42, bigGlint: 2, smallGlint: true });
  const lid = rb.pm('lid_l', 'head', EYE);
  const fl = Math.hypot(fwd[0], fwd[2]);
  const fx = fwd[0] / fl, fz = fwd[2] / fl;
  for (let i = Math.floor((EYE[0] - 0.06) / VS); i <= Math.ceil((EYE[0] + 0.06) / VS); i++)
    for (let j = Math.floor((EYE[1] - 0.06) / VS); j <= Math.ceil((EYE[1] + 0.06) / VS); j++)
      for (let k = Math.floor((EYE[2] - 0.06) / VS); k <= Math.ceil((EYE[2] + 0.06) / VS); k++) {
        const px = M(i) - EYE[0], py = M(j) - EYE[1], pz = M(k) - EYE[2];
        const d = Math.hypot(px, py, pz);
        if (d < 0.043 || d > 0.056) continue;
        const out = (px * fx + pz * fz) / d;
        if (out < -0.15) continue;
        if (py / d < 0.18 - out * 0.05) continue; // covers the upper part of the eye (heavy, sleepy)
        const rim = py / d < 0.26;
        lid.m.set(i, j, k, rim ? mix(coat(i, j, k), HIDE.dark, 0.45) : coat(i, j, k));
      }
  // lashes: long, dark, curling up at the tips, from the lid rim outward and down
  for (let a = -0.5; a <= 0.51; a += 0.2) {
    const dirx = fx * Math.cos(a) - fz * Math.sin(a), dirz = fz * Math.cos(a) + fx * Math.sin(a);
    const r0: M3 = [EYE[0] + dirx * 0.05, EYE[1] + 0.01, EYE[2] + dirz * 0.05];
    const L = 0.03 + Math.cos(a) * 0.012;
    const mid: M3 = [r0[0] + dirx * L * 0.6, r0[1] - 0.006, r0[2] + dirz * L * 0.6];
    const tip: M3 = [r0[0] + dirx * L, r0[1] + 0.004, r0[2] + dirz * L];
    lid.line(r0, mid, 0x4a3020);
    lid.line(mid, tip, 0x5a3c26);
  }
  // ears: small, rounded, cupped forward-out, with pale inner fluff
  const earP: M3 = [0.066, 2.19, 1.335];
  const ear = rb.pm('ear_l', 'head', earP);
  ell(ear, [0.085, 2.235, 1.315], [0.024, 0.046, 0.034], coat, { rot: [0.25, 0, -0.45] });
  ell(ear, [0.092, 2.238, 1.33], [0.012, 0.03, 0.018], 0, { rot: [0.25, 0, -0.45], carve: true });
  paint(ear, (x, y, z) => y > 2.2 && z > 1.32 && x > 0.08, 0x8a6a52);
  tufts(ear.m, (X, Y, Z) => Z > 1.32 && Y > 2.21, (src) => mix(src, 0xf0e0c4, 0.6), 0.7, 2, 9);

  // ================================================================ jaw: mandible + droopy lower lip + chin whiskers
  const jaw = rb.pm('jaw', 'head', [0, 2.0, 1.45]);
  cap(jaw, [0, 1.995, 1.47], [0, 1.935, 1.74], 0.05, 0.044, coat);
  ell(jaw, [0, 1.915, 1.785], [0.05, 0.03, 0.046], (x, y, z) => (M(y) > 1.925 ? 0x9a7466 : coat(x, y, z)));
  ell(jaw, [0, 1.93, 1.81], [0.04, 0.012, 0.02], 0x7a5446); // inner lip
  tufts(jaw.m, (X, Y, Z) => Y < 1.9 && Z > 1.55, (src) => mix(src, 0x6e5038, 0.4), 0.5, 2, 10);

  // ================================================================ legs (left; mirrored)
  // front: shoulder → elbow → forearm → knobbly knee (with its callus) | knee → cannon → fetlock → pastern → pad
  const S: M3 = [0.2, 1.4, 0.47], EL: M3 = [0.205, 1.11, 0.4], KN: M3 = [0.195, 0.64, 0.45], FT: M3 = [0.195, 0.21, 0.45], PD: M3 = [0.195, 0.05, 0.55];
  const legF = rb.pm('leg_fl', 'body', S);
  cap(legF, S, EL, 0.11, 0.085, coat);
  ell(legF, [0.2, 1.12, 0.33], [0.06, 0.06, 0.06], coat); // point of the elbow
  ell(legF, [0.21, 1.07, 0.4], [0.05, 0.04, 0.05], (x, y, z) => mix(HIDE.callus, HIDE.pad, hash3(x, y, z) * 0.6)); // elbow callus
  tube(legF, [EL, [0.2, 0.88, 0.42], KN], (t) => 0.078 - t * 0.026, legCoat);
  ell(legF, KN, [0.06, 0.07, 0.06], legCoat); // knobbly carpal knee
  ell(legF, [0.195, 0.64, 0.493], [0.046, 0.058, 0.024], (x, y, z) => mix(HIDE.callus, 0x8a7460, hash3(x, y, z) * 0.5)); // knee callus
  const shinF = rb.pm('shin_fl', 'leg_fl', KN);
  ell(shinF, KN, [0.05, 0.05, 0.05], legCoat);
  cap(shinF, KN, FT, 0.045, 0.039, legCoat);
  ell(shinF, FT, [0.05, 0.05, 0.055], legCoat); // fetlock knuckle
  cap(shinF, FT, [0.195, 0.08, 0.52], 0.043, 0.05, legCoat); // pastern
  foot(shinF, PD, 0.085, 0.11);
  // hind: hip → broad thigh → stifle → gaskin → hock | hock → cannon → fetlock → pastern → pad
  const H: M3 = [0.19, 1.46, -0.62], ST: M3 = [0.22, 1.02, -0.46], HK: M3 = [0.2, 0.66, -0.74], FB: M3 = [0.2, 0.21, -0.69], PB: M3 = [0.2, 0.05, -0.6];
  const legB = rb.pm('leg_bl', 'body', H);
  cap(legB, H, ST, 0.14, 0.088, coat);
  ell(legB, [0.2, 1.25, -0.6], [0.11, 0.18, 0.16], coat); // ham
  ell(legB, [0.24, 1.02, -0.44], [0.04, 0.045, 0.035], (x, y, z) => mix(HIDE.callus, HIDE.pad, hash3(x, y, z) * 0.5)); // stifle callus
  tube(legB, [ST, [0.21, 0.84, -0.6], HK], (t) => 0.08 - t * 0.03, legCoat);
  ell(legB, HK, [0.055, 0.07, 0.06], legCoat);
  ell(legB, [0.2, 0.71, -0.795], [0.035, 0.04, 0.03], legCoat); // point of the hock
  const shinB = rb.pm('shin_bl', 'leg_bl', HK);
  ell(shinB, HK, [0.048, 0.05, 0.05], legCoat);
  cap(shinB, HK, FB, 0.045, 0.038, legCoat);
  ell(shinB, FB, [0.048, 0.05, 0.052], legCoat);
  cap(shinB, FB, [0.2, 0.08, -0.62], 0.042, 0.048, legCoat);
  foot(shinB, PB, 0.08, 0.105);
  for (const s of [legF, legB, shinF, shinB]) lumpy(s.m, 4, 1, 12, 0.5);
  // the third segment: fetlock, pastern and the broad padded foot flex on their own
  const footSplit = (shin: Sc, name: string, parent: string, at: M3) => {
    const ft = rb.pm(name, parent, at);
    const mv: [number, number, number, number, number][] = [];
    shin.m.forEach((x, y, z, c, f) => {
      if (M(y) < at[1] + 0.03) mv.push([x, y, z, c, f]);
    });
    for (const [x, y, z, c, f] of mv) {
      shin.m.del(x, y, z);
      ft.m.set(x, y, z, c, f);
    }
    return ft;
  };
  footSplit(shinF, 'foot_fl', 'shin_fl', FT);
  footSplit(shinB, 'foot_bl', 'shin_bl', FB);
  // the calluses grown into thick keratin pads (what a camel kneels on), worn pale on top
  {
    let seed = 500;
    const pad = (m: VoxelModel, at: M3, from: M3, fwdv: V3, a: number, b: number, h: number) => {
      const hit = castIn(m, V(from), [at[0] - from[0], at[1] - from[1], at[2] - from[2]]);
      if (!hit) return;
      plate(m, [hit[0] + 0.5, hit[1] + 0.5, hit[2] + 0.5], normalAt(m, hit, 2), fwdv, { a: a / VS, b: b / VS, h: h / VS, keel: 0, tilt: 0.1, sink: 1.5, seed: seed++, sq: 2.4, rings: true, cracks: true }, CALLUS);
    };
    pad(body.m, [0, 1.12, 0.48], [0, 0.7, 0.48], [0, 0, 1], 0.13, 0.11, 0.03); // the sternal pad
    pad(legF.m, [0.195, 0.64, 0.47], [0.195, 0.64, 0.9], [0, 1, 0], 0.062, 0.05, 0.022); // knees
    pad(legF.m, [0.21, 1.07, 0.4], [0.21, 0.8, 0.45], [0, 0, 1], 0.05, 0.045, 0.018); // elbows
    pad(legB.m, [0.24, 1.02, -0.44], [0.45, 1.02, -0.3], [0, 1, 0], 0.045, 0.04, 0.016); // stifles
    pad(legB.m, [0.2, 0.71, -0.79], [0.2, 0.71, -1.1], [0, 1, 0], 0.045, 0.035, 0.016); // hocks
  }

  // ================================================================ tail with a dark switch
  const T0: M3 = [0, 1.66, -0.97];
  const tail = rb.pm('tail', 'body', T0);
  tube(tail, [T0, [0, 1.52, -1.02], [0, 1.3, -1.035]], (t) => 0.036 - t * 0.012, coat);
  const T1: M3 = [0, 1.3, -1.035];
  const tip = rb.pm('tail_tip', 'tail', T1);
  tube(tip, [T1, [0, 1.15, -1.03], [0, 1.05, -1.02]], (t) => 0.024 - t * 0.006, coat);
  for (let h = 0; h < 22; h++) {
    const a = h * 2.4, r = 0.012 + hash3(h, 2, 3) * 0.02;
    tip.line([Math.cos(a) * r * 0.5, 1.12, -1.03 + Math.sin(a) * r * 0.5], [Math.cos(a) * r, 0.9 - hash3(h, 5, 1) * 0.06, -1.03 + Math.sin(a) * r], hash3(h, 1, 1) < 0.5 ? 0x4a3020 : 0x6a4a30);
  }

  // ================================================================ saddle blanket, pack frame and packs
  dressPack(body);

  // ================================================================ mirror the left-side parts
  const mirror = (src: string, dst: string, parent?: string) => {
    const p = rb.parts.find((q) => q.name === src)!;
    const m = new VoxelModel(dst);
    p.model.forEach((x, y, z, c, f) => m.set(-1 - x, y, z, c, f));
    rb.parts.push({ name: dst, parent: parent ?? p.parent, pivot: [-p.pivot[0], p.pivot[1], p.pivot[2]], rest: p.rest ? [p.rest[0], -p.rest[1], -p.rest[2]] : undefined, model: m });
  };
  mirror('eye_l', 'eye_r');
  mirror('lid_l', 'lid_r');
  mirror('ear_l', 'ear_r');
  mirror('leg_fl', 'leg_fr');
  mirror('shin_fl', 'shin_fr', 'leg_fr');
  mirror('leg_bl', 'leg_br');
  mirror('shin_bl', 'shin_br', 'leg_br');
  mirror('foot_fl', 'foot_fr', 'shin_fr');
  mirror('foot_bl', 'foot_br', 'shin_br');

  for (const p of rb.parts) if (p.model.count > 4000) hollow(p.model, 3);
  // gentle sky-light on top, darker undersides
  for (const p of rb.parts) {
    const m = p.model;
    const todo: [number, number, number, number, number][] = [];
    m.forEach((x, y, z, c, f) => {
      if (f & VF.METAL) return;
      const up = !m.has(x, y + 1, z), dn = !m.has(x, y - 1, z);
      if (up && !dn) todo.push([x, y, z, mulRGB(c, 1.05), f]);
      else if (dn && !up) todo.push([x, y, z, mulRGB(c, 0.88), f]);
    });
    for (const [x, y, z, c, f] of todo) m.set(x, y, z, c, f);
  }

  rb.sockM('mouth', 'jaw', [0, 1.92, 1.82]);
  rb.sockM('saddle', 'body', [0, 2.2, -0.06]);
  rb.sockM('head_top', 'head', [0, 2.26, 1.4]);
  const expressions: Record<string, { jaw?: number }> = {};
  for (const e of CAMEL_EXPRESSIONS) expressions[e] = { jaw: e === 'spit' ? 0.35 : e === 'smug' ? 0.05 : e === 'bored' ? 0.02 : 0 };
  const a = Math.hypot(fwd[0], fwd[2]);
  return rb.build({
    height: 2.28,
    length: 2.9,
    radius: 0.7,
    expressions,
    /** blink: rotate lid_l / lid_r by a NEGATIVE angle about these axes (rig space) */
    lidAxis: { l: [-fwd[2] / a, 0, fwd[0] / a], r: [-fwd[2] / a, 0, -fwd[0] / a] },
    kneelDrop: 1.02,
  });
}

/** broad two-toed padded foot with a cleft and two small dark nails */
function foot(s: Sc, c: M3, rx: number, rz: number) {
  ell(s, c, [rx, 0.048, rz], (x, y, z) => (M(y) < 0.025 ? HIDE.pad : legCoat(x, y, z)), { keep: (_lx, ly) => ly > -0.95 });
  ell(s, [c[0], c[1] + 0.03, c[2] - 0.02], [rx * 0.7, 0.04, rz * 0.7], legCoat);
  // toe cleft at the front
  const del: V3[] = [];
  s.m.forEach((x, y, z) => {
    if (Math.abs(M(x) - c[0]) < VS * 0.6 && M(z) > c[2] + rz * 0.35) del.push([x, y, z]);
  });
  for (const [x, y, z] of del) s.m.del(x, y, z);
  for (const sx of [-1, 1]) ell(s, [c[0] + sx * rx * 0.42, c[1] + 0.012, c[2] + rz * 0.9], [0.018, 0.014, 0.014], HIDE.nail);
}

/** kilim blanket + wooden pack-saddle frame + bedroll, saddlebags, water skin, clay jug, rope coil */
function dressPack(body: Sc) {
  const m = body.m;
  const cz = -0.08;
  const inBlanket = (X: number, Y: number, Z: number) => Math.abs(Z - cz) < 0.44 - Math.max(0, 1.6 - Y) * 0.1 && Y > 1.36;
  // two layers of woven cloth over the hump and down the flanks
  for (let layer = 0; layer < 2; layer++)
    thicken(m, (x, y, z) => inBlanket(M(x), M(y), M(z)), (x, y, z) => {
      const Y = M(y), Z = M(z);
      const edge = Math.min(0.44 - Math.abs(Z - cz), Y - 1.36);
      return kilim(Y, Z, edge);
    }, [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, 0, 1], [0, 0, -1]]);
  // fringe: woollen threads hanging from the lower hem
  const hem: V3[] = [];
  m.forEach((x, y, z, c) => {
    const Y = M(y), Z = M(z);
    if (Y > 1.39 || Y < 1.36 || Math.abs(Z - cz) > 0.44) return;
    if (c !== KILIM.deep) return;
    if (!m.has(x, y - 1, z) && hash3(x, 3, z) < 0.55) hem.push([x, y, z]);
  });
  for (const [x, y, z] of hem) {
    const L = 2 + Math.floor(hash3(x, y, z) * 3);
    for (let l = 1; l <= L; l++) m.set(x, y - l, z, (z & 3) < 2 ? KILIM.cream : KILIM.red, VF.SOFTAO);
  }
  // pack-saddle frame: two arches over the hump following its outline, joined by side rails
  const sc = body;
  const outline = (Z: number, ang: number) => {
    // march outward from the hump axis until outside the cloth
    const yc = 1.55;
    for (let r = 0.1; r < 1.0; r += VS * 0.5) {
      const X = Math.sin(ang) * r, Y = yc + Math.cos(ang) * r;
      if (!m.has(Math.floor(X / VS), Math.floor(Y / VS), Math.floor(Z / VS))) return [X + Math.sin(ang) * 0.035, Y + Math.cos(ang) * 0.035] as [number, number];
    }
    return [Math.sin(ang) * 0.4, yc + Math.cos(ang) * 0.4] as [number, number];
  };
  const arches: M3[][] = [];
  for (const Z of [0.22, -0.4]) {
    const pts: M3[] = [];
    for (let a = -1.75; a <= 1.75; a += 0.25) {
      const [X, Y] = outline(Z, a);
      pts.push([X, Y, Z]);
    }
    arches.push(pts);
    tube(sc, pts, () => 0.03, (x, y, z) => (hash3(x, y, z) < 0.2 ? WOOD.dark : noise.n3(x * 0.3, y * 0.3, z * 0.3) > 0.3 ? WOOD.hi : WOOD.base));
    // horn knobs at the top of each arch
    const top = pts[Math.floor(pts.length / 2)];
    ell(sc, [top[0], top[1] + 0.04, top[2]], [0.035, 0.05, 0.035], WOOD.dark);
  }
  for (const sx of [-1, 1]) {
    const a = arches[0].find((p) => Math.sign(p[0]) === sx && p[1] < 1.72 && p[1] > 1.6) ?? [sx * 0.33, 1.66, 0.22];
    const b = arches[1].find((p) => Math.sign(p[0]) === sx && p[1] < 1.72 && p[1] > 1.6) ?? [sx * 0.33, 1.66, -0.4];
    cap(sc, [a[0], 1.66, 0.25], [b[0], 1.66, -0.43], 0.026, 0.026, WOOD.base);
    // rope lashings at the joints
    for (const z of [0.22, -0.4]) for (let w = 0; w < 4; w++) ell(sc, [(sx * Math.abs(a[0]) + sx * Math.abs(b[0])) / 2, 1.66 + (w - 1.5) * 0.012, z], [0.034, 0.008, 0.034], w % 2 ? ROPE[0] : ROPE[1]);
  }
  // girth strap under the belly
  const girth: V3[] = [];
  m.forEach((x, y, z) => {
    const Y = M(y), Z = M(z);
    if (Math.abs(Z - 0.12) > 0.03 || Y > 1.42) return;
    for (const [dx, dy, dz] of N6) if (!m.has(x + dx, y + dy, z + dz) && dy <= 0) girth.push([x + dx, y + dy, z + dz]);
  });
  for (const [x, y, z] of girth) m.set(x, y, z, (y & 1) ? ROPE[0] : ROPE[1]);
  // LEFT: bedroll (striped wool, tied twice) above leather saddlebags with flaps and brass buckles
  const bed = (X: number, Y: number, Z: number) => (Math.floor((Z + 2) / 0.05) % 3 === 0 ? 0x8a2a20 : Math.floor((Z + 2) / 0.05) % 3 === 1 ? 0xd8ccb0 : 0x6a6a6a) as number;
  cap(sc, [0.37, 1.74, 0.16], [0.37, 1.74, -0.34], 0.075, 0.075, (x, y, z) => bed(M(x), M(y), M(z)));
  for (const z of [0.06, -0.24]) ell(sc, [0.37, 1.74, z], [0.082, 0.082, 0.012], ROPE[1]);
  ell(sc, [0.39, 1.48, -0.06], [0.07, 0.16, 0.16], (x, y, z) => (noise.n3(x * 0.3, y * 0.3, z * 0.3) > 0.35 ? LEATHER.hi : LEATHER.base));
  ell(sc, [0.44, 1.55, -0.06], [0.03, 0.1, 0.15], LEATHER.dark); // flap
  for (const z of [-0.14, 0.02]) ell(sc, [0.47, 1.47, z], [0.012, 0.018, 0.014], BRASS, { fl: VF.METAL });
  // RIGHT: goatskin water bag (bulging, legs tied) + a clay jug hanging on a rope + a coil of rope
  ell(sc, [-0.4, 1.5, 0.14], [0.08, 0.13, 0.11], (x, y, z) => (hash3(x, y, z) < 0.1 ? LEATHER.dark : 0x5a3a24));
  ell(sc, [-0.42, 1.62, 0.2], [0.04, 0.05, 0.04], 0x5a3a24);
  ell(sc, [-0.42, 1.665, 0.215], [0.024, 0.02, 0.024], ROPE[1]);
  const jug = [0.06, 0.085, 0.1, 0.105, 0.1, 0.085, 0.06, 0.04, 0.035, 0.045];
  jug.forEach((r, i) => ell(sc, [-0.43, 1.2 + i * 0.03, -0.28], [r * 0.85, 0.018, r * 0.85], (x, y, z) => (Math.floor(M(y) / 0.06) % 3 === 0 ? 0x9a4e2a : 0xc8784a)));
  sc.line([-0.42, 1.5, -0.28], [-0.38, 1.66, -0.3], ROPE[0]);
  for (let w = 0; w < 4; w++) ell(sc, [-0.36, 1.78 + w * 0.012, -0.3], [0.08 - w * 0.008, 0.01, 0.08 - w * 0.008], w % 2 ? ROPE[0] : ROPE[1], { keep: (lx, _ly, lz) => lx * lx + lz * lz > 0.45 });
}

// ============================================================================ idle animation
const _ax = new THREE.Vector3();
const _q = new THREE.Quaternion();

/**
 * Procedural idle for a camel rig instance: cud chewing (open/close + lateral
 * grind), heavy-lidded blinks, ear flicks, tail swish with a lagging switch,
 * breathing, look-around toward an optional point, and kneel (cush) blending.
 */
export class CamelIdle {
  t = Math.random() * 10;
  kneel = 0;
  kneelTarget = 0;
  private blinkT = 0;
  private nextBlink = 1 + Math.random() * 3;
  private ear = [0, 0];
  private earV = [0, 0];
  private nextEar = [1.5, 2.6];
  private flick = 0;
  private nextFlick = 3;
  private lookY = 0;
  private lookP = 0;
  private nextLook = 2;
  private lookTY = 0;
  private bodyY0: number | null = null;
  private n2Y = 0;
  chewing = true;
  constructor(public rig: RigInstance) {}

  update(dt: number, look?: { x: number; y: number; z: number } | null) {
    const n = this.rig.nodes;
    const meta = this.rig.geo.spec.meta ?? {};
    this.t += dt;
    const t = this.t;
    this.kneel += (this.kneelTarget - this.kneel) * Math.min(1, dt * 1.2);
    const k = this.kneel * this.kneel * (3 - 2 * this.kneel);
    // ---- kneel (cush): body sinks onto the chest pad, legs fold under
    if (n['body']) {
      if (this.bodyY0 === null) this.bodyY0 = n['body'].position.y;
      const breathe = Math.sin(t * 1.1) * 0.006;
      n['body'].position.y = this.bodyY0 - (meta.kneelDrop ?? 1) * k + breathe;
      n['body'].rotation.set(Math.sin(t * 1.1) * 0.006 - k * 0.04, 0, Math.sin(t * 0.37) * 0.01);
    }
    // (angles found by a fit that keeps every folded leg tucked under the belly and above the sand)
    n['leg_fl']?.rotation.set(1.2 * k, 0, 0.03 * k);
    n['leg_fr']?.rotation.set(1.2 * k, 0, -0.03 * k);
    n['shin_fl']?.rotation.set(-3.05 * k, 0, 0);
    n['shin_fr']?.rotation.set(-3.05 * k, 0, 0);
    n['leg_bl']?.rotation.set(-1.3 * k, 0, 0.1 * k);
    n['leg_br']?.rotation.set(-1.3 * k, 0, -0.1 * k);
    n['shin_bl']?.rotation.set(-3.05 * k, 0, 0);
    n['shin_br']?.rotation.set(-3.05 * k, 0, 0);
    // ---- look around (toward `look` now and then), slow neck sway
    this.nextLook -= dt;
    if (this.nextLook <= 0) {
      this.nextLook = 2.5 + Math.random() * 4;
      if (look && Math.random() < 0.6) {
        const p = this.rig.root.worldToLocal(_ax.set(look.x, look.y, look.z));
        this.lookTY = Math.max(-0.9, Math.min(0.9, Math.atan2(p.x, p.z)));
      } else this.lookTY = (Math.random() - 0.5) * 1.1;
    }
    this.lookY += (this.lookTY - this.lookY) * Math.min(1, dt * 1.6);
    this.lookP += (Math.sin(t * 0.23) * 0.08 - this.lookP) * Math.min(1, dt);
    // kneeling, the neck stands up tall and proud
    // (the upper neck carries part of the turn a beat later, so the long neck curves into a look)
    const hasN2 = !!n['neck2'];
    this.n2Y += (this.lookY - this.n2Y) * Math.min(1, dt * 1.1);
    n['neck']?.rotation.set(Math.sin(t * 0.7) * 0.03 + this.lookP - k * 0.5, this.lookY * (hasN2 ? 0.28 : 0.45), Math.sin(t * 0.5) * 0.02);
    n['neck2']?.rotation.set(Math.sin(t * 0.7 - 0.6) * 0.025 + this.lookP * 0.3, this.n2Y * 0.22, Math.sin(t * 0.5 - 0.5) * 0.015);
    n['head']?.rotation.set(Math.sin(t * 0.9 + 1) * 0.04 - this.lookP * 0.5 + k * 0.42, this.lookY * 0.5, Math.sin(t * 0.6) * 0.04);
    // breathing: the barrel swells a little
    const bm = this.rig.meshes['body'];
    if (bm) bm.scale.set(1 + Math.sin(t * 1.1) * 0.008, 1 + Math.sin(t * 1.1) * 0.01, 1);
    // feet: the pads settle flat; kneeling, the pasterns fold back under the cannons
    for (const id of ['fl', 'fr', 'bl', 'br']) n['foot_' + id]?.rotation.set(-0.35 * k + Math.sin(t * 0.3 + id.length) * 0.004, 0, 0);
    // ---- cud chewing: open/close + side-to-side grind
    if (n['jaw']) {
      const ph = t * Math.PI * 2 * 1.25;
      const ch = this.chewing ? 1 : 0;
      n['jaw'].rotation.set((0.05 + Math.max(0, Math.sin(ph)) * 0.07) * ch + this.rig.exprJaw, Math.sin(ph + Math.PI / 2) * 0.1 * ch, Math.sin(ph + Math.PI / 2) * 0.03 * ch);
    }
    // ---- blinks: heavy lids drop fast, rise slower; rest half-closed (bored, superior)
    this.nextBlink -= dt;
    if (this.nextBlink <= 0) {
      this.blinkT = 0.0001;
      this.nextBlink = 2 + Math.random() * 4.5;
    }
    let close = 0.18;
    if (this.blinkT > 0) {
      this.blinkT += dt;
      const b = this.blinkT;
      close = b < 0.09 ? 0.18 + (b / 0.09) * 0.95 : b < 0.3 ? 1.13 - ((b - 0.09) / 0.21) * 0.95 : 0.18;
      if (b >= 0.3) this.blinkT = 0;
    }
    const la = meta.lidAxis as { l: number[]; r: number[] } | undefined;
    if (la) {
      if (n['lid_l']) n['lid_l'].quaternion.copy(_q.setFromAxisAngle(_ax.set(la.l[0], la.l[1], la.l[2]), -close));
      if (n['lid_r']) n['lid_r'].quaternion.copy(_q.setFromAxisAngle(_ax.set(la.r[0], la.r[1], la.r[2]), -close));
    }
    // ---- ear flicks (springy)
    for (let s = 0; s < 2; s++) {
      this.nextEar[s] -= dt;
      if (this.nextEar[s] <= 0) {
        this.nextEar[s] = 1.2 + Math.random() * 4;
        this.earV[s] += (Math.random() < 0.5 ? -1 : 1) * (6 + Math.random() * 5);
      }
      this.earV[s] += (-this.ear[s] * 160 - this.earV[s] * 9) * dt;
      this.ear[s] += this.earV[s] * dt;
    }
    n['ear_l']?.rotation.set(this.ear[0] * 0.6 + 0.05, 0, -this.ear[0] - 0.1);
    n['ear_r']?.rotation.set(this.ear[1] * 0.6 + 0.05, 0, this.ear[1] + 0.1);
    // ---- tail swish with a lagging switch; now and then a hard flick at a fly
    this.nextFlick -= dt;
    if (this.nextFlick <= 0) {
      this.nextFlick = 2.5 + Math.random() * 5;
      this.flick = 1;
    }
    this.flick = Math.max(0, this.flick - dt * 1.6);
    const sw = Math.sin(t * 1.6) * 0.12 + Math.sin(t * 9) * 0.5 * this.flick * this.flick;
    n['tail']?.rotation.set(0.05 + k * 0.3, 0, sw);
    n['tail_tip']?.rotation.set(0.04, 0, Math.sin(t * 1.6 - 0.9) * 0.2 + Math.sin(t * 9 - 1.2) * 0.6 * this.flick * this.flick);
  }
}
