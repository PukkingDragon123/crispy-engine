// Sundown's long guns and hand items, sculpted in design centimetres and built
// at 1/384 m ('hd') with a 1/192 m stand-in ('lo') for when they are sub-pixel
// (gunkit). Every component is its own rig part with a label, the slot that
// swaps it and an exploded-view vector (meta.components / meta.explode).
//
//  - the COACH GUN: a side-by-side, external-hammer double. Case-hardened
//    action (engraved, firing-pin bushings in the standing breech), side-lock
//    plates with gold scroll, rabbit-ear hammers, a top lever, twin triggers in
//    a scrolled guard, safety slide, hinge pin, checkered walnut wrist and
//    buttstock with a steel butt plate, the barrels with their top rib and brass
//    bead, the splinter forend with its iron. Options: coach / sawn-off / long
//    barrels, screw-in chokes, a leather shell holder (four shells), a laser.
//  - the TOMMY GUN: a 1928 Thompson. Milled receiver (actuator slot, ejection
//    port), trigger frame with fire selector and safety, Lyman ladder sight,
//    cocking knob, finned barrel with its collar and front blade, vertical
//    foregrip on a clamp, walnut pistol grip and buttstock, butt plate with its
//    trap, the L / C drum with its winding key. Options: Cutts compensator or a
//    suppressor, a brass scope on rings, a laser.
//
// Rig convention (same as the revolver): the gun points along +Z, top is +Y,
// the root part `frame` pivots at the grip (where the fist closes). Sockets:
// `muzzle` (+ `muzzle_l` / `muzzle_r` on the coach gun), `grip_l` (support hand),
// `ejector`, `butt`, `laser` (when fitted), tommy `drum_l` / `bolt_knob`.
// Animated parts keep their names: coach gun `barrels` (hinge), `hammer_l`,
// `hammer_r`, `lever`; tommy `drum`, `bolt`.
import { VoxelModel, VF, mix } from '../../../engine/voxel/VoxelModel';
import type { RigSpec, V3, SocketSpec } from '../../../engine/voxel/Rig';
import { Sc, clamp, lerp, sstep, spline } from './sculpt';
import {
  GunLod, gunK, gunVS, MET, PI, fract, fil, BLUED_L, PARK, BRASS, GOLD, LENS, LASER_RED, BORE, LEAD,
  blued, caseHardened, walnut, brassMat, leatherMat, hullMat, lathe, ring, lz, finishPart, gunWear, once, thick, GunRigBuilder,
} from './gunkit';

/** HD voxel size of the long guns (kept for older imports) */
export const LONG_VS = gunVS('long', 'hd');
const BL = blued(BLUED_L);
const CASE = caseHardened(9, 0.16);
const WAL = walnut({ dir: [0, -0.18, -1], seed: 7 });
const WAL_G = walnut({ dir: [0, -1, -0.25], seed: 11 });
const WAL_F = walnut({ dir: [0, 0, 1], seed: 13 });
const GOLDC = 0xe8c060;
const LEATHER = leatherMat(0x8a5a2c);
const STITCH = 0xe6cf9f;
const SHELL_RED = 0xb8382a;
const sc = (name: string, k: number) => new Sc(name, k);
/** a screw (or pin head) along X on a face at c, domed, slotted, its shank running into the part */
function screwX(name: string, k: number, c: V3, sx: number, r: number, len: number, col = BLUED_L.base, a = 0.7) {
  return once(`lg:screw:${name}:${c.join(',')}:${k}`, () => {
    const s = sc(name, k);
    const t = Math.max(0.22, 0.9 / k);
    s.region([c[0] - t, c[1] - r, c[2] - r], [c[0] + t, c[1] + r, c[2] + r], (x, y, z) => {
      const d = Math.hypot(y - c[1], z - c[2]);
      return d <= r && (x - c[0]) * sx <= t * (1 - (d / r) ** 2 * 0.55) && (x - c[0]) * sx >= -t;
    }, col, { flags: MET });
    if (len > 0) s.cap([c[0] - sx * 0.1, c[1], c[2]], [c[0] - sx * len, c[1], c[2]], r * 0.55, r * 0.5, BLUED_L.hi, { flags: MET });
    if (r * k >= 1.6) {
      const ca = Math.cos(a), sa = Math.sin(a);
      s.region([c[0] - t, c[1] - r, c[2] - r], [c[0] + t, c[1] + r, c[2] + r], (x, y, z) => {
        const u = (y - c[1]) * ca + (z - c[2]) * sa, v = -(y - c[1]) * sa + (z - c[2]) * ca;
        return (x - c[0]) * sx > -0.05 && Math.abs(v) < Math.max(0.09, 0.6 / k) && Math.abs(u) < r * 0.85;
      }, 0x22262c, { mode: 'paint', flags: MET });
    }
    return finishPart(s.m, k, { relief: false });
  });
}
/** a sling swivel: a loop in the YZ plane round (y, z) with its stud */
function swivel(name: string, k: number, y: number, z: number, up: number) {
  return once(`lg:swivel:${name}:${y}:${z}:${k}`, () => {
    const s = sc(name, k);
    const w = thick(0.32, k);
    s.region([-w, y - 1.5, z - 1.5], [w, y + 1.5, z + 1.5], (x, yy, zz) => {
      const r = Math.hypot(yy - y, zz - z);
      return Math.abs(x) <= w && r <= 1.25 && r >= 1.25 - thick(0.5, k);
    }, BLUED_L.hi, { flags: MET });
    s.cap([0, y + 1.1 * up, z], [0, y + 2.2 * up, z], thick(0.42, k), thick(0.5, k), BLUED_L.base, { flags: MET });
    return finishPart(s.m, k, { relief: false });
  });
}
/** checkering: two crossing groove sets in whole voxels (period P voxels), with a lighter diamond face */
const checker = (k: number, x: number, y: number, z: number, axis: 'x' | 'y') => {
  const P = Math.max(3, Math.round(0.85 * k));
  const i = Math.floor((axis === 'x' ? y : x) * k), j = Math.floor(z * k);
  const a = ((i + j) % P + P) % P, b = ((i - j) % P + P) % P;
  return a === 0 || b === 0 ? 2 : a === 1 || b === 1 ? 1 : 0;
};
const WOOD_DARK = 0x22110a, WOOD_FACE = 0x5c3620, WOOD_MID = 0x4e2c18;

// =============================================================================== COACH GUN
export interface ShotgunAtt {
  barrel: 'coach' | 'sawnoff' | 'long';
  choke: boolean;
  holder: boolean;
  laser: boolean;
}
export const SHOTGUN_DEFAULT: ShotgunAtt = { barrel: 'coach', choke: false, holder: false, laser: false };

/** grip centre (the fist), design cm; bore axis is y = 0, the breech face z = 0 */
const SG_GRIP: V3 = [0, -6.0, -12.5];
const SG_HINGE: V3 = [0, -4.4, 3.4];
const SG_BX = 2.2;
const SG_R = 2.2;
const sgZM = (a: ShotgunAtt) => (a.barrel === 'sawnoff' ? 28 : a.barrel === 'long' ? 66 : 48);
const sgStockEnd = (short: boolean) => (short ? -32 : -44);

