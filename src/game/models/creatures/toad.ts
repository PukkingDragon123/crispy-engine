// Real toads for the hideout hearth: Mama Toad, who knits by the fire in her
// rocking chair, and her toadlets.
//
// Built like real common / desert toads, never cartoon frogs:
//   - a heavy squat body with a sacral hump, broad flanks and a pale belly that
//     settles onto the ground;
//   - a broad flat head with bony cranial crests and a blunt snout;
//   - big golden eyes with horizontal pupils and dark reticulated irises, under
//     heavy hooded upper lids, with a real lower lid that rises to blink;
//   - kidney-shaped parotoid glands behind the eyes, peppered with pores;
//   - a tympanum, and a dark stripe running back from the eye through it;
//   - skin of rounded warts with dark keratin tips;
//   - mottled olive, brown and ochre on top, barred legs, a speckled cream belly;
//   - stout arms on in-turned hands; long folded hind legs with webbed toes.
// Mama is a grandmother through her pose and her props: she sits back in the
// chair, her head bowed over her knitting. She wears a crocheted shawl with a
// fringe, wire spectacles low on her snout and a beaded spectacle chain, and
// holds two birch needles with a striped scarf on the go.
//
// RIG (faces +Z, LEFT = +X, origin on the ground / seat under the body):
//   body (root) → head → jaw → throat; head → eye_l / eye_r (golden globes; aim
//   them by rotating), lid_l / lid_r (lower lids: blink = rotate about
//   meta.blink.l / r by up to meta.blink.close), [mama] specs → lenses
//   body → belly (breathing), arm_l → fore_l (forearm and hand; [mama] the needle, and knit on the left one)
//   body → thigh_l → shin_l → foot_l (and _r); [mama] body → shawl
// Everything is sculpted in one shared rig space, so pivot == attach.
import { CRig, VoxelModel, VF, V3, RigSpec, Prim, ell, tube, paint, exposed, hollow, mixc, mulc, n01, h01, add3, sub3, scl3, dot3, cross3, norm3, lerp3, clamp01, sstep, memoBy, invXYZ } from './ckit';

// ================================================================ palettes
interface ToadPal {
  base: number;
  light: number;
  dark: number;
  rim: number;
  flank: number;
  belly: number;
  speck: number;
  throat: number;
  wart: number;
  tipDark: number;
  tipLight: number;
  parotoid: number;
  band: number;
  legUnder: number;
  lid: number;
  stripe: number;
}
const MAMA_PAL: ToadPal = {
  base: 0x76683f,
  light: 0xa48a54,
  dark: 0x4b412b,
  rim: 0x3c3323,
  flank: 0x96805a,
  belly: 0xe0d5b8,
  speck: 0xa59a82,
  throat: 0xd4cab0,
  wart: 0xa2814f,
  tipDark: 0x4a301e,
  tipLight: 0xc9ac74,
  parotoid: 0x8c7748,
  band: 0x43372a,
  legUnder: 0xc6ad7a,
  lid: 0x8e7c58,
  stripe: 0xb5a36c,
};
const BABY_PALS: ToadPal[] = [
  { ...MAMA_PAL, base: 0x7c7346, light: 0xa69658, dark: 0x4e4a2e, wart: 0x9e8a52, parotoid: 0x8a8050 }, // olive
  { ...MAMA_PAL, base: 0x8a6438, light: 0xb08850, dark: 0x553a22, rim: 0x432c1a, flank: 0xa07c56, wart: 0xae7c48, parotoid: 0x96703e, tipDark: 0x5a2c18 }, // rusty brown
  { ...MAMA_PAL, base: 0x6c6452, light: 0x948a70, dark: 0x463f34, rim: 0x37312a, flank: 0x8c826c, wart: 0x948670, parotoid: 0x7c735c, tipLight: 0xd4c8a8 }, // grey-brown
  { ...MAMA_PAL, base: 0x8a7a44, light: 0xbaa060, dark: 0x5a4a2a, flank: 0xa8905e, wart: 0xb89858, parotoid: 0x9a8650, stripe: 0xd2c080 }, // ochre
];
/** the mouth inside, the eye */
const MOUTH = { palate: 0xb06460, floor: 0xc27468, tongue: 0xd08678, deep: 0x5a2422 };
const EYE = { gold: 0xd6a03a, goldHi: 0xf0c868, goldLo: 0xa8742a, vein: 0x6c4416, limbus: 0x3e2c14, globe: 0x2a2018, pupil: 0x0a0806 };
/** Mama's things */
const SHAWL = { rose: 0x9e4a40, roseD: 0x82392f, cream: 0xdccfae, creamD: 0xc4b68f, mustard: 0xc4943c };
const WIRE = { gold: 0xc9a254, dark: 0x8a6a2c };
const KNIT = [0xd0a040, 0xa8482c, 0xe4d6b4, 0x5a6e8a];

// ================================================================ posing
const rotX = (v: V3, a: number): V3 => {
  const c = Math.cos(a), s = Math.sin(a);
  return [v[0], v[1] * c - v[2] * s, v[1] * s + v[2] * c];
};
/**
 * The toad is sculpted in "toad space" (its natural sit). Mama's trunk is then
 * pitched back about her rump (`a` < 0 sits her up) and her head bowed forward
 * about the neck (`h` > 0), so her prims are placed and turned in rig space.
 */
class Pose {
  neckR: V3;
  constructor(public piv: V3, public a: number, public lift: number, neck: V3, public h: number) {
    this.cA = Math.cos(-a);
    this.sA = Math.sin(-a);
    this.cH = Math.cos(-h);
    this.sH = Math.sin(-h);
    this.neckR = this.trunk(neck);
  }
  trunk(v: V3): V3 {
    const r = rotX(sub3(v, this.piv), this.a);
    return [this.piv[0] + r[0], this.piv[1] + r[1] + this.lift, this.piv[2] + r[2]];
  }
  head(v: V3): V3 {
    return add3(this.neckR, rotX(sub3(this.trunk(v), this.neckR), this.h));
  }
  unTrunk(p: V3): V3 {
    const q: V3 = [p[0], p[1] - this.lift, p[2]];
    return add3(this.piv, rotX(sub3(q, this.piv), -this.a));
  }
  unHead(p: V3): V3 {
    return this.unTrunk(add3(this.neckR, rotX(sub3(p, this.neckR), -this.h)));
  }
  private cA: number;
  private sA: number;
  private cH: number;
  private sH: number;
  /** unTrunk / unHead into `out`, scaled by k (no allocation) */
  unTrunkInto(x: number, y: number, z: number, k: number, out: V3) {
    const ry = y - this.lift - this.piv[1], rz = z - this.piv[2];
    out[0] = x * k;
    out[1] = (ry * this.cA - rz * this.sA + this.piv[1]) * k;
    out[2] = (ry * this.sA + rz * this.cA + this.piv[2]) * k;
    return out;
  }
  unHeadInto(x: number, y: number, z: number, k: number, out: V3) {
    const vy = y - this.neckR[1], vz = z - this.neckR[2];
    return this.unTrunkInto(x, vy * this.cH - vz * this.sH + this.neckR[1], vy * this.sH + vz * this.cH + this.neckR[2], k, out);
  }
  /** a toad-space direction turned into rig space (trunk or head frame) */
  dir(d: V3, head = false): V3 {
    return rotX(d, this.a + (head ? this.h : 0));
  }
  prim(q: Prim, head = false): Prim {
    const f = (v: V3) => (head ? this.head(v) : this.trunk(v));
    const ang = this.a + (head ? this.h : 0);
    if (q.a && q.b) return { ...q, a: f(q.a), b: f(q.b) };
    const r = q.rot ?? [0, 0, 0];
    return { ...q, c: f(q.c!), rot: [r[0] + ang, r[1], r[2]] };
  }
}

