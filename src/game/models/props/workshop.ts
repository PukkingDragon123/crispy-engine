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
    return dEll(px, py, pz / Math.max(0.35, k), 0, 0, 0, half[0] * 1.08, half[1] * 1.08, half[2]) + lump(x, y, z, 0.4, seed) * 0.3;
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
 *  scene. meta: glass (centre, m), radii (m), tilt (rad about X: the top leans towards +Z, facing a little down). */
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

// =====================================================================
// THE HIDEOUT'S NAVIGATION HANDLES
// =====================================================================
/** A carved direction sign for the hideout's camera carousel, the arrow you click to look left or right.
 *  1/64: a hand-adzed pine board with a swallowtail end, a worn red-oxide groove, brass tacks and a three-turn
 *  twine binding with a dangling tail, capped with a forged iron arrowhead riveted through a collar.
 *  Points +X (dir 1) or -X (dir -1), front faces +Z, pivot at the centre. Every voxel carries a little
 *  self-light (EMISSIVE) so it stays readable as UI in the dark corners. */
export function arrowSign(dir: 1 | -1 = 1): StaticModel & { meta: { length: number } } {
  const m = new VoxelModel('arrow_sign');
  const E = VF.EMISSIVE;
  // ---- the board: thick pine, slightly bowed and uneven, swallowtail notch at the tail
  const bow = (x: number) => Math.sin((x + 20) * 0.11) * 0.45;
  fill(m, (x, y, z) => {
    const px = x + 0.5, py = y + 0.5 - bow(x + 0.5), pz = z + 0.5;
    let d = dRBox(px, py, pz, -6, 0, 0, 14.5, 5.6, 1.7, 1.1) + lump(x, y, z, 0.45, 3) * 0.35;
    d = Math.max(d, -(px + 14.2 + Math.abs(py) * 1.05)); // the swallowtail
    return d;
  }, [[-21, -7, -3], [9, 7, 3]], 1, (x, y, z, d) => {
    const along = Math.floor((x + 40) / 7), across = Math.floor((y + 0.5 - bow(x + 0.5)) * 0.9 + 20);
    let c = mul(0xa8743e, 0.92 + h01(across, along, 5) * 0.14);
    if (h01(across, Math.floor((x + 40) / 11), 9) > 0.8) c = mul(c, 0.84); // grain streaks
    if (d > -0.9) c = mul(c, 0.9); // worn darker at the arrises
    if (h01(x, y, z) > 0.985) c = mul(c, 0.6); // a pinhole or two
    return c;
  }, E);
  // the groove down the middle, filled with old red oxide paint (worn away in places)
  for (let x = -12; x <= 4; x++)
    for (const z of [1, -2]) {
      const y = Math.round(bow(x + 0.5) - 0.5);
      if (!m.has(x, y, z)) continue;
      m.del(x, y, z);
      if (h01(x, 7, z) > 0.25) m.set(x, y, z - Math.sign(z + 0.5), 0x8a3a22, E);
    }
  // brass tacks
  for (const [tx, ty] of [[-15, 3.6], [-15, -3.6], [2.5, 4], [2.5, -4]] as const)
    for (const tz of [1.9, -1.9]) egg(m, [tx, ty + bow(tx), tz], [1.1, 1.1, 0.8], (x, y) => (y + 0.5 > ty + bow(tx) ? BRASS_HI : BRASS), VF.METAL | E);
  // ---- three turns of twine near the tail, a knot and a short tail hanging down
  for (const x0 of [-11.2, -9.6, -8]) {
    const b = bow(x0);
    fill(m, (x, y, z) => {
      const px = x + 0.5, py = y + 0.5 - b, pz = z + 0.5;
      const shell = Math.abs(dRBox(px, py, pz, x0, 0, 0, 0.6, 6.2, 2.3, 1.2)) - 0.55;
      return Math.max(shell, Math.abs(px - x0) - 0.75);
    }, [[x0 - 1, -8, -4], [x0 + 1, 8, 4]], 1, (x, y, z) => (mod(y + z + Math.round(x0), 3) === 0 ? 0x9a8458 : 0xd2bc86), VF.SOFTAO | E);
  }
  egg(m, [-9.6, -6.6 + bow(-9.6), 2.4], [1.6, 1.4, 1.2], 0xc8b07a, VF.SOFTAO | E);
  rod(m, [-9.6, -7.2 + bow(-9.6), 2.6], [-10.8, -11, 2.9], 0.6, 0.5, (x, y) => (mod(y, 2) ? 0xd2bc86 : 0xb8a070), VF.SOFTAO | E);
  egg(m, [-10.9, -11.4, 2.9], [0.9, 0.9, 0.9], 0xb8a070, VF.SOFTAO | E);
  // ---- the forged iron head: a riveted collar over the board's end, then a broad bevelled blade
  fill(m, (x, y, z) => dRBox(x + 0.5, y + 0.5, z + 0.5, 9.2, bow(9), 0, 2.6, 6.9, 2.5, 1) + lump(x, y, z, 0.8, 7) * 0.25, [[5, -9, -4], [13, 9, 4]], 1, (x, y, z, d) => (d > -0.8 && h01(x + 34, y, z) > 0.7 ? 0x6a4a32 : h01((x >> 1) + 68, y >> 1, z) > 0.82 ? 0x7a4a2a : 0x3c3e44), VF.METAL | E);
  for (const ry of [3.6, -3.6]) for (const rz of [2.6, -2.6]) egg(m, [9.2, ry + bow(9), rz], [1, 1, 0.7], 0x8a8c90, VF.METAL | E);
  const half = (x: number) => (x < 11.5 ? 0 : 9.6 * Math.pow(Math.max(0, 1 - (x - 11.5) / 13.5), 0.82)); // slightly convex flanks
  fill(m, (x, y, z) => {
    const px = x + 0.5, py = y + 0.5 - bow(px), pz = z + 0.5;
    const hh = half(px);
    if (hh <= 0) return 1;
    const t = Math.abs(py) / hh; // 0 on the spine, 1 at the edge
    const th = 0.5 + 1.7 * (1 - t); // thick spine, ground-thin edges
    return Math.max(Math.abs(py) - hh, Math.abs(pz) - th, 11.5 - px);
  }, [[11, -11, -3], [26, 11, 3]], 1, (x, y, z) => {
    const px = x + 0.5, py = y + 0.5 - bow(px);
    const t = Math.abs(py) / Math.max(0.5, half(px));
    if (t > 0.78) return mul(0xb8bcc2, 0.94 + h01(x + 102, y, z) * 0.1); // the bright ground edge
    if (Math.abs(py) < 0.7) return 0x5a5c62; // the spine
    if (h01((x >> 1) + 136, y >> 1, z) > 0.86) return 0x7a4a2a; // a freckle of rust
    return mul(0x3e4148, 0.92 + h01(x + 85, y, z) * 0.12);
  }, VF.METAL | E);
  let out = m;
  if (dir < 0) {
    out = new VoxelModel('arrow_sign_l');
    m.forEach((x, y, z, c, f) => out.set(-1 - x, y, z, c, f));
  }
  const b = out.bounds();
  return { model: out, voxelSize: DV, meta: { length: (b.maxX - b.minX + 1) * DV } };
}

// =====================================================================
// THE HOUSE, MORE LIVED IN — and the toys (hub v4)
// The back-yard target fence and what stands on it, the pet scorpion's tank,
// herbs drying on a twine, the squeaky board, a cowhide, the trophy plaques and
// the red paint that crosses out a paid bounty, Mama's card table and the
// milking stool, the record crate and a shellac record, a picture light.
// =====================================================================
const TV = 1 / 96; // tiny / fine things
const PV = 1 / 128; // paint, records
/** pivot in a model's own voxel space that the scene meshes with when meta points must line up (centre of voxel 0) */
export const ORIGIN_PIVOT: V3 = [0.5, 0, 0.5];
const atO = (vs: number, p: V3): V3 => [(p[0] - 0.5) * vs, p[1] * vs, (p[2] - 0.5) * vs];
const CEDAR = [0x8a7a62, 0x7e6e58, 0x968670, 0x766a56];
const IRON = 0x34302c, IRON_RUST = 0x7a4a2a;

/** a dirt mound / skirt of trodden earth, only above y=0 */
function mound(m: VoxelModel, cx: number, cz: number, rx: number, rz: number, h: number, seed: number) {
  for (let x = Math.floor(cx - rx - 1); x <= cx + rx + 1; x++)
    for (let z = Math.floor(cz - rz - 1); z <= cz + rz + 1; z++) {
      const d = Math.hypot((x + 0.5 - cx) / rx, (z + 0.5 - cz) / rz) + lump(x, 0, z, 0.7, seed) * 0.25;
      if (d >= 1) continue;
      const top = Math.round(h * (1 - d * d));
      for (let y = 0; y <= top; y++) m.set(x, y, z, y === top ? (h01(x, seed, z) > 0.75 ? 0x9a7a52 : 0xa8885c) : 0x8a6a48);
    }
}
/** a few dry grass blades fanning up from a foot point */
function grassAt(m: VoxelModel, cx: number, cz: number, n: number, h: number, seed: number) {
  for (let i = 0; i < n; i++) {
    const a = h01(i, seed, 1) * Math.PI * 2, lean = 0.25 + h01(i, seed, 2) * 0.45, hh = h * (0.55 + h01(i, seed, 3) * 0.6);
    const bx = cx + Math.cos(a) * 1.4, bz = cz + Math.sin(a) * 1.4;
    tubeP(m, spline([[bx, 0, bz], [bx + Math.cos(a) * lean * hh * 0.4, hh * 0.55, bz + Math.sin(a) * lean * hh * 0.4], [bx + Math.cos(a) * lean * hh, hh, bz + Math.sin(a) * lean * hh]], 4), [0.55, 0.45, 0.3], (_x, y) => (y > hh * 0.7 ? 0xd8c080 : y < 2 ? 0x8a7a40 : 0xb8a058));
  }
}
/** a splintered bullet hole punched into the first voxel met going -Z from the front (z0) */
function shotHole(m: VoxelModel, x: number, y: number, z0: number, seed: number) {
  let z = z0;
  while (z > z0 - 12 && !m.has(x, y, z)) z--;
  if (!m.has(x, y, z)) return;
  m.set(x, y, z, 0x1a120c);
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1]]) if (h01(x + dx, y + dy, seed) > 0.35 && m.has(x + dx, y + dy, z)) m.set(x + dx, y + dy, z, 0xc8b898);
}

