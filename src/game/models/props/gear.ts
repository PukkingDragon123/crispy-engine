// Equipment models (run gear): goggles, masks, armour, gloves, boots, grappling
// hooks and charms, sculpted on a fine 1/48 grid so they read as hand-made props
// on Sundown's 1/36 body. Pieces are authored in ANCHOR frames (not hard-coded
// rig offsets) and FITTED to the live body: Equipment.ts measures the hero's
// head, torso, fists and feet from the rig's own part meshes / sockets and passes
// those sizes in as a GearFit, so straps wrap the real skull and boots wrap the
// real feet even after the hero is redesigned.
//
// Anchor frames (gear voxels, +Z = out of the body / forward, +Y up, +X = the
// character's LEFT):
//   face      origin between the eyes on the face's front surface (head part)
//   torso     origin on the chest surface at the chest-socket height (torso part)
//   shoulder_l/_r, hand_l/_r   the rig sockets of the same name
//   foot_l/_r origin on the sole under the middle of the foot, toes +Z (shin part)
//   sling     the upper back (grapple coils are slung there, clear of the duster's
//             cloth); the frame is turned so +X points out of the back
//   neck      upper chest, left of the sternum (charms hang on a neck cord)
// Moving bits are separate pieces with a joint (swing / spin / focus / hook) so
// Equipment can animate them; glass pieces render with a see-through material.
import { VoxelModel, VF } from '../../../engine/voxel/VoxelModel';
import { TOON, Ramp } from '../style';
import { hash3 } from '../../../engine/math/rand';
import type { RigSpec } from '../../../engine/voxel/Rig';
import { skeletonCowboyRig } from '../characters';

export const GEAR_VS = 1 / 48;
type V3 = [number, number, number];

export type GearAnchor = 'face' | 'torso' | 'shoulder_l' | 'shoulder_r' | 'hand_l' | 'hand_r' | 'foot_l' | 'foot_r' | 'sling' | 'neck';
export type GearJoint = 'swing' | 'spin' | 'focus' | 'hook';

/** rig parts gear can be skinned onto (their own voxel models, in their own grid) */
export type SkinPartName = 'fore_l' | 'fore_r' | 'shin_l' | 'shin_r' | 'torso';
export interface SkinPart {
  model: VoxelModel;
  /** the part's joint in its voxel coords (the rig meshes it around this) */
  pivot: V3;
  vs: number;
  /** hand socket in the part's voxel coords (forearms) */
  sock?: V3;
}

export interface GearPiece {
  name: string;
  anchor: GearAnchor;
  /**
   * skinned piece: the model is sculpted in this rig part's own voxel grid, hugging
   * its surface, and mounted on that part (then `at` = the piece's pivot in part coords)
   */
  skin?: SkinPartName;
  /** pivot of this piece in the anchor frame (gear voxels); the model is built around (0,0,0) = pivot */
  at: V3;
  model: VoxelModel;
  glass?: boolean;
  joint?: GearJoint;
  /** pieces sharing a group move together on one joint node */
  group?: string;
}

/** body measurements in gear voxels (1/48 m) */
export interface GearFit {
  head: { hw: number; back: number; top: number; brim: number; chin: number };
  torso: { hw: number; back: number; top: number; waist: number };
  hand_l: Box;
  hand_r: Box;
  foot: { hw: number; toe: number; heel: number; h: number; shinHW: number; shinZ0: number; shinZ1: number };
  /** the body's own part models for skinned pieces (from the live rig, or Sundown's reference rig) */
  parts?: Partial<Record<SkinPartName, SkinPart>>;
}
export interface Box {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  z0: number;
  z1: number;
}

/** Sundown as measured from the 1.86 m rig (used for display models and as a fallback) */
export const DEFAULT_FIT: GearFit = {
  head: { hw: 8, back: -17, top: 12, brim: 6.7, chin: -9 },
  torso: { hw: 11.5, back: -19, top: 11, waist: -13 },
  hand_l: { x0: -3.4, x1: 3.4, y0: -4.6, y1: 3, z0: -2.7, z1: 3.4 },
  hand_r: { x0: -3.4, x1: 3.4, y0: -4.6, y1: 3, z0: -2.7, z1: 3.4 },
  foot: { hw: 2.2, toe: 7.5, heel: -4.5, h: 4, shinHW: 1.8, shinZ0: -1.6, shinZ1: 1.8 },
};

// ------------------------------------------------------------------ palette
const r = (base: number, shade: number, hi: number, dark: number): Ramp => ({ base, shade, hi, dark });
const BR = TOON.brass, GO = TOON.gold, IR = TOON.iron, LE = TOON.leather, LD = TOON.leatherDark, BO = TOON.bone, LI = TOON.bandage;
const AMBER = r(0xf0a23c, 0xc4741e, 0xffe2a0, 0x8a4a10);
const SMOKE = r(0x5c4c70, 0x3e3250, 0xa898c4, 0x241c30);
const CLEAR = r(0xd8eef0, 0xa8ccd0, 0xffffff, 0x7aa0a4);
const LACQ = r(0x2a2630, 0x1c1a22, 0x46404e, 0x0e0c12);
const CHIT = r(0xb0682e, 0x864a1e, 0xd88c48, 0x4e2a10);
const SNAKE = r(0xc2a266, 0x987a44, 0xe6cc94, 0x5a4424);
const CAMEL = r(0xd4b07a, 0xb08c58, 0xecd0a0, 0x7a5c34);
const COPPER = r(0xd0783c, 0xa2562a, 0xf0a060, 0x5e2e12);
const ROPE = r(0xc8a46a, 0xa08048, 0xe4c890, 0x6a5430);
const CACT = TOON.cactus;
const SPARK = 0x8fe4ff;
const M = VF.METAL;

// ------------------------------------------------------------------ helpers
/** superellipse (rounded-box) band around an axis-aligned body: x∈[-hw,hw], z∈[z0,z1]; y from y0..y1 (+ tilt·x) */
function band(m: VoxelModel, y0: number, y1: number, hw: number, z0: number, z1: number, t: number, col: (x: number, y: number, z: number) => number, o: { tilt?: number; keep?: (x: number, z: number) => boolean; flags?: number } = {}) {
  const cz = (z0 + z1) / 2, hd = (z1 - z0) / 2;
  const n = 4;
  const X = Math.ceil(hw + t + 1), Z = Math.ceil(hd + t + 1);
  for (let x = -X; x <= X; x++)
    for (let zz = -Z; zz <= Z; zz++) {
      const z = Math.round(cz) + zz;
      const dz = z - cz;
      const outer = Math.pow(Math.abs(x) / (hw + t), n) + Math.pow(Math.abs(dz) / (hd + t), n);
      const inner = Math.pow(Math.abs(x) / hw, n) + Math.pow(Math.abs(dz) / hd, n);
      if (outer > 1 || inner <= 1) continue;
      if (o.keep && !o.keep(x, z)) continue;
      const dy = Math.round(x * (o.tilt ?? 0));
      for (let y = y0; y <= y1; y++) m.set(x, y + dy, z, col(x, y + dy, z), o.flags);
    }
}

/** annulus in the XY plane, extruded z0..z1 (lens rims, rowels, coils seen end-on) */
function ringXY(m: VoxelModel, cx: number, cy: number, z0: number, z1: number, r0: number, r1: number, col: (a: number, rr: number, z: number) => number, flags?: number) {
  const R = Math.ceil(r1 + 0.5);
  for (let x = -R; x <= R; x++)
    for (let y = -R; y <= R; y++) {
      const d = Math.hypot(x, y);
      if (d > r1 + 0.35 || d < r0 - 0.35) continue;
      const a = Math.atan2(y, x);
      for (let z = z0; z <= z1; z++) m.set(cx + x, cy + y, z, col(a, d, z), flags);
    }
}

function discXY(m: VoxelModel, cx: number, cy: number, z: number, rad: number, col: (x: number, y: number, d: number) => number, flags?: number) {
  const R = Math.ceil(rad + 0.5);
  for (let x = -R; x <= R; x++)
    for (let y = -R; y <= R; y++) {
      const d = Math.hypot(x, y);
      if (d > rad + 0.35) continue;
      m.set(cx + x, cy + y, z, col(x, y, d), flags);
    }
}

/** mirrored copy (x → −x): right-hand twins of left-hand pieces */
export function mirrorModel(src: VoxelModel, name = src.name + '_m') {
  const m = new VoxelModel(name);
  src.forEach((x, y, z, rgb, f) => m.set(-x, y, z, rgb, f));
  return m;
}

/** lit-from-upper-left metal: hi on top-left facing voxels, shade underneath */
const lit = (rp: Ramp) => (a: number) => {
  const k = Math.cos(a - 2.2);
  return k > 0.55 ? rp.hi : k < -0.55 ? rp.shade : rp.base;
};

/** twisted rope along a polyline (three strands: alternating tones along the length) */
function rope(m: VoxelModel, pts: V3[], rad: number, rp: Ramp = ROPE) {
  let s = 0;
  for (let p = 0; p < pts.length - 1; p++) {
    const [ax, ay, az] = pts[p], [bx, by, bz] = pts[p + 1];
    const L = Math.hypot(bx - ax, by - ay, bz - az);
    const n = Math.max(2, Math.ceil(L * 2.2));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const x = ax + (bx - ax) * t, y = ay + (by - ay) * t, z = az + (bz - az) * t;
      const c = (Math.floor((s + t * L) * 1.4) % 3) === 0 ? rp.shade : (Math.floor((s + t * L) * 1.4) % 3) === 1 ? rp.base : rp.hi;
      if (rad < 0.7) m.set(x, y, z, c);
      else m.ellipsoid(Math.round(x), Math.round(y), Math.round(z), rad, rad, rad, c);
    }
    s += L;
  }
}

/** a chain of little links between two points (alternating open/closed links) */
function chain(m: VoxelModel, a: V3, b: V3, rp: Ramp) {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const n = Math.max(1, Math.round(L));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t, z = a[2] + (b[2] - a[2]) * t;
    m.set(x, y, z, i % 2 ? rp.shade : rp.hi, M);
    if (i % 2 === 0) m.set(x + 1, y, z, rp.base, M).set(x - 1, y, z, rp.base, M);
  }
}

function rivet(m: VoxelModel, x: number, y: number, z: number, rp: Ramp = BR) {
  m.set(x, y, z, rp.hi, M);
}

const piece = (name: string, anchor: GearAnchor, at: V3, model: VoxelModel, extra: Partial<GearPiece> = {}): GearPiece => ({ name, anchor, at, model, ...extra });

// ================================================================== HEAD
/** brass flying goggles with amber sun-glass: the focus tubes telescope out when aiming */
function goggles(fit: GearFit): GearPiece[] {
  const H = fit.head;
  const frame = new VoxelModel('gear_goggles');
  // strap: around the skull at the brow line, stitched, with a buckle at the back-left
  const sy0 = 1, sy1 = 2;
  band(frame, sy0, sy1, H.hw + 0.4, H.back - 0.4, 0.6, 1.2, (x, y, z) => {
    if (z > -2) return LD.base;
    if (x > H.hw - 2 && z < H.back + 4 && z > H.back + 1) return BR.hi; // buckle
    return y === sy1 && (x + z) % 3 === 0 ? LE.hi : y === sy0 ? LD.shade : LD.base;
  }, { keep: (x, z) => z < -1 || Math.abs(x) > 6.5 });
  for (const s of [1, -1]) {
    const cx = 4 * s;
    // the cup: a thick brass rim with a leather gasket behind it
    ringXY(frame, cx, 0, -1, -1, 2.4, 3.7, () => LD.dark);
    ringXY(frame, cx, 0, 0, 1, 2.6, 3.8, lit(BR), M);
    ringXY(frame, cx, 0, 2, 2, 3.0, 3.6, (a) => (Math.round(a * 4) % 2 ? BR.shade : BR.base), M);
    // side hinge plate to the strap, rivets top and bottom
    for (let i = 0; i <= Math.max(1, Math.round(H.hw + 0.8 - 7.4)); i++) frame.set(cx + s * (3.8 + i), 0, 0, BR.base, M).set(cx + s * (3.8 + i), 1, -i > -2 ? 0 : -1, BR.shade, M);
    rivet(frame, cx + s * 3, 2, 2);
    rivet(frame, cx - s * 1, -3, 1);
  }
  // nose bridge: an arched brass strip with a centre rivet
  for (let x = -1; x <= 1; x++) frame.set(x, 1, 1, BR.base, M);
  frame.set(0, 2, 1, BR.hi, M).set(-2, 1, 1, BR.shade, M).set(2, 1, 1, BR.shade, M);
  const out: GearPiece[] = [piece('frame', 'face', [0, 0, 0], frame)];
  for (const s of [1, -1]) {
    const side = s > 0 ? 'l' : 'r';
    // telescoping focus tube (knurled), turns and slides out when aiming
    const tube = new VoxelModel('gear_goggle_tube');
    ringXY(tube, 0, 0, 0, 1, 2.3, 3.0, (a, _d, z) => (z === 1 ? (Math.round(a * 5) % 2 ? BR.hi : BR.base) : BR.shade), M);
    tube.set(0, 3, 1, GO.hi, M); // index tick so the twist reads
    const glass = new VoxelModel('gear_goggle_glass');
    discXY(glass, 0, 0, 0, 2.3, (x, y, d) => (d < 1.2 && x <= 0 && y >= 0 ? AMBER.hi : d > 1.8 ? AMBER.shade : AMBER.base));
    discXY(glass, 0, 0, 1, 1.2, (x, y) => (x < 0 && y > 0 ? 0xffffff : AMBER.hi));
    out.push(piece('tube_' + side, 'face', [4 * s, 0, 2], tube, { joint: 'focus', group: 'focus_' + side }));
    out.push(piece('lens_' + side, 'face', [4 * s, 0, 2], glass, { glass: true, joint: 'focus', group: 'focus_' + side }));
  }
  return out;
}