/** the action: case-hardened body, fences, water table, hinge knuckle, standing breech, top strap and tang */
function sgAction(k: number) {
  return once(`sg:action:${k}`, () => {
    const s = sc('frame', k);
    const C = lz(CASE, MET);
    s.rbox([0, -1.8, -4.0], [3.2, 4.4, 4.0], 1.2, ...C);
    for (const sx of [-1, 1]) s.ell([sx * SG_BX, 0, -0.5], [2.45, 2.5, 1.3], ...C);
    s.rbox([0, -4.9, 1.2], [2.85, 1.3, 2.6], 0.7, ...C);
    s.region([-2.9, -5.6, 2.2], [2.9, -3.2, 4.6], (x, y, z) => Math.hypot(y - SG_HINGE[1], z - SG_HINGE[2]) <= 1.15 && Math.abs(x) <= 2.9, BLUED_L.shade, { flags: MET });
    // top strap + tang running back over the wrist
    s.path([[0, 2.4, -1.5], [0, 2.3, -6], [0, 0.6, -11.5]], (t) => 1.0 - t * 0.3, ...lz(BL, MET));
    // engraving: a fine scroll cut into the action flats
    s.region([-3.3, -5.6, -7.6], [3.3, 2.0, -0.6], (x, y, z) => {
      if (Math.abs(x) < 2.8) return false;
      const dz = z + 3.8, dy = y + 1.8, r = Math.hypot(dz, dy), th = Math.atan2(dy, dz);
      return r < 3.2 && Math.abs(Math.sin(r * 2.6 - th * 1.3)) < 0.12;
    }, 0x2e2a2a, { mode: 'paint', flags: MET });
    // firing-pin bushings in the standing breech (seen when the gun breaks open)
    for (const sx of [-1, 1]) s.cap([sx * SG_BX, 0, 0.55], [sx * SG_BX, 0, 0.95], 0.42, 0.34, BLUED_L.worn, { flags: MET });
    return finishPart(s.m, k);
  });
}
/** a side-lock plate (sx: +1 left, -1 right): tear-drop plate with gold scroll inlay */
function sgLock(sx: number, k: number) {
  return once(`sg:lock:${sx}:${k}`, () => {
    const s = sc(sx > 0 ? 'sidelock_l' : 'sidelock_r', k);
    const x0 = sx * 3.0;
    s.region([Math.min(x0, x0 + sx * 0.9), -6.5, -14.5], [Math.max(x0, x0 + sx * 0.9), 2.2, -2.5], (x, y, z) => {
      const u = (z + 7.5) / 6.8, v = (y + 2.2) / (3.6 - Math.max(0, -z - 7.5) * 0.28);
      const e = u * u + v * v;
      return e <= 1 && Math.abs(x - x0) <= 0.9 * (1 - Math.max(0, e - 0.8) * 2.5);
    }, (x, y, z) => {
      const dz = z + 7.2, dy = y + 2.4, r = Math.hypot(dz, dy), th = Math.atan2(dy, dz);
      const u = (z + 7.5) / 6.8, v = (y + 2.2) / (3.6 - Math.max(0, -z - 7.5) * 0.28);
      if (u * u + v * v > 0.86) return 0x3a3634; // the plate's engraved border
      const scroll = Math.abs(Math.sin(r * 2.1 - th * 1.0)) < 0.13 && r < 3.4;
      return scroll ? GOLDC : CASE(x, y, z);
    }, { flags: MET });
    return finishPart(s.m, k);
  });
}
/** wrist + buttstock: checkered walnut, comb dropping to the heel, the toe sweeping down */
function sgStock(short: boolean, k: number) {
  return once(`sg:stock:${short}:${k}`, () => {
    const s = sc('stock', k);
    const wristTop = (z: number) => 1.6 + (z + 8) * 0.43;
    const wristBot = (z: number) => -6.4 + (z + 8) * 0.3 - 1.7 * Math.exp(-((z + 13.5) ** 2) / 7);
    const mat = (x: number, y: number, z: number) => {
      if (z < -8.5 && z > -16.5 && Math.abs(x) > 1.4) {
        const c = checker(k, x, y, z, 'x');
        const edge = Math.min(z + 16.5, -8.5 - z);
        if (edge < 0.35) return WOOD_DARK;
        return c === 2 ? WOOD_DARK : c === 1 ? WOOD_FACE : WOOD_MID;
      }
      return WAL(x, y, z);
    };
    s.region([-2.7, -12, -20], [2.7, 2.6, -5.5], (x, y, z) => {
      const top = wristTop(z), bot = wristBot(z);
      const cy = (top + bot) / 2, hy = (top - bot) / 2, hw = 2.3 + Math.max(0, -z - 15) * 0.06;
      return Math.pow(Math.abs(x) / hw, 2.4) + Math.pow(Math.abs(y - cy) / hy, 2.4) <= 1;
    }, ...lz(mat));
    const z0 = sgStockEnd(short), zw = -18;
    s.region([-3.4, -17, z0 - 0.1], [3.4, 0, zw], (x, y, z) => {
      const t = clamp((zw - z) / (zw - z0), 0, 1);
      const top = -1.8 - 2.6 * t + 0.35 * Math.sin(t * PI);
      const bot = -8.6 - 6.2 * Math.pow(t, 1.1);
      const hw = 2.35 + 0.6 * t - fil(z - z0, 0.5) * 0.6;
      const cy = (top + bot) / 2, hy = (top - bot) / 2;
      return z >= z0 && Math.pow(Math.abs(x) / hw, 2.6) + Math.pow(Math.abs(y - cy) / hy, 2.6) <= 1;
    }, ...lz(WAL));
    return finishPart(s.m, k);
  });
}
function sgButtPlate(short: boolean, k: number) {
  return once(`sg:butt:${short}:${k}`, () => {
    const s = sc('butt_plate', k);
    const z0 = sgStockEnd(short);
    s.region([-3.4, -17, z0 - 0.9], [3.4, 0, z0 + 0.1], (x, y, z) => {
      const top = -4.4 + 0.35 * Math.sin(PI), bot = -14.8;
      const cy = (top + bot) / 2, hy = (top - bot) / 2 + 0.2, hw = 3.1;
      return z < z0 && z > z0 - 0.8 && Math.pow(Math.abs(x) / hw, 2.6) + Math.pow(Math.abs(y - cy) / hy, 2.6) <= 1;
    }, (x, y, z) => (fract(y * 1.6) < 0.25 && Math.abs(x) < 2.6 && y < -5.2 && y > -14 ? BLUED_L.shade : BLUED_L.base), { flags: MET });
    return finishPart(s.m, k);
  });
}
function sgGuard(k: number) {
  return once(`sg:guard:${k}`, () => {
    const s = sc('trigger_guard', k);
    const pts = spline([[0, -6.1, -1.6], [0, -8.4, -2.4], [0, -9.6, -4.6], [0, -9.3, -7.4], [0, -7.6, -9.3], [0, -7.2, -12], [0, -7.9, -15.4]], 8);
    s.sweep(pts, (t) => [thick(0.62, k), thick(t < 0.7 ? 0.5 : 0.42, k), thick(t < 0.7 ? 0.5 : 0.42, k)], BL, 0.08, { flags: MET });
    s.ell([0, -8.0, -15.6], [0.6, 0.5, 0.9], BL, { flags: MET });
    // engraved bow
    s.region([-0.8, -10.2, -9], [0.8, -7.6, -2], (x, y, z) => Math.abs(x) > 0.3 && Math.abs(Math.sin(z * 3.1 + y * 2.0)) < 0.2, 0x2a2e36, { mode: 'paint', flags: MET });
    return finishPart(s.m, k);
  });
}
function sgTrigger(front: boolean, k: number) {
  return once(`sg:trig:${front}:${k}`, () => {
    const s = sc(front ? 'trigger_f' : 'trigger_r', k);
    const z = front ? -3.6 : -5.6;
    const pts = spline([[0, -5.6, z], [0, -6.6, z - 0.2], [0, -7.6, z - 0.6], [0, -8.2, z - 1.0]], 6);
    s.sweep(pts, (t) => [thick(0.36 + t * 0.06, k), thick(0.3, k), thick(0.34, k)], (x, y, zz) => (y < -7.3 && fract(y * 2.4) < 0.3 ? 0xb08a30 : GOLDC), 0.08, { flags: MET });
    return finishPart(s.m, k);
  });
}
function sgSafety(k: number) {
  return once(`sg:safety:${k}`, () => {
    const s = sc('safety', k);
    s.rbox([0, 2.6, -9.2], [0.6, 0.45, 0.9], 0.2, (x, y, z) => (y > 2.85 && fract(z * 2.6) < 0.4 ? 0xb08a30 : GOLDC), { flags: MET });
    return finishPart(s.m, k);
  });
}
function sgHinge(k: number) {
  return once(`sg:hinge:${k}`, () => {
    const s = sc('hinge_pin', k);
    s.region([-3.15, -5.6, 2.2], [3.15, -3.2, 4.6], (x, y, z) => Math.hypot(y - SG_HINGE[1], z - SG_HINGE[2]) <= 0.62 && Math.abs(x) <= 3.1, BLUED_L.worn, { flags: MET });
    for (const sx of [-1, 1]) s.region([sx * 2.9 - 0.25, -5.4, 2.4], [sx * 2.9 + 0.25, -3.4, 4.4], (x, y, z) => Math.hypot(y - SG_HINGE[1], z - SG_HINGE[2]) <= 0.78 && Math.abs(x) >= 2.85, (x, y, z) => (Math.abs(y - SG_HINGE[1]) < 0.12 ? 0x22262c : BLUED_L.hi), { flags: MET });
    return finishPart(s.m, k, { relief: false });
  });
}
/** the barrel set: two tubes, breech ring, lumps, bottom rib, bores and crowns (the top rib, bead and forend are their own parts) */
function sgTubes(a: ShotgunAtt, k: number) {
  const ZM = sgZM(a);
  return once(`sg:tubes:${a.barrel}:${k}`, () => {
    const s = sc('barrels', k);
    const B = lz(BL, MET);
    for (const sx of [-1, 1]) lathe(s, sx * SG_BX, 0, 0.2, ZM, (z) => lerp(SG_R + 0.12, SG_R - 0.18, (z - 0.2) / (ZM - 0.2)) - fil(ZM - z, 0.22), ...B);
    s.region([-0.9, -2.4, 0.6], [0.9, -0.8, ZM - 0.4], (x, y) => Math.abs(x) <= 0.9 && y < -1.0, ...B);
    s.rbox([0, -3.6, 1.6], [1.9, 1.3, 1.6], 0.5, BLUED_L.shade, { flags: MET });
    s.region([-4.4, -2.3, 0.0], [4.4, 2.3, 0.6], (x, y) => Math.hypot(Math.abs(x) - SG_BX, y) <= SG_R + 0.1, BLUED_L.hi, { flags: MET });
    // the extractor: a crescent between the chambers at the breech
    s.region([-1.0, -0.4, -0.05], [1.0, 1.6, 0.65], (x, y) => Math.abs(x) < 0.9 && y > -0.3 && y < 1.4, 0x9aa2ae, { flags: MET });
    if (a.barrel === 'sawnoff') for (const sx of [-1, 1]) ring(s, sx * SG_BX, 0, ZM - 0.6, ZM, 0, SG_R - 0.05, (x, y, z) => (fract((x + y) * 3.1) < 0.4 ? 0xb4bac4 : 0x9aa2ae), { mode: 'paint', flags: MET });
    // dark bores (a real hole you can see into), the breech chambers dark too
    for (const sx of [-1, 1]) {
      const bore = (x: number, y: number, z: number) => Math.hypot(x - sx * SG_BX, y) <= 1.15 && (z > ZM - 5 || z < 1.6);
      s.region([sx * SG_BX - 1.3, -1.3, -0.2], [sx * SG_BX + 1.3, 1.3, ZM + 0.5], bore, 0, { mode: 'carve' });
      s.walls([sx * SG_BX - 2, -2, -0.5], [sx * SG_BX + 2, 2, ZM + 1], bore, BORE, MET);
    }
    return finishPart(s.m, k, { wear: gunWear() });
  });
}
function sgRib(a: ShotgunAtt, k: number) {
  const ZM = sgZM(a);
  return once(`sg:rib:${a.barrel}:${k}`, () => {
    const s = sc('rib', k);
    const P = Math.max(2, Math.round(0.5 * k));
    s.region([-1.3, 0.8, 0.5], [1.3, 2.9, ZM - 0.4], (x, y) => Math.abs(x) <= 1.05 - (y - 1.6) * 0.35 && y <= 2.65, BLUED_L.shade, { flags: MET });
    // the matted top: fine cross-cut anti-glare serrations
    s.region([-0.55, 2.4, 0.5], [0.55, 2.95, ZM - 0.4], (x, y) => Math.abs(x) <= 0.5 && y <= 2.9, (x, y, z) => (Math.floor(z * k) % P === 0 ? BLUED_L.shade : BLUED_L.hi), { flags: MET });
    return finishPart(s.m, k, { relief: false });
  });
}
function sgBead(a: ShotgunAtt, k: number) {
  const ZM = sgZM(a);
  return once(`sg:bead:${a.barrel}:${k}`, () => {
    const s = sc('bead', k);
    s.cap([0, 2.7, ZM - 1.1], [0, 3.1, ZM - 1.1], 0.2, 0.2, BRASS.shade, { flags: MET });
    s.ell([0, 3.25, ZM - 1.1], [0.45, 0.45, 0.45], (x, y) => (y > 3.4 ? 0xfff0b0 : BRASS.hi), { flags: MET });
    if (a.barrel === 'long') s.ell([0, 3.1, 34], [0.3, 0.3, 0.3], 0xe8e4dc, { flags: MET });
    return finishPart(s.m, k, { relief: false, wear: false });
  });
}
/** a barrel band: the long tom's brass band, the sawn-off's hose clamp */
function sgBand(a: ShotgunAtt, k: number) {
  if (a.barrel === 'coach') return null;
  const ZM = sgZM(a);
  return once(`sg:band:${a.barrel}:${k}`, () => {
    const s = sc('barrel_band', k);
    const [z0, z1, col, pad] = a.barrel === 'long' ? [38, 39.2, BRASS.base, 0.4] : [ZM - 8.5, ZM - 7.4, 0x8a8f96, 0.35];
    s.region([-4.7, -2.7, z0], [4.7, 2.7, z1], (x, y) => {
      const d = Math.hypot(Math.abs(x) - SG_BX, y);
      return d <= SG_R + pad && (d > SG_R - 0.25 || Math.abs(x) < SG_BX) && Math.abs(x) <= 4.6;
    }, col, { flags: MET });
    if (a.barrel === 'sawnoff') s.rbox([-4.6, 0, (z0 + z1) / 2], [0.5, 0.6, 0.5], 0.15, 0x6e737a, { flags: MET }); // the clamp's screw block
    return finishPart(s.m, k);
  });
}
function sgForend(short: boolean, k: number) {
  return once(`sg:forend:${short}:${k}`, () => {
    const s = sc('forend', k);
    const fz0 = 2.8, fz1 = short ? 15 : 19;
    s.region([-3.0, -6.2, fz0], [3.0, -1.4, fz1 + 1], (x, y, z) => {
      const t = (z - fz0) / (fz1 - fz0);
      const hw = 2.85 - Math.max(0, t - 0.75) * 2.2, bot = -5.5 + Math.max(0, t - 0.7) * 3.0;
      const cy = (bot - 1.6) / 2, hy = (-1.6 - bot) / 2;
      return t <= 1.05 && Math.pow(Math.abs(x) / Math.max(0.6, hw), 2.3) + Math.pow(Math.abs(y - cy) / Math.max(0.5, hy), 2.3) <= 1;
    }, ...lz((x, y, z) => {
      if (z > fz0 + 3.5 && z < fz1 - 3 && Math.abs(x) > 1.8) {
        if (Math.min(z - fz0 - 3.5, fz1 - 3 - z) < 0.35) return WOOD_DARK;
        const c = checker(k, x, y, z, 'x');
        return c === 2 ? WOOD_DARK : c === 1 ? WOOD_FACE : WOOD_MID;
      }
      return WAL_F(x, y, z);
    }));
    return finishPart(s.m, k);
  });
}
function sgForendIron(short: boolean, k: number) {
  return once(`sg:iron:${short}:${k}`, () => {
    const s = sc('forend_iron', k);
    s.rbox([0, -5.7, 2.8 + 6.5], [0.8, 0.4, 1.4], 0.2, ...lz(CASE, MET));
    s.rbox([0, -5.95, 2.8 + 7.4], [0.35, 0.22, 0.45], 0.1, BLUED_L.worn, { flags: MET }); // the push-rod latch
    return finishPart(s.m, k);
  });
}
function sgChoke(a: ShotgunAtt, sx: number, k: number) {
  const ZM = sgZM(a);
  return once(`sg:choke:${a.barrel}:${sx}:${k}`, () => {
    const s = sc(sx > 0 ? 'choke_l' : 'choke_r', k);
    const cx = sx * SG_BX;
    s.region([cx - 2.6, -2.6, ZM - 2.2], [cx + 2.6, 2.6, ZM + 1.4], (x, y, z) => {
      const r = Math.hypot(x - cx, y);
      return r <= SG_R + 0.3 - (z > ZM + 0.6 ? 0.25 : 0) && r > 1.2;
    }, (x, y, z) => (z < ZM - 0.6 && fract((Math.atan2(y, x - cx) / (2 * PI)) * 28) < 0.5 ? BRASS.shade : BRASS.base), { flags: MET });
    s.walls([cx - 2, -2, ZM - 2.4], [cx + 2, 2, ZM + 1.6], (x, y, z) => Math.hypot(x - cx, y) <= 1.2, BORE, MET);
    return finishPart(s.m, k);
  });
}
function sgLaser(a: ShotgunAtt, k: number) {
  const ZM = sgZM(a);
  const lzz = Math.min(ZM - 4, 24);
  return once(`sg:laser:${a.barrel}:${k}`, () => {
    const s = sc('laser', k);
    lathe(s, 0, -4.0, lzz - 3.0, lzz + 3.0, (z) => 1.15 - fil(Math.min(z - lzz + 3.0, lzz + 3.0 - z), 0.4), brassMat(4), { flags: MET });
    for (const dz of [-1.5, 1.5]) s.rbox([0, -2.9, lzz + dz], [1.5, 0.35, 0.6], 0.1, BLUED_L.shade, { flags: MET });
    ring(s, 0, -4.0, lzz + 2.6, lzz + 3.05, 0.6, 1.2, BLUED_L.hi, { flags: MET });
    s.ell([0, -4.0, lzz + 3.1], [0.62, 0.62, 0.35], LASER_RED, { flags: VF.EMISSIVE | VF.GLOW });
    s.cap([1.15, -4.0, lzz - 0.8], [1.5, -4.0, lzz - 0.8], 0.32, 0.32, 0x222226, {}); // the switch
    return finishPart(s.m, k);
  });
}
/** the rabbit-ear hammer (sx: +1 left, -1 right): tumbler hub, fluted neck, a tall ear sweeping back to a checkered pad */
function sgHammer(sx: number, k: number) {
  return once(`sg:hammer:${sx}:${k}`, () => {
    const s = sc(sx > 0 ? 'hammer_l' : 'hammer_r', k);
    const x = sx * 3.35;
    const C = lz(CASE, MET);
    s.cap([x, -1.6, -6.6], [x, 1.6, -7.2], 0.7, 0.6, ...C);
    const ear = spline([[x, 1.4, -7.1], [x + sx * 0.08, 2.4, -7.6], [x + sx * 0.18, 3.1, -8.6], [x + sx * 0.25, 3.25, -9.8], [x + sx * 0.25, 2.95, -10.6]], 8);
    s.sweep(ear, (t) => [lerp(0.6, 0.66, t), lerp(0.62, 0.5, t), 0.62], C[0], 0.06, C[1]);
    // checkered thumb pad
    s.region([x - 0.9, 2.6, -11.2], [x + 0.9, 3.9, -8.8], (xx, y, z) => y > 3.05 + (z < -10 ? (-10 - z) * 0.5 : 0) - 0.1, (xx, y, z) => (checker(k, xx, y, z, 'y') === 2 ? 0x2e2a30 : 0x8a8478), { mode: 'paint', flags: MET });
    s.cap([x, 1.2, -6.9], [x * 0.7, 1.4, -5.2], 0.42, 0.38, BLUED_L.shade, { flags: MET }); // the nose to the striker
    s.ell([x, -1.5, -6.5], [0.75, 0.75, 0.75], (xx, y, z) => (Math.hypot(y + 1.5, z + 6.5) < 0.28 ? 0x22262c : BLUED_L.hi), { flags: MET }); // tumbler pin
    return finishPart(s.m, k);
  });
}
function sgLever(k: number) {
  return once(`sg:lever:${k}`, () => {
    const s = sc('lever', k);
    s.path([[0, 2.95, -6.4], [-0.6, 3.15, -9.0], [-1.6, 3.3, -11.0]], (t) => 0.55 - 0.1 * t, ...lz(BL, MET));
    s.ell([-1.8, 3.35, -11.6], [0.95, 0.5, 1.05], (x, y, z) => (y > 3.5 && checker(k, x, y, z, 'y') === 2 ? BLUED_L.shade : BLUED_L.hi), { flags: MET });
    s.cap([0, 2.5, -6.4], [0, 3.1, -6.4], 0.55, 0.55, BLUED_L.base, { flags: MET }); // the spindle head
    return finishPart(s.m, k);
  });
}
/** the leather shell holder laced to the right flank of the stock, and one of its four shells */
function sgHolder(short: boolean, k: number) {
  return once(`sg:holder:${short}:${k}`, () => {
    const s = sc('shell_holder', k);
    const zc = short ? -24 : -30;
    s.rbox([-3.1, -8.4, zc], [0.55, 3.3, 5.4], 0.4, ...lz(LEATHER));
    // loops for the shells, a stitched border, lacing
    s.rbox([-3.55, -8.5, zc], [0.4, 1.15, 5.6], 0.3, ...lz(LEATHER));
    s.region([-3.9, -11.8, zc - 5.5], [-3.5, -5, zc + 5.5], (x, y, z) => (Math.abs(y + 11.4) < 0.18 || Math.abs(y + 5.4) < 0.18) && Math.round(z * 2) % 2 === 0, STITCH, { mode: 'paint', flags: 0 });
    return finishPart(s.m, k);
  });
}
function sgShell(short: boolean, i: number, k: number) {
  return once(`sg:shell:${short}:${i}:${k}`, () => {
    const s = sc(`shell_${i + 1}`, k);
    const zc = short ? -24 : -30, z = zc - 3.9 + i * 2.6;
    lathe2Y(s, -3.55, z, -11.2, -6.3, 0.95, hullMat(SHELL_RED), 0);
    lathe2Y(s, -3.55, z, -6.3, -5.4, 1.0, brassMat(i), MET);
    s.region([-4.6, -5.5, z - 1.1], [-2.5, -5.2, z + 1.1], (x, y, zz) => Math.hypot(x + 3.55, zz - z) < 0.3, 0xc06a3a, { mode: 'paint', flags: MET });
    return finishPart(s.m, k, { relief: false });
  });
}
/** a short cylinder along Y round (x, z) */
function lathe2Y(s: Sc, x: number, z: number, y0: number, y1: number, r: number, col: (x: number, y: number, z: number) => number, flags: number) {
  s.region([x - r, y0, z - r], [x + r, y1, z + r], (xx, y, zz) => Math.hypot(xx - x, zz - z) <= r - fil(Math.min(y - y0, y1 - y), 0.15), col, { flags });
}

