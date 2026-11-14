// MARK, the moon-mummy cat: the second hunter, freed when Khonsu of the Sands falls.
// An ancient temple guardian of the moon god: a lean, long-limbed black-furred cat
// man with realistic adult proportions (about 7.5 heads, 1.83 m to the crown, the
// ears another 13 cm), bound in aged temple linen. The wraps spiral round every
// limb in overlapping bands (raised edges, tucked seams, tea stains, the odd gap
// where dark fur shows through), and loose strips trail from his forearms, hips and
// hood. A ragged pale cowl is pulled up over his head, pushed into two peaks by the
// tall ears that come out through slits in it. Digitigrade legs (forward stifle, high
// hock, long metatarsus, a real paw with toe beans and claws), a long tail wrapped
// near the root with a silver ring by the tip. Moon-god jewellery in silver and
// lapis: a broad bead collar, a small crescent-and-disc pendant, a crescent diadem on
// the cowl, armlets, bracers engraved with the moon's phases, anklets, ear hoops and
// a belt with a crescent buckle over a pleated shendyt with a lapis-striped apron.
// The eyes are modelled moon-silver glowing irises with slit pupils (no 2D eyes).
//
// Shapes are signed distance fields in centimetres (rig space, origin on the ground
// between the feet, faces +Z, his LEFT = +X), smooth-blended so forms taper and
// flow, then voxelised at 1/128 m (HudKit.sculpt: occupancy normals and exposure
// drive the hand shading). Every part is authored in the shared rig space, so every
// pivot equals its attach point. Rig: humanoid layout (pelvis > torso > head, arms,
// legs) + jaw, ears, eyes, brows, a six-link tail, and rigged loose strips (spring
// chains run by installHairSway via meta.hair.chains); the hood tail is engine cloth
// (meta.cloth.bandana from the `bandana_anchor` socket).
import { VoxelModel, VF } from '../../../engine/voxel/VoxelModel';
import type { RigSpec, PartSpec, SocketSpec, V3, ExpressionSpec } from '../../../engine/voxel/Rig';
import { sculpt, type Surf, smin, sdEll, fbm3, h3 } from '../../ui/HudKit';
import { defaultExpressions } from '../toon/humanoid';
import type { HairChain } from './hairSway';
import { dedupe } from './fleshKit';

export const MARK_VS = 1 / 128;
/** voxels per centimetre */
const K = 1.28;
const MT = VF.SOLID | VF.METAL;
const EM = VF.SOLID | VF.EMISSIVE;
const GL = VF.SOLID | VF.GLOW;
const SO = VF.SOLID | VF.SOFTAO;
const S1 = VF.SOLID;
const TAU = Math.PI * 2;

// ------------------------------------------------------------------ palette (few tones per material)
export const MARK_PAL = {
  lin: { base: 0xd8cbad, alt: 0xcfc09e, old: 0xc2b08a, hi: 0xeee4cc, shade: 0xa99878, dark: 0x7d6d52, stain: 0xb09a6e, seam: 0x8c7b5e },
  hood: { base: 0xe3dac4, hi: 0xf3ecdb, shade: 0xbcb096, dark: 0x8e8268, stain: 0xc4b590 },
  fur: { base: 0x2b2731, shade: 0x1c1a21, hi: 0x48434f, dark: 0x111014, sheen: 0x5d5868 },
  ear: { inner: 0x6c5360, innerSh: 0x4e3b46, tuft: 0xbcb3c3 },
  nose: { base: 0x2c2026, hi: 0x5d4752 },
  mouth: 0x150c10,
  fang: 0xf0e8d8,
  claw: { base: 0xe6ddcb, shade: 0xb9ad96 },
  pad: { base: 0x4a3640, shade: 0x34262e },
  silver: { base: 0xc6cfda, shade: 0x8b97a7, hi: 0xf2f6ff, dark: 0x58627a },
  lapis: { base: 0x2b50a6, shade: 0x1d3a7e, hi: 0x5079cf, dark: 0x132757, fleck: 0xd9c27c },
  moon: { core: 0xeef7ff, rim: 0xa9cdff, deep: 0x6f97de },
  carn: 0x9a3a2c,
  whisker: 0xc9d0da,
  kohl: 0x0c0b10,
  eye: { core: 0xf4fbff, iris: 0xc2dcff, ring: 0x86aaf0, rim: 0x3b4f86, pupil: 0x07080e, glint: 0xffffff },
};
const L = MARK_PAL.lin, HD = MARK_PAL.hood, F = MARK_PAL.fur, SV = MARK_PAL.silver, LP = MARK_PAL.lapis, MN = MARK_PAL.moon;

// ------------------------------------------------------------------ sdf kit (centimetres)
type SD = (x: number, y: number, z: number) => number;
type Paint = (x: number, y: number, z: number, s: Surf) => [number, number];
const hyp = Math.hypot;
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smax = (a: number, b: number, k: number) => -smin(-a, -b, k);

function ell(x: number, y: number, z: number, c: V3, r: V3) {
  return sdEll(x - c[0], y - c[1], z - c[2], r[0], r[1], r[2]);
}
/** tapered capsule a -> b (radius ra -> rb) */
function cone(x: number, y: number, z: number, a: V3, b: V3, ra: number, rb: number) {
  const bx = b[0] - a[0], by = b[1] - a[1], bz = b[2] - a[2];
  const h = clamp(((x - a[0]) * bx + (y - a[1]) * by + (z - a[2]) * bz) / (bx * bx + by * by + bz * bz || 1), 0, 1);
  return hyp(x - a[0] - bx * h, y - a[1] - by * h, z - a[2] - bz * h) - (ra + (rb - ra) * h);
}
/** distance along and around a limb axis: t (cm from a), radial distance, angle around it */
function axial(x: number, y: number, z: number, a: V3, b: V3) {
  let ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const ul = hyp(ux, uy, uz) || 1;
  ux /= ul;
  uy /= ul;
  uz /= ul;
  const px = x - a[0], py = y - a[1], pz = z - a[2];
  const t = px * ux + py * uy + pz * uz;
  const rx = px - ux * t, ry = py - uy * t, rz = pz - uz * t;
  // basis around the axis: e1 ~ +Z (front), e2 = u x e1
  let ex = 0 - ux * uz, ey = 0 - uy * uz, ez = 1 - uz * uz;
  const el = hyp(ex, ey, ez);
  if (el < 1e-3) {
    ex = 1 - ux * ux;
    ey = -uy * ux;
    ez = -uz * ux;
  }
  const e1l = hyp(ex, ey, ez) || 1;
  ex /= e1l;
  ey /= e1l;
  ez /= e1l;
  const fx = uy * ez - uz * ey, fy = uz * ex - ux * ez, fz = ux * ey - uy * ex;
  const th = Math.atan2(rx * fx + ry * fy + rz * fz, rx * ex + ry * ey + rz * ez);
  return { t, r: hyp(rx, ry, rz), th, len: ul };
}

/** the linen: a hand-wound helical strip round an axis (band index, position across the band, gap?) */
interface Wrap {
  band: number;
  f: number;
  gap: boolean;
  th: number;
  t: number;
}
function wrapOn(x: number, y: number, z: number, a: V3, b: V3, pitch: number, seed: number, gapK = 0.1): Wrap {
  const q = axial(x, y, z, a, b);
  const s = q.t + (q.th / TAU) * pitch + 0.55 * Math.sin(q.th * 2 + q.t * 0.17 + seed) + 0.35 * Math.sin(q.th * 3 - q.t * 0.11);
  const u = s / pitch;
  const band = Math.floor(u);
  const seg = Math.floor(((q.th + Math.PI) / TAU) * 5);
  return { band, f: u - band, gap: h3(band, seg, seed, 11) < Math.max(0, gapK - 0.12) * 0.6, th: q.th, t: q.t };
}
/** extra thickness of the wrap layer (raised overlapping edge) */
const wrapThick = (w: Wrap) => (w.gap ? 0 : 0.78);

