// Ozymandias, the tortoise-man who keeps the trading post on Gobi's back: an old,
// gnarled, monstrous desert tortoise who walks upright, sculpted at 1/56 m.
//
// A craggy, deeply wrinkled head (scaled hide, warts and tubercles, a heavy brow
// ridge, a hooked, chipped keratin beak) with wet amber eyes under heavy modelled
// lids, a weathered turban with a brass amulet and a long pipe in the corner of his
// mouth. A scarred, pyramided carapace (deep
// sand-packed seams, claw gouges, a chipped rim, a broken arrowhead), a patched
// sleeveless merchant's coat with brass buttons, a sash and a ring of keys; a
// bedroll and bundles strapped on the shell; bone charms and bells along the rim;
// a satchel, a drawstring bag, a gourd flask and a brass lantern that swing; a
// necklace of fangs and amulets; scaly forearms armoured with horn scales, clawed
// hands with gold rings; elephantine legs; a gnarled staff hung with charms.
//
// RIG: the same parts, joints, sockets and meta as Old Mother Tamsin's
// (characters/tortoise.ts), so the shop's tortoise puppet drives him unchanged:
//   shell (root) → neck → head → jaw, eye_l/eye_r, brow_l/brow_r (lids), coins, scarf_tails
//   shell → arm_l → fore_l, arm_r → fore_r → cane → bells; shell → leg_l/leg_r, tail,
//   chain, beads, pouch_1/2/3, lantern. Lid expressions swap brow_l/brow_r geometry.
import { CRig, VoxelModel, VF, V3, RigSpec, Prim, ell, cap, tube, line, wetEye, mixc, n01, h01, add3, sub3, scl3, dot3, norm3, sstep, exposed } from './ckit';
import { fblob, plate, castIn, normalAt, splitMany, groove, surfaceCells, type Pal } from './mkit';
import { defaultExpressions } from '../toon/humanoid';
import type { ExpressionSpec } from '../../../engine/voxel/Rig';

const VS = 1 / 56;
const U = (m: number) => m / VS;
const P = (x: number, y: number, z: number): V3 => [x / VS, y / VS, z / VS];
const Pv = (v: V3) => P(v[0], v[1], v[2]);
const M = (i: number) => (i + 0.5) * VS;
const mir = (v: V3): V3 => [-v[0], v[1], v[2]];

// ------------------------------------------------------------------ palette
const SK = { base: 0x8c8264, shade: 0x7a7055, hi: 0xa29878, dark: 0x5e553f, groove: 0x4e4634, belly: 0xbcae88, warm: 0x96825c, wart: 0xb0a47e, inner: 0x3a3226 };
const KER = { dark: 0x3a3228, base: 0x584c3a, mid: 0x7a6a50, worn: 0xb4a27c, edge: 0xdccfa8 };
const SCU = { a: 0x7e5e36, b: 0x94713f, c: 0x5e4628, bleach: 0xcdb68a, bone: 0xe2d4ae, seam: 0x2e2216, sand: 0xb39662, scar: 0xd4c098 };
const HSC: Pal = { top: 0xc4b48e, mid: 0x9a8a68, base: 0x5a4e3c, rim: 0x7e6e54, ring: 0x8a7a5e, crack: 0x3a3028, sand: 0x5a4e3c };
const COAT = { base: 0x3e3a5e, shade: 0x2e2b48, hi: 0x55507a, trim: 0xc89a3a, patchA: 0x7a4a2e, patchB: 0x5a6a3a, stitch: 0xd8c08a };
const SASH = { base: 0x8e2a22, shade: 0x6a1e18, hi: 0xb04030 };
const TURB = { base: 0xd8c8a2, shade: 0xb2a07a, band: 0x9a3a26, bandD: 0x6e2a1c };
const BRASS = { base: 0xc89a3a, hi: 0xf0cc6a, dark: 0x7a5a20 };
const LEATHER = { base: 0x7e5230, shade: 0x5e3c22, hi: 0x9e6a40, stitch: 0xe0c89a };
const WOOD = { base: 0x6e4c2c, shade: 0x4e341c, hi: 0x8c6640, knot: 0x34220f };
const BONE = { base: 0xe4d8bc, shade: 0xbcae8c };
const GLASS = 0x9cc4c8;

// ------------------------------------------------------------------ joints (metres; Tamsin's layout)
const J = {
  shell: [0, 0.361, -0.083] as V3,
  neck: [0, 0.986, -0.042] as V3,
  head: [0, 1.222, 0.097] as V3,
  jaw: [0, 1.283, 0.097] as V3,
  tails: [0, 1.42, -0.04] as V3,
  coins: [0.17, 1.45, 0.14] as V3,
  chain: [0, 1.078, 0.069] as V3,
  shoulder: [0.278, 0.917, 0] as V3,
  elbow: [0.347, 0.75, 0.069] as V3,
  hand: [0.361, 0.569, 0.167] as V3,
  hip: [0.139, 0.389, -0.028] as V3,
  tail: [0, 0.389, -0.333] as V3,
  pouch1: [0.356, 0.736, -0.25] as V3,
  pouch2: [0.194, 0.569, -0.43] as V3,
  pouch3: [-0.236, 0.722, -0.417] as V3,
  lantern: [-0.375, 0.903, -0.222] as V3,
  beads: [0, 1.042, 0.097] as V3,
  bells: [-0.461, 0.82, 0.18] as V3,
};
const EYE: V3 = [0.112, 1.375, 0.32];
const EYE_FWD: V3 = norm3([0.78, 0.05, 0.62]);
const EYE_R = 0.04;
const mouthY = (z: number) => 1.262 + Math.max(0, 0.36 - z) * 0.1 - sstep(0.44, 0.53, z) * 0.05;

/** cellular scales (metres) */
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
/** leathery scaled hide: one-cell grooves between scales, three calm tones, warts, a paler throat */
function hide(X: number, Y: number, Z: number, under = 0, s0 = 0.045, seed = 3) {
  const s = s0 * 1.45;
  const [a, b, id] = vor(X, Y, Z, s, seed);
  if ((b - a) * s < VS * 0.95) return mixc(mixc(SK.groove, SK.shade, 0.35), SK.belly, under * 0.4);
  const k = ((id >>> 3) & 15) / 15;
  let c = k < 0.2 ? SK.shade : k > 0.9 ? SK.hi : SK.base;
  if (k > 0.96 && a < 0.25) c = SK.wart; // an old wart
  const m = n01(X, Y, Z, 4, seed + 4);
  if (m > 0.68) c = mixc(c, SK.warm, 0.3);
  else if (m < 0.3) c = mixc(c, SK.dark, 0.2);
  if (under > 0) c = mixc(c, SK.belly, Math.min(1, under) * 0.55);
  return c;
}
const spikePlate = (m: VoxelModel, hit: V3 | null, fwd: V3, a: number, h: number, spike: number, seed: number, pal: Pal = HSC) => {
  if (!hit) return;
  plate(m, [hit[0] + 0.5, hit[1] + 0.5, hit[2] + 0.5], normalAt(m, hit, 2), fwd, { a: U(a), b: U(a), h: U(h), keel: 0.3, tilt: 0.25, sink: 1.5, seed, sq: 2.2, spike: U(spike), spikeLean: 0.7, clean: true }, pal);
};
const mirrorModel = (src: VoxelModel, name: string) => {
  const o = new VoxelModel(name);
  src.forEach((x, y, z, c, f) => o.set(-1 - x, y, z, c, f));
  return o;
};

