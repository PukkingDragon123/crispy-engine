// Pixel-art leaf cards and bark tiles for the 3D plants (PlantKit, Trees, Foliage).
// Nothing here is a whole plant: every layer is one small part a pixel artist would
// paint for a sprite kit (a strip of palm leaflets, an acacia's bipinnate spray, a
// feathery tamarisk plume, a few grass blades, a reed blade, a papyrus umbel ray),
// which the plant builders then place, bend and orient in 3D around modelled stems.
// Bark tiles wrap round the sculpted trunks and stems and repeat along them.
// Every leaf is shaded with a hue-shifted ramp (cool shade, warm light), a lit upper
// half, a darker midrib, lighter tips and a selective dark outline. 64 x 128 texels
// per layer (u across the card, v along it), crisp nearest texels.
import * as THREE from 'three';

export const AW = 64;
export const AH = 128;
/** layer table */
export const L = {
  PALM: 0, PALM_DRY: 1, ACACIA: 2, ACACIA_BLOOM: 3, TAMA: 4, TAMA_PINK: 5, SCRUB: 6, SHRUB: 7, SHRUB_BLOOM: 8,
  TURF: 9, TURF_SEED: 10, DRY: 11, DRY_SEED: 12, REED: 13, PAPYRUS: 14, WILD: 15, WILD_B: 16, BARLEY: 17, FLAX: 18,
  WHEAT: 19, DEAD: 20,
  // bark / stem tiles (wrap round the tubes)
  B_PALM: 21, B_ACACIA: 22, B_TAMA: 23, B_STEM: 24, B_CATTAIL: 25, B_DATES: 26, B_RACHIS: 27, B_TWIG: 28, B_STRAW: 29,
} as const;
const LAYERS = 30;

const PAL = {
  palm: [0x14301f, 0x204a2c, 0x346a34, 0x4f8a3c, 0x78ab4a, 0xa8cc66],
  palmDry: [0x4a3620, 0x6e5230, 0x93743f, 0xb89656, 0xd8bc78, 0xeed8a0],
  palmBark: [0x2c1d14, 0x4a3220, 0x6a4a2e, 0x8a6840, 0xae8c5a, 0xcaa974],
  acacia: [0x1c2a18, 0x2e4222, 0x46602e, 0x64803a, 0x86a04a, 0xaec064],
  acaciaBark: [0x241a14, 0x3e2e22, 0x5c4432, 0x7c6046, 0x9c7e5c, 0xb89c78],
  tamarisk: [0x1e2c2a, 0x34483e, 0x506652, 0x6f846a, 0x93a586, 0xbcc6a4],
  tamBark: [0x2a1610, 0x4a2a1c, 0x6a3e28, 0x8a5636, 0xa87048, 0xc08a5c],
  pink: [0x6a2a48, 0x9a4a6c, 0xc8709a, 0xe6a2c2, 0xf8d0e2],
  scrub: [0x2a3024, 0x434c36, 0x5f6a4a, 0x7f8864, 0xa2a882, 0xc8c6a0],
  shrub: [0x10301c, 0x1c4a28, 0x2e6c34, 0x48903e, 0x6eb04c, 0x9cd066],
  turf: [0x173a1c, 0x24562a, 0x3a7a34, 0x58a040, 0x80c050, 0xb0dc70],
  dry: [0x5a4424, 0x7e6232, 0xa48444, 0xc4a65a, 0xdcc27a, 0xf0dca0],
  reed: [0x1e3a22, 0x2e5430, 0x46723c, 0x64904a, 0x88ac5c, 0xb0c878],
  cattail: [0x2a160c, 0x442414, 0x5e341c, 0x7a4626, 0x965c34, 0xb07a4a],
  dates: [0x4a1a0a, 0x7a2e12, 0xaa4c1c, 0xd0742a, 0xf0a446, 0xfac878],
  rachis: [0x4a4a22, 0x6a6a30, 0x8a8640, 0xaca456, 0xccc274, 0xe2da98],
  twig: [0x2e2620, 0x4a3e34, 0x66584a, 0x847462, 0xa49482, 0xc0b2a0],
};

