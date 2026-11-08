// Gobi, the walking trading post: a colossal desert monster turtle (about 11 m
// beak to tail, 7.6 m to the top of his tree) with a little weathered shack built
// on his shell. Real turtle anatomy pushed into a Monster Hunter beast:
//  - the carapace: pyramided scutes stepped in growth terraces, sand packed in
//    the seams, bleached areolas, lichen low on the flanks, the vertebrals
//    clear of the house rising into sand-polished horns, a serrated rim of
//    down-curved marginal teeth (longest at the rear), old arrows broken off in
//    a costal;
//  - an alligator-snapper's head: a hooked keratin beak worn bright along its
//    cutting edges, horn shields, horned brows and temporal spikes, valve-rimmed
//    nostrils, a beard of chin tubercles, a pink lure on the tongue, wet gold-
//    ringed eyes under heavy hooded lids;
//  - a three-segment neck of folded, tubercled hide; armoured forelimbs (big
//    imbricate horn scales), spurred thighs, separate toe parts with heavy
//    chipped claws; a spiked three-segment tail ending in a horn club.
// On top, unchanged in design: a plank house (door, shuttered windows, a tin-and-
// shingle roof, stovepipe, the TRADING POST sign), a porch with a bench, rail,
// lanterns and a wind chime, a fold-down ramp, and an acacia whose roots grip the
// scutes; inside, a warm cluttered shop.
//
// Ozman, the tortoise man who keeps the shop, is a variant of Old Mother
// Tamsin's (frozen, approved) rig: a turban instead of her headscarf, an olive
// waistcoat for her shawl, a white beard, no coins or beads (`tortoiseGuyRig`).
//
// RIG (faces +Z, LEFT = +X, origin on the ground under the shell, 1/12 m):
//   shell (root, carapace + house + interior) → neck → neck2 → head → jaw → tongue,
//     head → eye_l/eye_r, lid_l/lid_r
//   shell → leg_fl → foot_fl → toes_fl (fr, bl, br), shell → tail → tail2 → tail3
//   shell → tree → canopy, shell → door, shut_fa/shut_fb, shut_sa/shut_sb, ramp,
//   shell → lantern_a, lantern_b, chime, pots (swing)
// Sockets: porch (where Ozman stands, facing the ramp), counter (inside, behind
// the counter), head_top. meta.retract / shellDrop / dig: hiding and burrowing.
// The shop's Turtle poses every joint it knew before; `GobiAnim` adds the
// secondary motion of the new joints (neck2, toes, tail2/3, the lure).
import * as THREE from 'three';
import { CRig, VoxelModel, VF, V3, RigSpec, ell, cap, tube, line, Prim, hollow, wetEye, vessel, n01, h01, mixc, sstep, add3, sub3, scl3, dot3, norm3, lerp3, exposed } from './ckit';
import { fblob, plate, castIn, normalAt, splitMany, groove, surfaceCells, cullBuried, type Pal } from './mkit';
import { signPanel } from '../props/western';
import { PR, textWidth } from '../props/helpers';
import { merchantRig } from '../characters';
import type { PartSpec } from '../../../engine/voxel/Rig';

const VS = 1 / 12;
const U = (m: number) => m / VS;
const P = (x: number, y: number, z: number): V3 => [x / VS, y / VS, z / VS];
const Pv = (v: V3) => P(v[0], v[1], v[2]);
/** voxel index -> metres at the cell centre */
const M = (i: number) => (i + 0.5) * VS;

// ------------------------------------------------------------------ palette
const PLANK = { base: 0x8a7a64, shade: 0x6d5f4c, hi: 0xa8987e, dark: 0x4a3f32, teal: 0x4f8a86, ochre: 0xc8903a };
const WOOD = { base: 0x7a5530, shade: 0x5a3c20, hi: 0x9a7044, dark: 0x3e2814, floor: 0x8a5a32, floorD: 0x6e4626 };
const ROOF = { tin: 0x8e8a82, tinD: 0x6a675f, rust: 0xa0603a, shingle: 0x6a5446, shingleD: 0x4e3c32 };
const IRON = { base: 0x4a4a50, hi: 0x8a8c92 };
const BARK = { base: 0x6a5238, shade: 0x4e3c28, hi: 0x86704e, dark: 0x332619 };
const LEAF = { a: 0x6f8a3e, b: 0x5a7434, c: 0x8aa04c, d: 0x4a6230, flower: 0xe8d070 };
const CLAY = { base: 0xb8693e, shade: 0x8e4c2a, hi: 0xd08458, paint: 0xe8d6b0 };

// ------------------------------------------------------------------ the body plan (metres)
const CC: V3 = [0, 1.45, -0.2], CR: V3 = [2.75, 2.0, 3.6];
const domeY = (x: number, z: number) => CC[1] + CR[1] * Math.sqrt(Math.max(0, 1 - (x / CR[0]) ** 2 - ((z - CC[2]) / CR[2]) ** 2));
/** the house: floor level and footprint; the porch runs along its +X side */
const H = { floor: 3.0, x0: -1.7, x1: 1.4, z0: -1.5, z1: 1.2, eave: 5.3, ridge: 6.25, porchX: 2.45, porchZ0: -1.4, porchZ1: 1.2 };
const DOOR = { z0: -0.3, z1: 0.5, top: 5.0 };
const J = {
  shell: [0, 1.25, -0.2] as V3,
  neck: [0, 1.33, 3.0] as V3,
  neck2: [0, 1.72, 3.82] as V3,
  head: [0, 2.03, 4.38] as V3,
  jaw: [0, 2.0, 4.5] as V3,
  legF: [1.85, 1.5, 2.1] as V3,
  kneeF: [2.3, 0.82, 2.35] as V3,
  footF: [2.4, 0.22, 2.5] as V3,
  legB: [1.8, 1.42, -2.5] as V3,
  kneeB: [2.2, 0.76, -2.75] as V3,
  footB: [2.25, 0.2, -2.85] as V3,
  tail: [0, 1.3, -3.72] as V3,
  tree: [-0.6, 2.82, -2.6] as V3,
  crown: [-0.75, 6.55, -2.6] as V3,
  ramp: [H.porchX, H.floor, 0.1] as V3,
  porch: [1.98, H.floor, 0.86] as V3,
  counter: [-1.38, H.floor, -0.05] as V3,
};

const inHouse = (X: number, Z: number, pad = 0) => X > H.x0 - pad && X < H.porchX + pad && Z > H.z0 - pad && Z < H.z1 + pad;

// ------------------------------------------------------------------ the house
const plank = (x: number, y: number, z: number, along: number, seed: number) => {
  const b = Math.floor(along / 0.17);
  const r = h01(b, seed, 3, seed);
  if ((along % 0.17) < VS * 0.8) return PLANK.dark;
  if (r > 0.93) return PLANK.teal;
  if (r > 0.88) return PLANK.ochre;
  const k = h01(x, y, z, seed + 5);
  return k < 0.3 ? PLANK.shade : k > 0.85 ? PLANK.hi : PLANK.base;
};

