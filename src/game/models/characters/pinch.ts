// Pinch — Sundown's buddy and Serket's messenger: a real desert scorpion (a
// deathstalker, Leiurus, with a little bark-scorpion slenderness), only cuter in
// the way he moves.
//
// Sculpted in "design millimetres" of a real ~76 mm animal; one design mm is UNIT
// metres in rig space, so at rig scale 1 he is as long as the old Pinch (0.65 m) and
// every existing consumer keeps its sizing. Perched on Sundown (PinchPerch) he is
// scaled down to a believable ~10 cm.
//
// Anatomy, front to back:
//  - prosoma: a trapezoid carapace with granular lyre keels, a median ocular tubercle
//    with two glossy median eyes (parts eye_l / eye_r, with supraciliary ridges that
//    carry the expressions) and three lateral eye beads on each front corner;
//    chelicerae (chelicera_l / _r) under the front margin;
//  - mesosoma: seven tergites with raised posterior margins and three granular keels
//    each, pale intersegmental and pleural membranes between them (he is well fed),
//    sternites, genital operculum and the comb-like pectines underneath;
//  - metasoma: five keeled segments with a dorsal furrow and dark knuckles, the fifth
//    smoky, then the telson: a glossy amber vesicle and a hooked dark aculeus with a
//    single bead of Serket-green venom;
//  - pedipalps: trochanter + femur (arm_*), patella (patella_*), the chela hand with
//    the fixed finger (hand_*) and the movable finger (pincer_*), both fingers with
//    serrated denticle rows;
//  - four pairs of walking legs: leg_*N (coxa, trochanter, femur, patella) and
//    leg_*Nb (tibia, basitarsus, tarsus, two tarsal claws).
// Translucent straw chitin, amber margins, darker knuckles and finger tips, pixel wear.
//
// Scorpion convention (unchanged): body (root), tail1..tail5, stinger, arm_l/arm_r,
// pincer_l/pincer_r (movable finger: rotation.y opens it, negative on the left),
// leg_l1..leg_l4, leg_r1..leg_r4 (rotation.z lifts, rotation.y sweeps), eye_l/eye_r.
// New parts: meso, chelicera_*, patella_*, hand_*, leg_*Nb.
import { VoxelModel, VF } from '../../../engine/voxel/VoxelModel';
import type { RigSpec, PartSpec, V3 } from '../../../engine/voxel/Rig';
import type { Ramp } from '../style';
import { hash3 } from '../../../engine/math/rand';
import { Sc, clamp, lerp, sstep, vadd, vsub, vmul, vdot, vcross, vlen, vnorm, distPoly, shadeRamps, splitOff, mirrorModel } from './sculpt';

export const PINCH_EXPRESSIONS = ['neutral', 'happy', 'angry', 'sleepy', 'surprised', 'determined'] as const;
/** rig metres per design millimetre (rig scale 1) */
export const PINCH_UNIT = 0.011;
/** voxels per design mm of the HD build */
const K_HD = 2.25;
const VS = PINCH_UNIT / K_HD;
/** the build in progress uses this grid (set per build) */
let K = K_HD;
const ramp = (base: number, shade: number, hi: number, dark: number): Ramp => ({ base, shade, hi, dark });

// ================================================================== PALETTE (deathstalker straw)
const STRAW = ramp(0xcca04a, 0xa27a30, 0xe6c676, 0x6e4e1c);
const PALE = ramp(0xd8b766, 0xb39248, 0xeed596, 0x80622c); // legs and sternites, paler
const AMBER = ramp(0xb8741f, 0x8f5614, 0xd99a42, 0x5c360e); // translucent margins, vesicle
const KNUCK = ramp(0x6a4420, 0x4a2e14, 0x8c5f30, 0x2a190a); // knuckles, finger tips, granules
const MEMB = ramp(0xb4a47c, 0x928260, 0xcabd98, 0x665a40); // intersegmental membrane
const SMOKE = ramp(0x9a6a30, 0x765020, 0xb88a48, 0x4c3412); // fifth tail segment
const PECT = ramp(0xeee2ba, 0xd0c298, 0xfff4d8, 0x9a8c66);
const EYE = { ball: 0x0b0907, gloss: 0x2c2620, glint: 0xfffaea, ridge: 0x5a3a18 };
const VENOM = { core: 0xc4ff64, mid: 0x86e030 };
const M = VF.METAL;
const sc = (name: string) => new Sc(name, K);
const vxp = (p: V3): V3 => [p[0] * K, p[1] * K, p[2] * K];
const mir = (p: V3): V3 => [-p[0], p[1], p[2]];

