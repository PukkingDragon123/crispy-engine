// Main-menu set (menu only): the dusk camp on a dune crest, sculpted at high voxel density for close,
// cinematic framing.
//  - menuGround(): heights + materials for the menu Heightfield: a flat camp plateau on a dune crest,
//    a slip face falling away behind it, receding transverse dunes, eroded mesas and twin spires that
//    frame the setting sun.
//  - titleGate(): a weathered ranch gate whose top beam carries cut-out "dustUP" letters (Alagard
//    glyphs: bevelled, painted, chipped, bolted on iron feet), knee braces, iron straps, rope lashings,
//    a sagging beam and a lucky horseshoe.
//  - signpost() + arrowPlank(): the menu choices as split, knotty arrow boards with carved, painted
//    Alagard lettering and a sign-painter drop shadow. Letters carry the emissive flag (hover glow).
//  - firePit(), seatLog(), hurricaneLantern(), chain().
// Typography (Alagard) is the only thing rasterised; it is only used as a mask for 3D voxels.
import { VoxelModel, VF } from '../../../engine/voxel/VoxelModel';
import { noise, hash2, hash3, clamp, smoothstep, lerp } from '../../../engine/math/rand';
import { MAT } from '../../world/Heightfield';
import type { Ramp } from '../style';
import { mixRGB } from './helpers';

export type V3 = [number, number, number];
const ramp = (base: number, shade: number, hi: number, dark: number): Ramp => ({ base, shade, hi, dark });

const COL = {
  greyWood: ramp(0xa99b85, 0x897b66, 0xc8baa2, 0x5a5044),
  beam: ramp(0x8e6b4b, 0x705339, 0xab875f, 0x46321f),
  bark: ramp(0x5e3e28, 0x48301f, 0x765036, 0x2c1c12),
  drift: ramp(0xb39f86, 0x948168, 0xd0c0a6, 0x62564a),
  iron: ramp(0x5c5a57, 0x444240, 0x82807a, 0x2a2826),
  rust: ramp(0x9c5532, 0x7a4024, 0xbc6c40, 0x4e2614),
  rope: ramp(0xc9a76f, 0xa88850, 0xe2c48e, 0x7a5e34),
  bonePaint: ramp(0xf2e0ba, 0xd9c095, 0xfff4dc, 0xa88c64),
  redPaint: ramp(0xd5532d, 0xab3d21, 0xf27c44, 0x6e2412),
  sand: ramp(0xeac28a, 0xdcae70, 0xf6d6a2, 0xbc8e56),
  coal: ramp(0x2c2725, 0x1f1b1a, 0x3d3633, 0x141110),
  ash: ramp(0x8e8984, 0x75706b, 0xaaa59e, 0x55514d),
  ember: ramp(0xff7a24, 0xe0501a, 0xffb04a, 0x9a2a0c),
  enamel: ramp(0x3f5f7e, 0x2f4862, 0x5a7c9c, 0x1f3044),
  tin: ramp(0xa9a7a1, 0x86847e, 0xcfcdc6, 0x5c5a55),
  glass: ramp(0xffc874, 0xf0a850, 0xffe2a8, 0xc07a30),
};

// ============================================================================ ground
/** wind the menu's sand drifts with (scene space, normalised) */
export const MENU_WIND = { x: 0.95, z: -0.31 };

const smax = (a: number, b: number, k: number) => {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.max(a, b) + h * h * k * 0.25;
};
const soft = (v: number, k: number) => (v <= 0 ? 0 : v < k ? (v * v) / (2 * k) : v - k / 2);

interface Mesa {
  x: number;
  z: number;
  rx: number;
  rz: number;
  rot: number;
  h: number;
  spire?: boolean;
}
/** buttes and spires on the western horizon; the two spires frame the sunset */
const MESAS: Mesa[] = [
  { x: -124, z: -254, rx: 8.5, rz: 7, rot: 0.3, h: 56, spire: true },
  { x: -60, z: -236, rx: 10, rz: 8, rot: -0.4, h: 47, spire: true },
  { x: -98, z: -305, rx: 48, rz: 22, rot: 0.15, h: 33 },
  { x: 26, z: -292, rx: 58, rz: 26, rot: -0.1, h: 41 },
  { x: 152, z: -252, rx: 44, rz: 26, rot: 0.35, h: 31 },
  { x: 90, z: -178, rx: 11, rz: 9, rot: 0.8, h: 27, spire: true },
  { x: -196, z: -196, rx: 40, rz: 30, rot: 0.6, h: 34 },
  { x: -30, z: -330, rx: 90, rz: 14, rot: 0.02, h: 22 },
];

/** big transverse dunes, crests across the wind, slip faces downwind (taller with distance) */
function duneField(x: number, z: number) {
  const W = MENU_WIND;
  const u = x * W.x + z * W.z;
  const v = -x * W.z + z * W.x;
  const wu = u + noise.n2(x * 0.006, z * 0.006) * 22 + noise.n2(x * 0.021, z * 0.021) * 4;
  const wv = v + noise.n2(x * 0.007 + 7, z * 0.007 - 3) * 18;
  const lambda = 44 + 16 * noise.n2(x * 0.004 + 3, z * 0.004);
  const phase = wu / lambda + noise.n2(wv * 0.012, 3.1) * 0.55;
  const t = phase - Math.floor(phase);
  // convex windward back reaching a sharp brink, then a steep slip face
  const prof = t < 0.74 ? 1 - Math.pow(1 - t / 0.74, 1.8) : Math.pow(1 - (t - 0.74) / 0.26, 1.35);
  const crest = 0.55 + 0.45 * (noise.n2(wv * 0.016, Math.floor(phase) * 1.7) * 0.5 + 0.5);
  const dist = Math.hypot(x, z);
  const amp = (6 + 3 * noise.n2(x * 0.005 - 9, z * 0.005 + 4)) * (0.65 + Math.min(1.7, dist / 140));
  // small secondary dunes riding the big ones
  const small = Math.max(0, noise.ridged2(x * 0.045 + 11, z * 0.03 - 5, 2) - 0.55) * 1.6;
  return -14 + noise.fbm2(x / 160, z / 160, 3) * 3 + prof * crest * amp + small;
}

/** the camp plateau on the crest: flat top, rounded brink, slip face behind, long apron toward the camera */
function stageDune(x: number, z: number) {
  const zb = -3.1 + Math.sin(x * 0.21 + 0.6) * 0.5 + x * 0.05;
  const zf = 2.7;
  let h = noise.n2(x * 0.35, z * 0.35) * 0.035 + noise.n2(x * 0.9 + 3, z * 0.9) * 0.012;
  h += 0.16 * Math.exp(-((z - zb - 0.6) ** 2) / 0.7); // the lip of the crest under the gate
  h -= soft(zb - z, 1.3) * 0.68;
  h -= Math.pow(soft(z - zf, 2), 1.12) * 0.085;
  h -= Math.pow(soft(Math.abs(x) - 5.6, 2.5), 1.1) * (x > 0 ? 0.34 : 0.22);
  return h;
}

