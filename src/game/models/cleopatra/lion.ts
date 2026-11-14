// CLEOPATRA'S TAMED LIONS: a black-maned male ("Sekhem") and a lioness ("Bast's
// Daughter"), realistic and heavy, 1/48 m voxels. One continuous anatomical
// sculpt (deep thorax, sloping back, muscled shoulders and haunches, swinging
// primordial pouch, broad muzzle) cut into a joint-rich quadruped rig:
//   hips (root) → chest → neck → head → jaw (+ tongue), ear_l/_r, eye_l/_r
//   chest → leg_fl → shin_fl → paw_fl (and _fr) · hips → leg_bl → shin_bl → paw_bl (and _br)
//   hips → tail1 → tail2 → tail3 → tail4 (black tuft)
// Coat: tawny guard hair streaked along the body, countershaded cream belly
// and inner legs, white muzzle and chin, whisker-spot rows, black lips and
// tear lines, black-edged ears. The male's mane runs from golden at the face to
// near black over the shoulders, in clumped strands. Both wear the queen's
// jewelled gold collar with lapis inlay and a sun medallion.
// Modelled glossy amber eyes with round pupils; canines that show when it roars.
import { KRig, VoxelModel, VF, E, C, SUB, union, raster, rasterU, cutBones, finish, eyeball, curve, tubePrims, stampTube, pk, mixc, mulc, nS, n01, sstep, clamp01, mirX, norm3, type V3, type Prim, type Bone, type RigSpec, type Field } from './kit';
import { hash3 } from '../../../engine/math/rand';

const VS = 1 / 48;

// ---------------------------------------------------------------------------- palette
const COAT = { base: 0xc2955a, light: 0xd9b37a, shade: 0x9c7342, dark: 0x6e4c2a };
const CREAM = 0xeedcb4;
const MUZZLE = 0xf4ead2;
const BLACK = 0x1c1410;
const NOSE = 0x7a4a3c;
const MANE = { face: 0xd8a058, mid: 0xa86c34, deep: 0x6e4424, black: 0x3e2616 };
const GOLD = { hi: 0xffe08a, base: 0xe0b24a, shade: 0xaa7c26, dark: 0x6e4c12 };
const LAPIS = 0x2c4c9e;
const CARN = 0xb4382a;
const TOOTH = 0xf2ead6;
const GUM = 0x9a4a48;
const MOUTH = 0x4a1a1a;
const TONGUE = 0xc86a6a;

export interface LionOpts {
  maned?: boolean;
}