/** linen colour of a band */
function linen(w: Wrap, x: number, y: number, z: number, s: Surf): number {
  const tone = h3(w.band, 3, 1, 5);
  // one tone per band (most fresh, some older), a lit raised edge, the tucked seam in shadow
  let c = tone < 0.68 ? L.base : tone < 0.9 ? L.alt : L.old;
  if (w.f > 0.86) c = L.shade; // the seam where the next turn overlaps
  else if (fbm3(x * 0.045 + 3, y * 0.035, z * 0.045) > 0.62) c = L.stain; // a few broad tea stains
  if (s.exp < 0.06) c = L.dark;
  return c;
}
/** short dark fur, a sheen on the tops of forms, darker in the undersides */
function fur(x: number, y: number, z: number, s: Surf): number {
  if (s.exp < 0.08) return F.dark;
  if (s.ny < -0.55) return F.shade;
  // a soft sheen on the tops of forms, combed into streaks
  if (s.ny > 0.5 && s.exp > 0.4) return Math.sin(x * 1.7 + y * 0.5 + z * 1.3) > 0.3 ? F.sheen : F.hi;
  return F.base;
}
function silver(s: Surf, x = 0, y = 0, z = 0): number {
  if (s.exp < 0.15) return SV.dark;
  if (s.ny > 0.45 || s.exp > 0.8) return SV.hi;
  if (s.ny < -0.4) return SV.shade;
  return h3(Math.floor(x * 2), Math.floor(y * 2), Math.floor(z * 2), 9) < 0.08 ? SV.shade : SV.base;
}
function lapis(x: number, y: number, z: number, s: Surf): number {
  if (h3(Math.floor(x * 1.3), Math.floor(y * 1.3), Math.floor(z * 1.3), 4) < 0.05) return LP.fleck;
  if (s.ny < -0.4) return LP.shade;
  if (s.ny > 0.5) return LP.hi;
  return LP.base;
}

/** voxelise an sdf given in centimetres (box in cm) */
function carve(name: string, lo: V3, hi: V3, sd: SD, paint: Paint): VoxelModel {
  const box: [number, number, number, number, number, number] = [
    Math.floor(lo[0] * K) - 1, Math.floor(lo[1] * K) - 1, Math.floor(lo[2] * K) - 1,
    Math.ceil(hi[0] * K) + 1, Math.ceil(hi[1] * K) + 1, Math.ceil(hi[2] * K) + 1,
  ];
  return sculpt(name, box, (x, y, z) => sd(x / K, y / K, z / K), (x, y, z, s) => paint((x + 0.5) / K, (y + 0.5) / K, (z + 0.5) / K, s));
}
const sx = (p: V3, s: number): V3 => [p[0] * s, p[1], p[2]];
const vox = (p: V3): V3 => [p[0] * K, p[1] * K, p[2] * K];

// ------------------------------------------------------------------ joints (cm, LEFT side; mirror with sx)
const J = {
  pelvis: [0, 97, 0] as V3,
  waist: [0, 104, 0] as V3,
  neck: [0, 159, 2] as V3,
  jaw: [0, 164.4, 2.2] as V3,
  ear: [5.4, 178, -1.2] as V3,
  eye: [4.15, 170.6, 7.8] as V3,
  brow: [4.1, 173.6, 9.4] as V3,
  shoulder: [19, 148, 0] as V3,
  elbow: [20.6, 120, -1.2] as V3,
  wrist: [21.5, 95, 1.0] as V3,
  fist: [21.0, 85.0, 2.0] as V3,
  hip: [9.5, 92, 0] as V3,
  knee: [10.2, 53, 0.5] as V3,
  hock: [10.4, 19.5, -9.0] as V3,
  ball: [10.6, 3.4, 3.4] as V3,
};
/** tail joints, root to tip */
const TJ: V3[] = [[0, 94.5, -11.2], [0, 88, -22.5], [0, 82.6, -34.5], [0, 80.2, -46.8], [0, 81.2, -58.8], [0, 85.2, -69.8], [0, 91.4, -78.6]];
const TR = [3.2, 2.95, 2.7, 2.45, 2.15, 1.85, 1.25];

// ================================================================== HEAD
/** the almond the eye opening is cut to (outer corner up) */
function almond(x: number, y: number, z: number, s: number, grow = 0) {
  const E = sx(J.eye, s);
  const a = 0.26 * s;
  const dx = x - E[0], dy = y - E[1];
  const lx = dx * Math.cos(a) + dy * Math.sin(a), ly = -dx * Math.sin(a) + dy * Math.cos(a);
  return sdEll(lx, ly, z - E[2] - 1.7, 2.5 + grow, 1.5 + grow, 2.3 + grow);
}
const hoodFront = (y: number) => 3.0 + 0.36 * (y - 170);
function hoodOuter(x: number, y: number, z: number) {
  const th = Math.atan2(x, z);
  let d = ell(x, y, z, [0, 171.2, -2.3], [10.5, 10.8, 11.7]) - 0.45 * Math.sin(th * 6 + y * 0.32) - 0.3 * Math.sin(th * 11 - y * 0.2);
  // the ears push the cowl up into two peaks
  for (const s of [1, -1]) d = smin(d, ell(x, y, z, [5.7 * s, 180.4, -1.6], [4.4, 3.4, 3.6]), 2.2);
  return d;
}
function headCore(x: number, y: number, z: number) {
  let d = ell(x, y, z, [0, 172.4, -0.8], [8.4, 8.0, 9.4]); // cranium
  d = smin(d, ell(x, y, z, [0, 169.5, 5.2], [7.6, 6.2, 5.6]), 2.0); // the face plane
  d = smin(d, ell(x, y, z, [0, 175, 4.2], [6.6, 5.0, 5.2]), 2.0); // forehead
  for (const s of [1, -1]) {
    d = smin(d, ell(x, y, z, [5.6 * s, 167.2, 3.4], [4.8, 4.4, 5.2]), 2.0); // cheekbones
    d = smin(d, ell(x, y, z, [4.0 * s, 173.4, 7.6], [3.4, 1.5, 2.4]), 1.2); // brow ridge
    d = smin(d, ell(x, y, z, [2.5 * s, 164.7, 11.0], [3.0, 2.6, 3.0]), 1.4); // whisker pads
    // cheek ruff: ragged fur tufts flaring back from the jowls
    const th = Math.atan2(y - 164, z + 0.4);
    d = smin(d, ell(x, y, z, [7.2 * s, 164.6, -0.2], [3.9, 5.0, 5.4]) - 0.75 * Math.max(0, Math.sin(th * 7 + 1.3)), 1.6);
  }
  d = smin(d, ell(x, y, z, [0, 166.2, 8.6], [4.8, 3.8, 4.4]), 1.8); // muzzle base
  d = smin(d, cone(x, y, z, [0, 171.4, 8.6], [0, 167.6, 12.7], 2.45, 1.85), 1.2); // nose bridge
  d = Math.min(d, ell(x, y, z, [0, 167.25, 13.25], [1.75, 1.2, 1.15])); // nose leather
  // the eye openings, the philtrum and the mouth line
  for (const s of [1, -1]) d = Math.max(d, -almond(x, y, z, s));
  d = Math.max(d, -cone(x, y, z, [0, 166.2, 13.9], [0, 164.6, 13.4], 0.42, 0.42));
  // below the upper lip is the jaw's
  if (z > 4 && y < 163.0) d = Math.max(d, 163.0 - y);
  return d;
}
function whiskerD(x: number, y: number, z: number, s: number) {
  let d = 99;
  const roots: [number, number, number, number, number, number][] = [
    [3.6, 165.6, 12.2, 12.6, 167.6, 11.0],
    [3.9, 164.8, 12.0, 13.0, 164.9, 10.2],
    [3.8, 164.0, 11.8, 12.2, 162.0, 9.6],
  ];
  for (const [ax, ay, az, bx, by, bz] of roots) {
    const mx = (ax + bx) / 2, my = (ay + by) / 2 + 0.5, mz = (az + bz) / 2 + 0.4;
    d = Math.min(d, cone(x, y, z, [ax * s, ay, az], [mx * s, my, mz], 0.46, 0.42), cone(x, y, z, [mx * s, my, mz], [bx * s, by, bz], 0.42, 0.38));
  }
  return d;
}
function diademD(x: number, y: number, z: number) {
  // a small silver crescent (horns up) cradling a lapis moon disc, on the cowl over the brow
  const c: V3 = [0, 179.2, 6.6];
  const dz = Math.abs(z - c[2]) - 0.55;
  const r = hyp(x - c[0], y - (c[1] + 0.2));
  const cres = Math.max(r - 2.6, -(hyp(x, y - (c[1] + 1.4)) - 2.2));
  const disc = hyp(x, y - (c[1] + 1.0)) - 1.25;
  return { cres: Math.max(cres, dz), disc: Math.max(disc, Math.abs(z - c[2] - 0.2) - 0.65) };
}
function buildHead(): VoxelModel {
  const sd: SD = (x, y, z) => {
    let d = headCore(x, y, z);
    // the cowl: everything behind the face rim, down to the nape, with slits for the ears
    let hd = hoodOuter(x, y, z);
    hd = Math.max(hd, z - hoodFront(y) - 0.4 * Math.sin(y * 0.8 + x * 0.3));
    hd = Math.max(hd, 158.4 - y + (z < -6 ? -2 : 0));
    for (const s of [1, -1]) hd = Math.max(hd, -ell(x, y, z, [5.7 * s, 181.2, -1.5], [3.1, 3.6, 2.1]));
    d = Math.min(d, hd);
    // forehead wrap band under the cowl rim
    if (y > 175.6 && y < 177.8 && z > 1.5) d = Math.min(d, headCore(x, y, z) - 0.75);
    for (const s of [1, -1]) d = Math.min(d, whiskerD(x, y, z, s));
    const dm = diademD(x, y, z);
    d = Math.min(d, dm.cres, dm.disc);
    // fangs under the lip
    for (const s of [1, -1]) d = Math.min(d, cone(x, y, z, [1.55 * s, 163.4, 11.4], [1.45 * s, 161.9, 11.7], 0.55, 0.3));
    return d;
  };
  const paint: Paint = (x, y, z, s) => {
    const dm = diademD(x, y, z);
    if (dm.disc < 0.45) return [hyp(x, y - 180.2) < 0.7 ? MN.core : LP.base, hyp(x, y - 180.2) < 0.7 ? EM : S1];
    if (dm.cres < 0.45) return [silver(s, x, y, z), MT];
    for (const sg of [1, -1]) if (whiskerD(x, y, z, sg) < 0.4) return [MARK_PAL.whisker, S1];
    if (y < 163.6 && z > 10.6 && Math.abs(x) < 2.2) return [MARK_PAL.fang, S1];
    const hc = headCore(x, y, z);
    // cowl surfaces (outside the head)
    if (hc > 0.5) {
      const rim = z > hoodFront(y) - 1.4;
      if (s.exp < 0.14) return [HD.dark, SO];
      if (rim) return [s.ny > 0 ? HD.hi : HD.base, SO];
      const fold = Math.sin(Math.atan2(x, z) * 6 + y * 0.32);
      if (fbm3(x * 0.1, y * 0.1, z * 0.1) > 0.48) return [HD.stain, SO];
      return [fold > 0.55 ? HD.hi : fold < -0.6 ? HD.shade : s.ny < -0.3 ? HD.shade : HD.base, SO];
    }
    // the forehead band
    if (y > 175.6 && y < 177.8 && z > 1.5 && hc > 0.15) return [(y > 177.2 ? L.hi : y < 176.0 ? L.shade : L.base), SO];
    // nose leather
    if (ell(x, y, z, [0, 167.25, 13.25], [1.75, 1.2, 1.15]) < 0.35) return [s.ny > 0.4 ? MARK_PAL.nose.hi : MARK_PAL.nose.base, S1];
    // dark kohl rims round the eyes, the mouth line
    for (const sg of [1, -1]) if (almond(x, y, z, sg, 0.75) < 0) return [MARK_PAL.kohl, S1];
    if (y < 164.0 && z > 9) return [MARK_PAL.mouth, S1];
    // whisker pads paler, tiny dark whisker pores
    for (const sg of [1, -1]) {
      if (ell(x, y, z, [2.5 * sg, 164.7, 11.0], [3.05, 2.65, 3.05]) < 0.4 && s.nz > 0.2) {
        return [h3(Math.floor(x * K), Math.floor(y * K), Math.floor(z * K), 3) < 0.12 ? F.dark : F.hi, S1];
      }
    }
    return [fur(x, y, z, s), S1];
  };
  return carve('head', [-14, 157, -15.5], [14, 186, 16], sd, paint);
}