/** height (m, the camp plateau ≈ 0) and terrain material at scene position x,z */
export function menuGround(x: number, z: number, bounds: { x0: number; x1: number; z0: number; z1: number }): { h: number; mat: number } {
  const dune = duneField(x, z);
  let h = Math.abs(x) < 70 && Math.abs(z) < 70 ? smax(dune, stageDune(x, z), 2.5) : dune;
  let mat: number = dune < -12.4 && h < -11.5 ? MAT.SAND_DARK : MAT.SAND;
  for (const m of MESAS) {
    const dx = x - m.x, dz = z - m.z;
    const ext = Math.max(m.rx, m.rz) * 2 + 8;
    if (Math.abs(dx) > ext || Math.abs(dz) > ext) continue;
    const c = Math.cos(m.rot), s = Math.sin(m.rot);
    const lx = (dx * c - dz * s) / m.rx, lz = (dx * s + dz * c) / m.rz;
    const ang = Math.atan2(lz, lx);
    const wob = 1 + noise.n2(Math.cos(ang) * 1.3 + m.x * 0.1, Math.sin(ang) * 1.3 + m.z * 0.1) * 0.15 + noise.n2(Math.cos(ang) * 4 + m.z, Math.sin(ang) * 4) * 0.05;
    const e = Math.hypot(lx, lz) / wob;
    const wall = 1 - smoothstep(0.93, 1.0, e);
    const talus = 1 - smoothstep(1.0, 1.8, e);
    let prof: number;
    if (m.spire) prof = e < 0.55 ? 1 : e < 0.8 ? 0.8 - (e - 0.55) * 0.3 : 0.56;
    else prof = e < 0.72 ? 1 : 0.88;
    const top = -14 + m.h * (wall * prof + (1 - wall) * talus * talus * 0.3) + noise.n2(x * 0.09, z * 0.09) * 0.7 * wall;
    if (top > h) {
      h = top;
      mat = wall > 0.25 ? MAT.ROCK : MAT.RED_SAND;
    }
  }
  // the edge of the map rises into tall dunes (never a void at the horizon)
  const de = Math.min(x - bounds.x0, bounds.x1 - x, z - bounds.z0, bounds.z1 - z);
  if (de < 40) h = smax(h, -14 + (40 - de) * 0.9 + noise.n2(x * 0.03, z * 0.03) * 3, 4);
  return { h, mat };
}

// ============================================================================ helpers
/** rasterised Alagard text, cropped to its ink (used only as a mask for voxel letters) */
export interface Glyphs {
  w: number;
  h: number;
  /** x (from the left) where the second word starts, when split was asked for */
  split: number;
  on(x: number, y: number): boolean;
}
export function alagardMask(text: string, px: number, splitAt = 0): Glyphs {
  const cv = document.createElement('canvas');
  const c = cv.getContext('2d', { willReadFrequently: true })!;
  const font = `${px}px Alagard`;
  c.font = font;
  const W = Math.ceil(c.measureText(text).width) + 8, H = Math.ceil(px * 1.6) + 8;
  cv.width = W;
  cv.height = H;
  c.font = font;
  c.textBaseline = 'top';
  c.fillStyle = '#fff';
  c.fillText(text, 4, 4);
  const img = c.getImageData(0, 0, W, H).data;
  const raw = new Uint8Array(W * H);
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      if (img[(y * W + x) * 4 + 3] > 120) {
        raw[y * W + x] = 1;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  if (x1 < 0) return { w: 0, h: 0, split: 0, on: () => false };
  const split = splitAt > 0 ? Math.round(4 + c.measureText(text.slice(0, splitAt)).width) - x0 : 0;
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  return { w, h, split, on: (x, y) => x >= 0 && y >= 0 && x < w && y < h && raw[(y + y0) * W + x + x0] === 1 };
}

/** Chebyshev distance (1 = boundary pixel) of every ink pixel to the nearest empty pixel, capped */
function inkDepth(g: Glyphs, cap: number) {
  const d = new Uint8Array(g.w * g.h);
  for (let y = 0; y < g.h; y++)
    for (let x = 0; x < g.w; x++) {
      if (!g.on(x, y)) continue;
      let k = cap;
      for (let r = 1; r < cap && k === cap; r++)
        for (let j = -r; j <= r && k === cap; j++)
          for (let i = -r; i <= r; i++)
            if ((Math.abs(i) === r || Math.abs(j) === r) && !g.on(x + i, y + j)) {
              k = r;
              break;
            }
      d[y * g.w + x] = k;
    }
  return d;
}

/** 4-connected components of the ink (one per letter) */
function letterBlobs(g: Glyphs) {
  const id = new Int16Array(g.w * g.h).fill(-1);
  const blobs: { x0: number; x1: number; y0: number; y1: number; px: [number, number][] }[] = [];
  for (let y = 0; y < g.h; y++)
    for (let x = 0; x < g.w; x++) {
      if (!g.on(x, y) || id[y * g.w + x] >= 0) continue;
      const b = { x0: x, x1: x, y0: y, y1: y, px: [] as [number, number][] };
      const st: [number, number][] = [[x, y]];
      id[y * g.w + x] = blobs.length;
      while (st.length) {
        const [cx, cy] = st.pop()!;
        b.px.push([cx, cy]);
        b.x0 = Math.min(b.x0, cx);
        b.x1 = Math.max(b.x1, cx);
        b.y0 = Math.min(b.y0, cy);
        b.y1 = Math.max(b.y1, cy);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = cx + dx, ny = cy + dy;
          if (g.on(nx, ny) && id[ny * g.w + nx] < 0) {
            id[ny * g.w + nx] = blobs.length;
            st.push([nx, ny]);
          }
        }
      }
      blobs.push(b);
    }
  return blobs;
}

interface LogOpts {
  r0: number;
  r1: number;
  wood: Ramp;
  seed: number;
  bark?: Ramp;
  /** 0..1 share of the surface still wearing bark */
  barkAmt?: number;
  cracks?: number;
  /** sideways bow (voxels) at the middle */
  bend?: number;
  /** extra radius at the start (root flare) over this many voxels */
  flare?: number;
  /** 0..1 charring along the log (t = 0 at a, 1 at b) */
  char?: (t: number) => number;
  /** 0..1 glowing ember cracks along the log */
  glow?: (t: number) => number;
  /** splinter the b end */
  splinter?: boolean;
  /** skip voxels below this y (half-buried logs) */
  minY?: number;
}
/**
 * A weathered round log from a to b (voxel coords): irregular cross-section, long grain streaks,
 * bark patches with fissures, grooved cracks, end-grain rings, optional charring and glowing embers.
 */
