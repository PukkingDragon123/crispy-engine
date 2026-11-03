// Sundown's long guns, sculpted in HD (1/128 m voxels, designed in centimetres):
//
//  - the COACH GUN: a side-by-side, external-hammer double barrel. Case-hardened
//    side-lock action with gold scroll inlay, rabbit-ear hammers, a top lever,
//    twin triggers in a scrolled guard, a checkered walnut wrist and a splinter
//    forend that breaks open with the barrels. Barrel options: coach / sawn-off /
//    long; screw-in chokes; a leather shell holder on the stock; a laser module.
//  - the TOMMY GUN: a 1928 Thompson. Milled receiver with the top cocking knob,
//    Lyman ladder sight, finned barrel, a grooved vertical foregrip, the deep
//    walnut stock and the 50-round L drum (or the 100-round C drum) with its
//    winding key. Muzzle options: none / Cutts compensator / suppressor; a
//    brass-tube scope; a laser module.
//
// Rig convention (same as the revolver): the gun points along +Z, top is +Y,
// the root part `frame` pivots at the grip (where the fist closes). Sockets:
// `muzzle` (+ `muzzle_l` / `muzzle_r` on the coach gun), `grip_l` (support hand),
// `ejector`, `laser` (when fitted), tommy `drum_l` / `bolt_knob`.
import { VoxelModel, VF, mulRGB, mix } from '../../../engine/voxel/VoxelModel';
import type { RigSpec, PartSpec, V3, SocketSpec } from '../../../engine/voxel/Rig';
import { Sc, clamp } from './sculpt';
import { noise } from '../../../engine/math/rand';

export const LONG_VS = 1 / 128;
/** voxels per design centimetre */
const K = 1.28;
const M = VF.METAL;
const PI = Math.PI;

// ------------------------------------------------------------------ materials
const BLUE = { base: 0x3a404c, shade: 0x262a32, hi: 0x6c7686, dark: 0x121419 };
const PARK = { base: 0x4c5052, shade: 0x34373a, hi: 0x787e84, dark: 0x1c1d1f };
const BRASS = { base: 0xc89a3a, shade: 0x9a7024, hi: 0xf0cc6a, dark: 0x5e4214 };
const GOLD = 0xe8c060;
const WALNUT = { base: 0x7c4724, grain: 0x5c3016, hi: 0x9c5f34, dark: 0x351a0a };
const LEATHER = { base: 0x8a5a2c, shade: 0x66401c, hi: 0xa8743c, stitch: 0xe6cf9f };
const SHELL_RED = 0xb8382a;
const LENS = 0x9fd6e8;
const LASER_RED = 0xff2a1a;

/** case-hardened steel: smooth blotches of straw, blue and plum (low frequency, never grainy) */
const caseCol = (x: number, y: number, z: number) => {
  const n = noise.n3(x * 0.24 + 3.1, y * 0.24, z * 0.24) * 0.5 + 0.5;
  const m = noise.n3(x * 0.11 - 7, y * 0.11 + 2, z * 0.11) * 0.5 + 0.5;
  const a = n < 0.33 ? 0x5a6480 : n < 0.55 ? 0x7a6c5e : n < 0.75 ? 0x6a5c78 : 0x8e8678;
  return mix(a, 0x9a8058, m > 0.7 ? 0.35 : 0);
};
/** walnut with flowing grain lines along the stock */
const walnut = (dark = 0) => (x: number, y: number, z: number) => {
  const g = Math.sin(y * 1.45 + Math.sin(z * 0.19 + x * 0.35) * 1.6 + z * 0.045);
  const c = g > 0.72 ? WALNUT.grain : g < -0.86 ? WALNUT.hi : WALNUT.base;
  return dark ? mulRGB(c, 1 - dark) : c;
};

/** hand relief: exposed tops catch light, undersides sink, the barrels get a top streak */
function relief(m: VoxelModel, up = 1.12, down = 0.8) {
  const todo: [number, number, number, number, number][] = [];
  m.forEach((x, y, z, c, f) => {
    if (!m.has(x, y + 1, z)) todo.push([x, y, z, mulRGB(c, up), f]);
    else if (!m.has(x, y - 1, z)) todo.push([x, y, z, mulRGB(c, down), f]);
  });
  for (const [x, y, z, c, f] of todo) m.set(x, y, z, c, f);
  return m;
}

const v3 = (p: V3): V3 => [p[0] * K, p[1] * K, p[2] * K];
const sock = (part: string, at: V3): SocketSpec => ({ part, at: v3(at) });

/** a thin ring band around a Z-axis tube */
function bandZ(s: Sc, cx: number, cy: number, z0: number, z1: number, r: number, col: number, flags = M) {
  s.region([cx - r, cy - r, z0], [cx + r, cy + r, z1], (x, y) => Math.hypot(x - cx, y - cy) <= r, col, { flags });
}

// =============================================================================== COACH GUN
export interface ShotgunAtt {
  barrel: 'coach' | 'sawnoff' | 'long';
  choke: boolean;
  holder: boolean;
  laser: boolean;
}
export const SHOTGUN_DEFAULT: ShotgunAtt = { barrel: 'coach', choke: false, holder: false, laser: false };

/** grip centre (the fist), design cm; bore axis is y = 0 */
const SG_GRIP: V3 = [0, -6.0, -12.5];
const SG_HINGE: V3 = [0, -4.4, 3.4];
const SG_BX = 2.2;
const SG_R = 2.2;