// ---- deterministic hash / rng
function hsh(a: number, b: number, c: number) {
  let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ Math.imul(c | 0, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
class Rng {
  constructor(private s: number) {}
  next() {
    this.s = (this.s + 0x6d2b79f5) | 0;
    let t = Math.imul(this.s ^ (this.s >>> 15), 1 | this.s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a: number, b: number) {
    return a + (b - a) * this.next();
  }
}
const mulC = (c: number, k: number) => (Math.min(255, Math.round(((c >> 16) & 255) * k)) << 16) | (Math.min(255, Math.round(((c >> 8) & 255) * k)) << 8) | Math.min(255, Math.round((c & 255) * k));
const clampK = (r: number[], k: number) => r[Math.max(0, Math.min(r.length - 1, Math.round(k)))];

/** one layer: put(x, y, colour) in texels, y up (v along the card) */
class Pix {
  col = new Int32Array(AW * AH).fill(-1);
  constructor(private wrap = false) {}
  get(x: number, y: number) {
    if (this.wrap) x = ((x % AW) + AW) % AW;
    return x < 0 || y < 0 || x >= AW || y >= AH ? -1 : this.col[x + y * AW];
  }
  put(x: number, y: number, c: number) {
    x = Math.round(x);
    y = Math.round(y);
    if (this.wrap) {
      x = ((x % AW) + AW) % AW;
      y = ((y % AH) + AH) % AH;
    }
    // keep a clear 1-texel margin on cards so clamped edges never smear
    if (x < 1 || y < 0 || x >= AW - 1 || y >= AH - 1) {
      if (!this.wrap) return;
    }
    this.col[x + y * AW] = c;
  }
  line(x0: number, y0: number, x1: number, y1: number, c: number | ((t: number) => number)) {
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 2));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      this.put(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, typeof c === 'number' ? c : c(t));
    }
  }
  fill(c: (x: number, y: number) => number) {
    for (let y = 0; y < AH; y++) for (let x = 0; x < AW; x++) this.col[x + y * AW] = c(x, y);
  }
  /** selective outline: empty texels beside the shape (right / below by default) take a dark shade */
  outline(dark: number, sides: [number, number][] = [[-1, 0], [0, 1]]) {
    const add: number[] = [];
    for (let y = 0; y < AH; y++)
      for (let x = 1; x < AW - 1; x++) {
        if (this.get(x, y) >= 0) continue;
        for (const [dx, dy] of sides)
          if (this.get(x + dx, y + dy) >= 0) {
            add.push(x + y * AW);
            break;
          }
      }
    for (const o of add) this.col[o] = dark;
  }
}

interface LeafOpt {
  /** half-width profile over 0..1 of the length */
  sh?: (f: number) => number;
  rib?: boolean;
  /** bends the centreline sideways (texels at the tip) */
  curl?: number;
  /** from this fraction on the leaf takes `tipRamp` (dry tips) */
  tipFrom?: number;
  tipRamp?: number[];
}
const LANCE = (f: number) => Math.pow(Math.sin(Math.PI * Math.min(1, f * 0.92 + 0.08)), 0.7);
const OVATE = (f: number) => Math.pow(Math.sin(Math.PI * Math.min(1, f * 0.85 + 0.08)), 0.5) * (1 - f * 0.25);
const BLADE = (f: number) => Math.pow(1 - f, 0.75) * Math.min(1, 0.45 + f * 6);

/** a shaded leaf from (x0, y0) along `ang`: lit upper half, darker lower edge and midrib, light tip */
function leaf(P: Pix, x0: number, y0: number, ang: number, len: number, hw: number, ramp: number[], k0: number, o: LeafOpt = {}) {
  const ca = Math.cos(ang), sa = Math.sin(ang);
  const px = -sa, py = ca; // perpendicular; its +side faces up when ca > 0
  const top = py >= 0 ? 1 : -1;
  const sh = o.sh ?? LANCE;
  for (let s = 0; s <= len; s += 0.5) {
    const f = s / len;
    const w = hw * sh(f);
    const off = (o.curl ?? 0) * f * f;
    const r = o.tipRamp && f > (o.tipFrom ?? 1) ? o.tipRamp : ramp;
    for (let q = -w; q <= w + 0.01; q += 0.5) {
      let k = k0;
      const side = q * top;
      if (side > 0.4) k += 1;
      else if (side < -w * 0.55) k -= 1;
      if (o.rib && Math.abs(q) < 0.45 && f > 0.06 && f < 0.92) k -= 1;
      if (f > 0.84) k += 1;
      if (f < 0.08) k -= 1;
      P.put(x0 + ca * s + px * (q + off), y0 + sa * s + py * (q + off), clampK(r, k));
    }
  }
}