function logSeg(m: VoxelModel, a: V3, b: V3, o: LogOpts) {
  const ax = b[0] - a[0], ay = b[1] - a[1], az = b[2] - a[2];
  const L = Math.hypot(ax, ay, az);
  const ux = ax / L, uy = ay / L, uz = az / L;
  // perpendicular basis p, q
  let hx = 0, hy = 1, hz = 0;
  if (Math.abs(uy) > 0.9) {
    hx = 1;
    hy = 0;
  }
  let px = uy * hz - uz * hy, py = uz * hx - ux * hz, pz = ux * hy - uy * hx;
  const pl = Math.hypot(px, py, pz);
  px /= pl;
  py /= pl;
  pz /= pl;
  const qx = uy * pz - uz * py, qy = uz * px - ux * pz, qz = ux * py - uy * px;
  const R = Math.max(o.r0, o.r1) + (o.flare ? o.flare * 0.4 : 0) + Math.abs(o.bend ?? 0) + 2;
  const crackA = Array.from({ length: o.cracks ?? 0 }, (_, i) => hash2(o.seed, i + 3) * Math.PI * 2);
  const bx0 = Math.floor(Math.min(a[0], b[0]) - R), bx1 = Math.ceil(Math.max(a[0], b[0]) + R);
  const by0 = Math.floor(Math.min(a[1], b[1]) - R), by1 = Math.ceil(Math.max(a[1], b[1]) + R);
  const bz0 = Math.floor(Math.min(a[2], b[2]) - R), bz1 = Math.ceil(Math.max(a[2], b[2]) + R);
  for (let x = bx0; x <= bx1; x++)
    for (let y = Math.max(by0, o.minY ?? -999); y <= by1; y++)
      for (let z = bz0; z <= bz1; z++) {
        const rx = x + 0.5 - a[0], ry = y + 0.5 - a[1], rz = z + 0.5 - a[2];
        const s = rx * ux + ry * uy + rz * uz;
        if (s < 0 || s > L) continue;
        const t = s / L;
        const bend = (o.bend ?? 0) * Math.sin(Math.PI * t);
        const vx = rx - ux * s - px * bend, vy = ry - uy * s - py * bend, vz = rz - uz * s - pz * bend;
        const dp = vx * px + vy * py + vz * pz, dq = vx * qx + vy * qy + vz * qz;
        const d = Math.hypot(dp, dq);
        const ang = Math.atan2(dq, dp);
        let r = lerp(o.r0, o.r1, t) * (1 + noise.n2(ang * 1.4 + o.seed, s * 0.06) * 0.07);
        if (o.flare && s < o.flare) r += (o.flare - s) * 0.4;
        if (d > r) continue;
        // splintered end: jagged teeth
        if (o.splinter && L - s < 5 && hash3(Math.round(ang * 3), o.seed, 7) * 5 > L - s + 0.5) continue;
        const surf = d > r - 1.3;
        const endA = s < 1.0, endB = L - s < 1.0 && !o.splinter;
        let c: number;
        let fl: number = VF.SOLID;
        if (endA || endB) {
          // end grain: growth rings and a dark pith
          const ring = Math.floor(d * 0.9 + noise.n2(ang * 2, o.seed) * 0.6);
          c = d < 1.2 ? o.wood.dark : d > r - 1 ? o.wood.shade : ring % 2 ? mixRGB(o.wood.hi, 0xe8d2a8, 0.35) : o.wood.base;
        } else {
          const g = noise.n2(ang * 2.6 + o.seed * 1.7, s * 0.016) + noise.n2(ang * 7 + o.seed, s * 0.05) * 0.35;
          c = g > 0.45 ? o.wood.hi : g < -0.78 ? o.wood.dark : g < -0.5 ? o.wood.shade : o.wood.base;
          if (surf && o.bark && o.barkAmt) {
            const bk = noise.n3(Math.cos(ang) * 1.3 + o.seed, Math.sin(ang) * 1.3, s * 0.045);
            if (bk > 1 - o.barkAmt * 2) {
              const fis = Math.abs(Math.sin(ang * 9 + noise.n2(s * 0.15, o.seed) * 2)) < 0.22;
              c = fis ? o.bark.dark : (Math.floor(s * 0.5) + Math.floor(ang * 4)) % 3 === 0 ? o.bark.shade : o.bark.base;
            }
          }
          if (surf)
            for (const ca of crackA) {
              let da = Math.abs(ang - ca);
              if (da > Math.PI) da = Math.PI * 2 - da;
              if (da * r < 0.9 && noise.n2(s * 0.05, ca * 3) > -0.25) {
                if (d > r - 0.8) c = -1;
                else c = o.wood.dark;
              }
            }
          // a knot or two
          const kn = hash2(Math.floor(s / 23), o.seed + 5);
          if (surf && kn > 0.62) {
            const ks = (Math.floor(s / 23) + 0.5) * 23, ka = (kn * 40) % (Math.PI * 2) - Math.PI;
            let da = Math.abs(ang - ka);
            if (da > Math.PI) da = Math.PI * 2 - da;
            const kd = Math.hypot((s - ks) / 2.6, (da * r) / 1.8);
            if (kd < 1) c = kd < 0.45 ? o.wood.dark : o.bark?.base ?? o.wood.shade;
          }
        }
        if (c < 0) continue;
        if (o.char) {
          const ch = o.char(t);
          if (ch > 0 && hash3(x, y, z) < ch * 1.15) c = hash3(x + 3, y, z) < 0.3 ? COL.coal.hi : surf ? COL.coal.base : COL.coal.shade;
        }
        if (o.glow && surf) {
          const gl = o.glow(t);
          if (gl > 0 && hash3(x, y + 9, z) < gl * 0.55) {
            c = hash3(x, y, z + 4) < 0.4 ? COL.ember.hi : COL.ember.base;
            fl = VF.EMISSIVE;
          }
        }
        m.set(x, y, z, c, fl);
      }
}

/** a twisted rope line, w voxels thick */
function ropeLine(m: VoxelModel, a: V3, b: V3, w = 2) {
  const L = Math.max(1, Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]));
  const n = Math.ceil(L * 1.6);
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t, z = a[2] + (b[2] - a[2]) * t;
    for (let u = 0; u < w; u++)
      for (let v = 0; v < w; v++) {
        const X = Math.round(x) + u, Y = Math.round(y) + v, Z = Math.round(z);
        const twist = (Math.round(t * L) + u + v) % 3;
        m.set(X, Y, Z, twist === 0 ? COL.rope.shade : twist === 1 ? COL.rope.base : COL.rope.hi);
      }
  }
}

/** windblown sand drift around a footing (voxel units), tail downwind (+x) */
function drift(m: VoxelModel, cx: number, cz: number, r: number, h: number, seed: number) {
  for (let x = -r; x <= Math.ceil(r * 1.6); x++)
    for (let z = -r; z <= r; z++) {
      const xx = x > 0 ? x / 1.6 : x;
      const d = Math.hypot(xx, z) / r;
      if (d > 1) continue;
      const top = Math.round(h * Math.pow(1 - d, 1.6) + noise.n2((cx + x) * 0.2, (cz + z) * 0.2 + seed) * 0.6);
      for (let y = 0; y < top; y++) {
        const X = cx + x, Z = cz + z;
        if (m.has(X, y, Z)) continue;
        const rip = Math.sin((X + Z * 0.3) * 0.9) > 0.6;
        m.set(X, y, Z, y === top - 1 ? (rip ? COL.sand.hi : COL.sand.base) : COL.sand.shade);
      }
    }
}

// ============================================================================ title gate
export interface TitleGate {
  model: VoxelModel;
  voxelSize: number;
  /** hang points (metres; gate space: x centred, y from the ground, z through the beam) */
  skullHook: V3;
  lanternHooks: V3[];
  /** top of the letters (m) */
  top: number;
}