// ================================================================== SHELL (root): body, carapace, coat, packs
const CAR_C: V3 = [0, 0.8, -0.17], CAR_R: V3 = [0.37, 0.46, 0.32];
const SEEDS: { d: V3; h: number; kind: number }[] = (() => {
  const out: { d: V3; h: number; kind: number }[] = [];
  for (const y of [0.62, 0.22, -0.2, -0.58]) out.push({ d: norm3([0, y, -Math.sqrt(1 - y * y)]), h: 0.055, kind: 0 });
  for (const s of [1, -1]) for (const y of [0.45, 0, -0.45]) out.push({ d: norm3([s * 0.66, y, -0.72]), h: 0.045, kind: 1 });
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    out.push({ d: norm3([Math.sin(a), Math.cos(a), -0.32]), h: 0.028, kind: 2 });
  }
  return out;
})();
function buildShell(m: VoxelModel) {
  // flesh core and the plastron
  fblob(m, [{ c: P(0, 0.72, -0.08), r: [U(0.24), U(0.32), U(0.17)] }], (x, y, z) => hide(M(x), M(y), M(z), 0.4), { k: 2, inner: SK.inner });
  ell(m, P(0, 0.7, 0.075), [U(0.25), U(0.33), U(0.1)], (x, y) => ((M(y) - 0.4) % 0.11 < VS || x === 0 || x === -1 ? 0x6e5a36 : 0xb8a070), { keep: (_lx, _ly, lz) => lz > -0.2 });
  // the carapace: pyramided scutes in growth terraces, deep sand-packed seams
  const lo = P(-0.5, 0.25, -0.62), hi = P(0.5, 1.35, 0.05);
  for (let i = Math.floor(lo[0]); i <= hi[0]; i++)
    for (let j = Math.floor(lo[1]); j <= hi[1]; j++)
      for (let k = Math.floor(lo[2]); k <= hi[2]; k++) {
        const X = M(i), Y = M(j), Z = M(k);
        const nx = (X - CAR_C[0]) / CAR_R[0], ny = (Y - CAR_C[1]) / CAR_R[1], nz = (Z - CAR_C[2]) / CAR_R[2];
        const rho = Math.sqrt(nx * nx + ny * ny + nz * nz);
        if (rho < 0.8 || rho > 1.25) continue;
        const dx = nx / rho, dy = ny / rho, dz = nz / rho;
        if (dz > -0.08 + Math.sin(dy * 5) * 0.02) continue; // the open front
        const R = Math.sqrt((dx * CAR_R[0]) ** 2 + (dy * CAR_R[1]) ** 2 + (dz * CAR_R[2]) ** 2);
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
        const cen = Math.min(1, (b1 - b2) / [0.2, 0.16, 0.1][sd.kind]);
        const rings = 2;
        const ring = Math.floor(cen * rings);
        // gnarled: knobbly areolas
        const knob = cen > 0.8 ? (n01(X, Y, Z, 30, 7) - 0.5) * 0.02 : 0;
        const rel = cen < 0.1 ? -0.012 : sd.h * (0.2 + 0.8 * Math.min(1, (ring + sstep(0.7, 1, cen * rings - ring)) / rings)) + knob;
        // marginals flare at the rim, chipped in places
        const rimFlare = sd.kind === 2 ? 0.02 : 0;
        const surf = 1 + (rel + rimFlare) / R;
        if (rho > surf || rho < surf - 0.05 / R) continue;
        if (sd.kind === 2 && h01(Math.floor(Math.atan2(dx, dy) * 9), 3, 1) > 0.8 && rho > surf - 0.015 / R && cen > 0.5) continue; // a chipped marginal
        const top = rho > surf - 1.3 * (VS / R);
        let c: number;
        if (!top) c = SCU.c;
        else if (cen < 0.12) c = h01(i >> 1, j >> 1, k >> 1, 5) < 0.55 ? SCU.sand : SCU.seam;
        else if (cen > 0.84) c = sd.kind === 2 ? SCU.bleach : SCU.bone;
        else {
          c = ring & 1 ? SCU.b : SCU.a;
          if (cen * rings - ring < 0.08) c = mixc(c, SCU.seam, 0.35);
          if (dy > 0.5) c = mixc(c, SCU.bleach, sstep(0.5, 0.9, dy) * 0.4);
        }
        m.set(i, j, k, c);
      }
  // old wounds: three claw gouges raked across the left costals, an arrowhead broken off in the right
  const surfC = surfaceCells(m);
  for (let g = 0; g < 3; g++) {
    groove(m, (x, y, z) => {
      const X = M(x), Y = M(y), Z = M(z);
      if (X < 0.14 || X > 0.34 || Y < 0.82 || Y > 1.12 || Z > -0.15) return 99;
      return (Y - (1.02 - g * 0.05) + (X - 0.2) * 0.9) / VS;
    }, { depth: 2, width: 0.6, rim: 0.7, floor: () => SCU.seam, front: () => SCU.scar, cand: surfC });
  }
  {
    const hit = castIn(m, P(-0.5, 0.95, -0.3), norm3([1, 0, 0.3]));
    if (hit) {
      const nrm = normalAt(m, hit, 3);
      const a: V3 = [hit[0] + 0.5, hit[1] + 0.5, hit[2] + 0.5];
      const d = norm3(add3(nrm, [0.2, 0.4, -0.2]));
      cap(m, sub3(a, scl3(d, 1)), add3(a, scl3(d, U(0.09))), 1.3, 1.0, (_x, y) => ((y & 1) ? 0x7a5a34 : 0x5e4426));
      cap(m, a, add3(a, scl3(d, -3)), 1.6, 0.6, 0x5a4a40, { fl: VF.METAL });
    }
  }
  // the sleeveless merchant's coat over the front and sides, open down the middle; brass buttons, patches, gold hem
  const coatOuter: Prim[] = [{ c: P(0, 0.72, -0.08), r: [U(0.27), U(0.35), U(0.2)] }, { c: P(0, 0.7, 0.075), r: [U(0.275), U(0.355), U(0.125)] }];
  fblob(m, coatOuter, (x, y, z) => {
    if (m.has(x, y, z)) return null;
    const X = M(x), Y = M(y), Z = M(z);
    if (Y < 0.47) return COAT.trim;
    if (Math.abs(Math.abs(X) - 0.08) < VS * 1.2 && Z > 0.1) return COAT.trim; // lapel edge
    if (Math.abs(X - 0.17) < 0.045 && Math.abs(Y - 0.62) < 0.04 && Z > 0.05) return Math.abs(X - 0.17) > 0.035 || Math.abs(Y - 0.62) > 0.03 ? COAT.stitch : COAT.patchA;
    if (Math.abs(X + 0.2) < 0.035 && Math.abs(Y - 0.82) < 0.03 && Z > 0) return COAT.patchB;
    const fold = Math.sin(Math.atan2(X, Z) * 9 + Y * 4);
    return fold > 0.75 ? COAT.shade : fold < -0.85 ? COAT.hi : COAT.base;
  }, { k: 2, keep: (x, y, z) => M(y) > 0.42 && M(y) < 0.98 && M(z) > -0.13 && !(Math.abs(M(x)) < 0.075 && M(z) > 0.12) });
  for (const s of [1, -1]) for (const y of [0.88, 0.8, 0.72, 0.64]) {
    const hit = castIn(m, P(s * 0.095, y, 0.4), [0, 0, -1]);
    if (hit) ell(m, [hit[0] + 0.5, hit[1] + 0.5, hit[2] + 1], [1.3, 1.3, 1], (xx, yy) => (yy > hit[1] ? BRASS.hi : BRASS.base), { fl: VF.METAL });
  }
  // a high, rolled collar round the base of the neck
  for (let a = 0; a < 40; a++) {
    const t = (a / 40) * Math.PI * 2;
    if (Math.cos(t) > 0.85) continue; // open at the throat
    const c = P(Math.sin(t) * 0.14, 0.97 + Math.cos(t) * 0.01, -0.03 + Math.cos(t) * 0.12);
    ell(m, c, [U(0.03), U(0.035), U(0.03)], (x, y) => (M(y) > 0.99 ? COAT.hi : COAT.base), { under: true });
  }
  // the sash and its buckle, a ring of old keys at the hip
  ell(m, P(0, 0.56, -0.02), [U(0.29), U(0.035), U(0.25)], (x, y, z) => ((x + y + z) % 4 === 0 ? SASH.shade : y % 2 ? SASH.base : SASH.hi), { keep: (lx, ly, lz) => lx * lx + lz * lz > 0.75 && lz > -0.6 });
  ell(m, P(0, 0.56, 0.205), [U(0.045), U(0.04), U(0.015)], (x, y) => ((x + y) % 3 === 0 ? BRASS.dark : BRASS.base), { fl: VF.METAL });
  ell(m, P(-0.27, 0.5, 0.06), [U(0.02), U(0.02), U(0.006)], BRASS.dark, { fl: VF.METAL });
  for (let k = 0; k < 4; k++) cap(m, P(-0.275 + k * 0.004, 0.48, 0.06 + k * 0.012), P(-0.28 + k * 0.006, 0.4 - k * 0.012, 0.07 + k * 0.014), 0.7, 0.6, k & 1 ? BRASS.dark : 0x6a6a70, { fl: VF.METAL });
  // a bedroll and bundles strapped across the top of the shell
  cap(m, P(-0.27, 1.2, -0.28), P(0.27, 1.2, -0.28), U(0.075), U(0.07), (x) => (Math.floor(M(x) / 0.06) & 1 ? 0x8e2a20 : Math.floor(M(x) / 0.03) % 3 === 0 ? 0xd9a53a : 0x2f4a7a));
  for (const x of [-0.17, 0.17]) ell(m, P(x, 1.2, -0.28), [U(0.012), U(0.085), U(0.085)], LEATHER.shade, { keep: (_lx, _ly, _lz) => true, under: false });
  ell(m, P(0.12, 1.25, -0.42), [U(0.1), U(0.07), U(0.08)], (x, y, z) => (h01(x >> 1, y >> 1, z >> 1, 3) > 0.7 ? 0xb8a478 : 0xa08e64));
  // bone charms, brass bells and a little skull dangling off the rim
  const charms: [V3, number][] = [[[0.3, 0.6, -0.22], 0], [[0.33, 0.78, -0.3], 1], [[-0.3, 0.6, -0.26], 2], [[-0.12, 0.45, -0.45], 1], [[0.14, 0.42, -0.42], 0], [[0.36, 0.95, -0.36], 2]];
  for (const [p, kind] of charms) {
    const top = add3(p, [0, 0.05, 0]);
    line(m, [Pv(top), Pv(p)], 0xc9a86a);
    if (kind === 0) cap(m, Pv(add3(p, [0, -0.005, 0])), Pv(add3(p, [0.006, -0.05, 0.004])), U(0.012), U(0.006), (x, y) => (M(y) < p[1] - 0.035 ? BONE.shade : BONE.base)); // a fang
    else if (kind === 1) ell(m, Pv(add3(p, [0, -0.018, 0])), [U(0.017), U(0.019), U(0.017)], (x, y) => (M(y) < p[1] - 0.026 ? BRASS.dark : BRASS.base), { fl: VF.METAL }); // a bell
    else {
      ell(m, Pv(add3(p, [0, -0.025, 0])), [U(0.022), U(0.02), U(0.02)], BONE.base); // a small skull
      for (const s of [1, -1]) m.set(Math.floor(U(p[0] + s * 0.008)), Math.floor(U(p[1] - 0.025)), Math.floor(U(p[2] + (p[2] < 0 ? -0.018 : 0.018))), 0x2a2018);
    }
  }
}