function buildHouse(m: VoxelModel) {
  const { floor, x0, x1, z0, z1, eave, ridge } = H;
  const ridgeX = (x0 + x1) / 2;
  const roofY = (X: number) => eave + (ridge - eave) * (1 - Math.abs(X - ridgeX) / ((x1 - x0) / 2 + 0.35));
  // floor planks (inside) and the porch deck
  for (let x = Math.floor(U(x0)); x <= Math.ceil(U(H.porchX)); x++)
    for (let z = Math.floor(U(H.porchZ0)); z <= Math.ceil(U(z1)); z++) {
      const X = M(x), Z = M(z);
      if (X < x0 || Z < z0) continue;
      const indoor = X < x1;
      const y = Math.floor(U(floor)) - 1;
      const seam = (indoor ? Z : X) % 0.2 < VS;
      m.set(x, y, z, indoor ? (seam ? WOOD.floorD : h01(x, 0, z, 2) > 0.8 ? WOOD.hi : WOOD.floor) : seam ? PLANK.dark : plank(x, y, z, Z + 3, 7));
      if (!indoor) m.set(x, y - 1, z, PLANK.shade);
    }
  // walls: planks (vertical boards outside), corner posts, openings for the door and windows
  const win = (X: number, Y: number, Z: number) =>
    (Math.abs(Z - z1) < VS * 1.5 && X > -1.25 && X < -0.45 && Y > 3.9 && Y < 4.6) || // front window
    (Math.abs(X - x0) < VS * 1.5 && Z > -0.6 && Z < 0.2 && Y > 3.9 && Y < 4.6) || // side window
    (Math.abs(Z - z0) < VS * 1.5 && X > 0.2 && X < 0.8 && Y > 4.15 && Y < 4.65); // little back window
  const door = (X: number, Y: number, Z: number) => Math.abs(X - x1) < VS * 1.5 && Z > DOOR.z0 && Z < DOOR.z1 && Y < DOOR.top;
  for (let x = Math.floor(U(x0)); x <= Math.ceil(U(x1)); x++)
    for (let z = Math.floor(U(z0)); z <= Math.ceil(U(z1)); z++)
      for (let y = Math.floor(U(floor)); y <= Math.ceil(U(ridge)); y++) {
        const X = M(x), Y = M(y), Z = M(z);
        const onX = Math.abs(X - x0) < VS * 0.6 || Math.abs(X - x1) < VS * 0.6;
        const onZ = Math.abs(Z - z0) < VS * 0.6 || Math.abs(Z - z1) < VS * 0.6;
        if (!onX && !onZ) continue;
        if (X < x0 - VS || X > x1 + VS || Z < z0 - VS || Z > z1 + VS) continue;
        const top = onZ ? roofY(X) : eave;
        if (Y > top) continue;
        if (win(X, Y, Z) || door(X, Y, Z)) continue;
        const corner = onX && onZ;
        m.set(x, y, z, corner ? WOOD.dark : plank(x, y, z, onX ? Z + 3 : X + 3, onX ? 1 : 2));
      }
  // window frames and sills, door frame
  for (const [a, b, c, d, axis] of [[-1.3, 3.85, -0.4, 4.65, 'z'], [-0.65, 3.85, 0.25, 4.65, 'x'], [0.15, 4.1, 0.85, 4.7, 'zb']] as [number, number, number, number, string][]) {
    for (let u = U(a); u <= U(c); u++)
      for (let v = U(b); v <= U(d); v++) {
        const edge = u < U(a) + 1 || u > U(c) - 1 || v < U(b) + 1 || v > U(d) - 1;
        if (!edge) continue;
        if (axis === 'z') m.set(Math.floor(u), Math.floor(v), Math.floor(U(z1)) + 1, PR.paintWhite.base);
        else if (axis === 'zb') m.set(Math.floor(u), Math.floor(v), Math.floor(U(z0)) - 1, PR.paintWhite.base);
        else m.set(Math.floor(U(x0)) - 1, Math.floor(v), Math.floor(u), PR.paintWhite.base);
      }
  }
  for (let y = U(floor); y <= U(DOOR.top + 0.08); y++)
    for (const z of [U(DOOR.z0 - 0.07), U(DOOR.z1 + 0.04)]) m.set(Math.floor(U(x1)) + 1, Math.floor(y), Math.floor(z), WOOD.dark);
  for (let z = U(DOOR.z0 - 0.07); z <= U(DOOR.z1 + 0.04); z++) m.set(Math.floor(U(x1)) + 1, Math.floor(U(DOOR.top + 0.08)), Math.floor(z), WOOD.dark);
  // the roof: rusty tin over the front half, shingles behind, overhanging eaves
  for (let x = Math.floor(U(x0 - 0.35)); x <= Math.ceil(U(x1 + 0.35)); x++)
    for (let z = Math.floor(U(z0 - 0.3)); z <= Math.ceil(U(z1 + 0.3)); z++) {
      const X = M(x), Z = M(z);
      const y = Math.floor(U(roofY(X)));
      const tin = Z > -0.2;
      const rib = tin ? Math.floor(Z / 0.12) % 2 === 0 : Math.floor(X / 0.2 + (Math.floor(Z / 0.25) % 2) * 0.5) % 2 === 0;
      const col = tin ? (n01(x, y, z, 0.3, 21) > 0.7 ? ROOF.rust : rib ? ROOF.tin : ROOF.tinD) : rib ? ROOF.shingle : ROOF.shingleD;
      m.set(x, y, z, col, tin ? VF.METAL : undefined);
      m.set(x, y - 1, z, ROOF.shingleD);
    }
  // the hand-painted sign on the front gable
  const lines = textWidth('TRADING POST', 1, 1) <= 30 ? ['TRADING POST'] : ['TRADING', 'POST'];
  signPanel(m, Math.round(U(-0.15)), Math.round(U(4.72)), Math.round(U(z1)) + 2, lines, { bg: PR.paintWhite, ink: PR.red.dark, pad: 1, thick: 1 });
  // stovepipe out through the roof, with a hat
  cap(m, P(-1.35, 3.9, -1.15), P(-1.35, 6.55, -1.15), U(0.09), U(0.09), IRON.base, { fl: VF.METAL });
  cap(m, P(-1.35, 6.55, -1.15), P(-1.35, 6.68, -1.15), U(0.17), U(0.15), IRON.hi, { fl: VF.METAL });
  // porch: rail with a gap for the ramp, posts, a lean-to roof, a bench, a flower pot
  const px = H.porchX;
  for (let z = H.porchZ0; z <= H.porchZ1; z += VS) {
    if (z > -0.38 && z < 0.58) continue;
    m.set(Math.floor(U(px)) - 1, Math.floor(U(floor + 0.85)), Math.floor(U(z)), WOOD.base);
    if (Math.round(z / VS) % 6 === 0) for (let y = floor; y < floor + 0.85; y += VS) m.set(Math.floor(U(px)) - 1, Math.floor(U(y)), Math.floor(U(z)), WOOD.shade);
  }
  for (const z of [H.porchZ0 + 0.05, H.porchZ1 - 0.05]) cap(m, P(px - 0.06, floor, z), P(px - 0.06, 4.62, z), U(0.07), U(0.06), WOOD.dark);
  for (let x = Math.floor(U(x1)); x <= Math.ceil(U(px + 0.12)); x++)
    for (let z = Math.floor(U(H.porchZ0 - 0.1)); z <= Math.ceil(U(H.porchZ1 + 0.1)); z++) {
      const t = (M(x) - x1) / (px + 0.12 - x1);
      m.set(x, Math.floor(U(5.02 - t * 0.45)), z, Math.floor(M(z) / 0.12) % 2 ? ROOF.tin : ROOF.tinD, VF.METAL);
    }
  ell(m, P(1.62, floor + 0.42, -0.85), [U(0.16), U(0.05), U(0.26)], WOOD.hi);
  for (const z of [-0.65, -1.05]) cap(m, P(1.62, floor, z), P(1.62, floor + 0.4, z), U(0.04), U(0.04), WOOD.dark);
  vessel(m, P(2.25, floor, -1.15), [2.2, 2.8, 3.0, 2.8, 2.6], (row, x, z) => (row === 4 ? CLAY.shade : h01(x, row, z, 4) > 0.8 ? CLAY.hi : CLAY.base), { seed: 9 });
  ell(m, P(2.25, floor + 0.55, -1.15), [U(0.22), U(0.16), U(0.22)], (x, y, z) => (h01(x, y, z, 3) > 0.85 ? 0xe86a8a : LEAF.b), { keep: (lx, ly) => ly > -0.3 || lx > 0.4 });
  // brackets under the porch, down to the shell
  for (const z of [H.porchZ0 + 0.2, -0.62, 0.78]) cap(m, P(px - 0.1, floor - 0.1, z), P(1.75, domeY(1.75, z) - 0.05, z), U(0.07), U(0.06), WOOD.shade);
  // ---- inside: counter, shelves, stove, rugs, lantern, curios
  // the counter runs along the side wall; Ozman stands behind it with the window at his back.
  // Panelled ends, a thick top with an overhang, and a woven kilim draped over its front
  const cx0 = -1.05, cx1 = -0.7, cz0 = -0.6, cz1 = 0.6, ctop = floor + 0.9;
  const ix0 = Math.floor(U(cx0)), ix1 = Math.floor(U(cx1)), iz0 = Math.floor(U(cz0)), iz1 = Math.ceil(U(cz1));
  const iy0 = Math.floor(U(floor)), iyt = Math.floor(U(ctop));
  for (let x = ix0; x <= ix1; x++)
    for (let z = iz0; z <= iz1; z++)
      for (let y = iy0; y < iyt; y++) {
        const front = x === ix1, end = z === iz0 || z === iz1;
        if (!front && !end) continue;
        const Y = M(y);
        let c: number = WOOD.shade;
        if (Y < floor + 0.12) c = WOOD.dark; // kick board
        else if (end) {
          const frame = x === ix0 || x === ix1 || y <= iy0 + 2 || y >= iyt - 2;
          c = frame ? WOOD.dark : (y + x) % 5 === 0 ? WOOD.shade : WOOD.base;
        }
        m.set(x, y, z, c);
      }
  for (let x = ix0; x <= ix1 + 1; x++)
    for (let z = iz0 - 1; z <= iz1 + 1; z++) {
      const edge = x === ix1 + 1 || z === iz0 - 1 || z === iz1 + 1;
      m.set(x, iyt, z, edge ? WOOD.base : h01(x, 7, z, 3) > 0.85 ? WOOD.shade : WOOD.hi);
      m.set(x, iyt - 1, z, WOOD.dark);
    }
  // the kilim: diamonds and bands, soft folds, a zig-zag hem with tassels
  const KIL = [0x8e2a20, 0xb8432e, 0x2f4a7a, 0xd9a53a, 0xe8d6b0];
  const yHem = Math.floor(U(floor + 0.2));
  for (let z = iz0 + 1; z <= iz1 - 1; z++) {
    const fold = Math.sin(z * 0.9) > 0.55 ? 1 : 0;
    const zig = Math.abs((((z - iz0) % 4) + 4) % 4 - 2);
    for (let y = yHem + zig; y < iyt - 1; y++) {
      const dz = (((z - iz0) % 8) + 8) % 8 - 4, dy = (((y - yHem) % 8) + 8) % 8 - 4;
      const d = Math.abs(dz) + Math.abs(dy);
      const band = y >= iyt - 3 || y <= yHem + zig + 1;
      const c = band ? KIL[2] : d <= 1 ? KIL[3] : d === 2 ? KIL[4] : d === 3 ? KIL[2] : (y >> 1) % 2 ? KIL[0] : KIL[1];
      m.set(ix1 + 1 + fold, y, z, c, VF.SOFTAO);
    }
    if ((z - iz0) % 3 === 1) for (let k = 1; k <= 2; k++) m.set(ix1 + 1, yHem + zig - k, z, KIL[4], VF.SOFTAO);
  }
  // a basket on the counter (the wares come out of it), brass scales, a cash tin
  vessel(m, P(-0.88, floor + 0.95, -0.35), [2.6, 3.0, 3.1, 3.2, 3.2], (row, x, z, a) => (row === 4 ? WOOD.dark : (Math.floor((a + 4) * 4) + row) % 2 ? 0xc8a060 : 0xa8803e), { seed: 5, hollowTop: 1 });
  cap(m, P(-0.88, floor + 0.96, 0.36), P(-0.88, floor + 1.25, 0.36), U(0.025), U(0.02), 0xc8a050, { fl: VF.METAL });
  cap(m, P(-0.88, floor + 1.25, 0.21), P(-0.88, floor + 1.25, 0.51), U(0.02), U(0.02), 0xc8a050, { fl: VF.METAL });
  for (const z of [0.21, 0.51]) vessel(m, P(-0.88, floor + 1.08, z), [1.4, 0.9], () => 0xb08a40, { seed: 6, fl: VF.METAL });
  ell(m, P(-0.86, floor + 1.0, 0.05), [U(0.09), U(0.05), U(0.12)], 0x5a6a7a, { fl: VF.METAL });
  // shelves on the back wall, with jars, bottles and books
  for (const sy of [4.1, 4.7]) {
    for (let x = Math.floor(U(-1.0)); x <= Math.ceil(U(1.3)); x++) for (let z = Math.floor(U(-1.48)); z <= Math.floor(U(-1.26)); z++) m.set(x, Math.floor(U(sy)), z, WOOD.shade);
    for (let x = -0.95; x < 1.25; x += 0.17 + h01(U(x), U(sy), 1) * 0.08) {
      const k = h01(U(x), U(sy), 2);
      const base = P(x, sy + VS, -1.37);
      if (k < 0.45) vessel(m, base, k < 0.2 ? [1.2, 1.4, 1.4, 1.2, 0.8, 0.5] : [1.5, 1.8, 1.8, 1.5, 1.0], (row) => (row > 3 ? 0x8a6a4a : [0x6a9a7e, 0x9a5a3a, 0xc8a04a, 0x5a7aa0][Math.floor(k * 16) % 4]), { seed: Math.floor(k * 100), fl: k < 0.2 ? VF.SOFTAO : undefined });
      else for (let b = 0; b < 3; b++) for (let y = 0; y < 3 + (b % 2); y++) m.set(Math.floor(U(x)) + b, Math.floor(U(sy)) + 1 + y, Math.floor(U(-1.37)), [0x8a2a20, 0x2f4a7a, 0x3f6a4a, 0xc8903a][(b + Math.floor(k * 10)) % 4]);
    }
  }
  // the stove in the back-left corner, embers glowing in its belly
  vessel(m, P(-1.35, floor, -1.15), [2.2, 2.6, 3.4, 3.8, 3.8, 3.6, 3.2, 2.6, 2.0, 1.6], (row, x, z) => (row === 4 && x * 0.7 + z > U(-1.35) * 0.7 + U(-1.15) + 2 ? 0xff8a3a : row < 2 ? IRON.hi : IRON.base), { seed: 11 });
  for (let i = 0; i < 4; i++) m.set(Math.floor(U(-1.2)) + (i & 1), Math.floor(U(floor + 0.36)) + (i >> 1), Math.floor(U(-1.0)), 0xffb04a, VF.EMISSIVE | VF.GLOW);
  // a woven doormat inside the door
  for (let x = Math.floor(U(1.05)); x <= Math.floor(U(1.34)); x++)
    for (let z = Math.floor(U(-0.25)); z <= Math.ceil(U(0.45)); z++) m.set(x, Math.floor(U(floor)), z, (x + z) % 5 === 0 ? 0xe8d6b0 : Math.abs(M(z) - 0.1) < 0.08 ? 0x2f4a7a : 0xa83a2a, VF.SOFTAO);
  // a tapestry on the inside of the front wall, a cow skull by the side window
  for (let x = Math.floor(U(0.1)); x <= Math.ceil(U(0.9)); x++)
    for (let y = Math.floor(U(3.5)); y <= Math.ceil(U(4.75)); y++) m.set(x, y, Math.floor(U(H.z1)) - 1, (Math.floor(M(y) / 0.1) + Math.floor(M(x) / 0.1)) % 3 === 0 ? 0xd9a53a : Math.floor(M(y) / 0.2) % 2 ? 0x8e2a20 : 0x2f4a7a, VF.SOFTAO);
  ell(m, P(H.x0 + 0.12, 4.85, 0.62), [U(0.1), U(0.13), U(0.12)], 0xe8dcc0);
  for (const s of [-1, 1]) cap(m, P(H.x0 + 0.14, 4.92, 0.62 + s * 0.08), P(H.x0 + 0.2, 5.05, 0.62 + s * 0.3), U(0.035), U(0.015), 0xe8dcc0);
  // the inside lantern on the ridge beam, warm
  cap(m, P(-0.85, 5.4, -1.45), P(-0.85, 5.4, 1.15), U(0.07), U(0.07), WOOD.dark);
  line(m, [P(-0.85, 5.4, 0.15), P(-0.85, 5.1, 0.15)], IRON.base);
  vessel(m, P(-0.85, 4.75, 0.15), [1.8, 2.1, 2.1, 2.0, 1.4], (row) => (row === 0 || row === 4 ? IRON.base : 0xffc66a), { fl: VF.EMISSIVE | VF.SOFTAO, seed: 2 });
}