export function titleGate(text = 'dustUP', split = 4): TitleGate {
  const vs = 1 / 48;
  const m = new VoxelModel('menu_title_gate');
  const PX = 112, BY0 = 148, BY1 = 160, BZ0 = -6, BZ1 = 5, BX = 138;
  const sag = (x: number) => Math.round(1.8 * (1 - (x / BX) ** 2));
  // ---- posts: weathered round logs with bark remnants, a bow and a lean
  logSeg(m, [-PX, -2, 0], [-PX - 3, 176, 1], { r0: 7.6, r1: 6.3, wood: COL.greyWood, bark: COL.bark, barkAmt: 0.28, cracks: 3, bend: 1.4, flare: 9, seed: 11 });
  logSeg(m, [PX, -2, 0], [PX + 2, 179, -1], { r0: 7.4, r1: 6.1, wood: COL.greyWood, bark: COL.bark, barkAmt: 0.2, cracks: 2, bend: -1.2, flare: 8, seed: 23 });
  // a broken branch stub on the left post
  logSeg(m, [-PX - 5, 92, 2], [-PX - 15, 100, 6], { r0: 2.4, r1: 1.2, wood: COL.greyWood, bark: COL.bark, barkAmt: 0.5, seed: 31, splinter: true });
  // ---- knee braces
  logSeg(m, [-PX + 5, 102, 0], [-PX + 46, BY0 - 1, 0], { r0: 3.2, r1: 2.8, wood: COL.greyWood, cracks: 1, seed: 41 });
  logSeg(m, [PX - 5, 104, 0], [PX - 45, BY0 - 1, 0], { r0: 3.1, r1: 2.8, wood: COL.greyWood, cracks: 1, seed: 43 });
  // ---- hewn top beam with a tired sag, arris worn round, adze scallops, cracks and end grain
  for (let x = -BX; x < BX; x++) {
    const sg = sag(x);
    for (let y = BY0; y <= BY1; y++)
      for (let z = BZ0; z <= BZ1; z++) {
        const ey = y === BY0 || y === BY1, ez = z === BZ0 || z === BZ1;
        if (ey && ez && hash3(x, y, z) < 0.75) continue;
        const endD = BX - Math.abs(x + 0.5);
        if (endD < 3 && hash3(x, y, z + 1) * 3 > endD) continue;
        let c: number;
        if (endD < 1.5) {
          const d = Math.hypot(y - (BY0 + BY1) / 2, z - (BZ0 + BZ1) / 2);
          c = Math.floor(d * 1.1) % 2 ? COL.beam.hi : COL.beam.base;
        } else {
          const band = Math.floor((y * 1.0 + z * 0.7 + noise.n2(x * 0.015, y * 0.4 + z * 0.3) * 2.2) / 1.7);
          const hv = hash2(band, Math.floor(x / 70));
          c = hv < 0.22 ? COL.beam.shade : hv > 0.84 ? COL.beam.hi : COL.beam.base;
          if (z === BZ1 && Math.abs(Math.sin(x * 0.35)) < 0.18 && y > BY0 + 1 && y < BY1 - 1) c = mixRGB(c, COL.beam.shade, 0.6);
          if (y === BY1 && !ez) c = mixRGB(c, COL.beam.hi, 0.45); // sun-bleached top
          if (y === BY0) c = mixRGB(c, COL.beam.dark, 0.35);
        }
        // two long cracks on the front face
        if (z === BZ1) {
          const c1 = x > -98 && x < -26 && y === BY0 + 4 + Math.round(Math.sin(x * 0.07) * 1.2);
          const c2 = x > 16 && x < 104 && y === BY0 + 8 + Math.round(Math.sin(x * 0.05 + 1) * 1.3);
          if (c1 || c2) continue;
        }
        if (z === BZ1 - 1) {
          const c1 = x > -98 && x < -26 && y === BY0 + 4 + Math.round(Math.sin(x * 0.07) * 1.2);
          const c2 = x > 16 && x < 104 && y === BY0 + 8 + Math.round(Math.sin(x * 0.05 + 1) * 1.3);
          if (c1 || c2) c = COL.beam.dark;
        }
        m.set(x, y - sg, z, c);
      }
  }
  // ---- iron straps with rivets and rust
  for (const sx of [-PX + 18, -46, 46, PX - 20]) {
    for (let x = sx; x < sx + 3; x++) {
      const sg = sag(x);
      for (let y = BY0 - 1; y <= BY1 + 1; y++)
        for (let z = BZ0 - 1; z <= BZ1 + 1; z++) {
          if (y !== BY0 - 1 && y !== BY1 + 1 && z !== BZ0 - 1 && z !== BZ1 + 1) continue;
          const rust = hash3(x, y, z) < 0.22;
          m.set(x, y - sg, z, rust ? COL.rust.base : x === sx + 1 ? COL.iron.base : COL.iron.shade, rust ? VF.SOLID : VF.METAL);
        }
    }
    const sg = sag(sx + 1);
    for (const ry of [BY0 + 3, BY1 - 3]) m.set(sx + 1, ry - sg, BZ1 + 2, COL.iron.hi, VF.METAL);
    // rust weeping down from the strap
    for (let k = 1; k < 5; k++) if (hash2(sx, k) < 0.7) m.set(sx + (k % 2), BY0 - 1 - k - sg, BZ1, mixRGB(COL.rust.shade, COL.beam.base, k / 5));
  }
  // ---- rope lashings where the beam meets the posts
  for (const px of [-PX, PX]) {
    const sg = sag(px);
    ropeLine(m, [px - 10, BY0 - 7 - sg, BZ1 + 1], [px + 9, BY1 + 5 - sg, BZ1 + 1]);
    ropeLine(m, [px - 10, BY1 + 5 - sg, BZ1 + 1], [px + 9, BY0 - 7 - sg, BZ1 + 1]);
    for (let y = BY0 - 13; y < BY0 - 3; y += 3)
      for (let a = 0; a < 40; a++) {
        const th = (a / 40) * Math.PI * 2;
        const r = 8.4;
        m.set(px + Math.round(Math.cos(th) * r), y - sg + (a % 2), Math.round(Math.sin(th) * r), a % 3 ? COL.rope.base : COL.rope.shade);
      }
  }
  // ---- the lucky horseshoe (opening up) nailed at the centre of the beam
  {
    const cy = BY0 + 5 - sag(0);
    for (let dx = -6; dx <= 5; dx++)
      for (let dy = -6; dy <= 6; dy++) {
        const d = Math.hypot(dx + 0.5, dy + 0.5);
        const arm = dy >= 0 && Math.abs(dx + 0.5) > 2.6 && Math.abs(dx + 0.5) < 5.6;
        if (!((d > 2.9 && d < 5.7 && dy < 0) || arm)) continue;
        const nailHole = (dy === -4 && Math.abs(dx + 0.5) > 2) || (dy === 2 && arm && hash2(dx, 4) < 0.6);
        m.set(dx, cy + dy, BZ1 + 1, nailHole ? COL.iron.dark : dy > 3 ? COL.iron.hi : COL.iron.base, VF.METAL);
      }
  }
  // ---- hooks under the beam
  const hook = (hx: number, hz: number) => {
    const y0 = BY0 - 1 - sag(hx);
    for (let k = 0; k < 4; k++) m.set(hx, y0 - k, hz, COL.iron.shade, VF.METAL);
    m.set(hx + 1, y0 - 4, hz, COL.iron.base, VF.METAL).set(hx + 2, y0 - 3, hz, COL.iron.base, VF.METAL);
    return y0 - 4;
  };
  const skullY = hook(0, 0);
  const lhx = PX - 30;
  const lY = [hook(-lhx, 2), hook(lhx, 2)];
  // ---- the letters: cut-out boards, bevelled, painted, chipped, bolted on iron feet
  let g = alagardMask(text, 48, split);
  if (g.h < 30) g = alagardMask(text, 64, split);
  const depth = inkDepth(g, 4);
  const LX0 = -Math.floor(g.w / 2), LY0 = BY1 + 4;
  const LZ0 = -3, LZ1 = 3;
  for (let my = 0; my < g.h; my++)
    for (let mx = 0; mx < g.w; mx++) {
      if (!g.on(mx, my)) continue;
      const dd = depth[my * g.w + mx];
      const x = LX0 + mx, y = LY0 + (g.h - 1 - my);
      const second = g.split > 0 && mx >= g.split - 1;
      const P = second ? COL.redPaint : COL.bonePaint;
      const under = second ? COL.iron : COL.beam;
      const topEdge = !g.on(mx, my - 1), botEdge = !g.on(mx, my + 1);
      const sideEdge = !g.on(mx - 1, my) || !g.on(mx + 1, my);
      const chip = dd === 1 && hash2(x * 3, y * 5) < 0.09;
      const fade = (g.h - my) / g.h; // sun-bleached toward the top
      for (let z = LZ0; z <= LZ1; z++) {
        // bevel: boundary pixels are pulled back one voxel at the front and the back
        if (dd === 1 && (z === LZ1 || z === LZ0)) continue;
        let c: number;
        if (z === LZ1 || (dd === 1 && z === LZ1 - 1)) {
          // the painted face
          c = topEdge ? P.hi : botEdge ? P.shade : sideEdge ? mixRGB(P.base, P.shade, 0.35) : P.base;
          if (dd >= 2 && !second) c = mixRGB(c, P.hi, fade * 0.25);
          if (chip) c = hash2(x, y) < 0.5 ? under.shade : under.base;
          // paint worn thin in streaks (brush strokes)
          if (!chip && dd >= 2 && noise.n2(x * 0.5, y * 0.12) > 0.62) c = mixRGB(c, under.base, 0.35);
        } else c = z === LZ0 ? under.shade : under.base; // raw board / iron edge
        m.set(x, y, z, c, second && z !== LZ1 ? VF.METAL : VF.SOLID);
      }
    }
  // rust drips down the red letters, bolts and iron feet per letter
  const blobs = letterBlobs(g);
  for (const b of blobs) {
    if (b.px.length < 30) continue;
    const second = g.split > 0 && b.x0 >= g.split - 1;
    const inner = b.px.filter(([x, y]) => depth[y * g.w + x] >= 3);
    const pool = inner.length ? inner : b.px.filter(([x, y]) => depth[y * g.w + x] >= 2);
    const near = (tx: number, ty: number) => pool.reduce((best, p) => (Math.hypot(p[0] - tx, p[1] - ty) < Math.hypot(best[0] - tx, best[1] - ty) ? p : best), pool[0]);
    if (pool.length) {
      const cx = (b.x0 + b.x1) / 2;
      for (const ty of [b.y0 + (b.y1 - b.y0) * 0.22, b.y0 + (b.y1 - b.y0) * 0.8]) {
        const [bx, by] = near(cx, ty);
        const X = LX0 + bx, Y = LY0 + (g.h - 1 - by);
        m.set(X, Y, LZ1 + 1, COL.iron.hi, VF.METAL).set(X + 1, Y, LZ1 + 1, COL.iron.base, VF.METAL);
        m.set(X, Y - 1, LZ1 + 1, COL.iron.base, VF.METAL).set(X + 1, Y - 1, LZ1 + 1, COL.iron.shade, VF.METAL);
        if (second) for (let k = 2; k < 7; k++) if (g.on(bx, by + k) && hash2(bx, k) < 0.8) m.set(X, Y - k, LZ1, mixRGB(COL.rust.shade, COL.redPaint.shade, k / 8));
      }
    }
    // feet: iron brackets from the bottom of each letter down onto the beam (at the back)
    const bottom = b.px.filter(([, y]) => y === b.y1).map(([x]) => x);
    const fxs = bottom.length > 6 ? [Math.min(...bottom) + 2, Math.max(...bottom) - 2] : [Math.round((Math.min(...bottom) + Math.max(...bottom)) / 2)];
    for (const fx of fxs) {
      const X = LX0 + fx;
      const yb = BY1 + 1 - sag(X);
      for (let y = yb; y < LY0 + 3; y++) for (let x = X - 1; x <= X + 1; x++) m.set(x, y, LZ0 - 1, y === yb ? COL.iron.shade : COL.iron.base, VF.METAL);
      for (let z = LZ0 - 4; z < LZ0; z++) for (let x = X - 2; x <= X + 2; x++) m.set(x, yb, z, COL.iron.shade, VF.METAL);
    }
  }
  // ---- sand drifted around the post feet
  drift(m, -PX, 0, 15, 7, 1);
  drift(m, PX, 0, 14, 6, 2);
  return {
    model: m,
    voxelSize: vs,
    skullHook: [0.5 * vs, skullY * vs, 0.5 * vs],
    lanternHooks: [[(-lhx + 2.5) * vs, lY[0] * vs, 2.5 * vs], [(lhx + 2.5) * vs, lY[1] * vs, 2.5 * vs]],
    top: (LY0 + g.h) * vs,
  };
}