/** a curved blade from (bx, 0) to (tx, ty) bowing through the control point (cx, cy) */
function blade(P: Pix, bx: number, by: number, cx: number, cy: number, tx: number, ty: number, hw: number, ramp: number[], k0: number) {
  const len = Math.hypot(tx - bx, ty - by) * 1.1;
  const n = Math.ceil(len * 2);
  for (let i = 0; i <= n; i++) {
    const t = i / n, s = 1 - t;
    const x = s * s * bx + 2 * s * t * cx + t * t * tx, y = s * s * by + 2 * s * t * cy + t * t * ty;
    const dx = 2 * s * (cx - bx) + 2 * t * (tx - cx), dy = 2 * s * (cy - by) + 2 * t * (ty - cy);
    const dl = Math.hypot(dx, dy) || 1;
    const nx = -dy / dl, ny = dx / dl;
    const w = hw * BLADE(t) + 0.3;
    for (let q = -w; q <= w + 0.01; q += 0.5) {
      let k = k0 + (q * (ny >= 0 ? 1 : -1) > 0.3 ? 1 : 0) - (Math.abs(q) > w - 0.6 && q * (ny >= 0 ? 1 : -1) < 0 ? 1 : 0);
      if (t < 0.14) k -= 1;
      if (t > 0.8) k += 1;
      P.put(x + nx * q, y + ny * q, clampK(ramp, k));
    }
  }
}

// ------------------------------------------------------------------ leaf cards
/** palm leaflets on one side of the rachis (u = 0 is the spine), sweeping toward the frond tip */
function palmStrip(seed: number, dry: boolean) {
  const P = new Pix(), rng = new Rng(seed);
  const G = PAL.palm, D = PAL.palmDry;
  // petiole spines near the base
  for (let y = 3; y < 15; y += 3) P.line(1, y, 3 + rng.range(2, 5), y + 3, D[4]);
  for (const rank of [0, 1])
    for (let y = 13 + rank * 2.1; y < 123; y += 4.3) {
      const f = (y - 10) / 116;
      const env = Math.pow(Math.sin(Math.PI * Math.min(1, f * 0.94 + 0.05)), 0.55);
      const len = (14 + 52 * env) * rng.range(0.84, 1.04);
      const ang = 0.4 + rank * 0.17 + f * 0.28 + rng.range(-0.08, 0.08);
      const broken = dry && rng.next() < 0.3;
      leaf(P, 1, y, ang, broken ? len * 0.55 : len, 1.55, dry ? D : G, rank ? 3 : 2, { rib: true, curl: rng.range(-2, 3), tipFrom: dry ? 0.0 : rng.next() < 0.22 ? 0.78 : 1, tipRamp: D });
    }
  P.outline(mulC((dry ? D : G)[0], 0.62));
  return P;
}

/** an acacia's bipinnate spray: a rachis with paired pinnae combed with tiny leaflets */
function acaciaSpray(seed: number, bloom: boolean) {
  const P = new Pix(), rng = new Rng(seed);
  const A = PAL.acacia, B = PAL.acaciaBark;
  const ax = (y: number) => 32 + Math.sin(y * 0.045 + seed) * 2.5;
  for (let y = 0; y < 118; y++) P.put(ax(y), y, B[y < 40 ? 2 : 3]);
  for (let y = 8; y < 114; y += 6.5) {
    const f = y / 120;
    for (const side of [-1, 1]) {
      const len = (25 - f * 12) * rng.range(0.82, 1.08);
      const a = 0.62 + rng.range(-0.12, 0.14) + f * 0.2;
      const ca = Math.cos(a) * side, sa = Math.sin(a);
      const x0 = ax(y);
      for (let s = 1; s < len; s += 1) {
        const px = x0 + ca * s, py = y + sa * s;
        P.put(px, py, A[1]);
        if (s % 2 === 0) {
          const pl = s < len - 3 ? 3 : 2;
          for (let q = 1; q <= pl; q++) {
            const k = 2 + (q === pl ? 1 : 0) + (f > 0.45 ? 1 : 0) + (hsh(s, y, seed) > 0.8 ? 1 : 0);
            P.put(px - sa * q * side, py + Math.abs(ca) * q, clampK(A, k + 1));
            P.put(px + sa * q * side, py - Math.abs(ca) * q, clampK(A, k - 1));
          }
        }
      }
    }
  }
  if (bloom) {
    // golden puff-ball flowers and pale paired thorns
    for (let i = 0; i < 14; i++) {
      const x = rng.range(8, 56), y = rng.range(30, 118);
      for (const [dx, dy, k] of [[0, 0, 3], [1, 0, 2], [-1, 0, 3], [0, 1, 4], [0, -1, 2], [1, 1, 3], [-1, -1, 2], [-1, 1, 4]] as const) P.put(x + dx, y + dy, [0x8a6a10, 0xb08a18, 0xd8b02a, 0xf2d04a, 0xfff08a][k]);
    }
  }
  for (let y = 6; y < 60; y += 13)
    for (const s of [-1, 1]) P.line(ax(y), y, ax(y) + s * 4, y + 3, 0xe8e0cc);
  P.outline(mulC(A[0], 0.62));
  return P;
}