/** round smoked-glass spectacles of Thoth: gold wire, an ibis-beak bridge, lapis temple glyphs and a fine chain */
function thothSpecs(fit: GearFit): GearPiece[] {
  const H = fit.head;
  const m = new VoxelModel('gear_thoth');
  for (const s of [1, -1]) {
    const cx = 4 * s;
    ringXY(m, cx, 0, 1, 1, 2.2, 2.9, lit(GO), M);
    // temple arm back along the skull, ending in a lapis drop
    const tx = s * (H.hw + 0.5);
    for (let x = cx + s * 3; s > 0 ? x <= tx : x >= tx; x += s) m.set(x, 1, 1, GO.base, M);
    for (let z = 0; z >= H.back * 0.55; z--) m.set(tx, 1 + (z < H.back * 0.4 ? -1 : 0), z, z % 4 === 0 ? GO.hi : GO.base, M);
    m.set(tx, 0, Math.round(H.back * 0.55), TOON.lapis.base).set(tx, -1, Math.round(H.back * 0.55), TOON.lapis.hi);
    // hinge block with an engraved lapis glyph
    m.set(cx + s * 3, 1, 1, GO.shade, M).set(cx + s * 3, 0, 1, TOON.lapis.base).set(cx + s * 3, 2, 1, GO.hi, M);
    // a fine gold chain hanging from the hinge behind the jaw
    for (let i = 0; i < 9; i++) {
      const z = -1 - i * 0.9;
      const y = -1 - Math.sin((i / 8) * Math.PI) * 4.5;
      m.set(tx + s * 0.6, y, z, i % 2 ? GO.shade : GO.hi, M);
    }
  }
  // ibis bridge: the arch, the head and the long down-curved beak over the nose
  for (const [x, y, z] of [[-2, 1, 1], [-1, 2, 1], [0, 2, 2], [1, 2, 1], [2, 1, 1], [0, 1, 3], [0, 0, 3], [0, -1, 3], [0, -2, 2]] as V3[]) m.set(x, y, z, GO.base, M);
  m.set(0, 3, 2, GO.hi, M).set(0, 2, 3, TOON.lapis.base);
  const out: GearPiece[] = [piece('specs', 'face', [0, 0, 0], m)];
  for (const s of [1, -1]) {
    const g = new VoxelModel('gear_thoth_glass');
    discXY(g, 0, 0, 0, 2.2, (x, y, d) => (d < 1 && x < 0 && y > 0 ? SMOKE.hi : d > 1.7 ? SMOKE.dark : SMOKE.base));
    out.push(piece('glass_' + (s > 0 ? 'l' : 'r'), 'face', [4 * s, 0, 1], g, { glass: true }));
  }
  return out;
}

/** black-lacquer jackal muzzle (lower half-mask): gold banding, a glossy nose, two bone fangs */
function jackalMask(fit: GearFit): GearPiece[] {
  const H = fit.head;
  const m = new VoxelModel('gear_jackal');
  const yTop = -3, yBot = Math.max(H.chin + 0.5, -11);
  // the face plate hugs the cheeks
  for (let y = yBot; y <= yTop; y++) {
    const t = (y - yBot) / (yTop - yBot);
    const hw = Math.round(H.hw * (0.55 + 0.35 * t));
    for (let x = -hw; x <= hw; x++) {
      const edge = Math.abs(x) >= hw - 0.5 || y === yTop;
      m.set(x, y, 0, edge ? GO.base : LACQ.base, edge ? M : undefined);
      m.set(x, y, -1, LACQ.shade);
    }
  }
  // the snout: tapers toward a glossy black nose
  for (let z = 1; z <= 6; z++) {
    const k = z / 6;
    const hw = 3.6 - k * 1.8, top = Math.round(yTop - 1 - k * 1.2), bot = Math.round(yBot + 1 + k * 2.4);
    for (let x = -Math.round(hw); x <= Math.round(hw); x++)
      for (let y = bot; y <= top; y++) {
        const band = z === 2 || z === 4;
        const c = band ? (y === top ? GO.hi : GO.base) : y === top ? LACQ.hi : y === bot ? LACQ.dark : LACQ.base;
        m.set(x, y, z, c, band ? M : undefined);
      }
  }
  m.set(0, yTop - 2, 7, LACQ.dark, M).set(-1, yTop - 2, 7, LACQ.dark, M).set(1, yTop - 2, 7, LACQ.dark, M).set(0, yTop - 1, 7, LACQ.hi, M);
  // mouth slit and two fangs
  for (let z = 2; z <= 5; z++) m.set(0, Math.round(yBot + 2 + z * 0.4), z, LACQ.dark);
  for (const s of [1, -1]) {
    m.set(s * 2, yBot + 1, 4, BO.hi).set(s * 2, yBot, 4, BO.base).set(s * 2, yBot - 1, 4, BO.shade);
    // cheek strap back around the jaw
    for (let z = -1; z >= H.back * 0.6; z--) m.set(s * (H.hw * 0.9 + 0.4), yTop - 1, z, z % 3 === 0 ? GO.base : LD.base, z % 3 === 0 ? M : undefined);
    // gold eye-line brows sweeping up from the cheeks
    m.set(s * 5, yTop + 1, 0, GO.hi, M).set(s * 6, yTop + 2, 0, GO.base, M).set(s * 7, yTop + 2, -1, GO.shade, M);
  }
  return [piece('mask', 'face', [0, 0, 1], m)];
}

/** brass respirator with two scarab-shell filter canisters and twisted hoses */
function respirator(fit: GearFit): GearPiece[] {
  const H = fit.head;
  const m = new VoxelModel('gear_respirator');
  const cy = Math.round(Math.max(H.chin + 3.5, -7));
  // the cup: a domed brass muzzle with a perforated grille
  for (let x = -4; x <= 4; x++)
    for (let y = -4; y <= 4; y++) {
      const d = Math.hypot(x, y * 1.1);
      if (d > 4.3) continue;
      const depth = Math.round(Math.sqrt(Math.max(0, 1 - (d / 4.6) ** 2)) * 4);
      for (let z = 0; z <= depth; z++) {
        const front = z === depth;
        let c = d > 3.5 ? BR.shade : BR.base;
        if (front && d < 2.6) c = (x + y) % 2 === 0 ? LACQ.dark : BR.hi; // grille
        else if (front && x - y < -2) c = BR.hi;
        m.set(x, cy + y, z, c, M);
      }
    }
  ringXY(m, 0, cy, 0, 0, 4.2, 5, lit(LD));
  for (const s of [1, -1]) {
    // scarab filter canister on the cheek
    const fx = s * 6.5, fy = cy - 1;
    m.ellipsoid(fx, fy, 1, 2, 2.6, 2.2, TOON.turquoise.base);
    for (let y = -2; y <= 2; y++) m.set(fx, fy + y, 3, TOON.turquoise.dark);
    m.set(fx - s, fy + 1, 3, TOON.turquoise.hi).set(fx, fy + 3, 1, GO.base, M).set(fx, fy - 3, 1, GO.shade, M);
    ringXY(m, fx, fy, -1, -1, 1.8, 2.6, () => GO.base, M);
    // hose from canister to the cup
    rope(m, [[fx - s * 1.5, fy - 2, 2], [s * 3.5, cy - 4, 2]], 0, r(0x4a3a2a, 0x2e2418, 0x6a5440, 0x1a140c));
    // head strap
    for (let z = -1; z >= H.back * 0.85; z--) m.set(s * (H.hw + 0.4), cy + 1 + Math.round((z / H.back) * 3), z, z % 4 === 0 ? BR.base : LD.base, z % 4 === 0 ? M : undefined);
  }
  return [piece('respirator', 'face', [0, 0, 0.5], m)];
}

// ================================================================== BODY
/** lapis-and-gold scarab carapace breastplate + back plate, strapped at the sides */
function scarabPlate(fit: GearFit): GearPiece[] {
  const T = fit.torso;
  const m = new VoxelModel('gear_scarab_plate');
  const L = TOON.lapis;
  const top = Math.round(T.top * 0.78), bot = Math.round(T.waist * 0.7);
  const shell = (zSign: 1 | -1, z0: number, scale: number) => {
    for (let y = bot; y <= top; y++) {
      const v = (y - (top + bot) / 2) / ((top - bot) / 2);
      const w = T.hw * scale * (0.92 - 0.18 * v * v - (v > 0.6 ? (v - 0.6) * 0.9 : 0));
      const W = Math.round(w);
      for (let x = -W; x <= W; x++) {
        const u = x / Math.max(1, w);
        const bulge = Math.round(2.2 * (1 - u * u) * (1 - v * v * 0.7));
        const rim = Math.abs(x) >= W - 0.5 || y === top || y === bot;
        const seam = x === 0 && zSign > 0;
        const ridge = Math.abs(Math.abs(x) - Math.round(w * 0.5)) < 0.5;
        for (let k = 0; k <= 1 + bulge; k++) {
          const z = z0 + zSign * k;
          const surf = k === 1 + bulge;
          let c = L.shade;
          let f: number | undefined;
          if (surf) {
            if (rim) (c = GO.base), (f = M);
            else if (seam) (c = GO.shade), (f = M);
            else if (ridge) c = L.hi;
            else c = v > 0.4 ? L.hi : v < -0.5 ? L.shade : L.base;
          }
          m.set(x, y, z, c, f);
        }
      }
    }
  };
  shell(1, 0, 1);
  shell(-1, Math.round(T.back) - 0, 0.82);
  // scarab head at the collar: gold clypeus with two little horns, forelegs hugging the neckline
  const hy = top + 1;
  m.ellipsoid(0, hy, 2, 2.6, 1.6, 1.6, GO.base, M);
  m.set(-1, hy + 2, 3, GO.hi, M).set(1, hy + 2, 3, GO.hi, M).set(0, hy, 4, GO.hi, M).set(-2, hy, 4, TOON.turquoise.base).set(2, hy, 4, TOON.turquoise.base);
  for (const s of [1, -1]) {
    for (let i = 0; i < 6; i++) m.set(s * (3 + i), hy - 1 + Math.round(Math.sin((i / 5) * Math.PI) * 2), 2 - (i >> 2), i === 5 ? GO.hi : GO.base, M);
    // side straps joining front and back plates
    for (const y of [Math.round(bot * 0.35), Math.round(top * 0.2)]) {
      for (let z = 0; z >= T.back; z--) m.set(s * Math.round(T.hw + 0.6), y, z, z % 4 === 0 ? BR.hi : LD.base, z % 4 === 0 ? M : undefined);
    }
    // wing-case studs
    for (const y of [Math.round(top * 0.5), Math.round(bot * 0.4)]) m.set(s * Math.round(T.hw * 0.35), y, 4, TOON.turquoise.hi);
  }
  return [piece('plate', 'torso', [0, 0, 0], m)];
}