function shotgunFrame(a: ShotgunAtt) {
  const s = new Sc('frame', K);
  const short = a.barrel === 'sawnoff';
  // ---- receiver: the case-hardened action body (breech face at z = 0)
  s.rbox([0, -1.8, -4.0], [3.2, 4.4, 4.0], 1.2, caseCol, { flags: M });
  // fences: the rounded shoulders the barrels seat against
  for (const sx of [-1, 1]) s.ell([sx * SG_BX, 0, -0.5], [2.45, 2.5, 1.3], caseCol, { flags: M });
  // action bar (water table) running forward under the breech, the hinge knuckle at its front
  s.rbox([0, -4.9, 1.2], [2.85, 1.3, 2.6], 0.7, caseCol, { flags: M });
  s.cap([-2.9, -4.4, 3.4], [2.9, -4.4, 3.4], 1.15, 1.15, BLUE.shade, { flags: M });
  // side locks: tear-drop plates over the wrist, gold scroll inlay
  for (const sx of [-1, 1]) {
    const x0 = sx * 3.0;
    s.region([Math.min(x0, x0 + sx * 0.9), -6.5, -14.5], [Math.max(x0, x0 + sx * 0.9), 2.2, -2.5], (x, y, z) => {
      const u = (z + 7.5) / 6.8, v = (y + 2.2) / (3.6 - Math.max(0, -z - 7.5) * 0.28);
      return u * u + v * v <= 1;
    }, (x, y, z) => {
      // scroll engraving: a spiral of gold on the plate face
      const dz = z + 7.2, dy = y + 2.4, r = Math.hypot(dz, dy), th = Math.atan2(dy, dz);
      const scroll = Math.abs(Math.sin(r * 2.1 - th * 1.0)) < 0.13 && r < 3.4 && Math.abs(x) > 3.3;
      return scroll ? GOLD : caseCol(x, y, z);
    }, { flags: M });
  }
  // top strap + tang running back over the wrist
  s.path([[0, 2.4, -1.5], [0, 2.3, -6], [0, 0.6, -11.5]], (t) => 1.0 - t * 0.3, BLUE.base, { flags: M });
  // safety slide on the tang
  s.rbox([0, 2.6, -9.2], [0.6, 0.45, 0.9], 0.2, GOLD, { flags: M });
  // ---- wrist: an oval of walnut sloping down from the action, with a semi-pistol swell
  const wristTop = (z: number) => 1.6 + (z + 8) * 0.43; // z in [-19, -6]
  const wristBot = (z: number) => -6.4 + (z + 8) * 0.3 - 1.7 * Math.exp(-((z + 13.5) ** 2) / 7);
  s.region([-2.7, -12, -20], [2.7, 2.6, -5.5], (x, y, z) => {
    const top = wristTop(z), bot = wristBot(z);
    const cy = (top + bot) / 2, hy = (top - bot) / 2, hw = 2.3 + Math.max(0, -z - 15) * 0.06;
    return Math.pow(Math.abs(x) / hw, 2.4) + Math.pow(Math.abs(y - cy) / hy, 2.4) <= 1;
  }, (x, y, z) => {
    // diamond checkering where the hand closes
    const chk = z < -8.5 && z > -16.5 && Math.abs(x) > 1.4 && ((Math.round(y * 1.4 + z * 1.4) + Math.round(y * 1.4 - z * 1.4)) & 1) === 0;
    return chk ? WALNUT.dark : walnut()(x, y, z);
  });
  // ---- buttstock: lofted superellipse, comb dropping to the heel, toe sweeping down
  const z0 = short ? -32 : -44, zw = -18;
  s.region([-3.4, -17, z0 - 0.6], [3.4, 0, zw], (x, y, z) => {
    const t = clamp((zw - z) / (zw - z0), 0, 1);
    const top = -1.8 - 2.6 * t + 0.35 * Math.sin(t * PI);
    const bot = -8.6 - 6.2 * Math.pow(t, 1.1);
    const hw = 2.35 + 0.6 * t;
    const cy = (top + bot) / 2, hy = (top - bot) / 2;
    return Math.pow(Math.abs(x) / hw, 2.6) + Math.pow(Math.abs(y - cy) / hy, 2.6) <= 1;
  }, walnut());
  // butt plate: blued steel with two screws
  s.region([-3.4, -17, z0 - 0.9], [3.4, 0, z0 + 0.2], (x, y, z) => {
    const top = -1.8 - 2.6 + 0.35 * Math.sin(PI), bot = -8.6 - 6.2;
    const cy = (top + bot) / 2, hy = (top - bot) / 2 + 0.2, hw = 2.95 + 0.15;
    return z < z0 - 0.1 && Math.pow(Math.abs(x) / hw, 2.6) + Math.pow(Math.abs(y - cy) / hy, 2.6) <= 1;
  }, BLUE.shade, { flags: M });
  for (const y of [-6.4, -12.4]) s.ell([0, y, z0 - 0.95], [0.45, 0.45, 0.3], BRASS.hi, { flags: M });
  // ---- trigger guard: a scrolled bow with a long trailing tang
  s.path([[0, -6.1, -1.6], [0, -8.4, -2.4], [0, -9.6, -4.6], [0, -9.3, -7.4], [0, -7.6, -9.3], [0, -7.2, -12], [0, -7.9, -15.4]], (t) => (t < 0.7 ? 0.5 : 0.45), BLUE.base, { flags: M });
  s.ell([0, -8.0, -15.6], [0.6, 0.5, 0.9], BLUE.base, { flags: M }); // tang finial
  // twin triggers
  s.cap([0, -6.0, -3.6], [0, -8.3, -4.5], 0.34, 0.3, GOLD, { flags: M });
  s.cap([0, -6.0, -5.6], [0, -8.0, -6.6], 0.34, 0.3, GOLD, { flags: M });
  // sling swivel under the stock
  if (!short) {
    s.region([-0.4, -16.5, -38], [0.4, -13.6, -35], (x, y, z) => {
      const r = Math.hypot(y + 15.2, z + 36.5);
      return r <= 1.3 && r >= 0.7;
    }, BLUE.hi, { flags: M });
  }
  // ---- leather shell holder on the right flank of the stock (four spare shells)
  if (a.holder) {
    const zc = short ? -24 : -30;
    s.rbox([-3.1, -8.4, zc], [0.55, 3.3, 5.4], 0.4, LEATHER.base);
    for (let i = 0; i < 4; i++) {
      const z = zc - 3.9 + i * 2.6;
      s.cap([-3.55, -11.2, z], [-3.55, -6.3, z], 0.95, 0.95, (x, y) => (y > -9.6 && y < -7.4 ? LEATHER.shade : SHELL_RED));
      s.ell([-3.55, -5.7, z], [1.0, 0.55, 1.0], BRASS.base, { flags: M });
    }
    s.region([-3.8, -11.8, zc - 5.5], [-3.6, -5, zc + 5.5], (x, y, z) => Math.abs(y + 11.4) < 0.18 && Math.round(z * 2) % 2 === 0, LEATHER.stitch, { mode: 'paint' });
  }
  relief(s.m, 1.1, 0.82);
  return s.m;
}