/** per-voxel hash in 0..1 for the voxel holding design point (x, y, z) */
const vh = (x: number, y: number, z: number, salt = 0) => hash3(Math.floor(x * K) + salt * 131, Math.floor(y * K) + 7, Math.floor(z * K) - salt * 17);
/** pixel wear: the odd dark pit and bright scratch on a ramp's base */
function wear(r: Ramp, x: number, y: number, z: number, amt = 0.1) {
  const h = vh(x, y, z, 3);
  if (h < amt * 0.45) return r.shade;
  if (h > 1 - amt * 0.3) return r.hi;
  return r.base;
}
/** granule dots along a keel: every other voxel along the run is a darker bead */
const granule = (t: number, phase = 0) => ((Math.floor(t * K * 0.8 + phase) & 1) === 0 ? STRAW.dark : STRAW.shade);

/** the faint granules of the tergite keels: a light/shade rhythm */
const soft = (t: number, phase = 0) => ((Math.floor(t * K * 0.8 + phase) & 1) === 0 ? STRAW.shade : STRAW.base);

/** direction in the sagittal plane: th measured from -Z (straight back) toward +Y */
const dirTh = (deg: number): V3 => {
  const a = (deg * Math.PI) / 180;
  return [0, Math.sin(a), -Math.cos(a)];
};
/** dorsal normal of a tail segment pointing along dirTh(deg): the inside of the curl */
const nrmTh = (deg: number): V3 => {
  const a = (deg * Math.PI) / 180;
  return [0, Math.cos(a), Math.sin(a)];
};

// ================================================================== BODY PROFILE (prosoma + mesosoma)
/** body half-width along z (design mm): carapace front z=10, tergite 7 ends z=-19.9 */
const HW: [number, number][] = [[-20.5, 1.85], [-18.8, 2.85], [-17.1, 3.6], [-14.4, 4.1], [-9.6, 4.35], [-4.3, 4.25], [0.8, 3.9], [1.2, 3.85], [6, 3.35], [10.2, 2.45]];
const TOP: [number, number][] = [[-20.5, 5.3], [-17.5, 5.95], [-10.4, 6.45], [-3.4, 6.4], [1.0, 6.25], [5, 6.3], [10.2, 5.65]];
const BOT: [number, number][] = [[-20.5, 3.6], [-17.5, 2.95], [-8.7, 2.6], [-1.6, 2.75], [2, 3.05], [10.2, 3.75]];
function curve(keys: [number, number][], z: number) {
  if (z <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++)
    if (z <= keys[i][0]) {
      const a = keys[i - 1], b = keys[i];
      return lerp(a[1], b[1], sstep((z - a[0]) / (b[0] - a[0])));
    }
  return keys[keys.length - 1][1];
}
const hwAt = (z: number) => curve(HW, z);
const topAt = (z: number) => curve(TOP, z);
const botAt = (z: number) => curve(BOT, z);
/** normalised superellipse radius of (x, y) in the body cross-section at z (1 = surface) */
function bodyR(x: number, y: number, z: number, grow = 0, p = 2.5) {
  const t = topAt(z) + grow, b = botAt(z) - grow * 0.5, hw = hwAt(z) + grow;
  const yc = (t + b) / 2, hy = (t - b) / 2;
  return Math.pow(Math.pow(Math.abs(x) / hw, p) + Math.pow(Math.abs(y - yc) / hy, p), 1 / p);
}

const TERG = 7;
const TERG_F = (i: number) => 1.0 - i * 3.05; // front edge of tergite i
const TERG_L = 2.62; // plate length; 0.43 of membrane between plates
const MESO_SPLIT = -7.95; // tergites 4..7 flex as the `meso` part