/** mummy linen wound around the torso in tilted turns, two loose tails that swing */
function mummyWrap(fit: GearFit): GearPiece[] {
  const T = fit.torso;
  const m = new VoxelModel('gear_mummy_wrap');
  const col = (x: number, y: number, z: number) => {
    const h = hash3(x + 70, y, z);
    return h < 0.08 ? 0xb8a47a : (y + x) % 5 === 0 ? LI.shade : z > -3 && h > 0.8 ? LI.hi : LI.base;
  };
  const turns = 5;
  for (let i = 0; i < turns; i++) {
    const y = Math.round(T.waist * 0.85 + (i / (turns - 1)) * (T.top * 0.75 - T.waist * 0.85));
    band(m, y, y + 1, T.hw + 0.3, T.back - 0.3, 0.3, 1.2, col, { tilt: i % 2 ? 0.22 : -0.22 });
  }
  // a cross wrap over each shoulder
  for (const s of [1, -1])
    for (let k = 0; k <= 12; k++) {
      const t = k / 12;
      const z = 1 + (T.back - 2) * t;
      const y = T.top * 0.85 + Math.sin(t * Math.PI) * 3;
      m.set(s * 6, y, z, col(s * 6, y, z)).set(s * 7, y, z, col(s * 7, y, z));
    }
  const tails: GearPiece[] = [];
  for (const [i, s] of [[0, 1], [1, -1]] as [number, number][]) {
    const t = new VoxelModel('gear_wrap_tail');
    for (let k = 0; k <= 10; k++) {
      const x = Math.round(Math.sin(k * 0.5) * 1.2);
      t.set(x, -k, 0, col(x, -k, i)).set(x + 1, -k, 0, k % 3 ? LI.base : LI.shade);
    }
    t.set(1, -11, 0, LI.shade);
    tails.push(piece('tail' + i, 'torso', [s * 4, Math.round(T.waist * 0.75), Math.round(T.back - 1)], t, { joint: 'swing' }));
  }
  return [piece('wraps', 'torso', [0, 0, 0], m), ...tails];
}

/** layered bone shoulder guards with a horn spike and a vertebra crest */
function pauldron(): VoxelModel {
  const m = new VoxelModel('gear_pauldron');
  const plates = [
    { cx: 0, cy: -2.5, r0: 6.4, r1: 7.8, a0: 50, a1: 128, zw: 5.6 },
    { cx: 1, cy: -3.5, r0: 6, r1: 7.4, a0: 12, a1: 64, zw: 5.2 },
    { cx: 2, cy: -4.5, r0: 5.4, r1: 6.8, a0: -28, a1: 22, zw: 4.6 },
  ];
  plates.forEach((p, i) => {
    for (let x = -4; x <= 12; x++)
      for (let y = -12; y <= 8; y++) {
        const dx = x - p.cx, dy = y - p.cy;
        const d = Math.hypot(dx, dy);
        if (d < p.r0 || d > p.r1) continue;
        const a = (Math.atan2(dy, dx) * 180) / Math.PI;
        if (a < p.a0 || a > p.a1) continue;
        const u = (a - (p.a0 + p.a1) / 2) / ((p.a1 - p.a0) / 2);
        const zw = p.zw * Math.sqrt(Math.max(0, 1 - Math.pow(Math.abs(u), 6)));
        for (let z = -Math.round(zw); z <= Math.round(zw); z++) {
          const edge = d > p.r1 - 0.7 && (Math.abs(z) >= Math.round(zw) - 1 || Math.abs(u) > 0.85);
          const groove = Math.abs(z) % 3 === 0 && d > p.r1 - 0.7;
          const c = edge ? BO.shade : groove ? BO.hi : i === 0 && d > p.r1 - 0.7 ? BO.hi : BO.base;
          m.set(x, y, z, c);
        }
      }
  });
  // vertebra crest along the top plate
  for (let z = -4; z <= 4; z += 2) m.set(-1, 6, z, BO.hi).set(-1, 7, z, BO.base);
  // a curved horn spike up and out
  m.tube([[2, 5, 0], [4, 8, -0.5], [5, 10.5, -1.5]], 1.3, 0.3, BO.hi);
  m.set(5, 11, -2, BO.shade);
  // leather strap under the arm
  for (let z = -4; z <= 4; z++) m.set(8, -8, z, z % 3 === 0 ? BR.hi : LD.base, z % 3 === 0 ? M : undefined);
  return m;
}
function bonePauldrons(): GearPiece[] {
  const l = pauldron();
  return [piece('pauldron_l', 'shoulder_l', [0, 0, 0], l), piece('pauldron_r', 'shoulder_r', [0, 0, 0], mirrorModel(l))];
}

/** cactus-hide jerkin: ribbed green panels, spine tufts, a desert bloom and rawhide lacing */
function cactusJerkin(fit: GearFit): GearPiece[] {
  const T = fit.torso;
  const m = new VoxelModel('gear_cactus_jerkin');
  const top = Math.round(T.top * 0.8), bot = Math.round(T.waist * 0.85);
  const hw = Math.round(T.hw * 0.95);
  const panel = (z0: number, zs: 1 | -1, open: boolean) => {
    for (let y = bot; y <= top; y++)
      for (let x = -hw; x <= hw; x++) {
        if (open && Math.abs(x) < 1 + Math.max(0, y - bot * 0.1) * 0.45) continue;
        const u = x / hw;
        const z = z0 + zs * Math.round((1 - u * u) * 1.4);
        const rib = Math.abs(x) % 3 === 1;
        const c = y === bot ? CACT.dark : rib ? CACT.hi : y === top ? CACT.hi : CACT.base;
        m.set(x, y, z, c).set(x, y, z - zs, CACT.shade);
        // spine tufts on the ribs
        if (rib && (y - bot) % 4 === 2 && hash3(x + 30, y, z0) > 0.35) m.set(x, y, z + zs, TOON.white.base).set(x + (x > 0 ? 1 : -1), y + 1, z + zs * 2, TOON.white.hi);
      }
  };
  panel(1, 1, true);
  panel(Math.round(T.back) - 1, -1, false);
  // side seams
  for (const s of [1, -1]) for (let y = bot; y <= top; y += 2) for (let z = 0; z >= T.back; z -= 1) if (z % 2 === 0) m.set(s * (hw + 1), y, z, CACT.shade);
  // rawhide lacing across the V
  for (let y = bot + 2; y <= Math.round(top * 0.4); y += 3) {
    const w = Math.round(1 + Math.max(0, y - bot * 0.1) * 0.45);
    for (let x = -w; x <= w; x++) m.set(x, y + (x === 0 ? 0 : Math.abs(x) > w - 1 ? -1 : 0), 2, LE.hi);
  }
  // a desert bloom on the left breast
  const fx = Math.round(hw * 0.5), fy = Math.round(top * 0.55);
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]] as [number, number][]) m.set(fx + dx, fy + dy, 4, Math.abs(dx) + Math.abs(dy) === 2 ? TOON.flower.shade : TOON.flower.base);
  m.set(fx, fy, 5, 0xffd84a).set(fx, fy, 4, TOON.flower.hi).set(fx + 2, fy, 3, TOON.flower.hi).set(fx, fy + 2, 3, TOON.flower.hi);
  return [piece('jerkin', 'torso', [0, 0, 0], m)];
}

// ================================================================== HANDS
/** glove shell fitted over a fist box (+1 margin), flared cuff above the wrist */
function gloveShell(m: VoxelModel, b: Box, out: 1 | -1, rp: Ramp, cuffH: number, flare: number) {
  const x0 = Math.floor(b.x0) - 1, x1 = Math.ceil(b.x1) + 1, y0 = Math.floor(b.y0) - 1, y1 = Math.ceil(b.y1), z0 = Math.floor(b.z0) - 1, z1 = Math.ceil(b.z1) + 1;
  for (let x = x0; x <= x1; x++)
    for (let y = y0; y <= y1; y++)
      for (let z = z0; z <= z1; z++) {
        const sx = x === x0 || x === x1, sy = y === y0, sz = z === z0 || z === z1;
        if (!(sx || sy || sz)) continue;
        if ((sx && sz) || (sx && sy) || (sy && sz)) continue; // rounded edges
        const backOfHand = out > 0 ? x === x1 : x === x0;
        m.set(x, y, z, backOfHand ? rp.hi : sy ? rp.shade : rp.base);
      }
  // cuff: a flared ring around the wrist
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  for (let k = 0; k < cuffH; k++) {
    const y = y1 + 1 + k;
    const g = (k / Math.max(1, cuffH - 1)) * flare;
    const hx = (x1 - x0) / 2 - 0.6 + g, hz = (z1 - z0) / 2 - 0.6 + g;
    for (let x = Math.floor(cx - hx); x <= Math.ceil(cx + hx); x++)
      for (let z = Math.floor(cz - hz); z <= Math.ceil(cz + hz); z++) {
        const edge = x <= cx - hx + 0.6 || x >= cx + hx - 0.6 || z <= cz - hz + 0.6 || z >= cz + hz - 0.6;
        if (!edge) continue;
        m.set(x, y, z, k === cuffH - 1 ? rp.hi : k === 0 ? rp.dark : rp.base);
      }
  }
  return { x0, x1, y0, y1, z0, z1 };
}

function gunslingerGloves(fit: GearFit): GearPiece[] {
  const make = (b: Box, out: 1 | -1) => {
    const m = new VoxelModel('gear_gloves');
    const s = gloveShell(m, b, out, LE, 4, 1.2);
    const bx = out > 0 ? s.x1 : s.x0;
    // brass studs along the back of the hand, a stitched seam
    for (let z = s.z0 + 1; z <= s.z1 - 1; z += 2) rivet(m, bx + out, s.y0 + 2, z);
    for (let y = s.y0 + 1; y <= s.y1; y++) m.set(bx, y, Math.round((s.z0 + s.z1) / 2), (y & 1) ? TOON.linen.base : LE.hi);
    // fringe hanging from the cuff's outer edge
    for (let z = s.z0; z <= s.z1; z += 2) for (let k = 0; k < 3; k++) m.set(bx + out * 2, s.y1 + 3 - k, z, k === 2 ? LE.shade : LE.base);
    return m;
  };
  return [piece('glove_l', 'hand_l', [0, 0, 0], make(fit.hand_l, 1)), piece('glove_r', 'hand_r', [0, 0, 0], make(fit.hand_r, -1))];
}

/** Serket's stinger gauntlet (left, the melee hand): segmented chitin with a venom stinger curled over the knuckles */
function stingerGauntlet(fit: GearFit): GearPiece[] {
  const m = new VoxelModel('gear_stinger');
  const s = gloveShell(m, fit.hand_l, 1, CHIT, 3, 0.6);
  // forearm bracer: three overlapping chitin rings
  for (let i = 0; i < 3; i++) {
    const y = s.y1 + 4 + i * 2;
    for (let x = s.x0; x <= s.x1; x++) for (const z of [s.z0, s.z1]) m.set(x, y, z, i % 2 ? CHIT.shade : CHIT.hi);
    for (let z = s.z0; z <= s.z1; z++) for (const x of [s.x0, s.x1]) m.set(x, y, z, i % 2 ? CHIT.shade : CHIT.base);
  }
  // the stinger: segments arc from the wrist over the back of the hand to a venom bulb and barb
  const bx = s.x1 + 1, mz = (s.z0 + s.z1) / 2;
  const segs: V3[] = [[bx, s.y1 + 4, mz], [bx + 2, s.y1 + 2, mz], [bx + 3, s.y1 - 1, mz + 1], [bx + 3, s.y0 + 2, mz + 2.5], [bx + 1.5, s.y0, mz + 4]];
  segs.forEach(([x, y, z], i) => {
    m.ellipsoid(Math.round(x), Math.round(y), Math.round(z), 1.3 - i * 0.12, 1.3 - i * 0.12, 1.3 - i * 0.12, i % 2 ? CHIT.shade : CHIT.base);
    m.set(Math.round(x) + 1, Math.round(y) + 1, Math.round(z), CHIT.hi);
  });
  const [ex, ey, ez] = segs[segs.length - 1];
  m.ellipsoid(Math.round(ex), Math.round(ey) - 1, Math.round(ez) + 1, 1.4, 1.4, 1.4, TOON.serket.base, VF.EMISSIVE);
  m.set(Math.round(ex) - 1, Math.round(ey) - 1, Math.round(ez) + 2, TOON.serket.hi, VF.EMISSIVE);
  m.set(Math.round(ex) - 1, Math.round(ey) - 3, Math.round(ez) + 2, LACQ.dark).set(Math.round(ex) - 1, Math.round(ey) - 4, Math.round(ez) + 3, LACQ.base);
  // a small matching chitin cuff on the gun hand
  const c = new VoxelModel('gear_stinger_cuff');
  const b = fit.hand_r;
  const y = Math.ceil(b.y1) + 1;
  for (let x = Math.floor(b.x0); x <= Math.ceil(b.x1); x++) for (const z of [Math.floor(b.z0) - 1, Math.ceil(b.z1) + 1]) c.set(x, y, z, CHIT.base).set(x, y + 1, z, CHIT.hi);
  for (let z = Math.floor(b.z0) - 1; z <= Math.ceil(b.z1) + 1; z++) for (const x of [Math.floor(b.x0) - 1, Math.ceil(b.x1) + 1]) c.set(x, y, z, CHIT.shade).set(x, y + 1, z, CHIT.base);
  return [piece('gauntlet', 'hand_l', [0, 0, 0], m), piece('cuff', 'hand_r', [0, 0, 0], c)];
}