function shotgunBarrels(a: ShotgunAtt) {
  const s = new Sc('barrels', K);
  const ZM = a.barrel === 'sawnoff' ? 28 : a.barrel === 'long' ? 66 : 48;
  // two tubes, a touch thicker at the breech, a top rib and the brass bead
  for (const sx of [-1, 1]) s.cap([sx * SG_BX, 0, 0.2], [sx * SG_BX, 0, ZM], SG_R + 0.12, SG_R - 0.18, BLUE.base, { flags: M });
  s.region([-1.3, 0.8, 0.5], [1.3, 2.9, ZM - 0.4], (x, y) => Math.abs(x) <= 1.05 - (y - 1.6) * 0.35 && y <= 2.65, BLUE.shade, { flags: M });
  s.region([-0.5, 2.5, 0.5], [0.5, 2.9, ZM - 0.4], () => true, BLUE.hi, { flags: M }); // rib top flat
  s.ell([0, 3.25, ZM - 1.1], [0.45, 0.45, 0.45], BRASS.hi, { flags: M });
  // bottom rib between the tubes
  s.region([-0.9, -2.4, 0.6], [0.9, -0.8, ZM - 0.4], (x, y) => Math.abs(x) <= 0.9 && y < -1.0, BLUE.shade, { flags: M });
  // breech: the lumps that lock into the action bar, extractor edge
  s.rbox([0, -3.6, 1.6], [1.9, 1.3, 1.6], 0.5, BLUE.shade, { flags: M });
  s.region([-4.4, -2.3, 0.0], [4.4, 2.3, 0.6], (x, y) => Math.hypot(Math.abs(x) - SG_BX, y) <= SG_R + 0.1, BLUE.hi, { flags: M });
  // sawn-off: a hacked, file-bright cut and a hose-clamp band
  if (a.barrel === 'sawnoff') {
    for (const sx of [-1, 1]) bandZ(s, sx * SG_BX, 0, ZM - 0.6, ZM, SG_R - 0.05, 0x9aa2ae);
    s.region([-4.6, -2.6, ZM - 8.5], [4.6, 2.6, ZM - 7.4], (x, y) => Math.hypot(Math.abs(x) - SG_BX, y) <= SG_R + 0.35 && Math.abs(x) <= 4.5, 0x8a8f96, { flags: M });
  }
  if (a.barrel === 'long') {
    // a barrel band and a mid bead on the long tom
    s.region([-4.7, -2.6, 38], [4.7, 2.6, 39.2], (x, y) => Math.hypot(Math.abs(x) - SG_BX, y) <= SG_R + 0.4, BRASS.base, { flags: M });
    s.ell([0, 3.1, 34], [0.3, 0.3, 0.3], 0xe8e4dc, { flags: M });
  }
  // chokes: knurled brass collars screwed into each muzzle
  if (a.choke) {
    for (const sx of [-1, 1]) {
      s.region([sx * SG_BX - 2.6, -2.6, ZM - 2.2], [sx * SG_BX + 2.6, 2.6, ZM + 1.4], (x, y, z) => {
        const r = Math.hypot(x - sx * SG_BX, y);
        return r <= SG_R + 0.3 - (z > ZM + 0.6 ? 0.25 : 0);
      }, (x, y, z) => (Math.round(Math.atan2(y, x - sx * SG_BX) * 3) % 2 && z < ZM - 0.6 ? BRASS.shade : BRASS.base), { flags: M });
    }
  }
  const muzzleZ = ZM + (a.choke ? 1.4 : 0);
  // dark bores (walls only, a real hole you can see into)
  for (const sx of [-1, 1]) s.region([sx * SG_BX - 1.3, -1.3, muzzleZ - 5], [sx * SG_BX + 1.3, 1.3, muzzleZ + 0.5], (x, y) => Math.hypot(x - sx * SG_BX, y) <= 1.15, 0, { mode: 'carve' });
  s.walls([-5, -3, muzzleZ - 6], [5, 3, muzzleZ + 1], (x, y, z) => z > muzzleZ - 5.2 && (Math.hypot(x - SG_BX, y) <= 1.15 || Math.hypot(x + SG_BX, y) <= 1.15), BLUE.dark);
  // ---- splinter forend under the tubes (comes away with the barrels when it breaks)
  const fz0 = 2.8, fz1 = a.barrel === 'sawnoff' ? 15 : 19;
  s.region([-3.0, -6.2, fz0], [3.0, -1.4, fz1 + 1], (x, y, z) => {
    const t = (z - fz0) / (fz1 - fz0);
    const hw = 2.85 - Math.max(0, t - 0.75) * 2.2, bot = -5.5 + Math.max(0, t - 0.7) * 3.0;
    const cy = (bot - 1.6) / 2, hy = (-1.6 - bot) / 2;
    return t <= 1.05 && Math.pow(Math.abs(x) / Math.max(0.6, hw), 2.3) + Math.pow(Math.abs(y - cy) / Math.max(0.5, hy), 2.3) <= 1;
  }, (x, y, z) => {
    const chk = z > fz0 + 3.5 && z < fz1 - 3 && Math.abs(x) > 1.8 && ((Math.round(y * 1.4 + z * 1.4) + Math.round(y * 1.4 - z * 1.4)) & 1) === 0;
    return chk ? WALNUT.dark : walnut(0.05)(x, y, z);
  });
  s.rbox([0, -5.7, fz0 + 6.5], [0.8, 0.4, 1.4], 0.2, caseCol, { flags: M }); // forend latch iron
  // sling swivel up front
  if (a.barrel !== 'sawnoff') {
    s.region([-0.4, -4.6, ZM - 13], [0.4, -2.0, ZM - 10], (x, y, z) => {
      const r = Math.hypot(y + 3.3, z - ZM + 11.5);
      return r <= 1.2 && r >= 0.6;
    }, BLUE.hi, { flags: M });
  }
  // ---- laser module clamped under the tubes
  if (a.laser) {
    const lz = Math.min(ZM - 4, 24);
    s.rbox([0, -4.0, lz], [1.2, 1.2, 3.0], 0.4, BRASS.shade, { flags: M });
    s.rbox([0, -3.0, lz - 1.5], [1.5, 0.35, 0.6], 0.1, BLUE.shade, { flags: M });
    s.rbox([0, -3.0, lz + 1.5], [1.5, 0.35, 0.6], 0.1, BLUE.shade, { flags: M });
    s.ell([0, -4.0, lz + 3.1], [0.7, 0.7, 0.4], LASER_RED, { flags: VF.EMISSIVE | VF.GLOW });
  }
  relief(s.m, 1.16, 0.78);
  return { m: s.m, ZM: muzzleZ, laserZ: Math.min(ZM - 4, 24) + 3.4 };
}