// ================================================================== NECK
function buildNeck(m: VoxelModel) {
  const A: V3 = [0, 0.94, -0.07], B: V3 = [0, 1.085, 0.0], C: V3 = [0, 1.215, 0.09];
  fblob(m, [
    { a: Pv(A), b: Pv(B), r0: U(0.112), r1: U(0.1) },
    { a: Pv(B), b: Pv(C), r0: U(0.1), r1: U(0.094) },
    { c: P(0, 1.06, 0.05), r: [U(0.07), U(0.07), U(0.055)] }, // a saggy dewlap
    { c: P(0, 0.985, -0.03), r: [U(0.13), U(0.04), U(0.115)] }, // loose skin where it leaves the shell
  ], (x, y, z) => hide(M(x), M(y), M(z), sstep(0.02, 0.07, M(z) - (M(y) - 1.0) * 0.6), 0.04, 9), { k: U(0.03), inner: SK.inner });
  // deep wrinkles: rings round the neck and bunched folds on the throat
  const surf = surfaceCells(m);
  const ax = norm3(sub3(C, A));
  for (let r = 1; r <= 6; r++) {
    const s0 = r * 0.04;
    groove(m, (x, y, z) => (dot3(sub3([M(x), M(y), M(z)], A), ax) - s0 - Math.sin(M(x) * 60 + r) * 0.006) / VS, { depth: 1, width: 0.55, rim: 1, floor: (c) => mixc(c, SK.groove, 0.7), front: (c) => mixc(c, SK.hi, 0.25), lip: 1.4, lipCol: (c) => mixc(c, SK.hi, 0.2), cand: surf });
  }
  // a crest of tubercles down the back of the neck
  for (let i = 0; i < 4; i++) {
    const p = add3(A, scl3(sub3(C, A), 0.25 + i * 0.2));
    spikePlate(m, castIn(m, P(0, p[1] + 0.2, p[2] - 0.15), norm3([0, -0.8, 0.6])), [0, 1, 0], 0.025, 0.012, 0.03 - i * 0.004, 60 + i);
  }
}

