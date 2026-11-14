// THE SPHINX — the living colossus that guards the river gate of the Nile
// (wave-50 gate boss). A lion body of weathered limestone ~32 m from the tip of
// the forepaws to the rump (plus a 9 m tail) and ~21 m to the uraeus, with the
// sly human face of a pharaoh under a striped nemes. Sculpted at 1/8 m voxels.
//
// The stone: sediment strata with hard lips over soft recessed layers, vertical
// joints breaking it into blocks, wind-worn lumps, chipped edges and old breaks
// in fresher pale stone, flood stains and an algae waterline on the paws, sand
// settled on every shelf, grey-green and orange lichen on the back and head.
// A network of dormant hairline cracks runs everywhere (flagged emissive: the
// boss shader keeps them dark until the statue breaks); five CRACK SITES are
// their own parts whose seams open into glowing sunlight as it takes damage.
// The face: almond eyes lined in kohl and gold inlay with modelled glowing eyes
// (cat-slit pupils, swapped in at higher resolution at runtime), a cocked brow,
// a lopsided smirk, the tip of the nose broken off, a plaited beard snapped
// short, painted ochre skin flaking off; inside the mouth, stone teeth with
// long canines and a throat that glows like a furnace. The nemes keeps faint
// lapis and gold stripes, a gold headband and a rearing gold uraeus. A broad
// collar of gold, lapis, carnelian and turquoise beads holds the chest gem, a
// big glowing carnelian sun in a gold bezel. Paws with gold-capped claws.
//
// Rig (all parts authored in place: rest frames are rig axes; faces +Z, left = +X):
//   hips (root) → belly → chest → neck → head → jaw, brow_l/_r, eye_l/_r, lappet_l/_r
//   chest → gem, arm_l → fore_l → paw_l → toe1_l..toe4_l   (same _r)
//   hips → thigh_l → shin_l → foot_l (same _r), hips → tail1 → … → tail8
//   crack sites: crack_flank (belly), crack_back (belly), crack_shoulder (chest),
//   crack_haunch (hips), crack_brow (head)
// meta.j holds rest joints in rig-local metres for the boss's IK and FX.
import {
  SRig, Grid, VoxelModel, VF, type V3, type RigSpec, type Field, type Paint,
  clamp01, sstep, h3, vn, cellEdge, mix, pk, norm, add, sub, mirX, ell, ellV, cone, coneV, rbox, tube, smin, smax, bounds, castOnto,
} from './kit';

/** body voxels per metre; the head family, paws and gem are rebuilt at SPHINX_HI_S, the eyes at 48 */
export const SPHINX_S = 5.5;
export const SPHINX_HI_S = 9;
/** the parts built at the high resolution */
export const SPHINX_HI = ['head', 'jaw', 'brow_l', 'brow_r', 'lappet_l', 'lappet_r', 'crack_brow', 'gem', 'paw_l', 'paw_r', 'toe1_l', 'toe2_l', 'toe3_l', 'toe4_l', 'toe1_r', 'toe2_r', 'toe3_r', 'toe4_r'];
let S = SPHINX_S;
/** the head is sculpted in its own units and scaled up by this */
const HS = 1.25;

// ----------------------------------------------------------------------------- palette
const LIME = { hi: 0xf0e2c0, base: 0xd8c197, shade: 0xb4966c, deep: 0x8a6e4e, recess: 0x5f4a36, fresh: 0xe9dcbc };
const STRATA = [0xdac398, 0xcfb488, 0xe3d0a6, 0xc7aa7e, 0xd5bd91, 0xc0a277, 0xe7d6b1, 0xcdb286, 0xd2b98d, 0xbc9d72];
const SAND = 0xe9cd96;
const LICHEN = [0xa7a67c, 0x939a6c, 0xb8b488, 0x84906a];
const LICHEN_O = [0xc99a52, 0xd4ad66, 0xb98a4a];
const ALGAE = [0x6f6c48, 0x585a3b, 0x7c7a52];
const CRUST = 0xd8d0b2;
const OCHRE = 0xb2603e, OCHRE_F = 0xc4906c;
const LAPIS = 0x36599c, LAPIS_F = 0x6f83aa, TURQ = 0x3ea493, CARN = 0xb4432e;
const GOLD = { hi: 0xffe690, base: 0xe2b046, shade: 0xb27f2b, dark: 0x74521b };
const KOHL = 0x1d1a22;
const MOUTH = { gum: 0x5e2c24, deep: 0x2c120e, teeth: 0xece0c2, teethD: 0xc9b894 };
/** seam voxels carry their open colour; the boss shader keeps them dark until they open */
const SEAM = { core: 0xffd98a, hot: 0xffad42, edge: 0xf07a2c };
const GEM = { white: 0xfff0d8, hi: 0xff9a66, base: 0xe0442c, deep: 0x8e1a12, dark: 0x4a0a08 };
const EYE = { sclera: 0xefe6d4, scleraD: 0xd4c6aa, lid: 0xbfa27a, iris0: 0xfff0a8, iris1: 0xffc23e, iris2: 0xf08a1e, ring: 0x8a3008, pupil: 0x120806, glint: 0xffffff };

// ----------------------------------------------------------------------------- landmarks (rest pose, metres)
export const SJ = {
  hips: [0, 9.2, -9.4] as V3,
  belly: [0, 9.4, -3.4] as V3,
  chest: [0, 9.8, 2.4] as V3,
  neck: [0, 11.2, 6.0] as V3,
  head: [0, 14.6, 9.0] as V3,
  sh: [3.5, 8.6, 5.9] as V3,
  el: [3.85, 4.6, 4.3] as V3,
  wr: [3.95, 1.6, 5.6] as V3,
  paw: [4.0, 0, 7.3] as V3,
  hp: [3.1, 9.0, -9.6] as V3,
  kn: [3.7, 5.9, -6.9] as V3,
  hk: [3.55, 3.1, -11.6] as V3,
  ank: [3.55, 1.0, -10.3] as V3,
  hpaw: [3.55, 0, -9.7] as V3,
};
/** head centre: the origin of head-local (u, v, w) */
export const HC: V3 = [0, 15.4, 9.9];
const JAW_HINGE: V3 = [0, -0.95, 0.15];
const EYE_C: V3 = [0.86, 0.22, 1.88];
export const EYE_R = 0.36 * 1.25;
const TAIL: V3[] = [[0, 11.2, -13.0], [0, 10.3, -14.6], [0, 8.9, -15.7], [0, 7.3, -16.4], [0, 5.6, -16.8], [0.25, 3.9, -17.0], [0.6, 2.4, -17.4], [1.0, 1.35, -18.4], [1.45, 1.05, -19.8]];
const TAIL_R = [0.92, 0.84, 0.76, 0.68, 0.6, 0.54, 0.5, 0.46, 0.44];
const TOE_X = [-1.15, -0.4, 0.4, 1.15];
const TOE_L = [1.0, 1.25, 1.25, 1.05];
const fromH = (p: V3): V3 => [p[0] * HS + HC[0], p[1] * HS + HC[1], p[2] * HS + HC[2]];

// ----------------------------------------------------------------------------- stone
function strataY(x: number, y: number, z: number) {
  return y + 0.35 * Math.sin(x * 0.13 + z * 0.17) + (vn(x * 0.06, y * 0.05, z * 0.06, 3) - 0.5) * 0.8;
}
/** 1 inside a vertical joint (2D cellular borders, ~2.6 m blocks), 0 elsewhere */
function jointAt(x: number, y: number, z: number) {
  const u = x * 0.38 + y * 0.03, v = z * 0.38 - y * 0.02;
  const iu = Math.floor(u), iv = Math.floor(v);
  let f1 = 9, f2 = 9;
  for (let a = -1; a <= 1; a++)
    for (let b = -1; b <= 1; b++) {
      const cu = iu + a, cv = iv + b;
      const dd = (u - cu - h3(cu, cv, 1, 91)) ** 2 + (v - cv - h3(cu, cv, 2, 91)) ** 2;
      if (dd < f1) {
        f2 = f1;
        f1 = dd;
      } else if (dd < f2) f2 = dd;
    }
  return 1 - sstep(0.025, 0.06, Math.sqrt(f2) - Math.sqrt(f1));
}
/** weathering: lumps, soft strata recessed under hard lips, block joints, crumbs */
function erode(x: number, y: number, z: number, a: number) {
  let d = (vn(x * 0.3, y * 0.3, z * 0.3, 5) - 0.5) * 0.42 * a;
  const sy = strataY(x, y, z), f = sy / 0.85 - Math.floor(sy / 0.85);
  d += a * 0.14 * sstep(0.0, 0.1, f) * (1 - sstep(0.62, 0.8, f));
  d += a * 0.16 * jointAt(x, y, z);
  d += (vn(x * 1.4, y * 1.4, z * 1.4, 7) - 0.5) * 0.1 * a;
  return d;
}
/** dormant hairline cracks (patchy) */
function hairline(x: number, y: number, z: number) {
  if (vn(x * 0.16, y * 0.16, z * 0.16, 61) < 0.6) return false;
  return cellEdge(x * 0.5, y * 0.5, z * 0.5, 63) < 0.03;
}

