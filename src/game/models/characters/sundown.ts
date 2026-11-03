// "Sundown" HD — the player: a stylized, high-voxel skeleton cowboy in a punk,
// Ghost-Rider style biker jacket, rebuilt at 1/54 m with a bespoke builder.
//
// DESIGN UNITS: every shape is authored in u = 1/36 m (the legacy humanoid grid,
// see skeleton.ts J) and rasterised onto the 1/54 grid (S = 1.5 voxels per u) by
// the sculpt kit (sculpt.ts). Joints / pivots / sockets are exactly the legacy
// joints * S, so animation, the board stance, cameras and cloth anchors still fit.
// Mirror plane: geometric x = 0. Character LEFT = +X, faces +Z, origin on the ground.
//
// Look ('punk', the new default): a carved skull with a cracked brow, deep sockets
// holding modelled eyeballs with glowing Serket-green pupils, cheekbones, teeth and a
// hinged jaw; readable ribs, sternum, spine, iliac crests and finger bones. A cropped
// black biker jacket thrown open over the rib cage (studded lapels, popped collar,
// zippers, hot-rod flames, back rocker patch), a big spiked pauldron + chain on the
// right shoulder, the left sleeve torn off (short spikes on the stump, Pinch's perch),
// spiked and studded wrist cuffs, red bandana, a saddle-leather board sling across the
// chest, studded gun belt with an oval buckle, ripped skinny jeans with a wallet chain,
// black harness cowboy boots with rowel spurs, and a battered cowboy hat.
import * as THREE from 'three';
import { VoxelModel, VF } from '../../../engine/voxel/VoxelModel';
import { voxelMesh } from '../../../engine/voxel/Rig';
import type { RigSpec, PartSpec, SocketSpec, V3, RigInstance } from '../../../engine/voxel/Rig';
import { TOON, Ramp } from '../style';
import { defaultExpressions } from '../toon/humanoid';
import { SUNDOWN_EXPRESSIONS } from './skeleton';
import { frogWigHat, FROG_WIG_TOP } from '../enemies/frog';
import type { CowboyLook, HatId, OutfitId } from './skeleton';
import { Sc, Col, clamp, lerp, sstep, vadd, vsub, vmul, vdot, vcross, vlen, vnorm, distPoly, spline, resample, shadeRamps, splitOff } from './sculpt';

/** metres per voxel of the HD player build */
export const SUNDOWN_HD_VS = 1 / 54;
const S = 54 / 36; // voxels per design unit
const U = 1 / 36; // metres per design unit
const ramp = (base: number, shade: number, hi: number, dark: number): Ramp => ({ base, shade, hi, dark });

// ================================================================== PALETTE
const BN = ramp(0xf4ddb6, 0xe2c79a, 0xfcebcf, 0xb8936a);
const ENAMEL = 0xfff4de;
const SOCK = { wall: 0x7a4a2a, mid: 0x55331d, deep: 0x311c0f, void: 0x170d07 };
const EYE = { ball: 0x15110e, ring: 0x3fbf24, iris: 0x2a6a1a, core: 0xa8ff4a, glint: 0xf4ffe6, dim: 0x3c4438 };
const LEA = ramp(0x302e33, 0x211f24, 0x58555e, 0x141316); // black biker leather, cool sheen
const LEA_EDGE = 0x67626c;
const CHR = ramp(0xb6bec9, 0x6f7682, 0xf4f8ff, 0x444952);
const FLAME = [0xffd64e, 0xf68a22, 0xdc3a1a];
const FLAME_LINE = 0x8e1c10;
const DEN = ramp(0x3d5379, 0x2d3e5d, 0x5d77a2, 0x1e2a41);
const THREAD = 0xd9a03e;
const FRAY = 0xe6dfcf;
const COPPER = 0xc87a3a;
const STRAP = ramp(0x84502c, 0x663c20, 0xa36a40, 0x3e2414);
const BOOT = ramp(0x2c2729, 0x1d191b, 0x4a4246, 0x0f0d0e);
const SOLE = 0x1b1513;
const HEEL = ramp(0x4b3527, 0x37261b, 0x604534, 0x22150d);
const STITCH = 0x9c9aa4;
const VENOM = 0x8cf03c;
const M = VF.METAL;

// ================================================================== JOINTS (design units, identical to the legacy grid)
const J: Record<string, V3> = {
  pelvis: [0, 26.5, -1.5],
  waist: [0, 29.5, -4.5],
  neck: [0, 46, -1.5],
  jaw: [0, 49.5, -2],
  eye: [3, 54, 6],
  brow: [3, 56.5, 5.5],
  hat: [0, 59, -1],
  shoulder: [8, 42.5, 0],
  elbow: [8, 33, 0],
  hand: [9, 21.5, 0],
  hip: [4, 24, 0],
  knee: [3.5, 15.5, 0],
};
const SKULL_TOP = 63;
const mg = (p: V3): V3 => [-p[0], p[1], p[2]];
const vx = (p: V3): V3 => [p[0] * S, p[1] * S, p[2] * S];
const sc = (name: string) => new Sc(name, S);
const pw = (v: number, p: number) => Math.pow(Math.abs(v), p);

// ================================================================== BODY ENVELOPES (garments are shells around these)
/** rows: [y, half width x, half depth z, centre z]; smooth-interpolated in y */
type Env = [number, number, number, number][];
function envAt(e: Env, y: number): [number, number, number] {
  if (y <= e[0][0]) return [e[0][1], e[0][2], e[0][3]];
  for (let i = 1; i < e.length; i++)
    if (y <= e[i][0]) {
      const a = e[i - 1], b = e[i], t = sstep((y - a[0]) / (b[0] - a[0]));
      return [lerp(a[1], b[1], t), lerp(a[2], b[2], t), lerp(a[3], b[3], t)];
    }
  const l = e[e.length - 1];
  return [l[1], l[2], l[3]];
}
const EP = 2.5;
function rhoOf(e: Env, x: number, y: number, z: number) {
  const [hx, hz, zc] = envAt(e, y);
  return Math.pow(Math.pow(Math.abs(x) / hx, EP) + Math.pow(Math.abs(z - zc) / hz, EP), 1 / EP);
}
/** angle around the body: 0 = back centre, +pi/2 = left side, +-pi = front */
function thetaOf(e: Env, x: number, y: number, z: number) {
  const [hx, hz, zc] = envAt(e, y);
  return Math.atan2(x / hx, -(z - zc) / hz);
}
/** surface point at angle th / height y, pushed out along the normal by off; also returns the normal */
function envPoint(e: Env, th: number, y: number, off: number): { p: V3; n: V3 } {
  const [hx, hz, zc] = envAt(e, y);
  const s = Math.sin(th), c = Math.cos(th);
  const x = hx * Math.sign(s) * Math.pow(Math.abs(s), 2 / EP), z = zc - hz * Math.sign(c) * Math.pow(Math.abs(c), 2 / EP);
  const nx = (Math.sign(x) * Math.pow(Math.abs(x) / hx, EP - 1)) / hx, nz = (Math.sign(z - zc) * Math.pow(Math.abs(z - zc) / hz, EP - 1)) / hz;
  const nl = Math.hypot(nx, nz) || 1;
  const n: V3 = [nx / nl, 0, nz / nl];
  return { p: [x + n[0] * off, y, z + n[2] * off], n };
}
function frontZ(e: Env, x: number, y: number, off: number) {
  const [hx, hz, zc] = envAt(e, y);
  const a = Math.min(0.995, Math.abs(x) / hx);
  return zc + hz * Math.pow(1 - Math.pow(a, EP), 1 / EP) + off;
}
function backZ(e: Env, x: number, y: number, off: number) {
  const [hx, hz, zc] = envAt(e, y);
  const a = Math.min(0.995, Math.abs(x) / hx);
  return zc - hz * Math.pow(1 - Math.pow(a, EP), 1 / EP) - off;
}
const havg = (e: Env, y: number) => {
  const [hx, hz] = envAt(e, y);
  return (hx + hz) / 2;
};

const PUNK_ENV: Env = [
  [29.6, 6.55, 4.6, -1.0],
  [32.0, 6.6, 4.9, -1.0],
  [35.0, 6.7, 5.2, -1.0],
  [38.0, 6.75, 5.35, -1.0],
  [40.0, 6.95, 5.35, -1.05],
  [41.5, 7.6, 5.3, -1.1],
  [42.8, 8.0, 5.1, -1.2],
  [43.9, 7.4, 4.8, -1.3],
  [44.7, 6.0, 4.3, -1.5],
  [45.3, 4.5, 3.8, -1.7],
];
const DUSTER_ENV: Env = [
  [29.4, 6.9, 4.9, -1.1],
  [33.0, 7.0, 5.3, -1.1],
  [37.0, 7.05, 5.5, -1.1],
  [40.0, 7.2, 5.5, -1.1],
  [41.6, 7.8, 5.4, -1.15],
  [42.9, 8.2, 5.2, -1.2],
  [44.0, 7.5, 4.9, -1.3],
  [44.8, 6.1, 4.4, -1.5],
  [45.5, 4.6, 3.9, -1.7],
];
const VEST_ENV: Env = [
  [30.4, 6.5, 4.75, -1.0],
  [34.0, 6.65, 5.15, -1.0],
  [38.0, 6.75, 5.35, -1.0],
  [41.0, 6.9, 5.3, -1.1],
  [43.4, 6.6, 4.8, -1.3],
  [44.6, 5.4, 4.2, -1.5],
];
const PONCHO_ENV: Env = [
  [32.6, 11.2, 7.7, -1.0],
  [36.0, 10.4, 7.2, -1.0],
  [39.0, 9.6, 6.8, -1.0],
  [41.5, 8.9, 6.3, -1.1],
  [43.5, 7.7, 5.6, -1.2],
  [44.9, 5.8, 4.6, -1.4],
  [45.8, 4.2, 3.7, -1.6],
];
/** the bare rib cage (bandana / sling / collar ride on it) */
const RIB_ENV: Env = [
  [30.0, 5.2, 4.3, -0.95],
  [34.0, 6.0, 4.85, -0.95],
  [37.6, 6.45, 5.1, -0.95],
  [41.0, 6.2, 4.9, -1.0],
  [43.4, 5.4, 4.4, -1.2],
  [45.0, 3.9, 3.5, -1.6],
];
const JEANS_ENV: Env = [
  [19.8, 5.8, 3.7, -0.9],
  [21.5, 6.45, 4.15, -1.05],
  [23.5, 6.8, 4.45, -1.2],
  [25.4, 6.75, 4.4, -1.3],
  [26.9, 6.55, 4.3, -1.35],
];
const HIP_ENV: Env = [
  [24.2, 6.4, 4.2, -1.6],
  [27.4, 6.3, 4.1, -1.6],
];

// ================================================================== SMALL HARDWARE
/** domed chrome stud on a surface (p on the surface, n outward) */
function stud(m: Sc, p: V3, n: V3, r = 0.5, pyramid = false) {
  const c = vadd(p, vmul(n, r * 0.25));
  m.ell(c, [r, r, r], (x, y, z) => {
    const up = y - c[1];
    return up > r * 0.25 ? CHR.hi : up < -r * 0.3 ? CHR.shade : CHR.base;
  }, { flags: M, p: pyramid ? 1.25 : 2 });
}
/** tapered chrome spike from a base point along dir */
function spike(m: Sc, base: V3, dir: V3, L: number, r0: number) {
  const d = vnorm(dir);
  const a = vsub(base, vmul(d, 0.35));
  const b = vadd(base, vmul(d, L));
  m.cap(a, b, r0, 0.06, (x, y, z) => {
    const t = vdot(vsub([x, y, z], base), d) / L;
    const side = (y - lerp(base[1], b[1], clamp(t, 0, 1))) * 0.8;
    return t > 0.72 ? CHR.hi : side > 0.12 ? CHR.hi : t < 0.3 && side < 0 ? CHR.shade : CHR.base;
  }, { flags: M });
  stud(m, base, d, r0 * 1.18);
}
/** chain of alternating flat / edge links along a smooth path */
function chain(m: Sc, pts: V3[], link = 1.7, col: Ramp = CHR) {
  const smooth = spline(pts, 10);
  const samples = resample(smooth, link * 0.62);
  samples.forEach((s, k) => {
    const t = s.t;
    let w1 = vcross(t, [0, 1, 0]);
    if (vlen(w1) < 0.2) w1 = vcross(t, [1, 0, 0]);
    w1 = vnorm(w1);
    const w2 = vnorm(vcross(t, w1));
    const flat = (k & 1) === 0;
    m.oell(s.p, [t, flat ? w1 : w2, flat ? w2 : w1], [link * 0.5, 0.5, 0.26], flat ? (x, y, z) => (y > s.p[1] + 0.1 ? col.hi : col.base) : col.shade, { flags: M });
  });
}

// ================================================================== SKULL
interface SkullParts {
  head: Sc;
  jaw: Sc;
  brow_l: VoxelModel;
  brow_r: VoxelModel;
}
const SOCKET_C = (s: number): V3 => [s * 3.2, 53.85, 7.1];
const SOCKET_R: V3 = [2.3, 2.25, 3.75];
const inSocket = (x: number, y: number, z: number, grow = 1) => {
  const s = x >= 0 ? 1 : -1, c = SOCKET_C(s);
  return Math.pow(Math.abs(x - c[0]) / (SOCKET_R[0] * grow), 2.5) + Math.pow(Math.abs(y - c[1]) / (SOCKET_R[1] * grow), 2.5) + Math.pow(Math.abs(z - c[2]) / (SOCKET_R[2] * grow), 2.5) <= 1;
};
const inNose = (x: number, y: number, z: number) => {
  const a = ((Math.abs(x) - 0.6) / 0.82) ** 2 + ((y - 50.9) / 1.42) ** 2 + ((z - 6.6) / 2.1) ** 2 <= 1;
  const b = (x / 0.48) ** 2 + ((y - 52.05) / 0.68) ** 2 + ((z - 6.5) / 1.7) ** 2 <= 1;
  return a || b;
};