// ------------------------------------------------------------------ the acacia
function buildTree(rig: CRig) {
  const t = rig.part('tree', 'shell', Pv(J.tree));
  const bark = (x: number, y: number, z: number) => {
    const k = n01(x, y * 0.4, z, 0.5, 3);
    return k > 0.68 ? BARK.hi : k < 0.3 ? BARK.dark : (y & 3) === 0 ? BARK.shade : BARK.base;
  };
  tube(t, [P(-0.6, 2.6, -2.6), P(-0.82, 4.1, -2.82), P(-0.45, 5.4, -2.45), P(-0.75, 6.55, -2.6)], [U(0.36), U(0.28), U(0.22), U(0.17)], bark);
  // roots gripping the scutes, running down the dome
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.4;
    const pts: V3[] = [];
    for (let s = 0; s <= 4; s++) {
      const r = 0.15 + s * 0.38;
      const x = -0.6 + Math.cos(a) * r, z = -2.6 + Math.sin(a) * r * 1.1;
      if (inHouse(x, z, 0.1)) break;
      pts.push(P(x, domeY(x, z) + 0.04, z));
    }
    if (pts.length > 1) tube(t, pts, pts.map((_p, k) => U(0.14 - k * 0.022)), bark);
  }
  // branches fanning out under the flat crown
  for (const [dx, dz] of [[1.3, 0.3], [-1.2, 0.4], [0.2, 1.3], [-0.3, -1.2], [0.9, -0.9]] as [number, number][]) cap(t, P(-0.75, 6.2, -2.6), P(-0.75 + dx, 6.95, -2.6 + dz), U(0.12), U(0.05), bark);
  const c = rig.part('canopy', 'tree', Pv(J.crown));
  const leaf = (x: number, y: number, z: number) => {
    const k = n01(x, y, z, 0.6, 8);
    if (k < 0.32) return null; // gaps: a lacy crown, never a ball
    if (h01(x, y, z, 6) > 0.985) return LEAF.flower;
    return M(y) > 7.25 ? (k > 0.6 ? LEAF.c : LEAF.a) : k > 0.6 ? LEAF.a : k > 0.45 ? LEAF.b : LEAF.d;
  };
  for (const [dx, dy, dz, r] of [[0, 0.55, 0, 1.0], [1.15, 0.42, 0.3, 0.8], [-1.1, 0.45, 0.45, 0.85], [0.45, 0.4, 1.1, 0.75], [-0.3, 0.38, -1.1, 0.8], [0.85, 0.35, -0.85, 0.7], [-0.85, 0.5, -0.4, 0.65]] as [number, number, number, number][])
    ell(c, P(-0.75 + dx, 6.55 + dy, -2.6 + dz), [U(r), U(r * 0.38), U(r * 0.9)], leaf);
  hollow(c, 2);
}

// ================================================================== THE BEAST
// Gobi is sculpted on the house's 1/12 grid: at 11 m long that is the same density
// per body length as the 1/32 sand hippo, and it keeps the house's design exact.
const VB = VS;
const UB = (m: number) => m / VB;
const PB = (x: number, y: number, z: number): V3 => [x / VB, y / VB, z / VB];
const PBv = (v: V3) => PB(v[0], v[1], v[2]);
/** beast voxel index -> metres at the cell centre */
const MB = (i: number) => (i + 0.5) * VB;

// sun-baked leathery hide, horn and keratin, the scute shell
const SK = { base: 0x7a6d58, shade: 0x695d4b, hi: 0x8e826a, dark: 0x4a4034, groove: 0x3e352b, belly: 0xb2a07c, warm: 0x86704f, sand: 0xb09a76, inner: 0x3a2e26 };
const KER = { dark: 0x3e352c, base: 0x5c5040, mid: 0x857558, worn: 0xbcaa84, edge: 0xe2d6b0 };
const SCU = { a: 0x8c6a3c, b: 0xa07c48, c: 0x6a5030, bleach: 0xd8c497, bone: 0xece0bc, seam: 0x35281a, sand: 0xb89a68, lichen: 0x9aa070, lichen2: 0xc0bc90, chip: 0xe0d0a6 };
const HSC: Pal = { top: 0xb4a482, mid: 0x928266, base: 0x5e5240, rim: 0x7c6e56, ring: 0x86775c, crack: 0x463c30, sand: 0x5a4e3e };
const HORN: Pal = { top: 0xe8dcbc, mid: 0xb09c76, base: 0x5c4e3e, rim: 0x86745a, ring: 0x9c8a66, crack: 0x3a3028, sand: 0x4a4034 };

/** cellular scales (metres): distance to the nearest / second nearest cell point, and the cell id */
function vor(X: number, Y: number, Z: number, s: number, seed: number): [number, number, number] {
  const fx = X / s, fy = Y / s, fz = Z / s;
  const ix = Math.floor(fx), iy = Math.floor(fy), iz = Math.floor(fz);
  let d1 = 9, d2 = 9, id = 0;
  for (let dx = -1; dx <= 1; dx++)
    for (let dy = -1; dy <= 1; dy++)
      for (let dz = -1; dz <= 1; dz++) {
        const cx = ix + dx, cy = iy + dy, cz = iz + dz;
        const px = cx + 0.15 + 0.7 * h01(cx, cy, cz, seed), py = cy + 0.15 + 0.7 * h01(cx, cy, cz, seed + 1), pz = cz + 0.15 + 0.7 * h01(cx, cy, cz, seed + 2);
        const d = (fx - px) ** 2 + (fy - py) ** 2 + (fz - pz) ** 2;
        if (d < d1) {
          d2 = d1;
          d1 = d;
          id = (cx * 73856093) ^ (cy * 19349663) ^ (cz * 83492791);
        } else if (d < d2) d2 = d;
      }
  return [Math.sqrt(d1), Math.sqrt(d2), id];
}
/** the hide: a mosaic of leathery scales (bigger on top), soft mottling, a pale throat and belly */
function hide(X: number, Y: number, Z: number, under: number, scale = 0.11, seed = 3) {
  const [a, b, id] = vor(X, Y, Z, scale, seed);
  // grooves one cell wide on this grid, never broken into dashes
  if ((b - a) * scale < VB * 0.9) return mixc(mixc(SK.groove, SK.base, 0.35), SK.belly, under * 0.5);
  const k = ((id >>> 3) & 7) / 7;
  let c = k < 0.25 ? SK.shade : k > 0.85 ? SK.hi : SK.base;
  const m = n01(X, Y, Z, 1.2, seed + 5);
  if (m > 0.64) c = mixc(c, SK.warm, 0.4);
  else if (m < 0.34) c = mixc(c, SK.dark, 0.25);
  if (under > 0) c = mixc(c, SK.belly, Math.min(1, under) * 0.65);
  return c;
}