/** the coach gun: `frame` (root, grip pivot), `barrels` (hinge), `hammer_l` / `hammer_r`, `lever`, plus every component */
export function shotgunRig(a: ShotgunAtt = SHOTGUN_DEFAULT, lod: GunLod = 'hd'): RigSpec {
  const k = gunK('long', lod);
  const short = a.barrel === 'sawnoff';
  const ZM = sgZM(a);
  const muzzleZ = ZM + (a.choke ? 1.4 : 0);
  const z0 = sgStockEnd(short);
  const b = new GunRigBuilder(k);
  b.root('frame', sgAction(k), SG_GRIP, 'Action');
  const X = (parent: string, name: string, m: VoxelModel | null, at: V3, label: string, ex: V3, dist: number, slot?: string, delay = 0) => b.add(name, m, parent, at, { label, slot, ex, dist, delay });
  X('frame', 'stock', sgStock(short, k), [0, -6.0, -14], 'Walnut Stock', [0, -0.15, -1], 0.16, 'barrel', 0.1);
  X('stock', 'butt_plate', sgButtPlate(short, k), [0, -9.4, z0], 'Butt Plate', [0, 0, -1], 0.06, undefined, 0.4);
  for (const [i, y] of [[0, -6.4], [1, -12.4]] as [number, number][]) X('butt_plate', `butt_screw_${i + 1}`, screwZ(`butt_screw_${i + 1}`, k, [0, y, z0 - 0.8], 0.45, short), [0, y, z0 - 0.8], `Butt Screw ${i + 1}`, [0, 0, -1], 0.04, undefined, 0.6);
  for (const sx of [1, -1]) {
    X('frame', sx > 0 ? 'sidelock_l' : 'sidelock_r', sgLock(sx, k), [sx * 3.4, -2.2, -7.5], sx > 0 ? 'Side Lock (Left)' : 'Side Lock (Right)', [sx, 0, 0], 0.07, undefined, 0.2);
    X(sx > 0 ? 'sidelock_l' : 'sidelock_r', sx > 0 ? 'lock_screw_l' : 'lock_screw_r', screwX(sx > 0 ? 'lock_screw_l' : 'lock_screw_r', k, [sx * 3.85, -2.4, -7.2], sx, 0.42, 2.5), [sx * 3.85, -2.4, -7.2], sx > 0 ? 'Lock Screw (Left)' : 'Lock Screw (Right)', [sx, 0, 0], 0.04, undefined, 0.5);
    X('frame', sx > 0 ? 'hammer_l' : 'hammer_r', sgHammer(sx, k), [sx * 3.35, -1.5, -6.5], sx > 0 ? 'Hammer (Left)' : 'Hammer (Right)', [sx * 0.6, 1, -0.3], 0.08, undefined, 0.3);
  }
  X('frame', 'lever', sgLever(k), [0, 2.9, -6.4], 'Top Lever', [0, 1, -0.2], 0.06, undefined, 0.35);
  X('frame', 'safety', sgSafety(k), [0, 2.6, -9.2], 'Safety Slide', [0, 1, 0], 0.045, undefined, 0.45);
  X('frame', 'trigger_guard', sgGuard(k), [0, -8.0, -6.0], 'Trigger Guard', [0, -1, 0], 0.09, undefined, 0.15);
  X('frame', 'trigger_f', sgTrigger(true, k), [0, -6.0, -3.6], 'Front Trigger', [0, -1, 0.3], 0.05, undefined, 0.4);
  X('frame', 'trigger_r', sgTrigger(false, k), [0, -6.0, -5.6], 'Rear Trigger', [0, -1, -0.3], 0.05, undefined, 0.4);
  X('frame', 'hinge_pin', sgHinge(k), SG_HINGE, 'Hinge Pin', [1, 0, 0], 0.1, undefined, 0.5);
  if (!short) X('stock', 'swivel_butt', swivel('swivel_butt', k, -15.2, -36.5, 1), [0, -15.2, -36.5], 'Sling Swivel', [0, -1, 0], 0.04, undefined, 0.5);
  if (a.holder) {
    X('stock', 'shell_holder', sgHolder(short, k), [-3.2, -8.4, short ? -24 : -30], 'Shell Holder', [-1, 0, 0], 0.07, 'stock', 0.2);
    for (let i = 0; i < 4; i++) X('shell_holder', `shell_${i + 1}`, sgShell(short, i, k), [-3.55, -8.5, (short ? -24 : -30) - 3.9 + i * 2.6], `Shell ${i + 1}`, [-0.3, 1, 0], 0.05 + i * 0.012, 'stock', 0.45);
  }
  // the barrel group hinges open round SG_HINGE
  X('frame', 'barrels', sgTubes(a, k), SG_HINGE, a.barrel === 'sawnoff' ? 'Sawn-Off Barrels' : a.barrel === 'long' ? 'Long Tom Barrels' : 'Coach Barrels', [0, 0, 1], 0.2, 'barrel', 0.0);
  X('barrels', 'rib', sgRib(a, k), [0, 1.6, ZM / 2], 'Top Rib', [0, 1, 0], 0.05, 'barrel', 0.45);
  X('rib', 'bead', sgBead(a, k), [0, 3.25, ZM - 1.1], 'Brass Bead', [0, 1, 0], 0.03, 'barrel', 0.7);
  X('barrels', 'barrel_band', sgBand(a, k), [0, 0, a.barrel === 'long' ? 38.6 : ZM - 8.0], a.barrel === 'long' ? 'Barrel Band' : 'Hose Clamp', [0, 1, 0], 0.06, 'barrel', 0.5);
  X('barrels', 'forend', sgForend(short, k), [0, -3.6, 9], 'Splinter Forend', [0, -1, 0], 0.08, undefined, 0.25);
  X('forend', 'forend_iron', sgForendIron(short, k), [0, -5.7, 9.3], 'Forend Iron', [0, -1, 0], 0.04, undefined, 0.55);
  if (!short) X('barrels', 'swivel_front', swivel('swivel_front', k, -3.3, ZM - 11.5, 1), [0, -3.3, ZM - 11.5], 'Sling Swivel (Front)', [0, -1, 0], 0.04, undefined, 0.5);
  if (a.choke) for (const sx of [1, -1]) X('barrels', sx > 0 ? 'choke_l' : 'choke_r', sgChoke(a, sx, k), [sx * SG_BX, 0, ZM - 0.4], sx > 0 ? 'Choke (Left)' : 'Choke (Right)', [sx * 0.15, 0, 1], 0.07, 'muzzle', 0.35);
  if (a.laser) X('barrels', 'laser', sgLaser(a, k), [0, -2.9, Math.min(ZM - 4, 24)], 'Laser Sight', [0, -1, 0], 0.07, 'under', 0.35);
  const sockets: Record<string, SocketSpec> = {
    muzzle: b.sock('barrels', [0, 0, muzzleZ + 0.6]),
    muzzle_l: b.sock('barrels', [SG_BX, 0, muzzleZ + 0.6]),
    muzzle_r: b.sock('barrels', [-SG_BX, 0, muzzleZ + 0.6]),
    grip_l: b.sock('barrels', [0.9, -6.4, short ? 9.5 : 11.5]),
    ejector: b.sock('barrels', [0, 0, 0.8]),
    butt: b.sock('frame', [0, -8.4, z0]),
  };
  const laserZ = Math.min(ZM - 4, 24) + 3.4;
  if (a.laser) sockets.laser = b.sock('barrels', [0, -4.0, laserZ]);
  return {
    name: `shotgun_${a.barrel}_${a.choke ? 'c' : ''}${a.holder ? 'h' : ''}${a.laser ? 'l' : ''}${lod === 'hd' ? '' : '_' + lod}`,
    voxelSize: gunVS('long', lod),
    parts: b.parts,
    sockets,
    meta: { muzzle: b.at('frame', [0, 0, muzzleZ + 0.6]), length: (-z0 + muzzleZ) / 100, gunKind: 'shotgun', att: a, lod, explode: b.explode, components: b.components, gripOffset: [0, 0, 0] },
  };
}
/** a screw along Z (butt-plate screws), head facing -Z */
function screwZ(name: string, k: number, c: V3, r: number, short: boolean) {
  return once(`lg:screwz:${name}:${short}:${k}`, () => {
    const s = sc(name, k);
    s.region([c[0] - r, c[1] - r, c[2] - 0.3], [c[0] + r, c[1] + r, c[2] + 0.1], (x, y, z) => {
      const d = Math.hypot(x - c[0], y - c[1]);
      return d <= r && z >= c[2] - 0.3 * (1 - (d / r) ** 2 * 0.6);
    }, (x, y) => (Math.abs(x - c[0]) < 0.6 / k + 0.05 && r * k > 1.6 ? 0x5e4214 : BRASS.hi), { flags: MET });
    s.cap([c[0], c[1], c[2]], [c[0], c[1], c[2] + 2.0], r * 0.5, r * 0.4, BRASS.shade, { flags: MET });
    return finishPart(s.m, k, { relief: false });
  });
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
const TM_DRUM_Z = 10;
const TM_BARREL_END = 44;
const drumDims = (big: boolean) => ({ R: big ? 12.2 : 9.6, W: big ? 3.0 : 2.55 });
/** design-space centre of the drum's hub, so its tongue sits in the magazine well */
const drumCentre = (big: boolean): V3 => [0, -3.4 - drumDims(big).R - 1.0 + 1.6, TM_DRUM_Z];

/** the Thompson drum (L: 50 rounds, C: 100), built round its hub (face normal along X); no key (see drumKeyModel) */
export function tommyDrum(big = false, name = 'drum', k = gunK('long', 'hd'), key = false) {
  const { R, W } = drumDims(big);
  const m = once(`tm:drum:${big}:${name}:${key}:${k}`, () => {
    const s = sc(name, k);
    s.region([-W - 0.6, -R - 0.6, -R - 0.6], [W + 0.6, R + 0.6, R + 0.6], (x, y, z) => {
      const r = Math.hypot(y, z);
      const w = W - (r / R) ** 4 * 0.5;
      return r <= R && Math.abs(x) <= w;
    }, ...lz((x, y, z) => {
      const r = Math.hypot(y, z);
      if (Math.abs(r - R * 0.62) < 0.45 && Math.abs(x) > W - 0.8) return BLUED_L.shade; // pressed ring
      if (Math.abs(r - R * 0.36) < 0.3 && Math.abs(x) > W - 0.6) return BLUED_L.shade; // inner ring
      if (r > R - 0.9) return BLUED_L.hi; // rolled rim catches light
      return BLUED_L.base;
    }, MET));
    s.region([-W - 0.2, -R - 0.4, -R - 0.4], [W + 0.2, R + 0.4, R + 0.4], (x, y, z) => {
      const r = Math.hypot(y, z);
      return r <= R + 0.35 && r > R - 0.35 && Math.abs(x) <= W - 0.6;
    }, BLUED_L.shade, { flags: MET });
    // rivets round both faces
    const n = big ? 16 : 12;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * PI * 2, rr = R - 1.5;
      for (const sx of [-1, 1]) s.ell([sx * (W - 0.15), Math.sin(a) * rr, Math.cos(a) * rr], [0.4, 0.42, 0.42], BLUED_L.hi, { flags: MET });
    }
    s.cap([W - 0.3, 0, 0], [W + 0.9, 0, 0], 1.7, 1.5, BLUED_L.shade, { flags: MET }); // hub
    s.cap([-W + 0.3, 0, 0], [-W - 0.6, 0, 0], 1.4, 1.2, BLUED_L.shade, { flags: MET }); // back hub
    // the "L" / "C" stamping near the rim, a "WIND" arrow
    for (const [y, z] of (big ? [[-R + 2.2, -1], [-R + 2.2, 0], [-R + 2.2, 1], [-R + 2.9, -1], [-R + 3.6, -1], [-R + 3.6, 0], [-R + 3.6, 1]] : [[-R + 2.2, -1], [-R + 2.2, 0], [-R + 2.2, 1], [-R + 2.9, -1], [-R + 3.6, -1]]) as [number, number][])
      s.ell([W + 0.05, y, z], [0.25, 0.32, 0.32], 0xd8d4c8, { mode: 'paint', flags: MET });
    s.region([W - 0.4, R * 0.42, -3.2], [W + 0.2, R * 0.52, 3.2], (x, y, z) => Math.abs(Math.hypot(y, z) - R * 0.47) < 0.12 && z > -2.6 && z < 2.6, 0xd8d4c8, { mode: 'paint', flags: MET });
    // the tongue that slides into the receiver's well
    s.rbox([0, R - 0.2, 0], [1.5, 1.5, 3.0], 0.3, BLUED_L.shade, { flags: MET });
    s.rbox([0, R + 1.0, 0], [1.1, 0.5, 2.6], 0.2, BLUED_L.hi, { flags: MET });
    if (key) mergeInto(s.m, drumKeyLocal(big, k));
    return finishPart(s.m, k);
  });
  return { m, R, W };
}
function mergeInto(dst: VoxelModel, src: VoxelModel) {
  src.forEach((x, y, z, c, f) => dst.set(x, y, z, c, f));
}
/** the winding key on the drum's left face (drum-local coordinates) */
function drumKeyLocal(big: boolean, k: number) {
  const { W } = drumDims(big);
  return once(`tm:key:${big}:${k}`, () => {
    const s = sc('drum_key', k);
    s.cap([W + 0.85, 0, 0], [W + 1.4, 0, 0], 0.62, 0.55, BLUED_L.worn, { flags: MET }); // arbor
    s.rbox([W + 1.3, 0, 0], [0.45, 0.85, 3.6], 0.3, BLUED_L.hi, { flags: MET });
    for (const sz of [-1, 1]) s.ell([W + 1.3, 0, sz * 3.6], [0.55, 1.2, 0.9], (x, y, z) => (Math.abs(y) < 0.18 ? BLUED_L.shade : BLUED_L.base), { flags: MET });
    return finishPart(s.m, k);
  });
}
/** the drum as a static hand item (reload): the drum with its key, pivot at the hub */
export function tommyDrumModel(big = false, lod: GunLod = 'lo') {
  const k = gunK('long', lod);
  return { model: tommyDrum(big, 'hand_drum', k, true).m, voxelSize: gunVS('long', lod), pivot: [0, 0, 0] as V3 };
}