function hammer(sx: number) {
  const s = new Sc(sx > 0 ? 'hammer_l' : 'hammer_r', K);
  const x = sx * 3.35;
  s.cap([x, -1.6, -6.6], [x, 1.6, -7.2], 0.7, 0.6, caseCol, { flags: M }); // body
  s.cap([x, 1.6, -7.2], [x + sx * 0.15, 3.0, -9.2], 0.62, 0.6, caseCol, { flags: M }); // spur sweeping back
  s.ell([x + sx * 0.25, 3.15, -9.8], [0.62, 0.55, 1.1], (xx, y, z) => ((Math.round(y * 3) + Math.round(z * 3)) & 1 ? 0x4e4e54 : 0x6a6a70), { flags: M }); // checkered thumb pad
  s.cap([x, 1.2, -6.9], [x * 0.7, 1.4, -5.2], 0.42, 0.38, BLUE.shade, { flags: M }); // nose to the striker
  s.ell([x, -1.5, -6.5], [0.75, 0.75, 0.75], BLUE.hi, { flags: M }); // tumbler pin
  return s.m;
}

function topLever() {
  const s = new Sc('lever', K);
  s.path([[0, 2.95, -6.4], [-0.6, 3.15, -9.0], [-1.6, 3.3, -11.0]], (t) => 0.55 - 0.1 * t, BLUE.base, { flags: M });
  s.ell([-1.8, 3.35, -11.6], [0.95, 0.5, 1.05], (x, y, z) => ((Math.round(x * 3) + Math.round(z * 3)) & 1 ? BLUE.hi : BLUE.base), { flags: M });
  return s.m;
}

/** the coach gun rig: `frame` (root, grip pivot), `barrels` (hinge), `hammer_l` / `hammer_r`, `lever` */
export function shotgunRig(a: ShotgunAtt = SHOTGUN_DEFAULT): RigSpec {
  const fr = shotgunFrame(a);
  const br = shotgunBarrels(a);
  const GRIP = v3(SG_GRIP);
  const HINGE = v3(SG_HINGE);
  const parts: PartSpec[] = [
    { name: 'frame', model: fr, pivot: GRIP, attach: [0, 0, 0] },
    { name: 'barrels', model: br.m, pivot: HINGE, attach: HINGE, parent: 'frame' },
    { name: 'hammer_l', model: hammer(1), pivot: v3([3.35, -1.5, -6.5]), attach: v3([3.35, -1.5, -6.5]), parent: 'frame' },
    { name: 'hammer_r', model: hammer(-1), pivot: v3([-3.35, -1.5, -6.5]), attach: v3([-3.35, -1.5, -6.5]), parent: 'frame' },
    { name: 'lever', model: topLever(), pivot: v3([0, 2.9, -6.4]), attach: v3([0, 2.9, -6.4]), parent: 'frame' },
  ];
  const sockets: Record<string, SocketSpec> = {
    muzzle: sock('barrels', [0, 0, br.ZM + 0.6]),
    muzzle_l: sock('barrels', [SG_BX, 0, br.ZM + 0.6]),
    muzzle_r: sock('barrels', [-SG_BX, 0, br.ZM + 0.6]),
    grip_l: sock('barrels', [0.9, -6.4, a.barrel === 'sawnoff' ? 9.5 : 11.5]),
    ejector: sock('barrels', [0, 0, 0.8]),
    butt: sock('frame', [0, -8.4, a.barrel === 'sawnoff' ? -32 : -44]),
  };
  if (a.laser) sockets.laser = sock('barrels', [0, -4.0, br.laserZ]);
  return {
    name: `shotgun_${a.barrel}_${a.choke ? 'c' : ''}${a.holder ? 'h' : ''}${a.laser ? 'l' : ''}`,
    voxelSize: LONG_VS,
    parts,
    sockets,
    meta: { muzzle: v3([0, 0, br.ZM + 0.6]), length: ((a.barrel === 'sawnoff' ? 32 : 44) + br.ZM) / 100, gunKind: 'shotgun', att: a, gripOffset: [0, 0, 0] },
  };
}

