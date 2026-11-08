// Sundown's six-shooter: a single-action Army revolver, sculpted in design
// centimetres (at the hand's cartoon scale, about 1.6x a real Colt), built at
// 1/512 m ('hd') with a 1/256 m stand-in ('lo') for when it is sub-pixel.
//
// Every component is its own rig part (labels, slots and exploded-view vectors
// in meta.components / meta.explode):
//   frame (root, pivot = grip centre): the case-hardened receiver: rear housing
//     with the hammer slot, recoil shield, top strap with the sight groove,
//     bottom strap, front lug and barrel-shank collar
//   barrel > front_sight, rear_sight
//   cylinder (pivot = its axis, spins on Z), base_pin, pin_latch
//   ejector_housing > ejector_rod, housing_screw
//   hammer (pivot = hammer screw; negative X rotation cocks it)
//   trigger, trigger_guard, loading_gate
//   grip_frame (backstrap + front strap), grip_l / grip_r panels
//     (> medallion_l / _r: gold medallion, gold scarab or brass escutcheon)
//   screw_hammer, screw_bolt, screw_trigger (left flank), screw_bs_l / _r
//   scope, scope_ring_r, scope_ring_f when sighted with the scope
// Gun points along +Z, top is +Y, its right flank is -X. meta.muzzle /
// meta.ejector / meta.cylinderCenter are frame voxel coords. The frame's voxel
// origin is placed so the old laser spot (0.5, 0.6, 10.5), which a few display
// modules hard-code, still lands under the barrel (it is also socket `laser`).
import type { VoxelModel } from '../../../engine/voxel/VoxelModel';
import { VF } from '../../../engine/voxel/VoxelModel';
import type { RigSpec, V3 } from '../../../engine/voxel/Rig';
import { Sc, clamp, lerp, sstep, spline } from './sculpt';
import {
  GunLod, gunK, gunVS, MET, PI, fract, fil, BLUED, GOLD, LEAD, COPPER, LENS, VENOM, BORE,
  blued, caseHardened, walnut, brassMat, goldMat, jiggedBone, agedBone, ivoryMat, lapisMat,
  lathe, ring, lz, finishPart, gunWear, once, compose, thick, GunRigBuilder,
} from './gunkit';

export interface GunParts {
  barrel: 'standard' | 'long' | 'snub' | 'serket';
  cylinder: 'standard' | 'venom' | 'gold' | 'bone';
  grip: 'wood' | 'bone' | 'ivory' | 'scarab';
  sight: 'none' | 'iron' | 'scope';
}
export const DEFAULT_GUN: GunParts = { barrel: 'standard', cylinder: 'standard', grip: 'wood', sight: 'iron' };
/** close-up voxel size (the sub-pixel stand-in is gunVS('revolver', 'lo')) */
export const REVOLVER_VOXEL = gunVS('revolver', 'hd');

// ------------------------------------------------------------------ layout (design cm, origin = grip pivot)
const YB = 15.6; // bore axis
const RB = 1.6; // barrel radius
const YC = 13.4, ZC = 10.2, RC = 3.7, HC = 3.5; // cylinder axis, centre, radius, half length
const PR = 2.2, CR = 0.86; // chamber pitch radius, chamber radius
const Z_SHIELD = ZC - HC - 0.2; // recoil-shield face
const Z_LUG = ZC + HC + 0.2; // frame front lug
const HINGE: V3 = [0, 13.0, 2.6]; // the hammer screw
const MZ: Record<GunParts['barrel'], number> = { standard: 39.6, long: 52.1, snub: 29.2, serket: 41.7 };
const EJ_END: Record<GunParts['barrel'], number> = { standard: 31.5, long: 38.5, snub: 0, serket: 33.0 };
/** the spot under the barrel where the laser clamps (the old 1/48 frame's (0.5, 0.6, 10.5)) */
const LASER_AT: V3 = [0, 9.583, 28.125];
const SCOPE_BASE: V3 = [0, 18.6, 8.0];
/** the ejector housing axis (lower right of the barrel) */
const EJX = -1.42, EJY = 13.78, EJR = 0.85;
/** integer voxel offset of the frame so LASER_AT sits at frame voxel (≈0.5, 0.6, 10.5) */
const frameOff = (k: number): V3 => [0, Math.round(0.6 - LASER_AT[1] * k), Math.round(10.5 - LASER_AT[2] * k)];

// grip loft: a raked plow handle from T0 (top, under the frame) to T1 (the butt)
const T0: V3 = [0, 7.9, 2.15], T1: V3 = [0, -9.7, -2.65];
const GL = Math.hypot(T1[1] - T0[1], T1[2] - T0[2]);
const GA: V3 = [0, (T1[1] - T0[1]) / GL, (T1[2] - T0[2]) / GL];
const GF: V3 = [0, GA[2], -GA[1]]; // forward, perpendicular to the grip
const gHD = (t: number) => lerp(2.6, 3.3, sstep(t * 1.05));
const gHW = (t: number) => 1.92 + 0.38 * Math.sin(Math.min(1, t * 1.15) * PI * 0.62);
/** the plow handle's heel: the back of the grip swells out toward the butt */
const gVC = (t: number) => -0.42 * sstep((t - 0.25) / 0.75);
/** grip-local: s along the grip from its top, v front(+) / back(-) of its centre line */
const gloc = (y: number, z: number) => {
  const dy = y - T0[1], dz = z - T0[2];
  const s = dy * GA[1] + dz * GA[2];
  return { s, v: dy * GF[1] + dz * GF[2] - gVC(clamp(s / GL, 0, 1)) };
};
const gpt = (s: number, v: number): V3 => {
  const vv = v + gVC(clamp(s / GL, 0, 1));
  return [0, T0[1] + GA[1] * s + GF[1] * vv, T0[2] + GA[2] * s + GF[2] * vv];
};
/** the grip panels' outer surface */
const gripIn = (x: number, y: number, z: number, grow = 0) => {
  if (y > 6.2 && Math.abs(x) > 1.7) return false;
  const { s, v } = gloc(y, z);
  if (s < -0.6 || s > GL) return false;
  const t = s / GL, bot = GL - s;
  const hd = gHD(t) - fil(bot, 1.5) + grow, hw = gHW(t) - fil(bot, 0.8) + grow;
  return Math.pow(Math.abs(x) / hw, 2.4) + Math.pow(Math.abs(v) / hd, 2.4) <= 1;
};
const MED_S = 8.4; // where the panel ornaments sit along the grip