/** brass knuckle-dusters over the front of each fist, wrists taped in linen */
function brassKnuckles(fit: GearFit): GearPiece[] {
  const make = (b: Box) => {
    const m = new VoxelModel('gear_knuckles');
    const zf = Math.ceil(b.z1) + 1;
    const x0 = Math.floor(b.x0), x1 = Math.ceil(b.x1);
    const yk = Math.round(b.y0 + (b.y1 - b.y0) * 0.35);
    // grip bar + four raised finger rings
    for (let x = x0; x <= x1; x++) m.set(x, yk - 2, zf, BR.shade, M);
    const n = 4;
    for (let i = 0; i < n; i++) {
      const cx = Math.round(x0 + ((i + 0.5) / n) * (x1 - x0 + 1)) - 0.5;
      for (const [dx, dy] of [[0, 0], [0, 2], [-1, 1], [1, 1]] as [number, number][]) m.set(cx + dx, yk + dy - 1, zf + 1, dy === 2 ? BR.hi : BR.base, M);
      m.set(cx, yk, zf, BR.shade, M);
    }
    // linen tape round the wrist
    const y = Math.ceil(b.y1) + 1;
    for (let k = 0; k < 2; k++) {
      for (let x = x0 - 1; x <= x1 + 1; x++) for (const z of [Math.floor(b.z0) - 1, zf]) m.set(x, y + k, z, (x + k) % 3 ? LI.base : LI.shade);
      for (let z = Math.floor(b.z0) - 1; z <= zf; z++) for (const x of [x0 - 1, x1 + 1]) m.set(x, y + k, z, (z + k) % 3 ? LI.base : LI.shade);
    }
    return m;
  };
  return [piece('knuckles_l', 'hand_l', [0, 0, 0], make(fit.hand_l)), piece('knuckles_r', 'hand_r', [0, 0, 0], make(fit.hand_r))];
}

// ================================================================== FEET
/** a boot shell around the measured foot (+ shaft up the shin) */
function bootShell(m: VoxelModel, F: GearFit['foot'], shaft: number, col: (x: number, y: number, z: number, part: 'sole' | 'foot' | 'shaft') => number, soleFlare = 0) {
  const hw = Math.ceil(F.hw) + 1, toe = Math.ceil(F.toe) + 1, heel = Math.floor(F.heel) - 1, h = Math.ceil(F.h) + 1;
  for (let x = -hw - soleFlare; x <= hw + soleFlare; x++) for (let z = heel - soleFlare; z <= toe + soleFlare; z++) {
    if ((Math.abs(x) === hw + soleFlare && (z === heel - soleFlare || z === toe + soleFlare))) continue;
    m.set(x, 0, z, col(x, 0, z, 'sole'));
  }
  for (let y = 1; y <= h; y++)
    for (let x = -hw; x <= hw; x++)
      for (let z = heel; z <= toe; z++) {
        // toe slopes down toward the tip
        const toeTop = h - Math.max(0, z - (toe - 4)) * 0.8;
        if (y > toeTop) continue;
        const shell = Math.abs(x) === hw || z === heel || z === toe || y >= toeTop - 0.9;
        if (!shell) continue;
        if (Math.abs(x) === hw && (z === heel || z === toe)) continue;
        m.set(x, y, z, col(x, y, z, 'foot'));
      }
  const sx = Math.ceil(F.shinHW) + 1, s0 = Math.floor(F.shinZ0) - 1, s1 = Math.ceil(F.shinZ1) + 1;
  for (let y = h; y <= h + shaft; y++)
    for (let x = -sx; x <= sx; x++)
      for (let z = s0; z <= s1; z++) {
        if (!(Math.abs(x) === sx || z === s0 || z === s1)) continue;
        if (Math.abs(x) === sx && (z === s0 || z === s1)) continue;
        m.set(x, y, z, col(x, y, z, 'shaft'));
      }
  return { hw, toe, heel, h, sx, s0, s1 };
}

/** iron spurs: heel band, shank and a spinning star rowel; a leather strap over the instep */
function ironSpurs(fit: GearFit): GearPiece[] {
  const F = fit.foot;
  const out: GearPiece[] = [];
  for (const s of [1, -1]) {
    const side = s > 0 ? 'l' : 'r';
    const m = new VoxelModel('gear_spur');
    const hw = Math.ceil(F.hw) + 1, heel = Math.floor(F.heel) - 1;
    const y = 2;
    for (let z = heel; z <= heel + 3; z++) for (const x of [-hw, hw]) m.set(x, y, z, z === heel + 3 ? IR.shade : IR.base, M);
    for (let x = -hw; x <= hw; x++) m.set(x, y, heel, IR.hi, M);
    // instep strap
    for (let x = -hw; x <= hw; x++) m.set(x, Math.ceil(F.h) + 1, Math.round(F.toe * 0.25), LE.base);
    for (let yy = y; yy <= Math.ceil(F.h); yy++) for (const x of [-hw, hw]) m.set(x, yy, Math.round(F.toe * 0.25), LE.shade);
    rivet(m, s * hw, y, heel + 2, IR);
    // shank
    for (let k = 1; k <= 3; k++) m.set(0, y + (k > 2 ? 1 : 0), heel - k, IR.base, M);
    out.push(piece('spur_' + side, s > 0 ? 'foot_l' : 'foot_r', [0, 0, 0], m));
    const rw = new VoxelModel('gear_rowel');
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      for (let k = 1; k <= 3; k++) rw.set(0, Math.round(Math.sin(a) * k), Math.round(Math.cos(a) * k), k === 3 ? IR.hi : IR.base, M);
    }
    rw.set(0, 0, 0, BR.hi, M).set(1, 0, 0, IR.shade, M).set(-1, 0, 0, IR.shade, M);
    out.push(piece('rowel_' + side, s > 0 ? 'foot_l' : 'foot_r', [0, y + 1, heel - 5], rw, { joint: 'spin' }));
  }
  return out;
}

/** rattlesnake-skin boots: diamond scales, a snake-head toe cap and a rattle tassel that swings */
function rattlesnakeBoots(fit: GearFit): GearPiece[] {
  const F = fit.foot;
  const out: GearPiece[] = [];
  for (const s of [1, -1]) {
    const side = s > 0 ? 'l' : 'r';
    const m = new VoxelModel('gear_snake_boot');
    const b = bootShell(m, F, 7, (x, y, z, part) => {
      if (part === 'sole') return LD.dark;
      const d = ((y + z + 400) % 4 === 0) !== ((y - z + 400) % 4 === 0);
      if (part === 'shaft' && y === Math.ceil(F.h) + 8) return SNAKE.hi;
      return d ? SNAKE.dark : (x + y) % 3 === 0 ? SNAKE.hi : SNAKE.base;
    });
    // snake-head toe cap: a pointed tip with two little fang notches
    for (let x = -1; x <= 1; x++) m.set(x, 1, b.toe + 1, SNAKE.shade).set(x, 2, b.toe, SNAKE.base);
    m.set(0, 1, b.toe + 2, SNAKE.dark).set(-1, 0, b.toe + 1, BO.base).set(1, 0, b.toe + 1, BO.base);
    // underslung heel
    for (let x = -1; x <= 1; x++) m.set(x, -1, b.heel + 1, LD.dark).set(x, -1, b.heel + 2, LD.dark);
    // pull tabs
    for (const sx of [b.sx, -b.sx]) m.set(sx, b.h + 8, 0, LE.base).set(sx, b.h + 9, 0, LE.hi);
    out.push(piece('boot_' + side, s > 0 ? 'foot_l' : 'foot_r', [0, 0, 0], m));
    const rt = new VoxelModel('gear_rattle');
    for (let k = 0; k < 5; k++) {
      const w = k < 3 ? 1 : 0;
      for (let x = -w; x <= w; x++) rt.set(x, -k, 0, k % 2 ? SNAKE.shade : SNAKE.hi);
    }
    rt.set(0, 1, 0, LE.shade).set(0, 2, 0, LE.base);
    out.push(piece('rattle_' + side, s > 0 ? 'foot_l' : 'foot_r', [s * (b.sx - 1), b.h + 6, b.s0 - 1], rt, { joint: 'swing' }));
  }
  return out;
}

/** dune-striders: wrapped camel-hide with wide sand soles, bone toe caps and red tassels */
function duneStriders(fit: GearFit): GearPiece[] {
  const F = fit.foot;
  const out: GearPiece[] = [];
  for (const s of [1, -1]) {
    const m = new VoxelModel('gear_strider');
    const b = bootShell(m, F, 5, (_x, y, z, part) => {
      if (part === 'sole') return TOON.woodGrey.shade;
      const wrap = ((y * 2 + z + 400) % 5) < 2;
      return wrap ? CAMEL.shade : y % 2 ? CAMEL.base : CAMEL.hi;
    }, 1);
    for (let x = -b.hw + 1; x <= b.hw - 1; x++) m.set(x, 1, b.toe + 1, BO.base).set(x, 2, b.toe, BO.hi);
    for (const sx of [1, -1]) m.set(sx, b.h + 5, b.s1 + 1, TOON.red.base).set(sx, b.h + 4, b.s1 + 1, TOON.red.shade).set(sx, b.h + 3, b.s1 + 1, TOON.red.dark);
    out.push(piece('strider_' + (s > 0 ? 'l' : 'r'), s > 0 ? 'foot_l' : 'foot_r', [0, 0, 0], m));
  }
  return out;
}

// ================================================================== TOOLS (grappling hooks slung on the back)
/** a coil of twisted rope hung flat against the hip (axis along X), bound with a strap */
function ropeCoil(m: VoxelModel, rp: Ramp, bind: Ramp) {
  for (let loop = 0; loop < 3; loop++) {
    const R = 4.2 - loop * 0.35, x = 1 + loop;
    for (let i = 0; i < 40; i++) {
      const a = (i / 40) * Math.PI * 2;
      const y = Math.sin(a) * R - 4, z = Math.cos(a) * R;
      const c = (i + loop) % 3 === 0 ? rp.shade : (i + loop) % 3 === 1 ? rp.base : rp.hi;
      m.set(x, y, z, c).set(x + (i % 2), y, z, c);
    }
  }
  for (let x = 0; x <= 4; x++) for (const z of [-1, 0, 1]) m.set(x, 0, z, x === 0 || x === 4 ? bind.shade : bind.base);
  m.set(0, 1, 0, bind.dark).set(0, 2, 0, bind.base);
}

function barbedHookHead(): VoxelModel {
  const m = new VoxelModel('gear_barbed_hook');
  for (let y = 0; y >= -8; y--) m.set(0, y, 0, y % 3 === 0 ? IR.hi : IR.base, M);
  ringXY(m, 0, 1.5, 0, 0, 0.8, 1.6, () => IR.base, M);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const dx = Math.cos(a), dz = Math.sin(a);
    const pts: V3[] = [[0, -8, 0], [dx * 2, -9, dz * 2], [dx * 3.5, -7.5, dz * 3.5], [dx * 3.5, -5.5, dz * 3.5]];
    for (let k = 0; k < pts.length - 1; k++) m.line(...pts[k], ...pts[k + 1], k === 2 ? IR.hi : IR.base, 0, M);
    // the barb: a back-swept notch below each tip
    m.set(Math.round(dx * 2.6), -6, Math.round(dz * 2.6), IR.shade, M);
  }
  return m;
}