// ------------------------------------------------------------------ the carapace: pyramided, terraced scutes
interface Seed {
  d: V3;
  /** relief (m) */
  h: number;
  kind: 0 | 1 | 2;
  /** areola tip (m): a horn spike rising from the vertebral pyramids */
  spike: number;
}
const SEEDS: Seed[] = (() => {
  const out: Seed[] = [];
  const n = (v: V3) => norm3(v);
  // vertebrals down the spine; the front and rear ones (clear of the house) rise into horned pyramids
  [0.86, 0.5, 0.06, -0.4, -0.8].forEach((z, i) => out.push({ d: n([0, Math.sqrt(1 - z * z), z]), h: 0.3, kind: 0, spike: i === 0 ? 0.8 : i === 4 ? 1.0 : i === 3 ? 0.65 : 0 }));
  for (const s of [1, -1]) {
    // costals
    [0.66, 0.24, -0.2, -0.62].forEach((z) => out.push({ d: n([s * 0.68, 0.6, z * 0.95]), h: 0.26, kind: 1, spike: 0 }));
    // marginals round the rim
    for (let i = 1; i <= 11; i++) {
      const a = (i / 12) * Math.PI;
      out.push({ d: n([s * Math.sin(a), 0.06, Math.cos(a)]), h: 0.15, kind: 2, spike: 0 });
    }
  }
  out.push({ d: n([0, 0.08, 1]), h: 0.12, kind: 2, spike: 0 }); // nuchal
  out.push({ d: n([0, 0.08, -1]), h: 0.12, kind: 2, spike: 0 }); // supracaudal
  return out;
})();
const SEAM_W = [0.16, 0.12, 0.09];

function buildCarapace(m: VoxelModel) {
  const cut = (x: number, y: number, z: number) => MB(y) > H.floor - 0.06 && inHouse(MB(x), MB(z), 0.05);
  const RMAX = 0.36;
  const lo = PB(-CR[0] - RMAX - 0.1, 1.05, CC[2] - CR[2] - RMAX - 0.1), hi = PB(CR[0] + RMAX + 0.1, CC[1] + CR[1] + RMAX + 0.4, CC[2] + CR[2] + RMAX + 0.1);
  const T = 0.2; // shell thickness (m)
  for (let i = Math.floor(lo[0]); i <= Math.ceil(hi[0]); i++)
    for (let k = Math.floor(lo[2]); k <= Math.ceil(hi[2]); k++)
      for (let j = Math.floor(lo[1]); j <= Math.ceil(hi[1]); j++) {
        const X = MB(i), Y = MB(j), Z = MB(k);
        const nx = X / CR[0], ny = (Y - CC[1]) / CR[1], nz = (Z - CC[2]) / CR[2];
        const rho = Math.sqrt(nx * nx + ny * ny + nz * nz);
        if (rho < 0.82 || rho > 1.16) continue;
        if (ny / rho < -0.13) continue;
        const R = Math.sqrt((nx * CR[0]) ** 2 + (ny * CR[1]) ** 2 + (nz * CR[2]) ** 2) / rho; // radius along this direction (m)
        const outer = 1 + RMAX / R;
        if (rho > outer || rho < 1 - (T + 0.05) / R) continue;
        // nearest scute seeds
        const dx = nx / rho, dy = ny / rho, dz = nz / rho;
        let b1 = -2, b2 = -2, s1 = 0;
        for (let s = 0; s < SEEDS.length; s++) {
          const d = SEEDS[s].d;
          const v = dx * d[0] + dy * d[1] + dz * d[2];
          if (v > b1) {
            b2 = b1;
            b1 = v;
            s1 = s;
          } else if (v > b2) b2 = v;
        }
        const sd = SEEDS[s1];
        const cen = Math.min(1, (b1 - b2) / SEAM_W[sd.kind]); // 0 at a seam .. 1 at the areola
        const rings = sd.kind === 2 ? 2 : 3;
        const ring = Math.floor(cen * rings);
        // stepped growth terraces rising to the areola; seams sunk as grooves
        let rel = cen < 0.07 ? -0.03 : sd.h * (0.18 + 0.82 * Math.min(1, (ring + sstep(0.75, 1, cen * rings - ring)) / rings));
        // the marginals flare and turn down at the rim
        if (sd.kind === 2) rel += 0.05 * sstep(0.1, -0.1, dy);
        const surf = 1 + rel / R;
        if (rho > surf || rho < surf - T / R) continue;
        if (cut(i, j, k)) {
          // a solid deck where the dome is sliced flat under the house and porch
          if (MB(j) < H.floor - 0.06 + VB * 3) m.set(i, Math.floor(UB(H.floor - 0.06)) - 1, k, SCU.c);
          continue;
        }
        // colour: growth bands, bleached areolas, dark sand-packed seams, lichen low on the flanks, wind-scour on top
        let c: number;
        const top = rho > surf - 1.2 * (VB / R);
        if (!top) c = SCU.c;
        else if (cen < 0.14) c = SCU.seam;
        else if (cen > 0.84) c = sd.kind === 2 ? SCU.bleach : SCU.bone;
        else {
          c = ring & 1 ? SCU.b : SCU.a;
          if (cen * rings - ring < 0.1) c = mixc(c, SCU.seam, 0.4); // the step's riser
          if (dy > 0.55) c = mixc(c, SCU.bleach, sstep(0.55, 0.9, dy) * 0.45);
          if (dy < 0.28 && n01(X, Y, Z, 0.9, 13) > 0.7) c = mixc(c, SCU.lichen, 0.5);
          if (cen < 0.22) c = mixc(c, SCU.sand, 0.45); // sand packed along the seams
        }
        m.set(i, j, k, c);
      }
  // vertebral horns: sand-polished pyramids rising into curved spikes, leaning back
  for (const sd of SEEDS) {
    if (!sd.spike) continue;
    const X = sd.d[0] * CR[0], Y = CC[1] + sd.d[1] * CR[1] + sd.h * 0.85, Z = CC[2] + sd.d[2] * CR[2];
    if (inHouse(X, Z, 0.35)) continue;
    const nrm = norm3([sd.d[0] / CR[0], sd.d[1] / CR[1], sd.d[2] / CR[2]]);
    plate(m, PB(X, Y, Z), nrm, [0, 0, 1], { a: UB(0.32), b: UB(0.3), h: UB(0.16), keel: 0.2, tilt: 0.1, sink: 6, seed: Math.round(sd.d[2] * 100), sq: 2.2, spike: UB(sd.spike), spikeLean: sd.d[2] < 0 ? 0.8 : 0.55 }, HORN);
  }
  // the serrated rim: each marginal juts out as a worn, down-curved tooth (longest at the rear)
  for (const sd of SEEDS) {
    if (sd.kind !== 2) continue;
    const a = Math.atan2(sd.d[0], sd.d[2]);
    const rear = Math.max(0, -Math.cos(a));
    const ny = -0.04, cr = Math.sqrt(1 - ny * ny);
    const P0: V3 = [Math.sin(a) * CR[0] * cr, CC[1] + ny * CR[1], CC[2] + Math.cos(a) * CR[2] * cr];
    const out = norm3([Math.sin(a) / CR[0], 0, Math.cos(a) / CR[2]]);
    const len = 0.26 + 0.3 * rear;
    const tip = add3(add3(P0, scl3(out, len)), [0, -0.1 - 0.08 * rear, 0]);
    const A = PBv(add3(P0, scl3(out, -0.12))), B = PBv(tip);
    const r0 = UB(0.2), r1 = UB(0.03);
    const ax = sub3(B, A);
    const L2 = dot3(ax, ax);
    for (let i = Math.floor(Math.min(A[0], B[0]) - r0 - 1); i <= Math.ceil(Math.max(A[0], B[0]) + r0 + 1); i++)
      for (let j = Math.floor(Math.min(A[1], B[1]) - r0 - 1); j <= Math.ceil(Math.max(A[1], B[1]) + r0 + 1); j++)
        for (let k = Math.floor(Math.min(A[2], B[2]) - r0 - 1); k <= Math.ceil(Math.max(A[2], B[2]) + r0 + 1); k++) {
          const p: V3 = [i + 0.5 - A[0], j + 0.5 - A[1], k + 0.5 - A[2]];
          const t = Math.max(0, Math.min(1, dot3(p, ax) / L2));
          const q = sub3(p, scl3(ax, t));
          const r = r0 + (r1 - r0) * Math.pow(t, 0.8);
          // flattened: thin vertically, broad sideways
          if ((q[0] * q[0] + q[2] * q[2]) / (r * r) + (q[1] * q[1]) / (r * r * 0.14) > 1) continue;
          const up = q[1] > 0;
          m.set(i, j, k, t > 0.78 ? SCU.chip : up ? (t > 0.4 ? SCU.bleach : SCU.b) : SCU.c);
        }
  }
  // the plastron, the flesh in the openings, the openings for neck and tail
  ell(m, PB(0, 1.22, -0.2), [UB(2.38), UB(0.13), UB(3.08)], (x, y, z) => {
    const X = MB(x), Z = MB(z);
    if (Math.abs(X) < 0.04 || [-2.0, -0.9, 0.3, 1.5].some((s) => Math.abs(Z - s) < 0.04)) return 0x5a4a30;
    return Math.floor(Math.hypot(X * 1.2, Z) / 0.16) % 3 === 0 ? 0xa08a5e : 0xb49c6c;
  }, { keep: (lx, ly, lz) => lx * lx + ly * ly + lz * lz > 0.55 || ly < -0.5 });
  ell(m, PB(0, 1.42, -0.2), [UB(2.45), UB(0.5), UB(3.15)], SK.dark, { keep: (lx, ly, lz) => lx * lx + ly * ly + lz * lz > 0.82, under: true });
  ell(m, PB(0, 1.32, 3.32), [UB(1.2), UB(0.62), UB(0.72)], 0, { carve: true });
  ell(m, PB(0, 1.2, -3.78), [UB(0.56), UB(0.36), UB(0.46)], 0, { carve: true });
  // three old arrow shafts broken off in a rear costal, the iron heads long rusted in
  for (const [x, y, z, ax, ay, az, l] of [[-1.75, 2.45, -2.1, -0.5, 0.6, -0.3, 0.55], [-1.6, 2.62, -2.32, -0.35, 0.75, -0.2, 0.4], [-1.95, 2.25, -2.42, -0.6, 0.5, -0.45, 0.32]] as number[][]) {
    const a = PB(x, y, z), d = norm3([ax, ay, az]);
    const b = add3(a, scl3(d, UB(l)));
    cap(m, add3(a, scl3(d, -UB(0.08))), b, 0.55, 0.5, (_x, yy) => ((yy & 1) === 0 ? 0x6a4a2a : 0x8a643a));
    cap(m, b, add3(b, scl3(d, 0.8)), 0.7, 0.4, 0x9a7a4c); // splintered end
  }
}