// =============================================================================== TOMMY GUN
export interface TommyAtt {
  drum: 'L50' | 'C100';
  muzzle: 'none' | 'cutts' | 'suppressor';
  scope: boolean;
  laser: boolean;
}
export const TOMMY_DEFAULT: TommyAtt = { drum: 'L50', muzzle: 'none', scope: false, laser: false };

const TM_GRIP: V3 = [0, -11.6, -7.3];
const TM_DRUM_C: V3 = [0, -11.6, 10];
const TM_BARREL_END = 44;

/** the Thompson drum (L: 50 rounds, C: 100), centred on its hub, face normal along X */
export function tommyDrum(big = false, name = 'drum') {
  const s = new Sc(name, K);
  const R = big ? 12.2 : 9.6, W = big ? 3.0 : 2.55;
  // body: slightly domed faces, a rolled rim band
  s.region([-W - 0.6, -R - 0.6, -R - 0.6], [W + 0.6, R + 0.6, R + 0.6], (x, y, z) => {
    const r = Math.hypot(y, z);
    const w = W - (r / R) ** 4 * 0.5;
    return r <= R && Math.abs(x) <= w;
  }, (x, y, z) => {
    const r = Math.hypot(y, z);
    if (Math.abs(r - R * 0.62) < 0.45 && Math.abs(x) > W - 0.8) return BLUE.shade; // pressed ring
    if (r > R - 0.9) return BLUE.hi; // rolled rim catches light
    return BLUE.base;
  }, { flags: M });
  s.region([-W - 0.2, -R - 0.4, -R - 0.4], [W + 0.2, R + 0.4, R + 0.4], (x, y, z) => {
    const r = Math.hypot(y, z);
    return r <= R + 0.35 && r > R - 0.35 && Math.abs(x) <= W - 0.6;
  }, BLUE.shade, { flags: M });
  // rivets round both faces
  const n = big ? 16 : 12;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * PI * 2, rr = R - 1.5;
    for (const sx of [-1, 1]) s.ell([sx * (W - 0.15), Math.sin(a) * rr, Math.cos(a) * rr], [0.4, 0.42, 0.42], BLUE.hi, { flags: M });
  }
  // the hub and the winding key on the left face (+X)
  s.cap([W - 0.3, 0, 0], [W + 0.9, 0, 0], 1.7, 1.5, BLUE.shade, { flags: M });
  s.rbox([W + 1.3, 0, 0], [0.45, 0.85, 3.6], 0.3, BLUE.hi, { flags: M });
  s.ell([W + 1.3, 0, 3.6], [0.55, 1.2, 0.9], BLUE.base, { flags: M });
  s.ell([W + 1.3, 0, -3.6], [0.55, 1.2, 0.9], BLUE.base, { flags: M });
  s.cap([-W + 0.3, 0, 0], [-W - 0.6, 0, 0], 1.4, 1.2, BLUE.shade, { flags: M }); // back hub
  // "L" / "C" stamping near the rim, the tongue that slides into the receiver
  for (const [y, z] of (big ? [[-R + 2.2, -1], [-R + 2.2, 0], [-R + 2.2, 1], [-R + 2.9, -1], [-R + 3.6, -1], [-R + 3.6, 0], [-R + 3.6, 1]] : [[-R + 2.2, -1], [-R + 2.2, 0], [-R + 2.2, 1], [-R + 2.9, -1], [-R + 3.6, -1]]) as [number, number][])
    s.ell([W + 0.05, y, z], [0.25, 0.32, 0.32], 0xd8d4c8, { mode: 'paint', flags: M });
  s.rbox([0, R - 0.2, 0], [1.5, 1.5, 3.0], 0.3, BLUE.shade, { flags: M });
  s.rbox([0, R + 1.0, 0], [1.1, 0.5, 2.6], 0.2, BLUE.hi, { flags: M });
  relief(s.m, 1.12, 0.8);
  return { m: s.m, R, W };
}