/** the back-yard target fence — 1/48, 3.1 m along X, front +Z: five hewn cedar posts each with its own lean, two
 *  split-rail poles behind, a wide flat top plank nailed over the post tops (the shelf the bottles and cans stand
 *  on), old bullet holes splintered through everything, a horseshoe nailed up for luck, a twist of baling wire round
 *  a cracked post, a tin cup on a nail, dry grass and trodden dirt at every foot.
 *  meta: slots (m, target spots on the shelf, bottom-centre pivot), top (m). */
export function yardFence(seed = 31): StaticModel & { meta: { slots: V3[]; top: number } } {
  const m = new VoxelModel('yard_fence');
  const HL = 75, TOP = 47;
  const POSTS = [-71, -35, 1, 36, 72];
  POSTS.forEach((px, i) => {
    const lean = (h01(i, 3, seed) - 0.5) * 2.6, leanZ = (h01(i, 5, seed) - 0.5) * 1.4;
    mound(m, px, 0, 6, 5, 2, seed + i);
    plank(m, [px, 0, 0], [px + lean, TOP - 1, leanZ], 6, 5.4, CEDAR[i % 4], seed + i * 7, { up: [0, 0, 1], r: 1.5, lumpy: 0.45, knots: true });
    // a hewn chamfer at the head, checked end grain
    egg(m, [px + lean, TOP - 1.5, leanZ], [3.2, 1.2, 2.8], mul(CEDAR[i % 4], 0.86));
    grassAt(m, px + 3, 3.5, 5, 9, seed + i * 3);
    grassAt(m, px - 4, -2, 3, 7, seed + i * 5);
  });
  // split-rail poles, low and middle, nailed to the posts' backs, bowed and barked in places
  ([[13, 2.3], [29, 2.0]] as const).forEach(([y, r], k) => {
    const pts: V3[] = [];
    for (let i = 0; i <= 6; i++) pts.push([-HL - 4 + (i / 6) * (2 * HL + 8), y + Math.sin(i * 1.3 + k) * 0.8 + (i === 3 ? -0.6 : 0), -4.2 + Math.sin(i * 0.7) * 0.4]);
    tubeP(m, spline(pts, 6), [r, r * 0.92, r * 1.05, r * 0.9], (x, yy, z) => {
      const g = h01(Math.floor(x / 9), Math.floor(yy * 2 + z), seed + k);
      if (g > 0.86) return 0x5a4a3a; // a strip of bark left on
      return mul(CEDAR[(k + 1) % 4], 0.9 + h01(Math.floor(x / 5), Math.round(yy - y) + 3, k) * 0.16);
    });
  });
  // the shelf: one long wide plank over the post heads, cupped and worn pale where things get set down
  plank(m, [-HL - 4, TOP + 0.9, 0.6], [HL + 4, TOP + 0.4, 0.4], 10, 2.6, 0x9a8a70, seed + 50, { up: [0, 1, 0], r: 0.8, lumpy: 0.25, knots: true });
  for (const px of POSTS) for (const nz of [-2.6, 2.6]) egg(m, [px, TOP + 2.2, nz], [0.8, 0.5, 0.8], (x, y, z) => (h01(x, y, z) > 0.5 ? IRON_RUST : IRON), VF.METAL);
  // old target practice: holes through the shelf's front edge and the posts
  for (let i = 0; i < 16; i++) shotHole(m, Math.round(-HL + h01(i, 7, seed) * 2 * HL), Math.round(TOP - 0.5 + h01(i, 8, seed) * 2), 8, i);
  for (let i = 0; i < 10; i++) {
    const px = POSTS[i % 5];
    shotHole(m, px + Math.round((h01(i, 9, seed) - 0.5) * 3), Math.round(8 + h01(i, 10, seed) * 34), 6, i + 40);
  }
  // a horseshoe on the middle post, ends up so the luck stays in
  const hx = POSTS[2] + 0.4, hy = 33;
  const shoe: V3[] = [];
  for (let a = -0.25; a <= Math.PI + 0.25; a += 0.2) shoe.push([hx + Math.cos(a) * 3.4, hy - Math.sin(a) * 3.9, 3.6]);
  tubeP(m, shoe, [0.85], (x, y) => (h01(x, y, 3) > 0.6 ? IRON_RUST : IRON), VF.METAL);
  egg(m, [hx, hy + 1, 3.8], [0.6, 0.6, 0.6], 0x2a2420, VF.METAL);
  // baling wire round the cracked fourth post, the crack itself
  for (let a = 0; a < Math.PI * 2 * 3; a += 0.12) m.set(Math.round(POSTS[3] + Math.cos(a) * 3.7), Math.round(19 + a * 0.32), Math.round(Math.sin(a) * 3.3), h01(Math.round(a * 4), 1, 2) > 0.7 ? IRON_RUST : 0x6a6660, VF.METAL);
  for (let y = 10; y < 30; y++) m.set(POSTS[3] + (y % 3 === 0 ? 1 : 0), y, 3, 0x2a2018);
  // a tin cup hanging by its handle from a nail on the first post
  const cx = POSTS[0] + 0.5, cy = 22;
  rod(m, [cx, cy + 6, 2.5], [cx, cy + 6, 5.5], 0.5, 0.45, IRON, VF.METAL);
  lathe(m, cx, 7, cy, cy + 4, (t) => 2.1 - t * 0.2, (x, y, z, outer) => (!outer ? 0x2a2420 : h01(x, y, z) > 0.8 ? 0x6a6a68 : 0xa8aaa8), { hollow: true }, VF.METAL);
  for (let a = -1.2; a <= 1.2; a += 0.25) m.set(Math.round(cx + Math.sin(a) * 1.4), Math.round(cy + 4.6 + Math.cos(a) * 1.4), 5, 0xa8aaa8, VF.METAL);
  const slots: V3[] = [];
  for (let i = 0; i < 9; i++) slots.push([-64 + i * 16 + Math.round((h01(i, 11, seed) - 0.5) * 3), TOP + 2, 0.5]);
  return { model: m, voxelSize: FV, meta: { slots: slots.map((s) => pivotOf(m, FV, s)), top: pivotOf(m, FV, [0, TOP + 2, 0])[1] } };
}

/** the four bottles you can shoot — 1/64, hand-blown (off-centre, wobbling), real glass colours with a sheen and a
 *  hard highlight streak: 0 an amber whiskey flask with a cork and a paper label, 1 a tall green wine bottle with a foil
 *  neck, 2 a squat cobalt tonic with embossed ribs, 3 a brown beer bottle with a crimped cap and an oval label.
 *  meta: h (m), glass (rgb for the shards), neckY (m, where it breaks). */
export function targetBottle(kind = 0): StaticModel & { meta: { h: number; glass: number; neckY: number } } {
  const m = new VoxelModel('target_bottle');
  const K = [
    { h: 18, r: 3.6, neck: 1.3, sh: 0.58, glass: 0x9a5a1a, hi: 0xf0b868, dk: 0x5a2c0c, sx: 1, sz: 0.74 },
    { h: 21, r: 3.1, neck: 1.1, sh: 0.5, glass: 0x2e5a2a, hi: 0x8ac07a, dk: 0x16301a, sx: 1, sz: 1 },
    { h: 13, r: 2.8, neck: 1.1, sh: 0.6, glass: 0x2a4aa0, hi: 0x8aaaf0, dk: 0x142450, sx: 1, sz: 1 },
    { h: 16, r: 2.8, neck: 1.1, sh: 0.55, glass: 0x6a3814, hi: 0xc8884a, dk: 0x3a1a08, sx: 1, sz: 1 },
  ][((kind % 4) + 4) % 4];
  const prof = (t: number) => {
    if (t < 0.05) return K.r - 0.55; // the heel
    if (t < K.sh) return K.r + Math.sin(t * 9 + kind) * 0.12;
    const u = Math.min(1, (t - K.sh) / 0.2);
    const r = K.neck + (K.r - K.neck) * (1 - u * u * (3 - 2 * u));
    return t > 0.93 ? K.neck + 0.55 : r; // the lip
  };
  const wob = (kind * 0.7) % 1;
  lathe(m, 0, 0, 0, K.h, prof, (x, y, z, outer, ang, t) => {
    if (!outer) return K.dk;
    let c = K.glass;
    if (Math.abs(ang + 2.3) < 0.28 || Math.abs(ang + 1.55) < 0.1) c = K.hi; // the window caught in the glass
    else if (Math.abs(ang - 0.9) < 0.4) c = mul(K.glass, 0.72);
    if (t < 0.08) c = mul(c, 0.8);
    if (kind === 0 && t > 0.16 && t < 0.48 && ang > 0.4 && ang < 2.8) c = y === 3 || y === 8 ? 0xa8302a : h01(x, y, z) > 0.9 ? 0xc8b890 : 0xe8dcb8; // the label
    if (kind === 1 && t > 0.82) c = mod(y, 2) ? 0x7a1a14 : 0x9a2a1e; // foil
    if (kind === 1 && t > 0.12 && t < 0.38 && ang > 0.5 && ang < 2.6) c = y === 4 ? 0x2a2a2a : 0xd8c8a0;
    if (kind === 2 && mod(Math.round(ang * 4), 3) === 0 && t < K.sh) c = mul(c, 0.82); // embossed ribs
    if (kind === 3 && t > 0.18 && t < 0.45 && Math.abs(ang - 1.57) < 0.9 && Math.hypot((ang - 1.57) * 2.4, (t - 0.31) * 12) < 1.9) c = Math.hypot((ang - 1.57) * 2.4, (t - 0.31) * 12) > 1.5 ? 0x7a2a1a : 0xd8b060;
    if (kind === 3 && t > 0.92) c = mod(Math.round(ang * 5), 2) ? 0xc8a040 : 0xa8802a; // crimped cap
    return c;
  }, { sx: K.sx, sz: K.sz, tiltX: wob * 0.04, dents: [{ a: 1 + kind, y0: 2, y1: Math.round(K.h * K.sh), depth: 0.3, width: 0.5 }] }, VF.METAL);
  if (kind === 0) lathe(m, 0, 0, K.h + 1, K.h + 2, (t) => 1.1 - t * 0.2, (x, y, z) => (h01(x, y, z) > 0.6 ? 0xb08a5a : 0xc89a6a), { tiltX: wob * 0.04 }); // cork
  return { model: m, voxelSize: DV, meta: { h: (K.h + 1) * DV, glass: K.glass, neckY: Math.round(K.h * (K.sh + 0.12)) * DV } };
}