function tmReceiver(k: number) {
  return once(`tm:recv:${k}`, () => {
    const s = sc('frame', k);
    s.region([-2.8, -3.6, -9.4], [2.8, 3.9, 14.3], (x, y, z) => {
      const top = 3.6, bot = -3.4;
      if (y < bot || y > top) return false;
      const hw = 2.65 - Math.max(0, y - 1.6) ** 2 * 0.28;
      const endTaper = z > 13 ? (z - 13) * 0.5 : z < -8.5 ? (-8.5 - z) * 0.6 : 0;
      return Math.abs(x) <= hw - endTaper && z >= -9.2 && z <= 14.1;
    }, ...lz(BL, MET));
    // the milled flats: a shallow relief panel on each side
    s.region([-2.8, -2.6, -7.5], [2.8, 1.2, 12], (x, y, z) => Math.abs(x) > 2.45 && (Math.abs(y + 2.4) < 0.12 || Math.abs(y - 1.0) < 0.12 || Math.abs(z + 7.3) < 0.12 || Math.abs(z - 11.8) < 0.12) && y > -2.6 && y < 1.2 && z > -7.5 && z < 12, BLUED_L.shade, { mode: 'paint', flags: MET });
    // the actuator slot along the top
    const slot = (x: number, y: number, z: number) => Math.abs(x) <= 0.45 && y > 2.2 && z > 3.5 && z < 12.5;
    s.region([-0.45, 2.2, 3.5], [0.45, 4.0, 12.5], slot, 0, { mode: 'carve' });
    s.walls([-1.5, 1.5, 3], [1.5, 4, 13], slot, BLUED_L.dark, MET);
    // ejection port on the right flank, the bolt face showing through
    const port = (x: number, y: number, z: number) => x < -2.1 && y > -0.8 && y < 2.0 && z > 3.0 && z < 8.4;
    s.region([-3, -0.8, 3.0], [-2.1, 2.0, 8.4], port, 0, { mode: 'carve' });
    s.walls([-3.2, -1.2, 2.6], [-1.6, 2.4, 8.8], port, BLUED_L.dark, MET);
    s.rbox([-1.9, 0.6, 5.7], [0.3, 0.9, 2.2], 0.1, 0x9aa2ae, { flags: MET });
    // the barrel's seat
    s.region([-1.5, -1.5, 13.0], [1.5, 1.5, 14.3], (x, y) => Math.hypot(x, y) < 1.3, 0, { mode: 'carve' });
    // the stamped Thompson bullet on the left flat
    s.region([2.4, -1.6, 4.2], [2.9, 0.6, 6.8], (x, y, z) => x > 2.45 && Math.hypot(y + 0.5, z - 5.5) < 1.05 && Math.hypot(y + 0.5, z - 5.5) > 0.82, 0x8a909a, { mode: 'paint', flags: MET });
    s.region([2.4, -1.0, 4.9], [2.9, 0.0, 6.4], (x, y, z) => x > 2.45 && Math.abs(y + 0.5) < 0.22 && z > 4.9 && z < 6.1 + (0.22 - Math.abs(y + 0.5)) * 1.4, 0x8a909a, { mode: 'paint', flags: MET });
    return finishPart(s.m, k);
  });
}
function tmTriggerFrame(k: number) {
  return once(`tm:lower:${k}`, () => {
    const s = sc('trigger_frame', k);
    s.rbox([0, -5.1, -2.6], [2.35, 1.9, 7.6], 0.7, ...lz(BL, MET));
    s.rbox([0, -4.0, 10.2], [2.5, 0.8, 3.6], 0.3, BLUED_L.shade, { flags: MET }); // magazine well lips
    // the magazine catch
    s.rbox([0, -4.6, 13.6], [0.9, 0.6, 0.4], 0.15, BLUED_L.worn, { flags: MET });
    return finishPart(s.m, k);
  });
}
function tmLever(name: string, z: number, k: number) {
  return once(`tm:lever:${name}:${k}`, () => {
    const s = sc(name, k);
    s.cap([2.3, -4.4, z], [2.95, -4.4, z], 0.5, 0.5, BLUED_L.hi, { flags: MET });
    s.rbox([3.0, -3.9, z - 0.5], [0.25, 0.9, 0.7], 0.15, (x, y) => (y > -3.4 && fract(y * 3) < 0.4 ? BLUED_L.shade : BLUED_L.hi), { flags: MET });
    return finishPart(s.m, k, { relief: false });
  });
}
function tmGuard(k: number) {
  return once(`tm:guard:${k}`, () => {
    const s = sc('trigger_guard', k);
    s.sweep(spline([[0, -6.6, 0.4], [0, -9.4, -0.3], [0, -10.0, -2.6], [0, -9.2, -4.6], [0, -6.8, -5.2]], 8), () => [thick(0.6, k), thick(0.5, k), thick(0.5, k)], BL, 0.08, { flags: MET });
    return finishPart(s.m, k);
  });
}
function tmTrigger(k: number) {
  return once(`tm:trigger:${k}`, () => {
    const s = sc('trigger', k);
    s.sweep(spline([[0, -6.2, -1.7], [0, -7.4, -1.9], [0, -8.8, -2.5]], 6), (t) => [thick(0.4, k), thick(0.33, k), thick(0.36, k)], BLUED_L.hi, 0.08, { flags: MET });
    return finishPart(s.m, k);
  });
}
function tmPistolGrip(k: number) {
  return once(`tm:pgrip:${k}`, () => {
    const s = sc('pistol_grip', k);
    s.path([[0, -6.4, -5.8], [0, -10.6, -7.0], [0, -15.6, -8.6]], (t) => 2.05 + 0.25 * t, ...lz(WAL_G));
    s.ell([0, -16.2, -8.9], [2.35, 1.2, 2.7], ...lz(WAL_G));
    // finger ridges down the front
    for (const y of [-9.2, -11.6, -14.0]) s.ell([0, y, -4.75 - (y + 6.4) * 0.3], [2.4, 0.42, 0.42], 0, { mode: 'carve' });
    return finishPart(s.m, k);
  });
}
function tmStock(k: number) {
  return once(`tm:stock:${k}`, () => {
    const s = sc('stock', k);
    const z0 = -42, zw = -9.6;
    s.region([-3.0, -17.5, z0], [3.0, 3.2, zw], (x, y, z) => {
      const t = clamp((zw - z) / (zw - z0), 0, 1);
      const top = 2.6 - 3.1 * t;
      const bot = -6.6 - 9.6 * Math.pow(t, 0.72);
      const hw = 2.2 + 0.5 * t;
      const cy = (top + bot) / 2, hy = (top - bot) / 2;
      return Math.pow(Math.abs(x) / hw, 2.6) + Math.pow(Math.abs(y - cy) / hy, 2.6) <= 1;
    }, ...lz(WAL));
    return finishPart(s.m, k);
  });
}
function tmStockPlate(k: number) {
  return once(`tm:splate:${k}`, () => {
    const s = sc('stock_plate', k);
    s.rbox([0, -2.0, -10.2], [2.5, 3.0, 0.7], 0.3, ...lz(BL, MET));
    s.cap([0, -4.0, -11.0], [0, -4.0, -9.4], 0.5, 0.5, BLUED_L.worn, { flags: MET }); // the stock release
    return finishPart(s.m, k);
  });
}
function tmButtPlate(k: number) {
  return once(`tm:butt:${k}`, () => {
    const s = sc('butt_plate', k);
    const z0 = -42;
    s.region([-2.9, -16.6, z0 - 1.0], [2.9, -0.2, z0 + 0.1], (x, y, z) => {
      const cy = (-0.5 - 16.2) / 2, hy = (16.2 - 0.5) / 2 + 0.3;
      return z < z0 && z > z0 - 0.9 && Math.pow(Math.abs(x) / 2.85, 2.6) + Math.pow(Math.abs(y - cy) / hy, 2.6) <= 1;
    }, (x, y) => (fract(y * 1.6) < 0.22 && Math.abs(x) < 2.3 && (y < -11 || y > -6) ? BLUED_L.shade : BLUED_L.base), { flags: MET });
    return finishPart(s.m, k);
  });
}
function tmTrap(k: number) {
  return once(`tm:trap:${k}`, () => {
    const s = sc('trap_door', k);
    s.rbox([0, -8.4, -43.05], [1.0, 2.0, 0.15], 0.1, BLUED_L.hi, { flags: MET });
    s.region([-1.1, -10.5, -43.3], [1.1, -6.3, -42.8], (x, y) => Math.abs(y + 8.4) > 1.85, 0x22262c, { mode: 'paint', flags: MET });
    return finishPart(s.m, k, { relief: false });
  });
}
function tmRearSight(k: number) {
  return once(`tm:rsight:${k}`, () => {
    const s = sc('rear_sight', k);
    for (const sx of [-1, 1]) s.rbox([sx * 1.0, 5.0, -6.6], [0.28, 1.6, 1.3], 0.15, BLUED_L.shade, { flags: MET });
    s.rbox([0, 3.9, -6.6], [1.4, 0.5, 1.5], 0.2, BLUED_L.base, { flags: MET });
    // the ladder leaf with its aperture and graduations
    s.rbox([0, 5.6, -6.6], [0.7, 1.4, 0.18], 0.06, (x, y) => (Math.abs(y - 5.6) > 0.2 && fract(y * 2.5) < 0.25 ? 0xd8d4c8 : BLUED_L.hi), { flags: MET });
    s.region([-0.3, 6.6, -6.9], [0.3, 7.2, -6.3], (x, y) => Math.hypot(x, y - 6.85) < 0.2, 0, { mode: 'carve' });
    s.rbox([0, 6.2, -6.6], [1.25, 0.35, 0.4], 0.1, BLUED_L.hi, { flags: MET });
    return finishPart(s.m, k);
  });
}
function tmBarrel(k: number) {
  return once(`tm:barrel:${k}`, () => {
    const s = sc('barrel', k);
    lathe(s, 0, 0, 13.4, TM_BARREL_END, (z) => lerp(1.45, 1.3, (z - 14) / 30) - fil(TM_BARREL_END - z, 0.2), ...lz(BL, MET));
    for (let z = 14.6; z < 27.5; z += 1.15) ring(s, 0, 0, z, z + 0.42, 1.3, 2.35 - fil(Math.min(z + 0.21 - 14.6, 27.5 - z), 0.6) * 0.5, BLUED_L.base, { flags: MET });
    const bore = (x: number, y: number, z: number) => Math.hypot(x, y) <= 0.62 && z > TM_BARREL_END - 3;
    s.region([-0.7, -0.7, TM_BARREL_END - 3], [0.7, 0.7, TM_BARREL_END + 0.5], bore, 0, { mode: 'carve' });
    s.walls([-2, -2, TM_BARREL_END - 4], [2, 2, TM_BARREL_END + 1], bore, BORE, MET);
    return finishPart(s.m, k);
  });
}
function tmCollar(k: number) {
  return once(`tm:collar:${k}`, () => {
    const s = sc('barrel_collar', k);
    ring(s, 0, 0, 13.6, 14.4, 1.3, 2.6, (x, y, z) => (fract((Math.atan2(y, x) / (2 * PI)) * 24) < 0.3 ? BLUED_L.shade : BLUED_L.base), { flags: MET });
    return finishPart(s.m, k);
  });
}
function tmFrontSight(k: number) {
  return once(`tm:fsight:${k}`, () => {
    const s = sc('front_sight', k);
    s.rbox([0, 1.9, TM_BARREL_END - 1.4], [thick(0.25, k), 0.75, 0.9], 0.1, BLUED_L.hi, { flags: MET });
    ring(s, 0, 0, TM_BARREL_END - 2.2, TM_BARREL_END - 0.6, 1.25, 1.6, BLUED_L.base, { flags: MET });
    return finishPart(s.m, k);
  });
}
function tmForegrip(k: number) {
  return once(`tm:fgrip:${k}`, () => {
    const s = sc('foregrip', k);
    s.path([[0, -2.6, 27.2], [0, -8.5, 26.4], [0, -13.0, 26.0]], (t) => 2.0 + 0.2 * Math.sin(t * PI), ...lz(WAL_G));
    s.ell([0, -13.4, 25.9], [2.2, 1.0, 2.2], ...lz(WAL_G));
    for (const y of [-4.6, -6.8, -9.0, -11.2]) s.ell([0, y, 28.6], [2.6, 0.7, 0.75], 0, { mode: 'carve' });
    return finishPart(s.m, k);
  });
}
function tmClamp(k: number) {
  return once(`tm:clamp:${k}`, () => {
    const s = sc('foregrip_clamp', k);
    s.rbox([0, -1.9, 26.6], [1.3, 1.0, 1.9], 0.4, ...lz(BL, MET));
    ring(s, 0, 0, 25.4, 27.8, 1.3, 1.75, BLUED_L.base, { flags: MET });
    return finishPart(s.m, k);
  });
}
function tmBolt(k: number) {
  return once(`tm:bolt:${k}`, () => {
    const s = sc('bolt', k);
    s.cap([0, 2.0, 9.6], [0, 4.2, 9.6], 0.45, 0.45, BLUED_L.hi, { flags: MET });
    s.ell([0, 4.6, 9.6], [0.95, 0.85, 0.95], (x, y, z) => (y > 4.6 && checker(k, x, y, z, 'y') === 2 ? 0x5a6474 : 0x8a94a4), { flags: MET });
    return finishPart(s.m, k);
  });
}
function tmCutts(k: number) {
  return once(`tm:cutts:${k}`, () => {
    const s = sc('compensator', k);
    const E = TM_BARREL_END;
    s.rbox([0, 0.1, E + 3.4], [1.95, 2.0, 3.6], 0.8, ...lz(BL, MET));
    const cut = (x: number, y: number, z: number) => y > 1.0 && Math.abs(x) <= 1.6 && (((z - E - 1.6) % 1.35) + 1.35) % 1.35 < 0.55 && z > E + 1.6 && z < E + 7;
    s.region([-1.6, 1.0, E + 1.6], [1.6, 2.4, E + 7], cut, 0, { mode: 'carve' });
    s.walls([-2.2, -0.5, E], [2.2, 2.4, E + 7.5], cut, BLUED_L.dark, MET);
    const bore = (x: number, y: number, z: number) => Math.hypot(x, y) <= 0.7 && z > E + 5;
    s.region([-0.7, -0.7, E + 5], [0.7, 0.7, E + 7.2], bore, 0, { mode: 'carve' });
    s.walls([-1.5, -1.5, E + 4.5], [1.5, 1.5, E + 7.5], bore, BORE, MET);
    return finishPart(s.m, k);
  });
}
function tmSuppressor(k: number) {
  return once(`tm:supp:${k}`, () => {
    const s = sc('suppressor', k);
    const E = TM_BARREL_END;
    lathe(s, 0, 0, E - 1, E + 16, (z) => lerp(2.25, 2.2, (z - E + 1) / 17) - fil(Math.min(z - E + 1, E + 16 - z), 0.3), PARK.base, { flags: MET });
    for (const z of [E + 1, E + 6, E + 11]) ring(s, 0, 0, z, z + 0.6, 2.0, 2.45, PARK.shade, { flags: MET });
    ring(s, 0, 0, E + 15.4, E + 16.2, 0.8, 2.0, PARK.hi, { flags: MET });
    const bore = (x: number, y: number, z: number) => Math.hypot(x, y) <= 0.75 && z > E + 14;
    s.region([-0.8, -0.8, E + 14], [0.8, 0.8, E + 16.6], bore, 0, { mode: 'carve' });
    s.walls([-1.5, -1.5, E + 13.5], [1.5, 1.5, E + 16.8], bore, BORE, MET);
    return finishPart(s.m, k);
  });
}
function tmScope(k: number) {
  return once(`tm:scope:${k}`, () => {
    const s = sc('scope', k);
    const bm = brassMat(5);
    lathe(s, 0, 6.2, -11.9, 18.6, (z) => {
      if (z < -9.5) return 1.4 + 0.45 * sstep((-9.5 - z) / 0.9) - fil(z + 11.9, 0.3);
      if (z > 15.5) return 1.4 + 0.75 * sstep((z - 15.5) / 1.1) - fil(18.6 - z, 0.3);
      return 1.4;
    }, (x, y, z) => (Math.abs(z + 9.6) < 0.15 || Math.abs(z - 15.6) < 0.15 ? 0x5e4214 : bm(x, y, z)), { flags: MET });
    s.region([-1.6, 4.6, 17.6], [1.6, 7.8, 18.7], (x, y) => Math.hypot(x, y - 6.2) <= 1.5, LENS, { flags: VF.SOFTAO | MET });
    s.region([-1.3, 4.9, -12.0], [1.3, 7.5, -11.0], (x, y) => Math.hypot(x, y - 6.2) <= 1.2, LENS, { flags: VF.SOFTAO | MET });
    s.cap([0, 7.4, 3.0], [0, 8.6, 3.0], 0.8, 0.8, (x, y, z) => (y > 7.9 && fract(Math.atan2(z - 3, x) * 2.5) < 0.5 ? BRASS.shade : BRASS.hi), { flags: MET });
    s.cap([1.3, 6.2, 3.0], [2.2, 6.2, 3.0], 0.75, 0.75, (x, y, z) => (x > 1.7 && fract(Math.atan2(z - 3, y - 6.2) * 2.5) < 0.5 ? BRASS.shade : BRASS.hi), { flags: MET });
    return finishPart(s.m, k);
  });
}
function tmScopeRing(z: number, k: number) {
  return once(`tm:ring:${z}:${k}`, () => {
    const s = sc(z < 0 ? 'scope_ring_r' : 'scope_ring_f', k);
    s.rbox([0, 4.4, z], [1.6, 0.9, 0.9], 0.3, BLUED_L.shade, { flags: MET });
    ring(s, 0, 6.2, z - 0.6, z + 0.6, 1.38, 2.0, BLUED_L.base, { flags: MET });
    s.rbox([2.05, 6.2, z], [0.22, 0.45, 0.4], 0.1, BLUED_L.worn, { flags: MET });
    return finishPart(s.m, k);
  });
}
function tmLaser(k: number) {
  return once(`tm:laser:${k}`, () => {
    const s = sc('laser', k);
    lathe(s, -2.8, -1.2, 30.2, 35.8, (z) => 1.0 - fil(Math.min(z - 30.2, 35.8 - z), 0.35), brassMat(6), { flags: MET });
    s.rbox([-1.6, -0.6, 33.0], [0.5, 0.4, 1.6], 0.1, BLUED_L.shade, { flags: MET });
    ring(s, -2.8, -1.2, 35.3, 35.85, 0.55, 1.05, BLUED_L.hi, { flags: MET });
    s.ell([-2.8, -1.2, 35.9], [0.6, 0.6, 0.35], LASER_RED, { flags: VF.EMISSIVE | VF.GLOW });
    s.cap([-3.8, -1.2, 31.5], [-4.05, -1.2, 31.5], 0.3, 0.3, 0x222226, {});
    return finishPart(s.m, k);
  });
}