// ============================================================================ hanging hardware
/** a short iron chain hanging from its top link (1/96, pivot = top) */
export function chain(links = 4) {
  const vs = 1 / 96;
  const m = new VoxelModel('menu_chain');
  for (let i = 0; i < links; i++) {
    const cy = -4 - i * 6;
    for (let a = 0; a < 28; a++) {
      const th = (a / 28) * Math.PI * 2;
      const u = Math.round(Math.cos(th) * 2.4), v = Math.round(Math.sin(th) * 3.6);
      const c = Math.sin(th) > 0.3 ? COL.iron.hi : Math.sin(th) < -0.3 ? COL.iron.shade : COL.iron.base;
      if (i % 2 === 0) m.set(u, cy + v, 0, c, VF.METAL);
      else m.set(0, cy + v, u, c, VF.METAL);
    }
  }
  return { model: m, voxelSize: vs, length: (links * 6 + 2) * vs, pivot: [0.5, 0, 0.5] as V3 };
}

/** tin hurricane lantern: fuel fount, side air tubes, wire guard, amber globe, vented cap, bail (1/96, pivot = bail top) */
export function hurricaneLantern() {
  const vs = 1 / 96;
  const m = new VoxelModel('menu_lantern');
  const T = COL.tin, I = COL.iron;
  // fount
  for (let y = 0; y <= 6; y++)
    for (let x = -8; x <= 8; x++)
      for (let z = -8; z <= 8; z++) {
        const r = y === 0 || y === 6 ? 7.2 : 8.2;
        const d = Math.hypot(x + 0.5, z + 0.5);
        if (d > r) continue;
        const band = y === 3;
        m.set(x, y, z, band ? T.shade : y === 6 ? T.hi : hash3(x, y, z) < 0.12 ? COL.rust.base : T.base, VF.METAL);
      }
  // filler cap + wick knob
  m.box(4, 7, -1, 5, 8, 0, T.shade, VF.METAL);
  m.box(-1, 5, 8, 0, 6, 9, COL.iron.dark, VF.METAL);
  // collar
  for (let x = -6; x <= 6; x++) for (let z = -6; z <= 6; z++) if (Math.hypot(x + 0.5, z + 0.5) < 6.2) m.set(x, 7, z, T.dark, VF.METAL);
  // globe (glowing amber glass shell) with a flame inside
  for (let y = 8; y <= 25; y++) {
    const t = (y - 8) / 17;
    const r = 4.2 + Math.sin(t * Math.PI) * 2.6;
    for (let x = -8; x <= 8; x++)
      for (let z = -8; z <= 8; z++) {
        const d = Math.hypot(x + 0.5, z + 0.5);
        if (d > r || d < r - 1.2) continue;
        m.set(x, y, z, t > 0.15 && t < 0.75 ? (x + z > 2 ? COL.glass.hi : COL.glass.base) : COL.glass.shade, VF.EMISSIVE);
      }
  }
  for (let y = 11; y <= 15; y++) {
    const w = y < 14 ? 1 : 0;
    for (let x = -w; x <= 0; x++) for (let z = -w; z <= 0; z++) m.set(x, y, z, y > 13 ? 0xfff0c0 : 0xffc060, VF.GLOW);
  }
  // wire guard: four bowed wires
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
    for (let y = 8; y <= 26; y++) {
      const t = (y - 8) / 18;
      const r = 5.6 + Math.sin(t * Math.PI) * 2.8;
      m.set(Math.round(Math.cos(a) * r - 0.5), y, Math.round(Math.sin(a) * r - 0.5), I.shade, VF.METAL);
    }
  }
  for (const y of [16, 20]) for (let a = 0; a < 44; a++) {
    const th = (a / 44) * Math.PI * 2;
    const r = 5.6 + Math.sin(((y - 8) / 18) * Math.PI) * 2.8;
    m.set(Math.round(Math.cos(th) * r - 0.5), y, Math.round(Math.sin(th) * r - 0.5), I.base, VF.METAL);
  }
  // side air tubes from fount to cap
  for (const sx of [-10, 9]) {
    for (let y = 3; y <= 29; y++) m.set(sx, y, -1, T.base, VF.METAL).set(sx, y, 0, T.shade, VF.METAL);
    m.box(Math.min(sx, sx < 0 ? -8 : 8), 29, -1, Math.max(sx, sx < 0 ? -8 : 8), 29, 0, T.base, VF.METAL);
  }
  // vented cap
  for (let y = 26; y <= 31; y++) {
    const r = 7.4 - (y - 26) * 0.95;
    for (let x = -8; x <= 8; x++)
      for (let z = -8; z <= 8; z++) {
        const d = Math.hypot(x + 0.5, z + 0.5);
        if (d > r) continue;
        const vent = y === 28 && d > r - 1.2 && Math.floor(Math.atan2(z, x) * 3) % 2 === 0;
        m.set(x, y, z, vent ? COL.coal.base : y === 31 ? T.hi : T.base, VF.METAL);
      }
  }
  // bail handle
  for (let a = 0; a <= 30; a++) {
    const th = (a / 30) * Math.PI;
    m.set(Math.round(Math.cos(th) * 8.5 - 0.5), 30 + Math.round(Math.sin(th) * 9), 0, I.base, VF.METAL);
  }
  return { model: m, voxelSize: vs, pivot: [0.5, 40, 0.5] as V3, flame: [0, -26 * vs, 0] as V3 };
}