function body() {
  const m = sc('body');
  // the soft core: membrane under everything, showing between the plates and along the flanks (pleats)
  m.region([-5.2, 2.2, -20.7], [5.2, 6.8, 10.4], (x, y, z) => bodyR(x, y, z, -0.12) <= 1, (x, y, z) => (Math.abs(Math.sin(z * 2.6)) < 0.3 ? MEMB.shade : MEMB.base), { flags: VF.SOFTAO });
  // carapace (prosoma): a trapezoid shield, a little domed, granular lyre keels, dark ocular field
  const lyre = (s: number): V3[] => [[s * 0.55, 6.6, 5.6], [s * 1.05, 6.45, 3.6], [s * 1.9, 6.3, 2.0], [s * 2.8, 6.0, 1.1]];
  const lyreA = lyre(1), lyreB = lyre(-1);
  m.region([-4.4, 3.0, 0.7], [4.4, 7.0, 10.3], (x, y, z) => {
    if (z > 9.6 + 0.35 * Math.cos(x * 0.9) || z < 0.75) return false; // front margin a gentle curve
    const r = bodyR(x, y, z, 0.12);
    return r <= 1 && y > botAt(z) + 1.1;
  }, (x, y, z) => {
    const t = topAt(z);
    if (z > 9.0 && y > t - 1.2) return KNUCK.base; // dark anterior margin
    if (Math.hypot(x, z - 6.6) < 1.9 && y > t - 0.5) return z > 7.6 || Math.abs(x) > 1.2 ? STRAW.dark : KNUCK.hi; // ocular field
    if (y > t - 0.55 && (distPoly([x, y, z], lyreA) < 0.32 || distPoly([x, y, z], lyreB) < 0.32)) return granule(z + x * 0.3);
    if (y < t - 1.4 && Math.abs(x) > hwAt(z) - 0.5) return AMBER.base; // translucent lateral margin
    return wear(STRAW, x, y, z, 0.12);
  });
  // median furrow behind the tubercle
  m.region([-0.4, 5.6, 1.0], [0.4, 7.0, 5.0], (x, y, z) => Math.abs(x) < 0.32 && y > topAt(z) - 0.12, 0, { mode: 'carve' });
  // the median ocular tubercle (the eyes themselves are rig parts)
  m.ell([0, 6.5, 6.65], [1.1, 0.48, 0.95], (x, y, z) => (y > 6.85 && Math.abs(x) < 0.22 ? KNUCK.base : KNUCK.hi));
  // lateral eyes: three tiny glossy beads on each front corner
  for (const s of [1, -1])
    for (const [ex, ey, ez] of [[2.3, 5.55, 9.05], [2.62, 5.4, 8.6], [2.05, 5.62, 8.55]] as V3[]) m.ell([s * ex, ey, ez], [0.3, 0.3, 0.3], (x, y, z) => (y > ey + 0.1 && z > ez ? EYE.gloss : EYE.ball), { flags: M });

  // tergites: arched plates, posterior margin raised and amber, three granular keels (four on the last)
  for (let i = 0; i < TERG; i++) {
    const zF = TERG_F(i), zB = zF - TERG_L;
    const last = i === TERG - 1;
    m.region([-5.4, 3.0, zB - 0.6], [5.4, 7.2, zF + 0.1], (x, y, z) => {
      if (z > zF || z < zB - (last ? 0.25 : 0)) return false;
      const lift = 0.22 * clamp((zF - z) / TERG_L, 0, 1); // shingled: the back edge rides up
      const r = bodyR(x, y - lift, z, 0.1);
      return r <= 1 && y > botAt(z) + (topAt(z) - botAt(z)) * 0.42;
    }, (x, y, z) => {
      const t = topAt(z);
      const back = zF - z;
      if (back > TERG_L - 0.42) return AMBER.base; // posterior margin
      if (back < 0.3) return STRAW.shade; // anterior articulation, tucked under
      const ax = Math.abs(x);
      if (y > t - 0.4) {
        const keels = last ? [1.0 - back * 0.12, 2.1 - back * 0.25] : [0, 1.3];
        for (const kx of keels) if (Math.abs(ax - kx) < 0.26 && back > 0.5) return soft(z, i);
      }
      if (y < t - 1.2 && ax > hwAt(z) - 0.55) return AMBER.shade; // translucent pleural edge
      return wear(STRAW, x, y, z, 0.1);
    });
  }
  // sternites (III-VII) on the belly, with membrane seams
  for (let i = 0; i < 5; i++) {
    const zF = -3.2 - i * 3.4, zB = zF - 3.05 - (i === 4 ? 0.6 : 0);
    m.region([-5, 2.2, zB], [5, 4.5, zF], (x, y, z) => {
      const r = bodyR(x, y, z, 0.06);
      return r <= 1 && y < botAt(z) + (topAt(z) - botAt(z)) * 0.3 && Math.abs(x) < hwAt(z) - 0.45;
    }, (x, y, z) => (zF - z > 2.7 ? AMBER.base : i === 4 && Math.abs(Math.abs(x) - 1.1) < 0.22 ? granule(z) : wear(PALE, x, y, z, 0.08)));
  }
  // prosoma underside: sternum, coxae, genital operculum
  m.rbox([0, 3.05, 2.3], [0.9, 0.35, 0.9], 0.25, STRAW.shade);
  for (const s of [1, -1]) {
    LEG_C.forEach((c, i) => m.ell([s * (c[0] - 0.75), c[1] - 0.05, c[2]], [1.15, 0.5, 0.85 - i * 0.03], (x, y, z) => wear(STRAW, x, y, z, 0.1)));
    m.ell([s * 0.45, 2.75, 0.4], [0.5, 0.25, 0.6], PALE.hi); // operculum halves
  }
  // pectines: a comb on each side behind the last coxae, teeth sweeping the sand
  for (const s of [1, -1]) {
    const a: V3 = [s * 0.8, 2.6, -0.2], b: V3 = [s * 3.7, 2.3, -2.6];
    m.cap(a, b, 0.32, 0.22, PECT.base);
    for (let k = 0; k <= 9; k++) {
      const p = vadd(a, vmul(vsub(b, a), (k + 0.5) / 10.5));
      m.cap(p, vadd(p, [s * 0.15, -0.5, -0.45]), 0.17, 0.1, k % 2 ? PECT.shade : PECT.base);
    }
  }
  shadeRamps(m.m, [STRAW, PALE, AMBER, MEMB, PECT], true);
  return m;
}