function clawHookHead(): VoxelModel {
  const m = new VoxelModel('gear_claw_hook');
  const BZ = r(0xb8803e, 0x8a5a26, 0xe0aa60, 0x4a2c10);
  for (let y = 0; y >= -6; y--) m.set(0, y, 0, BZ.base, M);
  ringXY(m, 0, 1.5, 0, 0, 0.8, 1.6, () => BZ.base, M);
  m.set(-1, -6, 0, BZ.shade, M).set(1, -6, 0, BZ.shade, M);
  for (const s of [1, -1]) {
    // a scorpion pincer: thick curved finger + inner thumb
    const pts: V3[] = [[s * 1, -6, 0], [s * 3, -8, 0], [s * 4, -10.5, 0], [s * 3, -12.5, 0], [s * 1.5, -13, 0]];
    m.tube(pts, 1.3, 0.5, BZ.base, M);
    m.set(s * 4, -10, 1, BZ.hi, M).set(s * 1.5, -13, 0, BZ.hi, M).set(s * 2, -11, 0, BZ.shade, M);
    m.tube([[s * 1, -7, 0], [s * 1.5, -9.5, 0], [s * 0.6, -11, 0]], 0.8, 0.4, BZ.shade, M);
  }
  return m;
}

function harpoonHead(): VoxelModel {
  const m = new VoxelModel('gear_harpoon');
  for (let y = 0; y >= -10; y--) m.set(0, y, 0, y % 2 ? TOON.silver.base : TOON.silver.hi, M);
  ringXY(m, 0, 1.5, 0, 0, 0.8, 1.6, () => COPPER.base, M);
  // glowing rune line up the shaft
  for (let y = -2; y >= -8; y -= 2) m.set(0, y, 1, SPARK, VF.EMISSIVE | VF.GLOW);
  // the head: a leaf blade with two back-swept barbs
  for (let y = -11; y >= -15; y--) {
    const w = y > -13 ? 2 : y === -13 ? 1 : 0;
    for (let x = -w; x <= w; x++) m.set(x, y, 0, x === 0 ? TOON.silver.hi : TOON.silver.base, M);
  }
  for (const s of [1, -1]) m.set(s * 2, -10, 0, TOON.silver.shade, M).set(s * 3, -9, 0, TOON.silver.base, M);
  m.set(0, -16, 0, 0xffffff, M);
  return m;
}

function hookTool(kind: 'barbed' | 'claw' | 'reel'): GearPiece[] {
  const coil = new VoxelModel('gear_coil_' + kind);
  if (kind === 'reel') {
    // brass reel: copper windings on a drum, spoked side plates, a crank and a spark jar
    for (let x = 0; x <= 4; x++)
      for (let i = 0; i < 36; i++) {
        const a = (i / 36) * Math.PI * 2;
        const rr = x === 0 || x === 4 ? 4.2 : 3.2;
        const c = x === 0 || x === 4 ? (i % 6 === 0 ? BR.hi : BR.base) : (x + i) % 2 ? COPPER.base : COPPER.hi;
        coil.set(x, Math.sin(a) * rr - 4, Math.cos(a) * rr, c, M);
        if (x === 0 || x === 4) for (let k = 1; k < 4; k++) if (i % 9 === 0) coil.set(x, Math.sin(a) * k - 4, Math.cos(a) * k, BR.shade, M);
      }
    for (let x = 0; x <= 4; x++) coil.set(x, -4, 0, BR.dark, M);
    coil.set(5, -4, 0, BR.base, M).set(6, -4, 0, BR.base, M).set(6, -5, 0, BR.base, M).set(6, -6, 0, BR.base, M).set(7, -6, 0, LE.hi);
    for (let x = 0; x <= 4; x++) for (const z of [-1, 0, 1]) coil.set(x, 0, z, LD.base);
  } else ropeCoil(coil, kind === 'claw' ? r(0x8a6a48, 0x6a4e34, 0xa8865e, 0x3e2c1a) : ROPE, kind === 'claw' ? TOON.red : LD);
  const head = kind === 'barbed' ? barbedHookHead() : kind === 'claw' ? clawHookHead() : harpoonHead();
  // a short tail of rope from the coil to the hook's eye
  rope(coil, [[3, -8, 1], [4, -9, 2.5], [4, -10, 3]], 0);
  const pieces: GearPiece[] = [piece('coil', 'sling', [0, 0, 0], coil), piece('hook', 'sling', [4, -11, 3], head, { joint: 'hook' })];
  if (kind === 'reel') {
    const jar = new VoxelModel('gear_reel_jar');
    for (let y = 0; y <= 4; y++) for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++) if (Math.abs(x) + Math.abs(z) < 2 || y === 0 || y === 4) jar.set(x, y, z, CLEAR.base);
    const arc = new VoxelModel('gear_reel_arc');
    for (let y = 0; y <= 4; y++) arc.set(y % 2 ? 0 : (y & 2 ? 1 : -1) * 0, y, 0, y === 2 ? 0xffffff : SPARK, VF.EMISSIVE | VF.GLOW);
    arc.set(0, -1, 0, COPPER.base, M).set(0, 5, 0, COPPER.base, M);
    pieces.push(piece('jar', 'sling', [2, -1, -3], jar, { glass: true }), piece('arc', 'sling', [2, -1, -3], arc));
  }
  return pieces;
}

// ================================================================== CHARMS (swing on a neck cord)
const CHARM_AT: V3 = [0, 0, 4];
/** the cord: from the charm's ring up over the collarbones and round the back of the neck */
function neckCord(rp: Ramp): GearPiece {
  const m = new VoxelModel('gear_neck_cord');
  for (const s of [1, -1]) rope(m, [[0, 0, 4], [s * 2, 4, 3], [s * 4 - 2, 8, 1], [s * 4 - 3.5, 11, -3]], 0, rp);
  return piece('cord', 'neck', [0, 0, 0], m);
}
/** a lucky glass eye in a gold claw on a short chain, under a clear glass dome */
function glassEye(): GearPiece[] {
  const m = new VoxelModel('gear_glass_eye');
  chain(m, [0, 0, 0], [0, -4, 0], GO);
  const cy = -8;
  // four gold claws gripping the eye
  for (const [dx, dz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]] as [number, number][]) {
    m.set(dx * 2, cy + 3, dz * 2, GO.base, M).set(dx * 3, cy + 1, dz * 2, GO.hi, M).set(dx * 3, cy - 1, dz * 2, GO.shade, M);
  }
  m.set(0, -5, 0, GO.base, M).set(0, cy + 3, 0, GO.hi, M);
  // the eye: porcelain sclera, faint veins, a turquoise iris with a dark pupil and a wet highlight
  const R = 2.6;
  for (let x = -3; x <= 3; x++)
    for (let y = -3; y <= 3; y++)
      for (let z = -3; z <= 3; z++) {
        const d = Math.hypot(x, y, z);
        if (d > R + 0.35) continue;
        const front = z >= 1 && Math.hypot(x, y) < 2.6;
        let c = 0xf6f0e6;
        if (front) {
          const ir = Math.hypot(x, y);
          c = ir < 0.8 ? 0x14100e : ir < 1.9 ? (x + y < 0 ? 0x3fbfae : 0x2a8a80) : 0xf6f0e6;
          if (x === -1 && y === 1 && z >= 2) c = 0xffffff;
        } else if (hash3(x + 110, y, z) > 0.86) c = 0xe4b0a8;
        m.set(x, cy + y, z, c, M);
      }
  const dome = new VoxelModel('gear_eye_dome');
  for (let x = -4; x <= 4; x++) for (let y = -4; y <= 4; y++) for (let z = 1; z <= 4; z++) {
    const d = Math.hypot(x, y, z - 0.5);
    if (d > 3.6 && d < 4.5 && z >= 2) dome.set(x, cy + y, z, (x < 0 && y > 0) ? CLEAR.hi : CLEAR.base);
  }
  return [neckCord(GO), piece('eye', 'neck', CHARM_AT, m, { joint: 'swing', group: 'charm' }), piece('dome', 'neck', CHARM_AT, dome, { glass: true, joint: 'swing', group: 'charm' })];
}

/** Khonsu's hourglass: moon-silver frame and crescent, glass bulbs, golden sand running */
function hourglass(): GearPiece[] {
  const fr = new VoxelModel('gear_hourglass');
  const S = TOON.silver;
  chain(fr, [0, 0, 0], [0, -3, 0], S);
  const top = -4, bot = -15;
  for (const y of [top, bot]) for (let x = -3; x <= 3; x++) for (let z = -3; z <= 3; z++) if (Math.hypot(x, z) <= 3.2) fr.set(x, y, z, y === top ? S.hi : S.shade, M);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.5;
    for (let y = bot + 1; y < top; y++) fr.set(Math.round(Math.cos(a) * 2.8), y, Math.round(Math.sin(a) * 2.8), y % 3 ? S.base : S.hi, M);
  }
  // crescent moon crest
  for (const [x, y] of [[-2, 1], [-2, 2], [-1, 3], [0, 3], [1, 3], [-1, 0], [-3, 2]] as [number, number][]) fr.set(x, top + y, 0, 0xe8f0ff, M);
  const gl = new VoxelModel('gear_hourglass_glass');
  const sand = new VoxelModel('gear_hourglass_sand');
  const mid = (top + bot) / 2;
  for (let y = bot + 1; y < top; y++) {
    const t = Math.abs(y - mid) / ((top - bot) / 2 - 1);
    const rr = 0.6 + 1.9 * Math.sin(Math.min(1, t) * Math.PI * 0.5);
    for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) {
      const d = Math.hypot(x, z);
      if (d > rr + 0.3) continue;
      const inSand = (y < mid && y <= bot + 3) || (y > mid && y >= top - 2 && y <= top - 1 && d < rr - 0.5);
      if (inSand) sand.set(x, y, z, (x + z + y) % 3 ? 0xf2c870 : 0xd8a850);
      else if (d > rr - 0.8) gl.set(x, y, z, x < 0 ? CLEAR.hi : CLEAR.base);
    }
  }
  for (let y = bot + 4; y <= mid + 1; y++) sand.set(0, y, 0, 0xffd880, VF.EMISSIVE);
  return [neckCord(TOON.silver), piece('frame', 'neck', CHARM_AT, fr, { joint: 'swing', group: 'charm' }), piece('sand', 'neck', CHARM_AT, sand, { joint: 'swing', group: 'charm' }), piece('glass', 'neck', CHARM_AT, gl, { glass: true, joint: 'swing', group: 'charm' })];
}

/** the dead man's hand: a little skeletal hand gripping aces and eights, on a black cord */
function deadMansHand(): GearPiece[] {
  const m = new VoxelModel('gear_dead_hand');
  for (let y = 0; y >= -3; y--) m.set(0, y, 0, LACQ.base);
  m.set(-1, -1, 0, LACQ.hi).set(1, -1, 0, LACQ.hi);
  // cards fanned behind the hand (thin slabs, ivory faces, red backs, black pips)
  const cards = [-0.5, -0.17, 0.17, 0.5];
  cards.forEach((a, i) => {
    for (let h = 0; h <= 7; h++)
      for (let w = -2; w <= 2; w++) {
        const x = Math.round(Math.sin(a) * h + Math.cos(a) * w), y = -12 + Math.round(Math.cos(a) * h - Math.sin(a) * w * 0.3);
        const z = -1 + i * 0.5;
        const pip = (h === 5 && w === 0) || (i % 2 === 1 && h === 2 && Math.abs(w) === 1);
        const edge = Math.abs(w) === 2 || h === 7 || h === 0;
        m.set(x, y, Math.round(z), pip ? 0x161210 : edge ? 0xe8dcc0 : 0xf8f0dc);
        m.set(x, y, Math.round(z) - 1, edge ? TOON.red.shade : TOON.red.base);
      }
  });
  // the hand: palm, four curled finger bones over the cards, a thumb
  for (let x = -2; x <= 2; x++) for (let y = -10; y <= -7; y++) m.set(x, y, 1, y === -7 ? BO.hi : BO.base).set(x, y, 0, BO.shade);
  for (let f = 0; f < 4; f++) {
    const x = -2 + f * 1.3;
    m.set(x, -6, 2, BO.base).set(x, -6, 3, BO.hi).set(x, -7, 3, BO.base).set(x, -8, 3, BO.shade);
  }
  m.set(3, -9, 2, BO.base).set(3, -8, 3, BO.hi).set(2, -7, 3, BO.base);
  // wrist bones and a black ribbon bow
  m.set(-1, -11, 0, BO.shade).set(1, -11, 0, BO.shade).set(0, -4, 1, LACQ.dark).set(-2, -4, 1, LACQ.base).set(2, -4, 1, LACQ.base).set(-1, -5, 1, LACQ.hi).set(1, -5, 1, LACQ.hi);
  return [neckCord(LACQ), piece('hand', 'neck', CHARM_AT, m, { joint: 'swing', group: 'charm' })];
}