const CASE = caseHardened(4);
const BLUE = blued();
const SEAM = 0x1c1a1c;
const darker = (c: (x: number, y: number, z: number) => number, f: number) => (x: number, y: number, z: number) => {
  const v = c(x, y, z);
  return ((((v >> 16) & 255) * f) << 16) | ((((v >> 8) & 255) * f) << 8) | ((v & 255) * f);
};
const KNURL = darker(CASE, 0.7);
const segDist = (x: number, y: number, ax: number, ay: number, bx: number, by: number) => {
  const dx = bx - ax, dy = by - ay, t = clamp(((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy), 0, 1);
  return Math.hypot(x - ax - dx * t, y - ay - dy * t);
};
const sc = (name: string, k: number) => new Sc(name, k);
const gateIn = (x: number, y: number, z: number) => x < 0 && y > 10.9 && y < 13.5 && z > 4.9 && z < 6.45 && Math.hypot(x, y - YC) <= 4.12 && Math.hypot(x, y - YC) >= 3.2;

// =============================================================================== the frame
function frameModel(k: number): VoxelModel {
  return once(`rev:frame:${k}`, () => {
    const s = sc('frame', k);
    const C = lz(CASE, MET);
    // rear housing (the hammer's seat): its top sweeps down into the backstrap
    const topR = (z: number) => 15.0 + 2.2 * sstep((z + 0.8) / 5.6);
    s.region([-1.8, 5.9, -0.9], [1.8, 17.4, 5.5], (x, y, z) => {
      const top = topR(z);
      if (y > top || y < 6.0 || z < -0.8 || z > 5.4) return false;
      return Math.abs(x) <= 1.75 - fil(Math.min(top - y, z + 0.8), 0.55) - fil(y - 6.0, 0.3);
    }, ...C);
    // recoil shield: a disc behind the cylinder, flaring out of the housing
    lathe(s, 0, YC, 3.0, Z_SHIELD, (z) => (z < 5.3 ? lerp(1.9, 3.95, sstep((z - 3.0) / 2.3)) : 3.95 - fil(Z_SHIELD - z, 0.22)), ...C);
    // bottom strap under the cylinder window
    s.rbox([0, 8.7, 9.6], [1.85, 0.8, 5.0], 0.5, ...C);
    // top strap, easing down into the barrel shank
    s.region([-1.5, 17.2, 5.2], [1.5, 18.7, 15.5], (x, y, z) => {
      const top = 18.6 - 0.85 * sstep((z - 13.4) / 2.0);
      if (y < 17.3 || y > top || z < 5.3 || z > 15.4) return false;
      return Math.abs(x) <= 1.45 - fil(top - y, 0.55);
    }, ...C);
    // front lug: under the shank, its belly sloping up to the barrel
    s.region([-1.9, 7.8, Z_LUG], [1.9, 17.4, 17.35], (x, y, z) => {
      const bot = lerp(7.95, 11.4, sstep((z - Z_LUG) / 3.4));
      if (y < bot || y > 17.35 || z > 17.3) return false;
      return Math.abs(x) <= 1.85 - fil(Math.min(y - bot, 17.3 - z), 0.6);
    }, ...C);
    lathe(s, 0, YB, Z_LUG, 17.6, (z) => 2.1 - fil(17.6 - z, 0.4), ...C);
    // bores the separate parts sit in: barrel thread, base pin, ejector-housing seat
    const holes = (x: number, y: number, z: number) => (z > 15.9 && Math.hypot(x, y - YB) < RB - 0.05) || (z > Z_LUG - 0.1 && Math.hypot(x, y - YC) < 0.5) || (z > Z_LUG && Math.hypot(x - EJX, y - EJY) < EJR - 0.05);
    s.region([-2.3, 11.5, Z_LUG - 0.2], [1.7, 17.4, 17.7], holes, 0, { mode: 'carve' });
    // the hammer slot (open on top, the grip frame closes it at the rear) and its dark walls
    const slot = (x: number, y: number, z: number) => Math.abs(x) < 0.62 && y > 12.2 && z < 5.05 && z > -1.0;
    s.region([-0.7, 12.0, -1.1], [0.7, 19.5, 5.1], slot, 0, { mode: 'carve' });
    // sight groove along the top strap
    s.region([-0.34, 18.25, 4.8], [0.34, 18.8, 14.6], (x, y) => Math.abs(x) < 0.33 && y > 18.3, 0, { mode: 'carve' });
    // the loading gate's window in the right of the shield; screw holes in the left flank
    s.region([-4.3, 10.8, 4.8], [-2.4, 13.6, 6.6], gateIn, 0, { mode: 'carve' });
    resolveSlotWalls(s, slot);
    // the firing-pin hole in the shield, in line with the bore
    s.region([-0.4, YB - 0.4, Z_SHIELD - 0.6], [0.4, YB + 0.4, Z_SHIELD + 0.1], (x, y) => Math.hypot(x, y - YB) < 0.3, BORE, { mode: 'paint', flags: MET });
    return finishPart(s.m, k);
  });
}
function resolveSlotWalls(s: Sc, slot: (x: number, y: number, z: number) => boolean) {
  s.walls([-1.4, 11.5, -1.5], [1.4, 19.5, 5.6], slot, KNURL, MET);
}

/** the loading gate: a curved leaf on the shield, outlined, its thumb lip knurled; the hinge tab reaches into the frame */
function gateModel(k: number) {
  return once(`rev:gate:${k}`, () => {
    const s = sc('loading_gate', k);
    s.region([-4.3, 10.8, 4.8], [-2.4, 13.6, 6.6], gateIn, (x, y, z) => {
      if (y < 11.15 || y > 13.25 || z > 6.25) return SEAM;
      return z < 5.35 && fract(y * 1.3) < 0.5 ? KNURL(x, y, z) : CASE(x, y, z);
    }, { flags: MET });
    s.rbox([-2.9, 11.3, 5.7], [0.5, 0.35, 0.5], 0.15, CASE, { flags: MET });
    return finishPart(s.m, k);
  });
}

// =============================================================================== barrel group
function barrelModel(kind: GunParts['barrel'], k: number) {
  return once(`rev:barrel:${kind}:${k}`, () => {
    const s = sc('barrel', k);
    const o = { flags: MET };
    const mz = MZ[kind], z0 = 15.9;
    const rb = kind === 'snub' ? RB + 0.1 : RB;
    lathe(s, 0, YB, 17.55, mz, (z) => rb + 0.06 * (1 - (z - z0) / (mz - z0)) - fil(mz - z, 0.3), ...lz(BLUE, MET));
    // the threaded shank that screws into the frame
    lathe(s, 0, YB, z0, 17.6, (z) => rb - 0.12 - (fract(z * 2.6) < 0.4 ? 0.08 : 0), BLUED.shade, o);
    // the bore, a real hole: six-groove rifling showing just inside the crown
    const bore = (x: number, y: number, z: number) => Math.hypot(x, y - YB) <= 0.66 && z > mz - 4.5;
    s.region([-0.8, YB - 0.8, mz - 4.6], [0.8, YB + 0.8, mz + 0.3], bore, 0, { mode: 'carve' });
    s.walls([-1.2, YB - 1.2, mz - 5], [1.2, YB + 1.2, mz + 0.5], bore, (x, y, z) => (z > mz - 1.2 && fract((Math.atan2(y - YB, x) / (2 * PI)) * 6 + z * 0.15) < 0.35 ? 0x2a2e36 : BORE), MET);
    if (kind === 'long') for (const z of [30.0, 44.0]) ring(s, 0, YB, z, z + 0.8, rb - 0.2, rb + 0.14, brassMat(z), o);
    if (kind === 'serket') {
      // a scorpion's tail laid along the top: amber chitin segments shrinking toward the muzzle
      const N = 7, zs = 18.0, ze = mz - 1.8;
      for (let i = 0; i < N; i++) {
        const t = i / (N - 1), za = lerp(zs, ze, i / N), zb = lerp(zs, ze, (i + 1) / N);
        const rx = lerp(0.78, 0.46, t), ry = lerp(0.62, 0.42, t), cz = (za + zb) / 2, hz = (zb - za) / 2 + 0.12;
        s.ell([0, YB + rb + ry * 0.35, cz], [rx, ry, hz], (x, y, z) => {
          const u = (z - cz) / hz;
          if (u > 0.78) return 0x4a2410; // joint
          if (Math.abs(x) < 0.06 + 0.5 / k && u < 0.5) return 0x6a3414; // dorsal keel line
          return y > YB + rb + ry * 0.75 ? 0xd8903e : u < -0.4 ? 0x8a4c1c : 0xb06a2a;
        }, o);
      }
      // venom inlay down both flanks
      s.region([-rb - 0.2, YB - 0.4, 18], [rb + 0.2, YB + 0.4, mz - 2], (x, y) => Math.abs(y - YB) < thick(0.26, k) && Math.abs(x) > rb - 0.45, VENOM.base, { mode: 'paint', flags: VF.EMISSIVE | MET });
    }
    return finishPart(s.m, k, { wear: gunWear((c) => (c === 0xd8903e || c === 0xb06a2a ? 0xf0b060 : null)) });
  });
}
function frontSightModel(kind: GunParts['barrel'], k: number) {
  return once(`rev:fsight:${kind}:${k}`, () => {
    const s = sc('front_sight', k);
    const mz = MZ[kind], rb = kind === 'snub' ? RB + 0.1 : RB, top = YB + rb;
    if (kind === 'serket') {
      // the stinger is the front sight: a hooked barb with a venom drop at its tip
      const ze = mz - 1.8;
      const sting = spline([[0, top + 0.1, ze - 0.4], [0, top + 1.0, ze + 0.5], [0, top + 1.45, ze + 1.15], [0, top + 1.1, ze + 1.65]], 8);
      s.sweep(sting, (t) => [thick(0.42 - t * 0.22, k), thick(0.4 - t * 0.22, k), thick(0.4 - t * 0.2, k)], (x, y, z) => (z > ze + 1.2 ? VENOM.base : 0x6a3414), 0.08, { flags: MET });
      s.ell([0, top + 1.05, ze + 1.7], [thick(0.16, k), thick(0.2, k), thick(0.16, k)], VENOM.hi, { flags: VF.EMISSIVE });
    } else {
      const w = thick(0.3, k);
      s.region([-w, top - 0.4, mz - 2.1], [w, top + 1.0, mz - 0.4], (x, y, z) => {
        const u = (z - (mz - 2.05)) / 1.6; // 0 rear .. 1 front
        const h = 0.95 - 0.4 * sstep((u - 0.45) / 0.55);
        return u >= 0 && u <= 1 && Math.abs(x) <= w && y >= top - 0.4 && y <= top + h - fil(Math.min(u, 1 - u) * 1.6, 0.18);
      }, BLUE, { flags: MET });
      // the blade's dovetail base
      s.rbox([0, top - 0.05, mz - 1.25], [0.62, 0.22, 0.75], 0.12, BLUED.shade, { flags: MET });
    }
    return finishPart(s.m, k);
  });
}
function rearSightModel(k: number) {
  return once(`rev:rsight:${k}`, () => {
    const s = sc('rear_sight', k);
    for (const sx of [-1, 1]) s.rbox([sx * 0.66, 18.6, 5.75], [thick(0.32, k), 0.42, 0.4], 0.16, CASE, { flags: MET });
    s.rbox([0, 18.35, 5.75], [1.0, 0.2, 0.42], 0.1, CASE, { flags: MET });
    return finishPart(s.m, k);
  });
}
/** ejector housing: a tube along the lower right of the barrel, webbed to it, its slot open to the right */
function housingModel(kind: GunParts['barrel'], k: number) {
  const ez = EJ_END[kind];
  if (!ez) return null;
  return once(`rev:housing:${kind}:${k}`, () => {
    const s = sc('ejector_housing', k);
    const B = lz(BLUE, MET);
    s.cap([EJX, EJY, 14.0], [EJX, EJY, ez - EJR], EJR, EJR, ...B);
    s.region([-1.8, 13.2, 17.6], [0.2, 15.6, ez - 0.4], (x, y) => segDist(x, y, 0, YB, EJX, EJY) <= 0.62 && Math.hypot(x, y - YB) > RB - 0.02, ...B);
    // the housing's bore (where the rod lives) and the slot the rod head rides in
    const bore = (x: number, y: number, z: number) => Math.hypot(x - EJX, y - EJY) < 0.36 && z < ez - 1.2;
    s.region([EJX - 0.5, EJY - 0.5, 13.8], [EJX + 0.5, EJY + 0.5, ez - 1.1], bore, 0, { mode: 'carve' });
    const slot = (x: number, y: number, z: number) => z > 18.2 && z < ez - 1.9 && x < EJX && Math.hypot(x - EJX, y - EJY) > 0.2 && Math.abs(y - EJY - (x - EJX) * 0.35) < 0.26;
    s.region([EJX - 1, EJY - 1, 18], [EJX, EJY + 1, ez - 1.8], slot, 0, { mode: 'carve' });
    resolveWalls(s, [EJX - 1.2, EJY - 1.2, 13.6], [EJX + 1.2, EJY + 1.2, ez], (x, y, z) => slot(x, y, z) || bore(x, y, z), BLUED.dark);
    return finishPart(s.m, k);
  });
}
function resolveWalls(s: Sc, lo: V3, hi: V3, hole: (x: number, y: number, z: number) => boolean, col: number) {
  s.walls(lo, hi, hole, col, MET);
}
/** the ejector rod: a thin rod in the housing, its crescent thumb head out through the slot */
function rodModel(kind: GunParts['barrel'], k: number) {
  const ez = EJ_END[kind];
  if (!ez) return null;
  return once(`rev:rod:${kind}:${k}`, () => {
    const s = sc('ejector_rod', k);
    s.cap([EJX, EJY, 14.4], [EJX, EJY, ez - 1.6], thick(0.3, k), thick(0.3, k), BLUED.hi, { flags: MET });
    const hz = ez - 2.6;
    s.cap([EJX, EJY, hz], [EJX - EJR - 0.1, EJY - 0.36, hz], thick(0.26, k), thick(0.3, k), BLUED.base, { flags: MET });
    s.ell([EJX - EJR - 0.1, EJY - 0.36, hz], [0.36, 0.55, 0.6], (x, y, z) => (Math.hypot(y - EJY + 0.36, z - hz) < 0.24 ? BLUED.dark : Math.hypot(y - EJY + 0.36, z - hz) < 0.36 ? BLUED.worn : BLUED.hi), { flags: MET });
    return finishPart(s.m, k);
  });
}

// =============================================================================== small hardware
/** a slotted screw along X: domed head on the face at c, its threaded shank running into the part */
function screwModel(name: string, k: number, c: V3, sx: number, r: number, len: number, col = BLUED.base, slotA = 0.6) {
  return once(`rev:screw:${name}:${k}`, () => {
    const s = sc(name, k);
    const t = Math.max(0.24, 0.9 / k);
    s.region([c[0] - t, c[1] - r, c[2] - r], [c[0] + t, c[1] + r, c[2] + r], (x, y, z) => {
      const d = Math.hypot(y - c[1], z - c[2]);
      return d <= r && (x - c[0]) * sx <= t * (1 - (d / r) ** 2 * 0.55) && (x - c[0]) * sx >= -t;
    }, col, { flags: MET });
    s.cap([c[0] - sx * 0.1, c[1], c[2]], [c[0] - sx * len, c[1], c[2]], r * 0.55, r * 0.5, (x) => (fract(x * sx * 3.2) < 0.4 ? BLUED.shade : BLUED.hi), { flags: MET });
    if (r * k >= 1.6) {
      const ca = Math.cos(slotA), sa = Math.sin(slotA);
      s.region([c[0] - t, c[1] - r, c[2] - r], [c[0] + t, c[1] + r, c[2] + r], (x, y, z) => {
        const u = (y - c[1]) * ca + (z - c[2]) * sa, v = -(y - c[1]) * sa + (z - c[2]) * ca;
        return (x - c[0]) * sx > -0.05 && Math.abs(v) < Math.max(0.09, 0.6 / k) && Math.abs(u) < r * 0.85;
      }, 0x262a32, { mode: 'paint', flags: MET });
    }
    return finishPart(s.m, k, { relief: false });
  });
}
/** the base pin: a long pin through the frame lug and the cylinder, its knurled head out front */
function basePinModel(k: number) {
  return once(`rev:pin:${k}`, () => {
    const s = sc('base_pin', k);
    lathe(s, 0, YC, Z_SHIELD - 0.15, 18.35, (z) => (z > 17.0 ? 0.52 - fil(18.35 - z, 0.15) : 0.42), (x, y, z) => (z > 17.15 && fract(z * 2.4) < 0.45 ? BLUED.hi : z > 17.0 ? BLUED.base : 0x7e8692), { flags: MET });
    // the cross-latch notch
    s.region([-0.6, YC - 0.6, 15.5], [0.6, YC + 0.6, 16.3], (x, y) => x > 0.2 && Math.hypot(x, y - YC) < 0.6, 0, { mode: 'carve' });
    return finishPart(s.m, k);
  });
}

// =============================================================================== moving parts
/** the fluted cylinder, built round its own axis (pivot at the origin) */
function cylinderModel(kind: GunParts['cylinder'], k: number) {
  return once(`rev:cyl:${kind}:${k}`, () => {
    const s = sc('cylinder', k);
    const hd = k >= 4;
    const flags = kind === 'bone' ? VF.SOLID : MET;
    const body = kind === 'gold' ? goldMat(2) : kind === 'bone' ? agedBone(4) : BLUE;
    const col = kind !== 'gold' ? body : (x: number, y: number, z: number) => {
      // engraved vine bands near both ends
      const a = Math.atan2(y, x), zz = Math.abs(z);
      const e = zz > HC - 1.05 && zz < HC - 0.35 && Math.abs(Math.sin(a * 18) * 0.25 - (zz - (HC - 0.7))) < 0.09;
      return e ? GOLD.dark : body(x, y, z);
    };
    lathe(s, 0, 0, -HC, HC, (z) => RC - fil(HC - z, 0.38) - fil(z + HC, 0.24), ...lz(col, flags));
    // flutes between the chambers
    const FR = RC + 0.42;
    for (let i = 0; i < 6; i++) {
      const a = PI / 2 + PI / 6 + (i * PI) / 3;
      s.cap([Math.cos(a) * FR, Math.sin(a) * FR, -1.35], [Math.cos(a) * FR, Math.sin(a) * FR, 2.05], 0.95, 0.95, 0, { mode: 'carve' });
    }
    const flute = (x: number, y: number, z: number) => {
      const zz = clamp(z, -1.35, 2.05);
      for (let i = 0; i < 6; i++) {
        const a = PI / 2 + PI / 6 + (i * PI) / 3;
        if (Math.hypot(x - Math.cos(a) * FR, y - Math.sin(a) * FR, z - zz) <= 0.95) return true;
      }
      return false;
    };
    const fluteCol = kind === 'venom' ? VENOM.deep : kind === 'bone' ? 0xa9845a : kind === 'gold' ? GOLD.shade : 0x5a6880;
    s.walls([-RC - 1, -RC - 1, -2.6], [RC + 1, RC + 1, 3.2], flute, fluteCol, kind === 'venom' ? VF.EMISSIVE | MET : flags);
    // bolt stops near the rear, in line with each chamber, each with its lead-in groove
    for (let i = 0; i < 6; i++) {
      const a = PI / 2 + (i * PI) / 3, ca = Math.cos(a), sa = Math.sin(a);
      const stop = (x: number, y: number, z: number) => {
        const t = -x * sa + y * ca, r = x * ca + y * sa;
        if (z > -HC + 0.5 && z < -HC + 1.15 && Math.abs(t) < 0.3 && r > RC - 0.34) return true;
        return hd && z > -HC + 0.8 && z < -HC + 1.0 && t > 0.3 && t < 1.3 && r > RC - 0.12; // lead
      };
      s.region([ca * RC - 1.6, sa * RC - 1.6, -HC + 0.4], [ca * RC + 1.6, sa * RC + 1.6, -HC + 1.2], stop, 0, { mode: 'carve' });
      s.walls([ca * RC - 1.8, sa * RC - 1.8, -HC + 0.2], [ca * RC + 1.8, sa * RC + 1.8, -HC + 1.4], stop, kind === 'bone' ? 0x6a4c2c : BLUED.dark, flags);
    }
    // six loaded chambers: dark mouths, lead round-noses (green-tipped venom rounds), liners on the bone cylinder
    const tip = kind === 'venom' ? VENOM.base : LEAD.base;
    for (let i = 0; i < 6; i++) {
      const a = PI / 2 + (i * PI) / 3, cx = Math.cos(a) * PR, cy = Math.sin(a) * PR;
      if (kind === 'bone') ring(s, cx, cy, HC - 0.5, HC, CR, CR + 0.3, BLUED.shade, { mode: 'paint', flags: MET });
      const ch = (x: number, y: number, z: number) => Math.hypot(x - cx, y - cy) <= CR && z > HC - 1.2;
      s.region([cx - CR, cy - CR, HC - 1.3], [cx + CR, cy + CR, HC + 0.3], ch, 0, { mode: 'carve' });
      s.walls([cx - CR - 0.6, cy - CR - 0.6, HC - 1.6], [cx + CR + 0.6, cy + CR + 0.6, HC + 0.3], ch, BORE, MET);
      s.ell([cx, cy, HC - 1.25], [CR - 0.17, CR - 0.17, 0.78], (x, y, z) => (z > HC - 0.75 && kind === 'venom' ? VENOM.hi : Math.hypot(x - cx, y - cy) < 0.3 ? LEAD.hi : tip), { flags: kind === 'venom' ? VF.EMISSIVE : MET });
      // cartridge heads behind (seen through the loading gate)
      s.region([cx - CR - 0.2, cy - CR - 0.2, -HC - 0.1], [cx + CR + 0.2, cy + CR + 0.2, -HC + 0.42], (x, y) => Math.hypot(x - cx, y - cy) <= CR + 0.12, (x, y) => {
        const r = Math.hypot(x - cx, y - cy);
        return r < 0.32 ? COPPER : r > CR - 0.05 ? 0x9a7024 : 0xd0a040;
      }, { mode: 'paint', flags: MET });
    }
    // ratchet star at the rear, base-pin hole in the front face
    s.region([-1.3, -1.3, -HC - 0.1], [1.3, 1.3, -HC + 0.3], (x, y) => Math.hypot(x, y) < 0.95 + 0.25 * Math.cos(Math.atan2(y, x) * 6), BLUED.shade, { mode: 'paint', flags: MET });
    const pin = (x: number, y: number, z: number) => Math.hypot(x, y) < 0.45 && z > HC - 0.7;
    s.region([-0.6, -0.6, HC - 0.8], [0.6, 0.6, HC + 0.2], pin, 0, { mode: 'carve' });
    s.walls([-1, -1, HC - 1], [1, 1, HC + 0.3], pin, BORE, MET);
    return finishPart(s.m, k);
  });
}

/** the hammer, built round its screw (pivot at the origin): flat body, spur sweeping back to a checkered thumb pad */
function hammerModel(k: number) {
  return once(`rev:hammer:${k}`, () => {
    const s = sc('hammer', k);
    const W = 0.55;
    s.region([-W, -1.1, -1.2], [W, 5.4, 2.3], (x, y, z) => {
      if (Math.hypot(y, z) <= 1.05) return Math.abs(x) <= W;
      const front = y < 3.8 ? 2.25 : 2.25 - (y - 3.8) * 0.9, back = -0.95 + 0.22 * y;
      return y >= -0.6 && y <= 5.3 && z <= front && z >= back && Math.abs(x) <= W - fil(Math.min(front - z, z - back), 0.2);
    }, ...lz(CASE, MET));
    const spur = spline([[0, 4.4, 1.4], [0, 5.5, 0.4], [0, 6.05, -1.1], [0, 6.2, -2.6], [0, 5.85, -3.8]], 8);
    const LC = lz(CASE, MET);
    s.sweep(spur, (t) => [lerp(W, 0.8, sstep((t - 0.35) / 0.4)), lerp(0.8, 0.6, t), 0.7], LC[0], 0.08, LC[1]);
    // firing-pin nose at the hammer's face, in line with the bore
    s.cap([0, YB - HINGE[1], 2.2], [0, YB - HINGE[1], 2.5], 0.26, 0.18, BLUED.worn, { flags: MET });
    // the screw hole through the hub
    s.region([-0.7, -0.4, -0.4], [0.7, 0.4, 0.4], (x, y, z) => Math.hypot(y, z) < 0.3, 0x2a2622, { mode: 'paint', flags: MET });
    // checkering on the thumb pad: two crossing groove sets on top of the spur, in whole voxels
    const P = Math.max(3, Math.round(0.7 * k));
    s.region([-0.95, 5.8, -4.7], [0.95, 7.3, -1.3], (x, y, z) => z < -1.55 && y > 6.12 + (z < -3.3 ? (-3.3 - z) * 0.3 : 0) - 0.05, (x, y, z) => {
      const i = Math.floor(x * k), j = Math.floor(z * k);
      return ((i + j) % P + P) % P === 0 || ((i - j) % P + P) % P === 0 ? 0x2e2a30 : 0x8a8478;
    }, { mode: 'paint', flags: MET });
    return finishPart(s.m, k);
  });
}

/** the trigger: a curved blade on its pivot boss (the boss hides inside the frame) */
function triggerModel(k: number) {
  return once(`rev:trigger:${k}`, () => {
    const s = sc('trigger', k);
    const trig: V3[] = [[0, 8.6, 7.8], [0, 7.6, 7.7], [0, 6.4, 7.6], [0, 5.3, 7.1], [0, 4.7, 6.4]];
    s.sweep(spline(trig, 8), (t) => [thick(0.42 + t * 0.08, k), thick(0.38, k), thick(0.42 - t * 0.04, k)], BLUE, 0.08, { flags: MET });
    // a grooved finger face
    s.region([-0.6, 4.6, 6.0], [0.6, 6.6, 8.2], (x, y, z) => fract(y * 2.2) < 0.3 && z < 7.4 + (y - 6) * 0.3, BLUED.shade, { mode: 'paint', flags: MET });
    s.ell([0, 8.7, 7.8], [0.34, 0.6, 0.6], BLUED.shade, { flags: MET });
    return finishPart(s.m, k);
  });
}
/** the trigger guard: the bow and the plate it screws to the frame by */
function guardModel(k: number) {
  return once(`rev:guard:${k}`, () => {
    const s = sc('trigger_guard', k);
    s.rbox([0, 7.45, 8.6], [1.25, 0.55, 4.6], 0.4, ...lz(BLUE, MET));
    const bow: V3[] = [[0, 7.2, 12.6], [0, 5.6, 12.9], [0, 3.9, 11.6], [0, 3.1, 9.0], [0, 3.4, 6.6], [0, 4.4, 5.0], [0, 5.6, 4.4]];
    s.sweep(spline(bow, 8), () => [thick(0.66, k), thick(0.5, k), thick(0.5, k)], BLUE, 0.08, { flags: MET });
    // the slot the trigger passes through, the two guard screws
    s.region([-0.5, 6.8, 7.0], [0.5, 8.1, 8.4], (x, y, z) => Math.abs(x) < 0.46 && z > 7.1 && z < 8.3, 0, { mode: 'carve' });
    for (const z of [5.0, 12.2]) s.region([-0.5, 6.85, z - 0.5], [0.5, 7.0, z + 0.5], (x, y, zz) => Math.hypot(x, zz - z) < 0.42, BLUED.worn, { mode: 'paint', flags: MET });
    return finishPart(s.m, k);
  });
}
/** the blued grip frame: backstrap (rising to shroud the hammer) and front strap, closing round the heel */
function gripFrameModel(k: number) {
  return once(`rev:gripframe:${k}`, () => {
    const s = sc('grip_frame', k);
    const B = lz(BLUE, MET);
    for (const back of [true, false]) {
      const w = back ? 1.22 : 1.02;
      s.region([-1.3, -10.5, -4.6], [1.3, 9.2, 5.6], (x, y, z) => {
        if (y > 6.4 && !back) return false;
        const { s: g, v } = gloc(y, z);
        if (g < -1.2 || g > GL) return false;
        const t = clamp(g / GL, 0, 1), bot = GL - g;
        const hdd = gHD(t) - fil(Math.max(0, bot), 1.5);
        const vv = back ? -v : v, c = hdd - 0.22;
        return Math.pow(Math.abs(x) / w, 3) + Math.pow(Math.abs(vv - c) / 0.36, 3) <= 1;
      }, ...B);
    }
    const p0 = gpt(0, -(gHD(0) - 0.22));
    s.sweep(spline([p0, [0, 11.0, -0.75], [0, 13.8, -0.7], [0, 15.75, -0.05], [0, 16.5, 1.2]], 8), () => [1.22, 0.42, 0.42], BLUE, 0.1, { flags: MET });
    const pb = gpt(GL - 0.25, 0);
    s.ell([0, pb[1] - 0.1, pb[2]], [1.15, 0.36, gHD(1) - 0.6], ...B);
    return finishPart(s.m, k);
  });
}
/** one grip panel (side +1 = left, -1 = right): checkered walnut, jigged bone, ivory or lapis */
function gripPanel(kind: GunParts['grip'], side: number, k: number) {
  return once(`rev:grip:${kind}:${side}:${k}`, () => {
    const s = sc(side > 0 ? 'grip_l' : 'grip_r', k);
    const field = (y: number, z: number) => {
      const { s: g, v } = gloc(y, z);
      const t = clamp(g / GL, 0, 1);
      return Math.pow(Math.abs(g - MED_S) / 5.4, 4) + Math.pow(Math.abs(v) / (gHD(t) - 1.0), 4);
    };
    let mat: (x: number, y: number, z: number) => number;
    if (kind === 'wood') {
      const w = walnut({ dir: GA, seed: 5 });
      const P = Math.max(3, Math.round(0.85 * k));
      mat = (x, y, z) => {
        if (Math.abs(x) < 1.2) return w(x, y, z);
        const f = field(y, z);
        if (f > 1) return w(x, y, z);
        if (f > 0.74) return f > 0.86 ? 0x22110a : w(x, y, z); // border groove
        const i = Math.floor(y * k), j = Math.floor(z * k);
        const a = ((i + j) % P + P) % P, b2 = ((i - j) % P + P) % P;
        return a === 0 || b2 === 0 ? 0x22110a : a === 1 || b2 === 1 ? 0x5c3620 : 0x4e2c18;
      };
    } else if (kind === 'bone') mat = jiggedBone(2 + side, 0.3);
    else if (kind === 'ivory') mat = ivoryMat();
    else mat = lapisMat(3 + side);
    s.region([side > 0 ? 0 : -2.7, -10.2, -4.4], [side > 0 ? 2.7 : 0, 8.4, 5.6], (x, y, z) => x * side >= 0 && gripIn(x, y, z), ...lz(mat));
    return finishPart(s.m, k);
  });
}
/** the ornament set into a panel: gold medallion (ivory), gold scarab (lapis), brass escutcheon (bone) */
function medallionModel(kind: GunParts['grip'], side: number, k: number) {
  if (kind === 'wood') return null;
  return once(`rev:med:${kind}:${side}:${k}`, () => {
    const s = sc(side > 0 ? 'medallion_l' : 'medallion_r', k);
    const c = gpt(MED_S, 0);
    s.region([-2.9, c[1] - 3, c[2] - 3], [2.9, c[1] + 3, c[2] + 3], (x, y, z) => {
      if (x * side < 1.2 || !gripIn(x, y, z, 0.42)) return false;
      const { s: g, v } = gloc(y, z);
      if (kind === 'bone') return Math.hypot(g - MED_S, v) < 0.62;
      if (kind === 'ivory') return ((g - MED_S) / 1.25) ** 2 + (v / 0.95) ** 2 <= 1;
      return scarab(g - MED_S, v) > 0;
    }, (x, y, z) => {
      const { s: g, v } = gloc(y, z);
      if (kind === 'bone') return Math.abs((g - MED_S) * 0.8 + v * 0.6) < 0.1 ? 0x5e4214 : 0xd8b04a;
      if (kind === 'ivory') {
        const r = Math.hypot((g - MED_S) / 1.25, v / 0.95), a = Math.atan2(v, g - MED_S);
        return r < 0.62 * (0.62 + 0.38 * Math.cos(a * 5)) ? GOLD.hi : r > 0.82 ? GOLD.shade : GOLD.base;
      }
      return scarab(g - MED_S, v) > 1 ? GOLD.shade : GOLD.base;
    }, { flags: MET });
    return finishPart(s.m, k, { relief: false });
  });
}
/** a scarab in grip-panel coords (g along the grip, head toward the frame; v across): 0 = outside, 1 = body, 2 = engraved line */
function scarab(g: number, v: number) {
  const body = (g / 1.55) ** 2 + (v / 1.1) ** 2;
  const head = ((g + 1.85) / 0.55) ** 2 + (v / 0.62) ** 2;
  let leg = false;
  for (const [g0, dg] of [[-0.7, -0.5], [0.05, 0.1], [0.75, 0.55]] as [number, number][]) {
    const u = (Math.abs(v) - 0.95) / 0.75;
    if (u > 0 && u < 1 && Math.abs(g - (g0 + dg * u)) < 0.17) leg = true;
  }
  if (body > 1 && head > 1 && !leg) return 0;
  if (body <= 1 && (Math.abs(v) < 0.12 || Math.abs(g + 0.75) < 0.1 || body > 0.78)) return 2;
  return 1;
}

// =============================================================================== the scope
/** a brass telescope tube (part `scope`) */
function scopeModel(kind: GunParts['barrel'], k: number) {
  return once(`rev:scope:${kind}:${k}`, () => {
    const s = sc('scope', k);
    const B = SCOPE_BASE, mz = MZ[kind];
    const zf = Math.min(mz - 1.0, 33.0), zr = 1.2, ay = B[1] + 2.4;
    const bm = brassMat(9);
    lathe(s, 0, ay, zr, zf, (z) => {
      const rear = sstep((zr + 2.2 - z) / 1.2), front = sstep((z - (zf - 2.6)) / 1.4);
      return 0.9 + rear * 0.32 + front * 0.45 - fil(Math.min(z - zr, zf - z), 0.2);
    }, (x, y, z) => (Math.abs(z - (zr + 2.25)) < 0.18 || Math.abs(z - (zf - 2.65)) < 0.18 ? 0x5e4214 : bm(x, y, z)), { flags: MET });
    for (const [z0, z1, r] of [[zf - 0.3, zf + 0.05, 1.05], [zr - 0.05, zr + 0.3, 0.82]] as [number, number, number][]) s.region([-r, ay - r, z0], [r, ay + r, z1], (x, y) => Math.hypot(x, y - ay) <= r, LENS, { flags: VF.SOFTAO | MET });
    const tz = (zr + zf) / 2 - 1.5;
    s.cap([0, ay + 0.8, tz], [0, ay + 1.75, tz], 0.6, 0.6, (x, y, z) => (y > ay + 1.15 && fract(Math.atan2(z - tz, x) * 2.5) < 0.5 ? 0x9a7024 : bm(x, y, z)), { flags: MET });
    s.cap([0.8, ay, tz], [1.7, ay, tz], 0.55, 0.55, (x, y, z) => (x > 1.3 && fract(Math.atan2(z - tz, y - ay) * 2.5) < 0.5 ? 0x9a7024 : bm(x, y, z)), { flags: MET });
    return finishPart(s.m, k);
  });
}
/** a blued scope ring with its foot and clamp screw; front = on the barrel */
function scopeRingModel(kind: GunParts['barrel'], front: boolean, k: number) {
  return once(`rev:ring:${kind}:${front}:${k}`, () => {
    const s = sc(front ? 'scope_ring_f' : 'scope_ring_r', k);
    const B = SCOPE_BASE, ay = B[1] + 2.4, mz = MZ[kind];
    const zc = front ? Math.min(mz - 4.0, 26.0) : B[2];
    const foot = front ? YB + RB : B[1];
    ring(s, 0, ay, zc - 0.55, zc + 0.55, 0.88, 1.38, BLUE, { flags: MET });
    s.rbox([0, (foot + ay - 1.0) / 2, zc], [0.8, (ay - 1.0 - foot) / 2 + 0.15, 0.5], 0.2, BLUE, { flags: MET });
    if (front) s.region([-1.0, foot - 0.6, zc - 0.5], [1.0, foot + 0.4, zc + 0.5], (x, y) => Math.hypot(x, y - YB) <= RB + 0.35 && Math.hypot(x, y - YB) > RB - 0.02 && y > YB + 0.6, BLUE, { flags: MET });
    s.rbox([1.45, ay, zc], [0.2, 0.42, 0.35], 0.1, BLUED.worn, { flags: MET });
    return finishPart(s.m, k);
  });
}

// =============================================================================== the rig
/** design-space spot (cm from the grip) where the laser clamps under the barrel */
export const REVOLVER_LASER_AT = LASER_AT;

export function revolverRig(gi: Partial<GunParts> = DEFAULT_GUN, lod: GunLod = 'hd'): RigSpec {
  const g: GunParts = { ...DEFAULT_GUN, ...gi };
  const k = gunK('revolver', lod);
  const D = frameOff(k);
  const mz = MZ[g.barrel];
  const b = new GunRigBuilder(k);
  b.root('frame', once(`rev:frameD:${k}`, () => compose('frame', [frameModel(k)], D)), [0, 0, 0], 'Frame', D);
  const X = (parent: string, name: string, m: VoxelModel | null, at: V3, label: string, ex: V3, dist: number, slot?: string, delay = 0, local = false) =>
    b.add(name, m, parent, at, { label, slot, ex, dist, delay, local });
  X('frame', 'barrel', barrelModel(g.barrel, k), [0, YB, 17.6], 'Barrel', [0, 0, 1], 0.15, 'barrel', 0.25);
  X('barrel', 'front_sight', g.sight === 'none' && g.barrel !== 'serket' ? null : frontSightModel(g.barrel, k), [0, YB + RB, mz - 1.2], g.barrel === 'serket' ? 'Stinger Sight' : 'Front Sight', [0, 1, 0], 0.04, g.barrel === 'serket' ? 'barrel' : 'sight', 0.55);
  X('frame', 'rear_sight', g.sight === 'none' ? null : rearSightModel(k), [0, 18.6, 5.75], 'Rear Sight', [0, 1, 0], 0.05, 'sight', 0.4);
  X('frame', 'ejector_housing', housingModel(g.barrel, k), [EJX, EJY, 16.0], 'Ejector Housing', [-0.75, -0.3, 0.6], 0.1, 'barrel', 0.15);
  X('ejector_housing', 'ejector_rod', rodModel(g.barrel, k), [EJX, EJY, 16.0], 'Ejector Rod', [0, 0, 1], 0.07, undefined, 0.45);
  const ez = EJ_END[g.barrel];
  if (ez) X('ejector_housing', 'housing_screw', screwModel(`housing_screw_${g.barrel}`, k, [EJX - EJR + 0.05, EJY + 0.1, ez - 1.25], -1, 0.38, 1.0, BLUED.base, 0.2), [EJX - EJR, EJY + 0.1, ez - 1.25], 'Housing Screw', [-1, 0, 0], 0.04, undefined, 0.5);
  X('frame', 'cylinder', cylinderModel(g.cylinder, k), [0, YC, ZC], 'Cylinder', [-1, 0.12, 0], 0.13, 'cylinder', 0.1, true);
  X('frame', 'base_pin', basePinModel(k), [0, YC, 17.6], 'Base Pin', [0, 0, 1], 0.24, undefined, 0.0);
  X('frame', 'pin_latch', screwModel('pin_latch', k, [1.85, 12.1, 15.9], 1, 0.56, 1.5, BLUED.base, 0.9), [1.85, 12.1, 15.9], 'Base-Pin Latch', [1, 0, 0], 0.06);
  X('frame', 'hammer', hammerModel(k), HINGE, 'Hammer', [0, 0.92, -0.4], 0.09, undefined, 0.2, true);
  X('frame', 'loading_gate', gateModel(k), [-3.6, 12.2, 5.6], 'Loading Gate', [-1, -0.15, 0], 0.07, undefined, 0.3);
  X('frame', 'trigger', triggerModel(k), [0, 8.0, 7.8], 'Trigger', [0, -1, 0.15], 0.06, undefined, 0.35);
  X('frame', 'trigger_guard', guardModel(k), [0, 6.9, 8.6], 'Trigger Guard', [0, -1, 0.25], 0.12, undefined, 0.15);
  X('frame', 'grip_frame', gripFrameModel(k), [0, 6.2, 0.6], 'Grip Frame', [0, -0.75, -0.65], 0.08, undefined, 0.3);
  const gc = gpt(MED_S, 0);
  for (const side of [1, -1]) {
    const nm = side > 0 ? 'grip_l' : 'grip_r';
    X('frame', nm, gripPanel(g.grip, side, k), [side * 1.6, gc[1], gc[2]], side > 0 ? 'Grip Panel (Left)' : 'Grip Panel (Right)', [side, -0.25, -0.1], 0.08, 'grip', 0.05);
    const ml = g.grip === 'ivory' ? 'Gold Medallion' : g.grip === 'scarab' ? 'Gold Scarab' : 'Grip Escutcheon';
    X(nm, side > 0 ? 'medallion_l' : 'medallion_r', medallionModel(g.grip, side, k), [side * 2.3, gc[1], gc[2]], ml + (side > 0 ? ' (Left)' : ' (Right)'), [side, 0, 0], 0.035, 'grip', 0.5);
  }
  X('frame', 'screw_hammer', screwModel('screw_hammer', k, [1.75, HINGE[1], HINGE[2]], 1, 0.64, 3.5, BLUED.base, 0.4), [1.75, HINGE[1], HINGE[2]], 'Hammer Screw', [1, 0, 0], 0.09, undefined, 0.05);
  X('frame', 'screw_bolt', screwModel('screw_bolt', k, [1.75, 10.2, 3.2], 1, 0.56, 3.2, BLUED.base, 1.1), [1.75, 10.2, 3.2], 'Bolt Screw', [1, 0, 0], 0.08, undefined, 0.1);
  X('frame', 'screw_trigger', screwModel('screw_trigger', k, [1.75, 7.8, 4.3], 1, 0.56, 3.2, BLUED.base, 2.0), [1.75, 7.8, 4.3], 'Trigger Screw', [1, 0, 0], 0.08, undefined, 0.15);
  for (const side of [1, -1]) {
    const nm = side > 0 ? 'screw_bs_l' : 'screw_bs_r';
    X('frame', nm, screwModel(nm, k, [side * 1.22, 14.0, -0.6], side, 0.42, 1.2, BLUED.base, 0.9), [side * 1.22, 14.0, -0.6], side > 0 ? 'Backstrap Screw (Left)' : 'Backstrap Screw (Right)', [side, 0, -0.3], 0.05, undefined, 0.2);
  }
  if (g.sight === 'scope') {
    X('frame', 'scope', scopeModel(g.barrel, k), SCOPE_BASE, 'Brass Scope', [0, 1, 0], 0.12, 'sight', 0.6);
    X('frame', 'scope_ring_r', scopeRingModel(g.barrel, false, k), SCOPE_BASE, 'Scope Ring (Rear)', [0, 1, -0.2], 0.06, 'sight', 0.45);
    X('frame', 'scope_ring_f', scopeRingModel(g.barrel, true, k), [0, YB + RB, Math.min(mz - 4.0, 26.0)], 'Scope Ring (Front)', [0, 1, 0.2], 0.06, 'sight', 0.45);
  }
  const fv = (p: V3) => b.at('frame', p);
  const muzzle = fv([0, YB, mz + 0.2]);
  return {
    name: `revolver_${g.barrel}_${g.cylinder}_${g.grip}_${g.sight}${lod === 'hd' ? '' : '_' + lod}`,
    voxelSize: gunVS('revolver', lod),
    parts: b.parts,
    sockets: {
      muzzle: { part: 'frame', at: muzzle },
      ejector: { part: 'cylinder', at: [-RC * k, 0, 0] },
      laser: b.sock('frame', LASER_AT),
      gate: b.sock('frame', [-4.0, 12.2, 5.7]),
      spur: b.sock('hammer', [0, HINGE[1] + 6.5, HINGE[2] - 3.0]),
    },
    meta: {
      muzzle,
      ejector: fv([-RC, YC, ZC]),
      cylinderCenter: fv([0, YC, ZC]),
      chambers: 6,
      length: (mz + 3.0) / 100,
      parts: g,
      lod,
      gunKind: 'revolver',
      explode: b.explode,
      components: b.components,
      gripOffset: [0, 0, 0],
    },
  };
}
