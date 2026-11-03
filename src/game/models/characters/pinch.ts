// Pinch — Sundown's buddy: a small, poisonous, spiky scorpion (Serket's messenger).
// HD build at 1/72 m, sculpted in "p-units" (1/48 m, the legacy Pinch grid) by the
// sculpt kit, so every pivot / socket sits where it always did.
// Look: dark glossy chitin with toxic-green and amber warning bands, armoured
// shingled plates with lateral spines, a spiny tail with a swollen glowing venom
// bulb and a dripping stinger, spiny claws with serrated fingers, jointed legs, and
// big modelled glossy eyes on the carapace (lids for expressions — no 2D eyes).
// Scorpion convention: body (root), tail1..tail5, stinger, arm_l/arm_r, pincer_l/pincer_r,
// leg_l1..leg_l4, leg_r1..leg_r4, eye_l/eye_r.
import { VoxelModel, VF } from '../../../engine/voxel/VoxelModel';
import type { RigSpec, PartSpec, V3 } from '../../../engine/voxel/Rig';
import type { Ramp } from '../style';
import { Sc, lerp, vadd, vsub, vmul, vdot, vnorm, shadeRamps, mirrorModel } from './sculpt';

export const PINCH_EXPRESSIONS = ['neutral', 'happy', 'angry', 'sleepy', 'surprised', 'determined'] as const;
const K = 1.5; // voxels per p-unit
const VS = 1 / 72;
const ramp = (base: number, shade: number, hi: number, dark: number): Ramp => ({ base, shade, hi, dark });

const CH = ramp(0x252b1d, 0x171b12, 0x404a33, 0x0c0e09); // dark chitin
const TOX = ramp(0x8ee02a, 0x5fa81c, 0xc8ff5a, 0x3a6a10); // toxic green
const AMB = ramp(0xf2a21c, 0xc47812, 0xffd060, 0x7a4a0a); // warning amber
const BEL = ramp(0xb8893e, 0x94692a, 0xd6aa58, 0x5e3f16); // belly plates
const VEN = { core: 0xb4ff52, mid: 0x7fe02a, vein: 0x2f7a12, drop: 0xd2ff8a };
const EYE = { ball: 0x0b0d09, glint: 0xf6ffe8, rim: 0x5fa81c };
const M = VF.METAL;
const sc = (name: string) => new Sc(name, K);
const vxp = (p: V3): V3 => [p[0] * K, p[1] * K, p[2] * K];

/** short chitin spine: amber tip on a dark base */
function thorn(m: Sc, base: V3, dir: V3, L: number, r0: number) {
  const d = vnorm(dir);
  const b = vadd(base, vmul(d, L));
  m.cap(vsub(base, vmul(d, 0.25)), b, r0, 0.05, (x, y, z) => (vdot(vsub([x, y, z], base), d) / L > 0.5 ? AMB.hi : AMB.shade), { flags: M });
}