// ================================================================== SKINNED PIECES
// Gloves, boots and body armour are sculpted straight onto the hero's own part
// voxels (same grid, same pivot), slice by slice, so they hug bony hands, jean
// legs and the jacket exactly, whatever the hero looks like.

const SKIN_PARTS: SkinPartName[] = ['fore_l', 'fore_r', 'shin_l', 'shin_r', 'torso'];

/** pull the skinnable parts (and hand sockets) out of a rig spec */
export function partsFromSpec(spec: RigSpec): Partial<Record<SkinPartName, SkinPart>> {
  const out: Partial<Record<SkinPartName, SkinPart>> = {};
  for (const p of spec.parts) if ((SKIN_PARTS as string[]).includes(p.name)) out[p.name as SkinPartName] = { model: p.model, pivot: p.pivot, vs: spec.voxelSize };
  for (const [k, part] of [['hand_l', 'fore_l'], ['hand_r', 'fore_r']] as const) {
    const sk = spec.sockets?.[k];
    if (sk && sk.part === part && out[part]) out[part]!.sock = sk.at;
  }
  return out;
}

let REF: Partial<Record<SkinPartName, SkinPart>> | null = null;
/** Sundown's default body, for showcase models (drops, shop, HUD, card photos) */
export function referenceParts() {
  if (!REF) {
    try {
      REF = partsFromSpec(skeletonCowboyRig({ hat: 'stetson', outfit: 'punk' } as any));
    } catch {
      REF = {};
    }
  }
  return REF;
}

interface Slice { n: number; x0: number; x1: number; z0: number; z1: number }
function slices(m: VoxelModel) {
  const S = new Map<number, Slice>();
  m.forEach((x, y, z) => {
    const r = S.get(y);
    if (!r) S.set(y, { n: 1, x0: x, x1: x, z0: z, z1: z });
    else {
      r.n++;
      if (x < r.x0) r.x0 = x;
      if (x > r.x1) r.x1 = x;
      if (z < r.z0) r.z0 = z;
      if (z > r.z1) r.z1 = z;
    }
  });
  return S;
}
/** a slice at y, or the nearest one below/above */
function sliceAt(S: Map<number, Slice>, y: number) {
  for (let d = 0; d < 6; d++) {
    const a = S.get(y - d) ?? S.get(y + d);
    if (a) return a;
  }
  return null;
}
/** solid rounded rectangle in the XZ plane at height y (corners cut) */
function slab(m: VoxelModel, y: number, x0: number, x1: number, z0: number, z1: number, col: (x: number, z: number, edge: boolean) => number, cut = 1, flags?: number) {
  for (let x = x0; x <= x1; x++)
    for (let z = z0; z <= z1; z++) {
      const dx = Math.min(x - x0, x1 - x), dz = Math.min(z - z0, z1 - z);
      if (dx + dz < cut) continue;
      m.set(x, y, z, col(x, z, dx === 0 || dz === 0), flags);
    }
}
/** front (sign +1) or back (−1) surface z of every (x, y) column of a part */
function surface(m: VoxelModel, sign: 1 | -1) {
  const S = new Map<number, number>();
  m.forEach((x, y, z) => {
    const k = (x + 512) * 1024 + (y + 512);
    const o = S.get(k);
    if (o === undefined || (sign > 0 ? z > o : z < o)) S.set(k, z);
  });
  return (x: number, y: number) => S.get((x + 512) * 1024 + (y + 512));
}

// ------------------------------------------------------------------ hands
function handLevels(part: SkinPart) {
  const S = slices(part.model);
  const ys = [...S.keys()].sort((a, b) => a - b);
  const sy = Math.round(part.sock?.[1] ?? (ys[0] + ys[ys.length - 1]) / 2);
  let maxN = 1;
  for (const y of ys) if (y >= sy && y <= sy + 8) maxN = Math.max(maxN, S.get(y)!.n);
  let wrist = Math.min(ys[ys.length - 1], sy + 9);
  for (const y of ys) if (y > sy + 2 && S.get(y)!.n <= Math.max(3, maxN * 0.3)) {
    wrist = y;
    break;
  }
  return { S, sy, wrist, top: ys[ys.length - 1] };
}

/** extents of the hand between two heights (the union, so the wrap reads as one piece of leather) */
function handBox(S: Map<number, Slice>, y0: number, y1: number) {
  const b = { x0: 1e9, x1: -1e9, z0: 1e9, z1: -1e9 };
  for (let y = y0; y <= y1; y++) {
    const s = S.get(y);
    if (!s) continue;
    b.x0 = Math.min(b.x0, s.x0);
    b.x1 = Math.max(b.x1, s.x1);
    b.z0 = Math.min(b.z0, s.z0);
    b.z1 = Math.max(b.z1, s.z1);
  }
  return b;
}

/**
 * fingerless glove on a skeletal hand: a leather wrap over the back of the hand and
 * palm (finger bones stay bare), and a gauntlet cuff that flares up the forearm
 */
function skinGlove(part: SkinPart, out: 1 | -1, rp: Ramp, o: { cuff: number; flare: number; studs?: Ramp; fringe?: boolean; bands?: Ramp }) {
  const m = new VoxelModel('gear_skin_glove');
  const { S, sy, wrist } = handLevels(part);
  const w0 = sy + 1, w1 = wrist - 1;
  const hb = handBox(S, w0, w1);
  // the wrap tapers a little toward the knuckles: per-row extents blended with the union
  for (let y = w0; y <= w1; y++) {
    const s = sliceAt(S, y) ?? { x0: hb.x0, x1: hb.x1, z0: hb.z0, z1: hb.z1, n: 0 };
    const k = (y - w0) / Math.max(1, w1 - w0);
    const x0 = Math.round(s.x0 * (1 - k) * 0.5 + hb.x0 * (0.5 + k * 0.5)) - 1, x1 = Math.round(s.x1 * (1 - k) * 0.5 + hb.x1 * (0.5 + k * 0.5)) + 1;
    const z0 = Math.min(s.z0, hb.z0 + 1) - 1, z1 = Math.max(s.z1, hb.z1 - 1) + 1;
    slab(m, y, x0, x1, z0, z1, (x, z, edge) => {
      const back = out > 0 ? x === x1 : x === x0;
      if (y === w0 && edge) return rp.dark; // rolled edge over the knuckles
      if (back && (y + z) % 2 === 0 && z === Math.round((z0 + z1) / 2)) return TOON.linen.base; // stitched seam
      return back ? rp.hi : y === w1 ? rp.shade : rp.base;
    });
    if (o.studs && y === w0 + 1) for (let z = z0 + 1; z <= z1 - 1; z += 2) m.set(out > 0 ? x1 + 1 : x0 - 1, y, z, o.studs.hi, M);
  }
  // gauntlet cuff up the forearm
  const fb = handBox(S, wrist, wrist + o.cuff);
  for (let k = 0; k < o.cuff; k++) {
    const y = wrist + k;
    const g = Math.round((k / Math.max(1, o.cuff - 1)) * o.flare);
    const x0 = fb.x0 - 1 - g, x1 = fb.x1 + 1 + g, z0 = fb.z0 - 1 - g, z1 = fb.z1 + 1 + g;
    slab(m, y, x0, x1, z0, z1, (_x, _z, edge) => (k === o.cuff - 1 ? (edge ? rp.hi : rp.shade) : o.bands && k % 2 === 1 ? o.bands.base : edge ? rp.base : rp.shade), 1);
    if (o.fringe && k === o.cuff - 1) for (let z = z0 + 1; z <= z1 - 1; z += 2) for (let f = 1; f <= 3; f++) m.set(out > 0 ? x1 + 1 : x0 - 1, y - f, z, f === 3 ? rp.shade : rp.base);
  }
  return { m, sy, wrist, hb, fb };
}

function skinGloves(P: Partial<Record<SkinPartName, SkinPart>>): GearPiece[] | null {
  if (!P.fore_l || !P.fore_r) return null;
  const l = skinGlove(P.fore_l, 1, LE, { cuff: 5, flare: 1, studs: BR, fringe: true });
  const r = skinGlove(P.fore_r, -1, LE, { cuff: 5, flare: 1, studs: BR, fringe: true });
  return [piece('glove_l', 'hand_l', P.fore_l.pivot, l.m, { skin: 'fore_l' }), piece('glove_r', 'hand_r', P.fore_r.pivot, r.m, { skin: 'fore_r' })];
}

function skinStinger(P: Partial<Record<SkinPartName, SkinPart>>): GearPiece[] | null {
  if (!P.fore_l || !P.fore_r) return null;
  const g = skinGlove(P.fore_l, 1, CHIT, { cuff: 7, flare: 1, bands: r(0x6e3c16, 0x5a3012, 0x8a5020, 0x2e1608) });
  const m = g.m;
  // the stinger: chitin segments arching from the cuff over the back of the hand to a venom bulb
  const bx = g.hb.x1 + 2, mz = Math.round((g.fb.z0 + g.fb.z1) / 2);
  const segs: V3[] = [[bx - 1, g.wrist + 5, mz], [bx + 1, g.wrist + 3, mz], [bx + 2, g.wrist, mz + 1], [bx + 2, g.sy + 2, mz + 2], [bx + 1, g.sy, mz + 3]];
  segs.forEach(([x, y, z], i) => {
    const rr = 1.5 - i * 0.15;
    m.ellipsoid(x, y, z, rr, rr, rr, i % 2 ? CHIT.shade : CHIT.base);
    m.set(x + 1, y + 1, z, CHIT.hi);
  });
  const [ex, ey, ez] = segs[segs.length - 1];
  m.ellipsoid(ex, ey - 2, ez + 1, 1.5, 1.5, 1.5, TOON.serket.base, VF.EMISSIVE);
  m.set(ex - 1, ey - 2, ez + 2, TOON.serket.hi, VF.EMISSIVE);
  m.set(ex - 1, ey - 4, ez + 2, LACQ.dark).set(ex - 1, ey - 5, ez + 3, LACQ.base);
  // a matching chitin bracer on the gun hand
  const rr = handLevels(P.fore_r);
  const c = new VoxelModel('gear_skin_cuff');
  const fb = handBox(rr.S, rr.wrist, rr.wrist + 3);
  for (let k = 0; k < 3; k++) slab(c, rr.wrist + k, fb.x0 - 1, fb.x1 + 1, fb.z0 - 1, fb.z1 + 1, (_x, _z, e) => (k === 1 ? CHIT.shade : e ? CHIT.hi : CHIT.base));
  return [piece('gauntlet', 'hand_l', P.fore_l.pivot, m, { skin: 'fore_l' }), piece('cuff', 'hand_r', P.fore_r.pivot, c, { skin: 'fore_r' })];
}