function buildSkull(): SkullParts {
  const h = sc('head');
  const B = BN.base;
  // cranium: a slightly boxy dome
  h.ell([0, 55.4, -0.8], [6.15, 7.6, 6.9], B, { p: 2.15 });
  // skull base / occiput and mastoids
  h.ell([0, 49.7, -4.4], [3.7, 2.3, 2.6], B, { p: 2.2 });
  for (const s of [1, -1]) h.ell([s * 4.3, 48.7, -2.6], [1.15, 1.4, 1.2], B);
  // face mass (wraps back at the sides)
  h.ell([0, 52.4, 1.4], [4.95, 4.7, 4.75], B, { p: 2.9 });
  // cheekbones + zygomatic arches running back to the ear
  for (const s of [1, -1]) {
    h.ell([s * 4.6, 51.45, 4.25], [1.8, 1.35, 1.55], B, { p: 2.2 });
    h.cap([s * 5.4, 51.55, 3.4], [s * 6.0, 51.25, -1.5], 0.62, 0.5, B);
  }
  // maxilla (upper jaw) and the glabella between the brows
  h.ell([0, 49.0, 3.3], [3.75, 1.95, 2.75], B, { p: 2.4 });
  h.ell([0, 56.35, 5.95], [1.15, 0.9, 0.6], B);
  // atlas knob under the skull (meets the neck vertebrae)
  h.cap([0, 47.6, -2.5], [0, 46.4, -2.3], 0.95, 0.8, BN.shade);
  // dark mouth interior / palate (seen when the jaw drops)
  h.ell([0, 47.1, 2.5], [3.35, 0.6, 2.35], SOCK.void);
  // upper teeth: enamel around the front of the arch, seams between teeth
  const tid = (x: number, z: number) => Math.round(Math.atan2(x, z - 2.2) / 0.42);
  h.region([-3.9, 46.9, 0.6], [3.9, 48.75, 6.2], (x, y, z) => pw(x / 2.8, 2.6) + pw((z - 3.0) / 2.05, 2.6) > 1 && z > 1.2, (x, y, z) => {
    const k = S;
    const t0 = tid(x, z), tx = tid(x + Math.sign(x || 1) / k, z), tz = tid(x, z - 1 / k);
    return t0 !== tx || t0 !== tz ? SOCK.mid : y < 47.4 ? ENAMEL : BN.hi;
  }, { mode: 'paint' });
  // eye sockets: deep rounded-square recesses, walls darkening with depth
  for (const s of [1, -1]) h.ell(SOCKET_C(s), SOCKET_R, 0, { p: 2.5, mode: 'carve' });
  h.walls([-6, 50, 2], [6, 57, 7], (x, y, z) => inSocket(x, y, z), (x, y, z) => (z > 5.55 ? null : z > 4.7 ? SOCK.wall : z > 3.9 ? SOCK.mid : SOCK.deep));
  // nasal aperture (inverted heart)
  h.region([-1.6, 49, 4], [1.6, 53, 9], inNose, 0, { mode: 'carve' });
  h.walls([-2, 48.5, 3], [2, 53.5, 7], inNose, (x, y, z) => (z > 5.6 ? SOCK.wall : SOCK.deep));
  // a crack across the right brow (story, not noise) and soft cranial sutures
  const crack: V3[] = [[-3.5, 57.4, 6.05], [-2.9, 58.5, 5.75], [-3.35, 59.4, 5.25], [-2.6, 60.6, 4.3], [-2.95, 61.5, 3.0], [-2.25, 62.3, 1.3]];
  const branch: V3[] = [[-2.9, 58.5, 5.75], [-1.9, 59.1, 5.6], [-1.6, 59.9, 5.3]];
  h.region([-5, 56.5, 0], [0, 63.5, 7], (x, y, z) => distPoly([x, y, z], crack) < 0.42 || distPoly([x, y, z], branch) < 0.3, SOCK.mid, { mode: 'paint' });
  const zig = (a: V3, b: V3, n: number, amp: number, axis: 0 | 2) => {
    const out: V3[] = [];
    for (let i = 0; i <= n; i++) {
      const p = vadd(a, vmul(vsub(b, a), i / n));
      p[axis] += i % 2 ? amp : -amp;
      out.push(p);
    }
    return out;
  };
  const coronal = [...zig([-6.0, 57.6, -0.2], [0, 63.1, 0.9], 9, 0.32, 2), ...zig([0, 63.1, 0.9], [6.0, 57.6, -0.2], 9, 0.32, 2)];
  const sagittal = zig([0, 63.1, 0.9], [0, 58.4, -7.4], 10, 0.3, 0);
  h.region([-6.5, 56, -8], [6.5, 63.5, 2], (x, y, z) => y > 57 && (distPoly([x, y, z], coronal) < 0.33 || distPoly([x, y, z], sagittal) < 0.33), BN.shade, { mode: 'paint' });

  // ---- brow ridges (split into brow_l / brow_r so expressions can tilt them)
  const br = sc('brow');
  for (const s of [1, -1])
    br.path([[s * 5.65, 55.95, 4.25], [s * 4.65, 56.7, 5.6], [s * 3.1, 57.05, 6.35], [s * 1.35, 56.9, 6.45]], (t) => 0.86 - 0.12 * Math.abs(t - 0.6), B);
  shadeRamps(br.m, [BN], true);
  const brow_l = splitOff(br, 'brow_l', (x) => x > 0.9);
  const brow_r = splitOff(br, 'brow_r', (x) => x < -0.9);
  h.merge(br.m); // the bit over the glabella stays on the skull

  // ---- mandible
  const jw = sc('jaw');
  for (const s of [1, -1]) {
    const body: V3[] = [[s * 4.7, 45.95, -1.7], [s * 4.4, 45.4, 1.6], [s * 3.35, 45.05, 4.2], [s * 1.6, 44.9, 5.5], [0, 44.85, 5.85]];
    jw.sweep(body, (t) => [0.95, 1.3 - 0.15 * t, 0.95], B, 0.3);
    jw.cap([s * 4.8, 45.8, -1.9], [s * 5.15, 49.0, -2.25], 0.88, 0.7, B); // ramus
    jw.ell([s * 5.15, 49.35, -2.2], [0.85, 0.65, 0.95], B); // condyle (the hinge)
    jw.cap([s * 4.7, 47.0, -0.6], [s * 4.5, 48.5, 0.75], 0.55, 0.32, B); // coronoid
  }
  jw.ell([0, 44.55, 5.45], [1.95, 1.0, 1.05], B); // chin
  jw.ell([0, 45.8, 2.25], [3.05, 0.5, 2.3], SOCK.void); // floor of the mouth
  // lower teeth ring along the arch, seams offset from the upper row (they interlock)
  const ltid = (x: number, z: number) => Math.round(Math.atan2(x, z - 2.3) / 0.42 + 0.5);
  jw.region([-4.1, 45.9, 0.4], [4.1, 47.0, 6.1], (x, y, z) => {
    const o = pw(x / 3.5, 2.4) + pw((z - 2.3) / 3.5, 2.4);
    const i = pw(x / 2.4, 2.4) + pw((z - 2.3) / 2.38, 2.4);
    return o <= 1 && i > 1 && z > 0.8;
  }, (x, y, z) => {
    const t0 = ltid(x, z), tx = ltid(x + Math.sign(x || 1) / S, z), tz = ltid(x, z - 1 / S);
    return t0 !== tx || t0 !== tz ? SOCK.mid : ENAMEL;
  });
  shadeRamps(h.m, [BN], true);
  shadeRamps(jw.m, [BN], false);
  return { head: h, jaw: jw, brow_l, brow_r };
}

// ---- modelled eyes: dark glossy orbs nested in the sockets with glowing pupils
type EyeVar = 'normal' | 'intense' | 'wide' | 'dim' | 'dead' | 'shut';
function eyeModel(name: string, s: number, v: EyeVar) {
  const e = sc(name);
  const c: V3 = [(s * 10) / 3, 54, 3.45]; // centre on voxel boundaries -> a 2x2 pupil, nested deep in the socket
  const R = 1.6;
  e.ell(c, [R, R, R], EYE.ball, { flags: M });
  const ci = Math.round(c[0] * S), cj = Math.round(c[1] * S);
  for (let di = -2; di <= 1; di++)
    for (let dj = -2; dj <= 1; dj++) {
      const ox = di + 0.5, oy = dj + 0.5;
      if (Math.abs(ox) > 1 && Math.abs(oy) > 1) continue; // round the 4x4 block
      const core = Math.abs(ox) < 1 && Math.abs(oy) < 1;
      const glint = core && ox < 0 && oy > 0;
      const i = ci + di, j = cj + dj;
      let l = 30;
      while (l > -10 && !e.m.has(i, j, l)) l--;
      if (l <= -10) continue;
      let col = EYE.ball, fl: number = M;
      if (v === 'dead') col = core ? EYE.dim : EYE.ball;
      else if (v === 'shut') {
        if (core && oy < 0) (col = EYE.core), (fl = VF.GLOW);
        else if (!core && Math.abs(oy) < 1 && oy < 0) (col = EYE.ring), (fl = VF.EMISSIVE);
      } else if (v === 'dim') {
        if (core) (col = EYE.ring), (fl = VF.EMISSIVE);
      } else if (core) {
        col = glint && v !== 'intense' ? EYE.glint : EYE.core;
        fl = VF.GLOW;
      } else if (v === 'wide') (col = EYE.core), (fl = VF.GLOW);
      else if (v === 'normal') col = EYE.iris;
      e.m.set(i, j, l, col, fl);
      if (core && v !== 'dead' && v !== 'dim') e.m.set(i, j, l - 1, EYE.ring, VF.EMISSIVE);
    }
  return e.m;
}
const EYE_EXPR: Record<string, [EyeVar, EyeVar]> = {
  neutral: ['normal', 'normal'],
  focus: ['intense', 'intense'],
  smug: ['intense', 'normal'],
  surprised: ['wide', 'wide'],
  hurt: ['dim', 'dim'],
  angry: ['intense', 'intense'],
  laugh: ['shut', 'shut'],
  wink: ['shut', 'normal'],
  dead: ['dead', 'dead'],
  determined: ['intense', 'intense'],
};

// ================================================================== BONES
const zSpine = (y: number) => {
  const k: [number, number][] = [[26.5, -3.9], [31, -3.75], [35, -4.4], [40, -4.75], [43.5, -4.1], [46.5, -2.7]];
  if (y <= k[0][0]) return k[0][1];
  for (let i = 1; i < k.length; i++) if (y <= k[i][0]) return lerp(k[i - 1][1], k[i][1], sstep((y - k[i - 1][0]) / (k[i][0] - k[i - 1][0])));
  return k[k.length - 1][1];
};

function torsoBones(m: Sc, scapulae: boolean) {
  const B = BN.base;
  // vertebrae: 2-voxel bodies with a darker disc between (aligned to the grid)
  for (let n = 0; n < 9; n++) {
    const y = (41 + n * 3) / S; // 27.33 .. 43.33
    const lum = y < 33, zs = zSpine(y);
    m.ell([0, y, zs], lum ? [1.3, 0.62, 1.12] : [1.06, 0.62, 0.95], B, { p: 2.5 });
    m.ell([0, y - 1, zs], [0.8, 0.36, 0.72], BN.shade); // disc
    m.cap([0, y, zs - 0.7], [0, y - (lum ? 0.35 : 0.75), zs - 2.05], lum ? 0.5 : 0.42, 0.3, B); // spinous process
    for (const s of [1, -1]) m.cap([0, y, zs - 0.2], [s * (lum ? 2.1 : 1.7), y + 0.1, zs - 0.55], 0.36, 0.28, B); // transverse
  }
  for (const y of [44.67, 46.0]) m.ell([0, y, zSpine(y)], [0.85, 0.32, 0.78], B, { p: 2.4 }); // cervical
  m.ell([0, 45.33, zSpine(45.33)], [0.62, 0.3, 0.6], BN.shade);
  // ribs: six pairs of flat, curved bands sweeping round from the spine and dropping to the front
  const RIBS: [number, number, number, number, number][] = [
    [43.0, 4.9, 3.9, 1.4, 3.0],
    [41.2, 5.7, 4.5, 2.0, 3.0],
    [39.4, 6.15, 4.8, 2.4, 2.95],
    [37.6, 6.3, 4.9, 2.7, 2.9],
    [35.8, 6.2, 4.85, 2.9, 2.6],
    [34.0, 5.8, 4.6, 2.8, 2.15],
  ];
  const zc = -0.95;
  for (const [yb, rx, rz, drop, aEnd] of RIBS)
    for (const s of [1, -1]) {
      const pts: V3[] = [];
      for (let a = 0.3; a <= aEnd + 1e-6; a += 0.08) pts.push([s * rx * Math.sin(a), yb + 0.35 * Math.sin(clamp(a * 1.6, 0, Math.PI)) - drop * Math.pow(a / Math.PI, 1.5), zc - rz * Math.cos(a)]);
      m.sweep(pts, (t) => [0.46, 0.56 - 0.08 * t, 0.46], B, 0.2);
    }
  // sternum: manubrium, body, xiphoid
  m.ell([0, 42.1, 4.05], [1.45, 0.95, 0.55], B);
  m.sweep([[0, 41.4, 4.15], [0, 38.5, 4.12], [0, 35.6, 3.85]], (t) => [0.82 - 0.12 * t, 0.6, 0.45], B, 0.25);
  m.cap([0, 35.4, 3.8], [0, 34.0, 3.35], 0.42, 0.15, B);
  // clavicles
  for (const s of [1, -1]) m.path([[s * 1.3, 43.2, 3.75], [s * 3.6, 43.75, 3.3], [s * 5.9, 43.8, 1.6], [s * 7.2, 43.5, 0.1]], () => 0.56, B);
  if (scapulae)
    for (const s of [1, -1]) {
      const A: [number, number] = [2.6, 42.6], Bp: [number, number] = [6.6, 42.2], C: [number, number] = [3.4, 36.6];
      const sign = (p: [number, number], a: [number, number], b: [number, number]) => (p[0] - b[0]) * (a[1] - b[1]) - (a[0] - b[0]) * (p[1] - b[1]);
      m.region([s > 0 ? 2 : -7.2, 36, -7], [s > 0 ? 7.2 : -2, 43, -5], (x, y, z) => {
        const p: [number, number] = [x * s, y];
        const d1 = sign(p, A, Bp), d2 = sign(p, Bp, C), d3 = sign(p, C, A);
        const inT = !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
        const zz = -5.95 - 0.18 * (p[0] - 2.6);
        return inT && Math.abs(z - zz) < 0.36;
      }, B);
      m.cap([s * 2.6, 41.3, -6.4], [s * 7.0, 42.5, -4.4], 0.42, 0.5, B); // scapular spine -> acromion
    }
}

function pelvisBones(dst: Sc, clipY: number) {
  const B = BN.base;
  const m = sc('pelvis_bones');
  for (const s of [1, -1]) {
    // iliac wing: a thin flared bowl
    m.region([s > 0 ? 1.4 : -7, 24.4, -4.8], [s > 0 ? 7 : -1.4, 29.6, 2], (x, y, z) => {
      if (s * x < 1.6) return false;
      const d = ((s * x - 2.0) / 4.25) ** 2 + ((y - 25.0) / 4.45) ** 2 + ((z + 1.3) / 3.0) ** 2;
      return d <= 1 && d >= 0.66 && y > 24.6 && z > -4.6 && z < 1.8;
    }, B);
    m.path([[s * 1.9, 28.8, -4.0], [s * 4.4, 29.4, -2.6], [s * 5.75, 28.8, -0.4], [s * 5.25, 27.4, 1.35]], (t) => 0.5 + 0.08 * Math.sin(t * Math.PI), B); // crest
    m.ell([s * 4.3, 24.2, -0.4], [1.3, 1.3, 1.3], BN.shade); // acetabulum
    m.path([[s * 3.9, 23.5, 0.6], [s * 1.8, 23.0, 1.6], [s * 0.35, 22.8, 1.7]], () => 0.55, B); // pubis
    m.path([[s * 3.8, 23.2, -0.9], [s * 3.1, 21.7, -1.6], [s * 1.6, 21.6, 0.2], [s * 0.6, 22.3, 1.4]], () => 0.5, B); // ischium loop
  }
  m.ell([0, 25.8, -4.3], [1.9, 2.6, 1.0], B, { p: 2.4 }); // sacrum
  for (const y of [24.6, 25.9, 27.1]) for (const s of [1, -1]) m.ell([s * 0.75, y, -5.2], [0.3, 0.3, 0.3], SOCK.mid); // sacral foramina
  if (clipY > -99) m.region([-8, 15, -8], [8, clipY, 4], () => true, 0, { mode: 'carve' });
  dst.merge(m.m);
}