/** the lower jaw: chin, mouth floor, a little tongue, the lower fangs */
function buildJaw(): VoxelModel {
  const sd: SD = (x, y, z) => {
    let d = ell(x, y, z, [0, 161.5, 8.4], [3.3, 1.9, 3.5]);
    for (const s of [1, -1]) d = smin(d, cone(x, y, z, [3.8 * s, 162.6, 3.2], [1.2 * s, 161.4, 10.6], 1.9, 1.4), 1.2);
    d = Math.max(d, y - 163.2);
    for (const s of [1, -1]) d = Math.min(d, cone(x, y, z, [1.2 * s, 162.6, 10.7], [1.2 * s, 163.5, 10.9], 0.45, 0.3));
    return d;
  };
  const paint: Paint = (x, y, z, s) => {
    if (y > 162.9 && z > 10.2) return [MARK_PAL.fang, S1];
    if (s.ny > 0.6 && z > 4.5) return [y > 162.8 && Math.abs(x) < 1.6 ? 0x7a3f4c : MARK_PAL.mouth, S1];
    if (s.ny < -0.3 && z > 6) return [F.hi, S1]; // the pale chin tuft
    return [fur(x, y, z, s), S1];
  };
  return carve('jaw', [-6, 158.5, 1], [6, 164, 13], sd, paint);
}

/** a tall ear: thin shell with a deep inner cup, pale tufts, a torn notch, linen at the base (left: hoops) */
function buildEar(s: number): VoxelModel {
  const B: V3 = [5.6 * s, 179.0, -1.3], T: V3 = [8.8 * s, 196.2, -2.8];
  // flatten front-to-back: squash the z distance about the ear plane
  const sq = (x: number, y: number, z: number) => {
    const zc = lerp(B[2], T[2], clamp((y - B[1]) / (T[1] - B[1]), 0, 1));
    return [x, y, zc + (z - zc) * 1.75] as V3;
  };
  const outer = (x: number, y: number, z: number) => {
    const p = sq(x, y, z);
    return cone(p[0], p[1], p[2], B, T, 4.1, 0.45);
  };
  const cup = (x: number, y: number, z: number) => {
    const p = sq(x, y, z - 1.5);
    return cone(p[0], p[1], p[2], [B[0], B[1] + 1.6, B[2]], [T[0] - 0.5 * s, T[1] - 2.2, T[2]], 2.9, 0.15);
  };
  const sd: SD = (x, y, z) => {
    let d = Math.max(outer(x, y, z), -cup(x, y, z));
    d = Math.max(d, 176.5 - y);
    if (s > 0) d = Math.max(d, -(hyp(x - 8.3, y - 190.8, z + 2.0) - 1.0)); // the torn notch
    // linen round the base
    if (y > 179 && y < 182.6) d = Math.min(d, outer(x, y, z) - 0.7);
    // two silver hoops through the left ear's rim
    if (s > 0)
      for (const [hy, hz] of [[186.8, -2.4], [189.0, -2.5]]) {
        const cx = 9.25 + (hy - 186.8) * 0.18;
        const ring = hyp(hyp(x - cx, y - hy) - 0.95, z - hz) - 0.42;
        d = Math.min(d, ring);
      }
    return d;
  };
  const paint: Paint = (x, y, z, sf) => {
    if (s > 0 && x > 8.9 && y > 185.5 && y < 190.6 && outer(x, y, z) > 0.2) return [silver(sf, x, y, z), MT];
    if (y > 179 && y < 182.6 && outer(x, y, z) > -0.3) return [y > 182 ? L.hi : y < 179.6 ? L.shade : L.base, SO];
    if (cup(x, y, z) < 0.7 && sf.nz > -0.2) {
      const tuft = Math.sin(y * 2.1 + x * 1.3) > 0.55 && y < 190;
      return [tuft ? MARK_PAL.ear.tuft : sf.exp < 0.25 ? MARK_PAL.ear.innerSh : MARK_PAL.ear.inner, S1];
    }
    return [fur(x, y, z, sf), S1];
  };
  return carve(s > 0 ? 'ear_l' : 'ear_r', [Math.min(B[0], T[0]) - 5, 176, -7], [Math.max(B[0], T[0]) + 5, 198, 4], sd, paint);
}