// ================================================================== METASOMA (tail) + TELSON
/** segment directions in the rest pose (deg from straight back toward up); the telson after */
const TAIL_TH = [40, 88, 136, 178, 214, 262];
const TAIL_L = [5.0, 5.5, 6.0, 6.4, 7.6];
const TAIL_W = [1.78, 1.62, 1.56, 1.5, 1.46];
const TAIL_H = [1.58, 1.5, 1.45, 1.4, 1.4];
const TAIL0: V3 = [0, 4.75, -20.05];
const tailJoints = (): V3[] => {
  const J: V3[] = [TAIL0];
  for (let i = 0; i < 5; i++) J.push(vadd(J[i], vmul(dirTh(TAIL_TH[i]), TAIL_L[i])));
  return J;
};

function tailSeg(i: number) {
  const m = sc('tail' + (i + 1));
  const a = tailJoints()[i], d = dirTh(TAIL_TH[i]), n = nrmTh(TAIL_TH[i]);
  const L = TAIL_L[i], W = TAIL_W[i], H = TAIL_H[i];
  const R = Math.max(W, H) + 0.7;
  const b = vadd(a, vmul(d, L));
  const lo: V3 = [-R, Math.min(a[1], b[1]) - R, Math.min(a[2], b[2]) - R];
  const hi: V3 = [R, Math.max(a[1], b[1]) + R, Math.max(a[2], b[2]) + R];
  const ramp5 = i === 4 ? SMOKE : STRAW;
  const prof = (u: number) => (u < 0.75 ? lerp(0.7, 1, sstep(u / 0.75)) : u > L - 0.55 ? lerp(1, 0.86, (u - (L - 0.55)) / 0.55) : 1) * (1 + 0.05 * Math.sin((Math.PI * u) / L));
  const local = (x: number, y: number, z: number) => {
    const q = vsub([x, y, z], a);
    return { u: vdot(q, d), v: vdot(q, n), w: x };
  };
  m.region(lo, hi, (x, y, z) => {
    const { u, v, w } = local(x, y, z);
    if (u < -0.3 || u > L + 0.15) return false;
    const s = prof(clamp(u, 0, L));
    const e = Math.pow(Math.abs(w) / (W * s), 2.6) + Math.pow(Math.abs(v) / (H * s), 2.6);
    if (e > 1) return false;
    // dorsal furrow between the dorsal keels
    if (u > 0.8 && u < L - 0.45 && v > H * s * 0.66 && Math.abs(w) < W * s * 0.26) return false;
    return true;
  }, (x, y, z) => {
    const { u, v, w } = local(x, y, z);
    const s = prof(clamp(u, 0, L));
    if (u < 0.62) return u < 0.3 ? MEMB.shade : KNUCK.base; // the dark knuckle (condyle) and its membrane
    if (u > L - 0.28) return KNUCK.hi; // articular rim
    const aw = Math.abs(w) / (W * s);
    if (v > H * s * 0.55 && Math.abs(aw - 0.42) < 0.14) return granule(u, i); // dorsal keels
    if (aw > 0.84 && Math.abs(v) < H * s * 0.3) return granule(u, i + 1); // lateral keels
    if (v < -H * s * 0.8 && Math.abs(aw - 0.3) < 0.14) return granule(u, i + 2); // ventral keels
    if (i === 3 && u > L * 0.6 && vh(x, y, z, 9) < (u - L * 0.6) / L) return SMOKE.base; // the smoke creeping in
    return wear(ramp5, x, y, z, 0.12);
  });
  shadeRamps(m.m, [STRAW, SMOKE, KNUCK], true);
  return m.m;
}