/** the tommy rig: `frame` (root, grip pivot), `drum` (hub pivot), `bolt` (cocking knob, slides on Z), plus every component */
export function tommyRig(a: TommyAtt = TOMMY_DEFAULT, lod: GunLod = 'hd'): RigSpec {
  const k = gunK('long', lod);
  const big = a.drum === 'C100';
  const dr = tommyDrum(big, 'drum', k);
  const dc = drumCentre(big);
  const b = new GunRigBuilder(k);
  b.root('frame', tmReceiver(k), TM_GRIP, 'Receiver');
  const X = (parent: string, name: string, m: VoxelModel | null, at: V3, label: string, ex: V3, dist: number, slot?: string, delay = 0, local = false) => b.add(name, m, parent, at, { label, slot, ex, dist, delay, local });
  X('frame', 'trigger_frame', tmTriggerFrame(k), [0, -5.1, -2.6], 'Trigger Frame', [0, -1, 0], 0.1, undefined, 0.1);
  X('trigger_frame', 'selector', tmLever('selector', -5.6, k), [2.6, -4.4, -5.6], 'Fire Selector', [1, 0, 0], 0.05, undefined, 0.5);
  X('trigger_frame', 'safety', tmLever('safety', -1.0, k), [2.6, -4.4, -1.0], 'Safety', [1, 0, 0], 0.05, undefined, 0.55);
  X('trigger_frame', 'trigger', tmTrigger(k), [0, -6.2, -1.7], 'Trigger', [0, -1, 0], 0.04, undefined, 0.6);
  X('trigger_frame', 'trigger_guard', tmGuard(k), [0, -8.0, -2.4], 'Trigger Guard', [0, -1, 0], 0.07, undefined, 0.4);
  X('trigger_frame', 'pistol_grip', tmPistolGrip(k), [0, -10.6, -7.0], 'Pistol Grip', [0, -1, -0.4], 0.1, undefined, 0.35);
  X('frame', 'stock_plate', tmStockPlate(k), [0, -2.0, -10.2], 'Stock Mount', [0, 0, -1], 0.05, undefined, 0.2);
  X('frame', 'stock', tmStock(k), [0, -4.0, -20], 'Walnut Buttstock', [0, -0.1, -1], 0.16, undefined, 0.0);
  X('stock', 'butt_plate', tmButtPlate(k), [0, -8.4, -42.5], 'Butt Plate', [0, 0, -1], 0.06, undefined, 0.4);
  X('butt_plate', 'trap_door', tmTrap(k), [0, -8.4, -43.0], 'Trap Door', [0, 0, -1], 0.035, undefined, 0.7);
  X('stock', 'swivel_butt', swivel('swivel_butt', k, -17.0, -34.5, 1), [0, -17.0, -34.5], 'Sling Swivel', [0, -1, 0], 0.04, undefined, 0.5);
  X('frame', 'rear_sight', tmRearSight(k), [0, 3.9, -6.6], 'Lyman Sight', [0, 1, 0], 0.06, 'optic', 0.4);
  X('frame', 'bolt', tmBolt(k), [0, 2.6, 9.6], 'Cocking Knob', [0, 1, 0], 0.07, undefined, 0.3);
  X('frame', 'barrel', tmBarrel(k), [0, 0, 14], 'Finned Barrel', [0, 0, 1], 0.14, undefined, 0.2);
  X('barrel', 'barrel_collar', tmCollar(k), [0, 0, 14], 'Barrel Collar', [0, 0, -1], 0.03, undefined, 0.6);
  X('barrel', 'front_sight', tmFrontSight(k), [0, 1.3, TM_BARREL_END - 1.4], 'Front Sight', [0, 1, 0], 0.04, undefined, 0.6);
  X('barrel', 'foregrip_clamp', tmClamp(k), [0, -1.9, 26.6], 'Foregrip Clamp', [0, -1, 0], 0.04, undefined, 0.45);
  X('foregrip_clamp', 'foregrip', tmForegrip(k), [0, -8.5, 26.4], 'Vertical Foregrip', [0, -1, 0], 0.07, undefined, 0.55);
  X('frame', 'drum', dr.m, dc, big ? 'C-Drum (100)' : 'L-Drum (50)', [0, -1, 0.1], 0.12, 'mag', 0.1, true);
  X('drum', 'drum_key', drumKeyLocal(big, k), dc, 'Winding Key', [1, 0, 0], 0.05, 'mag', 0.5);
  let muzzleZ = TM_BARREL_END + 0.3;
  if (a.muzzle === 'cutts') {
    X('barrel', 'compensator', tmCutts(k), [0, 0, TM_BARREL_END + 0.2], 'Cutts Compensator', [0, 0, 1], 0.07, 'muzzle', 0.45);
    muzzleZ = TM_BARREL_END + 7.2;
  } else if (a.muzzle === 'suppressor') {
    X('barrel', 'suppressor', tmSuppressor(k), [0, 0, TM_BARREL_END - 1], 'Suppressor', [0, 0, 1], 0.09, 'muzzle', 0.45);
    muzzleZ = TM_BARREL_END + 16.4;
  }
  if (a.scope) {
    X('frame', 'scope_ring_r', tmScopeRing(-4.0, k), [0, 4.4, -4.0], 'Scope Ring (Rear)', [0, 1, -0.2], 0.05, 'optic', 0.35);
    X('frame', 'scope_ring_f', tmScopeRing(9.0, k), [0, 4.4, 9.0], 'Scope Ring (Front)', [0, 1, 0.2], 0.05, 'optic', 0.35);
    X('frame', 'scope', tmScope(k), [0, 6.2, 3.0], 'Brass Scope', [0, 1, 0], 0.1, 'optic', 0.55);
  }
  if (a.laser) X('barrel', 'laser', tmLaser(k), [-1.6, -0.6, 33.0], 'Laser Sight', [-1, 0, 0], 0.06, 'under', 0.4);
  const sockets: Record<string, SocketSpec> = {
    muzzle: b.sock('frame', [0, 0, muzzleZ + 0.4]),
    grip_l: b.sock('frame', [0.5, -8.6, 26.4]),
    ejector: b.sock('frame', [-2.8, 0.6, 5.7]),
    bolt_knob: b.sock('bolt', [0, 4.6, 9.6]),
    drum_l: b.sock('drum', [dc[0] + dr.W + 1.6, dc[1], dc[2]]),
    butt: b.sock('frame', [0, -7, -42]),
  };
  if (a.scope) sockets.scope = b.sock('frame', [0, 6.2, -11.6]);
  if (a.laser) sockets.laser = b.sock('frame', [-2.8, -1.2, 36.3]);
  return {
    name: `tommy_${a.drum}_${a.muzzle}_${a.scope ? 's' : ''}${a.laser ? 'l' : ''}${lod === 'hd' ? '' : '_' + lod}`,
    voxelSize: gunVS('long', lod),
    parts: b.parts,
    sockets,
    meta: { muzzle: b.at('frame', [0, 0, muzzleZ + 0.4]), length: (42 + muzzleZ) / 100, gunKind: 'tommy', att: a, lod, drumCenter: b.at('frame', dc), drumR: dr.R, explode: b.explode, components: b.components, gripOffset: [0, 0, 0] },
  };
}

