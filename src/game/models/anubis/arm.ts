// THE ARM OF ANUBIS (1/20 m): the god's right forearm and hand, ~8.5 m from the
// buried elbow to the claw tips, reaching up out of the sand to take a soul.
//   skin    black, with a cold blue-violet sheen on the lit planes; sculpted from
//           smooth-blended muscle bellies (flexors, extensors, brachioradialis),
//           the ulna ridge, wrist styloids, tendon cords on the inner wrist and the
//           back of the hand, knuckles, finger pads, joint creases, palm lines;
//   gold    a broad flared wrist cuff (raised rims, a lapis band with gold studs,
//           a carnelian / turquoise cell band, teardrop pendants) with a jackal
//           cartouche on the back of the wrist, a dented armlet higher up, a lapis
//           scarab ring, and Egyptian gold finger stalls ending in hooked claws;
//   runes   a column of faint spirit-blue hieroglyphs down the back of the
//           forearm (GLOW: they wake with the material's emissive strength).
// Rig: `forearm` (root, pivot at the elbow end, +Y up the arm, the palm side is +Z)
// → `palm` (pivot at the wrist; rotation.x flexes the hand toward the palm)
// → fingers f1 (index) … f4 (little) × 3 phalanges `fN_1..3`, thumb `t_1..3`,
// each pivot at its knuckle; +rotation.x curls a finger into the palm.
// Sockets: `grip` (where a held soul sits, in front of the palm), `palm_c`
// (palm centre), `tip` (middle fingertip), `wrist_back` (the cartouche).
import { TRig, RigSpec, V3, VF, VoxelModel } from '../enemies/tk';

export const ANUBIS_ARM_VS = 1 / 20;

// ----------------------------------------------------------------------------- palette
const SKIN = { base: 0x17171f, shade: 0x0c0c12, hi: 0x2c2f46, rim: 0x3a3f5e };
const GOLD = { base: 0xd8a640, shade: 0xa87a26, hi: 0xf2cf72, dark: 0x6a4a12 };
const LAPIS = { base: 0x2d56a6, dark: 0x1c3670, hi: 0x4e72c4 };
const CARNELIAN = 0xa4402a;
const CARN_H = 0xc8603e;
const TURQ = 0x2f9a86;
const TURQ_H = 0x4fc0aa;
const RUNE = 0x5ad6de;
const NAILDARK = 0x3a2a10;
const M = VF.METAL;
const SKINMARK = 0x010101; // skin still to be shaded
const CREASE = 0x020202;

// ----------------------------------------------------------------------------- helpers
function h3(x: number, y: number, z: number, s = 0) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 1274126177) ^ Math.imul(s | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function vnoise(x: number, y: number, z: number, cell: number, s = 0) {
  const fx = x / cell, fy = y / cell, fz = z / cell;
  const ix = Math.floor(fx), iy = Math.floor(fy), iz = Math.floor(fz);
  const tx = fx - ix, ty = fy - iy, tz = fz - iz;
  const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty), sz = tz * tz * (3 - 2 * tz);
  const c = (a: number, b: number, d: number) => h3(ix + a, iy + b, iz + d, s);
  const l = (a: number, b: number, t: number) => a + (b - a) * t;
  return l(l(l(c(0, 0, 0), c(1, 0, 0), sx), l(c(0, 1, 0), c(1, 1, 0), sx), sy), l(l(c(0, 0, 1), c(1, 0, 1), sx), l(c(0, 1, 1), c(1, 1, 1), sx), sy), sz);
}
function mixc(a: number, b: number, t: number) {
  t = Math.max(0, Math.min(1, t));
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  return (Math.round(ar + (br - ar) * t) << 16) | (Math.round(ag + (bg - ag) * t) << 8) | Math.round(ab + (bb - ab) * t);
}
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const sstep = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
function smin(a: number, b: number, k: number) {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}
/** bound-ish ellipsoid distance (voxels) */
function sdEll(x: number, y: number, z: number, c: V3, r: V3) {
  const k = Math.hypot((x - c[0]) / r[0], (y - c[1]) / r[1], (z - c[2]) / r[2]);
  return (k - 1) * Math.min(r[0], r[1], r[2]);
}
/** capsule with a linearly tapering radius */
function sdCap(x: number, y: number, z: number, a: V3, b: V3, ra: number, rb: number) {
  const bx = b[0] - a[0], by = b[1] - a[1], bz = b[2] - a[2];
  const t = clamp(((x - a[0]) * bx + (y - a[1]) * by + (z - a[2]) * bz) / (bx * bx + by * by + bz * bz), 0, 1);
  return Math.hypot(x - a[0] - bx * t, y - a[1] - by * t, z - a[2] - bz * t) - lerp(ra, rb, t);
}