// ------------------------------------------------------------------ the neck: three segments of folded, tubercled hide
const NECK_PTS: V3[] = [[0, 1.2, 2.55], [0, 1.42, 3.25], [0, 1.72, 3.82], [0, 1.98, 4.28], [0, 2.08, 4.6]];
const NECK_R = [0.74, 0.68, 0.62, 0.57, 0.52];
function buildNeck(rig: CRig) {
  const mass = new VoxelModel('neckMass');
  const prims: Prim[] = [];
  for (let i = 0; i < NECK_PTS.length - 1; i++) prims.push({ a: PBv(NECK_PTS[i]), b: PBv(NECK_PTS[i + 1]), r0: UB(NECK_R[i]), r1: UB(NECK_R[i + 1]) });
  prims.push({ c: PB(0, 1.28, 3.75), r: [UB(0.52), UB(0.34), UB(0.62)] }); // the heavy throat / dewlap
  prims.push({ c: PB(0, 1.55, 4.3), r: [UB(0.46), UB(0.3), UB(0.42)] });
  const under = (Y: number, Z: number) => sstep(0.1, -0.35, Y - (1.45 + (Z - 3.0) * 0.45));
  fblob(mass, prims, (x, y, z) => {
    const X = MB(x), Y = MB(y), Z = MB(z);
    return hide(X, Y, Z, under(Y, Z), Y > 1.7 + (Z - 3.2) * 0.4 ? 0.38 : 0.28, 7);
  }, { k: UB(0.18), inner: SK.inner, innerDepth: 2, disp: (x, y, z) => (n01(x, y, z, VB / 0.45, 4) - 0.5) * 0.3 });
  // loose folds of hide across the throat and round the neck
  const surf = surfaceCells(mass);
  for (const z0 of [3.05, 3.38, 3.7, 4.0]) {
    groove(mass, (x, y, z) => (MB(z) - (z0 + (MB(y) - 1.4) * 0.35 + Math.sin(MB(x) * 6 + z0 * 3) * 0.03)) / VB, { depth: 1, rim: 1.2, floor: (c) => mixc(c, SK.groove, 0.7), front: (c) => mixc(c, SK.hi, 0.25), lip: 2, lipCol: (c) => mixc(c, SK.hi, 0.2), cand: surf });
  }
  // a crest of conical tubercles down the top of the neck, smaller rows on the sides
  const spikes: [V3, V3, number][] = [];
  for (let i = 0; i < 9; i++) {
    const t = i / 8;
    const z = 2.95 + t * 1.4;
    for (const [sxv, side, len] of [[0, 0, 0.24 - t * 0.06], [0.42, 1, 0.12], [-0.42, -1, 0.12]] as number[][]) {
      if (side && (i % 3 !== 1)) continue;
      const p = lerp3(NECK_PTS[1], NECK_PTS[4], t * 0.95);
      const from = PB(sxv * 1.6, p[1] + 1.2, z);
      const hit = castIn(mass, from, side ? norm3([-side * 0.6, -1, 0]) : [0, -1, 0]);
      if (hit) spikes.push([hit, normalAt(mass, hit, 3), UB(len)]);
    }
  }
  for (const [hit, nrm, len] of spikes) plate(mass, [hit[0] + 0.5, hit[1] + 0.5, hit[2] + 0.5], nrm, [0, 0, 1], { a: UB(0.11), b: UB(0.1), h: UB(0.06), keel: 0.3, tilt: 0.2, sink: 3, seed: hit[2], sq: 2, spike: len, spikeLean: 0.7, rings: false }, HSC);
  // split into three: neck (base, it retracts), neck2, and the stub the head sits on
  const n1 = rig.part('neck', 'shell', PBv(J.neck));
  const n2 = rig.part('neck2', 'neck', PBv(J.neck2));
  const axisZ = (p: V3, q: V3) => (x: number, y: number, z: number) => {
    const ax = sub3(q, p), v = sub3([MB(x), MB(y), MB(z)], p);
    return dot3(v, ax) / dot3(ax, ax);
  };
  const s12 = axisZ(J.neck, J.neck2);
  const s23 = axisZ(J.neck2, J.head);
  splitMany(mass, { neck: n1, neck2: n2 }, (x, y, z) => (s12(x, y, z) < 1 ? 'neck' : s23(x, y, z) < 1.08 ? 'neck2' : 'drop'), [{ from: 'neck', to: 'neck2', near: (x, y, z) => s12(x, y, z) > 0.88 }]);
}

// ------------------------------------------------------------------ the head: an alligator-snapper's skull, horned and shielded
const mouthYT = (Z: number) => 1.97 + Math.max(0, 5.15 - Z) * 0.13 - sstep(5.55, 5.95, Z) * 0.14;
function buildHead(rig: CRig) {
  const mass = new VoxelModel('headMass');
  const prims: Prim[] = [
    { c: PB(0, 2.3, 4.85), r: [UB(0.62), UB(0.46), UB(0.72)] }, // cranium
    { c: PB(0, 2.2, 5.42), r: [UB(0.42), UB(0.34), UB(0.46)] }, // snout
    { a: PB(0, 2.36, 5.62), b: PB(0, 2.2, 5.98), r0: UB(0.24), r1: UB(0.17) }, // the upper beak
    { a: PB(0, 2.2, 5.98), b: PB(0, 1.82, 6.12), r0: UB(0.17), r1: UB(0.05) }, // its hooked tip
    { c: PB(0.5, 2.07, 4.72), r: [UB(0.3), UB(0.36), UB(0.42)] }, // jaw muscles
    { c: PB(-0.5, 2.07, 4.72), r: [UB(0.3), UB(0.36), UB(0.42)] },
    { c: PB(0.37, 2.6, 4.98), r: [UB(0.22), UB(0.13), UB(0.32)] }, // brow ridges
    { c: PB(-0.37, 2.6, 4.98), r: [UB(0.22), UB(0.13), UB(0.32)] },
    { a: PB(0, 1.84, 4.5), b: PB(0, 1.86, 5.62), r0: UB(0.46), r1: UB(0.26) }, // lower jaw
    { c: PB(0, 1.86, 5.78), r: [UB(0.2), UB(0.15), UB(0.18)] }, // chin, curling up to meet the hook
    { c: PB(0, 1.62, 4.62), r: [UB(0.46), UB(0.3), UB(0.48)] }, // throat
    { a: PB(0, 2.02, 4.2), b: PB(0, 2.08, 4.55), r0: UB(0.54), r1: UB(0.54) }, // neck join
    { c: PB(0.46, 2.43, 5.12), r: [UB(0.19), UB(0.18), UB(0.19)], sub: true, k: 1 }, // eye sockets
    { c: PB(-0.46, 2.43, 5.12), r: [UB(0.19), UB(0.18), UB(0.19)], sub: true, k: 1 },
  ];
  fblob(mass, prims, (x, y, z) => {
    const X = MB(x), Y = MB(y), Z = MB(z);
    const my = mouthYT(Z);
    // the keratin beak: dark horn, worn bright along its cutting edges
    if (Z > 5.12 && Math.abs(Y - my) < 0.28) {
      const e = Math.abs(Y - my);
      if (e < 0.045) return KER.edge;
      if (e < 0.09) return KER.worn;
      return Z > 5.6 ? KER.mid : (Math.floor(Z / 0.09) & 1) ? KER.base : KER.dark;
    }
    if (Z > 4.55 && Math.abs(Y - my) < 0.04) return SK.groove;
    return hide(X, Y, Z, sstep(1.95, 1.6, Y), 0.42, 11);
  }, { k: UB(0.16), inner: SK.inner, innerDepth: 2, disp: (x, y, z) => (n01(x, y, z, VB / 0.4, 6) - 0.5) * 0.3, keep: (_x, _y, z) => MB(z) > 4.16 });
  // horn shields: the frontal and parietals, prefrontals over the snout, horned brows, temporal spikes, cheek scutes
  let seed = 300;
  const shield = (at: V3, out: V3, fwd: V3, a: number, b: number, h: number, keel: number, tilt: number, spike = 0, lean = 0.9, pal = HSC) => {
    const o = norm3(out);
    const hit = castIn(mass, add3(PBv(at), scl3(o, UB(0.6))), scl3(o, -1));
    if (!hit) return;
    plate(mass, [hit[0] + 0.5, hit[1] + 0.5, hit[2] + 0.5], normalAt(mass, hit, 3), fwd, { a: UB(a), b: UB(b), h: UB(h), keel, tilt, sink: 2.5, seed: seed++, sq: 2.6, spike: UB(spike), spikeLean: lean }, pal);
  };
  // a bleached bone skull-cap of big shields, dark-rimmed (the monster's armoured brow)
  shield([0, 2.76, 4.86], [0, 1, 0], [0, 0, 1], 0.26, 0.28, 0.09, 0.25, 0.3, 0, 0.9, HORN);
  shield([0, 2.7, 4.42], [0, 1, -0.25], [0, 0, 1], 0.22, 0.32, 0.08, 0.3, 0.4, 0, 0.9, HORN);
  shield([0, 2.6, 5.3], [0, 1, 0.3], [0, 0, 1], 0.2, 0.22, 0.07, 0.2, 0.25, 0, 0.9, HORN);
  for (const s of [1, -1]) {
    shield([s * 0.38, 2.74, 4.98], [s * 0.3, 1, 0], [0, 0, 1], 0.2, 0.15, 0.1, 0.3, 0.45, 0.62, 1.0, HORN); // horned brow
    shield([s * 0.52, 2.55, 4.52], [s * 0.7, 0.7, -0.2], [0, 0.3, 1], 0.17, 0.14, 0.08, 0.3, 0.45, 0.52, 1.15, HORN); // temporal horn
    shield([s * 0.64, 2.18, 4.62], [s, 0.2, 0], [0, 1, 0], 0.2, 0.18, 0.07, 0.15, 0.4);
    shield([s * 0.6, 2.0, 5.0], [s, 0.1, 0.3], [0, 1, 0], 0.15, 0.13, 0.05, 0.15, 0.4);
  }
  // the nostrils: two slits on the beak-top behind raised valve rims that seal against the sand
  for (const s of [1, -1]) {
    const c = PB(s * 0.09, 2.47, 5.74);
    ell(mass, c, [UB(0.055), UB(0.035), UB(0.07)], KER.mid, { rot: [0, s * 0.4, 0] });
    cap(mass, add3(c, [0, 1, -1]), add3(c, [s * 0.4, 1, 1.4]), 0.6, 0.6, 0, { carve: true });
    cap(mass, add3(c, [0, 0, -1]), add3(c, [s * 0.4, 0, 1.4]), 0.6, 0.6, 0x14100c);
  }
  const head = rig.part('head', 'neck2', PBv(J.head));
  const jaw = rig.part('jaw', 'head', PBv(J.jaw));
  splitMany(mass, { head, jaw }, (x, y, z) => (MB(z) > 4.5 && MB(y) < mouthYT(MB(z)) ? 'jaw' : 'head'));
  // the mouth: the inside of the beak, a ridged palate, and the snapper's wormlike lure on the tongue
  jaw.forEach((x, y, z) => {
    if (jaw.has(x, y + 1, z) || MB(z) < 4.7) return;
    const X = MB(x);
    if (Math.abs(X) < 0.24 - (MB(z) - 4.7) * 0.14 && MB(z) < 5.6) {
      jaw.del(x, y, z);
      if (jaw.has(x, y - 1, z)) jaw.set(x, y - 1, z, 0x8a5048, VF.METAL);
    }
  });
  head.forEach((x, y, z) => {
    if (head.has(x, y - 1, z) || MB(z) < 4.7 || MB(z) > 5.6) return;
    if (Math.abs(MB(x)) < 0.22) head.set(x, y, z, (z & 3) === 0 ? 0x6e3a34 : 0x8e5048, VF.METAL);
  });
  const tongue = rig.part('tongue', 'jaw', PB(0, 1.95, 4.75));
  for (const [z, r] of [[4.8, 0.2], [5.0, 0.18], [5.2, 0.14]] as number[][]) ell(tongue, PB(0, 1.98, z), [UB(r), UB(0.06), UB(0.13)], 0xa8605a, { fl: VF.METAL, keep: (_a, _b, _c, x, y, zz) => !jaw.has(x, y, zz) });
  for (const s of [1, -1]) cap(tongue, PB(0, 2.03, 5.05), PB(s * 0.06, 2.07, 5.2), UB(0.035), UB(0.018), 0xe07a76, { fl: VF.METAL });
  // eyes deep under the horned brows (wet, gold-ringed), with heavy hooded lids (closed = built; rest = open)
  const E: V3 = [0.46, 2.43, 5.12];
  const fwd: V3 = [0.62, 0.04, 0.78];
  const eye = rig.part('eye_l', 'head', PBv(E));
  wetEye(eye, PBv(E), UB(0.17), fwd, { iris: 0xb07818, irisEdge: 0x4a2a08, sclera: 0x2a1c10, pupil: 0x060403, irisR: 0.9, pupilR: 0.42, bigGlint: 1, smallGlint: false });
  rig.mirror('eye_l', 'eye_r', 'head');
  const lid = rig.part('lid_l', 'head', PBv(E), [-1.15, 0, 0]);
  ell(lid, PBv(E), [UB(0.2), UB(0.2), UB(0.2)], (x, y, z) => (MB(y) < E[1] - 0.04 ? SK.shade : SK.base), {
    keep: (lx, ly, lz) => lx * lx + ly * ly + lz * lz > 0.62 && ly > -0.2 && lx * fwd[0] + ly * fwd[1] + lz * fwd[2] > -0.15,
  });
  rig.mirror('lid_l', 'lid_r', 'head');
  // chin tubercles: a beard of short horn spikes under the jaw
  for (const [x, z, l] of [[0.22, 5.0, 0.12], [-0.22, 5.0, 0.12], [0.34, 4.75, 0.1], [-0.34, 4.75, 0.1], [0, 5.3, 0.09], [0.14, 4.65, 0.1], [-0.14, 4.65, 0.1]] as number[][]) {
    const hit = castIn(jaw, PB(x, 1.0, z), [0, 1, 0]);
    if (hit) plate(jaw, [hit[0] + 0.5, hit[1] + 0.5, hit[2] + 0.5], normalAt(jaw, hit, 3), [0, 0, 1], { a: UB(0.07), b: UB(0.07), h: UB(0.04), keel: 0.2, tilt: 0, sink: 2, seed: Math.round(x * 50 + z * 10), sq: 2, spike: UB(l), spikeLean: 0.6, rings: false }, HSC);
  }
}