function humerus(m: Sc, s: number) {
  const B = BN.base;
  m.ell([s * 7.7, 42.4, -0.1], [1.45, 1.45, 1.45], B);
  m.ell([s * 8.9, 42.2, 0.2], [0.7, 0.9, 0.8], B);
  m.cap([s * 8.2, 41.6, -0.1], [s * 8.0, 34.4, 0], 0.72, 0.62, B);
  m.ell([s * 8.0, 33.6, 0], [1.45, 0.75, 0.85], B, { p: 2.4 });
}
function forearm(m: Sc, s: number) {
  const B = BN.base;
  m.ell([s * 8.2, 32.65, -0.7], [0.78, 0.9, 0.8], B); // olecranon
  m.cap([s * 8.2, 33.0, -1.0], [s * 8.2, 32.4, -1.5], 0.5, 0.4, B);
  m.ell([s * 8.75, 32.35, 0.4], [0.62, 0.55, 0.62], B); // radial head
  m.cap([s * 8.2, 32.2, -0.6], [s * 8.05, 26.7, -0.6], 0.5, 0.4, BN.shade); // ulna
  m.cap([s * 8.8, 32.0, 0.4], [s * 8.9, 26.7, 0.4], 0.42, 0.56, B); // radius
}
const FX = [6.9, 8.1, 9.3, 10.5];
/** finger bones: closed fist (holds the gun) or relaxed open hand */
function hand(m: Sc, s: number, closed: boolean) {
  const B = BN.base;
  for (const [cx, cz] of [[7.9, -0.3], [8.9, -0.45], [9.9, -0.2], [8.4, 0.6], [9.4, 0.55]] as [number, number][]) m.ell([s * cx, 25.3, cz], [0.62, 0.56, 0.56], B); // carpals
  const knob = (p: V3, r: number) => m.ell(p, [r, r, r], B);
  if (closed) {
    FX.forEach((fx, i) => {
      const x = s * fx;
      m.cap([s * (8.2 + (i - 1.5) * 0.45), 25.0, 0.0], [x, 23.15, 1.5], 0.42, 0.42, B); // metacarpal
      knob([x, 23.0, 1.85], 0.56); // knuckle
      m.cap([x, 22.8, 2.15], [x, 21.0, 2.35], 0.45, 0.42, B); // proximal
      knob([x, 20.85, 2.25], 0.46);
      m.cap([x, 20.7, 2.1], [x, 20.0, 0.85], 0.4, 0.37, B); // middle (curling back)
      m.cap([x, 20.05, 0.7], [x, 20.55, -0.25], 0.34, 0.28, B); // distal tip
    });
    m.cap([s * 7.4, 24.6, 0.4], [s * 6.2, 23.0, 1.5], 0.46, 0.42, B); // thumb
    knob([s * 6.2, 22.9, 1.65], 0.5);
    m.cap([s * 6.25, 22.8, 1.8], [s * 7.0, 22.0, 2.95], 0.42, 0.38, B);
    m.cap([s * 7.0, 22.0, 3.0], [s * 8.0, 21.75, 3.1], 0.36, 0.3, B);
  } else {
    const LEN = [0.92, 1.0, 0.95, 0.78];
    FX.forEach((fx, i) => {
      const x = s * fx, L = LEN[i], spread = s * (i - 1.5) * 0.22;
      m.cap([s * (8.2 + (i - 1.5) * 0.5), 24.9, 0.0], [x, 22.6, 0.25], 0.42, 0.4, B);
      knob([x, 22.45, 0.3], 0.53);
      const p1: V3 = [x + spread * 0.5, 22.3 - 1.9 * L, 0.85];
      m.cap([x, 22.3, 0.35], p1, 0.41, 0.38, B);
      knob(p1, 0.43);
      const p2: V3 = [x + spread, p1[1] - 1.3 * L, 1.1];
      m.cap(p1, p2, 0.36, 0.33, B);
      m.cap(p2, [x + spread * 1.2, p2[1] - 1.0 * L, 0.95], 0.31, 0.22, B);
    });
    m.path([[s * 7.5, 24.6, 0.5], [s * 6.4, 22.9, 1.0], [s * 6.0, 21.4, 1.5], [s * 6.1, 20.3, 1.75]], (t) => 0.46 - 0.16 * t, B);
  }
}
function femur(m: Sc, s: number, from = 99) {
  const B = BN.base;
  if (from > 22) {
    m.ell([s * 3.3, 24.3, -0.2], [1.25, 1.25, 1.25], B);
    m.cap([s * 3.4, 24.0, -0.2], [s * 4.6, 23.0, -0.1], 0.75, 0.75, B);
    m.ell([s * 5.2, 23.6, -0.4], [0.9, 1.1, 0.9], B);
  }
  m.cap([s * 4.4, Math.min(22.6, from), -0.1], [s * 3.7, 17.4, 0.2], 0.8, 0.72, B);
  m.ell([s * 3.6, 16.4, 0.1], [1.55, 0.95, 1.3], B, { p: 2.4 });
}
function tibia(m: Sc, s: number, to = 4.6) {
  const B = BN.base;
  m.ell([s * 3.5, 14.9, 0.1], [1.5, 0.75, 1.3], B, { p: 2.4 }); // plateau
  m.ell([s * 3.5, 15.4, 1.55], [0.82, 1.0, 0.5], BN.hi); // kneecap
  m.cap([s * 3.5, 14.5, 0.3], [s * 3.3, to, 0.0], 0.78, 0.62, B);
  m.cap([s * 4.6, 14.2, -0.4], [s * 4.35, to - 0.2, -0.4], 0.4, 0.38, BN.shade); // fibula
}
function boneFoot(m: Sc, s: number) {
  const B = BN.base;
  m.ell([s * 2.55, 3.6, 0], [0.6, 0.6, 0.6], B); // malleoli
  m.ell([s * 4.55, 3.5, -0.4], [0.55, 0.55, 0.55], B);
  m.ell([s * 3.4, 2.3, -0.4], [1.15, 0.9, 1.1], B); // talus
  m.ell([s * 3.5, 1.4, -2.0], [1.05, 1.3, 1.35], B); // calcaneus
  [2.3, 3.0, 3.7, 4.4, 5.0].forEach((tx, i) => {
    const x = s * tx;
    m.cap([s * (3.0 + i * 0.35), 2.0, 0.6], [x, 0.75, 3.5], 0.42, 0.36, B);
    m.ell([x, 0.75, 3.6], [0.42, 0.42, 0.42], B);
    m.cap([x, 0.7, 3.8], [x, 0.5, i === 0 ? 5.7 : 5.3 - i * 0.2], i === 0 ? 0.42 : 0.33, 0.28, B);
  });
}

// ================================================================== GARMENT PIECES
/** a leather/cloth shell around an envelope; open front where |x| < xo(y) (if given) */
function bodyShell(m: Sc, e: Env, y0: number, y1: number, T: number, col: Col, xo?: (y: number) => number, extraCut?: (x: number, y: number, z: number) => boolean, flags?: number) {
  m.region([-12.5, y0, -10], [12.5, y1, 9], (x, y, z) => {
    if (y < y0 || y > y1) return false;
    const r = rhoOf(e, x, y, z);
    if (r < 1 || r > 1 + T / havg(e, y)) return false;
    const [, , zc] = envAt(e, y);
    if (xo && z > zc + 1.0 && Math.abs(x) < xo(y)) return false;
    if (extraCut && extraCut(x, y, z)) return false;
    return true;
  }, col, { flags });
}

/** hot-rod flame tongues licking up from y0; th(x,y,z) gives the position around the body (u of arc) */
interface Tongue {
  at: number;
  h: number;
  w: number;
  lean: number;
}
function flameCol(tongues: Tongue[], arc: number, h: number): number | null {
  if (h < 0) return null;
  let best: number | null = null;
  for (const t of tongues) {
    if (h > t.h) continue;
    const k = h / t.h;
    const centre = t.at + t.lean * k * k * 2.2;
    const w = t.w * Math.pow(1 - k, 0.7) * (1 + 0.22 * Math.sin(h * 1.4 + t.at));
    const d = Math.abs(arc - centre);
    if (d < w) return k < 0.34 ? FLAME[0] : k < 0.68 ? FLAME[1] : FLAME[2];
    if (d < w + 0.42) best = FLAME_LINE;
  }
  if (h < 1.0) return FLAME[0];
  if (h < 1.42) return best ?? FLAME_LINE;
  return best;
}

/** a red bandana knotted round the neck, folded triangle over the sternum */
function bandana(m: Sc, R: Ramp) {
  const ring: V3[] = [];
  for (let a = 0; a <= Math.PI * 2 + 0.01; a += 0.15) ring.push([3.15 * Math.sin(a), 45.15 + 0.3 * Math.cos(a), -1.9 - 2.9 * Math.cos(a)]);
  m.path(ring, () => 0.86, R.base);
  // folded triangle draping over the manubrium
  m.region([-3.4, 40.0, 0], [3.4, 45.0, 6.4], (x, y, z) => {
    const v = (44.7 - y) / 4.5;
    if (v < 0 || v > 1) return false;
    const w = 3.05 * (1 - v);
    if (Math.abs(x) > w) return false;
    const zc = lerp(1.5, 5.0, v) + 0.95 * Math.sin(Math.PI * v) - 0.11 * x * x;
    return Math.abs(z - zc) < 0.48;
  }, (x, y, z) => {
    const v = (44.7 - y) / 4.5, w = 3.05 * (1 - v);
    const i = Math.floor(x * S), j = Math.floor(y * S);
    if (w - Math.abs(x) < 0.55) return TOON.linen.base; // printed border
    if (((i + 2 * j) % 6 === 0 || (i - 2 * j) % 6 === 0) && j % 3 === 0) return TOON.linen.hi; // paisley dots
    if (Math.abs(Math.abs(x) - (w * 0.55)) < 0.3 && v > 0.25) return R.shade; // fold crease
    return R.base;
  });
  // knot at the back-left with two stubby ears
  m.ell([2.0, 45.0, -4.95], [1.05, 0.88, 0.88], R.shade);
  m.cap([2.0, 45.0, -5.2], [3.25, 43.9, -6.0], 0.58, 0.3, R.base);
  m.cap([2.0, 45.0, -5.2], [0.95, 43.5, -6.1], 0.58, 0.3, R.base);
}

/** the saddle-leather board sling: over the left shoulder, across the chest to the right hip, round the back */
function sling(m: Sc, e: Env, off: number) {
  const pts: { p: V3; n: V3 }[] = [];
  for (let k = 0; k <= 160; k++) {
    const th = -Math.PI + (k / 160) * Math.PI * 2;
    const y = 37.3 + 7.7 * Math.sin(th);
    pts.push(envPoint(e, th, y, off));
  }
  for (let k = 0; k < pts.length; k++) {
    const a = pts[Math.max(0, k - 1)].p, b = pts[Math.min(pts.length - 1, k + 1)].p;
    const t = vnorm(vsub(b, a));
    const w = vnorm(vcross(pts[k].n, t));
    for (let q = -0.95; q <= 0.951; q += 0.19) {
      const edge = Math.abs(q) > 0.7;
      m.ell(vadd(pts[k].p, vmul(w, q)), [0.4, 0.4, 0.4], edge ? STRAP.shade : STRAP.base);
    }
  }
  // chrome buckle on the chest + a keeper on the back where the board rides
  for (const [th, big] of [[2.42, true], [-0.32, false]] as [number, boolean][]) {
    const y = 37.3 + 7.7 * Math.sin(th);
    const { p, n } = envPoint(e, th, y, off + 0.45);
    const hw = big ? 1.05 : 0.85, hh = big ? 1.25 : 1.0;
    m.region(vsub(p, [2, 2, 2]), vadd(p, [2, 2, 2]), (x, y2, z) => {
      const d = vsub([x, y2, z], p);
      if (Math.abs(vdot(d, n)) > 0.33) return false;
      const side = vnorm(vcross([0, 1, 0], n));
      const a = Math.abs(vdot(d, side)), b = Math.abs(d[1]);
      return a < hw && b < hh && (a > hw - 0.5 || b > hh - 0.5 || (big && a < 0.25));
    }, (x, y2) => (y2 > p[1] ? CHR.hi : CHR.base), { flags: M });
  }
}

/** a plain leather gun belt on the hip bones (non-punk outfits) with a buckle and the holster */
function gunBelt(m: Sc, L: Ramp, buckle: Ramp) {
  bodyShell(m, HIP_ENV, 25.3, 27.1, 1.0, (x, y) => (y < 25.8 ? L.shade : L.base));
  for (const th of [1.3, 1.55, 1.8, 2.05]) {
    const { p } = envPoint(HIP_ENV, th, 26.2, 1.05);
    m.cap(vadd(p, [0, -0.6, 0]), vadd(p, [0, 0.6, 0]), 0.38, 0.38, (x, y) => (y > p[1] + 0.3 ? TOON.brass.hi : TOON.brass.base), { flags: M });
  }
  const bz = frontZ(HIP_ENV, 0, 26.2, 1.3);
  m.rbox([0, 26.2, bz], [1.7, 1.3, 0.4], 0.35, (x, y) => (Math.abs(x) < 0.9 && Math.abs(y - 26.2) < 0.55 ? buckle.shade : y > 26.6 ? buckle.hi : buckle.base), { flags: M });
  m.ell([0, 26.2, bz + 0.35], [0.45, 0.4, 0.3], TOON.serket.base, { flags: VF.EMISSIVE });
  holster(m, L);
}
function holster(m: Sc, L: Ramp) {
  const pts: V3[] = [[-7.25, 25.6, -0.2], [-7.6, 21.4, 0.25], [-7.9, 17.6, 0.7]];
  m.sweep(pts, (t) => [0.78, 1.0, 1.3 - 0.45 * t], (x, y, z) => (Math.abs(x + 8.15) < 0.45 && Math.abs(z - 0.3) > 0.95 ? L.dark : L.base), 0.25);
  m.rbox([-7.0, 25.6, -0.3], [0.65, 1.05, 1.15], 0.3, L.shade);
  m.ell([-8.55, 22.2, 0.3], [0.32, 0.8, 0.8], (x, y) => (y > 22.3 ? CHR.hi : CHR.base), { flags: M }); // concho
}

