// Pixel-art plant sprites for the impostor trees and bushes (Trees.ts). Each sprite is
// built like a pixel artist builds foliage: a blobby silhouette with a broken leafy edge,
// filled back-to-front with hundreds of small oriented leaf dabs, every dab picking its
// tone from a hue-shifted ramp by where it sits on the lit clump (cool blue-green shade,
// warm yellow-green light), a highlight texel on its upper-left edge and a shade texel on
// its lower-right, deep interior gaps, and a selective dark outline on the shadow side.
// Trunks are painted as lit cylinders with bark patterns (palm leaf-base diamonds, acacia
// fissures, gnarled tamarisk stems); palm fronds as drooping rachis arcs hung with leaflets.
// Moderate resolution (64 px clumps, 128 px trunks and fronds), crisp nearest texels.
import * as THREE from 'three';

export const LS = 128;
/** sprite rect in the array: layer, x0, y0, w, h (texels; y0 = bottom) */
export interface Rect {
  l: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

const R = (l: number, x: number, y: number, w: number, h: number): Rect => ({ l, x, y, w, h });
/** the sprite table */
export const ART = {
  palmTrunk: [R(0, 0, 0, 64, 128), R(0, 64, 0, 64, 128)],
  acaciaTrunk: R(1, 0, 0, 64, 128),
  tamariskTrunk: R(1, 64, 0, 64, 128),
  frond: [R(2, 0, 0, 128, 64), R(2, 0, 64, 128, 64)],
  palmCrown: R(3, 0, 0, 64, 64),
  dates: R(3, 64, 0, 64, 64),
  acacia: [R(3, 0, 64, 64, 64), R(3, 64, 64, 64, 64)],
  tamarisk: [R(4, 0, 0, 64, 64), R(4, 64, 0, 64, 64)],
  tamariskPink: R(4, 0, 64, 64, 64),
  scrub: [R(4, 64, 64, 64, 64), R(5, 0, 0, 64, 64)],
  shrub: [R(5, 64, 0, 64, 64), R(5, 0, 64, 64, 64)],
  shrubBloom: R(5, 64, 64, 64, 64),
} as const;
const LAYERS = 6;

// ---- palettes (dark -> light, hue-shifted)
const PAL = {
  palm: [0x14301f, 0x204a2c, 0x346a34, 0x4f8a3c, 0x78ab4a, 0xa8cc66],
  palmDry: [0x5a4224, 0x86663a, 0xb08e54, 0xd0b072],
  palmBark: [0x2c1d14, 0x4a3220, 0x6a4a2e, 0x8a6840, 0xae8c5a, 0xcaa974],
  acacia: [0x1c2a18, 0x2e4222, 0x46602e, 0x64803a, 0x86a04a, 0xaec064],
  acaciaBark: [0x241a14, 0x3e2e22, 0x5c4432, 0x7c6046, 0x9c7e5c],
  tamarisk: [0x1e2c2a, 0x34483e, 0x506652, 0x6f846a, 0x93a586, 0xbcc6a4],
  pink: [0x6a2a48, 0x9a4a6c, 0xc8709a, 0xe6a2c2, 0xf8d0e2],
  scrub: [0x2a3024, 0x434c36, 0x5f6a4a, 0x7f8864, 0xa2a882, 0xc8c6a0],
  shrub: [0x10301c, 0x1c4a28, 0x2e6c34, 0x48903e, 0x6eb04c, 0x9cd066],
  dates: [0x4a1a0a, 0x7a2e12, 0xaa4c1c, 0xd0742a, 0xf0a446],
};

// ---- deterministic hash / noise
function hsh(a: number, b: number, c: number) {
  let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ Math.imul(c | 0, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vn(x: number, y: number, s: number) {
  const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const a = hsh(xi, yi, s), b = hsh(xi + 1, yi, s), c = hsh(xi, yi + 1, s), d = hsh(xi + 1, yi + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
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

/** a canvas onto one sprite rect: put(x, y, colour) in rect-local texels (y up) */
class Pix {
  col: Int32Array;
  constructor(public w: number, public h: number) {
    this.col = new Int32Array(w * h).fill(-1);
  }
  get(x: number, y: number) {
    return x < 0 || y < 0 || x >= this.w || y >= this.h ? -1 : this.col[x + y * this.w];
  }
  put(x: number, y: number, c: number) {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.col[x + y * this.w] = c;
  }
  /** selective outline: empty texels right of / below the shape take a darkened shade */
  outline(dark: number, sides: [number, number][] = [[-1, 0], [0, 1]]) {
    const add: [number, number][] = [];
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++) {
        if (this.get(x, y) >= 0) continue;
        for (const [dx, dy] of sides)
          if (this.get(x + dx, y + dy) >= 0) {
            add.push([x, y]);
            break;
          }
      }
    for (const [x, y] of add) this.col[x + y * this.w] = dark;
  }
}
const mulC = (c: number, k: number) => (Math.min(255, Math.round(((c >> 16) & 255) * k)) << 16) | (Math.min(255, Math.round(((c >> 8) & 255) * k)) << 8) | Math.min(255, Math.round((c & 255) * k));

/**
 * A leafy clump: lobes of foliage filled back to front with oriented leaf dabs.
 * `leaf` sets dab length (texels), `fine` > 0 makes feathery needles (tamarisk).
 */
function clump(w: number, h: number, pal: number[], seed: number, o: { lobes?: number; leaf?: number; fine?: number; flat?: number; accent?: { pal: number[]; k: number }; dots?: { c: number[]; n: number } } = {}) {
  const rng = new Rng(seed);
  const P = new Pix(w, h);
  const cx = w / 2, cy = h / 2;
  const nL = o.lobes ?? 5;
  const flat = o.flat ?? 1;
  const lobes: [number, number, number][] = [[cx, cy, w * 0.27]];
  for (let i = 0; i < nL; i++) {
    const a = rng.range(0, Math.PI * 2), d = rng.range(0.1, 0.24) * w;
    lobes.push([cx + Math.cos(a) * d * 0.85, cy + Math.sin(a) * d * 0.8 * flat, rng.range(0.12, 0.17) * w]);
  }
  const inside = (x: number, y: number) => {
    let m = 0;
    for (const [lx, ly, lr] of lobes) m = Math.max(m, 1 - Math.hypot(x - lx, (y - ly) / flat) / lr);
    return m + (vn(x * 0.32, y * 0.32, seed) - 0.5) * 0.32;
  };
  // leaf dabs, back to front
  const dabs: { x: number; y: number; z: number; a: number; acc: boolean }[] = [];
  const N = Math.round(w * h * (o.fine ? 0.6 : 0.42));
  for (let i = 0; i < N; i++) {
    const x = rng.range(1, w - 1), y = rng.range(1, h - 1);
    if (inside(x, y) < 0.13) continue;
    const nx = (x - cx) / (w * 0.45), ny = (y - cy) / (h * 0.45);
    const z = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny)) + rng.range(-0.25, 0.25);
    const a = Math.atan2(ny, nx) + rng.range(-0.9, 0.9) + (o.fine ? -Math.PI / 2 * 0.6 : 0);
    dabs.push({ x, y, z, a, acc: !!o.accent && rng.next() < o.accent.k });
  }
  dabs.sort((p, q) => p.z - q.z);
  const L = [-0.5, 0.62, 0.6];
  // deep interior first: everything inside the silhouette starts as the darkest leaf shade
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (inside(x, y) > 0.12) P.put(x, y, pal[0]);
  const len = o.leaf ?? 3;
  for (const d of dabs) {
    const nx = (d.x - cx) / (w * 0.45), ny = (d.y - cy) / (h * 0.45);
    const lum = (nx * L[0] + ny * L[1] + d.z * L[2]) * 0.5 + 0.5 + (d.z - 0.5) * 0.25;
    const ramp = d.acc ? o.accent!.pal : pal;
    let k = Math.max(1, Math.min(ramp.length - 2, Math.floor(lum * (ramp.length - 1) + 0.35)));
    if (inside(d.x, d.y) < 0.12 && k > 2) k--;
    const ca = Math.cos(d.a), sa = Math.sin(d.a);
    const l = o.fine ? len + 1 : len;
    for (let t = -l / 2; t <= l / 2; t += 0.5) {
      const px = d.x + ca * t, py = d.y + sa * t;
      const wdt = o.fine ? 0 : t > -l / 2 + 0.6 && t < l / 2 - 0.6 ? 1 : 0;
      P.put(px, py, ramp[k]);
      if (wdt) P.put(px - sa * 0.7, py + ca * 0.7, ramp[k]);
    }
    // highlight on the lit tip, shade under the leaf
    P.put(d.x - ca * l * 0.5, d.y - sa * l * 0.5 + (o.fine ? 0 : 1), ramp[Math.min(ramp.length - 1, k + 1)]);
    P.put(d.x + 1, d.y - 1, ramp[Math.max(0, k - 1)]);
  }
  if (o.dots)
    for (let i = 0; i < o.dots.n; i++) {
      const x = rng.range(3, w - 3), y = rng.range(3, h - 3);
      if (inside(x, y) < 0.2) continue;
      const c = o.dots.c[Math.floor(rng.next() * o.dots.c.length)];
      P.put(x, y, c);
      if (rng.next() < 0.5) P.put(x + 1, y, mulC(c, 0.72));
      P.put(x, y + 1, mulC(c, 1.18));
    }
  P.outline(mulC(pal[0], 0.62));
  return P;
}

/** palm trunk: a gently curved, tapering column of leaf-base diamonds, fibrous crown, root flare */
/** the two palm trunks' bends (texels at the crown x 0.45); Trees offsets the crown to match */
export const PALM_BEND = [7, -6];
function palmTrunk(seed: number, bend: number) {
  const P = new Pix(64, 128);
  const cx = 32;
  const B = PAL.palmBark;
  for (let y = 0; y < 124; y++) {
    const t = y / 124;
    const ox = cx + bend * Math.sin(t * Math.PI * 0.85) * t;
    const hw = 5.2 - 2.2 * t + (y < 8 ? (8 - y) * 0.45 : 0) + (y > 116 ? 1.6 : 0);
    for (let x = Math.floor(ox - hw); x <= Math.ceil(ox + hw); x++) {
      const u = (x - ox) / hw;
      if (Math.abs(u) > 1) continue;
      // cylinder shading: lit from the left
      let k = Math.round(3.3 - u * 1.7 + (1 - u * u) * 0.5);
      // leaf-base diamonds: rows every 5 texels, offset each row
      const row = Math.floor(y / 5), ry = y % 5;
      const dx = (x - ox + (row % 2) * 2.5) % 5;
      if (ry === 0 || (ry === 1 && Math.abs(dx) < 1)) k -= 2;
      else if (ry === 4) k += 1;
      if (y > 114) k = 1 + (hsh(x, y, seed) > 0.5 ? 1 : 0); // fibrous boss
      if (y < 4 && hsh(x, y, 3) > 0.6) k -= 1;
      P.put(x, y, B[Math.max(0, Math.min(B.length - 1, k))]);
    }
  }
  // root nubs
  for (let i = 0; i < 6; i++) P.put(cx - 7 + i * 2.6, 0, B[1]);
  P.outline(mulC(B[0], 0.7), [[-1, 0], [1, 0], [0, 1]]);
  return P;
}

/** acacia: a short trunk forking into splayed branches that end under the umbrella canopy */
function acaciaTrunk(seed: number) {
  const P = new Pix(64, 128);
  const B = PAL.acaciaBark;
  const rng = new Rng(seed);
  const limb = (x0: number, y0: number, x1: number, y1: number, w0: number, w1: number) => {
    const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const x = x0 + (x1 - x0) * t + Math.sin(t * 5 + seed) * 1.2, y = y0 + (y1 - y0) * t;
      const w = w0 + (w1 - w0) * t;
      for (let k = -Math.ceil(w); k <= Math.ceil(w); k++) {
        if (Math.abs(k) > w) continue;
        const u = k / Math.max(1, w);
        let c = Math.round(2.6 - u * 1.4);
        if (hsh(Math.round(x + k), Math.round(y / 3), seed) > 0.78) c -= 1; // fissures
        P.put(x + k, y, B[Math.max(0, Math.min(4, c))]);
      }
    }
  };
  limb(32, 0, 31, 54, 4.2, 3);
  const forks = [[-22, 118], [-8, 124], [10, 122], [24, 116]];
  for (const [dx, ty] of forks) limb(31, 50 + rng.range(-4, 4), 32 + dx, ty, 2.4, 0.8);
  limb(31, 70, 14, 96, 1.2, 0.5);
  limb(32, 76, 50, 100, 1.2, 0.5);
  P.outline(mulC(B[0], 0.7), [[-1, 0], [1, 0], [0, 1]]);
  return P;
}

/** tamarisk: several slender gnarled stems from one root crown */
function tamariskTrunk(seed: number) {
  const P = new Pix(64, 128);
  const B = PAL.acaciaBark;
  for (let s = 0; s < 4; s++) {
    const x0 = 30 + s * 1.5, lean = (s - 1.5) * 5;
    for (let y = 0; y < 88; y++) {
      const t = y / 88;
      const x = x0 + lean * t + Math.sin(t * 7 + s * 2 + seed) * 1.6;
      const w = 1.8 - t * 1.1;
      for (let k = -2; k <= 2; k++) if (Math.abs(k) <= w) P.put(x + k, y, B[k < 0 ? 3 : k > 0 ? 1 : 2]);
    }
  }
  P.outline(mulC(B[0], 0.7), [[-1, 0], [1, 0], [0, 1]]);
  return P;
}

/** one drooping palm frond seen side on: rachis arc from the crown (left) to the tip (right) */
function frond(seed: number) {
  const P = new Pix(128, 64);
  const G = PAL.palm, D = PAL.palmDry;
  const rng = new Rng(seed);
  const lift = rng.range(6, 12), droop = rng.range(30, 44);
  const pt = (t: number) => ({ x: 2 + t * 122, y: 46 + lift * Math.sin(t * Math.PI * 0.5) * (1 - t) - droop * t * t });
  for (let i = 0; i < 240; i++) {
    const t = i / 240, p = pt(t);
    // leaflets: a near and a far one every 2.5 texels, longest mid-frond, hanging down-out
    if (i % 4 === 0 && t > 0.08) {
      const L = (Math.sin(Math.PI * Math.min(1, t * 1.05)) * 15 + 3) * rng.range(0.8, 1.1);
      for (const side of [0, 1]) {
        const ang = -Math.PI / 2 + 0.45 + side * 0.5 + t * 0.4 + rng.range(-0.15, 0.15);
        const dry = t > 0.86 && rng.next() < 0.5;
        const ramp = dry ? D : G;
        for (let s = 0; s < L; s++) {
          const q = s / L;
          const x = p.x + Math.cos(ang) * s, y = p.y + Math.sin(ang) * s - q * q * 2;
          const k = side ? 1 + Math.round((1 - q) * 1.5) : 2 + Math.round((1 - q) * 2.2);
          P.put(x, y, ramp[Math.min(ramp.length - 1, dry ? k - 1 : k)]);
          if (!side && s === 0) P.put(x, y + 1, ramp[Math.min(ramp.length - 1, k + 1)]);
        }
      }
    }
  }
  for (let i = 0; i < 240; i++) {
    const p = pt(i / 240);
    P.put(p.x, p.y, i < 120 ? 0x9a8a48 : 0x7a7a3a);
    P.put(p.x, p.y + 1, G[5]);
  }
  P.outline(mulC(G[0], 0.6));
  return P;
}

/** hanging date clusters under the crown */
function dates(seed: number) {
  const P = new Pix(64, 64);
  const rng = new Rng(seed);
  const D = PAL.dates;
  for (let c = 0; c < 3; c++) {
    const x0 = 18 + c * 14, y0 = 56;
    for (let s = 0; s < 30; s++) P.put(x0 + s * 0.15 * (c - 1), y0 - s * 0.4, 0xb8963a);
    for (let i = 0; i < 70; i++) {
      const x = x0 + rng.range(-6, 6) + (c - 1) * 2, y = y0 - 10 - rng.range(0, 30);
      const k = 1 + Math.floor(rng.next() * 3);
      P.put(x, y, D[k]);
      P.put(x, y - 1, D[k - 1]);
      P.put(x - 1, y + 1, D[Math.min(4, k + 1)]);
    }
  }
  P.outline(mulC(D[0], 0.6));
  return P;
}

let atlas: THREE.DataArrayTexture | null = null;
/** paint every plant sprite once (~40 ms) */
export function plantAtlas() {
  if (atlas) return atlas;
  const t0 = performance.now();
  const data = new Uint8Array(LS * LS * 4 * LAYERS);
  const blit = (P: Pix, r: Rect) => {
    for (let y = 0; y < P.h; y++)
      for (let x = 0; x < P.w; x++) {
        const c = P.col[x + y * P.w];
        if (c < 0) continue;
        const o = ((r.x + x) + (r.y + y) * LS + r.l * LS * LS) * 4;
        data[o] = (c >> 16) & 255;
        data[o + 1] = (c >> 8) & 255;
        data[o + 2] = c & 255;
        data[o + 3] = 255;
      }
  };
  ART.palmTrunk.forEach((r, i) => blit(palmTrunk(11 + i * 7, PALM_BEND[i]), r));
  blit(acaciaTrunk(5), ART.acaciaTrunk);
  blit(tamariskTrunk(9), ART.tamariskTrunk);
  ART.frond.forEach((r, i) => blit(frond(21 + i * 13), r));
  blit(clump(64, 64, PAL.palm, 31, { lobes: 6, leaf: 5 }), ART.palmCrown);
  blit(dates(41), ART.dates);
  ART.acacia.forEach((r, i) => blit(clump(64, 64, PAL.acacia, 51 + i * 5, { lobes: 6, leaf: 2, flat: 0.62 }), r));
  ART.tamarisk.forEach((r, i) => blit(clump(64, 64, PAL.tamarisk, 61 + i * 5, { lobes: 5, leaf: 3, fine: 1 }), r));
  blit(clump(64, 64, PAL.tamarisk, 71, { lobes: 5, leaf: 3, fine: 1, accent: { pal: PAL.pink, k: 0.45 } }), ART.tamariskPink);
  ART.scrub.forEach((r, i) => blit(clump(64, 64, PAL.scrub, 81 + i * 5, { lobes: 6, leaf: 2, flat: 0.8, dots: { c: [0xe8c840, 0xf4dc6a], n: 40 } }), r));
  ART.shrub.forEach((r, i) => blit(clump(64, 64, PAL.shrub, 91 + i * 5, { lobes: 6, leaf: 3 }), r));
  blit(clump(64, 64, PAL.shrub, 99, { lobes: 6, leaf: 3, dots: { c: [0xf05a7a, 0xffd0dc, 0xffffff, 0xe83a4a], n: 90 } }), ART.shrubBloom);
  const tex = new THREE.DataArrayTexture(data, LS, LS, LAYERS);
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.UnsignedByteType;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  atlas = tex;
  console.log(`[plants] pixel plant sprites painted in ${(performance.now() - t0).toFixed(0)}ms`);
  return tex;
}