// ================================================================== HEAD, JAW, EYES, LIDS, TURBAN
interface Face {
  head: VoxelModel;
  jaw: VoxelModel;
  eye: VoxelModel;
  lids: { neutral: VoxelModel; squint: VoxelModel; closed: VoxelModel };
  coins: VoxelModel;
  tails: VoxelModel;
  lidAt: V3;
}
function buildFace(): Face {
  const mass = new VoxelModel('ozHead');
  fblob(mass, [
    { c: P(0, 1.36, 0.17), r: [U(0.16), U(0.14), U(0.19)] }, // cranium
    { c: P(0, 1.33, 0.36), r: [U(0.115), U(0.1), U(0.13)] }, // snout
    { a: P(0, 1.375, 0.43), b: P(0, 1.27, 0.535), r0: U(0.06), r1: U(0.016) }, // the hooked upper beak
    { c: P(0.12, 1.28, 0.17), r: [U(0.075), U(0.09), U(0.11)] }, // jaw muscles
    { c: P(-0.12, 1.28, 0.17), r: [U(0.075), U(0.09), U(0.11)] },
    { c: P(0.095, 1.445, 0.3), r: [U(0.075), U(0.042), U(0.085)] }, // the heavy brow ridges
    { c: P(-0.095, 1.445, 0.3), r: [U(0.075), U(0.042), U(0.085)] },
    { c: P(0.14, 1.41, 0.12), r: [U(0.05), U(0.05), U(0.06)] }, // temporal knobs
    { c: P(-0.14, 1.41, 0.12), r: [U(0.05), U(0.05), U(0.06)] },
    { a: P(0, 1.225, 0.1), b: P(0, 1.235, 0.44), r0: U(0.11), r1: U(0.058) }, // lower jaw
    { c: P(0, 1.25, 0.47), r: [U(0.045), U(0.035), U(0.04)] }, // chin, curling up to the hook
    { c: P(0, 1.19, 0.16), r: [U(0.11), U(0.075), U(0.13)] }, // throat
    { a: P(0, 1.2, 0.02), b: P(0, 1.23, 0.1), r0: U(0.1), r1: U(0.1) }, // neck join
    { c: Pv(EYE), r: [U(0.05), U(0.05), U(0.05)], sub: true, k: 1.2 },
    { c: Pv(mir(EYE)), r: [U(0.05), U(0.05), U(0.05)], sub: true, k: 1.2 },
  ], (x, y, z) => {
    const X = M(x), Y = M(y), Z = M(z);
    const my = mouthY(Z);
    if (Z > 0.33 && Math.abs(Y - my) < 0.075) {
      // the beak: dark horn, the cutting edge worn pale and nicked
      const e = Math.abs(Y - my);
      if (e < 0.012) return Math.floor(Z / 0.016) % 3 === 0 ? KER.dark : KER.edge;
      if (e < 0.025) return KER.worn;
      return Z > 0.46 ? KER.mid : Math.floor(Z / 0.03) & 1 ? KER.base : KER.dark;
    }
    if (Z > 0.12 && Math.abs(Y - my) < 0.009) return SK.groove;
    return hide(X, Y, Z, sstep(1.27, 1.2, Y), Y > 1.38 ? 0.05 : 0.038, 11);
  }, { k: U(0.035), inner: SK.inner, keep: (_x, _y, z) => M(z) > -0.02, disp: (x, y, z) => (n01(x, y, z, 0.25, 5) - 0.5) * 0.7 });
  // crow's-feet wrinkles fanning back from each eye, deep folds across the brow
  const surf = surfaceCells(mass);
  for (const s of [1, -1])
    for (let r = 0; r < 3; r++)
      groove(mass, (x, y, z) => {
        const X = M(x) * s, Y = M(y), Z = M(z);
        if (X < 0.08 || Z > EYE[2] - 0.02) return 99;
        return (Math.hypot(Y - EYE[1], Z - EYE[2]) - (0.065 + r * 0.025)) / VS;
      }, { depth: 1, width: 0.5, rim: 0.8, floor: (c) => mixc(c, SK.groove, 0.75), cand: surf });
  for (let r = 0; r < 2; r++)
    groove(mass, (x, y, z) => (M(z) > 0.33 || M(y) < 1.44 ? 99 : (M(y) - 1.47 - r * 0.03 - Math.sin(M(x) * 40) * 0.006) / VS), { depth: 1, width: 0.5, rim: 0.8, floor: (c) => mixc(c, SK.groove, 0.7), cand: surf });
  // horn shields on the crown, warts and tubercles on the cheeks and chin
  let seed = 200;
  for (const [at, out, a, h, sp] of [
    [[0, 1.5, 0.2], [0, 1, 0], 0.05, 0.016, 0],
    [[0.07, 1.48, 0.33], [0.3, 1, 0.3], 0.035, 0.014, 0],
    [[-0.07, 1.48, 0.33], [-0.3, 1, 0.3], 0.035, 0.014, 0],
    [[0.17, 1.4, 0.2], [1, 0.5, 0], 0.03, 0.012, 0.025],
    [[-0.17, 1.4, 0.2], [-1, 0.5, 0], 0.03, 0.012, 0.025],
    [[0.18, 1.3, 0.2], [1, 0, 0.2], 0.025, 0.01, 0.018],
    [[-0.18, 1.3, 0.22], [-1, 0, 0.2], 0.025, 0.01, 0.018],
    [[0.06, 1.15, 0.3], [0.3, -1, 0.2], 0.02, 0.01, 0.022],
    [[-0.05, 1.16, 0.34], [-0.3, -1, 0.2], 0.02, 0.01, 0.018],
    [[0, 1.14, 0.22], [0, -1, 0], 0.022, 0.01, 0.026],
  ] as [V3, V3, number, number, number][]) {
    const o = norm3(out);
    spikePlate(mass, castIn(mass, add3(Pv(at), scl3(o, U(0.15))), scl3(o, -1)), [0, 0, 1], a, h, sp, seed++);
  }
  // nostrils: two pits on the beak-top behind valve rims
  for (const s of [1, -1]) {
    const c = P(s * 0.03, 1.42, 0.445);
    ell(mass, c, [U(0.014), U(0.01), U(0.016)], KER.mid);
    cap(mass, add3(c, [0, 1, -0.5]), add3(c, [0, 1, 0.8]), 0.6, 0.6, 0, { carve: true });
    cap(mass, add3(c, [0, 0, -0.5]), add3(c, [0, 0, 0.8]), 0.6, 0.6, 0x14100c);
  }
  // the weathered turban: wrapped bands, a red binding, a brass amulet with a stone
  const T: V3 = [0, 1.47, 0.14];
  ell(mass, Pv(T), [U(0.17), U(0.1), U(0.18)], (x, y, z) => {
    const X = M(x), Y = M(y), Z = M(z);
    const a = Math.atan2(X, Z - T[2]);
    const wrap = (Y - T[1]) * 28 + a * 1.1;
    if (Math.abs(Y - T[1] + 0.035 - Math.sin(a) * 0.01) < VS * 1.1) return TURB.band;
    return (wrap - Math.floor(wrap)) < 0.22 ? TURB.shade : TURB.base;
  }, { under: true, keep: (_lx, ly) => ly > -0.55 });
  ell(mass, P(0.03, 1.55, 0.06), [U(0.09), U(0.05), U(0.08)], (x, y) => (M(y) > 1.57 ? TURB.base : TURB.shade), { under: true });
  ell(mass, P(0, 1.47, 0.32), [U(0.026), U(0.03), U(0.012)], (x, y) => (Math.abs(M(y) - 1.47) < 0.012 && Math.abs(M(x)) < 0.012 ? 0x2c7f74 : BRASS.base), { fl: VF.METAL });

  const head = new VoxelModel('head');
  const jaw = new VoxelModel('jaw');
  splitMany(mass, { head, jaw }, (x, y, z) => (M(z) > 0.09 && M(y) < mouthY(M(z)) ? 'jaw' : 'head'));
  // the mouth: a dark gap when it talks, a pale tongue
  jaw.forEach((x, y, z) => {
    if (jaw.has(x, y + 1, z) || M(z) < 0.16 || M(z) > 0.42 || Math.abs(M(x)) > 0.07) return;
    jaw.set(x, y, z, Math.abs(M(x)) < 0.03 ? 0xb06a62 : 0x5a2a24, VF.METAL);
  });
  // coarse white whiskers on the chin, a long clay-and-reed pipe in the left corner of the mouth (ember lit)
  for (let i = 0; i < 9; i++) {
    const x = (i - 4) * 0.014;
    const hit = castIn(jaw, P(x, 1.08, 0.36 + Math.abs(x) * -0.5), [0, 1, 0]);
    if (hit) line(jaw, [[hit[0] + 0.5, hit[1] + 0.5, hit[2] + 0.5], add3([hit[0] + 0.5, hit[1] - 2, hit[2] + 1], [i & 1 ? 0.5 : -0.5, -U(0.025 + (i % 3) * 0.008), 0])], i % 3 ? 0xe8e2d4 : 0xc8bea8);
  }
  tube(jaw, [P(0.09, 1.255, 0.33), P(0.16, 1.22, 0.43), P(0.21, 1.2, 0.5)], [1.0, 0.9, 0.9], (x, y) => (y & 1 ? 0x6e4a2c : 0x8a6038));
  ell(jaw, P(0.215, 1.225, 0.52), [U(0.026), U(0.032), U(0.026)], (x, y) => (M(y) > 1.245 ? 0xd8d0c0 : 0xb8ac94));
  jaw.set(Math.floor(U(0.215)), Math.floor(U(1.255)), Math.floor(U(0.52)), 0xff8a3a, VF.EMISSIVE | VF.GLOW);
  // the eye: wet, amber, slit-ish pupil
  const eye = new VoxelModel('eye_l');
  wetEye(eye, Pv(EYE), U(EYE_R), EYE_FWD, { iris: 0xe0a030, irisEdge: 0x6a3a0a, sclera: 0x2a2014, pupil: 0x060403, irisR: 0.92, pupilR: 0.36, bigGlint: 1, smallGlint: false });
  // a faint warm glow in the irises so they read from under the heavy brow
  eye.forEach((x, y, z, c) => {
    const r = (c >> 16) & 255, g = (c >> 8) & 255;
    if (r > 150 && r - g > 40) eye.set(x, y, z, c, VF.METAL | VF.EMISSIVE);
  });
  // heavy hooded lids: neutral (droopy), squint, closed
  const lidAt: V3 = add3(EYE, [0, 0.01, 0]);
  const lid = (cut: number) => {
    const m = new VoxelModel('brow_l');
    const ec = Pv(EYE);
    const r0 = U(EYE_R) + 0.3, r1 = U(EYE_R) + 1.6;
    const R = Math.ceil(r1) + 1;
    for (let x = Math.floor(ec[0] - R); x <= ec[0] + R; x++)
      for (let y = Math.floor(ec[1] - R); y <= ec[1] + R; y++)
        for (let z = Math.floor(ec[2] - R); z <= ec[2] + R; z++) {
          const d: V3 = [x + 0.5 - ec[0], y + 0.5 - ec[1], z + 0.5 - ec[2]];
          const l = Math.hypot(d[0], d[1], d[2]);
          if (l < r0 || l > r1 || head.has(x, y, z)) continue;
          const nn = scl3(d, 1 / l);
          if (nn[1] < cut || dot3(nn, EYE_FWD) < -0.25) continue;
          m.set(x, y, z, nn[1] < cut + 0.18 ? SK.dark : (y & 1) ? SK.shade : SK.base);
        }
    return m;
  };
  // coins: a fringe of old coins and a bone charm hanging from the turban's side
  const coins = new VoxelModel('coins');
  const cp = Pv(J.coins);
  for (let i = 0; i < 4; i++) {
    const dz = (i - 1.5) * 1.6;
    const len = 3 + (i % 2) * 2;
    line(coins, [[cp[0] + 0.5, cp[1], cp[2] + dz], [cp[0] + 1, cp[1] - len, cp[2] + dz]], 0x9a7a4a);
    ell(coins, [cp[0] + 1.2, cp[1] - len - 1, cp[2] + dz], [0.4, 1.2, 1.2], i === 2 ? BONE.base : BRASS.base, { fl: i === 2 ? undefined : VF.METAL });
  }
  // the turban's tail hanging down the back
  const tails = new VoxelModel('scarf_tails');
  tube(tails, [P(0.02, 1.43, -0.02), P(0.05, 1.33, -0.07), P(0.07, 1.21, -0.06)], [U(0.028), U(0.03), U(0.024)], (x, y) => (M(y) < 1.24 ? TURB.band : (y % 3 === 0 ? TURB.shade : TURB.base)));
  return { head, jaw, eye, lids: { neutral: lid(0.12), squint: lid(-0.35), closed: lid(-1.1) }, coins, tails, lidAt };
}