// ================================================================== BOOTS
function cowboyBoot(m: Sc, s: number, Bt: Ramp, o: { harness?: boolean; spur?: boolean; top?: number; stitch?: number } = {}) {
  const top = o.top ?? 10.4;
  const cx = s * 3.3;
  // shaft with a scalloped top (dips front and back) and pull straps
  m.region([cx - 2.3, 3.0, -2.3], [cx + 2.3, top + 0.2, 2.3], (x, y, z) => {
    const t = (top - y) / (top - 3.0);
    const r = lerp(2.1, 1.8, clamp(t, 0, 1));
    const d = Math.hypot(x - cx, z);
    if (d > r) return false;
    const th = Math.atan2(x - cx, z);
    const dip = 0.95 * Math.max(0, 1 - Math.abs(th) / 0.7) + 0.6 * Math.max(0, 1 - (Math.PI - Math.abs(th)) / 0.6);
    return y <= top - dip;
  }, (x, y, z) => {
    const th = Math.atan2(x - cx, z);
    for (let k = 0; k < 3; k++) {
      const yl = 5.3 + k * 1.5 + 0.55 * Math.sin(th * 2 + k);
      if (Math.abs(y - yl) < 0.3 && Math.cos(th) > -0.3) return o.stitch ?? STITCH;
    }
    return Bt.base;
  });
  for (const q of [1, -1]) m.rbox([cx + q * 2.05, top + 0.2, 0], [0.32, 0.75, 0.55], 0.2, Bt.shade);
  // foot: vamp + pointed toe
  const plan = (x: number, z: number, g = 0) => ((x - cx) / (1.95 + g)) ** 2 + ((z - 1.0) / (4.55 + g)) ** 2 <= 1 || ((x - cx) / (1.3 + g)) ** 2 + ((z - 4.7) / (2.2 + g)) ** 2 <= 1;
  m.ell([cx, 1.95, 1.0], [1.85, 1.75, 4.4], Bt.base, { p: 2.3 });
  m.ell([cx - s * 0.05, 1.3, 4.7], [1.25, 0.95, 2.0], Bt.base);
  m.ell([cx - s * 0.1, 1.15, 6.3], [0.62, 0.55, 0.62], Bt.base);
  m.region([cx - 3, 0, -4], [cx + 3, 0.62, 7.5], (x, y, z) => y > 0 && y < 0.62 && plan(x, z, 0.22) && z > -3.4, SOLE); // sole + welt
  m.region([cx - 3, 0.62, 2.9], [cx + 3, 3.5, 3.5], (x, y, z) => Math.abs(z - (3.2 - (y - 1.5) * 0.25)) < 0.28, o.stitch ?? STITCH, { mode: 'paint' }); // toe-cap seam
  // underslung stacked heel
  m.region([cx - 1.5, 0, -3.5], [cx + 1.5, 2.0, -1.0], (x, y, z) => y > 0 && Math.abs(x - cx) < 1.3 && z > -3.35 && z < -1.2 - (1.9 - y) * 0.38 && y < 1.95, (x, y) => ((Math.floor(y * S) & 1) ? HEEL.base : HEEL.shade));
  if (o.harness) {
    // engineer harness: strap round the ankle and over the instep, chrome O-ring on the outside
    const H: V3[] = [[s * 1.35, 2.25, 1.5], [cx, 3.15, 2.45], [s * 5.25, 2.25, 1.35], [s * 5.3, 2.45, -1.0], [cx, 2.75, -2.95], [s * 1.3, 2.45, -1.0], [s * 1.35, 2.25, 1.5]];
    m.path(spline(H, 6), () => 0.44, STRAP.dark);
    const rc: V3 = [s * 5.45, 2.35, 0.25];
    m.region(vsub(rc, [0.6, 1.0, 1.0]), vadd(rc, [0.6, 1.0, 1.0]), (x, y, z) => {
      const r = Math.hypot(y - rc[1], z - rc[2]);
      return Math.abs(x - rc[0]) < 0.36 && Math.abs(r - 0.68) < 0.27;
    }, (x, y) => (y > rc[1] ? CHR.hi : CHR.base), { flags: M });
  }
  if (o.spur ?? true) {
    // spur: heel band, shank and a star rowel standing in the YZ plane
    m.path([[s * 1.6, 2.15, -1.2], [cx, 2.2, -3.55], [s * 5.0, 2.15, -1.2]], () => 0.3, CHR.shade, { flags: M });
    m.cap([cx, 2.15, -3.5], [cx, 2.05, -4.8], 0.3, 0.26, CHR.base, { flags: M });
    const rc: V3 = [cx, 2.05, -5.7];
    m.region(vsub(rc, [0.5, 1.8, 1.8]), vadd(rc, [0.5, 1.8, 1.8]), (x, y, z) => {
      if (Math.abs(x - rc[0]) > 0.36) return false;
      const dy = y - rc[1], dz = z - rc[2], r = Math.hypot(dy, dz);
      if (r < 0.48) return true;
      if (r > 1.65) return false;
      const a = Math.atan2(dy, dz) / ((Math.PI * 2) / 6);
      const f = Math.abs(a - Math.round(a));
      return f < 0.26 * (1 - r / 1.75) + 0.05;
    }, (x, y, z) => (Math.hypot(y - rc[1], z - rc[2]) > 1.1 ? CHR.hi : CHR.base), { flags: M });
  }
}

// ================================================================== PUNK OUTFIT (the new default)
const xoPunk = (y: number) => {
  const k: [number, number][] = [[29.6, 3.55], [33, 3.75], [37, 4.15], [40, 4.6], [42.5, 5.2], [44.5, 5.0], [45.4, 4.4]];
  if (y <= k[0][0]) return k[0][1];
  for (let i = 1; i < k.length; i++) if (y <= k[i][0]) return lerp(k[i - 1][1], k[i][1], (y - k[i - 1][0]) / (k[i][0] - k[i - 1][0]));
  return k[k.length - 1][1];
};
const PUNK_T = 1.15;
const BACK_TONGUES: Tongue[] = [
  { at: 0, h: 7.6, w: 1.9, lean: 0.5 },
  { at: 3.3, h: 6.9, w: 1.7, lean: -0.7 },
  { at: -3.3, h: 7.3, w: 1.7, lean: 0.7 },
  { at: 6.6, h: 5.8, w: 1.55, lean: -0.6 },
  { at: -6.6, h: 5.4, w: 1.55, lean: 0.65 },
  { at: 9.8, h: 4.8, w: 1.4, lean: 0.5 },
  { at: -9.8, h: 5.1, w: 1.4, lean: -0.5 },
  { at: 13.2, h: 4.3, w: 1.3, lean: -0.45 },
  { at: -13.2, h: 4.0, w: 1.3, lean: 0.45 },
  { at: 16.0, h: 3.5, w: 1.1, lean: -0.35 },
  { at: -16.0, h: 3.7, w: 1.1, lean: 0.35 },
];

function punkTorso(m: Sc) {
  const e = PUNK_ENV, T = PUNK_T;
  const outer = (y: number) => 1 + T / havg(e, y);
  // jacket body
  bodyShell(m, e, 29.6, 45.4, T, LEA.base, xoPunk);
  // hem band (thicker) with a stitch line on top
  m.region([-9, 29.6, -8], [9, 31.0, 7], (x, y, z) => {
    const r = rhoOf(e, x, y, z), [, , zc] = envAt(e, y);
    if (z > zc + 1.0 && Math.abs(x) < xoPunk(y)) return false;
    return r >= 1 + (T * 0.4) / havg(e, y) && r <= outer(y) + 0.4 / havg(e, y);
  }, (x, y) => (y > 30.75 ? LEA_EDGE : LEA.base));
  // flames: front panels + all round the back, licking up from the hem
  m.region([-9.5, 30.9, -8.5], [9.5, 41.5, 7], (x, y, z) => rhoOf(e, x, y, z) >= outer(y) - 0.45 / havg(e, y), (x, y, z) => {
    const th = thetaOf(e, x, y, z);
    return flameCol(BACK_TONGUES, th * 5.6, y - 30.95);
  }, { mode: 'paint' });
  // zipper teeth down both front edges + a diagonal chest-pocket zip with a pull
  m.region([-6, 29.6, -2], [6, 37.4, 7.5], (x, y, z) => {
    const [, , zc] = envAt(e, y);
    const ax = Math.abs(x) - xoPunk(y);
    return z > zc + 1.0 && ax > -0.05 && ax < 0.72 && rhoOf(e, x, y, z) >= 0.98;
  }, (x, y) => ((Math.floor(y * S) & 1) ? CHR.base : CHR.dark), { mode: 'paint', flags: M });
  m.region([4, 35, 0], [7, 39.4, 7.5], (x, y, z) => z > 0.5 && rhoOf(e, x, y, z) > outer(y) - 0.5 / havg(e, y) && distPoly([x, y, z], [[4.95, 35.8, z], [6.35, 39.0, z]]) < 0.34, CHR.base, { mode: 'paint', flags: M });
  m.ell([4.85, 35.15, frontZ(e, 4.85, 35.15, T + 0.2)], [0.3, 0.62, 0.25], CHR.hi, { flags: M });
  // a venom-green patch with a dark stitched border on the right front panel
  m.region([-6.8, 32.0, 0], [-3.9, 35.3, 7.5], (x, y, z) => {
    const r = rhoOf(e, x, y, z);
    return x > -6.45 && x < -4.15 && y > 32.25 && y < 35.05 && r > outer(y) - 0.2 / havg(e, y) && r < outer(y) + 0.75 / havg(e, y) && z > 1;
  }, (x, y) => (x < -6.0 || x > -4.6 || y < 32.7 || y > 34.6 ? ((Math.floor(y * S + x * S) & 1) ? 0x1a2414 : 0x2c3a20) : Math.abs(x + 5.3) < 0.5 && Math.abs(y - 33.65) < 0.75 && (Math.abs(x + 5.3) < 0.2 || Math.abs(y - 33.65) < 0.2) ? 0x1a2414 : VENOM));
  // lapels: folded-back flaps with a notch, studded along the outer edge
  const lw = (y: number) => (y < 42.15 ? 2.75 * sstep((y - 36.8) / 5.2) : y < 42.85 ? 0.85 : 2.35);
  m.region([-9, 36.6, 0], [9, 44.7, 8], (x, y, z) => {
    const [, , zc] = envAt(e, y);
    if (z < zc + 1.6) return false;
    const ax = Math.abs(x), xo = xoPunk(y);
    if (ax < xo - 0.25 || ax > xo + lw(y)) return false;
    const r = rhoOf(e, x, y, z);
    return r >= outer(y) - 0.25 / havg(e, y) && r <= outer(y) + 0.85 / havg(e, y);
  }, (x, y) => (Math.abs(x) - xoPunk(y) < 0.5 ? LEA.hi : LEA.base));
  for (const s of [1, -1]) {
    for (const y of [38.4, 39.8, 41.2, 43.5]) {
      const x = s * (xoPunk(y) + lw(y) - 0.6);
      stud(m, [x, y, frontZ(e, x, y, T + 0.85)], vnorm([s * 0.35, 0, 1]), 0.48, true);
    }
  }
  // two safety pins on the left lapel
  for (const [y, x0] of [[40.3, 5.2], [41.6, 5.5]] as [number, number][]) {
    const z = frontZ(e, x0, y, T + 1.05);
    m.cap([x0 - 0.7, y, z], [x0 + 0.7, y + 0.2, z], 0.2, 0.2, CHR.hi, { flags: M });
    m.ell([x0 + 0.75, y + 0.1, z], [0.3, 0.3, 0.25], CHR.base, { flags: M });
  }
  // popped collar standing up behind the neck, studded tips
  m.region([-6.5, 44.2, -6.5], [6.5, 47.7, 2.6], (x, y, z) => {
    const k = (y - 44.2) / 3.3, hx = 4.5 + 0.95 * k, hz = 3.7 + 0.65 * k, zc = -1.75;
    const r = Math.pow(Math.pow(Math.abs(x) / hx, 2.4) + Math.pow(Math.abs(z - zc) / hz, 2.4), 1 / 2.4);
    if (r < 1 || r > 1 + 0.82 / ((hx + hz) / 2)) return false;
    if (z > zc + 1.95 + k * 0.4) return false;
    return y < 47.45 - 0.35 * Math.cos(Math.atan2(x, -(z - zc)));
  }, (x, y) => (y > 47.0 ? LEA.hi : LEA.base));
  for (const s of [1, -1]) stud(m, [s * 4.9, 46.9, 0.55], vnorm([s, 0.2, 0.4]), 0.42, true);
  // left epaulette (snap strap on the shoulder top) – Pinch's side
  m.path([[4.9, 45.05, -1.55], [6.4, 44.6, -1.4], [7.75, 43.85, -1.2]], () => 0.62, LEA.hi);
  stud(m, [7.55, 44.4, -1.2], [0.35, 0.94, 0], 0.4);
  // back: rocker patch arching over a round venom-drop patch
  m.region([-5, 37.6, -9], [5, 44.6, -4], (x, y, z) => {
    if (z > -4.5) return false;
    const r = rhoOf(e, x, y, z), o = outer(y);
    if (r < o - 0.2 / havg(e, y) || r > o + 0.75 / havg(e, y)) return false;
    const d = Math.hypot(x, y - 37.9);
    const rocker = d > 5.0 && d < 6.35 && Math.abs(x) < 4.6;
    const round = Math.hypot(x, y - 40.1) < 1.55;
    return rocker || round;
  }, (x, y) => {
    const d = Math.hypot(x, y - 37.9), rd = Math.hypot(x, y - 40.1);
    if (rd < 1.55) {
      const drop = Math.hypot(x, y - 39.75) < 0.72 || (y > 39.75 && y < 41.2 && Math.abs(x) < 0.72 * (41.2 - y) / 1.45);
      return rd > 1.2 ? 0x8e1c10 : drop ? VENOM : TOON.linen.base;
    }
    return d < 5.42 || d > 5.93 || Math.abs(x) > 4.15 ? TOON.linen.base : TOON.red.base;
  });
  // back yoke seam
  m.region([-8, 41.0, -8.5], [8, 41.5, -5], (x, y, z) => rhoOf(e, x, y, z) > outer(y) - 0.4 / havg(e, y) && Math.abs(x) > 4.7, LEA.dark, { mode: 'paint' });
}

function punkPauldron(m: Sc) {
  const pc: V3 = [-8.35, 42.9, -0.15];
  const R1: V3 = [3.15, 2.45, 3.35];
  m.shell(pc, R1, 0.85, (x, y) => (y > 44.6 ? LEA.hi : LEA.base), (x, y) => y > 41.3);
  const pc2: V3 = [-8.7, 41.75, -0.15], R2: V3 = [3.3, 2.0, 3.5];
  m.shell(pc2, R2, 0.8, LEA.base, (x, y) => y > 40.45 && y < 41.75);
  // rim edges + pyramid studs along both lames (outer half only)
  for (const [c, r, y] of [[pc, R1, 41.55], [pc2, R2, 40.65]] as [V3, V3, number][]) {
    const k = Math.sqrt(Math.max(0, 1 - ((y - c[1]) / r[1]) ** 2));
    for (let a = -1.45; a <= 1.451; a += 0.36) {
      const x = c[0] - r[0] * k * Math.cos(a), z = c[2] + r[2] * k * Math.sin(a);
      stud(m, [x, y + 0.15, z], vnorm([-(Math.cos(a)), 0.25, Math.sin(a)]), 0.45, true);
    }
  }
  // spikes rising from the dome
  const onDome = (d: V3): V3 => {
    const t = 1 / Math.sqrt((d[0] / R1[0]) ** 2 + (d[1] / R1[1]) ** 2 + (d[2] / R1[2]) ** 2);
    return vadd(pc, vmul(d, t));
  };
  for (const [d, L, r] of [
    [vnorm([-0.5, 0.86, 0]), 4.6, 1.0],
    [vnorm([-0.48, 0.74, 0.6]), 3.4, 0.86],
    [vnorm([-0.48, 0.74, -0.6]), 3.4, 0.86],
    [vnorm([-0.95, 0.3, 0.34]), 2.1, 0.64],
    [vnorm([-0.95, 0.3, -0.38]), 2.1, 0.64],
  ] as [V3, number, number][])
    spike(m, onDome(d), d, L, r);
  // chain swag hanging round the outside of the arm
  chain(m, [[-6.9, 41.1, 2.8], [-9.6, 39.2, 2.1], [-10.8, 38.75, 0.0], [-9.7, 39.2, -2.15], [-7.0, 41.1, -2.9]], 1.65);
}

/** leather sleeve on the upper arm (full): cap + tube + rolled cuff at the elbow */
function upperSleeve(m: Sc, s: number, C: Ramp, cuff: Ramp, y0 = 33.8, flames = false) {
  const ax = s * 8.0;
  m.shell([s * 8.1, 42.2, -0.1], [2.5, 2.2, 2.45], 1.0, C.base, (x, y) => y > 40.8);
  m.region([ax - 2.6, y0, -2.6], [ax + 2.6, 42.4, 2.6], (x, y, z) => {
    const r = lerp(2.0, 2.2, (y - y0) / (42.4 - y0));
    const d = Math.hypot(x - ax, z);
    return d <= r && d >= r - 1.0;
  }, C.base);
  m.region([ax - 2.6, y0 - 0.2, -2.6], [ax + 2.6, y0 + 1.0, 2.6], (x, y, z) => {
    const d = Math.hypot(x - ax, z);
    return d <= 2.32 && d >= 1.2;
  }, cuff.base);
  if (flames) {
    const arm: Tongue[] = [
      { at: 0, h: 4.4, w: 1.15, lean: 0.4 },
      { at: 1.7, h: 3.4, w: 1.0, lean: -0.4 },
      { at: 3.4, h: 3.9, w: 1.1, lean: 0.35 },
      { at: -1.7, h: 3.1, w: 1.0, lean: 0.4 },
      { at: -3.4, h: 3.6, w: 1.0, lean: -0.3 },
    ];
    m.region([ax - 2.6, y0 + 1.0, -2.6], [ax + 2.6, 40, 2.6], (x, y, z) => Math.hypot(x - ax, z) > 1.6, (x, y, z) => flameCol(arm, Math.atan2(z, -(x - ax) * s) * 2.1, y - (y0 + 1.0)), { mode: 'paint' });
  }
}

