// Ozymandias's shop inside Gobi's turtle house (Shop.ts): the merchant's den and
// the display stall the wares stand on.
//
// THE DEN (denModel): every stick of furniture inside the house, on a fine
// 1/48 m grid, hung on Gobi's shell at the house floor. A panelled oak counter
// with a kilim draped down its front, a woven basket (the wares come out of it),
// a brass balance scale, an open ledger with an inkwell and quill, and a brass
// till; a tall shelf unit along the back wall crowded with lathed jars in
// coloured glass, bottles, book stacks, scrolls, boxes and a skull; a pot-belly
// stove glowing in the back corner with its kettle and a coal scuttle; sacks, a
// barrel and stacked crates in the corners; a woven tapestry, a mounted cow
// skull and pegs with a lasso and a hat on the walls; a big kilim on the floor;
// bunches of herbs, chillies and lavender drying on twines; two brass lanterns
// glowing on chains; and over it all the turtle's own ribs, pale curved bone
// arching under the roof along a ridge beam.
//
// THE STALL: a two-step wooden display stall in the middle of the den: pine
// tops worn round at the front lips, sides cut like stair stringers with an
// arched opening and a knot-hole, risers and sides in chipped teal paint, turned
// walnut feet, a striped kilim runner over the top step. The wares fly out of
// his basket and land on its slots; their price tags are 2D pixel-art UI
// (ui/ShopUI.ts).
import * as THREE from 'three';
import { VoxelModel, VF } from '../../engine/voxel/VoxelModel';
import { buildVoxelGeometry } from '../../engine/voxel/Mesher';
import { pine, oak, paintedWood, brass, weathered, darkWood, ropeMat, rustedIron, blackIron, linen, agedPaper, leather, canvas } from '../models/materials';
import { hash3, noise } from '../../engine/math/rand';
import { len2, mixc } from './HudKit';

export const STALL_VS = 1 / 40;
const V = STALL_VS;

export interface StallTier {
  /** top surface height (m, stall space: origin on the floor at the stall's centre, front toward -z) */
  top: number;
  /** the top surface runs z0..z1 (m) */
  z0: number;
  z1: number;
  /** where a ware sits (z, m) */
  slotZ: number;
  /** the tack on the front lip the tags hang from (y, z in m) */
  tackY: number;
  tackZ: number;
}
export interface Stall {
  geo: THREE.BufferGeometry;
  /** half width (x, m) */
  halfX: number;
  /** lower step, upper step */
  tiers: [StallTier, StallTier];
  /** slot centres along x (m) for a full step, and the spacing (fewer wares centre up) */
  slotX: number[];
  slotStep: number;
  /** the stall's footprint (m): x -halfX..halfX, z zMin..zMax */
  zMin: number;
  zMax: number;
}

const TEAL = 0x4f8a86;
const KILIM = [0x9a2e22, 0x2e3e6a, 0xd0a040, 0xe8d8b4, 0x5a2a1a];