// chipped-off chunks: random pockets on the surface, broken into fresher stone
interface Chip {
  c: V3;
  r: V3;
}
let CHIPS: Chip[] = [];
const chipField = (x: number, y: number, z: number) => {
  let d = 9;
  for (const c of CHIPS) {
    const dx = x - c.c[0], dy = y - c.c[1], dz = z - c.c[2];
    if (dx * dx + dy * dy + dz * dz > 1.6) continue;
    d = Math.min(d, ell(x, y, z, c.c[0], c.c[1], c.c[2], c.r[0], c.r[1], c.r[2]) + (vn(x * 4, y * 4, z * 4, 17) - 0.5) * 0.12);
  }
  return d;
};

interface StoneK {
  lichen?: number;
  /** a carved, smoother finish (the face) */
  clean?: boolean;
  /** strength of the paint traces (face, beard) */
  ochre?: number;
  /** masonry block pattern (paws, lower legs) */
  blocks?: boolean;
}
function stone(x: number, y: number, z: number, nx: number, ny: number, nz: number, k: StoneK = {}): number {
  void nx;
  void nz;
  if (chipField(x, y, z) < 0.09) return pk(ny > 0.5 ? mix(LIME.fresh, SAND, 0.25) : LIME.fresh);
  if (!k.clean && hairline(x, y, z)) return pk(SEAM.edge, VF.EMISSIVE);
  const sy = strataY(x, y, z), b = sy / 0.85, bi = Math.floor(b), f = b - bi;
  let c = STRATA[Math.floor(h3(bi, 7, 3, 1) * STRATA.length)];
  if (f > 0.8 && ny > -0.3) c = mix(c, LIME.hi, 0.42);
  else if (f < 0.1) c = mix(c, LIME.shade, 0.38);
  if (k.clean) {
    // carved faces keep a smooth finish: no joints, stains or patchy wear
  } else if (k.blocks) {
    // ashlar repairs: courses of dressed blocks with dark mortar joints
    const cy = y / 0.72, row = Math.floor(cy);
    const fx = (x + z) / 1.35 + h3(row, 3, 9, 4) * 3.0;
    if (cy - row < 0.09 || fx - Math.floor(fx) < 0.06) c = mix(c, LIME.recess, 0.6);
    else c = mix(c, STRATA[Math.floor(h3(row, Math.floor(fx), 5, 2) * STRATA.length)], 0.5);
  } else if (jointAt(x, y, z) > 0.5) c = mix(c, LIME.recess, 0.4);
  // flood and rain stains running down
  const st = vn(x * 0.45, y * 0.06, z * 0.45, 41);
  if (!k.clean && st > 0.66) c = mix(c, LIME.shade, (st - 0.66) * 1.2);
  // faded ochre paint: a broad wash that wears thin
  if (k.ochre) c = mix(c, OCHRE_F, clamp01((0.18 + 0.22 * vn(x * 0.35, y * 0.35, z * 0.35, 77)) * k.ochre));
  // bleached tops with sand settled on them; dark undersides
  if (ny > 0.62) c = vn(x * 0.7, y * 0.7, z * 0.7, 9) > 0.56 ? mix(SAND, LIME.hi, 0.25) : mix(c, LIME.hi, 0.32);
  else if (ny < -0.5) c = mix(c, LIME.deep, 0.32);
  // lichen
  if (k.lichen && ny > -0.1 && y > 2.5) {
    const l = vn(x * 0.5 + 3, y * 0.5, z * 0.5, 23) * 0.75 + vn(x * 1.6, y * 1.6, z * 1.6, 24) * 0.25;
    if (l > 0.74 - 0.03 * k.lichen) {
      const o = vn(x * 2.2, y * 2.2, z * 2.2, 29);
      c = mix(c, o > 0.74 ? LICHEN_O[Math.floor(o * 7) % 3] : LICHEN[Math.floor(clamp01((l - 0.7) * 5) * 3.99)], 0.7);
    }
  }
  // the waterline: algae below, a pale crust line above
  const wl = 1.35 + (vn(x * 0.4, 0, z * 0.4, 31) - 0.5) * 0.5;
  if (y < wl) c = mix(c, ALGAE[Math.floor(vn(x * 1.3, y * 1.3, z * 1.3, 33) * 2.99)], 0.55 + 0.35 * sstep(wl, wl - 0.8, y));
  else if (y < wl + 0.16) c = mix(c, CRUST, 0.6);
  return pk(c);
}

// ----------------------------------------------------------------------------- crack sites
export interface CrackSite {
  name: string;
  part: string;
  c: V3;
  r: number;
  seed: number;
  dir: V3;
}
const SITES: CrackSite[] = [];
/** seam pattern inside a site: a jagged main fracture plus a cellular web that thins toward the rim */
function seamAt(s: CrackSite, x: number, y: number, z: number, nx: number, ny: number, nz: number) {
  const qx = x - s.c[0], qy = y - s.c[1], qz = z - s.c[2];
  const r = Math.hypot(qx, qy, qz);
  if (r > s.r) return 0;
  const k = 1 - r / s.r;
  // main fracture
  const t = qx * s.dir[0] + qy * s.dir[1] + qz * s.dir[2];
  const px = ny * s.dir[2] - nz * s.dir[1], py = nz * s.dir[0] - nx * s.dir[2], pz = nx * s.dir[1] - ny * s.dir[0];
  const j = (vn(t * 1.6 + s.seed, 0, 0, 51) - 0.5) * 0.9 + (vn(t * 4.2 + s.seed, 1, 0, 52) - 0.5) * 0.25;
  const lx = qx - s.dir[0] * t - px * j, ly = qy - s.dir[1] * t - py * j, lz = qz - s.dir[2] * t - pz * j;
  const lat = Math.hypot(lx, ly, lz);
  if (lat < 0.09 + 0.1 * k) return lat < 0.06 ? 2 : 1;
  // web
  const e = cellEdge(x * 1.25 + s.seed, y * 1.25, z * 1.25, 70 + s.seed);
  return e < 0.085 * Math.sqrt(k) ? 1 : 0;
}
function sitePaint(s: CrackSite, base: Paint): Paint {
  return (x, y, z, nx, ny, nz) => {
    const m = seamAt(s, x, y, z, nx, ny, nz);
    if (m === 2) return pk(SEAM.core, VF.EMISSIVE);
    if (m === 1) return pk(SEAM.hot, VF.EMISSIVE);
    return base(x, y, z, nx, ny, nz);
  };
}

