// Pixel-art material textures for the big-block look: crisp, nearest-filtered
// tiles synthesised once at load from tileable noise, cellular patterns, grain,
// bedding, erosion and mortar layouts (no hand-drawn pictures). Every layer is a
// 128 x 128 tile laid out in world space at 16 texels per metre (one tile = 8 m):
// Minecraft proportions, so a 1 m terrain block shows 16 x 16 texels, planks are
// four texels wide and the grid of stones and flagstones lines up with the blocks.
//
// Texels store a per-channel colour RATIO (texel / material reference colour, /4):
// the shaders multiply the surface's own colour (vertex colour: palette, AO,
// strata, patches, paint) by the ratio, so one texture serves every tint of a
// material and the hand-placed colour of a model survives underneath.
import * as THREE from 'three';

export const PX_SIZE = 128;
export const PX_PER_M = 16;
/** texture layers */
export const PX = {
  SAND: 0,
  SAND_SIDE: 1,
  PACKED: 2,
  ROCK_TOP: 3,
  ROCK_SIDE: 4,
  TILE_TOP: 5,
  TILE_SIDE: 6,
  DIRT_TOP: 7,
  DIRT_SIDE: 8,
  GRASS_TOP: 9,
  GRASS_SIDE: 10,
  MUD: 11,
  // building / prop surfaces
  WOOD: 12,
  BRICK: 13,
  ADOBE: 14,
  ROCK: 15,
  METAL: 16,
  CLOTH: 17,
  BARK: 18,
  CACTUS: 19,
} as const;
export const PX_LAYERS = 20;

const S = PX_SIZE;
type RGB = [number, number, number];

// ------------------------------------------------------------------ colour + noise kit
const s2l = (c: number) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
};
function linHex(h: number): RGB {
  return [s2l((h >> 16) & 255), s2l((h >> 8) & 255), s2l(h & 255)];
}
/** integer hash -> [0, 1) */
function ih(x: number, y: number, s: number) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
const wrap = (v: number, p: number) => ((v % p) + p) % p;
const sm = (t: number) => t * t * (3 - 2 * t);
/** periodic value noise (period S), lattice spacing cx x cy texels, 0..1 */
function vn(x: number, y: number, cx: number, cy: number, seed: number) {
  const px = S / cx, py = S / cy;
  const gx = x / cx, gy = y / cy;
  const ix = Math.floor(gx), iy = Math.floor(gy);
  const fx = sm(gx - ix), fy = sm(gy - iy);
  const a = ih(wrap(ix, px), wrap(iy, py), seed), b = ih(wrap(ix + 1, px), wrap(iy, py), seed);
  const c = ih(wrap(ix, px), wrap(iy + 1, py), seed), d = ih(wrap(ix + 1, px), wrap(iy + 1, py), seed);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}
/** periodic fbm 0..1 (octaves of lattice spacing c, c/2, c/4 ...) */
function fbm(x: number, y: number, seed: number, c = 32, oct = 4, aniso = 1) {
  let s = 0, n = 0, a = 1;
  for (let i = 0; i < oct && c >= 1; i++) {
    s += a * vn(x, y, c, Math.max(1, c * aniso), seed + i * 17);
    n += a;
    a *= 0.5;
    c /= 2;
  }
  return s / n;
}
/** periodic cellular noise: nearest / second-nearest feature distance (texels), owner cell id */
function cell(x: number, y: number, c: number, seed: number) {
  const p = S / c;
  const ix = Math.floor(x / c), iy = Math.floor(y / c);
  let f1 = 1e9, f2 = 1e9, id = 0, fx = 0, fy = 0;
  for (let j = -1; j <= 1; j++)
    for (let i = -1; i <= 1; i++) {
      const cx = ix + i, cy = iy + j;
      const wx = wrap(cx, p), wy = wrap(cy, p);
      const px = (cx + 0.15 + 0.7 * ih(wx, wy, seed)) * c, py = (cy + 0.15 + 0.7 * ih(wx, wy, seed + 1)) * c;
      const d = Math.hypot(x + 0.5 - px, y + 0.5 - py);
      if (d < f1) {
        f2 = f1;
        f1 = d;
        id = wx + wy * 977;
        fx = x + 0.5 - px;
        fy = y + 0.5 - py;
      } else if (d < f2) f2 = d;
    }
  return { f1, f2, id, dx: fx, dy: fy };
}
const pick = (t: readonly number[], v: number) => t[Math.max(0, Math.min(t.length - 1, Math.floor(v * t.length)))];