/** the three tin cans — 1/64, rolled-seam rims, ribs, faded paper labels with a band, rust freckles and a dent, the
 *  lid cut round and bent back on its hinge: 0 beans (red), 1 peaches (orange, green band), 2 coffee (tall, blue). */
export function targetCan(kind = 0): StaticModel & { meta: { h: number } } {
  const m = new VoxelModel('target_can');
  const K = [
    { r: 3.3, h: 8, label: 0xb0302a, band: 0xe8d8a8, rust: 0.12 },
    { r: 3.4, h: 7, label: 0xe0902a, band: 0x3a6a2a, rust: 0.3 },
    { r: 3.7, h: 10, label: 0x2a4a7a, band: 0xd8b050, rust: 0.18 },
  ][((kind % 3) + 3) % 3];
  lathe(m, 0, 0, 0, K.h, (t) => (t < 0.08 || t > 0.92 ? K.r + 0.25 : K.r), (x, y, z, outer, ang) => {
    if (!outer) return y === K.h ? 0x6a6a68 : 0x9a9c9c;
    if (y === 0 || y === K.h) return mod(Math.round(ang * 6), 2) ? 0xb8bab8 : 0x8a8c8c; // rolled seams
    if (h01(x * 3, y, z * 3) < K.rust * 0.25) return h01(x, y, 9) > 0.5 ? 0x8a4a20 : 0x6a3418;
    if (Math.abs(ang + 1.9) < 0.22) return 0xd8d8d0; // a scuff to the bare tin
    if (y === 1 || y === K.h - 1) return 0x9a9c9c;
    const mid = Math.round(K.h / 2);
    return y === mid || (K.h > 8 && y === mid + 1) ? K.band : h01(Math.round(ang * 3), y, 4) > 0.9 ? mul(K.label, 0.85) : K.label;
  }, { dents: [{ a: 2.2 + kind, y0: 2, y1: K.h - 2, depth: 0.7, width: 0.6 }] }, VF.METAL);
  // the open top (dark inside) and the lid bent up on its hinge at the back
  for (let x = -3; x <= 3; x++) for (let z = -3; z <= 3; z++) if (Math.hypot(x, z) < K.r - 0.6) m.set(x, K.h, z, 0x3a3634, VF.METAL);
  for (let x = -3; x <= 3; x++)
    for (let s = 0; s <= 6; s++) {
      const zz = -K.r + s * Math.cos(1.1), yy = K.h + 1 + s * Math.sin(1.1);
      if (Math.hypot(x, s - 3.2) < K.r - 0.4) m.set(x, Math.round(yy), Math.round(zz), mod(x + s, 3) ? 0xc0c2c0 : 0x9a9c9c, VF.METAL);
    }
  return { model: m, voxelSize: DV, meta: { h: (K.h + 1) * DV } };
}

/** the pet scorpion's tank — 1/64, meshed with ORIGIN_PIVOT (glass is a separate model on the same grid): a walnut
 *  plinth with a moulded lip, slim walnut corner posts and top frame, a rippled sand floor with a slate slab, a
 *  bleached little cow skull, a terracotta water dish, a dead mesquite twig, a barrel cactus and a burrow mouth;
 *  a hinged iron-mesh lid with a brass heat lamp clamped to the back corner (bulb aglow).
 *  meta: floor (m), half (m, walkable half extents), lamp (m). */
export function terrarium(seed = 32): StaticModel & { meta: { floor: number; half: [number, number]; lamp: V3 } } {
  const m = new VoxelModel('terrarium');
  const HX = 20, HZ = 12, B = 5, TOPY = 30;
  fill(m, (x, y, z) => dRBox(x + 0.5, y + 0.5, z + 0.5, 0.5, B / 2 + 0.5, 0.5, HX + 2.5, B / 2 + 0.5, HZ + 2.5, 1.4), [[-HX - 4, 0, -HZ - 4], [HX + 4, B + 1, HZ + 4]], 1, (x, y, z, d) => {
    if (y >= B) return d > -1 ? 0x7a4a26 : 0x6a3e1e; // the lip
    if (y === 2 && d > -1) return 0x3e2412; // moulding groove
    return h01(x >> 2, y, z >> 2) > 0.8 ? 0x4e2e16 : WALNUT;
  });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) plank(m, [0.5 + sx * (HX + 1), B, 0.5 + sz * (HZ + 1)], [0.5 + sx * (HX + 1), TOPY, 0.5 + sz * (HZ + 1)], 2.4, 2.4, WALNUT, seed + sx * 3 + sz, { r: 0.6, lumpy: 0.1 });
  for (const sz of [-1, 1]) plank(m, [-HX - 1.5, TOPY, 0.5 + sz * (HZ + 1)], [HX + 2.5, TOPY, 0.5 + sz * (HZ + 1)], 2.4, 2, 0x6a3e1e, seed + 9 + sz, { r: 0.6 });
  for (const sx of [-1, 1]) plank(m, [0.5 + sx * (HX + 1), TOPY, -HZ - 1.5], [0.5 + sx * (HX + 1), TOPY, HZ + 2.5], 2.4, 2, 0x6a3e1e, seed + 12 + sx, { r: 0.6 });
  // sand, rippled by the wind that never gets in here
  const FY = B + 3;
  for (let x = -HX; x <= HX; x++)
    for (let z = -HZ; z <= HZ; z++) {
      const rip = Math.sin(x * 0.7 + z * 0.25 + Math.sin(z * 0.4)) > 0.55 ? 1 : 0;
      const h = FY + rip + (Math.hypot(x - 12, z + 5) < 5 ? 1 : 0);
      for (let y = B + 1; y <= h; y++) m.set(x, y, z, y === h ? (rip ? 0xe2c08a : h01(x, 7, z) > 0.85 ? 0xc8a070 : 0xd8b07c) : 0xb8925e);
    }
  // a burrow mouth under the slab
  for (let x = -14; x <= -9; x++) for (let z = -8; z <= -5; z++) if (Math.hypot(x + 11.5, (z + 6.5) * 1.4) < 2.6) for (let y = FY - 1; y <= FY + 1; y++) m.del(x, y, z);
  for (let x = -14; x <= -9; x++) for (let z = -8; z <= -5; z++) if (Math.hypot(x + 11.5, (z + 6.5) * 1.4) < 2.6) m.set(x, FY - 2, z, 0x3a2414);
  // the slate slab leaning over the burrow
  fill(m, (x, y, z) => dRBox(x + 0.5, y + 0.5 - (z + 0.5 + 6) * 0.25, z + 0.5, -11, FY + 2.5, -4, 7, 1.1, 5, 0.8) + lump(x, y, z, 0.6, seed) * 0.4, [[-19, FY, -11], [-3, FY + 6, 3]], 1, (x, y, z, d) => (d > -0.8 && y > FY + 2 ? 0x6a7078 : h01(x >> 1, y, z >> 1) > 0.7 ? 0x4a5058 : 0x565c64));
  // a little bleached cow skull, half sunk
  egg(m, [9, FY + 1.5, -6], [2.6, 1.8, 3.2], (x, y, z) => (h01(x, y, z) > 0.85 ? 0xc8b898 : 0xeee2c8), 0, 0.2, 3);
  for (const sx of [-1, 1]) {
    tubeP(m, spline([[9 + sx * 2, FY + 2.5, -7], [9 + sx * 4.5, FY + 3.5, -7.5], [9 + sx * 5.5, FY + 5.5, -6.5]], 4), [0.8, 0.6, 0.35], 0xe8dcc0);
    m.set(9 + sx, FY + 2, -4, 0x2a1c12); // eye sockets
  }
  m.set(9, FY + 1, -3, 0x2a1c12);
  // a terracotta water dish, a dead mesquite twig, a barrel cactus in the far corner
  lathe(m, 13, 7, FY, FY + 2, (t) => 3.8 - t * 0.4, (x, y, z, outer) => (!outer ? (y === FY + 2 ? 0x4a6a7a : 0x8a3a1e) : y === FY + 2 ? 0xc0603a : 0xa84a28), {});
  for (let x = 11; x <= 15; x++) for (let z = 5; z <= 9; z++) if (Math.hypot(x - 13, z - 7) < 2.4) m.set(x, FY + 2, z, h01(x, 1, z) > 0.7 ? 0x7a9aa8 : 0x5a7a8a, VF.METAL);
  const twig = spline([[-2, FY + 1, 6], [3, FY + 4, 4], [8, FY + 9, 3], [10, FY + 13, 1]], 5);
  tubeP(m, twig, [1.1, 0.9, 0.6, 0.35], (x, y) => (mod(y, 5) === 0 ? 0x5a4632 : 0x7a6248));
  tubeP(m, spline([[5, FY + 6, 3.6], [3, FY + 10, 2], [2, FY + 12, 3]], 3), [0.55, 0.35], 0x6a5440);
  lathe(m, -16, 8, FY, FY + 6, (t) => 2.6 + Math.sin(t * Math.PI) * 0.8 - (t > 0.85 ? 1.2 : 0), (x, y, z, outer, ang) => (y === FY + 6 ? 0xd85a8a : outer && mod(Math.round(ang * 12 / Math.PI), 2) === 0 ? 0x5a8a4a : 0x4a7a3c), {});
  // the lid: a hinged frame of iron mesh, a brass heat lamp clamped at the back-left
  for (let x = -HX - 1; x <= HX + 2; x++)
    for (let z = -HZ - 1; z <= HZ + 2; z++) {
      const edge = x === -HX - 1 || x === HX + 2 || z === -HZ - 1 || z === HZ + 2;
      if (edge) m.set(x, TOPY + 1, z, 0x2a2826, VF.METAL);
      else if (mod(x, 3) === 0 || mod(z, 3) === 0) m.set(x, TOPY + 1, z, h01(x >> 2, 1, z >> 2) > 0.85 ? IRON_RUST : 0x4a4644, VF.METAL);
    }
  const LX = -HX + 5, LZ = -HZ + 4, LY = TOPY + 6;
  rod(m, [LX, TOPY + 2, LZ], [LX, LY - 1, LZ], 0.7, 0.6, 0x3a3634, VF.METAL);
  lathe(m, LX, LZ, LY, LY + 4, (t) => 4.4 - t * 3, (x, y, z, outer, ang) => (!outer ? 0xf0dca8 : mod(Math.round(ang * 4), 2) ? BRASS : mul(BRASS, 0.82)), { hollow: true }, VF.METAL);
  egg(m, [LX + 0.5, LY + 0.6, LZ + 0.5], [1.6, 1.3, 1.6], 0xfff0c8, VF.GLOW);
  return { model: m, voxelSize: DV, meta: { floor: (FY + 1) * DV, half: [(HX - 3) * DV, (HZ - 3) * DV], lamp: atO(DV, [LX, LY, LZ]) } };
}