function punkArmR(m: Sc) {
  humerus(m, -1);
  upperSleeve(m, -1, LEA, LEA, 33.8, true);
  // zip on the outer side of the sleeve above the cuff
  m.region([-10.6, 34.8, -0.5], [-9.4, 37.6, 0.5], (x, y, z) => Math.abs(z) < 0.3, (x, y) => ((Math.floor(y * S) & 1) ? CHR.base : CHR.dark), { mode: 'paint', flags: M });
  // mod roundel patch on the upper sleeve
  m.region([-10.9, 38.6, -1.4], [-9.4, 41.6, 1.4], (x, y, z) => {
    const d = Math.hypot(y - 40.0, z);
    const r = Math.hypot(x + 8.0, z);
    return d < 1.3 && r > 1.95 && r < 2.65;
  }, (x, y, z) => {
    const d = Math.hypot(y - 40.0, z);
    return d > 1.0 ? TOON.linen.base : d > 0.62 ? TOON.red.base : d > 0.3 ? 0x1c1a20 : TOON.linen.hi;
  });
  punkPauldron(m);
  shadeRamps(m.m, [LEA, BN], true);
}

function punkArmL(m: Sc) {
  humerus(m, 1);
  const ax = 8.0;
  // the torn-off sleeve: a short ragged stump on the shoulder
  const teeth = [0.0, 0.95, 0.3, 1.25, 0.45, 0.0, 0.85, 0.2, 1.05, 0.4];
  const cut = (th: number) => {
    const f = ((th + Math.PI) / (Math.PI * 2)) * teeth.length;
    const i = Math.floor(f) % teeth.length, t = f - Math.floor(f);
    return 40.25 - lerp(teeth[i], teeth[(i + 1) % teeth.length], t);
  };
  m.shell([8.1, 42.2, -0.1], [2.5, 2.2, 2.45], 1.0, (x, y) => (y > 44.0 ? LEA.hi : LEA.base), (x, y) => y > 41.6);
  m.region([ax - 2.6, 38.5, -2.6], [ax + 2.6, 42.4, 2.6], (x, y, z) => {
    const d = Math.hypot(x - ax, z);
    if (d > 2.18 || d < 1.15) return false;
    return y >= cut(Math.atan2(z, x - ax));
  }, (x, y, z) => (y < cut(Math.atan2(z, x - ax)) + 0.55 ? LEA_EDGE : LEA.base));
  // a few torn strips hanging off the edge
  for (const [th, len] of [[0.5, 1.9], [2.3, 1.4], [-2.6, 2.2], [-1.2, 1.2]] as [number, number][]) {
    const p: V3 = [ax + 2.0 * Math.cos(th), cut(th) + 0.2, 2.0 * Math.sin(th)];
    m.cap(p, [p[0] + Math.cos(th) * 0.35, p[1] - len, p[2] + Math.sin(th) * 0.35], 0.32, 0.22, LEA_EDGE);
  }
  // short spikes on the outer face of the stump
  for (const z of [-1.3, 0, 1.3]) spike(m, [ax + 2.05, 41.85, z], vnorm([1, 0.32, z * 0.18]), 1.85, 0.64);
  shadeRamps(m.m, [LEA, BN], true);
}

function punkForeR(m: Sc) {
  forearm(m, -1);
  hand(m, -1, true);
  // spiked leather wrist cuff
  const c: V3 = [-8.55, 26.7, -0.1];
  m.region([c[0] - 2, 25.8, -2], [c[0] + 2, 27.6, 2], (x, y, z) => {
    const d = Math.hypot(x - c[0], z - c[2]);
    return d < 1.68 && d > 0.95 && y > 25.95 && y < 27.45;
  }, (x, y) => (y > 27.2 || y < 26.2 ? LEA_EDGE : LEA.base));
  for (const [dx, dz] of [[-1, 0], [0, 1], [0, -1], [-0.7, 0.7], [-0.7, -0.7]] as [number, number][]) {
    const d = vnorm([dx, 0, dz]);
    spike(m, vadd(c, vmul(d, 1.62)), d, 1.45, 0.54);
  }
  shadeRamps(m.m, [LEA, BN], true);
}

function punkForeL(m: Sc) {
  forearm(m, 1);
  hand(m, 1, false);
  // studded leather band on the left wrist
  const c: V3 = [8.55, 26.65, -0.1];
  m.region([c[0] - 2, 25.8, -2], [c[0] + 2, 27.6, 2], (x, y, z) => {
    const d = Math.hypot(x - c[0], z - c[2]);
    return d < 1.58 && d > 0.95 && y > 26.0 && y < 27.3;
  }, LEA.base);
  for (let a = 0; a < 6; a++) {
    const th = (a / 6) * Math.PI * 2 + 0.3;
    const d: V3 = [Math.cos(th), 0, Math.sin(th)];
    stud(m, vadd(c, vmul(d, 1.55)), d, 0.42, true);
  }
  shadeRamps(m.m, [LEA, BN], true);
}

function punkPelvis(m: Sc) {
  const e = JEANS_ENV;
  // jeans seat (low-rise), crotch split between the legs
  m.region([-8, 19.8, -7], [8, 26.9, 5], (x, y, z) => {
    const r = rhoOf(e, x, y, z);
    if (r > 1 || r < 1 - 1.4 / havg(e, y)) return false;
    return !(y < 22.4 && Math.abs(x) < 0.9 + (22.4 - y) * 1.1);
  }, DEN.base);
  // whiskers (faded creases at the hip front), fly seam + J-stitch, pocket openings, rivets
  m.region([-8, 19.8, 0], [8, 26.9, 5], (x, y, z) => z > 1.0, (x, y, z) => {
    const ax = Math.abs(x);
    for (const [y0, sl] of [[21.4, 0.32], [22.2, 0.22], [23.0, 0.12]] as [number, number][]) if (ax > 1.6 && ax < 4.2 && Math.abs(y - (y0 + (ax - 1.6) * sl)) < 0.22) return DEN.hi;
    if (ax < 0.3 && y > 21.9) return DEN.dark;
    if (x > 0.7 && x < 1.25 && y > 22.3 && y < 25.2) return THREAD;
    const py = 25.25 - Math.pow(Math.max(0, ax - 2.9) / 3.3, 1.6) * 2.4;
    if (ax > 2.9 && ax < 6.3 && Math.abs(y - py) < 0.3) return DEN.dark;
    if (ax > 2.9 && ax < 6.3 && Math.abs(y - (py - 0.5)) < 0.18) return THREAD;
    return null;
  }, { mode: 'paint' });
  for (const s of [1, -1]) {
    const x = s * 6.0;
    m.ell([x, 23.25, frontZ(e, x, 23.25, 0.05)], [0.3, 0.3, 0.3], COPPER, { flags: M });
  }
  // back pockets with amber stitching and the arcuate double arc
  m.region([-7, 20.6, -7], [7, 25.4, -3], (x, y, z) => z < -3.5 && rhoOf(e, x, y, z) > 1 - 0.55 / havg(e, y), (x, y) => {
    const ax = Math.abs(x);
    if (ax < 1.5 || ax > 5.5 || y < 21.0 || y > 24.9) return null;
    if (ax < 1.85 || ax > 5.15 || y < 21.35) return THREAD;
    const arc = 23.6 - 0.45 * Math.sin(((ax - 1.5) / 4) * Math.PI);
    if (Math.abs(y - arc) < 0.17 || Math.abs(y - arc + 0.6) < 0.17) return THREAD;
    return DEN.shade;
  }, { mode: 'paint' });
  // studded black belt with an oval buckle (venom cabochon) and belt loops
  m.region([-8.5, 25.3, -7], [8.5, 27.25, 5.5], (x, y, z) => {
    const r = rhoOf(e, x, y, z);
    return r >= 1.0 && r <= 1 + 0.95 / havg(e, y) && y >= 25.35 && y <= 27.15;
  }, (x, y) => (y > 26.9 || y < 25.6 ? LEA_EDGE : LEA.base));
  for (let th = -2.55; th <= 2.551; th += 0.42) {
    if (Math.abs(th) > 2.2 && Math.abs(th) < 2.7) continue;
    if (th < -1.1 && th > -2.0) continue; // holster drop
    const { p, n } = envPoint(e, th, 26.25, 0.95);
    stud(m, p, n, 0.46, true);
  }
  const bz = frontZ(e, 0, 26.25, 1.2);
  m.ell([0, 26.25, bz], [2.35, 1.5, 0.5], (x, y) => {
    const d = (x / 2.35) ** 2 + ((y - 26.25) / 1.5) ** 2;
    return d > 0.72 ? (y > 26.3 ? CHR.hi : CHR.base) : d > 0.5 ? CHR.dark : CHR.shade;
  }, { flags: M, p: 2.2 });
  m.ell([0, 26.25, bz + 0.42], [0.78, 0.62, 0.42], (x, y) => (x < -0.15 && y > 26.4 ? 0xe6ffd0 : VENOM), { flags: VF.EMISSIVE });
  for (const th of [2.0, -2.0, 1.15, -1.15, 0]) {
    const { p, n } = envPoint(e, th, 26.25, 1.05);
    m.region(vsub(p, [1.2, 1.4, 1.2]), vadd(p, [1.2, 1.4, 1.2]), (x, y, z) => {
      const d = vsub([x, y, z], p), side = vnorm(vcross([0, 1, 0], n));
      return Math.abs(vdot(d, side)) < 0.38 && Math.abs(d[1]) < 1.15 && Math.abs(vdot(d, n)) < 0.3;
    }, DEN.shade);
  }
  holster(m, LEA);
  // wallet chain from the front belt loop to the back pocket
  chain(m, [[5.95, 25.0, 2.3], [6.95, 22.7, 1.25], [7.1, 21.6, -0.8], [6.65, 22.3, -3.0], [4.95, 23.6, -4.85]], 1.5);
  // the iliac crests and the top of the sacrum show above the low-slung belt
  pelvisBones(m, 27.05);
  shadeRamps(m.m, [DEN, LEA, BN], true);
}

/** an irregular rip mask on the front of a leg (centre cx, cy; radii rx, ry) */
const ripMask = (x: number, y: number, cx: number, cy: number, rx: number, ry: number) => {
  const a = Math.atan2(y - cy, x - cx);
  return ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1 + 0.16 * Math.sin(a * 5 + 1.3) + 0.08 * Math.sin(a * 9);
};

function punkThigh(m: Sc, s: number) {
  const ax0: V3 = [s * 3.95, 25.2, -0.75], ax1: V3 = [s * 3.55, 15.6, 0.25];
  m.path([ax0, [s * 3.8, 20.5, -0.2], ax1], (t) => lerp(2.45, 2.1, t), DEN.base);
  // side seam (shade) along the outside of the leg
  m.region([s > 0 ? 4 : -7, 15.4, -1.2], [s > 0 ? 7 : -4, 25.4, 0.8], (x, y, z) => Math.abs(z + 0.15) < 0.3 && s * x > 5.2, DEN.shade, { mode: 'paint' });
  const rip = s > 0 ? { cx: s * 3.6, cy: 16.95, rx: 1.45, ry: 1.45 } : { cx: s * 3.75, cy: 19.6, rx: 1.4, ry: 0.55 };
  const inRip = (x: number, y: number, z: number) => z > -0.2 && ripMask(x, y, rip.cx, rip.cy, rip.rx, rip.ry);
  m.region([rip.cx - 2, rip.cy - 2, -0.4], [rip.cx + 2, rip.cy + 2, 3.2], inRip, 0, { mode: 'carve' });
  m.walls([rip.cx - 2.2, rip.cy - 2.2, -0.6], [rip.cx + 2.2, rip.cy + 2.2, 3.4], (x, y, z) => z > -0.2 && ripMask(x, y, rip.cx, rip.cy, rip.rx, rip.ry), (x, y, z) => (z > 0.6 ? FRAY : DEN.dark));
  femur(m, s, s > 0 ? 18.6 : 21.0);
  // white weft threads bridging the hole
  m.region([rip.cx - 2, rip.cy - 2, 0], [rip.cx + 2, rip.cy + 2, 3.2], (x, y, z) => {
    const j = Math.floor(y * S);
    if (j % 2 || !ripMask(x, y, rip.cx, rip.cy, rip.rx * 0.98, rip.ry * 0.9)) return false;
    const fz = lerp(ax0[2], ax1[2], (ax0[1] - y) / (ax0[1] - ax1[1])) + lerp(2.45, 2.1, (ax0[1] - y) / (ax0[1] - ax1[1])) - 0.35;
    return Math.abs(z - fz) < 0.36;
  }, FRAY);
  shadeRamps(m.m, [DEN, BN], true);
}

function punkShin(m: Sc, s: number) {
  m.path([[s * 3.5, 15.35, 0.3], [s * 3.3, 10.0, 0.05]], (t) => lerp(2.05, 1.85, t), DEN.base);
  // stacking folds just above the boot
  m.region([s * 3.3 - 2.5, 9.7, -2.5], [s * 3.3 + 2.5, 11.0, 2.5], (x, y, z) => Math.hypot(x - s * 3.3, z) < 2.18, (x, y) => (Math.abs(y - 10.35) < 0.22 ? DEN.shade : DEN.base));
  if (s > 0) {
    // the lower half of the knee rip
    const inRip = (x: number, y: number, z: number) => z > -0.2 && ripMask(x, y, s * 3.6, 16.95, 1.45, 1.45);
    m.region([s * 3.6 - 2, 14, -0.4], [s * 3.6 + 2, 15.9, 3.2], inRip, 0, { mode: 'carve' });
    m.walls([s * 3.6 - 2.2, 13.8, -0.6], [s * 3.6 + 2.2, 16, 3.4], (x, y, z) => z > -0.2 && ripMask(x, y, s * 3.6, 16.95, 1.45, 1.45), (x, y, z) => (z > 0.6 ? FRAY : DEN.dark));
  }
  tibia(m, s, 10.4);
  cowboyBoot(m, s, BOOT, { harness: true, spur: true });
  shadeRamps(m.m, [DEN, BOOT, BN], true);
}

// ================================================================== OTHER OUTFITS (same HD language)
interface Look {
  coat: Ramp;
  trim: Ramp;
  band: Ramp;
  boot: Ramp;
  belt: Ramp;
}
const LOOKS: Record<OutfitId, Look> = {
  bare: { coat: TOON.leather, trim: TOON.leatherDark, band: TOON.red, boot: TOON.leather, belt: TOON.leatherDark },
  punk: { coat: LEA, trim: LEA, band: TOON.red, boot: BOOT, belt: LEA },
  duster: { coat: TOON.duster, trim: TOON.leatherDark, band: TOON.red, boot: TOON.leather, belt: TOON.leatherDark },
  poncho: { coat: TOON.poncho, trim: TOON.linen, band: TOON.turquoise, boot: TOON.leather, belt: TOON.leatherDark },
  vest: { coat: TOON.leather, trim: TOON.leatherDark, band: TOON.red, boot: ramp(0x8e3b26, 0x6c2a1b, 0xad5236, 0x4a1a10), belt: TOON.leatherDark },
  sheriff: { coat: ramp(0x3a3a48, 0x2a2a36, 0x50505e, 0x1a1a22), trim: TOON.black, band: TOON.black, boot: TOON.black, belt: TOON.black },
  pharaoh: { coat: TOON.linen, trim: TOON.gold, band: TOON.lapis, boot: TOON.gold, belt: TOON.gold },
};