export type MarkEyeVar = 'open' | 'narrow' | 'wide' | 'closed' | 'happy';
/** a modelled cat eye: a glowing moon-silver iris filling the almond, a slit pupil, a wet glint; lids per variant */
function buildEye(s: number, v: MarkEyeVar): VoxelModel {
  const E = sx(J.eye, s);
  const a = 0.26 * s;
  const loc = (x: number, y: number) => {
    const dx = x - E[0], dy = y - E[1];
    return [dx * Math.cos(a) + dy * Math.sin(a), -dx * Math.sin(a) + dy * Math.cos(a)];
  };
  // lid line (local y): above it the upper lid covers, below `low` the lower lid
  const top = v === 'narrow' ? 0.35 : v === 'closed' ? -2.5 : v === 'happy' ? 0.55 : v === 'wide' ? 9 : 1.05;
  const low = v === 'happy' ? -0.25 : v === 'closed' ? -9 : -9;
  const ball = (x: number, y: number, z: number) => ell(x, y, z, E, [2.3, 1.95, 1.85]);
  const lid = (x: number, y: number, z: number) => {
    const [, ly] = loc(x, y);
    const sh = Math.max(ell(x, y, z, [E[0], E[1], E[2] + 0.15], [2.55, 2.2, 2.1]), -ball(x, y, z));
    return Math.max(sh, ly > top || ly < low ? -1 : 1);
  };
  const sd: SD = (x, y, z) => Math.min(ball(x, y, z), lid(x, y, z));
  const paint: Paint = (x, y, z, sf) => {
    const [lx, ly] = loc(x, y);
    if (lid(x, y, z) < 0.3 && ball(x, y, z) > 0.1) {
      // the lid's edge is the dark kohl line
      if (Math.abs(ly - top) < 0.55 || Math.abs(ly - low) < 0.55) return [MARK_PAL.kohl, S1];
      return [sf.ny > 0.3 ? F.hi : F.base, S1];
    }
    const front = z - E[2];
    if (front < 0.5) return [MARK_PAL.eye.rim, S1];
    const slit = v === 'wide' ? hyp(lx, ly * 0.9) < 1.05 : Math.abs(lx) < (v === 'narrow' ? 0.42 : 0.56) && Math.abs(ly) < 1.6;
    if (slit) return [MARK_PAL.eye.pupil, S1];
    // the glint: upper left, the same for both eyes
    if (hyp(x - E[0] - 0.85, y - E[1] - 0.8) < 0.5 && front > 1.2) return [MARK_PAL.eye.glint, GL];
    const r = hyp(lx * 0.9, ly);
    if (r < 0.95) return [MARK_PAL.eye.core, GL];
    if (r < 1.55) return [MARK_PAL.eye.iris, GL];
    return [r < 2.0 ? MARK_PAL.eye.ring : MARK_PAL.eye.rim, EM];
  };
  return carve(s > 0 ? 'eye_l' : 'eye_r', [E[0] - 3.2, E[1] - 3, E[2] - 2.6], [E[0] + 3.2, E[1] + 3, E[2] + 2.8], sd, paint);
}

/** brow: a fur ridge over the eye with two long silver brow whiskers */
function buildBrow(s: number): VoxelModel {
  const C = sx(J.brow, s);
  const ridge = (x: number, y: number, z: number) => {
    const a = 0.32 * s;
    const dx = x - C[0], dy = y - C[1];
    return sdEll(dx * Math.cos(a) + dy * Math.sin(a), -dx * Math.sin(a) + dy * Math.cos(a), z - C[2], 2.7, 0.8, 1.15);
  };
  const wh = (x: number, y: number, z: number) =>
    Math.min(
      cone(x, y, z, [C[0] + 0.9 * s, C[1] + 0.4, C[2] + 0.3], [C[0] + 3.9 * s, C[1] + 5.0, C[2] + 0.9], 0.52, 0.44),
      cone(x, y, z, [C[0] + 1.6 * s, C[1] + 0.3, C[2]], [C[0] + 5.2 * s, C[1] + 4.0, C[2] - 0.8], 0.5, 0.42)
    );
  return carve(s > 0 ? 'brow_l' : 'brow_r', [C[0] - 4, C[1] - 2, C[2] - 3], [C[0] + 6.5, C[1] + 6.5, C[2] + 3], (x, y, z) => Math.min(ridge(x, y, z), wh(x, y, z)), (x, y, z, sf) => [wh(x, y, z) < 0.35 ? MARK_PAL.whisker : sf.ny > 0.3 ? F.hi : F.base, S1]);
}

// ================================================================== TORSO
function torsoBody(x: number, y: number, z: number) {
  let d = ell(x, y, z, [0, 110, 0.6], [11.6, 9.6, 9.0]); // abdomen
  d = smin(d, ell(x, y, z, [0, 128.5, 0.8], [15.6, 15.5, 11.2]), 4); // ribcage
  for (const s of [1, -1]) {
    d = smin(d, ell(x, y, z, [6.6 * s, 136, 7.0], [7.2, 5.4, 4.0]), 2.5); // pectorals
    d = smin(d, ell(x, y, z, [9.2 * s, 128, -4.6], [7.0, 12.0, 5.4]), 3); // lats
    d = smin(d, ell(x, y, z, [7.4 * s, 140, -8.0], [5.2, 6.4, 2.6]), 2); // scapulae
    d = smin(d, cone(x, y, z, [0, 150.5, -2.4], [13.4 * s, 148, -1.4], 5.4, 4.4), 3); // trapezius
    d = smin(d, ell(x, y, z, [9.8 * s, 113, 1.0], [3.2, 7.0, 6.0]), 2.5); // obliques
    d = smin(d, ell(x, y, z, [3.1 * s, 117, 8.1], [2.9, 6.2, 1.6]), 1.2); // abdominals
  }
  d = smin(d, cone(x, y, z, [0, 146, -0.6], [0, 161, 2.2], 6.3, 5.3), 2.5); // neck
  return d;
}
const capeHem = (th: number) => 148.5 + 1.6 * Math.sin(th * 5 + 0.6) + 1.1 * Math.sin(th * 11 + 2.1) - (Math.abs(th) > 2.2 ? 9 * (Math.abs(th) - 2.2) : 0);
function capeD(x: number, y: number, z: number) {
  if (y > 159 || y < 133) return 9;
  const th = Math.atan2(x, z);
  if (Math.abs(th) < 1.15 || Math.hypot(x, z + 1) > 16) return 9; // only round the nape and the top of the back
  const fold = 0.5 * Math.sin(th * 9 + y * 0.3);
  const base = torsoBody(x, y, z);
  let d = Math.max(base - 1.7 - fold, -(base - 0.4));
  return Math.max(d, capeHem(th) - y, y - 158.5);
}
function collarD(x: number, y: number, z: number) {
  const rho = hyp(x, z - 0.5);
  const th = Math.atan2(x, z - 0.5);
  if (rho < 6.4 || rho > 18.8 || Math.abs(th) > 1.95) return 9;
  const yc = 152.6 - (rho - 6.4) * 0.46 - Math.max(0, z / 18) * 2.4;
  // a teardrop fringe on the outer row
  if (rho > 16.6) {
    const ph = (((th / 0.16) % 1) + 1) % 1;
    if (Math.abs(ph - 0.5) > 0.32 - (rho - 16.6) * 0.1) return 9;
  }
  return Math.abs(y - yc) - 0.85;
}
function pendantD(x: number, y: number, z: number) {
  const c: V3 = [0, 137.4, 12.3];
  const dz = Math.abs(z - c[2]) - 0.6;
  const cres = Math.max(Math.max(hyp(x, y - c[1]) - 3.9, -(hyp(x, y - (c[1] + 1.8)) - 3.3)), dz);
  const disc = Math.max(hyp(x, y - (c[1] + 1.5)) - 1.7, Math.abs(z - c[2] - 0.25) - 0.7);
  // the chain up to the collar: beads
  let ch = 99;
  for (let i = 0; i < 6; i++) {
    const t = i / 5;
    ch = Math.min(ch, hyp(x, y - lerp(140.8, 146.6, t), z - lerp(12.4, 11.6, t)) - 0.55);
  }
  return { cres, disc, ch };
}
/** where linen covers the torso: 1 the bound waist, 2 the two straps crossing chest and back (0 = bare fur) */
function torsoCover(x: number, y: number, z: number): { kind: number; u: number; e: number } {
  // the wraps open in a V at the throat: dark fur under the collar, the pendant on it
  if (z > 3 && y > 129 && Math.abs(x) < (y - 129) * 0.42 + 0.6 * Math.sin(y * 1.3)) return { kind: 0, u: 0, e: 0 };
  return { kind: 1, u: 0, e: 0 };
}
function buildTorso(): VoxelModel {
  const A: V3 = [0, 100, 0], B: V3 = [0, 150, 0];
  const sd: SD = (x, y, z) => {
    const b = torsoBody(x, y, z);
    let d = b;
    if (b < 2.5 && y < 152 && torsoCover(x, y, z).kind) d = b - 0.8;
    d = Math.min(d, capeD(x, y, z), collarD(x, y, z));
    const pd = pendantD(x, y, z);
    d = Math.min(d, pd.cres, pd.disc, pd.ch);
    // a silver boss between the shoulder blades: the crest mount
    d = Math.min(d, Math.max(hyp(x, y - 139) - 3.6, Math.abs(z + 12.6) - 1.0));
    return d;
  };
  const paint: Paint = (x, y, z, s) => {
    const pd = pendantD(x, y, z);
    if (pd.disc < 0.45) return hyp(x, y - 138.9) < 0.9 ? [MN.core, EM] : [lapis(x, y, z, s), S1];
    if (pd.cres < 0.45 || pd.ch < 0.4) return [silver(s, x, y, z), MT];
    if (hyp(x, y - 139) < 3.9 && z < -11) return hyp(x, y - 139) < 1.6 ? [LP.base, S1] : [silver(s, x, y, z), MT];
    if (collarD(x, y, z) < 0.45 && capeD(x, y, z) > 0.3) {
      const rho = hyp(x, z - 0.5);
      const th = Math.atan2(x, z - 0.5);
      if (rho > 16.6) return [silver(s, x, y, z), MT];
      if (rho > 14.6) return [MN.rim, EM]; // moonstone beads
      if (rho > 11.0) return Math.abs((((th / 0.12) % 1) + 1) % 1 - 0.5) < 0.12 ? [silver(s, x, y, z), MT] : [lapis(x, y, z, s), S1];
      if (rho > 9.2) return [silver(s, x, y, z), MT];
      if (rho > 7.8) return [MARK_PAL.carn, S1];
      return [silver(s, x, y, z), MT];
    }
    if (capeD(x, y, z) < 0.45) {
      if (s.exp < 0.14) return [HD.dark, SO];
      const th = Math.atan2(x, z);
      if (y < capeHem(th) + 1.2) return [HD.shade, SO]; // the frayed hem
      const fold = Math.sin(th * 9 + y * 0.25);
      if (fbm3(x * 0.1 + 7, y * 0.1, z * 0.1) > 0.5) return [HD.stain, SO];
      return [fold > 0.5 ? HD.hi : fold < -0.6 ? HD.shade : HD.base, SO];
    }
    const b = torsoBody(x, y, z);
    const cv = y < 152 ? torsoCover(x, y, z) : { kind: 0, u: 0, e: 0 };
    if (cv.kind === 1) return [linen(wrapOn(x, y, z, A, B, 4.8, 3, 0), x, y, z, s), SO];
    if (cv.kind === 2 && b > 0.25) {
      if (cv.e > 2.4) return [L.shade, SO];
      const band = Math.floor(cv.u / 3.6);
      const f = cv.u / 3.6 - band;
      return [f < 0.14 ? L.hi : f > 0.9 ? L.shade : band % 3 === 2 ? L.alt : L.base, SO];
    }
    return [fur(x, y, z, s), S1];
  };
  return carve('torso', [-24, 99, -17], [24, 162, 15], sd, paint);
}