/** a tile authored as sRGB hex colours, normalised against the material's reference colour */
function fromHex(gen: (x: number, y: number) => number, ref: number): Float32Array {
  const out = new Float32Array(S * S * 3);
  const r = linHex(ref);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const c = linHex(gen(x, y));
      const o = (x + y * S) * 3;
      out[o] = c[0] / r[0];
      out[o + 1] = c[1] / r[1];
      out[o + 2] = c[2] / r[2];
    }
  return out;
}
/** a tile authored directly as per-channel multipliers */
function fromMul(gen: (x: number, y: number) => RGB): Float32Array {
  const out = new Float32Array(S * S * 3);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const c = gen(x, y);
      const o = (x + y * S) * 3;
      out[o] = c[0];
      out[o + 1] = c[1];
      out[o + 2] = c[2];
    }
  return out;
}
const M = (v: number, warm = 0): RGB => [v * (1 + warm), v, v * (1 - warm)];

/**
 * Pixel-art pebbles on a cellular lattice: a lit top-left rim, a shaded lower-right
 * rim and a soft cast shadow; returns the colour or -1 where there is no pebble.
 */
function pebble(x: number, y: number, c: number, seed: number, rMin: number, rMax: number, pals: number[][], shadow: number, density = 1): number {
  const w = cell(x, y, c, seed);
  if (ih(w.id, 3, seed) > density) return -1;
  const r = rMin + (rMax - rMin) * ih(w.id, 5, seed);
  // slightly squashed, rotated grains
  const sq = 0.75 + 0.5 * ih(w.id, 7, seed);
  const d = Math.hypot(w.dx, w.dy * sq);
  const pal = pals[Math.floor(ih(w.id, 9, seed) * pals.length)];
  if (d <= r) {
    const l = (w.dx + w.dy) / Math.max(r, 0.8);
    return l < -0.55 ? pal[2] : l > 0.6 ? pal[0] : pal[1];
  }
  // cast shadow down-right
  if (d <= r + 1.1 && w.dx + w.dy > 0.4) return shadow;
  return -1;
}

// ------------------------------------------------------------------ terrain materials
const SAND_T = [0xd4a76c, 0xdfb478, 0xe8c086, 0xf0cc95, 0xf8dcab];
const PEB_SAND = [[0x8f7356, 0xa88a68, 0xc8ad8a], [0x9a5c3e, 0xb4724c, 0xcf9268], [0xc8bca8, 0xe0d6c4, 0xf6efe2], [0x6e6458, 0x887c6c, 0xa69a88]];