// ============================================================================ signpost
export interface Signpost {
  model: VoxelModel;
  voxelSize: number;
  /** z (m) of the front face, where the planks are nailed */
  faceZ: number;
  lanternHook: V3;
}
export function signpost(): Signpost {
  const vs = 1 / 48;
  const m = new VoxelModel('menu_signpost');
  const H = 148;
  for (let y = -2; y <= H; y++) {
    const sh = Math.round(y * 0.022);
    for (let x = -4; x <= 4; x++)
      for (let z = -4; z <= 4; z++) {
        const cx = Math.abs(x) === 4, cz = Math.abs(z) === 4;
        if (cx && cz && hash3(x, y >> 2, z) < 0.8) continue; // worn corners
        const face = cx || cz;
        const g = noise.n2(x * 0.7 + z * 0.9, y * 0.035) + noise.n2(x * 2 + z, y * 0.11) * 0.3;
        let c = g > 0.45 ? COL.greyWood.hi : g < -0.45 ? COL.greyWood.shade : COL.greyWood.base;
        if (face && y < 18) c = mixRGB(c, COL.sand.shade, (18 - y) / 30); // sand-scoured foot
        // vertical cracks on the front and right faces
        const crack = (z === 4 && x === 1 && y > 20 && y < 120 && noise.n2(y * 0.05, 1) > -0.3) || (x === 4 && z === -1 && y > 60 && y < 140);
        if (crack) continue;
        if ((z === 3 && x === 1 && y > 20 && y < 120) || (x === 3 && z === -1 && y > 60 && y < 140)) c = COL.greyWood.dark;
        m.set(x + sh, y, z, c);
      }
  }
  const top = Math.round(H * 0.022);
  // little gable cap: two slanted boards
  for (let k = 0; k < 8; k++)
    for (let z = -7; z <= 7; z++) {
      m.set(top - 7 + k, H + 1 + k, z, k === 7 ? COL.beam.hi : COL.beam.base);
      m.set(top + 7 - k, H + 1 + k, z, k === 7 ? COL.beam.hi : COL.beam.shade);
      m.set(top - 7 + k, H + k, z, COL.beam.shade);
      m.set(top + 7 - k, H + k, z, COL.beam.dark);
    }
  // rope wrap
  for (let y = 36; y < 44; y += 2)
    for (let x = -5; x <= 5; x++)
      for (let z = -5; z <= 5; z++) {
        if (Math.abs(x) !== 5 && Math.abs(z) !== 5) continue;
        m.set(x + Math.round(y * 0.022), y + ((x + z) & 1), z, (x + z + y) % 3 ? COL.rope.base : COL.rope.shade);
      }
  // lantern arm: an iron bracket out to the right with a hook
  const ay = 128, sh = Math.round(ay * 0.022);
  for (let x = 5; x <= 22; x++) m.set(x + sh, ay, 0, COL.iron.base, VF.METAL).set(x + sh, ay + 1, 0, COL.iron.shade, VF.METAL);
  for (let k = 0; k < 9; k++) m.set(5 + sh + k, ay - 9 + k, 0, COL.iron.shade, VF.METAL); // diagonal stay
  for (let k = 1; k <= 3; k++) m.set(21 + sh, ay - k, 0, COL.iron.base, VF.METAL);
  // base: drift and wedged stones
  drift(m, 0, 0, 13, 6, 5);
  for (const [sx, sz, r] of [[-7, 4, 3.2], [6, 5, 2.6], [-5, -6, 2.8]] as [number, number, number][])
    for (let x = -4; x <= 4; x++)
      for (let y = 0; y <= 3; y++)
        for (let z = -4; z <= 4; z++) {
          if (Math.hypot(x / r, (y - 0.5) / (r * 0.7), z / r) > 1 + noise.n3(x * 0.5 + sx, y * 0.5, z * 0.5) * 0.25) continue;
          m.set(sx + x, y, sz + z, y >= 2 ? 0xb4aa9c : hash3(x, y, z) < 0.3 ? 0x8a8278 : 0x9e968a);
        }
  return { model: m, voxelSize: vs, faceZ: 4.5 * vs, lanternHook: [(21.5 + sh) * vs, (ay - 3) * vs, 0.5 * vs] };
}

export interface ArrowPlank {
  model: VoxelModel;
  voxelSize: number;
  /** nail end, back face (build the mesh with this pivot) */
  pivot: V3;
  length: number;
  height: number;
}
/**
 * One menu choice: a split, knotty arrow board (1/96) with carved Alagard lettering painted on it and a
 * sign-painter drop shadow. Letters carry VF.EMISSIVE so the hover can light them up.
 */