/** the tank's four panes on the terrarium grid (mesh it with ORIGIN_PIVOT and a glass material): faintly green, a
 *  water-spot haze low down, a smeared nose print, a clean diagonal glint */
export function terrariumGlass(): StaticModel {
  const m = new VoxelModel('terrarium_glass');
  const HX = 20, HZ = 12, B = 5, TOPY = 30;
  const pane = (x: number, y: number, z: number, u: number) => {
    let c = 0xc8dcd2;
    if (Math.abs(u * 0.6 - y + 14) < 1.2) c = 0xffffff;
    else if (y < B + 7 && h01(u, y, 3) > 0.6) c = 0xa8b8a4;
    else if (Math.hypot(u - 6, y - 18) < 2.5) c = 0xb8c4b8;
    m.set(x, y, z, c, VF.METAL | VF.SOFTAO);
  };
  for (let y = B + 1; y < TOPY; y++) {
    for (let x = -HX; x <= HX + 1; x++) {
      pane(x, y, HZ + 1, x);
      pane(x, y, -HZ, x + 40);
    }
    for (let z = -HZ + 1; z <= HZ; z++) {
      pane(HX + 1, y, z, z + 80);
      pane(-HX, y, z, z + 120);
    }
  }
  return S(m, DV);
}

/** a scorpion-sized slice of a cowboy's kitchen: a twine of drying things between two forged nails — 1/64 rig.
 *  'line' (root: nails, the sagging twine) → 'b1'…'b5' (each hangs from its tie point, pivot there, swings):
 *  a long red chile ristra, a sage bundle, lavender, a garlic braid, a short ristra. Runs along X, hangs -Y, front +Z. */
export function herbRig(seed = 33): RigSpec {
  const line = new VoxelModel('herb_line');
  const HL = 30, SAG = 5;
  const sagY = (t: number) => -Math.sin(t * Math.PI) * SAG;
  const twine: V3[] = [];
  for (let i = 0; i <= 12; i++) twine.push([-HL + (i / 12) * 2 * HL, sagY(i / 12), 1.5]);
  tubeP(line, spline(twine, 5), [0.5], (x, y) => (mod(x + y, 3) === 0 ? 0x9a8458 : 0xc8b07a), VF.SOFTAO);
  for (const sx of [-1, 1]) {
    rod(line, [sx * (HL + 1), 0.5, -1], [sx * (HL + 1), 0.5, 2.5], 0.7, 0.6, IRON, VF.METAL);
    egg(line, [sx * (HL + 1), 0.5, 2.8], [1.2, 1.2, 0.6], IRON_RUST, VF.METAL);
    egg(line, [sx * (HL - 0.5), -0.3, 1.5], [1.3, 1, 1.1], 0xb8a070, VF.SOFTAO); // the knot
  }
  const ties = [0.14, 0.32, 0.5, 0.68, 0.86].map((t): V3 => [-HL + t * 2 * HL, sagY(t), 1.5]);
  // ---- bundles, each tied at (0,0,0), hanging -Y
  const tie = (b: VoxelModel, y0: number, r: number) => {
    for (let y = y0; y >= y0 - 2; y--) for (let a = 0; a < Math.PI * 2; a += 0.3) b.set(Math.round(Math.cos(a) * r), y, Math.round(Math.sin(a) * r), mod(y, 2) ? 0xb8a070 : 0xd2bc86, VF.SOFTAO);
    rod(b, [0, 0, 0], [0, y0, 0], 0.5, 0.5, 0xc8b07a, VF.SOFTAO);
  };
  const ristra = (n: number, sd: number) => {
    const b = new VoxelModel('ristra');
    rod(b, [0, 0, 0], [0, -4 - n * 1.25, 0], 0.7, 0.6, 0xa89058, VF.SOFTAO);
    const CH = [0x9a1a10, 0xb02414, 0x7a1410, 0xc0301a, 0xa02016];
    for (let i = 0; i < n; i++) {
      const a = i * 2.4 + sd, y = -4 - i * 1.25, out = 1.4 + Math.sin(i * 0.9) * 0.3;
      const len = 4.4 + h01(i, sd, 1) * 1.6, droop = 2.6 + h01(i, sd, 2) * 1.2;
      const c = CH[Math.floor(h01(i, sd, 3) * CH.length)];
      const p0: V3 = [Math.cos(a) * out, y, Math.sin(a) * out];
      const p1: V3 = [Math.cos(a) * (out + len * 0.55), y - droop * 0.5, Math.sin(a) * (out + len * 0.55)];
      const p2: V3 = [Math.cos(a) * (out + len), y - droop, Math.sin(a) * (out + len) + 0.4];
      tubeP(b, [p0, p1, p2], [1.3, 1.0, 0.35], (x, yy, z) => (h01(x * 2, yy * 3, z * 2) > 0.82 ? mul(c, 0.72) : h01(x, yy, z + 7) > 0.93 ? mul(c, 1.25) : c));
      egg(b, p0, [0.7, 0.6, 0.7], 0x4a6a2a); // the stem cap
    }
    tie(b, -1, 1.4);
    return b;
  };
  const sprig = (cols: number[], spread: number, len: number, leaf: [number, number, number], heads: number | null, sd: number) => {
    const b = new VoxelModel('sprig');
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + h01(i, sd, 0), sp = spread * (0.5 + h01(i, sd, 1) * 0.5);
      const top: V3 = [Math.cos(a) * 0.8, -3, Math.sin(a) * 0.8];
      const end: V3 = [Math.cos(a) * sp, -3 - len * (0.8 + h01(i, sd, 2) * 0.3), Math.sin(a) * sp + 0.3];
      rod(b, top, end, 0.45, 0.35, 0x6a7a4a);
      for (let k = 1; k <= 6; k++) {
        const t = k / 7;
        const p: V3 = [top[0] + (end[0] - top[0]) * t, top[1] + (end[1] - top[1]) * t, top[2] + (end[2] - top[2]) * t];
        const c = cols[Math.floor(h01(i, k, sd) * cols.length)];
        if (heads === null) egg(b, [p[0] + Math.cos(a + k) * 0.8, p[1], p[2] + Math.sin(a + k) * 0.8], leaf, c, VF.SOFTAO);
        else if (t > 0.55) egg(b, p, [0.9, 1.4, 0.9], c, VF.SOFTAO);
      }
      // stalk ends cut square at the top
      egg(b, [Math.cos(a) * 0.6, -1.2, Math.sin(a) * 0.6], [0.5, 1.2, 0.5], 0x8a9a5a);
    }
    tie(b, -2, 1.6);
    return b;
  };
  const garlic = () => {
    const b = new VoxelModel('garlic');
    const braid: V3[] = [];
    for (let i = 0; i <= 10; i++) braid.push([Math.sin(i * 1.4) * 0.9, -2 - i * 1.6, Math.cos(i * 1.4) * 0.6]);
    tubeP(b, spline(braid, 3), [1.2, 1.0, 0.8], (x, y) => (mod(y + x, 3) === 0 ? 0xb8a068 : 0xd8c48a), VF.SOFTAO);
    for (let i = 0; i < 6; i++) {
      const a = i * 2.2, y = -5 - i * 2.4;
      const c: V3 = [Math.cos(a) * 2.6, y, Math.sin(a) * 2.6 + 0.6];
      egg(b, c, [2.1, 2.3, 2.1], (x, yy, z) => {
        const ang = Math.atan2(z - c[2], x - c[0]);
        if (mod(Math.round(ang * 6 / Math.PI), 2) === 0 && h01(x, yy, z) > 0.4) return 0xd8ccb4; // clove seams
        return yy < c[1] - 1 ? (h01(x, yy, z) > 0.5 ? 0xa86a8a : 0xe8dcc8) : 0xf2ead8;
      }, VF.SOFTAO, 0.15, i);
      egg(b, [c[0], y - 2.4, c[2]], [0.8, 0.6, 0.8], 0x8a7a5a); // roots
    }
    tie(b, -1, 1.4);
    return b;
  };
  const bundles = [
    ristra(14, seed),
    sprig([0x8a9a7a, 0x7a8a6a, 0xa0ac8a, 0x96a484], 2.6, 10, [1.2, 0.5, 0.8], null, seed + 1),
    sprig([0x7a5aa8, 0x9a7ac0, 0x6a4a96], 2.0, 12, [0.6, 0.6, 0.6], 1, seed + 2),
    garlic(),
    ristra(9, seed + 5),
  ];
  const parts: RigSpec['parts'] = [{ name: 'line', model: line, pivot: [0.5, 0.5, 0.5], attach: [0, 0, 0] }];
  bundles.forEach((b, i) => parts.push({ name: 'b' + (i + 1), model: b, pivot: [0.5, 0.5, 0.5], attach: [ties[i][0] + 0.5, ties[i][1] + 0.5, ties[i][2] + 0.5], parent: 'line' }));
  return { name: 'herb_line', voxelSize: DV, parts, meta: { bundles: bundles.length, length: (2 * HL + 4) * DV } };
}