function tommyFrame(a: TommyAtt) {
  const s = new Sc('frame', K);
  // ---- upper receiver: milled steel, flat sides, rounded top
  s.region([-2.8, -3.6, -9.4], [2.8, 3.9, 14.3], (x, y, z) => {
    const top = 3.6, bot = -3.4;
    if (y < bot || y > top) return false;
    const hw = 2.65 - Math.max(0, y - 1.6) ** 2 * 0.28;
    const endTaper = z > 13 ? (z - 13) * 0.5 : z < -8.5 ? (-8.5 - z) * 0.6 : 0;
    return Math.abs(x) <= hw - endTaper && z >= -9.2 && z <= 14.1;
  }, BLUE.base, { flags: M });
  // the cocking-knob slot along the top
  s.region([-0.45, 2.2, 3.5], [0.45, 4.0, 12.5], () => true, 0, { mode: 'carve' });
  s.walls([-1.5, 1.5, 3], [1.5, 4, 13], (x, y, z) => Math.abs(x) <= 0.45 && y > 2.2 && z > 3.5 && z < 12.5, BLUE.dark);
  // ejection port on the right flank
  s.region([-3, -0.8, 3.0], [-2.1, 2.0, 8.4], () => true, 0, { mode: 'carve' });
  s.walls([-3.2, -1.2, 2.6], [-1.6, 2.4, 8.8], (x, y, z) => x < -2.1 && y > -0.8 && y < 2.0 && z > 3.0 && z < 8.4, BLUE.dark);
  s.rbox([-1.9, 0.6, 5.7], [0.3, 0.9, 2.2], 0.1, 0x9aa2ae, { flags: M }); // the bolt face showing through
  // Lyman ladder sight at the back
  for (const sx of [-1, 1]) s.rbox([sx * 1.0, 5.0, -6.6], [0.28, 1.6, 1.3], 0.15, BLUE.shade, { flags: M });
  s.rbox([0, 6.2, -6.6], [1.25, 0.35, 0.4], 0.1, BLUE.hi, { flags: M });
  s.rbox([0, 3.9, -6.6], [1.4, 0.5, 1.5], 0.2, BLUE.base, { flags: M });
  // receiver markings: a few stamped dots and the rear sight protector ears
  // ---- lower receiver / trigger frame
  s.rbox([0, -5.1, -2.6], [2.35, 1.9, 7.6], 0.7, BLUE.shade, { flags: M });
  // fire selector + safety paddles on the left flank
  for (const z of [-5.6, -1.0]) {
    s.cap([2.4, -4.4, z], [2.9, -4.4, z], 0.5, 0.5, BLUE.hi, { flags: M });
    s.rbox([3.0, -3.9, z - 0.5], [0.25, 0.9, 0.7], 0.15, BLUE.hi, { flags: M });
  }
  // magazine well lips (the drum slides in from the side)
  s.rbox([0, -4.0, 10.2], [2.5, 0.8, 3.6], 0.3, BLUE.shade, { flags: M });
  // ---- trigger guard + trigger
  s.path([[0, -6.6, 0.4], [0, -9.4, -0.3], [0, -10.0, -2.6], [0, -9.2, -4.6], [0, -6.8, -5.2]], () => 0.5, BLUE.base, { flags: M });
  s.cap([0, -6.6, -1.8], [0, -8.8, -2.5], 0.36, 0.3, BLUE.hi, { flags: M });
  // ---- pistol grip: smooth walnut, flared heel
  s.path([[0, -6.4, -5.8], [0, -10.6, -7.0], [0, -15.6, -8.6]], (t) => 2.05 + 0.25 * t, walnut());
  s.ell([0, -16.2, -8.9], [2.35, 1.2, 2.7], walnut(0.06));
  s.region([-2.4, -16, -11], [2.4, -6, -4.5], (x, y, z) => Math.abs(x) > 2.0 && Math.abs(z + 7.3 + (y + 11) * 0.3) < 0.4, BLUE.shade, { mode: 'paint' }); // grip screw ferrule line
  // ---- buttstock: the deep Thompson butt, concave underside, steel butt plate
  const z0 = -42, zw = -9.6;
  s.region([-3.0, -17.5, z0 - 0.6], [3.0, 3.2, zw], (x, y, z) => {
    const t = clamp((zw - z) / (zw - z0), 0, 1);
    const top = 2.6 - 3.1 * t;
    const bot = -6.6 - 9.6 * Math.pow(t, 0.72);
    const hw = 2.2 + 0.5 * t;
    const cy = (top + bot) / 2, hy = (top - bot) / 2;
    return Math.pow(Math.abs(x) / hw, 2.6) + Math.pow(Math.abs(y - cy) / hy, 2.6) <= 1;
  }, walnut());
  s.region([-2.9, -16.6, z0 - 1.0], [2.9, -0.2, z0 + 0.1], (x, y, z) => {
    const cy = (-0.5 - 16.2) / 2, hy = (16.2 - 0.5) / 2 + 0.3;
    return z < z0 - 0.1 && Math.pow(Math.abs(x) / 2.85, 2.6) + Math.pow(Math.abs(y - cy) / hy, 2.6) <= 1;
  }, BLUE.shade, { flags: M });
  s.rbox([0, -8.4, z0 - 1.05], [1.0, 2.0, 0.15], 0.1, BLUE.hi, { flags: M }); // trap door
  // stock mount plate where it slides onto the receiver
  s.rbox([0, -2.0, -10.2], [2.5, 3.0, 0.7], 0.3, BLUE.shade, { flags: M });
  // ---- finned barrel, then the plain barrel, front sight
  s.cap([0, 0, 14], [0, 0, TM_BARREL_END], 1.45, 1.3, BLUE.base, { flags: M });
  for (let z = 14.6; z < 27.5; z += 1.15) bandZ(s, 0, 0, z, z + 0.42, 2.35, BLUE.shade);
  bandZ(s, 0, 0, 13.6, 14.4, 2.6, BLUE.base);
  s.rbox([0, 1.9, TM_BARREL_END - 1.4], [0.25, 0.75, 0.9], 0.1, BLUE.hi, { flags: M });
  // the bore
  s.region([-0.7, -0.7, TM_BARREL_END - 3], [0.7, 0.7, TM_BARREL_END + 0.5], (x, y) => Math.hypot(x, y) <= 0.62, 0, { mode: 'carve' });
  s.walls([-2, -2, TM_BARREL_END - 4], [2, 2, TM_BARREL_END + 1], (x, y, z) => z > TM_BARREL_END - 3 && Math.hypot(x, y) <= 0.62, BLUE.dark);
  // ---- vertical foregrip with finger grooves, on its barrel clamp
  s.rbox([0, -1.9, 26.6], [1.3, 1.0, 1.9], 0.4, BLUE.shade, { flags: M });
  s.path([[0, -2.6, 27.2], [0, -8.5, 26.4], [0, -13.0, 26.0]], (t) => 2.0 + 0.2 * Math.sin(t * PI), walnut(0.04));
  s.ell([0, -13.4, 25.9], [2.2, 1.0, 2.2], walnut(0.08));
  for (const y of [-4.6, -6.8, -9.0, -11.2]) s.ell([0, y, 28.6], [2.6, 0.7, 0.75], 0, { mode: 'carve' });
  // sling swivels
  s.region([-0.4, -18.4, -36], [0.4, -15.6, -33], (x, y, z) => {
    const r = Math.hypot(y + 17.0, z + 34.5);
    return r <= 1.2 && r >= 0.6;
  }, BLUE.hi, { flags: M });
  // ---- muzzle devices
  let muzzleZ = TM_BARREL_END + 0.3;
  if (a.muzzle === 'cutts') {
    s.rbox([0, 0.1, TM_BARREL_END + 3.4], [1.95, 2.0, 3.6], 0.8, BLUE.base, { flags: M });
    for (let i = 0; i < 4; i++) {
      const z = TM_BARREL_END + 1.6 + i * 1.35;
      s.region([-1.6, 1.0, z], [1.6, 2.4, z + 0.55], () => true, 0, { mode: 'carve' });
    }
    s.walls([-2.2, -0.5, TM_BARREL_END], [2.2, 2.4, TM_BARREL_END + 7.5], (x, y, z) => y > 1.0 && Math.abs(x) <= 1.6 && ((z - TM_BARREL_END - 1.6) % 1.35 + 1.35) % 1.35 < 0.55 && z < TM_BARREL_END + 7, BLUE.dark);
    s.region([-0.7, -0.7, TM_BARREL_END + 5], [0.7, 0.7, TM_BARREL_END + 7.2], (x, y) => Math.hypot(x, y) <= 0.7, 0, { mode: 'carve' });
    muzzleZ = TM_BARREL_END + 7.2;
  } else if (a.muzzle === 'suppressor') {
    s.cap([0, 0, TM_BARREL_END - 1], [0, 0, TM_BARREL_END + 16], 2.25, 2.2, PARK.base, { flags: M });
    for (const z of [TM_BARREL_END + 1, TM_BARREL_END + 6, TM_BARREL_END + 11]) bandZ(s, 0, 0, z, z + 0.6, 2.45, PARK.shade);
    bandZ(s, 0, 0, TM_BARREL_END + 15.4, TM_BARREL_END + 16.2, 2.0, PARK.hi);
    s.region([-0.8, -0.8, TM_BARREL_END + 14], [0.8, 0.8, TM_BARREL_END + 16.6], (x, y) => Math.hypot(x, y) <= 0.75, 0, { mode: 'carve' });
    muzzleZ = TM_BARREL_END + 16.4;
  }
  // ---- optics: a brass-tube scope on two rings
  if (a.scope) {
    for (const z of [-4.0, 9.0]) {
      s.rbox([0, 4.4, z], [1.6, 0.9, 0.9], 0.3, BLUE.shade, { flags: M });
      s.region([-2.1, 4.0, z - 0.6], [2.1, 8.2, z + 0.6], (x, y) => {
        const r = Math.hypot(x, y - 6.2);
        return r <= 2.0 && r >= 1.35;
      }, BLUE.base, { flags: M });
    }
    s.cap([0, 6.2, -9.5], [0, 6.2, 15.5], 1.4, 1.4, BRASS.base, { flags: M });
    s.ell([0, 6.2, 16.6], [2.15, 2.15, 1.9], BRASS.base, { flags: M });
    s.ell([0, 6.2, -10.4], [1.85, 1.85, 1.5], BRASS.shade, { flags: M });
    s.region([-1.6, 4.6, 17.6], [1.6, 7.8, 18.6], (x, y) => Math.hypot(x, y - 6.2) <= 1.5, LENS, { flags: VF.SOFTAO | M });
    s.region([-1.3, 4.9, -11.9], [1.3, 7.5, -11.0], (x, y) => Math.hypot(x, y - 6.2) <= 1.2, LENS, { flags: VF.SOFTAO | M });
    s.cap([0, 7.4, 3.0], [0, 8.6, 3.0], 0.8, 0.8, BRASS.hi, { flags: M }); // elevation turret
    s.cap([1.3, 6.2, 3.0], [2.2, 6.2, 3.0], 0.75, 0.75, BRASS.hi, { flags: M }); // windage turret
  }
  // ---- laser module on the right flank of the barrel
  if (a.laser) {
    s.rbox([-2.8, -1.2, 33.0], [1.0, 1.0, 2.8], 0.35, BRASS.shade, { flags: M });
    s.rbox([-1.6, -0.6, 33.0], [0.5, 0.4, 1.6], 0.1, BLUE.shade, { flags: M });
    s.ell([-2.8, -1.2, 35.9], [0.6, 0.6, 0.35], LASER_RED, { flags: VF.EMISSIVE | VF.GLOW });
  }
  relief(s.m, 1.12, 0.8);
  return { m: s.m, muzzleZ };
}