// ----------------------------------------------------------------------------- torso
const NB: V3 = [0, 11.7, 6.6]; // the collar wraps around this point (neck base)
let GEM_C: V3 = [0, 9.0, 8.4];
function torsoBase(x: number, y: number, z: number) {
  let d = ell(x, y, z, 0, 9.5, -10.0, 3.6, 3.5, 3.9);
  d = smin(d, ell(x, y, z, 0, 9.9, -5.6, 3.15, 2.85, 4.2), 2.2);
  d = smin(d, ell(x, y, z, 0, 9.5, -0.6, 3.35, 3.3, 4.0), 2.2);
  d = smin(d, ell(x, y, z, 0, 9.4, 3.4, 3.85, 4.1, 4.4), 2.4);
  d = smin(d, ell(x, y, z, 0, 11.6, 4.4, 2.9, 1.7, 3.2), 1.6);
  d = smin(d, ell(x, y, z, 0, 7.6, 6.1, 2.5, 2.6, 2.3), 1.8);
  d = smax(d, -ell(x, y, z, 0, 4.4, -4.0, 4.6, 2.3, 5.2), 1.4);
  // the lion's flank hollow behind the ribs and the spine furrow
  d = smax(d, -ell(Math.abs(x), y, z, 3.9, 8.2, -4.4, 0.9, 2.2, 2.0), 1.2);
  d = smax(d, -ell(x, y, z, 0, 13.2, -3.6, 0.45, 0.5, 6.5), 0.6);
  return d;
}
const collarR = (x: number, y: number, z: number) => Math.hypot(x - NB[0], (y - NB[1]) * 1.05, (z - NB[2]) * 0.8);
function collarMask(x: number, y: number, z: number) {
  const r = collarR(x, y, z);
  return z > 4.6 && y < 12.4 ? sstep(1.9, 2.05, r) * (1 - sstep(4.15, 4.3, r)) : 0;
}
/** the gem's gold bezel: a raised ring around the stone */
const bezelF = (x: number, y: number, z: number) => {
  const r = Math.hypot((x - GEM_C[0]) / 1.12, (y - GEM_C[1]) / 1.36);
  return Math.hypot((r - 1.0) * 1.2, z - (GEM_C[2] - 0.05)) - 0.22;
};
function torsoF(x: number, y: number, z: number) {
  let d = torsoBase(x, y, z);
  if (d > 1.2) return d;
  // the gem's bezel mound and the broad collar stand proud of the chest
  d = smin(d, ell(x, y, z, GEM_C[0], GEM_C[1], GEM_C[2] - 0.45, 1.3, 1.55, 0.5), 0.3);
  d = Math.min(d, bezelF(x, y, z));
  d -= 0.17 * collarMask(x, y, z);
  if (d < -1.2) return d;
  const cm = collarMask(x, y, z);
  d += erode(x, y, z, 1 - 0.85 * cm - (Math.hypot(x - GEM_C[0], y - GEM_C[1], z - GEM_C[2]) < 1.6 ? 1 : 0) * 0.9);
  return smax(d, -chipField(x, y, z), 0.08);
}
function torsoPaint(x: number, y: number, z: number, nx: number, ny: number, nz: number): number {
  // gem bezel
  if (bezelF(x, y, z) < 0.12) {
    const a = Math.atan2(y - GEM_C[1], x - GEM_C[0]);
    if (nz > 0.5 && Math.floor((a + 3.2) * 3.5) % 3 === 0) return pk(LAPIS);
    return pk(ny > 0.4 ? GOLD.hi : ny < -0.4 ? GOLD.shade : GOLD.base, VF.METAL);
  }
  if (Math.hypot((x - GEM_C[0]) / 1.3, (y - GEM_C[1]) / 1.55) < 1.0 && z > GEM_C[2] - 0.9) return pk(GOLD.dark, VF.METAL);
  const cm = collarMask(x, y, z);
  if (cm > 0.5) {
    // the broad collar: bead rings (lapis, carnelian, turquoise) between thin gold rows, worn through in places
    const r = collarR(x, y, z);
    const t = (r - 1.95) / 0.44, ri = Math.floor(t), edge = t - ri;
    if (vn(x * 0.7, y * 0.7, z * 0.7, 88) < 0.26) return stone(x, y, z, nx, ny, nz, { lichen: 0 });
    if (edge < 0.2 || ri === 0 || ri >= 4) return pk(ny > 0.3 ? GOLD.hi : GOLD.base, VF.METAL);
    const ang = Math.atan2(x, -(y - NB[1]));
    const bead = Math.floor(ang * (7 + ri * 2.5) + ri * 0.5);
    const tip = ri === 3 && edge > 0.6; // drop beads on the outer row
    if (tip) return pk(bead % 2 ? GOLD.base : CARN, bead % 2 ? VF.METAL : VF.SOLID);
    const cols = ri === 1 ? [LAPIS, LAPIS_F] : ri === 2 ? [CARN, mix(CARN, OCHRE_F, 0.35)] : [TURQ, mix(TURQ, LIME.base, 0.3)];
    return pk(edge > 0.85 ? mix(cols[0], 0x1a1410, 0.4) : cols[bead & 1]);
  }
  return stone(x, y, z, nx, ny, nz, { lichen: y > 10.5 ? 1.2 : 0.4 });
}

// ----------------------------------------------------------------------------- neck
function neckF(x: number, y: number, z: number) {
  let d = cone(x, y, z, 0, 10.8, 5.4, 0, 13.4, 8.3, 2.8, 2.35);
  d = smin(d, ell(x, y, z, 0, 12.0, 7.4, 1.9, 1.9, 1.5), 1.0);
  if (d > 1 || d < -1) return d;
  return d + erode(x, y, z, 0.7);
}