/** the squeaky board — rig 'board' (pivot at its -X end, on the underside): a short patch board in the living-room
 *  pine, 1.15 m × 0.1 m, cupped and lifted a hair at the far end, worn pale down the middle by boots, a split near
 *  one end, two square nails (one backed out proud). 1/96. */
export function looseBoardRig(seed = 34): RigSpec {
  const m = new VoxelModel('loose_board');
  const L = 110, W = 10;
  for (let x = 0; x < L; x++)
    for (let z = 0; z < W; z++) {
      const lifted = x > L - 22 ? 1 : 0;
      const edge = z === 0 || z === W - 1;
      let c = mul(0x9c5e2e, 0.95 + h01(Math.floor(x / 13), z >> 1, seed) * 0.1);
      if (h01(Math.floor((x + z * 5) / 9), z, seed + 3) > 0.82) c = mul(c, 0.88); // grain
      if (!edge && Math.abs(z - W / 2 + 0.5) < 2.5 && x > 20 && x < 90) c = mixRGB(c, 0xc08a56, 0.28); // worn by boots
      if (edge) c = mul(c, 0.72);
      if (x === 0 || x === L - 1) c = 0x3a2414;
      if (x > 8 && x < 26 && z === 4 + (x % 5 === 0 ? 1 : 0)) c = 0x2a1a10; // the split
      m.set(x, lifted, z, c);
      if (lifted && x > L - 18) m.set(x, 0, z, mul(c, 0.6));
    }
  for (const [nx, proud] of [[6, 0], [L - 7, 1]] as const) for (const nz of [2, W - 3]) {
    const y = (nx > L - 22 ? 1 : 0) + 1 + proud;
    m.set(nx, y, nz, 0x2a2622, VF.METAL).set(nx + 1, y, nz, 0x2a2622, VF.METAL);
    if (proud) m.set(nx, y - 1, nz, 0x4a4440, VF.METAL);
  }
  return { name: 'loose_board', voxelSize: TV, parts: [{ name: 'board', model: m, pivot: [0, 0, W / 2], attach: [0, 0, 0] }], meta: { length: L * TV, width: W * TV } };
}

/** a cowhide rug — 1/48, about 1.7 × 1.25 m: the flat outline of a hide (four leg flaps, the neck, a tail strip) with a
 *  wavy cut edge, big brown and black patches on cream, the hair laying one way, scuffed thin in the middle. */
export function cowhideRug(seed = 35): StaticModel {
  const m = new VoxelModel('cowhide');
  const RX = 30, RZ = 21;
  const e2 = (x: number, z: number, cx: number, cz: number, rx: number, rz: number, a = 0) => {
    const dx = x - cx, dz = z - cz, c = Math.cos(a), s = Math.sin(a);
    return Math.hypot((dx * c + dz * s) / rx, (-dx * s + dz * c) / rz) - 1;
  };
  for (let x = -46; x <= 46; x++)
    for (let z = -36; z <= 36; z++) {
      const px = x + 0.5, pz = z + 0.5;
      let d = e2(px, pz, 0, 0, RX, RZ);
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) d = smin(d, e2(px, pz, sx * 25, sz * 21, 14, 5.2, sx * sz * 0.9), 0.25);
      d = smin(d, e2(px, pz, 33, 0, 9, 7.5), 0.3); // the neck
      d = smin(d, e2(px, pz, -36, 1.5, 9, 1.8, 0.08), 0.2); // the tail
      d += Math.sin(px * 0.9 + pz * 0.3) * 0.025 + lump(x, 0, z, 0.5, seed) * 0.04;
      if (d >= 0) continue;
      const pat = Math.sin(px * 0.11 + 1.3) * Math.sin(pz * 0.15 + 0.4) + Math.sin(px * 0.07 - pz * 0.09 + 2) * 0.7 + lump(x, 0, z, 0.12, seed + 4) * 0.5;
      let c = pat > 0.55 ? 0x5a3418 : pat < -0.75 ? 0x2a2018 : h01(x >> 1, 2, z >> 1) > 0.8 ? 0xe2d6bc : 0xeee4cc;
      if (pat > 0.55 && pat < 0.68) c = 0x7a4e2a; // patch rims blend a little
      if (d > -0.05) c = mul(c, 0.78); // the cut edge
      if (Math.hypot(px / RX, pz / RZ) < 0.35) c = mul(c, 0.93); // scuffed thin
      if (mod(x + Math.round(pz * 0.3), 4) === 0 && c > 0x800000) c = mul(c, 0.96); // hair laying one way
      m.set(x, 0, z, c, VF.SOFTAO);
      if (d < -0.18 && h01(x, 5, z) > 0.55) m.set(x, 1, z, mul(c, 1.03), VF.SOFTAO);
    }
  return S(m, FV);
}

/** a carved walnut trophy plaque — 1/96, 0.24 × 0.33 m, front +Z: an escutcheon (ogee-notched top, a pointed foot), a
 *  bevelled rim, a raised oval boss to mount on, acanthus curls carved over the top, a polished brass name plate with
 *  two screws. meta: mount (m, the boss front), plate [x0, y0, x1, y1, z] (voxels, for engraving). */
export function trophyPlaque(seed = 36): StaticModel & { meta: { mount: V3; plate: [number, number, number, number, number] } } {
  const m = new VoxelModel('trophy_plaque');
  const HW = 11.5, HT = 16, T = 3;
  const half = (y: number) => {
    const u = (y + HT) / (2 * HT); // 0 foot … 1 top
    if (u > 0.9) return HW - 2.5 + Math.cos((u - 0.9) * 31) * 1.6; // the ogee top
    if (u > 0.34) return HW;
    return HW * Math.sqrt(Math.max(0, 1 - Math.pow((0.34 - u) / 0.34, 1.6)));
  };
  const tone = mul(WALNUT, 0.92 + h01(seed, 1, 2) * 0.18);
  for (let y = -HT; y <= HT; y++)
    for (let x = -12; x <= 12; x++) {
      const hw = half(y + 0.5), ax = Math.abs(x + 0.5);
      if (ax > hw) continue;
      const inset = Math.min(hw - ax, HT - Math.abs(y + 0.5));
      const boss = Math.hypot((x + 0.5) / 7.5, (y + 0.5 - 2) / 9.5);
      const zt = inset < 1.2 ? T - 1 : boss < 1 ? T + 2 : T;
      for (let z = 0; z <= zt; z++) {
        let c = h01(x >> 1, Math.floor((y + 40) / 5), seed) > 0.78 ? mul(tone, 0.85) : tone;
        if (z === zt && inset < 2.4 && inset >= 1.2) c = mul(tone, 1.25); // the polished bevel catches light
        if (z === zt && boss < 1 && boss > 0.86) c = mul(tone, 0.7); // the boss's shadow line
        if (z < T - 1) c = mul(tone, 0.65);
        m.set(x, y, z, c);
      }
    }
  // acanthus curls over the top corners
  for (const sx of [-1, 1])
    for (let a = 0; a < Math.PI * 3.2; a += 0.22) {
      const r = 3.6 - a * 0.32;
      m.set(Math.round(sx * (6 + Math.cos(a) * r)), Math.round(12 + Math.sin(a) * r), T + 1, mul(tone, a < 1 ? 1.2 : 1.05));
    }
  // the brass name plate and its screws
  const plate: [number, number, number, number, number] = [-8, -12, 8, -7, T + 1];
  for (let x = plate[0]; x <= plate[2]; x++)
    for (let y = plate[1]; y <= plate[3]; y++) {
      const rim = x === plate[0] || x === plate[2] || y === plate[1] || y === plate[3];
      m.set(x, y, T + 1, rim ? mul(BRASS, 0.8) : y === plate[3] - 1 ? BRASS_HI : BRASS, VF.METAL);
    }
  for (const sx of [plate[0] + 1, plate[2] - 1]) m.set(sx, plate[1] + 2, T + 2, 0x8a6a30, VF.METAL);
  // a hanging slot cut in the back
  for (let x = -2; x <= 2; x++) m.del(x, 11, 0);
  const b = m.bounds();
  const cx = (b.minX + b.maxX + 1) / 2, cz = (b.minZ + b.maxZ + 1) / 2;
  return { model: m, voxelSize: TV, meta: { mount: [(0.5 - cx) * TV, (2.5 - b.minY) * TV, (T + 3 - cz) * TV], plate } };
}

/** a paid bounty, crossed out — 1/128, about 0.3 × 0.36 m, two loaded brush strokes in barn red laid over a poster:
 *  each one fat and wet where the brush landed, bristle streaks running the length, dry-brushed and broken where it
 *  left, a raised ridge of paint along the edges and drips running down to fat beads. Front +Z, centre pivot-ready. */