/** a feathery tamarisk plume: a drooping axis furred with scale-leaf branchlets (pink racemes) */
function tamariskPlume(seed: number, pink: boolean) {
  const P = new Pix(), rng = new Rng(seed);
  const T = PAL.tamarisk, K = PAL.pink;
  const ax = (y: number) => 32 + Math.sin(y * 0.06 + seed * 1.3) * 3;
  for (let y = 0; y < 122; y++) P.put(ax(y), y, PAL.tamBark[2 + (y % 3 === 0 ? 1 : 0)]);
  let side = 1;
  for (let y = 3; y < 120; y += 2.6) {
    side = -side;
    const f = y / 124;
    const len = (7 + 19 * Math.pow(Math.sin(Math.PI * Math.min(1, f * 0.9 + 0.1)), 0.7)) * rng.range(0.75, 1.1);
    const a = Math.PI / 2 - side * (0.55 + rng.range(-0.1, 0.15));
    const ca = Math.cos(a), sa = Math.sin(a);
    const x0 = ax(y);
    for (let s = 0; s < len; s += 0.8) {
      const k = 2 + (Math.floor(s) % 2) + (s > len * 0.65 ? 1 : 0) + (side > 0 ? 0 : 1);
      const px = x0 + ca * s, py = y + sa * s;
      P.put(px, py, clampK(T, k));
      if (Math.floor(s) % 3 === 1) {
        P.put(px + side * 1, py + 1, clampK(T, k + 1));
        P.put(px - side * 1, py + 1, clampK(T, k - 1));
      }
    }
    if (pink && rng.next() < 0.6) {
      const n = rng.range(5, 10);
      for (let s = 0; s < n; s += 0.5) {
        const px = x0 + ca * (len + s), py = y + sa * (len + s);
        const k = 1 + (Math.floor(s * 2) % 2) + (s > n * 0.6 ? 1 : 0);
        P.put(px, py, K[k]);
        P.put(px + 1, py, K[k + 1]);
      }
    }
  }
  P.outline(mulC(T[0], 0.6));
  return P;
}

/** grey-green desert scrub: twiggy forks set with small leaves and yellow flowers */
function scrubSpray(seed: number) {
  const P = new Pix(), rng = new Rng(seed);
  const S = PAL.scrub, W = PAL.twig;
  const twigs: [number, number, number, number][] = [[32, 0, 30, 118], [31, 20, 12, 100], [32, 34, 54, 108], [30, 58, 20, 122]];
  for (const [x0, y0, x1, y1] of twigs) P.line(x0, y0, x1, y1, (t) => W[t < 0.3 ? 2 : 3]);
  for (let i = 0; i < 96; i++) {
    const tw = twigs[i % twigs.length], t = rng.range(0.1, 1);
    const x = tw[0] + (tw[2] - tw[0]) * t + rng.range(-3, 3), y = tw[1] + (tw[3] - tw[1]) * t;
    leaf(P, x, y, rng.range(0.2, Math.PI - 0.2), rng.range(6, 10), 2.1, S, 2 + (t > 0.55 ? 1 : 0), { sh: OVATE, rib: true });
  }
  for (let i = 0; i < 12; i++) {
    const x = rng.range(10, 54), y = rng.range(60, 122);
    if (P.get(Math.round(x), Math.round(y)) < 0) continue;
    P.put(x, y, 0xe8c840);
    P.put(x + 1, y, 0xc8a030);
    P.put(x, y + 1, 0xfff08a);
    P.put(x + 1, y + 1, 0xe8c840);
  }
  P.outline(mulC(S[0], 0.62));
  return P;
}