// ================================================================== PELVIS (+ belt, shendyt)
function pelvisBody(x: number, y: number, z: number) {
  let d = ell(x, y, z, [0, 96, -0.5], [14.2, 10.5, 10.4]);
  d = smin(d, ell(x, y, z, [0, 99.5, 3.4], [11.8, 7.6, 7.6]), 3);
  for (const s of [1, -1]) {
    d = smin(d, ell(x, y, z, [6.4 * s, 90.5, -5.4], [7.2, 8.5, 6.6]), 3); // glutes
    d = smin(d, ell(x, y, z, [9.4 * s, 90, 0.5], [7.4, 8, 7.6]), 3); // thigh roots
  }
  return smin(d, cone(x, y, z, TJ[0], [0, 91, -14.5], 3.6, 3.3), 2); // tail root
}
function kiltR(y: number): [number, number] {
  const k = clamp((101 - y) / 21, 0, 1);
  return [15.8 + k * 4.6, 12.0 + k * 3.6];
}
const kiltHem = (th: number) => 80.4 + 2.2 * Math.sin(th * 7 + 1) + 1.4 * Math.sin(th * 13 + 0.4) + (Math.abs(Math.abs(th) - 1.57) < 0.22 ? 7 : 0);
function kiltD(x: number, y: number, z: number) {
  if (y > 101.5 || y < 77) return 9;
  const th = Math.atan2(x, z + 0.6);
  const [rx, rz] = kiltR(y);
  const pleat = 1 + 0.02 * Math.sin(th * 30);
  const q = hyp(x / (rx * pleat), (z + 0.6) / (rz * pleat));
  let d = Math.abs((q - 1) * Math.min(rx, rz)) - 0.6;
  d = Math.max(d, kiltHem(th) - y);
  if (Math.abs(th) < 0.42) d = Math.max(d, 98 - y); // the apron hangs here instead
  return d;
}
function beltD(x: number, y: number, z: number) {
  const q = hyp(x / 15.7, (z + 0.4) / 11.7);
  let d = Math.max(Math.abs((q - 1) * 11.7) - 0.9, Math.abs(y - 100.9) - 1.7);
  // the crescent buckle
  const c: V3 = [0, 100.9, 12.4];
  const cres = Math.max(Math.max(hyp(x, y - c[1]) - 3.1, -(hyp(x, y - c[1] - 1.4) - 2.6)), Math.abs(z - c[2]) - 0.7);
  d = Math.min(d, cres);
  return d;
}
function buildPelvis(): VoxelModel {
  const A: V3 = [0, 104, 0], B: V3 = [0, 84, 0];
  const sd: SD = (x, y, z) => {
    const b = pelvisBody(x, y, z);
    let d = b < 2 ? b - wrapThick(wrapOn(x, y, z, A, B, 4.6, 8, 0.06)) : b;
    d = Math.min(d, kiltD(x, y, z), beltD(x, y, z));
    return d;
  };
  const paint: Paint = (x, y, z, s) => {
    if (beltD(x, y, z) < 0.45) {
      if (z > 11.4 && Math.abs(x) < 3.4) return [silver(s, x, y, z), MT];
      const th = Math.atan2(x, z + 0.4);
      const seg = Math.floor(th / 0.34);
      return seg % 2 ? [silver(s, x, y, z), MT] : [Math.abs(y - 100.9) > 1.2 ? SV.shade : lapis(x, y, z, s), Math.abs(y - 100.9) > 1.2 ? MT : S1];
    }
    if (kiltD(x, y, z) < 0.45) {
      const th = Math.atan2(x, z + 0.6);
      if (y < kiltHem(th) + 1.3) return [L.seam, SO];
      const p = Math.sin(th * 30);
      return [s.exp < 0.15 ? L.dark : p > 0.6 ? L.hi : p < -0.7 ? L.shade : L.base, SO];
    }
    const w = wrapOn(x, y, z, A, B, 4.6, 8, 0.06);
    if (!w.gap) return [linen(w, x, y, z, s), SO];
    return [fur(x, y, z, s), S1];
  };
  return carve('pelvis', [-22, 76, -19], [22, 104, 16], sd, paint);
}