// =============================================================================== small hand items
/** a 12-gauge shell: red paper hull with its crimp, brass head with rim and primer (pivot at its middle, axis +Z) */
export function shotgunShellModel(lod: GunLod = 'hd') {
  const k = gunK('long', lod);
  const m = once(`item:shell:${k}`, () => {
    const s = sc('shell', k);
    lathe(s, 0, 0, -1.6, 2.6, (z) => (z > 2.2 ? 1.0 - (z - 2.2) * 0.6 : 1.02), hullMat(SHELL_RED), {});
    lathe(s, 0, 0, -3.4, -1.6, (z) => (z < -3.15 ? 1.2 : 1.12), brassMat(1), { flags: MET });
    s.region([-1.3, -1.3, -3.55], [1.3, 1.3, -3.3], (x, y) => Math.hypot(x, y) < 0.36, 0xc06a3a, { mode: 'paint', flags: MET });
    s.region([-1, -1, 2.3], [1, 1, 2.7], (x, y) => Math.abs(Math.sin(Math.atan2(y, x) * 3)) < 0.3, 0x7a2218, { mode: 'paint', flags: 0 });
    return finishPart(s.m, k, { relief: false });
  });
  return { model: m, voxelSize: gunVS('long', lod), pivot: [0, 0, 0] as V3 };
}