// ----------------------------------------------------------------------------- head (u, v, w = head-local)
const smirk = (u: number) => 0.16 * sstep(0.12, 0.62, u) - 0.03 * sstep(0.15, 0.62, -u);
const mouthLine = (u: number) => -1.29 + smirk(u);
/** almond eye opening (2D, u/v): a vesica tilted so the outer corner rises */
function lens(u: number, v: number, s: number) {
  const a = 0.1 * s;
  const cu = u - s * EYE_C[0], cv = v - EYE_C[1];
  const ru = cu * Math.cos(a) + cv * Math.sin(a), rv = -cu * Math.sin(a) + cv * Math.cos(a);
  const R = 0.8, o = 0.585;
  return Math.max(Math.hypot(ru, rv + o) - R, Math.hypot(ru, rv - o) - R);
}
const inCavity = (u: number, v: number, w: number) => ell(u, v, w, 0, -1.32, 1.25, 0.86, 0.36, 0.95);
/** stone teeth with long canines: the upper row hangs from the palate, the lower stands on the jaw */
function upperTeethF(u: number, v: number, w: number) {
  let d = 9;
  for (let i = -3; i <= 3; i++) {
    const ui = i * 0.155, canine = Math.abs(i) === 3;
    const wt = 2.02 - 0.5 * ui * ui;
    d = Math.min(d, cone(u, v, w, ui, -1.0, wt - 0.05, ui, canine ? -1.47 : -1.32, wt, canine ? 0.085 : 0.07, canine ? 0.02 : 0.05));
  }
  return d;
}
function lowerTeethF(u: number, v: number, w: number) {
  let d = 9;
  for (let i = -3; i <= 3; i++) {
    const ui = i * 0.155, canine = Math.abs(i) === 3;
    const wt = 2.02 - 0.5 * ui * ui;
    d = Math.min(d, cone(u, v, w, ui, -1.66, wt - 0.1, ui, canine ? -1.2 : -1.36, wt - 0.06, canine ? 0.08 : 0.065, canine ? 0.02 : 0.045));
  }
  return d;
}
const teethF = (u: number, v: number, w: number) => Math.min(upperTeethF(u, v, w), lowerTeethF(u, v, w));
function faceF(u: number, v: number, w: number) {
  const au = Math.abs(u), s = u >= 0 ? 1 : -1;
  let d = ell(u, v, w, 0, 0.5, -0.35, 2.05, 2.25, 2.3);
  d = smin(d, ell(u, v, w, 0, 0.95, 0.85, 1.82, 1.15, 1.5), 0.5);
  d = smin(d, ell(u, v, w, 0, -0.25, 1.0, 1.92, 1.35, 1.5), 0.5);
  d = smin(d, ell(u, v, w, 0, -1.05, 1.28, 1.25, 0.72, 1.12), 0.5);
  d = smin(d, ell(au, v, w, 1.28, -0.02, 1.42, 0.6, 0.42, 0.75), 0.35);
  // cheeks: the smirking side sits higher and fuller
  d = smin(d, ell(au, v, w, 1.05, -0.72 + (s > 0 ? 0.08 : 0), 1.5, 0.7 + (s > 0 ? 0.04 : 0), 0.66, 0.72), 0.5);
  d = smin(d, ell(u, v, w, 0, -1.9, 1.55, 0.92, 0.6, 0.85), 0.45);
  d = smin(d, cone(au, v, w, 1.6, -0.9, 0.1, 0.72, -1.82, 1.4, 0.52, 0.44), 0.5);
  // brow ridge and heavy upper lids
  d = smin(d, ell(au, v, w, 0.9, 0.62, 1.98, 0.75, 0.2, 0.42), 0.25);
  d = smin(d, ell(au, v, w, EYE_C[0], 0.39, 2.06, 0.64, 0.16, 0.34), 0.12);
  d = smin(d, ell(au, v, w, EYE_C[0], 0.0, 2.07, 0.56, 0.1, 0.26), 0.1);
  // the nose (its tip broken off)
  let nose = cone(u, v, w, 0, 0.55, 2.18, 0, -0.42, 2.88, 0.2, 0.33);
  nose = smin(nose, ell(au, v, w, 0.3, -0.5, 2.58, 0.27, 0.22, 0.25), 0.15);
  nose = smin(nose, ell(u, v, w, 0, -0.44, 2.92, 0.3, 0.26, 0.28), 0.15);
  nose = Math.max(nose, w - (2.76 - 0.2 * (v + 0.5)) + (vn(u * 7, v * 7, 1, 81) - 0.5) * 0.08);
  d = smin(d, nose, 0.2);
  d = smax(d, -ell(au, v, w, 0.17, -0.62, 2.72, 0.08, 0.06, 0.11), 0.04);
  // lips, the cupid's bow and the philtrum
  d = smin(d, ell(u, v, w, 0, -1.12, 2.3, 0.62, 0.16, 0.3), 0.12);
  d = smin(d, ell(au, v, w, 0.17, -1.0, 2.36, 0.15, 0.08, 0.15), 0.06);
  d = smin(d, ell(u, v, w, 0, -1.45, 2.22, 0.56, 0.15, 0.28), 0.12);
  d = smax(d, -ell(u, v, w, 0, -0.86, 2.47, 0.06, 0.16, 0.07), 0.04);
  // the mouth line, the corner pits
  if (au < 0.68 && w > 1.9 && Math.abs(v - mouthLine(u)) < 0.06) d = Math.max(d, 0.02);
  d = smax(d, -ell(au, v, w, 0.64, mouthLine(s * 0.64), 2.05, 0.07, 0.08, 0.12), 0.04);
  // ears
  d = smin(d, ell(au, v, w, 2.02, 0.0, 0.2, 0.24, 0.62, 0.42), 0.15);
  d = smax(d, -ell(au, v, w, 2.18, 0.0, 0.3, 0.11, 0.4, 0.24), 0.05);
  // the eye sockets (the eyes are their own parts)
  d = smax(d, -Math.max(lens(u, v, s), 1.62 - w), 0.05);
  // the mouth: a closed cavity behind the lips, stone teeth inside
  d = smax(d, -inCavity(u, v, w), 0.06);
  d = Math.min(d, teethF(u, v, w));
  // the beard, plaited and snapped short
  const bt = clamp01((-2.3 - v) / 2.05);
  let beard = cone(u * 1.15, v, w, 0, -2.3, 1.7, 0, -4.35, 2.12, 0.36, 0.42) + 0.035 * Math.sin(v * 24);
  beard = Math.max(beard, -(v + 4.05 + 0.25 * (vn(u * 3, w * 3, 2, 83) - 0.5)));
  d = smin(d, beard + 0.04 * bt * bt, 0.2);
  return d;
}
/** nemes: cap, flared wings, back fall and the braided tail */
function nemesF(u: number, v: number, w: number) {
  const au = Math.abs(u);
  let cap = ell(u, v, w, 0, 0.72, -0.3, 2.3, 2.45, 2.7);
  cap = Math.max(cap, (1.38 - v) * sstep(0.5, 1.2, w) * (1 - sstep(1.55, 1.95, au)));
  // wings: slabs flaring out as they fall, behind the cheeks
  const outer = au - (2.25 + (1.3 - v) * 0.36), inner = 1.8 - au;
  const front = w - (0.95 - (1.4 - v) * 0.1), back = -1.6 - (1.4 - v) * 0.2 - w;
  const top = v - 1.55, bot = -2.2 - v;
  const wing = Math.max(outer, inner, front, back, top, bot);
  let d = smin(cap, wing, 0.6);
  d = smin(d, Math.max(ell(u, v, w, 0, -1.0, -1.75, 2.0, 1.9, 1.05), -3.1 - v), 0.6);
  // the braided tail down the nape
  d = smin(d, cone(u, v, w, 0, -0.9, -2.45, 0, -3.7, -3.05, 0.55, 0.42) - 0.04 * Math.max(0, Math.sin(v * 15)), 0.3);
  // the headband stands proud over the brow
  if (v > 1.38 && v < 1.78 && w > 0.6) d -= 0.07;
  return d;
}
function uraeusF(u: number, v: number, w: number) {
  let d = tube(u, v, w, [[0, 1.95, 0.4], [0, 2.07, 1.3], [0, 1.98, 2.05], [0, 2.25, 2.38], [0, 2.7, 2.45]], [0.12, 0.14, 0.14, 0.13, 0.12]);
  d = smin(d, ell(u, v, w, 0, 2.62, 2.43, 0.36, 0.5, 0.1), 0.08);
  d = smin(d, ell(u, v, w, 0, 3.06, 2.52, 0.13, 0.11, 0.2), 0.06);
  return d;
}
function headF(x: number, y: number, z: number) {
  const u = (x - HC[0]) / HS, v = (y - HC[1]) / HS, w = (z - HC[2]) / HS;
  let d = Math.min(faceF(u, v, w), nemesF(u, v, w), uraeusF(u, v, w)) * HS;
  if (d > 0.8 || d < -0.8) return d;
  // gentle weathering (strong carving survives)
  d += (vn(x * 0.5, y * 0.5, z * 0.5, 91) - 0.5) * 0.1 + (vn(x * 1.8, y * 1.8, z * 1.8, 92) - 0.5) * 0.05;
  return smax(d, -chipField(x, y, z), 0.06);
}
function inJaw(u: number, v: number, w: number) {
  if (w < -0.1 || Math.abs(u) > 1.75 || v > -0.6) return false;
  if (inCavity(u, v, w) < 0.15) {
    const up = upperTeethF(u, v, w), lo = lowerTeethF(u, v, w);
    if (Math.min(up, lo) < 0.06) return lo < up;
  }
  const line = mouthLine(u) + Math.max(0, 1.9 - w) * 0.18;
  return v < line;
}
function headPaint(x: number, y: number, z: number, nx: number, ny: number, nz: number): number {
  const u = (x - HC[0]) / HS, v = (y - HC[1]) / HS, w = (z - HC[2]) / HS;
  const au = Math.abs(u), s = u >= 0 ? 1 : -1;
  // inside the mouth: teeth, gums, and a throat like a furnace
  if (inCavity(u, v, w) < 0.1) {
    if (teethF(u, v, w) < 0.05) return pk(ny > 0.3 || ny < -0.3 ? MOUTH.teeth : MOUTH.teethD);
    if (w < 0.75) return pk(w < 0.5 ? SEAM.core : SEAM.hot, VF.GLOW);
    return pk(w < 1.3 ? MOUTH.deep : MOUTH.gum);
  }
  const fF = faceF(u, v, w), nF = nemesF(u, v, w), uF = uraeusF(u, v, w);
  if (uF < fF && uF < nF) {
    // the uraeus: gold, a lapis and carnelian hood, tiny glowing eyes
    if (v > 2.98 && v < 3.1 && au > 0.06 && au < 0.12 && w > 2.55) return pk(GEM.hi, VF.GLOW);
    if (v > 2.2 && v < 3.0 && w > 2.45 && nz > 0.4) return pk((Math.floor(v * 7) + Math.floor(au * 9)) % 2 ? LAPIS : CARN);
    return pk(ny > 0.4 ? GOLD.hi : GOLD.base, VF.METAL);
  }
  if (nF < fF - 0.02) {
    // nemes: faded lapis and gold stripes; a gold headband with lapis inlay
    if (v > 1.38 && v < 1.78 && w > 0.6) {
      if (Math.abs(v - 1.58) < 0.08 && Math.floor((Math.atan2(u, w) + 3) * 6) % 2 === 0) return pk(LAPIS);
      return pk(ny > 0.35 ? GOLD.hi : GOLD.base, VF.METAL);
    }
    const fade = vn(x * 0.55, y * 0.55, z * 0.55, 95);
    if (fade < 0.3) return stone(x, y, z, nx, ny, nz, { lichen: 1.6 });
    const onWing = au > 1.85 && v < 1.3;
    const coord = onWing ? v * 1.0 : v < -0.6 && w < -1.2 ? v : Math.atan2(au, w + 0.4) * 2.6 + (v > 1.2 ? 0 : 0);
    const stripe = Math.floor(coord / 0.22) & 1;
    const base = stripe ? (fade > 0.55 ? LAPIS : LAPIS_F) : fade > 0.55 ? GOLD.base : mix(GOLD.base, LIME.base, 0.45);
    const c = mix(base, LIME.base, 0.25 + 0.3 * (1 - fade));
    return pk(ny > 0.6 ? mix(c, SAND, 0.3) : ny < -0.4 ? mix(c, LIME.deep, 0.3) : c, stripe ? VF.SOLID : fade > 0.55 ? VF.METAL : VF.SOLID);
  }
  // the broken nose: fresh pale stone on the break
  if (au < 0.5 && v > -0.75 && v < 0.4 && Math.abs(w - (2.76 - 0.2 * (v + 0.5))) < 0.1 && nz > 0.35) return pk(mix(LIME.fresh, LIME.base, 0.35));
  // the beard: stone with lapis left in the plait grooves
  if (v < -2.3) {
    if (v < -3.95) return pk(mix(LIME.fresh, LIME.base, 0.3));
    return Math.sin(v * 24) < -0.55 && vn(x * 2, y * 2, z * 2, 97) > 0.4 ? pk(LAPIS_F) : stone(x, y, z, nx, ny, nz, { ochre: 0.5, clean: true });
  }
  // kohl liner, a gold inlay rim, the cosmetic line to the temple
  if (w > 1.55 && au < 1.62 && v > -0.4 && v < 0.75) {
    const l = lens(u, v, s);
    if (l > -0.03 && l < 0.07) return pk(KOHL);
    if (l >= 0.07 && l < 0.12) return pk(GOLD.base, VF.METAL);
    const t = clamp01((au - 1.3) / 0.62), lv = 0.3 + 0.12 * t;
    if (au > 1.3 && au < 1.95 && Math.abs(v - lv) < 0.055) return pk(KOHL);
    if (au > 1.3 && au < 1.95 && Math.abs(v - lv) < 0.085) return pk(GOLD.base, VF.METAL);
  }
  // lips: a deeper ochre, the mouth line in shadow
  if (w > 2.0 && au < 0.7 && v < -0.92 && v > -1.66) {
    if (Math.abs(v - mouthLine(u)) < 0.09) return pk(MOUTH.deep);
    return pk(mix(OCHRE, LIME.base, 0.35 + 0.2 * vn(x, y, z, 12)));
  }
  return stone(x, y, z, nx, ny, nz, { ochre: 1, clean: true, lichen: v > 1.4 ? 1 : 0 });
}
/** cells newly exposed inside the face when the jaw drops */
function headInner(x: number, y: number, z: number) {
  const u = (x - HC[0]) / HS, v = (y - HC[1]) / HS, w = (z - HC[2]) / HS;
  if (Math.abs(u) < 1.6 && v < -0.7 && v > -1.9 && w > 0) return pk(MOUTH.deep);
  return pk(LIME.recess);
}
// brows: painted kohl arcs carved in relief (their own parts, so they cock)
const BROW: V3[][] = [0, 1].map((side) => {
  const s = side === 0 ? 1 : -1, up = side === 0 ? 0.09 : 0; // the left brow is cocked
  return [[s * 0.32, 0.64, 2.38], [s * 0.72, 0.77 + up * 0.6, 2.3], [s * 1.12, 0.81 + up, 2.14], [s * 1.5, 0.73 + up * 0.8, 1.86]] as V3[];
});
const browF = (side: number) => (x: number, y: number, z: number) => tube((x - HC[0]) / HS, (y - HC[1]) / HS, (z - HC[2]) / HS, BROW[side], [0.1, 0.12, 0.11, 0.08]) * HS;
// lappets: striped strips of the nemes falling in front of the shoulders onto the chest
const LAP_T: V3 = [2.42, -1.95, 0.42], LAP_B: V3 = [2.05, -5.6, -1.9];
function lappetF(s: number) {
  const T = toLocal(LAP_T, s), B = toLocal(LAP_B, s);
  const ax = norm(sub(B, T)), L = Math.hypot(B[0] - T[0], B[1] - T[1], B[2] - T[2]);
  const nrm = norm([0, ax[2], -ax[1]]);
  return (x: number, y: number, z: number) => {
    const q = sub([(x - HC[0]) / HS, (y - HC[1]) / HS, (z - HC[2]) / HS], T);
    const t = q[0] * ax[0] + q[1] * ax[1] + q[2] * ax[2];
    const n = q[0] * nrm[0] + q[1] * nrm[1] + q[2] * nrm[2] - 0.08 * Math.sin((t / L) * Math.PI);
    const ux = q[0] - ax[0] * t - nrm[0] * n;
    const half = 0.62 + 0.1 * (t / L);
    return (rbox(ux, n, t, 0, 0, L * 0.5, half, 0.16, L * 0.5, 0.08) + (vn(x * 1.5, y * 1.5, z * 1.5, 99) - 0.5) * 0.05) * HS;
  };
}
function toLocal(p: V3, s: number): V3 {
  return [p[0] * s, p[1], p[2]];
}
function lappetPaint(x: number, y: number, z: number, nx: number, ny: number, nz: number) {
  const v = (y - HC[1]) / HS;
  const fade = vn(x * 0.55, y * 0.55, z * 0.55, 96);
  if (fade < 0.28) return stone(x, y, z, nx, ny, nz, { lichen: 0.8 });
  const stripe = Math.floor(v / 0.22) & 1;
  const c = stripe ? (fade > 0.55 ? LAPIS : LAPIS_F) : mix(GOLD.base, LIME.base, fade > 0.55 ? 0.1 : 0.45);
  return pk(mix(c, LIME.base, 0.22), !stripe && fade > 0.55 ? VF.METAL : VF.SOLID);
}