let stall: Stall | null = null;
/** the display stall (built once) */
export function stallModel(): Stall {
  if (stall) return stall;
  const m = new VoxelModel('ozy_stall');
  const X0 = -28, X1 = 27;
  const topWood = pine({ along: 'x', seed: 11, ends: [X0, X1], knots: 0.5 });
  const paint = (seed: number, along: 'x' | 'y' | 'z') => paintedWood(TEAL, { along, seed, chip: 0.38, fade: 0.2 });
  const set = (x: number, y: number, z: number, c: number | null, f = VF.SOLID) => m.set(x, y, z, c ?? 0x6a4a2a, f);
  const stepTop = (z: number) => (z < -1 ? 14 : 26);

  // ---- turned walnut feet under the four corners
  const foot = darkWood({ along: 'y', seed: 4 });
  for (const [fx, fz] of [[-27, -10], [26, -10], [-27, 9], [26, 9]])
    for (let y = 0; y <= 1; y++)
      for (let dx = -1; dx <= 1; dx++)
        for (let dz = -1; dz <= 1; dz++) {
          if (y === 0 && Math.abs(dx) + Math.abs(dz) === 2) continue; // rounded at the floor
          set(fx + dx, y, fz + dz, foot(fx + dx, y, fz + dz));
        }

  // ---- the two sides, cut like stair stringers: an arched opening at the foot, a knot-hole, rounded corners
  const side = paint(3, 'y');
  for (const sx of [X0, X0 + 1, X1 - 1, X1])
    for (let z = -11; z <= 9; z++)
      for (let y = 2; y <= stepTop(z); y++) {
        const arch = 2 + 5.2 * Math.sqrt(Math.max(0, 1 - ((z + 1) / 7.6) ** 2));
        if (z > -9 && z < 7 && y < arch) continue;
        if (len2(z - 4, y - 19.5) < 1.7) continue; // the knot-hole
        if ((y === 14 && z === -11) || (y === 26 && (z === -1 || z === 9))) continue; // worn round corners
        set(sx, y, z, side(sx, y, z));
      }

  // ---- risers (vertical boards) and the closed back
  const riser = paint(7, 'y');
  const back = weathered({ along: 'y', seed: 9, checks: 0.4 });
  for (let x = X0 + 2; x <= X1 - 2; x++) {
    const seam = ((x + 28) % 6) === 0;
    for (let y = 2; y <= 12; y++) for (const z of [-11, -10]) set(x, y, z, seam && z === -11 ? 0x2e3a36 : riser(x, y, z));
    for (let y = 15; y <= 24; y++) for (const z of [-1, 0]) set(x, y, z, seam && z === -1 ? 0x2e3a36 : riser(x, y + 40, z));
    for (let y = 2; y <= 25; y++) for (const z of [9, 10]) set(x, y, z, seam && z === 10 ? 0x3a2e24 : back(x, y, z));
  }
  // the kick rail along the front foot
  for (let x = X0 + 2; x <= X1 - 2; x++) for (const y of [2, 3]) set(x, y, -12, darkWood({ along: 'x', seed: 2 })(x, y, -12));

  // ---- the step tops: three planks each, seams, the front lip worn round
  const plank = (y0: number, z0: number, z1: number, seams: number[]) => {
    for (let x = X0; x <= X1; x++)
      for (let z = z0; z <= z1; z++)
        for (let y = y0; y <= y0 + 1; y++) {
          const front = z === z0, top = y === y0 + 1;
          // the lip is rubbed round where hands and wares have slid over it for nine hundred years
          if (front && top && hash3(x >> 1, y, z) < 0.55 + 0.3 * noise.n2(x * 0.15, y0)) continue;
          if ((x === X0 || x === X1) && front && top) continue;
          let c = topWood(x, y, z);
          if (top && seams.includes(z)) c = mixc(c ?? 0x8a5a32, 0x2a1a0c, 0.65);
          set(x, y, z, c);
        }
  };
  plank(13, -12, -1, [-8, -4]);
  plank(25, -2, 10, [2, 6]);

  // ---- the kilim runner on the top step, hanging down its front with a fringe
  const kil = (x: number, z: number, hang: number) => {
    const band = z < 0 ? Math.floor(hang / 2) : Math.floor((z + 3) / 2.5);
    const dia = Math.abs((((x + 64) % 10) - 5)) + Math.abs(((hang + z + 64) % 6) - 3);
    if (band % 3 === 1 && dia < 4) return dia < 2 ? KILIM[2] : KILIM[3];
    const k = band % 4;
    return k === 0 ? KILIM[0] : k === 1 ? KILIM[1] : k === 2 ? KILIM[0] : KILIM[4];
  };
  for (let x = -24; x <= 23; x++) {
    const sag = noise.n2(x * 0.2, 5) > 0.45 ? 1 : 0;
    for (let z = -2; z <= 9; z++) set(x, 27, z, kil(x, z, 0), VF.SOLID);
    for (let y = 27; y >= 20 - sag; y--) set(x, y, -3, kil(x, -3, 27 - y));
    if ((x & 1) === 0) set(x, 19 - sag, -3, 0xe0cfa6); // fringe
    if ((x & 3) === 0 && hash3(x, 3, 7) > 0.4) set(x, 18 - sag, -3, 0xd4c094);
  }

  // the price tags bring their own brass pins (they are pushed into the lips wherever the wares stand)
  const slotX = [-21, -7, 7, 21];
  m.grime(0.12, 0.3);

  const geo = buildVoxelGeometry(m, { voxelSize: V, pivot: [0, 0, 0] });
  geo.computeBoundingBox();
  stall = {
    geo,
    halfX: 28 * V,
    slotX: slotX.map((x) => (x + 0.5) * V),
    slotStep: 14 * V,
    tiers: [
      { top: 15 * V, z0: -12 * V, z1: -1 * V, slotZ: -6.5 * V, tackY: 13.5 * V, tackZ: -12 * V - 0.001 },
      { top: 28 * V, z0: -2 * V, z1: 10 * V, slotZ: 4.5 * V, tackY: 25.5 * V, tackZ: -3 * V - 0.001 },
    ],
    zMin: -13 * V,
    zMax: 11 * V,
  };
  return stall;
}

/** the stall's top surface height at (x, z) in stall space (null: off the stall) */
export function stallTopAt(s: Stall, x: number, z: number): number | null {
  if (Math.abs(x) > s.halfX || z < s.tiers[0].z0 || z > s.tiers[1].z1 + V) return null;
  return z < s.tiers[1].z0 + V ? s.tiers[0].top : s.tiers[1].top;
}