function stinger() {
  const m = sc('stinger');
  const a = tailJoints()[5], d = dirTh(TAIL_TH[5]), n = nrmTh(TAIL_TH[5]);
  const side: V3 = [1, 0, 0];
  // the knuckle where the vesicle meets segment V
  m.ell(vadd(a, vmul(d, 0.35)), [1.0, 0.9, 0.9], KNUCK.base);
  // the vesicle: a glossy amber bulb, the venom glands showing through as a darker core stripe
  const c = vadd(a, vmul(d, 2.35));
  m.oell(c, [d, n, side], [2.25, 1.5, 1.42], (x, y, z) => {
    const q = vsub([x, y, z], c);
    const v = vdot(q, n), u = vdot(q, d);
    if (v > 0.95 && Math.abs(x) < 0.5) return AMBER.hi; // a wet highlight along the back
    if (v < -0.9 && Math.abs(x) < 0.35 && u < 1) return KNUCK.hi; // ventral keel
    if (Math.abs(x) > 1.0 && u > -0.5) return AMBER.shade;
    return u > 1.3 ? SMOKE.base : AMBER.base;
  }, { flags: M });
  // the aculeus: a hooked dark spine continuing the curl, almost black at the point
  const pts: V3[] = [vadd(a, vmul(d, 4.1))];
  const angs = [270, 290, 311, 330];
  for (let k = 0; k < angs.length; k++) pts.push(vadd(pts[k], vmul(dirTh(TAIL_TH[5] + (angs[k] - 262)), 0.85)));
  for (let k = 1; k < pts.length; k++) {
    const t0 = (k - 1) / (pts.length - 1), t1 = k / (pts.length - 1);
    m.cap(pts[k - 1], pts[k], lerp(0.72, 0.1, t0), lerp(0.72, 0.1, t1), k < 2 ? SMOKE.shade : k < 3 ? KNUCK.base : KNUCK.dark, { flags: M });
  }
  // a single bead of Serket's venom on the point
  const tip = pts[pts.length - 1];
  m.ell(vadd(tip, vmul(dirTh(TAIL_TH[5] + 70), 0.12)), [0.26, 0.26, 0.26], VENOM.core, { flags: VF.GLOW });
  shadeRamps(m.m, [KNUCK], false);
  return { m: m.m, tip };
}

// ================================================================== PEDIPALPS
const PP = {
  T: [2.2, 3.8, 9.0] as V3, // trochanter base under the carapace edge
  F: [9.0, 5.2, 10.8] as V3, // femur / patella joint: the femur reaches out sideways
  P: [9.6, 5.3, 16.2] as V3, // patella / hand joint (wrist): the patella runs forward
  H: [8.0, 5.1, 20.4] as V3, // where the fingers spring from the hand (pointing forward and in)
  FF: [[8.81, 5.1, 20.39], [7.6, 5.1, 23.57], [5.7, 5.1, 26.58]] as V3[], // fixed finger (outer)
  MF: [[7.37, 5.1, 19.95], [6.16, 5.1, 23.13], [5.58, 5.1, 26.43]] as V3[], // movable finger (inner)
};
/** a keeled limb segment: tapered capsule, granular dorsal keel, dark knuckle collar at the far end */
function limbSeg(m: Sc, a: V3, b: V3, ra: number, rb: number, base: Ramp, knuckleEnd = true, keel = true, amt = keel ? 0.1 : 0.03) {
  const ab = vsub(b, a), L = vlen(ab);
  m.cap(a, b, ra, rb, (x, y, z) => {
    const t = vdot(vsub([x, y, z], a), ab) / (L * L);
    if (knuckleEnd && t > 0.9) return KNUCK.base;
    if (t < 0.08) return KNUCK.hi;
    if (keel && y > lerp(a[1], b[1], t) + lerp(ra, rb, t) * 0.62) return granule(t * L);
    return wear(base, x, y, z, amt);
  });
}
function armL() {
  const m = sc('arm_l');
  m.ell(vadd(PP.T, [0.35, 0.05, 0.25]), [0.95, 0.85, 0.95], (x, y, z) => wear(PALE, x, y, z)); // trochanter
  limbSeg(m, vadd(PP.T, [0.5, 0.15, 0.3]), PP.F, 0.78, 0.7, STRAW);
  shadeRamps(m.m, [STRAW, PALE], true);
  return m.m;
}
function patellaL() {
  const m = sc('patella_l');
  m.ell(PP.F, [0.88, 0.88, 0.88], KNUCK.base); // knuckle
  limbSeg(m, PP.F, PP.P, 0.8, 0.74, STRAW);
  // a short inner spur and a few setae
  m.cap(vadd(PP.F, [-0.45, 0.2, 1.6]), vadd(PP.F, [-1.05, 0.35, 1.9]), 0.26, 0.08, KNUCK.hi);
  shadeRamps(m.m, [STRAW], true);
  return m.m;
}
function handL() {
  const m = sc('hand_l');
  const d = vnorm(vsub(PP.H, PP.P)), side = vnorm([d[2], 0, -d[0]]), up = vnorm(vcross(d, side));
  // wrist knuckle
  m.ell(PP.P, [0.85, 0.85, 0.85], KNUCK.base);
  // the manus: a slender swollen hand with granular keels
  const c = vadd(vmul(vadd(PP.P, PP.H), 0.5), vmul(d, 0.2));
  m.oell(c, [d, side, up], [2.65, 1.68, 1.42], (x, y, z) => {
    const q = vsub([x, y, z], c);
    const s = vdot(q, side), v = vdot(q, up), u = vdot(q, d);
    if (v > 0.95 && Math.abs(s - 0.2) < 0.22) return granule(u); // dorsal keel
    if (Math.abs(s) > 1.42 && Math.abs(v) < 0.3) return granule(u, 1); // marginal keel
    if (u > 1.9) return AMBER.base; // darkening toward the fingers
    return wear(STRAW, x, y, z, 0.12);
  });
  // fixed finger, serrated on its inner (cutting) edge, darkening to the tip
  fingerPath(m, PP.FF, 0.62, -1);
  shadeRamps(m.m, [STRAW, AMBER], true);
  return m.m;
}
/** a finger along pts, teeth on the side facing `toothSide` (-1: toward -x, +1: toward +x) */
function fingerPath(m: Sc, pts: V3[], r0: number, toothSide: number) {
  const L0 = vlen(vsub(pts[1], pts[0])), L1 = vlen(vsub(pts[2], pts[1])), tot = L0 + L1;
  const col = (z: number) => {
    const t = clamp((z - pts[0][2]) / (pts[2][2] - pts[0][2]), 0, 1);
    return t > 0.78 ? KNUCK.base : t > 0.45 ? AMBER.base : STRAW.base;
  };
  m.cap(pts[0], pts[1], r0, r0 * 0.78, (x, y, z) => col(z));
  m.cap(pts[1], pts[2], r0 * 0.78, 0.14, (x, y, z) => col(z));
  // denticle row: small teeth bumps every ~0.45 mm, a dark/light pixel rhythm
  const n = Math.round(tot / 0.45);
  for (let k = 1; k < n - 1; k++) {
    const s = (k / n) * tot;
    const p = s < L0 ? vadd(pts[0], vmul(vsub(pts[1], pts[0]), s / L0)) : vadd(pts[1], vmul(vsub(pts[2], pts[1]), (s - L0) / L1));
    const r = lerp(r0, 0.16, s / tot);
    m.ell(vadd(p, [toothSide * r * 0.92, -0.05, 0]), [0.2, 0.22, 0.17], k % 2 ? KNUCK.hi : PALE.hi);
  }
  // the tip hook
  m.ell(vadd(pts[2], [toothSide * 0.12, 0, -0.05]), [0.18, 0.18, 0.2], KNUCK.dark);
}
function pincerL() {
  const m = sc('pincer_l');
  m.ell(PP.MF[0], [0.62, 0.6, 0.6], KNUCK.base); // the hinge condyle
  fingerPath(m, PP.MF, 0.58, 1);
  shadeRamps(m.m, [STRAW, AMBER], true);
  return m.m;
}