/** a cartridge cluster for weapon-upgrade blueprints (tip colour by upgrade) */
export function cartridgeTrio(tip: number, lod: GunLod = 'hd') {
  const k = gunK('long', lod);
  const m = once(`item:carts:${tip}:${k}`, () => {
    const s = sc('cartridges', k);
    const at: V3[] = [[-2.4, 0, 0], [0, 0.4, 0.8], [2.4, 0, -0.2]];
    at.forEach(([x, y, z], i) => {
      const bm = brassMat(i);
      lathe(s, x, y, z - 4.6, z + 1.5, (zz) => (zz < z - 4.3 ? 1.25 : zz < z - 3.9 ? 1.0 : 1.1), bm, { flags: MET });
      lathe(s, x, y, z + 1.5, z + 4.3, (zz) => 1.02 - Math.pow((zz - z - 1.5) / 2.8, 1.8) * 0.75, i === 1 ? tip : mix(tip, 0xffffff, 0.12), { flags: i === 1 ? VF.EMISSIVE : 0 });
      s.region([x - 0.5, y - 0.5, z - 4.75], [x + 0.5, y + 0.5, z - 4.5], (xx, yy) => Math.hypot(xx - x, yy - y) < 0.38, 0xc06a3a, { mode: 'paint', flags: MET });
    });
    return finishPart(s.m, k);
  });
  return { model: m, voxelSize: gunVS('long', lod), pivot: [0, 0, 0] as V3 };
}