function sandTop(x: number, y: number) {
  const n = fbm(x, y, 11, 32, 3);
  let i = n < 0.36 ? 1 : n < 0.64 ? 2 : 3;
  const h = ih(x, y, 21);
  if (h > 0.982) i = Math.min(4, i + 1);
  else if (h < 0.03) i = Math.max(0, i - 1);
  let c = SAND_T[i];
  if (h > 0.998) c = 0xfff4dc; // quartz glint
  else if (h < 0.004) c = 0x9a7a58; // heavy mineral
  const p = pebble(x, y, 16, 31, 0.6, 1.3, PEB_SAND, 0xc89c62, 0.28);
  return p >= 0 ? p : c;
}
function sandSide(x: number, y: number) {
  // horizontal laminae, gently undulating, with grains
  const wob = (vn(x, y, 32, 32, 5) - 0.5) * 5;
  const b = fbm(0, y + wob, 7, 16, 3, 1) * 0.8 + vn(x, y, 64, 4, 9) * 0.2;
  let i = b < 0.38 ? 0 : b < 0.5 ? 1 : b < 0.64 ? 2 : 3;
  const h = ih(x, y, 13);
  if (h > 0.97) i = Math.min(4, i + 1);
  else if (h < 0.03) i = Math.max(0, i - 1);
  const p = pebble(x, y, 18, 41, 0.6, 1.4, PEB_SAND, -1, 0.35);
  const base = [0xb88a52, 0xc4945c, 0xcfa066, 0xd8ac72, 0xe6be86][i];
  return p >= 0 ? p : base;
}
function packedTop(x: number, y: number) {
  // a sun-baked crust broken into plates, hairline cracks with a lit lip
  const w = cell(x, y, 9, 51);
  const e = w.f2 - w.f1;
  const plate = ih(w.id, 1, 51);
  const T = [0xbd8e56, 0xc89a60, 0xd2a46a, 0xdcb076, 0xe6bd84];
  let c = T[1 + Math.floor(plate * 2.99)];
  const g = ih(x, y, 52);
  if (g > 0.975) c = T[4];
  else if (g < 0.03) c = T[0];
  if (e < 0.85) c = 0x9e7346;
  else if (e < 1.7 && w.dx + w.dy < 0) c = T[4];
  const p = pebble(x, y, 20, 53, 0.6, 1.3, PEB_SAND, -1, 0.3);
  return p >= 0 ? p : c;
}
const ROCK_T = [0x8e6544, 0xa0754f, 0xb4865c, 0xc6996c, 0xd6ad80, 0xe6c294];
function rockTop(x: number, y: number) {
  // sandstone block tops: one stone per 0.5 m block, bevelled joints, cross-bedding, pits
  const bx = Math.floor(x / 16), by = Math.floor(y / 16), lx = x - bx * 16, ly = y - by * 16;
  const k = ih(bx, by, 61);
  if (lx === 0 || ly === 0) return ih(x, y, 66) < 0.15 ? ROCK_T[1] : ROCK_T[0];
  // chipped corners
  if ((lx <= 2 && ly <= 2 && lx + ly <= 3 - Math.floor(k * 2)) || (lx >= 14 && ly >= 14 && lx + ly >= 28 + Math.floor(k * 2))) return ROCK_T[0];
  // slanted cross-bedding laminae, a different set angle per stone
  const sl = 0.3 + k * 0.9;
  const cb = ((ly - lx * sl + vn(x, y, 8, 8, 62) * 2.5 + 64) % 4) < 0.7 && vn(x, y, 16, 16, 65) > 0.45;
  const n = fbm(x, y, 63, 16, 3);
  let i = 2 + Math.floor(k * 2) + (n > 0.64 ? 1 : 0);
  if (cb) i -= 1;
  if (lx === 1 || ly === 1) i += 1;
  if (lx === 15 || ly === 15) i -= 1;
  const pit = cell(x, y, 7, 64);
  if (pit.f1 < 0.75 && ih(pit.id, 1, 64) < 0.5) return ROCK_T[0];
  if (pit.f1 < 1.4 && ih(pit.id, 1, 64) < 0.5 && pit.dx + pit.dy < 0) i += 1;
  return ROCK_T[Math.max(0, Math.min(5, i))];
}
/** course layout: courses ch texels tall, stones `len` +- jit texels long, staggered (periodic over the tile) */
const jointMemo = new Map<number, number[]>();
function coursed(x: number, y: number, ch: number, len: number, jit: number, seed: number) {
  const course = Math.floor(y / ch);
  const ly = y - course * ch;
  const key = seed * 4096 + course * 64 + len;
  let js = jointMemo.get(key);
  if (!js) {
    const start = Math.floor(ih(course, 0, seed) * len);
    js = [start];
    for (let k = 1; ; k++) {
      const L = Math.round(len + (ih(course, k, seed + 1) * 2 - 1) * jit);
      const nx = js[js.length - 1] + L;
      if (nx >= start + S - len * 0.5) break;
      js.push(nx);
    }
    js.push(start + S);
    jointMemo.set(key, js);
  }
  const pos = wrap(x - js[0], S) + js[0];
  let k = 0;
  while (k < js.length - 2 && pos >= js[k + 1]) k++;
  return { course, ly, lx: pos - js[k], L: js[k + 1] - js[k], id: course * 131 + k };
}
function rockSide(x: number, y: number) {
  // stacked sandstone courses (0.25 m), vertical joints per course, bedding laminae, oxide drips
  const c = coursed(x, y, 8, 22, 9, 71);
  const k = ih(c.id, 2, 71);
  if (c.ly === 0) return ROCK_T[0];
  if (c.lx === 0) return ih(x, y, 76) < 0.2 ? ROCK_T[1] : ROCK_T[0];
  const lam = fbm(x, y, 72, 32, 2, 0.25) * 0.75 + vn(x, y, 32, 2, 73) * 0.35;
  let i = 2 + Math.floor(k * 2) + (lam > 0.72 ? 1 : lam < 0.42 ? -1 : 0);
  if (c.ly === 1) i += 1;
  if (c.ly === 7) i -= 1;
  if (c.lx === 1) i += 1;
  if (c.lx === c.L - 1) i -= 1;
  // desert varnish drips from the joint above
  const drip = ih(x, c.course, 74);
  if (drip < 0.025 && c.ly < 2 + drip * 160) return 0x8a5e40;
  const pit = cell(x, y, 6, 75);
  if (pit.f1 < 0.7 && ih(pit.id, 1, 75) < 0.45) return ROCK_T[0];
  return ROCK_T[Math.max(0, Math.min(5, i))];
}
const TILE_T = [0x9c7c56, 0xc4a478, 0xd6b88a, 0xe4c89a, 0xf0d8ae, 0xf8e6c4];
function dressedStone(lx: number, ly: number, L: number, H: number, id: number, x: number, y: number, seed: number, T: number[]) {
  const k = ih(id, 3, seed);
  if (lx === 0 || ly === 0) return T[0];
  // chipped arrises
  if (ih(id, Math.floor((lx + ly * 3) / 3), seed + 9) < 0.06 && (lx === 1 || ly === 1 || lx === L - 1 || ly === H - 1)) return T[0];
  // worn centre, darker rim
  const ex = Math.min(lx, L - lx), ey = Math.min(ly, H - ly);
  const wear = Math.min(ex / (L * 0.5), ey / (H * 0.5));
  const n = fbm(x, y, seed + 4, 16, 3);
  let i = 2 + Math.floor(k * 2.2) + (wear > 0.55 && n > 0.45 ? 1 : 0) + (n < 0.3 ? -1 : 0);
  if (ly === 1 || lx === 1) i += 1;
  if (ly === H - 1 || lx === L - 1) i -= 1;
  // a hairline crack across some stones
  if (k > 0.78) {
    const cx = L * (0.3 + 0.4 * ih(id, 5, seed));
    const along = lx - cx - (ly - H / 2) * (ih(id, 6, seed) - 0.5) * 1.6 - (vn(x, y, 4, 4, seed + 7) - 0.5) * 2.2;
    if (Math.abs(along) < 0.5) return T[0];
  }
  const g = ih(x, y, seed + 8);
  if (g < 0.03) i -= 1;
  else if (g > 0.98) i += 1;
  return T[Math.max(0, Math.min(T.length - 1, i))];
}
function tileTop(x: number, y: number) {
  const c = coursed(x, y, 16, 32, 0, 81);
  return dressedStone(c.lx, c.ly, c.L, 16, c.id, x, y, 81, TILE_T);
}
function tileSide(x: number, y: number) {
  const c = coursed(x, y, 8, 16, 4, 91);
  return dressedStone(c.lx, c.ly, c.L, 8, c.id, x, y, 91, TILE_T);
}
const DIRT_T = [0x7a5638, 0x8e6644, 0xa27652, 0xb48660, 0xc4966e];
const PEB_DIRT = [[0x6a6056, 0x8a7e70, 0xaaa090], [0x7a5034, 0x9a6a46, 0xb88a64], [0x9a8e7e, 0xb8ac98, 0xd4cab6]];
function dirtTop(x: number, y: number) {
  const n = fbm(x, y, 101, 32, 4);
  let i = n < 0.36 ? 1 : n < 0.56 ? 2 : 3;
  const h = ih(x, y, 102);
  if (h > 0.97) i++;
  else if (h < 0.05) i--;
  // dry cracks where the ground is highest
  const w = cell(x, y, 24, 103);
  if (n > 0.55 && w.f2 - w.f1 < 0.8) return DIRT_T[0];
  // twigs and straw
  const t = cell(x, y, 11, 104);
  if (ih(t.id, 1, 104) < 0.22) {
    const a = ih(t.id, 2, 104) * Math.PI;
    const along = t.dx * Math.cos(a) + t.dy * Math.sin(a), across = -t.dx * Math.sin(a) + t.dy * Math.cos(a);
    if (Math.abs(across) < 0.5 && Math.abs(along) < 2.6) return ih(t.id, 3, 104) < 0.5 ? 0xc8a66a : 0x5c3e26;
  }
  const p = pebble(x, y, 9, 105, 0.7, 2.0, PEB_DIRT, DIRT_T[0], 0.55);
  return p >= 0 ? p : DIRT_T[Math.max(0, Math.min(4, i))];
}
function soilSide(x: number, y: number, dark: number) {
  const wob = (vn(x, y, 32, 32, 111) - 0.5) * 4;
  const b = fbm(x, wrap(Math.round(y + wob), S), 112, 32, 3, 0.25);
  let i = b < 0.4 ? 1 : b < 0.6 ? 2 : 3;
  const h = ih(x, y, 113);
  if (h > 0.97) i++;
  else if (h < 0.05) i--;
  i = Math.max(0, Math.min(4, i - dark));
  // fine roots hanging down from the turf
  if (dark) {
    // a few fine roots wandering down from the turf
    const rc = cell(x, y, 24, 116);
    const rx = rc.dx + (vn(x, y, 4, 4, 117) - 0.5) * 3;
    if (ih(rc.id, 1, 116) < 0.35 && Math.abs(rx) < 0.5 && rc.dy < 4 && rc.dy > -7) return 0x4a3220;
  }
  const p = pebble(x, y, 12, 115, 0.8, 2.2, PEB_DIRT, DIRT_T[0], 0.5);
  return p >= 0 ? p : DIRT_T[i];
}
/** oasis grass seen from above: thousands of short blades deposited back to front */
let grassBuf: Uint32Array | null = null;
function grassTopBuf() {
  if (grassBuf) return grassBuf;
  const G = [0x2e4a1c, 0x3e6024, 0x4f772c, 0x628c34, 0x78a23e, 0x93b84c, 0xb0c862];
  const b = new Uint32Array(S * S);
  for (let i = 0; i < S * S; i++) b[i] = (i * 2654435761) % 7 < 4 ? G[0] : G[1];
  let s = 1;
  const rnd = () => ((s = Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
  const N = 5200;
  for (let k = 0; k < N; k++) {
    const x0 = rnd() * S, y0 = rnd() * S;
    const a = rnd() * Math.PI * 2;
    const len = 2 + Math.floor(rnd() * 4);
    const clump = vn(x0, y0, 16, 16, 121);
    const base = 2 + Math.floor(clump * 2.4);
    for (let t = 0; t < len; t++) {
      const x = wrap(Math.round(x0 + Math.cos(a) * t), S), y = wrap(Math.round(y0 + Math.sin(a) * t * 0.8), S);
      const tone = Math.min(G.length - 1, base + Math.floor((t / len) * 2.6) + (t === len - 1 && rnd() < 0.3 ? 1 : 0));
      b[x + y * S] = G[tone];
    }
  }
  // a few tiny blossoms and clover in the sward
  for (let k = 0; k < 26; k++) {
    const x = Math.floor(rnd() * S), y = Math.floor(rnd() * S);
    const f = rnd() < 0.5 ? 0xf4eee0 : 0xf2d25a;
    b[x + y * S] = f;
    b[wrap(x + 1, S) + wrap(y + 1, S) * S] = 0x2e4a1c;
  }
  return (grassBuf = b);
}
let mudF: Float32Array | null = null;
function mud(x: number, y: number) {
  const T = [0x3e2e20, 0x4c3828, 0x5c4532, 0x6e553e, 0x86704f];
  if (!mudF) {
    mudF = new Float32Array(S * S);
    for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) mudF[i + j * S] = fbm(i, j, 131, 32, 4);
  }
  const f = (i: number, j: number) => mudF![wrap(i, S) + wrap(j, S) * S];
  const n = f(x, y);
  let i = n < 0.38 ? 1 : n < 0.6 ? 2 : 3;
  // wet sheen catches the lit side of the ridges
  const gx = f(x + 1, y) - f(x - 1, y), gy = f(x, y + 1) - f(x, y - 1);
  if (gx + gy < -0.05 && n > 0.55 && ih(x, y, 132) < 0.35) return 0x8a7456;
  // shallow puddles: dark water with a lit far rim
  const w = cell(x, y, 32, 133);
  const pr = 3 + ih(w.id, 1, 133) * 4;
  if (ih(w.id, 2, 133) < 0.4 && w.f1 < pr) return w.f1 > pr - 1 && w.dy < 0 ? 0x8a7458 : 0x34261a;
  if (ih(x, y, 134) < 0.04) i--;
  return T[Math.max(0, Math.min(4, i))];
}

// ------------------------------------------------------------------ building / prop surfaces (multipliers)
function wood(x: number, y: number): RGB {
  // planks along v, 4 texels (0.25 m) wide: a dark seam, a lit edge, butt joints, grain, knots, nails
  const p = Math.floor(x / 4), lx = x - p * 4;
  const segL = 16 + 4 * Math.floor(ih(p, 1, 141) * 9);
  const off = Math.floor(ih(p, 2, 141) * segL);
  const sy = wrap(y + off, S);
  const seg = Math.floor(sy / segL), ly = sy - seg * segL;
  const k = ih(p, seg + 7, 142);
  if (lx === 0) return M(0.55, 0.04);
  if (ly === 0 && segL < S) return M(0.62, 0.04);
  let v = 0.9 + k * 0.18;
  if (lx === 1) v *= 1.1;
  if (lx === 3) v *= 0.92;
  if (ly === 1) v *= 1.06;
  // grain: streaks running the length of the plank, broken now and then
  const g = vn(x, y, 1, 8, 143) * 0.7 + vn(x, y, 4, 16, 144) * 0.3;
  v *= g > 0.68 ? 1.07 : g < 0.3 ? 0.89 : 1;
  // a knot here and there, a dark check along the grain
  if (ih(p, seg, 146) < 0.22 && ly === Math.floor(segL * (0.3 + 0.4 * ih(p, seg, 147))) && lx === 2) return M(0.52, 0.08);
  if (ih(x, Math.floor(y / 5), 145) < 0.03 && lx > 1) v *= 0.74;
  // a nail near the foot of some planks, rust bleeding below it
  if (lx === 2 && ly === segL - 2 && ih(p, seg, 148) < 0.5) return M(0.44, -0.04);
  if (lx === 2 && ly === segL - 1 && ih(p, seg, 148) < 0.5 && ih(p, seg, 149) < 0.6) return [v, v * 0.84, v * 0.72];
  // bleached, silvered patches
  const b = fbm(x, y, 150, 32, 3);
  if (b > 0.64) return [v * 1.05, v * 1.06, v * 1.1];
  return M(v, 0.02);
}
function brick(x: number, y: number): RGB {
  // cut sandstone masonry: 0.25 m courses, staggered blocks, mortar, pits and chips
  const c = coursed(x, y, 4, 8, 2, 161);
  const k = ih(c.id, 1, 161);
  if (c.ly === 0 || c.lx === 0) return M(0.66, 0.02);
  if (ih(c.id, c.lx, 162) < 0.06 && c.ly === 1) return M(0.74, 0.02);
  let v = 0.9 + k * 0.2;
  if (c.ly === 1 || c.lx === 1) v *= 1.1;
  if (c.ly === 3 || c.lx === c.L - 1) v *= 0.88;
  const n = fbm(x, y, 163, 8, 2);
  v *= n > 0.66 ? 1.05 : n < 0.3 ? 0.94 : 1;
  const pit = cell(x, y, 6, 164);
  if (pit.f1 < 0.7 && ih(pit.id, 1, 164) < 0.5) v *= 0.75;
  return M(v, 0.015);
}
function adobe(x: number, y: number): RGB {
  // mud bricks in soft mortar, half hidden under cracked lime-mud plaster, straw flecks
  const pl = fbm(x, y, 171, 32, 4);
  if (pl > 0.56) {
    const w = cell(x, y, 18, 172);
    if (w.f2 - w.f1 < 0.7) return M(0.7, 0.03);
    let v = pl > 0.62 ? 1.12 : 1.05;
    if (pl < 0.58) v = 0.9; // the plaster's broken lip
    if (ih(x, y, 173) < 0.03) v *= 0.9;
    return M(v, -0.01);
  }
  const c = coursed(x, y, 4, 8, 1, 174);
  if (c.ly === 0 || c.lx === 0) return M(0.76, 0.02);
  let v = 0.92 + ih(c.id, 1, 175) * 0.16;
  if (c.ly === 1 || c.lx === 1) v *= 1.06;
  if (c.ly === 3) v *= 0.92;
  const e = fbm(x, y, 176, 4, 2);
  if (e < 0.28) v *= 0.82; // erosion pits
  if (ih(x, y, 177) < 0.05) return [v * 1.18, v * 1.1, v * 0.8]; // straw
  return M(v, 0.02);
}
function rockNat(x: number, y: number): RGB {
  // natural sandstone: wavy bedding, cross-bed sets, pits, a few dark varnish streaks
  const wob = (vn(x, y, 32, 32, 181) - 0.5) * 6;
  const b = fbm(x, wrap(Math.round(y + wob), S), 182, 32, 3, 0.2);
  let v = b > 0.62 ? 1.1 : b > 0.5 ? 1.02 : b > 0.38 ? 0.94 : 0.86;
  const cb = (x + y * 0.6 + vn(x, y, 16, 16, 183) * 10) % 6;
  if (cb < 0.8 && vn(x, y, 32, 16, 184) > 0.55) v *= 0.9;
  const pit = cell(x, y, 7, 185);
  if (pit.f1 < 0.75 && ih(pit.id, 1, 185) < 0.55) return M(0.7, 0.03);
  if (pit.f1 < 1.5 && ih(pit.id, 1, 185) < 0.55 && pit.dx + pit.dy < 0) v *= 1.08;
  const st = cell(x, y, 32, 186);
  if (ih(st.id, 1, 186) < 0.3 && Math.abs(st.dx) < 0.6 + st.dy * 0.08 && st.dy > 0 && st.dy < 12) return [v * 0.74, v * 0.64, v * 0.58];
  return M(v, 0.02);
}
function metal(x: number, y: number): RGB {
  // weathered tin / iron: rust blooms, pitting, rust bleeding down, bright scratches
  const r = fbm(x, y, 191, 16, 4);
  const streak = vn(x, y, 2, 32, 192);
  let c: RGB = M(0.96 + (vn(x, y, 8, 8, 193) - 0.5) * 0.1);
  if (r > 0.6) c = r > 0.7 ? [1.12, 0.74, 0.5] : [1.0, 0.8, 0.64];
  else if (streak > 0.78) c = [0.98, 0.84, 0.72];
  if (ih(x, y, 194) < 0.04) c = M(0.62);
  const sc = (x - y * 0.5 + 400) % 23;
  if (sc < 0.6 && vn(x, y, 16, 16, 195) > 0.62) c = M(1.22);
  return c;
}
function cloth(x: number, y: number): RGB {
  // heavy canvas: tabby weave, slubs, sun-faded stains, a stitched seam
  let v = (x + y) % 2 === 0 ? 1.015 : 0.985;
  if (ih(0, y, 201) < 0.08) v *= 1.04; // slub threads
  const st = fbm(x, y, 202, 32, 3);
  if (st > 0.7) v *= 0.92;
  else if (st < 0.28) v *= 1.04;
  if (x % 64 === 0) return M(0.8, 0.03);
  if (x % 64 === 2 && y % 4 < 2) return M(0.86, 0.03);
  return M(v, st > 0.7 ? 0.04 : 0);
}
function bark(x: number, y: number): RGB {
  // palm trunk: overlapping leaf-base scales in diamond rows, fibrous between
  const row = Math.floor(y / 3);
  const sx = wrap(x + (row % 2) * 2, S);
  const lx = sx % 4, ly = y - row * 3;
  const d = Math.abs(lx - 2) / 2 + ly / 3;
  let v = 0.95 + ih(Math.floor(sx / 4), row, 211) * 0.12;
  if (d > 1.0) v = 0.62;
  else if (d > 0.86) v *= 0.82;
  else if (ly <= 1) v *= 1.1;
  if (vn(x, y, 1, 6, 212) > 0.7) v *= 0.9;
  return M(v, 0.03);
}
function cactus(x: number, y: number): RGB {
  // saguaro skin: vertical ribs (lit crest, shaded groove), areoles with pale spines
  const lx = x % 4;
  let v = lx === 0 ? 0.76 : lx === 2 ? 1.12 : 1.0;
  v *= 0.97 + vn(x, y, 8, 32, 221) * 0.06;
  if (lx === 2 && (y + Math.floor(x / 4) * 2) % 5 === 0) return [1.5, 1.42, 1.18];
  return [v * 0.98, v, v * 0.96];
}

// ------------------------------------------------------------------ atlas
/** reference colours the terrain tiles are normalised against (the terrain palette) */
export const PX_REF = {
  sandTop: 0xe6bb7c,
  sandSide: 0xc99a5d,
  packed: 0xd2a163,
  rock: 0xba8c62,
  tile: 0xe9cf9d,
  tileSide: 0xc9a874,
  dirt: 0xb0825a,
  dirtSide: 0x8f6643,
  grass: 0x82a849,
  grassSide: 0x8a6a45,
  mud: 0x765d40,
};

let atlas: THREE.DataArrayTexture | null = null;
/** the shared pixel-material atlas (built on first use, ~60 ms) */
export function pixelAtlas(): THREE.DataArrayTexture {
  if (atlas) return atlas;
  const t0 = performance.now();
  const g = grassTopBuf();
  const tiles: Float32Array[] = [];
  tiles[PX.SAND] = fromHex(sandTop, PX_REF.sandTop);
  tiles[PX.SAND_SIDE] = fromHex(sandSide, PX_REF.sandSide);
  tiles[PX.PACKED] = fromHex(packedTop, PX_REF.packed);
  tiles[PX.ROCK_TOP] = fromHex(rockTop, PX_REF.rock);
  tiles[PX.ROCK_SIDE] = fromHex(rockSide, PX_REF.rock);
  tiles[PX.TILE_TOP] = fromHex(tileTop, PX_REF.tile);
  tiles[PX.TILE_SIDE] = fromHex(tileSide, PX_REF.tileSide);
  tiles[PX.DIRT_TOP] = fromHex(dirtTop, PX_REF.dirt);
  tiles[PX.DIRT_SIDE] = fromHex((x, y) => soilSide(x, y, 0), PX_REF.dirtSide);
  tiles[PX.GRASS_TOP] = fromHex((x, y) => g[x + y * S], PX_REF.grass);
  tiles[PX.GRASS_SIDE] = fromHex((x, y) => soilSide(x, y, 1), PX_REF.grassSide);
  tiles[PX.MUD] = fromHex(mud, PX_REF.mud);
  tiles[PX.WOOD] = fromMul(wood);
  tiles[PX.BRICK] = fromMul(brick);
  tiles[PX.ADOBE] = fromMul(adobe);
  tiles[PX.ROCK] = fromMul(rockNat);
  tiles[PX.METAL] = fromMul(metal);
  tiles[PX.CLOTH] = fromMul(cloth);
  tiles[PX.BARK] = fromMul(bark);
  tiles[PX.CACTUS] = fromMul(cactus);
  const data = new Uint8Array(S * S * 4 * PX_LAYERS);
  for (let l = 0; l < PX_LAYERS; l++) {
    const t = tiles[l];
    const o = l * S * S * 4;
    for (let i = 0; i < S * S; i++) {
      data[o + i * 4] = Math.max(0, Math.min(255, Math.round((t[i * 3] / 4) * 255)));
      data[o + i * 4 + 1] = Math.max(0, Math.min(255, Math.round((t[i * 3 + 1] / 4) * 255)));
      data[o + i * 4 + 2] = Math.max(0, Math.min(255, Math.round((t[i * 3 + 2] / 4) * 255)));
      data[o + i * 4 + 3] = 255;
    }
  }
  const tex = new THREE.DataArrayTexture(data, S, S, PX_LAYERS);
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.UnsignedByteType;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.NearestFilter;
  // crisp up close, no shimmer in the distance
  tex.minFilter = THREE.NearestMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  atlas = tex;
  console.log(`[pixeltex] ${PX_LAYERS} layers ${S}px synthesised in ${(performance.now() - t0).toFixed(0)}ms`);
  return tex;
}

/**
 * GLSL: sample a pixel layer on an axis-aligned face. `p` is the world / object
 * position (m), `n` the face normal; the tile's +v runs down the face on walls.
 * Returns the colour ratio (1 = unchanged).
 */
export const PIXEL_GLSL = /* glsl */ `
uniform highp sampler2DArray uPxTex;
vec2 pxUV(vec3 p, vec3 n) {
  vec3 a = abs(n);
  vec2 uv = a.y > max(a.x, a.z) ? p.xz : (a.x > a.z ? vec2(p.z, -p.y) : vec2(p.x, -p.y));
  return uv * ${(PX_PER_M / PX_SIZE).toFixed(5)};
}
vec3 pxSample(vec2 uv, float layer) { return texture(uPxTex, vec3(uv, layer)).rgb * 4.0; }
`;
