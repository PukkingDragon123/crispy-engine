// The workshop-house furniture (cabin v3, see hideout.ts): the stations Sundown
// walks up to (weapon bench, wardrobe mirror, the garage with its board rack and
// wax bench, the lectern with the book of skills), Mama Frog's rocking chair,
// and everything that makes the place feel lived in (the red futon with its
// woven throw, the slab coffee table, the plaid chair, the guitar, framed
// pictures, the clock, the fireplace crane, doors that swing).
// Every form is sculpted from smooth signed-distance shapes: tapered, worn,
// asymmetric; wood has grain, cloth has folds. Fronts face +Z, bottom-centre
// pivots. Furniture 1/48 m, small detailed things 1/64 m. Anything that moves
// is a rig.
import { VoxelModel, VF } from '../../../engine/voxel/VoxelModel';
import type { RigSpec } from '../../../engine/voxel/Rig';
import { hash3 } from '../../../engine/math/rand';
import { S, StaticModel, V3, mod, mixRGB } from './helpers';
import { sculpt, dRBox, dCap, dEll, smin, lump, lathe, mul, IP } from './hideout';

const FV = 1 / 48; // furniture
const DV = 1 / 64; // small detailed things

// ------------------------------------------------------------------ kit
type F = (x: number, y: number, z: number) => number;
type Col = (x: number, y: number, z: number, d: number) => number | null;
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const nrm = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const crs = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const h01 = (x: number, y: number, z: number) => hash3(x, y, z);

