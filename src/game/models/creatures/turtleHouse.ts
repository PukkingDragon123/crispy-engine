// Gobi, the walking trading post: a colossal, gentle desert/sea-turtle (about
// 8.6 m nose to tail, 7.6 m to the top of his tree) with a little weathered
// shack built on his shell. Sculpted scaly legs ending in broad flipper-paddle
// feet with horn claws, a big kind beaked head with wet modelled eyes and
// heavy lids, a sun-bleached scute shell with pyramided vertebrals, and on top:
// a plank house (door, shuttered windows, a tin-and-shingle roof, stovepipe,
// a hand-painted TRADING POST sign on the gable), a porch with a bench, rail,
// lanterns and a wind chime, a fold-down ramp, and an acacia whose roots grip
// the scutes. Inside: a warm, cluttered shop — counter, shelves of jars and
// books, rugs, a pot-belly stove, a lantern, curios.
//
// Ozman, the tortoise man who keeps the shop, is a variant of Old Mother
// Tamsin's (frozen, approved) rig: a turban instead of her headscarf, an olive
// waistcoat for her shawl, a white beard, no coins or beads (`tortoiseGuyRig`).
//
// RIG (faces +Z, LEFT = +X, origin on the ground under the shell, 1/12 m):
//   shell (root, house + interior) → neck → head → jaw, eye_l/eye_r, lid_l/lid_r
//   shell → leg_fl → foot_fl (fr, bl, br), shell → tail, shell → tree → canopy
//   shell → door, shut_fa/shut_fb (front window), shut_sa/shut_sb (side window), ramp
//   shell → lantern_a, lantern_b, chime, pots (swing)
// Sockets: porch (where Ozman stands, facing the ramp), counter (inside, behind
// the counter). meta.retract / shellDrop / dig: hiding and burrowing.
import { CRig, VoxelModel, VF, V3, RigSpec, ell, cap, tube, line, blob, Prim, hollow, splitInto, wetEye, vessel, sheet, n01, h01, mixc, finish } from './ckit';
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
const SKIN = { base: 0x7d7562, shade: 0x605948, hi: 0x989079, dark: 0x403b30, groove: 0x4c4639, warm: 0x8c7a5c, belly: 0xb2a684 };
const CARA = { base: 0x6b5a3a, ring: 0x7e6b45, seam: 0x36291a, bleach: 0xa9946a, chip: 0xbaa276, dust: 0x9b8159, scratch: 0x4a3a26, moss: 0x6f7a44 };
const PLAS = { base: 0xb39a6a, ring: 0xa38a5c, seam: 0x6a5634 };
const HORN = { base: 0x4c4436, hi: 0x6c6250, edge: 0x2e2a22, claw: 0xcdbf9c, clawD: 0x9a8c6c };
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
  neck: [0, 1.3, 3.0] as V3,
  head: [0, 2.05, 4.38] as V3,
  jaw: [0, 2.05, 4.6] as V3,
  eye: [0.38, 2.32, 5.06] as V3,
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

// ------------------------------------------------------------------ skin, shell
function skin(x: number, y: number, z: number, cell = 2.0, seed = 0) {
  const rowH = cell * 0.85;
  const row = Math.floor((y + 4000) / rowH);
  const off = (row & 1) * 0.5;
  const fx = (x + 4000) / cell + off, fz = (z + 4000) / cell + off * 0.7;
  const gx = fx - Math.floor(fx), gz = fz - Math.floor(fz), gy = (y + 4000) / rowH - row;
  if (Math.min(gx, 1 - gx, gz, 1 - gz, gy, 1 - gy) < 0.1) return SKIN.groove;
  const k = h01(Math.floor(fx), row, Math.floor(fz), seed);
  let c = k < 0.33 ? SKIN.shade : k < 0.82 ? SKIN.base : SKIN.hi;
  const n = n01(x, y, z, 0.12, seed);
  if (n > 0.68) c = mixc(c, SKIN.warm, 0.4);
  else if (n < 0.28) c = mixc(c, SKIN.dark, 0.25);
  return c;
}