/**
 * Fill a part from a distance field over a box: the surface shell only (the inside
 * never shows), coloured by `paint` (it may return -1 to leave a voxel out).
 */
function carve(m: VoxelModel, box: [number, number, number, number, number, number], d: (x: number, y: number, z: number) => number, paint: (x: number, y: number, z: number, dd: number) => number | [number, number], shell = 2.6) {
  const [x0, y0, z0, x1, y1, z1] = box;
  for (let x = x0; x <= x1; x++)
    for (let y = y0; y <= y1; y++)
      for (let z = z0; z <= z1; z++) {
        const dd = d(x, y, z);
        if (dd > 0 || dd < -shell) continue;
        const c = paint(x, y, z, dd);
        if (typeof c === 'number') {
          if (c >= 0) m.set(x, y, z, c);
        } else m.set(x, y, z, c[0], c[1]);
      }
}

// ----------------------------------------------------------------------------- the forearm
const FL = 100; // elbow (0) to wrist (100)
const BOT = -26; // the buried end
function armR(y: number): [number, number] {
  const s = sstep(0.08, 1, y / FL);
  return [lerp(16.5, 10.4, s), lerp(13.6, 7.4, s)];
}
function forearmD(x: number, y: number, z: number) {
  const [rx, rz] = armR(y);
  const q = Math.hypot(x / rx, z / rz);
  let d = (q - 1) * Math.min(rx, rz);
  d = Math.max(d, BOT - y); // the buried end
  d = Math.max(d, y - (FL + 3));
  // muscle bellies of the upper forearm
  d = smin(d, sdEll(x, y, z, [-3, 30, 6.8], [11.5, 31, 8.6]), 5); // flexors (palm side)
  d = smin(d, sdEll(x, y, z, [2.5, 33, -6.8], [11.5, 29, 8.2]), 5); // extensors (back)
  d = smin(d, sdEll(x, y, z, [10, 22, 1.5], [8, 25, 9.5]), 4.5); // brachioradialis (thumb side)
  d = smin(d, sdCap(x, y, z, [10, 42, 2], [9.4, 92, 2.4], 4.6, 2.3), 3.2); // its tendon down to the radius
  d = smin(d, sdCap(x, y, z, [-10.4, BOT, -3.6], [-9.2, 95, -1.8], 2.8, 2.3), 2.6); // the ulna ridge
  d = smin(d, sdEll(x, y, z, [10.6, 96, 0.6], [3.2, 3.4, 3.2]), 2); // radial styloid
  d = smin(d, sdEll(x, y, z, [-10, 95.5, -1.2], [3, 3.2, 3]), 2); // ulnar styloid
  for (const tx of [-3.6, 0.4, 4.4]) d = smin(d, sdCap(x, y, z, [tx, 60, 5.6], [tx * 0.8, 100, 6.9], 1.35, 1.15), 1.3); // inner-wrist tendons
  // veins on the back of the forearm
  d = smin(d, sdCap(x, y, z, [4, 46, -8.9], [1.2, 78, -7.6], 0.95, 0.85), 0.8);
  d = smin(d, sdCap(x, y, z, [1.2, 78, -7.6], [-3, 98, -6.2], 0.85, 0.8), 0.8);
  d += (vnoise(x, y, z, 7, 3) - 0.5) * 0.9;
  return d;
}

// the gold: wrist cuff and armlet (flared elliptic bands just proud of the skin)
const CUFF: [number, number] = [74, 96];
const ARMLET: [number, number] = [20, 31];
function bandD(x: number, y: number, z: number, y0: number, y1: number, proud: number, flare: number) {
  if (y < y0 - 2 || y > y1 + 2) return 99;
  const v = (y - y0) / (y1 - y0);
  const [rx, rz] = armR(y);
  const f = flare * (1 - v); // flares toward the elbow
  const RX = rx + proud + f, RZ = rz + proud + f * 0.8;
  const q = Math.hypot(x / RX, z / RZ);
  const dRad = (q - 1) * Math.min(RX, RZ);
  const dY = Math.max(y0 - y, y - y1);
  return Math.max(dRad, dY);
}