function sheriffStar(m: Sc, c: V3) {
  const G = TOON.gold;
  m.region([c[0] - 1.6, c[1] - 1.6, c[2] - 0.4], [c[0] + 1.6, c[1] + 1.6, c[2] + 0.4], (x, y, z) => {
    if (Math.abs(z - c[2]) > 0.3) return false;
    const dx = x - c[0], dy = y - c[1], r = Math.hypot(dx, dy), a = Math.atan2(dx, dy);
    const f = Math.abs(((a / ((Math.PI * 2) / 5)) % 1 + 1) % 1 - 0.5);
    return r < 0.55 + (1.45 - 0.55) * Math.pow(f * 2, 2.2) || r < 0.6;
  }, (x, y) => (y > c[1] + 0.4 ? G.hi : G.base), { flags: M });
}

function dusterTorso(m: Sc, C: Ramp, T: Ramp) {
  const e = DUSTER_ENV;
  const xo = (y: number) => lerp(4.4, 5.5, sstep((y - 36) / 8));
  bodyShell(m, e, 29.4, 45.5, 1.2, C.base, xo);
  const outer = (y: number) => 1 + 1.2 / havg(e, y);
  // wide lapels, standing collar
  m.region([-9, 35.4, 0], [9, 44.8, 8], (x, y, z) => {
    const [, , zc] = envAt(e, y);
    if (z < zc + 1.6) return false;
    const ax = Math.abs(x), w = 2.6 * sstep((y - 35.4) / 6);
    if (ax < xo(y) - 0.2 || ax > xo(y) + w) return false;
    const r = rhoOf(e, x, y, z);
    return r >= outer(y) - 0.25 / havg(e, y) && r <= outer(y) + 0.85 / havg(e, y);
  }, T.base);
  m.region([-6.5, 44.2, -6.5], [6.5, 47.2, 2.4], (x, y, z) => {
    const hx = 4.7, hz = 3.9, zc = -1.75;
    const r = Math.pow(Math.pow(Math.abs(x) / hx, 2.4) + Math.pow(Math.abs(z - zc) / hz, 2.4), 1 / 2.4);
    return r >= 1 && r <= 1 + 0.8 / 4.3 && z < zc + 1.9;
  }, T.base);
  // yoke + back seam + half-belt with a brass button; patch pocket on the left chest
  m.region([-9, 29.4, -9], [9, 45, -3], (x, y, z) => rhoOf(e, x, y, z) > outer(y) - 0.4 / havg(e, y) && (Math.abs(y - 41.8) < 0.25 || (Math.abs(x) < 0.3 && y < 41.6)), C.dark, { mode: 'paint' });
  m.region([-5, 30.6, -9], [5, 31.8, -4], (x, y, z) => rhoOf(e, x, y, z) > outer(y) - 0.2 / havg(e, y) && rhoOf(e, x, y, z) < outer(y) + 0.6 / havg(e, y) && Math.abs(x) < 4.6, T.base);
  m.ell([0, 31.2, backZ(e, 0, 31.2, 1.75)], [0.42, 0.42, 0.3], TOON.brass.hi, { flags: M });
  m.region([5, 32.6, 0], [7.4, 35.6, 8], (x, y, z) => x > 5.25 && x < 7.1 && y > 32.8 && y < 35.4 && rhoOf(e, x, y, z) > outer(y) - 0.2 / havg(e, y) && rhoOf(e, x, y, z) < outer(y) + 0.6 / havg(e, y) && z > 0, (x, y) => (y > 35.0 ? T.base : C.shade));
}

function dusterSkirt(C: Ramp, T: Ramp) {
  const m = sc('coat');
  const hx = (y: number) => lerp(8.5, 7.3, (y - 19) / 10.8), hz = (y: number) => lerp(5.6, 4.9, (y - 19) / 10.8), zc = -1.4;
  m.region([-9.5, 19, -8], [9.5, 29.8, 5], (x, y, z) => {
    const r = Math.pow(Math.pow(Math.abs(x) / hx(y), 2.5) + Math.pow(Math.abs(z - zc) / hz(y), 2.5), 1 / 2.5);
    if (r < 1 || r > 1 + 1.1 / ((hx(y) + hz(y)) / 2)) return false;
    if (z > zc + 1 && Math.abs(x) < 3.2) return false; // open front
    if (y < 23.4 && Math.abs(x) < 0.4 && z < zc) return false; // back vent
    return true;
  }, (x, y) => (y < 19.5 ? C.shade : C.base));
  for (const s of [1, -1]) m.region([s * 6, 24.6, -2.6], [s * 9.6, 25.6, 0.6], (x, y, z) => Math.abs(x) > hx(y) + 0.4 && Math.abs(x) < hx(y) + 1.1, T.base); // pocket flaps
  shadeRamps(m.m, [C, T], true);
  return { m, hxB: hx(19), hzB: hz(19), zc };
}

function vestTorso(m: Sc, C: Ramp, T: Ramp, star: boolean) {
  const e = VEST_ENV;
  const arm = (x: number, y: number, z: number) => Math.abs(x) > 5.2 && y > 36.6 && Math.hypot((Math.abs(x) - 8) / 3.2, (y - 42.6) / 6.2) < 1;
  bodyShell(m, e, 30.4, 44.6, 1.0, C.base, () => 2.6, arm);
  m.walls([-9, 30, -8], [9, 45, 7], (x, y, z) => rhoOf(e, x, y, z) < 1 + 1.0 / havg(e, y) && rhoOf(e, x, y, z) > 1 && (arm(x, y, z) || (z > envAt(e, y)[2] + 1 && Math.abs(x) < 2.6)), T.base);
  for (const y of [33.2, 35.6, 38.0]) m.ell([-3.2, y, frontZ(e, -3.2, y, 1.25)], [0.4, 0.4, 0.3], TOON.brass.hi, { flags: M });
  chain(m, [[-3.2, 33.2, frontZ(e, -3.2, 33.2, 1.3)], [-0.5, 32.0, frontZ(e, -0.5, 32.0, 2.6)], [2.4, 32.6, frontZ(e, 2.4, 32.6, 1.5)], [4.4, 33.4, frontZ(e, 4.4, 33.4, 1.2)]], 1.2, TOON.gold);
  if (star) sheriffStar(m, [5.0, 38.4, frontZ(e, 5.0, 38.4, 1.35)]);
}

function ponchoTorso(m: Sc, C: Ramp) {
  const e = PONCHO_ENV;
  bodyShell(m, e, 32.6, 45.8, 0.9, (x, y) => {
    const j = Math.floor(y * S), i = Math.floor(x * S);
    if (y > 36.6 && y < 37.5) return (i + j) % 4 < 2 ? TOON.turquoise.base : TOON.linen.base;
    if (y > 38.2 && y < 39.0) return TOON.red.base;
    if (y > 40.0 && y < 40.9) return (i - j) % 4 < 2 ? TOON.turquoise.base : TOON.linen.base;
    if (y < 33.2) return C.shade;
    return C.base;
  });
  // fringe along the hem
  for (let th = -Math.PI; th < Math.PI; th += 0.16) {
    const { p } = envPoint(e, th, 32.6, 0.45);
    m.cap(p, vadd(p, [0, -1.3, 0]), 0.24, 0.2, TOON.linen.shade);
  }
}

function pharaohTorso(m: Sc) {
  const e = RIB_ENV;
  const rows: [number, number, number][] = [[43.9, 44.7, TOON.gold.base], [42.9, 43.9, TOON.lapis.base], [41.9, 42.9, TOON.gold.hi], [40.9, 41.9, TOON.turquoise.base], [40.0, 40.9, TOON.gold.base]];
  for (const [y0, y1, c] of rows)
    m.region([-9, y0, -8], [9, y1, 7], (x, y, z) => {
      const r = rhoOf(e, x, y, z), o = 1 + (0.6 + (44.7 - y) * 0.25) / havg(e, y);
      return r >= o && r <= o + 0.9 / havg(e, y) && y >= y0 && y < y1;
    }, c, { flags: c === TOON.gold.base || c === TOON.gold.hi ? M : VF.SOLID });
  // scarab pectoral on the sternum
  const z = frontZ(e, 0, 37.6, 0.9);
  m.ell([0, 37.6, z], [1.2, 1.5, 0.5], TOON.lapis.base);
  m.ell([0, 38.6, z + 0.3], [0.55, 0.45, 0.35], TOON.turquoise.hi);
  for (const s of [1, -1]) m.cap([s * 1.0, 37.8, z], [s * 2.4, 38.6, z - 0.3], 0.4, 0.25, TOON.gold.base, { flags: M });
}

function shendyt() {
  const m = sc('coat');
  const L = TOON.linen;
  const hx = (y: number) => lerp(8.4, 7.1, (y - 17.4) / 10.6), hz = 4.9, zc = -1.3;
  m.region([-9, 17.4, -7], [9, 28.0, 5], (x, y, z) => {
    const r = Math.pow(Math.pow(Math.abs(x) / hx(y), 2.4) + Math.pow(Math.abs(z - zc) / hz, 2.4), 1 / 2.4);
    return r >= 1 && r <= 1 + 1.0 / ((hx(y) + hz) / 2);
  }, (x, y, z) => ((Math.floor((Math.atan2(x, -(z - zc)) + 4) * 9) & 1) ? L.base : L.shade));
  m.region([-9, 27.0, -7], [9, 28.4, 5], (x, y, z) => {
    const r = Math.pow(Math.pow(Math.abs(x) / (hx(y) + 0.2), 2.4) + Math.pow(Math.abs(z - zc) / (hz + 0.2), 2.4), 1 / 2.4);
    return r >= 1 && r <= 1.2;
  }, TOON.gold.base, { flags: M });
  m.rbox([0, 22.6, zc + hz + 1.25], [1.6, 4.6, 0.3], 0.2, (x, y) => ((Math.floor(y * S) % 3 === 0) ? TOON.lapis.base : TOON.gold.base), { flags: M });
  shadeRamps(m.m, [L], true);
  return m;
}

// ================================================================== HATS (fit the dome; hat part pivots at J.hat)
function stetson(F: Ramp, band: number, o: { battered?: boolean; gambler?: boolean; studs?: boolean; feather?: number } = {}) {
  const h = sc('hat');
  const B0 = 58.85;
  const lean = (k: number) => (o.battered ? 0.4 * k : 0);
  // brim: cattleman curl at the sides, dipped front/back, torn notch + bullet hole when battered
  const brimY = (x: number, z: number) => B0 + (o.gambler ? 0.7 : 2.6) * Math.pow(Math.abs(x) / 13.6, 3) - 0.8 * Math.pow(Math.max(0, (z + 0.6) / 12.2), 2) - 0.35 * Math.pow(Math.max(0, -(z + 0.6) / 12.2), 2);
  h.region([-14.6, B0 - 1.5, -13.6], [14.6, B0 + 3.6, 12.6], (x, y, z) => {
    const ex = x / 13.6, ez = (z + 0.6) / 12.2;
    let e = ex * ex + ez * ez;
    if (o.battered) {
      const a = Math.atan2(x, z + 0.6);
      e *= 1 + 0.03 * Math.sin(a * 7 + 1) + (Math.abs(a - 0.62) < 0.13 ? 0.18 * (1 - Math.abs(a - 0.62) / 0.13) : 0);
      if (Math.hypot(x + 9.2, z + 6.2) < 0.62) return false; // bullet hole
    }
    if (e > 1) return false;
    const yb = brimY(x, z);
    return y >= yb && y <= yb + 0.82;
  }, (x, y, z) => {
    const e = (x / 13.6) ** 2 + ((z + 0.6) / 12.2) ** 2;
    return e > 0.88 ? F.shade : F.base;
  });
  // crown: pinched cattleman crease (or flat gambler top), a lived-in lean and a dent
  const yTop = o.gambler ? 65.7 : 66.6;
  h.region([-8, B0, -9], [8, yTop + 0.6, 7], (x, y, z) => {
    if (y < B0 + 0.35) return false;
    const k = (y - B0) / (yTop - B0);
    const lx = x - lean(k);
    let rx = lerp(6.75, o.gambler ? 6.3 : 5.45, k);
    const rz = lerp(7.45, o.gambler ? 7.0 : 6.3, k), zc = -0.9;
    if (o.battered && lx > 0) rx -= 0.95 * Math.exp(-(((y - 63.3) / 1.7) ** 2) - ((z + 1.2) / 2.3) ** 2);
    const d = Math.pow(Math.abs(lx) / rx, 2.6) + Math.pow(Math.abs(z - zc) / rz, 2.6);
    if (d > 1) return false;
    let top = yTop;
    if (!o.gambler) {
      top -= 1.5 * Math.exp(-((lx / 1.25) ** 2)) * sstep((z + 6) / 3);
      if (z > 1.5) top -= 1.7 * Math.exp(-(((Math.abs(lx) - 2.7) / 1.05) ** 2)) * sstep((z - 1.5) / 4);
      top -= 0.9 * sstep((z - 4) / 2.5);
    }
    if (y > top) return false;
    const di = Math.pow(Math.abs(lx) / (rx - 1.05), 2.6) + Math.pow(Math.abs(z - zc) / (rz - 1.05), 2.6);
    return !(di < 1 && y < top - 1.05);
  }, F.base);
  // band round the crown base
  h.region([-8, B0 + 0.35, -9], [8, B0 + 1.95, 7], (x, y, z) => {
    const rx = 6.75 - 0.15, rz = 7.45 - 0.15;
    const d = Math.pow(Math.abs(x) / rx, 2.6) + Math.pow(Math.abs(z + 0.9) / rz, 2.6);
    return d > 0.78 && d < 1.12;
  }, band, { mode: 'paint' });
  if (o.studs) {
    for (let a = -2.4; a <= 2.41; a += 0.6) {
      const x = 6.85 * Math.sin(a), z = -0.9 + 7.55 * Math.cos(a);
      stud(h, [x, B0 + 1.15, z], vnorm([Math.sin(a), 0, Math.cos(a)]), 0.48);
    }
  }
  if (o.feather !== undefined) {
    // a barred feather tucked in the band on the left, its blade turned to face front-left
    const pts = spline([[6.3, B0 + 1.1, -1.6], [7.35, B0 + 3.6, -3.3], [8.0, B0 + 6.4, -5.3], [8.05, B0 + 8.3, -6.6]], 6);
    const smp = resample(pts, 0.22);
    smp.forEach((q, k) => {
      const t = k / Math.max(1, smp.length - 1);
      let n = vnorm([1, 0, 0.85]);
      n = vnorm(vsub(n, vmul(q.t, vdot(n, q.t))));
      const w = vnorm(vcross(q.t, n));
      const half = 0.22 + 0.85 * Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.08)), 0.55);
      h.oell(q.p, [q.t, w, n], [0.3, half, 0.27], (x, y, z) => {
        const off = Math.abs(vdot(vsub([x, y, z], q.p), w));
        if (off < 0.18) return TOON.linen.shade; // quill
        return t > 0.84 ? TOON.white.base : (Math.floor(t * 9) & 1) ? TOON.linen.base : o.feather!;
      });
    });
  }
  if (o.battered) {
    // bullet hole through the front of the crown, scorched rim
    const hole = (x: number, y: number) => Math.hypot(x + 2.9, y - 64.1) < 0.6;
    h.region([-4, 63, 2], [-2, 65.2, 7], (x, y, z) => hole(x, y), 0, { mode: 'carve' });
    h.walls([-4.5, 62.5, 1.5], [-1.5, 65.7, 7], (x, y) => hole(x, y), F.dark);
  }
  shadeRamps(h.m, [F], true);
  return h.m;
}