// ================================================================== LIMBS
function buildArm(m: VoxelModel) {
  fblob(m, [{ a: Pv(J.shoulder), b: Pv(J.elbow), r0: U(0.075), r1: U(0.06) }], (x, y, z) => hide(M(x), M(y), M(z), 0, 0.04, 31), { k: 2, inner: SK.inner });
  for (const [t, a] of [[0.35, 0.035], [0.7, 0.03]] as number[][]) {
    const p = add3(J.shoulder, scl3(sub3(J.elbow, J.shoulder), t));
    const hit = castIn(m, add3(Pv(p), P(0.15, 0, 0.05)), norm3([-1, 0, -0.3]));
    if (hit) plate(m, [hit[0] + 0.5, hit[1] + 0.5, hit[2] + 0.5], normalAt(m, hit, 2), [0, 1, 0], { a: U(a), b: U(a), h: U(0.012), keel: 0.3, tilt: 0.4, sink: 1.5, seed: 300 + t * 10, sq: 2.4, clean: true }, HSC);
  }
}
function buildForearm(m: VoxelModel, grip: boolean) {
  const H = J.hand;
  fblob(m, [{ a: Pv(J.elbow), b: Pv(add3(H, [0, 0.03, -0.02])), r0: U(0.06), r1: U(0.066) }], (x, y, z) => hide(M(x), M(y), M(z), 0, 0.035, 32), { k: 2, inner: SK.inner });
  // big overlapping horn scales down the front of the forearm (the tortoise's armour), a leather bracer
  for (const t of [0.2, 0.45, 0.7]) {
    const p = add3(J.elbow, scl3(sub3(H, J.elbow), t));
    const hit = castIn(m, add3(Pv(p), P(0.02, 0, 0.15)), norm3([-0.1, 0, -1]));
    if (hit) plate(m, [hit[0] + 0.5, hit[1] + 0.5, hit[2] + 0.5], normalAt(m, hit, 2), [0, -1, 0], { a: U(0.032), b: U(0.04), h: U(0.014), keel: 0.3, tilt: 0.45, sink: 1.5, seed: 310 + t * 10, sq: 2.4, clean: true }, HSC);
  }
  const bc = add3(J.elbow, scl3(sub3(H, J.elbow), 0.86));
  ell(m, Pv(bc), [U(0.072), U(0.03), U(0.072)], (x, y) => (Math.abs(M(y) - bc[1]) < 0.012 ? LEATHER.hi : LEATHER.base), { keep: (lx, ly, lz) => lx * lx + lz * lz > 0.7 });
  // the hand: a broad leathery palm, four thick fingers ending in horn claws, gold rings
  ell(m, Pv(add3(H, [0.005, -0.015, 0.01])), [U(0.055), U(0.05), U(0.055)], (x, y, z) => hide(M(x), M(y), M(z), 0.3, 0.03, 33));
  for (let f = 0; f < 4; f++) {
    const a = (f - 1.5) * 0.42;
    const d: V3 = norm3([Math.sin(a) * 0.8, grip ? -0.2 : -0.9, Math.cos(a) * (grip ? 1 : 0.5)]);
    const root = add3(H, [Math.sin(a) * 0.035, -0.04, 0.03 + Math.cos(a) * 0.015]);
    const mid = add3(root, scl3(d, 0.04));
    const tip = grip ? add3(mid, [Math.sin(a) * 0.01, -0.035, -0.02]) : add3(mid, scl3(norm3(add3(d, [0, -0.6, 0.4])), 0.03));
    cap(m, Pv(root), Pv(mid), U(0.019), U(0.016), (x, y, z) => hide(M(x), M(y), M(z), 0.2, 0.025, 34));
    cap(m, Pv(mid), Pv(tip), U(0.015), U(0.005), (x, y, z) => (M(y) < tip[1] + 0.008 ? KER.worn : KER.base));
    if (f === 1 || f === 3) {
      const rc = add3(root, scl3(d, 0.022));
      ell(m, Pv(rc), [U(0.024), U(0.024), U(0.024)], (x, y, z) => (f === 1 && M(y) > rc[1] + 0.01 ? 0xb03a2a : BRASS.base), { fl: VF.METAL, keep: (lx, ly, lz) => Math.abs(dot3([lx, ly, lz], d)) < 0.4 });
    }
  }
}
function buildLeg(m: VoxelModel) {
  const H = J.hip, A: V3 = [0.152, 0.1, 0.0], F: V3 = [0.156, 0.045, 0.03];
  fblob(m, [{ a: Pv(H), b: Pv(A), r0: U(0.085), r1: U(0.096) }, { c: Pv(F), r: [U(0.1), U(0.045), U(0.105)] }], (x, y, z) => (M(y) < 0.012 ? SK.dark : hide(M(x), M(y), M(z), 0, 0.045, 51)), { k: U(0.04), inner: SK.inner, keep: (_x, y) => y >= 0 });
  for (const [y, a] of [[0.16, 0.04], [0.25, 0.035]] as number[][]) {
    const hit = castIn(m, P(H[0], y, 0.3), [0, 0, -1]);
    if (hit) plate(m, [hit[0] + 0.5, hit[1] + 0.5, hit[2] + 0.5], normalAt(m, hit, 2), [0, -1, 0], { a: U(a), b: U(a * 1.2), h: U(0.016), keel: 0.3, tilt: 0.4, sink: 1.5, seed: 400 + y * 10, sq: 2.4, clean: true }, HSC);
  }
  for (let k = 0; k < 4; k++) {
    const a = (k - 1.5) * 0.45;
    const r: V3 = [F[0] + Math.sin(a) * 0.075, 0.025, F[2] + Math.cos(a) * 0.085];
    cap(m, Pv(r), Pv([r[0] + Math.sin(a) * 0.035, 0.008, r[2] + Math.cos(a) * 0.04]), U(0.02), U(0.007), (x, y) => (M(y) < 0.016 ? KER.worn : KER.base), { keep: (_t, _a, _b, _x, y) => y >= 0 });
  }
}
function buildTail(m: VoxelModel) {
  tube(m, [Pv(J.tail), P(0, 0.34, -0.41), P(0, 0.29, -0.46)], [U(0.045), U(0.03), U(0.012)], (x, y, z) => hide(M(x), M(y), M(z), 0, 0.03, 61));
  for (const [z, l] of [[-0.36, 0.022], [-0.41, 0.016]] as number[][]) spikePlate(m, castIn(m, P(0, 0.5, z), [0, -1, 0]), [0, 0, -1], 0.014, 0.008, l, 70 + z * 100);
}
function buildCane(m: VoxelModel) {
  // a gnarled desert-ironwood staff, a crook at the top, leather wrap at the grip, a brass ferrule
  const top: V3 = [-0.375, 0.84, 0.18];
  tube(m, [P(-0.386, 0.017, 0.211), P(-0.37, 0.3, 0.19), P(-0.38, 0.6, 0.18), Pv(top)], [1.6, 1.4, 1.5, 1.5], (x, y, z) => {
    const Y = M(y);
    if (Y < 0.04) return BRASS.dark;
    if (Math.abs(Y - 0.57) < 0.05) return (y & 1) ? LEATHER.base : LEATHER.shade;
    return n01(x, y * 0.3, z, 0.5, 2) > 0.66 ? WOOD.knot : (y % 4 === 0 ? WOOD.shade : WOOD.base);
  });
  tube(m, [Pv(top), P(-0.4, 0.885, 0.18), P(-0.445, 0.885, 0.18), P(-0.461, 0.84, 0.18)], [1.5, 1.4, 1.3, 1.2], (x, y) => (y % 3 ? WOOD.hi : WOOD.base));
  for (const y of [0.25, 0.45, 0.72]) ell(m, P(-0.378, y, 0.19), [1.9, 1.3, 1.9], WOOD.knot);
}
function buildBells(m: VoxelModel) {
  const b = J.bells;
  for (const [dx, len, kind] of [[-0.006, 0.05, 0], [0.008, 0.075, 1], [0.0, 0.035, 2]] as number[][]) {
    const top: V3 = [b[0] + dx, b[1] + 0.012, b[2]];
    const end: V3 = [b[0] + dx, b[1] - len, b[2]];
    line(m, [Pv(top), Pv(end)], 0xc9a86a);
    if (kind === 0) ell(m, Pv(add3(end, [0, -0.012, 0])), [U(0.014), U(0.016), U(0.014)], (x, y) => (M(y) < end[1] - 0.02 ? BRASS.dark : BRASS.base), { fl: VF.METAL });
    else if (kind === 1) cap(m, Pv(end), Pv(add3(end, [0.004, -0.04, 0])), U(0.01), U(0.004), BONE.base);
    else for (let i = 0; i < 3; i++) ell(m, Pv(add3(end, [0, -0.012 - i * 0.012, 0])), [U(0.007), U(0.007), U(0.007)], i === 1 ? 0xc8503a : 0x45b0a0);
  }
}
function buildPouch(m: VoxelModel, kind: 1 | 2 | 3) {
  if (kind === 1) {
    const c: V3 = [0.37, 0.66, -0.25];
    fblob(m, [{ c: Pv(c), r: [U(0.05), U(0.07), U(0.075)] }], (x, y) => (M(y) > 0.71 ? LEATHER.shade : LEATHER.base), { k: 2 });
    ell(m, P(0.385, 0.7, -0.25), [U(0.045), U(0.03), U(0.078)], LEATHER.shade, { keep: (lx) => lx > 0 });
    ell(m, P(0.42, 0.67, -0.25), [U(0.01), U(0.014), U(0.014)], BRASS.base, { fl: VF.METAL });
    line(m, [Pv(J.pouch1), P(0.37, 0.73, -0.25)], LEATHER.hi);
    for (const y of [0.62, 0.64]) m.set(Math.floor(U(0.42)), Math.floor(U(y)), Math.floor(U(-0.27)), LEATHER.stitch);
  } else if (kind === 2) {
    fblob(m, [{ c: P(0.19, 0.49, -0.44), r: [U(0.065), U(0.07), U(0.05)] }, { c: P(0.19, 0.555, -0.44), r: [U(0.035), U(0.025), U(0.03)] }], (x, y) => (M(y) > 0.54 ? LEATHER.hi : (x + y) % 5 === 0 ? 0x8a7a5a : 0xa89470), { k: 2 });
    line(m, [Pv(J.pouch2), P(0.19, 0.555, -0.44)], 0xc9a86a);
  } else {
    fblob(m, [{ c: P(-0.236, 0.6, -0.42), r: [U(0.06), U(0.075), U(0.055)] }, { c: P(-0.236, 0.69, -0.42), r: [U(0.035), U(0.04), U(0.033)] }], (x, y) => (M(y) < 0.56 ? 0xb08a46 : 0xc89e56), { k: 2 });
    ell(m, P(-0.236, 0.735, -0.42), [U(0.015), U(0.015), U(0.015)], 0x8a6a3a);
    line(m, [Pv(J.pouch3), P(-0.236, 0.73, -0.42)], 0xc9a86a);
  }
}
function buildLantern(m: VoxelModel) {
  const c: V3 = [-0.375, 0.79, -0.222];
  for (let y = 0; y < 7; y++) {
    const Y = c[1] + (y - 3) * 0.012;
    const r = y === 0 || y === 6 ? 0.03 : 0.025;
    for (let a = 0; a < 20; a++) {
      const t = (a / 20) * Math.PI * 2;
      const corner = Math.abs(Math.cos(t * 2)) > 0.92;
      const glass = y > 0 && y < 6 && !corner;
      m.set(Math.floor(U(c[0] + Math.cos(t) * r)), Math.floor(U(Y)), Math.floor(U(c[2] + Math.sin(t) * r)), glass ? 0xffc66a : BRASS.base, glass ? VF.EMISSIVE | VF.SOFTAO : VF.METAL);
    }
  }
  ell(m, P(c[0], c[1], c[2]), [U(0.012), U(0.018), U(0.012)], 0xffe2a0, { fl: VF.EMISSIVE | VF.GLOW });
  cap(m, P(c[0], c[1] + 0.045, c[2]), P(c[0], c[1] + 0.07, c[2]), U(0.026), U(0.008), BRASS.dark, { fl: VF.METAL });
  line(m, [P(c[0], c[1] + 0.07, c[2]), Pv(J.lantern)], 0x3a3a3e);
}
function buildBeads(m: VoxelModel) {
  // a necklace of fangs, amulets and turquoise beads round the base of the neck
  for (let i = 0; i <= 18; i++) {
    const t = i / 18;
    const a = (t - 0.5) * 2.4;
    const p: V3 = [Math.sin(a) * 0.13, 1.03 - Math.cos(a * 0.8) * 0.06, 0.04 + Math.cos(a) * 0.1];
    if (i % 3 === 0) cap(m, Pv(p), Pv(add3(p, [0, -0.035, 0.006])), U(0.01), U(0.004), BONE.base);
    else ell(m, Pv(p), [U(0.009), U(0.009), U(0.009)], i % 3 === 1 ? 0x45b0a0 : 0x2c7f74);
  }
  ell(m, P(0, 0.955, 0.15), [U(0.026), U(0.03), U(0.01)], (x, y) => (Math.abs(M(y) - 0.955) < 0.01 && Math.abs(M(x)) < 0.01 ? 0xc8503a : BRASS.base), { fl: VF.METAL });
}
function buildChain(m: VoxelModel) {
  // a watch chain swagged across the coat front to a pocket
  for (let i = 0; i <= 14; i++) {
    const t = i / 14;
    const p: V3 = [0.1 + t * 0.12, 0.76 - Math.sin(t * Math.PI) * 0.06 - t * 0.04, 0.2 - t * 0.03];
    m.set(Math.floor(U(p[0])), Math.floor(U(p[1])), Math.floor(U(p[2])), i & 1 ? BRASS.hi : BRASS.dark, VF.METAL);
  }
  ell(m, P(0.22, 0.715, 0.17), [U(0.02), U(0.02), U(0.008)], BRASS.base, { fl: VF.METAL });
}