/** the six-shooter's under-barrel laser: a band round the barrel, a hanger and the brass emitter (pivot at the emitter's clamp, beam along +Z) */
export function revolverLaserModel(lod: GunLod = 'hd') {
  const k = gunK('revolver', lod);
  const m = once(`item:revlaser:${k}`, () => {
    const s = sc('rev_laser', k);
    // the band round the barrel (barrel axis 6.0 cm above the pivot, radius 1.6)
    ring(s, 0, 6.0, -0.6, 0.6, 1.6, 2.05, BLUED_L.base, { flags: MET });
    s.rbox([0.45, 3.3, 0], [0.42, 1.9, 0.5], 0.15, BLUED_L.base, { flags: MET });
    s.rbox([0.6, 4.4, 0], [0.18, 0.5, 0.3], 0.06, BLUED_L.worn, { flags: MET });
    s.rbox([0.2, 1.35, 0], [1.0, 0.3, 1.3], 0.12, BLUED_L.shade, { flags: MET });
    lathe(s, 0, 0, -2.6, 2.6, (z) => 1.05 - fil(Math.min(z + 2.6, 2.6 - z), 0.35), brassMat(3), { flags: MET });
    ring(s, 0, 0, 2.15, 2.65, 0.55, 1.0, BLUED_L.hi, { flags: MET });
    s.ell([0, 0, 2.7], [0.58, 0.58, 0.35], LASER_RED, { flags: VF.EMISSIVE | VF.GLOW });
    s.cap([1.0, 0, -1.2], [1.3, 0, -1.2], 0.28, 0.28, 0x222226, {});
    return finishPart(s.m, k);
  });
  return { model: m, voxelSize: gunVS('revolver', lod), pivot: [0, 0, 0] as V3, lens: [0, 0, 2.9 * k] as V3 };
}

/** the moon-clip speedloader: a stamped six-point steel clip holding six brass rounds nose up (centre-bottom pivot) */
export function speedloaderModel(lod: GunLod = 'hd') {
  const k = gunK('revolver', lod);
  const m = once(`item:loader:${k}`, () => {
    const s = sc('speedloader', k);
    const PRc = 2.2, CRc = 0.86;
    // the clip: a thin stamped star with a hole at its heart
    s.region([-3.6, 0, -3.6], [3.6, 0.3, 3.6], (x, y, z) => {
      const a = Math.atan2(z, x), r = Math.hypot(x, z);
      return y < 0.26 && r > 0.55 && r < 2.75 + 0.55 * Math.cos(a * 6);
    }, (x, y, z) => (fract(Math.atan2(z, x) / (PI / 3) + 0.5) < 0.08 ? 0x6a6c70 : 0x8a8c90), { flags: MET });
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * PI * 2, cx = Math.cos(a) * PRc, cz = Math.sin(a) * PRc;
      // rim, case, a lead round-nose; one case is dented
      s.region([cx - 1.1, 0, cz - 1.1], [cx + 1.1, 7.2, cz + 1.1], (x, y, z) => {
        const r = Math.hypot(x - cx, z - cz);
        const dent = i === 2 && y > 2.5 && y < 3.4 && (x - cx) * Math.cos(a) + (z - cz) * Math.sin(a) > 0.6;
        if (y < 0.3) return r < CRc + 0.2;
        if (y < 4.6) return r < CRc - (dent ? 0.2 : 0);
        const u = (y - 4.6) / 2.4;
        return u <= 1 && r < (CRc - 0.06) * Math.sqrt(Math.max(0, 1 - u * u * 0.95));
      }, (x, y, z) => (y >= 4.6 ? (Math.hypot(x - cx, z - cz) < 0.3 ? LEAD.hi : LEAD.base) : y < 0.3 ? 0x9a7024 : brassMat(i)(x, y, z)), { flags: MET });
    }
    return finishPart(s.m, k);
  });
  return { model: m, voxelSize: gunVS('revolver', lod), pivot: 'bottom' as const };
}

/** a prospector's short shovel: D-grip at the pivot, shaft along +Z, spade blade at the far end */
export function shovelModel(lod: GunLod = 'hd') {
  const k = gunK('long', lod);
  const m = once(`item:shovel:${k}`, () => {
    const s = sc('shovel', k);
    const W = walnut({ dir: [0, 0, 1], seed: 21, dark: 0.1 });
    s.region([-0.7, -4.0, -4.6], [0.7, 4.0, 1.0], (x, y, z) => {
      const r = Math.hypot(y / 1.15, z + 1.8);
      return Math.abs(x) <= 0.6 && r <= 3.0 && r >= 2.0 && z <= 0.6;
    }, ...lz(W));
    s.cap([0, -2.6, 0.4], [0, 2.6, 0.4], 0.6, 0.6, ...lz(walnut({ dir: [0, 1, 0], seed: 22 })));
    s.cap([0, 0, 0.6], [0, 0, 46], 1.05, 1.15, ...lz(W));
    lathe(s, 0, 0, 44, 50, (z) => lerp(1.35, 1.55, (z - 44) / 6), (x, y, z) => (fract(z * 1.2) < 0.15 ? 0x4e545c : 0x6a7078), { flags: MET });
    s.region([-6, -2.4, 48], [6, 2.4, 68], (x, y, z) => {
      const t = (z - 49) / 18;
      const hw = 5.2 - Math.pow(Math.max(0, t - 0.55), 2) * 14;
      const dish = -0.9 + (x / 5.2) ** 2 * 1.4;
      return t >= 0 && t <= 1 && Math.abs(x) <= hw && Math.abs(y - dish) <= 0.45;
    }, (x, y, z) => (z > 64 || Math.abs(x) > 4.4 ? 0xb8bcc4 : z > 52 ? 0x6e747e : 0x5a6068), { flags: MET });
    s.rbox([0, -0.2, 50.5], [1.6, 0.9, 1.6], 0.4, 0x6a7078, { flags: MET });
    for (const z of [50.0, 51.2]) s.ell([0, 0.75, z], [0.3, 0.2, 0.3], 0xa8acb4, { flags: MET }); // rivets
    return finishPart(s.m, k);
  });
  return { model: m, voxelSize: gunVS('long', lod), pivot: [0, 0, 0] as V3 };
}