// ----------------------------------------------------------------------------- forelegs (left-local; the right side is sculpted mirrored with its own wear)
function armF(x: number, y: number, z: number) {
  const { sh, el } = SJ;
  let d = ell(x, y, z, 3.3, 10.9, 5.0, 0.95, 2.3, 1.65);
  d = smin(d, ellV(x, y, z, sh, [1.95, 1.95, 1.95]), 0.8);
  d = smin(d, coneV(x, y, z, sh, el, 1.95, 1.42), 1.0);
  d = smin(d, ell(x, y, z, 3.8, 6.4, 3.5, 1.35, 2.0, 1.3), 1.0);
  d = smin(d, ell(x, y, z, 3.9, 7.0, 6.3, 1.25, 1.7, 1.1), 0.8);
  return d;
}
function foreF(x: number, y: number, z: number) {
  const { el, wr } = SJ;
  let d = ellV(x, y, z, el, [1.42, 1.4, 1.45]);
  d = smin(d, coneV(x, y, z, el, wr, 1.48, 1.12), 0.8);
  d = smin(d, ell(x, y, z, 3.95, 3.5, 5.35, 1.3, 1.65, 1.15), 0.8);
  d = smin(d, ell(x, y, z, 3.9, 3.8, 3.9, 0.9, 1.2, 0.7), 0.6);
  return d;
}
function pawF(x: number, y: number, z: number) {
  const px = x - SJ.paw[0], py = y, pz = z - SJ.paw[2];
  const wide = 1 + 0.06 * pz;
  let d = rbox(px / wide, py, pz, 0, 0.78, -0.25, 1.62, 0.76, 1.65, 0.62);
  d = smin(d, ell(px, py, pz, 0, 1.15, -0.45, 1.45, 0.7, 1.5), 0.6);
  d = smin(d, ell(px, py, pz, -0.05, 1.65, -1.7, 1.2, 1.1, 1.18), 0.7);
  d = smin(d, ell(px, py, pz, 0, 0.95, -2.05, 0.62, 0.55, 0.46), 0.3);
  for (let k = 0; k < 4; k++) d = smin(d, ell(px, py, pz, TOE_X[k], 1.0, 1.0, 0.5, 0.46, 0.5), 0.3);
  d = smin(d, ell(px, py, pz, -1.66, 1.35, -1.2, 0.34, 0.42, 0.36), 0.2);
  d = smin(d, tube(px, py, pz, [[-1.78, 1.2, -0.95], [-1.86, 0.9, -0.72], [-1.8, 0.65, -0.64]], [0.16, 0.11, 0.05]), 0.05);
  return Math.max(d, -py);
}
interface Toe {
  K: V3;
  T: V3;
  claw: V3[];
}
function toeGeom(k: number): Toe {
  const K: V3 = [SJ.paw[0] + TOE_X[k], 0.9, SJ.paw[2] + 1.0];
  const T: V3 = [K[0] + TOE_X[k] * 0.12, 0.66, K[2] + TOE_L[k]];
  const claw: V3[] = [[T[0], 0.72, T[2] + 0.05], [T[0], 0.56, T[2] + 0.36], [T[0], 0.24, T[2] + 0.5]];
  return { K, T, claw };
}
function toeF(k: number, broken: boolean): Field {
  const g = toeGeom(k);
  return (x, y, z) => {
    let d = coneV(x, y, z, g.K, g.T, 0.56, 0.48);
    d = smin(d, ell(x, y, z, (g.K[0] + g.T[0]) / 2, 0.32, (g.K[2] + g.T[2]) / 2 + 0.1, 0.42, 0.28, 0.5), 0.2);
    const claw = tube(x, y, z, broken ? g.claw.slice(0, 2) : g.claw, broken ? [0.2, 0.15] : [0.2, 0.14, 0.06]);
    d = Math.min(d, claw);
    return Math.max(d, -y);
  };
}
const legPaint = (x: number, y: number, z: number, nx: number, ny: number, nz: number) => stone(x, y, z, nx, ny, nz, { lichen: 0.6, blocks: y < 3.2 });
function toePaint(k: number): Paint {
  const g = toeGeom(k);
  return (x, y, z, nx, ny, nz) => {
    const ax = Math.abs(x);
    const tz = z - g.T[2];
    if (tz > 0.2 && Math.abs(ax - Math.abs(g.T[0])) < 0.26) return tz > 0.4 ? pk(ny > 0.3 ? GOLD.hi : GOLD.base, VF.METAL) : pk(ny > 0.3 ? 0x6e5a44 : 0x4e3e2e);
    return stone(x, y, z, nx, ny, nz, { lichen: 0.3, blocks: true });
  };
}