// ================================================================== RIG
let cached: RigSpec | null = null;
export function ozymandiasRig(): RigSpec {
  if (cached) return cached;
  const rig = new CRig('tortoise_guy', VS);
  buildShell(rig.part('shell', undefined, Pv(J.shell)));
  buildNeck(rig.part('neck', 'shell', Pv(J.neck)));
  const F = buildFace();
  rig.part('head', 'neck', Pv(J.head)).merge(F.head);
  rig.part('jaw', 'head', Pv(J.jaw)).merge(F.jaw);
  rig.part('eye_l', 'head', Pv(EYE)).merge(F.eye);
  rig.mirror('eye_l', 'eye_r', 'head');
  rig.part('brow_l', 'head', Pv(F.lidAt)).merge(F.lids.neutral);
  rig.mirror('brow_l', 'brow_r', 'head');
  rig.part('coins', 'head', Pv(J.coins)).merge(F.coins);
  rig.part('scarf_tails', 'head', Pv(J.tails)).merge(F.tails);
  buildChain(rig.part('chain', 'shell', Pv(J.chain)));
  buildArm(rig.part('arm_l', 'shell', Pv(J.shoulder)));
  buildForearm(rig.part('fore_l', 'arm_l', Pv(J.elbow)), false);
  rig.mirror('arm_l', 'arm_r', 'shell');
  const foreR = new VoxelModel('fore_r_src');
  buildForearm(foreR, true);
  rig.part('fore_r', 'arm_r', Pv(mir(J.elbow))).merge(mirrorModel(foreR, 'fore_r'));
  const cane = rig.part('cane', 'fore_r', Pv(mir(J.hand)));
  buildCane(cane);
  buildBells(rig.part('bells', 'cane', Pv(J.bells)));
  buildLeg(rig.part('leg_l', 'shell', Pv(J.hip)));
  rig.mirror('leg_l', 'leg_r', 'shell');
  buildTail(rig.part('tail', 'shell', Pv(J.tail)));
  buildPouch(rig.part('pouch_1', 'shell', Pv(J.pouch1)), 1);
  buildPouch(rig.part('pouch_2', 'shell', Pv(J.pouch2)), 2);
  buildPouch(rig.part('pouch_3', 'shell', Pv(J.pouch3)), 3);
  buildLantern(rig.part('lantern', 'shell', Pv(J.lantern)));
  buildBeads(rig.part('beads', 'shell', Pv(J.beads)));
  // overlapping parts never share an exposed cell
  for (const p of rig.parts) {
    if (!p.parent || /^(eye|brow)_/.test(p.name)) continue;
    const par = rig.m(p.parent);
    const del: V3[] = [];
    p.model.forEach((x, y, z) => {
      if (par.has(x, y, z) && exposed(par, x, y, z)) del.push([x, y, z]);
    });
    for (const [x, y, z] of del) p.model.del(x, y, z);
  }
  let top = 0;
  for (const p of rig.parts) p.model.forEach((_x, y) => (top = Math.max(top, y + 1)));
  const lidPair = (m: VoxelModel) => ({ brow_l: m, brow_r: mirrorModel(m, 'brow_r') });
  const expressions: Record<string, ExpressionSpec> = defaultExpressions(['neutral', 'laugh', 'surprised', 'scared', 'squinty']);
  expressions.laugh = { ...expressions.laugh, parts: lidPair(F.lids.closed) };
  expressions.squinty = { ...expressions.squinty, parts: lidPair(F.lids.squint) };
  expressions.surprised = { ...expressions.surprised, hide: ['brow_l', 'brow_r'] };
  expressions.scared = { ...expressions.scared, hide: ['brow_l', 'brow_r'] };
  rig.socket('hand_r', 'fore_r', Pv(mir(J.hand)));
  rig.socket('hand_l', 'fore_l', Pv(J.hand));
  rig.socket('head_top', 'head', P(0, 1.6, 0.14));
  rig.socket('mouth', 'jaw', P(0, 1.245, 0.5));
  rig.socket('eye_l', 'head', Pv(EYE));
  rig.socket('eye_r', 'head', Pv(mir(EYE)));
  rig.socket('chest', 'shell', P(0, 0.833, 0.111));
  rig.socket('back', 'shell', P(0, 0.833, -0.5));
  rig.socket('lantern_hook', 'shell', Pv(J.lantern));
  rig.socket('pipe', 'jaw', P(0.215, 1.255, 0.52));
  const k = 1 / 36;
  const v = (x: number, y: number, z: number): V3 => [x * k, y * k, z * k];
  cached = rig.build({
    height: top * VS,
    radius: 0.45,
    retract: { neck: v(0, -11, -10), arm_l: v(-4.5, 1, -4), arm_r: v(4.5, 1, -4), leg_l: v(-1, 8.5, -1.5), leg_r: v(1, 8.5, -1.5), tail: v(0, 2.5, 3.5) },
    shellDrop: 8 * k,
    swing: ['coins', 'chain', 'scarf_tails', 'bells', 'pouch_1', 'pouch_2', 'pouch_3', 'lantern', 'beads'],
    facePivots: { eye_l: EYE, eye_r: mir(EYE), brow_l: F.lidAt, brow_r: mir(F.lidAt), jaw: J.jaw },
    eyes: 'voxel',
    expressions,
  });
  return cached;
}