// ================================================================ warts
interface Wart {
  c: V3;
  r: number;
  h: number;
  /** 0 none, 1 dark keratin tip, 2 pale tip */
  tip: number;
}
/** rounded tubercles on the skin, looked up through a spatial hash */
class WartField {
  list: Wart[] = [];
  private grid = new Map<number, number[]>();
  constructor(private cell: number) {}
  private key(x: number, y: number, z: number) {
    return ((Math.floor(x / this.cell) + 512) << 20) | ((Math.floor(y / this.cell) + 512) << 10) | (Math.floor(z / this.cell) + 512);
  }
  /** add unless it crowds a neighbour */
  add(w: Wart, spacing = 0.92) {
    const cx = Math.floor(w.c[0] / this.cell), cy = Math.floor(w.c[1] / this.cell), cz = Math.floor(w.c[2] / this.cell);
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++) {
          const ids = this.grid.get(((cx + dx + 512) << 20) | ((cy + dy + 512) << 10) | (cz + dz + 512));
          if (ids) for (const i of ids) {
            const o = this.list[i];
            if (Math.hypot(o.c[0] - w.c[0], o.c[1] - w.c[1], o.c[2] - w.c[2]) < (o.r + w.r) * spacing) return false;
          }
        }
    const k = this.key(w.c[0], w.c[1], w.c[2]);
    let ids = this.grid.get(k);
    if (!ids) this.grid.set(k, (ids = []));
    ids.push(this.list.length);
    this.list.push(w);
    return true;
  }
  /** raised height at p and how far up the dome p sits (0..1) */
  at(px: number, py: number, pz: number, out: { b: number; t: number; w: Wart | null }) {
    out.b = 0;
    out.t = 0;
    out.w = null;
    const cx = Math.floor(px / this.cell), cy = Math.floor(py / this.cell), cz = Math.floor(pz / this.cell);
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++) {
          const ids = this.grid.get(((cx + dx + 512) << 20) | ((cy + dy + 512) << 10) | (cz + dz + 512));
          if (!ids) continue;
          for (let i = 0; i < ids.length; i++) {
            const w = this.list[ids[i]];
            const ex = px - w.c[0], ey = py - w.c[1], ez = pz - w.c[2];
            const r2 = w.r * w.r, d2 = ex * ex + ey * ey + ez * ez;
            if (d2 >= r2) continue;
            const q = 1 - d2 / r2;
            const b = w.h * q * q;
            if (b > out.b) {
              out.b = b;
              out.t = q;
              out.w = w;
            }
          }
        }
    return out;
  }
}

// ================================================================ fast implicit field
/**
 * The smooth union of ellipsoids and tapered capsules (the same forms and
 * blending as the kit's blobSdf), packed flat and evaluated without allocating;
 * prims too far away to change the blend are skipped by their bounding sphere.
 */
class Field {
  private ell: { c: V3; R: number; m: number[]; r: V3; k: number }[] = [];
  private caps: { a: V3; ab: V3; L2: number; r0: number; r1: number; c: V3; R: number; k: number }[] = [];
  private order: number[] = [];
  lo: V3 = [1e9, 1e9, 1e9];
  hi: V3 = [-1e9, -1e9, -1e9];
  constructor(prims: Prim[], public k: number) {
    for (const q of prims) {
      const kk = q.k ?? k;
      if (q.a && q.b) {
        const ab = sub3(q.b, q.a);
        const r0 = q.r0 ?? 1, r1 = q.r1 ?? r0;
        const R = Math.hypot(ab[0], ab[1], ab[2]) / 2 + Math.max(r0, r1);
        this.order.push(-1 - this.caps.length);
        this.caps.push({ a: q.a, ab, L2: dot3(ab, ab) || 1e-6, r0, r1, c: lerp3(q.a, q.b, 0.5), R, k: kk });
        this.grow(lerp3(q.a, q.b, 0.5), R);
      } else {
        const e = q.rot ?? [0, 0, 0];
        const c0 = invXYZ([1, 0, 0], e), c1 = invXYZ([0, 1, 0], e), c2 = invXYZ([0, 0, 1], e);
        const R = Math.max(q.r![0], q.r![1], q.r![2]);
        this.order.push(this.ell.length);
        this.ell.push({ c: q.c!, R, m: [c0[0], c1[0], c2[0], c0[1], c1[1], c2[1], c0[2], c1[2], c2[2]], r: q.r!, k: kk });
        this.grow(q.c!, R);
      }
    }
  }
  private grow(c: V3, R: number) {
    for (let i = 0; i < 3; i++) {
      this.lo[i] = Math.min(this.lo[i], c[i] - R - this.k);
      this.hi[i] = Math.max(this.hi[i], c[i] + R + this.k);
    }
  }
  d(px: number, py: number, pz: number) {
    let d = 1e9;
    let first = true;
    for (let n = 0; n < this.order.length; n++) {
      const o = this.order[n];
      let di: number, kk: number;
      if (o >= 0) {
        const E = this.ell[o];
        const vx = px - E.c[0], vy = py - E.c[1], vz = pz - E.c[2];
        if (!first && Math.sqrt(vx * vx + vy * vy + vz * vz) - E.R * 1.15 - 0.5 > d + E.k) continue;
        const m = E.m;
        const lx = m[0] * vx + m[1] * vy + m[2] * vz, ly = m[3] * vx + m[4] * vy + m[5] * vz, lz = m[6] * vx + m[7] * vy + m[8] * vz;
        const ax = lx / E.r[0], ay = ly / E.r[1], az = lz / E.r[2];
        const k0 = Math.sqrt(ax * ax + ay * ay + az * az);
        const bx = ax / E.r[0], by = ay / E.r[1], bz = az / E.r[2];
        const k1 = Math.sqrt(bx * bx + by * by + bz * bz) || 1e-6;
        di = (k0 * (k0 - 1)) / k1;
        kk = E.k;
      } else {
        const C = this.caps[-1 - o];
        const cx = px - C.c[0], cy = py - C.c[1], cz = pz - C.c[2];
        if (!first && Math.sqrt(cx * cx + cy * cy + cz * cz) - C.R - 0.5 > d + C.k) continue;
        const ax = px - C.a[0], ay = py - C.a[1], az = pz - C.a[2];
        let t = (ax * C.ab[0] + ay * C.ab[1] + az * C.ab[2]) / C.L2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const qx = ax - C.ab[0] * t, qy = ay - C.ab[1] * t, qz = az - C.ab[2] * t;
        di = Math.sqrt(qx * qx + qy * qy + qz * qz) - (C.r0 + (C.r1 - C.r0) * t);
        kk = C.k;
      }
      if (first) {
        d = di;
        first = false;
      } else {
        const h = Math.max(kk - Math.abs(d - di), 0) / kk;
        d = Math.min(d, di) - h * h * kk * 0.25;
      }
    }
    return d;
  }
}
/**
 * Sculpt a field (plus a raising displacement) as a thick skin: blocks far
 * outside or deep inside are skipped, voxels deeper than `shell` are left out
 * (the parts are hollowed anyway) unless `deep` wants them kept.
 */
function sculpt(m: VoxelModel, F: Field, col: (x: number, y: number, z: number) => number | null, o: { disp?: (x: number, y: number, z: number) => number; shell?: number; deep?: (x: number, y: number, z: number) => boolean; fl?: number; floor?: number }) {
  const B = 4, half = 3.47, shell = o.shell ?? 5;
  const fy = o.floor ?? 0;
  for (let bx = Math.floor(F.lo[0] - 3); bx <= Math.ceil(F.hi[0] + 3); bx += B)
    for (let by = Math.max(fy, Math.floor(F.lo[1] - 3)); by <= Math.ceil(F.hi[1] + 3); by += B)
      for (let bz = Math.floor(F.lo[2] - 3); bz <= Math.ceil(F.hi[2] + 3); bz += B) {
        const dc = F.d(bx + B / 2, by + B / 2, bz + B / 2);
        if (dc > half + 3.2) continue;
        const deepOk = o.deep ? o.deep(bx + B / 2, by + B / 2, bz + B / 2) : false;
        if (dc < -(half + shell + 0.6) && !deepOk) continue;
        for (let i = bx; i < bx + B; i++)
          for (let j = by; j < by + B; j++)
            for (let k = bz; k < bz + B; k++) {
              const d0 = F.d(i + 0.5, j + 0.5, k + 0.5);
              if (d0 > 2.6) continue;
              if (d0 < -shell && !(deepOk && o.deep!(i + 0.5, j + 0.5, k + 0.5))) continue;
              if (o.disp && d0 + o.disp(i + 0.5, j + 0.5, k + 0.5) > 0) continue;
              if (!o.disp && d0 > 0) continue;
              const c = col(i, j, k);
              if (c !== null) m.set(i, j, k, c, o.fl);
            }
      }
  return m;
}

// ================================================================ the toad
interface ToadCfg {
  name: string;
  vs: number;
  /** snout-vent length in voxels */
  svl: number;
  pal: ToadPal;
  /** eye radius in toad units (SVL = 100) */
  eyeT: number;
  mama: boolean;
  seed: number;
  /** smallest wart radius (voxels) */
  wartMin: number;
  /** wart size multiplier (juveniles: bigger relative warts, fewer of them) */
  wartK: number;
}