export function arrowPlank(label: string, dir: 1 | -1, seed: number, wood: Ramp, ink: Ramp): ArrowPlank {
  const vs = 1 / 96;
  const m = new VoxelModel('menu_plank_' + label);
  const g = alagardMask(label, 32);
  const H = Math.max(34, g.h + 16), T = 6;
  const tip = Math.round(H * 0.46);
  const L = g.w + 26 + tip;
  const mid = (H - 1) / 2;
  const body0 = dir > 0 ? 0 : tip, body1 = dir > 0 ? L - tip : L;
  const tx0 = Math.round((body0 + body1 - g.w) / 2) + (dir > 0 ? -2 : 2);
  const ty0 = Math.round((H - g.h) / 2);
  const text = (x: number, y: number) => g.on(x - tx0, H - 1 - y - ty0);
  const knots = [0, 1].map((k) => ({ x: body0 + 10 + hash2(seed, k) * (body1 - body0 - 20), y: 4 + hash2(seed, k + 7) * (H - 8), on: hash2(seed, k + 3) < 0.7 }));
  const chipCorner = hash2(seed, 21) < 0.6;
  const crackY = Math.round(H * (0.25 + hash2(seed, 31) * 0.5));
  for (let x = 0; x < L; x++) {
    const e = dir > 0 ? L - 1 - x : x; // distance from the tip end
    const sq = dir > 0 ? x : L - 1 - x; // distance from the nailed end
    let hh = H / 2;
    if (e < tip) hh = Math.max(2.2, (H / 2) * ((e + 1.6) / tip)) + noise.n2(x * 0.4, seed) * 0.6;
    for (let y = 0; y < H; y++) {
      if (Math.abs(y - mid) > hh) continue;
      const edgeRow = Math.abs(y - mid) > hh - 1;
      if (edgeRow && hash2(x * 7 + seed, y) < 0.16) continue; // nicks along the edges
      if (sq < 2 && hash2(y + seed, sq) < 0.3) continue; // splintered sawn end
      if (chipCorner && sq < 6 && y > H - 7 && sq + (H - 1 - y) < 6) continue; // a chipped corner
      for (let z = 0; z < T; z++) {
        const front = z === T - 1;
        if (front && edgeRow && hash2(x, y + 50) < 0.55) continue; // worn front arris
        // wood: grain bands that bow around the knots
        let bow = 0;
        for (const k of knots) if (k.on) bow += 2.4 * Math.exp(-((x - k.x) ** 2) / 90 - ((y - k.y) ** 2) / 30) * Math.sign(y - k.y + 0.01);
        const yy = y + bow + 1.6 * Math.sin(x * 0.045 + seed) + noise.n2(x * 0.02, y * 0.3 + seed) * 1.2;
        const hv = hash2(Math.floor(yy / 2.6), seed);
        let c = hv < 0.25 ? wood.shade : hv > 0.82 ? wood.hi : wood.base;
        if (noise.n2(x * 0.008 + seed, y * 0.5) > 0.55) c = mixRGB(c, wood.dark, 0.35); // long dark streak
        for (const k of knots) {
          if (!k.on) continue;
          const kd = Math.hypot((x - k.x) / 3.4, (y - k.y) / 1.9);
          if (kd < 1) c = kd < 0.5 ? wood.dark : mixRGB(wood.shade, wood.dark, 0.5);
        }
        if (!front) c = z === 0 ? mixRGB(c, wood.dark, 0.3) : mixRGB(c, wood.shade, 0.5);
        else if (edgeRow) c = y > mid ? mixRGB(c, wood.hi, 0.6) : mixRGB(c, wood.dark, 0.3);
        // a crack running along the grain
        const crack = y === crackY + Math.round(Math.sin(x * 0.11 + seed) * 1.1) && sq > 4 && sq < L * 0.45;
        if (crack && front) continue;
        if (crack && z === T - 2) c = wood.dark;
        let fl: number = VF.SOLID;
        if (text(x, y)) {
          if (front) continue; // carved
          if (z === T - 2) {
            const chipped = hash2(x * 13, y * 7 + seed) < 0.04;
            c = chipped ? wood.shade : !text(x, y + 1) ? ink.hi : !text(x, y - 1) ? ink.shade : ink.base;
            if (!chipped) fl = VF.EMISSIVE;
          }
        } else if (front && text(x - 1, y + 1)) c = 0x2e1c10; // drop shadow
        m.set(x, y, z, c, fl);
      }
    }
  }
  // nails at the post end
  const nx = dir > 0 ? 7 : L - 8;
  for (const ny of [Math.round(mid) - 9, Math.round(mid) + 8]) {
    m.set(nx, ny, T, COL.iron.base, VF.METAL).set(nx + 1, ny, T, COL.iron.shade, VF.METAL).set(nx, ny + 1, T, COL.iron.hi, VF.METAL).set(nx + 1, ny + 1, T, COL.iron.base, VF.METAL);
    m.set(nx, ny - 1, T - 1, COL.rust.shade);
    m.set(nx + 1, ny - 2, T - 1, COL.rust.shade);
  }
  const pivot: V3 = [dir > 0 ? 3 : L - 3, mid + 0.5, 0];
  return { model: m, voxelSize: vs, pivot, length: L * vs, height: H * vs };
}