// ------------------------------------------------------------------ legs: armoured columns, a separate toe / claw part
function buildLeg(rig: CRig, name: string, S: V3, K: V3, F: V3, front: boolean) {
  const fz = 1; // toes point forward on all four feet
  const pad: V3 = [F[0] + 0.1, 0.17, F[2] + (front ? 0.12 : 0.04)];
  const legSkin = (x: number, y: number, z: number) => hide(MB(x), MB(y), MB(z), 0, MB(y) > 0.9 ? 0.4 : 0.32, front ? 15 : 16);
  const above = (a: V3, b: V3) => {
    const A = PBv(a), Bv = PBv(b), ax = sub3(Bv, A), L2 = dot3(ax, ax);
    return (x: number, y: number, z: number) => dot3(sub3([x + 0.5, y + 0.5, z + 0.5], A), ax) / L2 < 1 + 0.8 / Math.sqrt(L2);
  };
  const up = rig.part('leg_' + name, 'shell', PBv(S));
  fblob(up, [{ a: PBv(S), b: PBv(K), r0: UB(0.64), r1: UB(0.52) }, { c: PBv(lerp3(S, K, 0.35)), r: [UB(0.6), UB(0.5), UB(0.6)] }], legSkin, { k: UB(0.2), inner: SK.inner, innerDepth: 2, keep: above(S, K), disp: (x, y, z) => (n01(x, y, z, VB / 0.45, 2) - 0.5) * 0.35 });
  const ft = rig.part('foot_' + name, 'leg_' + name, PBv(K));
  fblob(ft, [
    { a: PBv(K), b: PB(F[0], 0.42, F[2]), r0: UB(0.53), r1: UB(0.55) },
    { c: PBv(pad), r: [UB(0.68), UB(0.17), UB(0.72)] },
    { c: PB(pad[0], 0.3, pad[2] - 0.05), r: [UB(0.6), UB(0.2), UB(0.62)] },
  ], (x, y, z) => {
    const Y = MB(y);
    if (Y < 0.07) return SK.dark;
    if (Y < 0.32) return mixc(legSkin(x, y, z), SK.sand, 0.35); // caked sand
    return legSkin(x, y, z);
  }, { k: UB(0.16), inner: SK.inner, innerDepth: 2, keep: (_x, y) => y >= 0, disp: (x, y, z) => (n01(x, y, z, VB / 0.45, 3) - 0.5) * 0.3 });
  // wrinkle rings round the ankle
  const surf = surfaceCells(ft);
  for (const y0 of [0.5, 0.64]) groove(ft, (x, y, z) => (MB(y) - y0 - Math.sin(MB(x) * 5 + MB(z) * 4) * 0.025) / VB, { depth: 1, rim: 1.2, floor: (c) => mixc(c, SK.groove, 0.7), front: (c) => mixc(c, SK.hi, 0.2), cand: surf });
  // big imbricate horn scales down the front of the forelimb (an armoured shin); thigh spurs on the hind legs
  let seed = name.charCodeAt(0) * 7 + name.charCodeAt(1);
  if (front) {
    for (let r = 0; r < 3; r++)
      for (let c = -1; c <= 1; c++) {
        const y = 0.55 + r * 0.24 + Math.abs(c) * 0.05;
        const o = norm3([c * 0.6 + 0.3, 0, 1]);
        const at: V3 = [F[0] + 0.1 + c * 0.24, y, F[2] + 0.1];
        const hit = castIn(ft, add3(PBv(at), scl3(o, UB(1))), scl3(o, -1));
        if (hit) plate(ft, [hit[0] + 0.5, hit[1] + 0.5, hit[2] + 0.5], normalAt(ft, hit, 3), [0, -1, 0], { a: UB(0.14), b: UB(0.15), h: UB(0.06), keel: 0.3, tilt: -0.4, sink: 2.5, seed: seed++, sq: 2.6 }, HSC);
      }
  } else {
    for (const [dy, dx, l] of [[0.0, 0.0, 0.26], [-0.18, 0.12, 0.2], [0.14, -0.1, 0.16]] as number[][]) {
      const p = lerp3(S, K, 0.62);
      const o = norm3([0.3, 0.1, -1]);
      const at: V3 = [p[0] + dx, p[1] + dy, p[2]];
      const hit = castIn(up, add3(PBv(at), scl3(o, UB(1.2))), scl3(o, -1));
      if (hit) plate(up, [hit[0] + 0.5, hit[1] + 0.5, hit[2] + 0.5], normalAt(up, hit, 3), [0, 1, 0], { a: UB(0.1), b: UB(0.1), h: UB(0.06), keel: 0.2, tilt: 0, sink: 2.5, seed: seed++, sq: 2, spike: UB(l), spikeLean: 0.4, rings: false }, HORN);
    }
  }
  // the toes: heavy, curved, chipped horn claws round the front of the pad
  const n = front ? 5 : 4;
  const toeP: V3 = [pad[0], 0.14, pad[2] + 0.5];
  const toes = rig.part('toes_' + name, 'foot_' + name, PBv(toeP));
  for (let k = 0; k < n; k++) {
    const a = (k - (n - 1) / 2) * (front ? 0.33 : 0.38) + 0.12;
    const d: V3 = [Math.sin(a), 0, Math.cos(a) * fz];
    const root: V3 = [pad[0] + d[0] * 0.5, 0.16, pad[2] + d[2] * 0.55];
    const mid = add3(root, [d[0] * 0.14, 0.02, d[2] * 0.14]);
    const tip = add3(root, [d[0] * 0.3, -0.12, d[2] * 0.3]);
    cap(toes, PBv(root), PBv(mid), UB(0.13), UB(0.11), SK.shade);
    const chipped = (k + n) % 3 === 0;
    tube(toes, [PBv(mid), PBv(lerp3(mid, tip, 0.5)), PBv(chipped ? lerp3(mid, tip, 0.82) : tip)], [UB(0.1), UB(0.075), UB(chipped ? 0.05 : 0.025)], (x, y) => {
      const Y = MB(y);
      return Y > 0.17 ? KER.mid : Y < 0.07 ? KER.worn : KER.base;
    }, { keep: (_t, _a, _b, _x, y) => y >= 0 });
  }
}