function toad(cfg: ToadCfg): RigSpec {
  const { pal, seed, mama } = cfg;
  const s = cfg.svl / 100;
  const T = (x: number, y: number, z: number): V3 => [x * s, y * s, z * s];
  const rig = new CRig(cfg.name, cfg.vs);
  const hs = (k: number) => h01(k * 7.13, seed * 3.1, k * 0.37 + seed);

  // ---------------------------------------------------------------- pose
  const PIV = T(0, 4, -40), NECK = T(0, 30, 14);
  const A = mama ? -0.45 : 0, H = mama ? 0.36 : 0;
  // ---------------------------------------------------------------- the forms (toad space, T units)
  const trunkT: Prim[] = [
    { c: T(0, 21, -16), r: T(33, 16.5, 30), rot: [-0.28, 0, 0] }, // main body
    { c: T(0, 12, -19), r: T(34, 11, 26) }, // belly sagging onto the ground
    { c: T(0, 25.5, 6), r: T(27, 14, 16), rot: [-0.35, 0, 0] }, // chest and shoulders
    { c: T(0, 30.5, -27), r: T(17, 9, 12), rot: [-0.2, 0, 0] }, // sacral hump
    { c: T(17, 17, -12), r: T(15, 11, 22) }, // flanks
    { c: T(-17, 17, -12), r: T(15, 11, 22) },
  ];
  const headT: Prim[] = [
    { c: T(0, 31.5, 24), r: T(22.5, 10.5, 17), rot: [-0.12, 0, 0] }, // broad flat skull
    { c: T(0, 29.5, 37), r: T(15.5, 8, 10.5), rot: [0.12, 0, 0] }, // blunt snout
    { c: T(0, 25.5, 21), r: T(23.5, 8.5, 14) }, // jaws and cheeks
  ];
  const glands: Prim[] = [];
  for (const sx of [1, -1]) {
    headT.push({ c: T(sx * 12.6, 40.6, 23.5), r: T(7.6, 4.4, 9.6), rot: [0.05, sx * 0.25, 0] }); // heavy hooded upper lid
    // cranial crests: a ridge inside each eye, bending back behind it
    headT.push({ a: T(sx * 6.5, 40.2, 35), b: T(sx * 8.6, 41.4, 26), r0: 1.5 * s, r1: 1.9 * s, k: 1.6 * s });
    headT.push({ a: T(sx * 8.6, 41.4, 26), b: T(sx * 12.8, 40, 17), r0: 1.8 * s, r1: 1.4 * s, k: 1.6 * s });
    // kidney-shaped parotoid glands behind the eyes
    glands.push({ c: T(sx * 15.6, 38.6, 8.5), r: T(7, 5.2, 10.5), rot: [-0.12, sx * 0.32, 0], k: 2.2 * s });
    glands.push({ c: T(sx * 18, 36.6, -1), r: T(6, 4.6, 7.5), rot: [-0.08, sx * 0.46, 0], k: 2.2 * s });
  }
  const mouthY = (z: number) => 25.3 + Math.max(0, z - 15) * 0.05; // T units, head space
  const EYE_T: V3 = [14.6, 38.6, 25.6];

  // pitch Mama back into the chair, then lift her so the rump sits on the seat
  let pose = new Pose(PIV, A, 0, NECK, H);
  if (mama) {
    let lo = 1e9;
    for (const q of trunkT) {
      for (let i = 0; i < 160; i++) {
        const yv = 1 - (2 * (i + 0.5)) / 160, rr = Math.sqrt(1 - yv * yv), th = i * 2.399963;
        const p = pose.prim(q);
        const l: V3 = [Math.cos(th) * rr * p.r![0], yv * p.r![1], Math.sin(th) * rr * p.r![2]];
        // rotate by the prim's pitch (it only has X rotation here)
        const w = rotX(l, p.rot![0]);
        lo = Math.min(lo, p.c![1] + w[1]);
      }
    }
    pose = new Pose(PIV, A, -lo + 0.6, NECK, H);
  }
  const trunk = trunkT.map((q) => pose.prim(q));
  const head = [...headT, ...glands].map((q) => pose.prim(q, true));
  const all = [...trunk, ...head];
  const K = 6.5 * s;
  const F = new Field(all, K);
  const sdf0 = (p: V3) => F.d(p[0], p[1], p[2]);
  const eyeL = pose.head(T(EYE_T[0], EYE_T[1], EYE_T[2])), eyeR: V3 = [-eyeL[0], eyeL[1], eyeL[2]];
  const eR = cfg.eyeT * s;
  const toT = (p: V3): V3 => [p[0] / s, p[1] / s, p[2] / s];
  /** toad-space (T units) coordinates of a rig-space point, and whether it is head */
  const QR: V3 = [0, 0, 0], RG = { q: QR, head: false };
  /** fills a shared scratch: use the result before the next call */
  const region = (p: V3) => regionAt(p[0], p[1], p[2]);
  const regionAt = (x: number, y: number, z: number) => {
    pose.unHeadInto(x, y, z, 1 / s, QR);
    RG.head = QR[2] > 15;
    if (!RG.head) pose.unTrunkInto(x, y, z, 1 / s, QR);
    return RG;
  };
  const inGland = (q: V3) => {
    for (const sx of [1, -1]) {
      const a = Math.hypot((q[0] - sx * 15.6) / 7.6, (q[1] - 38.6) / 5.8, (q[2] - 8.5) / 11.3);
      const b = Math.hypot((q[0] - sx * 18) / 6.6, (q[1] - 36.6) / 5.2, (q[2] + 1) / 8.2);
      if (Math.min(a, b) < 1) return true;
    }
    return false;
  };
  const nearEye = (q: V3, pad: number) => Math.hypot(Math.abs(q[0]) - EYE_T[0], q[1] - EYE_T[1], q[2] - EYE_T[2]) < cfg.eyeT + pad;
  const TYMP: V3 = [19.8, 33.6, 17.2];
  const nearTymp = (q: V3, r: number) => Math.hypot(Math.abs(q[0]) - TYMP[0], q[1] - TYMP[1], q[2] - TYMP[2]) < r;
  const tympL = pose.head(T(TYMP[0], TYMP[1], TYMP[2])), tympR: V3 = [-tympL[0], tympL[1], tympL[2]];

  // ---------------------------------------------------------------- warts over the body and head
  const warts = new WartField(Math.max(3, 4.5 * s));
  const nrmAt = (f: (p: V3) => number, p: V3): V3 => {
    const e = 0.6;
    return norm3([f([p[0] + e, p[1], p[2]]) - f([p[0] - e, p[1], p[2]]), f([p[0], p[1] + e, p[2]]) - f([p[0], p[1] - e, p[2]]), f([p[0], p[1], p[2] + e]) - f([p[0], p[1], p[2] - e])]);
  };
  const anchors: [V3, number][] = [
    [pose.trunk(T(0, 22, -16)), 900],
    [pose.trunk(T(0, 24, -32)), 360],
    [pose.trunk(T(0, 26, 4)), 420],
    [pose.head(T(0, 31, 26)), 520],
  ];
  let wi = 0;
  for (const [o, n] of anchors)
    for (let i = 0; i < n; i++, wi++) {
      const yv = 1 - (2 * (i + 0.5)) / n, rr = Math.sqrt(1 - yv * yv), th = i * 2.399963 + wi * 0.31;
      const d: V3 = [Math.cos(th) * rr, yv, Math.sin(th) * rr];
      let p: V3 | null = null;
      for (let t = 0; t < 70 * s + 20; ) {
        const q = add3(o, scl3(d, t));
        const dq = sdf0(q);
        if (dq > 0) {
          p = q;
          break;
        }
        t += Math.max(0.35, -dq * 0.6);
      }
      if (!p || p[1] < 1.2) continue;
      const { q, head: hd } = region(p);
      if (nearEye(q, 2.6) || inGland(q) || nearTymp(q, 4.2)) continue;
      if (q[2] > 41) continue; // the snout tip stays smooth
      if (q[2] > 13 && Math.abs(q[1] - mouthY(q[2])) < 2.6) continue; // the lips
      const nT = norm3(rotX(nrmAt(sdf0, p), -(pose.a + (hd ? pose.h : 0))));
      const pale = q[1] < 12.5 + Math.max(0, (q[2] + 4) * 0.3);
      const k = hs(wi);
      let r: number;
      if (pale) {
        if (k > 0.35) continue; // a few soft granules on the belly
        r = 1.0 + k;
      } else if (hd) r = 1.0 + 1.0 * k;
      else if (nT[1] > 0.4) r = 2.1 + 1.7 * k;
      else r = 1.6 + 1.3 * k;
      r *= cfg.wartK;
      const rv = Math.max(cfg.wartMin, r * s);
      const hv = Math.min(2.3, rv * (0.48 + 0.22 * hs(wi + 7)));
      const tk = hs(wi + 3);
      warts.add({ c: p, r: rv, h: hv, tip: pale ? 0 : tk > 0.5 ? 1 : tk > 0.3 ? 2 : 0 });
    }

  // ---------------------------------------------------------------- skin colour
  const W = { b: 0, t: 0, w: null as Wart | null };
  const jit = (c: number, x: number, y: number, z: number, a = 0.045) => mulc(c, 1 + (h01(x, y, z, seed) - 0.5) * 2 * a);
  const segDist = (p: V3, a: V3, b: V3) => {
    const ab = sub3(b, a), ap = sub3(p, a);
    const t = clamp01(dot3(ap, ab) / dot3(ab, ab));
    return Math.hypot(ap[0] - ab[0] * t, ap[1] - ab[1] * t, ap[2] - ab[2] * t);
  };
  const dorsal = (q: V3, x: number, y: number, z: number) => {
    const f = 1 / 7.5;
    const n1 = n01(q[0] * 0.85, q[1], q[2], f, seed);
    let c = pal.base;
    if (n1 > 0.655) c = pal.dark;
    else if (n1 > 0.625) c = pal.rim;
    else if (n01(q[0] + 40, q[1], q[2], 1 / 11, seed + 3) > 0.67) c = pal.light;
    // the faint pale line down the spine
    if (Math.abs(q[0]) < 1.1 && q[1] > 27 && q[2] < 30 && q[2] > -34 && n01(q[0], q[1], q[2], 1 / 6, seed + 9) > 0.36) c = pal.stripe;
    // the dark band from the eye back through the tympanum
    const ax = Math.abs(q[0]);
    if (segDist([ax, q[1], q[2]], [16.5, 35.8, 21], [22, 28.5, 5]) < 2.3 + n01(q[0], q[1], q[2], 0.3, seed) * 0.8) c = pal.band;
    return jit(c, x, y, z);
  };
  const skin = (x: number, y: number, z: number): number | null => {
    const { q, head: hd } = regionAt(x + 0.5, y + 0.5, z + 0.5);
    warts.at(x + 0.5, y + 0.5, z + 0.5, W);
    const warp = (n01(q[0], q[1], q[2], 1 / 5, seed + 1) - 0.5) * 4;
    // belly and throat: pale cream, grey speckles, a few dark spots
    const paleTop = hd ? mouthY(q[2]) - 5.5 : 12.5 + Math.max(0, Math.min(8, (q[2] + 4) * 0.3));
    if (q[1] + warp < paleTop) {
      let c = hd ? pal.throat : pal.belly;
      if (h01(x, y, z, seed + 5) > 0.9) c = pal.speck;
      else if (n01(q[0], q[1], q[2], 1 / 3.2, seed + 6) > 0.74) c = mixc(c, pal.speck, 0.6);
      if (W.w && W.t > 0.5) c = mulc(c, 1.05);
      return jit(c, x, y, z, 0.03);
    }
    // the lips
    if (hd && q[2] > 14 && Math.abs(q[1] - mouthY(q[2])) < 1.5) return jit(mixc(pal.belly, pal.flank, 0.45), x, y, z, 0.03);
    // warts: a lighter dome, a keratin tip
    if (W.w) {
      if (W.t > 0.7 && W.w.tip === 1) return jit(pal.tipDark, x, y, z, 0.06);
      if (W.t > 0.72 && W.w.tip === 2) return jit(pal.tipLight, x, y, z, 0.04);
      if (W.t > 0.18) {
        const under = q[1] + warp < paleTop + 6;
        return jit(mixc(under ? pal.flank : dorsal(q, x, y, z), pal.wart, 0.55), x, y, z, 0.04);
      }
    }
    // the parotoids: smooth, a touch lighter, peppered with pores
    if (inGland(q)) return h01(x * 3, y * 5, z * 7, seed) > 0.87 ? jit(pal.rim, x, y, z) : jit(mixc(pal.parotoid, dorsal(q, x, y, z), 0.25), x, y, z, 0.03);
    // flanks fade from the mottled back to the pale belly
    const fl = sstep(paleTop + 7, paleTop, q[1] + warp);
    if (fl > 0.02) return jit(mixc(dorsal(q, x, y, z), pal.flank, fl * 0.85), x, y, z);
    return dorsal(q, x, y, z);
  };
  const fineF = 1 / Math.max(2.5, 5 * s);
  const fine = (x: number, y: number, z: number) => (n01(x, y, z, fineF, seed + 2) - 0.5) * 0.7;
  const disp = (x: number, y: number, z: number) => {
    warts.at(x, y, z, W);
    return -W.b + fine(x, y, z);
  };

  // ---------------------------------------------------------------- sculpt the mass
  const mass = new VoxelModel('mass');
  // the mouth cavity is carved out of the solid, so keep the solid around it
  const cav = (q: V3, k = 1) => Math.hypot(q[0] / (17 * k), (q[1] - mouthY(30) + 0.4) / (4.2 * k), (q[2] - 31) / (13 * k)) < 1;
  sculpt(mass, F, skin, { disp, shell: 5, deep: (x, y, z) => cav(toT(pose.unHead([x, y, z])), 1.5) });
  const depth = (p: V3) => sdf0(p) + disp(p[0], p[1], p[2]);

  // the mouth: a cavity behind a 2-voxel skin (palate, floor, a fat tongue), a slit along the lip line
  const del: V3[] = [];
  const QM: V3 = [0, 0, 0];
  mass.forEach((x, y, z) => {
    const p: V3 = [x + 0.5, y + 0.5, z + 0.5];
    const qh = pose.unHeadInto(p[0], p[1], p[2], 1 / s, QM);
    if (qh[2] < 15.5) return;
    if (cav(qh) && depth(p) < -2.1) del.push([x, y, z]);
    else if (qh[2] > 16.5 && Math.abs(qh[1] - mouthY(qh[2])) < 0.55 / s && depth(p) > -2.6) del.push([x, y, z]);
  });
  for (const [x, y, z] of del) mass.del(x, y, z);
  // nostrils
  for (const sx of [1, -1]) {
    const n = pose.head(T(sx * 3.4, 34.2, 45.2));
    const d = pose.dir(norm3([sx * 0.25, 0.45, 0.86]), true);
    for (let t = 6; t > -6; t -= 0.4) {
      const p = add3(n, scl3(d, t));
      const xi = Math.floor(p[0]), yi = Math.floor(p[1]), zi = Math.floor(p[2]);
      if (mass.has(xi, yi, zi)) {
        mass.del(xi, yi, zi);
        const b = sub3(p, d);
        mass.set(Math.floor(b[0]), Math.floor(b[1]), Math.floor(b[2]), 0x241a12);
        break;
      }
    }
  }
  // tympanum: a smooth disc with a raised pale rim, behind each eye
  const tr = 3.3 * s;
  paint(mass, (x, y, z) => {
    const t = x + 0.5 > 0 ? tympL : tympR;
    if (Math.abs(x + 0.5 - t[0]) > tr || Math.abs(y + 0.5 - t[1]) > tr || Math.abs(z + 0.5 - t[2]) > tr) return false;
    if (!exposed(mass, x, y, z)) return false;
    return nearTymp(region([x + 0.5, y + 0.5, z + 0.5]).q, 3.3);
  }, (x, y, z) => {
    const { q } = region([x + 0.5, y + 0.5, z + 0.5]);
    const d = Math.hypot(Math.abs(q[0]) - TYMP[0], q[1] - TYMP[1], q[2] - TYMP[2]);
    return d > 2.5 ? jit(mixc(pal.flank, pal.light, 0.4), x, y, z, 0.03) : jit(mixc(pal.dark, pal.base, 0.45), x, y, z, 0.03);
  });

  // ---------------------------------------------------------------- split the mass into parts
  const pBody = pose.trunk(T(0, 18, -16));
  const body = rig.part('body', undefined, pBody);
  const pHead = pose.trunk(T(0, 30, 14));
  const headM = rig.part('head', 'body', pHead);
  const pJaw = pose.head(T(0, 26.6, 15.5));
  const jaw = rig.part('jaw', 'head', pJaw);
  const pThroat = pose.head(T(0, 20.5, 29));
  const throat = rig.part('throat', 'jaw', pThroat);
  const belly = rig.part('belly', 'body', pose.trunk(T(0, 7, -16)));
  const inThroat = (q: V3) => Math.hypot(q[0] / 15.5, (q[1] - 20.5) / 6.5, (q[2] - 30) / 12.5) < 1 && q[1] < mouthY(q[2]) - 4.5;
  mass.forEach((x, y, z, c, f) => {
    const qh = pose.unHeadInto(x + 0.5, y + 0.5, z + 0.5, 1 / s, QM);
    if (qh[2] > 15) {
      if (inThroat(qh)) throat.set(x, y, z, c, f);
      else if (qh[1] < mouthY(qh[2]) + 0.2) jaw.set(x, y, z, c, f);
      else headM.set(x, y, z, c, f);
      // hidden plug across the neck so a nod never opens a crack
      if (qh[2] < 18.5 && !exposed(mass, x, y, z)) body.set(x, y, z, c, f);
      return;
    }
    const qhz = qh[2];
    const qt = pose.unTrunkInto(x + 0.5, y + 0.5, z + 0.5, 1 / s, QM);
    if (qt[1] < 9 && Math.abs(qt[0]) < 29 && qt[2] > -36 && qt[2] < 8) belly.set(x, y, z, c, f);
    else body.set(x, y, z, c, f);
    if (qhz > 12 && !exposed(mass, x, y, z)) headM.set(x, y, z, c, f);
  });
  // paint the mouth inside (the faces that look into the cavity)
  const QC: V3 = [0, 0, 0];
  const N6: V3[] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  const facesCav = (m: VoxelModel, x: number, y: number, z: number) => {
    if (!cav(pose.unHeadInto(x + 0.5, y + 0.5, z + 0.5, 1 / s, QC), 1.4)) return false;
    for (const [dx, dy, dz] of N6) {
      if (mass.has(x + dx, y + dy, z + dz) || m.has(x + dx, y + dy, z + dz)) continue;
      if (cav(pose.unHeadInto(x + dx + 0.5, y + dy + 0.5, z + dz + 0.5, 1 / s, QC), 1.12)) return true;
    }
    return false;
  };
  paint(headM, (x, y, z) => facesCav(headM, x, y, z), (x, y, z) => (toT(pose.unHead([x + 0.5, y + 0.5, z + 0.5]))[2] < 22 ? MOUTH.deep : (z & 1) && (y & 1) ? mulc(MOUTH.palate, 0.88) : MOUTH.palate));
  paint(jaw, (x, y, z) => facesCav(jaw, x, y, z), (x, y, z) => (toT(pose.unHead([x + 0.5, y + 0.5, z + 0.5]))[2] < 22 ? MOUTH.deep : MOUTH.floor));
  {
    const tc = pose.head(T(0, mouthY(32) - 3.4, 32));
    ell(jaw, tc, [8.5 * s, Math.max(1.2, 1.9 * s), 9 * s], (x, y, z) => (h01(x, y, z, 4) > 0.8 ? mulc(MOUTH.tongue, 1.08) : MOUTH.tongue), { under: true, rot: [pose.a + pose.h, 0, 0], keep: (_a, _b, _c, x, y, z) => cav(toT(pose.unHead([x + 0.5, y + 0.5, z + 0.5])), 1.05) });
  }
  // eye sockets
  for (const e of [eyeL, eyeR]) ell(headM, e, [eR * 0.97, eR * 0.97, eR * 0.97], 0, { carve: true });

  // ---------------------------------------------------------------- golden eyes with horizontal pupils
  const gazeT = norm3([0.74, 0.3, 0.6]);
  const gaze = norm3(pose.dir(gazeT, true));
  const toadEye = (m: VoxelModel, c: V3, f: V3) => {
    const e1 = norm3(cross3([0, 1, 0], f)); // horizontal across the eye
    const e2 = cross3(f, e1); // up across the eye
    ell(m, c, [eR, eR, eR], (x, y, z) => {
      const v: V3 = [x + 0.5 - c[0], y + 0.5 - c[1], z + 0.5 - c[2]];
      const l = Math.hypot(v[0], v[1], v[2]) || 1;
      const along = dot3(v, f) / l;
      if (along < 0.3) return EYE.globe;
      const u = dot3(v, e1) / eR, w = dot3(v, e2) / eR;
      const rho = Math.hypot(u, w);
      if (rho > 0.9) return EYE.limbus;
      if ((u / 0.52) ** 2 + ((w + 0.02) / 0.22) ** 2 < 1) return EYE.pupil;
      // dark reticulations through the gold
      const nv = n01(v[0] * 1.6 / Math.max(1, eR / 3), v[1] * 1.6 / Math.max(1, eR / 3), v[2] * 1.6 / Math.max(1, eR / 3), 0.55, seed + 11);
      if (Math.abs(nv - 0.5) < 0.045 && rho > 0.32) return EYE.vein;
      if (rho > 0.8) return EYE.goldLo;
      if (w > 0.42) return mixc(EYE.gold, EYE.goldLo, 0.55); // shaded under the hooded lid
      return w < -0.25 ? EYE.goldHi : EYE.gold;
    }, { fl: VF.METAL });
    // catchlights (the same corner on both eyes)
    const hl = norm3(add3(add3(f, [0, 0.62, 0]), [0.22, 0, 0.3]));
    const best = { v: null as V3 | null, s: -1e9 };
    m.forEach((x, y, z) => {
      const v: V3 = [x + 0.5 - c[0], y + 0.5 - c[1], z + 0.5 - c[2]];
      if (Math.hypot(v[0], v[1], v[2]) > eR + 0.6 || !exposed(m, x, y, z)) return;
      const sc = dot3(v, hl);
      if (sc > best.s) {
        best.s = sc;
        best.v = [x, y, z];
      }
    });
    if (best.v) {
      const b = best.v;
      m.set(b[0], b[1], b[2], 0xffffff, VF.SOFTAO);
      if (eR > 3.2 && m.has(b[0], b[1] - 1, b[2])) m.set(b[0], b[1] - 1, b[2], 0xf4f0e6, VF.SOFTAO);
    }
  };
  toadEye(rig.part('eye_l', 'head', eyeL), eyeL, gaze);
  const gazeR: V3 = [-gaze[0], gaze[1], gaze[2]];
  toadEye(rig.part('eye_r', 'head', eyeR), eyeR, gazeR);
  // lower lids: a skin cap under each globe; blinking sweeps it up over the eye
  const ldT = norm3([0.3, -1, 0.42]);
  const ld = norm3(pose.dir(ldT, true));
  const lidCap = (m: VoxelModel, c: V3, axis: V3) => {
    const r0 = eR * 1.04 + 0.25, r1 = r0 + Math.max(1.15, eR * 0.24);
    const ch = Math.cos(1.08), chr = Math.cos(1.08 - Math.max(0.12, 1.2 / r1));
    const B = Math.ceil(r1) + 1;
    for (let i = Math.floor(c[0] - B); i <= Math.ceil(c[0] + B); i++)
      for (let j = Math.floor(c[1] - B); j <= Math.ceil(c[1] + B); j++)
        for (let k = Math.floor(c[2] - B); k <= Math.ceil(c[2] + B); k++) {
          const v: V3 = [i + 0.5 - c[0], j + 0.5 - c[1], k + 0.5 - c[2]];
          const l = Math.hypot(v[0], v[1], v[2]);
          if (l < r0 || l > r1) continue;
          const ca = dot3(v, axis) / l;
          if (ca < ch) continue;
          m.set(i, j, k, ca < chr ? jit(pal.rim, i, j, k, 0.04) : jit(n01(i, j, k, 0.5, seed) > 0.6 ? mixc(pal.lid, pal.light, 0.4) : pal.lid, i, j, k, 0.04));
        }
  };
  lidCap(rig.part('lid_l', 'head', eyeL), eyeL, ld);
  const ldR: V3 = [-ld[0], ld[1], ld[2]];
  lidCap(rig.part('lid_r', 'head', eyeR), eyeR, ldR);
  const blinkL = norm3(cross3(ld, gaze)), blinkR = norm3(cross3(ldR, gazeR));
  const blinkClose = Math.acos(clamp01(dot3(ld, gaze))) * 0.92;

  // ---------------------------------------------------------------- limbs
  const legCol = (a: V3, b: V3, bars: number, rr: number) => (x: number, y: number, z: number) => {
    const p: V3 = [x + 0.5, y + 0.5, z + 0.5];
    warts.at(p[0], p[1], p[2], W);
    const ab = sub3(b, a);
    const t = clamp01(dot3(sub3(p, a), ab) / dot3(ab, ab));
    const ax = add3(a, scl3(ab, t));
    const below = p[1] - ax[1] < -rr * 0.3;
    if (below) return jit(mixc(pal.legUnder, pal.belly, 0.3), x, y, z, 0.04);
    if (W.w && W.t > 0.7 && W.w.tip === 1) return jit(pal.tipDark, x, y, z);
    let c = Math.sin((t * bars + 0.25) * Math.PI * 2 + n01(x, y, z, 0.3, seed) * 1.2) > 0.45 ? pal.dark : n01(x, y, z, 1 / (4 * s + 1), seed + 7) > 0.64 ? pal.light : pal.base;
    if (W.w && W.t > 0.18) c = mixc(c, pal.wart, 0.5);
    return jit(c, x, y, z);
  };
  const limbWarts = (a: V3, b: V3, r0: number, r1: number, n: number, rT: [number, number], sd: number) => {
    const ax = norm3(sub3(b, a));
    const e1 = norm3(cross3(Math.abs(ax[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0], ax)), e2 = cross3(ax, e1);
    for (let i = 0; i < n; i++) {
      const t = 0.1 + 0.8 * hs(sd + i * 3), ph = hs(sd + i * 3 + 1) * Math.PI * 2;
      const d = add3(scl3(e1, Math.cos(ph)), scl3(e2, Math.sin(ph)));
      if (d[1] < -0.35) continue;
      const r = r0 + (r1 - r0) * t;
      const c = add3(add3(a, scl3(sub3(b, a), t)), scl3(d, r));
      const rv = Math.max(cfg.wartMin, (rT[0] + (rT[1] - rT[0]) * hs(sd + i * 3 + 2)) * s * cfg.wartK);
      warts.add({ c, r: rv, h: Math.min(2.2, rv * 0.5), tip: hs(sd + i * 7) > 0.55 ? 1 : 0 });
    }
  };
  const limbDisp = (x: number, y: number, z: number) => {
    warts.at(x, y, z, W);
    return -W.b + fine(x, y, z) * 0.6;
  };
  const sculptLimb = (m: VoxelModel, prims: Prim[], col: (x: number, y: number, z: number) => number, k = 1.6 * s) => sculpt(m, new Field(prims, k), col, { disp: limbDisp, shell: 4 });
  /** a hand of four in-turned fingers with knobbly tubercle tips */
  const fingers = (m: VoxelModel, base: V3, list: { dir: V3; len: number; up?: number }[], r0: number, r1: number) => {
    list.forEach(({ dir, len, up = 0 }, i) => {
      const d = norm3(dir);
      const mid = add3(add3(base, scl3(d, len * 0.55)), [0, up + 0.45 * s, 0]);
      const tip = add3(add3(base, scl3(d, len)), [0, up * 0.6, 0]);
      tube(m, [base, mid, tip], [r0, (r0 + r1) / 2, r1], (x, y, z) => jit(mixc(pal.base, pal.light, 0.3 + 0.2 * (i & 1)), x, y, z));
      ell(m, tip, [r1 * 1.25, r1 * 1.1, r1 * 1.25], (x, y, z) => jit(y + 0.5 < tip[1] ? pal.tipDark : mixc(pal.light, pal.tipLight, 0.4), x, y, z, 0.03));
    });
  };

  // ---- front legs
  const SH = pose.trunk(T(19, 20, 12));
  let EL: V3, WR: V3, HAND: V3;
  if (mama) {
    EL = add3(SH, T(6, -9, 5));
    WR = add3(SH, T(-9, -4.5, 13));
    HAND = add3(SH, T(-12.5, -3.2, 15.2));
  } else {
    EL = T(25.5, 12.5, 8.5);
    WR = T(21, 3.4, 22);
    HAND = T(20.4, 1.7, 25);
  }
  limbWarts(SH, EL, 5.5 * s, 4.5 * s, Math.round(14 + 6 * s), [1.4, 2.4], 101);
  limbWarts(EL, WR, 4.6 * s, 3.4 * s, Math.round(12 + 6 * s), [1.2, 2.1], 151);
  const armL = rig.part('arm_l', 'body', SH);
  sculptLimb(armL, [{ a: SH, b: EL, r0: 5.6 * s, r1: 4.5 * s }, { c: lerp3(SH, EL, 0.4), r: T(5.8, 5.2, 5.8) }], legCol(SH, EL, 1.2, 5 * s));
  const foreL = rig.part('fore_l', 'arm_l', EL);
  sculptLimb(foreL, [{ a: EL, b: WR, r0: 4.6 * s, r1: 3.4 * s }, { c: lerp3(EL, WR, 0.3), r: T(4.8, 4.6, 4.8) }, { c: HAND, r: T(4.4, 1.9, 4) }], legCol(EL, WR, 1.6, 4 * s));
  if (mama) {
    // hands round the needle: four short fingers curled over it
    const hd = norm3(sub3(HAND, WR)), side = norm3(cross3(hd, [0, 1, 0])), up = cross3(side, hd);
    for (let k = 0; k < 4; k++) {
      const b = add3(add3(HAND, scl3(hd, 2.4 * s)), scl3(side, (k - 1.5) * 1.75 * s));
      const m1 = add3(add3(b, scl3(hd, 1.8 * s)), scl3(up, 2.3 * s));
      const t1 = add3(add3(m1, scl3(hd, -1.0 * s)), scl3(up, 0.7 * s));
      tube(foreL, [b, m1, t1], [1.25 * s, 1.1 * s, 0.95 * s], (x, y, z) => jit(mixc(pal.base, pal.light, 0.35), x, y, z));
      ell(foreL, t1, [1.2 * s, 1.1 * s, 1.2 * s], (x, y, z) => jit(pal.tipDark, x, y, z, 0.03));
    }
  } else {
    const r0 = Math.max(0.9, 1.3 * s), r1 = Math.max(0.75, 1.0 * s);
    fingers(foreL, add3(HAND, T(0, 0, 1.5)), [
      { dir: [-0.62, 0, 0.78], len: 5.6 * s },
      { dir: [-0.28, 0, 0.96], len: 7.6 * s },
      { dir: [0.08, 0, 1], len: 7.0 * s },
      { dir: [0.42, 0, 0.9], len: 5.0 * s },
    ], r0, r1);
  }

  // ---- hind legs folded beside the body
  const HIP = pose.trunk(T(15, 12, -36));
  let KN: V3, AN: V3, MT: V3;
  if (mama) {
    KN = [HIP[0] + 15 * s, Math.max(9 * s, HIP[1] - 2 * s), HIP[2] + 27 * s];
    AN = [KN[0] - 3 * s, 5.4 * s, KN[2] - 27 * s];
    MT = [AN[0] + 4.5 * s, 2.7 * s, AN[2] + 15 * s];
  } else {
    KN = T(30, 13, -10);
    AN = T(27, 5.4, -38);
    MT = T(31.5, 2.7, -23);
  }
  limbWarts(HIP, KN, 9.5 * s, 6.4 * s, Math.round(30 + 10 * s), [1.6, 3.0], 201);
  limbWarts(KN, AN, 6 * s, 3.8 * s, Math.round(22 + 8 * s), [1.3, 2.4], 251);
  const thighL = rig.part('thigh_l', 'body', HIP);
  sculptLimb(thighL, [{ a: HIP, b: KN, r0: 9.6 * s, r1: 6.3 * s }, { c: lerp3(HIP, KN, 0.42), r: T(10.4, 8.6, 11) }], legCol(HIP, KN, 1.8, 8 * s), 2.4 * s);
  const shinL = rig.part('shin_l', 'thigh_l', KN);
  sculptLimb(shinL, [{ a: KN, b: AN, r0: 6 * s, r1: 3.8 * s }, { c: lerp3(KN, AN, 0.3), r: T(6.4, 6, 7.4) }], legCol(KN, AN, 2.2, 5 * s), 2 * s);
  const footL = rig.part('foot_l', 'shin_l', AN);
  sculptLimb(footL, [{ a: AN, b: MT, r0: 3.6 * s, r1: 2.6 * s }], legCol(AN, MT, 1, 3 * s), 1.2 * s);
  {
    // five long toes splayed forward, the fourth the longest, webbed at the base
    const toes: [number, number][] = [[-0.5, 6.4], [-0.2, 9], [0.1, 11.6], [0.4, 14], [0.74, 8.6]];
    const r0 = Math.max(0.9, 1.5 * s), r1 = Math.max(0.75, 1.05 * s);
    const lst = toes.map(([a, l]) => ({ dir: [Math.sin(a), 0, Math.cos(a)] as V3, len: l * s, up: -0.4 * s }));
    fingers(footL, add3(MT, T(0, -0.5, 0)), lst, r0, r1);
    for (let i = 0; i < toes.length - 1; i++) {
      const a = (toes[i][0] + toes[i + 1][0]) / 2, l = Math.min(toes[i][1], toes[i + 1][1]) * 0.42 * s;
      const c = add3(MT, [Math.sin(a) * l, -0.6 * s, Math.cos(a) * l]);
      ell(footL, c, [Math.max(1, 2.2 * s), Math.max(0.55, 0.55 * s), l * 0.75], (x, y, z) => jit(mixc(pal.base, pal.legUnder, 0.35), x, y, z, 0.03), { rot: [0, a, 0], under: true, keep: (_a, _b, _c, _x, y) => y >= 0 });
    }
  }
  rig.mirror('arm_l', 'arm_r');
  rig.mirror('fore_l', 'fore_r', 'arm_r');
  rig.mirror('thigh_l', 'thigh_r');
  rig.mirror('shin_l', 'shin_r', 'thigh_r');
  rig.mirror('foot_l', 'foot_r', 'shin_r');

  // ---------------------------------------------------------------- Mama's things
  const meta: Record<string, unknown> = {};
  let topY = 0;
  if (mama) {
    // ---- the needles: polished birch, a walnut knob with a brass cap; crossed over the work
    const hd = norm3(sub3(HAND, WR)), side = norm3(cross3(hd, [0, 1, 0])), up = cross3(side, hd);
    const G = add3(add3(HAND, scl3(hd, 3.3 * s)), scl3(up, 1.4 * s));
    const dN = norm3([-0.62, 0.56, 0.54]);
    const tip = add3(G, scl3(dN, 19 * s)), butt = add3(G, scl3(dN, -10 * s));
    const nr = Math.max(0.62, 0.8 * s);
    const needle = (m: VoxelModel) => {
      tube(m, [butt, tip], [nr, Math.max(0.5, nr * 0.75)], (x, y, z) => (h01(x >> 1, y >> 1, z >> 1, 3) > 0.7 ? 0xc8a468 : 0xdcbc80), { fl: VF.METAL });
      ell(m, butt, [nr * 2.1, nr * 2.1, nr * 2.1], 0x5a3820);
      ell(m, sub3(butt, scl3(dN, nr * 1.4)), [nr * 1.5, nr * 1.5, nr * 1.5], WIRE.gold, { fl: VF.METAL });
    };
    const foreR = rig.m('fore_r');
    needle(foreL);
    // the right needle is the mirror image of the left
    const tmp = new VoxelModel('n');
    needle(tmp);
    tmp.forEach((x, y, z, c, f) => foreR.set(-1 - x, y, z, c, f));
    // ---- the work: a striped scarf for somebody, hanging from the left needle against her belly
    const knit = rig.part('knit', 'fore_l', G);
    const hang = norm3([0.06, -1, -0.32]);
    const across = norm3(cross3(dN, hang));
    const L = 25 * s, Wd = 14 * s;
    for (let u = 3.5 * s; u <= 3.5 * s + Wd; u += 0.4)
      for (let v = 0; v <= L; v += 0.4) {
        let p = add3(add3(G, scl3(dN, u)), scl3(hang, v));
        p = add3(p, scl3(across, Math.sin(v * 0.25 + u * 0.15) * 0.5 * s));
        // rest it on her: never inside the body
        for (let it = 0; it < 40 && depth(p) < 1.6; it++) p = add3(p, [0, 0, 0.5]);
        const col = Math.floor(u / Math.max(1, 1.3 * s)), row = Math.floor(v / Math.max(1, 1.1 * s));
        const band = Math.floor(v / (5.2 * s));
        let c = KNIT[band % 3];
        if ((col + (row >> 1)) % 2) c = mulc(c, 0.86); // the knit "V" columns
        if (v < 1.2 * s) c = mulc(KNIT[1], 0.8); // stitches bunched on the needle
        if (v > L - 1.6 * s) c = mulc(KNIT[3], 0.9); // a blue cast-on edge
        const q: V3 = [Math.floor(p[0]), Math.floor(p[1]), Math.floor(p[2])];
        knit.set(q[0], q[1], q[2], c, VF.SOFTAO);
        const b = add3(p, scl3(across, -0.9));
        knit.set(Math.floor(b[0]), Math.floor(b[1]), Math.floor(b[2]), mulc(c, 0.8), VF.SOFTAO);
      }
    // ---- spectacles low on her snout: gold wire rims, glass, a mended bridge, temples back to the tympana
    const specs = rig.part('specs', 'head', pose.head(T(0, 39.4, 44.4)));
    const lenses = rig.part('lenses', 'specs', pose.head(T(0, 39.4, 44.4)));
    const nT = norm3([0.16, 0.3, 0.94]);
    const rl = 5.1 * s, rw = Math.max(0.6, 0.55 * s);
    const lensC = (sx: number) => pose.head(T(sx * 8.4, 37.9, 43.6));
    for (const sx of [1, -1]) {
      const C = lensC(sx), n = norm3(pose.dir([sx * nT[0], nT[1], nT[2]], true));
      const B = Math.ceil(rl + 2);
      for (let i = Math.floor(C[0] - B); i <= Math.ceil(C[0] + B); i++)
        for (let j = Math.floor(C[1] - B); j <= Math.ceil(C[1] + B); j++)
          for (let k = Math.floor(C[2] - B); k <= Math.ceil(C[2] + B); k++) {
            const d: V3 = [i + 0.5 - C[0], j + 0.5 - C[1], k + 0.5 - C[2]];
            const dn = dot3(d, n);
            const dp = Math.hypot(d[0] - n[0] * dn, d[1] - n[1] * dn, d[2] - n[2] * dn);
            if (Math.hypot(dp - rl, dn) < rw + 0.18) specs.set(i, j, k, j + 0.5 > C[1] + rl * 0.5 ? WIRE.gold : mixc(WIRE.gold, WIRE.dark, 0.4), VF.METAL);
            else if (Math.abs(dn) < 0.5 && dp < rl - 0.3) lenses.set(i, j, k, dp > rl - 1.4 ? 0xe8f0ee : 0xd4e2e4, VF.SOFTAO);
          }
    }
    const hug = (p: V3, d: V3, clear: number) => {
      for (let it = 0; it < 60 && depth(p) < clear; it++) p = add3(p, scl3(d, 0.4));
      return p;
    };
    const P = (sx: number, x: number, y: number, z: number) => pose.head(T(sx * x, y, z));
    // bridge (a saddle over the snout, mended with a twist of yarn) and two nose pads
    tube(specs, [P(1, 3.4, 39.4, 44.4), P(1, 1.4, 40.4, 44.9), P(-1, 1.4, 40.4, 44.9), P(-1, 3.4, 39.4, 44.4)].map((p) => hug(p, pose.dir([0, 1, 0.2], true), rw + 0.7)), [rw, rw, rw, rw], WIRE.gold, { fl: VF.METAL });
    ell(specs, hug(P(1, 0, 40.6, 45), pose.dir([0, 1, 0.2], true), rw + 1.2), [1.3 * s + 0.4, 1.2 * s + 0.4, 1.2 * s + 0.4], KNIT[0], { fl: VF.SOFTAO });
    for (const sx of [1, -1]) {
      ell(specs, hug(P(sx, 3.6, 35.2, 45.3), pose.dir([sx * 0.2, 0.3, 1], true), 0.4), [0.9 * s + 0.3, 0.9 * s + 0.3, 0.7 * s + 0.3], 0xe8e4d8, { fl: VF.METAL });
      const out = pose.dir([sx, 0.15, 0], true);
      const pts = [P(sx, 13.4, 38.6, 43.2), P(sx, 19.6, 35.6, 36.4), P(sx, 25.2, 32.6, 27.2), P(sx, 25.6, 32.2, 18.4), P(sx, 24.6, 29.6, 15.4)].map((p, i) => (i ? hug(p, out, rw + 0.6) : p));
      tube(specs, pts, pts.map(() => rw), WIRE.gold, { fl: VF.METAL });
    }
    // ---- the shawl: crocheted shell rows in madder rose and cream, a mustard hem, a fringe
    const shawl = rig.part('shawl', 'body', pBody);
    const ctr = pose.trunk(T(0, 22, -16));
    const hem = (phi: number, j: number) => (18 + 15 * Math.pow(Math.min(1.45, Math.abs(phi) / (Math.PI / 2)), 1.3) + (n01(j, 0, 0, 0.08, seed) - 0.5) * 1.6) * s + pose.lift;
    const zTop = (ax: number) => -5 + 17 * sstep(11, 25, ax);
    const bb = mass.bounds();
    const fringe: V3[] = [];
    const cells: V3[] = [];
    const QS: V3 = [0, 0, 0];
    for (let bx = bb.minX - 4; bx <= bb.maxX + 4; bx += 4)
      for (let by = Math.max(0, bb.minY); by <= bb.maxY + 3; by += 4)
        for (let bz = bb.minZ - 4; bz <= bb.maxZ + 4; bz += 4) {
          const dc = F.d(bx + 2, by + 2, bz + 2);
          if (dc < -3.7 || dc > 8.4) continue;
          for (let i = bx; i < bx + 4; i++) for (let j = by; j < by + 4; j++) for (let k = bz; k < bz + 4; k++) cells.push([i, j, k]);
        }
    for (const [i, j, k] of cells) {
        {
          const p: V3 = [i + 0.5, j + 0.5, k + 0.5];
          const qt = pose.unTrunkInto(p[0], p[1], p[2], 1 / s, QS);
          const qtz = qt[2], qtx = qt[0];
          if (qtz > zTop(Math.abs(qtx))) continue;
          if (pose.unHeadInto(p[0], p[1], p[2], 1 / s, QS)[2] > 15) continue;
          const phi = Math.atan2(Math.abs(p[0] - ctr[0]), -(p[2] - ctr[2]));
          const hy = hem(phi, Math.round(phi * 30));
          if (p[1] < hy) continue;
          const d = depth(p);
          if (d <= 0.3 || d > 2.4) continue;
          const rowV = (p[1] - hy) / s;
          const arc = phi * 30;
          const row = Math.floor(rowV / 2.7);
          const fan = (arc / 4.6 + (row & 1) * 0.5) % 1;
          if (row % 3 === 1 && fan < 0.16 && rowV > 3) continue; // lacy openwork between the shells
          let c: number;
          if (rowV < 2.3) c = SHAWL.mustard;
          else if (qtz > zTop(Math.abs(qtx)) - 2.4) c = SHAWL.cream;
          else {
            const band = row % 6;
            c = band < 2 ? (fan > 0.5 ? SHAWL.cream : SHAWL.creamD) : band === 5 ? SHAWL.mustard : fan < 0.5 ? SHAWL.rose : SHAWL.roseD;
          }
          if (d > 1.5) c = mulc(c, 0.86);
          shawl.set(i, j, k, jit(c, i, j, k, 0.03), VF.SOFTAO);
          if (rowV < 0.9 && Math.floor(arc / 1.7) !== Math.floor((arc - 0.25) / 1.7) && h01(i, j, k, 7) > 0.2) fringe.push(p);
        }
    }
    // tassels hang straight down from the hem, resting on her where they touch
    fringe.forEach((p, i) => {
      if (i % 2) return;
      const len = (5 + 2.6 * hs(i)) * s;
      const col = (i >> 1) % 2 ? SHAWL.cream : SHAWL.rose;
      ell(shawl, p, [0.9 * s + 0.3, 0.9 * s + 0.3, 0.9 * s + 0.3], SHAWL.mustard, { fl: VF.SOFTAO });
      for (let t = 0; t < len; t += 0.45) {
        const q: V3 = [p[0] + Math.sin(t * 0.4 + i) * 0.3, p[1] - t, p[2]];
        if (q[1] < 0.5 || depth(q) < 0.4) continue;
        shawl.set(Math.floor(q[0]), Math.floor(q[1]), Math.floor(q[2]), jit(col, i, Math.floor(t), 0, 0.05), VF.SOFTAO);
      }
    });
    // ---- the spectacle chain: little pearls and jet beads, sagging over the shawl from the temples
    const ends = [1, -1].map((sx) => P(sx, 24.6, 29.6, 15.4));
    const sag = add3(lerp3(ends[0], ends[1], 0.5), add3(T(0, -15, 0), pose.dir(T(0, 0, -16))));
    for (const [e, sx] of [[ends[0], 1], [ends[1], -1]] as [V3, number][]) {
      const mid = add3(lerp3(e, sag, 0.5), T(sx * 10, -3, 0));
      const n = Math.ceil(Math.hypot(...sub3(sag, e)) / (1.5 * s + 0.6));
      for (let i = 1; i < n; i++) {
        const t = i / n;
        let p = add3(add3(scl3(e, (1 - t) * (1 - t)), scl3(mid, 2 * t * (1 - t))), scl3(sag, t * t));
        const out = norm3(sub3(p, ctr));
        p = hug(p, out, 2.9);
        const br = Math.max(0.6, 0.75 * s);
        ell(shawl, p, [br, br, br], i % 3 === 0 ? 0x2a2026 : 0xf2ece2, { fl: VF.METAL });
      }
    }
    hollow(shawl, 2);
    meta.knit = { needleTip: scl3(tip, cfg.vs) };
    meta.lensPart = 'lenses';
    topY = Math.max(headM.bounds().maxY, specs.bounds().maxY) + 1;
  } else topY = headM.bounds().maxY + 1;

  // ---------------------------------------------------------------- finish
  for (const n of ['body', 'head', 'jaw', 'belly', 'throat']) hollow(rig.m(n), 2);
  for (const n of ['arm_l', 'fore_l', 'thigh_l', 'shin_l', 'foot_l', 'arm_r', 'fore_r', 'thigh_r', 'shin_r', 'foot_r']) hollow(rig.m(n), 2);
  const vs = cfg.vs;
  const mm = (p: V3): V3 => [p[0] * vs, p[1] * vs, p[2] * vs];
  rig.socket('head_top', 'head', [0, topY, pose.head(T(0, 40, 24))[2]]);
  rig.socket('mouth', 'jaw', pose.head(T(0, 25, 44)));
  rig.socket('back', 'body', pose.trunk(T(0, 36, -20)));
  const b = body.bounds();
  return rig.build({
    kind: 'toad',
    height: topY * vs,
    radius: 34 * s * vs,
    length: (b.maxZ - b.minZ + 1) * vs,
    eyes: { l: mm(eyeL), r: mm(eyeR), radius: eR * vs, gaze },
    /** lower-lid blink: rotate lid_l / lid_r about these axes (rig space) by up to `close` rad; sink the eye a touch */
    blink: { l: blinkL, r: blinkR, close: blinkClose },
    /** throat pulse: scale `throat` up to ~1.25; breathe: scale `belly` and the body's width */
    puffMax: 1.25,
    head: mm(pHead),
    ...meta,
    expressions: { neutral: { jaw: 0 }, happy: { jaw: 0.03 }, talk: { jaw: 0.1 } },
    defaultExpression: 'neutral',
  });
}

/** Mama Toad: ~0.72 m snout to vent, sitting back in her chair knitting; shawl, spectacles, a chain, needles, a scarf */
export const mamaToadRig = memoBy((_: void) => 'mama', (_: void): RigSpec => toad({ name: 'mama_toad', vs: 1 / 112, svl: 80.6, pal: MAMA_PAL, eyeT: 5.6, mama: true, seed: 17, wartMin: 1.25, wartK: 1 }));
/** a toadlet (~15 cm), sitting; variant 0-3 = colour morph */
export const toadletRig = memoBy((o: { variant?: number }) => String(o?.variant ?? 0), (o: { variant?: number }): RigSpec => {
  const v = (((o?.variant ?? 0) % BABY_PALS.length) + BABY_PALS.length) % BABY_PALS.length;
  return toad({ name: 'toadlet_' + v, vs: 1 / 230, svl: 34.5, pal: BABY_PALS[v], eyeT: 6.4, mama: false, seed: 31 + v * 7, wartMin: 1.1, wartK: 1.25 });
});