// ============================================================================ campfire
/** stone fire pit: sooty stones, ash bed with glowing coals, a charred teepee, feed logs, an enamel coffee pot (1/40, pivot bottom-centre) */
export function firePit() {
  const vs = 1 / 40;
  const m = new VoxelModel('menu_firepit');
  const N = 11;
  // stones
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2 + hash2(i, 1) * 0.3;
    const R = 17 + hash2(i, 2) * 2;
    const cx = Math.cos(a) * R, cz = Math.sin(a) * R;
    const rx = 4 + hash2(i, 3) * 2.2, ry = 3 + hash2(i, 4) * 2.2, rz = 3.6 + hash2(i, 5) * 1.8;
    const kind = hash2(i, 6);
    const base = kind < 0.4 ? ramp(0x9e978e, 0x7e776e, 0xbcb5aa, 0x56504a) : kind < 0.75 ? ramp(0xbf946a, 0x9c7652, 0xd8b088, 0x6a4a30) : ramp(0x6a625a, 0x544d46, 0x847b72, 0x38332e);
    for (let x = Math.floor(cx - rx - 1); x <= Math.ceil(cx + rx + 1); x++)
      for (let y = -1; y <= Math.ceil(ry * 1.6); y++)
        for (let z = Math.floor(cz - rz - 1); z <= Math.ceil(cz + rz + 1); z++) {
          const dx = x + 0.5 - cx, dy = y - 0.2, dz = z + 0.5 - cz;
          const e = (dx / rx) ** 2 + (dy / ry) ** 2 + (dz / rz) ** 2 + noise.n3(x * 0.35 + i * 7, y * 0.35, z * 0.35) * 0.3;
          if (e > 1) continue;
          if (dy > ry * 0.72 + noise.n2(x * 0.4, z * 0.4 + i) * 0.6) continue; // a weathered flat top
          let c = dy > ry * 0.45 ? base.hi : dy < 0 ? base.shade : base.base;
          if (hash3(x, y, z) < 0.12) c = base.shade;
          const inward = -(dx * Math.cos(a) + dz * Math.sin(a)) / rx;
          if (inward > -0.1) c = mixRGB(c, COL.coal.base, clamp(0.35 + inward * 0.6, 0, 0.85)); // soot
          m.set(x, y, z, c);
        }
  }
  // ash bed, coals
  for (let x = -14; x <= 14; x++)
    for (let z = -14; z <= 14; z++) {
      const d = Math.hypot(x + 0.5, z + 0.5);
      if (d > 14) continue;
      const hv = hash2(x * 3, z * 5);
      m.set(x, 0, z, hv < 0.2 ? COL.ash.shade : hv > 0.8 ? COL.ash.hi : COL.ash.base);
      if (d < 9.5) {
        const coal = hash2(x * 7, z * 11);
        const glow = d < 7 && coal < 0.55 - d * 0.04;
        m.set(x, 1, z, glow ? (coal < 0.15 ? COL.ember.hi : COL.ember.base) : coal < 0.5 ? COL.coal.base : COL.ash.shade, glow ? VF.EMISSIVE : VF.SOLID);
        if (d < 5 && coal < 0.4) m.set(x, 2, z, coal < 0.18 ? COL.ember.hi : COL.coal.hi, coal < 0.18 ? VF.EMISSIVE : VF.SOLID);
      }
    }
  // charred teepee
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.35;
    const R = 11 + hash2(i, 9) * 2;
    logSeg(m, [Math.cos(a) * R, 1, Math.sin(a) * R], [Math.cos(a + 0.25) * 1.5, 17 + hash2(i, 8) * 3, Math.sin(a + 0.25) * 1.5], {
      r0: 2.4, r1: 1.7, wood: ramp(0x9a7448, 0x7a5834, 0xb48c5c, 0x523a20), bark: COL.bark, barkAmt: 0.6, seed: 60 + i,
      char: (t) => smoothstep(0.2, 0.75, t), glow: (t) => smoothstep(0.45, 1, t), splinter: true,
    });
  }
  // feed logs across the ring, unburned ends sticking out
  logSeg(m, [24, 3, 9], [5, 2, 2], { r0: 2.9, r1: 2.6, wood: ramp(0xa47c50, 0x82603a, 0xc09564, 0x5a3e22), bark: COL.bark, barkAmt: 0.7, cracks: 1, seed: 71, char: (t) => smoothstep(0.55, 0.9, t), glow: (t) => smoothstep(0.75, 1, t) });
  logSeg(m, [-22, 3, 13], [-6, 2, 4], { r0: 2.6, r1: 2.3, wood: ramp(0xa47c50, 0x82603a, 0xc09564, 0x5a3e22), bark: COL.bark, barkAmt: 0.6, cracks: 1, seed: 73, char: (t) => smoothstep(0.6, 0.95, t), glow: (t) => smoothstep(0.8, 1, t) });
  // enamel coffee pot on the stones (speckled graniteware)
  {
    const px = 13, pz = 12, py = 5;
    for (let y = 0; y <= 11; y++) {
      const r = 5.2 - y * 0.18;
      for (let x = -6; x <= 6; x++)
        for (let z = -6; z <= 6; z++) {
          const d = Math.hypot(x + 0.5, z + 0.5);
          if (d > r) continue;
          const sp = hash3(x, y, z) < 0.13;
          const soot = y < 3 && hash3(x + 1, y, z) < 0.6 - y * 0.2;
          m.set(px + x, py + y, pz + z, soot ? COL.coal.hi : sp ? 0xe8eef2 : y === 11 ? COL.enamel.hi : x + z < -3 ? COL.enamel.shade : COL.enamel.base, VF.METAL);
        }
    }
    // domed lid + knob
    for (let y = 12; y <= 13; y++) for (let x = -4; x <= 4; x++) for (let z = -4; z <= 4; z++) if (Math.hypot(x + 0.5, z + 0.5) < 4.2 - (y - 12) * 1.6) m.set(px + x, py + y, pz + z, COL.enamel.hi, VF.METAL);
    m.box(px - 1, py + 14, pz - 1, px, py + 15, pz, COL.iron.dark, VF.METAL);
    // spout
    for (let k = 0; k < 7; k++) m.set(px - 5 - Math.round(k * 0.6), py + 3 + k, pz, COL.enamel.base, VF.METAL).set(px - 5 - Math.round(k * 0.6), py + 3 + k, pz - 1, COL.enamel.shade, VF.METAL);
    // handle
    for (let a = 0; a <= 14; a++) {
      const th = (a / 14) * Math.PI;
      m.set(px + 5 + Math.round(Math.sin(th) * 3.5), py + 3 + Math.round((1 - Math.cos(th)) * 4), pz, COL.iron.base, VF.METAL);
    }
  }
  // a poker stick leaning in
  logSeg(m, [-26, 0, -14], [-8, 9, -5], { r0: 1.1, r1: 0.9, wood: ramp(0x8a6a44, 0x6c5032, 0xa28058, 0x4a3420), seed: 80, char: (t) => smoothstep(0.8, 1, t), glow: (t) => smoothstep(0.9, 1, t) });
  return { model: m, voxelSize: vs, coffee: [13 * vs, 20 * vs, 12 * vs] as V3 };
}

// ============================================================================ seat log
/** a half-buried driftwood log with a folded saddle blanket where he sits (1/40, pivot bottom-centre) */
export function seatLog() {
  const vs = 1 / 40;
  const m = new VoxelModel('menu_seat_log');
  logSeg(m, [-34, 6.5, 0], [34, 6.5, 1], { r0: 7.6, r1: 6.4, wood: COL.greyWood, bark: COL.bark, barkAmt: 0.3, cracks: 4, bend: 2, flare: 6, seed: 91, minY: 0, splinter: true });
  // broken branch stubs
  logSeg(m, [-18, 11, -3], [-23, 19, -7], { r0: 2.4, r1: 1.2, wood: COL.greyWood, bark: COL.bark, barkAmt: 0.5, seed: 93, splinter: true });
  logSeg(m, [20, 9, 5], [26, 12, 12], { r0: 1.8, r1: 1.0, wood: COL.greyWood, seed: 95, splinter: true });
  // saddle blanket folded over the middle: woven stripes with a stepped diamond, tassels
  const cyl = 6.5;
  const stripes = [0xb8402c, 0xeadbb8, 0x2c2420, 0x3a9a9a, 0xeadbb8, 0xb8402c, 0xd8a050];
  for (let x = -11; x <= 10; x++) {
    for (let a = -26; a <= 26; a++) {
      const th = (a / 26) * (Math.PI * 0.62); // 0 = top of the log
      const r = 8.4 + Math.sin(x * 0.6) * 0.3;
      const y = Math.round(cyl + Math.cos(th) * r), z = Math.round(Math.sin(th) * r + 0.5);
      const s = Math.abs(a);
      const band = Math.floor((x + 11) / 3);
      let c = stripes[band % stripes.length];
      // stepped diamond in the centre panel
      if (Math.abs(x + 0.5) + s * 0.55 < 6.5 && Math.abs(x + 0.5) + s * 0.55 > 3.8) c = 0x2c2420;
      else if (Math.abs(x + 0.5) + s * 0.55 <= 3.8) c = 0xeadbb8;
      if (x === -11 || x === 10) c = 0x7a2a1c;
      const shade = Math.sin(th) > 0.55 ? 0.82 : Math.sin(th) < -0.55 ? 0.9 : 1;
      c = mixRGB(0x000000, c, shade);
      m.set(x, y, z, c, VF.SOFTAO);
      m.set(x, y - 1, z, mixRGB(0x000000, c, 0.75), VF.SOFTAO);
    }
    // tassels on both hanging edges
    if ((x & 1) === 0)
      for (const side of [-1, 1]) {
        const th = side * Math.PI * 0.62;
        const y = Math.round(cyl + Math.cos(th) * 8.4), z = Math.round(Math.sin(th) * 8.4 + 0.5);
        for (let k = 1; k <= 2; k++) m.set(x, y - k, z + side, 0xeadbb8, VF.SOFTAO);
      }
  }
  // sand drifted against the log (upwind side)
  for (let x = -36; x <= 36; x++)
    for (let z = -12; z <= -6; z++) {
      const h = Math.round((1 - (-6 - z) / 6) * 3 * (0.6 + noise.n2(x * 0.1, z * 0.2) * 0.4));
      for (let y = 0; y < h; y++) if (!m.has(x, y, z)) m.set(x, y, z, y === h - 1 ? COL.sand.base : COL.sand.shade);
    }
  return { model: m, voxelSize: vs, seatTop: (cyl + 8.4 + 1) * vs };
}