// ------------------------------------------------------------------ the tail: a thick, spiked chain ending in a horn club
const TAIL_PTS: V3[] = [[0, 1.3, -3.6], [0, 1.08, -4.18], [0, 0.86, -4.62], [0, 0.66, -4.98], [0, 0.55, -5.2]];
const TAIL_R = [0.36, 0.27, 0.19, 0.12, 0.06];
function buildTail(rig: CRig) {
  const names = ['tail', 'tail2', 'tail3'];
  let parent = 'shell';
  for (let i = 0; i < 3; i++) {
    const m = rig.part(names[i], parent, PBv(TAIL_PTS[i]));
    const last = i === 2;
    const prims: Prim[] = [{ a: PBv(TAIL_PTS[i]), b: PBv(TAIL_PTS[i + 1]), r0: UB(TAIL_R[i]), r1: UB(TAIL_R[i + 1]) }];
    if (last) prims.push({ a: PBv(TAIL_PTS[3]), b: PBv(TAIL_PTS[4]), r0: UB(TAIL_R[3]), r1: UB(TAIL_R[4]) });
    fblob(m, prims, (x, y, z) => hide(MB(x), MB(y), MB(z), sstep(0, -0.6, MB(y) - (TAIL_PTS[i][1] - 0.05)), 0.28, 25), { k: UB(0.1), inner: SK.inner, innerDepth: 2 });
    // a triple crest of tubercles (the snapper's saw-backed tail)
    const a = TAIL_PTS[i], b = TAIL_PTS[last ? 4 : i + 1];
    const nS = last ? 3 : 2;
    for (let s = 0; s < nS; s++) {
      const t = (s + 0.5) / nS;
      const p = lerp3(a, b, t);
      for (const [dx, len] of [[0, 0.2 - i * 0.04], [0.16, 0.1], [-0.16, 0.1]] as number[][]) {
        const hit = castIn(m, PB(p[0] + dx * (1 - i * 0.25), p[1] + 0.8, p[2]), [0, -1, 0]);
        if (hit) plate(m, [hit[0] + 0.5, hit[1] + 0.5, hit[2] + 0.5], normalAt(m, hit, 3), sub3(a, b), { a: UB(0.08), b: UB(0.07), h: UB(0.05), keel: 0.4, tilt: 0.3, sink: 2, seed: i * 10 + s * 3 + dx * 20, sq: 2, spike: UB(len), spikeLean: 1.2, rings: false }, dx ? HSC : HORN);
      }
    }
    if (last) cap(m, PBv(TAIL_PTS[4]), add3(PBv(TAIL_PTS[4]), PB(0, -0.06, -0.2)), UB(0.07), UB(0.015), (_x, y) => (MB(y) > 0.52 ? HORN.top : HORN.mid));
    parent = names[i];
  }
}

/**
 * Secondary motion for Gobi's extra joints (the shop's Turtle drives shell, neck,
 * head, jaw, lids, eyes, legs, feet, tail and the house; this follows them):
 * neck2 follows the head with a lag, the toes curl as a foot lifts and splay as it
 * lands, the tail chain sways after its root, the lure tongue wriggles and the
 * throat pumps with his breath. Call update(dt) after the shop has posed him.
 */
export class GobiAnim {
  private t = Math.random() * 10;
  private n: Record<string, THREE.Object3D | undefined> = {};
  private rest: Record<string, THREE.Vector3> = {};
  private nk = new THREE.Vector2();
  private tail = [0, 0, 0, 0];
  private tailV = [0, 0, 0, 0];
  constructor(rig: { nodes: Record<string, THREE.Object3D>; meshes?: Record<string, THREE.Object3D>; geo: { parts: { name: string; offset: THREE.Vector3 }[] } }) {
    for (const p of rig.geo.parts) {
      this.n[p.name] = rig.nodes[p.name];
      this.rest[p.name] = p.offset.clone();
    }
    this.mesh = rig.meshes ?? {};
  }
  private mesh: Record<string, THREE.Object3D>;
  update(dt: number) {
    if (dt <= 0) return;
    const t = (this.t += dt);
    const n = this.n;
    const head = n.head;
    // neck2 carries part of the head's turn, a beat behind it
    if (n.neck2 && head) {
      const k = 1 - Math.exp(-4 * dt);
      this.nk.x += (head.rotation.x * 0.45 - this.nk.x) * k;
      this.nk.y += (head.rotation.y * 0.5 - this.nk.y) * k;
      n.neck2.rotation.set(this.nk.x + Math.sin(t * 0.9) * 0.012, this.nk.y, Math.sin(t * 0.37) * 0.01);
    }
    // breathing: the throat swells and the neck lifts a touch
    const br = Math.sin(t * 1.1);
    const m2 = this.mesh['neck2'];
    if (m2) m2.scale.set(1 + br * 0.018, 1 + br * 0.022, 1);
    // toes: curl as the foot rises, splay flat when it bears weight
    for (const id of ['fl', 'fr', 'bl', 'br']) {
      const leg = n['leg_' + id], r = this.rest['leg_' + id], toes = n['toes_' + id];
      if (!leg || !r || !toes) continue;
      const lift = Math.max(0, Math.min(1, (leg.position.y - r.y) / 0.16));
      toes.rotation.set(lift * 0.55 - 0.04, 0, 0);
    }
    // the tail chain: lagging springs behind the root's sway
    const root = n.tail;
    if (root) {
      const drive = [root.rotation.y, root.rotation.x];
      for (let i = 0; i < 2; i++) {
        const nm = i === 0 ? 'tail2' : 'tail3';
        const node = n[nm];
        if (!node) continue;
        for (let a = 0; a < 2; a++) {
          const k = i * 2 + a;
          const tgt = (i === 0 ? drive[a] : this.tail[a]) * 1.1 + (a === 0 ? Math.sin(t * 0.8 + i) * 0.03 : 0);
          this.tailV[k] += (90 * (tgt - this.tail[k]) - 7 * this.tailV[k]) * dt;
          this.tail[k] += this.tailV[k] * dt;
        }
        node.rotation.set(this.tail[i * 2 + 1], this.tail[i * 2], 0);
      }
    }
    // the lure: a pink worm on the tongue that wriggles when the beak is open
    const tg = n.tongue;
    if (tg) tg.rotation.set(Math.sin(t * 6) * 0.04, Math.sin(t * 4.3) * 0.08, 0);
  }
}

// ------------------------------------------------------------------ moving house parts
function buildDoor(rig: CRig) {
  const hinge: V3 = [H.x1 + VS, H.floor, DOOR.z0];
  const m = rig.part('door', 'shell', Pv(hinge));
  for (let z = Math.floor(U(DOOR.z0)); z < Math.floor(U(DOOR.z1)); z++)
    for (let y = Math.floor(U(H.floor)); y < Math.floor(U(DOOR.top)); y++) {
      const Z = M(z) - DOOR.z0, Y = M(y) - H.floor;
      const brace = Math.abs(Y - Z * 2.3 - 0.15) < VS * 0.8 || Math.abs(Y - 0.3) < VS * 0.6 || Math.abs(Y - 1.65) < VS * 0.6;
      m.set(Math.floor(U(H.x1)) + 1, y, z, brace ? 0x3e6a66 : Math.floor(Z / 0.13) % 2 ? PLANK.teal : 0x5a9a94);
    }
  for (const y of [0.3, 1.65]) cap(m, P(H.x1 + VS * 1.5, H.floor + y, DOOR.z0 + 0.02), P(H.x1 + VS * 1.5, H.floor + y, DOOR.z0 + 0.22), U(0.03), U(0.03), IRON.base, { fl: VF.METAL });
  ell(m, P(H.x1 + VS * 2, H.floor + 1.0, DOOR.z1 - 0.12), [U(0.04), U(0.04), U(0.04)], 0xc8a050, { fl: VF.METAL });
}

/** a shutter, modelled closed; rest rotation folds it open against the wall */
function buildShutter(rig: CRig, name: string, hinge: V3, along: V3, w: number, h: number, open: number) {
  const m = rig.part(name, 'shell', Pv(hinge), [0, open, 0]);
  const x0 = Math.floor(U(hinge[0])), y0 = Math.floor(U(hinge[1])), z0 = Math.floor(U(hinge[2]));
  const nw = Math.round(U(w)), nh = Math.round(U(h));
  for (let s = 0; s < nw; s++)
    for (let v = 0; v < nh; v++) {
      const frame = s === 0 || s === nw - 1 || v === 0 || v === nh - 1;
      const slat = v % 2 === 0;
      m.set(x0 + along[0] * s, y0 + v, z0 + along[2] * s, frame ? 0x2f5a56 : slat ? 0x3f7470 : h01(s, v, 3, 2) > 0.85 ? 0x6aa29a : 0x4f8a86);
    }
}

const RAMP_TILT = Math.atan2(H.floor - 0.08, 2.9);
function buildRamp(rig: CRig) {
  const p = J.ramp;
  const m = rig.part('ramp', 'shell', Pv(p), [0, 0, RAMP_TILT]);
  const end: V3 = [p[0] + 2.9, 0.08, p[2]];
  const L = Math.hypot(end[0] - p[0], end[1] - p[1]);
  const n = Math.ceil(U(L) * 1.5);
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = p[0] + (end[0] - p[0]) * t, y = p[1] + (end[1] - p[1]) * t - 0.03;
    for (let z = Math.floor(U(-0.32)); z <= Math.ceil(U(0.52)); z++) {
      const rail = z <= Math.floor(U(-0.32)) || z >= Math.ceil(U(0.52)) - 0;
      const cleat = Math.floor(t * L / 0.32) !== Math.floor(((i + 1) / n) * L / 0.32);
      m.set(Math.floor(U(x)), Math.floor(U(y)), z, rail ? WOOD.dark : cleat ? WOOD.shade : h01(i, z, 1) > 0.8 ? WOOD.hi : WOOD.base);
      if (rail) m.set(Math.floor(U(x)), Math.floor(U(y)) + 1, z, WOOD.dark);
    }
  }
}

function buildLantern(rig: CRig, name: string, at: V3) {
  const m = rig.part(name, 'shell', Pv(at));
  const [x, y, z] = at;
  line(m, [P(x, y, z), P(x, y - 0.15, z)], IRON.base);
  vessel(m, P(x, y - 0.25, z), [0.9, 1.4, 1.8, 1.1], () => IRON.base, { seed: 2 });
  vessel(m, P(x, y - 0.55, z), [1.6, 1.8, 1.9, 1.8, 1.6], (row) => (row === 2 ? 0xffe2a0 : 0xffc66a), { fl: VF.EMISSIVE | VF.SOFTAO, seed: 3 });
  vessel(m, P(x, y - 0.63, z), [2.0, 1.8], () => IRON.base, { seed: 4 });
}

function buildChime(rig: CRig, at: V3) {
  const m = rig.part('chime', 'shell', Pv(at));
  const [x, y, z] = at;
  // a driftwood bar, five strings, bleached bones and little shells
  cap(m, P(x, y - 0.05, z - 0.2), P(x, y - 0.06, z + 0.2), U(0.04), U(0.035), WOOD.dark);
  line(m, [P(x, y, z), P(x, y - 0.05, z)], ROOF.tinD);
  for (let i = 0; i < 5; i++) {
    const dz = -0.16 + i * 0.08, len = 0.22 + ((i * 7) % 3) * 0.08;
    line(m, [P(x, y - 0.08, z + dz), P(x, y - 0.12 - len * 0.4, z + dz)], 0xc9a86a);
    const top = y - 0.12 - len * 0.4;
    for (let k = 0; k < 3; k++) m.set(Math.floor(U(x)), Math.floor(U(top)) - k, Math.floor(U(z + dz)), i % 2 ? 0xe8dcc0 : k === 2 ? 0xc8b890 : 0xd8ccb0);
  }
}