function skinKnuckles(P: Partial<Record<SkinPartName, SkinPart>>): GearPiece[] | null {
  if (!P.fore_l || !P.fore_r) return null;
  const make = (part: SkinPart) => {
    const m = new VoxelModel('gear_skin_knuckles');
    const { S, sy, wrist } = handLevels(part);
    // brass rings over the finger bones just below the knuckles, joined by a grip bar
    const yk = sy - 1;
    const s = sliceAt(S, yk);
    if (s) {
      const zf = s.z1 + 1;
      for (let x = s.x0 - 1; x <= s.x1 + 1; x++) m.set(x, yk - 2, zf, BR.shade, M).set(x, yk - 2, zf - 1, BR.base, M);
      const n = 4;
      for (let i = 0; i < n; i++) {
        const cx = Math.round(s.x0 + ((i + 0.5) / n) * (s.x1 - s.x0 + 1) - 0.5);
        for (const [dx, dy] of [[0, 1], [-1, 0], [1, 0], [0, -1]] as [number, number][]) m.set(cx + dx, yk + dy, zf + 1, dy > 0 ? BR.hi : BR.base, M);
        m.set(cx, yk, zf, BR.shade, M);
      }
    }
    // linen tape round the wrist
    const fb = handBox(S, wrist - 1, wrist + 2);
    for (let k = 0; k < 3; k++) slab(m, wrist - 1 + k, fb.x0 - 1, fb.x1 + 1, fb.z0 - 1, fb.z1 + 1, (x, z) => ((x + z + k) % 3 ? LI.base : LI.shade));
    return m;
  };
  return [piece('knuckles_l', 'hand_l', P.fore_l.pivot, make(P.fore_l), { skin: 'fore_l' }), piece('knuckles_r', 'hand_r', P.fore_r.pivot, make(P.fore_r), { skin: 'fore_r' })];
}

// ------------------------------------------------------------------ feet
function footLevels(part: SkinPart) {
  const S = slices(part.model);
  const ys = [...S.keys()].sort((a, b) => a - b);
  const b = ys[0];
  const span = (y: number) => {
    const s = S.get(y);
    return s ? s.z1 - s.z0 : 0;
  };
  const base = Math.max(span(b), span(b + 1), span(b + 2));
  let ankle = b + 3;
  for (const y of ys) if (y > b && span(y) < base * 0.6) {
    ankle = y;
    break;
  }
  return { S, bottom: b, ankle, top: ys[ys.length - 1] };
}

/** a boot sculpted over the hero's own foot (slice by slice) with a shaft up the leg */
function skinBoot(part: SkinPart, shaft: number, col: (x: number, y: number, z: number, at: 'sole' | 'foot' | 'toe' | 'shaft' | 'rim', edge: boolean) => number, soleFlare = 0) {
  const m = new VoxelModel('gear_skin_boot');
  const { S, bottom, ankle, top } = footLevels(part);
  const leg = handBox(S, ankle, Math.min(top, ankle + shaft));
  let zt = -1e9;
  for (let y = bottom; y < ankle; y++) zt = Math.max(zt, S.get(y)?.z1 ?? -1e9);
  for (let y = bottom; y < ankle; y++) {
    const s = sliceAt(S, y)!;
    const fl = y === bottom ? soleFlare : 0;
    slab(m, y, s.x0 - 1 - fl, s.x1 + 1 + fl, s.z0 - 1 - fl, s.z1 + 1 + fl, (x, z, edge) => (y === bottom ? col(x, y, z, 'sole', edge) : z >= zt - 1 ? col(x, y, z, 'toe', edge) : col(x, y, z, 'foot', edge)));
  }
  for (let y = ankle; y < ankle + shaft; y++) {
    const s = S.get(y) ?? { x0: leg.x0, x1: leg.x1, z0: leg.z0, z1: leg.z1, n: 0 };
    slab(m, y, s.x0 - 1, s.x1 + 1, s.z0 - 1, s.z1 + 1, (x, z, edge) => col(x, y, z, y === ankle + shaft - 1 ? 'rim' : 'shaft', edge));
  }
  return { m, bottom, ankle, leg, zt };
}

function skinSnakeBoots(P: Partial<Record<SkinPartName, SkinPart>>): GearPiece[] | null {
  if (!P.shin_l || !P.shin_r) return null;
  const SK = r(0x8e6a3a, 0x6c4e28, 0xb08a52, 0x3e2a14);
  const out: GearPiece[] = [];
  for (const [part, side] of [[P.shin_l, 'l'], [P.shin_r, 'r']] as const) {
    const b = skinBoot(part, 7, (x, y, z, at, edge) => {
      if (at === 'sole') return LD.dark;
      if (at === 'rim') return SK.hi;
      if (at === 'toe') return edge ? SK.dark : SK.shade;
      // rattlesnake diamonds: a dark diamond chain down the boot, pale scales between
      const d = (((y + z) % 4) + 4) % 4 === 0 || (((y - z) % 4) + 4) % 4 === 0;
      return d ? SK.dark : hash3(x + 7, y, z) > 0.8 ? SK.hi : SK.base;
    });
    const m = b.m;
    // two little fangs at the toe tip, a stacked heel, pull tabs
    const s0 = sliceAt(P.shin_l === part ? slices(part.model) : slices(part.model), b.bottom)!;
    const cx = Math.round((s0.x0 + s0.x1) / 2);
    m.set(cx - 1, b.bottom, b.zt + 2, BO.base).set(cx + 1, b.bottom, b.zt + 2, BO.base);
    for (let x = s0.x0; x <= s0.x1; x++) m.set(x, b.bottom - 1, s0.z0, LD.dark).set(x, b.bottom - 1, s0.z0 + 1, LD.dark);
    for (const tx of [b.leg.x0 - 1, b.leg.x1 + 1]) m.set(tx, b.ankle + 7, Math.round((b.leg.z0 + b.leg.z1) / 2), LE.hi);
    out.push(piece('boot_' + side, side === 'l' ? 'foot_l' : 'foot_r', part.pivot, m, { skin: side === 'l' ? 'shin_l' : 'shin_r' }));
    // the rattle tassel swinging at the back of the shaft
    const rt = new VoxelModel('gear_skin_rattle');
    for (let k = 0; k < 6; k++) {
      const w = k < 4 ? 1 : 0;
      for (let x = -w; x <= w; x++) rt.set(x, -k, 0, k % 2 ? 0xd8c090 : 0xb89a66);
    }
    rt.set(0, 1, 0, LE.shade);
    const at: V3 = [b.leg.x0 + (side === 'l' ? b.leg.x1 - b.leg.x0 : 0), b.ankle + 5, b.leg.z0 - 2];
    // re-centre the rattle around its pivot (pieces with a joint are built around `at`)
    const rr = new VoxelModel('gear_skin_rattle_at');
    rt.forEach((x, y, z, c, f) => rr.set(x + at[0], y + at[1], z + at[2], c, f));
    out.push(piece('rattle_' + side, side === 'l' ? 'foot_l' : 'foot_r', at, rr, { skin: side === 'l' ? 'shin_l' : 'shin_r', joint: 'swing' }));
  }
  return out;
}

function skinStriders(P: Partial<Record<SkinPartName, SkinPart>>): GearPiece[] | null {
  if (!P.shin_l || !P.shin_r) return null;
  const out: GearPiece[] = [];
  for (const [part, side] of [[P.shin_l, 'l'], [P.shin_r, 'r']] as const) {
    const b = skinBoot(part, 5, (_x, y, z, at, edge) => {
      if (at === 'sole') return edge ? TOON.woodGrey.shade : TOON.woodGrey.base;
      if (at === 'toe') return edge ? BO.shade : BO.base;
      if (at === 'rim') return CAMEL.hi;
      return (((y * 2 + z) % 5) + 5) % 5 < 2 ? CAMEL.shade : y % 2 ? CAMEL.base : CAMEL.hi;
    }, 1);
    for (const dx of [-1, 1]) {
      const x = Math.round((b.leg.x0 + b.leg.x1) / 2) + dx;
      b.m.set(x, b.ankle + 4, b.leg.z1 + 2, TOON.red.base).set(x, b.ankle + 3, b.leg.z1 + 2, TOON.red.shade).set(x, b.ankle + 2, b.leg.z1 + 2, TOON.red.dark);
    }
    out.push(piece('strider_' + side, side === 'l' ? 'foot_l' : 'foot_r', part.pivot, b.m, { skin: side === 'l' ? 'shin_l' : 'shin_r' }));
  }
  return out;
}

// ------------------------------------------------------------------ torso
function torsoLevels(part: SkinPart) {
  const S = slices(part.model);
  const ys = [...S.keys()].sort((a, b) => a - b);
  // the body proper: rows wide enough to be the chest (skips the waist stub and the collar)
  let maxW = 0;
  for (const y of ys) maxW = Math.max(maxW, S.get(y)!.x1 - S.get(y)!.x0);
  const body = ys.filter((y) => S.get(y)!.x1 - S.get(y)!.x0 > maxW * 0.6);
  const y0 = body[0] ?? ys[0], y1 = body[body.length - 1] ?? ys[ys.length - 1];
  const cx = (S.get(Math.round((y0 + y1) / 2))?.x0 ?? 0) / 2 + (S.get(Math.round((y0 + y1) / 2))?.x1 ?? 0) / 2;
  return { S, y0, y1, cx, front: surface(part.model, 1), back: surface(part.model, -1) };
}

/** a carapace shell over the front (and a smaller one over the back) that follows the jacket */
function skinScarabPlate(P: Partial<Record<SkinPartName, SkinPart>>): GearPiece[] | null {
  const part = P.torso;
  if (!part) return null;
  const L = TOON.lapis;
  const T = torsoLevels(part);
  const m = new VoxelModel('gear_skin_scarab');
  const top = T.y1 - 3, bot = T.y0 + Math.round((T.y1 - T.y0) * 0.12);
  const shell = (sign: 1 | -1, scale: number) => {
    const surf = sign > 0 ? T.front : T.back;
    for (let y = bot; y <= top; y++) {
      const s = sliceAt(T.S, y)!;
      const v = (y - (top + bot) / 2) / ((top - bot) / 2);
      const hw = ((s.x1 - s.x0) / 2) * scale * (0.8 - 0.14 * v * v - (v > 0.55 ? (v - 0.55) * 0.8 : 0));
      const W = Math.round(hw);
      for (let x = Math.round(T.cx - W); x <= Math.round(T.cx + W); x++) {
        const z0 = surf(x, y);
        if (z0 === undefined) continue;
        const u = (x - T.cx) / Math.max(1, hw);
        const rim = Math.abs(x - T.cx) >= W - 0.5 || y === top || y === bot;
        const seam = Math.abs(x - T.cx) < 0.6 && sign > 0;
        const ridge = Math.abs(Math.abs(x - T.cx) - Math.round(hw * 0.5)) < 0.5;
        const t = 2 + (rim ? 0 : Math.round((1 - u * u) * (1 - v * v) * 1.6));
        for (let k = 1; k <= t; k++) {
          const z = z0 + sign * k;
          const surfV = k === t;
          let c = L.shade, f: number | undefined;
          if (surfV) {
            if (rim) (c = GO.base), (f = M);
            else if (seam) (c = GO.shade), (f = M);
            else if (ridge) c = L.hi;
            else c = v > 0.35 ? L.hi : v < -0.5 ? L.shade : L.base;
          }
          m.set(x, y, z, c, f);
        }
      }
    }
  };
  shell(1, 1);
  shell(-1, 0.85);
  // scarab head at the collar with turquoise eyes, forelegs hugging the neckline
  const cz = (T.front(Math.round(T.cx), top) ?? 0) + 2;
  m.ellipsoid(Math.round(T.cx), top + 1, cz, 3, 1.8, 1.8, GO.base, M);
  m.set(Math.round(T.cx) - 1, top + 3, cz + 1, GO.hi, M).set(Math.round(T.cx) + 1, top + 3, cz + 1, GO.hi, M).set(Math.round(T.cx) - 2, top + 1, cz + 2, TOON.turquoise.base).set(Math.round(T.cx) + 2, top + 1, cz + 2, TOON.turquoise.base);
  for (const s of [1, -1])
    for (let i = 0; i < 7; i++) {
      const x = Math.round(T.cx + s * (3 + i));
      const z = (T.front(x, top) ?? cz - 2) + 1;
      m.set(x, top + 1 - Math.round(Math.sin((i / 6) * Math.PI) * 1.5), z, i === 6 ? GO.hi : GO.base, M);
    }
  // leather straps round the sides at two heights, with brass buckles
  for (const y of [bot + 2, Math.round((top + bot) / 2) + 3]) {
    const s = sliceAt(T.S, y)!;
    for (let z = s.z0 - 1; z <= s.z1 + 1; z++)
      for (const x of [s.x0 - 1, s.x1 + 1]) m.set(x, y, z, z === Math.round((s.z0 + s.z1) / 2) ? BR.hi : LD.base, z === Math.round((s.z0 + s.z1) / 2) ? M : undefined);
  }
  return [piece('plate', 'torso', part.pivot, m, { skin: 'torso' })];
}