export function paintCross(seed = 37): StaticModel {
  const m = new VoxelModel('paint_x');
  const RED0 = 0xb41e14, RED_DK = 0x7a1008, RED_HI = 0xe0402a;
  const stroke = (ax: number, ay: number, bx: number, by: number, w0: number, sd: number) => {
    const L = Math.hypot(bx - ax, by - ay), ux = (bx - ax) / L, uy = (by - ay) / L, nx = -uy, ny = ux;
    for (let s = 0; s <= L; s += 0.4) {
      const t = s / L;
      const wob = Math.sin(t * 5 + sd) * 1.1;
      const w = w0 * (t < 0.12 ? 1.25 - t : 1 - t * 0.35) * (1 + Math.sin(t * 13 + sd) * 0.06);
      for (let k = -w; k <= w; k += 0.4) {
        const lane = Math.round(k * 1.6);
        const dry = t > 0.78 ? (t - 0.78) * 4.2 : 0;
        if (dry > 0 && h01(lane, Math.floor(s * 0.6), sd) < dry) continue;
        const x = Math.round(ax + ux * s + nx * (k + wob)), y = Math.round(ay + uy * s + ny * (k + wob));
        const st = h01(lane, sd, 7);
        let c = st > 0.8 ? RED_DK : st < 0.15 ? RED_HI : RED0;
        const rim = Math.abs(k) > w - 0.9;
        if (rim) c = mul(RED0, 0.85);
        m.set(x, y, 0, c);
        if ((rim && t < 0.85) || (t < 0.1 && Math.abs(k) < w * 0.6) || st > 0.88) m.set(x, y, 1, rim ? mul(RED0, 0.92) : c);
      }
    }
  };
  stroke(-17, 20, 16, -19, 3.3, seed);
  stroke(17, 18, -15, -20, 3.0, seed + 3);
  // drips, each from a heavy spot to a fat bead
  for (const [x, y, len] of [[-12, 13, 9], [6, -6, 7], [12, 12, 5], [-4, -9, 11], [0, 1, 6]] as const) {
    for (let k = 0; k < len; k++) m.set(x + (k > len * 0.6 ? 1 : 0), y - k, 0, k % 3 ? RED0 : RED_DK).set(x, y - k, 1, RED0);
    egg(m, [x + 1, y - len, 1], [1.2, 1.5, 1], RED_DK);
  }
  return S(m, PV);
}

/** Mama's card table — 1/48: an old whiskey keg (bulging staves, three iron hoops, a bung) under a round top of
 *  planks bound with an iron band, a square of worn green baize, three stacks of clay chips, a candle stub in a
 *  tin saucer. meta: top (m, baize surface), candle (m, flame). */
export function cardTable(seed = 38): StaticModel & { meta: { top: number; candle: V3 } } {
  const m = new VoxelModel('card_table');
  const H = 24, R = 16;
  lathe(m, 0, 0, 0, H - 1, (t) => 7.6 + Math.sin(t * Math.PI) * 1.6, (x, y, z, outer, ang, t) => {
    if (!outer) return 0x4a2e18;
    if (Math.abs(t - 0.1) < 0.05 || Math.abs(t - 0.9) < 0.05 || Math.abs(t - 0.5) < 0.04) return h01(x, y, z) > 0.75 ? IRON_RUST : IRON;
    const stave = Math.floor(((ang + Math.PI) / (Math.PI * 2)) * 14);
    if (mod((ang + Math.PI) / (Math.PI * 2) * 14, 1) < 0.1) return 0x3a2210;
    return mul(0x8a5a30, 0.88 + h01(stave, Math.floor(y / 6), seed) * 0.2);
  }, {}, 0);
  egg(m, [0, 12, 9], [1.4, 1.4, 0.8], 0x5a3418);
  // the top: planks across X, an iron band round the rim
  for (let x = -R; x <= R; x++)
    for (let z = -R; z <= R; z++) {
      const d = Math.hypot(x + 0.5, z + 0.5);
      if (d > R) continue;
      const band = d > R - 1.2;
      for (let y = H; y <= H + 1; y++) {
        let c = mul(0x9a6a3a, 0.9 + h01(Math.floor((z + 40) / 6), 2, seed) * 0.18);
        if (mod(z + 40, 6) === 0) c = 0x3a2412;
        if (band) c = y === H + 1 && h01(x, y, z) > 0.8 ? IRON_RUST : IRON;
        m.set(x, y, z, c, band ? VF.METAL : 0);
      }
    }
  // green baize, a little skewed, edges frayed, worn bare in an arc where hands rest
  const ca = Math.cos(0.32), sa = Math.sin(0.32);
  for (let x = -R; x <= R; x++)
    for (let z = -R; z <= R; z++) {
      const u = x * ca + z * sa, v = -x * sa + z * ca;
      if (Math.abs(u) > 10.5 || Math.abs(v) > 10.5) continue;
      if ((Math.abs(u) > 10 || Math.abs(v) > 10) && h01(x, 3, z) > 0.5) continue;
      if (Math.hypot(x, z) > R - 1.5) continue;
      let c = h01(x >> 1, 4, z >> 1) > 0.7 ? 0x2e5a3a : 0x2a5234;
      if (Math.abs(Math.hypot(u, v + 6) - 7) < 1.2) c = 0x3e6a48; // worn
      m.set(x, H + 2, z, c, VF.SOFTAO);
    }
  // clay chips
  ([[-9, 8, 4, 0xb02a1a], [-11.5, 4.5, 3, 0xe8dcc0], [-7, 11, 5, 0x2a4a8a]] as const).forEach(([cx, cz, n, c], i) => {
    for (let k = 0; k < n; k++) lathe(m, cx + (k % 2 ? 0.3 : 0), cz, H + 3 + k, H + 3 + k, () => 1.9, (x, y, z, outer) => (outer && mod(Math.round(Math.atan2(z, x) * 3), 2) ? 0xf0e6d0 : mul(c, 0.95 + h01(i, k, 1) * 0.1)), {});
  });
  // a candle stub in a tin saucer
  lathe(m, 10, -8, H + 3, H + 3, () => 3, (x, y, z, outer) => (outer ? 0x8a8c8c : 0x6a6c6c), {}, VF.METAL);
  lathe(m, 10, -8, H + 4, H + 7, (t) => 1.3 - t * 0.2, (x, y, z) => (y === H + 7 ? 0xf0e0b0 : h01(x, y, z) > 0.7 ? 0xe8d8a8 : 0xf4ead0), {});
  for (let k = 0; k < 3; k++) m.set(11, H + 6 - k, -8 + (k > 1 ? 1 : 0), 0xf4ead0); // a run of wax
  m.set(10, H + 8, -8, 0x2a2018).set(10, H + 9, -8, 0xffd890, VF.GLOW);
  return { model: m, voxelSize: FV, meta: { top: (H + 3) * FV, candle: pivotOf(m, FV, [10, H + 9.5, -8]) } };
}

/** a three-legged milking stool — 1/48: a thick round seat dished by years of sitting, a check crack, the leg tenons
 *  wedged through and showing as dark end grain on top, splayed legs, one rung. meta.seat (m). */
export function milkStool(seed = 39): StaticModel & { meta: { seat: number } } {
  const m = new VoxelModel('milk_stool');
  const SY = 16, R = 8.5;
  const legs: V3[] = [0, 1, 2].map((i) => [Math.cos(i * 2.094 + 0.5) * 5, SY, Math.sin(i * 2.094 + 0.5) * 5]);
  legs.forEach((p, i) => rod(m, [p[0] * 1.9, 0, p[2] * 1.9], [p[0], SY, p[2]], 1.5, 1.3, (x, y, z) => mul(0x8a5a30, 0.9 + h01(x, y >> 2, z + i) * 0.16)));
  rod(m, [legs[0][0] * 1.5, 6, legs[0][2] * 1.5], [legs[1][0] * 1.5, 6, legs[1][2] * 1.5], 0.9, 0.9, 0x7a4a26);
  fill(m, (x, y, z) => dRBox(x + 0.5, y + 0.5, z + 0.5, 0, SY + 1.2, 0, R, 1.3, R, 1.2) + (Math.hypot(x + 0.5, z + 0.5) > R ? 9 : 0) + lump(x, y, z, 0.5, seed) * 0.2, [[-R - 1, SY - 1, -R - 1], [R + 1, SY + 4, R + 1]], 1, (x, y, z) => {
    if (y >= SY + 2 && legs.some((p) => Math.hypot(x + 0.5 - p[0], z + 0.5 - p[2]) < 1.2)) return 0x3a2412; // wedged tenons
    if (y >= SY + 2 && Math.abs(z - x * 0.3 - 2) < 0.5 && x > -2 && x < 6) return 0x2a1a10; // the check
    const dish = Math.hypot(x + 0.5, z + 0.5) < 4.5 && y >= SY + 2;
    return dish ? 0xb88250 : mul(0xa06a38, 0.92 + h01(Math.floor((z + 20) / 4), y, seed) * 0.14);
  });
  return { model: m, voxelSize: FV, meta: { seat: (SY + 3) * FV } };
}

/** the record crate — 1/64: a slatted fruit crate (hand-holds cut in the ends, a split slat) full of 78s in kraft and
 *  printed sleeves, standing and leaning, one pulled half out. Front +Z. */