// ================================================================== ARMS
function upperArmBody(x: number, y: number, z: number, s: number) {
  let d = ell(x, y, z, [19.6 * s, 146.4, 0.3], [5.6, 6.4, 6.2]); // deltoid
  d = smin(d, cone(x, y, z, [19.8 * s, 143, -0.3], sx(J.elbow, s), 4.5, 3.6), 2.5);
  d = smin(d, ell(x, y, z, [20.2 * s, 131, 1.8], [3.9, 7.5, 3.6]), 2); // biceps
  d = smin(d, ell(x, y, z, [20.5 * s, 132, -2.4], [3.6, 8.0, 3.4]), 2); // triceps
  return d;
}
function armletD(x: number, y: number, z: number, s: number) {
  const q = axial(x, y, z, [19.8 * s, 143, -0.3], sx(J.elbow, s));
  return Math.max(Math.abs(q.t - 7.6) - 1.5, q.r - 5.15, 4.0 - q.r);
}
function buildUpperArm(s: number): VoxelModel {
  const A: V3 = [19.8 * s, 143, -0.3], B = sx(J.elbow, s);
  const sd: SD = (x, y, z) => {
    const b = upperArmBody(x, y, z, s);
    let d = b < 2 ? b - wrapThick(wrapOn(x, y, z, A, B, 4.2, 20 + s, 0.1)) : b;
    return Math.min(d, armletD(x, y, z, s));
  };
  const paint: Paint = (x, y, z, sf) => {
    if (armletD(x, y, z, s) < 0.4) {
      const q = axial(x, y, z, A, B);
      return Math.abs(q.t - 7.6) < 0.5 && q.r > 4.9 ? [lapis(x, y, z, sf), S1] : [silver(sf, x, y, z), MT];
    }
    {
      const w = wrapOn(x, y, z, A, B, 4.2, 20 + s, 0.1);
      if (!w.gap) return [linen(w, x, y, z, sf), SO];
    }
    return [fur(x, y, z, sf), S1];
  };
  return carve(s > 0 ? 'arm_l' : 'arm_r', [Math.min(13.5 * s, 26 * s) - 0.5, 115, -8], [Math.max(13.5 * s, 26 * s) + 0.5, 154, 8], sd, paint);
}
function foreBody(x: number, y: number, z: number, s: number) {
  const E = sx(J.elbow, s), W = sx(J.wrist, s), M: V3 = [21.2 * s, 105, 0.4];
  let d = cone(x, y, z, E, M, 4.0, 3.3);
  d = smin(d, cone(x, y, z, M, W, 3.3, 2.6), 2);
  d = smin(d, ell(x, y, z, [21.3 * s, 113, 0.8], [3.6, 6.0, 3.4]), 2); // brachioradialis
  return d;
}
function bracerD(x: number, y: number, z: number, s: number) {
  const q = axial(x, y, z, sx(J.elbow, s), sx(J.wrist, s));
  const t0 = q.len - 9.6, t1 = q.len - 0.8;
  if (q.t < t0 - 0.6 || q.t > t1 + 0.6) return 9;
  const flare = q.t < t0 + 1 ? (t0 + 1 - q.t) * 0.35 : q.t > t1 - 1 ? (q.t - t1 + 1) * 0.35 : 0;
  const R = lerp(3.95, 3.35, clamp((q.t - t0) / (t1 - t0), 0, 1)) + flare;
  return Math.max(q.r - R, Math.max(t0 - q.t, q.t - t1), (R - 1.2) - q.r);
}
/** a loose fist round a grip along +Z (thumb forward): dark paw-hand, ivory claws */
function handD(x: number, y: number, z: number, s: number) {
  let d = ell(x, y, z, [22.1 * s, 89.6, 1.6], [1.7, 4.2, 3.5]); // back of the hand
  d = smin(d, ell(x, y, z, [21.2 * s, 90.4, 1.4], [1.9, 3.4, 3.0]), 1.2); // palm
  const fz = [3.5, 1.6, -0.3, -2.0];
  for (let i = 0; i < 4; i++) {
    const zz = fz[i], r = i === 3 ? 0.82 : 0.95;
    const K0: V3 = [22.3 * s, 86.2 - (i === 3 ? 0.4 : 0), zz], K1: V3 = [21.7 * s, 83.0, zz], K2: V3 = [20.0 * s, 82.5, zz * 0.95], K3: V3 = [19.5 * s, 84.4, zz * 0.92];
    d = smin(d, Math.min(cone(x, y, z, K0, K1, r * 1.08, r), cone(x, y, z, K1, K2, r, r * 0.92), cone(x, y, z, K2, K3, r * 0.92, r * 0.78)), 0.6);
  }
  // the thumb wraps over the front of the grip
  d = smin(d, Math.min(cone(x, y, z, [21.0 * s, 91.0, 3.4], [20.2 * s, 87.8, 4.7], 1.15, 1.0), cone(x, y, z, [20.2 * s, 87.8, 4.7], [20.6 * s, 85.6, 4.6], 1.0, 0.8)), 0.6);
  return d;
}
function clawD(x: number, y: number, z: number, s: number) {
  const fz = [3.5, 1.6, -0.3, -2.0];
  let d = 99;
  for (const zz of fz) d = Math.min(d, cone(x, y, z, [19.6 * s, 84.4, zz * 0.92], [19.4 * s, 85.6, zz * 0.92 + 0.3], 0.5, 0.2));
  return Math.min(d, cone(x, y, z, [20.6 * s, 85.6, 4.6], [20.2 * s, 84.6, 4.4], 0.5, 0.2));
}
function buildForearm(s: number): VoxelModel {
  const A = sx(J.elbow, s), B = sx(J.wrist, s);
  const sd: SD = (x, y, z) => {
    const b = foreBody(x, y, z, s);
    let d = b < 2 ? b - wrapThick(wrapOn(x, y, z, A, B, 4.0, 30 + s, 0.12)) : b;
    d = Math.min(d, bracerD(x, y, z, s), handD(x, y, z, s), clawD(x, y, z, s));
    return d;
  };
  const paint: Paint = (x, y, z, sf) => {
    if (clawD(x, y, z, s) < 0.35) return [sf.ny > 0 ? MARK_PAL.claw.base : MARK_PAL.claw.shade, S1];
    if (bracerD(x, y, z, s) < 0.4) {
      const q = axial(x, y, z, A, B);
      const k = (q.t - (q.len - 9.6)) / 8.8;
      // engraved phase marks on the outer face, a lapis crescent inlay at the middle
      const out = Math.cos(q.th - (s > 0 ? Math.PI / 2 : -Math.PI / 2));
      if (out > 0.55 && Math.abs(k - 0.5) < 0.24 && Math.abs(Math.sin(q.th * 2.5)) < 0.65) return [lapis(x, y, z, sf), S1];
      if (Math.abs(k - 0.08) < 0.05 || Math.abs(k - 0.92) < 0.05) return [SV.dark, MT];
      return [silver(sf, x, y, z), MT];
    }
    if (handD(x, y, z, s) < 0.4) {
      if (sf.nx * s < -0.4 && y < 91) return [MARK_PAL.pad.base, S1]; // palm pads face in
      return [fur(x, y, z, sf), S1];
    }
    const w = wrapOn(x, y, z, A, B, 4.0, 30 + s, 0.12);
    if (!w.gap) return [linen(w, x, y, z, sf), SO];
    return [fur(x, y, z, sf), S1];
  };
  return carve(s > 0 ? 'fore_l' : 'fore_r', [Math.min(15 * s, 27 * s), 79, -6.5], [Math.max(15 * s, 27 * s), 124, 8], sd, paint);
}

// ================================================================== LEGS (digitigrade)
function thighBody(x: number, y: number, z: number, s: number) {
  let d = cone(x, y, z, [9.8 * s, 90, 0], sx(J.knee, s), 7.2, 4.8);
  d = smin(d, ell(x, y, z, [10.3 * s, 74, 3.6], [6.0, 13, 5.4]), 3); // quadriceps
  d = smin(d, ell(x, y, z, [10.0 * s, 73, -3.2], [5.4, 12.5, 5.0]), 3); // hamstrings
  d = smin(d, ell(x, y, z, [6.6 * s, 82, 0.2], [3.6, 9, 4.5]), 2.5); // adductors
  d = smin(d, ell(x, y, z, [10.2 * s, 55, 3.6], [3.4, 3.6, 2.6]), 1.6); // the stifle
  return d;
}
function buildThigh(s: number): VoxelModel {
  const A = sx(J.hip, s), B = sx(J.knee, s);
  const sd: SD = (x, y, z) => {
    const b = thighBody(x, y, z, s);
    return b < 2 ? b - wrapThick(wrapOn(x, y, z, A, B, 4.6, 40 + s, 0.1)) : b;
  };
  const paint: Paint = (x, y, z, sf) => {
    const w = wrapOn(x, y, z, A, B, 4.6, 40 + s, 0.1);
    if (!w.gap) return [linen(w, x, y, z, sf), SO];
    return [fur(x, y, z, sf), S1];
  };
  return carve(s > 0 ? 'thigh_l' : 'thigh_r', [Math.min(1.5 * s, 18.5 * s), 49, -10], [Math.max(1.5 * s, 18.5 * s), 98, 11], sd, paint);
}
const TOES: [number, number][] = [[-2.6, 9.6], [-0.9, 10.6], [0.9, 10.6], [2.6, 9.6]];
function shinBody(x: number, y: number, z: number, s: number) {
  const Kn = sx(J.knee, s), Hk = sx(J.hock, s), Ba = sx(J.ball, s);
  let d = cone(x, y, z, [Kn[0], Kn[1] - 1, Kn[2]], Hk, 4.0, 2.4); // tibia
  d = smin(d, ell(x, y, z, [10.3 * s, 42.5, -2.6], [3.8, 8.5, 4.2]), 2.5); // calf
  d = smin(d, ell(x, y, z, Hk, [2.4, 2.8, 2.9]), 1.4); // the hock
  d = smin(d, ell(x, y, z, [10.4 * s, 20.6, -11.3], [1.8, 2.3, 1.6]), 1); // heel point
  d = smin(d, cone(x, y, z, Hk, Ba, 2.3, 2.0), 1.4); // metatarsus
  d = smin(d, ell(x, y, z, [10.7 * s, 2.7, 6.0], [3.9, 2.6, 5.2]), 1.6); // the paw
  for (const [tx, tz] of TOES) d = smin(d, ell(x, y, z, [(10.7 + tx) * s, 1.75, tz], [1.25, 1.45, 1.7]), 0.6);
  return Math.max(d, -y);
}
function toeClawD(x: number, y: number, z: number, s: number) {
  let d = 99;
  for (const [tx, tz] of TOES) d = Math.min(d, cone(x, y, z, [(10.7 + tx) * s, 1.6, tz + 1.3], [(10.7 + tx) * s, 0.5, tz + 2.3], 0.5, 0.2));
  return d;
}
function ankletD(x: number, y: number, z: number, s: number) {
  const q = axial(x, y, z, sx(J.hock, s), sx(J.ball, s));
  return Math.max(Math.abs(q.t - 3.2) - 1.0, q.r - 3.2, 2.2 - q.r);
}
function buildShin(s: number): VoxelModel {
  const A = sx(J.knee, s), H = sx(J.hock, s), B = sx(J.ball, s);
  const wr = (x: number, y: number, z: number) => (y > 19 ? wrapOn(x, y, z, A, H, 4.2, 50 + s, 0.1) : wrapOn(x, y, z, H, B, 3.6, 60 + s, 0.15));
  const sd: SD = (x, y, z) => {
    const b = shinBody(x, y, z, s);
    let d = b < 2 && y > 7.5 ? b - wrapThick(wr(x, y, z)) : b;
    return Math.min(d, toeClawD(x, y, z, s), ankletD(x, y, z, s));
  };
  const paint: Paint = (x, y, z, sf) => {
    if (toeClawD(x, y, z, s) < 0.35) return [MARK_PAL.claw.base, S1];
    if (ankletD(x, y, z, s) < 0.4) return [silver(sf, x, y, z), MT];
    if (y < 1.3 && sf.ny < -0.5) return [MARK_PAL.pad.base, S1]; // toe beans
    if (y > 7.5) {
      const w = wr(x, y, z);
      if (!w.gap) return [linen(w, x, y, z, sf), SO];
    }
    return [fur(x, y, z, sf), S1];
  };
  return carve(s > 0 ? 'shin_l' : 'shin_r', [Math.min(4 * s, 17 * s), -0.5, -15], [Math.max(4 * s, 17 * s), 58, 15], sd, paint);
}