// ================================================================== CHELICERAE
const CHEL_J: V3 = [0.82, 4.6, 9.5];
function chelL() {
  const m = sc('chelicera_l');
  m.ovoid(CHEL_J, [0.82, 4.35, 11.0], 0.62, 0.48, (x, y, z) => (z > 10.6 ? AMBER.base : wear(STRAW, x, y, z)));
  m.cap([0.95, 4.3, 10.8], [0.9, 4.05, 11.75], 0.24, 0.1, KNUCK.base); // fixed tooth
  m.cap([0.65, 4.15, 10.8], [0.7, 3.95, 11.6], 0.22, 0.09, KNUCK.hi); // movable tooth
  shadeRamps(m.m, [STRAW], true);
  return m.m;
}

// ================================================================== LEGS
const LEG_C: V3[] = [[2.2, 3.3, 8.0], [2.85, 3.15, 6.3], [3.3, 3.05, 4.35], [3.55, 3.0, 2.3]];
const LEG_YAW = [62, 28, -14, -44];
const LEG_LEN = [[4.6, 3.6, 3.5, 3.9], [5.0, 3.8, 3.9, 4.3], [5.6, 4.2, 4.4, 4.7], [6.3, 4.7, 4.9, 5.3]];
/** the jointed chain of leg i in the rest pose: coxa, knee (femur/patella), patella/tibia, ankle, foot */
function legPts(i: number) {
  const C = LEG_C[i], a = (LEG_YAW[i] * Math.PI) / 180, o: V3 = [Math.cos(a), 0, Math.sin(a)], up: V3 = [0, 1, 0];
  const [fe, pa, ti, ta] = LEG_LEN[i];
  const K1 = vadd(C, vadd(vmul(o, fe * 0.55), vmul(up, fe * 0.83)));
  const K2 = vadd(K1, vadd(vmul(o, pa * 0.95), vmul(up, -pa * 0.3)));
  const K3 = vadd(K2, vadd(vmul(o, ti * 0.5), vmul(up, -ti * 0.87)));
  const dy = K3[1] - 0.14, hz = Math.sqrt(Math.max(0.3, ta * ta - dy * dy));
  const F = vadd(K3, vadd(vmul(o, hz), vmul(up, -dy)));
  return { C, K1, K2, K3, F, o };
}
function legUpper(i: number) {
  const m = sc('leg_l' + (i + 1));
  const { C, K1, K2 } = legPts(i);
  m.ell(C, [0.72, 0.62, 0.72], (x, y, z) => wear(PALE, x, y, z, 0.04)); // trochanter
  limbSeg(m, C, K1, 0.64, 0.56, PALE, true, false); // femur
  m.ell(K1, [0.66, 0.66, 0.66], KNUCK.base); // knee
  limbSeg(m, K1, K2, 0.58, 0.5, PALE, false); // patella
  shadeRamps(m.m, [PALE], true);
  return m.m;
}
function legLower(i: number) {
  const m = sc(`leg_l${i + 1}b`);
  const { K2, K3, F, o } = legPts(i);
  m.ell(K2, [0.56, 0.56, 0.56], KNUCK.base);
  limbSeg(m, K2, K3, 0.5, 0.42, PALE, false, false); // tibia
  m.ell(K3, [0.44, 0.44, 0.44], AMBER.base); // ankle
  // basitarsus + telotarsus, thinning, darker toward the claws
  const mid = vadd(vmul(K3, 0.48), vmul(F, 0.52));
  m.cap(K3, mid, 0.4, 0.31, PALE.base);
  m.cap(mid, F, 0.3, 0.2, AMBER.base);
  m.ell(mid, [0.33, 0.33, 0.33], KNUCK.hi);
  // tarsal spines on the underside and the two claws gripping the sand
  for (const t of [0.3, 0.62, 0.85]) {
    const p = vadd(vmul(K3, 1 - t), vmul(F, t));
    m.cap(p, vadd(p, vadd(vmul(o, 0.25), [0, -0.38, 0])), 0.12, 0.05, KNUCK.base);
  }
  for (const s of [-1, 1]) {
    const side: V3 = [-o[2] * s * 0.22, 0, o[0] * s * 0.22];
    m.cap(vadd(F, side), vadd(vadd(F, vmul(o, 0.55)), vadd(side, [0, -0.12, 0])), 0.15, 0.06, KNUCK.dark);
  }
  shadeRamps(m.m, [PALE], true);
  return m.m;
}