function sombrero() {
  const straw = ramp(0xe8c47a, 0xc9a25a, 0xf8dc9c, 0x9a7a3a);
  const h = sc('hat');
  const B0 = 58.85;
  h.region([-18.5, B0 - 0.5, -19], [18.5, B0 + 3.4, 18], (x, y, z) => {
    const r = Math.hypot(x, z + 0.6);
    if (r > 18) return false;
    const yb = B0 + (r > 15 ? 2.3 * sstep((r - 15) / 3) : 0);
    return y >= yb && y <= yb + 0.82;
  }, (x, y, z) => {
    const r = Math.hypot(x, z + 0.6);
    return r > 16.9 ? TOON.red.base : (Math.floor(r * 0.75) & 1) ? straw.base : straw.shade;
  });
  h.region([-9, B0, -9.6], [9, 72.8, 8.4], (x, y, z) => {
    const rr = y < 61 ? 8.4 : 8.4 - (y - 61) * 0.62;
    const r = Math.hypot(x, z + 0.6);
    return r <= rr && (r >= rr - 1.1 || y > 71.6) && y < 72.6 - (r / 8.4) * 0.4;
  }, (x, y, z) => ((Math.floor(y * S) + Math.floor((Math.atan2(x, z + 0.6) + 4) * 6)) % 3 === 0 ? straw.shade : straw.base));
  h.region([-9.2, 60.5, -9.8], [9.2, 62.3, 8.6], (x, y, z) => Math.hypot(x, z + 0.6) > 7.35, (x, y, z) => {
    const a = Math.floor((Math.atan2(x, z + 0.6) + 4) * 4);
    return a % 3 === 0 ? TOON.green.base : y < 61.3 ? TOON.red.base : TOON.gold.base;
  }, { mode: 'paint' });
  shadeRamps(h.m, [straw], true);
  return h.m;
}

function tophat() {
  const K = TOON.black;
  const h = sc('hat');
  const B0 = 58.85;
  h.region([-11, B0 - 0.5, -11], [11, B0 + 2, 10], (x, y, z) => {
    const e = (x / 10.6) ** 2 + ((z + 0.6) / 9.8) ** 2;
    if (e > 1) return false;
    const yb = B0 + (Math.abs(x) > 8.2 ? 1.1 * sstep((Math.abs(x) - 8.2) / 2.4) : 0);
    return y >= yb && y <= yb + 0.8;
  }, K.base);
  h.region([-7.6, B0, -8.2], [7.6, 75.4, 6.8], (x, y, z) => {
    const f = y > 70 ? (y - 70) * 0.07 : 0;
    const d = Math.pow(Math.abs(x) / (6.9 + f), 3) + Math.pow(Math.abs(z + 0.7) / (6.4 + f), 3);
    const di = Math.pow(Math.abs(x) / (5.9 + f), 3) + Math.pow(Math.abs(z + 0.7) / (5.4 + f), 3);
    return d <= 1 && (di > 1 || y > 74.4) && y <= 75.3;
  }, (x, y) => (y > 61.2 && y < 63.4 ? TOON.red.base : y > 74.9 ? K.hi : K.base));
  // a playing card tucked in the band
  const cz = 6.0;
  h.rbox([3.9, 64.4, cz], [1.05, 1.55, 0.22], 0.15, TOON.white.base);
  h.ell([3.9, 64.4, cz + 0.2], [0.42, 0.5, 0.2], TOON.red.base);
  shadeRamps(h.m, [K], true);
  return h.m;
}

function nemes() {
  const G = TOON.gold, L = TOON.lapis;
  const h = sc('hat');
  const stripe = (x: number, y: number) => ((Math.floor(y * S / 1.5) & 1) ? L.base : G.base);
  const fl = (x: number, y: number) => ((Math.floor(y * S / 1.5) & 1) ? VF.SOLID : M);
  void fl;
  h.shell([0, 55.6, -0.9], [7.0, 8.45, 7.75], 0.95, stripe, (x, y, z) => y > 50 && !(z > 1.2 && y < 57.6), { p: 2.25 });
  h.region([-7, 57.4, 2], [7, 58.5, 7.5], (x, y, z) => Math.pow(Math.abs(x) / 7.0, 2.25) + Math.pow(Math.abs(y - 55.6) / 8.45, 2.25) + Math.pow(Math.abs(z + 0.9) / 7.75, 2.25) <= 1 && z > 1.2, G.hi, { mode: 'paint', flags: M });
  for (const s of [1, -1]) h.rbox([s * 7.5, 44.6, 0], [1.2, 6.3, 0.9], 0.4, stripe);
  h.region([-3.6, 42.6, -9.4], [3.6, 51, -6.6], (x, y, z) => Math.abs(x) < 1.6 + (y - 42.6) * 0.25 && z < -7.0 && z > -8.6 && y < 50.6, stripe);
  // uraeus cobra rearing on the forehead, ruby eyes
  h.cap([0, 57.8, 6.5], [0, 60.6, 7.4], 0.55, 0.42, G.base, { flags: M });
  h.ell([0, 60.9, 7.5], [0.95, 1.0, 0.45], G.hi, { flags: M });
  for (const s of [1, -1]) h.ell([s * 0.35, 61.1, 7.95], [0.18, 0.18, 0.18], TOON.red.hi, { flags: M });
  shadeRamps(h.m, [G, L], true);
  return h.m;
}

function hatDuck() {
  const yel = ramp(0xffd23a, 0xe8a91c, 0xffeb8a, 0xb07a10);
  const org = ramp(0xff8a2a, 0xd8661a, 0xffac5a, 0x9a4410);
  const h = sc('hat');
  h.ell([0, 63.4, -1.0], [6.6, 3.7, 7.6], yel.base, { p: 2.2 }); // body on the dome
  h.ell([0, 69.5, 2.4], [3.7, 3.7, 3.6], yel.base); // head
  h.cap([0, 64.4, -6.6], [0, 67.0, -9.2], 1.7, 0.6, yel.base); // tail flick
  for (const s of [1, -1]) h.ell([s * 6.0, 63.9, -1.4], [1.0, 2.4, 4.1], yel.shade); // wings
  h.ell([0, 68.5, 6.4], [2.2, 0.85, 2.2], org.base); // beak
  h.ell([0, 67.7, 6.0], [1.8, 0.45, 1.8], org.shade);
  for (const s of [1, -1]) {
    h.ell([s * 2.35, 70.4, 4.75], [0.78, 0.78, 0.6], 0x14100c, { flags: M }); // glossy toy eyes
    h.ell([s * 2.35 - 0.3, 70.75, 5.25], [0.22, 0.22, 0.2], 0xffffff);
  }
  shadeRamps(h.m, [yel, org], true);
  return h.m;
}

function buildHat(id: HatId, o: OutfitId) {
  switch (id) {
    case 'duck':
      return hatDuck();
    case 'sombrero':
      return sombrero();
    case 'nemes':
      return nemes();
    case 'tophat':
      return tophat();
    case 'bandit':
      return stetson(ramp(0x34302e, 0x242120, 0x4a4542, 0x141212), 0xb8bcc4, { gambler: true, studs: true, feather: TOON.red.base });
    case 'wig':
      return frogWigHat(54); // Mama Frog's fabulous wig
    default:
      if (o === 'sheriff') return stetson(ramp(0x5a4a3c, 0x45382c, 0x726050, 0x2c2218), TOON.black.base);
      return stetson(TOON.hat, 0x2a201c, { battered: true, studs: true, feather: 0x3a2a20 });
  }
}
const HAT_TOP: Record<HatId, number> = { stetson: 67.3, duck: 73.3, sombrero: 72.8, nemes: 64.6, tophat: 75.5, bandit: 66.2, wig: FROG_WIG_TOP };

// ================================================================== OUTLAW MASK (cloth tied over the lower face)
/** the cloth wraps the jaw like a loose cylinder: rows [y, half width, half depth, centre z] (head frame) */
const MASK_ENV: Env = [
  [43.6, 5.0, 3.9, 3.3],
  [45.0, 6.0, 5.05, 2.05],
  [46.6, 6.3, 5.73, 1.12],
  [48.0, 6.15, 6.8, -0.25],
  [49.4, 6.1, 7.03, -0.53],
  [51.2, 6.2, 7.03, -0.68],
];
const MASK_T = 0.8;
/** top hem: just under the nose cavity at the front, rising over the cheeks to the knot at the back */
const maskTop = (c: number) => 50.9 - 1.55 * Math.pow((c + 1) / 2, 1.6);
/** bottom edge: under the chin at the front (the drape carries on below), a narrow band at the back */
const maskBot = (c: number) => 48.6 - 4.6 * Math.pow((c + 1) / 2, 0.7);
const MASK_LOOK: Record<OutfitId, { r: Ramp; print: number; dim: number }> = {
  punk: { r: ramp(0x7c2622, 0x5c1a17, 0x9c3c33, 0x380f0c), print: 0xc08a76, dim: 0x8e4a3e }, // oxblood, faded rose paisley
  bare: { r: TOON.red, print: 0xd8b8a0, dim: TOON.red.hi },
  duster: { r: TOON.red, print: 0xd8b8a0, dim: TOON.red.hi },
  vest: { r: TOON.red, print: 0xd8b8a0, dim: TOON.red.hi },
  poncho: { r: TOON.turquoise, print: 0xe6dcc4, dim: TOON.turquoise.hi },
  sheriff: { r: TOON.black, print: 0x8a8580, dim: 0x58524e },
  pharaoh: { r: TOON.lapis, print: TOON.gold.base, dim: TOON.lapis.hi },
};

/** an outlaw's cloth pulled up over the jaw and teeth, knotted behind the skull (child of `head`; the jaw moves inside it) */
function outlawMask(o: OutfitId) {
  const { r: R, print, dim } = MASK_LOOK[o] ?? MASK_LOOK.punk;
  const m = sc('mask');
  const e = MASK_ENV;
  const cOf = (x: number, y: number, z: number) => -Math.cos(thetaOf(e, x, y, z)); // 1 front, -1 back
  // faded paisley: teardrop dots on a staggered lattice (deliberate, not noise)
  const printAt = (x: number, y: number, z: number) => {
    const i = Math.floor(x * S), j = Math.floor(y * S), l = Math.floor(z * S);
    const h = i + l + (Math.floor(j / 4) & 1) * 3;
    const jm = ((j % 4) + 4) % 4, hm = ((h % 6) + 6) % 6;
    if (jm === 0 && hm === 0) return print;
    if (jm === 1 && hm === 1) return dim;
    if (jm === 2 && hm === 3) return dim;
    return null;
  };
  // the band wrapping jaw, cheeks and the back of the skull
  m.region([-7.5, 43.4, -9], [7.5, 51.6, 8.5], (x, y, z) => {
    const rr = rhoOf(e, x, y, z);
    if (rr < 1 || rr > 1 + MASK_T / havg(e, y)) return false;
    const c = cOf(x, y, z);
    return y <= maskTop(c) && y >= maskBot(c);
  }, (x, y, z) => {
    const c = cOf(x, y, z), t = maskTop(c);
    if (t - y < 0.5) return R.hi; // rolled top hem
    const th = Math.abs(thetaOf(e, x, y, z));
    // tension creases running from the chin up toward the knot
    if (Math.abs(c) < 0.85 && ((y - 44.2 + th * 1.35) / 1.55) % 1 < 0.17) return R.shade;
    return printAt(x, y, z) ?? R.base;
  });
  // the rolled hem stands proud just under the nose
  m.region([-7, 48.6, -9], [7, 51.4, 8.5], (x, y, z) => {
    const rr = rhoOf(e, x, y, z);
    const c = cOf(x, y, z), t = maskTop(c);
    return rr >= 1 + MASK_T / havg(e, y) && rr <= 1 + (MASK_T + 0.45) / havg(e, y) && y <= t && y > t - 0.55;
  }, R.hi);
  // raised folds where the cloth is pulled taut round the jaw (both cheeks)
  for (const s of [1, -1])
    for (const [y0, y1] of [[49.3, 45.6], [48.4, 44.9]] as [number, number][]) {
      const pts: V3[] = [];
      for (let k = 0; k <= 12; k++) {
        const t = k / 12, th = s * lerp(1.0, 2.55, t), y = lerp(y0, y1, t);
        const c = -Math.cos(th);
        if (y > maskTop(c) - 0.3 || y < maskBot(c) + 0.2) continue;
        pts.push(envPoint(e, th, y, MASK_T - 0.1).p);
      }
      if (pts.length > 1) m.path(pts, (t) => 0.36 * Math.sin(Math.PI * clamp(t * 1.1, 0, 1)) + 0.12, R.shade);
    }
  // the drape hanging in front of the throat: a frayed triangle with soft folds
  const drapeZ = (x: number, v: number) => 7.15 - v * 0.75 - 0.05 * x * x + 0.32 * Math.sin(x * 1.9 + v * 2) * (0.3 + v);
  const drapeW = (v: number) => 4.7 * (1 - v);
  const tipX = (v: number) => 0.35 * v;
  m.region([-5.2, 40.4, 3.5], [5.2, 44.7, 8.6], (x, y, z) => {
    const v = (44.55 - y) / 3.75;
    if (v < 0 || v > 1) return false;
    const w = drapeW(v) * (1 + 0.06 * Math.sin(y * 7.3));
    if (Math.abs(x - tipX(v)) > w) return false;
    return Math.abs(z - drapeZ(x, v)) < 0.42;
  }, (x, y, z) => {
    const v = (44.55 - y) / 3.75, w = drapeW(v);
    if (w - Math.abs(x - tipX(v)) < 0.55) return print; // faded border
    if (Math.sin(x * 1.9 + v * 2) < -0.55 && v > 0.2) return R.shade; // fold valleys
    return printAt(x, y, z) ?? R.base;
  });
  // fraying: loose threads off both lower edges of the drape and the sides of the band
  for (let k = 1; k <= 9; k++) {
    const v = k / 10;
    for (const s of [1, -1]) {
      if ((k + (s > 0 ? 0 : 1)) % 2) continue;
      const y = 44.55 - v * 3.75, x = tipX(v) + s * drapeW(v);
      const z = drapeZ(x, v);
      m.cap([x, y, z], [x + s * 0.15, y - 0.6 - 0.35 * (k % 3), z - 0.1], 0.22, 0.16, k % 3 ? R.shade : dim);
    }
  }
  for (const s of [1, -1])
    for (const th of [1.55, 1.95, 2.3]) {
      const c = -Math.cos(th), y = maskBot(c) + 0.1;
      const { p } = envPoint(e, s * th, y, MASK_T * 0.5);
      m.cap(p, [p[0], p[1] - 0.7, p[2]], 0.22, 0.16, R.shade);
    }
  // the knot behind the skull, with two short tails (the long ends flutter as engine cloth from bandana_anchor)
  m.ell([0.45, 50.05, -8.25], [1.25, 1.0, 0.95], R.shade);
  m.ell([-0.65, 50.3, -8.0], [0.85, 0.78, 0.75], R.base);
  m.ell([1.55, 50.3, -8.0], [0.85, 0.78, 0.75], R.base);
  m.region([-0.2, 49.2, -9.4], [1.1, 51.0, -8.6], (x, y, z) => Math.abs(x - 0.45) < 0.22 && z < -8.9, R.dark, { mode: 'paint' });
  for (const [pts, w0] of [
    [[[0.1, 49.4, -8.6], [-0.55, 48.0, -9.0], [-0.75, 46.9, -9.1]], 0.78],
    [[[0.9, 49.4, -8.6], [1.65, 47.85, -9.05], [2.05, 46.5, -9.15]], 0.72],
  ] as [V3[], number][]) {
    m.sweep(pts, (t) => [w0 - 0.3 * t, 0.42, 0.3], (x, y) => (y < pts[2][1] + 0.5 ? dim : R.base), 0.18);
    const end = pts[2];
    for (const dx of [-0.35, 0.3]) m.cap([end[0] + dx, end[1], end[2]], [end[0] + dx * 1.3, end[1] - 0.55, end[2] - 0.05], 0.18, 0.14, R.shade);
  }
  shadeRamps(m.m, [R], true);
  return { m: m.m, R };
}