// ================================================================== TAIL
function buildTailSeg(i: number): VoxelModel {
  const A = TJ[i], B = TJ[i + 1];
  const tip = i === TJ.length - 2;
  const body = (x: number, y: number, z: number) => {
    let d = cone(x, y, z, A, B, TR[i], TR[i + 1]);
    if (tip) {
      // a ragged tuft at the tip
      const q = axial(x, y, z, A, B);
      d = smin(d, cone(x, y, z, B, [B[0], B[1] + 3.2, B[2] - 2.4], TR[i + 1] + 0.4, 0.3) - 0.4 * Math.max(0, Math.sin(q.th * 5 + q.t)), 1);
    }
    return d;
  };
  const ring = (x: number, y: number, z: number) => {
    if (i !== 4) return 9;
    const q = axial(x, y, z, A, B);
    return Math.max(Math.abs(q.t - 5.5) - 1.1, q.r - (TR[i] + 0.75), TR[i] - 0.6 - q.r);
  };
  const wrapped = i < 3;
  const sd: SD = (x, y, z) => {
    const b = body(x, y, z);
    let d = wrapped && b < 2 ? b - wrapThick(wrapOn(x, y, z, A, B, 3.2, 70 + i, 0.18 + i * 0.12)) : b;
    return Math.min(d, ring(x, y, z));
  };
  const paint: Paint = (x, y, z, s) => {
    if (ring(x, y, z) < 0.4) {
      const q = axial(x, y, z, A, B);
      return Math.abs(q.t - 5.5) < 0.35 ? [lapis(x, y, z, s), S1] : [silver(s, x, y, z), MT];
    }
    if (wrapped) {
      const w = wrapOn(x, y, z, A, B, 3.2, 70 + i, 0.18 + i * 0.12);
      if (!w.gap) return [linen(w, x, y, z, s), SO];
    }
    return [fur(x, y, z, s), S1];
  };
  const lo: V3 = [-5, Math.min(A[1], B[1]) - 4, Math.min(A[2], B[2]) - 4], hi: V3 = [5, Math.max(A[1], B[1]) + (tip ? 7 : 4), Math.max(A[2], B[2]) + 4];
  return carve('tail' + (i + 1), lo, hi, sd, paint);
}

// ================================================================== LOOSE STRIPS (spring chains)
interface StripDef {
  name: string;
  parent: string;
  anchor: V3;
  /** segment length (cm) and count */
  seg: number;
  n: number;
  width: number;
  /** ribbon face normal axis: 'x' (on the flanks) or 'z' (front / back) */
  face: 'x' | 'z';
  /** apron colouring (lapis stripes) instead of plain linen */
  apron?: boolean;
  lim: [number, number, number, number];
  stiff?: number;
}
const STRIPS: StripDef[] = [
  { name: 'wrap_la', parent: 'fore_l', anchor: [24.4, 104.5, -1.8], seg: 8.5, n: 2, width: 3.0, face: 'x', lim: [-0.6, 1.4, -0.9, 0.9] },
  { name: 'wrap_ra', parent: 'fore_r', anchor: [-24.2, 102.0, -2.2], seg: 9.5, n: 2, width: 2.8, face: 'x', lim: [-0.6, 1.4, -0.9, 0.9] },
  { name: 'wrap_wl', parent: 'pelvis', anchor: [15.6, 98.6, -6.4], seg: 12.0, n: 2, width: 4.0, face: 'x', lim: [-0.2, 1.3, -0.15, 1.1], stiff: 80 },
  { name: 'wrap_wr', parent: 'pelvis', anchor: [-14.8, 98.2, -8.2], seg: 13.5, n: 2, width: 3.6, face: 'x', lim: [-0.2, 1.3, -1.1, 0.15], stiff: 80 },
  { name: 'apron', parent: 'pelvis', anchor: [0, 99.0, 12.8], seg: 10.6, n: 2, width: 9.4, face: 'z', apron: true, lim: [-1.0, 0.45, -0.25, 0.25], stiff: 140 },
];
function buildStripSeg(st: StripDef, j: number): VoxelModel {
  const a = st.anchor;
  const y0 = a[1] - j * st.seg, y1 = y0 - st.seg - (j < st.n - 1 ? 1.2 : 0);
  const last = j === st.n - 1;
  const w = st.width * (1 - j * 0.08);
  const sd: SD = (x, y, z) => {
    if (y > y0 + 0.4 || y < y1 - 1.5) return 9;
    const k = (y0 - y) / st.seg;
    // a gentle wave in the cloth, the ragged torn end
    const wave = 0.7 * Math.sin(k * 3.4 + j * 1.3 + a[0] * 0.2);
    const along = st.face === 'x' ? z - a[2] : x - a[0];
    const across = st.face === 'x' ? x - a[0] - wave * 0.5 : z - a[2] - wave * 0.4;
    let d = Math.max(Math.abs(along) - w / 2, Math.abs(across) - 0.55);
    if (last) {
      const cut = y1 + 1.2 * Math.sin(along * 1.9 + 1) + 0.8 * Math.sin(along * 4.3);
      d = Math.max(d, cut - y);
      if (st.apron) d = Math.max(d, y1 + 0.2 - y);
    }
    return Math.max(d, y - y0 - 0.4);
  };
  const paint: Paint = (x, y, z, s) => {
    const along = st.face === 'x' ? z - a[2] : x - a[0];
    if (st.apron) {
      const u = Math.abs(along) / (w / 2);
      if (u > 0.82) return [silver(s, x, y, z), MT];
      if (last && y < y1 + 1.6) return [MN.rim, EM]; // a moonstone bead fringe
      const stripe = Math.floor((along + w / 2) / 1.25) % 2;
      if (j === 0 && hyp(along, y - (y0 - 5.0)) < 2.4 && hyp(along, y - (y0 - 4.2)) > 1.9) return [silver(s, x, y, z), MT]; // crescent
      return stripe ? [lapis(x, y, z, s), S1] : [s.ny > 0.2 ? L.hi : L.base, SO];
    }
    if (s.exp < 0.15) return [L.dark, SO];
    if (Math.abs(along) > w / 2 - 0.5) return [L.shade, SO];
    if (last && y < y1 + 1.5) return [L.old, SO];
    return [fbm3(x * 0.15, y * 0.15, z * 0.15) > 0.35 ? L.stain : (h3(j, 1, a[0], 2) > 0.5 ? L.base : L.alt), SO];
  };
  const pad = 3;
  return carve(st.name + (j + 1), [a[0] - st.width - pad, y1 - 3, a[2] - st.width - pad], [a[0] + st.width + pad, y0 + 1, a[2] + st.width + pad], sd, paint);
}