// ----------------------------------------------------------------------------- hind legs (left-local)
function thighF(x: number, y: number, z: number) {
  const { hp, kn } = SJ;
  let d = ell(x, y, z, 3.0, 9.3, -9.3, 1.8, 2.9, 3.2);
  d = smin(d, coneV(x, y, z, hp, kn, 2.2, 1.35), 1.2);
  d = smin(d, ell(x, y, z, 3.6, 6.9, -7.4, 1.35, 1.7, 1.45), 1.0);
  d = smin(d, ell(x, y, z, 3.4, 7.6, -10.4, 1.4, 2.0, 1.6), 1.0);
  return d;
}
function shinF(x: number, y: number, z: number) {
  const { kn, hk } = SJ;
  let d = ellV(x, y, z, kn, [1.35, 1.35, 1.35]);
  d = smin(d, coneV(x, y, z, kn, hk, 1.32, 0.82), 0.9);
  d = smin(d, ell(x, y, z, 3.62, 5.0, -9.2, 1.05, 1.65, 1.2), 0.9);
  d = smin(d, coneV(x, y, z, [3.6, 4.4, -10.4], hk, 0.45, 0.4), 0.4);
  return d;
}
function footF(x: number, y: number, z: number) {
  const { hk, ank, hpaw } = SJ;
  let d = ellV(x, y, z, hk, [0.92, 0.92, 1.0]);
  d = smin(d, coneV(x, y, z, hk, ank, 0.86, 0.9), 0.6);
  const px = x - hpaw[0], py = y, pz = z - hpaw[2];
  d = smin(d, rbox(px, py, pz, 0, 0.66, -0.1, 1.42, 0.64, 1.5, 0.52), 0.6);
  d = smin(d, ell(px, py, pz, 0, 1.0, -0.3, 1.25, 0.6, 1.35), 0.5);
  for (let k = 0; k < 4; k++) {
    const tx = TOE_X[k] * 0.85, tl = TOE_L[k] * 0.8;
    d = smin(d, cone(px, py, pz, tx, 0.75, 1.0, tx * 1.1, 0.55, 1.0 + tl, 0.45, 0.38), 0.25);
    d = Math.min(d, tube(px, py, pz, [[tx * 1.1, 0.62, 1.05 + tl], [tx * 1.1, 0.45, 1.3 + tl], [tx * 1.1, 0.2, 1.4 + tl]], [0.19, 0.13, 0.06]));
  }
  return Math.max(d, -py);
}

// ----------------------------------------------------------------------------- tail
function tailF(i: number): Field {
  const a = TAIL[i], b = TAIL[i + 1];
  return (x, y, z) => {
    let d = coneV(x, y, z, a, b, TAIL_R[i], TAIL_R[i + 1]);
    d = smin(d, ellV(x, y, z, a, [TAIL_R[i] * 1.04, TAIL_R[i] * 1.04, TAIL_R[i] * 1.04]), 0.2);
    if (i === TAIL.length - 2) {
      // the tuft: chiselled locks flaring like a flame
      const c = add(b, [0.45, 0.05, -0.9]);
      let t = ellV(x, y, z, c, [0.95, 0.8, 1.35]);
      const ang = Math.atan2(y - c[1], x - c[0]);
      t += 0.12 * Math.max(0, Math.sin(ang * 7 + (z - c[2]) * 2.2));
      d = smin(d, t, 0.4);
    }
    if (d > 0.6 || d < -0.6) return d;
    return d + (vn(x * 0.9, y * 0.9, z * 0.9, 41 + i) - 0.5) * 0.12;
  };
}

// ----------------------------------------------------------------------------- the gem and the rig's own (low-res) eyes
function gemF(x: number, y: number, z: number) {
  return ell(x, y, z, GEM_C[0], GEM_C[1], GEM_C[2] + 0.05, 0.98, 1.22, 0.62);
}
function gemPaint(x: number, y: number, z: number, nx: number, ny: number, nz: number) {
  void nz;
  const dx = (x - GEM_C[0]) / 0.98, dy = (y - GEM_C[1]) / 1.22;
  const r = Math.hypot(dx, dy);
  if (r < 0.22 && dx < 0.05 && dy > -0.05) return pk(GEM.white, VF.GLOW);
  if (nx < -0.2 && ny > 0.3 && r > 0.4 && r < 0.6) return pk(GEM.hi, VF.GLOW);
  return pk(r < 0.5 ? GEM.hi : r < 0.82 ? GEM.base : GEM.deep, VF.GLOW);
}

/** paint a modelled eye ball (any resolution): sclera, a molten iris with radial streaks, a cat slit, a glint */
export function paintEye(dx: number, dy: number, dz: number, r: number, kind: 'slit' | 'wide' | 'shut', side: number): number {
  const l = Math.hypot(dx, dy, dz) || 1;
  const fx = dx / l, fy = dy / l, fz = dz / l;
  if (kind === 'shut') return pk(fz > 0.2 ? (fy > 0 ? LIME.base : LIME.shade) : LIME.deep);
  const iris = 0.74; // cos of the iris' half angle
  if (fz < iris) {
    if (fz < 0.1) return pk(EYE.scleraD);
    return pk(fy < -0.35 ? EYE.scleraD : EYE.sclera);
  }
  const ax = fx, ay = fy; // offsets across the front
  const rr = Math.hypot(ax, ay) / Math.sqrt(1 - iris * iris);
  const pw = kind === 'slit' ? 0.075 : 0.3, ph = kind === 'slit' ? 0.58 : 0.4;
  if ((ax / pw) ** 2 + (ay / ph) ** 2 < 1) return pk(EYE.pupil);
  // glint: upper outer
  if (Math.hypot(ax + side * 0.2, ay - 0.24) < 0.085) return pk(EYE.glint, VF.GLOW);
  if (rr > 0.9) return pk(EYE.ring, VF.GLOW);
  const ang = Math.atan2(ay, ax);
  const streak = h3(Math.floor((ang + 3.2) * 9), 1, 1, 7);
  const c = rr < 0.42 ? EYE.iris0 : rr < 0.72 ? (streak > 0.5 ? EYE.iris1 : EYE.iris0) : streak > 0.35 ? EYE.iris2 : EYE.iris1;
  void r;
  return pk(c, VF.GLOW);
}
/** a high-resolution modelled eye (pivot = the eyeball's centre, looking down +Z) */
export function sphinxEyeModel(kind: 'slit' | 'wide' | 'shut', side: number, S_eye = 36): { model: VoxelModel; voxelSize: number } {
  const m = new VoxelModel('sphinx_eye_' + kind);
  const R = EYE_R * S_eye; // metres → voxels
  const n = Math.ceil(R) + 1;
  for (let i = -n; i < n; i++)
    for (let j = -n; j < n; j++)
      for (let k = -n; k < n; k++) {
        const x = i + 0.5, y = j + 0.5, z = k + 0.5;
        if (x * x + y * y + z * z > R * R) continue;
        const v = paintEye(x, y, z, R, kind, side);
        m.set(i, j, k, v & 0xffffff, v >>> 24);
      }
  return { model: m, voxelSize: 1 / S_eye };
}