function build(maned: boolean): RigSpec {
  const K = maned ? 1 : 0.9;
  const k = (v: number) => v * K;
  const p = (x: number, y: number, z: number): V3 => [x * K, y * K, z * K];
  const rig = new KRig(maned ? 'cleo_lion' : 'cleo_lioness', VS);

  // ------------------------------------------------------------------ landmarks (left side; mirrored for the right)
  const S: V3 = p(0.17, 0.84, 0.44), EB: V3 = p(0.165, 0.5, 0.32), WR: V3 = p(0.15, 0.13, 0.43), PF: V3 = p(0.15, 0.055, 0.53), TF: V3 = p(0.15, 0.04, 0.62);
  const HP: V3 = p(0.15, 0.84, -0.84), KN: V3 = p(0.16, 0.54, -0.62), HK: V3 = p(0.15, 0.25, -0.95), PB: V3 = p(0.15, 0.05, -0.8), TB: V3 = p(0.15, 0.04, -0.71);
  const NECK_A: V3 = p(0, 0.94, 0.52), NECK_B: V3 = p(0, 1.06, 0.9);
  const HEAD_P: V3 = p(0, 1.08, 0.92), JAW_P: V3 = p(0, 1.0, 1.04);
  const NOSE_C: V3 = p(0, 1.06, 1.41);
  const TAIL: V3[] = [p(0, 0.95, -1.06), p(0, 0.9, -1.2), p(0, 0.74, -1.32), p(0, 0.55, -1.38), p(0, 0.38, -1.36), p(0, 0.27, -1.3)];
  const EYE_C: V3 = p(0.07, 1.137, 1.218);
  const EAR: V3 = p(0.12, 1.27, 0.99);
  const neckR = maned ? 1 : 0.82;
  /** lip line height along the muzzle (the jaw owns what is below it) */
  const lipY = (z: number) => k(0.99) - Math.max(0, z - k(1.1)) * 0.06;

  // ------------------------------------------------------------------ anatomy
  const L: Prim[] = [
    // thorax, brisket, withers, scapulae
    E(p(0, 0.8, 0.3), [k(0.25) * (maned ? 1 : 0.92), k(0.32), k(0.4)]),
    E(p(0, 0.7, 0.52), [k(0.19), k(0.25), k(0.18)]),
    E(p(0, 1.0, 0.36), [k(0.17), k(0.12), k(0.26)]),
    // abdomen, pouch, loin, croup
    E(p(0, 0.79, -0.22), [k(0.22) * (maned ? 1 : 0.92), k(0.23), k(0.4)]),
    E(p(0, 0.6, -0.4), [k(0.15), k(0.07), k(0.24)]),
    E(p(0, 0.93, -0.52), [k(0.19), k(0.12), k(0.3)]),
    E(p(0, 0.94, -0.86), [k(0.17), k(0.1), k(0.2)]),
    // neck
    C(NECK_A, NECK_B, k(0.2) * neckR, k(0.15) * neckR),
    E(p(0, 0.86, 0.66), [k(0.13) * neckR, k(0.16), k(0.12)]), // dewlap / throat
    // head
    E(p(0, 1.14, 1.03), [k(0.155), k(0.14), k(0.18)]),
    E(p(0, 1.17, 1.15), [k(0.12), k(0.08), k(0.09)]),
    E(p(0, 1.035, 1.29), [k(0.095), k(0.085), k(0.12)]),
    C(p(0, 1.14, 1.19), p(0, 1.085, 1.39), k(0.055), k(0.046)),
    E(NOSE_C, [k(0.046), k(0.034), k(0.03)]),
    E(p(0, 0.935, 1.26), [k(0.068), k(0.04), k(0.11)]),
    // tail
    ...tubePrims(curve(TAIL, 10), (t) => k(0.05 - t * 0.022)),
  ];
  const side: Prim[] = [
    E(p(0.16, 0.88, 0.42), [k(0.09), k(0.22), k(0.15)], [0.35, 0, 0.08]), // scapula
    E(p(0.11, 0.82, -0.84), [k(0.14), k(0.22), k(0.24)]), // haunch
    E(p(0.09, 0.66, -0.92), [k(0.1), k(0.16), k(0.14)]), // buttock
    E(p(0.095, 1.07, 1.12), [k(0.075), k(0.075), k(0.1)]), // cheek
    E(p(0.042, 0.985, 1.355), [k(0.05), k(0.045), k(0.06)]), // upper lip lobe
    E(p(0.075, 0.97, 1.06), [k(0.06), k(0.07), k(0.1)]), // masseter
    E(p(0.065, 1.168, 1.2), [k(0.045), k(0.02), k(0.03)]), // brow ridge
    E(EAR, [k(0.055), k(0.06), k(0.028)], [0, -0.3, 0.2]), // ear
    // front leg
    C(S, EB, k(0.115), k(0.085)),
    E(p(0.17, 0.66, 0.3), [k(0.09), k(0.15), k(0.1)]),
    E(p(0.18, 0.7, 0.44), [k(0.075), k(0.14), k(0.08)]),
    C(EB, WR, k(0.075), k(0.058)),
    E(p(0.16, 0.4, 0.38), [k(0.07), k(0.13), k(0.075)]),
    C(WR, p(0.15, 0.06, 0.48), k(0.058), k(0.06)),
    E(PF, [k(0.085), k(0.058), k(0.105)]),
    // back leg
    C(HP, KN, k(0.13), k(0.09)),
    E(p(0.15, 0.68, -0.74), [k(0.115), k(0.2), k(0.16)]),
    C(KN, HK, k(0.07), k(0.048)),
    E(p(0.15, 0.45, -0.82), [k(0.06), k(0.12), k(0.07)]),
    C(HK, p(0.15, 0.07, -0.84), k(0.048), k(0.05)),
    E(PB, [k(0.075), k(0.05), k(0.095)]),
  ];
  // toes: four pads in front of each paw
  for (const [pc, z0, r] of [[PF, k(0.6), 0.026], [PB, k(-0.715), 0.023]] as [V3, number, number][])
    for (const t of [-1.5, -0.5, 0.5, 1.5]) side.push(E([pc[0] + t * k(0.038), k(0.042), z0 + (1.5 - Math.abs(t)) * k(0.012)], [k(r), k(0.04), k(0.034)]));
  for (const q of side) {
    L.push(q);
    if (q.c) L.push({ ...q, c: mirX(q.c), rot: q.rot ? [q.rot[0], -q.rot[1], -q.rot[2]] : undefined });
    else L.push({ ...q, a: mirX(q.a!), b: mirX(q.b!) });
  }
  // eye pockets and the mouth line
  L.push(SUB(E(EYE_C, [k(0.032), k(0.024), k(0.026)])), SUB(E(mirX(EYE_C), [k(0.032), k(0.024), k(0.026)])));
  const body = union(L, k(0.05));

  // ------------------------------------------------------------------ coat paint (metres, normal, depth)
  const toFace = (x: number, y: number, z: number) => Math.hypot(x / K, (y / K - 1.06) * 1.2, (z / K - 1.3) * 0.9);
  const coat = (x: number, y: number, z: number, nx: number, ny: number, nz: number) => {
    const X = x / K, Y = y / K, Z = z / K;
    const ax = Math.abs(X);
    const leg = Y < 0.52 && (ax > 0.07 || Y < 0.4);
    // guard hair streaks: along the body on the trunk, down the legs
    const st = leg ? nS(x, y * 0.3, z, 16, 3) : nS(x, y, z * 0.32, 14, 3);
    let c = mixc(COAT.base, COAT.light, sstep(0.2, 0.75, st) * 0.6);
    c = mixc(c, COAT.shade, sstep(-0.25, -0.8, st) * 0.55);
    // dorsal darkening, countershaded belly and inner legs
    if (ny > 0.55 && Y > 0.9 && Z < 0.7) c = mixc(c, COAT.shade, 0.25);
    const under = ny < -0.25 || (leg && ax < 0.13 && nx * Math.sign(X) < -0.2);
    if (under) c = mixc(c, CREAM, 0.65);
    if (Z > 1.04) {
      // the face: white muzzle and chin, whisker spots, black lips, nose pad
      const fd = toFace(x, y, z);
      if (Y < 1.07 && Z > 1.2 && fd < 0.13) c = mixc(MUZZLE, c, sstep(0.08, 0.13, fd));
      if (Y < 0.985 && Z > 1.16) c = MUZZLE;
      // whisker spot rows on the muzzle sides
      if (Z > 1.26 && Z < 1.4 && ax > 0.03 && Y > 0.995 && Y < 1.055) {
        const gy = (Y - 0.995) / 0.016, gz = (Z - 1.26) / 0.025;
        if (Math.abs(gy - Math.round(gy)) < 0.22 && Math.abs(gz - Math.round(gz)) < 0.22 && hash3(Math.round(gy), Math.round(gz), Math.sign(X)) > 0.35) c = 0x3a2a20;
      }
      // tear lines: inner eye corner down to the muzzle
      const tz = Z - 1.23, ty = Y - (1.12 - tz * 0.7);
      if (ax > 0.03 && ax < 0.055 && tz > 0 && tz < 0.09 && Math.abs(ty) < 0.008) c = BLACK;
      // white patch under the eye
      if (Math.hypot(ax - 0.07, Y - 1.115, Z - 1.215) < 0.02) c = MUZZLE;
      // lips
      if (Math.abs(Y - lipY(z) / K) < 0.008 && Z > 1.15) c = BLACK;
      if (Z > 1.38 && Y > 1.03 && Math.hypot(X, Y - 1.06) < 0.05) c = nz > 0.5 ? NOSE : mulc(NOSE, 0.7);
      if (Z > 1.43 && Math.abs(X) < 0.012 && Y < 1.06) c = BLACK; // philtrum
    }
    // black-backed, edged ears
    if (Math.hypot(ax - 0.12, Y - 1.27, Z - 0.99) < 0.07) c = nz < -0.2 || Y > 1.31 ? BLACK : mixc(c, CREAM, 0.5);
    // paws: darker pads underneath
    if (Y < 0.02) c = 0x3a2a22;
    return c;
  };
  const whole = new VoxelModel('lion');
  rasterU(whole, VS, body, (x, y, z, nx, ny, nz) => {
    let c = coat(x, y, z, nx, ny, nz);
    if (ny > 0.6) c = mulc(c, 1.04);
    else if (ny < -0.6) c = mulc(c, 0.9);
    return pk(c);
  }, { interior: COAT.dark });

  // ------------------------------------------------------------------ the tail tuft
  {
    const tip = TAIL[TAIL.length - 1];
    const tuft: Field = (x, y, z) => {
      const d = Math.hypot((x - tip[0]) / k(0.05), (y - tip[1] + k(0.03)) / k(0.09), (z - tip[2]) / k(0.05)) - 1;
      return d * k(0.05) + nS(x, y, z, 70, 9) * k(0.012);
    };
    raster(whole, VS, [tip[0] - k(0.09), tip[1] - k(0.15), tip[2] - k(0.09)], [tip[0] + k(0.09), tip[1] + k(0.08), tip[2] + k(0.09)], tuft, (x, y, z) => pk(n01(x, y, z, 60, 2) > 0.6 ? MANE.deep : BLACK));
  }

  // ------------------------------------------------------------------ the mane
  if (maned) {
    const faceC: V3 = [0, 1.09, 1.2];
    const M = union(
      [
        E([0, 1.12, 0.92], [0.32, 0.33, 0.3]),
        E([0, 1.21, 0.8], [0.26, 0.22, 0.3]),
        E([0, 0.88, 0.71], [0.25, 0.32, 0.22]),
        E([0, 0.68, 0.62], [0.17, 0.2, 0.14]),
        E([0, 1.07, 0.56], [0.27, 0.24, 0.22]),
        E([0, 1.26, 0.98], [0.18, 0.09, 0.14]),
        SUB(E([0, 1.07, 1.21], [0.16, 0.165, 0.22])),
        SUB(E([0, 0.92, 1.18], [0.12, 0.1, 0.2])),
      ],
      0.08
    );
    const shag: Field = (x, y, z) => {
      const vx = x - faceC[0], vy = y - faceC[1], vz = z - faceC[2];
      const a1 = Math.atan2(vy, vx), a2 = Math.atan2(vz, Math.hypot(vx, vy));
      const clump = nS(Math.cos(a1) * 2.2, Math.sin(a1) * 2.2, a2 * 2.4, 1, 5) * 0.05;
      const strand = Math.sin(a1 * 26 + nS(x, y, z, 9, 6) * 4) * 0.012;
      return M(x, y, z) + clump + strand + nS(x, y, z, 40, 7) * 0.01;
    };
    const maneCol = (x: number, y: number, z: number, nz: number) => {
      const vx = x - faceC[0], vy = y - faceC[1], vz = z - faceC[2];
      const fd = Math.hypot(vx, vy * 1.1, vz);
      const a1 = Math.atan2(vy, vx);
      const clump = nS(Math.cos(a1) * 2.2, Math.sin(a1) * 2.2, Math.atan2(vz, Math.hypot(vx, vy)) * 2.4, 1, 5);
      const groove = Math.sin(a1 * 26 + nS(x, y, z, 9, 6) * 4);
      let c = fd < 0.26 ? mixc(MANE.face, MANE.mid, sstep(0.14, 0.26, fd)) : mixc(MANE.mid, MANE.deep, sstep(0.26, 0.5, fd));
      if (y < 0.78) c = mixc(c, MANE.deep, 0.5);
      c = mixc(c, clump > 0 ? MANE.face : MANE.deep, Math.abs(clump) * 0.35);
      if (groove < -0.6) c = mixc(c, MANE.black, 0.35);
      if (nz > 0.6 && fd < 0.3) c = mixc(c, MANE.face, 0.2);
      return c;
    };
    raster(whole, VS, [-0.42, 0.42, 0.28], [0.42, 1.5, 1.3], shag, (x, y, z, _nx, _ny, nz) => pk(maneCol(x, y, z, nz)), { interior: MANE.deep });
    // loose strands flowing out of the silhouette
    const surf: V3[] = [];
    whole.forEach((i, j, kk, c) => {
      const x = (i + 0.5) * VS, y = (j + 0.5) * VS, z = (kk + 0.5) * VS;
      if (z < 0.4 || z > 1.18 || y < 0.6) return;
      if (M(x, y, z) > 0.02) return;
      if (!whole.has(i, j + 1, kk) || !whole.has(i + 1, j, kk) || !whole.has(i - 1, j, kk) || !whole.has(i, j, kk - 1)) surf.push([x, y, z]);
      void c;
    });
    for (let s = 0; s < 150 && surf.length; s++) {
      const a = surf[Math.floor(hash3(s, 3, 7) * surf.length) % surf.length];
      const out = norm3([a[0] - faceC[0], (a[1] - faceC[1]) * 0.8 - 0.35, (a[2] - faceC[2]) * 0.9 - 0.3]);
      const L2 = 0.06 + hash3(s, 5, 1) * 0.1;
      const b: V3 = [a[0] + out[0] * L2, a[1] + out[1] * L2, a[2] + out[2] * L2];
      const sag: V3 = [b[0], b[1] - L2 * 0.35, b[2]];
      stampTube(whole, VS, [a, b, sag], VS * 1.1, VS * 0.45, (x, y, z) => pk(mixc(maneCol(x, y, z, 0), MANE.deep, 0.15)), true);
    }
    // a belly fringe
    const fr = union([E([0, 0.56, 0.1], [0.14, 0.06, 0.28])], 0.04);
    raster(whole, VS, fr.lo, fr.hi, (x, y, z) => fr(x, y, z) + nS(x, y, z, 50, 12) * 0.02, (x, y, z) => pk(n01(x, y, z, 40, 3) > 0.5 ? MANE.deep : MANE.mid), { under: true });
  }

  // ------------------------------------------------------------------ the queen's collar (gold, lapis inlay, sun medallion)
  {
    const zc = maned ? 0.72 : k(0.74), yc = maned ? 1.0 : k(0.98);
    const R = maned ? 0.285 : k(0.16), Ry = maned ? 0.27 : k(0.15);
    const tilt = 0.55;
    const ca = Math.cos(tilt), sa = Math.sin(tilt);
    const ring: Field = (x, y, z) => {
      // ellipse around the neck axis, tilted forward with the neck
      const ly = (y - yc) * ca - (z - zc) * sa, lz = (y - yc) * sa + (z - zc) * ca;
      const q = Math.hypot(x / R, ly / Ry);
      const dr = (q - 1) * Math.min(R, Ry);
      return Math.hypot(dr, lz) - 0.024 * (maned ? 1 : K);
    };
    raster(whole, VS, [-R - 0.05, yc - 0.35, zc - 0.3], [R + 0.05, yc + 0.35, zc + 0.3], ring, (x, y, z, _nx, ny) => {
      const a = Math.atan2(y - yc, x);
      const seg = Math.floor((a / (Math.PI * 2)) * 28 + 28) % 2;
      const c = seg ? (ny > 0.3 ? GOLD.hi : GOLD.base) : LAPIS;
      return pk(c, seg ? VF.METAL : VF.SOLID);
    });
    // sun medallion hanging at the front bottom of the collar
    const mc: V3 = [0, yc - Ry * ca - 0.07, zc + Ry * sa + 0.06];
    const med: Field = (x, y, z) => Math.max(Math.hypot(x - mc[0], y - mc[1]) - 0.065, Math.abs(z - mc[2]) - 0.013);
    raster(whole, VS, [mc[0] - 0.1, mc[1] - 0.1, mc[2] - 0.05], [mc[0] + 0.1, mc[1] + 0.1, mc[2] + 0.05], med, (x, y, z, _nx, _ny, nz) => {
      const r = Math.hypot(x - mc[0], y - mc[1]);
      if (r < 0.028 && nz > 0.3) return pk(CARN, VF.EMISSIVE);
      const ray = Math.sin(Math.atan2(y - mc[1], x - mc[0]) * 12) > 0.3;
      return pk(r > 0.055 ? GOLD.shade : ray ? GOLD.hi : GOLD.base, VF.METAL);
    });
  }

  // ------------------------------------------------------------------ cut into the rig
  rig.part('hips', undefined, p(0, 0.9, -0.5));
  rig.part('chest', 'hips', p(0, 0.88, -0.38));
  rig.part('neck', 'chest', NECK_A);
  rig.part('head', 'neck', HEAD_P);
  rig.part('jaw', 'head', JAW_P);
  for (const s of [1, -1]) {
    const sf = s > 0 ? '_l' : '_r';
    const m = (v: V3): V3 => [v[0] * s, v[1], v[2]];
    rig.part('ear' + sf, 'head', m(p(0.11, 1.24, 0.99)));
    rig.part('leg_f' + sf.slice(1), 'chest', m(S));
    rig.part('shin_f' + sf.slice(1), 'leg_f' + sf.slice(1), m(EB));
    rig.part('paw_f' + sf.slice(1), 'shin_f' + sf.slice(1), m(WR));
    rig.part('leg_b' + sf.slice(1), 'hips', m(HP));
    rig.part('shin_b' + sf.slice(1), 'leg_b' + sf.slice(1), m(KN));
    rig.part('paw_b' + sf.slice(1), 'shin_b' + sf.slice(1), m(HK));
  }
  rig.part('tail1', 'hips', TAIL[0]);
  rig.part('tail2', 'tail1', TAIL[2]);
  rig.part('tail3', 'tail2', TAIL[3]);
  rig.part('tail4', 'tail3', TAIL[4]);
  const jawOnly = (x: number, y: number, z: number) => z > k(1.06) && y < lipY(z) && Math.abs(x) < k(0.11) && y > k(0.85);
  const bones: Bone[] = [
    { part: 'hips', a: p(0, 0.92, -1.02), b: p(0, 0.9, -0.48), r: k(0.24) },
    { part: 'chest', a: p(0, 0.86, -0.42), b: p(0, 0.86, 0.52), r: k(0.3) },
    { part: 'neck', a: p(0, 0.95, 0.5), b: p(0, 1.06, 0.86), r: k(0.22) },
    { part: 'head', a: p(0, 1.12, 0.96), b: p(0, 1.07, 1.42), r: k(0.15), only: (x, y, z) => !jawOnly(x, y, z) },
    { part: 'jaw', a: p(0, 0.95, 1.08), b: p(0, 0.94, 1.38), r: k(0.06), only: jawOnly },
    { part: 'tail1', a: TAIL[0], b: TAIL[2], r: k(0.06) },
    { part: 'tail2', a: TAIL[2], b: TAIL[3], r: k(0.05) },
    { part: 'tail3', a: TAIL[3], b: TAIL[4], r: k(0.045) },
    { part: 'tail4', a: TAIL[4], b: [TAIL[5][0], TAIL[5][1] - k(0.12), TAIL[5][2]], r: k(0.06) },
  ];
  for (const s of [1, -1]) {
    const sf = s > 0 ? 'l' : 'r';
    const m = (v: V3): V3 => [v[0] * s, v[1], v[2]];
    const sideOk = (x: number) => x * s > k(0.02);
    bones.push(
      { part: 'ear_' + sf, a: m(EAR), b: m([EAR[0] + k(0.01), EAR[1] + k(0.03), EAR[2]]), r: k(0.045), only: (x, y) => sideOk(x) && y > k(1.22) },
      { part: 'leg_f' + sf, a: m(S), b: m(EB), r: k(0.1), only: (x, y) => sideOk(x) && y < k(0.95) },
      { part: 'shin_f' + sf, a: m(EB), b: m(WR), r: k(0.07), only: (x, y) => sideOk(x) && y < k(0.58) },
      { part: 'paw_f' + sf, a: m(WR), b: m(TF), r: k(0.07), only: (x, y) => sideOk(x) && y < k(0.2) },
      { part: 'leg_b' + sf, a: m(HP), b: m(KN), r: k(0.12), only: (x, y) => sideOk(x) && y < k(0.95) },
      { part: 'shin_b' + sf, a: m(KN), b: m(HK), r: k(0.065), only: (x, y) => sideOk(x) && y < k(0.6) },
      { part: 'paw_b' + sf, a: m(HK), b: m(TB), r: k(0.06), only: (x, y) => sideOk(x) && y < k(0.3) },
    );
  }
  cutBones(whole, VS, rig, bones);

  // ------------------------------------------------------------------ mouth: canines, gums, tongue, dark gape
  const head = rig.m('head'), jaw = rig.m('jaw');
  const gape = union([E(p(0, lipY(1.25) / K, 1.24), [k(0.06), k(0.022), k(0.12)])], 0.01);
  raster(head, VS, gape.lo, gape.hi, gape, () => pk(MOUTH), { keep: (_x, y) => y >= lipY(1.2) - 0.002 });
  raster(jaw, VS, gape.lo, gape.hi, gape, (x, y, z) => pk(Math.abs(x) < k(0.035) && z < k(1.33) ? TONGUE : GUM), { keep: (_x, y) => y < lipY(1.2) });
  for (const s of [1, -1]) {
    const up = union([C([s * k(0.036), lipY(1.33) + k(0.012), k(1.335)], [s * k(0.033), lipY(1.33) - k(0.045), k(1.345)], k(0.011), k(0.004))], 0.002);
    rasterU(head, VS, up, (_x, _y, _z, _nx, ny) => pk(ny > 0.5 ? mulc(TOOTH, 0.85) : TOOTH));
    const lo = union([C([s * k(0.03), lipY(1.3) - k(0.012), k(1.3)], [s * k(0.028), lipY(1.3) + k(0.035), k(1.305)], k(0.01), k(0.004))], 0.002);
    rasterU(jaw, VS, lo, () => pk(TOOTH));
    // whiskers: long pale hairs sweeping back from the whisker pads
    for (let w = 0; w < 5; w++) {
      const y0 = k(1.0 + w * 0.012), z0 = k(1.3 + (w % 2) * 0.03);
      const a: V3 = [s * k(0.075), y0, z0];
      const b: V3 = [s * k(0.21), y0 - k(0.015) + w * k(0.008), z0 - k(0.07)];
      for (let t = 0; t <= 1.0001; t += 0.08) {
        const q = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - t * t * k(0.02), a[2] + (b[2] - a[2]) * t];
        head.set(Math.floor(q[0] / VS), Math.floor(q[1] / VS), Math.floor(q[2] / VS), 0xf0e8d8, VF.SOFTAO);
      }
    }
  }
  // claws peeking at the front of the fore paws
  for (const s of [1, -1]) {
    const pm = rig.m(s > 0 ? 'paw_fl' : 'paw_fr');
    for (const t of [-1.5, -0.5, 0.5, 1.5]) {
      const x = s * PF[0] + t * k(0.038);
      const cl = union([C([x, k(0.05), TF[2] + k(0.01)], [x, k(0.018), TF[2] + k(0.04)], k(0.008), k(0.003))], 0.002);
      rasterU(pm, VS, cl, () => pk(0xe8dcc0), { under: true });
    }
  }

  // ------------------------------------------------------------------ eyes (modelled, glossy amber, round pupils)
  for (const s of [1, -1]) {
    const c: V3 = [EYE_C[0] * s, EYE_C[1], EYE_C[2]];
    const em = rig.part(s > 0 ? 'eye_l' : 'eye_r', 'head', c);
    eyeball(em, VS, c, k(0.021), norm3([s * 0.32, 0.05, 1]), { iris: 0xd09a2a, sclera: 0x6a4a28, pupil: 0x060403, irisR: 0.9, pupilR: 0.36 });
    // dark lid rims around the socket
    head.forEach((x, y, z, col, f) => {
      const X = (x + 0.5) * VS, Y = (y + 0.5) * VS, Z = (z + 0.5) * VS;
      const d = Math.hypot(X - c[0], (Y - c[1]) * 1.2, Z - c[2]);
      if (d < k(0.04) && d > k(0.022)) head.set(x, y, z, Y > c[1] + k(0.008) ? BLACK : mixc(col, BLACK, 0.6), f);
    });
  }

  for (const part of rig.parts) finish(part.model, 1.03, 0.92, (_c, f) => (f & VF.METAL) !== 0);
  rig.socket('mouth', 'head', p(0, 0.99, 1.4));
  rig.socket('head_top', 'head', p(0, 1.3, 1.0));
  rig.socket('chest', 'chest', p(0, 0.78, 0.5));
  rig.socket('back', 'chest', p(0, 1.12, 0.1));
  return rig.build({
    kind: 'lion',
    maned,
    height: k(1.15),
    radius: k(0.55),
    length: k(2.5),
    legF: { hip: S[1], upper: Math.hypot(EB[1] - S[1], EB[2] - S[2]), lower: Math.hypot(WR[1] - EB[1], WR[2] - EB[2]) },
    legB: { hip: HP[1], upper: Math.hypot(KN[1] - HP[1], KN[2] - HP[2]), lower: Math.hypot(HK[1] - KN[1], HK[2] - KN[2]) },
    noEyes: false,
  });
}

const cache = new Map<string, RigSpec>();
/** Cleopatra's tamed lion (male with mane) or lioness */
export function cleoLionRig(o: LionOpts = {}): RigSpec {
  const key = o.maned === false ? 'f' : 'm';
  let r = cache.get(key);
  if (!r) cache.set(key, (r = build(o.maned !== false)));
  return r;
}
void clamp01;