/** broad glossy oasis-shrub leaves on a stem, optionally starred with blossoms */
function shrubLeaves(seed: number, bloom: boolean) {
  const P = new Pix(), rng = new Rng(seed);
  const G = PAL.shrub;
  const ax = (y: number) => 32 + Math.sin(y * 0.04 + seed) * 3;
  for (let y = 0; y < 116; y++) P.put(ax(y), y, y < 50 ? 0x4a3a22 : G[2]);
  let side = 1;
  for (let y = 10; y < 112; y += 8.5) {
    side = -side;
    const a = Math.PI / 2 - side * rng.range(0.55, 0.95);
    leaf(P, ax(y), y, a, rng.range(17, 24) * (1 - y / 300), 4.4, G, 2 + (y > 60 ? 1 : 0), { sh: OVATE, rib: true, curl: rng.range(-2, 2) });
  }
  for (const a of [1.2, 1.57, 1.95]) leaf(P, ax(112), 110, a, 15, 3.8, G, 3, { sh: OVATE, rib: true });
  if (bloom) {
    const cols = [[0xc83a5a, 0xf05a7a, 0xffb0c4], [0xd8d0d8, 0xf4f0f4, 0xffffff], [0xb02a30, 0xe83a4a, 0xff8a7a]][seed % 3];
    for (let i = 0; i < 10; i++) {
      const x = rng.range(10, 54), y = rng.range(46, 120);
      for (let p = 0; p < 5; p++) {
        const a = (p / 5) * Math.PI * 2 + 0.3;
        const qx = x + Math.cos(a) * 2.2, qy = y + Math.sin(a) * 2.2;
        P.put(qx, qy, cols[1]);
        P.put(qx + Math.cos(a) * 0.8, qy + Math.sin(a) * 0.8 + 0.5, cols[2]);
        P.put(qx - 0.5, qy - 0.5, cols[0]);
      }
      P.put(x, y, 0xf4c838);
      P.put(x + 1, y, 0xc89020);
    }
  }
  P.outline(mulC(G[0], 0.6));
  return P;
}

/** grass blades from a common root, bowing outward at the tips, with optional seed stalks */
function grassBlades(seed: number, ramp: number[], n: number, heads: boolean, upright = 1) {
  const P = new Pix(), rng = new Rng(seed);
  for (let i = 0; i < n; i++) {
    const bx = 24 + (i + 0.5) * (16 / n) + rng.range(-1.5, 1.5);
    const tx = 32 + ((i + rng.range(0.15, 0.85)) / n - 0.5) * 54 * (1.15 - upright * 0.5);
    const ty = rng.range(92, 124);
    const cx = bx + (tx - bx) * 0.15, cy = ty * rng.range(0.55, 0.75);
    blade(P, bx, 0, cx, cy, tx, ty, rng.range(1.8, 2.5), ramp, i % 2 ? 3 : 2);
  }
  if (heads)
    for (let h = 0; h < 2; h++) {
      const bx = 30 + h * 4, tx = 22 + h * 20 + rng.range(-4, 4), ty = rng.range(112, 125);
      P.line(bx, 0, tx, ty, (t) => ramp[t < 0.3 ? 2 : 3]);
      for (let s = 0; s < 22; s += 2) {
        const t = 1 - s / (ty * 1.05);
        const x = bx + (tx - bx) * t, y = ty - s;
        const sd = (s / 2) % 2 ? 1 : -1;
        P.put(x + sd, y, ramp[4]);
        P.put(x + sd * 2, y + 1, ramp[5]);
        P.put(x + sd, y - 1, ramp[3]);
      }
    }
  P.outline(mulC(ramp[0], 0.62));
  return P;
}

/** one long reed / cattail blade with parallel veins and a half twist */
function reedBlade(seed: number) {
  const P = new Pix(), rng = new Rng(seed);
  const R = PAL.reed;
  // a narrower blade behind, then the main blade
  blade(P, 30, 0, 26, 60, 12 + rng.range(-3, 3), 104, 2.4, R, 1);
  for (let y = 0; y < 126; y += 0.5) {
    const t = y / 126;
    const x = 32 + 3 * Math.sin(t * 2.2 + seed);
    const w = 6.2 * Math.pow(1 - t, 0.75) + 0.4;
    const flip = t > 0.55 ? -1 : 1;
    for (let q = -w; q <= w + 0.01; q += 0.5) {
      let k = 3 + (q * flip > 0.3 ? 1 : 0) - (q * flip < -w * 0.6 ? 1 : 0);
      if (Math.abs(q) < 0.45) k -= 1;
      else if (Math.abs(Math.abs(q) - w * 0.5) < 0.3) k += 1;
      if (t < 0.1) k -= 1;
      if (t > 0.85) k += 1;
      P.put(x + q, y, clampK(R, k));
    }
  }
  P.outline(mulC(R[0], 0.6));
  return P;
}