export function recordCrate(seed = 40): StaticModel {
  const m = new VoxelModel('record_crate');
  const HX = 11, HZ = 9, H = 14;
  const slat = (a: V3, b: V3, up: V3, i: number) => plank(m, a, b, 4.4, 1.1, 0xb08250, seed + i, { up, r: 0.4, lumpy: 0.15, knots: i % 3 === 0 });
  for (let k = 0; k < 3; k++) {
    const y = 2.5 + k * 5;
    slat([-HX, y, HZ], [HX, y, HZ], [0, 0, 1], k);
    slat([-HX, y, -HZ], [HX, y, -HZ], [0, 0, 1], k + 3);
  }
  for (const sx of [-1, 1]) {
    fill(m, (x, y, z) => Math.max(dRBox(x + 0.5, y + 0.5, z + 0.5, sx * HX, H / 2, 0, 0.7, H / 2, HZ, 0.3), -dRBox(x + 0.5, y + 0.5, z + 0.5, sx * HX, H - 3, 0, 2, 1.1, 3.4, 1)), [[sx * HX - 1, 0, -HZ - 1], [sx * HX + 1, H, HZ + 1]], 1, (x, y, z) => mul(0xa87848, 0.9 + h01(y >> 2, z >> 2, sx) * 0.16));
    for (const sz of [-1, 1]) rod(m, [sx * (HX - 1), 0, sz * (HZ - 1)], [sx * (HX - 1), H, sz * (HZ - 1)], 1, 1, 0x8a6038);
  }
  for (let x = -HX; x <= HX; x++) for (let z = -HZ; z <= HZ; z++) m.set(x, 0, z, 0x8a6038);
  m.set(-3, 7, HZ + 1, 0x2a1a10).set(-2, 7, HZ + 1, 0x2a1a10).set(-1, 8, HZ + 1, 0x2a1a10); // the split
  const SLEEVE = [0xb89a6a, 0xa88a5a, 0xe2d6b8, 0x8a2a1e, 0x2a5a6a, 0xc8a040, 0xb89a6a, 0x3a3a5a, 0xa88a5a];
  for (let i = 0; i < 9; i++) {
    const x = -HX + 2 + i * 2.2, lean = i === 6 ? 0.7 : (h01(i, 1, seed) - 0.5) * 0.4, rise = i === 4 ? 6 : 0;
    const c = SLEEVE[i];
    for (let y = 1; y <= 17 + rise; y++)
      for (let z = -8; z <= 8; z++) {
        if (Math.hypot(z, y - 9 - rise) > 8.6) continue;
        const hole = Math.hypot(z, y - 9 - rise) < 2.2 && (c === 0xb89a6a || c === 0xa88a5a);
        const xx = Math.round(x + (y - 1) * lean * 0.5);
        m.set(xx, y, z, hole ? 0x1a1614 : y > 15 + rise && h01(xx, y, z) > 0.6 ? mul(c, 0.8) : mod(y + z, 9) === 0 ? mul(c, 0.92) : c, VF.SOFTAO);
      }
  }
  return S(m, DV);
}

/** a shellac 78 — 1/128, 0.25 m across: the grooves in bands of black and near-black with a soft sheen ring, a raised
 *  rim, the paper label in two colours split by a gilt line (so you can see it turn) with the spindle hole. */
export function shellacRecord(label = 0xb02a1a, label2 = 0xe8d8b0): StaticModel {
  const m = new VoxelModel('shellac_78');
  const R = 16;
  for (let x = -R; x <= R; x++)
    for (let z = -R; z <= R; z++) {
      const d = Math.hypot(x + 0.5, z + 0.5);
      if (d > R) continue;
      const a = Math.atan2(z + 0.5, x + 0.5);
      let c = mod(Math.round(d * 1.6), 3) === 0 ? 0x2a2624 : 0x141210;
      if (Math.abs(a + 2.2) < 0.25 && d > 7) c = 0x5a5450; // the sheen
      let y = 0;
      if (d > R - 1) y = 1;
      if (d < 6) c = d < 0.9 ? 0x0a0a0a : Math.abs(a) < 0.12 || Math.abs(a - Math.PI) < 0.12 ? BRASS_HI : a > 0 ? label : label2;
      m.set(x, 0, z, c, d < 6 ? 0 : VF.METAL);
      if (y) m.set(x, 1, z, 0x1e1a18, VF.METAL);
    }
  return S(m, PV);
}

/** a brass picture light — 1/64: a wall plate, a swan-neck arm and a long hooded shade throwing light down on what
 *  hangs under it, the bulb aglow inside. Mounts on a wall facing +Z. meta.bulb (m). */
export function pictureLight(): StaticModel & { meta: { bulb: V3 } } {
  const m = new VoxelModel('picture_light');
  fill(m, (x, y, z) => dRBox(x + 0.5, y + 0.5, z + 0.5, 0, 0, 0.5, 2.6, 3.6, 0.6, 0.5), [[-4, -5, -1], [4, 5, 2]], 1, (_x, y) => (y > 2 ? BRASS_HI : BRASS), VF.METAL);
  tubeP(m, spline([[0, 1, 1], [0, 4, 4], [0, 6, 8], [0, 5.5, 11]], 5), [0.8], BRASS, VF.METAL);
  fill(m, (x, y, z) => {
    const px = x + 0.5, py = y + 0.5 - 5, pz = z + 0.5 - 12;
    const outer = Math.hypot(py / 2.6, pz / 3.2) - 1;
    return Math.max(outer, Math.abs(px) - 13, -(Math.hypot(py / 2.0, pz / 2.6) - 1), py - 2.2 + Math.abs(px) * 0.02 > 0 ? -1 : py < -1.6 ? 1 : -1);
  }, [[-14, 1, 8], [14, 8, 16]], 1, (x, y, z) => (Math.abs(x) > 12 ? mul(BRASS, 0.8) : y > 6 ? BRASS_HI : mod(x, 5) === 0 ? mul(BRASS, 0.9) : BRASS), VF.METAL);
  for (let x = -10; x <= 10; x++) m.set(x, 4, 12, 0xfff0c8, VF.GLOW);
  return { model: m, voxelSize: DV, meta: { bulb: pivotOf(m, DV, [0, 4, 12]) } };
}

// ---------------------------------------------------------------------
// the dressing corner and the gunsmith's extras (3D interactive screens)
// ---------------------------------------------------------------------
/** real oval links along a polyline, each turned 90° from the last — the voxel chain every lock hangs on */
function chainAlong(m: VoxelModel, pts: V3[], link = 2.2, r = 0.45, col: (i: number) => number = (i) => (i % 2 ? 0x4a4642 : 0x5e5a54)) {
  let acc = 0, i = 0;
  for (let p = 0; p < pts.length - 1; p++) {
    const a = pts[p], b = pts[p + 1];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const U = nrm([b[0] - a[0], b[1] - a[1], b[2] - a[2]]);
    let side = crs(U, [0, 0, 1]);
    if (Math.hypot(...side) < 1e-3) side = crs(U, [1, 0, 0]);
    side = nrm(side);
    const side2 = crs(U, side);
    for (; acc < L; acc += link * 0.78, i++) {
      const c: V3 = [a[0] + U[0] * acc, a[1] + U[1] * acc, a[2] + U[2] * acc];
      const sv = i % 2 ? side : side2;
      for (let t = 0; t < Math.PI * 2; t += 0.35) {
        const ca = Math.cos(t) * link * 0.6, sa = Math.sin(t) * link * 0.32;
        const q: V3 = [c[0] + U[0] * ca + sv[0] * sa, c[1] + U[1] * ca + sv[1] * sa, c[2] + U[2] * ca + sv[2] * sa];
        rod(m, q, q, r, r, col(i), VF.METAL);
      }
    }
    acc -= L;
  }
}

/** a Shaker peg rail for hats — 1/48, front +Z: a moulded pine board with a beaded edge, `n` turned walnut pegs
 *  angled up, two square nails at each end. meta.pegs: the peg tips (m, bottom-centre pivot), where a hat's crown sits. */
export function hatPegRail(n = 4, seed = 41): StaticModel & { meta: { pegs: V3[] } } {
  const m = new VoxelModel('hat_rail');
  const SP = 15, HL = (n * SP) / 2 + 3;
  fill(m, (x, y, z) => dRBox(x + 0.5, y + 0.5, z + 0.5, 0, 4, 1, HL, 4, 1.2, 0.6) + lump(x, y, z, 0.3, seed) * 0.15, [[-HL - 1, 0, -1], [HL + 1, 9, 3]], 1, (x, y, z, d) => {
    if (y === 7 && d > -0.8) return 0xb88a54; // the bead
    if (y === 6) return 0x7a5232;
    return mul(0x9a6a3a, 0.92 + h01(Math.floor((x + 60) / 8), y >> 2, seed) * 0.14);
  });
  for (const sx of [-1, 1]) for (const ny of [2, 6]) egg(m, [sx * (HL - 2), ny, 2.4], [0.7, 0.7, 0.5], IRON, VF.METAL);
  const pegs: V3[] = [];
  for (let i = 0; i < n; i++) {
    const px = -HL + 3 + SP / 2 + i * SP;
    rod(m, [px, 4, 2], [px, 6.2, 8.5], 1.3, 0.9, (x, y, z) => mul(WALNUT, 0.95 + h01(x, y, z) * 0.12));
    egg(m, [px, 6.6, 9.2], [1.6, 1.4, 1.4], 0x6a4024); // the knob
    pegs.push([px, 7.5, 9]);
  }
  return { model: m, voxelSize: FV, meta: { pegs: pegs.map((p) => pivotOf(m, FV, p)) } };
}

/** a clothes rail — 1/48, 1.5 m: two A-frame ends of forged pipe on oak feet, a top pipe with a sag and a rust bloom,
 *  a crossbar shelf low down with a pair of boots on it. meta: bar (m: y, half length). */
export function clothesRail(seed = 42): StaticModel & { meta: { bar: [number, number] } } {
  const m = new VoxelModel('clothes_rail');
  const HL = 36, TOP = 78;
  for (const sx of [-1, 1]) {
    const x = sx * HL;
    plank(m, [x, 1.5, -11], [x, 1.5, 11], 4, 3, OAK_DK, seed + sx, { up: [0, 1, 0], r: 1.2, lumpy: 0.3 });
    for (const sz of [-1, 1]) rod(m, [x, 3, sz * 8], [x, TOP - 1, 0], 1.1, 1, (xx, y, z) => (h01(xx, y >> 2, z) > 0.85 ? IRON_RUST : 0x3a3634), VF.METAL);
    egg(m, [x, TOP, 0], [1.8, 1.8, 1.8], 0x2a2826, VF.METAL);
  }
  tubeP(m, spline([[-HL, TOP, 0], [0, TOP - 0.6, 0], [HL, TOP, 0]], 8), [1.0], (x) => (Math.abs(x - 9) < 3 ? IRON_RUST : mod(x, 7) === 0 ? 0x4a4642 : 0x3a3634), VF.METAL);
  plank(m, [-HL, 10, 0], [HL, 10, 0], 14, 1.6, 0x9a6a3a, seed + 4, { r: 0.6, knots: true });
  // a pair of boots on the shelf
  for (const bx of [-20, -13]) {
    fill(m, (x, y, z) => smin(dRBox(x + 0.5, y + 0.5, z + 0.5, bx, 17, -1, 2.6, 6, 2.8, 1.4), dRBox(x + 0.5, y + 0.5, z + 0.5, bx, 12.4, 2.2, 2.4, 1.6, 5, 1.2), 1.5), [[bx - 4, 10, -5], [bx + 4, 24, 8]], 1, (x, y, z, d) => (y < 12 ? 0x2a1a10 : d > -0.8 && y > 21 ? 0x8a5a30 : h01(x, y, z) > 0.85 ? 0x5a3418 : 0x6a3e1e));
  }
  return { model: m, voxelSize: FV, meta: { bar: [pivotOf(m, FV, [0, TOP, 0])[1], HL * FV] } };
}