// ================================================================== BODY (carapace + shingled abdomen)
const PLATES = 7;
const plateZ = (i: number) => 0.55 - i * 1.15;
const plateRX = (i: number) => 3.2 - Math.max(0, i - 3) * 0.28;
function body() {
  const m = sc('body');
  // carapace (prosoma): a domed armoured shield, toxic median band, amber rim
  m.ell([0, 3.75, 4.05], [3.3, 2.1, 3.3], (x, y, z) => {
    const ax = Math.abs(x);
    if (ax < 0.75 && y > 4.6) return TOX.base;
    if (y < 3.1) return AMB.shade;
    return CH.base;
  }, { p: 2.3 });
  m.ell([0, 4.4, 7.35], [0.8, 0.65, 0.6], 0, { mode: 'carve' }); // front notch
  m.cap([0, 5.85, 6.0], [0, 5.9, 1.6], 0.42, 0.42, CH.hi); // median keel
  for (const s of [1, -1]) {
    for (const [x, y, z] of [[1.9, 5.25, 2.4], [2.5, 4.85, 4.4], [1.7, 5.45, 4.0], [2.85, 4.2, 2.0]] as V3[]) m.ell([s * x, y, z], [0.36, 0.36, 0.36], AMB.base); // granules
    for (const [dx, dz] of [[0, 0], [0.45, -0.35], [-0.1, -0.6]] as [number, number][]) m.ell([s * (2.55 + dx), 4.55, 6.15 + dz], [0.26, 0.26, 0.26], EYE.ball, { flags: M }); // lateral eyes
    m.ell([s * 1.3, 5.0, 6.0], [1.25, 0.75, 1.1], CH.shade); // ocular mound
    m.cap([s * 0.7, 2.65, 7.1], [s * 0.55, 2.2, 8.15], 0.42, 0.25, AMB.base); // chelicerae
  }
  // abdomen: overlapping tergite plates, each lifted at the back like shingles
  for (let i = 0; i < PLATES; i++) {
    const z = plateZ(i), rx = plateRX(i);
    m.ell([0, 3.45 - i * 0.07, z], [rx, 2.05, 0.92], (x, y) => {
      const ax = Math.abs(x);
      if (ax < 0.7 && y > 4.6) return TOX.base;
      if (ax > rx - 0.75 && y > 3.6) return AMB.base;
      return CH.base;
    }, { p: 2.6 });
    m.region([-rx, 4.2, z - 1.0], [rx, 5.6, z - 0.75], (x, y, zz) => Math.abs(x) < rx - 0.5 && y > 4.4, CH.dark, { mode: 'paint' }); // plate seam
    for (const s of [1, -1]) thorn(m, [s * (rx - 0.25), 3.75, z - 0.3], [s, 0.3, -0.55], 1.25, 0.46); // lateral spines
    if (i % 2 === 0 && i > 0) for (const s of [1, -1]) thorn(m, [s * 0.95, 5.2, z - 0.2], [s * 0.2, 1, -0.6], 1.0, 0.38); // dorsal spines
  }
  // belly sternites
  m.region([-2.6, 1.15, -7.5], [2.6, 1.75, 6.5], (x, y, z) => Math.abs(x) < 2.4 - Math.max(0, -z - 4) * 0.2, (x, y, z) => ((Math.floor(z * K) & 3) === 0 ? BEL.shade : BEL.base));
  shadeRamps(m.m, [CH, TOX, AMB, BEL], true);
  return m.m;
}

// ================================================================== TAIL
const TP: V3[] = [[0, 3.5, -7.5], [0, 6.0, -9.5], [0, 10.0, -9.5], [0, 12.5, -7.5], [0, 13.0, -4.5], [0, 13.0, -1.5]];
const TR = [1.8, 1.62, 1.48, 1.38, 1.3];
const CURL: V3 = [0, 8.4, -5.6];
function tailSeg(i: number) {
  const m = sc('tail' + (i + 1));
  const a = TP[i], b = TP[i + 1];
  const ab = vsub(b, a), L = Math.hypot(ab[1], ab[2]);
  m.ovoid(a, b, TR[i], TR[i] * 0.9, (x, y, z) => {
    const t = vdot(vsub([x, y, z], a), ab) / (L * L);
    if (t > 0.78) return TOX.base; // warning ring at the joint
    if (Math.abs(x) < 0.45) return CH.hi; // dorsal/ventral keel
    return CH.base;
  }, { over: 0.2 });
  // paired dorsal spines on the outside of the curl
  const mid = vmul(vadd(a, b), 0.5);
  const out = vnorm([0, mid[1] - CURL[1], mid[2] - CURL[2]]);
  for (const s of [1, -1])
    for (const t of i < 2 ? [0.3, 0.68] : [0.5]) {
      const p = vadd(vadd(a, vmul(ab, t)), vmul(out, TR[i] * 0.86));
      thorn(m, [s * 0.75, p[1], p[2]], [s * 0.3, out[1], out[2]], 1.5 - i * 0.1, 0.46);
    }
  // lateral granule rows
  for (const s of [1, -1]) m.ell(vadd(vmul(vadd(a, b), 0.5), [s * TR[i] * 0.92, 0, 0]), [0.3, 0.3, 0.3], AMB.base);
  shadeRamps(m.m, [CH, TOX], true);
  return m.m;
}