/** linen turns wound around the jacket (tilted, crossing), two loose tails that swing */
function skinMummyWrap(P: Partial<Record<SkinPartName, SkinPart>>): GearPiece[] | null {
  const part = P.torso;
  if (!part) return null;
  const T = torsoLevels(part);
  const m = new VoxelModel('gear_skin_wrap');
  const col = (x: number, y: number, z: number) => {
    const h = hash3(x + 70, y, z);
    return h < 0.07 ? 0xb8a47a : (((y + x) % 5) + 5) % 5 === 0 ? LI.shade : h > 0.82 ? LI.hi : LI.base;
  };
  const turns = 5;
  for (let i = 0; i < turns; i++) {
    const yc = Math.round(T.y0 + 2 + (i / (turns - 1)) * (T.y1 - T.y0 - 6));
    const tilt = i % 2 ? 0.2 : -0.2;
    const s = sliceAt(T.S, yc)!;
    for (let x = s.x0 - 1; x <= s.x1 + 1; x++)
      for (let h = 0; h < 2; h++) {
        const y = yc + h + Math.round((x - T.cx) * tilt);
        const zf = T.front(x, y), zb = T.back(x, y);
        if (zf !== undefined) m.set(x, y, zf + 1, col(x, y, zf + 1));
        if (zb !== undefined) m.set(x, y, zb - 1, col(x, y, zb - 1));
        if (x === s.x0 - 1 || x === s.x1 + 1) {
          const ss = sliceAt(T.S, y) ?? s;
          for (let z = ss.z0; z <= ss.z1; z++) m.set(x, y, z, col(x, y, z));
        }
      }
  }
  const tails: GearPiece[] = [];
  const yb = T.y0 + 3;
  for (const [i, sx] of [[0, 3], [1, -4]] as [number, number][]) {
    const x = Math.round(T.cx + sx);
    const z = (T.back(x, yb) ?? 0) - 2;
    const t = new VoxelModel('gear_skin_tail');
    for (let k = 0; k <= 9; k++) {
      const dx = Math.round(Math.sin(k * 0.55 + i) * 1.1);
      t.set(x + dx, yb - k, z, col(x + dx, yb - k, i)).set(x + dx + 1, yb - k, z, k % 3 ? LI.base : LI.shade);
    }
    tails.push(piece('tail' + i, 'torso', [x, yb, z], t, { skin: 'torso', joint: 'swing' }));
  }
  return [piece('wraps', 'torso', part.pivot, m, { skin: 'torso' }), ...tails];
}

/** cactus-hide panels over the jacket: ribs, spine tufts, a bloom, rawhide lacing across an open front */
function skinCactusJerkin(P: Partial<Record<SkinPartName, SkinPart>>): GearPiece[] | null {
  const part = P.torso;
  if (!part) return null;
  const T = torsoLevels(part);
  const m = new VoxelModel('gear_skin_jerkin');
  const top = T.y1 - 2, bot = T.y0 + 1;
  for (const sign of [1, -1] as const) {
    const surf = sign > 0 ? T.front : T.back;
    for (let y = bot; y <= top; y++) {
      const s = sliceAt(T.S, y)!;
      for (let x = s.x0; x <= s.x1; x++) {
        const dx = x - T.cx;
        if (sign > 0 && Math.abs(dx) < 1.2 + Math.max(0, y - bot) * 0.22) continue; // the open V front
        const z0 = surf(x, y);
        if (z0 === undefined) continue;
        const rib = ((Math.round(dx) % 3) + 3) % 3 === 1;
        const z = z0 + sign;
        m.set(x, y, z, y === bot ? CACT.dark : rib ? CACT.hi : y === top ? CACT.hi : CACT.base);
        if (rib && (y - bot) % 4 === 2 && hash3(x + 30, y, sign) > 0.4) m.set(x, y, z + sign, TOON.white.base).set(x + (dx > 0 ? 1 : -1), y + 1, z + sign * 2, TOON.white.hi);
      }
    }
  }
  // rawhide lacing across the V and a desert bloom on the left breast
  for (let y = bot + 2; y <= Math.round((top + bot) / 2); y += 3) {
    const w = Math.round(1.2 + Math.max(0, y - bot) * 0.22);
    for (let x = Math.round(T.cx) - w; x <= Math.round(T.cx) + w; x++) {
      const z = (T.front(x, y) ?? 0) + 2;
      m.set(x, y, z, LE.hi);
    }
  }
  const fx = Math.round(T.cx + (T.S.get(top - 4)?.x1 ?? 8) * 0.45), fy = top - 5;
  const fz = (T.front(fx, fy) ?? 0) + 2;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]] as [number, number][]) m.set(fx + dx, fy + dy, fz, Math.abs(dx) + Math.abs(dy) === 2 ? TOON.flower.shade : TOON.flower.base);
  m.set(fx, fy, fz + 1, 0xffd84a).set(fx, fy, fz, TOON.flower.hi);
  return [piece('jerkin', 'torso', part.pivot, m, { skin: 'torso' })];
}

// ================================================================== registry
export type GearModelId =
  | 'sunGoggles' | 'thothSpecs' | 'jackalMask' | 'respirator'
  | 'scarabPlate' | 'mummyWrap' | 'bonePauldrons' | 'cactusJerkin'
  | 'gunslingerGloves' | 'stingerGauntlet' | 'brassKnuckles'
  | 'ironSpurs' | 'rattlesnakeBoots' | 'duneStriders'
  | 'barbedHook' | 'twinClaw' | 'lightningReel'
  | 'glassEye' | 'hourglass' | 'deadMansHand';

export const GEAR_MODEL_IDS: GearModelId[] = ['sunGoggles', 'thothSpecs', 'jackalMask', 'respirator', 'scarabPlate', 'mummyWrap', 'bonePauldrons', 'cactusJerkin', 'gunslingerGloves', 'stingerGauntlet', 'brassKnuckles', 'ironSpurs', 'rattlesnakeBoots', 'duneStriders', 'barbedHook', 'twinClaw', 'lightningReel', 'glassEye', 'hourglass', 'deadMansHand'];

/** the wearable pieces of one gear item, fitted to a body */
export function gearPieces(id: GearModelId, fit: GearFit = DEFAULT_FIT): GearPiece[] {
  const P = fit.parts ?? referenceParts();
  const skinned =
    id === 'gunslingerGloves' ? skinGloves(P)
    : id === 'stingerGauntlet' ? skinStinger(P)
    : id === 'brassKnuckles' ? skinKnuckles(P)
    : id === 'rattlesnakeBoots' ? skinSnakeBoots(P)
    : id === 'duneStriders' ? skinStriders(P)
    : id === 'scarabPlate' ? skinScarabPlate(P)
    : id === 'mummyWrap' ? skinMummyWrap(P)
    : id === 'cactusJerkin' ? skinCactusJerkin(P)
    : null;
  if (skinned) return skinned;
  switch (id) {
    case 'sunGoggles': return goggles(fit);
    case 'thothSpecs': return thothSpecs(fit);
    case 'jackalMask': return jackalMask(fit);
    case 'respirator': return respirator(fit);
    case 'scarabPlate': return scarabPlate(fit);
    case 'mummyWrap': return mummyWrap(fit);
    case 'bonePauldrons': return bonePauldrons();
    case 'cactusJerkin': return cactusJerkin(fit);
    case 'gunslingerGloves': return gunslingerGloves(fit);
    case 'stingerGauntlet': return stingerGauntlet(fit);
    case 'brassKnuckles': return brassKnuckles(fit);
    case 'ironSpurs': return ironSpurs(fit);
    case 'rattlesnakeBoots': return rattlesnakeBoots(fit);
    case 'duneStriders': return duneStriders(fit);
    case 'barbedHook': return hookTool('barbed');
    case 'twinClaw': return hookTool('claw');
    case 'lightningReel': return hookTool('reel');
    case 'glassEye': return glassEye();
    case 'hourglass': return hourglass();
    case 'deadMansHand': return deadMansHand();
  }
}

/** where each anchor sits in the showcase layout (pairs side by side, voxels) */
const SHOW: Record<GearAnchor, V3> = {
  face: [0, 0, 0], torso: [0, 0, 0], neck: [0, 0, -4], sling: [0, 0, 0],
  shoulder_l: [9, 0, 0], shoulder_r: [-9, 0, 0],
  hand_l: [6, 0, 0], hand_r: [-6, 0, 0],
  foot_l: [5, 0, 0], foot_r: [-5, 0, 0],
};

/** showcase offsets for skinned pairs (metres, side by side) */
const SKIN_SHOW: Record<SkinPartName, number> = { fore_l: 0.11, fore_r: -0.11, shin_l: 0.1, shin_r: -0.1, torso: 0 };

export interface DisplayPart {
  model: VoxelModel;
  voxelSize: number;
  /** voxel coords mapped to the origin when meshing */
  pivot: V3;
  /** where that origin sits in the showcase (metres) */
  pos: V3;
  glass: boolean;
}

/**
 * One showcase arrangement of a gear item for world drops, the shop, card photos
 * and the HUD: every piece where it sits on the body, pairs laid side by side.
 * Skinned pieces keep their own (body) grid.
 */
export function gearDisplayParts(id: GearModelId, fit: GearFit = DEFAULT_FIT): DisplayPart[] {
  const P = fit.parts ?? referenceParts();
  const pieces = gearPieces(id, fit);
  const out: DisplayPart[] = [];
  // skinned pieces: centre each body part's group on its own bounds, then set pairs apart
  const groups = new Map<SkinPartName, { x0: number; x1: number; y0: number; y1: number; z0: number; z1: number }>();
  for (const p of pieces) {
    if (!p.skin) continue;
    const b = p.model.bounds();
    const g = groups.get(p.skin);
    if (!g) groups.set(p.skin, { x0: b.minX, x1: b.maxX + 1, y0: b.minY, y1: b.maxY + 1, z0: b.minZ, z1: b.maxZ + 1 });
    else Object.assign(g, { x0: Math.min(g.x0, b.minX), x1: Math.max(g.x1, b.maxX + 1), y0: Math.min(g.y0, b.minY), y1: Math.max(g.y1, b.maxY + 1), z0: Math.min(g.z0, b.minZ), z1: Math.max(g.z1, b.maxZ + 1) });
  }
  for (const p of pieces) {
    if (p.skin) {
      const part = P[p.skin];
      const g = groups.get(p.skin)!;
      const vs = part?.vs ?? GEAR_VS;
      const c: V3 = [(g.x0 + g.x1) / 2, (g.y0 + g.y1) / 2, (g.z0 + g.z1) / 2];
      out.push({ model: p.model, voxelSize: vs, pivot: p.at, pos: [(p.at[0] - c[0]) * vs + SKIN_SHOW[p.skin], (p.at[1] - c[1]) * vs, (p.at[2] - c[2]) * vs], glass: !!p.glass });
    } else {
      const o = SHOW[p.anchor];
      out.push({ model: p.model, voxelSize: GEAR_VS, pivot: [0.5, 0.5, 0.5], pos: [(p.at[0] + o[0]) * GEAR_VS, (p.at[1] + o[1]) * GEAR_VS, (p.at[2] + o[2]) * GEAR_VS], glass: !!p.glass });
    }
  }
  return out;
}

/** registry form (one model, one grid; glass baked in as tinted voxels) for the shop rug and model viewer */
export function gearStatic(id: GearModelId) {
  const parts = gearDisplayParts(id);
  const vs = parts.some((p) => p.voxelSize !== GEAR_VS) ? parts.find((p) => p.voxelSize !== GEAR_VS)!.voxelSize : GEAR_VS;
  const m = new VoxelModel('gear_static_' + id);
  for (const p of parts) {
    if (p.voxelSize !== vs) continue; // (items never mix grids; guard anyway)
    const dx = Math.round(p.pos[0] / vs - p.pivot[0]), dy = Math.round(p.pos[1] / vs - p.pivot[1]), dz = Math.round(p.pos[2] / vs - p.pivot[2]);
    m.merge(p.model, dx, dy, dz);
  }
  return { model: m, voxelSize: vs };
}