/** papyrus umbel rays: thread-fine stalks fanning out, each ending in a tuft of bracts */
function papyrusRays(seed: number) {
  const P = new Pix(), rng = new Rng(seed);
  const R = PAL.reed;
  for (let i = 0; i < 7; i++) {
    const a = Math.PI / 2 + (i / 6 - 0.5) * 0.9 + rng.range(-0.05, 0.05);
    const len = rng.range(84, 112);
    const tx = 32 + Math.cos(a) * len, ty = Math.sin(a) * len;
    P.line(32, 0, tx, ty, (t) => R[t < 0.5 ? 3 : 4]);
    for (let b = 0; b < 6; b++) {
      const ba = a + rng.range(-0.9, 0.9), bl = rng.range(6, 13);
      P.line(tx, ty, tx + Math.cos(ba) * bl, ty + Math.sin(ba) * bl, (t) => R[t < 0.5 ? 4 : 5]);
    }
    P.put(tx, ty, 0x8a6a3a);
    P.put(tx + 1, ty + 1, 0xa8844a);
  }
  P.outline(mulC(R[0], 0.6));
  return P;
}

/** desert wildflowers: wiry stems with small leaves and daisy heads */
function wildflowers(seed: number, purple: boolean) {
  const P = new Pix(), rng = new Rng(seed);
  const G = PAL.turf;
  const sets = purple ? [[0x6a3a9a, 0x9a6ad0, 0xc8a8f0, 0xf8f0c0], [0xc84a1a, 0xf07a2a, 0xffb060, 0x3a2010]] : [[0xc89a18, 0xf0c838, 0xfff08a, 0xc8601a], [0xc8c0b8, 0xf4f0ea, 0xffffff, 0xf0b828]];
  for (let i = 0; i < 4; i++) {
    const bx = 28 + i * 2.5, tx = 12 + i * 13 + rng.range(-3, 3), ty = rng.range(64, 116);
    const cx = (bx + tx) / 2 + rng.range(-6, 6), cy = ty * 0.5;
    blade(P, bx, 0, cx, cy, tx, ty, 0.35, G, 2);
    for (let l = 0; l < 3; l++) {
      const t = 0.2 + l * 0.2, s = 1 - t;
      const lx = s * s * bx + 2 * s * t * cx + t * t * tx, ly = 2 * s * t * cy + t * t * ty;
      leaf(P, lx, ly, Math.PI / 2 + (l % 2 ? 0.8 : -0.8), 6, 1.3, G, 3);
    }
    const c = sets[i % 2];
    for (let p = 0; p < 8; p++) {
      const a = (p / 8) * Math.PI * 2;
      P.put(tx + Math.cos(a) * 2.4, ty + Math.sin(a) * 2.4, c[a < Math.PI ? 2 : 1]);
      P.put(tx + Math.cos(a) * 3.3, ty + Math.sin(a) * 3.3, c[a > 3.6 && a < 5.8 ? 0 : 1]);
    }
    P.put(tx, ty, c[3]);
    P.put(tx + 1, ty, c[3]);
    P.put(tx, ty + 1, mulC(c[3], 1.25));
  }
  P.outline(mulC(G[0], 0.6));
  return P;
}

/** field crops: awned barley ears, blue-flowered flax, young wheat */
function crop(seed: number, kind: 0 | 1 | 2) {
  if (kind === 2) return grassBlades(seed, PAL.turf, 5, false, 1.6);
  const P = new Pix(), rng = new Rng(seed);
  const G = kind === 0 ? PAL.dry : PAL.reed;
  for (let i = 0; i < 5; i++) {
    const bx = 26 + i * 3, tx = 18 + i * 7 + rng.range(-2, 2), ty = rng.range(96, 118);
    P.line(bx, 0, tx, ty, (t) => G[t < 0.2 ? 1 : 3]);
    if (i < 3) blade(P, bx, 0, bx - 4 + i * 4, 30, bx - 14 + i * 14, 58, 1.4, kind === 0 ? PAL.reed : G, 2);
    if (kind === 0) {
      for (let s = 0; s < 16; s += 1.5) {
        const y = ty + s, x = tx + s * 0.15;
        const sd = Math.floor(s / 1.5) % 2 ? 1 : -1;
        P.put(x, y, G[3]);
        P.put(x + sd, y, G[4 + (sd > 0 ? 1 : 0)]);
        P.line(x + sd, y, x + sd * 3, y + 9, G[5]);
      }
    } else {
      const c = [0x3a5ab0, 0x5a8ae0, 0x9ac0ff];
      for (const [dx, dy, k] of [[0, 2, 1], [0, -2, 0], [2, 0, 1], [-2, 0, 2], [1, 1, 2], [-1, -1, 0]] as const) P.put(tx + dx, ty + dy, c[k]);
      P.put(tx, ty, 0xf0e8b0);
      if (rng.next() < 0.5) {
        P.put(tx + 4, ty - 6, 0x8a6a3a);
        P.put(tx + 5, ty - 6, 0xa8844a);
      }
    }
  }
  P.outline(mulC(G[0], 0.6));
  return P;
}