// ----------------------------------------------------------------------------- the colossus
function sculptInto(f: Field, box: number[], route: { part: (x: number, y: number, z: number) => VoxelModel | null; plug?: (x: number, y: number, z: number) => VoxelModel | null }, paint: Paint, inner?: (x: number, y: number, z: number) => number) {
  const g = new Grid(S, box);
  g.fill(f);
  g.emit(route, paint, inner);
}
/** route a cell into a crack site of `part` if it lies inside one */
function siteOf(part: string, x: number, y: number, z: number, models: Record<string, VoxelModel>): VoxelModel | null {
  for (const s of SITES) {
    if (s.part !== part) continue;
    if ((x - s.c[0]) ** 2 + (y - s.c[1]) ** 2 + (z - s.c[2]) ** 2 < s.r * s.r) return models[s.name];
  }
  return null;
}
function paintWithSites(part: string, base: Paint): Paint {
  const mine = SITES.filter((s) => s.part === part).map((s) => ({ s, p: sitePaint(s, base) }));
  return (x, y, z, nx, ny, nz) => {
    for (const { s, p } of mine) if ((x - s.c[0]) ** 2 + (y - s.c[1]) ** 2 + (z - s.c[2]) ** 2 < s.r * s.r) return p(x, y, z, nx, ny, nz);
    return base(x, y, z, nx, ny, nz);
  };
}

export interface SphinxBuildOpts {
  /** voxels per metre */
  S?: number;
  /** sculpt only these parts (the rest stay empty) */
  only?: string[];
  /** skip these parts */
  skip?: string[];
}