// ================================================================== RIG
export const MARK_EXPRESSIONS = ['neutral', 'focus', 'smug', 'surprised', 'hurt', 'angry', 'laugh', 'wink', 'dead', 'determined'] as const;
const EYE_EXPR: Record<string, [MarkEyeVar, MarkEyeVar]> = {
  focus: ['narrow', 'narrow'],
  smug: ['narrow', 'open'],
  surprised: ['wide', 'wide'],
  hurt: ['narrow', 'closed'],
  angry: ['narrow', 'narrow'],
  laugh: ['happy', 'happy'],
  wink: ['closed', 'open'],
  dead: ['closed', 'closed'],
  determined: ['narrow', 'narrow'],
};

let cached: RigSpec | null = null;
/** Mark, the moon-mummy cat hunter (registry key `mark`) */
export function markRig(): RigSpec {
  if (cached) return cached;
  const parts: PartSpec[] = [];
  const P = (name: string, model: VoxelModel, joint: V3, parent?: string) => {
    if (model.count > 0) parts.push({ name, model, pivot: vox(joint), attach: vox(joint), parent });
  };
  const pelvis = buildPelvis(), torso = buildTorso(), head = buildHead(), jaw = buildJaw();
  const armL = buildUpperArm(1), armR = buildUpperArm(-1), foreL = buildForearm(1), foreR = buildForearm(-1);
  const thighL = buildThigh(1), thighR = buildThigh(-1), shinL = buildShin(1), shinR = buildShin(-1);
  const earL = buildEar(1), earR = buildEar(-1);
  const tails = TJ.slice(0, -1).map((_, i) => buildTailSeg(i));
  // shared cells would z-fight: the parent keeps them
  dedupe(jaw, head);
  dedupe(earL, head);
  dedupe(earR, head);
  dedupe(head, torso);
  dedupe(pelvis, torso);
  for (const a of [armL, armR]) dedupe(a, torso);
  for (const [a, f] of [[armL, foreL], [armR, foreR]] as [VoxelModel, VoxelModel][]) dedupe(f, a);
  for (const [t, sh] of [[thighL, shinL], [thighR, shinR]] as [VoxelModel, VoxelModel][]) {
    dedupe(t, pelvis);
    dedupe(sh, t);
  }
  dedupe(tails[0], pelvis);
  for (let i = 1; i < tails.length; i++) dedupe(tails[i], tails[i - 1]);

  P('pelvis', pelvis, J.pelvis);
  P('torso', torso, J.waist, 'pelvis');
  P('head', head, J.neck, 'torso');
  P('jaw', jaw, J.jaw, 'head');
  const eyeCache = new Map<string, VoxelModel>();
  const eye = (s: number, v: MarkEyeVar) => {
    const k = s + v;
    let m = eyeCache.get(k);
    if (!m) {
      m = buildEye(s, v);
      dedupe(m, head);
      eyeCache.set(k, m);
    }
    return m;
  };
  P('eye_l', eye(1, 'open'), J.eye, 'head');
  P('eye_r', eye(-1, 'open'), sx(J.eye, -1), 'head');
  const browL = buildBrow(1), browR = buildBrow(-1);
  dedupe(browL, head);
  dedupe(browR, head);
  P('brow_l', browL, J.brow, 'head');
  P('brow_r', browR, sx(J.brow, -1), 'head');
  P('ear_l', earL, J.ear, 'head');
  P('ear_r', earR, sx(J.ear, -1), 'head');
  P('arm_l', armL, J.shoulder, 'torso');
  P('fore_l', foreL, J.elbow, 'arm_l');
  P('arm_r', armR, sx(J.shoulder, -1), 'torso');
  P('fore_r', foreR, sx(J.elbow, -1), 'arm_r');
  P('thigh_l', thighL, J.hip, 'pelvis');
  P('shin_l', shinL, J.knee, 'thigh_l');
  P('thigh_r', thighR, sx(J.hip, -1), 'pelvis');
  P('shin_r', shinR, sx(J.knee, -1), 'thigh_r');
  tails.forEach((m, i) => P('tail' + (i + 1), m, TJ[i], i === 0 ? 'pelvis' : 'tail' + i));
  const chains: HairChain[] = [];
  STRIPS.forEach((st, si) => {
    const names: string[] = [];
    for (let j = 0; j < st.n; j++) {
      const m = buildStripSeg(st, j);
      if (j === 0) dedupe(m, st.parent === 'pelvis' ? pelvis : st.parent === 'fore_l' ? foreL : foreR);
      const nm = st.name + (j + 1);
      P(nm, m, [st.anchor[0], st.anchor[1] - j * st.seg, st.anchor[2]], j === 0 ? st.parent : st.name + j);
      names.push(nm);
    }
    chains.push({ parts: names, lim: st.lim, stiff: st.stiff ?? 95, zeta: 0.38, phase: si * 1.7 });
  });

  // expressions: the default jaw / brow angles (a cat's jaw opens less) + the modelled eye variants
  const expressions = defaultExpressions([...MARK_EXPRESSIONS]) as Record<string, ExpressionSpec>;
  for (const e of Object.values(expressions)) if (e.jaw) e.jaw *= 0.55;
  for (const [name, [l, r]] of Object.entries(EYE_EXPR)) if (expressions[name]) expressions[name].parts = { eye_l: eye(1, l), eye_r: eye(-1, r) };

  const sock = (part: string, p: V3, rot?: V3): SocketSpec => ({ part, at: vox(p), rot });
  const sockets: Record<string, SocketSpec> = {
    hand_r: sock('fore_r', sx(J.fist, -1)),
    hand_l: sock('fore_l', J.fist),
    head_top: sock('head', [0, 183.5, -1.5]),
    back: sock('torso', [0, 134, -13.2]),
    crest_back: sock('torso', [0, 139, -14.2]),
    shoulder_l: sock('torso', [17.5, 153.5, -0.5]),
    shoulder_r: sock('torso', [-17.5, 153.5, -0.5]),
    hip_r: sock('pelvis', [-16.4, 95.5, 1.0]),
    hip_l: sock('pelvis', [16.4, 95.5, 1.0]),
    chest: sock('torso', [0, 138, 12.8]),
    eye_l: sock('head', J.eye),
    eye_r: sock('head', sx(J.eye, -1)),
    mouth: sock('jaw', [0, 162.4, 10.4]),
    bandana_anchor: sock('head', [0, 166.5, -13.4]),
    board_back: sock('torso', [0, 131, -14.0]),
    tail_tip: sock('tail6', [0, 93.6, -80.4]),
    paw_l: sock('shin_l', [10.7, 0, 6]),
    paw_r: sock('shin_r', [-10.7, 0, 6]),
  };
  const m = (v: number) => v / 100;
  cached = {
    name: 'mark',
    voxelSize: MARK_VS,
    parts,
    sockets,
    meta: {
      hero: 'mark',
      hd: true,
      height: m(196),
      skullTop: m(183),
      hatTop: m(196),
      chinY: m(160.5),
      radius: 0.3,
      hipY: m(J.hip[1]),
      kneeY: m(J.knee[1]),
      shoulderY: m(J.shoulder[1]),
      elbowY: m(J.elbow[1]),
      handY: m(J.fist[1]),
      upperArmLen: m(J.shoulder[1] - J.elbow[1]),
      foreArmLen: m(J.elbow[1] - J.fist[1]),
      legLen: m(J.hip[1]),
      facePivots: { eye_l: J.eye.map(m), eye_r: sx(J.eye, -1).map(m), brow_l: J.brow.map(m), brow_r: sx(J.brow, -1).map(m), jaw: J.jaw.map(m) },
      eyeColor: MARK_PAL.eye.iris,
      eyes: 'voxel',
      expressions,
      hair: { chains },
      tail: tails.map((_, i) => 'tail' + (i + 1)),
      ears: ['ear_l', 'ear_r'],
      cloth: { bandana: [HD.base, HD.shade], bandanaLen: 0.46 },
      voxels: parts.reduce((n, p) => n + p.model.count, 0),
    },
  };
  return cached;
}