function tommyBolt() {
  const s = new Sc('bolt', K);
  s.cap([0, 2.6, 9.6], [0, 4.2, 9.6], 0.45, 0.45, BLUE.hi, { flags: M });
  s.ell([0, 4.6, 9.6], [0.95, 0.85, 0.95], (x, y, z) => ((Math.round(x * 3) + Math.round(z * 3)) & 1 ? BLUE.hi : 0x8a94a4), { flags: M });
  return s.m;
}

/** the tommy rig: `frame` (root, grip pivot), `drum` (hub pivot), `bolt` (cocking knob, slides on Z) */
export function tommyRig(a: TommyAtt = TOMMY_DEFAULT): RigSpec {
  const fr = tommyFrame(a);
  const big = a.drum === 'C100';
  const dr = tommyDrum(big);
  // the drum model is built round its hub; offset it so its tongue sits in the well
  const dc: V3 = [TM_DRUM_C[0], -3.4 - dr.R - 1.0 + 1.6, TM_DRUM_C[2]];
  const GRIP = v3(TM_GRIP);
  const parts: PartSpec[] = [
    { name: 'frame', model: fr.m, pivot: GRIP, attach: [0, 0, 0] },
    { name: 'drum', model: dr.m, pivot: [0, 0, 0], attach: v3(dc), parent: 'frame' },
    { name: 'bolt', model: tommyBolt(), pivot: v3([0, 2.6, 9.6]), attach: v3([0, 2.6, 9.6]), parent: 'frame' },
  ];
  const sockets: Record<string, SocketSpec> = {
    muzzle: sock('frame', [0, 0, fr.muzzleZ + 0.4]),
    grip_l: sock('frame', [0.5, -8.6, 26.4]),
    ejector: sock('frame', [-2.8, 0.6, 5.7]),
    bolt_knob: sock('bolt', [0, 4.6, 9.6]),
    drum_l: { part: 'drum', at: [(dr.W + 1.6) * K, 0, 0] },
    butt: sock('frame', [0, -7, -42]),
  };
  if (a.scope) sockets.scope = sock('frame', [0, 6.2, -11.6]);
  if (a.laser) sockets.laser = sock('frame', [-2.8, -1.2, 36.3]);
  return {
    name: `tommy_${a.drum}_${a.muzzle}_${a.scope ? 's' : ''}${a.laser ? 'l' : ''}`,
    voxelSize: LONG_VS,
    parts,
    sockets,
    meta: { muzzle: v3([0, 0, fr.muzzleZ + 0.4]), length: (42 + fr.muzzleZ) / 100, gunKind: 'tommy', att: a, drumCenter: v3(dc), drumR: dr.R, gripOffset: [0, 0, 0] },
  };
}