function scute(x: number, y: number, z: number) {
  const nx = M(x) / CR[0], ny = (M(y) - CC[1]) / CR[1], nz = (M(z) - CC[2]) / CR[2];
  const ax = Math.abs(nx);
  const wob = (n01(x, y, z, 0.12, 4) - 0.5) * 0.07;
  let seam = false, cu = 0, cv = 0, band = 0;
  if (ny < -0.05) {
    const ang = Math.atan2(nx, nz);
    const k = Math.round((ang + wob) / 0.26);
    seam = Math.abs(ang + wob - k * 0.26) < 0.025 || Math.abs(ny + 0.05) < 0.035;
    cu = Math.sin(k * 0.26) * 0.95;
    cv = Math.cos(k * 0.26) * 0.95;
    band = 40;
  } else if (ax < 0.27 + wob) {
    const B = [-1.2, -0.6, -0.2, 0.2, 0.58, 1.2];
    for (let i = 0; i < B.length - 1; i++)
      if (nz >= B[i] && nz < B[i + 1]) {
        cv = (B[i] + B[i + 1]) / 2;
        band = i;
        seam = nz - B[i] < 0.03 || B[i + 1] - nz < 0.018;
      }
    seam = seam || Math.abs(ax - (0.27 + wob)) < 0.025;
  } else {
    const B = [-1.2, -0.46, 0.04, 0.5, 1.2];
    for (let i = 0; i < B.length - 1; i++)
      if (nz + wob >= B[i] && nz + wob < B[i + 1]) {
        cv = (B[i] + B[i + 1]) / 2;
        band = 10 + i;
        seam = nz + wob - B[i] < 0.03;
      }
    cu = Math.sign(nx) * 0.56;
  }
  if (seam) return h01(x, y, z, 3) < 0.35 ? CARA.dust : CARA.seam;
  const d = Math.hypot((nx - cu) * 1.2, nz - cv);
  let c: number = Math.floor(d / 0.055) % 2 ? CARA.ring : CARA.base;
  if (ny > 0.55 && c === CARA.ring) c = CARA.bleach;
  else if (ny > 0.72) c = mixc(c, CARA.bleach, 0.45);
  // a little moss in the shade of the rim and under the tree
  if ((ny < 0.25 && n01(x, y, z, 0.2, 13) > 0.72) || (nz < -0.5 && n01(x, y, z, 0.25, 14) > 0.7)) c = mixc(c, CARA.moss, 0.55);
  if (h01(x >> 1, y >> 1, z >> 1, 9) > 0.988) c = CARA.chip;
  if (Math.abs(n01(x, y, z, 0.3, 11) - 0.5) < 0.01 && band < 20) c = CARA.scratch;
  return c;
}

const inHouse = (X: number, Z: number, pad = 0) => X > H.x0 - pad && X < H.porchX + pad && Z > H.z0 - pad && Z < H.z1 + pad;

function buildBody(m: VoxelModel) {
  // flesh inside so openings never show a void
  ell(m, P(0, 1.4, -0.2), [U(2.35), U(0.55), U(3.0)], () => SKIN.dark);
  // the carapace: dome cut at the rim, sliced flat where the house and porch stand
  ell(m, Pv(CC), [U(CR[0]), U(CR[1]), U(CR[2])], (x, y, z) => scute(x, y, z), {
    keep: (_lx, ly, _lz, x, y, z) => ly > -0.12 && !(M(y) > H.floor - 0.06 && inHouse(M(x), M(z), 0.05)),
  });
  for (const vz of [-0.95, -0.42, 0.62, 0.92]) {
    const z = CC[2] + vz * CR[2];
    if (inHouse(0, z, 0.3)) continue;
    ell(m, P(0, domeY(0, z) - 0.04, z), [U(0.42), U(0.12), U(0.42)], (x, y, zz) => scute(x, y, zz));
  }
  for (let i = 0; i < 34; i++) {
    const a = (i / 34) * Math.PI * 2;
    ell(m, P(Math.sin(a) * CR[0] * 0.98, 1.25, CC[2] + Math.cos(a) * CR[2] * 0.98), [U(0.28), U(0.11), U(0.28)], (x, y, z) => scute(x, y, z));
  }
  ell(m, P(0, 1.3, 3.35), [U(1.05), U(0.55), U(0.65)], 0, { carve: true });
  ell(m, P(0, 1.2, -3.75), [U(0.48), U(0.32), U(0.42)], 0, { carve: true });
  ell(m, P(0, 1.22, -0.2), [U(2.35), U(0.13), U(3.05)], (x, y, z) => {
    const X = M(x), Z = M(z);
    if (Math.abs(X) < 0.05 || [-2.0, -0.9, 0.3, 1.5].some((s) => Math.abs(Z - s) < 0.05)) return PLAS.seam;
    return Math.floor(Math.hypot(X * 1.2, Z) / 0.14) % 3 === 0 ? PLAS.ring : PLAS.base;
  });
}

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