// ================================================================== MEDIAN EYES (+ supraciliary ridges for expressions)
type Brow = 'level' | 'arched' | 'low' | 'angry' | 'raised';
const EYE_C: V3 = [0.68, 6.98, 6.75];
function eyeL(brow: Brow, big = false) {
  const m = sc('eye_l');
  const R = big ? 0.68 : 0.58;
  const c = EYE_C;
  // the glossy black bead; one catch-light up front (two when happy)
  m.ell(c, [R, R, R], (x, y, z) => {
    const nx = (x - c[0]) / R, ny = (y - c[1]) / R, nz = (z - c[2]) / R;
    if (brow !== 'low' && ny > 0.2 && nz > 0.25 && nx > -0.1 && nx < 0.6) return EYE.glint;
    if (brow === 'arched' && ny < -0.1 && nz > 0.4 && nx < 0.2) return EYE.glint;
    return ny > 0.35 ? EYE.gloss : EYE.ball;
  }, { flags: M });
  // the supraciliary carina: a granular ridge over the eye (it carries the mood)
  const tilt = brow === 'angry' ? -0.55 : brow === 'arched' ? 0.35 : 0; // + raises the outer end
  const lift = brow === 'raised' ? 0.42 : brow === 'low' ? -0.42 : brow === 'arched' ? 0.12 : 0;
  const a: V3 = [c[0] - 0.62, c[1] + R * 0.78 + lift + (brow === 'angry' ? -0.25 : 0), c[2] + 0.05];
  const b: V3 = [c[0] + 0.6, c[1] + R * 0.6 + lift + tilt, c[2] - 0.25];
  m.cap(a, b, 0.27, 0.23, (x, y, z) => granule(x + z, 2));
  if (brow === 'low') m.ell([c[0] + 0.05, c[1] + 0.12, c[2] + 0.15], [R * 0.95, R * 0.42, R * 0.9], EYE.ridge); // a drowsy hood
  return m.m;
}