// a recumbent jackal over a lapis cartouche (relief mask, 1 = gold, 2 = lapis field)
const JACKAL = [
  '....................',
  '..X.X...............',
  '..XXX...............',
  '.XXXXX..............',
  'XXXXXXX.............',
  '...XXXX.............',
  '...XXXXXXXXXXXXXX...',
  '...XXXXXXXXXXXXXXXX.',
  '..XXXXXXXXXXXXXXXXXX',
  '..XX.XX........XX.XX',
  '....................',
];
// spirit glyphs for the rune column (ankh, was, djed, eye, feather)
const GLYPHS: string[][] = [
  ['.XXX.', 'X...X', 'X...X', '.XXX.', 'XXXXX', '..X..', '..X..', '..X..'],
  ['XX...', '.X...', '.XXX.', '..X..', '..X..', '..X..', '..X..', '.X.X.'],
  ['XXXXX', '..X..', 'XXXXX', '..X..', 'XXXXX', '..X..', '..X..', '.XXX.'],
  ['.....', '.XXXX', 'X.XX.', '.XXXX', '..X..', '..XX.', '...X.', '.....'],
  ['..XX.', '.XXX.', '.XXX.', 'XXXX.', 'XXX..', 'XX...', 'X....', 'X....'],
];

// ----------------------------------------------------------------------------- the hand
const WR = FL; // wrist y
const KN = 131; // knuckle line
function palmD(x: number, y: number, z: number) {
  const yy = y - WR;
  const s = sstep(0, 22, yy);
  let hw = lerp(10.8, 15.2, s);
  if (yy > 27) hw -= (yy - 27) * 0.9;
  if (x < 0 && yy > 20) hw -= (yy - 20) * 0.12; // the little-finger edge curves in
  const back = -4.9 - 0.8 * sstep(6, 26, yy);
  const cup = 1.4 * Math.max(0, 1 - ((x / 8) ** 2 + ((yy - 16) / 10) ** 2));
  const front = 4.2 - cup + (yy < 8 ? 0.8 : 0);
  const zc = (front + back) / 2, hz = (front - back) / 2;
  const ux = x / hw, uz = (z - zc) / hz;
  // superellipse slab, rounded off along y
  let d = (Math.pow(Math.abs(ux) ** 4 + Math.abs(uz) ** 2, 0.25) - 1) * Math.min(hw, hz);
  d = Math.max(d, -yy - 1, yy - (KN - WR + 1.5 - (x * x) / 90 - (x < 0 ? (-x / 15) * 2.4 : 0)));
  d = smin(d, sdEll(x, y, z, [10, WR + 9, 2.6], [6.4, 8.6, 3.4]), 2.6); // thenar pad
  d = smin(d, sdEll(x, y, z, [-9, WR + 10, 2.1], [5.2, 9.6, 3]), 2.4); // hypothenar
  d = smin(d, sdEll(x, y, z, [0, WR + 2, 0.8], [11, 3.6, 5]), 2.2); // heel
  for (const kx of [10, 3.4, -3.6, -10]) {
    d = smin(d, sdEll(x, y, z, [kx, KN - 1.4, -5.1], [3.2, 2.5, 2.1]), 1.6); // knuckles
    d = smin(d, sdEll(x, y, z, [kx, KN - 1, 3.3], [3.1, 2.1, 1.9]), 1.6); // pads under the fingers
    d = smin(d, sdCap(x, y, z, [kx * 0.32, WR + 3, -5.4], [kx * 0.95, KN - 3, -6], 0.85, 0.75), 0.9); // tendons on the back
  }
  d += (vnoise(x, y, z, 5, 9) - 0.5) * 0.5;
  return d;
}