// ------------------------------------------------------------------ head, neck, legs, tail
function buildHead(rig: CRig) {
  const mass = new VoxelModel('headMass');
  const E = J.eye;
  const prims: Prim[] = [
    { c: P(0, 2.2, 4.75), r: [U(0.55), U(0.5), U(0.62)] },
    { c: P(0, 2.05, 5.25), r: [U(0.38), U(0.34), U(0.36)] },
    { c: P(0.3, 2.43, 4.95), r: [U(0.2), U(0.11), U(0.2)] },
    { c: P(-0.3, 2.43, 4.95), r: [U(0.2), U(0.11), U(0.2)] },
    { c: P(0.38, 2.05, 4.75), r: [U(0.22), U(0.24), U(0.3)] },
    { c: P(-0.38, 2.05, 4.75), r: [U(0.22), U(0.24), U(0.3)] },
    { c: P(0, 1.85, 4.62), r: [U(0.38), U(0.22), U(0.4)] },
    { c: P(0, 2.1, 4.42), r: [U(0.5), U(0.45), U(0.25)] },
    { c: Pv(E), r: [U(0.19), U(0.18), U(0.19)], sub: true, k: 2 },
    { c: P(-E[0], E[1], E[2]), r: [U(0.19), U(0.18), U(0.19)], sub: true, k: 2 },
  ];
  const mouthY = (Z: number) => 2.0 + Math.max(0, 5.2 - Z) * 0.22;
  blob(mass, prims, (x, y, z) => {
    const Y = M(y), Z = M(z);
    if (Z > 5.42 && Y < 2.24 && Y > 1.78) return Math.abs(Y - mouthY(Z)) < 0.05 ? HORN.edge : Y > mouthY(Z) ? HORN.base : HORN.hi;
    if (Z > 4.6 && Math.abs(Y - mouthY(Z)) < 0.045) return HORN.edge;
    if (Y < 1.95 && Z < 5.0) return mixc(skin(x, y, z, 1.6, 2), SKIN.belly, 0.4);
    return skin(x, y, z, Y > 2.3 ? 3.0 : 1.7, 5);
  }, { k: U(0.25), disp: (x, y, z) => (n01(x, y, z, 0.3, 6) - 0.5) * 0.9 });
  cap(mass, P(0, 2.2, 5.55), P(0, 2.04, 5.66), U(0.13), U(0.05), HORN.base);
  for (const sx of [-1, 1]) mass.set(Math.floor(U(sx * 0.08)), Math.floor(U(2.25)), Math.floor(U(5.6)), 0x1a1612);
  const head = rig.part('head', 'neck', Pv(J.head));
  const jaw = rig.part('jaw', 'head', Pv(J.jaw));
  splitInto(mass, head, jaw, (x, y, z) => M(z) > 4.6 && M(y) < mouthY(M(z)) - 0.02);
  const fwd: V3 = [0.6, 0.06, 0.8];
  const eye = rig.part('eye_l', 'head', Pv(E));
  wetEye(eye, Pv(E), U(0.17), fwd, { iris: 0x8a5a1c, irisEdge: 0x3a220c, sclera: 0x1e160f, pupil: 0x070504, irisR: 0.82, pupilR: 0.45 });
  rig.mirror('eye_l', 'eye_r', 'head');
  const lid = rig.part('lid_l', 'head', Pv(E), [-1.15, 0, 0]);
  ell(lid, Pv(E), [U(0.22), U(0.22), U(0.22)], (x, y, z) => skin(x, y, z, 1.4, 8), {
    keep: (lx, ly, lz) => lx * lx + ly * ly + lz * lz > 0.6 && ly > -0.18 && lx * fwd[0] + ly * fwd[1] + lz * fwd[2] > -0.15,
  });
  rig.mirror('lid_l', 'lid_r', 'head');
  finish(head);
}

function buildNeck(rig: CRig) {
  const m = rig.part('neck', 'shell', Pv(J.neck));
  tube(m, [P(0, 1.25, 2.75), P(0, 1.55, 3.55), P(0, 1.88, 4.05), P(0, 2.05, 4.42)], [U(0.66), U(0.6), U(0.52), U(0.48)], (x, y, z) => {
    if (Math.floor((M(z) + M(y) * 0.6) / 0.11) % 4 === 0) return SKIN.groove;
    return M(y) < 1.45 + (M(z) - 2.7) * 0.4 ? mixc(skin(x, y, z, 1.8, 3), SKIN.belly, 0.4) : skin(x, y, z, 2.2, 3);
  });
  ell(m, P(0, 1.3, 3.2), [U(0.82), U(0.3), U(0.5)], (x, y, z) => (Math.floor(M(z) / 0.1) % 2 ? SKIN.shade : SKIN.groove), { under: true });
}