/** oriented rounded box: long axis along a→b, `up` picks the thickness axis; w = width, t = thickness (voxels) */
function plankF(a: V3, b: V3, w: number, t: number, up: V3 = [0, 1, 0], r = 0.8): F {
  const U = nrm([b[0] - a[0], b[1] - a[1], b[2] - a[2]]);
  let Wv = crs(U, up);
  if (Math.hypot(...Wv) < 1e-4) Wv = crs(U, [1, 0, 0]);
  Wv = nrm(Wv);
  const V = crs(Wv, U);
  const hl = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) / 2;
  const c: V3 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
  return (x, y, z) => {
    const p: V3 = [x + 0.5 - c[0], y + 0.5 - c[1], z + 0.5 - c[2]];
    const qa = Math.abs(dot(p, U)) - hl + r, qb = Math.abs(dot(p, V)) - t / 2 + r, qc = Math.abs(dot(p, Wv)) - w / 2 + r;
    return Math.hypot(Math.max(qa, 0), Math.max(qb, 0), Math.max(qc, 0)) + Math.min(Math.max(qa, qb, qc), 0) - r;
  };
}
/** sculpt f inside the box spanned by points ± pad */
function fill(m: VoxelModel, f: F, pts: V3[], pad: number, col: Col, fl = 0) {
  let x0 = 1e9, y0 = 1e9, z0 = 1e9, x1 = -1e9, y1 = -1e9, z1 = -1e9;
  for (const p of pts) {
    x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); z0 = Math.min(z0, p[2]);
    x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); z1 = Math.max(z1, p[2]);
  }
  sculpt(m, Math.floor(x0 - pad), Math.floor(y0 - pad), Math.floor(z0 - pad), Math.ceil(x1 + pad), Math.ceil(y1 + pad), Math.ceil(z1 + pad), f, col, fl);
}
/** a plank / beam a→b with wood grain running along it */
function plank(m: VoxelModel, a: V3, b: V3, w: number, t: number, base: number, seed: number, o: { up?: V3; r?: number; knots?: boolean; edgeDark?: number; fl?: number; lumpy?: number } = {}) {
  const f0 = plankF(a, b, w, t, o.up, o.r ?? 0.8);
  const lk = o.lumpy ?? 0.25;
  const f: F = lk ? (x, y, z) => f0(x, y, z) + lump(x, y, z, 0.35, seed) * lk : f0;
  const U = nrm([b[0] - a[0], b[1] - a[1], b[2] - a[2]]);
  const tone = mul(base, 0.9 + h01(seed, 3, 7) * 0.2);
  fill(m, f, [a, b], Math.max(w, t) / 2 + 1.5, (x, y, z, d) => {
    // grain: streaks across the board, stretched along it
    const along = x * U[0] + y * U[1] + z * U[2];
    const across = Math.floor((x * (1 - Math.abs(U[0])) + y * (1 - Math.abs(U[1])) * 1.3 + z * (1 - Math.abs(U[2])) * 0.7) * 0.9);
    let c = tone;
    const s = h01(across, Math.floor(along / 9), seed);
    if (s > 0.78) c = mul(c, 0.86);
    else if (s < 0.12) c = mul(c, 1.08);
    if (o.knots && h01(Math.floor(along / 14), across >> 2, seed + 9) > 0.93) c = mul(c, 0.55);
    if (d > -1 && o.edgeDark) c = mul(c, o.edgeDark);
    return c;
  }, o.fl ?? 0);
}
/** a tapered round rod / capsule a→b */
function rod(m: VoxelModel, a: V3, b: V3, ra: number, rb: number, col: number | Col, fl = 0) {
  const c: Col = typeof col === 'number' ? () => col : col;
  fill(m, (x, y, z) => dCap(x + 0.5, y + 0.5, z + 0.5, a, b, ra, rb), [a, b], Math.max(ra, rb) + 1, c, fl);
}
/** a smooth tube through points (radius per point) */
function tubeP(m: VoxelModel, pts: V3[], r: number[], col: number | Col, fl = 0) {
  for (let i = 0; i < pts.length - 1; i++) rod(m, pts[i], pts[i + 1], r[Math.min(i, r.length - 1)], r[Math.min(i + 1, r.length - 1)], col, fl);
}
/** ellipsoid blob with optional unevenness */
function egg(m: VoxelModel, c: V3, r: V3, col: number | Col, fl = 0, lumpK = 0, seed = 0) {
  const cc: Col = typeof col === 'number' ? () => col : col;
  fill(m, (x, y, z) => dEll(x + 0.5, y + 0.5, z + 0.5, c[0], c[1], c[2], r[0], r[1], r[2]) + (lumpK ? lump(x, y, z, 0.5, seed) * lumpK : 0), [c], Math.max(r[0], r[1], r[2]) + 1.5, cc, fl);
}
/** catmull-rom through control points → dense polyline */
function spline(pts: V3[], n = 8): V3[] {
  const out: V3[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    for (let k = 0; k < n; k++) {
      const t = k / n, t2 = t * t, t3 = t2 * t;
      out.push([0, 1, 2].map((j) => 0.5 * (2 * p1[j] + (-p0[j] + p2[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t2 + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * t3)) as V3);
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}
const pivotOf = (m: VoxelModel, vs: number, p: V3): V3 => {
  const b = m.bounds();
  return [(p[0] - (b.minX + b.maxX + 1) / 2) * vs, (p[1] - b.minY) * vs, (p[2] - (b.minZ + b.maxZ + 1) / 2) * vs];
};

const STEEL = 0x4a4c50, STEEL_HI = 0x8a8c90, BLUED = 0x2a2e36, BRASS = 0xc89a48, BRASS_HI = 0xe8c070, LEATHER = 0x6a3a1e;
const OAK = 0xa8743e, OAK_DK = 0x6e4624, WALNUT = 0x5e3a20;

// =====================================================================
// THE WEAPON BENCH — 1/48. A heavy oak bench (three thick top planks, chamfered
// legs, pegged stretchers, a shelf below), a cast-iron vise, a plank tool wall
// with hammer, hacksaw, screwdrivers, pliers, wrench, files and a coil of wire on
// pegs, a shelf of tins, a gooseneck lamp, and a gun stripped on an oilcloth.
// meta (m, bottom-centre pivot): top, lamp (bulb), gun (display cradle).
// =====================================================================
export function weaponBench(seed = 1): StaticModel & { meta: { top: number; lamp: V3; gun: V3 } } {
  const m = new VoxelModel('weapon_bench');
  const X = 45, Z0 = 0, Z1 = 34, TOP = 45;
  // ---- legs (chamfered, slightly splayed) + stretchers + shelf
  for (const [lx, lz] of [[-41, 5], [41, 5], [-41, 29], [41, 29]] as const) {
    const sx = Math.sign(lx) * 0.8, sz = (lz < 17 ? -1 : 1) * 0.5;
    plank(m, [lx + sx, 0, lz + sz], [lx, TOP - 4, lz], 6, 6, OAK_DK, seed + lx * 3 + lz, { r: 1.6, up: [0, 0, 1], lumpy: 0.3 });
  }
  for (const lx of [-41, 41]) plank(m, [lx, 8, 5], [lx, 8, 29], 3, 5, OAK_DK, seed + 11 + lx, { up: [1, 0, 0], r: 1 });
  plank(m, [-41, 8, 5], [41, 8, 5], 3, 5, OAK_DK, seed + 13, { up: [0, 0, 1], r: 1 });
  for (const [lx, lz] of [[-41, 5], [41, 5], [-41, 29], [41, 29]] as const) egg(m, [lx + Math.sign(lx) * 3.6, 8.5, lz], [0.9, 0.9, 0.9], 0x8a6038); // pegged joints
  for (let i = 0; i < 4; i++) plank(m, [-39, 10.5, 7 + i * 5.6], [39, 10.5, 7 + i * 5.6], 5, 1.6, OAK, seed + 20 + i, { r: 0.5, lumpy: 0.1 });
  // ---- apron with three drawers (the middle one pulled out, cartridges inside)
  plank(m, [-43, 37, 31.5], [43, 37, 31.5], 2.5, 7, OAK_DK, seed + 30, { up: [0, 0, 1], r: 0.6 });
  [[-26, 0], [0, 5], [26, 0]].forEach(([cx, out], i) => {
    const zf = 33 + out;
    plank(m, [cx - 11.5, 37, zf], [cx + 11.5, 37, zf], 2, 6.4, OAK, seed + 31 + i, { up: [0, 0, 1], r: 0.7, lumpy: 0.15 });
    egg(m, [cx, 37, zf + 1.6], [1.6, 1.4, 1.3], 0x3a2414, 0, 0); // turned knob
    if (out) {
      for (const sx of [-11, 11]) plank(m, [cx + sx, 36, zf - 7], [cx + sx, 36, zf], 1.2, 4, OAK, seed + 40, { r: 0.4 });
      for (let k = 0; k < 9; k++) for (let j = 0; j < 2; j++) rod(m, [cx - 8 + k * 2, 35, zf - 5 + j * 2.4], [cx - 8 + k * 2, 36.8, zf - 5 + j * 2.4], 0.55, 0.45, (_x, y) => (y > 35 ? 0xd8a848 : 0x8a6a40), VF.METAL);
    }
  });
  // ---- the top: three thick planks, dings, knife scores, an oil stain, a mug ring
  const tops: [number, number][] = [[0.5, 10.5], [11.5, 22], [23, 34.5]];
  tops.forEach(([za, zb], i) => {
    const hz = (zb - za) / 2, cz = (za + zb) / 2, dy = i === 1 ? 0.3 : 0;
    const tone = mul(OAK, 0.92 + h01(i, 5, seed) * 0.16);
    fill(m, (x, y, z) => dRBox(x + 0.5, y + 0.5, z + 0.5, 0, TOP - 2 + dy, cz, X + 1 - (i === 2 ? 0.6 : 0), 2.1, hz - 0.35, 1.1) + lump(x, y, z, 0.3, seed + i) * 0.25, [[-X - 2, TOP - 5, za], [X + 2, TOP + 1, zb]], 1, (x, y, z, d) => {
      let c = tone;
      const g = h01(Math.floor(z * 1.4), Math.floor(x / 11), seed + i);
      if (g > 0.8) c = mul(c, 0.88);
      else if (g < 0.1) c = mul(c, 1.07);
      if (y >= TOP - 1) {
        if (h01(x, z, 71) > 0.985) c = mul(c, 0.66); // dings
        if (Math.abs(((x * 0.7 + z * 0.4) % 9) - 4) < 0.25 && h01(Math.floor(x / 9), Math.floor(z / 6), 3) > 0.7) c = mul(c, 0.72); // knife scores
        const so = Math.hypot(x - 16, (z - 14) * 1.3) + lump(x, 0, z, 0.6, 2) * 2;
        if (so < 6) c = mixRGB(c, 0x2a1a0e, 0.55 * (1 - so / 6)); // oil soaked in
        const ring = Math.abs(Math.hypot(x + 6, z - 27) - 3.2);
        if (ring < 0.6) c = mixRGB(c, 0x3a2414, 0.5); // a mug ring
      } else if (d > -1) c = mul(c, 0.8);
      return c;
    });
  });
  // ---- the tool wall: vertical planks with V-grooves, a shelf of tins on brackets
  for (let i = 0; i < 10; i++) {
    const x0 = -X + i * 9;
    const sag = h01(i, 2, seed) * 0.6;
    plank(m, [x0 + 4.5, TOP, -0.5], [x0 + 4.5, 90 - (i % 3 === 1 ? 1 : 0), -0.5 + sag], 8.4, 2.6, i % 4 === 2 ? 0x7a5234 : 0x8a5e38, seed + 50 + i, { up: [0, 0, 1], r: 0.5, knots: true, lumpy: 0.12 });
  }
  plank(m, [-X, 85.5, 4], [X, 85.5, 4], 9, 1.8, OAK, seed + 61, { r: 0.6 });
  for (const bx of [-30, 0, 30]) plank(m, [bx, 78, 1], [bx, 84.5, 7], 1.8, 1.8, OAK_DK, seed + 62, { up: [1, 0, 0], r: 0.5 });
  [[-38, 4, 0xb0402a], [-31, 5, 0x3a5a8a], [-25, 3.5, 0xc8a050], [-14, 4.5, 0x6a7a3a], [9, 3, 0x8a8a8a], [16, 4, 0xa83a2a], [27, 5.5, 0x4a6a8a], [36, 4, 0xc8b070]].forEach(([tx, h, c], i) => {
    const r = 2 + (i % 3) * 0.6;
    lathe(m, tx, 4, 87, 87 + Math.round(h * 1.6), (t) => r - (t > 0.85 ? 0.4 : 0), (x, y, z, outer) => (y === 87 + Math.round(h * 1.6) ? mul(c, 0.7) : outer && mod(y, 4) === 1 ? mul(c, 1.25) : c), { dents: [{ a: i * 1.3, y0: 88, y1: 90, depth: 0.5, width: 0.7 }] }, VF.METAL);
  });
  egg(m, [-5, 88.5, 4], [5, 2.2, 3], 0x8a6440, 0, 0.3, 7); // a cartridge box
  // ---- tools on pegs
  const peg = (x: number, y: number) => rod(m, [x, y, 1], [x, y + 0.6, 4.2], 0.8, 0.7, 0xb08050);
  // claw hammer
  peg(-37, 79);
  rod(m, [-37, 58, 3.5], [-37, 77, 3.5], 1.25, 0.95, (x, y) => (y < 61 ? 0x2a1a10 : mul(0x9a6a3a, 0.95 + h01(0, y >> 2, 1) * 0.1)));
  fill(m, plankF([-41.5, 78.5, 3.5], [-33, 78.5, 3.5], 3, 3.2, [0, 0, 1], 0.9), [[-42, 77, 2], [-32, 80, 5]], 1, (_x, y) => (y > 79 ? STEEL_HI : STEEL), VF.METAL);
  rod(m, [-41.5, 78.5, 3.5], [-44, 75.5, 3.5], 1.3, 0.6, STEEL, VF.METAL);
  // hacksaw: bow frame + blade + pistol grip
  peg(-25, 81);
  tubeP(m, spline([[-31, 64, 3.2], [-31.5, 76, 3.2], [-25, 80.5, 3.2], [-18.5, 76, 3.2], [-19, 64, 3.2]], 5), [0.8], 0x5a5c60, VF.METAL);
  rod(m, [-31, 64.5, 3.2], [-19, 64.5, 3.2], 0.6, 0.6, 0xb8b8b4, VF.METAL);
  egg(m, [-31.5, 61, 3.2], [1.6, 3.6, 1.5], 0x7a2a1a, 0, 0.2, 3);
  // three screwdrivers in a row
  [[-11, 0xa8382a], [-7.5, 0xd8a840], [-4, 0x3a6a3a]].forEach(([sx, c], i) => {
    peg(sx, 82 - i);
    egg(m, [sx, 77 - i, 3.6], [1.3, 3.2, 1.3], (x, y) => (mod(y, 3) === 0 ? mul(c, 0.75) : c), 0, 0);
    rod(m, [sx, 73.5 - i, 3.6], [sx, 64 - i * 2, 3.6], 0.6, 0.5, STEEL_HI, VF.METAL);
  });
  // pliers (handles splayed, jaws closed) and an adjustable wrench
  peg(5, 81);
  rod(m, [3, 63, 3.4], [4.6, 76, 3.4], 1, 0.8, 0xa83a2a);
  rod(m, [8, 63, 3.4], [5.6, 76, 3.4], 1, 0.8, 0xa83a2a);
  rod(m, [5, 76, 3.4], [5, 80, 3.4], 1.1, 0.5, STEEL, VF.METAL);
  peg(13, 81);
  rod(m, [13, 62, 3.3], [13, 75, 3.3], 1.3, 1.2, STEEL, VF.METAL);
  fill(m, (x, y, z) => Math.max(dRBox(x + 0.5, y + 0.5, z + 0.5, 13, 78, 3.3, 3.2, 2.6, 1.1, 0.9), -dRBox(x + 0.5, y + 0.5, z + 0.5, 13, 80.4, 3.3, 1.2, 1.8, 3, 0.3)), [[9, 75, 1], [17, 82, 6]], 1, (_x, y) => (y > 79 ? STEEL_HI : STEEL), VF.METAL);
  // files and a coil of wire
  for (const [fx, ln] of [[21, 13], [24, 11]]) {
    peg(fx, 81);
    rod(m, [fx, 79, 3.5], [fx, 75, 3.5], 1.1, 1, 0x6a4424);
    rod(m, [fx, 74.5, 3.5], [fx, 74.5 - ln, 3.5], 0.9, 0.5, (_x, y) => (mod(y, 2) ? 0x5a5c60 : 0x45474c), VF.METAL);
  }
  peg(34, 80);
  for (let a = 0; a < 6.28 * 4; a += 0.08) {
    const rr = 5 + Math.sin(a * 0.25) * 0.4;
    m.set(Math.round(34 + Math.cos(a) * rr), Math.round(74 + Math.sin(a) * rr * 0.9), Math.round(3.4 + (a / 6.28) * 0.5), a % 2 > 1 ? 0xb87a3a : 0xa86a30, VF.METAL);
  }
  // ---- the vise, bolted over the front-left corner (cast iron, green paint chipped to the metal)
  const VX = -33, VZ = 31;
  const vpaint = (x: number, y: number, z: number, d: number) => (d > -1 && h01(x, y, z) > 0.72 ? STEEL_HI : h01(x >> 1, y >> 1, z >> 1) > 0.5 ? 0x3e5a48 : 0x36503f);
  fill(m, (x, y, z) => smin(dRBox(x + 0.5, y + 0.5, z + 0.5, VX, TOP + 4, VZ - 2, 6, 4, 4.5, 1.6), dRBox(x + 0.5, y + 0.5, z + 0.5, VX, TOP + 0.8, VZ - 3, 7.5, 1, 5.5, 0.8), 1.5), [[VX - 9, TOP - 1, VZ - 9], [VX + 9, TOP + 9, VZ + 3]], 1, vpaint, VF.METAL);
  fill(m, (x, y, z) => dRBox(x + 0.5, y + 0.5, z + 0.5, VX, TOP + 4.5, VZ + 6.5, 6, 4.3, 2.6, 1.4), [[VX - 7, TOP, VZ + 3], [VX + 7, TOP + 9, VZ + 10]], 1, vpaint, VF.METAL);
  for (const jz of [VZ + 2.2, VZ + 3.6]) fill(m, (x, y, z) => dRBox(x + 0.5, y + 0.5, z + 0.5, VX, TOP + 7.2, jz, 6, 1.4, 0.6, 0.2), [[VX - 7, TOP + 5, jz - 1], [VX + 7, TOP + 9, jz + 1]], 0.5, (x) => (mod(x, 2) ? 0x9a9ca0 : 0x6a6c70), VF.METAL); // serrated jaw plates
  rod(m, [VX, TOP + 3, VZ - 2], [VX, TOP + 3, VZ + 12], 1.3, 1.3, (_x, _y, z) => (mod(z, 2) ? 0x7a7c80 : 0x5a5c60), VF.METAL); // screw
  rod(m, [VX - 7, TOP + 3, VZ + 12], [VX + 7, TOP + 3, VZ + 12], 0.8, 0.8, STEEL_HI, VF.METAL); // T-handle
  for (const sx of [-7.5, 7.5]) egg(m, [VX + sx, TOP + 3, VZ + 12], [1.4, 1.4, 1.4], STEEL, VF.METAL);
  // ---- gooseneck lamp clamped to the back-right corner, shade over the work
  fill(m, (x, y, z) => dRBox(x + 0.5, y + 0.5, z + 0.5, 37, TOP + 1.5, 4, 3, 1.5, 3, 0.8), [[33, TOP, 0], [41, TOP + 3, 8]], 1, () => 0x3a3c40, VF.METAL);
  const neck = spline([[37, TOP + 2, 4], [37, TOP + 14, 5], [33, TOP + 25, 9], [26, TOP + 27, 15], [21, TOP + 22, 17]], 6);
  tubeP(m, neck, [1.1], (x, y, z) => (mod(x + y + z, 3) === 0 ? 0x5a5650 : 0x3e3a36), VF.METAL);
  const SY = TOP + 16;
  lathe(m, 21, 17, SY, SY + 6, (t) => 1.6 + (1 - t) * 4.6, (x, y, z, outer, ang) => (!outer ? 0xf0e0b8 : y === SY ? 0x7a5a28 : mod(Math.round(ang * 3), 2) ? BRASS : mul(BRASS, 0.85)), { hollow: true }, VF.METAL);
  egg(m, [21, SY + 1.2, 17], [1.8, 1.8, 1.8], 0xfff4d8, VF.GLOW);
  // ---- the gun stripped on an oilcloth (the scene lays the real revolver on the cradle)
  for (let x = -24; x <= 6; x++)
    for (let z = 9; z <= 26; z++) {
      const wr = lump(x, 0, z, 0.45, 9);
      if ((x === -24 || x === 6 || z === 9 || z === 26) && h01(x, 1, z) > 0.6) continue; // frayed hem
      let c = mod(Math.floor((x + 30) / 3) + Math.floor(z / 3), 2) ? 0xd8cdb0 : 0xc8b898;
      const st = Math.hypot(x + 9, z - 18) + wr * 3;
      if (st < 5) c = mixRGB(c, 0x6a5038, 0.45);
      m.set(x, TOP, z, c, VF.SOFTAO);
      if (wr > 0.55) m.set(x, TOP + 1, z, mul(c, 1.04), VF.SOFTAO);
    }
  rod(m, [-21, TOP + 2.2, 12], [-6, TOP + 2.2, 13], 1.6, 1.4, (x) => (x > -8 ? BLUED : mul(BLUED, 1.1)), VF.METAL); // a spare barrel
  egg(m, [-5.6, TOP + 2.2, 13], [0.6, 0.9, 0.9], 0x0a0a0c);
  lathe(m, -15, 21, TOP + 1, TOP + 4, () => 3.4, (x, y, z, outer, ang) => (outer && mod(Math.round(ang * 6 / Math.PI), 2) === 0 ? mul(BLUED, 1.5) : BLUED), {}, VF.METAL); // a fluted cylinder
  for (let a = 0; a < 6.28 * 6; a += 0.22) m.set(Math.round(-3 + a * 0.32), Math.round(TOP + 2 + Math.sin(a) * 1.2), Math.round(20 + Math.cos(a) * 1.2), 0x8a8c90, VF.METAL); // a mainspring
  for (let k = 0; k < 6; k++) lathe(m, -22 + k * 2.4, 24, TOP + 1, TOP + 4, (t) => (t > 0.7 ? 0.6 : 0.9), (_x, y) => (y > TOP + 3 ? 0x9a9a92 : 0xd8a848), {}, VF.METAL); // cartridges
  lathe(m, 2, 23, TOP + 1, TOP + 6, (t) => 2.4 - t * 1.1, (_x, y) => (y > TOP + 4 ? 0x8a6a30 : BRASS), { dents: [{ a: 2, y0: TOP + 2, y1: TOP + 4, depth: 0.5, width: 0.6 }] }, VF.METAL); // brass oil can
  rod(m, [2, TOP + 6, 23], [-1, TOP + 10, 25], 0.5, 0.35, BRASS, VF.METAL);
  // the cradle: a felt-lined walnut gun rest at the centre-right
  for (const cx of [12, 26]) fill(m, (x, y, z) => Math.max(dRBox(x + 0.5, y + 0.5, z + 0.5, cx, TOP + 1.5, 17, 1.4, 1.8, 6, 0.6), -dEll(x + 0.5, y + 0.5, z + 0.5, cx, TOP + 4.2, 17, 4, 2.4, 3.2)), [[cx - 2, TOP, 10], [cx + 2, TOP + 4, 24]], 1, (_x, y) => (y > TOP + 2 ? 0x6a1e1e : WALNUT));
  return { model: m, voxelSize: FV, meta: { top: (TOP + 1) * FV, lamp: pivotOf(m, FV, [21, SY + 1.2, 17]), gun: pivotOf(m, FV, [19, TOP + 4.2, 17]) } };
}

// =====================================================================
// THE GARAGE
// =====================================================================
/** wall rack for five sandboards standing nose-up — 1/48: two log uprights, a felt-lined tray with dividers,
 *  a top rail with leather loops. meta.slots: bottom-centre of each board (m) + lean (rad, top towards -Z). */
export function boardRack(seed = 2): StaticModel & { meta: { slots: V3[]; lean: number } } {
  const m = new VoxelModel('board_rack');
  const N = 5, SP = 20, HW = (N * SP) / 2 + 2;
  for (const px of [-HW, HW]) {
    plank(m, [px, 0, 3], [px, 82, 3], 5, 5, 0x7a5232, seed + px, { up: [0, 0, 1], r: 1.8, lumpy: 0.35 });
    egg(m, [px, 82.5, 3], [2.8, 1.6, 2.8], 0x6a4428, 0, 0.2, seed);
  }
  // tray: base board, front lip, felt, dividers
  plank(m, [-HW + 2, 5, 10], [HW - 2, 5, 10], 15, 2.4, OAK_DK, seed + 3, { r: 0.6 });
  plank(m, [-HW + 2, 8.5, 17.5], [HW - 2, 8.5, 17.5], 1.8, 7, OAK, seed + 4, { up: [0, 0, 1], r: 0.7 });
  plank(m, [-HW + 2, 8.5, 2.5], [HW - 2, 8.5, 2.5], 1.8, 7, OAK, seed + 5, { up: [0, 0, 1], r: 0.7 });
  for (let x = -HW + 3; x <= HW - 3; x++) for (let z = 4; z <= 16; z++) m.set(x, 7, z, h01(x >> 1, 0, z >> 1) > 0.5 ? 0x3e5a3a : 0x46623f, VF.SOFTAO);
  for (let i = 0; i <= N; i++) {
    const dx = -HW + 2 + i * SP;
    plank(m, [dx, 7.5, 3], [dx, 7.5, 17], 1.6, 5, OAK_DK, seed + 10 + i, { r: 0.6 });
  }
  // top rail (a peeled pole) with leather loops
  plank(m, [-HW - 2, 67, 2], [HW + 2, 67, 2], 4.4, 4.4, 0x8a5e36, seed + 20, { r: 2, lumpy: 0.3 });
  const slots: V3[] = [];
  const lean = 0.075;
  for (let i = 0; i < N; i++) {
    const cx = -HW + 2 + SP / 2 + i * SP;
    tubeP(m, spline([[cx - 7, 69.5, 2], [cx - 7, 66, 6.8], [cx, 64.5, 7.5], [cx + 7, 66, 6.8], [cx + 7, 69.5, 2]], 4), [0.7], (x, y, z) => (h01(x, y, z) > 0.8 ? 0x4a2412 : LEATHER));
    slots.push(pivotOf(m, FV, [cx, 8, 10]));
  }
  // recompute after everything is placed (bounds are final now)
  return { model: m, voxelSize: FV, meta: { slots: slots.map((_, i) => pivotOf(m, FV, [-HW + 2 + SP / 2 + i * SP, 8, 10])), lean } };
}

/** a battered sawhorse — 1/48: an adzed top beam, four splayed tapered legs, cross braces. Beam runs along Z. */
export function sawhorse(seed = 3): StaticModel & { meta: { top: number } } {
  const m = new VoxelModel('sawhorse');
  const T = 34, L = 15;
  plank(m, [0, T - 2, -L], [0, T - 2, L], 4.6, 4.2, 0x8a6038, seed, { up: [0, 1, 0], r: 1.1, lumpy: 0.35, knots: true });
  for (const sz of [-1, 1])
    for (const sx of [-1, 1]) rod(m, [sx * 1.6, T - 3, sz * (L - 3)], [sx * 9.5, 0.5, sz * (L + 1.5)], 1.7, 1.25, (x, y, z) => mul(0x7a5232, 0.92 + h01(x >> 1, y >> 2, z) * 0.14));
  for (const sz of [-1, 1]) plank(m, [-6.5, 10, sz * (L - 0.5)], [6.5, 10, sz * (L - 0.5)], 2.2, 2.6, 0x6a4428, seed + sz, { up: [0, 0, 1], r: 0.6 });
  plank(m, [0, 6, -L], [0, 6, L], 1.8, 2.6, 0x6a4428, seed + 9, { up: [1, 0, 0], r: 0.6 });
  // saw kerfs and paint drips on the beam
  for (const kz of [-9, -4, 6]) for (let x = -2; x <= 2; x++) m.set(x, T - 0, kz, 0x3a2414);
  for (const [px, pz] of [[1, 2], [-2, -6], [2, 9]]) for (let k = 0; k < 3; k++) m.set(px, T - 1 - k, pz, 0xb8402a);
  return { model: m, voxelSize: FV, meta: { top: (T - 0) * FV } };
}

/** what lies on the board being waxed — 1/64: a rubbed bar of wax, a tin of paste wax with its lid off, a scraper,
 *  a folded rag, wax crumbs */
export function waxKit(): StaticModel {
  const m = new VoxelModel('wax_kit');
  fill(m, (x, y, z) => dRBox(x + 0.5, y + 0.5, z + 0.5, -10, 2, 2, 5.5, 2, 3.5, 1.6) + lump(x, y, z, 0.6, 3) * 0.3, [[-17, 0, -3], [-3, 5, 7]], 1, (x, y, z) => (y >= 3 && h01(x, 9, z) > 0.4 ? 0xf2e2a8 : 0xe2cc88), VF.SOFTAO);
  lathe(m, 6, -4, 0, 3, () => 4.6, (x, y, z, outer) => (y === 3 && !outer ? (h01(x, y, z) > 0.6 ? 0xe8d49a : 0xdcc48a) : outer && y === 1 ? 0xa83a2a : 0x8a8c90), {}, VF.METAL);
  fill(m, (x, y, z) => dRBox(x + 0.5, y + 0.5, z + 0.5, 14, 2.5, -5, 0.8, 2.5, 4.8, 0.4), [[12, 0, -10], [16, 6, 0]], 1, () => 0xa83a2a, VF.METAL); // the lid on edge
  rod(m, [-2, 0.8, 10], [9, 0.8, 12], 1.2, 1.1, 0x9a6a3a);
  fill(m, (x, y, z) => dRBox(x + 0.5, y + 0.5, z + 0.5, 12, 0.6, 12.6, 3.4, 0.4, 2.4, 0.2), [[8, 0, 9], [16, 2, 16]], 1, () => STEEL_HI, VF.METAL);
  for (let x = -16; x <= -2; x++)
    for (let z = -14; z <= -6; z++) {
      const f = lump(x, 0, z, 0.5, 5);
      m.set(x, 0, z, mod(x + z, 5) === 0 ? 0xa8a090 : 0xc8bca8, VF.SOFTAO);
      if (f > 0.2) m.set(x, 1, z, 0xd2c6b0, VF.SOFTAO);
    }
  for (let i = 0; i < 9; i++) m.set(Math.round(-1 + (h01(i, 1, 2) - 0.5) * 14), 0, Math.round(-2 + (h01(i, 2, 2) - 0.5) * 12), 0xeedc9e);
  return S(m, DV);
}

/** the wax bench — 1/48: a split-log slab on stout legs; wax pots (one warming on a little spirit burner),
 *  brushes in a jar, a block plane, a can of nails, rags; a sack and a bucket underneath. meta.burner (m). */
export function waxBench(seed = 4): StaticModel & { meta: { top: number; burner: V3 } } {
  const m = new VoxelModel('wax_bench');
  const X = 31, D = 26, TOP = 40;
  for (const [lx, lz] of [[-27, 4], [27, 4], [-27, 21], [27, 21]] as const) rod(m, [lx + Math.sign(lx) * 1.2, 0, lz], [lx, TOP - 3, lz], 2.8, 2.4, (x, y, z) => mul(0x7a5232, 0.9 + h01(x >> 1, y >> 3, z >> 1) * 0.16));
  plank(m, [-27, 9, 12.5], [27, 9, 12.5], 2.4, 2.6, 0x6a4428, seed + 2, { r: 0.6 });
  // the slab: flat sawn top, bark on the front live edge
  fill(m, (x, y, z) => dRBox(x + 0.5, y + 0.5, z + 0.5, 0, TOP - 2, D / 2, X, 2.4, D / 2 + Math.sin(x * 0.21) * 0.9 + lump(x, 0, 0, 0.3, 5) * 0.6, 1.4), [[-X - 1, TOP - 5, -2], [X + 1, TOP + 1, D + 3]], 1, (x, y, z, d) => {
    if (z > D - 1 && d > -1.2) return h01(x >> 1, y, 3) > 0.5 ? 0x4a3020 : 0x5a3a24; // bark
    let c = mul(0xb07a44, 0.94 + h01(Math.floor(z * 1.3), x >> 3, seed) * 0.12);
    if (y >= TOP && h01(x, z, 13) > 0.97) c = mul(c, 0.7);
    if (y >= TOP && Math.hypot(x - 12, z - 12) < 4) c = mixRGB(c, 0xd8c48a, 0.5); // wax spilt and rubbed in
    return c;
  });
  // the spirit burner + a pot of melting wax over it
  lathe(m, 14, 12, TOP + 1, TOP + 4, (t) => 2.6 - t * 0.6, () => BRASS, {}, VF.METAL);
  egg(m, [14, TOP + 5.2, 12], [0.9, 1.4, 0.9], 0x8ab8ff, VF.GLOW);
  for (const a of [0, 2.1, 4.2]) rod(m, [14 + Math.cos(a) * 4, TOP + 1, 12 + Math.sin(a) * 4], [14 + Math.cos(a) * 3, TOP + 7, 12 + Math.sin(a) * 3], 0.5, 0.5, 0x3a3836, VF.METAL);
  lathe(m, 14, 12, TOP + 7, TOP + 12, (t) => 4 + t * 0.4, (x, y, z, outer) => (!outer && y === TOP + 11 ? 0xf0dc98 : y === TOP + 12 && !outer ? null : 0x3a3c40), { hollow: true }, VF.METAL);
  rod(m, [17.5, TOP + 11, 12], [24, TOP + 11.6, 13], 0.6, 0.6, 0x2a2a2c, VF.METAL);
  // a cold pot of wax with drips down the side
  lathe(m, -20, 9, TOP + 1, TOP + 7, () => 3.6, (x, y, z, outer, ang) => (y === TOP + 7 ? 0xe8d49a : outer && Math.abs(ang - 1.2) < 0.4 && y > TOP + 2 + (h01(Math.round(ang * 9), 1, 1) * 4) ? 0xe8d49a : 0x8a5a3a), {}, VF.METAL);
  // brushes standing in a jar
  lathe(m, -9, 6, TOP + 1, TOP + 6, (t) => 2.6 - t * 0.3, (x, y, z, outer) => (outer ? 0xa8c4bc : 0x7a9a90), { hollow: true }, VF.METAL);
  [[-9.8, -0.15], [-8.2, 0.2], [-9, 0.05]].forEach(([bx, lean], i) => {
    rod(m, [bx, TOP + 2, 6], [bx + lean * 14, TOP + 13 + i, 6 + (i - 1)], 0.6, 0.5, 0x9a6a3a);
    egg(m, [bx + lean * 15, TOP + 14.5 + i, 6 + (i - 1)], [1.2, 1.6, 0.7], i === 1 ? 0xd8c8a8 : 0x5a4030);
  });
  // block plane
  fill(m, (x, y, z) => smin(dRBox(x + 0.5, y + 0.5, z + 0.5, -2, TOP + 1.6, 18, 6, 1.5, 2.1, 0.8), dEll(x + 0.5, y + 0.5, z + 0.5, -4, TOP + 3.3, 18, 2.6, 1.6, 1.4), 1), [[-9, TOP, 15], [5, TOP + 6, 21]], 1, (_x, y) => (y > TOP + 2 ? 0x3a5a7a : STEEL), VF.METAL);
  // can of nails, rag hanging over the edge
  lathe(m, 26, 5, TOP + 1, TOP + 6, () => 2.6, (x, y, z, outer) => (y === TOP + 6 && !outer ? (h01(x, z, 2) > 0.5 ? 0x8a8c90 : 0x5a5c60) : 0x7a6a50), {}, VF.METAL);
  for (let x = -26; x <= -16; x++)
    for (let k = 0; k <= 9; k++) {
      const z = D + 1 + Math.min(k, 2), y = TOP - (k > 2 ? k - 2 : 0) + (k < 2 ? 0 : 0);
      if (k > 6 && h01(x, k, 1) > 0.6) continue;
      m.set(x + Math.round(Math.sin(k * 0.7) * 0.6), y, z, mod(x + k, 4) < 2 ? 0x9a3428 : 0x7a2a20, VF.SOFTAO);
    }
  // under the bench: a slumped sack and a bucket
  fill(m, (x, y, z) => smin(dEll(x + 0.5, y + 0.5, z + 0.5, -12, 7, 12, 9, 7, 7), dEll(x + 0.5, y + 0.5, z + 0.5, -14, 13, 11, 4, 3.5, 3.5), 3) + lump(x, y, z, 0.5, 4) * 0.8, [[-23, 0, 3], [-2, 18, 21]], 1, (x, y, z) => (mod(x + y, 3) === 0 ? 0x9a8458 : h01(x >> 1, y >> 1, z) > 0.5 ? 0xb09868 : 0xa88e62), VF.SOFTAO);
  lathe(m, 14, 13, 1, 13, (t) => 5 + t * 1.3, (x, y, z, outer) => (outer && (y === 3 || y === 11) ? 0x3a3836 : outer ? mul(0x6a6460, 0.9 + h01(x, y >> 1, z) * 0.2) : y === 1 ? 0x2a2420 : null), { hollow: true }, VF.METAL);
  return { model: m, voxelSize: FV, meta: { top: (TOP + 1) * FV, burner: pivotOf(m, FV, [14, TOP + 5, 12]) } };
}

/** one leaf of the barn doors — rig 'leaf', hinged on its x = 0 edge, extending along +X; outside face +Z.
 *  1.45 × 3.0 m at 1/48: seven weathered vertical planks with gaps and knots, a Z brace with a mid rail, forged
 *  strap hinges with rivets, a ring pull. mirror = true builds the right-hand leaf (extends along -X). */
export function barnDoorRig(mirror = false, seed = 5): RigSpec {
  const m = new VoxelModel('barn_leaf');
  const W = 69, H = 143;
  const WG = [0x8a7a62, 0x7e6e58, 0x94846a, 0x766650, 0x887458];
  for (let i = 0; i < 7; i++) {
    const x0 = i * 9.86 + 0.5, x1 = x0 + 9.2;
    const tone = WG[Math.floor(h01(i, seed, 2) * WG.length)];
    const top = H - (i === 6 ? 3 : h01(i, 4, seed) > 0.6 ? 1 : 0);
    fill(m, (x, y, z) => dRBox(x + 0.5, y + 0.5, z + 0.5, (x0 + x1) / 2, top / 2, 0, (x1 - x0) / 2, top / 2, 1.3, 0.6) + lump(x, y, z, 0.2, i) * 0.2, [[x0, 0, -2], [x1, top, 2]], 1, (x, y, z, d) => {
      let c = tone;
      const g = h01(x, Math.floor(y / 13), seed + i);
      if (g > 0.82) c = mul(c, 0.88);
      if (Math.hypot(x - (x0 + 5), (y - 30 - i * 13) * 0.5) < 1.3 && i % 2 === 0) c = 0x3a2a1a; // knot
      if (y < 8) c = mul(c, 0.82); // splash grime
      if (d > -0.8) c = mul(c, 0.92);
      return c;
    });
  }
  // inside face: Z brace (two rails + a diagonal) and a mid rail
  const RC = 0x6e604c;
  for (const ry of [12, 72, H - 12]) plank(m, [1, ry, -2.4], [W - 1, ry, -2.4], 8, 2.6, RC, seed + ry, { up: [0, 0, 1], r: 0.8, lumpy: 0.2 });
  plank(m, [4, 16, -2.4], [W - 4, 68, -2.4], 7, 2.4, RC, seed + 2, { up: [0, 0, 1], r: 0.8 });
  plank(m, [4, 76, -2.4], [W - 4, H - 16, -2.4], 7, 2.4, RC, seed + 3, { up: [0, 0, 1], r: 0.8 });
  // forged strap hinges (outside), tapering away from the knuckle, rivets
  for (const hy of [14, 72, H - 14]) {
    fill(m, (x, y, z) => dCap(x + 0.5, y + 0.5, z + 0.5, [1, hy, 2], [46, hy, 2], 2.2, 0.9), [[-1, hy - 3, 0], [48, hy + 3, 4]], 1, (x) => (mod(x, 9) === 4 ? 0x6a6660 : 0x2e2c2a), VF.METAL);
    rod(m, [0, hy - 4, 0], [0, hy + 4, 0], 1.8, 1.8, 0x3a3836, VF.METAL); // knuckle
  }
  // ring pull + its plate
  fill(m, (x, y, z) => dRBox(x + 0.5, y + 0.5, z + 0.5, W - 9, 64, 1.8, 3, 4, 0.6, 0.5), [[W - 13, 59, 0], [W - 5, 69, 3]], 1, () => 0x2e2c2a, VF.METAL);
  for (let a = 0; a < 6.283; a += 0.12) m.set(Math.round(W - 9 + Math.sin(a) * 3.6), Math.round(58.5 + Math.cos(a) * 3.6), 3, 0x4a4642, VF.METAL);
  if (mirror) {
    const mm = new VoxelModel('barn_leaf_r');
    m.forEach((x, y, z, c, f) => mm.set(-1 - x, y, z, c, f));
    return { name: 'barn_leaf_r', voxelSize: FV, parts: [{ name: 'leaf', model: mm, pivot: [0, 0, 0], attach: [0, 0, 0] }], meta: { width: W * FV, height: H * FV } };
  }
  return { name: 'barn_leaf_l', voxelSize: FV, parts: [{ name: 'leaf', model: m, pivot: [0, 0, 0], attach: [0, 0, 0] }], meta: { width: W * FV, height: H * FV } };
}

// =====================================================================
// THE BOOK OF SKILLS
// =====================================================================
/** a carved oak lectern — 1/48: cross feet with scrolled toes, a turned column with beads, a slanted reading desk
 *  with a book ledge, a brass candle arm. meta: desk (centre of the desk surface, m), tilt (rad, desk faces +Z),
 *  flame (m). */
export function lectern(seed = 6): StaticModel & { meta: { desk: V3; tilt: number; flame: V3 } } {
  const m = new VoxelModel('lectern');
  // feet: two crossed planks with rolled scroll toes
  for (const [ax, az] of [[1, 0], [0, 1]] as const) {
    plank(m, [-15 * ax, 2.2, -15 * az], [15 * ax, 2.2, 15 * az], 4.6, 4.2, OAK_DK, seed + ax, { r: 1.5, lumpy: 0.2 });
    for (const s of [-1, 1]) egg(m, [s * 15 * ax, 3, s * 15 * az], [ax ? 2.2 : 2.8, 3.2, az ? 2.2 : 2.8], 0x5e3c20, 0, 0.15, seed);
  }
  lathe(m, 0, 0, 4, 46, (t) => {
    const bead = (c: number, w: number) => Math.max(0, 1 - Math.abs(t - c) / w);
    return 2.3 + 1.3 * bead(0.04, 0.06) + 0.9 * bead(0.3, 0.035) + 0.9 * bead(0.62, 0.035) + 1.1 * bead(0.95, 0.06) - 0.3 * Math.sin(t * Math.PI);
  }, (x, y, z, outer, ang) => (mod(Math.round(ang * 2.5 + y * 0.15), 5) === 0 ? mul(OAK, 0.86) : OAK), { sx: 1, sz: 1 });
  // the slanted desk on its block
  const tilt = 0.42, c = Math.cos(tilt), s = Math.sin(tilt);
  const DC: V3 = [0, 50, 1];
  fill(m, (x, y, z) => dRBox(x + 0.5, y + 0.5, z + 0.5, 0, 47, 0, 6, 3, 5, 1.2), [[-7, 43, -6], [7, 51, 6]], 1, () => OAK_DK);
  plank(m, [-16, DC[1], DC[2]], [16, DC[1], DC[2]], 22, 2.2, OAK, seed + 3, { up: [0, c, s], r: 0.7, lumpy: 0.1 });
  const lip: V3 = [0, DC[1] - s * 11, DC[2] + c * 11];
  rod(m, [-16, lip[1] + 1, lip[2] + 0.5], [16, lip[1] + 1, lip[2] + 0.5], 1.4, 1.4, 0x5e3c20);
  // carved apron under the front edge (scalloped)
  for (let x = -15; x <= 15; x++) {
    const h = 2 + Math.round(Math.abs(Math.sin(x * 0.42)) * 2);
    for (let k = 0; k < h; k++) m.set(x, Math.round(lip[1] - 1 - k), Math.round(lip[2] - 1), mul(OAK_DK, 0.95 + (k === h - 1 ? -0.1 : 0)));
  }
  // brass candle arm on the right side
  tubeP(m, spline([[14, 47, 0], [19, 48, 1], [22, 51, 2]], 4), [0.7], BRASS, VF.METAL);
  lathe(m, 22, 2, 51, 52, () => 2.4, () => BRASS_HI, {}, VF.METAL);
  lathe(m, 22, 2, 53, 59, (t) => 1.3 - t * 0.15, (x, y, z) => (y === 59 ? 0xd8ccb0 : h01(x, y, z) > 0.8 ? 0xe2d6bc : 0xf0e6d0), { tiltX: 0.03 });
  m.set(23, 56, 2, 0xe8dcc0).set(23, 55, 2, 0xe8dcc0); // wax drip
  m.set(22, 60, 2, 0xffd890, VF.GLOW);
  const top: V3 = [DC[0], DC[1] + c * 1.2, DC[2] - s * 1.2];
  return { model: m, voxelSize: FV, meta: { desk: pivotOf(m, FV, top), tilt, flame: pivotOf(m, FV, [22, 60.5, 2]) } };
}

/** the Book of Skills lying open — 1/64, flat in its own frame (pages face +Y, spine along Z, reader at +Z).
 *  Thick curved page blocks rising from the gutter, gilt edges, cracked leather boards with brass corners,
 *  rows of faded ink with red and gold initials, a silk ribbon running over the fore-edge. */
export function openTome(): StaticModel {
  const m = new VoxelModel('open_tome');
  const HW = 21, HD = 14;
  const stack = (a: number) => 1.2 + 4.4 * Math.sqrt(a) * (1 - 0.45 * a) + (a > 0.9 ? (a - 0.9) * 8 : 0);
  for (let x = -HW - 1; x <= HW + 1; x++)
    for (let z = -HD - 1; z <= HD + 1; z++) {
      const a = Math.min(1, Math.abs(x + 0.5) / HW);
      const cover = Math.abs(x + 0.5) > HW - 0.5 || Math.abs(z + 0.5) > HD - 0.5;
      // the boards (leather over wood), brass corners
      const corner = Math.abs(x + 0.5) > HW - 3 && Math.abs(z + 0.5) > HD - 3;
      m.set(x, 0, z, corner ? BRASS_HI : h01(x >> 1, 0, z >> 1) > 0.85 ? 0x4a1c10 : 0x5e2414, corner ? VF.METAL : 0);
      if (cover) continue;
      const top = Math.round(stack(a) + lump(x, 0, z, 0.25, 3) * 0.3 + (z > HD - 4 ? (z - HD + 4) * 0.15 : 0));
      for (let y = 1; y <= top; y++) {
        const edge = Math.abs(x + 0.5) > HW - 1.5 || Math.abs(z + 0.5) > HD - 1.5;
        let col = y === top ? 0xeee2c4 : edge ? (y % 2 ? 0xd8b860 : 0xc8a048) : 0xe2d4b0;
        if (y === top) {
          const lx = Math.abs(x + 0.5) - 2.5, row = mod(z + 40, 3);
          const margin = lx < 1 || lx > HW - 4 || z < -HD + 3 || z > HD - 3;
          if (!margin && row === 0 && h01(Math.floor(lx / 3.5) + (x < 0 ? 50 : 0), z, 11) > 0.16) col = h01(x, z, 3) > 0.5 ? 0x6a5444 : 0x7a6250; // ink rows
          if (!margin && lx > 1 && lx < 4 && z > HD - 7 && z < HD - 3) col = x < 0 ? 0xa82a1a : 0xc89a30; // illuminated initial
          if (Math.abs(x + 0.5) > HW - 5 && h01(x, z, 5) > 0.93) col = 0xd8c8a0; // foxing
          col = mixRGB(col, 0xb89a6a, Math.max(0, (Math.abs(x + 0.5) - (HW - 3)) / 3) * 0.4); // thumbed edges
        }
        m.set(x, y, z, col, y === top ? VF.SOFTAO : 0);
      }
    }
  // spine gutter shadow + headband
  for (let z = -HD; z < HD; z++) m.set(-1, 1, z, 0x8a7a5a).set(0, 1, z, 0x8a7a5a);
  for (const z of [-HD, HD - 1]) for (const x of [-1, 0]) m.set(x, 2, z, 0xa83a2a);
  // ribbon: from the gutter, over the near fore-edge, hanging down
  const rib = spline([[0, 2, -HD + 2], [1, 3, 0], [3, 3.5, HD - 2], [4, 1, HD + 2], [4.5, -5, HD + 3], [5, -10, HD + 2.5]], 6);
  for (const p of rib) for (const w of [0, 1]) m.set(Math.round(p[0]) + w, Math.round(p[1]), Math.round(p[2]), w ? 0x8a1a12 : 0xb02a1e, VF.SOFTAO);
  return S(m, DV);
}

// =====================================================================
// THE LIVING ROOM
// =====================================================================
const RED = [0xa8302a, 0xb43a30, 0x9a2a24, 0xc0463a];
/** a fabric weave: Navajo-style bands with stepped diamonds (u along the warp, v across) */
function navajo(u: number, v: number) {
  const band = Math.floor(mod(v, 34) / 2);
  const cream = 0xe8dcc0, red = 0xb0302a, black = 0x2a2420, mustard = 0xd0a040, rust = 0x8a3a20;
  if (band === 0 || band === 16) return black;
  if (band === 1 || band === 15) return cream;
  if (band >= 6 && band <= 10) {
    const cv = mod(v, 34) - 16, cu = mod(u + 8, 16) - 8;
    const dd = Math.abs(cu) + Math.abs(Math.round(cv * 0.9));
    if (dd < 3) return mustard;
    if (dd < 5) return black;
    if (dd < 7) return cream;
    return red;
  }
  if (band === 3 || band === 13) return mod(Math.floor(u / 2), 2) ? rust : mustard;
  return red;
}
/** plaid (tartan) for blankets and pillows */
function plaid(u: number, v: number, a = 0xa8282a, b = 0x2a4a2e, c = 0x1e1c1a) {
  const su = mod(u, 12), sv = mod(v, 12);
  const bu = su < 4 ? 2 : su < 6 ? 1 : 0, bv = sv < 4 ? 2 : sv < 6 ? 1 : 0;
  const k = bu + bv;
  if (k >= 4) return c;
  if (k === 3) return mixRGB(b, c, 0.5);
  if (k === 2) return b;
  if (k === 1) return mixRGB(a, b, 0.35);
  return (u + v) % 2 ? a : mul(a, 0.94);
}
/** a draped cloth: for each x in [x0,x1] follow the (y,z) path, `thick` voxels, with folds; col(u along path, x) */
function drape(m: VoxelModel, x0: number, x1: number, path: [number, number][], thick: number, col: (s: number, x: number) => number, o: { fold?: number; fringe?: number; seed?: number } = {}) {
  const pts: [number, number][] = [];
  for (let i = 0; i < path.length - 1; i++) {
    const [ay, az] = path[i], [by, bz] = path[i + 1];
    const n = Math.max(1, Math.ceil(Math.hypot(by - ay, bz - az) * 2));
    for (let k = 0; k < n; k++) pts.push([ay + ((by - ay) * k) / n, az + ((bz - az) * k) / n]);
  }
  pts.push(path[path.length - 1]);
  let sAcc = 0;
  for (let i = 0; i < pts.length; i++) {
    if (i > 0) sAcc += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    const j = Math.min(pts.length - 1, i + 1), k0 = Math.max(0, i - 1);
    const ty = pts[j][0] - pts[k0][0], tz = pts[j][1] - pts[k0][1];
    const tl = Math.hypot(ty, tz) || 1;
    const ny = tz / tl, nz = -ty / tl; // normal (left of the path)
    for (let x = x0; x <= x1; x++) {
      const fold = (o.fold ?? 0) * Math.sin(x * 0.55 + sAcc * 0.08 + (o.seed ?? 0)) * Math.min(1, sAcc / 12);
      for (let t = 0; t < thick; t++) {
        const y = pts[i][0] + ny * (t + fold), z = pts[i][1] + nz * (t + fold);
        m.set(x, Math.round(y), Math.round(z), col(Math.round(sAcc), x), VF.SOFTAO);
      }
    }
  }
  // fringe at the path end: little twisted strands
  if (o.fringe) {
    const [ey, ez] = pts[pts.length - 1], [py, pz] = pts[Math.max(0, pts.length - 3)];
    const dy = ey - py, dz = ez - pz, dl = Math.hypot(dy, dz) || 1;
    for (let x = x0; x <= x1; x += 2)
      for (let k = 1; k <= o.fringe; k++) m.set(x + (k > 2 && (x >> 1) % 2 ? 1 : 0), Math.round(ey + (dy / dl) * k), Math.round(ez + (dz / dl) * k), mod(x, 6) < 2 ? 0xd8c8a0 : 0xe8dcc0, VF.SOFTAO);
  }
}
/** a plump squashed pillow (corners pinched), tilted */
function pillow(m: VoxelModel, c: V3, half: V3, tiltX: number, tiltZ: number, col: (u: number, v: number, d: number) => number, seed: number) {
  const cx = Math.cos(tiltX), sx = Math.sin(tiltX), cz = Math.cos(tiltZ), sz = Math.sin(tiltZ);
  fill(m, (x, y, z) => {
    let px = x + 0.5 - c[0], py = y + 0.5 - c[1], pz = z + 0.5 - c[2];
    const qy = py * cx - pz * sx, qz = py * sx + pz * cx;
    py = qy;
    pz = qz;
    const rx = px * cz - py * sz, ry = px * sz + py * cz;
    px = rx;
    py = ry;
    // thinner towards the corners (pinched), fat in the middle
    const k = 1 - 0.45 * Math.min(1, (px / half[0]) ** 2 + (py / half[1]) ** 2);
    return dRBox(px, 0, pz / Math.max(0.3, k), 0, 0, 0, half[0], 0.01, half[2], 0.01) * 0 + dEll(px, py, pz / Math.max(0.35, k), 0, 0, 0, half[0] * 1.08, half[1] * 1.08, half[2]) + lump(x, y, z, 0.4, seed) * 0.3;
  }, [c], Math.max(...half) + 3, (x, y, z, d) => col(x - c[0], y - c[1], d), VF.SOFTAO);
}

/** the red futon — 1/48: a peeled-log frame, a deep red tufted mattress and back cushion with piping, three
 *  pillows (plaid, cream cable-knit, rust), a Navajo-style woven throw over the back and seat with fringe. */
export function futon(seed = 7): StaticModel {
  const m = new VoxelModel('futon');
  const HX = 50, D = 44;
  const LOG = 0x9a6a3a;
  // frame: arm posts, arm logs, seat rails, back posts + crest log
  for (const sx of [-1, 1]) {
    const ax = sx * (HX - 2);
    rod(m, [ax, 0, 38], [ax, 26, 38], 2.6, 2.4, (x, y, z) => mul(LOG, 0.9 + h01(x >> 1, y >> 2, z) * 0.15));
    rod(m, [ax, 0, 4], [ax, 42, 3], 2.6, 2.4, (x, y, z) => mul(LOG, 0.9 + h01(x >> 1, y >> 2, z) * 0.15));
    plank(m, [ax, 27, 0], [ax, 27.5, 42], 5.6, 4.4, LOG, seed + sx, { r: 2, lumpy: 0.35, knots: true });
    plank(m, [ax, 7, 4], [ax, 7, 38], 3, 3, 0x7a5232, seed + 3 + sx, { r: 1 });
  }
  plank(m, [-HX, 8, 38], [HX, 8, 38], 3.4, 4, 0x7a5232, seed + 5, { r: 1.2 });
  plank(m, [-HX, 8, 4], [HX, 8, 4], 3.4, 4, 0x7a5232, seed + 6, { r: 1.2 });
  plank(m, [-HX - 1, 43, 2.5], [HX + 1, 43, 2.5], 5, 5, LOG, seed + 7, { r: 2.4, lumpy: 0.4, knots: true });
  // mattress (seat): tufted with buttons, piping round the top edge, sagging where people sit
  const redAt = (x: number, y: number, z: number) => RED[Math.floor(h01(x >> 2, y >> 2, z >> 2) * 1.6)];
  fill(m, (x, y, z) => dRBox(x + 0.5, y + 0.5, z + 0.5, 0, 15.5, 22, HX - 5, 5, 17, 3.6) + Math.exp(-(((x + 0.5 - 14) / 12) ** 2)) * 0.9 * (y > 15 ? 1 : 0) + lump(x, y, z, 0.3, seed) * 0.35, [[-HX + 4, 9, 4], [HX - 4, 22, 40]], 1, (x, y, z, d) => {
    const bt = mod(x + 4, 16) === 0 && mod(z - 6, 12) === 0 && y >= 19;
    if (bt) return 0x5a1410;
    if (d > -1 && Math.abs(y - 18.5) < 0.6) return 0x7a1a16; // piping
    return redAt(x, y, z);
  }, VF.SOFTAO);
  // back cushion leaning against the frame
  const bc = plankF([-HX + 6, 30, 9], [HX - 6, 30, 9], 25, 9, [0, 0.26, 1], 3.6);
  fill(m, (x, y, z) => bc(x, y, z) + lump(x, y, z, 0.3, seed + 2) * 0.4, [[-HX + 4, 16, 2], [HX - 4, 44, 16]], 1, (x, y, z, d) => (d > -1 && mod(x + 4, 16) === 0 && mod(y - 22, 9) === 0 ? 0x5a1410 : redAt(x, y, z)), VF.SOFTAO);
  // the woven throw: over the crest log, down the back cushion, across the seat, over the front edge
  drape(m, -34, -6, [[46, 0], [46.5, 4.5], [41, 7.5], [30, 10], [22, 13.5], [21.2, 20], [21, 33], [20, 40], [14, 42.2], [8, 42.6]], 2, (s, x) => navajo(s, x * 1.4), { fold: 0.9, fringe: 4, seed: 2 });
  // pillows
  pillow(m, [-38, 25, 18], [9, 8, 3.2], -0.35, 0.18, (u, v) => plaid(Math.round(u * 1.6) + 40, Math.round(v * 1.6) + 40), seed + 1);
  pillow(m, [38, 25, 17], [9, 8.5, 3.4], -0.3, -0.22, (u, v) => (mod(Math.round(u), 6) < 2 ? 0xe2d6bc : mod(Math.round(v) + Math.round(u), 4) === 0 ? 0xcfc2a6 : 0xd8ccb0), seed + 2);
  pillow(m, [24, 23.5, 22], [7, 6.5, 2.8], -0.55, -0.4, (u, v) => (Math.hypot(u, v) < 2.2 ? 0x8a3418 : mod(Math.round(u + v), 5) === 0 ? 0x9a4a24 : 0xb0582a), seed + 3);
  return S(m, FV);
}

/** a heavy live-edge slab coffee table — 1/48: a thick wavy slab with bark on the long edges and a crack held by a
 *  bow-tie key, chunky splayed legs, a low shelf with two old books. meta.top (m). */
export function coffeeTable(seed = 8): StaticModel & { meta: { top: number } } {
  const m = new VoxelModel('coffee_table');
  const HX = 29, HZ = 14, T = 21;
  const edgeZ = (x: number, s: number) => HZ + Math.sin(x * 0.19 + s * 2) * 1.4 + Math.sin(x * 0.53 + s) * 0.6;
  fill(m, (x, y, z) => {
    const ez = z + 0.5 > 0 ? edgeZ(x, 1) : edgeZ(x, -1);
    return dRBox(x + 0.5, y + 0.5, z + 0.5, 0, T - 1.6, 0, HX, 2.1, ez, 1.3) + lump(x, y, z, 0.25, seed) * 0.2;
  }, [[-HX - 1, T - 5, -HZ - 3], [HX + 1, T + 1, HZ + 3]], 1, (x, y, z, d) => {
    const ez = z + 0.5 > 0 ? edgeZ(x, 1) : edgeZ(x, -1);
    if (Math.abs(z + 0.5) > ez - 1.3 && d > -1.4) return h01(x >> 1, y, z > 0 ? 1 : 2) > 0.5 ? 0x4a3020 : 0x5c3a24; // bark
    // growth rings sweep along the slab
    const ring = Math.sin((z + Math.sin(x * 0.08) * 6) * 0.9);
    let c = ring > 0.6 ? 0x9a6234 : 0xb07644;
    if (y >= T && Math.abs(z - 3 - Math.sin(x * 0.3) * 0.6) < 0.5 && x > 4 && x < 22) c = 0x2a1a10; // the crack
    if (y >= T && h01(x, z, 19) > 0.985) c = mul(c, 0.75);
    return c;
  });
  // bow-tie key across the crack
  fill(m, (x, y, z) => Math.max(dRBox(x + 0.5, y + 0.5, z + 0.5, 13, T - 0.4, 3, 1.6 + Math.abs(z + 0.5 - 3) * 0.6, 0.6, 3, 0.2), -1), [[10, T - 1, -1], [16, T, 7]], 0.5, () => 0x3a2414);
  for (const [lx, lz] of [[-24, -9], [24, -9], [-24, 9], [24, 9]] as const) rod(m, [lx + Math.sign(lx) * 1.6, 0, lz + Math.sign(lz) * 1.2], [lx, T - 3, lz], 2.9, 2.5, (x, y, z) => mul(0x7a4e2a, 0.92 + h01(x >> 1, y >> 2, z) * 0.14));
  plank(m, [-23, 6, 0], [23, 6, 0], 19, 1.8, 0x8a5a30, seed + 2, { r: 0.6 });
  // two old books on the shelf
  fill(m, (x, y, z) => dRBox(x + 0.5, y + 0.5, z + 0.5, -10, 8.4, 0, 6, 1.1, 4.4, 0.5), [[-17, 7, -5], [-3, 10, 5]], 1, (_x, y, z, d) => (d > -0.6 && Math.abs(z + 0.5) < 4 ? 0xe2d6b8 : 0x3a4a6a));
  fill(m, (x, y, z) => dRBox(x + 0.5, y + 0.5, z + 0.5, -9, 10.6, 1, 5, 1, 3.8, 0.5), [[-15, 9, -4], [-3, 12, 6]], 1, (_x, y, z, d) => (d > -0.6 && Math.abs(z - 1 + 0.5) < 3.4 ? 0xe2d6b8 : 0x6a2a1e));
  return { model: m, voxelSize: FV, meta: { top: T * FV } };
}

/** what's on the coffee table — 1/64: a paperback lying open face-down, folded reading glasses, an enamel mug
 *  (chipped), a plate with two of Mama's cookies, a stub candle in a jar. meta: mug (m, steam), candle (m). */
export function tableClutter(): StaticModel & { meta: { mug: V3; candle: V3 } } {
  const m = new VoxelModel('table_clutter');
  // paperback open face-down, tented
  for (let x = -12; x <= 12; x++)
    for (let z = -8; z <= 8; z++) {
      const a = Math.abs(x + 0.5) / 12;
      const y = Math.round(3.6 * (1 - a) + 0.3);
      m.set(x, y, z, Math.abs(z + 0.5) > 7.5 ? 0xd8ccb0 : x < 0 ? 0x2a5a6a : 0x2a5a6a);
      for (let k = 0; k < y; k++) if (Math.abs(x + 0.5) > 10.5) m.set(x, k, z, 0xe8dcc0);
    }
  for (let z = -8; z <= 8; z++) m.set(0, 4, z, 0x1e4050).set(-1, 4, z, 0x1e4050);
  // reading glasses folded on top
  for (const cx of [-3.5, 3.5]) for (let a = 0; a < 6.28; a += 0.2) m.set(Math.round(cx + Math.cos(a) * 2.6), 5, Math.round(10 + Math.sin(a) * 2), 0x8a6a3a, VF.METAL);
  for (let x = -1; x <= 1; x++) m.set(x, 5, 10, 0x8a6a3a, VF.METAL);
  // enamel mug: blue speckled, chipped rim, handle
  const MX = 20, MZ = -4;
  lathe(m, MX, MZ, 0, 8, (t) => 3.6 - t * 0.2, (x, y, z, outer) => (!outer ? (y > 6 ? 0x3a2414 : 0xe8e4dc) : y === 8 ? (h01(x, y, z) > 0.7 ? 0x2a2a2c : 0xe8e4dc) : h01(x, y, z) > 0.88 ? 0xe8e4dc : h01(x, y, z) < 0.05 ? 0x2a2a2c : 0x3a6a9a), { hollow: true }, VF.METAL);
  for (let a = -1.4; a <= 1.4; a += 0.2) m.set(MX + 4 + Math.round(Math.cos(a) * 1.8), Math.round(4.5 + Math.sin(a) * 2.6), MZ, 0x3a6a9a, VF.METAL);
  // plate + cookies
  lathe(m, -18, -2, 0, 1, (t) => 6 - t * 0.6, (x, y, z, outer) => (outer && y === 1 ? 0x8a9ab0 : 0xe8e2d4), {}, VF.METAL);
  for (const [cx, cz, ty] of [[-19.5, -3, 2], [-16, 0, 3]] as const) {
    fill(m, (x, y, z) => dRBox(x + 0.5, y + 0.5, z + 0.5, cx, ty, cz, 3, 0.6, 3, 0.6) + (Math.hypot(x + 0.5 - cx, z + 0.5 - cz) > 3.2 ? 9 : 0) + lump(x, y, z, 0.9, cx) * 0.4, [[cx - 4, ty - 2, cz - 4], [cx + 4, ty + 2, cz + 4]], 0.5, (x, y, z) => (h01(x, y, z) > 0.8 ? 0x3a2414 : 0xc88a48));
  }
  // stub candle in a jar
  lathe(m, 6, -10, 0, 7, () => 2.8, (x, y, z, outer) => (outer ? (y > 5 ? 0xb8d0c8 : 0xa8c4bc) : y < 4 ? 0xe8dcc0 : null), { hollow: true }, VF.METAL);
  m.set(6, 4, -10, 0x3a2a20).set(6, 5, -10, 0xffd890, VF.GLOW);
  return { model: m, voxelSize: DV, meta: { mug: pivotOf(m, DV, [MX, 8, MZ]), candle: pivotOf(m, DV, [6, 5.5, -10]) } };
}

/** a ladder-back pine chair with a red-and-green plaid blanket thrown over it — 1/48 */
export function plaidChair(seed = 9): StaticModel {
  const m = new VoxelModel('plaid_chair');
  const W = 11, SEAT = 21;
  for (const sx of [-1, 1]) {
    rod(m, [sx * W, 0, 10], [sx * W, SEAT, 10], 1.6, 1.4, (x, y, z) => mul(0x9a6a3a, 0.9 + h01(x, y >> 2, z) * 0.15));
    rod(m, [sx * W, 0, -9], [sx * (W - 0.6), 47, -11.5], 1.7, 1.4, (x, y, z) => mul(0x9a6a3a, 0.9 + h01(x, y >> 2, z) * 0.15));
    egg(m, [sx * (W - 0.6), 48.4, -11.6], [1.7, 1.9, 1.7], 0x8a5a30);
    for (const y of [6, 12]) plank(m, [sx * W, y, -8.5], [sx * W, y, 9.5], 1.2, 1.2, 0x8a5a30, seed + y, { r: 0.5 });
  }
  for (const y of [7, 13]) plank(m, [-W, y, 10], [W, y, 10], 1.2, 1.2, 0x8a5a30, seed + y + 1, { r: 0.5 });
  for (const [i, y] of [[0, 30], [1, 37], [2, 44]] as const) {
    const zz = -10 - (y - 21) * 0.09;
    for (let x = -W + 1; x <= W - 1; x++) for (let k = -1; k <= 1; k++) m.set(x, y + k, Math.round(zz + ((x / W) ** 2) * 1.2), k === 1 ? 0xa87440 : 0x9a6a3a);
    void i;
  }
  // seat: two planks with a rounded front
  fill(m, (x, y, z) => dRBox(x + 0.5, y + 0.5, z + 0.5, 0, SEAT, 0.5, W + 1.2, 1.3, 11, 1.2) + lump(x, y, z, 0.3, seed) * 0.2, [[-W - 3, SEAT - 3, -12], [W + 3, SEAT + 3, 13]], 1, (x, y, z) => (Math.abs(x + 0.5) < 0.6 ? 0x6a4424 : mul(0xa87444, 0.95 + h01(x >> 2, y, z >> 3) * 0.1)));
  // the plaid blanket: folded over the top rail, hanging down the back, a corner spilling onto the seat
  drape(m, -W + 1, W - 1, [[48, -6], [49.5, -10], [48, -13.5], [40, -15], [30, -15.6], [20, -15.2], [12, -14.5]], 2, (s, x) => plaid(s, x * 2), { fold: 0.8, fringe: 3, seed: 5 });
  drape(m, -W + 2, 3, [[47, -9.5], [44, -6.5], [34, -6], [24, -6], [22.6, 0], [22.8, 6], [20, 11.5], [14, 12.5]], 2, (s, x) => plaid(s + 7, x * 2 + 5), { fold: 0.7, fringe: 3, seed: 9 });
  return S(m, FV);
}

/** Mama Frog's big rocking chair — rig 'chair' rocking about the runners' arc centre. 1/48, 1.1 m wide:
 *  curved runners, turned legs, a spindle back with a carved crest, scrolled arms, a fat patchwork cushion and a
 *  crocheted granny-square blanket over the back. meta.seat: cushion top (m, rig frame). */
export function rockingChairRig(seed = 10): RigSpec {
  const m = new VoxelModel('rocking_chair');
  const HW = 24, RA = 58, SEAT = 21, ZB = -17, ZF = 15;
  // runners: arcs of radius RA centred above the floor, sculpted thick with rounded ends
  for (const sx of [-1, 1]) {
    for (let a = -0.42; a <= 0.42; a += 0.004) {
      const y = RA - Math.cos(a) * RA, z = Math.sin(a) * RA;
      for (let t = 0; t <= 2.6; t += 0.5) for (let w = -1.4; w <= 1.4; w += 0.7) m.set(Math.round(sx * (HW - 2) + w), Math.round(y + t), Math.round(z), mul(0x7a4a26, 0.94 + h01(Math.round(z / 6), 0, sx) * 0.1));
    }
  }
  // legs + stretchers
  for (const sx of [-1, 1])
    for (const [lz, top] of [[ZF - 2, SEAT], [ZB + 2, SEAT]] as const) {
      const yb = RA - Math.cos(Math.asin(lz / RA)) * RA + 2.5;
      rod(m, [sx * (HW - 2), yb, lz], [sx * (HW - 3), top, lz], 1.9, 1.7, (x, y, z) => mul(0x8a5a30, 0.92 + h01(x, y >> 2, z) * 0.12));
    }
  for (const sx of [-1, 1]) plank(m, [sx * (HW - 2.5), 10, ZB + 2], [sx * (HW - 2.5), 10, ZF - 2], 1.4, 1.4, 0x7a4a26, seed + sx, { r: 0.6 });
  // seat frame
  fill(m, (x, y, z) => dRBox(x + 0.5, y + 0.5, z + 0.5, 0, SEAT, (ZB + ZF) / 2, HW - 1.5, 1.5, (ZF - ZB) / 2 + 1, 1.2), [[-HW, SEAT - 3, ZB - 2], [HW, SEAT + 3, ZF + 3]], 1, (x, y, z) => mul(0xa06a38, 0.95 + h01(x >> 2, y, z >> 2) * 0.1));
  // back: two posts raking back, a carved crest, spindles
  const BT = 60, BZ = ZB - 7;
  for (const sx of [-1, 1]) {
    rod(m, [sx * (HW - 3), SEAT, ZB], [sx * (HW - 4), BT, BZ], 2, 1.6, (x, y, z) => mul(0x8a5a30, 0.92 + h01(x, y >> 2, z) * 0.12));
    egg(m, [sx * (HW - 4), BT + 1.6, BZ - 0.3], [2, 2.2, 2], 0x6e4424);
  }
  for (let x = -HW + 4; x <= HW - 4; x++) {
    const arch = Math.cos((x / HW) * 1.3) * 5;
    for (let y = BT - 6; y <= BT - 1 + arch; y++) for (let k = 0; k < 2; k++) m.set(x, y, Math.round(BZ + 0.6 + k + (x / HW) ** 2 * 1.5), y > BT - 1 + arch - 1 ? 0xb07a44 : 0x9a6234);
  }
  for (let i = 0; i < 7; i++) {
    const x = -HW + 7 + i * ((2 * HW - 14) / 6);
    rod(m, [x, SEAT + 1, ZB + 0.5 - 1.5], [x, BT - 5, BZ + 1 + (x / HW) ** 2 * 1.5], 0.9, 0.9, 0x8a5a30);
  }
  // scrolled arms on front posts
  for (const sx of [-1, 1]) {
    rod(m, [sx * (HW - 2), SEAT, ZF - 3], [sx * (HW - 2), SEAT + 14, ZF - 2], 1.6, 1.5, 0x8a5a30);
    plank(m, [sx * (HW - 1.5), SEAT + 15, ZF + 1], [sx * (HW - 3), SEAT + 17.5, ZB - 5], 4.4, 2.2, 0x9a6234, seed + 4 + sx, { r: 1 });
    egg(m, [sx * (HW - 1.5), SEAT + 14.5, ZF + 1.5], [2.6, 2.6, 2.4], 0x8a5a30);
  }
  // patchwork cushion (fat, sagging in the middle)
  fill(m, (x, y, z) => dRBox(x + 0.5, y + 0.5, z + 0.5, 0, SEAT + 4, (ZB + ZF) / 2 + 1, HW - 3.5, 3.2, (ZF - ZB) / 2 - 0.5, 2.8) - Math.exp(-((x + 0.5) ** 2 + (z + 0.5) ** 2) / 120) * 0.8 + lump(x, y, z, 0.35, seed) * 0.3, [[-HW, SEAT, ZB - 1], [HW, SEAT + 9, ZF + 3]], 1, (x, y, z, d) => {
    const pc = [0xb84a3a, 0xd8b058, 0x4a6a8a, 0xe2d6bc, 0x6a8a4a, 0xc87a8a];
    const id = Math.floor((x + 40) / 8) * 3 + Math.floor((z + 40) / 8);
    if (d > -1 && (mod(x + 40, 8) === 0 || mod(z + 40, 8) === 0)) return 0xe8dcc0; // stitched seams
    return pc[Math.floor(h01(id, 1, seed) * pc.length)];
  }, VF.SOFTAO);
  // crocheted granny squares over the back, hanging behind
  const gsq = (s: number, x: number) => {
    const u = mod(x + 40, 9) - 4, v = mod(s, 9) - 4;
    const ring = Math.max(Math.abs(u), Math.abs(v));
    const sq = Math.floor((x + 40) / 9) * 5 + Math.floor(s / 9);
    const pals = [[0xe8b040, 0xb83a5a, 0x3a7a8a], [0x8ab04a, 0xe8dcc0, 0xc04a2a], [0xa85ac0, 0xe8c070, 0x4a8a5a], [0xe86a4a, 0x4a6aa8, 0xf0e2c0]];
    const p = pals[Math.floor(h01(sq, 2, 3) * pals.length)];
    if (ring >= 4) return 0x2a2420;
    return (u + v) % 2 === 0 && ring > 0 ? mul(p[Math.min(2, ring >> 1)], 0.9) : p[Math.min(2, ring >> 1)];
  };
  drape(m, -HW + 6, HW - 6, [[BT + 1, BZ + 3], [BT + 2.5, BZ - 0.5], [BT - 2, BZ - 3], [BT - 14, BZ - 3.8], [BT - 26, BZ - 3], [BT - 32, BZ - 2]], 2, gsq, { fold: 0.7, seed: 4 });
  const pivot: V3 = [0, RA, 0];
  return {
    name: 'rocking_chair_rig',
    voxelSize: FV,
    parts: [{ name: 'chair', model: m, pivot, attach: pivot }],
    meta: { seat: [0, (SEAT + 7) * FV, ((ZB + ZF) / 2 + 1) * FV], pivot: [0, RA * FV, 0] },
  };
}

/** a braided oval rag rug — 1/48, 2.3 × 1.5 m, coils of rust, cream, indigo and mustard with braid chevrons */
export function braidedRug(seed = 11): StaticModel {
  const m = new VoxelModel('braided_rug');
  const RX = 55, RZ = 36;
  const COIL = [0x8a3a22, 0xd8c8a4, 0x3a4a6a, 0xc89a40, 0x6a2a1e, 0xb8a888, 0x4a5a3a, 0xa8482a];
  for (let x = -RX - 1; x <= RX + 1; x++)
    for (let z = -RZ - 1; z <= RZ + 1; z++) {
      const px = x + 0.5, pz = z + 0.5;
      const e = Math.hypot(px / RX, pz / RZ);
      if (e > 1) continue;
      const rr = e * 26; // coil index
      const coil = Math.floor(rr);
      const ang = Math.atan2(pz / RZ, px / RX);
      const chev = mod(Math.floor(ang * (8 + coil * 3.1) + (coil % 2) * 0.5 + (rr - coil) * 2), 2);
      let c = COIL[Math.floor(h01(coil, 3, seed) * COIL.length)];
      if (chev) c = mul(c, 0.86);
      if (rr - coil < 0.16) c = mul(c, 0.7);
      if (h01(x, z, 7) > 0.995) c = 0x5a4a3a;
      m.set(x, 0, z, c, VF.SOFTAO);
      if (rr - coil > 0.35 && rr - coil < 0.75 && e < 0.985) m.set(x, 1, z, mul(c, 1.05), VF.SOFTAO);
    }
  return S(m, FV);
}

/** a small rustic cabinet (the gramophone stands on it) — 1/48: plank door with a wooden turn latch, a drawer,
 *  an overhanging top, little bun feet. meta.top (m). */
export function sideCabinet(seed = 12): StaticModel & { meta: { top: number } } {
  const m = new VoxelModel('side_cabinet');
  const HX = 13, HZ = 9, T = 27;
  fill(m, (x, y, z) => dRBox(x + 0.5, y + 0.5, z + 0.5, 0, T / 2 + 1.5, 0, HX, T / 2 - 1, HZ, 1) + lump(x, y, z, 0.3, seed) * 0.2, [[-HX - 1, 2, -HZ - 1], [HX + 1, T + 1, HZ + 1]], 1, (x, y, z, d) => (d > -1 && mod(x + 40, 7) === 0 ? 0x4a2e18 : mul(0x7a4e2a, 0.94 + h01(x >> 3, y >> 3, z) * 0.1)));
  plank(m, [-HX - 1.5, T + 1, 0.5], [HX + 1.5, T + 1, 0.5], 2 * HZ + 3.5, 2, 0x9a6234, seed + 1, { r: 0.8 });
  fill(m, (x, y, z) => dRBox(x + 0.5, y + 0.5, z + 0.5, 0, 11, HZ + 0.6, HX - 2, 7.5, 0.8, 0.5), [[-HX, 3, HZ - 1], [HX, 19, HZ + 2]], 1, (x) => (mod(x + 40, 5) === 0 ? 0x5a3820 : 0x8a5a30));
  fill(m, (x, y, z) => dRBox(x + 0.5, y + 0.5, z + 0.5, 0, 23, HZ + 0.6, HX - 2, 2.6, 0.8, 0.5), [[-HX, 20, HZ - 1], [HX, 26, HZ + 2]], 1, () => 0x8a5a30);
  egg(m, [0, 23, HZ + 1.8], [1.4, 1.2, 1], BRASS_HI, VF.METAL);
  plank(m, [HX - 5, 11, HZ + 1.8], [HX - 5, 15, HZ + 1.8], 1.5, 1, 0x5a3418, seed + 2, { r: 0.4 });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) egg(m, [sx * (HX - 2), 1.3, sz * (HZ - 2)], [2, 1.6, 2], 0x4a2e18);
  return { model: m, voxelSize: FV, meta: { top: (T + 2) * FV } };
}

/** Mama Frog's knitting basket — 1/64: a woven willow basket, yarn balls (wound strands), crossed needles, a
 *  half-knitted scarf hanging over the rim */
export function knittingBasket(): StaticModel {
  const m = new VoxelModel('knitting_basket');
  lathe(m, 0, 0, 0, 13, (t) => 10 + t * 2.5 - (t > 0.92 ? 0.6 : 0), (x, y, z, outer, ang) => {
    if (!outer) return y === 0 ? 0x6a4a28 : null;
    const w = mod(Math.round(ang * 10) + (y % 2) * 1, 2);
    return y >= 12 ? 0x7a5a32 : w ? 0xa8804a : 0x8a6a3a;
  }, { hollow: true });
  const balls: [V3, number, number][] = [[[-4, 13, 2], 5, 0xc84a5a], [[5, 12, -3], 4.5, 0xe8c050], [[1, 14.5, -6], 4, 0x5a8ab0]];
  for (const [c, r, col] of balls)
    egg(m, c, [r, r, r], (x, y, z) => {
      const a = Math.atan2(y + 0.5 - c[1], x + 0.5 - c[0]) * 3 + (z + 0.5 - c[2]) * 0.9;
      return mod(Math.round(a), 2) ? col : mul(col, 0.82);
    }, VF.SOFTAO);
  rod(m, [-9, 12, -5], [6, 27, 4], 0.6, 0.55, 0xd8c8a0);
  rod(m, [-6, 12, 6], [8, 25, -5], 0.6, 0.55, 0xd8c8a0);
  egg(m, [6.3, 27.3, 4.2], [1, 1, 1], 0xb83a3a);
  egg(m, [8.3, 25.3, -5.2], [1, 1, 1], 0xb83a3a);
  // scarf: knit stitches, hanging over the front rim
  for (let x = -6; x <= 3; x++)
    for (let k = 0; k < 16; k++) {
      const y = k < 3 ? 13 + k * 0.3 : 13.9 - (k - 3);
      const z = k < 3 ? 6 + k * 2 : 12.6 + (k > 8 ? 0.6 : 0);
      m.set(x, Math.round(y), Math.round(z), mod(x + k, 2) ? 0xc84a5a : mod(Math.floor(k / 4), 2) ? 0xe8dcc0 : 0xb83a4a, VF.SOFTAO);
    }
  return S(m, DV);
}

// =====================================================================
// ON THE WALLS
// =====================================================================
/** an acoustic guitar hung by its headstock on a forged hook — 1/64, vertical (headstock up, top faces +Z):
 *  spruce top with a rosette and tortoiseshell guard, mahogany sides with binding, rosewood board with frets and
 *  dots, six strings, a slotted headstock with tuners, a woven strap looping down. */
export function guitar(): StaticModel {
  const m = new VoxelModel('guitar');
  const out2 = (x: number, y: number) => smin(Math.hypot(x / 12.2, (y - 12) / 12.6) - 1, Math.hypot(x / 9.6, (y - 28) / 9.4) - 1, 0.32);
  const HZ = 3.2;
  fill(m, (x, y, z) => {
    const d2 = out2(x + 0.5, y + 0.5) * 10;
    const dz = Math.abs(z + 0.5) - HZ;
    return Math.hypot(Math.max(d2, 0), Math.max(dz, 0)) + Math.min(Math.max(d2, dz), 0) - 0.4;
  }, [[-13, 0, -4], [13, 38, 4]], 1, (x, y, z, d) => {
    const px = x + 0.5, py = y + 0.5;
    const front = z >= 3;
    if (!front) return d > -1 && z === -4 ? 0x5a2412 : z >= 2 && d > -1.2 ? 0xe8dcc0 : 0x7a3a1e; // back / binding / sides
    const r = Math.hypot(px, py - 25);
    if (r < 3.7) return 0x120c08; // sound hole
    if (r < 4.4) return 0x3a2414;
    if (r < 5.2) return mod(Math.round(Math.atan2(py - 25, px) * 8), 2) ? 0xd8b070 : 0x5a3a1e; // rosette
    if (Math.hypot(px - 4.5, (py - 20) * 0.8) < 3.4 && py < 23) return h01(x >> 1, y >> 1, 2) > 0.5 ? 0x5a2a12 : 0x7a3a18; // tortoiseshell guard
    if (Math.abs(py - 10) < 1.4 && Math.abs(px) < 5.5) return 0x2a1810; // bridge
    return mod(x + 40, 3) === 0 ? 0xc89458 : 0xd8a868; // spruce grain
  });
  for (const bx of [-3, -1, 1, 3, -2, 2]) m.set(bx, 10, 4, 0xe8dcc0); // bridge pins
  // neck + fretboard + frets + dots
  fill(m, (x, y, z) => dRBox(x + 0.5, y + 0.5, z + 0.5, 0, 47, 0.6, 2.2 - (y - 36) * 0.02, 11, 2, 0.9), [[-3, 35, -2], [3, 59, 4]], 1, (_x, _y, z) => (z >= 2 ? 0x2a1810 : 0x7a3a1e));
  let fy = 37;
  for (let k = 1; k <= 12; k++) {
    fy += 2.1 - k * 0.07;
    for (let x = -2; x <= 1; x++) m.set(x, Math.round(fy), 3, 0xb8b8b0, VF.METAL);
    if ([3, 5, 7, 9].includes(k)) m.set(0, Math.round(fy) - 1, 3, 0xe8dcc0);
  }
  // headstock (slightly raked back), nut, tuners
  fill(m, (x, y, z) => dRBox(x + 0.5, y + 0.5, z + 0.5, 0, 63, 0.4 - (y - 58) * 0.12, 3, 5, 1.2, 1), [[-4, 57, -2], [4, 69, 3]], 1, (x, y) => (y > 66 ? 0x5a2412 : 0x3a1e10));
  for (let x = -2; x <= 1; x++) m.set(x, 58, 3, 0xe8dcc0);
  for (const ty of [60, 63, 66]) for (const sx of [-1, 1]) {
    rod(m, [sx * 3, ty, 0], [sx * 5.5, ty, 0], 0.6, 0.6, 0xc8c8c0, VF.METAL);
    egg(m, [sx * 6, ty, 0], [0.9, 1.3, 0.6], 0xe8e0c8, VF.METAL);
  }
  // strings: bridge → nut
  for (let s = 0; s < 6; s++) {
    const xa = -2.5 + s, xb = -1.25 + s * 0.5;
    for (let y = 11; y <= 58; y++) m.set(Math.round(xa + ((xb - xa) * (y - 11)) / 47 - 0.5), y, 4, s < 3 ? 0xb89060 : 0xd8d8d0, VF.METAL);
  }
  // the forged wall hook the headstock hangs from, and a woven strap looping down the side
  rod(m, [0, 70, -4], [0, 70, 2], 0.8, 0.8, 0x2e2c2a, VF.METAL);
  rod(m, [0, 70, 2], [0, 72, 3], 0.8, 0.7, 0x2e2c2a, VF.METAL);
  const strap = spline([[0, 0.5, -1], [-9, 4, -3], [-14, 20, -3.4], [-12, 32, -3], [-3, 37, -2]], 6);
  for (const p of strap) for (const w of [-0.5, 0.5]) m.set(Math.round(p[0] + w), Math.round(p[1]), Math.round(p[2]), mod(Math.round(p[1]), 4) < 2 ? 0xa8402a : 0xd8b058, VF.SOFTAO);
  return S(m, DV);
}

/** a carved gilt frame holding a sculpted shadow-box landscape (not a flat picture): a sunset sky in layered
 *  bands, a low sun with a halo, far violet mesas, near red sandstone buttes with strata, dunes with a saguaro.
 *  1/64, 0.94 × 0.66 m, faces +Z, hangs flush (back at z = 0). */
export function landscapeFrame(): StaticModel {
  const m = new VoxelModel('landscape_frame');
  const HX = 30, HY = 21, B = 4.5; // half sizes, frame band
  // the relief inside (z 0..4, deeper = further back)
  for (let x = -HX + 3; x < HX - 3; x++)
    for (let y = -HY + 3; y < HY - 3; y++) {
      const v = (y + HY - 3) / (2 * HY - 6); // 0 bottom .. 1 top
      // sky: gradient bands (painterly steps), clouds as raised streaks
      let c = v > 0.82 ? 0x3a4a8a : v > 0.7 ? 0x5a5a9a : v > 0.6 ? 0x9a6a9a : v > 0.5 ? 0xd88a7a : v > 0.42 ? 0xf0a868 : 0xf8c880;
      let z = 0;
      const sun = Math.hypot(x - 9, (y - (-HY + 3 + 0.36 * (2 * HY - 6))) * 1.1);
      if (sun < 4.2) { c = sun < 3.2 ? 0xfff2c8 : 0xffd890; z = 0; }
      else if (sun < 6.5) c = mixRGB(c, 0xffe0a0, 0.35);
      const cl = Math.sin(x * 0.18 + y * 0.9) + Math.sin(x * 0.07 - 1.3);
      if (v > 0.55 && v < 0.9 && cl > 1.35) { c = v > 0.72 ? 0xb87a9a : 0xf0b088; z = 1; }
      // far mesas
      const far = -HY + 3 + 0.36 * (2 * HY - 6) + (Math.abs(x + 10) < 9 ? 5 - Math.max(0, Math.abs(x + 10) - 7) * 2 : 0) + (Math.abs(x - 19) < 5 ? 3 : 0) + Math.sin(x * 0.4) * 0.6;
      if (y < far) { c = y > far - 1.2 ? 0x8a6a9a : 0x6a5a8a; z = 1; }
      // red buttes with strata
      const bx = x + 18;
      const butte = -HY + 3 + 0.22 * (2 * HY - 6) + (Math.abs(bx) < 7 ? 9 - Math.max(0, Math.abs(bx) - 5) * 3 : 0) + (Math.abs(x - 2) < 4 ? 4 : 0);
      if (y < butte) { c = mod(y, 3) === 0 ? 0x8a3a22 : x > -18 + (y * 0.3) ? 0xb8562e : 0xd0703a; z = 2 + (Math.abs(bx) < 5 ? 1 : 0); }
      // dunes in the foreground
      const dune = -HY + 3 + 5 + Math.sin(x * 0.16) * 2.4 + Math.sin(x * 0.41 + 2) * 0.8;
      if (y < dune) { c = (y + Math.round(x * 0.3)) % 4 === 0 ? 0xc89050 : y > dune - 1.2 ? 0xf0c080 : 0xe0a868; z = 4; }
      for (let k = -1; k <= z; k++) m.set(x, y, k, k === z ? c : 0x2a1a10, k === z && sun < 3.2 ? VF.EMISSIVE : 0);
    }
  // a saguaro on the near dune (sculpted, proud of the surface)
  rod(m, [-6, -HY + 6, 5], [-6, -HY + 17, 5], 1.3, 1.1, 0x4a6a3a);
  tubeP(m, [[-6, -HY + 10, 5], [-9, -HY + 10.5, 5], [-9, -HY + 14, 5]], [0.8], 0x4a6a3a);
  tubeP(m, [[-6, -HY + 12, 5], [-3.5, -HY + 12.5, 5], [-3.5, -HY + 15, 5]], [0.8], 0x557a42);
  // the carved gilt frame: lip, cove, bead; gilding worn to red bole on the high points
  for (let x = -HX; x < HX; x++)
    for (let y = -HY; y < HY; y++) {
      const e = Math.min(x + HX, HX - 1 - x, y + HY, HY - 1 - y);
      if (e >= B - 1 + 1.5) continue;
      const prof = e < 1.2 ? 5 : e < 2.2 ? 6 : e < 3.2 ? 5 : 6;
      for (let z = -1; z <= prof; z++) {
        const top = z === prof;
        let c = top ? (h01(x, y, 3) > 0.86 ? 0x9a4a2a : prof === 6 ? 0xe8c070 : 0xc89848) : 0x7a5a2a;
        if (top && prof === 6 && mod(x + y, 4) === 0 && e > 2.2) c = 0xa87a30; // carved bead
        m.set(x, y, z, c, VF.METAL);
      }
    }
  return S(m, DV);
}

/** an oval walnut photo frame with a beaded gilt inner edge and a foxed cream mat; the photograph itself is a
 *  real IconFactory capture placed by the scene behind the mat. 1/64. meta.photo: centre (m), size (m). */
export function photoFrame(seed = 13): StaticModel & { meta: { photo: V3; size: [number, number] } } {
  const m = new VoxelModel('photo_frame');
  const RX = 10, RY = 13;
  for (let x = -RX - 4; x <= RX + 3; x++)
    for (let y = -RY - 4; y <= RY + 3; y++) {
      const px = x + 0.5, py = y + 0.5;
      const e = Math.hypot(px / RX, py / RY);
      const outerR = Math.hypot(px / (RX + 3.6), py / (RY + 3.6));
      if (outerR > 1) continue;
      m.set(x, y, -1, 0x2a1a10); // backing board
      if (e < 0.92) continue; // the opening (photo goes here, at z = 0)
      if (e < 1.08) {
        m.set(x, y, 1, h01(x, y, seed) > 0.9 ? 0xc8b896 : 0xe2d6b8, VF.SOFTAO); // mat
        continue;
      }
      const band = (outerR - 0.72) / 0.28; // 0 inner .. 1 outer
      const h = band < 0.2 ? 3 : band < 0.55 ? 2 + Math.round(Math.sin(band * 9) * 0.6 + 0.6) : 2;
      for (let z = 0; z <= h; z++) m.set(x, y, z, z === h ? (band < 0.2 ? (mod(Math.round(Math.atan2(py, px) * 14), 2) ? 0xd8b060 : 0xa87a30) : h01(x, y, 2) > 0.8 ? 0x6a4428 : 0x5a3820) : 0x3a2414, band < 0.2 && z === h ? VF.METAL : 0);
    }
  rod(m, [-3, RY + 4, -1], [0, RY + 7, -1], 0.4, 0.4, 0x8a6a3a, VF.METAL); // hanging wire
  rod(m, [3, RY + 4, -1], [0, RY + 7, -1], 0.4, 0.4, 0x8a6a3a, VF.METAL);
  return { model: m, voxelSize: DV, meta: { photo: pivotOf(m, DV, [0, 0, 0.2]), size: [2 * RX * 0.92 * DV, 2 * RY * 0.92 * DV] } };
}

/** a tall cheval mirror — 1/48: turned uprights with finials on scrolled splayed feet, a stretcher, an oval
 *  carved walnut frame pivoted between them and tilted back a little. The glass is a live reflection placed by the
 *  scene. meta: glass (centre, m), radii (m), tilt (rad, top leans back towards -Z). */
export function chevalMirror(seed = 14): StaticModel & { meta: { glass: V3; radii: [number, number]; tilt: number } } {
  const m = new VoxelModel('cheval_mirror');
  const UX = 17, PY = 50, RX = 13.5, RY = 26.5, tilt = 0.09;
  for (const sx of [-1, 1]) {
    // scrolled foot along Z
    plank(m, [sx * UX, 2.4, -12], [sx * UX, 2.4, 12], 3.6, 4.4, WALNUT, seed + sx, { up: [0, 1, 0], r: 1.4, lumpy: 0.2 });
    for (const sz of [-1, 1]) egg(m, [sx * UX, 2.6, sz * 12.5], [2, 2.8, 2.6], 0x4a2c16);
    lathe(m, sx * UX, 0, 4, 80, (t) => {
      const bead = (c: number, w: number) => Math.max(0, 1 - Math.abs(t - c) / w);
      return 1.6 + 1.2 * bead(0.03, 0.05) + 0.7 * bead(0.25, 0.03) + 0.7 * bead(0.6, 0.025) + 0.5 * bead(0.98, 0.04);
    }, () => WALNUT, {});
    egg(m, [sx * UX, 82.5, 0], [1.9, 2.8, 1.9], (_x, y) => (y > 83 ? BRASS_HI : 0x4a2c16), 0);
    rod(m, [sx * UX, PY, 0], [sx * (RX + 1.5), PY, 0], 1.1, 1.1, BRASS, VF.METAL); // pivot pins
  }
  plank(m, [-UX, 13, 0], [UX, 13, 0], 2.4, 2.4, WALNUT, seed + 5, { r: 0.9 });
  // the oval frame, tilted about X at the pivot
  const c = Math.cos(tilt), s = Math.sin(tilt);
  fill(m, (x, y, z) => {
    const py = y + 0.5 - PY, pz = z + 0.5;
    const ly = py * c + pz * s, lz = -py * s + pz * c; // into the frame's local space
    const e = Math.hypot((x + 0.5) / (RX + 2.6), ly / (RY + 2.6));
    const ei = Math.hypot((x + 0.5) / RX, ly / RY);
    const ring = Math.max(e - 1, 1 - ei) * 12;
    return Math.max(ring, Math.abs(lz) - 1.6) - (ei > 1.05 && ei < 1.12 ? 0.6 : 0);
  }, [[-RX - 4, PY - RY - 5, -6], [RX + 4, PY + RY + 5, 6]], 1, (x, y, z) => {
    const py = y + 0.5 - PY, pz = z + 0.5;
    const ly = py * c + pz * s;
    const ei = Math.hypot((x + 0.5) / RX, ly / RY);
    if (ei < 1.09) return mod(Math.round(Math.atan2(ly, x + 0.5) * 20), 2) ? 0xd8b060 : 0xa87a30; // gilt bead
    return h01(x >> 1, y >> 2, z) > 0.85 ? 0x6a4428 : WALNUT;
  });
  // backing board behind the glass
  fill(m, (x, y, z) => {
    const py = y + 0.5 - PY, pz = z + 0.5;
    const ly = py * c + pz * s, lz = -py * s + pz * c;
    return Math.max(Math.hypot((x + 0.5) / (RX + 0.5), ly / (RY + 0.5)) - 1, Math.abs(lz + 1.4) - 0.5);
  }, [[-RX - 1, PY - RY - 2, -4], [RX + 1, PY + RY + 2, 2]], 1, () => 0x2a1a10);
  const g = pivotOf(m, FV, [0, PY, 0.25]);
  return { model: m, voxelSize: FV, meta: { glass: g, radii: [RX * FV, RY * FV], tilt } };
}

/** the cabin's front door: six knotty planks, a Z brace and rails, long strap hinges, a thumb latch and a pull —
 *  rig 'door' hinged on its x = 0 edge, extending along +X, room face +Z. 1/48, 1.08 × 2.29 m */
export function zDoorRig(seed = 15): RigSpec {
  const m = new VoxelModel('z_door');
  const W = 52, H = 110;
  for (let i = 0; i < 6; i++) {
    const x0 = i * 8.67 + 0.4, x1 = x0 + 8.1;
    const tone = mul(0xa8703c, 0.88 + h01(i, seed, 1) * 0.22);
    fill(m, (x, y, z) => dRBox(x + 0.5, y + 0.5, z + 0.5, (x0 + x1) / 2, H / 2, 0, (x1 - x0) / 2, H / 2, 1.2, 0.5) + lump(x, y, z, 0.25, i) * 0.15, [[x0, 0, -2], [x1, H, 2]], 1, (x, y, z, d) => {
      let col = tone;
      if (h01(x, Math.floor(y / 11), seed + i) > 0.82) col = mul(col, 0.88);
      if (Math.hypot(x - x0 - 4, (y - 20 - i * 15) * 0.6) < 1.2 && i !== 3) col = 0x4a2410;
      if (d > -0.7) col = mul(col, 0.9);
      return col;
    });
  }
  const BR = 0x8a5a30;
  plank(m, [1, 14, 2.2], [W - 1, 14, 2.2], 8, 2.4, BR, seed + 1, { up: [0, 0, 1], r: 0.8 });
  plank(m, [1, H - 14, 2.2], [W - 1, H - 14, 2.2], 8, 2.4, BR, seed + 2, { up: [0, 0, 1], r: 0.8 });
  plank(m, [5, 18, 2.2], [W - 5, H - 18, 2.2], 7, 2.2, BR, seed + 3, { up: [0, 0, 1], r: 0.8 });
  for (const hy of [14, H - 14]) {
    fill(m, (x, y, z) => dCap(x + 0.5, y + 0.5, z + 0.5, [1, hy, 4], [32, hy, 4], 1.8, 0.8), [[-1, hy - 3, 2], [34, hy + 3, 6]], 1, (x) => (mod(x, 8) === 3 ? 0x6a6660 : 0x2e2c2a), VF.METAL);
    rod(m, [0, hy - 3, 1], [0, hy + 3, 1], 1.5, 1.5, 0x3a3836, VF.METAL);
  }
  // thumb latch + wooden pull (room side)
  fill(m, (x, y, z) => dRBox(x + 0.5, y + 0.5, z + 0.5, W - 6, 52, 2.2, 1.6, 4, 0.5, 0.4), [[W - 9, 47, 1], [W - 3, 57, 4]], 1, () => 0x2e2c2a, VF.METAL);
  rod(m, [W - 6, 55, 3], [W - 13, 55, 3.4], 0.6, 0.6, 0x4a4642, VF.METAL);
  plank(m, [W - 6, 40, 3.6], [W - 6, 50, 3.6], 1.8, 1.8, 0x6a4424, seed + 9, { up: [0, 0, 1], r: 0.8 });
  return { name: 'z_door', voxelSize: FV, parts: [{ name: 'door', model: m, pivot: [0, 0, 0], attach: [0, 0, 0] }], meta: { width: W * FV, height: H * FV } };
}

/** a schoolhouse wall clock — rig: 'case' (pivot at the dial centre) → 'hand_h', 'hand_m' (spin about Z) and
 *  'pendulum' (pivot at its suspension, swings about Z). 1/64, ≈0.36 × 0.66 m, faces +Z, back at z = 0. */
export function clockRig(seed = 16): RigSpec {
  const cs = new VoxelModel('clock_case');
  const DY = 26, R = 9.5; // dial centre height (voxels above the bottom), dial radius
  // head: a rounded octagon of walnut around the dial, drop box below
  fill(cs, (x, y, z) => {
    const px = x + 0.5, py = y + 0.5 - DY;
    const oct = Math.max(Math.abs(px), Math.abs(py), (Math.abs(px) + Math.abs(py)) * 0.72) - (R + 3.4);
    const drop = dRBox(px, y + 0.5, z + 0.5, 0, 9.5, 2.2, 7, 9.5, 2.2, 1.2);
    return Math.max(Math.min(oct, drop), Math.abs(z + 0.5 - 2.2) - 2.2);
  }, [[-14, 0, 0], [14, DY + 14, 5]], 1, (x, y, z, d) => (d > -1 && z >= 4 ? 0x7a4a26 : h01(x >> 1, y >> 2, seed) > 0.8 ? 0x5a3418 : 0x6a3e1e));
  // brass bezel + cream dial with hour ticks
  for (let x = -R - 2; x <= R + 2; x++)
    for (let y = -R - 2; y <= R + 2; y++) {
      const r = Math.hypot(x + 0.5, y + 0.5);
      if (r > R + 1.6) continue;
      const a = Math.atan2(y + 0.5, x + 0.5);
      const tick = r > R - 2.4 && r < R - 0.6 && Math.abs(mod(a * (6 / Math.PI) + 0.5, 1) - 0.5) < (r > R - 1.6 ? 0.16 : 0.08);
      if (r > R) cs.set(x, DY + y, 5, mod(Math.round(a * 12), 2) ? BRASS_HI : BRASS, VF.METAL);
      else cs.set(x, DY + y, 5, tick ? 0x1e1a16 : h01(x, y, 4) > 0.95 ? 0xd8ccb0 : 0xf0e6cc);
    }
  // drop-box window with a little gilt "REGULATOR" band (glass shows the pendulum)
  for (let x = -5; x <= 4; x++) for (let y = 3; y <= 15; y++) cs.del(x, y, 4), cs.del(x, y, 3);
  for (let x = -5; x <= 4; x++) for (let y = 3; y <= 15; y++) cs.set(x, y, 1, 0x2a1810);
  // hands (forged spade hands) — separate parts so they turn
  const hh = new VoxelModel('clock_hand_h');
  for (let y = 0; y <= 5; y++) hh.set(0, DY + y, 6, 0x1e1a16, VF.METAL);
  for (const [dx, dy] of [[-1, 4], [1, 4], [0, 6]]) hh.set(dx, DY + dy, 6, 0x1e1a16, VF.METAL);
  const hm = new VoxelModel('clock_hand_m');
  for (let y = 0; y <= 8; y++) hm.set(0, DY + y, 7, 0x1e1a16, VF.METAL);
  hm.set(0, DY - 1, 7, 0x1e1a16, VF.METAL).set(0, DY - 2, 7, 0x1e1a16, VF.METAL);
  hm.set(0, DY, 8, BRASS_HI, VF.METAL);
  // pendulum: rod + brass bob
  const pd = new VoxelModel('clock_pendulum');
  for (let y = 7; y <= 15; y++) pd.set(0, y, 2, 0x8a6a3a, VF.METAL);
  egg(pd, [0.5, 6, 2.5], [2.8, 2.8, 0.9], (x, y) => (h01(x, y, 1) > 0.7 ? BRASS_HI : BRASS), VF.METAL);
  const piv: V3 = [0.5, DY + 0.5, 6];
  const ppiv: V3 = [0.5, 15.5, 2.5];
  return {
    name: 'wall_clock',
    voxelSize: DV,
    parts: [
      { name: 'case', model: cs, pivot: piv, attach: piv },
      { name: 'hand_h', model: hh, pivot: [0.5, DY + 0.5, 6.5], attach: [0.5, DY + 0.5, 6.5], parent: 'case' },
      { name: 'hand_m', model: hm, pivot: [0.5, DY + 0.5, 7.5], attach: [0.5, DY + 0.5, 7.5], parent: 'case' },
      { name: 'pendulum', model: pd, pivot: ppiv, attach: ppiv, parent: 'case' },
    ],
    meta: { height: (DY + 14) * DV },
  };
}

/** the fireplace crane — rig 'arm' (swings about Y on its pintle; the arm reaches along +X) → 'kettle' (hangs
 *  from the S-hook at the arm's tip, swings). 1/48. A forged arm with a diagonal brace and a scroll, a cast-iron
 *  kettle with a spout, a bail handle and a lid knob, sooty from the fire. */
export function craneRig(seed = 17): RigSpec {
  const arm = new VoxelModel('crane_arm');
  const IRON = 0x2a2826, IRON_HI = 0x4a4642;
  rod(arm, [0, 0, 0], [0, 24, 0], 1, 1, IRON, VF.METAL);
  for (const y of [2, 21]) egg(arm, [-1.2, y, 0], [1.6, 1.8, 1.6], IRON_HI, VF.METAL); // pintle eyes
  rod(arm, [0, 23, 0], [21, 23, 0], 0.9, 0.8, (x) => (mod(x, 6) === 0 ? IRON_HI : IRON), VF.METAL);
  rod(arm, [0, 6, 0], [16, 22.5, 0], 0.7, 0.7, IRON, VF.METAL);
  tubeP(arm, spline([[21, 23, 0], [23, 24.5, 0], [24, 22.5, 0], [22.6, 21.6, 0]], 4), [0.6], IRON, VF.METAL);
  for (let a = 0; a < 6.28 * 1.5; a += 0.25) arm.set(Math.round(6 + Math.cos(a) * (2.2 - a * 0.15)), Math.round(14 + Math.sin(a) * (2.2 - a * 0.15)), 0, IRON_HI, VF.METAL); // a curl in the brace
  rod(arm, [19, 22.5, 0], [19, 20, 0], 0.5, 0.5, IRON_HI, VF.METAL); // S-hook
  const kt = new VoxelModel('crane_kettle');
  const KY = 0;
  lathe(kt, 19, 0, KY, KY + 7, (t) => 4.6 + Math.sin(t * Math.PI) * 1.2 - (t > 0.85 ? 1.6 : 0), (x, y, z, outer) => (y < KY + 2 ? 0x1a1816 : outer && h01(x, y, z) > 0.85 ? 0x5a4a3a : IRON), { dents: [{ a: 2.2, y0: KY + 2, y1: KY + 5, depth: 0.6, width: 0.6 }] }, VF.METAL);
  lathe(kt, 19, 0, KY + 8, KY + 9, () => 2.6, () => IRON_HI, {}, VF.METAL);
  egg(kt, [19.5, KY + 10, 0.5], [1, 1, 1], IRON, VF.METAL);
  rod(kt, [24, KY + 3, 0], [28.5, KY + 7.5, 0], 1.1, 0.6, IRON, VF.METAL); // spout
  tubeP(kt, spline([[14.5, KY + 7, 0], [15.5, KY + 13, 0], [19, KY + 15.5, 0], [22.5, KY + 13, 0], [23.5, KY + 7, 0]], 5), [0.5], IRON_HI, VF.METAL);
  void seed;
  return {
    name: 'fire_crane',
    voxelSize: FV,
    parts: [
      { name: 'arm', model: arm, pivot: [0.5, 0, 0.5], attach: [0.5, 0, 0.5] },
      { name: 'kettle', model: kt, pivot: [19.5, KY + 15.5, 0.5], attach: [19.5, 20, 0.5], parent: 'arm' },
    ],
    meta: { spout: [28.5 * FV, 0, 0] },
  };
}