function stinger() {
  const m = sc('stinger');
  // chitin cap where the bulb meets tail5
  m.ell([0, 13.0, -1.2], [1.25, 1.2, 0.7], CH.base);
  // the swollen venom vesicle: glowing toxic green with dark veins
  const c: V3 = [0, 12.55, 0.35];
  m.ell(c, [1.85, 1.75, 2.1], (x, y, z) => {
    const a = Math.atan2(x, y - c[1]);
    const vein = Math.abs(Math.sin(a * 3 + z * 1.4)) < 0.16;
    if (vein) return VEN.vein;
    return y > c[1] + 0.9 && x < 0.2 ? VEN.drop : VEN.mid;
  }, { flags: VF.EMISSIVE });
  m.ell([-0.55, 13.6, 0.9], [0.45, 0.4, 0.45], VEN.core, { flags: VF.GLOW }); // hot highlight
  // the aculeus: a curved dark barb, amber at the point
  const barb: V3[] = [[0, 11.4, 1.8], [0, 10.75, 2.75], [0, 10.0, 3.25], [0, 9.55, 3.35]];
  for (let k = 1; k < barb.length; k++) m.cap(barb[k - 1], barb[k], lerp(0.62, 0.12, (k - 1) / 3), lerp(0.62, 0.12, k / 3), k === barb.length - 1 ? AMB.base : CH.base);
  // venom welling at the tip and a drop falling
  m.ell([0, 9.15, 3.4], [0.42, 0.48, 0.42], VEN.core, { flags: VF.GLOW });
  m.ell([0, 8.05, 3.45], [0.3, 0.38, 0.3], VEN.drop, { flags: VF.GLOW });
  m.ell([0, 7.3, 3.45], [0.18, 0.18, 0.18], VEN.core, { flags: VF.GLOW });
  shadeRamps(m.m, [CH], true);
  return m.m;
}