function buildPots(rig: CRig, at: V3) {
  const m = rig.part('pots', 'shell', Pv(at));
  const [x, y, z] = at;
  for (const [dz, h, s] of [[-0.12, 0.42, 1], [0.12, 0.3, 2]] as [number, number, number][]) {
    line(m, [P(x, y, z), P(x, y - h + 0.36, z + dz)], 0xc9a86a);
    const prof = s === 1 ? [1.6, 2.4, 2.9, 3.0, 2.6, 1.8, 1.4, 1.6] : [1.4, 2.2, 2.6, 2.4, 1.7, 1.2, 1.4];
    vessel(m, P(x, y - h - 0.05, z + dz), prof, (row, xx, zz) => (row === 3 && s === 1 ? CLAY.paint : row === prof.length - 1 ? CLAY.shade : h01(xx, row, zz, s) > 0.8 ? CLAY.hi : CLAY.base), { seed: s, hollowTop: 1 });
  }
}

// ================================================================== RIG
let cached: RigSpec | null = null;
export function turtleHouseRig(): RigSpec {
  if (cached) return cached;
  // ---- the house and everything on it
  const hr = new CRig('turtle_house_12', VS);
  const house = hr.part('shell', undefined, Pv(J.shell));
  buildHouse(house);
  buildTree(hr);
  buildDoor(hr);
  buildShutter(hr, 'shut_fa', [-1.25, 3.9, H.z1 + 2 * VS], [1, 0, 0], 0.4, 0.7, -1.75);
  buildShutter(hr, 'shut_fb', [-0.45, 3.9, H.z1 + 2 * VS], [-1, 0, 0], 0.4, 0.7, 1.75);
  buildShutter(hr, 'shut_sa', [H.x0 - 2 * VS, 3.9, -0.6], [0, 0, 1], 0.4, 0.7, -1.75);
  buildShutter(hr, 'shut_sb', [H.x0 - 2 * VS, 3.9, 0.2 - VS], [0, 0, -1], 0.4, 0.7, 1.75);
  buildRamp(hr);
  buildLantern(hr, 'lantern_a', [H.porchX + 0.02, 4.55, -0.6]);
  buildLantern(hr, 'lantern_b', [H.porchX + 0.02, 4.55, 0.8]);
  buildChime(hr, [H.porchX + 0.05, 4.52, -1.25]);
  buildPots(hr, [2.0, 4.72, 1.05]);
  // ---- the beast
  const rig = new CRig('turtle_house', VB);
  const shell = rig.part('shell', undefined, PBv(J.shell));
  buildCarapace(shell);
  house.forEach((x, y, z, c, f) => shell.set(x, y, z, c, f));
  buildNeck(rig);
  buildHead(rig);
  buildLeg(rig, 'fl', J.legF, J.kneeF, J.footF, true);
  buildLeg(rig, 'bl', J.legB, J.kneeB, J.footB, false);
  for (const [a, b] of [['fl', 'fr'], ['bl', 'br']]) {
    rig.mirror('leg_' + a, 'leg_' + b, 'shell');
    rig.mirror('foot_' + a, 'foot_' + b, 'leg_' + b);
    rig.mirror('toes_' + a, 'toes_' + b, 'foot_' + b);
  }
  buildTail(rig);
  // ---- the house parts (pivots and rest angles carry over)
  for (const p of hr.parts) if (p.name !== 'shell') rig.part(p.name, p.parent, p.pivot, p.rest).merge(p.model);
  // buried ends never meshed; overlapping parts never share an exposed cell
  const beast = /^(neck|neck2|head|jaw|tongue|leg_|foot_|toes_|tail)/;
  for (const p of rig.parts) if (p.parent && beast.test(p.name) && p.name !== 'jaw' && p.name !== 'tongue') cullBuried(p.model, rig.m(p.parent), 3);
  // the roots of the limbs, neck and tail hidden inside the shell's flesh bag (they only ever move further in)
  for (const p of rig.parts) {
    if (!/^(leg_|neck$|tail$)/.test(p.name)) continue;
    const del: V3[] = [];
    p.model.forEach((x, y, z) => {
      const lx = MB(x) / 2.45, ly = (MB(y) - 1.42) / 0.5, lz = (MB(z) + 0.2) / 3.15;
      if (lx * lx + ly * ly + lz * lz < 0.62 && MB(y) > 1.0) del.push([x, y, z]);
    });
    for (const [x, y, z] of del) p.model.del(x, y, z);
  }
  for (const p of rig.parts) {
    if (!p.parent || !beast.test(p.name)) continue;
    const par = rig.m(p.parent);
    const del: V3[] = [];
    p.model.forEach((x, y, z) => {
      if (par.has(x, y, z) && exposed(par, x, y, z)) del.push([x, y, z]);
    });
    for (const [x, y, z] of del) p.model.del(x, y, z);
  }
  rig.socket('porch', 'shell', PBv(J.porch), [0, Math.PI / 2, 0]);
  rig.socket('counter', 'shell', PBv(J.counter), [0, Math.PI / 2, 0]);
  rig.socket('head_top', 'head', PB(0, 2.95, 4.8));
  let top = 0;
  for (const p of rig.parts) p.model.forEach((_x, y) => (top = Math.max(top, y + 1)));
  const v = (x: number, y: number, z: number): V3 => [x, y, z];
  cached = rig.build({
    turtleHouse: true,
    height: top * VB,
    radius: 3.4,
    front: 6.02,
    retract: {
      neck: v(0, -0.35, -1.85),
      leg_fl: v(-0.3, 1.05, -0.1),
      leg_fr: v(0.3, 1.05, -0.1),
      leg_bl: v(-0.25, 0.98, 0.1),
      leg_br: v(0.25, 0.98, 0.1),
      tail: v(0, 0.2, 0.7),
    },
    /** onto the plastron once the legs are in, then how far he burrows on top of that (m) */
    shellDrop: 1.05,
    dig: 0.85,
    swing: ['lantern_a', 'lantern_b', 'chime', 'pots', 'tree', 'canopy'],
    /** shutters and the door: closed = rotation 0; open = their rest rotation */
    shutters: ['shut_fa', 'shut_fb', 'shut_sa', 'shut_sb'],
    door: { part: 'door', open: 1.65 }, // swings out onto the porch
    /** level at rest; `stow` slides it in under the porch, `tilt` lowers it to the sand */
    ramp: { part: 'ramp', tilt: RAMP_TILT, stow: [-3.95, -0.26, 0], foot: [H.porchX + 2.9, 0.08, 0.1], top: [H.porchX - 0.05, H.floor, 0.1] },
    /** in root space (m): the doorway, a spot inside the door, the room's camera, where the wares come from */
    doorway: [H.x1 + 0.35, H.floor, 0.1],
    inside: [0.75, H.floor, 0.1],
    /** Ozymandias's walk from the porch, in at the door, round the counter's end to his place behind it (x, z at floor level) */
    ozPath: [[J.porch[0], J.porch[2]], [2.0, 0.1], [1.6, 0.1], [0.95, 0.1], [-0.3, 0.86], [-1.38, 0.86], [J.counter[0], J.counter[2]]],
    porch: J.porch,
    counter: J.counter,
    room: { rug: [-0.25, H.floor, -0.3], cam: [1.3, 4.38, 0.1], look: [-0.8, 3.75, -0.35], stand: [0.85, H.floor, -0.95], lamp: [-0.85, 4.6, 0.15] },
    pack: [-0.88, H.floor + 1.2, -0.35],
    chimney: [-1.35, 6.75, -1.15],
    eyes: 'voxel',
    /** the joints the shop's Turtle does not pose: drive them with `new GobiAnim(rig).update(dt)` */
    secondary: ['neck2', 'toes_fl', 'toes_fr', 'toes_bl', 'toes_br', 'tail2', 'tail3', 'tongue'],
  });
  return cached;
}

// ================================================================== Ozman, the tortoise man
const TURBAN = new Map<number, number>([
  [0x3f4c7c, 0xe6dcc4], // headscarf indigo -> turban linen
  [0x2f3a62, 0xc4b590],
  [0xd9a53a, 0xa8382a], // its gold motif -> a red band
]);
const VEST = new Map<number, number>([
  [0xb0563a, 0x55683a], // knitted shawl -> olive waistcoat
  [0x8e4028, 0x3f4e2a],
  [0xe8d6b0, 0xc9a050], // cream stripes -> gold piping
]);
let guy: RigSpec | null = null;
/** Ozman: Old Mother Tamsin's rig, re-dressed as an old tortoise gentleman (her model is untouched) */
export function tortoiseGuyRig(): RigSpec {
  if (guy) return guy;
  const base = merchantRig();
  const drop = new Set(['coins', 'beads']);
  const recolour = (m: VoxelModel, map: Map<number, number>) => {
    const o = m.clone();
    o.forEach((x, y, z, c, f) => {
      const n = map.get(c);
      if (n !== undefined) o.set(x, y, z, n, f);
    });
    return o;
  };
  const parts: PartSpec[] = base.parts
    .filter((p) => !drop.has(p.name))
    .map((p) => ({ ...p, model: p.name === 'head' || p.name === 'scarf_tails' ? recolour(p.model, TURBAN) : p.name === 'shell' ? recolour(p.model, VEST) : p.model }));
  // a long white beard under the beak (it sways)
  const beard = new VoxelModel('beard');
  const chin: V3 = [0, 42.2, 11.6];
  for (const [dx, len, r] of [[0, 6.2, 2.0], [-1.2, 4.8, 1.2], [1.2, 5.0, 1.2]] as [number, number, number][])
    tube(beard, [[chin[0] + dx, chin[1], chin[2]], [chin[0] + dx * 1.1, chin[1] - len * 0.55, chin[2] + 1.0], [chin[0] + dx * 0.6, chin[1] - len, chin[2] + 0.9]], [r, r * 0.8, 0.5], (x, y) => ((x + y) & 1 ? 0xe9e5da : 0xcac2b2), { fl: VF.SOFTAO });
  parts.push({ name: 'beard', model: beard, pivot: chin, attach: chin, parent: 'jaw' });
  const meta = { ...base.meta, swing: (base.meta?.swing ?? []).filter((s: string) => !drop.has(s)).concat(['beard']) };
  guy = { ...base, name: 'tortoise_guy', parts, meta };
  return guy;
}