interface Finger {
  n: string;
  x: number;
  y: number;
  w: number;
  L: [number, number, number];
  rest: V3[];
}
const FINGERS: Finger[] = [
  { n: 'f1', x: 10, y: KN - 1, w: 3.6, L: [13, 9.5, 8.5], rest: [[0.1, 0, -0.06], [0.16, 0, 0], [0.12, 0, 0]] },
  { n: 'f2', x: 3.4, y: KN, w: 3.75, L: [14.5, 10.5, 9], rest: [[0.08, 0, -0.01], [0.15, 0, 0], [0.12, 0, 0]] },
  { n: 'f3', x: -3.6, y: KN - 0.6, w: 3.5, L: [13.5, 10, 8.5], rest: [[0.11, 0, 0.04], [0.17, 0, 0], [0.13, 0, 0]] },
  { n: 'f4', x: -10, y: KN - 3.6, w: 3.05, L: [10.5, 8, 7], rest: [[0.15, 0, 0.13], [0.2, 0, 0], [0.15, 0, 0]] },
];
const FZ = -0.6; // finger axis depth
const THUMB: V3[] = [[12.5, WR + 7, 1.6], [18.5, WR + 15, 4.4], [22, WR + 22.5, 6], [23.8, WR + 29, 6.6]];

/** gold finger stall over the last phalanx, ending in a hooked claw (curving toward the palm, +Z) */
function stall(m: VoxelModel, a: V3, b: V3, r: number, claw: number) {
  const dir: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const L = Math.hypot(dir[0], dir[1], dir[2]);
  const u: V3 = [dir[0] / L, dir[1] / L, dir[2] / L];
  const tip: V3 = [b[0] + u[0] * claw, b[1] + u[1] * claw, b[2] + u[2] * claw + claw * 0.55];
  const pad = Math.ceil(r + claw + 3);
  const box: [number, number, number, number, number, number] = [
    Math.floor(Math.min(a[0], tip[0]) - pad), Math.floor(Math.min(a[1], tip[1]) - pad), Math.floor(Math.min(a[2], tip[2]) - pad),
    Math.ceil(Math.max(a[0], tip[0]) + pad), Math.ceil(Math.max(a[1], tip[1]) + pad), Math.ceil(Math.max(a[2], tip[2]) + pad),
  ];
  const s0: V3 = [a[0] + u[0] * 1.2, a[1] + u[1] * 1.2, a[2] + u[2] * 1.2];
  const D = (x: number, y: number, z: number) => {
    let d = sdCap(x, y, z, s0, b, r + 0.55, r * 0.82);
    // the claw: a tapering hook out of the stall's tip
    d = smin(d, sdCap(x, y, z, b, [b[0] + u[0] * claw * 0.55, b[1] + u[1] * claw * 0.55, b[2] + u[2] * claw * 0.55 + claw * 0.12], r * 0.78, r * 0.45), 1);
    d = Math.min(d, sdCap(x, y, z, [b[0] + u[0] * claw * 0.55, b[1] + u[1] * claw * 0.55, b[2] + u[2] * claw * 0.55 + claw * 0.12], tip, r * 0.45, 0.35));
    return d;
  };
  carve(m, box, D, (x, y, z) => {
    // along the finger: a raised rim at the base, engraved nail outline on the back, darker hook point
    const t = ((x - a[0]) * u[0] + (y - a[1]) * u[1] + (z - a[2]) * u[2]) / L;
    if (t > 1.15) return [t > 1.45 ? NAILDARK : GOLD.shade, M];
    if (t < 0.16) return [GOLD.hi, M];
    const back = z < a[2] + (b[2] - a[2]) * t - r * 0.35;
    if (back && t > 0.35 && t < 0.98) {
      const lx = x - (a[0] + u[0] * L * t);
      if (Math.abs(Math.abs(lx) - r * 0.55) < 0.6 || (t > 0.94 && t < 0.98)) return [GOLD.dark, M]; // the engraved nail
      return [GOLD.hi, M];
    }
    return [t > 0.5 ? GOLD.base : mixc(GOLD.base, GOLD.hi, 0.3), M];
  }, 2.2);
}

// ----------------------------------------------------------------------------- build
let cache: RigSpec | null = null;