// ================================================================== CLAWS
const ARM_J: V3 = [3.0, 2.6, 6.4];
const PIN_J: V3 = [4.25, 3.4, 14.9];
function armL() {
  const m = sc('arm_l');
  m.cap([2.9, 2.6, 6.4], [4.6, 3.0, 8.5], 0.85, 0.8, CH.base); // femur
  m.ell([4.6, 3.0, 8.5], [0.85, 0.85, 0.85], AMB.base); // joint
  m.cap([4.6, 3.0, 8.5], [5.0, 3.3, 10.6], 0.9, 1.05, CH.base); // patella
  m.ell([5.0, 3.3, 10.6], [0.98, 0.98, 0.98], TOX.base); // joint ring
  for (const [p, d] of [[[4.0, 3.6, 7.6], [0.5, 1, -0.2]], [[4.95, 3.85, 9.6], [0.3, 1, 0.1]], [[5.7, 3.1, 9.9], [1, 0.3, 0]]] as [V3, V3][]) thorn(m, p, d, 0.9, 0.32);
  // the swollen chela with amber keels and green granules
  m.ell([5.1, 3.4, 12.85], [2.3, 1.95, 2.6], (x, y, z) => {
    if (Math.abs(y - 4.85) < 0.34 && Math.abs(x - 5.1) < 1.2) return AMB.base;
    if (Math.abs(x - 7.05) < 0.34 && y > 2.9) return AMB.shade;
    return CH.base;
  }, { p: 2.2 });
  for (const [x, y, z] of [[4.1, 4.8, 11.7], [6.0, 4.75, 12.3], [6.85, 4.0, 13.6], [4.6, 5.0, 13.5], [5.4, 5.1, 11.2]] as V3[]) m.ell([x, y, z], [0.34, 0.34, 0.34], TOX.base);
  for (const [p, d, L] of [[[5.3, 5.25, 12.1], [0.15, 1, 0.1], 1.5], [[7.3, 3.7, 12.0], [1, 0.35, -0.1], 1.35], [[6.8, 4.5, 14.0], [0.8, 0.6, 0.5], 1.15], [[4.0, 5.0, 13.9], [-0.3, 1, 0.4], 1.0], [[6.2, 4.9, 10.9], [0.6, 0.8, -0.3], 1.0]] as [V3, V3, number][]) thorn(m, p, d, L, 0.44);
  // fixed finger (outer), serrated inner edge
  const ff: V3[] = [[6.2, 3.4, 14.6], [6.45, 3.4, 16.95], [5.55, 3.4, 19.25]];
  for (let k = 1; k < ff.length; k++) m.cap(ff[k - 1], ff[k], lerp(1.0, 0.15, (k - 1) / 2), lerp(1.0, 0.15, k / 2), k === 2 ? AMB.base : CH.base);
  for (const z of [15.5, 16.5, 17.5]) m.ell([5.45, 3.4, z], [0.26, 0.34, 0.26], AMB.hi);
  shadeRamps(m.m, [CH, TOX, AMB], true);
  return m.m;
}
function pincerL() {
  const m = sc('pincer_l');
  const mf: V3[] = [[4.25, 3.4, 14.9], [4.0, 3.4, 17.05], [4.9, 3.4, 19.3]];
  for (let k = 1; k < mf.length; k++) m.cap(mf[k - 1], mf[k], lerp(0.92, 0.14, (k - 1) / 2), lerp(0.92, 0.14, k / 2), k === 2 ? AMB.base : CH.base);
  for (const z of [15.8, 16.8, 17.8]) m.ell([4.95, 3.4, z], [0.26, 0.34, 0.26], AMB.hi);
  shadeRamps(m.m, [CH], true);
  return m.m;
}

// ================================================================== LEGS
const LEG_Z = [5.2, 3.6, 2.0, 0.4];
function legL(i: number) {
  const m = sc('leg_l' + (i + 1));
  const z = LEG_Z[i], dz = (i - 1.5) * 1.25;
  const P: V3[] = [[2.6, 2.6, z], [5.0, 4.7, z + dz * 0.4], [6.8, 1.7, z + dz * 0.8], [7.5, 0.05, z + dz]];
  const R = [0.52, 0.44, 0.32, 0.16];
  for (let k = 1; k < P.length; k++) m.cap(P[k - 1], P[k], R[k - 1], R[k], CH.base);
  m.ell(P[1], [0.5, 0.5, 0.5], AMB.base); // knee
  m.ell(P[2], [0.36, 0.36, 0.36], TOX.base); // ankle
  thorn(m, vadd(P[1], [0, 0.35, 0]), [0.35, 1, -0.1], 0.65, 0.24);
  shadeRamps(m.m, [CH], false);
  return m.m;
}

// ================================================================== EYES (+ lid poses for expressions)
type Lid = 'open' | 'wide' | 'sleepy' | 'angry' | 'happy';
const EYE_C: V3 = [1.3, 5.5, 6.25];
function eyeL(lid: Lid) {
  const m = sc('eye_l');
  const R = lid === 'wide' ? 1.5 : 1.3;
  const c = EYE_C;
  m.ell(c, [R, R, R * 0.95], (x, y, z) => {
    const ny = (y - c[1]) / R, nx = (x - c[0]) / R, nz = (z - c[2]) / R;
    let lidded = false;
    if (lid === 'sleepy') lidded = ny > -0.1;
    if (lid === 'angry') lidded = ny > 0.25 - nx * 0.55; // inner corner lower
    if (lid === 'happy') lidded = ny < -0.15;
    if (lidded) return Math.abs(ny - (lid === 'happy' ? -0.15 : lid === 'sleepy' ? -0.1 : 0.25 - nx * 0.55)) < 0.3 ? AMB.base : CH.base;
    if (nz > 0.45 && nx < -0.05 && ny > 0.25 && ny < 0.75) return EYE.glint;
    return EYE.ball;
  }, { flags: M });
  // a thin green rim where the eye sits in its mound
  m.region(vsub(c, [R + 0.4, R + 0.4, R + 0.4]), vadd(c, [R + 0.4, R + 0.4, R + 0.4]), (x, y, z) => {
    const d = Math.hypot(x - c[0], y - c[1], z - c[2]);
    return d > R && d < R + 0.38 && z < c[2] - 0.15 && y < c[1] + 0.2;
  }, EYE.rim, { mode: 'under' });
  return m.m;
}