/** dead brush: grey forked twiglets with a few rusty dry leaves */
function deadSpray(seed: number) {
  const P = new Pix(), rng = new Rng(seed);
  const W = PAL.twig;
  const fork = (x: number, y: number, a: number, len: number, d: number) => {
    const x1 = x + Math.cos(a) * len, y1 = y + Math.sin(a) * len;
    P.line(x, y, x1, y1, (t) => W[d > 1 ? 3 : t < 0.5 ? 2 : 3]);
    if (d < 3) {
      fork(x1, y1, a + rng.range(0.3, 0.6), len * 0.62, d + 1);
      fork(x1, y1, a - rng.range(0.3, 0.6), len * 0.6, d + 1);
    } else if (rng.next() < 0.5) {
      P.put(x1, y1, 0x9a5a2a);
      P.put(x1 + 1, y1, 0x7a4220);
    }
  };
  fork(32, 0, Math.PI / 2 + rng.range(-0.1, 0.1), 46, 0);
  P.outline(mulC(W[0], 0.7), [[-1, 0]]);
  return P;
}

// ------------------------------------------------------------------ bark / stem tiles (tile in u and v)
const wrapPix = () => new Pix(true);
function barkPalm() {
  // leaf-base "boots": 8 round the trunk, rows every 8 texels, offset every other row
  const P = wrapPix();
  const B = PAL.palmBark;
  P.fill((x, y) => {
    const row = Math.floor(y / 8), ry = y % 8;
    const cx = (x + (row % 2) * 4) % 8;
    let k = 3;
    if (ry >= 6) k = 4 + (cx > 1 && cx < 6 ? 1 : 0);
    else if (ry === 0) k = 0;
    else if (ry === 1) k = 1;
    else if (cx === 0 || cx === 7) k = 1;
    else k = 2 + (ry > 3 ? 1 : 0);
    if (hsh(x, y, 7) > 0.86) k -= 1;
    return clampK(B, k);
  });
  return P;
}
function barkAcacia() {
  const P = wrapPix();
  const B = PAL.acaciaBark;
  const fis = Array.from({ length: 7 }, (_, i) => ({ u: i * 9.1 + hsh(i, 1, 2) * 5, m: 1 + (i % 3), ph: hsh(i, 3, 4) * 6.28 }));
  P.fill((x, y) => {
    let k = 2 + (hsh(x >> 1, y >> 2, 5) > 0.6 ? 1 : 0);
    for (const f of fis) {
      const fx = f.u + 2.2 * Math.sin((y / AH) * Math.PI * 2 * f.m + f.ph);
      let d = x - fx;
      d -= Math.round(d / AW) * AW;
      if (Math.abs(d) < 0.8) k = 0;
      else if (d > 0.8 && d < 1.8) k = 4;
      else if (d < -0.8 && d > -1.8) k = 1;
    }
    return clampK(B, k);
  });
  return P;
}
function barkTamarisk() {
  const P = wrapPix();
  const B = PAL.tamBark;
  P.fill((x, y) => {
    let k = 2 + (Math.sin((x / AW) * Math.PI * 12 + Math.sin(y * 0.2)) > 0.6 ? 1 : 0);
    if (hsh(x >> 2, y, 9) > 0.93) k = 4; // lenticels
    if (hsh(x, y >> 3, 11) > 0.9) k = 1;
    return clampK(B, k);
  });
  return P;
}
function stemTile(ramp: number[], nodes: boolean) {
  const P = wrapPix();
  P.fill((x, y) => {
    let k = 3 + (x % 4 === 0 ? -1 : x % 4 === 2 ? 1 : 0);
    if (nodes && y % 64 < 2) k = 1;
    if (hsh(x, y >> 2, 3) > 0.94) k += 1;
    return clampK(ramp, k);
  });
  return P;
}
function cattailTile() {
  const P = wrapPix();
  const C = PAL.cattail;
  P.fill((x, y) => clampK(C, 2 + (hsh(x, y, 13) > 0.72 ? 1 : 0) - (hsh(x, y, 17) > 0.85 ? 1 : 0) + (hsh(x >> 1, y >> 1, 19) > 0.92 ? 2 : 0)));
  return P;
}
function datesTile() {
  // glossy beads: 8 round, rows every 8, offset
  const P = wrapPix();
  const D = PAL.dates;
  P.fill((x, y) => {
    const row = Math.floor(y / 8);
    const bx = ((x + (row % 2) * 4) % 8) - 3.5, by = (y % 8) - 3.5;
    const r = Math.hypot(bx, by * 0.85);
    if (r > 3.6) return D[0];
    let k = 3 - r * 0.45 + (bx < 0 && by > 0 ? 1 : 0);
    if (Math.abs(bx + 1.2) < 0.6 && Math.abs(by - 1.4) < 0.6) k = 5;
    return clampK(D, k + (hsh(row, (x + (row % 2) * 4) >> 3, 3) > 0.7 ? -1 : 0));
  });
  return P;
}
function rachisTile(ramp: number[]) {
  const P = wrapPix();
  P.fill((x, y) => clampK(ramp, (x < 6 || x > 58 ? 1 : x > 28 && x < 36 ? 4 : 3) - (hsh(x, y >> 3, 21) > 0.9 ? 1 : 0)));
  return P;
}
function twigTile() {
  const P = wrapPix();
  const W = PAL.twig;
  P.fill((x, y) => clampK(W, 2 + (x % 8 < 2 ? -1 : x % 8 > 5 ? 1 : 0) + (hsh(x >> 2, y >> 4, 23) > 0.85 ? 1 : 0) - (y % 40 < 2 ? 1 : 0)));
  return P;
}