export function anubisArmRig(): RigSpec {
  if (cache) return cache;
  const rig = new TRig('anubis_arm', ANUBIS_ARM_VS);

  // ------------------------------------------------------------------ forearm, armlet, cuff
  const fa = rig.part('forearm', undefined, [0.5, 0, 0.5]);
  const runeCells = new Set<string>();
  {
    // the rune column: glyph masks stacked down the back of the forearm (-Z)
    for (let g = 0; g < 5; g++) {
      const mask = GLYPHS[(g * 3) % GLYPHS.length];
      const gy = 66 - g * 10;
      mask.forEach((row, ry) => [...row].forEach((ch, rx) => ch === 'X' && runeCells.add(`${rx - 2 + (g % 2 ? 1 : -1)},${gy - ry}`)));
    }
  }
  const armD = (x: number, y: number, z: number) => Math.min(forearmD(x, y, z), bandD(x, y, z, CUFF[0], CUFF[1], 2.1, 2.6), bandD(x, y, z, ARMLET[0], ARMLET[1], 1.6, 0.8));
  carve(fa, [-24, BOT, -21, 24, FL + 4, 21], armD, (x, y, z) => {
    const dSkin = forearmD(x, y, z);
    const dCuff = bandD(x, y, z, CUFF[0], CUFF[1], 2.1, 2.6);
    const dLet = bandD(x, y, z, ARMLET[0], ARMLET[1], 1.6, 0.8);
    if (dCuff < dSkin - 0.2 && dCuff <= dLet) return cuffPaint(x, y, z);
    if (dLet < dSkin - 0.2) return armletPaint(x, y, z);
    // spirit runes on the back of the forearm
    if (z < -3 && runeCells.has(`${x},${y}`)) return [RUNE, VF.GLOW];
    return SKINMARK;
  }, 2.8);
  // the jackal cartouche on the back of the wrist cuff: a raised lapis field, the god in gold relief
  {
    const H = JACKAL.length, W = JACKAL[0].length;
    const cy0 = CUFF[0] + 5;
    for (let ry = -1; ry <= H; ry++)
      for (let rx = -1; rx <= W; rx++) {
        const x = Math.round(W / 2) - rx, y = cy0 + (H - 1 - ry);
        let z = -40;
        for (let zz = -26; zz <= 0; zz++)
          if (fa.has(x, y, zz)) {
            z = zz;
            break;
          }
        if (z <= -40) continue;
        const edge = ry < 0 || ry >= H || rx < 0 || rx >= W;
        const ch = edge ? '' : JACKAL[ry][rx];
        fa.set(x, y, z - 1, edge ? GOLD.hi : ch === 'X' ? GOLD.base : LAPIS.base, edge || ch === 'X' ? M : VF.SOLID);
        if (ch === 'X') fa.set(x, y, z - 2, (JACKAL[ry - 1]?.[rx] ?? '.') !== 'X' ? GOLD.hi : GOLD.base, M);
      }
  }
  // teardrop pendants hanging from the cuff's lower rim
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2 + 0.17;
    const [rx, rz] = armR(CUFF[0]);
    const R = 1 + 2.1 + 2.6;
    const px = Math.cos(a) * (rx + R - 0.6), pz = Math.sin(a) * (rz + R * 0.8 - 0.6);
    for (let k = 0; k < 5; k++) {
      const yy = CUFF[0] - 1 - k;
      const rr = k < 2 ? 0.6 : k < 4 ? 1.2 : 0.7;
      for (let dx = -2; dx <= 2; dx++)
        for (let dz = -2; dz <= 2; dz++) if (Math.hypot(dx, dz) <= rr + 0.2) fa.set(Math.round(px + dx), yy, Math.round(pz + dz), k === 3 ? (i % 2 ? CARNELIAN : TURQ) : k === 2 ? GOLD.hi : GOLD.base, k === 3 ? VF.SOLID : M);
    }
  }

  // ------------------------------------------------------------------ palm
  const palm = rig.part('palm', 'forearm', [0.5, WR, 0.5]);
  carve(palm, [-19, WR - 2, -9, 19, KN + 3, 9], palmD, () => SKINMARK, 2.6);
  // palm lines (creases on the front surface)
  const line = (pts: [number, number][]) => {
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
      const n = Math.ceil(Math.hypot(bx - ax, by - ay) * 1.5);
      for (let j = 0; j <= n; j++) {
        const t = j / n;
        const x = Math.round(ax + (bx - ax) * t), y = Math.round(ay + (by - ay) * t);
        for (let z = 9; z > -9; z--)
          if (palm.has(x, y, z)) {
            palm.set(x, y, z, CREASE);
            break;
          }
      }
    }
  };
  line([[-14, WR + 26], [-7, WR + 26.8], [0, WR + 28], [7, WR + 29.5]]); // heart line
  line([[-12, WR + 21], [-4, WR + 21.6], [3.5, WR + 22.6], [10, WR + 24.2]]); // head line
  line([[9, WR + 26], [5.6, WR + 20], [4, WR + 13], [5, WR + 6], [7.5, WR + 1.5]]); // life line
  line([[-0.5, WR + 4], [-0.2, WR + 12], [0.4, WR + 20]]); // fate line

  // ------------------------------------------------------------------ fingers
  for (const f of FINGERS) {
    let y0 = f.y;
    let parent = 'palm';
    for (let k = 0; k < 3; k++) {
      const name = `${f.n}_${k + 1}`;
      const m = rig.part(name, parent, [f.x + 0.5, y0, FZ + 0.5], f.rest[k]);
      const y1 = y0 + f.L[k];
      const r0 = f.w * (1 - k * 0.1), r1 = f.w * (1 - (k + 1) * 0.1);
      if (k < 2) {
        const D = (x: number, y: number, z: number) => {
          let d = sdCap(x, y, z, [f.x, y0 + 0.3, FZ], [f.x, y1 - 0.3, FZ], r0, r1);
          d = smin(d, sdEll(x, y, z, [f.x, (y0 + y1) / 2, FZ + r0 * 0.45], [r0 * 0.8, (y1 - y0) * 0.36, r0 * 0.62]), 1.2); // pad
          d = smin(d, sdEll(x, y, z, [f.x, y0 + 1, FZ - r0 * 0.5], [r0 * 0.78, 1.8, 1.6]), 1); // knuckle
          return d + (vnoise(x, y, z, 3, k * 5 + f.x) - 0.5) * 0.35;
        };
        carve(m, [Math.floor(f.x - r0 - 3), Math.floor(y0 - 2), Math.floor(FZ - r0 - 3), Math.ceil(f.x + r0 + 3), Math.ceil(y1 + 2), Math.ceil(FZ + r0 + 3)], D, (x, y, z) => {
          // joint creases: across the palm side near each end, wrinkles over the knuckle on the back
          const yr = y - y0;
          if (z > FZ + r0 * 0.3 && (Math.abs(yr - 1) < 0.5 || Math.abs(yr - (y1 - y0) + 0.8) < 0.5)) return CREASE;
          if (z < FZ - r0 * 0.4 && yr > 0.5 && yr < 3.5 && (yr | 0) % 2 === 0 && Math.abs(x - f.x) < r0 * 0.6) return CREASE;
          return SKINMARK;
        }, 2.2);
        if (k === 0 && f.n === 'f2') {
          // a gold ring with a lapis scarab bezel
          const ry = y0 + 5.5;
          for (let x = Math.floor(f.x - r0 - 2); x <= f.x + r0 + 2; x++)
            for (let z = Math.floor(FZ - r0 - 2); z <= FZ + r0 + 2; z++)
              for (let y = Math.floor(ry - 1); y <= ry + 1; y++) {
                const dd = Math.hypot(x - f.x, z - FZ);
                if (dd > r0 + 0.9 || dd < r0 - 0.5) continue;
                m.set(x, y, z, y === Math.round(ry) ? GOLD.hi : GOLD.base, M);
              }
          for (let x = -2; x <= 2; x++) for (let y = -2; y <= 2; y++) if (x * x * 0.8 + y * y * 0.5 <= 2.6) m.set(Math.round(f.x) + x, Math.round(ry) + y, Math.round(FZ - r0 - 1), Math.abs(x) + Math.abs(y) <= 1 ? LAPIS.hi : LAPIS.base);
        }
      } else {
        // the distal phalanx sits in its gold stall
        stall(m, [f.x, y0, FZ], [f.x, y1, FZ], r0, 3.4 + f.w * 0.4);
        const D = (x: number, y: number, z: number) => sdCap(x, y, z, [f.x, y0 + 0.2, FZ], [f.x, y0 + 1.6, FZ], r0 * 0.95, r0 * 0.95);
        carve(m, [Math.floor(f.x - r0 - 2), Math.floor(y0 - 2), Math.floor(FZ - r0 - 2), Math.ceil(f.x + r0 + 2), Math.ceil(y0 + 3), Math.ceil(FZ + r0 + 2)], D, (x, y, z) => (m.has(x, y, z) ? -1 : SKINMARK), 2);
      }
      parent = name;
      y0 = y1;
    }
  }
  // thumb: from the heel of the hand, out (+X) and forward (+Z)
  {
    let parent = 'palm';
    for (let k = 0; k < 3; k++) {
      const name = `t_${k + 1}`;
      const a = THUMB[k], b = THUMB[k + 1];
      const m = rig.part(name, parent, [a[0] + 0.5, a[1], a[2] + 0.5], k === 0 ? [0.05, 0, 0] : [0.1, 0, 0]);
      const r0 = 4.3 - k * 0.5, r1 = 4.3 - (k + 1) * 0.5;
      if (k < 2) {
        const D = (x: number, y: number, z: number) => {
          let d = sdCap(x, y, z, a, b, r0, r1);
          d = smin(d, sdEll(x, y, z, [(a[0] + b[0]) / 2 - 0.6, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2 + 1.6], [r0 * 0.7, 3.2, r0 * 0.55]), 1.2);
          return d + (vnoise(x, y, z, 3, 40 + k) - 0.5) * 0.35;
        };
        carve(m, [Math.floor(Math.min(a[0], b[0]) - 6), Math.floor(Math.min(a[1], b[1]) - 6), Math.floor(Math.min(a[2], b[2]) - 6), Math.ceil(Math.max(a[0], b[0]) + 6), Math.ceil(Math.max(a[1], b[1]) + 6), Math.ceil(Math.max(a[2], b[2]) + 6)], D, () => SKINMARK, 2.2);
      } else stall(m, a, b, r0, 3.8);
      parent = name;
    }
  }

  // ------------------------------------------------------------------ finish: banded light from smooth normals (no stair-step speckle)
  for (const p of rig.parts) smoothFinish(p.model);

  rig.socket('grip', 'palm', [0.5, WR + 17, 13]);
  rig.socket('palm_c', 'palm', [0.5, WR + 16, 5]);
  rig.socket('tip', 'f2_3', [3.9, KN + 34, FZ + 0.5]);
  rig.socket('wrist_back', 'forearm', [0.5, CUFF[0] + 10, -14]);
  cache = rig.build({
    kind: 'anubis_arm',
    /** elbow to the middle claw tip (m) */
    length: (KN + 34 + 6) * ANUBIS_ARM_VS,
    wrist: WR * ANUBIS_ARM_VS,
    knuckles: KN * ANUBIS_ARM_VS,
    curlAxis: 'x+',
  });
  return cache;
}