export function pinchRig(): RigSpec {
  const J = (name: string, model: VoxelModel, joint: V3, parent?: string): PartSpec => ({ name, model, pivot: vxp(joint), attach: vxp(joint), parent });
  const mir = (p: V3): V3 => [-p[0], p[1], p[2]];
  const parts: PartSpec[] = [J('body', body(), [0, 3, 0.5])];
  const parents = ['body', 'tail1', 'tail2', 'tail3', 'tail4'];
  for (let i = 0; i < 5; i++) parts.push(J('tail' + (i + 1), tailSeg(i), TP[i], parents[i]));
  parts.push(J('stinger', stinger(), TP[5], 'tail5'));
  const arm = armL(), pin = pincerL();
  parts.push(J('arm_l', arm, ARM_J, 'body'), J('arm_r', mirrorModel(arm, 'arm_r'), mir(ARM_J), 'body'));
  parts.push(J('pincer_l', pin, PIN_J, 'arm_l'), J('pincer_r', mirrorModel(pin, 'pincer_r'), mir(PIN_J), 'arm_r'));
  for (let i = 0; i < 4; i++) {
    const leg = legL(i);
    const j: V3 = [2.9, 3.0, LEG_Z[i]];
    parts.push(J(`leg_l${i + 1}`, leg, j, 'body'), J(`leg_r${i + 1}`, mirrorModel(leg, `leg_r${i + 1}`), mir(j), 'body'));
  }
  const eyeJ: V3 = EYE_C;
  const eye = (lid: Lid) => {
    const l = eyeL(lid);
    return { eye_l: l, eye_r: mirrorModel(l, 'eye_r') };
  };
  const open = eye('open');
  parts.push(J('eye_l', open.eye_l, eyeJ, 'body'), J('eye_r', open.eye_r, mir(eyeJ), 'body'));
  const LIDS: Record<string, Lid> = { neutral: 'open', happy: 'happy', angry: 'angry', sleepy: 'sleepy', surprised: 'wide', determined: 'angry' };
  const expressions: Record<string, { parts?: Record<string, VoxelModel> }> = {};
  const cache = new Map<Lid, Record<string, VoxelModel>>();
  for (const e of PINCH_EXPRESSIONS) {
    const lid = LIDS[e];
    if (lid === 'open') {
      expressions[e] = {};
      continue;
    }
    let p = cache.get(lid);
    if (!p) cache.set(lid, (p = eye(lid)));
    expressions[e] = { parts: p };
  }
  return {
    name: 'pinch',
    voxelSize: VS,
    parts,
    sockets: {
      stinger_tip: { part: 'stinger', at: vxp([0, 9.2, 3.45]) },
      pincer_l_tip: { part: 'arm_l', at: vxp([5.25, 3.4, 19.55]) },
      pincer_r_tip: { part: 'arm_r', at: vxp(mir([5.25, 3.4, 19.55])) },
      back: { part: 'body', at: vxp([0, 6.0, -2]) },
      head_top: { part: 'body', at: vxp([0, 6.4, 4.5]) },
    },
    meta: { length: 31 / 48, height: 15 / 48, radius: 0.1, expressions, faceParts: ['eye_l', 'eye_r'], eyes: 'voxel' },
  };
}
export const PINCH_VS = VS;