// ================================================================== RIG
const STRAP_OFF: Record<OutfitId, [Env, number]> = {
  punk: [PUNK_ENV, PUNK_T + 0.5],
  duster: [DUSTER_ENV, 1.7],
  sheriff: [DUSTER_ENV, 1.7],
  vest: [VEST_ENV, 1.5],
  poncho: [PONCHO_ENV, 1.4],
  bare: [RIB_ENV, 0.55],
  pharaoh: [RIB_ENV, 0.55],
};

/** Sundown, the player: HD build (1/54 m). Same part names, tree, joints and sockets as ever. */
export function skeletonCowboyRig(look: CowboyLook = { hat: 'stetson', outfit: 'punk' }): RigSpec {
  const o = look.outfit;
  const LK = LOOKS[o] ?? LOOKS.punk;
  const sk = buildSkull();
  const punk = o === 'punk';
  const coatish = o === 'duster' || o === 'sheriff';

  // ---- torso
  const torso = sc('torso');
  torsoBones(torso, o === 'bare' || o === 'pharaoh');
  if (punk) punkTorso(torso);
  else if (coatish) dusterTorso(torso, LK.coat, LK.trim);
  else if (o === 'vest') vestTorso(torso, LK.coat, LK.trim, false);
  else if (o === 'poncho') ponchoTorso(torso, LK.coat);
  else if (o === 'pharaoh') pharaohTorso(torso);
  if (o === 'sheriff') {
    sheriffStar(torso, [5.4, 38.6, frontZ(DUSTER_ENV, 5.4, 38.6, 1.6)]);
    torso.path([[-1.0, 45.0, 1.6], [0, 41.0, 4.9], [0, 37.6, 5.3]], () => 0.2, TOON.black.base); // bolo string
    torso.ell([0, 41.6, 5.0], [0.6, 0.6, 0.35], TOON.silver.hi, { flags: M });
  }
  // the outlaw mask (default on every outfit) is the bandana pulled up over the face; without it he wears it round the neck
  const masked = look.mask !== false;
  const mask = masked ? outlawMask(o) : null;
  if (!masked && o !== 'sheriff' && o !== 'pharaoh') bandana(torso, LK.band);
  const [senv, soff] = STRAP_OFF[o] ?? STRAP_OFF.punk;
  sling(torso, senv, soff);
  shadeRamps(torso.m, [BN, LK.coat, LK.trim, LK.band, STRAP], true);

  // ---- pelvis
  const pelvis = sc('pelvis');
  if (punk) punkPelvis(pelvis);
  else {
    pelvisBones(pelvis, -100);
    gunBelt(pelvis, LK.belt, o === 'pharaoh' ? TOON.gold : TOON.brass);
    shadeRamps(pelvis.m, [BN, LK.belt], true);
  }

  // ---- arms
  const armL = sc('arm_l'), armR = sc('arm_r'), foreL = sc('fore_l'), foreR = sc('fore_r');
  if (punk) {
    punkArmL(armL);
    punkArmR(armR);
    punkForeL(foreL);
    punkForeR(foreR);
  } else {
    humerus(armL, 1);
    humerus(armR, -1);
    forearm(foreL, 1);
    hand(foreL, 1, false);
    forearm(foreR, -1);
    hand(foreR, -1, true);
    if (coatish) {
      upperSleeve(armL, 1, LK.coat, LK.trim);
      upperSleeve(armR, -1, LK.coat, LK.trim);
    }
    if (o === 'pharaoh')
      for (const [m, s, y, ax] of [[armL, 1, 37.8, 8.0], [armR, -1, 37.8, 8.0], [foreL, 1, 28.2, 8.5], [foreR, -1, 28.2, 8.5]] as [Sc, number, number, number][])
        m.region([s * ax - 1.6, y - 0.6, -1.6], [s * ax + 1.6, y + 0.6, 1.6], (x, yy, z) => {
          const d = Math.hypot(x - s * ax, z);
          return d < 1.35 && d > 0.75;
        }, (x, yy) => (yy > y ? TOON.gold.hi : TOON.gold.base), { flags: M });
    for (const m of [armL, armR, foreL, foreR]) shadeRamps(m.m, [BN, LK.coat, LK.trim], true);
  }

  // ---- legs
  const thighL = sc('thigh_l'), thighR = sc('thigh_r'), shinL = sc('shin_l'), shinR = sc('shin_r');
  if (punk) {
    punkThigh(thighL, 1);
    punkThigh(thighR, -1);
    punkShin(shinL, 1);
    punkShin(shinR, -1);
  } else {
    for (const [th, sh, s] of [[thighL, shinL, 1], [thighR, shinR, -1]] as [Sc, Sc, number][]) {
      femur(th, s);
      if (o === 'bare' || o === 'pharaoh') {
        tibia(sh, s);
        boneFoot(sh, s);
        if (o === 'pharaoh') {
          sh.region([s * 3.3 - 2.4, 0, -3.4], [s * 3.3 + 2.4, 0.5, 6.4], (x, y, z) => ((x - s * 3.3) / 2.1) ** 2 + ((z - 1.4) / 4.6) ** 2 <= 1, TOON.gold.shade, { flags: M });
          sh.cap([s * 1.6, 2.1, 1.0], [s * 5.0, 2.1, 1.0], 0.36, 0.36, TOON.gold.base, { flags: M });
        }
      } else {
        tibia(sh, s, 9.0);
        cowboyBoot(sh, s, LK.boot, { spur: true });
      }
      shadeRamps(th.m, [BN], true);
      shadeRamps(sh.m, [BN, LK.boot], true);
    }
  }

  const hat = buildHat(look.hat, o);
  const topY = HAT_TOP[look.hat];

  // ---- expressions: jaw / brow angles + modelled eye variants
  const expressions = defaultExpressions([...SUNDOWN_EXPRESSIONS]) as Record<string, { jaw?: number; brow?: [number, number]; parts?: Record<string, VoxelModel> }>;
  const eyeCache = new Map<string, VoxelModel>();
  const eye = (side: 'l' | 'r', v: EyeVar) => {
    const k = side + v;
    let m = eyeCache.get(k);
    if (!m) eyeCache.set(k, (m = eyeModel('eye_' + side, side === 'l' ? 1 : -1, v)));
    return m;
  };
  for (const [name, [l, r]] of Object.entries(EYE_EXPR)) if (expressions[name] && (l !== 'normal' || r !== 'normal')) expressions[name].parts = { eye_l: eye('l', l), eye_r: eye('r', r) };

  const parts: PartSpec[] = [];
  const P = (name: string, model: VoxelModel, joint: V3, parent?: string) => {
    if (model.count > 0) parts.push({ name, model, pivot: vx(joint), attach: vx(joint), parent });
  };
  P('pelvis', pelvis.m, J.pelvis);
  P('torso', torso.m, J.waist, 'pelvis');
  P('head', sk.head.m, J.neck, 'torso');
  P('jaw', sk.jaw.m, J.jaw, 'head');
  P('eye_l', eye('l', 'normal'), J.eye, 'head');
  P('eye_r', eye('r', 'normal'), mg(J.eye), 'head');
  P('brow_l', sk.brow_l, J.brow, 'head');
  P('brow_r', sk.brow_r, mg(J.brow), 'head');
  P('hat', hat, J.hat, 'head');
  if (mask) P('mask', mask.m, J.neck, 'head');
  P('arm_l', armL.m, J.shoulder, 'torso');
  P('fore_l', foreL.m, J.elbow, 'arm_l');
  P('arm_r', armR.m, mg(J.shoulder), 'torso');
  P('fore_r', foreR.m, mg(J.elbow), 'arm_r');
  P('thigh_l', thighL.m, J.hip, 'pelvis');
  P('shin_l', shinL.m, J.knee, 'thigh_l');
  P('thigh_r', thighR.m, mg(J.hip), 'pelvis');
  P('shin_r', shinR.m, mg(J.knee), 'thigh_r');
  let skirt: ReturnType<typeof dusterSkirt> | null = null;
  if (coatish) {
    skirt = dusterSkirt(LK.coat, LK.trim);
    P('coat', skirt.m.m, [0, 29.5, -6.5], 'pelvis');
  }
  if (o === 'pharaoh') P('coat', shendyt().m, [0, 28.5, -5.5], 'pelvis');

  const poncho = o === 'poncho';
  const sock = (part: string, at: V3, rot?: V3): SocketSpec => ({ part, at: vx(at), rot });
  const backZu = punk ? backZ(PUNK_ENV, 0, 39, PUNK_T) : backZ(senv, 0, 39, soff - 0.5);
  const sockets: Record<string, SocketSpec> = {
    hand_r: sock('fore_r', mg(J.hand)),
    hand_l: sock('fore_l', J.hand),
    head_top: sock('head', [0, SKULL_TOP + 0.5, -1]),
    back: sock('torso', [0, 37, backZu - 0.3]),
    // Pinch perches on the left shoulder, on top of the torn sleeve stump
    shoulder_l: sock('torso', [8, 45.0, -0.4]),
    shoulder_r: sock('torso', [-8, 45.6, -0.4]),
    hip_r: sock('pelvis', [-7.8, 25, 0.5]),
    chest: sock('torso', [0, 38, 5.4]),
    eye_l: sock('head', J.eye),
    eye_r: sock('head', mg(J.eye)),
    mouth: sock('jaw', [0, 47.5, 6]),
    hat_top: sock('hat', [0, topY, -1]),
    // the cloth tails flutter from the mask knot (or from the back of the neck bandana)
    bandana_anchor: mask ? sock('mask', [0.45, 48.9, -8.75]) : sock('torso', [0, 45.2, -5.6]),
    // the sandboard rides between the shoulder blades, held by the sling (see attachBoardOnBack)
    board_back: sock('torso', [0, 39, backZu - 1.0]),
    ...(poncho
      ? {
          coat_anchor_l: sock('torso', [11.4, 33, 0]),
          coat_anchor_r: sock('torso', [-11.4, 33, 0]),
          coat_anchor_back: sock('torso', [0, 33, -8.4]),
          coat_anchor_front: sock('torso', [0, 33, 6.4]),
        }
      : skirt
        ? {
            coat_anchor_l: sock('coat', [skirt.hxB + 0.4, 19.4, skirt.zc]),
            coat_anchor_r: sock('coat', [-skirt.hxB - 0.4, 19.4, skirt.zc]),
            coat_anchor_back: sock('coat', [0, 19.4, skirt.zc - skirt.hzB - 0.6]),
            coat_anchor_front: sock('pelvis', [0, 22, 3]),
          }
        : {
            coat_anchor_l: sock('pelvis', [10, 19.5, -2]),
            coat_anchor_r: sock('pelvis', [-10, 19.5, -2]),
            coat_anchor_back: sock('pelvis', [0, 19.5, -9]),
            coat_anchor_front: sock('pelvis', [0, 22, 3]),
          }),
  };
  const mm = (p: V3) => [p[0] * U, p[1] * U, p[2] * U];
  const clothCoat = coatish || poncho;
  return {
    name: `cowboy_${look.hat}_${look.outfit}${mask ? '' : '_nomask'}`,
    voxelSize: SUNDOWN_HD_VS,
    parts,
    sockets,
    meta: {
      look,
      hd: true,
      height: topY * U,
      skullTop: (SKULL_TOP + 0.5) * U,
      hatTop: topY * U,
      radius: 0.32,
      hipY: J.hip[1] * U,
      kneeY: J.knee[1] * U,
      shoulderY: J.shoulder[1] * U,
      elbowY: J.elbow[1] * U,
      handY: J.hand[1] * U,
      upperArmLen: (J.shoulder[1] - J.elbow[1]) * U,
      foreArmLen: (J.elbow[1] - J.hand[1]) * U,
      legLen: J.hip[1] * U,
      facePivots: { eye_l: mm(J.eye), eye_r: mm(mg(J.eye)), brow_l: mm(J.brow), brow_r: mm(mg(J.brow)), jaw: mm(J.jaw) },
      // modelled eyeballs with glowing Serket-green pupils (no 2D overlay)
      eyeColor: EYE.core,
      eyes: 'voxel',
      expressions,
      cloth: {
        coat: clothCoat ? [LK.coat.base, LK.coat.shade, LK.trim.base] : undefined,
        coatStyle: poncho ? 'poncho' : clothCoat ? 'tails' : undefined,
        coatLen: o === 'sheriff' ? 0.56 : o === 'duster' ? 0.5 : poncho ? 0.3 : 0,
        coatWidth: poncho ? 0.6 : 0.5,
        bandana: mask ? [mask.R.base, mask.R.shade] : o !== 'sheriff' && o !== 'pharaoh' ? [LK.band.base, LK.band.shade] : undefined,
        bandanaLen: mask ? 0.2 : 0.16,
      },
    },
  };
}

// ================================================================== BOARD ON THE BACK
export const BOARD_BACK_SOCKET = 'board_back';
export interface BoardBackOpts {
  /** material for a {model, voxelSize} or BufferGeometry board (default: the rig's material) */
  material?: THREE.Material;
  /** sideways tilt across the back in radians (default 0.36: nose up over his right shoulder, clear of Pinch) */
  tilt?: number;
  /** how far the board centre hangs below the socket, metres (default 0.17) */
  drop?: number;
}
/**
 * Mount a sandboard on Sundown's back, slung between the shoulder blades on the
 * `board_back` socket: deck art facing out, nose up over his right shoulder.
 * `board` may be a sandboardModel() result ({ model, voxelSize }), a BufferGeometry
 * (e.g. player.boardMesh.geometry) or any Object3D (used as-is, not cloned).
 * Returns the holder group (toggle `.visible`, or `.removeFromParent()`), or null when
 * the rig has no `board_back` socket.
 */
export function attachBoardOnBack(rig: RigInstance, board: { model: VoxelModel; voxelSize: number } | THREE.BufferGeometry | THREE.Object3D, opts: BoardBackOpts = {}): THREE.Group | null {
  const sockG = rig.sockets[BOARD_BACK_SOCKET];
  if (!sockG) return null;
  const mat = opts.material ?? (rig.material as unknown as THREE.Material);
  let obj: THREE.Object3D;
  if (board instanceof THREE.Object3D) obj = board;
  else if (board instanceof THREE.BufferGeometry) {
    const mesh = new THREE.Mesh(board, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    obj = mesh;
  } else obj = voxelMesh(board.model, board.voxelSize, 'center', mat);
  // measure the board in its own frame
  obj.removeFromParent();
  obj.position.set(0, 0, 0);
  obj.rotation.set(0, 0, 0);
  obj.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(obj);
  const holder = new THREE.Group();
  holder.name = 'board_back';
  holder.rotation.z = opts.tilt ?? 0.36;
  const inner = new THREE.Group();
  inner.rotation.x = -Math.PI / 2; // board +Z (nose) -> up, deck +Y -> away from his back
  holder.add(inner);
  // base flat against the sling, centre hanging `drop` below the socket
  obj.position.set(-(box.min.x + box.max.x) / 2, -box.min.y + 0.004, -(box.min.z + box.max.z) / 2 - (opts.drop ?? 0.17));
  inner.add(obj);
  sockG.add(holder);
  return holder;
}