export function sphinxRig(o: SphinxBuildOpts = {}): RigSpec {
  S = o.S ?? SPHINX_S;
  const want = (name: string) => (!o.only || o.only.includes(name)) && !(o.skip && o.skip.includes(name));
  const rig = new SRig('sphinx', S);
  const J = SJ;
  // ------------------------------------------------------------ surface landmarks (cast onto the fields)
  GEM_C = (() => {
    const p = castOnto(torsoBase, [0, 9.0, 14], [0, 0, -1]);
    return p ? [0, 9.0, p[2] + 0.05] : [0, 9.0, 8.3];
  })() as V3;
  // chips
  CHIPS = [];
  const chipOn = (f: Field, from: V3, to: V3, r: number, n: number, seed: number) => {
    for (let i = 0; i < n; i++) {
      const t = h3(i, 1, 2, seed), a = h3(i, 3, 4, seed) * Math.PI * 2, b = (h3(i, 5, 6, seed) - 0.5) * 2.4;
      const q: V3 = [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t, from[2] + (to[2] - from[2]) * t];
      const dir: V3 = [-Math.cos(a) * Math.cos(b), -Math.sin(b), -Math.sin(a) * Math.cos(b)];
      const st: V3 = [q[0] - dir[0] * 8, q[1] - dir[1] * 8, q[2] - dir[2] * 8];
      const p = castOnto(f, st, dir, 16, 0.08);
      if (!p) continue;
      const rr = r * (0.6 + h3(i, 7, 8, seed) * 0.7);
      CHIPS.push({ c: p, r: [rr * (0.8 + h3(i, 9, 1, seed) * 0.6), rr * (0.6 + h3(i, 2, 9, seed) * 0.5), rr * (0.8 + h3(i, 4, 1, seed) * 0.6)] });
    }
  };
  chipOn(torsoBase, [0, 9.5, -12], [0, 9.6, 7], 0.75, 22, 1);
  chipOn(headF, fromH([0, 1.6, -0.6]), fromH([0, 0.4, 1.0]), 0.36, 6, 2);
  chipOn(pawF, [4.0, 0.9, 6.2], [4.0, 0.9, 8.6], 0.42, 4, 3);
  chipOn((x, y, z) => pawF(-x, y, z), [-4.0, 0.9, 6.2], [-4.0, 0.9, 8.6], 0.42, 4, 4);
  chipOn((x, y, z) => thighF(Math.abs(x), y, z), [0, 9.0, -9.5], [0, 7.0, -7.5], 0.6, 5, 5);
  // crack sites
  SITES.length = 0;
  const site = (name: string, part: string, f: Field, from: V3, dir: V3, r: number, seed: number, fdir: V3) => {
    const p = castOnto(f, from, dir, 20, 0.04) ?? from;
    SITES.push({ name, part, c: p, r, seed, dir: norm(fdir) });
  };
  site('crack_flank', 'belly', torsoBase, [9, 9.8, -2.2], [-1, 0, 0], 2.6, 1, [0.2, -0.9, 0.35]);
  site('crack_back', 'belly', torsoBase, [0, 18, -4.4], [0, -1, 0], 2.5, 2, [0.25, 0, 1]);
  site('crack_shoulder', 'chest', torsoBase, [-9, 10.6, 4.4], [1, 0, 0], 2.3, 3, [0.1, 0.95, -0.3]);
  site('crack_haunch', 'hips', torsoBase, [-9, 10.0, -10.6], [1, 0, 0], 2.4, 4, [0, 0.6, 0.8]);
  site('crack_brow', 'head', headF, fromH([1.1, 1.2, 4.5]), [0, 0, -1], 1.5, 5, [0.6, 0.8, 0]);

  // ------------------------------------------------------------ parts (parents first)
  const M: Record<string, VoxelModel> = {};
  const part = (name: string, parent: string | undefined, pivot: V3) => (M[name] = rig.part(name, parent, pivot));
  part('hips', undefined, J.hips);
  part('belly', 'hips', J.belly);
  part('chest', 'belly', J.chest);
  part('neck', 'chest', J.neck);
  part('head', 'neck', fromH([0, -1.1, -0.9]));
  part('jaw', 'head', fromH(JAW_HINGE));
  part('brow_l', 'head', fromH(BROW[0][0]));
  part('brow_r', 'head', fromH(BROW[1][0]));
  part('eye_l', 'head', fromH(EYE_C));
  part('eye_r', 'head', fromH(mirX(EYE_C)));
  part('lappet_l', 'head', fromH(LAP_T));
  part('lappet_r', 'head', fromH(mirX(LAP_T)));
  part('gem', 'chest', GEM_C);
  for (const sd of ['l', 'r']) {
    const s = sd === 'l' ? 1 : -1;
    const X = (p: V3): V3 => [p[0] * s, p[1], p[2]];
    part('arm_' + sd, 'chest', X(J.sh));
    part('fore_' + sd, 'arm_' + sd, X(J.el));
    part('paw_' + sd, 'fore_' + sd, X(J.wr));
    for (let k = 0; k < 4; k++) part(`toe${k + 1}_${sd}`, 'paw_' + sd, X(toeGeom(k).K));
    part('thigh_' + sd, 'hips', X(J.hp));
    part('shin_' + sd, 'thigh_' + sd, X(J.kn));
    part('foot_' + sd, 'shin_' + sd, X(J.hk));
  }
  for (let i = 0; i < TAIL.length - 1; i++) part('tail' + (i + 1), i === 0 ? 'hips' : 'tail' + i, TAIL[i]);
  for (const st of SITES) part(st.name, st.part, st.c);
  /** a route that drops cells of parts we are not building this pass */
  const only = (m: VoxelModel | null) => (m && want(m.name) ? m : null);

  // ------------------------------------------------------------ torso: one body cut in three, sealed with buried plugs
  const CUT_HB = -6.4, CUT_BC = 1.2;
  const torsoPart = (z: number) => (z < CUT_HB ? 'hips' : z < CUT_BC ? 'belly' : 'chest');
  if (['hips', 'belly', 'chest', 'crack_flank', 'crack_back', 'crack_shoulder', 'crack_haunch'].some(want)) {
    const byPart: Record<string, Paint> = { hips: paintWithSites('hips', torsoPaint), belly: paintWithSites('belly', torsoPaint), chest: paintWithSites('chest', torsoPaint) };
    sculptInto(
      torsoF,
      [-4.6, 4.6, -14.4, 4.6, 14.2, 10.6],
      {
        part: (x, y, z) => {
          const p = torsoPart(z);
          return only(siteOf(p, x, y, z, M) ?? M[p]);
        },
        plug: (x, y, z) => {
          if (torsoBase(x, y, z) > -0.45) return null;
          if (z >= CUT_HB && z < CUT_HB + 1.1) return only(M.hips);
          if (z < CUT_HB && z > CUT_HB - 1.1) return only(M.belly);
          if (z >= CUT_BC && z < CUT_BC + 1.1) return only(M.belly);
          if (z < CUT_BC && z > CUT_BC - 1.1) return only(M.chest);
          return null;
        },
      },
      (x, y, z, nx, ny, nz) => byPart[torsoPart(z)](x, y, z, nx, ny, nz)
    );
  }
  if (want('neck')) sculptInto(neckF, [-3.2, 8.4, 2.8, 3.2, 15.6, 10.4], { part: () => M.neck }, (x, y, z, nx, ny, nz) => stone(x, y, z, nx, ny, nz, { lichen: 1 }));
  // ------------------------------------------------------------ head, jaw (one face, split at the mouth), brows, lappets, eyes
  if (want('head') || want('jaw') || want('crack_brow'))
    sculptInto(
      headF,
      [HC[0] - 3.7 * HS, HC[1] - 4.6 * HS, HC[2] - 3.6 * HS, HC[0] + 3.7 * HS, HC[1] + 3.4 * HS, HC[2] + 3.4 * HS],
      {
        part: (x, y, z) => {
          if (inJaw((x - HC[0]) / HS, (y - HC[1]) / HS, (z - HC[2]) / HS)) return only(M.jaw);
          return only(siteOf('head', x, y, z, M) ?? M.head);
        },
      },
      paintWithSites('head', headPaint),
      headInner
    );
  for (const side of [0, 1]) {
    const sd = side === 0 ? 'l' : 'r', s = side === 0 ? 1 : -1;
    if (want('brow_' + sd)) {
      const pts = BROW[side].map(fromH);
      sculptInto(browF(side), bounds(pts, 0.3), { part: () => M['brow_' + sd] }, (x, y, z, nx, ny, nz) => (vn(x * 3, y * 3, z * 3, 98) < 0.25 ? stone(x, y, z, nx, ny, nz, { clean: true }) : pk(ny > 0.5 ? mix(KOHL, LAPIS, 0.35) : KOHL)));
    }
    if (want('lappet_' + sd)) sculptInto(lappetF(s), bounds([fromH(toLocal(LAP_T, s)), fromH(toLocal(LAP_B, s))], 1.2), { part: () => M['lappet_' + sd] }, lappetPaint);
    if (want('eye_' + sd)) {
      // low-res stand-in eyes (the boss swaps in high-resolution ones)
      const ec = fromH(toLocal(EYE_C, s));
      sculptInto((x, y, z) => Math.hypot(x - ec[0], y - ec[1], z - ec[2]) - EYE_R, bounds([ec], EYE_R + 0.2), { part: () => M['eye_' + sd] }, (x, y, z) => paintEye(x - ec[0], y - ec[1], z - ec[2], EYE_R, 'slit', s));
    }
  }
  if (want('gem')) sculptInto(gemF, [GEM_C[0] - 1.2, GEM_C[1] - 1.4, GEM_C[2] - 0.8, GEM_C[0] + 1.2, GEM_C[1] + 1.4, GEM_C[2] + 0.9], { part: () => M.gem }, gemPaint);
  // ------------------------------------------------------------ legs (each side sculpted on its own: different wear, a snapped claw on the right)
  for (const sd of ['l', 'r']) {
    const s = sd === 'l' ? 1 : -1;
    const F = (f: Field): Field => (x, y, z) => {
      const d = f(x * s, y, z);
      if (d > 0.6 || d < -0.6) return d;
      return smax(d + erode(x, y, z, 0.75), -chipField(x, y, z), 0.08);
    };
    const B = (b: number[]) => (s > 0 ? b : [-b[3], b[1], b[2], -b[0], b[4], b[5]]);
    if (want('arm_' + sd)) sculptInto(F(armF), B([1.2, 2.2, 1.4, 6.0, 13.6, 8.4]), { part: () => M['arm_' + sd] }, legPaint);
    if (want('fore_' + sd)) sculptInto(F(foreF), B([2.2, 0.6, 2.4, 5.6, 6.4, 7.2]), { part: () => M['fore_' + sd] }, legPaint);
    if (want('paw_' + sd)) sculptInto(F(pawF), B([1.9, -0.1, 4.6, 6.1, 3.0, 9.9]), { part: () => M['paw_' + sd] }, legPaint);
    for (let k = 0; k < 4; k++) {
      if (!want(`toe${k + 1}_${sd}`)) continue;
      const g = toeGeom(k);
      const broken = s < 0 && k === 2;
      sculptInto(
        (x, y, z) => {
          const d = toeF(k, broken)(x * s, y, z);
          return d > 0.5 || d < -0.5 ? d : d + (vn(x * 1.5, y * 1.5, z * 1.5, 120 + k) - 0.5) * 0.08;
        },
        B(bounds([g.K, g.T, g.claw[2]], 0.7)),
        { part: () => M[`toe${k + 1}_${sd}`] },
        toePaint(k)
      );
    }
    if (want('thigh_' + sd)) sculptInto(F(thighF), B([0.9, 4.0, -13.0, 5.6, 12.6, -5.2]), { part: () => M['thigh_' + sd] }, legPaint);
    if (want('shin_' + sd)) sculptInto(F(shinF), B([2.0, 2.0, -12.8, 5.3, 7.6, -5.2]), { part: () => M['shin_' + sd] }, legPaint);
    if (want('foot_' + sd)) sculptInto(F(footF), B([1.8, -0.1, -12.8, 5.3, 4.3, -7.2]), { part: () => M['foot_' + sd] }, legPaint);
  }
  // ------------------------------------------------------------ tail
  for (let i = 0; i < TAIL.length - 1; i++) {
    if (!want('tail' + (i + 1))) continue;
    const b = bounds(i === TAIL.length - 2 ? [TAIL[i], TAIL[i + 1], add(TAIL[i + 1], [0.45, 0, -2.3])] : [TAIL[i], TAIL[i + 1]], TAIL_R[i] + 1.1);
    sculptInto(tailF(i), b, { part: () => M['tail' + (i + 1)] }, (x, y, z, nx, ny, nz) => stone(x, y, z, nx, ny, nz, { lichen: 0.5 }));
  }

  // ------------------------------------------------------------ sockets
  rig.socket('mouth', 'head', fromH([0, -1.3, 2.4]));
  rig.socket('throat', 'head', fromH([0, -1.3, 0.8]));
  rig.socket('head_top', 'head', fromH([0, 3.1, 2.4]));
  rig.socket('gem', 'gem', [GEM_C[0], GEM_C[1], GEM_C[2] + 0.7]);
  rig.socket('back', 'belly', [0, 13.0, -3.4]);
  for (const sd of ['l', 'r']) {
    const s = sd === 'l' ? 1 : -1;
    rig.socket('paw_' + sd, 'paw_' + sd, [J.paw[0] * s, 1.0, J.paw[2] + 0.6]);
    rig.socket('hpaw_' + sd, 'foot_' + sd, [J.hpaw[0] * s, 0.5, J.hpaw[2]]);
  }
  rig.socket('tail_tip', 'tail8', add(TAIL[8], [0.45, 0, -1.6]));

  return rig.build({
    kind: 'sphinx',
    boss: true,
    height: 20.5,
    radius: 6,
    length: 33,
    noEyes: true,
    S,
    j: {
      hips: J.hips, belly: J.belly, chest: J.chest, neck: J.neck, head: fromH([0, -1.1, -0.9]),
      sh: [J.sh, mirX(J.sh)], el: [J.el, mirX(J.el)], wr: [J.wr, mirX(J.wr)], paw: [J.paw, mirX(J.paw)],
      hp: [J.hp, mirX(J.hp)], kn: [J.kn, mirX(J.kn)], hk: [J.hk, mirX(J.hk)], hpaw: [J.hpaw, mirX(J.hpaw)],
      toes: [0, 1, 2, 3].map((k) => toeGeom(k).K),
      tail: TAIL,
      hc: HC,
      hs: HS,
      jaw: fromH(JAW_HINGE),
      eyes: [fromH(EYE_C), fromH(mirX(EYE_C))],
      eyeR: EYE_R,
      gem: GEM_C,
      mouth: fromH([0, -1.3, 2.4]),
      lappet: [fromH(LAP_T), fromH(mirX(LAP_T))],
    },
    sites: SITES.map((st) => ({ name: st.name, part: st.part, c: st.c, r: st.r })),
    defaultExpression: 'neutral',
    expressions: {
      neutral: { jaw: 0, brow: [0, 0] },
      smug: { jaw: 0.02, brow: [0.12, -0.04] },
      angry: { jaw: 0.06, brow: [-0.14, 0.14] },
      hurt: { jaw: 0.12, brow: [0.1, -0.1] },
      laugh: { jaw: 0.22, brow: [0.18, -0.12] },
      stunned: { jaw: 0.16, brow: [0.22, -0.22] },
      enraged: { jaw: 0.1, brow: [-0.22, 0.22] },
      defeated: { jaw: 0.3, brow: [0.2, -0.2] },
    },
  });
}