/** the wrist cuff's rows by height: rims, lapis studded band, cell band of carnelian and turquoise */
function cuffPaint(x: number, y: number, z: number): [number, number] {
  const v = (y - CUFF[0]) / (CUFF[1] - CUFF[0]);
  const a = Math.atan2(z, x);
  const circ = a * 18; // ~ voxel-ish units round the band
  if (v < 0.09 || v > 0.92) return [y === CUFF[0] || y === CUFF[1] ? GOLD.shade : GOLD.hi, M];
  if (v < 0.13 || (v > 0.86 && v <= 0.92)) return [GOLD.dark, M];
  if (v < 0.32) {
    // lapis with gold studs
    const stud = Math.abs(((circ % 6) + 6) % 6 - 3) < 0.9 && Math.abs(v - 0.225) < 0.05;
    return stud ? [GOLD.hi, M] : [v < 0.16 ? LAPIS.dark : LAPIS.base, VF.SOLID];
  }
  if (v < 0.36 || (v > 0.7 && v < 0.74)) return [GOLD.base, M];
  if (v <= 0.7) {
    // cells: carnelian / turquoise separated by raised gold dividers
    const cell = Math.floor(circ / 5);
    const inCell = ((circ % 5) + 5) % 5;
    if (inCell < 0.9) return [GOLD.hi, M];
    const c = cell % 2 ? CARNELIAN : TURQ;
    return [v > 0.62 ? c : cell % 2 ? CARN_H : TURQ_H, VF.SOLID];
  }
  return [v < 0.8 ? LAPIS.base : LAPIS.dark, VF.SOLID];
}
/** the armlet: plain beaten gold with two lapis lines, dented here and there */
function armletPaint(x: number, y: number, z: number): [number, number] {
  const v = (y - ARMLET[0]) / (ARMLET[1] - ARMLET[0]);
  if (Math.abs(v - 0.3) < 0.08 || Math.abs(v - 0.7) < 0.08) return [LAPIS.base, VF.SOLID];
  const dent = vnoise(x, y, z, 3, 51) > 0.74;
  return [dent ? GOLD.shade : v < 0.1 || v > 0.9 ? GOLD.hi : GOLD.base, M];
}