/** a carved wooden coat hanger — 1/64: a curved shoulder bar with rounded ends, a forged hook with a turned-up tip.
 *  Pivot hint: meta.hook (m) is the inside of the hook's bend, where it rides the rail. */
export function coatHanger(seed = 43): StaticModel & { meta: { hook: V3; shoulder: number } } {
  const m = new VoxelModel('coat_hanger');
  const W = 13;
  tubeP(m, spline([[-W, 0, 0], [-W / 2, 2.6, 0], [0, 3.6, 0], [W / 2, 2.6, 0], [W, 0, 0]], 6), [1.4, 1.2, 1.3, 1.2, 1.4], (x, y) => mul(0xa87444, 0.92 + h01(x >> 2, y, seed) * 0.12));
  for (const sx of [-1, 1]) egg(m, [sx * W, 0, 0], [1.7, 1.6, 1.6], 0x8a5a30);
  const hook: V3[] = [[0, 4, 0], [0, 8, 0], [0, 10.5, 0.4], [1.6, 12.2, 0.3], [3.2, 10.8, 0], [3.0, 9.6, 0]];
  tubeP(m, spline(hook, 4), [0.55], (x, y) => (h01(x, y, 2) > 0.7 ? 0x6a6660 : 0x8a8680), VF.METAL);
  return { model: m, voxelSize: DV, meta: { hook: pivotOf(m, DV, [1.6, 11.4, 0.3]), shoulder: pivotOf(m, DV, [0, 2.6, 0])[1] } };
}

/** a padlocked chain for whatever you can't have yet — 1/96, centre pivot: a sagging run of oval links with a fat
 *  brass padlock hanging off the middle (shackle, keyhole, a scuffed face). */
export function lockChain(span = 26, seed = 44): StaticModel {
  const m = new VoxelModel('lock_chain');
  const sag = span * 0.28;
  const pts: V3[] = [];
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    pts.push([-span / 2 + t * span, -Math.sin(t * Math.PI) * sag, Math.sin(t * 7 + seed) * 0.4]);
  }
  chainAlong(m, pts);
  const ly = -sag - 4.2;
  for (let a = 0; a <= Math.PI; a += 0.15) m.set(Math.round(Math.cos(a) * 2.4), Math.round(ly + 3 + Math.sin(a) * 3), 0, 0x9a9690, VF.METAL);
  fill(m, (x, y, z) => dRBox(x + 0.5, y + 0.5, z + 0.5, 0, ly, 0, 4, 3.6, 1.6, 1.2), [[-5, ly - 5, -3], [5, ly + 4, 3]], 1, (x, y, z, d) => {
    if (Math.abs(x + 0.5) < 0.6 && y < ly && y > ly - 2.5 && z > 0) return 0x1a120a; // keyhole
    return d > -0.8 && y > ly + 2 ? BRASS_HI : h01(x, y, z) > 0.85 ? mul(BRASS, 0.75) : BRASS;
  }, VF.METAL);
  return S(m, TV);
}

/** a manila price tag on a string — 1/96: a card with clipped corners, a brass-ringed hole, a loop of twine; the
 *  scene prints the price on it (Alagard). meta.face: the printable face centre (m) and size [w, h] (m), facing +Z. */
export function priceTag(): StaticModel & { meta: { face: V3; size: [number, number]; top: V3 } } {
  const m = new VoxelModel('price_tag');
  const W = 9, H = 6;
  for (let x = -W; x <= W; x++)
    for (let y = -H; y <= H; y++) {
      if (x < -W + 3 && Math.abs(y) > H - (x + W)) continue; // clipped corners at the hole end
      m.set(x, y, 0, h01(x, y, 3) > 0.9 ? 0xc8a878 : 0xd8bc88, VF.SOFTAO);
    }
  for (let a = 0; a < Math.PI * 2; a += 0.4) m.set(Math.round(-W + 3 + Math.cos(a) * 1.4), Math.round(Math.sin(a) * 1.4), 1, BRASS, VF.METAL);
  m.del(-W + 3, 0, 0);
  tubeP(m, spline([[-W + 3, 0, 1], [-W - 2, 3, 1.4], [-W - 4, 8, 1], [-W - 3, 12, 0.5]], 4), [0.4], 0xc8b07a, VF.SOFTAO);
  return { model: m, voxelSize: TV, meta: { face: pivotOf(m, TV, [1.5, 0, 0.5]), size: [(2 * W - 4) * TV, (2 * H - 2) * TV], top: pivotOf(m, TV, [-W - 3, 12, 0.5]) } };
}

/** a gunsmith's parts tray — 1/48: a shallow walnut tray with finger-jointed corners, green felt and three dividers,
 *  meant to sit at the front edge of the bench with the loose parts in it. meta.top (m, the felt). */
export function partsTray(len = 60, seed = 45): StaticModel & { meta: { top: number } } {
  const m = new VoxelModel('parts_tray');
  const HL = len / 2, HZ = 7;
  for (let x = -HL; x <= HL; x++)
    for (let z = -HZ; z <= HZ; z++) {
      const wall = Math.abs(x) >= HL - 0.5 || Math.abs(z) >= HZ - 0.5;
      const div = !wall && mod(x + HL, Math.round(len / 4)) === 0 && Math.abs(z) < HZ - 1;
      m.set(x, 0, z, WALNUT);
      if (wall || div) for (let y = 1; y <= (div ? 2 : 3); y++) m.set(x, y, z, (Math.abs(x) >= HL - 0.5 && Math.abs(z) >= HZ - 0.5 && y % 2) ? 0x4e2e16 : mul(WALNUT, 1.1 + h01(x >> 2, y, seed) * 0.1));
      else m.set(x, 1, z, h01(x >> 1, 3, z >> 1) > 0.75 ? 0x2e5a3a : 0x2a5234, VF.SOFTAO);
    }
  return { model: m, voxelSize: FV, meta: { top: 2 * FV } };
}

/** two forged J-hooks screwed to a backing block — 1/48, a pair per long gun on the wall over the bench. Front +Z. */
export function gunHook(seed = 46): StaticModel {
  const m = new VoxelModel('gun_hook');
  fill(m, (x, y, z) => dRBox(x + 0.5, y + 0.5, z + 0.5, 0, 0, 0.5, 2.4, 3.4, 1, 0.6), [[-4, -5, -1], [4, 5, 3]], 1, (x, y) => mul(0x7a5232, 0.9 + h01(x, y, seed) * 0.16));
  tubeP(m, spline([[0, 1, 1.5], [0, 0, 4.5], [0, -1.6, 7], [0, 0.4, 8.6], [0, 2.4, 8.4]], 4), [0.9, 0.85, 0.8, 0.75, 0.7], (x, y, z) => (h01(x, y, z) > 0.75 ? IRON_RUST : IRON), VF.METAL);
  egg(m, [0, 2.4, 2.2], [0.8, 0.8, 0.4], 0x8a8680, VF.METAL);
  return S(m, FV);
}

/** a moon-clip speedloader — 1/64: the six-pointed steel clip holding six brass cartridges, nose up, one with a
 *  dented case. Centre-bottom pivot. */
export function moonClip(): StaticModel {
  const m = new VoxelModel('moon_clip');
  for (let x = -6; x <= 6; x++)
    for (let z = -6; z <= 6; z++) {
      const a = Math.atan2(z, x), r = Math.hypot(x, z);
      const star = 4.2 + Math.cos(a * 6) * 1.2;
      if (r < star && r > 1.2) m.set(x, 0, z, mod(Math.round(a * 3), 2) ? 0x8a8c90 : 0x6a6c70, VF.METAL);
    }
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2, cx = Math.cos(a) * 3.6, cz = Math.sin(a) * 3.6;
    lathe(m, Math.round(cx), Math.round(cz), 1, 7, (t) => (t > 0.7 ? 1.2 - (t - 0.7) * 2.2 : 1.25), (x, y, z, outer, ang, t) => (t > 0.72 ? 0x9a8a80 : outer && Math.abs(ang - 1) < 0.35 ? 0xf0d080 : i === 2 && y === 3 && ang > 2 ? 0xa07a30 : 0xd8a848), {}, VF.METAL);
  }
  return S(m, DV);
}

/** an adjustable wrench for the bench animation — 1/64, handle along +X, jaws at +X end. Centre pivot. */
export function benchWrench(): StaticModel {
  const m = new VoxelModel('bench_wrench');
  rod(m, [-10, 0, 0], [6, 0, 0], 1.3, 1.1, (x) => (x < -6 ? 0xa83a2a : STEEL), VF.METAL);
  fill(m, (x, y, z) => Math.max(dRBox(x + 0.5, y + 0.5, z + 0.5, 9, 1, 0, 3.4, 3.4, 1.1, 1), -dRBox(x + 0.5, y + 0.5, z + 0.5, 11, 2.6, 0, 2, 1.4, 3, 0.4)), [[5, -3, -2], [13, 5, 2]], 1, (_x, y) => (y > 3 ? STEEL_HI : STEEL), VF.METAL);
  rod(m, [7.5, -0.8, 1.2], [10.5, -0.8, 1.2], 0.7, 0.7, (x) => (mod(x, 2) ? 0x9a9ca0 : 0x6a6c70), VF.METAL);
  return S(m, DV);
}