function buildLeg(rig: CRig, name: string, S: V3, K: V3, F: V3, claws: number) {
  const up = rig.part('leg_' + name, 'shell', Pv(S));
  blob(up, [{ a: Pv(S), b: Pv(K), r0: U(0.6), r1: U(0.5) }, { c: Pv(K), r: [U(0.5), U(0.45), U(0.5)] }], (x, y, z) => skin(x, y, z, M(z) > (S[2] + K[2]) / 2 + 0.08 ? 3.0 : 2.0, name.length * 3), { k: U(0.2), disp: (x, y, z) => (n01(x, y, z, 0.3, 2) - 0.5) * 0.9 });
  const ft = rig.part('foot_' + name, 'leg_' + name, Pv(K));
  // a broad paddle foot: half turtle flipper, half elephant pad
  const pad: V3 = [F[0] + 0.1, 0.16, F[2] + Math.sign(F[2]) * 0.12];
  blob(ft, [{ a: Pv(K), b: Pv(F), r0: U(0.5), r1: U(0.52) }, { c: Pv(pad), r: [U(0.66), U(0.17), U(0.72)] }], (x, y, z) => {
    if (M(y) < 0.07) return SKIN.dark;
    if (M(y) > 0.3 && M(y) < 0.9 && Math.floor(M(y) / 0.08) % 3 === 0) return SKIN.groove;
    return skin(x, y, z, 2.0, 7);
  }, { k: U(0.16), keep: (_x, y) => y >= 0, disp: (x, y, z) => (n01(x, y, z, 0.3, 3) - 0.5) * 0.8 });
  const fwd = Math.sign(F[2]);
  for (let k = 0; k < claws; k++) {
    const a = (k - (claws - 1) / 2) * 0.34;
    const base: V3 = [pad[0] + Math.sin(a) * 0.55, 0.1, pad[2] + fwd * Math.cos(a) * 0.62];
    cap(ft, Pv(base), P(base[0] + Math.sin(a) * 0.14, 0.04, base[2] + fwd * Math.cos(a) * 0.17), U(0.09), U(0.035), (x, y) => (M(y) > 0.09 ? HORN.claw : HORN.clawD));
  }
}

function buildTail(rig: CRig) {
  const m = rig.part('tail', 'shell', Pv(J.tail));
  cap(m, P(0, 1.28, -3.66), P(0, 0.86, -4.48), U(0.32), U(0.08), (x, y, z) => skin(x, y, z, 1.8, 4));
  cap(m, P(0, 0.88, -4.42), P(0, 0.78, -4.62), U(0.08), U(0.03), HORN.base);
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
  const rig = new CRig('turtle_house', VS);
  const shell = rig.part('shell', undefined, Pv(J.shell));
  buildBody(shell);
  buildHouse(shell);
  hollow(shell, 2);
  buildNeck(rig);
  buildHead(rig);
  buildLeg(rig, 'fl', J.legF, J.kneeF, J.footF, 4);
  buildLeg(rig, 'bl', J.legB, J.kneeB, J.footB, 4);
  rig.mirror('leg_fl', 'leg_fr', 'shell');
  rig.mirror('foot_fl', 'foot_fr', 'leg_fr');
  rig.mirror('leg_bl', 'leg_br', 'shell');
  rig.mirror('foot_bl', 'foot_br', 'leg_br');
  buildTail(rig);
  buildTree(rig);
  buildDoor(rig);
  buildShutter(rig, 'shut_fa', [-1.25, 3.9, H.z1 + 2 * VS], [1, 0, 0], 0.4, 0.7, -1.75);
  buildShutter(rig, 'shut_fb', [-0.45, 3.9, H.z1 + 2 * VS], [-1, 0, 0], 0.4, 0.7, 1.75);
  buildShutter(rig, 'shut_sa', [H.x0 - 2 * VS, 3.9, -0.6], [0, 0, 1], 0.4, 0.7, -1.75);
  buildShutter(rig, 'shut_sb', [H.x0 - 2 * VS, 3.9, 0.2 - VS], [0, 0, -1], 0.4, 0.7, 1.75);
  buildRamp(rig);
  buildLantern(rig, 'lantern_a', [H.porchX + 0.02, 4.55, -0.6]);
  buildLantern(rig, 'lantern_b', [H.porchX + 0.02, 4.55, 0.8]);
  buildChime(rig, [H.porchX + 0.05, 4.52, -1.25]);
  buildPots(rig, [2.0, 4.72, 1.05]);
  rig.socket('porch', 'shell', Pv(J.porch), [0, Math.PI / 2, 0]);
  rig.socket('counter', 'shell', Pv(J.counter), [0, Math.PI / 2, 0]);
  rig.socket('head_top', 'head', P(0, 2.7, 4.8));
  let top = 0;
  for (const p of rig.parts) p.model.forEach((_x, y) => (top = Math.max(top, y + 1)));
  const v = (x: number, y: number, z: number): V3 => [x, y, z];
  cached = rig.build({
    turtleHouse: true,
    height: top * VS,
    radius: 3.4,
    front: 5.66,
    retract: {
      neck: v(0, -0.3, -1.6),
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