/**
 * Light the sculpt in a few clean bands: every voxel takes a smooth normal from a
 * blurred copy of the part (so curved stair-steps do not speckle), then skin falls
 * into shade / base / lit / rim tones and gold into shade / base / bright by how
 * much it faces the sky; deep creases (dense neighbourhoods) stay dark.
 */
function smoothFinish(m: VoxelModel) {
  if (!m.count) return;
  const b = m.bounds();
  const R = 2, pad = 3;
  const ox = b.minX - pad, oy = b.minY - pad, oz = b.minZ - pad;
  const nx = b.maxX - b.minX + 1 + pad * 2, ny = b.maxY - b.minY + 1 + pad * 2, nz = b.maxZ - b.minZ + 1 + pad * 2;
  let f = new Float32Array(nx * ny * nz);
  let tmp = new Float32Array(f.length);
  const id = (x: number, y: number, z: number) => x + nx * (y + ny * z);
  m.forEach((x, y, z) => (f[id(x - ox, y - oy, z - oz)] = 1));
  const dims = [nx, ny, nz], strides = [1, nx, nx * ny];
  for (let pass = 0; pass < 2; pass++)
    for (let axis = 0; axis < 3; axis++) {
      const n = dims[axis], st = strides[axis];
      const [a1, a2] = axis === 0 ? [1, 2] : axis === 1 ? [0, 2] : [0, 1];
      for (let i = 0; i < dims[a1]; i++)
        for (let j = 0; j < dims[a2]; j++) {
          const base = i * strides[a1] + j * strides[a2];
          let acc = 0;
          for (let k = 0; k <= R && k < n; k++) acc += f[base + k * st];
          for (let k = 0; k < n; k++) {
            tmp[base + k * st] = acc / (2 * R + 1);
            if (k + R + 1 < n) acc += f[base + (k + R + 1) * st];
            if (k - R >= 0) acc -= f[base + (k - R) * st];
          }
        }
      const t = f;
      f = tmp;
      tmp = t;
    }
  const at = (x: number, y: number, z: number) => f[id(x - ox, y - oy, z - oz)] ?? 0;
  const GOLDS = new Set([GOLD.base, GOLD.hi]);
  const todo: [number, number, number, number, number][] = [];
  m.forEach((x, y, z, c, fl) => {
    const skin = c === SKINMARK || c === CREASE;
    const gold = GOLDS.has(c);
    if (!skin && !gold) return;
    const gx = at(x - 1, y, z) - at(x + 1, y, z), gy = at(x, y - 1, z) - at(x, y + 1, z), gz = at(x, y, z - 1) - at(x, y, z + 1);
    const L = Math.hypot(gx, gy, gz) || 1;
    const nyv = gy / L;
    const side = Math.abs(gx / L) * 0.6 + Math.abs(gz / L) * 0.4;
    const dens = at(x, y, z);
    if (skin) {
      let v: number;
      if (c === CREASE || dens > 0.74) v = SKIN.shade;
      else if (nyv > 0.62) v = SKIN.rim;
      else if (nyv > 0.22) v = SKIN.hi;
      else if (nyv < -0.45) v = SKIN.shade;
      else v = side > 0.75 && nyv > 0 ? mixc(SKIN.base, SKIN.hi, 0.5) : SKIN.base;
      todo.push([x, y, z, v, fl & VF.GLOW ? fl : VF.SOLID]);
    } else {
      const v = nyv > 0.45 ? GOLD.hi : nyv < -0.4 || dens > 0.74 ? GOLD.shade : GOLD.base;
      todo.push([x, y, z, v, fl]);
    }
  });
  for (const [x, y, z, v, fl] of todo) m.set(x, y, z, v, fl);
}