// ================================================================== the den
const DV = 1 / 48;
const D = (m: number) => Math.round(m / DV);
type Col = (x: number, y: number, z: number) => number | null;
const ok = (c: Col, fb: number) => (x: number, y: number, z: number) => c(x, y, z) ?? fb;
/** where things stand in the den (house root space, metres; y above the floor) */
export const DEN = {
  counter: { x0: -1.05, x1: -0.7, z0: -0.6, z1: 0.6, top: 0.92 },
  /** lantern glass, for the shop's warm light and the dust motes */
  lamps: [[-0.85, 1.55, 0.15], [0.42, 1.78, -0.32]] as [number, number, number][],
  /** the room's air (motes drift in here) */
  air: { x0: -1.5, x1: 1.25, y0: 0.4, y1: 2.1, z0: -1.3, z1: 1.0 },
};

let den: THREE.BufferGeometry | null = null;
/** the den (built once): origin at the house floor under the house root, root axes */
export function denGeometry(): THREE.BufferGeometry {
  if (den) return den;
  den = buildVoxelGeometry(denModel(), { voxelSize: DV, pivot: [0, 0, 0] });
  den.computeBoundingBox();
  return den;
}

function denModel() {
  const m = new VoxelModel('ozy_den');
  const set = (x: number, y: number, z: number, c: number, f: number = VF.SOLID) => m.set(x, y, z, c, f);
  /** a box in metres */
  const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, col: (x: number, y: number, z: number) => number, f: number = VF.SOLID, skip?: (x: number, y: number, z: number) => boolean) => {
    for (let x = D(x0); x < D(x1); x++) for (let y = D(y0); y < D(y1); y++) for (let z = D(z0); z < D(z1); z++) if (!skip?.(x, y, z)) set(x, y, z, col(x, y, z), f);
  };
  /** a lathed vessel round a vertical axis: radii (m) per row from the bottom, one row = one voxel */
  const lathe = (cx: number, y0: number, cz: number, radii: number[], col: (x: number, y: number, z: number, row: number) => number, f: number = VF.SOLID) => {
    const X = cx / DV, Z = cz / DV, Y = D(y0);
    radii.forEach((r, row) => {
      const R = r / DV;
      for (let x = Math.floor(X - R - 1); x <= Math.ceil(X + R + 1); x++)
        for (let z = Math.floor(Z - R - 1); z <= Math.ceil(Z + R + 1); z++) if (Math.hypot(x + 0.5 - X, z + 0.5 - Z) <= R) set(x, Y + row, z, col(x, Y + row, z, row), f);
    });
  };
  /** a rod between two points (m) */
  const rod = (a: number[], b: number[], r: number, col: (x: number, y: number, z: number) => number, f: number = VF.SOLID) => {
    const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) / DV) + 1;
    const R = r / DV;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const X = (a[0] + (b[0] - a[0]) * t) / DV, Y = (a[1] + (b[1] - a[1]) * t) / DV, Z = (a[2] + (b[2] - a[2]) * t) / DV;
      for (let x = Math.floor(X - R); x <= Math.ceil(X + R); x++)
        for (let y = Math.floor(Y - R); y <= Math.ceil(Y + R); y++)
          for (let z = Math.floor(Z - R); z <= Math.ceil(Z + R); z++) if (Math.hypot(x + 0.5 - X, y + 0.5 - Y, z + 0.5 - Z) <= Math.max(0.6, R)) set(x, y, z, col(x, y, z), f);
    }
  };
  const blob = (cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, col: (x: number, y: number, z: number) => number, f: number = VF.SOLID) => {
    for (let x = D(cx - rx) - 1; x <= D(cx + rx) + 1; x++)
      for (let y = D(cy - ry) - 1; y <= D(cy + ry) + 1; y++)
        for (let z = D(cz - rz) - 1; z <= D(cz + rz) + 1; z++) {
          const u = ((x + 0.5) * DV - cx) / rx, v = ((y + 0.5) * DV - cy) / ry, w = ((z + 0.5) * DV - cz) / rz;
          if (u * u + v * v + w * w <= 1 + noise.n2(x * 0.3, z * 0.3 + y) * 0.12) set(x, y, z, col(x, y, z), f);
        }
  };
  const OAK = ok(oak({ along: 'z', seed: 61, knots: 0.4 }), 0x8a5c34);
  const OAKY = ok(oak({ along: 'y', seed: 62, knots: 0.3 }), 0x8a5c34);
  const WAL = ok(darkWood({ along: 'z', seed: 63 }), 0x4e3220);
  const WALX = ok(darkWood({ along: 'x', seed: 64 }), 0x4e3220);
  const PINEX = ok(pine({ along: 'x', seed: 65, knots: 0.5 }), 0xb88250);
  const BR = ok(brass({ seed: 66, patina: 0.25, polish: 0.5 }), 0xc4952e);
  const IRN = ok(blackIron(67, 0.3), 0x3a3a3e);
  const RUST = ok(rustedIron({ seed: 68, rust: 0.5 }), 0x5a4a40);
  const KIL = [0x8e2a20, 0xb8432e, 0x2f4a7a, 0xd9a53a, 0xe8d6b0, 0x3f6a4a];
  const kilim = (u: number, v: number, seed: number) => {
    const du = (((u + seed) % 10) + 10) % 10 - 5, dv = (((v + seed * 3) % 10) + 10) % 10 - 5;
    const d = Math.abs(du) + Math.abs(dv);
    const band = ((Math.floor(v / 10) % 3) + 3) % 3;
    if (d <= 1) return KIL[3];
    if (d === 2) return KIL[4];
    if (d === 3) return KIL[2 + band * 0];
    if (d === 5 && band === 1) return KIL[5];
    return (v >> 1) % 2 ? KIL[0] : KIL[1];
  };

  // ---- the floor kilim (and a doormat), the stall stands on it
  for (let x = D(-0.62); x < D(1.12); x++)
    for (let z = D(-0.98); z < D(0.98); z++) {
      const u = x - D(-0.62), v = z - D(-0.98), U2 = D(1.12) - D(-0.62), V2 = D(0.98) - D(-0.98);
      const edge = u < 2 || v < 2 || u >= U2 - 2 || v >= V2 - 2;
      const fringe = (u === 0 || u === U2 - 1) && (v & 1) === 0;
      if ((u === 0 || u === U2 - 1) && !fringe) continue;
      set(x, 0, z, fringe ? 0xe8d6b0 : edge ? KIL[2] : kilim(u, v, 3), VF.SOLID | VF.SOFTAO);
    }
  for (let x = D(1.12); x < D(1.34); x++) for (let z = D(-0.25); z < D(0.45); z++) set(x, 0, z, (x + z) % 4 === 0 ? 0xe8d6b0 : ((z >> 2) & 1) ? 0x2f4a7a : 0xa83a2a, VF.SOLID | VF.SOFTAO);

  // ---- the counter: panelled oak ends, an open back with shelves (his side), a thick walnut top, the kilim down its front
  const C = DEN.counter;
  box(C.x0, 0, C.z0, C.x1, 0.1, C.z1, WAL); // kick board
  for (const z of [C.z0, C.z1 - DV * 2])
    box(C.x0, 0.1, z, C.x1, C.top - 0.06, z + DV * 2, (x, y, zz) => {
      const fx = x - D(C.x0), fy = y - D(0.1);
      const frame = fx < 2 || fx > D(C.x1) - D(C.x0) - 3 || fy < 2 || fy > D(C.top - 0.16) - 2;
      const inner = !frame && (fx === 2 || fy === 2) ? 0x5a3a20 : 0;
      return inner || (frame ? WAL(x, y, zz) : OAKY(x, y, zz));
    });
  box(C.x1 - DV * 2, 0.1, C.z0, C.x1, C.top - 0.06, C.z1, OAK); // the front boards (under the kilim)
  for (const sy of [0.32, 0.58]) box(C.x0, sy, C.z0, C.x1 - DV * 2, sy + DV, C.z1, OAK); // his shelves
  // the top: thick, overhanging, a worn lip
  box(C.x0 - 0.04, C.top - 0.06, C.z0 - 0.05, C.x1 + 0.05, C.top, C.z1 + 0.05, (x, y, z) => (y === D(C.top) - 1 && hash3(x, y, z) < 0.06 ? 0x7a5636 : WAL(x, y, z)), VF.SOLID, (x, y, z) => x === D(C.x1 + 0.05) - 1 && y === D(C.top) - 1 && hash3(x >> 1, y, z) < 0.5);
  // the kilim, falling in soft folds to a zig-zag hem with tassels
  for (let z = D(C.z0) + 1; z < D(C.z1) - 1; z++) {
    const fold = Math.sin(z * 0.45) > 0.55 ? 1 : 0;
    const zig = Math.abs((((z - D(C.z0)) % 6) + 6) % 6 - 3);
    for (let y = D(0.2) + zig; y < D(C.top) - 2; y++) set(D(C.x1) + fold, y, z, y >= D(C.top) - 5 ? KIL[2] : kilim(z, y, 5), VF.SOLID | VF.SOFTAO);
    if ((z - D(C.z0)) % 4 === 1) for (let k = 1; k <= 3; k++) set(D(C.x1), D(0.2) + zig - k, z, k === 3 ? KIL[3] : KIL[4], VF.SOLID | VF.SOFTAO);
  }
  const T = C.top;
  // the woven basket the wares come out of
  lathe(-0.88, T, -0.35, [0.11, 0.13, 0.145, 0.155, 0.16, 0.165, 0.165, 0.17, 0.17], (x, y, z, row) => {
    const a = Math.atan2(z + 0.5 - D(-0.35), x + 0.5 - D(-0.88));
    if (row === 8) return 0x6a4a24;
    return (Math.floor((a + 4) * 5) + row) % 2 ? 0xc8a060 : 0xa8803e;
  }, VF.SOLID);
  lathe(-0.88, T + DV, -0.35, [0.13, 0.14, 0.15, 0.15, 0.15, 0.15, 0.15], () => 0, VF.SOLID); // (hollowed below)
  for (let x = D(-1.03); x <= D(-0.73); x++) for (let z = D(-0.5); z <= D(-0.2); z++) for (let y = D(T) + 1; y < D(T) + 9; y++) if (Math.hypot(x + 0.5 - D(-0.88), z + 0.5 - D(-0.35)) < 0.15 / DV) m.del(x, y, z);
  blob(-0.86, T + 0.13, -0.37, 0.09, 0.03, 0.08, (x, y, z) => (hash3(x, y, z) > 0.7 ? 0xb8432e : 0x8e2a20)); // a cloth bundle peeking out
  // the brass balance scale
  lathe(-0.88, T, 0.36, [0.06, 0.055, 0.03, 0.02], BR, VF.SOLID | VF.METAL);
  rod([-0.88, T + 0.08, 0.36], [-0.88, T + 0.34, 0.36], 0.012, BR, VF.SOLID | VF.METAL);
  rod([-0.88, T + 0.33, 0.2], [-0.88, T + 0.33, 0.52], 0.01, BR, VF.SOLID | VF.METAL);
  for (const z of [0.21, 0.51]) {
    for (const dz of [-0.04, 0.04]) rod([-0.88, T + 0.33, z], [-0.88, T + 0.14, z + dz], 0.004, BR, VF.SOLID | VF.METAL);
    lathe(-0.88, T + 0.12, z, [0.03, 0.055, 0.06], BR, VF.SOLID | VF.METAL);
  }
  // the open ledger, an inkwell and a quill
  box(-0.98, T, -0.16, -0.78, T + DV, 0.08, (x, y, z) => (z === D(-0.04) ? 0x6a4a2a : hash3(x, z, 4) > 0.86 && x > D(-0.95) ? 0x5a4a3a : 0xe8dcbc), VF.SOLID | VF.SOFTAO);
  box(-0.99, T - DV, -0.17, -0.77, T, 0.09, () => 0x5a2a18);
  lathe(-0.79, T, 0.13, [0.025, 0.028, 0.02, 0.012], () => 0x1a1a22, VF.SOLID);
  rod([-0.79, T + 0.05, 0.13], [-0.72, T + 0.2, 0.04], 0.008, (x, y) => (y > D(T + 0.12) ? 0xf0ece0 : 0xd8cfb8));
  // the till: a brass cash register at the counter's end, keys toward the customer
  box(-1.0, T, 0.5, -0.76, T + 0.13, 0.64, BR, VF.SOLID | VF.METAL);
  box(-0.98, T + 0.13, 0.52, -0.84, T + 0.22, 0.62, (x, y, z) => (y === D(T + 0.22) - 1 ? 0xf2d27a : BR(x, y, z)), VF.SOLID | VF.METAL);
  for (let r = 0; r < 3; r++) for (let k = 0; k < 4; k++) set(D(-0.75), D(T + 0.03) + r * 2, D(0.515) + k * 2, r === 0 ? 0xe8e0d0 : 0xd8d0c0);
  box(-0.95, T + 0.22, 0.55, -0.9, T + 0.27, 0.59, () => 0xb8322a); // the little SALE flag
  // a candle stub on a saucer, alight
  lathe(-0.8, T, -0.24, [0.035, 0.035], BR, VF.SOLID | VF.METAL);
  lathe(-0.8, T + 2 * DV, -0.24, [0.015, 0.015, 0.015, 0.014], () => 0xeee4c8);
  set(D(-0.8), D(T) + 6, D(-0.24), 0xffc060, VF.SOLID | VF.EMISSIVE | VF.GLOW);

  // ---- the back wall: a tall shelf unit crowded with curios (the little window kept clear)
  const SZ0 = -1.46, SZ1 = -1.2, shelves = [0.06, 0.48, 1.06, 1.66];
  for (const px of [-1.0, -0.42, 0.16, 0.86, 1.3]) box(px - 0.03, 0, SZ0, px + 0.03, 2.05, SZ1, ok(darkWood({ along: 'y', seed: 70 + px * 3 }), 0x4e3220));
  shelves.forEach((sy, si) => {
    box(-1.0, sy, SZ0, 1.3, sy + 0.035, SZ1 + 0.02, (x, y, z) => (y === D(sy + 0.035) - 1 && z === D(SZ1 + 0.02) - 1 ? 0xa8805a : PINEX(x, y, z)), VF.SOLID, (x) => si >= 2 && (x + 0.5) * DV > 0.19 && (x + 0.5) * DV < 0.83);
  });
  box(-1.0, 2.05, SZ0, 1.3, 2.1, SZ1 + 0.04, WALX);
  // the things on the shelves
  const glass = [0x6a9a7e, 0x9a5a3a, 0xc8a04a, 0x5a7aa0, 0x7a4a8a, 0x3f6a4a];
  shelves.forEach((sy, si) => {
    let x = -0.96;
    const y0 = sy + 0.035;
    let k = si * 17;
    while (x < 1.25) {
      k++;
      if (si >= 2 && x > 0.17 && x < 0.84) {
        x = 0.9;
        continue;
      }
      const r = hash3(k, si, 9), zc = -1.33 + (hash3(k, si, 3) - 0.5) * 0.06;
      if (r < 0.32) {
        // a lathed jar with a lid
        const w = 0.04 + hash3(k, 2, si) * 0.03, hgt = 6 + Math.floor(hash3(k, 5, si) * 6);
        const g = glass[k % glass.length];
        const radii = Array.from({ length: hgt }, (_v, i) => w * (i < 2 ? 0.8 : i > hgt - 3 ? 0.65 : 1));
        lathe(x + w, y0, zc, radii, (_x, _y, _z, row) => (row >= hgt - 2 ? 0x8a6a4a : row === 2 ? mixc(g, 0xffffff, 0.35) : g));
        x += w * 2 + 0.03;
      } else if (r < 0.52) {
        // a bottle: round body, long neck, a cork
        const g = glass[(k + 2) % glass.length];
        lathe(x + 0.03, y0, zc, [0.03, 0.032, 0.032, 0.032, 0.03, 0.022, 0.012, 0.011, 0.011, 0.011, 0.012], (_x, _y, _z, row) => (row === 10 ? 0xb8905a : row === 1 ? mixc(g, 0xffffff, 0.4) : g));
        x += 0.08;
      } else if (r < 0.75) {
        // a stack of books, spines out
        const n = 3 + Math.floor(hash3(k, 7, si) * 3);
        const cols = [0x8a2a20, 0x2f4a7a, 0x3f6a4a, 0xc8903a, 0x5a3a20, 0x6a3a6a];
        for (let b = 0; b < n; b++) {
          const bw = 0.025 + hash3(k, b, 1) * 0.015, bh = 0.13 + hash3(k, b, 2) * 0.09;
          const c = cols[(k + b) % cols.length];
          box(x, y0, -1.42, x + bw, y0 + bh, -1.25, (_x, y) => (y === D(y0 + bh * 0.8) || y === D(y0 + bh * 0.25) ? 0xd9a53a : c));
          x += bw + 0.002;
        }
        x += 0.03;
      } else if (r < 0.85) {
        // a rolled scroll lying down, tied with a red thread
        rod([x, y0 + 0.03, -1.4], [x, y0 + 0.03, -1.24], 0.028, (_x, _y, z) => (z === D(-1.32) ? 0xb8322a : 0xe2cc98));
        rod([x + 0.06, y0 + 0.03, -1.41], [x + 0.06, y0 + 0.03, -1.25], 0.025, () => 0xd6c08c);
        x += 0.12;
      } else if (r < 0.93) {
        // a carved box with a brass clasp
        box(x, y0, -1.4, x + 0.12, y0 + 0.08, -1.27, (xx, y, z) => (z === D(-1.27) - 1 && Math.abs(xx - D(x + 0.06)) < 1 && y > D(y0 + 0.04) ? 0xe2b24a : WALX(xx, y, z)));
        x += 0.15;
      } else {
        // a bleached skull with dark sockets
        blob(x + 0.06, y0 + 0.055, -1.33, 0.055, 0.05, 0.065, (xx, y, z) => {
          const fz = (z + 0.5) * DV - -1.33;
          const fy = (y + 0.5) * DV - (y0 + 0.055);
          if (fz > 0.03 && fy > -0.005 && fy < 0.025 && Math.abs((xx + 0.5) * DV - (x + 0.06)) > 0.012 && Math.abs((xx + 0.5) * DV - (x + 0.06)) < 0.04) return 0x2a1a10;
          return hash3(xx, y, z) > 0.85 ? 0xcdbd9c : 0xeee2c8;
        });
        x += 0.14;
      }
    }
  });

  // ---- the pot-belly stove in the back corner, its door glowing, a kettle on top, a coal scuttle
  const SX = -1.35, SZ = -1.15;
  for (const [dx, dz] of [[-0.1, -0.1], [0.1, -0.1], [-0.1, 0.1], [0.1, 0.1]]) rod([SX + dx, 0, SZ + dz], [SX + dx * 0.8, 0.12, SZ + dz * 0.8], 0.018, IRN, VF.SOLID | VF.METAL);
  lathe(SX, 0.1, SZ, [0.14, 0.17, 0.19, 0.205, 0.215, 0.22, 0.22, 0.215, 0.21, 0.2, 0.19, 0.18, 0.17, 0.16, 0.15, 0.14, 0.14, 0.15, 0.17, 0.17, 0.12, 0.1].flatMap((r) => [r, r]), (x, y, z, row) => (row === 36 || row === 37 ? 0x6a6a72 : row > 24 && row < 30 ? 0x2a2a2e : IRN(x, y, z)), VF.SOLID | VF.METAL);
  // the glowing door, facing into the room
  for (let y = D(0.32); y < D(0.5); y++)
    for (let z = D(SZ - 0.07); z < D(SZ + 0.07); z++) {
      const grate = (y + z) % 3 === 0;
      set(D(SX + 0.215), y, z, grate ? 0x2a2a2e : 0xff8a3a, grate ? VF.SOLID | VF.METAL : VF.SOLID | VF.EMISSIVE | VF.GLOW);
    }
  rod([SX, 0.95, SZ], [SX, 0.98, SZ], 0.09, IRN, VF.SOLID | VF.METAL); // the pipe collar (the house's own pipe goes on up)
  lathe(SX + 0.06, 0.6, SZ + 0.06, [0.07, 0.085, 0.09, 0.09, 0.085, 0.07, 0.04, 0.02], (x, y, z) => RUST(x, y, z), VF.SOLID | VF.METAL); // kettle
  rod([SX + 0.13, 0.66, SZ + 0.06], [SX + 0.21, 0.72, SZ + 0.06], 0.012, RUST, VF.SOLID | VF.METAL);
  lathe(-1.05, 0, -1.3, [0.1, 0.11, 0.115, 0.12, 0.12, 0.12, 0.12, 0.12], RUST, VF.SOLID | VF.METAL); // scuttle
  blob(-1.05, 0.2, -1.3, 0.1, 0.04, 0.1, (x, y, z) => (hash3(x, y, z) > 0.7 ? 0x3a3a3a : 0x1a1a1c));

  // ---- corners: sacks and a barrel by the door, crates stacked in the back corner
  const sack = (cx: number, cz: number, h: number, seed: number) => {
    const cl = ok(canvas({ seed, tone: 0xc8b088 }), 0xc8b088);
    blob(cx, h * 0.45, cz, 0.15, h * 0.48, 0.13, cl, VF.SOLID | VF.SOFTAO);
    blob(cx, h * 0.95, cz, 0.05, 0.06, 0.05, cl, VF.SOLID | VF.SOFTAO);
    rod([cx - 0.05, h * 0.88, cz], [cx + 0.05, h * 0.88, cz], 0.012, () => 0x8a6a3a);
  };
  sack(1.18, 0.95, 0.42, 71);
  sack(0.98, 1.02, 0.34, 72);
  sack(1.2, 0.72, 0.3, 73);
  lathe(1.2, 0, -0.62, Array.from({ length: 28 }, (_v, i) => 0.13 + Math.sin((i / 27) * Math.PI) * 0.025), (x, y, z, row) => (row % 9 === 2 ? RUST(x, y, z) : OAKY(x, y, z)), VF.SOLID);
  const crate = (x0: number, y0: number, z0: number, s: number, seed: number) => {
    const w = ok(weathered({ along: 'x', seed }), 0x877866);
    box(x0, y0, z0, x0 + s, y0 + s, z0 + s, (x, y, z) => {
      const ex = x === D(x0) || x === D(x0 + s) - 1, ey = y === D(y0) || y === D(y0 + s) - 1, ez = z === D(z0) || z === D(z0 + s) - 1;
      return (ex && ey) || (ey && ez) || (ex && ez) ? 0x5a4632 : (y - D(y0)) % 5 === 0 ? 0x4a3a2a : w(x, y, z);
    });
  };
  crate(1.0, 0, -1.44, 0.34, 74);
  crate(1.04, 0.34, -1.4, 0.26, 75);
  crate(0.66, 0, -1.18, 0.22, 76);

  // ---- the walls: a tapestry on the front wall, a cow skull and pegs (a lasso, a hat) by the side window
  for (let x = D(0.1); x < D(0.9); x++)
    for (let y = D(0.55); y < D(1.75); y++) {
      const u = x - D(0.1), v = y - D(0.55);
      const c = u < 2 || u > D(0.8) - 3 ? 0x2f4a7a : kilim(v, u, 9);
      set(x, y, D(1.14), c, VF.SOLID | VF.SOFTAO);
      if (v === 0 && (u & 1) === 0) set(x, y - 1, D(1.14), 0xe8d6b0, VF.SOLID | VF.SOFTAO);
    }
  rod([0.07, 1.77, 1.12], [0.93, 1.77, 1.12], 0.012, WALX); // its rod
  blob(-1.6, 1.85, 0.62, 0.08, 0.1, 0.09, (x, y, z) => (hash3(x, y, z) > 0.85 ? 0xcdbd9c : 0xe8dcc0));
  for (const s of [-1, 1]) rod([-1.58, 1.9, 0.62 + s * 0.07], [-1.5, 2.05, 0.62 + s * 0.3], 0.018, (_x, y) => (y > D(2.0) ? 0x4a4436 : 0xe8dcc0));
  for (const z of [0.95, 1.08]) rod([-1.66, 1.45, z], [-1.58, 1.47, z], 0.012, WALX); // pegs
  for (let a = 0; a < Math.PI * 2; a += 0.12) {
    const y = 1.32 + Math.sin(a) * 0.12, z = 0.95 + Math.cos(a) * 0.1;
    set(D(-1.6), D(y), D(z), ok(ropeMat({ along: 'y', seed: 77 }), 0xb2925e)(D(-1.6), D(y), D(z)));
  }
  blob(-1.58, 1.42, 1.08, 0.05, 0.03, 0.11, ok(leather({ seed: 78, tone: 0x6a4428 }), 0x6a4428)); // the hat brim
  blob(-1.57, 1.48, 1.08, 0.045, 0.05, 0.06, ok(leather({ seed: 79, tone: 0x5a3820 }), 0x5a3820));

  // ---- the turtle's ribs arching under the roof, a ridge beam, herbs drying and two lanterns on chains
  const floorY = 3.0, eave = 5.3 - floorY, ridge = 6.25 - floorY, ridgeX = -0.15, half = 1.9;
  const roofUnder = (X: number) => eave + (ridge - eave) * (1 - Math.abs(X - ridgeX) / half) - 0.2;
  const BONE = (x: number, y: number, z: number) => {
    const g = noise.n2(x * 0.15, y * 0.4 + z);
    return g > 0.45 ? 0xb8a478 : g < -0.5 ? 0x9a8660 : (x + y) % 7 === 0 ? 0xcdbd94 : 0xded0aa;
  };
  for (const rz of [-1.05, -0.45, 0.15, 0.75]) {
    for (let X = -1.62; X <= 1.32; X += DV * 0.7) {
      const y = roofUnder(X) - 0.02 * Math.cos(((X - ridgeX) / half) * Math.PI);
      const th = 0.05 + 0.02 * (1 - Math.abs(X - ridgeX) / half);
      for (let dy = 0; dy < th; dy += DV) for (let dz = -0.035; dz <= 0.035; dz += DV) set(D(X), D(y - dy), D(rz + dz), BONE(D(X), D(y - dy), D(rz + dz)));
    }
  }
  rod([ridgeX, ridge - 0.26, -1.42], [ridgeX, ridge - 0.26, 1.12], 0.05, ok(darkWood({ along: 'z', seed: 80 }), 0x4e3220));
  const twine = (a: number[], b: number[], bunches: number, seed: number) => {
    rod(a, b, 0.006, () => 0xb2925e);
    for (let i = 1; i < bunches; i++) {
      const t = i / bunches;
      const p = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - Math.sin(t * Math.PI) * 0.05, a[2] + (b[2] - a[2]) * t];
      const kind = Math.floor(hash3(i, seed, 1) * 3);
      rod(p, [p[0], p[1] - 0.06, p[2]], 0.008, () => 0x6a5a2a);
      if (kind === 2) {
        // a string of red chillies
        for (let c = 0; c < 6; c++) blob(p[0] + Math.sin(c * 2.1) * 0.02, p[1] - 0.08 - c * 0.035, p[2] + Math.cos(c * 1.7) * 0.02, 0.014, 0.025, 0.014, () => (c % 2 ? 0xb8322a : 0xd8442e));
      } else {
        const leaf = kind === 0 ? [0x6f8a3e, 0x5a7434, 0x8aa04c] : [0x7a5a9a, 0x6a4a8a, 0x8a6a4a];
        for (let s2 = 0; s2 < 9; s2++) {
          const ang = s2 * 0.7, len = 0.16 + hash3(i, s2, seed) * 0.08;
          rod([p[0], p[1] - 0.06, p[2]], [p[0] + Math.cos(ang) * 0.05, p[1] - 0.06 - len, p[2] + Math.sin(ang) * 0.05], 0.009, () => leaf[s2 % 3]);
        }
      }
    }
  };
  twine([-1.6, 2.2, 0.98], [1.3, 2.25, 0.98], 11, 81);
  twine([-0.95, 2.18, -1.12], [1.25, 2.2, -1.12], 8, 82);
  for (const [lx, ly, lz] of DEN.lamps) {
    rod([lx, roofUnder(lx) - 0.05, lz], [lx, ly + 0.14, lz], 0.006, IRN, VF.SOLID | VF.METAL); // its chain
    lathe(lx, ly - 0.1, lz, [0.05, 0.055, 0.04], BR, VF.SOLID | VF.METAL);
    lathe(lx, ly - 0.1 + 3 * DV, lz, [0.042, 0.045, 0.046, 0.046, 0.045, 0.042, 0.038], (x, y, z) => (Math.abs(x - D(lx)) + Math.abs(z - D(lz)) > 2 && (x + z) % 4 === 0 ? 0x8a6a2a : 0xffc66a), VF.SOLID | VF.EMISSIVE | VF.GLOW);
    lathe(lx, ly - 0.1 + 10 * DV, lz, [0.05, 0.04, 0.025, 0.012], BR, VF.SOLID | VF.METAL);
  }
  return m;
}