// =============================================================================== small hand items
/** a 12-gauge shell: red paper hull, brass head (pivot at its middle, axis +Z) */
export function shotgunShellModel() {
  const s = new Sc('shell', K);
  s.cap([0, 0, -3.0], [0, 0, 2.6], 1.05, 1.0, (x, y, z) => (Math.abs(Math.atan2(y, x)) < 0.4 && z > -1 ? 0xd0503c : SHELL_RED));
  s.cap([0, 0, -3.4], [0, 0, -1.6], 1.15, 1.12, BRASS.base, { flags: M });
  s.ell([0, 0, -3.5], [1.2, 1.2, 0.25], BRASS.hi, { flags: M });
  s.ell([0, 0, 2.7], [0.8, 0.8, 0.3], 0x8a2a1e); // crimp
  return { model: s.m, voxelSize: LONG_VS, pivot: [0, 0, 0] as V3 };
}

/** a cartridge cluster for weapon-upgrade blueprints (tip colour by upgrade) */
export function cartridgeTrio(tip: number) {
  const s = new Sc('cartridges', K);
  const at: V3[] = [[-2.4, 0, 0], [0, 0.4, 0.8], [2.4, 0, -0.2]];
  at.forEach(([x, y, z], i) => {
    s.cap([x, y, z - 4.5], [x, y, z + 1.5], 1.1, 1.1, BRASS.base, { flags: M });
    s.cap([x, y, z + 1.5], [x, y, z + 4.2], 1.0, 0.45, i === 1 ? tip : mix(tip, 0xffffff, 0.12), { flags: i === 1 ? VF.EMISSIVE : 0 });
    s.ell([x, y, z - 4.7], [1.25, 1.25, 0.3], BRASS.hi, { flags: M });
  });
  relief(s.m, 1.1, 0.85);
  return { model: s.m, voxelSize: LONG_VS, pivot: [0, 0, 0] as V3 };
}

/** an under-barrel laser for the revolver (pivot at its clamp, beam along +Z) */
export function revolverLaserModel() {
  const s = new Sc('rev_laser', K);
  s.rbox([0, 0, 0], [1.1, 1.0, 2.6], 0.4, BRASS.shade, { flags: M });
  s.rbox([0, 1.1, -0.4], [1.3, 0.35, 1.2], 0.1, BLUE.shade, { flags: M });
  s.ell([0, 0, 2.7], [0.6, 0.6, 0.35], LASER_RED, { flags: VF.EMISSIVE | VF.GLOW });
  relief(s.m, 1.1, 0.85);
  return { model: s.m, voxelSize: LONG_VS, pivot: [0, 0, 0] as V3, lens: [0, 0, 2.9 * K] as V3 };
}

/** a prospector's short shovel: D-grip at the pivot, shaft along +Z, spade blade at the far end */
export function shovelModel() {
  const s = new Sc('shovel', K);
  // D-grip
  s.region([-0.7, -4.0, -4.6], [0.7, 4.0, 1.0], (x, y, z) => {
    const r = Math.hypot(y / 1.15, z + 1.8);
    return Math.abs(x) <= 0.6 && r <= 3.0 && r >= 2.0 && z <= 0.6;
  }, walnut(0.1));
  s.cap([0, -2.6, 0.4], [0, 2.6, 0.4], 0.6, 0.6, walnut(0.15));
  // shaft with a steel ferrule
  s.cap([0, 0, 0.6], [0, 0, 46], 1.05, 1.15, walnut());
  s.cap([0, 0, 44], [0, 0, 50], 1.35, 1.55, 0x6a7078, { flags: M });
  // the spade: dished, worn bright at the edge
  s.region([-6, -2.4, 48], [6, 2.4, 68], (x, y, z) => {
    const t = (z - 49) / 18;
    const hw = 5.2 - Math.pow(Math.max(0, t - 0.55), 2) * 14;
    const dish = -0.9 + (x / 5.2) ** 2 * 1.4;
    return t >= 0 && t <= 1 && Math.abs(x) <= hw && Math.abs(y - dish) <= 0.45;
  }, (x, y, z) => (z > 64 || Math.abs(x) > 4.4 ? 0xb8bcc4 : z > 52 ? 0x6e747e : 0x5a6068), { flags: M });
  s.rbox([0, -0.2, 50.5], [1.6, 0.9, 1.6], 0.4, 0x6a7078, { flags: M });
  relief(s.m, 1.12, 0.82);
  return { model: s.m, voxelSize: LONG_VS, pivot: [0, 0, 0] as V3 };
}