// ================================================================== RIG
function build(k: number, name: string): RigSpec {
  K = k;
  const J = (pname: string, model: VoxelModel, joint: V3, parent?: string): PartSpec => ({ name: pname, model, pivot: vxp(joint), attach: vxp(joint), parent });
  const b = body();
  const meso = splitOff(b, 'meso', (x, y, z) => z < MESO_SPLIT);
  // a membrane plug so the flexing joint never opens a gap
  {
    const plug = sc('plug');
    plug.region([-4.6, 2.6, MESO_SPLIT - 0.2], [4.6, 6.5, MESO_SPLIT + 0.9], (x, y, z) => bodyR(x, y, z, -0.25) <= 1, MEMB.shade, { flags: VF.SOFTAO });
    plug.m.forEach((x, y, z, c, f) => {
      if (!meso.has(x, y, z) && !b.m.has(x, y, z)) meso.set(x, y, z, c, f);
    });
  }
  const MESO_J: V3 = [0, 4.6, MESO_SPLIT];
  const parts: PartSpec[] = [J('body', b.m, [0, 4.4, 0.5]), J('meso', meso, MESO_J, 'body')];
  const TJ = tailJoints();
  const tparent = ['meso', 'tail1', 'tail2', 'tail3', 'tail4'];
  for (let i = 0; i < 5; i++) parts.push(J('tail' + (i + 1), tailSeg(i), TJ[i], tparent[i]));
  const st = stinger();
  parts.push(J('stinger', st.m, TJ[5], 'tail5'));
  // pedipalps
  const sides: [string, (p: V3) => V3, (v: VoxelModel, n: string) => VoxelModel][] = [
    ['l', (p) => p, (v) => v],
    ['r', mir, (v, n) => mirrorModel(v, n)],
  ];
  const arm = armL(), pat = patellaL(), hand = handL(), pin = pincerL(), chel = chelL();
  for (const [s, f, mm] of sides) {
    parts.push(J('arm_' + s, mm(arm, 'arm_' + s), f(PP.T), 'body'));
    parts.push(J('patella_' + s, mm(pat, 'patella_' + s), f(PP.F), 'arm_' + s));
    parts.push(J('hand_' + s, mm(hand, 'hand_' + s), f(PP.P), 'patella_' + s));
    parts.push(J('pincer_' + s, mm(pin, 'pincer_' + s), f(PP.MF[0]), 'hand_' + s));
    parts.push(J('chelicera_' + s, mm(chel, 'chelicera_' + s), f(CHEL_J), 'body'));
  }
  // legs
  for (let i = 0; i < 4; i++) {
    const up = legUpper(i), lo = legLower(i), { C, K2 } = legPts(i);
    for (const [s, f, mm] of sides) {
      parts.push(J(`leg_${s}${i + 1}`, mm(up, `leg_${s}${i + 1}`), f(C), 'body'));
      parts.push(J(`leg_${s}${i + 1}b`, mm(lo, `leg_${s}${i + 1}b`), f(K2), `leg_${s}${i + 1}`));
    }
  }
  // eyes + expression variants (ridge moods)
  const eyes = (brow: Brow, big = false) => {
    const l = eyeL(brow, big);
    return { eye_l: l, eye_r: mirrorModel(l, 'eye_r') };
  };
  const open = eyes('level');
  parts.push(J('eye_l', open.eye_l, EYE_C, 'body'), J('eye_r', open.eye_r, mir(EYE_C), 'body'));
  const MOODS: Record<string, [Brow, boolean]> = { happy: ['arched', false], angry: ['angry', false], sleepy: ['low', false], surprised: ['raised', true], determined: ['angry', false] };
  const expressions: Record<string, { parts?: Record<string, VoxelModel> }> = { neutral: {} };
  const cache = new Map<string, Record<string, VoxelModel>>();
  for (const e of PINCH_EXPRESSIONS) {
    const mood = MOODS[e];
    if (!mood) continue;
    const key = mood.join();
    let p = cache.get(key);
    if (!p) cache.set(key, (p = eyes(mood[0], mood[1])));
    expressions[e] = { parts: p };
  }
  // pose metrics for animators (design mm -> rig metres at scale 1)
  const u = (p: V3): V3 => [p[0] * PINCH_UNIT, p[1] * PINCH_UNIT, p[2] * PINCH_UNIT];
  const fixedTip = PP.FF[2];
  return {
    name,
    voxelSize: PINCH_UNIT / k,
    parts,
    sockets: {
      stinger_tip: { part: 'stinger', at: vxp(st.tip) },
      pincer_l_tip: { part: 'hand_l', at: vxp(fixedTip) },
      pincer_r_tip: { part: 'hand_r', at: vxp(mir(fixedTip)) },
      back: { part: 'body', at: vxp([0, 6.6, -4]) },
      head_top: { part: 'body', at: vxp([0, 7.4, 6.6]) },
      mouth: { part: 'body', at: vxp([0, 4.3, 11.2]) },
    },
    meta: {
      length: (PP.FF[2][2] - Math.min(...TJ.map((p) => p[2])) + 1.8) * PINCH_UNIT,
      height: (Math.max(...TJ.map((p) => p[1])) + 1.6) * PINCH_UNIT,
      radius: 0.1,
      /** rig metres per design mm, the body's belly height and the tarsal claw spread (gait / perch code) */
      unit: PINCH_UNIT,
      bellyY: 2.6 * PINCH_UNIT,
      legReach: u([12, 0, 0])[0],
      expressions,
      faceParts: ['eye_l', 'eye_r'],
      eyes: 'voxel',
    },
  };
}

export function pinchRig(): RigSpec {
  return build(K_HD, 'pinch');
}
let brood: RigSpec | null = null;
/** the same scorpion on a coarser grid (same parts and sockets): the brood swarms and tiny far views */
export function pinchBroodRig(): RigSpec {
  return (brood ??= build(1.05, 'pinch_brood'));
}
export const PINCH_VS = VS;