let atlas: THREE.DataArrayTexture | null = null;
/** paint every leaf card and bark tile once (~40 ms) */
export function plantAtlas() {
  if (atlas) return atlas;
  const t0 = performance.now();
  const data = new Uint8Array(AW * AH * 4 * LAYERS);
  const lay: Pix[] = [];
  lay[L.PALM] = palmStrip(21, false);
  lay[L.PALM_DRY] = palmStrip(34, true);
  lay[L.ACACIA] = acaciaSpray(51, false);
  lay[L.ACACIA_BLOOM] = acaciaSpray(56, true);
  lay[L.TAMA] = tamariskPlume(61, false);
  lay[L.TAMA_PINK] = tamariskPlume(66, true);
  lay[L.SCRUB] = scrubSpray(81);
  lay[L.SHRUB] = shrubLeaves(91, false);
  lay[L.SHRUB_BLOOM] = shrubLeaves(99, true);
  lay[L.TURF] = grassBlades(101, PAL.turf, 4, false);
  lay[L.TURF_SEED] = grassBlades(107, PAL.turf, 3, true);
  lay[L.DRY] = grassBlades(111, PAL.dry, 4, false, 0.7);
  lay[L.DRY_SEED] = grassBlades(117, PAL.dry, 3, true, 0.7);
  lay[L.REED] = reedBlade(121);
  lay[L.PAPYRUS] = papyrusRays(131);
  lay[L.WILD] = wildflowers(141, false);
  lay[L.WILD_B] = wildflowers(147, true);
  lay[L.BARLEY] = crop(151, 0);
  lay[L.FLAX] = crop(157, 1);
  lay[L.WHEAT] = crop(163, 2);
  lay[L.DEAD] = deadSpray(171);
  lay[L.B_PALM] = barkPalm();
  lay[L.B_ACACIA] = barkAcacia();
  lay[L.B_TAMA] = barkTamarisk();
  lay[L.B_STEM] = stemTile(PAL.reed, false);
  lay[L.B_CATTAIL] = cattailTile();
  lay[L.B_DATES] = datesTile();
  lay[L.B_RACHIS] = rachisTile(PAL.rachis);
  lay[L.B_TWIG] = twigTile();
  lay[L.B_STRAW] = stemTile(PAL.dry, true);
  lay.forEach((P, l) => {
    for (let i = 0; i < AW * AH; i++) {
      const c = P.col[i];
      if (c < 0) continue;
      const o = (l * AW * AH + i) * 4;
      data[o] = (c >> 16) & 255;
      data[o + 1] = (c >> 8) & 255;
      data[o + 2] = c & 255;
      data[o + 3] = 255;
    }
  });
  const tex = new THREE.DataArrayTexture(data, AW, AH, LAYERS);
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.UnsignedByteType;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  atlas = tex;
  console.log(`[plants] ${LAYERS} pixel leaf cards and bark tiles painted in ${(performance.now() - t0).toFixed(0)}ms`);
  return tex;
}
